import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import {
  convertKnipIssues,
  extractFailedPluginName,
  findMonorepoRoot,
  hasNodeModules,
  isBarrelFile,
  isWorkspaceResolutionError,
  resetKnipCache,
  resolveTsConfigFile,
  runKnip,
  runKnipWithOptions,
  type KnipIssues,
} from '../src/utils/run-knip.js';
import { MAX_KNIP_RETRIES } from '../src/constants.js';

// ─── isBarrelFile ───────────────────────────────────────────────────────────

describe('isBarrelFile', () => {
  it('should return true for index.ts files', () => {
    expect(isBarrelFile('/project/src/index.ts')).toBe(true);
    expect(isBarrelFile('/project/src/users/index.ts')).toBe(true);
    expect(isBarrelFile('src/index.ts')).toBe(true);
    expect(isBarrelFile('index.ts')).toBe(true);
  });

  it('should return true for index.js files', () => {
    expect(isBarrelFile('/project/src/index.js')).toBe(true);
    expect(isBarrelFile('/project/dist/index.js')).toBe(true);
    expect(isBarrelFile('index.js')).toBe(true);
  });

  it('should handle Windows-style paths', () => {
    expect(isBarrelFile('C:\\project\\src\\index.ts')).toBe(true);
    expect(isBarrelFile('C:\\project\\src\\index.js')).toBe(true);
  });

  it('should return false for non-barrel files', () => {
    expect(isBarrelFile('/project/src/main.ts')).toBe(false);
    expect(isBarrelFile('/project/src/service.ts')).toBe(false);
    expect(isBarrelFile('/project/src/index.spec.ts')).toBe(false);
    expect(isBarrelFile('/project/src/index-utils.ts')).toBe(false);
  });

  it('should return false for files named similar to index', () => {
    expect(isBarrelFile('/project/src/indexer.ts')).toBe(false);
    expect(isBarrelFile('/project/src/reindex.ts')).toBe(false);
  });
});

// ─── convertKnipIssues ─────────────────────────────────────────────────────

