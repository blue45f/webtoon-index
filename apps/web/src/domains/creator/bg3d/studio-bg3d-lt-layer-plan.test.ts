import { describe, expect, expectTypeOf, it } from "vitest";

import { createLayerGroup, type LayerGroup } from "../studio-layers";

import {
  canonicalizeLegacyStudioBg3dPngDataUrl,
  isStudioBg3dLtPngDataUrl,
  planStudioBg3dLtLayers,
  preserveStudioBg3dLtSceneAnchorAfterRemoval,
  STUDIO_BG3D_LT_GROUP_NAME,
  STUDIO_BG3D_LT_LAYER_NAMES,
  type StudioBg3dLtImageElementLike,
  type StudioBg3dLtLayerPlanResult,
  type StudioBg3dLtLayerRole,
  type StudioBg3dLtPageElementLike,
  type StudioBg3dLtRenderOutput,
} from "./studio-bg3d-lt-layer-plan";

interface TestScene {
  readonly sceneId: string;
}

interface TestImage extends StudioBg3dLtImageElementLike<TestScene> {
  readonly marker?: string;
  readonly hidden?: boolean;
  readonly opacity?: number;
}

interface TestOther extends StudioBg3dLtPageElementLike {
  readonly type: "text" | "frame";
  readonly marker?: string;
}

type TestElement = TestImage | TestOther;

const PNG = {
  color: "data:image/png;base64,Q09MT1I=",
  main: "data:image/png;base64,TUFJTg==",
  texture: "data:image/png;base64,VEVYVA==",
  tone: "data:image/png;base64,VE9ORQ==",
  combined: "data:image/png;base64,Q09NQg==",
} as const;

const SCENE: TestScene = Object.freeze({ sceneId: "scene-next" });

function image(overrides: Partial<TestImage> & Pick<TestImage, "id" | "src">): TestImage {
  const { id, src, ...rest } = overrides;
  return {
    id,
    type: "image",
    src,
    x: 20,
    y: 30,
    width: 400,
    height: 200,
    rotation: 0,
    ...rest,
  };
}

function other(id: string, type: TestOther["type"] = "text", groupId?: string): TestOther {
  return { id, type, marker: id, ...(groupId ? { groupId } : {}) };
}

function separated(
  roles: readonly StudioBg3dLtLayerRole[] = ["main-line", "tone", "texture-line"],
  width = 1_000,
  height = 500
): StudioBg3dLtRenderOutput<TestScene> {
  const srcByRole: Record<StudioBg3dLtLayerRole, string> = {
    color: PNG.color,
    "main-line": PNG.main,
    "texture-line": PNG.texture,
    tone: PNG.tone,
  };
  return {
    kind: "separated",
    width,
    height,
    bg3dScene: SCENE,
    layers: roles.map((role) => ({ role, pngDataUrl: srcByRole[role], width, height })),
  };
}

function combined(): StudioBg3dLtRenderOutput<TestScene> {
  return { pngDataUrl: PNG.combined, width: 1_000, height: 500, bg3dScene: SCENE };
}

function allocations(overrides: {
  bundleId?: string;
  groupId?: string;
  elementIds?: Partial<Record<StudioBg3dLtLayerRole, string>>;
} = {}) {
  return {
    bundleId: "bundle-new",
    groupId: "group-new",
    elementIds: {
      color: "layer-color-new",
      tone: "layer-tone-new",
      "texture-line": "layer-texture-new",
      "main-line": "layer-main-new",
      ...overrides.elementIds,
    },
    ...overrides,
  };
}

function template(src: string = PNG.main, overrides: Partial<TestImage> = {}): TestImage {
  return image({
    id: "ignored-template-id",
    src,
    x: 100,
    y: 120,
    width: 600,
    height: 300,
    marker: "default-image-template",
    ...overrides,
  });
}

