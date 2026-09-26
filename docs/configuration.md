# Configuration

All settings are environment variables, read once at startup.

| Env Var | Default | Description |
|---------|---------|-------------|
| `CALDAV_URL` | — | CalDAV server URL (or `CALDAV_SERVER_URL`) |
| `CALDAV_USERNAME` | — | CalDAV auth username |
| `CALDAV_PASSWORD` | — | CalDAV auth password |
| `PORT` | `3000` | HTTP port (for `--http` mode) |
| `MCP_BEARER_TOKEN` | — | Bearer token for HTTP auth |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
