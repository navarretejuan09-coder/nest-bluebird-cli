import { describe, expect, it } from 'vitest';
import { formatSarif } from '../src/utils/format-sarif.js';
import { getVersion } from '../src/utils/version.js';
import type { Diagnostic, ScanResult, ProjectInfo } from '../src/types.js';

const baseProject: ProjectInfo = {
  nestVersion: '10.3.0',
  httpAdapter: 'fastify',
  orm: 'prisma',
  features: {
    graphql: true,
    websockets: false,
    microservices: false,
    cqrs: false,
    swagger: true,
    bull: false,
    config: false,
    throttler: false,
    cache: false,
  },
  strictTypeScript: true,
  hasTests: true,
  sourceFileCount: 35,
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

describe('formatSarif', () => {
  it('returns valid JSON', () => {
    const raw = formatSarif(makeResult());
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('uses SARIF 2.1.0 schema and version', () => {
    const log = JSON.parse(formatSarif(makeResult()));
    expect(log.version).toBe('2.1.0');
    expect(log.$schema).toContain('sarif-schema-2.1.0');
  });

  it('has exactly one run with bluebird as the tool', () => {
    const log = JSON.parse(formatSarif(makeResult()));
    expect(log.runs).toHaveLength(1);
    expect(log.runs[0].tool.driver.name).toBe('bluebird');
    expect(log.runs[0].tool.driver.version).toBe(getVersion());
  });

  it('produces empty results for zero diagnostics', () => {
    const log = JSON.parse(formatSarif(makeResult()));
    expect(log.runs[0].results).toEqual([]);
    expect(log.runs[0].tool.driver.rules).toEqual([]);
  });

  it('creates unique rule entries and maps results correctly', () => {
    const diags = [
      makeDiag({ rule: 'no-god-service', severity: 'error', filePath: 'a.ts', line: 10 }),
      makeDiag({ rule: 'no-god-service', severity: 'error', filePath: 'b.ts', line: 20 }),
      makeDiag({ rule: 'missing-injectable', severity: 'warning', filePath: 'c.ts', line: 5 }),
    ];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 96, label: 'Great' } }))
    );

    const rules = log.runs[0].tool.driver.rules;
    expect(rules).toHaveLength(2);
    expect(rules[0].id).toBe('no-god-service');
    expect(rules[1].id).toBe('missing-injectable');

    const results = log.runs[0].results;
    expect(results).toHaveLength(3);

    expect(results[0].ruleId).toBe('no-god-service');
    expect(results[0].ruleIndex).toBe(0);
    expect(results[1].ruleId).toBe('no-god-service');
    expect(results[1].ruleIndex).toBe(0);
    expect(results[2].ruleId).toBe('missing-injectable');
    expect(results[2].ruleIndex).toBe(1);
  });

  it('maps error severity to SARIF error level', () => {
    const diags = [makeDiag({ severity: 'error' })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    expect(log.runs[0].results[0].level).toBe('error');
    expect(log.runs[0].tool.driver.rules[0].defaultConfiguration.level).toBe('error');
  });

  it('maps warning severity to SARIF warning level', () => {
    const diags = [makeDiag({ severity: 'warning' })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    expect(log.runs[0].results[0].level).toBe('warning');
  });

  it('includes file location with line and column', () => {
    const diags = [makeDiag({ filePath: 'src/foo.ts', line: 42, column: 7 })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const loc = log.runs[0].results[0].locations[0].physicalLocation;
    expect(loc.artifactLocation.uri).toBe('src/foo.ts');
    expect(loc.region.startLine).toBe(42);
    expect(loc.region.startColumn).toBe(7);
  });

  it('omits column from region when not present', () => {
    const diags = [makeDiag({ filePath: 'src/foo.ts', line: 10 })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const region = log.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region.startLine).toBe(10);
    expect(region).not.toHaveProperty('startColumn');
  });

  it('omits region entirely when line is not present', () => {
    const diags = [makeDiag({ filePath: 'src/foo.ts', line: undefined })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const phys = log.runs[0].results[0].locations[0].physicalLocation;
    expect(phys).not.toHaveProperty('region');
  });

  it('omits region when line is 0 (non-positional finding)', () => {
    const diags = [makeDiag({ filePath: 'src/foo.ts', line: 0 })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const phys = log.runs[0].results[0].locations[0].physicalLocation;
    expect(phys).not.toHaveProperty('region');
  });

  it('omits startColumn when column is 0', () => {
    const diags = [makeDiag({ filePath: 'src/foo.ts', line: 5, column: 0 })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const region = log.runs[0].results[0].locations[0].physicalLocation.region;
    expect(region.startLine).toBe(5);
    expect(region).not.toHaveProperty('startColumn');
  });

  it('normalizes backslash paths to forward slashes in artifact URIs', () => {
    const diags = [makeDiag({ filePath: 'src\\controllers\\app.controller.ts', line: 1 })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const uri = log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri;
    expect(uri).toBe('src/controllers/app.controller.ts');
  });

  it('includes rule category and confidence in rule properties', () => {
    const diags = [makeDiag({ category: 'security', confidence: 'heuristic' })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    const props = log.runs[0].tool.driver.rules[0].properties;
    expect(props.category).toBe('security');
    expect(props.confidence).toBe('heuristic');
  });

  it('includes score and baselinedCount in run properties', () => {
    const log = JSON.parse(
      formatSarif(makeResult({ score: { score: 72, label: 'Needs work' }, baselinedCount: 3 }))
    );
    const props = log.runs[0].properties;
    expect(props.score).toBe(72);
    expect(props.label).toBe('Needs work');
    expect(props.baselinedCount).toBe(3);
  });

  it('uses help text for rule shortDescription when available', () => {
    const diags = [makeDiag({ help: 'Inject via constructor', message: 'fallback msg' })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    expect(log.runs[0].tool.driver.rules[0].shortDescription.text).toBe('Inject via constructor');
  });

  it('falls back to message for rule shortDescription when help is missing', () => {
    const diags = [makeDiag({ help: undefined, message: 'service too large' })];
    const log = JSON.parse(
      formatSarif(makeResult({ diagnostics: diags, score: { score: 99, label: 'Great' } }))
    );
    expect(log.runs[0].tool.driver.rules[0].shortDescription.text).toBe('service too large');
  });
});
