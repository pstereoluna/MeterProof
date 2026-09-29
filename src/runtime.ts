import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { MeterProof } from './domain.js';
import { DynamoStore } from './store.js';

export function createRuntime(env: Record<string, string | undefined> = process.env) {
  const ledger = env.LEDGER_TABLE;
  const state = env.STATE_TABLE;
  if (!ledger || !state) throw new Error('LEDGER_TABLE and STATE_TABLE are required.');
  let endpoint: string | undefined;
  if (env.DYNAMODB_ENDPOINT) {
    const parsed = new URL(env.DYNAMODB_ENDPOINT);
    if (!['http:', 'https:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.username || parsed.password) {
      throw new Error('DYNAMODB_ENDPOINT is only supported for explicit loopback local development.');
    }
    endpoint = parsed.origin;
  }
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region: env.AWS_REGION ?? 'us-west-2',
    maxAttempts: 5,
    ...(endpoint ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } } : {}),
  }), { marshallOptions: { removeUndefinedValues: true } });
  const store = new DynamoStore(client, ledger, state);
  return { store, service: new MeterProof(store) };
}
let runtime: ReturnType<typeof createRuntime> | undefined;
export const getRuntime = () => runtime ??= createRuntime();
