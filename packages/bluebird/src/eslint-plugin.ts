import ts from 'typescript';
import type { ProjectInfo, RuleViolation, RuleMeta } from './types.js';
import { getAllRules } from './rules/index.js';
import { fileCheckers } from './rules/checkers.js';
import { getVersion } from './utils/version.js';

/**
 * Fallback project info used when running via ESLint (where bluebird's
 * discover-project pass is unavailable). Features default to false so
 * that enabledWhen-gated rules (e.g. missing-swagger-decorators) don't
 * produce false positives. Users opt in to those rules explicitly.
 */
const DEFAULT_PROJECT: ProjectInfo = {
  nestVersion: null,
  httpAdapter: 'unknown',
  orm: 'none',
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
  strictTypeScript: false,
  hasTests: false,
  sourceFileCount: 0,
};

type EslintRuleModule = {
  meta: {
    type: 'problem' | 'suggestion';
    docs: { description: string; recommended: boolean };
    messages: Record<string, string>;
    schema: [];
  };
  create(context: EslintRuleContext): Record<string, (() => void) | undefined>;
};

type EslintRuleContext = {
  filename?: string;
  sourceCode?: { getText(): string };
  getSourceCode?(): { getText(): string };
  getFilename?(): string;
  report(descriptor: {
    loc: { start: { line: number; column: number }; end: { line: number; column: number } };
    messageId: string;
    data: Record<string, string>;
  }): void;
};

function wrapChecker(meta: Readonly<RuleMeta>): EslintRuleModule {
  return {
    meta: {
      type: meta.severity === 'error' ? 'problem' : 'suggestion',
      docs: {
        description: meta.description,
        recommended: meta.confidence === 'deterministic',
      },
      messages: {
        violation: '{{message}}',
      },
      schema: [],
    },
    create(context: EslintRuleContext) {
      const checker = fileCheckers.get(meta.id);
      if (!checker) return {};

      // Skip rules gated by enabledWhen — the ESLint plugin cannot detect project
      // features, so these rules would produce false positives. Users who want
      // these rules should use the CLI or explicitly configure their project.
      if (meta.enabledWhen && !meta.enabledWhen(DEFAULT_PROJECT)) {
        return {};
      }

      return {
        'Program:exit'() {
          const src = context.sourceCode ?? context.getSourceCode?.();
          if (!src) return;
          const text = src.getText();
          const filePath = context.filename ?? context.getFilename?.() ?? '<unknown>';

          const sourceFile = ts.createSourceFile(
            filePath,
            text,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TS
          );

          const violations: RuleViolation[] = [];
          checker(sourceFile, filePath, {
            project: DEFAULT_PROJECT,
            report: (v) => violations.push(v),
          });

          for (const v of violations) {
            const line = v.line ?? 1;
            const col = (v.column ?? 1) - 1;
            // Append help text (violation-specific or rule-level) to provide actionable guidance
            const help = v.help ?? meta.help;
            const message = help ? `${v.message}. ${help}` : v.message;
            context.report({
              loc: { start: { line, column: col }, end: { line, column: col + 1 } },
              messageId: 'violation',
              data: { message },
            });
          }
        },
      };
    },
  };
}

const fileRules = getAllRules().filter((r) => r.analysisPass === 'eslint');

const rules: Record<string, EslintRuleModule> = Object.fromEntries(
  fileRules.filter((r) => fileCheckers.has(r.id)).map((r) => [r.id, wrapChecker(r)])
);

const basePlugin = {
  meta: {
    name: 'eslint-plugin-bluebird',
    version: getVersion(),
  },
  rules,
};

const recommendedRules: Record<string, string> = {};
for (const r of fileRules) {
  if (r.confidence === 'deterministic' && fileCheckers.has(r.id) && !r.enabledWhen) {
    recommendedRules[`bluebird/${r.id}`] = r.severity === 'error' ? 'error' : 'warn';
  }
}

const plugin = {
  ...basePlugin,
  configs: {
    recommended: {
      plugins: { bluebird: basePlugin },
      rules: recommendedRules,
    },
  } as Record<string, unknown>,
};

export default plugin;
export { rules };
