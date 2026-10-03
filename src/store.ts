import {
  DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand,
  TransactWriteCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ApiError, PARTITION, emptyAggregate,
  type Aggregate, type Build, type ExistingEvent, type PeriodState,
  type Snapshot, type StateContents, type Store, type UsageEvent,
} from './domain.js';
import { exactQuantity } from './quantity.js';

const periodKey = (partition = PARTITION) => ({ pk: partition, sk: 'PERIOD' });
const snapshotKey = (version: number, partition = PARTITION) => ({ pk: partition, sk: `SNAPSHOT#${String(version).padStart(12, '0')}` });
export const eventKey = (event: Pick<UsageEvent, 'epoch' | 'event_id'>, partition = PARTITION) => ({ pk: partition, sk: `EVENT#${String(event.epoch).padStart(16, '0')}#${event.event_id}` });
const idempotencyKey = (eventId: string, partition = PARTITION) => ({ pk: partition, sk: `IDEMPOTENCY#${eventId}` });
const receiptKey = (eventId: string, partition = PARTITION) => ({ pk: partition, sk: `PROCESSED#${eventId}` });

function conditionalFailure(error: unknown): boolean {
  const candidate = error as { name?: string; CancellationReasons?: { Code?: string }[] };
  return candidate.name === 'ConditionalCheckFailedException' ||
    (candidate.name === 'TransactionCanceledException' && candidate.CancellationReasons?.some((reason) => reason.Code === 'ConditionalCheckFailed') === true);
}
function rethrowStorage(error: unknown): never {
  const name = (error as { name?: string }).name ?? '';
  if (['TransactionCanceledException', 'TransactionConflictException', 'TransactionInProgressException',
    'ProvisionedThroughputExceededException', 'ThrottlingException', 'RequestLimitExceeded',
    'InternalServerError', 'TimeoutError'].includes(name)) {
    throw new ApiError(503, 'Storage is temporarily busy. Retry the same request.', 'STORAGE_RETRY');
  }
  throw error;
}

/** Base-table reads are strongly consistent. No index or stream defines snapshot membership. */
export class DynamoStore implements Store {
  constructor(
    public readonly client: DynamoDBDocumentClient,
    public readonly ledgerTable: string,
    public readonly stateTable: string,
    // Local scenario runs can isolate data; deployed callers keep the original namespace.
    public readonly partition: string = PARTITION,
  ) {}

