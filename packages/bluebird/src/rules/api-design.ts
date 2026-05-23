import ts from 'typescript';
import type { RuleContext } from '../types.js';
import {
  getDecorators,
  getDecoratorName,
  getDecoratorCallArgs,
  hasDecorator,
  findDecorator,
  getLine,
  getColumn,
  collectTypeReferenceNames,
  walk,
  HTTP_METHOD_DECORATORS,
} from './ast-helpers.js';
import { isTestFile } from '../utils/is-test-file.js';

/**
 * Set of all Swagger/OpenAPI response decorators that satisfy the
 * API response documentation requirement. Includes the generic
 * `@ApiResponse` and all status-code specific shorthand decorators.
 */
const API_RESPONSE_DECORATORS = new Set([
  'ApiResponse',
  'ApiOkResponse',
  'ApiCreatedResponse',
  'ApiAcceptedResponse',
  'ApiNoContentResponse',
  'ApiMovedPermanentlyResponse',
  'ApiFoundResponse',
  'ApiBadRequestResponse',
  'ApiUnauthorizedResponse',
  'ApiPaymentRequiredResponse',
  'ApiForbiddenResponse',
  'ApiNotFoundResponse',
  'ApiMethodNotAllowedResponse',
  'ApiNotAcceptableResponse',
  'ApiRequestTimeoutResponse',
  'ApiConflictResponse',
  'ApiPreconditionFailedResponse',
  'ApiTooManyRequestsResponse',
  'ApiGoneResponse',
  'ApiPayloadTooLargeResponse',
  'ApiUnsupportedMediaTypeResponse',
  'ApiUnprocessableEntityResponse',
  'ApiInternalServerErrorResponse',
  'ApiNotImplementedResponse',
  'ApiBadGatewayResponse',
  'ApiServiceUnavailableResponse',
  'ApiGatewayTimeoutResponse',
  'ApiDefaultResponse',
]);

/**
 * **Rule `missing-swagger-decorators`** (api-design / warning)
 *
 * Flags route-handler methods inside `@Controller()` classes that are
 * missing `@ApiOperation()` and/or `@ApiResponse()` decorators.
 *
 * This rule is only enabled when `@nestjs/swagger` is detected in the
 * project (gated by the `enabledWhen` predicate in the rule registry).
 * When active, every handler decorated with an HTTP method (`@Get`,
 * `@Post`, etc.) must also carry both Swagger decorators for complete
 * API documentation.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingSwaggerDecorators(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  // Skip test files - mock controllers in tests don't need Swagger documentation
  if (isTestFile(filePath)) return;

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      const isRouteHandler = getDecorators(member).some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && HTTP_METHOD_DECORATORS.has(name);
      });
      if (!isRouteHandler) continue;

      // Skip methods with @AllowUnauthenticated - often webhook callbacks
      if (hasDecorator(member, 'AllowUnauthenticated')) {
        continue;
      }

      // Skip methods with @ApiExcludeEndpoint - intentionally hidden from docs
      if (hasDecorator(member, 'ApiExcludeEndpoint')) {
        continue;
      }

      const hasApiOperation = hasDecorator(member, 'ApiOperation');
      const hasApiResponse = getDecorators(member).some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && API_RESPONSE_DECORATORS.has(name);
      });

      if (!hasApiOperation || !hasApiResponse) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : '<computed>';
        const missing = [!hasApiOperation && '@ApiOperation', !hasApiResponse && '@ApiResponse']
          .filter(Boolean)
          .join(' and ');

        ctx.report({
          filePath,
          message: `Handler '${methodName}' is missing ${missing}`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

/**
 * **Rule `no-entity-as-response`** (api-design / warning)
 *
 * Flags route handlers in `@Controller()` classes whose return type
 * annotation references an ORM entity class (name ending in `Entity`).
 *
 * Returning ORM entities directly couples the API surface to the database
 * schema, leaking internal fields (soft-delete flags, audit columns, etc.)
 * and making schema changes into breaking API changes. Entities should be
 * mapped to DTOs / response classes before returning.
 *
 * Handlers without explicit return type annotations are not flagged (no
 * type to inspect).
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoEntityAsResponse(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      if (!member.type) continue;

      const isRouteHandler = getDecorators(member).some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && HTTP_METHOD_DECORATORS.has(name);
      });
      if (!isRouteHandler) continue;

      const typeNames = collectTypeReferenceNames(member.type);
      const entityType = typeNames.find((n) => n.endsWith('Entity'));

      if (entityType) {
        const methodName = ts.isIdentifier(member.name) ? member.name.text : '<computed>';
        ctx.report({
          filePath,
          message: `Handler '${methodName}' returns ORM entity '${entityType}' directly — map to a DTO`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}

/**
 * Map of HTTP method decorators to their semantically incorrect status codes
 * and the expected correct status code.
 *
 * For example, `@Post` should default to 201 Created, so explicitly setting
 * `@HttpCode(200)` is flagged.  Similarly, `@Delete` conventionally returns
 * 204 No Content, so using 200 or 201 is suspicious.
 *
 * These are heuristic checks — legitimate API designs may intentionally
 * diverge from these conventions.
 */
