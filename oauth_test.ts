// ── OAuth tests: the remote-connector flow, in process, against the fake CalDAV server ──

import { CONSENT_PAGE_LIMIT, createHttpHandler } from './main.ts';
import { McpHandler } from './mcp.ts';
import { type OAuthConfig, openOAuth } from './oauth.ts';
import { registerAllTools } from './tools/index.ts';
import { setup as caldavSetup } from './caldav/testing/fixtures.ts';
import { assert, assertEquals, assertMatch, assertRejects } from 'std/assert/mod.ts';
import { encodeBase64Url } from 'std/encoding/base64url.ts';
import { CLAUDE_REDIRECT_URI, OWNER_PASSWORD_FIELD } from '@spy4x/server/mcp-oauth';
import type { Fetcher } from '@spy4x/net/safe-fetch';
import type { DnsResolver } from '@spy4x/net/url-policy';
import { createPasswordHasher } from '@spy4x/server/sign-in';

const ORIGIN = 'https://mcp.example.com';
const RESOURCE = `${ORIGIN}/mcp`;
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;
const STATIC_TOKEN = 'static-test-token';
const PEPPER = 'test-pepper-'.padEnd(32, 'x');
const OWNER_PASSWORD = 'owner-test-password';
const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const EVIL_REDIRECT = 'https://attacker.example/callback';

/** Claude's metadata document lists its callback and, to prove the allowlist, one more. */
const CLIENT_DOCUMENT = {
  client_id: CLIENT_ID,
  client_name: 'Claude',
  redirect_uris: [CLAUDE_REDIRECT_URI, EVIL_REDIRECT],
  token_endpoint_auth_method: 'none',
};

/** The network as the client metadata fetcher sees it: Claude's document, and every URL asked. */
function fakeNetwork(): { fetcher: Fetcher; resolver: DnsResolver; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetcher: {
      fetch(input) {
        calls.push(input);
        const found = input === CLIENT_ID;
        return Promise.resolve(
          new Response(found ? JSON.stringify(CLIENT_DOCUMENT) : 'not found', {
            status: found ? 200 : 404,
            headers: { 'Content-Type': 'application/json' },
          }),
        );
      },
    },
    // example.com's address: public, so the SSRF guard lets the fake fetch through.
    resolver: { resolve: () => Promise.resolve(['93.184.216.34']) },
  };
}

// The minimum iteration count keeps each password check fast.
const OWNER_HASH = await createPasswordHasher({ pepper: PEPPER, iterations: 100_000 })
  .hash(OWNER_PASSWORD);

function config(kvPath: string): OAuthConfig {
  return { publicUrl: ORIGIN, ownerPasswordHash: OWNER_HASH, authPepper: PEPPER, kvPath };
}

/**
 * A handler with OAuth and the static token on, the real tools and the fake CalDAV server. The
 * OAuth store is an in-memory Deno KV unless `kvPath` names a file. Dispose of it to close the KV.
 */
async function setup(kvPath = ':memory:') {
  const network = fakeNetwork();
  const { oauth, close } = await openOAuth(config(kvPath), {
    fetcher: network.fetcher,
    resolver: network.resolver,
  });
  const mcp = new McpHandler({ name: 'test', version: '0.0.0' });
  registerAllTools(mcp, caldavSetup().engine);
  const logs: string[] = [];
  const handler = createHttpHandler(mcp, STATIC_TOKEN, (_level, msg) => logs.push(msg), { oauth });
  return { handler, logs, calls: network.calls, [Symbol.dispose]: close };
}

type Handler = Awaited<ReturnType<typeof setup>>['handler'];

function rpc(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(RESOURCE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** A form post as a browser sends it from a page on this server. */
function form(path: string, fields: Record<string, string>): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
    },
    body: new URLSearchParams(fields),
  });
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: encodeBase64Url(new Uint8Array(digest)) };
}

function authorizeUrl(
  challenge: string,
  redirectUri: string = CLAUDE_REDIRECT_URI,
  clientId = CLIENT_ID,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: RESOURCE,
    state: 'state-1',
  });
  return `${ORIGIN}/authorize?${params}`;
}

/** Open the consent page and return its HTML and the consent id in its form. */
async function openConsent(handler: Handler, challenge: string) {
  const res = await handler(new Request(authorizeUrl(challenge)));
  assertEquals(res.status, 200);
  const html = await res.text();
  const consentId = html.match(/name="consent_id" value="([^"]+)"/)?.[1];
  assert(consentId, 'the consent page has a consent_id');
  return { html, consentId };
}

