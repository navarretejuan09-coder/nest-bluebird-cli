import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import type { RuleViolation, RuleContext, ProjectInfo } from '../src/types.js';
import {
  checkNoHardcodedDependency,
  checkNoGodController,
  checkNoGodService,
} from '../src/rules/architecture.js';
import {
  checkNoHardcodedSecrets,
  checkMissingValidationPipe,
  checkNoAnyInDto,
  checkNoRawSql,
  checkMissingClassValidator,
} from '../src/rules/security.js';
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
} from '../src/rules/correctness.js';
import {
  checkMissingSwaggerDecorators,
  checkNoEntityAsResponse,
  checkNoInconsistentHttpStatus,
  checkNoGenericException,
} from '../src/rules/api-design.js';
import {
  checkNoSyncFsOperations,
  checkNoBlockingCrypto,
  checkMissingCaching,
  checkNoNPlusOne,
} from '../src/rules/performance.js';
import { checkMissingIndexes, checkMissingMigration } from '../src/rules/database.js';
import { checkNoCircularDependency, checkNoDuplicateRoute } from '../src/rules/graph-rules.js';
import { fileCheckers, graphCheckers } from '../src/rules/checkers.js';
import {
  getAllRules,
  getRuleById,
  getRulesByCategory,
  getRulesByConfidence,
  getEnabledRules,
} from '../src/rules/index.js';

function parse(code: string, fileName = 'test.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    nestVersion: '10.0.0',
    httpAdapter: 'express',
    orm: 'none',
    strictTypeScript: true,
    hasTests: true,
    sourceFileCount: 50,
    features: {
      graphql: false,
      websockets: false,
      microservices: false,
      cqrs: false,
      swagger: true,
      bull: false,
      config: false,
      throttler: false,
      cache: false,
    },
    ...overrides,
  };
}

function makeCtx(violations: RuleViolation[]): RuleContext {
  return {
    project: makeProject(),
    report: (v) => violations.push(v),
  };
}

// ── Checker registry ─────────────────────────────────────────────────

describe('checker registry', () => {
  it('has a file checker for every eslint-pass rule with a checker', () => {
    const expectedFileCheckers = [
      'no-hardcoded-dependency',
      'no-god-controller',
      'no-god-service',
      'no-hardcoded-secrets',
      'missing-validation-pipe',
      'no-any-in-dto',
      'no-raw-sql',
      'missing-injectable',
      'lifecycle-hook-interface',
      'no-constructor-side-effects',
      'no-nested-controller-decorator',
      'missing-swagger-decorators',
      'no-entity-as-response',
      'no-inconsistent-http-status',
      'no-sync-fs-operations',
      'no-blocking-crypto',
    ];

    for (const id of expectedFileCheckers) {
      expect(fileCheckers.has(id), `missing file checker: ${id}`).toBe(true);
    }
  });

  it('has a graph checker for every graph-pass rule', () => {
    expect(graphCheckers.has('no-circular-dependency')).toBe(true);
    expect(graphCheckers.has('no-duplicate-route')).toBe(true);
  });

  it('total checkers = 36 file + 2 graph = 38', () => {
    expect(fileCheckers.size).toBe(36);
    expect(graphCheckers.size).toBe(2);
  });
});

// ── Architecture rules ───────────────────────────────────────────────

