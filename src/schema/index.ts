// @ebowwa/codegen-kit/schema — neutral IR + per-language emitters.
//
// Subpath import: `import { IRModule, emitSwiftModule } from "@ebowwa/codegen-kit/schema"`

// IR types + constructors
export * from "./ir.js";

// Naming utilities
export {
  convertCase,
  toPascalCase,
  toCamelCase,
  toSnakeCase,
  toScreamingSnake,
  escapeSwiftIdent,
  escapeKotlinIdent,
  renameReserved,
} from "./naming.js";
export type { CaseStyle } from "./naming.js";

// Per-language emitters
export {
  emitSwiftModule,
  emitSwiftStruct,
  emitSwiftConstant,
  emitSwiftConstantSet,
  emitSwiftConstantMap,
  emitSwiftEnum,
  emitSwiftResolver,
} from "./emit/swift.js";

export {
  emitKotlinModule,
  emitKotlinDataClass,
  emitKotlinConstant,
  emitKotlinConstantSet,
  emitKotlinConstantMap,
  emitKotlinEnum,
  emitKotlinResolver,
} from "./emit/kotlin.js";

export {
  emitTsModule,
  emitTsInterface,
  emitTsConstant,
  emitTsTypeAlias,
  emitTsConstantSet,
  emitTsConstantMap,
  emitTsResolver,
  emitTsImport,
} from "./emit/typescript.js";
