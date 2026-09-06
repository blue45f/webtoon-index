import { describe, expect, it } from "vitest";

import { createLayerGroup } from "../studio-layers";
import { createStudioShared3dSceneSessionFromElements } from "../studio-shared-3d-scene-bridge";
import {
  planStudioShared3dStageCollectionRemoval,
  planStudioShared3dStageCollectionUpsert,
} from "../studio-shared-3d-stage-collection";
import {
  createStudioShared3dStageDocument,
  type StudioShared3dStageElementSource,
} from "../studio-shared-3d-stage-document";
import { createStudioVrmSceneDocument } from "../vrm/studio-vrm-scene-document";

import { planStudioBg3dEditableCompositeDetach } from "./studio-bg3d-editable-composite-detach-plan";
import {
  planStudioBg3dLtLayers,
  type StudioBg3dLtImageElementLike,
  type StudioBg3dLtPageElementLike,
} from "./studio-bg3d-lt-layer-plan";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  type StudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

type TestImage = StudioBg3dLtImageElementLike<StudioBg3dSceneDocument>
& StudioShared3dStageElementSource & {
  readonly hidden?: boolean;
};

type TestOther = StudioBg3dLtPageElementLike
& StudioShared3dStageElementSource & {
  readonly type: "text";
};

type TestElement = TestImage | TestOther;

const PNG = {
  tone: "data:image/png;base64,VE9ORQ==",
  line: "data:image/png;base64,TElORQ==",
  composite: "data:image/png;base64,Q09NUE9TSVRF",
} as const;

function image(input: Partial<TestImage> & Pick<TestImage, "id" | "src">): TestImage {
  const { id, src, ...overrides } = input;
  return {
    id,
    type: "image",
    src,
    x: 20,
    y: 30,
    width: 600,
    height: 300,
    ...overrides,
  };
}

describe("editable composite + shared Stage detach integration", () => {
  it("removes only one Stage, keeps its editable 3D source and reference-counts the shared VRM", () => {
    const characterScene = createStudioVrmSceneDocument();
    const elements: TestElement[] = [
      { id: "sibling-text", type: "text" },
      image({
        id: "tone-a",
        src: PNG.tone,
        groupId: "group-a",
        name: "3D LT · 톤",
        bg3dLtBundleId: "bundle-a",
        bg3dLtRole: "tone",
        bg3dLtRenderMode: "separated",
      }),
      image({
        id: "anchor-a",
        src: PNG.line,
        groupId: "group-a",
        name: "3D LT · 메인 선화",
        bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
        bg3dLtBundleId: "bundle-a",
        bg3dLtRole: "main-line",
        bg3dLtRenderMode: "separated",
      }),
      image({
        id: "anchor-b",
        src: PNG.line,
        bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
        bg3dLtBundleId: "bundle-b",
      }),
      image({
        id: "shared-character",
        src: PNG.line,
        vrmScene: characterScene,
        hidden: true,
      }),
    ];
    const source = createStudioShared3dSceneSessionFromElements(elements).characters[0]!;
    const stageA = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-a",
      elements,
      characterElementIds: [source.elementId],
      hiddenByStageElementIds: [source.elementId],
    })!;
    const first = planStudioShared3dStageCollectionUpsert({
      value: undefined,
      stage: stageA,
      elements,
      placementCaptures: [{
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        transform: { position: [1, 0.25, -2], rotationY: 0.5 },
      }],
    })!;
    const stageB = createStudioShared3dStageDocument({
      backgroundBundleId: "bundle-b",
      elements: first.nextElements,
      characterElementIds: [source.elementId],
      hiddenByStageElementIds: [source.elementId],
    })!;
    const second = planStudioShared3dStageCollectionUpsert({
      value: first.nextState,
      stage: stageB,
      elements: first.nextElements,
      placementCaptures: [{
        elementId: source.elementId,
        expectedRuntimeKey: source.runtimeKey,
        transform: { position: [-4, 1, 3], rotationY: -1.2 },
      }],
    })!;

    const ltPlan = planStudioBg3dLtLayers<TestElement, StudioBg3dSceneDocument>({
      elements: second.nextElements,
      groups: [createLayerGroup("group-a", "3D LT 배경")],
      render: {
        kind: "separated",
        width: 1_200,
        height: 600,
        bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
        layers: [
          { role: "tone", pngDataUrl: PNG.tone, width: 1_200, height: 600 },
          { role: "main-line", pngDataUrl: PNG.line, width: 1_200, height: 600 },
        ],
      },
      targetElementId: "anchor-a",
    });
    if (!ltPlan.ok) throw new Error(`${ltPlan.code}: ${ltPlan.message}`);
    const detached = planStudioBg3dEditableCompositeDetach<
      TestElement,
      StudioBg3dSceneDocument
    >({
      plan: ltPlan,
      compositePngDataUrl: PNG.composite,
    });
    if (!detached.ok) throw new Error(`${detached.code}: ${detached.message}`);
    const removedA = planStudioShared3dStageCollectionRemoval({
      value: second.nextState,
      bundleIds: ["bundle-a"],
      elements: detached.nextElements,
    })!;

    const composite = removedA.nextElements.find(({ id }) => id === "anchor-a") as
      | TestImage
      | undefined;
    expect(composite).toMatchObject({
      src: PNG.composite,
      bg3dScene: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    });
    expect(composite).not.toHaveProperty("groupId");
    expect(composite).not.toHaveProperty("bg3dLtBundleId");
    expect(detached.nextGroups).toEqual([]);
    expect(removedA.nextState?.stages).toHaveLength(1);
    expect(removedA.nextState?.stages[0]).toMatchObject({
      background: { bundleId: "bundle-b" },
      characters: [{
        elementId: "shared-character",
        placement: { position: [-4, 1, 3], rotationY: -1.2 },
      }],
    });
    expect(removedA.restoredElementIds).toEqual([]);
    expect(removedA.nextElements.find(({ id }) => id === "shared-character")?.hidden)
      .toBe(true);

    const removedB = planStudioShared3dStageCollectionRemoval({
      value: removedA.nextState,
      bundleIds: ["bundle-b"],
      elements: removedA.nextElements,
    })!;
    expect(removedB.restoredElementIds).toEqual(["shared-character"]);
    expect(removedB.nextElements.find(({ id }) => id === "shared-character")?.hidden)
      .toBe(false);
    expect(elements.find(({ id }) => id === "shared-character")?.vrmScene)
      .toBe(characterScene);
  });
});
