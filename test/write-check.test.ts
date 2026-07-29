import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diffLines,
  writeOrCheck,
  writeOrCheckMany,
  patchOrCheck,
  scaffoldFiles,
} from "../src/write-check.js";

// ─── Harness helpers ──────────────────────────────────────────────────────

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wck-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Run `fn` with `process.exit` replaced by a stub that records the requested
 * code and throws (so the calling function unwinds instead of killing the
 * test process). Returns whether exit was invoked and with what code.
 */
function captureExit<T>(fn: () => T): { exitCode: number | null; returnValue?: T; threw: boolean } {
  const original = process.exit;
  let exitCode: number | null = null;
  (process as unknown as { exit: (code?: number) => never }).exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__EXIT_${exitCode}__`);
  };
  try {
    const returnValue = fn();
    return { exitCode, returnValue, threw: false };
  } catch {
    return { exitCode, threw: true };
  } finally {
    (process as unknown as { exit: (code?: number) => never }).exit = original;
  }
}

/** Silence chatty console output during tests; restore originals after. */
function silenceConsole(): () => void {
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  console.info = () => {};
  return () => {
    console.log = orig.log;
    console.error = orig.error;
    console.warn = orig.warn;
    console.info = orig.info;
  };
}

// ─── diffLines ─────────────────────────────────────────────────────────────

describe("diffLines", () => {
  test("returns the differing line indexes (1-based)", () => {
    expect(diffLines("a\nb\nc", "a\nX\nc")).toEqual([{ line: 2, a: "b", b: "X" }]);
  });

  test("reports added and removed lines", () => {
    expect(diffLines("a\nb\nc", "a\nb\nc\nY")).toEqual([{ line: 4, a: undefined, b: "Y" }]);
    expect(diffLines("a\nb\nc\nY", "a\nb\nc")).toEqual([{ line: 4, a: "Y", b: undefined }]);
  });

  test("respects the max cap", () => {
    const d = diffLines("1\n2\n3\n4\n5", "1\nx\nx\nx\nx", 2);
    expect(d.length).toBe(2);
    expect(d[0]).toEqual({ line: 2, a: "2", b: "x" });
  });

  test("identical inputs yield no diffs", () => {
    expect(diffLines("a\nb", "a\nb")).toEqual([]);
  });
});

// ─── writeOrCheck ─────────────────────────────────────────────────────────

describe("writeOrCheck", () => {
  test("write mode creates the file (and missing parent dirs)", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "nested", "deep", "out.txt");
      writeOrCheck(path, "hello");
      expect(readFileSync(path, "utf-8")).toBe("hello");
    } finally {
      restore();
    }
  });

  test("check mode passes when the file is in sync", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "a.txt");
      writeFileSync(path, "body");
      const r = captureExit(() => writeOrCheck(path, "body", { check: true }));
      expect(r.exitCode).toBeNull();
      expect(r.threw).toBe(false);
    } finally {
      restore();
    }
  });

  test("check mode fails (exit 1) when the file is stale", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "a.txt");
      writeFileSync(path, "old");
      const r = captureExit(() => writeOrCheck(path, "new", { check: true }));
      expect(r.exitCode).toBe(1);
      expect(r.threw).toBe(true);
    } finally {
      restore();
    }
  });

  test("check mode fails (exit 1) when the file is missing", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "missing.txt");
      const r = captureExit(() => writeOrCheck(path, "x", { check: true }));
      expect(r.exitCode).toBe(1);
      expect(r.threw).toBe(true);
    } finally {
      restore();
    }
  });

  test("strip option masks volatile tokens before comparing", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "a.txt");
      writeFileSync(path, "Build: 1.2.3\nGenerated: 2026-01-01\nbody");
      const strip = (s: string) => s.replace(/Build: \S+/g, "Build: X");
      const r = captureExit(() =>
        writeOrCheck(path, "Build: 9.9.9\nGenerated: 2026-01-01\nbody", { check: true, strip }),
      );
      expect(r.exitCode).toBeNull();
      expect(r.threw).toBe(false);
    } finally {
      restore();
    }
  });
});

// ─── writeOrCheckMany ─────────────────────────────────────────────────────

describe("writeOrCheckMany", () => {
  test("write mode writes all entries", () => {
    const restore = silenceConsole();
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "sub", "b.txt");
      writeOrCheckMany([
        { path: a, content: "A" },
        { path: b, content: "B" },
      ]);
      expect(readFileSync(a, "utf-8")).toBe("A");
      expect(readFileSync(b, "utf-8")).toBe("B");
    } finally {
      restore();
    }
  });

  test("check mode passes when every file is in sync", () => {
    const restore = silenceConsole();
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "b.txt");
      writeFileSync(a, "A");
      writeFileSync(b, "B");
      const r = captureExit(() =>
        writeOrCheckMany([{ path: a, content: "A" }, { path: b, content: "B" }], { check: true }),
      );
      expect(r.exitCode).toBeNull();
      expect(r.threw).toBe(false);
    } finally {
      restore();
    }
  });

  test("check mode exits 1 on drift (and keeps checking the rest)", () => {
    const restore = silenceConsole();
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "b.txt");
      const c = join(dir, "c.txt");
      writeFileSync(a, "A");
      writeFileSync(b, "STALE");
      writeFileSync(c, "C");
      const r = captureExit(() =>
        writeOrCheckMany(
          [
            { path: a, content: "A" },
            { path: b, content: "B" },
            { path: c, content: "C" },
          ],
          { check: true, diffLines: 3 },
        ),
      );
      expect(r.exitCode).toBe(1);
      expect(r.threw).toBe(true);
    } finally {
      restore();
    }
  });

  test("check mode exits 1 when any file is missing", () => {
    const restore = silenceConsole();
    try {
      const a = join(dir, "a.txt");
      const missing = join(dir, "missing.txt");
      writeFileSync(a, "A");
      const r = captureExit(() =>
        writeOrCheckMany(
          [
            { path: a, content: "A" },
            { path: missing, content: "X" },
          ],
          { check: true },
        ),
      );
      expect(r.exitCode).toBe(1);
    } finally {
      restore();
    }
  });
});

// ─── patchOrCheck ─────────────────────────────────────────────────────────

describe("patchOrCheck", () => {
  test("applies a transform and writes the new content", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "p.txt");
      writeFileSync(path, "alpha\nbeta\n");
      patchOrCheck(path, (existing) => {
        const content = existing + "gamma\n";
        return {
          content,
          hasChanges: true,
          changes: [{ action: "added", detail: "gamma line" }],
        };
      });
      expect(readFileSync(path, "utf-8")).toBe("alpha\nbeta\ngamma\n");
    } finally {
      restore();
    }
  });

  test("reports changes when in check mode (exit 1)", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "p.txt");
      writeFileSync(path, "alpha\n");
      const r = captureExit(() =>
        patchOrCheck(
          path,
          (existing) => ({
            content: existing + "beta\n",
            hasChanges: true,
            changes: [{ action: "added", detail: "beta line" }],
          }),
          { check: true },
        ),
      );
      expect(r.exitCode).toBe(1);
      // File untouched in check mode.
      expect(readFileSync(path, "utf-8")).toBe("alpha\n");
    } finally {
      restore();
    }
  });

  test("no changes → OK (no exit, no rewrite)", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "p.txt");
      writeFileSync(path, "same\n");
      const r = captureExit(() =>
        patchOrCheck(path, () => ({
          content: "same\n",
          hasChanges: false,
          changes: [],
        })),
      );
      expect(r.exitCode).toBeNull();
      expect(r.threw).toBe(false);
      expect(readFileSync(path, "utf-8")).toBe("same\n");
    } finally {
      restore();
    }
  });

  test("skipIfMissing returns cleanly without exiting", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "absent.txt");
      const r = captureExit(() =>
        patchOrCheck(
          path,
          () => ({ content: "x", hasChanges: false, changes: [] }),
          { skipIfMissing: true },
        ),
      );
      expect(r.exitCode).toBeNull();
      expect(r.threw).toBe(false);
      expect(existsSync(path)).toBe(false);
    } finally {
      restore();
    }
  });

  test("missing without skipIfMissing exits 1", () => {
    const restore = silenceConsole();
    try {
      const path = join(dir, "absent.txt");
      const r = captureExit(() =>
        patchOrCheck(
          path,
          () => ({ content: "x", hasChanges: true, changes: [] }),
        ),
      );
      expect(r.exitCode).toBe(1);
    } finally {
      restore();
    }
  });
});

// ─── scaffoldFiles ────────────────────────────────────────────────────────

describe("scaffoldFiles", () => {
  test("creates new files and reports them in `created`", () => {
    const restore = silenceConsole();
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "nested", "b.txt");
      const result = scaffoldFiles([
        { path: a, content: "A", description: "root file" },
        { path: b, content: "B", description: "nested file" },
      ]);
      expect(result.created).toEqual([a, b]);
      expect(result.overwritten).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(readFileSync(a, "utf-8")).toBe("A");
      expect(readFileSync(b, "utf-8")).toBe("B");
    } finally {
      restore();
    }
  });

  test("collision detection: throws when an existing file lacks overwrite:true (and writes nothing)", () => {
    const restore = silenceConsole();
    try {
      const existing = join(dir, "exists.txt");
      const fresh = join(dir, "fresh.txt");
      writeFileSync(existing, "ORIGINAL");
      expect(() =>
        scaffoldFiles([
          { path: existing, content: "NEW", description: "collision" },
          { path: fresh, content: "FRESH", description: "fresh" },
        ]),
      ).toThrow(/collision/);

      // Atomic: preflight aborted before any writes.
      expect(readFileSync(existing, "utf-8")).toBe("ORIGINAL");
      expect(existsSync(fresh)).toBe(false);
    } finally {
      restore();
    }
  });

  test("overwrite: true replaces existing content and records in `overwritten`", () => {
    const restore = silenceConsole();
    try {
      const existing = join(dir, "exists.txt");
      writeFileSync(existing, "OLD");
      const result = scaffoldFiles([
        { path: existing, content: "NEW", description: "replaced", overwrite: true },
      ]);
      expect(result.overwritten).toEqual([existing]);
      expect(result.created).toEqual([]);
      expect(readFileSync(existing, "utf-8")).toBe("NEW");
    } finally {
      restore();
    }
  });

  test("dry-run prints the plan without touching the filesystem", () => {
    const restore = silenceConsole();
    try {
      const fresh = join(dir, "fresh.txt");
      const result = scaffoldFiles(
        [{ path: fresh, content: "X", description: "fresh" }],
        { dryRun: true },
      );
      // Same shape: created = would-create, overwritten = would-overwrite.
      expect(result.created).toEqual([fresh]);
      expect(result.overwritten).toEqual([]);
      expect(existsSync(fresh)).toBe(false);
    } finally {
      restore();
    }
  });

  test("dry-run still refuses on collision (atomic preflight)", () => {
    const restore = silenceConsole();
    try {
      const existing = join(dir, "exists.txt");
      writeFileSync(existing, "ORIGINAL");
      expect(() =>
        scaffoldFiles(
          [{ path: existing, content: "X", description: "collision" }],
          { dryRun: true },
        ),
      ).toThrow(/collision/);
      expect(readFileSync(existing, "utf-8")).toBe("ORIGINAL");
    } finally {
      restore();
    }
  });

  test("dry-run reports would-overwrite for an existing file with overwrite:true", () => {
    const restore = silenceConsole();
    try {
      const existing = join(dir, "exists.txt");
      writeFileSync(existing, "OLD");
      const result = scaffoldFiles(
        [{ path: existing, content: "NEW", description: "replaced", overwrite: true }],
        { dryRun: true },
      );
      expect(result.overwritten).toEqual([existing]);
      expect(result.created).toEqual([]);
      // Untouched.
      expect(readFileSync(existing, "utf-8")).toBe("OLD");
    } finally {
      restore();
    }
  });

  test("rollback on failure restores overwritten files and deletes created files", () => {
    const restore = silenceConsole();
    try {
      const existing = join(dir, "existing.txt");
      const created = join(dir, "new-sub", "created.txt");
      // A directory entry — writeFileSync on a directory throws EISDIR,
      // reliably triggering the rollback path after the prior writes succeed.
      const blocker = join(dir, "blocker");
      writeFileSync(existing, "ORIGINAL");
      mkdirSync(blocker);

      expect(() =>
        scaffoldFiles([
          { path: created, content: "CREATED", description: "new file" },
          { path: existing, content: "UPDATED", description: "replaced", overwrite: true },
          { path: blocker, content: "will fail", description: "fails (is a dir)" },
        ]),
      ).toThrow();

      // Created file was deleted.
      expect(existsSync(created)).toBe(false);
      // The directory created for it was cleaned up.
      expect(existsSync(join(dir, "new-sub"))).toBe(false);
      // Overwritten file was restored to its backup.
      expect(readFileSync(existing, "utf-8")).toBe("ORIGINAL");
    } finally {
      restore();
    }
  });

  test("rollback is a no-op for skipped-due-to-collision (preflight throws before writes)", () => {
    const restore = silenceConsole();
    try {
      const a = join(dir, "a.txt");
      const b = join(dir, "b.txt");
      writeFileSync(a, "A");
      // b does not exist; a collides. Nothing should be written at all.
      expect(() =>
        scaffoldFiles([
          { path: a, content: "X", description: "collides" },
          { path: b, content: "B", description: "fresh" },
        ]),
      ).toThrow(/collision/);
      expect(readFileSync(a, "utf-8")).toBe("A");
      expect(existsSync(b)).toBe(false);
    } finally {
      restore();
    }
  });
});
