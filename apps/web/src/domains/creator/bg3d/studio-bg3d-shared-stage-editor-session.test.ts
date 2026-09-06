import { describe, expect, it } from "vitest";

import { createStudioShared3dSceneSession } from "../studio-shared-3d-scene-bridge";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "../vrm/studio-vrm-scene-document";

import { DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT } from "./studio-bg3d-scene-document";
import {
  createStudioBg3dSharedStageEditorState,
  resolveStudioBg3dSharedStageEditorState,
  updateStudioBg3dSharedStageEditorStateFromEffectiveSession,
  updateStudioBg3dSharedStageEditorStateForSession,
  type StudioBg3dSharedStageEditorSessionInput,
} from "./studio-bg3d-shared-stage-editor-session";

import type { StudioBg3dSharedCharacterGroundingResult } from "./studio-bg3d-shared-character-grounding";
import type { StudioShared3dStageResolution } from "../studio-shared-3d-stage-document";

const GROUNDING_FAILURE = Object.freeze({
  ok: false as const,
  code: "invalid-input" as const,
}) satisfies StudioBg3dSharedCharacterGroundingResult;

function resolution(
  bundleId: string | null,
  backgroundElementId: string | null,
): StudioShared3dStageResolution {
  return Object.freeze({
    phase: bundleId ? "ready" : "unlinked",
    backgroundBundleId: bundleId,
    backgroundElementId,
    linkedCharacterElementIds: bundleId ? Object.freeze(["hero"]) : Object.freeze([]),
    updatedCharacterElementIds: Object.freeze([]),
    missingCharacterElementIds: Object.freeze([]),
    replacedCharacterElementIds: Object.freeze([]),
    message: bundleId ? "연결됨" : "연결 안 됨",
  });
}

function session(
  stageId: string,
  transform: { readonly position: readonly [number, number, number]; readonly rotationY: number },
  expression = 0,
) {
  const baseScene = createStudioVrmSceneDocument();
  const scene = expression === 0
    ? baseScene
    : normalizeStudioVrmSceneDocument({
        ...baseScene,
        expressions: { happy: expression },
      });
  return createStudioShared3dSceneSession([{
    elementId: "hero",
    label: "주인공",
    scene,
    stageId,
    stageTransform: transform,
  }]);
}

function input(
  scopeKey: string,
  stageId: string,
  transform: { readonly position: readonly [number, number, number]; readonly rotationY: number },
  options: {
    readonly open?: boolean;
    readonly saved?: boolean;
    readonly expression?: number;
  } = {},
): StudioBg3dSharedStageEditorSessionInput {
  const saved = options.saved ?? true;
  return {
    open: options.open ?? true,
    scopeKey,
    initialScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    operation: saved ? "update" : "insert",
    sceneSession: session(stageId, transform, options.expression),
    stageResolution: resolution(
      saved ? `bundle-${stageId}` : null,
      saved ? `background-${stageId}` : null,
    ),
  };
}

function makeDirtyState(source: StudioBg3dSharedStageEditorSessionInput) {
  const initial = createStudioBg3dSharedStageEditorState(source);
  const runtimeKey = source.sceneSession!.characters[0]!.runtimeKey;
  return updateStudioBg3dSharedStageEditorStateForSession(
    initial,
    initial.sessionIdentity,
    (current) => Object.freeze({
      ...current,
      placements: new Map([[
        "hero",
        Object.freeze({ position: [9, 2, 3] as const, rotationY: 2.2 }),
      ]]),
      statuses: Object.freeze({ [runtimeKey]: "ready" as const }),
      groundings: Object.freeze({ [runtimeKey]: GROUNDING_FAILURE }),
      mutationKind: "unlink" as const,
      materializationKind: "detached-editable-composite" as const,
      selectedElementId: "hero",
    }),
  );
}

