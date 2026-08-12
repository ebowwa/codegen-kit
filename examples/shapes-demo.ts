#!/usr/bin/env bun
// shapes demo — declare a service's architecture as a checkable contract and run all five
// built-in probes against it. Mirrors how a real consumer (site-surveys) uses the kit, in
// miniature: a CLEAN fixture (all green) and a deliberately-BROKEN twin (all red).
//
// (Imports the LOCAL source barrel; a real consumer writes `from "@ebowwa/codegen-kit"`.)
import { runShapesChecks } from "../src/index.js";
import type { ShapeContract } from "../src/index.js";
import { resolve } from "node:path";

const fixturesRoot = resolve(import.meta.dir, "fixtures");

// One repo-wide layering. The fixture is flat (one file per layer); the catch-all lands on
// "misc". classifyLayer is first-match-wins, so the `*` catch-all stays last.
const layerRules: ReadonlyArray<{ pattern: string; layer: string }> = [
  { pattern: "handlers.ts", layer: "handlers" },
  { pattern: "domain.ts", layer: "domain" },
  { pattern: "db.ts", layer: "db" },
  { pattern: "email.ts", layer: "email" },
  { pattern: "ai.ts", layer: "ai" },
  { pattern: "phases.ts", layer: "phases" },
  { pattern: "*", layer: "misc" },
];

// The contract: an ordinal-layered service with a generative boundary (ai isolated from
// persistence) and a gated send (every sendEmail behind assertCanSend).
const shopShape: ShapeContract = {
  name: "shop",
  description: "Tiny ordinal service: handlers -> domain -> db, a gated email sender, an isolated ai layer.",
  archetype: "ordinal-layered-pipeline",
  axes: {
    generativeBoundary: "ai.ts may not import db.ts (generative layer isolated from persistence)",
    sourceOfTruth: "db.ts is the persistence leaf; everything flows down to it",
  },
  status: "active",
  invariants: [
    { name: "acyclic", probe: "no-cycles" },
    {
      name: "dependency-direction",
      probe: "layer-rules",
      config: { allowedDeps: { handlers: ["domain", "email", "phases"], domain: ["db"], email: ["db"] } },
    },
    {
      name: "generative-boundary",
      probe: "symbol-isolation",
      config: { forbidden: [{ from: "ai.ts", imports: "*db*" }] },
    },
    {
      name: "send-gate",
      probe: "gate-coverage",
      config: { rawCall: "sendEmail\\(", chokepoint: "assertCanSend" },
    },
    {
      name: "phase-fingerprint",
      probe: "fingerprint",
      config: {
        source: "phases.ts",
        header: "type Phase\\s*=\\s*([\\s\\S]*?);",
        expected: ["cart", "checkout", "fulfilled"],
      },
    },
  ],
};

function run(label: string, repoRoot: string): number {
  console.log(`\n────────────────────  ${label}  ────────────────────\n`);
  return runShapesChecks([shopShape], { repoRoot, layerRules, verbose: true }).failed;
}

const cleanFailed = run("CLEAN fixture — expect all green", resolve(fixturesRoot, "shop-clean"));
const brokenFailed = run("BROKEN fixture — expect all red", resolve(fixturesRoot, "shop-broken"));

console.log("\n────────────────────  summary  ────────────────────");
console.log(`clean : ${cleanFailed} failing invariant(s) — expected 0`);
console.log(`broken: ${brokenFailed} failing invariant(s) — expected 5`);
if (cleanFailed !== 0) {
  console.error("\n✗ unexpected: the CLEAN fixture should pass every probe.");
  process.exit(1);
}
if (brokenFailed === 0) {
  console.error("\n✗ unexpected: the BROKEN fixture should fail every probe.");
  process.exit(1);
}
console.log("\n✓ shapes demo OK — clean green, broken red, every probe caught its violation.");
