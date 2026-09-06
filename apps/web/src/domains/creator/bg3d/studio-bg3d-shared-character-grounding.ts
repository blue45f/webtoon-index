/**
 * Pure admission and placement math for grounding one Shared Stage character.
 *
 * The renderer owns foot/bounds measurement and background raycasting. This module accepts those
 * world-space facts, diagnoses the current contact, and returns one Stage-local `placementY`
 * recommendation. It never mutates a Three object, a VRM document, the Shared Stage v3 document,
 * or caller-owned arrays.
 */

export const STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND =
  "toonspectrum.shared-character-grounding-receipt" as const;
export const STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION = 1 as const;

export const STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS = Object.freeze({
  maxAbsoluteWorldCoordinate: 10_000,
  maxAnchorEvaluations: 3,
  maxCorrectionMeters: 1,
  maxHorizontalSurfaceDistanceMeters: 2,
  maxGroundToleranceMeters: 0.05,
  maxSoleClearanceMeters: 0.05,
  minimumUpwardNormalY: 0.25,
});

export const STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS = Object.freeze({
  groundToleranceMeters: 0.005,
  soleClearanceMeters: 0,
  maxAnchorEvaluations:
    STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAnchorEvaluations,
  maxCorrectionMeters:
    STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxCorrectionMeters,
  maxHorizontalSurfaceDistanceMeters:
    STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxHorizontalSurfaceDistanceMeters,
});

export type StudioBg3dSharedCharacterGroundingVec3 = readonly [number, number, number];

export type StudioBg3dSharedCharacterGroundAnchorKind =
  | "left-foot"
  | "right-foot"
  | "lower-bound";

export interface StudioBg3dSharedCharacterGroundAnchor {
  readonly kind: StudioBg3dSharedCharacterGroundAnchorKind;
  /** Measured after pose, body scale and Stage placement have been applied. */
  readonly point: StudioBg3dSharedCharacterGroundingVec3;
}

export type StudioBg3dSharedCharacterSurfaceHit =
  | {
      readonly source: "background-surface";
      readonly targetEntityId: string;
      readonly point: StudioBg3dSharedCharacterGroundingVec3;
      readonly normal: StudioBg3dSharedCharacterGroundingVec3;
    }
  | {
      /** Explicit fallback when a downward ray finds no authored background receiver. */
      readonly source: "stage-plane";
      readonly point: StudioBg3dSharedCharacterGroundingVec3;
      readonly normal: StudioBg3dSharedCharacterGroundingVec3;
    };

export interface StudioBg3dSharedCharacterGroundingIdentity {
  readonly stageId?: string;
  readonly elementId: string;
  /** Changes only when the linked VRM model identity changes. */
  readonly modelRuntimeKey: string;
  /** Optimistic-concurrency identity for the effective Stage-local placement. */
  readonly placementHash: `sha256:${string}`;
}

export interface StudioBg3dSharedCharacterGroundingOptions {
  /** Absolute vertical gap still considered grounded. Defaults to 5mm. */
  readonly groundToleranceMeters?: number;
  /** Optional sole clearance above the raycast surface. Defaults to exact contact. */
  readonly soleClearanceMeters?: number;
}

export interface StudioBg3dSharedCharacterGroundingBudget {
  /** May only tighten the house maximum; it cannot widen runtime work. */
  readonly maxAnchorEvaluations?: number;
  /** Maximum absolute automatic Y correction. May only tighten the one-metre house budget. */
  readonly maxCorrectionMeters?: number;
  /** Rejects stale or unrelated hits too far from the support anchor in X/Z. */
  readonly maxHorizontalSurfaceDistanceMeters?: number;
}

export interface ResolveStudioBg3dSharedCharacterGroundingInput {
  readonly identity: StudioBg3dSharedCharacterGroundingIdentity;
  /** Existing Shared Stage `placement.position[1]`, in the same vertical frame as the anchors. */
  readonly placementY: number;
  /** One anchor per kind. Foot anchors take precedence; lower-bound is the fallback. */
  readonly anchors: readonly StudioBg3dSharedCharacterGroundAnchor[];
  readonly surfaceHit: StudioBg3dSharedCharacterSurfaceHit;
  readonly options?: StudioBg3dSharedCharacterGroundingOptions;
  readonly budget?: StudioBg3dSharedCharacterGroundingBudget;
}

