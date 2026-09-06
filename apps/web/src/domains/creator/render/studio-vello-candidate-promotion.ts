/**
 * Bounded, research-only promotion contract for the Vello GPU vector candidate.
 *
 * This module is deliberately pure TypeScript. It does not import Vello, probe a browser, allocate
 * a GPU resource, install a dependency, or register a renderer. A successful evaluation permits
 * only a future isolated proof of concept; it never authorizes a product runtime, document
 * authority, brush-pixel authority, or a package installation.
 */

export const STUDIO_VELLO_CANDIDATE_CONTRACT_VERSION =
  "studio-vello-candidate-promotion-v2" as const;

const MEBIBYTE = 1024 * 1024;

export const STUDIO_VELLO_CANDIDATE_PROVENANCE = Object.freeze({
  candidateId: "vello" as const,
  packageName: "vello" as const,
  auditedVersion: "0.9.0" as const,
  auditedSourceCommit:
    "875f324f21da93019cae9e8e61d4abfd69893206" as const,
  auditedOn: "2026-07-30" as const,
  versionEvidence:
    "published crates.io vello 0.9.0 audited 2026-07-30; not installed" as const,
  officialSource: "https://github.com/linebender/vello" as const,
  apiPreviewSource: "https://docs.rs/vello_api/0.9.0/vello_api/" as const,
  currentStrategyDisposition: "research-only" as const,
  currentInstallation: "not-installed" as const,
  productRoute: "none" as const,
  canonicalAuthority: false as const,
  brushPixelAuthority: false as const,
});

export const STUDIO_VELLO_CANDIDATE_ADVANTAGES = Object.freeze([
  Object.freeze({
    id: "gpu-vector-path-tessellation-compositing" as const,
    status: "candidate-hypothesis" as const,
    value:
      "Compute-centric GPU vector path tessellation and compositing could reduce CPU geometry and paint work.",
  }),
  Object.freeze({
    id: "retained-scene-scalability" as const,
    status: "candidate-hypothesis" as const,
    value:
      "A retained vector scene could scale settled multi-path redraws better than rebuilding every path on the CPU.",
  }),
  Object.freeze({
    id: "antialiasing-potential" as const,
    status: "candidate-hypothesis" as const,
    value:
      "The renderer has the potential to improve GPU vector coverage antialiasing at varied zoom levels.",
  }),
] as const);

export type StudioVelloCandidateAdvantageId =
  (typeof STUDIO_VELLO_CANDIDATE_ADVANTAGES)[number]["id"];

/**
 * Findings recorded by the 0.9.0 research audit. They are risks, not capability claims, and must
 * be superseded by official versioned evidence before an isolated proof of concept is eligible.
 */
export const STUDIO_VELLO_CURRENT_RESEARCH_RISKS = Object.freeze([
  Object.freeze({
    id: "alpha-upstream-status" as const,
    evidence:
      "The official 0.9.0 README describes the compute-centric renderer as alpha.",
  }),
  Object.freeze({
    id: "web-not-primary-target" as const,
    evidence:
      "The official 0.9.0 README says web is not a primary target.",
  }),
  Object.freeze({
    id: "browser-webgpu-coverage" as const,
    evidence:
      "The official audit records Chrome as tested while Firefox and Safari support remain experimental.",
  }),
  Object.freeze({
    id: "compute-shaders-required" as const,
    evidence:
      "The GPU renderer requires browser WebGPU compute-shader support.",
  }),
  Object.freeze({
    id: "unfinished-rendering-work" as const,
    evidence:
      "Blur/filter work, conflation artifacts, GPU memory allocation, and glyph caching remain unresolved.",
  }),
  Object.freeze({
    id: "cpu-hybrid-maturity-split" as const,
    evidence:
      "The official vello_api preview distinguishes the more mature CPU path from Vello Hybrid and calls out parity and fallback considerations.",
  }),
] as const);

export type StudioVelloCurrentResearchRiskId =
  (typeof STUDIO_VELLO_CURRENT_RESEARCH_RISKS)[number]["id"];

export const STUDIO_VELLO_REQUIRED_BROWSER_TARGETS = Object.freeze([
  "chrome",
  "firefox",
  "safari",
] as const);

export type StudioVelloRequiredBrowserTarget =
  (typeof STUDIO_VELLO_REQUIRED_BROWSER_TARGETS)[number];

export const STUDIO_VELLO_PROMOTION_LIMITS = Object.freeze({
  minimumDeviceLossTrials: 5,
  minimumParityFixturesPerOracle: 32,
  maximumPerceptualDelta: 1,
  maximumAlphaChannelDelta: 1 / 255,
  minimumLongStrokeAcceptedPoints: 50_000,
  minimumLongStrokeMeasuredFrames: 120,
  maximumLongStrokeP95Milliseconds: 16.67,
  maximumLongStrokeP99Milliseconds: 33.34,
  minimumRetainedScenePathCount: 10_000,
  maximumPeakGpuBytes: 256 * MEBIBYTE,
  maximumPeakHostBytes: 256 * MEBIBYTE,
  maximumPostDisposeRetainedBytes: 8 * MEBIBYTE,
  minimumCompatibilityReplayTrials: 5,
});

