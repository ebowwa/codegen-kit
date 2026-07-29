import { describe, test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  classifyLayer,
  buildPackageGraph,
  validateBuildOrder,
  findCriticalPath,
} from "../src/package-graph.js";
import type { PackageGraph, PackageLayer } from "../src/package-graph.js";

const LAYER_RULES: Array<{ pattern: string; layer: PackageLayer }> = [
  { pattern: "packages/contract/*", layer: "contract" },
  { pattern: "packages/core/*", layer: "core" },
  { pattern: "packages/edge/*", layer: "edge" },
  { pattern: "*", layer: "tooling" },
];

// Conventional dependency direction: contract <- core <- edge, tooling unrestricted.
// `buildPackageGraph` ignores this (only `validateLayerRules` reads it); it just has to
// satisfy the Record<PackageLayer, PackageLayer[]> type.
const ALLOWED_DEPS: Record<PackageLayer, PackageLayer[]> = {
  contract: [],
  core: ["contract"],
  edge: ["contract", "core"],
  tooling: ["contract", "core", "edge", "tooling"],
};

describe("classifyLayer", () => {
  test("classifies by first matching path glob", () => {
    expect(classifyLayer("packages/contract/a", LAYER_RULES)).toBe("contract");
    expect(classifyLayer("packages/core/b", LAYER_RULES)).toBe("core");
    expect(classifyLayer("packages/edge/c", LAYER_RULES)).toBe("edge");
  });

  test("* glob matches deep paths because * spans /", () => {
    expect(classifyLayer("packages/contract/foo/bar", LAYER_RULES)).toBe("contract");
  });

  test("falls back to 'tooling' when no rule matches", () => {
    expect(classifyLayer("scripts/x", LAYER_RULES)).toBe("tooling");
    expect(classifyLayer(".", LAYER_RULES)).toBe("tooling");
  });

  test("returns 'tooling' for an empty rule list", () => {
    expect(classifyLayer("packages/anything/x", [])).toBe("tooling");
  });
});

/** Build a temp monorepo with a 3-package dependency chain: c -> b -> a. */
function buildChainRepo(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), "pg-chain-"));
  const write = (rel: string, pkg: Record<string, unknown>) => {
    const abs = join(repoRoot, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(pkg));
  };
  write("packages/contract/a/package.json", { name: "@scope/a", version: "1.0.0" });
  write("packages/core/b/package.json", {
    name: "@scope/b",
    version: "1.0.0",
    dependencies: { "@scope/a": "^1.0.0" },
  });
  write("packages/edge/c/package.json", {
    name: "@scope/c",
    version: "1.0.0",
    dependencies: { "@scope/a": "^1.0.0", "@scope/b": "^1.0.0" },
  });
  return repoRoot;
}

describe("buildPackageGraph", () => {
  test("discovers packages, classifies layers, and assigns topological levels", () => {
    const repoRoot = buildChainRepo();
    const graph = buildPackageGraph({
      repoRoot,
      scope: "@scope",
      layerRules: LAYER_RULES,
      allowedDeps: ALLOWED_DEPS,
    });

    expect(graph.nodes.size).toBe(3);
    expect(graph.scope).toBe("@scope");

    const a = graph.nodes.get("@scope/a")!;
    const b = graph.nodes.get("@scope/b")!;
    const c = graph.nodes.get("@scope/c")!;

    expect(a.layer).toBe("contract");
    expect(b.layer).toBe("core");
    expect(c.layer).toBe("edge");

    // a = leaf (level 0), b depends on a (level 1), c depends on b & a (level 2).
    expect(a.level).toBe(0);
    expect(b.level).toBe(1);
    expect(c.level).toBe(2);

    expect(graph.cycles).toEqual([]);
    expect(graph.levels[0].map((n) => n.name)).toEqual(["@scope/a"]);
    expect(graph.levels[2].map((n) => n.name)).toEqual(["@scope/c"]);
  });

  test("internal deps are recorded on each node; externals separated out", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pg-deps-"));
    const write = (rel: string, pkg: Record<string, unknown>) => {
      const abs = join(repoRoot, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, JSON.stringify(pkg));
    };
    write("packages/core/a/package.json", { name: "@scope/a", version: "1.0.0" });
    write("packages/edge/b/package.json", {
      name: "@scope/b",
      version: "1.0.0",
      dependencies: { "@scope/a": "^1.0.0", "react": "^18.0.0" },
    });

    const graph = buildPackageGraph({
      repoRoot,
      scope: "@scope",
      layerRules: LAYER_RULES,
      allowedDeps: ALLOWED_DEPS,
    });

    const b = graph.nodes.get("@scope/b")!;
    expect(b.deps).toEqual(["@scope/a"]);
    expect(b.externalDeps).toEqual(["react"]);
    expect(b.depVersions?.get("@scope/a")).toBe("^1.0.0");
    expect(graph.totalExternalDeps).toBe(1);
  });
});

