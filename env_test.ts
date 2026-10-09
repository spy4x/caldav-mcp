// ── Environment config tests ──

import { loadEnv } from './env.ts';
import { createEnvReader } from 'jsr:@spy4x/server@1.37.0/config';
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

Deno.test('X-Forwarded-For is trusted only when TRUST_PROXY is "true"', () => {
  assertEquals(load({}).trustProxy, false);
  assertEquals(load({ TRUST_PROXY: 'true' }).trustProxy, true);
  assertEquals(load({ TRUST_PROXY: 'false' }).trustProxy, false);
  assertThrows(() => load({ TRUST_PROXY: 'yes' }), Error, 'TRUST_PROXY');
});

Deno.test('a missing CalDAV password stops startup', () => {
  assertThrows(() => load({ CALDAV_PASSWORD: undefined }), Error, 'CALDAV_PASSWORD');
});
