import type { Diagnostic } from '../types.js';

export function combineDiagnostics(...sources: Diagnostic[][]): Diagnostic[] {
  return sources
    .flat()
    .sort((a, b) => a.filePath.localeCompare(b.filePath) || (a.line ?? 0) - (b.line ?? 0));
}
