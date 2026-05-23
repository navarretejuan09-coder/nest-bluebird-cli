/**
 * File name patterns for CLI / migration / worker entry points that use NestFactory
 * but are not HTTP servers — they should not be held to bootstrap security rules.
 */
const CLI_ENTRY_POINT_PATTERNS = [
  /run[_-]?migrations?\.ts$/i,
  /run[_-]?migrations?\.js$/i,
  /migrations?\.ts$/i,
  /data[_-]?source\.ts$/i,
  /seed(er)?\.ts$/i,
  /cli\.ts$/i,
  /console\.ts$/i,
  /worker\.ts$/i,
  /job\.ts$/i,
  /cron\.ts$/i,
  /task\.ts$/i,
  /command\.ts$/i,
  /repl\.ts$/i,
] as const;

/**
 * True when the path looks like a non-HTTP Nest entry file (migrations, workers, etc.).
 */
export function isCliEntryPoint(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return CLI_ENTRY_POINT_PATTERNS.some((pattern) => pattern.test(normalizedPath));
}
