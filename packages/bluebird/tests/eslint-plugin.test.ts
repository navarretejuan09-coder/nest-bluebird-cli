import { describe, expect, it } from 'vitest';
import plugin, { rules } from '../src/eslint-plugin.js';
import { getAllRules } from '../src/rules/index.js';
import { fileCheckers } from '../src/rules/checkers.js';

describe('eslint-plugin', () => {
  const eslintRules = getAllRules().filter((r) => r.analysisPass === 'eslint');
  const eslintRulesWithCheckers = eslintRules.filter((r) => fileCheckers.has(r.id));

  describe('plugin shape', () => {
    it('exports a valid ESLint plugin object', () => {
      expect(plugin).toHaveProperty('meta');
      expect(plugin).toHaveProperty('rules');
      expect(plugin).toHaveProperty('configs');
      expect(plugin.meta).toHaveProperty('name', 'eslint-plugin-bluebird');
      expect(plugin.meta).toHaveProperty('version');
      expect(typeof plugin.meta.version).toBe('string');
    });

    it('exports rules object separately', () => {
      expect(rules).toBeDefined();
      expect(typeof rules).toBe('object');
      expect(rules).toBe(plugin.rules);
    });
  });

  describe('rules registry', () => {
    it('exposes all eslint-pass rules that have checkers', () => {
      for (const rule of eslintRulesWithCheckers) {
        expect(rules).toHaveProperty(rule.id);
      }
    });

    it('does not expose rules without checkers', () => {
      const rulesWithoutCheckers = eslintRules.filter((r) => !fileCheckers.has(r.id));
      for (const rule of rulesWithoutCheckers) {
        expect(rules).not.toHaveProperty(rule.id);
      }
    });

    it('does not expose graph-pass or knip-pass rules', () => {
      const nonEslintRules = getAllRules().filter((r) => r.analysisPass !== 'eslint');
      for (const rule of nonEslintRules) {
        expect(rules).not.toHaveProperty(rule.id);
      }
    });

    it('each rule has valid ESLint rule structure', () => {
      for (const [_ruleId, ruleModule] of Object.entries(rules)) {
        expect(ruleModule).toHaveProperty('meta');
        expect(ruleModule).toHaveProperty('create');
        expect(typeof ruleModule.create).toBe('function');

        const { meta } = ruleModule;
        expect(meta).toHaveProperty('type');
        expect(['problem', 'suggestion']).toContain(meta.type);
        expect(meta).toHaveProperty('docs');
        expect(meta.docs).toHaveProperty('description');
        expect(meta.docs).toHaveProperty('recommended');
        expect(meta).toHaveProperty('messages');
        expect(meta.messages).toHaveProperty('violation');
        expect(meta).toHaveProperty('schema');
        expect(Array.isArray(meta.schema)).toBe(true);
      }
    });

    it('maps severity correctly to ESLint type', () => {
      for (const rule of eslintRulesWithCheckers) {
        const ruleModule = rules[rule.id];
        const expectedType = rule.severity === 'error' ? 'problem' : 'suggestion';
        expect(ruleModule.meta.type).toBe(expectedType);
      }
    });
  });

  describe('configs.recommended', () => {
    const recommended = plugin.configs.recommended as {
      plugins: Record<string, unknown>;
      rules: Record<string, string>;
    };

    it('has recommended config', () => {
      expect(plugin.configs).toHaveProperty('recommended');
      expect(recommended).toHaveProperty('plugins');
      expect(recommended).toHaveProperty('rules');
    });

    it('includes bluebird plugin in plugins', () => {
      expect(recommended.plugins).toHaveProperty('bluebird');
    });

    it('includes only deterministic rules without enabledWhen', () => {
      const expectedRules = eslintRulesWithCheckers.filter(
        (r) => r.confidence === 'deterministic' && !r.enabledWhen
      );

      for (const rule of expectedRules) {
        const key = `bluebird/${rule.id}`;
        expect(recommended.rules).toHaveProperty(key);
      }
    });

    it('excludes heuristic rules from recommended', () => {
      const heuristicRules = eslintRulesWithCheckers.filter((r) => r.confidence === 'heuristic');

      for (const rule of heuristicRules) {
        const key = `bluebird/${rule.id}`;
        expect(recommended.rules).not.toHaveProperty(key);
      }
    });

    it('excludes rules with enabledWhen predicates from recommended', () => {
      const conditionalRules = eslintRulesWithCheckers.filter((r) => r.enabledWhen);

      for (const rule of conditionalRules) {
        const key = `bluebird/${rule.id}`;
        expect(recommended.rules).not.toHaveProperty(key);
      }
    });

    it('enabledWhen-gated rules return empty listeners (no-op) since features cannot be detected', () => {
      const conditionalRules = eslintRulesWithCheckers.filter((r) => r.enabledWhen);
      const mockContext = {
        sourceCode: { getText: () => '' },
        filename: 'test.ts',
        report: () => {},
      };

      for (const rule of conditionalRules) {
        const ruleModule = rules[rule.id];
        const listeners = ruleModule.create(mockContext);
        // Should return empty object (no-op) since enabledWhen cannot be satisfied
        expect(Object.keys(listeners)).toHaveLength(0);
      }
    });

    it('maps severity to ESLint severity string correctly', () => {
      for (const [ruleKey, severity] of Object.entries(recommended.rules)) {
        const ruleId = ruleKey.replace('bluebird/', '');
        const ruleMeta = eslintRulesWithCheckers.find((r) => r.id === ruleId);
        expect(ruleMeta).toBeDefined();

        const expectedSeverity = ruleMeta!.severity === 'error' ? 'error' : 'warn';
        expect(severity).toBe(expectedSeverity);
      }
    });
  });

  describe('rule behavior', () => {
    it('create() returns an object with Program:exit handler for non-gated rules', () => {
      const mockContext = {
        sourceCode: { getText: () => '' },
        filename: 'test.ts',
        report: () => {},
      };

      // Only test rules without enabledWhen (gated rules return empty listeners)
      const nonGatedRules = eslintRulesWithCheckers.filter((r) => !r.enabledWhen);
      for (const rule of nonGatedRules) {
        const ruleModule = rules[rule.id];
        const listeners = ruleModule.create(mockContext);
        expect(listeners).toHaveProperty('Program:exit');
        expect(typeof listeners['Program:exit']).toBe('function');
      }
    });

    it('reports violations with help text appended', () => {
      const reported: Array<{ messageId: string; data: Record<string, string> }> = [];
      const mockContext = {
        sourceCode: {
          getText: () => `
            @Injectable()
            class TestService {
              private password = 'secret123';
            }
          `,
        },
        filename: 'test.service.ts',
        report: (descriptor: { messageId: string; data: Record<string, string> }) => {
          reported.push(descriptor);
        },
      };

      const secretsRule = rules['no-hardcoded-secrets'];
      const listeners = secretsRule.create(mockContext);
      listeners['Program:exit']?.();

      expect(reported.length).toBeGreaterThan(0);
      expect(reported[0].messageId).toBe('violation');
      expect(reported[0].data.message).toContain('Hardcoded secret');
      // Help text should be appended
      expect(reported[0].data.message).toContain('environment variables');
    });
  });
});
