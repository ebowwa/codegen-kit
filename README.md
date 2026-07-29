# @ebowwa/codegen-kit

A framework for **declarative codegen** — declare your systems, generators, and validators; the kit runs them, checks for drift, catches orphans, manages packages, and detects breaking changes. Extracted from secondsee's `node-codegen`, generalized for any repo.

## Install

```
npm install @ebowwa/codegen-kit
```

Requires Node 18+ or Bun 1.3+. Ships compiled JS + TypeScript declarations.

## Building from source

```bash
git clone https://github.com/ebowwa/codegen-kit
cd codegen-kit
bun install
bun run build       # tsc → dist/
bun test            # full test suite
```

## Architecture

Three layers, each building on the previous:

### Layer 1 — Primitives

The mechanical building blocks for file I/O, headers, and CLI handling:

| Function | Purpose |
|---|---|
| `writeOrCheck(path, content, {check, strip})` | Write a file, or fail if the committed copy is stale |
| `writeOrCheckMany(entries, {check, strip, diffLines})` | Multi-file: checks all, shows per-file diff on drift |
| `patchOrCheck(path, transform, {check, skipIfMissing})` | In-place file mutation with structural change reporting |
| `scaffoldFiles(entries, {dryRun})` | Collision-safe file creation with preflight, backup, and rollback |
| `commentHeader({runCommand, by, source, prefix})` | `//` block autogen header |
| `jsdocHeader({runCommand, by, source})` | `/** */` JSDoc autogen header |
| `buildNumber()` | `semver+sha` provenance stamp |
| `stripVolatile(s)` | Case-insensitive drift stripping (JSON + comment forms) |
| `diffLines(a, b, max)` | Pure line-by-line diff helper |
| `runValidatorCli(name, result)` | Validator CLI harness (`--verbose`/`--json`/`--fix`) |
| `newResult(entityCount, claimCount)` | Mutable error/warning builder |
| `isMainEntry(importMetaUrl, file)` | Import.meta entry-point guard |
| `runUmbrella(commands, {cwd})` | Subprocess runner for umbrellas |

### Layer 2 — Systems framework

Declare your codegen systems as data; the kit walks them:

```ts
const SYSTEMS: SystemContract[] = [
  {
    name: "my-types",
    description: "Type definitions shared across platforms.",
    source: "src/types.ts",
    targets: [{ lang: "swift", path: "dist/Types.swift", description: "iOS types" }],
    generators: [{ name: "swift", script: "src/commands/generate-swift.ts", description: "Swift types" }],
    validators: [{ name: "bijection", script: "src/validators/check-bijection.ts", description: "Cross-language parity" }],
    status: "active",
  },
];
```

| Function | Purpose |
|---|---|
| `runSystemsGenerators(systems, {packageRoot, repoRoot, check, verbose})` | Walk active systems' `generators[]` |
| `runSystemsValidators(systems, {packageRoot, repoRoot, verbose})` | Walk active systems' `validators[]` |
| `runSystemsFix(systems, {packageRoot, repoRoot, verbose})` | Walk validators with `supportsFix` |
| `computeCoverage(systems, {commandsDir, repoRoot, metaGenerators, acknowledgedOrphans})` | 4-bucket orphan detection |
| `findMissingClaimedScripts(systems, repoRoot)` | Verify registry scripts exist |
| `getSystem` / `getActiveSystems` / `getSystemsByStatus` | Registry helpers |

### Layer 3 — Package management, reporting, snapshots

| Module | Functions |
|---|---|
| **Registry reporting** | `renderSystemsReference`, `renderSystemsGraph` |
| **Snapshot engine** | `diffSnapshots`, `writeSnapshot`, `readSnapshot`, `renderMigrationChangelog`, `writeMigrationChangelog` |
| **Package manager** | `generateAllPackageJsons`, `checkAllPackageJsons`, `createInternalResolver`, `runPackageManagerCli` |
| **Dep drift** | `checkDepDrift`, `fixDepDrift`, `regenerateLockfiles`, `runDepSyncCli` |
| **Version discovery** | `discoverInternalVersions`, `SKIP_DIRS` |
| **Package graph** | `buildPackageGraph`, `validateBuildOrder`, `validateLayerRules`, `generateCIMatrix`, `generatePackageGraphJson`, `generatePackageGraphMd`, `findCriticalPath`, `classifyLayer` |

## Usage examples

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

### Policy-driven breaking-change detection

```ts
import { diffSnapshots, renderMigrationChangelog } from "@ebowwa/codegen-kit";

const result = diffSnapshots(opts, oldSnapshot, newSnapshot);
if (result.hasBreaking) {
  console.error(renderMigrationChangelog(result));
  process.exit(1);
}
```

### Registry-driven codegen pipeline

```ts
import { runSystemsGenerators } from "@ebowwa/codegen-kit";
import { SYSTEMS } from "./registry.js";

const { failed } = runSystemsGenerators(SYSTEMS, {
  packageRoot: PACKAGE_ROOT, repoRoot: REPO_ROOT, check: isCheck,
});
if (failed > 0) process.exit(1);
```

## Consumer

- **secondsee/node-codegen** (`dev` branch) — 48 generators + 52 header-backed outputs + full declarative systems registry + all validators + package management, on the kit. Not yet merged to `prod`.

## License

MIT.
