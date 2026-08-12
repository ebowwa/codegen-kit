// @ebowwa/codegen-kit — shapes ontology: the vocabulary for describing a codebase's
// architectural shape.
//
// A "shape" is a repo's structural fingerprint — its topology of layers, dependency
// direction, coupling model, source-of-truth, authority, and (where present) the
// boundary around generative code. This module defines the *vocabulary* (archetypes
// + axes) that {@link ./shape-contract.js} turns into a checkable contract. It is
// intentionally a plain TypeScript vocabulary, not a zod schema — matching the rest
// of the kit's zero-runtime-dependency convention (see SystemContract in ./systems.js).
//
// An *ontology*, not a *taxonomy*: a codebase is usually a composite (e.g. "a monorepo
// that contains an ordinal-layered pipeline built ports-and-adapters, with a generative
// firewall"). Archetypes compose; axes score; the contract binds them to probes.

// ── Archetypes ──────────────────────────────────────────────────────────────

/**
 * Named architectural species. Extensible: consumers may add their own archetype
 * strings (the union is open via `(string & {})`). The kit ships the archetypes its
 * own probes know how to reason about; classification ({@link ./classify.js}) is
 * conservative and mostly echoes the declared archetype.
 *
 * v1 ships the two archetypes the proof consumer (site-surveys) needs, plus three
 * common neighbours as named stubs to grow into:
 *   - `ordinal-layered-pipeline` — staged phases with an ordinal layering
 *     (`1o`/`2o`/…) and, optionally, a generative firewall axis.
 *   - `ports-and-adapters` — domain core + adapters; the core has no adapter imports.
 *   - `modular-monolith` — one deployable, strict module boundaries, no import cycles.
 *   - `monorepo` — one VCS root, many packages, internal layer rules.
 *   - `microservices` — many deployables, network coupling, per-service state.
 */
export type ShapeArchetype =
  | "ordinal-layered-pipeline"
  | "ports-and-adapters"
  | "modular-monolith"
  | "monorepo"
  | "microservices"
  | (string & {});

// ── Axes ────────────────────────────────────────────────────────────────────

/**
 * The orthogonal dimensions a shape is scored along. These are descriptive (free-form
 * string values per axis) and feed classification + reporting; they are not themselves
 * checked — checking is what the contract's invariants/probes are for.
 *
 *   - `deployTopology`  — "1" | "N" deployables, and the boundary (process/container/function).
 *   - `vcsTopology`     — "mono" | "poly".
 *   - `depDirection`    — "acyclic-layers" | "dag" | "cyclic" | "bidirectional".
 *   - `coupling`        — "in-process" | "network" | "event-log" | "none".
 *   - `sourceOfTruth`   — "single-store" | "per-service" | "raw-over-derived".
 *   - `authority`       — "human" | "gate" | "model-proposes-then-gate".
 *   - `generativeBoundary` — present when a fuzzy/generative layer (e.g. an LLM) is
 *                            isolated behind a typed boundary from the deterministic core.
 */
export type ShapeAxisKey =
  | "deployTopology"
  | "vcsTopology"
  | "depDirection"
  | "coupling"
  | "sourceOfTruth"
  | "authority"
  | "generativeBoundary"
  | (string & {});

/** Axis → free-form descriptive value. Omitted axes are "unspecified". */
export type ShapeAxes = Partial<Record<ShapeAxisKey, string>>;

// ── Relations ───────────────────────────────────────────────────────────────

/**
 * How two shapes compose inside one repo. v1 keeps this as a descriptive label on the
 * contract (e.g. "contains", "is-adapter-of"); it feeds the composite summary in
 * {@link ./classify.js} but is not itself enforced by a probe.
 */
export type ShapeRelation =
  | "contains"
  | "depends-on-layer"
  | "is-adapter-of"
  | "owns-state"
  | "passes-through-gate"
  | (string & {});

/** A declared composition edge for the composite summary. */
export interface ShapeCompositionEdge {
  readonly relation: ShapeRelation;
  readonly to: string; // name of the related shape/archetype
}
