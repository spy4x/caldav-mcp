// ── HTTP transport tests ──

import { createHttpHandler, createLogger, httpListenOptions, MAX_BODY_BYTES } from './main.ts';
import { McpHandler } from './mcp.ts';
import { assertEquals, assertThrows } from 'std/assert/mod.ts';

const TOKEN = 'test-token-123';

function setup(options: { trustProxy?: boolean } = {}) {
  const logs: string[] = [];
  const handler = createHttpHandler(
    new McpHandler({ name: 'test', version: '0.0.0' }),
    TOKEN,
    (level, msg) => logs.push(`${level} ${msg}`),
    options,
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

Deno.test('the token is accepted as a Bearer header, a bare Authorization header or an X-Api-Key header', async () => {
  const { handler } = setup();
  const variants: Record<string, string>[] = [
    { 'Authorization': `Bearer ${TOKEN}` },
    { 'Authorization': TOKEN },
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

const AUTH = { 'Authorization': `Bearer ${TOKEN}` };

function peer(hostname: string) {
  return { remoteAddr: { transport: 'tcp' as const, hostname, port: 40000 } };
}

/** Send `count` authorized pings and return the last status. */
async function burst(
  handler: ReturnType<typeof setup>['handler'],
  count: number,
  headers: () => Record<string, string>,
  from = peer('192.0.2.1'),
): Promise<Response> {
  let res: Response | undefined;
  for (let i = 0; i < count; i++) {
    await res?.body?.cancel();
    res = await handler(post(PING, { ...AUTH, ...headers() }), from);
  }
  return res!;
}

Deno.test('the 101st request in a minute from one client gets 429 with Retry-After', async () => {
  const { handler } = setup();
  const last = await burst(handler, 100, () => ({}));
  assertEquals(last.status, 200);
  await last.body?.cancel();
  const over = await handler(post(PING, AUTH), peer('192.0.2.1'));
  await over.body?.cancel();
  assertEquals(over.status, 429);
  assertEquals(Number(over.headers.get('Retry-After')) > 0, true);
  const other = await handler(post(PING, AUTH), peer('192.0.2.2'));
  await other.body?.cancel();
  assertEquals(other.status, 200);
});

Deno.test('a forged X-Forwarded-For does not escape the limit when no proxy is trusted', async () => {
  const { handler } = setup();
  let n = 0;
  const res = await burst(handler, 101, () => ({ 'X-Forwarded-For': `198.51.100.${n++ % 250}` }));
  await res.body?.cancel();
  assertEquals(res.status, 429);
});

Deno.test('behind a trusted proxy each X-Forwarded-For client gets its own budget', async () => {
  const { handler } = setup({ trustProxy: true });
  const proxy = peer('10.0.0.1');
  const first = await burst(handler, 101, () => ({ 'X-Forwarded-For': '198.51.100.1' }), proxy);
  await first.body?.cancel();
  assertEquals(first.status, 429);
  const second = await handler(post(PING, { ...AUTH, 'X-Forwarded-For': '198.51.100.2' }), proxy);
  await second.body?.cancel();
  assertEquals(second.status, 200);
});

Deno.test('a POST /mcp body over the size cap gets 413', async () => {
  const { handler } = setup();
  const res = await handler(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: AUTH,
      body: 'x'.repeat(MAX_BODY_BYTES + 1),
    }),
  );
  await res.body?.cancel();
  assertEquals(res.status, 413);
});

Deno.test('log lines never contain the bearer token or the CalDAV password', () => {
  const lines: string[] = [];
  const log = createLogger(
    { logLevel: 'debug', mcpBearerToken: TOKEN, caldavPassword: 'caldav-secret' },
    (line) => lines.push(line),
  );
  log('error', `request failed: Authorization: Bearer ${TOKEN}, password caldav-secret`);
  assertEquals(lines.length, 1);
  assertEquals(lines[0]!.includes(TOKEN), false);
  assertEquals(lines[0]!.includes('caldav-secret'), false);
  assertEquals(lines[0]!.startsWith('[ERROR] request failed'), true);
});

Deno.test('log lines below LOG_LEVEL are dropped', () => {
  const lines: string[] = [];
  const log = createLogger({ logLevel: 'warn', caldavPassword: 'p' }, (line) => lines.push(line));
  log('info', 'quiet');
  log('warn', 'loud');
  assertEquals(lines, ['[WARN] loud']);
});
