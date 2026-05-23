import type { Diagnostic, RuleCategory, ScanResult } from '../types.js';
import { SCORE_THRESHOLD_GREAT, SCORE_THRESHOLD_NEEDS_WORK } from '../constants.js';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getScoreColor(score: number): string {
  if (score >= SCORE_THRESHOLD_GREAT) return '#22c55e';
  if (score >= SCORE_THRESHOLD_NEEDS_WORK) return '#eab308';
  return '#ef4444';
}

interface CategoryStats {
  errors: number;
  warnings: number;
  total: number;
}

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
      stats = { errors: 0, warnings: 0, total: 0 };
      map.set(d.category, stats);
    }
    if (d.severity === 'error') {
      stats.errors++;
    } else {
      stats.warnings++;
    }
    stats.total++;
  }
  return map;
}

interface RuleStats {
  rule: string;
  severity: 'error' | 'warning';
  help: string | undefined;
  count: number;
  category: RuleCategory;
}

function groupByRule(diagnostics: Diagnostic[]): RuleStats[] {
  const map = new Map<string, RuleStats>();
  for (const d of diagnostics) {
    let stats = map.get(d.rule);
    if (!stats) {
      stats = { rule: d.rule, severity: d.severity, help: d.help, count: 0, category: d.category };
      map.set(d.rule, stats);
    }
    stats.count++;
  }
  return [...map.values()].sort((a, b) => {
    const sevA = a.severity === 'error' ? 0 : 1;
    const sevB = b.severity === 'error' ? 0 : 1;
    if (sevA !== sevB) return sevA - sevB;
    return b.count - a.count;
  });
}

