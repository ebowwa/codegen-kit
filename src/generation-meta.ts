// @ebowwa/codegen-kit — generation provenance + drift stripping.
// Consumer-agnostic: reads the CONSUMER's package.json from process.cwd() so the
// build stamp reflects whichever repo is generating, not this kit.

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

function readCwdVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("package.json", `file://${process.cwd()}/`), "utf-8"));
    return (pkg?.version as string | undefined) ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/** ISO 8601 timestamp captured at module load. Volatile — stripped before --check diffs. */
export const generationTimestamp: string = new Date().toISOString();

/** `<consumerVersion>+<git-sha>`. Volatile. */
export function buildNumber(): string {
  return `${readCwdVersion()}+${gitShortSha()}`;
}

export interface AutogenMeta {
  readonly notice: string;
  readonly build: string;
  readonly generated: string;
  readonly source?: string;
  readonly regenerate: string;
}

/** Provenance object to embed as `_autogen` in a generated JSON artifact. */
export function autogenMeta(runCommand: string, source?: string): AutogenMeta {
  return {
    notice: "AUTO-GENERATED — do not edit manually.",
    build: buildNumber(),
    generated: generationTimestamp,
    source,
    regenerate: runCommand,
  };
}

/** Strip volatile provenance tokens before diffing, across JSON and comment formats.
 *  Handles `"build": "..."` / `"generated": "..."` (JSON) and `build: x` / `generated: x` (comments). */
export function stripVolatile(s: string): string {
  return s
    .replace(/"generated":\s*"[^"]*"/g, '"generated": "<STRIPPED>"')
    .replace(/"build":\s*"[^"]*"/g, '"build": "<STRIPPED>"')
    .replace(/\bgenerated: \S+/g, "generated: <STRIPPED>")
    .replace(/\bbuild: \S+/g, "build: <STRIPPED>");
}
