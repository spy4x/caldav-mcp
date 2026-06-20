// ── Event tools: query_events, get_event, create_event, update_event, delete_event ──

import type { McpHandler } from '../mcp.ts';
import type { QueryEngine } from '../caldav/query.ts';

export function registerEventTools(mcp: McpHandler, engine: QueryEngine): void {
  mcp.registerTool(
    {
      name: 'query_events',
      description: 'Search events across all calendars. Returns summary + list.',
      inputSchema: {
        type: 'object',
        properties: {
          calendarUrl: { type: 'string', description: 'Optional: filter by calendar URL' },
          dateFrom: { type: 'string', description: 'ISO date — return events starting on or after this' },
          dateTo: { type: 'string', description: 'ISO date — return events starting on or before this' },
          text: { type: 'string', description: 'Search text in summary/description' },
        },
      },
    },
    (args: Record<string, unknown>) => {
      return engine.queryEvents({
        calendarUrl: args['calendarUrl'] as string | undefined,
        dateFrom: args['dateFrom'] as string | undefined,
        dateTo: args['dateTo'] as string | undefined,
        text: args['text'] as string | undefined,
      });
    },
  );

  mcp.registerTool(
    {
      name: 'get_event',
      description: 'Get a single event by URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Event URL' },
        },
        required: ['url'],
      },
    },
    async (args: Record<string, unknown>) => {
      const url = args['url'] as string;
      const event = await engine.getEvent(url);
      if (!event) return { error: 'Event not found' };
      return event;
    },
  );

  mcp.registerTool(
    {
      name: 'create_event',
      description: 'Create a new event in a calendar',
      inputSchema: {
        type: 'object',
        properties: {
          calendarUrl: { type: 'string', description: 'Calendar URL' },
          summary: { type: 'string', description: 'Event summary/title' },
          description: { type: 'string', description: 'Event description' },
          start: { type: 'string', description: 'ISO start datetime' },
          end: { type: 'string', description: 'ISO end datetime' },
          location: { type: 'string', description: 'Event location' },
        },
        required: ['calendarUrl', 'summary', 'start', 'end'],
      },
    },
    async (args: Record<string, unknown>) => {
      const calendarUrl = args['calendarUrl'] as string;
      const summary = args['summary'] as string;
      const start = args['start'] as string;
      const end = args['end'] as string;

      if (!calendarUrl || !summary || !start || !end) {
        return { error: 'calendarUrl, summary, start, and end are required' };
      }

      const result = await engine.createEvent(calendarUrl, {
        summary,
        description: args['description'] as string | undefined,
        start,
        end,
        location: args['location'] as string | undefined,
      });

      return { success: true, url: result.url, etag: result.etag };
    },
  );

  mcp.registerTool(
    {
      name: 'update_event',
      description: 'Update an existing event by URL + ETag',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Event URL' },
          etag: { type: 'string', description: 'Current ETag' },
          summary: { type: 'string', description: 'New summary' },
          description: { type: 'string', description: 'New description' },
          start: { type: 'string', description: 'New start (ISO)' },
          end: { type: 'string', description: 'New end (ISO)' },
          location: { type: 'string', description: 'New location' },
        },
        required: ['url', 'etag'],
      },
    },
    async (args: Record<string, unknown>) => {
      const url = args['url'] as string;
      const etag = args['etag'] as string;

      if (!url || !etag) {
        return { error: 'url and etag are required' };
      }

      try {
        const newEtag = await engine.updateEvent(url, etag, {
          summary: args['summary'] as string | undefined,
          description: args['description'] as string | undefined,
          start: args['start'] as string | undefined,
          end: args['end'] as string | undefined,
          location: args['location'] as string | undefined,
        });
        return { success: true, etag: newEtag };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  mcp.registerTool(
    {
      name: 'delete_event',
      description: 'Delete an event by URL + ETag',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Event URL' },
          etag: { type: 'string', description: 'Current ETag' },
        },
        required: ['url', 'etag'],
      },
    },
    async (args: Record<string, unknown>) => {
      const url = args['url'] as string;
      const etag = args['etag'] as string;

      if (!url) {
        return { error: 'url is required' };
      }

      try {
        await engine.deleteEvent(url, etag);
        return { success: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
