import * as THREE from "three";

import type { StudioEditableMesh } from "../studio-editable-half-edge-mesh";

const meshVertexByIdCache = new WeakMap<
  StudioEditableMesh,
  ReadonlyMap<number, StudioEditableMesh["vertices"][number]>
>();

function studioHybridDccVertexById(
  mesh: StudioEditableMesh,
): ReadonlyMap<number, StudioEditableMesh["vertices"][number]> {
  const cached = meshVertexByIdCache.get(mesh);
  if (cached) return cached;
  const indexed = new Map(mesh.vertices.map((vertex) => [vertex.id, vertex]));
  meshVertexByIdCache.set(mesh, indexed);
  return indexed;
}

function squaredScreenDistanceToSegment(
  point: THREE.Vector2,
  start: THREE.Vector2,
  end: THREE.Vector2,
): number {
  const direction = end.clone().sub(start);
  const lengthSquared = direction.lengthSq();
  if (lengthSquared <= 1e-20) return point.distanceToSquared(start);
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(direction) / lengthSquared, 0, 1);
  return point.distanceToSquared(start.addScaledVector(direction, t));
}

export interface StudioHybridDccScreenSelectionCandidates {
  readonly vertexIds: readonly number[];
  readonly edges: readonly {
    readonly id: number;
    readonly vertexIds: readonly [number, number];
  }[];
}

/**
 * Refines a ray-hit face into the visibly nearest point/edge using CSS pixels.
 * A face-center click outside the explicit radius returns null instead of mutating an arbitrary ID.
 */
export function resolveStudioHybridDccScreenComponentCandidate(
  mesh: StudioEditableMesh,
  mode: "vertex" | "edge",
  candidates: StudioHybridDccScreenSelectionCandidates,
  pointerNdc: THREE.Vector2,
  camera: THREE.Camera,
  matrixWorld: THREE.Matrix4,
  viewportSize: { readonly width: number; readonly height: number },
  thresholdPx = 10,
): number | null {
  const width = Number.isFinite(viewportSize.width) ? Math.max(1, viewportSize.width) : 1;
  const height = Number.isFinite(viewportSize.height) ? Math.max(1, viewportSize.height) : 1;
  const threshold = Number.isFinite(thresholdPx)
    ? THREE.MathUtils.clamp(thresholdPx, 1, 64)
    : 10;
  const pointer = new THREE.Vector2(
    (pointerNdc.x + 1) * width / 2,
    (1 - pointerNdc.y) * height / 2,
  );
  const verticesById = studioHybridDccVertexById(mesh);
  const projectVertex = (vertexId: number): THREE.Vector2 | null => {
    const vertex = verticesById.get(vertexId);
    if (!vertex) return null;
    const ndc = new THREE.Vector3(
      vertex.position.x,
      vertex.position.y,
      vertex.position.z,
    ).applyMatrix4(matrixWorld).project(camera);
    if (!Number.isFinite(ndc.x) || !Number.isFinite(ndc.y) || !Number.isFinite(ndc.z)) return null;
    return new THREE.Vector2(
      (ndc.x + 1) * width / 2,
      (1 - ndc.y) * height / 2,
    );
  };

  const ranked = mode === "vertex"
    ? candidates.vertexIds.map((id) => {
        const screenPoint = projectVertex(id);
        return {
          id,
          distance: screenPoint ? pointer.distanceToSquared(screenPoint) : Number.POSITIVE_INFINITY,
        };
      })
    : candidates.edges.map((edge) => {
        const start = projectVertex(edge.vertexIds[0]);
        const end = projectVertex(edge.vertexIds[1]);
        return {
          id: edge.id,
          distance: start && end
            ? squaredScreenDistanceToSegment(pointer, start, end)
            : Number.POSITIVE_INFINITY,
        };
      });
  const nearest = ranked.toSorted(
    (left, right) => left.distance - right.distance || left.id - right.id,
  )[0];
  return nearest && nearest.distance <= threshold * threshold ? nearest.id : null;
}
