import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, access } from 'node:fs/promises';
import { initConfig } from '../src/utils/init-config.js';
import * as discoverProject from '../src/utils/discover-project.js';
import type { ProjectInfo } from '../src/types.js';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    writeFile: vi.fn(),
    access: vi.fn(),
  };
});

vi.mock('prompts', () => ({
  default: vi.fn(),
}));

describe('initConfig', () => {
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

  beforeEach(() => {
    vi.spyOn(discoverProject, 'discoverProject').mockResolvedValue(mockProject);
    vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(writeFile).mockResolvedValue();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not overwrite existing config without force flag', async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    const result = await initConfig({ cwd: '/test' });

    expect(result.created).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('should overwrite existing config with force flag', async () => {
    vi.mocked(access).mockResolvedValue(undefined);
    const prompts = await import('prompts');
    vi.mocked(prompts.default).mockResolvedValue({
      includeHeuristic: false,
      graphAnalysis: true,
      ignoredRules: [],
      ignoredFiles: [],
    });

    const result = await initConfig({ cwd: '/test', force: true });

    expect(result.created).toBe(true);
    expect(writeFile).toHaveBeenCalled();
  });

  it('should create config with user selections', async () => {
    const prompts = await import('prompts');
    vi.mocked(prompts.default).mockResolvedValue({
      includeHeuristic: true,
      graphAnalysis: false,
      ignoredRules: ['bluebird/no-god-controller'],
      ignoredFiles: ['src/legacy/**'],
    });

    const result = await initConfig({ cwd: '/test' });

    expect(result.created).toBe(true);
    expect(result.config.includeHeuristic).toBe(true);
    expect(result.config.graphAnalysis).toBe(false);
    expect(result.config.ignore?.rules).toContain('bluebird/no-god-controller');
    expect(result.config.ignore?.files).toContain('src/legacy/**');
  });

  it('should create minimal config when no options selected', async () => {
    const prompts = await import('prompts');
    vi.mocked(prompts.default).mockResolvedValue({
      includeHeuristic: false,
      graphAnalysis: true,
      ignoredRules: [],
      ignoredFiles: [],
    });

    const result = await initConfig({ cwd: '/test' });

    expect(result.created).toBe(true);
    expect(result.config).toEqual({});
  });

  it('should write config file to correct path', async () => {
    const prompts = await import('prompts');
    vi.mocked(prompts.default).mockResolvedValue({
      includeHeuristic: false,
      graphAnalysis: true,
      ignoredRules: [],
      ignoredFiles: [],
    });

    const result = await initConfig({ cwd: '/test/project' });

    expect(result.path).toBe('/test/project/bluebird.config.json');
    expect(writeFile).toHaveBeenCalledWith(
      '/test/project/bluebird.config.json',
      expect.any(String),
      'utf-8'
    );
  });

  describe('non-interactive mode (--yes)', () => {
    it('should create config with defaults when --yes is used', async () => {
      const result = await initConfig({ cwd: '/test', yes: true });

      expect(result.created).toBe(true);
      expect(result.config).toEqual({});
    });

    it('should apply --heuristic flag in non-interactive mode', async () => {
      const result = await initConfig({
        cwd: '/test',
        yes: true,
        includeHeuristic: true,
      });

      expect(result.created).toBe(true);
      expect(result.config.includeHeuristic).toBe(true);
    });

    it('should apply --skip-graph flag in non-interactive mode', async () => {
      const result = await initConfig({
        cwd: '/test',
        yes: true,
        noGraphAnalysis: true,
      });

      expect(result.created).toBe(true);
      expect(result.config.graphAnalysis).toBe(false);
    });

    it('should apply both --heuristic and --skip-graph flags together', async () => {
      const result = await initConfig({
        cwd: '/test',
        yes: true,
        includeHeuristic: true,
        noGraphAnalysis: true,
      });

      expect(result.created).toBe(true);
      expect(result.config.includeHeuristic).toBe(true);
      expect(result.config.graphAnalysis).toBe(false);
    });

    it('should apply --ignore-rules in non-interactive mode', async () => {
      const result = await initConfig({
        cwd: '/test',
        yes: true,
        ignoreRules: ['bluebird/no-god-service', 'bluebird/no-console-log'],
      });

      expect(result.created).toBe(true);
      expect(result.config.ignore?.rules).toEqual([
        'bluebird/no-god-service',
        'bluebird/no-console-log',
      ]);
    });

    it('should apply --ignore-files in non-interactive mode', async () => {
      const result = await initConfig({
        cwd: '/test',
        yes: true,
        ignoreFiles: ['src/legacy/**', 'src/generated/**'],
      });

      expect(result.created).toBe(true);
      expect(result.config.ignore?.files).toEqual(['src/legacy/**', 'src/generated/**']);
    });

    it('should not call prompts in non-interactive mode', async () => {
      const prompts = await import('prompts');

      await initConfig({ cwd: '/test', yes: true });

      expect(prompts.default).not.toHaveBeenCalled();
    });
  });
});
