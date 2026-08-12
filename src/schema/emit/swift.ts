// @ebowwa/codegen-kit/schema/swift — Swift source emitter.
//
// Takes the neutral IR types from `../ir.ts` (IRModule + IRMember variants)
// and emits Swift source code byte-compatible with secondsee's existing
// hand-written Swift generators (e.g. swift-config-structs.ts).
//
// Case conversion happens when *building* the IR (name/jsonKey are already
// in the right case); this layer only maps IR types → Swift source and
// applies Swift keyword escaping via `escapeSwiftIdent`.

import type {
  IRType,
  IRField,
  IRStruct,
  IRConstant,
  IRConstantSet,
  IRConstantMap,
  IREnum,
  IRTypeAlias,
  IRResolverFn,
  IRMember,
  IRModule,
} from "../ir.js";
import { escapeSwiftIdent } from "../naming.js";

// ─── Type mapping ─────────────────────────────────────────────────────────

const SWIFT_TYPE: Record<IRType, string> = {
  string: "String",
  int: "Int",
  float: "Double",
  bool: "Bool",
  bytes: "Data",
  any: "Any",
  void: "Void",
  // Refs are resolved per-field via swiftFieldType(); this is the fallback when
  // a ref reaches a type-only context (e.g. resolver return type).
  ref: "Any",
};

function swiftType(t: IRType): string {
  return SWIFT_TYPE[t] ?? "Any";
}

/**
 * Render a struct field's Swift type, honouring named refs and arrays:
 * `DevicePlatform`, `[DevicePlatform]`, `[String]?`. `typeName` is required for
 * `ref` fields (otherwise the field degenerates to `Any`).
 */
function swiftFieldType(f: IRField): string {
  const base = f.type === "ref" ? (f.typeName ?? "Any") : swiftType(f.type);
  const arrayed = f.isArray ? `[${base}]` : base;
  return arrayed + (f.optional ? "?" : "");
}

// ─── Value formatting ─────────────────────────────────────────────────────

/** Format a literal Swift value for an init() default or constant initializer.
 *  Caller must ensure `raw` is defined (use swiftDefault() otherwise).
 *
 *  Float formatting uses `String(Number(raw))` (e.g. 1 → "1", 0.5 → "0.5")
 *  to byte-match secondsee's swift-config-structs generator, which formats
 *  float defaults via `String(Number(rawDefault))`. The language-level
 *  default for floats with no IR default remains "0.0" (see swiftDefault). */
function swiftValue(type: IRType, raw: unknown): string {
  switch (type) {
    case "string": return JSON.stringify(String(raw));
    case "int":    return String(Number(raw));
    case "float":  return String(Number(raw));
    case "bool":   return Boolean(raw) ? "true" : "false";
    case "bytes":  return JSON.stringify(String(raw));
    case "any":    return JSON.stringify(String(raw));
    case "void":   return "()";
    case "ref":    return String(raw);
  }
}

/** Language-level default for a Swift type, used when IRField.default is
 *  undefined and the field is non-optional. Matches the defaults documented
 *  in the spec: String→"", Double→0.0, Bool→false, plus sensible fallbacks
 *  for the remaining IR types. */
