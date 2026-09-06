// @vitest-environment jsdom

/**
 * Panel-clip tracking against a REAL Konva scene graph, because the whole mechanism is a claim
 * about Konva's own clip semantics: that a clip is attrs on a container rather than a parent, so
 * re-pointing one needs no reparenting. A fake node would assert my belief about Konva instead.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { studioKonvaRuntime } from "./render/studio-konva-runtime";
import { studioLiveTransformCommittedClip } from "./studio-live-transform-clip-tracking";
import {
  applyStudioLiveTransformClip,
  findStudioLiveTransformClipHost,
  readStudioLiveTransformClip,
  restoreStudioLiveTransformClip,
  STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR,
} from "./studio-live-transform-clip-tracking-konva";

import type { El } from "./studio-element-model";
import type Konva from "konva";

function installCanvasContextStub(): () => void {
  const prototype = globalThis.HTMLCanvasElement.prototype as unknown as { getContext: unknown };
  const original = prototype.getContext;
  prototype.getContext = () =>
    new Proxy(
      { canvas: null },
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

const PANEL = {
  id: "frame-1",
  type: "frame",
  x: 0,
  y: 0,
  width: 200,
  height: 200,
} as unknown as El;

describe("live transform panel-clip tracking (Konva)", () => {
  let stage: Konva.Stage;
  let mainLayer: Konva.Layer;
  let dragLayer: Konva.Layer;
  let container: HTMLDivElement;
  let restoreCanvas: () => void;

  beforeEach(() => {
    restoreCanvas = installCanvasContextStub();
    container = document.createElement("div");
    document.body.appendChild(container);
    stage = new studioKonvaRuntime.Stage({ container, width: 720, height: 1020 });
    mainLayer = new studioKonvaRuntime.Layer();
    dragLayer = new studioKonvaRuntime.Layer();
    stage.add(mainLayer);
    stage.add(dragLayer);
  });

  afterEach(() => {
    stage.destroy();
    container.remove();
    restoreCanvas();
  });

  /** A panel member: wrapper inside the per-element clip Group the document layer renders. */
  function addClippedStroke(): { wrapper: Konva.Group; clipGroup: Konva.Group } {
    const clipGroup = new studioKonvaRuntime.Group({
      clipX: 0,
      clipY: 0,
      clipWidth: 200,
      clipHeight: 200,
    });
    const wrapper = new studioKonvaRuntime.Group({ x: 0, y: 0, draggable: true });
    wrapper.setAttr("studioElementId", "draw-1");
    clipGroup.add(wrapper);
    mainLayer.add(clipGroup);
    return { wrapper, clipGroup };
  }

  /** A free stroke: wrapper straight on the main Layer, with no clip Group anywhere. */
  function addUnclippedStroke(): Konva.Group {
    const wrapper = new studioKonvaRuntime.Group({ x: 0, y: 0, draggable: true });
    wrapper.setAttr("studioElementId", "draw-1");
    mainLayer.add(wrapper);
    return wrapper;
  }

  it("hosts the clip on the per-element Group for a stroke that starts INSIDE a panel", () => {
    const { wrapper, clipGroup } = addClippedStroke();

    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
    expect(host).toEqual({ node: clipGroup, mode: "attrs" });
    expect(readStudioLiveTransformClip(host)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
  });

  it("drops the clip when the gesture carries the stroke OUT of its panel", () => {
    const { wrapper, clipGroup } = addClippedStroke();
    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
    const original = readStudioLiveTransformClip(host);

    // Target box well outside the 200x200 panel — the commit will not clip this.
    const verdict = studioLiveTransformCommittedClip({
      targetBounds: { x: 400, y: 400, width: 40, height: 40 },
      rotationDeg: 0,
      elements: [PANEL],
    });
    expect(verdict).toBeNull();
    expect(applyStudioLiveTransformClip(host, verdict)).toBe(true);
    expect(readStudioLiveTransformClip(host)).toBeNull();

    // …and the gesture ending puts the document back exactly as it was.
    expect(restoreStudioLiveTransformClip(host, original)).toBe(true);
    expect(readStudioLiveTransformClip(host)).toEqual(original);
    expect(clipGroup.getAttr(STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR)).toBeUndefined();
  });

  it("adds the clip on the WRAPPER when the gesture carries a free stroke INTO a panel", () => {
    // The case the in-place path cannot serve: an unclipped stroke renders with no clip Group at
    // all, so the lift is what gives us a node to drive — and it must be the wrapper, not the drag
    // Layer, which also holds the proxy and the Transformer steering the gesture.
    const wrapper = addUnclippedStroke();
    wrapper.moveTo(dragLayer);
    // Stands in for the proxy and Transformer the lift moves onto this Layer alongside the ink.
    // A real Transformer needs a canvas the jsdom stub cannot provide; what matters here is only
    // that the gesture chrome shares the Layer, so a Layer clip would swallow it.
    dragLayer.add(new studioKonvaRuntime.Group());

    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
    expect(host).toEqual({ node: wrapper, mode: "func" });
    expect(readStudioLiveTransformClip(host)).toBeNull();

    const verdict = studioLiveTransformCommittedClip({
      targetBounds: { x: 80, y: 80, width: 20, height: 20 },
      rotationDeg: 0,
      elements: [PANEL],
    });
    expect(applyStudioLiveTransformClip(host, verdict)).toBe(true);
    expect(readStudioLiveTransformClip(host)).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
    // The gesture chrome shares the drag Layer, so clipping it would swallow handles that are
    // still controlling the gesture. Only the wrapper carries the clip.
    expect(dragLayer.getAttr("clipWidth") ?? 0).toBe(0);
    expect(typeof wrapper.clipFunc()).toBe("function");

    // Restoring must clear it: React never wrote this `clipFunc`, so leaving one behind would clip
    // the stroke by a panel rect that no longer tracks anything.
    expect(restoreStudioLiveTransformClip(host, null)).toBe(true);
    expect(wrapper.clipFunc()).toBeUndefined();
  });

  it("paths the clip through the wrapper's own transform, so a scaled preview still clips right",
    () => {
      // The wrapper's local space is not document space — the preview writes position, scale and
      // rotation onto it every frame — so a `clipFunc` has to map the panel rect back through the
      // node's transform. At scale 2 about the origin, a 200-wide panel is 100 wide in local units.
      const wrapper = addUnclippedStroke();
      wrapper.moveTo(dragLayer);
      wrapper.scaleX(2);
      wrapper.scaleY(2);
      const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
      expect(applyStudioLiveTransformClip(host, { x: 0, y: 0, width: 200, height: 200 })).toBe(true);

      const traced: Array<{ x: number; y: number }> = [];
      const recorder = {
        beginPath: () => undefined,
        moveTo: (x: number, y: number) => traced.push({ x, y }),
        lineTo: (x: number, y: number) => traced.push({ x, y }),
        closePath: () => undefined,
      };
      (wrapper.clipFunc() as unknown as (ctx: typeof recorder) => void)(recorder);
      expect(traced).toEqual([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ]);
    });

  it("writes nothing on the frames where the verdict has not moved", () => {
    // The hot path: this runs per gesture frame, and the panel verdict changes at most once or
    // twice in a whole gesture.
    const { wrapper } = addClippedStroke();
    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
    const same = { x: 0, y: 0, width: 200, height: 200 };

    expect(applyStudioLiveTransformClip(host, same)).toBe(false);
    expect(applyStudioLiveTransformClip(host, { ...same, width: 199 })).toBe(true);
  });

  it("answers no host for a free stroke whose lift was refused", () => {
    // Neither host exists — no clip Group ancestor, and the wrapper never reached the drag Layer.
    // The gesture keeps today's behaviour rather than standing the whole preview down.
    const wrapper = addUnclippedStroke();

    expect(findStudioLiveTransformClipHost(wrapper, dragLayer)).toBeNull();
    expect(applyStudioLiveTransformClip(null, { x: 0, y: 0, width: 1, height: 1 })).toBe(false);
  });

  it("never restores a host it did not take over", () => {
    // Same rule the parked-chrome restore follows: a clip the product changed for its own reasons
    // during the gesture must not be clobbered on the way out.
    const { wrapper } = addClippedStroke();
    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);

    expect(restoreStudioLiveTransformClip(host, null)).toBe(false);
    expect(readStudioLiveTransformClip(host)).not.toBeNull();
  });

  it("re-baselines when a later frame writes after another owner changed the clip", () => {
    // The sequence the plain divergence check misses: the collaborator resizes the frame, then the
    // pointer leaves and RE-ENTERS it, so this module writes again. A claim that simply reset
    // itself would restore the stale pre-resize rect at release, leaving the stroke clipped to a
    // frame size that no longer exists.
    const { wrapper, clipGroup } = addClippedStroke();
    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
    const preGesture = readStudioLiveTransformClip(host);
    expect(preGesture).toEqual({ x: 0, y: 0, width: 200, height: 200 });

    // Frame 1: the stroke leaves the panel, so this module clears the clip.
    expect(applyStudioLiveTransformClip(host, null)).toBe(true);

    // A collaborator resizes the frame; React renders the new rect straight onto the same node.
    clipGroup.setAttr("clipX", 0);
    clipGroup.setAttr("clipY", 0);
    clipGroup.setAttr("clipWidth", 320);
    clipGroup.setAttr("clipHeight", 200);

    // Frame 2: the stroke re-enters, so this module writes the new panel rect.
    expect(applyStudioLiveTransformClip(host, { x: 0, y: 0, width: 320, height: 200 })).toBe(false);
    // Frame 3: it leaves again — a real write, on top of the collaborator's value.
    expect(applyStudioLiveTransformClip(host, null)).toBe(true);

    // Release: back to the RESIZED rect, not the 200-wide one the gesture started with.
    expect(restoreStudioLiveTransformClip(host, preGesture)).toBe(true);
    expect(readStudioLiveTransformClip(host)).toEqual({ x: 0, y: 0, width: 320, height: 200 });
  });

  it("leaves a clip another owner rewrote mid-gesture alone", () => {
    // A collaborator resizing the containing frame re-renders the clip `Group` with new props
    // without changing the stroke's identity, so the gesture continues while React installs a
    // newer rect. Restoring the pre-gesture rect over it would revert a change React considers
    // already applied, and a later render with unchanged props would not repair the mutation.
    const { wrapper, clipGroup } = addClippedStroke();
    const host = findStudioLiveTransformClipHost(wrapper, dragLayer);
    const original = readStudioLiveTransformClip(host);
    expect(applyStudioLiveTransformClip(host, { x: 0, y: 0, width: 120, height: 200 })).toBe(true);

    // React re-renders the frame at its new size, straight onto the same node.
    clipGroup.setAttr("clipWidth", 320);

    expect(restoreStudioLiveTransformClip(host, original)).toBe(false);
    expect(readStudioLiveTransformClip(host)).toEqual({ x: 0, y: 0, width: 320, height: 200 });
    expect(clipGroup.getAttr(STUDIO_LIVE_TRANSFORM_CLIP_OWNED_ATTR)).toBeUndefined();
  });
});
