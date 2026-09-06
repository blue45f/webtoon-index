/**
 * Durable contract and shared render plan for perfect-freehand outline strokes.
 *
 * The document layer must not infer renderer semantics from a brush id or from whether a pressure
 * array happens to be present. A pointer-start caller captures this small JSON-safe contract once,
 * persists it with the stroke, and every live/retained/export renderer resolves the same snapshot.
 *
 * Missing metadata is deliberately classified as `legacy`; malformed or future metadata is
 * `unsupported` and must be surfaced to the caller instead of silently changing pixels.
 */

import { resolveStudioBrushAliasProfile } from "./brush/studio-brush-alias-profile";
import { resolveStudioBrushEngineLaneCroquisCapsuleProgramId } from "./brush/studio-brush-engine-lane-catalog";
import { resolveStudioFreehandRenderPath } from "./studio-brush";
import {
  STUDIO_CROQUIS_CAPSULE_PEN_ALGORITHM,
  STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX,
  applyStudioCroquisPulledStringPrefilter,
  buildStudioCroquisCapsuleStrokeLoops,
  resolveStudioCroquisCapsulePenProgram,
  solveStudioCroquisCapsule,
  studioCroquisCapsuleLoop,
  studioCroquisCapsuleLoopToPathPart,
  studioCroquisCapsuleLoopsToPathData,
  studioCroquisCapsuleRadiiFromPressures,
  studioCroquisCapsuleRadiusFromPressure,
  type StudioCroquisCapsulePenProgramId,
} from "./studio-croquis-capsule-pen-v1";
import {
  buildStudioPerfectFreehandOutline,
  resolveStudioPerfectFreehandProfile,
  studioPerfectFreehandOutlineToPathData,
  type StudioPerfectFreehandProfile,
  type StudioPerfectFreehandProfileId,
  type StudioPerfectFreehandStroker,
} from "./studio-perfect-freehand";

export const STUDIO_OUTLINE_STROKE_CONTRACT_KIND =
  "studio-outline-stroke-contract" as const;
export const STUDIO_OUTLINE_STROKE_CONTRACT_VERSION = 1 as const;
export const STUDIO_OUTLINE_STROKE_ENGINE =
  "perfect-freehand-outline" as const;
export const STUDIO_OUTLINE_STROKE_ADAPTER_VERSION =
  "toonspectrum-perfect-freehand-adapter-v1" as const;
export const STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM =
  "perfect-freehand@1.2.3:getStroke" as const;
/**
 * Sibling v1 engine branch (2026-08-13 wave 3): croquis.js circumscribed-tangent capsule inking.
 * Same durable-contract discipline as the perfect-freehand branch — a pointer-start caller
 * captures the snapshot once and every renderer resolves it; the engine is granted only through
 * an explicit catalog program pin (`resolveStudioBrushEngineLaneCroquisCapsuleProgramId`).
 */
export const STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE =
  "croquis-capsule-outline" as const;
export const STUDIO_CROQUIS_CAPSULE_OUTLINE_PACKAGE_ALGORITHM =
  STUDIO_CROQUIS_CAPSULE_PEN_ALGORITHM;

export type StudioOutlineStrokePressureSource =
  | "recorded"
  | "simulated-distance";

/**
 * Numeric profile values are copied into every new outline contract. The profile id remains useful
 * for diagnostics and frozen v1 fallback policy, but replay never consults mutable catalog values.
 */
export interface StudioOutlineStrokeProfileSnapshotV1 {
  readonly id: StudioPerfectFreehandProfileId;
  /** Brush-specific selected-size multiplier captured before the mutable alias catalogue changes. */
  readonly diameterScale: number;
  readonly thinning: number;
  readonly smoothing: number;
  readonly streamline: number;
  readonly taperStartFactor: number;
  readonly taperEndFactor: number;
  readonly capStart: boolean;
  readonly capEnd: boolean;
}

export interface StudioPerfectFreehandOutlineStrokeContractV1 {
  readonly kind: typeof STUDIO_OUTLINE_STROKE_CONTRACT_KIND;
  readonly version: typeof STUDIO_OUTLINE_STROKE_CONTRACT_VERSION;
  readonly engine: typeof STUDIO_OUTLINE_STROKE_ENGINE;
  readonly adapterVersion: typeof STUDIO_OUTLINE_STROKE_ADAPTER_VERSION;
  readonly packageAlgorithm: typeof STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM;
  readonly pressureSource: StudioOutlineStrokePressureSource;
  readonly profile: StudioOutlineStrokeProfileSnapshotV1;
}

/**
 * Renderer-significant capsule program snapshot. Numeric values are copied at capture so replay
 * never consults the mutable program table (same discipline as the perfect-freehand snapshot).
 */
export interface StudioCroquisCapsuleProfileSnapshotV1 {
  readonly id: StudioCroquisCapsulePenProgramId;
  /** Brush-specific selected-size multiplier captured before the mutable alias catalogue changes. */
  readonly diameterScale: number;
  readonly arcTolerancePx: number;
  readonly pulledStringLengthPx: number | null;
}

export interface StudioCroquisCapsuleOutlineStrokeContractV1 {
  readonly kind: typeof STUDIO_OUTLINE_STROKE_CONTRACT_KIND;
  readonly version: typeof STUDIO_OUTLINE_STROKE_CONTRACT_VERSION;
  readonly engine: typeof STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE;
  readonly adapterVersion: typeof STUDIO_OUTLINE_STROKE_ADAPTER_VERSION;
  readonly packageAlgorithm: typeof STUDIO_CROQUIS_CAPSULE_OUTLINE_PACKAGE_ALGORITHM;
  /** Capsule radii come from recorded pressure only; this client never captures simulation. */
  readonly pressureSource: "recorded";
  readonly profile: StudioCroquisCapsuleProfileSnapshotV1;
}

export type StudioOutlineStrokeContractV1 =
  | StudioPerfectFreehandOutlineStrokeContractV1
  | StudioCroquisCapsuleOutlineStrokeContractV1;

export interface StudioOutlineStrokeContractCaptureInput {
  readonly brushId: unknown;
  /**
   * Pointer-start must choose this explicitly. In particular, the capture boundary must not infer
   * simulation merely because the first pressure array is empty.
   */
  readonly pressureSource: unknown;
}

export type StudioOutlineStrokeContractIssueCode =
  | "malformed-contract"
  | "unsupported-kind"
  | "unsupported-version"
  | "unsupported-engine"
  | "unsupported-adapter-version"
  | "unsupported-package-algorithm"
  | "unsupported-pressure-source"
  | "unsupported-profile";

export interface StudioOutlineStrokeContractIssue {
  readonly code: StudioOutlineStrokeContractIssueCode;
  readonly path: string;
  readonly message: string;
}

export type StudioOutlineStrokeContractResolution =
  | {
      readonly status: "legacy";
      readonly contract: null;
      readonly reason: "missing-contract";
    }
  | {
      readonly status: "ready";
      readonly contract: StudioOutlineStrokeContractV1;
    }
  | {
      readonly status: "unsupported";
      readonly contract: null;
      readonly issue: StudioOutlineStrokeContractIssue;
    };

export class StudioOutlineStrokeContractError extends Error {
  readonly issue: StudioOutlineStrokeContractIssue;

