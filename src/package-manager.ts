// @ebowwa/codegen-kit — package.json registry framework.
//
// A "package definition" is a single package.json's full declaration (name,
// version, deps, scripts, exports, …). A consumer declares its whole monorepo
// as a registry of { relative path → package definition } plus a version map
// for its internal `@scope/*` packages, and the kit writes (or --check diffs)
// every package.json from that single source of truth.
//
// Extracted from secondsee/node-codegen's generate-package-json.ts (740 lines
// of registry data + ~12 lines of mechanism). The domain-specific data — which
// packages exist, their deps, the internal version map, the shared external
// versions, the layer classification — stays with each consumer; this module
// provides the framework.

import { resolve, dirname } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { writeOrCheckMany, type WriteEntry } from "./write-check.js";

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * The full declaration of one package.json.
 *
 * Common npm fields are spelled out for IDE completion and documentation;
 * arbitrary extra fields (`bin`, `engines`, `files`, `systemRequirements`, …)
 * pass through via the index signature. Anything you can put in a package.json,
 * you can put here.
 *
 * `name` is the only required field — every package.json in secondsee's
 * registry has one, and the npm spec requires it for publication. Anonymous
 * private roots are rare enough that we keep this invariant strict; cast to
 * `Omit<PackageDefinition, "name">` if a consumer genuinely needs to omit it.
 */
export interface PackageDefinition {
  /** Package name (npm spec requires this for publication). */
  name: string;
  /** Semver version. Optional for `private: true` roots/workspaces. */
  version?: string;
  /** Hide from npm publish. Typical for roots and unreleased workspaces. */
  private?: boolean;
  /** Module system. `"module"` = ESM, `"commonjs"` = CJS. */
  type?: "module" | "commonjs";
  description?: string;
  license?: string;
  /** Entry point, e.g. `"./dist/index.js"`. */
  main?: string;
  /** Types entry, e.g. `"./dist/index.d.ts"`. */
  types?: string;
  bin?: Record<string, string> | string;
  files?: string[];
  /** Modern conditional-exports map. */
  exports?: Record<string, unknown>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  keywords?: string[];
  /** Anything else passes through verbatim to the serialized JSON. */
  [key: string]: unknown;
}

/**
 * Options for `generateAllPackageJsons` / `checkAllPackageJsons`.
 *
 * The shape deliberately mirrors how secondsee declares its registry: a map
 * from repo-relative path → package declaration, plus the repo root to resolve
 * against. Internal-version resolution is the caller's job — use
 * `createInternalResolver` at registry-construction time so the registry
 * itself reads as plain data with `internal("@scope/x")` calls inline.
 */
export interface PackageManagerOpts {
  /**
   * The registry: repo-relative package.json path → its declaration.
   * Keys are POSIX-style relative paths (e.g. `"packages/tsx/foo/package.json"`
   * or `"package.json"` for the root). Forward slashes work cross-platform
   * because `path.resolve` normalizes them.
   */
  packages: Readonly<Record<string, PackageDefinition>>;
  /**
   * Absolute path to the monorepo root. Each registry key is resolved against
   * this, so `resolve(repoRoot, key)` is the file written (or checked).
   */
  repoRoot: string;
  /**
   * Optional logger for the one-line progress banner. Defaults to `console.log`.
   * Per-file OK / Generated / FAIL+diff lines flow through `writeOrCheckMany`
   * regardless and are not routed through this hook.
   */
  log?: (msg: string) => void;
}

// ─── Internal-version resolver ─────────────────────────────────────────────

/**
 * Build an `internal(name)` resolver bound to `versionMap`. Looks up `name`
 * and throws if it isn't registered — so a typo in an `@scope/foo` reference
 * fails fast at registry-construction time (module load), not later at codegen.
 *
 * Use this to populate `dependencies` / `peerDependencies` from a single
 * source-of-truth version map. Bumping an internal package then means editing
 * one entry in the map, not grepping every package.json.
 *
 * Returned function is referentially stable per call to `createInternalResolver`.
 */
