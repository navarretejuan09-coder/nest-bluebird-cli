import type {
  BluebirdConfig,
  BaselineFile,
  Diagnostic,
  ProjectInfo,
  RunnerWarning,
  ScanOptions,
  ScanResult,
} from '../types.js';
import { discoverProject } from './discover-project.js';
import { loadConfig } from './load-config.js';
import { runEslint } from './run-eslint.js';
import { runGraphAnalysis } from './run-graph-analysis.js';
import { runKnip } from './run-knip.js';
import { combineDiagnostics } from './combine-diagnostics.js';
import { filterDiagnostics } from './filter-diagnostics.js';
import { calculateScore } from './calculate-score.js';
import { crossValidate } from './cross-validate.js';
import { loadBaseline, applyBaseline } from './baseline.js';
import { getChangedTypeScriptFiles } from './diff-files.js';
import { loadTypeScriptFiles, toPosix } from './source-files.js';

/** Default timeout for each analysis pass: 5 minutes */
const DEFAULT_PASS_TIMEOUT = 300_000;

/**
 * Error thrown when an analysis pass exceeds its timeout.
 */
export class PassTimeoutError extends Error {
  constructor(passName: string, timeoutMs: number) {
    super(`${passName} pass timed out after ${timeoutMs}ms`);
    this.name = 'PassTimeoutError';
  }
}

/**
 * Wraps a promise with a timeout. Rejects with PassTimeoutError if the promise
 * doesn't resolve within the specified time.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, passName: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PassTimeoutError(passName, timeoutMs));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Result from a single analysis pass.
 */
export interface PassResult {
  pass: 'lint' | 'graph' | 'dead-code';
  diagnosticCount: number;
  elapsedMs: number;
}

/**
 * Progress callbacks for UI feedback during orchestration.
 * All callbacks are optional - if not provided, steps run silently.
 */
export interface ProgressCallbacks {
  /** Called before discovery phase starts */
  onDiscoveryStart?: () => void;
  /** Called after discovery phase completes */
  onDiscoveryComplete?: (project: ProjectInfo, config: BluebirdConfig) => void;
  /** Called if discovery phase fails */
  onDiscoveryError?: (error: unknown) => void;

  /** Called before analysis phase starts */
  onAnalysisStart?: (passes: string[]) => void;
  /** Called before each individual pass starts with file count for progress display */
  onPassStart?: (pass: 'lint' | 'graph' | 'dead-code', fileCount?: number) => void;
  /** Called after each individual pass completes */
  onPassComplete?: (result: PassResult) => void;
  /** Called after all analysis passes complete */
  onAnalysisComplete?: (rawDiagnosticCount: number) => void;
  /** Called if analysis phase fails */
  onAnalysisError?: (error: unknown) => void;
}

/**
 * Internal orchestrator for running Bluebird diagnostics.
 * Both `diagnose()` and `scan()` delegate to this function.
 *
 * Steps:
 * 1. Load configuration from bluebird.config.json or package.json
 * 2. Discover project metadata (NestJS version, ORM, features, etc.)
 * 3. Run enabled analysis passes in parallel (ESLint + Graph + Knip)
 * 4. Combine and filter diagnostics based on config (ignores + waivers)
 * 5. Apply baseline filtering if a .bluebird-baseline.json exists
 * 6. Calculate health score
 */
