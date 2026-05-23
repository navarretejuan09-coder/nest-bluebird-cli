import { describe, expect, it } from 'vitest';
import { formatText } from '../src/utils/format-text.js';
import type { Diagnostic, ScanResult, ProjectInfo } from '../src/types.js';

const baseProject: ProjectInfo = {
  nestVersion: '10.3.0',
  httpAdapter: 'express',
  orm: 'typeorm',
  features: {
    graphql: false,
    websockets: false,
    microservices: false,
    cqrs: false,
    swagger: true,
    bull: false,
    config: true,
    throttler: false,
    cache: false,
  },
  strictTypeScript: true,
  hasTests: true,
  sourceFileCount: 42,
};

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

function makeResult(overrides: Partial<ScanResult> = {}): ScanResult {
  return {
    project: baseProject,
    diagnostics: [],
    warnings: [],
    score: { score: 100, label: 'Great' },
    baselinedCount: 0,
    ...overrides,
  };
}

// Strip ANSI escape codes for assertion readability
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('formatText', () => {
  it('renders the bluebird logo', () => {
    const out = stripAnsi(formatText(makeResult(), false));
    expect(out).toContain('Bluebird');
    expect(out).toContain('NestJS Health Report');
  });

  it('renders the score box', () => {
    const out = formatText(makeResult(), false);
    expect(stripAnsi(out)).toContain('Score:');
    expect(stripAnsi(out)).toContain('100/100');
    expect(stripAnsi(out)).toContain('Great');
  });

  it('renders the score gauge with numeric score and label', () => {
    const out = stripAnsi(formatText(makeResult({ score: { score: 85, label: 'Great' } }), false));
    expect(out).toContain('85/100');
    expect(out).toContain('Great');
  });

  it('says "No issues found" when diagnostics are empty', () => {
    const out = stripAnsi(formatText(makeResult(), false));
    expect(out).toContain('No issues found');
  });

  it('shows error and warning counts', () => {
    const diags = [
      makeDiag({ rule: 'r1', severity: 'error' }),
      makeDiag({ rule: 'r2', severity: 'warning' }),
      makeDiag({ rule: 'r2', severity: 'warning', filePath: 'b.ts' }),
    ];
    const out = stripAnsi(
      formatText(makeResult({ diagnostics: diags, score: { score: 97, label: 'Great' } }), false)
    );
    expect(out).toContain('1 error');
    expect(out).toContain('2 warnings');
  });

  it('shows baselined count when non-zero', () => {
    const out = stripAnsi(formatText(makeResult({ baselinedCount: 5 }), false));
    expect(out).toContain('5 baselined (hidden)');
  });

  it('does not show baselined line when zero', () => {
    const out = stripAnsi(formatText(makeResult(), false));
    expect(out).not.toContain('baselined');
  });

  it('shows runner warning count', () => {
    const out = stripAnsi(
      formatText(
        makeResult({
          warnings: [{ type: 'io-error', filePath: 'x.ts', message: 'oops' }],
        }),
        false
      )
    );
    expect(out).toContain('1 runner warning');
  });

  it('shows runner warning details in verbose mode', () => {
    const out = stripAnsi(
      formatText(
        makeResult({
          warnings: [{ type: 'io-error', filePath: 'x.ts', message: 'oops' }],
        }),
        true
      )
    );
    expect(out).toContain('[io-error] x.ts  oops');
  });

  it('hides runner warning details in non-verbose mode', () => {
    const out = stripAnsi(
      formatText(
        makeResult({
          warnings: [{ type: 'io-error', filePath: 'x.ts', message: 'oops' }],
        }),
        false
      )
    );
    expect(out).toContain('1 runner warning');
    expect(out).not.toContain('[io-error] x.ts  oops');
  });

  describe('category summary', () => {
    it('groups diagnostics by category', () => {
      const diags = [
        makeDiag({ rule: 'r1', severity: 'error', category: 'security' }),
        makeDiag({ rule: 'r2', severity: 'warning', category: 'security', filePath: 'b.ts' }),
        makeDiag({ rule: 'r3', severity: 'warning', category: 'correctness', filePath: 'c.ts' }),
      ];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 97, label: 'Great' } }), false)
      );
      expect(out).toContain('By Category:');
      expect(out).toContain('Security');
      expect(out).toContain('Correctness');
    });

    it('shows error and warning counts per category', () => {
      const diags = [
        makeDiag({ rule: 'r1', severity: 'error', category: 'security' }),
        makeDiag({ rule: 'r2', severity: 'warning', category: 'security', filePath: 'b.ts' }),
      ];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 97, label: 'Great' } }), false)
      );
      expect(out).toMatch(/Security.*✖ 1.*⚠ 1/);
    });
  });

  describe('top issues', () => {
    it('shows top issues section', () => {
      const diags = [
        makeDiag({ rule: 'no-god-service', filePath: 'a.ts', message: 'too large', line: 10 }),
        makeDiag({ rule: 'no-god-service', filePath: 'b.ts', message: 'too large', line: 20 }),
      ];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), false)
      );
      expect(out).toContain('Top Issues:');
      expect(out).toContain('no-god-service');
      expect(out).toContain('(2)');
    });

    it('shows help text when available', () => {
      const diags = [makeDiag({ rule: 'r1', help: 'Use dependency injection instead' })];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), false)
      );
      expect(out).toContain('Use dependency injection instead');
    });
  });

  describe('verbose mode', () => {
    it('shows all diagnostics in verbose mode', () => {
      const diags = Array.from({ length: 5 }, (_, i) =>
        makeDiag({ rule: 'r1', filePath: `file-${i}.ts`, line: i + 1 })
      );
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), true)
      );
      expect(out).toContain('All Diagnostics:');
      expect(out).toContain('file-0.ts:1');
      expect(out).toContain('file-4.ts:5');
    });

    it('shows category in verbose diagnostics', () => {
      const diags = [makeDiag({ rule: 'r1', category: 'security' })];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), true)
      );
      expect(out).toContain('[security]');
    });

    it('includes line and column in file location', () => {
      const diags = [makeDiag({ filePath: 'src/foo.ts', line: 42, column: 7 })];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), true)
      );
      expect(out).toContain('src/foo.ts:42:7');
    });

    it('omits column when not present', () => {
      const diags = [makeDiag({ filePath: 'src/foo.ts', line: 42 })];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), true)
      );
      expect(out).toContain('src/foo.ts:42');
      expect(out).not.toContain('src/foo.ts:42:');
    });
  });

  describe('non-verbose mode', () => {
    it('hides detailed diagnostics', () => {
      const diags = [makeDiag({ rule: 'r1', filePath: 'file.ts', line: 1 })];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), false)
      );
      expect(out).not.toContain('file.ts:1');
      expect(out).not.toContain('All Diagnostics:');
    });

    it('shows --verbose hint', () => {
      const diags = [makeDiag({ rule: 'r1', filePath: 'file.ts', line: 1 })];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }), false)
      );
      expect(out).toContain('--verbose');
      expect(out).toContain('1 diagnostic');
    });
  });

  describe('diagnostic sorting', () => {
    it('shows errors before warnings in top issues', () => {
      const diags = [
        makeDiag({ rule: 'warning-rule', severity: 'warning', filePath: 'a.ts' }),
        makeDiag({ rule: 'error-rule', severity: 'error', filePath: 'b.ts' }),
      ];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 97, label: 'Great' } }), false)
      );
      const errorPos = out.indexOf('error-rule');
      const warningPos = out.indexOf('warning-rule');
      expect(errorPos).toBeLessThan(warningPos);
    });

    it('sorts by count within same severity', () => {
      const diags = [
        makeDiag({ rule: 'few-errors', severity: 'error', filePath: 'a.ts' }),
        makeDiag({ rule: 'many-errors', severity: 'error', filePath: 'b.ts' }),
        makeDiag({ rule: 'many-errors', severity: 'error', filePath: 'c.ts' }),
        makeDiag({ rule: 'many-errors', severity: 'error', filePath: 'd.ts' }),
      ];
      const out = stripAnsi(
        formatText(makeResult({ diagnostics: diags, score: { score: 95, label: 'Great' } }), false)
      );
      const manyPos = out.indexOf('many-errors');
      const fewPos = out.indexOf('few-errors');
      expect(manyPos).toBeLessThan(fewPos);
    });
  });

  describe('score gauge', () => {
    it('shows at least 1 filled block for low non-zero scores', () => {
      const out = formatText(makeResult({ score: { score: 2, label: 'Critical' } }), false);
      expect(out).toContain('█');
    });

    it('shows empty gauge for score of 0', () => {
      const out = stripAnsi(
        formatText(makeResult({ score: { score: 0, label: 'Critical' } }), false)
      );
      expect(out).toContain('░░░░░░░░░░░░░░░░░░░░');
      expect(out).toContain('0/100');
    });
  });
});
