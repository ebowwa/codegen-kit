// @ebowwa/codegen-kit — shape drift over the snapshot engine.
//
// Probes answer "is the shape well-formed right now?"; drift answers "did the shape
// *change* vs the committed baseline, and is that change acceptable?". We reuse the
// snapshot engine (./snapshot.js) verbatim: a shape is serialized to a stable item list
// (one item per module-layer assignment + one per resolved import edge), diffed against
// the committed baseline, and changes classified by {@link DiffRule}s.
//
// Default policy: a module *moving between layers* is breaking (someone crossed an
// architectural boundary); routine additions/removals (new file, new internal import)
// are non-breaking (info). Callers escalate by passing custom rules — e.g. treating new
// cross-layer edges as errors. The kit never claims a structural classification of
// "breaking" beyond what the configured rules assert.

import { writeSnapshot, readSnapshot, diffSnapshots } from "../snapshot.js";
import type { DiffRule, SnapshotOpts, SnapshotResult } from "../snapshot.js";
import type { ModuleGraph } from "./graph.js";

/** A serialized shape item: a layer assignment or an import edge. Identity-stable. */
export interface ShapeSnapshotItem {
  readonly id: string;
  readonly layer?: string;
}

/**
 * Serialize a graph to stable items: one `layer:<path>` item per module (carrying its
 * layer) and one `edge:<from>-><to>` item per resolved import. Sorted by id for
 * deterministic diffs.
 */
export function serializeShape(
  graph: ModuleGraph,
  layerOf: (relPath: string) => string,
): ShapeSnapshotItem[] {
  const items: ShapeSnapshotItem[] = [];
  for (const path of graph.nodes.keys()) items.push({ id: `layer:${path}`, layer: layerOf(path) });
  for (const e of graph.edges) items.push({ id: `edge:${e.from}->${e.to}` });
  return items.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Default drift rules: layer reassignment = error (breaking); additions/removals = info.
 * Escalate by passing your own `rules` to {@link diffShapeSnapshot}.
 */
export const defaultShapeDiffRules: readonly DiffRule[] = [
  { field: "layer", on: "changed", severity: "error", kind: "layer-reassigned" },
  { field: "*", on: "added", severity: "info", kind: "added" },
  { field: "*", on: "removed", severity: "info", kind: "removed" },
];

function snapshotOpts(
  snapshotPath: string,
  rules: readonly DiffRule[],
): SnapshotOpts<ShapeSnapshotItem> {
  return {
    snapshotPath,
    serialize: (items) =>
      [...items].sort((a, b) => (a as ShapeSnapshotItem).id.localeCompare((b as ShapeSnapshotItem).id)),
    identity: (item: any) => (item as ShapeSnapshotItem).id,
    rules,
  };
}

/** Write a shape baseline snapshot from the current graph. */
export function writeShapeSnapshot(
  graph: ModuleGraph,
  layerOf: (relPath: string) => string,
  snapshotPath: string,
): void {
  writeSnapshot(snapshotOpts(snapshotPath, defaultShapeDiffRules), serializeShape(graph, layerOf));
}

/**
 * Diff the current graph against the committed baseline at `snapshotPath`. Throws if no
 * baseline exists (call {@link writeShapeSnapshot} first). Pass `rules` to override the
 * default policy.
 */
export function diffShapeSnapshot(
  graph: ModuleGraph,
  layerOf: (relPath: string) => string,
  snapshotPath: string,
  rules: readonly DiffRule[] = defaultShapeDiffRules,
): SnapshotResult {
  const opts = snapshotOpts(snapshotPath, rules);
  const oldItems = readSnapshot({ snapshotPath });
  const newItems = serializeShape(graph, layerOf);
  return diffSnapshots(opts, oldItems, newItems);
}
