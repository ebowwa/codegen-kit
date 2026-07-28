# @ebowwa/codegen-kit

A framework for **declarative codegen** — declare your systems, generators, and validators; the kit runs them, checks for drift, and catches orphans. Extracted from secondsee's `node-codegen`, generalized for any repo.

`codegen-kit` is the control plane around code generators you already have. It turns a collection of one-off scripts into an explicit, testable pipeline: what the source of truth is, which scripts derive which files, how those outputs are validated, and whether the repository is still synchronized.

## Why this is useful

Generated code creates a dependency graph that most repositories leave implicit. Once a project has several generators, common failures include:

- A source schema changes, but one or more generated files are not regenerated.
- Generated Swift, TypeScript, JSON, documentation, or configuration silently disagree.
- CI can run generators, but cannot tell whether the committed output is stale.
- Generator scripts accumulate without a clear owner, target, or validation contract.
- Every generator reinvents file writing, `--check` behavior, diff output, provenance headers, and CLI handling.
- Renamed or deleted scripts remain referenced by an umbrella command until someone trips over them.

This kit makes those failures mechanical instead of organizational. It gives a repository:

- **Reproducible generation** — the same write/check behavior across every generator.
- **Drift enforcement in CI** — `--check` fails when committed generated files differ from current source inputs.
- **A visible system map** — each source, target, generator, validator, and lifecycle state is declared together.
- **Generator coverage** — unclaimed and missing scripts become detectable repository drift.
- **Shared validation plumbing** — validators return a common result shape and get consistent CLI behavior.
- **One pipeline as the repo grows** — run every active generator, validator, or supported fix from the registry.

A typical workflow is: edit the source of truth, run generation locally, commit the derived outputs, then run the same generators in check mode in CI. If someone forgets an output or adds a generator outside the registry, the build fails with the specific drift instead of shipping inconsistent code.

## What it does — and does not do

`codegen-kit` does **not** define your schema, render Swift or TypeScript, or decide what your generated code should look like. Your repository owns that domain logic. The kit standardizes the surrounding lifecycle: generation, checking, validation, orchestration, provenance, and coverage.

It is most useful when a repository has multiple generated targets, cross-language representations, committed generated artifacts, or enough generator scripts that ownership is no longer obvious. For a single disposable script with no committed output, it may be unnecessary.

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
