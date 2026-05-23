import type { ProjectInfo, RuleCategory, RuleConfidence, RuleMeta } from '../types.js';

function deepFreezeRules(rules: RuleMeta[]): readonly Readonly<RuleMeta>[] {
  for (const rule of rules) Object.freeze(rule);
  return Object.freeze(rules);
}

const allRules = deepFreezeRules([
  // ── Architecture ──────────────────────────────────────────────────────
  {
    id: 'no-hardcoded-dependency',
    category: 'architecture',
    severity: 'error',
    confidence: 'deterministic',
    description: 'Direct instantiation (`new ServiceClass()`) instead of dependency injection',
    help: 'Inject the dependency via constructor injection and register it as a provider in the module.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-god-controller',
    category: 'architecture',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Controller exceeds route count threshold',
    help: 'Split the controller into smaller, domain-focused controllers.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-god-service',
    category: 'architecture',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Service exceeds line count threshold',
    help: 'Extract responsibilities into separate services and compose them via DI.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-circular-dependency',
    category: 'architecture',
    severity: 'error',
    confidence: 'deterministic',
    description: 'Circular module imports detected',
    help: 'Break the cycle by extracting shared logic into a separate module or using forwardRef().',
    analysisPass: 'graph',
  },

  // ── Security ──────────────────────────────────────────────────────────
  {
    id: 'no-hardcoded-secrets',
    category: 'security',
    severity: 'error',
    confidence: 'deterministic',
    description: 'Hardcoded secret or credential detected in source code',
    help: 'Move secrets to environment variables and access them via ConfigService.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-validation-pipe',
    category: 'security',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'No global ValidationPipe configured in application bootstrap',
    help: 'Add `app.useGlobalPipes(new ValidationPipe())` in main.ts or register it as a global provider.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-any-in-dto',
    category: 'security',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'DTO class or property typed as `any`',
    help: 'Replace `any` with a concrete type so class-validator can enforce constraints.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-raw-sql',
    category: 'security',
    severity: 'error',
    confidence: 'deterministic',
    description: 'Raw SQL string template without parameterization',
    help: 'Use parameterized queries or the ORM query builder to prevent SQL injection.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-class-validator',
    category: 'security',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'DTO property without class-validator decorators',
    help: 'Add validation decorators (@IsString, @IsNumber, etc.) to enforce input constraints.',
    analysisPass: 'eslint',
  },

  // ── Correctness ───────────────────────────────────────────────────────
  {
    id: 'missing-injectable',
    category: 'correctness',
    severity: 'error',
    confidence: 'deterministic',
    description: 'Class used as provider without @Injectable() decorator',
    help: 'Add the @Injectable() decorator to the class.',
    analysisPass: 'eslint',
  },
  {
    id: 'lifecycle-hook-interface',
    category: 'correctness',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Lifecycle method implemented without the corresponding interface',
    help: 'Add `implements OnModuleInit` (or the appropriate interface) to the class declaration.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-duplicate-route',
    category: 'correctness',
    severity: 'error',
    confidence: 'deterministic',
    description: 'Duplicate HTTP method + path across handlers',
    help: 'Rename or re-path one of the conflicting route handlers.',
    analysisPass: 'graph',
  },
  {
    id: 'no-constructor-side-effects',
    category: 'correctness',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Side effects (HTTP calls, file I/O, console.log) in constructor',
    help: 'Move initialization logic to onModuleInit() or a dedicated method.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-nested-controller-decorator',
    category: 'correctness',
    severity: 'error',
    confidence: 'deterministic',
    description: '@Controller() applied to a non-top-level class',
    help: 'Move the controller to the top level of the module file.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-console-log',
    category: 'correctness',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Direct console.log usage instead of NestJS Logger service',
    help: 'Inject and use the NestJS Logger service for consistent, configurable logging.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-process-env-direct',
    category: 'correctness',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Direct process.env access instead of ConfigService',
    help: 'Use ConfigService.get() for type-safe, validated configuration access.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-exception-filter',
    category: 'correctness',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'No global exception filter configured in application bootstrap',
    help: 'Add app.useGlobalFilters() or register APP_FILTER provider for consistent error handling.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-parse-pipe',
    category: 'correctness',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Route parameter without parsing pipe (ParseIntPipe, ParseUUIDPipe, etc.)',
    help: 'Add a parsing pipe like ParseIntPipe to validate and convert route parameters.',
    analysisPass: 'eslint',
  },

  // ── API Design ────────────────────────────────────────────────────────
  {
    id: 'missing-swagger-decorators',
    category: 'api-design',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Endpoint missing @ApiOperation or @ApiResponse decorators',
    help: "Add @ApiOperation({ summary: '...' }) and a response decorator (@ApiResponse, @ApiOkResponse, @ApiCreatedResponse, etc.) to the handler.",
    analysisPass: 'eslint',
    enabledWhen: (project) => project.features.swagger,
  },
  {
    id: 'no-entity-as-response',
    category: 'api-design',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'ORM entity class returned directly from controller method',
    help: 'Map the entity to a DTO or response class before returning.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-inconsistent-http-status',
    category: 'api-design',
    severity: 'warning',
    confidence: 'heuristic',
    description:
      'HTTP status code inconsistent with method semantics (e.g. @Post returning 200 instead of 201)',
    help: 'Use the correct @HttpCode() decorator to match the HTTP method semantics, or waive if the project intentionally diverges.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.strictTypeScript,
  },
  {
    id: 'no-generic-exception',
    category: 'api-design',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Throwing generic Error instead of NestJS HttpException',
    help: 'Use NestJS exceptions (BadRequestException, NotFoundException, etc.) for proper HTTP status codes. Background processors (@Processor) are excluded.',
    analysisPass: 'eslint',
  },

  // ── Performance ───────────────────────────────────────────────────────
  {
    id: 'no-sync-fs-operations',
    category: 'performance',
    severity: 'warning',
    confidence: 'deterministic',
    description:
      'Synchronous filesystem operation (readFileSync, writeFileSync, etc.) in non-CLI code',
    help: 'Use the async equivalent (fs.promises.*) to avoid blocking the event loop.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-blocking-crypto',
    category: 'performance',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Blocking crypto operation (pbkdf2Sync, scryptSync) in request path',
    help: 'Use the async variant (crypto.pbkdf2, crypto.scrypt) to avoid blocking the event loop.',
    analysisPass: 'eslint',
  },

  // ── Heuristic / Policy (v2+, opt-in) ─────────────────────────────────
  {
    id: 'missing-caching',
    category: 'performance',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'Cache module detected but no @Cacheable or @CacheKey usage found',
    help: 'Use @Cacheable() or CacheInterceptor on frequently accessed endpoints.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.features.cache,
  },
  {
    id: 'missing-indexes',
    category: 'database',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'Query patterns without matching database indexes',
    help: 'Add database indexes for columns used in WHERE clauses and JOIN conditions.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-migration',
    category: 'database',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'Schema changes without corresponding migration files',
    help: 'Generate a migration to capture the schema change for safe deployment.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-csrf-protection',
    category: 'security',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'No CSRF protection middleware configured',
    help: 'Add CSRF protection if the application uses session-based authentication.',
    analysisPass: 'eslint',
  },
  {
    id: 'low-test-coverage',
    category: 'testing',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'Missing spec files for providers or controllers',
    help: 'Add .spec.ts test files for critical services and controllers.',
    analysisPass: 'eslint',
  },
  {
    id: 'no-n-plus-one',
    category: 'performance',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'Potential N+1 query pattern detected',
    help: 'Use eager loading, joins, or batch queries to avoid N+1 query patterns.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-rate-limiting',
    category: 'security',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'No rate limiting / throttling configured',
    help: 'Add @nestjs/throttler to protect endpoints from abuse.',
    analysisPass: 'eslint',
  },
  {
    id: 'prefer-pagination',
    category: 'api-design',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'Unbounded list endpoint without pagination',
    help: 'Add pagination parameters (limit/offset or cursor) to list endpoints.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.sourceFileCount >= 50,
  },
  {
    id: 'missing-global-guard',
    category: 'security',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'No global authentication guard configured',
    help: 'Register an auth guard globally or document the intentional per-route strategy.',
    analysisPass: 'eslint',
  },
  {
    id: 'missing-helmet',
    category: 'security',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'No helmet middleware for security headers',
    help: 'Add helmet middleware for secure HTTP headers (unless this is an API-only service behind a gateway).',
    analysisPass: 'eslint',
  },

  // ── GraphQL ────────────────────────────────────────────────────────────
  {
    id: 'missing-resolver-decorator',
    category: 'graphql',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Method in @Resolver class without @Query/@Mutation/@Subscription decorator',
    help: 'Add a GraphQL operation decorator to expose the method in the schema, or make it private.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.features.graphql,
  },

  // ── Microservices ──────────────────────────────────────────────────────
  {
    id: 'missing-message-pattern',
    category: 'microservices',
    severity: 'warning',
    confidence: 'deterministic',
    description:
      'Method in microservice controller without @MessagePattern/@EventPattern decorator',
    help: 'Add a message pattern decorator to handle incoming messages, or make the method private.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.features.microservices,
  },

  // ── WebSockets ─────────────────────────────────────────────────────────
  {
    id: 'missing-websocket-decorator',
    category: 'websockets',
    severity: 'warning',
    confidence: 'deterministic',
    description: 'Method in @WebSocketGateway without @SubscribeMessage decorator',
    help: 'Add @SubscribeMessage to handle client messages, or make the method private.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.features.websockets,
  },

  // ── Additional Correctness (heuristic) ─────────────────────────────────
  {
    id: 'missing-config-validation',
    category: 'correctness',
    severity: 'warning',
    confidence: 'heuristic',
    description: 'ConfigModule.forRoot() without validation schema',
    help: 'Add validationSchema or validate option to catch configuration errors at startup.',
    analysisPass: 'eslint',
    enabledWhen: (project) => project.features.config,
  },
]);

