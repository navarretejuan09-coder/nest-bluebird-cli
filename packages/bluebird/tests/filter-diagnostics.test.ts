import { describe, it, expect } from 'vitest';
import { filterDiagnostics, matchGlob, globToRegex } from '../src/utils/filter-diagnostics.js';
import type { Diagnostic, BluebirdConfig } from '../src/types.js';

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: 'src/app.controller.ts',
    plugin: 'bluebird',
    rule: 'bluebird/no-god-controller',
    severity: 'error',
    message: 'Controller has too many routes',
    category: 'architecture',
    confidence: 'deterministic',
    ...overrides,
  };
}

describe('matchGlob', () => {
  it('should match exact file path', () => {
    expect(matchGlob('src/app.ts', 'src/app.ts')).toBe(true);
  });

  it('should reject non-matching exact path', () => {
    expect(matchGlob('src/app.ts', 'src/other.ts')).toBe(false);
  });

  it('should match ** at the end for any depth', () => {
    expect(matchGlob('src/generated/**', 'src/generated/dto.ts')).toBe(true);
    expect(matchGlob('src/generated/**', 'src/generated/deep/nested/file.ts')).toBe(true);
  });

  it('should not match ** outside the matched directory', () => {
    expect(matchGlob('src/generated/**', 'src/other/file.ts')).toBe(false);
  });

  it('should match * for single path segment characters', () => {
    expect(matchGlob('src/*.controller.ts', 'src/app.controller.ts')).toBe(true);
    expect(matchGlob('src/*.controller.ts', 'src/user.controller.ts')).toBe(true);
  });

  it('should not match * across path separators', () => {
    expect(matchGlob('src/*.ts', 'src/sub/file.ts')).toBe(false);
  });

  it('should match ** in the middle of a pattern', () => {
    expect(matchGlob('src/**/test.ts', 'src/test.ts')).toBe(true);
    expect(matchGlob('src/**/test.ts', 'src/foo/test.ts')).toBe(true);
    expect(matchGlob('src/**/test.ts', 'src/foo/bar/test.ts')).toBe(true);
  });

  it('should match ? for a single character', () => {
    expect(matchGlob('src/app?.ts', 'src/app1.ts')).toBe(true);
    expect(matchGlob('src/app?.ts', 'src/app.ts')).toBe(false);
  });

  it('should handle patterns with dots correctly', () => {
    expect(matchGlob('*.spec.ts', 'app.spec.ts')).toBe(true);
    expect(matchGlob('*.spec.ts', 'app.test.ts')).toBe(false);
  });

  it('should normalize backslashes to forward slashes', () => {
    expect(matchGlob('src/generated/**', 'src\\generated\\file.ts')).toBe(true);
  });

  it('should match **/*.ext for root-level files', () => {
    expect(matchGlob('**/*.ts', 'foo.ts')).toBe(true);
    expect(matchGlob('**/*.ts', 'src/foo.ts')).toBe(true);
    expect(matchGlob('**/*.ts', 'src/sub/foo.ts')).toBe(true);
  });

  it('should match **/filename at any depth including root', () => {
    expect(matchGlob('**/test.ts', 'test.ts')).toBe(true);
    expect(matchGlob('**/test.ts', 'src/test.ts')).toBe(true);
    expect(matchGlob('**/test.ts', 'src/deep/test.ts')).toBe(true);
  });

  it('should not false-positive **/ patterns against wrong filenames', () => {
    expect(matchGlob('**/*.ts', 'foo.js')).toBe(false);
    expect(matchGlob('**/test.ts', 'other.ts')).toBe(false);
  });

  it('should match bare ** against any path', () => {
    expect(matchGlob('**', 'foo.ts')).toBe(true);
    expect(matchGlob('**', 'src/foo.ts')).toBe(true);
    expect(matchGlob('**', '')).toBe(true);
  });
});

describe('globToRegex', () => {
  it('should escape regex special characters', () => {
    const regex = globToRegex('src/file.ts');
    expect(regex.test('src/file.ts')).toBe(true);
    expect(regex.test('src/file-ts')).toBe(false);
  });

  it('should convert ** to .* (any chars including /)', () => {
    const regex = globToRegex('src/**');
    expect(regex.test('src/a/b/c.ts')).toBe(true);
  });
});

