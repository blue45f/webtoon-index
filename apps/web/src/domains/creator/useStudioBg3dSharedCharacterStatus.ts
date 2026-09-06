import { useLayoutEffect, useState } from "react";

import {
  createStudioBg3dSharedStageEditorState,
  resolveStudioBg3dSharedStageEditorState,
  updateStudioBg3dSharedStageEditorStateFromEffectiveSession,
  updateStudioBg3dSharedStagePlacementForSession,
  type StudioBg3dSharedStageEditorSessionInput,
  type StudioBg3dSharedStageEditorStateUpdater,
  type StudioBg3dSharedStageMaterializationKind,
  type StudioBg3dSharedStageMutationKind,
} from "./bg3d/studio-bg3d-shared-stage-editor-session";
import {
  STUDIO_SHARED_3D_CHARACTER_TRANSFORM_RECEIPT_KIND,
  STUDIO_SHARED_3D_CHARACTER_TRANSFORM_RECEIPT_VERSION,
  inspectStudioShared3dCaptureReadiness,
  parseStudioShared3dCharacterStageTransform,
  studioShared3dCharacterStageTransformHash,
} from "./studio-shared-3d-scene-runtime";
import { shouldCaptureStudioShared3dStageCharacters } from "./studio-shared-3d-stage-capture-intent";

import type { StudioBg3dSharedCharacterGroundingResult } from "./bg3d/studio-bg3d-shared-character-grounding";
import type {
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterTransformCommitHandler,
} from "./studio-shared-3d-scene-bridge";

/**
 * Owns the target-scoped Shared Stage draft while every model, pose and wardrobe document remains
 * source-owned. Late renderer callbacks are admitted only for the exact active editor session.
 */
