# Examples

Four runnable demos — one per kit layer, plus the `registerProbe` extensibility story. Each is
self-contained and exits 0 as a showcase (the "broken" fixtures are *expected* to fail their
checks; the demos catch that and report it).

```bash
bun run demo            # all four, in order
bun run demo:shapes     # Layer 4 — shapes: declare an architecture, check it
bun run demo:codegen    # Layer 1 — primitives: write / --check / drift loop
bun run demo:probe      # extensibility — register a custom probe
bun run demo:systems    # Layer 2 — systems framework: walk a declarative registry
```

> **Local source barrel.** These demos import the kit from the local `src/` barrel
> (`from "../src/index.js"`) so they run against the code in this repo. A real consumer
> `npm install @ebowwa/codegen-kit` and imports by name: `from "@ebowwa/codegen-kit"`.

## demos

### `shapes-demo.ts` — declare an architecture, then prove it holds

Declares a `ShapeContract` for a tiny ordinal service (`handlers → domain → db`, a gated email
sender, an isolated `ai` layer) with five invariants — one per built-in probe (`no-cycles`,
`layer-rules`, `symbol-isolation`, `gate-coverage`, `fingerprint`). Runs `runShapesChecks` over
the **clean** fixture (all green) then the **broken** twin (all red — every probe catches its
violation). This is the headline: architecture as checkable data.

### `codegen-demo.ts` — the write / check / drift loop

Layer 1 primitives in isolation: build a `commentHeader`-stamped generated file, `writeOrCheck`
it, re-run in `--check` (clean → returns), then tamper the file and show the diff
`--check` would catch. Demonstrates *why* `strip: stripVolatile` pairs with `--check`: the
`Build:`/`Generated:` provenance line is volatile, and stripping it keeps checks stable across
git-sha / version / timestamp changes.

### `custom-probe-demo.ts` — the kit is extensible

Defines a domain probe (`no-eval`: fail any scanned module that calls `eval()`), registers it with
`registerProbe("no-eval", probe)` at import time, then references it **by name** in a contract.
Runs over the clean fixture (green) and the broken one (red — `ai.ts` calls `eval()`). Same
pattern site-surveys uses for its `runtime-mcp-isolation` probe: consumer-defined invariants sit
beside the five built-ins in one registry.

### `systems-demo.ts` — walk a declarative registry

Declares `SYSTEMS: SystemContract[]` with one active system, then calls
`runSystemsGenerators` (write), `runSystemsValidators` (run the validator), and
`runSystemsGenerators` again in `--check` (drift mode). The generator and validator under
`fixtures/systems/` are real `.ts` scripts run as `bun run` subprocesses — exactly the
"Registry-driven codegen pipeline" snippet from the root README, made end-to-end runnable.

## fixtures

Committed under `fixtures/` because `shapes` scans source via `git ls-files` (tracked files
only) — untracked fixtures would produce an empty module graph.

```
fixtures/
  shop-clean/     # 6-file "service": acyclic, layered, gated send, isolated ai — all green
  shop-broken/    # same service, deliberately broken: cycle + ungated send + ai→db + eval
  systems/        # generator + validator + source model for the systems demo
```

`shop-clean` and `shop-broken` share identical file names and layering; the broken twin carries
a `⚠️ DEMO: intentionally broken` comment on each modified file. One violation per probe, no
overlaps, so the demo output maps cleanly onto the contract's invariants.
