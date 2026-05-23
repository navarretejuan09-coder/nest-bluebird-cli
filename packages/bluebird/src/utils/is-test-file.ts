/**
 * Shared utility to detect test files based on naming conventions and directory patterns.
 * Used by rules that should skip test files (e.g., no-hardcoded-dependency, no-hardcoded-secrets).
 */

/**
 * Test file extension pattern that covers all TypeScript and JavaScript variants:
 * - .spec.ts, .test.ts, .spec.js, .test.js (standard)
 * - .spec.mts, .test.mts, .spec.mjs, .test.mjs (ES modules)
 * - .spec.cts, .test.cts, .spec.cjs, .test.cjs (CommonJS)
 */
const TEST_FILE_EXTENSION_PATTERN = /\.(spec|test)\.(ts|mts|cts|js|mjs|cjs)$/;

/**
 * Directory patterns that indicate test files.
 * Normalized to forward slashes for cross-platform compatibility.
 */
const TEST_DIRECTORY_PATTERNS = [
  '/__tests__/',
  '/test/',
  '/tests/',
  '/cypress/',
  '/e2e/',
  '/fixtures/',
  '/mocks/',
  '/test-fixtures/',
  // Compound patterns for nested test directories
  'Mocks/', // matches dependencyMocks/, testMocks/, etc.
  '/stubs/', // matches package stubs
] as const;

/**
 * Directory patterns that can appear at the start of a path (no leading slash).
 */
const TEST_DIRECTORY_START_PATTERNS = [
  'test/',
  'tests/',
  'cypress/',
  'e2e/',
  '__tests__/',
  'fixtures/',
  'mocks/',
  'test-fixtures/',
  'stubs/',
] as const;

/**
 * Returns `true` when {@link filePath} appears to be a test file based on
 * common naming conventions and directory patterns.
 *
 * Recognized patterns:
 * - File extensions: `.spec.ts`, `.test.ts`, `.spec.mts`, `.test.cts`, etc.
 * - Directories: `__tests__/`, `test/`, `tests/`, `cypress/`, `e2e/`, `fixtures/`, `mocks/`
 *
 * @param filePath - The file path to check (can use forward or back slashes)
 * @returns `true` if the file appears to be a test file
 *
 * @example
 * ```ts
 * isTestFile('src/users/users.service.spec.ts') // true
 * isTestFile('__tests__/integration/api.test.ts') // true
 * isTestFile('cypress/e2e/login.cy.ts') // true
 * isTestFile('src/users/users.service.ts') // false
 * ```
 */
export function isTestFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check file extension pattern
  if (TEST_FILE_EXTENSION_PATTERN.test(normalizedPath)) {
    return true;
  }

  // Check directory patterns (anywhere in path)
  for (const pattern of TEST_DIRECTORY_PATTERNS) {
    if (normalizedPath.includes(pattern)) {
      return true;
    }
  }

  // Check directory patterns at start of path
  for (const pattern of TEST_DIRECTORY_START_PATTERNS) {
    if (normalizedPath.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}
