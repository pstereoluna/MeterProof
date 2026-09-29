import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ensureTables, localEndpoint } from './local-db';
import { LocalScenarioController, type ScenarioState } from './scenario';
import { ApiError, PARTITION } from '../src/domain';
import { DynamoStore } from '../src/store';

async function main() {
  process.env.DYNAMODB_ENDPOINT = localEndpoint;
  process.env.LEDGER_TABLE = process.env.LEDGER_TABLE || 'MeterProofLocalLedger';
  process.env.STATE_TABLE = process.env.STATE_TABLE || 'MeterProofLocalState';
  await ensureTables([process.env.LEDGER_TABLE, process.env.STATE_TABLE]);
  const { createApiHandler } = await import('../src/api');
  const { createRuntime } = await import('../src/runtime');
  const { store, service } = createRuntime();
  const handler = createApiHandler(service, resolve('web/index.html'));
  const target = createHash('sha256').update(JSON.stringify([localEndpoint, store.ledgerTable, store.stateTable])).digest('hex').slice(0, 16);
  const checkpoint = resolve(`.local/scenario-${target}.json`);
  await mkdir(resolve('.local'), { recursive: true });
  let initialState: ScenarioState | undefined;
  try { initialState = JSON.parse(await readFile(checkpoint, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const scenario = new LocalScenarioController({
    initialState,
    createStore: (runId) => new DynamoStore(store.client, store.ledgerTable, store.stateTable, `DEMO#${runId}#${PARTITION}`),
    persist: async (state) => {
      const temporary = `${checkpoint}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
      await rename(temporary, checkpoint);
    },
  });
  if (!scenario.state()) await scenario.start();

  // Preserve the original simple demo's worker. It reads only the default
  // partition; scenario namespaces receive explicitly controlled deliveries.
  let working = false;
  const worker = setInterval(async () => {
    if (working) return;
    working = true;
    try {
      for (const event of await store.queryEvents()) await store.processEvent(event, new Date().toISOString());
    } catch (error) { console.error('Local worker:', (error as Error).message); }
    finally { working = false; }
  }, 1000);

  const server = createServer(async (request, response) => {
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    try {
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 16_384) { json(413, { message: 'Request body too large.' }); return; }
      }
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      const method = request.method || 'GET';
      if (method === 'GET' && url.pathname === '/api/health') {
        json(200, { status: 'ok', service: 'MeterProof', mode: 'local', demo: true });
        return;
      }
      if (method === 'GET' && url.pathname === '/api/demo') {
        json(200, await scenario.view());
        return;
      }
      if (method === 'POST' && ['/api/demo/start', '/api/demo/step'].includes(url.pathname)) {
        let input: unknown;
        try { input = JSON.parse(body || '{}'); }
        catch { throw new ApiError(400, 'Request body must be valid JSON.'); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Expected a JSON object.');
        const result = url.pathname === '/api/demo/start' ? await scenario.start() : await scenario.advance(input as { run_id: string; expected_step: number });
        json(200, result);
        return;
      }
      const result = await handler({
        version: '2.0', rawPath: url.pathname,
        requestContext: { http: { method, path: url.pathname } },
        body: body || undefined, isBase64Encoded: false,
      } as never);
      response.writeHead(result.statusCode || 200, result.headers as Record<string, string>);
      response.end(result.body || '');
    } catch (error) {
      console.error('Local request:', (error as Error).message);
      json(error instanceof ApiError ? error.status : 500, {
        error: error instanceof ApiError ? error.code : 'LOCAL_ERROR',
        message: (error as Error).message,
      });
    }
  });
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '127.0.0.1', () => console.log(`MeterProof local demo: http://127.0.0.1:${port}\nReal DynamoDB Local transactions; scenario delivery and interruption are controlled locally. No AWS resources are used.`));
  const shutdown = () => { clearInterval(worker); server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch(error => { console.error(error.message, '\nStart DynamoDB Local with npm run db first.'); process.exitCode = 1; });