  constructor(issue: StudioOutlineStrokeContractIssue) {
    super(issue.message);
    this.name = "StudioOutlineStrokeContractError";
    this.issue = issue;
  }
}

const CONTRACT_KEYS = [
  "kind",
  "version",
  "engine",
  "adapterVersion",
  "packageAlgorithm",
  "pressureSource",
  "profile",
] as const;
const PROFILE_KEYS = [
  "id",
  "diameterScale",
  "thinning",
  "smoothing",
  "streamline",
  "taperStartFactor",
  "taperEndFactor",
  "capStart",
  "capEnd",
] as const;
const CAPSULE_PROFILE_KEYS = [
  "id",
  "diameterScale",
  "arcTolerancePx",
  "pulledStringLengthPx",
] as const;
/**
 * 계약이 재생할 수 있는 프로필. `studio-perfect-freehand` 가 프리셋을 추가하면 여기도 같이 커져야
 * 한다 — maru-pen 은 프리셋과 캡처에는 있었지만 이 목록에 빠져, 모든 마루펜 획이 캔버스에
 * 자홍색 진단 상자로 그려졌다(장획 게이트 실측: 선이 아니라 점선 상자의 주기가 잡혔다).
 */
const PROFILE_IDS = new Set<StudioPerfectFreehandProfileId>([
  "perfect-ink",
  "perfect-marker",
  "gpen",
  "maru-pen",
]);

function issue(
  code: StudioOutlineStrokeContractIssueCode,
  path: string,
  message: string,
): StudioOutlineStrokeContractIssue {
  return Object.freeze({ code, path, message });
}

/**
 * Reads only enumerable own data properties. Accessors, symbols and exotic prototypes are not
 * accepted at a renderer-significant persistence boundary.
 */
function plainDataRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        !descriptor
        || descriptor.enumerable !== true
        || !("value" in descriptor)
      ) {
        return null;
      }
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function hasExactKeys(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length
    && actualKeys.every((key) => keys.includes(key));
}

function boundedFiniteNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function normalizeProfileSnapshot(
  value: unknown,
): StudioOutlineStrokeProfileSnapshotV1 | StudioOutlineStrokeContractIssue {
  const profile = plainDataRecord(value);
  if (!profile || !hasExactKeys(profile, PROFILE_KEYS)) {
    return issue(
      "unsupported-profile",
      "profile",
      "외곽선 브러시 프로필 스냅샷의 필드가 올바르지 않습니다.",
    );
  }
  if (typeof profile.id !== "string" || !PROFILE_IDS.has(
    profile.id as StudioPerfectFreehandProfileId,
  )) {
    return issue(
      "unsupported-profile",
      "profile.id",
      "이 클라이언트가 지원하지 않는 외곽선 브러시 프로필입니다.",
    );
  }
  if (
    !boundedFiniteNumber(profile.diameterScale, 0.01, 16)
    || !boundedFiniteNumber(profile.thinning, -1, 1)
    || !boundedFiniteNumber(profile.smoothing, 0, 1)
    || !boundedFiniteNumber(profile.streamline, 0, 1)
    || !boundedFiniteNumber(profile.taperStartFactor, 0, 64)
    || !boundedFiniteNumber(profile.taperEndFactor, 0, 64)
    || typeof profile.capStart !== "boolean"
    || typeof profile.capEnd !== "boolean"
  ) {
    return issue(
      "unsupported-profile",
      "profile",
      "외곽선 브러시 프로필 스냅샷의 값이 안전 범위를 벗어났습니다.",
    );
  }

  return Object.freeze({
    id: profile.id as StudioPerfectFreehandProfileId,
    diameterScale: profile.diameterScale,
    thinning: profile.thinning,
    smoothing: profile.smoothing,
    streamline: profile.streamline,
    taperStartFactor: profile.taperStartFactor,
    taperEndFactor: profile.taperEndFactor,
    capStart: profile.capStart,
    capEnd: profile.capEnd,
  });
}

/** Mirrors `normalizeProfileSnapshot` for the croquis capsule engine branch. */
function normalizeCapsuleProfileSnapshot(
  value: unknown,
): StudioCroquisCapsuleProfileSnapshotV1 | StudioOutlineStrokeContractIssue {
  const profile = plainDataRecord(value);
  if (!profile || !hasExactKeys(profile, CAPSULE_PROFILE_KEYS)) {
    return issue(
      "unsupported-profile",
      "profile",
      "캡슐 브러시 프로필 스냅샷의 필드가 올바르지 않습니다.",
    );
  }
  // The program id must still exist in the frozen program table — an unknown/removed id must be
  // surfaced, never rendered with another texture (fail-closed catalog discipline).
  if (
    typeof profile.id !== "string"
    || resolveStudioCroquisCapsulePenProgram(profile.id) === null
  ) {
    return issue(
      "unsupported-profile",
      "profile.id",
      "이 클라이언트가 지원하지 않는 캡슐 브러시 프로그램입니다.",
    );
  }
  if (
    !boundedFiniteNumber(profile.diameterScale, 0.01, 16)
    || !boundedFiniteNumber(profile.arcTolerancePx, 0.01, 4)
    || (
      profile.pulledStringLengthPx !== null
      && !boundedFiniteNumber(profile.pulledStringLengthPx, 1, 512)
    )
  ) {
    return issue(
      "unsupported-profile",
      "profile",
      "캡슐 브러시 프로필 스냅샷의 값이 안전 범위를 벗어났습니다.",
    );
  }

  return Object.freeze({
    id: profile.id as StudioCroquisCapsulePenProgramId,
    diameterScale: profile.diameterScale,
    arcTolerancePx: profile.arcTolerancePx,
    pulledStringLengthPx: profile.pulledStringLengthPx as number | null,
  });
}

function snapshotProfile(
  profile: StudioPerfectFreehandProfile,
  brushId: unknown,
): StudioOutlineStrokeProfileSnapshotV1 {
  return Object.freeze({
    id: profile.id,
    diameterScale: resolveStudioBrushAliasProfile(brushId)?.diameterScale ?? 1,
    thinning: profile.thinning,
    smoothing: profile.smoothing,
    streamline: profile.streamline,
    taperStartFactor: profile.taperStartFactor,
    taperEndFactor: profile.taperEndFactor,
    capStart: profile.capStart,
    capEnd: profile.capEnd,
  });
}

function isPressureSource(value: unknown): value is StudioOutlineStrokePressureSource {
  return value === "recorded" || value === "simulated-distance";
}

/**
 * Captures the immutable v1 renderer contract at pointer-start.
 *
 * `null` means that the selected brush is not owned by the outline engine. An eligible brush with
 * an invalid pressure source is a programmer error and fails immediately.
 */