export function createInternalResolver(
  versionMap: Readonly<Record<string, string>>,
): (name: string) => string {
  return (name: string) => {
    const v = versionMap[name];
    if (v === undefined) throw new Error(`Unknown internal dep: ${name}`);
    return v;
  };
}

// ─── Core: build / write / check ───────────────────────────────────────────

/**
 * Serialize a package declaration with the canonical format: 2-space indent
 * plus trailing newline. Byte-compatible with `npm pack` output and with
 * secondsee/node-codegen's existing files, so reformatting never shows up as
 * drift in --check.
 */
function serializePackage(pkg: PackageDefinition): string {
  return JSON.stringify(pkg, null, 2) + "\n";
}

/** Build WriteEntry[] from the registry. Pure: performs no I/O. */
function buildEntries(opts: PackageManagerOpts): WriteEntry[] {
  return Object.entries(opts.packages).map(([relPath, spec]) => ({
    path: resolve(opts.repoRoot, relPath),
    content: serializePackage(spec),
  }));
}

/**
 * Write every package.json in the registry to disk, creating parent
 * directories as needed. Each file is logged as `Generated → <path>` by
 * `writeOrCheckMany`.
 *
 * Safe to re-run — overwrites committed files with the latest registry content.
 */
export function generateAllPackageJsons(opts: PackageManagerOpts): void {
  const log = opts.log ?? ((m: string) => console.log(m));
  const entries = buildEntries(opts);
  log(`\n━━━ package.json generation ━━━\nRegistry: ${entries.length} packages\n`);
  writeOrCheckMany(entries, { check: false });
}

/**
 * Check every package.json in the registry against its committed counterpart.
 * Does NOT write. Prints a per-file `OK` or `FAIL` (+ the first few diff lines)
 * line. Exits 1 if any file is missing or out of sync — wire this into CI as
 * the drift gate so a stale package.json fails the build.
 *
 * package.json has no volatile provenance tokens (no timestamps, no build shas),
 * so comparison is raw — `stripVolatile` is intentionally NOT applied. If a
 * consumer ever embeds volatile tokens in a package.json, pass a custom
 * `strip` through `writeOrCheckMany` directly instead.
 */
export function checkAllPackageJsons(opts: PackageManagerOpts): void {
  const log = opts.log ?? ((m: string) => console.log(m));
  const entries = buildEntries(opts);
  log(`\n━━━ package.json check ━━━\nRegistry: ${entries.length} packages\n`);
  writeOrCheckMany(entries, { check: true });
}

// ─── CLI convenience ───────────────────────────────────────────────────────

/**
 * One-line CLI entry: auto-detects `--check` from `process.argv` and
 * dispatches to `generateAllPackageJsons` (default) or `checkAllPackageJsons`.
 * Use this as the entire body of a consumer's `generate-package-json.ts`
 * script after declaring the registry — mirrors how secondsee's original file
 * was structured (data up top, single dispatch at the bottom).
 *
 * The `typeof process !== "undefined"` guard keeps the function safe to import
 * from non-CLI contexts (tests, programmatic use).
 */
export function runPackageManagerCli(opts: PackageManagerOpts): void {
  const isCheck = typeof process !== "undefined" && process.argv.includes("--check");
  if (isCheck) checkAllPackageJsons(opts);
  else generateAllPackageJsons(opts);
}

// ─── Dep drift sync (lockfile management) ──────────────────────────────────

export interface DepDriftResult {
  readonly drift: Array<{ dep: string; versions: Map<string, string[]> }>;
  readonly hasDrift: boolean;
}

