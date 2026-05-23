import ts from 'typescript';
import type { RuleContext } from '../types.js';
import { getLine, getColumn, walk, getDecorators, getDecoratorName } from './ast-helpers.js';
import { isTestFile } from '../utils/is-test-file.js';
import { isMigrationFile } from '../utils/is-migration-file.js';
import { isCliEntryPoint } from '../utils/is-cli-entry-point.js';

const SECRET_NAME_PATTERN =
  /(?:^|[._])(?:password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|private[_-]?key|client[_-]?secret|db[_-]?pass(?:word)?|jwt[_-]?secret|encryption[_-]?key|signing[_-]?key|secret[_-]?key|connection[_-]?string)$/i;

/**
 * Returns `true` when a variable / property name matches a pattern strongly
 * associated with credentials (e.g. `password`, `api_key`, `jwt_secret`).
 */
function isSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

/**
 * Placeholder values commonly used in tests, examples, and development.
 * These are excluded from hardcoded secret detection to reduce false positives.
 *
 * Note: We intentionally DON'T exclude values like "secret" or "password" as
 * they could be actual hardcoded secrets. Instead, we rely on isTestFile()
 * to exclude test files entirely.
 */
const PLACEHOLDER_PATTERN =
  /^(true|false|null|undefined|none|default|test|example|placeholder|changeme|todo|fixme|xxx|mock|fake|dummy|sample|dev|local|development|staging|sandbox|demo|your[_-]?secret|replace[_-]?me|insert[_-]?here|<[^>]+>|\$\{[^}]+\}|%[^%]+%)$/i;

/**
 * Returns `true` when {@link node} is a non-empty string literal that does
 * not look like a common placeholder value (e.g. `"changeme"`, `"todo"`,
 * `"mock"`, `"fake"`, `"dummy"`, `"sample"`, `"dev"`, `"local"`).
 */
function isHardcodedStringValue(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const text = node.text;
    if (text.length === 0) return false;
    // Exclude common placeholder patterns
    if (PLACEHOLDER_PATTERN.test(text)) return false;
    // Exclude very short values (likely placeholders like "x", "abc")
    if (text.length <= 3) return false;
    return true;
  }
  return false;
}

