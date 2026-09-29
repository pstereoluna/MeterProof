import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { ensureTables, localEndpoint } from './local-db';

async function main() {
  process.env.DYNAMODB_ENDPOINT = localEndpoint;
  process.env.LEDGER_TABLE = process.env.LEDGER_TABLE || 'MeterProofLocalLedger';
  process.env.STATE_TABLE = process.env.STATE_TABLE || 'MeterProofLocalState';
  await ensureTables([process.env.LEDGER_TABLE, process.env.STATE_TABLE]);
  const { createApiHandler } = await import('../src/api');
  const { createRuntime } = await import('../src/runtime');
  const { store, service } = createRuntime();
  const handler = createApiHandler(service, resolve('web/index.html'));
  // Local-only substitute for the AWS event-source mapping. It shares the exact
  // transactional projector and redelivers records, but is NOT AWS Streams proof.
  let working = false;
  const worker = setInterval(async () => {
    if (working) return;
    working = true;
    try {
      for (const event of await store.queryEvents()) {
        await store.processEvent(event, new Date().toISOString());
      }
    } catch (error) { console.error('Local worker:', (error as Error).message); }
    finally { working = false; }
  }, 1000);

  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 16_384) {
          response.writeHead(413, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ error: 'Request body too large.' }));
          return;
        }
      }
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const result = await handler({
        version: '2.0', rawPath: url.pathname,
        requestContext: { http: { method: request.method || 'GET', path: url.pathname } },
        body: body || undefined, isBase64Encoded: false,
      } as never);
      response.writeHead(result.statusCode || 200, result.headers as Record<string, string>);
      response.end(result.body || '');
    } catch (error) {
      console.error((error as Error).message);
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Local server error.' }));
    }
  });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`MeterProof local demo: http://127.0.0.1:${port}\nDynamoDB Local + simulated async delivery. No AWS resources are used.`));
  const shutdown = () => { clearInterval(worker); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch(error => { console.error(error.message, '\nStart DynamoDB Local with npm run db first.'); process.exitCode = 1; });
