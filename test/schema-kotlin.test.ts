import { describe, test, expect } from "bun:test";
import {
  emitKotlinModule,
  emitKotlinDataClass,
  emitKotlinConstant,
  emitKotlinConstantSet,
  emitKotlinConstantMap,
  emitKotlinEnum,
  emitKotlinResolver,
  emitKotlinMember,
} from "../src/schema/emit/kotlin.js";
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

// ─── emitKotlinDataClass ──────────────────────────────────────────────────

describe("emitKotlinDataClass", () => {
  test("exact shape — defaults rendered per type, last field has no trailing comma", () => {
    const s = struct("CameraSourceConfig", [
      field("visionFps", "float", { default: 1 }),
      field("codec", "string", { default: "jpeg" }),
      field("punctuation", "bool", { default: true }),
    ]);
    expect(emitKotlinDataClass(s)).toBe(
      "data class CameraSourceConfig(\n" +
        "    val visionFps: Double = 1.0,\n" +
        '    val codec: String = "jpeg",\n' +
        "    val punctuation: Boolean = true\n" +
        ")",
    );
  });

  test("optional field without default → `Type? = null`", () => {
    const s = struct("Note", [field("note", "string", { optional: true })]);
    expect(emitKotlinDataClass(s)).toBe(
      "data class Note(\n" + "    val note: String? = null\n" + ")",
    );
  });

  test("optional field with default → `Type? = <default>`", () => {
    const s = struct("Note", [field("note", "string", { optional: true, default: "hi" })]);
    expect(emitKotlinDataClass(s)).toBe(
      "data class Note(\n" + '    val note: String? = "hi"\n' + ")",
    );
  });

  test("required field without default → no `= ...` clause", () => {
    const s = struct("Cfg", [field("count", "int")]);
    expect(emitKotlinDataClass(s)).toBe(
      "data class Cfg(\n" + "    val count: Int\n" + ")",
    );
  });

  test("type mapping — bytes→ByteArray, any→Any", () => {
    const s = struct("Blob", [field("payload", "bytes"), field("extra", "any", { default: "x" })]);
    expect(emitKotlinDataClass(s)).toBe(
      "data class Blob(\n" +
        "    val payload: ByteArray,\n" +
        '    val extra: Any = "x"\n' +
        ")",
    );
  });

  test("KDoc description rendered before the class", () => {
    const s = struct("Cfg", [field("x", "int", { default: 0 })], { description: "A config." });
    expect(emitKotlinDataClass(s)).toBe(
      "/** A config. */\n" + "data class Cfg(\n" + "    val x: Int = 0\n" + ")",
    );
  });

  test("keyword field name is backtick-escaped via escapeKotlinIdent", () => {
    const s = struct("Cfg", [field("class", "string")]);
    expect(emitKotlinDataClass(s)).toContain("    val `class`: String");
  });

  test("string values with quotes/backslashes are escaped", () => {
    const s = struct("Cfg", [field("path", "string", { default: 'a"b\\c' })]);
    expect(emitKotlinDataClass(s)).toContain('    val path: String = "a\\"b\\\\c"');
  });
});

// ─── emitKotlinConstant ───────────────────────────────────────────────────

describe("emitKotlinConstant", () => {
  test("bool → const val NAME: Boolean = false, name SCREAMING_SNAKE", () => {
    expect(emitKotlinConstant(constant("dual-camera", "bool", false))).toBe(
      "const val DUAL_CAMERA: Boolean = false",
    );
  });

  test("int → const val NAME: Int = 30, KDoc above", () => {
    expect(emitKotlinConstant(constant("max-fps", "int", 30, "Max FPS."))).toBe(
      "/** Max FPS. */\n" + "const val MAX_FPS: Int = 30",
    );
  });

  test("float → Double with at least one decimal digit", () => {
    expect(emitKotlinConstant(constant("ratio", "float", 2))).toBe(
      "const val RATIO: Double = 2.0",
    );
    expect(emitKotlinConstant(constant("ratio", "float", 1.5))).toBe(
      "const val RATIO: Double = 1.5",
    );
  });

  test("string → quoted, escaped", () => {
    expect(emitKotlinConstant(constant("default-codec", "string", "jpeg"))).toBe(
      'const val DEFAULT_CODEC: String = "jpeg"',
    );
  });
});

// ─── emitKotlinConstantSet ────────────────────────────────────────────────

