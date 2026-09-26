# FAQ

**Q: Does it work with Google Calendar?**
A: No. Google Calendar's CalDAV API needs OAuth, and caldav-mcp signs in with a username and password
(HTTP Basic auth) only. Use a CalDAV proxy or Radicale in front.

**Q: Can it handle thousands of tasks?**
A: Yes. Responses are truncated at 200 items with `truncated: true` flag. AI can narrow filters.

**Q: Does it support CardDAV (contacts)?**
A: Not yet. Tasks + events only. PRs welcome.

**Q: Multi-user?**
A: Currently connects as one CalDAV user. For multi-user, run multiple instances.
