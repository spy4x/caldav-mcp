<div align="center">

# caldav-mcp

**Let your AI assistant read and manage your calendar and tasks on your own CalDAV server.**

[![CI](https://ci.antonshubin.com/api/badges/6/status.svg)](https://ci.antonshubin.com/repos/6)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

[Tools and examples](docs/features.md) · [MCP clients](docs/clients.md) ·
[Self-hosting](docs/self-hosting.md) · [Configuration](docs/configuration.md) ·
[How it works](docs/how-it-works.md) · [FAQ](docs/faq.md)

<img src="docs/screenshots/tool-exchange.png" alt="An example request, &quot;Book a 30-minute call with Jane Doe on Friday at 10:00 UTC, remind me to send her the agenda the day before, and show me what's still open&quot;, followed by four real tool calls and their responses: list_calendars returns the personal and work calendars, create_event adds &quot;Call with Jane Doe&quot; to work, create_todo adds &quot;Send the agenda to Jane&quot; with priority 1, and query_todos returns two open tasks, one of them overdue." width="820">

</div>

caldav-mcp is a [Model Context Protocol](https://modelcontextprotocol.io/) server. Connect it to
Claude Desktop, OpenCode, Cursor, OpenWebUI or any other MCP client, and your assistant can list
your calendars, find events and tasks, and create, update or delete them on your own CalDAV
server. The request in the picture is an example. The four tool calls were sent by hand, the way an
assistant would make them, and every response is what caldav-mcp returned from a local Radicale
server.

I wrote it because the CalDAV MCP servers I tried hid tasks, could not search across calendars,
and pulled in a large npm install. I run it on my own homelab next to my calendar server.

## Why caldav-mcp

- **Events and tasks, both first-class.** Full create, read, update and delete for events
  (VEVENT) and tasks (VTODO), with ETags so two edits never overwrite each other silently.
- **One call searches every calendar.** The calendar is optional on every query, so "what is
  overdue?" is one request, not one per calendar.
- **Answers an assistant can use.** Queries return totals, counts by status and priority and the
  number of overdue tasks next to the list, capped at 200 items with a `truncated` flag.
- **No third-party dependencies.** Built on Deno and web standards (Fetch, Streams, ES modules):
  no npm install, no `node_modules`.
- **One binary.** Deno compiles it into a single executable, or runs it straight from a pinned
  URL. Docker and systemd setups are in [self-hosting.md](docs/self-hosting.md).
- **Local or remote.** stdio for desktop clients, or HTTP with a bearer token for OpenWebUI and
  other networked clients.

**Use it if** your calendar lives on a CalDAV server you can reach with a username and password,
such as Radicale. **Skip it if** you need Google Calendar (its CalDAV API needs OAuth), contacts
(CardDAV) or several users from one instance. The comparison with `dav-mcp` is in
[how-it-works.md](docs/how-it-works.md#comparison).

## Quick start

Install [Deno](https://deno.com), then add this to Claude Desktop's `claude_desktop_config.json`.
The URL is pinned to a commit, so the code you run does not change under you.

```json
{
  "mcpServers": {
    "caldav": {
      "command": "deno",
      "args": ["run", "-A", "--no-lock", "https://raw.githubusercontent.com/spy4x/caldav-mcp/b249b6426f1a556ef4dada1292e3b5bf8d94d09a/main.ts"],
      "env": {
        "CALDAV_URL": "https://cal.example.com",
        "CALDAV_USERNAME": "user",
        "CALDAV_PASSWORD": "pass"
      }
    }
  }
}
```

Restart Claude Desktop and ask "Which calendars do I have?". The answer comes from
`list_calendars`. OpenCode, OpenWebUI and Cursor are in [clients.md](docs/clients.md).

## Configuration

The ones you must set:

| Variable          | Example                   |
| ----------------- | ------------------------- |
| `CALDAV_URL`      | `https://cal.example.com` |
| `CALDAV_USERNAME` | `user`                    |
| `CALDAV_PASSWORD` | `pass`                    |

The HTTP port, the bearer token and the log level are optional: see
[configuration.md](docs/configuration.md).

## Development

```bash
git clone https://github.com/spy4x/caldav-mcp.git && cd caldav-mcp
CALDAV_URL=... CALDAV_USERNAME=... CALDAV_PASSWORD=... deno task dev   # hot reload
deno task check && deno task test
deno task compile   # single binary: ./caldav-mcp
```

The code layout is in [how-it-works.md](docs/how-it-works.md#architecture).

## Built by

I'm [Anton Shubin](https://antonshubin.com), a senior full-stack engineer and tech lead.
caldav-mcp is one of the tools I build and run on my own servers, and building MCP servers and AI
integrations is part of my client work. Need something like it built for your product?
[That's my day job →](https://antonshubin.com)

Licensed under [MIT](LICENSE). Copyright (c) 2026 Anton Shubin.

---

Made by Anton Shubin · [antonshubin.com/tools/caldav-mcp](https://antonshubin.com/tools/caldav-mcp)
