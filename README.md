# @ebowwa/codegen-kit

A framework for **declarative codegen** — declare your systems, generators, and validators; the kit runs them, checks for drift, and catches orphans. Extracted from secondsee's `node-codegen`, generalized for any repo.

## Install

```
npm install @ebowwa/codegen-kit
```

## Two layers

### Primitives — the mechanical loop

The building blocks for individual generators and validators:

- **`writeOrCheck(path, content, {check, strip})`** — write a file, or fail if the committed copy is stale (drift detection).
- **`writeOrCheckMany(entries, {check, strip, diffLines})`** — multi-file variant: checks all files, shows per-file diffs on drift.
- **`commentHeader({runCommand, by, source, prefix})`** / **`jsdocHeader({runCommand, by, source})`** — autogen headers (`//` block or `/** */` JSDoc).
- **`runValidatorCli(name, result)`** / **`newResult(entityCount, claimCount)`** — validator CLI harness (`--verbose`/`--json`/`--fix`).
- **`runUmbrella(commands, {cwd})`** — subprocess runner for check-all / validate-all umbrellas.
- **`stripVolatile(s)`** / **`buildNumber()`** / **`autogenMeta(runCommand, source?)`** — provenance + drift stripping (reads the consumer's `package.json` via `process.cwd()`).
- **`diffLines(a, b, max)`** — pure line-by-line diff helper.

### Systems framework — declarative registry

Declare your codegen systems as data; the kit walks them:

```ts
import { SystemContract, runSystemsGenerators, runSystemsValidators, computeCoverage } from "@ebowwa/codegen-kit";

const SYSTEMS: SystemContract[] = [
  {
    name: "my-types",
    description: "Type definitions shared across platforms.",
    source: "src/types.ts",
    targets: [{ lang: "swift", path: "dist/Types.swift", description: "iOS types" }],
    generators: [{ name: "swift", script: "src/commands/generate-swift.ts", description: "Swift types" }],
    validators: [{ name: "bijection", script: "src/validators/check-bijection.ts", description: "Cross-language constant parity" }],
    status: "active",
  },
];
```

From that declaration, the kit provides:

- **`runSystemsGenerators(systems, {packageRoot, repoRoot, check, verbose})`** — walk active systems' `generators[]`, run each (pass `--check` for drift mode).
- **`runSystemsValidators(systems, {packageRoot, repoRoot, verbose})`** — walk active systems' `validators[]`, run each.
- **`computeCoverage(systems, {commandsDir, repoRoot, metaGenerators, acknowledgedOrphans})`** — 4-bucket orphan detection: every generator script must be **claimed** (by a system), **meta** (operates over systems), **acknowledged** (explicit TODO), or it's **drift** (fails CI).
- **`findMissingClaimedScripts(systems, repoRoot)`** — verify every script referenced in the registry exists on disk.
- Registry helpers: `getSystem`, `getActiveSystems`, `getSystemsByStatus`.

## Usage

### A single generator

```ts
import { writeOrCheck, stripVolatile, isMainEntry } from "@ebowwa/codegen-kit";

const isCheck = process.argv.includes("--check");
if (isMainEntry(import.meta.url, "generate-foo.ts"))
  writeOrCheck(OUT_PATH, generateFoo(model), { check: isCheck, strip: stripVolatile });
```

### A validator

```ts
import { newResult, runValidatorCli, isMainEntry } from "@ebowwa/codegen-kit";

export function validate(model) {
  const r = newResult(model.length, 0);
  // ... check invariants, push to r.errors ...
  return r;
}
if (isMainEntry(import.meta.url, "validate-foo.ts"))
  runValidatorCli("validate-foo", validate(model));
```

### A registry-driven codegen pipeline

```ts
// generate-systems.ts — one command runs every active system's generators
import { runSystemsGenerators } from "@ebowwa/codegen-kit";
import { SYSTEMS } from "./registry.js";

const { failed } = runSystemsGenerators(SYSTEMS, {
  packageRoot: PACKAGE_ROOT, repoRoot: REPO_ROOT, check: isCheck, verbose,
});
if (failed > 0) process.exit(1);
```

## Consumer

- **secondsee/node-codegen** — the system the kit was generalized from. 48 generators + 52 header-backed outputs + the full declarative systems registry, all on the kit.

## License

MIT.
