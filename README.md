# caldav-mcp

**Native Deno MCP server for CalDAV.** Events + tasks. Zero npm dependencies.

Talk to your Radicale (or any CalDAV) server from AI agents via the [Model Context Protocol](https://modelcontextprotocol.io/). Works with Claude Desktop, OpenCode, Cursor, and any MCP client.

```bash
CALDAV_URL=https://cal.example.com \
CALDAV_USERNAME=user \
CALDAV_PASSWORD=pass \
deno run -A main.ts
```

## Why

Existing CalDAV MCP servers ship as npm packages that depend on [`tsdav`](https://www.npmjs.com/package/tsdav) — a library with [known bugs](https://github.com/spy4x/caldav-mcp/issues) (broken VTODO filtering, wrong method names, VEVENT-only defaults). Workarounds involve runtime monkey-patching with `sed`.

**caldav-mcp** is a from-scratch CalDAV implementation that works correctly:

- **Proper VTODO/VEVENT filtering** — request only what you need
- **Parallel calendar queries** — 15 calendars in < 1 second
- **Cross-calendar search** — one query finds tasks across all calendars
- **No runtime patches** — the protocol is implemented correctly the first time
- **89 MB static binary** — compile once, deploy anywhere

## Features

### MCP Tools

| Tool | Description |
|------|-------------|
| `list_calendars` | List all calendars with component types and colors |
| `make_calendar` | Create a new calendar collection |
| `query_todos` | Search tasks across all calendars with summarization |
| `get_todo` | Get a single task by URL |
| `create_todo` | Create a task |
| `update_todo` | Update task fields |
| `delete_todo` | Delete a task |
| `query_events` | Search events across all calendars |
| `get_event` | Get a single event by URL |
| `create_event` | Create an event |
| `update_event` | Update event fields |
| `delete_event` | Delete an event |

### AI-First Design

**`calendarUrl` is optional on every tool.** AI doesn't need to know which calendar contains what — just ask:

```
query_todos({status: "NEEDS-ACTION", priority: {min: 1, max: 3}})
→ 14 high-priority uncompleted tasks across 10+ calendars
```

Responses include built-in summarization:
- `byStatus` — NEEDS-ACTION / IN-PROCESS / COMPLETED breakdown
- `byPriority` — high / medium / low / none
- `overdue` — count of overdue items

### Transport

- **stdio** (default) — for Claude Desktop, OpenCode, Cursor
- **HTTP** (`--http`) — for OpenWebUI, n8n, custom integrations

## Quick Start

### One-liner

```bash
CALDAV_URL=http://localhost:5232 \
CALDAV_USERNAME=user \
CALDAV_PASSWORD=pass \
deno run -A jsr:@spy4x/caldav-mcp
```

### From source

```bash
git clone https://github.com/spy4x/caldav-mcp.git
cd caldav-mcp
CALDAV_URL=http://localhost:5232 CALDAV_USERNAME=user CALDAV_PASSWORD=pass deno run -A main.ts
```

### Docker

```bash
CALDAV_URL=http://hl-radicale:5232 \
CALDAV_USERNAME=user \
CALDAV_PASSWORD=pass \
docker compose up -d
```

Or build your own:

```bash
docker build -t caldav-mcp .
docker run -d --restart unless-stopped \
  -e CALDAV_URL=http://hl-radicale:5232 \
  -e CALDAV_USERNAME=user \
  -e CALDAV_PASSWORD=pass \
  -p 3000:3000 caldav-mcp
```

### Compile to binary

```bash
deno compile -A --output caldav-mcp main.ts
./caldav-mcp  # stdio mode
./caldav-mcp --http  # HTTP mode on :3000
```

## Configuration

| Env Var | Default | Required | Description |
|---------|---------|----------|-------------|
| `CALDAV_URL` | — | yes | CalDAV server URL |
| `CALDAV_SERVER_URL` | — | yes | Alias for CALDAV_URL |
| `CALDAV_USERNAME` | — | yes | CalDAV auth username |
| `CALDAV_PASSWORD` | — | yes | CalDAV auth password |
| `PORT` | `3000` | no | HTTP port |
| `MCP_BEARER_TOKEN` | — | no | Bearer token for HTTP auth |
| `LOG_LEVEL` | `info` | no | debug / info / warn / error |

## MCP Client Integration

### Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "caldav": {
      "command": "deno",
      "args": ["run", "-A", "main.ts"],
      "env": {
        "CALDAV_URL": "https://cal.example.com",
        "CALDAV_USERNAME": "user",
        "CALDAV_PASSWORD": "pass"
      }
    }
  }
}
```

### OpenCode

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

### OpenWebUI

Add to `TOOL_SERVER_CONNECTIONS`:

```json
{
  "url": "http://caldav-mcp:3000/mcp",
  "type": "mcp",
  "auth_type": "bearer",
  "key": "mcpo-local",
  "config": {
    "enable": true,
    "access_grants": [{"principal_type": "user", "principal_id": "*", "permission": "read"}]
  },
  "info": {
    "id": "caldav-mcp",
    "name": "CalDAV MCP",
    "description": "CalDAV tasks and events"
  }
}
```

## Architecture

```
┌──────────────┐     stdio/HTTP     ┌──────────────┐     PROPFIND/REPORT    ┌──────────┐
│  MCP Client   │ ◄──────────────► │  caldav-mcp  │ ◄──────────────────► │  CalDAV  │
│  (Claude/     │    JSON-RPC 2.0   │  (Deno)      │    PUT/DELETE/MKCOL    │  Server  │
│   OpenCode/   │                   │              │                       │(Radicale)│
│   OpenWebUI)  │                   │              │                       │          │
└──────────────┘                    └──────────────┘                       └──────────┘
```

### Internal Structure

```
caldav-mcp/
├── main.ts           # Entry: stdio + HTTP transports
├── mcp.ts            # MCP protocol (JSON-RPC lifecycle)
├── env.ts            # Config from env vars
├── caldav/
│   ├── client.ts     # HTTP client (PROPFIND, REPORT, PUT, DELETE)
│   ├── xml.ts        # XML body builders (CalDAV/WebDAV requests)
│   ├── ical.ts       # iCal parser + generator (RFC 5545)
│   ├── types.ts      # Domain types (Calendar, Event, Todo, enums)
│   └── query.ts      # Parallel query engine + aggregation
├── tools/
│   ├── calendars.ts  # Calendar tools (list, make)
│   ├── todos.ts      # Todo tools (query, get, create, update, delete)
│   ├── events.ts     # Event tools (query, get, create, update, delete)
│   └── index.ts      # Tool registration
├── Dockerfile        # Multistage: compile → distroless
├── compose.yml       # Homelab deployment
└── deno.jsonc
```

## Why Deno?

- **No node_modules** — the binary is self-contained
- **TypeScript natively** — no transpilation step
- **`fetch()` built-in** — no need for axios/undici
- **`crypto.randomUUID()`** — no uuid package
- **Deno compile** — produces a single ~89 MB static binary

## Comparison

| | dav-mcp (npm) | caldav-mcp |
|---|---|---|
| Runtime | Node.js + npx | Native Deno binary |
| Dependencies | tsdav, mcpo, npx | Zero |
| VTODO support | Broken (needs sed patches) | First-class |
| Cross-calendar search | No | Yes |
| HTTP transport | Via mcpo proxy | Native |
| Binary size | ~200 MB+ | ~89 MB |
| Memory usage | ~512 MB | ~64 MB |

## Self-Hosting

Designed for homelab deployments with Traefik. The Docker image runs as a distroless binary with minimal footprint:

```yaml
services:
  caldav-mcp:
    build: .
    container_name: hl-caldav-mcp
    restart: unless-stopped
    environment:
      - CALDAV_URL=http://hl-radicale:5232
      - CALDAV_USERNAME=${CALDAV_USERNAME}
      - CALDAV_PASSWORD=${CALDAV_PASSWORD}
      - MCP_BEARER_TOKEN=${MCP_BEARER_TOKEN}
    mem_limit: 64M
    cpus: 0.1
    networks:
      - proxy
```

## Development

```bash
# Run with watch mode
deno task dev

# Run tests
deno task test

# Compile binary
deno task compile

# Lint
deno lint
```

## License

MIT © Anton Shubin

## Links

- [GitHub](https://github.com/spy4x/caldav-mcp)
- [Issues](https://github.com/spy4x/caldav-mcp/issues)
- [Author](https://antonshubin.com)
