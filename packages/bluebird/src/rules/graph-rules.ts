import ts from 'typescript';
import type { RuleContext, ModuleNode } from '../types.js';
import {
  getDecorators,
  getDecoratorName,
  getDecoratorCallArgs,
  hasDecorator,
  getDecoratorStringArg,
  HTTP_METHOD_DECORATORS,
} from './ast-helpers.js';
import { isTestFile } from '../utils/is-test-file.js';

/**
 * Extracts the version value from a @Version() decorator.
 * Handles multiple formats:
 * - @Version('1') - string literal
 * - @Version(1) - numeric literal
 * - @Version(['1', '2']) - array (returns first element)
 * - @Version(VERSION_NEUTRAL) - identifier constant
 */
function getVersionFromDecorator(decorator: ts.Decorator): string | undefined {
  const args = getDecoratorCallArgs(decorator);
  if (!args || args.length === 0) return undefined;

  const firstArg = args[0];

  // Handle string literal: @Version('1')
  if (ts.isStringLiteral(firstArg)) {
    return firstArg.text;
  }

  // Handle numeric literal: @Version(1)
  if (ts.isNumericLiteral(firstArg)) {
    return firstArg.text;
  }

  // Handle identifier: @Version(VERSION_NEUTRAL) or other constants
  // Use the identifier name as the version key to distinguish from unversioned routes
  if (ts.isIdentifier(firstArg)) {
    return `$${firstArg.text}`;
  }

  // Handle array: @Version(['1', '2']) - use first element for route key
  if (ts.isArrayLiteralExpression(firstArg) && firstArg.elements.length > 0) {
    const firstElement = firstArg.elements[0];
    if (ts.isStringLiteral(firstElement)) {
      return firstElement.text;
    }
    if (ts.isNumericLiteral(firstElement)) {
      return firstElement.text;
    }
    if (ts.isIdentifier(firstElement)) {
      return `$${firstElement.text}`;
    }
  }

  // For any other expression (property access, etc.), use raw text
  return `$${firstArg.getText()}`;
}

/**
 * Scans all source files for `@Module()` class declarations and extracts
 * each module's class name, file path, line, and imported module identifiers.
 *
 * Handles both direct identifiers (`UsersModule`) and `forwardRef(() => X)`
 * expressions inside the `imports` array.
 *
 * @param sourceFiles - Map of file-path to parsed source file.
 * @returns An array of {@link ModuleNode} descriptors.
 */
export function extractModuleNodes(sourceFiles: ReadonlyMap<string, ts.SourceFile>): ModuleNode[] {
  const modules: ModuleNode[] = [];

  for (const [filePath, sf] of sourceFiles) {
    for (const stmt of sf.statements) {
      if (!ts.isClassDeclaration(stmt) || !stmt.name) continue;
      if (!hasDecorator(stmt, 'Module')) continue;

      const moduleDecorator = getDecorators(stmt).find((d) => getDecoratorName(d) === 'Module')!;
      const args = getDecoratorCallArgs(moduleDecorator);
      const imports: string[] = [];

      if (args && args.length > 0 && ts.isObjectLiteralExpression(args[0])) {
        const configObj = args[0];
        for (const prop of configObj.properties) {
          if (
            !ts.isPropertyAssignment(prop) ||
            !ts.isIdentifier(prop.name) ||
            prop.name.text !== 'imports'
          )
            continue;

          if (ts.isArrayLiteralExpression(prop.initializer)) {
            for (const element of prop.initializer.elements) {
              if (ts.isIdentifier(element)) {
                imports.push(element.text);
              } else if (ts.isCallExpression(element)) {
                if (
                  ts.isIdentifier(element.expression) &&
                  element.expression.text === 'forwardRef'
                ) {
                  const arrowFn = element.arguments[0];
                  if (arrowFn && ts.isArrowFunction(arrowFn)) {
                    if (ts.isIdentifier(arrowFn.body)) {
                      imports.push(arrowFn.body.text);
                    }
                  }
                }
              }
            }
          }
        }
      }

      modules.push({
        className: stmt.name.text,
        filePath,
        line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1,
        imports,
      });
    }
  }

  return modules;
}

