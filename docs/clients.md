# MCP clients

The [README](../README.md#quick-start) configures Claude Desktop. This page covers running the
server without a client and the other clients.

## Run it directly

```bash
# One command — no npm install, no node_modules
CALDAV_URL=https://cal.example.com \
CALDAV_USERNAME=user \
CALDAV_PASSWORD=pass \
deno run -A jsr:@spy4x/caldav-mcp@1
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
| Command | `deno run -A jsr:@spy4x/caldav-mcp@1` |
| Environment | `CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD` |
