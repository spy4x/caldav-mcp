// ── caldav-mcp: CalDAV MCP Server ──
// Entry point. Parses args, initializes engine, starts stdio or HTTP transport.

import { type Env, loadEnv } from './env.ts';
import { createCalDavClient } from '@spy4x/caldav';
import { QueryEngine } from './caldav/query.ts';
import { McpHandler } from './mcp.ts';
import { registerAllTools } from './tools/index.ts';
import {
  bearerTokenFromHeaders,
  createTokenVerifier,
  formatLogLine,
} from '@spy4x/server/http/bearer-auth';
import { createMemoryRateLimiter } from '@spy4x/platform/rate-limit/memory';
import { clientIp, clientIpBucket } from '@spy4x/platform/rate-limit/client-ip';
import {
  BodyReadTimeoutError,
  PayloadTooLargeError,
  readBoundedText,
} from '@spy4x/net/bounded-body';

export const VERSION = '0.1.0';

async function main(): Promise<void> {
  const env = loadEnv();
  const log = createLogger(env, (line) => console.error(line));

  log('info', `caldav-mcp v${VERSION} starting...`);
  log('info', `CalDAV server: ${env.caldavUrl}`);

  // Initialize
  const client = createCalDavClient({
    serverUrl: env.caldavUrl,
    auth: { username: env.caldavUsername, password: env.caldavPassword },
  });
  const engine = new QueryEngine(client);

  const mcp = new McpHandler({ name: 'caldav-mcp', version: VERSION });
  registerAllTools(mcp, engine);

  // Determine transport
  const args = Deno.args;
  const useHttp = args.includes('--http') || args.includes('-h') ||
    !!Deno.env.get('MCP_BEARER_TOKEN');

  if (useHttp) {
    await startHttp(mcp, env, log);
  } else {
    await startStdio(mcp, log);
  }
}

type Log = (level: string, msg: string) => void;

/**
 * Build the logger: drops lines below `LOG_LEVEL` and redacts the bearer token and the CalDAV
 * password from every line it writes, so no code path can log either by accident.
 */
export function createLogger(
  env: Pick<Env, 'logLevel' | 'mcpBearerToken' | 'caldavPassword'>,
  write: (line: string) => void,
): Log {
  const levels = ['debug', 'info', 'warn', 'error'];
  const secrets = [env.mcpBearerToken, env.caldavPassword];
  return (level, msg) => {
    if (levels.indexOf(level) >= levels.indexOf(env.logLevel)) {
      write(formatLogLine(level, msg, secrets));
    }
  };
}

// ── stdio transport (default) ──
async function startStdio(
  mcp: McpHandler,
  log: (level: string, msg: string) => void,
): Promise<void> {
  log('info', 'Starting stdio transport...');
  log('info', 'Ready — waiting for MCP messages on stdin');

  const decoder = new TextDecoder();
  const buf = new Uint8Array(65536);
  let buffer = '';

  // Read stdin continuously
  while (true) {
    const n = Deno.stdin.readSync(buf);
    if (n === null) break; // EOF
    buffer += decoder.decode(buf.subarray(0, n), { stream: true });

    // Process complete messages (newline-delimited JSON)
    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx).trim();
      buffer = buffer.slice(newlineIdx + 1);

      if (!line) continue;

      try {
        const response = await mcp.handleMessage(line);
        if (response) {
          const out = JSON.stringify(response) + '\n';
          Deno.stdout.writeSync(new TextEncoder().encode(out));
        }
      } catch (err) {
        log('error', `Failed to handle message: ${err}`);
      }
    }
  }
}

// ── HTTP transport (optional, for OpenWebUI/n8n via mcpo) ──

/** Requests each client may make per minute. */
const RATE_LIMIT = 100;
/** Wrong tokens each client may send per minute before it gets 429. */
export const AUTH_FAILURE_LIMIT = 10;
/** Most clients the limiter tracks at once, so a flood of addresses cannot grow memory unbounded. */
const RATE_LIMIT_MAX_CLIENTS = 10_000;
/** Largest `POST /mcp` body accepted. One JSON-RPC message is a few kilobytes at most. */
export const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Where the HTTP transport listens. Refuses to start without `MCP_BEARER_TOKEN`, because the
 * server holds CalDAV credentials and an open port would hand them to anyone who can reach it.
 */
export function httpListenOptions(
  env: Pick<Env, 'host' | 'port' | 'mcpBearerToken'>,
): { hostname: string; port: number; token: string } {
  if (!env.mcpBearerToken) {
    throw new Error('MCP_BEARER_TOKEN env var is required for HTTP mode');
  }
  return { hostname: env.host, port: env.port, token: env.mcpBearerToken };
}

