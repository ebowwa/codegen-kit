// @ebowwa/codegen-kit — declarative systems registry framework.
//
// A "system" is a declarative unit of codegen: a source of truth, derived
// outputs, generators that produce them, validators that check them, and a
// lifecycle status. Consumers declare their systems; the kit provides the
// runners that walk the registry.
//
// Extracted from secondsee/node-codegen's SystemContract pattern. The domain-
// specific data (which systems exist, what scripts they declare) stays with
// each consumer; this module provides the framework.

import { execSync } from "node:child_process";
import { resolve, relative, basename } from "node:path";
import { readdirSync, existsSync } from "node:fs";

// ─── Types ─────────────────────────────────────────────────────────────────

export type SystemStatus = "planned" | "active" | "legacy";

export interface SystemTarget {
  lang: string;
  path: string;
  description: string;
}

export interface GeneratorSpec {
  name: string;
  script: string;
  description: string;
}

export interface SystemValidator {
  name: string;
  script: string;
  description: string;
  supportsFix?: boolean;
}

export interface SystemContract {
  name: string;
  description: string;
  source: string;
  targets: SystemTarget[];
  generators: GeneratorSpec[];
  validators: SystemValidator[];
  status: SystemStatus;
  notes?: string;
}

// ─── Registry helpers (operate on a passed-in array) ───────────────────────

export function getSystem(systems: readonly SystemContract[], name: string): SystemContract | undefined {
  return systems.find((s) => s.name === name);
}

export function getSystemsByStatus(systems: readonly SystemContract[], status: SystemStatus): SystemContract[] {
  return systems.filter((s) => s.status === status);
}

export function getActiveSystems(systems: readonly SystemContract[]): SystemContract[] {
  return getSystemsByStatus(systems, "active");
}

// ─── Shared runner options ─────────────────────────────────────────────────

export interface SystemsRunnerOpts {
  /** Package root (cwd for `bun run` invocations). */
  packageRoot: string;
  /** Repo root (where script paths are relative to). */
  repoRoot: string;
  verbose?: boolean;
}

export interface StepResult {
  system: string;
  name: string;
  script: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

// ─── Systems generator runner (walks generators[]) ─────────────────────────

export interface GenerateSystemsOpts extends SystemsRunnerOpts {
  /** Pass --check to each generator (drift mode). */
  check?: boolean;
}

export interface GenerateSystemsResult {
  results: StepResult[];
  passed: number;
  failed: number;
}

function runScript(
  script: string,
  opts: { packageRoot: string; repoRoot: string; verbose?: boolean; args?: string },
): Omit<StepResult, "system" | "name" | "script"> {
  const start = performance.now();
  const scriptAbs = resolve(opts.repoRoot, script);
  const scriptRel = relative(opts.packageRoot, scriptAbs);
  try {
    execSync(`bun run ${scriptRel}${opts.args ?? ""}`, {
      cwd: opts.packageRoot,
      encoding: "utf-8",
      timeout: 60_000,
      stdio: opts.verbose ? "inherit" : "pipe",
    });
    return { success: true, durationMs: performance.now() - start };
  } catch (err: any) {
    const stderr = err?.stderr || err?.message || String(err);
    return {
      success: false,
      durationMs: performance.now() - start,
      error: stderr.split("\n").slice(-5).join("\n"),
    };
  }
}

/** Walk active systems' generators[] and run each. Returns results (does not exit). */
export function runSystemsGenerators(
  systems: readonly SystemContract[],
  opts: GenerateSystemsOpts,
): GenerateSystemsResult {
  const active = getActiveSystems(systems);
  const args = opts.check ? " --check" : "";
  const results: StepResult[] = [];

  console.log(`${active.length} active system(s), ${active.reduce((n, s) => n + s.generators.length, 0)} generator(s)\n`);

  for (const system of active) {
    console.log(`▸ ${system.name} (${system.generators.length} generators)`);
    for (const gen of system.generators) {
      const r = runScript(gen.script, { ...opts, args });
      results.push({ system: system.name, name: gen.name, script: gen.script, ...r });
      if (r.success) {
        if (opts.verbose) console.log(`  ✓ ${gen.name} (${Math.round(r.durationMs)}ms)`);
        else process.stdout.write("  ✓");
      } else {
        console.log(`\n  ✗ ${gen.name} FAILED (${Math.round(r.durationMs)}ms)`);
        if (r.error) console.log(`    ${r.error.split("\n").join("\n    ")}`);
      }
    }
    if (!opts.verbose) console.log("");
  }

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`--- Results ---\nPassed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`\nFailed generators:`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  ✗ ${r.system}/${r.name}\n    script: ${r.script}`);
    }
  }
  return { results, passed, failed };
}

// ─── Systems validator runner (walks validators[]) ─────────────────────────

export interface ValidateSystemsResult {
  results: StepResult[];
  passed: number;
  failed: number;
}

