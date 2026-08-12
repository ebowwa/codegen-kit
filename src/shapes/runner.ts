// @ebowwa/codegen-kit — shapes runner: orchestrates a shape check across one or many
// contracts.
//
// Mirrors the systems framework's shape (declarative contracts walked by a runner) but
// stays in-process: the module graph is built ONCE and shared by every invariant of every
// active contract, each resolved to a pure probe via the registry. Returns a structured
// report; printing mirrors ./systems.js (▸ contract, ✓/✗ per invariant, results block).

import { classifyLayer } from "../package-graph.js";
import { regexGraphBuilder } from "./graph.js";
import type { GraphBuilder, GraphBuilderOpts } from "./graph.js";
import { getProbe } from "./shape-contract.js";
import type { ProbeContext, ShapeContract } from "./shape-contract.js";
import { classifyShape } from "./classify.js";
import type { ShapeFingerprint } from "./classify.js";
import type { ValidateResult } from "../validator.js";
import "./probes.js"; // side-effect: register the five built-in probes

// ── Options + report ────────────────────────────────────────────────────────

export interface ShapeRunOpts {
  readonly repoRoot: string;
  /** Repo-wide layer classification (first match wins; `*` spans `/`). Shared by all
   *  contracts — a repo has one module layering. */
  readonly layerRules: ReadonlyArray<{ pattern: string; layer: string }>;
  readonly alias?: GraphBuilderOpts["alias"];
  readonly skipDirs?: GraphBuilderOpts["skipDirs"];
  readonly exclude?: GraphBuilderOpts["exclude"];
  /** Override the default stdlib regex builder (e.g. a ts-morph adapter). */
  readonly builder?: { build(opts: GraphBuilderOpts): ReturnType<GraphBuilder["build"]> };
  readonly verbose?: boolean;
}

export interface InvariantResult {
  readonly contract: string;
  readonly invariant: string;
  readonly probe: string;
  readonly result: ValidateResult;
}

export interface ShapeCheckReport {
  readonly results: readonly InvariantResult[];
  readonly passed: number;
  readonly failed: number;
  readonly fingerprint: ShapeFingerprint;
}

// ── Registry helpers (mirror ./systems.js) ──────────────────────────────────

export function getActiveShapes(contracts: readonly ShapeContract[]): ShapeContract[] {
  return contracts.filter((c) => c.status === "active");
}

export function getShape(contracts: readonly ShapeContract[], name: string): ShapeContract | undefined {
  return contracts.find((c) => c.name === name);
}

// ── Runner ──────────────────────────────────────────────────────────────────

/**
 * Build the module graph once, classify layers, then run every active contract's
 * invariants against it. Returns a structured report and prints a systems-style summary.
 * Does not call process.exit — callers (CLI) decide exit semantics.
 */
export function runShapesChecks(
  contracts: readonly ShapeContract[],
  opts: ShapeRunOpts,
): ShapeCheckReport {
  const builder = opts.builder ?? regexGraphBuilder;
  const graph = builder.build({
    repoRoot: opts.repoRoot,
    alias: opts.alias,
    skipDirs: opts.skipDirs,
    exclude: opts.exclude,
  });
  const layerOf = (relPath: string): string => classifyLayer(relPath, opts.layerRules);

  const active = getActiveShapes(contracts);
  const totalInvariants = active.reduce((n, c) => n + c.invariants.length, 0);
  const fingerprint = classifyShape(graph, active, layerOf);

  console.log(`shapes: ${graph.nodes.size} modules / ${graph.edges.length} edges`);
  console.log(`fingerprint: ${fingerprint.summary}\n`);
  console.log(`${active.length} active shape(s), ${totalInvariants} invariant(s)\n`);

  const results: InvariantResult[] = [];
  for (const contract of active) {
    if (contract.invariants.length === 0) continue;
    console.log(`▸ ${contract.name} (${contract.invariants.length} invariants)`);
    for (const inv of contract.invariants) {
      const probe = getProbe(inv.probe);
      const ctx: ProbeContext = { graph, repoRoot: opts.repoRoot, layerOf, contract };
      const result = probe(ctx, inv);
      results.push({ contract: contract.name, invariant: inv.name, probe: inv.probe, result });
      const ok = result.errors.length === 0;
      if (ok) {
        if (opts.verbose) {
          const w = result.warnings.length > 0 ? ` (${result.warnings.length} warn)` : "";
          console.log(`  ✓ ${inv.name} [${inv.probe}] — ${result.entityCount} entities${w}`);
        } else process.stdout.write("  ✓");
      } else {
        console.log(`\n  ✗ ${inv.name} [${inv.probe}] — ${result.errors.length} error(s)`);
        for (const e of result.errors) console.log(`      [${e.kind}] ${e.message}`);
      }
    }
    if (!opts.verbose) console.log("");
  }

  const failed = results.filter((r) => r.result.errors.length > 0).length;
  const passed = results.length - failed;
  console.log(`--- Results ---\nPassed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`\nFailed invariants:`);
    for (const r of results.filter((r) => r.result.errors.length > 0)) {
      console.log(`  ✗ ${r.contract}/${r.invariant} [${r.probe}]`);
    }
  }
  return { results, passed, failed, fingerprint };
}
