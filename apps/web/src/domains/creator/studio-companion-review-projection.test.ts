import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_COMPANION_NAVIGATOR_MAX_BYTES,
  STUDIO_COMPANION_NAVIGATOR_MAX_EDGE,
  STUDIO_COMPANION_REVIEW_MAX_COMMENTS,
  STUDIO_COMPANION_REVIEW_MAX_HISTORY,
  STUDIO_COMPANION_REVIEW_MAX_LAYERS,
  StudioCompanionNavigatorObjectUrlOwner,
  captureStudioCompanionNavigatorFrame,
  createStudioCompanionReviewProjection,
  createStudioCompanionReviewProjectionFromSource,
  encodeStudioCompanionNavigatorWebp,
  isStudioCompanionNavigatorFrame,
  isStudioCompanionReviewControl,
  isStudioCompanionReviewProjection,
  mergeStudioCompanionBrushPatches,
  normalizeStudioCompanionViewport,
  planStudioCompanionExternalScreenPlacement,
  planStudioCompanionNavigatorCapture,
  studioCompanionPlacementWindowFeatures,
} from "./studio-companion-review-projection";

function projection() {
  return createStudioCompanionReviewProjection({
    revision: 7,
    documentRevision: 12,
    pageLabel: "1화",
    selectionLabel: "주인공 선화",
    canUndo: true,
    canRedo: false,
    captureAllowed: true,
    viewport: { x: 0.8, y: -1, width: 0.4, height: 0.3 },
    layers: Array.from({ length: 80 }, (_, index) => ({
      id: `layer-${index}`,
      label: `레이어 ${index}`,
      type: "draw",
      selected: index === 79,
    })),
    historyLength: 40,
    historyIndex: 31,
    comments: Array.from({ length: 40 }, (_, index) => ({
      id: `comment-${index}`,
      author: `작가 ${index}`,
      body: `검수 의견 ${index}`,
      unread: index === 39,
    })),
    brush: {
      id: "pen",
      label: "펜",
      size: 999,
      opacity: -1,
      color: "not-a-color",
      choices: Array.from({ length: 50 }, (_, index) => ({
        id: `brush-${index}`,
        label: `브러시 ${index}`,
      })),
    },
  });
}

