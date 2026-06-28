// ── Todo tools: query_todos, get_todo, create_todo, update_todo, delete_todo ──

import type { McpHandler } from '../mcp.ts';
import type { QueryEngine } from '../caldav/query.ts';

export function registerTodoTools(mcp: McpHandler, engine: QueryEngine): void {
  mcp.registerTool(
    {
      name: 'query_todos',
      description:
        'Search todos across all calendars. Returns summary + filtered list. Without filters — returns all todos.',
      inputSchema: {
        type: 'object',
        properties: {
          calendarUrl: { type: 'string', description: 'Optional: filter by specific calendar URL' },
          status: {
            type: 'string',
            enum: ['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED'],
            description: 'Filter by status',
          },
          text: { type: 'string', description: 'Search text in summary/description' },
          dueBefore: {
            type: 'string',
            description: 'ISO date — return tasks due before this time',
          },
          priority: {
            type: 'object',
            properties: {
              min: { type: 'number', description: 'Min priority (1=highest, 9=lowest)' },
              max: { type: 'number', description: 'Max priority' },
            },
            description: 'Priority range filter',
          },
        },
      },
    },
    (args: Record<string, unknown>) => {
      const priorityArg = args['priority'] as Record<string, unknown> | undefined;
      return engine.queryTodos({
        calendarUrl: args['calendarUrl'] as string | undefined,
        status: args['status'] as string | undefined,
        text: args['text'] as string | undefined,
        dueBefore: args['dueBefore'] as string | undefined,
        priority: priorityArg
          ? {
            min: priorityArg['min'] as number | undefined,
            max: priorityArg['max'] as number | undefined,
          }
          : undefined,
      });
    },
  );

  mcp.registerTool(
    {
      name: 'get_todo',
      description: 'Get a single todo by URL',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Todo URL' },
        },
        required: ['url'],
      },
    },
    async (args: Record<string, unknown>) => {
      const url = args['url'] as string;
      const todo = await engine.getTodo(url);
      if (!todo) return { error: 'Todo not found' };
      return todo;
    },
  );

  mcp.registerTool(
    {
      name: 'create_todo',
      description: 'Create a new task in a calendar',
      inputSchema: {
        type: 'object',
        properties: {
          calendarUrl: { type: 'string', description: 'Calendar URL where to create the todo' },
          summary: { type: 'string', description: 'Task summary/title' },
          description: { type: 'string', description: 'Task description (supports long text)' },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: 'Categories/tags for the task',
          },
          due: { type: 'string', description: 'ISO date string for due date' },
          priority: { type: 'number', description: 'Priority 1-9 (1=highest)' },
          status: {
            type: 'string',
            enum: ['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED'],
            description: 'Task status (default: NEEDS-ACTION)',
          },
          percentComplete: { type: 'number', description: 'Percent complete 0-100' },
        },
        required: ['calendarUrl', 'summary'],
      },
    },
    async (args: Record<string, unknown>) => {
      const calendarUrl = args['calendarUrl'] as string;
      const summary = args['summary'] as string;

      if (!calendarUrl || !summary) {
        return { error: 'calendarUrl and summary are required' };
      }

      const result = await engine.createTodo(calendarUrl, {
        summary,
        description: args['description'] as string | undefined,
        categories: args['categories'] as string[] | undefined,
        due: args['due'] as string | undefined,
        priority: args['priority'] as number | undefined,
        status: args['status'] as string | undefined,
        percentComplete: args['percentComplete'] as number | undefined,
      });

      return { success: true, url: result.url, etag: result.etag };
    },
  );

  mcp.registerTool(
    {
      name: 'update_todo',
      description: 'Update an existing todo by URL + ETag',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Todo URL' },
          etag: { type: 'string', description: 'Current ETag (from query_todos or get_todo)' },
          summary: { type: 'string', description: 'New summary' },
          description: { type: 'string', description: 'New description' },
          categories: {
            type: 'array',
            items: { type: 'string' },
            description: 'Categories/tags for the task',
          },
          due: { type: 'string', description: 'New due date (ISO)' },
          priority: { type: 'number', description: 'New priority 1-9' },
          status: {
            type: 'string',
            enum: ['NEEDS-ACTION', 'IN-PROCESS', 'COMPLETED', 'CANCELLED'],
          },
          percentComplete: { type: 'number', description: 'Percent complete 0-100' },
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
        const newEtag = await engine.updateTodo(url, etag, {
          summary: args['summary'] as string | undefined,
          description: args['description'] as string | undefined,
          categories: args['categories'] as string[] | undefined,
          due: args['due'] as string | undefined,
          priority: args['priority'] as number | undefined,
          status: args['status'] as string | undefined,
          percentComplete: args['percentComplete'] as number | undefined,
        });
        return { success: true, etag: newEtag };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  mcp.registerTool(
    {
      name: 'delete_todo',
      description: 'Delete a todo by URL + ETag',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Todo URL' },
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
        await engine.deleteTodo(url, etag);
        return { success: true };
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