export const STUDIO_VELLO_PROMOTION_GATE_IDS = Object.freeze([
  "official-web-support-maturity",
  "upstream-release-maturity",
  "webgpu-adapter-device-loss-recovery",
  "canvas-svg-canonical-visual-parity",
  "long-stroke-latency",
  "bounded-memory",
  "deterministic-legacy-compatibility-boundary",
  "required-browser-support",
] as const);

export type StudioVelloPromotionGateId =
  (typeof STUDIO_VELLO_PROMOTION_GATE_IDS)[number];

export interface StudioVelloPromotionGateDefinition {
  readonly id: StudioVelloPromotionGateId;
  readonly hard: true;
  readonly weight: number;
  readonly requirement: string;
}

/**
 * Weights make readiness progress visible. They are never compensatory: every gate is hard and
 * the only promotable score is 100.
 */
export const STUDIO_VELLO_PROMOTION_GATES:
readonly StudioVelloPromotionGateDefinition[] = Object.freeze([
  Object.freeze({
    id: "official-web-support-maturity",
    hard: true,
    weight: 15,
    requirement:
      "Official versioned Vello evidence must call web a production-grade primary target.",
  }),
  Object.freeze({
    id: "upstream-release-maturity",
    hard: true,
    weight: 15,
    requirement:
      "The evaluated renderer must no longer be alpha or beta and must have no audited production blockers.",
  }),
  Object.freeze({
    id: "webgpu-adapter-device-loss-recovery",
    hard: true,
    weight: 15,
    requirement:
      "Adapter/device acquisition and repeated device-loss recovery must recreate from canonical state and reject stale GPU work.",
  }),
  Object.freeze({
    id: "canvas-svg-canonical-visual-parity",
    hard: true,
    weight: 15,
    requirement:
      "Bounded Canvas2D, SVG, and canonical-oracle fixture suites must all pass within fixed color and alpha tolerances.",
  }),
  Object.freeze({
    id: "long-stroke-latency",
    hard: true,
    weight: 10,
    requirement:
      "A 50k-point long-stroke benchmark must stay within the fixed p95/p99 budgets and not regress the canonical baseline.",
  }),
  Object.freeze({
    id: "bounded-memory",
    hard: true,
    weight: 10,
    requirement:
      "A 10k-path retained scene must stay within GPU, host, and post-dispose budgets without unbounded growth.",
  }),
  Object.freeze({
    id: "deterministic-legacy-compatibility-boundary",
    hard: true,
    weight: 10,
    requirement:
      "The legacy Canvas2D/SVG compatibility boundary must be selected before execution, deterministic, and receipted without runtime failover.",
  }),
  Object.freeze({
    id: "required-browser-support",
    hard: true,
    weight: 10,
    requirement:
      "Chrome, Firefox, and Safari must each have production support plus passing compute, adapter/device, and device-loss suites.",
  }),
]);

export type StudioVelloProbeStatus = "not-run" | "failed" | "passed";
export type StudioVelloWebSupportMaturity =
  | "unknown"
  | "not-primary-target"
  | "experimental"
  | "production-grade";
export type StudioVelloReleaseStage =
  | "unknown"
  | "alpha"
  | "beta"
  | "release-candidate"
  | "stable";
export type StudioVelloBrowserSupport =
  | "unsupported"
  | "experimental"
  | "tested"
  | "production";

/**
 * Every promotion record must carry the exact identity of the evaluated build. Matching only a
 * package version is insufficient because it permits parity, recovery, and performance evidence
 * from different commits or builds to be combined into one apparently passing audit.
 */
export interface StudioVelloEvidenceIdentity {
  readonly evaluatedVersion: string;
  readonly sourceCommit: string;
  readonly buildFingerprint: string;
}

export interface StudioVelloOfficialWebSupportEvidence
extends StudioVelloEvidenceIdentity {
  readonly maturity: StudioVelloWebSupportMaturity;
  readonly webIsPrimaryTarget: boolean;
  readonly sourceUrl: string;
}

export interface StudioVelloUpstreamMaturityEvidence
extends StudioVelloEvidenceIdentity {
  readonly releaseStage: StudioVelloReleaseStage;
  readonly alphaLabelPresent: boolean;
  readonly productionBlockers: readonly string[];
  readonly sourceUrl: string;
}

