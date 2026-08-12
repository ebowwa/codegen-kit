#!/usr/bin/env bun
// codegen demo (Layer 1 — primitives): the write/check/drift loop on a generated file.
// writeOrCheck writes when run plainly and, under --check, exits non-zero if the committed
// copy has drifted. stripVolatile keeps the build/sha/timestamp header from causing spurious
// drift across runs.
//
// (Imports the LOCAL source barrel; a real consumer writes `from "@ebowwa/codegen-kit"`.)
import { writeOrCheck, commentHeader, stripVolatile, diffLines } from "../src/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Stable tmp path so the demo is hermetic (no repo artifacts) yet re-runnable.
const file = join(tmpdir(), "codegen-kit-codegen-demo-GREETING.txt");

function render(): string {
  return (
    commentHeader({
      runCommand: "bun run examples/codegen-demo.ts",
      by: "@ebowwa/codegen-kit demo",
    }) + "Hello, codegen-kit!\n"
  );
}

console.log("codegen demo — the write/check/drift loop (Layer 1: primitives)\n");

console.log("1) WRITE — generate the file (no --check, so writeOrCheck writes it).");
writeOrCheck(file, render(), { strip: stripVolatile });
console.log("   wrote:", file, "\n");

console.log("2) CHECK — re-run in --check mode; the file matches the output, so it returns OK.");
writeOrCheck(file, render(), { check: true, strip: stripVolatile });
console.log("   check passed (writeOrCheck returned, no exit).\n");

console.log("3) DRIFT — hand-edit the file, then show what --check would catch:");
writeFileSync(file, readFileSync(file, "utf-8").replace("Hello, codegen-kit!", "Hello, TAMPERED!"));
const drift = diffLines(stripVolatile(readFileSync(file, "utf-8")), stripVolatile(render()));
for (const d of drift) {
  console.log(`   line ${d.line}: expected ${JSON.stringify(d.b)}, found ${JSON.stringify(d.a)}`);
}
console.log("   (writeOrCheck({check:true}) would process.exit(1) here — that's the CI drift gate.)\n");

console.log("Takeaway: pair --check with strip: stripVolatile so the volatile Build:/Generated:");
console.log("header line doesn't cause spurious drift across runs.\n");
console.log("✓ codegen demo OK.");