describe("studio companion review projection", () => {
  it("bounds summaries, sanitizes values, and keeps the active layer visible", () => {
    const result = projection();

    expect(result.layers).toHaveLength(STUDIO_COMPANION_REVIEW_MAX_LAYERS);
    expect(result.layers[0]).toMatchObject({ id: "layer-79", selected: true });
    expect(result.history).toHaveLength(STUDIO_COMPANION_REVIEW_MAX_HISTORY);
    expect(result.comments).toHaveLength(STUDIO_COMPANION_REVIEW_MAX_COMMENTS);
    expect(result.comments[0]?.id).toBe("comment-39");
    expect(result.viewport).toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.3 });
    expect(result.brush).toMatchObject({ size: 80, opacity: 0, color: "#1a1a1a" });
    expect(result.truncated).toEqual({ layers: 32, history: 16, comments: 16 });
    expect(isStudioCompanionReviewProjection(result)).toBe(true);
  });

  it("projects raw Studio sources in the lazy companion chunk without losing back selections", () => {
    const result = createStudioCompanionReviewProjectionFromSource({
      revision: 2,
      documentRevision: 3,
      pageLabel: "2화",
      selectionLabel: "선화 0",
      canUndo: true,
      canRedo: true,
      captureAllowed: true,
      viewport: { x: 0, y: 0, width: 1, height: 0.5 },
      selectedLayerId: "layer-0",
      layers: Array.from({ length: 60 }, (_, index) => ({
        id: `layer-${index}`,
        name: index === 0 ? "선화 0" : null,
        type: "draw",
      })),
      layerLabel: (layerId) => `대체 ${layerId}`,
      historyLength: 4,
      historyIndex: 3,
      comments: Array.from({ length: 30 }, (_, index) => ({
        id: `comment-${index}`,
        author: { displayName: `작업자 ${index}` },
        body: `검수 ${index}`,
      })),
      unreadCommentIds: ["comment-29"],
      brush: {
        id: "pen",
        label: "펜",
        size: 6,
        opacity: 1,
        color: "#112233",
        choices: [{ id: "pencil", name: "연필" }],
      },
    });

    expect(result.layers).toHaveLength(STUDIO_COMPANION_REVIEW_MAX_LAYERS);
    expect(result.layers.some((layer) => layer.id === "layer-0" && layer.selected)).toBe(true);
    expect(result.comments[0]?.id).toBe("comment-29");
    expect(result.truncated).toMatchObject({ layers: 12, comments: 6 });
  });

  it("does not idle or allocate a canvas when navigator capture is already blocked", async () => {
    const captureCanvas = vi.fn();
    const result = await captureStudioCompanionNavigatorFrame({
      request: {
        generation: 1,
        revision: 2,
        sequence: 3,
        signal: new AbortController().signal,
      },
      isCaptureBlocked: () => true,
      captureCanvas,
    });

    expect(result).toBeNull();
    expect(captureCanvas).not.toHaveBeenCalled();
  });

  it("keeps a selected back layer inside the bounded front-to-back projection", () => {
    const result = createStudioCompanionReviewProjection({
      revision: 1,
      documentRevision: 1,
      pageLabel: "페이지",
      canUndo: false,
      canRedo: false,
      captureAllowed: true,
      viewport: null,
      layers: Array.from({ length: 80 }, (_, index) => ({
        id: `layer-${index}`,
        label: `레이어 ${index}`,
        selected: index === 0,
      })),
      historyLength: 1,
      historyIndex: 0,
      comments: [],
      brush: { id: "pen", label: "펜", size: 6, opacity: 1, color: "#112233", choices: [] },
    });

    expect(result.layers).toHaveLength(STUDIO_COMPANION_REVIEW_MAX_LAYERS);
    expect(result.layers.filter((layer) => layer.selected)).toEqual([
      expect.objectContaining({ id: "layer-0" }),
    ]);
    expect(isStudioCompanionReviewProjection(result)).toBe(true);
  });

  it("rejects oversized or structurally polluted projections", () => {
    const result = projection();
    expect(isStudioCompanionReviewProjection({ ...result, extra: true })).toBe(false);
    expect(isStudioCompanionReviewProjection({
      ...result,
      layers: [...result.layers, result.layers[0]],
    })).toBe(false);
    expect(isStudioCompanionReviewProjection({
      ...result,
      brush: { ...result.brush, color: "javascript:alert(1)" },
    })).toBe(false);
    expect(isStudioCompanionReviewProjection({
      ...result,
      layers: result.layers.map((layer, index) => ({ ...layer, selected: index < 2 })),
    })).toBe(false);
    expect(isStudioCompanionReviewProjection({
      ...result,
      comments: [result.comments[0], result.comments[0]],
    })).toBe(false);
    expect(isStudioCompanionReviewProjection({
      ...result,
      brush: { ...result.brush, choices: result.brush.choices.slice(1) },
    })).toBe(false);
  });

  it("validates normalized navigation and constrained primary-side control intents", () => {
    expect(isStudioCompanionReviewControl({ kind: "navigate", point: { x: 0.25, y: 1 } })).toBe(true);
    expect(isStudioCompanionReviewControl({ kind: "navigate", point: { x: 1.01, y: 0 } })).toBe(false);
    expect(isStudioCompanionReviewControl({
      kind: "brush",
      patch: { id: "pencil", size: 24, opacity: 0.45, color: "#aabbcc" },
    })).toBe(true);
    expect(isStudioCompanionReviewControl({ kind: "brush", patch: { size: 81 } })).toBe(false);
    expect(isStudioCompanionReviewControl({ kind: "history", action: "delete" })).toBe(false);
  });

  it("coalesces brush patches by last value without dropping other fields", () => {
    expect(mergeStudioCompanionBrushPatches(
      { id: "pen", size: 5 },
      { size: 12, opacity: 0.5 }
    )).toEqual({ id: "pen", size: 12, opacity: 0.5 });
  });

  it("blocks capture during an active stroke and enforces dirty revision 2fps pacing", () => {
    expect(planStudioCompanionNavigatorCapture({
      generation: 1,
      lastCapturedGeneration: 0,
      revision: 0,
      lastCapturedRevision: -1,
      lastCaptureAt: -1_000,
      now: 0,
      activeStroke: false,
      inFlight: false,
    })).toEqual({ kind: "capture" });
    expect(planStudioCompanionNavigatorCapture({
      generation: 1,
      lastCapturedGeneration: 1,
      revision: 2,
      lastCapturedRevision: 1,
      lastCaptureAt: 1_000,
      now: 2_000,
      activeStroke: true,
      inFlight: false,
    })).toEqual({ kind: "skip", reason: "active-stroke" });
    expect(planStudioCompanionNavigatorCapture({
      generation: 1,
      lastCapturedGeneration: 1,
      revision: 2,
      lastCapturedRevision: 1,
      lastCaptureAt: 1_000,
      now: 1_250,
      activeStroke: false,
      inFlight: false,
    })).toEqual({ kind: "defer", delayMs: 250 });
    expect(planStudioCompanionNavigatorCapture({
      generation: 1,
      lastCapturedGeneration: 1,
      revision: 2,
      lastCapturedRevision: 1,
      lastCaptureAt: 1_000,
      now: 1_500,
      activeStroke: false,
      inFlight: false,
    })).toEqual({ kind: "capture" });
    expect(planStudioCompanionNavigatorCapture({
      generation: 1,
      lastCapturedGeneration: 1,
      revision: 1,
      lastCapturedRevision: 1,
      lastCaptureAt: 0,
      now: 10_000,
      activeStroke: false,
      inFlight: false,
    })).toEqual({ kind: "skip", reason: "clean" });
    expect(planStudioCompanionNavigatorCapture({
      generation: 2,
      lastCapturedGeneration: 1,
      revision: 0,
      lastCapturedRevision: 100,
      lastCaptureAt: 0,
      now: 10_000,
      activeStroke: false,
      inFlight: false,
    })).toEqual({ kind: "capture" });
  });

  it("rejects navigator frames outside WebP, edge, and byte budgets", () => {
    const valid = {
      generation: 2,
      revision: 9,
      sequence: 3,
      width: STUDIO_COMPANION_NAVIGATOR_MAX_EDGE,
      height: 720,
      blob: new Blob([new Uint8Array(32)], { type: "image/webp" }),
    };
    expect(isStudioCompanionNavigatorFrame(valid)).toBe(true);
    expect(isStudioCompanionNavigatorFrame({
      ...valid,
      blob: new Blob(
        [new Uint8Array(STUDIO_COMPANION_NAVIGATOR_MAX_BYTES)],
        { type: "image/webp" }
      ),
    })).toBe(true);
    expect(isStudioCompanionNavigatorFrame({ ...valid, generation: 0 })).toBe(false);
    expect(isStudioCompanionNavigatorFrame({ ...valid, width: STUDIO_COMPANION_NAVIGATOR_MAX_EDGE + 1 })).toBe(false);
    expect(isStudioCompanionNavigatorFrame({ ...valid, blob: new Blob(["png"], { type: "image/png" }) })).toBe(false);
    expect(isStudioCompanionNavigatorFrame({
      ...valid,
      blob: new Blob([new Uint8Array(STUDIO_COMPANION_NAVIGATOR_MAX_BYTES + 1)], { type: "image/webp" }),
    })).toBe(false);
  });

  it("fails closed when WebP canvas setup or encode callback fails", async () => {
    const source = { width: 200, height: 100 } as HTMLCanvasElement;
    await expect(encodeStudioCompanionNavigatorWebp(source, {
      generation: 1,
      revision: 2,
      sequence: 1,
      createCanvas: () => { throw new Error("canvas unavailable"); },
    })).resolves.toBeNull();
    await expect(encodeStudioCompanionNavigatorWebp(source, {
      generation: 1,
      revision: 2,
      sequence: 2,
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => { throw new Error("context unavailable"); },
      }) as unknown as HTMLCanvasElement,
    })).resolves.toBeNull();
    await expect(encodeStudioCompanionNavigatorWebp(source, {
      generation: 1,
      revision: 2,
      sequence: 3,
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => { throw new Error("tainted"); } }),
      }) as unknown as HTMLCanvasElement,
    })).resolves.toBeNull();

    vi.useFakeTimers();
    const pending = encodeStudioCompanionNavigatorWebp(source, {
      generation: 1,
      revision: 2,
      sequence: 4,
      timeoutMs: 50,
      createCanvas: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: () => undefined,
      }) as unknown as HTMLCanvasElement,
    });
    await vi.advanceTimersByTimeAsync(250);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });

  it("scales a large source to 1280px and accepts the exact WebP byte boundary", async () => {
    const source = { width: 2_560, height: 720 } as HTMLCanvasElement;
    const drawImage = vi.fn();
    const created: Array<{ width: number; height: number }> = [];
    const frame = await encodeStudioCompanionNavigatorWebp(source, {
      generation: 3,
      revision: 17,
      sequence: 5,
      createCanvas: (width, height) => {
        created.push({ width, height });
        return {
          width,
          height,
          getContext: () => ({ drawImage }),
          toBlob: (callback: BlobCallback) => callback(new Blob(
            [new Uint8Array(STUDIO_COMPANION_NAVIGATOR_MAX_BYTES)],
            { type: "image/webp" }
          )),
        } as unknown as HTMLCanvasElement;
      },
    });

    expect(created).toEqual([{ width: 1_280, height: 360 }]);
    expect(drawImage).toHaveBeenCalledWith(source, 0, 0, 1_280, 360);
    expect(frame).toMatchObject({
      generation: 3,
      revision: 17,
      sequence: 5,
      width: 1_280,
      height: 360,
    });
    expect(frame?.blob.size).toBe(STUDIO_COMPANION_NAVIGATOR_MAX_BYTES);
  });

  it("reduces dimensions after oversized quality attempts instead of emitting an oversize frame", async () => {
    const source = { width: 2_560, height: 720 } as HTMLCanvasElement;
    const created: Array<{ width: number; height: number }> = [];
    const frame = await encodeStudioCompanionNavigatorWebp(source, {
      generation: 1,
      revision: 2,
      sequence: 3,
      createCanvas: (width, height) => {
        const pass = created.length;
        created.push({ width, height });
        return {
          width,
          height,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (callback: BlobCallback) => callback(new Blob(
            [new Uint8Array(
              pass === 0 ? STUDIO_COMPANION_NAVIGATOR_MAX_BYTES + 1 : 64
            )],
            { type: "image/webp" }
          )),
        } as unknown as HTMLCanvasElement;
      },
    });

    expect(created).toEqual([
      { width: 1_280, height: 360 },
      { width: 998, height: 280 },
    ]);
    expect(frame).toMatchObject({ width: 998, height: 280 });
    expect(frame?.blob.size).toBe(64);
  });

  it("revokes the previous navigator Blob URL on replacement and teardown", () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    const owner = new StudioCompanionNavigatorObjectUrlOwner({ createObjectURL, revokeObjectURL });

    expect(owner.replace(new Blob(["1"]))).toBe("blob:first");
    expect(owner.replace(new Blob(["2"]))).toBe("blob:second");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
    owner.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
  });

  it("keeps the previous owned URL when creating a replacement URL fails", () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:first")
      .mockImplementationOnce(() => { throw new Error("URL budget exhausted"); });
    const revokeObjectURL = vi.fn();
    const owner = new StudioCompanionNavigatorObjectUrlOwner({ createObjectURL, revokeObjectURL });

    expect(owner.replace(new Blob(["1"]))).toBe("blob:first");
    expect(owner.replace(new Blob(["2"]))).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    owner.clear();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });

  it("retains the displayed navigator URL until a staged candidate commits", () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:current")
      .mockReturnValueOnce("blob:candidate")
      .mockReturnValueOnce("blob:replacement");
    const revokeObjectURL = vi.fn();
    const owner = new StudioCompanionNavigatorObjectUrlOwner({ createObjectURL, revokeObjectURL });

    expect(owner.replace(new Blob(["current"]))).toBe("blob:current");
    const candidate = owner.stage(new Blob(["candidate"]))!;
    expect(owner.current()?.url).toBe("blob:current");
    expect(owner.pending()).toBe(candidate);
    expect(owner.ownedCount()).toBe(2);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    expect(owner.reject(candidate)).toBe(true);
    expect(owner.current()?.url).toBe("blob:current");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:candidate");

    const replacement = owner.stage(new Blob(["replacement"]))!;
    expect(owner.commit(replacement)).toBe("blob:replacement");
    expect(owner.current()).toBe(replacement);
    expect(owner.pending()).toBeNull();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:current");
  });

  it("identity-fences stale navigator commits and rejects without disturbing live URLs", () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:current")
      .mockReturnValueOnce("blob:pending")
      .mockReturnValueOnce("blob:newer");
    const revokeObjectURL = vi.fn();
    const owner = new StudioCompanionNavigatorObjectUrlOwner({ createObjectURL, revokeObjectURL });
    owner.replace(new Blob(["current"]));
    const stalePending = owner.stage(new Blob(["pending"]))!;
    const newerPending = owner.stage(new Blob(["newer"]))!;

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pending");
    expect(owner.commit(stalePending)).toBeNull();
    expect(owner.reject(stalePending)).toBe(false);
    expect(owner.current()?.url).toBe("blob:current");
    expect(owner.pending()).toBe(newerPending);
    expect(owner.commit({ ...newerPending })).toBeNull();
    expect(owner.commit(newerPending)).toBe("blob:newer");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:current");
  });

  it("clears both pending and displayed navigator URLs exactly once", () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce("blob:current")
      .mockReturnValueOnce("blob:pending");
    const revokeObjectURL = vi.fn();
    const owner = new StudioCompanionNavigatorObjectUrlOwner({ createObjectURL, revokeObjectURL });
    owner.replace(new Blob(["current"]));
    owner.stage(new Blob(["pending"]));

    owner.clear();
    owner.clear();

    expect(revokeObjectURL.mock.calls).toEqual([
      ["blob:pending"],
      ["blob:current"],
    ]);
    expect(owner.current()).toBeNull();
    expect(owner.pending()).toBeNull();
    expect(owner.ownedCount()).toBe(0);
  });

  it("clamps viewport boxes to normalized preview bounds", () => {
    expect(normalizeStudioCompanionViewport({ x: -2, y: 0.9, width: 2, height: 0.5 }))
      .toEqual({ x: 0, y: 0.5, width: 1, height: 0.5 });
    expect(normalizeStudioCompanionViewport({ x: 1, y: 1, width: 0, height: 0 }))
      .toEqual({ x: 0.99, y: 0.99, width: 0.01, height: 0.01 });
  });

  it("plans an external-screen placement with negative coordinates inside the available area", () => {
    const placement = planStudioCompanionExternalScreenPlacement({
      currentScreen: { availLeft: 0, availTop: 0, availWidth: 1_920, availHeight: 1_080 },
      screens: [
        null,
        { availLeft: Number.MAX_VALUE, availTop: 0, availWidth: Number.MAX_VALUE, availHeight: 900 },
        { availLeft: 0, availTop: 0, availWidth: 1_920, availHeight: 1_080, isPrimary: true },
        Object.assign(Object.create({ platform: true }), {
          availLeft: -1_600,
          availTop: -120,
          availWidth: 1_600,
          availHeight: 900,
          label: "왼쪽 화면",
        }),
      ],
      preferredWidth: 2_000,
      preferredHeight: 1_200,
    });

    expect(placement).toEqual({
      left: -1_600,
      top: -120,
      width: 1_600,
      height: 900,
      screenLabel: "왼쪽 화면",
    });
    expect(studioCompanionPlacementWindowFeatures(placement!)).toContain("left=-1600,top=-120");
    expect(planStudioCompanionExternalScreenPlacement({ screens: [{
      availLeft: 0,
      availTop: 0,
      availWidth: 1_920,
      availHeight: 1_080,
    }] })).toBeNull();
    expect(planStudioCompanionExternalScreenPlacement({
      currentScreen: { availLeft: 0, availTop: 0, availWidth: 320, availHeight: 240 },
      screens: [
        { availLeft: 0, availTop: 0, availWidth: 320, availHeight: 240 },
        { availLeft: 320, availTop: 0, availWidth: 160, availHeight: 120, label: "작은 화면" },
      ],
    })).toEqual({ left: 320, top: 0, width: 160, height: 120, screenLabel: "작은 화면" });
  });
});