export interface StudioVelloWebGpuRecoveryEvidence
extends StudioVelloEvidenceIdentity {
  readonly probe: StudioVelloProbeStatus;
  readonly adapterAcquisitionPassed: boolean;
  readonly deviceAcquisitionPassed: boolean;
  readonly deviceLossTrials: number;
  readonly recoveredDeviceLossTrials: number;
  readonly recreatedFromCanonicalScene: boolean;
  readonly staleGpuWorkRejected: boolean;
}

export interface StudioVelloParityFixtureEvidence
extends StudioVelloEvidenceIdentity {
  readonly total: number;
  readonly passed: number;
}

export interface StudioVelloVisualParityEvidence
extends StudioVelloEvidenceIdentity {
  readonly probe: StudioVelloProbeStatus;
  readonly canvas2d: StudioVelloParityFixtureEvidence;
  readonly svg: StudioVelloParityFixtureEvidence;
  readonly canonical: StudioVelloParityFixtureEvidence;
  readonly maxPerceptualDelta: number;
  readonly maxAlphaChannelDelta: number;
  readonly premultipliedAlphaFixturesPassed: boolean;
  readonly compositingFixturesPassed: boolean;
}

export interface StudioVelloLongStrokeLatencyEvidence
extends StudioVelloEvidenceIdentity {
  readonly probe: StudioVelloProbeStatus;
  readonly acceptedPointCount: number;
  readonly measuredFrameCount: number;
  readonly candidateP95Milliseconds: number;
  readonly candidateP99Milliseconds: number;
  readonly canonicalP95Milliseconds: number;
}

export interface StudioVelloMemoryEvidence
extends StudioVelloEvidenceIdentity {
  readonly probe: StudioVelloProbeStatus;
  readonly retainedScenePathCount: number;
  readonly peakGpuBytes: number;
  readonly peakHostBytes: number;
  readonly postDisposeRetainedBytes: number;
  readonly unboundedGrowthDetected: boolean;
}

export interface StudioVelloLegacyCompatibilityEvidence
extends StudioVelloEvidenceIdentity {
  readonly probe: StudioVelloProbeStatus;
  readonly compatibilityKind: "legacy-canvas2d-svg";
  readonly replayTrials: number;
  readonly uniqueReplayHashes: number;
  readonly compatibilitySelectionDeclaredBeforeExecution: boolean;
  readonly canvas2dHashMatchesCanonical: boolean;
  readonly svgExportHashStable: boolean;
  readonly canonicalReceiptVerified: boolean;
}

export interface StudioVelloBrowserEvidence
extends StudioVelloEvidenceIdentity {
  readonly browser: StudioVelloRequiredBrowserTarget;
  readonly support: StudioVelloBrowserSupport;
  readonly computeShaderSuitePassed: boolean;
  readonly adapterDeviceSuitePassed: boolean;
  readonly deviceLossSuitePassed: boolean;
}

export interface StudioVelloPromotionEvidence
extends StudioVelloEvidenceIdentity {
  readonly officialWebSupport: StudioVelloOfficialWebSupportEvidence;
  readonly upstreamMaturity: StudioVelloUpstreamMaturityEvidence;
  readonly webGpuRecovery: StudioVelloWebGpuRecoveryEvidence;
  readonly visualParity: StudioVelloVisualParityEvidence;
  readonly longStrokeLatency: StudioVelloLongStrokeLatencyEvidence;
  readonly memory: StudioVelloMemoryEvidence;
  readonly legacyCompatibility: StudioVelloLegacyCompatibilityEvidence;
  readonly browsers: readonly StudioVelloBrowserEvidence[];
}

export type StudioVelloGateEvidenceState =
  | "passed"
  | "failed"
  | "missing-or-malformed";

export interface StudioVelloPromotionGateResult {
  readonly id: StudioVelloPromotionGateId;
  readonly hard: true;
  readonly weight: number;
  readonly state: StudioVelloGateEvidenceState;
  readonly passed: boolean;
  readonly detail: string;
}

export interface StudioVelloPromotionScore {
  readonly earned: number;
  readonly possible: 100;
  readonly percent: number;
  readonly passedGateCount: number;
  readonly totalGateCount: number;
}

export type StudioVelloCandidatePromotionStatus =
  | "research-only"
  | "eligible-for-isolated-poc";

export interface StudioVelloCandidateEvaluation {
  readonly contractVersion: typeof STUDIO_VELLO_CANDIDATE_CONTRACT_VERSION;
  readonly candidateId: "vello";
  readonly status: StudioVelloCandidatePromotionStatus;
  readonly reason:
    | "all-hard-gates-passed"
    | "hard-gate-failed"
    | "missing-or-malformed-evidence";
  readonly promotionScope: "research-to-isolated-poc-only";
  readonly allHardGatesPassed: boolean;
  readonly failClosed: boolean;
  readonly runtimeActivationAllowed: false;
  readonly dependencyInstallationAuthorized: false;
  readonly canonicalAuthority: false;
  readonly brushPixelAuthority: false;
  readonly score: StudioVelloPromotionScore;
  readonly gateResults: readonly StudioVelloPromotionGateResult[];
  readonly blockingGateIds: readonly StudioVelloPromotionGateId[];
  readonly malformedGateIds: readonly StudioVelloPromotionGateId[];
}

