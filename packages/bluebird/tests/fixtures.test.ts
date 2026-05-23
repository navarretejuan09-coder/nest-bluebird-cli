import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { analyseFiles } from '../src/utils/run-eslint.js';
import { analyseGraph } from '../src/utils/run-graph-analysis.js';
import { discoverProject } from '../src/utils/discover-project.js';
import { combineDiagnostics } from '../src/utils/combine-diagnostics.js';
import { filterDiagnostics } from '../src/utils/filter-diagnostics.js';
import { calculateScore } from '../src/utils/calculate-score.js';
import { applyBaseline } from '../src/utils/baseline.js';
import type { BaselineFile, BluebirdConfig, ProjectInfo } from '../src/types.js';

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `bluebird-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

async function writeProjectFile(relativePath: string, content: string) {
  const fullPath = join(testDir, relativePath);
  await mkdir(join(fullPath, '..'), { recursive: true });
  await writeFile(fullPath, content);
}

async function writePkg(
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
  extra: Record<string, unknown> = {}
) {
  await writeFile(
    join(testDir, 'package.json'),
    JSON.stringify({
      name: 'test-nestjs-app',
      dependencies: deps,
      devDependencies: devDeps,
      ...extra,
    })
  );
}

async function writeTsconfig(compilerOptions: Record<string, unknown> = {}) {
  await writeFile(join(testDir, 'tsconfig.json'), JSON.stringify({ compilerOptions }));
}

// ── Fixture 1: Clean NestJS Project ─────────────────────────────────────────

describe('fixture: clean NestJS project', () => {
  beforeEach(async () => {
    await writePkg(
      {
        '@nestjs/core': '^10.3.0',
        '@nestjs/common': '^10.3.0',
        '@nestjs/platform-express': '^10.3.0',
        '@nestjs/config': '^3.0.0',
      },
      {
        typescript: '^5.3.0',
      }
    );
    await writeTsconfig({ strict: true });

    await writeProjectFile(
      'src/main.ts',
      `
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(3000);
}
bootstrap();
`
    );

    await writeProjectFile(
      'src/app.module.ts',
      `
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
`
    );

    await writeProjectFile(
      'src/app.service.ts',
      `
import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
`
    );

    await writeProjectFile(
      'src/app.controller.ts',
      `
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
`
    );

    await writeProjectFile('src/app.controller.spec.ts', `describe('AppController', () => {});`);
  });

  it('discovers project metadata correctly', async () => {
    const info = await discoverProject(testDir);

    expect(info.nestVersion).toBe('10.3.0');
    expect(info.httpAdapter).toBe('express');
    expect(info.orm).toBe('none');
    expect(info.features.config).toBe(true);
    expect(info.strictTypeScript).toBe(true);
    expect(info.hasTests).toBe(true);
    expect(info.sourceFileCount).toBeGreaterThanOrEqual(4);
  });

  it('produces no lint diagnostics', async () => {
    const project = await discoverProject(testDir);

    const files = new Map<string, string>();
    files.set(
      'src/main.ts',
      `
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(3000);
}
bootstrap();
`
    );
    files.set(
      'src/app.service.ts',
      `
import { Injectable } from '@nestjs/common';
@Injectable()
export class AppService {
  getHello(): string { return 'Hello World!'; }
}
`
    );
    files.set(
      'src/app.controller.ts',
      `
import { Controller, Get } from '@nestjs/common';
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}
  @Get()
  getHello(): string { return this.appService.getHello(); }
}
`
    );

    const { diagnostics } = analyseFiles(files, project);
    expect(diagnostics).toEqual([]);
  });

  it('produces no graph diagnostics', async () => {
    const project = await discoverProject(testDir);
    const files = new Map<string, string>();
    files.set(
      'src/app.module.ts',
      `
