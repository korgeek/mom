// An actual HTTP/CORS transport fixture. Responses are synthetic, never model inference.
import { createServer, type IncomingMessage } from 'node:http';

export type LocalModelCall = { path: string; authorization: string | undefined; origin: string | undefined; body: string };
export function syntheticModelResponse(path: string, model: string) {
  return path.endsWith('/audio/transcriptions')
    ? { text: 'SYNTHETIC_MODEL_SPEECH: Review the release on Monday.', model, usage: { seconds: 1, cost: 0.0001 } }
    : { model, choices: [{ message: { content: '# SYNTHETIC_MODEL_NOTES\n\nReview the release on Monday.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20, cost: 0.0002 } };
}
export async function startLocalModelServer(allowedOrigin: string) {
  const calls: LocalModelCall[] = [];
  let allowCors = true;
  let responseGate: Promise<void> | null = null;
  const server = createServer(async (request: IncomingMessage, response) => {
    if (allowCors && request.headers.origin === allowedOrigin) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return; }
    const buffers: Buffer[] = []; let bytes = 0;
    for await (const data of request) {
      bytes += data.length;
      if (bytes > 2 * 1024 * 1024) { response.writeHead(413); response.end(); return; }
      buffers.push(Buffer.from(data));
    }
    const body = Buffer.concat(buffers).toString('utf8');
    calls.push({ path: request.url!, authorization: request.headers.authorization, origin: request.headers.origin, body });
    let model = 'synthetic-local';
    if (request.headers['content-type']?.includes('application/json')) {
      try { model = JSON.parse(body).model; } catch { response.writeHead(400); response.end(); return; }
    }
    if (responseGate) await responseGate;
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(syntheticModelResponse(request.url!, model)));
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture server address');
  return { url: `http://127.0.0.1:${address.port}/v1`, calls,
    setCors(allowed: boolean) { allowCors = allowed; },
    pauseResponsesUntil(gate: Promise<void>) { responseGate = gate; },
    async close() { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