export function formatHtml(result: ScanResult): string {
  const { project, score, diagnostics, baselinedCount } = result;
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
  const scoreColor = getScoreColor(score.score);
  const byCategory = groupByCategory(diagnostics);
  const byRule = groupByRule(diagnostics);
  const maxCategoryCount = Math.max(...[...byCategory.values()].map((s) => s.total), 1);

  const features = Object.entries(project.features)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const categoryBars = [...byCategory.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([cat, stats]) => {
      const width = (stats.total / maxCategoryCount) * 100;
      const errorWidth = (stats.errors / stats.total) * 100;
      return `
        <div class="category-row">
          <div class="category-label">${CATEGORY_LABELS[cat]}</div>
          <div class="category-bar-container">
            <div class="category-bar" style="width: ${width}%">
              <div class="category-bar-errors" style="width: ${errorWidth}%"></div>
            </div>
            <span class="category-count">${stats.errors > 0 ? `${stats.errors} errors, ` : ''}${stats.warnings} warnings</span>
          </div>
        </div>
      `;
    })
    .join('');

  const topIssuesRows = byRule
    .slice(0, 10)
    .map(
      (r) => `
      <tr>
        <td><span class="severity-badge ${r.severity}">${r.severity === 'error' ? '!' : '⚠'}</span></td>
        <td class="rule-name">${escapeHtml(r.rule)}</td>
        <td class="rule-category">${CATEGORY_LABELS[r.category]}</td>
        <td class="rule-count">${r.count}</td>
        <td class="rule-help">${r.help ? escapeHtml(r.help) : ''}</td>
      </tr>
    `
    )
    .join('');

  const diagnosticsByRule = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    const list = diagnosticsByRule.get(d.rule) ?? [];
    list.push(d);
    diagnosticsByRule.set(d.rule, list);
  }

  const allDiagnosticsHtml = byRule
    .map((r) => {
      const diags = diagnosticsByRule.get(r.rule) ?? [];
      const diagRows = diags
        .map(
          (d) => `
          <tr>
            <td class="diag-file">${escapeHtml(d.filePath)}${d.line ? `:${d.line}` : ''}${d.column ? `:${d.column}` : ''}</td>
            <td class="diag-message">${escapeHtml(d.message)}</td>
          </tr>
        `
        )
        .join('');

      return `
        <details class="rule-details">
          <summary>
            <span class="severity-badge ${r.severity}">${r.severity === 'error' ? '!' : '⚠'}</span>
            <strong>${escapeHtml(r.rule)}</strong>
            <span class="count-badge">${r.count}</span>
          </summary>
          ${r.help ? `<p class="rule-help-text">${escapeHtml(r.help)}</p>` : ''}
          <table class="diagnostics-table">
            <tbody>
              ${diagRows}
            </tbody>
          </table>
        </details>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bluebird Health Report</title>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f1f5f9;
      --text-dim: #94a3b8;
      --border: #334155;
      --error: #ef4444;
      --warning: #eab308;
      --success: #22c55e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      /* cspell:disable-next-line */
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      padding: 2rem;
    }
    .container { max-width: 1200px; margin: 0 auto; }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .logo {
      font-family: monospace;
      white-space: pre;
      color: #3b82f6;
      font-size: 0.8rem;
      line-height: 1.2;
    }
    .header-text h1 { font-size: 1.5rem; font-weight: 600; }
    .header-text p { color: var(--text-dim); font-size: 0.9rem; }

    /* Score Card */
    .score-card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 1.5rem;
      display: flex;
      align-items: center;
      gap: 2rem;
    }
    .score-gauge {
      position: relative;
      width: 120px;
      height: 120px;
    }
    .score-gauge svg { transform: rotate(-90deg); }
    .score-gauge circle {
      fill: none;
      stroke-width: 8;
    }
    .score-gauge .bg { stroke: var(--border); }
    .score-gauge .fill { stroke-linecap: round; transition: stroke-dashoffset 0.5s; }
    .score-value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      text-align: center;
    }
    .score-value .number { font-size: 2rem; font-weight: 700; }
    .score-value .label { font-size: 0.8rem; color: var(--text-dim); }
    .score-info { flex: 1; }
    .score-info h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .counts { display: flex; gap: 1.5rem; margin-top: 1rem; }
    .count-item { display: flex; align-items: center; gap: 0.5rem; }
    .count-dot { width: 10px; height: 10px; border-radius: 50%; }
    .count-dot.error { background: var(--error); }
    .count-dot.warning { background: var(--warning); }

    /* Project Info */
    .project-info {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .project-info h3 { font-size: 1rem; margin-bottom: 1rem; color: var(--text-dim); }
    .project-meta { display: flex; flex-wrap: wrap; gap: 1rem; }
    .meta-item {
      background: var(--bg);
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
    }
    .meta-item strong { color: var(--text-dim); }

    /* Category Chart */
    .card {
      background: var(--card-bg);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h3 { font-size: 1rem; margin-bottom: 1rem; }
    .category-row {
      display: flex;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .category-label {
      width: 120px;
      font-size: 0.85rem;
      color: var(--text-dim);
    }
    .category-bar-container {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .category-bar {
      height: 24px;
      background: var(--warning);
      border-radius: 4px;
      position: relative;
      min-width: 4px;
    }
    .category-bar-errors {
      position: absolute;
      left: 0;
      top: 0;
      height: 100%;
      background: var(--error);
      border-radius: 4px 0 0 4px;
    }
    .category-count {
      font-size: 0.8rem;
      color: var(--text-dim);
      white-space: nowrap;
    }

    /* Top Issues Table */
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--text-dim); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; }
    .severity-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .severity-badge.error { background: var(--error); color: white; }
    .severity-badge.warning { background: var(--warning); color: black; }
    .rule-name { font-family: monospace; font-size: 0.85rem; }
    .rule-category { color: var(--text-dim); font-size: 0.8rem; }
    .rule-count { text-align: center; }
    .rule-help { color: var(--text-dim); font-size: 0.8rem; max-width: 300px; }

    /* All Diagnostics */
    .rule-details {
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 0.75rem;
    }
    .rule-details summary {
      padding: 1rem;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .rule-details summary:hover { background: rgba(255,255,255,0.02); }
    .count-badge {
      background: var(--bg);
      padding: 0.2rem 0.6rem;
      border-radius: 10px;
      font-size: 0.75rem;
      color: var(--text-dim);
    }
    .rule-help-text {
      padding: 0 1rem 1rem 3rem;
      color: var(--text-dim);
      font-size: 0.85rem;
    }
    .diagnostics-table { margin: 0 1rem 1rem; width: calc(100% - 2rem); }
    .diagnostics-table td { font-size: 0.8rem; padding: 0.5rem; }
    .diag-file { font-family: monospace; color: var(--text-dim); white-space: nowrap; }
    .diag-message { color: var(--text); }

    /* Footer */
    .footer {
      text-align: center;
      color: var(--text-dim);
      font-size: 0.8rem;
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">    __
   (o >
  (____)~
   |  |</div>
      <div class="header-text">
        <h1>Bluebird</h1>
        <p>NestJS Health Report</p>
      </div>
    </div>

    <div class="score-card">
      <div class="score-gauge">
        <svg width="120" height="120" viewBox="0 0 120 120">
          <circle class="bg" cx="60" cy="60" r="52"></circle>
          <circle class="fill" cx="60" cy="60" r="52"
            stroke="${scoreColor}"
            stroke-dasharray="${2 * Math.PI * 52}"
            stroke-dashoffset="${2 * Math.PI * 52 * (1 - score.score / 100)}">
          </circle>
        </svg>
        <div class="score-value">
          <div class="number" style="color: ${scoreColor}">${score.score}</div>
          <div class="label">${score.label}</div>
        </div>
      </div>
      <div class="score-info">
        <h2>Health Score</h2>
        <p style="color: var(--text-dim)">Based on ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'} across ${project.sourceFileCount} files</p>
        <div class="counts">
          <div class="count-item">
            <div class="count-dot error"></div>
            <span>${errors} error${errors === 1 ? '' : 's'}</span>
          </div>
          <div class="count-item">
            <div class="count-dot warning"></div>
            <span>${warnings} warning${warnings === 1 ? '' : 's'}</span>
          </div>
          ${baselinedCount > 0 ? `<div class="count-item"><span style="color: var(--text-dim)">${baselinedCount} baselined</span></div>` : ''}
        </div>
      </div>
    </div>

    <div class="project-info">
      <h3>Project Details</h3>
      <div class="project-meta">
        <div class="meta-item"><strong>NestJS</strong> ${project.nestVersion ?? 'unknown'}</div>
        <div class="meta-item"><strong>Adapter</strong> ${project.httpAdapter}</div>
        <div class="meta-item"><strong>ORM</strong> ${project.orm}</div>
        <div class="meta-item"><strong>Files</strong> ${project.sourceFileCount}</div>
        <div class="meta-item"><strong>Strict TS</strong> ${project.strictTypeScript ? 'Yes' : 'No'}</div>
        <div class="meta-item"><strong>Tests</strong> ${project.hasTests ? 'Yes' : 'No'}</div>
        ${features.length > 0 ? `<div class="meta-item"><strong>Features</strong> ${features.join(', ')}</div>` : ''}
      </div>
    </div>

    ${
      byCategory.size > 0
        ? `
    <div class="card">
      <h3>Issues by Category</h3>
      ${categoryBars}
    </div>
    `
        : ''
    }

    ${
      byRule.length > 0
        ? `
    <div class="card">
      <h3>Top Issues</h3>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Rule</th>
            <th>Category</th>
            <th>Count</th>
            <th>How to Fix</th>
          </tr>
        </thead>
        <tbody>
          ${topIssuesRows}
        </tbody>
      </table>
    </div>
    `
        : ''
    }

    ${
      byRule.length > 0
        ? `
    <div class="card">
      <h3>All Diagnostics</h3>
      ${allDiagnosticsHtml}
    </div>
    `
        : ''
    }

    <div class="footer">
      Generated by Bluebird on ${new Date().toLocaleString()}
    </div>
  </div>
</body>
</html>`;
}
