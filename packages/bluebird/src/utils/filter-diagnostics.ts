import type { BluebirdConfig, Diagnostic, Waiver } from '../types.js';

/**
 * Default file patterns ignored for ALL rules.
 * These are tool configuration files that:
 * 1. Are consumed by their tools via convention (not imports)
 * 2. Don't contain application logic that could have security/architecture issues
 */
export const DEFAULT_IGNORED_CONFIG_FILES: readonly string[] = [
  // ESLint config files
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.mjs',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  // Prettier config files
  '.prettierrc.js',
  '.prettierrc.cjs',
  'prettier.config.js',
  'prettier.config.mjs',
  // Commitlint config files
  'commitlint.config.js',
  'commitlint.config.ts',
  // Jest config files
  'jest.config.js',
  'jest.config.ts',
  'jest.setup.js',
  'jest.setup.ts',
  // Vitest config files
  'vitest.config.js',
  'vitest.config.ts',
  'vitest.setup.js',
  'vitest.setup.ts',
  // TypeScript config files
  'tsconfig.json',
  'tsconfig.*.json',
  // Tailwind config files
  'tailwind.config.js',
  'tailwind.config.ts',
  // PostCSS config files
  'postcss.config.js',
  'postcss.config.cjs',
  // Babel config files
  'babel.config.js',
  'babel.config.cjs',
  '.babelrc.js',
  // Webpack config files
  'webpack.config.js',
  'webpack.config.ts',
  // Rollup config files
  'rollup.config.js',
  'rollup.config.ts',
  // Vite config files
  'vite.config.js',
  'vite.config.ts',
  // Next.js config files
  'next.config.js',
  'next.config.mjs',
  // NestJS CLI config
  'nest-cli.json',
  // Knip config files
  'knip.json',
  'knip.jsonc',
  'knip.ts',
  // Cypress config files
  'cypress.config.js',
  'cypress.config.ts',
  // Playwright config files
  'playwright.config.js',
  'playwright.config.ts',
  // Docker-related files (no TS/JS code)
  'Dockerfile',
  'docker-compose*.yml',
  'docker-compose*.yaml',
  // CI config files (no TS/JS code)
  '.github/**',
  '.gitlab-ci.yml',
  '.circleci/**',
  // Husky hooks (shell scripts)
  '.husky/**',
  // Lint-staged config
  'lint-staged.config.js',
  '.lintstagedrc.js',
  // Release config
  'release.config.js',
  '.releaserc.js',
  // Semantic release
  '.semantic-release.js',
  // TypeORM config
  'ormconfig.js',
  'ormconfig.ts',
];

/**
 * Patterns ignored ONLY for knip/* (dead-code) rules.
 * These directories may contain code with security/architecture concerns
 * that should still be analyzed, but knip flags them as "unused" because
 * they're loaded dynamically at runtime.
 */
export const DEFAULT_KNIP_ONLY_PATTERNS: readonly string[] = [
  // Database seeds and migrations - loaded dynamically by ORMs
  '**/seeds/**',
  '**/migrations/**',
  // Cypress support files - loaded by Cypress runtime
  'cypress/plugins/**',
  'cypress/support/**',
];

/**
 * Combined list for backwards compatibility.
 * @deprecated Use DEFAULT_IGNORED_CONFIG_FILES and DEFAULT_KNIP_ONLY_PATTERNS separately
 */
export const DEFAULT_IGNORED_FILE_PATTERNS: readonly string[] = [
  ...DEFAULT_IGNORED_CONFIG_FILES,
  ...DEFAULT_KNIP_ONLY_PATTERNS,
];

/**
 * Converts a simple glob pattern to a RegExp via single-pass parsing.
 *
 * - `**`  — zero or more path segments (including separators)
 * - `*`   — any characters within a single segment (no `/`)
 * - `?`   — exactly one character (no `/`)
 */
export function globToRegex(pattern: string): RegExp {
  const src = pattern.replace(/\\/g, '/');
  let re = '';
  let i = 0;

  while (i < src.length) {
    if (src[i] === '*' && src[i + 1] === '*') {
      i += 2;
      if (src[i] === '/') i++;
      if (re.endsWith('/')) re = re.slice(0, -1);

      if (i >= src.length && re.length === 0) {
        re += '.*';
      } else if (i >= src.length) {
        re += '(?:/.*)?';
      } else if (re.length === 0) {
        re += '(?:.+/)?';
      } else {
        re += '(?:/.*)?/';
      }
    } else if (src[i] === '*') {
      re += '[^/]*';
      i++;
    } else if (src[i] === '?') {
      re += '[^/]';
      i++;
    } else {
      if (/[.+^${}()|[\]\\]/.test(src[i])) re += '\\';
      re += src[i];
      i++;
    }
  }

  return new RegExp(`^${re}$`);
}

export function matchGlob(pattern: string, filePath: string): boolean {
  return globToRegex(pattern).test(filePath.replace(/\\/g, '/'));
}

function isWaived(diagnostic: Diagnostic, waivers: Waiver[]): boolean {
  return waivers.some((w) => diagnostic.rule === w.rule && matchGlob(w.file, diagnostic.filePath));
}

/**
 * Returns true if the rule is a knip (dead-code) rule.
 */
function isKnipRule(rule: string): boolean {
  return rule.startsWith('knip/') || rule.startsWith('bluebird/knip/');
}

export function filterDiagnostics(diagnostics: Diagnostic[], config: BluebirdConfig): Diagnostic[] {
  const ignoredRules = new Set(config.ignore?.rules ?? []);
  const userIgnoredFilePatterns = config.ignore?.files ?? [];
  const waivers = config.waivers ?? [];

  // Config files are always ignored (safe for all rules)
  const globalIgnorePatterns = [...userIgnoredFilePatterns, ...DEFAULT_IGNORED_CONFIG_FILES];

  // Knip-only patterns are only applied to dead-code rules
  const knipIgnorePatterns = [...globalIgnorePatterns, ...DEFAULT_KNIP_ONLY_PATTERNS];

  return diagnostics.filter((d) => {
    if (ignoredRules.has(d.rule)) return false;

    // Apply appropriate ignore patterns based on rule type
    const patterns = isKnipRule(d.rule) ? knipIgnorePatterns : globalIgnorePatterns;
    if (patterns.some((pattern) => matchGlob(pattern, d.filePath))) return false;

    if (waivers.length > 0 && isWaived(d, waivers)) return false;
    return true;
  });
}
