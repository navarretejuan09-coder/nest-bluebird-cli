import { execFile, spawn } from 'node:child_process';
import { platform } from 'node:os';

/**
 * Opens a file or URL in the default browser.
 * Cross-platform: works on macOS, Linux, and Windows.
 *
 * Security: Uses execFile/spawn with array arguments to prevent command injection.
 * The target path is passed as a separate argument, not interpolated into a shell command.
 */
export function openInBrowser(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform();

    if (os === 'darwin') {
      // macOS: use 'open' command
      execFile('open', [target], (error) => {
        if (error) {
          reject(new Error(`Failed to open browser: ${error.message}`));
        } else {
          resolve();
        }
      });
    } else if (os === 'win32') {
      // Windows: use 'start' command via cmd.exe
      // spawn is used because 'start' is a shell builtin, not an executable
      const child = spawn('cmd.exe', ['/c', 'start', '""', target], {
        stdio: 'ignore',
        detached: true,
      });
      child.on('error', (error) => {
        reject(new Error(`Failed to open browser: ${error.message}`));
      });
      child.unref();
      resolve();
    } else {
      // Linux and others: use 'xdg-open'
      execFile('xdg-open', [target], (error) => {
        if (error) {
          reject(new Error(`Failed to open browser: ${error.message}`));
        } else {
          resolve();
        }
      });
    }
  });
}
