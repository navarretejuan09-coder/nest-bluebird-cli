import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import {
  baselineKey,
  diagnosticsToEntries,
  loadBaseline,
  saveBaseline,
  applyBaseline,
  BASELINE_FILE,
} from '../src/utils/baseline.js';
import type { BaselineFile, Diagnostic } from '../src/types.js';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

function makeDiag(overrides: Partial<Diagnostic> = {}): Diagnostic {
  return {
    filePath: 'src/app.controller.ts',
    plugin: 'bluebird',
    rule: 'bluebird/no-god-controller',
    severity: 'error',
    message: 'Controller has too many routes',
    category: 'architecture',
    confidence: 'deterministic',
    line: 10,
    ...overrides,
  };
}

describe('baselineKey', () => {
  it('should combine rule, filePath, and line', () => {
    expect(baselineKey({ rule: 'bluebird/test', filePath: 'src/a.ts', line: 5 })).toBe(
      'bluebird/test::src/a.ts::5'
    );
  });

  it('should default line to 0 when undefined', () => {
    expect(baselineKey({ rule: 'bluebird/test', filePath: 'src/a.ts' })).toBe(
      'bluebird/test::src/a.ts::0'
    );
  });
});

describe('diagnosticsToEntries', () => {
  it('should convert diagnostics to baseline entries', () => {
    const diagnostics = [
      makeDiag({ rule: 'bluebird/test', filePath: 'a.ts', line: 10 }),
      makeDiag({ rule: 'bluebird/other', filePath: 'b.ts', line: undefined }),
    ];
    const entries = diagnosticsToEntries(diagnostics);
    expect(entries).toEqual([
      { rule: 'bluebird/test', filePath: 'a.ts', line: 10 },
      { rule: 'bluebird/other', filePath: 'b.ts', line: 0 },
    ]);
  });

  it('should return empty array for no diagnostics', () => {
    expect(diagnosticsToEntries([])).toEqual([]);
  });
});

describe('loadBaseline', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load a valid baseline file', async () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [{ rule: 'bluebird/test', filePath: 'a.ts', line: 10 }],
    };
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

    const result = await loadBaseline('/test');

    expect(readFile).toHaveBeenCalledWith(`/test/${BASELINE_FILE}`, 'utf-8');
    expect(result).toEqual(baseline);
  });

  it('should return null if baseline file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'));

    const result = await loadBaseline('/test');

    expect(result).toBeNull();
  });

  it('should return null if baseline file has invalid JSON', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('not valid json');

    const result = await loadBaseline('/test');

    expect(result).toBeNull();
  });

  it('should return null if baseline file has wrong version', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ version: 2, entries: [] }));

    const result = await loadBaseline('/test');

    expect(result).toBeNull();
  });

  it('should return null if baseline file has no entries array', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ version: 1, createdAt: 'x' }));

    const result = await loadBaseline('/test');

    expect(result).toBeNull();
  });
});

describe('saveBaseline', () => {
  beforeEach(() => {
    vi.mocked(writeFile).mockReset();
    vi.mocked(writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should save diagnostics as a baseline file', async () => {
    const diagnostics = [
      makeDiag({ rule: 'bluebird/test', filePath: 'a.ts', line: 10 }),
      makeDiag({ rule: 'bluebird/other', filePath: 'b.ts', line: 20 }),
    ];

    const path = await saveBaseline('/test', diagnostics);

    expect(path).toBe(`/test/${BASELINE_FILE}`);
    expect(writeFile).toHaveBeenCalledWith(`/test/${BASELINE_FILE}`, expect.any(String), 'utf-8');

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent) as BaselineFile;
    expect(parsed.version).toBe(1);
    expect(parsed.createdAt).toBeTruthy();
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries[0]).toEqual({ rule: 'bluebird/test', filePath: 'a.ts', line: 10 });
  });

  it('should save empty baseline for no diagnostics', async () => {
    await saveBaseline('/test', []);

    const writtenContent = vi.mocked(writeFile).mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenContent) as BaselineFile;
    expect(parsed.entries).toEqual([]);
  });
});

describe('applyBaseline', () => {
  it('should filter out diagnostics that exist in the baseline', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [
        { rule: 'bluebird/no-god-controller', filePath: 'src/app.controller.ts', line: 10 },
      ],
    };
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/app.controller.ts',
        line: 10,
      }),
      makeDiag({
        rule: 'bluebird/no-hardcoded-secrets',
        filePath: 'src/config.ts',
        line: 5,
      }),
    ];

    const result = applyBaseline(diagnostics, baseline);

    expect(result).toHaveLength(1);
    expect(result[0].rule).toBe('bluebird/no-hardcoded-secrets');
  });

  it('should keep new diagnostics not in baseline', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [
        { rule: 'bluebird/no-god-controller', filePath: 'src/old.controller.ts', line: 10 },
      ],
    };
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/new.controller.ts',
        line: 15,
      }),
    ];

    const result = applyBaseline(diagnostics, baseline);

    expect(result).toHaveLength(1);
  });

  it('should keep diagnostic if same rule+file but different line', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [
        { rule: 'bluebird/no-god-controller', filePath: 'src/app.controller.ts', line: 10 },
      ],
    };
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/app.controller.ts',
        line: 25,
      }),
    ];

    const result = applyBaseline(diagnostics, baseline);

    expect(result).toHaveLength(1);
  });

  it('should filter all diagnostics when all are baselined', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [
        { rule: 'bluebird/no-god-controller', filePath: 'src/app.controller.ts', line: 10 },
        { rule: 'bluebird/no-hardcoded-secrets', filePath: 'src/config.ts', line: 5 },
      ],
    };
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/app.controller.ts',
        line: 10,
      }),
      makeDiag({
        rule: 'bluebird/no-hardcoded-secrets',
        filePath: 'src/config.ts',
        line: 5,
      }),
    ];

    const result = applyBaseline(diagnostics, baseline);

    expect(result).toEqual([]);
  });

  it('should return all diagnostics when baseline is empty', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [],
    };
    const diagnostics = [makeDiag()];

    const result = applyBaseline(diagnostics, baseline);

    expect(result).toHaveLength(1);
  });

  it('should handle diagnostics with no line number against baseline with line 0', () => {
    const baseline: BaselineFile = {
      version: 1,
      createdAt: '2025-01-01T00:00:00.000Z',
      entries: [{ rule: 'bluebird/no-god-controller', filePath: 'src/app.controller.ts', line: 0 }],
    };
    const diagnostics = [
      makeDiag({
        rule: 'bluebird/no-god-controller',
        filePath: 'src/app.controller.ts',
        line: undefined,
      }),
    ];

    const result = applyBaseline(diagnostics, baseline);

    expect(result).toEqual([]);
  });
});
