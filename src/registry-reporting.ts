// @ebowwa/codegen-kit — registry reporting and documentation generators.
//
// Renders a human-readable Markdown inventory from a systems registry:
// summary table, per-status sections, per-contract detail with collapsible
// generators/targets/validators tables. Generic over the system data —
// the consumer provides branding text, everything else is derived.

import type { SystemContract, SystemStatus } from "./systems.js";
import { commentHeader } from "./generation-meta.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SystemsReferenceOpts {
  /** Title for the document (default: "Systems Reference"). */
  title?: string;
  /** Intro paragraph after the title. */
  intro?: string;
  /** Section descriptions keyed by status. */
  sectionDescriptions?: Partial<Record<SystemStatus, string>>;
  /** Provenance header command (passed to commentHeader). */
  runCommand?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const STATUS_EMOJI: Record<SystemStatus, string> = {
  active: "🟢",
  legacy: "🟡",
  planned: "⚪",
};

function statusLabel(s: SystemStatus): string {
  return `${STATUS_EMOJI[s]} ${s}`;
}

function renderContract(c: SystemContract): string[] {
  const L: string[] = [];
  L.push(`### ${statusLabel(c.status)} \`${c.name}\``);
  L.push("");
  L.push(`> ${c.description}`);
  L.push("");
  L.push("- **Source:** `" + c.source + "`");
  L.push(`- **Generators:** ${c.generators.length}`);
  L.push(`- **Targets:** ${c.targets.length}`);
  L.push(`- **Validators:** ${c.validators.length}`);
  if (c.notes) {
    L.push("");
    L.push(`**Notes:** ${c.notes}`);
  }
  L.push("");

  if (c.generators.length > 0) {
    L.push("<details><summary>Generators</summary>", "");
    L.push("| Name | Script | Description |", "|------|--------|-------------|");
    for (const g of c.generators) L.push(`| \`${g.name}\` | \`${g.script}\` | ${g.description} |`);
    L.push("", "</details>", "");
  }

  if (c.targets.length > 0) {
    L.push("<details><summary>Targets</summary>", "");
    L.push("| Lang | Path | Description |", "|------|------|-------------|");
    for (const t of c.targets) L.push(`| ${t.lang} | \`${t.path}\` | ${t.description} |`);
    L.push("", "</details>", "");
  }

  if (c.validators.length > 0) {
    L.push("<details><summary>Validators</summary>", "");
    L.push("| Name | Script | Catches |", "|------|--------|---------|");
    for (const v of c.validators) L.push(`| \`${v.name}\` | \`${v.script}\` | ${v.description} |`);
    L.push("", "</details>", "");
  }

  L.push("---", "");
  return L;
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Render a complete Markdown systems reference document from a registry. */
export function renderSystemsReference(
  systems: readonly SystemContract[],
  opts: SystemsReferenceOpts = {},
): string {
  const title = opts.title ?? "Systems Reference";
  const intro = opts.intro ?? "";
  const descs = opts.sectionDescriptions ?? {};
  const L: string[] = [];

  // Header
  if (opts.runCommand) {
    L.push(...commentHeader({ runCommand: opts.runCommand }).split("\n"));
  }
  L.push("", `# ${title}`, "");
  if (intro) L.push(intro, "");

  // Summary table
  const active = systems.filter((s) => s.status === "active");
  const legacy = systems.filter((s) => s.status === "legacy");
  const planned = systems.filter((s) => s.status === "planned");
  const totalGens = systems.reduce((n, s) => n + s.generators.length, 0);
  const totalVals = systems.reduce((n, s) => n + s.validators.length, 0);

  L.push("## Summary", "");
  L.push("| Status | Count | Generators | Validators |", "|--------|-------|------------|------------|");
  L.push(`| 🟢 active | ${active.length} | ${active.reduce((n, s) => n + s.generators.length, 0)} | ${active.reduce((n, s) => n + s.validators.length, 0)} |`);
  L.push(`| 🟡 legacy | ${legacy.length} | ${legacy.reduce((n, s) => n + s.generators.length, 0)} | ${legacy.reduce((n, s) => n + s.validators.length, 0)} |`);
  L.push(`| ⚪ planned | ${planned.length} | ${planned.reduce((n, s) => n + s.generators.length, 0)} | ${planned.reduce((n, s) => n + s.validators.length, 0)} |`);
  L.push(`| **total** | **${systems.length}** | **${totalGens}** | **${totalVals}** |`);
  L.push("");

  // Per-status sections
  if (active.length > 0) {
    L.push("## 🟢 Active", "");
    if (descs.active) L.push(descs.active, "");
    for (const c of active) L.push(...renderContract(c));
  }
  if (legacy.length > 0) {
    L.push("## 🟡 Legacy", "");
    if (descs.legacy) L.push(descs.legacy, "");
    for (const c of legacy) L.push(...renderContract(c));
  }
  if (planned.length > 0) {
    L.push("## ⚪ Planned", "");
    if (descs.planned) L.push(descs.planned, "");
    for (const c of planned) L.push(...renderContract(c));
  }

  return L.join("\n") + "\n";
}

// ─── Mermaid graph ─────────────────────────────────────────────────────────

/** Render a Mermaid flowchart of system → generators / targets.
 *
 *  Topology: a system owns its generators and its targets, but the contract
 *  does NOT record which generator produces which target. We therefore connect
 *  both generators and targets directly to the system node — honestly reflecting
 *  what the contract declares, rather than fabricating a gen→target mapping.
 *
 *  Target node IDs are positional (`${sid}_target_${index}`) so that multiple
 *  targets sharing the same language do not collapse into a single Mermaid node. */
export function renderSystemsGraph(systems: readonly SystemContract[]): string {
  const active = systems.filter((s) => s.status === "active");
  const L: string[] = ["flowchart LR"];

  for (const s of active) {
    const sid = s.name.replace(/[^A-Za-z0-9]/g, "_");
    L.push(`  ${sid}["${s.name}"]:::system`);
    for (const g of s.generators) {
      const gid = `${sid}_${g.name}`.replace(/[^A-Za-z0-9_]/g, "_");
      L.push(`  ${gid}["${g.name}"]:::gen`);
      L.push(`  ${sid} --> ${gid}`);
    }
    // Targets connect to the SYSTEM node (no gen→target mapping is recorded).
    // Positional IDs guarantee uniqueness even when several targets share a language.
    s.targets.forEach((t, i) => {
      const tid = `${sid}_target_${i}`.replace(/[^A-Za-z0-9_]/g, "_");
      L.push(`  ${tid}(["${t.lang}"]):::target`);
      L.push(`  ${sid} --> ${tid}`);
    });
  }

  L.push("  classDef system fill:#0d3d38,color:#fff;");
  L.push("  classDef gen fill:#115e59,color:#fff;");
  L.push("  classDef target fill:#1f2937,color:#fff;");
  return L.join("\n") + "\n";
}
