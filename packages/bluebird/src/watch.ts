import chokidar from 'chokidar';
import pc from 'picocolors';
import path from 'node:path';
import type { ScanCliOptions } from './scan.js';
import { scan } from './scan.js';

export interface WatchOptions extends Omit<ScanCliOptions, 'quiet' | 'scoreOnly'> {
  /** Debounce delay in milliseconds */
  debounceMs?: number;
}

/**
 * Watch mode: monitor source files and re-run analysis on changes.
 */
export async function watch(options: WatchOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const debounceMs = options.debounceMs ?? 500;

  console.log(pc.cyan('\n  Bluebird Watch Mode'));
  console.log(pc.dim('  Watching for file changes...\n'));

  // Run initial scan
  await runScan(options);

  // Set up file watcher
  const watcher = chokidar.watch(['**/*.ts', '**/*.tsx'], {
    cwd,
    ignored: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/.git/**', '**/coverage/**'],
    persistent: true,
    ignoreInitial: true,
  });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let isRunning = false;
  const pendingChanges = new Set<string>();

  const handleChange = (filePath: string) => {
    pendingChanges.add(filePath);

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(async () => {
      if (isRunning) {
        // If already running, wait and retry
        debounceTimer = setTimeout(() => handleChange(filePath), 100);
        return;
      }

      const changedFiles = [...pendingChanges];
      pendingChanges.clear();

      console.log(pc.dim(`\n  Changed: ${changedFiles.map((f) => path.basename(f)).join(', ')}`));
      console.log('');

      isRunning = true;
      await runScan(options);
      isRunning = false;

      console.log(pc.dim('\n  Watching for file changes... (Ctrl+C to exit)\n'));
    }, debounceMs);
  };

  watcher.on('change', handleChange);
  watcher.on('add', handleChange);
  watcher.on('unlink', handleChange);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(pc.dim('\n\n  Stopping watch mode...\n'));
    watcher.close();
    process.exit(0);
  });

  // Keep the process running
  await new Promise(() => {});
}

async function runScan(options: WatchOptions): Promise<void> {
  try {
    // Reset exit code for each run
    process.exitCode = 0;

    await scan({
      ...options,
      quiet: false,
      scoreOnly: false,
    });
  } catch (error) {
    console.error(pc.red('  Scan failed:'), error);
  }
}
