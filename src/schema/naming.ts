// @ebowwa/codegen-kit/schema — case conversion + reserved word handling.
//
// Replaces 12+ reimplementations across secondsee's generators, each with
// subtly different edge cases. This is the single canonical implementation.

// ─── Case conversion ─────────────────────────────────────────────────────

export type CaseStyle = "kebab" | "camel" | "pascal" | "snake" | "screaming-snake" | "dot";

interface ConvertOpts {
  /** Preserve numeric prefixes like "s2s" → "s2s" (not "S2S").
   *  Matches secondsee's swift-config-structs.ts behavior. */
  preserveNumericPrefix?: boolean;
}

/** Split a string into segments by detecting the source case style. */
function splitSegments(input: string, from: CaseStyle): string[] {
  switch (from) {
    case "kebab":
      return input.split("-");
    case "snake":
      return input.split("_");
    case "screaming-snake":
      return input.split("_");
    case "dot":
      return input.split(".");
    case "camel":
    case "pascal":
      // Split on uppercase boundaries: "visionFps" → ["vision", "Fps"]
      // But preserve sequences like "IOU" → ["IOU"] (all-caps stays together)
      return input.replace(/([a-z0-9])([A-Z])/g, "$1\0$2").split("\0");
  }
}

/** Join segments into the target case style. */
function joinSegments(segments: string[], to: CaseStyle, opts?: ConvertOpts): string {
  const lower = segments.map((s, i) => {
    if (opts?.preserveNumericPrefix && /^\d/.test(s)) {
      // "s2s" → first char lowercase, rest lowercase (preserve as-is minus first char capitalization)
      return s.charAt(0).toLowerCase() + s.slice(1);
    }
    return s.toLowerCase();
  });

  switch (to) {
    case "kebab":
      return lower.join("-");
    case "snake":
      return lower.join("_");
    case "screaming-snake":
      return lower.map(s => s.toUpperCase()).join("_");
    case "dot":
      return lower.join(".");
    case "camel":
      return lower.map((s, i) => i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)).join("");
    case "pascal":
      return lower.map(s => {
        if (opts?.preserveNumericPrefix && /^\d/.test(s)) {
          // For PascalCase with numeric prefix: "s2s" → "S2s" (capitalize first alpha)
          return s.charAt(0).toUpperCase() + s.slice(1);
        }
        return s.charAt(0).toUpperCase() + s.slice(1);
      }).join("");
  }
}

/** Convert a string from one case style to another. */
export function convertCase(input: string, from: CaseStyle, to: CaseStyle, opts?: ConvertOpts): string {
  const segments = splitSegments(input, from);
  return joinSegments(segments, to, opts);
}

// ─── Convenience aliases ──────────────────────────────────────────────────

export function toPascalCase(input: string, from: CaseStyle = "kebab", opts?: ConvertOpts): string {
  return convertCase(input, from, "pascal", opts);
}

export function toCamelCase(input: string, from: CaseStyle = "kebab", opts?: ConvertOpts): string {
  return convertCase(input, from, "camel", opts);
}

export function toSnakeCase(input: string, from: CaseStyle = "camel"): string {
  return convertCase(input, from, "snake");
}

export function toScreamingSnake(input: string, from: CaseStyle = "kebab"): string {
  return convertCase(input, from, "screaming-snake");
}

// ─── Reserved word handling ──────────────────────────────────────────────

const SWIFT_KEYWORDS = new Set([
  "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
  "func", "import", "init", "inout", "internal", "let", "open", "operator",
  "private", "protocol", "public", "rethrows", "static", "struct", "subscript",
  "typealias", "var", "break", "case", "continue", "default", "defer", "do",
  "else", "fallthrough", "for", "guard", "if", "in", "repeat", "return",
  "switch", "where", "while", "as", "Any", "catch", "false", "is", "nil",
  "super", "Self", "self", "throw", "throws", "true", "try", "Type", "type",
  "async", "await", "unsafe", "each",
]);

const KOTLIN_KEYWORDS = new Set([
  "as", "break", "class", "continue", "do", "else", "false", "for", "fun",
  "if", "in", "interface", "is", "null", "object", "package", "return",
  "super", "this", "throw", "true", "try", "typealias", "typeof", "val",
  "var", "when", "while", "by", "catch", "constructor", "delegate",
  "dynamic", "field", "file", "finally", "get", "import", "infile",
  "init", "param", "property", "receiver", "set", "setparam", "value",
  "abstract", "actual", "annotation", "companion", "const", "crossinline",
  "data", "enum", "expect", "external", "final", "infix", "inline", "inner",
  "internal", "lateinit", "noinline", "open", "operator", "out", "override",
  "private", "protected", "public", "reified", "sealed", "suspend",
  "tailrec", "vararg", "where",
]);

/** Backtick-escape a Swift identifier if it's a keyword. */
export function escapeSwiftIdent(name: string): string {
  return SWIFT_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

/** Backtick-escape a Kotlin identifier if it's a keyword. */
export function escapeKotlinIdent(name: string): string {
  return KOTLIN_KEYWORDS.has(name) ? `\`${name}\`` : name;
}

/** Rename via an explicit map (e.g. { App: "AppRecord" }). Pass-through if not found. */
export function renameReserved(name: string, map: Record<string, string>): string {
  return map[name] ?? name;
}