export function captureStudioOutlineStrokeContractV1(
  input: StudioOutlineStrokeContractCaptureInput,
): StudioOutlineStrokeContractV1 | null {
  // Narrow the source into a local so the guard survives the resolver calls below.
  const pressureSource = input.pressureSource;
  if (!isPressureSource(pressureSource)) {
    // An eligible brush with an invalid pressure source is a programmer error for BOTH engine
    // branches, so validate eligibility first and keep null the only non-owned outcome.
    const capsuleEligible = resolveStudioCroquisCapsulePenProgram(
      resolveStudioBrushEngineLaneCroquisCapsuleProgramId(
        typeof input.brushId === "string" ? input.brushId : null,
      ),
    ) !== null;
    if (!capsuleEligible && !resolveStudioPerfectFreehandProfile(input.brushId)) return null;
    throw new StudioOutlineStrokeContractError(issue(
      "unsupported-pressure-source",
      "pressureSource",
      "외곽선 획의 필압 출처를 pointer-start에서 명시해야 합니다.",
    ));
  }
  // Explicit catalog program pin wins: a pinned lane id captures the capsule engine snapshot
  // (2026-08-13 wave 3). Unpinned brushes fall through to the perfect-freehand branch untouched.
  const capsuleProgram = resolveStudioCroquisCapsulePenProgram(
    resolveStudioBrushEngineLaneCroquisCapsuleProgramId(
      typeof input.brushId === "string" ? input.brushId : null,
    ),
  );
  if (capsuleProgram) {
    if (pressureSource !== "recorded") {
      // Capsule radii are recorded-pressure functions; this client never simulates them.
      throw new StudioOutlineStrokeContractError(issue(
        "unsupported-pressure-source",
        "pressureSource",
        "캡슐 외곽선 획은 recorded 필압만 캡처할 수 있습니다.",
      ));
    }
    return Object.freeze({
      kind: STUDIO_OUTLINE_STROKE_CONTRACT_KIND,
      version: STUDIO_OUTLINE_STROKE_CONTRACT_VERSION,
      engine: STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE,
      adapterVersion: STUDIO_OUTLINE_STROKE_ADAPTER_VERSION,
      packageAlgorithm: STUDIO_CROQUIS_CAPSULE_OUTLINE_PACKAGE_ALGORITHM,
      pressureSource: "recorded",
      profile: Object.freeze({
        id: capsuleProgram.id,
        diameterScale: resolveStudioBrushAliasProfile(input.brushId)?.diameterScale ?? 1,
        arcTolerancePx: capsuleProgram.arcTolerancePx,
        pulledStringLengthPx: capsuleProgram.pulledStringLengthPx,
      }),
    });
  }
  const profile = resolveStudioPerfectFreehandProfile(input.brushId);
  if (!profile) return null;
  return Object.freeze({
    kind: STUDIO_OUTLINE_STROKE_CONTRACT_KIND,
    version: STUDIO_OUTLINE_STROKE_CONTRACT_VERSION,
    engine: STUDIO_OUTLINE_STROKE_ENGINE,
    adapterVersion: STUDIO_OUTLINE_STROKE_ADAPTER_VERSION,
    packageAlgorithm: STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM,
    pressureSource,
    profile: snapshotProfile(profile, input.brushId),
  });
}

/**
 * Explicit legacy migration. It intentionally requires the caller to supply pressure semantics;
 * presence/absence of a legacy pressure array is not enough to reconstruct authoring intent.
 */
export function migrateLegacyStudioOutlineStrokeContractV1(
  input: StudioOutlineStrokeContractCaptureInput,
):
  | {
      readonly status: "migrated";
      readonly contract: StudioOutlineStrokeContractV1;
    }
  | {
      readonly status: "legacy-ineligible";
      readonly contract: null;
    } {
  const contract = captureStudioOutlineStrokeContractV1(input);
  return contract
    ? Object.freeze({ status: "migrated", contract })
    : Object.freeze({ status: "legacy-ineligible", contract: null });
}

/**
 * Safe resolver for persistence/network inputs. Unknown contracts remain visible to the caller.
 */
export function resolveStudioOutlineStrokeContract(
  value: unknown,
): StudioOutlineStrokeContractResolution {
  if (value === undefined || value === null) {
    return Object.freeze({
      status: "legacy",
      contract: null,
      reason: "missing-contract",
    });
  }

  const contract = plainDataRecord(value);
  if (!contract) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "malformed-contract",
        "$",
        "외곽선 획 계약은 JSON 객체여야 합니다.",
      ),
    });
  }
  if (contract.kind !== STUDIO_OUTLINE_STROKE_CONTRACT_KIND) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "unsupported-kind",
        "kind",
        "지원하지 않는 외곽선 획 계약 종류입니다.",
      ),
    });
  }
  if (contract.version !== STUDIO_OUTLINE_STROKE_CONTRACT_VERSION) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "unsupported-version",
        "version",
        "이 클라이언트가 지원하지 않는 외곽선 획 계약 버전입니다.",
      ),
    });
  }
  const capsuleEngine = contract.engine === STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE;
  if (contract.engine !== STUDIO_OUTLINE_STROKE_ENGINE && !capsuleEngine) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "unsupported-engine",
        "engine",
        "이 클라이언트가 지원하지 않는 외곽선 렌더 엔진입니다.",
      ),
    });
  }
  if (contract.adapterVersion !== STUDIO_OUTLINE_STROKE_ADAPTER_VERSION) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "unsupported-adapter-version",
        "adapterVersion",
        "이 클라이언트가 지원하지 않는 외곽선 어댑터 버전입니다.",
      ),
    });
  }
  // Each engine branch owns exactly one package algorithm — a mismatched pairing is a fabricated
  // contract and must never pick a renderer by guesswork.
  if (
    contract.packageAlgorithm !== (
      capsuleEngine
        ? STUDIO_CROQUIS_CAPSULE_OUTLINE_PACKAGE_ALGORITHM
        : STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM
    )
  ) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "unsupported-package-algorithm",
        "packageAlgorithm",
        capsuleEngine
          ? "이 클라이언트가 지원하지 않는 croquis 캡슐 알고리즘입니다."
          : "이 클라이언트가 지원하지 않는 perfect-freehand 알고리즘입니다.",
      ),
    });
  }
  // Hoist the validated source into a local so its narrowing survives the calls below.
  const rawPressureSource = contract.pressureSource;
  const pressureSource = isPressureSource(rawPressureSource) ? rawPressureSource : null;
  if (pressureSource === null || (capsuleEngine && pressureSource !== "recorded")) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "unsupported-pressure-source",
        "pressureSource",
        "이 클라이언트가 지원하지 않는 외곽선 필압 출처입니다.",
      ),
    });
  }
  if (!hasExactKeys(contract, CONTRACT_KEYS)) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: issue(
        "malformed-contract",
        "$",
        "외곽선 획 계약의 필드가 올바르지 않습니다.",
      ),
    });
  }

  if (capsuleEngine) {
    const normalizedCapsuleProfile = normalizeCapsuleProfileSnapshot(contract.profile);
    if ("code" in normalizedCapsuleProfile) {
      return Object.freeze({
        status: "unsupported",
        contract: null,
        issue: normalizedCapsuleProfile,
      });
    }
    return Object.freeze({
      status: "ready",
      contract: Object.freeze({
        kind: STUDIO_OUTLINE_STROKE_CONTRACT_KIND,
        version: STUDIO_OUTLINE_STROKE_CONTRACT_VERSION,
        engine: STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE,
        adapterVersion: STUDIO_OUTLINE_STROKE_ADAPTER_VERSION,
        packageAlgorithm: STUDIO_CROQUIS_CAPSULE_OUTLINE_PACKAGE_ALGORITHM,
        pressureSource: "recorded",
        profile: normalizedCapsuleProfile,
      }),
    });
  }

  const normalizedProfile = normalizeProfileSnapshot(contract.profile);
  if ("code" in normalizedProfile) {
    return Object.freeze({
      status: "unsupported",
      contract: null,
      issue: normalizedProfile,
    });
  }
  return Object.freeze({
    status: "ready",
    contract: Object.freeze({
      kind: STUDIO_OUTLINE_STROKE_CONTRACT_KIND,
      version: STUDIO_OUTLINE_STROKE_CONTRACT_VERSION,
      engine: STUDIO_OUTLINE_STROKE_ENGINE,
      adapterVersion: STUDIO_OUTLINE_STROKE_ADAPTER_VERSION,
      packageAlgorithm: STUDIO_OUTLINE_STROKE_PACKAGE_ALGORITHM,
      pressureSource,
      profile: normalizedProfile,
    }),
  });
}

