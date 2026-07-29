// @ebowwa/codegen-kit — write-vs-check primitives.
// writeOrCheck: single file. writeOrCheckMany: multi-file with diff display
// (subsumes richer codegen loops like secondsee/node-codegen's).

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write `content` to `path`, or — in check mode — fail (exit 1) if the committed
 * file is missing or out of sync. `strip` removes volatile tokens (timestamps,
 * build shas) before comparing; defaults to identity.
 */
export function writeOrCheck(
  path: string,
  content: string,
  opts: { check?: boolean; strip?: (s: string) => string } = {},
): void {
  const check = opts.check ?? false;
  const strip = opts.strip ?? ((s: string) => s);

  if (check) {
    if (!existsSync(path)) {
      console.error(`FAIL: ${path} does not exist. Run \`bun run generate\` first.`);
      process.exit(1);
    }
    if (strip(readFileSync(path, "utf-8")) !== strip(content)) {
      console.error(`FAIL: ${path} is out of sync with its source.\n\nRun: bun run generate`);
      process.exit(1);
    }
    console.log(`OK: ${path} up to date.`);
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
  console.log(`Generated → ${path}`);
}

/** Pure: the first `max` line indexes where a and b differ (1-based line numbers). */
export function diffLines(
  a: string,
  b: string,
  max = 10,
): Array<{ line: number; a?: string; b?: string }> {
  const la = a.split("\n");
  const lb = b.split("\n");
  const out: Array<{ line: number; a?: string; b?: string }> = [];
  for (let i = 0; i < Math.max(la.length, lb.length) && out.length < max; i++) {
    if (la[i] !== lb[i]) out.push({ line: i + 1, a: la[i], b: lb[i] });
  }
  return out;
}

export interface WriteEntry {
  readonly path: string;
  readonly content: string;
  /** Per-entry strip override (else the options-level `strip` is used). */
  readonly strip?: (s: string) => string;
}

/**
 * Multi-file write or check — for generators that emit several files per command.
 *
 * In check mode: checks ALL entries (does not stop at the first failure), prints a
 * per-file OK / FAIL+diff, and exits 1 if any drifted. In write mode: writes all.
 * Mirrors secondsee/node-codegen's generate-*.ts loops.
 */
export function writeOrCheckMany(
  entries: readonly WriteEntry[],
  opts: { check?: boolean; strip?: (s: string) => string; diffLines?: number } = {},
): void {
  const check = opts.check ?? false;
  const defaultStrip = opts.strip ?? ((s: string) => s);
  const maxDiff = opts.diffLines ?? 10;

  if (!check) {
    for (const e of entries) {
      mkdirSync(dirname(e.path), { recursive: true });
      writeFileSync(e.path, e.content, "utf-8");
      console.log(`Generated → ${e.path}`);
    }
    return;
  }

  let failed = false;
  for (const e of entries) {
    const strip = e.strip ?? defaultStrip;
    if (!existsSync(e.path)) {
      console.error(`FAIL: ${e.path} does not exist. Run \`bun run generate\` first.`);
      failed = true;
      continue;
    }
    const existing = readFileSync(e.path, "utf-8");
    if (strip(existing) !== strip(e.content)) {
      console.error(`FAIL: ${e.path} is out of sync with its source.`);
      for (const d of diffLines(existing, e.content, maxDiff)) {
        console.error(`  L${d.line}:\n    - ${d.a ?? ""}\n    + ${d.b ?? ""}`);
      }
      failed = true;
    } else {
      console.log(`OK: ${e.path} up to date.`);
    }
  }
  if (failed) process.exit(1);
}

// ─── Patch (in-place file mutation with structural change reporting) ────────

export interface PatchChange {
  readonly action: "added" | "removed" | "modified";
  readonly detail: string;
}

export interface PatchResult {
  readonly changes: readonly PatchChange[];
  readonly content: string;
  readonly hasChanges: boolean;
}

/**
 * Read a file, apply a transform that returns modified content + a list of
 * structural changes, then either write or report.
 *
 * Unlike `writeOrCheck` (full-content comparison), patch reports WHAT changed
 * structurally — for tools like xcodeproj that splice entries into an existing
 * file and report "added 3 file references" rather than diffing the whole file.
 */
export function patchOrCheck(
  path: string,
  transform: (existing: string) => PatchResult,
  opts: { check?: boolean; skipIfMissing?: boolean } = {},
): void {
  const check = opts.check ?? false;

  if (!existsSync(path)) {
    if (opts.skipIfMissing) {
      console.log(`SKIP: ${path} not found.`);
      return;
    }
    console.error(`FAIL: ${path} does not exist.`);
    process.exit(1);
  }

  const existing = readFileSync(path, "utf-8");
  const result = transform(existing);

  if (result.hasChanges) {
    if (check) {
      console.log(`${path}: ${result.changes.length} change(s) needed:`);
      for (const c of result.changes) {
        console.log(`  ${c.action}: ${c.detail}`);
      }
      process.exit(1);
    } else {
      writeFileSync(path, result.content, "utf-8");
      console.log(`${path}: applied ${result.changes.length} change(s):`);
      for (const c of result.changes) {
        console.log(`  ${c.action}: ${c.detail}`);
      }
    }
  } else {
    console.log(`OK: ${path} up to date.`);
  }
}

// ─── Scaffold (collision-safe file creation with dry-run) ──────────────────

export interface ScaffoldEntry {
  readonly path: string;
  readonly content: string;
  readonly description: string;
  /** Allow overwriting if the file already exists (default: false). */
  readonly overwrite?: boolean;
}

export interface ScaffoldResult {
  readonly created: string[];
  readonly skipped: string[];
  readonly overwritten: string[];
}

/**
 * Create multiple new files safely. Refuses to overwrite existing files
 * unless `overwrite: true` on the entry. Supports `--dry-run` (print plan
 * without writing) and automatic rollback (if a later file fails, deletes
 * files written earlier in the same call).
 */
export function scaffoldFiles(
  entries: readonly ScaffoldEntry[],
  opts: { dryRun?: boolean } = {},
): ScaffoldResult {
  const created: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];

  console.log(`\n${opts.dryRun ? "[DRY RUN] " : ""}Scaffolding ${entries.length} file(s):\n`);

  for (const entry of entries) {
    const exists = existsSync(entry.path);

    if (exists && !entry.overwrite) {
      console.log(`  SKIP: ${entry.description} — ${entry.path} already exists`);
      skipped.push(entry.path);
      continue;
    }

    if (opts.dryRun) {
      console.log(`  ${exists ? "OVERWRITE" : "CREATE"}: ${entry.description} → ${entry.path}`);
      if (exists) overwritten.push(entry.path);
      else created.push(entry.path);
      continue;
    }

    try {
      mkdirSync(dirname(entry.path), { recursive: true });
      writeFileSync(entry.path, entry.content, "utf-8");
      console.log(`  ${exists ? "OVERWRITTEN" : "CREATED"}: ${entry.description} → ${entry.path}`);
      if (exists) overwritten.push(entry.path);
      else created.push(entry.path);
    } catch (err: any) {
      // Rollback: delete files created earlier in this call
      console.error(`\n  ERROR writing ${entry.path}: ${err?.message ?? err}`);
      console.error(`  Rolling back ${created.length} previously created file(s)...`);
      for (const path of created) {
        try { unlinkSync(path); } catch {}
      }
      throw err;
    }
  }

  if (opts.dryRun) {
    console.log(`\n[DRY RUN] ${created.length} would be created, ${overwritten.length} overwritten, ${skipped.length} skipped.`);
  } else {
    console.log(`\n${created.length} created, ${overwritten.length} overwritten, ${skipped.length} skipped.`);
  }

  return { created, skipped, overwritten };
}