export type StudioBg3dSharedCharacterGroundingDiagnosis =
  | "grounded"
  | "floating"
  | "penetrating";

export type StudioBg3dSharedCharacterGroundingAnchorPolicy =
  | "lowest-foot"
  | "lower-bound-fallback";

export interface StudioBg3dSharedCharacterGroundingReceipt {
  readonly kind: typeof STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND;
  readonly version: typeof STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION;
  readonly identity: Readonly<{
    readonly stageId: string | null;
    readonly elementId: string;
    readonly modelRuntimeKey: string;
    readonly placementHash: `sha256:${string}`;
  }>;
  readonly diagnosis: StudioBg3dSharedCharacterGroundingDiagnosis;
  readonly anchorPolicy: StudioBg3dSharedCharacterGroundingAnchorPolicy;
  readonly selectedAnchor: Readonly<{
    readonly kind: StudioBg3dSharedCharacterGroundAnchorKind;
    readonly point: StudioBg3dSharedCharacterGroundingVec3;
  }>;
  readonly surface: Readonly<{
    readonly source: StudioBg3dSharedCharacterSurfaceHit["source"];
    readonly targetEntityId: string | null;
    readonly point: StudioBg3dSharedCharacterGroundingVec3;
    readonly normal: StudioBg3dSharedCharacterGroundingVec3;
  }>;
  /** Placement before this derived recommendation. */
  readonly currentPlacementY: number;
  /** Existing Shared Stage placement Y to commit; no schema extension is required. */
  readonly placementY: number;
  /** Positive means floating; negative means penetrating. */
  readonly gapY: number;
  /** Remaining gap after the recommended correction. Grounded inputs retain their tolerated gap. */
  readonly resolvedGapY: number;
  readonly correctionY: number;
  readonly targetAnchorY: number;
  readonly didMove: boolean;
  readonly groundToleranceMeters: number;
  readonly soleClearanceMeters: number;
  readonly horizontalSurfaceDistanceMeters: number;
  readonly budget: Readonly<{
    readonly admittedAnchorCount: number;
    readonly evaluatedAnchorCount: number;
    readonly maxAnchorEvaluations: number;
    readonly maxCorrectionMeters: number;
    readonly maxHorizontalSurfaceDistanceMeters: number;
  }>;
}

export type StudioBg3dSharedCharacterGroundingFailureCode =
  | "invalid-input"
  | "invalid-identity"
  | "invalid-budget"
  | "anchor-budget-exceeded"
  | "invalid-anchor"
  | "invalid-surface-hit"
  | "unsupported-surface-normal"
  | "surface-distance-budget-exceeded"
  | "correction-budget-exceeded"
  | "result-out-of-bounds";

export type StudioBg3dSharedCharacterGroundingResult =
  | {
      readonly ok: true;
      readonly receipt: StudioBg3dSharedCharacterGroundingReceipt;
    }
  | {
      readonly ok: false;
      readonly code: StudioBg3dSharedCharacterGroundingFailureCode;
    };

interface NormalizedBudget {
  readonly maxAnchorEvaluations: number;
  readonly maxCorrectionMeters: number;
  readonly maxHorizontalSurfaceDistanceMeters: number;
}

interface NormalizedOptions {
  readonly groundToleranceMeters: number;
  readonly soleClearanceMeters: number;
}

interface NormalizedSurfaceHit {
  readonly source: StudioBg3dSharedCharacterSurfaceHit["source"];
  readonly targetEntityId: string | null;
  readonly point: StudioBg3dSharedCharacterGroundingVec3;
  readonly normal: StudioBg3dSharedCharacterGroundingVec3;
}

