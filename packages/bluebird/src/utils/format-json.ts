import type { CalibrationSummary, ScanResult } from '../types.js';

export interface JsonOutput {
  score: number;
  label: string;
  diagnosticCount: number;
  errorCount: number;
  warningCount: number;
  baselinedCount: number;
  project: ScanResult['project'];
  diagnostics: ScanResult['diagnostics'];
  warnings: ScanResult['warnings'];
  calibration?: CalibrationSummary;
}

export function formatJson(result: ScanResult): string {
  const output: JsonOutput = {
    score: result.score.score,
    label: result.score.label,
    diagnosticCount: result.diagnostics.length,
    errorCount: result.diagnostics.filter((d) => d.severity === 'error').length,
    warningCount: result.diagnostics.filter((d) => d.severity === 'warning').length,
    baselinedCount: result.baselinedCount,
    project: result.project,
    diagnostics: result.diagnostics,
    warnings: result.warnings,
    ...(result.calibration ? { calibration: result.calibration } : {}),
  };
  return JSON.stringify(output, null, 2);
}
