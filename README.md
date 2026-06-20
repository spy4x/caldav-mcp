# caldav-mcp

Lightweight MCP server for CalDAV (events + tasks). Deno-first. Zero npm dependencies.

## Quick start

```env
CALDAV_URL=http://localhost:5232
CALDAV_USERNAME=user
CALDAV_PASSWORD=pass
```

```bash
deno run -A main.ts
# stdio transport — connect from OpenCode/Claude Desktop/Cursor
```

### HTTP transport (for OpenWebUI/n8n via mcpo)

```bash
MCP_BEARER_TOKEN=mcpo-local deno run -A main.ts --http
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `list_calendars` | List all calendars |
| `make_calendar` | Create a calendar |
| `query_todos` | Search todos (all calendars, with filters + summary) |
| `get_todo` | Get single todo |
| `create_todo` | Create task |
| `update_todo` | Update task |
| `delete_todo` | Delete task |
| `query_events` | Search events |
| `get_event` | Get single event |
| `create_event` | Create event |
| `update_event` | Update event |
| `delete_event` | Delete event |

## Design

- Direct HTTP calls to CalDAV (PROPFIND, REPORT, PUT, DELETE) — no tsdav
- Parallel queries across all calendars (Promise.all)
- AI-first: `calendarUrl` optional, responses include summarization (byStatus, byPriority, overdue)
- iCal RFC 5545: line folding, escaping, full VTODO/VEVENT support
- Enums start at 1, monetary values not applicable here

## Deploy

```bash
docker compose up -d
```

## Config

| Env | Default | Required |
|-----|---------|----------|
| `CALDAV_URL` | — | yes |
| `CALDAV_USERNAME` | — | yes |
| `CALDAV_PASSWORD` | — | yes |
| `PORT` | 3000 | no |
| `MCP_BEARER_TOKEN` | — | no (for HTTP) |
| `LOG_LEVEL` | info | no |
