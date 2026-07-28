import { describe, test, expect } from "bun:test";
import { diffLines } from "../src/write-check.js";

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
