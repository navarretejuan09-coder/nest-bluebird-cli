import ts from 'typescript';
import type { RuleContext } from '../types.js';
import { GOD_CONTROLLER_ROUTE_THRESHOLD, GOD_SERVICE_LINE_THRESHOLD } from '../constants.js';
import {
  getDecorators,
  getDecoratorName,
  getLine,
  getColumn,
  walk,
  hasDecorator,
  HTTP_METHOD_DECORATORS,
} from './ast-helpers.js';
import { isTestFile } from '../utils/is-test-file.js';

const INJECTABLE_SUFFIXES = [
  'Service',
  'Repository',
  'Gateway',
  'Resolver',
  'Handler',
  'UseCase',
  'Interactor',
  'Adapter',
  'Client',
  'Manager',
  'Provider',
  'Factory',
  'Strategy',
];

const SAFE_TO_INSTANTIATE = new Set([
  // Built-in errors
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'ReferenceError',
  // Built-in types
  'Date',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'Promise',
  'Proxy',
  'RegExp',
  'Array',
  'Object',
  'URL',
  'URLSearchParams',
  'Headers',
  'Request',
  'Response',
  'FormData',
  'Buffer',
  'EventEmitter',
  // RxJS
  'Subject',
  'BehaviorSubject',
  'ReplaySubject',
  'Observable',
  // NestJS pipes
  'ValidationPipe',
  'ParseIntPipe',
  'ParseBoolPipe',
  'ParseArrayPipe',
  'ParseUUIDPipe',
  'ParseFloatPipe',
  'DefaultValuePipe',
  'ParseEnumPipe',
  // NestJS exceptions
  'HttpException',
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'ConflictException',
  'InternalServerErrorException',
  'NotImplementedException',
  'BadGatewayException',
  'ServiceUnavailableException',
  'GatewayTimeoutException',
  // AWS SDK clients - commonly instantiated directly in factory providers
  'SNSClient',
  'SQSClient',
  'S3Client',
  'DynamoDBClient',
  'LambdaClient',
  'SecretsManagerClient',
  'SESClient',
  'SESv2Client',
  'KMSClient',
  'STSClient',
  'IAMClient',
  'CognitoIdentityProviderClient',
  'EventBridgeClient',
  'CloudWatchClient',
  'CloudWatchLogsClient',
  // SendGrid SDK - designed to be instantiated directly
  'Client', // @sendgrid/client
  'MailService', // @sendgrid/mail
  // Prisma - commonly instantiated directly in factory providers
  'PrismaClient',
  // OpenTelemetry SDK - instantiated before NestJS DI is available
  'NodeSDK',
  'LoggerProvider',
  'MeterProvider',
  'TracerProvider',
  'BatchSpanProcessor',
  'SimpleSpanProcessor',
  'ConsoleSpanExporter',
  'OTLPTraceExporter',
  'OTLPMetricExporter',
  'OTLPLogExporter',
  'Resource',
  'PrometheusExporter',
  'JaegerExporter',
  'ZipkinExporter',
  'ConsoleMetricExporter',
  'PeriodicExportingMetricReader',
]);

/**
 * Returns `true` when {@link name} matches a NestJS provider naming
 * convention (e.g. `UserService`, `OrderRepository`) and is not in the
 * safe-to-instantiate allow-list.
 */
