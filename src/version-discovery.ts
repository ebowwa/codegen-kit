// @ebowwa/codegen-kit — version discovery for scoped monorepo packages.
// Walks a repo, finds every package.json whose name matches a scope, and
// builds a `name -> version` map. Also scans node_modules for published-but-
// not-co-located packages and supports manual external entries. Extracted
// from secondsee/node-codegen's internal-versions.ts.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * Default set of directory names to skip when walking a repo for package.json
 * files. These never hold authoritative package versions: dependency trees
 * (scanned separately), build output, VCS state, caches, packaging output.
 */
export const SKIP_DIRS: Set<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  ".build",
  ".snapshots",
  "pkg",
  ".next",
  ".vinext",
  ".cache",
]);

/**
 * Options for {@link discoverInternalVersions}.
 */
export interface VersionDiscoveryOpts {
  /** Absolute path to the repo root to walk. */
  readonly repoRoot: string;
  /**
   * NPM scope prefix to match, including the leading `@`. Example: `"@ebowwa"`.
   * Package names are matched as `${scope}/...`.
   */
  readonly scope: string;
  /**
   * Directory names to skip during the filesystem walk. Defaults to
   * {@link SKIP_DIRS}. `node_modules` itself is skipped by the walk (it is in
   * the default set) but `node_modules/${scope}` is opened explicitly to find
   * published packages that are not co-located in the monorepo.
   */
  readonly skipDirs?: Set<string>;
  /**
   * Manual entries for packages that are neither co-located in the monorepo
   * nor published on npm — e.g. `{ "@ebowwa/runpod": "external" }`. These are
   * applied last and override any discovered entry of the same name.
   */
  readonly externalEntries?: Record<string, string>;
  /**
   * String prepended to each discovered version. Defaults to `"^"` so the
   * returned map can be dropped straight into a `dependencies` block as
   * semver ranges. Pass `""` for raw versions. External entries are passed
   * through untouched.
   */
  readonly versionPrefix?: string;
}

/**
 * Discover all in-scope package versions in a monorepo.
 *
 * Pipeline:
 *  1. Walk `repoRoot`, collecting every `package.json` whose `name` starts
 *     with `${scope}/`.
 *  2. Scan `repoRoot/node_modules/${scope}/*` for published packages not
 *     co-located in the monorepo.
 *  3. Scan nested `node_modules/${scope}/*` up to two levels deep
 *     (e.g. `cloud/server/node_modules/${scope}/*`,
 *     `packages/tsx/x/node_modules/${scope}/*`).
 *  4. Overlay any {@link VersionDiscoveryOpts.externalEntries}.
 *
 * Use this to build a single source of truth for internal package versions
 * straight from committed `package.json` files, so that validators and
 * generators never drift from a hand-maintained mirror.
 *
 * @example
 * ```ts
 * const versions = discoverInternalVersions({
 *   repoRoot: process.cwd(),
 *   scope: "@ebowwa",
 *   externalEntries: { "@ebowwa/runpod": "external" },
 * });
 * // => { "@ebowwa/node-codegen": "^0.4.1", "@ebowwa/runpod": "external", ... }
 * ```
 *
 * @returns a `name -> version` map (name includes the scope, discovered
 *   versions include the {@link VersionDiscoveryOpts.versionPrefix}).
 */
export function discoverInternalVersions(
  opts: VersionDiscoveryOpts,
): Record<string, string> {
  const { repoRoot, scope, externalEntries } = opts;
  const versionPrefix = opts.versionPrefix ?? "^";
  const skip = opts.skipDirs ?? SKIP_DIRS;
  const scopePrefix = `${scope}/`;

  const versions: Record<string, string> = {};
  /** Names already supplied by a co-located or scanned package.json. */
  const found = new Set<string>();

  walk(repoRoot);
  scanNodeModulesAt(resolve(repoRoot, "node_modules", scope));
  scanNestedNodeModules(repoRoot, skip);

  if (externalEntries) {
    for (const [name, version] of Object.entries(externalEntries)) {
      versions[name] = version;
    }
  }

  return versions;

  // --- helpers (close over the locals above) ---

  /** Recursive directory walk. Collects scoped package.json files. */
  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === "package.json") {
        readScopedPackage(full);
      }
    }
  }

  /** Reads a package.json and records it if its name is `${scope}/...`. */
  function readScopedPackage(pkgPath: string): void {
    let pkg: any;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    } catch {
      return; // skip malformed / unreadable
    }
    if (
      typeof pkg?.name === "string" &&
      pkg.name.startsWith(scopePrefix) &&
      typeof pkg.version === "string"
    ) {
      versions[pkg.name] = `${versionPrefix}${pkg.version}`;
      found.add(pkg.name);
    }
  }

  /**
   * Scans a `${scope}` directory inside a node_modules folder (the directory
   * that directly holds the scoped packages). Records any package not already
   * found co-located in the monorepo.
   */
  function scanNodeModulesAt(scopeNodeModulesPath: string): void {
    if (!existsSync(scopeNodeModulesPath)) return;
    let entries;
    try {
      entries = readdirSync(scopeNodeModulesPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullName = `${scope}/${entry.name}`;
      if (found.has(fullName)) continue;
      const pkgPath = join(scopeNodeModulesPath, entry.name, "package.json");
      let pkg: any;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      } catch {
        continue;
      }
      if (typeof pkg.version === "string") {
        versions[fullName] = `${versionPrefix}${pkg.version}`;
      }
    }
  }

  /**
   * Scans `node_modules/${scope}` in immediate subdirectories of `dir` and one
   * level deeper. Mirrors the original layout: `cloud/server/node_modules/...`
   * and `packages/tsx/<pkg>/node_modules/...`.
   */
  function scanNestedNodeModules(dir: string, dirs: Set<string>): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || dirs.has(entry.name)) continue;
      const child = resolve(dir, entry.name);
      scanNodeModulesAt(resolve(child, "node_modules", scope));

      // One more level deep (e.g. cloud/server, packages/tsx/<pkg>).
      let subEntries;
      try {
        subEntries = readdirSync(child, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory() || dirs.has(subEntry.name)) continue;
        scanNodeModulesAt(resolve(child, subEntry.name, "node_modules", scope));
      }
    }
  }
}
