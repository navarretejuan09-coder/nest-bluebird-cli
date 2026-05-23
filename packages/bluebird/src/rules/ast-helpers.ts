import ts from 'typescript';

/**
 * Returns all decorators attached to a TypeScript AST node.
 *
 * Uses the TS 5.x `canHaveDecorators` / `getDecorators` API so that both
 * legacy experimental decorators and TC39 decorators are handled uniformly.
 *
 * @param node - Any AST node; non-decoratable nodes return an empty array.
 * @returns A readonly array of {@link ts.Decorator} nodes (never `null`).
 */
export function getDecorators(node: ts.Node): readonly ts.Decorator[] {
  if (ts.canHaveDecorators(node)) {
    return ts.getDecorators(node) ?? [];
  }
  return [];
}

/**
 * Extracts the identifier name from a decorator expression.
 *
 * Handles both bare decorators (`@Foo`) and called decorators (`@Foo(args)`).
 *
 * @param decorator - The decorator AST node.
 * @returns The decorator name (e.g. `"Injectable"`), or `undefined` for
 *          complex expressions like `@ns.Foo()`.
 */
export function getDecoratorName(decorator: ts.Decorator): string | undefined {
  const expr = decorator.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return expr.expression.text;
  }
  return undefined;
}

/**
 * Checks whether an AST node carries a decorator with the given name.
 *
 * @param node - The node to inspect (class, method, property, etc.).
 * @param name - The decorator identifier to look for (e.g. `"Controller"`).
 * @returns `true` if a matching decorator is present.
 */
export function hasDecorator(node: ts.Node, name: string): boolean {
  return getDecorators(node).some((d) => getDecoratorName(d) === name);
}

/**
 * Returns the argument expressions of a called decorator.
 *
 * For `@Foo(a, b)` this returns the node array `[a, b]`.
 * For bare decorators (`@Foo`) it returns `undefined`.
 *
 * @param decorator - The decorator AST node.
 * @returns The argument list, or `undefined` if the decorator is not called.
 */
export function getDecoratorCallArgs(
  decorator: ts.Decorator
): readonly ts.Expression[] | undefined {
  if (ts.isCallExpression(decorator.expression)) {
    return decorator.expression.arguments;
  }
  return undefined;
}

/**
 * Finds and returns the first decorator on a node that matches the given name.
 *
 * @param node - The node to search.
 * @param name - The decorator identifier to look for.
 * @returns The matching {@link ts.Decorator}, or `undefined` if none is found.
 */
export function findDecorator(node: ts.Node, name: string): ts.Decorator | undefined {
  return getDecorators(node).find((d) => getDecoratorName(d) === name);
}

/**
 * Returns the 1-based line number where a node starts in the source file.
 *
 * @param sf   - The source file the node belongs to.
 * @param node - The AST node whose position to resolve.
 */
export function getLine(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/**
 * Returns the 1-based column number where a node starts in the source file.
 *
 * @param sf   - The source file the node belongs to.
 * @param node - The AST node whose position to resolve.
 */
export function getColumn(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).character + 1;
}

/**
 * Recursively walks every node in the AST subtree rooted at {@link node},
 * calling {@link visitor} on each node (depth-first, pre-order).
 *
 * @param node    - The root node to start traversal from.
 * @param visitor - Callback invoked for every node in the subtree.
 */
export function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  ts.forEachChild(node, (child) => walk(child, visitor));
}

/** NestJS HTTP-method decorator names used for route handler detection. */
export const HTTP_METHOD_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Delete',
  'Patch',
  'All',
  'Head',
  'Options',
]);

/**
 * NestJS class-level decorators that imply the class participates in DI.
 * Includes decorators from core NestJS and common ecosystem packages.
 */
export const NEST_CLASS_DECORATORS = new Set([
  // Core NestJS
  'Injectable',
  'Controller',
  'Module',
  'Resolver',
  'Catch', // Exception filters use @Catch() instead of @Injectable()

  // @nestjs/cqrs - Command Query Responsibility Segregation
  'EventsHandler',
  'CommandHandler',
  'QueryHandler',
  'Saga',

  // @nestjs/websockets
  'WebSocketGateway',

  // @nestjs/bull / @nestjs/bullmq - Queue processors
  'Processor',
]);

/**
 * Extracts all type-reference identifier names from a TypeNode,
 * recursing into generics (Promise<X>, Array<X>) and array types.
 */
export function collectTypeReferenceNames(typeNode: ts.TypeNode): string[] {
  const names: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      names.push(node.typeName.text);
      node.typeArguments?.forEach(visit);
    } else if (ts.isArrayTypeNode(node)) {
      visit(node.elementType);
    } else {
      ts.forEachChild(node, visit);
    }
  }

  visit(typeNode);
  return names;
}

/**
 * Returns the string value from the first argument of a decorator call,
 * e.g. `@Controller('users')` → `"users"`.
 */
export function getDecoratorStringArg(decorator: ts.Decorator): string | undefined {
  const args = getDecoratorCallArgs(decorator);
  if (args && args.length > 0 && ts.isStringLiteral(args[0])) {
    return args[0].text;
  }
  return undefined;
}

/**
 * Resolves the name of a call-expression receiver,
 * e.g. `console.log(...)` → `"console.log"`, `fetch(...)` → `"fetch"`.
 */
export function resolveCallName(node: ts.CallExpression): string | undefined {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) {
    if (ts.isIdentifier(expr.expression)) {
      return `${expr.expression.text}.${expr.name.text}`;
    }
    if (
      ts.isPropertyAccessExpression(expr.expression) &&
      ts.isIdentifier(expr.expression.name) &&
      ts.isIdentifier(expr.expression.expression)
    ) {
      return `${expr.expression.expression.text}.${expr.expression.name.text}.${expr.name.text}`;
    }
  }
  return undefined;
}
