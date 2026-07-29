import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSystem,
  getSystemsByStatus,
  getActiveSystems,
  computeCoverage,
} from "../src/systems.js";
import type { SystemContract, SystemStatus } from "../src/systems.js";

/** Minimal system for the registry-helper tests. */
function sys(name: string, status: SystemStatus): SystemContract {
  return {
    name,
    description: "",
    source: "",
    targets: [],
    generators: [],
    validators: [],
    status,
  };
}

// Three systems: one per status.
const SYSTEMS: SystemContract[] = [
  sys("alpha", "active"),
  sys("beta", "legacy"),
  sys("gamma", "planned"),
];

describe("getSystem", () => {
  test("finds a system by name", () => {
    expect(getSystem(SYSTEMS, "beta")?.name).toBe("beta");
    expect(getSystem(SYSTEMS, "gamma")?.status).toBe("planned");
  });

  test("returns undefined for an unknown name", () => {
    expect(getSystem(SYSTEMS, "nope")).toBeUndefined();
  });
});

describe("getSystemsByStatus", () => {
  test("filters to the requested status", () => {
    expect(getSystemsByStatus(SYSTEMS, "legacy")).toHaveLength(1);
    expect(getSystemsByStatus(SYSTEMS, "legacy")[0].name).toBe("beta");
    expect(getSystemsByStatus(SYSTEMS, "planned").map((s) => s.name)).toEqual(["gamma"]);
  });

  test("returns empty array when nothing matches", () => {
    // No "active" system in this fixed set? alpha IS active, so use a status nobody has.
    // (Sanity: alpha is active, covered separately below.)
    expect(getSystemsByStatus([], "active")).toEqual([]);
  });
});

describe("getActiveSystems", () => {
  test("returns only status:'active' systems", () => {
    const active = getActiveSystems(SYSTEMS);
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe("alpha");
    expect(active.every((s) => s.status === "active")).toBe(true);
  });
});

describe("computeCoverage", () => {
  test("classifies scripts into claimed / meta / acknowledged / drift", () => {
    const commandsDir = mkdtempSync(join(tmpdir(), "cov-"));

    // generate-*.ts scripts in the commands dir (content irrelevant — only names read).
    writeFileSync(join(commandsDir, "generate-foo.ts"), "");
    writeFileSync(join(commandsDir, "generate-meta.ts"), "");
    writeFileSync(join(commandsDir, "generate-ack.ts"), "");
    writeFileSync(join(commandsDir, "generate-drift.ts"), "");
    // Non-matching files must be ignored entirely.
    writeFileSync(join(commandsDir, "README.md"), "");
    writeFileSync(join(commandsDir, "helper.ts"), "");

    const systems: SystemContract[] = [
      {
        name: "foo-system",
        description: "",
        source: "",
        targets: [],
        generators: [
          { name: "foo", script: "commands/generate-foo.ts", description: "" },
        ],
        validators: [],
        status: "active",
      },
    ];

    const report = computeCoverage(systems, {
      commandsDir,
      repoRoot: commandsDir,
      metaGenerators: ["generate-meta.ts"],
      acknowledgedOrphans: { "generate-ack.ts": "future-system" },
    });

    expect(report.totalScripts).toBe(4);
    expect(report.claimed).toEqual(["generate-foo.ts"]);
    expect(report.meta).toEqual(["generate-meta.ts"]);
    expect(report.acknowledged).toEqual([
      { filename: "generate-ack.ts", intendedSystem: "future-system" },
    ]);
    expect(report.drift).toEqual(["generate-drift.ts"]);
    expect(report.hasDrift).toBe(true);
  });

  test("hasDrift is false when every script is claimed, meta, or acknowledged", () => {
    const commandsDir = mkdtempSync(join(tmpdir(), "cov-clean-"));
    writeFileSync(join(commandsDir, "generate-foo.ts"), "");
    writeFileSync(join(commandsDir, "generate-meta.ts"), "");

    const systems: SystemContract[] = [
      {
        name: "foo-system",
        description: "",
        source: "",
        targets: [],
        generators: [
          { name: "foo", script: "commands/generate-foo.ts", description: "" },
        ],
        validators: [],
        status: "active",
      },
    ];

    const report = computeCoverage(systems, {
      commandsDir,
      repoRoot: commandsDir,
      metaGenerators: ["generate-meta.ts"],
    });

    expect(report.drift).toEqual([]);
    expect(report.hasDrift).toBe(false);
  });

  test("empty commands dir yields an empty report", () => {
    const commandsDir = mkdtempSync(join(tmpdir(), "cov-empty-"));
    const report = computeCoverage([], {
      commandsDir,
      repoRoot: commandsDir,
      metaGenerators: [],
    });
    expect(report.totalScripts).toBe(0);
    expect(report.hasDrift).toBe(false);
  });
});
