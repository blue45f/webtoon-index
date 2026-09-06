/**
 * Deterministic, renderer-free inspection layout for Hybrid DCC authority meshes and their
 * disposable presentation projections.
 *
 * Version 2 documents persist canonical object TRS. This helper applies that authority consistently
 * for every consumer (R3F viewport, BG3D handoff, thumbnails), while retaining an explicit legacy
 * inspection layout for callers that do not yet provide transforms. It never mutates geometry.
 */

import { STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE } from "../studio-geometry-authority";

import {
  hashStudioHybridDccObjectTransform,
  normalizeStudioHybridDccObjectTransform,
  transformStudioHybridDccPoint,
  type StudioHybridDccObjectTransform,
} from "./studio-hybrid-dcc-object-transform";

import type { StudioEditableMesh } from "../studio-editable-half-edge-mesh";

export const STUDIO_HYBRID_DCC_ASSET_LAYOUT_REVISION = 1 as const;
export const STUDIO_HYBRID_DCC_ASSET_LAYOUT_KIND = "derived-inspection-grid" as const;

export const STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS = Object.freeze({
  maxAssets: 256,
  maxVerticesPerAsset: 250_000,
  maxFacesPerAsset: 250_000,
  maxAbsoluteCoordinate: STUDIO_GEOMETRY_MAX_ABSOLUTE_COORDINATE,
});

export interface StudioHybridDccAssetLayoutInput {
  readonly assetId: string;
  readonly meshHash: string;
  readonly mesh: StudioEditableMesh;
  readonly transform?: StudioHybridDccObjectTransform;
  /**
   * Optional non-authoritative geometry used only for presentation bounds and signatures.
   * Callers must validate the cache before supplying it; the editable mesh remains the authority.
   */
  readonly presentation?: {
    readonly positions: Float32Array;
    readonly derivedFromHash: string;
  };
}

export interface StudioHybridDccAssetLayoutItem {
  readonly assetId: string;
  readonly meshHash: string;
  readonly presentationHash: string;
  readonly presentationSource: "authority" | "derived-cache";
  readonly mesh: StudioEditableMesh;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly position: readonly [number, number, number];
  readonly rotationEulerRad: readonly [number, number, number];
  readonly scale: readonly [number, number, number];
  readonly worldMin: readonly [number, number, number];
  readonly worldMax: readonly [number, number, number];
  readonly span: number;
}

export interface StudioHybridDccAssetLayoutError {
  readonly assetId: string;
  readonly message: string;
}

export interface StudioHybridDccAssetLayout {
  readonly revision: typeof STUDIO_HYBRID_DCC_ASSET_LAYOUT_REVISION;
  readonly kind: typeof STUDIO_HYBRID_DCC_ASSET_LAYOUT_KIND;
  readonly sourceTransforms: "canonical" | "absent";
  readonly items: readonly StudioHybridDccAssetLayoutItem[];
  readonly errors: readonly StudioHybridDccAssetLayoutError[];
  readonly center: readonly [number, number, number];
  readonly radius: number;
  readonly gridSize: number;
  readonly signature: string;
}

function transformedBounds(
  min: readonly [number, number, number],
  max: readonly [number, number, number],
  transform: StudioHybridDccObjectTransform,
): {
  readonly worldMin: readonly [number, number, number];
  readonly worldMax: readonly [number, number, number];
} {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const point = transformStudioHybridDccPoint([x, y, z], transform);
        minX = Math.min(minX, point[0]);
        minY = Math.min(minY, point[1]);
        minZ = Math.min(minZ, point[2]);
        maxX = Math.max(maxX, point[0]);
        maxY = Math.max(maxY, point[1]);
        maxZ = Math.max(maxZ, point[2]);
      }
    }
  }
  return { worldMin: [minX, minY, minZ], worldMax: [maxX, maxY, maxZ] };
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function authorityBounds(mesh: StudioEditableMesh): {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly span: number;
} {
  if (mesh.vertices.length > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxVerticesPerAsset) {
    throw new Error(
      `정점 예산을 초과했습니다 (${mesh.vertices.length.toLocaleString("en-US")}).`,
    );
  }
  if (mesh.faces.length > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxFacesPerAsset) {
    throw new Error(`면 예산을 초과했습니다 (${mesh.faces.length.toLocaleString("en-US")}).`);
  }
  if (mesh.vertices.length === 0) throw new Error("렌더링할 정점이 없습니다.");

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const vertex of mesh.vertices) {
    const { x, y, z } = vertex.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error("메시에 유한하지 않은 좌표가 있습니다.");
    }
    if ([x, y, z].some((coordinate) => (
      Math.abs(coordinate) > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAbsoluteCoordinate
    ))) {
      throw new Error("메시 좌표가 안전 범위 ±1,000,000을 벗어났습니다.");
    }
    if ([x, y, z].some((coordinate) => {
      const projected = Math.fround(coordinate);
      return !Number.isFinite(projected)
        || Math.abs(projected) > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAbsoluteCoordinate;
    })) {
      throw new Error("메시 좌표를 안전한 Float32 범위로 변환할 수 없습니다.");
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.25),
  };
}

