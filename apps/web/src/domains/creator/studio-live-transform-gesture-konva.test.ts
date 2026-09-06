// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { planStudioDrawObjectTransform } from "./brush/studio-draw-object-transform";
import { studioKonvaRuntime } from "./render/studio-konva-runtime";
import { beginStudioLiveCanvasGesture } from "./studio-live-canvas-gesture";
import { createStudioLiveTransformDraftStore } from "./studio-live-transform-draft-store";
import { STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS } from "./studio-live-transform-exact-draft-admission";
import {
  beginStudioKonvaDrawTransformGesture,
  studioKonvaDrawTransformIsBusy,
} from "./studio-live-transform-gesture-konva";
import { STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR } from "./studio-selection-chrome-mirror";

import type { DrawEl } from "./studio-element-model";
import type { StudioLiveTransformPreviewScheduler } from "./studio-live-transform-preview-session";
import type Konva from "konva";

function installCanvasContextStub(): () => void {
  const prototype = globalThis.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const original = prototype.getContext;
  prototype.getContext = () =>
    new Proxy(
      {
        canvas: null,
        getImageData: () => ({
          data: new Uint8ClampedArray(4),
          width: 1,
          height: 1,
        }),
      },
      {
        get: (target: Record<string, unknown>, property: string) =>
          property in target ? target[property] : () => undefined,
        set: () => true,
      },
    );
  return () => {
    prototype.getContext = original;
  };
}

function manualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const scheduler: StudioLiveTransformPreviewScheduler = {
    requestFrame: (callback) => {
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      callbacks.delete(handle);
    },
  };
  return {
    scheduler,
    flush: () => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
  };
}

const sourceBounds = { x: 10, y: 20, width: 100, height: 50 };
const draftScope = "page:page-1";
const sourceElement = {
  id: "stroke-1",
  type: "draw",
  kind: "freehand",
  points: [10, 20, 110, 70],
  stroke: "#16100c",
  strokeWidth: 4,
} as DrawEl;

interface Scene {
  readonly container: HTMLDivElement;
  readonly stage: Konva.Stage;
  readonly mainLayer: Konva.Layer;
  readonly dragLayer: Konva.Layer;
  readonly draftRoot: Konva.Group;
  readonly wrapper: Konva.Group;
  readonly proxy: Konva.Rect;
  readonly transformer: Konva.Transformer;
}

function createScene(): Scene {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const stage = new studioKonvaRuntime.Stage({ container, width: 720, height: 1020 });
  const mainLayer = new studioKonvaRuntime.Layer();
  const dragLayer = new studioKonvaRuntime.Layer();
  const draftRoot = new studioKonvaRuntime.Group({ listening: false });
  draftRoot.name("studio-live-transform-draft-root");
  dragLayer.add(draftRoot);
  stage.add(mainLayer, dragLayer);

  const wrapper = new studioKonvaRuntime.Group({ draggable: true });
  wrapper.setAttr("studioElementId", sourceElement.id);
  wrapper.add(new studioKonvaRuntime.Line({ points: sourceElement.points, stroke: "#000" }));
  const proxy = new studioKonvaRuntime.Rect(sourceBounds);
  const transformer = new studioKonvaRuntime.Transformer();
  mainLayer.add(wrapper, proxy, transformer);
  transformer.nodes([proxy]);
  return { container, stage, mainLayer, dragLayer, draftRoot, wrapper, proxy, transformer };
}

let restoreCanvas: () => void;
let scene: Scene;

beforeEach(() => {
  restoreCanvas = installCanvasContextStub();
  scene = createScene();
});

afterEach(() => {
  scene.stage.destroy();
  scene.container.remove();
  restoreCanvas();
});

function createGesture(
  existingStore = createStudioLiveTransformDraftStore(),
  element: DrawEl = sourceElement,
) {
  const clock = manualScheduler();
  const store = existingStore;
  const gesture = beginStudioKonvaDrawTransformGesture({
    preview: {
      scope: draftScope,
      element,
      elements: [element],
      dragLayer: scene.dragLayer,
      draftStore: store,
      scheduler: clock.scheduler,
    },
    sourceBounds,
    stage: scene.stage,
    proxy: scene.proxy,
    transformer: scene.transformer,
  });
  return { gesture, store, clock };
}

