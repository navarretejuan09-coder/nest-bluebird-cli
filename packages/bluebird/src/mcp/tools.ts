import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { diagnose } from '../index.js';
import { getAllRules, getRuleById, getRulesByCategory } from '../rules/index.js';
import { analyseModuleLayers, loadSourceFilesForLayers } from '../utils/layers.js';
import { formatLayersJson } from '../utils/format-layers.js';
import type { RuleCategory, RuleMeta } from '../types.js';

/**
 * Validates and resolves a working directory path.
 * Prevents path traversal attacks by ensuring the path:
 * 1. Resolves to an absolute path
 * 2. Actually exists on the filesystem
 * 3. Does not contain suspicious path traversal sequences
 *
 * @throws Error if the path is invalid or does not exist
 */
function validateCwd(cwd: string | undefined): string {
  if (!cwd) {
    return process.cwd();
  }

  // Check for obvious path traversal attempts
  if (cwd.includes('..') && !isAbsolute(cwd)) {
    // Allow absolute paths that happen to contain '..' as they'll be resolved
    // But reject relative paths with '..' as they're likely traversal attempts
    const resolved = resolve(process.cwd(), cwd);
    // Ensure the resolved path doesn't escape the current working directory
    // when the input was a relative path with traversal
    if (!resolved.startsWith(process.cwd())) {
      throw new Error(
        `Invalid path: relative paths with '..' that escape the current directory are not allowed`
      );
    }
  }

  // Resolve to absolute path
  const resolvedPath = resolve(cwd);

  // Verify the path exists
  if (!existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }

  return resolvedPath;
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const TOOLS = [
  {
    name: 'bluebird_diagnose',
    description:
      'Run a full diagnostic scan on a NestJS project. Returns health score, diagnostics, and project metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Path to the NestJS project directory (default: current directory)',
        },
        lint: {
          type: 'boolean',
          description: 'Run lint analysis pass (default: true)',
        },
        deadCode: {
          type: 'boolean',
          description: 'Run dead code analysis pass (default: true)',
        },
        graphAnalysis: {
          type: 'boolean',
          description: 'Run graph analysis pass for circular dependencies (default: true)',
        },
        includeHeuristic: {
          type: 'boolean',
          description: 'Include heuristic rules (default: false)',
        },
      },
    },
  },
  {
    name: 'bluebird_health',
    description: 'Get a quick health score for a NestJS project (0-100).',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Path to the NestJS project directory (default: current directory)',
        },
      },
    },
  },
  {
    name: 'bluebird_layers',
    description:
      'Analyze NestJS module dependency layers. Detects architectural violations where lower layers depend on higher layers.',
    inputSchema: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Path to the NestJS project directory (default: current directory)',
        },
      },
    },
  },
  {
    name: 'bluebird_explain',
    description:
      'Get information about bluebird rules. Can list all rules, filter by category, or explain a specific rule.',
    inputSchema: {
      type: 'object',
      properties: {
        rule: {
          type: 'string',
          description: 'Specific rule ID to explain (e.g., "no-circular-dependency")',
        },
        category: {
          type: 'string',
          description: 'Filter rules by category (e.g., "security", "architecture")',
          enum: [
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
          ],
        },
        list: {
          type: 'boolean',
          description: 'List all available rules (default: false)',
        },
      },
    },
  },
];

// ─── Tool Handlers ──────────────────────────────────────────────────────────

export interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export async function handleDiagnose(args: {
  cwd?: string;
  lint?: boolean;
  deadCode?: boolean;
  graphAnalysis?: boolean;
  includeHeuristic?: boolean;
}): Promise<ToolResult> {
  try {
    const cwd = validateCwd(args.cwd);
    const result = await diagnose({
      cwd,
      lint: args.lint ?? true,
      deadCode: args.deadCode ?? true,
      graphAnalysis: args.graphAnalysis ?? true,
      includeHeuristic: args.includeHeuristic ?? false,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              score: result.score.score,
              label: result.score.label,
              project: result.project,
              diagnosticCount: result.diagnostics.length,
              diagnostics: result.diagnostics.slice(0, 50), // Limit for context window
              warningCount: result.warnings.length,
            },
            null,
            2
          ),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error running diagnosis: ${error}` }],
      isError: true,
    };
  }
}

export async function handleHealth(args: { cwd?: string }): Promise<ToolResult> {
  try {
    const cwd = validateCwd(args.cwd);
    const result = await diagnose({
      cwd,
      lint: true,
      deadCode: true,
      graphAnalysis: true,
      includeHeuristic: false,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            score: result.score.score,
            label: result.score.label,
          }),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error getting health score: ${error}` }],
      isError: true,
    };
  }
}

export async function handleLayers(args: { cwd?: string }): Promise<ToolResult> {
  try {
    const cwd = validateCwd(args.cwd);
    const sourceFiles = await loadSourceFilesForLayers(cwd);
    const result = await analyseModuleLayers(sourceFiles);

    return {
      content: [
        {
          type: 'text',
          text: formatLayersJson(result),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error analyzing layers: ${error}` }],
      isError: true,
    };
  }
}

export async function handleExplain(args: {
  rule?: string;
  category?: string;
  list?: boolean;
}): Promise<ToolResult> {
  try {
    // List all rules
    if (args.list || (!args.rule && !args.category)) {
      const allRules = getAllRules();
      const rulesByCategory: Record<string, RuleMeta[]> = {};

      for (const rule of allRules) {
        if (!rulesByCategory[rule.category]) {
          rulesByCategory[rule.category] = [];
        }
        rulesByCategory[rule.category].push(rule);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                totalRules: allRules.length,
                categories: Object.keys(rulesByCategory),
                rulesByCategory: Object.fromEntries(
                  Object.entries(rulesByCategory).map(([cat, rules]) => [
                    cat,
                    rules.map((r) => ({
                      id: r.id,
                      severity: r.severity,
                      confidence: r.confidence,
                      description: r.description,
                    })),
                  ])
                ),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Filter by category
    if (args.category) {
      const categoryRules = getRulesByCategory(args.category as RuleCategory);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                category: args.category,
                ruleCount: categoryRules.length,
                rules: categoryRules.map((r) => ({
                  id: r.id,
                  severity: r.severity,
                  confidence: r.confidence,
                  description: r.description,
                  help: r.help,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Explain specific rule
    if (args.rule) {
      const normalizedName = args.rule.replace(/^bluebird\//, '');
      const rule = getRuleById(normalizedName);

      if (!rule) {
        return {
          content: [{ type: 'text', text: `Rule not found: ${args.rule}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                id: rule.id,
                category: rule.category,
                severity: rule.severity,
                confidence: rule.confidence,
                analysisPass: rule.analysisPass,
                description: rule.description,
                help: rule.help,
                conditionallyEnabled: !!rule.enabledWhen,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    return {
      content: [{ type: 'text', text: 'No rule or category specified' }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error explaining rule: ${error}` }],
      isError: true,
    };
  }
}