describe('convertKnipIssues', () => {
  const ROOT = '/project';

  it('should return empty array for no issues', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {},
      types: {},
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toEqual([]);
  });

  it('should convert unused files', () => {
    const issues: KnipIssues = {
      files: new Set(['/project/src/old.ts', '/project/src/unused.ts']),
      exports: {},
      types: {},
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      filePath: 'src/old.ts',
      plugin: 'knip',
      rule: 'knip/files',
      severity: 'warning',
      message: 'Unused file',
      help: 'This file is not imported by any other file in the project.',
      line: 0,
      column: 0,
      category: 'dead-code',
      confidence: 'deterministic',
    });
    expect(result[1].filePath).toBe('src/unused.ts');
  });

  it('should convert unused exports with line info', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {
        '/project/src/utils.ts': {
          helperFn: {
            filePath: '/project/src/utils.ts',
            symbol: 'helperFn',
            line: 42,
            col: 14,
          },
        },
      },
      types: {},
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      filePath: 'src/utils.ts',
      plugin: 'knip',
      rule: 'knip/exports',
      severity: 'warning',
      message: 'Unused export: helperFn',
      help: 'This export is not used anywhere in the project. Consider removing it or marking it as an entry point in knip config.',
      line: 42,
      column: 14,
      category: 'dead-code',
      confidence: 'deterministic',
    });
  });

  it('should convert unused types', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {},
      types: {
        '/project/src/types.ts': {
          OldInterface: {
            filePath: '/project/src/types.ts',
            symbol: 'OldInterface',
            line: 10,
            col: 1,
          },
        },
      },
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('knip/types');
    expect(result[0].message).toBe('Unused exported type: OldInterface');
  });

  it('should convert duplicate exports', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {},
      types: {},
      duplicates: {
        '/project/src/shared.ts': {
          doSomething: {
            filePath: '/project/src/shared.ts',
            symbol: 'doSomething',
            line: 5,
            col: 1,
          },
        },
      },
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('knip/duplicates');
    expect(result[0].message).toBe('Duplicate export: doSomething');
  });

  it('should handle mixed issue types', () => {
    const issues: KnipIssues = {
      files: new Set(['/project/src/dead.ts']),
      exports: {
        '/project/src/api.ts': {
          oldEndpoint: {
            filePath: '/project/src/api.ts',
            symbol: 'oldEndpoint',
          },
        },
      },
      types: {
        '/project/src/models.ts': {
          LegacyModel: {
            filePath: '/project/src/models.ts',
            symbol: 'LegacyModel',
          },
        },
      },
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toHaveLength(3);
    expect(result.map((d) => d.rule)).toEqual(['knip/files', 'knip/exports', 'knip/types']);
  });

  it('should handle missing line/col by defaulting to 0', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {
        '/project/src/utils.ts': {
          noLocation: {
            filePath: '/project/src/utils.ts',
            symbol: 'noLocation',
          },
        },
      },
      types: {},
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result[0].line).toBe(0);
    expect(result[0].column).toBe(0);
  });

  it('should skip exports warnings for barrel files (index.ts)', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {
        '/project/src/index.ts': {
          helperFn: {
            filePath: '/project/src/index.ts',
            symbol: 'helperFn',
            line: 1,
            col: 1,
          },
        },
        '/project/src/utils/index.ts': {
          formatDate: {
            filePath: '/project/src/utils/index.ts',
            symbol: 'formatDate',
            line: 2,
            col: 1,
          },
        },
        '/project/src/service.ts': {
          unusedMethod: {
            filePath: '/project/src/service.ts',
            symbol: 'unusedMethod',
            line: 10,
            col: 1,
          },
        },
      },
      types: {},
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    // Only the non-barrel file export should be reported
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/service.ts');
    expect(result[0].message).toBe('Unused export: unusedMethod');
  });

  it('should skip types warnings for barrel files but NOT duplicates', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {},
      types: {
        '/project/src/index.ts': {
          UnusedType: {
            filePath: '/project/src/index.ts',
            symbol: 'UnusedType',
            line: 5,
            col: 1,
          },
        },
      },
      duplicates: {
        '/project/src/index.ts': {
          duplicatedFn: {
            filePath: '/project/src/index.ts',
            symbol: 'duplicatedFn',
            line: 10,
            col: 1,
          },
        },
      },
    };

    const result = convertKnipIssues(issues, ROOT);

    // Types are skipped for barrel files (re-export aggregation)
    // Duplicates are still reported (actual issues)
    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('knip/duplicates');
  });

  it('should handle multiple issues in the same file', () => {
    const issues: KnipIssues = {
      files: new Set(),
      exports: {
        '/project/src/service.ts': {
          fnA: {
            filePath: '/project/src/service.ts',
            symbol: 'fnA',
            line: 10,
            col: 1,
          },
          fnB: {
            filePath: '/project/src/service.ts',
            symbol: 'fnB',
            line: 30,
            col: 1,
          },
        },
      },
      types: {},
      duplicates: {},
    };

    const result = convertKnipIssues(issues, ROOT);

    expect(result).toHaveLength(2);
    expect(result[0].message).toBe('Unused export: fnA');
    expect(result[1].message).toBe('Unused export: fnB');
  });
});

// ─── findMonorepoRoot ───────────────────────────────────────────────────────

describe('findMonorepoRoot', () => {
  let existsSyncSpy: MockInstance;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null when no monorepo marker is found', () => {
    existsSyncSpy.mockReturnValue(false);

    const result = findMonorepoRoot('/home/user/projects/myapp');

    expect(result).toBeNull();
  });

  it('should find pnpm-workspace.yaml in parent directory', () => {
    existsSyncSpy.mockImplementation((p) => {
      return String(p) === path.join('/home/user/projects', 'pnpm-workspace.yaml');
    });

    const result = findMonorepoRoot('/home/user/projects/myapp');

    expect(result).toBe('/home/user/projects');
  });

  it('should find lerna.json in ancestor directory', () => {
    existsSyncSpy.mockImplementation((p) => {
      return String(p) === path.join('/home/user/projects', 'lerna.json');
    });

    const result = findMonorepoRoot('/home/user/projects/packages/mylib');

    expect(result).toBe('/home/user/projects');
  });

  it('should find nx.json as a monorepo marker', () => {
    existsSyncSpy.mockImplementation((p) => {
      return String(p) === path.join('/workspace', 'nx.json');
    });

    const result = findMonorepoRoot('/workspace/apps/api');

    expect(result).toBe('/workspace');
  });

  it('should not return the workspace directory itself as the root', () => {
    existsSyncSpy.mockImplementation((p) => {
      return String(p) === path.join('/workspace/apps/api', 'pnpm-workspace.yaml');
    });

    const result = findMonorepoRoot('/workspace/apps/api');

    expect(result).toBeNull();
  });
});

