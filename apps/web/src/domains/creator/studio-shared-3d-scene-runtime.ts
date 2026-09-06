import { sha256HexPortable } from "./studio-sha256";

import type {
  StudioShared3dCaptureReadiness,
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterSource,
  StudioShared3dCharacterStageTransform,
  StudioShared3dCharacterWorldTransform,
  StudioShared3dSceneSession,
} from "./studio-shared-3d-scene-bridge";
import type {
  StudioVrmSceneDocument,
  StudioVrmVec3,
} from "./vrm/studio-vrm-scene-document";

/**
 * Renderer-safe shared-stage primitives. Keep this module free of character document parsing,
 * Avatar Forge compatibility inspection and wardrobe planning: StudioBackground3D needs these
 * operations immediately, while the heavier source-authority bridge is prepared by its parent.
 */
export const STUDIO_SHARED_3D_CHARACTER_TRANSFORM_RECEIPT_KIND =
  "toonspectrum.shared-3d-character-transform-receipt" as const;
export const STUDIO_SHARED_3D_CHARACTER_TRANSFORM_RECEIPT_VERSION = 1 as const;

/** Conservative VRM rest/pose envelope used only to fit a shared background shadow camera. */
export const STUDIO_SHARED_3D_CHARACTER_SHADOW_LOCAL_BOUNDS = Object.freeze({
  min: Object.freeze([-0.72, -0.08, -0.48] as const),
  max: Object.freeze([0.72, 2.35, 0.48] as const),
});

function hashCanonicalText(value: string): `sha256:${string}` {
  return `sha256:${sha256HexPortable(new TextEncoder().encode(value))}`;
}

export function parseStudioShared3dCharacterStageTransform(
  value: unknown,
): StudioShared3dCharacterStageTransform | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const candidate = value as Record<string, unknown>;
    const keys = Object.keys(candidate);
    if (
      keys.length !== 2
      || !Object.hasOwn(candidate, "position")
      || !Object.hasOwn(candidate, "rotationY")
      || keys.some((key) => key !== "position" && key !== "rotationY")
    ) return null;
    const rawPosition = candidate.position;
    const rawRotationY = candidate.rotationY;
    if (!Array.isArray(rawPosition)) return null;
    const length = rawPosition.length;
    if (length !== 3) return null;
    const position = [rawPosition[0], rawPosition[1], rawPosition[2]];
    if (
      rawPosition.length !== length
      || Object.keys(rawPosition).some((key) => key !== "0" && key !== "1" && key !== "2")
      || typeof rawRotationY !== "number"
    ) {
      return null;
    }
    const [x, y, z] = position;
    const rotationY = rawRotationY;
    if (
      !position.every((component) => typeof component === "number" && Number.isFinite(component))
      || !Number.isFinite(rotationY)
      || x! < -10 || x! > 10
      || y! < -10 || y! > 10
      || z! < -10 || z! > 10
      || rotationY < -Math.PI || rotationY > Math.PI
    ) return null;
    return Object.freeze({
      position: Object.freeze(position.map((component) => Object.is(component, -0)
        ? 0
        : component)) as StudioVrmVec3,
      rotationY: Object.is(rotationY, -0) ? 0 : rotationY,
    });
  } catch {
    return null;
  }
}

export function studioShared3dCharacterStageTransformHash(
  value: StudioShared3dCharacterStageTransform,
): `sha256:${string}` {
  return hashCanonicalText(JSON.stringify({
    position: value.position,
    rotationY: value.rotationY,
  }));
}

/** World-space approximation shared by the renderer and shadow-frustum planner. */
export function studioShared3dCharacterWorldTransform(
  scene: StudioVrmSceneDocument,
  stageTransform?: StudioShared3dCharacterStageTransform,
): StudioShared3dCharacterWorldTransform {
  const root = scene.pose.translations.root;
  const width = scene.appearance.bodyScale.width;
  const height = scene.appearance.bodyScale.height;
  return Object.freeze({
    position: stageTransform?.position
      ?? Object.freeze([root[0], scene.pose.yOffset, root[2]]) as StudioVrmVec3,
    rotation: Object.freeze([
      0,
      stageTransform?.rotationY ?? scene.pose.bodyRotationY,
      0,
    ]) as StudioVrmVec3,
    scale: Object.freeze([width, height, width]) as StudioVrmVec3,
  });
}

/** Renderer-neutral shadow entity for one linked character. */
export function createStudioShared3dCharacterShadowEntity(
  character: StudioShared3dCharacterSource,
) {
  const transform = studioShared3dCharacterWorldTransform(
    character.scene,
    character.stageTransform,
  );
  return Object.freeze({
    id: `shared-vrm-${character.elementId}`,
    position: transform.position,
    rotation: transform.rotation,
    scale: transform.scale,
    visible: true,
    localBounds: STUDIO_SHARED_3D_CHARACTER_SHADOW_LOCAL_BOUNDS,
  });
}

export function inspectStudioShared3dCaptureReadiness(
  session: StudioShared3dSceneSession | undefined,
  statuses: Readonly<Record<string, StudioShared3dCharacterRuntimeStatus | undefined>>,
): StudioShared3dCaptureReadiness {
  let hasLoading = false;
  let hasUnavailable = false;
  const capturableElementIds: string[] = [];
  const previewOnlyElementIds: string[] = [];
  for (const character of session?.characters ?? []) {
    const status = statuses[character.runtimeKey];
    if (status === "unavailable") {
      hasUnavailable = true;
      continue;
    }
    if (status !== "ready") {
      hasLoading = true;
      continue;
    }
    if (character.compatibility.previewOmissions.length > 0) {
      previewOnlyElementIds.push(character.elementId);
    } else {
      capturableElementIds.push(character.elementId);
    }
  }
  return Object.freeze({
    phase: hasUnavailable ? "unavailable" : hasLoading ? "loading" : "ready",
    capturableElementIds: Object.freeze(capturableElementIds),
    previewOnlyElementIds: Object.freeze(previewOnlyElementIds),
  });
}
