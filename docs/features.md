# Tools and examples

Every tool caldav-mcp offers, what its answers look like, and example calls. Back to the
[README](../README.md).

## MCP Tools

| Tool | What it does | Why AI loves it |
|------|-------------|-----------------|
| `query_todos` | Search tasks across ALL calendars | **`calendarUrl` is optional** — one call, all data |
| `query_events` | Search events across ALL calendars | Same — cross-calendar by default |
| `list_calendars` | List all calendars + component types | Auto-discovers structure |
| `create_todo` / `update_todo` / `delete_todo` | Full task CRUD | ETag-based concurrency |
| `create_event` / `update_event` / `delete_event` | Full event CRUD | Same pattern |
| `get_todo` / `get_event` | Single item by URL | Read-back for verification |
| `make_calendar` | Create a calendar collection | AI can organize projects |
| `delete_calendar` | Delete a calendar collection and all its events/todos | Cleans up after a project |

## AI-First Design

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

## Task Relationships (RFC 5545 RELATED-TO)

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