interface RawGateEvaluation {
  readonly valid: boolean;
  readonly passed: boolean;
  readonly detail: string;
}

type UnknownRecord = Record<string, unknown>;

const PROBE_STATUSES: readonly StudioVelloProbeStatus[] = [
  "not-run",
  "failed",
  "passed",
];
const WEB_SUPPORT_MATURITIES: readonly StudioVelloWebSupportMaturity[] = [
  "unknown",
  "not-primary-target",
  "experimental",
  "production-grade",
];
const RELEASE_STAGES: readonly StudioVelloReleaseStage[] = [
  "unknown",
  "alpha",
  "beta",
  "release-candidate",
  "stable",
];
const BROWSER_SUPPORT_LEVELS: readonly StudioVelloBrowserSupport[] = [
  "unsupported",
  "experimental",
  "tested",
  "production",
];
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const BUILD_FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UNAVAILABLE_BUILD_FINGERPRINT = "unavailable:not-installed";

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function inspectEvidenceIdentity(
  value: unknown,
): StudioVelloEvidenceIdentity | null {
  if (
    !isRecord(value)
    || !isNonEmptyString(value.evaluatedVersion)
    || !isNonEmptyString(value.sourceCommit)
    || !SOURCE_COMMIT_PATTERN.test(value.sourceCommit)
    || !isNonEmptyString(value.buildFingerprint)
    || (
      value.buildFingerprint !== UNAVAILABLE_BUILD_FINGERPRINT
      && !BUILD_FINGERPRINT_PATTERN.test(value.buildFingerprint)
    )
  ) {
    return null;
  }
  return {
    evaluatedVersion: value.evaluatedVersion,
    sourceCommit: value.sourceCommit,
    buildFingerprint: value.buildFingerprint,
  };
}

function evidenceIdentityMatches(
  value: unknown,
  expected: StudioVelloEvidenceIdentity,
): boolean {
  const actual = inspectEvidenceIdentity(value);
  return actual !== null
    && actual.evaluatedVersion === expected.evaluatedVersion
    && actual.sourceCommit === expected.sourceCommit
    && actual.buildFingerprint === expected.buildFingerprint;
}

function hasPromotableBuildFingerprint(
  identity: StudioVelloEvidenceIdentity,
): boolean {
  return BUILD_FINGERPRINT_PATTERN.test(identity.buildFingerprint);
}

function isEnumMember<T extends string>(
  value: unknown,
  members: readonly T[],
): value is T {
  return typeof value === "string" && members.includes(value as T);
}

function isOfficialVelloSourceUrl(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): value is string {
  if (!isNonEmptyString(value)) return false;
  const repository = STUDIO_VELLO_CANDIDATE_PROVENANCE.officialSource;
  const versionedDocs =
    `https://docs.rs/vello_api/${identity.evaluatedVersion}/vello_api/`;
  return value === `${repository}/commit/${identity.sourceCommit}`
    || value === `${repository}/tree/${identity.sourceCommit}`
    || value === `${repository}/releases/tag/v${identity.evaluatedVersion}`
    || value === versionedDocs
    || value.startsWith(versionedDocs);
}

function invalidGateEvidence(): RawGateEvaluation {
  return {
    valid: false,
    passed: false,
    detail: "Required evidence is missing or malformed; promotion fails closed.",
  };
}

function evaluateOfficialWebSupport(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.maturity, WEB_SUPPORT_MATURITIES)
    || !isBoolean(value.webIsPrimaryTarget)
    || !isOfficialVelloSourceUrl(value.sourceUrl, identity)
  ) {
    return invalidGateEvidence();
  }
  const passed = value.maturity === "production-grade"
    && value.webIsPrimaryTarget;
  return {
    valid: true,
    passed,
    detail: passed
      ? "Official versioned evidence identifies web as a production-grade primary target."
      : "Official evidence does not identify web as a production-grade primary target.",
  };
}

function evaluateUpstreamMaturity(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.releaseStage, RELEASE_STAGES)
    || !isBoolean(value.alphaLabelPresent)
    || !isStringArray(value.productionBlockers)
    || !isOfficialVelloSourceUrl(value.sourceUrl, identity)
  ) {
    return invalidGateEvidence();
  }
  const passed = value.releaseStage === "stable"
    && !value.alphaLabelPresent
    && value.productionBlockers.length === 0;
  return {
    valid: true,
    passed,
    detail: passed
      ? "The evaluated renderer is stable, is not labeled alpha, and has no audited production blockers."
      : "Alpha/beta status or audited production blockers still prevent promotion.",
  };
}

