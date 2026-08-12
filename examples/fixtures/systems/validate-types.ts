#!/usr/bin/env bun
// Demo validator (Layer 2): asserts the generated manifest has exactly one entry per spec.
// Uses newResult + runValidatorCli — the same harness real validators use. Invoked as a
// `bun run` subprocess by runSystemsValidators.
//
// (Imports the LOCAL source barrel; a real consumer writes `from "@ebowwa/codegen-kit"`.)
import { newResult, runValidatorCli, isMainEntry, type ValidateResult } from "../../../src/index.js";
import { SPECS } from "./source/types.js";
import { OUT_PATH } from "./generate-types.js";
import { readFileSync, existsSync } from "node:fs";

function validate(): ValidateResult {
  const r = newResult(SPECS.length, SPECS.length);
  if (!existsSync(OUT_PATH)) {
    r.errors.push({
      kind: "missing",
      severity: "error",
      message: `${OUT_PATH} not found — run the generator first`,
    });
    return r;
  }
  // Non-comment, non-blank lines are the manifest body (one per spec).
  const entries = readFileSync(OUT_PATH, "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "" && !l.startsWith("//")).length;
  if (entries !== SPECS.length) {
    r.errors.push({
      kind: "count",
      severity: "error",
      message: `expected ${SPECS.length} entries, manifest has ${entries}`,
    });
  }
  return r;
}

if (isMainEntry(import.meta.url, "validate-types.ts")) {
  runValidatorCli("validate-types", validate());
}
