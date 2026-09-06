import {
  STUDIO_BG3D_PRIMITIVE_TRIANGLE_COUNTS,
  type StudioBg3dProceduralBudgetUsage,
} from "./studio-bg3d-procedural-starter-pack";

import type { BgPrimitive } from "../studio-background-3d-metadata";
import type { StudioBg3dParsedGlbMetrics } from "./studio-bg3d-scene-document";

export interface StudioBg3dProceduralSceneModelInstance {
  readonly modelId: string;
}

function addSafe(total: number, value: number): number | null {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return null;
  }
  const next = total + value;
  return Number.isSafeInteger(next) ? next : null;
}

/**
 * Computes the complete scene usage required by the procedural-pack admission planner.
 *
 * Imported-model metrics are resolved per placed instance: two placements of one stored GLB consume
 * two render budgets. Missing or malformed metrics fail closed instead of treating the model as free.
 */
export function calculateStudioBg3dProceduralSceneUsage(
  primitives: readonly Pick<BgPrimitive, "kind">[],
  modelInstances: readonly StudioBg3dProceduralSceneModelInstance[],
  resolveModelMetrics: (
    modelId: string,
  ) => Pick<
    StudioBg3dParsedGlbMetrics,
    "nodes" | "triangles" | "drawCalls" | "materials" | "textures"
  > | null,
): StudioBg3dProceduralBudgetUsage | null {
  let nodes = 0;
  let triangles = 0;
  let drawCalls = 0;
  let materials = 0;
  let textures = 0;

  for (const primitive of primitives) {
    const nextNodes = addSafe(nodes, 1);
    const nextTriangles = addSafe(
      triangles,
      STUDIO_BG3D_PRIMITIVE_TRIANGLE_COUNTS[primitive.kind],
    );
    // The live viewport owns one shaded material and one line-overlay material per primitive.
    const nextDrawCalls = addSafe(drawCalls, 2);
    const nextMaterials = addSafe(materials, 2);
    if (
      nextNodes === null ||
      nextTriangles === null ||
      nextDrawCalls === null ||
      nextMaterials === null
    ) {
      return null;
    }
    nodes = nextNodes;
    triangles = nextTriangles;
    drawCalls = nextDrawCalls;
    materials = nextMaterials;
  }

  for (const instance of modelInstances) {
    const metrics = resolveModelMetrics(instance.modelId);
    if (!metrics) return null;
    const nextNodes = addSafe(nodes, Math.max(1, metrics.nodes));
    const nextTriangles = addSafe(triangles, metrics.triangles);
    const nextDrawCalls = addSafe(drawCalls, metrics.drawCalls);
    const nextMaterials = addSafe(materials, metrics.materials);
    const nextTextures = addSafe(textures, metrics.textures);
    if (
      nextNodes === null ||
      nextTriangles === null ||
      nextDrawCalls === null ||
      nextMaterials === null ||
      nextTextures === null
    ) {
      return null;
    }
    nodes = nextNodes;
    triangles = nextTriangles;
    drawCalls = nextDrawCalls;
    materials = nextMaterials;
    textures = nextTextures;
  }

  return Object.freeze({ nodes, triangles, drawCalls, materials, textures });
}
