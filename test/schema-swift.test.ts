import { describe, test, expect } from "bun:test";
import {
  emitSwiftModule,
  emitSwiftStruct,
  emitSwiftConstant,
  emitSwiftConstantSet,
  emitSwiftConstantMap,
  emitSwiftEnum,
  emitSwiftResolver,
} from "../src/schema/emit/swift.js";
import type { IRField, IRStruct, IRModule } from "../src/schema/ir.js";
import { typeAlias, irImport, module } from "../src/schema/ir.js";

/** Field builder — keeps struct literals below readable. */
const field = (
  name: string,
  jsonKey: string,
  type: IRField["type"],
  extra: Partial<IRField> = {},
): IRField => ({ name, jsonKey, type, optional: false, ...extra });

// ─── emitSwiftConstant ───────────────────────────────────────────────────

describe("emitSwiftConstant", () => {
  test("bool, no description", () => {
    const out = emitSwiftConstant({ kind: "constant", name: "dualCamera", valueType: "bool", value: false });
    expect(out).toBe("static let dualCamera: Bool = false");
  });

  test("int, with description on the line above", () => {
    const out = emitSwiftConstant({
      kind: "constant",
      name: "maxFps",
      valueType: "int",
      value: 30,
      description: "Maximum frame rate.",
    });
    expect(out).toBe("/// Maximum frame rate.\nstatic let maxFps: Int = 30");
  });

  test("string value is JSON-quoted (escapes embedded quotes)", () => {
    const out = emitSwiftConstant({
      kind: "constant",
      name: "codec",
      valueType: "string",
      value: 'he said "hi"',
    });
    expect(out).toBe('static let codec: String = "he said \\"hi\\""');
  });

  test("float value uses String(Number(raw)) to byte-match swift-config-structs", () => {
    // Integer-valued floats render without a trailing ".0" (e.g. 2 → "2", not "2.0");
    // fractional values render as-is (e.g. 0.5 → "0.5").
    const out = emitSwiftConstant({ kind: "constant", name: "ratio", valueType: "float", value: 2 });
    expect(out).toBe("static let ratio: Double = 2");
    const frac = emitSwiftConstant({ kind: "constant", name: "ratio", valueType: "float", value: 0.5 });
    expect(frac).toBe("static let ratio: Double = 0.5");
  });
});

// ─── emitSwiftConstantSet ────────────────────────────────────────────────

describe("emitSwiftConstantSet", () => {
  test("renders Set<String> literal", () => {
    const out = emitSwiftConstantSet({
      kind: "constant-set",
      name: "sourceTypes",
      valueType: "string",
      values: ["camera-source", "phone-mic-source"],
    });
    expect(out).toBe('static let sourceTypes: Set<String> = ["camera-source", "phone-mic-source"]');
  });
});

// ─── emitSwiftConstantMap ────────────────────────────────────────────────

describe("emitSwiftConstantMap", () => {
  test("renders [String: String] dictionary literal", () => {
    const out = emitSwiftConstantMap({
      kind: "constant-map",
      name: "typeAliases",
      keyType: "string",
      valueType: "string",
      entries: { "old-type": "new-type" },
    });
    expect(out).toBe('static let typeAliases: [String: String] = ["old-type": "new-type"]');
  });

  test("multiple entries are comma-joined", () => {
    const out = emitSwiftConstantMap({
      kind: "constant-map",
      name: "renames",
      keyType: "string",
      valueType: "string",
      entries: { a: "x", b: "y" },
    });
    // Object order is insertion-order for string keys, so this is deterministic.
    expect(out).toBe('static let renames: [String: String] = ["a": "x", "b": "y"]');
  });
});

// ─── emitSwiftEnum ───────────────────────────────────────────────────────

describe("emitSwiftEnum", () => {
  test("string-backed enum emits one case per line", () => {
    const out = emitSwiftEnum({
      kind: "enum",
      name: "NodeRole",
      cases: ["source", "sink", "processor"],
      rawValueType: "string",
    });
    expect(out).toBe(
      [
        "enum NodeRole: String {",
        "    case source",
        "    case sink",
        "    case processor",
        "}",
      ].join("\n"),
    );
  });

  test("description becomes a doc comment above the enum", () => {
    const out = emitSwiftEnum({
      kind: "enum",
      name: "Color",
      cases: ["red", "green"],
      rawValueType: "string",
      description: "RGB primaries.",
    });
    expect(out).toBe(
      [
        "/// RGB primaries.",
        "enum Color: String {",
        "    case red",
        "    case green",
        "}",
      ].join("\n"),
    );
  });
});

