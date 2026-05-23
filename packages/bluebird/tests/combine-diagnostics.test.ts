import { describe, it, expect } from 'vitest';
import { combineDiagnostics } from '../src/utils/combine-diagnostics.js';
import type { Diagnostic } from '../src/types.js';

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: 'src/app.controller.ts',
    plugin: 'bluebird',
    rule: 'test-rule',
    severity: 'warning',
    message: 'test message',
    category: 'correctness',
    confidence: 'deterministic',
    ...overrides,
  };
}

describe('combineDiagnostics', () => {
  it('returns empty array for no sources', () => {
    expect(combineDiagnostics()).toEqual([]);
  });

  it('returns empty array for empty sources', () => {
    expect(combineDiagnostics([], [], [])).toEqual([]);
  });

  it('returns single source unchanged (sorted)', () => {
    const diags = [
      makeDiag({ filePath: 'b.ts', line: 1 }),
      makeDiag({ filePath: 'a.ts', line: 5 }),
    ];
    const result = combineDiagnostics(diags);
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe('a.ts');
    expect(result[1].filePath).toBe('b.ts');
  });

  it('merges multiple sources', () => {
    const eslintDiags = [makeDiag({ filePath: 'c.ts', rule: 'r1' })];
    const graphDiags = [makeDiag({ filePath: 'a.ts', rule: 'r2' })];
    const knipDiags = [makeDiag({ filePath: 'b.ts', rule: 'r3' })];

    const result = combineDiagnostics(eslintDiags, graphDiags, knipDiags);
    expect(result).toHaveLength(3);
    expect(result[0].filePath).toBe('a.ts');
    expect(result[1].filePath).toBe('b.ts');
    expect(result[2].filePath).toBe('c.ts');
  });

  it('sorts by filePath then by line within same file', () => {
    const diags1 = [makeDiag({ filePath: 'a.ts', line: 20 })];
    const diags2 = [makeDiag({ filePath: 'a.ts', line: 5 })];
    const diags3 = [makeDiag({ filePath: 'a.ts', line: 10 })];

    const result = combineDiagnostics(diags1, diags2, diags3);
    expect(result).toHaveLength(3);
    expect(result[0].line).toBe(5);
    expect(result[1].line).toBe(10);
    expect(result[2].line).toBe(20);
  });

  it('treats undefined line as 0 for sorting', () => {
    const diags = [
      makeDiag({ filePath: 'a.ts', line: 10 }),
      makeDiag({ filePath: 'a.ts', line: undefined }),
    ];
    const result = combineDiagnostics(diags);
    expect(result[0].line).toBeUndefined();
    expect(result[1].line).toBe(10);
  });

  it('handles one empty and one non-empty source', () => {
    const result = combineDiagnostics([], [makeDiag({ filePath: 'x.ts' })]);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('x.ts');
  });

  it('preserves all diagnostic fields', () => {
    const original = makeDiag({
      filePath: 'src/svc.ts',
      plugin: 'bluebird',
      rule: 'bluebird/no-hardcoded-secrets',
      severity: 'error',
      message: 'secret found',
      help: 'use env vars',
      line: 42,
      column: 7,
      category: 'security',
      confidence: 'deterministic',
      weight: 1.5,
    });
    const result = combineDiagnostics([original]);
    expect(result[0]).toEqual(original);
  });
});
