// @ebowwa/codegen-kit — snapshot compatibility engine.
//
// Serializes domain data to a stable JSON snapshot, diffs against the committed
// baseline, classifies changes by severity via a policy config, and renders
// migration changelogs. The consumer provides the serializer + the rules;
// the kit owns diffing, classification, I/O, and reporting.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ─── Types ─────────────────────────────────────────────────────────────────

export type ChangeSeverity = "error" | "warning" | "info";

export interface SnapshotChange {
  readonly kind: string;
  readonly severity: ChangeSeverity;
  readonly identity: string;
  readonly field?: string;
  readonly message: string;
}

export interface SnapshotResult {
  readonly changes: readonly SnapshotChange[];
  readonly errors: readonly SnapshotChange[];
  readonly warnings: readonly SnapshotChange[];
  readonly infos: readonly SnapshotChange[];
  readonly hasBreaking: boolean;
  readonly oldCount: number;
  readonly newCount: number;
}

export interface DiffRule {
  /** Path pattern to watch: "type", "role", "configSchema.*", "defaultConfig.*", etc. */
  readonly field: string;
  readonly on: "added" | "removed" | "changed";
  readonly severity: ChangeSeverity;
  /** Override the kind label (default: `${field}-${on}`). */
  readonly kind?: string;
}

export interface SnapshotOpts<T> {
  /** Path to the committed snapshot file. */
  readonly snapshotPath: string;
  /** Stable serializer: domain data → array of plain objects sorted by identity. */
  readonly serialize: (items: readonly T[]) => unknown[];
  /** Identity function: extracts the unique key from a serialized item. */
  readonly identity: (item: any) => string;
  /** Diff rules: what to watch and how severe each change is. */
  readonly rules: readonly DiffRule[];
  /** Optional: deep-compare function for "changed" detection on a field (default: JSON.stringify). */
  readonly compare?: (oldVal: any, newVal: any) => boolean;
}

// ─── Internal helpers ─────────────────────────────────────────────────────

function getByPath(obj: any, path: string): any {
  if (path === "*") return obj;
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function flattenKeys(obj: any, prefix = ""): Map<string, any> {
  const map = new Map<string, any>();
  if (obj == null || typeof obj !== "object") return map;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      const k = `${prefix}[${i}]`;
      if (v != null && typeof v === "object") {
        for (const [sk, sv] of flattenKeys(v, k)) map.set(sk, sv);
      } else {
        map.set(k, v);
      }
    });
    return map;
  }
  for (const [key, val] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (val != null && typeof val === "object") {
      for (const [sk, sv] of flattenKeys(val, fullPath)) map.set(sk, sv);
    } else {
      map.set(fullPath, val);
    }
  }
  return map;
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Write a new snapshot baseline from domain data. */
export function writeSnapshot<T>(opts: SnapshotOpts<T>, items: readonly T[]): void {
  const serialized = opts.serialize(items);
  mkdirSync(dirname(opts.snapshotPath), { recursive: true });
  writeFileSync(opts.snapshotPath, JSON.stringify(serialized, null, 2) + "\n", "utf-8");
  console.log(`Snapshot written: ${opts.snapshotPath} (${serialized.length} items)`);
}

/** Read the committed snapshot. Throws if missing. */
export function readSnapshot(opts: { snapshotPath: string }): unknown[] {
  if (!existsSync(opts.snapshotPath)) {
    throw new Error(`No snapshot found at ${opts.snapshotPath}. Run with --snapshot first.`);
  }
  return JSON.parse(readFileSync(opts.snapshotPath, "utf-8"));
}