// ─── emitSwiftResolver ───────────────────────────────────────────────────

describe("emitSwiftResolver", () => {
  test("static func with one lookup + default fallback", () => {
    const out = emitSwiftResolver({
      kind: "resolver",
      name: "resolveType",
      paramName: "key",
      lookupMap: { "old-type": "new-type" },
      fallback: "key",
      returnType: "string",
    });
    expect(out).toBe(
      [
        "static func resolveType(_ key: String) -> String {",
        "    switch key {",
        '    case "old-type": return "new-type"',
        '    default: return "key"',
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test("multiple map entries each become a case", () => {
    const out = emitSwiftResolver({
      kind: "resolver",
      name: "alias",
      paramName: "k",
      lookupMap: { a: "x", b: "y" },
      fallback: "k",
      returnType: "string",
    });
    expect(out).toBe(
      [
        "static func alias(_ k: String) -> String {",
        "    switch k {",
        '    case "a": return "x"',
        '    case "b": return "y"',
        '    default: return "k"',
        "    }",
        "}",
      ].join("\n"),
    );
  });
});

// ─── emitSwiftStruct ─────────────────────────────────────────────────────

describe("emitSwiftStruct", () => {
  test("all field types mapped; optionals get `?`; defaults are language defaults", () => {
    const s: IRStruct = {
      kind: "struct",
      name: "AllTypes",
      conformance: ["Codable", "Sendable"],
      emitCodingKeys: "always",
      emitInit: true,
      fields: [
        field("strVal", "str_val", "string"),
        field("intVal", "int_val", "int"),
        field("floatVal", "float_val", "float"),
        field("boolVal", "bool_val", "bool"),
        field("bytesVal", "bytes_val", "bytes"),
        field("anyVal", "any_val", "any"),
        field("optVal", "opt_val", "string", { optional: true }),
      ],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct AllTypes: Codable, Sendable {",
        "",
        "    let strVal: String",
        "    let intVal: Int",
        "    let floatVal: Double",
        "    let boolVal: Bool",
        "    let bytesVal: Data",
        "    let anyVal: Any",
        "    let optVal: String?",
        "",
        "    enum CodingKeys: String, CodingKey {",
        '        case strVal = "str_val"',
        '        case intVal = "int_val"',
        '        case floatVal = "float_val"',
        '        case boolVal = "bool_val"',
        '        case bytesVal = "bytes_val"',
        '        case anyVal = "any_val"',
        '        case optVal = "opt_val"',
        "    }",
        "",
        "    init(",
        '        strVal: String = "",',
        "        intVal: Int = 0,",
        "        floatVal: Double = 0.0,",
        "        boolVal: Bool = false,",
        "        bytesVal: Data = Data(),",
        '        anyVal: Any = "",',
        "        optVal: String? = nil",
        "    ) {",
        "        self.strVal = strVal",
        "        self.intVal = intVal",
        "        self.floatVal = floatVal",
        "        self.boolVal = boolVal",
        "        self.bytesVal = bytesVal",
        "        self.anyVal = anyVal",
        "        self.optVal = optVal",
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test("explicit defaults populate init params; matching-name fields omit raw values", () => {
    const s: IRStruct = {
      kind: "struct",
      name: "CameraSourceConfig",
      conformance: ["Codable", "Sendable"],
      emitCodingKeys: "always",
      emitInit: true,
      fields: [
        field("visionFps", "vision_fps", "float", { default: 1.0 }),
        field("codec", "codec", "string", { default: "jpeg" }),
        field("punctuation", "punctuation", "bool", { default: true, description: "Smart punctuation" }),
      ],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct CameraSourceConfig: Codable, Sendable {",
        "",
        "    let visionFps: Double",
        "    let codec: String",
        "    /// Smart punctuation",
        "    let punctuation: Bool",
        "",
        "    enum CodingKeys: String, CodingKey {",
        '        case visionFps = "vision_fps"',
        "        case codec",
        "        case punctuation",
        "    }",
        "",
        "    init(",
        "        visionFps: Double = 1,",
        '        codec: String = "jpeg",',
        "        punctuation: Bool = true",
        "    ) {",
        "        self.visionFps = visionFps",
        "        self.codec = codec",
        "        self.punctuation = punctuation",
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test('emitCodingKeys: "when-needed" omits CodingKeys when all names match', () => {
    const s: IRStruct = {
      kind: "struct",
      name: "NoCK",
      conformance: ["Codable", "Sendable"],
      emitCodingKeys: "when-needed",
      emitInit: true,
      fields: [field("foo", "foo", "string"), field("bar", "bar", "int")],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct NoCK: Codable, Sendable {",
        "",
        "    let foo: String",
        "    let bar: Int",
        "",
        "    init(",
        '        foo: String = "",',
        "        bar: Int = 0",
        "    ) {",
        "        self.foo = foo",
        "        self.bar = bar",
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test('emitCodingKeys: "when-needed" emits CodingKeys when any name differs', () => {
    const s: IRStruct = {
      kind: "struct",
      name: "WithCK",
      conformance: ["Codable", "Sendable"],
      emitCodingKeys: "when-needed",
      emitInit: false,
      fields: [field("fooBar", "foo_bar", "string")],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct WithCK: Codable, Sendable {",
        "",
        "    let fooBar: String",
        "",
        "    enum CodingKeys: String, CodingKey {",
        '        case fooBar = "foo_bar"',
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test("emitInit: false skips the init block entirely", () => {
    const s: IRStruct = {
      kind: "struct",
      name: "NoInit",
      conformance: ["Codable", "Sendable"],
      emitCodingKeys: "when-needed",
      emitInit: false,
      fields: [field("x", "x", "int")],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct NoInit: Codable, Sendable {",
        "",
        "    let x: Int",
        "}",
      ].join("\n"),
    );
  });

  test("keyword field names are backtick-escaped everywhere (property, CodingKeys, init)", () => {
    // `type`, `class` are Swift keywords. CodingKeys comparison uses the
    // escaped form, so keyword fields always emit the explicit `= "jsonKey"`.
    const s: IRStruct = {
      kind: "struct",
      name: "Escaped",
      conformance: ["Codable", "Sendable"],
      emitCodingKeys: "always",
      emitInit: true,
      fields: [field("type", "type", "string"), field("class", "class", "string")],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct Escaped: Codable, Sendable {",
        "",
        "    let `type`: String",
        "    let `class`: String",
        "",
        "    enum CodingKeys: String, CodingKey {",
        '        case `type` = "type"',
        '        case `class` = "class"',
        "    }",
        "",
        "    init(",
        "        `type`: String = \"\",",
        "        `class`: String = \"\"",
        "    ) {",
        "        self.`type` = `type`",
        "        self.`class` = `class`",
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test("opts override the IR's emitInit/emitCodingKeys at call time", () => {
    const s: IRStruct = {
      kind: "struct",
      name: "Override",
      conformance: ["Codable"],
      emitCodingKeys: "always",
      emitInit: true,
      fields: [field("fooBar", "foo_bar", "string")],
    };
    // Force no init + only-when-needed CodingKeys.
    expect(emitSwiftStruct(s, { emitInit: false, emitCodingKeys: "when-needed" })).toBe(
      [
        "struct Override: Codable {",
        "",
        "    let fooBar: String",
        "",
        "    enum CodingKeys: String, CodingKey {",
        '        case fooBar = "foo_bar"',
        "    }",
        "}",
      ].join("\n"),
    );
  });
});

// ─── emitSwiftModule ─────────────────────────────────────────────────────

describe("emitSwiftModule", () => {
  test("wraps members in `public enum <Name> { ... }`, blank line between members", () => {
    const ir: IRModule = {
      name: "FeatureFlags",
      members: [
        { kind: "constant", name: "dualCamera", valueType: "bool", value: false },
        { kind: "constant", name: "maxFps", valueType: "int", value: 30, description: "Max frame rate." },
      ],
    };
    expect(emitSwiftModule(ir)).toBe(
      [
        "public enum FeatureFlags {",
        "    static let dualCamera: Bool = false",
        "",
        "    /// Max frame rate.",
        "    static let maxFps: Int = 30",
        "}",
      ].join("\n"),
    );
  });

  test("description becomes a leading doc comment above the enum", () => {
    const ir: IRModule = {
      name: "FeatureFlags",
      description: "Top-level feature flags.",
      members: [
        { kind: "constant", name: "dualCamera", valueType: "bool", value: true },
      ],
    };
    expect(emitSwiftModule(ir)).toBe(
      [
        "/// Top-level feature flags.",
        "public enum FeatureFlags {",
        "    static let dualCamera: Bool = true",
        "}",
      ].join("\n"),
    );
  });

  test("nested struct is indented one level deep; internal blank lines stay empty", () => {
    const ir: IRModule = {
      name: "Wrapper",
      members: [
        {
          kind: "struct",
          name: "Inner",
          conformance: ["Codable"],
          emitCodingKeys: "always",
          emitInit: false,
          fields: [field("x", "x", "int")],
        },
      ],
    };
    expect(emitSwiftModule(ir)).toBe(
      [
        "public enum Wrapper {",
        "    struct Inner: Codable {",
        "",
        "        let x: Int",
        "",
        "        enum CodingKeys: String, CodingKey {",
        "            case x",
        "        }",
        "    }",
        "}",
      ].join("\n"),
    );
  });

  test("mixed member kinds all dispatch correctly", () => {
    const ir: IRModule = {
      name: "Mixed",
      members: [
        { kind: "constant", name: "kMax", valueType: "int", value: 5 },
        {
          kind: "constant-set",
          name: "kinds",
          valueType: "string",
          values: ["a", "b"],
        },
        {
          kind: "constant-map",
          name: "renames",
          keyType: "string",
          valueType: "string",
          entries: { old: "new" },
        },
        {
          kind: "enum",
          name: "Role",
          cases: ["admin", "user"],
          rawValueType: "string",
        },
        {
          kind: "resolver",
          name: "resolve",
          paramName: "key",
          lookupMap: { old: "new" },
          fallback: "key",
          returnType: "string",
        },
      ],
    };
    expect(emitSwiftModule(ir)).toBe(
      [
        "public enum Mixed {",
        "    static let kMax: Int = 5",
        "",
        '    static let kinds: Set<String> = ["a", "b"]',
        "",
        '    static let renames: [String: String] = ["old": "new"]',
        "",
        "    enum Role: String {",
        "        case admin",
        "        case user",
        "    }",
        "",
        "    static func resolve(_ key: String) -> String {",
        "        switch key {",
        '        case "old": return "new"',
        '        default: return "key"',
        "        }",
        "    }",
        "}",
      ].join("\n"),
    );
  });
});

// ─── Named-type refs + arrays in fields (category 1) ──────────────────────

describe("emitSwiftStruct — ref + array fields", () => {
  test("named ref, array-of-ref, array-of-primitive, optional array", () => {
    const s: IRStruct = {
      kind: "struct",
      name: "Refs",
      conformance: [],
      emitCodingKeys: "when-needed",
      emitInit: false,
      fields: [
        field("category", "category", "ref", { typeName: "DeviceCategory" }),
        field("platforms", "platforms", "ref", { typeName: "DevicePlatform", isArray: true }),
        field("tags", "tags", "string", { isArray: true }),
        field("maybe", "maybe", "ref", { typeName: "X", isArray: true, optional: true }),
      ],
    };
    expect(emitSwiftStruct(s)).toBe(
      [
        "struct Refs {",
        "",
        "    let category: DeviceCategory",
        "    let platforms: [DevicePlatform]",
        "    let tags: [String]",
        "    let maybe: [X]?",
        "}",
      ].join("\n"),
    );
  });
});

// ─── Free-form type-alias RHS (category 3) ────────────────────────────────

describe("emitSwiftModule — type-alias rhs", () => {
  test("rhs emitted verbatim inside a module", () => {
    const ir = module("Types", [typeAlias("RoleMap", [], { rhs: "[String: String]" })]);
    expect(emitSwiftModule(ir)).toBe(
      ["public enum Types {", "    typealias RoleMap = [String: String]", "}"].join("\n"),
    );
  });
});

// ─── Imports dropped (category 2 — TS-oriented) ───────────────────────────

describe("emitSwiftModule — import members dropped", () => {
  test("TS-oriented import member produces no Swift output", () => {
    const ir = module("M", [
      irImport("./x.js", ["X"], true),
      typeAlias("T", [], { rhs: "String" }),
    ]);
    expect(emitSwiftModule(ir)).toBe(
      ["public enum M {", "    typealias T = String", "}"].join("\n"),
    );
  });
});
