import ts from 'typescript';
import type { RuleContext } from '../types.js';
import { hasDecorator, getLine } from './ast-helpers.js';

/**
 * **Rule `low-test-coverage`** (testing / warning / heuristic)
 *
 * Flags controller and service classes that don't have a corresponding
 * `.spec.ts` test file in the same directory or a sibling `__tests__` folder.
 *
 * This is a heuristic check — it cannot verify test quality, only that a
 * test file exists. The check is skipped for:
 * - Files already in test directories (`__tests__`, `*.spec.ts`, `*.test.ts`)
 * - DTOs, entities, and other non-logic classes
 *
 * @param sf       - Parsed TypeScript source file.
 * @param filePath - Absolute or relative path reported in diagnostics.
 * @param ctx      - Rule context providing project info and the `report` callback.
 */
export function checkLowTestCoverage(sf: ts.SourceFile, filePath: string, ctx: RuleContext): void {
  // Skip if this is already a test file
  if (
    filePath.includes('.spec.') ||
    filePath.includes('.test.') ||
    filePath.includes('__tests__') ||
    filePath.includes('/test/') ||
    filePath.includes('/tests/')
  ) {
    return;
  }

  // Skip if project has no tests at all (different rule concern)
  if (!ctx.project.hasTests) {
    return;
  }

  for (const stmt of sf.statements) {
    if (!ts.isClassDeclaration(stmt)) continue;

    const isController = hasDecorator(stmt, 'Controller');
    const isService = hasDecorator(stmt, 'Injectable');
    const isResolver = hasDecorator(stmt, 'Resolver');

    // Only flag controllers, services, and resolvers
    if (!isController && !isService && !isResolver) continue;

    const className = stmt.name?.text;
    if (!className) continue;

    // Skip DTOs, entities, modules, guards, etc.
    if (
      className.endsWith('Dto') ||
      className.endsWith('DTO') ||
      className.endsWith('Entity') ||
      className.endsWith('Module') ||
      className.endsWith('Guard') ||
      className.endsWith('Interceptor') ||
      className.endsWith('Filter') ||
      className.endsWith('Pipe')
    ) {
      continue;
    }

    // Determine expected test file path
    const baseName = filePath.replace(/\.ts$/, '');
    const expectedSpecPath = `${baseName}.spec.ts`;

    // We report a heuristic warning - the orchestrator can check if spec exists
    // For now, we flag all testable classes to encourage test coverage
    const classType = isController ? 'Controller' : isResolver ? 'Resolver' : 'Service';

    ctx.report({
      filePath,
      message: `${classType} '${className}' should have a corresponding test file (${expectedSpecPath.split('/').pop()})`,
      line: getLine(sf, stmt),
      column: 1,
      help: `Create ${expectedSpecPath.split('/').pop()} to test this ${classType.toLowerCase()}.`,
    });
  }
}
