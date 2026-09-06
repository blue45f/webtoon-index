/**
 * Three.js/VRM product bridge for the engine-neutral V12 surface brush.
 *
 * Geometry stays owned by the existing Raycaster/BVH path. This module accepts
 * those real ray hits, asks `StudioVrmTexturePaintRuntime` to classify their
 * triangle/UV island against its one owned atlas, then exposes the result as a
 * `SurfaceProjectionProvider`. Package lowering remains synchronous and
 * deterministic; the runtime commits the exact lowered operations atomically
 * to Canvas/ImageData and performs its existing upload without GPU readback.
 */

import {
  CompositionExecutionError,
  executeSurfaceBrushStroke,
  type ExecuteSurfaceBrushOptions,
  type SurfaceBrushExecutionResult,
  type SurfaceProjectionContext,
  type SurfaceProjectionHit,
  type SurfaceProjectionProvider,
  type SurfaceTextureCommitReceipt,
  type SurfaceTextureDabOperation,
  type SurfaceTextureTransaction,
} from "../../../../../../packages/studio-brush-platform/src/brush-composition";

import type { StudioVrmTexturePaintOp } from "./studio-vrm-texture-paint-ops";
import type {
  StudioVrmTexturePaintRayHit,
  StudioVrmTexturePaintRuntime,
  StudioVrmTexturePaintRuntimeError,
  StudioVrmTexturePaintSurfaceProjection,
  StudioVrmTexturePaintSurfaceSession,
} from "./studio-vrm-texture-paint-runtime";
import type { BrushProgramIR, ModeledSampleIR, StrokeIR } from "@toonspectrum/studio-project-model";
import type { Intersection } from "three";

export type StudioVrmSurfaceBrushBridgeErrorCode =
  | "automatic-fallback-forbidden"
  | "hit-count-mismatch"
  | "no-ray-hit"
  | "provider-closed"
  | "runtime-commit-failed"
  | "runtime-projection-failed"
  | "runtime-prepare-failed"
  | "texel-density-unavailable"
  | "triangle-index-missing"
  | "transaction-mismatch";

export class StudioVrmSurfaceBrushBridgeError extends Error {
  constructor(
    readonly code: StudioVrmSurfaceBrushBridgeErrorCode,
    message: string,
    readonly sampleIndex?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StudioVrmSurfaceBrushBridgeError";
  }
}

export interface PrepareStudioVrmSurfaceProjectionProviderInput {
  readonly runtime: StudioVrmTexturePaintRuntime;
  readonly brushProgram: BrushProgramIR;
  readonly stroke: StrokeIR;
  /** One real Three.js Raycaster/BVH result per retained StrokeIR sample. */
  readonly rayHits: readonly (StudioVrmTexturePaintRayHit | null)[];
  /**
   * Optional camera/raycast differential measured by the caller. Values are
   * texels per scene-space pixel and are used only where hit deltas cannot
   * derive that scale without inventing geometry (notably a single-point tap).
   */
  readonly texelDensityBySample?: readonly (number | null | undefined)[];
  /**
   * Camera ray differential measured by the R3F caller at each hit depth. The
   * adapter combines this scene-units/CSS-pixel scale with the runtime-owned
   * triangle texel density, avoiding texture inspection or GPU readback for a
   * one-sample tap.
   */
  readonly worldUnitsPerCssPixelBySample?: readonly (number | null | undefined)[];
  readonly signal?: AbortSignal;
}

export interface ExecuteStudioVrmSurfaceBrushInput
  extends PrepareStudioVrmSurfaceProjectionProviderInput {
  readonly execution?: Omit<
    ExecuteSurfaceBrushOptions,
    "commit" | "initialPixels" | "signal"
  >;
}

interface PreparedProjection {
  readonly hit: SurfaceProjectionHit;
  readonly sourcePressure: number;
}

export interface PreparedStudioVrmSurfaceProjection {
  readonly provider: StudioVrmSurfaceProjectionProvider;
  readonly warnings: readonly string[];
  cancel(): void;
}

const PROVIDER_ID = "three-vrm-texture-paint";
const DENSITY_EPSILON = 1e-9;