function evaluateWebGpuRecovery(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.probe, PROBE_STATUSES)
    || !isBoolean(value.adapterAcquisitionPassed)
    || !isBoolean(value.deviceAcquisitionPassed)
    || !isNonNegativeInteger(value.deviceLossTrials)
    || !isNonNegativeInteger(value.recoveredDeviceLossTrials)
    || value.recoveredDeviceLossTrials > value.deviceLossTrials
    || !isBoolean(value.recreatedFromCanonicalScene)
    || !isBoolean(value.staleGpuWorkRejected)
  ) {
    return invalidGateEvidence();
  }
  const passed = value.probe === "passed"
    && value.adapterAcquisitionPassed
    && value.deviceAcquisitionPassed
    && value.deviceLossTrials
      >= STUDIO_VELLO_PROMOTION_LIMITS.minimumDeviceLossTrials
    && value.recoveredDeviceLossTrials === value.deviceLossTrials
    && value.recreatedFromCanonicalScene
    && value.staleGpuWorkRejected;
  return {
    valid: true,
    passed,
    detail: passed
      ? "Adapter/device acquisition and every bounded loss trial recovered from canonical state."
      : "Adapter/device acquisition or bounded canonical device-loss recovery is unproven.",
  };
}

function isParityFixtureEvidence(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): value is StudioVelloParityFixtureEvidence {
  return isRecord(value)
    && evidenceIdentityMatches(value, identity)
    && isNonNegativeInteger(value.total)
    && isNonNegativeInteger(value.passed)
    && value.passed <= value.total;
}

function parityFixturePassed(
  value: StudioVelloParityFixtureEvidence,
): boolean {
  return value.total
      >= STUDIO_VELLO_PROMOTION_LIMITS.minimumParityFixturesPerOracle
    && value.passed === value.total;
}

function evaluateVisualParity(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.probe, PROBE_STATUSES)
    || !isParityFixtureEvidence(value.canvas2d, identity)
    || !isParityFixtureEvidence(value.svg, identity)
    || !isParityFixtureEvidence(value.canonical, identity)
    || !isFiniteNonNegativeNumber(value.maxPerceptualDelta)
    || !isFiniteNonNegativeNumber(value.maxAlphaChannelDelta)
    || !isBoolean(value.premultipliedAlphaFixturesPassed)
    || !isBoolean(value.compositingFixturesPassed)
  ) {
    return invalidGateEvidence();
  }
  const passed = value.probe === "passed"
    && parityFixturePassed(value.canvas2d)
    && parityFixturePassed(value.svg)
    && parityFixturePassed(value.canonical)
    && value.maxPerceptualDelta
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumPerceptualDelta
    && value.maxAlphaChannelDelta
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumAlphaChannelDelta
    && value.premultipliedAlphaFixturesPassed
    && value.compositingFixturesPassed;
  return {
    valid: true,
    passed,
    detail: passed
      ? "Canvas2D, SVG, and canonical visual fixtures pass the bounded parity contract."
      : "Canvas2D, SVG, canonical, alpha, or compositing parity is below the fixed requirement.",
  };
}

function evaluateLongStrokeLatency(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.probe, PROBE_STATUSES)
    || !isNonNegativeInteger(value.acceptedPointCount)
    || !isNonNegativeInteger(value.measuredFrameCount)
    || !isFiniteNonNegativeNumber(value.candidateP95Milliseconds)
    || !isFiniteNonNegativeNumber(value.candidateP99Milliseconds)
    || !isFiniteNonNegativeNumber(value.canonicalP95Milliseconds)
    || value.candidateP99Milliseconds < value.candidateP95Milliseconds
  ) {
    return invalidGateEvidence();
  }
  const passed = value.probe === "passed"
    && value.acceptedPointCount
      >= STUDIO_VELLO_PROMOTION_LIMITS.minimumLongStrokeAcceptedPoints
    && value.measuredFrameCount
      >= STUDIO_VELLO_PROMOTION_LIMITS.minimumLongStrokeMeasuredFrames
    && value.candidateP95Milliseconds
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumLongStrokeP95Milliseconds
    && value.candidateP99Milliseconds
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumLongStrokeP99Milliseconds
    && value.candidateP95Milliseconds <= value.canonicalP95Milliseconds;
  return {
    valid: true,
    passed,
    detail: passed
      ? "Long-stroke p95/p99 latency passes the fixed budget without a canonical-baseline regression."
      : "Long-stroke coverage, p95/p99 latency, or canonical-baseline comparison fails the fixed budget.",
  };
}

