import { describe, test, expect } from "bun:test";
import {
  emitTsInterface,
  emitTsTypeAlias,
  emitTsImport,
} from "../src/schema/emit/typescript.js";
import { struct, typeAlias, irImport } from "../src/schema/ir.js";
import type { IRField } from "../src/schema/ir.js";

/**
 * Byte-for-byte parity between the structured IR emitters and the `raw()`
 * blocks they replace in secondsee's node-codegen generators. Each test pins the
 * exact source a generator used to hand-write via `raw(...)`; if an emitter
 * changes shape, the corresponding generator's output would drift, and these
 * fail before the drift reaches a committed generated file.
 *
 * Conversions covered (categories 1–3 of the raw()-reduction work):
 *   devices.ts          — DeviceEntry interface        (named refs + arrays)
 *   dispatch-registry.ts — GeneratedDispatchEntry       (named ref)
 *   palette.ts          — type import                  (import member)
 *   sentinel-maps.ts    — type import + SentinelRoleMap (import + rhs alias)
 */

const f = (
  name: string,
  type: IRField["type"],
  extra: Partial<IRField> = {},
): IRField => ({ name, jsonKey: name, type, optional: false, ...extra });

describe("secondsee parity — raw() blocks replaced by structured IR", () => {
  test("devices.ts: DeviceEntry interface (refs + arrays)", () => {
    const old = [
      "export interface DeviceEntry {",
      "  id: string;",
      "  displayName: string;",
      "  vendor: string;",
      "  category: DeviceCategory;",
      "  platforms: DevicePlatform[];",
      "  capabilities: DeviceCapabilities;",
      "  status: DeviceStatus;",
      "  image?: string;",
      "  alt?: string;",
      "  mwdatSdkId?: string;",
      "  sfSymbol?: string;",
      "}",
    ].join("\n");
    const s = struct("DeviceEntry", [
      f("id", "string"),
      f("displayName", "string"),
      f("vendor", "string"),
      f("category", "ref", { typeName: "DeviceCategory" }),
      f("platforms", "ref", { typeName: "DevicePlatform", isArray: true }),
      f("capabilities", "ref", { typeName: "DeviceCapabilities" }),
      f("status", "ref", { typeName: "DeviceStatus" }),
      f("image", "string", { optional: true }),
      f("alt", "string", { optional: true }),
      f("mwdatSdkId", "string", { optional: true }),
      f("sfSymbol", "string", { optional: true }),
    ]);
    expect(emitTsInterface(s)).toBe(old);
  });

  test("dispatch-registry.ts: GeneratedDispatchEntry interface (named ref)", () => {
    const old = [
      "export interface GeneratedDispatchEntry {",
      "  mode: string;",
      "  handler: DispatchHandler;",
      "  wsMessageType: string;",
      "  category: string;",
      "  aggregatable: boolean;",
      "  mobileDispatch: boolean;",
      "}",
    ].join("\n");
    const s = struct("GeneratedDispatchEntry", [
      f("mode", "string"),
      f("handler", "ref", { typeName: "DispatchHandler" }),
      f("wsMessageType", "string"),
      f("category", "string"),
      f("aggregatable", "bool"),
      f("mobileDispatch", "bool"),
    ]);
    expect(emitTsInterface(s)).toBe(old);
  });

  test("palette.ts: type import", () => {
    const old = 'import type { NodeDefinition } from "../../../shared/types/workflow-types.js";';
    expect(emitTsImport(irImport("../../../shared/types/workflow-types.js", ["NodeDefinition"], true))).toBe(old);
  });

  test("sentinel-maps.ts: type import", () => {
    const old = 'import type { DeviceTarget } from "@ebowwa/workflow-edge";';
    expect(emitTsImport(irImport("@ebowwa/workflow-edge", ["DeviceTarget"], true))).toBe(old);
  });

  test("sentinel-maps.ts: SentinelRoleMap alias (free-form rhs)", () => {
    const old = 'export type SentinelRoleMap = Record<"sink" | "trigger" | "source", string[]>;';
    expect(
      emitTsTypeAlias(typeAlias("SentinelRoleMap", [], { rhs: 'Record<"sink" | "trigger" | "source", string[]>' })),
    ).toBe(old);
  });
});
