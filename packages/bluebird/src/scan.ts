import ora, { type Ora } from 'ora';
import pc from 'picocolors';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sep } from 'node:path';
import type {
  FailOnThreshold,
  OutputFormat,
  ProjectInfo,
  ScanOptions,
  ScanResult,
} from './types.js';
import { orchestrate, type ProgressCallbacks, type PassResult } from './utils/orchestrate.js';
import { formatText } from './utils/format-text.js';
import { formatJson } from './utils/format-json.js';
import { formatSarif } from './utils/format-sarif.js';
import { formatHtml } from './utils/format-html.js';
import { openInBrowser } from './utils/open-browser.js';

function getFormatter(format: OutputFormat): (result: ScanResult, verbose: boolean) => string {
  switch (format) {
    case 'json':
      return (r) => formatJson(r);
    case 'sarif':
      return (r) => formatSarif(r);
    case 'html':
      return (r) => formatHtml(r);
    case 'text':
      return (r, v) => formatText(r, v);
    default: {
      const _exhaustive: never = format;
      throw new Error(`Unsupported output format: ${_exhaustive}`);
    }
  }
}

function shouldFail(result: ScanResult, failOn: FailOnThreshold, scoreThreshold?: number): boolean {
  if (scoreThreshold !== undefined && result.score.score < scoreThreshold) {
    return true;
  }
  switch (failOn) {
    case 'none':
      return false;
    case 'warning':
      return result.diagnostics.length > 0;
    case 'error':
      return result.diagnostics.some((d) => d.severity === 'error');
    default: {
      const _exhaustive: never = failOn;
      throw new Error(`Unknown fail-on threshold: ${_exhaustive}`);
    }
  }
}

function projectSummaryLine(project: ProjectInfo): string {
  const parts: string[] = [`NestJS ${project.nestVersion ?? 'unknown'}`, project.httpAdapter];
  if (project.orm !== 'none') parts.push(project.orm);
  parts.push(`${project.sourceFileCount} files`);

  const features = Object.entries(project.features)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (features.length > 0) parts.push(features.join(', '));

  return parts.join(' · ');
}

function getPassLabel(pass: PassResult['pass'], fileCount?: number): string {
  const labels: Record<PassResult['pass'], string> = {
    lint: 'Lint analysis',
    graph: 'Graph analysis',
    'dead-code': 'Dead code analysis',
  };
  const label = labels[pass];
  // Show file count for larger projects (100+ files)
  if (fileCount && fileCount >= 100) {
    return `${label} (${fileCount} files)`;
  }
  return label;
}

function formatElapsed(ms: number): string {
  return (ms / 1000).toFixed(1) + 's';
}

function formatDiagnosticCount(count: number): string {
  return `${count} diagnostic${count === 1 ? '' : 's'}`;
}

/**
 * Creates progress callbacks that drive ora spinners for interactive text mode.
 * In parallel mode, shows a single combined spinner instead of per-pass spinners.
 */
