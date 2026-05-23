import type {
  CalibrationOutcome,
  CalibrationSummary,
  Diagnostic,
  ProjectInfo,
  ScoreResult,
} from '../types.js';
import { calculateScore } from './calculate-score.js';

/**
 * Rules where heuristic confidence + project metadata can refute the finding.
 * Each entry maps a rule id to a predicate: if it returns true the diagnostic
 * is reclassified as a likely false positive.
 */
const heuristicRefuters: Record<string, (d: Diagnostic, project: ProjectInfo) => boolean> = {
  // ─── Small-project thresholds ──────────────────────────────────────────────
  'bluebird/missing-global-guard': (_d, project) => project.sourceFileCount < 30,
  'bluebird/missing-helmet': (_d, project) => project.sourceFileCount < 30,
  'bluebird/missing-exception-filter': (_d, project) => project.sourceFileCount < 30,
  'bluebird/missing-rate-limiting': (_d, project) => project.sourceFileCount < 50,
  'bluebird/prefer-pagination': (_d, project) => project.sourceFileCount < 50,

  // ─── ORM rules (valid when ORM detected) ───────────────────────────────────
  'bluebird/missing-indexes': (_d, project) => project.orm === 'none',
  'bluebird/missing-migration': (_d, project) => project.orm === 'none',

  // ─── Security ──────────────────────────────────────────────────────────────
  'bluebird/missing-csrf-protection': (_d, project) => project.httpAdapter === 'fastify',

  // ─── Config - FP if config module not used at all ──────────────────────────
  'bluebird/missing-config-validation': (_d, project) => !project.features.config,

  // ─── Test coverage - skip if no test infrastructure detected ───────────────
  'bluebird/low-test-coverage': (_d, project) => !project.hasTests,

  // NOTE: Rules with enabledWhen gates don't need refuters:
  // - missing-caching: enabledWhen features.cache
  // - no-inconsistent-http-status: enabledWhen strictTypeScript
};

/**
 * Deterministic rules are always confirmed unless explicitly overridden.
 */
function classifyDiagnostic(d: Diagnostic, project: ProjectInfo): CalibrationOutcome {
  if (d.confidence === 'deterministic') {
    return 'confirmed';
  }

  const refuter = heuristicRefuters[d.rule];
  if (refuter && refuter(d, project)) {
    return 'likely_false_positive';
  }

  if (d.confidence === 'heuristic') {
    return 'uncertain';
  }

  return 'confirmed';
}

/**
 * Annotates each diagnostic with a calibration outcome and returns a summary
 * including a calibrated score that excludes likely false positives.
 *
 * Mutates the `calibration` field on each diagnostic in-place.
 */
export function crossValidate(diagnostics: Diagnostic[], project: ProjectInfo): CalibrationSummary {
  let confirmedCount = 0;
  let uncertainCount = 0;
  let likelyFalsePositiveCount = 0;

  for (const d of diagnostics) {
    const outcome = classifyDiagnostic(d, project);
    d.calibration = outcome;

    switch (outcome) {
      case 'confirmed':
        confirmedCount++;
        break;
      case 'uncertain':
        uncertainCount++;
        break;
      case 'likely_false_positive':
        likelyFalsePositiveCount++;
        break;
    }
  }

  const calibratedDiags = diagnostics.filter((d) => d.calibration !== 'likely_false_positive');
  const calibratedScore: ScoreResult = calculateScore(calibratedDiags);

  return {
    confirmedCount,
    uncertainCount,
    likelyFalsePositiveCount,
    calibratedScore,
  };
}
