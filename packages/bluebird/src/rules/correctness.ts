import ts from 'typescript';
import type { RuleContext } from '../types.js';
import {
  getDecorators,
  getDecoratorName,
  getDecoratorCallArgs,
  hasDecorator,
  getLine,
  getColumn,
  walk,
  resolveCallName,
  NEST_CLASS_DECORATORS,
} from './ast-helpers.js';
import { isTestFile } from '../utils/is-test-file.js';
import { isMigrationFile } from '../utils/is-migration-file.js';
import { isCliEntryPoint } from '../utils/is-cli-entry-point.js';

const PROVIDER_SUFFIXES = [
  'Service',
  'Repository',
  'Guard',
  'Interceptor',
  'Pipe',
  'Filter',
  'Middleware',
  'Gateway',
  'Resolver',
  'Strategy',
  'Factory',
  'Handler',
  'Subscriber',
  'Listener',
  'Processor',
  'Consumer',
  'Adapter',
];

/**
 * Suffixes for classes that look like providers but don't need @Injectable().
 * These are typically infrastructure classes used by ORMs or other frameworks.
 */
const EXEMPT_PROVIDER_SUFFIXES = [
  'NamingStrategy', // TypeORM naming strategies are not NestJS providers
];

/**
 * Directory patterns that indicate manual factory/strategy patterns.
 * Classes in these directories are often instantiated manually, not via NestJS DI.
 */
const MANUAL_FACTORY_PATH_PATTERNS = [
  /[/\\]DataFactories[/\\]/i,
  /[/\\]Factories[/\\]/i,
  /[/\\]factories[/\\]/i,
  /[/\\]Strategies[/\\]/i,
  /[/\\]strategies[/\\]/i,
];

/**
 * Returns `true` when a class name ends with a suffix associated with
 * NestJS providers (Service, Repository, Guard, Pipe, etc.).
 * Excludes ORM infrastructure classes like NamingStrategy.
 */
function looksLikeProvider(name: string): boolean {
  // First check if it's an exempt class
  if (EXEMPT_PROVIDER_SUFFIXES.some((s) => name.endsWith(s))) {
    return false;
  }
  return PROVIDER_SUFFIXES.some((s) => name.endsWith(s));
}

/**
 * Returns `true` if the class has the `abstract` modifier.
 */
function isAbstractClass(cls: ts.ClassDeclaration): boolean {
  return cls.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AbstractKeyword) ?? false;
}

/**
 * Returns `true` if the class has only static methods (no instance methods).
 * Such classes are typically utility/factory classes that don't participate in DI.
 */
function hasOnlyStaticMethods(cls: ts.ClassDeclaration): boolean {
  const methods = cls.members.filter(ts.isMethodDeclaration);
  if (methods.length === 0) return false; // No methods = not a static utility class

  return methods.every((method) =>
    method.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.StaticKeyword)
  );
}

/**
 * Returns `true` when the class has constructor parameters, which indicates
 * it is likely dependency-injected rather than a plain utility/inline class.
 */
function hasConstructorDependencies(cls: ts.ClassDeclaration): boolean {
  for (const member of cls.members) {
    if (!ts.isConstructorDeclaration(member)) continue;
    return member.parameters.length > 0;
  }
  return false;
}

/**
 * Returns `true` if the file path matches manual factory/strategy patterns.
 * Classes in DataFactories/, Factories/, Strategies/ directories are often
 * part of manual instantiation patterns (not NestJS DI).
 */