const ROOT_KEYS = new Set([
  "identity",
  "placementY",
  "anchors",
  "surfaceHit",
  "options",
  "budget",
]);
const IDENTITY_KEYS = new Set([
  "stageId",
  "elementId",
  "modelRuntimeKey",
  "placementHash",
]);
const ANCHOR_KEYS = new Set(["kind", "point"]);
const BACKGROUND_SURFACE_KEYS = new Set([
  "source",
  "targetEntityId",
  "point",
  "normal",
]);
const STAGE_PLANE_KEYS = new Set(["source", "point", "normal"]);
const OPTIONS_KEYS = new Set(["groundToleranceMeters", "soleClearanceMeters"]);
const BUDGET_KEYS = new Set([
  "maxAnchorEvaluations",
  "maxCorrectionMeters",
  "maxHorizontalSurfaceDistanceMeters",
]);
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const FORBIDDEN_ID_VALUES = new Set(["__proto__", "prototype", "constructor"]);
const MAX_STAGE_OR_ELEMENT_ID_LENGTH = 128;
const MAX_RUNTIME_KEY_LENGTH = 512;
const MAX_SURFACE_ENTITY_ID_LENGTH = 256;
const MAX_NORMAL_COMPONENT = 1_000_000;
const MIN_NORMAL_LENGTH = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedFinite(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function canonicalZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function tuple(
  x: number,
  y: number,
  z: number,
): StudioBg3dSharedCharacterGroundingVec3 {
  return Object.freeze([canonicalZero(x), canonicalZero(y), canonicalZero(z)]);
}

function readVector(
  value: unknown,
  maximumAbsoluteComponent: number,
): StudioBg3dSharedCharacterGroundingVec3 | null {
  if (
    !Array.isArray(value)
    || value.length !== 3
    || value.some((component) => !boundedFinite(
      component,
      -maximumAbsoluteComponent,
      maximumAbsoluteComponent,
    ))
  ) return null;
  return tuple(value[0], value[1], value[2]);
}

function safeText(value: unknown, maximumLength: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    && !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
    && !FORBIDDEN_ID_VALUES.has(value);
}

function failure(
  code: StudioBg3dSharedCharacterGroundingFailureCode,
): StudioBg3dSharedCharacterGroundingResult {
  return Object.freeze({ ok: false, code });
}

function normalizeBudget(value: unknown): NormalizedBudget | null {
  if (value !== undefined && (!isRecord(value) || !hasOnlyKeys(value, BUDGET_KEYS))) {
    return null;
  }
  const source = value as Record<string, unknown> | undefined;
  const maxAnchorEvaluations = source?.maxAnchorEvaluations
    ?? STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS.maxAnchorEvaluations;
  const maxCorrectionMeters = source?.maxCorrectionMeters
    ?? STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS.maxCorrectionMeters;
  const maxHorizontalSurfaceDistanceMeters = source?.maxHorizontalSurfaceDistanceMeters
    ?? STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS.maxHorizontalSurfaceDistanceMeters;
  if (
    !Number.isSafeInteger(maxAnchorEvaluations)
    || !boundedFinite(
      maxAnchorEvaluations,
      1,
      STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAnchorEvaluations,
    )
    || !boundedFinite(
      maxCorrectionMeters,
      Number.MIN_VALUE,
      STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxCorrectionMeters,
    )
    || !boundedFinite(
      maxHorizontalSurfaceDistanceMeters,
      Number.MIN_VALUE,
      STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxHorizontalSurfaceDistanceMeters,
    )
  ) return null;
  return Object.freeze({
    maxAnchorEvaluations,
    maxCorrectionMeters,
    maxHorizontalSurfaceDistanceMeters,
  });
}

function normalizeOptions(value: unknown): NormalizedOptions | null {
  if (value !== undefined && (!isRecord(value) || !hasOnlyKeys(value, OPTIONS_KEYS))) {
    return null;
  }
  const source = value as Record<string, unknown> | undefined;
  const groundToleranceMeters = source?.groundToleranceMeters
    ?? STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS.groundToleranceMeters;
  const soleClearanceMeters = source?.soleClearanceMeters
    ?? STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_DEFAULTS.soleClearanceMeters;
  if (
    !boundedFinite(
      groundToleranceMeters,
      0,
      STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxGroundToleranceMeters,
    )
    || !boundedFinite(
      soleClearanceMeters,
      0,
      STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxSoleClearanceMeters,
    )
  ) return null;
  return Object.freeze({ groundToleranceMeters, soleClearanceMeters });
}

function normalizeIdentity(
  value: unknown,
): StudioBg3dSharedCharacterGroundingReceipt["identity"] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, IDENTITY_KEYS)) return null;
  if (
    (value.stageId !== undefined
      && !safeText(value.stageId, MAX_STAGE_OR_ELEMENT_ID_LENGTH))
    || !safeText(value.elementId, MAX_STAGE_OR_ELEMENT_ID_LENGTH)
    || !safeText(value.modelRuntimeKey, MAX_RUNTIME_KEY_LENGTH)
    || typeof value.placementHash !== "string"
    || !HASH_PATTERN.test(value.placementHash)
  ) return null;
  return Object.freeze({
    stageId: value.stageId ?? null,
    elementId: value.elementId,
    modelRuntimeKey: value.modelRuntimeKey,
    placementHash: value.placementHash as `sha256:${string}`,
  });
}

