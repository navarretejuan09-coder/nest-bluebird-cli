import { describe, expect, it } from 'vitest';
import { crossValidate } from '../src/utils/cross-validate.js';
import type { Diagnostic, ProjectInfo } from '../src/types.js';

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: 'src/app.controller.ts',
    plugin: 'bluebird',
    rule: 'bluebird/test-rule',
    severity: 'warning',
    message: 'test message',
    category: 'correctness',
    confidence: 'deterministic',
    ...overrides,
  };
}

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    nestVersion: '10.0.0',
    httpAdapter: 'express',
    orm: 'typeorm',
    features: {
      graphql: false,
      websockets: false,
      microservices: false,
      cqrs: false,
      swagger: true,
      bull: false,
      config: true,
      throttler: false,
      cache: false,
    },
    strictTypeScript: true,
    hasTests: true,
    sourceFileCount: 50,
    ...overrides,
  };
}

describe('crossValidate', () => {
  describe('deterministic rules', () => {
    it('marks deterministic diagnostics as confirmed', () => {
      const diags = [
        makeDiag({ confidence: 'deterministic', rule: 'bluebird/no-hardcoded-secrets' }),
      ];
      const summary = crossValidate(diags, makeProject());

      expect(diags[0].calibration).toBe('confirmed');
      expect(summary.confirmedCount).toBe(1);
      expect(summary.uncertainCount).toBe(0);
      expect(summary.likelyFalsePositiveCount).toBe(0);
    });
  });

  describe('heuristic rules without refuter', () => {
    it('marks heuristic diagnostics without a matching refuter as uncertain', () => {
      const diags = [
        makeDiag({ confidence: 'heuristic', rule: 'bluebird/some-unknown-heuristic' }),
      ];
      const summary = crossValidate(diags, makeProject());

      expect(diags[0].calibration).toBe('uncertain');
      expect(summary.uncertainCount).toBe(1);
    });
  });

  describe('heuristic rules with refuter', () => {
    it('marks missing-caching as likely_false_positive for tiny projects', () => {
      const diags = [makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-caching' })];
      const summary = crossValidate(diags, makeProject({ sourceFileCount: 3 }));

      expect(diags[0].calibration).toBe('likely_false_positive');
      expect(summary.likelyFalsePositiveCount).toBe(1);
    });

    it('keeps missing-caching as uncertain for larger projects', () => {
      const diags = [makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-caching' })];
      const summary = crossValidate(diags, makeProject({ sourceFileCount: 50 }));

      expect(diags[0].calibration).toBe('uncertain');
      expect(summary.uncertainCount).toBe(1);
    });

    it('marks missing-indexes as likely_false_positive when no ORM', () => {
      const diags = [makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-indexes' })];
      const summary = crossValidate(diags, makeProject({ orm: 'none' }));

      expect(diags[0].calibration).toBe('likely_false_positive');
      expect(summary.likelyFalsePositiveCount).toBe(1);
    });

    it('keeps missing-indexes as uncertain when ORM is present', () => {
      const diags = [makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-indexes' })];
      const summary = crossValidate(diags, makeProject({ orm: 'typeorm' }));

      expect(diags[0].calibration).toBe('uncertain');
      expect(summary.uncertainCount).toBe(1);
    });

    it('marks missing-csrf-protection as likely_false_positive for fastify', () => {
      const diags = [
        makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-csrf-protection' }),
      ];
      const summary = crossValidate(diags, makeProject({ httpAdapter: 'fastify' }));

      expect(diags[0].calibration).toBe('likely_false_positive');
      expect(summary.likelyFalsePositiveCount).toBe(1);
    });

    it('keeps missing-csrf-protection as uncertain for express', () => {
      const diags = [
        makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-csrf-protection' }),
      ];
      const summary = crossValidate(diags, makeProject({ httpAdapter: 'express' }));

      expect(diags[0].calibration).toBe('uncertain');
      expect(summary.uncertainCount).toBe(1);
    });
  });

  describe('calibrated score', () => {
    it('excludes likely_false_positive diagnostics from calibrated score', () => {
      const diags = [
        makeDiag({
          confidence: 'deterministic',
          rule: 'bluebird/no-hardcoded-secrets',
          severity: 'error',
        }),
        makeDiag({
          confidence: 'heuristic',
          rule: 'bluebird/missing-indexes',
          severity: 'warning',
        }),
      ];
      const project = makeProject({ orm: 'none' });
      const summary = crossValidate(diags, project);

      // missing-indexes should be FP (orm=none), so calibrated score should
      // only reflect the one deterministic error
      expect(summary.likelyFalsePositiveCount).toBe(1);
      expect(summary.confirmedCount).toBe(1);
      expect(summary.calibratedScore.score).toBeGreaterThan(0);
      // Raw score would count both diagnostics, calibrated only the confirmed one
      expect(summary.calibratedScore.score).toBe(99); // 100 - 1.5 = 98.5 → 99
    });

    it('returns perfect calibrated score when all diagnostics are FPs', () => {
      const diags = [
        makeDiag({
          confidence: 'heuristic',
          rule: 'bluebird/missing-indexes',
          severity: 'warning',
        }),
        makeDiag({
          confidence: 'heuristic',
          rule: 'bluebird/missing-migration',
          severity: 'warning',
        }),
      ];
      const project = makeProject({ orm: 'none' });
      const summary = crossValidate(diags, project);

      expect(summary.likelyFalsePositiveCount).toBe(2);
      expect(summary.calibratedScore.score).toBe(100);
    });
  });

  describe('mixed diagnostics', () => {
    it('correctly classifies a mix of deterministic, uncertain, and FP diagnostics', () => {
      const diags = [
        makeDiag({ confidence: 'deterministic', rule: 'bluebird/no-hardcoded-secrets' }),
        makeDiag({ confidence: 'heuristic', rule: 'bluebird/low-test-coverage' }),
        makeDiag({ confidence: 'heuristic', rule: 'bluebird/missing-indexes' }),
      ];
      const project = makeProject({ orm: 'none' });
      const summary = crossValidate(diags, project);

      expect(summary.confirmedCount).toBe(1);
      expect(summary.uncertainCount).toBe(1);
      expect(summary.likelyFalsePositiveCount).toBe(1);
    });
  });

  describe('empty diagnostics', () => {
    it('handles empty diagnostic array gracefully', () => {
      const summary = crossValidate([], makeProject());

      expect(summary.confirmedCount).toBe(0);
      expect(summary.uncertainCount).toBe(0);
      expect(summary.likelyFalsePositiveCount).toBe(0);
      expect(summary.calibratedScore.score).toBe(100);
    });
  });
});
