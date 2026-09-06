/**
 * Receipt-gated orchestration contract for the first canonical vNext dry-media presentation slice.
 *
 * This controller intentionally does not install itself in Studio. It connects the already-tested
 * shared RGBA16F presentation owner to the strict textured-brush runtime, while keeping the product
 * shell responsible for atomic last-good visibility and DrawEl persistence. The narrow boundary is
 * useful before a host is mounted because it makes every authority transition and quality gate
 * testable without introducing a half-wired renderer into the pointer path.
 */

import {
  fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics,
  type StudioEngineWebGpuTexturedBrushPlan,
} from "./render/studio-engine-webgpu-textured-brush-plan";
import { hashStudioCanonicalBrushPlan } from "./studio-canonical-brush-plan";

import type {
  StudioEngineWebGpuPresentationFrameLease,
  StudioEngineWebGpuPresentationFrameRequest,
  StudioEngineWebGpuPresentationProducerReceipt,
  StudioEngineWebGpuPresentationReceipt,
  StudioEngineWebGpuPresentationResult,
  StudioEngineWebGpuPresentationSurface,
  StudioEngineWebGpuPresentationSurfaceStats,
} from "./render/studio-engine-webgpu-presentation-surface";
import type {
  StudioEngineWebGpuTexturedBrushExecutionResult,
  StudioEngineWebGpuTexturedBrushFrame,
  StudioEngineWebGpuTexturedBrushReceipt,
} from "./render/studio-engine-webgpu-textured-brush-runtime";
import type { StudioCanonicalBrushPlan } from "./studio-canonical-brush-plan";

export const STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION =
  1 as const;
export const STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CATALOG_ID = "dry-media" as const;

export interface StudioCanonicalVNextDryMediaCompiledFrame {
  readonly kind: "studio-canonical-vnext-dry-media-compiled-frame";
  readonly version:
    typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION;
  readonly catalogId: typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CATALOG_ID;
  readonly canonicalPlan: StudioCanonicalBrushPlan;
  readonly canonicalPlanHash: string;
  /**
   * Whole-prefix rebuild plan. Pointer previews may replace this object as samples arrive, but the
   * final-live and pointer-up commit phases must submit the exact same compiled frame object.
   */
  readonly texturedPlan: StudioEngineWebGpuTexturedBrushPlan;
}

export interface StudioCanonicalVNextDryMediaPresentationSurfaceBoundary {
  stats(): StudioEngineWebGpuPresentationSurfaceStats;
  beginFrame(
    request: StudioEngineWebGpuPresentationFrameRequest,
  ): ReturnType<StudioEngineWebGpuPresentationSurface["beginFrame"]>;
  abortFrame(
    frame: StudioEngineWebGpuPresentationFrameLease,
  ): ReturnType<StudioEngineWebGpuPresentationSurface["abortFrame"]>;
  presentFrame(
    frame: StudioEngineWebGpuPresentationFrameLease,
    producerReceipt: StudioEngineWebGpuPresentationProducerReceipt,
  ): Promise<StudioEngineWebGpuPresentationResult>;
  authorizesVisibility(receipt: StudioEngineWebGpuPresentationReceipt): boolean;
}

export interface StudioCanonicalVNextDryMediaTexturedRuntimeBoundary {
  execute(
    frame: StudioEngineWebGpuTexturedBrushFrame,
    signal?: AbortSignal,
  ): Promise<StudioEngineWebGpuTexturedBrushExecutionResult>;
}

export type StudioCanonicalVNextDryMediaQualityRejectionReason =
  | "canonical-hash-mismatch"
  | "catalog-not-approved"
  | "directional-tip-required"
  | "endpoint-coverage-required"
  | "grain-required"
  | "invalid-frame"
  | "nonuniform-tip-required"
  | "pressure-response-required"
  | "rebuild-plan-required"
  | "source-over-required"
  | "spacing-continuity-required"
  | "tangent-alignment-required"
  | "textured-tip-required";

export type StudioCanonicalVNextDryMediaPresentationUnavailableReason =
  | StudioCanonicalVNextDryMediaQualityRejectionReason
  | "cancelled"
  | "controller-busy"
  | "presentation-begin-rejected"
  | "presentation-not-authorized"
  | "presentation-rejected"
  | "runtime-rejected"
  | "surface-not-ready";