const PING = { jsonrpc: '2.0', id: 1, method: 'ping' };

Deno.test('an MCP request without a token gets 401 pointing at the resource metadata', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const res = await handler(rpc(PING));
  await res.body?.cancel();
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${METADATA_URL}"`);
});

Deno.test('an MCP request with an unknown token gets 401 with invalid_token', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const res = await handler(rpc(PING, { 'Authorization': 'Bearer not-a-real-token' }));
  await res.body?.cancel();
  assertEquals(res.status, 401);
  assertEquals(
    res.headers.get('WWW-Authenticate'),
    `Bearer error="invalid_token", resource_metadata="${METADATA_URL}"`,
  );
});

Deno.test('the metadata documents name this server as resource and as authorization server', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const resource = await handler(new Request(METADATA_URL));
  assertEquals(resource.status, 200);
  assertEquals(await resource.json(), {
    resource: RESOURCE,
    authorization_servers: [ORIGIN],
    bearer_methods_supported: ['header'],
  });
  const server = await handler(new Request(`${ORIGIN}/.well-known/oauth-authorization-server`));
  assertEquals(server.status, 200);
  const doc = await server.json();
  assertEquals(doc.issuer, ORIGIN);
  assertEquals(doc.authorization_endpoint, `${ORIGIN}/authorize`);
  assertEquals(doc.token_endpoint, `${ORIGIN}/token`);
  assertEquals(doc.code_challenge_methods_supported, ['S256']);
});

Deno.test('a full code flow with PKCE and the owner password ends in a tool list and a CalDAV call', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const { verifier, challenge } = await pkce();

  const { html, consentId } = await openConsent(handler, challenge);
  assert(html.includes(`type="password" name="${OWNER_PASSWORD_FIELD}"`), 'password field');

  const approved = await handler(form('/authorize', {
    consent_id: consentId,
    decision: 'approve',
    [OWNER_PASSWORD_FIELD]: OWNER_PASSWORD,
  }));
  assertEquals(approved.status, 302);
  const location = new URL(approved.headers.get('Location')!);
  assertEquals(location.origin + location.pathname, CLAUDE_REDIRECT_URI);
  assertEquals(location.searchParams.get('state'), 'state-1');
  assertEquals(location.searchParams.get('iss'), ORIGIN);
  const code = location.searchParams.get('code');
  assert(code, 'the redirect carries a code');

  const tokenRes = await handler(form('/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE_REDIRECT_URI,
    client_id: CLIENT_ID,
    resource: RESOURCE,
  }));
  assertEquals(tokenRes.status, 200);
  const tokens = await tokenRes.json();
  assertEquals(tokens.token_type, 'Bearer');
  const auth = { 'Authorization': `Bearer ${tokens.access_token}` };

  const list = await handler(rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, auth));
  assertEquals(list.status, 200);
  const names = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  assert(names.includes('list_calendars'), `tools: ${names}`);

  const call = await handler(rpc({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'list_calendars', arguments: {} },
  }, auth));
  assertEquals(call.status, 200);
  assertMatch((await call.json()).result.content[0].text, /Inbox/);
});

Deno.test('a redirect URI outside the allowlist is refused before the consent page', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const { challenge } = await pkce();
  const res = await handler(new Request(authorizeUrl(challenge, EVIL_REDIRECT)));
  const body = await res.text();
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('Location'), null);
  assertEquals(body.includes('consent_id'), false);
});

