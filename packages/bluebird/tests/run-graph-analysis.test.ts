import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { ProjectInfo } from '../src/types.js';
import { analyseGraph, runGraphAnalysis, toPosix } from '../src/utils/run-graph-analysis.js';

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
      swagger: true,
      bull: false,
      config: false,
      throttler: false,
      cache: false,
    },
    ...overrides,
  };
}

// ─── analyseGraph basics ────────────────────────────────────────────────────

describe('analyseGraph', () => {
  it('returns empty diagnostics for an empty file map', () => {
    const result = analyseGraph(new Map(), makeProject());
    expect(result.diagnostics).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('returns empty diagnostics when no graph rules are enabled', () => {
    const files = new Map<string, string>();
    files.set('app.module.ts', `@Module({}) class AppModule {}`);
    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics).toHaveLength(0);
  });

  it('detects circular module dependency', () => {
    const files = new Map<string, string>();
    files.set('a.module.ts', `@Module({ imports: [BModule] }) class AModule {}`);
    files.set('b.module.ts', `@Module({ imports: [AModule] }) class BModule {}`);

    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].rule).toBe('bluebird/no-circular-dependency');
    expect(result.diagnostics[0].plugin).toBe('bluebird');
    expect(result.diagnostics[0].category).toBe('architecture');
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].confidence).toBe('deterministic');
    expect(result.diagnostics[0].message).toContain('Circular');
  });

  it('detects duplicate routes across controllers', () => {
    const files = new Map<string, string>();
    files.set(
      'users.controller.ts',
      `
      @Controller('users')
      class UsersController {
        @Get(':id')
        findOne() {}
      }
    `
    );
    files.set(
      'admin-users.controller.ts',
      `
      @Controller('users')
      class AdminUsersController {
        @Get(':id')
        findById() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].rule).toBe('bluebird/no-duplicate-route');
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].message).toContain('Duplicate route');
  });

  it('does not flag acyclic module graph', () => {
    const files = new Map<string, string>();
    files.set('app.module.ts', `@Module({ imports: [UsersModule] }) class AppModule {}`);
    files.set('users.module.ts', `@Module({}) class UsersModule {}`);

    const result = analyseGraph(files, makeProject());
    const circularDiags = result.diagnostics.filter(
      (d) => d.rule === 'bluebird/no-circular-dependency'
    );
    expect(circularDiags).toHaveLength(0);
  });

  it('does not flag distinct routes', () => {
    const files = new Map<string, string>();
    files.set(
      'users.controller.ts',
      `
      @Controller('users')
      class UsersController {
        @Get()
        findAll() {}
      }
    `
    );
    files.set(
      'orders.controller.ts',
      `
      @Controller('orders')
      class OrdersController {
        @Get()
        findAll() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupRouteDiags = result.diagnostics.filter(
      (d) => d.rule === 'bluebird/no-duplicate-route'
    );
    expect(dupRouteDiags).toHaveLength(0);
  });
});

// ─── Diagnostic shape ───────────────────────────────────────────────────────

