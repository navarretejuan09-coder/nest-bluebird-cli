import ts from 'typescript';
import type { ModuleNode, LayerAssignment, LayerViolation, LayersResult } from '../types.js';
import { extractModuleNodes } from '../rules/graph-rules.js';

// ─── Graph Building ─────────────────────────────────────────────────────────

interface ModuleGraph {
  nodes: Map<string, ModuleNode>;
  edges: Map<string, Set<string>>; // className -> Set of imported classNames
  reverseEdges: Map<string, Set<string>>; // className -> Set of classNames that import it
}

/**
 * Builds a directed graph of module dependencies from extracted module nodes.
 */
function buildModuleGraph(modules: ModuleNode[]): ModuleGraph {
  const nodes = new Map<string, ModuleNode>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  // Index all modules by class name
  for (const mod of modules) {
    nodes.set(mod.className, mod);
    edges.set(mod.className, new Set());
    reverseEdges.set(mod.className, new Set());
  }

  // Build edges
  for (const mod of modules) {
    for (const importName of mod.imports) {
      if (nodes.has(importName)) {
        edges.get(mod.className)!.add(importName);
        reverseEdges.get(importName)!.add(mod.className);
      }
    }
  }

  return { nodes, edges, reverseEdges };
}

// ─── Tarjan's SCC Algorithm ─────────────────────────────────────────────────

interface TarjanState {
  index: number;
  indices: Map<string, number>;
  lowlink: Map<string, number>;
  onStack: Set<string>;
  stack: string[];
  sccs: string[][];
}

/**
 * Tarjan's strongly connected components algorithm.
 * Returns an array of SCCs, where each SCC is an array of module class names.
 * SCCs are returned in reverse topological order.
 */
function findSCCs(graph: ModuleGraph): string[][] {
  const state: TarjanState = {
    index: 0,
    indices: new Map(),
    lowlink: new Map(),
    onStack: new Set(),
    stack: [],
    sccs: [],
  };

  function strongConnect(v: string): void {
    state.indices.set(v, state.index);
    state.lowlink.set(v, state.index);
    state.index++;
    state.stack.push(v);
    state.onStack.add(v);

    const neighbors = graph.edges.get(v) ?? new Set();
    for (const w of neighbors) {
      if (!state.indices.has(w)) {
        strongConnect(w);
        state.lowlink.set(v, Math.min(state.lowlink.get(v)!, state.lowlink.get(w)!));
      } else if (state.onStack.has(w)) {
        state.lowlink.set(v, Math.min(state.lowlink.get(v)!, state.indices.get(w)!));
      }
    }

    if (state.lowlink.get(v) === state.indices.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = state.stack.pop()!;
        state.onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      state.sccs.push(scc);
    }
  }

  for (const v of graph.nodes.keys()) {
    if (!state.indices.has(v)) {
      strongConnect(v);
    }
  }

  return state.sccs;
}

// ─── Topological Layering ───────────────────────────────────────────────────

/**
 * Condenses the module graph by collapsing SCCs into single nodes.
 * Returns a mapping from each module to its SCC representative,
 * and a new DAG of SCC representatives.
 */
function condenseGraph(
  graph: ModuleGraph,
  sccs: string[][]
): { sccMap: Map<string, string>; condensedEdges: Map<string, Set<string>> } {
  // Map each node to its SCC representative (first element)
  const sccMap = new Map<string, string>();
  for (const scc of sccs) {
    const representative = scc[0];
    for (const node of scc) {
      sccMap.set(node, representative);
    }
  }

  // Build condensed graph edges
  const condensedEdges = new Map<string, Set<string>>();
  for (const scc of sccs) {
    const rep = scc[0];
    condensedEdges.set(rep, new Set());
  }

  for (const [from, toSet] of graph.edges) {
    const fromRep = sccMap.get(from)!;
    for (const to of toSet) {
      const toRep = sccMap.get(to)!;
      if (fromRep !== toRep) {
        condensedEdges.get(fromRep)!.add(toRep);
      }
    }
  }

  return { sccMap, condensedEdges };
}

