#!/usr/bin/env bun
// systems demo (Layer 2 — systems framework): a declarative SYSTEMS registry, walked by
// runSystemsGenerators + runSystemsValidators. Each generator/validator is a real script
// (under fixtures/systems/) run as a `bun run` subprocess, exactly like the README's
// "Registry-driven codegen pipeline" snippet — but runnable end-to-end here.
//
// (Imports the LOCAL source barrel; a real consumer writes `from "@ebowwa/codegen-kit"`.)
import { runSystemsGenerators, runSystemsValidators, findMissingClaimedScripts } from "../src/index.js";
import type { SystemContract } from "../src/index.js";
import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, ".."); // codegen-kit root (this file lives in examples/)
const packageRoot = repoRoot;

const SYSTEMS: SystemContract[] = [
  {
    name: "types-manifest",
    description: "Derive a flat type manifest from source/types.ts.",
    source: "examples/fixtures/systems/source/types.ts",
    targets: [{ lang: "txt", path: "<tmp>/codegen-kit-demo-types-manifest.txt", description: "flat manifest" }],
    generators: [
      { name: "generate", script: "examples/fixtures/systems/generate-types.ts", description: "write the manifest" },
    ],
    validators: [
      { name: "count", script: "examples/fixtures/systems/validate-types.ts", description: "one entry per spec" },
    ],
    status: "active",
  },
];

console.log("systems demo — declarative registry walked by the kit (Layer 2)\n");

const missing = findMissingClaimedScripts(SYSTEMS, repoRoot);
if (missing.length > 0) {
  console.error("missing claimed generator scripts:", missing);
  process.exit(1);
}

console.log("=== runSystemsGenerators (write) ===");
const gen = runSystemsGenerators(SYSTEMS, { packageRoot, repoRoot, check: false, verbose: true });

console.log("\n=== runSystemsValidators ===");
const val = runSystemsValidators(SYSTEMS, { packageRoot, repoRoot, verbose: true });

console.log("\n=== runSystemsGenerators (--check / drift mode) ===");
const chk = runSystemsGenerators(SYSTEMS, { packageRoot, repoRoot, check: true, verbose: true });

const failed = gen.failed + val.failed + chk.failed;
if (failed > 0) {
  console.error(`\n✗ ${failed} step(s) failed.`);
  process.exit(1);
}
console.log("\n✓ systems demo OK — generate -> validate -> check, all green.");
