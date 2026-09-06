import { describe, expect, it, vi } from "vitest";

import {
  applyStudioBg3dInsertResult,
  applyStudioVrmInsertResult,
  mapStudioBg3dPerspectiveGuidesToAnchor,
  type ApplyStudioVrmInsertResultInput,
} from "./studio-3d-insert-controller";

import type {
  StudioBackground3DInsertResult,
  StudioVrmPoserInsertResult,
} from "./studio-3d-insert-contract";
import type { StudioEditorMutationTicket } from "../studio-editor-scope";

const mutationTicket: StudioEditorMutationTicket = {
  authScopeKey: "artist-1",
  workId: "work-1",
  accessGeneration: 2,
  documentGeneration: 3,
};

// This controller test treats scene metadata as an opaque identity. The parser/serializer suites
// own the complete scene fixture; cross the type boundary explicitly instead of duplicating it.
const vrmScene = { version: 2 } as unknown as StudioVrmPoserInsertResult["scene"];
const vrmResult: StudioVrmPoserInsertResult = {
  pngDataUrl: "data:image/png;base64,vrm",
  width: 200,
  height: 100,
  scene: vrmScene,
};

const bg3dResult = {
  kind: "separated",
  width: 800,
  height: 600,
  layers: [],
  compositePngDataUrl: "data:image/png;base64,bg3d",
  perspectiveGuides: [],
  bg3dScene: {},
} as unknown as StudioBackground3DInsertResult;

function vrmInput(
  overrides: Partial<ApplyStudioVrmInsertResultInput> = {}
): ApplyStudioVrmInsertResultInput {
  return {
    result: vrmResult,
    mutationTicket,
    admitMutation: vi.fn(() => true),
    resolveTarget: vi.fn(() => undefined),
    patchTarget: vi.fn(() => true),
    appendImage: vi.fn(() => true),
    ...overrides,
  };
}