@Module({ imports: [], controllers: [AppController], providers: [AppService] })
export class AppModule {}
`
    );

    const { diagnostics } = analyseGraph(files, project);
    expect(diagnostics).toEqual([]);
  });

  it('achieves a perfect score', async () => {
    const { score, label } = calculateScore([]);
    expect(score).toBe(100);
    expect(label).toBe('Great');
  });
});

// ── Fixture 2: Problematic NestJS Project ───────────────────────────────────

describe('fixture: problematic NestJS project', () => {
  let project: ProjectInfo;

  beforeEach(async () => {
    await writePkg({
      '@nestjs/core': '^10.3.0',
      '@nestjs/common': '^10.3.0',
      '@nestjs/platform-express': '^10.3.0',
      '@nestjs/swagger': '^7.0.0',
    });
    await writeTsconfig({ strict: true });

    project = {
      nestVersion: '10.3.0',
      httpAdapter: 'express',
      orm: 'none',
      strictTypeScript: true,
      hasTests: false,
      sourceFileCount: 10,
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
    };
  });

  it('detects multiple violation types from lint pass', () => {
    const files = new Map<string, string>();

    files.set(
      'src/main.ts',
      `
import { NestFactory } from '@nestjs/core';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}
bootstrap();
`
    );

    files.set(
      'src/users.service.ts',
      `
export class UsersService {
  constructor(private readonly repo: UserRepository) {}
  private readonly db_password = "super-secret-123";
  findAll() {
    const data = fs.readFileSync('users.json', 'utf-8');
    return JSON.parse(data);
  }
}
`
    );

    files.set(
      'src/users.controller.ts',
      `
import { Controller, Get } from '@nestjs/common';
@Controller('users')
export class UsersController {
  private svc = new UsersService();
  @Get()
  findAll(): UserEntity[] { return this.svc.findAll(); }
}
`
    );

    const { diagnostics } = analyseFiles(files, project);
    const rules = new Set(diagnostics.map((d) => d.rule));

    expect(rules.has('bluebird/missing-validation-pipe')).toBe(true);
    expect(rules.has('bluebird/missing-injectable')).toBe(true);
    expect(rules.has('bluebird/no-hardcoded-secrets')).toBe(true);
    expect(rules.has('bluebird/no-sync-fs-operations')).toBe(true);
    expect(rules.has('bluebird/no-hardcoded-dependency')).toBe(true);
    expect(rules.has('bluebird/no-entity-as-response')).toBe(true);
  });

  it('detects missing swagger decorators when swagger is present', () => {
    const files = new Map<string, string>();
    files.set(
      'src/items.controller.ts',
      `
import { Controller, Get, Post } from '@nestjs/common';
@Controller('items')
export class ItemsController {
  @Get()
  findAll() { return []; }

  @Post()
  create() { return {}; }
}
`
    );

    const { diagnostics } = analyseFiles(files, project);
    const swagger = diagnostics.filter((d) => d.rule === 'bluebird/missing-swagger-decorators');
    expect(swagger.length).toBe(2);
  });

  it('detects circular module dependencies from graph pass', () => {
    const files = new Map<string, string>();
    files.set('src/auth/auth.module.ts', `@Module({ imports: [UsersModule] }) class AuthModule {}`);
    files.set(
      'src/users/users.module.ts',
      `@Module({ imports: [AuthModule] }) class UsersModule {}`
    );

    const { diagnostics } = analyseGraph(files, project);
    expect(diagnostics.some((d) => d.rule === 'bluebird/no-circular-dependency')).toBe(true);
  });

  it('detects duplicate routes from graph pass', () => {
    const files = new Map<string, string>();
    files.set(
      'src/users.controller.ts',
      `
@Controller('users')
class UsersController {
  @Get(':id') findOne() {}
}
`
    );
    files.set(
      'src/admin-users.controller.ts',
      `