function startHttp(mcp: McpHandler, env: Env, log: Log): void {
  const { hostname, port, token } = httpListenOptions(env);
  log('info', `Starting HTTP transport on ${hostname}:${port}...`);
  Deno.serve(
    { hostname, port },
    createHttpHandler(mcp, token, log, { trustedProxies: env.trustedProxies }),
  );
  log('info', `HTTP server listening on ${hostname}:${port}`);
}

/** The part of `Deno.ServeHandlerInfo` the handler reads. */
interface PeerInfo {
  remoteAddr?: Deno.Addr;
}

/**
 * Build the HTTP request handler. `/health` is open; `/mcp` needs the token as
 * `Authorization: Bearer <token>`, a bare `Authorization: <token>` or `X-Api-Key: <token>`.
 * Tokens in the query string are refused: URLs end up in proxy and access logs.
 *
 * Clients are rate limited per IP address: the peer address, or the first `X-Forwarded-For` hop
 * when the peer is one of `trustedProxies`. Each client gets `AUTH_FAILURE_LIMIT` wrong tokens a
 * minute, checked before the token comparison, and `RATE_LIMIT` authorized requests a minute.
 */
export function createHttpHandler(
  mcp: McpHandler,
  token: string,
  log: Log,
  options: { trustedProxies?: readonly string[] } = {},
): (req: Request, info?: PeerInfo) => Promise<Response> {
  const verifier = createTokenVerifier(token);
  const window = { windowMs: 60_000, maxBuckets: RATE_LIMIT_MAX_CLIENTS };
  const limiter = createMemoryRateLimiter({ ...window, limit: RATE_LIMIT });
  // Counts every attempt, then gives the slot back when the token was right: only failures stay.
  const authFailures = createMemoryRateLimiter({ ...window, limit: AUTH_FAILURE_LIMIT });
  const ipOptions = { trustedProxies: options.trustedProxies ?? [] };

  return async (req: Request, info?: PeerInfo): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: VERSION });
    }

    const addr = info?.remoteAddr;
    const peer = addr && 'hostname' in addr ? addr.hostname : undefined;
    const client = clientIpBucket(clientIp(req, peer, 'x-forwarded-for', ipOptions));

    // Reserve, verify and refund with no await between them, so parallel right-token requests
    // never hold a reserved slot at the same time and cannot exhaust the wrong-token budget.
    const attempt = authFailures.check(client);
    if (!attempt.allowed) return tooManyRequests(attempt.retryAfterMs);
    if (!isAuthorized(req, verifier)) {
      // Never log what the client sent: a near-miss token is still a secret.
      log('debug', `Auth failed for ${req.method} ${url.pathname}`);
      return json({ error: 'Unauthorized' }, 401);
    }
    authFailures.refund(client, attempt.at);

    const decision = limiter.check(client);
    if (!decision.allowed) return tooManyRequests(decision.retryAfterMs);

    if (url.pathname === '/mcp') {
      if (req.method === 'POST') return await handleMcpPost(req, mcp);
      return json({ error: 'Method not allowed' }, 405, { 'Allow': 'POST' });
    }

    return json({ error: 'Not found' }, 404);
  };
}

function tooManyRequests(retryAfterMs: number): Response {
  const retryAfter = String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
  return json({ error: 'Rate limit exceeded' }, 429, { 'Retry-After': retryAfter });
}

/** Check the `Authorization` header, then `X-Api-Key`, through the constant-time verifier. */
function isAuthorized(req: Request, verifier: ReturnType<typeof createTokenVerifier>): boolean {
  const candidates = [bearerTokenFromHeaders(req.headers), req.headers.get('X-Api-Key')];
  return candidates.some((candidate) => !!candidate && verifier.verifySync(candidate));
}

async function handleMcpPost(req: Request, mcp: McpHandler): Promise<Response> {
  let body: string;
  try {
    body = await readBoundedText(req, { maxBytes: MAX_BODY_BYTES });
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return json({ error: 'Payload too large' }, 413);
    if (err instanceof BodyReadTimeoutError) return json({ error: 'Request timeout' }, 408);
    throw err;
  }
  const response = await mcp.handleMessage(body);
  // A notification has no response: acknowledge it without a body.
  if (!response) return new Response(null, { status: 202 });
  return json(response);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

// ── Entry ──
if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal:', err);
    Deno.exit(1);
  });
}
