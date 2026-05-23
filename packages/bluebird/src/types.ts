export type Severity = 'error' | 'warning';

export type RuleConfidence = 'deterministic' | 'heuristic';

export type CalibrationOutcome = 'confirmed' | 'uncertain' | 'likely_false_positive';

export type OutputFormat = 'text' | 'json' | 'sarif' | 'html';

export type AnalysisPass = 'eslint' | 'graph' | 'knip';

export interface Diagnostic {
  filePath: string;
  plugin: string;
  rule: string;
  severity: Severity;
  message: string;
  help?: string;
  line?: number;
  column?: number;
  category: RuleCategory;
  confidence: RuleConfidence;
  weight?: number;
  calibration?: CalibrationOutcome;
}

export type RuleCategory =
  | 'architecture'
  | 'security'
  | 'performance'
  | 'correctness'
  | 'api-design'
  | 'database'
  | 'testing'
  | 'microservices'
  | 'graphql'
  | 'websockets'
  | 'dead-code';

export interface RuleMeta {
  id: string;
  category: RuleCategory;
  severity: Severity;
  confidence: RuleConfidence;
  description: string;
  help: string;
  analysisPass: AnalysisPass;
  enabledWhen?: (project: ProjectInfo) => boolean;
}

export interface RuleViolation {
  filePath: string;
  message: string;
  line?: number;
  column?: number;
  help?: string;
}

export interface RuleContext {
  project: ProjectInfo;
  report(violation: RuleViolation): void;
}

export type HttpAdapter = 'express' | 'fastify' | 'unknown';

export type OrmKind =
  | 'typeorm'
  | 'prisma'
  | 'mongoose'
  | 'sequelize'
  | 'mikroorm'
  | 'drizzle'
  | 'none';

export interface ProjectInfo {
  nestVersion: string | null;
  httpAdapter: HttpAdapter;
  orm: OrmKind;
  features: DetectedFeatures;
  strictTypeScript: boolean;
  hasTests: boolean;
  sourceFileCount: number;
}

export interface DetectedFeatures {
  graphql: boolean;
  websockets: boolean;
  microservices: boolean;
  cqrs: boolean;
  swagger: boolean;
  bull: boolean;
  config: boolean;
  throttler: boolean;
  cache: boolean;
}

export interface Waiver {
  rule: string;
  file: string;
  reason: string;
}

export interface BluebirdConfig {
  ignore?: {
    rules?: string[];
    files?: string[];
  };
  lint?: boolean;
  deadCode?: boolean;
  graphAnalysis?: boolean;
  verbose?: boolean;
  diff?: string;
  includeHeuristic?: boolean;
  waivers?: Waiver[];
  /** Timeout in milliseconds for each analysis pass. Defaults to 300000 (5 minutes). */
  passTimeout?: number;
  /** Enable calibration mode: cross-validates diagnostics and annotates with confidence outcomes. */
  calibrate?: boolean;
}

export type FailOnThreshold = 'error' | 'warning' | 'none';

export interface ScanOptions {
  cwd?: string;
  verbose?: boolean;
  quiet?: boolean;
  diff?: string;
  lint?: boolean;
  deadCode?: boolean;
  graphAnalysis?: boolean;
  format?: OutputFormat;
  includeHeuristic?: boolean;
  useBaseline?: boolean;
  failOn?: FailOnThreshold;
  /** Minimum passing score (0-100). Exit with code 1 when the score falls below this. */
  scoreThreshold?: number;
  /** Run analysis passes in parallel for faster execution (disables per-pass progress) */
  parallel?: boolean;
  /** Timeout in milliseconds for each analysis pass. Defaults to 300000 (5 minutes). */
  passTimeout?: number;
  /** Enable calibration mode: cross-validates diagnostics and annotates with confidence outcomes. */
  calibrate?: boolean;
}

export interface BaselineEntry {
  rule: string;
  filePath: string;
  line: number;
}

export interface BaselineFile {
  version: 1;
  createdAt: string;
  entries: BaselineEntry[];
}

export interface ScoreResult {
  score: number;
  label: string;
}

export interface CalibrationSummary {
  confirmedCount: number;
  uncertainCount: number;
  likelyFalsePositiveCount: number;
  calibratedScore: ScoreResult;
}

export interface RunnerWarning {
  type: 'io-error' | 'parse-error';
  filePath: string;
  message: string;
}

export interface ScanResult {
  project: ProjectInfo;
  diagnostics: Diagnostic[];
  warnings: RunnerWarning[];
  score: ScoreResult;
  baselinedCount: number;
  calibration?: CalibrationSummary;
}

// ─── Layers Analysis Types ──────────────────────────────────────────────────

export interface ModuleNode {
  className: string;
  filePath: string;
  line: number;
  imports: string[];
}

export interface LayerAssignment {
  moduleName: string;
  filePath: string;
  layer: number;
}

export interface LayerViolation {
  source: {
    moduleName: string;
    filePath: string;
    layer: number;
  };
  target: {
    moduleName: string;
    filePath: string;
    layer: number;
  };
  layerDistance: number;
  severity: number;
  message: string;
}

export interface LayersResult {
  layers: LayerAssignment[];
  violations: LayerViolation[];
  maxLayer: number;
  layerCounts: Record<number, number>;
  verdict: string;
}

export type LayersOutputFormat = 'text' | 'json' | 'mermaid';
