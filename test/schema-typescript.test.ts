import { describe, test, expect } from "bun:test";
import {
  emitTsModule,
  emitTsInterface,
  emitTsConstant,
  emitTsTypeAlias,
  emitTsConstantSet,
  emitTsConstantMap,
  emitTsResolver,
  emitTsMember,
  emitTsImport,
} from "../src/schema/emit/typescript.js";
import {
  constant,
  constantSet,
  constantMap,
  struct,
  irEnum,
  typeAlias,
  resolver,
  module,
  irImport,
} from "../src/schema/ir.js";
import type { IRField, IRType } from "../src/schema/ir.js";

/** Tiny field builder for readable struct construction in tests. */
const field = (
  name: string,
  type: IRType,
  opts: { optional?: boolean; default?: unknown; jsonKey?: string } = {},
): IRField => ({
  name,
  jsonKey: opts.jsonKey ?? name,
  type,
  optional: opts.optional ?? false,
  default: opts.default,
});

// ─── emitTsInterface ──────────────────────────────────────────────────────

describe("emitTsInterface", () => {
  test("exact shape — 2-space indent, optional via `?`, no defaults", () => {
    const s = struct("CameraSourceConfig", [
      field("visionFps", "float", { default: 1 }),
      field("codec", "string", { default: "jpeg" }),
      field("punctuation", "bool", { optional: true }),
    ]);
    expect(emitTsInterface(s)).toBe(
      "export interface CameraSourceConfig {\n" +
        "  visionFps: number;\n" +
        "  codec: string;\n" +
        "  punctuation?: boolean;\n" +
        "}",
    );
  });

  test("type mapping — string/int/float/bool/bytes/any", () => {
    const s = struct("All", [
      field("a", "string"),
      field("b", "int"),
      field("c", "float"),
      field("d", "bool"),
      field("e", "bytes"),
      field("f", "any"),
    ]);
    expect(emitTsInterface(s)).toBe(
      "export interface All {\n" +
        "  a: string;\n" +
        "  b: number;\n" +
        "  c: number;\n" +
        "  d: boolean;\n" +
        "  e: Uint8Array;\n" +
        "  f: unknown;\n" +
        "}",
    );
  });

  test("JSDoc description above interface", () => {
    const s = struct("Cfg", [field("x", "int")], { description: "A config." });
    expect(emitTsInterface(s)).toBe(
      "/** A config. */\n" + "export interface Cfg {\n" + "  x: number;\n" + "}",
    );
  });
});

// ─── emitTsConstant ───────────────────────────────────────────────────────

describe("emitTsConstant", () => {
  test("bool → export const NAME = false as const; name SCREAMING_SNAKE", () => {
    expect(emitTsConstant(constant("dual-camera", "bool", false))).toBe(
      "export const DUAL_CAMERA = false as const;",
    );
  });

  test("int → number as const", () => {
    expect(emitTsConstant(constant("max-fps", "int", 30))).toBe(
      "export const MAX_FPS = 30 as const;",
    );
  });

  test("float → number as const (no forced decimal)", () => {
    expect(emitTsConstant(constant("ratio", "float", 1.5))).toBe(
      "export const RATIO = 1.5 as const;",
    );
  });

  test("string → quoted as const; JSDoc when description set", () => {
    expect(emitTsConstant(constant("default-codec", "string", "jpeg", "Default codec."))).toBe(
      "/** Default codec. */\n" + 'export const DEFAULT_CODEC = "jpeg" as const;',
    );
  });
});

// ─── emitTsTypeAlias ──────────────────────────────────────────────────────

describe("emitTsTypeAlias", () => {
  test("string union — export type Name = \"a\" | \"b\" | \"c\";", () => {
    const ta = typeAlias("FeatureFlagKey", ["dual-camera", "max-fps", "recording"]);
    expect(emitTsTypeAlias(ta)).toBe(
      'export type FeatureFlagKey = "dual-camera" | "max-fps" | "recording";',
    );
  });

  test("single case", () => {
    expect(emitTsTypeAlias(typeAlias("Only", ["one"]))).toBe(
      'export type Only = "one";',
    );
  });

  test("JSDoc when description set", () => {
    expect(emitTsTypeAlias(typeAlias("K", ["a"], { description: "Keys." }))).toBe(
      '/** Keys. */\nexport type K = "a";',
    );
  });
});