/**
 * **Rule `no-hardcoded-secrets`** (security / error)
 *
 * Flags variable declarations, class property declarations, and object
 * property assignments whose name matches a secret pattern (e.g. `password`,
 * `api_key`, `jwt_secret`) and whose value is a non-empty string literal.
 *
 * Environment-variable references (`process.env.*`) are ignored.
 * Placeholder values (`"test"`, `"changeme"`, `""`, etc.) are excluded to
 * reduce false positives in test fixtures and boilerplate.
 *
 * Test files (*.spec.ts, *.test.ts, cypress/, test/, etc.) are excluded
 * since hardcoded test credentials are expected and acceptable.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoHardcodedSecrets(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  // Skip test files - hardcoded test credentials are acceptable
  if (isTestFile(filePath)) return;

  walk(sf, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isSecretName(node.name.text) && isHardcodedStringValue(node.initializer)) {
        ctx.report({
          filePath,
          message: `Hardcoded secret in '${node.name.text}' — move to environment variables`,
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }

    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (isSecretName(node.name.text) && isHardcodedStringValue(node.initializer)) {
        ctx.report({
          filePath,
          message: `Hardcoded secret in '${node.name.text}' — move to environment variables`,
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }

    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      if (isSecretName(node.name.text) && isHardcodedStringValue(node.initializer)) {
        ctx.report({
          filePath,
          message: `Hardcoded secret in '${node.name.text}' — move to environment variables`,
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }
  });
}

/**
 * **Rule `missing-validation-pipe`** (security / warning)
 *
 * Checks whether a file that bootstraps a NestJS application (contains
 * `NestFactory`) also configures a global `ValidationPipe`.  Without a
 * global validation pipe, DTOs decorated with `class-validator` constraints
 * will not be validated automatically.
 *
 * Detects validation pipe configuration via:
 * - Direct `ValidationPipe` usage (useGlobalPipes)
 * - APP_PIPE provider pattern
 * - Common validation pipe patterns (GlobalValidationPipe, etc.)
 *
 * Only files containing `NestFactory` are inspected; all other files are
 * silently skipped.
 *
 * CLI entry points (migration runners, seeders, workers, etc.) are excluded
 * since they don't handle HTTP requests and don't need input validation.
 * Also excludes files using `NestFactory.createApplicationContext()` which
 * creates a standalone application without HTTP handling.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingValidationPipe(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const text = sf.getFullText();

  const hasNestFactory = text.includes('NestFactory');
  if (!hasNestFactory) return;

  // Skip CLI entry points - they don't handle HTTP requests
  if (isCliEntryPoint(filePath)) return;

  // Skip standalone applications (createApplicationContext) - no HTTP handling
  if (text.includes('createApplicationContext')) return;

  // Check for various validation pipe patterns
  const hasValidationPipe =
    text.includes('ValidationPipe') ||
    text.includes('APP_PIPE') ||
    text.includes('useGlobalPipes') ||
    // Common custom validation pipe names
    text.includes('GlobalValidationPipe') ||
    text.includes('CustomValidationPipe') ||
    // Transform pipe (often used alongside validation)
    /validation.*pipe/i.test(text);

  if (!hasValidationPipe) {
    const nestFactoryLine = text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(nestFactoryLine).line + 1;
    ctx.report({
      filePath,
      message: 'Application bootstrap is missing a global ValidationPipe',
      line,
      column: 1,
    });
  }
}

/**
 * **Rule `no-any-in-dto`** (security / warning)
 *
 * Flags properties and constructor parameters typed as `any` inside DTO
 * classes (class names ending with `Dto` or `DTO`). Using `any` in a DTO
 * defeats `class-validator` constraints, allowing unchecked data through
 * the validation pipeline and breaking type safety at API boundaries.
 *
 * Non-DTO classes are ignored entirely.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoAnyInDto(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    const className = stmt.name?.text ?? '';
    if (!className.endsWith('Dto') && !className.endsWith('DTO')) continue;

    for (const member of stmt.members) {
      if (ts.isPropertyDeclaration(member) && member.type) {
        if (member.type.kind === ts.SyntaxKind.AnyKeyword) {
          const propName = ts.isIdentifier(member.name) ? member.name.text : '<computed>';
          ctx.report({
            filePath,
            message: `Property '${propName}' in DTO '${className}' is typed as 'any'`,
            line: getLine(sf, member),
            column: getColumn(sf, member),
          });
        }
      }

      if (ts.isConstructorDeclaration(member)) {
        for (const param of member.parameters) {
          if (param.type && param.type.kind === ts.SyntaxKind.AnyKeyword) {
            const paramName = ts.isIdentifier(param.name) ? param.name.text : '<computed>';
            ctx.report({
              filePath,
              message: `Parameter '${paramName}' in DTO '${className}' constructor is typed as 'any'`,
              line: getLine(sf, param),
              column: getColumn(sf, param),
            });
          }
        }
      }
    }
  }
}

/**
 * SQL statement patterns that indicate actual SQL queries.
 * More specific than just keywords to avoid false positives on natural language.
 *
 * Patterns match:
 * - SELECT * / SELECT column / SELECT DISTINCT
 * - INSERT INTO
 * - UPDATE table SET (requires SET to distinguish from natural language "update")
 * - DELETE FROM
 * - DROP TABLE/INDEX/DATABASE
 * - ALTER TABLE
 * - TRUNCATE [TABLE]
 * - CREATE TABLE/INDEX/DATABASE/POLICY
 *
 * Note: Word boundaries (\b) are carefully placed to avoid issues with special
 * characters like * which don't have word boundaries after them.
 */
const SQL_STATEMENT_PATTERN =
  /\b(SELECT\s+\*|SELECT\s+\w+\b|SELECT\s+DISTINCT\b|INSERT\s+INTO\b|UPDATE\s+\w+\s+SET\b|DELETE\s+FROM\b|DROP\s+(TABLE|INDEX|DATABASE)\b|ALTER\s+TABLE\b|TRUNCATE(\s+TABLE)?\b|CREATE\s+(TABLE|INDEX|DATABASE|POLICY)\b)/i;

/**
 * Safe SQL template tag names that indicate parameterized query builders.
 * These libraries handle escaping internally and are exempt from raw SQL detection.
 *
 * Includes: Prisma, slonik, sql-template-tag, knex, sequelize, typeorm, drizzle, kysely
 */
const SAFE_SQL_TAGS = new Set([
  'sql',
  'Sql',
  'SQL',
  'raw',
  // Knex
  'knex',
  'Knex',
  // Sequelize
  'sequelize',
  'Sequelize',
  'literal',
  // TypeORM
  'typeorm',
  'TypeORM',
  // Drizzle
  'drizzle',
  'Drizzle',
  // Kysely
  'kysely',
  'Kysely',
  // Slonik
  'slonik',
  'Slonik',
  // MikroORM
  'mikroorm',
  'MikroORM',
]);