describe("studio 3D insert controller", () => {
  describe("BG3D perspective guide mapping", () => {
    const guides = [
      { axis: "world-x" as const, x: -0.5, y: 0.25 },
      { axis: "world-z" as const, x: 1.5, y: 0.75 },
    ];

    it("maps normalized vanishing points into an axis-aligned LT anchor", () => {
      expect(mapStudioBg3dPerspectiveGuidesToAnchor(guides, {
        x: 100,
        y: 200,
        width: 400,
        height: 300,
      })).toEqual([
        { axis: "world-x", x: -100, y: 275 },
        { axis: "world-z", x: 700, y: 425 },
      ]);
    });

    it.each([
      { rotation: 1 },
      { flipped: true },
      { flippedY: true },
      { skewX: 0.1 },
      { skewY: -0.1 },
    ])("fails transformed anchors closed: %#", (transform) => {
      expect(mapStudioBg3dPerspectiveGuidesToAnchor(guides, {
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        ...transform,
      })).toEqual([]);
    });

    it("rejects malformed, duplicate-axis, and non-finite guide payloads as one unit", () => {
      const anchor = { x: 0, y: 0, width: 400, height: 300 };
      expect(mapStudioBg3dPerspectiveGuidesToAnchor([
        guides[0]!,
        { ...guides[0]!, x: 0.25 },
      ], anchor)).toEqual([]);
      expect(mapStudioBg3dPerspectiveGuidesToAnchor([
        { axis: "world-y", x: Number.NaN, y: 0 },
      ], anchor)).toEqual([]);
    });
  });

  describe("VRM insertion", () => {
    it("rejects a missing ticket before admission or document effects", () => {
      const admitMutation = vi.fn(() => true);
      const resolveTarget = vi.fn();
      const patchTarget = vi.fn(() => true);
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        mutationTicket: null,
        admitMutation,
        targetElementId: "image-1",
        resolveTarget,
        patchTarget,
        appendImage,
      }))).toBe(false);
      expect(admitMutation).not.toHaveBeenCalled();
      expect(resolveTarget).not.toHaveBeenCalled();
      expect(patchTarget).not.toHaveBeenCalled();
      expect(appendImage).not.toHaveBeenCalled();
    });

    it("rejects failed admission before resolving or mutating a target", () => {
      const order: string[] = [];
      const admitMutation = vi.fn(() => {
        order.push("admit");
        return false;
      });
      const resolveTarget = vi.fn(() => {
        order.push("resolve");
        return { type: "image", width: 100 };
      });
      const patchTarget = vi.fn(() => true);
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        admitMutation,
        targetElementId: "image-1",
        resolveTarget,
        patchTarget,
        appendImage,
      }))).toBe(false);
      expect(admitMutation).toHaveBeenCalledOnce();
      expect(admitMutation).toHaveBeenCalledWith(mutationTicket);
      expect(order).toEqual(["admit"]);
      expect(patchTarget).not.toHaveBeenCalled();
      expect(appendImage).not.toHaveBeenCalled();
    });

    it.each([
      [0, 100],
      [-1, 100],
      [Number.NaN, 100],
      [Number.POSITIVE_INFINITY, 100],
      [200, 0],
      [200, -1],
      [200, Number.NaN],
      [200, Number.POSITIVE_INFINITY],
    ])("rejects invalid capture dimensions %s × %s", (width, height) => {
      const patchTarget = vi.fn(() => true);
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        result: { ...vrmResult, width, height },
        targetElementId: "image-1",
        resolveTarget: vi.fn(() => ({ type: "image", width: 320 })),
        patchTarget,
        appendImage,
      }))).toBe(false);
      expect(patchTarget).not.toHaveBeenCalled();
      expect(appendImage).not.toHaveBeenCalled();
    });

    it.each([
      [undefined],
      [null],
      [{ type: "text", width: 320 }],
      [{ type: "image" }],
      [{ type: "image", width: 0 }],
      [{ type: "image", width: Number.NaN }],
    ])("rejects an invalid replacement target %#", (target) => {
      const patchTarget = vi.fn(() => true);
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        targetElementId: "image-1",
        resolveTarget: vi.fn(() => target),
        patchTarget,
        appendImage,
      }))).toBe(false);
      expect(patchTarget).not.toHaveBeenCalled();
      expect(appendImage).not.toHaveBeenCalled();
    });

    it("patches a valid image with its existing width and exact capture aspect ratio", () => {
      const patchTarget = vi.fn(() => true);
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        targetElementId: "image-1",
        resolveTarget: vi.fn(() => ({ type: "image", width: 333 })),
        patchTarget,
        appendImage,
      }))).toBe(true);
      expect(patchTarget).toHaveBeenCalledOnce();
      expect(patchTarget).toHaveBeenCalledWith("image-1", {
        src: vrmResult.pngDataUrl,
        height: 167,
        vrmScene,
      });
      expect(appendImage).not.toHaveBeenCalled();
    });

    it("propagates a target patch rejection without reporting insertion success", () => {
      expect(applyStudioVrmInsertResult(vrmInput({
        targetElementId: "image-1",
        resolveTarget: vi.fn(() => ({ type: "image", width: 320 })),
        patchTarget: vi.fn(() => false),
      }))).toBe(false);
    });

    it("clamps an extreme replacement aspect ratio to one canvas pixel", () => {
      const patchTarget = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        result: { ...vrmResult, width: 1_000, height: 1 },
        targetElementId: "image-1",
        resolveTarget: vi.fn(() => ({ type: "image", width: 1 })),
        patchTarget,
      }))).toBe(true);
      expect(patchTarget).toHaveBeenCalledWith("image-1", {
        src: vrmResult.pngDataUrl,
        height: 1,
        vrmScene,
      });
    });

    it("appends a new image with the editable scene and product label", () => {
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({ appendImage }))).toBe(true);
      expect(appendImage).toHaveBeenCalledOnce();
      expect(appendImage).toHaveBeenCalledWith({
        src: vrmResult.pngDataUrl,
        width: vrmResult.width,
        height: vrmResult.height,
        elementPatch: {
          vrmScene,
          name: "3D 데생 인형",
        },
      });
    });

    it("appends a HiDPI capture at its logical display size so density becomes sharpness", () => {
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        result: { ...vrmResult, width: 800, height: 400, displayWidth: 200, displayHeight: 100 },
        appendImage,
      }))).toBe(true);
      expect(appendImage).toHaveBeenCalledWith({
        src: vrmResult.pngDataUrl,
        width: 200,
        height: 100,
        elementPatch: {
          vrmScene,
          name: "3D 데생 인형",
        },
      });
    });

    it.each([
      // Partial pairs, hostile values, and display sizes exceeding the raster all fall back to
      // the raster size — the insert never upscales past natural pixels.
      { displayWidth: 200 },
      { displayHeight: 100 },
      { displayWidth: 0, displayHeight: 100 },
      { displayWidth: Number.NaN, displayHeight: 100 },
      { displayWidth: 200, displayHeight: Number.POSITIVE_INFINITY },
      { displayWidth: 201, displayHeight: 100 },
      { displayWidth: 200, displayHeight: 101 },
    ])("falls back to the raster size for unusable display dimensions %j", (displayPatch) => {
      const appendImage = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        result: { ...vrmResult, ...displayPatch },
        appendImage,
      }))).toBe(true);
      expect(appendImage).toHaveBeenCalledWith(expect.objectContaining({
        width: vrmResult.width,
        height: vrmResult.height,
      }));
    });

    it("keeps replacement patches ratio-based regardless of display dimensions", () => {
      const patchTarget = vi.fn(() => true);

      expect(applyStudioVrmInsertResult(vrmInput({
        result: { ...vrmResult, width: 800, height: 400, displayWidth: 200, displayHeight: 100 },
        targetElementId: "image-1",
        resolveTarget: vi.fn(() => ({ type: "image", width: 333 })),
        patchTarget,
      }))).toBe(true);
      expect(patchTarget).toHaveBeenCalledWith("image-1", {
        src: vrmResult.pngDataUrl,
        height: 167,
        vrmScene,
      });
    });

    it("propagates a new-image append rejection", () => {
      expect(applyStudioVrmInsertResult(vrmInput({
        appendImage: vi.fn(() => false),
      }))).toBe(false);
    });
  });

  describe("background 3D insertion", () => {
    it("rejects missing or obsolete tickets before applying the rendered image", () => {
      const admitMutation = vi.fn(() => false);
      const applyRenderedImage = vi.fn(() => true);

      expect(applyStudioBg3dInsertResult({
        result: bg3dResult,
        mutationTicket: null,
        admitMutation,
        applyRenderedImage,
      })).toBe(false);
      expect(admitMutation).not.toHaveBeenCalled();

      expect(applyStudioBg3dInsertResult({
        result: bg3dResult,
        mutationTicket,
        admitMutation,
        applyRenderedImage,
      })).toBe(false);
      expect(admitMutation).toHaveBeenCalledOnce();
      expect(applyRenderedImage).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      "propagates rendered-image result %s with the exact target",
      (accepted) => {
        const applyRenderedImage = vi.fn(() => accepted);

        expect(applyStudioBg3dInsertResult({
          result: bg3dResult,
          mutationTicket,
          admitMutation: vi.fn(() => true),
          targetElementId: "background-1",
          applyRenderedImage,
        })).toBe(accepted);
        expect(applyRenderedImage).toHaveBeenCalledOnce();
        expect(applyRenderedImage).toHaveBeenCalledWith(bg3dResult, "background-1");
      }
    );
  });
});
