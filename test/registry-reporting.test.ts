import { describe, test, expect } from "bun:test";
import {
  renderSystemsReference,
  renderSystemsGraph,
} from "../src/registry-reporting.js";
import type { SystemContract } from "../src/systems.js";

// ─── Fixtures ──────────────────────────────────────────────────────────────

/** Active system with two generators and three targets — two of which share
 *  the same language (Swift). This is the regression case for the old
 *  `${sid}_t_${t.lang}` ID bug: duplicate Swift targets used to collapse. */
const activeMixed: SystemContract = {
  name: "node-ontology",
  description: "Source-of-truth node definitions.",
  source: "ontology/nodes.yaml",
  status: "active",
  generators: [
    { name: "swift-gen", script: "src/generate-swift.ts", description: "Swift nodes" },
    { name: "kotlin-gen", script: "src/generate-kotlin.ts", description: "Kotlin nodes" },
  ],
  targets: [
    { lang: "swift", path: "ios/Nodes.swift", description: "iOS nodes" },
    { lang: "swift", path: "ios/NodeEnums.swift", description: "iOS node enums" },
    { lang: "kotlin", path: "android/Nodes.kt", description: "Android nodes" },
  ],
  validators: [
    { name: "name-check", script: "src/check-names.ts", description: "name collisions", supportsFix: true },
  ],
  notes: "Owns the canonical node type list.",
};

/** Active system with NO generators (planned-style, but still active) — used
 *  to verify targets still render and connect to the system node. */
const activeNoGens: SystemContract = {
  name: "edge-cases",
  description: "Edge case registry.",
  source: "registry/edges.yaml",
  status: "active",
  generators: [],
  targets: [
    { lang: "swift", path: "ios/Edges.swift", description: "iOS edges" },
    { lang: "kotlin", path: "android/Edges.kt", description: "Android edges" },
  ],
  validators: [],
};

/** Active system with NO targets — verifies system + generators render alone. */
const activeNoTargets: SystemContract = {
  name: "meta-index",
  description: "Pure generator system.",
  source: "registry/meta.yaml",
  status: "active",
  generators: [
    { name: "index-gen", script: "src/generate-index.ts", description: "Index builder" },
  ],
  targets: [],
  validators: [
    { name: "idx-check", script: "src/check-index.ts", description: "index drift" },
  ],
};

/** Legacy system — exercises the legacy section of the reference and is
 *  excluded from the graph (graph renders active only). */
const legacySystem: SystemContract = {
  name: "old-pipeline",
  description: "Deprecated pipeline.",
  source: "legacy/old.yaml",
  status: "legacy",
  generators: [
    { name: "old-gen", script: "legacy/generate.ts", description: "legacy" },
  ],
  targets: [
    { lang: "python", path: "legacy/out.py", description: "legacy output" },
  ],
  validators: [],
};

/** Planned system — exercises the planned section of the reference. */
const plannedSystem: SystemContract = {
  name: "future-system",
  description: "Notional future system.",
  source: "future/tbd.yaml",
  status: "planned",
  generators: [],
  targets: [],
  validators: [],
};

const allSystems: SystemContract[] = [
  activeMixed,
  activeNoGens,
  activeNoTargets,
  legacySystem,
  plannedSystem,
];

// ─── renderSystemsReference ────────────────────────────────────────────────