export interface StudioCanonicalVNextDryMediaVisibleFrameReceipt {
  readonly kind: "studio-canonical-vnext-dry-media-visible-frame-receipt";
  readonly version:
    typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION;
  readonly phase: "pointer-preview" | "final-live" | "commit";
  readonly canonicalPlan: StudioCanonicalBrushPlan;
  readonly canonicalPlanHash: string;
  readonly seed: number;
  readonly texturedPlan: StudioEngineWebGpuTexturedBrushPlan;
  readonly texturedPlanFingerprint: `sha256:${string}`;
  readonly runtime: StudioEngineWebGpuTexturedBrushReceipt;
  readonly presentation: StudioEngineWebGpuPresentationReceipt;
  readonly specialistSurfaceVisible: true;
  readonly retainedCanvasAuthority: "recoverable-last-good";
  readonly persistentAuthority: "draw-el-vector";
  readonly rasterPromotion: "not-promoted";
}

export type StudioCanonicalVNextDryMediaVisibleFrameResult =
  | Readonly<{
      status: "presented";
      receipt: StudioCanonicalVNextDryMediaVisibleFrameReceipt;
    }>
  | Readonly<{
      status: "unavailable";
      reason: StudioCanonicalVNextDryMediaPresentationUnavailableReason;
      detail?: string;
    }>;

export type StudioCanonicalVNextDryMediaFinalParityResult =
  | Readonly<{
      status: "completed";
      receipt: Readonly<{
        kind: "studio-canonical-vnext-dry-media-final-parity-receipt";
        version:
          typeof STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION;
        canonicalPlan: StudioCanonicalBrushPlan;
        canonicalPlanHash: string;
        seed: number;
        texturedPlan: StudioEngineWebGpuTexturedBrushPlan;
        sameCanonicalPlan: true;
        sameCanonicalPlanHash: true;
        samePersistedSeed: true;
        sameTexturedPlan: true;
        sameTexturedPlanFingerprint: true;
        sameOutputLineage: true;
        samePresentationConfiguration: true;
        live: StudioCanonicalVNextDryMediaVisibleFrameReceipt;
        commit: StudioCanonicalVNextDryMediaVisibleFrameReceipt;
        specialistSurfaceVisible: true;
        retainedCanvasAuthority: "recoverable-last-good";
        persistentAuthority: "draw-el-vector";
        rasterPromotion: "not-promoted";
      }>;
    }>
  | Extract<
      StudioCanonicalVNextDryMediaVisibleFrameResult,
      { readonly status: "unavailable" }
    >;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function span(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!finite(value)) return 0;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return maximum - minimum;
}

function nonuniformTip(plan: StudioEngineWebGpuTexturedBrushPlan): boolean {
  const asset = plan.assets[plan.tip.assetIndex];
  if (
    !asset
    || asset.role !== "tip"
    || asset.bytes.length < 4
    || asset.width < 2
    || asset.height < 2
  ) return false;
  const first = asset.bytes[0];
  return asset.bytes.some((value) => value !== first);
}

interface DryMediaTipBasis {
  readonly majorAngleRadians: number;
  readonly majorRadius: number;
  readonly minorRadius: number;
  readonly xAxis: readonly [number, number];
  readonly yAxis: readonly [number, number];
}

interface DryMediaStationGroup {
  readonly stationX: number;
  readonly stationY: number;
  readonly dabs: readonly StudioEngineWebGpuTexturedBrushPlan["dabs"][number][];
}

/**
 * One physical dry-media deposit may contain three or five parallel fibres. They intentionally
 * share the same unscattered station while carrying different x/y offsets, tip axes and grain
 * phases. Treating adjacent fibres as consecutive path stations invents a lateral "gap" and makes
 * the quality gate reject the exact multi-lane material it is supposed to protect.
 */
function stationGroups(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): readonly DryMediaStationGroup[] {
  const groups: Array<{
    stationX: number;
    stationY: number;
    dabs: StudioEngineWebGpuTexturedBrushPlan["dabs"][number][];
  }> = [];
  const epsilon = 1e-4;
  for (const dab of plan.dabs) {
    const previous = groups.at(-1);
    if (
      previous
      && Math.abs(previous.stationX - dab.stationX) <= epsilon
      && Math.abs(previous.stationY - dab.stationY) <= epsilon
    ) {
      previous.dabs.push(dab);
    } else {
      groups.push({
        stationX: dab.stationX,
        stationY: dab.stationY,
        dabs: [dab],
      });
    }
  }
  return groups;
}