function presentationBounds(input: StudioHybridDccAssetLayoutInput): {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly span: number;
  readonly presentationHash: string;
  readonly presentationSource: "authority" | "derived-cache";
} {
  const sourceBounds = authorityBounds(input.mesh);
  if (!input.presentation) {
    return {
      ...sourceBounds,
      presentationHash: input.meshHash,
      presentationSource: "authority",
    };
  }
  const { derivedFromHash, positions } = input.presentation;
  if (!derivedFromHash) throw new Error("화면용 메시의 파생 해시가 없습니다.");
  if (!(positions instanceof Float32Array)
    || positions.length === 0
    || positions.length % 3 !== 0) {
    throw new Error("화면용 메시의 정점 배열 형식이 잘못되었습니다.");
  }
  const vertexCount = positions.length / 3;
  if (vertexCount > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxVerticesPerAsset) {
    throw new Error(`화면용 정점 예산을 초과했습니다 (${vertexCount.toLocaleString("en-US")}).`);
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < positions.length; index += 3) {
    const x = positions[index]!;
    const y = positions[index + 1]!;
    const z = positions[index + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      throw new Error("화면용 메시에 유한하지 않은 좌표가 있습니다.");
    }
    if ([x, y, z].some((coordinate) => (
      Math.abs(coordinate) > STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAbsoluteCoordinate
    ))) {
      throw new Error("화면용 메시 좌표가 안전 범위 ±1,000,000을 벗어났습니다.");
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.25),
    presentationHash: derivedFromHash,
    presentationSource: "derived-cache",
  };
}

