import { existsSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import type { Diagnostic, ProjectInfo, RunnerWarning, RuleMeta, RuleViolation } from '../types.js';
import { getEnabledRules } from '../rules/index.js';
import type { FileRuleChecker } from '../rules/checkers.js';
import { fileCheckers } from '../rules/checkers.js';
import { parseDisableComments, isDiagnosticSuppressed } from './parse-disable-comments.js';
import { loadTypeScriptFiles, toPosix, type LoadedTypeScriptFiles } from './source-files.js';

export { toPosix } from './source-files.js';

// ─── Public types ───────────────────────────────────────────────────────────

export type { RunnerWarning } from '../types.js';

export interface LintResult {
  diagnostics: Diagnostic[];
  warnings: RunnerWarning[];
}

export interface RunEslintOptions {
  cwd: string;
  project: ProjectInfo;
  includeHeuristic?: boolean;
  includeFiles?: ReadonlySet<string>;
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

function resolveEnabledCheckers(
  enabledRules: readonly Readonly<RuleMeta>[]
): { meta: Readonly<RuleMeta>; checker: FileRuleChecker }[] {
  const entries: { meta: Readonly<RuleMeta>; checker: FileRuleChecker }[] = [];
  for (const rule of enabledRules) {
    const checker = fileCheckers.get(rule.id);
    if (checker) {
      entries.push({ meta: rule, checker });
    }
  }
  return entries;
}

function stripTypeScriptExtension(path: string): string {
  return path.replace(/\.(?:ts|mts|cts)$/i, '');
}

function testFileCandidates(filePath: string): string[] {
  const normalized = toPosix(filePath);
  const base = stripTypeScriptExtension(normalized);
  const nameWithExt = normalized.slice(normalized.lastIndexOf('/') + 1);
  const baseName = stripTypeScriptExtension(nameWithExt);
  const dir = normalized.includes('/') ? normalized.slice(0, normalized.lastIndexOf('/')) : '';
  const inTestsDir = dir.length > 0 ? `${dir}/__tests__/` : '__tests__/';

  return [
    `${base}.spec.ts`,
    `${base}.spec.mts`,
    `${base}.spec.cts`,
    `${base}.test.ts`,
    `${base}.test.mts`,
    `${base}.test.cts`,
    `${inTestsDir}${baseName}.spec.ts`,
    `${inTestsDir}${baseName}.spec.mts`,
    `${inTestsDir}${baseName}.spec.cts`,
    `${inTestsDir}${baseName}.test.ts`,
    `${inTestsDir}${baseName}.test.mts`,
    `${inTestsDir}${baseName}.test.cts`,
  ];
}

function hasMatchingTestFile(
  filePath: string,
  knownFiles: ReadonlySet<string>,
  cwd?: string
): boolean {
  const candidates = testFileCandidates(filePath);
  if (candidates.some((c) => knownFiles.has(c))) return true;
  if (cwd) return candidates.some((c) => existsSync(join(cwd, c)));
  return false;
}

function filterLowTestCoverageDiagnostics(
  diagnostics: Diagnostic[],
  knownFiles: ReadonlySet<string>,
  cwd?: string
): Diagnostic[] {
  return diagnostics.filter((diagnostic) => {
    if (diagnostic.rule !== 'bluebird/low-test-coverage') return true;
    return !hasMatchingTestFile(diagnostic.filePath, knownFiles, cwd);
  });
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
 * Analyses in-memory source files against enabled file-level rules.
 *
 * This is the pure analysis core separated from filesystem I/O so that tests
 * can exercise the full rule pipeline without touching disk.
 *
 * Files with syntax errors are still analysed (TypeScript produces a partial
 * AST) but a {@link RunnerWarning} with `type: "parse-error"` is emitted so
 * callers know analysis quality may be degraded.
 *
 * @param files        - Map of relative file paths to their TypeScript source text.
 * @param project      - Detected project metadata used for rule enablement predicates.
 * @param includeHeuristic - When `true`, heuristic-confidence rules are included.
 * @param cwd          - When provided, test file existence is verified on disk
 *                        so partial (diff-mode) file sets don't cause false positives.
 * @returns Diagnostics sorted by file path then line number, plus any runner warnings.
 */
export function analyseFiles(
  files: ReadonlyMap<string, string>,
  project: ProjectInfo,
  includeHeuristic = false,
  cwd?: string
): LintResult {
  const eslintRules = getEnabledRules(project, includeHeuristic).filter(
    (r) => r.analysisPass === 'eslint'
  );
  const ruleEntries = resolveEnabledCheckers(eslintRules);

  if (ruleEntries.length === 0) return { diagnostics: [], warnings: [] };

  const diagnostics: Diagnostic[] = [];
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

    // Parse inline disable comments for this file
    const disableComments = parseDisableComments(content);

    for (const { meta, checker } of ruleEntries) {
      const ctx = {
        project,
        report(violation: RuleViolation) {
          const diagnostic = buildDiagnostic(meta, violation);
          // Check if this diagnostic is suppressed by an inline comment
          if (!isDiagnosticSuppressed(diagnostic.rule, diagnostic.line, disableComments)) {
            diagnostics.push(diagnostic);
          }
        },
      };
      checker(sourceFile, relPath, ctx);
    }
  }

  const knownFiles = new Set<string>();
  for (const filePath of files.keys()) {
    knownFiles.add(toPosix(filePath));
  }

  const filteredDiagnostics = filterLowTestCoverageDiagnostics(diagnostics, knownFiles, cwd);
  filteredDiagnostics.sort(
    (a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0)
  );

  return { diagnostics: filteredDiagnostics, warnings };
}

// ─── Runner ─────────────────────────────────────────────────────────────────

/**
 * File-level analysis pass: discovers TypeScript source files, parses them,
 * and runs all enabled file-level rule checkers.
 *
 * Files in ignored directories (`node_modules`, `dist`, `.git`, etc.) and
 * declaration files (`.d.ts`, `.d.mts`, `.d.cts`) are excluded.  TypeScript
 * source files with `.ts`, `.mts`, and `.cts` extensions are included.
 * Rules are filtered to only those with `analysisPass: "eslint"` and whose
 * `enabledWhen` predicate (if any) passes for the detected project.
 *
 * File reads are bounded to {@link FILE_READ_CONCURRENCY} concurrent
 * operations to avoid exhausting file descriptor limits on large projects.
 *
 * I/O failures (unreadable directories or files) and parse errors in source
 * files are surfaced as warnings in the result rather than silently ignored.
 *
 * @param options - Runner configuration.
 * @returns Diagnostics sorted by file path then line number, plus runner warnings.
 */
export async function runEslint(options: RunEslintOptions): Promise<LintResult> {
  const { cwd, project, includeHeuristic = false, includeFiles } = options;

  const eslintRules = getEnabledRules(project, includeHeuristic).filter(
    (r) => r.analysisPass === 'eslint'
  );
  const ruleEntries = resolveEnabledCheckers(eslintRules);

  if (ruleEntries.length === 0) return { diagnostics: [], warnings: [] };

  const files = new Map<string, string>();
  const loaded =
    options.sharedFiles !== undefined
      ? await options.sharedFiles
      : await loadTypeScriptFiles({ cwd, includeFiles });

  for (const [filePath, content] of loaded.files) {
    if (!includeFiles || includeFiles.has(filePath)) {
      files.set(filePath, content);
    }
  }

  if (files.size === 0) {
    return { diagnostics: [], warnings: [...loaded.warnings] };
  }

  const result = analyseFiles(files, project, includeHeuristic, cwd);
  result.warnings.unshift(...loaded.warnings);
  return result;
}
