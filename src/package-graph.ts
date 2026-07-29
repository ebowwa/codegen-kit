// @ebowwa/codegen-kit — package dependency graph, build-order validation, and CI matrix.
//
// Extracted from secondsee/node-codegen's generate-package-graph, validate-build-order,
// and generate-ci-matrix. Domain-agnostic: the caller provides the layer rules and the
// allowed dependency directions; this module supplies the DAG construction, Kahn's
// topological sort, cycle/orphan/layer-rule validation, JSON + Mermaid serialization,
// and a GitHub Actions build-matrix generator.
//
// Layer model: the conventional four layers form a dependency direction
// `contract <- core <- edge`, with `tooling` unrestricted. The layer names and rules
// are fully caller-configurable (GraphOpts.layerRules + GraphOpts.allowedDeps).

import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, relative } from "node:path";
// `discoverInternalVersions` resolves @scope/* version constraints and the set of
// @scope/* packages that are published (not co-located in the repo). It is the only
// non-stdlib dependency; see ./version-discovery.js. If its underlying walk throws,
// the graph still builds — version labels and published-package exemption degrade.
import { discoverInternalVersions, SKIP_DIRS } from "./version-discovery.js";

// ── Types ──

/**
 * Architectural layer for a package. The conventional layers form a dependency
 * direction `contract <- core <- edge`, with `tooling` unrestricted. The type is
 * extensible: consumers may define additional layer names (e.g. `"vendor"`).
 */
export type PackageLayer = "contract" | "core" | "edge" | "tooling" | (string & {});

/**
 * A discovered package and its resolved position in the dependency DAG.
 */
export interface PackageNode {
  /** Package name (the `name` field from package.json). */
  name: string;
  /** Repo-relative directory containing the package.json (`"."` for the root). */
  path: string;
  /** Architectural layer, derived from `layerRules`. */
  layer: PackageLayer;
  /** Internal (@scope/*) dependency names. Edges in the DAG point dep -> dependent. */
  deps: string[];
  /** Topological level: `0` = leaf (no internal deps), increasing = deeper in DAG,
   *  `-1` = unleveled (part of a cycle or unreachable). */
  level: number;
  /** Internal dep name -> version constraint (e.g. `"^1.2.0"`), for Mermaid labels.
   *  Populated by `buildPackageGraph` from each package.json's dependency entries,
   *  falling back to `discoverInternalVersions`. */
  depVersions?: Map<string, string>;
  /** Non-@scope/* dependency names (informational; not part of the DAG). */
  externalDeps?: string[];
}

/**
 * The resolved package dependency DAG.
 */
export interface PackageGraph {
  /** Package name -> node. */
  nodes: Map<string, PackageNode>;
  /** Nodes grouped by topological level (`levels[0]` = leaves). Empty for a
   *  cycle-only graph. Nodes in cycles are intentionally absent (see `cycles`). */
  levels: PackageNode[][];
  /** Each cycle as the sorted list of node names that could not be leveled.
   *  Kahn's algorithm reports at most one bucket of remaining nodes; deeper cycle
   *  decomposition is out of scope. */
  cycles: string[][];
  /** The @scope prefix used to classify internal deps (e.g. `"@ebowwa"`). */
  scope: string;
  /** Total non-@scope/* deps across all packages. */
  totalExternalDeps: number;
  /** @scope/* deps that resolve to published packages (per `discoverInternalVersions`)
   *  and therefore are NOT graph nodes. Exempt from "unresolved-internal-dep". */
  knownExternalDeps?: Set<string>;
}

/**
 * Configuration for {@link buildPackageGraph}.
 */
export interface GraphOpts {
  /** Absolute path to the repository root. */
  repoRoot: string;
  /** Internal package scope prefix, e.g. `"@ebowwa"`. Deps matching `${scope}/*`
   *  are treated as internal DAG edges; all others are external (informational). */
  scope: string;
  /** Layer classification rules, evaluated in declaration order; first match wins.
   *  Each `pattern` is a path glob where `*` matches any run of characters (including
   *  `/`), tested against the package's repo-relative directory.
   *
   *  Examples:
   *    `{ pattern: "packages/tsx/*", layer: "contract" }`
   *    `{ pattern: "cloud/*",       layer: "core"      }`
   *    `{ pattern: "clients/*",     layer: "edge"      }`
   *    `{ pattern: "*",             layer: "tooling"   }`  // catch-all fallback
   */
  layerRules: Array<{ pattern: string; layer: PackageLayer }>;
  /** Allowed dependency direction per source layer: a package in layer L may only
   *  depend on packages whose layer is in `allowedDeps[L]`. Layers omitted from the
   *  map are unrestricted (the conventional behavior for `tooling`). */
  allowedDeps: Record<PackageLayer, PackageLayer[]>;
  /** Directories to skip during the filesystem-walk fallback (git ls-files is the
   *  primary discovery path and ignores these implicitly). Defaults to a sensible
   *  vendored/build-cache set. */
  skipDirs?: Set<string>;
}

