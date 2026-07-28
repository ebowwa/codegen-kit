// src/commands/extract-hsc.ts — write/--check generated/extracted-hsc.json
// from the live HelloSwiftConsumables repo (Package.swift + Sources/).
//
// Repo path: HSC_REPO env var (absolute, or relative to this package root).
// Default: ../HelloSwiftPackages (the sibling clone).
//
//   bun run extract:hsc           # regenerate from the live repo
//   bun run extract:hsc --check   # CI: fail (or skip if repo absent) if stale

import { existsSync, statSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { writeOrCheck, stripVolatile, autogenMeta } from "../../src/index.js";

import { extractHsc } from "./hsc.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "../..");
const OUT_PATH = resolve(PKG_ROOT, "generated/extracted-hsc.json");

function repoPath(): string {
  const env = process.env.HSC_REPO;
  if (!env) return resolve(PKG_ROOT, "../HelloSwiftPackages");
  return isAbsolute(env) ? env : resolve(PKG_ROOT, env);
}

function build(): string {
  const extracted = extractHsc(repoPath());
  const doc = {
    _autogen: autogenMeta("bun run extract:hsc", "HelloSwiftPackages/Package.swift"),
    ...extracted,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

const checkOnly = process.argv.slice(2).includes("--check");

if (checkOnly) {
  const repo = repoPath();
  if (!existsSync(repo) || !statSync(repo).isDirectory()) {
    // No live repo (e.g. CI without a checkout) — skip; a dedicated CI step
    // clones the repo and runs this for real.
    console.log(`SKIP: extraction live-check — repo not present at ${repo}.`);
    process.exit(0);
  }
}

writeOrCheck(OUT_PATH, build(), { check: checkOnly, strip: stripVolatile });