/**
 * Normalizes a supported value, returns `null` only for a truly missing legacy contract, and throws
 * for every unsupported value. This is the fail-visible convenience API for persistence bridges.
 */
export function normalizeStudioOutlineStrokeContract(
  value: unknown,
): StudioOutlineStrokeContractV1 | null {
  const resolution = resolveStudioOutlineStrokeContract(value);
  if (resolution.status === "legacy") return null;
  if (resolution.status === "unsupported") {
    throw new StudioOutlineStrokeContractError(resolution.issue);
  }
  return resolution.contract;
}

export interface StudioPerfectFreehandRenderPlanMetrics {
  readonly pointCount: number;
  /** Bounding-box diagonal, matching the frozen v1 retained-render fallback policy. */
  readonly strokeDistance: number;
  readonly sparseSpacing: number;
  readonly outlinePointCount?: number;
  readonly outlineDistance?: number;
}

export type StudioPerfectFreehandFallbackReason =
  | "insufficient-points"
  | "very-short-perfect"
  | "sparse-long-perfect-ink"
  | "stroker-unavailable"
  | "invalid-outline"
  | "degenerate-outline";

export interface StudioPerfectFreehandFallbackLinePlan {
  readonly points: readonly number[];
  readonly tension: number;
  readonly strokeWidth: number;
  /**
   * `null` is a plain round Line fallback. A number asks the renderer to add matching start/end
   * circles, preserving the historical compact/sparse perfect-* fallback.
   */
  readonly endpointCapRadius: number | null;
}

export type StudioPerfectFreehandRenderPlan =
  | {
      readonly kind: "legacy-contract";
      readonly reason: "missing-contract";
    }
  | {
      readonly kind: "unsupported-contract";
      readonly issue: StudioOutlineStrokeContractIssue;
    }
  | {
      readonly kind: "invalid-input";
      readonly reason:
        | "invalid-points"
        | "invalid-stroke-width"
        | "missing-recorded-pressure"
        | "invalid-recorded-pressure";
    }
  | {
      readonly kind: "fallback-line";
      readonly contract: StudioOutlineStrokeContractV1;
      readonly reason: StudioPerfectFreehandFallbackReason;
      readonly line: StudioPerfectFreehandFallbackLinePlan;
      readonly metrics: StudioPerfectFreehandRenderPlanMetrics;
    }
  | {
      readonly kind: "outline";
      readonly contract: StudioOutlineStrokeContractV1;
      readonly outline: readonly (readonly number[])[];
      readonly pathData: string;
      readonly metrics: StudioPerfectFreehandRenderPlanMetrics;
    };

export interface StudioPerfectFreehandRenderPlanInput {
  readonly contract: unknown;
  readonly stroker: StudioPerfectFreehandStroker | null;
  readonly points: readonly number[];
  readonly pressures?: readonly number[] | null;
  readonly strokeWidth: number;
  readonly sampleSpacing?: unknown;
  readonly legacyMinDistance?: number;
}

function normalizeFinitePoints(points: readonly number[]): number[] | null {
  if (!Array.isArray(points) || points.length % 2 !== 0) return null;
  const normalized = new Array<number>(points.length);
  for (let index = 0; index < points.length; index += 1) {
    const coordinate = points[index];
    if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) return null;
    normalized[index] = coordinate;
  }
  return normalized;
}

function normalizeRecordedPressures(
  pressures: readonly number[] | null | undefined,
): number[] | null {
  if (!Array.isArray(pressures) || pressures.length === 0) return null;
  const normalized = new Array<number>(pressures.length);
  for (let index = 0; index < pressures.length; index += 1) {
    const pressure = pressures[index];
    if (
      typeof pressure !== "number"
      || !Number.isFinite(pressure)
      || pressure < 0
      || pressure > 1
    ) {
      return null;
    }
    normalized[index] = pressure;
  }
  return normalized;
}

function sourceMetrics(points: readonly number[]): StudioPerfectFreehandRenderPlanMetrics {
  const pointCount = Math.floor(points.length / 2);
  if (pointCount === 0) {
    return Object.freeze({ pointCount: 0, strokeDistance: 0, sparseSpacing: 0 });
  }
  let minX = points[0]!;
  let maxX = points[0]!;
  let minY = points[1]!;
  let maxY = points[1]!;
  for (let index = 2; index < points.length; index += 2) {
    minX = Math.min(minX, points[index]!);
    maxX = Math.max(maxX, points[index]!);
    minY = Math.min(minY, points[index + 1]!);
    maxY = Math.max(maxY, points[index + 1]!);
  }
  const strokeDistance = Math.hypot(maxX - minX, maxY - minY);
  return Object.freeze({
    pointCount,
    strokeDistance,
    sparseSpacing: strokeDistance / Math.max(1, pointCount - 1),
  });
}

function outlineMetrics(
  source: StudioPerfectFreehandRenderPlanMetrics,
  outline: readonly (readonly number[])[],
): StudioPerfectFreehandRenderPlanMetrics {
  let minX = outline[0]?.[0] ?? 0;
  let maxX = minX;
  let minY = outline[0]?.[1] ?? 0;
  let maxY = minY;
  for (let index = 1; index < outline.length; index += 1) {
    const point = outline[index]!;
    minX = Math.min(minX, point[0]!);
    maxX = Math.max(maxX, point[0]!);
    minY = Math.min(minY, point[1]!);
    maxY = Math.max(maxY, point[1]!);
  }
  return Object.freeze({
    ...source,
    outlinePointCount: outline.length,
    outlineDistance: Math.hypot(maxX - minX, maxY - minY),
  });
}

function fallbackLinePlan(
  contract: StudioOutlineStrokeContractV1,
  input: StudioPerfectFreehandRenderPlanInput,
  points: number[],
  metrics: StudioPerfectFreehandRenderPlanMetrics,
  reason: StudioPerfectFreehandFallbackReason,
  endpointCaps: boolean,
  renderStrokeWidth: number,
): StudioPerfectFreehandRenderPlan {
  const renderPath = resolveStudioFreehandRenderPath(points, {
    sampleSpacing: input.sampleSpacing,
    acceptedTension: 0.32,
    legacyMinDistance: input.legacyMinDistance,
    legacyTension: 0.4,
  });
  const lineWidth = endpointCaps ? Math.max(renderStrokeWidth, 1) : renderStrokeWidth;
  return Object.freeze({
    kind: "fallback-line",
    contract,
    reason,
    line: Object.freeze({
      points: Object.freeze([...renderPath.points]),
      tension: renderPath.tension,
      strokeWidth: lineWidth,
      endpointCapRadius: endpointCaps ? Math.max(0.5, lineWidth * 0.5) : null,
    }),
    metrics,
  });
}