@Controller('users')
class AdminUsersController {
  @Get(':id') findById() {}
}
`
    );

    const { diagnostics } = analyseGraph(files, project);
    expect(diagnostics.some((d) => d.rule === 'bluebird/no-duplicate-route')).toBe(true);
  });

  it('combines lint and graph diagnostics into sorted result', () => {
    const lintDiags = analyseFiles(
      new Map([['src/config.ts', `const password = "secret123";`]]),
      project
    );
    const graphDiags = analyseGraph(
      new Map([
        ['a.module.ts', `@Module({ imports: [BModule] }) class AModule {}`],
        ['b.module.ts', `@Module({ imports: [AModule] }) class BModule {}`],
      ]),
      project
    );

    const combined = combineDiagnostics(lintDiags.diagnostics, graphDiags.diagnostics);
    expect(combined.length).toBeGreaterThan(1);

    for (let i = 1; i < combined.length; i++) {
      const cmp =
        combined[i].filePath.localeCompare(combined[i - 1].filePath) ||
        (combined[i].line ?? 0) - (combined[i - 1].line ?? 0);
      expect(cmp).toBeGreaterThanOrEqual(0);
    }
  });

  it('score degrades with multiple violations', () => {
    const files = new Map<string, string>();
    files.set('src/a.ts', `const password = "secret";`);
    files.set('src/b.ts', `const api_key = "key123";`);
    files.set(
      'src/c.ts',
      `
export class CService {
  constructor() { console.log("init"); }
}
`
    );

    const { diagnostics } = analyseFiles(files, project);
    const { score } = calculateScore(diagnostics);

    expect(score).toBeLessThan(100);
    expect(diagnostics.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Fixture 3: Config Filtering Pipeline ────────────────────────────────────

describe('fixture: config filtering pipeline', () => {
  const project: ProjectInfo = {
    nestVersion: '10.0.0',
    httpAdapter: 'express',
    orm: 'none',
    strictTypeScript: true,
    hasTests: true,
    sourceFileCount: 10,
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
  };

  it('applies ignore.rules to remove specific rule violations', () => {
    const files = new Map<string, string>();
    files.set('src/a.ts', `const password = "secret";`);
    files.set('src/b.ts', `export class BService { run() {} }`);

    const { diagnostics } = analyseFiles(files, project);
    const config: BluebirdConfig = {
      ignore: { rules: ['bluebird/no-hardcoded-secrets'] },
    };
    const filtered = filterDiagnostics(diagnostics, config);
    const secrets = filtered.filter((d) => d.rule === 'bluebird/no-hardcoded-secrets');
    expect(secrets).toHaveLength(0);
  });

  it('applies ignore.files to remove all violations from matched paths', () => {
    const files = new Map<string, string>();
    files.set('src/generated/dto.ts', `const password = "secret-value-123";`);
    files.set('src/app.ts', `const api_key = "api-key-value-456";`);

    const { diagnostics } = analyseFiles(files, project);
    const config: BluebirdConfig = {
      ignore: { files: ['src/generated/**'] },
    };
    const filtered = filterDiagnostics(diagnostics, config);
    const generated = filtered.filter((d) => d.filePath.startsWith('src/generated'));
    expect(generated).toHaveLength(0);
    expect(filtered.some((d) => d.filePath === 'src/app.ts')).toBe(true);
  });

  it('applies waivers to exempt specific rule+file combinations', () => {
    const files = new Map<string, string>();
    files.set(
      'src/scripts/seed.ts',
      `
import fs from 'fs';
const data = fs.readFileSync('seed.json', 'utf-8');
`
    );
    files.set(
      'src/app.service.ts',
      `