function unwrap(
  result: StudioBg3dLtLayerPlanResult<TestElement>
): Extract<StudioBg3dLtLayerPlanResult<TestElement>, { ok: true }> {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function bundleImage(
  role: StudioBg3dLtLayerRole,
  id: string,
  overrides: Partial<TestImage> = {}
): TestImage {
  const srcByRole: Record<StudioBg3dLtLayerRole, string> = {
    color: PNG.color,
    "main-line": PNG.main,
    "texture-line": PNG.texture,
    tone: PNG.tone,
  };
  return image({
    id,
    src: srcByRole[role],
    groupId: "group-lt",
    bg3dLtBundleId: "bundle-lt",
    bg3dLtRole: role,
    bg3dLtRenderMode: "separated",
    name: STUDIO_BG3D_LT_LAYER_NAMES[role],
    ...(role === "main-line" ? { bg3dScene: { sceneId: "scene-old" } } : {}),
    ...overrides,
  });
}

function group(id = "group-lt", name = STUDIO_BG3D_LT_GROUP_NAME): LayerGroup {
  return createLayerGroup(id, name);
}

describe("3D LT PNG persistence boundary", () => {
  it("accepts canonical base64 PNG data URLs and rejects malformed/fragmented new values", () => {
    expect(isStudioBg3dLtPngDataUrl(PNG.main)).toBe(true);
    expect(isStudioBg3dLtPngDataUrl(`${PNG.main}#ts3d`)).toBe(false);
    expect(isStudioBg3dLtPngDataUrl("data:image/png;base64,abc")).toBe(false);
    expect(isStudioBg3dLtPngDataUrl("data:image/jpeg;base64,TUFJTg==")).toBe(false);
    expect(isStudioBg3dLtPngDataUrl("https://example.test/image.png")).toBe(false);
  });

  it("canonicalizes only recognized legacy BG3D fragments", () => {
    const encoded = encodeURIComponent(JSON.stringify({ tool: "bg3d", primitives: [] }));
    expect(canonicalizeLegacyStudioBg3dPngDataUrl(`${PNG.main}#ts3d`)).toBe(PNG.main);
    expect(canonicalizeLegacyStudioBg3dPngDataUrl(`${PNG.main}#${encoded}`)).toBe(PNG.main);
    expect(canonicalizeLegacyStudioBg3dPngDataUrl(PNG.main)).toBe(PNG.main);
    expect(canonicalizeLegacyStudioBg3dPngDataUrl(`${PNG.main}#`)).toBeNull();
    expect(canonicalizeLegacyStudioBg3dPngDataUrl(`${PNG.main}#not-json`)).toBeNull();
    expect(
      canonicalizeLegacyStudioBg3dPngDataUrl(
        `${PNG.main}#${encodeURIComponent(JSON.stringify({ tool: "vrm-poser" }))}`
      )
    ).toBeNull();
    expect(canonicalizeLegacyStudioBg3dPngDataUrl(`${PNG.main}#ts3d#extra`)).toBeNull();
  });
});

describe("planStudioBg3dLtLayers insertion and fallback", () => {
  it("keeps the shaded color render behind LT lines and classifies it as a color layer", () => {
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: separated(["main-line", "color", "texture-line"]),
        allocations: allocations(),
        newElementTemplate: template(),
      })
    );

    expect(result.layers.map((layer) => layer.role)).toEqual([
      "color",
      "texture-line",
      "main-line",
    ]);
    expect(result.nextElements.map((element) => element.id)).toEqual([
      "layer-color-new",
      "layer-texture-new",
      "layer-main-new",
    ]);
    expect((result.nextElements[0] as TestImage).layerRole).toBe("color");
    expect((result.nextElements[0] as TestImage).name).toBe(
      STUDIO_BG3D_LT_LAYER_NAMES.color
    );
  });

  it("inserts separated layers in deterministic back-to-front order with one scene anchor", () => {
    const unrelated = other("unrelated");
    const unrelatedGroup = group("unrelated-group", "대사");
    const elements = Object.freeze([unrelated] as const);
    const groups = Object.freeze([unrelatedGroup] as const);

    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements,
        groups,
        render: separated(),
        allocations: allocations(),
        newElementTemplate: template(),
      })
    );

    expect(result.operation).toBe("insert");
    expect(result.layers.map((layer) => layer.role)).toEqual([
      "tone",
      "texture-line",
      "main-line",
    ]);
    expect(result.nextElements.map((element) => element.id)).toEqual([
      "unrelated",
      "layer-tone-new",
      "layer-texture-new",
      "layer-main-new",
    ]);
    expect(result.nextElements[0]).toBe(unrelated);
    expect(result.nextGroups[0]).toBe(unrelatedGroup);
    expect(result.nextGroups[1]).toEqual({
      id: "group-new",
      name: STUDIO_BG3D_LT_GROUP_NAME,
      collapsed: false,
      hidden: false,
      locked: false,
    });

    const layers = result.nextElements.slice(1) as TestImage[];
    expect(layers.map((layer) => layer.name)).toEqual([
      STUDIO_BG3D_LT_LAYER_NAMES.tone,
      STUDIO_BG3D_LT_LAYER_NAMES["texture-line"],
      STUDIO_BG3D_LT_LAYER_NAMES["main-line"],
    ]);
    expect(layers.map((layer) => layer.layerRole)).toEqual(["tone", "lineart", "lineart"]);
    expect(layers.every((layer) => layer.groupId === "group-new")).toBe(true);
    expect(layers.every((layer) => layer.x === 100 && layer.y === 120)).toBe(true);
    expect(layers.every((layer) => layer.width === 600 && layer.height === 300)).toBe(true);
    expect(layers.filter((layer) => layer.bg3dScene !== undefined)).toEqual([layers[2]]);
    expect(layers.filter((layer) => Object.hasOwn(layer, "bg3dScene"))).toEqual([layers[2]]);
    expect(layers[2]?.bg3dScene).toBe(SCENE);
    expect(result.anchorElementId).toBe("layer-main-new");
    expect(elements).toEqual([unrelated]);
    expect(groups).toEqual([unrelatedGroup]);
  });

  it("uses the highest available role as anchor when main-line is absent", () => {
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: separated(["tone", "texture-line"]),
        allocations: allocations(),
        newElementTemplate: template(PNG.texture),
      })
    );
    expect(result.layers.map((layer) => [layer.role, layer.sceneAnchor])).toEqual([
      ["tone", false],
      ["texture-line", true],
    ]);
    expect(result.anchorElementId).toBe("layer-texture-new");
    expect((result.nextElements[0] as TestImage).bg3dScene).toBeUndefined();
    expect((result.nextElements[1] as TestImage).bg3dScene).toBe(SCENE);
  });

  it("supports a separated single tone layer without inventing unavailable roles", () => {
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: separated(["tone"]),
        allocations: allocations(),
        newElementTemplate: template(PNG.tone),
      })
    );
    expect(result.renderMode).toBe("separated");
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]).toMatchObject({ role: "tone", sceneAnchor: true });
    expect((result.nextElements[0] as TestImage).bg3dLtRole).toBe("tone");
  });

  it("upgrades the current combined result shape to one editable main-line fallback", () => {
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: combined(),
        allocations: allocations(),
        newElementTemplate: template(PNG.combined),
      })
    );
    expect(result.renderMode).toBe("combined");
    expect(result.layers).toEqual([
      {
        role: "main-line",
        elementId: "layer-main-new",
        name: STUDIO_BG3D_LT_LAYER_NAMES["main-line"],
        pngDataUrl: PNG.combined,
        created: true,
        sceneAnchor: true,
      },
    ]);
    expect((result.nextElements[0] as TestImage).bg3dLtRenderMode).toBe("combined");
  });
});