function tipBasis(
  dab: StudioEngineWebGpuTexturedBrushPlan["dabs"][number],
): DryMediaTipBasis | null {
  const [xx, xy, yx, yy] = dab.tip.localToDocument;
  const xRadius = Math.hypot(xx, xy);
  const yRadius = Math.hypot(yx, yy);
  if (
    ![xx, xy, yx, yy, xRadius, yRadius].every(finite)
    || xRadius <= 0
    || yRadius <= 0
    || Math.abs(xx * yy - yx * xy) <= 1e-9
  ) return null;
  const xIsMajor = xRadius >= yRadius;
  const major = xIsMajor ? [xx, xy] as const : [yx, yy] as const;
  return Object.freeze({
    majorAngleRadians: Math.atan2(major[1], major[0]),
    majorRadius: Math.max(xRadius, yRadius),
    minorRadius: Math.min(xRadius, yRadius),
    xAxis: [xx, xy] as const,
    yAxis: [yx, yy] as const,
  });
}

function hasDirectionalTip(plan: StudioEngineWebGpuTexturedBrushPlan): boolean {
  return plan.dabs.length > 0 && plan.dabs.every((dab) => {
    const [xx, xy, yx, yy] = dab.tip.localToDocument;
    const primary = Math.hypot(xx, xy);
    const secondary = Math.hypot(yx, yy);
    if (!finite(primary) || !finite(secondary) || primary <= 0 || secondary <= 0) {
      return false;
    }
    const anisotropy = Math.min(primary, secondary) / Math.max(primary, secondary);
    return anisotropy <= 0.9;
  });
}

function hasPressureResponse(plan: StudioEngineWebGpuTexturedBrushPlan): boolean {
  const groups = stationGroups(plan);
  if (groups.length === 0) return false;
  const responses = groups.map((group) => ({
    pressure: group.dabs.reduce((sum, dab) => sum + dab.pressure, 0) / group.dabs.length,
    diameter: Math.max(...group.dabs.map(({ diameter }) => diameter)),
    alpha: Math.max(...group.dabs.map(({ color }) => color.components[3])),
  }));
  const pressureSpan = span(responses.map(({ pressure }) => pressure));
  /*
   * A tap or a constant-pressure flick cannot demonstrate a response curve, but it must not be
   * rejected for lacking an artificial pressure change. The gate below becomes strict as soon as
   * the accepted input actually contains a meaningful pressure range.
   */
  if (pressureSpan < 0.05) {
    return groups.every((group) =>
      group.dabs.every((dab) =>
        dab.diameter > 0
        && dab.color.components[3] > 0
        && dab.opacity > 0
        && dab.flow > 0
      )
    );
  }
  const diameterResponse = span(responses.map(({ diameter }) => diameter));
  const alphaResponse = span(responses.map(({ alpha }) => alpha));
  if (diameterResponse < 0.25 || alphaResponse < 0.01) return false;
  let comparable = 0;
  let concordantDiameter = 0;
  let concordantAlpha = 0;
  for (let index = 1; index < responses.length; index += 1) {
    const previous = responses[index - 1]!;
    const current = responses[index]!;
    const pressureDelta = current.pressure - previous.pressure;
    if (Math.abs(pressureDelta) < 0.02) continue;
    comparable += 1;
    const direction = Math.sign(pressureDelta);
    if ((current.diameter - previous.diameter) * direction >= -0.05) {
      concordantDiameter += 1;
    }
    if (
      (current.alpha - previous.alpha) * direction
      >= -0.005
    ) {
      concordantAlpha += 1;
    }
  }
  if (comparable === 0) {
    const ordered = [...responses].sort((left, right) =>
      left.pressure - right.pressure
    );
    const light = ordered[0]!;
    const heavy = ordered.at(-1)!;
    return heavy.diameter >= light.diameter + 0.25
      && heavy.alpha >= light.alpha + 0.01;
  }
  return concordantDiameter / comparable >= 0.75
    && concordantAlpha / comparable >= 0.75;
}

