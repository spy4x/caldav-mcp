// ── Tool tests through the MCP handler ──

import { assert, assertEquals } from 'std/assert/mod.ts';
import { McpHandler } from '../mcp.ts';
import { registerAllTools } from './index.ts';
import { ORIGIN } from '../caldav/testing/fake_caldav.ts';
import {
  setup,
  TASKS_ORG_ETAG,
  TASKS_ORG_PATH,
  ZONED_ETAG,
  ZONED_PATH,
} from '../caldav/testing/fixtures.ts';

const url = (path: string) => `${ORIGIN}${path}`;

function server() {
  const { fake, engine } = setup();
  const mcp = new McpHandler({ name: 'test', version: '0.0.0' });
  registerAllTools(mcp, engine);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await mcp.handleRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    });
    const result = response!.result as { content: { text: string }[]; isError?: true };
    let body: unknown;
    try {
      body = JSON.parse(result.content[0]!.text);
    } catch {
      body = result.content[0]!.text;
    }
    return { isError: result.isError === true, body: body as Record<string, unknown> };
  };
  return { fake, mcp, call };
}

Deno.test('a stale etag is an isError result with code Conflict', async () => {
  const { call } = server();
  const result = await call('update_todo', {
    url: url(TASKS_ORG_PATH),
    etag: '"stale"',
    summary: 'x',
  });
  assertEquals(result.isError, true);
  assertEquals(result.body['code'], 'Conflict');
});

Deno.test('a malformed due date is an isError result and nothing is written', async () => {
  const { call, fake } = server();
  const result = await call('update_todo', {
    url: url(TASKS_ORG_PATH),
    etag: TASKS_ORG_ETAG,
    due: 'tomorrow',
  });
  assertEquals(result.isError, true);
  assertEquals(fake.requests.filter((r) => r.method === 'PUT'), []);
});

Deno.test('null clears a field through update_todo', async () => {
  const { call } = server();
  const result = await call('update_todo', { url: url(ZONED_PATH), etag: ZONED_ETAG, due: null });
  assertEquals(result.isError, false);
  assertEquals((result.body['todo'] as Record<string, unknown>)['due'], undefined);
});

Deno.test('a date-only due date set through create_todo stays date-only', async () => {
  const { call, fake } = server();
  const created = await call('create_todo', {
    calendarUrl: url('/dav/cal/user%40example.com/tasks/'),
    summary: 'Pay rent',
    due: '2026-11-01',
  });
  assertEquals(created.isError, false);
  const data = fake.objects.get(new URL(created.body['url'] as string).pathname)!.data;
  assert(data.includes('\r\nDUE;VALUE=DATE:20261101\r\n'), data);
});

Deno.test('every schema that takes an etag says where it comes from', async () => {
  const { mcp } = server();
  const listed = await mcp.handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const tools = (listed!.result as {
    tools: {
      name: string;
      inputSchema: { properties?: Record<string, { description?: string }> };
    }[];
  }).tools;
  const withEtag = tools.filter((t) => t.inputSchema.properties?.['etag']);
  assertEquals(withEtag.map((t) => t.name).sort(), [
    'delete_event',
    'delete_todo',
    'update_event',
    'update_todo',
  ]);
  for (const tool of withEtag) {
    assert(/exactly as (query|get)_/.test(tool.inputSchema.properties!['etag']!.description!));
  }
});
