// @ebowwa/codegen-kit/schema — Kotlin source emitter.
//
// Pure functions that turn neutral IR declarations into Kotlin source. Each
// emitter reproduces the exact byte shape secondsee's hand-written generators
// produced (object/const-val/data-class/enum/when-resolver), so codegen output
// is diff-stable across runs.
//
// Members are emitted in their standalone form (no leading indentation); the
// module wrapper indents each member by 4 spaces when assembling an `object`.

import type {
  IRConstant,
  IRConstantSet,
  IRConstantMap,
  IRStruct,
  IREnum,
  IRResolverFn,
  IRTypeAlias,
  IRType,
  IRField,
  IRMember,
  IRModule,
} from "../ir.js";
import { escapeKotlinIdent, toScreamingSnake } from "../naming.js";

// ─── Type + value mapping ─────────────────────────────────────────────────

function ktType(t: IRType): string {
  switch (t) {
    case "string":
      return "String";
    case "int":
      return "Int";
    case "float":
      return "Double";
    case "bool":
      return "Boolean";
    case "bytes":
      return "ByteArray";
    case "any":
      return "Any";
    case "void":
      return "Unit";
  }
}

/** Escape a string for a Kotlin double-quoted literal. */
function escKtString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/** Format a number as a Kotlin Double literal (always at least one decimal digit). */
function formatDouble(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  const s = String(n);
  return /[.eE]/.test(s) ? s : `${s}.0`;
}

