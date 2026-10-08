// ── Environment config tests ──

import { loadEnv } from './env.ts';
import { assertEquals } from 'std/assert/mod.ts';

/** Run `fn` with the given env vars set (undefined = unset), restoring the old values after. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, Deno.env.get(k)]));
  const apply = (v: Record<string, string | undefined>) => {
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) Deno.env.delete(k);
      else Deno.env.set(k, val);
    }
  };
  apply(vars);
  try {
    fn();
  } finally {
    apply(saved);
  }
}

const BASE = {
  CALDAV_URL: 'https://cal.example.com/',
  CALDAV_SERVER_URL: undefined,
  CALDAV_USERNAME: 'user',
  CALDAV_PASSWORD: 'pass',
};

Deno.test('the HTTP host defaults to loopback', () => {
  withEnv({ ...BASE, HOST: undefined }, () => {
    assertEquals(loadEnv().host, '127.0.0.1');
  });
});

Deno.test('HOST overrides the HTTP host', () => {
  withEnv({ ...BASE, HOST: '0.0.0.0' }, () => {
    assertEquals(loadEnv().host, '0.0.0.0');
  });
});

Deno.test('an empty MCP_BEARER_TOKEN counts as unset', () => {
  withEnv({ ...BASE, MCP_BEARER_TOKEN: '' }, () => {
    assertEquals(loadEnv().mcpBearerToken, undefined);
  });
});