// ─── emitTsConstantSet ────────────────────────────────────────────────────

describe("emitTsConstantSet", () => {
  test("readonly string[] literal", () => {
    const cs = constantSet("source-types", ["camera-source", "phone-mic-source"]);
    expect(emitTsConstantSet(cs)).toBe(
      'export const SOURCE_TYPES: readonly string[] = ["camera-source", "phone-mic-source"];',
    );
  });
});

// ─── emitTsConstantMap ────────────────────────────────────────────────────

describe("emitTsConstantMap", () => {
  test("Record<string,string> literal with quoted keys", () => {
    const cm = constantMap("type-aliases", { "old-type": "new-type" });
    expect(emitTsConstantMap(cm)).toBe(
      'export const TYPE_ALIASES: Record<string, string> = { "old-type": "new-type" };',
    );
  });

  test("multiple entries joined by `, `", () => {
    const cm = constantMap("m", { a: "1", b: "2" });
    const out = emitTsConstantMap(cm);
    expect(out).toContain('"a": "1"');
    expect(out).toContain('"b": "2"');
  });
});

// ─── emitTsResolver ───────────────────────────────────────────────────────

describe("emitTsResolver", () => {
  test("empty fallback → identity default (return paramName)", () => {
    const r = resolver("resolveType", "key", { "old-type": "new-type" }, "");
    expect(emitTsResolver(r)).toBe(
      "export function resolveType(key: string): string {\n" +
        "  switch (key) {\n" +
        '    case "old-type": return "new-type";\n' +
        "    default: return key;\n" +
        "  }\n" +
        "}",
    );
  });

  test("non-empty fallback → typed literal in default branch", () => {
    const r = resolver("resolveType", "key", { "old-type": "new-type" }, "default-type");
    expect(emitTsResolver(r)).toBe(
      "export function resolveType(key: string): string {\n" +
        "  switch (key) {\n" +
        '    case "old-type": return "new-type";\n' +
        '    default: return "default-type";\n' +
        "  }\n" +
        "}",
    );
  });

  test("JSDoc when description set", () => {
    const r = resolver("resolveType", "key", {}, "", "string", "Resolve a type.");
    expect(emitTsResolver(r)).toStartWith("/** Resolve a type. */\n");
  });
});

// ─── emitTsMember (dispatch) ──────────────────────────────────────────────

describe("emitTsMember (dispatch)", () => {
  test("routes each kind to the right emitter", () => {
    expect(emitTsMember(constant("x", "bool", true))).toBe("export const X = true as const;");
    expect(emitTsMember(constantSet("xs", ["a"]))).toBe(
      'export const XS: readonly string[] = ["a"];',
    );
    expect(emitTsMember(constantMap("m", { k: "v" }))).toBe(
      'export const M: Record<string, string> = { "k": "v" };',
    );
    expect(emitTsMember(typeAlias("K", ["a"]))).toBe('export type K = "a";');
    expect(emitTsMember(resolver("r", "k", {}, ""))).toContain("export function r(k: string)");
    // struct → interface
    expect(emitTsMember(struct("S", [field("n", "int")]))).toContain("export interface S");
    // enum (no dedicated emitter) → string-union type alias
    expect(emitTsMember(irEnum("Role", ["a", "b"]))).toBe('export type Role = "a" | "b";');
  });
});

// ─── emitTsModule ─────────────────────────────────────────────────────────