function isManualFactoryPath(filePath: string): boolean {
  return MANUAL_FACTORY_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Returns `true` if the class implements an interface.
 * Classes implementing interfaces are often part of manual factory/strategy patterns
 * where they're instantiated via `new ClassName(deps)` rather than NestJS DI.
 */
function implementsInterface(cls: ts.ClassDeclaration): boolean {
  if (!cls.heritageClauses) return false;

  return cls.heritageClauses.some(
    (clause) => clause.token === ts.SyntaxKind.ImplementsKeyword && clause.types.length > 0
  );
}

/**
 * **Rule `missing-injectable`** (correctness / error)
 *
 * Flags top-level classes whose names follow NestJS provider naming
 * conventions (e.g. `UserService`, `OrderRepository`, `AuthGuard`) but
 * which are missing the `@Injectable()` decorator (or any other NestJS
 * class decorator such as `@Controller`, `@Module`, or `@Resolver`).
 *
 * In NestJS, every class that participates in dependency injection must
 * carry `@Injectable()` (or an equivalent decorator). Without it, the
 * NestJS DI container cannot resolve or inject the class, leading to
 * runtime errors.
 *
 * Anonymous classes and classes whose names do not match any known
 * provider suffix are silently skipped.
 *
 * Excluded:
 * - Test files (mock classes and test helpers don't need @Injectable())
 * - Abstract classes (base classes don't need @Injectable(), only concrete implementations)
 * - Static utility classes (classes with only static methods don't participate in DI)
 * - Classes without constructor dependencies (commonly inline pipes/helpers)
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingInjectable(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  // Skip test files - mock classes and test helpers don't need @Injectable()
  if (isTestFile(filePath)) return;

  // Skip manual factory directories - classes here are instantiated manually, not via DI
  if (isManualFactoryPath(filePath)) return;

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;

    const className = stmt.name.text;
    if (!looksLikeProvider(className)) continue;

    // Skip abstract classes - they're base classes, not instantiated by DI
    if (isAbstractClass(stmt)) continue;

    // Skip static utility classes - they have only static methods, no DI needed
    if (hasOnlyStaticMethods(stmt)) continue;

    // Skip classes without constructor dependencies - often inline pipes/helpers
    if (!hasConstructorDependencies(stmt)) continue;

    // Skip Factory classes that implement interfaces - these are typically part of
    // manual factory patterns (instantiated via new ClassName(deps), not NestJS DI)
    if (className.endsWith('Factory') && implementsInterface(stmt)) continue;

    const hasNestDecorator = getDecorators(stmt).some((d) => {
      const name = getDecoratorName(d);
      return name !== undefined && NEST_CLASS_DECORATORS.has(name);
    });

    if (!hasNestDecorator) {
      ctx.report({
        filePath,
        message: `Class '${className}' looks like a provider but is missing @Injectable()`,
        line: getLine(sf, stmt),
        column: getColumn(sf, stmt),
      });
    }
  }
}

const LIFECYCLE_HOOKS: Record<string, string> = {
  onModuleInit: 'OnModuleInit',
  onModuleDestroy: 'OnModuleDestroy',
  onApplicationBootstrap: 'OnApplicationBootstrap',
  onApplicationShutdown: 'OnApplicationShutdown',
  beforeApplicationShutdown: 'BeforeApplicationShutdown',
};

/**
 * Collects the names of all interfaces a class declaration implements via
 * its `implements` heritage clause.
 *
 * @returns A set of interface identifier names (e.g. `{"OnModuleInit"}`).
 */
function getImplementedInterfaces(cls: ts.ClassDeclaration): Set<string> {
  const names = new Set<string>();
  if (!cls.heritageClauses) return names;

  for (const clause of cls.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const typeExpr of clause.types) {
      if (ts.isIdentifier(typeExpr.expression)) {
        names.add(typeExpr.expression.text);
      }
    }
  }
  return names;
}

/**
 * **Rule `lifecycle-hook-interface`** (correctness / warning)
 *
 * Flags classes that implement NestJS lifecycle-hook methods
 * (`onModuleInit`, `onModuleDestroy`, `onApplicationBootstrap`,
 * `onApplicationShutdown`, `beforeApplicationShutdown`) without declaring
 * the corresponding interface in the `implements` clause.
 *
 * While NestJS will still call the hook, omitting the interface loses
 * compile-time type checking on the method signature.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkLifecycleHookInterface(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    const interfaces = getImplementedInterfaces(stmt);
    const className = stmt.name?.text ?? '<anonymous>';

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const methodName = member.name.text;
      const requiredInterface = LIFECYCLE_HOOKS[methodName];
      if (!requiredInterface) continue;

      if (!interfaces.has(requiredInterface)) {
        ctx.report({
          filePath,
          message: `'${className}.${methodName}()' is missing 'implements ${requiredInterface}'`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

const SIDE_EFFECT_PATTERNS = new Set([
  'console.log',
  'console.warn',
  'console.error',
  'console.info',
  'console.debug',
  'console.trace',
  'fetch',
  'process.exit',
]);

const SIDE_EFFECT_RECEIVER_PREFIXES = ['fs.', 'http.', 'https.', 'axios.'];

/**
 * Returns `true` when the resolved call name represents a known side effect
 * (console I/O, network fetch, filesystem access, process termination).
 */
