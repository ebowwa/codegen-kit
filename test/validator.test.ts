import { describe, test, expect, afterEach } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { newResult, isMainEntry } from "../src/validator.js";

describe("newResult", () => {
  test("returns a builder with the given counts and empty errors/warnings", () => {
    const r = newResult(3, 5);
    expect(r.entityCount).toBe(3);
    expect(r.claimCount).toBe(5);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  test("errors and warnings arrays are mutable (validators push during validation)", () => {
    const r = newResult(1, 2);
    r.errors.push({ kind: "missing", severity: "error", message: "boom" });
    r.warnings.push({ kind: "stale", severity: "warning", message: "old" });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].kind).toBe("missing");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toBe("old");
  });

  test("defaults are independent per builder (no shared array reference)", () => {
    const a = newResult(0, 0);
    const b = newResult(0, 0);
    a.errors.push({ kind: "x", severity: "error", message: "y" });
    expect(b.errors).toEqual([]);
    expect(a.errors).toHaveLength(1);
  });
});

describe("isMainEntry", () => {
  // process.argv[1] is what isMainEntry compares against; save & restore it.
  const origArgv1 = process.argv[1];

  afterEach(() => {
    process.argv[1] = origArgv1;
  });

  test("true when process.argv[1] resolves to dir/file (.ts)", () => {
    const importMetaUrl = pathToFileURL("/fake/dir/mybin.ts").href;
    process.argv[1] = resolve("/fake/dir", "mybin.ts");
    expect(isMainEntry(importMetaUrl, "mybin.ts")).toBe(true);
  });

  test("true when process.argv[1] matches the .js variant of an imported .ts file", () => {
    const importMetaUrl = pathToFileURL("/fake/dir/mybin.ts").href;
    process.argv[1] = resolve("/fake/dir", "mybin.js");
    expect(isMainEntry(importMetaUrl, "mybin.ts")).toBe(true);
  });

  test("false when process.argv[1] points elsewhere", () => {
    const importMetaUrl = pathToFileURL("/fake/dir/mybin.ts").href;
    process.argv[1] = "/totally/different/script.ts";
    expect(isMainEntry(importMetaUrl, "mybin.ts")).toBe(false);
  });

  test("false when argv[1] is undefined", () => {
    const importMetaUrl = pathToFileURL("/fake/dir/mybin.ts").href;
    process.argv[1] = undefined as unknown as string;
    // resolve("") => cwd; won't equal /fake/dir/mybin.ts
    expect(isMainEntry(importMetaUrl, "mybin.ts")).toBe(false);
  });
});