/**
 * A validation issue found by {@link validateBuildOrder} or {@link validateLayerRules}.
 */
export interface GraphIssue {
  /** `"cycle"` | `"unresolved-internal-dep"` | `"layer-violation"` (extensible). */
  kind: "unresolved-internal-dep" | "cycle" | "layer-violation" | (string & {});
  severity: "error" | "warning" | "info";
  message: string;
}

/** A single build level in a CI matrix. */
export interface MatrixLevel {
  level: number;
  packages: string[];
  /** Whether packages in this level can build in parallel. The final level is marked
   *  non-parallel when it contains a single package (a bottleneck). */
  parallel: boolean;
}

/** The derived CI build matrix. */
export interface CIMatrix {
  levels: MatrixLevel[];
  /** Longest dependency chain, leaf -> top. Useful for the critical-path display. */
  criticalPath: string[];
  totalPackages: number;
}

// ── Constants ──

/**
 * Default vendored/build-cache dirs to skip during filesystem-walk discovery.
 * Reused from {@link ./version-discovery.js} so the kit has one source of truth
 * (also re-exported from the kit index as `SKIP_DIRS`).
 */
export { SKIP_DIRS };

// ── Layer classification ──

/**
 * Compile a path glob into an anchored regex. `*` matches any run of characters
 * (including `/`), so `clients/*` matches `clients/foo` and `clients/foo/bar`.
 * A pattern without `*` matches exactly. Used internally by {@link classifyLayer}.
 */
export function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex metacharacters (not `/` or `*`)
    .replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Resolve a package's layer from its repo-relative directory. The first matching
 * rule in `layerRules` wins; returns `"tooling"` if no rule matches (matches the
 * conventional "unrestricted fallback" behavior for vendored/tooling packages).
 */
export function classifyLayer(
  relDir: string,
  layerRules: ReadonlyArray<{ pattern: string; layer: PackageLayer }>,
): PackageLayer {
  for (const rule of layerRules) {
    if (globToRegex(rule.pattern).test(relDir)) return rule.layer;
  }
  return "tooling";
}

// ── Package discovery ──

/**
 * Find all `package.json` files under `root`. Uses `git ls-files` for determinism
 * (CI parity — ignores vendored dirs that exist locally but are gitignored), with a
 * sorted filesystem walk as fallback when git is unavailable. The fallback skips
 * `skipDirs` (or {@link DEFAULT_SKIP_DIRS}) to avoid descending into node_modules.
 */
export function findAllPackageJsons(
  root: string,
  skipDirs?: ReadonlySet<string>,
): string[] {
  const skip = skipDirs ?? SKIP_DIRS;
  try {
    const out = execSync("git ls-files -z '**/package.json' 'package.json'", {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return out
      .split("\0")
      .filter(Boolean)
      .sort()
      .map((f) => resolve(root, f));
  } catch {
    const results: string[] = [];
    function walk(dir: string): void {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (skip.has(entry.name)) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "package.json") results.push(full);
      }
    }
    walk(root);
    return results;
  }
}

// ── Build the DAG ──

/** Internal mutable node shape used during construction. */
interface MutableNode {
  name: string;
  path: string;
  layer: PackageLayer;
  deps: string[];
  level: number;
  depVersions: Map<string, string>;
  externalDeps: string[];
}

/**
 * Scan `opts.repoRoot` for packages, classify each into a layer via `opts.layerRules`,
 * extract internal (`${scope}/*`) dependencies, and compute the topological build
 * order with Kahn's algorithm.
 *
 * Side effects: reads the filesystem and (best-effort) calls
 * {@link discoverInternalVersions} to (a) fill in version constraints for Mermaid edge
 * labels and (b) record which @scope/* deps are published packages (exempt from
 * "unresolved-internal-dep"). If `version-discovery.js` is absent or throws, the graph
 * still builds without those enrichments.
 *
 * Cycle detection: any node that Kahn's algorithm cannot level is reported once in
 * `graph.cycles` as a sorted name list. Deeper cycle decomposition (SCCs, edge
 * removal suggestions) is out of scope.
 */
