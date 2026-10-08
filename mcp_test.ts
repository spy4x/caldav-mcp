// ── MCP protocol handler tests ──

import { McpHandler, SUPPORTED_PROTOCOL_VERSIONS } from './mcp.ts';
import { assertEquals } from 'std/assert/mod.ts';

function handlerWithTools(): McpHandler {
  const mcp = new McpHandler({ name: 'test', version: '0.0.0' });
  const schema = { type: 'object' as const };
  mcp.registerTool(
    { name: 'ok', description: '', inputSchema: schema },
    () => Promise.resolve({ value: 1 }),
  );
  mcp.registerTool(
    { name: 'throws', description: '', inputSchema: schema },
    () => Promise.reject(new Error('server said 412')),
  );
  mcp.registerTool(
    { name: 'fails', description: '', inputSchema: schema },
    () => Promise.resolve({ error: 'Todo not found' }),
  );
  return mcp;
}

function send(mcp: McpHandler, msg: unknown) {
  return mcp.handleMessage(JSON.stringify(msg));
}

Deno.test('initialize echoes each protocol version it supports', async () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    const res = await send(handlerWithTools(), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: version },
    });
    assertEquals((res?.result as { protocolVersion: string }).protocolVersion, version);
  }
});

Deno.test('initialize answers the newest version when the requested one is unknown', async () => {
  const res = await send(handlerWithTools(), {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '1999-01-01' },
  });
  assertEquals((res?.result as { protocolVersion: string }).protocolVersion, '2025-06-18');
});

Deno.test('notifications get no response, even unknown ones', async () => {
  const mcp = handlerWithTools();
  assertEquals(await send(mcp, { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  assertEquals(await send(mcp, { jsonrpc: '2.0', method: 'notifications/whatever' }), null);
  assertEquals(mcp.isInitialized(), true);
});

Deno.test('ping answers an empty result', async () => {
  const res = await send(handlerWithTools(), { jsonrpc: '2.0', id: 'p', method: 'ping' });
  assertEquals(res, { jsonrpc: '2.0', id: 'p', result: {} });
});

Deno.test('a tool that throws returns an isError result with the message', async () => {
  const res = await send(handlerWithTools(), {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'throws', arguments: {} },
  });
  assertEquals(res, {
    jsonrpc: '2.0',
    id: 2,
    result: { content: [{ type: 'text', text: 'server said 412' }], isError: true },
  });
});

Deno.test('a tool that returns an error object is marked isError', async () => {
  const res = await send(handlerWithTools(), {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'fails' },
  });
  assertEquals((res?.result as { isError?: boolean }).isError, true);
});

Deno.test('a successful tool result carries no isError flag', async () => {
  const res = await send(handlerWithTools(), {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'ok' },
  });
  assertEquals(res?.result, { content: [{ type: 'text', text: '{"value":1}' }] });
});

Deno.test('a batch array is rejected as an invalid request', async () => {
  const res = await send(handlerWithTools(), [{ jsonrpc: '2.0', id: 1, method: 'ping' }]);
  assertEquals(res?.error?.code, -32600);
});
