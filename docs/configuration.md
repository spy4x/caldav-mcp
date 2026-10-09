# Configuration

All settings are environment variables, read once at startup.

| Env Var | Default | Description |
|---------|---------|-------------|
| `CALDAV_URL` | — | CalDAV server URL (or `CALDAV_SERVER_URL`) |
| `CALDAV_USERNAME` | — | CalDAV auth username |
| `CALDAV_PASSWORD` | — | CalDAV auth password |
| `HOST` | `127.0.0.1` | Interface the HTTP mode binds to. Set `0.0.0.0` inside a container |
| `PORT` | `3000` | HTTP port (for `--http` mode) |
| `MCP_BEARER_TOKEN` | — | Token for HTTP mode. Required there: without it `--http` refuses to start. Setting it also turns HTTP mode on |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `PUBLIC_URL` | — | OAuth: the server's public origin, like `https://caldav-mcp.example.com`. The MCP endpoint is this plus `/mcp`. Set with the next two, or none of the three |
| `OWNER_PASSWORD_HASH` | — | OAuth: the hash of the password you type to approve a connector. Never the password itself; [how to make it](../README.md#use-it-from-claudeai) |
| `AUTH_PEPPER` | — | OAuth: a random secret of at least 32 characters the hash is made with. Changing it invalidates the hash |
| `OAUTH_KV_PATH` | `/data/oauth.kv` | OAuth: the Deno KV file that keeps grants and tokens across restarts. Its directory must exist and be writable; the server refuses to start otherwise |
| `TRUSTED_PROXIES` | — | Comma-separated CIDR ranges of the reverse proxies in front of HTTP mode, like `172.16.0.0/12` for a Docker network. `X-Forwarded-For` is read only from a peer inside them, so the rate limit counts each client behind the proxy separately. Empty trusts no one: any client could forge the header |

## HTTP mode

HTTP mode speaks Streamable HTTP on `/mcp`: each POST carries one JSON-RPC message or a batch and
gets a JSON answer, or `202` when it held only notifications. The answer to `initialize` carries an
`Mcp-Session-Id` header; the server keeps no state per session, so later requests work with or
without it. A `MCP-Protocol-Version` header the server does not speak gets `400`. `GET /mcp` gets
`405`: the server never starts a stream of its own.

`/health` needs no token. Every other route needs `MCP_BEARER_TOKEN` or, with OAuth on, an access
token from the OAuth flow. The static token is sent as one of:

- `Authorization: Bearer <token>`
- `Authorization: <token>`
- `X-Api-Key: <token>`

A token in the query string (`?api_key=`) is refused, because URLs end up in proxy and access logs.
A failed login is logged without the value the client sent, and every line written through the
logger has the token and the CalDAV password redacted.

A client is its IP address: the connecting peer, or the first `X-Forwarded-For` hop when the peer
is in `TRUSTED_PROXIES`. Each client may send 10 wrong tokens or refused consent forms per minute; after that every request
from it gets `429` with `Retry-After` until the minute is over, before its token is even checked.
Each client may also send 100 authorized requests per minute. A request body over 1 MiB gets `413`,
and a batch of more than 20 messages is refused whole.

## OAuth

Set `PUBLIC_URL`, `OWNER_PASSWORD_HASH` and `AUTH_PEPPER` together and the server becomes its own
OAuth authorization server, so claude.ai and the Claude apps can connect to it as a remote
connector. Setting one or two of them stops startup with the names of the missing ones. The setup
is in the README, [Use it from claude.ai](../README.md#use-it-from-claudeai).

With OAuth on:

- `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server`
  describe the server; `/authorize` shows the consent page and `/token` hands out tokens.
- A request to `/mcp` without a valid token gets `401` with
  `WWW-Authenticate: Bearer resource_metadata="<PUBLIC_URL>/.well-known/oauth-protected-resource/mcp"`.
- Only clients whose `client_id` is on `claude.ai` can sign in: the Claude apps and Claude Code.
  A `client_id` on any other host gets `400` before anything is fetched.
- Each client may open 10 consent pages a minute; the next one gets `429` until the minute is over.
- After 10 wrong owner passwords in 15 minutes, counted for the whole server, every approval gets
  `429` until the window ends. Someone who can reach the page can therefore keep you from approving
  a new connector for a while; connectors already signed in keep working.
- `MCP_BEARER_TOKEN` keeps working next to OAuth, so clients such as OpenWebUI need no change.
- Grants and tokens live in Deno KV at `OAUTH_KV_PATH`, so a restart keeps connectors signed in.
  The server runs with `--unstable-kv` for this (the tasks and the Docker image set it).
