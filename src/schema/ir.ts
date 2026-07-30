// @ebowwa/codegen-kit/schema — neutral intermediate representation.
//
// Language-agnostic types that describe declarations (constants, sets, maps,
// structs, enums, type aliases, resolver functions, imports, raw blocks) in a
// form that any per-language emitter (Swift, Kotlin, TypeScript) can consume.

// ─── Type system ──────────────────────────────────────────────────────────

export type IRType = "string" | "int" | "float" | "bool" | "bytes" | "any" | "void" | "ref";

// ─── Members ──────────────────────────────────────────────────────────────

export interface IRConstant {
  readonly kind: "constant";
  readonly name: string;
  readonly valueType: IRType;
  readonly value: string | number | boolean;
  readonly description?: string;
}

export interface IRConstantSet {
  readonly kind: "constant-set";
  readonly name: string;
  readonly valueType: "string";
  readonly values: readonly string[];
  readonly description?: string;
}

export interface IRConstantMap {
  readonly kind: "constant-map";
  readonly name: string;
  readonly keyType: "string";
  readonly valueType: "string";
  readonly entries: Readonly<Record<string, string>>;
  readonly description?: string;
}

export interface IRField {
  /** Canonical property name (camelCase). */
  readonly name: string;
  /** Wire/JSON name (snake_case, kebab-case, etc.). */
  readonly jsonKey: string;
  readonly type: IRType;
  /**
   * Named type when `type === "ref"` (e.g. "DeviceCategory", "DispatchHandler").
   * Required for `ref` fields to render as anything useful; ignored for the
   * primitive IR types.
   */
  readonly typeName?: string;
  /** Render the field as an array of its type (TS `T[]`, Swift `[T]`, Kotlin `List<T>`). */
  readonly isArray?: boolean;
  readonly optional: boolean;
  readonly default?: unknown;
  readonly description?: string;
}

export interface IRStruct {
  readonly kind: "struct";
  readonly name: string;
  readonly fields: readonly IRField[];
  readonly conformance: readonly string[];
  readonly emitCodingKeys: "always" | "when-needed";
  readonly emitInit: boolean;
  readonly description?: string;
}

export interface IREnum {
  readonly kind: "enum";
  readonly name: string;
  readonly cases: readonly string[];
  readonly rawValueType: "string" | "int";
  readonly description?: string;
}

export interface IRTypeAlias {
  readonly kind: "type-alias";
  readonly name: string;
  /** String-union members, rendered `"a" | "b" | …`. Ignored when `rhs` is set. */
  readonly cases: readonly string[];
  /**
   * Free-form right-hand side. When set, emitted verbatim as
   * `type Name = <rhs>` — for aliases the string-union form can't express
   * (e.g. `Record<"sink" | "trigger" | "source", string[]>`). Takes precedence
   * over `cases`.
   */
  readonly rhs?: string;
  readonly description?: string;
}

export interface IRResolverFn {
  readonly kind: "resolver";
  readonly name: string;
  readonly paramName: string;
  readonly lookupMap: Readonly<Record<string, string>>;
  readonly fallback: string;
  readonly returnType: IRType;
  readonly description?: string;
}

/**
 * Raw, pre-formed source text — the IR escape hatch.
 *
 * Use when a generator needs byte-exact output that the structured IR member
 * kinds cannot express (e.g. language-specific idioms, section-divider
 * comments, expression-bodied functions). The module emitters pass `text`
 * through unchanged and indent it like any other member.
 *
 * `text` is written at column 0 (no leading indent); the module wrapper adds
 * the per-line indent. To force a blank line after the opening brace of a
 * module, prefer the module emitter's `blankLineAfterOpen` option over a
 * leading "\n" in `text`.
 */
export interface IRRaw {
  readonly kind: "raw";
  readonly text: string;
}

/**
 * Import declaration. TypeScript-oriented: the TS emitter renders
 * `import { A, B } from "path";` (or `import type { … } from "path";` when
 * `isType`). Swift and Kotlin emitters drop import members — those languages
 * handle imports at the module level (callers prepend `import Foundation` / set
 * the Kotlin `package`) rather than as IR members, and a TS relative path has
 * no meaningful Swift/Kotlin translation.
 */
export interface IRImport {
  readonly kind: "import";
  /** Module specifier, e.g. "./types.js" or "@ebowwa/workflow-edge". */
  readonly path: string;
  /** Named bindings; omit for a bare side-effect import. */
  readonly named?: readonly string[];
  /** Emit `import type { … }`. */
  readonly isType?: boolean;
}

export type IRMember =
  | IRConstant
  | IRConstantSet
  | IRConstantMap
  | IRStruct
  | IREnum
  | IRTypeAlias
  | IRResolverFn
  | IRRaw
  | IRImport;

export interface IRModule {
  readonly name: string;
  readonly members: readonly IRMember[];
  readonly description?: string;
}

// ─── Constructor helpers (for ergonomic IR building) ─────────────────────

export const constant = (name: string, valueType: IRConstant["valueType"], value: IRConstant["value"], description?: string): IRConstant =>
  ({ kind: "constant", name, valueType, value, description });

export const constantSet = (name: string, values: readonly string[], description?: string): IRConstantSet =>
  ({ kind: "constant-set", name, valueType: "string", values, description });

export const constantMap = (name: string, entries: Record<string, string>, description?: string): IRConstantMap =>
  ({ kind: "constant-map", name, keyType: "string", valueType: "string", entries, description });

export const struct = (name: string, fields: readonly IRField[], opts: {
  conformance?: string[];
  emitCodingKeys?: "always" | "when-needed";
  emitInit?: boolean;
  description?: string;
} = {}): IRStruct =>
  ({ kind: "struct", name, fields, conformance: opts.conformance ?? ["Codable", "Sendable"], emitCodingKeys: opts.emitCodingKeys ?? "always", emitInit: opts.emitInit ?? true, description: opts.description });

export const irEnum = (name: string, cases: readonly string[], opts: {
  rawValueType?: "string" | "int";
  description?: string;
} = {}): IREnum =>
  ({ kind: "enum", name, cases, rawValueType: opts.rawValueType ?? "string", description: opts.description });

export const typeAlias = (
  name: string,
  cases: readonly string[],
  optsOrDescription?: string | { rhs?: string; description?: string },
): IRTypeAlias => {
  const isOpts = typeof optsOrDescription === "object";
  return {
    kind: "type-alias",
    name,
    cases,
    rhs: isOpts ? optsOrDescription.rhs : undefined,
    description: isOpts ? optsOrDescription.description : optsOrDescription,
  };
};

export const resolver = (name: string, paramName: string, lookupMap: Record<string, string>, fallback: string, returnType: IRType = "string", description?: string): IRResolverFn =>
  ({ kind: "resolver", name, paramName, lookupMap, fallback, returnType, description });

export const raw = (text: string): IRRaw =>
  ({ kind: "raw", text });

export const irImport = (path: string, named?: readonly string[], isType = false): IRImport =>
  ({ kind: "import", path, named, isType });

export const module = (name: string, members: readonly IRMember[], description?: string): IRModule =>
  ({ name, members, description });