const HTTP_STATUS_MISMATCHES: Record<string, { bad: Set<string>; expected: string }> = {
  Post: { bad: new Set(['200']), expected: '201 Created' },
  Delete: { bad: new Set(['200', '201']), expected: '204 No Content' },
};

const HTTP_STATUS_ENUM_VALUES: Record<string, string> = {
  OK: '200',
  CREATED: '201',
  ACCEPTED: '202',
  NO_CONTENT: '204',
};

/**
 * **Rule `no-inconsistent-http-status`** (api-design / warning)
 *
 * Flags route handlers where the `@HttpCode()` value conflicts with the
 * semantics of the HTTP method decorator.
 *
 * Currently checked patterns:
 * - `@Post` + `@HttpCode(200)` — POST should return 201 Created.
 * - `@Delete` + `@HttpCode(200)` or `@HttpCode(201)` — DELETE should return
 *   204 No Content.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoInconsistentHttpStatus(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      for (const [httpMethod, { bad, expected }] of Object.entries(HTTP_STATUS_MISMATCHES)) {
        if (!hasDecorator(member, httpMethod)) continue;

        const httpCodeDec = findDecorator(member, 'HttpCode');
        if (!httpCodeDec) continue;

        const args = getDecoratorCallArgs(httpCodeDec);
        if (!args || args.length === 0) continue;

        const firstArg = args[0];
        let statusCode: string | undefined;
        let statusDisplay: string | undefined;

        if (ts.isNumericLiteral(firstArg)) {
          statusCode = firstArg.text;
          statusDisplay = firstArg.text;
        } else if (
          ts.isPropertyAccessExpression(firstArg) &&
          ts.isIdentifier(firstArg.expression) &&
          firstArg.expression.text === 'HttpStatus' &&
          ts.isIdentifier(firstArg.name)
        ) {
          statusCode = HTTP_STATUS_ENUM_VALUES[firstArg.name.text];
          statusDisplay = `HttpStatus.${firstArg.name.text}`;
        }

        if (statusCode && bad.has(statusCode)) {
          // @ApiOkResponse (or other explicit OK documentation) signals an intentional 200 contract
          const hasDocumentedOkResponse = getDecorators(member).some(
            (d) => getDecoratorName(d) === 'ApiOkResponse'
          );
          if (hasDocumentedOkResponse && statusCode === '200') {
            continue;
          }

          const methodName = ts.isIdentifier(member.name) ? member.name.text : '<computed>';
          ctx.report({
            filePath,
            message: `@${httpMethod} handler '${methodName}' uses @HttpCode(${statusDisplay}) — should return ${expected}`,
            line: getLine(sf, httpCodeDec),
            column: getColumn(sf, httpCodeDec),
          });
        }
      }
    }
  }
}

/**
 * Checks whether a method parameter list includes pagination-related parameters
 * (e.g., `@Query('limit')`, `@Query('offset')`, `@Query('page')`, `@Query('cursor')`).
 */
