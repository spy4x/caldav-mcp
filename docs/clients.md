# MCP clients

The [README](../README.md#quick-start) configures Claude Desktop. This page covers running the
server without a client and the other clients.

## Run it directly

```bash
# One command — no npm install, no node_modules
CALDAV_URL=https://cal.example.com \
CALDAV_USERNAME=user \
CALDAV_PASSWORD=pass \
deno run -A https://raw.githubusercontent.com/spy4x/caldav-mcp/b249b6426f1a556ef4dada1292e3b5bf8d94d09a/main.ts
```

## OpenCode

```json
{
  "mcp": {
    "caldav-mcp": {
      "type": "local",
      "command": ["./caldav-mcp"],
      "enabled": true
    }
  }
}
```

## OpenWebUI

```json
{
  "url": "http://caldav-mcp:3000/mcp",
  "type": "mcp",
  "auth_type": "bearer",
  "key": "your-token",
  "config": {"enable": true},
  "info": {
    "id": "caldav-mcp",
    "name": "CalDAV MCP",
    "description": "Tasks and events"
  }
}
```

## Cursor

Settings → Features → MCP → Add new MCP server:

| Field | Value |
|-------|-------|
| Name | `caldav-mcp` |
| Type | `command` |
| Command | `deno run -A https://raw.githubusercontent.com/spy4x/caldav-mcp/b249b6426f1a556ef4dada1292e3b5bf8d94d09a/main.ts` |
| Environment | `CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD` |
