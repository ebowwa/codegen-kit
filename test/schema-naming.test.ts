import { describe, test, expect } from "bun:test";
import {
  convertCase,
  toPascalCase,
  toCamelCase,
  toSnakeCase,
  toScreamingSnake,
  escapeSwiftIdent,
  escapeKotlinIdent,
  renameReserved,
} from "../src/schema/naming.js";

describe("convertCase", () => {
  test("kebab → pascal", () => {
    expect(convertCase("vision-ocr", "kebab", "pascal")).toBe("VisionOcr");
    expect(convertCase("yolo-detect", "kebab", "pascal")).toBe("YoloDetect");
  });

  test("kebab → pascal with numeric prefix preservation", () => {
    expect(convertCase("s2s-live", "kebab", "pascal", { preserveNumericPrefix: true })).toBe("S2sLive");
    expect(convertCase("s2s-live", "kebab", "pascal")).toBe("S2sLive");
  });

  test("kebab → camel", () => {
    expect(convertCase("vision-fps", "kebab", "camel")).toBe("visionFps");
    expect(convertCase("dual-camera", "kebab", "camel")).toBe("dualCamera");
  });

  test("kebab → screaming-snake", () => {
    expect(convertCase("dual-camera", "kebab", "screaming-snake")).toBe("DUAL_CAMERA");
    expect(convertCase("auto-deactivate-min", "kebab", "screaming-snake")).toBe("AUTO_DEACTIVATE_MIN");
  });

  test("dot → camel", () => {
    expect(convertCase("stream.status.streaming", "dot", "camel")).toBe("streamStatusStreaming");
  });

  test("dot → snake", () => {
    expect(convertCase("stream.status.streaming", "dot", "snake")).toBe("stream_status_streaming");
  });

  test("camel → snake", () => {
    expect(convertCase("visionFps", "camel", "snake")).toBe("vision_fps");
    expect(convertCase("iouThreshold", "camel", "snake")).toBe("iou_threshold");
  });

  test("camel → pascal", () => {
    expect(convertCase("visionOcr", "camel", "pascal")).toBe("VisionOcr");
  });

  test("pascal → camel", () => {
    expect(convertCase("VisionOcr", "pascal", "camel")).toBe("visionOcr");
  });

  test("single word passes through", () => {
    expect(convertCase("camera", "kebab", "pascal")).toBe("Camera");
    expect(convertCase("Camera", "pascal", "camel")).toBe("camera");
  });
});

describe("convenience aliases", () => {
  test("toPascalCase defaults to kebab input", () => {
    expect(toPascalCase("data-filter")).toBe("DataFilter");
  });

  test("toCamelCase defaults to kebab input", () => {
    expect(toCamelCase("vision-fps")).toBe("visionFps");
  });

  test("toSnakeCase from camel", () => {
    expect(toSnakeCase("visionFps", "camel")).toBe("vision_fps");
  });

  test("toScreamingSnake defaults to kebab input", () => {
    expect(toScreamingSnake("dual-camera")).toBe("DUAL_CAMERA");
  });
});

describe("escapeSwiftIdent", () => {
  test("non-keyword passes through", () => {
    expect(escapeSwiftIdent("visionFps")).toBe("visionFps");
    expect(escapeSwiftIdent("codec")).toBe("codec");
  });

  test("keyword gets backticked", () => {
    expect(escapeSwiftIdent("class")).toBe("`class`");
    expect(escapeSwiftIdent("type")).toBe("`type`");
    expect(escapeSwiftIdent("init")).toBe("`init`");
    expect(escapeSwiftIdent("Self")).toBe("`Self`");
  });
});

describe("escapeKotlinIdent", () => {
  test("non-keyword passes through", () => {
    expect(escapeKotlinIdent("visionFps")).toBe("visionFps");
  });

  test("keyword gets backticked", () => {
    expect(escapeKotlinIdent("class")).toBe("`class`");
    expect(escapeKotlinIdent("fun")).toBe("`fun`");
    expect(escapeKotlinIdent("object")).toBe("`object`");
  });
});

describe("renameReserved", () => {
  test("renames when in map", () => {
    expect(renameReserved("App", { App: "AppRecord" })).toBe("AppRecord");
  });

  test("passes through when not in map", () => {
    expect(renameReserved("Camera", { App: "AppRecord" })).toBe("Camera");
  });
});
