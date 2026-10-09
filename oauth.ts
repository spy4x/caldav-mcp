// ── OAuth for remote connectors (claude.ai, the Claude apps, Claude Code) ──
// The authorization server and the resource-server guard come from @spy4x/server/mcp-oauth; this
// module wires them to one owner password and to plain `Request`/`Response` handlers.

import { Hono } from 'hono';
import {
  AUTHORIZATION_SERVER_METADATA_PATH,
  AUTHORIZE_PATH,
  type ClientMetadataSource,
  createAuthorizationServer,
  createResourceServer,
  defaultConsentPage,
  type OAuthStore,
  TOKEN_PATH,
} from '@spy4x/server/mcp-oauth';
import { MemoryOAuthStore } from '@spy4x/server/mcp-oauth/memory-store';
import { createPasswordHasher } from '@spy4x/server/sign-in';
import { parseBoundedFormData } from '@spy4x/net/bounded-body';

/** The path the MCP endpoint is served at; the OAuth resource is `PUBLIC_URL` plus this path. */
export const MCP_PATH = '/mcp';

/** Name of the password field the consent page adds to the library's default page. */
export const OWNER_PASSWORD_FIELD = 'owner_password';

/** The consent form is small; anything larger is refused before the password is read. */
const MAX_CONSENT_BODY_BYTES = 4 * 1024;

/** The approve button of the library's default consent page; the password field goes before it. */
const APPROVE_BUTTON = '<button type="submit" name="decision" value="approve">';

const PASSWORD_INPUT =
  `<p><label>Owner password <input type="password" name="${OWNER_PASSWORD_FIELD}" ` +
  `autocomplete="current-password"></label></p>\n`;

export interface OAuthConfig {
  /** The server's public origin, such as `https://caldav-mcp.example.com`. Also the issuer. */
  publicUrl: string;
  /** `pbkdf2-sha256$…` hash of the owner's password, made under `authPepper`. */
  ownerPasswordHash: string;
  /** The hasher's pepper: at least 32 characters. */
  authPepper: string;
}

/** Seams for tests. Production uses the defaults. */
export interface OAuthOptions {
  /** Defaults to a {@link MemoryOAuthStore}: a restart signs every connector out. */
  store?: OAuthStore;
  /** Resolves `client_id` URLs. Defaults to the library's fetcher, which fetches them. */
  clients?: ClientMetadataSource;
}

export interface OAuth {
  /** The resource clients must name: `publicUrl` plus {@link MCP_PATH}. */
  resource: string;
  /** True for a path this module serves: the two metadata documents, `/authorize`, `/token`. */
  handles(pathname: string): boolean;
  /** Serve a request for a path {@link OAuth.handles}. */
  fetch(req: Request): Promise<Response>;
  /**
   * Check the access token of an MCP request. `undefined` means it is valid for this server;
   * otherwise the `401` response to send, with `WWW-Authenticate` pointing at the metadata.
   */
  authenticate(req: Request): Promise<Response | undefined>;
}

/**
 * Build the authorization server and the resource-server guard for one owner.
 *
 * The owner proves who they are with a password on the consent page: the library leaves the owner
 * check to the app, and this server has no forward-auth in front of it. Showing the page needs no
 * password, since nothing is granted until the form is submitted. Approving needs the password;
 * denying does not, because a denial only sends the client away with `access_denied`.
 *
 * @throws {TypeError} When the URL, the pepper or anything the library checks is invalid.
 */
export function createOAuth(config: OAuthConfig, options: OAuthOptions = {}): OAuth {
  const hasher = createPasswordHasher({ pepper: config.authPepper });
  const store = options.store ?? new MemoryOAuthStore();
  const issuer = config.publicUrl;
  const resource = issuer + MCP_PATH;

  const authorization = createAuthorizationServer({
    issuer,
    resources: [resource],
    store,
    ...(options.clients ? { clients: options.clients } : {}),
    renderConsent: (details) => withPasswordField(defaultConsentPage(details)),
    async confirmOwner(c) {
      if (c.req.method !== 'POST') return true;
      // Read a copy: the library parses the original body after this check.
      const form = await readForm(c.req.raw.clone());
      if (form?.get('decision') === 'deny') return true;
      const password = form?.get(OWNER_PASSWORD_FIELD);
      if (typeof password !== 'string' || password === '') return false;
      return (await hasher.verify(password, config.ownerPasswordHash)).valid;
    },
  });
  const resourceServer = createResourceServer({
    resource,
    issuer,
    verifier: authorization.verifier,
  });

  const app = new Hono();
  app.get(resourceServer.metadataPath, resourceServer.metadataHandler);
  app.route('/', authorization.app);

  // The guard is Hono middleware; a request it lets through reaches this marker route.
  const guard = new Hono();
  guard.use('*', resourceServer.guard);
  guard.all('*', (c) => c.body(null, 204));

  const paths = new Set([
    AUTHORIZATION_SERVER_METADATA_PATH,
    resourceServer.metadataPath,
    AUTHORIZE_PATH,
    TOKEN_PATH,
  ]);

  return {
    resource: resourceServer.resource,
    handles: (pathname) => paths.has(pathname),
    fetch: async (req) => await app.fetch(req),
    async authenticate(req) {
      const res = await guard.fetch(req);
      return res.status === 204 ? undefined : res;
    },
  };
}

/** Add the owner password field to the library's consent page, or fail if its markup changed. */
function withPasswordField(html: string): string {
  if (!html.includes(APPROVE_BUTTON)) {
    throw new Error('The consent page has no approve button to put the password field before');
  }
  return html.replace(APPROVE_BUTTON, PASSWORD_INPUT + APPROVE_BUTTON);
}

async function readForm(req: Request): Promise<FormData | undefined> {
  try {
    return await parseBoundedFormData(req, { maxBytes: MAX_CONSENT_BODY_BYTES });
  } catch {
    return undefined;
  }
}
