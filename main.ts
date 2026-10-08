// ── caldav-mcp: CalDAV MCP Server ──
// Entry point. Parses args, initializes engine, starts stdio or HTTP transport.

import { type Env, loadEnv } from './env.ts';
import { CalDavClient } from './caldav/client.ts';
import { QueryEngine } from './caldav/query.ts';
import { McpHandler } from './mcp.ts';
import { registerAllTools } from './tools/index.ts';
import { timingSafeEqual } from 'std/crypto/timing_safe_equal.ts';

export const VERSION = '0.1.0';

async function main(): Promise<void> {
  const env = loadEnv();
  const log = (level: string, msg: string) => {
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) >= levels.indexOf(env.logLevel)) {
      console.error(`[${level.toUpperCase()}] ${msg}`);
    }
  };

  log('info', `caldav-mcp v${VERSION} starting...`);
  log('info', `CalDAV server: ${env.caldavUrl}`);

  // Initialize
  const client = new CalDavClient({ env });
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

type Log = (level: string, msg: string) => void;

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
  Deno.serve({ hostname, port }, createHttpHandler(mcp, token, log));
  log('info', `HTTP server listening on ${hostname}:${port}`);
}

/**
 * Build the HTTP request handler. `/health` is open; `/mcp` needs the token as
 * `Authorization: Bearer <token>`, a bare `Authorization: <token>` or `X-Api-Key: <token>`.
 * Tokens in the query string are refused: URLs end up in proxy and access logs.
 */
export function createHttpHandler(
  mcp: McpHandler,
  token: string,
  log: Log,
): (req: Request) => Promise<Response> {
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT = 100; // requests per minute

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: VERSION });
    }

    if (!(await isAuthorized(req, token))) {
      // Never log what the client sent: a near-miss token is still a secret.
      log('debug', `Auth failed for ${req.method} ${url.pathname}`);
      return json({ error: 'Unauthorized' }, 401);
    }

    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();
    let rl = rateLimitMap.get(ip);
    if (!rl || now > rl.resetAt) {
      rl = { count: 0, resetAt: now + 60000 };
      rateLimitMap.set(ip, rl);
    }
    rl.count++;
    if (rl.count > RATE_LIMIT) {
      return json({ error: 'Rate limit exceeded' }, 429, { 'Retry-After': '60' });
    }

    if (url.pathname === '/mcp') {
      if (req.method === 'POST') return await handleMcpPost(req, mcp);
      return json({ error: 'Method not allowed' }, 405, { 'Allow': 'POST' });
    }

    return json({ error: 'Not found' }, 404);
  };
}

async function isAuthorized(req: Request, token: string): Promise<boolean> {
  const auth = req.headers.get('Authorization');
  const candidates = [
    auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : auth,
    req.headers.get('X-Api-Key'),
  ];
  for (const candidate of candidates) {
    if (candidate && await tokensEqual(candidate, token)) return true;
  }
  return false;
}

/** Compare SHA-256 digests in constant time, so neither content nor length leaks by timing. */
async function tokensEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  return timingSafeEqual(da, db);
}

async function handleMcpPost(req: Request, mcp: McpHandler): Promise<Response> {
  const response = await mcp.handleMessage(await req.text());
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
