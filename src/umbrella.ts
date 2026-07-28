// @ebowwa/codegen-kit — subprocess umbrella runner.
// Runs a list of `bun run <script>` commands (e.g. drift checks + validators),
// each in its own process, and returns whether all succeeded. Mirrors SecondSee's
// check-all.ts pattern, generalized.

import { execSync } from "node:child_process";

/** Run each command (stdio inherited). Returns true iff all exited 0. */
export function runUmbrella(commands: readonly string[], opts: { cwd: string }): boolean {
  let ok = true;
  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: "inherit", cwd: opts.cwd });
    } catch {
      ok = false;
    }
  }
  return ok;
}
