import { unmarshall } from '@aws-sdk/util-dynamodb';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import type { DynamoDBBatchResponse, DynamoDBStreamEvent } from 'aws-lambda';
import type { Store, UsageEvent } from './domain.js';
import { getRuntime } from './runtime.js';

export function createMeterHandler(store: Pick<Store, 'processEvent'>, now: () => string = () => new Date().toISOString()) {
  return async (batch: DynamoDBStreamEvent): Promise<DynamoDBBatchResponse> => {
    const batchItemFailures: DynamoDBBatchResponse['batchItemFailures'] = [];
    for (const record of batch.Records) {
      if (record.eventName !== 'INSERT' || !record.dynamodb?.NewImage) continue;
      try {
        const item = unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>);
        if (item.entity !== 'EVENT') continue; // Ledger also contains idempotency rows.
        if (!item.event || typeof item.event.event_id !== 'string' || !['ON_TIME', 'POST_CLOSE'].includes(item.event.classification)) throw new Error('Malformed ledger event.');
        await store.processEvent(item.event as UsageEvent, now());
      } catch (error) {
        console.error('meter_record_failed', { eventID: record.eventID, name: (error as Error)?.name });
        // DynamoDB partial batch responses use SequenceNumber, never eventID.
        if (!record.dynamodb.SequenceNumber) throw error;
        batchItemFailures.push({ itemIdentifier: record.dynamodb.SequenceNumber });
      }
    }
    return { batchItemFailures };
  };
}
export const handler = async (batch: DynamoDBStreamEvent) => createMeterHandler(getRuntime().store)(batch);