describe("planStudioBg3dLtLayers bundle update", () => {
  it("accepts the verified OPFS-CAS locator persisted on the canonical main-line layer", () => {
    const main = bundleImage("main-line", "main-old", {
      src: `studio-opfs-cas:sha256:${"a".repeat(64)}`,
    });
    const result = unwrap(planStudioBg3dLtLayers<TestElement, TestScene>({
      elements: [bundleImage("tone", "tone-old"), main],
      groups: [group()],
      targetElementId: "main-old",
      render: separated(["tone", "main-line"]),
    }));

    expect(result.operation).toBe("update");
    expect((result.nextElements[1] as TestImage).src).toBe(PNG.main);
  });

  it("recreates a missing role, normalizes stacking, and preserves unrelated references", () => {
    const before = other("before");
    const tone = bundleImage("tone", "tone-old", {
      height: 240,
      bg3dScene: { sceneId: "stale-duplicate-anchor" },
      opacity: 0.7,
    });
    const main = bundleImage("main-line", "main-old", { height: 240, marker: "keep-main-style" });
    const after = other("after", "frame");
    const ltGroup = group("group-lt", "사용자가 바꾼 이름");
    const otherGroup = group("other-group", "기타");
    const elements: readonly TestElement[] = [before, tone, main, after];
    const groups = [ltGroup, otherGroup];

    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements,
        groups,
        targetElementId: "main-old",
        render: separated(),
        allocations: allocations({ elementIds: { "texture-line": "texture-created" } }),
        newElementTemplate: template(),
      })
    );

    expect(result.operation).toBe("update");
    expect(result.bundleId).toBe("bundle-lt");
    expect(result.groupId).toBe("group-lt");
    expect(result.createdElementIds).toEqual(["texture-created"]);
    expect(result.removedElementIds).toEqual([]);
    expect(result.nextElements.map((element) => element.id)).toEqual([
      "before",
      "tone-old",
      "texture-created",
      "main-old",
      "after",
    ]);
    expect(result.nextElements[0]).toBe(before);
    expect(result.nextElements[4]).toBe(after);
    const nextLayers = result.nextElements.slice(1, 4) as TestImage[];
    expect(nextLayers.every((layer) => layer.x === 20 && layer.y === 30)).toBe(true);
    expect(nextLayers.every((layer) => layer.width === 400 && layer.height === 200)).toBe(true);
    expect(nextLayers.every((layer) => layer.groupId === "group-lt")).toBe(true);
    expect(nextLayers[0]?.opacity).toBe(0.7);
    expect(nextLayers[2]?.marker).toBe("keep-main-style");
    expect(nextLayers.filter((layer) => layer.bg3dScene !== undefined)).toEqual([nextLayers[2]]);
    expect(nextLayers[2]?.bg3dScene).toBe(SCENE);
    expect(result.nextGroups[0]).toEqual({ ...ltGroup, name: STUDIO_BG3D_LT_GROUP_NAME });
    expect(result.nextGroups[1]).toBe(otherGroup);
    expect(tone.bg3dScene).toEqual({ sceneId: "stale-duplicate-anchor" });
    expect(main.height).toBe(240);
  });

  it("removes obsolete roles and keeps the surviving bundle at the same z-position", () => {
    const elements: readonly TestElement[] = [
      other("before"),
      bundleImage("tone", "tone-old"),
      bundleImage("texture-line", "texture-old"),
      bundleImage("main-line", "main-old"),
      other("after"),
    ];
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements,
        groups: [group()],
        targetElementId: "texture-old",
        render: separated(["tone", "main-line"]),
      })
    );
    expect(result.nextElements.map((element) => element.id)).toEqual([
      "before",
      "tone-old",
      "main-old",
      "after",
    ]);
    expect(result.removedElementIds).toEqual(["texture-old"]);
    expect(result.createdElementIds).toEqual([]);
    expect(result.insertionIndex).toBe(1);
  });

  it("upgrades a legacy fragment PNG at the same z-position and preserves its old group", () => {
    const oldGroup = group("old-group", "기존 배경 폴더");
    const before = other("before", "text", "old-group");
    const legacy = image({
      id: "legacy",
      src: `${PNG.combined}#ts3d`,
      groupId: "old-group",
      width: 500,
      height: 300,
      marker: "legacy-style",
    });
    const after = other("after");
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [before, legacy, after],
        groups: [oldGroup],
        targetElementId: "legacy",
        render: separated(),
        allocations: allocations({
          elementIds: { tone: "legacy-tone", "texture-line": "legacy-texture" },
        }),
        newElementTemplate: template(),
      })
    );

    expect(result.operation).toBe("upgrade-legacy");
    expect(result.nextElements.map((element) => element.id)).toEqual([
      "before",
      "legacy-tone",
      "legacy-texture",
      "legacy",
      "after",
    ]);
    const nextLayers = result.nextElements.slice(1, 4) as TestImage[];
    expect(nextLayers.every((layer) => layer.groupId === "group-new")).toBe(true);
    expect(nextLayers.every((layer) => layer.width === 500 && layer.height === 250)).toBe(true);
    expect(nextLayers[2]?.marker).toBe("legacy-style");
    expect(nextLayers[2]?.src).toBe(PNG.main);
    expect(result.nextGroups[0]).toBe(oldGroup);
    expect(result.nextGroups[1]?.name).toBe(STUDIO_BG3D_LT_GROUP_NAME);
    expect(before.groupId).toBe("old-group");
    expect(legacy.src).toBe(`${PNG.combined}#ts3d`);
  });
});