describe("findCriticalPath", () => {
  test("returns the longest dependency chain, leaf -> top", () => {
    const repoRoot = buildChainRepo();
    const graph = buildPackageGraph({
      repoRoot,
      scope: "@scope",
      layerRules: LAYER_RULES,
      allowedDeps: ALLOWED_DEPS,
    });

    expect(findCriticalPath(graph)).toEqual(["@scope/a", "@scope/b", "@scope/c"]);
  });

  test("returns [] for a graph with no leveled nodes", () => {
    const empty: PackageGraph = {
      nodes: new Map(),
      levels: [],
      cycles: [],
      scope: "@scope",
      totalExternalDeps: 0,
    };
    expect(findCriticalPath(empty)).toEqual([]);
  });
});

describe("validateBuildOrder", () => {
  test("returns no issues when every internal dep resolves to a graph node", () => {
    const repoRoot = buildChainRepo();
    const graph = buildPackageGraph({
      repoRoot,
      scope: "@scope",
      layerRules: LAYER_RULES,
      allowedDeps: ALLOWED_DEPS,
    });
    expect(validateBuildOrder(graph)).toEqual([]);
  });

  test("flags orphan deps: a @scope/* dep with no matching node and no exemption", () => {
    // Hand-built graph keeps this an isolated unit test (no filesystem).
    const fakeGraph: PackageGraph = {
      nodes: new Map([
        [
          "@scope/x",
          {
            name: "@scope/x",
            path: "packages/core/x",
            layer: "core",
            deps: ["@scope/ghost"],
            level: 0,
          },
        ],
      ]),
      levels: [],
      cycles: [],
      scope: "@scope",
      totalExternalDeps: 0,
      // knownExternalDeps intentionally absent => nothing exempt.
    };

    const issues = validateBuildOrder(fakeGraph);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("unresolved-internal-dep");
    expect(issues[0].severity).toBe("error");
    expect(issues[0].message).toContain("@scope/ghost");
  });

  test("suppresses orphan report when the dep is passed in knownExternalDeps", () => {
    const fakeGraph: PackageGraph = {
      nodes: new Map([
        [
          "@scope/x",
          {
            name: "@scope/x",
            path: "packages/core/x",
            layer: "core",
            deps: ["@scope/published"],
            level: 0,
          },
        ],
      ]),
      levels: [],
      cycles: [],
      scope: "@scope",
      totalExternalDeps: 0,
    };

    const issues = validateBuildOrder(fakeGraph, new Set(["@scope/published"]));
    expect(issues).toEqual([]);
  });

  test("reports a cycle when one or more nodes could not be leveled", () => {
    const fakeGraph: PackageGraph = {
      nodes: new Map([
        ["@scope/a", { name: "@scope/a", path: "a", layer: "core", deps: ["@scope/b"], level: -1 }],
        ["@scope/b", { name: "@scope/b", path: "b", layer: "core", deps: ["@scope/a"], level: -1 }],
      ]),
      levels: [],
      cycles: [["@scope/a", "@scope/b"]],
      scope: "@scope",
      totalExternalDeps: 0,
    };

    const issues = validateBuildOrder(fakeGraph);
    expect(issues.some((i) => i.kind === "cycle")).toBe(true);
  });
});