describe("emitKotlinConstantSet", () => {
  test("val NAME: Set<String> = setOf(...)", () => {
    const cs = constantSet("source-types", ["camera-source", "phone-mic-source"]);
    expect(emitKotlinConstantSet(cs)).toBe(
      'val SOURCE_TYPES: Set<String> = setOf("camera-source", "phone-mic-source")',
    );
  });

  test("KDoc above when description set", () => {
    const cs = constantSet("source-types", ["a"], "Allowed sources.");
    expect(emitKotlinConstantSet(cs)).toBe(
      "/** Allowed sources. */\n" + 'val SOURCE_TYPES: Set<String> = setOf("a")',
    );
  });
});

// ─── emitKotlinConstantMap ────────────────────────────────────────────────

describe("emitKotlinConstantMap", () => {
  test("val NAME: Map<String, String> = mapOf(\"k\" to \"v\")", () => {
    const cm = constantMap("type-aliases", { "old-type": "new-type" });
    expect(emitKotlinConstantMap(cm)).toBe(
      'val TYPE_ALIASES: Map<String, String> = mapOf("old-type" to "new-type")',
    );
  });

  test("multiple entries joined by `, `", () => {
    const cm = constantMap("m", { a: "1", b: "2" });
    const out = emitKotlinConstantMap(cm);
    expect(out).toContain('"a" to "1"');
    expect(out).toContain('"b" to "2"');
    expect(out).toContain(", ");
  });
});

// ─── emitKotlinEnum ───────────────────────────────────────────────────────

describe("emitKotlinEnum", () => {
  test("string raw value — enum class NAME(val value: String) { ... }", () => {
    const e = irEnum("NodeRole", ["source", "sink", "processor"]);
    expect(emitKotlinEnum(e)).toBe(
      "enum class NodeRole(val value: String) {\n" +
        '    SOURCE("source"),\n' +
        '    SINK("sink"),\n' +
        '    PROCESSOR("processor")\n' +
        "}",
    );
  });

  test("int raw value — cases numbered by index", () => {
    const e = irEnum("StatusCode", ["ok", "error"], { rawValueType: "int" });
    expect(emitKotlinEnum(e)).toBe(
      "enum class StatusCode(val value: Int) {\n" + "    OK(0),\n" + "    ERROR(1)\n" + "}",
    );
  });

  test("multi-word cases become SCREAMING_SNAKE", () => {
    const e = irEnum("Kind", ["frame-diff"]);
    expect(emitKotlinEnum(e)).toContain('    FRAME_DIFF("frame-diff")');
  });

  test("KDoc description above enum", () => {
    const e = irEnum("Kind", ["a"], { description: "Kinds." });
    expect(emitKotlinEnum(e)).toStartWith("/** Kinds. */\n");
  });
});

// ─── emitKotlinResolver ───────────────────────────────────────────────────

describe("emitKotlinResolver", () => {
  test("empty fallback → identity (else -> paramName)", () => {
    const r = resolver("resolveType", "key", { "old-type": "new-type" }, "");
    expect(emitKotlinResolver(r)).toBe(
      "fun resolveType(key: String): String {\n" +
        "    return when (key) {\n" +
        '        "old-type" -> "new-type"\n' +
        "        else -> key\n" +
        "    }\n" +
        "}",
    );
  });

  test("non-empty fallback → typed literal in else branch", () => {
    const r = resolver("resolveType", "key", { "old-type": "new-type" }, "default-type");
    expect(emitKotlinResolver(r)).toBe(
      "fun resolveType(key: String): String {\n" +
        "    return when (key) {\n" +
        '        "old-type" -> "new-type"\n' +
        '        else -> "default-type"\n' +
        "    }\n" +
        "}",
    );
  });

  test("int return type → Int signature and unquoted literals", () => {
    const r = resolver("resolveId", "key", { foo: "1" }, "0", "int");
    expect(emitKotlinResolver(r)).toBe(
      "fun resolveId(key: String): Int {\n" +
        "    return when (key) {\n" +
        '        "foo" -> 1\n' +
        "        else -> 0\n" +
        "    }\n" +
        "}",
    );
  });
});

// ─── emitKotlinMember (dispatch) ──────────────────────────────────────────

