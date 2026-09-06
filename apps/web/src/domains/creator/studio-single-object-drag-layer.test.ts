// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";
import { studioKonvaRuntime } from "./render/studio-konva-runtime";
import {
  mirrorStudioDrawElementTranslation,
  STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR,
} from "./studio-selection-chrome-mirror";
import {
  beginStudioSingleDrawTransformChromeLayer,
  beginStudioSingleDrawTransformLayer,
  beginStudioSingleDrawTransformSourceLayer,
  beginStudioSingleObjectDragLayer,
  restoreStudioSingleObjectDragLayer,
  studioSingleObjectDragLayerRecoveryPendingForElement,
  STUDIO_KONVA_DOCUMENT_SHADOW_NAME,
  STUDIO_LIVE_TRANSFORM_Z_ORDER_EXEMPT_ATTR,
} from "./studio-single-object-drag-layer";

import type Konva from "konva";


const studioCanvasViewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");

function installCanvasContextStub(): () => void {
  const prototype = globalThis.HTMLCanvasElement.prototype as unknown as {
    getContext: unknown;
  };
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

interface Scene {
  readonly stage: Konva.Stage;
  readonly mainLayer: Konva.Layer;
  readonly dragLayer: Konva.Layer;
  readonly container: HTMLDivElement;
}

function createScene(): Scene {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const stage = new studioKonvaRuntime.Stage({ container, width: 720, height: 1020 });
  const mainLayer = new studioKonvaRuntime.Layer();
  const dragLayer = new studioKonvaRuntime.Layer();
  stage.add(mainLayer, dragLayer);
  return { stage, mainLayer, dragLayer, container };
}

function addSelectedNode(
  parent: Konva.Container,
  id = "object-1",
): Konva.Group {
  const target = new studioKonvaRuntime.Group({ x: 20, y: 30, draggable: true });
  target.setAttr("studioElementId", id);
  target.add(new studioKonvaRuntime.Rect({ width: 40, height: 25 }));
  parent.add(target);
  return target;
}

function addDocumentShadow(opacity = 1): Konva.Group {
  const shadow = new studioKonvaRuntime.Group({
    name: STUDIO_KONVA_DOCUMENT_SHADOW_NAME,
    opacity,
  });
  scene.mainLayer.add(shadow);
  return shadow;
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

describe("single-object drag Layer", () => {
  it("lifts only the selected visual island and its attached Transformer", () => {
    const unrelated = new studioKonvaRuntime.Group();
    scene.mainLayer.add(unrelated);
    const target = addSelectedNode(scene.mainLayer);
    const transformer = new studioKonvaRuntime.Transformer();
    scene.mainLayer.add(transformer);
    transformer.nodes([target]);
    const forceUpdate = vi.spyOn(transformer, "forceUpdate");
    const originalOrder = [...scene.mainLayer.getChildren()];

    const session = beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      transformer,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    });

    expect(session).not.toBeNull();
    expect(target.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);
    expect(forceUpdate).toHaveBeenCalledTimes(1);
    expect(unrelated.getLayer()).toBe(scene.mainLayer);

    target.absolutePosition({ x: 245, y: 180 });
    const movedPosition = target.getAbsolutePosition();
    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(target.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);
    expect(forceUpdate).toHaveBeenCalledTimes(2);
    expect(target.getAbsolutePosition()).toEqual(movedPosition);
    expect([...scene.mainLayer.getChildren()]).toEqual(originalOrder);
    expect(restoreStudioSingleObjectDragLayer(session)).toBe(false);
  });

  it("lifts a direct authored child without replacing its reserved shadow owner", () => {
    const shadow = addDocumentShadow(0);
    const peer = new studioKonvaRuntime.Rect({ width: 10, height: 10 });
    shadow.add(peer);
    const target = addSelectedNode(shadow);
    const transformer = new studioKonvaRuntime.Transformer();
    scene.mainLayer.add(transformer);
    transformer.nodes([target]);
    const shadowOrder = [...shadow.getChildren()];

    const session = beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      transformer,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    });

    expect(session).not.toBeNull();
    expect(shadow.getParent()).toBe(scene.mainLayer);
    expect(peer.getParent()).toBe(shadow);
    expect(target.getParent()).toBe(scene.dragLayer);
    expect(transformer.getParent()).toBe(scene.dragLayer);

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(target.getParent()).toBe(shadow);
    expect(transformer.getParent()).toBe(scene.mainLayer);
    expect([...shadow.getChildren()]).toEqual(shadowOrder);
  });

  it("leaves a node another owner re-parented mid-gesture exactly where they put it", () => {
    // Reconciliation can move a stroke under a panel clipping group while the gesture runs. React
    // considers it to live there now, so dragging it back to the old main Layer would leave the
    // wrapper outside its clip after cancellation. Anything no longer in the drag Layer has been
    // claimed by someone else.
    const target = addSelectedNode(scene.mainLayer);
    const newOwner = new studioKonvaRuntime.Group();
    scene.mainLayer.add(newOwner);

    const session = beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      transformer: null,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    });
    expect(session).not.toBeNull();
    expect(target.getLayer()).toBe(scene.dragLayer);

    // Another owner claims it mid-gesture.
    target.moveTo(newOwner);

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(target.getParent()).toBe(newOwner);
  });

  it("still skips a node destroyed mid-gesture rather than resurrecting it", () => {
    // The other way a node stops being ours: `moveTo` has no destroyed-node guard, so re-adding
    // one would leave an invisible zombie still carrying studioElementId.
    const target = addSelectedNode(scene.mainLayer);
    const session = beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      transformer: null,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    });
    expect(session).not.toBeNull();

    target.remove();

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(target.getParent()).toBeNull();
  });

  it("keeps grouped and backdrop-sensitive movement on the authoritative main Layer", () => {
    const target = addSelectedNode(scene.mainLayer);

    expect(beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 2,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    })).toBeNull();
    expect(beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      layerSensitiveComposite: true,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    })).toBeNull();
    expect(target.getLayer()).toBe(scene.mainLayer);
  });

  it("does not lift an unselected node or a Transformer anchor descendant", () => {
    const target = addSelectedNode(scene.mainLayer);
    const transformer = new studioKonvaRuntime.Transformer();
    scene.mainLayer.add(transformer);
    transformer.nodes([target]);
    const anchor = transformer.findOne(".top-left");

    expect(beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "another-object",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    })).toBeNull();
    if (anchor) {
      expect(beginStudioSingleObjectDragLayer({
        target: anchor,
        selectedElementId: "object-1",
        selectionSize: 1,
        mainLayer: scene.mainLayer,
        dragLayer: scene.dragLayer,
        selectedIsDraw: false,
        hasMaskOrClip: false,
      })).toBeNull();
    }
  });

  it("leaves draw and parent-clipped nodes on the main Layer", () => {
    const draw = addSelectedNode(scene.mainLayer, "draw-1");
    expect(beginStudioSingleObjectDragLayer({
      target: draw,
      selectedElementId: "draw-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      selectedIsDraw: true,
      hasMaskOrClip: false,
    })).toBeNull();

    const wrapper = new studioKonvaRuntime.Group();
    const clipped = new studioKonvaRuntime.Group({ draggable: true });
    clipped.setAttr("studioElementId", "clipped-1");
    wrapper.add(clipped);
    scene.mainLayer.add(wrapper);
    expect(beginStudioSingleObjectDragLayer({
      target: clipped,
      selectedElementId: "clipped-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    })).toBeNull();
    expect(clipped.getLayer()).toBe(scene.mainLayer);
  });

  it("keeps document-local bounds stable under Stage pan and zoom", () => {
    scene.stage.position({ x: 93, y: -41 });
    scene.stage.scale({ x: 1.75, y: 1.75 });
    const target = addSelectedNode(scene.mainLayer);
    const peer = new studioKonvaRuntime.Rect({ x: 180, y: 145, width: 70, height: 55 });
    scene.mainLayer.add(peer);

    const session = beginStudioSingleObjectDragLayer({
      target,
      selectedElementId: "object-1",
      selectionSize: 1,
      mainLayer: scene.mainLayer,
      dragLayer: scene.dragLayer,
      selectedIsDraw: false,
      hasMaskOrClip: false,
    });

    expect(session).not.toBeNull();
    expect(target.getClientRect({ relativeTo: target.getLayer()! })).toMatchObject({
      x: 20,
      y: 30,
      width: 40,
      height: 25,
    });
    expect(peer.getClientRect({ relativeTo: peer.getLayer()! })).toMatchObject({
      x: 180,
      y: 145,
      width: 70,
      height: 55,
    });

    const beforeRestore = target.getAbsolutePosition();
    restoreStudioSingleObjectDragLayer(session);
    expect(target.getAbsolutePosition()).toEqual(beforeRestore);
    expect(target.getClientRect({ relativeTo: scene.mainLayer })).toMatchObject({
      x: 20,
      y: 30,
      width: 40,
      height: 25,
    });
  });

  it("restores before the element commit and keeps Stage fallbacks wired", () => {
    const patchWrapperStart = studioCanvasViewportSource.indexOf(
      "function patchElementAfterDragRestore(id: string, patch: Partial<El>)",
    );
    const patchWrapperEnd = studioCanvasViewportSource.indexOf(
      "function beginSingleObjectDragLayer",
      patchWrapperStart,
    );
    const patchWrapper = studioCanvasViewportSource.slice(
      patchWrapperStart,
      patchWrapperEnd,
    );

    expect(patchWrapperStart).toBeGreaterThan(-1);
    expect(patchWrapper.indexOf("restoreSingleObjectDragLayer();")).toBeLessThan(
      patchWrapper.indexOf("patchEl(id, patch);")
    );
    expect(studioCanvasViewportSource).toContain(
      "onDragStart={beginSingleObjectDragLayer}",
    );
    expect(studioCanvasViewportSource).toContain(
      "onDragEnd={finishSingleObjectDragLayer}",
    );
    expect(studioCanvasViewportSource).toContain(
      "onPointerCancel={cancelSingleObjectDragLayer}",
    );
    expect(studioCanvasViewportSource).toContain(
      'name="studio-single-object-drag-layer"',
    );
    expect(studioCanvasViewportSource).not.toContain(
      'name="studio-single-object-drag-layer" listening={false}',
    );
  });

  it("fails draw-body drag closed before acquiring a page lease during setup recovery", () => {
    const drawStart = studioCanvasViewportSource.indexOf(
      "onDragStart={(event) => {",
      studioCanvasViewportSource.indexOf("const liveEl ="),
    );
    const drawEnd = studioCanvasViewportSource.indexOf(
      "onDragEnd={(event) => {",
      drawStart,
    );
    const handler = studioCanvasViewportSource.slice(drawStart, drawEnd);

    const recoveryGate = handler.indexOf(
      "studioKonvaDrawTransformRecoveryPendingForElement(el.id)",
    );
    const pageLease = handler.indexOf("nodeInteractionBegin(el.id)");
    expect(drawStart).toBeGreaterThan(-1);
    expect(drawEnd).toBeGreaterThan(drawStart);
    expect(recoveryGate).toBeGreaterThan(-1);
    expect(recoveryGate).toBeLessThan(pageLease);
    expect(handler.slice(recoveryGate, pageLease)).toContain("event.target.stopDrag()");
  });
});

describe("single-draw transform gesture Layer lift", () => {
  function addTransformScene(parent: Konva.Container = scene.mainLayer) {
    const wrapper = addSelectedNode(parent, "stroke-1");
    const proxy = new studioKonvaRuntime.Rect({ x: 10, y: 20, width: 100, height: 50 });
    scene.mainLayer.add(proxy);
    const transformer = new studioKonvaRuntime.Transformer();
    scene.mainLayer.add(transformer);
    transformer.nodes([proxy]);
    return { wrapper, proxy, transformer };
  }

  it("keeps the source in the document Layer until an admitted frame claims it", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const originalOrder = [...scene.mainLayer.getChildren()];
    const originalPositions = new Map(
      originalOrder.map((node) => [node, node.getAbsolutePosition()]),
    );
    const mainReceipt = vi.spyOn(scene.mainLayer, "drawScene");
    const dragReceipt = vi.spyOn(scene.dragLayer, "drawScene");

    const chromeSession = beginStudioSingleDrawTransformChromeLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });

    expect(chromeSession).not.toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);
    expect(mainReceipt).toHaveBeenCalledTimes(1);
    expect(dragReceipt).toHaveBeenCalledTimes(1);
    expect(mainReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      dragReceipt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    mainReceipt.mockClear();
    dragReceipt.mockClear();

    const sourceSession = beginStudioSingleDrawTransformSourceLayer({
      elementId: "stroke-1",
      wrapper,
      transformer,
      dragLayer: scene.dragLayer,
    });

    expect(sourceSession).not.toBeNull();
    expect(wrapper.getLayer()).toBe(scene.dragLayer);
    expect(proxy.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);
    expect(mainReceipt).toHaveBeenCalledTimes(1);
    expect(dragReceipt).toHaveBeenCalledTimes(1);
    expect(mainReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      dragReceipt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    mainReceipt.mockClear();
    dragReceipt.mockClear();

    expect(restoreStudioSingleObjectDragLayer(sourceSession)).toBe(true);
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);
    expect(mainReceipt).toHaveBeenCalledTimes(1);
    expect(dragReceipt).toHaveBeenCalledTimes(1);
    expect(mainReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      dragReceipt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );

    mainReceipt.mockClear();
    dragReceipt.mockClear();

    expect(restoreStudioSingleObjectDragLayer(chromeSession)).toBe(true);
    expect([...scene.mainLayer.getChildren()]).toEqual(originalOrder);
    for (const node of originalOrder) {
      expect(node.getAbsolutePosition()).toEqual(originalPositions.get(node));
    }
    expect(mainReceipt).toHaveBeenCalledTimes(1);
    expect(dragReceipt).toHaveBeenCalledTimes(1);
    expect(mainReceipt.mock.invocationCallOrder[0]).toBeLessThan(
      dragReceipt.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("restores admitted source ownership to the stable reserved shadow", () => {
    const shadow = addDocumentShadow(0);
    const earlierPeer = new studioKonvaRuntime.Rect({ width: 20, height: 20 });
    shadow.add(earlierPeer);
    const { wrapper, proxy, transformer } = addTransformScene(shadow);
    const shadowOrder = [...shadow.getChildren()];

    const chromeSession = beginStudioSingleDrawTransformChromeLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(chromeSession).not.toBeNull();
    expect(wrapper.getParent()).toBe(shadow);

    const sourceSession = beginStudioSingleDrawTransformSourceLayer({
      elementId: "stroke-1",
      wrapper,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(sourceSession).not.toBeNull();
    expect(wrapper.getParent()).toBe(scene.dragLayer);
    expect(shadow.getParent()).toBe(scene.mainLayer);
    expect(earlierPeer.getParent()).toBe(shadow);

    expect(restoreStudioSingleObjectDragLayer(sourceSession)).toBe(true);
    expect(wrapper.getParent()).toBe(shadow);
    expect([...shadow.getChildren()]).toEqual(shadowOrder);
    expect(restoreStudioSingleObjectDragLayer(chromeSession)).toBe(true);
  });

  it("refuses an admitted source claim without disturbing isolated chrome", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const authoredPaint = new studioKonvaRuntime.Rect({
      x: 160,
      y: 120,
      width: 50,
      height: 50,
      fill: "#ff00ff",
    });
    // Move real authored paint above the wrapper while keeping the gesture chrome later still.
    scene.mainLayer.add(authoredPaint);
    authoredPaint.zIndex(wrapper.zIndex() + 1);

    const chromeSession = beginStudioSingleDrawTransformChromeLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });

    expect(chromeSession).not.toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);

    expect(beginStudioSingleDrawTransformSourceLayer({
      elementId: "stroke-1",
      wrapper,
      transformer,
      dragLayer: scene.dragLayer,
    })).toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(authoredPaint.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);

    expect(restoreStudioSingleObjectDragLayer(chromeSession)).toBe(true);
    expect(proxy.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);
  });

  it("keeps a synchronous source receipt retryable after structural restore completes", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const chromeSession = beginStudioSingleDrawTransformChromeLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    const sourceSession = beginStudioSingleDrawTransformSourceLayer({
      elementId: "stroke-1",
      wrapper,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(chromeSession).not.toBeNull();
    expect(sourceSession).not.toBeNull();

    const drawDrag = scene.dragLayer.drawScene.bind(scene.dragLayer);
    let remainingFailures = 3;
    const failedDragReceipt = vi.spyOn(scene.dragLayer, "drawScene").mockImplementation(() => {
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        throw new Error("drag Layer receipt failed");
      }
      return drawDrag();
    });

    expect(restoreStudioSingleObjectDragLayer(sourceSession)).toBe(false);
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(sourceSession?.restored).toBe(false);
    expect(remainingFailures).toBe(0);
    expect(studioSingleObjectDragLayerRecoveryPendingForElement("stroke-1")).toBe(true);

    expect(restoreStudioSingleObjectDragLayer(sourceSession)).toBe(true);
    expect(sourceSession?.restored).toBe(true);
    expect(studioSingleObjectDragLayerRecoveryPendingForElement("stroke-1")).toBe(false);
    expect(restoreStudioSingleObjectDragLayer(chromeSession)).toBe(true);
    failedDragReceipt.mockRestore();
  });

  it("lifts stroke, proxy and Transformer together and restores order and position", () => {
    const unrelated = new studioKonvaRuntime.Group();
    scene.mainLayer.add(unrelated);
    const { wrapper, proxy, transformer } = addTransformScene();
    const originalOrder = [...scene.mainLayer.getChildren()];

    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });

    expect(session).not.toBeNull();
    expect(wrapper.getLayer()).toBe(scene.dragLayer);
    expect(proxy.getLayer()).toBe(scene.dragLayer);
    expect(transformer.getLayer()).toBe(scene.dragLayer);
    expect(unrelated.getLayer()).toBe(scene.mainLayer);

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);
    expect([...scene.mainLayer.getChildren()]).toEqual(originalOrder);
  });

  it("restores an atomic transform lift to the reserved shadow parent", () => {
    const shadow = addDocumentShadow();
    const { wrapper, proxy, transformer } = addTransformScene(shadow);

    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });

    expect(session).not.toBeNull();
    expect(wrapper.getParent()).toBe(scene.dragLayer);
    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(wrapper.getParent()).toBe(shadow);
    expect(proxy.getParent()).toBe(scene.mainLayer);
    expect(transformer.getParent()).toBe(scene.mainLayer);
  });

  it("rolls back nodes already moved when a later moveTo fails", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    vi.spyOn(proxy, "moveTo").mockImplementation(() => {
      throw new Error("proxy move failed");
    });

    expect(() => beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    })).toThrow("proxy move failed");
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);
  });

  it("rolls back all three nodes when the final move mutates and then throws", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const moveTransformer = transformer.moveTo.bind(transformer);
    vi.spyOn(transformer, "moveTo").mockImplementation((container) => {
      moveTransformer(container);
      throw new Error("transformer move failed after mutation");
    });

    expect(() => beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    })).toThrow();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
    expect(proxy.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);
  });

  it.each(["position", "z-index"] as const)(
    "phase-retries a one-shot %s failure during setup rollback",
    (failure) => {
      const { wrapper, proxy, transformer } = addTransformScene();
      const expectedPosition = wrapper.getAbsolutePosition();
      const expectedIndex = wrapper.zIndex();
      vi.spyOn(proxy, "moveTo").mockImplementation(() => {
        throw new Error("proxy move failed");
      });

      let shouldFail = true;
      if (failure === "position") {
        const absolutePosition = wrapper.absolutePosition.bind(wrapper);
        vi.spyOn(wrapper, "absolutePosition").mockImplementation((
          ((position?: { x: number; y: number }) => {
            if (
              position !== undefined
              && wrapper.getParent() === scene.mainLayer
              && shouldFail
            ) {
              shouldFail = false;
              throw new Error("rollback position failed once");
            }
            return position === undefined
              ? absolutePosition()
              : absolutePosition(position);
          }) as typeof wrapper.absolutePosition
        ));
      } else {
        const zIndex = wrapper.zIndex.bind(wrapper);
        vi.spyOn(wrapper, "zIndex").mockImplementation((
          ((index?: number) => {
            if (index !== undefined && wrapper.getParent() === scene.mainLayer && shouldFail) {
              shouldFail = false;
              throw new Error("rollback z-index failed once");
            }
            return index === undefined ? zIndex() : zIndex(index);
          }) as typeof wrapper.zIndex
        ));
      }

      expect(() => beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      })).toThrow("proxy move failed");
      expect(wrapper.getLayer()).toBe(scene.mainLayer);
      expect(wrapper.getAbsolutePosition()).toEqual(expectedPosition);
      expect(wrapper.zIndex()).toBe(expectedIndex);
      expect(shouldFail).toBe(false);
    },
  );

  it("retains setup rollback ownership after three failures and recovers from the host queue", () => {
    vi.useFakeTimers();
    const { wrapper, proxy, transformer } = addTransformScene();
    const moveWrapper = wrapper.moveTo.bind(wrapper);
    const brokenSetup = vi.spyOn(proxy, "moveTo").mockImplementation(() => {
      throw new Error("proxy move failed");
    });
    let remainingHomeFailures = 3;
    const brokenRestore = vi.spyOn(wrapper, "moveTo").mockImplementation((container) => {
      if (container === scene.mainLayer && remainingHomeFailures > 0) {
        remainingHomeFailures -= 1;
        throw new Error("wrapper restore failed");
      }
      return moveWrapper(container);
    });

    try {
      expect(() => beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      })).toThrow("Studio Layer lift failed and rollback was incomplete");
      expect(remainingHomeFailures).toBe(0);
      expect(wrapper.getLayer()).toBe(scene.dragLayer);
      expect(studioSingleObjectDragLayerRecoveryPendingForElement("stroke-1")).toBe(true);

      vi.advanceTimersByTime(16);
      expect(wrapper.getLayer()).toBe(scene.mainLayer);
      expect(proxy.getLayer()).toBe(scene.mainLayer);
      expect(transformer.getLayer()).toBe(scene.mainLayer);
      expect(studioSingleObjectDragLayerRecoveryPendingForElement("stroke-1")).toBe(false);
    } finally {
      brokenRestore.mockRestore();
      brokenSetup.mockRestore();
      vi.useRealTimers();
    }
  });

  it("rolls back ownership when forceUpdate or either Layer redraw fails", () => {
    vi.useFakeTimers();
    try {
      for (const failure of ["forceUpdate", "batchDraw"] as const) {
        const { wrapper, proxy, transformer } = addTransformScene();
        let failureSpy: ReturnType<typeof vi.spyOn>;
        if (failure === "forceUpdate") {
          failureSpy = vi.spyOn(transformer, "forceUpdate").mockImplementation(() => {
            throw new Error("forceUpdate failed");
          });
        } else {
          failureSpy = vi.spyOn(scene.mainLayer, "batchDraw").mockImplementation(() => {
            throw new Error("main Layer draw failed");
          });
        }

        expect(() => beginStudioSingleDrawTransformLayer({
          elementId: "stroke-1",
          wrapper,
          proxy,
          transformer,
          dragLayer: scene.dragLayer,
        }), failure).toThrow();
        expect(wrapper.getLayer(), failure).toBe(scene.mainLayer);
        expect(proxy.getLayer(), failure).toBe(scene.mainLayer);
        expect(transformer.getLayer(), failure).toBe(scene.mainLayer);
        expect(studioSingleObjectDragLayerRecoveryPendingForElement("stroke-1")).toBe(true);

        // Structural restoration has completed, but the failed Transformer/Layer acknowledgement
        // remains a presentation lease until a host pass succeeds. Clear it before reusing the
        // shared drag Layer for the next fixture.
        failureSpy.mockRestore();
        vi.advanceTimersByTime(16);
        expect(studioSingleObjectDragLayerRecoveryPendingForElement("stroke-1")).toBe(false);
        wrapper.destroy();
        proxy.destroy();
        transformer.destroy();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores healthy records despite one broken position read and can retry the remainder", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(session).not.toBeNull();
    const brokenRead = vi.spyOn(wrapper, "getAbsolutePosition").mockImplementation(() => {
      throw new Error("wrapper position unavailable");
    });

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(false);
    expect(wrapper.getLayer()).toBe(scene.dragLayer);
    expect(proxy.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);

    brokenRead.mockRestore();
    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
  });

  it("retries immediately after moveTo reaches home and then throws during restore", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(session).not.toBeNull();
    const moveHome = wrapper.moveTo.bind(wrapper);
    const brokenMove = vi.spyOn(wrapper, "moveTo").mockImplementation((container) => {
      moveHome(container);
      if (container === scene.mainLayer) throw new Error("moved home then failed");
      return wrapper;
    });

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(wrapper.getParent()).toBe(scene.mainLayer);
    brokenMove.mockRestore();
  });

  it("does not reclaim a node externally reparented after a non-mutating move failure", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(session).not.toBeNull();
    const moveHome = wrapper.moveTo.bind(wrapper);
    const brokenMove = vi.spyOn(wrapper, "moveTo").mockImplementation((container) => {
      if (container === scene.mainLayer) throw new Error("move failed before mutation");
      return moveHome(container);
    });

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(false);
    brokenMove.mockRestore();
    moveHome(scene.mainLayer);
    wrapper.absolutePosition({ x: 333, y: 444 });
    const externallyOwnedIndex = wrapper.zIndex();

    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);
    expect(wrapper.getAbsolutePosition()).toEqual({ x: 333, y: 444 });
    expect(wrapper.zIndex()).toBe(externallyOwnedIndex);
  });

  it("retries absolute-position and z-index phases after the node is already home", () => {
    const exercise = (failure: "position" | "z-index") => {
      const { wrapper, proxy, transformer } = addTransformScene();
      const expectedIndex = wrapper.zIndex();
      const expectedPosition = wrapper.getAbsolutePosition();
      const session = beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      });
      expect(session).not.toBeNull();

      let shouldFail = true;
      let failureSpy: ReturnType<typeof vi.spyOn>;
      if (failure === "position") {
        const absolutePosition = wrapper.absolutePosition.bind(wrapper);
        failureSpy = vi.spyOn(wrapper, "absolutePosition").mockImplementation((
          ((position?: { x: number; y: number }) => {
            if (position !== undefined && shouldFail) {
              shouldFail = false;
              throw new Error("position restore failed");
            }
            return position === undefined
              ? absolutePosition()
              : absolutePosition(position);
          }) as typeof wrapper.absolutePosition
        ));
      } else {
        const zIndex = wrapper.zIndex.bind(wrapper);
        failureSpy = vi.spyOn(wrapper, "zIndex").mockImplementation((
          ((index?: number) => {
            if (index !== undefined && shouldFail) {
              shouldFail = false;
              throw new Error("z-index restore failed");
            }
            return index === undefined ? zIndex() : zIndex(index);
          }) as typeof wrapper.zIndex
        ));
      }

      expect(restoreStudioSingleObjectDragLayer(session), failure).toBe(true);
      expect(wrapper.getParent(), failure).toBe(scene.mainLayer);
      expect(wrapper.getAbsolutePosition(), failure).toEqual(expectedPosition);
      expect(wrapper.zIndex(), failure).toBe(expectedIndex);
      failureSpy.mockRestore();
      wrapper.destroy();
      proxy.destroy();
      transformer.destroy();
    };

    exercise("position");
    exercise("z-index");
  });

  it("refuses a stroke whose backdrop-sensitive composite lives on a DESCENDANT shape", () => {
    // StudioDrawNode hangs globalCompositeOperation on the shapes it emits — a highlighter's
    // multiply passes are children of the wrapper, not the wrapper itself. Lifting those onto an
    // empty Layer would blend them against transparency instead of the artwork underneath.
    const { wrapper, proxy, transformer } = addTransformScene();
    const paint = new studioKonvaRuntime.Group();
    const multiplyPass = new studioKonvaRuntime.Rect({ width: 10, height: 10 });
    multiplyPass.setAttr("globalCompositeOperation", "multiply");
    paint.add(multiplyPass);
    wrapper.add(paint);

    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);

    // A plain source-over descendant must still lift — the guard rejects blending, not depth.
    multiplyPass.setAttr("globalCompositeOperation", "source-over");
    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).not.toBeNull();
  });

  it("refuses when a later sibling depends on the stroke staying below it", () => {
    // The drag Layer paints after the whole document Layer, so a lifted stroke rides above every
    // later sibling. An eraser stroke above it (destination-out) would stop erasing it entirely:
    // the erased pixels would reappear for the gesture and vanish again at commit.
    const { wrapper, proxy, transformer } = addTransformScene();
    const eraserAbove = new studioKonvaRuntime.Group();
    eraserAbove.setAttr("globalCompositeOperation", "destination-out");
    scene.mainLayer.add(eraserAbove);
    expect(eraserAbove.zIndex()).toBeGreaterThan(wrapper.zIndex());

    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);

    // The same eraser BELOW the stroke cannot be affected by the lift, so it still lifts.
    eraserAbove.zIndex(0);
    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).not.toBeNull();
  });

  it("refuses an exact lift below an ordinary visible authored sibling", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const opaqueSiblingAbove = new studioKonvaRuntime.Rect({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fill: "white",
    });
    scene.mainLayer.add(opaqueSiblingAbove);
    expect(opaqueSiblingAbove.zIndex()).toBeGreaterThan(wrapper.zIndex());

    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);

    // A sibling below the stroke keeps the same order when the stroke moves to the later Layer.
    opaqueSiblingAbove.zIndex(0);
    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).not.toBeNull();
  });

  it("keeps Vello-painted sibling order even while the reserved shadow is transparent", () => {
    const shadow = addDocumentShadow(0);
    const { wrapper, proxy, transformer } = addTransformScene(shadow);
    const opaqueSiblingAbove = new studioKonvaRuntime.Rect({
      width: 40,
      height: 40,
      fill: "white",
    });
    shadow.add(opaqueSiblingAbove);

    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
    expect(wrapper.getParent()).toBe(shadow);
  });

  it("distinguishes a parked overlay shell from paint inside that shell", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const overlayShell = new studioKonvaRuntime.Group();
    const indicator = new studioKonvaRuntime.Rect({
      width: 40,
      height: 40,
      fill: "white",
      visible: false,
    });
    overlayShell.add(indicator);
    scene.mainLayer.add(overlayShell);
    expect(overlayShell.visible()).toBe(true);
    expect(overlayShell.zIndex()).toBeGreaterThan(wrapper.zIndex());

    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(session).not.toBeNull();
    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);

    // Once the child can paint, moving the stroke to the later Layer would invert real z-order.
    indicator.visible(true);
    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
  });

  it("allows an explicitly non-painting transient carrier above the stroke", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    // Production keeps one general Transformer mounted after the draw-specific live proxy. It has
    // nodes([]) for Draw selections and therefore paints no pixels, despite visible() === true.
    const emptyDraftCarrier = new studioKonvaRuntime.Transformer();
    emptyDraftCarrier.setAttr(STUDIO_LIVE_TRANSFORM_Z_ORDER_EXEMPT_ATTR, true);
    scene.mainLayer.add(emptyDraftCarrier);

    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).not.toBeNull();
  });

  it("never re-adds a node React destroyed or re-parented mid-gesture", () => {
    const { wrapper, proxy, transformer } = addTransformScene();
    const session = beginStudioSingleDrawTransformLayer({
      elementId: "stroke-1",
      wrapper,
      proxy,
      transformer,
      dragLayer: scene.dragLayer,
    });
    expect(session).not.toBeNull();

    // What react-konva's removeChild does when a collaborator deletes the stroke mid-gesture.
    wrapper.destroy();
    expect(restoreStudioSingleObjectDragLayer(session)).toBe(true);

    // The zombie must not come back as a main-Layer child carrying studioElementId.
    const strokeChildren = scene.mainLayer
      .getChildren()
      .filter((node) => (node as Konva.Node).getAttr("studioElementId") === "stroke-1");
    expect(strokeChildren).toEqual([]);
    // Its gesture chrome still returns home.
    expect(proxy.getLayer()).toBe(scene.mainLayer);
    expect(transformer.getLayer()).toBe(scene.mainLayer);
  });

  it("refuses without a drag Layer, for clipped wrappers, and for backdrop-sensitive strokes", () => {
    const { wrapper, proxy, transformer } = addTransformScene();

    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: null,
      }),
    ).toBeNull();

    // 지우개(destination-out)는 문서 backdrop이 필요하므로 리프트 금지 — 오늘의 동작 유지.
    wrapper.setAttr("globalCompositeOperation", "destination-out");
    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
    wrapper.setAttr("globalCompositeOperation", undefined);

    // 패널 클립 래퍼(레이어 직계가 아님)도 리프트 금지.
    const clipGroup = new studioKonvaRuntime.Group({ clipX: 0, clipY: 0, clipWidth: 10, clipHeight: 10 });
    scene.mainLayer.add(clipGroup);
    wrapper.moveTo(clipGroup);
    expect(
      beginStudioSingleDrawTransformLayer({
        elementId: "stroke-1",
        wrapper,
        proxy,
        transformer,
        dragLayer: scene.dragLayer,
      }),
    ).toBeNull();
    expect(wrapper.getLayer()).toBe(scene.mainLayer);
  });

  it("refuses a concurrent wrapper drag while the preview owns the node, in both drag phases", () => {
    // The wrapper's drag-end bakes `event.target.x()/y()` into `points` as a DELTA, but a live
    // preview parks the gesture's ABSOLUTE target origin there. A second finger dragging the
    // stroke body while the first holds an anchor would otherwise commit that projection as a
    // document translation. Source-scanned: the guard lives in the document layer's JSX.
    const drawWrapperStart = studioCanvasViewportSource.indexOf(
      "onDragStart={(event) => {",
    );
    const drawWrapperEnd = studioCanvasViewportSource.indexOf(
      "<StudioDrawNode",
      drawWrapperStart,
    );
    expect(drawWrapperStart).toBeGreaterThan(-1);
    expect(drawWrapperEnd).toBeGreaterThan(drawWrapperStart);
    const dragHandlers = studioCanvasViewportSource.slice(drawWrapperStart, drawWrapperEnd);

    // Both phases guard, and the bake stays behind the guard.
    expect(
      dragHandlers.split("STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR").length - 1,
    ).toBe(2);
    expect(
      dragHandlers.lastIndexOf("STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR"),
    ).toBeLessThan(dragHandlers.indexOf("patchEl(el.id, {"));
    expect(dragHandlers).toContain("event.target.stopDrag();");
  });

  it("refuses the preview when a cached duplicate of the same stroke exists", async () => {
    // clipBelow renders the stroke twice: the visible node, and a copy inside a cached
    // ClipMaskGroup acting as the upper element's mask. Driving only the visible one would leave
    // the clipped artwork above at the old geometry until commit.
    const { studioLiveTransformPreviewHasCachedDuplicate } = await import(
      "./studio-live-transform-preview-konva"
    );
    const wrapper = addSelectedNode(scene.mainLayer, "stroke-1");

    expect(
      studioLiveTransformPreviewHasCachedDuplicate(scene.stage, "stroke-1", wrapper),
    ).toBe(false);

    const maskSandwich = new studioKonvaRuntime.Group();
    const maskCopy = new studioKonvaRuntime.Group();
    maskCopy.setAttr("studioElementId", "stroke-1");
    maskSandwich.add(maskCopy);
    scene.mainLayer.add(maskSandwich);
    // ClipMaskGroup caches its sandwich; jsdom's stubbed canvas makes a real cache() a no-op, so
    // the cached state is declared directly — the logic under test is the ancestor walk.
    vi.spyOn(maskSandwich, "isCached").mockReturnValue(true);

    expect(
      studioLiveTransformPreviewHasCachedDuplicate(scene.stage, "stroke-1", wrapper),
    ).toBe(true);
  });

  it("gates translation mirrors while the preview-active attr is set and resumes after", () => {
    const { wrapper } = addTransformScene();
    const applied: Array<{ x: number; y: number }> = [];
    const detach = mirrorStudioDrawElementTranslation(scene.stage, "stroke-1", (offset) => {
      applied.push(offset);
    });
    expect(applied).toHaveLength(1); // immediate sync on subscribe

    wrapper.setAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR, true);
    wrapper.position({ x: 140, y: 90 });
    expect(applied).toHaveLength(1); // preview frames are not drag offsets

    wrapper.setAttr(STUDIO_LIVE_TRANSFORM_PREVIEW_ACTIVE_ATTR, undefined);
    wrapper.position({ x: 0, y: 0 });
    expect(applied.length).toBeGreaterThan(1);
    expect(applied.at(-1)).toEqual({ x: 0, y: 0 });
    detach();
  });
});