/**
 * Safe SQL receiver objects (e.g., `Prisma.sql`, `knex.raw`).
 * When a tag is a property access like `X.sql`, we check if X is in this set.
 */
const SAFE_SQL_RECEIVERS = new Set([
  'Prisma',
  'prisma',
  'knex',
  'Knex',
  'sequelize',
  'Sequelize',
  'db',
  'DB',
  'database',
  'connection',
  'pool',
]);

/**
 * Returns true if the tag represents a safe SQL template literal.
 * Handles both direct tags (`sql\`...\``) and property access (`Prisma.sql\`...\``).
 */
function isSafeSqlTag(tag: ts.Expression): boolean {
  // Direct tag: sql`...`
  if (ts.isIdentifier(tag)) {
    return SAFE_SQL_TAGS.has(tag.text);
  }
  // Property access: Prisma.sql`...` or knex.raw`...`
  if (ts.isPropertyAccessExpression(tag) && ts.isIdentifier(tag.name)) {
    const propName = tag.name.text;
    // Check if the property name is a safe SQL tag
    if (SAFE_SQL_TAGS.has(propName)) return true;
    // Check if the receiver is a known safe SQL object
    if (ts.isIdentifier(tag.expression) && SAFE_SQL_RECEIVERS.has(tag.expression.text)) {
      return true;
    }
  }
  return false;
}

