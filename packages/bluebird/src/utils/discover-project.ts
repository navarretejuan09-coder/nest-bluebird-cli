import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { glob } from 'glob';
import type { DetectedFeatures, HttpAdapter, OrmKind, ProjectInfo } from '../types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const ORM_PACKAGES: [string, OrmKind][] = [
  ['@nestjs/typeorm', 'typeorm'],
  ['typeorm', 'typeorm'],
  ['@prisma/client', 'prisma'],
  ['prisma', 'prisma'],
  ['@nestjs/mongoose', 'mongoose'],
  ['mongoose', 'mongoose'],
  ['@nestjs/sequelize', 'sequelize'],
  ['sequelize', 'sequelize'],
  ['@mikro-orm/core', 'mikroorm'],
  ['@mikro-orm/nestjs', 'mikroorm'],
  ['drizzle-orm', 'drizzle'],
];

const FEATURE_PACKAGES: [keyof DetectedFeatures, string[]][] = [
  ['graphql', ['@nestjs/graphql']],
  ['websockets', ['@nestjs/websockets']],
  ['microservices', ['@nestjs/microservices']],
  ['cqrs', ['@nestjs/cqrs']],
  ['swagger', ['@nestjs/swagger']],
  ['bull', ['@nestjs/bull', '@nestjs/bullmq']],
  ['config', ['@nestjs/config']],
  ['throttler', ['@nestjs/throttler']],
  ['cache', ['@nestjs/cache-manager', 'cache-manager']],
];

/**
 * Reads and parses the `package.json` file from the given directory.
 *
 * Returns `null` only for expected non-fatal conditions (file not found or
 * malformed JSON). Unexpected filesystem errors (permissions, I/O) are
 * rethrown so callers can surface them instead of silently degrading detection.
 *
 * @param cwd - The root directory of the project to inspect.
 * @returns The parsed package.json contents, or `null` if the file is missing or malformed.
 */
