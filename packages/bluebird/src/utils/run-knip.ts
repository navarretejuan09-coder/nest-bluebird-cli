import fs from 'node:fs';
import path from 'node:path';
import { MAX_KNIP_RETRIES } from '../constants.js';
import type { Diagnostic, RunnerWarning } from '../types.js';

type KnipMainFn = (options: KnipMainOptions) => Promise<{ issues: KnipIssues }>;
type KnipCreateOptionsFn = (options: Record<string, unknown>) => Promise<KnipMainOptions>;
type KnipMainOptions = { parsedConfig: Record<string, unknown> };

let _knipMain: KnipMainFn | undefined;
let _knipCreateOptions: KnipCreateOptionsFn | undefined;

async function getKnipMain(): Promise<KnipMainFn> {
  if (!_knipMain) {
    const mod = (await import('knip')) as unknown as { main: KnipMainFn };
    _knipMain = mod.main;
  }
  return _knipMain;
}

async function getKnipCreateOptions(): Promise<KnipCreateOptionsFn> {
  if (!_knipCreateOptions) {
    const mod = (await import('knip/session')) as unknown as { createOptions: KnipCreateOptionsFn };
    _knipCreateOptions = mod.createOptions;
  }
  return _knipCreateOptions;
}

/** @internal Reset cached knip imports; call in test teardown. */
export function resetKnipCache(main?: KnipMainFn, createOptions?: KnipCreateOptionsFn): void {
  _knipMain = main;
  _knipCreateOptions = createOptions;
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface KnipResult {
  diagnostics: Diagnostic[];
  warnings: RunnerWarning[];
}

export interface RunKnipOptions {
  cwd: string;
}

// ─── Knip issue types ───────────────────────────────────────────────────────

export interface KnipIssue {
  filePath: string;
  symbol: string;
  line?: number;
  col?: number;
}

export type KnipIssueRecords = Record<string, Record<string, KnipIssue>>;

export interface KnipIssues {
  files: Set<string>;
  exports: KnipIssueRecords;
  types: KnipIssueRecords;
  duplicates: KnipIssueRecords;
}

// ─── Path normalization ─────────────────────────────────────────────────────

export const toPosix = (p: string): string => p.replaceAll('\\', '/');

// ─── Barrel file detection ───────────────────────────────────────────────────

/**
 * Checks if a file path represents a barrel file (index.ts/index.js).
 * Barrel files only contain re-exports and should not trigger "unused export"
 * warnings as they aggregate exports from other modules for cleaner imports.
 */
export function isBarrelFile(filePath: string): boolean {
  const normalized = toPosix(filePath);
  const filename = normalized.split('/').pop() ?? '';
  return filename === 'index.ts' || filename === 'index.js';
}

// ─── Diagnostic conversion ──────────────────────────────────────────────────

const KNIP_MESSAGE_MAP: Record<string, string> = {
  files: 'Unused file',
  exports: 'Unused export',
  types: 'Unused exported type',
  duplicates: 'Duplicate export',
};

const KNIP_HELP_MAP: Record<string, string> = {
  files: 'This file is not imported by any other file in the project.',
  exports:
    'This export is not used anywhere in the project. Consider removing it or marking it as an entry point in knip config.',
  types:
    'This exported type is not imported anywhere else. If it is only used within the same file, remove the `export` keyword. If it is truly unused, consider removing it entirely.',
  duplicates:
    'This export is duplicated elsewhere in the project. Consider consolidating to a single location.',
};

function collectIssueRecords(
  records: KnipIssueRecords,
  issueType: string,
  rootDirectory: string
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const issues of Object.values(records)) {
    for (const issue of Object.values(issues)) {
      // Skip "exports" and "types" warnings for barrel files (index.ts/index.js)
      // Barrel files only contain re-exports and are intentionally used
      // to aggregate exports from submodules for cleaner imports.
      // Type re-exports (export type { X }) are also just aggregation.
      if ((issueType === 'exports' || issueType === 'types') && isBarrelFile(issue.filePath)) {
        continue;
      }

      diagnostics.push({
        filePath: toPosix(path.relative(rootDirectory, issue.filePath)),
        plugin: 'knip',
        rule: `knip/${issueType}`,
        severity: 'warning',
        message: `${KNIP_MESSAGE_MAP[issueType]}: ${issue.symbol}`,
        help: KNIP_HELP_MAP[issueType],
        line: issue.line ?? 0,
        column: issue.col ?? 0,
        category: 'dead-code',
        confidence: 'deterministic',
      });
    }
  }

  return diagnostics;
}

/**
 * Converts raw knip issues into bluebird diagnostics.
 *
 * Separated from I/O so tests can exercise conversion logic without running knip.
 */
