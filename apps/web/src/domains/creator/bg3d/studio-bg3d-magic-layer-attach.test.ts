import { describe, expect, expectTypeOf, it } from "vitest";

import { planStudioBg3dLtLayers } from "./studio-bg3d-lt-layer-plan";
import {
  attachStudioBg3dMagicFilterMaskToLtPlan,
} from "./studio-bg3d-magic-layer-attach";

import type {
  StudioBg3dLtImageElementLike,
  StudioBg3dLtLayerPlanSuccess,
  StudioBg3dLtLayerRole,
  StudioBg3dLtPageElementLike,
} from "./studio-bg3d-lt-layer-plan";
import type { StudioBg3dMagicLayerAttachResult } from "./studio-bg3d-magic-layer-attach";
import type { StudioBackground3DInsertResult } from "../scene-3d/studio-3d-insert-contract";

interface TestScene {
  readonly sceneId: string;
}

interface TestImage extends StudioBg3dLtImageElementLike<TestScene> {
  readonly filterMaskSrc?: string;
  readonly filterMaskEnabled?: boolean;
  readonly marker?: string;
}

interface TestOther extends StudioBg3dLtPageElementLike {
  readonly type: "text";
  readonly marker?: string;
}

type TestElement = TestImage | TestOther;

const PNG = {
  color: "data:image/png;base64,Q09MT1I=",
  tone: "data:image/png;base64,VE9ORQ==",
  texture: "data:image/png;base64,VEVYVA==",
  line: "data:image/png;base64,TElORQ==",
  mask: "data:image/png;base64,TUFTSw==",
} as const;

