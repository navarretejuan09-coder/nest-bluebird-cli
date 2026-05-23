import { describe, it, expect } from 'vitest';
import { isMigrationFile } from '../src/utils/is-migration-file.js';

describe('isMigrationFile', () => {
  describe('directory patterns', () => {
    it('should match files in migrations/ directory', () => {
      expect(isMigrationFile('migrations/CreateUsersTable.ts')).toBe(true);
      expect(isMigrationFile('src/migrations/1234567890123-Initial.ts')).toBe(true);
      expect(isMigrationFile('src/postgres/migrations/CreateCommsRepoPolicies.ts')).toBe(true);
    });

    it('should match files in migration/ directory (singular)', () => {
      expect(isMigrationFile('migration/CreateTable.ts')).toBe(true);
      expect(isMigrationFile('src/database/migration/Initial.ts')).toBe(true);
    });

    it('should match files in db/migrate/ directory (Rails-style)', () => {
      expect(isMigrationFile('db/migrate/20210101120000_create_users.ts')).toBe(true);
      expect(isMigrationFile('src/db/migrate/create_table.ts')).toBe(true);
    });

    it('should match files in database/migrations/ directory', () => {
      expect(isMigrationFile('database/migrations/CreateTable.ts')).toBe(true);
      expect(isMigrationFile('src/database/migrations/Initial.ts')).toBe(true);
    });
  });

  describe('path normalization', () => {
    it('should handle Windows-style backslash paths', () => {
      expect(isMigrationFile('src\\migrations\\CreateTable.ts')).toBe(true);
      expect(isMigrationFile('migrations\\Initial.ts')).toBe(true);
    });

    it('should handle mixed slashes', () => {
      expect(isMigrationFile('src/postgres\\migrations/CreateTable.ts')).toBe(true);
    });
  });

  describe('non-migration files', () => {
    it('should NOT match regular service files', () => {
      expect(isMigrationFile('src/users/users.service.ts')).toBe(false);
      expect(isMigrationFile('src/app.module.ts')).toBe(false);
    });

    it('should NOT match files with migration-like names outside migration directories', () => {
      // These are helpers/utilities, not actual migration files
      expect(isMigrationFile('src/utils/data-migrator.ts')).toBe(false);
      expect(isMigrationFile('src/services/MigrationHelper.ts')).toBe(false);
      expect(isMigrationFile('src/InitialMigration.ts')).toBe(false);
    });

    it('should NOT match controller or repository files', () => {
      expect(isMigrationFile('src/users/users.controller.ts')).toBe(false);
      expect(isMigrationFile('src/users/users.repository.ts')).toBe(false);
    });

    it('should NOT match config files', () => {
      expect(isMigrationFile('typeorm.config.ts')).toBe(false);
      expect(isMigrationFile('database.config.ts')).toBe(false);
    });

    it('should NOT match timestamp-prefixed files outside migration directories', () => {
      // Without a migration directory, timestamp prefixes alone are not enough
      expect(isMigrationFile('1752877418083-CreateCommsRepoPolicies.ts')).toBe(false);
      expect(isMigrationFile('20210101120000-create-users.ts')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should match deeply nested migration files', () => {
      expect(isMigrationFile('packages/core/src/database/migrations/CreateTable.ts')).toBe(true);
    });

    it('should match migration files with different extensions', () => {
      expect(isMigrationFile('migrations/CreateTable.js')).toBe(true);
      expect(isMigrationFile('migrations/CreateTable.mts')).toBe(true);
      expect(isMigrationFile('migrations/CreateTable.cjs')).toBe(true);
    });

    it('should match TypeORM-style migrations in migrations directory', () => {
      expect(
        isMigrationFile('src/postgres/migrations/1752877418083-CreateCommsRepoPolicies.ts')
      ).toBe(true);
      expect(isMigrationFile('migrations/1758141909696-CreateMissingRLSPolicies.ts')).toBe(true);
    });
  });
});
