# @ebowwa/codegen-kit

Shared **generate / validate / check** scaffolding for codegen — the generalized form of SecondSee's `node-codegen` machinery, extracted so any repo can use it.

Domain-agnostic. A consumer declares its own generators + validators on top; the kit provides the mechanical loop:

- **`writeOrCheck(path, content, {check, strip})`** — write a file, or fail (exit 1) if the committed copy is stale. The `--check` drift primitive.
- **`autogenMeta` / `buildNumber` / `stripVolatile`** — provenance stamps + volatile-token stripping (consumer-agnostic: reads the consumer's own `package.json` via `process.cwd()`).
- **`runValidatorCli` / `newResult` / `isMainEntry`** + `ValidateResult` / `ValidationError` — a validator is a pure function returning a `ValidateResult`; the CLI flags (`--verbose`/`--json`/`--fix`) and exit semantics live in the kit.
- **`runUmbrella(commands, {cwd})`** — run a list of checks, each in its own process; returns whether all passed.

## Install

```
"@ebowwa/codegen-kit": "github:ebowwa/codegen-kit"
```

## Use

```ts
import { writeOrCheck, stripVolatile, runValidatorCli, newResult, isMainEntry, runUmbrella } from "@ebowwa/codegen-kit";

// a generator
writeOrCheck(OUT_PATH, generateFoo(model), { check: isCheck, strip: stripVolatile });

// a validator
export function validate(m) { const r = newResult(...); /* push errors */ return r; }
if (isMainEntry(import.meta.url, "my-validator.ts")) runValidatorCli("my-validator", validate(model));
```

## Consumers
- `HelloEbowwaOntology` — semantic catalog (JSON / Markdown / Mermaid / Swift generators + 5 validators).
- `secondsee/packages/tsx/node-codegen` — the system the kit was generalized from.

MIT.
