// @ebowwa/codegen-kit — shared generate/validate/check scaffolding.
// Domain-agnostic. Consumers (HelloEbowwaOntology, secondsee/node-codegen, …)
// declare their own generators + validators on top of this kit.

export {
  autogenMeta,
  buildNumber,
  commentHeader,
  jsdocHeader,
  gitShortSha,
  generationTimestamp,
  stripVolatile,
} from "./generation-meta.js";
export type { AutogenMeta } from "./generation-meta.js";

export { writeOrCheck, writeOrCheckMany, diffLines } from "./write-check.js";
export type { WriteEntry } from "./write-check.js";

export { newResult, isMainEntry, runValidatorCli } from "./validator.js";
export type { ValidationError, ValidateResult, ResultBuilder } from "./validator.js";

export { runUmbrella } from "./umbrella.js";

export {
  getSystem,
  getSystemsByStatus,
  getActiveSystems,
  runSystemsGenerators,
  runSystemsValidators,
  runSystemsFix,
  computeCoverage,
  findMissingClaimedScripts,
} from "./systems.js";
export type {
  SystemContract,
  SystemStatus,
  SystemTarget,
  GeneratorSpec,
  SystemValidator,
  SystemsRunnerOpts,
  GenerateSystemsOpts,
  GenerateSystemsResult,
  ValidateSystemsResult,
  FixSystemsResult,
  StepResult,
  CoverageOpts,
  CoverageReport,
} from "./systems.js";
