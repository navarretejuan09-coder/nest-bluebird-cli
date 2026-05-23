import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getVersion } from '../utils/version.js';
import { handleDiagnose, handleHealth, handleLayers, handleExplain } from './tools.js';

/**
 * Creates and configures the Bluebird MCP server.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'bluebird',
    version: getVersion(),
  });

  // Register diagnose tool
  server.registerTool(
    'bluebird_diagnose',
    {
      description:
        'Run a full diagnostic scan on a NestJS project. Returns health score, diagnostics, and project metadata.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Path to the NestJS project directory'),
        lint: z.boolean().optional().describe('Run lint analysis pass'),
        deadCode: z.boolean().optional().describe('Run dead code analysis pass'),
        graphAnalysis: z.boolean().optional().describe('Run graph analysis pass'),
        includeHeuristic: z.boolean().optional().describe('Include heuristic rules'),
      }),
    },
    async (args) => {
      const result = await handleDiagnose(args);
      return result;
    }
  );

  // Register health tool
  server.registerTool(
    'bluebird_health',
    {
      description: 'Get a quick health score for a NestJS project (0-100).',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Path to the NestJS project directory'),
      }),
    },
    async (args) => {
      const result = await handleHealth(args);
      return result;
    }
  );

  // Register layers tool
  server.registerTool(
    'bluebird_layers',
    {
      description:
        'Analyze NestJS module dependency layers. Detects architectural violations where lower layers depend on higher layers.',
      inputSchema: z.object({
        cwd: z.string().optional().describe('Path to the NestJS project directory'),
      }),
    },
    async (args) => {
      const result = await handleLayers(args);
      return result;
    }
  );

  // Register explain tool
  server.registerTool(
    'bluebird_explain',
    {
      description:
        'Get information about bluebird rules. Can list all rules, filter by category, or explain a specific rule.',
      inputSchema: z.object({
        rule: z.string().optional().describe('Specific rule ID to explain'),
        category: z
          .enum([
            'architecture',
            'security',
            'correctness',
            'api-design',
            'performance',
            'database',
            'testing',
            'graphql',
            'microservices',
            'websockets',
          ])
          .optional()
          .describe('Filter rules by category'),
        list: z.boolean().optional().describe('List all available rules'),
      }),
    },
    async (args) => {
      const result = await handleExplain(args);
      return result;
    }
  );

  return server;
}

/**
 * Starts the Bluebird MCP server with stdio transport.
 * This is the main entry point for the `bluebird mcp` command.
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}