function hasContinuousSpacing(plan: StudioEngineWebGpuTexturedBrushPlan): boolean {
  const groups = stationGroups(plan);
  if (groups.length === 0) return false;
  if (groups.length === 1) return groups[0]!.dabs.every((dab) => tipBasis(dab));
  for (let index = 1; index < groups.length; index += 1) {
    const previous = groups[index - 1]!;
    const current = groups[index]!;
    const deltaX = current.stationX - previous.stationX;
    const deltaY = current.stationY - previous.stationY;
    const distance = Math.hypot(deltaX, deltaY);
    if (
      !finite(distance)
      || distance <= 0
    ) return false;
    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    /*
     * Exact affine-ellipse support in the travel direction. Requiring a 20% overlap margin keeps
     * the R8 zero-border from exposing regularly spaced round dab joints on fast, long strokes.
     */
    const support = (group: DryMediaStationGroup) => {
      let maximum = 0;
      for (const dab of group.dabs) {
        const basis = tipBasis(dab);
        if (!basis) return null;
        maximum = Math.max(maximum, Math.hypot(
          basis.xAxis[0] * unitX + basis.xAxis[1] * unitY,
          basis.yAxis[0] * unitX + basis.yAxis[1] * unitY,
        ));
      }
      return maximum;
    };
    const previousSupport = support(previous);
    const currentSupport = support(current);
    if (previousSupport === null || currentSupport === null) return false;
    const overlapReach = previousSupport + currentSupport;
    if (distance > overlapReach * 0.8) return false;
  }
  return true;
}

function axisAngleDelta(left: number, right: number): number {
  let delta = Math.abs(left - right) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta;
}

function tangentForStationGroup(
  groups: readonly DryMediaStationGroup[],
  index: number,
): number | null {
  if (groups.length <= 1) return null;
  const previous = groups[Math.max(0, index - 1)]!;
  const next = groups[Math.min(groups.length - 1, index + 1)]!;
  const deltaX = next.stationX - previous.stationX;
  const deltaY = next.stationY - previous.stationY;
  return Math.hypot(deltaX, deltaY) > 1e-8
    ? Math.atan2(deltaY, deltaX)
    : null;
}

function hasTangentAlignedTip(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): boolean {
  const groups = stationGroups(plan);
  for (let index = 0; index < groups.length; index += 1) {
    const tangent = tangentForStationGroup(groups, index);
    for (const dab of groups[index]!.dabs) {
      const basis = tipBasis(dab);
      if (!basis) return false;
      if (
        tangent !== null
        && axisAngleDelta(basis.majorAngleRadians, tangent) > Math.PI / 5
      ) {
        return false;
      }
    }
  }
  return plan.dabs.length > 0;
}

function sampleTipAlpha(
  plan: StudioEngineWebGpuTexturedBrushPlan,
  dab: StudioEngineWebGpuTexturedBrushPlan["dabs"][number],
  documentX: number,
  documentY: number,
): number {
  const asset = plan.assets[plan.tip.assetIndex];
  if (!asset) return 0;
  const [xx, xy, yx, yy] = dab.tip.localToDocument;
  const determinant = xx * yy - yx * xy;
  if (!finite(determinant) || Math.abs(determinant) <= 1e-9) return 0;
  const deltaX = documentX - dab.x;
  const deltaY = documentY - dab.y;
  const localX = (yy * deltaX - yx * deltaY) / determinant;
  const localY = (-xy * deltaX + xx * deltaY) / determinant;
  const pixelX = (localX * 0.5 + 0.5) * asset.width - 0.5;
  const pixelY = (localY * 0.5 + 0.5) * asset.height - 0.5;
  const x0 = Math.floor(pixelX);
  const y0 = Math.floor(pixelY);
  const mixX = pixelX - x0;
  const mixY = pixelY - y0;
  const texel = (x: number, y: number) =>
    x < 0 || y < 0 || x >= asset.width || y >= asset.height
      ? 0
      : (asset.bytes[y * asset.width + x] ?? 0) / 255;
  const upper = texel(x0, y0) * (1 - mixX) + texel(x0 + 1, y0) * mixX;
  const lower =
    texel(x0, y0 + 1) * (1 - mixX) + texel(x0 + 1, y0 + 1) * mixX;
  const sampled = upper * (1 - mixY) + lower * mixY;
  const edge = Math.max(1 / 65_535, 1 - dab.tip.hardness);
  const normalized = Math.min(1, Math.max(0, sampled / edge));
  return normalized * normalized * (3 - 2 * normalized);
}