export function deriveStudioHybridDccAssetLayout(
  inputs: readonly StudioHybridDccAssetLayoutInput[],
): StudioHybridDccAssetLayout {
  const sorted = inputs.toSorted((a, b) => compareCodeUnits(a.assetId, b.assetId));
  const errors: StudioHybridDccAssetLayoutError[] = [];
  const bounded = sorted.slice(0, STUDIO_HYBRID_DCC_ASSET_LAYOUT_LIMITS.maxAssets);
  if (sorted.length > bounded.length) {
    for (const input of sorted.slice(bounded.length)) {
      errors.push({ assetId: input.assetId, message: "동시 표시 에셋 예산을 초과했습니다." });
    }
  }

  const useCanonicalTransforms = bounded.length > 0
    && bounded.every((input) => input.transform !== undefined);
  const valid: Array<StudioHybridDccAssetLayoutInput
    & ReturnType<typeof presentationBounds>
    & { readonly canonicalTransform: StudioHybridDccObjectTransform | undefined }> = [];
  for (const input of bounded) {
    try {
      valid.push({
        ...input,
        ...presentationBounds(input),
        canonicalTransform: useCanonicalTransforms
          ? normalizeStudioHybridDccObjectTransform(input.transform)
          : undefined,
      });
    } catch (error) {
      errors.push({
        assetId: input.assetId,
        message: error instanceof Error ? error.message : "메시 경계를 계산하지 못했습니다.",
      });
    }
  }

  const base = {
    revision: STUDIO_HYBRID_DCC_ASSET_LAYOUT_REVISION,
    kind: STUDIO_HYBRID_DCC_ASSET_LAYOUT_KIND,
    sourceTransforms: useCanonicalTransforms ? "canonical" as const : "absent" as const,
  };
  if (valid.length === 0) {
    return {
      ...base,
      items: [],
      errors,
      center: [0, 0.5, 0],
      radius: 2,
      gridSize: 12,
      signature: sorted.map((item) => (
        `${item.assetId}:${item.presentation?.derivedFromHash ?? item.meshHash}`
      )).join("|"),
    };
  }

  if (useCanonicalTransforms) {
    const items = valid.map((item): StudioHybridDccAssetLayoutItem => {
      const transform = item.canonicalTransform!;
      const world = transformedBounds(item.min, item.max, transform);
      return {
        assetId: item.assetId,
        meshHash: item.meshHash,
        presentationHash: item.presentationHash,
        presentationSource: item.presentationSource,
        mesh: item.mesh,
        min: item.min,
        max: item.max,
        position: transform.position,
        rotationEulerRad: transform.rotationEulerRad,
        scale: transform.scale,
        worldMin: world.worldMin,
        worldMax: world.worldMax,
        span: Math.max(
          world.worldMax[0] - world.worldMin[0],
          world.worldMax[1] - world.worldMin[1],
          world.worldMax[2] - world.worldMin[2],
          0.25,
        ),
      };
    });
    const worldMin: [number, number, number] = [Infinity, Infinity, Infinity];
    const worldMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const item of items) {
      for (let axis = 0; axis < 3; axis += 1) {
        worldMin[axis] = Math.min(worldMin[axis], item.worldMin[axis]);
        worldMax[axis] = Math.max(worldMax[axis], item.worldMax[axis]);
      }
    }
    const center: readonly [number, number, number] = [
      (worldMin[0] + worldMax[0]) / 2,
      (worldMin[1] + worldMax[1]) / 2,
      (worldMin[2] + worldMax[2]) / 2,
    ];
    const radius = Math.max(1, Math.hypot(
      worldMax[0] - worldMin[0],
      worldMax[1] - worldMin[1],
      worldMax[2] - worldMin[2],
    ) / 2);
    return {
      ...base,
      items,
      errors,
      center,
      radius,
      gridSize: Math.max(12, Math.ceil(Math.max(
        worldMax[0] - worldMin[0],
        worldMax[2] - worldMin[2],
      ) * 1.7)),
      signature: items.map((item) => (
        `${item.assetId}:${item.presentationHash}:`
          + hashStudioHybridDccObjectTransform(valid.find(
            (candidate) => candidate.assetId === item.assetId,
          )!.canonicalTransform!)
      )).join("|"),
    };
  }

  const columns = Math.ceil(Math.sqrt(valid.length));
  const rows = Math.ceil(valid.length / columns);
  const largestSpan = valid.reduce((max, item) => Math.max(max, item.span), 0.25);
  const spacing = largestSpan * 1.35 + 0.5;
  const items = valid.map((item, index): StudioHybridDccAssetLayoutItem => ({
    assetId: item.assetId,
    meshHash: item.meshHash,
    presentationHash: item.presentationHash,
    presentationSource: item.presentationSource,
    mesh: item.mesh,
    min: item.min,
    max: item.max,
    span: item.span,
    position: [
      (index % columns - (columns - 1) / 2) * spacing - (item.min[0] + item.max[0]) / 2,
      -item.min[1],
      (Math.floor(index / columns) - (rows - 1) / 2) * spacing
        - (item.min[2] + item.max[2]) / 2,
    ],
    rotationEulerRad: [0, 0, 0],
    scale: [1, 1, 1],
    worldMin: [
      item.min[0] + (index % columns - (columns - 1) / 2) * spacing
        - (item.min[0] + item.max[0]) / 2,
      0,
      item.min[2] + (Math.floor(index / columns) - (rows - 1) / 2) * spacing
        - (item.min[2] + item.max[2]) / 2,
    ],
    worldMax: [
      item.max[0] + (index % columns - (columns - 1) / 2) * spacing
        - (item.min[0] + item.max[0]) / 2,
      item.max[1] - item.min[1],
      item.max[2] + (Math.floor(index / columns) - (rows - 1) / 2) * spacing
        - (item.min[2] + item.max[2]) / 2,
    ],
  }));
  const width = Math.max(largestSpan, (columns - 1) * spacing + largestSpan);
  const depth = Math.max(largestSpan, (rows - 1) * spacing + largestSpan);
  const height = valid.reduce(
    (max, item) => Math.max(max, item.max[1] - item.min[1]),
    largestSpan,
  );

  return {
    ...base,
    items,
    errors,
    center: [0, height / 2, 0],
    radius: Math.max(1, Math.hypot(width, height, depth) / 2),
    gridSize: Math.max(12, Math.ceil(Math.max(width, depth) * 1.7)),
    signature: items.map((item) => `${item.assetId}:${item.presentationHash}`).join("|"),
  };
}