/**
 * **Rule `no-raw-sql`** (security / error)
 *
 * Detects raw SQL queries constructed via template literal interpolation
 * (`\`SELECT … WHERE id = ${userId}\``) or string concatenation
 * (`"DELETE FROM … WHERE id = " + id`).  These patterns are vulnerable
 * to SQL injection when user-supplied values are inserted without
 * parameterization.
 *
 * Tagged template literals using known safe SQL tags (`sql`, `Sql`, `SQL`,
 * `raw`) are exempt — both bare tags (`sql\`…\``) and property-access
 * tags (`Prisma.sql\`…\``).  These typically represent parameterized query
 * builders (Prisma, slonik, sql-template-tag, etc.) that handle escaping
 * internally.
 *
 * Static SQL strings and parameterized templates (e.g. `$1`, `?`) are
 * not flagged.
 *
 * Migration files are excluded because they contain DDL statements (CREATE TABLE,
 * ALTER TABLE, etc.) that use template interpolation for table/column names
 * defined within the migration class itself. These are not SQL injection risks.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkNoRawSql(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  // Skip test files - raw SQL in tests (e.g., cypress fixtures, test setup) is acceptable
  if (isTestFile(filePath)) return;

  // Skip migration files - DDL statements with class property interpolation are not injection risks
  if (isMigrationFile(filePath)) return;

  const exemptTemplates = new WeakSet<ts.Node>();

  walk(sf, (node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      if (isSafeSqlTag(node.tag)) {
        exemptTemplates.add(node.template);
      }
    }

    if (ts.isTemplateExpression(node) && !exemptTemplates.has(node)) {
      const fullText = node.getText(sf);
      if (SQL_STATEMENT_PATTERN.test(fullText) && node.templateSpans.length > 0) {
        ctx.report({
          filePath,
          message: 'Raw SQL with template interpolation — use parameterized queries instead',
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      if (ts.isStringLiteral(node.left) && SQL_STATEMENT_PATTERN.test(node.left.text)) {
        ctx.report({
          filePath,
          message: 'Raw SQL with string concatenation — use parameterized queries instead',
          line: getLine(sf, node),
          column: getColumn(sf, node),
        });
      }
    }
  });
}

/**
 * **Rule `missing-csrf-protection`** (security / warning / heuristic)
 *
 * Flags NestJS applications that use session-based or cookie-based authentication
 * but don't configure CSRF protection middleware (csurf or alternative).
 *
 * Only bootstrap files (containing `NestFactory`) are inspected. This is a
 * heuristic check — API-only services using stateless JWT auth may not need CSRF.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingCsrfProtection(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const text = sf.getFullText();

  // Only check bootstrap files
  if (!text.includes('NestFactory')) return;

  if (isCliEntryPoint(filePath)) return;

  // Look for session or cookie usage patterns
  const usesSession =
    text.includes('express-session') ||
    text.includes('cookie-session') ||
    text.includes('session(') ||
    text.includes('cookieParser');

  if (!usesSession) return;

  // Check for CSRF middleware
  const hasCsrf =
    text.includes('csurf') || text.includes('csrf') || text.includes('csrfProtection');

  if (!hasCsrf) {
    const sessionPos = text.search(/session\(|cookie/i);
    const pos = sessionPos >= 0 ? sessionPos : text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(pos).line + 1;

    ctx.report({
      filePath,
      message:
        'Session-based auth detected without CSRF protection — consider adding csurf middleware',
      line,
      column: 1,
    });
  }
}

/**
 * **Rule `missing-rate-limiting`** (security / warning / heuristic)
 *
 * Flags NestJS applications that don't configure rate limiting / throttling.
 * Without rate limiting, endpoints are vulnerable to brute-force attacks
 * and denial-of-service.
 *
 * Checks for `@nestjs/throttler`, `express-rate-limit`, or similar patterns.
 * Only bootstrap files (containing `NestFactory`) are inspected.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingRateLimiting(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const text = sf.getFullText();

  // Only check bootstrap files or app module
  if (!text.includes('NestFactory') && !text.includes('AppModule')) return;

  if (isCliEntryPoint(filePath)) return;

  // Skip if throttler feature is detected at project level
  if (ctx.project.features.throttler) return;

  // Check for rate limiting patterns
  const hasRateLimiting =
    text.includes('ThrottlerModule') ||
    text.includes('ThrottlerGuard') ||
    text.includes('rateLimit') ||
    text.includes('express-rate-limit') ||
    text.includes('rate-limiter');

  if (!hasRateLimiting && text.includes('NestFactory')) {
    const nestFactoryPos = text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(nestFactoryPos).line + 1;

    ctx.report({
      filePath,
      message:
        'No rate limiting configured — consider adding @nestjs/throttler to protect endpoints',
      line,
      column: 1,
    });
  }
}

/**
 * **Rule `missing-global-guard`** (security / warning / heuristic)
 *
 * Flags NestJS applications that don't configure a global authentication guard.
 * Without a global guard, every route must be individually protected, which
 * is error-prone and can lead to accidentally exposed endpoints.
 *
 * This is a heuristic — some applications intentionally use per-route guards
 * or are public APIs that don't require authentication.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingGlobalGuard(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  const text = sf.getFullText();

  // Only check bootstrap files
  if (!text.includes('NestFactory')) return;

  if (isCliEntryPoint(filePath)) return;

  // Check for global guard configuration
  const hasGlobalGuard =
    text.includes('useGlobalGuards') || text.includes('APP_GUARD') || text.includes('GlobalGuard');

  if (!hasGlobalGuard) {
    const nestFactoryPos = text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(nestFactoryPos).line + 1;

    ctx.report({
      filePath,
      message:
        'No global authentication guard configured — consider using APP_GUARD or useGlobalGuards()',
      line,
      column: 1,
    });
  }
}

/**
 * **Rule `missing-helmet`** (security / warning / heuristic)
 *
 * Flags NestJS applications that don't configure helmet middleware for
 * security headers (X-Content-Type-Options, X-Frame-Options, etc.).
 *
 * Only bootstrap files (containing `NestFactory`) are inspected. This
 * may be intentionally skipped for API-only services behind an API gateway
 * that handles security headers.
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingHelmet(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  const text = sf.getFullText();

  // Only check bootstrap files
  if (!text.includes('NestFactory')) return;

  if (isCliEntryPoint(filePath)) return;

  // Check for helmet usage
  const hasHelmet =
    text.includes('helmet') ||
    text.includes('Helmet') ||
    // Alternative: manual security header configuration
    text.includes('X-Content-Type-Options') ||
    text.includes('X-Frame-Options');

  if (!hasHelmet) {
    const nestFactoryPos = text.indexOf('NestFactory');
    const line = sf.getLineAndCharacterOfPosition(nestFactoryPos).line + 1;

    ctx.report({
      filePath,
      message: 'No helmet middleware configured — consider adding helmet for security headers',
      line,
      column: 1,
    });
  }
}

/** Common class-validator decorator names */
const CLASS_VALIDATOR_DECORATORS = new Set([
  // String validators
  'IsString',
  'IsNotEmpty',
  'IsEmail',
  'IsUrl',
  'IsUUID',
  'IsDateString',
  'IsPhoneNumber',
  'IsAlpha',
  'IsAlphanumeric',
  'IsAscii',
  'IsBase64',
  'IsCreditCard',
  'IsHexColor',
  'IsIP',
  'IsJSON',
  'IsJWT',
  'IsLowercase',
  'IsUppercase',
  'Length',
  'MinLength',
  'MaxLength',
  'Matches',
  'Contains',
  'NotContains',
  // Number validators
  'IsNumber',
  'IsInt',
  'IsPositive',
  'IsNegative',
  'Min',
  'Max',
  'IsDivisibleBy',
  // Boolean validators
  'IsBoolean',
  // Date validators
  'IsDate',
  'MinDate',
  'MaxDate',
  // Array validators
  'IsArray',
  'ArrayMinSize',
  'ArrayMaxSize',
  'ArrayContains',
  'ArrayNotContains',
  'ArrayNotEmpty',
  'ArrayUnique',
  // Object validators
  'IsObject',
  'IsNotEmptyObject',
  'ValidateNested',
  // Type validators
  'IsEnum',
  'IsOptional',
  'IsDefined',
  'IsIn',
  'IsNotIn',
  // Equality validators
  'Equals',
  'NotEquals',
  // Transform decorators (class-transformer, commonly used with class-validator)
  'Type',
  'Transform',
  'Exclude',
  'Expose',
]);