function hasEndpointCoverage(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): boolean {
  const groups = stationGroups(plan);
  if (groups.length === 0) return false;
  for (const group of [groups[0]!, groups.at(-1)!]) {
    let remainingTransparency = 1;
    for (const dab of group.dabs) {
      const coverage = sampleTipAlpha(
        plan,
        dab,
        group.stationX,
        group.stationY,
      );
      if (!finite(coverage)) return false;
      const alpha = clamp01(coverage * dab.color.components[3]);
      remainingTransparency *= 1 - alpha;
    }
    if (1 - remainingTransparency < 0.015) return false;
  }
  return true;
}

function usesMonotonicSourceOver(
  plan: StudioEngineWebGpuTexturedBrushPlan,
): boolean {
  if (plan.dabs.length === 0) return false;
  const reference = plan.dabs[0]!.color.components;
  return plan.dabs.every((dab) =>
    dab.composite.porterDuff === "source-over"
    && dab.composite.blendMode === "normal"
    && dab.color.components[3] >= 0
    && dab.color.components[3] <= 1
    && Math.abs(dab.color.components[0] - reference[0]) <= 1e-6
    && Math.abs(dab.color.components[1] - reference[1]) <= 1e-6
    && Math.abs(dab.color.components[2] - reference[2]) <= 1e-6
  );
}

export function validateStudioCanonicalVNextDryMediaCompiledFrame(
  input: unknown,
): Readonly<{ status: "ready"; fingerprint: `sha256:${string}` }>
  | Readonly<{
      status: "rejected";
      reason: StudioCanonicalVNextDryMediaQualityRejectionReason;
    }> {
  if (typeof input !== "object" || input === null) {
    return Object.freeze({ status: "rejected", reason: "invalid-frame" });
  }
  const frame = input as Partial<StudioCanonicalVNextDryMediaCompiledFrame>;
  if (
    frame.kind !== "studio-canonical-vnext-dry-media-compiled-frame"
    || frame.version
      !== STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION
    || !frame.canonicalPlan
    || !frame.texturedPlan
    || typeof frame.canonicalPlanHash !== "string"
  ) return Object.freeze({ status: "rejected", reason: "invalid-frame" });
  if (frame.catalogId !== STUDIO_CANONICAL_VNEXT_DRY_MEDIA_CATALOG_ID) {
    return Object.freeze({ status: "rejected", reason: "catalog-not-approved" });
  }
  let canonicalHash: string;
  try {
    canonicalHash = hashStudioCanonicalBrushPlan(frame.canonicalPlan);
  } catch {
    return Object.freeze({ status: "rejected", reason: "invalid-frame" });
  }
  if (canonicalHash !== frame.canonicalPlanHash) {
    return Object.freeze({ status: "rejected", reason: "canonical-hash-mismatch" });
  }
  if (frame.canonicalPlan.recipe.tip.kind !== "texture") {
    return Object.freeze({ status: "rejected", reason: "textured-tip-required" });
  }
  if (frame.texturedPlan.mode !== "rebuild") {
    return Object.freeze({ status: "rejected", reason: "rebuild-plan-required" });
  }
  if (
    frame.texturedPlan.strokeId !== frame.canonicalPlan.strokeId
    || frame.texturedPlan.commandSequence !== frame.canonicalPlan.commandSequence
  ) return Object.freeze({ status: "rejected", reason: "invalid-frame" });
  const fingerprint =
    fingerprintStudioEngineWebGpuTexturedBrushPlanSemantics(frame.texturedPlan);
  if (!fingerprint || frame.texturedPlan.semanticFingerprint !== fingerprint) {
    return Object.freeze({ status: "rejected", reason: "invalid-frame" });
  }
  if (!nonuniformTip(frame.texturedPlan)) {
    return Object.freeze({ status: "rejected", reason: "nonuniform-tip-required" });
  }
  if (
    !frame.texturedPlan.grain
    || frame.texturedPlan.grain.depth <= 0
    || frame.texturedPlan.dabs.every(({ grainDepth }) => grainDepth <= 0)
  ) return Object.freeze({ status: "rejected", reason: "grain-required" });
  if (!hasDirectionalTip(frame.texturedPlan)) {
    return Object.freeze({ status: "rejected", reason: "directional-tip-required" });
  }
  if (!hasTangentAlignedTip(frame.texturedPlan)) {
    return Object.freeze({
      status: "rejected",
      reason: "tangent-alignment-required",
    });
  }
  if (!hasPressureResponse(frame.texturedPlan)) {
    return Object.freeze({ status: "rejected", reason: "pressure-response-required" });
  }
  if (!usesMonotonicSourceOver(frame.texturedPlan)) {
    return Object.freeze({ status: "rejected", reason: "source-over-required" });
  }
  if (!hasContinuousSpacing(frame.texturedPlan)) {
    return Object.freeze({ status: "rejected", reason: "spacing-continuity-required" });
  }
  if (!hasEndpointCoverage(frame.texturedPlan)) {
    return Object.freeze({
      status: "rejected",
      reason: "endpoint-coverage-required",
    });
  }
  return Object.freeze({ status: "ready", fingerprint });
}

