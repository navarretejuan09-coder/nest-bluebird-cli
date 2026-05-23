import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { loadConfig, validateConfig, ConfigValidationError } from '../src/utils/load-config.js';

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual('node:fs/promises');
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

describe('validateConfig', () => {
  it('should throw when config is null', () => {
    expect(() => validateConfig(null)).toThrow(ConfigValidationError);
    expect(() => validateConfig(null)).toThrow('config must be a JSON object');
  });

  it('should throw when config is a string', () => {
    expect(() => validateConfig('hello')).toThrow(ConfigValidationError);
    expect(() => validateConfig('hello')).toThrow('config must be a JSON object');
  });

  it('should throw when config is an array', () => {
    expect(() => validateConfig([1, 2, 3])).toThrow(ConfigValidationError);
    expect(() => validateConfig([1, 2, 3])).toThrow('config must be a JSON object');
  });

  it('should throw when config is a number', () => {
    expect(() => validateConfig(42)).toThrow(ConfigValidationError);
  });

  it('should return empty config for empty object', () => {
    expect(validateConfig({})).toEqual({});
  });

  it('should accept valid ignore.rules', () => {
    const config = validateConfig({
      ignore: { rules: ['bluebird/no-god-controller', 'bluebird/no-god-service'] },
    });
    expect(config.ignore?.rules).toEqual(['bluebird/no-god-controller', 'bluebird/no-god-service']);
  });

  it('should accept valid ignore.files', () => {
    const config = validateConfig({ ignore: { files: ['src/generated/**'] } });
    expect(config.ignore?.files).toEqual(['src/generated/**']);
  });

  it('should throw on non-object ignore', () => {
    expect(() => validateConfig({ ignore: 'bad' })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ ignore: 'bad' })).toThrow('must be an object');
  });

  it('should throw on non-array ignore.rules', () => {
    expect(() => validateConfig({ ignore: { rules: 'bad' } })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ ignore: { rules: 'bad' } })).toThrow(
      'must be an array of strings'
    );
  });

  it('should throw on non-string items in ignore.rules', () => {
    expect(() => validateConfig({ ignore: { rules: [123] } })).toThrow(ConfigValidationError);
  });

  it('should throw on non-array ignore.files', () => {
    expect(() => validateConfig({ ignore: { files: 42 } })).toThrow(ConfigValidationError);
  });

  it('should accept valid boolean flags', () => {
    const config = validateConfig({
      lint: true,
      deadCode: false,
      graphAnalysis: true,
      verbose: false,
      includeHeuristic: true,
    });
    expect(config.lint).toBe(true);
    expect(config.deadCode).toBe(false);
    expect(config.graphAnalysis).toBe(true);
    expect(config.verbose).toBe(false);
    expect(config.includeHeuristic).toBe(true);
  });

  it('should throw on non-boolean lint', () => {
    expect(() => validateConfig({ lint: 'yes' })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ lint: 'yes' })).toThrow('must be a boolean');
  });

  it('should throw on non-boolean deadCode', () => {
    expect(() => validateConfig({ deadCode: 1 })).toThrow(ConfigValidationError);
  });

  it('should accept valid diff string', () => {
    const config = validateConfig({ diff: 'main' });
    expect(config.diff).toBe('main');
  });

  it('should throw on non-string diff', () => {
    expect(() => validateConfig({ diff: 123 })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ diff: 123 })).toThrow('must be a string');
  });

  it('should accept valid waivers', () => {
    const config = validateConfig({
      waivers: [
        { rule: 'bluebird/no-god-controller', file: 'src/legacy/**', reason: 'legacy code' },
      ],
    });
    expect(config.waivers).toHaveLength(1);
    expect(config.waivers![0].rule).toBe('bluebird/no-god-controller');
  });

  it('should throw on non-array waivers', () => {
    expect(() => validateConfig({ waivers: 'bad' })).toThrow(ConfigValidationError);
    expect(() => validateConfig({ waivers: 'bad' })).toThrow('must be an array');
  });

  it('should throw on waiver missing rule field', () => {
    expect(() => validateConfig({ waivers: [{ file: 'a.ts', reason: 'test' }] })).toThrow(
      ConfigValidationError
    );
    expect(() => validateConfig({ waivers: [{ file: 'a.ts', reason: 'test' }] })).toThrow(
      'waivers[0]'
    );
  });

  it('should throw on waiver missing file field', () => {
    expect(() => validateConfig({ waivers: [{ rule: 'bluebird/test', reason: 'test' }] })).toThrow(
      ConfigValidationError
    );
  });

  it('should throw on waiver missing reason field', () => {
    expect(() => validateConfig({ waivers: [{ rule: 'bluebird/test', file: 'a.ts' }] })).toThrow(
      ConfigValidationError
    );
  });

  it('should accept a full valid config', () => {
    const config = validateConfig({
      ignore: {
        rules: ['bluebird/no-sync-fs-operations'],
        files: ['src/generated/**'],
      },
      lint: true,
      deadCode: true,
      graphAnalysis: true,
      verbose: false,
      diff: 'main',
      includeHeuristic: false,
      waivers: [
        {
          rule: 'bluebird/no-sync-fs-operations',
          file: 'src/scripts/**',
          reason: 'CLI scripts run synchronously',
        },
      ],
    });
    expect(config.lint).toBe(true);
    expect(config.ignore?.rules).toEqual(['bluebird/no-sync-fs-operations']);
    expect(config.waivers).toHaveLength(1);
  });
});

