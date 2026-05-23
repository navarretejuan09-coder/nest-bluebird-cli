import pc from 'picocolors';
import type { Diagnostic, RuleCategory, ScanResult, ScoreResult } from '../types.js';
import { SCORE_THRESHOLD_GREAT, SCORE_THRESHOLD_NEEDS_WORK } from '../constants.js';

function bluebirdLogo(): string {
  const bird = pc.blue(`    __
   (o >
  (____)~
   |  |`);
  const title = pc.bold('Bluebird');
  const subtitle = pc.dim('NestJS Health Report');

  // Combine bird with title on the right
  const birdLines = bird.split('\n');
  const textLines = ['', title, subtitle, ''];

  return birdLines.map((line, i) => line + '  ' + (textLines[i] || '')).join('\n');
}

function colorByScore(score: number, text: string): string {
  if (score >= SCORE_THRESHOLD_GREAT) return pc.green(text);
  if (score >= SCORE_THRESHOLD_NEEDS_WORK) return pc.yellow(text);
  return pc.red(text);
}

function severityIcon(severity: Diagnostic['severity']): string {
  return severity === 'error' ? pc.red('✖') : pc.yellow('⚠');
}

function scoreBox(result: ScoreResult): string {
  const filled = result.score === 0 ? 0 : Math.max(1, Math.round(result.score / 5));
  const empty = 20 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const coloredBar = colorByScore(result.score, bar);
  const label = colorByScore(result.score, result.label);
  const scoreText = colorByScore(result.score, String(result.score));

  const innerContent = `  Score: ${scoreText}/100  ${coloredBar}  ${label}  `;

  // eslint-disable-next-line no-control-regex
  const plainLen = innerContent.replace(/\x1b\[[0-9;]*m/g, '').length;
  const top = `┌${'─'.repeat(plainLen)}┐`;
  const bot = `└${'─'.repeat(plainLen)}┘`;

  return `${top}\n│${innerContent}│\n${bot}`;
}

interface CategoryStats {
  errors: number;
  warnings: number;
}

const CATEGORY_DISPLAY_ORDER: RuleCategory[] = [
  'security',
  'correctness',
  'architecture',
  'performance',
  'database',
  'api-design',
  'testing',
  'microservices',
  'graphql',
  'websockets',
  'dead-code',
];

const CATEGORY_LABELS: Record<RuleCategory, string> = {
  security: 'Security',
  correctness: 'Correctness',
  architecture: 'Architecture',
  performance: 'Performance',
  database: 'Database',
  'api-design': 'API Design',
  testing: 'Testing',
  microservices: 'Microservices',
  graphql: 'GraphQL',
  websockets: 'WebSockets',
  'dead-code': 'Dead Code',
};

function groupByCategory(diagnostics: Diagnostic[]): Map<RuleCategory, CategoryStats> {
  const map = new Map<RuleCategory, CategoryStats>();
  for (const d of diagnostics) {
    let stats = map.get(d.category);
    if (!stats) {
      stats = { errors: 0, warnings: 0 };
      map.set(d.category, stats);
    }
    if (d.severity === 'error') {
      stats.errors++;
    } else {
      stats.warnings++;
    }
  }
  return map;
}

interface RuleStats {
  rule: string;
  severity: Diagnostic['severity'];
  help: string | undefined;
  count: number;
}

function groupByRule(diagnostics: Diagnostic[]): RuleStats[] {
  const map = new Map<string, RuleStats>();
  for (const d of diagnostics) {
    let stats = map.get(d.rule);
    if (!stats) {
      stats = { rule: d.rule, severity: d.severity, help: d.help, count: 0 };
      map.set(d.rule, stats);
    }
    stats.count++;
  }

  // Sort by severity (errors first), then by count (most occurrences first)
  return [...map.values()].sort((a, b) => {
    const sevA = a.severity === 'error' ? 0 : 1;
    const sevB = b.severity === 'error' ? 0 : 1;
    if (sevA !== sevB) return sevA - sevB;
    return b.count - a.count;
  });
}

function formatCategorySection(diagnostics: Diagnostic[]): string[] {
  const lines: string[] = [];
  const byCategory = groupByCategory(diagnostics);

  if (byCategory.size === 0) return lines;

  lines.push('  ' + pc.bold('By Category:'));

  // Find max label length for alignment
  const maxLabelLen = Math.max(
    ...CATEGORY_DISPLAY_ORDER.filter((c) => byCategory.has(c)).map((c) => CATEGORY_LABELS[c].length)
  );

  for (const category of CATEGORY_DISPLAY_ORDER) {
    const stats = byCategory.get(category);
    if (!stats) continue;

    const label = CATEGORY_LABELS[category].padEnd(maxLabelLen);
    const parts: string[] = [];

    if (stats.errors > 0) {
      parts.push(pc.red(`✖ ${stats.errors}`));
    }
    if (stats.warnings > 0) {
      parts.push(pc.yellow(`⚠ ${stats.warnings}`));
    }

    lines.push(`    ${label}  ${parts.join('  ')}`);
  }

  return lines;
}

function formatTopIssues(diagnostics: Diagnostic[], maxIssues = 5): string[] {
  const lines: string[] = [];
  const byRule = groupByRule(diagnostics);

  if (byRule.length === 0) return lines;

  lines.push('');
  lines.push('  ' + pc.bold('Top Issues:'));

  const topRules = byRule.slice(0, maxIssues);
  const maxRuleLen = Math.max(...topRules.map((r) => r.rule.length));

  for (const stats of topRules) {
    const icon = severityIcon(stats.severity);
    const rule = stats.rule.padEnd(maxRuleLen);
    const count = pc.dim(`(${stats.count})`);
    const help = stats.help ? pc.dim(stats.help) : '';

    lines.push(`    ${icon} ${rule} ${count}  ${help}`);
  }

  return lines;
}

function formatDetailedDiagnostics(diagnostics: Diagnostic[]): string[] {
  const lines: string[] = [];
  const byRule = groupByRule(diagnostics);

  lines.push('');
  lines.push('  ' + pc.bold('All Diagnostics:'));
  lines.push('');

  // Group diagnostics by rule
  const ruleMap = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = ruleMap.get(d.rule);
    if (list) {
      list.push(d);
    } else {
      ruleMap.set(d.rule, [d]);
    }
  }

  // Use the sorted rule order
  for (const stats of byRule) {
    const diags = ruleMap.get(stats.rule) ?? [];
    const icon = severityIcon(stats.severity);
    const count = diags.length > 1 ? pc.dim(` (${diags.length}×)`) : '';
    const category = pc.dim(`[${diags[0]?.category ?? 'unknown'}]`);

    lines.push(`  ${icon} ${pc.bold(stats.rule)}${count}  ${category}`);
    if (stats.help) {
      lines.push(`    ${pc.dim(stats.help)}`);
    }

    for (const d of diags) {
      const loc = d.line != null ? `:${d.line}${d.column != null ? `:${d.column}` : ''}` : '';
      lines.push(`      ${pc.dim(d.filePath + loc)}  ${d.message}`);
    }
    lines.push('');
  }

  return lines;
}

