import { describe, test, expect } from "bun:test";
import {
  diffSnapshots,
  renderMigrationChangelog,
  type SnapshotOpts,
  type SnapshotResult,
  type DiffRule,
} from "../src/snapshot.js";

// `diffSnapshots` only consumes `identity`, `compare`, and `rules` — the
// snapshotPath/serialize fields are required by the type but unused here.
function opts(rules: readonly DiffRule[], compare?: (a: any, b: any) => boolean): SnapshotOpts<any> {
  return {
    snapshotPath: "/dev/null",
    identity: (item: any) => String(item.id),
    serialize: (items) => items as unknown[],
    rules,
    compare,
  };
}

// ─── Whole-item add/remove ─────────────────────────────────────────────────

describe("diffSnapshots — whole-item add/remove", () => {
  test("detects removed items with default `*-removed` kind", () => {
    const oldItems = [{ id: "a" }, { id: "b" }];
    const newItems = [{ id: "b" }];

    const result = diffSnapshots(
      opts([{ field: "*", on: "removed", severity: "error" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      identity: "a",
      severity: "error",
      kind: "*-removed",
    });
    expect(result.hasBreaking).toBe(true);
    expect(result.oldCount).toBe(2);
    expect(result.newCount).toBe(1);
  });

  test("detects added items with default `*-added` kind", () => {
    const oldItems = [{ id: "a" }];
    const newItems = [{ id: "a" }, { id: "b" }];

    const result = diffSnapshots(
      opts([{ field: "*", on: "added", severity: "info" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      identity: "b",
      severity: "info",
      kind: "*-added",
    });
    expect(result.hasBreaking).toBe(false);
  });

  test("isolates add vs remove to their own rules", () => {
    const oldItems = [{ id: "a" }];
    const newItems = [{ id: "b" }];

    const result = diffSnapshots(
      opts([
        { field: "*", on: "removed", severity: "error" },
        { field: "*", on: "added", severity: "info" },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.infos).toHaveLength(1);
    expect(result.errors[0].identity).toBe("a");
    expect(result.infos[0].identity).toBe("b");
  });
});

// ─── Scalar field change ───────────────────────────────────────────────────

describe("diffSnapshots — scalar field change", () => {
  test("fires on: 'changed' when scalar value differs", () => {
    const oldItems = [{ id: "a", name: "Old", type: "string" }];
    const newItems = [{ id: "a", name: "New", type: "string" }];

    const result = diffSnapshots(
      opts([{ field: "name", on: "changed", severity: "warning" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      identity: "a",
      field: "name",
      severity: "warning",
      kind: "name-changed",
    });
    expect(result.changes[0].message).toContain('"Old"');
    expect(result.changes[0].message).toContain('"New"');
  });

  test("does not fire when scalar is unchanged", () => {
    const oldItems = [{ id: "a", name: "Same" }];
    const newItems = [{ id: "a", name: "Same" }];

    const result = diffSnapshots(
      opts([{ field: "name", on: "changed", severity: "warning" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(0);
  });

  test("fires on: 'added' / 'removed' when field appears or disappears", () => {
    const oldItems = [{ id: "a", name: "X" }];
    const newItems = [{ id: "a" }];

    const result = diffSnapshots(
      opts([
        { field: "name", on: "added", severity: "info" },
        { field: "name", on: "removed", severity: "error" },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("name-removed");
    expect(result.hasBreaking).toBe(true);
  });
});

// ─── Identity-aware array diff ─────────────────────────────────────────────

describe("diffSnapshots — identity-aware array diff", () => {
  test("reordering an identity-keyed array produces no false 'changed' entries", () => {
    const oldItems = [
      {
        id: "node",
        configSchema: [
          { key: "host", type: "string" },
          { key: "port", type: "number" },
        ],
      },
    ];
    const newItems = [
      {
        id: "node",
        // Same members, swapped order — must not trigger changes.
        configSchema: [
          { key: "port", type: "number" },
          { key: "host", type: "string" },
        ],
      },
    ];

    const result = diffSnapshots(
      opts([
        { field: "configSchema.*", on: "changed", severity: "warning", identityField: "key" },
        { field: "configSchema.*", on: "added", severity: "info", identityField: "key" },
        { field: "configSchema.*", on: "removed", severity: "error", identityField: "key" },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toEqual([]);
    expect(result.hasBreaking).toBe(false);
  });

  test("changing a member's content fires a single 'changed' entry keyed by identity", () => {
    const oldItems = [
      {
        id: "node",
        configSchema: [{ key: "port", type: "number" }],
      },
    ];
    const newItems = [
      {
        id: "node",
        configSchema: [{ key: "port", type: "integer" }],
      },
    ];

    const result = diffSnapshots(
      opts([{ field: "configSchema.*", on: "changed", severity: "warning", identityField: "key" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      identity: "node",
      field: "configSchema.port",
      kind: "configSchema.*-changed",
    });
  });

  test("index-based fallback (no identityField) still flags reordered members", () => {
    // Sanity check: without identityField, the legacy behavior is preserved.
    const oldItems = [
      {
        id: "node",
        configSchema: [
          { key: "host", type: "string" },
          { key: "port", type: "number" },
        ],
      },
    ];
    const newItems = [
      {
        id: "node",
        configSchema: [
          { key: "port", type: "number" },
          { key: "host", type: "string" },
        ],
      },
    ];

    const result = diffSnapshots(
      opts([
        { field: "configSchema.*", on: "changed", severity: "warning" },
        { field: "configSchema.*", on: "added", severity: "info" },
        { field: "configSchema.*", on: "removed", severity: "error" },
      ]),
      oldItems,
      newItems,
    );

    // Index-based diffing sees [0] and [1] as having shifted — at least one
    // spurious entry should appear. This documents why `identityField` exists.
    expect(result.changes.length).toBeGreaterThan(0);
  });
});

// ─── Identity-aware removal ────────────────────────────────────────────────

describe("diffSnapshots — identity-aware removal", () => {
  test("only the removed element shows as removed (not every shifted one)", () => {
    const oldItems = [
      {
        id: "node",
        configSchema: [
          { key: "host", type: "string" },
          { key: "port", type: "number" },
          { key: "debug", type: "boolean" },
        ],
      },
    ];
    const newItems = [
      {
        id: "node",
        configSchema: [
          { key: "host", type: "string" },
          { key: "debug", type: "boolean" },
        ],
      },
    ];

    const result = diffSnapshots(
      opts([{ field: "configSchema.*", on: "removed", severity: "error", identityField: "key" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      identity: "node",
      field: "configSchema.port",
      severity: "error",
      kind: "configSchema.*-removed",
    });
    expect(result.changes[0].message).toContain("port");
    expect(result.hasBreaking).toBe(true);
  });

  test("identity-aware add only reports the new member", () => {
    const oldItems = [
      {
        id: "node",
        configSchema: [{ key: "host", type: "string" }],
      },
    ];
    const newItems = [
      {
        id: "node",
        configSchema: [
          { key: "host", type: "string" },
          { key: "port", type: "number" },
        ],
      },
    ];

    const result = diffSnapshots(
      opts([{ field: "configSchema.*", on: "added", severity: "info", identityField: "key" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].field).toBe("configSchema.port");
  });
});

// ─── Custom kind on item rules ─────────────────────────────────────────────

describe("diffSnapshots — custom kind on item rules", () => {
  test("field '*' with on: 'removed' honors a custom kind", () => {
    const oldItems = [{ id: "a" }];
    const newItems: any[] = [];

    const result = diffSnapshots(
      opts([{ field: "*", on: "removed", severity: "error", kind: "node-removed" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("node-removed");
    // The legacy hardcoded `item-removed` must not leak through.
    expect(result.changes[0].kind).not.toBe("item-removed");
  });

  test("field '*' with on: 'added' honors a custom kind", () => {
    const oldItems: any[] = [];
    const newItems = [{ id: "a" }];

    const result = diffSnapshots(
      opts([{ field: "*", on: "added", severity: "info", kind: "node-added" }]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("node-added");
    expect(result.changes[0].kind).not.toBe("item-added");
  });

  test("custom kind on collection rule is applied to every emitted entry", () => {
    const oldItems = [
      {
        id: "node",
        configSchema: [{ key: "host", type: "string" }],
      },
    ];
    const newItems = [
      {
        id: "node",
        configSchema: [{ key: "host", type: "string" }, { key: "port", type: "number" }],
      },
    ];

    const result = diffSnapshots(
      opts([
        {
          field: "configSchema.*",
          on: "added",
          severity: "info",
          identityField: "key",
          kind: "config-field-added",
        },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].kind).toBe("config-field-added");
  });
});

// ─── Deduplication ─────────────────────────────────────────────────────────

describe("diffSnapshots — deduplication", () => {
  test("two identical scalar rules collapse to a single entry (first wins)", () => {
    const oldItems = [{ id: "a", name: "Old" }];
    const newItems = [{ id: "a", name: "New" }];

    const result = diffSnapshots(
      opts([
        { field: "name", on: "changed", severity: "warning", kind: "name-warn" },
        { field: "name", on: "changed", severity: "error", kind: "name-error" },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    // Earlier rule wins on severity/kind conflicts.
    expect(result.changes[0].severity).toBe("warning");
    expect(result.changes[0].kind).toBe("name-warn");
    expect(result.hasBreaking).toBe(false);
  });

  test("overlapping collection rules do not double-report", () => {
    const oldItems = [
      {
        id: "node",
        configSchema: [{ key: "host", type: "string" }],
      },
    ];
    const newItems = [
      {
        id: "node",
        configSchema: [],
      },
    ];

    const result = diffSnapshots(
      opts([
        { field: "configSchema.*", on: "removed", severity: "error", identityField: "key" },
        { field: "configSchema.*", on: "removed", severity: "warning", identityField: "key" },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].severity).toBe("error");
  });

  test("distinct changes for the same identity are preserved", () => {
    const oldItems = [{ id: "a", name: "Old", type: "string" }];
    const newItems = [{ id: "a", name: "New", type: "integer" }];

    const result = diffSnapshots(
      opts([
        { field: "name", on: "changed", severity: "warning" },
        { field: "type", on: "changed", severity: "warning" },
      ]),
      oldItems,
      newItems,
    );

    expect(result.changes).toHaveLength(2);
    const fields = result.changes.map(c => c.field).sort();
    expect(fields).toEqual(["name", "type"]);
  });
});

// ─── Migration changelog ───────────────────────────────────────────────────

describe("renderMigrationChangelog", () => {
  function makeResult(overrides: Partial<SnapshotResult> = {}): SnapshotResult {
    return {
      changes: [],
      errors: [],
      warnings: [],
      infos: [],
      hasBreaking: false,
      oldCount: 0,
      newCount: 0,
      ...overrides,
    };
  }

  test("groups errors by identity, lists warnings and infos flat", () => {
    const result = makeResult({
      errors: [
        {
          kind: "field-removed",
          severity: "error",
          identity: "nodeA",
          field: "name",
          message: 'Field "name" removed from "nodeA"',
        },
        {
          kind: "field-changed",
          severity: "error",
          identity: "nodeA",
          field: "port",
          message: 'Field "port" in "nodeA": 80 → 443',
        },
        {
          kind: "item-removed",
          severity: "error",
          identity: "nodeB",
          message: 'Item "nodeB" was removed',
        },
      ],
      warnings: [
        {
          kind: "name-changed",
          severity: "warning",
          identity: "nodeC",
          field: "name",
          message: 'Field "name" in "nodeC": x → y',
        },
      ],
      infos: [
        {
          kind: "item-added",
          severity: "info",
          identity: "nodeD",
          message: 'Item "nodeD" was added',
        },
      ],
      hasBreaking: true,
      oldCount: 3,
      newCount: 4,
    });

    const md = renderMigrationChangelog(result, "v2.0");

    // Title is rendered with the optional suffix.
    expect(md).toContain("# Migration Changelog — v2.0");
    expect(md).toContain("Auto-generated by @ebowwa/codegen-kit snapshot engine.");

    // Section headers include counts.
    expect(md).toContain("## ⚠️ Breaking Changes (3)");
    expect(md).toContain("## ⚡ Warnings (1)");
    expect(md).toContain("## ℹ️ Non-breaking Changes (1)");

    // Errors are grouped under ### identity headings.
    expect(md).toContain("### nodeA");
    expect(md).toContain("### nodeB");
    expect(md).toContain("**[field-removed]**");
    expect(md).toContain("**[item-removed]**");

    // Warnings/infos render as `[identity/field]` or `[identity]`.
    expect(md).toContain("[nodeC/name]");
    expect(md).toContain("[nodeD]");
  });

  test("empty result produces a minimal changelog with no section bodies", () => {
    const md = renderMigrationChangelog(makeResult());

    expect(md).toContain("# Migration Changelog");
    expect(md).not.toContain("Breaking Changes");
    expect(md).not.toContain("Warnings");
    expect(md).not.toContain("Non-breaking Changes");
    // Trailing divider closes the document.
    expect(md.trim().endsWith("---")).toBe(true);
  });

  test("uses default title when none is passed", () => {
    const md = renderMigrationChangelog(makeResult());
    expect(md.startsWith("# Migration Changelog\n")).toBe(true);
  });
});
