import { describe, expect, it } from 'vitest';
import {
  getAllRules,
  getEnabledRules,
  getRuleById,
  getRulesByCategory,
  getRulesByConfidence,
} from '../src/rules/index.js';
import type { ProjectInfo } from '../src/types.js';

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    nestVersion: '10.0.0',
    httpAdapter: 'express',
    orm: 'none',
    strictTypeScript: true,
    hasTests: true,
    sourceFileCount: 50,
    features: {
      graphql: false,
      websockets: false,
      microservices: false,
      cqrs: false,
      swagger: false,
      bull: false,
      config: false,
      throttler: false,
      cache: false,
    },
    ...overrides,
  };
}

describe('rule registry', () => {
  describe('getAllRules', () => {
    it('returns a non-empty list', () => {
      const rules = getAllRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('returns the same frozen array reference', () => {
      const a = getAllRules();
      const b = getAllRules();
      expect(a).toBe(b);
      expect(Object.isFrozen(a)).toBe(true);
    });

    it('freezes each rule object (deep immutability)', () => {
      for (const rule of getAllRules()) {
        expect(Object.isFrozen(rule)).toBe(true);
      }
    });

    it('every rule has all required fields', () => {
      for (const rule of getAllRules()) {
        expect(rule.id).toBeTruthy();
        expect(rule.category).toBeTruthy();
        expect(rule.severity).toMatch(/^(error|warning)$/);
        expect(rule.confidence).toMatch(/^(deterministic|heuristic)$/);
        expect(rule.description).toBeTruthy();
        expect(rule.help).toBeTruthy();
        expect(rule.analysisPass).toMatch(/^(eslint|graph|knip)$/);
      }
    });

    it('has no duplicate rule IDs', () => {
      const ids = getAllRules().map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('getRuleById', () => {
    it('returns the matching rule', () => {
      const rule = getRuleById('no-hardcoded-dependency');
      expect(rule).toBeDefined();
      expect(rule!.category).toBe('architecture');
      expect(rule!.severity).toBe('error');
    });

    it('returns undefined for unknown id', () => {
      expect(getRuleById('nonexistent-rule')).toBeUndefined();
    });
  });

  describe('getRulesByCategory', () => {
    it('filters by architecture', () => {
      const rules = getRulesByCategory('architecture');
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.category).toBe('architecture');
      }
    });

    it('filters by security', () => {
      const rules = getRulesByCategory('security');
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.category).toBe('security');
      }
    });

    it('returns empty for unused category', () => {
      // 'dead-code' category has no rules currently
      const rules = getRulesByCategory('dead-code');
      expect(rules).toHaveLength(0);
    });
  });

  describe('getRulesByConfidence', () => {
    it('returns only deterministic rules', () => {
      const rules = getRulesByConfidence('deterministic');
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.confidence).toBe('deterministic');
      }
    });

    it('returns only heuristic rules', () => {
      const rules = getRulesByConfidence('heuristic');
      expect(rules.length).toBeGreaterThan(0);
      for (const r of rules) {
        expect(r.confidence).toBe('heuristic');
      }
    });

    it('deterministic + heuristic covers all rules', () => {
      const det = getRulesByConfidence('deterministic');
      const heur = getRulesByConfidence('heuristic');
      expect(det.length + heur.length).toBe(getAllRules().length);
    });
  });

  describe('getEnabledRules', () => {
    it('excludes heuristic rules by default', () => {
      const project = makeProject();
      const rules = getEnabledRules(project);
      for (const r of rules) {
        expect(r.confidence).toBe('deterministic');
      }
    });

    it('includes heuristic rules when opted in', () => {
      const project = makeProject();
      const rules = getEnabledRules(project, true);
      const hasHeuristic = rules.some((r) => r.confidence === 'heuristic');
      expect(hasHeuristic).toBe(true);
    });

    it('excludes swagger rule when swagger is not detected', () => {
      const project = makeProject({ features: { ...makeProject().features, swagger: false } });
      const rules = getEnabledRules(project);
      const swaggerRule = rules.find((r) => r.id === 'missing-swagger-decorators');
      expect(swaggerRule).toBeUndefined();
    });

    it('includes swagger rule when swagger is detected', () => {
      const project = makeProject({ features: { ...makeProject().features, swagger: true } });
      const rules = getEnabledRules(project);
      const swaggerRule = rules.find((r) => r.id === 'missing-swagger-decorators');
      expect(swaggerRule).toBeDefined();
    });

    it('returns fewer rules than the full registry (heuristics excluded)', () => {
      const project = makeProject();
      const enabled = getEnabledRules(project);
      const all = getAllRules();
      expect(enabled.length).toBeLessThan(all.length);
    });
  });

  describe('plan coverage', () => {
    const expectedDeterministic = [
      'no-hardcoded-dependency',
      'no-god-controller',
      'no-god-service',
      'no-circular-dependency',
      'no-hardcoded-secrets',
      'missing-validation-pipe',
      'no-any-in-dto',
      'no-raw-sql',
      'missing-injectable',
      'lifecycle-hook-interface',
      'no-duplicate-route',
      'no-constructor-side-effects',
      'no-nested-controller-decorator',
      'missing-swagger-decorators',
      'no-entity-as-response',
      'no-sync-fs-operations',
      'no-blocking-crypto',
    ];

    it.each(expectedDeterministic)('has deterministic rule: %s', (id) => {
      const rule = getRuleById(id);
      expect(rule).toBeDefined();
      expect(rule!.confidence).toBe('deterministic');
    });

    const expectedHeuristic = [
      'no-inconsistent-http-status',
      'missing-caching',
      'missing-indexes',
      'missing-migration',
      'missing-csrf-protection',
      'low-test-coverage',
      'no-n-plus-one',
      'missing-rate-limiting',
      'prefer-pagination',
      'missing-global-guard',
      'missing-helmet',
    ];

    it.each(expectedHeuristic)('has heuristic rule: %s', (id) => {
      const rule = getRuleById(id);
      expect(rule).toBeDefined();
      expect(rule!.confidence).toBe('heuristic');
    });

    it("graph pass rules use 'graph' analysisPass", () => {
      const graphRuleIds = ['no-circular-dependency', 'no-duplicate-route'];
      for (const id of graphRuleIds) {
        expect(getRuleById(id)!.analysisPass).toBe('graph');
      }
    });
  });
});
