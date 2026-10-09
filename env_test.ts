// ── Environment config tests ──

import { loadEnv } from './env.ts';
import { createEnvReader } from '@spy4x/server/config/env';
import { assertEquals, assertThrows } from 'std/assert/mod.ts';

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

/** `loadEnv` over a fixed record on top of the required CalDAV settings. */
function load(vars: Record<string, string | undefined>) {
  return loadEnv(createEnvReader({ ...BASE, ...vars }));
}

Deno.test('PORT must be a whole number from 1 to 65535', () => {
  assertEquals(load({ PORT: '8080' }).port, 8080);
  assertEquals(load({}).port, 3000);
  for (const bad of ['abc', '3000abc', '0', '65536', '-1', '1e3']) {
    assertThrows(() => load({ PORT: bad }), Error, 'PORT');
  }
});

Deno.test('LOG_LEVEL must be a known level', () => {
  assertEquals(load({}).logLevel, 'info');
  assertEquals(load({ LOG_LEVEL: 'debug' }).logLevel, 'debug');
  assertThrows(() => load({ LOG_LEVEL: 'verbose' }), Error, 'LOG_LEVEL');
});

Deno.test('TRUSTED_PROXIES is a comma-separated CIDR list, empty by default', () => {
  assertEquals(load({}).trustedProxies, []);
  assertEquals(load({ TRUSTED_PROXIES: '172.16.0.0/12, 10.0.0.1/32,' }).trustedProxies, [
    '172.16.0.0/12',
    '10.0.0.1/32',
  ]);
  assertThrows(() => load({ TRUSTED_PROXIES: 'true' }), Error, 'TRUSTED_PROXIES');
  assertThrows(() => load({ TRUSTED_PROXIES: '10.0.0.0/33' }), Error, 'TRUSTED_PROXIES');
});

Deno.test('a missing CalDAV password stops startup', () => {
  assertThrows(() => load({ CALDAV_PASSWORD: undefined }), Error, 'CALDAV_PASSWORD');
});
