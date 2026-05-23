import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BaselineEntry, BaselineFile, Diagnostic } from '../types.js';

export const BASELINE_FILE = '.bluebird-baseline.json';

export function baselineKey(entry: { rule: string; filePath: string; line?: number }): string {
  return `${entry.rule}::${entry.filePath}::${entry.line ?? 0}`;
}

export function diagnosticsToEntries(diagnostics: Diagnostic[]): BaselineEntry[] {
  return diagnostics.map((d) => ({
    rule: d.rule,
    filePath: d.filePath,
    line: d.line ?? 0,
  }));
}

export async function loadBaseline(cwd: string): Promise<BaselineFile | null> {
  const baselinePath = join(cwd, BASELINE_FILE);
  try {
    const raw = await readFile(baselinePath, 'utf-8');
    const parsed = JSON.parse(raw) as BaselineFile;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveBaseline(cwd: string, diagnostics: Diagnostic[]): Promise<string> {
  const baselinePath = join(cwd, BASELINE_FILE);
  const baseline: BaselineFile = {
    version: 1,
    createdAt: new Date().toISOString(),
    entries: diagnosticsToEntries(diagnostics),
  };
  await writeFile(baselinePath, JSON.stringify(baseline, null, 2) + '\n', 'utf-8');
  return baselinePath;
}

export function applyBaseline(diagnostics: Diagnostic[], baseline: BaselineFile): Diagnostic[] {
  const baselineKeys = new Set(baseline.entries.map((e) => baselineKey(e)));
  return diagnostics.filter((d) => !baselineKeys.has(baselineKey(d)));
}
