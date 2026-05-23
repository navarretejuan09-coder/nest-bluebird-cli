import { describe, it, expect } from 'vitest';
import { getChangedTypeScriptFiles } from '../src/utils/diff-files.js';

describe('getChangedTypeScriptFiles', () => {
  const cwd = process.cwd();

  it('should return null files and warning when branch does not exist', async () => {
    const result = await getChangedTypeScriptFiles(cwd, 'nonexistent-branch-xyz123');

    expect(result.files).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('io-error');
    expect(result.warnings[0].message).toContain('nonexistent-branch-xyz123');
    expect(result.warnings[0].message).toContain('running full analysis instead');
  });

  it('should return null files and warning when cwd is not a git repository', async () => {
    // Use /tmp which is unlikely to be a git repo
    const result = await getChangedTypeScriptFiles('/tmp', 'main');

    expect(result.files).toBeNull();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('io-error');
  });

  it('should return files set (possibly empty) when diffing against valid branch', async () => {
    // HEAD is always valid in a git repo
    const result = await getChangedTypeScriptFiles(cwd, 'HEAD');

    // Should succeed - files will be empty since HEAD..HEAD has no diff
    expect(result.files).not.toBeNull();
    expect(result.files).toBeInstanceOf(Set);
    expect(result.warnings).toHaveLength(0);
  });

  it('should return files or warning when diffing against main branch', async () => {
    // This test runs in the bluebird repo which has a main branch
    // In CI with shallow clone, main might not be available
    const result = await getChangedTypeScriptFiles(cwd, 'main');

    // Either succeeds with files, or fails gracefully with a warning
    if (result.files !== null) {
      expect(result.files).toBeInstanceOf(Set);
      expect(result.warnings).toHaveLength(0);
    } else {
      // CI shallow clone - expect graceful degradation
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].type).toBe('io-error');
    }
  });

  it('should filter to only TypeScript files when diff succeeds', async () => {
    // Diff against HEAD~1 if available (may not be in shallow clone)
    const result = await getChangedTypeScriptFiles(cwd, 'HEAD~1');

    // In shallow clone, this might fail gracefully
    if (result.files !== null && result.files.size > 0) {
      // All returned files should be .ts or .tsx
      for (const file of result.files) {
        expect(file).toMatch(/\.tsx?$/);
        // Should not include test files, node_modules, or dist
        expect(file).not.toMatch(/\.spec\.ts$/);
        expect(file).not.toMatch(/\.test\.ts$/);
        expect(file).not.toContain('node_modules');
        expect(file).not.toContain('dist/');
      }
      expect(result.warnings).toHaveLength(0);
    }
    // If files is null, it's expected in shallow clone - just verify warning exists
    if (result.files === null) {
      expect(result.warnings.length).toBeGreaterThan(0);
    }
  });
});