describe('loadConfig', () => {
  beforeEach(() => {
    vi.mocked(readFile).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should load from bluebird.config.json', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ lint: true, deadCode: false }));

    const config = await loadConfig('/test');

    expect(readFile).toHaveBeenCalledWith('/test/bluebird.config.json', 'utf-8');
    expect(config.lint).toBe(true);
    expect(config.deadCode).toBe(false);
  });

  it('should fall through to package.json if config file not found', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(JSON.stringify({ name: 'my-app', bluebird: { verbose: true } }));

    const config = await loadConfig('/test');

    expect(config.verbose).toBe(true);
  });

  it('should return empty config if no config found', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockRejectedValueOnce(new Error('ENOENT'));

    const config = await loadConfig('/test');

    expect(config).toEqual({});
  });

  it('should return empty config if package.json has no bluebird key', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(JSON.stringify({ name: 'my-app' }));

    const config = await loadConfig('/test');

    expect(config).toEqual({});
  });

  it('should throw on invalid JSON in config file', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('not valid json{{{');

    await expect(loadConfig('/test')).rejects.toThrow(ConfigValidationError);
    await expect(loadConfig('/test')).rejects.toThrow('invalid JSON');
  });

  it('should throw on invalid config shape in config file', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify({ lint: 'not-a-boolean' }));

    await expect(loadConfig('/test')).rejects.toThrow(ConfigValidationError);
  });

  it('should throw when config file contains null', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('null');

    const err = await loadConfig('/test').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err!.message).toContain('config must be a JSON object');
  });

  it('should throw when config file contains an array', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('[1, 2, 3]');

    const err = await loadConfig('/test').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err!.message).toContain('config must be a JSON object');
  });

  it('should throw when config file contains a string', async () => {
    vi.mocked(readFile).mockResolvedValueOnce('"just a string"');

    const err = await loadConfig('/test').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err!.message).toContain('config must be a JSON object');
  });

  it('should throw when package.json bluebird key is a non-object', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(JSON.stringify({ name: 'my-app', bluebird: 'not-an-object' }));

    const err = await loadConfig('/test').catch((e: Error) => e);
    expect(err).toBeInstanceOf(ConfigValidationError);
    expect(err!.message).toContain('config must be a JSON object');
  });

  it('should throw on invalid config shape in package.json bluebird key', async () => {
    vi.mocked(readFile)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce(JSON.stringify({ name: 'my-app', bluebird: { lint: 'bad' } }));

    await expect(loadConfig('/test')).rejects.toThrow(ConfigValidationError);
  });

  it('should validate waivers from config file', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        waivers: [
          {
            rule: 'bluebird/no-god-controller',
            file: 'src/legacy/**',
            reason: 'Legacy code',
          },
        ],
      })
    );

    const config = await loadConfig('/test');

    expect(config.waivers).toHaveLength(1);
    expect(config.waivers![0].reason).toBe('Legacy code');
  });

  it('should load config with ignore patterns', async () => {
    vi.mocked(readFile).mockResolvedValueOnce(
      JSON.stringify({
        ignore: {
          rules: ['bluebird/no-god-controller'],
          files: ['src/generated/**', 'dist/**'],
        },
      })
    );

    const config = await loadConfig('/test');

    expect(config.ignore?.rules).toEqual(['bluebird/no-god-controller']);
    expect(config.ignore?.files).toEqual(['src/generated/**', 'dist/**']);
  });
});
