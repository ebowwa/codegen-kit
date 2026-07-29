import { describe, test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runUmbrella } from "../src/umbrella.js";

describe("runUmbrella", () => {
  test("returns true when every command exits 0", () => {
    const ok = runUmbrella(["true", "echo hi"], { cwd: process.cwd() });
    expect(ok).toBe(true);
  });

  test("returns false when one command fails", () => {
    const ok = runUmbrella(["true", "false", "true"], { cwd: process.cwd() });
    expect(ok).toBe(false);
  });

  test("returns false on the first of many failing commands", () => {
    const ok = runUmbrella(["false", "true"], { cwd: process.cwd() });
    expect(ok).toBe(false);
  });

  test("runs ALL commands even when one fails (does not short-circuit)", () => {
    const dir = mkdtempSync(join(tmpdir(), "umbrella-"));
    const f1 = join(dir, "a.txt");
    const f2 = join(dir, "b.txt");
    const f3 = join(dir, "c.txt");

    const ok = runUmbrella(
      [`echo a > ${f1}`, "false", `echo b > ${f2}`, `echo c > ${f3}`],
      { cwd: dir },
    );

    // Failure propagated...
    expect(ok).toBe(false);
    // ...yet every command ran (the failing one was in the middle).
    expect(existsSync(f1)).toBe(true);
    expect(existsSync(f2)).toBe(true);
    expect(existsSync(f3)).toBe(true);
    expect(readFileSync(f1, "utf-8").trim()).toBe("a");
    expect(readFileSync(f3, "utf-8").trim()).toBe("c");
  });

  test("empty command list returns true (vacuously all succeeded)", () => {
    expect(runUmbrella([], { cwd: process.cwd() })).toBe(true);
  });
});