function evaluateMemory(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.probe, PROBE_STATUSES)
    || !isNonNegativeInteger(value.retainedScenePathCount)
    || !isNonNegativeInteger(value.peakGpuBytes)
    || !isNonNegativeInteger(value.peakHostBytes)
    || !isNonNegativeInteger(value.postDisposeRetainedBytes)
    || !isBoolean(value.unboundedGrowthDetected)
  ) {
    return invalidGateEvidence();
  }
  const passed = value.probe === "passed"
    && value.retainedScenePathCount
      >= STUDIO_VELLO_PROMOTION_LIMITS.minimumRetainedScenePathCount
    && value.peakGpuBytes
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumPeakGpuBytes
    && value.peakHostBytes
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumPeakHostBytes
    && value.postDisposeRetainedBytes
      <= STUDIO_VELLO_PROMOTION_LIMITS.maximumPostDisposeRetainedBytes
    && !value.unboundedGrowthDetected;
  return {
    valid: true,
    passed,
    detail: passed
      ? "The bounded retained-scene run stays within GPU, host, and post-dispose memory limits."
      : "Retained-scene coverage, memory limits, disposal, or growth behavior fails the fixed budget.",
  };
}

function evaluateLegacyCompatibility(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !isRecord(value)
    || !evidenceIdentityMatches(value, identity)
    || !isEnumMember(value.probe, PROBE_STATUSES)
    || value.compatibilityKind !== "legacy-canvas2d-svg"
    || !isNonNegativeInteger(value.replayTrials)
    || !isNonNegativeInteger(value.uniqueReplayHashes)
    || value.uniqueReplayHashes > value.replayTrials
    || !isBoolean(value.compatibilitySelectionDeclaredBeforeExecution)
    || !isBoolean(value.canvas2dHashMatchesCanonical)
    || !isBoolean(value.svgExportHashStable)
    || !isBoolean(value.canonicalReceiptVerified)
  ) {
    return invalidGateEvidence();
  }
  const passed = value.probe === "passed"
    && value.replayTrials
      >= STUDIO_VELLO_PROMOTION_LIMITS.minimumCompatibilityReplayTrials
    && value.uniqueReplayHashes === 1
    && value.compatibilitySelectionDeclaredBeforeExecution
    && value.canvas2dHashMatchesCanonical
    && value.svgExportHashStable
    && value.canonicalReceiptVerified;
  return {
    valid: true,
    passed,
    detail: passed
      ? "The legacy Canvas2D/SVG boundary is selected before execution, deterministic, and receipted."
      : "Legacy Canvas2D/SVG boundary declaration, determinism, or its receipt is unproven.",
  };
}

function isBrowserEvidence(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): value is StudioVelloBrowserEvidence {
  return isRecord(value)
    && evidenceIdentityMatches(value, identity)
    && isEnumMember(value.browser, STUDIO_VELLO_REQUIRED_BROWSER_TARGETS)
    && isEnumMember(value.support, BROWSER_SUPPORT_LEVELS)
    && isBoolean(value.computeShaderSuitePassed)
    && isBoolean(value.adapterDeviceSuitePassed)
    && isBoolean(value.deviceLossSuitePassed);
}

function evaluateBrowsers(
  value: unknown,
  identity: StudioVelloEvidenceIdentity,
): RawGateEvaluation {
  if (
    !Array.isArray(value)
    || !value.every((browser) => isBrowserEvidence(browser, identity))
  ) {
    return invalidGateEvidence();
  }
  const evidenceByBrowser = new Map<
    StudioVelloRequiredBrowserTarget,
    StudioVelloBrowserEvidence
  >();
  let duplicateBrowser = false;
  for (const browserEvidence of value) {
    if (evidenceByBrowser.has(browserEvidence.browser)) {
      duplicateBrowser = true;
    }
    evidenceByBrowser.set(browserEvidence.browser, browserEvidence);
  }
  const passed = !duplicateBrowser
    && STUDIO_VELLO_REQUIRED_BROWSER_TARGETS.every((browser) => {
      const evidence = evidenceByBrowser.get(browser);
      return evidence?.support === "production"
        && evidence.computeShaderSuitePassed
        && evidence.adapterDeviceSuitePassed
        && evidence.deviceLossSuitePassed;
    });
  return {
    valid: true,
    passed,
    detail: passed
      ? "Every required browser has production support and passes the required WebGPU suites."
      : "One or more required browsers lacks unique production-grade compute, adapter/device, or loss evidence.",
  };
}

const GATE_EVALUATORS: Readonly<
  Record<
    StudioVelloPromotionGateId,
    (
      value: unknown,
      identity: StudioVelloEvidenceIdentity,
    ) => RawGateEvaluation
  >