export async function orchestrate(
  options: ScanOptions = {},
  callbacks: ProgressCallbacks = {}
): Promise<ScanResult> {
  const cwd = options.cwd ?? process.cwd();
  const useBaseline = options.useBaseline ?? true;

  // Phase 1: Discovery - load config, project info, and baseline
  callbacks.onDiscoveryStart?.();

  let config: BluebirdConfig;
  let project: ProjectInfo;
  let baseline: BaselineFile | null;

  try {
    [config, project, baseline] = await Promise.all([
      loadConfig(cwd),
      discoverProject(cwd),
      useBaseline ? loadBaseline(cwd) : Promise.resolve(null),
    ]);
    callbacks.onDiscoveryComplete?.(project, config);
  } catch (err) {
    callbacks.onDiscoveryError?.(err);
    throw err;
  }

  // Merge CLI options with config (CLI takes precedence)
  const lint = options.lint ?? config.lint ?? true;
  const deadCode = options.deadCode ?? config.deadCode ?? true;
  const graphAnalysis = options.graphAnalysis ?? config.graphAnalysis ?? true;
  const includeHeuristic = options.includeHeuristic ?? config.includeHeuristic ?? false;
  const diff = options.diff ?? config.diff;
  const passTimeout = options.passTimeout ?? config.passTimeout ?? DEFAULT_PASS_TIMEOUT;
  const calibrate = options.calibrate ?? config.calibrate ?? false;

  let diffFiles: Set<string> | null = null;
  const orchestrationWarnings: RunnerWarning[] = [];

  if (diff) {
    const diffResult = await getChangedTypeScriptFiles(cwd, diff);
    diffFiles = diffResult.files;
    orchestrationWarnings.push(...diffResult.warnings);

    if (diffFiles !== null && diffFiles.size === 0) {
      return {
        project,
        diagnostics: [],
        warnings: orchestrationWarnings,
        score: calculateScore([]),
        baselinedCount: 0,
      };
    }
  }

  // Phase 2: Analysis - run enabled passes
  const passLabels: string[] = [];
  if (lint) passLabels.push('lint');
  if (graphAnalysis) passLabels.push('graph');
  if (deadCode) passLabels.push('dead-code');

  const parallel = options.parallel ?? false;

  callbacks.onAnalysisStart?.(passLabels);

  const passResults: { diagnostics: Diagnostic[]; warnings: RunnerWarning[] }[] = [];

  if (passLabels.length > 0) {
    const lintOnlyDiffFiles = lint && !graphAnalysis && diffFiles !== null ? diffFiles : undefined;
    const sharedFilesPromise =
      lint || graphAnalysis
        ? loadTypeScriptFiles({ cwd, includeFiles: lintOnlyDiffFiles })
        : undefined;

    // Await shared files to get file count for progress display
    const sharedFiles = sharedFilesPromise ? await sharedFilesPromise : undefined;
    const fileCount = sharedFiles?.files.size;

    try {
      if (parallel) {
        // Run passes in parallel for faster execution
        // Use Promise.allSettled for graceful per-pass error recovery
        const passPromises: {
          name: 'lint' | 'graph' | 'dead-code';
          promise: Promise<{ diagnostics: Diagnostic[]; warnings: RunnerWarning[] }>;
        }[] = [];

        if (lint) {
          passPromises.push({
            name: 'lint',
            promise: withTimeout(
              runEslint({
                cwd,
                project,
                includeHeuristic,
                includeFiles: diffFiles ?? undefined,
                sharedFiles,
              }),
              passTimeout,
              'lint'
            ),
          });
        }

        if (graphAnalysis) {
          passPromises.push({
            name: 'graph',
            promise: withTimeout(
              runGraphAnalysis({
                cwd,
                project,
                includeHeuristic,
                focusFiles: diffFiles ?? undefined,
                sharedFiles,
              }),
              passTimeout,
              'graph'
            ),
          });
        }

        if (deadCode) {
          passPromises.push({
            name: 'dead-code',
            promise: withTimeout(runKnip({ cwd }), passTimeout, 'dead-code'),
          });
        }

        // Use allSettled so one failing pass doesn't kill the entire analysis
        const settledResults = await Promise.allSettled(passPromises.map((p) => p.promise));

        for (let i = 0; i < settledResults.length; i++) {
          const result = settledResults[i];
          const passName = passPromises[i].name;

          if (result.status === 'fulfilled') {
            passResults.push(result.value);
          } else {
            // Pass failed - add a warning but continue with other passes
            passResults.push({
              diagnostics: [],
              warnings: [
                {
                  type: 'io-error',
                  filePath: '.',
                  message: `${passName} pass failed: ${
                    result.reason instanceof Error ? result.reason.message : String(result.reason)
                  }`,
                },
              ],
            });
          }
        }
      } else {
        // Run passes sequentially for per-pass progress feedback
        if (lint) {
          callbacks.onPassStart?.('lint', fileCount);
          const start = performance.now();
          const result = await withTimeout(
            runEslint({
              cwd,
              project,
              includeHeuristic,
              includeFiles: diffFiles ?? undefined,
              sharedFiles,
            }),
            passTimeout,
            'lint'
          );
          passResults.push(result);
          callbacks.onPassComplete?.({
            pass: 'lint',
            diagnosticCount: result.diagnostics.length,
            elapsedMs: performance.now() - start,
          });
        }

        if (graphAnalysis) {
          callbacks.onPassStart?.('graph', fileCount);
          const start = performance.now();
          const result = await withTimeout(
            runGraphAnalysis({
              cwd,
              project,
              includeHeuristic,
              focusFiles: diffFiles ?? undefined,
              sharedFiles,
            }),
            passTimeout,
            'graph'
          );
          passResults.push(result);
          callbacks.onPassComplete?.({
            pass: 'graph',
            diagnosticCount: result.diagnostics.length,
            elapsedMs: performance.now() - start,
          });
        }

        if (deadCode) {
          callbacks.onPassStart?.('dead-code');
          const start = performance.now();
          const result = await withTimeout(runKnip({ cwd }), passTimeout, 'dead-code');
          passResults.push(result);
          callbacks.onPassComplete?.({
            pass: 'dead-code',
            diagnosticCount: result.diagnostics.length,
            elapsedMs: performance.now() - start,
          });
        }
      }

      const totalRaw = passResults.reduce((n, r) => n + r.diagnostics.length, 0);
      callbacks.onAnalysisComplete?.(totalRaw);
    } catch (err) {
      callbacks.onAnalysisError?.(err);
      throw err;
    }
  } else {
    callbacks.onAnalysisComplete?.(0);
  }

  // Phase 3: Post-processing - combine, filter, baseline, score
  const mergedDiagnostics = combineDiagnostics(...passResults.map((r) => r.diagnostics));
  const diffFilteredDiagnostics =
    diffFiles !== null
      ? mergedDiagnostics.filter((diagnostic) => diffFiles!.has(toPosix(diagnostic.filePath)))
      : mergedDiagnostics;
  const allWarnings = [...orchestrationWarnings, ...passResults.flatMap((r) => r.warnings)];
  const afterConfig = filterDiagnostics(diffFilteredDiagnostics, config);

  let finalDiagnostics = afterConfig;
  let baselinedCount = 0;

  if (baseline) {
    finalDiagnostics = applyBaseline(afterConfig, baseline);
    baselinedCount = afterConfig.length - finalDiagnostics.length;
  }

  const score = calculateScore(finalDiagnostics);

  const calibration = calibrate ? crossValidate(finalDiagnostics, project) : undefined;

  return {
    project,
    diagnostics: finalDiagnostics,
    warnings: allWarnings,
    score,
    baselinedCount,
    calibration,
  };
}