export function convertKnipIssues(issues: KnipIssues, rootDirectory: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const unusedFile of issues.files) {
    diagnostics.push({
      filePath: toPosix(path.relative(rootDirectory, unusedFile)),
      plugin: 'knip',
      rule: 'knip/files',
      severity: 'warning',
      message: KNIP_MESSAGE_MAP['files'],
      help: 'This file is not imported by any other file in the project.',
      line: 0,
      column: 0,
      category: 'dead-code',
      confidence: 'deterministic',
    });
  }

  const recordTypes = ['exports', 'types', 'duplicates'] as const;
  for (const issueType of recordTypes) {
    diagnostics.push(...collectIssueRecords(issues[issueType], issueType, rootDirectory));
  }

  return diagnostics;
}

// ─── Monorepo detection ─────────────────────────────────────────────────────

const MONOREPO_MARKERS = [
  'pnpm-workspace.yaml',
  'pnpm-workspace.yml',
  'lerna.json',
  'nx.json',
  'rush.json',
];

export function findMonorepoRoot(directory: string): string | null {
  let current = path.resolve(directory);
  const root = path.parse(current).root;

  // Start from the parent — the given directory is the workspace, not the root
  current = path.dirname(current);

  while (current !== root) {
    for (const marker of MONOREPO_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

// ─── Knip execution ─────────────────────────────────────────────────────────

const CONFIG_LOADING_ERROR_PATTERN = /Error loading .*[/\\]([\w][\w.-]*)\.config\./;

export function extractFailedPluginName(error: unknown): string | null {
  const match = String(error).match(CONFIG_LOADING_ERROR_PATTERN);
  return match?.[1] ?? null;
}

/**
 * TSConfig filenames to check, in priority order.
 * NestJS projects commonly use tsconfig.build.json for production builds,
 * but we prefer tsconfig.base.json or tsconfig.json for analysis as they
 * typically include all source files.
 */
const TSCONFIG_FILENAMES = [
  'tsconfig.base.json',
  'tsconfig.json',
  'tsconfig.lib.json',
  'tsconfig.app.json',
];

export function resolveTsConfigFile(directory: string): string | undefined {
  return TSCONFIG_FILENAMES.find((filename) => fs.existsSync(path.join(directory, filename)));
}

export function hasNodeModules(directory: string): boolean {
  const nodeModulesPath = path.join(directory, 'node_modules');
  try {
    return fs.existsSync(nodeModulesPath) && fs.statSync(nodeModulesPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Default entry points for NestJS projects that Knip doesn't recognize automatically.
 * These are commonly used patterns that should not be flagged as unused.
 */
const NESTJS_ENTRY_PATTERNS = [
  // NestJS application entry point - bootstrap file that starts the app
  'main.ts',
  'main.js',
  'src/main.ts',
  'src/main.js',
  '**/main.ts',
  '**/main.js',
  // OpenTelemetry instrumentation - imported by main.ts before NestJS starts
  'instrumentation.ts',
  'instrumentation.js',
  'src/instrumentation.ts',
  'src/instrumentation.js',
  '**/instrumentation.ts',
  '**/instrumentation.js',
  // TypeORM CLI data source configurations
  'data-source.ts',
  'data-source.js',
  '**/data-source.ts',
  '**/data-source.js',
  'ormconfig.ts',
  'ormconfig.js',
  // Migration runners (standalone CLI entry points)
  '**/run-migrations.ts',
  '**/run-migrations.js',
  '**/run-migration.ts',
  '**/run-migration.js',
  // Seeder scripts
  '**/seed.ts',
  '**/seed.js',
  '**/seeder.ts',
  '**/seeder.js',
  // Integration tests (often not in standard test patterns)
  'test/integration/**/*.ts',
  'test/integration/**/*.js',
  'tests/integration/**/*.ts',
  'tests/integration/**/*.js',
  // E2E tests
  'test/e2e/**/*.ts',
  'test/e2e/**/*.js',
  'tests/e2e/**/*.ts',
  'tests/e2e/**/*.js',
  // Test mocks and factories (often dynamically imported)
  'test/dependencyMocks/**/*.ts',
  'test/dependencyMocks/**/*.js',
  'test/mocks/**/*.ts',
  'test/mocks/**/*.js',
  'test/factories/**/*.ts',
  'test/factories/**/*.js',
  'test/fixtures/**/*.ts',
  'test/fixtures/**/*.js',
  'test/helpers/**/*.ts',
  'test/helpers/**/*.js',
];

/**
 * Patterns for files that are loaded dynamically by ORMs/frameworks at runtime.
 * These should be marked as entry points to prevent false "unused file" warnings.
 */
const DYNAMIC_LOAD_PATTERNS = [
  // TypeORM entities (loaded via glob patterns)
  '**/entity/*.ts',
  '**/entity/*.js',
  '**/entities/*.ts',
  '**/entities/*.js',
  // TypeORM migrations (loaded via glob patterns)
  '**/migration/*.ts',
  '**/migration/*.js',
  '**/migrations/*.ts',
  '**/migrations/*.js',
  // TypeORM subscribers
  '**/subscriber/*.ts',
  '**/subscriber/*.js',
  '**/subscribers/*.ts',
  '**/subscribers/*.js',
];

export async function runKnipWithOptions(
  knipCwd: string,
  workspaceName?: string
): Promise<{ issues: KnipIssues }> {
  const [knipMain, knipCreateOptions] = await Promise.all([getKnipMain(), getKnipCreateOptions()]);

  const tsConfigFile = resolveTsConfigFile(knipCwd);
  const options = await knipCreateOptions({
    cwd: knipCwd,
    isShowProgress: false,
    isFix: false, // Prevent knip from modifying any files
    ...(workspaceName ? { workspace: workspaceName } : {}),
    ...(tsConfigFile ? { tsConfigFile } : {}),
  });

  const parsedConfig = options.parsedConfig;

  // Add NestJS-aware entry points to prevent false positives
  // These are files that are used as CLI entry points or loaded dynamically by TypeORM
  const existingEntry = (parsedConfig.entry as string[] | undefined) ?? [];
  parsedConfig.entry = [...existingEntry, ...NESTJS_ENTRY_PATTERNS, ...DYNAMIC_LOAD_PATTERNS];

  for (let attempt = 0; attempt <= MAX_KNIP_RETRIES; attempt++) {
    try {
      return await knipMain(options);
    } catch (error) {
      const failedPlugin = extractFailedPluginName(error);
      if (!failedPlugin || attempt === MAX_KNIP_RETRIES) {
        throw error;
      }
      parsedConfig[failedPlugin] = false;
    }
  }

  throw new Error('Unreachable');
}

// ─── Workspace error detection ──────────────────────────────────────────────

const WORKSPACE_ERROR_PATTERNS = [
  /workspace/i,
  /Cannot find configuration/i,
  /No matching project/i,
  /not found in workspaces/i,
];

export function isWorkspaceResolutionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return WORKSPACE_ERROR_PATTERNS.some((p) => p.test(message));
}

// ─── Runner ─────────────────────────────────────────────────────────────────

/**
 * Dead code analysis pass: runs knip to detect unused files, exports, types,
 * and duplicates.
 *
 * Skips analysis if `node_modules` is not present (dependencies not installed).
 * For monorepo workspaces, attempts to run knip from the monorepo root with
 * workspace scoping, falling back to running from the workspace directory.
 *
 * Plugin config-loading errors are retried up to {@link MAX_KNIP_RETRIES}
 * times, disabling the failing plugin on each attempt.
 *
 * @param options - Runner configuration.
 * @returns Diagnostics for dead code issues, plus any runner warnings.
 */
export async function runKnip(options: RunKnipOptions): Promise<KnipResult> {
  const { cwd } = options;
  const warnings: RunnerWarning[] = [];

  const monorepoRoot = findMonorepoRoot(cwd);
  const hasInstalledDeps =
    hasNodeModules(cwd) || (monorepoRoot !== null && hasNodeModules(monorepoRoot));

  if (!hasInstalledDeps) {
    warnings.push({
      type: 'io-error',
      filePath: '.',
      message:
        'Skipping dead code analysis: node_modules not found. Run your package manager install first.',
    });
    return { diagnostics: [], warnings };
  }

  let knipResult: { issues: KnipIssues };

  try {
    if (monorepoRoot) {
      const packageJsonPath = path.join(cwd, 'package.json');
      let workspaceName: string;
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        workspaceName = packageJson.name ?? path.basename(cwd);
      } catch {
        workspaceName = path.basename(cwd);
      }

      try {
        knipResult = await runKnipWithOptions(monorepoRoot, workspaceName);
      } catch (rootError) {
        if (!isWorkspaceResolutionError(rootError)) {
          throw rootError;
        }
        warnings.push({
          type: 'io-error',
          filePath: '.',
          message: `Workspace resolution failed, falling back to local analysis: ${rootError instanceof Error ? rootError.message : String(rootError)}`,
        });
        knipResult = await runKnipWithOptions(cwd);
      }
    } else {
      knipResult = await runKnipWithOptions(cwd);
    }
  } catch (error) {
    warnings.push({
      type: 'io-error',
      filePath: '.',
      message: `Knip analysis failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { diagnostics: [], warnings };
  }

  const diagnostics = convertKnipIssues(knipResult.issues, cwd);

  diagnostics.sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0));

  return { diagnostics, warnings };
}