> = Object.freeze({
  "official-web-support-maturity": evaluateOfficialWebSupport,
  "upstream-release-maturity": evaluateUpstreamMaturity,
  "webgpu-adapter-device-loss-recovery": evaluateWebGpuRecovery,
  "canvas-svg-canonical-visual-parity": evaluateVisualParity,
  "long-stroke-latency": evaluateLongStrokeLatency,
  "bounded-memory": evaluateMemory,
  "deterministic-legacy-compatibility-boundary": evaluateLegacyCompatibility,
  "required-browser-support": evaluateBrowsers,
});

const GATE_EVIDENCE_FIELDS: Readonly<
  Record<StudioVelloPromotionGateId, keyof StudioVelloPromotionEvidence>
> = Object.freeze({
  "official-web-support-maturity": "officialWebSupport",
  "upstream-release-maturity": "upstreamMaturity",
  "webgpu-adapter-device-loss-recovery": "webGpuRecovery",
  "canvas-svg-canonical-visual-parity": "visualParity",
  "long-stroke-latency": "longStrokeLatency",
  "bounded-memory": "memory",
  "deterministic-legacy-compatibility-boundary": "legacyCompatibility",
  "required-browser-support": "browsers",
});

export function evaluateStudioVelloPromotionGates(
  input: unknown,
): readonly StudioVelloPromotionGateResult[] {
  const evidence = isRecord(input) ? input : null;
  const identity = inspectEvidenceIdentity(evidence);
  return Object.freeze(
    STUDIO_VELLO_PROMOTION_GATES.map((definition) => {
      const evidenceField = GATE_EVIDENCE_FIELDS[definition.id];
      const evaluated = identity === null
        ? invalidGateEvidence()
        : GATE_EVALUATORS[definition.id](
          evidence?.[evidenceField],
          identity,
        );
      const raw = evaluated.passed
        && identity !== null
        && !hasPromotableBuildFingerprint(identity)
        ? {
          valid: true,
          passed: false,
          detail:
            "The evidence bundle has no content-addressed build fingerprint; promotion fails closed.",
        }
        : evaluated;
      const state: StudioVelloGateEvidenceState = !raw.valid
        ? "missing-or-malformed"
        : raw.passed
          ? "passed"
          : "failed";
      return Object.freeze({
        id: definition.id,
        hard: true as const,
        weight: definition.weight,
        state,
        passed: raw.passed,
        detail: raw.detail,
      });
    }),
  );
}

function scoreGateResults(
  gateResults: readonly StudioVelloPromotionGateResult[],
): StudioVelloPromotionScore {
  const earned = gateResults.reduce(
    (total, result) => total + (result.passed ? result.weight : 0),
    0,
  );
  const possible = STUDIO_VELLO_PROMOTION_GATES.reduce(
    (total, gate) => total + gate.weight,
    0,
  );
  const percent = possible === 0
    ? 0
    : Math.round((earned / possible) * 10_000) / 100;
  return Object.freeze({
    earned,
    possible: 100 as const,
    percent,
    passedGateCount: gateResults.filter(({ passed }) => passed).length,
    totalGateCount: gateResults.length,
  });
}

/**
 * Diagnostic readiness score. It cannot compensate for any failed hard gate.
 */
export function scoreStudioVelloPromotionEvidence(
  input: unknown,
): StudioVelloPromotionScore {
  return scoreGateResults(evaluateStudioVelloPromotionGates(input));
}

/**
 * Evaluates only evidence supplied by the caller. Missing, malformed, stale, unsupported, or
 * below-budget evidence holds the candidate at research-only. Passing all gates can promote only
 * to an isolated PoC evaluation; product runtime activation always remains forbidden.
 */
export function evaluateStudioVelloCandidate(
  input: unknown,
): StudioVelloCandidateEvaluation {
  const gateResults = evaluateStudioVelloPromotionGates(input);
  const score = scoreGateResults(gateResults);
  const blockingGateIds = Object.freeze(
    gateResults
      .filter(({ passed }) => !passed)
      .map(({ id }) => id),
  );
  const malformedGateIds = Object.freeze(
    gateResults
      .filter(({ state }) => state === "missing-or-malformed")
      .map(({ id }) => id),
  );
  const allHardGatesPassed = blockingGateIds.length === 0
    && score.earned === score.possible;
  const reason = allHardGatesPassed
    ? "all-hard-gates-passed"
    : malformedGateIds.length > 0
      ? "missing-or-malformed-evidence"
      : "hard-gate-failed";
  return Object.freeze({
    contractVersion: STUDIO_VELLO_CANDIDATE_CONTRACT_VERSION,
    candidateId: "vello" as const,
    status: allHardGatesPassed
      ? "eligible-for-isolated-poc" as const
      : "research-only" as const,
    reason,
    promotionScope: "research-to-isolated-poc-only" as const,
    allHardGatesPassed,
    failClosed: !allHardGatesPassed,
    runtimeActivationAllowed: false as const,
    dependencyInstallationAuthorized: false as const,
    canonicalAuthority: false as const,
    brushPixelAuthority: false as const,
    score,
    gateResults,
    blockingGateIds,
    malformedGateIds,
  });
}