function freezeOutline(
  outline: readonly (readonly number[])[],
): readonly (readonly number[])[] {
  return Object.freeze(outline.map((point) => Object.freeze([...point])));
}

/**
 * Croquis capsule engine branch (2026-08-13 wave 3). Pure per-segment hull geometry — no stroker
 * module, no polygon-union step. Empty geometry (e.g. an all-zero recorded pressure stroke) falls
 * back to the round Line + endpoint caps plan, which is the uniform-width degenerate form of the
 * same capsule texture; it must never route to perfect-freehand or the plain pen renderer.
 */
function planStudioCroquisCapsuleRender(
  contract: StudioCroquisCapsuleOutlineStrokeContractV1,
  input: StudioPerfectFreehandRenderPlanInput,
  points: number[],
  pressures: readonly number[],
  renderStrokeWidth: number,
): StudioPerfectFreehandRenderPlan {
  const capsulePoints = contract.profile.pulledStringLengthPx !== null
    ? applyStudioCroquisPulledStringPrefilter(points, {
        stringLengthPx: contract.profile.pulledStringLengthPx,
      })
    : points;
  const metrics = sourceMetrics(capsulePoints);
  const pointCount = Math.floor(capsulePoints.length / 2);
  // Recorded pressure normally arrives one-per-point; a shorter array carries the last known
  // stylus state forward (croquis forwards the current stylus state), never an invented curve.
  const alignedPressures = pressures.length === pointCount
    ? pressures
    : Array.from(
        { length: pointCount },
        (_, index) => pressures[Math.min(index, pressures.length - 1)]!,
      );
  const loops = buildStudioCroquisCapsuleStrokeLoops({
    points: capsulePoints,
    radii: studioCroquisCapsuleRadiiFromPressures(alignedPressures, renderStrokeWidth),
    arcTolerancePx: contract.profile.arcTolerancePx,
  });
  const pathData = studioCroquisCapsuleLoopsToPathData(loops);
  if (!pathData) {
    const representativePressure = alignedPressures.length > 0
      ? alignedPressures.reduce((total, pressure) => total + pressure, 0)
        / alignedPressures.length
      : 0.5;
    return fallbackLinePlan(
      contract,
      input,
      capsulePoints,
      metrics,
      "invalid-outline",
      true,
      // croquis diameter response is linear in pressure (r = p × size / 2).
      Math.max(0.01, renderStrokeWidth * representativePressure),
    );
  }
  const flattenedLoops = loops.flat();
  return Object.freeze({
    kind: "outline",
    contract,
    outline: freezeOutline(flattenedLoops),
    pathData,
    metrics: outlineMetrics(metrics, flattenedLoops),
  });
}

/**
 * Shared v1 plan for retained live preview, committed canvas and SVG export.
 *
 * It owns all perfect-freehand fallback decisions. A caller renders either the returned filled
 * outline path or the returned round Line plan; unsupported contracts and missing recorded
 * pressure never degrade to visually different geometry.
 */
export function planStudioPerfectFreehandRender(
  input: StudioPerfectFreehandRenderPlanInput,
): StudioPerfectFreehandRenderPlan {
  const contractResolution = resolveStudioOutlineStrokeContract(input.contract);
  if (contractResolution.status === "legacy") {
    return Object.freeze({
      kind: "legacy-contract",
      reason: "missing-contract",
    });
  }
  if (contractResolution.status === "unsupported") {
    return Object.freeze({
      kind: "unsupported-contract",
      issue: contractResolution.issue,
    });
  }
  const contract = contractResolution.contract;
  const points = normalizeFinitePoints(input.points);
  if (!points) {
    return Object.freeze({ kind: "invalid-input", reason: "invalid-points" });
  }
  if (
    typeof input.strokeWidth !== "number"
    || !Number.isFinite(input.strokeWidth)
    || input.strokeWidth <= 0
  ) {
    return Object.freeze({ kind: "invalid-input", reason: "invalid-stroke-width" });
  }
  const selectedDiameter = Math.min(8_192, Math.max(0.01, input.strokeWidth));
  const renderStrokeWidth = Math.min(
    8_192,
    Math.max(0.01, selectedDiameter * contract.profile.diameterScale),
  );

  let pressures: readonly number[] | null = null;
  if (contract.pressureSource === "recorded") {
    if (!Array.isArray(input.pressures) || input.pressures.length === 0) {
      return Object.freeze({
        kind: "invalid-input",
        reason: "missing-recorded-pressure",
      });
    }
    pressures = normalizeRecordedPressures(input.pressures);
    if (!pressures) {
      return Object.freeze({
        kind: "invalid-input",
        reason: "invalid-recorded-pressure",
      });
    }
  }
  if (contract.engine === STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE) {
    // The recorded-pressure guard above already ran (capsule contracts are always `recorded`),
    // so `pressures` is a validated non-empty array here.
    return planStudioCroquisCapsuleRender(
      contract,
      input,
      points,
      pressures ?? [],
      renderStrokeWidth,
    );
  }
  const representativePressure = pressures && pressures.length > 0
    ? pressures.reduce((total, pressure) => total + pressure, 0) / pressures.length
    : 0.5;
  // perfect-freehand uses this exact linear diameter response. Compact fallbacks must share it;
  // otherwise a tap or very short flick changes size when the outline route becomes available.
  const fallbackStrokeWidth = Math.max(
    0.01,
    renderStrokeWidth * (
      1 + 2 * contract.profile.thinning * (representativePressure - 0.5)
    ),
  );

  const metrics = sourceMetrics(points);
  if (metrics.pointCount < 2) {
    return fallbackLinePlan(
      contract,
      input,
      points,
      metrics,
      "insufficient-points",
      true,
      fallbackStrokeWidth,
    );
  }

  const compactPerfectProfile =
    contract.profile.id === "perfect-ink"
    || contract.profile.id === "perfect-marker";
  const veryShortPerfect =
    compactPerfectProfile
    && metrics.pointCount <= 3
    && metrics.strokeDistance < 16;
  const sparseLongPerfectInk =
    contract.profile.id === "perfect-ink"
    && metrics.pointCount >= 4
    && metrics.strokeDistance >= 180
    && metrics.sparseSpacing >= Math.max(20, input.strokeWidth * 4);

  if (veryShortPerfect || sparseLongPerfectInk) {
    return fallbackLinePlan(
      contract,
      input,
      points,
      metrics,
      veryShortPerfect ? "very-short-perfect" : "sparse-long-perfect-ink",
      true,
      fallbackStrokeWidth,
    );
  }
  if (!input.stroker) {
    return fallbackLinePlan(
      contract,
      input,
      points,
      metrics,
      "stroker-unavailable",
      false,
      renderStrokeWidth,
    );
  }

  const outline = buildStudioPerfectFreehandOutline(input.stroker, {
    points,
    pressures,
    strokeWidth: renderStrokeWidth,
    profile: contract.profile,
  });
  const pathData = studioPerfectFreehandOutlineToPathData(outline);
  if (!pathData) {
    return fallbackLinePlan(
      contract,
      input,
      points,
      metrics,
      "invalid-outline",
      false,
      renderStrokeWidth,
    );
  }
  const metricsWithOutline = outlineMetrics(metrics, outline);
  const outlineDistance = metricsWithOutline.outlineDistance ?? 0;
  const degenerate =
    (
      outline.length < 12
      && metrics.strokeDistance < 120
    )
    || outlineDistance < Math.max(6, metrics.strokeDistance * 0.35);
  if (degenerate) {
    return fallbackLinePlan(
      contract,
      input,
      points,
      metricsWithOutline,
      "degenerate-outline",
      false,
      renderStrokeWidth,
    );
  }

  return Object.freeze({
    kind: "outline",
    contract,
    outline: freezeOutline(outline),
    pathData,
    metrics: metricsWithOutline,
  });
}