function anchorKind(value: unknown): value is StudioBg3dSharedCharacterGroundAnchorKind {
  return value === "left-foot" || value === "right-foot" || value === "lower-bound";
}

function normalizeAnchors(
  value: unknown,
  budget: NormalizedBudget,
): readonly StudioBg3dSharedCharacterGroundAnchor[] | StudioBg3dSharedCharacterGroundingFailureCode {
  if (!Array.isArray(value) || value.length === 0) return "invalid-anchor";
  if (value.length > budget.maxAnchorEvaluations) return "anchor-budget-exceeded";

  const seenKinds = new Set<StudioBg3dSharedCharacterGroundAnchorKind>();
  const anchors: StudioBg3dSharedCharacterGroundAnchor[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate) || !hasOnlyKeys(candidate, ANCHOR_KEYS)) return "invalid-anchor";
    if (!anchorKind(candidate.kind) || seenKinds.has(candidate.kind)) return "invalid-anchor";
    const point = readVector(
      candidate.point,
      STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate,
    );
    if (!point) return "invalid-anchor";
    seenKinds.add(candidate.kind);
    anchors.push(Object.freeze({ kind: candidate.kind, point }));
  }
  return Object.freeze(anchors);
}

function normalizeSurfaceHit(
  value: unknown,
): NormalizedSurfaceHit | StudioBg3dSharedCharacterGroundingFailureCode {
  if (!isRecord(value)) return "invalid-surface-hit";
  const isBackground = value.source === "background-surface";
  const isStagePlane = value.source === "stage-plane";
  if (
    (!isBackground && !isStagePlane)
    || !hasOnlyKeys(value, isBackground ? BACKGROUND_SURFACE_KEYS : STAGE_PLANE_KEYS)
    || (isBackground && !safeText(value.targetEntityId, MAX_SURFACE_ENTITY_ID_LENGTH))
  ) return "invalid-surface-hit";

  const point = readVector(
    value.point,
    STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate,
  );
  const rawNormal = readVector(value.normal, MAX_NORMAL_COMPONENT);
  if (!point || !rawNormal) return "invalid-surface-hit";
  const normalLength = Math.hypot(rawNormal[0], rawNormal[1], rawNormal[2]);
  if (!Number.isFinite(normalLength) || normalLength < MIN_NORMAL_LENGTH) {
    return "invalid-surface-hit";
  }
  const normal = tuple(
    rawNormal[0] / normalLength,
    rawNormal[1] / normalLength,
    rawNormal[2] / normalLength,
  );
  if (normal[1] < STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.minimumUpwardNormalY) {
    return "unsupported-surface-normal";
  }
  const source: StudioBg3dSharedCharacterSurfaceHit["source"] = isBackground
    ? "background-surface"
    : "stage-plane";
  return Object.freeze({
    source,
    targetEntityId: isBackground ? value.targetEntityId as string : null,
    point,
    normal,
  });
}

function anchorRank(kind: StudioBg3dSharedCharacterGroundAnchorKind): number {
  if (kind === "left-foot") return 0;
  if (kind === "right-foot") return 1;
  return 2;
}

function selectSupportAnchor(
  anchors: readonly StudioBg3dSharedCharacterGroundAnchor[],
): {
  readonly policy: StudioBg3dSharedCharacterGroundingAnchorPolicy;
  readonly anchor: StudioBg3dSharedCharacterGroundAnchor;
  readonly evaluatedAnchorCount: number;
} {
  const feet = anchors.filter(({ kind }) => kind !== "lower-bound");
  const candidates = feet.length > 0
    ? feet
    : anchors.filter(({ kind }) => kind === "lower-bound");
  const ordered = [...candidates].sort((left, right) => (
    left.point[1] - right.point[1] || anchorRank(left.kind) - anchorRank(right.kind)
  ));
  return Object.freeze({
    policy: feet.length > 0 ? "lowest-foot" : "lower-bound-fallback",
    anchor: ordered[0]!,
    evaluatedAnchorCount: candidates.length,
  });
}

function diagnoseGap(
  gapY: number,
  tolerance: number,
): StudioBg3dSharedCharacterGroundingDiagnosis {
  if (gapY > tolerance) return "floating";
  if (gapY < -tolerance) return "penetrating";
  return "grounded";
}