/** Preserve the fields produced by Three/R3F raycasting without rebuilding geometry. */
export function adaptThreeRaycastIntersection(
  intersection: Intersection,
): StudioVrmTexturePaintRayHit {
  return Object.freeze({
    object: intersection.object,
    ...(intersection.uv ? { uv: intersection.uv } : {}),
    ...(intersection.uv1 ? { uv1: intersection.uv1 } : {}),
    ...(intersection.face ? { face: intersection.face } : {}),
    ...(intersection.faceIndex === undefined
      ? {}
      : { faceIndex: intersection.faceIndex }),
    point: intersection.point,
  });
}

function bridgeFailure(
  code: StudioVrmSurfaceBrushBridgeErrorCode,
  message: string,
  sampleIndex?: number,
  cause?: unknown,
): StudioVrmSurfaceBrushBridgeError {
  return new StudioVrmSurfaceBrushBridgeError(
    code,
    message,
    sampleIndex,
    cause === undefined ? undefined : { cause },
  );
}

function runtimeFailureMessage(error: StudioVrmTexturePaintRuntimeError): string {
  return `${error.code}: ${error.message}`;
}

function assertHitArrayLength(
  label: string,
  values: readonly unknown[],
  expected: number,
): void {
  if (values.length !== expected) {
    throw bridgeFailure(
      "hit-count-mismatch",
      `${label} contains ${values.length} item(s); StrokeIR contains ${expected} sample(s)`,
    );
  }
}

function assertTriangleIndex(hit: StudioVrmTexturePaintRayHit, sampleIndex: number): void {
  if (!Number.isSafeInteger(hit.faceIndex) || (hit.faceIndex as number) < 0) {
    throw bridgeFailure(
      "triangle-index-missing",
      `sample[${sampleIndex}] has no usable Raycaster faceIndex; UV seam ownership cannot be proven`,
      sampleIndex,
    );
  }
}

function hexByte(value: number): string {
  return Math.round(value * 255).toString(16).padStart(2, "0");
}

function toRuntimeOperation(operation: SurfaceTextureDabOperation): StudioVrmTexturePaintOp {
  return Object.freeze({
    x: operation.x,
    y: operation.y,
    radius: operation.radiusTexels,
    hardness: operation.hardness,
    color:
      `#${hexByte(operation.color.r)}${hexByte(operation.color.g)}${hexByte(operation.color.b)}`,
    opacity: operation.opacity,
    blend: "normal" as const,
  });
}

function axisDistance(
  first: number,
  second: number,
  wrap: StudioVrmTexturePaintSurfaceSession["wrapU"],
): number {
  const distance = Math.abs(second - first);
  return wrap === "clamp" ? distance : Math.min(distance, Math.abs(1 - distance));
}

function measuredPairDensity(
  firstProjection: StudioVrmTexturePaintSurfaceProjection,
  secondProjection: StudioVrmTexturePaintSurfaceProjection,
  firstSample: ModeledSampleIR,
  secondSample: ModeledSampleIR,
  session: StudioVrmTexturePaintSurfaceSession,
): number | null {
  const sceneDistance = Math.hypot(
    secondSample.x - firstSample.x,
    secondSample.y - firstSample.y,
  );
  if (!(sceneDistance > DENSITY_EPSILON)) return null;

  if (
    firstProjection.world
    && secondProjection.world
    && firstProjection.texelsPerWorldUnit !== undefined
    && secondProjection.texelsPerWorldUnit !== undefined
  ) {
    const worldDistance = Math.hypot(
      secondProjection.world.x - firstProjection.world.x,
      secondProjection.world.y - firstProjection.world.y,
      secondProjection.world.z - firstProjection.world.z,
    );
    const density =
      (worldDistance
        * ((firstProjection.texelsPerWorldUnit + secondProjection.texelsPerWorldUnit) / 2))
      / sceneDistance;
    if (Number.isFinite(density) && density > DENSITY_EPSILON) return density;
  }

  // Crossing distinct UV charts is not a valid local derivative. Without
  // world evidence it is explicitly unsupported instead of treating a seam
  // jump as brush scale.
  if (firstProjection.islandId !== secondProjection.islandId) return null;
  const texelDistance = Math.hypot(
    axisDistance(firstProjection.u, secondProjection.u, session.wrapU) * session.width,
    axisDistance(firstProjection.v, secondProjection.v, session.wrapV) * session.height,
  );
  const density = texelDistance / sceneDistance;
  return Number.isFinite(density) && density > DENSITY_EPSILON ? density : null;
}