export function buildPackageGraph(opts: GraphOpts): PackageGraph {
  const { repoRoot, scope, layerRules } = opts;
  const scopePrefix = `${scope}/`;
  const skipDirs = opts.skipDirs ?? SKIP_DIRS;

  const files = findAllPackageJsons(repoRoot, skipDirs);

  // Best-effort version enrichment + published-package exemption.
  let internalVersions: Record<string, string> = {};
  try {
    internalVersions = discoverInternalVersions({ repoRoot, scope });
  } catch {
    // version-discovery unavailable — degrade gracefully (no labels, no exemption).
  }

  const nodes = new Map<string, MutableNode>();
  let totalExternalDeps = 0;

  // First pass: register every package + extract deps from package.json.
  for (const file of files) {
    let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(readFileSync(file, "utf-8"));
    } catch {
      continue; // skip malformed package.json
    }
    const name = pkg.name;
    if (!name) continue;

    const relDir = relative(repoRoot, dirname(file));
    const layer = classifyLayer(relDir, layerRules);

    const allDeps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };

    const deps: string[] = [];
    const depVersions = new Map<string, string>();
    const externalDeps: string[] = [];

    for (const [depName, rawVersion] of Object.entries(allDeps)) {
      if (depName.startsWith(scopePrefix)) {
        deps.push(depName);
        const v = rawVersion ?? internalVersions[depName] ?? "";
        depVersions.set(depName, v);
      } else {
        externalDeps.push(depName);
      }
    }
    deps.sort();
    externalDeps.sort();
    totalExternalDeps += externalDeps.length;

    nodes.set(name, { name, path: relDir, layer, deps, level: -1, depVersions, externalDeps });
  }

  // Topological sort (Kahn's). Assigns `level` on each node; collects cycle bucket.
  const cycleNames = kahnTopoSort(nodes);

  // Build knownExternalDeps: @scope/* deps referenced by some node, not present as a
  // node, but listed in the version registry => published, exempt from "unresolved".
  const knownExternalDeps = new Set<string>();
  if (Object.keys(internalVersions).length > 0) {
    for (const node of nodes.values()) {
      for (const dep of node.deps) {
        if (!nodes.has(dep) && internalVersions[dep]) knownExternalDeps.add(dep);
      }
    }
  }

  // Freeze mutable nodes into the public PackageNode shape.
  const nodeMap = new Map<string, PackageNode>();
  for (const [name, n] of nodes) {
    nodeMap.set(name, {
      name: n.name,
      path: n.path,
      layer: n.layer,
      deps: n.deps,
      level: n.level,
      depVersions: n.depVersions,
      externalDeps: n.externalDeps,
    });
  }

  // Group nodes by topological level (index 0 = leaves).
  const maxLevel = [...nodeMap.values()].reduce((m, n) => Math.max(m, n.level), -1);
  const levelBuckets: PackageNode[][] = Array.from({ length: maxLevel + 1 }, () => []);
  for (const node of nodeMap.values()) {
    if (node.level >= 0) levelBuckets[node.level].push(node);
  }
  for (const bucket of levelBuckets) bucket.sort((a, b) => a.name.localeCompare(b.name));

  const cycles = cycleNames.length > 0 ? [cycleNames] : [];

  return {
    nodes: nodeMap,
    levels: levelBuckets,
    cycles,
    scope,
    totalExternalDeps,
    knownExternalDeps,
  };
}

/**
 * Kahn's algorithm: assign each node a level equal to the longest path from a leaf,
 * then return any nodes that remain unleveled (the cycle bucket) as a sorted name
 * list. Mutates `nodes[*].level` in place.
 *
 * Edges are only counted between nodes that both exist in the map — a dep on a
 * package not in the graph (external or unresolved) does not contribute to in-degree.
 */
function kahnTopoSort(nodes: Map<string, MutableNode>): string[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, Set<string>>(); // dep -> dependents

  for (const name of nodes.keys()) {
    inDegree.set(name, 0);
    adj.set(name, new Set());
  }
  for (const [name, node] of nodes) {
    for (const dep of node.deps) {
      if (!nodes.has(dep)) continue; // external/unresolved — flagged elsewhere
      adj.get(dep)!.add(name);
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
    }
  }

  const levelOf = new Map<string, number>();
  const queue: Array<{ name: string; level: number }> = [];
  for (const [name, deg] of inDegree) {
    if (deg === 0) queue.push({ name, level: 0 });
  }

  let processed = 0;
  while (queue.length > 0) {
    const { name, level } = queue.shift()!;
    levelOf.set(name, level);
    processed++;
    for (const dependent of adj.get(name) ?? []) {
      const newDeg = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDeg);
      if (newDeg === 0) queue.push({ name: dependent, level: level + 1 });
    }
  }

  for (const [name, level] of levelOf) {
    nodes.get(name)!.level = level;
  }

  if (processed < nodes.size) {
    return [...nodes.keys()].filter((n) => !levelOf.has(n)).sort();
  }
  return [];
}

