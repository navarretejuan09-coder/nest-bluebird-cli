import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import type {
  ProjectInfo,
  BluebirdConfig,
  BaselineFile,
  ScanResult,
  Diagnostic,
} from '../src/types.js';

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

import ora from 'ora';
import { scan } from '../src/scan.js';
import * as orchestrateMod from '../src/utils/orchestrate.js';
import * as discoverMod from '../src/utils/discover-project.js';
import * as configMod from '../src/utils/load-config.js';
import * as eslintMod from '../src/utils/run-eslint.js';
import * as graphMod from '../src/utils/run-graph-analysis.js';
import * as knipMod from '../src/utils/run-knip.js';
import * as baselineMod from '../src/utils/baseline.js';
import * as fmtTextMod from '../src/utils/format-text.js';
import * as fmtJsonMod from '../src/utils/format-json.js';
import * as fmtSarifMod from '../src/utils/format-sarif.js';

describe('scan', () => {
  const mockProject: ProjectInfo = {
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
  };

  const emptyConfig: BluebirdConfig = {};
  const emptyPass = { diagnostics: [] as Diagnostic[], warnings: [] as never[] };

  let logSpy: MockInstance;
  let stdoutSpy: MockInstance;
  let savedExitCode: number | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    savedExitCode = process.exitCode as number | undefined;
    process.exitCode = undefined;

    vi.spyOn(discoverMod, 'discoverProject').mockResolvedValue(mockProject);
    vi.spyOn(configMod, 'loadConfig').mockResolvedValue(emptyConfig);
    vi.spyOn(baselineMod, 'loadBaseline').mockResolvedValue(null);
    vi.spyOn(eslintMod, 'runEslint').mockResolvedValue(emptyPass);
    vi.spyOn(graphMod, 'runGraphAnalysis').mockResolvedValue(emptyPass);
    vi.spyOn(knipMod, 'runKnip').mockResolvedValue(emptyPass);
    vi.spyOn(fmtTextMod, 'formatText').mockReturnValue('<text output>');
  });

  afterEach(() => {
    process.exitCode = savedExitCode;
    vi.restoreAllMocks();
  });

  // ----------------------------------------------------------------
  // Text format (interactive mode with spinners)
  // ----------------------------------------------------------------
  describe('text format (interactive)', () => {
    it('runs all three passes and prints formatted output', async () => {
      await scan({ cwd: '/test', format: 'text' });

      expect(discoverMod.discoverProject).toHaveBeenCalledWith('/test');
      expect(configMod.loadConfig).toHaveBeenCalledWith('/test');
      expect(eslintMod.runEslint).toHaveBeenCalled();
      expect(knipMod.runKnip).toHaveBeenCalled();
      expect(graphMod.runGraphAnalysis).toHaveBeenCalled();
      expect(fmtTextMod.formatText).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('<text output>');
    });

    it('creates spinners for discovery and each analysis pass', async () => {
      await scan({ cwd: '/test', format: 'text' });

      // 1 for discovery + 3 for each pass (lint, graph, dead-code)
      expect(ora).toHaveBeenCalledTimes(4);
      expect(ora).toHaveBeenCalledWith(expect.stringContaining('Initializing'));
      expect(ora).toHaveBeenCalledWith('Lint analysis');
      expect(ora).toHaveBeenCalledWith('Graph analysis');
      expect(ora).toHaveBeenCalledWith('Dead code analysis');
    });

    it('skips lint pass when lint=false', async () => {
      await scan({ cwd: '/test', format: 'text', lint: false });

      expect(eslintMod.runEslint).not.toHaveBeenCalled();
      expect(knipMod.runKnip).toHaveBeenCalled();
      expect(graphMod.runGraphAnalysis).toHaveBeenCalled();
    });

    it('skips dead code pass when deadCode=false', async () => {
      await scan({ cwd: '/test', format: 'text', deadCode: false });

      expect(eslintMod.runEslint).toHaveBeenCalled();
      expect(knipMod.runKnip).not.toHaveBeenCalled();
      expect(graphMod.runGraphAnalysis).toHaveBeenCalled();
    });

    it('skips graph pass when graphAnalysis=false', async () => {
      await scan({ cwd: '/test', format: 'text', graphAnalysis: false });

      expect(eslintMod.runEslint).toHaveBeenCalled();
      expect(knipMod.runKnip).toHaveBeenCalled();
      expect(graphMod.runGraphAnalysis).not.toHaveBeenCalled();
    });

    it('handles all passes disabled gracefully', async () => {
      await scan({
        cwd: '/test',
        format: 'text',
        lint: false,
        deadCode: false,
        graphAnalysis: false,
      });

      expect(eslintMod.runEslint).not.toHaveBeenCalled();
      expect(knipMod.runKnip).not.toHaveBeenCalled();
      expect(graphMod.runGraphAnalysis).not.toHaveBeenCalled();
      expect(ora).toHaveBeenCalledTimes(1);
      expect(fmtTextMod.formatText).toHaveBeenCalled();
    });

    it('sets exitCode=1 when errors exist', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text' });

      expect(process.exitCode).toBe(1);
    });

    it('does not set exitCode for warnings only', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'warning',
            message: 'warn',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text' });

      expect(process.exitCode).toBeUndefined();
    });

    it('applies baseline filtering and reports baselined count', async () => {
      const bl: BaselineFile = {
        version: 1,
        createdAt: '2025-01-01T00:00:00.000Z',
        entries: [{ rule: 'bluebird/test', filePath: 'a.ts', line: 10 }],
      };
      vi.spyOn(baselineMod, 'loadBaseline').mockResolvedValue(bl);
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
            line: 10,
          },
        ],
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text' });

      const callArgs = vi.mocked(fmtTextMod.formatText).mock.calls[0];
      const result = callArgs[0] as ScanResult;
      expect(result.diagnostics).toHaveLength(0);
      expect(result.baselinedCount).toBe(1);
    });

    it('skips baseline loading when useBaseline=false', async () => {
      await scan({ cwd: '/test', format: 'text', useBaseline: false });

      expect(baselineMod.loadBaseline).not.toHaveBeenCalled();
    });

    it('respects config settings for pass selection', async () => {
      vi.spyOn(configMod, 'loadConfig').mockResolvedValue({
        lint: false,
        deadCode: false,
        graphAnalysis: true,
      });

      await scan({ cwd: '/test', format: 'text' });

      expect(eslintMod.runEslint).not.toHaveBeenCalled();
      expect(knipMod.runKnip).not.toHaveBeenCalled();
      expect(graphMod.runGraphAnalysis).toHaveBeenCalled();
    });

    it('lets CLI options override config', async () => {
      vi.spyOn(configMod, 'loadConfig').mockResolvedValue({ lint: false });

      await scan({ cwd: '/test', format: 'text', lint: true });

      expect(eslintMod.runEslint).toHaveBeenCalled();
    });

    it('propagates discovery errors', async () => {
      vi.spyOn(discoverMod, 'discoverProject').mockRejectedValue(new Error('boom'));

      await expect(scan({ cwd: '/test', format: 'text' })).rejects.toThrow('boom');
    });

    it('propagates analysis errors', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockRejectedValue(new Error('lint boom'));

      await expect(scan({ cwd: '/test', format: 'text' })).rejects.toThrow('lint boom');
    });

    it('passes verbose flag to formatText', async () => {
      await scan({ cwd: '/test', format: 'text', verbose: true });

      expect(fmtTextMod.formatText).toHaveBeenCalledWith(expect.any(Object), true);
    });

    it('passes includeHeuristic to analysis passes', async () => {
      await scan({ cwd: '/test', format: 'text', includeHeuristic: true });

      expect(eslintMod.runEslint).toHaveBeenCalledWith(
        expect.objectContaining({ includeHeuristic: true })
      );
      expect(graphMod.runGraphAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ includeHeuristic: true })
      );
    });

    it('uses process.cwd() when cwd not provided', async () => {
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/default-cwd');

      await scan({ format: 'text' });

      expect(discoverMod.discoverProject).toHaveBeenCalledWith('/default-cwd');
      expect(configMod.loadConfig).toHaveBeenCalledWith('/default-cwd');

      cwdSpy.mockRestore();
    });

    it('passes project info to eslint and graph passes', async () => {
      await scan({ cwd: '/test', format: 'text' });

      expect(eslintMod.runEslint).toHaveBeenCalledWith(
        expect.objectContaining({ project: mockProject })
      );
      expect(graphMod.runGraphAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ project: mockProject })
      );
    });

    it('combines diagnostics from multiple passes', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/r1',
            severity: 'error',
            message: 'm1',
            category: 'architecture',
            confidence: 'deterministic',
            line: 1,
          },
        ],
        warnings: [],
      });
      vi.spyOn(graphMod, 'runGraphAnalysis').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'b.ts',
            plugin: 'bluebird',
            rule: 'bluebird/r2',
            severity: 'warning',
            message: 'm2',
            category: 'architecture',
            confidence: 'deterministic',
            line: 5,
          },
        ],
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text' });

      const callArgs = vi.mocked(fmtTextMod.formatText).mock.calls[0];
      const result = callArgs[0] as ScanResult;
      expect(result.diagnostics).toHaveLength(2);
    });

    it('aggregates warnings from all passes', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [],
        warnings: [{ type: 'io-error', filePath: 'x.ts', message: 'read fail' }],
      });
      vi.spyOn(graphMod, 'runGraphAnalysis').mockResolvedValue({
        diagnostics: [],
        warnings: [{ type: 'parse-error', filePath: 'y.ts', message: 'syntax' }],
      });

      await scan({ cwd: '/test', format: 'text' });

      const callArgs = vi.mocked(fmtTextMod.formatText).mock.calls[0];
      const result = callArgs[0] as ScanResult;
      expect(result.warnings).toHaveLength(2);
    });

    it('includes project info in the scan result', async () => {
      await scan({ cwd: '/test', format: 'text' });

      const callArgs = vi.mocked(fmtTextMod.formatText).mock.calls[0];
      const result = callArgs[0] as ScanResult;
      expect(result.project).toEqual(mockProject);
    });

    it('calculates score based on filtered diagnostics', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text' });

      const callArgs = vi.mocked(fmtTextMod.formatText).mock.calls[0];
      const result = callArgs[0] as ScanResult;
      expect(result.score.score).toBeLessThan(100);
    });
  });

  // ----------------------------------------------------------------
  // JSON format (non-interactive, delegates to diagnose)
  // ----------------------------------------------------------------
  describe('json format', () => {
    it('delegates to orchestrate() and outputs JSON', async () => {
      const mockResult: ScanResult = {
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 100, label: 'Great' },
        baselinedCount: 0,
      };
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue(mockResult);
      vi.spyOn(fmtJsonMod, 'formatJson').mockReturnValue('{"json":true}');

      await scan({ cwd: '/test', format: 'json' });

      expect(orchestrateMod.orchestrate).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('{"json":true}\n');
      expect(ora).not.toHaveBeenCalled();
    });

    it('sets exitCode=1 when errors exist', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 98, label: 'Great' },
        baselinedCount: 0,
      });
      vi.spyOn(fmtJsonMod, 'formatJson').mockReturnValue('{}');

      await scan({ cwd: '/test', format: 'json' });

      expect(process.exitCode).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // SARIF format (non-interactive, delegates to diagnose)
  // ----------------------------------------------------------------
  describe('sarif format', () => {
    it('delegates to orchestrate() and outputs SARIF', async () => {
      const mockResult: ScanResult = {
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 100, label: 'Great' },
        baselinedCount: 0,
      };
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue(mockResult);
      vi.spyOn(fmtSarifMod, 'formatSarif').mockReturnValue('{"sarif":true}');

      await scan({ cwd: '/test', format: 'sarif' });

      expect(orchestrateMod.orchestrate).toHaveBeenCalled();
      expect(stdoutSpy).toHaveBeenCalledWith('{"sarif":true}\n');
      expect(ora).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Quiet mode
  // ----------------------------------------------------------------
  describe('quiet mode', () => {
    it('suppresses all output in text format', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 100, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'text', quiet: true });

      expect(logSpy).not.toHaveBeenCalled();
      expect(stdoutSpy).not.toHaveBeenCalled();
      expect(ora).not.toHaveBeenCalled();
    });

    it('suppresses output in JSON format', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 100, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', quiet: true });

      expect(stdoutSpy).not.toHaveBeenCalled();
    });

    it('still sets exitCode=1 when errors exist in quiet mode', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 98, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'text', quiet: true });

      expect(process.exitCode).toBe(1);
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // fail-on threshold
  // ----------------------------------------------------------------
  describe('fail-on threshold', () => {
    it('failOn=warning sets exitCode=1 when warnings exist', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'warning',
            message: 'warn',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 95, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', failOn: 'warning' });

      expect(process.exitCode).toBe(1);
    });

    it('failOn=warning does not set exitCode when no diagnostics', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 100, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', failOn: 'warning' });

      expect(process.exitCode).toBeUndefined();
    });

    it('failOn=none never sets exitCode even with errors', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 90, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', failOn: 'none' });

      expect(process.exitCode).toBeUndefined();
    });

    it('failOn=error does not set exitCode for warnings only', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'warning',
            message: 'warn',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 95, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', failOn: 'error' });

      expect(process.exitCode).toBeUndefined();
    });

    it('failOn works in interactive text mode', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'warning',
            message: 'warn',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text', failOn: 'warning' });

      expect(process.exitCode).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // Score threshold
  // ----------------------------------------------------------------
  describe('score threshold', () => {
    it('sets exitCode=1 when score is below threshold', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 74, label: 'Needs work' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', scoreThreshold: 75 });

      expect(process.exitCode).toBe(1);
    });

    it('does not set exitCode when score meets threshold', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 75, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', scoreThreshold: 75 });

      expect(process.exitCode).toBeUndefined();
    });

    it('scoreThreshold triggers even when failOn=none', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 50, label: 'Needs work' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', format: 'json', failOn: 'none', scoreThreshold: 75 });

      expect(process.exitCode).toBe(1);
    });

    it('works in interactive text mode', async () => {
      vi.spyOn(eslintMod, 'runEslint').mockResolvedValue({
        diagnostics: Array.from({ length: 20 }, (_, i) => ({
          filePath: `f${i}.ts`,
          plugin: 'bluebird',
          rule: 'bluebird/test',
          severity: 'error' as const,
          message: 'fail',
          category: 'architecture' as const,
          confidence: 'deterministic' as const,
        })),
        warnings: [],
      });

      await scan({ cwd: '/test', format: 'text', scoreThreshold: 99 });

      expect(process.exitCode).toBe(1);
    });
  });

  // ----------------------------------------------------------------
  // Score-only mode
  // ----------------------------------------------------------------
  describe('score-only mode', () => {
    it('prints only the numeric score to stdout', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 85, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', scoreOnly: true });

      expect(stdoutSpy).toHaveBeenCalledWith('85\n');
      expect(logSpy).not.toHaveBeenCalled();
      expect(ora).not.toHaveBeenCalled();
    });

    it('does not invoke any formatter', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 100, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', scoreOnly: true });

      expect(fmtTextMod.formatText).not.toHaveBeenCalled();
    });

    it('sets exitCode=1 when errors exist (default failOn)', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 98, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', scoreOnly: true });

      expect(process.exitCode).toBe(1);
    });

    it('respects scoreThreshold', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [],
        warnings: [],
        score: { score: 60, label: 'Needs work' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', scoreOnly: true, failOn: 'none', scoreThreshold: 80 });

      expect(stdoutSpy).toHaveBeenCalledWith('60\n');
      expect(process.exitCode).toBe(1);
    });

    it('does not set exitCode when failOn=none and no scoreThreshold', async () => {
      vi.spyOn(orchestrateMod, 'orchestrate').mockResolvedValue({
        project: mockProject,
        diagnostics: [
          {
            filePath: 'a.ts',
            plugin: 'bluebird',
            rule: 'bluebird/test',
            severity: 'error',
            message: 'fail',
            category: 'architecture',
            confidence: 'deterministic',
          },
        ],
        warnings: [],
        score: { score: 98, label: 'Great' },
        baselinedCount: 0,
      });

      await scan({ cwd: '/test', scoreOnly: true, failOn: 'none' });

      expect(process.exitCode).toBeUndefined();
    });
  });

  // ----------------------------------------------------------------
  // Default options
  // ----------------------------------------------------------------
  describe('default options', () => {
    it('defaults to text format when format is not specified', async () => {
      await scan({ cwd: '/test' });

      expect(ora).toHaveBeenCalled();
      expect(fmtTextMod.formatText).toHaveBeenCalled();
    });

    it('defaults verbose to false', async () => {
      await scan({ cwd: '/test' });

      expect(fmtTextMod.formatText).toHaveBeenCalledWith(expect.any(Object), false);
    });

    it('defaults quiet to false', async () => {
      await scan({ cwd: '/test' });

      expect(fmtTextMod.formatText).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Diff option
  // ----------------------------------------------------------------
  describe('diff option', () => {
    it('accepts diff option and passes it to orchestrate', async () => {
      const orchestrateSpy = vi.spyOn(orchestrateMod, 'orchestrate');

      await scan({ cwd: '/test', diff: 'main', format: 'json' });

      expect(orchestrateSpy).toHaveBeenCalledWith(expect.objectContaining({ diff: 'main' }));
    });

    it('passes diff through in text mode', async () => {
      await scan({ cwd: '/test', diff: 'develop', format: 'text' });

      expect(fmtTextMod.formatText).toHaveBeenCalled();
    });

    it('passes undefined diff when not provided', async () => {
      const orchestrateSpy = vi.spyOn(orchestrateMod, 'orchestrate');

      await scan({ cwd: '/test', format: 'json' });

      const calledOptions = orchestrateSpy.mock.calls[0][0];
      expect(calledOptions?.diff).toBeUndefined();
    });
  });
});