function unavailableResult(
  reason: StudioCanonicalVNextDryMediaPresentationUnavailableReason,
  detail?: string,
): Extract<
  StudioCanonicalVNextDryMediaVisibleFrameResult,
  { readonly status: "unavailable" }
> {
  return Object.freeze({
    status: "unavailable",
    reason,
    ...(detail ? { detail } : {}),
  });
}

function hasSameFinalOutputLineage(
  live: StudioCanonicalVNextDryMediaVisibleFrameReceipt,
  commit: StudioCanonicalVNextDryMediaVisibleFrameReceipt,
): boolean {
  const liveRuntime = live.runtime;
  const commitRuntime = commit.runtime;
  const livePresentation = live.presentation;
  const commitPresentation = commit.presentation;
  const fingerprint = live.texturedPlanFingerprint;
  const contentFingerprint = liveRuntime.contentFingerprint;

  return (
    fingerprint === commit.texturedPlanFingerprint
    && liveRuntime.sourceFrameFingerprint === fingerprint
    && commitRuntime.sourceFrameFingerprint === fingerprint
    && liveRuntime.planSemanticFingerprint === fingerprint
    && commitRuntime.planSemanticFingerprint === fingerprint
    && livePresentation.sourceFrameFingerprint === fingerprint
    && commitPresentation.sourceFrameFingerprint === fingerprint
    && contentFingerprint !== null
    && commitRuntime.contentFingerprint === contentFingerprint
    && livePresentation.contentFingerprint === contentFingerprint
    && commitPresentation.contentFingerprint === contentFingerprint
    /*
     * Request sequence and content generation are intentionally excluded: they advance for the
     * second rebuild. Everything that determines which pixels were rendered and how those pixels
     * are interpreted must remain identical.
     */
    && liveRuntime.deviceEpoch === commitRuntime.deviceEpoch
    && liveRuntime.deviceEpoch === livePresentation.deviceEpoch
    && commitRuntime.deviceEpoch === commitPresentation.deviceEpoch
    && liveRuntime.workSurfaceEpoch === commitRuntime.workSurfaceEpoch
    && liveRuntime.workSurfaceEpoch === livePresentation.workSurfaceEpoch
    && commitRuntime.workSurfaceEpoch === commitPresentation.workSurfaceEpoch
    && liveRuntime.mode === commitRuntime.mode
    && liveRuntime.mode === livePresentation.mode
    && commitRuntime.mode === commitPresentation.mode
    && liveRuntime.textureFormat === commitRuntime.textureFormat
    && liveRuntime.textureFormat === livePresentation.textureFormat
    && commitRuntime.textureFormat === commitPresentation.textureFormat
    && liveRuntime.colorModel === commitRuntime.colorModel
    && liveRuntime.colorModel === livePresentation.colorModel
    && commitRuntime.colorModel === commitPresentation.colorModel
    && livePresentation.deviceEpoch === commitPresentation.deviceEpoch
    && livePresentation.presentationEpoch === commitPresentation.presentationEpoch
    && livePresentation.resizeEpoch === commitPresentation.resizeEpoch
    && livePresentation.viewportEpoch === commitPresentation.viewportEpoch
    && livePresentation.flipEpoch === commitPresentation.flipEpoch
    && livePresentation.workSurfaceEpoch === commitPresentation.workSurfaceEpoch
    && livePresentation.width === commitPresentation.width
    && livePresentation.height === commitPresentation.height
    && livePresentation.textureFormat === commitPresentation.textureFormat
    && livePresentation.canvasFormat === commitPresentation.canvasFormat
    && livePresentation.colorModel === commitPresentation.colorModel
    && livePresentation.workingColorSpace === commitPresentation.workingColorSpace
    && livePresentation.presentationColorSpace
      === commitPresentation.presentationColorSpace
    && livePresentation.alphaMode === commitPresentation.alphaMode
  );
}