function resolveDensities(
  projections: readonly (StudioVrmTexturePaintSurfaceProjection | null)[],
  stroke: StrokeIR,
  session: StudioVrmTexturePaintSurfaceSession,
  explicit: readonly (number | null | undefined)[] | undefined,
  worldUnitsPerCssPixel: readonly (number | null | undefined)[] | undefined,
): readonly (number | null)[] {
  const pairDensities: Array<number | null> = Array.from(
    { length: Math.max(0, projections.length - 1) },
    () => null,
  );
  for (let index = 0; index < projections.length - 1; index += 1) {
    const first = projections[index];
    const second = projections[index + 1];
    if (!first || !second) continue;
    pairDensities[index] = measuredPairDensity(
      first,
      second,
      stroke.samples[index]!,
      stroke.samples[index + 1]!,
      session,
    );
  }

  return projections.map((projection, sampleIndex) => {
    if (!projection) return null;
    const supplied = explicit?.[sampleIndex];
    if (supplied !== undefined && supplied !== null) {
      if (!Number.isFinite(supplied) || supplied <= 0) {
        throw bridgeFailure(
          "texel-density-unavailable",
          `selected provider sample[${sampleIndex}] supplied an invalid texel density ${String(supplied)}`,
          sampleIndex,
        );
      }
      return supplied;
    }
    const suppliedWorldScale = worldUnitsPerCssPixel?.[sampleIndex];
    if (suppliedWorldScale !== undefined && suppliedWorldScale !== null) {
      if (!Number.isFinite(suppliedWorldScale) || suppliedWorldScale <= 0) {
        throw bridgeFailure(
          "texel-density-unavailable",
          `selected provider sample[${sampleIndex}] supplied an invalid world/CSS-pixel scale ${String(suppliedWorldScale)}`,
          sampleIndex,
        );
      }
      if (
        projection.texelsPerWorldUnit !== undefined
        && Number.isFinite(projection.texelsPerWorldUnit)
        && projection.texelsPerWorldUnit > 0
      ) {
        const density = suppliedWorldScale * projection.texelsPerWorldUnit;
        if (Number.isFinite(density) && density > DENSITY_EPSILON) return density;
      }
    }
    const adjacent = [pairDensities[sampleIndex - 1], pairDensities[sampleIndex]]
      .filter((value): value is number => value !== null && value !== undefined);
    if (adjacent.length === 0) {
      throw bridgeFailure(
        "texel-density-unavailable",
        `selected provider sample[${sampleIndex}] has no measured screen→texel derivative; `
          + "provide texelDensityBySample or a camera worldUnitsPerCssPixelBySample differential",
        sampleIndex,
      );
    }
    return adjacent.reduce((sum, value) => sum + value, 0) / adjacent.length;
  });
}

function toProviderProjections(
  projections: readonly (StudioVrmTexturePaintSurfaceProjection | null)[],
  densities: readonly (number | null)[],
): readonly (PreparedProjection | null)[] {
  return Object.freeze(projections.map((projection, sampleIndex) => {
    if (!projection) return null;
    const density = densities[sampleIndex];
    if (density === null || density === undefined) {
      throw bridgeFailure(
        "texel-density-unavailable",
        `sample[${sampleIndex}] density disappeared during provider construction`,
        sampleIndex,
      );
    }
    const previous = sampleIndex > 0 ? projections[sampleIndex - 1] : null;
    return Object.freeze({
      sourcePressure: projection.sourcePressure as number,
      hit: Object.freeze({
        u: projection.u,
        v: projection.v,
        texelDensity: density,
        ...(projection.triangleId ? { triangleId: projection.triangleId } : {}),
        islandId: projection.islandId,
        ...(projection.world ? { world: projection.world } : {}),
        ...(projection.texelsPerWorldUnit === undefined
          ? {}
          : { texelsPerWorldUnit: projection.texelsPerWorldUnit }),
        ...(previous && previous.islandId !== projection.islandId
          ? { seamBefore: true }
          : {}),
      }),
    });
  }));
}

/**
 * Concrete package provider backed by one opaque runtime texture lease.
 * Projection is a lookup over preclassified BVH hits; no geometry is inferred
 * and the interactive call performs no texture readback.
 */
export class StudioVrmSurfaceProjectionProvider implements SurfaceProjectionProvider {
  readonly id: string;
  readonly commitTextureOperations?: (
    transaction: SurfaceTextureTransaction,
  ) => SurfaceTextureCommitReceipt;
  private closed = false;
  private commitFailure: StudioVrmSurfaceBrushBridgeError | null = null;

