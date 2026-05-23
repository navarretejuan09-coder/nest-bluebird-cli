import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BluebirdConfig, Waiver } from '../types.js';

const CONFIG_FILE = 'bluebird.config.json';
const PKG_KEY = 'bluebird';

export class ConfigValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`Invalid config field "${field}": ${message}`);
    this.name = 'ConfigValidationError';
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isValidWaiver(value: unknown): value is Waiver {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.rule === 'string' && typeof obj.file === 'string' && typeof obj.reason === 'string'
  );
}

export function validateConfig(value: unknown): BluebirdConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConfigValidationError('(root)', 'config must be a JSON object');
  }
  const raw = value as Record<string, unknown>;
  const config: BluebirdConfig = {};

  if ('ignore' in raw) {
    if (typeof raw.ignore !== 'object' || raw.ignore === null) {
      throw new ConfigValidationError('ignore', 'must be an object');
    }
    const ignore = raw.ignore as Record<string, unknown>;
    config.ignore = {};
    if ('rules' in ignore) {
      if (!isStringArray(ignore.rules)) {
        throw new ConfigValidationError('ignore.rules', 'must be an array of strings');
      }
      config.ignore.rules = ignore.rules;
    }
    if ('files' in ignore) {
      if (!isStringArray(ignore.files)) {
        throw new ConfigValidationError('ignore.files', 'must be an array of strings');
      }
      config.ignore.files = ignore.files;
    }
  }

  for (const key of ['lint', 'deadCode', 'graphAnalysis', 'verbose', 'includeHeuristic'] as const) {
    if (key in raw) {
      if (typeof raw[key] !== 'boolean') {
        throw new ConfigValidationError(key, 'must be a boolean');
      }
      config[key] = raw[key] as boolean;
    }
  }

  if ('diff' in raw) {
    if (typeof raw.diff !== 'string') {
      throw new ConfigValidationError('diff', 'must be a string');
    }
    config.diff = raw.diff;
  }

  if ('waivers' in raw) {
    if (!Array.isArray(raw.waivers)) {
      throw new ConfigValidationError('waivers', 'must be an array');
    }
    for (let i = 0; i < raw.waivers.length; i++) {
      if (!isValidWaiver(raw.waivers[i])) {
        throw new ConfigValidationError(
          `waivers[${i}]`,
          'each waiver must have "rule", "file", and "reason" string fields'
        );
      }
    }
    config.waivers = raw.waivers as Waiver[];
  }

  return config;
}

export async function loadConfig(cwd: string): Promise<BluebirdConfig> {
  const configPath = join(cwd, CONFIG_FILE);
  try {
    const raw = await readFile(configPath, 'utf-8');
    return validateConfig(JSON.parse(raw));
  } catch (err) {
    if (err instanceof ConfigValidationError) throw err;
    if (err instanceof SyntaxError) {
      throw new ConfigValidationError('(root)', `${CONFIG_FILE} contains invalid JSON`);
    }
    // file not found — fall through to package.json
  }

  const pkgPath = join(cwd, 'package.json');
  try {
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    if (pkg[PKG_KEY] != null) {
      return validateConfig(pkg[PKG_KEY]);
    }
  } catch (err) {
    if (err instanceof ConfigValidationError) throw err;
  }

  return {};
}