// ── Build-order validation ──

/**
 * Validate a package graph's build order.
 *
 * Detects:
 *   - **cycle**: any node Kahn's algorithm could not level (one issue per cycle bucket).
 *   - **unresolved-internal-dep**: a `${scope}/*` dependency that is neither a graph
 *     node nor in `graph.knownExternalDeps` / `knownExternalDeps` (i.e. genuinely missing).
 *
 * `knownExternalDeps` (parameter) overrides `graph.knownExternalDeps` when both are set,
 * letting a caller narrow the exemption set for a particular validation run.
 */
export function validateBuildOrder(
  graph: PackageGraph,
  knownExternalDeps?: ReadonlySet<string>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const exempt = knownExternalDeps ?? graph.knownExternalDeps;

  for (const cycle of graph.cycles) {
    issues.push({
      kind: "cycle",
      severity: "error",
      message: `Circular dependency among: ${cycle.join(" -> ")}`,
    });
  }

  const seen = new Set<string>();
  for (const node of graph.nodes.values()) {
    for (const dep of node.deps) {
      if (graph.nodes.has(dep)) continue;
      if (exempt?.has(dep)) continue;
      const key = `${node.name}->${dep}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push({
        kind: "unresolved-internal-dep",
        severity: "error",
        message: `${node.name} depends on ${dep}, but no such package exists in the graph`,
      });
    }
  }

  return issues;
}

// ── Layer-rule validation ──

/**
 * Enforce dependency direction per `allowedDeps`: a package in layer L may only
 * depend on packages whose layer appears in `allowedDeps[L]`. Layers omitted from
 * `allowedDeps` are unrestricted (the conventional behavior for `tooling`). Deps on
 * packages not in the graph are skipped here ({@link validateBuildOrder} handles them).
 *
 * Example:
 *   `allowedDeps = { contract: [], core: ["contract"], edge: ["contract"] }`
 *   forbids edge -> core, core -> edge, and any contract -> * dependency.
 */
export function validateLayerRules(
  graph: PackageGraph,
  allowedDeps: Readonly<Record<string, readonly PackageLayer[]>>,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const node of graph.nodes.values()) {
    const allowed = allowedDeps[node.layer];
    if (!allowed) continue; // unrestricted layer
    const allowedSet = new Set(allowed);
    for (const dep of node.deps) {
      const depNode = graph.nodes.get(dep);
      if (!depNode) continue;
      if (!allowedSet.has(depNode.layer)) {
        issues.push({
          kind: "layer-violation",
          severity: "error",
          message: `${node.name} [${node.layer}] -> ${dep} [${depNode.layer}]: ${depNode.layer} not in allowed deps for ${node.layer}`,
        });
      }
    }
  }
  return issues;
}

// ── Critical path ──

/**
 * Longest dependency chain in the graph, reconstructed by walking from a highest-level
 * node back to a leaf along each node's highest-level dep. Returns package names in
 * leaf -> top order. Empty if the graph has no leveled nodes (e.g. cycle-only).
 */
export function findCriticalPath(graph: PackageGraph): string[] {
  let maxNode = "";
  let maxLevel = -1;
  for (const node of graph.nodes.values()) {
    if (node.level > maxLevel) {
      maxLevel = node.level;
      maxNode = node.name;
    }
  }
  if (!maxNode) return [];

  const path: string[] = [maxNode];
  let current = maxNode;
  while (true) {
    const node = graph.nodes.get(current);
    if (!node) break;
    let bestDep = "";
    let bestLevel = -1;
    for (const dep of node.deps) {
      const depNode = graph.nodes.get(dep);
      if (!depNode) continue;
      if (depNode.level > bestLevel) {
        bestLevel = depNode.level;
        bestDep = dep;
      }
    }
    if (!bestDep) break;
    path.unshift(bestDep);
    current = bestDep;
  }
  return path;
}

// ── JSON serialization ──

/**
 * Serialize the graph to a deterministic JSON string: stats, cycles, per-level
 * package lists, and per-package detail (path, layer, level, deps, depVersions,
 * externalDeps). Intended for a committed `package-graph.json` artifact. Contains
 * no volatile tokens — safe to diff in `--check` mode as-is.
 */
export function generatePackageGraphJson(graph: PackageGraph): string {
  const maxLevel = graph.levels.length - 1;
  const internalDepCount = [...graph.nodes.values()].reduce(
    (sum, n) => sum + n.deps.length,
    0,
  );

  const packages: Record<string, unknown> = {};
  for (const [name, node] of [...graph.nodes.entries()].sort()) {
    packages[name] = {
      name,
      path: node.path,
      layer: node.layer,
      level: node.level,
      deps: [...node.deps].sort(),
      depVersions: node.depVersions ? Object.fromEntries([...node.depVersions].sort()) : {},
      externalDeps: node.externalDeps ? [...node.externalDeps] : [],
    };
  }

  const buildLevels: Record<number, string[]> = {};
  for (let i = 0; i < graph.levels.length; i++) {
    buildLevels[i] = graph.levels[i].map((n) => n.name);
  }

  return (
    JSON.stringify(
      {
        stats: {
          totalPackages: graph.nodes.size,
          internalDeps: internalDepCount,
          externalDeps: graph.totalExternalDeps,
          buildLevels: Math.max(0, maxLevel + 1),
          circularDependencies: graph.cycles.length,
        },
        cycles: graph.cycles,
        buildLevels,
        packages,
      },
      null,
      2,
    ) + "\n"
  );
}

// ── Markdown (Mermaid) serialization ──

/** Mermaid-safe identifier derived from a package name (`@scope/foo-bar` -> `_scope_foo_bar`). */
function mermaidId(name: string): string {
  return name.replace(/[@/]/g, "_").replace(/-/g, "_");
}

/**
 * Serialize the graph to a Markdown document with a Mermaid `flowchart LR` diagram,
 * one subgraph per layer. Nodes are colored by topological position:
 *   - green  (leaf, level 0)
 *   - blue   (mid)
 *   - orange (top, highest level)
 *   - red dashed (part of a cycle)
 *
 * Edges are labeled with version constraints when `depVersions` is populated. Intended
 * for a committed `package-graph.md` artifact; strip the AUTO-GENERATED line before
 * diffing if you embed a build stamp elsewhere.
 */
export function generatePackageGraphMd(graph: PackageGraph): string {
  const maxLevel = graph.levels.length - 1;
  const internalDepCount = [...graph.nodes.values()].reduce(
    (sum, n) => sum + n.deps.length,
    0,
  );

  const cycleNodes = new Set<string>();
  for (const cycle of graph.cycles) for (const n of cycle) cycleNodes.add(n);

  // Group nodes by layer (subgraph). Layer order is first-seen, which mirrors the
  // order nodes were discovered (sorted git ls-files) — stable across runs.
  const layerGroups = new Map<PackageLayer, string[]>();
  for (const node of graph.nodes.values()) {
    if (!layerGroups.has(node.layer)) layerGroups.set(node.layer, []);
    layerGroups.get(node.layer)!.push(node.name);
  }

  const lines: string[] = [];
  lines.push("# Package Dependency Graph");
  lines.push("");
  lines.push("<!-- AUTO-GENERATED. Do not edit manually. -->");
  lines.push("");

  lines.push("## Stats");
  lines.push("");
  lines.push(`- **Total packages:** ${graph.nodes.size}`);
  lines.push(`- **Internal deps (${graph.scope}/*):** ${internalDepCount}`);
  lines.push(`- **External deps:** ${graph.totalExternalDeps}`);
  lines.push(`- **Build levels:** ${Math.max(0, maxLevel + 1)}`);
  lines.push(`- **Circular dependencies:** ${graph.cycles.length}`);
  lines.push("");

  if (graph.cycles.length > 0) {
    lines.push("## Circular Dependencies");
    lines.push("");
    for (let i = 0; i < graph.cycles.length; i++) {
      lines.push(`${i + 1}. \`${graph.cycles[i].join("` -> `")}\``);
    }
    lines.push("");
  }

  lines.push("## Build Levels");
  lines.push("");
  for (let i = 0; i < graph.levels.length; i++) {
    const pkgs = graph.levels[i].map((n) => n.name);
    const label = i === 0 ? " (leaf)" : i === maxLevel ? " (top)" : "";
    lines.push(`**Level ${i}${label}:** ${pkgs.map((p) => `\`${p}\``).join(", ")}`);
    lines.push("");
  }

  lines.push("## Diagram");
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart LR");
  lines.push("    classDef leaf fill:#4CAF50,color:#fff,stroke:#388E3C,stroke-width:1px");
  lines.push("    classDef mid fill:#2196F3,color:#fff,stroke:#1976D2,stroke-width:1px");
  lines.push("    classDef top fill:#FF9800,color:#fff,stroke:#F57C00,stroke-width:1px");
  lines.push("    classDef cycle fill:#F44336,color:#fff,stroke:#D32F2F,stroke-width:3px,stroke-dasharray:5 5");

  for (const [layer, pkgs] of layerGroups) {
    lines.push(`    subgraph ${mermaidId("sg_" + layer)}["${layer}"]`);
    for (const pkgName of pkgs.sort()) {
      const shortName = pkgName.replace(`${graph.scope}/`, "");
      lines.push(`        ${mermaidId(pkgName)}["${shortName}<br/><small>${pkgName}</small>"]`);
    }
    lines.push("    end");
  }

  lines.push("");
  for (const [name, node] of [...graph.nodes.entries()].sort()) {
    for (const dep of [...node.deps].sort()) {
      if (!graph.nodes.has(dep)) continue; // skip edges to non-graph (external) deps
      const version = node.depVersions?.get(dep);
      const edge = version ? ` -->|"${version}"| ` : " --> ";
      lines.push(`    ${mermaidId(dep)}${edge}${mermaidId(name)}`);
    }
  }

  for (const node of graph.nodes.values()) {
    if (cycleNodes.has(node.name)) {
      lines.push(`    class ${mermaidId(node.name)} cycle`);
    } else if (node.level === 0) {
      lines.push(`    class ${mermaidId(node.name)} leaf`);
    } else if (node.level === maxLevel && maxLevel > 0) {
      lines.push(`    class ${mermaidId(node.name)} top`);
    } else if (node.level > 0) {
      lines.push(`    class ${mermaidId(node.name)} mid`);
    }
  }

  lines.push("```");
  lines.push("");
  lines.push("## Legend");
  lines.push("");
  lines.push("- **Green (leaf):** no internal deps");
  lines.push("- **Blue (mid):** has internal deps");
  lines.push("- **Orange (top):** highest build level");
  lines.push("- **Red dashed:** part of a circular dependency");
  lines.push("");

  return lines.join("\n");
}

// ── CI matrix ──

/**
 * Derive a GitHub Actions build matrix from a package graph: one level per
 * topological stratum, packages within a level build in parallel, levels build
 * sequentially. The final level is marked `parallel: false` if it contains a single
 * package (a bottleneck worth flagging in CI summaries).
 *
 * Pair with {@link generateCIMatrixYaml} for the `strategy.matrix` snippet, or
 * {@link generateCIMatrixJson} for a structured artifact.
 */
export function generateCIMatrix(graph: PackageGraph): CIMatrix {
  const levels: MatrixLevel[] = graph.levels.map((nodes, i) => ({
    level: i,
    packages: nodes.map((n) => n.name),
    parallel: true,
  }));

  if (levels.length > 0) {
    const last = levels[levels.length - 1];
    if (last.packages.length === 1) {
      levels[levels.length - 1] = { ...last, parallel: false };
    }
  }

  return {
    levels,
    criticalPath: findCriticalPath(graph),
    totalPackages: graph.nodes.size,
  };
}

/**
 * Serialize a CI matrix to a GitHub Actions `strategy.matrix` YAML snippet.
 * Intended for a committed `.github/build-matrix.yml`. Deterministic — no volatile
 * tokens, safe to diff in `--check` mode as-is.
 */
export function generateCIMatrixYaml(matrix: CIMatrix): string {
  const levelNumbers = matrix.levels.map((l) => l.level);
  const lines: string[] = [
    "strategy:",
    "  matrix:",
    `    level: [${levelNumbers.join(", ")}]`,
    "    include:",
  ];
  for (const entry of matrix.levels) {
    lines.push(`      - level: ${entry.level}`);
    lines.push(`        packages: "${entry.packages.join(" ")}"`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Serialize a CI matrix to pretty JSON (levels, critical path, total). Intended for
 * a committed `.github/build-matrix.json`. Deterministic — no volatile tokens.
 */
export function generateCIMatrixJson(matrix: CIMatrix): string {
  return JSON.stringify(matrix, null, 2) + "\n";
}