// ─── extractFailedPluginName ─────────────────────────────────────────────────

describe('extractFailedPluginName', () => {
  it('should extract plugin name from config loading error', () => {
    const error = new Error('Error loading /project/jest.config.ts');

    expect(extractFailedPluginName(error)).toBe('jest');
  });

  it('should extract hyphenated plugin name', () => {
    const error = new Error('Error loading /project/babel-preset.config.js');

    expect(extractFailedPluginName(error)).toBe('babel-preset');
  });

  it('should return null for non-matching error', () => {
    const error = new Error('Some other error');

    expect(extractFailedPluginName(error)).toBeNull();
  });

  it('should return null for non-error input', () => {
    expect(extractFailedPluginName('string error')).toBeNull();
  });

  it('should return null for undefined input', () => {
    expect(extractFailedPluginName(undefined)).toBeNull();
  });

  it('should extract plugin name from Windows-style backslash path', () => {
    const error = new Error('Error loading C:\\project\\jest.config.ts');

    expect(extractFailedPluginName(error)).toBe('jest');
  });

  it('should extract plugin name with dots (vitest.workspace)', () => {
    const error = new Error('Error loading /project/vitest.workspace.config.ts');

    expect(extractFailedPluginName(error)).toBe('vitest.workspace');
  });

  it('should extract plugin name with underscores', () => {
    const error = new Error('Error loading /project/jest_custom.config.mjs');

    expect(extractFailedPluginName(error)).toBe('jest_custom');
  });

  it('should extract plugin name with digits', () => {
    const error = new Error('Error loading /project/webpack5.config.js');

    expect(extractFailedPluginName(error)).toBe('webpack5');
  });
});

// ─── resolveTsConfigFile ────────────────────────────────────────────────────

describe('resolveTsConfigFile', () => {
  let existsSyncSpy: MockInstance;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should prefer tsconfig.base.json when it exists', () => {
    existsSyncSpy.mockImplementation((p) => {
      return String(p).endsWith('tsconfig.base.json');
    });

    expect(resolveTsConfigFile('/project')).toBe('tsconfig.base.json');
  });

  it('should fall back to tsconfig.json when tsconfig.base.json is missing', () => {
    existsSyncSpy.mockImplementation((p) => {
      return String(p).endsWith('tsconfig.json') && !String(p).includes('base');
    });

    expect(resolveTsConfigFile('/project')).toBe('tsconfig.json');
  });

  it('should return undefined when no tsconfig file exists', () => {
    existsSyncSpy.mockReturnValue(false);

    expect(resolveTsConfigFile('/project')).toBeUndefined();
  });
});

// ─── hasNodeModules ─────────────────────────────────────────────────────────

describe('hasNodeModules', () => {
  let existsSyncSpy: MockInstance;
  let statSyncSpy: MockInstance;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
    statSyncSpy = vi.spyOn(fs, 'statSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return true when node_modules directory exists', () => {
    existsSyncSpy.mockReturnValue(true);
    statSyncSpy.mockReturnValue({ isDirectory: () => true } as fs.Stats);

    expect(hasNodeModules('/project')).toBe(true);
  });

  it('should return false when node_modules does not exist', () => {
    existsSyncSpy.mockReturnValue(false);

    expect(hasNodeModules('/project')).toBe(false);
  });

  it('should return false when node_modules is a file, not a directory', () => {
    existsSyncSpy.mockReturnValue(true);
    statSyncSpy.mockReturnValue({ isDirectory: () => false } as fs.Stats);

    expect(hasNodeModules('/project')).toBe(false);
  });

  it('should return false when statSync throws', () => {
    existsSyncSpy.mockReturnValue(true);
    statSyncSpy.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    expect(hasNodeModules('/project')).toBe(false);
  });
});

// ─── isWorkspaceResolutionError ──────────────────────────────────────────────

