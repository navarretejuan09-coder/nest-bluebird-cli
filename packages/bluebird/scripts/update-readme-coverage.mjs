#!/usr/bin/env node

/**
 * Reads coverage-summary.json and vitest output to update the
 * Stability section of the root README with current stats.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, '..');
const repoRoot = resolve(pkgRoot, '../..');

const summaryPath = resolve(pkgRoot, 'coverage/coverage-summary.json');
const readmePath = resolve(repoRoot, 'README.md');

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const total = summary.total;

const stmts = total.statements.pct;
const branches = total.branches.pct;
const funcs = total.functions.pct;
const lines = total.lines.pct;

const testCount = getTestCount();
const srcLines = countSourceLines();
const testLines = countTestLines();
const ratio = testLines && srcLines ? (testLines / srcLines).toFixed(1) : null;

let readme = readFileSync(readmePath, 'utf8');

readme = readme.replace(
  /- \*\*\d+\+? tests\*\*.*/,
  `- **${testCount}+ tests** with a ${ratio}:1 test-to-code ratio`,
);

const coverageLine = `- **${lines}% line coverage** (statements ${stmts}% · branches ${branches}% · functions ${funcs}%)`;
const coveragePattern = /- \*\*[\d.]+% line coverage\*\*.*/;

if (coveragePattern.test(readme)) {
  readme = readme.replace(coveragePattern, coverageLine);
} else {
  readme = readme.replace(
    /(- \*\*\d+\+? tests\*\*.*)/,
    `$1\n${coverageLine}`,
  );
}

writeFileSync(readmePath, readme);

console.log(`✓ README updated — ${testCount} tests, ${lines}% line coverage`);

function getTestCount() {
  try {
    const output = execSync('npx vitest run --reporter=json 2>/dev/null', {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const json = JSON.parse(output);
    return json.numPassedTests ?? json.numTotalTests ?? '?';
  } catch {
    const result = execSync('npx vitest run 2>&1', {
      cwd: pkgRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = result.match(/Tests\s+(\d+)\s+passed/);
    return match ? parseInt(match[1], 10) : '?';
  }
}

function countSourceLines() {
  try {
    const out = execSync(
      "find src -name '*.ts' ! -name '*.d.ts' ! -name 'cli.ts' -exec cat {} + | wc -l",
      { cwd: pkgRoot, encoding: 'utf8' },
    );
    return parseInt(out.trim(), 10);
  } catch {
    return 0;
  }
}

function countTestLines() {
  try {
    const out = execSync(
      "find tests -name '*.test.ts' -exec cat {} + | wc -l",
      { cwd: pkgRoot, encoding: 'utf8' },
    );
    return parseInt(out.trim(), 10);
  } catch {
    return 0;
  }
}