describe("planStudioBg3dLtLayers fail-closed validation", () => {
  it("rejects page, element, legacy-group, and bundle-group locks", () => {
    const pageLocked = planStudioBg3dLtLayers<TestElement, TestScene>({
      elements: [],
      groups: [],
      render: combined(),
      pageLocked: true,
    });
    expect(pageLocked).toMatchObject({ ok: false, code: "page-locked" });

    const lockedTarget = image({ id: "legacy", src: PNG.combined, locked: true });
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [lockedTarget],
        groups: [],
        targetElementId: "legacy",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "target-locked" });

    const legacyInLockedGroup = image({ id: "legacy-grouped", src: PNG.combined, groupId: "locked" });
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [legacyInLockedGroup],
        groups: [{ ...group("locked"), locked: true }],
        targetElementId: "legacy-grouped",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "target-locked" });

    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [bundleImage("main-line", "main")],
        groups: [{ ...group(), locked: true }],
        targetElementId: "main",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "bundle-group-locked" });
  });

  it("rejects duplicate roles, mismatched dimensions, invalid URLs, and missing scene", () => {
    const duplicateRole = separated(["main-line", "main-line"]);
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: duplicateRole,
      })
    ).toMatchObject({ ok: false, code: "duplicate-render-role" });

    const mismatch: StudioBg3dLtRenderOutput<TestScene> = {
      kind: "separated",
      width: 1_000,
      height: 500,
      bg3dScene: SCENE,
      layers: [{ role: "main-line", pngDataUrl: PNG.main, width: 999, height: 500 }],
    };
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({ elements: [], groups: [], render: mismatch })
    ).toMatchObject({ ok: false, code: "mismatched-layer-dimensions" });

    const invalidUrl = {
      kind: "combined",
      pngDataUrl: `${PNG.main}#ts3d`,
      width: 1_000,
      height: 500,
      bg3dScene: SCENE,
    } as const;
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({ elements: [], groups: [], render: invalidUrl })
    ).toMatchObject({ ok: false, code: "invalid-png-data-url" });

    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: { ...combined(), bg3dScene: null } as unknown as StudioBg3dLtRenderOutput<TestScene>,
      })
    ).toMatchObject({ ok: false, code: "missing-scene" });
  });

  it("rejects duplicate bundle roles, geometry drift, noncontiguous runs, and mixed groups", () => {
    const duplicate = [
      bundleImage("main-line", "main-a"),
      bundleImage("main-line", "main-b"),
    ];
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: duplicate,
        groups: [group()],
        targetElementId: "main-a",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "duplicate-bundle-role" });

    const geometryDrift = [
      bundleImage("tone", "tone"),
      bundleImage("main-line", "main", { x: 21 }),
    ];
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: geometryDrift,
        groups: [group()],
        targetElementId: "main",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "inconsistent-bundle-geometry" });

    const split = [
      bundleImage("tone", "tone"),
      other("intruder"),
      bundleImage("main-line", "main"),
    ];
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: split,
        groups: [group()],
        targetElementId: "main",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "noncontiguous-bundle" });

    const mixed = [bundleImage("main-line", "main"), other("intruder", "text", "group-lt")];
    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: mixed,
        groups: [group()],
        targetElementId: "main",
        render: combined(),
      })
    ).toMatchObject({ ok: false, code: "mixed-bundle-group" });
  });

  it("requires collision-free allocations and a render-matched template only when creating", () => {
    const baseInput = {
      elements: [other("taken")],
      groups: [] as LayerGroup[],
      render: separated(),
      allocations: allocations({ elementIds: { tone: "taken" } }),
      newElementTemplate: template(),
    } satisfies Parameters<typeof planStudioBg3dLtLayers<TestElement, TestScene>>[0];
    expect(planStudioBg3dLtLayers<TestElement, TestScene>(baseInput)).toMatchObject({
      ok: false,
      code: "allocation-collision",
    });

    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: separated(),
        allocations: allocations(),
      })
    ).toMatchObject({ ok: false, code: "missing-element-template" });

    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: separated(),
        allocations: allocations(),
        newElementTemplate: template(PNG.tone),
      })
    ).toMatchObject({ ok: false, code: "template-source-mismatch" });

    expect(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements: [],
        groups: [],
        render: separated(),
        allocations: allocations(),
        newElementTemplate: template(PNG.main, { height: 250 }),
      })
    ).toMatchObject({ ok: false, code: "template-aspect-mismatch" });
  });

  it("rejects malformed legacy fragments while accepting canonical legacy PNGs", () => {
    for (const src of [`${PNG.combined}#bad`, `${PNG.combined}#`, `${PNG.combined}#ts3d#again`]) {
      expect(
        planStudioBg3dLtLayers<TestElement, TestScene>({
          elements: [image({ id: "legacy", src })],
          groups: [],
          targetElementId: "legacy",
          render: combined(),
          allocations: allocations(),
        })
      ).toMatchObject({ ok: false, code: "invalid-png-data-url" });
    }
  });

  it("does not mutate frozen inputs on success or failure", () => {
    const existing = Object.freeze(other("existing"));
    const elements = Object.freeze([existing] as const);
    const existingGroup = Object.freeze(group("existing-group"));
    const groups = Object.freeze([existingGroup] as const);
    const frozenTemplate = Object.freeze(template());
    const result = unwrap(
      planStudioBg3dLtLayers<TestElement, TestScene>({
        elements,
        groups,
        render: separated(),
        allocations: allocations(),
        newElementTemplate: frozenTemplate,
      })
    );
    expect(result.nextElements[0]).toBe(existing);
    expect(result.nextGroups[0]).toBe(existingGroup);
    expect(frozenTemplate).toEqual(template());
    expect(elements).toEqual([existing]);
    expect(groups).toEqual([existingGroup]);
  });
});

