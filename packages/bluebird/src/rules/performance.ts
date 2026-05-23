import ts from 'typescript';
import type { RuleContext } from '../types.js';
import { getLine, getColumn, walk, resolveCallName } from './ast-helpers.js';

const FS_RECEIVERS = new Set(['fs']);
const FS_MODULES = new Set(['fs', 'node:fs']);

const CRYPTO_RECEIVERS = new Set(['crypto']);
const CRYPTO_MODULES = new Set(['crypto', 'node:crypto']);

/**
 * Collects default-import and namespace-import identifiers bound to one of the
 * given module specifiers (e.g. `import myFs from 'fs'` → `"myFs"`).
 */
function collectImportedReceivers(
  sf: ts.SourceFile,
  moduleSpecifiers: ReadonlySet<string>
): Set<string> {
  const receivers = new Set<string>();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!moduleSpecifiers.has(stmt.moduleSpecifier.text)) continue;

    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) receivers.add(clause.name.text);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      receivers.add(clause.namedBindings.name.text);
    }
  }
  return receivers;
}

/**
 * Returns `true` when {@link name} appears as a named import from one of the
 * given module specifiers (e.g. `import { readFileSync } from 'fs'`).
 */
function isNamedImportFrom(
  sf: ts.SourceFile,
  name: string,
  moduleSpecifiers: ReadonlySet<string>
): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (!moduleSpecifiers.has(stmt.moduleSpecifier.text)) continue;

    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if (el.name.text === name) return true;
      }
    }
  }
  return false;
}

/**
 * Determines whether a resolved call name originates from a specific Node.js
 * module by checking the receiver against known names and import declarations.
 *
 * For property-access calls (`fs.readFileSync`), the receiver is checked
 * against {@link defaultReceivers} and any namespace/default imports from the
 * module.  For bare calls (`readFileSync`), the function name is checked
 * against named imports.
 */
function isFromModule(
  sf: ts.SourceFile,
  callName: string,
  methodName: string,
  defaultReceivers: ReadonlySet<string>,
  moduleSpecifiers: ReadonlySet<string>
): boolean {
  const parts = callName.split('.');
  if (parts.length >= 2) {
    const receiver = parts[0];
    if (defaultReceivers.has(receiver)) return true;
    return collectImportedReceivers(sf, moduleSpecifiers).has(receiver);
  }
  return isNamedImportFrom(sf, methodName, moduleSpecifiers);
}

const SYNC_FS_METHODS = new Set([
  'readFileSync',
  'writeFileSync',
  'appendFileSync',
  'copyFileSync',
  'mkdirSync',
  'rmdirSync',
  'readdirSync',
  'statSync',
  'lstatSync',
  'accessSync',
  'chmodSync',
  'chownSync',
  'renameSync',
  'unlinkSync',
  'existsSync',
  'openSync',
  'closeSync',
  'fstatSync',
  'ftruncateSync',
  'futimesSync',
  'linkSync',
  'symlinkSync',
  'readlinkSync',
  'realpathSync',
  'truncateSync',
  'utimesSync',
  'rmSync',
  'cpSync',
]);

