// @ebowwa/codegen-kit/schema — neutral intermediate representation.
//
// Language-agnostic types that describe declarations (constants, sets, maps,
// structs, enums, type aliases, resolver functions) in a form that any
// per-language emitter (Swift, Kotlin, TypeScript) can consume.

// ─── Type system ──────────────────────────────────────────────────────────

export type IRType = "string" | "int" | "float" | "bool" | "bytes" | "any" | "void";

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
  readonly cases: readonly string[];
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

export type IRMember =
  | IRConstant
  | IRConstantSet
  | IRConstantMap
  | IRStruct
  | IREnum
  | IRTypeAlias
  | IRResolverFn;

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

export const typeAlias = (name: string, cases: readonly string[], description?: string): IRTypeAlias =>
  ({ kind: "type-alias", name, cases, description });

export const resolver = (name: string, paramName: string, lookupMap: Record<string, string>, fallback: string, returnType: IRType = "string", description?: string): IRResolverFn =>
  ({ kind: "resolver", name, paramName, lookupMap, fallback, returnType, description });

export const module = (name: string, members: readonly IRMember[], description?: string): IRModule =>
  ({ name, members, description });
