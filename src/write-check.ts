// @ebowwa/codegen-kit — the write-vs-check primitive every generator uses.
// Collapses the ~40-line write/--check/diff boilerplate down to one call.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write `content` to `path`, or — in check mode — fail (exit 1) if the committed
 * file is missing or out of sync. `strip` removes volatile tokens (timestamps,
 * build shas) before comparing; defaults to identity.
 */
export function writeOrCheck(
  path: string,
  content: string,
  opts: { check?: boolean; strip?: (s: string) => string } = {},
): void {
  const check = opts.check ?? false;
  const strip = opts.strip ?? ((s: string) => s);

  if (check) {
    if (!existsSync(path)) {
      console.error(`FAIL: ${path} does not exist. Run \`bun run generate\` first.`);
      process.exit(1);
    }
    if (strip(readFileSync(path, "utf-8")) !== strip(content)) {
      console.error(`FAIL: ${path} is out of sync with its source.\n\nRun: bun run generate`);
      process.exit(1);
    }
    console.log(`OK: ${path} up to date.`);
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
  console.log(`Generated → ${path}`);
}