export function formatText(result: ScanResult, verbose: boolean): string {
  const lines: string[] = [];
  const { score, diagnostics, warnings, baselinedCount } = result;

  // Logo header
  lines.push('');
  lines.push(bluebirdLogo());
  lines.push('');

  // Score box
  lines.push(scoreBox(score));
  lines.push('');

  // Error/warning counts
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warns = diagnostics.filter((d) => d.severity === 'warning').length;
  const countParts: string[] = [];
  if (errors > 0) countParts.push(pc.red(`${errors} error${errors === 1 ? '' : 's'}`));
  if (warns > 0) countParts.push(pc.yellow(`${warns} warning${warns === 1 ? '' : 's'}`));
  if (countParts.length === 0) {
    countParts.push(pc.green('No issues found'));
  }
  lines.push(`  ${countParts.join(' · ')}`);

  // Baseline info
  if (baselinedCount > 0) {
    lines.push(pc.dim(`  ${baselinedCount} baselined (hidden)`));
  }

  // Runner warnings
  if (warnings.length > 0) {
    lines.push(pc.dim(`  ${warnings.length} runner warning${warnings.length === 1 ? '' : 's'}`));
    if (verbose) {
      for (const warning of warnings) {
        lines.push(
          pc.dim(
            `    [${warning.type}] ${warning.filePath}${warning.message ? `  ${warning.message}` : ''}`
          )
        );
      }
    }
  }

  lines.push('');

  if (diagnostics.length > 0) {
    // Category summary
    lines.push(...formatCategorySection(diagnostics));

    // Top issues
    lines.push(...formatTopIssues(diagnostics));

    if (verbose) {
      // Show all diagnostics in verbose mode
      lines.push(...formatDetailedDiagnostics(diagnostics));
    } else {
      // Hint to use verbose
      lines.push('');
      lines.push(
        pc.dim(`  Run with ${pc.bold('--verbose')} to see all ${diagnostics.length} diagnostics`)
      );
    }
  }

  lines.push('');
  return lines.join('\n');
}
