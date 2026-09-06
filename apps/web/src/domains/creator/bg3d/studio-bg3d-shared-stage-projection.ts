import type { BgCustomModelInstance } from "../studio-background-3d-model";
import type { BgPrimitive } from "../studio-background-3d-primitives";
import type { StudioBg3dSharedStageMutationKind } from "./studio-bg3d-shared-stage-editor-session";
import type { StudioBg3dSharedStageInsertProjection } from "../studio-shared-3d-insert-contract";
import type {
  StudioShared3dCaptureReadiness,
  StudioShared3dCharacterSource,
} from "../studio-shared-3d-scene-bridge";
import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";

interface SharedStageMutationBlockInput {
  readonly operation: "insert" | "update";
  readonly stageResolution?: StudioShared3dStageResolution;
  readonly mutationKind: StudioBg3dSharedStageMutationKind;
  readonly includeCharactersInCapture: boolean;
  readonly captureReadiness: StudioShared3dCaptureReadiness;
}

/**
 * Fails closed before an image/document commit whenever a linked character cannot be captured
 * without dropping source-authoritative appearance fields.
 */
export function resolveStudioBg3dSharedStageMutationBlockedReason({
  operation,
  stageResolution,
  mutationKind,
  includeCharactersInCapture,
  captureReadiness,
}: SharedStageMutationBlockInput): string | null {
  if (
    operation === "update"
    && stageResolution
    && stageResolution.phase !== "unlinked"
    && stageResolution.phase !== "ready"
    && stageResolution.phase !== "live-update"
    && mutationKind !== "relink"
    && mutationKind !== "unlink"
  ) {
    return `${stageResolution.message} 연결을 복구하거나 새 배경으로 추가한 뒤 업데이트해 주세요.`;
  }

  const mutationIncludesCharacters = includeCharactersInCapture
    && mutationKind !== "background-only"
    && mutationKind !== "unlink";
  if (mutationIncludesCharacters && captureReadiness.previewOnlyElementIds.length > 0) {
    return `캐릭터 ${captureReadiness.previewOnlyElementIds.length}명의 일부 설정을 아직 배경 이미지에 빠짐없이 담을 수 없어 연결 적용을 멈췄어요. 연결 설정에서 ‘배경만’을 선택하면 캐릭터 원본은 그대로 두고 배경만 적용할 수 있어요.`;
  }

  return null;
}

export function createStudioBg3dLinkedCharacterCapture(
  elementIds: readonly string[],
  characters: readonly StudioShared3dCharacterSource[],
): NonNullable<StudioBg3dSharedStageInsertProjection["linkedCharacterCapture"]> | undefined {
  if (elementIds.length === 0) return undefined;
  const characterById = new Map(characters.map((character) => [character.elementId, character]));
  return Object.freeze({
    kind: "full-fidelity-linked-vrm-capture" as const,
    elementIds: Object.freeze([...elementIds]),
    stagePlacements: Object.freeze(elementIds.flatMap((elementId) => {
      const character = characterById.get(elementId);
      return character
        ? [Object.freeze({
            elementId,
            expectedRuntimeKey: character.runtimeKey,
            transform: character.stageTransform,
          })]
        : [];
    })),
  });
}

interface SharedCharacterGroundSurfaceRevisionInput {
  readonly primitives: readonly BgPrimitive[];
  readonly customModels: readonly BgCustomModelInstance[];
  readonly readyCloneIds: ReadonlySet<string>;
}

/** Stable grounding invalidation key; material-only edits intentionally do not move feet. */
export function createStudioBg3dSharedCharacterGroundSurfaceRevision({
  primitives,
  customModels,
  readyCloneIds,
}: SharedCharacterGroundSurfaceRevisionInput): string {
  return JSON.stringify({
    primitives: primitives.map((primitive) => ({
      id: primitive.id,
      kind: primitive.kind,
      parentId: primitive.parentId ?? null,
      visible: primitive.visible !== false,
      position: primitive.position,
      rotation: primitive.rotation,
      scale: primitive.scale,
    })),
    customModels: customModels.map((model) => ({
      id: model.id,
      modelId: model.modelId,
      parentId: model.parentId ?? null,
      visible: model.visible !== false,
      position: model.position,
      rotation: model.rotation,
      scale: model.scale,
      cloneReady: readyCloneIds.has(model.id),
      animation: model.animation,
      pose: model.pose,
      morph: model.morph,
      constraints: model.constraints,
    })),
  });
}
