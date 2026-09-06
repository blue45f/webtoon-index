/**
 * Format-neutral high-quality weighted deformation CPU oracle.
 *
 * Point, curve and envelope controls are all represented as corresponding
 * rest/deformed polylines. Every vertex finds the nearest rest segment for
 * each source, interpolates the matching deformed segment, and blends source
 * displacements with normalized compact-support weights. UVs are copied
 * unchanged, so textured raster/vector/3D consumers share one deformation
 * field without handing renderer state across the provider boundary.
 */

import {
  hashStudioWeightedDeformationFloat32,
  hashStudioWeightedDeformationRequest,
} from "./studio-weighted-deformation-integrity";

export const STUDIO_WEIGHTED_DEFORMATION_PROVIDER_VERSION = 1 as const;

export const STUDIO_WEIGHTED_DEFORMATION_BUDGETS = Object.freeze({
  maxVertices: 2_000_000,
  maxSources: 128,
  maxPointsPerSource: 8_192,
  maxTotalSourcePoints: 65_536,
  maxWorkUnits: 100_000_000,
  maxIdentifierCharacters: 128,
} as const);

export interface StudioWeightedDeformationMesh {
  readonly dimension: 2 | 3;
  /** Interleaved x/y[/z] document-space positions. */
  readonly positions: Float32Array;
  /** Optional interleaved u/v values. These are copied, never deformed. */
  readonly textureCoordinates?: Float32Array;
}

export interface StudioWeightedDeformationSource {
  readonly id: string;
  readonly dimension: 2 | 3;
  /** One point represents a peg; two or more points represent a curve/envelope. */
  readonly restPoints: Float32Array;
  readonly deformedPoints: Float32Array;
  readonly closed: boolean;
  readonly radius: number;
  /** Compact-support falloff exponent. 1 is soft, larger values localize the source. */
  readonly falloff: number;
  /**
   * Absolute influence strength. Values below 1 blend toward the unchanged
   * mesh; overlapping weights above 1 are normalized to avoid overshoot.
   */
  readonly strength: number;
}

export interface StudioWeightedDeformationRequest {
  readonly requestEpoch: number;
  readonly currentEpoch: number;
  readonly mesh: StudioWeightedDeformationMesh;
  readonly sources: readonly StudioWeightedDeformationSource[];
  readonly maximumWorkUnits?: number;
  readonly signal?: AbortSignal;
}

export interface StudioWeightedDeformationReceipt {
  readonly kind: "studio-weighted-deformation-receipt";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_PROVIDER_VERSION;
  readonly backend: "cpu-f32-oracle";
  readonly algorithm: "normalized-compact-distance-polyline-v1";
  readonly vertexCount: number;
  readonly sourceCount: number;
  readonly sourcePointCount: number;
  readonly workUnits: number;
  readonly influencedVertices: number;
  readonly untouchedVertices: number;
  readonly maximumDisplacement: number;
  readonly textureCoordinatePolicy: "copied-unchanged";
  readonly requestSha256: `sha256:${string}`;
  readonly positionsSha256: `sha256:${string}`;
  readonly textureCoordinatesSha256: `sha256:${string}` | null;
  readonly complete: true;
}

export interface StudioWeightedDeformationArtifact {
  readonly kind: "studio-weighted-deformation-artifact";
  readonly version: typeof STUDIO_WEIGHTED_DEFORMATION_PROVIDER_VERSION;
  readonly dimension: 2 | 3;
  readonly positions: Float32Array;
  readonly textureCoordinates?: Float32Array;
  readonly receipt: StudioWeightedDeformationReceipt;
}

export type StudioWeightedDeformationFailureReason =
  | "invalid-request"
  | "budget-exceeded"
  | "stale-epoch";

export type StudioWeightedDeformationResult =
  | Readonly<{
      status: "completed";
      artifact: StudioWeightedDeformationArtifact;
    }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{
      status: "rejected";
      reason: StudioWeightedDeformationFailureReason;
    }>;

interface PreparedSource {
  readonly source: StudioWeightedDeformationSource;
  readonly pointCount: number;
  readonly segmentCount: number;
}

interface ClosestDisplacement {
  readonly distanceSquared: number;
  readonly displacement: readonly [number, number, number];
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteFloat32Array(value: unknown): value is Float32Array {
  return (
    value instanceof Float32Array
    && value.every((component) => Number.isFinite(component))
  );
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string"
    && value.length > 0
    && value.length
      <= STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxIdentifierCharacters
  );
}

function smoothCompactWeight(
  distanceSquared: number,
  radius: number,
  falloff: number,
  strength: number,
): number {
  if (distanceSquared >= radius * radius) return 0;
  const normalized = Math.sqrt(distanceSquared) / radius;
  const inverse = 1 - normalized;
  const smooth = inverse * inverse * (3 - 2 * inverse);
  return Math.pow(smooth, falloff) * strength;
}

function pointComponent(
  points: Float32Array,
  pointIndex: number,
  component: number,
  dimension: 2 | 3,
): number {
  if (component >= dimension) return 0;
  return points[pointIndex * dimension + component] ?? 0;
}

