import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProjectInfo } from '../src/types.js';
import { analyseFiles, runEslint, toPosix } from '../src/utils/run-eslint.js';

const DEFAULT_PROJECT: ProjectInfo = {
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
  sourceFileCount: 10,
};

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return { ...DEFAULT_PROJECT, ...overrides };
}

// ─── toPosix (OS-independent path normalization) ────────────────────────────

describe('toPosix', () => {
  it('converts backslashes to forward slashes', () => {
    expect(toPosix('src\\modules\\users\\users.service.ts')).toBe(
      'src/modules/users/users.service.ts'
    );
  });

  it('leaves forward-slash paths unchanged', () => {
    expect(toPosix('src/modules/users/users.service.ts')).toBe(
      'src/modules/users/users.service.ts'
    );
  });

  it('handles empty string', () => {
    expect(toPosix('')).toBe('');
  });

  it('handles single segment with no separators', () => {
    expect(toPosix('file.ts')).toBe('file.ts');
  });
});

// ─── analyseFiles (in-memory, no disk I/O) ─────────────────────────────────

describe('analyseFiles', () => {
  it('returns empty result when no files are provided', () => {
    const result = analyseFiles(new Map(), makeProject());
    expect(result).toEqual({ diagnostics: [], warnings: [] });
  });

  it('returns empty diagnostics and warnings for clean code', () => {
    const files = new Map([
      [
        'src/app.service.ts',
        `
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
`,
      ],
    ]);
    const result = analyseFiles(files, makeProject());
    expect(result.diagnostics).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('detects hardcoded secrets', () => {
    const files = new Map([['src/config.ts', `const password = "hunter2";`]]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    expect(result.length).toBe(1);
    expect(result[0].rule).toBe('bluebird/no-hardcoded-secrets');
    expect(result[0].severity).toBe('error');
    expect(result[0].plugin).toBe('bluebird');
    expect(result[0].filePath).toBe('src/config.ts');
    expect(result[0].category).toBe('security');
    expect(result[0].confidence).toBe('deterministic');
  });

  it('detects missing @Injectable decorator', () => {
    const files = new Map([
      [
        'src/users.service.ts',
        `
export class UsersService {
  constructor(private readonly repo: UserRepository) {}
  findAll() { return []; }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const injectable = result.find((d) => d.rule === 'bluebird/missing-injectable');
    expect(injectable).toBeDefined();
    expect(injectable!.severity).toBe('error');
  });

  it('detects missing ValidationPipe in bootstrap file', () => {
    const files = new Map([
      [
        'src/main.ts',
        `
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const pipe = result.find((d) => d.rule === 'bluebird/missing-validation-pipe');
    expect(pipe).toBeDefined();
    expect(pipe!.severity).toBe('warning');
  });

  it('detects sync fs operations', () => {
    const files = new Map([
      [
        'src/file.service.ts',
        `
import { Injectable } from '@nestjs/common';
import fs from 'fs';

@Injectable()
export class FileService {
  read() {
    return fs.readFileSync('data.txt', 'utf-8');
  }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const syncFs = result.find((d) => d.rule === 'bluebird/no-sync-fs-operations');
    expect(syncFs).toBeDefined();
    expect(syncFs!.category).toBe('performance');
  });

  it('detects raw SQL with template interpolation', () => {
    const files = new Map([
      ['src/repo.ts', 'const query = `SELECT * FROM users WHERE id = ${userId}`;'],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const rawSql = result.find((d) => d.rule === 'bluebird/no-raw-sql');
    expect(rawSql).toBeDefined();
    expect(rawSql!.severity).toBe('error');
  });

  it('detects any type in DTO', () => {
    const files = new Map([
      [
        'src/create-user.dto.ts',
        `
export class CreateUserDto {
  name: string;
  metadata: any;
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const anyDto = result.find((d) => d.rule === 'bluebird/no-any-in-dto');
    expect(anyDto).toBeDefined();
    expect(anyDto!.category).toBe('security');
  });

  it('detects constructor side effects', () => {
    const files = new Map([
      [
        'src/boot.service.ts',
        `
import { Injectable } from '@nestjs/common';

@Injectable()
export class BootService {
  constructor() {
    console.log('booting...');
  }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const sideEffect = result.find((d) => d.rule === 'bluebird/no-constructor-side-effects');
    expect(sideEffect).toBeDefined();
    expect(sideEffect!.category).toBe('correctness');
  });

  it('detects lifecycle hook without interface', () => {
    const files = new Map([
      [
        'src/init.service.ts',
        `
import { Injectable } from '@nestjs/common';

@Injectable()
export class InitService {
  onModuleInit() {
    // setup
  }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const hook = result.find((d) => d.rule === 'bluebird/lifecycle-hook-interface');
    expect(hook).toBeDefined();
  });

  it('detects hardcoded dependency instantiation', () => {
    const files = new Map([
      [
        'src/app.controller.ts',
        `
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  private svc = new AppService();

  @Get()
  hello() { return this.svc.getHello(); }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const hardcoded = result.find((d) => d.rule === 'bluebird/no-hardcoded-dependency');
    expect(hardcoded).toBeDefined();
    expect(hardcoded!.severity).toBe('error');
    expect(hardcoded!.category).toBe('architecture');
  });

  it('detects missing swagger decorators when swagger is enabled', () => {
    const files = new Map([
      [
        'src/users.controller.ts',
        `
import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  findAll() { return []; }
}
`,
      ],
    ]);
    const project = makeProject({
      features: { ...DEFAULT_PROJECT.features, swagger: true },
    });
    const { diagnostics: result } = analyseFiles(files, project);
    const swagger = result.find((d) => d.rule === 'bluebird/missing-swagger-decorators');
    expect(swagger).toBeDefined();
  });

  it('skips swagger rule when swagger is not detected', () => {
    const files = new Map([
      [
        'src/users.controller.ts',
        `
import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  findAll() { return []; }
}
`,
      ],
    ]);
    const project = makeProject({
      features: { ...DEFAULT_PROJECT.features, swagger: false },
    });
    const { diagnostics: result } = analyseFiles(files, project);
    const swagger = result.find((d) => d.rule === 'bluebird/missing-swagger-decorators');
    expect(swagger).toBeUndefined();
  });

  it('excludes heuristic rules by default', () => {
    const files = new Map([
      [
        'src/users.controller.ts',
        `
import { Controller, Post, HttpCode } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Post()
  @HttpCode(200)
  create() { return {}; }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject(), false);
    const heuristic = result.find((d) => d.rule === 'bluebird/no-inconsistent-http-status');
    expect(heuristic).toBeUndefined();
  });

  it('includes heuristic rules when flag is set', () => {
    const files = new Map([
      [
        'src/users.controller.ts',
        `
import { Controller, Post, HttpCode } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Post()
  @HttpCode(200)
  create() { return {}; }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject(), true);
    const heuristic = result.find((d) => d.rule === 'bluebird/no-inconsistent-http-status');
    expect(heuristic).toBeDefined();
    expect(heuristic!.confidence).toBe('heuristic');
  });

  it('does not report low-test-coverage when a matching spec file exists', () => {
    const files = new Map([
      [
        'src/users.service.ts',
        `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
      ],
      ['src/users.service.spec.ts', 'describe("UsersService", () => {});'],
    ]);

    const { diagnostics } = analyseFiles(files, makeProject(), true);
    expect(diagnostics.find((d) => d.rule === 'bluebird/low-test-coverage')).toBeUndefined();
  });

  it('reports low-test-coverage when no matching spec or test file exists', () => {
    const files = new Map([
      [
        'src/users.service.ts',
        `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
      ],
    ]);

    const { diagnostics } = analyseFiles(files, makeProject(), true);
    expect(diagnostics.find((d) => d.rule === 'bluebird/low-test-coverage')).toBeDefined();
  });

  it('handles multiple files with multiple violations', () => {
    const files = new Map([
      ['src/a.ts', `const password = "secret123";`],
      ['src/b.ts', `const api_key = "abc-def";`],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const secrets = result.filter((d) => d.rule === 'bluebird/no-hardcoded-secrets');
    expect(secrets.length).toBe(2);
  });

  it('sorts diagnostics by file path then line number', () => {
    const files = new Map([
      [
        'src/z.ts',
        `const password = "secret-value-123";
const api_key = "key-value-456";`,
      ],
      ['src/a.ts', `const secret = "another-secret-789";`],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.length; i++) {
      const cmp =
        result[i].filePath.localeCompare(result[i - 1].filePath) ||
        (result[i].line ?? 0) - (result[i - 1].line ?? 0);
      expect(cmp).toBeGreaterThanOrEqual(0);
    }
  });

  it('populates help from rule meta when violation has no help', () => {
    const files = new Map([['src/config.ts', `const password = "hunter2";`]]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const d = result.find((d) => d.rule === 'bluebird/no-hardcoded-secrets');
    expect(d).toBeDefined();
    expect(d!.help).toBe(
      'Move secrets to environment variables and access them via ConfigService.'
    );
  });

  it('does not flag graph-pass rules', () => {
    const files = new Map([
      [
        'src/a.module.ts',
        `
import { Module } from '@nestjs/common';
@Module({ imports: [BModule] })
export class AModule {}
`,
      ],
      [
        'src/b.module.ts',
        `
import { Module } from '@nestjs/common';
@Module({ imports: [AModule] })
export class BModule {}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const circular = result.find((d) => d.rule === 'bluebird/no-circular-dependency');
    expect(circular).toBeUndefined();
  });

  it('detects entity returned directly from controller', () => {
    const files = new Map([
      [
        'src/users.controller.ts',
        `
import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UsersController {
  @Get()
  findAll(): UserEntity[] { return []; }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const entity = result.find((d) => d.rule === 'bluebird/no-entity-as-response');
    expect(entity).toBeDefined();
  });

  it('detects blocking crypto operations', () => {
    const files = new Map([
      [
        'src/hash.service.ts',
        `
import { Injectable } from '@nestjs/common';
import crypto from 'crypto';

@Injectable()
export class HashService {
  hash(pw: string) {
    return crypto.pbkdf2Sync(pw, 'salt', 100000, 64, 'sha512');
  }
}
`,
      ],
    ]);
    const { diagnostics: result } = analyseFiles(files, makeProject());
    const blocking = result.find((d) => d.rule === 'bluebird/no-blocking-crypto');
    expect(blocking).toBeDefined();
    expect(blocking!.category).toBe('performance');
  });

  it('emits parse-error warning for files with syntax errors', () => {
    const files = new Map([['src/broken.ts', `const x: = ;`]]);
    const { warnings } = analyseFiles(files, makeProject());
    const parseWarning = warnings.find((w) => w.type === 'parse-error');
    expect(parseWarning).toBeDefined();
    expect(parseWarning!.filePath).toBe('src/broken.ts');
    expect(parseWarning!.message).toContain('syntax error');
  });

  it('does not emit parse warnings for valid files', () => {
    const files = new Map([
      [
        'src/app.service.ts',
        `
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string { return 'Hello'; }
}
`,
      ],
    ]);
    const { warnings } = analyseFiles(files, makeProject());
    expect(warnings).toEqual([]);
  });
});

// ─── runEslint (filesystem-based) ──────────────────────────────────────────

describe('runEslint', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'bluebird-test-'));
    await mkdir(join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('discovers and analyses .ts files from disk', async () => {
    await writeFile(join(tmpDir, 'src', 'config.ts'), `const password = "hunter2";`);

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });

    const secret = result.find((d) => d.rule === 'bluebird/no-hardcoded-secrets');
    expect(secret).toBeDefined();
    expect(secret!.filePath).toBe('src/config.ts');
  });

  it('skips node_modules directory', async () => {
    await mkdir(join(tmpDir, 'node_modules', 'some-pkg'), { recursive: true });
    await writeFile(
      join(tmpDir, 'node_modules', 'some-pkg', 'index.ts'),
      `const password = "secret";`
    );

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(result).toEqual([]);
  });

  it('skips dist directory', async () => {
    await mkdir(join(tmpDir, 'dist'), { recursive: true });
    await writeFile(join(tmpDir, 'dist', 'config.ts'), `const password = "secret";`);

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(result).toEqual([]);
  });

  it('skips .d.ts declaration files', async () => {
    await writeFile(join(tmpDir, 'src', 'types.d.ts'), `const password = "secret";`);

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(result).toEqual([]);
  });

  it('analyses nested directories', async () => {
    await mkdir(join(tmpDir, 'src', 'modules', 'users'), { recursive: true });
    await writeFile(
      join(tmpDir, 'src', 'modules', 'users', 'users.service.ts'),
      `
export class UsersService {
  constructor(private readonly repo: UserRepository) {}
  findAll() { return []; }
}
`
    );

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    const injectable = result.find((d) => d.rule === 'bluebird/missing-injectable');
    expect(injectable).toBeDefined();
    expect(injectable!.filePath).toContain('src/modules/users/users.service.ts');
  });

  it('returns empty diagnostics for a clean project', async () => {
    await writeFile(
      join(tmpDir, 'src', 'app.service.ts'),
      `
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string { return 'Hello'; }
}
`
    );

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(result).toEqual([]);
  });

  it('emits io-error warning for non-existent directory', async () => {
    const { diagnostics, warnings } = await runEslint({
      cwd: join(tmpDir, 'does-not-exist'),
      project: makeProject(),
    });
    expect(diagnostics).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0].type).toBe('io-error');
    expect(warnings[0].filePath).toBe('.');
  });

  it('combines diagnostics from multiple files', async () => {
    await writeFile(join(tmpDir, 'src', 'a.ts'), `const password = "secret1";`);
    await writeFile(join(tmpDir, 'src', 'b.ts'), `const api_key = "secret2";`);

    const { diagnostics: result } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(result.length).toBe(2);
    expect(result.every((d) => d.rule === 'bluebird/no-hardcoded-secrets')).toBe(true);
  });

  it('discovers .mts and .cts files', async () => {
    await writeFile(join(tmpDir, 'src', 'config.mts'), `const password = "hunter2";`);
    await writeFile(join(tmpDir, 'src', 'config.cts'), `const api_key = "secret";`);

    const { diagnostics } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    const secrets = diagnostics.filter((d) => d.rule === 'bluebird/no-hardcoded-secrets');
    expect(secrets.length).toBe(2);
  });

  it('skips .d.mts and .d.cts declaration files', async () => {
    await writeFile(join(tmpDir, 'src', 'types.d.mts'), `const password = "secret";`);
    await writeFile(join(tmpDir, 'src', 'types.d.cts'), `const api_key = "secret";`);

    const { diagnostics } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(diagnostics).toEqual([]);
  });

  it('emits parse-error warnings for syntax-broken files on disk', async () => {
    await writeFile(join(tmpDir, 'src', 'broken.ts'), `const x: = ;`);

    const { warnings } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    const parseWarning = warnings.find((w) => w.type === 'parse-error');
    expect(parseWarning).toBeDefined();
    expect(parseWarning!.filePath).toBe('src/broken.ts');
  });

  it('produces forward-slash paths for nested files on any OS', async () => {
    await mkdir(join(tmpDir, 'src', 'deep', 'nested'), { recursive: true });
    await writeFile(
      join(tmpDir, 'src', 'deep', 'nested', 'config.ts'),
      `const password = "hunter2";`
    );

    const { diagnostics } = await runEslint({
      cwd: tmpDir,
      project: makeProject(),
    });
    expect(diagnostics.length).toBe(1);
    expect(diagnostics[0].filePath).toBe('src/deep/nested/config.ts');
    expect(diagnostics[0].filePath).not.toContain('\\');
  });
});