export interface StudioIncrementalPerfectFreehandRenderPlanner {
  /**
   * 배치 `planStudioPerfectFreehandRender`와 값이 정확히 같은 플랜을 돌려주되, 크로키 캡슐
   * 엔진 획에서는 프리필터 팔로워·정규화 스테이션·캡슐 링·pathData 문자열의 안정 prefix 를
   * 호출 사이에 유지해 이동당 기하 비용을 새 표본 수에만 비례시킨다. 이미 소비한 raw prefix 는
   * 다시 읽지 않고(마지막 소비 점·필압 슬롯 하나로 O(1) 검증), 되돌리기·재작성·계약/폭 변경이
   * 감지되면 전체를 다시 만든다. perfect-freehand 엔진 계약과 나란하지 않은 필압 입력은 배치
   * 플래너로 위임한다(fail-closed). 반환 플랜의 `outline`은 내부 보관 배열이므로 수정하면 안
   * 되고 다음 `plan()` 호출까지만 유효하다.
   */
  plan(input: StudioPerfectFreehandRenderPlanInput): StudioPerfectFreehandRenderPlan;
}

/** `normalizeStroke`의 반지름 클램프 상한(지름 클램프 8192 의 절반) — 크로키 모듈과 동율. */
const CROQUIS_MAX_STROKE_RADIUS = 4_096;

/**
 * 증분 크로키 캡슐 렌더 플래너.
 *
 * 캡슐 체인은 모두 앞으로만 흐른다: pulled-string 팔로워는 인과 워크, 중복 병합은 마지막
 * 정규화 항목만 소급 변형하고, 링은 인접 쌍의 국소 함수이며, pathData 는 링별 서브패스의
 * 이어붙임이다. 단 하나의 소급점은 "마지막 캡슐 점"이다 — 배치 프리필터가 마지막 출력만 raw
 * 포인터 위치로 덮으므로, 점 i 는 점 i+1 이 소비될 때에야 확정된다(랙 1). 그래서 확정 점만
 * 안정 구조(소스 bbox·정규화 배열·링·outline·pathData)에 넣고, 마지막 점은 매 호출 raw 값으로
 * 휘발 재구축한다. 각 단계가 배치와 같은 헬퍼를 같은 순서로 호출하므로 값이 완전히 일치한다.
 */