describe("emitKotlinMember (dispatch)", () => {
  test("routes each kind to the right emitter", () => {
    expect(emitKotlinMember(constant("x", "bool", true))).toBe("const val X: Boolean = true");
    expect(emitKotlinMember(constantSet("xs", ["a"]))).toBe(
      'val XS: Set<String> = setOf("a")',
    );
    expect(emitKotlinMember(constantMap("m", { k: "v" }))).toBe(
      'val M: Map<String, String> = mapOf("k" to "v")',
    );
    expect(emitKotlinMember(irEnum("E", ["a"]))).toContain("enum class E");
    expect(emitKotlinMember(resolver("r", "k", {}, ""))).toContain("fun r(k: String)");
    // type-alias has no dedicated Kotlin emitter; module renders it as `typealias Name = String`.
    expect(emitKotlinMember({ kind: "type-alias", name: "FlagKey", cases: ["a"] })).toBe(
      "typealias FlagKey = String",
    );
  });
});

// ─── emitKotlinModule ─────────────────────────────────────────────────────

describe("emitKotlinModule", () => {
  test("wraps members in `object NAME { ... }` with 4-space indent + blank-line separator", () => {
    const ir = module("FeatureFlags", [
      constant("dual-camera", "bool", false, "Dual camera support."),
      constant("max-fps", "int", 30),
    ]);
    expect(emitKotlinModule(ir)).toBe(
      "object FeatureFlags {\n" +
        "    /** Dual camera support. */\n" +
        "    const val DUAL_CAMERA: Boolean = false\n" +
        "\n" +
        "    const val MAX_FPS: Int = 30\n" +
        "}\n",
    );
  });

  test("opts.package prefixes a `package` line; module description renders as KDoc", () => {
    const ir = module(
      "FeatureFlags",
      [constant("dual-camera", "bool", false)],
      "Feature flags.",
    );
    expect(emitKotlinModule(ir, { package: "com.secondsee.relay.protocol" })).toBe(
      "package com.secondsee.relay.protocol\n\n" +
        "/** Feature flags. */\n" +
        "object FeatureFlags {\n" +
        "    const val DUAL_CAMERA: Boolean = false\n" +
        "}\n",
    );
  });

  test("multi-line members (data class) are indented line-by-line", () => {
    const ir = module("Types", [struct("Cfg", [field("x", "int", { default: 0 })])]);
    expect(emitKotlinModule(ir)).toBe(
      "object Types {\n" +
        "    data class Cfg(\n" +
        "        val x: Int = 0\n" +
        "    )\n" +
        "}\n",
    );
  });
});

// ─── Named-type refs + arrays in fields (category 1) ──────────────────────

describe("emitKotlinDataClass — ref + array fields", () => {
  test("named ref, array-of-ref, array-of-primitive, nullable array", () => {
    const refField = (name: string, typeName: string, extra: Partial<IRField> = {}): IRField => ({
      name, jsonKey: name, type: "ref", typeName, optional: false, ...extra,
    });
    const s = struct("DeviceEntry", [
      refField("category", "DeviceCategory"),
      refField("platforms", "DevicePlatform", { isArray: true }),
      { name: "tags", jsonKey: "tags", type: "string", isArray: true, optional: false },
      refField("maybe", "X", { isArray: true, optional: true }),
    ]);
    expect(emitKotlinDataClass(s)).toBe(
      "data class DeviceEntry(\n" +
        "    val category: DeviceCategory,\n" +
        "    val platforms: List<DevicePlatform>,\n" +
        "    val tags: List<String>,\n" +
        "    val maybe: List<X>? = null\n" +
        ")",
    );
  });
});

// ─── Free-form type-alias RHS (category 3) ────────────────────────────────

describe("emitKotlinModule — type-alias rhs", () => {
  test("rhs emitted verbatim inside a module", () => {
    const ir = module("Types", [typeAlias("RoleMap", [], { rhs: "Map<String, String>" })]);
    expect(emitKotlinModule(ir)).toBe(
      "object Types {\n    typealias RoleMap = Map<String, String>\n}\n",
    );
  });
});

// ─── Imports dropped (category 2 — TS-oriented) ───────────────────────────

describe("emitKotlinModule — import members dropped", () => {
  test("TS-oriented import member produces no Kotlin output", () => {
    const ir = module("M", [
      irImport("./x.js", ["X"], true),
      typeAlias("T", [], { rhs: "String" }),
    ]);
    expect(emitKotlinModule(ir)).toBe("object M {\n    typealias T = String\n}\n");
  });
});