export class StudioCanonicalVNextDryMediaPresentationController {
  readonly #surface: StudioCanonicalVNextDryMediaPresentationSurfaceBoundary;
  readonly #runtime: StudioCanonicalVNextDryMediaTexturedRuntimeBoundary;
  #requestSequence = 0;
  #busy = false;

  public constructor(input: Readonly<{
    surface: StudioCanonicalVNextDryMediaPresentationSurfaceBoundary;
    runtime: StudioCanonicalVNextDryMediaTexturedRuntimeBoundary;
  }>) {
    if (
      !input?.surface
      || typeof input.surface.stats !== "function"
      || typeof input.surface.beginFrame !== "function"
      || typeof input.surface.abortFrame !== "function"
      || typeof input.surface.presentFrame !== "function"
      || typeof input.surface.authorizesVisibility !== "function"
      || !input.runtime
      || typeof input.runtime.execute !== "function"
    ) throw new TypeError("Invalid dry-media presentation controller boundaries.");
    this.#surface = input.surface;
    this.#runtime = input.runtime;
  }

  public presentPointerPreview(
    frame: StudioCanonicalVNextDryMediaCompiledFrame,
    signal?: AbortSignal,
  ): Promise<StudioCanonicalVNextDryMediaVisibleFrameResult> {
    return this.#present(frame, "pointer-preview", signal);
  }

  /**
   * Executes the exact same immutable compiled frame twice. The first receipt proves the final
   * pointer-visible pixels; the second proves pointer-up commit parity. Persistence remains the
   * caller's original DrawEl/vector operation, so this vertical slice cannot silently rasterize a
   * document or replace undo/replay authority.
   */
  public async presentFinalLiveAndCommit(
    frame: StudioCanonicalVNextDryMediaCompiledFrame,
    signal?: AbortSignal,
  ): Promise<StudioCanonicalVNextDryMediaFinalParityResult> {
    const live = await this.#present(frame, "final-live", signal);
    if (live.status !== "presented") return live;
    const commit = await this.#present(frame, "commit", signal);
    if (commit.status !== "presented") return commit;
    if (
      live.receipt.canonicalPlan !== frame.canonicalPlan
      || commit.receipt.canonicalPlan !== frame.canonicalPlan
      || live.receipt.texturedPlan !== frame.texturedPlan
      || commit.receipt.texturedPlan !== frame.texturedPlan
      || live.receipt.canonicalPlanHash !== commit.receipt.canonicalPlanHash
      || live.receipt.seed !== commit.receipt.seed
      || !hasSameFinalOutputLineage(live.receipt, commit.receipt)
    ) return unavailableResult("presentation-not-authorized", "final-parity");
    return Object.freeze({
      status: "completed",
      receipt: Object.freeze({
        kind: "studio-canonical-vnext-dry-media-final-parity-receipt",
        version:
          STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION,
        canonicalPlan: frame.canonicalPlan,
        canonicalPlanHash: frame.canonicalPlanHash,
        seed: frame.canonicalPlan.seed,
        texturedPlan: frame.texturedPlan,
        sameCanonicalPlan: true,
        sameCanonicalPlanHash: true,
        samePersistedSeed: true,
        sameTexturedPlan: true,
        sameTexturedPlanFingerprint: true,
        sameOutputLineage: true,
        samePresentationConfiguration: true,
        live: live.receipt,
        commit: commit.receipt,
        specialistSurfaceVisible: true,
        retainedCanvasAuthority: "recoverable-last-good",
        persistentAuthority: "draw-el-vector",
        rasterPromotion: "not-promoted",
      }),
    });
  }