function looksLikeProvider(name: string): boolean {
  if (SAFE_TO_INSTANTIATE.has(name)) return false;
  return INJECTABLE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * **Rule `no-hardcoded-dependency`** (architecture / error)
 *
 * Flags `new XService()` / `new XRepository()` expressions where the class
 * name matches a NestJS provider naming convention, indicating the developer
 * is bypassing dependency injection.
 *
 * Built-in classes (Error, Date, Map, etc.) and NestJS utility classes
 * (ValidationPipe, exceptions, etc.) are excluded.
 *
 * Test files (*.spec.ts, *.test.ts, files in test directories) are excluded
 * since direct instantiation is a standard pattern for unit testing.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
/**
 * Checks if a node is inside a useFactory function body.
 * useFactory is a legitimate NestJS DI pattern where `new` is expected.
 */
function isInsideUseFactory(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    // Check for useFactory: () => { ... } or useFactory: function() { ... }
    if (ts.isPropertyAssignment(current)) {
      const propName = current.name;
      if (ts.isIdentifier(propName) && propName.text === 'useFactory') {
        return true;
      }
    }
    // Check for useFactory property in object literal shorthand
    if (ts.isShorthandPropertyAssignment(current)) {
      if (current.name.text === 'useFactory') {
        return true;
      }
    }
    // Check for method-style factory: useFactory() { ... }
    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      if (current.name.text === 'useFactory') {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
}

interface UseFactoryReferences {
  functionNames: Set<string>;
  classMethodNames: Set<string>;
}

/**
 * Collects helper references used by Nest provider `useFactory` entries.
 *
 * Supports:
 * - `useFactory: createClient`
 * - `useFactory` (shorthand)
 * - `useFactory: ProviderFactory.create`
 */
function collectUseFactoryReferences(sf: ts.SourceFile): UseFactoryReferences {
  const functionNames = new Set<string>();
  const classMethodNames = new Set<string>();

  walk(sf, (node) => {
    if (ts.isPropertyAssignment(node)) {
      if (!ts.isIdentifier(node.name) || node.name.text !== 'useFactory') return;

      if (ts.isIdentifier(node.initializer)) {
        functionNames.add(node.initializer.text);
        return;
      }

      if (
        ts.isPropertyAccessExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        ts.isIdentifier(node.initializer.name)
      ) {
        classMethodNames.add(`${node.initializer.expression.text}.${node.initializer.name.text}`);
      }

      return;
    }

    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'useFactory') {
      functionNames.add('useFactory');
    }
  });

  return { functionNames, classMethodNames };
}

/**
 * Returns true when `node` is inside a function or static class method that is
 * referenced by a provider `useFactory`.
 */
function isInsideReferencedUseFactory(node: ts.Node, refs: UseFactoryReferences): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) &&
      current.name &&
      refs.functionNames.has(current.name.text)
    ) {
      return true;
    }

    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      refs.functionNames.has(current.name.text)
    ) {
      const init = current.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
        return true;
      }
    }

    if (ts.isMethodDeclaration(current) && ts.isIdentifier(current.name)) {
      const parentClass = current.parent;
      if (
        ts.isClassDeclaration(parentClass) &&
        parentClass.name &&
        refs.classMethodNames.has(`${parentClass.name.text}.${current.name.text}`)
      ) {
        return true;
      }
    }

    current = current.parent;
  }
  return false;
}

/**
 * Checks if a file is in a library directory (libs/).
 * Library code operates outside the NestJS DI container.
 */
function isLibraryFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.includes('/libs/') || normalizedPath.startsWith('libs/');
}

/**
 * Checks if a file is an MCP (Model Context Protocol) tool file.
 * MCP tools are plain functions outside the NestJS DI container.
 */
function isMcpFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.includes('/mcp/') || normalizedPath.startsWith('mcp/');
}

/**
 * Checks if a file is a config loader that runs before DI is available.
 */
function isConfigLoaderFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';
  return (
    filename.includes('loadConfig') ||
    filename.includes('load-config') ||
    filename.includes('ormconfig') ||
    filename.includes('OrmConfig') ||
    // TypeORM CLI data-source files - standalone CLI entry points
    filename === 'data-source.ts' ||
    filename === 'data-source.js' ||
    filename.includes('DataSource') ||
    filename.includes('datasource')
  );
}

/**
 * Checks if a file is a seed script (standalone Node.js process outside NestJS DI).
 */
function isSeedFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';
  return (
    filename === 'seed.ts' ||
    filename === 'seed.js' ||
    filename === 'seeds.ts' ||
    filename === 'seeds.js' ||
    normalizedPath.includes('/seeds/') ||
    normalizedPath.includes('/seeders/') ||
    normalizedPath.includes('/prisma/seed')
  );
}

/**
 * Checks if a file is a factory function that creates/extends clients.
 * These are used as NestJS custom providers via useFactory and must
 * instantiate clients directly since they ARE the factory.
 */
function isFactoryFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';
  return (
    filename.includes('Factory.ts') ||
    filename.includes('Factory.js') ||
    filename.includes('factory.ts') ||
    filename.includes('factory.js') ||
    // Prisma tenant factories
    filename.includes('ClientFactory') ||
    filename.includes('clientFactory')
  );
}