/**
 * Assigns layer numbers using longest-path algorithm on a DAG.
 * Layer 0 = nodes with no outgoing edges (leaf modules, typically infrastructure)
 * Higher layers = modules closer to entry points (controllers, etc.)
 */
function assignLayers(
  condensedEdges: Map<string, Set<string>>,
  sccMap: Map<string, string>,
  _nodes: Map<string, ModuleNode>
): Map<string, number> {
  const layers = new Map<string, number>();
  const representatives = new Set(sccMap.values());

  // Calculate in-degree for topological sort
  const inDegree = new Map<string, number>();
  for (const rep of representatives) {
    inDegree.set(rep, 0);
  }
  for (const [, toSet] of condensedEdges) {
    for (const to of toSet) {
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  }

  // Find nodes with no incoming edges (entry points)
  const queue: string[] = [];
  for (const [rep, degree] of inDegree) {
    if (degree === 0) {
      queue.push(rep);
      layers.set(rep, 0);
    }
  }

  // BFS to assign layers
  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layers.get(current)!;
    const neighbors = condensedEdges.get(current) ?? new Set();

    for (const neighbor of neighbors) {
      const newLayer = currentLayer + 1;
      layers.set(neighbor, Math.max(layers.get(neighbor) ?? 0, newLayer));
      inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  // Expand layers from representatives to all nodes
  const allLayers = new Map<string, number>();
  for (const [node, rep] of sccMap) {
    allLayers.set(node, layers.get(rep) ?? 0);
  }

  return allLayers;
}

// ─── Violation Detection ────────────────────────────────────────────────────

/**
 * Detects layer violations: edges where a lower layer imports from a higher layer.
 * In proper layered architecture, dependencies should only flow downward (or within same layer).
 */
function detectViolations(graph: ModuleGraph, layers: Map<string, number>): LayerViolation[] {
  const violations: LayerViolation[] = [];
  const maxLayer = Math.max(...layers.values(), 0);

  for (const [from, toSet] of graph.edges) {
    const fromLayer = layers.get(from) ?? 0;
    const fromNode = graph.nodes.get(from)!;

    for (const to of toSet) {
      const toLayer = layers.get(to) ?? 0;
      const toNode = graph.nodes.get(to)!;

      // Violation: importing from a higher layer (dependency flows upward)
      if (toLayer > fromLayer) {
        const layerDistance = toLayer - fromLayer;
        const severity = maxLayer > 0 ? layerDistance / maxLayer : 0;

        violations.push({
          source: {
            moduleName: from,
            filePath: fromNode.filePath,
            layer: fromLayer,
          },
          target: {
            moduleName: to,
            filePath: toNode.filePath,
            layer: toLayer,
          },
          layerDistance,
          severity,
          message: `${from} (L${fromLayer}) imports ${to} (L${toLayer}) — upward dependency across ${layerDistance} layer(s)`,
        });
      }
    }
  }

  // Sort by severity descending
  violations.sort((a, b) => b.severity - a.severity);

  return violations;
}

// ─── Verdict Generation ─────────────────────────────────────────────────────

function generateVerdict(
  layerCounts: Record<number, number>,
  violations: LayerViolation[],
  maxLayer: number
): string {
  const totalModules = Object.values(layerCounts).reduce((a, b) => a + b, 0);

  if (totalModules === 0) {
    return 'No NestJS modules found';
  }

  if (maxLayer === 0) {
    return 'Flat structure (single layer)';
  }

  const layerCount = maxLayer + 1;
  const avgPerLayer = totalModules / layerCount;
  const variance =
    Object.values(layerCounts).reduce((sum, count) => sum + Math.pow(count - avgPerLayer, 2), 0) /
    layerCount;
  const isEvenlyDistributed = variance < avgPerLayer * 2;

  let verdict: string;
  if (layerCount <= 2) {
    verdict = `Shallow structure (${layerCount} layers)`;
  } else if (layerCount <= 4) {
    verdict = `Moderate depth (${layerCount} layers)`;
  } else {
    verdict = `Well-layered (${layerCount} layers)`;
  }

  if (isEvenlyDistributed) {
    verdict += ', even distribution';
  }

  if (violations.length > 0) {
    verdict += `, ${violations.length} violation(s)`;
  } else {
    verdict += ', clean';
  }

  return verdict;
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export interface AnalyseLayersOptions {
  cwd: string;
}

/**
 * Analyzes the module dependency layers in a NestJS project.
 *
 * Algorithm:
 * 1. Extract all @Module() classes and their imports
 * 2. Build a directed dependency graph
 * 3. Find strongly connected components (cycles) using Tarjan's algorithm
 * 4. Condense SCCs into single nodes to create a DAG
 * 5. Assign layer numbers using longest-path from entry points
 * 6. Detect violations (lower layer importing from higher layer)
 */
export async function analyseModuleLayers(
  sourceFiles: ReadonlyMap<string, ts.SourceFile>
): Promise<LayersResult> {
  // Step 1: Extract module nodes
  const modules = extractModuleNodes(sourceFiles);

  if (modules.length === 0) {
    return {
      layers: [],
      violations: [],
      maxLayer: 0,
      layerCounts: {},
      verdict: 'No NestJS modules found',
    };
  }

  // Step 2: Build dependency graph
  const graph = buildModuleGraph(modules);

  // Step 3: Find SCCs
  const sccs = findSCCs(graph);

  // Step 4: Condense graph
  const { sccMap, condensedEdges } = condenseGraph(graph, sccs);

  // Step 5: Assign layers
  const layerMap = assignLayers(condensedEdges, sccMap, graph.nodes);

  // Step 6: Build layer assignments
  const layers: LayerAssignment[] = [];
  const layerCounts: Record<number, number> = {};

  for (const [className, layer] of layerMap) {
    const node = graph.nodes.get(className)!;
    layers.push({
      moduleName: className,
      filePath: node.filePath,
      layer,
    });
    layerCounts[layer] = (layerCounts[layer] ?? 0) + 1;
  }

  // Sort layers by layer number, then by module name
  layers.sort((a, b) => a.layer - b.layer || a.moduleName.localeCompare(b.moduleName));

  // Step 7: Detect violations
  const violations = detectViolations(graph, layerMap);

  const maxLayer = Math.max(...layerMap.values(), 0);
  const verdict = generateVerdict(layerCounts, violations, maxLayer);

  return {
    layers,
    violations,
    maxLayer,
    layerCounts,
    verdict,
  };
}

/**
 * Loads TypeScript source files from a directory for layer analysis.
 */
export async function loadSourceFilesForLayers(cwd: string): Promise<Map<string, ts.SourceFile>> {
  const { readFile } = await import('node:fs/promises');
  const { join, relative, resolve } = await import('node:path');
  const { glob } = await import('glob');

  // Ensure cwd is absolute
  const absoluteCwd = resolve(cwd);
  const pattern = join(absoluteCwd, '**/*.ts');
  const ignore = [
    '**/node_modules/**',
    '**/dist/**',
    '**/*.d.ts',
    '**/*.spec.ts',
    '**/*.test.ts',
    '**/test/**',
    '**/tests/**',
  ];

  const files = await glob(pattern, { ignore, nodir: true });
  const sourceFiles = new Map<string, ts.SourceFile>();

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      const relativePath = relative(absoluteCwd, file);
      const sf = ts.createSourceFile(relativePath, content, ts.ScriptTarget.Latest, true);
      sourceFiles.set(relativePath, sf);
    } catch {
      // Skip files that can't be read
    }
  }

  return sourceFiles;
}
