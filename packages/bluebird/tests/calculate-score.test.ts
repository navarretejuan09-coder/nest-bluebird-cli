import { describe, expect, it } from 'vitest';
import { calculateScore } from '../src/utils/calculate-score.js';
import type { Diagnostic } from '../src/types.js';

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: 'src/app.controller.ts',
    plugin: 'bluebird',
    rule: 'test-rule',
    severity: 'warning',
    message: 'test message',
    category: 'correctness',
    confidence: 'deterministic',
    ...overrides,
  };
}

describe('calculateScore', () => {
  describe('base rule penalties', () => {
    it('returns 100 for zero diagnostics', () => {
      const { score, label } = calculateScore([]);
      expect(score).toBe(100);
      expect(label).toBe('Great');
    });

    it('deducts 1.5 for a single error rule', () => {
      const diags = [makeDiag({ rule: 'rule-a', severity: 'error' })];
      const { score } = calculateScore(diags);
      // 100 - 1.5 = 98.5 → 99
      expect(score).toBe(99);
    });

    it('deducts 0.75 for a single warning rule', () => {
      const diags = [makeDiag({ rule: 'rule-b', severity: 'warning' })];
      const { score } = calculateScore(diags);
      // 100 - 0.75 = 99.25 → 99
      expect(score).toBe(99);
    });
  });

  describe('instance penalties (hybrid scoring)', () => {
    it('adds instance penalty for multiple occurrences of same error rule', () => {
      const diags = [
        makeDiag({ rule: 'rule-a', severity: 'error', filePath: 'a.ts' }),
        makeDiag({ rule: 'rule-a', severity: 'error', filePath: 'b.ts' }),
      ];
      const { score } = calculateScore(diags);
      // 100 - 1.5 (base) - 0.15 (1 extra instance) = 98.35 → 98
      expect(score).toBe(98);
    });

    it('adds instance penalty for multiple occurrences of same warning rule', () => {
      const diags = [
        makeDiag({ rule: 'rule-b', severity: 'warning', filePath: 'a.ts' }),
        makeDiag({ rule: 'rule-b', severity: 'warning', filePath: 'b.ts' }),
        makeDiag({ rule: 'rule-b', severity: 'warning', filePath: 'c.ts' }),
      ];
      const { score } = calculateScore(diags);
      // 100 - 0.75 (base) - 0.16 (2 extra instances * 0.08) = 99.09 → 99
      expect(score).toBe(99);
    });

    it('caps instance penalty at INSTANCE_CAP (10)', () => {
      // 15 instances of same rule - only 10 extra should count
      const diags = Array.from({ length: 15 }, (_, i) =>
        makeDiag({ rule: 'rule-a', severity: 'error', filePath: `file-${i}.ts` })
      );
      const { score } = calculateScore(diags);
      // 100 - 1.5 (base) - 1.5 (10 capped instances * 0.15) = 97
      expect(score).toBe(97);
    });

    it('differentiates 1 instance vs 50 instances of same rule', () => {
      const singleInstance = [makeDiag({ rule: 'rule-a', severity: 'error' })];
      const manyInstances = Array.from({ length: 50 }, (_, i) =>
        makeDiag({ rule: 'rule-a', severity: 'error', filePath: `file-${i}.ts` })
      );

      const { score: scoreSingle } = calculateScore(singleInstance);
      const { score: scoreMany } = calculateScore(manyInstances);

      // Single: 100 - 1.5 = 98.5 → 99
      // Many: 100 - 1.5 - 1.5 (capped at 10 extra) = 97
      expect(scoreSingle).toBe(99);
      expect(scoreMany).toBe(97);
      expect(scoreMany).toBeLessThan(scoreSingle);
    });
  });

  describe('score labels', () => {
    it('labels scores 75+ as Great', () => {
      const diags = Array.from({ length: 15 }, (_, i) =>
        makeDiag({ rule: `rule-${i}`, severity: 'error' })
      );
      const { score, label } = calculateScore(diags);
      // 100 - (15 * 1.5) = 77.5 → 78
      expect(score).toBe(78);
      expect(label).toBe('Great');
    });

    it('labels scores between 50-74 as Needs work', () => {
      const diags = Array.from({ length: 20 }, (_, i) =>
        makeDiag({ rule: `rule-${i}`, severity: 'error' })
      );
      const { score, label } = calculateScore(diags);
      // 100 - (20 * 1.5) = 70
      expect(score).toBe(70);
      expect(label).toBe('Needs work');
    });

    it('labels scores below 50 as Critical', () => {
      const diags = Array.from({ length: 40 }, (_, i) =>
        makeDiag({ rule: `rule-${i}`, severity: 'error' })
      );
      const { score, label } = calculateScore(diags);
      // 100 - (40 * 1.5) = 40
      expect(score).toBe(40);
      expect(label).toBe('Critical');
    });
  });

  describe('edge cases', () => {
    it('never goes below 0', () => {
      const diags = Array.from({ length: 100 }, (_, i) =>
        makeDiag({ rule: `rule-${i}`, severity: 'error' })
      );
      const { score } = calculateScore(diags);
      expect(score).toBe(0);
    });

    it('handles mixed error and warning rules', () => {
      const diags = [
        makeDiag({ rule: 'error-rule', severity: 'error' }),
        makeDiag({ rule: 'warning-rule', severity: 'warning' }),
      ];
      const { score } = calculateScore(diags);
      // 100 - 1.5 - 0.75 = 97.75 → 98
      expect(score).toBe(98);
    });
  });
});
