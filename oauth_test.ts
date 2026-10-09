// ── OAuth tests: the remote-connector flow, in process, against the fake CalDAV server ──

import { AUTH_FAILURE_LIMIT, createHttpHandler } from './main.ts';
import { McpHandler } from './mcp.ts';
import { createOAuth, OWNER_PASSWORD_FIELD } from './oauth.ts';
import { registerAllTools } from './tools/index.ts';
import { setup as caldavSetup } from './caldav/testing/fixtures.ts';
import { assert, assertEquals, assertMatch } from 'std/assert/mod.ts';
import { encodeBase64Url } from 'std/encoding/base64url.ts';
import { CLAUDE_REDIRECT_URI, type ClientMetadataSource } from '@spy4x/server/mcp-oauth';
import { createPasswordHasher } from '@spy4x/server/sign-in';

const ORIGIN = 'https://mcp.example.com';
const RESOURCE = `${ORIGIN}/mcp`;
const METADATA_URL = `${ORIGIN}/.well-known/oauth-protected-resource/mcp`;
const STATIC_TOKEN = 'static-test-token';
const PEPPER = 'test-pepper-'.padEnd(32, 'x');
const OWNER_PASSWORD = 'owner-test-password';
const CLIENT_ID = 'https://claude.ai/oauth/mcp-oauth-client-metadata';
const EVIL_REDIRECT = 'https://attacker.example/callback';

/** The client registry: Claude's document lists its callback and, to prove the allowlist, one more. */
const clients: ClientMetadataSource = {
  load: (clientId) =>
    Promise.resolve(
      clientId === CLIENT_ID
        ? { clientId, clientName: 'Claude', redirectUris: [CLAUDE_REDIRECT_URI, EVIL_REDIRECT] }
        : undefined,
    ),
};

/** A handler with OAuth and the static token on, the real tools, and the fake CalDAV server. */
async function setup() {
  // The minimum iteration count keeps each password check fast.
  const hash = await createPasswordHasher({ pepper: PEPPER, iterations: 100_000 })
    .hash(OWNER_PASSWORD);
  const oauth = createOAuth(
    { publicUrl: ORIGIN, ownerPasswordHash: hash, authPepper: PEPPER },
    { clients },
  );
  const mcp = new McpHandler({ name: 'test', version: '0.0.0' });
  registerAllTools(mcp, caldavSetup().engine);
  const logs: string[] = [];
  const handler = createHttpHandler(mcp, STATIC_TOKEN, (_level, msg) => logs.push(msg), { oauth });
  return { handler, logs };
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

function authorizeUrl(challenge: string, redirectUri: string = CLAUDE_REDIRECT_URI): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
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
  const { handler } = await setup();
  const res = await handler(rpc(PING));
  await res.body?.cancel();
  assertEquals(res.status, 401);
  assertEquals(res.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${METADATA_URL}"`);
});

Deno.test('an MCP request with an unknown token gets 401 with invalid_token', async () => {
  const { handler } = await setup();
  const res = await handler(rpc(PING, { 'Authorization': 'Bearer not-a-real-token' }));
  await res.body?.cancel();
  assertEquals(res.status, 401);
  assertEquals(
    res.headers.get('WWW-Authenticate'),
    `Bearer error="invalid_token", resource_metadata="${METADATA_URL}"`,
  );
});

Deno.test('the metadata documents name this server as resource and as authorization server', async () => {
  const { handler } = await setup();
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
  const { handler } = await setup();
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
  const { handler } = await setup();
  const { challenge } = await pkce();
  const res = await handler(new Request(authorizeUrl(challenge, EVIL_REDIRECT)));
  const body = await res.text();
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('Location'), null);
  assertEquals(body.includes('consent_id'), false);
});

Deno.test('a wrong owner password at consent gets 403 and no code; the right one then works', async () => {
  const { handler, logs } = await setup();
  const { challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const fields = { consent_id: consentId, decision: 'approve' };

  for (const password of ['wrong-password', '']) {
    const refused = await handler(
      form('/authorize', { ...fields, [OWNER_PASSWORD_FIELD]: password }),
    );
    await refused.body?.cancel();
    assertEquals(refused.status, 403);
    assertEquals(refused.headers.get('Location'), null);
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
  const { handler } = await setup();
  const { challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const res = await handler(form('/authorize', { consent_id: consentId, decision: 'deny' }));
  await res.body?.cancel();
  assertEquals(res.status, 302);
  const location = new URL(res.headers.get('Location')!);
  assertEquals(location.searchParams.get('error'), 'access_denied');
  assertEquals(location.searchParams.has('code'), false);
});

Deno.test('wrong owner passwords count toward the failed-login limit', async () => {
  const { handler } = await setup();
  const { challenge } = await pkce();
  const { consentId } = await openConsent(handler, challenge);
  const wrong = { consent_id: consentId, decision: 'approve', [OWNER_PASSWORD_FIELD]: 'nope' };
  for (let i = 0; i < AUTH_FAILURE_LIMIT; i++) {
    const res = await handler(form('/authorize', wrong));
    await res.body?.cancel();
    assertEquals(res.status, 403);
  }
  const blocked = await handler(
    form('/authorize', { ...wrong, [OWNER_PASSWORD_FIELD]: OWNER_PASSWORD }),
  );
  await blocked.body?.cancel();
  assertEquals(blocked.status, 429);
});

Deno.test('the static MCP_BEARER_TOKEN still works with OAuth on', async () => {
  const { handler } = await setup();
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
