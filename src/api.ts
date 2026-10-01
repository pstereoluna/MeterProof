import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { ApiError, type MeterProof } from './domain.js';
import { getRuntime } from './runtime.js';

function bodyOf(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw) > 16_384) throw new ApiError(413, 'Request body is too large.');
  try { return JSON.parse(raw); } catch { throw new ApiError(400, 'Request body must be valid JSON.'); }
}
function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }, body: JSON.stringify(body) };
}

export function createApiHandler(service: MeterProof, htmlPath = join(__dirname, 'web', 'index.html')) {
  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> => {
    try {
      const method = event.requestContext.http.method;
      const path = event.rawPath.replace(/\/$/, '') || '/';
      if (method === 'GET' && path === '/api/health') return json(200, {
        status: 'ok', service: 'MeterProof', mode: process.env.DYNAMODB_ENDPOINT ? 'local' : 'aws',
      });
      if (method === 'GET' && path === '/') {
        const html = await readFile(htmlPath, 'utf8');
        return { statusCode: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }, body: html };
      }
      if (method === 'GET' && path === '/api/replay') {
        return json(200, JSON.parse(await readFile(join(dirname(htmlPath), 'replay.json'), 'utf8')));
      }
      if (method === 'GET' && path === '/api/period') return json(200, await service.view());
      if (method === 'POST' && path === '/api/events') {
        const result = await service.ingest(bodyOf(event));
        return json(result.duplicate ? 200 : 201, result);
      }
      if (method === 'POST' && path === '/api/close') {
        bodyOf(event); // Validate JSON before reserving the durable close fence.
        return json(200, { snapshot: await service.close() });
      }
      if (method === 'POST' && path === '/api/adjust') return json(200, { snapshot: await service.adjust(bodyOf(event)) });
      return json(404, { error: 'NOT_FOUND', message: 'Route not found.' });
    } catch (error) {
      if (error instanceof ApiError) {
        const response = json(error.status, { error: error.code, message: error.message });
        if (error.status === 503) response.headers = { ...response.headers, 'retry-after': '1' };
        return response;
      }
      console.error('api_request_failed', { name: (error as Error)?.name, message: (error as Error)?.message });
      return json(500, { error: 'INTERNAL_ERROR', message: 'Request failed. Retry with the same event_id or expected_version.' });
    }
  };
}
export const handler = async (event: APIGatewayProxyEventV2) => createApiHandler(getRuntime().service)(event);