describe('filterDiagnostics', () => {
  it('should return all diagnostics with empty config', () => {
    const diagnostics = [makeDiag(), makeDiag({ rule: 'bluebird/no-hardcoded-secrets' })];
    expect(filterDiagnostics(diagnostics, {})).toHaveLength(2);
  });

  it('should filter diagnostics by ignored rules', () => {
    const diagnostics = [
      makeDiag({ rule: 'bluebird/no-god-controller' }),
      makeDiag({ rule: 'bluebird/no-hardcoded-secrets' }),
    ];
    const config: BluebirdConfig = {
      ignore: { rules: ['bluebird/no-god-controller'] },
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('bluebird/no-hardcoded-secrets');
  });

  it('should filter diagnostics by ignored file patterns', () => {
    const diagnostics = [
      makeDiag({ filePath: 'src/generated/dto.ts' }),
      makeDiag({ filePath: 'src/app.controller.ts' }),
    ];
    const config: BluebirdConfig = {
      ignore: { files: ['src/generated/**'] },
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/app.controller.ts');
  });

  it('should filter root-level files with leading-** ignore pattern', () => {
    const diagnostics = [
      makeDiag({ filePath: 'root.spec.ts' }),
      makeDiag({ filePath: 'src/nested.spec.ts' }),
      makeDiag({ filePath: 'src/deep/also.spec.ts' }),
      makeDiag({ filePath: 'src/app.controller.ts' }),
    ];
    const config: BluebirdConfig = {
      ignore: { files: ['**/*.spec.ts'] },
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/app.controller.ts');
  });

  it('should filter diagnostics by multiple ignored file patterns', () => {
    const diagnostics = [
      makeDiag({ filePath: 'src/generated/dto.ts' }),
      makeDiag({ filePath: 'dist/bundle.ts' }),
      makeDiag({ filePath: 'src/app.controller.ts' }),
    ];
    const config: BluebirdConfig = {
      ignore: { files: ['src/generated/**', 'dist/**'] },
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/app.controller.ts');
  });

  it('should filter diagnostics by waivers (exact file match)', () => {
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/legacy/old.controller.ts',
      }),
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/app.controller.ts',
      }),
    ];
    const config: BluebirdConfig = {
      waivers: [
        {
          rule: 'bluebird/no-god-controller',
          file: 'src/legacy/old.controller.ts',
          reason: 'Legacy code',
        },
      ],
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/app.controller.ts');
  });

  it('should filter diagnostics by waivers (glob file match)', () => {
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-sync-fs-operations',
        filePath: 'src/scripts/setup.ts',
      }),
      makeDiag({
        rule: 'bluebird/no-sync-fs-operations',
        filePath: 'src/scripts/migrate.ts',
      }),
      makeDiag({
        rule: 'bluebird/no-sync-fs-operations',
        filePath: 'src/app.service.ts',
      }),
    ];
    const config: BluebirdConfig = {
      waivers: [
        {
          rule: 'bluebird/no-sync-fs-operations',
          file: 'src/scripts/**',
          reason: 'CLI scripts run synchronously',
        },
      ],
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/app.service.ts');
  });

  it('should not waive if rule does not match', () => {
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-hardcoded-secrets',
        filePath: 'src/scripts/setup.ts',
      }),
    ];
    const config: BluebirdConfig = {
      waivers: [
        {
          rule: 'bluebird/no-sync-fs-operations',
          file: 'src/scripts/**',
          reason: 'CLI scripts',
        },
      ],
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
  });

  it('should apply both ignore and waiver filters together', () => {
    const diagnostics = [
      makeDiag({ rule: 'bluebird/no-god-controller', filePath: 'src/app.controller.ts' }),
      makeDiag({ rule: 'bluebird/no-sync-fs-operations', filePath: 'src/scripts/setup.ts' }),
      makeDiag({ rule: 'bluebird/no-hardcoded-secrets', filePath: 'src/generated/config.ts' }),
      makeDiag({ rule: 'bluebird/missing-injectable', filePath: 'src/app.service.ts' }),
    ];
    const config: BluebirdConfig = {
      ignore: {
        rules: ['bluebird/no-god-controller'],
        files: ['src/generated/**'],
      },
      waivers: [
        {
          rule: 'bluebird/no-sync-fs-operations',
          file: 'src/scripts/**',
          reason: 'CLI scripts',
        },
      ],
    };
    const result = filterDiagnostics(diagnostics, config);
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('bluebird/missing-injectable');
  });

  it('should return empty array when all diagnostics are filtered', () => {
    const diagnostics = [makeDiag({ rule: 'bluebird/no-god-controller' })];
    const config: BluebirdConfig = {
      ignore: { rules: ['bluebird/no-god-controller'] },
    };
    expect(filterDiagnostics(diagnostics, config)).toEqual([]);
  });

  it('should handle empty diagnostics array', () => {
    const config: BluebirdConfig = {
      ignore: { rules: ['bluebird/no-god-controller'] },
    };
    expect(filterDiagnostics([], config)).toEqual([]);
  });

  describe('default config file filtering', () => {
    it('should filter tsconfig.json with empty config', () => {
      const diagnostics = [
        makeDiag({ filePath: 'tsconfig.json' }),
        makeDiag({ filePath: 'src/app.controller.ts' }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('src/app.controller.ts');
    });

    it('should filter .github/** paths with empty config', () => {
      const diagnostics = [
        makeDiag({ filePath: '.github/workflows/ci.yml' }),
        makeDiag({ filePath: '.github/CODEOWNERS' }),
        makeDiag({ filePath: 'src/main.ts' }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(1);
      expect(result[0].filePath).toBe('src/main.ts');
    });

    it('should filter multiple config file types with empty config', () => {
      const diagnostics = [
        makeDiag({ filePath: 'eslint.config.mjs' }),
        makeDiag({ filePath: 'jest.config.ts' }),
        makeDiag({ filePath: 'vite.config.ts' }),
        makeDiag({ filePath: 'Dockerfile' }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(0);
    });

    it('should not filter normal source files with empty config', () => {
      const diagnostics = [
        makeDiag({ filePath: 'src/users/users.service.ts' }),
        makeDiag({ filePath: 'src/app.module.ts' }),
        makeDiag({ filePath: 'src/main.ts' }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(3);
    });
  });

  describe('default ignore patterns scoping', () => {
    it('should filter knip rules in migrations directory', () => {
      const diagnostics = [
        makeDiag({
          rule: 'knip/files',
          filePath: 'src/migrations/20240101-init.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(0);
    });

    it('should NOT filter security rules in migrations directory', () => {
      const diagnostics = [
        makeDiag({
          rule: 'bluebird/no-raw-sql',
          filePath: 'src/migrations/20240101-init.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(1);
    });

    it('should NOT filter architecture rules in seeds directory', () => {
      const diagnostics = [
        makeDiag({
          rule: 'bluebird/no-hardcoded-secrets',
          filePath: 'db/seeds/test-data.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(1);
    });

    it('should filter knip rules in seeds directory', () => {
      const diagnostics = [
        makeDiag({
          rule: 'knip/exports',
          filePath: 'db/seeds/test-data.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(0);
    });

    it('should filter config files for ALL rule types', () => {
      const diagnostics = [
        makeDiag({
          rule: 'bluebird/no-hardcoded-secrets',
          filePath: 'jest.config.ts',
        }),
        makeDiag({
          rule: 'knip/files',
          filePath: 'vitest.config.js',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(0);
    });

    it('should filter bluebird/knip/ prefixed rules in migrations', () => {
      const diagnostics = [
        makeDiag({
          rule: 'bluebird/knip/files',
          filePath: 'src/migrations/20240101-init.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(0);
    });

    it('should NOT filter correctness rules in cypress support', () => {
      const diagnostics = [
        makeDiag({
          rule: 'bluebird/no-console-log',
          filePath: 'cypress/support/commands.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(1);
    });

    it('should filter knip rules in cypress support', () => {
      const diagnostics = [
        makeDiag({
          rule: 'knip/exports',
          filePath: 'cypress/support/commands.ts',
        }),
      ];
      const result = filterDiagnostics(diagnostics, {});
      expect(result).toHaveLength(0);
    });
  });
});
