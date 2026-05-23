import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { RunnerWarning } from '../types.js';

const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.turbo',
  '.next',
  '.nx',
  'build',
  'out',
]);

const DECLARATION_SUFFIXES = ['.d.ts', '.d.mts', '.d.cts'];
const TS_SUFFIXES = ['.ts', '.mts', '.cts'];

const FILE_READ_CONCURRENCY = 64;

export const toPosix = (p: string): string => p.replaceAll('\\', '/');

export function isAnalysableTypeScript(name: string): boolean {
  if (DECLARATION_SUFFIXES.some((s) => name.endsWith(s))) return false;
  return TS_SUFFIXES.some((s) => name.endsWith(s));
}

async function pMap<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

async function collectTypeScriptFiles(
  dir: string,
  root: string,
  warnings: RunnerWarning[]
): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    warnings.push({
      type: 'io-error',
      filePath: toPosix(relative(root, dir)) || '.',
      message: `Could not read directory: ${err instanceof Error ? err.message : String(err)}`,
    });
    return results;
  }

  const subdirPromises: Promise<string[]>[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        subdirPromises.push(collectTypeScriptFiles(join(dir, entry.name), root, warnings));
      }
    } else if (isAnalysableTypeScript(entry.name)) {
      results.push(toPosix(relative(root, join(dir, entry.name))));
    }
  }

  const subResults = await Promise.all(subdirPromises);
  for (const sub of subResults) results.push(...sub);
  return results;
}

export interface LoadedTypeScriptFiles {
  files: Map<string, string>;
  warnings: RunnerWarning[];
}

export interface LoadTypeScriptFilesOptions {
  cwd: string;
  includeFiles?: ReadonlySet<string>;
}

export async function loadTypeScriptFiles(
  options: LoadTypeScriptFilesOptions
): Promise<LoadedTypeScriptFiles> {
  const { cwd, includeFiles } = options;
  const warnings: RunnerWarning[] = [];

  let relativePaths: string[];

  if (includeFiles) {
    if (includeFiles.size === 0) return { files: new Map(), warnings };
    relativePaths = [...includeFiles];
  } else {
    relativePaths = await collectTypeScriptFiles(cwd, cwd, warnings);
  }

  const fileEntries = await pMap(
    relativePaths,
    async (relPath) => {
      try {
        const content = await readFile(join(cwd, relPath), 'utf-8');
        return { relPath, content } as const;
      } catch (err) {
        warnings.push({
          type: 'io-error',
          filePath: relPath,
          message: `Could not read file: ${err instanceof Error ? err.message : String(err)}`,
        });
        return null;
      }
    },
    FILE_READ_CONCURRENCY
  );

  const files = new Map<string, string>();
  for (const entry of fileEntries) {
    if (entry) files.set(entry.relPath, entry.content);
  }

  return { files, warnings };
}