async function readPackageJson(cwd: string): Promise<PackageJson | null> {
  try {
    const raw = await readFile(join(cwd, 'package.json'), 'utf-8');
    return JSON.parse(raw) as PackageJson;
  } catch (err: unknown) {
    if (err instanceof SyntaxError) return null;
    if (err != null && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')
      return null;
    throw err;
  }
}

/**
 * Merges `dependencies` and `devDependencies` into a single flat record.
 * When a package appears in both, the `devDependencies` entry wins.
 *
 * @param pkg - The parsed package.json object.
 * @returns A combined record of all dependency names to their version ranges.
 */
function allDeps(pkg: PackageJson): Record<string, string> {
  return { ...pkg.dependencies, ...pkg.devDependencies };
}

/**
 * Extracts the NestJS version from the `@nestjs/core` dependency.
 * Strips range prefixes (`^`, `~`, `>=`, etc.) and returns the bare semver string.
 *
 * @param deps - The merged dependency record from package.json.
 * @returns The semver version string (e.g. `"10.3.0"`), or `null` if `@nestjs/core`
 *          is not listed or the version range doesn't contain a full `x.y.z` semver.
 */
function detectNestVersion(deps: Record<string, string>): string | null {
  const raw = deps['@nestjs/core'];
  if (!raw) return null;
  const match = raw.match(/(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Determines which HTTP adapter the project uses.
 *
 * Detection priority:
 * 1. `@nestjs/platform-fastify` present → `"fastify"`
 * 2. `@nestjs/platform-express` present → `"express"`
 * 3. Otherwise → `"unknown"` (covers microservice-only, standalone, or non-NestJS projects)
 *
 * @param deps - The merged dependency record from package.json.
 * @returns The detected HTTP adapter kind.
 */
function detectHttpAdapter(deps: Record<string, string>): HttpAdapter {
  if ('@nestjs/platform-fastify' in deps) return 'fastify';
  if ('@nestjs/platform-express' in deps) return 'express';
  return 'unknown';
}

/**
 * Identifies the ORM or database library used by the project.
 * Checks against a priority-ordered list of known ORM packages (both NestJS
 * integration packages and standalone packages). Returns the first match.
 *
 * @param deps - The merged dependency record from package.json.
 * @returns The detected ORM kind, or `"none"` if no recognized ORM is found.
 */
function detectOrm(deps: Record<string, string>): OrmKind {
  for (const [pkg, orm] of ORM_PACKAGES) {
    if (pkg in deps) return orm;
  }
  return 'none';
}

/**
 * Scans dependencies for known NestJS feature packages and returns a boolean
 * map indicating which features are present (GraphQL, WebSockets, Microservices,
 * CQRS, Swagger, Bull/BullMQ, Config, Throttler, Cache).
 *
 * A feature is considered present if any of its associated packages appear in
 * either `dependencies` or `devDependencies`.
 *
 * @param deps - The merged dependency record from package.json.
 * @returns A `DetectedFeatures` object with a boolean flag for each feature.
 */
function detectFeatures(deps: Record<string, string>): DetectedFeatures {
  const features: DetectedFeatures = {
    graphql: false,
    websockets: false,
    microservices: false,
    cqrs: false,
    swagger: false,
    bull: false,
    config: false,
    throttler: false,
    cache: false,
  };
  for (const [feature, packages] of FEATURE_PACKAGES) {
    features[feature] = packages.some((pkg) => pkg in deps);
  }
  return features;
}

/**
 * Checks whether TypeScript strict mode is enabled by resolving `tsconfig.json`
 * (including `extends`) and inspecting the merged compiler options.
 *
 * Returns `false` when the config is missing, malformed, or cannot be parsed.
 *
 * @param cwd - The root directory of the project.
 * @returns `true` when the resolved configuration enables `strict`, `false` otherwise.
 */
async function detectStrictTypeScript(cwd: string): Promise<boolean> {
  try {
    const configPath = ts.findConfigFile(cwd, ts.sys.fileExists, 'tsconfig.json');
    if (!configPath) return false;

    const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
    if (readResult.error) return false;

    const parsed = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      dirname(configPath),
      undefined,
      configPath
    );
    return parsed.options.strict === true;
  } catch {
    return false;
  }
}

/** Directories to ignore during file discovery */
const IGNORED_DIRS = [
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.turbo',
  '.next',
  '.nx',
  'build',
  'out',
];

/**
 * Uses glob to efficiently count TypeScript source files and detect test files.
 * This is significantly faster than recursive readdir for large projects.
 *
 * Skips directories listed in {@link IGNORED_DIRS}. Declaration files
 * (`.d.ts`) are excluded from the count.
 *
 * @param cwd - The root directory to scan.
 * @returns An object with `sourceCount` (total `.ts` files) and `hasTests` (whether any
 *          test files were found anywhere in the tree).
 */
async function countSourceFilesAndTests(
  cwd: string
): Promise<{ sourceCount: number; hasTests: boolean }> {
  try {
    // Use glob for efficient file discovery - single traversal instead of N+1 readdir calls
    const files = await glob('**/*.ts', {
      cwd,
      ignore: [
        ...IGNORED_DIRS.map((dir) => `**/${dir}/**`),
        '**/*.d.ts', // Exclude declaration files
      ],
      nodir: true,
      absolute: false,
    });

    const sourceCount = files.length;
    const hasTests = files.some((f) => f.endsWith('.spec.ts') || f.endsWith('.test.ts'));

    return { sourceCount, hasTests };
  } catch {
    // Graceful fallback on glob failure
    return { sourceCount: 0, hasTests: false };
  }
}

/**
 * Discovers and returns metadata about the NestJS project at the given path.
 *
 * Performs the following detection steps (tsconfig parsing and file counting
 * run in parallel for performance):
 *
 * - **NestJS version** — from `@nestjs/core` in package.json
 * - **HTTP adapter** — Express, Fastify, or `"unknown"` if neither platform package is present
 * - **ORM** — TypeORM, Prisma, Mongoose, Sequelize, MikroORM, or Drizzle
 * - **Features** — GraphQL, WebSockets, Microservices, CQRS, Swagger, Bull, Config, Throttler, Cache
 * - **TypeScript strict mode** — from tsconfig.json `compilerOptions.strict`
 * - **Test presence** — whether `.spec.ts` or `.test.ts` files exist
 * - **Source file count** — total `.ts` files (excluding `.d.ts` and directories in {@link IGNORED_DIRS})
 *
 * @param cwd - The root directory of the NestJS project to analyze.
 * @returns A {@link ProjectInfo} object summarizing the project's configuration and structure.
 */
export async function discoverProject(cwd: string): Promise<ProjectInfo> {
  const pkg = await readPackageJson(cwd);
  const deps = pkg ? allDeps(pkg) : {};

  const [strictTypeScript, fileStats] = await Promise.all([
    detectStrictTypeScript(cwd),
    countSourceFilesAndTests(cwd),
  ]);

  return {
    nestVersion: detectNestVersion(deps),
    httpAdapter: detectHttpAdapter(deps),
    orm: detectOrm(deps),
    features: detectFeatures(deps),
    strictTypeScript,
    hasTests: fileStats.hasTests,
    sourceFileCount: fileStats.sourceCount,
  };
}
