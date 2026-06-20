// ── Tool definitions and registration ──

import type { McpHandler } from '../mcp.ts';
import type { QueryEngine } from '../caldav/query.ts';
import { registerCalendarTools } from './calendars.ts';
import { registerTodoTools } from './todos.ts';
import { registerEventTools } from './events.ts';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export function registerAllTools(mcp: McpHandler, engine: QueryEngine): void {
  registerCalendarTools(mcp, engine);
  registerTodoTools(mcp, engine);
  registerEventTools(mcp, engine);
}
