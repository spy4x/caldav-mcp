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

## HTTP mode

HTTP mode answers JSON-RPC messages posted to `/mcp`, one message per request. `/health` needs no
token. Every other route needs `MCP_BEARER_TOKEN`, sent as one of:

- `Authorization: Bearer <token>`
- `Authorization: <token>`
- `X-Api-Key: <token>`

A token in the query string (`?api_key=`) is refused, because URLs end up in proxy and access logs.
A failed login is logged without the value the client sent.
