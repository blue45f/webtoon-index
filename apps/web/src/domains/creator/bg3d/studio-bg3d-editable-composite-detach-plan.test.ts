import { describe, expect, expectTypeOf, it } from "vitest";

import { createLayerGroup, type LayerGroup } from "../studio-layers";

import {
  planStudioBg3dEditableCompositeDetach,
  type StudioBg3dEditableCompositeDetachFailure,
  type StudioBg3dEditableCompositeDetachResult,
} from "./studio-bg3d-editable-composite-detach-plan";
import {
  planStudioBg3dLtLayers,
  STUDIO_BG3D_LT_LAYER_NAMES,
  type StudioBg3dLtImageElementLike,
  type StudioBg3dLtLayerPlanSuccess,
  type StudioBg3dLtLayerRole,
  type StudioBg3dLtPageElementLike,
  type StudioBg3dLtRenderOutput,
} from "./studio-bg3d-lt-layer-plan";

interface TestScene {
  readonly sceneId: string;
  readonly editable: true;
}

interface TestImage extends StudioBg3dLtImageElementLike<TestScene> {
  readonly marker?: string;
  readonly opacity?: number;
  readonly bg3dLtFutureReceipt?: string;
}

interface TestOther extends StudioBg3dLtPageElementLike {
  readonly type: "text" | "frame";
  readonly marker: string;
}

type TestElement = TestImage | TestOther;

const PNG = {
  color: "data:image/png;base64,Q09MT1I=",
  tone: "data:image/png;base64,VE9ORQ==",
  texture: "data:image/png;base64,VEVYVA==",
  main: "data:image/png;base64,TUFJTg==",
  composite: "data:image/png;base64,Q09NUE9TSVRF",
} as const;

const NEXT_SCENE: TestScene = Object.freeze({ sceneId: "scene-next", editable: true });
const OLD_SCENE: TestScene = Object.freeze({ sceneId: "scene-old", editable: true });

function image(overrides: Partial<TestImage> & Pick<TestImage, "id" | "src">): TestImage {
  const { id, src, ...rest } = overrides;
  return {
    id,
    type: "image",
    src,
    x: 24,
    y: 36,
    width: 480,
    height: 240,
    rotation: 7,
    flipped: true,
    skewX: 2,
    ...rest,
  };
}

function other(id: string, groupId?: string): TestOther {
  return {
    id,
    type: "text",
    marker: id,
    ...(groupId === undefined ? {} : { groupId }),
  };
}

function bundleImage(
  role: StudioBg3dLtLayerRole,
  id: string,
  overrides: Partial<TestImage> = {}
): TestImage {
  const srcByRole: Record<StudioBg3dLtLayerRole, string> = {
    color: PNG.color,
    tone: PNG.tone,
    "texture-line": PNG.texture,
    "main-line": PNG.main,
  };
  return image({
    id,
    src: srcByRole[role],
    groupId: "group-lt",
    name: STUDIO_BG3D_LT_LAYER_NAMES[role],
    bg3dLtBundleId: "bundle-lt",
    bg3dLtRole: role,
    bg3dLtRenderMode: "separated",
    ...(role === "main-line" ? { bg3dScene: OLD_SCENE } : {}),
    ...overrides,
  });
}

function separatedRender(): StudioBg3dLtRenderOutput<TestScene> {
  return {
    kind: "separated",
    width: 1_000,
    height: 500,
    bg3dScene: NEXT_SCENE,
    layers: [
      { role: "tone", pngDataUrl: PNG.tone, width: 1_000, height: 500 },
      { role: "texture-line", pngDataUrl: PNG.texture, width: 1_000, height: 500 },
      { role: "main-line", pngDataUrl: PNG.main, width: 1_000, height: 500 },
    ],
  };
}