describe("renderSystemsReference", () => {
  test("renders the title and intro", () => {
    const md = renderSystemsReference(allSystems, {
      title: "My Systems",
      intro: "Welcome to the registry.",
    });
    expect(md).toContain("# My Systems");
    expect(md).toContain("Welcome to the registry.");
  });

  test("uses the default title when none provided", () => {
    const md = renderSystemsReference(allSystems);
    expect(md).toContain("# Systems Reference");
  });

  test("renders the summary table with correct status counts", () => {
    const md = renderSystemsReference(allSystems);
    expect(md).toContain("## Summary");
    expect(md).toContain("| Status | Count | Generators | Validators |");
    // 3 active, 1 legacy, 1 planned, 5 total
    expect(md).toMatch(/🟢 active \| 3 \| 3 \| 2/); // active: 2+0+1=3 gens, 1+0+1=2 vals
    expect(md).toMatch(/🟡 legacy \| 1 \| 1 \| 0/);
    expect(md).toMatch(/⚪ planned \| 1 \| 0 \| 0/);
    expect(md).toMatch(/\*\*total\*\* \| \*\*5\*\* \| \*\*4\*\* \| \*\*2\*\*/);
  });

  test("renders a per-status section for each populated status", () => {
    const md = renderSystemsReference(allSystems);
    expect(md).toContain("## 🟢 Active");
    expect(md).toContain("## 🟡 Legacy");
    expect(md).toContain("## ⚪ Planned");
  });

  test("omits empty status sections", () => {
    const md = renderSystemsReference([activeMixed]);
    expect(md).toContain("## 🟢 Active");
    expect(md).not.toContain("## 🟡 Legacy");
    expect(md).not.toContain("## ⚪ Planned");
  });

  test("renders each contract header with status emoji, name, source, and counts", () => {
    const md = renderSystemsReference(allSystems);
    // statusLabel emits "<emoji> <status>", so headers look like "### 🟢 active `name`".
    expect(md).toContain("### 🟢 active `node-ontology`");
    expect(md).toContain("- **Source:** `ontology/nodes.yaml`");
    expect(md).toContain("- **Generators:** 2");
    expect(md).toContain("- **Targets:** 3");
    expect(md).toContain("- **Validators:** 1");
    expect(md).toContain("### 🟡 legacy `old-pipeline`");
    expect(md).toContain("### ⚪ planned `future-system`");
  });

  test("renders collapsible <details> tables for generators/targets/validators", () => {
    const md = renderSystemsReference(allSystems);
    // node-ontology: 2 generators, 3 targets, 1 validator
    expect(md).toContain("<details><summary>Generators</summary>");
    expect(md).toContain("| Name | Script | Description |");
    expect(md).toContain("| `swift-gen` | `src/generate-swift.ts` | Swift nodes |");
    expect(md).toContain("<details><summary>Targets</summary>");
    expect(md).toContain("| Lang | Path | Description |");
    expect(md).toContain("| swift | `ios/Nodes.swift` | iOS nodes |");
    expect(md).toContain("<details><summary>Validators</summary>");
    expect(md).toContain("| Name | Script | Catches |");
    expect(md).toContain("| `name-check` | `src/check-names.ts` | name collisions |");
    expect(md).toContain("</details>");
  });

  test("omits the generators/details block when the contract has none", () => {
    const md = renderSystemsReference([activeNoGens]);
    // Contract header is present, but no Generators/Validators details blocks.
    expect(md).toContain("### 🟢 active `edge-cases`");
    expect(md).toContain("- **Generators:** 0");
    expect(md).not.toContain("<details><summary>Generators</summary>");
    expect(md).not.toContain("<details><summary>Validators</summary>");
    // It still has targets.
    expect(md).toContain("<details><summary>Targets</summary>");
  });

  test("includes notes when present", () => {
    const md = renderSystemsReference(allSystems);
    expect(md).toContain("**Notes:** Owns the canonical node type list.");
  });

  test("includes section descriptions when provided", () => {
    const md = renderSystemsReference(allSystems, {
      sectionDescriptions: {
        active: "These systems are live.",
        legacy: "Do not extend.",
        planned: "Coming soon.",
      },
    });
    expect(md).toContain("These systems are live.");
    expect(md).toContain("Do not extend.");
    expect(md).toContain("Coming soon.");
  });

  test("document ends with a trailing newline", () => {
    // Each contract block closes with "---" + a blank line, so the document
    // always ends in at least one newline.
    const md = renderSystemsReference(allSystems);
    expect(md.endsWith("\n")).toBe(true);
  });
});

// ─── renderSystemsGraph ────────────────────────────────────────────────────

