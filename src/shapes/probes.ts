// @ebowwa/codegen-kit — built-in shape probes.
//
// Each probe is a pure function `(ctx, spec) => ValidateResult` that reads the shared
// module graph (+ re-reads source by path for the two lexical probes). Invariants on a
// ShapeContract name one of these probes via `spec.probe`; the runner resolves it from
// the registry established at the bottom of this file. Consumers add their own probes
// with `registerProbe` from ./shape-contract.js.
//
// v1 ships five probes, each encoding a class of architectural invariant:
//   - no-cycles        : the graph (or a layer subset) is acyclic.
//   - layer-rules      : dependency direction obeys a per-layer allow-list.
//   - symbol-isolation : a path glob may not import a forbidden specifier (with allow-list).
//   - gate-coverage    : every call to a "raw" symbol co-occurs with a chokepoint.
//   - fingerprint      : a literal set extracted from a source file matches a baseline.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newResult } from "../validator.js";
import type { ResultBuilder, ValidateResult } from "../validator.js";
import { globToRegex } from "../package-graph.js";
import { findCycles } from "./graph.js";
import type { ModuleGraph } from "./graph.js";
import type { InvariantSpec, ProbeContext } from "./shape-contract.js";
import { registerProbe } from "./shape-contract.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

type Cfg = Readonly<Record<string, unknown>>;

const cfg = (spec: InvariantSpec): Cfg => spec.config ?? {};

/** Push a finding, honouring an invariant's opt-in `severity: "warning"` downgrade. */
function emit(r: ResultBuilder, spec: InvariantSpec, kind: string, message: string): void {
  const e = { kind, severity: "error" as const, message };
  if (spec.severity === "warning") r.warnings.push({ ...e, severity: "warning" });
  else r.errors.push(e);
}

const asStrings = (v: unknown): string[] | undefined =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const asRecord = (v: unknown): Record<string, string[]> | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const out: Record<string, string[]> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const arr = asStrings(val);
    if (arr === undefined) return undefined;
    out[k] = arr;
  }
  return out;
};

function readSource(repoRoot: string, relPath: string): string | undefined {
  try {
    return readFileSync(resolve(repoRoot, relPath), "utf-8");
  } catch {
    return undefined;
  }
}

/** Restrict a graph's edges to those with both endpoints in `layerSubset` (via ctx.layerOf). */
function edgesWithin(graph: ModuleGraph, layerOf: (p: string) => string, layers: Set<string>): readonly { from: string; to: string }[] {
  return graph.edges.filter((e) => layers.has(layerOf(e.from)) && layers.has(layerOf(e.to)));
}

// ── 1. no-cycles ────────────────────────────────────────────────────────────

/**
 * Assert the import graph is acyclic. With `config.layers` (a list of layer names),
 * only edges with both endpoints in those layers are considered — useful when cycles
 * within a shared leaf layer (e.g. a `safety` utility imported upward) are sanctioned.
 */
export function noCyclesProbe(ctx: ProbeContext, spec: InvariantSpec): ValidateResult {
  const layers = asStrings(cfg(spec).layers);
  const r = newResult(ctx.graph.nodes.size, ctx.graph.edges.length);
  if (!layers || layers.length === 0) {
    for (const cycle of findCycles(ctx.graph)) {
      emit(r, spec, "cycle", `import cycle: ${cycle.join(" → ")}`);
    }
    return r;
  }
  const layerSet = new Set(layers);
  // Build a subgraph adjacency restricted to the layer subset and detect cycles on it.
  const sub = new Map<string, Set<string>>();
  for (const e of edgesWithin(ctx.graph, ctx.layerOf, layerSet)) {
    if (!sub.has(e.from)) sub.set(e.from, new Set());
    sub.get(e.from)!.add(e.to);
    if (!sub.has(e.to)) sub.set(e.to, new Set()); // ensure every node present
  }
  const cycles = detectCycles(sub);
  for (const cycle of cycles) emit(r, spec, "cycle", `import cycle within [${layers.join(", ")}]: ${cycle.join(" → ")}`);
  return r;
}

// ── 2. layer-rules ──────────────────────────────────────────────────────────

/**
 * Enforce dependency direction: for each edge `from -> to`, if `layerOf(from)` has an
 * entry in `config.allowedDeps` then `layerOf(to)` must appear in that list. Layers
 * omitted from `allowedDeps` are unrestricted (mirrors ./package-graph.js semantics).
 */