/** Check if pinned external deps have different versions across packages. */
export function checkDepDrift(opts: {
  repoRoot: string;
  packagePaths: readonly string[];
  pinnedDeps: readonly string[];
}): DepDriftResult {
  const drift: Array<{ dep: string; versions: Map<string, string[]> }> = [];
  const versionMap = new Map<string, Map<string, string[]>>();

  for (const relPath of opts.packagePaths) {
    const abs = resolve(opts.repoRoot, relPath);
    if (!existsSync(abs)) continue;
    const pkg = JSON.parse(readFileSync(abs, "utf-8"));
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const depName of opts.pinnedDeps) {
      if (!(depName in deps)) continue;
      if (!versionMap.has(depName)) versionMap.set(depName, new Map());
      const vMap = versionMap.get(depName)!;
      const ver = deps[depName];
      if (!vMap.has(ver)) vMap.set(ver, []);
      vMap.get(ver)!.push(relPath);
    }
  }

  for (const [depName, vMap] of versionMap) {
    if (vMap.size > 1) drift.push({ dep: depName, versions: vMap });
  }

  return { drift, hasDrift: drift.length > 0 };
}

/** Fix dep drift by pinning all packages to the newest version. Returns fix count. */
export function fixDepDrift(opts: {
  repoRoot: string;
  packagePaths: readonly string[];
  pinnedDeps: readonly string[];
}): number {
  const { drift } = checkDepDrift(opts);
  let fixes = 0;

  for (const { dep, versions } of drift) {
    const newest = [...versions.keys()].sort()[versions.size - 1];
    for (const relPath of opts.packagePaths) {
      const abs = resolve(opts.repoRoot, relPath);
      if (!existsSync(abs)) continue;
      const pkg = JSON.parse(readFileSync(abs, "utf-8"));
      let modified = false;
      for (const field of ["dependencies", "devDependencies"] as const) {
        const deps = pkg[field];
        if (!deps || !(dep in deps)) continue;
        if (deps[dep] !== newest) { deps[dep] = newest; modified = true; fixes++; }
      }
      if (modified) writeFileSync(abs, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
    }
  }
  return fixes;
}

/** Run `bun install` across all packages to regenerate lockfiles. */
export function regenerateLockfiles(opts: {
  repoRoot: string;
  packagePaths: readonly string[];
}): Array<{ path: string; success: boolean; error?: string }> {
  const results: Array<{ path: string; success: boolean; error?: string }> = [];
  for (const relPath of opts.packagePaths) {
    const abs = resolve(opts.repoRoot, relPath);
    if (!existsSync(abs)) continue;
    const pkgDir = dirname(abs);
    try {
      execSync("bun install --silent", { cwd: pkgDir, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
      results.push({ path: relPath, success: true });
    } catch (e: any) {
      results.push({ path: relPath, success: false, error: e?.message?.split("\n")[0] ?? String(e) });
    }
  }
  return results;
}

/** CLI entrypoint for dep drift sync — mirrors secondsee's sync-packages.ts. */
export function runDepSyncCli(opts: {
  repoRoot: string;
  packagePaths: readonly string[];
  pinnedDeps: readonly string[];
}): void {
  const isCheck = typeof process !== "undefined" && process.argv.includes("--check");

  console.log("\n━━━ External dep drift check ━━━");
  if (isCheck) {
    const { drift } = checkDepDrift(opts);
    for (const { dep, versions } of drift) {
      console.log(`  DRIFT: ${dep}`);
      for (const [ver, files] of versions) console.log(`    ${ver} → ${files.join(", ")}`);
    }
    if (drift.length === 0) console.log("  OK: all pinned deps in sync.");
    if (drift.length > 0) { console.log(`\nFAIL: ${drift.length} drift issue(s).`); process.exit(1); }
  } else {
    const fixes = fixDepDrift(opts);
    console.log(`\n${fixes > 0 ? `Fixed ${fixes} issue(s).` : "No changes needed."}`);
    console.log("\n━━━ Regenerating lockfiles ━━━");
    const results = regenerateLockfiles(opts);
    for (const r of results) console.log(`  ${r.success ? "OK" : "WARN"}: ${r.path}${r.error ? ` — ${r.error}` : ""}`);
  }
}