  constructor(
    private readonly runtime: StudioVrmTexturePaintRuntime,
    private readonly session: StudioVrmTexturePaintSurfaceSession,
    private readonly projections: readonly (PreparedProjection | null)[],
    private readonly expectedStrokeId: string,
    private readonly expectedBrushProgramId: string,
    private readonly signal: AbortSignal | undefined,
  ) {
    this.id = PROVIDER_ID;
    this.commitTextureOperations = (transaction) => this.commit(transaction);
  }

  projectSample(
    sample: ModeledSampleIR,
    context: SurfaceProjectionContext,
  ): SurfaceProjectionHit | null {
    this.assertOpen();
    if (
      context.strokeId !== this.expectedStrokeId
      || context.brushProgramId !== this.expectedBrushProgramId
      || !Number.isSafeInteger(context.sampleIndex)
      || context.sampleIndex < 0
      || context.sampleIndex >= this.projections.length
    ) {
      throw bridgeFailure(
        "transaction-mismatch",
        `projection context does not belong to ${this.expectedStrokeId}/${this.expectedBrushProgramId}`,
        context.sampleIndex,
      );
    }
    const projection = this.projections[context.sampleIndex];
    if (!projection) return null;
    if (projection.sourcePressure !== sample.pressure) {
      throw bridgeFailure(
        "transaction-mismatch",
        `sample[${context.sampleIndex}] pressure changed from `
          + `${projection.sourcePressure} to ${sample.pressure}`,
        context.sampleIndex,
      );
    }
    return projection.hit;
  }

  textureSize(): Readonly<{ width: number; height: number }> {
    this.assertOpen();
    return { width: this.session.width, height: this.session.height };
  }

  cancelStroke(context: {
    readonly strokeId: string;
    readonly reason: "aborted" | "projection-failed" | "commit-failed";
  }): void {
    if (context.strokeId !== this.expectedStrokeId || this.closed) return;
    this.closed = true;
    this.runtime.cancelSurfaceBrushSession(this.session);
  }

  cancel(): void {
    if (this.closed) return;
    this.closed = true;
    this.runtime.cancelSurfaceBrushSession(this.session);
  }

  getCommitFailure(): StudioVrmSurfaceBrushBridgeError | null {
    return this.commitFailure;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw bridgeFailure("provider-closed", `${this.id} is already committed or cancelled`);
    }
  }

  private commit(transaction: SurfaceTextureTransaction): SurfaceTextureCommitReceipt {
    this.assertOpen();
    if (
      transaction.strokeId !== this.expectedStrokeId
      || transaction.brushProgramId !== this.expectedBrushProgramId
      || transaction.width !== this.session.width
      || transaction.height !== this.session.height
      || transaction.operations.some((operation, index) => operation.sequence !== index)
    ) {
      throw bridgeFailure(
        "transaction-mismatch",
        "surface transaction identity, dimensions, or deterministic sequence changed",
      );
    }
    const committed = this.runtime.commitSurfaceBrushSession(this.session, {
      operations: transaction.operations.map(toRuntimeOperation),
      ...(this.signal ? { signal: this.signal } : {}),
    });
    this.closed = true;
    if (!committed.ok) {
      this.commitFailure = bridgeFailure(
        "runtime-commit-failed",
        runtimeFailureMessage(committed.error),
      );
      throw this.commitFailure;
    }
    return committed.value;
  }
}

async function resolveHitLane(
  runtime: StudioVrmTexturePaintRuntime,
  session: StudioVrmTexturePaintSurfaceSession,
  stroke: StrokeIR,
  hits: readonly (StudioVrmTexturePaintRayHit | null)[],
): Promise<readonly (StudioVrmTexturePaintSurfaceProjection | null)[]> {
  const resolved: Array<StudioVrmTexturePaintSurfaceProjection | null> = [];
  for (const [sampleIndex, hit] of hits.entries()) {
    if (!hit) {
      resolved.push(null);
      continue;
    }
    assertTriangleIndex(hit, sampleIndex);
    const sample = stroke.samples[sampleIndex]!;
    const result = runtime.resolveSurfaceBrushHit(session, hit, sample.pressure);
    if (!result.ok) {
      throw bridgeFailure(
        "runtime-projection-failed",
        `selected provider sample[${sampleIndex}] ${runtimeFailureMessage(result.error)}`,
        sampleIndex,
      );
    }
    if (result.value.sourcePressure !== sample.pressure) {
      throw bridgeFailure(
        "runtime-projection-failed",
        `selected provider sample[${sampleIndex}] did not preserve calibrated pressure`,
        sampleIndex,
      );
    }
    resolved.push(result.value);
  }
  return Object.freeze(resolved);
}

