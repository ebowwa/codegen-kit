import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { extractSpecifiers, resolveSpecifier, regexGraphBuilder, findCycles } from "../src/shapes/graph.js";
import type { ModuleGraph, ModuleNode, ModuleEdge } from "../src/shapes/graph.js";
import { noCyclesProbe, layerRulesProbe, symbolIsolationProbe, gateCoverageProbe, fingerprintProbe } from "../src/shapes/probes.js";
import { writeShapeSnapshot, diffShapeSnapshot } from "../src/shapes/drift.js";
import { runShapesChecks } from "../src/shapes/runner.js";
import type { ProbeContext, ShapeContract, InvariantSpec } from "../src/shapes/shape-contract.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Build a ModuleGraph in memory from node specs (no disk). Edges derive from `resolved`. */
function makeGraph(
  specs: Array<{ path: string; imports?: string[]; resolved?: string[] }>,
  repoRoot = "",
): ModuleGraph {
  // Collect final per-node data, ensuring every referenced target is also a node.
  const data = new Map<string, { imports: string[]; resolved: string[] }>();
  for (const s of specs) {
    if (!data.has(s.path)) data.set(s.path, { imports: [], resolved: [] });
    data.get(s.path)!.imports = s.imports ?? [];
    data.get(s.path)!.resolved = s.resolved ?? [];
    for (const to of s.resolved ?? []) if (!data.has(to)) data.set(to, { imports: [], resolved: [] });
  }
  const nodes = new Map<string, ModuleNode>();
  const adj = new Map<string, Set<string>>();
  const radj = new Map<string, Set<string>>();
  const edgeSet = new Set<string>();
  const edges: ModuleEdge[] = [];
  for (const [path, { imports, resolved }] of data) {
    nodes.set(path, { path, imports, resolvedImports: resolved });
    adj.set(path, new Set(resolved));
    for (const to of resolved) {
      if (!radj.has(to)) radj.set(to, new Set());
      radj.get(to)!.add(path);
      const key = `${path}\0${to}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ from: path, to });
      }
    }
  }
  edges.sort((a, b) => (a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from)));
  return { nodes, edges, adj, radj, repoRoot };
}

const ctxOf = (
  graph: ModuleGraph,
  layerOf: (p: string) => string,
  repoRoot = "",
  contract?: ShapeContract,
): ProbeContext => ({
  graph,
  repoRoot,
  layerOf,
  contract: contract ?? {
    name: "test",
    description: "",
    archetype: "ordinal-layered-pipeline",
    invariants: [],
    status: "active",
  },
});

const inv = (probe: string, config?: Record<string, unknown>, severity?: "error" | "warning"): InvariantSpec => ({
  name: probe,
  probe,
  config,
  severity,
});

/** Write a tmp repo of {relPath: contents} and return its root. */
function writeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "shapes-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content, "utf-8");
  }
  return root;
}

// ── Specifier extraction + resolution ───────────────────────────────────────

describe("extractSpecifiers", () => {
  test("captures import, export-from, side-effect, require, and dynamic import", () => {
    const src = `
      import a from "./a";
      import { b } from "../b.js";
      import "./side";
      const c = require("cjs");
      const d = import("./dyn");
      export { e } from "./e";
    `;
    expect(extractSpecifiers(src).sort()).toEqual(["../b.js", "./a", "./dyn", "./e", "./side", "cjs"]);
  });
});

describe("resolveSpecifier", () => {
  const scanned = new Set(["src/a.ts", "src/b.ts", "src/sub/c.ts", "src/mod/index.ts"]);
  test("relative with and without extension", () => {
    expect(resolveSpecifier("./b", "src", scanned)).toBe("src/b.ts");
    expect(resolveSpecifier("./b.js", "src", scanned)).toBe("src/b.ts");
    expect(resolveSpecifier("./a", "src", scanned)).toBe("src/a.ts");
  });
  test("parent dir traversal", () => {
    expect(resolveSpecifier("../a", "src/sub", scanned)).toBe("src/a.ts");
  });
  test("index resolution", () => {
    expect(resolveSpecifier("./mod", "src", scanned)).toBe("src/mod/index.ts");
  });
  test("bare external specifier is undefined", () => {
    expect(resolveSpecifier("react", "src", scanned)).toBeUndefined();
  });
  test("alias rewritten to repo-relative then resolved", () => {
    expect(resolveSpecifier("@/b", "src/sub", scanned, { "@": "src/" })).toBe("src/b.ts");
  });
});

// ── Builder + cycles ────────────────────────────────────────────────────────

describe("regexGraphBuilder", () => {
  test("builds nodes + resolved edges from a tmp repo, skips bare externals", () => {
    const root = writeRepo({
      "src/a.ts": `import { b } from "./b";\nimport React from "react";\n`,
      "src/b.ts": `export const b = 1;\n`,
      "src/c.ts": `import { b } from "./b";\n`,
    });
    const g = regexGraphBuilder.build({ repoRoot: root });
    expect([...g.nodes.keys()].sort()).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(g.edges).toContainEqual({ from: "src/a.ts", to: "src/b.ts" });
    expect(g.edges).toContainEqual({ from: "src/c.ts", to: "src/b.ts" });
    // "react" is bare → not an edge
    expect(g.edges.find((e) => e.to.includes("react"))).toBeUndefined();
  });

  test("respects exclude globs", () => {
    const root = writeRepo({
      "src/keep.ts": `import { x } from "./x";\n`,
      "src/x.ts": `export const x = 1;\n`,
      "src/generated.gen.ts": `export const g = 2;\n`,
    });
    const g = regexGraphBuilder.build({ repoRoot: root, exclude: ["src/*.gen.ts"] });
    expect([...g.nodes.keys()]).not.toContain("src/generated.gen.ts");
  });
});

describe("findCycles", () => {
  test("no cycles in a DAG", () => {
    const g = makeGraph([
      { path: "a", resolved: ["b"] },
      { path: "b", resolved: ["c"] },
      { path: "c" },
    ]);
    expect(findCycles(g)).toEqual([]);
  });
  test("detects a 2-cycle and a self-loop", () => {
    const g = makeGraph([
      { path: "a", resolved: ["b"] },
      { path: "b", resolved: ["a"] },
      { path: "c", resolved: ["c"] },
    ]);
    const cycles = findCycles(g);
    expect(cycles).toContainEqual(["a", "b"]);
    expect(cycles).toContainEqual(["c"]);
  });
});

// ── Probes ──────────────────────────────────────────────────────────────────

describe("no-cycles probe", () => {
  test("flags a whole-graph cycle", () => {
    const g = makeGraph([
      { path: "a", resolved: ["b"] },
      { path: "b", resolved: ["a"] },
    ]);
    const r = noCyclesProbe(ctxOf(g, () => "x"), inv("no-cycles"));
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].kind).toBe("cycle");
  });
  test("passes for a DAG", () => {
    const g = makeGraph([{ path: "a", resolved: ["b"] }, { path: "b" }]);
    expect(noCyclesProbe(ctxOf(g, () => "x"), inv("no-cycles")).errors).toEqual([]);
  });
  test("layer subset excludes an out-of-subset cycle", () => {
    // a->b->a cycle, but b is in a different (non-listed) layer → not reported.
    const g = makeGraph([
      { path: "a", resolved: ["b"] },
      { path: "b", resolved: ["a"] },
    ]);
    const layerOf = (p: string) => (p === "a" ? "core" : "edge");
    const r = noCyclesProbe(ctxOf(g, layerOf), inv("no-cycles", { layers: ["core"] }));
    expect(r.errors).toEqual([]);
  });
});

describe("layer-rules probe", () => {
  test("flags a forbidden cross-layer edge", () => {
    const g = makeGraph([{ path: "edge/a.ts", resolved: ["core/b.ts"] }, { path: "core/b.ts" }]);
    const layerOf = (p: string) => (p.startsWith("edge/") ? "edge" : "core");
    const r = layerRulesProbe(ctxOf(g, layerOf), inv("layer-rules", { allowedDeps: { edge: ["edge"], core: [] } }));
    expect(r.errors.length).toBe(1);
    expect(r.errors[0].kind).toBe("layer-violation");
  });
  test("unrestricted layer (omitted) is allowed", () => {
    const g = makeGraph([{ path: "edge/a.ts", resolved: ["core/b.ts"] }, { path: "core/b.ts" }]);
    const layerOf = (p: string) => (p.startsWith("edge/") ? "edge" : "core");
    // edge omitted → unrestricted
    expect(layerRulesProbe(ctxOf(g, layerOf), inv("layer-rules", { allowedDeps: { core: [] } })).errors).toEqual([]);
  });
});

describe("symbol-isolation probe", () => {
  test("flags a forbidden import and honours allow-list", () => {
    const g = makeGraph([
      { path: "src/2o/ai/task.ts", imports: ["../integrations/stripe", "../integrations/mocks/index"], resolved: [] },
    ]);
    const cfg = {
      forbidden: [{ from: "src/2o/ai/*", imports: "*integrations*" }],
      allow: ["*integrations/mocks*"],
    };
    const flagged = symbolIsolationProbe(ctxOf(g, () => "x"), inv("symbol-isolation", cfg));
    expect(flagged.errors.length).toBe(1);
    expect(flagged.errors[0].message).toContain("stripe");
  });
  test("clean when import matches allow-list", () => {
    const g = makeGraph([
      { path: "src/2o/ai/task.ts", imports: ["../integrations/mocks/index"], resolved: [] },
    ]);
    const cfg = {
      forbidden: [{ from: "src/2o/ai/*", imports: "*integrations*" }],
      allow: ["*integrations/mocks*"],
    };
    expect(symbolIsolationProbe(ctxOf(g, () => "x"), inv("symbol-isolation", cfg)).errors).toEqual([]);
  });
});

describe("gate-coverage probe", () => {
  test("flags an ungated call; passes when the chokepoint co-occurs", () => {
    const root = writeRepo({
      "bad.ts": `import { gmail } from "./gmail";\ngmail.send({ to: "x" });\n`,
      "good.ts": `import { evaluateSendGate } from "./gate";\nif (evaluateSendGate(m)) { gmail.send(m); }\n`,
      "gmail.ts": `export const gmail = { send(m){} };\n`,
    });
    const g = regexGraphBuilder.build({ repoRoot: root });
    const cfg = {
      rawCall: "gmail\\.send",
      chokepoint: "evaluateSendGate",
      exemptPaths: ["gmail.ts"],
    };
    const r = gateCoverageProbe(ctxOf(g, () => "x", root), inv("gate-coverage", cfg));
    const bad = r.errors.find((e) => e.message.startsWith("bad.ts"));
    expect(bad).toBeDefined();
    expect(r.errors.find((e) => e.message.startsWith("good.ts"))).toBeUndefined();
    expect(r.errors.find((e) => e.message.startsWith("gmail.ts"))).toBeUndefined();
  });
});

describe("fingerprint probe", () => {
  test("matches a declared baseline and fails on drift", () => {
    const root = writeRepo({
      "types.ts": `export type PhaseId =\n  | "intake" | "qualify" | "scope"\n  | "confirm" | "execute" | "complete" | "settle";\n`,
    });
    const g = regexGraphBuilder.build({ repoRoot: root });
    const header = `type PhaseId\\s*=\\s*([\\s\\S]*?);`;
    const baseline = ["intake", "qualify", "scope", "confirm", "execute", "complete", "settle"];
    const ok = fingerprintProbe(ctxOf(g, () => "x", root), inv("fingerprint", { source: "types.ts", header, expected: baseline }));
    expect(ok.errors).toEqual([]);
    const drifted = fingerprintProbe(ctxOf(g, () => "x", root), inv("fingerprint", { source: "types.ts", header, expected: [...baseline, "extra"] }));
    expect(drifted.errors.length).toBeGreaterThan(0);
  });
});

// ── Drift ───────────────────────────────────────────────────────────────────

describe("drift snapshot", () => {
  test("unchanged graph is non-breaking; layer reassignment is breaking", () => {
    const g1 = makeGraph([{ path: "src/a.ts", resolved: ["src/b.ts"] }, { path: "src/b.ts" }]);
    const layerOf = (p: string) => (p === "src/a.ts" ? "core" : "edge");
    const root = writeRepo({ ".snap.json": "" });
    const snap = join(root, ".snap.json");
    writeShapeSnapshot(g1, layerOf, snap);
    // same graph + same layers → no breaking change
    const same = diffShapeSnapshot(g1, layerOf, snap);
    expect(same.hasBreaking).toBe(false);
    // move a.ts to a different layer → breaking
    const moved = diffShapeSnapshot(g1, () => "edge", snap);
    expect(moved.hasBreaking).toBe(true);
  });
});

// ── End-to-end runner ───────────────────────────────────────────────────────

describe("runShapesChecks (end-to-end)", () => {
  test("runs a contract's invariants against a tmp repo and aggregates pass/fail", () => {
    const root = writeRepo({
      "src/2o/ai/task.ts": `import { stripe } from "../1o/integrations/stripe";\n`,
      "src/1o/integrations/stripe.ts": `export const stripe = {};\n`,
      "src/1o/integrations/mocks/index.ts": `export const ModelMock = {};\n`,
    });
    const layerRules = [
      { pattern: "src/1o/**", layer: "1o" },
      { pattern: "src/2o/**", layer: "2o" },
      { pattern: "*", layer: "misc" },
    ];
    const contract: ShapeContract = {
      name: "generative-firewall",
      description: "2o/ai may not import integrations except mocks",
      archetype: "ordinal-layered-pipeline",
      axes: { generativeBoundary: "2o/ai isolated from 1o/integrations" },
      status: "active",
      invariants: [
        inv("symbol-isolation", {
          forbidden: [{ from: "src/2o/ai/*", imports: "*1o/integrations*" }],
          allow: ["*1o/integrations/mocks*"],
        }),
      ],
    };
    const report = runShapesChecks([contract], { repoRoot: root, layerRules });
    expect(report.failed).toBe(1); // task.ts imports stripe → violation
    expect(report.results[0].result.errors[0].kind).toBe("forbidden-import");
    expect(report.fingerprint.summary).toContain("generative-firewall");
  });
});
