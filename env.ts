// ── Environment config with defaults ──

export interface Env {
  caldavUrl: string;
  caldavUsername: string;
  caldavPassword: string;
  port: number;
  mcpBearerToken?: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export function loadEnv(): Env {
  // Support both CALDAV_URL and CALDAV_SERVER_URL (homelab convention)
  const caldavUrl = Deno.env.get('CALDAV_URL') || Deno.env.get('CALDAV_SERVER_URL');
  if (!caldavUrl) {
    throw new Error('CALDAV_URL or CALDAV_SERVER_URL env var is required');
  }

  const caldavUsername = Deno.env.get('CALDAV_USERNAME');
  if (!caldavUsername) {
    throw new Error('CALDAV_USERNAME env var is required');
  }

  const caldavPassword = Deno.env.get('CALDAV_PASSWORD');
  if (!caldavPassword) {
    throw new Error('CALDAV_PASSWORD env var is required');
  }

  return {
    caldavUrl: caldavUrl.replace(/\/+$/, ''), // strip trailing slash
    caldavUsername,
    caldavPassword,
    port: parseInt(Deno.env.get('PORT') || '3000', 10),
    mcpBearerToken: Deno.env.get('MCP_BEARER_TOKEN'),
    logLevel: (Deno.env.get('LOG_LEVEL') as Env['logLevel']) || 'info',
  };
}