Deno.test('a wrong or missing owner password at consent shows the page again and gives no code', async () => {
  using ctx = await setup();
  const { handler, logs } = ctx;
  const { challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const fields = { consent_id: consentId, decision: 'approve' };

  for (const [password, status] of [['wrong-password', 403], ['', 400]] as const) {
    const refused = await handler(
      form('/authorize', { ...fields, [OWNER_PASSWORD_FIELD]: password }),
    );
    assertEquals(refused.status, status);
    assertEquals(refused.headers.get('Location'), null);
    assert((await refused.text()).includes(`name="${OWNER_PASSWORD_FIELD}"`), 'page shown again');
  }
  assertEquals(logs.some((line) => line.includes('wrong-password')), false);

  const approved = await handler(
    form('/authorize', { ...fields, [OWNER_PASSWORD_FIELD]: OWNER_PASSWORD }),
  );
  await approved.body?.cancel();
  assertEquals(approved.status, 302);
  assert(new URL(approved.headers.get('Location')!).searchParams.has('code'));
});

Deno.test('denying consent needs no password and sends the client access_denied', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const { challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const res = await handler(form('/authorize', { consent_id: consentId, decision: 'deny' }));
  await res.body?.cancel();
  assertEquals(res.status, 302);
  const location = new URL(res.headers.get('Location')!);
  assertEquals(location.searchParams.get('error'), 'access_denied');
  assertEquals(location.searchParams.has('code'), false);
});

Deno.test('after 10 wrong owner passwords from any addresses, approvals get 429 even with the right one', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const { challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const wrong = { consent_id: consentId, decision: 'approve', [OWNER_PASSWORD_FIELD]: 'nope' };
  // Each guess from its own address, so no per-address limit is what stops them.
  const from = (i: number) => ({
    remoteAddr: { transport: 'tcp' as const, hostname: `203.0.113.${i + 1}`, port: 40000 },
  });
  for (let i = 0; i < 10; i++) {
    const res = await handler(form('/authorize', wrong), from(i));
    await res.body?.cancel();
    assertEquals(res.status, 403);
  }
  const blocked = await handler(
    form('/authorize', { ...wrong, [OWNER_PASSWORD_FIELD]: OWNER_PASSWORD }),
    from(10),
  );
  await blocked.body?.cancel();
  assertEquals(blocked.status, 429);
  assert(blocked.headers.has('Retry-After'));
});

Deno.test('the static MCP_BEARER_TOKEN still works with OAuth on', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const variants: Record<string, string>[] = [
    { 'Authorization': `Bearer ${STATIC_TOKEN}` },
    { 'X-Api-Key': STATIC_TOKEN },
  ];
  for (const headers of variants) {
    const res = await handler(rpc(PING, headers));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
  }
});

Deno.test('a client_id outside claude.ai gets 400 and nothing is fetched', async () => {
  using ctx = await setup();
  const { handler, calls } = ctx;
  const { challenge } = await pkce();
  const url = authorizeUrl(challenge, CLAUDE_REDIRECT_URI, 'https://attacker.example/client');
  const res = await handler(new Request(url));
  const body = await res.text();
  assertEquals(res.status, 400);
  assertEquals(body.includes('consent_id'), false);
  assertEquals(calls, []);
});

Deno.test('opening consent pages is limited per client, tighter than other requests', async () => {
  using ctx = await setup();
  const { handler } = ctx;
  const { challenge } = await pkce();
  for (let i = 0; i < CONSENT_PAGE_LIMIT; i++) {
    const res = await handler(new Request(authorizeUrl(challenge)));
    await res.body?.cancel();
    assertEquals(res.status, 200);
  }
  const blocked = await handler(new Request(authorizeUrl(challenge)));
  await blocked.body?.cancel();
  assertEquals(blocked.status, 429);
  assert(blocked.headers.has('Retry-After'));
  // Other requests from the same client still go through.
  const ping = await handler(rpc(PING, { 'Authorization': `Bearer ${STATIC_TOKEN}` }));
  await ping.body?.cancel();
  assertEquals(ping.status, 200);
});

/** Sign in through consent and the token endpoint; returns the access token. */
async function signIn(handler: Handler): Promise<string> {
  const { verifier, challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const approved = await handler(form('/authorize', {
    consent_id: consentId,
    decision: 'approve',
    [OWNER_PASSWORD_FIELD]: OWNER_PASSWORD,
  }));
  await approved.body?.cancel();
  const code = new URL(approved.headers.get('Location')!).searchParams.get('code');
  assert(code, 'the redirect carries a code');
  const res = await handler(form('/token', {
    grant_type: 'authorization_code',
    code,
    code_verifier: verifier,
    redirect_uri: CLAUDE_REDIRECT_URI,
    client_id: CLIENT_ID,
    resource: RESOURCE,
  }));
  assertEquals(res.status, 200);
  return (await res.json()).access_token;
}

Deno.test('a token issued before a restart still works after it', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const kvPath = `${dir}/oauth.kv`;
    let token: string;
    {
      using before = await setup(kvPath);
      token = await signIn(before.handler);
    }
    using after = await setup(kvPath);
    const res = await after.handler(rpc(PING, { 'Authorization': `Bearer ${token}` }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { jsonrpc: '2.0', id: 1, result: {} });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('an OAuth store path that cannot be opened stops startup, naming the path', async () => {
  const dir = await Deno.makeTempDir();
  try {
    const path = `${dir}/missing-directory/oauth.kv`;
    await assertRejects(() => openOAuth(config(path)), Error, `${path} (OAUTH_KV_PATH)`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
