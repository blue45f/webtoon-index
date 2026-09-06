import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  StudioBackground3DInsertResult,
  StudioBackground3DLtLayer,
  StudioBackground3DMagicFilterMask,
  StudioBg3dLtRasterLayerRole,
  StudioVrmPoserInsertResult,
} from "./studio-3d-insert-contract";
import type { StudioBg3dLtRasterLayerRole as RenderLayerRole } from "../bg3d/studio-bg3d-lt-render";
import type { StudioBg3dSceneDocument } from "../bg3d/studio-bg3d-scene-document";
import type {
  StudioBackground3DInsertResult as BackgroundCompatResult,
  StudioBackground3DLtLayer as BackgroundCompatLayer,
} from "../bg3d/StudioBackground3D";
import type { StudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";
import type { StudioVrmPoserInsertResult as VrmCompatResult } from "../vrm/StudioVrmPoser";

const layerRoles = ["color", "tone", "texture-line", "main-line"] as const satisfies
  readonly StudioBg3dLtRasterLayerRole[];

const layers = layerRoles.map((role, index) => ({
  role,
  pngDataUrl: `data:image/png;base64,layer-${index}`,
  width: 800,
  height: 600,
})) satisfies StudioBackground3DLtLayer[];

const magicFilterMask = {
  pngDataUrl: "data:image/png;base64,bWFzaw==",
  width: 800,
  height: 600,
  selectedObjectStableId: "obj/hero",
} satisfies StudioBackground3DMagicFilterMask;

const backgroundResult = {
  kind: "separated",
  width: 800,
  height: 600,
  layers,
  compositePngDataUrl: "data:image/png;base64,composite",
  perspectiveGuides: [
    { axis: "world-x", x: 0.25, y: 0.5 },
    { axis: "world-y", x: 0.5, y: 0.25 },
    { axis: "world-z", x: 0.75, y: 0.5 },
  ],
  magicFilterMask,
  bg3dScene: {} as StudioBg3dSceneDocument,
} satisfies StudioBackground3DInsertResult;

const vrmResult = {
  pngDataUrl: "data:image/png;base64,vrm",
  width: 512,
  height: 768,
  scene: {} as StudioVrmSceneDocument,
} satisfies StudioVrmPoserInsertResult;

describe("Studio 3D insert contract", () => {
  it("keeps the separated LT payload in stable back-to-front paint order", () => {
    expect(backgroundResult.kind).toBe("separated");
    expect(backgroundResult.layers.map((layer) => layer.role)).toEqual([
      "color",
      "tone",
      "texture-line",
      "main-line",
    ]);
    expect(backgroundResult.layers.every((layer) => (
      layer.width === backgroundResult.width
      && layer.height === backgroundResult.height
      && layer.pngDataUrl.startsWith("data:image/png;base64,")
    ))).toBe(true);
    expect(backgroundResult.perspectiveGuides.map((guide) => guide.axis)).toEqual([
      "world-x",
      "world-y",
      "world-z",
    ]);
    expect(backgroundResult.magicFilterMask).toEqual({
      pngDataUrl: "data:image/png;base64,bWFzaw==",
      width: 800,
      height: 600,
      selectedObjectStableId: "obj/hero",
    });
  });

  it("keeps the VRM capture paired with its editable scene document", () => {
    expect(vrmResult).toMatchObject({
      pngDataUrl: "data:image/png;base64,vrm",
      width: 512,
      height: 768,
    });
    expect(vrmResult.scene).toBeDefined();
  });

  it("preserves the heavyweight component and LT renderer compatibility exports exactly", () => {
    expectTypeOf<StudioBackground3DInsertResult>().toEqualTypeOf<BackgroundCompatResult>();
    expectTypeOf<StudioBackground3DLtLayer>().toEqualTypeOf<BackgroundCompatLayer>();
    expectTypeOf<StudioVrmPoserInsertResult>().toEqualTypeOf<VrmCompatResult>();
    expectTypeOf<StudioBg3dLtRasterLayerRole>().toEqualTypeOf<RenderLayerRole>();
    expectTypeOf<StudioBackground3DLtLayer["role"]>().toEqualTypeOf<
      StudioBg3dLtRasterLayerRole
    >();
  });
});
