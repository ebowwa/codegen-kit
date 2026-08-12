// @ebowwa/codegen-kit — module-level import graph.
//
// The structural backbone of every shape probe. Where ./package-graph.js builds a DAG
// of *packages* from package.json files, this builds a graph of *modules* from source
// files and their import specifiers. Probes (no-cycles, layer-rules, symbol-isolation)
// operate on this graph; lexical probes (gate-coverage, fingerprint) re-read source by
// path via `repoRoot`.
//
// Zero runtime dependencies: the v1 builder is a regex scanner over
// `import … from "x"`, `import "x"`, `require("x")`, `import("x")`, and
// `export … from "x"` — the same technique site-surveys' hand-written boundary test
// uses. A heavier builder (ts-morph) can slot in behind the {@link GraphBuilder}
// interface without touching probes or contracts.

import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, relative, dirname, posix } from "node:path";
import { SKIP_DIRS } from "../version-discovery.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** A scanned source module. Paths are repo-relative, posix-style. */
export interface ModuleNode {
  /** Repo-relative posix path, e.g. `src/runtimes/any/2o/safety/send-gate.ts`. */
  readonly path: string;
  /** Every import specifier seen in the file (raw, deduped, sorted) — for pattern probes. */
  readonly imports: readonly string[];
  /** Subset of `imports` that resolved to another scanned module (repo-relative posix). */
  readonly resolvedImports: readonly string[];
}

/** A resolved import edge: `from` imports `to`. */
export interface ModuleEdge {
  readonly from: string;
  readonly to: string;
}

/** The resolved module import graph. */
export interface ModuleGraph {
  /** Repo-relative posix path → node. */
  readonly nodes: Map<string, ModuleNode>;
  /** Resolved edges (importer → imported), deduped, sorted. */
  readonly edges: readonly ModuleEdge[];
  /** Importer → set of imported module paths. */
  readonly adj: Map<string, Set<string>>;
  /** Imported → set of importer module paths (reverse adjacency). */
  readonly radj: Map<string, Set<string>>;
  readonly repoRoot: string;
}

export interface GraphBuilderOpts {
  /** Absolute repo root. */
  readonly repoRoot: string;
  /** Source extensions to scan (default: ts/tsx/js/jsx/mjs). */
  readonly extensions?: readonly string[];
  /** Import-path aliases to resolve before relative resolution, e.g. `{ "@/": "src/" }`.
   *  An alias maps a specifier prefix to a repo-relative posix prefix. */
  readonly alias?: Readonly<Record<string, string>>;
  /** Dirs to skip during the filesystem-walk fallback (git ls-files is primary).
   *  Defaults to {@link SKIP_DIRS}. */
  readonly skipDirs?: ReadonlySet<string>;
  /** Extra repo-relative posix path globs to exclude (matched against repo-relative path
   *  via the kit's `*`-spans-`/` glob). Useful to skip generated output, fixtures, etc. */
  readonly exclude?: readonly string[];
}

/**
 * Strategy interface for building a {@link ModuleGraph}. The default
 * {@link regexGraphBuilder} is stdlib-only; a consumer may supply a ts-morph-backed
 * builder for precise (alias-aware, type-only) resolution without changing probes.
 */
export interface GraphBuilder {
  build(opts: GraphBuilderOpts): ModuleGraph;
}

// ── Source discovery ────────────────────────────────────────────────────────

const DEFAULT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"] as const;

/**
 * Find all source files under `root` matching `extensions`. Uses `git ls-files` for
 * determinism (CI parity — honours .gitignore), with a sorted filesystem walk as
 * fallback when git is unavailable. Mirrors {@link findAllPackageJsons}.
 */
export function findAllSourceFiles(
  root: string,
  extensions: readonly string[] = DEFAULT_EXTENSIONS,
  skipDirs: ReadonlySet<string> = SKIP_DIRS,
): string[] {
  const patterns = extensions.map((ext) => `'*${ext}'`).join(" ");
  try {
    const out = execSync(`git ls-files -z ${patterns}`, {
      cwd: root,
      encoding: "utf-8",
      maxBuffer: 50 * 1024 * 1024,
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
        if (skipDirs.has(entry.name)) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (extensions.some((ext) => entry.name.endsWith(ext))) results.push(full);
      }
    }
    walk(root);
    return results.sort();
  }
}

// ── Specifier extraction + resolution ───────────────────────────────────────

/** Quoted specifier captured after any of the module-binding keywords. */
const SPECIFIER_PATTERNS: readonly RegExp[] = [
  /from\s+['"]([^'"]+)['"]/g, // import … from "x" ; export … from "x"
  /import\s+['"]([^'"]+)['"]/g, // side-effect import "x"
  /require\s*\(\s*['"]([^'"]+)['"]/g, // require("x")
  /import\s*\(\s*['"]([^'"]+)['"]/g, // dynamic import("x")
];

/** Extract deduped, sorted import specifiers from source text. Approximate by design. */
export function extractSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const re of SPECIFIER_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      const spec = m[1];
      if (spec) found.add(spec);
    }
  }
  return [...found].sort();
}

/** Convert an absolute path to a repo-relative posix path. */
function toRelPosix(repoRoot: string, absPath: string): string {
  return relative(repoRoot, absPath).split(/[/\\]/).join("/");
}

const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".json"];

