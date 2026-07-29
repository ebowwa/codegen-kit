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

export { writeOrCheck, writeOrCheckMany, diffLines, patchOrCheck } from "./write-check.js";
export type { WriteEntry, PatchChange, PatchResult } from "./write-check.js";

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

export {
  buildPackageGraph,
  classifyLayer,
  globToRegex,
  findAllPackageJsons,
  validateBuildOrder,
  validateLayerRules,
  findCriticalPath,
  generatePackageGraphJson,
  generatePackageGraphMd,
  generateCIMatrix,
  generateCIMatrixYaml,
  generateCIMatrixJson,
} from "./package-graph.js";
export type {
  PackageLayer,
  PackageNode,
  PackageGraph,
  GraphOpts,
  GraphIssue,
  MatrixLevel,
  CIMatrix,
} from "./package-graph.js";

export {
  createInternalResolver,
  generateAllPackageJsons,
  checkAllPackageJsons,
  runPackageManagerCli,
} from "./package-manager.js";
export type { PackageDefinition, PackageManagerOpts } from "./package-manager.js";
export {
  checkDepDrift,
  fixDepDrift,
  regenerateLockfiles,
  runDepSyncCli,
} from "./package-manager.js";
export type { DepDriftResult } from "./package-manager.js";

export { discoverInternalVersions, SKIP_DIRS } from "./version-discovery.js";
export type { VersionDiscoveryOpts } from "./version-discovery.js";

export { renderSystemsReference, renderSystemsGraph } from "./registry-reporting.js";
export type { SystemsReferenceOpts } from "./registry-reporting.js";