describe('isWorkspaceResolutionError', () => {
  it('should match "workspace" errors (case-insensitive)', () => {
    expect(isWorkspaceResolutionError(new Error('Workspace "my-app" not found'))).toBe(true);
    expect(isWorkspaceResolutionError(new Error('Invalid workspace configuration'))).toBe(true);
  });

  it('should match "Cannot find configuration" errors', () => {
    expect(isWorkspaceResolutionError(new Error('Cannot find configuration for workspace'))).toBe(
      true
    );
  });

  it('should match "not found in workspaces" errors', () => {
    expect(isWorkspaceResolutionError(new Error('"my-app" not found in workspaces'))).toBe(true);
  });

  it('should match "No matching project" errors', () => {
    expect(isWorkspaceResolutionError(new Error('No matching project for my-app'))).toBe(true);
  });

  it('should not match unrelated errors', () => {
    expect(isWorkspaceResolutionError(new Error('out of memory'))).toBe(false);
    expect(isWorkspaceResolutionError(new Error('EACCES: permission denied'))).toBe(false);
    expect(isWorkspaceResolutionError(new Error('Error loading /project/jest.config.ts'))).toBe(
      false
    );
  });

  it('should handle string and undefined inputs', () => {
    expect(isWorkspaceResolutionError('workspace not found')).toBe(true);
    expect(isWorkspaceResolutionError(undefined)).toBe(false);
  });
});

// ─── isWorkspaceResolutionError ──────────────────────────────────────────────

describe('isWorkspaceResolutionError', () => {
  it('should match workspace-related errors (case-insensitive)', () => {
    expect(isWorkspaceResolutionError(new Error('Workspace "my-app" not found'))).toBe(true);
    expect(isWorkspaceResolutionError(new Error('Invalid workspace configuration'))).toBe(true);
  });

  it('should match "Cannot find configuration" errors', () => {
    expect(isWorkspaceResolutionError(new Error('Cannot find configuration for workspace'))).toBe(
      true
    );
  });

  it('should match "not found in workspaces" errors', () => {
    expect(isWorkspaceResolutionError(new Error('"my-app" not found in workspaces'))).toBe(true);
  });

  it('should match "No matching project" errors', () => {
    expect(isWorkspaceResolutionError(new Error('No matching project for my-app'))).toBe(true);
  });

  it('should not match unrelated errors', () => {
    expect(isWorkspaceResolutionError(new Error('out of memory'))).toBe(false);
    expect(isWorkspaceResolutionError(new Error('EACCES: permission denied'))).toBe(false);
    expect(isWorkspaceResolutionError(new Error('Error loading /project/jest.config.ts'))).toBe(
      false
    );
  });

  it('should handle string and undefined inputs', () => {
    expect(isWorkspaceResolutionError('workspace not found')).toBe(true);
    expect(isWorkspaceResolutionError(undefined)).toBe(false);
  });
});

// ─── runKnipWithOptions retry behavior ──────────────────────────────────────

describe('runKnipWithOptions retry behavior', () => {
  const emptyIssues: KnipIssues = {
    files: new Set(),
    exports: {},
    types: {},
    duplicates: {},
  };

  let mockMain: ReturnType<typeof vi.fn>;
  let parsedConfig: Record<string, unknown>;

  beforeEach(() => {
    parsedConfig = {};
    mockMain = vi.fn();

    const mockCreateOptions = vi.fn().mockResolvedValue({ parsedConfig });
    resetKnipCache(mockMain, mockCreateOptions);

    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
  });

  afterEach(() => {
    resetKnipCache(undefined, undefined);
    vi.restoreAllMocks();
  });

  it('should disable the failed plugin and retry on config-loading error', async () => {
    mockMain
      .mockRejectedValueOnce(new Error('Error loading /project/jest.config.ts'))
      .mockResolvedValueOnce({ issues: emptyIssues });

    const result = await runKnipWithOptions('/project');

    expect(parsedConfig['jest']).toBe(false);
    expect(mockMain).toHaveBeenCalledTimes(2);
    expect(result.issues).toBe(emptyIssues);
  });

  it('should disable multiple plugins across retries', async () => {
    mockMain
      .mockRejectedValueOnce(new Error('Error loading /project/jest.config.ts'))
      .mockRejectedValueOnce(new Error('Error loading /project/vitest.workspace.config.ts'))
      .mockResolvedValueOnce({ issues: emptyIssues });

    await runKnipWithOptions('/project');

    expect(parsedConfig['jest']).toBe(false);
    expect(parsedConfig['vitest.workspace']).toBe(false);
    expect(mockMain).toHaveBeenCalledTimes(3);
  });

  it('should throw after MAX_KNIP_RETRIES exhaustion', async () => {
    for (let i = 0; i <= MAX_KNIP_RETRIES; i++) {
      mockMain.mockRejectedValueOnce(new Error(`Error loading /project/plugin${i}.config.ts`));
    }

    await expect(runKnipWithOptions('/project')).rejects.toThrow(
      `Error loading /project/plugin${MAX_KNIP_RETRIES}.config.ts`
    );

    expect(mockMain).toHaveBeenCalledTimes(MAX_KNIP_RETRIES + 1);
    for (let i = 0; i < MAX_KNIP_RETRIES; i++) {
      expect(parsedConfig[`plugin${i}`]).toBe(false);
    }
  });

  it('should rethrow immediately if error is not a config-loading error', async () => {
    mockMain.mockRejectedValueOnce(new Error('ENOMEM: out of memory'));

    await expect(runKnipWithOptions('/project')).rejects.toThrow('ENOMEM: out of memory');

    expect(mockMain).toHaveBeenCalledTimes(1);
  });

  it('should succeed on first attempt with no retries', async () => {
    mockMain.mockResolvedValueOnce({ issues: emptyIssues });

    const result = await runKnipWithOptions('/project');

    expect(mockMain).toHaveBeenCalledTimes(1);
    expect(result.issues).toBe(emptyIssues);
    // parsedConfig should only have 'entry' key with NestJS-aware defaults
    expect(Object.keys(parsedConfig)).toEqual(['entry']);
    expect(Array.isArray(parsedConfig.entry)).toBe(true);
  });
});

