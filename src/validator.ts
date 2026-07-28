// @ebowwa/codegen-kit — validator result types + CLI harness.
// Domain-agnostic: a validator is a pure function returning a ValidateResult; the
// CLI flags (--verbose/--json/--fix) and exit semantics live here.

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface ValidationError {
  readonly kind: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ValidateResult {
  readonly entityCount: number;
  readonly claimCount: number;
  readonly errors: readonly ValidationError[];
  readonly warnings: readonly ValidationError[];
}

/** Mutable result builder (validators push errors/warnings during validation). */
export interface ResultBuilder {
  entityCount: number;
  claimCount: number;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export function newResult(entityCount: number, claimCount: number): ResultBuilder {
  return { entityCount, claimCount, errors: [], warnings: [] };
}

/** True when this module is the process entrypoint (run directly via bun). */
export function isMainEntry(importMetaUrl: string, file: string): boolean {
  const dir = dirname(fileURLToPath(importMetaUrl));
  const entry = resolve(process.argv[1] ?? "");
  return entry === resolve(dir, file) || entry === resolve(dir, file.replace(/\.ts$/, ".js"));
}

/** Standard validator CLI: --verbose / --json / --fix handling; exits non-zero on errors. */
export function runValidatorCli(name: string, result: ValidateResult): void {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose") || args.includes("-v");
  const json = args.includes("--json");
  const fixMode = args.includes("--fix");

  if (fixMode) {
    console.log(`${name} --fix: ${result.errors.length} error(s); autofix not implemented.`);
    process.exit(result.errors.length > 0 ? 1 : 0);
  }
  if (json) {
    console.log(JSON.stringify({ ...result, exitCode: result.errors.length > 0 ? 1 : 0 }, null, 2));
    process.exit(result.errors.length > 0 ? 1 : 0);
  }

  console.log(`${name}: ${result.entityCount} entities / ${result.claimCount} claims`);
  if (result.errors.length > 0) {
    console.error(`ERRORS (${result.errors.length}):`);
    for (const e of result.errors) console.error(`  [${e.kind}] ${e.message}`);
  }
  if (verbose && result.warnings.length > 0) {
    console.log(`WARNINGS (${result.warnings.length}):`);
    for (const w of result.warnings) console.log(`  [${w.kind}] ${w.message}`);
  }
  if (result.errors.length === 0) {
    console.log(`OK: ${name} clean.`);
    process.exit(0);
  }
  console.error(`FAIL: ${name} found ${result.errors.length} error(s).`);
  process.exit(1);
}
