// @ebowwa/codegen-kit — shape classification.
//
// Conservative v1: the shape is *declared* by the contracts (the ontology is
// declarative); classification computes a fingerprint for reporting — aggregate
// archetypes, layer inventory, and graph stats (including a cycle count). It does not
// invent archetypes the contracts did not declare; that is a later heuristic layer.

import { findCycles } from "./graph.js";
import type { ModuleGraph } from "./graph.js";
import type { ShapeContract } from "./shape-contract.js";

export interface ShapeFingerprint {
  /** Declared archetypes across the active contracts (de-duplicated, sorted). */
  readonly archetypes: readonly string[];
  /** One-line composite label for summaries. */
  readonly summary: string;
  readonly stats: {
    readonly modules: number;
    readonly edges: number;
    readonly cycles: number;
    readonly layers: readonly string[];
  };
}

/**
 * Compute a fingerprint from the graph + the active contracts. `layerOf` classifies a
 * repo-relative module path to its layer. The summary echoes the declared archetype(s)
 * and flags a generative boundary when any contract declares the axis.
 */
export function classifyShape(
  graph: ModuleGraph,
  contracts: readonly ShapeContract[],
  layerOf: (relPath: string) => string,
): ShapeFingerprint {
  const archetypeSet = new Set<string>();
  let hasGenerativeBoundary = false;
  for (const c of contracts) {
    archetypeSet.add(c.archetype);
    for (const edge of c.composition ?? []) archetypeSet.add(edge.to);
    if (c.axes?.generativeBoundary) hasGenerativeBoundary = true;
  }
  const archetypes = [...archetypeSet].sort();

  const layerSet = new Set<string>();
  for (const path of graph.nodes.keys()) layerSet.add(layerOf(path));

  const cycles = findCycles(graph).length;
  const stats = {
    modules: graph.nodes.size,
    edges: graph.edges.length,
    cycles,
    layers: [...layerSet].sort(),
  };

  const tag = hasGenerativeBoundary ? " w/ generative-firewall" : "";
  const summary = `${archetypes.join(" + ")}${tag} — ${stats.modules} modules / ${stats.edges} edges / ${stats.layers.length} layers / ${cycles} cycle(s)`;

  return { archetypes, summary, stats };
}