import { Injectable } from '@nestjs/common';
import fs from 'fs';
@Injectable()
export class AppService {
  read() { return fs.readFileSync('data.txt', 'utf-8'); }
}
`
    );

    const { diagnostics } = analyseFiles(files, project);
    const config: BluebirdConfig = {
      waivers: [
        {
          rule: 'bluebird/no-sync-fs-operations',
          file: 'src/scripts/**',
          reason: 'CLI scripts run synchronously',
        },
      ],
    };
    const filtered = filterDiagnostics(diagnostics, config);
    const syncFs = filtered.filter((d) => d.rule === 'bluebird/no-sync-fs-operations');

    expect(syncFs.every((d) => !d.filePath.startsWith('src/scripts/'))).toBe(true);
    expect(syncFs.some((d) => d.filePath === 'src/app.service.ts')).toBe(true);
  });

  it('score improves after filtering removes violations', () => {
    const files = new Map<string, string>();
    files.set('src/a.ts', `const password = "secret";`);
    files.set('src/b.ts', `const api_key = "key";`);
    files.set('src/c.ts', `export class CService { run() {} }`);

    const { diagnostics } = analyseFiles(files, project);
    const unfilteredScore = calculateScore(diagnostics);

    const config: BluebirdConfig = {
      ignore: { rules: ['bluebird/no-hardcoded-secrets'] },
    };
    const filtered = filterDiagnostics(diagnostics, config);
    const filteredScore = calculateScore(filtered);

    expect(filteredScore.score).toBeGreaterThanOrEqual(unfilteredScore.score);
  });
});

// ── Fixture 4: Baseline Filtering Pipeline ──────────────────────────────────

describe('fixture: baseline filtering pipeline', () => {
  const project: ProjectInfo = {
    nestVersion: '10.0.0',
    httpAdapter: 'express',
    orm: 'none',
    strictTypeScript: true,
    hasTests: true,
    sourceFileCount: 10,
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
  };

  it('baseline hides known violations and only reports new ones', () => {
    const files = new Map<string, string>();
    files.set('src/a.ts', `const password = "secret";`);
    files.set('src/b.ts', `const api_key = "key123";`);

    const { diagnostics } = analyseFiles(files, project);
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);

    const firstDiag = diagnostics[0];
    const baseline: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      entries: [
        {
          rule: firstDiag.rule,
          filePath: firstDiag.filePath,
          line: firstDiag.line ?? 0,
        },
      ],
    };

    const afterBaseline = applyBaseline(diagnostics, baseline);
    expect(afterBaseline.length).toBe(diagnostics.length - 1);
    expect(afterBaseline.every((d) => d.filePath !== firstDiag.filePath)).toBe(true);
  });

  it('score improves after baseline hides violations', () => {
    const files = new Map<string, string>();
    files.set('src/a.ts', `const password = "secret";`);
    files.set('src/b.ts', `export class BService { run() {} }`);

    const { diagnostics } = analyseFiles(files, project);
    const beforeScore = calculateScore(diagnostics);

    const baseline: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      entries: diagnostics.map((d) => ({
        rule: d.rule,
        filePath: d.filePath,
        line: d.line ?? 0,
      })),
    };

    const afterBaseline = applyBaseline(diagnostics, baseline);
    const afterScore = calculateScore(afterBaseline);

    expect(afterScore.score).toBe(100);
    expect(afterScore.score).toBeGreaterThan(beforeScore.score);
  });

  it('baseline does not affect new violations added after snapshot', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      entries: [{ rule: 'bluebird/no-hardcoded-secrets', filePath: 'src/old.ts', line: 1 }],
    };

    const files = new Map<string, string>();
    files.set('src/old.ts', `const password = "secret";`);
    files.set('src/new.ts', `const api_key = "new-secret";`);

    const { diagnostics } = analyseFiles(files, project);
    const afterBaseline = applyBaseline(diagnostics, baseline);

    const newDiags = afterBaseline.filter((d) => d.filePath === 'src/new.ts');
    expect(newDiags.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Fixture 5: Heuristic Rules Gating ───────────────────────────────────────

describe('fixture: heuristic rule gating', () => {
  const project: ProjectInfo = {
    nestVersion: '10.0.0',
    httpAdapter: 'express',
    orm: 'none',
    strictTypeScript: true,
    hasTests: true,
    sourceFileCount: 10,
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
  };

  const postWith200 = `