describe("Shared Stage editor session isolation", () => {
  it("keeps one current session's local draft and transient UI state", () => {
    const source = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [1, 0.25, -2], rotationY: 0.5 },
    );
    const dirty = makeDirtyState(source);

    expect(resolveStudioBg3dSharedStageEditorState(dirty, source)).toBe(dirty);
    expect(dirty.placements.get("hero")?.position).toEqual([9, 2, 3]);
    expect(Object.values(dirty.statuses)).toEqual(["ready"]);
    expect(Object.values(dirty.groundings)).toEqual([GROUNDING_FAILURE]);
    expect(dirty.mutationKind).toBe("unlink");
    expect(dirty.materializationKind).toBe("detached-editable-composite");
  });

  it("uses the new background authority immediately even when element and model identities match", () => {
    const sourceA = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [1, 0.25, -2], rotationY: 0.5 },
    );
    const sourceB = input(
      "page-a:bundle-b",
      "stage-b",
      { position: [-4, 1, 3], rotationY: -1.2 },
    );
    expect(sourceA.sceneSession!.characters[0]!.modelRuntimeKey).toBe(
      sourceB.sceneSession!.characters[0]!.modelRuntimeKey,
    );

    const next = resolveStudioBg3dSharedStageEditorState(makeDirtyState(sourceA), sourceB);

    expect(next.placements.get("hero")).toEqual({
      position: [-4, 1, 3],
      rotationY: -1.2,
    });
    expect(next.statuses).toEqual({});
    expect(next.groundings).toEqual({});
    expect(next.mutationKind).toBe("refresh");
    expect(next.materializationKind).toBe("editable-lt-bundle");
    expect(next.selectedElementId).toBe("hero");
  });

  it("resets when source authority changes in the same background", () => {
    const before = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [1, 0.25, -2], rotationY: 0.5 },
    );
    const after = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [1, 0.25, -2], rotationY: 0.5 },
      { expression: 0.8 },
    );
    expect(before.sceneSession!.characters[0]!.runtimeKey).not.toBe(
      after.sceneSession!.characters[0]!.runtimeKey,
    );

    const next = resolveStudioBg3dSharedStageEditorState(makeDirtyState(before), after);
    expect(next.placements.get("hero")?.position).toEqual([1, 0.25, -2]);
    expect(next.statuses).toEqual({});
    expect(next.groundings).toEqual({});
  });

  it("treats close and reopen as fresh editor sessions", () => {
    const opened = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [1, 0.25, -2], rotationY: 0.5 },
    );
    const closed = { ...opened, open: false } as const;
    const closedState = resolveStudioBg3dSharedStageEditorState(
      makeDirtyState(opened),
      closed,
    );
    const reopened = resolveStudioBg3dSharedStageEditorState(closedState, opened);

    expect(reopened.placements.get("hero")?.position).toEqual([1, 0.25, -2]);
    expect(reopened.mutationKind).toBe("refresh");
    expect(reopened.materializationKind).toBe("editable-lt-bundle");
    expect(reopened.statuses).toEqual({});
  });

  it("admits the new session's first layout callback and rejects a late old callback", () => {
    const sourceA = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [1, 0.25, -2], rotationY: 0.5 },
    );
    const sourceB = input(
      "page-a:bundle-b",
      "stage-b",
      { position: [-4, 1, 3], rotationY: -1.2 },
    );
    const oldState = createStudioBg3dSharedStageEditorState(sourceA);
    const current = createStudioBg3dSharedStageEditorState(sourceB);

    const promotedDuringTransition = updateStudioBg3dSharedStageEditorStateFromEffectiveSession(
      oldState,
      oldState.sessionIdentity,
      current,
      (state) => Object.freeze({ ...state, mutationKind: "unlink" as const }),
    );
    expect(promotedDuringTransition.sessionIdentity).toBe(current.sessionIdentity);
    expect(promotedDuringTransition.mutationKind).toBe("unlink");

    const afterLateCallback = updateStudioBg3dSharedStageEditorStateFromEffectiveSession(
      current,
      oldState.sessionIdentity,
      oldState,
      (state) => Object.freeze({ ...state, mutationKind: "unlink" as const }),
    );
    expect(afterLateCallback).toBe(current);
  });

  it("chooses a clear default mutation for saved, new-cast, and empty backgrounds", () => {
    const saved = input(
      "page-a:bundle-a",
      "stage-a",
      { position: [0, 0, 0], rotationY: 0 },
    );
    const newWithCast = input(
      "page-a:new",
      "stage-new",
      { position: [0, 0, 0], rotationY: 0 },
      { saved: false },
    );
    const empty = {
      ...newWithCast,
      sceneSession: createStudioShared3dSceneSession([]),
    };

    expect(createStudioBg3dSharedStageEditorState(saved).mutationKind).toBe("refresh");
    expect(createStudioBg3dSharedStageEditorState(newWithCast).mutationKind).toBe("connect");
    expect(createStudioBg3dSharedStageEditorState(empty).mutationKind).toBe("background-only");
  });
});
