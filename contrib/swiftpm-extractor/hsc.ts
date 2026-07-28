// src/extractors/hsc.ts — extract the MECHANICAL catalog layer from a live
// HelloSwiftConsumables repo (Package.swift + Sources/). Pure: given a repo path,
// return the extracted data structure. The command (src/commands/extract-hsc.ts)
// writes/--checks generated/extracted-hsc.json.
//
// What is extracted (mechanical, authoritative): package name + platforms, every
// SwiftPM target (identity, type, language, path, dependency edges), external
// product deps, and source-grepped hints (modelId literals, // Tested: markers,
// stub markers). SEMANTIC facts (which primitive, consumes/produces, …) are NOT
// extracted — those stay human-authored and are merged in catalog/merge.ts.

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { Glob } from "bun";

export const HSC_REPOSITORY = "github.com/ebowwa/HelloSwiftConsumables";

export interface ExtractedPlatform {
  readonly platform: string;
  readonly version: string;
}
export interface ExtractedTarget {
  readonly name: string;
  readonly type: "regular" | "system" | "test";
  readonly language: "swift" | "c";
  readonly path: string;
  readonly dependencies: readonly string[]; // target refs (by target name)
  readonly externalDependencies: readonly { readonly product: string; readonly package: string }[];
  readonly grep: {
    readonly models: readonly string[];
    readonly testedMarker?: { readonly location: string; readonly summary: string; readonly timestamp?: string };
    readonly stubMarker: boolean;
  };
  readonly origin?: { readonly slug: string; readonly repository: string; readonly detail: string };
}
export interface ExtractedHsc {
  readonly package: {
    readonly name: string;
    readonly repository: string;
    readonly platforms: readonly ExtractedPlatform[];
  };
  readonly externalDependencies: readonly { readonly product: string; readonly package: string }[];
  readonly targets: readonly ExtractedTarget[];
}

// ── balanced-delimiter helpers ─────────────────────────────────────────────

/** Find the index of the bracket/paren matching the one at `open`. */
function matchClose(text: string, open: number, openCh: string, closeCh: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Extract the inner content of the `[ ... ]` array following `key:`. */
function arrayBlockAfter(text: string, key: string): string {
  const keyIdx = text.indexOf(key);
  if (keyIdx < 0) return "";
  const open = text.indexOf("[", keyIdx);
  if (open < 0) return "";
  const close = matchClose(text, open, "[", "]");
  if (close < 0) return "";
  return text.slice(open + 1, close);
}

/** Like arrayBlockAfter, but skips `key:` occurrences whose array doesn't contain
 *  `marker` — needed because e.g. `targets:` appears inside `.library(..., targets:)`
 *  before the real top-level `targets:` block. */
function arrayBlockContaining(text: string, key: string, marker: string): string {
  let from = 0;
  for (;;) {
    const idx = text.indexOf(key, from);
    if (idx < 0) return "";
    const open = text.indexOf("[", idx);
    if (open < 0) return "";
    const close = matchClose(text, open, "[", "]");
    if (close < 0) return "";
    const inner = text.slice(open + 1, close);
    if (inner.includes(marker)) return inner;
    from = close + 1;
  }
}

// ── block parsers ──────────────────────────────────────────────────────────

function parsePlatforms(block: string): ExtractedPlatform[] {
  const out: ExtractedPlatform[] = [];
  const re = /\.(iOS|macOS|tvOS|watchOS|visionOS)\((?:\.v)?(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push({ platform: m[1], version: m[2] });
  return out;
}

function splitTargetEntries(targetsBlock: string): { text: string; start: number }[] {
  // Each entry starts with `.target(` / `.systemLibrary(` / `.testTarget(` / `.executableTarget(`.
  const entries: { text: string; start: number }[] = [];
  const re = /\.(target|systemLibrary|testTarget|executableTarget)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(targetsBlock))) {
    const openParen = targetsBlock.indexOf("(", m.index + m[0].length - 1);
    const close = matchClose(targetsBlock, openParen, "(", ")");
    if (close < 0) break;
    entries.push({ text: targetsBlock.slice(m.index, close + 1), start: m.index });
    re.lastIndex = close + 1;
  }
  return entries;
}

/** Collect the `// ...` comment lines immediately preceding `start` (skipping blanks). */
function precedingComment(block: string, start: number): string {
  const before = block.slice(0, start);
  const lines = before.split("\n");
  const comments: string[] = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t.startsWith("//")) comments.unshift(t.replace(/^\/\/\s*/, ""));
    else if (t === "") continue;
    else break;
  }
  return comments.join(" ");
}

/** Parse an `Origin:` note into a project slug + repository + detail. */
function parseOrigin(comment: string): { slug: string; repository: string; detail: string } | undefined {
  const idx = comment.indexOf("Origin:");
  if (idx < 0) return undefined;
  const detail = comment.slice(idx + "Origin:".length).trim().replace(/^—\s*/, "").trim();
  const m = detail.match(/ebowwa\/([A-Za-z0-9][A-Za-z0-9_-]*)/);
  if (m) {
    return { slug: m[1], repository: `github.com/ebowwa/${m[1]}`, detail };
  }
  // No ebowwa/ path — derive a slug from the leading label.
  const label = detail.split(/[—;]/)[0].trim();
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  return { slug, repository: detail, detail };
}