/** Best-effort Kotlin literal for an `any`-typed value (objects fall back to Unit). */
function ktAnyLiteral(value: unknown): string {
  if (typeof value === "string") return `"${escKtString(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isInteger(value) ? `${value}.0` : `${value}`;
  return "Unit";
}

/** Render an IR value as a Kotlin literal for the given IR type. */
function ktLiteral(t: IRType, value: unknown): string {
  switch (t) {
    case "string":
      return `"${escKtString(String(value))}"`;
    case "int":
      return String(Number(value));
    case "float":
      return formatDouble(Number(value));
    case "bool":
      return value ? "true" : "false";
    case "bytes":
      return "byteArrayOf()";
    case "any":
      return ktAnyLiteral(value);
    case "void":
      return "Unit";
  }
}

/** Render a struct field's default clause (` = <literal>`) or null if none. */
function ktFieldDefault(field: IRField): string | null {
  if (field.optional) {
    return field.default === undefined ? "null" : ktLiteral(field.type, field.default);
  }
  return field.default === undefined ? null : ktLiteral(field.type, field.default);
}

// ─── KDoc ─────────────────────────────────────────────────────────────────

function kDoc(description?: string): string {
  if (!description) return "";
  const lines = description.split("\n");
  // Single-line descriptions render inline (`/** ... */`); multi-line ones get
  // the proper one-`*`-per-line form. Mirrors the Swift emitter's docLines().
  if (lines.length <= 1) return `/** ${description} */\n`;
  const body = lines.map((l) => ` * ${l}`).join("\n");
  return `/**\n${body}\n */\n`;
}

// ─── Indentation (preserves blank lines as blank) ────────────────────────

function indentLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : prefix + line))
    .join("\n");
}

// ─── Member emitters ──────────────────────────────────────────────────────

export function emitKotlinDataClass(s: IRStruct): string {
  const fields = s.fields
    .map((f) => {
      const name = escapeKotlinIdent(f.name);
      const optMark = f.optional ? "?" : "";
      const def = ktFieldDefault(f);
      const defPart = def === null ? "" : ` = ${def}`;
      return `    val ${name}: ${ktType(f.type)}${optMark}${defPart}`;
    })
    .join(",\n");
  return `${kDoc(s.description)}data class ${s.name}(\n${fields}\n)`;
}

export function emitKotlinConstant(c: IRConstant): string {
  const name = toScreamingSnake(c.name);
  const value = ktLiteral(c.valueType, c.value);
  return `${kDoc(c.description)}const val ${name}: ${ktType(c.valueType)} = ${value}`;
}

export function emitKotlinConstantSet(cs: IRConstantSet): string {
  const name = toScreamingSnake(cs.name);
  const values = cs.values.map((v) => `"${escKtString(v)}"`).join(", ");
  return `${kDoc(cs.description)}val ${name}: Set<String> = setOf(${values})`;
}

export function emitKotlinConstantMap(cm: IRConstantMap): string {
  const name = toScreamingSnake(cm.name);
  const entries = Object.entries(cm.entries)
    .map(([k, v]) => `"${escKtString(k)}" to "${escKtString(v)}"`)
    .join(", ");
  return `${kDoc(cm.description)}val ${name}: Map<String, String> = mapOf(${entries})`;
}

export function emitKotlinEnum(e: IREnum): string {
  const rawType = ktType(e.rawValueType === "string" ? "string" : "int");
  const cases = e.cases
    .map((c, i) => {
      const caseName = toScreamingSnake(c);
      const raw = e.rawValueType === "string" ? `"${escKtString(c)}"` : String(i);
      return `    ${caseName}(${raw})`;
    })
    .join(",\n");
  return `${kDoc(e.description)}enum class ${e.name}(val value: ${rawType}) {\n${cases}\n}`;
}

/**
 * Emit a Kotlin resolver function.
 *
 * The `fallback` field selects the `else` branch: an empty string means
 * "identity" (return the input param, matching secondsee's
 * `TYPE_ALIASES[nodeType] ?: nodeType` convention); any other string is
 * rendered as a typed literal.
 */
export function emitKotlinResolver(r: IRResolverFn): string {
  const retType = ktType(r.returnType);
  const cases = Object.entries(r.lookupMap)
    .map(([k, v]) => `        "${escKtString(k)}" -> ${ktLiteral(r.returnType, v)}`)
    .join("\n");
  const elseClause =
    r.fallback === ""
      ? `        else -> ${r.paramName}`
      : `        else -> ${ktLiteral(r.returnType, r.fallback)}`;
  return (
    `${kDoc(r.description)}fun ${r.name}(${r.paramName}: String): ${retType} {\n` +
    `    return when (${r.paramName}) {\n${cases}\n${elseClause}\n    }\n}`
  );
}

/** Internal: Kotlin has no string-union, so a type alias degrades to `String`. */
function emitKotlinTypeAliasInternal(ta: IRTypeAlias): string {
  return `${kDoc(ta.description)}typealias ${ta.name} = String`;
}

/** Dispatch a single member to its emitter (used by the module wrapper). */
export function emitKotlinMember(m: IRMember): string {
  switch (m.kind) {
    case "constant":
      return emitKotlinConstant(m);
    case "constant-set":
      return emitKotlinConstantSet(m);
    case "constant-map":
      return emitKotlinConstantMap(m);
    case "struct":
      return emitKotlinDataClass(m);
    case "enum":
      return emitKotlinEnum(m);
    case "resolver":
      return emitKotlinResolver(m);
    case "type-alias":
      return emitKotlinTypeAliasInternal(m);
    case "raw":
      return m.text;
  }
}

// ─── Module emitter ───────────────────────────────────────────────────────

export interface KotlinModuleOpts {
  /** Emits a `package <name>` line at the top when set. */
  package?: string;
  /** Insert a blank line after `object <name> {` (before the first member). */
  blankLineAfterOpen?: boolean;
}

export function emitKotlinModule(ir: IRModule, opts: KotlinModuleOpts = {}): string {
  const members = ir.members
    .map((m) => indentLines(emitKotlinMember(m), "    "))
    .join("\n\n");
  const pkgLine = opts.package ? `package ${opts.package}\n\n` : "";
  const openGap = opts.blankLineAfterOpen ? "\n" : "";
  const body = members ? `\n${openGap}${members}\n` : "\n";
  return `${pkgLine}${kDoc(ir.description)}object ${ir.name} {${body}}\n`;
}