const CURRENT_RESEARCH_IDENTITY = Object.freeze({
  evaluatedVersion: STUDIO_VELLO_CANDIDATE_PROVENANCE.auditedVersion,
  sourceCommit: STUDIO_VELLO_CANDIDATE_PROVENANCE.auditedSourceCommit,
  // The package is intentionally not installed in product code, so no build fingerprint exists.
  // This sentinel is identity-consistent but can never satisfy a passing promotion audit.
  buildFingerprint: UNAVAILABLE_BUILD_FINGERPRINT,
});
const NO_PARITY_FIXTURES = Object.freeze({
  ...CURRENT_RESEARCH_IDENTITY,
  total: 0,
  passed: 0,
});

/**
 * The audited 0.9.0 baseline. It is complete enough to fail as researched evidence rather than
 * accidentally passing through missing values, and it makes no runtime or benchmark claims.
 */
export const STUDIO_VELLO_CURRENT_RESEARCH_EVIDENCE:
StudioVelloPromotionEvidence = Object.freeze({
  ...CURRENT_RESEARCH_IDENTITY,
  officialWebSupport: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    maturity: "not-primary-target",
    webIsPrimaryTarget: false,
    sourceUrl:
      `${STUDIO_VELLO_CANDIDATE_PROVENANCE.officialSource}/commit/`
      + STUDIO_VELLO_CANDIDATE_PROVENANCE.auditedSourceCommit,
  }),
  upstreamMaturity: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    releaseStage: "alpha",
    alphaLabelPresent: true,
    productionBlockers: Object.freeze([
      "blur-and-filter-effects",
      "conflation-artifacts",
      "gpu-memory-allocation",
      "glyph-caching",
    ]),
    sourceUrl: STUDIO_VELLO_CANDIDATE_PROVENANCE.apiPreviewSource,
  }),
  webGpuRecovery: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    probe: "not-run",
    adapterAcquisitionPassed: false,
    deviceAcquisitionPassed: false,
    deviceLossTrials: 0,
    recoveredDeviceLossTrials: 0,
    recreatedFromCanonicalScene: false,
    staleGpuWorkRejected: false,
  }),
  visualParity: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    probe: "not-run",
    canvas2d: NO_PARITY_FIXTURES,
    svg: NO_PARITY_FIXTURES,
    canonical: NO_PARITY_FIXTURES,
    maxPerceptualDelta: 0,
    maxAlphaChannelDelta: 0,
    premultipliedAlphaFixturesPassed: false,
    compositingFixturesPassed: false,
  }),
  longStrokeLatency: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    probe: "not-run",
    acceptedPointCount: 0,
    measuredFrameCount: 0,
    candidateP95Milliseconds: 0,
    candidateP99Milliseconds: 0,
    canonicalP95Milliseconds: 0,
  }),
  memory: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    probe: "not-run",
    retainedScenePathCount: 0,
    peakGpuBytes: 0,
    peakHostBytes: 0,
    postDisposeRetainedBytes: 0,
    unboundedGrowthDetected: false,
  }),
  legacyCompatibility: Object.freeze({
    ...CURRENT_RESEARCH_IDENTITY,
    probe: "not-run",
    compatibilityKind: "legacy-canvas2d-svg",
    replayTrials: 0,
    uniqueReplayHashes: 0,
    compatibilitySelectionDeclaredBeforeExecution: false,
    canvas2dHashMatchesCanonical: false,
    svgExportHashStable: false,
    canonicalReceiptVerified: false,
  }),
  browsers: Object.freeze([
    Object.freeze({
      ...CURRENT_RESEARCH_IDENTITY,
      browser: "chrome",
      support: "tested",
      computeShaderSuitePassed: false,
      adapterDeviceSuitePassed: false,
      deviceLossSuitePassed: false,
    }),
    Object.freeze({
      ...CURRENT_RESEARCH_IDENTITY,
      browser: "firefox",
      support: "experimental",
      computeShaderSuitePassed: false,
      adapterDeviceSuitePassed: false,
      deviceLossSuitePassed: false,
    }),
    Object.freeze({
      ...CURRENT_RESEARCH_IDENTITY,
      browser: "safari",
      support: "experimental",
      computeShaderSuitePassed: false,
      adapterDeviceSuitePassed: false,
      deviceLossSuitePassed: false,
    }),
  ]),
});

export const STUDIO_VELLO_CURRENT_CANDIDATE_EVALUATION =
  evaluateStudioVelloCandidate(STUDIO_VELLO_CURRENT_RESEARCH_EVIDENCE);