export function useStudioBg3dSharedCharacterStatus(
  input: StudioBg3dSharedStageEditorSessionInput,
) {
  const sourceSharedCharacters = input.sceneSession?.characters ?? [];
  const [storedState, setStoredState] = useState(() =>
    createStudioBg3dSharedStageEditorState(input));
  const state = resolveStudioBg3dSharedStageEditorState(storedState, input);

  useLayoutEffect(() => {
    if (storedState === state) return;
    setStoredState(state);
  }, [state, storedState]);

  const updateState = (updater: StudioBg3dSharedStageEditorStateUpdater) => {
    const observedStoredSessionIdentity = storedState.sessionIdentity;
    setStoredState((current) =>
      updateStudioBg3dSharedStageEditorStateFromEffectiveSession(
        current,
        observedStoredSessionIdentity,
        state,
        updater,
      ));
  };
  const setStatuses = (
    updater: (
      current: Readonly<Record<string, StudioShared3dCharacterRuntimeStatus>>,
    ) => Readonly<Record<string, StudioShared3dCharacterRuntimeStatus>>,
  ) => {
    updateState((current) => {
      const statuses = updater(current.statuses);
      return statuses === current.statuses ? current : Object.freeze({ ...current, statuses });
    });
  };
  const setGroundings = (
    updater: (
      current: Readonly<Record<string, StudioBg3dSharedCharacterGroundingResult>>,
    ) => Readonly<Record<string, StudioBg3dSharedCharacterGroundingResult>>,
  ) => {
    updateState((current) => {
      const groundings = updater(current.groundings);
      return groundings === current.groundings
        ? current
        : Object.freeze({ ...current, groundings });
    });
  };
  const setSelectedSharedCharacterElementId = (elementId: string | null) => {
    updateState((current) => current.selectedElementId === elementId
      ? current
      : Object.freeze({ ...current, selectedElementId: elementId }));
  };
  const setSharedStageMutationKind = (kind: StudioBg3dSharedStageMutationKind) => {
    updateState((current) => current.mutationKind === kind
      ? current
      : Object.freeze({ ...current, mutationKind: kind }));
  };
  const setSharedStageMaterializationKind = (
    kind: StudioBg3dSharedStageMaterializationKind,
  ) => {
    updateState((current) => current.materializationKind === kind
      ? current
      : Object.freeze({ ...current, materializationKind: kind }));
  };

  const sharedCharacterStatuses = state.statuses;
  const sharedCharacterGroundings = state.groundings;
  const sharedStageMutationKind = state.mutationKind;
  const sharedStageMaterializationKind = state.materializationKind;
  const selectedSharedCharacterElementId = state.selectedElementId;
  const sharedCharacters = sourceSharedCharacters.map((character) => {
    const stageTransform = state.placements.get(character.elementId) ?? character.stageTransform;
    return Object.freeze({
      ...character,
      stageTransform,
      placementHash: studioShared3dCharacterStageTransformHash(stageTransform),
      placementAuthority: "stage-override" as const,
    });
  });
  const commitSharedCharacterTransform: StudioShared3dCharacterTransformCommitHandler =
    (request) => {
      const source = sharedCharacters.find(({ elementId }) => elementId === request.elementId);
      const transform = parseStudioShared3dCharacterStageTransform(request.transform);
      if (!source || !transform) {
        return Object.freeze({
          ok: false as const,
          code: "invalid-request" as const,
          message: "캐릭터 위치·높이·방향 값이 올바르지 않아 이 배경의 배치를 바꾸지 않았어요.",
        });
      }
      if (
        request.expectedRuntimeKey !== source.runtimeKey
        || (
          request.expectedPlacementHash !== undefined
          && request.expectedPlacementHash !== source.placementHash
        )
      ) {
        return Object.freeze({
          ok: false as const,
          code: "stale-source" as const,
          message: "캐릭터 원본이나 이 배경의 배치가 바뀌어 오래된 값을 적용하지 않았어요. 현재 값을 다시 확인해 주세요.",
        });
      }
      const afterPlacementHash = studioShared3dCharacterStageTransformHash(transform);
      const changed = source.placementHash !== afterPlacementHash;
      if (changed) {
        updateState((current) =>
          updateStudioBg3dSharedStagePlacementForSession(
            current,
            current.sessionIdentity,
            source.elementId,
            transform,
          ));
      }
      return Object.freeze({
        ok: true as const,
        changed,
        receipt: Object.freeze({
          kind: STUDIO_SHARED_3D_CHARACTER_TRANSFORM_RECEIPT_KIND,
          version: STUDIO_SHARED_3D_CHARACTER_TRANSFORM_RECEIPT_VERSION,
          elementId: source.elementId,
          beforeSourceHash: source.sourceHash,
          afterSourceHash: source.sourceHash,
          beforeRuntimeKey: source.runtimeKey,
          afterRuntimeKey: source.runtimeKey,
          authority: "stage-override" as const,
          beforePlacementHash: source.placementHash,
          afterPlacementHash,
          transform,
        }),
      });
    };

  const targetHasSavedSharedScene = Boolean(input.stageResolution?.backgroundBundleId);
  const targetHasLinkedCharacters = Boolean(
    input.stageResolution?.linkedCharacterElementIds.length
    || input.stageResolution?.missingCharacterElementIds.length
    || input.stageResolution?.replacedCharacterElementIds.length,
  );
  const selectSharedStageMutation = (kind: StudioBg3dSharedStageMutationKind) => {
    updateState((current) => Object.freeze({
      ...current,
      mutationKind: kind,
      materializationKind: "editable-lt-bundle" as const,
    }));
  };
  const includeSharedCharactersInCapture = shouldCaptureStudioShared3dStageCharacters({
    mutationKind: sharedStageMutationKind,
    targetHasLinkedCharacters,
  });
  const shouldStartOnSharedStageLayerTab = input.operation === "update"
    && input.stageResolution !== undefined
    && (
      input.stageResolution.phase !== "ready"
      || (targetHasSavedSharedScene && !targetHasLinkedCharacters)
    );
  const mayApplyEmptySharedStageMutation = targetHasSavedSharedScene
    && (
      sharedStageMutationKind === "unlink"
      || (
        sharedStageMutationKind === "relink"
        && (input.stageResolution?.missingCharacterElementIds.length ?? 0) > 0
      )
    );
  const effectiveSelectedSharedCharacterElementId = sharedCharacters.some(
    ({ elementId }) => elementId === selectedSharedCharacterElementId,
  )
    ? selectedSharedCharacterElementId
    : sharedCharacters[0]?.elementId ?? null;
  const effectiveSelectedSharedCharacter = sharedCharacters.find(
    ({ elementId }) => elementId === effectiveSelectedSharedCharacterElementId,
  ) ?? null;
  const sharedCharacterCaptureReadiness = inspectStudioShared3dCaptureReadiness(
    input.sceneSession,
    sharedCharacterStatuses,
  );
  const sharedCharacterCaptureElementIds = includeSharedCharactersInCapture
    ? sharedCharacterCaptureReadiness.capturableElementIds
    : [];

  const updateSharedCharacterStatus = (
    runtimeKey: string,
    status: StudioShared3dCharacterRuntimeStatus,
  ) => {
    if (!sharedCharacters.some((character) => character.runtimeKey === runtimeKey)) return;
    setStatuses((current) => {
      const next: Record<string, StudioShared3dCharacterRuntimeStatus> = {};
      for (const character of sharedCharacters) {
        const nextStatus = character.runtimeKey === runtimeKey
          ? status
          : current[character.runtimeKey];
        if (nextStatus) next[character.runtimeKey] = nextStatus;
      }
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      return currentKeys.length === nextKeys.length
        && nextKeys.every((key) => current[key] === next[key])
        ? current
        : next;
    });
  };
  const updateSharedCharacterGrounding = (
    runtimeKey: string,
    result: StudioBg3dSharedCharacterGroundingResult | null,
  ) => {
    if (!sharedCharacters.some((character) => character.runtimeKey === runtimeKey)) return;
    setGroundings((current) => {
      const next: Record<string, StudioBg3dSharedCharacterGroundingResult> = {};
      for (const character of sharedCharacters) {
        if (character.runtimeKey === runtimeKey) {
          if (result) next[runtimeKey] = result;
          continue;
        }
        const retained = current[character.runtimeKey];
        if (retained) next[character.runtimeKey] = retained;
      }
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(next);
      const unchanged = currentKeys.length === nextKeys.length
        && nextKeys.every((key) => {
          const previous = current[key];
          const candidate = next[key];
          if (!previous || !candidate || previous.ok !== candidate.ok) return false;
          return candidate.ok
            ? previous.ok === true
              && previous.receipt.identity.placementHash
                === candidate.receipt.identity.placementHash
              && previous.receipt.diagnosis === candidate.receipt.diagnosis
              && previous.receipt.placementY === candidate.receipt.placementY
              && previous.receipt.gapY === candidate.receipt.gapY
              && previous.receipt.surface.source === candidate.receipt.surface.source
              && previous.receipt.surface.targetEntityId
                === candidate.receipt.surface.targetEntityId
            : previous.ok === false && previous.code === candidate.code;
        });
      return unchanged ? current : next;
    });
  };

  const sharedCharacterReadyCount = sharedCharacters.reduce(
    (count, character) =>
      count + (sharedCharacterStatuses[character.runtimeKey] === "ready" ? 1 : 0),
    0,
  );
  const sharedCharacterUnavailableCount = sharedCharacters.reduce(
    (count, character) =>
      count + (sharedCharacterStatuses[character.runtimeKey] === "unavailable" ? 1 : 0),
    0,
  );
  const sharedCharacterPreviewOmissionCount = sharedCharacters.reduce(
    (count, character) => count + character.compatibility.previewOmissions.length,
    0,
  );
  const sharedCharacterRelationshipLabel = !includeSharedCharactersInCapture
    ? `공유 캐릭터 ${sharedCharacters.length}명 · 미리보기만 표시`
    : sharedCharacterUnavailableCount > 0
      ? `공유 캐릭터 ${sharedCharacterReadyCount}/${sharedCharacters.length}명 · ${sharedCharacterUnavailableCount}명 확인 필요`
      : sharedCharacterReadyCount !== sharedCharacters.length
        ? `공유 캐릭터 ${sharedCharacterReadyCount}/${sharedCharacters.length}명 연결 준비 중`
        : sharedStageMutationKind === "connect" || sharedStageMutationKind === "relink"
          ? `공유 캐릭터 ${sharedCharacters.length}명 연결 예정`
          : targetHasLinkedCharacters
            ? `공유 캐릭터 ${sharedCharacters.length}명 연결됨`
            : `공유 캐릭터 ${sharedCharacters.length}명 · 미리보기만 표시`;

  return {
    commitSharedCharacterTransform,
    effectiveSelectedSharedCharacter,
    effectiveSelectedSharedCharacterElementId,
    includeSharedCharactersInCapture,
    mayApplyEmptySharedStageMutation,
    selectSharedStageMutation,
    setSelectedSharedCharacterElementId,
    setSharedStageMaterializationKind,
    setSharedStageMutationKind,
    sharedCharacterCaptureElementIds,
    sharedCharacterCaptureReadiness,
    sharedCharacterGroundings,
    sharedCharacterPreviewOmissionCount,
    sharedCharacterReadyCount,
    sharedCharacterRelationshipLabel,
    sharedCharacterStatuses,
    sharedCharacterUnavailableCount,
    sharedCharacters,
    sharedStageMaterializationKind,
    sharedStageMutationKind,
    shouldStartOnSharedStageLayerTab,
    targetHasLinkedCharacters,
    targetHasSavedSharedScene,
    updateSharedCharacterGrounding,
    updateSharedCharacterStatus,
  } as const;
}