export function createStudioIncrementalPerfectFreehandRenderPlanner(): StudioIncrementalPerfectFreehandRenderPlanner {
  let cachedContractValue: unknown = Symbol("unresolved");
  let cachedResolution: StudioOutlineStrokeContractResolution | null = null;
  let configRenderStrokeWidth = 0;

  let consumedPoints = 0;
  let lastRawX = 0;
  let lastRawY = 0;
  let lastRawPressure = 0;
  let followerX = 0;
  let followerY = 0;
  /** 소비한 캡슐 좌표(프리필터 통과 후) — 희귀한 폴백 분기의 뷰 재구성용. */
  const capsuleCoords: number[] = [];
  let runningPressureSum = 0;
  /** 확정(랙 1) 캡슐 점들의 소스 bbox. */
  let sourceHasAny = false;
  let sourceMinX = 0;
  let sourceMaxX = 0;
  let sourceMinY = 0;
  let sourceMaxY = 0;

  /** 정규화 스트림(중복 병합) — 마지막 항목은 병합 표적이라 스냅샷으로 복원한다. */
  const normXs: number[] = [];
  const normYs: number[] = [];
  const normRs: number[] = [];
  let stableNormCount = 0;
  let lastNormSnapshot: { x: number; y: number; r: number } | null = null;
  /** 다음에 안정 방출할 캡슐 쌍의 끝 정규화 인덱스. */
  let stableLoopNextEnd = 1;

  const outlinePoints: (readonly number[])[] = [];
  let stableOutlineCount = 0;
  let outlineHasAny = false;
  let outlineMinX = 0;
  let outlineMaxX = 0;
  let outlineMinY = 0;
  let outlineMaxY = 0;
  let stablePathData = "";

  const resetGeometry = (): void => {
    consumedPoints = 0;
    followerX = 0;
    followerY = 0;
    capsuleCoords.length = 0;
    runningPressureSum = 0;
    sourceHasAny = false;
    normXs.length = 0;
    normYs.length = 0;
    normRs.length = 0;
    stableNormCount = 0;
    lastNormSnapshot = null;
    stableLoopNextEnd = 1;
    outlinePoints.length = 0;
    stableOutlineCount = 0;
    outlineHasAny = false;
    stablePathData = "";
  };

  const foldSource = (x: number, y: number): void => {
    if (!sourceHasAny) {
      sourceHasAny = true;
      sourceMinX = x;
      sourceMaxX = x;
      sourceMinY = y;
      sourceMaxY = y;
      return;
    }
    sourceMinX = Math.min(sourceMinX, x);
    sourceMaxX = Math.max(sourceMaxX, x);
    sourceMinY = Math.min(sourceMinY, y);
    sourceMaxY = Math.max(sourceMaxY, y);
  };

  /** `normalizeStroke` 루프 본문 한 점 분 — 중복 위치는 최대 반지름으로 병합한다. */
  const normalizeInto = (x: number, y: number, radius: number): void => {
    const safeRadius = Math.min(
      CROQUIS_MAX_STROKE_RADIUS,
      Math.max(0, radius),
    );
    const lastIndex = normXs.length - 1;
    if (lastIndex >= 0 && normXs[lastIndex] === x && normYs[lastIndex] === y) {
      normRs[lastIndex] = Math.max(normRs[lastIndex]!, safeRadius);
      return;
    }
    normXs.push(x);
    normYs.push(y);
    normRs.push(safeRadius);
  };

  return {
    plan(input) {
      // 계약은 포인터 다운에 스냅샷되어 획 내내 동일 참조로 재사용된다 — 동일성 캐시.
      if (input.contract !== cachedContractValue) {
        cachedContractValue = input.contract;
        cachedResolution = resolveStudioOutlineStrokeContract(input.contract);
        resetGeometry();
      }
      const contractResolution = cachedResolution!;
      if (contractResolution.status === "legacy") {
        return { kind: "legacy-contract", reason: "missing-contract" };
      }
      if (contractResolution.status === "unsupported") {
        return { kind: "unsupported-contract", issue: contractResolution.issue };
      }
      const contract = contractResolution.contract;
      if (contract.engine !== STUDIO_CROQUIS_CAPSULE_OUTLINE_STROKE_ENGINE) {
        // perfect-freehand 엔진(글로벌 테이퍼)은 증분 대상이 아니다 — 배치로 위임.
        return planStudioPerfectFreehandRender(input);
      }
      if (!Array.isArray(input.points) || input.points.length % 2 !== 0) {
        return { kind: "invalid-input", reason: "invalid-points" };
      }
      if (
        typeof input.strokeWidth !== "number"
        || !Number.isFinite(input.strokeWidth)
        || input.strokeWidth <= 0
      ) {
        return { kind: "invalid-input", reason: "invalid-stroke-width" };
      }
      const selectedDiameter = Math.min(8_192, Math.max(0.01, input.strokeWidth));
      const renderStrokeWidth = Math.min(
        8_192,
        Math.max(0.01, selectedDiameter * contract.profile.diameterScale),
      );
      if (renderStrokeWidth !== configRenderStrokeWidth) {
        resetGeometry();
        configRenderStrokeWidth = renderStrokeWidth;
      }
      // 캡슐 계약의 필압 소스는 항상 recorded 다.
      if (!Array.isArray(input.pressures) || input.pressures.length === 0) {
        return { kind: "invalid-input", reason: "missing-recorded-pressure" };
      }
      const pressures = input.pressures;
      const pointCount = input.points.length / 2;
      if (pressures.length !== pointCount) {
        // 전방 채움 정렬은 필압 배열 길이에 소급 의존한다 — 유지 불가, 배치로 위임한다.
        resetGeometry();
        return planStudioPerfectFreehandRender(input);
      }

      // O(1) 앵커 검증 + 수축 검사 — 실패 시 전체 재구축.
      if (pointCount < consumedPoints) resetGeometry();
      if (consumedPoints > 0) {
        const lastIndex = consumedPoints - 1;
        if (
          input.points[lastIndex * 2] !== lastRawX
          || input.points[lastIndex * 2 + 1] !== lastRawY
          || pressures[lastIndex] !== lastRawPressure
        ) {
          resetGeometry();
        }
      }

      // 새 suffix 검증 — 배치와 같은 순서(점 전체 → 필압 전체), 실패 시 소비하지 않는다.
      for (let index = consumedPoints; index < pointCount; index += 1) {
        const x = input.points[index * 2];
        const y = input.points[index * 2 + 1];
        if (
          typeof x !== "number" || !Number.isFinite(x)
          || typeof y !== "number" || !Number.isFinite(y)
        ) {
          return { kind: "invalid-input", reason: "invalid-points" };
        }
      }
      for (let index = consumedPoints; index < pointCount; index += 1) {
        const pressure = pressures[index];
        if (
          typeof pressure !== "number"
          || !Number.isFinite(pressure)
          || pressure < 0
          || pressure > 1
        ) {
          return { kind: "invalid-input", reason: "invalid-recorded-pressure" };
        }
      }

      // 휘발 오버레이 복원: 지난 호출의 꼬리(마지막 캡슐 점이 만든 정규화/링/outline)를 걷는다.
      normXs.length = stableNormCount;
      normYs.length = stableNormCount;
      normRs.length = stableNormCount;
      if (stableNormCount > 0 && lastNormSnapshot) {
        normXs[stableNormCount - 1] = lastNormSnapshot.x;
        normYs[stableNormCount - 1] = lastNormSnapshot.y;
        normRs[stableNormCount - 1] = lastNormSnapshot.r;
      }
      outlinePoints.length = stableOutlineCount;

      const pulledString = contract.profile.pulledStringLengthPx !== null;
      // 배치 프리필터의 safeStringLength 그대로: 비유한 값은 기본 50, 1..512 클램프.
      const rawStringLength = contract.profile.pulledStringLengthPx;
      const stringLength = !pulledString
        ? 0
        : typeof rawStringLength === "number" && Number.isFinite(rawStringLength)
          ? Math.min(512, Math.max(1, rawStringLength))
          : STUDIO_CROQUIS_PULLED_STRING_DEFAULT_LENGTH_PX;
      // 새 raw 표본 소비. 점 i 의 소비는 점 i-1 의 캡슐 좌표를 확정한다(랙 1) — 배치
      // 프리필터가 마지막 출력만 raw 로 덮기 때문이다.
      for (let index = consumedPoints; index < pointCount; index += 1) {
        const rawX = input.points[index * 2]!;
        const rawY = input.points[index * 2 + 1]!;
        if (index === 0) {
          followerX = rawX;
          followerY = rawY;
        } else if (pulledString) {
          // croquis pulled-string 워크 본문(거리형 그대로 — 재생 비트 동일).
          const deltaX = rawX - followerX;
          const deltaY = rawY - followerY;
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          if (distance > stringLength) {
            const t = Math.min((distance - stringLength) / stringLength, 1);
            followerX += deltaX * t;
            followerY += deltaY * t;
          }
        } else {
          followerX = rawX;
          followerY = rawY;
        }
        capsuleCoords.push(followerX, followerY);
        runningPressureSum += pressures[index]!;
        if (index >= 1) {
          const finalX = capsuleCoords[(index - 1) * 2]!;
          const finalY = capsuleCoords[(index - 1) * 2 + 1]!;
          foldSource(finalX, finalY);
          normalizeInto(
            finalX,
            finalY,
            studioCroquisCapsuleRadiusFromPressure(
              pressures[index - 1],
              renderStrokeWidth,
            ),
          );
        }
        lastRawX = rawX;
        lastRawY = rawY;
        lastRawPressure = pressures[index]!;
        consumedPoints = index + 1;
      }

      // 확정된 정규화 쌍만 안정 링으로 방출한다. 마지막 정규화 항목은 아직 병합 표적이므로
      // 끝 인덱스는 length - 2 까지다.
      const arcTolerancePx = contract.profile.arcTolerancePx;
      const emitLoop = (endIndex: number): {
        readonly points: readonly (readonly number[])[];
        readonly part: string | null;
      } | null => {
        const solution = solveStudioCroquisCapsule(
          { x: normXs[endIndex - 1]!, y: normYs[endIndex - 1]!, r: normRs[endIndex - 1]! },
          { x: normXs[endIndex]!, y: normYs[endIndex]!, r: normRs[endIndex]! },
        );
        const loop = studioCroquisCapsuleLoop(solution, arcTolerancePx);
        if (loop.length === 0) return null;
        return { points: loop, part: studioCroquisCapsuleLoopToPathPart(loop) };
      };
      for (
        let endIndex = stableLoopNextEnd;
        endIndex <= normXs.length - 2;
        endIndex += 1
      ) {
        const emitted = emitLoop(endIndex);
        if (!emitted) continue;
        for (const vertex of emitted.points) {
          const frozen = Object.freeze([vertex[0]!, vertex[1]!]);
          outlinePoints.push(frozen);
          if (!outlineHasAny) {
            outlineHasAny = true;
            outlineMinX = vertex[0]!;
            outlineMaxX = vertex[0]!;
            outlineMinY = vertex[1]!;
            outlineMaxY = vertex[1]!;
          } else {
            outlineMinX = Math.min(outlineMinX, vertex[0]!);
            outlineMaxX = Math.max(outlineMaxX, vertex[0]!);
            outlineMinY = Math.min(outlineMinY, vertex[1]!);
            outlineMaxY = Math.max(outlineMaxY, vertex[1]!);
          }
        }
        if (emitted.part !== null) {
          stablePathData = stablePathData === ""
            ? emitted.part
            : `${stablePathData} ${emitted.part}`;
        }
      }
      stableLoopNextEnd = Math.max(stableLoopNextEnd, normXs.length - 1);
      stableNormCount = normXs.length;
      const lastStable = stableNormCount - 1;
      lastNormSnapshot = lastStable >= 0
        ? { x: normXs[lastStable]!, y: normYs[lastStable]!, r: normRs[lastStable]! }
        : null;
      stableOutlineCount = outlinePoints.length;

      // 휘발 꼬리 재구축: 마지막 캡슐 점(= raw 마지막 포인터 위치)과 그것이 만드는 정규화
      // 병합·링·outline·pathData·bbox 를 이번 호출 값으로 다시 만든다.
      let viewMinX = sourceMinX;
      let viewMaxX = sourceMaxX;
      let viewMinY = sourceMinY;
      let viewMaxY = sourceMaxY;
      let viewHasAny = sourceHasAny;
      let viewOutlineMinX = outlineMinX;
      let viewOutlineMaxX = outlineMaxX;
      let viewOutlineMinY = outlineMinY;
      let viewOutlineMaxY = outlineMaxY;
      let viewOutlineHasAny = outlineHasAny;
      let pathData = stablePathData;
      const appendPart = (part: string | null): void => {
        if (part === null) return;
        pathData = pathData === "" ? part : `${pathData} ${part}`;
      };
      const foldOutlineView = (points: readonly (readonly number[])[]): void => {
        for (const vertex of points) {
          if (!viewOutlineHasAny) {
            viewOutlineHasAny = true;
            viewOutlineMinX = vertex[0]!;
            viewOutlineMaxX = vertex[0]!;
            viewOutlineMinY = vertex[1]!;
            viewOutlineMaxY = vertex[1]!;
            continue;
          }
          viewOutlineMinX = Math.min(viewOutlineMinX, vertex[0]!);
          viewOutlineMaxX = Math.max(viewOutlineMaxX, vertex[0]!);
          viewOutlineMinY = Math.min(viewOutlineMinY, vertex[1]!);
          viewOutlineMaxY = Math.max(viewOutlineMaxY, vertex[1]!);
        }
      };

      if (pointCount > 0) {
        if (!viewHasAny) {
          viewHasAny = true;
          viewMinX = lastRawX;
          viewMaxX = lastRawX;
          viewMinY = lastRawY;
          viewMaxY = lastRawY;
        } else {
          viewMinX = Math.min(viewMinX, lastRawX);
          viewMaxX = Math.max(viewMaxX, lastRawX);
          viewMinY = Math.min(viewMinY, lastRawY);
          viewMaxY = Math.max(viewMaxY, lastRawY);
        }
        normalizeInto(
          lastRawX,
          lastRawY,
          studioCroquisCapsuleRadiusFromPressure(
            pressures[pointCount - 1],
            renderStrokeWidth,
          ),
        );
        if (normXs.length === 1) {
          // 배치의 단일 점 특례: croquis 포인터 다운 점 원. 항상 휘발이라 두 번째 점이
          // 생기는 순간 자연히 사라진다.
          const radius = normRs[0]!;
          if (radius > 0) {
            const dot = studioCroquisCapsuleLoop(
              { kind: "circle", circle: { x: normXs[0]!, y: normYs[0]!, r: radius } },
              arcTolerancePx,
            );
            if (dot.length > 0) {
              for (const vertex of dot) {
                outlinePoints.push(Object.freeze([vertex[0]!, vertex[1]!]));
              }
              foldOutlineView(dot);
              appendPart(studioCroquisCapsuleLoopToPathPart(dot));
            }
          }
        } else {
          for (
            let endIndex = Math.max(1, stableNormCount - 1);
            endIndex <= normXs.length - 1;
            endIndex += 1
          ) {
            const emitted = emitLoop(endIndex);
            if (!emitted) continue;
            for (const vertex of emitted.points) {
              outlinePoints.push(Object.freeze([vertex[0]!, vertex[1]!]));
            }
            foldOutlineView(emitted.points);
            appendPart(emitted.part);
          }
        }
      }

      const sourceStrokeDistance = viewHasAny
        ? Math.hypot(viewMaxX - viewMinX, viewMaxY - viewMinY)
        : 0;
      const metrics: StudioPerfectFreehandRenderPlanMetrics = pointCount === 0
        ? { pointCount: 0, strokeDistance: 0, sparseSpacing: 0 }
        : {
            pointCount,
            strokeDistance: sourceStrokeDistance,
            sparseSpacing: sourceStrokeDistance / Math.max(1, pointCount - 1),
          };
      if (!pathData) {
        // 배치의 fail-closed 분기: 유효 기하가 전혀 없다(예: 전 구간 0 필압). 캡슐 뷰 배열을
        // 재구성해 같은 라운드 라인 폴백을 만든다 — 드문 경로라 O(n) 복사를 허용한다.
        const viewPoints = capsuleCoords.slice();
        if (viewPoints.length >= 2) {
          viewPoints[viewPoints.length - 2] = lastRawX;
          viewPoints[viewPoints.length - 1] = lastRawY;
        }
        const representativePressure = pointCount > 0
          ? runningPressureSum / pointCount
          : 0.5;
        return fallbackLinePlan(
          contract,
          input,
          viewPoints,
          metrics,
          "invalid-outline",
          true,
          Math.max(0.01, renderStrokeWidth * representativePressure),
        );
      }
      return {
        kind: "outline",
        contract,
        outline: outlinePoints,
        pathData,
        metrics: {
          ...metrics,
          outlinePointCount: outlinePoints.length,
          outlineDistance: viewOutlineHasAny
            ? Math.hypot(
                viewOutlineMaxX - viewOutlineMinX,
                viewOutlineMaxY - viewOutlineMinY,
              )
            : 0,
        },
      };
    },
  };
}