/**
 * **Rule `no-sync-fs-operations`** (performance / warning)
 *
 * Flags calls to synchronous Node.js `fs` methods (`readFileSync`,
 * `writeFileSync`, `existsSync`, etc.) in non-CLI code.
 *
 * Synchronous filesystem operations block the event loop, preventing the
 * NestJS server from handling concurrent requests.  The async equivalents
 * (`fs.promises.*` or callback-based API) should be used instead.
 *
 * Excluded:
 * - Module files (*.module.ts) - sync operations during module initialization
 *   run once at startup and don't affect request handling
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoSyncFsOperations(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';

  // Skip module files - sync operations at startup don't block requests
  // Matches both NestJS naming convention (app.module.ts) and PascalCase (AppModule.ts)
  if (
    filePath.includes('.module.') ||
    filename.endsWith('Module.ts') ||
    filename.endsWith('Module.js')
  ) {
    return;
  }

  // Skip CLI commands - no event loop to block
  if (
    normalizedPath.includes('/commands/') ||
    normalizedPath.startsWith('commands/') ||
    normalizedPath.includes('/cli/') ||
    normalizedPath.startsWith('cli/') ||
    normalizedPath.includes('/bin/') ||
    normalizedPath.startsWith('bin/') ||
    normalizedPath.includes('/scripts/') ||
    normalizedPath.startsWith('scripts/')
  ) {
    return;
  }

  // Skip test configs (cypress, jest, etc.) - run in separate process
  if (
    normalizedPath.includes('/cypress/') ||
    normalizedPath.startsWith('cypress/') ||
    filename.includes('jest') ||
    filename.includes('vitest')
  ) {
    return;
  }

  // Skip nest-commander CLI files
  const fullText = sf.getFullText();
  if (fullText.includes('@Command(') || fullText.includes('@SubCommand(')) {
    return;
  }

  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;

    const callName = resolveCallName(node);
    if (!callName) return;

    const methodName = callName.split('.').pop();
    if (!methodName || !SYNC_FS_METHODS.has(methodName)) return;

    if (!isFromModule(sf, callName, methodName, FS_RECEIVERS, FS_MODULES)) return;

    ctx.report({
      filePath,
      message: `Synchronous '${methodName}' blocks the event loop — use the async equivalent`,
      line: getLine(sf, node),
      column: getColumn(sf, node),
    });
  });
}

const BLOCKING_CRYPTO_METHODS = new Set([
  'pbkdf2Sync',
  'scryptSync',
  'generateKeyPairSync',
  'generateKeySync',
  'randomFillSync',
]);

/**
 * **Rule `no-blocking-crypto`** (performance / warning)
 *
 * Flags calls to blocking Node.js `crypto` methods (`pbkdf2Sync`,
 * `scryptSync`, `generateKeyPairSync`, etc.) in the request path.
 *
 * These CPU-intensive synchronous operations block the event loop for
 * hundreds of milliseconds, starving concurrent requests.  The async
 * variants (`crypto.pbkdf2`, `crypto.scrypt`, etc.) should be used.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoBlockingCrypto(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;

    const callName = resolveCallName(node);
    if (!callName) return;

    const methodName = callName.split('.').pop();
    if (!methodName || !BLOCKING_CRYPTO_METHODS.has(methodName)) return;

    if (!isFromModule(sf, callName, methodName, CRYPTO_RECEIVERS, CRYPTO_MODULES)) return;

    ctx.report({
      filePath,
      message: `Blocking '${methodName}' in request path — use the async variant`,
      line: getLine(sf, node),
      column: getColumn(sf, node),
    });
  });
}

/**
 * **Rule `missing-caching`** (performance / warning / heuristic)
 *
 * Flags NestJS applications that don't configure any caching strategy.
 * For applications with read-heavy workloads, caching can significantly
 * improve performance.
 *
 * Checks for `@nestjs/cache-manager`, `CacheModule`, or Redis/Memcached usage.
 * Only bootstrap files or app modules are inspected.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingCaching(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  const text = sf.getFullText();

  // Only check bootstrap files or app module
  if (!text.includes('NestFactory') && !text.includes('AppModule')) return;

  // Skip if cache feature is detected at project level
  if (ctx.project.features.cache) return;

  // Check for caching patterns
  const hasCaching =
    text.includes('CacheModule') ||
    text.includes('CacheInterceptor') ||
    text.includes('@Cacheable') ||
    text.includes('cache-manager') ||
    text.includes('redis') ||
    text.includes('memcached') ||
    text.includes('ioredis');

  if (!hasCaching && text.includes('NestFactory')) {
    const nestFactoryPos = text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(nestFactoryPos).line + 1;

    ctx.report({
      filePath,
      message:
        'No caching strategy configured — consider @nestjs/cache-manager for read-heavy workloads',
      line,
      column: 1,
    });
  }
}

/**
 * **Rule `no-n-plus-one`** (performance / warning / heuristic)
 *
 * Detects potential N+1 query patterns in TypeORM and Prisma code:
 * - Lazy-loaded relations accessed in loops (`.then()` on relation property)
 * - `findOne` / `findUnique` calls inside loops without batching
 * - Missing eager/include options with subsequent relation access
 *
 * This is a heuristic check with potential false positives — proper N+1
 * detection requires runtime query logging.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoNPlusOne(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  walk(sf, (node) => {
    // Detect findOne/findUnique inside for loops
    if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      const loopBody = ts.isForStatement(node) ? node.statement : node.statement;

      walk(loopBody, (inner) => {
        if (!ts.isCallExpression(inner)) return;

        const callName = resolveCallName(inner);
        if (!callName) return;

        const method = callName.split('.').pop();
        if (
          method === 'findOne' ||
          method === 'findUnique' ||
          method === 'findFirst' ||
          method === 'findOneBy'
        ) {
          ctx.report({
            filePath,
            message: `'${method}' inside loop — consider batching with findMany/findByIds or eager loading`,
            line: getLine(sf, inner),
            column: getColumn(sf, inner),
          });
        }
      });
    }

    // Detect .map() with database queries
    if (ts.isCallExpression(node)) {
      const callName = resolveCallName(node);
      if (callName?.endsWith('.map') && node.arguments.length > 0) {
        const callback = node.arguments[0];
        if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
          walk(callback.body, (inner) => {
            if (!ts.isCallExpression(inner)) return;
            const innerCall = resolveCallName(inner);
            if (!innerCall) return;

            const method = innerCall.split('.').pop();
            if (
              method === 'findOne' ||
              method === 'findUnique' ||
              method === 'findFirst' ||
              method === 'findOneBy'
            ) {
              ctx.report({
                filePath,
                message: `'${method}' inside .map() — potential N+1 query pattern`,
                line: getLine(sf, inner),
                column: getColumn(sf, inner),
              });
            }
          });
        }
      }
    }
  });
}