function hasPaginationParams(params: ts.NodeArray<ts.ParameterDeclaration>): boolean {
  const PAGINATION_PARAMS = new Set([
    'limit',
    'offset',
    'page',
    'cursor',
    'skip',
    'take',
    'pageSize',
  ]);

  const QUERY_DTO_PAGINATION_HINT = /(paged|pagination|page|cursor|offset|limit)/i;

  for (const param of params) {
    const decorators = getDecorators(param);
    for (const dec of decorators) {
      const name = getDecoratorName(dec);
      if (name === 'Query') {
        const args = getDecoratorCallArgs(dec);
        if (args && args.length > 0 && ts.isStringLiteral(args[0])) {
          if (PAGINATION_PARAMS.has(args[0].text.toLowerCase())) {
            return true;
          }
        }
        // @Query() whole-query DTO (often carries page/take/cursor tokens)
        if ((!args || args.length === 0) && param.type && ts.isTypeReferenceNode(param.type)) {
          const typeName = param.type.typeName;
          if (ts.isIdentifier(typeName) && QUERY_DTO_PAGINATION_HINT.test(typeName.text)) {
            return true;
          }
        }
      }
    }

    // Also check parameter name itself
    if (ts.isIdentifier(param.name)) {
      if (PAGINATION_PARAMS.has(param.name.text.toLowerCase())) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Checks if the return type includes array brackets or common list wrapper types.
 */
function returnsCollection(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false;

  const typeNames = collectTypeReferenceNames(typeNode);
  const typeText = typeNode.getText();

  // Array syntax
  if (typeText.includes('[]')) return true;

  // Common collection wrapper types
  return typeNames.some(
    (name) =>
      name === 'Array' ||
      name.includes('List') ||
      name.includes('Page') ||
      name.includes('Paginated')
  );
}

/**
 * True when the handler already returns a paged / cursor envelope (not a raw array).
 * Matches common Endpoint and community DTO names (e.g. PagedResponseDto<T>).
 */
function returnsPagedEnvelope(typeNode: ts.TypeNode | undefined): boolean {
  if (!typeNode) return false;

  const typeText = typeNode.getText();
  if (
    /\bPagedResponse\w*\b/.test(typeText) ||
    /\bPaginated\w*\b/.test(typeText) ||
    /\bCursor(Page|Result|Response)\w*\b/i.test(typeText) ||
    /\bOffsetPage\w*\b/.test(typeText) ||
    /\bSlice(Response|Dto)\w*\b/i.test(typeText)
  ) {
    return true;
  }

  const names = collectTypeReferenceNames(typeNode);
  return names.some((n) => {
    if (/^Paged(Response|Result|Data)/i.test(n)) return true;
    if (
      /Paginated/i.test(n) &&
      (n.includes('Dto') || n.includes('Response') || n.includes('Result'))
    )
      return true;
    if (/^Cursor(Page|Result|Response)/i.test(n)) return true;
    return false;
  });
}

/**
 * **Rule `prefer-pagination`** (api-design / warning / heuristic)
 *
 * Flags `@Get()` handlers that appear to return collections (arrays or list types)
 * without pagination parameters. Unbounded list endpoints can cause performance
 * issues and memory exhaustion with large datasets.
 *
 * Handlers are flagged if:
 * - They are decorated with `@Get()` (listing endpoints)
 * - Their method name suggests a collection (`findAll`, `getAll`, `list*`, etc.)
 * - They return an array type
 * - They don't have pagination query parameters
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkPreferPagination(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  const LIST_METHOD_PATTERNS = /^(find|get|list|fetch|load|search|query)(All|Many|List)?$/i;

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    if (!hasDecorator(stmt, 'Controller')) continue;

    for (const member of stmt.members) {
      if (!ts.isMethodDeclaration(member)) continue;

      // Only check @Get handlers
      if (!hasDecorator(member, 'Get')) continue;

      const methodName = ts.isIdentifier(member.name) ? member.name.text : null;
      if (!methodName) continue;

      // Check if method name suggests a list operation
      const isListMethod = LIST_METHOD_PATTERNS.test(methodName);

      // Check if return type is a collection
      const isCollectionReturn = returnsCollection(member.type);

      // Skip if doesn't look like a list endpoint
      if (!isListMethod && !isCollectionReturn) continue;

      if (returnsPagedEnvelope(member.type)) continue;

      // Check for pagination parameters
      if (hasPaginationParams(member.parameters)) continue;

      ctx.report({
        filePath,
        message: `Handler '${methodName}' returns a collection without pagination — consider adding limit/offset or cursor parameters`,
        line: getLine(sf, member),
        column: getColumn(sf, member),
      });
    }
  }
}

/** NestJS HTTP exception classes that should be used instead of generic Error */
const _NEST_EXCEPTIONS = new Set([
  'HttpException',
  'BadRequestException',
  'UnauthorizedException',
  'ForbiddenException',
  'NotFoundException',
  'MethodNotAllowedException',
  'NotAcceptableException',
  'RequestTimeoutException',
  'ConflictException',
  'GoneException',
  'PayloadTooLargeException',
  'UnsupportedMediaTypeException',
  'UnprocessableEntityException',
  'InternalServerErrorException',
  'NotImplementedException',
  'BadGatewayException',
  'ServiceUnavailableException',
  'GatewayTimeoutException',
]);

/**
 * **Rule `no-generic-exception`** (api-design / warning)
 *
 * Flags `throw new Error(...)` in controller and service classes.
 * NestJS provides typed HTTP exceptions (BadRequestException, NotFoundException, etc.)
 * that automatically set proper HTTP status codes and are caught by exception filters.
 *
 * Using generic `Error` instead:
 * - Results in 500 Internal Server Error for all errors
 * - Leaks internal error messages to clients
 * - Bypasses NestJS exception handling patterns
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoGenericException(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  // Skip test files
  if (filePath.includes('.spec.') || filePath.includes('.test.')) {
    return;
  }

  // Skip library/infrastructure code - should remain transport-agnostic
  const normalizedPath = filePath.replace(/\\/g, '/');
  if (normalizedPath.includes('/libs/') || normalizedPath.startsWith('libs/')) {
    return;
  }

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;

    // ONLY check classes that return HTTP/GraphQL responses
    // Generic exceptions are only problematic when they escape to clients
    // Services, repositories, event handlers, etc. can legitimately throw generic errors
    const isController = hasDecorator(stmt, 'Controller');
    const isResolver = hasDecorator(stmt, 'Resolver');
    if (!isController && !isResolver) continue;

    walk(stmt, (node) => {
      if (!ts.isThrowStatement(node)) return;
      if (!node.expression || !ts.isNewExpression(node.expression)) return;

      const newExpr = node.expression;
      if (!ts.isIdentifier(newExpr.expression)) return;

      const exceptionName = newExpr.expression.text;

      // Check if it's a generic Error (not a NestJS exception)
      if (
        exceptionName === 'Error' ||
        exceptionName === 'TypeError' ||
        exceptionName === 'RangeError'
      ) {
        ctx.report({
          filePath,
          message: `Throwing generic '${exceptionName}' — use NestJS HttpException or specific exceptions like BadRequestException`,
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    });
  }
}