const INCREMENTAL_OUTLINE_PLANNER_CACHE = new Map<
  string,
  StudioIncrementalPerfectFreehandRenderPlanner
>();
/** 활성 초안은 하나지만 draft/commit 리렌더가 겹치는 짧은 창을 위해 소수의 최근 획을 유지한다. */
const INCREMENTAL_OUTLINE_PLANNER_LIMIT = 8;

/**
 * 획 키(요소 id)로 보관된 증분 아웃라인 플랜. `StudioDrawNode` 활성 초안의
 * `planStudioPerfectFreehandRender` 자리 교체용 — 크로키 캡슐 엔진은 증분으로, 그 외 엔진은
 * 내부에서 배치로 위임한다. 반환 플랜의 `outline`은 내부 보관 배열이므로 수정하면 안 된다.
 */
export function planStudioPerfectFreehandRenderIncremental(
  strokeKey: string,
  input: StudioPerfectFreehandRenderPlanInput,
): StudioPerfectFreehandRenderPlan {
  let planner = INCREMENTAL_OUTLINE_PLANNER_CACHE.get(strokeKey);
  if (planner) {
    // LRU 갱신: 재삽입으로 삽입 순서를 최근 사용 순서로 유지한다.
    INCREMENTAL_OUTLINE_PLANNER_CACHE.delete(strokeKey);
  } else {
    planner = createStudioIncrementalPerfectFreehandRenderPlanner();
  }
  INCREMENTAL_OUTLINE_PLANNER_CACHE.set(strokeKey, planner);
  while (
    INCREMENTAL_OUTLINE_PLANNER_CACHE.size > INCREMENTAL_OUTLINE_PLANNER_LIMIT
  ) {
    const oldest = INCREMENTAL_OUTLINE_PLANNER_CACHE.keys().next().value;
    if (oldest === undefined) break;
    INCREMENTAL_OUTLINE_PLANNER_CACHE.delete(oldest);
  }
  return planner.plan(input);
}
