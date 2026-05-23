import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { diagnose } from '../src/index.js';
import * as discoverProject from '../src/utils/discover-project.js';
import * as loadConfig from '../src/utils/load-config.js';
import * as runEslint from '../src/utils/run-eslint.js';
import * as runGraphAnalysis from '../src/utils/run-graph-analysis.js';
import * as runKnipModule from '../src/utils/run-knip.js';
import * as baseline from '../src/utils/baseline.js';
import * as diffFiles from '../src/utils/diff-files.js';
import type { ProjectInfo, BluebirdConfig, BaselineFile } from '../src/types.js';

describe('diagnose', () => {
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

  const mockConfig: BluebirdConfig = {};

  beforeEach(() => {
    vi.spyOn(discoverProject, 'discoverProject').mockResolvedValue(mockProject);
    vi.spyOn(loadConfig, 'loadConfig').mockResolvedValue(mockConfig);
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({ diagnostics: [], warnings: [] });
    vi.spyOn(runGraphAnalysis, 'runGraphAnalysis').mockResolvedValue({
      diagnostics: [],
      warnings: [],
    });
    vi.spyOn(runKnipModule, 'runKnip').mockResolvedValue({ diagnostics: [], warnings: [] });
    vi.spyOn(diffFiles, 'getChangedTypeScriptFiles').mockResolvedValue({
      files: null,
      warnings: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return project info, diagnostics, warnings, and score', async () => {
    const result = await diagnose({ cwd: '/test' });

    expect(result.project).toEqual(mockProject);
    expect(result.diagnostics).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.score).toEqual({ score: 100, label: 'Great' });
  });

  it('should run all three passes by default', async () => {
    await diagnose({ cwd: '/test' });

    expect(runEslint.runEslint).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test',
        project: mockProject,
        includeHeuristic: false,
      })
    );
    expect(runKnipModule.runKnip).toHaveBeenCalledWith({ cwd: '/test' });
    expect(runGraphAnalysis.runGraphAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test',
        project: mockProject,
        includeHeuristic: false,
      })
    );
  });

  it('should skip eslint pass when lint=false', async () => {
    await diagnose({ cwd: '/test', lint: false });

    expect(runEslint.runEslint).not.toHaveBeenCalled();
    expect(runGraphAnalysis.runGraphAnalysis).toHaveBeenCalled();
  });

  it('should skip dead code pass when deadCode=false', async () => {
    await diagnose({ cwd: '/test', deadCode: false });

    expect(runEslint.runEslint).toHaveBeenCalled();
    expect(runKnipModule.runKnip).not.toHaveBeenCalled();
    expect(runGraphAnalysis.runGraphAnalysis).toHaveBeenCalled();
  });

  it('should skip graph pass when graphAnalysis=false', async () => {
    await diagnose({ cwd: '/test', graphAnalysis: false });

    expect(runEslint.runEslint).toHaveBeenCalled();
    expect(runGraphAnalysis.runGraphAnalysis).not.toHaveBeenCalled();
  });

  it('should respect config file settings', async () => {
    vi.spyOn(loadConfig, 'loadConfig').mockResolvedValue({
      lint: false,
      deadCode: false,
      graphAnalysis: true,
      includeHeuristic: true,
    });

    await diagnose({ cwd: '/test' });

    expect(runEslint.runEslint).not.toHaveBeenCalled();
    expect(runKnipModule.runKnip).not.toHaveBeenCalled();
    expect(runGraphAnalysis.runGraphAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test',
        project: mockProject,
        includeHeuristic: true,
      })
    );
  });

  it('should let CLI options override config', async () => {
    vi.spyOn(loadConfig, 'loadConfig').mockResolvedValue({
      lint: false,
      includeHeuristic: false,
    });

    await diagnose({ cwd: '/test', lint: true, includeHeuristic: true });

    expect(runEslint.runEslint).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/test',
        project: mockProject,
        includeHeuristic: true,
      })
    );
  });

  it('should combine diagnostics from multiple passes', async () => {
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-controller',
          severity: 'error',
          message: 'God controller',
          category: 'architecture',
          confidence: 'deterministic',
          line: 10,
        },
      ],
      warnings: [],
    });
    vi.spyOn(runGraphAnalysis, 'runGraphAnalysis').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'b.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-circular-dependency',
          severity: 'error',
          message: 'Circular dependency',
          category: 'architecture',
          confidence: 'deterministic',
          line: 5,
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test' });

    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0].filePath).toBe('a.ts');
    expect(result.diagnostics[1].filePath).toBe('b.ts');
  });

  it('should filter diagnostics based on config ignore rules', async () => {
    vi.spyOn(loadConfig, 'loadConfig').mockResolvedValue({
      ignore: {
        rules: ['bluebird/no-god-controller'],
      },
    });
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-controller',
          severity: 'error',
          message: 'God controller',
          category: 'architecture',
          confidence: 'deterministic',
        },
        {
          filePath: 'b.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-hardcoded-secrets',
          severity: 'error',
          message: 'Hardcoded secret',
          category: 'security',
          confidence: 'deterministic',
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test' });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].rule).toBe('bluebird/no-hardcoded-secrets');
  });

  it('should calculate score based on filtered diagnostics', async () => {
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-controller',
          severity: 'error',
          message: 'God controller',
          category: 'architecture',
          confidence: 'deterministic',
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test' });

    expect(result.score.score).toBeLessThan(100);
  });

  it('should aggregate warnings from all passes', async () => {
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [],
      warnings: [{ type: 'io-error', filePath: 'src/missing.ts', message: 'Could not read file' }],
    });
    vi.spyOn(runGraphAnalysis, 'runGraphAnalysis').mockResolvedValue({
      diagnostics: [],
      warnings: [
        { type: 'parse-error', filePath: 'src/broken.ts', message: 'File has 1 syntax error' },
      ],
    });

    const result = await diagnose({ cwd: '/test' });

    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0].type).toBe('io-error');
    expect(result.warnings[1].type).toBe('parse-error');
  });

  it('should return empty warnings when passes produce none', async () => {
    const result = await diagnose({ cwd: '/test' });
    expect(result.warnings).toEqual([]);
  });

  it('should use process.cwd() when cwd not provided', async () => {
    const originalCwd = process.cwd();
    vi.spyOn(process, 'cwd').mockReturnValue('/default-cwd');

    await diagnose();

    expect(discoverProject.discoverProject).toHaveBeenCalledWith('/default-cwd');
    expect(loadConfig.loadConfig).toHaveBeenCalledWith('/default-cwd');

    vi.spyOn(process, 'cwd').mockReturnValue(originalCwd);
  });

  it('should return baselinedCount of 0 when no baseline exists', async () => {
    const result = await diagnose({ cwd: '/test' });
    expect(result.baselinedCount).toBe(0);
  });

  it('should filter diagnostics against baseline', async () => {
    const mockBaseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [{ rule: 'bluebird/no-god-controller', filePath: 'a.ts', line: 10 }],
    };
    vi.spyOn(baseline, 'loadBaseline').mockResolvedValue(mockBaseline);

    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-controller',
          severity: 'error',
          message: 'God controller',
          category: 'architecture',
          confidence: 'deterministic',
          line: 10,
        },
        {
          filePath: 'b.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-hardcoded-secrets',
          severity: 'error',
          message: 'Hardcoded secret',
          category: 'security',
          confidence: 'deterministic',
          line: 5,
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test' });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].rule).toBe('bluebird/no-hardcoded-secrets');
    expect(result.baselinedCount).toBe(1);
  });

  it('should skip baseline when useBaseline is false', async () => {
    vi.spyOn(baseline, 'loadBaseline');

    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-controller',
          severity: 'error',
          message: 'God controller',
          category: 'architecture',
          confidence: 'deterministic',
          line: 10,
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test', useBaseline: false });

    expect(baseline.loadBaseline).not.toHaveBeenCalled();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.baselinedCount).toBe(0);
  });

  it('should apply waivers from config', async () => {
    vi.spyOn(loadConfig, 'loadConfig').mockResolvedValue({
      waivers: [
        {
          rule: 'bluebird/no-sync-fs-operations',
          file: 'src/scripts/**',
          reason: 'CLI scripts',
        },
      ],
    });
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'src/scripts/setup.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-sync-fs-operations',
          severity: 'warning',
          message: 'Sync FS operation',
          category: 'performance',
          confidence: 'deterministic',
        },
        {
          filePath: 'src/app.service.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-sync-fs-operations',
          severity: 'warning',
          message: 'Sync FS operation',
          category: 'performance',
          confidence: 'deterministic',
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test' });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].filePath).toBe('src/app.service.ts');
  });

  it('should accept diff option without error', async () => {
    const result = await diagnose({ cwd: '/test', diff: 'main' });

    expect(diffFiles.getChangedTypeScriptFiles).toHaveBeenCalledWith('/test', 'main');
    expect(result.project).toEqual(mockProject);
    expect(result.diagnostics).toEqual([]);
    expect(result.score.score).toBe(100);
  });

  it('should accept diff option from config', async () => {
    vi.spyOn(loadConfig, 'loadConfig').mockResolvedValue({ diff: 'develop' });

    const result = await diagnose({ cwd: '/test' });

    expect(diffFiles.getChangedTypeScriptFiles).toHaveBeenCalledWith('/test', 'develop');
    expect(result.project).toEqual(mockProject);
    expect(result.score.score).toBe(100);
  });

  it('filters diagnostics to changed files in diff mode', async () => {
    vi.spyOn(diffFiles, 'getChangedTypeScriptFiles').mockResolvedValue({
      files: new Set(['src/a.ts']),
      warnings: [],
    });
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'src/a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-service',
          severity: 'warning',
          message: 'A',
          category: 'architecture',
          confidence: 'deterministic',
        },
        {
          filePath: 'src/b.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-god-service',
          severity: 'warning',
          message: 'B',
          category: 'architecture',
          confidence: 'deterministic',
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test', diff: 'main' });

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].filePath).toBe('src/a.ts');
  });

  it('should include calibration summary when calibrate=true', async () => {
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/no-hardcoded-secrets',
          severity: 'error',
          message: 'Hardcoded secret',
          category: 'security',
          confidence: 'deterministic',
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test', calibrate: true });

    expect(result.calibration).toBeDefined();
    expect(result.calibration!.confirmedCount).toBe(1);
    expect(result.calibration!.uncertainCount).toBe(0);
    expect(result.calibration!.likelyFalsePositiveCount).toBe(0);
    expect(result.calibration!.calibratedScore.score).toBe(99);
  });

  it('should not include calibration when calibrate is not set', async () => {
    const result = await diagnose({ cwd: '/test' });
    expect(result.calibration).toBeUndefined();
  });

  it('should classify heuristic diagnostics as likely_false_positive when evidence refutes', async () => {
    vi.spyOn(discoverProject, 'discoverProject').mockResolvedValue({
      ...mockProject,
      orm: 'none',
    });
    vi.spyOn(runEslint, 'runEslint').mockResolvedValue({
      diagnostics: [
        {
          filePath: 'a.ts',
          plugin: 'bluebird',
          rule: 'bluebird/missing-indexes',
          severity: 'warning',
          message: 'Missing indexes',
          category: 'database',
          confidence: 'heuristic',
        },
      ],
      warnings: [],
    });

    const result = await diagnose({ cwd: '/test', calibrate: true, includeHeuristic: true });

    expect(result.calibration).toBeDefined();
    expect(result.calibration!.likelyFalsePositiveCount).toBe(1);
    expect(result.calibration!.calibratedScore.score).toBe(100);
    expect(result.diagnostics[0].calibration).toBe('likely_false_positive');
  });
});