/**
 * Resolve an import specifier (as seen from `importerRelDir`, a repo-relative posix
 * dir) against the set of scanned files. Returns the repo-relative posix path of the
 * target if it is a scanned module, else `undefined` (external/bare/unresolved).
 *
 * Applies `alias` rewrites first, then relative resolution with common extension and
 * `/index` fallbacks — enough for typical ESM/TS layouts without a compiler host.
 */
export function resolveSpecifier(
  spec: string,
  importerRelDir: string,
  scanned: ReadonlySet<string>,
  alias?: Readonly<Record<string, string>>,
): string | undefined {
  let rewritten = spec;
  let aliased = false;
  if (alias) {
    for (const [prefix, target] of Object.entries(alias)) {
      if (spec.startsWith(prefix)) {
        rewritten = target + spec.slice(prefix.length);
        aliased = true;
        break;
      }
    }
  }
  const isRelative = rewritten.startsWith("./") || rewritten.startsWith("../");
  if (!isRelative && !aliased) {
    return undefined; // bare specifier (external) — not a module edge
  }
  // Relative specifiers resolve against the importing file's dir; aliased specifiers
  // are already repo-relative posix paths.
  const base = isRelative ? posix.normalize(posix.join(importerRelDir, rewritten)) : posix.normalize(rewritten);
  const candidates: string[] = [base];
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(base + ext);
  for (const ext of RESOLVE_EXTENSIONS) candidates.push(posix.join(base, "index" + ext));
  // TS-ESM idiom: a `.js`/`.jsx`/`.mjs` specifier resolves to its `.ts`/`.tsx` counterpart.
  const jsExt = [".js", ".jsx", ".mjs", ".cjs"].find((e) => base.endsWith(e));
  if (jsExt) {
    const stem = base.slice(0, -jsExt.length);
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(stem + ext);
  }
  for (const c of candidates) if (scanned.has(c)) return c;
  return undefined;
}

// ── Graph construction ──────────────────────────────────────────────────────

/**
 * Stdlib-only module graph builder. Reads source files discovered by
 * {@link findAllSourceFiles}, extracts specifiers, resolves relative/aliased ones to
 * scanned modules, and returns the {@link ModuleGraph}. Excluded globs (opts.exclude)
 * are matched against repo-relative posix paths with the kit's `*`-spans-`/` glob.
 */
export const regexGraphBuilder: GraphBuilder = {
  build(opts: GraphBuilderOpts): ModuleGraph {
    const extensions = opts.extensions ?? DEFAULT_EXTENSIONS;
    const skip = opts.skipDirs ?? SKIP_DIRS;
    const excludeGlobs = opts.exclude ?? [];
    const excludeRes = excludeGlobs.map((g) => globToRegexLocal(g));

    const files = findAllSourceFiles(opts.repoRoot, extensions, skip);
    const relFiles = files.map((f) => toRelPosix(opts.repoRoot, f));
    const scanned = new Set<string>(
      relFiles.filter((p) => !excludeRes.some((re) => re.test(p))),
    );

    const nodes = new Map<string, ModuleNode>();
    const adj = new Map<string, Set<string>>();
    const radj = new Map<string, Set<string>>();
    const edgeSet = new Set<string>();
    const edges: ModuleEdge[] = [];

    for (const abs of files) {
      const rel = toRelPosix(opts.repoRoot, abs);
      if (!scanned.has(rel)) continue;
      let source: string;
      try {
        source = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      const specs = extractSpecifiers(source);
      const importerDir = posix.dirname(rel);
      const resolved: string[] = [];
      for (const spec of specs) {
        const target = resolveSpecifier(spec, importerDir, scanned, opts.alias);
        if (target !== undefined) resolved.push(target);
      }
      const resolvedDedup = [...new Set(resolved)].sort();
      nodes.set(rel, { path: rel, imports: specs, resolvedImports: resolvedDedup });

      adj.set(rel, new Set(resolvedDedup));
      for (const target of resolvedDedup) {
        if (!radj.has(target)) radj.set(target, new Set());
        radj.get(target)!.add(rel);
        const key = `${rel}\0${target}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ from: rel, to: target });
        }
      }
    }

    edges.sort((a, b) =>
      a.from === b.from ? a.to.localeCompare(b.to) : a.from.localeCompare(b.from),
    );
    return { nodes, edges, adj, radj, repoRoot: opts.repoRoot };
  },
};

// ── Graph analysis (used by probes) ─────────────────────────────────────────

/**
 * Tarjan's algorithm: returns each strongly connected component of size ≥ 2 (plus
 * self-loop singletons) as a sorted list of node paths. Each returned SCC is a cycle.
 * Reusable by the `no-cycles` probe and by drift classification.
 */
export function findCycles(graph: ModuleGraph): string[][] {
  const adj = (path: string): Set<string> => graph.adj.get(path) ?? new Set();
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of adj(v)) {
      if (!indices.has(w)) {
        strongconnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) sccs.push(comp.sort());
      else {
        // single-node SCC: a cycle only if it self-imports
        const only = comp[0]!;
        if (adj(only).has(only)) sccs.push([only]);
      }
    }
  }

  for (const v of graph.nodes.keys()) {
    if (!indices.has(v)) strongconnect(v);
  }
  return sccs.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

// Local copy of the kit's glob→regex so this module stays self-contained for graph
// consumers who don't import from package-graph. Identical semantics: `*` spans `/`.
function globToRegexLocal(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}