function firstString(entry: string, key: string): string | undefined {
  const m = new RegExp(key + "\\s*:\\s*\"([^\"]+)\"").exec(entry);
  return m ? m[1] : undefined;
}

/** Parse a `dependencies: [ ... ]` value within a target entry. */
function parseDeps(entry: string): {
  targetRefs: string[];
  external: { product: string; package: string }[];
} {
  const depKey = entry.indexOf("dependencies");
  if (depKey < 0) return { targetRefs: [], external: [] };
  const open = entry.indexOf("[", depKey);
  if (open < 0) return { targetRefs: [], external: [] };
  const close = matchClose(entry, open, "[", "]");
  if (close < 0) return { targetRefs: [], external: [] };
  const inner = entry.slice(open + 1, close);
  const targetRefs: string[] = [];
  // Plain quoted target refs.
  const strRe = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = strRe.exec(inner))) targetRefs.push(m[1]);
  // External product refs: .product(name: "X", package: "Y").
  const external: { product: string; package: string }[] = [];
  const prodRe = /\.product\(\s*name\s*:\s*"([^"]+)"\s*,\s*package\s*:\s*"([^"]+)"/g;
  while ((m = prodRe.exec(inner))) external.push({ product: m[1], package: m[2] });
  // Filter out product names that leaked into targetRefs via the quoted-string scan.
  const extNames = new Set(external.map((e) => e.product));
  const filtered = targetRefs.filter((t) => !extNames.has(t));
  return { targetRefs: filtered, external };
}

// ── source grep ────────────────────────────────────────────────────────────

function grepTarget(repoPath: string, targetPath: string): ExtractedTarget["grep"] {
  const abs = resolve(repoPath, targetPath);
  const models = new Set<string>();
  let testedMarker: ExtractedTarget["grep"]["testedMarker"];
  let stubMarker = false;

  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return { models: [], stubMarker: false };
  }
  const glob = new Glob("**/*.swift");
  const files = glob.scanSync({ cwd: abs, absolute: true });
  for (const file of files) {
    let content = "";
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const loc = `${targetPath}/${relative(abs, file).split("/").join("/")}:${i + 1}`;
      // model ids: modelId: "x"  | defaultModel: "x" (conservative literal shapes)
      for (const re of [/modelId\s*:\s*"([^"]+)"/g, /defaultModel\s*:\s*"([^"]+)"/g]) {
        let mm: RegExpExecArray | null;
        while ((mm = re.exec(line))) models.add(mm[1]);
      }
      // tested marker
      if (!testedMarker && /\/\/\s*Tested:\s*(.*)/.test(line)) {
        const captured = line.match(/\/\/\s*Tested:\s*(.*)/)?.[1]?.trim() ?? "";
        const ts = captured.match(/(\d{4}-\d{2}-\d{2}T[^\s—]+)/)?.[1];
        testedMarker = { location: loc, summary: captured, timestamp: ts };
      }
      // stub marker: the explicit PREMATURE sentinel (used by the TextToSpeech stub).
      if (/\bPREMATURE\b/.test(line)) {
        stubMarker = true;
      }
    }
  }
  return { models: [...models], testedMarker, stubMarker };
}

// ── top-level extractor ────────────────────────────────────────────────────

export function extractHsc(repoPath: string): ExtractedHsc {
  const manifestPath = join(repoPath, "Package.swift");
  const text = readFileSync(manifestPath, "utf-8");

  const name = firstString(text, "name") ?? "HelloSwiftConsumables";
  const platforms = parsePlatforms(arrayBlockAfter(text, "platforms"));

  const productsBlock = arrayBlockContaining(text, "products", ".library");
  const extFromProducts: { product: string; package: string }[] = [];
  // (products don't carry external refs here; collected from targets instead)

  const targetsBlock = arrayBlockContaining(text, "targets", ".target");
  const entries = splitTargetEntries(targetsBlock);

  const externalSet = new Map<string, { product: string; package: string }>();
  const targets: ExtractedTarget[] = [];

  for (const { text: entry, start } of entries) {
    const tname = firstString(entry, "name");
    if (!tname) continue;
    const kind = entry.startsWith(".systemLibrary")
      ? "system"
      : entry.startsWith(".testTarget")
        ? "test"
        : "regular";
    const language: "swift" | "c" = kind === "system" || /\bc(Settings|xxSettings)\b/.test(entry) ? "c" : "swift";
    const path = firstString(entry, "path") ?? (kind === "test" ? `Tests/${tname}` : `Sources/${tname}`);
    const { targetRefs, external } = parseDeps(entry);
    const origin = parseOrigin(precedingComment(targetsBlock, start));
    for (const e of external) externalSet.set(e.product, e);
    const grep = kind === "test" ? { models: [], stubMarker: false } : grepTarget(repoPath, path);
    targets.push({ name: tname, type: kind, language, path, dependencies: targetRefs, externalDependencies: external, grep, origin });
  }

  // external package deps also appear in the top-level dependencies: [ .package(url:...) ]
  // — record their product names from target refs (already captured above).
  void productsBlock;
  void extFromProducts;

  return {
    package: { name, repository: HSC_REPOSITORY, platforms },
    externalDependencies: [...externalSet.values()],
    targets,
  };
}