export async function prepareStudioVrmSurfaceProjectionProvider(
  input: PrepareStudioVrmSurfaceProjectionProviderInput,
): Promise<PreparedStudioVrmSurfaceProjection> {
  const legacyInput = input as unknown as Record<string, unknown>;
  if (legacyInput.fallbackRayHits !== undefined) {
    throw bridgeFailure(
      "automatic-fallback-forbidden",
      "fallbackRayHits is forbidden; choose one raycast provider before starting the stroke",
    );
  }
  const sampleCount = input.stroke.samples.length;
  assertHitArrayLength("rayHits", input.rayHits, sampleCount);
  if (input.texelDensityBySample) {
    assertHitArrayLength("texelDensityBySample", input.texelDensityBySample, sampleCount);
  }
  if (input.worldUnitsPerCssPixelBySample) {
    assertHitArrayLength(
      "worldUnitsPerCssPixelBySample",
      input.worldUnitsPerCssPixelBySample,
      sampleCount,
    );
  }
  const anchor = input.rayHits
    .find((hit): hit is StudioVrmTexturePaintRayHit => hit !== null);
  if (!anchor) {
    throw bridgeFailure("no-ray-hit", "the selected raycast provider did not hit the model");
  }
  const sourceIndex = input.rayHits.indexOf(anchor);
  assertTriangleIndex(anchor, sourceIndex);
  const prepared = await input.runtime.prepareSurfaceBrushSession({
    hit: anchor,
    pressure: input.stroke.samples[sourceIndex]!.pressure,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!prepared.ok) {
    throw bridgeFailure(
      "runtime-prepare-failed",
      runtimeFailureMessage(prepared.error),
    );
  }

  const { session } = prepared.value;
  try {
    const primaryRaw = await resolveHitLane(
      input.runtime,
      session,
      input.stroke,
      input.rayHits,
    );
    const primaryDensity = resolveDensities(
      primaryRaw,
      input.stroke,
      session,
      input.texelDensityBySample,
      input.worldUnitsPerCssPixelBySample,
    );
    const primary = toProviderProjections(primaryRaw, primaryDensity);
    const warnings: string[] = [];
    for (const [sampleIndex, projection] of primaryRaw.entries()) {
      if (projection?.uvWasWrapped) {
        warnings.push(
          `surface.adapter.primary.sample[${sampleIndex}]: sampler wrap normalized the ray-hit UV`,
        );
      }
    }

    const provider = new StudioVrmSurfaceProjectionProvider(
      input.runtime,
      session,
      primary,
      input.stroke.id,
      input.brushProgram.id,
      input.signal,
    );
    return Object.freeze({
      provider,
      warnings: Object.freeze(warnings),
      cancel: () => provider.cancel(),
    });
  } catch (error) {
    input.runtime.cancelSurfaceBrushSession(session);
    throw error;
  }
}

/** Prepare real hits, execute package lowering, and atomically commit to the runtime owner. */
export async function executeStudioVrmSurfaceBrushStroke(
  input: ExecuteStudioVrmSurfaceBrushInput,
): Promise<SurfaceBrushExecutionResult> {
  const prepared = await prepareStudioVrmSurfaceProjectionProvider(input);
  let committed = false;
  try {
    let result: SurfaceBrushExecutionResult;
    try {
      result = executeSurfaceBrushStroke(
        input.brushProgram,
        input.stroke,
        prepared.provider,
        {
          ...input.execution,
          ...(input.signal ? { signal: input.signal } : {}),
          commit: true,
        },
      );
    } catch (error) {
      throw prepared.provider.getCommitFailure() ?? error;
    }
    if (!result.receipt.committed) {
      throw new CompositionExecutionError(
        "surface.adapter.commit",
        "runtime provider returned without committing the texture transaction",
      );
    }
    committed = true;
    return {
      ...result,
      warnings: [...prepared.warnings, ...result.warnings],
    };
  } finally {
    if (!committed) prepared.cancel();
  }
}
