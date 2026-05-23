import pc from 'picocolors';
import type { LayersResult, LayersOutputFormat } from '../types.js';

// ─── Text Formatter ─────────────────────────────────────────────────────────

/**
 * Formats layer analysis results as human-readable text output.
 */
export function formatLayersText(result: LayersResult, detail: boolean = false): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(pc.bold('Module Dependency Layers'));
  lines.push('─'.repeat(50));

  // Verdict
  const verdictColor = result.violations.length > 0 ? pc.yellow : pc.green;
  lines.push(`${pc.bold('Verdict:')} ${verdictColor(result.verdict)}`);
  lines.push('');

  // Summary stats
  lines.push(pc.bold('Summary'));
  lines.push(`  Total modules: ${result.layers.length}`);
  lines.push(`  Layer depth:   ${result.maxLayer + 1} (L0 → L${result.maxLayer})`);
  lines.push(`  Violations:    ${result.violations.length}`);
  lines.push('');

  // Layer distribution
  lines.push(pc.bold('Layer Distribution'));
  for (let layer = 0; layer <= result.maxLayer; layer++) {
    const count = result.layerCounts[layer] ?? 0;
    const bar = '█'.repeat(Math.min(count, 30));
    const layerLabel =
      layer === 0 ? 'L0 (entry)' : layer === result.maxLayer ? `L${layer} (leaf)` : `L${layer}`;
    lines.push(`  ${layerLabel.padEnd(12)} ${bar} ${count}`);
  }
  lines.push('');

  // Violations
  if (result.violations.length > 0) {
    lines.push(pc.bold(pc.yellow('Violations')));
    for (const v of result.violations.slice(0, 10)) {
      lines.push(
        `  ${pc.red('↑')} ${v.source.moduleName} ${pc.dim(`(L${v.source.layer})`)} → ${v.target.moduleName} ${pc.dim(`(L${v.target.layer})`)}`
      );
      lines.push(`    ${pc.dim(v.source.filePath)}`);
    }
    if (result.violations.length > 10) {
      lines.push(`  ${pc.dim(`... and ${result.violations.length - 10} more`)}`);
    }
    lines.push('');
  }

  // Detailed layer breakdown
  if (detail) {
    lines.push(pc.bold('Layer Details'));
    for (let layer = 0; layer <= result.maxLayer; layer++) {
      const modules = result.layers.filter((l) => l.layer === layer);
      if (modules.length === 0) continue;

      lines.push(`  ${pc.bold(`Layer ${layer}`)} (${modules.length} modules)`);
      for (const mod of modules.slice(0, 15)) {
        lines.push(`    ${mod.moduleName} ${pc.dim(mod.filePath)}`);
      }
      if (modules.length > 15) {
        lines.push(`    ${pc.dim(`... and ${modules.length - 15} more`)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── JSON Formatter ─────────────────────────────────────────────────────────

/**
 * Formats layer analysis results as JSON.
 */
export function formatLayersJson(result: LayersResult): string {
  return JSON.stringify(
    {
      verdict: result.verdict,
      summary: {
        totalModules: result.layers.length,
        layerDepth: result.maxLayer + 1,
        violationCount: result.violations.length,
      },
      layerCounts: result.layerCounts,
      layers: result.layers,
      violations: result.violations,
    },
    null,
    2
  );
}

// ─── Mermaid Formatter ──────────────────────────────────────────────────────

/**
 * Generates a Mermaid flowchart diagram of the module layers.
 */
export function formatLayersMermaid(result: LayersResult): string {
  const lines: string[] = [];
  lines.push('```mermaid');
  lines.push('flowchart TD');

  // Group modules by layer
  const layerGroups = new Map<number, typeof result.layers>();
  for (const mod of result.layers) {
    if (!layerGroups.has(mod.layer)) {
      layerGroups.set(mod.layer, []);
    }
    layerGroups.get(mod.layer)!.push(mod);
  }

  // Create subgraphs for each layer
  for (let layer = 0; layer <= result.maxLayer; layer++) {
    const modules = layerGroups.get(layer) ?? [];
    if (modules.length === 0) continue;

    const layerName =
      layer === 0
        ? 'Entry Points'
        : layer === result.maxLayer
          ? 'Infrastructure'
          : `Layer ${layer}`;
    lines.push(`  subgraph L${layer}["${layerName}"]`);

    // Limit to 6 modules per layer for readability
    const displayModules = modules.slice(0, 6);
    for (const mod of displayModules) {
      const nodeId = sanitizeNodeId(mod.moduleName);
      lines.push(`    ${nodeId}["${mod.moduleName}"]`);
    }
    if (modules.length > 6) {
      lines.push(`    L${layer}_more["... +${modules.length - 6} more"]`);
    }
    lines.push('  end');
  }

  // Add layer connections (simplified - just show layer flow)
  for (let layer = 0; layer < result.maxLayer; layer++) {
    lines.push(`  L${layer} --> L${layer + 1}`);
  }

  // Highlight violations
  if (result.violations.length > 0) {
    lines.push('');
    lines.push('  %% Violations (red dashed lines)');
    for (const v of result.violations.slice(0, 5)) {
      const sourceId = sanitizeNodeId(v.source.moduleName);
      const targetId = sanitizeNodeId(v.target.moduleName);
      lines.push(`  ${sourceId} -.->|violation| ${targetId}`);
    }
  }

  lines.push('```');

  return lines.join('\n');
}

/**
 * Sanitizes a module name to be a valid Mermaid node ID.
 */
function sanitizeNodeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '_');
}

// ─── Formatter Selection ────────────────────────────────────────────────────

/**
 * Formats layer analysis results in the specified output format.
 */
export function formatLayers(
  result: LayersResult,
  format: LayersOutputFormat,
  detail: boolean = false
): string {
  switch (format) {
    case 'json':
      return formatLayersJson(result);
    case 'mermaid':
      return formatLayersMermaid(result);
    case 'text':
    default:
      return formatLayersText(result, detail);
  }
}