  async ensurePeriod(): Promise<void> {
    try {
      await this.client.send(new PutCommand({
        TableName: this.stateTable,
        Item: { ...periodKey(this.partition), entity: 'PERIOD', phase: 'OPEN', epoch: 0, latest_version: 0 },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
    } catch (error) {
      if (!conditionalFailure(error)) rethrowStorage(error);
    }
  }

  async getPeriod(): Promise<PeriodState> {
    const result = await this.client.send(new GetCommand({ TableName: this.stateTable, Key: periodKey(this.partition), ConsistentRead: true }));
    if (!result.Item) throw new ApiError(503, 'Period initialization has not completed.', 'MISSING_PERIOD');
    const { phase, epoch, latest_version, building } = result.Item;
    return { phase, epoch, latest_version, ...(building ? { building } : {}) } as PeriodState;
  }

  async findEvent(eventId: string): Promise<ExistingEvent | undefined> {
    const key = await this.client.send(new GetCommand({ TableName: this.ledgerTable, Key: idempotencyKey(eventId, this.partition), ConsistentRead: true }));
    if (!key.Item) return undefined;
    const result = await this.client.send(new GetCommand({ TableName: this.ledgerTable, Key: key.Item.event_key, ConsistentRead: true }));
    if (!result.Item) throw new ApiError(503, 'An accepted event could not be loaded.', 'MISSING_EVENT');
    return { event: result.Item.event as UsageEvent, fingerprint: key.Item.fingerprint as string };
  }

  async acceptEvent(event: UsageEvent, fingerprint: string, expected: PeriodState): Promise<boolean> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { ConditionCheck: {
          TableName: this.stateTable, Key: periodKey(this.partition),
          ConditionExpression: '#phase = :phase AND #epoch = :epoch',
          ExpressionAttributeNames: { '#phase': 'phase', '#epoch': 'epoch' },
          ExpressionAttributeValues: { ':phase': expected.phase, ':epoch': expected.epoch },
        } },
        { Put: {
          TableName: this.ledgerTable, Item: { ...eventKey(event, this.partition), entity: 'EVENT', event },
          ConditionExpression: 'attribute_not_exists(pk)',
        } },
        { Put: {
          TableName: this.ledgerTable,
          Item: { ...idempotencyKey(event.event_id, this.partition), entity: 'IDEMPOTENCY', event_key: eventKey(event, this.partition), fingerprint },
          ConditionExpression: 'attribute_not_exists(pk)',
        } },
      ] }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      rethrowStorage(error);
    }
  }

  async reserveBuild(expected: PeriodState, build: Build): Promise<boolean> {
    try {
      await this.client.send(new UpdateCommand({
        TableName: this.stateTable, Key: periodKey(this.partition),
        UpdateExpression: 'SET #phase = :closed, #epoch = :next, #building = :building',
        ConditionExpression: '#phase = :phase AND #epoch = :epoch AND #latest = :latest AND attribute_not_exists(#building)',
        ExpressionAttributeNames: { '#phase': 'phase', '#epoch': 'epoch', '#latest': 'latest_version', '#building': 'building' },
        ExpressionAttributeValues: {
          ':closed': 'CLOSED', ':next': expected.epoch + 1, ':building': build,
          ':phase': expected.phase, ':epoch': expected.epoch, ':latest': expected.latest_version,
        },
      }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      rethrowStorage(error);
    }
  }

  async queryEvents(throughEpoch?: number): Promise<UsageEvent[]> {
    const events: UsageEvent[] = [];
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.ledgerTable, ConsistentRead: true,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :start AND :end',
        ExpressionAttributeValues: {
          ':pk': this.partition, ':start': 'EVENT#',
          ':end': throughEpoch === undefined ? 'EVENT#~' : `EVENT#${String(throughEpoch).padStart(16, '0')}#~`,
        },
        ExclusiveStartKey: cursor,
      }));
      for (const item of result.Items ?? []) events.push(item.event as UsageEvent);
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    return events;
  }

  async getSnapshot(version: number): Promise<Snapshot | undefined> {
    const result = await this.client.send(new GetCommand({ TableName: this.stateTable, Key: snapshotKey(version, this.partition), ConsistentRead: true }));
    return result.Item?.snapshot as Snapshot | undefined;
  }

  async publishSnapshot(build: Build, snapshot: Snapshot): Promise<boolean> {
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: [
        { Put: {
          TableName: this.stateTable, Item: { ...snapshotKey(snapshot.version, this.partition), entity: 'SNAPSHOT', snapshot },
          ConditionExpression: 'attribute_not_exists(pk)',
        } },
        { Update: {
          TableName: this.stateTable, Key: periodKey(this.partition),
          UpdateExpression: 'SET #latest = :version REMOVE #building',
          ConditionExpression: '#building.#operation = :operation AND #latest = :base',
          ExpressionAttributeNames: { '#latest': 'latest_version', '#building': 'building', '#operation': 'operation_id' },
          ExpressionAttributeValues: { ':version': build.version, ':operation': build.operation_id, ':base': build.base_version },
        } },
      ] }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      rethrowStorage(error);
    }
  }

  async stateContents(): Promise<StateContents> {
    const snapshots: Snapshot[] = [];
    const receipts: StateContents['receipts'] = [];
    let aggregate: Aggregate = emptyAggregate();
    let latestOnTimeProcessing: string | null = null;
    let cursor: Record<string, unknown> | undefined;
    do {
      const result = await this.client.send(new QueryCommand({
        TableName: this.stateTable, ConsistentRead: true,
        KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': this.partition },
        ExclusiveStartKey: cursor,
      }));
      for (const item of result.Items ?? []) {
        if (item.entity === 'SNAPSHOT') snapshots.push(item.snapshot as Snapshot);
        if (item.entity === 'AGGREGATE') aggregate = {
          // DynamoDB ADD remains exact; the SDK reads large N values as bigint.
          units: exactQuantity(item.units), amount_cents: exactQuantity(item.amount_cents),
          processed_events: item.processed_events, last_processed_at: null,
        };
        if (item.entity === 'PROCESSED') {
          receipts.push({ event_id: item.event_id, processed_at: item.processed_at });
          if (item.classification === 'ON_TIME' && (!latestOnTimeProcessing || item.processed_at > latestOnTimeProcessing)) latestOnTimeProcessing = item.processed_at;
        }
      }
      cursor = result.LastEvaluatedKey;
    } while (cursor);
    aggregate.last_processed_at = latestOnTimeProcessing;
    return { snapshots, receipts, aggregate };
  }

  async processEvent(event: UsageEvent, processedAt: string): Promise<boolean> {
    // ON_TIME is persisted at ingestion. A stream delay never reclassifies it.
    const writes: NonNullable<ConstructorParameters<typeof TransactWriteCommand>[0]['TransactItems']> = [
      { Put: {
        TableName: this.stateTable,
        Item: { ...receiptKey(event.event_id, this.partition), entity: 'PROCESSED', event_id: event.event_id, classification: event.classification, processed_at: processedAt },
        ConditionExpression: 'attribute_not_exists(pk)',
      } },
    ];
    if (event.classification === 'ON_TIME') writes.push({ Update: {
      TableName: this.stateTable, Key: { pk: this.partition, sk: 'AGGREGATE' },
      UpdateExpression: 'SET #entity = :entity ADD #units :units, #amount :amount, #count :one',
      ExpressionAttributeNames: { '#entity': 'entity', '#units': 'units', '#amount': 'amount_cents', '#count': 'processed_events' },
      ExpressionAttributeValues: { ':entity': 'AGGREGATE', ':units': event.units, ':amount': event.amount_cents, ':one': 1 },
    } });
    try {
      await this.client.send(new TransactWriteCommand({ TransactItems: writes }));
      return true;
    } catch (error) {
      if (conditionalFailure(error)) return false;
      rethrowStorage(error); // A transaction conflict must be retried, never mistaken for a duplicate.
    }
  }
}
