<p align="center">
  <img src="https://img.shields.io/badge/deno-v2.2-000?logo=deno&logoColor=fff" alt="Deno">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/MCP-2024--11--05-purple" alt="MCP">
  <img src="https://img.shields.io/github/stars/spy4x/caldav-mcp?style=social" alt="Stars">
</p>

<h1 align="center">caldav-mcp</h1>
<p align="center"><b>Native Deno MCP server for CalDAV.</b><br>
Events + tasks. Zero npm dependencies. One binary.</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#comparison">vs dav-mcp</a> •
  <a href="#examples">Examples</a> •
  <a href="#self-hosting">Self-Hosting</a> •
  <a href="#mcp-client-integration">MCP Clients</a>
</p>

---

Talk to your Radicale (or any CalDAV) server from AI agents via the [Model Context Protocol](https://modelcontextprotocol.io/).

```
AI: "What's overdue?"
caldav-mcp: "13 overdue tasks — 3 high priority, 5 medium, 5 low."

AI: "Create a task 'Review PR' in Inbox, priority 2, due Friday"
caldav-mcp: "Done → https://cal.example.com/spy4x/inbox/review-pr.ics"
```

Works with **Claude Desktop**, **OpenCode**, **Cursor**, **OpenWebUI**, and any MCP client.

## Why caldav-mcp?

Existing CalDAV MCP servers (like `dav-mcp`) ship as npm packages that depend on `tsdav` — a library with unfixed bugs:

| Bug | Symptom |
|-----|---------|
| Wrong method names | `client.createTodo()` doesn't exist in tsdav → runtime crash |
| Broken VTODO filtering | Defaults to VEVENT only, tasks are invisible |
| Cross-calendar search | Not supported — must query each calendar manually |
| npm + npx overhead | ~200MB+ download, runtime patches with `sed` |

**caldav-mcp** is a from-scratch implementation that fixes all of this. No wrappers, no workarounds.

## Features

### MCP Tools

| Tool | What it does | Why AI loves it |
|------|-------------|-----------------|
| `query_todos` | Search tasks across ALL calendars | **`calendarUrl` is optional** — one call, all data |
| `query_events` | Search events across ALL calendars | Same — cross-calendar by default |
| `list_calendars` | List all calendars + component types | Auto-discovers structure |
| `create_todo` / `update_todo` / `delete_todo` | Full task CRUD | ETag-based concurrency |
| `create_event` / `update_event` / `delete_event` | Full event CRUD | Same pattern |
| `get_todo` / `get_event` | Single item by URL | Read-back for verification |
| `make_calendar` | Create a calendar collection | AI can organize projects |

### AI-First Design

Every query returns **structured summarization** — not raw lists:

```json
{
  "total": 438,
  "byStatus": {
    "NEEDS-ACTION": 180,
    "COMPLETED": 258
  },
  "byPriority": {
    "high": 33,
    "medium": 51,
    "low": 48,
    "none": 306
  },
  "overdue": 11,
  "todos": [
    {
      "summary": "Review PR",
      "description": "Check the open PR on github...",
      "status": "NEEDS-ACTION",
      "priority": 2,
      "due": "2026-06-25T17:00:00Z",
      "relatedTo": [{"uid": "abc-123", "reltype": "PARENT"}],
      "calendarName": "Work",
      "url": "https://...",
      "etag": "\"...\""
    }
  ]
}
```

### Task Relationships (RFC 5545 RELATED-TO)

Tasks can be linked as parent/child/sibling:

```
query_todos → {
  "summary": "Deploy v2",
  "relatedTo": [
    {"uid": "fix-auth-bug-123", "reltype": "CHILD"},
    {"uid": "deploy-to-prod-456", "reltype": "SIBLING"}
  ]
}
```

AI can follow the relationship chain to understand task hierarchy.

## Quick Start

```bash
# One command — no npm install, no node_modules
CALDAV_URL=https://cal.example.com \
CALDAV_USERNAME=user \
CALDAV_PASSWORD=pass \
deno run -A https://raw.githubusercontent.com/spy4x/caldav-mcp/main/main.ts
```

### Claude Desktop

```json
{
  "mcpServers": {
    "caldav": {
      "command": "deno",
      "args": ["run", "-A", "--no-lock", "https://raw.githubusercontent.com/spy4x/caldav-mcp/main/main.ts"],
      "env": {
        "CALDAV_URL": "https://cal.example.com",
        "CALDAV_USERNAME": "user",
        "CALDAV_PASSWORD": "pass"
      }
    }
  }
}
```

### Compile to binary (recommended)

```bash
deno compile -A --output caldav-mcp https://raw.githubusercontent.com/spy4x/caldav-mcp/main/main.ts
./caldav-mcp                 # stdio (for MCP clients)
./caldav-mcp --http          # HTTP on :3000 (for OpenWebUI)
```

## Comparison

| | `dav-mcp` (npm) | **caldav-mcp** |
|---|---|---|
| **Runtime** | Node.js + npx | **Static binary (Deno)** |
| **Dependencies** | tsdav, mcpo, npx | **Zero** |
| **Install size** | ~200MB | **~89MB** |
| **Startup time** | 3-5s (npx resolve) | **<100ms** |
| **VTODO support** | ❌ Broken (patched with sed) | **✅ First-class** |
| **VEVENT support** | ⚠️ Partial | **✅ Full CRUD** |
| **Cross-calendar search** | ❌ No | **✅ One query = all calendars** |
| **Summarization** | ❌ Raw iCal | **✅ byStatus/byPriority/overdue** |
| **Task relationships** | ❌ No | **✅ RELATED-TO (parent/child/sibling)** |
| **HTTP transport** | Via mcpo proxy | **✅ Native SSE + POST** |
| **Memory** | ~512MB | **~64MB** |
| **License** | GPL-3.0 | **MIT** |

## Examples

### Filtering

```
query_todos({})                                    → all 438 tasks with stats
query_todos({status: "NEEDS-ACTION"})              → only uncompleted
query_todos({status: "NEEDS-ACTION", priority: {min: 1, max: 3}})  → high-priority uncompleted
query_todos({dueBefore: new Date().toISOString()}) → overdue
query_todos({text: "upwork"})                      → full-text search in summary
query_events({dateFrom: "...", dateTo: "..."})     → events in date range
query_events({text: "meeting"})                    → events containing "meeting"
```

### Full CRUD

```json
create_todo({
  "calendarUrl": "https://cal.example.com/spy4x/tasks/",
  "summary": "Write documentation",
  "description": "Cover API endpoints, config, and deployment",
  "priority": 2,
  "due": "2026-07-01T17:00:00Z",
  "status": "NEEDS-ACTION"
})
→ {"success": true, "url": "https://.../uid.ics", "etag": "\"...\""}
```

## Self-Hosting

Designed for homelab deployments. Compatible with Radicale, Baïkal, Xandikos, and any CalDAV server.

### Docker

```yaml
services:
  caldav-mcp:
    build: https://github.com/spy4x/caldav-mcp.git
    container_name: caldav-mcp
    restart: unless-stopped
    environment:
      - CALDAV_URL=http://radicale:5232
      - CALDAV_USERNAME=${CALDAV_USERNAME}
      - CALDAV_PASSWORD=${CALDAV_PASSWORD}
      - MCP_BEARER_TOKEN=${MCP_BEARER_TOKEN}
    ports:
      - "3000:3000"
    mem_limit: 64M
    cpus: 0.1
    networks:
      - proxy
```

Or pull pre-built image (coming soon):

```bash
docker pull ghcr.io/spy4x/caldav-mcp:latest
```

### Systemd (bare metal)

```bash
# Install binary
sudo deno compile -A --output /usr/local/bin/caldav-mcp \
  https://raw.githubusercontent.com/spy4x/caldav-mcp/main/main.ts

# Systemd service
cat > /etc/systemd/system/caldav-mcp.service << 'EOF'
[Unit]
Description=caldav-mcp server
After=network.target

[Service]
ExecStart=/usr/local/bin/caldav-mcp --http
Environment=CALDAV_URL=http://localhost:5232
Environment=CALDAV_USERNAME=user
Environment=CALDAV_PASSWORD=pass
Environment=PORT=3000
Restart=always
MemoryMax=64M
CPUQuota=10%

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable --now caldav-mcp
```

## MCP Client Integration

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

### Cursor

Settings → Features → MCP → Add new MCP server:

| Field | Value |
|-------|-------|
| Name | `caldav-mcp` |
| Type | `command` |
| Command | `deno run -A https://raw.githubusercontent.com/spy4x/caldav-mcp/main/main.ts` |
| Environment | `CALDAV_URL`, `CALDAV_USERNAME`, `CALDAV_PASSWORD` |

## Architecture

```
┌──────────────┐    stdio/HTTP    ┌──────────────┐    PROPFIND/REPORT    ┌──────────┐
│  MCP Client   │ ◄────────────► │  caldav-mcp  │ ◄──────────────────► │  CalDAV  │
│  (Claude/     │   JSON-RPC 2.0  │   (Deno)     │    PUT/DELETE/MKCOL    │  Server  │
│   OpenCode/   │                 │   89MB bin   │                       │(Radicale)│
│   OpenWebUI)  │                 │   ~64MB RAM  │                       │          │
└──────────────┘                  └──────────────┘                       └──────────┘
```

### Project Structure

```
caldav-mcp/
├── main.ts           # Entry: stdio + HTTP transports
├── mcp.ts            # MCP protocol (JSON-RPC 2.0 lifecycle)
├── env.ts            # Config from environment variables
├── caldav/
│   ├── client.ts     # CalDAV HTTP client (PROPFIND, REPORT, PUT, DELETE)
│   ├── xml.ts        # XML builders for CalDAV/WebDAV requests
│   ├── ical.ts       # iCal parser + generator (RFC 5545)
│   └── query.ts      # Parallel query engine + aggregation
├── tools/
│   ├── calendars.ts  # list_calendars, make_calendar
│   ├── todos.ts      # CRUD for VTODO
│   └── events.ts     # CRUD for VEVENT
├── Dockerfile        # Multistage → distroless (89MB)
└── deno.jsonc
```

## Why Deno?

| Requirement | Node.js | Deno |
|-------------|---------|------|
| TypeScript | ❌ Needs tsconfig + transpiler | **✅ Native** |
| fetch() | ❌ Needs axios/undici | **✅ Built-in** |
| crypto.randomUUID() | ❌ Needs uuid package | **✅ Built-in** |
| File I/O | ❌ Needs fs/promises | **✅ Native** |
| Binary compile | ❌ Needs pkg/ncc | **✅ deno compile** |
| Standard library | ❌ npm chaos | **✅ deno.land/std** |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `CALDAV_URL` | — | CalDAV server URL (or `CALDAV_SERVER_URL`) |
| `CALDAV_USERNAME` | — | CalDAV auth username |
| `CALDAV_PASSWORD` | — | CalDAV auth password |
| `PORT` | `3000` | HTTP port (for `--http` mode) |
| `MCP_BEARER_TOKEN` | — | Bearer token for HTTP auth |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Development

```bash
# Clone
git clone https://github.com/spy4x/caldav-mcp.git && cd caldav-mcp

# Run with hot-reload
CALDAV_URL=... CALDAV_USERNAME=... CALDAV_PASSWORD=... deno task dev

# Test
deno task test

# Lint
deno task lint

# Build binary
deno task compile
```

## FAQ

**Q: Does it work with Google Calendar?**
A: No — Google Calendar doesn't support CalDAV directly. Use a CalDAV proxy or Radicale in front.

**Q: Can it handle thousands of tasks?**
A: Yes. Responses are truncated at 200 items with `truncated: true` flag. AI can narrow filters.

**Q: Does it support CardDAV (contacts)?**
A: Not yet. Tasks + events only. PRs welcome.

**Q: Multi-user?**
A: Currently connects as one CalDAV user. For multi-user, run multiple instances.

## License

MIT © [Anton Shubin](https://antonshubin.com)

Built with Deno. Self-hosted on Fedora homelab with Traefik + Docker.

---

<p align="center">
  <a href="https://github.com/spy4x/caldav-mcp">GitHub</a> •
  <a href="https://github.com/spy4x/caldav-mcp/issues">Issues</a> •
  <a href="https://antonshubin.com">Author</a>
</p>
