import { describe, it, expect } from 'vitest';
import { isTestFile } from '../src/utils/is-test-file.js';

describe('isTestFile', () => {
  describe('file extension patterns', () => {
    it('should match .spec.ts files', () => {
      expect(isTestFile('src/users/users.service.spec.ts')).toBe(true);
      expect(isTestFile('app.spec.ts')).toBe(true);
    });

    it('should match .test.ts files', () => {
      expect(isTestFile('src/users/users.service.test.ts')).toBe(true);
      expect(isTestFile('app.test.ts')).toBe(true);
    });

    it('should match .spec.js files', () => {
      expect(isTestFile('src/utils/helper.spec.js')).toBe(true);
    });

    it('should match .test.js files', () => {
      expect(isTestFile('src/utils/helper.test.js')).toBe(true);
    });

    it('should match .spec.mts files (ES module TypeScript)', () => {
      expect(isTestFile('src/config.spec.mts')).toBe(true);
    });

    it('should match .test.mts files', () => {
      expect(isTestFile('src/config.test.mts')).toBe(true);
    });

    it('should match .spec.cts files (CommonJS TypeScript)', () => {
      expect(isTestFile('src/legacy.spec.cts')).toBe(true);
    });

    it('should match .test.cts files', () => {
      expect(isTestFile('src/legacy.test.cts')).toBe(true);
    });

    it('should match .spec.mjs files (ES module JavaScript)', () => {
      expect(isTestFile('src/utils.spec.mjs')).toBe(true);
    });

    it('should match .test.cjs files (CommonJS JavaScript)', () => {
      expect(isTestFile('src/utils.test.cjs')).toBe(true);
    });

    it('should NOT match regular .ts files', () => {
      expect(isTestFile('src/users/users.service.ts')).toBe(false);
    });

    it('should NOT match files with spec/test in the middle of name', () => {
      expect(isTestFile('src/specification.ts')).toBe(false);
      expect(isTestFile('src/testing-utils.ts')).toBe(false);
    });
  });

  describe('directory patterns', () => {
    it('should match files in __tests__ directory', () => {
      expect(isTestFile('__tests__/app.ts')).toBe(true);
      expect(isTestFile('src/__tests__/users.ts')).toBe(true);
      expect(isTestFile('src/users/__tests__/service.ts')).toBe(true);
    });

    it('should match files in test/ directory', () => {
      expect(isTestFile('test/app.ts')).toBe(true);
      expect(isTestFile('src/test/setup.ts')).toBe(true);
    });

    it('should match files in tests/ directory', () => {
      expect(isTestFile('tests/app.ts')).toBe(true);
      expect(isTestFile('src/tests/setup.ts')).toBe(true);
    });

    it('should match files in cypress/ directory', () => {
      expect(isTestFile('cypress/e2e/login.cy.ts')).toBe(true);
      expect(isTestFile('cypress/support/commands.ts')).toBe(true);
      expect(isTestFile('src/cypress/helpers.ts')).toBe(true);
    });

    it('should match files in e2e/ directory', () => {
      expect(isTestFile('e2e/app.e2e.ts')).toBe(true);
      expect(isTestFile('src/e2e/integration.ts')).toBe(true);
    });

    it('should match files in fixtures/ directory', () => {
      expect(isTestFile('fixtures/users.json')).toBe(true);
      expect(isTestFile('src/fixtures/mock-data.ts')).toBe(true);
    });

    it('should match files in mocks/ directory', () => {
      expect(isTestFile('mocks/api.ts')).toBe(true);
      expect(isTestFile('src/mocks/services.ts')).toBe(true);
    });

    it('should match files in test-fixtures/ directory', () => {
      expect(isTestFile('test-fixtures/setup.ts')).toBe(true);
      expect(isTestFile('src/test-fixtures/mock-data.ts')).toBe(true);
    });

    it('should match files in compound mock directories (dependencyMocks, testMocks)', () => {
      expect(isTestFile('test/dependencyMocks/MockProcessors.ts')).toBe(true);
      expect(isTestFile('src/testMocks/services.ts')).toBe(true);
    });
  });

  describe('path normalization', () => {
    it('should handle Windows-style backslash paths', () => {
      expect(isTestFile('src\\users\\users.service.spec.ts')).toBe(true);
      expect(isTestFile('src\\__tests__\\app.ts')).toBe(true);
    });

    it('should handle mixed slashes', () => {
      expect(isTestFile('src/users\\service.spec.ts')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should NOT match source files with similar names', () => {
      expect(isTestFile('src/users/users.service.ts')).toBe(false);
      expect(isTestFile('src/app.module.ts')).toBe(false);
      expect(isTestFile('src/main.ts')).toBe(false);
    });

    it('should NOT match config files', () => {
      expect(isTestFile('jest.config.ts')).toBe(false);
      expect(isTestFile('vitest.config.ts')).toBe(false);
    });

    it('should match deeply nested test files', () => {
      expect(isTestFile('src/modules/users/services/__tests__/users.service.ts')).toBe(true);
      expect(isTestFile('packages/core/src/utils/helper.spec.ts')).toBe(true);
    });
  });
});
