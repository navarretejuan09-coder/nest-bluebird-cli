import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type { ScanResult, ProjectInfo, Diagnostic } from '../src/types.js';

vi.mock('ora', () => ({
  default: vi.fn(() => {
    const s: Record<string, unknown> = {};
    s.start = vi.fn(() => s);
    s.succeed = vi.fn(() => s);
    s.fail = vi.fn(() => s);
    s.stop = vi.fn(() => s);
    return s;
  }),
}));

import { createProgram } from '../src/cli.js';
import * as scanMod from '../src/scan.js';
import * as indexMod from '../src/index.js';
import * as baselineMod from '../src/utils/baseline.js';
import * as initConfigMod from '../src/utils/init-config.js';

const mockProject: ProjectInfo = {
  nestVersion: '10.0.0',
  httpAdapter: 'express',
  orm: 'typeorm',
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
  strictTypeScript: true,
  hasTests: true,
  sourceFileCount: 10,
};

function cleanResult(diagnostics: Diagnostic[] = []): ScanResult {
  return {
    project: mockProject,
    diagnostics,
    warnings: [],
    score: { score: 100, label: 'Great' },
    baselinedCount: 0,
  };
}

describe('CLI (createProgram)', () => {
  let scanSpy: MockInstance;
  let diagnoseSpy: MockInstance;
  let saveBaselineSpy: MockInstance;
  let initConfigSpy: MockInstance;
  let logSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    scanSpy = vi.spyOn(scanMod, 'scan').mockResolvedValue();
    diagnoseSpy = vi.spyOn(indexMod, 'diagnose').mockResolvedValue(cleanResult());
    saveBaselineSpy = vi
      .spyOn(baselineMod, 'saveBaseline')
      .mockResolvedValue('/test/.bluebird-baseline.json');
    initConfigSpy = vi.spyOn(initConfigMod, 'initConfig').mockResolvedValue({
      created: true,
      path: '/test/bluebird.config.json',
      config: {},
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function run(...args: string[]): Promise<void> {
    const program = createProgram();
    program.exitOverride();
    await program.parseAsync(['node', 'bluebird', ...args]);
  }

  // ---------------------------------------------------------------
  // Default scan command — option parsing
  // ---------------------------------------------------------------
  describe('default scan command', () => {
    it('calls scan with defaults when no flags provided', async () => {
      await run();

      expect(scanSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: false,
          quiet: false,
          scoreOnly: false,
          format: 'text',
          failOn: 'error',
          lint: true,
          deadCode: true,
          graphAnalysis: true,
          includeHeuristic: false,
        })
      );
    });

    it('parses --verbose flag', async () => {
      await run('--verbose');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
    });

    it('parses -v shorthand', async () => {
      await run('-v');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ verbose: true }));
    });

    it('parses --quiet flag', async () => {
      await run('--quiet');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
    });

    it('parses -q shorthand', async () => {
      await run('-q');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ quiet: true }));
    });

    it('parses --project <path>', async () => {
      await run('--project', '/my/project');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/my/project' }));
    });

    it('parses -p shorthand', async () => {
      await run('-p', '/my/project');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/my/project' }));
    });

    it('parses --score flag', async () => {
      await run('--score');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ scoreOnly: true }));
    });

    it('parses -s shorthand', async () => {
      await run('-s');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ scoreOnly: true }));
    });

    it('parses --diff <branch>', async () => {
      await run('--diff', 'main');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ diff: 'main' }));
    });

    it('parses --format json', async () => {
      await run('--format', 'json');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ format: 'json' }));
    });

    it('parses --format sarif', async () => {
      await run('--format', 'sarif');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ format: 'sarif' }));
    });

    it('rejects invalid --format values', async () => {
      await expect(run('--format', 'xml')).rejects.toThrow();
    });

    it('parses --fail-on warning', async () => {
      await run('--fail-on', 'warning');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ failOn: 'warning' }));
    });

    it('parses --fail-on none', async () => {
      await run('--fail-on', 'none');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ failOn: 'none' }));
    });

    it('rejects invalid --fail-on values', async () => {
      await expect(run('--fail-on', 'critical')).rejects.toThrow();
    });

    it('parses --fail-on-score with valid integer', async () => {
      await run('--fail-on-score', '75');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ scoreThreshold: 75 }));
    });

    it('rejects --fail-on-score with negative value', async () => {
      await expect(run('--fail-on-score', '-1')).rejects.toThrow();
    });

    it('rejects --fail-on-score with value > 100', async () => {
      await expect(run('--fail-on-score', '101')).rejects.toThrow();
    });

    it('rejects --fail-on-score with non-integer', async () => {
      await expect(run('--fail-on-score', '75.5')).rejects.toThrow();
    });

    it('parses --no-lint', async () => {
      await run('--no-lint');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ lint: false }));
    });

    it('parses --no-dead-code', async () => {
      await run('--no-dead-code');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ deadCode: false }));
    });

    it('parses --no-graph-analysis', async () => {
      await run('--no-graph-analysis');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ graphAnalysis: false }));
    });

    it('parses --include-heuristic', async () => {
      await run('--include-heuristic');

      expect(scanSpy).toHaveBeenCalledWith(expect.objectContaining({ includeHeuristic: true }));
    });

    it('passes all flags together', async () => {
      await run(
        '-v',
        '-p',
        '/proj',
        '--diff',
        'develop',
        '--format',
        'json',
        '--fail-on',
        'warning',
        '--fail-on-score',
        '80',
        '--no-dead-code',
        '--include-heuristic'
      );

      expect(scanSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          verbose: true,
          cwd: '/proj',
          diff: 'develop',
          format: 'json',
          failOn: 'warning',
          scoreThreshold: 80,
          deadCode: false,
          includeHeuristic: true,
        })
      );
    });
  });

  // ---------------------------------------------------------------
  // Baseline generation
  // ---------------------------------------------------------------
  describe('baseline generation', () => {
    it('--baseline calls diagnose and saveBaseline', async () => {
      const diag: Diagnostic = {
        filePath: 'a.ts',
        plugin: 'bluebird',
        rule: 'bluebird/test',
        severity: 'error',
        message: 'fail',
        category: 'architecture',
        confidence: 'deterministic',
        line: 10,
      };
      diagnoseSpy.mockResolvedValue(cleanResult([diag]));

      await run('--baseline');

      expect(scanSpy).not.toHaveBeenCalled();
      expect(diagnoseSpy).toHaveBeenCalledWith(expect.objectContaining({ useBaseline: false }));
      expect(saveBaselineSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1 diagnostic'));
    });

    it('--update-baseline also triggers baseline generation', async () => {
      await run('--update-baseline');

      expect(scanSpy).not.toHaveBeenCalled();
      expect(diagnoseSpy).toHaveBeenCalled();
      expect(saveBaselineSpy).toHaveBeenCalled();
    });

    it('--baseline respects --project path', async () => {
      await run('--baseline', '--project', '/custom');

      expect(diagnoseSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/custom' }));
      expect(saveBaselineSpy).toHaveBeenCalledWith('/custom', expect.any(Array));
    });

    it('--baseline respects pass toggle flags', async () => {
      await run('--baseline', '--no-lint', '--include-heuristic');

      expect(diagnoseSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          lint: false,
          includeHeuristic: true,
          useBaseline: false,
        })
      );
    });

    it('--baseline pluralizes correctly for 0 diagnostics', async () => {
      diagnoseSpy.mockResolvedValue(cleanResult([]));

      await run('--baseline');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('0 diagnostics'));
    });
  });

  // ---------------------------------------------------------------
  // Init subcommand
  // ---------------------------------------------------------------
  describe('init subcommand', () => {
    it('calls initConfig with defaults', async () => {
      await run('init');

      expect(initConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ force: false }));
      expect(scanSpy).not.toHaveBeenCalled();
    });

    it('passes --force flag', async () => {
      await run('init', '--force');

      expect(initConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it('passes -f shorthand', async () => {
      await run('init', '-f');

      expect(initConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    });

    it('passes --cwd option', async () => {
      await run('init', '--cwd', '/other/path');

      expect(initConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/other/path' }));
    });

    describe('non-interactive mode (--yes)', () => {
      it('passes --yes flag', async () => {
        await run('init', '--yes');

        expect(initConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ yes: true }));
      });

      it('passes -y shorthand', async () => {
        await run('init', '-y');

        expect(initConfigSpy).toHaveBeenCalledWith(expect.objectContaining({ yes: true }));
      });

      it('passes --heuristic flag with --yes', async () => {
        await run('init', '--yes', '--heuristic');

        expect(initConfigSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            yes: true,
            includeHeuristic: true,
          })
        );
      });

      it('passes --skip-graph flag with --yes', async () => {
        await run('init', '--yes', '--skip-graph');

        expect(initConfigSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            yes: true,
            noGraphAnalysis: true,
          })
        );
      });

      it('passes --ignore-rules with --yes', async () => {
        await run(
          'init',
          '--yes',
          '--ignore-rules',
          'bluebird/no-god-service,bluebird/no-console-log'
        );

        expect(initConfigSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            yes: true,
            ignoreRules: ['bluebird/no-god-service', 'bluebird/no-console-log'],
          })
        );
      });

      it('passes --ignore-files with --yes', async () => {
        await run('init', '--yes', '--ignore-files', 'src/legacy/**,src/generated/**');

        expect(initConfigSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            yes: true,
            ignoreFiles: ['src/legacy/**', 'src/generated/**'],
          })
        );
      });

      it('passes all non-interactive flags together', async () => {
        await run(
          'init',
          '--yes',
          '--force',
          '--heuristic',
          '--skip-graph',
          '--ignore-rules',
          'bluebird/no-god-service',
          '--ignore-files',
          'src/legacy/**',
          '--cwd',
          '/custom'
        );

        expect(initConfigSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            cwd: '/custom',
            force: true,
            yes: true,
            includeHeuristic: true,
            noGraphAnalysis: true,
            ignoreRules: ['bluebird/no-god-service'],
            ignoreFiles: ['src/legacy/**'],
          })
        );
      });
    });

    describe('legacy flag warnings', () => {
      it('warns when top-level --include-heuristic is used with init', async () => {
        await run('--include-heuristic', 'init', '--yes');

        expect(logSpy).toHaveBeenCalledWith(
          expect.stringContaining('--include-heuristic is a top-level option')
        );
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('use --heuristic instead'));
      });

      it('does not warn when init --heuristic is used correctly', async () => {
        await run('init', '--yes', '--heuristic');

        // Should not log the warning message
        const calls = logSpy.mock.calls.flat().join(' ');
        expect(calls).not.toContain('--include-heuristic is a top-level option');
      });
    });
  });

  // ---------------------------------------------------------------
  // Explain subcommand
  // ---------------------------------------------------------------
  describe('explain subcommand', () => {
    it('prints all rules with --list', async () => {
      await run('explain', '--list');

      expect(scanSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bluebird Rules'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Total:'));
    });

    it('prints all rules when no arguments provided', async () => {
      await run('explain');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Bluebird Rules'));
    });

    it('filters rules by category with --category', async () => {
      await run('explain', '--category', 'security');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Rules in category: security'));
    });

    it('shows error for invalid category', async () => {
      await run('explain', '--category', 'nonexistent');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No rules found in category'));
    });

    it('explains a specific rule by name', async () => {
      await run('explain', 'no-hardcoded-secrets');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no-hardcoded-secrets'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Category:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Severity:'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('How to fix:'));
    });

    it('explains a specific rule with bluebird/ prefix', async () => {
      await run('explain', 'bluebird/no-hardcoded-secrets');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('no-hardcoded-secrets'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('security'));
    });

    it('shows error for nonexistent rule', async () => {
      await run('explain', 'nonexistent-rule');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Rule not found'));
    });

    it('shows ignore instructions for specific rule', async () => {
      await run('explain', 'no-console-log');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('bluebird-disable-next-line'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('ignore'));
    });
  });
});