describe("renderSystemsGraph", () => {
  test("is a flowchart LR", () => {
    const out = renderSystemsGraph(allSystems);
    expect(out.startsWith("flowchart LR\n")).toBe(true);
  });

  test("only renders active systems (skips legacy and planned)", () => {
    const out = renderSystemsGraph(allSystems);
    expect(out).toContain("node_ontology[\"node-ontology\"]");
    expect(out).toContain("edge_cases[\"edge-cases\"]");
    expect(out).toContain("meta_index[\"meta-index\"]");
    // Legacy + planned are NOT rendered.
    expect(out).not.toContain("old_pipeline");
    expect(out).not.toContain("future_system");
  });

  test("declares a system node and connects each generator to it", () => {
    const out = renderSystemsGraph([activeMixed]);
    const lines = out.split("\n");
    expect(lines).toContain("  node_ontology[\"node-ontology\"]:::system");
    expect(lines).toContain("  node_ontology_swift_gen[\"swift-gen\"]:::gen");
    expect(lines).toContain("  node_ontology --> node_ontology_swift_gen");
    expect(lines).toContain("  node_ontology_kotlin_gen[\"kotlin-gen\"]:::gen");
    expect(lines).toContain("  node_ontology --> node_ontology_kotlin_gen");
  });

  test("REGRESSION: multiple targets with the same language get UNIQUE node IDs", () => {
    const out = renderSystemsGraph([activeMixed]);
    // Two Swift targets — must NOT both collapse to node_ontology_t_swift.
    expect(out).not.toContain("node_ontology_t_swift");
    // Instead, positional IDs.
    expect(out).toContain("node_ontology_target_0([\"swift\"]):::target");
    expect(out).toContain("node_ontology_target_1([\"swift\"]):::target");
    expect(out).toContain("node_ontology_target_2([\"kotlin\"]):::target");
  });

  test("connects each target to the SYSTEM node, not to a generator", () => {
    const out = renderSystemsGraph([activeMixed]);
    const lines = out.split("\n");
    expect(lines).toContain("  node_ontology --> node_ontology_target_0");
    expect(lines).toContain("  node_ontology --> node_ontology_target_1");
    expect(lines).toContain("  node_ontology --> node_ontology_target_2");
    // No edge from any generator to any target should appear.
    expect(out).not.toMatch(/node_ontology_swift_gen --> node_ontology_target_\d/);
    expect(out).not.toMatch(/node_ontology_kotlin_gen --> node_ontology_target_\d/);
  });

  test("system with zero generators still renders targets connected to system", () => {
    const out = renderSystemsGraph([activeNoGens]);
    const lines = out.split("\n");
    expect(lines).toContain("  edge_cases[\"edge-cases\"]:::system");
    expect(lines).toContain("  edge_cases_target_0([\"swift\"]):::target");
    expect(lines).toContain("  edge_cases_target_1([\"kotlin\"]):::target");
    expect(lines).toContain("  edge_cases --> edge_cases_target_0");
    expect(lines).toContain("  edge_cases --> edge_cases_target_1");
    // And no generator node was emitted.
    expect(out).not.toMatch(/edge_cases_.*:::gen/);
  });

  test("system with zero targets renders just the system + generators", () => {
    const out = renderSystemsGraph([activeNoTargets]);
    const lines = out.split("\n");
    expect(lines).toContain("  meta_index[\"meta-index\"]:::system");
    expect(lines).toContain("  meta_index_index_gen[\"index-gen\"]:::gen");
    expect(lines).toContain("  meta_index --> meta_index_index_gen");
    // No target node was emitted.
    expect(out).not.toMatch(/meta_index_target_\d/);
  });

  test("emits the three classDef styles at the tail", () => {
    const out = renderSystemsGraph([activeMixed]);
    const lines = out.split("\n");
    expect(lines).toContain("  classDef system fill:#0d3d38,color:#fff;");
    expect(lines).toContain("  classDef gen fill:#115e59,color:#fff;");
    expect(lines).toContain("  classDef target fill:#1f2937,color:#fff;");
  });

  test("ends with a single trailing newline", () => {
    const out = renderSystemsGraph([activeMixed]);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  test("empty registry yields just the header + classDefs", () => {
    const out = renderSystemsGraph([]);
    expect(out).toBe(
      "flowchart LR\n" +
        "  classDef system fill:#0d3d38,color:#fff;\n" +
        "  classDef gen fill:#115e59,color:#fff;\n" +
        "  classDef target fill:#1f2937,color:#fff;\n",
    );
  });
});