  async #present(
    frame: StudioCanonicalVNextDryMediaCompiledFrame,
    phase: StudioCanonicalVNextDryMediaVisibleFrameReceipt["phase"],
    signal?: AbortSignal,
  ): Promise<StudioCanonicalVNextDryMediaVisibleFrameResult> {
    if (signal?.aborted) return unavailableResult("cancelled");
    if (this.#busy) return unavailableResult("controller-busy");
    const validated = validateStudioCanonicalVNextDryMediaCompiledFrame(frame);
    if (validated.status !== "ready") return unavailableResult(validated.reason);
    const stats = this.#surface.stats();
    if (
      stats.status !== "ready"
      || !stats.configured
      || stats.presentationEpoch <= 0
      || stats.resizeEpoch <= 0
      || stats.viewportEpoch <= 0
      || stats.flipEpoch <= 0
    ) return unavailableResult("surface-not-ready");
    this.#busy = true;
    let lease: StudioEngineWebGpuPresentationFrameLease | null = null;
    try {
      this.#requestSequence = Math.max(
        this.#requestSequence + 1,
        stats.lastAcceptedRequestSequence + 1,
      );
      const begun = this.#surface.beginFrame({
        requestSequence: this.#requestSequence,
        deviceEpoch: stats.deviceEpoch,
        presentationEpoch: stats.presentationEpoch,
        resizeEpoch: stats.resizeEpoch,
        viewportEpoch: stats.viewportEpoch,
        flipEpoch: stats.flipEpoch,
        sourceFrameFingerprint: validated.fingerprint,
      });
      if (begun.status !== "ready") {
        return unavailableResult("presentation-begin-rejected", begun.reason);
      }
      lease = begun.frame;
      const rendered = await this.#runtime.execute({
        requestSequence: this.#requestSequence,
        deviceEpoch: stats.deviceEpoch,
        plan: frame.texturedPlan,
        presentationLease: lease,
      }, signal);
      if (rendered.status !== "completed") {
        this.#surface.abortFrame(lease);
        lease = null;
        return unavailableResult(
          signal?.aborted ? "cancelled" : "runtime-rejected",
          rendered.status === "rejected" ? rendered.reason : rendered.status,
        );
      }
      if (
        rendered.receipt.complete !== true
        || rendered.receipt.renderTarget !== "presentation"
        || rendered.receipt.sourceFrameFingerprint !== validated.fingerprint
        || rendered.receipt.workSurfaceEpoch !== lease.workSurface.workSurfaceEpoch
      ) {
        this.#surface.abortFrame(lease);
        lease = null;
        return unavailableResult("runtime-rejected", "receipt-mismatch");
      }
      const presented = await this.#surface.presentFrame(
        lease,
        rendered.receipt,
      );
      if (presented.status !== "presented") {
        /*
         * A producer rejection must not strand an active work-surface lease. Concrete surfaces
         * normally consume a valid receipt, but injected/runtime-version-skew boundaries can reject
         * before consumption. Abort is intentionally idempotent/fail-closed from this controller's
         * perspective, and retained Canvas pixels stay visible.
         */
        this.#surface.abortFrame(lease);
        lease = null;
        return unavailableResult(
          "presentation-rejected",
          presented.reason,
        );
      }
      lease = null;
      if (!this.#surface.authorizesVisibility(presented.receipt)) {
        return unavailableResult("presentation-not-authorized");
      }
      return Object.freeze({
        status: "presented",
        receipt: Object.freeze({
          kind: "studio-canonical-vnext-dry-media-visible-frame-receipt",
          version:
            STUDIO_CANONICAL_VNEXT_DRY_MEDIA_PRESENTATION_CONTROLLER_VERSION,
          phase,
          canonicalPlan: frame.canonicalPlan,
          canonicalPlanHash: frame.canonicalPlanHash,
          seed: frame.canonicalPlan.seed,
          texturedPlan: frame.texturedPlan,
          texturedPlanFingerprint: validated.fingerprint,
          runtime: rendered.receipt,
          presentation: presented.receipt,
          specialistSurfaceVisible: true,
          retainedCanvasAuthority: "recoverable-last-good",
          persistentAuthority: "draw-el-vector",
          rasterPromotion: "not-promoted",
        }),
      });
    } catch (error) {
      if (lease) this.#surface.abortFrame(lease);
      return unavailableResult(
        signal?.aborted ? "cancelled" : "runtime-rejected",
        error instanceof Error ? error.message : undefined,
      );
    } finally {
      this.#busy = false;
    }
  }
}
