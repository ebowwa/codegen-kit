#!/usr/bin/env bun
// Demo generator (Layer 2): derives a flat manifest from source/types.ts and writes it via
// writeOrCheck. Run plainly to WRITE; pass --check to VERIFY drift. The kit's
// runSystemsGenerators invokes this as a `bun run` subprocess (see examples/systems-demo.ts).
//
// (Imports the LOCAL source barrel; a real consumer writes `from "@ebowwa/codegen-kit"`.)
import { writeOrCheck, commentHeader, stripVolatile, isMainEntry } from "../../../src/index.js";
import { SPECS } from "./source/types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Stable path so the generator and the validator agree across subprocess invocations. */
export const OUT_PATH = join(tmpdir(), "codegen-kit-demo-types-manifest.txt");

function render(): string {
  const body = SPECS.map((s) => `${s.kind}\t${s.name}`).join("\n");
  return (
    commentHeader({
      runCommand: "bun run examples/fixtures/systems/generate-types.ts",
      by: "@ebowwa/codegen-kit demo",
      source: "examples/fixtures/systems/source/types.ts",
    }) + body + "\n"
  );
}

if (isMainEntry(import.meta.url, "generate-types.ts")) {
  const isCheck = process.argv.includes("--check");
  writeOrCheck(OUT_PATH, render(), { check: isCheck, strip: stripVolatile });
}
