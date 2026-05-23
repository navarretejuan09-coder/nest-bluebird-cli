/**
 * Shared utility to detect database migration files based on directory patterns.
 * Used by rules that should skip migration files (e.g., no-raw-sql).
 *
 * Migration files typically contain DDL statements (CREATE TABLE, ALTER TABLE, etc.) that use
 * template interpolation for table/column names defined within the migration class itself.
 * These are not SQL injection risks because the interpolated values come from class properties,
 * not user input.
 */

/**
 * Directory patterns that indicate migration files.
 * Normalized to forward slashes for cross-platform compatibility.
 */
const MIGRATION_DIRECTORY_PATTERNS = [
  '/migrations/',
  '/migration/',
  '/db/migrate/',
  '/database/migrations/',
] as const;

/**
 * Directory patterns that can appear at the start of a path (no leading slash).
 */
const MIGRATION_DIRECTORY_START_PATTERNS = [
  'migrations/',
  'migration/',
  'db/migrate/',
  'database/migrations/',
] as const;

/**
 * Returns `true` when {@link filePath} appears to be a database migration file based on
 * directory patterns.
 *
 * Recognized patterns:
 * - Directory: `migrations/`, `migration/`, `db/migrate/`, `database/migrations/`
 *
 * We intentionally focus on directory patterns rather than file naming conventions
 * to avoid false positives (e.g., `MigrationHelper.ts`, `data-migrator.ts`).
 * Migration files should be placed in dedicated directories.
 *
 * @param filePath - The file path to check (can use forward or back slashes)
 * @returns `true` if the file appears to be a migration file
 *
 * @example
 * ```ts
 * isMigrationFile('src/postgres/migrations/1752877418083-CreateCommsRepoPolicies.ts') // true
 * isMigrationFile('migrations/20210101120000-create-users.ts') // true
 * isMigrationFile('src/database/migration/InitialMigration.ts') // true
 * isMigrationFile('src/users/users.service.ts') // false
 * isMigrationFile('src/services/MigrationHelper.ts') // false
 * ```
 */
export function isMigrationFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check directory patterns (anywhere in path)
  for (const pattern of MIGRATION_DIRECTORY_PATTERNS) {
    if (normalizedPath.includes(pattern)) {
      return true;
    }
  }

  // Check directory patterns at start of path
  for (const pattern of MIGRATION_DIRECTORY_START_PATTERNS) {
    if (normalizedPath.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}