function isSideEffectCall(name: string): boolean {
  if (SIDE_EFFECT_PATTERNS.has(name)) return true;
  return SIDE_EFFECT_RECEIVER_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * **Rule `no-constructor-side-effects`** (correctness / warning)
 *
 * Flags call expressions inside class constructors that perform side effects:
 * `console.*`, `fetch`, `process.exit`, and any call starting with
 * `fs.`, `http.`, `https.`, or `axios.`.
 *
 * Side effects in constructors run before the NestJS lifecycle hooks, make
 * classes hard to test, can cause failures during DI resolution, and violate
 * the principle that constructors should only assign dependencies. The
 * recommended alternative is to move the logic to `onModuleInit()` or a
 * dedicated method.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoConstructorSideEffects(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;

    for (const member of stmt.members) {
      if (!ts.isConstructorDeclaration(member) || !member.body) continue;

      walk(member.body, (node) => {
        if (!ts.isCallExpression(node)) return;
        const callName = resolveCallName(node);
        if (callName && isSideEffectCall(callName)) {
          ctx.report({
            filePath,
            message: `Side effect '${callName}(...)' in constructor — move to onModuleInit() or a dedicated method`,
            line: getLine(sf, node),
            column: getColumn(sf, node),
          });
        }
      });
    }
  }
}

/**
 * **Rule `no-nested-controller-decorator`** (correctness / error)
 *
 * Flags `@Controller()` decorators applied to classes that are **not**
 * top-level statements in the source file (e.g. a class declared inside a
 * function body or another class).
 *
 * NestJS only discovers controllers registered at the module level; a nested
 * `@Controller()` will silently fail to mount routes.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
/**
 * **Rule `no-nested-controller-decorator`** (correctness / error)
 *
 * Flags `@Controller()` decorators applied to classes that are **not**
 * top-level statements (i.e. nested inside functions, other classes, or
 * block scopes).
 *
 * NestJS discovers controllers through the module system and expects
 * them at the module (file) scope. A nested controller class will never
 * be registered automatically and will silently fail to serve routes.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoNestedControllerDecorator(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  walk(sf, (node) => {
    if (!ts.isClassDeclaration(node)) return;
    if (!hasDecorator(node, 'Controller')) return;

    if (node.parent && !ts.isSourceFile(node.parent)) {
      const className = node.name?.text ?? '<anonymous>';
      ctx.report({
        filePath,
        message: `@Controller() on '${className}' is nested inside another declaration — move it to the top level`,
        line: getLine(sf, node),
        column: getColumn(sf, node),
      });
    }
  });
}

const CONSOLE_METHODS = new Set([
  'console.log',
  'console.warn',
  'console.error',
  'console.info',
  'console.debug',
  'console.trace',
  'console.dir',
  'console.table',
]);

/**
 * Returns `true` if the file is a CLI entry point or script.
 * These files legitimately need direct process.env access for configuration
 * before the NestJS application context is available.
 */
function isCliOrScriptFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return (
    /[/\\]cli[/\\]/.test(normalizedPath) ||
    /[/\\]bin[/\\]/.test(normalizedPath) ||
    /[/\\]scripts[/\\]/.test(normalizedPath) ||
    normalizedPath.startsWith('cli/') ||
    normalizedPath.startsWith('bin/') ||
    normalizedPath.startsWith('scripts/') ||
    normalizedPath.endsWith('/cli.ts') ||
    normalizedPath.endsWith('/cli.js') ||
    normalizedPath === 'cli.ts' ||
    normalizedPath === 'cli.js'
  );
}

/**
 * Returns `true` if the file is an infrastructure file that runs outside
 * the NestJS DI context (bootstrap, instrumentation, migrations, etc.).
 */
function isInfrastructureFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';

  // Bootstrap files - run before NestJS DI is available
  if (normalizedPath.includes('/bootstrap/') || normalizedPath.startsWith('bootstrap/')) {
    return true;
  }

  // Setup files that run during bootstrap
  if (filename.startsWith('setUp') || filename.startsWith('setup')) {
    return true;
  }

  // Instrumentation files - OpenTelemetry runs before NestJS
  if (
    normalizedPath.includes('.instrumentation.') ||
    normalizedPath.endsWith('/instrumentation.ts') ||
    normalizedPath.endsWith('/instrumentation.js') ||
    filename === 'instrumentation.ts' ||
    filename === 'instrumentation.js' ||
    normalizedPath.includes('/instrumentation/')
  ) {
    return true;
  }

  // Migration runners - standalone scripts
  if (
    normalizedPath.includes('run-migrations') ||
    normalizedPath.includes('run-migration') ||
    normalizedPath.includes('migrate.ts') ||
    normalizedPath.includes('migrate.js')
  ) {
    return true;
  }

  // Data source files - TypeORM CLI config
  if (normalizedPath.includes('data-source') || normalizedPath.includes('datasource')) {
    return true;
  }

  // ORM config files
  if (normalizedPath.includes('ormconfig')) {
    return true;
  }

  // CLI datasource files
  if (filename.includes('Datasource') || filename.includes('DataSource')) {
    return true;
  }

  // TypeORM entity utility files - used in @Column() decorators before DI exists
  // e.g., typePickers.ts that switches between SQLite/PostgreSQL column types
  // These can be in /entities/, /typeorm/, or other ORM-related directories
  if (
    filename.includes('typePicker') ||
    filename.includes('type-picker') ||
    filename.includes('columnType') ||
    filename.includes('column-type')
  ) {
    return true;
  }

  // loadOrmConfig and similar TypeORM configuration loaders
  // These sometimes use process.env before ConfigService is available in the call chain
  if (
    filename.includes('loadOrm') ||
    filename.includes('orm-config') ||
    filename.includes('OrmConfig')
  ) {
    return true;
  }

  // Seed scripts - standalone Prisma/TypeORM seed scripts run outside NestJS DI
  if (
    filename === 'seed.ts' ||
    filename === 'seed.js' ||
    normalizedPath.includes('/seeds/') ||
    normalizedPath.includes('/seeders/')
  ) {
    return true;
  }

  // Prisma client factories - these create and extend PrismaClient outside DI
  // They cannot use ConfigService because they ARE the factory that creates the client
  if (
    filename.includes('ClientFactory') ||
    filename.includes('clientFactory') ||
    filename.includes('PrismaFactory') ||
    filename.includes('prismaFactory')
  ) {
    return true;
  }

  // Migration orchestrators - run DB migrations at startup, need env checks
  // before the full NestJS DI is ready (e.g., PrismaMigrator)
  if (
    filename.includes('Migrator') ||
    filename.includes('migrator') ||
    normalizedPath.includes('/migration/') ||
    normalizedPath.includes('/migrator/')
  ) {
    return true;
  }

  return false;
}

/**
 * Returns true when a node appears inside a `@Module(...)` or `@Global(...)`
 * decorator argument. These metadata objects are evaluated before DI is
 * available, so direct `process.env` usage is expected.
 */