/**
 * Detects circular dependencies in the module import graph using DFS with a
 * "currently on stack" set.
 *
 * Nodes are identified by file path (not class name) to prevent collisions
 * when multiple files define classes with the same name.  Imports are
 * resolved from class-name references to file paths via a lookup table.
 *
 * **Known limitation (v1):** imports are resolved by class name, so if two
 * files declare `class SharedModule`, an import of `SharedModule` fans out
 * to both files and could produce a false cycle.  This is effectively
 * impossible in real NestJS projects (duplicate module class names break
 * DI at runtime).  When the full TS graph pass (step 8) introduces
 * `ts.createProgram`, imports can be resolved by symbol identity instead.
 *
 * Each returned cycle is an array of file paths forming the loop,
 * with the first element repeated at the end.
 *
 * @param modules - Module descriptors produced by {@link extractModuleNodes}.
 * @returns An array of cycles (may be empty if the graph is acyclic).
 */
function findCycles(modules: ModuleNode[]): string[][] {
  const classToFilePaths = new Map<string, string[]>();
  for (const mod of modules) {
    let paths = classToFilePaths.get(mod.className);
    if (!paths) {
      paths = [];
      classToFilePaths.set(mod.className, paths);
    }
    paths.push(mod.filePath);
  }

  const adj = new Map<string, string[]>();
  for (const mod of modules) {
    const neighbors: string[] = [];
    for (const importName of mod.imports) {
      const targets = classToFilePaths.get(importName);
      if (targets) neighbors.push(...targets);
    }
    adj.set(mod.filePath, neighbors);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      if (cycleStart !== -1) {
        cycles.push(path.slice(cycleStart).concat(node));
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);
    path.push(node);

    const neighbors = adj.get(node) ?? [];
    for (const neighbor of neighbors) {
      dfs(neighbor, path);
    }

    path.pop();
    inStack.delete(node);
  }

  for (const mod of modules) {
    if (!visited.has(mod.filePath)) {
      dfs(mod.filePath, []);
    }
  }

  return cycles;
}

/**
 * **Rule `no-circular-dependency`** (architecture / error)
 *
 * Detects circular import chains in the NestJS module dependency graph.
 *
 * The checker extracts all `@Module({ imports: [...] })` declarations,
 * builds a directed adjacency graph, and runs a DFS-based cycle detection.
 * `forwardRef(() => XModule)` entries are resolved and included in the
 * graph.
 *
 * Each detected cycle is reported with the full chain
 * (e.g. `AModule → BModule → AModule`) and the file/line of the first
 * module in the cycle.
 *
 * @param sourceFiles - Map of file paths to parsed TypeScript source files.
 * @param ctx         - Rule context providing project info and the `report` callback.
 */
export function checkNoCircularDependency(
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  ctx: RuleContext
): void {
  const modules = extractModuleNodes(sourceFiles);
  const cycles = findCycles(modules);
  const moduleByFilePath = new Map(modules.map((m) => [m.filePath, m]));

  for (const cycle of cycles) {
    const firstFilePath = cycle[0];
    const mod = moduleByFilePath.get(firstFilePath);
    if (!mod) continue;

    const displayCycle = cycle.map((fp) => moduleByFilePath.get(fp)?.className ?? fp);

    ctx.report({
      filePath: mod.filePath,
      message: `Circular module dependency: ${displayCycle.join(' → ')}`,
      line: mod.line,
    });
  }
}

interface RouteInfo {
  method: string;
  path: string;
  version?: string;
  filePath: string;
  line: number;
  handlerName: string;
}

/**
 * Joins path segments into a single normalized route path, stripping leading
 * and trailing slashes from each segment before joining with `"/"`.
 *
 * @example normalizeRoutePath("/users/", ":id") // "users/:id"
 */
function normalizeRoutePath(...segments: string[]): string {
  return segments
    .map((s) => s.replace(/^\/|\/$/g, ''))
    .filter((s) => s.length > 0)
    .join('/');
}

/**
 * Returns whether a decorator call has arguments that are not string literals.
 * Used to detect dynamic path expressions like `@Controller(API_PREFIX)` or
 * `@Get(PATHS.X)` that cannot be statically resolved.
 */
function hasNonStringArgs(decorator: ts.Decorator): boolean {
  const args = getDecoratorCallArgs(decorator);
  return args !== undefined && args.length > 0 && !ts.isStringLiteral(args[0]);
}