export function layerRulesProbe(ctx: ProbeContext, spec: InvariantSpec): ValidateResult {
  const allowed = asRecord(cfg(spec).allowedDeps);
  const r = newResult(ctx.graph.nodes.size, ctx.graph.edges.length);
  if (!allowed) {
    emit(r, spec, "misconfigured", "layer-rules requires config.allowedDeps: Record<layer, layer[]>");
    return r;
  }
  for (const e of ctx.graph.edges) {
    const fromLayer = ctx.layerOf(e.from);
    const toLayer = ctx.layerOf(e.to);
    const allow = allowed[fromLayer];
    if (!allow) continue; // unrestricted source layer
    if (!allow.includes(toLayer)) {
      emit(r, spec, "layer-violation", `${e.from} [${fromLayer}] imports ${e.to} [${toLayer}]: ${toLayer} not allowed for ${fromLayer}`);
    }
  }
  return r;
}

// ── 3. symbol-isolation ─────────────────────────────────────────────────────

/**
 * Assert a path glob may not import a forbidden specifier. Generalizes the
 * hand-rolled "generative layer cannot import integrations" boundary test.
 *
 * config:
 *   forbidden: [{ from: glob, imports: glob }]  — a node whose path matches `from`
 *                                              may not import any specifier matching `imports`.
 *   allow:     glob[]                           — specifiers matching any of these are exempt.
 *
 * Matches raw import specifiers (so both resolved module paths and bare/aliased
 * specifiers are caught), using the kit's `*`-spans-`/` glob.
 */
export function symbolIsolationProbe(ctx: ProbeContext, spec: InvariantSpec): ValidateResult {
  const c = cfg(spec);
  const forbiddenRaw = c.forbidden;
  const allowGlobs = asStrings(c.allow) ?? [];
  const allowRes = allowGlobs.map((g) => globToRegex(g));
  const r = newResult(ctx.graph.nodes.size, ctx.graph.nodes.size);
  if (!Array.isArray(forbiddenRaw)) {
    emit(r, spec, "misconfigured", "symbol-isolation requires config.forbidden: [{ from, imports }]");
    return r;
  }
  for (const f of forbiddenRaw as Array<Record<string, unknown>>) {
    const fromGlob = asString(f.from);
    const importsGlob = asString(f.imports);
    if (!fromGlob || !importsGlob) {
      emit(r, spec, "misconfigured", "symbol-isolation: each forbidden entry needs { from, imports } string globs");
      continue;
    }
    const fromRe = globToRegex(fromGlob);
    const importsRe = globToRegex(importsGlob);
    for (const node of ctx.graph.nodes.values()) {
      if (!fromRe.test(node.path)) continue;
      for (const imp of node.imports) {
        if (!importsRe.test(imp)) continue;
        if (allowRes.some((re) => re.test(imp))) continue;
        emit(r, spec, "forbidden-import", `${node.path} imports "${imp}" (forbidden under from=${fromGlob})`);
      }
    }
  }
  return r;
}

// ── 4. gate-coverage ────────────────────────────────────────────────────────

/**
 * Assert every call to a "raw" symbol co-occurs with a chokepoint symbol in the same
 * file — a sound v1 approximation of "every send goes through the gate". Catches the
 * highest-value case (a file that sends without ever referencing the gate); a ts-morph
 * builder upgrades this to true call-graph reachability later.
 *
 * config:
 *   rawCall:     regex   — a call site that must be gated (e.g. `gmail\\.send|getGmail\\(\\)\\.send`).
 *   chokepoint:  regex   — the gating symbol that must appear in the same file (e.g. `evaluateSendGate|releaseSend`).
 *   exemptPaths: glob[]  — files exempt from the rule (e.g. the primitive's own home).
 */
export function gateCoverageProbe(ctx: ProbeContext, spec: InvariantSpec): ValidateResult {
  const c = cfg(spec);
  const rawCall = asString(c.rawCall);
  const chokepoint = asString(c.chokepoint);
  const exemptGlobs = asStrings(c.exemptPaths) ?? [];
  const exemptRes = exemptGlobs.map((g) => globToRegex(g));
  const r = newResult(ctx.graph.nodes.size, ctx.graph.nodes.size);
  if (!rawCall || !chokepoint) {
    emit(r, spec, "misconfigured", "gate-coverage requires config.rawCall + config.chokepoint (regex strings)");
    return r;
  }
  const rawRe = new RegExp(rawCall);
  const chokeRe = new RegExp(chokepoint);
  for (const node of ctx.graph.nodes.values()) {
    if (exemptRes.some((re) => re.test(node.path))) continue;
    const source = readSource(ctx.repoRoot, node.path);
    if (source === undefined) continue;
    const rawHits = matchLines(rawRe, source);
    if (rawHits.length === 0) continue; // no raw call in this file — nothing to gate
    if (chokeRe.test(source)) continue; // gate referenced in same file — compliant (v1)
    for (const line of rawHits) {
      emit(r, spec, "ungated-call", `${node.path}:${line} matches /${rawCall}/ but no /${chokepoint}/ in file`);
    }
  }
  return r;
}

// ── 5. fingerprint ──────────────────────────────────────────────────────────