/**
 * DTO name patterns that indicate response/output types.
 * These DTOs represent outbound data and don't need input validation.
 */
const RESPONSE_DTO_NAME_PATTERNS = [
  /Response(Dto|DTO)$/,
  /Results?(Dto|DTO)$/, // Result or Results
  /Output(Dto|DTO)$/,
  /^(Get|List|Find|Fetch|Read)[A-Z].*?(Dto|DTO)$/, // GetUserDto, ListOrdersDto, etc.
  /With(Display|View|Full|Extended|Details?)[A-Z].*?(Dto|DTO)$/, // DTOs that extend with display fields
  /Details(Dto|DTO)$/, // DetailsDto often used for responses
  /^Base[A-Z].*?(Dto|DTO)$/, // Base DTOs (BaseContactFieldsDto, etc.)
  /Fields?(Dto|DTO)$/, // Field/Fields DTOs (metadata, often responses)
  /Option(s)?(Dto|DTO)$/, // Options DTOs (dropdown/select options, responses)
  /Info(Dto|DTO)$/, // Info DTOs (information display)
  /Summary(Dto|DTO)$/, // Summary DTOs (aggregate info)
  /Status(Dto|DTO)$/, // Status DTOs (status info)
  /For[A-Z][a-zA-Z]*(Dto|DTO)$/, // DTOs that provide data "for" something (ContactFieldForClassDto)
  /View(Dto|DTO)$/, // View DTOs (display models)
  /Display(Dto|DTO)$/, // Display DTOs
  /Model(Dto|DTO)$/, // Model DTOs (often response mappings)
];

/**
 * Checks if a class has a static factory method that converts from an entity.
 * DTOs with `toXxxDto(entity)` or `fromEntity(entity)` static methods are response DTOs.
 */