export function checkNoHardcodedDependency(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  // Skip test files - direct instantiation is expected in unit tests
  if (isTestFile(filePath)) return;

  const normalizedPath = filePath.replace(/\\/g, '/');
  const filename = normalizedPath.split('/').pop() || '';

  // Skip instrumentation files - OpenTelemetry runs before NestJS DI is available
  if (
    normalizedPath.includes('.instrumentation.') ||
    normalizedPath.endsWith('/instrumentation.ts') ||
    normalizedPath.endsWith('/instrumentation.js') ||
    filename === 'instrumentation.ts' ||
    filename === 'instrumentation.js' ||
    normalizedPath.includes('/instrumentation/')
  ) {
    return;
  }

  // Skip bootstrap files - run before NestJS DI is available
  if (normalizedPath.includes('/bootstrap/') || normalizedPath.startsWith('bootstrap/')) {
    return;
  }

  // Skip library files - operate outside NestJS DI container
  if (isLibraryFile(filePath)) {
    return;
  }

  // Skip MCP tool files - plain functions outside DI container
  if (isMcpFile(filePath)) {
    return;
  }

  // Skip config loader files - run before DI container exists
  if (isConfigLoaderFile(filePath)) {
    return;
  }

  // Skip seed files - standalone scripts outside NestJS DI
  if (isSeedFile(filePath)) {
    return;
  }

  // Skip factory files - these ARE the factory and must instantiate directly
  if (isFactoryFile(filePath)) {
    return;
  }

  const useFactoryRefs = collectUseFactoryReferences(sf);

  walk(sf, (node) => {
    if (!ts.isNewExpression(node)) return;
    const expr = node.expression;
    if (!ts.isIdentifier(expr)) return;

    // Skip if inside useFactory - this is legitimate NestJS DI pattern
    if (isInsideUseFactory(node)) {
      return;
    }

    // Skip factory helper functions referenced by useFactory
    if (isInsideReferencedUseFactory(node, useFactoryRefs)) {
      return;
    }

    if (looksLikeProvider(expr.text)) {
      ctx.report({
        filePath,
        message: `Direct instantiation of '${expr.text}' — use dependency injection instead`,
        line: getLine(sf, node),
        column: getColumn(sf, node),
      });
    }
  });
}

/**
 * **Rule `no-god-controller`** (architecture / warning)
 *
 * Flags `@Controller()` classes whose number of route-handler methods exceeds
 * {@link GOD_CONTROLLER_ROUTE_THRESHOLD}.  Route handlers are identified by
 * the presence of an HTTP-method decorator (`@Get`, `@Post`, etc.).
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoGodController(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    let routeCount = 0;
    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      for (const dec of getDecorators(member)) {
        const name = getDecoratorName(dec);
        if (name && HTTP_METHOD_DECORATORS.has(name)) {
          routeCount++;
          break;
        }
      }
    }

    if (routeCount > GOD_CONTROLLER_ROUTE_THRESHOLD) {
      const className = stmt.name?.text ?? '<anonymous>';
      ctx.report({
        filePath,
        message: `Controller '${className}' has ${routeCount} routes (threshold: ${GOD_CONTROLLER_ROUTE_THRESHOLD})`,
        line: getLine(sf, stmt),
        column: getColumn(sf, stmt),
      });
    }
  }
}

/**
 * **Rule `no-god-service`** (architecture / warning)
 *
 * Flags `@Injectable()` classes whose total line span exceeds
 * {@link GOD_SERVICE_LINE_THRESHOLD}, suggesting the service has too many
 * responsibilities and should be decomposed.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoGodService(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  // Skip library files - shared libraries have different architectural patterns
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath.includes('/libs/') || normalizedPath.startsWith('libs/')) {
    return;
  }

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Injectable')) continue;

    const startLine = sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line;
    const endLine = sf.getLineAndCharacterOfPosition(stmt.getEnd()).line;
    const lineCount = endLine - startLine + 1;

    if (lineCount > GOD_SERVICE_LINE_THRESHOLD) {
      const className = stmt.name?.text ?? '<anonymous>';
      ctx.report({
        filePath,
        message: `Service '${className}' is ${lineCount} lines (threshold: ${GOD_SERVICE_LINE_THRESHOLD})`,
        line: getLine(sf, stmt),
        column: getColumn(sf, stmt),
      });
    }
  }
}
