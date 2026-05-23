import ts from 'typescript';
import type { Diagnostic, ProjectInfo, RunnerWarning, RuleMeta, RuleViolation } from '../types.js';
import { getEnabledRules } from '../rules/index.js';
import type { GraphRuleChecker } from '../rules/checkers.js';
import { graphCheckers } from '../rules/checkers.js';
import {
  parseDisableComments,
  isDiagnosticSuppressed,
  type ParsedDisableComments,
} from './parse-disable-comments.js';
import { loadTypeScriptFiles, toPosix, type LoadedTypeScriptFiles } from './source-files.js';

export { toPosix } from './source-files.js';

// ─── Public types ───────────────────────────────────────────────────────────

export interface GraphAnalysisResult {
  diagnostics: Diagnostic[];
  warnings: RunnerWarning[];
}

export interface RunGraphAnalysisOptions {
  cwd: string;
  project: ProjectInfo;
  includeHeuristic?: boolean;
  focusFiles?: ReadonlySet<string>;
  sharedFiles?: LoadedTypeScriptFiles | Promise<LoadedTypeScriptFiles>;
}

// ─── Diagnostic building ────────────────────────────────────────────────────

function buildDiagnostic(meta: Readonly<RuleMeta>, violation: RuleViolation): Diagnostic {
  return {
    filePath: violation.filePath,
    plugin: 'bluebird',
    rule: `bluebird/${meta.id}`,
    severity: meta.severity,
    message: violation.message,
    help: violation.help ?? meta.help,
    line: violation.line,
    column: violation.column,
    category: meta.category,
    confidence: meta.confidence,
  };
}

function resolveEnabledGraphCheckers(
  enabledRules: readonly Readonly<RuleMeta>[]
): { meta: Readonly<RuleMeta>; checker: GraphRuleChecker }[] {
  const entries: { meta: Readonly<RuleMeta>; checker: GraphRuleChecker }[] = [];
  for (const rule of enabledRules) {
    const checker = graphCheckers.get(rule.id);
    if (checker) {
      entries.push({ meta: rule, checker });
    }
  }
  return entries;
}

// ─── Parse diagnostics ─────────────────────────────────────────────────────

interface SourceFileWithParseDiags extends ts.SourceFile {
  parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
}

function collectParseWarning(
  sourceFile: ts.SourceFile,
  relPath: string
): RunnerWarning | undefined {
  const diags = (sourceFile as SourceFileWithParseDiags).parseDiagnostics;
  if (!diags || diags.length === 0) return undefined;
  const n = diags.length;
  return {
    type: 'parse-error',
    filePath: relPath,
    message: `File has ${n} syntax error${n > 1 ? 's' : ''}; analysis may be incomplete`,
  };
}

// ─── Analysis ───────────────────────────────────────────────────────────────

/**
 * Analyses all source files together using enabled graph-level rules.
 *
 * Unlike the ESLint pass (which runs per-file), graph checkers receive the
 * complete map of parsed source files so they can perform cross-file analysis
 * such as circular dependency detection and duplicate route detection.
 *
 * @param files            - Map of relative file paths to their TypeScript source text.
 * @param project          - Detected project metadata used for rule enablement predicates.
 * @param includeHeuristic - When `true`, heuristic-confidence rules are included.
 * @returns Diagnostics sorted by file path then line number, plus any runner warnings.
 */
export function analyseGraph(
  files: ReadonlyMap<string, string>,
  project: ProjectInfo,
  includeHeuristic = false
): GraphAnalysisResult {
  const graphRules = getEnabledRules(project, includeHeuristic).filter(
    (r) => r.analysisPass === 'graph'
  );
  const ruleEntries = resolveEnabledGraphCheckers(graphRules);

  if (ruleEntries.length === 0) return { diagnostics: [], warnings: [] };

  const sourceFiles = new Map<string, ts.SourceFile>();
  const disableCommentsMap = new Map<string, ParsedDisableComments>();
  const warnings: RunnerWarning[] = [];

  for (const [relPath, content] of files) {
    const sourceFile = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );

    const parseWarning = collectParseWarning(sourceFile, relPath);
    if (parseWarning) warnings.push(parseWarning);

    sourceFiles.set(relPath, sourceFile);

    // Parse inline disable comments for this file
    disableCommentsMap.set(relPath, parseDisableComments(content));
  }

  const diagnostics: Diagnostic[] = [];

  for (const { meta, checker } of ruleEntries) {
    const ctx = {
      project,
      report(violation: RuleViolation) {
        const diagnostic = buildDiagnostic(meta, violation);
        // Check if this diagnostic is suppressed by an inline comment
        const disableComments = disableCommentsMap.get(diagnostic.filePath);
        if (
          !disableComments ||
          !isDiagnosticSuppressed(diagnostic.rule, diagnostic.line, disableComments)
        ) {
          diagnostics.push(diagnostic);
        }
      },
    };
    checker(sourceFiles, ctx);
  }

  diagnostics.sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0));

  return { diagnostics, warnings };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

/**
 * Graph-level analysis pass: discovers TypeScript source files, parses them
 * all, then runs enabled graph-level rule checkers against the full set.
 *
 * This pass handles cross-file analysis that the per-file ESLint pass cannot
 * perform — module dependency graph cycles, duplicate route detection across
 * controllers, and DI graph validation.
 *
 * Files in ignored directories and declaration files are excluded. File reads
 * are bounded to {@link FILE_READ_CONCURRENCY} concurrent operations.
 *
 * @param options - Runner configuration.
 * @returns Diagnostics sorted by file path then line number, plus runner warnings.
 */
export async function runGraphAnalysis(
  options: RunGraphAnalysisOptions
): Promise<GraphAnalysisResult> {
  const { cwd, project, includeHeuristic = false, focusFiles } = options;

  const graphRules = getEnabledRules(project, includeHeuristic).filter(
    (r) => r.analysisPass === 'graph'
  );
  const ruleEntries = resolveEnabledGraphCheckers(graphRules);

  if (ruleEntries.length === 0) return { diagnostics: [], warnings: [] };

  const loaded =
    options.sharedFiles !== undefined
      ? await options.sharedFiles
      : await loadTypeScriptFiles({ cwd });

  if (loaded.files.size === 0) {
    return { diagnostics: [], warnings: [...loaded.warnings] };
  }

  const result = analyseGraph(loaded.files, project, includeHeuristic);
  if (focusFiles) {
    result.diagnostics = result.diagnostics.filter((diagnostic) =>
      focusFiles.has(toPosix(diagnostic.filePath))
    );
  }
  result.warnings.unshift(...loaded.warnings);
  return result;
}
