// @ebowwa/codegen-kit — shape contracts: declare a codebase's architectural shape as
// data, checked by probes.
//
// Mirrors the SystemContract pattern from ./systems.js (name/description/status +
// a list of checkers), specialized for architecture: instead of `generators[]` +
// `validators[]` over generated files, a ShapeContract carries `invariants[]` over the
// repo's module graph. Where systems shells out to a validator script per entry, shapes
// resolves invariants to **pure in-process probe functions** (see PROBE REGISTRY below)
// — the import graph is expensive to build and shared by every invariant of a contract,
// so a subprocess per probe would rebuild it each time.
//
// Like SystemContract, this is a plain interface (no zod) to preserve the kit's
// zero-runtime-dependency property.

import type { ValidateResult } from "../validator.js";
import type {
  ShapeArchetype,
  ShapeAxes,
  ShapeCompositionEdge,
} from "./ontology.js";
import type { ModuleGraph } from "./graph.js";

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Mirrors {@link SystemStatus} from ./systems.js. Only `active` contracts are checked. */
export type ShapeStatus = "planned" | "active" | "legacy";

// ── Invariants + probes ─────────────────────────────────────────────────────

/**
 * One declared architectural invariant. `probe` names a function in the probe registry
 * (see {@link registerProbe}); `config` is opaque, probe-specific data (e.g. layer
 * allow-rules, forbidden-import globs, a chokepoint regex). This mirrors how a
 * SystemValidator is `{ name, script }` — here the "script" is an in-process function
 * keyed by name, and the data travels in `config`.
 */
export interface InvariantSpec {
  /** Invariant label, e.g. "send-gate-coverage". */
  readonly name: string;
  /** Registry key of the probe that checks this invariant (e.g. "symbol-isolation"). */
  readonly probe: string;
  /** Probe-specific configuration. Forwarded verbatim to the probe function. */
  readonly config?: Readonly<Record<string, unknown>>;
  /** Human-readable rationale; surfaces in --verbose output. */
  readonly description?: string;
  /** Downgrade a failed check to a warning for this invariant. Default: error. */
  readonly severity?: "error" | "warning";
}

// ── Probe registry ──────────────────────────────────────────────────────────

/**
 * Per-check context handed to every probe. The graph is built once per run and shared;
 * `layerOf` classifies a repo-relative module path to its layer (per the run's
 * `layerRules`). `repoRoot` lets lexical probes (gate-coverage, fingerprint) re-read
 * source text for the files they care about — cheaper than retaining every file's source
 * in memory.
 */
export interface ProbeContext {
  readonly graph: ModuleGraph;
  readonly repoRoot: string;
  /** Classify a repo-relative module path to its declared layer ("tooling" if unmatched). */
  readonly layerOf: (relPath: string) => string;
  /** The contract being checked. */
  readonly contract: ShapeContract;
}

/**
 * A probe is a pure function: read the context (+ the invariant's config), return a
 * ValidateResult. Probes MUST NOT mutate the graph or write to disk. Built-ins live in
 * ./probes/; consumers register their own with {@link registerProbe}.
 */
export type ShapeProbe = (ctx: ProbeContext, spec: InvariantSpec) => ValidateResult;

const probeRegistry = new Map<string, ShapeProbe>();

/** Register a probe under `name`. Built-ins are registered at module load (see ./probes/). */
export function registerProbe(name: string, probe: ShapeProbe): void {
  probeRegistry.set(name, probe);
}

/** Resolve a probe by registry name. Throws if unknown (a contract referenced a missing probe). */
export function getProbe(name: string): ShapeProbe {
  const probe = probeRegistry.get(name);
  if (!probe) throw new Error(`shapes: unknown probe "${name}" (register it with registerProbe)`);
  return probe;
}

/** All registered probe names (for `--verbose` listing / help). */
export function listProbes(): string[] {
  return [...probeRegistry.keys()].sort();
}

// ── The contract ────────────────────────────────────────────────────────────

/**
 * A declared architectural shape for a codebase (or a region of one). Mirrors
 * {@link SystemContract}'s shape (name/description/status) specialized for architecture.
 *
 * The contract is *declarative*: it states what the shape IS and which invariants encode
 * it. The runner ({@link ./runner.js}) builds the module graph once, then dispatches each
 * invariant to its probe. Drift against a committed baseline is handled separately by
 * {@link ./drift.js}.
 */
export interface ShapeContract {
  /** Contract name; used as the drift-snapshot filename and in summaries. */
  readonly name: string;
  readonly description: string;
  /** Primary archetype; see {@link ShapeArchetype}. */
  readonly archetype: ShapeArchetype;
  /** Descriptive axis values; see {@link ShapeAxes}. */
  readonly axes?: Readonly<ShapeAxes>;
  /** The invariants that encode this shape; each runs its named probe. */
  readonly invariants: readonly InvariantSpec[];
  /** Secondary archetypes / composition, for the composite summary. */
  readonly composition?: readonly ShapeCompositionEdge[];
  readonly status: ShapeStatus;
  readonly notes?: string;
}