import { Controller, Post, HttpCode } from '@nestjs/common';
@Controller('users')
export class UsersController {
  @Post()
  @HttpCode(200)
  create() { return {}; }
}
`;

  it('excludes heuristic rules by default', () => {
    const files = new Map([['src/users.controller.ts', postWith200]]);
    const { diagnostics } = analyseFiles(files, project, false);
    const heuristic = diagnostics.filter((d) => d.confidence === 'heuristic');
    expect(heuristic).toHaveLength(0);
  });

  it('includes heuristic rules when opted in', () => {
    const files = new Map([['src/users.controller.ts', postWith200]]);
    const { diagnostics } = analyseFiles(files, project, true);
    const heuristic = diagnostics.filter((d) => d.confidence === 'heuristic');
    expect(heuristic.length).toBeGreaterThanOrEqual(1);
    expect(heuristic.some((d) => d.rule === 'bluebird/no-inconsistent-http-status')).toBe(true);
  });
});

// ── Fixture 6: Full Pipeline (discover + analyse + filter + score) ──────────

describe('fixture: full pipeline end-to-end', () => {
  it('runs a complete analysis cycle on a fixture project', async () => {
    await writePkg({
      '@nestjs/core': '^10.3.0',
      '@nestjs/common': '^10.3.0',
      '@nestjs/platform-fastify': '^10.3.0',
      '@prisma/client': '^5.10.0',
    });
    await writeTsconfig({ strict: true });
    await writeProjectFile('src/app.controller.spec.ts', `describe('test', () => {});`);

    const project = await discoverProject(testDir);
    expect(project.nestVersion).toBe('10.3.0');
    expect(project.httpAdapter).toBe('fastify');
    expect(project.orm).toBe('prisma');
    expect(project.hasTests).toBe(true);

    const files = new Map<string, string>();
    files.set(
      'src/main.ts',
      `
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe());
  await app.listen(3000);
}
bootstrap();
`
    );
    files.set('src/config.ts', `const database_password = "admin123";`);
    files.set(
      'src/users.service.ts',
      `
export class UsersService {
  constructor(private readonly repo: UserRepository) {}
  async findAll() { return []; }
}
`
    );

    const lint = analyseFiles(files, project);
    const graph = analyseGraph(new Map(), project);

    const combined = combineDiagnostics(lint.diagnostics, graph.diagnostics);
    expect(combined.length).toBeGreaterThanOrEqual(2);

    const secretDiags = combined.filter((d) => d.rule === 'bluebird/no-hardcoded-secrets');
    expect(secretDiags.length).toBe(1);
    expect(secretDiags[0].filePath).toBe('src/config.ts');

    const injectableDiags = combined.filter((d) => d.rule === 'bluebird/missing-injectable');
    expect(injectableDiags.length).toBe(1);

    const config: BluebirdConfig = {};
    const filtered = filterDiagnostics(combined, config);
    expect(filtered.length).toBe(combined.length);

    const { score, label } = calculateScore(filtered);
    expect(score).toBeLessThan(100);
    expect(typeof label).toBe('string');
  });

  it('end-to-end with config filtering and baseline', async () => {
    await writePkg({ '@nestjs/core': '^10.0.0' });

    const project: ProjectInfo = {
      nestVersion: '10.0.0',
      httpAdapter: 'unknown',
      orm: 'none',
      strictTypeScript: false,
      hasTests: false,
      sourceFileCount: 5,
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
    };

    const files = new Map<string, string>();
    files.set('src/secrets.ts', `const password = "hunter2";`);
    files.set('src/generated/client.ts', `const api_key = "generated-key";`);
    files.set(
      'src/svc.ts',
      `
