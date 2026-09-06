/**
 * Geometry Nodes → Hybrid DCC workspace bridge (MOD procedural path).
 * Builds procedural meshes via geometry-nodes primitives + starter graph evaluator
 * and converts to editable half-edge for document authority.
 */

import {
  createStudioEditableMeshFromPolygons,
  type StudioEditableMesh,
  type StudioMeshVec3,
} from "./studio-editable-half-edge-mesh";
import { createStudioGeometryNodesEvaluator } from "./studio-geometry-nodes-eval";
import {
  studioGeometryCube,
  studioGeometryCylinder,
  studioGeometryGrid,
  studioGeometrySphere,
} from "./studio-geometry-nodes-primitives";
import { createStudioGeometryNodesStarterGraph } from "./studio-geometry-nodes-serialization";

import type { StudioGeometryMesh } from "./studio-geometry-nodes-mesh";

export const STUDIO_GEOMETRY_NODES_WORKSPACE_BRIDGE_REVISION = 2 as const;

export type StudioGeoNodesPrimitiveKind = "cube" | "sphere" | "cylinder" | "grid";

export type StudioGeoNodesBridgeResult =
  | {
      readonly ok: true;
      readonly kind: StudioGeoNodesPrimitiveKind;
      readonly mesh: StudioEditableMesh;
      readonly vertexCount: number;
      readonly triangleCount: number;
    }
  | { readonly ok: false; readonly detail: string };

function meshFromGeometryMesh(g: StudioGeometryMesh): StudioEditableMesh {
  const verts: StudioMeshVec3[] = [];
  for (let i = 0; i + 2 < g.positions.length; i += 3) {
    verts.push({
      x: g.positions[i]!,
      y: g.positions[i + 1]!,
      z: g.positions[i + 2]!,
    });
  }
  const faces: number[][] = [];
  for (let i = 0; i + 2 < g.indices.length; i += 3) {
    faces.push([g.indices[i]!, g.indices[i + 1]!, g.indices[i + 2]!]);
  }
  return createStudioEditableMeshFromPolygons(verts, faces);
}

export function buildStudioGeoNodesPrimitive(
  kind: StudioGeoNodesPrimitiveKind,
  segments = 8,
): StudioGeoNodesBridgeResult {
  const seg = Math.max(1, Math.min(16, Math.trunc(segments)));
  const result =
    kind === "cube"
      ? studioGeometryCube({ size: 1, segments: seg })
      : kind === "sphere"
        ? studioGeometrySphere({
            radius: 0.5,
            segments: Math.max(4, seg * 2),
            rings: Math.max(3, seg),
          })
        : kind === "cylinder"
          ? studioGeometryCylinder({
              radius: 0.35,
              height: 1,
              segments: Math.max(4, seg * 2),
              caps: true,
            })
          : studioGeometryGrid({
              sizeX: 1,
              sizeY: 1,
              segmentsX: seg,
              segmentsY: seg,
            });

  if (!result.ok) {
    return { ok: false, detail: result.detail };
  }
  try {
    const mesh = meshFromGeometryMesh(result.value);
    return {
      ok: true,
      kind,
      mesh,
      vertexCount: result.value.positions.length / 3,
      triangleCount: result.value.indices.length / 3,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "geo nodes convert failed",
    };
  }
}

/**
 * Evaluate the shipped starter graph (grid → extrude → output) into an editable mesh.
 * Drives the real geometry-nodes evaluator — not a reimplementation.
 */
export function evaluateStudioGeoNodesStarterGraph(): StudioGeoNodesBridgeResult {
  try {
    const evaluator = createStudioGeometryNodesEvaluator();
    const result = evaluator.evaluate(createStudioGeometryNodesStarterGraph());
    if (!result.ok) {
      return { ok: false, detail: result.detail };
    }
    const geometry = result.outputs.geometry;
    if (!geometry || geometry.kind !== "geometry") {
      return { ok: false, detail: "starter graph produced no geometry output" };
    }
    const mesh = meshFromGeometryMesh(geometry.mesh);
    return {
      ok: true,
      kind: "cube",
      mesh,
      vertexCount: geometry.mesh.positions.length / 3,
      triangleCount: geometry.mesh.indices.length / 3,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "starter graph eval failed",
    };
  }
}