/**
 * Collects every route definition across all source files by inspecting
 * `@Controller()` classes and their HTTP-method-decorated methods.
 *
 * The full route path is computed by concatenating the controller's base
 * path with each handler's sub-path.
 *
 * Controllers or handlers whose path argument is a non-string expression
 * (e.g. `@Controller(API_PREFIX)`, `@Get(PATHS.X)`) are skipped to avoid
 * false-positive duplicate-route reports from collapsing distinct dynamic
 * paths into the same key.
 *
 * @param sourceFiles - Map of file-path to parsed source file.
 * @returns An array of {@link RouteInfo} descriptors.
 */
function extractRoutes(sourceFiles: ReadonlyMap<string, ts.SourceFile>): RouteInfo[] {
  const routes: RouteInfo[] = [];

  for (const [filePath, sf] of sourceFiles) {
    // Skip test files - mock controllers in tests should not be considered production routes
    if (isTestFile(filePath)) continue;

    for (const stmt of sf.statements) {
      if (!ts.isClassDeclaration(stmt)) continue;
      if (!hasDecorator(stmt, 'Controller')) continue;

      const controllerDec = getDecorators(stmt).find((d) => getDecoratorName(d) === 'Controller')!;

      if (hasNonStringArgs(controllerDec)) continue;

      const basePath = getDecoratorStringArg(controllerDec) ?? '';

      // Check for class-level @Version decorator
      const classVersionDec = getDecorators(stmt).find((d) => getDecoratorName(d) === 'Version');
      const classVersion = classVersionDec ? getVersionFromDecorator(classVersionDec) : undefined;

      for (const member of stmt.members) {
        if (!ts.isMethodDeclaration(member)) continue;

        for (const dec of getDecorators(member)) {
          const httpMethod = getDecoratorName(dec);
          if (!httpMethod || !HTTP_METHOD_DECORATORS.has(httpMethod)) continue;

          if (hasNonStringArgs(dec)) continue;

          const subPath = getDecoratorStringArg(dec) ?? '';
          const fullPath = normalizeRoutePath(basePath, subPath);
          const handlerName = ts.isIdentifier(member.name) ? member.name.text : '<computed>';

          // Check for method-level @Version decorator (overrides class-level)
          const methodVersionDec = getDecorators(member).find(
            (d) => getDecoratorName(d) === 'Version'
          );
          const methodVersion = methodVersionDec
            ? getVersionFromDecorator(methodVersionDec)
            : undefined;
          const effectiveVersion = methodVersion ?? classVersion;

          routes.push({
            method: httpMethod.toLowerCase(),
            path: fullPath,
            version: effectiveVersion,
            filePath,
            line: sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1,
            handlerName,
          });
        }
      }
    }
  }

  return routes;
}

/**
 * **Rule `no-duplicate-route`** (correctness / error)
 *
 * Detects duplicate HTTP route registrations across all controllers in
 * the project.  A route is considered duplicate when two handler methods
 * share the same normalised HTTP method + path combination.
 *
 * The checker extracts `@Controller('basePath')` and each handler's HTTP
 * method decorator (e.g. `@Get(':id')`), computes the full route path,
 * and flags the second occurrence of any duplicate.
 *
 * @param sourceFiles - Map of file paths to parsed TypeScript source files.
 * @param ctx         - Rule context providing project info and the `report` callback.
 */
export function checkNoDuplicateRoute(
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  ctx: RuleContext
): void {
  const routes = extractRoutes(sourceFiles);
  const seen = new Map<string, RouteInfo>();

  for (const route of routes) {
    // Include version in route key to avoid flagging versioned routes as duplicates
    const key = route.version
      ? `v${route.version}:${route.method}:${route.path}`
      : `${route.method}:${route.path}`;
    const existing = seen.get(key);

    if (existing) {
      const versionInfo = route.version ? ` (v${route.version})` : '';
      ctx.report({
        filePath: route.filePath,
        message: `Duplicate route ${route.method.toUpperCase()} /${route.path}${versionInfo} — also defined by '${existing.handlerName}' in ${existing.filePath}:${existing.line}`,
        line: route.line,
      });
    } else {
      seen.set(key, route);
    }
  }
}