describe("emitTsModule", () => {
  test("flat export — no wrapping object; members separated by blank line", () => {
    const ir = module("FeatureFlags", [
      constant("dual-camera", "bool", false),
      constant("max-fps", "int", 30),
    ]);
    expect(emitTsModule(ir)).toBe(
      "export const DUAL_CAMERA = false as const;\n\n" + "export const MAX_FPS = 30 as const;\n",
    );
  });

  test("JSDoc prefix when module description set", () => {
    const ir = module("FeatureFlags", [constant("dual-camera", "bool", false)], "Feature flags.");
    expect(emitTsModule(ir)).toBe(
      "/** Feature flags. */\n" + "export const DUAL_CAMERA = false as const;\n",
    );
  });

  test("heterogeneous members — interface + const + type alias + resolver", () => {
    const ir = module("Mixed", [
      struct("Cfg", [field("x", "int")]),
      constant("flag", "bool", true),
      typeAlias("Kind", ["a", "b"]),
      resolver("resolveKind", "k", { a: "b" }, ""),
    ]);
    expect(emitTsModule(ir)).toBe(
      "export interface Cfg {\n" +
        "  x: number;\n" +
        "}\n\n" +
        "export const FLAG = true as const;\n\n" +
        'export type Kind = "a" | "b";\n\n' +
        "export function resolveKind(k: string): string {\n" +
        "  switch (k) {\n" +
        '    case "a": return "b";\n' +
        "    default: return k;\n" +
        "  }\n" +
        "}\n",
    );
  });

  test("empty module → no trailing newline-only body", () => {
    expect(emitTsModule(module("Empty", []))).toBe("");
    expect(emitTsModule(module("Empty", [], "Nothing here."))).toBe("/** Nothing here. */");
  });
});

// ─── Named-type refs + arrays in fields (category 1) ──────────────────────

describe("emitTsInterface — ref + array fields", () => {
  const ref = (name: string, typeName: string, extra: Partial<IRField> = {}): IRField => ({
    name, jsonKey: name, type: "ref", typeName, optional: false, ...extra,
  });

  test("named ref, array-of-ref, array-of-primitive", () => {
    const s = struct("DeviceEntry", [
      ref("category", "DeviceCategory"),
      ref("platforms", "DevicePlatform", { isArray: true }),
      { name: "tags", jsonKey: "tags", type: "string", isArray: true, optional: false },
      ref("fallback", "Unknown", { optional: true }),
    ]);
    expect(emitTsInterface(s)).toBe(
      "export interface DeviceEntry {\n" +
        "  category: DeviceCategory;\n" +
        "  platforms: DevicePlatform[];\n" +
        "  tags: string[];\n" +
        "  fallback?: Unknown;\n" +
        "}",
    );
  });

  test("ref without typeName degrades to unknown", () => {
    const s = struct("S", [{ name: "x", jsonKey: "x", type: "ref", optional: false }]);
    expect(emitTsInterface(s)).toBe("export interface S {\n  x: unknown;\n}");
  });
});

// ─── Free-form type-alias RHS (category 3) ────────────────────────────────

describe("emitTsTypeAlias — rhs", () => {
  test("rhs takes precedence over cases", () => {
    const ta = typeAlias("SentinelRoleMap", [], {
      rhs: 'Record<"sink" | "trigger" | "source", string[]>',
    });
    expect(emitTsTypeAlias(ta)).toBe(
      'export type SentinelRoleMap = Record<"sink" | "trigger" | "source", string[]>;',
    );
  });

  test("cases still used when rhs absent (backward compatible)", () => {
    expect(emitTsTypeAlias(typeAlias("Kind", ["a", "b"]))).toBe('export type Kind = "a" | "b";');
  });
});

// ─── Imports (category 2) ─────────────────────────────────────────────────

describe("emitTsImport", () => {
  test("type import with named bindings", () => {
    expect(emitTsImport(irImport("../../../shared/types/workflow-types.js", ["NodeDefinition"], true)))
      .toBe('import type { NodeDefinition } from "../../../shared/types/workflow-types.js";');
  });

  test("value import, multiple named bindings", () => {
    expect(emitTsImport(irImport("@ebowwa/workflow-edge", ["NodeDefinition", "DeviceTarget"])))
      .toBe('import { NodeDefinition, DeviceTarget } from "@ebowwa/workflow-edge";');
  });

  test("import member renders inside a module", () => {
    const ir = module("generated-palette", [
      irImport("@ebowwa/workflow-edge", ["NodeDefinition"], true),
      constant("seed", "int", 1),
    ]);
    expect(emitTsModule(ir)).toBe(
      'import type { NodeDefinition } from "@ebowwa/workflow-edge";\n\n' +
        "export const SEED = 1 as const;\n",
    );
  });
});
