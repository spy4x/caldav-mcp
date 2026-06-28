// ── Calendar tools: list_calendars, make_calendar ──

import type { McpHandler } from '../mcp.ts';
import type { QueryEngine } from '../caldav/query.ts';
import { ComponentType } from '../caldav/types.ts';

const COMPONENT_LABELS: Record<number, string> = {
  [ComponentType.VEVENT]: 'VEVENT',
  [ComponentType.VTODO]: 'VTODO',
  [ComponentType.VJOURNAL]: 'VJOURNAL',
};

export function registerCalendarTools(mcp: McpHandler, engine: QueryEngine): void {
  mcp.registerTool(
    {
      name: 'list_calendars',
      description: 'List all available calendars with their component types and colors',
      inputSchema: { type: 'object', properties: {} },
    },
    async () => {
      const calendars = await engine.listCalendars();
      return calendars.map((c) => ({
        url: c.url,
        displayName: c.displayName,
        components: c.components.map((ct) => COMPONENT_LABELS[ct] || 'UNKNOWN'),
        color: c.color || null,
        description: c.description || null,
        ctag: c.ctag || null,
      }));
    },
  );

  mcp.registerTool(
    {
      name: 'delete_calendar',
      description: 'Delete a calendar collection and all its events/todos',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Calendar URL to delete' },
        },
        required: ['url'],
      },
    },
    async (args: Record<string, unknown>) => {
      const url = args['url'] as string;
      if (!url) return { error: 'url is required' };

      try {
        await engine['client'].deleteResource(url);
        return { success: true, url };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  mcp.registerTool(
    {
      name: 'make_calendar',
      description: 'Create a new calendar collection',
      inputSchema: {
        type: 'object',
        properties: {
          displayName: { type: 'string', description: 'Calendar display name' },
          components: {
            type: 'array',
            items: { type: 'string', enum: ['VEVENT', 'VTODO', 'VJOURNAL'] },
            description: 'Supported component types (default: VEVENT,VTODO)',
          },
          color: { type: 'string', description: 'Calendar color hex (e.g. #FF542B)' },
          description: { type: 'string', description: 'Calendar description' },
        },
        required: ['displayName'],
      },
    },
    async (args: Record<string, unknown>) => {
      const displayName = args['displayName'] as string;
      const components = (args['components'] as string[]) || ['VEVENT', 'VTODO'];
      const color = args['color'] as string | undefined;
      const description = args['description'] as string | undefined;

      // Discover parent path from an existing calendar URL (Radicale convention: /{user}/)
      const baseUrl = engine.client['baseUrl'];
      const username = engine.client['username'];
      const calendars = await engine.listCalendars();
      let parentUrl: string;
      if (calendars.length > 0) {
        const firstUrl = new URL(calendars[0]!.url);
        const pathParts = firstUrl.pathname.split('/').filter(Boolean);
        parentUrl = pathParts.length >= 2
          ? `${firstUrl.origin}/${pathParts[0]!}/`
          : `${firstUrl.origin}/`;
      } else {
        // Fallback: use base URL + username path (Radicale convention)
        parentUrl = `${baseUrl}/${username}/`;
      }

      await engine['client'].makeCalendar(parentUrl, displayName, components, color, description);

      return { success: true, url: `${parentUrl}${encodeURIComponent(displayName)}/`, displayName };
    },
  );
}