// ─── runKnip (integration-style with mocks) ─────────────────────────────────

describe('runKnip', () => {
  const realExistsSync = fs.existsSync.bind(fs);
  const realStatSync = fs.statSync.bind(fs);
  let existsSyncSpy: MockInstance;
  let statSyncSpy: MockInstance;

  beforeEach(() => {
    existsSyncSpy = vi.spyOn(fs, 'existsSync');
    statSyncSpy = vi.spyOn(fs, 'statSync');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return empty diagnostics with warning when node_modules is missing', async () => {
    existsSyncSpy.mockReturnValue(false);

    const result = await runKnip({ cwd: '/project' });

    expect(result.diagnostics).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('io-error');
    expect(result.warnings[0].message).toContain('node_modules not found');
  });

  it('should check monorepo root for node_modules when cwd lacks them', async () => {
    existsSyncSpy.mockImplementation((p) => {
      const s = String(p);
      if (s === path.join('/monorepo/packages/app', 'node_modules')) return false;
      if (s === path.join('/monorepo', 'pnpm-workspace.yaml')) return true;
      if (s === path.join('/monorepo', 'node_modules')) return true;
      return realExistsSync(p);
    });
    statSyncSpy.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('node_modules')) {
        return { isDirectory: () => true, isFile: () => false } as fs.Stats;
      }
      return realStatSync(p);
    });

    const result = await runKnip({ cwd: '/monorepo/packages/app' });

    expect(result.warnings[0]?.message).not.toContain('node_modules not found');
  });

  it('should return warning message from the skip path', async () => {
    existsSyncSpy.mockReturnValue(false);

    const result = await runKnip({ cwd: '/no-deps-project' });

    expect(result.warnings[0].message).toBe(
      'Skipping dead code analysis: node_modules not found. Run your package manager install first.'
    );
    expect(result.warnings[0].filePath).toBe('.');
  });

  it('should sort diagnostics by file path then line', () => {
    const issues: KnipIssues = {
      files: new Set(['/project/src/z.ts', '/project/src/a.ts']),
      exports: {
        '/project/src/a.ts': {
          late: { filePath: '/project/src/a.ts', symbol: 'late', line: 50 },
          early: { filePath: '/project/src/a.ts', symbol: 'early', line: 5 },
        },
      },
      types: {},
      duplicates: {},
    };

    const diagnostics = convertKnipIssues(issues, '/project');
    diagnostics.sort(
      (a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0)
    );

    expect(diagnostics[0].filePath).toBe('src/a.ts');
    expect(diagnostics[diagnostics.length - 1].filePath).toBe('src/z.ts');
  });

  it('should produce diagnostics with category dead-code and plugin knip', () => {
    const issues: KnipIssues = {
      files: new Set(['/project/src/unused.ts']),
      exports: {},
      types: {},
      duplicates: {},
    };

    const diagnostics = convertKnipIssues(issues, '/project');

    for (const d of diagnostics) {
      expect(d.category).toBe('dead-code');
      expect(d.plugin).toBe('knip');
      expect(d.confidence).toBe('deterministic');
    }
  });
});