/**
 * Assert a literal set extracted from a source file equals a committed baseline. Encodes
 * "the phase machine's shape is unchanged" without parsing the whole tree.
 *
 * config:
 *   header:   regex (capture group 1 selects the region, e.g. `type PhaseId\\s*=\\s*([\\s\\S]*?);`).
 *   members:  regex (capture group 1 per member; default `["']([^"']+)["']`). Applied within the region.
 *   expected: string[] — the baseline set the extracted members must equal (order-independent).
 */
export function fingerprintProbe(ctx: ProbeContext, spec: InvariantSpec): ValidateResult {
  const c = cfg(spec);
  const header = asString(c.header);
  const source = asString(c.source) ?? ""; // optional; defaults derived from header below
  const expected = asStrings(c.expected) ?? [];
  const r = newResult(1, expected.length);
  if (!header) {
    emit(r, spec, "misconfigured", "fingerprint requires config.header (regex with capture group 1)");
    return r;
  }
  const relPath = source || derivePathFromHeader(ctx.graph, header);
  if (!relPath) {
    emit(r, spec, "misconfigured", "fingerprint: supply config.source (rel path) or scope header to a unique file");
    return r;
  }
  const text = readSource(ctx.repoRoot, relPath);
  if (text === undefined) {
    emit(r, spec, "missing-source", `fingerprint source not found: ${relPath}`);
    return r;
  }
  const headerRe = new RegExp(header);
  const hm = headerRe.exec(text);
  if (!hm || hm[1] === undefined) {
    emit(r, spec, "no-match", `header regex did not match in ${relPath}: /${header}/`);
    return r;
  }
  const membersRe = new RegExp(c.members ? (asString(c.members) as string) : `["']([^"']+)["']`, "g");
  const found = new Set<string>();
  let mm: RegExpExecArray | null;
  while ((mm = membersRe.exec(hm[1])) !== null) {
    if (mm[1] !== undefined) found.add(mm[1]);
  }
  const want = new Set(expected);
  const missing = expected.filter((v) => !found.has(v)).sort();
  const extra = [...found].filter((v) => !want.has(v)).sort();
  if (missing.length > 0) emit(r, spec, "fingerprint-missing", `${relPath}: expected members absent: ${missing.join(", ")}`);
  if (extra.length > 0) emit(r, spec, "fingerprint-extra", `${relPath}: unexpected members present: ${extra.join(", ")}`);
  return r;
}

// ── Small utilities ─────────────────────────────────────────────────────────

/** Lines (1-based) in `source` matching `re`. */
function matchLines(re: RegExp, source: string): number[] {
  const lines = source.split(/\r?\n/);
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0;
    if (re.test(lines[i]!)) hits.push(i + 1);
  }
  return hits;
}

/** If the header regex appears in exactly one scanned file, return that path. */
function derivePathFromHeader(graph: ModuleGraph, header: string): string | undefined {
  const re = new RegExp(header);
  const matches: string[] = [];
  for (const node of graph.nodes.keys()) {
    const src = readSource(graph.repoRoot, node);
    if (src && re.test(src)) matches.push(node);
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/** Iterative Tarjan over an explicit adjacency map (layer-restricted cycle detection). */
function detectCycles(adj: Map<string, Set<string>>): string[][] {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const sccs: string[][] = [];
  for (const start of adj.keys()) {
    if (indices.has(start)) continue;
    const work: Array<{ v: string; iter: Iterator<string> }> = [{ v: start, iter: (adj.get(start) ?? new Set()).values() }];
    indices.set(start, index);
    low.set(start, index);
    index++;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const top = work[work.length - 1]!;
      const step = top.iter.next();
      if (step.done) {
        if (low.get(top.v) === indices.get(top.v)) {
          const comp: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            comp.push(w);
          } while (w !== top.v);
          if (comp.length > 1) sccs.push(comp.sort());
          else if ((adj.get(comp[0]!) ?? new Set()).has(comp[0]!)) sccs.push([comp[0]!]);
        }
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!.v;
          low.set(parent, Math.min(low.get(parent)!, low.get(top.v)!));
        }
        continue;
      }
      const w = step.value;
      if (!indices.has(w)) {
        indices.set(w, index);
        low.set(w, index);
        index++;
        stack.push(w);
        onStack.add(w);
        work.push({ v: w, iter: (adj.get(w) ?? new Set()).values() });
      } else if (onStack.has(w)) {
        low.set(top.v, Math.min(low.get(top.v)!, indices.get(w)!));
      }
    }
  }
  return sccs.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

// ── Register built-ins ──────────────────────────────────────────────────────

registerProbe("no-cycles", noCyclesProbe);
registerProbe("layer-rules", layerRulesProbe);
registerProbe("symbol-isolation", symbolIsolationProbe);
registerProbe("gate-coverage", gateCoverageProbe);
registerProbe("fingerprint", fingerprintProbe);