describe('no-hardcoded-dependency', () => {
  it('flags new ServiceClass()', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        class AppController {
          handle() {
            const svc = new UserService();
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('UserService');
  });

  it('flags new XRepository()', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const repo = new OrderRepository();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('OrderRepository');
  });

  it('does not flag new Error()', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`throw new Error("fail");`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag new Date()', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const now = new Date();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag new ValidationPipe()', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`app.useGlobalPipes(new ValidationPipe());`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag classes without provider suffixes', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const dto = new CreateUserDto();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag AWS SDK clients', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const client = new SNSClient({});`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag DynamoDBClient', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`const client = new DynamoDBClient({ region: 'us-east-1' });`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag S3Client', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const s3 = new S3Client({});`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag SendGrid Client', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const client = new Client();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag SendGrid MailService', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const mail = new MailService();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag OpenTelemetry LoggerProvider', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`const logger = new LoggerProvider();`),
      'src/instrumentation.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag OpenTelemetry NodeSDK', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(`const sdk = new NodeSDK();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag OpenTelemetry TracerProvider', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`const tracer = new TracerProvider();`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag provider instantiation inside a useFactory helper function', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        const createClient = (config: ConfigService) => new DocumentStoreClient(config);

        @Module({
          providers: [
            {
              provide: 'DOCUMENT_STORE',
              useFactory: createClient,
              inject: [ConfigService],
            },
          ],
        })
        class DocumentStoreModule {}
      `),
      'src/document-store/document-store.module.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag provider instantiation inside a static method used by useFactory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        class FactoryProvider {
          static create(config: ConfigService) {
            return new SearchClient(config);
          }
        }

        @Module({
          providers: [
            {
              provide: 'SEARCH_CLIENT',
              useFactory: FactoryProvider.create,
              inject: [ConfigService],
            },
          ],
        })
        class SearchModule {}
      `),
      'src/search/search.module.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag provider instantiation inside method-style useFactory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        @Module({
          providers: [
            {
              provide: 'SEARCH_CLIENT',
              useFactory(config: ConfigService) {
                return new SearchClient(config);
              },
              inject: [ConfigService],
            },
          ],
        })
        class SearchModule {}
      `),
      'src/search/search.module.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags provider instantiation in unrelated helper functions', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        const buildClient = (config: ConfigService) => new SearchClient(config);

        @Module({
          providers: [
            {
              provide: 'SEARCH_CLIENT',
              useFactory: () => ({ connected: true }),
            },
          ],
        })
        class SearchModule {}
      `),
      'src/search/search.module.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('SearchClient');
  });
});

describe('no-hardcoded-dependency (test file exclusion)', () => {
  const violatingCode = `const svc = new UserService();`;

  it('skips .spec.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.spec.ts'), 'foo.spec.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.test.ts'), 'foo.test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in __tests__ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/__tests__/foo.ts'),
      'src/__tests__/foo.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in test/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'test/foo.ts'), 'test/foo.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in cypress/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'cypress/e2e/app.ts'),
      'cypress/e2e/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips .spec.js files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.spec.js'), 'foo.spec.js', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .spec.mts files (ES module TypeScript)', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.spec.mts'), 'foo.spec.mts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.mts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.test.mts'), 'foo.test.mts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .spec.cts files (CommonJS TypeScript)', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.spec.cts'), 'foo.spec.cts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.cts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'foo.test.cts'), 'foo.test.cts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in e2e/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(parse(violatingCode, 'e2e/app.ts'), 'e2e/app.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in fixtures/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/fixtures/mock-service.ts'),
      'src/fixtures/mock-service.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in mocks/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/mocks/services.ts'),
      'src/mocks/services.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips instrumentation files (OpenTelemetry pattern)', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/tracing/http.instrumentation.ts'),
      'src/tracing/http.instrumentation.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips main instrumentation.ts file', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/instrumentation.ts'),
      'src/instrumentation.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in instrumentation/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/instrumentation/tracing.ts'),
      'src/instrumentation/tracing.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags in non-test files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(violatingCode, 'src/app.service.ts'),
      'src/app.service.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });
});

describe('no-god-controller', () => {
  it('flags controller exceeding route threshold', () => {
    const methods = Array.from({ length: 12 }, (_, i) => `@Get('route${i}') handler${i}() {}`).join(
      '\n'
    );
    const v: RuleViolation[] = [];
    checkNoGodController(
      parse(`@Controller('api') class BigController { ${methods} }`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('12 routes');
  });

  it('does not flag controller under threshold', () => {
    const v: RuleViolation[] = [];
    checkNoGodController(
      parse(`
        @Controller('api')
        class SmallController {
          @Get() findAll() {}
          @Post() create() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag classes without @Controller', () => {
    const methods = Array.from({ length: 12 }, (_, i) => `@Get('route${i}') handler${i}() {}`).join(
      '\n'
    );
    const v: RuleViolation[] = [];
    checkNoGodController(parse(`class NotAController { ${methods} }`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

describe('no-god-service', () => {
  it('flags injectable class exceeding line threshold', () => {
    const filler = Array.from({ length: 410 }, (_, i) => `  line${i}() {}`).join('\n');
    const v: RuleViolation[] = [];
    checkNoGodService(
      parse(`@Injectable() class HugeService {\n${filler}\n}`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('HugeService');
  });

  it('does not flag small injectable', () => {
    const v: RuleViolation[] = [];
    checkNoGodService(
      parse(`@Injectable() class SmallService { run() {} }`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag large non-injectable class', () => {
    const filler = Array.from({ length: 410 }, (_, i) => `  line${i}() {}`).join('\n');
    const v: RuleViolation[] = [];
    checkNoGodService(parse(`class BigPlainClass {\n${filler}\n}`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

// ── Security rules ───────────────────────────────────────────────────

describe('no-hardcoded-secrets', () => {
  it('flags hardcoded password', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "s3cret123";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('password');
  });

  it('flags hardcoded api_key property', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(`const config = { api_key: "abc123def" };`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });

  it('flags hardcoded jwt_secret', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const jwt_secret = "myJwtSecret";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(1);
  });

  it('does not flag empty string', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag non-secret variable names', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const username = "admin";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag process.env reference', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = process.env.PASSWORD;`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  // Edge case tests for placeholder patterns
  it('does not flag mock/fake placeholder values', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "mock";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const api_key = "fake";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const secret = "dummy";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag development environment placeholders', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "dev";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const api_key = "local";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const secret = "development";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const jwt_secret = "staging";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag sandbox/demo placeholders', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "sandbox";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const api_key = "demo";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag very short values (likely placeholders)', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "abc";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const api_key = "x";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag template placeholders like <your-secret>', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "<your-secret>";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
    checkNoHardcodedSecrets(parse(`const api_key = "your_secret";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

describe('no-hardcoded-secrets (test file exclusion)', () => {
  const violatingCode = `const password = "s3cret123";`;

  it('skips .spec.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'src/foo.spec.ts'), 'src/foo.spec.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'src/foo.test.ts'), 'src/foo.test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in __tests__ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(violatingCode, 'src/__tests__/foo.ts'),
      'src/__tests__/foo.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in cypress/e2e directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(violatingCode, 'cypress/e2e/auth.ts'),
      'cypress/e2e/auth.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in fixtures directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(violatingCode, 'src/fixtures/config.ts'),
      'src/fixtures/config.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in mocks directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(violatingCode, 'src/mocks/auth.ts'),
      'src/mocks/auth.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips .spec.mts files (ES module TypeScript)', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'foo.spec.mts'), 'foo.spec.mts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.mts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'foo.test.mts'), 'foo.test.mts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .spec.cts files (CommonJS TypeScript)', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'foo.spec.cts'), 'foo.spec.cts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.cts files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'foo.test.cts'), 'foo.test.cts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in e2e/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(violatingCode, 'e2e/auth.ts'), 'e2e/auth.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('still flags in non-test source files', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(violatingCode, 'src/config/database.ts'),
      'src/config/database.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });
});

describe('missing-validation-pipe', () => {
  it('flags bootstrap file missing ValidationPipe', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          await app.listen(3000);
        }
        bootstrap();
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('ValidationPipe');
  });

  it('does not flag bootstrap file with ValidationPipe', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          app.useGlobalPipes(new ValidationPipe());
          await app.listen(3000);
        }
        bootstrap();
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files without NestFactory', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`export class AppService { run() {} }`),
      'app.service.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  // Edge case tests for improved detection
  it('does not flag when APP_PIPE provider is used', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          // APP_PIPE provider configured in module
          await app.listen(3000);
        }
        // APP_PIPE is referenced somewhere
        const provider = { provide: APP_PIPE, useClass: ValidationPipe };
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag when useGlobalPipes is called', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          app.useGlobalPipes(new CustomPipe());
          await app.listen(3000);
        }
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag custom validation pipe names', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          app.useGlobalPipes(new GlobalValidationPipe());
          await app.listen(3000);
        }
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  // CLI entry point exclusions
  it('skips migration runner files (run-migrations.ts)', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function runMigrations() {
          const app = await NestFactory.createApplicationContext(MigrationModule);
          // Run migrations...
        }
      `),
      'run-migrations.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips data-source.ts files', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function setup() {
          const app = await NestFactory.create(AppModule);
          // Setup data source...
        }
      `),
      'data-source.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips seeder files', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function seed() {
          const app = await NestFactory.createApplicationContext(SeederModule);
          // Seed database...
        }
      `),
      'seeder.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips worker files', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function startWorker() {
          const app = await NestFactory.create(WorkerModule);
          // Start worker...
        }
      `),
      'worker.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files using createApplicationContext (standalone apps)', () => {
    const v: RuleViolation[] = [];
    checkMissingValidationPipe(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.createApplicationContext(CliModule);
          const service = app.get(CliService);
          await service.run();
        }
      `),
      'cli-runner.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-any-in-dto', () => {
  it('flags any-typed property in DTO', () => {
    const v: RuleViolation[] = [];
    checkNoAnyInDto(
      parse(`
        class CreateUserDto {
          name: string;
          metadata: any;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('metadata');
    expect(v[0].message).toContain('CreateUserDto');
  });

  it('does not flag typed properties', () => {
    const v: RuleViolation[] = [];
    checkNoAnyInDto(
      parse(`
        class CreateUserDto {
          name: string;
          age: number;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag non-DTO classes', () => {
    const v: RuleViolation[] = [];
    checkNoAnyInDto(parse(`class UserService { data: any; }`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('flags any-typed constructor parameter in DTO', () => {
    const v: RuleViolation[] = [];
    checkNoAnyInDto(
      parse(`
        class UpdateItemDto {
          constructor(public payload: any) {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('payload');
  });
});

describe('no-raw-sql', () => {
  it('flags template literal SQL with interpolation', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('template interpolation');
  });

  it('flags string concatenation SQL', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse(`const q = "DELETE FROM users WHERE id = " + id;`),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('concatenation');
  });

  it('does not flag static SQL string', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(parse(`const q = "SELECT * FROM users";`), 'src/app.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag parameterized template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `SELECT * FROM users WHERE id = $1`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  // Edge case tests for safe SQL tags
  it('does not flag Prisma.sql tagged template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = Prisma.sql`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag knex.raw tagged template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = knex.raw`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag db.sql tagged template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = db.sql`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag sequelize tagged template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = sequelize`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag slonik sql tag', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = slonik`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-raw-sql (test file exclusion)', () => {
  it('skips .spec.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `SELECT * FROM users WHERE id = ${userId}`;'),
      'src/users/users.service.spec.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips .test.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `DELETE FROM users WHERE id = ${userId}`;'),
      'src/users/users.service.test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in __tests__ directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = "UPDATE users SET name = " + name;'),
      'src/__tests__/database.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in cypress directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `INSERT INTO fixtures VALUES (${id}, ${name})`;'),
      'cypress/support/seed-database.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in e2e directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `SELECT * FROM test_users WHERE id = ${testId}`;'),
      'e2e/helpers/database.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in fixtures directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `INSERT INTO users VALUES (${name})`;'),
      'fixtures/seed-data.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags raw SQL in source files', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `SELECT * FROM users WHERE id = ${userId}`;'),
      'src/users/users.repository.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('template interpolation');
  });
});

// ── Correctness rules ────────────────────────────────────────────────

describe('missing-injectable', () => {
  it('flags provider-named class without @Injectable', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        class UserService {
          constructor(private readonly repo: UserRepository) {}
          run() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('UserService');
    expect(v[0].message).toContain('@Injectable');
  });

  it('does not flag @Injectable class', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`@Injectable() class UserService { run() {} }`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Controller class', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(`@Controller() class UserController { }`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag non-provider-named class', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(`class CreateUserDto { name: string; }`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag provider-like class without constructor dependencies', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        class ParseNullableBooleanPipe {
          transform(value: string | null): boolean | null {
            return value === null ? null : value === 'true';
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag anonymous class', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(`export default class { run() {} }`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag class with @Catch decorator (exception filter)', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        @Catch(HttpException)
        class ExtendedExceptionFilter implements ExceptionFilter {
          catch(exception: HttpException, host: ArgumentsHost) {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag NamingStrategy classes (TypeORM)', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        class CustomNamingStrategy extends DefaultNamingStrategy {
          tableName(name: string) { return name; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag abstract base classes', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        abstract class BaseEventProcessor {
          constructor(
            protected readonly logger: LoggerService,
            protected readonly config: ConfigService,
          ) {}
          abstract process(): Promise<void>;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag static utility/factory classes', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        class CommunicationEventFactory {
          static createEvent(data: any) { return { type: 'event', data }; }
          static createAnotherEvent(data: any) { return { type: 'another', data }; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags non-abstract class with instance methods', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        class EmailMessageProcessorService {
          constructor(private readonly repo: Repository) {}
          process() { return this.repo.find(); }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('EmailMessageProcessorService');
  });
});

describe('lifecycle-hook-interface', () => {
  it('flags onModuleInit without implements OnModuleInit', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(
      parse(`
        class AppService {
          onModuleInit() { }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('OnModuleInit');
  });

  it('does not flag when interface is implemented', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(
      parse(`
        class AppService implements OnModuleInit {
          onModuleInit() { }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags onApplicationShutdown without interface', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(
      parse(`
        class CleanupService {
          onApplicationShutdown() { }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('OnApplicationShutdown');
  });

  it('does not flag non-lifecycle methods', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(parse(`class Svc { doSomething() {} }`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

describe('no-constructor-side-effects', () => {
  it('flags console.log in constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class AppService {
          constructor() {
            console.log("starting");
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('console.log');
  });

  it('flags fetch() in constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class StartupService {
          constructor() {
            fetch("https://api.example.com");
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('fetch');
  });

  it('flags fs.readFile in constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class ConfigLoader {
          constructor() {
            fs.readFile("config.json", () => {});
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('fs.readFile');
  });

  it('does not flag clean constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class AppService {
          constructor(private readonly dep: DepService) {
            this.value = 42;
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag side effects outside constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class AppService {
          init() { console.log("ready"); }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-nested-controller-decorator', () => {
  it('flags @Controller inside a function', () => {
    const v: RuleViolation[] = [];
    checkNoNestedControllerDecorator(
      parse(`
        function createController() {
          @Controller('api')
          class NestedController {}
          return NestedController;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('NestedController');
  });

  it('does not flag top-level @Controller', () => {
    const v: RuleViolation[] = [];
    checkNoNestedControllerDecorator(
      parse(`
        @Controller('api')
        class AppController { }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-console-log', () => {
  it('flags console.log in application code', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('hello');`), 'src/app.service.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('console.log');
  });

  it('flags console.error', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.error('error');`), 'src/app.service.ts', makeCtx(v));
    expect(v).toHaveLength(1);
  });

  it('does not flag in test files (.spec.ts)', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('test output');`), 'src/app.service.spec.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag in test files (.test.ts)', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('test output');`), 'src/app.service.test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  // Edge case tests for CLI exclusions
  it('does not flag in CLI directories', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('CLI output');`), 'src/cli/generate.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag in bin directories', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('bin output');`), 'bin/bluebird.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag in scripts directories', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('script output');`), 'scripts/build.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag cli.ts entry point', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('CLI entry');`), 'src/cli.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag migration files', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(
      parse(`console.log('Running migration...');`),
      'src/postgres/migrations/1752877418083-CreateUsers.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag Mock files', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(
      parse(`console.log('Mock processor');`),
      'test/MockProcessors.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag files in mocks/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoConsoleLog(parse(`console.log('Mock service');`), 'src/mocks/services.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

// ── API Design rules ─────────────────────────────────────────────────

describe('missing-swagger-decorators', () => {
  it('flags handler missing @ApiOperation and @ApiResponse', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('@ApiOperation');
    expect(v[0].message).toContain('@ApiResponse');
  });

  it('does not flag fully decorated handler', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          @ApiOperation({ summary: 'List users' })
          @ApiResponse({ status: 200, description: 'OK' })
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags handler missing only @ApiResponse', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          @ApiOperation({ summary: 'List users' })
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).not.toContain('@ApiOperation');
    expect(v[0].message).toContain('@ApiResponse');
  });

  it('does not flag non-controller class methods', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        class UserService {
          @Get()
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('accepts @ApiOkResponse as alternative to @ApiResponse', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          @ApiOperation({ summary: 'List users' })
          @ApiOkResponse({ description: 'Success' })
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('accepts @ApiCreatedResponse as alternative to @ApiResponse', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Post()
          @ApiOperation({ summary: 'Create user' })
          @ApiCreatedResponse({ description: 'Created' })
          create() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('accepts @ApiBadRequestResponse as alternative to @ApiResponse', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Post()
          @ApiOperation({ summary: 'Create user' })
          @ApiBadRequestResponse({ description: 'Bad request' })
          create() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('accepts @ApiNotFoundResponse as alternative to @ApiResponse', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('users')
        class UserController {
          @Get(':id')
          @ApiOperation({ summary: 'Get user' })
          @ApiNotFoundResponse({ description: 'Not found' })
          findOne() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags webhook controllers missing Swagger decorators', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('webhooks/sendgrid')
        class SendGridWebhookController {
          @Post('inbound-parse')
          handleInboundParse() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('@ApiOperation');
    expect(v[0].message).toContain('@ApiResponse');
  });

  it('does not flag methods with @AllowUnauthenticated (webhook pattern)', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('api')
        class ApiController {
          @Post('callback')
          @AllowUnauthenticated()
          handleCallback() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag methods with @ApiExcludeEndpoint', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('internal')
        class InternalController {
          @Post('sync')
          @ApiExcludeEndpoint()
          syncInternalState() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-entity-as-response', () => {
  it('flags handler returning entity type', () => {
    const v: RuleViolation[] = [];
    checkNoEntityAsResponse(
      parse(`
        @Controller('users')
        class UserController {
          @Get(':id')
          findOne(): Promise<UserEntity> { return null as any; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('UserEntity');
  });

  it('flags handler returning entity array', () => {
    const v: RuleViolation[] = [];
    checkNoEntityAsResponse(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          findAll(): Promise<UserEntity[]> { return null as any; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('UserEntity');
  });

  it('does not flag handler returning DTO', () => {
    const v: RuleViolation[] = [];
    checkNoEntityAsResponse(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          findAll(): Promise<UserDto[]> { return null as any; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag handler without return type annotation', () => {
    const v: RuleViolation[] = [];
    checkNoEntityAsResponse(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-inconsistent-http-status', () => {
  it('flags @Post with @HttpCode(200)', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Post()
          @HttpCode(200)
          create() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('201');
  });

  it('does not flag @Post without @HttpCode', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Post()
          create() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Post with @HttpCode(201)', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Post()
          @HttpCode(201)
          create() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Get with @HttpCode(200)', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Get()
          @HttpCode(200)
          findAll() { return []; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags @Delete with @HttpCode(200) — should be 204', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Delete(':id')
          @HttpCode(200)
          remove() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('204');
    expect(v[0].message).toContain('@Delete');
  });

  it('does not flag @Delete with @HttpCode(200) when @ApiOkResponse documents the contract', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('admin/items')
        class AdminController {
          @Delete(':id')
          @HttpCode(200)
          @ApiOkResponse({ description: 'Deleted with body' })
          remove() { return { id: '1' }; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Post with @HttpCode(200) when @ApiOkResponse documents the contract', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('admin')
        class AdminController {
          @Post('rotate')
          @HttpCode(200)
          @ApiOkResponse({ description: 'Rotation result' })
          rotate() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags @Delete with @HttpCode(201) — should be 204', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('items')
        class ItemController {
          @Delete(':id')
          @HttpCode(201)
          remove() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('204');
  });

  it('does not flag @Delete with @HttpCode(204)', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Delete(':id')
          @HttpCode(204)
          remove() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Delete without @HttpCode', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Delete(':id')
          remove() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags @Post with @HttpCode(HttpStatus.OK)', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Post()
          @HttpCode(HttpStatus.OK)
          create() { return {}; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('HttpStatus.OK');
    expect(v[0].message).toContain('201');
  });

  it('does not flag @Delete with @HttpCode(HttpStatus.NO_CONTENT)', () => {
    const v: RuleViolation[] = [];
    checkNoInconsistentHttpStatus(
      parse(`
        @Controller('users')
        class UserController {
          @Delete(':id')
          @HttpCode(HttpStatus.NO_CONTENT)
          remove() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('is classified as a heuristic rule', () => {
    const rule = getRuleById('no-inconsistent-http-status');
    expect(rule).toBeDefined();
    expect(rule!.confidence).toBe('heuristic');
  });
});

describe('no-generic-exception', () => {
  it('does not flag throw new Error() in @Injectable service (services can throw generic errors)', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        @Injectable()
        class UserService {
          findUser() {
            throw new Error('User not found');
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    // Services are internal - generic exceptions are caught by controllers/exception filters
    expect(v).toHaveLength(0);
  });

  it('flags throw new Error() in @Controller', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        @Controller('users')
        class UserController {
          findUser() {
            throw new Error('User not found');
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Error');
  });

  it('flags throw new TypeError() in @Controller', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        @Controller('users')
        class UserController {
          findUser() {
            throw new TypeError('Invalid type');
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('TypeError');
  });

  it('does not flag throw new BadRequestException() in @Controller', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        @Controller('users')
        class UserController {
          findUser() {
            throw new BadRequestException('Invalid input');
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag test files', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        @Controller('users')
        class UserController {
          findUser() {
            throw new Error('User not found');
          }
        }
      `),
      'user.controller.spec.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags throw new Error() in @Resolver', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        @Resolver()
        class UserResolver {
          users() {
            throw new Error('Query failed');
          }
        }
      `),
      'user.resolver.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Error');
  });

  it('does not flag classes without @Controller or @Resolver decorator', () => {
    const v: RuleViolation[] = [];
    checkNoGenericException(
      parse(`
        class PlainClass {
          doSomething() {
            throw new Error('Something went wrong');
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

// ── Performance rules ────────────────────────────────────────────────

describe('no-sync-fs-operations', () => {
  it('flags readFileSync', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`const data = fs.readFileSync("file.txt");`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('readFileSync');
  });

  it('flags writeFileSync', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(parse(`fs.writeFileSync("out.txt", data);`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('writeFileSync');
  });

  it('flags existsSync', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(parse(`if (fs.existsSync("path")) {}`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('existsSync');
  });

  it('does not flag async fs methods', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`const data = await fs.promises.readFile("file.txt");`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag module files (startup-time reads)', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`const cert = fs.readFileSync("ssl-cert.pem");`),
      'src/postgres/postgres.module.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-blocking-crypto', () => {
  it('flags pbkdf2Sync', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(
      parse(`const hash = crypto.pbkdf2Sync("pass", "salt", 100000, 64, "sha512");`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('pbkdf2Sync');
  });

  it('flags scryptSync', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(
      parse(`const key = crypto.scryptSync("password", "salt", 64);`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('scryptSync');
  });

  it('does not flag async crypto methods', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(
      parse(`crypto.pbkdf2("pass", "salt", 100000, 64, "sha512", cb);`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

// ── Graph rules ──────────────────────────────────────────────────────

describe('no-circular-dependency', () => {
  it('detects a simple cycle between two modules', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.module.ts',
      parse(
        `
        @Module({ imports: [BModule] })
        class AModule {}
      `,
        'a.module.ts'
      )
    );
    files.set(
      'b.module.ts',
      parse(
        `
        @Module({ imports: [AModule] })
        class BModule {}
      `,
        'b.module.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoCircularDependency(files, makeCtx(v));
    expect(v.length).toBeGreaterThanOrEqual(1);
    const messages = v.map((x) => x.message).join(' ');
    expect(messages).toContain('Circular');
  });

  it('does not flag acyclic module graph', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.module.ts',
      parse(`@Module({ imports: [BModule] }) class AModule {}`, 'a.module.ts')
    );
    files.set('b.module.ts', parse(`@Module({}) class BModule {}`, 'b.module.ts'));

    const v: RuleViolation[] = [];
    checkNoCircularDependency(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('handles forwardRef in imports', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'x.module.ts',
      parse(`@Module({ imports: [forwardRef(() => YModule)] }) class XModule {}`, 'x.module.ts')
    );
    files.set(
      'y.module.ts',
      parse(`@Module({ imports: [XModule] }) class YModule {}`, 'y.module.ts')
    );

    const v: RuleViolation[] = [];
    checkNoCircularDependency(files, makeCtx(v));
    expect(v.length).toBeGreaterThanOrEqual(1);
  });
});

describe('no-duplicate-route', () => {
  it('detects duplicate routes across controllers', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller('users')
        class AController {
          @Get(':id')
          findOne() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller('users')
        class BController {
          @Get(':id')
          findById() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Duplicate route');
    expect(v[0].message).toContain('GET');
  });

  it('does not flag different routes', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller('users')
        class AController {
          @Get()
          findAll() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller('orders')
        class BController {
          @Get()
          findAll() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag same path with different methods', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller('users')
        class UserController {
          @Get(':id')
          findOne() {}
          @Delete(':id')
          remove() {}
        }
      `,
        'a.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('detects duplicate routes within the same controller', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'dup.controller.ts',
      parse(
        `
        @Controller('orders')
        class OrderController {
          @Post()
          createOrder() {}
          @Post()
          addOrder() {}
        }
      `,
        'dup.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Duplicate route');
    expect(v[0].message).toContain('POST');
  });

  it('does not flag versioned routes with different @Version decorators', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'users.controller.ts',
      parse(
        `
        @Controller('users')
        class UsersController {
          @Get(':id')
          @Version('1')
          findOneV1() {}

          @Get(':id')
          @Version('2')
          findOneV2() {}
        }
      `,
        'users.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag routes with class-level @Version decorator', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'v1.controller.ts',
      parse(
        `
        @Controller('users')
        @Version('1')
        class UsersV1Controller {
          @Get(':id')
          findOne() {}
        }
      `,
        'v1.controller.ts'
      )
    );
    files.set(
      'v2.controller.ts',
      parse(
        `
        @Controller('users')
        @Version('2')
        class UsersV2Controller {
          @Get(':id')
          findOne() {}
        }
      `,
        'v2.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag VERSION_NEUTRAL and versioned routes as duplicates', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'v1.controller.ts',
      parse(
        `
        @Controller('webhooks/sendgrid')
        @Version(VERSION_NEUTRAL)
        class SendGridWebhookController {
          @Post('inbound-parse')
          inboundParseV1() {}
        }
      `,
        'v1.controller.ts'
      )
    );
    files.set(
      'v2.controller.ts',
      parse(
        `
        @Controller('webhooks/sendgrid')
        class SendGridWebhookControllerV2 {
          @Post('inbound-parse')
          @Version('2')
          inboundParseV2() {}
        }
      `,
        'v2.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('still flags duplicate routes with same version', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'users.controller.ts',
      parse(
        `
        @Controller('users')
        class UsersController {
          @Get(':id')
          @Version('1')
          findOneA() {}

          @Get(':id')
          @Version('1')
          findOneB() {}
        }
      `,
        'users.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Duplicate route');
    expect(v[0].message).toContain('(v1)');
  });

  it('handles numeric @Version decorator', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'users.controller.ts',
      parse(
        `
        @Controller('users')
        class UsersController {
          @Get(':id')
          @Version(1)
          findOneV1() {}

          @Get(':id')
          @Version(2)
          findOneV2() {}
        }
      `,
        'users.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('handles array @Version decorator', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'users.controller.ts',
      parse(
        `
        @Controller('users')
        class UsersController {
          @Get(':id')
          @Version(['1'])
          findOneV1() {}

          @Get(':id')
          @Version(['2'])
          findOneV2() {}
        }
      `,
        'users.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

describe('no-duplicate-route (non-string decorator args)', () => {
  it('does not false-positive when controllers use variable-based paths', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller(API_PREFIX)
        class AController {
          @Get()
          findAll() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller(ANOTHER_PREFIX)
        class BController {
          @Get()
          findAll() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not false-positive when handler methods use variable-based paths', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller('users')
        class AController {
          @Get(PATHS.LIST)
          findAll() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller('users')
        class BController {
          @Get(PATHS.DETAIL)
          findOne() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not false-positive when controller uses object-form metadata', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller({ path: 'users', version: '1' })
        class AController {
          @Get()
          findAll() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller({ path: 'users', version: '2' })
        class BController {
          @Get()
          findAll() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('still detects duplicates with string-literal paths', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller('users')
        class AController {
          @Get(':id')
          findOne() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller('users')
        class BController {
          @Get(':id')
          findById() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('Duplicate route');
  });

  it('still detects duplicates when @Controller() has no args (root path)', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.controller.ts',
      parse(
        `
        @Controller()
        class AController {
          @Get('health')
          health() {}
        }
      `,
        'a.controller.ts'
      )
    );
    files.set(
      'b.controller.ts',
      parse(
        `
        @Controller()
        class BController {
          @Get('health')
          healthCheck() {}
        }
      `,
        'b.controller.ts'
      )
    );

    const v: RuleViolation[] = [];
    checkNoDuplicateRoute(files, makeCtx(v));
    expect(v).toHaveLength(1);
  });
});

// ── Additional edge case tests ───────────────────────────────────────

describe('no-hardcoded-dependency (edge cases)', () => {
  it('flags multiple provider suffixes: Gateway, Handler, Adapter', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        const a = new PaymentGateway();
        const b = new EventHandler();
        const c = new StorageAdapter();
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(3);
    expect(v[0].message).toContain('PaymentGateway');
    expect(v[1].message).toContain('EventHandler');
    expect(v[2].message).toContain('StorageAdapter');
  });

  it('does not flag NestJS exception classes', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        throw new NotFoundException("Not found");
        throw new BadRequestException("Invalid");
        throw new UnauthorizedException("No auth");
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag built-in data structures', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedDependency(
      parse(`
        const m = new Map();
        const s = new Set();
        const u = new URL("https://example.com");
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-hardcoded-secrets (edge cases)', () => {
  it('flags class property declaration with secret name', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(`
        class Config {
          private secret = "my-secret-value";
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('secret');
  });

  it('flags connection_string variable', () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(`const connection_string = "postgres://user:pass@host/db";`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('connection_string');
  });

  it("does not flag placeholder values like 'changeme'", () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(parse(`const password = "changeme";`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it("does not flag secret set to 'test' or 'placeholder'", () => {
    const v: RuleViolation[] = [];
    checkNoHardcodedSecrets(
      parse(`
        const api_key = "test";
        const secret = "placeholder";
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-any-in-dto (edge cases)', () => {
  it('flags DTO class with uppercase DTO suffix', () => {
    const v: RuleViolation[] = [];
    checkNoAnyInDto(
      parse(`
        class CreateUserDTO {
          payload: any;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('CreateUserDTO');
  });

  it('flags multiple any-typed properties in a single DTO', () => {
    const v: RuleViolation[] = [];
    checkNoAnyInDto(
      parse(`
        class UpdateItemDto {
          data: any;
          metadata: any;
          name: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(2);
  });
});

describe('no-raw-sql (edge cases)', () => {
  it('flags INSERT template with interpolation', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `INSERT INTO users VALUES (${name}, ${email})`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('template interpolation');
  });

  it('flags UPDATE with string concatenation', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(parse(`const q = "UPDATE users SET name = " + name;`), 'src/app.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('concatenation');
  });

  it('does not flag non-SQL template literals with interpolation', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(parse('const msg = `Hello ${name}, welcome!`;'), 'src/app.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag safe sql tagged template with interpolation', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = sql`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag Prisma.sql tagged template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = Prisma.sql`SELECT * FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag SQL tagged template', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = SQL`DELETE FROM sessions WHERE user_id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags untagged SQL template with interpolation', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `DELETE FROM users WHERE id = ${userId}`;'),
      'src/app.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });
});

describe('lifecycle-hook-interface (edge cases)', () => {
  it('flags multiple lifecycle hooks missing their interfaces', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(
      parse(`
        class AppService {
          onModuleInit() {}
          onModuleDestroy() {}
          onApplicationBootstrap() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(3);
    expect(v[0].message).toContain('OnModuleInit');
    expect(v[1].message).toContain('OnModuleDestroy');
    expect(v[2].message).toContain('OnApplicationBootstrap');
  });

  it('does not flag when all interfaces are implemented', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(
      parse(`
        class AppService implements OnModuleInit, OnModuleDestroy {
          onModuleInit() {}
          onModuleDestroy() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags beforeApplicationShutdown without interface', () => {
    const v: RuleViolation[] = [];
    checkLifecycleHookInterface(
      parse(`
        class ShutdownService {
          beforeApplicationShutdown() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('BeforeApplicationShutdown');
  });
});

describe('no-constructor-side-effects (edge cases)', () => {
  it('flags process.exit in constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class BootService {
          constructor() { process.exit(1); }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('process.exit');
  });

  it('flags axios calls in constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class ApiService {
          constructor() { axios.get("https://api.example.com"); }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('axios.get');
  });

  it('flags multiple side effects in a single constructor', () => {
    const v: RuleViolation[] = [];
    checkNoConstructorSideEffects(
      parse(`
        class NoisyService {
          constructor() {
            console.log("init");
            console.warn("warning");
            fetch("https://api.example.com");
          }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(3);
  });
});

describe('missing-injectable (edge cases)', () => {
  it('flags all common provider suffixes', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        class PaymentGuard { constructor(private readonly auth: AuthService) {} }
        class LogInterceptor { constructor(private readonly logger: LoggerService) {} }
        class TransformPipe { constructor(private readonly config: ConfigService) {} }
        class ExceptionFilter { constructor(private readonly monitor: MonitorService) {} }
        class AuthMiddleware { constructor(private readonly acl: AclService) {} }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(5);
  });

  it('does not flag @Module-decorated class', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(`@Module({}) class AppService {}`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

describe('missing-swagger-decorators (edge cases)', () => {
  it('flags multiple handlers in a single controller, reports each separately', () => {
    const v: RuleViolation[] = [];
    checkMissingSwaggerDecorators(
      parse(`
        @Controller('products')
        class ProductController {
          @Get()
          findAll() {}
          @Post()
          create() {}
          @Get(':id')
          @ApiOperation({ summary: 'Get one' })
          @ApiResponse({ status: 200 })
          findOne() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(2);
    expect(v[0].message).toContain('findAll');
    expect(v[1].message).toContain('create');
  });
});

describe('no-entity-as-response (edge cases)', () => {
  it('flags handler returning nested generic with entity (e.g. Promise<OrderEntity[]>)', () => {
    const v: RuleViolation[] = [];
    checkNoEntityAsResponse(
      parse(`
        @Controller('orders')
        class OrderController {
          @Get()
          findAll(): Promise<OrderEntity[]> { return null as any; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('OrderEntity');
  });

  it('does not flag handler returning plain string type', () => {
    const v: RuleViolation[] = [];
    checkNoEntityAsResponse(
      parse(`
        @Controller('health')
        class HealthController {
          @Get()
          check(): string { return "ok"; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-sync-fs-operations (edge cases)', () => {
  it('flags multiple different sync fs methods in the same file', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`
        fs.mkdirSync("dir");
        fs.rmdirSync("dir");
        fs.readdirSync(".");
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(3);
  });

  it('does not flag fs.promises.readFile', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`await fs.promises.readFile("file.txt");`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag readFileSync on non-fs receiver', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(parse(`cache.readFileSync("file.txt");`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag existsSync on arbitrary object', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(parse(`mock.existsSync("/tmp/test");`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('flags readFileSync imported directly from fs', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`
        import { readFileSync } from 'fs';
        const data = readFileSync("file.txt");
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });

  it('flags namespace import from node:fs', () => {
    const v: RuleViolation[] = [];
    checkNoSyncFsOperations(
      parse(`
        import * as nodeFs from 'node:fs';
        nodeFs.readFileSync("file.txt");
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });
});

describe('no-blocking-crypto (edge cases)', () => {
  it('flags generateKeyPairSync', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(
      parse(`const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('generateKeyPairSync');
  });

  it('does not flag crypto.createHash (not blocking)', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(
      parse(`const hash = crypto.createHash("sha256").update("data").digest("hex");`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag randomFillSync on non-crypto receiver', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(parse(`mock.randomFillSync(buffer);`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('does not flag pbkdf2Sync on arbitrary object', () => {
    const v: RuleViolation[] = [];
    checkNoBlockingCrypto(
      parse(`testHelper.pbkdf2Sync("pass", "salt", 1, 32, "sha256");`),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-circular-dependency (edge cases)', () => {
  it('detects a three-module cycle (A → B → C → A)', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'a.module.ts',
      parse(`@Module({ imports: [BModule] }) class AModule {}`, 'a.module.ts')
    );
    files.set(
      'b.module.ts',
      parse(`@Module({ imports: [CModule] }) class BModule {}`, 'b.module.ts')
    );
    files.set(
      'c.module.ts',
      parse(`@Module({ imports: [AModule] }) class CModule {}`, 'c.module.ts')
    );

    const v: RuleViolation[] = [];
    checkNoCircularDependency(files, makeCtx(v));
    expect(v.length).toBeGreaterThanOrEqual(1);
    const allMessages = v.map((x) => x.message).join(' ');
    expect(allMessages).toContain('Circular');
  });

  it('does not flag modules with no imports', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set('a.module.ts', parse(`@Module({}) class AModule {}`, 'a.module.ts'));
    files.set('b.module.ts', parse(`@Module({}) class BModule {}`, 'b.module.ts'));

    const v: RuleViolation[] = [];
    checkNoCircularDependency(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('handles duplicate class names across files without false cycles', () => {
    const files = new Map<string, ts.SourceFile>();
    files.set(
      'feature-a/shared.module.ts',
      parse(
        `@Module({ imports: [DatabaseModule] }) class SharedModule {}`,
        'feature-a/shared.module.ts'
      )
    );
    files.set(
      'feature-b/shared.module.ts',
      parse(`@Module({}) class SharedModule {}`, 'feature-b/shared.module.ts')
    );
    files.set(
      'database.module.ts',
      parse(`@Module({}) class DatabaseModule {}`, 'database.module.ts')
    );

    const v: RuleViolation[] = [];
    checkNoCircularDependency(files, makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

// ── Rule registry tests ──────────────────────────────────────────────

describe('rule registry', () => {
  it('getAllRules returns all 38 rules (25 deterministic + 13 heuristic)', () => {
    const rules = getAllRules();
    expect(rules.length).toBe(38);
  });

  it("getRulesByConfidence('deterministic') returns exactly 25 rules", () => {
    const rules = getRulesByConfidence('deterministic');
    expect(rules.length).toBe(25);
    for (const r of rules) {
      expect(r.confidence).toBe('deterministic');
    }
  });

  it("getRulesByConfidence('heuristic') returns exactly 13 rules", () => {
    const rules = getRulesByConfidence('heuristic');
    expect(rules.length).toBe(13);
    for (const r of rules) {
      expect(r.confidence).toBe('heuristic');
    }
  });

  it('getRuleById returns the correct rule for known ids', () => {
    const rule = getRuleById('no-hardcoded-dependency');
    expect(rule).toBeDefined();
    expect(rule!.id).toBe('no-hardcoded-dependency');
    expect(rule!.category).toBe('architecture');
    expect(rule!.severity).toBe('error');
    expect(rule!.confidence).toBe('deterministic');
  });

  it('getRuleById returns undefined for unknown id', () => {
    expect(getRuleById('nonexistent-rule')).toBeUndefined();
  });

  it('getRulesByCategory returns correct counts per category', () => {
    expect(getRulesByCategory('architecture').length).toBe(4);
    expect(getRulesByCategory('security').length).toBeGreaterThanOrEqual(4);
    expect(getRulesByCategory('correctness').length).toBe(10);
    expect(getRulesByCategory('api-design').length).toBeGreaterThanOrEqual(3);
    expect(getRulesByCategory('performance').length).toBeGreaterThanOrEqual(2);
  });

  it('getEnabledRules excludes heuristic rules by default', () => {
    const project = makeProject();
    const enabled = getEnabledRules(project);
    for (const r of enabled) {
      expect(r.confidence).toBe('deterministic');
    }
  });

  it('getEnabledRules includes heuristic rules when opted in', () => {
    const project = makeProject();
    const enabled = getEnabledRules(project, true);
    const heuristic = enabled.filter((r) => r.confidence === 'heuristic');
    expect(heuristic.length).toBeGreaterThan(0);
  });

  it('getEnabledRules excludes swagger rules when swagger feature is disabled', () => {
    const project = makeProject({
      features: {
        graphql: false,
        websockets: false,
        microservices: false,
        cqrs: false,
        swagger: false,
        bull: false,
        config: false,
        throttler: false,
        cache: false,
      },
    });
    const enabled = getEnabledRules(project);
    const swaggerRule = enabled.find((r) => r.id === 'missing-swagger-decorators');
    expect(swaggerRule).toBeUndefined();
  });

  it('getEnabledRules includes swagger rules when swagger feature is enabled', () => {
    const project = makeProject({
      features: {
        graphql: false,
        websockets: false,
        microservices: false,
        cqrs: false,
        swagger: true,
        bull: false,
        config: false,
        throttler: false,
        cache: false,
      },
    });
    const enabled = getEnabledRules(project);
    const swaggerRule = enabled.find((r) => r.id === 'missing-swagger-decorators');
    expect(swaggerRule).toBeDefined();
  });

  it('every deterministic rule has a description, help, and analysisPass', () => {
    const rules = getRulesByConfidence('deterministic');
    for (const r of rules) {
      expect(r.description, `${r.id} missing description`).toBeTruthy();
      expect(r.help, `${r.id} missing help`).toBeTruthy();
      expect(['eslint', 'graph', 'knip'], `${r.id} invalid analysisPass`).toContain(r.analysisPass);
    }
  });

  it('every rule has a unique id', () => {
    const rules = getAllRules();
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rules are frozen and cannot be mutated', () => {
    const rules = getAllRules();
    expect(() => {
      (rules as unknown as unknown[]).push({});
    }).toThrow();
    expect(() => {
      (rules[0] as unknown as Record<string, unknown>).id = 'hacked';
    }).toThrow();
  });
});

// ── Migration file exclusion for no-raw-sql ──────────────────────────

describe('no-raw-sql (migration file exclusion)', () => {
  const migrationCode = `
    export class CreateUserTable1234567890123 {
      public async up(queryRunner) {
        await queryRunner.query(\`CREATE POLICY \${this.policyName} ON \${tableName}\`);
      }
    }
  `;

  it('skips files in migrations/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(parse(migrationCode), 'src/migrations/1234567890123-CreateUser.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in postgres/migrations/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse(migrationCode),
      'src/postgres/migrations/1752877418083-CreateCommsRepoPolicies.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in database/migrations/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(parse(migrationCode), 'database/migrations/20210101-CreateUsers.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in db/migrate/ directory (Rails-style)', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(parse(migrationCode), 'db/migrate/20210101_create_users.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips TypeORM-style migrations in migrations directory', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse(migrationCode),
      'src/migrations/1769192716000-AddSendAttemptIdToEmailMessage.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags raw SQL in non-migration source files', () => {
    const v: RuleViolation[] = [];
    checkNoRawSql(
      parse('const q = `SELECT * FROM users WHERE id = ${userId}`;'),
      'src/users/users.repository.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });
});

describe('no-raw-sql (natural language phrase exclusion)', () => {
  it('does not flag natural-language error message containing "Cannot update tag"', () => {
    const code = 'const message = `Cannot update tag ${tag.id}`;';
    const v: RuleViolation[] = [];
    checkNoRawSql(parse(code), 'src/tags/tags.service.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});
// ── Test file exclusion for missing-injectable ───────────────────────

describe('missing-injectable (test file exclusion)', () => {
  const mockCode = `
    export class MockUserService {
      async getUser() { return { id: 1 }; }
    }
  `;

  it('skips .spec.ts files', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(mockCode), 'src/users/users.service.spec.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips .test.ts files', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(mockCode), 'src/users/users.service.test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in test/ directory', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(mockCode), 'test/dependencyMocks/MockProcessors.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in __tests__ directory', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(mockCode), 'src/__tests__/mocks/MockService.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in mocks/ directory', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(mockCode), 'mocks/MockUserService.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips files in fixtures/ directory', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(parse(mockCode), 'fixtures/TestDataFactory.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('still flags missing @Injectable in source files', () => {
    const v: RuleViolation[] = [];
    checkMissingInjectable(
      parse(`
        export class UserService {
          constructor(private readonly repo: UserRepository) {}
          async getUser() {}
        }
      `),
      'src/users/users.service.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });
});

// ── Response DTO exclusion for missing-class-validator ───────────────

describe('missing-class-validator (response DTO exclusion)', () => {
  it('skips DTOs with @ApiResponseProperty decorators', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class UserDto {
          @ApiResponseProperty()
          readonly id!: string;

          @ApiResponseProperty()
          readonly name!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips DTOs where any property has @ApiResponseProperty', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class CommunicationDto {
          @ApiResponseProperty()
          readonly id!: string;

          @ApiProperty({ type: String, nullable: true })
          readonly title!: string | null;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags request DTOs without validation decorators', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class CreateUserDto {
          @ApiProperty()
          name!: string;

          @ApiProperty()
          email!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(2);
  });

  it('does not flag DTOs with class-validator decorators', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class CreateUserDto {
          @IsString()
          @IsNotEmpty()
          name!: string;

          @IsEmail()
          email!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips response DTOs with id property and @ApiProperty', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class SegmentDto {
          @ApiProperty({ type: String })
          id!: string;

          @ApiProperty({ type: String })
          name!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips DTOs with all readonly properties', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class UserResponseDto {
          @ApiProperty()
          readonly id!: string;

          @ApiProperty()
          readonly name!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips DTOs with response name patterns', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class GetUserResponseDto {
          @ApiProperty()
          id!: string;

          @ApiProperty()
          name!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips DTOs with ResultDto suffix (e.g. ListOrdersResultDto)', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class ListOrdersResultDto {
          @ApiProperty()
          items!: string[];

          @ApiProperty()
          total!: number;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  // readOnly: true property exclusions
  it('skips properties with @ApiProperty({ readOnly: true })', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class EmailThreadDto {
          @ApiProperty({ readOnly: true })
          id!: string;

          @ApiProperty({ readOnly: true })
          createdAt!: Date;

          @IsString()
          @IsNotEmpty()
          subject!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    // Only subject has validation, id and createdAt are readOnly so not flagged
    expect(v).toHaveLength(0);
  });

  it('skips entire DTO when all properties have readOnly: true', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class ExpandedCommunicationDto {
          @ApiProperty({ readOnly: true })
          id!: string;

          @ApiProperty({ readOnly: true, type: String })
          subject!: string;

          @ApiProperty({ readOnly: true })
          body!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('still flags input properties in mixed DTOs', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class MixedDto {
          @ApiProperty({ readOnly: true })
          generatedField!: string;

          @ApiProperty()
          inputField!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    // inputField should be flagged (no validation), generatedField should not (readOnly)
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('inputField');
  });

  it('handles @ApiPropertyOptional with readOnly: true', () => {
    const v: RuleViolation[] = [];
    checkMissingClassValidator(
      parse(`
        class ResponseDto {
          @ApiPropertyOptional({ readOnly: true })
          optionalField?: string;

          @ApiProperty({ readOnly: true })
          requiredField!: string;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

// ── Database rules ───────────────────────────────────────────────────

describe('missing-indexes', () => {
  it('flags ManyToOne relation without @Index', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        @Entity()
        class Order {
          @ManyToOne(() => User)
          user: User;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('user');
    expect(v[0].message).toContain('@Index()');
  });

  it('does not flag relation with @Index', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        @Entity()
        class Order {
          @ManyToOne(() => User)
          @Index()
          user: User;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('flags common filter columns without @Index', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        @Entity()
        class User {
          @Column()
          status: string;

          @Column()
          createdAt: Date;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(2);
    expect(v[0].message).toContain('status');
    expect(v[1].message).toContain('createdAt');
  });

  it('does not flag @ManyToMany relation (join table indexes)', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        @Entity()
        class Tag {
          @ManyToMany(() => Item, (item) => item.tags)
          items: Item[];
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @ManyToOne on @ChildEntity (STI / shared table patterns)', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        @ChildEntity('attachment')
        class EmailAttachment extends Document {
          @ManyToOne(() => Message, (m) => m.attachments)
          @JoinColumn({ name: 'parent_id' })
          message!: Message;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag ManyToOne when class-level composite @Index includes the relation property name', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        @Entity()
        @Index('idx_pair', ['owner', 'resource'])
        class Share {
          @ManyToOne(() => User)
          owner!: User;

          @ManyToOne(() => Resource)
          resource!: Resource;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag non-Entity classes', () => {
    const v: RuleViolation[] = [];
    checkMissingIndexes(
      parse(`
        class User {
          @ManyToOne(() => Company)
          company: Company;
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('missing-migration', () => {
  it('flags synchronize: true in TypeOrmModule', () => {
    const v: RuleViolation[] = [];
    checkMissingMigration(
      parse(`
        TypeOrmModule.forRoot({
          type: 'postgres',
          synchronize: true,
        });
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('synchronize: true');
  });

  it('flags synchronize: true in DataSource', () => {
    const v: RuleViolation[] = [];
    checkMissingMigration(
      parse(`
        const dataSource = new DataSource({
          type: 'postgres',
          synchronize: true,
        });
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
  });

  it('does not flag synchronize: false', () => {
    const v: RuleViolation[] = [];
    checkMissingMigration(
      parse(`
        TypeOrmModule.forRoot({
          type: 'postgres',
          synchronize: false,
        });
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag files without TypeORM', () => {
    const v: RuleViolation[] = [];
    checkMissingMigration(parse(`const config = { synchronize: true };`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

// ── Additional correctness rules ─────────────────────────────────────

describe('no-process-env-direct', () => {
  it('flags process.env.VAR access', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(parse(`const port = process.env.PORT;`), 'src/app.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('process.env.PORT');
  });

  it('flags process.env["VAR"] access', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(parse(`const port = process.env["PORT"];`), 'src/app.ts', makeCtx(v));
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('process.env[...]');
  });

  it('skips main.ts files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(parse(`const port = process.env.PORT;`), 'src/main.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips config files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const port = process.env.PORT;`),
      'src/app.config.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips test files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(parse(`const port = process.env.PORT;`), 'src/app.spec.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });

  it('skips migration files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const dbUrl = process.env.DATABASE_URL;`),
      'src/postgres/migrations/1752877418083-CreateUsers.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips data-source files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const dbUrl = process.env.DATABASE_URL;`),
      'src/data-source.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips CLI files in cli/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const debug = process.env.DEBUG;`),
      'cli/commands/generate.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips CLI files in scripts/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const env = process.env.NODE_ENV;`),
      'scripts/seed-database.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in fixtures/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const mockEnv = process.env.MOCK_VAR;`),
      'test/fixtures/env-setup.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips files in test-fixtures/ directory', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const mockEnv = process.env.MOCK_VAR;`),
      'test-fixtures/setup.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips bootstrap directory', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const pathBase = process.env.PATH_BASE;`),
      'src/bootstrap/setUpOpenApi.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips instrumentation.ts file', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`const deployEnv = process.env.DEPLOY_ENV;`),
      'src/instrumentation.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips run-migrations files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`process.env.EP__APP_NAME = 'migrations';`),
      'src/run-migrations.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips process.env access inside @Module metadata', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`
        @Module({
          imports: [
            ConfigModule.forRoot({
              envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
            }),
          ],
        })
        class AppModule {}
      `),
      'src/app.module.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips entire Module files since they legitimately need process.env for configuration', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`
        @Module({})
        class AppModule {}

        class ServiceInformationController {
          getName() {
            return process.env.EP__APP_NAME;
          }
        }
      `),
      'src/app.module.ts',
      makeCtx(v)
    );
    // Module files are excluded entirely - they need process.env for dynamic imports
    expect(v).toHaveLength(0);
  });

  it('still flags process.env access in non-module files', () => {
    const v: RuleViolation[] = [];
    checkNoProcessEnvDirect(
      parse(`
        class ServiceInformationController {
          getName() {
            return process.env.EP__APP_NAME;
          }
        }
      `),
      'src/service-information.controller.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('process.env.EP__APP_NAME');
  });
});

describe('missing-exception-filter', () => {
  it('flags NestFactory without exception filter', () => {
    const v: RuleViolation[] = [];
    checkMissingExceptionFilter(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          await app.listen(3000);
        }
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('exception filter');
  });

  it('does not flag when useGlobalFilters is present', () => {
    const v: RuleViolation[] = [];
    checkMissingExceptionFilter(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          app.useGlobalFilters(new AllExceptionsFilter());
          await app.listen(3000);
        }
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag when APP_FILTER provider is present', () => {
    const v: RuleViolation[] = [];
    checkMissingExceptionFilter(
      parse(`
        const app = await NestFactory.create(AppModule);
        // APP_FILTER configured in module
      `),
      'main.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips non-bootstrap files', () => {
    const v: RuleViolation[] = [];
    checkMissingExceptionFilter(parse(`class UserService { }`), 'user.service.ts', makeCtx(v));
    expect(v).toHaveLength(0);
  });
});

describe('missing-parse-pipe', () => {
  it('flags @Param without pipe for number type', () => {
    const v: RuleViolation[] = [];
    checkMissingParsePipe(
      parse(`
        @Controller('users')
        class UsersController {
          @Get(':id')
          findOne(@Param('id') id: number) {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('id');
    expect(v[0].message).toContain('number');
  });

  it('does not flag @Param with ParseIntPipe', () => {
    const v: RuleViolation[] = [];
    checkMissingParsePipe(
      parse(`
        @Controller('users')
        class UsersController {
          @Get(':id')
          findOne(@Param('id', ParseIntPipe) id: number) {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Param with new ParseIntPipe()', () => {
    const v: RuleViolation[] = [];
    checkMissingParsePipe(
      parse(`
        @Controller('users')
        class UsersController {
          @Get(':id')
          findOne(@Param('id', new ParseIntPipe()) id: number) {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag @Param with string type', () => {
    const v: RuleViolation[] = [];
    checkMissingParsePipe(
      parse(`
        @Controller('users')
        class UsersController {
          @Get(':id')
          findOne(@Param('id') id: string) {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('missing-resolver-decorator', () => {
  it('flags method in @Resolver without GraphQL decorator', () => {
    const v: RuleViolation[] = [];
    checkMissingResolverDecorator(
      parse(`
        @Resolver()
        class UserResolver {
          getUser() { return null; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('getUser');
  });

  it('does not flag method with @Query', () => {
    const v: RuleViolation[] = [];
    checkMissingResolverDecorator(
      parse(`
        @Resolver()
        class UserResolver {
          @Query()
          getUser() { return null; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag method with @Mutation', () => {
    const v: RuleViolation[] = [];
    checkMissingResolverDecorator(
      parse(`
        @Resolver()
        class UserResolver {
          @Mutation()
          createUser() { return null; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag private methods', () => {
    const v: RuleViolation[] = [];
    checkMissingResolverDecorator(
      parse(`
        @Resolver()
        class UserResolver {
          _privateMethod() { return null; }
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('missing-message-pattern', () => {
  it('flags method in microservice controller without pattern', () => {
    const v: RuleViolation[] = [];
    checkMissingMessagePattern(
      parse(`
        @Controller()
        class UserController {
          @MessagePattern('get-user')
          getUser() {}

          updateUser() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('updateUser');
  });

  it('does not flag HTTP controllers', () => {
    const v: RuleViolation[] = [];
    checkMissingMessagePattern(
      parse(`
        @Controller()
        class UserController {
          @Get()
          getUser() {}

          @Post()
          createUser() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('missing-websocket-decorator', () => {
  it('flags method in @WebSocketGateway without @SubscribeMessage', () => {
    const v: RuleViolation[] = [];
    checkMissingWebsocketDecorator(
      parse(`
        @WebSocketGateway()
        class ChatGateway {
          sendMessage() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('sendMessage');
  });

  it('does not flag method with @SubscribeMessage', () => {
    const v: RuleViolation[] = [];
    checkMissingWebsocketDecorator(
      parse(`
        @WebSocketGateway()
        class ChatGateway {
          @SubscribeMessage('message')
          handleMessage() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag lifecycle methods', () => {
    const v: RuleViolation[] = [];
    checkMissingWebsocketDecorator(
      parse(`
        @WebSocketGateway()
        class ChatGateway {
          handleConnection() {}
          handleDisconnect() {}
          afterInit() {}
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

describe('missing-config-validation', () => {
  it('flags ConfigModule.forRoot without validation', () => {
    const v: RuleViolation[] = [];
    checkMissingConfigValidation(
      parse(`
        ConfigModule.forRoot({
          isGlobal: true,
        });
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('validationSchema');
  });

  it('flags ConfigModule.forRoot with empty call', () => {
    const v: RuleViolation[] = [];
    checkMissingConfigValidation(parse(`ConfigModule.forRoot();`), 'test.ts', makeCtx(v));
    expect(v).toHaveLength(1);
  });

  it('does not flag ConfigModule.forRoot with validationSchema', () => {
    const v: RuleViolation[] = [];
    checkMissingConfigValidation(
      parse(`
        ConfigModule.forRoot({
          validationSchema: Joi.object({}),
        });
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag ConfigModule.forRoot with validate', () => {
    const v: RuleViolation[] = [];
    checkMissingConfigValidation(
      parse(`
        ConfigModule.forRoot({
          validate: (config) => config,
        });
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });

  it('skips test modules (*.spec.ts) — test doubles often omit validation schemas', () => {
    const v: RuleViolation[] = [];
    checkMissingConfigValidation(
      parse(`
        ConfigModule.forRoot({
          isGlobal: true,
        });
      `),
      'src/app.module.spec.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});

// ── Additional performance rules ─────────────────────────────────────

describe('missing-caching', () => {
  it('flags NestFactory without caching', () => {
    const v: RuleViolation[] = [];
    const ctx = makeCtx(v);
    ctx.project.features.cache = false;
    checkMissingCaching(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          await app.listen(3000);
        }
      `),
      'main.ts',
      ctx
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('caching');
  });

  it('does not flag when CacheModule is present', () => {
    const v: RuleViolation[] = [];
    const ctx = makeCtx(v);
    ctx.project.features.cache = false;
    checkMissingCaching(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          // CacheModule configured
          await app.listen(3000);
        }
      `),
      'main.ts',
      ctx
    );
    expect(v).toHaveLength(0);
  });

  it('does not flag when cache feature is detected', () => {
    const v: RuleViolation[] = [];
    const ctx = makeCtx(v);
    ctx.project.features.cache = true;
    checkMissingCaching(
      parse(`
        async function bootstrap() {
          const app = await NestFactory.create(AppModule);
          await app.listen(3000);
        }
      `),
      'main.ts',
      ctx
    );
    expect(v).toHaveLength(0);
  });
});

describe('no-n-plus-one', () => {
  it('flags findOne inside for loop', () => {
    const v: RuleViolation[] = [];
    checkNoNPlusOne(
      parse(`
        for (const id of ids) {
          const user = await repo.findOne({ where: { id } });
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('findOne');
    expect(v[0].message).toContain('loop');
  });

  it('flags findUnique inside for-of loop', () => {
    const v: RuleViolation[] = [];
    checkNoNPlusOne(
      parse(`
        for (const id of ids) {
          const user = await prisma.user.findUnique({ where: { id } });
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('findUnique');
  });

  it('flags findOne inside .map()', () => {
    const v: RuleViolation[] = [];
    checkNoNPlusOne(
      parse(`
        const users = await Promise.all(
          ids.map(async (id) => repo.findOne({ where: { id } }))
        );
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('N+1');
  });

  it('does not flag findMany', () => {
    const v: RuleViolation[] = [];
    checkNoNPlusOne(
      parse(`
        for (const batch of batches) {
          const users = await repo.findMany({ where: { id: In(batch) } });
        }
      `),
      'test.ts',
      makeCtx(v)
    );
    expect(v).toHaveLength(0);
  });
});