function closestSourceDisplacement(
  prepared: PreparedSource,
  vertex: readonly [number, number, number],
): ClosestDisplacement {
  const { source, pointCount, segmentCount } = prepared;
  const dimension = source.dimension;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  let bestDisplacement: readonly [number, number, number] = [0, 0, 0];

  if (pointCount === 1) {
    let distanceSquared = 0;
    const displacement: [number, number, number] = [0, 0, 0];
    for (let component = 0; component < dimension; component += 1) {
      const rest = pointComponent(
        source.restPoints,
        0,
        component,
        dimension,
      );
      const deformed = pointComponent(
        source.deformedPoints,
        0,
        component,
        dimension,
      );
      const difference = vertex[component] - rest;
      distanceSquared += difference * difference;
      displacement[component] = deformed - rest;
    }
    return { distanceSquared, displacement };
  }

  for (let segment = 0; segment < segmentCount; segment += 1) {
    const next = segment + 1 < pointCount ? segment + 1 : 0;
    let lengthSquared = 0;
    let projection = 0;
    for (let component = 0; component < dimension; component += 1) {
      const start = pointComponent(
        source.restPoints,
        segment,
        component,
        dimension,
      );
      const end = pointComponent(
        source.restPoints,
        next,
        component,
        dimension,
      );
      const edge = end - start;
      lengthSquared += edge * edge;
      projection += (vertex[component] - start) * edge;
    }
    const ratio = lengthSquared > 0
      ? Math.min(1, Math.max(0, projection / lengthSquared))
      : 0;
    let distanceSquared = 0;
    const displacement: [number, number, number] = [0, 0, 0];
    for (let component = 0; component < dimension; component += 1) {
      const restStart = pointComponent(
        source.restPoints,
        segment,
        component,
        dimension,
      );
      const restEnd = pointComponent(
        source.restPoints,
        next,
        component,
        dimension,
      );
      const deformedStart = pointComponent(
        source.deformedPoints,
        segment,
        component,
        dimension,
      );
      const deformedEnd = pointComponent(
        source.deformedPoints,
        next,
        component,
        dimension,
      );
      const restClosest = restStart + (restEnd - restStart) * ratio;
      const deformedClosest =
        deformedStart + (deformedEnd - deformedStart) * ratio;
      const difference = vertex[component] - restClosest;
      distanceSquared += difference * difference;
      displacement[component] = deformedClosest - restClosest;
    }
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      bestDisplacement = displacement;
    }
  }
  return {
    distanceSquared: bestDistanceSquared,
    displacement: bestDisplacement,
  };
}

function prepareRequest(
  request: StudioWeightedDeformationRequest,
): Readonly<{
  mesh: StudioWeightedDeformationMesh;
  sources: readonly PreparedSource[];
  vertexCount: number;
  totalSourcePoints: number;
  workUnits: number;
}> | StudioWeightedDeformationFailureReason {
  if (
    !request
    || !positiveSafeInteger(request.requestEpoch)
    || !positiveSafeInteger(request.currentEpoch)
    || !request.mesh
    || (request.mesh.dimension !== 2 && request.mesh.dimension !== 3)
    || !finiteFloat32Array(request.mesh.positions)
    || request.mesh.positions.length === 0
    || request.mesh.positions.length % request.mesh.dimension !== 0
    || (
      request.mesh.textureCoordinates !== undefined
      && (
        !finiteFloat32Array(request.mesh.textureCoordinates)
        || request.mesh.textureCoordinates.length
          !== (request.mesh.positions.length / request.mesh.dimension) * 2
      )
    )
    || !Array.isArray(request.sources)
    || request.sources.length === 0
    || request.sources.length > STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxSources
    || (
      request.maximumWorkUnits !== undefined
      && !positiveSafeInteger(request.maximumWorkUnits)
    )
  ) {
    return "invalid-request";
  }
  if (request.requestEpoch !== request.currentEpoch) return "stale-epoch";

  const vertexCount = request.mesh.positions.length / request.mesh.dimension;
  if (vertexCount > STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxVertices) {
    return "budget-exceeded";
  }
  const ids = new Set<string>();
  const sources: PreparedSource[] = [];
  let totalSourcePoints = 0;
  let totalSegments = 0;
  for (const source of request.sources) {
    if (
      !source
      || !validIdentifier(source.id)
      || ids.has(source.id)
      || source.dimension !== request.mesh.dimension
      || !finiteFloat32Array(source.restPoints)
      || !finiteFloat32Array(source.deformedPoints)
      || source.restPoints.length !== source.deformedPoints.length
      || source.restPoints.length === 0
      || source.restPoints.length % source.dimension !== 0
      || typeof source.closed !== "boolean"
      || !finite(source.radius)
      || source.radius <= 0
      || !finite(source.falloff)
      || source.falloff < 0.125
      || source.falloff > 32
      || !finite(source.strength)
      || source.strength < 0
      || source.strength > 8
    ) {
      return "invalid-request";
    }
    ids.add(source.id);
    const pointCount = source.restPoints.length / source.dimension;
    if (
      pointCount > STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxPointsPerSource
      || (source.closed && pointCount < 3)
    ) {
      return "budget-exceeded";
    }
    const segmentCount = pointCount === 1
      ? 1
      : pointCount - 1 + (source.closed ? 1 : 0);
    totalSourcePoints += pointCount;
    totalSegments += segmentCount;
    sources.push({ source, pointCount, segmentCount });
  }
  if (
    totalSourcePoints
      > STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxTotalSourcePoints
  ) {
    return "budget-exceeded";
  }
  const workUnits = vertexCount * totalSegments;
  const maximumWorkUnits = Math.min(
    request.maximumWorkUnits
      ?? STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxWorkUnits,
    STUDIO_WEIGHTED_DEFORMATION_BUDGETS.maxWorkUnits,
  );
  if (
    !Number.isSafeInteger(workUnits)
    || workUnits > maximumWorkUnits
  ) {
    return "budget-exceeded";
  }
  return {
    mesh: request.mesh,
    sources: Object.freeze(sources),
    vertexCount,
    totalSourcePoints,
    workUnits,
  };
}

