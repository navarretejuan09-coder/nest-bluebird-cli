import ts from 'typescript';
import type { RuleContext } from '../types.js';
import {
  checkNoHardcodedDependency,
  checkNoGodController,
  checkNoGodService,
} from './architecture.js';
import {
  checkNoHardcodedSecrets,
  checkMissingValidationPipe,
  checkNoAnyInDto,
  checkNoRawSql,
  checkMissingCsrfProtection,
  checkMissingRateLimiting,
  checkMissingGlobalGuard,
  checkMissingHelmet,
  checkMissingClassValidator,
} from './security.js';
import {
  checkMissingInjectable,
  checkLifecycleHookInterface,
  checkNoConstructorSideEffects,
  checkNoNestedControllerDecorator,
  checkNoConsoleLog,
  checkNoProcessEnvDirect,
  checkMissingExceptionFilter,
  checkMissingParsePipe,
  checkMissingResolverDecorator,
  checkMissingMessagePattern,
  checkMissingWebsocketDecorator,
  checkMissingConfigValidation,
} from './correctness.js';
import {
  checkMissingSwaggerDecorators,
  checkNoEntityAsResponse,
  checkNoInconsistentHttpStatus,
  checkPreferPagination,
  checkNoGenericException,
} from './api-design.js';
import {
  checkNoSyncFsOperations,
  checkNoBlockingCrypto,
  checkMissingCaching,
  checkNoNPlusOne,
} from './performance.js';
import { checkMissingIndexes, checkMissingMigration } from './database.js';
import { checkLowTestCoverage } from './testing.js';
import { checkNoCircularDependency, checkNoDuplicateRoute } from './graph-rules.js';

/**
 * A file-level rule checker operates on a single parsed TypeScript source
 * file and reports violations via `ctx.report()`.
 *
 * @param sourceFile - The parsed {@link ts.SourceFile} to analyse.
 * @param filePath   - The file's path, forwarded into diagnostic messages.
 * @param ctx        - Provides project metadata and the `report` callback.
 */
export type FileRuleChecker = (
  sourceFile: ts.SourceFile,
  filePath: string,
  ctx: RuleContext
) => void;

/**
 * A graph-level rule checker operates across **all** parsed source files in
 * the project simultaneously, enabling cross-file analysis such as circular
 * dependency detection or duplicate route detection.
 *
 * @param sourceFiles - Map of file-path to parsed {@link ts.SourceFile}.
 * @param ctx         - Provides project metadata and the `report` callback.
 */
export type GraphRuleChecker = (
  sourceFiles: ReadonlyMap<string, ts.SourceFile>,
  ctx: RuleContext
) => void;

/**
 * Registry of all 36 file-level (single-file) rule checkers, keyed by rule
 * ID.  The orchestrator iterates enabled rules and calls the corresponding
 * checker for every source file in the project.
 */
export const fileCheckers: ReadonlyMap<string, FileRuleChecker> = new Map<string, FileRuleChecker>([
  // Architecture
  ['no-hardcoded-dependency', checkNoHardcodedDependency],
  ['no-god-controller', checkNoGodController],
  ['no-god-service', checkNoGodService],
  // Security (deterministic)
  ['no-hardcoded-secrets', checkNoHardcodedSecrets],
  ['missing-validation-pipe', checkMissingValidationPipe],
  ['no-any-in-dto', checkNoAnyInDto],
  ['no-raw-sql', checkNoRawSql],
  ['missing-class-validator', checkMissingClassValidator],
  // Security (heuristic)
  ['missing-csrf-protection', checkMissingCsrfProtection],
  ['missing-rate-limiting', checkMissingRateLimiting],
  ['missing-global-guard', checkMissingGlobalGuard],
  ['missing-helmet', checkMissingHelmet],
  // Correctness
  ['missing-injectable', checkMissingInjectable],
  ['lifecycle-hook-interface', checkLifecycleHookInterface],
  ['no-constructor-side-effects', checkNoConstructorSideEffects],
  ['no-nested-controller-decorator', checkNoNestedControllerDecorator],
  ['no-console-log', checkNoConsoleLog],
  ['no-process-env-direct', checkNoProcessEnvDirect],
  ['missing-exception-filter', checkMissingExceptionFilter],
  ['missing-parse-pipe', checkMissingParsePipe],
  // API Design
  ['missing-swagger-decorators', checkMissingSwaggerDecorators],
  ['no-entity-as-response', checkNoEntityAsResponse],
  ['no-inconsistent-http-status', checkNoInconsistentHttpStatus],
  ['prefer-pagination', checkPreferPagination],
  ['no-generic-exception', checkNoGenericException],
  // Performance
  ['no-sync-fs-operations', checkNoSyncFsOperations],
  ['no-blocking-crypto', checkNoBlockingCrypto],
  ['missing-caching', checkMissingCaching],
  ['no-n-plus-one', checkNoNPlusOne],
  // Database
  ['missing-indexes', checkMissingIndexes],
  ['missing-migration', checkMissingMigration],
  // Testing
  ['low-test-coverage', checkLowTestCoverage],
  // GraphQL (feature-gated)
  ['missing-resolver-decorator', checkMissingResolverDecorator],
  // Microservices (feature-gated)
  ['missing-message-pattern', checkMissingMessagePattern],
  // WebSockets (feature-gated)
  ['missing-websocket-decorator', checkMissingWebsocketDecorator],
  // Config (feature-gated)
  ['missing-config-validation', checkMissingConfigValidation],
]);

/**
 * Registry of the 2 graph-level (cross-file) rule checkers, keyed by rule
 * ID.  These receive the full set of parsed source files and perform project-
 * wide analysis (module dependency cycles, duplicate route detection).
 */
export const graphCheckers: ReadonlyMap<string, GraphRuleChecker> = new Map<
  string,
  GraphRuleChecker
>([
  ['no-circular-dependency', checkNoCircularDependency],
  ['no-duplicate-route', checkNoDuplicateRoute],
]);
