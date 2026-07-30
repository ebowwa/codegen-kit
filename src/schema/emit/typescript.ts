// @ebowwa/codegen-kit/schema — TypeScript source emitter.
//
// Pure functions that turn neutral IR declarations into TypeScript source.
// A TS "module" is a flat barrel of `export` statements — no wrapping object.
// Each member emitter returns its own `export ...` form; the module just
// joins them on blank lines.

import type {
  IRConstant,
  IRConstantSet,
  IRConstantMap,
  IRStruct,
  IREnum,
  IRResolverFn,
  IRTypeAlias,
  IRType,
  IRMember,
  IRModule,
} from "../ir.js";
import { toScreamingSnake } from "../naming.js";

// ─── Type + value mapping ─────────────────────────────────────────────────

function tsType(t: IRType): string {
  switch (t) {
    case "string":
      return "string";
    case "int":
      return "number";
    case "float":
      return "number";
    case "bool":
      return "boolean";
    case "bytes":
      return "Uint8Array";
    case "any":
      return "unknown";
    case "void":
      return "void";
  }
}

/** Escape a string for a TS double-quoted literal. */
function escTsString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Render an IR value as a TS literal for the given IR type. */
function tsLiteral(t: IRType, value: unknown): string {
  switch (t) {
    case "string":
      return `"${escTsString(String(value))}"`;
    case "int":
      return String(Number(value));
    case "float":
      return String(Number(value));
    case "bool":
      return value ? "true" : "false";
    case "bytes":
      return "new Uint8Array([])";
    case "any":
      return JSON.stringify(value);
    case "void":
      return "undefined";
  }
}

// ─── JSDoc ────────────────────────────────────────────────────────────────

function jsDoc(description?: string): string {
  return description ? `/** ${description} */\n` : "";
}

// ─── Member emitters ──────────────────────────────────────────────────────

export function emitTsInterface(s: IRStruct): string {
  const fields = s.fields
    .map((f) => {
      const opt = f.optional ? "?" : "";
      return `  ${f.name}${opt}: ${tsType(f.type)};`;
    })
    .join("\n");
  return `${jsDoc(s.description)}export interface ${s.name} {\n${fields}\n}`;
}

export function emitTsConstant(c: IRConstant): string {
  const name = toScreamingSnake(c.name);
  const value = tsLiteral(c.valueType, c.value);
  return `${jsDoc(c.description)}export const ${name} = ${value} as const;`;
}

export function emitTsTypeAlias(ta: IRTypeAlias): string {
  const cases = ta.cases.map((c) => `"${escTsString(c)}"`).join(" | ");
  return `${jsDoc(ta.description)}export type ${ta.name} = ${cases};`;
}

export function emitTsConstantSet(cs: IRConstantSet): string {
  const name = toScreamingSnake(cs.name);
  const values = cs.values.map((v) => `"${escTsString(v)}"`).join(", ");
  return `${jsDoc(cs.description)}export const ${name}: readonly string[] = [${values}];`;
}

export function emitTsConstantMap(cm: IRConstantMap): string {
  const name = toScreamingSnake(cm.name);
  const entries = Object.entries(cm.entries)
    .map(([k, v]) => `"${escTsString(k)}": "${escTsString(v)}"`)
    .join(", ");
  return `${jsDoc(cm.description)}export const ${name}: Record<string, string> = { ${entries} };`;
}

/**
 * Emit a TS resolver function.
 *
 * The `fallback` field selects the `default` branch: an empty string means
 * "identity" (return the input param, matching secondsee's
 * `resolveNodeType` pass-through convention); any other string is rendered
 * as a typed literal.
 */
export function emitTsResolver(r: IRResolverFn): string {
  const retType = tsType(r.returnType);
  const cases = Object.entries(r.lookupMap)
    .map(([k, v]) => `    case "${escTsString(k)}": return ${tsLiteral(r.returnType, v)};`)
    .join("\n");
  const defaultClause =
    r.fallback === ""
      ? `    default: return ${r.paramName};`
      : `    default: return ${tsLiteral(r.returnType, r.fallback)};`;
  return (
    `${jsDoc(r.description)}export function ${r.name}(${r.paramName}: string): ${retType} {\n` +
    `  switch (${r.paramName}) {\n${cases}\n${defaultClause}\n  }\n}`
  );
}

/** Internal: a TS enum is emitted as a string-union type alias. */
function emitTsEnumInternal(e: IREnum): string {
  const cases = e.cases.map((c) => `"${escTsString(c)}"`).join(" | ");
  return `${jsDoc(e.description)}export type ${e.name} = ${cases};`;
}

/** Dispatch a single member to its emitter (used by the module wrapper). */
export function emitTsMember(m: IRMember): string {
  switch (m.kind) {
    case "constant":
      return emitTsConstant(m);
    case "constant-set":
      return emitTsConstantSet(m);
    case "constant-map":
      return emitTsConstantMap(m);
    case "struct":
      return emitTsInterface(m);
    case "enum":
      return emitTsEnumInternal(m);
    case "type-alias":
      return emitTsTypeAlias(m);
    case "resolver":
      return emitTsResolver(m);
  }
}

// ─── Module emitter ───────────────────────────────────────────────────────

export function emitTsModule(ir: IRModule): string {
  const desc = jsDoc(ir.description);
  if (ir.members.length === 0) return desc.replace(/\n$/, "");
  const members = ir.members.map(emitTsMember).join("\n\n");
  return `${desc}${members}\n`;
}