function beginGesture(
  existingStore = createStudioLiveTransformDraftStore(),
  element: DrawEl = sourceElement,
) {
  const begun = createGesture(existingStore, element);
  expect(begun.gesture).not.toBeNull();
  return { ...begun, gesture: begun.gesture! };
}

describe("beginStudioKonvaDrawTransformGesture · exact model draft", () => {
  it("keeps the common page writer lease until the exact handoff receives authoritative pixels", () => {
    const store = createStudioLiveTransformDraftStore();
    const clock = manualScheduler();
    const commit = vi.fn(() => true);
    const release = vi.fn();
    const cancel = vi.fn();
    const recoveryQueue: Array<() => void> = [];
    const begun = beginStudioLiveCanvasGesture({
      commitPort: {
        acquire: () => true,
        commit,
        release,
        cancel,
      },
      createTransient: () => {
        const renderer = beginStudioKonvaDrawTransformGesture({
          preview: {
            scope: draftScope,
            element: sourceElement,
            elements: [sourceElement],
            dragLayer: scene.dragLayer,
            draftStore: store,
            scheduler: clock.scheduler,
          },
          sourceBounds,
          stage: scene.stage,
          proxy: scene.proxy,
          transformer: scene.transformer,
        });
        expect(renderer).not.toBeNull();
        return renderer!;
      },
      scheduleRecovery: (callback) => recoveryQueue.push(callback),
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const terminalFrame = {
      targetBounds: { x: 25, y: 35, width: 175, height: 80 },
      rotationDeg: 30,
    };
    const expected = planStudioDrawObjectTransform({
      el: sourceElement,
      sourceBounds,
      ...terminalFrame,
    });
    expect(expected).not.toBeNull();

    expect(begun.session.finish(terminalFrame)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(store.getSnapshot()?.phase).toBe("handoff");
    expect(recoveryQueue).toHaveLength(1);

    // Polling before receipt retains both the draft and the writer exclusion lease.
    recoveryQueue.shift()?.();
    expect(release).not.toHaveBeenCalled();
    expect(store.getSnapshot()?.phase).toBe("handoff");
    expect(recoveryQueue).toHaveLength(1);

    expect(store.acknowledgeAuthoritative(draftScope, [expected!])).toBe(true);
    recoveryQueue.shift()?.();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBeNull();
    expect(recoveryQueue).toHaveLength(0);
  });

  it("rejects unbounded source arrays before compiler traversal and bounded stylus orientation", () => {
    const unboundedPoints = new Proxy(new Array<number>(200_000), {
      get: (target, property, receiver) => {
        if (property !== "length") throw new Error(`sample access: ${String(property)}`);
        return Reflect.get(target, property, receiver);
      },
    });
    const begin = (element: DrawEl) => beginStudioKonvaDrawTransformGesture({
      preview: {
        scope: draftScope,
        element,
        elements: [element],
        dragLayer: scene.dragLayer,
        draftStore: createStudioLiveTransformDraftStore(),
        scheduler: manualScheduler().scheduler,
      },
      sourceBounds,
      stage: scene.stage,
      proxy: scene.proxy,
      transformer: scene.transformer,
    });

    expect(begin({
      ...sourceElement,
      brush: "pen",
      sampleSpacing: 1,
      points: unboundedPoints,
    })).toBeNull();
    expect(begin({
      ...sourceElement,
      brush: "calligraphy",
      sampleSpacing: 1,
      twists: [30, 30],
    })).toBeNull();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
  });

  it("transfers construction-time cleanup to host recovery before the adapter can be returned", () => {
    vi.useFakeTimers();
    const store = createStudioLiveTransformDraftStore();
    const failedClaim = vi.spyOn(store, "claim").mockImplementation(() => {
      throw new Error("draft claim failed");
    });
    const readAbsolutePosition = scene.proxy.getAbsolutePosition.bind(scene.proxy);
    let remainingRestoreFailures = 3;
    const failedRestore = vi.spyOn(scene.proxy, "getAbsolutePosition").mockImplementation(() => {
      if (remainingRestoreFailures > 0) {
        remainingRestoreFailures -= 1;
        throw new Error("wrapper position unavailable");
      }
      return readAbsolutePosition();
    });

    try {
      expect(() => beginStudioKonvaDrawTransformGesture({
        preview: {
          scope: draftScope,
          element: sourceElement,
          elements: [sourceElement],
          dragLayer: scene.dragLayer,
          draftStore: store,
          scheduler: manualScheduler().scheduler,
        },
        sourceBounds,
        stage: scene.stage,
        proxy: scene.proxy,
        transformer: scene.transformer,
      })).toThrow("Konva live-transform setup and rollback both failed");
      expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
      expect(scene.proxy.getLayer()).toBe(scene.dragLayer);
      expect(remainingRestoreFailures).toBe(0);
      // No adapter token can be returned with this setup error. The Layer host's pending lease must
      // therefore remain discoverable and block a second writer until recovery finishes.
      expect(studioKonvaDrawTransformIsBusy(scene.stage, sourceElement.id)).toBe(true);

      vi.advanceTimersByTime(16);
      expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
      expect(scene.proxy.getLayer()).toBe(scene.mainLayer);
      expect(scene.transformer.getLayer()).toBe(scene.mainLayer);
      expect(
        scene.wrapper.getAttr("studioLiveTransformPreviewActive"),
      ).toBeUndefined();
      expect(studioKonvaDrawTransformIsBusy(scene.stage, sourceElement.id)).toBe(false);
    } finally {
      failedRestore.mockRestore();
      failedClaim.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps a setup-time non-Layer cleanup failure element-busy until host recovery", () => {
    vi.useFakeTimers();
    const store = createStudioLiveTransformDraftStore();
    const failedClaim = vi.spyOn(store, "claim").mockImplementation(() => {
      throw new Error("draft claim failed");
    });
    const setAttr = scene.wrapper.setAttr.bind(scene.wrapper);
    let remainingAttrClearFailures = 1;
    const failedAttrClear = vi.spyOn(scene.wrapper, "setAttr").mockImplementation((
      attribute,
      value,
    ) => {
      if (
        attribute === STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR
        && value === undefined
        && remainingAttrClearFailures > 0
      ) {
        remainingAttrClearFailures -= 1;
        throw new Error("active attr clear failed");
      }
      return setAttr(attribute, value);
    });

    try {
      expect(() => beginStudioKonvaDrawTransformGesture({
        preview: {
          scope: draftScope,
          element: sourceElement,
          elements: [sourceElement],
          dragLayer: scene.dragLayer,
          draftStore: store,
          scheduler: manualScheduler().scheduler,
        },
        sourceBounds,
        stage: scene.stage,
        proxy: scene.proxy,
        transformer: scene.transformer,
      })).toThrow("Konva live-transform setup and rollback both failed");
      expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
      expect(studioKonvaDrawTransformIsBusy(scene.stage, sourceElement.id)).toBe(true);

      vi.advanceTimersByTime(16);
      expect(
        scene.wrapper.getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR),
      ).toBeUndefined();
      expect(studioKonvaDrawTransformIsBusy(scene.stage, sourceElement.id)).toBe(false);
    } finally {
      failedAttrClear.mockRestore();
      failedClaim.mockRestore();
      vi.useRealTimers();
    }
  });

  it("replans non-uniform frames and switches back to the retained affine fast path", () => {
    const { gesture, store, clock } = beginGesture();
    expect(scene.draftRoot.zIndex()).toBe(0);
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.proxy.getLayer()).toBe(scene.dragLayer);
    expect(scene.transformer.getLayer()).toBe(scene.dragLayer);
    expect(scene.transformer.zIndex()).toBeGreaterThan(scene.draftRoot.zIndex());

    const nonUniform = {
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    };
    gesture.offer(nonUniform);
    clock.flush();
    expect(scene.wrapper.getLayer()).toBe(scene.dragLayer);
    const expected = planStudioDrawObjectTransform({
      el: sourceElement,
      sourceBounds,
      ...nonUniform,
    });
    expect(store.getSnapshot()?.entries[0]?.element).toEqual(expected);
    expect(scene.wrapper.visible()).toBe(false);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });

    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 20,
    });
    clock.flush();
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
    expect(scene.wrapper.scale()).toEqual({ x: 2, y: 2 });
    expect(scene.wrapper.rotation()).toBe(20);

    gesture.close({ kind: "cancel", reason: "escape" });
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.visible()).toBe(true);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });
    expect(store.getSnapshot()).toBeNull();
  });

  it("renders one isolated SceneCanvas receipt per steady affine frame", () => {
    const { gesture, store, clock } = beginGesture();
    const dragReceipt = vi.spyOn(scene.dragLayer, "drawScene");

    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 15,
    });
    clock.flush();
    // The first admitted frame has one source-lift receipt and one transformed source receipt.
    expect(dragReceipt).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toBeNull();

    dragReceipt.mockClear();
    gesture.offer({
      targetBounds: { x: 35, y: 45, width: 150, height: 75 },
      rotationDeg: 20,
    });
    clock.flush();
    expect(dragReceipt).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBeNull();

    gesture.close({ kind: "cancel", reason: "escape" });
  });

  it("keeps a frame release-only when clearing the Layer SceneCanvas exceeds the backing cap", () => {
    // The object-local transformed AABB is under 0.5M pixels at this scale. The isolated Layer's
    // 720x1020 Retina-3 SceneCanvas is 6.6M backing pixels, so only the full-clear charge rejects.
    const sceneCanvas = scene.dragLayer.getCanvas();
    const nativeSceneCanvas = scene.dragLayer.getNativeCanvasElement();
    sceneCanvas.setPixelRatio(3);

    expect(720 * 1020).toBeLessThan(STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS);
    expect(nativeSceneCanvas.style.width).toBe("720px");
    expect(nativeSceneCanvas.style.height).toBe("1020px");
    expect(nativeSceneCanvas.width).toBe(720 * 3);
    expect(nativeSceneCanvas.height).toBe(1020 * 3);
    expect(nativeSceneCanvas.width * nativeSceneCanvas.height).toBe(
      720 * 1020 * 3 ** 2,
    );
    expect(nativeSceneCanvas.width * nativeSceneCanvas.height).toBeGreaterThan(
      STUDIO_LIVE_TRANSFORM_EXACT_MAX_BACKING_PIXELS,
    );
    const { gesture, store, clock } = beginGesture();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.proxy.getLayer()).toBe(scene.dragLayer);
    expect(scene.transformer.getLayer()).toBe(scene.dragLayer);
    const sourceDrawScene = vi.spyOn(scene.mainLayer, "drawScene");
    const sourceBatchDraw = vi.spyOn(scene.mainLayer, "batchDraw");

    // Real Transformer events mutate the proxy before the preview scheduler sees the frame. The
    // chrome-only claim ensures those writes invalidate only the drag Layer.
    scene.proxy.setAttrs({ x: 30, y: 40, width: 200, height: 75, rotation: 15 });
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    });
    clock.flush();

    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.visible()).toBe(true);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });
    expect(sourceDrawScene).not.toHaveBeenCalled();
    expect(sourceBatchDraw).not.toHaveBeenCalled();
    gesture.close({ kind: "cancel", reason: "escape" });
    expect(scene.proxy.getLayer()).toBe(scene.mainLayer);
    expect(scene.transformer.getLayer()).toBe(scene.mainLayer);
  });

  it("rechecks identical geometry after DPR changes, then keeps rejected frames off the source Layer", () => {
    const { gesture, clock } = beginGesture();
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 15,
    });
    clock.flush();
    expect(scene.wrapper.getLayer()).toBe(scene.dragLayer);
    expect(scene.wrapper.scale()).toEqual({ x: 2, y: 2 });

    const sourceDrawScene = vi.spyOn(scene.mainLayer, "drawScene");
    const sourceBatchDraw = vi.spyOn(scene.mainLayer, "batchDraw");
    scene.dragLayer.getCanvas().setPixelRatio(3);

    // The first rejected frame is an authority transition: neutralize and return the source once.
    scene.proxy.setAttrs({ x: 30, y: 40, width: 200, height: 100, rotation: 15 });
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 15,
    });
    clock.flush();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });
    expect(sourceDrawScene).toHaveBeenCalled();
    expect(sourceBatchDraw).toHaveBeenCalled();

    sourceDrawScene.mockClear();
    sourceBatchDraw.mockClear();
    // Once release-only, later handle mutations are chrome-only and cannot repaint the source.
    scene.proxy.setAttrs({ x: 50, y: 60, width: 240, height: 120, rotation: 25 });
    gesture.offer({
      targetBounds: { x: 50, y: 60, width: 240, height: 120 },
      rotationDeg: 25,
    });
    clock.flush();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(sourceDrawScene).not.toHaveBeenCalled();
    expect(sourceBatchDraw).not.toHaveBeenCalled();

    gesture.close({ kind: "cancel", reason: "escape" });
  });

  it("crosses the draft publication barrier before transferring source visibility", () => {
    const store = createStudioLiveTransformDraftStore();
    const drawScene = vi.spyOn(scene.dragLayer, "drawScene");
    const autoDrawEnabled = studioKonvaRuntime.autoDrawEnabled;
    const visibilityAtPublication: boolean[] = [];
    store.subscribe(() => visibilityAtPublication.push(scene.wrapper.visible()));
    const { gesture, clock } = beginGesture(store);

    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    });
    clock.flush();
    // The exact subtree is committed while the authoritative source is still visible; the source
    // is hidden only after the synchronous renderer barrier returns.
    expect(visibilityAtPublication.at(-1)).toBe(true);
    expect(scene.wrapper.visible()).toBe(false);
    expect(drawScene).toHaveBeenCalled();
    expect(studioKonvaRuntime.autoDrawEnabled).toBe(autoDrawEnabled);

    drawScene.mockClear();
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 100 },
      rotationDeg: 20,
    });
    clock.flush();
    // On the reverse transition the already-transformed source receives pixels first; only then
    // does the exact subtree publish null and clear its canvas. A browser paint can see neither a
    // double-authority frame nor a blank frame.
    expect(visibilityAtPublication.at(-1)).toBe(true);
    expect(scene.wrapper.visible()).toBe(true);
    // Exact→affine needs two receipts only at the authority boundary: source first, then the
    // final source-only canvas after the draft subtree is synchronously removed.
    expect(drawScene).toHaveBeenCalledTimes(2);
    gesture.close({ kind: "cancel", reason: "escape" });
  });

  it("isolates chrome while a z-order-rejected source remains release-only in its document Layer", () => {
    // An authored node above the stroke refuses isolated lifting. Even a retained attr write would
    // invalidate the full main SceneCanvas, whose sibling renderer cost is unbounded by admission.
    scene.mainLayer.add(new studioKonvaRuntime.Rect({ width: 10, height: 10, fill: "#fff" }));
    const { gesture, store, clock } = beginGesture();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.proxy.getLayer()).toBe(scene.dragLayer);
    expect(scene.transformer.getLayer()).toBe(scene.dragLayer);
    const sourceDrawScene = vi.spyOn(scene.mainLayer, "drawScene");
    const sourceBatchDraw = vi.spyOn(scene.mainLayer, "batchDraw");

    scene.proxy.setAttrs({ x: 30, y: 40, width: 200, height: 75, rotation: 15 });
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    });
    clock.flush();

    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });
    expect(scene.wrapper.rotation()).toBe(0);
    expect(store.getSnapshot()).toBeNull();
    expect(sourceDrawScene).not.toHaveBeenCalled();
    expect(sourceBatchDraw).not.toHaveBeenCalled();

    gesture.close({ kind: "cancel", reason: "escape" });
    expect(scene.proxy.getLayer()).toBe(scene.mainLayer);
    expect(scene.transformer.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.getAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR)).toBeUndefined();
  });

  it("retains the exact terminal candidate until authoritative receipt, then restores source", () => {
    const { gesture, store } = beginGesture();
    const terminalFrame = {
      targetBounds: { x: 25, y: 35, width: 175, height: 80 },
      rotationDeg: 30,
    };
    const expected = planStudioDrawObjectTransform({
      el: sourceElement,
      sourceBounds,
      ...terminalFrame,
    });
    expect(expected).not.toBeNull();

    gesture.close({ kind: "commit", terminalFrame });
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.visible()).toBe(false);
    expect(store.getSnapshot()?.entries[0]?.element).toEqual(expected);
    expect(store.getSnapshot()?.phase).toBe("active");

    expect(gesture.settle?.({ kind: "commit", committed: true })).toBe(false);
    expect(store.getSnapshot()?.phase).toBe("handoff");
    // A recovery poll before receipt must not force-release the draft or expose the old source.
    expect(gesture.settle?.({ kind: "commit", committed: true })).toBe(false);
    expect(store.getSnapshot()?.phase).toBe("handoff");
    expect(scene.wrapper.visible()).toBe(false);
    expect(store.acknowledgeAuthoritative(draftScope, [expected!])).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
    expect(gesture.settle?.({ kind: "commit", committed: true })).toBe(true);
  });

  it("retries a requested handoff release after the authoritative source raster receipt fails", () => {
    const { gesture, store } = beginGesture();
    const terminalFrame = {
      targetBounds: { x: 25, y: 35, width: 175, height: 80 },
      rotationDeg: 30,
    };
    const expected = planStudioDrawObjectTransform({
      el: sourceElement,
      sourceBounds,
      ...terminalFrame,
    });
    expect(expected).not.toBeNull();

    gesture.close({ kind: "commit", terminalFrame });
    expect(gesture.settle?.({ kind: "commit", committed: true })).toBe(false);

    const drawScene = scene.mainLayer.drawScene.bind(scene.mainLayer);
    let receiptAttempts = 0;
    const sourceReceipt = vi.spyOn(scene.mainLayer, "drawScene").mockImplementation(() => {
      receiptAttempts += 1;
      if (receiptAttempts === 1) throw new Error("source raster receipt failed");
      return drawScene();
    });
    expect(store.acknowledgeAuthoritative(draftScope, [expected!])).toBe(false);
    expect(store.getSnapshot()?.phase).toBe("handoff");

    // The failed acknowledgement requested release, so the common settlement retry may now retry
    // that same callback. It must not re-run the durable commit or wait for a second CRDT receipt.
    expect(gesture.settle?.({ kind: "commit", committed: true })).toBe(true);
    expect(receiptAttempts).toBe(2);
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
    sourceReceipt.mockRestore();
  });

  it("rolls a retained terminal candidate back when the durable commit rejects", () => {
    const { gesture, store } = beginGesture();
    gesture.close({
      kind: "commit",
      terminalFrame: {
        targetBounds: { x: 25, y: 35, width: 175, height: 80 },
        rotationDeg: 30,
      },
    });
    expect(scene.wrapper.visible()).toBe(false);

    const authorityEvents: string[] = [];
    vi.spyOn(scene.mainLayer, "drawScene").mockImplementation(() => {
      authorityEvents.push("source-pixels");
      return scene.mainLayer;
    });
    vi.spyOn(scene.dragLayer, "drawScene").mockImplementation(() => {
      authorityEvents.push("draft-pixels");
      return scene.dragLayer;
    });
    store.subscribe(() => {
      if (store.getSnapshot() === null) authorityEvents.push("draft-cleared");
    });

    expect(gesture.settle?.({ kind: "commit", committed: false })).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
    expect(authorityEvents).toEqual([
      "source-pixels",
      "draft-cleared",
      "draft-pixels",
    ]);
  });

  it("keeps a partially restored close retryable until Layer ownership and authority recover", () => {
    const { gesture, store, clock } = beginGesture();
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    });
    clock.flush();
    expect(scene.wrapper.visible()).toBe(false);
    expect(store.getSnapshot()?.phase).toBe("active");

    const readAbsolutePosition = scene.wrapper.getAbsolutePosition.bind(scene.wrapper);
    let remainingFailures = 3;
    const brokenPositionRead = vi.spyOn(scene.wrapper, "getAbsolutePosition")
      .mockImplementation(() => {
        if (remainingFailures > 0) {
          remainingFailures -= 1;
          throw new Error("wrapper position unavailable");
        }
        return readAbsolutePosition();
      });

    const outcome = { kind: "cancel", reason: "escape" } as const;
    expect(() => gesture.close(outcome)).toThrow(
      "Failed to completely release a Konva live-transform renderer claim",
    );
    expect(scene.wrapper.getLayer()).toBe(scene.dragLayer);
    expect(scene.wrapper.visible()).toBe(false);
    expect(store.getSnapshot()?.phase).toBe("active");

    expect(() => gesture.close(outcome)).not.toThrow();
    expect(scene.wrapper.getLayer()).toBe(scene.mainLayer);
    expect(scene.wrapper.visible()).toBe(true);
    expect(store.getSnapshot()).toBeNull();
    expect(remainingFailures).toBe(0);
    brokenPositionRead.mockRestore();
  });

  it("propagates a still-owned draft release refusal into retryable renderer close", () => {
    const store = createStudioLiveTransformDraftStore();
    const claim = store.claim.bind(store);
    const claimSpy = vi.spyOn(store, "claim").mockImplementation((scope, elementId) => {
      const owned = claim(scope, elementId);
      return owned
        ? {
            ...owned,
            release: () => false,
            isReleased: () => false,
          }
        : null;
    });
    const { gesture, clock } = beginGesture(store);
    gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    });
    clock.flush();
    expect(store.getSnapshot()?.phase).toBe("active");

    expect(() => gesture.close({ kind: "cancel", reason: "escape" })).toThrow(
      "Failed to completely release a Konva live-transform renderer claim",
    );
    expect(store.getSnapshot()?.phase).toBe("active");
    claimSpy.mockRestore();
  });

  it("refreshes source visibility after a new gesture supersedes an earlier handoff", () => {
    const store = createStudioLiveTransformDraftStore();
    const first = beginGesture(store);
    first.gesture.close({
      kind: "commit",
      terminalFrame: {
        targetBounds: { x: 25, y: 35, width: 175, height: 80 },
        rotationDeg: 30,
      },
    });
    expect(first.gesture.settle?.({ kind: "commit", committed: true })).toBe(false);
    expect(store.getSnapshot()?.phase).toBe("handoff");
    expect(scene.wrapper.visible()).toBe(false);

    const second = beginGesture(store);
    // claim() releases the old handoff synchronously; gesture two must capture this restored value.
    expect(scene.wrapper.visible()).toBe(true);
    second.gesture.offer({
      targetBounds: { x: 30, y: 40, width: 200, height: 75 },
      rotationDeg: 15,
    });
    second.clock.flush();
    expect(scene.wrapper.visible()).toBe(false);

    second.gesture.close({ kind: "cancel", reason: "escape" });
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
  });

  it("keeps an over-budget 3,200-sample calligraphy frame out of the main-thread exact lane", () => {
    const points = Array.from({ length: 3_200 }, (_, index) => [
      (index % 100),
      (index % 2) * 40,
    ]).flat();
    const longCalligraphy: DrawEl = {
      ...sourceElement,
      brush: "calligraphy",
      sampleSpacing: 1,
      points,
    };
    const { gesture, store } = createGesture(
      createStudioLiveTransformDraftStore(),
      longCalligraphy,
    );

    expect(gesture).toBeNull();
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });
  });

  it("keeps an over-budget retained-affine frame out of point and panel scans", () => {
    const points = Array.from({ length: 100_000 }, () => [10, 20]).flat();
    const importedGeneric: DrawEl = {
      ...sourceElement,
      points,
    };
    const { gesture, store } = createGesture(
      createStudioLiveTransformDraftStore(),
      importedGeneric,
    );

    // The O(1) begin preflight now rejects before compiler cloning/path measurement, rather than
    // waiting for a uniform retained frame to reach the per-frame admission gate.
    expect(gesture).toBeNull();
    expect(store.getSnapshot()).toBeNull();
    expect(scene.wrapper.visible()).toBe(true);
    expect(scene.wrapper.scale()).toEqual({ x: 1, y: 1 });
  });
});