const ruleMap = new Map<string, Readonly<RuleMeta>>(allRules.map((r) => [r.id, r]));

/**
 * Returns the complete set of registered rules (deterministic and heuristic).
 *
 * The returned array and its elements are deeply frozen; the same reference is
 * returned on every call so callers can safely use referential equality checks.
 */
export function getAllRules(): readonly Readonly<RuleMeta>[] {
  return allRules;
}

/**
 * Looks up a single rule by its unique identifier.
 *
 * @param id - The rule identifier (e.g. `"no-hardcoded-dependency"`).
 * @returns The matching rule, or `undefined` if no rule with that id exists.
 */
export function getRuleById(id: string): Readonly<RuleMeta> | undefined {
  return ruleMap.get(id);
}

/**
 * Returns all rules belonging to a given category.
 *
 * @param category - The {@link RuleCategory} to filter by (e.g. `"security"`).
 */
export function getRulesByCategory(category: RuleCategory): readonly Readonly<RuleMeta>[] {
  return allRules.filter((r) => r.category === category);
}

/**
 * Returns all rules matching a given confidence tier.
 *
 * @param confidence - `"deterministic"` for statically provable rules,
 *                     `"heuristic"` for context-dependent / higher-false-positive rules.
 */
export function getRulesByConfidence(confidence: RuleConfidence): readonly Readonly<RuleMeta>[] {
  return allRules.filter((r) => r.confidence === confidence);
}

/**
 * Returns the rules that should be active for a given project.
 *
 * Filtering logic:
 * - Heuristic rules are excluded unless {@link includeHeuristic} is `true`.
 * - Rules with an `enabledWhen` predicate are excluded when the predicate
 *   returns `false` for the supplied project (e.g. Swagger rules are skipped
 *   when `@nestjs/swagger` is not detected).
 *
 * This function answers *"which rules apply to this project?"* — it does **not**
 * filter by analysis pass. Pass selection (ESLint / graph / knip) is handled by
 * the scan orchestrator.
 *
 * @param project - Detected project metadata used to evaluate `enabledWhen` predicates.
 * @param includeHeuristic - When `true`, heuristic-confidence rules are included
 *                           in the result. Defaults to `false`.
 */
export function getEnabledRules(
  project: ProjectInfo,
  includeHeuristic = false
): readonly Readonly<RuleMeta>[] {
  return allRules.filter((r) => {
    if (!includeHeuristic && r.confidence === 'heuristic') return false;
    if (r.enabledWhen && !r.enabledWhen(project)) return false;
    return true;
  });
}