function exactLtPlan(): StudioBg3dLtLayerPlanSuccess<TestElement> {
  const result = planStudioBg3dLtLayers<TestElement, TestScene>({
    elements: [
      other("sibling-before"),
      bundleImage("tone", "tone-layer", { opacity: 0.55 }),
      bundleImage("texture-line", "texture-layer"),
      bundleImage("main-line", "anchor-layer", {
        marker: "anchor-custom-field",
        bg3dLtFutureReceipt: "remove-with-prefix",
      }),
      other("sibling-after"),
    ],
    groups: [
      createLayerGroup("group-lt", "사용자 이름"),
      createLayerGroup("sibling-group", "다른 그룹"),
    ],
    render: separatedRender(),
    targetElementId: "anchor-layer",
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function replaceElement(
  plan: StudioBg3dLtLayerPlanSuccess<TestElement>,
  id: string,
  patch: Partial<TestElement>
): StudioBg3dLtLayerPlanSuccess<TestElement> {
  return {
    ...plan,
    nextElements: plan.nextElements.map((element) =>
      element.id === id ? { ...element, ...patch } as TestElement : element
    ),
  };
}

function expectFailure(
  result: StudioBg3dEditableCompositeDetachResult<TestElement>,
  code: StudioBg3dEditableCompositeDetachFailure["code"]
): void {
  expect(result).toEqual(expect.objectContaining({ ok: false, code }));
  expect(result).not.toHaveProperty("nextElements");
  expect(result).not.toHaveProperty("nextGroups");
}

describe("planStudioBg3dEditableCompositeDetach", () => {
  it("collapses the exact LT bundle to its anchor without losing the editable scene or sibling identity", () => {
    const plan = exactLtPlan();
    const originalElements = [...plan.nextElements];
    const originalGroups = [...plan.nextGroups];
    const originalAnchor = plan.nextElements.find((element) => element.id === plan.anchorElementId);
    const siblingBefore = plan.nextElements[0];
    const siblingAfter = plan.nextElements.at(-1);
    const siblingGroup = plan.nextGroups[1];

    const result = planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
      plan,
      compositePngDataUrl: PNG.composite,
      expected: {
        bundleId: plan.bundleId,
        groupId: plan.groupId,
        anchorElementId: plan.anchorElementId,
      },
    });

    expectTypeOf(result).toEqualTypeOf<StudioBg3dEditableCompositeDetachResult<TestElement>>();
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result).toMatchObject({
      anchorElementId: "anchor-layer",
      detachedBundleId: "bundle-lt",
      removedGroupId: "group-lt",
      removedElementIds: ["tone-layer", "texture-layer"],
    });
    expect(result.nextElements.map((element) => element.id)).toEqual([
      "sibling-before",
      "anchor-layer",
      "sibling-after",
    ]);
    expect(result.nextElements[0]).toBe(siblingBefore);
    expect(result.nextElements[2]).toBe(siblingAfter);
    expect(result.nextGroups).toEqual([siblingGroup]);
    expect(result.nextGroups[0]).toBe(siblingGroup);

    const composite = result.nextElements[1] as TestImage;
    const anchor = originalAnchor as TestImage;
    expect(composite).not.toBe(anchor);
    expect(composite.src).toBe(PNG.composite);
    expect(composite.id).toBe(anchor.id);
    expect(composite.name).toBe(anchor.name);
    expect(composite.bg3dScene).toBe(NEXT_SCENE);
    expect(composite.marker).toBe("anchor-custom-field");
    expect({
      x: composite.x,
      y: composite.y,
      width: composite.width,
      height: composite.height,
      rotation: composite.rotation,
      flipped: composite.flipped,
      skewX: composite.skewX,
    }).toEqual({
      x: anchor.x,
      y: anchor.y,
      width: anchor.width,
      height: anchor.height,
      rotation: anchor.rotation,
      flipped: anchor.flipped,
      skewX: anchor.skewX,
    });
    expect(Object.hasOwn(composite, "groupId")).toBe(false);
    expect(Object.keys(composite).filter((key) => key.startsWith("bg3dLt"))).toEqual([]);

    expect(plan.nextElements).toEqual(originalElements);
    expect(plan.nextGroups).toEqual(originalGroups);
    expect((originalAnchor as TestImage).src).toBe(PNG.main);
    expect((originalAnchor as TestImage).bg3dLtFutureReceipt).toBe("remove-with-prefix");
  });

  it("also detaches a valid one-layer combined bundle and removes its now-empty group", () => {
    const scene: TestScene = { sceneId: "combined-scene", editable: true };
    const render: StudioBg3dLtRenderOutput<TestScene> = {
      pngDataUrl: PNG.main,
      width: 800,
      height: 400,
      bg3dScene: scene,
    };
    const inserted = planStudioBg3dLtLayers<TestElement, TestScene>({
      elements: [other("sibling")],
      groups: [],
      render,
      allocations: {
        bundleId: "combined-bundle",
        groupId: "combined-group",
        elementIds: { "main-line": "combined-anchor" },
      },
      newElementTemplate: image({
        id: "template",
        src: PNG.main,
        width: 320,
        height: 160,
      }),
    });
    if (!inserted.ok) throw new Error(`${inserted.code}: ${inserted.message}`);

    const result = planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
      plan: inserted,
      compositePngDataUrl: PNG.composite,
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.removedElementIds).toEqual([]);
    expect(result.nextElements.map((element) => element.id)).toEqual(["sibling", "combined-anchor"]);
    expect(result.nextGroups).toEqual([]);
    expect((result.nextElements[1] as TestImage).bg3dScene).toBe(scene);
  });

  it("rejects an expectation from another render generation as stale", () => {
    const plan = exactLtPlan();
    const result = planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
      plan,
      compositePngDataUrl: PNG.composite,
      expected: {
        bundleId: "older-bundle",
        groupId: plan.groupId,
        anchorElementId: plan.anchorElementId,
      },
    });
    expectFailure(result, "stale-plan");
  });

  it("rejects a stale anchor identity or changed layer set without producing partial state", () => {
    const plan = exactLtPlan();
    const staleAnchor = { ...plan, anchorElementId: "removed-anchor" };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: staleAnchor,
        compositePngDataUrl: PNG.composite,
      }),
      "stale-plan"
    );

    const missingTone = {
      ...plan,
      nextElements: plan.nextElements.filter((element) => element.id !== "tone-layer"),
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: missingTone,
        compositePngDataUrl: PNG.composite,
      }),
      "stale-plan"
    );
  });

  it("fails closed when the dedicated group contains an unrelated layer", () => {
    const plan = exactLtPlan();
    const mixed = {
      ...plan,
      nextElements: [
        ...plan.nextElements.slice(0, 2),
        other("unrelated-in-dedicated-group", plan.groupId),
        ...plan.nextElements.slice(2),
      ],
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: mixed,
        compositePngDataUrl: PNG.composite,
      }),
      "mixed-bundle-group"
    );
  });

  it("fails closed when the bundle is noncontiguous, malformed, or geometrically inconsistent", () => {
    const plan = exactLtPlan();
    const noncontiguous = {
      ...plan,
      nextElements: [
        ...plan.nextElements.slice(0, 2),
        other("interleaved-layer"),
        ...plan.nextElements.slice(2),
      ],
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: noncontiguous,
        compositePngDataUrl: PNG.composite,
      }),
      "noncontiguous-bundle"
    );

    const inconsistentGeometry = replaceElement(plan, "texture-layer", { x: 999 });
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: inconsistentGeometry,
        compositePngDataUrl: PNG.composite,
      }),
      "inconsistent-bundle-geometry"
    );

    const malformedMetadata = replaceElement(plan, "texture-layer", {
      bg3dLtRenderMode: "combined",
    });
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: malformedMetadata,
        compositePngDataUrl: PNG.composite,
      }),
      "invalid-bundle-metadata"
    );
  });

  it("requires one exact editable scene anchor and a canonical PNG", () => {
    const plan = exactLtPlan();
    const withoutScene = replaceElement(plan, "anchor-layer", { bg3dScene: undefined });
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: withoutScene,
        compositePngDataUrl: PNG.composite,
      }),
      "missing-scene"
    );
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan,
        compositePngDataUrl: `${PNG.composite}#stale-scene-fragment`,
      }),
      "invalid-composite-png"
    );
  });

  it("refuses page, layer, and group locks independently", () => {
    const plan = exactLtPlan();
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan,
        compositePngDataUrl: PNG.composite,
        pageLocked: true,
      }),
      "page-locked"
    );

    const lockedElement = replaceElement(plan, "tone-layer", { locked: true });
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: lockedElement,
        compositePngDataUrl: PNG.composite,
      }),
      "target-locked"
    );

    const lockedGroup: StudioBg3dLtLayerPlanSuccess<TestElement> = {
      ...plan,
      nextGroups: plan.nextGroups.map((group) =>
        group.id === plan.groupId ? { ...group, locked: true } : group
      ),
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: lockedGroup,
        compositePngDataUrl: PNG.composite,
      }),
      "bundle-group-locked"
    );
  });

  it("rejects duplicate identities and a missing dedicated group", () => {
    const plan = exactLtPlan();
    const duplicateElement = {
      ...plan,
      nextElements: [...plan.nextElements, plan.nextElements[0]!],
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: duplicateElement,
        compositePngDataUrl: PNG.composite,
      }),
      "duplicate-element-id"
    );

    const duplicateGroup = {
      ...plan,
      nextGroups: [...plan.nextGroups, { ...plan.nextGroups[0]! }],
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: duplicateGroup,
        compositePngDataUrl: PNG.composite,
      }),
      "duplicate-group-id"
    );

    const missingGroup = {
      ...plan,
      nextGroups: plan.nextGroups.filter((group) => group.id !== plan.groupId),
    };
    expectFailure(
      planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
        plan: missingGroup,
        compositePngDataUrl: PNG.composite,
      }),
      "missing-bundle-group"
    );
  });

  it("keeps unrelated group references and order exactly", () => {
    const plan = exactLtPlan();
    const additionalGroups: LayerGroup[] = [
      createLayerGroup("before-group", "앞 그룹"),
      ...plan.nextGroups,
      createLayerGroup("after-group", "뒤 그룹"),
    ];
    const withGroups = { ...plan, nextGroups: additionalGroups };
    const result = planStudioBg3dEditableCompositeDetach<TestElement, TestScene>({
      plan: withGroups,
      compositePngDataUrl: PNG.composite,
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.nextGroups.map((group) => group.id)).toEqual([
      "before-group",
      "sibling-group",
      "after-group",
    ]);
    expect(result.nextGroups[0]).toBe(additionalGroups[0]);
    expect(result.nextGroups[1]).toBe(plan.nextGroups[1]);
    expect(result.nextGroups[2]).toBe(additionalGroups[3]);
  });
});