describe('analyseGraph diagnostic shape', () => {
  it('produces diagnostics with all required fields', () => {
    const files = new Map<string, string>();
    files.set('a.module.ts', `@Module({ imports: [BModule] }) class AModule {}`);
    files.set('b.module.ts', `@Module({ imports: [AModule] }) class BModule {}`);

    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);

    const diag = result.diagnostics[0];
    expect(diag).toHaveProperty('filePath');
    expect(diag).toHaveProperty('plugin');
    expect(diag).toHaveProperty('rule');
    expect(diag).toHaveProperty('severity');
    expect(diag).toHaveProperty('message');
    expect(diag).toHaveProperty('category');
    expect(diag).toHaveProperty('confidence');
    expect(diag).toHaveProperty('help');
  });

  it('diagnostics are sorted by filePath then line', () => {
    const files = new Map<string, string>();
    files.set(
      'z-controller.ts',
      `
      @Controller('items')
      class ZController {
        @Get()
        findAll() {}
      }
    `
    );
    files.set(
      'a-controller.ts',
      `
      @Controller('items')
      class AController {
        @Get()
        listAll() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    if (dupDiags.length > 1) {
      for (let i = 1; i < dupDiags.length; i++) {
        const cmp =
          dupDiags[i].filePath.localeCompare(dupDiags[i - 1].filePath) ||
          (dupDiags[i].line ?? 0) - (dupDiags[i - 1].line ?? 0);
        expect(cmp).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

// ─── Parse warnings ─────────────────────────────────────────────────────────

describe('analyseGraph parse warnings', () => {
  it('emits a parse warning for files with syntax errors', () => {
    const files = new Map<string, string>();
    files.set('broken.module.ts', `@Module({ imports: [) class Bad {}`);

    const result = analyseGraph(files, makeProject());
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0].type).toBe('parse-error');
    expect(result.warnings[0].filePath).toBe('broken.module.ts');
    expect(result.warnings[0].message).toContain('syntax error');
  });

  it('still produces diagnostics from parseable files alongside broken ones', () => {
    const files = new Map<string, string>();
    files.set('a.module.ts', `@Module({ imports: [BModule] }) class AModule {}`);
    files.set('b.module.ts', `@Module({ imports: [AModule] }) class BModule {}`);
    files.set('broken.ts', `class { invalid syntax }`);

    const result = analyseGraph(files, makeProject());
    const circularDiags = result.diagnostics.filter(
      (d) => d.rule === 'bluebird/no-circular-dependency'
    );
    expect(circularDiags.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Both rules running simultaneously ──────────────────────────────────────

describe('analyseGraph multiple rules', () => {
  it('reports violations from both graph rules in a single pass', () => {
    const files = new Map<string, string>();
    files.set(
      'a.module.ts',
      `
      @Module({ imports: [BModule] })
      class AModule {}
    `
    );
    files.set(
      'b.module.ts',
      `
      @Module({ imports: [AModule] })
      class BModule {}
    `
    );
    files.set(
      'first.controller.ts',
      `
      @Controller('items')
      class FirstController {
        @Post()
        create() {}
      }
    `
    );
    files.set(
      'second.controller.ts',
      `
      @Controller('items')
      class SecondController {
        @Post()
        addItem() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const circularDiags = result.diagnostics.filter(
      (d) => d.rule === 'bluebird/no-circular-dependency'
    );
    const dupRouteDiags = result.diagnostics.filter(
      (d) => d.rule === 'bluebird/no-duplicate-route'
    );
    expect(circularDiags.length).toBeGreaterThanOrEqual(1);
    expect(dupRouteDiags.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── forwardRef handling ────────────────────────────────────────────────────

describe('analyseGraph forwardRef', () => {
  it('resolves forwardRef imports and detects cycles', () => {
    const files = new Map<string, string>();
    files.set('x.module.ts', `@Module({ imports: [forwardRef(() => YModule)] }) class XModule {}`);
    files.set('y.module.ts', `@Module({ imports: [XModule] }) class YModule {}`);

    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].rule).toBe('bluebird/no-circular-dependency');
  });
});

// ─── Three-module cycle ─────────────────────────────────────────────────────

describe('analyseGraph three-module cycle', () => {
  it('detects A → B → C → A cycle', () => {
    const files = new Map<string, string>();
    files.set('a.module.ts', `@Module({ imports: [BModule] }) class AModule {}`);
    files.set('b.module.ts', `@Module({ imports: [CModule] }) class BModule {}`);
    files.set('c.module.ts', `@Module({ imports: [AModule] }) class CModule {}`);

    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    const msg = result.diagnostics.map((d) => d.message).join(' ');
    expect(msg).toContain('Circular');
  });
});

// ─── toPosix helper ─────────────────────────────────────────────────────────

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosix('src\\modules\\app.module.ts')).toBe('src/modules/app.module.ts');
  });

  it('leaves forward slashes unchanged', () => {
    expect(toPosix('src/modules/app.module.ts')).toBe('src/modules/app.module.ts');
  });

  it('handles empty string', () => {
    expect(toPosix('')).toBe('');
  });
});

// ─── Duplicate route edge cases ─────────────────────────────────────────────

describe('analyseGraph duplicate route edge cases', () => {
  it('does not flag same path with different HTTP methods', () => {
    const files = new Map<string, string>();
    files.set(
      'users.controller.ts',
      `
      @Controller('users')
      class UsersController {
        @Get(':id')
        findOne() {}

        @Delete(':id')
        remove() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    expect(dupDiags).toHaveLength(0);
  });

  it('detects duplicate routes within the same controller', () => {
    const files = new Map<string, string>();
    files.set(
      'items.controller.ts',
      `
      @Controller('items')
      class ItemsController {
        @Get()
        listItems() {}

        @Get()
        getAllItems() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    expect(dupDiags.length).toBeGreaterThanOrEqual(1);
  });

  it('handles @Controller() without a path argument', () => {
    const files = new Map<string, string>();
    files.set(
      'root-a.controller.ts',
      `
      @Controller()
      class RootAController {
        @Get('health')
        health() {}
      }
    `
    );
    files.set(
      'root-b.controller.ts',
      `
      @Controller()
      class RootBController {
        @Get('health')
        healthCheck() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    expect(dupDiags.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Non-string decorator args (false-positive prevention) ──────────────────

describe('analyseGraph non-string decorator args', () => {
  it('skips controllers with variable-based path args (no false-positive duplicates)', () => {
    const files = new Map<string, string>();
    files.set(
      'a.controller.ts',
      `
      @Controller(API_PREFIX)
      class AController {
        @Get()
        findAll() {}
      }
    `
    );
    files.set(
      'b.controller.ts',
      `
      @Controller(ANOTHER_PREFIX)
      class BController {
        @Get()
        findAll() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    expect(dupDiags).toHaveLength(0);
  });

  it('skips handlers with non-string path args (no false-positive duplicates)', () => {
    const files = new Map<string, string>();
    files.set(
      'a.controller.ts',
      `
      @Controller('items')
      class AController {
        @Get(PATHS.LIST)
        findAll() {}
      }
    `
    );
    files.set(
      'b.controller.ts',
      `
      @Controller('items')
      class BController {
        @Get(PATHS.DETAIL)
        findOne() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    expect(dupDiags).toHaveLength(0);
  });

  it('still detects true duplicates with string-literal paths', () => {
    const files = new Map<string, string>();
    files.set(
      'a.controller.ts',
      `
      @Controller('users')
      class AController {
        @Get(':id')
        findOne() {}
      }
    `
    );
    files.set(
      'b.controller.ts',
      `
      @Controller('users')
      class BController {
        @Get(':id')
        findById() {}
      }
    `
    );

    const result = analyseGraph(files, makeProject());
    const dupDiags = result.diagnostics.filter((d) => d.rule === 'bluebird/no-duplicate-route');
    expect(dupDiags.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Files with no modules or controllers ───────────────────────────────────

describe('analyseGraph with plain files', () => {
  it('produces no diagnostics for files without modules or controllers', () => {
    const files = new Map<string, string>();
    files.set('app.service.ts', `class AppService { getData() { return []; } }`);
    files.set('utils.ts', `export function add(a: number, b: number) { return a + b; }`);

    const result = analyseGraph(files, makeProject());
    expect(result.diagnostics).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── includeHeuristic flag ──────────────────────────────────────────────────

describe('analyseGraph includeHeuristic', () => {
  it('produces same results regardless of includeHeuristic when no heuristic graph rules exist', () => {
    const files = new Map<string, string>();
    files.set('a.module.ts', `@Module({ imports: [BModule] }) class AModule {}`);
    files.set('b.module.ts', `@Module({ imports: [AModule] }) class BModule {}`);

    const withoutHeuristic = analyseGraph(files, makeProject(), false);
    const withHeuristic = analyseGraph(files, makeProject(), true);

    expect(withoutHeuristic.diagnostics.length).toBe(withHeuristic.diagnostics.length);
  });
});

// ─── runGraphAnalysis (async filesystem runner) ─────────────────────────────

describe('runGraphAnalysis', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'bluebird-graph-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('discovers and analyses .ts files from disk', async () => {
    await writeFile(
      join(tempDir, 'a.module.ts'),
      `@Module({ imports: [BModule] }) class AModule {}`
    );
    await writeFile(
      join(tempDir, 'b.module.ts'),
      `@Module({ imports: [AModule] }) class BModule {}`
    );

    const result = await runGraphAnalysis({
      cwd: tempDir,
      project: makeProject(),
    });

    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics[0].rule).toBe('bluebird/no-circular-dependency');
  });

  it('returns empty diagnostics for a project with no .ts files', async () => {
    await writeFile(join(tempDir, 'readme.md'), '# Hello');

    const result = await runGraphAnalysis({
      cwd: tempDir,
      project: makeProject(),
    });

    expect(result.diagnostics).toHaveLength(0);
  });

  it('skips node_modules and dist directories', async () => {
    await mkdir(join(tempDir, 'node_modules'), { recursive: true });
    await writeFile(
      join(tempDir, 'node_modules', 'a.module.ts'),
      `@Module({ imports: [BModule] }) class AModule {}`
    );
    await mkdir(join(tempDir, 'dist'), { recursive: true });
    await writeFile(
      join(tempDir, 'dist', 'b.module.ts'),
      `@Module({ imports: [AModule] }) class BModule {}`
    );

    const result = await runGraphAnalysis({
      cwd: tempDir,
      project: makeProject(),
    });

    expect(result.diagnostics).toHaveLength(0);
  });

  it('skips declaration files (.d.ts)', async () => {
    await writeFile(join(tempDir, 'types.d.ts'), `declare module 'test' {}`);
    await writeFile(join(tempDir, 'app.module.ts'), `@Module({}) class AppModule {}`);

    const result = await runGraphAnalysis({
      cwd: tempDir,
      project: makeProject(),
    });

    const circularDiags = result.diagnostics.filter(
      (d) => d.rule === 'bluebird/no-circular-dependency'
    );
    expect(circularDiags).toHaveLength(0);
  });

  it('discovers files in subdirectories', async () => {
    await mkdir(join(tempDir, 'src', 'modules'), { recursive: true });
    await writeFile(
      join(tempDir, 'src', 'modules', 'a.module.ts'),
      `@Module({ imports: [BModule] }) class AModule {}`
    );
    await writeFile(
      join(tempDir, 'src', 'modules', 'b.module.ts'),
      `@Module({ imports: [AModule] }) class BModule {}`
    );

    const result = await runGraphAnalysis({
      cwd: tempDir,
      project: makeProject(),
    });

    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('reports io-error warning for unreadable directories', async () => {
    const result = await runGraphAnalysis({
      cwd: join(tempDir, 'nonexistent'),
      project: makeProject(),
    });

    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0].type).toBe('io-error');
  });

  it('analyses .mts files', async () => {
    await writeFile(
      join(tempDir, 'a.module.mts'),
      `@Module({ imports: [BModule] }) class AModule {}`
    );
    await writeFile(
      join(tempDir, 'b.module.mts'),
      `@Module({ imports: [AModule] }) class BModule {}`
    );

    const result = await runGraphAnalysis({
      cwd: tempDir,
      project: makeProject(),
    });

    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
  });
});
