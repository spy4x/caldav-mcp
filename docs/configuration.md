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
| `TRUSTED_PROXIES` | — | Comma-separated CIDR ranges of the reverse proxies in front of HTTP mode, like `172.16.0.0/12` for a Docker network. `X-Forwarded-For` is read only from a peer inside them, so the rate limit counts each client behind the proxy separately. Empty trusts no one: any client could forge the header |

## HTTP mode

HTTP mode answers JSON-RPC messages posted to `/mcp`, one message per request. `/health` needs no
token. Every other route needs `MCP_BEARER_TOKEN`, sent as one of:

- `Authorization: Bearer <token>`
- `Authorization: <token>`
- `X-Api-Key: <token>`

A token in the query string (`?api_key=`) is refused, because URLs end up in proxy and access logs.
A failed login is logged without the value the client sent, and every line written through the
logger has the token and the CalDAV password redacted.

A client is its IP address: the connecting peer, or the first `X-Forwarded-For` hop when the peer
is in `TRUSTED_PROXIES`. Each client may send 10 wrong tokens per minute; after that every request
from it gets `429` with `Retry-After` until the minute is over, before its token is even checked.
Each client may also send 100 authorized requests per minute. A request body over 1 MiB gets `413`.
