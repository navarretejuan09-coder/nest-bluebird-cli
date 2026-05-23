import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RunnerWarning } from '../types.js';
import { isAnalysableTypeScript, toPosix } from './source-files.js';

const execFileAsync = promisify(execFile);

export interface DiffFilesResult {
  /**
   * Null when diff resolution fails (fallback: run full analysis).
   * Empty set means diff succeeded but no changed TS files were found.
   */
  files: Set<string> | null;
  warnings: RunnerWarning[];
}

export async function getChangedTypeScriptFiles(
  cwd: string,
  branch: string
): Promise<DiffFilesResult> {
  try {
    const { stdout: sha } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--verify', '--end-of-options', `${branch}^{commit}`],
      { encoding: 'utf8' }
    );

    const { stdout } = await execFileAsync(
      'git',
      ['-C', cwd, 'diff', '--name-only', '--diff-filter=ACMR', `${sha.trim()}...HEAD`],
      { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }
    );

    const files = new Set<string>();
    for (const raw of stdout.split('\n')) {
      const rel = toPosix(raw.trim());
      if (!rel || !isAnalysableTypeScript(rel)) continue;
      files.add(rel);
    }

    return { files, warnings: [] };
  } catch (err) {
    return {
      files: null,
      warnings: [
        {
          type: 'io-error',
          filePath: '.',
          message: `Failed to resolve diff against '${branch}' — running full analysis instead: ${
            err instanceof Error ? err.message : String(err)
          }`,
        },
      ],
    };
  }
}
