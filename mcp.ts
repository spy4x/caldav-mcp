// ── MCP Protocol Handler ──
// JSON-RPC 2.0 over stdio or HTTP.
// Handles lifecycle: initialize → tools/list → tools/call → shutdown

import type { ToolDefinition, ToolHandler } from './tools/index.ts';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type Transport = 'stdio' | 'http';

export interface McpServerInfo {
  name: string;
  version: string;
}

export class McpHandler {
  private tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }>;
  private initialized = false;
  private serverInfo: McpServerInfo;

  constructor(serverInfo: McpServerInfo) {
    this.serverInfo = serverInfo;
    this.tools = new Map();
  }

  registerTool(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  /** Process a single JSON-RPC request → response */
  async handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    const { id, method, params } = req;

    try {
      switch (method) {
        case 'initialize': {
          this.initialized = true;
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
              },
              serverInfo: this.serverInfo,
            },
          };
        }

        case 'tools/list': {
          const toolList = Array.from(this.tools.values()).map((t) => t.definition);
          return {
            jsonrpc: '2.0',
            id,
            result: { tools: toolList },
          };
        }

        case 'tools/call': {
          const { name, arguments: args } = params as { name?: string; arguments?: Record<string, unknown> };
          if (!name) {
            return error(id, -32602, 'Missing tool name');
          }

          const tool = this.tools.get(name);
          if (!tool) {
            return error(id, -32602, `Unknown tool: ${name}`);
          }

          const result = await tool.handler(args || {});
          return {
            jsonrpc: '2.0',
            id,
            result: { content: [{ type: 'text', text: JSON.stringify(result) }] },
          };
        }

        case 'notifications/initialized': {
          // No-op, client confirmed init
          return { jsonrpc: '2.0', id: null, result: null };
        }

        default:
          return error(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return error(id, -32603, `Internal error: ${msg}`);
    }
  }

  /** Process a string JSON-RPC message */
  async handleMessage(message: string): Promise<JsonRpcResponse | null> {
    try {
      const req: JsonRpcRequest = JSON.parse(message);
      return await this.handleRequest(req);
    } catch (_err) {
      // Parse error
      return {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      };
    }
  }

  /** Check if initialized */
  isInitialized(): boolean {
    return this.initialized;
  }
}

function error(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
