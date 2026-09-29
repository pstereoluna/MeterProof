import { CreateTableCommand, DescribeTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';

export const localEndpoint = process.env.DYNAMODB_ENDPOINT || 'http://127.0.0.1:8000';
const address = new URL(localEndpoint);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) {
  throw new Error('The local runner only connects to a loopback DynamoDB endpoint.');
}
export const localClient = new DynamoDBClient({
  endpoint: localEndpoint, region: 'us-east-1',
  credentials: { accessKeyId: 'meterprooflocal', secretAccessKey: 'meterprooflocal' },
});

export async function ensureTables(names: string[]) {
  for (const TableName of names) {
    try { await localClient.send(new DescribeTableCommand({ TableName })); }
    catch (error) {
      if ((error as Error).name !== 'ResourceNotFoundException') throw error;
      await localClient.send(new CreateTableCommand({
        TableName, BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }, { AttributeName: 'sk', KeyType: 'RANGE' }],
        AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }, { AttributeName: 'sk', AttributeType: 'S' }],
      }));
    }
  }
}
