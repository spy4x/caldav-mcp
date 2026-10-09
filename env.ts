// ── Environment config with defaults ──

import { type EnvReader, readEnvVar, systemEnv } from 'jsr:@spy4x/server@1.37.0/config';

const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export interface Env {
  caldavUrl: string;
  caldavUsername: string;
  caldavPassword: string;
  /** Interface the HTTP transport binds to. Loopback unless `HOST` says otherwise. */
  host: string;
  port: number;
  mcpBearerToken?: string;
  logLevel: typeof LOG_LEVELS[number];
  /**
   * Whether a reverse proxy sits in front of the HTTP transport. Only then does the rate limiter
   * key clients by `X-Forwarded-For`; otherwise any client could forge that header.
   */
  trustProxy: boolean;
}

/**
 * Read the configuration once at startup. Blank values count as unset. Throws on a missing
 * required value or on a `PORT`, `LOG_LEVEL` or `TRUST_PROXY` it cannot use, naming the variable
 * but never echoing its value.
 */
export function loadEnv(env: EnvReader = systemEnv): Env {
  // Support both CALDAV_URL and CALDAV_SERVER_URL (homelab convention)
  const caldavUrl = env.get('CALDAV_URL') ?? env.get('CALDAV_SERVER_URL');
  if (!caldavUrl) {
    throw new Error('CALDAV_URL or CALDAV_SERVER_URL env var is required');
  }

  const optional = (name: string) => readEnvVar(env, name, { optional: true });

  return {
    caldavUrl: caldavUrl.replace(/\/+$/, ''), // strip trailing slash
    caldavUsername: readEnvVar(env, 'CALDAV_USERNAME'),
    caldavPassword: readEnvVar(env, 'CALDAV_PASSWORD'),
    host: optional('HOST') || '127.0.0.1',
    port: parsePort(optional('PORT') || '3000'),
    mcpBearerToken: optional('MCP_BEARER_TOKEN') || undefined,
    logLevel: parseLogLevel(optional('LOG_LEVEL') || 'info'),
    trustProxy: parseBoolean('TRUST_PROXY', optional('TRUST_PROXY') || 'false'),
  };
}

function parsePort(raw: string): number {
  const port = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(port >= 1 && port <= 65535)) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return port;
}

function parseLogLevel(raw: string): Env['logLevel'] {
  const level = LOG_LEVELS.find((l) => l === raw);
  if (!level) throw new Error(`LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  return level;
}

function parseBoolean(name: string, raw: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be "true" or "false"`);
}