export function applyStudioWeightedDeformation(
  request: StudioWeightedDeformationRequest,
): StudioWeightedDeformationResult {
  if (request?.signal?.aborted) return Object.freeze({ status: "cancelled" });
  const prepared = prepareRequest(request);
  if (typeof prepared === "string") {
    return Object.freeze({ status: "rejected", reason: prepared });
  }
  const { mesh, sources, vertexCount, totalSourcePoints, workUnits } = prepared;
  const positions = new Float32Array(mesh.positions);
  const textureCoordinates = mesh.textureCoordinates === undefined
    ? undefined
    : new Float32Array(mesh.textureCoordinates);
  let influencedVertices = 0;
  let maximumDisplacement = 0;

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    if ((vertexIndex & 0x3ff) === 0 && request.signal?.aborted) {
      return Object.freeze({ status: "cancelled" });
    }
    const offset = vertexIndex * mesh.dimension;
    const vertex: readonly [number, number, number] = [
      mesh.positions[offset] ?? 0,
      mesh.positions[offset + 1] ?? 0,
      mesh.dimension === 3 ? mesh.positions[offset + 2] ?? 0 : 0,
    ];
    let totalWeight = 0;
    const weightedDisplacement: [number, number, number] = [0, 0, 0];
    for (const source of sources) {
      const closest = closestSourceDisplacement(source, vertex);
      const weight = smoothCompactWeight(
        closest.distanceSquared,
        source.source.radius,
        source.source.falloff,
        source.source.strength,
      );
      if (weight <= 0) continue;
      totalWeight += weight;
      for (let component = 0; component < mesh.dimension; component += 1) {
        weightedDisplacement[component] +=
          closest.displacement[component] * weight;
      }
    }
    if (totalWeight <= 0) continue;
    influencedVertices += 1;
    let displacementSquared = 0;
    for (let component = 0; component < mesh.dimension; component += 1) {
      // The unchanged mesh contributes the residual weight until active source
      // weights reach one. This preserves a true compact falloff for a single
      // source; dividing by totalWeight unconditionally would make even an
      // infinitesimal edge weight apply the full displacement.
      const displacement =
        weightedDisplacement[component] / Math.max(1, totalWeight);
      positions[offset + component] = vertex[component] + displacement;
      displacementSquared += displacement * displacement;
    }
    maximumDisplacement = Math.max(
      maximumDisplacement,
      Math.sqrt(displacementSquared),
    );
  }

  const receipt: StudioWeightedDeformationReceipt = Object.freeze({
    kind: "studio-weighted-deformation-receipt",
    version: STUDIO_WEIGHTED_DEFORMATION_PROVIDER_VERSION,
    backend: "cpu-f32-oracle",
    algorithm: "normalized-compact-distance-polyline-v1",
    vertexCount,
    sourceCount: sources.length,
    sourcePointCount: totalSourcePoints,
    workUnits,
    influencedVertices,
    untouchedVertices: vertexCount - influencedVertices,
    maximumDisplacement,
    textureCoordinatePolicy: "copied-unchanged",
    requestSha256: hashStudioWeightedDeformationRequest(request),
    positionsSha256: hashStudioWeightedDeformationFloat32(positions),
    textureCoordinatesSha256: textureCoordinates
      ? hashStudioWeightedDeformationFloat32(textureCoordinates)
      : null,
    complete: true,
  });
  return Object.freeze({
    status: "completed",
    artifact: Object.freeze({
      kind: "studio-weighted-deformation-artifact",
      version: STUDIO_WEIGHTED_DEFORMATION_PROVIDER_VERSION,
      dimension: mesh.dimension,
      positions,
      ...(textureCoordinates === undefined ? {} : { textureCoordinates }),
      receipt,
    }),
  });
}
