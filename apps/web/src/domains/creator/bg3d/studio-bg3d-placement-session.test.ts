import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_PLACEMENT_DEFAULT_ROTATION_STEP_DEGREES,
  STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE,
  createStudioBg3dPlacementSession,
  transitionStudioBg3dPlacementSession,
  type StudioBg3dPlacementPreviewState,
  type StudioBg3dPlacementSessionEvent,
  type StudioBg3dPlacementSessionState,
} from "./studio-bg3d-placement-session";

function begin(
  overrides: Partial<Extract<StudioBg3dPlacementSessionEvent, { type: "begin" }>> = {},
) {
  return transitionStudioBg3dPlacementSession(createStudioBg3dPlacementSession(), {
    type: "begin",
    assetId: "asset-chair",
    storageId: "stored-chair",
    placementToken: "placement-1",
    sourceKind: "asset-library",
    surfaceHit: {
      point: [1, 2, 3],
      normal: [0, 2, 0],
    },
    ...overrides,
  });
}

function previewState(): StudioBg3dPlacementPreviewState {
  const result = begin();
  if (!result.ok || result.state.phase !== "preview") throw new Error("expected preview");
  return result.state;
}

describe("Studio BG3D placement session", () => {
  it("starts an immutable surface preview with canonical identity, normal, and yaw", () => {
    const result = begin({ yawDegrees: 725 });

    expect(result).toMatchObject({ ok: true, commitPlan: null });
    expect(result.state).toMatchObject({
      phase: "preview",
      identity: {
        assetId: "asset-chair",
        storageId: "stored-chair",
        placementToken: "placement-1",
        sourceKind: "asset-library",
      },
      placement: {
        targetKind: "surface",
        worldPosition: [1, 2, 3],
        worldNormal: [0, 1, 0],
        yawDegrees: 5,
        axisLock: "none",
      },
      anchorWorldPosition: [1, 2, 3],
      rotationStepDegrees: STUDIO_BG3D_PLACEMENT_DEFAULT_ROTATION_STEP_DEGREES,
    });
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(result.state.phase === "preview" && Object.isFrozen(result.state.placement.worldPosition)).toBe(true);
  });

  it("uses an exact y=0 floor fallback for an import session", () => {
    const result = begin({
      assetId: "fresh-import",
      storageId: "stored-import",
      sourceKind: "import",
      surfaceHit: null,
      floorPoint: [-0, 4.5],
    });

    expect(result.ok).toBe(true);
    expect(result.state).toMatchObject({
      phase: "preview",
      identity: { sourceKind: "import" },
      placement: {
        targetKind: "floor",
        worldPosition: [0, 0, 4.5],
        worldNormal: [0, 1, 0],
      },
    });
  });

  it("updates pointer previews without emitting history and keeps a Shift dominant-axis lock", () => {
    const initial = begin({
      surfaceHit: null,
      floorPoint: [0, 0],
    });
    expect(initial.ok && initial.state.phase === "preview").toBe(true);
    const preview = initial.state as StudioBg3dPlacementPreviewState;

    const firstMove = transitionStudioBg3dPlacementSession(preview, {
      type: "pointer-move",
      placementToken: "placement-1",
      shiftKey: true,
      surfaceHit: { point: [6, 2, 3], normal: [0, 0, 4] },
    });
    expect(firstMove).toMatchObject({ ok: true, commitPlan: null });
    expect(firstMove.state).toMatchObject({
      phase: "preview",
      placement: {
        targetKind: "surface",
        worldPosition: [6, 2, 0],
        worldNormal: [0, 0, 1],
        axisLock: "world-x",
      },
    });
    expect(preview.placement.worldPosition).toEqual([0, 0, 0]);

    const retainedLock = transitionStudioBg3dPlacementSession(firstMove.state, {
      type: "pointer-move",
      placementToken: "placement-1",
      shiftKey: true,
      surfaceHit: { point: [1, 5, 9], normal: [0, 1, 0] },
    });
    expect(retainedLock.state).toMatchObject({
      phase: "preview",
      placement: { worldPosition: [1, 5, 0], axisLock: "world-x" },
    });

    const released = transitionStudioBg3dPlacementSession(retainedLock.state, {
      type: "pointer-move",
      placementToken: "placement-1",
      shiftKey: false,
      surfaceHit: { point: [1, 5, 9], normal: [0, 1, 0] },
    });
    expect(released.state).toMatchObject({
      phase: "preview",
      placement: { worldPosition: [1, 5, 9], axisLock: "none" },
    });
  });

  it("chooses the world Z axis when Shift movement is Z-dominant", () => {
    const initial = begin({ surfaceHit: null, floorPoint: [2, 3] });
    const moved = transitionStudioBg3dPlacementSession(initial.state, {
      type: "pointer-move",
      placementToken: "placement-1",
      shiftKey: true,
      floorPoint: [4, 11],
    });

    expect(moved.state).toMatchObject({
      phase: "preview",
      placement: {
        worldPosition: [2, 0, 11],
        axisLock: "world-z",
      },
    });
  });

  it("normalizes yaw after default and custom rotation steps", () => {
    const defaultStart = begin({ yawDegrees: 170 });
    const defaultRotated = transitionStudioBg3dPlacementSession(defaultStart.state, {
      type: "rotate",
      placementToken: "placement-1",
      direction: "clockwise",
    });
    expect(defaultRotated.state).toMatchObject({
      phase: "preview",
      placement: { yawDegrees: -175 },
    });

    const customStart = begin({ yawDegrees: -175, rotationStepDegrees: 30 });
    const customRotated = transitionStudioBg3dPlacementSession(customStart.state, {
      type: "rotate",
      placementToken: "placement-1",
      direction: "counter-clockwise",
    });
    expect(customRotated.state).toMatchObject({
      phase: "preview",
      placement: { yawDegrees: 155 },
    });
  });

  it("emits exactly one commit plan and rejects a second click", () => {
    const preview = previewState();
    const first = transitionStudioBg3dPlacementSession(preview, {
      type: "click-commit",
      placementToken: "placement-1",
    });

    expect(first).toMatchObject({
      ok: true,
      state: { phase: "committed" },
      commitPlan: {
        kind: "studio-bg3d-model-placement",
        assetId: "asset-chair",
        storageId: "stored-chair",
        placementToken: "placement-1",
        sourceKind: "asset-library",
        placement: {
          worldPosition: [1, 2, 3],
          worldNormal: [0, 1, 0],
          yawDegrees: 0,
        },
      },
    });
    expect(first.commitPlan && Object.isFrozen(first.commitPlan)).toBe(true);

    const second = transitionStudioBg3dPlacementSession(first.state, {
      type: "click-commit",
      placementToken: "placement-1",
    });
    expect(second).toEqual({
      ok: false,
      state: first.state,
      commitPlan: null,
      reason: "invalid-transition",
    });
  });

  it("cancels on Escape without a commit plan and cannot commit afterwards", () => {
    const cancelled = transitionStudioBg3dPlacementSession(previewState(), {
      type: "escape",
      placementToken: "placement-1",
    });
    expect(cancelled).toMatchObject({
      ok: true,
      state: { phase: "cancelled" },
      commitPlan: null,
    });

    const commit = transitionStudioBg3dPlacementSession(cancelled.state, {
      type: "click-commit",
      placementToken: "placement-1",
    });
    expect(commit).toMatchObject({
      ok: false,
      reason: "invalid-transition",
      commitPlan: null,
    });
  });

  it.each(["pointer-move", "rotate", "click-commit", "escape"] as const)(
    "rejects a stale token for %s without changing state",
    (type) => {
      const preview = previewState();
      const event = type === "pointer-move"
        ? {
            type,
            placementToken: "stale-placement",
            shiftKey: false,
            floorPoint: [5, 6] as const,
          }
        : type === "rotate"
          ? { type, placementToken: "stale-placement", direction: "clockwise" as const }
          : { type, placementToken: "stale-placement" };
      const result = transitionStudioBg3dPlacementSession(preview, event);

      expect(result).toEqual({
        ok: false,
        state: preview,
        commitPlan: null,
        reason: "stale-token",
      });
      expect(result.state).toBe(preview);
    },
  );

  it.each([
    { label: "NaN surface coordinate", surfaceHit: { point: [Number.NaN, 0, 0], normal: [0, 1, 0] } },
    { label: "infinite surface coordinate", surfaceHit: { point: [0, Number.POSITIVE_INFINITY, 0], normal: [0, 1, 0] } },
    { label: "excessive surface coordinate", surfaceHit: { point: [STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE + 1, 0, 0], normal: [0, 1, 0] } },
    { label: "zero normal", surfaceHit: { point: [0, 0, 0], normal: [0, 0, 0] } },
    { label: "infinite normal", surfaceHit: { point: [0, 0, 0], normal: [0, Number.POSITIVE_INFINITY, 0] } },
    { label: "excessive floor coordinate", surfaceHit: null, floorPoint: [0, STUDIO_BG3D_PLACEMENT_MAX_WORLD_COORDINATE + 1] },
  ])("fails closed for $label", ({ surfaceHit, floorPoint }) => {
    const idle = createStudioBg3dPlacementSession();
    const result = transitionStudioBg3dPlacementSession(idle, {
      type: "begin",
      assetId: "asset-chair",
      storageId: "stored-chair",
      placementToken: "placement-invalid",
      sourceKind: "asset-library",
      surfaceHit: surfaceHit as never,
      floorPoint: floorPoint as never,
    });

    expect(result).toEqual({
      ok: false,
      state: idle,
      commitPlan: null,
      reason: "invalid-input",
    });
  });

  it("does not turn an invalid present surface hit into a valid floor fallback", () => {
    const idle = createStudioBg3dPlacementSession();
    const result = transitionStudioBg3dPlacementSession(idle, {
      type: "begin",
      assetId: "asset-chair",
      storageId: "stored-chair",
      placementToken: "placement-invalid-surface",
      sourceKind: "asset-library",
      surfaceHit: { point: [Number.NaN, 0, 0], normal: [0, 1, 0] },
      floorPoint: [2, 3],
    });

    expect(result).toMatchObject({ ok: false, reason: "invalid-input", commitPlan: null });
  });

  it("retains the exact preview on an invalid pointer update", () => {
    const preview = previewState();
    const result = transitionStudioBg3dPlacementSession(preview, {
      type: "pointer-move",
      placementToken: "placement-1",
      shiftKey: false,
      surfaceHit: { point: [0, 0, Number.NaN], normal: [0, 1, 0] },
      floorPoint: [5, 6],
    });

    expect(result).toEqual({
      ok: false,
      state: preview,
      commitPlan: null,
      reason: "invalid-input",
    });
    expect(result.state).toBe(preview);
  });

  it.each([
    { assetId: "" },
    { storageId: " stored-chair" },
    { placementToken: "__proto__" },
    { sourceKind: "remote-marketplace" },
    { yawDegrees: Number.NaN },
    { yawDegrees: Number.POSITIVE_INFINITY },
    { rotationStepDegrees: 0 },
    { rotationStepDegrees: 181 },
  ])("rejects invalid identity or rotation input %#", (overrides) => {
    const result = begin(overrides as never);
    expect(result).toMatchObject({ ok: false, reason: "invalid-input", commitPlan: null });
    expect(result.state.phase).toBe("idle");
  });

  it("does not mutate frozen event inputs or prior preview state", () => {
    const surfacePoint = Object.freeze([1, 2, 3] as const);
    const surfaceNormal = Object.freeze([0, 4, 0] as const);
    const event = Object.freeze({
      type: "begin" as const,
      assetId: "asset-chair",
      storageId: "stored-chair",
      placementToken: "placement-frozen",
      sourceKind: "asset-library" as const,
      surfaceHit: Object.freeze({ point: surfacePoint, normal: surfaceNormal }),
    });
    const started = transitionStudioBg3dPlacementSession(createStudioBg3dPlacementSession(), event);
    expect(started.ok && started.state.phase === "preview").toBe(true);
    const preview = started.state as StudioBg3dPlacementPreviewState;
    const before = structuredClone(preview);
    const moveEvent = Object.freeze({
      type: "pointer-move" as const,
      placementToken: "placement-frozen",
      shiftKey: false,
      floorPoint: Object.freeze([8, 9] as const),
    });

    const moved = transitionStudioBg3dPlacementSession(preview, moveEvent);

    expect(preview).toEqual(before);
    expect(moved.state).not.toBe(preview);
    expect(surfacePoint).toEqual([1, 2, 3]);
    expect(surfaceNormal).toEqual([0, 4, 0]);
    expect(moveEvent.floorPoint).toEqual([8, 9]);
  });

  it("fails closed for a forged non-canonical state", () => {
    const forged = {
      ...previewState(),
      placement: {
        ...previewState().placement,
        worldPosition: [Number.NaN, 0, 0],
      },
    } as unknown as StudioBg3dPlacementSessionState;
    const result = transitionStudioBg3dPlacementSession(forged, {
      type: "click-commit",
      placementToken: "placement-1",
    });

    expect(result).toEqual({
      ok: false,
      state: createStudioBg3dPlacementSession(),
      commitPlan: null,
      reason: "invalid-state",
    });
  });

  it("rejects a forged non-unit normal before a commit can be emitted", () => {
    const preview = previewState();
    const forged = {
      ...preview,
      placement: {
        ...preview.placement,
        worldNormal: [0, 2, 0],
      },
    } as unknown as StudioBg3dPlacementSessionState;
    const result = transitionStudioBg3dPlacementSession(forged, {
      type: "click-commit",
      placementToken: "placement-1",
    });

    expect(result).toMatchObject({
      ok: false,
      state: { phase: "idle" },
      commitPlan: null,
      reason: "invalid-state",
    });
  });
});