/** Walk active systems' validators[] and run each. Returns results (does not exit). */
export function runSystemsValidators(
  systems: readonly SystemContract[],
  opts: SystemsRunnerOpts,
): ValidateSystemsResult {
  const active = getActiveSystems(systems);
  const results: StepResult[] = [];

  const totalValidators = active.reduce((n, s) => n + s.validators.length, 0);
  console.log(`${active.length} active system(s), ${totalValidators} validator(s)\n`);

  for (const system of active) {
    if (system.validators.length === 0) continue;
    console.log(`▸ ${system.name} (${system.validators.length} validators)`);
    for (const val of system.validators) {
      const r = runScript(val.script, opts);
      results.push({ system: system.name, name: val.name, script: val.script, ...r });
      if (r.success) {
        if (opts.verbose) console.log(`  ✓ ${val.name} (${Math.round(r.durationMs)}ms)`);
        else process.stdout.write("  ✓");
      } else {
        console.log(`\n  ✗ ${val.name} FAILED (${Math.round(r.durationMs)}ms)`);
        if (r.error) console.log(`    ${r.error.split("\n").join("\n    ")}`);
      }
    }
    if (!opts.verbose) console.log("");
  }

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`--- Results ---\nPassed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`\nFailed validators:`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  ✗ ${r.system}/${r.name}\n    script: ${r.script}`);
    }
  }
  return { results, passed, failed };
}

// ─── Systems fix runner (walks validators[] with supportsFix) ──────────────

export interface FixSystemsResult {
  results: StepResult[];
  passed: number;
  failed: number;
}

/** Walk active systems' validators[] where supportsFix === true, run each with --fix. */
export function runSystemsFix(
  systems: readonly SystemContract[],
  opts: SystemsRunnerOpts,
): FixSystemsResult {
  const active = getActiveSystems(systems);
  const fixable = active.flatMap((s) =>
    s.validators
      .filter((v) => v.supportsFix)
      .map((v) => ({ system: s.name, name: v.name, script: v.script })),
  );

  console.log(`${fixable.length} fixable validator(s)\n`);

  const results: StepResult[] = [];
  for (const fix of fixable) {
    const r = runScript(fix.script, { ...opts, args: " --fix" });
    results.push({ system: fix.system, name: fix.name, script: fix.script, ...r });
    if (r.success) {
      if (opts.verbose) console.log(`  ✓ ${fix.name} (${Math.round(r.durationMs)}ms)`);
      else process.stdout.write("✓");
    } else {
      console.log(`\n  ✗ ${fix.name} FAILED (${Math.round(r.durationMs)}ms)`);
      if (r.error) console.log(`    ${r.error.split("\n").join("\n    ")}`);
    }
  }
  if (!opts.verbose && results.length > 0) console.log("");

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`--- Results ---\nPassed: ${passed}/${results.length}`);
  if (failed > 0) {
    console.log(`\nFailed fixes:`);
    for (const r of results.filter((r) => !r.success)) {
      console.log(`  ✗ ${r.system}/${r.name}\n    script: ${r.script}`);
    }
  }
  return { results, passed, failed };
}

// ─── Coverage (orphan detection) ───────────────────────────────────────────

export interface CoverageOpts {
  commandsDir: string;
  repoRoot: string;
  metaGenerators: readonly string[];
  acknowledgedOrphans?: Readonly<Record<string, string>>;
}

export interface CoverageReport {
  totalScripts: number;
  claimed: string[];
  meta: string[];
  acknowledged: Array<{ filename: string; intendedSystem: string }>;
  drift: string[];
  hasDrift: boolean;
}

/** Compute coverage: every generate-*.ts script must be claimed, meta, or acknowledged. */
export function computeCoverage(systems: readonly SystemContract[], opts: CoverageOpts): CoverageReport {
  const allScripts = readdirSync(opts.commandsDir)
    .filter((f) => f.startsWith("generate-") && f.endsWith(".ts"))
    .sort();

  const claimed = new Set<string>();
  for (const system of systems) {
    for (const gen of system.generators) claimed.add(basename(gen.script));
  }

  const claimedScripts: string[] = [];
  const meta: string[] = [];
  const acknowledged: Array<{ filename: string; intendedSystem: string }> = [];
  const drift: string[] = [];

  for (const filename of allScripts) {
    if (claimed.has(filename)) {
      claimedScripts.push(filename);
    } else if (opts.metaGenerators.includes(filename)) {
      meta.push(filename);
    } else if (opts.acknowledgedOrphans && filename in opts.acknowledgedOrphans) {
      acknowledged.push({ filename, intendedSystem: opts.acknowledgedOrphans[filename] });
    } else {
      drift.push(filename);
    }
  }

  return {
    totalScripts: allScripts.length,
    claimed: claimedScripts.sort(),
    meta: meta.sort(),
    acknowledged: acknowledged.sort((a, b) => a.filename.localeCompare(b.filename)),
    drift: drift.sort(),
    hasDrift: drift.length > 0,
  };
}

/** Verify that every script referenced in the registry actually exists on disk. */
export function findMissingClaimedScripts(
  systems: readonly SystemContract[],
  repoRoot: string,
): string[] {
  const missing: string[] = [];
  for (const system of systems) {
    for (const gen of system.generators) {
      if (!existsSync(resolve(repoRoot, gen.script))) {
        missing.push(`${system.name} → ${gen.name} (${gen.script})`);
      }
    }
  }
  return missing;
}