function isInsideModuleDecoratorMetadata(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isDecorator(current) && ts.isCallExpression(current.expression)) {
      const callee = current.expression.expression;
      if (ts.isIdentifier(callee) && (callee.text === 'Module' || callee.text === 'Global')) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * Returns true when a node appears inside a `ConfigModule.forRoot(...)` call.
 * This is a chicken-and-egg scenario: ConfigModule.forRoot() bootstraps
 * ConfigService, so process.env access is expected and legitimate.
 */
function isInsideConfigModuleForRoot(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const callExpr = current.expression;
      if (
        ts.isPropertyAccessExpression(callExpr) &&
        ts.isIdentifier(callExpr.expression) &&
        callExpr.expression.text === 'ConfigModule' &&
        ts.isIdentifier(callExpr.name) &&
        callExpr.name.text === 'forRoot'
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

/**
 * Returns true when a node is on the left-hand side of an assignment.
 * We skip process.env writes (assignments) - we only care about reads.
 */
function isAssignmentTarget(node: ts.Node): boolean {
  const parent = node.parent;
  if (!parent) return false;

  // Direct assignment: process.env.X = value
  if (ts.isBinaryExpression(parent) && parent.left === node) {
    const op = parent.operatorToken.kind;
    return (
      op === ts.SyntaxKind.EqualsToken ||
      op === ts.SyntaxKind.PlusEqualsToken ||
      op === ts.SyntaxKind.MinusEqualsToken ||
      op === ts.SyntaxKind.AsteriskEqualsToken ||
      op === ts.SyntaxKind.SlashEqualsToken ||
      op === ts.SyntaxKind.BarBarEqualsToken ||
      op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
      op === ts.SyntaxKind.QuestionQuestionEqualsToken
    );
  }

  return false;
}

/**
 * **Rule `no-console-log`** (correctness / warning)
 *
 * Flags direct usage of `console.log`, `console.warn`, `console.error`, etc.
 * in NestJS application code. The NestJS `Logger` service should be used
 * instead for consistent, configurable logging with proper context.
 *
 * Benefits of using NestJS Logger:
 * - Consistent log formatting across the application
 * - Configurable log levels per environment
 * - Context-aware logging (class name, request ID)
 * - Easy to swap underlying transport (e.g., to Winston, Pino)
 *
 * Excluded files:
 * - Test files (*.spec.ts, *.test.ts)
 * - CLI directories (/cli/, /bin/, /scripts/)
 * - CLI entry points (cli.ts)
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoConsoleLog(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  // Skip test files where console usage is acceptable (includes /mocks/, /fixtures/)
  if (isTestFile(filePath)) {
    return;
  }

  // Skip test files by extension pattern
  if (filePath.includes('.spec.') || filePath.includes('.test.')) {
    return;
  }

  // Skip migration files - console output for logging migration progress
  if (isMigrationFile(filePath)) {
    return;
  }

  // Skip CLI files where console output is intentional
  // Match both absolute paths (/cli/) and relative paths (cli/, scripts/)
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (
    /[/\\]cli[/\\]/.test(normalizedPath) ||
    /[/\\]bin[/\\]/.test(normalizedPath) ||
    /[/\\]scripts[/\\]/.test(normalizedPath) ||
    normalizedPath.startsWith('cli/') ||
    normalizedPath.startsWith('bin/') ||
    normalizedPath.startsWith('scripts/') ||
    normalizedPath.endsWith('/cli.ts') ||
    normalizedPath.endsWith('/cli.js') ||
    normalizedPath === 'cli.ts' ||
    normalizedPath === 'cli.js' ||
    // nest-commander CLI commands
    normalizedPath.includes('/commands/') ||
    normalizedPath.startsWith('commands/')
  ) {
    return;
  }

  // Skip mock files - test mocks often use console for debugging
  const filename = normalizedPath.split('/').pop() || '';
  if (filename.startsWith('Mock') || filename.startsWith('mock')) {
    return;
  }

  // Skip infrastructure files (bootstrap, instrumentation, etc.)
  if (isInfrastructureFile(filePath)) {
    return;
  }

  // Skip files with eslint-disable no-console directive
  const fullText = sf.getFullText();
  if (
    fullText.includes('eslint-disable no-console') ||
    fullText.includes('eslint-disable-next-line no-console')
  ) {
    return;
  }

  // Skip files containing nest-commander decorators (@Command, @SubCommand)
  if (fullText.includes('@Command(') || fullText.includes('@SubCommand(')) {
    return;
  }

  walk(sf, (node) => {
    if (!ts.isCallExpression(node)) return;

    const callName = resolveCallName(node);
    if (callName && CONSOLE_METHODS.has(callName)) {
      ctx.report({
        filePath,
        message: `'${callName}' detected — use NestJS Logger service instead`,
        line: getLine(sf, node),
        column: getColumn(sf, node),
      });
    }
  });
}

/**
 * **Rule `no-process-env-direct`** (correctness / warning)
 *
 * Flags direct access to `process.env` in NestJS application code.
 * Configuration should be accessed via NestJS `ConfigService` for:
 * - Type safety and validation
 * - Consistent configuration access patterns
 * - Easier testing (ConfigService can be mocked)
 * - Support for multiple configuration sources
 *
 * Exceptions:
 * - main.ts / bootstrap files (ConfigModule not yet initialized)
 * - Configuration files (*.config.ts, config/*.ts)
 * - Test files
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoProcessEnvDirect(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';

  // Skip test files - test utilities and fixtures run outside NestJS DI
  if (isTestFile(filePath)) {
    return;
  }

  // Skip files where process.env access is acceptable
  if (
    normalizedPath.includes('main.ts') ||
    normalizedPath.includes('.config.') ||
    normalizedPath.includes('/config/') ||
    normalizedPath.includes('.spec.') ||
    normalizedPath.includes('.test.')
  ) {
    return;
  }

  // Skip Module files - module configuration runs during bootstrap
  // and often needs direct process.env access for dynamic imports
  if (
    normalizedPath.includes('.module.') ||
    filename.endsWith('Module.ts') ||
    filename.endsWith('Module.js')
  ) {
    return;
  }

  // Skip library files - shared libraries should remain framework-agnostic
  if (normalizedPath.includes('/libs/') || normalizedPath.startsWith('libs/')) {
    return;
  }

  // Skip migration files - DDL scripts need env vars for database connection
  if (isMigrationFile(filePath)) {
    return;
  }

  // Skip CLI files - command-line tools need direct env access
  if (isCliOrScriptFile(filePath)) {
    return;
  }

  // Skip infrastructure files - run outside NestJS DI context
  if (isInfrastructureFile(filePath)) {
    return;
  }

  // System environment variables that are not application config (always skip)
  const SYSTEM_ENV_VARS = new Set([
    'PWD',
    'HOME',
    'USER',
    'PATH',
    'SHELL',
    'TERM',
    'LANG',
    'LC_ALL',
    'TZ',
    'HOSTNAME',
    'TMPDIR',
  ]);

  // CI/CD build metadata - these are injected at build time and are static,
  // not runtime configuration. It's acceptable to access them directly anywhere
  // (health checks, info endpoints, etc.) because they don't change during runtime.
  const CI_CD_ENV_VARS = new Set([
    'GIT_VERSION',
    'GIT_COMMIT',
    'GIT_BRANCH',
    'GIT_TAG',
    'BUILD_ID',
    'BUILD_NUMBER',
    'BUILD_VERSION',
    'CI_COMMIT_SHA',
    'CI_BUILD_ID',
    'GITHUB_SHA',
    'GITHUB_REF',
  ]);

  // Container orchestration env vars - these determine how the app runs
  // in container contexts (migration containers, sidecars, etc.)
  const CONTAINER_ORCHESTRATION_VARS = new Set([
    'USES_MIGRATION_CONTAINER',
    'MIGRATION_CONTAINER',
    'IS_MIGRATION_CONTAINER',
    'RUN_MIGRATIONS',
    'SKIP_MIGRATIONS',
  ]);

  walk(sf, (node) => {
    // Match process.env.SOMETHING or process.env['SOMETHING']
    if (ts.isPropertyAccessExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'process' &&
        ts.isIdentifier(node.expression.name) &&
        node.expression.name.text === 'env'
      ) {
        // Skip assignments (writes) - we only care about reads
        if (isAssignmentTarget(node)) return;

        // Skip inside @Module/@Global decorator metadata
        if (isInsideModuleDecoratorMetadata(node)) return;

        // Skip inside ConfigModule.forRoot() - chicken-and-egg scenario
        if (isInsideConfigModuleForRoot(node)) return;

        const envVar = ts.isIdentifier(node.name) ? node.name.text : '<dynamic>';

        // Skip system environment variables - not application config
        if (SYSTEM_ENV_VARS.has(envVar)) return;

        // Skip CI/CD build metadata - these are static build-time values, not config
        if (CI_CD_ENV_VARS.has(envVar)) return;

        // Skip container orchestration vars - infrastructure-level flags
        if (CONTAINER_ORCHESTRATION_VARS.has(envVar)) return;

        ctx.report({
          filePath,
          message: `Direct 'process.env.${envVar}' access — use ConfigService.get() instead`,
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }

    // Match process.env['SOMETHING']
    if (ts.isElementAccessExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'process' &&
        ts.isIdentifier(node.expression.name) &&
        node.expression.name.text === 'env'
      ) {
        // Skip assignments (writes) - we only care about reads
        if (isAssignmentTarget(node)) return;

        // Skip inside @Module/@Global decorator metadata
        if (isInsideModuleDecoratorMetadata(node)) return;

        // Skip inside ConfigModule.forRoot() - chicken-and-egg scenario
        if (isInsideConfigModuleForRoot(node)) return;

        ctx.report({
          filePath,
          message: "Direct 'process.env[...]' access — use ConfigService.get() instead",
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }
  });
}

/**
 * **Rule `missing-exception-filter`** (correctness / warning)
 *
 * Flags NestJS applications that don't configure a global exception filter.
 * Without a global exception filter, unhandled exceptions may leak internal
 * details or produce inconsistent error responses.
 *
 * Benefits of a global exception filter:
 * - Consistent error response format across all endpoints
 * - Proper error logging with context
 * - Prevention of sensitive information leakage
 * - Custom error transformation (e.g., validation errors)
 *
 * Only bootstrap files (containing `NestFactory`) are inspected.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingExceptionFilter(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const text = sf.getFullText();

  // Only check bootstrap files
  if (!text.includes('NestFactory')) return;

  if (isCliEntryPoint(filePath)) return;

  // Check for global exception filter configuration
  const hasExceptionFilter =
    text.includes('useGlobalFilters') ||
    text.includes('APP_FILTER') ||
    text.includes('AllExceptionsFilter') ||
    text.includes('HttpExceptionFilter') ||
    text.includes('GlobalExceptionFilter');

  if (!hasExceptionFilter) {
    const nestFactoryPos = text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(nestFactoryPos).line + 1;

    ctx.report({
      filePath,
      message:
        'No global exception filter configured — use useGlobalFilters() or APP_FILTER provider',
      line,
      column: 1,
    });
  }
}

/** Common NestJS parsing pipes for type coercion and validation */
const PARSE_PIPES = new Set([
  'ParseIntPipe',
  'ParseFloatPipe',
  'ParseBoolPipe',
  'ParseArrayPipe',
  'ParseUUIDPipe',
  'ParseEnumPipe',
  'DefaultValuePipe',
  'ValidationPipe',
]);

/**
 * **Rule `missing-parse-pipe`** (correctness / warning)
 *
 * Flags route parameters (`@Param()`) that don't have a parsing pipe attached.
 * Without a pipe, route params arrive as strings even when the handler expects
 * numbers or UUIDs, leading to runtime type errors.
 *
 * Example:
 * - Bad:  `@Param('id') id: number` — receives string, TS types lie
 * - Good: `@Param('id', ParseIntPipe) id: number` — validates and converts
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingParsePipe(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      // Check each parameter for @Param without a pipe
      for (const param of member.parameters) {
        const decorators = getDecorators(param);

        for (const dec of decorators) {
          const name = getDecoratorName(dec);
          if (name !== 'Param') continue;

          const args = getDecoratorCallArgs(dec);
          if (!args || args.length === 0) continue;

          // Check if there's a pipe in the decorator args
          // @Param('id', ParseIntPipe) has 2 args
          const hasPipe = args.some((arg) => {
            if (ts.isIdentifier(arg)) {
              return PARSE_PIPES.has(arg.text);
            }
            // Handle new ParseIntPipe() or similar
            if (ts.isNewExpression(arg) && ts.isIdentifier(arg.expression)) {
              return PARSE_PIPES.has(arg.expression.text);
            }
            return false;
          });

          if (!hasPipe) {
            // Check if the parameter has a non-string type annotation
            const paramType = param.type;
            if (paramType) {
              const typeText = paramType.getText(sf);
              // Flag if expecting non-string type
              if (
                typeText === 'number' ||
                typeText === 'boolean' ||
                typeText.includes('UUID') ||
                typeText.includes('[]')
              ) {
                const paramName = ts.isIdentifier(param.name) ? param.name.text : '<param>';
                ctx.report({
                  filePath,
                  message: `Parameter '${paramName}' expects '${typeText}' but @Param has no parsing pipe`,
                  line: getLine(sf, param),
                  column: getColumn(sf, param),
                });
              }
            }
          }
        }
      }
    }
  }
}

/** GraphQL resolver method decorators */
const GRAPHQL_METHOD_DECORATORS = new Set(['Query', 'Mutation', 'Subscription', 'ResolveField']);

/**
 * **Rule `missing-resolver-decorator`** (graphql / warning)
 *
 * Flags public methods in `@Resolver()` classes that are missing GraphQL
 * operation decorators (`@Query`, `@Mutation`, `@Subscription`, `@ResolveField`).
 *
 * In GraphQL resolvers, methods without these decorators are unreachable
 * from the GraphQL schema and may indicate forgotten decorators or dead code.
 *
 * Private methods (starting with `_` or `#`) and lifecycle hooks are excluded.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingResolverDecorator(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Resolver')) continue;

    const className = stmt.name?.text ?? '<anonymous>';

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const methodName = member.name.text;

      // Skip private methods, lifecycle hooks, and constructors
      if (methodName.startsWith('_') || methodName.startsWith('#')) continue;
      if (LIFECYCLE_HOOKS[methodName]) continue;

      // Skip methods with private or protected modifiers
      const isPrivateOrProtected = member.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword
      );
      if (isPrivateOrProtected) continue;

      // Check for GraphQL decorators
      const hasGraphqlDecorator = getDecorators(member).some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && GRAPHQL_METHOD_DECORATORS.has(name);
      });

      if (!hasGraphqlDecorator) {
        ctx.report({
          filePath,
          message: `Method '${className}.${methodName}()' in @Resolver has no @Query/@Mutation/@Subscription decorator`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

/** Microservice handler decorators */
const MICROSERVICE_DECORATORS = new Set([
  'MessagePattern',
  'EventPattern',
  'GrpcMethod',
  'GrpcStreamMethod',
]);

/**
 * **Rule `missing-message-pattern`** (microservices / warning)
 *
 * Flags public methods in `@Controller()` classes that use microservice
 * transports but are missing `@MessagePattern()` or `@EventPattern()` decorators.
 *
 * This rule is only enabled when microservices are detected in the project.
 * It checks controllers that don't have HTTP method decorators (indicating
 * they're microservice controllers) and flags methods without message patterns.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingMessagePattern(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    const className = stmt.name?.text ?? '<anonymous>';

    // Check if this is a microservice controller (no HTTP decorators but has methods)
    let hasHttpDecorators = false;
    let hasMicroserviceDecorators = false;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      const decorators = getDecorators(member);
      for (const d of decorators) {
        const name = getDecoratorName(d);
        if (
          name &&
          ['Get', 'Post', 'Put', 'Delete', 'Patch', 'All', 'Head', 'Options'].includes(name)
        ) {
          hasHttpDecorators = true;
        }
        if (name && MICROSERVICE_DECORATORS.has(name)) {
          hasMicroserviceDecorators = true;
        }
      }
    }

    // Only check pure microservice controllers (has MS decorators but no HTTP decorators)
    if (!hasMicroserviceDecorators || hasHttpDecorators) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const methodName = member.name.text;

      // Skip private methods and lifecycle hooks
      if (methodName.startsWith('_')) continue;
      if (LIFECYCLE_HOOKS[methodName]) continue;

      const hasMsDecorator = getDecorators(member).some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && MICROSERVICE_DECORATORS.has(name);
      });

      if (!hasMsDecorator) {
        ctx.report({
          filePath,
          message: `Method '${className}.${methodName}()' in microservice controller has no @MessagePattern/@EventPattern`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

/** WebSocket gateway method decorators */
const WEBSOCKET_DECORATORS = new Set(['SubscribeMessage', 'WebSocketServer']);

/**
 * **Rule `missing-websocket-decorator`** (websockets / warning)
 *
 * Flags public methods in `@WebSocketGateway()` classes that are missing
 * `@SubscribeMessage()` decorators. In WebSocket gateways, methods without
 * this decorator won't receive client messages.
 *
 * Lifecycle hooks (`handleConnection`, `handleDisconnect`, `afterInit`) and
 * private methods are excluded.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingWebsocketDecorator(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const WS_LIFECYCLE_METHODS = new Set([
    'handleConnection',
    'handleDisconnect',
    'afterInit',
    'onModuleInit',
    'onModuleDestroy',
  ]);

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'WebSocketGateway')) continue;

    const className = stmt.name?.text ?? '<anonymous>';

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      const methodName = member.name.text;

      // Skip private methods, lifecycle methods, and property decorators
      if (methodName.startsWith('_')) continue;
      if (WS_LIFECYCLE_METHODS.has(methodName)) continue;

      // Check for WebSocket decorators
      const hasWsDecorator = getDecorators(member).some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && WEBSOCKET_DECORATORS.has(name);
      });

      if (!hasWsDecorator) {
        ctx.report({
          filePath,
          message: `Method '${className}.${methodName}()' in @WebSocketGateway has no @SubscribeMessage decorator`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

/**
 * **Rule `missing-config-validation`** (correctness / warning / heuristic)
 *
 * Flags `ConfigModule.forRoot()` calls that don't include a validation schema.
 * Without validation, configuration errors are discovered at runtime rather
 * than at application startup.
 *
 * Benefits of config validation:
 * - Fail fast: Missing/invalid config is caught immediately on startup
 * - Type safety: Validated config can be typed correctly
 * - Documentation: Schema serves as config documentation
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingConfigValidation(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  if (isTestFile(filePath)) return;

  walk(sf, (node) => {
    // Look for ConfigModule.forRoot() calls
    if (!ts.isCallExpression(node)) return;

    const callExpr = node.expression;
    if (!ts.isPropertyAccessExpression(callExpr)) return;
    if (!ts.isIdentifier(callExpr.expression)) return;
    if (callExpr.expression.text !== 'ConfigModule') return;
    if (!ts.isIdentifier(callExpr.name)) return;
    if (callExpr.name.text !== 'forRoot') return;

    // Check if validation is configured
    const args = node.arguments;
    if (args.length === 0) {
      ctx.report({
        filePath,
        message:
          'ConfigModule.forRoot() called without configuration — consider adding validation schema',
        line: getLine(sf, node),
        column: getColumn(sf, node),
      });
      return;
    }

    // Check the config object for validationSchema or validate
    const configArg = args[0];
    if (!ts.isObjectLiteralExpression(configArg)) return;

    const hasValidation = configArg.properties.some((prop) => {
      if (!ts.isPropertyAssignment(prop)) return false;
      if (!ts.isIdentifier(prop.name)) return false;
      return prop.name.text === 'validationSchema' || prop.name.text === 'validate';
    });

    if (!hasValidation) {
      ctx.report({
        filePath,
        message:
          'ConfigModule.forRoot() missing validationSchema or validate — add config validation',
        line: getLine(sf, node),
        column: getColumn(sf, node),
      });
    }
  });
}