export class SvcService {
  constructor() { console.log("boot"); }
}
`
    );

    const lint = analyseFiles(files, project);

    const config: BluebirdConfig = {
      ignore: {
        files: ['src/generated/**'],
      },
      waivers: [
        {
          rule: 'bluebird/no-constructor-side-effects',
          file: 'src/svc.ts',
          reason: 'Acceptable in boot service',
        },
      ],
    };
    const filtered = filterDiagnostics(lint.diagnostics, config);

    const generatedDiags = filtered.filter((d) => d.filePath.startsWith('src/generated'));
    expect(generatedDiags).toHaveLength(0);

    const sideEffectDiags = filtered.filter(
      (d) => d.rule === 'bluebird/no-constructor-side-effects' && d.filePath === 'src/svc.ts'
    );
    expect(sideEffectDiags).toHaveLength(0);

    const secretDiags = filtered.filter(
      (d) => d.rule === 'bluebird/no-hardcoded-secrets' && d.filePath === 'src/secrets.ts'
    );
    expect(secretDiags.length).toBeGreaterThanOrEqual(1);

    const baseline: BaselineFile = {
      version: 1,
      createdAt: new Date().toISOString(),
      entries: secretDiags.map((d) => ({
        rule: d.rule,
        filePath: d.filePath,
        line: d.line ?? 0,
      })),
    };

    const afterBaseline = applyBaseline(filtered, baseline);
    const baselinedCount = filtered.length - afterBaseline.length;

    expect(baselinedCount).toBeGreaterThanOrEqual(1);

    const { score } = calculateScore(afterBaseline);
    expect(score).toBeGreaterThan(calculateScore(filtered).score);
  });
});

// ── Fixture 7: Multi-ORM Detection ──────────────────────────────────────────

describe('fixture: project discovery edge cases', () => {
  it('detects all features in a full-featured project', async () => {
    await writePkg({
      '@nestjs/core': '^10.3.0',
      '@nestjs/platform-fastify': '^10.0.0',
      '@nestjs/typeorm': '^10.0.0',
      '@nestjs/graphql': '^12.0.0',
      '@nestjs/websockets': '^10.0.0',
      '@nestjs/microservices': '^10.0.0',
      '@nestjs/cqrs': '^10.0.0',
      '@nestjs/swagger': '^7.0.0',
      '@nestjs/bullmq': '^10.0.0',
      '@nestjs/config': '^3.0.0',
      '@nestjs/throttler': '^5.0.0',
      '@nestjs/cache-manager': '^2.0.0',
    });
    await writeTsconfig({ strict: true });

    const info = await discoverProject(testDir);

    expect(info.nestVersion).toBe('10.3.0');
    expect(info.httpAdapter).toBe('fastify');
    expect(info.orm).toBe('typeorm');
    expect(info.features.graphql).toBe(true);
    expect(info.features.websockets).toBe(true);
    expect(info.features.microservices).toBe(true);
    expect(info.features.cqrs).toBe(true);
    expect(info.features.swagger).toBe(true);
    expect(info.features.bull).toBe(true);
    expect(info.features.config).toBe(true);
    expect(info.features.throttler).toBe(true);
    expect(info.features.cache).toBe(true);
  });

  it('detects a bare project without any NestJS packages', async () => {
    await writePkg({ express: '^4.18.0' });
    await writeTsconfig({ strict: false });

    const info = await discoverProject(testDir);

    expect(info.nestVersion).toBeNull();
    expect(info.httpAdapter).toBe('unknown');
    expect(info.orm).toBe('none');
    expect(info.strictTypeScript).toBe(false);
    for (const val of Object.values(info.features)) {
      expect(val).toBe(false);
    }
  });

  it('handles malformed package.json gracefully', async () => {
    await writeFile(join(testDir, 'package.json'), 'not valid json{{{');

    const info = await discoverProject(testDir);
    expect(info.nestVersion).toBeNull();
    expect(info.orm).toBe('none');
  });
});
