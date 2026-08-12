#!/usr/bin/env bun
// custom-probe demo — the kit is extensible: register your OWN probe, then reference it by
// name in a contract (the same pattern site-surveys uses for its runtime-mcp-isolation
// probe). Here a "no-eval" probe fails any scanned source that calls eval().
//
// (Imports the LOCAL source barrel; a real consumer writes `from "@ebowwa/codegen-kit"`.)
import { runShapesChecks, registerProbe, newResult } from "../src/index.js";
import type { ShapeContract, ProbeContext, InvariantSpec, ValidateResult } from "../src/index.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturesRoot = resolve(import.meta.dir, "fixtures");

// A consumer-defined probe: pure (ctx, spec) => ValidateResult. It re-reads source via
// ctx.repoRoot, exactly like the built-in lexical probes (gate-coverage, fingerprint).
function noEvalProbe(ctx: ProbeContext, _spec: InvariantSpec): ValidateResult {
  const r = newResult(ctx.graph.nodes.size, ctx.graph.nodes.size);
  for (const path of ctx.graph.nodes.keys()) {
    let src: string;
    try {
      src = readFileSync(resolve(ctx.repoRoot, path), "utf-8");
    } catch {
      continue;
    }
    if (/\beval\s*\(/.test(src)) {
      r.errors.push({ kind: "eval", severity: "error", message: `${path} calls eval() — forbidden` });
    }
  }
  return r;
}

// Registered at module load (before runShapesChecks runs below). The built-ins are registered
// the same way, by side effect, when the runner imports ./probes.js — same registry.
registerProbe("no-eval", noEvalProbe);

const noEvalShape: ShapeContract = {
  name: "no-eval",
  description: "A custom consumer probe: no scanned module may call eval().",
  archetype: "ordinal-layered-pipeline",
  status: "active",
  invariants: [{ name: "no-eval", probe: "no-eval" }],
};

function run(label: string, repoRoot: string): number {
  console.log(`\n────────────────────  ${label}  ────────────────────\n`);
  return runShapesChecks([noEvalShape], {
    repoRoot,
    layerRules: [{ pattern: "*", layer: "src" }],
    verbose: true,
  }).failed;
}

const cleanFailed = run("CLEAN — no eval (expect green)", resolve(fixturesRoot, "shop-clean"));
const brokenFailed = run("BROKEN — contains eval (expect red)", resolve(fixturesRoot, "shop-broken"));

console.log(`\nclean : ${cleanFailed} failing invariant(s) — expected 0`);
console.log(`broken: ${brokenFailed} failing invariant(s) — expected 1`);
if (cleanFailed !== 0 || brokenFailed === 0) {
  console.error("\n✗ unexpected: the custom probe did not behave as intended.");
  process.exit(1);
}
console.log("\n✓ custom-probe demo OK — a consumer-defined probe, resolved by name like the built-ins.");
