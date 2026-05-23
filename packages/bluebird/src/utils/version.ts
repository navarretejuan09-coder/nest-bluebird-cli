import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface PackageJson {
  version: string;
  name: string;
  repository?: { url: string } | string;
}

let cachedPackageJson: PackageJson | null = null;

const FALLBACK_PACKAGE_JSON: PackageJson = {
  name: 'bluebird',
  version: '0.0.0',
  repository: { url: 'https://github.com/endpointclosing/bluebird' },
};

function isPackageJson(value: unknown): value is PackageJson {
  if (typeof value !== 'object' || value === null) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.name === 'string' && typeof raw.version === 'string';
}

function readPackageJson(pkgPath: string): PackageJson | null {
  if (!existsSync(pkgPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf-8')) as unknown;
    return isPackageJson(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function loadPackageJson(): PackageJson {
  if (cachedPackageJson) return cachedPackageJson;

  const candidates = [join(__dirname, '../package.json'), join(__dirname, '../../package.json')];

  for (const candidate of candidates) {
    const parsed = readPackageJson(candidate);
    if (parsed) {
      cachedPackageJson = parsed;
      return cachedPackageJson;
    }
  }

  cachedPackageJson = FALLBACK_PACKAGE_JSON;
  return cachedPackageJson;
}

export function getVersion(): string {
  return loadPackageJson().version;
}

export function getRepositoryUrl(): string {
  const pkg = loadPackageJson();
  if (!pkg.repository) return 'https://github.com/endpointclosing/bluebird';
  if (typeof pkg.repository === 'string') return pkg.repository;
  return pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
}