function createSpinnerCallbacks(parallel: boolean): {
  callbacks: ProgressCallbacks;
  getActiveSpinner: () => Ora | null;
} {
  let initSpinner: Ora | null = null;
  let passSpinner: Ora | null = null;
  let analysisSpinner: Ora | null = null;
  let analysisStart: number = 0;

  const callbacks: ProgressCallbacks = {
    onDiscoveryStart() {
      initSpinner = ora('Initializing scan…').start();
    },
    onDiscoveryComplete(project) {
      initSpinner?.succeed(`Project detected  ${pc.dim(projectSummaryLine(project))}`);
      initSpinner = null;
    },
    onDiscoveryError() {
      initSpinner?.fail('Failed to initialize scan');
      initSpinner = null;
    },

    onAnalysisStart(passes) {
      if (parallel && passes.length > 0) {
        // In parallel mode, show a combined spinner for all passes
        analysisStart = performance.now();
        analysisSpinner = ora(`Running ${passes.join(' + ')} passes in parallel…`).start();
      }
    },
    onPassStart(pass, fileCount) {
      if (!parallel) {
        passSpinner = ora(getPassLabel(pass, fileCount)).start();
      }
    },
    onPassComplete(result) {
      if (!parallel) {
        const label = getPassLabel(result.pass);
        const elapsed = pc.dim(formatElapsed(result.elapsedMs));
        const count = pc.dim(`(${formatDiagnosticCount(result.diagnosticCount)})`);
        passSpinner?.succeed(`${label}  ${elapsed}  ${count}`);
        passSpinner = null;
      }
    },
    onAnalysisComplete(rawCount) {
      if (parallel && analysisSpinner) {
        const elapsed = pc.dim(formatElapsed(performance.now() - analysisStart));
        const count = pc.dim(`(${formatDiagnosticCount(rawCount)})`);
        analysisSpinner.succeed(`Analysis complete  ${elapsed}  ${count}`);
        analysisSpinner = null;
      }
    },
    onAnalysisError() {
      if (parallel) {
        analysisSpinner?.fail('Analysis failed');
        analysisSpinner = null;
      } else {
        passSpinner?.fail('Analysis failed');
        passSpinner = null;
      }
    },
  };

  return {
    callbacks,
    getActiveSpinner: () => initSpinner ?? passSpinner ?? analysisSpinner,
  };
}

export interface ScanCliOptions extends ScanOptions {
  /** When true, print only the numeric score and exit. */
  scoreOnly?: boolean;
  /** When true with HTML format, write to a temp file and open in browser. */
  open?: boolean;
}

export async function scan(options: ScanCliOptions): Promise<void> {
  const format: OutputFormat = options.format ?? 'text';
  const verbose = options.verbose ?? false;
  const quiet = options.quiet ?? false;
  const failOn: FailOnThreshold = options.failOn ?? 'error';
  const isHuman = format === 'text';

  // Score-only mode: run analysis, print the number, set exit code, done
  if (options.scoreOnly) {
    const result = await orchestrate(options);
    process.stdout.write(String(result.score.score) + '\n');
    if (shouldFail(result, failOn, options.scoreThreshold)) {
      process.exitCode = 1;
    }
    return;
  }

  // Machine-readable formats or quiet mode: no interactive UI
  if (!isHuman || quiet) {
    const result = await orchestrate(options);
    if (!quiet) {
      const output = getFormatter(format)(result, verbose);

      // Handle --open flag for HTML format
      if (options.open && format === 'html') {
        // Use mkdtemp to create a secure temporary directory (prevents symlink attacks)
        const tempDir = await mkdtemp(join(tmpdir(), `bluebird-report-${sep}`));
        const filepath = join(tempDir, 'report.html');
        await writeFile(filepath, output, 'utf-8');
        console.log(pc.green(`Report saved to: ${filepath}`));
        try {
          await openInBrowser(filepath);
          console.log(pc.dim('Opened in browser'));
        } catch {
          // Don't fail the scan if browser fails to open (e.g., headless environment)
          console.log(pc.yellow(`Warning: Could not open browser automatically`));
          console.log(pc.dim(`You can open the report manually: ${filepath}`));
        }
      } else {
        process.stdout.write(output + '\n');
      }
    }
    if (shouldFail(result, failOn, options.scoreThreshold)) {
      process.exitCode = 1;
    }
    return;
  }

  // Interactive text mode: use spinners for progress feedback
  const parallel = options.parallel ?? false;
  const { callbacks } = createSpinnerCallbacks(parallel);

  const result = await orchestrate(options, callbacks);

  try {
    console.log(formatText(result, verbose));
  } catch (err) {
    console.error(pc.red('Failed to format output'));
    throw err;
  }

  if (shouldFail(result, failOn, options.scoreThreshold)) {
    process.exitCode = 1;
  }
}
