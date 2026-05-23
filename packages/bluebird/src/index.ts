import type { ScanOptions, ScanResult } from './types.js';
import { orchestrate } from './utils/orchestrate.js';

export type {
  AnalysisPass,
  BaselineEntry,
  BaselineFile,
  BluebirdConfig,
  CalibrationOutcome,
  CalibrationSummary,
  Diagnostic,
  FailOnThreshold,
  LayerAssignment,
  LayerViolation,
  LayersOutputFormat,
  LayersResult,
  ModuleNode,
  OutputFormat,
  ProjectInfo,
  RuleCategory,
  RuleConfidence,
  RuleContext,
  RuleMeta,
  RuleViolation,
  RunnerWarning,
  ScanOptions,
  ScanResult,
  ScoreResult,
  Severity,
  Waiver,
} from './types.js';

export {
  getAllRules,
  getEnabledRules,
  getRuleById,
  getRulesByCategory,
  getRulesByConfidence,
} from './rules/index.js';

export type { FileRuleChecker, GraphRuleChecker } from './rules/checkers.js';
export { fileCheckers, graphCheckers } from './rules/checkers.js';

export type { RunEslintOptions, LintResult } from './utils/run-eslint.js';
export { runEslint, analyseFiles } from './utils/run-eslint.js';

export type { RunGraphAnalysisOptions, GraphAnalysisResult } from './utils/run-graph-analysis.js';
export { runGraphAnalysis, analyseGraph } from './utils/run-graph-analysis.js';

export type { RunKnipOptions, KnipResult } from './utils/run-knip.js';
export { runKnip, convertKnipIssues, findMonorepoRoot } from './utils/run-knip.js';

export type { InitOptions, InitResult } from './utils/init-config.js';
export { initConfig } from './utils/init-config.js';

export type { ParsedDisableComments, DisabledRange } from './utils/parse-disable-comments.js';
export { parseDisableComments, isDiagnosticSuppressed } from './utils/parse-disable-comments.js';

export {
  loadBaseline,
  saveBaseline,
  applyBaseline,
  baselineKey,
  BASELINE_FILE,
} from './utils/baseline.js';

export { loadConfig, validateConfig, ConfigValidationError } from './utils/load-config.js';
export { filterDiagnostics, matchGlob, globToRegex } from './utils/filter-diagnostics.js';
export { calculateScore } from './utils/calculate-score.js';
export { crossValidate } from './utils/cross-validate.js';
export { combineDiagnostics } from './utils/combine-diagnostics.js';
export { orchestrate, PassTimeoutError, type ProgressCallbacks } from './utils/orchestrate.js';

export { formatText } from './utils/format-text.js';
export { formatJson } from './utils/format-json.js';
export type { JsonOutput } from './utils/format-json.js';
export { formatSarif } from './utils/format-sarif.js';

// Layers analysis
export { analyseModuleLayers, loadSourceFilesForLayers } from './utils/layers.js';
export {
  formatLayers,
  formatLayersText,
  formatLayersJson,
  formatLayersMermaid,
} from './utils/format-layers.js';

// MCP server
export { createMcpServer, startMcpServer, TOOLS as MCP_TOOLS } from './mcp/index.js';

/**
 * Main entry point for running Bluebird diagnostics on a NestJS project.
 *
 * Orchestrates the following steps:
 * 1. Load configuration from bluebird.config.json or package.json
 * 2. Discover project metadata (NestJS version, ORM, features, etc.)
 * 3. Run enabled analysis passes in parallel (ESLint + Graph + Knip)
 * 4. Combine and filter diagnostics based on config (ignores + waivers)
 * 5. Apply baseline filtering if a .bluebird-baseline.json exists
 * 6. Calculate health score
 */
export async function diagnose(options: ScanOptions = {}): Promise<ScanResult> {
  return orchestrate(options);
}
