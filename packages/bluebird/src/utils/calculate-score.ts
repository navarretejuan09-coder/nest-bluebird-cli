import {
  INSTANCE_CAP,
  INSTANCE_PENALTY_ERROR,
  INSTANCE_PENALTY_WARNING,
  PENALTY_ERROR,
  PENALTY_WARNING,
  SCORE_LABEL_CRITICAL,
  SCORE_LABEL_GREAT,
  SCORE_LABEL_NEEDS_WORK,
  SCORE_MAX,
  SCORE_THRESHOLD_GREAT,
  SCORE_THRESHOLD_NEEDS_WORK,
} from '../constants.js';
import type { Diagnostic, ScoreResult } from '../types.js';

/**
 * Calculates a health score using hybrid rule + instance penalties.
 *
 * Scoring formula:
 *   score = max(0, round(100 - rulePenalties - instancePenalties))
 *
 * Rule penalties (per unique rule):
 *   - error:   -1.5
 *   - warning: -0.75
 *
 * Instance penalties (per rule, for additional occurrences):
 *   - additionalInstances = min(instanceCount - 1, INSTANCE_CAP)
 *   - error instances:   additionalInstances * 0.15
 *   - warning instances: additionalInstances * 0.08
 *
 * This means a rule firing once costs its base penalty. Additional instances
 * of the same rule add diminishing extra cost (capped at INSTANCE_CAP).
 * A project with 1 error rule hitting 50 files scores worse than the same
 * rule hitting 2 files, but not catastrophically so.
 *
 * Labels:
 *   - 75-100: "Great"
 *   - 50-74:  "Needs work"
 *   - 0-49:   "Critical"
 */
export function calculateScore(diagnostics: Diagnostic[]): ScoreResult {
  // Group diagnostics by rule to count instances
  const ruleInstances = new Map<string, { severity: Diagnostic['severity']; count: number }>();

  for (const d of diagnostics) {
    const existing = ruleInstances.get(d.rule);
    if (existing) {
      existing.count++;
    } else {
      ruleInstances.set(d.rule, { severity: d.severity, count: 1 });
    }
  }

  let rulePenalties = 0;
  let instancePenalties = 0;

  for (const { severity, count } of ruleInstances.values()) {
    // Base penalty for each unique rule
    rulePenalties += severity === 'error' ? PENALTY_ERROR : PENALTY_WARNING;

    // Additional penalty for extra instances (beyond the first)
    const additionalInstances = Math.min(count - 1, INSTANCE_CAP);
    if (additionalInstances > 0) {
      const instancePenalty =
        severity === 'error' ? INSTANCE_PENALTY_ERROR : INSTANCE_PENALTY_WARNING;
      instancePenalties += additionalInstances * instancePenalty;
    }
  }

  const totalPenalty = rulePenalties + instancePenalties;
  const score = Math.max(0, Math.round(SCORE_MAX - totalPenalty));

  let label: string;
  if (score >= SCORE_THRESHOLD_GREAT) {
    label = SCORE_LABEL_GREAT;
  } else if (score >= SCORE_THRESHOLD_NEEDS_WORK) {
    label = SCORE_LABEL_NEEDS_WORK;
  } else {
    label = SCORE_LABEL_CRITICAL;
  }

  return { score, label };
}
