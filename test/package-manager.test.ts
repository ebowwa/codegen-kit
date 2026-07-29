import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInternalResolver,
  generateAllPackageJsons,
  checkAllPackageJsons,
} from "../src/package-manager.js";

/**
 * Stub process.exit so check-mode failures can be observed without terminating
 * the test process. `writeOrCheckMany` calls `process.exit(1)` on drift; we
 * capture the code instead of acting on it.
 */
function stubExit(): { calls: number[]; restore: () => void } {
  const calls: number[] = [];
  const real = process.exit;
  Object.defineProperty(process, "exit", {
    value(c?: number) {
      calls.push(c ?? 0);
    },
    configurable: true,
    writable: true,
  });
  return {
    calls,
    restore: () => {
      Object.defineProperty(process, "exit", {
        value: real,
        configurable: true,
        writable: true,
      });
    },
  };
}

/** Silent logger — the kit defaults to console.log which would spam test output. */
const silent = (): void => {};

describe("createInternalResolver", () => {
  test("resolves known internal package names to their version", () => {
    const internal = createInternalResolver({ "@ebowwa/a": "^0.1.0", "@ebowwa/b": "^1.2.3" });
    expect(internal("@ebowwa/a")).toBe("^0.1.0");
    expect(internal("@ebowwa/b")).toBe("^1.2.3");
  });

  test("throws on unknown internal dep (fail-fast at registry construction)", () => {
    const internal = createInternalResolver({ "@ebowwa/a": "^0.1.0" });
    expect(() => internal("@ebowwa/typo")).toThrow(/Unknown internal dep: @ebowwa\/typo/);
  });
});

describe("generateAllPackageJsons", () => {
  test("writes a package.json for every registry entry at its resolved path", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pm-gen-"));

    generateAllPackageJsons({
      repoRoot,
      packages: {
        "package.json": { name: "@ebowwa/root", version: "1.0.0", private: true },
        "packages/a/package.json": { name: "@ebowwa/a", version: "0.1.0" },
        "packages/b/package.json": {
          name: "@ebowwa/b",
          version: "0.2.0",
          dependencies: { "@ebowwa/a": "^0.1.0" },
        },
      },
      log: silent,
    });

    const root = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    expect(root.name).toBe("@ebowwa/root");
    expect(root.private).toBe(true);

    const a = JSON.parse(readFileSync(join(repoRoot, "packages/a/package.json"), "utf-8"));
    expect(a.name).toBe("@ebowwa/a");
    expect(a.version).toBe("0.1.0");

    const b = JSON.parse(readFileSync(join(repoRoot, "packages/b/package.json"), "utf-8"));
    expect(b.dependencies["@ebowwa/a"]).toBe("^0.1.0");
  });

  test("writes with the canonical 2-space + trailing-newline format", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pm-fmt-"));
    generateAllPackageJsons({
      repoRoot,
      packages: {
        "package.json": { name: "@ebowwa/x", version: "1.0.0" },
      },
      log: silent,
    });
    const raw = readFileSync(join(repoRoot, "package.json"), "utf-8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('  "name": "@ebowwa/x"');
  });
});

describe("checkAllPackageJsons", () => {
  test("passes (no exit) when every committed file matches the registry", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pm-ok-"));
    const packages = {
      "package.json": { name: "@ebowwa/root", version: "1.0.0", private: true },
      "packages/a/package.json": { name: "@ebowwa/a", version: "0.1.0" },
    };

    generateAllPackageJsons({ repoRoot, packages, log: silent });

    const stub = stubExit();
    try {
      // No throw, no process.exit when everything is in sync.
      expect(() => checkAllPackageJsons({ repoRoot, packages, log: silent })).not.toThrow();
    } finally {
      stub.restore();
    }
    expect(stub.calls).toEqual([]);
  });

  test("exits 1 when a committed package.json is stale", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pm-stale-"));
    const packages = {
      "package.json": { name: "@ebowwa/root", version: "1.0.0" },
    };
    generateAllPackageJsons({ repoRoot, packages, log: silent });

    // Now drift the committed file so the registry disagrees.
    const committed = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
    committed.version = "9.9.9";
    writeFileSync(join(repoRoot, "package.json"), JSON.stringify(committed, null, 2) + "\n");

    const stub = stubExit();
    try {
      checkAllPackageJsons({ repoRoot, packages, log: silent });
    } finally {
      stub.restore();
    }
    expect(stub.calls).toContain(1);
  });

  test("exits 1 when a committed package.json is missing", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "pm-missing-"));
    const packages = {
      "packages/a/package.json": { name: "@ebowwa/a", version: "0.1.0" },
    };
    // NOTE: intentionally do NOT generate — the file is missing on disk.

    const stub = stubExit();
    try {
      checkAllPackageJsons({ repoRoot, packages, log: silent });
    } finally {
      stub.restore();
    }
    expect(stub.calls).toContain(1);
  });
});