function hasStaticFactoryMethod(stmt: ts.ClassDeclaration): boolean {
  const className = stmt.name?.text ?? '';

  for (const member of stmt.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    if (!ts.isIdentifier(member.name)) continue;

    // Check if it's a static method
    const isStatic = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
    if (!isStatic) continue;

    const methodName = member.name.text;

    // Pattern 1: toXxxDto() - converts to this DTO type (e.g., toAssociateEntityDto)
    if (methodName.startsWith('to') && (methodName.endsWith('Dto') || methodName.endsWith('DTO'))) {
      return true;
    }

    // Pattern 2: fromEntity(), fromXxx() - creates from entity/source
    if (methodName.startsWith('from')) {
      return true;
    }

    // Pattern 3: toDto() - generic converter
    if (methodName === 'toDto' || methodName === 'toDTO') {
      return true;
    }

    // Pattern 4: create() with entity parameter (factory pattern)
    if (methodName === 'create' && member.parameters.length > 0) {
      const firstParam = member.parameters[0];
      const paramType = firstParam.type?.getText();
      if (paramType && /Entity$/.test(paramType)) {
        return true;
      }
    }

    // Pattern 5: Method name matches class name pattern (toClassNameDto)
    // e.g., AssociateEntityDto has toAssociateEntityDto
    if (className && methodName.toLowerCase() === `to${className.toLowerCase()}`) {
      return true;
    }

    // Pattern 6: of() factory method (common pattern for value objects/DTOs)
    if (methodName === 'of' && member.parameters.length > 0) {
      return true;
    }

    // Pattern 7: map() or transform() - transformation methods
    if (methodName === 'map' || methodName === 'transform' || methodName === 'mapFrom') {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a property has a custom class-validator decorator (created via registerDecorator).
 * Custom decorators don't appear in CLASS_VALIDATOR_DECORATORS but are valid validators.
 */
function hasCustomValidatorDecorator(member: ts.PropertyDeclaration, _sf: ts.SourceFile): boolean {
  const decorators = getDecorators(member);

  for (const d of decorators) {
    const name = getDecoratorName(d);
    if (!name) continue;

    // Skip known non-validator decorators
    if (
      name === 'ApiProperty' ||
      name === 'ApiPropertyOptional' ||
      name === 'ApiResponseProperty'
    ) {
      continue;
    }

    // Check if decorator name suggests it's a custom validator
    // Custom validators often start with "Is", "Has", "Validate", "Check", etc.
    if (
      name.startsWith('Is') ||
      name.startsWith('Has') ||
      name.startsWith('Validate') ||
      name.startsWith('Check') ||
      name.startsWith('Must')
    ) {
      return true;
    }

    // If it's a decorator call that's not a known Swagger decorator, assume it might be a validator
    // This is a heuristic to catch custom validators like @HasAtLeastOneField
    if (ts.isCallExpression(d.expression)) {
      // If it takes validation-like arguments (message, groups, etc.), likely a validator
      const args = d.expression.arguments;
      for (const arg of args) {
        if (ts.isObjectLiteralExpression(arg)) {
          for (const prop of arg.properties) {
            if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
              if (
                prop.name.text === 'message' ||
                prop.name.text === 'groups' ||
                prop.name.text === 'each'
              ) {
                return true;
              }
            }
          }
        }
      }
    }
  }

  return false;
}

/**
 * Checks if a decorator has a `readOnly: true` property in its arguments.
 * Used to detect `@ApiProperty({ readOnly: true })` patterns.
 */
function hasReadOnlyTrue(decorator: ts.Decorator): boolean {
  if (!ts.isCallExpression(decorator.expression)) return false;

  for (const arg of decorator.expression.arguments) {
    if (!ts.isObjectLiteralExpression(arg)) continue;

    for (const prop of arg.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      if (!ts.isIdentifier(prop.name)) continue;

      if (prop.name.text === 'readOnly' && prop.initializer.kind === ts.SyntaxKind.TrueKeyword) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true if the property has `@ApiProperty({ readOnly: true })` or similar,
 * indicating it's an output-only property that doesn't need input validation.
 */
function isReadOnlyApiProperty(member: ts.PropertyDeclaration): boolean {
  const decorators = getDecorators(member);
  for (const d of decorators) {
    const name = getDecoratorName(d);
    if ((name === 'ApiProperty' || name === 'ApiPropertyOptional') && hasReadOnlyTrue(d)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the class implements Partial<Something>, which is a common
 * pattern for response/mapping DTOs that are derived from entities.
 */
function implementsPartial(stmt: ts.ClassDeclaration): boolean {
  if (!stmt.heritageClauses) return false;

  for (const clause of stmt.heritageClauses) {
    if (clause.token !== ts.SyntaxKind.ImplementsKeyword) continue;
    for (const typeExpr of clause.types) {
      const typeText = typeExpr.getText();
      if (typeText.startsWith('Partial<')) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Returns true if the class has no decorators on any property.
 * These are typically internal DTOs used for data mapping, not API input.
 */
function hasNoPropertyDecorators(stmt: ts.ClassDeclaration): boolean {
  const members = stmt.members.filter(ts.isPropertyDeclaration);
  if (members.length === 0) return false;

  for (const member of members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    const decorators = getDecorators(member);
    if (decorators.length > 0) return false;
  }
  return true;
}

/**
 * Returns true if the class has @ApiResponseProperty on ANY property,
 * which explicitly marks it as a response DTO.
 */
function hasApiResponsePropertyDecorator(stmt: ts.ClassDeclaration): boolean {
  const members = stmt.members.filter(ts.isPropertyDeclaration);

  for (const member of members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    const decorators = getDecorators(member);

    for (const d of decorators) {
      const name = getDecoratorName(d);
      if (name === 'ApiResponseProperty') {
        return true;
      }
    }
  }

  return false;
}

/**
 * Class name patterns that indicate INPUT DTOs (need validation).
 * These should NOT be treated as response DTOs even if they lack validation decorators.
 */
const INPUT_DTO_NAME_PATTERNS = [
  /^Create[A-Z]/,
  /^Update[A-Z]/,
  /^Patch[A-Z]/,
  /^Delete[A-Z]/,
  /^Add[A-Z]/,
  /^Remove[A-Z]/,
  /^Set[A-Z]/,
  /Request(Dto|DTO)$/,
  /Input(Dto|DTO)$/,
  /Params(Dto|DTO)$/,
  /Query(Dto|DTO)$/,
  /Body(Dto|DTO)$/,
];

/**
 * Returns true if the class name suggests it's an INPUT DTO.
 */
function isInputDtoName(className: string): boolean {
  return INPUT_DTO_NAME_PATTERNS.some((pattern) => pattern.test(className));
}

/**
 * Returns true if the class has NO class-validator decorators on ANY property
 * AND the class name doesn't suggest it's an input DTO.
 *
 * A DTO is considered a response DTO if:
 * - It has Swagger decorators (ApiProperty/ApiPropertyOptional)
 * - It has NO class-validator decorators
 * - Its name doesn't match input DTO patterns (Create*, Update*, *RequestDto, etc.)
 * - It either has NO readOnly markers (pure response) OR ALL properties are readOnly
 *
 * If some properties have readOnly:true and others don't, it's a mixed DTO
 * and we should NOT skip validation checks.
 */
function hasNoValidationDecorators(stmt: ts.ClassDeclaration): boolean {
  const className = stmt.name?.text ?? '';
  const members = stmt.members.filter(ts.isPropertyDeclaration);
  if (members.length === 0) return false;

  // If the class name suggests it's an input DTO, don't skip validation
  if (isInputDtoName(className)) {
    return false;
  }

  let hasAnySwaggerDecorator = false;
  let hasAnyReadOnlyProperty = false;
  let hasAnyNonReadOnlyProperty = false;

  for (const member of members) {
    if (!ts.isPropertyDeclaration(member)) continue;
    const decorators = getDecorators(member);

    // Check if property has TypeScript readonly modifier
    const hasTsReadonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);

    for (const d of decorators) {
      const name = getDecoratorName(d);
      if (!name) continue;

      // Check for any class-validator decorator
      if (CLASS_VALIDATOR_DECORATORS.has(name)) {
        return false; // Has validation decorators, not a pure response DTO
      }

      // Track Swagger decorators and readOnly status
      if (
        name === 'ApiProperty' ||
        name === 'ApiPropertyOptional' ||
        name === 'ApiResponseProperty' ||
        name === 'ApiHideProperty'
      ) {
        hasAnySwaggerDecorator = true;

        // Check if decorator has readOnly: true
        if (hasReadOnlyTrue(d) || hasTsReadonly) {
          hasAnyReadOnlyProperty = true;
        } else if (name !== 'ApiHideProperty' && name !== 'ApiResponseProperty') {
          // ApiProperty or ApiPropertyOptional without readOnly
          hasAnyNonReadOnlyProperty = true;
        }
      }
    }
  }

  // If there are no Swagger decorators, this check doesn't apply
  if (!hasAnySwaggerDecorator) return false;

  // If there's a mix of readOnly and non-readOnly properties, it's a mixed DTO
  // and we should NOT skip validation (non-readOnly properties might need it)
  if (hasAnyReadOnlyProperty && hasAnyNonReadOnlyProperty) {
    return false;
  }

  // Pure response DTO: has Swagger decorators, no validation decorators,
  // and either all properties are readOnly or none are marked specially
  return true;
}

/**
 * Returns true if the class appears to be a response-only DTO.
 *
 * A class is considered a response DTO if any of:
 * 1. Any property has @ApiResponseProperty decorator
 * 2. Class name matches response patterns (ResponseDto, ResultDto, etc.)
 * 3. All properties are readonly (indicates immutable output type)
 * 4. Has an 'id' property with only @ApiProperty (entity mapping pattern)
 * 5. All properties have `readOnly: true` in their @ApiProperty decorator
 * 6. Implements Partial<Entity> (entity mapping pattern)
 * 7. Has no decorators on any property (internal DTO, not API input)
 * 8. Has a static factory method (toXxxDto, fromEntity, etc.)
 * 9. Has only Swagger decorators and no validation decorators
 */
function isResponseDto(stmt: ts.ClassDeclaration): boolean {
  const className = stmt.name?.text ?? '';
  const members = stmt.members.filter(ts.isPropertyDeclaration);
  if (members.length === 0) return false;

  // Check class name patterns
  if (RESPONSE_DTO_NAME_PATTERNS.some((pattern) => pattern.test(className))) {
    return true;
  }

  // Check if it has a static factory method (toXxxDto, fromEntity, etc.)
  // DTOs with these methods are typically response/output DTOs
  if (hasStaticFactoryMethod(stmt)) {
    return true;
  }

  // Check if it implements Partial<Entity> - common response/mapping pattern
  if (implementsPartial(stmt)) {
    return true;
  }

  // Check if it has no decorators at all - internal DTO not exposed via API
  if (hasNoPropertyDecorators(stmt)) {
    return true;
  }

  // Check if it has @ApiResponseProperty on any property - explicit response DTO marker
  if (hasApiResponsePropertyDecorator(stmt)) {
    return true;
  }

  // Check if it has ONLY Swagger decorators and NO validation decorators
  // This is a strong indicator of a response-only DTO
  if (hasNoValidationDecorators(stmt)) {
    return true;
  }

  let hasApiResponseProperty = false;
  let hasIdWithApiProperty = false;
  let allPropertiesReadonly = true;
  let readonlyCount = 0;
  let allPropertiesReadOnlyApi = true;
  let readOnlyApiCount = 0;

  for (const member of members) {
    if (!ts.isPropertyDeclaration(member)) continue;

    const decorators = getDecorators(member);
    const propName = ts.isIdentifier(member.name) ? member.name.text : '';

    // Check for @ApiResponseProperty
    for (const d of decorators) {
      const name = getDecoratorName(d);
      if (name === 'ApiResponseProperty') {
        hasApiResponseProperty = true;
      }
    }

    // Check for readonly modifier
    const isReadonly = member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword);
    if (isReadonly) {
      readonlyCount++;
    } else {
      allPropertiesReadonly = false;
    }

    // Check for @ApiProperty({ readOnly: true })
    if (isReadOnlyApiProperty(member)) {
      readOnlyApiCount++;
    } else {
      allPropertiesReadOnlyApi = false;
    }

    // Check for 'id' property with @ApiProperty (common entity mapping pattern)
    if (propName === 'id') {
      const hasApiProperty = decorators.some((d) => {
        const name = getDecoratorName(d);
        return name === 'ApiProperty' || name === 'ApiPropertyOptional';
      });
      const hasValidation = decorators.some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && CLASS_VALIDATOR_DECORATORS.has(name);
      });
      if (hasApiProperty && !hasValidation) {
        hasIdWithApiProperty = true;
      }
    }
  }

  // Response DTO if:
  // - Has @ApiResponseProperty
  // - All properties are readonly (and has at least 2 properties)
  // - Has 'id' property with @ApiProperty but no validation (entity mapping)
  // - All properties have readOnly: true in @ApiProperty
  return (
    hasApiResponseProperty ||
    (allPropertiesReadonly && readonlyCount >= 2) ||
    hasIdWithApiProperty ||
    (allPropertiesReadOnlyApi && readOnlyApiCount >= 2)
  );
}

/**
 * **Rule `missing-class-validator`** (security / warning)
 *
 * Flags DTO properties that lack class-validator decorator annotations.
 * Without validation decorators, user input passes through unchecked even
 * when a global ValidationPipe is configured.
 *
 * This rule checks classes ending with `Dto` or `DTO` and reports properties
 * that have no class-validator decorators. Properties with `@IsOptional()`
 * are considered valid (explicitly marked as optional).
 *
 * The following are excluded since they represent outbound data:
 * - Response DTOs (using `@ApiResponseProperty` or matching response name patterns)
 * - Properties with `@ApiProperty({ readOnly: true })` (output-only properties)
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkMissingClassValidator(
  sf: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
): void {
  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;
    const className = stmt.name?.text ?? '';
    if (!className.endsWith('Dto') && !className.endsWith('DTO')) continue;

    // Skip response DTOs - they don't need input validation
    if (isResponseDto(stmt)) continue;

    for (const member of stmt.members) {
      if (!ts.isPropertyDeclaration(member)) continue;
      if (!ts.isIdentifier(member.name)) continue;

      // Skip properties marked as readOnly - they're output-only
      if (isReadOnlyApiProperty(member)) continue;

      const propName = member.name.text;
      const decorators = getDecorators(member);

      // Check if property has any class-validator decorator
      const hasValidatorDecorator = decorators.some((d) => {
        const name = getDecoratorName(d);
        return name !== undefined && CLASS_VALIDATOR_DECORATORS.has(name);
      });

      // Also check for custom validator decorators (created via registerDecorator)
      const hasCustomValidator = hasCustomValidatorDecorator(member, sf);

      if (!hasValidatorDecorator && !hasCustomValidator) {
        ctx.report({
          filePath,
          message: `Property '${propName}' in DTO '${className}' has no validation decorators`,
          line: getLine(sf, member),
          column: getColumn(sf, member),
        });
      }
    }
  }
}