/** Diff two snapshots using the provided rules. Pure — no I/O. */
export function diffSnapshots<T>(
  opts: SnapshotOpts<T>,
  oldItems: readonly unknown[],
  newItems: readonly unknown[],
): SnapshotResult {
  const changes: SnapshotChange[] = [];
  const identity = opts.identity;
  const compare = opts.compare ?? ((a: any, b: any) => JSON.stringify(a) === JSON.stringify(b));

  const oldMap = new Map<string, any>();
  const newMap = new Map<string, any>();
  for (const item of oldItems) oldMap.set(identity(item), item);
  for (const item of newItems) newMap.set(identity(item), item);

  // Apply rules
  for (const rule of opts.rules) {
    const { field, on, severity } = rule;
    const kind = rule.kind ?? `${field}-${on}`;

    if (on === "removed" && field === "*") {
      // Whole-item removal
      for (const [id] of oldMap) {
        if (!newMap.has(id)) {
          changes.push({ kind: "item-removed", severity, identity: id, message: `Item "${id}" was removed` });
        }
      }
    } else if (on === "added" && field === "*") {
      // Whole-item addition
      for (const [id] of newMap) {
        if (!oldMap.has(id)) {
          changes.push({ kind: "item-added", severity, identity: id, message: `Item "${id}" was added` });
        }
      }
    } else {
      // Field-level rules: check each item that exists in both
      for (const [id, newItem] of newMap) {
        const oldItem = oldMap.get(id);
        if (!oldItem) continue;

        if (field.endsWith(".*")) {
          // Collection field: watch members
          const prefix = field.slice(0, -2);
          const oldKeys = flattenKeys(getByPath(oldItem, prefix));
          const newKeys = flattenKeys(getByPath(newItem, prefix));

          if (on === "removed") {
            for (const [key] of oldKeys) {
              if (!newKeys.has(key)) {
                changes.push({ kind, severity, identity: id, field: `${prefix}.${key}`, message: `${prefix} "${key}" removed from "${id}"` });
              }
            }
          } else if (on === "added") {
            for (const [key] of newKeys) {
              if (!oldKeys.has(key)) {
                changes.push({ kind, severity, identity: id, field: `${prefix}.${key}`, message: `${prefix} "${key}" added to "${id}"` });
              }
            }
          } else if (on === "changed") {
            for (const [key, oldVal] of oldKeys) {
              const newVal = newKeys.get(key);
              if (newVal !== undefined && !compare(oldVal, newVal)) {
                changes.push({ kind, severity, identity: id, field: `${prefix}.${key}`, message: `${prefix} "${key}" in "${id}": ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}` });
              }
            }
          }
        } else {
          // Scalar field
          const oldVal = getByPath(oldItem, field);
          const newVal = getByPath(newItem, field);

          if (on === "removed" && oldVal !== undefined && newVal === undefined) {
            changes.push({ kind, severity, identity: id, field, message: `Field "${field}" removed from "${id}"` });
          } else if (on === "added" && oldVal === undefined && newVal !== undefined) {
            changes.push({ kind, severity, identity: id, field, message: `Field "${field}" added to "${id}"` });
          } else if (on === "changed" && oldVal !== undefined && newVal !== undefined && !compare(oldVal, newVal)) {
            changes.push({ kind, severity, identity: id, field, message: `Field "${field}" in "${id}": ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}` });
          }
        }
      }
    }
  }

  const errors = changes.filter(c => c.severity === "error");
  const warnings = changes.filter(c => c.severity === "warning");
  const infos = changes.filter(c => c.severity === "info");

  return {
    changes,
    errors,
    warnings,
    infos,
    hasBreaking: errors.length > 0,
    oldCount: oldItems.length,
    newCount: newItems.length,
  };
}

/** Render a Markdown migration changelog from a snapshot diff result. */
export function renderMigrationChangelog(result: SnapshotResult, title?: string): string {
  const lines: string[] = [];
  lines.push(`# Migration Changelog${title ? ` — ${title}` : ""}`, "");
  lines.push("Auto-generated by @ebowwa/codegen-kit snapshot engine.", "");

  if (result.errors.length > 0) {
    lines.push(`## ⚠️ Breaking Changes (${result.errors.length})`, "");
    const byId = new Map<string, SnapshotChange[]>();
    for (const e of result.errors) {
      if (!byId.has(e.identity)) byId.set(e.identity, []);
      byId.get(e.identity)!.push(e);
    }
    for (const [identity, items] of byId) {
      lines.push(`### ${identity}`, "");
      for (const e of items) lines.push(`- **[${e.kind}]** ${e.message}`);
      lines.push("");
    }
  }

  if (result.warnings.length > 0) {
    lines.push(`## ⚡ Warnings (${result.warnings.length})`, "");
    for (const w of result.warnings) {
      const loc = w.field ? `${w.identity}/${w.field}` : w.identity;
      lines.push(`- [${loc}] ${w.message}`);
    }
    lines.push("");
  }

  if (result.infos.length > 0) {
    lines.push(`## ℹ️ Non-breaking Changes (${result.infos.length})`, "");
    for (const i of result.infos) {
      const loc = i.field ? `${i.identity}/${i.field}` : i.identity;
      lines.push(`- [${loc}] ${i.message}`);
    }
    lines.push("");
  }

  lines.push("---");
  return lines.join("\n");
}

/** Write a migration changelog to a .fixes/ directory. */
export function writeMigrationChangelog(
  result: SnapshotResult,
  opts: { fixesDir: string; filename?: string; title?: string },
): string {
  const filename = opts.filename ?? "migration-changelog.md";
  const path = resolve(opts.fixesDir, filename);
  mkdirSync(opts.fixesDir, { recursive: true });
  const content = renderMigrationChangelog(result, opts.title);
  writeFileSync(path, content, "utf-8");
  console.log(`Migration changelog written: ${path}`);
  return path;
}
