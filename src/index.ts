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

export { writeOrCheck, writeOrCheckMany, diffLines, patchOrCheck, scaffoldFiles } from "./write-check.js";
export type { WriteEntry, PatchChange, PatchResult, ScaffoldEntry, ScaffoldResult } from "./write-check.js";

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

export {
  writeSnapshot,
  readSnapshot,
  diffSnapshots,
  renderMigrationChangelog,
  writeMigrationChangelog,
} from "./snapshot.js";
export type {
  SnapshotChange,
  SnapshotResult,
  SnapshotOpts,
  DiffRule,
  ChangeSeverity,
} from "./snapshot.js";

// ── shapes: declare a codebase's architectural shape as a checkable contract ──
// See ./shapes/*.js. Built-in probes register via side-effect when the runner is imported.
export type {
  ShapeArchetype,
  ShapeAxisKey,
  ShapeAxes,
  ShapeRelation,
  ShapeCompositionEdge,
} from "./shapes/ontology.js";
export type {
  ShapeStatus,
  InvariantSpec,
  ShapeProbe,
  ProbeContext,
  ShapeContract,
} from "./shapes/shape-contract.js";
export { registerProbe, getProbe, listProbes } from "./shapes/shape-contract.js";
export type {
  ModuleNode,
  ModuleEdge,
  ModuleGraph,
  GraphBuilderOpts,
  GraphBuilder,
} from "./shapes/graph.js";
export {
  findAllSourceFiles,
  extractSpecifiers,
  resolveSpecifier,
  regexGraphBuilder,
  findCycles,
} from "./shapes/graph.js";
export {
  noCyclesProbe,
  layerRulesProbe,
  symbolIsolationProbe,
  gateCoverageProbe,
  fingerprintProbe,
} from "./shapes/probes.js";
export { classifyShape } from "./shapes/classify.js";
export type { ShapeFingerprint } from "./shapes/classify.js";
export {
  serializeShape,
  defaultShapeDiffRules,
  writeShapeSnapshot,
  diffShapeSnapshot,
} from "./shapes/drift.js";
export type { ShapeSnapshotItem } from "./shapes/drift.js";
export { getActiveShapes, getShape, runShapesChecks } from "./shapes/runner.js";
export type { ShapeRunOpts, InvariantResult, ShapeCheckReport } from "./shapes/runner.js";
export { runShapesCli } from "./shapes/cli.js";
export type { ShapesCliConfig } from "./shapes/cli.js";
