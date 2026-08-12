// @ebowwa/codegen-kit — shapes CLI entry.
//
// Generic runner for consumers who don't want to write their own. A config module
// (default `./shapes.config.js`) default-exports `{ contracts, repoRoot, layerRules,
// alias?, exclude?, snapshotPath? }`. Modes:
//   bun run src/shapes/cli.ts                          # check (exit 1 on any failed invariant)
//   bun run src/shapes/cli.ts --mode snapshot          # write/refresh the baseline
//   bun run src/shapes/cli.ts --mode drift             # diff vs baseline (exit 1 on breaking)
//   bun run src/shapes/cli.ts --config ./foo.js --verbose
//
// Most consumers (e.g. site-surveys) instead write a project-local `check.ts` that
// imports {@link runShapesChecks} directly — same pattern as codegen systems.

import { resolve } from "node:path";
import { cwd } from "node:process";
import { isMainEntry } from "../validator.js";
import { runShapesChecks } from "./runner.js";
import { writeShapeSnapshot, diffShapeSnapshot } from "./drift.js";
import { classifyLayer } from "../package-graph.js";
import { regexGraphBuilder } from "./graph.js";
import type { ShapeContract } from "./shape-contract.js";

export interface ShapesCliConfig {
  contracts: readonly ShapeContract[];
  repoRoot: string;
  layerRules: ReadonlyArray<{ pattern: string; layer: string }>;
  alias?: Record<string, string>;
  exclude?: readonly string[];
  snapshotPath?: string;
}

function argValue(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function runShapesCli(args: readonly string[]): Promise<void> {
  const configPath = argValue(args, "--config") ?? "./shapes.config.js";
  const mode = argValue(args, "--mode") ?? "check";
  const verbose = args.includes("--verbose");

  const loaded = await import(resolve(cwd(), configPath));
  const cfg: ShapesCliConfig = loaded.default ?? loaded;

  if (mode === "snapshot") {
    const graph = regexGraphBuilder.build({ repoRoot: cfg.repoRoot, alias: cfg.alias, exclude: cfg.exclude });
    if (!cfg.snapshotPath) throw new Error("shapes snapshot: config.snapshotPath is required");
    writeShapeSnapshot(graph, (p) => classifyLayer(p, cfg.layerRules), resolve(cfg.repoRoot, cfg.snapshotPath));
    return;
  }

  if (mode === "drift") {
    const graph = regexGraphBuilder.build({ repoRoot: cfg.repoRoot, alias: cfg.alias, exclude: cfg.exclude });
    if (!cfg.snapshotPath) throw new Error("shapes drift: config.snapshotPath is required");
    const result = diffShapeSnapshot(graph, (p) => classifyLayer(p, cfg.layerRules), resolve(cfg.repoRoot, cfg.snapshotPath));
    console.log(`shape drift: ${result.changes.length} change(s), ${result.errors.length} breaking`);
    for (const c of result.changes) {
      const tag = c.severity === "error" ? "BREAK" : c.severity === "warning" ? "warn" : "info";
      console.log(`  [${tag}] [${c.kind}] ${c.identity}${c.field ? `/${c.field}` : ""} — ${c.message}`);
    }
    process.exit(result.hasBreaking ? 1 : 0);
  }

  const report = runShapesChecks(cfg.contracts, {
    repoRoot: cfg.repoRoot,
    layerRules: cfg.layerRules,
    alias: cfg.alias,
    exclude: cfg.exclude,
    verbose,
  });
  process.exit(report.failed > 0 ? 1 : 0);
}

if (isMainEntry(import.meta.url, "cli.ts")) {
  runShapesCli(process.argv.slice(2)).catch((err) => {
    console.error(`shapes: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
