// ── caldav-mcp: CalDAV MCP Server ──
// Entry point. Parses args, initializes engine, starts stdio or HTTP transport.

import { loadEnv } from './env.ts';
import { CalDavClient } from './caldav/client.ts';
import { QueryEngine } from './caldav/query.ts';
import { McpHandler } from './mcp.ts';
import { registerAllTools } from './tools/index.ts';

const VERSION = '0.1.0';

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
function startHttp(
  mcp: McpHandler,
  env: { port: number; mcpBearerToken?: string },
  log: (level: string, msg: string) => void,
): void {
  const port = env.port;
  log('info', `Starting HTTP transport on port ${port}...`);

  // Rate limiting state
  const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
  const RATE_LIMIT = 100; // requests per minute

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Health check — no auth required
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', version: VERSION }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Auth check (only for MCP routes)
    // Accepts token from multiple sources:
    //   - Authorization: Bearer <token>
    //   - Authorization: <token>
    //   - X-Api-Key: <token>
    //   - ?api_key=<token>  (query param)
    if (env.mcpBearerToken) {
      const authHeader = req.headers.get('Authorization') || '';
      const apiKeyHeader = req.headers.get('X-Api-Key') || '';
      const queryToken = url.searchParams.get('api_key') || '';
      const valid = authHeader === `Bearer ${env.mcpBearerToken}` ||
        authHeader === env.mcpBearerToken ||
        apiKeyHeader === env.mcpBearerToken ||
        queryToken === env.mcpBearerToken;
      if (!valid) {
        log(
          'debug',
          `Auth failed: Authorization="${authHeader}" X-Api-Key="${apiKeyHeader}" query="${queryToken}"`,
        );
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Rate limiting
    const ip = req.headers.get('x-forwarded-for') || 'unknown';
    const now = Date.now();
    let rl = rateLimitMap.get(ip);
    if (!rl || now > rl.resetAt) {
      rl = { count: 0, resetAt: now + 60000 };
      rateLimitMap.set(ip, rl);
    }
    rl.count++;
    if (rl.count > RATE_LIMIT) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      });
    }

    // Routes
    if (url.pathname === '/mcp' && req.method === 'POST') {
      return await handleMcpPost(req, mcp);
    }

    // SSE endpoint for MCP-over-SSE
    if (url.pathname === '/mcp' && req.method === 'GET') {
      return handleMcpSse(req, mcp);
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  Deno.serve({ port }, handler);
  log('info', `HTTP server listening on :${port}`);
}

async function handleMcpPost(req: Request, mcp: McpHandler): Promise<Response> {
  try {
    const body = await req.text();
    const response = await mcp.handleMessage(body);
    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (_err) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

function handleMcpSse(_req: Request, _mcp: McpHandler): Response {
  // MCP SSE transport: tells OpenWebUI where to POST JSON-RPC messages.
  // The POST handler at /mcp returns JSON-RPC responses directly.
  // Using ReadableStream with immediate flushing for Deno.serve compatibility.
  let resolveStart: (() => void) | undefined;
  const startPromise = new Promise<void>((r) => {
    resolveStart = r;
  });

  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      // Flush endpoint event immediately
      controller.enqueue(encoder.encode('event: endpoint\ndata: /mcp\n\n'));
      resolveStart?.();
    },
    cancel() {
      // Client disconnected
    },
  });

  // Ensure the stream starts immediately by awaiting the start promise
  // This forces Deno.serve to begin streaming the response
  (async () => {
    await startPromise;
  })();

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

// ── Entry ──
if (import.meta.main) {
  main().catch((err) => {
    console.error('Fatal:', err);
    Deno.exit(1);
  });
}