describe("generic StudioPage integration contract", () => {
  it("promotes the highest remaining role when the sole editable scene anchor is deleted", () => {
    const tone = bundleImage("tone", "tone");
    const texture = bundleImage("texture-line", "texture");
    const main = bundleImage("main-line", "main");
    const before = Object.freeze([tone, texture, main] as const);
    const after = [tone, texture];
    const repaired = preserveStudioBg3dLtSceneAnchorAfterRemoval<TestElement, TestScene>(
      before,
      after
    );

    expect(repaired).not.toBe(after);
    expect((repaired[0] as TestImage).bg3dScene).toBeUndefined();
    expect((repaired[1] as TestImage).bg3dScene).toEqual({ sceneId: "scene-old" });
    expect(after[1]?.bg3dScene).toBeUndefined();
    expect(before[2]?.bg3dScene).toEqual({ sceneId: "scene-old" });
  });

  it("keeps array and element references when the anchor remains or the bundle is removed", () => {
    const tone = bundleImage("tone", "tone");
    const main = bundleImage("main-line", "main");
    const anchoredAfter = [tone, main];
    expect(
      preserveStudioBg3dLtSceneAnchorAfterRemoval<TestElement, TestScene>(
        [tone, main],
        anchoredAfter
      )
    ).toBe(anchoredAfter);

    const emptyAfter: TestElement[] = [];
    expect(
      preserveStudioBg3dLtSceneAnchorAfterRemoval<TestElement, TestScene>(
        [tone, main],
        emptyAfter
      )
    ).toBe(emptyAfter);
  });

  it("fails closed for a corrupt source bundle with multiple scene anchors", () => {
    const tone = bundleImage("tone", "tone", { bg3dScene: { sceneId: "tone-scene" } });
    const main = bundleImage("main-line", "main");
    const after = [bundleImage("texture-line", "texture")];
    expect(
      preserveStudioBg3dLtSceneAnchorAfterRemoval<TestElement, TestScene>(
        [tone, main],
        after
      )
    ).toBe(after);
    expect(after[0]?.bg3dScene).toBeUndefined();
  });

  it("keeps a page element union generic and returns the same union", () => {
    const render: StudioBg3dLtRenderOutput<TestScene> = combined();
    const result = planStudioBg3dLtLayers<TestElement, TestScene>({
      elements: [],
      groups: [],
      render,
      allocations: allocations(),
      newElementTemplate: template(PNG.combined),
    });
    expectTypeOf(result).toEqualTypeOf<StudioBg3dLtLayerPlanResult<TestElement>>();
    expect(result.ok).toBe(true);
  });
});