/**
 * Resolves a deterministic, runtime-only grounding receipt.
 *
 * Foot anchors are authoritative when present; the lowest foot is the support anchor. A measured
 * lower bound is used only when no foot anchor is available, avoiding long garments or hair below
 * the feet from making a standing character float. The output changes only `placementY`; X/Z,
 * yaw, pose and source documents remain under their existing owners.
 */
export function resolveStudioBg3dSharedCharacterGrounding(
  input: ResolveStudioBg3dSharedCharacterGroundingInput | unknown,
): StudioBg3dSharedCharacterGroundingResult {
  if (!isRecord(input) || !hasOnlyKeys(input, ROOT_KEYS)) return failure("invalid-input");

  const identity = normalizeIdentity(input.identity);
  if (!identity) return failure("invalid-identity");
  const budget = normalizeBudget(input.budget);
  if (!budget) return failure("invalid-budget");
  const options = normalizeOptions(input.options);
  if (!options) return failure("invalid-input");
  if (!boundedFinite(
    input.placementY,
    -STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate,
    STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate,
  )) return failure("invalid-input");

  const anchors = normalizeAnchors(input.anchors, budget);
  if (typeof anchors === "string") return failure(anchors);
  const surface = normalizeSurfaceHit(input.surfaceHit);
  if (typeof surface === "string") return failure(surface);

  const support = selectSupportAnchor(anchors);
  const horizontalSurfaceDistanceMeters = Math.hypot(
    support.anchor.point[0] - surface.point[0],
    support.anchor.point[2] - surface.point[2],
  );
  if (
    !Number.isFinite(horizontalSurfaceDistanceMeters)
    || horizontalSurfaceDistanceMeters > budget.maxHorizontalSurfaceDistanceMeters
  ) return failure("surface-distance-budget-exceeded");

  const targetAnchorY = surface.point[1] + options.soleClearanceMeters;
  const gapY = support.anchor.point[1] - targetAnchorY;
  if (!Number.isFinite(targetAnchorY) || !Number.isFinite(gapY)) {
    return failure("result-out-of-bounds");
  }
  const diagnosis = diagnoseGap(gapY, options.groundToleranceMeters);
  const correctionY = diagnosis === "grounded" ? 0 : canonicalZero(-gapY);
  if (Math.abs(correctionY) > budget.maxCorrectionMeters) {
    return failure("correction-budget-exceeded");
  }
  const placementY = canonicalZero(input.placementY + correctionY);
  if (!boundedFinite(
    placementY,
    -STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate,
    STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_LIMITS.maxAbsoluteWorldCoordinate,
  )) return failure("result-out-of-bounds");

  const resolvedGapY = diagnosis === "grounded"
    ? canonicalZero(gapY)
    : canonicalZero(support.anchor.point[1] + correctionY - targetAnchorY);
  const receipt: StudioBg3dSharedCharacterGroundingReceipt = Object.freeze({
    kind: STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_KIND,
    version: STUDIO_BG3D_SHARED_CHARACTER_GROUNDING_RECEIPT_VERSION,
    identity,
    diagnosis,
    anchorPolicy: support.policy,
    selectedAnchor: Object.freeze({
      kind: support.anchor.kind,
      point: support.anchor.point,
    }),
    surface: Object.freeze({
      source: surface.source,
      targetEntityId: surface.targetEntityId,
      point: surface.point,
      normal: surface.normal,
    }),
    currentPlacementY: canonicalZero(input.placementY),
    placementY,
    gapY: canonicalZero(gapY),
    resolvedGapY,
    correctionY,
    targetAnchorY: canonicalZero(targetAnchorY),
    didMove: correctionY !== 0,
    groundToleranceMeters: options.groundToleranceMeters,
    soleClearanceMeters: options.soleClearanceMeters,
    horizontalSurfaceDistanceMeters: canonicalZero(horizontalSurfaceDistanceMeters),
    budget: Object.freeze({
      admittedAnchorCount: anchors.length,
      evaluatedAnchorCount: support.evaluatedAnchorCount,
      maxAnchorEvaluations: budget.maxAnchorEvaluations,
      maxCorrectionMeters: budget.maxCorrectionMeters,
      maxHorizontalSurfaceDistanceMeters: budget.maxHorizontalSurfaceDistanceMeters,
    }),
  });
  return Object.freeze({ ok: true, receipt });
}