function plan(
  roles: readonly StudioBg3dLtLayerRole[],
): StudioBg3dLtLayerPlanSuccess<TestElement> {
  const srcByRole: Record<StudioBg3dLtLayerRole, string> = {
    color: PNG.color,
    tone: PNG.tone,
    "texture-line": PNG.texture,
    "main-line": PNG.line,
  };
  const anchorRole = (["main-line", "texture-line", "tone", "color"] as const)
    .find((role) => roles.includes(role))!;
  const anchorSrc = srcByRole[anchorRole];
  const result = planStudioBg3dLtLayers<TestElement, TestScene>({
    elements: [{ id: "title", type: "text", marker: "unchanged" }],
    groups: [],
    render: {
      kind: "separated",
      width: 800,
      height: 600,
      layers: roles.map((role) => ({
        role,
        pngDataUrl: srcByRole[role],
        width: 800,
        height: 600,
      })),
      bg3dScene: { sceneId: "scene" },
    },
    allocations: {
      bundleId: "bundle",
      groupId: "group",
      elementIds: {
        color: "layer-color",
        tone: "layer-tone",
        "texture-line": "layer-texture",
        "main-line": "layer-line",
      },
    },
    newElementTemplate: {
      id: "template",
      type: "image",
      src: anchorSrc,
      x: 10,
      y: 20,
      width: 400,
      height: 300,
      marker: "template",
    },
  });
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function insertResult(
  overrides: Partial<NonNullable<StudioBackground3DInsertResult["magicFilterMask"]>> = {},
): Pick<StudioBackground3DInsertResult, "width" | "height" | "magicFilterMask"> {
  return {
    width: 800,
    height: 600,
    magicFilterMask: {
      pngDataUrl: PNG.mask,
      width: 800,
      height: 600,
      selectedObjectStableId: "obj/hero~variant",
      ...overrides,
    },
  };
}

function attach(
  planned: StudioBg3dLtLayerPlanSuccess<TestElement>,
  result = insertResult(),
): StudioBg3dMagicLayerAttachResult<TestElement> {
  return attachStudioBg3dMagicFilterMaskToLtPlan({
    plan: planned,
    insertResult: result,
  });
}

describe("attachStudioBg3dMagicFilterMaskToLtPlan", () => {
  it("is a zero-copy passthrough when the optional sidecar is absent", () => {
    const planned = plan(["color", "main-line"]);
    const result = attach(planned, { width: 800, height: 600 });

    expect(result).toEqual({
      ok: true,
      applied: false,
      targetElementId: null,
      nextElements: planned.nextElements,
    });
    if (!result.ok) throw new Error(result.code);
    expect(result.nextElements).toBe(planned.nextElements);
  });

  it("attaches to the newly-created color image before tone without changing order or siblings", () => {
    const planned = plan(["main-line", "tone", "color", "texture-line"]);
    const originalElements = planned.nextElements;
    const title = originalElements[0];
    const tone = originalElements.find((element) => element.id === "layer-tone");
    const color = originalElements.find((element) => element.id === "layer-color");
    const texture = originalElements.find((element) => element.id === "layer-texture");
    const line = originalElements.find((element) => element.id === "layer-line");

    const result = attach(planned);

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      targetElementId: "layer-color",
    });
    if (!result.ok || !result.applied) throw new Error("expected applied result");
    expect(result.nextElements.map((element) => element.id)).toEqual(
      originalElements.map((element) => element.id),
    );
    expect(result.nextElements).not.toBe(originalElements);
    expect(result.nextElements[0]).toBe(title);
    expect(result.nextElements.find((element) => element.id === "layer-tone")).toBe(tone);
    expect(result.nextElements.find((element) => element.id === "layer-texture")).toBe(texture);
    expect(result.nextElements.find((element) => element.id === "layer-line")).toBe(line);
    expect(result.nextElements.find((element) => element.id === "layer-color")).toEqual({
      ...color,
      filterMaskSrc: PNG.mask,
      filterMaskEnabled: true,
    });
    expect(result.nextElements.find((element) => element.id === "layer-color")).not.toBe(color);
    expect(color).not.toHaveProperty("filterMaskSrc");
    expect(tone).not.toHaveProperty("filterMaskSrc");
    expect(texture).not.toHaveProperty("filterMaskSrc");
    expect(line).not.toHaveProperty("filterMaskSrc");
  });

  it("falls back to a newly-created tone image and never attaches to line rasters", () => {
    const planned = plan(["tone", "texture-line", "main-line"]);
    const result = attach(planned);

    expect(result).toMatchObject({
      ok: true,
      applied: true,
      targetElementId: "layer-tone",
    });
    if (!result.ok || !result.applied) throw new Error("expected applied result");
    expect(result.nextElements.find((element) => element.id === "layer-tone")).toMatchObject({
      filterMaskSrc: PNG.mask,
      filterMaskEnabled: true,
    });
    expect(result.nextElements.find((element) => element.id === "layer-texture"))
      .not.toHaveProperty("filterMaskSrc");
    expect(result.nextElements.find((element) => element.id === "layer-line"))
      .not.toHaveProperty("filterMaskSrc");
  });

  it("rejects a line-only plan and an existing, non-created color without partial mutation", () => {
    const lineOnly = plan(["texture-line", "main-line"]);
    const lineSnapshot = structuredClone(lineOnly.nextElements);
    const lineResult = attach(lineOnly);
    expect(lineResult).toMatchObject({ ok: false, code: "no-eligible-target" });
    expect(lineOnly.nextElements).toEqual(lineSnapshot);

    const color = plan(["color", "main-line"]);
    const existingColorPlan = {
      ...color,
      layers: color.layers.map((layer) =>
        layer.role === "color" ? { ...layer, created: false } : layer
      ),
      createdElementIds: color.createdElementIds.filter((id) => id !== "layer-color"),
    } satisfies StudioBg3dLtLayerPlanSuccess<TestElement>;
    const existingSnapshot = structuredClone(existingColorPlan.nextElements);
    const existingResult = attach(existingColorPlan);
    expect(existingResult).toMatchObject({ ok: false, code: "no-eligible-target" });
    expect(existingColorPlan.nextElements).toEqual(existingSnapshot);
  });

  it.each([
    {
      label: "unsafe render dimensions",
      result: { ...insertResult(), width: 0 },
      code: "invalid-render-dimensions",
    },
    {
      label: "unsafe mask dimensions",
      result: insertResult({ width: 0 }),
      code: "invalid-mask-dimensions",
    },
    {
      label: "dimension mismatch",
      result: insertResult({ height: 599 }),
      code: "mismatched-mask-dimensions",
    },
    {
      label: "non-PNG data URL",
      result: insertResult({ pngDataUrl: "data:image/jpeg;base64,TUFTSw==" }),
      code: "invalid-mask-png-data-url",
    },
    {
      label: "malformed base64",
      result: insertResult({ pngDataUrl: "data:image/png;base64,abc" }),
      code: "invalid-mask-png-data-url",
    },
    {
      label: "non-object stable ID",
      result: insertResult({ selectedObjectStableId: "mat/hero/primitive" }),
      code: "invalid-selected-object-stable-id",
    },
    {
      label: "non-canonical object stable ID",
      result: insertResult({ selectedObjectStableId: " obj/hero " }),
      code: "invalid-selected-object-stable-id",
    },
    {
      label: "forbidden object stable ID",
      result: insertResult({ selectedObjectStableId: "obj/__proto__" }),
      code: "invalid-selected-object-stable-id",
    },
  ])("rejects $label before cloning any planned element", ({ result, code }) => {
    const planned = plan(["color", "main-line"]);
    const originalElements = planned.nextElements;
    const originalSnapshot = structuredClone(originalElements);

    expect(attach(planned, result)).toMatchObject({ ok: false, code });
    expect(planned.nextElements).toBe(originalElements);
    expect(planned.nextElements).toEqual(originalSnapshot);
  });

  it("rejects extra sidecar fields and corrupt target metadata without partial mutation", () => {
    const planned = plan(["color", "main-line"]);
    const sidecarWithExtra = {
      ...insertResult().magicFilterMask!,
      rendererHandle: "must-not-cross-contract",
    };
    const malformedResult = attach(planned, {
      width: 800,
      height: 600,
      magicFilterMask: sidecarWithExtra,
    });
    expect(malformedResult).toMatchObject({ ok: false, code: "invalid-mask-shape" });

    const accessorSidecar = {
      width: 800,
      height: 600,
      pngDataUrl: PNG.mask,
    } as Record<string, unknown>;
    Object.defineProperty(accessorSidecar, "selectedObjectStableId", {
      enumerable: true,
      get: () => {
        throw new Error("accessor must not run");
      },
    });
    expect(attach(planned, {
      width: 800,
      height: 600,
      magicFilterMask: accessorSidecar as unknown as NonNullable<
        StudioBackground3DInsertResult["magicFilterMask"]
      >,
    })).toMatchObject({ ok: false, code: "invalid-selected-object-stable-id" });

    const corruptPlan = {
      ...planned,
      nextElements: planned.nextElements.map((element) =>
        element.id === "layer-color"
          ? { ...element, bg3dLtRole: "main-line" as const }
          : element
      ),
    } satisfies StudioBg3dLtLayerPlanSuccess<TestElement>;
    const corruptSnapshot = structuredClone(corruptPlan.nextElements);
    expect(attach(corruptPlan)).toMatchObject({ ok: false, code: "no-eligible-target" });
    expect(corruptPlan.nextElements).toEqual(corruptSnapshot);
  });

  it("accepts the actual planner success type without a StudioPage dependency", () => {
    const planned = plan(["color", "main-line"]);
    expectTypeOf(planned).toMatchTypeOf<StudioBg3dLtLayerPlanSuccess<TestElement>>();
    expectTypeOf(
      attachStudioBg3dMagicFilterMaskToLtPlan({
        plan: planned,
        insertResult: insertResult(),
      }),
    ).toEqualTypeOf<StudioBg3dMagicLayerAttachResult<TestElement>>();
  });
});