function swiftDefault(type: IRType): string {
  switch (type) {
    case "string": return '""';
    case "int":    return "0";
    case "float":  return "0.0";
    case "bool":   return "false";
    case "bytes":  return "Data()";
    case "any":    return '""';
    case "void":   return "()";
    case "ref":    return '""';
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────

/** Split a description into `///` doc-comment lines (no leading indentation).
 *  Empty/undefined descriptions produce no lines. */
function docLines(description?: string): string[] {
  if (!description) return [];
  return description.split("\n").map(l => `/// ${l}`);
}

/** Indent every non-empty line of `text` by `indent`. Empty lines stay empty
 *  (no trailing whitespace) — matches Swift convention inside nested blocks. */
function indentBlock(text: string, indent: string): string {
  return text
    .split("\n")
    .map(l => (l === "" ? "" : indent + l))
    .join("\n");
}

// ─── Constants ────────────────────────────────────────────────────────────

export function emitSwiftConstant(c: IRConstant): string {
  const lines = docLines(c.description);
  lines.push(
    `static let ${escapeSwiftIdent(c.name)}: ${swiftType(c.valueType)} = ${swiftValue(c.valueType, c.value)}`,
  );
  return lines.join("\n");
}

export function emitSwiftConstantSet(cs: IRConstantSet): string {
  const lines = docLines(cs.description);
  const values = cs.values.map(v => JSON.stringify(v)).join(", ");
  lines.push(`static let ${escapeSwiftIdent(cs.name)}: Set<String> = [${values}]`);
  return lines.join("\n");
}

export function emitSwiftConstantMap(cm: IRConstantMap): string {
  const lines = docLines(cm.description);
  const entries = Object.entries(cm.entries)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ");
  lines.push(`static let ${escapeSwiftIdent(cm.name)}: [String: String] = [${entries}]`);
  return lines.join("\n");
}

// ─── Enum ─────────────────────────────────────────────────────────────────

export function emitSwiftEnum(e: IREnum): string {
  const lines = docLines(e.description);
  const raw = e.rawValueType === "int" ? "Int" : "String";
  lines.push(`enum ${e.name}: ${raw} {`);
  if (e.rawValueType === "int") {
    e.cases.forEach((c, i) => {
      lines.push(`    case ${escapeSwiftIdent(c)} = ${i}`);
    });
  } else {
    for (const c of e.cases) {
      lines.push(`    case ${escapeSwiftIdent(c)}`);
    }
  }
  lines.push("}");
  return lines.join("\n");
}

// ─── Resolver ─────────────────────────────────────────────────────────────

export function emitSwiftResolver(r: IRResolverFn): string {
  const lines = docLines(r.description);
  const ret = swiftType(r.returnType);
  const isStr = r.returnType === "string";
  const fallback = isStr ? JSON.stringify(r.fallback) : r.fallback;
  const param = escapeSwiftIdent(r.paramName);
  lines.push(`static func ${escapeSwiftIdent(r.name)}(_ ${param}: String) -> ${ret} {`);
  lines.push(`    switch ${param} {`);
  for (const [k, v] of Object.entries(r.lookupMap)) {
    const rhs = isStr ? JSON.stringify(v) : v;
    lines.push(`    case ${JSON.stringify(k)}: return ${rhs}`);
  }
  lines.push(`    default: return ${fallback}`);
  lines.push("    }");
  lines.push("}");
  return lines.join("\n");
}

// ─── Type alias (internal — IR has the kind but the spec doesn't expose it) ─

function emitSwiftTypeAlias(ta: IRTypeAlias): string {
  const lines = docLines(ta.description);
  // With `rhs`, emit the alias verbatim. Otherwise IRTypeAlias.cases is a closed
  // set of string values whose Swift counterpart is a plain String alias (the
  // closed-set constraint isn't expressible in Swift without an enum).
  lines.push(`typealias ${ta.name} = ${ta.rhs ?? "String"}`);
  return lines.join("\n");
}

// ─── Struct ───────────────────────────────────────────────────────────────

export interface EmitSwiftStructOpts {
  /** Override the IR's emitCodingKeys at emit-time. */
  emitCodingKeys?: "always" | "when-needed";
  /** Override the IR's emitInit at emit-time. */
  emitInit?: boolean;
}

export function emitSwiftStruct(s: IRStruct, opts: EmitSwiftStructOpts = {}): string {
  const emitCodingKeys = opts.emitCodingKeys ?? s.emitCodingKeys;
  const emitInit = opts.emitInit ?? s.emitInit;
  const lines: string[] = [];

  // Header
  for (const dl of docLines(s.description)) lines.push(dl);
  const conf = s.conformance.length > 0 ? `: ${s.conformance.join(", ")}` : "";
  lines.push(`struct ${s.name}${conf} {`);

  // Blank line after `{` when there are fields — byte-matches secondsee's
  // swift-config-structs output.
  if (s.fields.length > 0) lines.push("");

  // Properties.
  for (const f of s.fields) {
    for (const dl of docLines(f.description)) {
      lines.push(`    ${dl}`);
    }
    lines.push(`    let ${escapeSwiftIdent(f.name)}: ${swiftFieldType(f)}`);
  }

  // CodingKeys: "always" → if there are any fields; "when-needed" → if any
  // field's escaped name differs from its jsonKey. The escaped-name compare
  // matches swift-config-structs.ts (keyword fields always get the explicit
  // `case `kw` = "kw"` form).
  const needsCK = emitCodingKeys === "always"
    ? s.fields.length > 0
    : s.fields.some(f => escapeSwiftIdent(f.name) !== f.jsonKey);

  if (needsCK) {
    lines.push("");
    lines.push("    enum CodingKeys: String, CodingKey {");
    for (const f of s.fields) {
      const escName = escapeSwiftIdent(f.name);
      if (escName === f.jsonKey) {
        lines.push(`        case ${escName}`);
      } else {
        lines.push(`        case ${escName} = "${f.jsonKey}"`);
      }
    }
    lines.push("    }");
  }

  // Init
  if (emitInit) {
    lines.push("");
    lines.push("    init(");
    const params = s.fields.map(f => {
      const def = f.default !== undefined
        ? swiftValue(f.type, f.default)
        : (f.optional ? "nil" : swiftDefault(f.type));
      return `        ${escapeSwiftIdent(f.name)}: ${swiftFieldType(f)} = ${def}`;
    });
    lines.push(params.join(",\n"));
    lines.push("    ) {");
    for (const f of s.fields) {
      const n = escapeSwiftIdent(f.name);
      lines.push(`        self.${n} = ${n}`);
    }
    lines.push("    }");
  }

  lines.push("}");
  return lines.join("\n");
}

// ─── Module ───────────────────────────────────────────────────────────────

export interface EmitSwiftModuleOpts {
  /** Indent applied to each member line. Defaults to 4 spaces. */
  indent?: string;
  /** Insert a blank line after `public enum <name> {` (before the first member). */
  blankLineAfterOpen?: boolean;
}

export function emitSwiftModule(ir: IRModule, opts: EmitSwiftModuleOpts = {}): string {
  const indent = opts.indent ?? "    ";
  const lines: string[] = [];

  for (const dl of docLines(ir.description)) lines.push(dl);
  lines.push(`public enum ${ir.name} {`);

  const bodyChunks: string[] = [];
  // Import members are TS-oriented and have no Swift form (see IRImport); drop
  // them here so they never reach emitMember.
  const emitMembers = ir.members.filter((m) => m.kind !== "import");
  emitMembers.forEach((m, i) => {
    if (i > 0) bodyChunks.push("");
    bodyChunks.push(emitMember(m));
  });

  if (bodyChunks.length > 0) {
    if (opts.blankLineAfterOpen) lines.push("");
    const body = bodyChunks.join("\n");
    for (const line of body.split("\n")) {
      lines.push(line === "" ? "" : indent + line);
    }
  }

  lines.push("}");
  return lines.join("\n");
}

// ─── Member dispatch ──────────────────────────────────────────────────────

function emitMember(m: IRMember): string {
  switch (m.kind) {
    case "constant":     return emitSwiftConstant(m);
    case "constant-set": return emitSwiftConstantSet(m);
    case "constant-map": return emitSwiftConstantMap(m);
    case "struct":       return emitSwiftStruct(m);
    case "enum":         return emitSwiftEnum(m);
    case "resolver":     return emitSwiftResolver(m);
    case "type-alias":   return emitSwiftTypeAlias(m);
    case "raw":          return m.text;
    // Unreachable: emitSwiftModule filters import members out before dispatch.
    case "import":       return "";
  }
}
