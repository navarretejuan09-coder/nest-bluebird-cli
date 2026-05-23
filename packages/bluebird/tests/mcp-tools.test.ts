import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDiagnose, handleHealth, handleLayers } from '../src/mcp/tools.js';

// Mock the diagnose module to avoid running actual analysis
vi.mock('../src/index.js', () => ({
  diagnose: vi.fn().mockResolvedValue({
    score: { score: 85, label: 'Good' },
    project: { nestVersion: '10.0.0' },
    diagnostics: [],
    warnings: [],
  }),
}));

// Mock layers module
vi.mock('../src/utils/layers.js', () => ({
  loadSourceFilesForLayers: vi.fn().mockResolvedValue([]),
  analyseModuleLayers: vi.fn().mockResolvedValue({
    layers: [],
    violations: [],
    maxLayer: 0,
    layerCounts: {},
    verdict: 'Clean',
  }),
}));

describe('MCP Tools - Path Validation', () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  describe('handleDiagnose', () => {
    it('should accept undefined cwd and use process.cwd()', async () => {
      const result = await handleDiagnose({});
      expect(result.isError).toBeUndefined();
    });

    it('should accept valid absolute path', async () => {
      const result = await handleDiagnose({ cwd: process.cwd() });
      expect(result.isError).toBeUndefined();
    });

    it('should reject path traversal attempts with relative paths', async () => {
      const result = await handleDiagnose({ cwd: '../../../etc' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Invalid path');
    });

    it('should reject non-existent paths', async () => {
      const result = await handleDiagnose({ cwd: '/nonexistent/path/12345' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('does not exist');
    });
  });

  describe('handleHealth', () => {
    it('should accept undefined cwd and use process.cwd()', async () => {
      const result = await handleHealth({});
      expect(result.isError).toBeUndefined();
    });

    it('should reject path traversal attempts', async () => {
      const result = await handleHealth({ cwd: '../../..' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleLayers', () => {
    it('should accept undefined cwd and use process.cwd()', async () => {
      const result = await handleLayers({});
      expect(result.isError).toBeUndefined();
    });

    it('should reject path traversal attempts', async () => {
      const result = await handleLayers({ cwd: '../../../tmp' });
      expect(result.isError).toBe(true);
    });
  });
});
