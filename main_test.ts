// ── HTTP transport tests ──

import { createHttpHandler, httpListenOptions } from './main.ts';
import { McpHandler } from './mcp.ts';
import { assertEquals, assertThrows } from 'std/assert/mod.ts';

const TOKEN = 'test-token-123';

function setup() {
  const logs: string[] = [];
  const handler = createHttpHandler(
    new McpHandler({ name: 'test', version: '0.0.0' }),
    TOKEN,
    (level, msg) => logs.push(`${level} ${msg}`),
  );
  return { handler, logs };
}

function post(body: unknown, headers: Record<string, string>, path = '/mcp'): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const PING = { jsonrpc: '2.0', id: 1, method: 'ping' };

Deno.test('HTTP mode refuses to start without MCP_BEARER_TOKEN', () => {
  assertThrows(
    () => httpListenOptions({ host: '127.0.0.1', port: 3000 }),
    Error,
    'MCP_BEARER_TOKEN',
  );
});

Deno.test('HTTP mode listens on the configured host and port', () => {
  assertEquals(httpListenOptions({ host: '127.0.0.1', port: 3001, mcpBearerToken: TOKEN }), {
    hostname: '127.0.0.1',
    port: 3001,
    token: TOKEN,
  });
});

Deno.test('a token in the api_key query parameter is refused', async () => {
  const { handler } = setup();
  const res = await handler(post(PING, {}, `/mcp?api_key=${TOKEN}`));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test('a failed login never logs the token the client sent', async () => {
  const { handler, logs } = setup();
  const sent = 'near-miss-secret';
  const res = await handler(
    post(PING, { 'Authorization': `Bearer ${sent}`, 'X-Api-Key': sent }, `/mcp?api_key=${sent}`),
  );
  await res.body?.cancel();
  assertEquals(res.status, 401);
  assertEquals(logs.length > 0, true);
  assertEquals(logs.some((line) => line.includes(sent)), false);
});

Deno.test('the token is accepted as a Bearer header or an X-Api-Key header', async () => {
  const { handler } = setup();
  const variants: Record<string, string>[] = [
    { 'Authorization': `Bearer ${TOKEN}` },
    { 'X-Api-Key': TOKEN },
  ];
  for (const headers of variants) {
    const res = await handler(post(PING, headers));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
  }
});

Deno.test('a posted notification gets 202 with no body', async () => {
  const { handler } = setup();
  const res = await handler(
    post({ jsonrpc: '2.0', method: 'notifications/initialized' }, {
      'Authorization': `Bearer ${TOKEN}`,
    }),
  );
  assertEquals(res.status, 202);
  assertEquals(await res.text(), '');
});

Deno.test('GET /mcp is not offered', async () => {
  const { handler } = setup();
  const res = await handler(
    new Request('http://localhost/mcp', { headers: { 'Authorization': `Bearer ${TOKEN}` } }),
  );
  await res.body?.cancel();
  assertEquals(res.status, 405);
});
