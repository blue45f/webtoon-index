import { describe, expect, it } from "vitest";

import { hydrateStudioAiImageReferenceDocument } from "./ai/studio-ai-image-reference-roles";
import {
  appendStudioAiOperation,
  createEmptyStudioAiProvenanceDocument,
} from "./ai/studio-ai-provenance";
import {
  STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
  createDefaultStudioBg3dSceneDocument,
} from "./bg3d/studio-bg3d-scene-document";
import { createDefaultStudioDrawingAssistDocument } from "./brush/studio-drawing-assist-document";
import { createStudioLinked3dRenderPageFixture } from "./studio-linked-3d-render-test-fixture";
import {
  parseStudioProjectFile,
  resetStudioAiProvenanceForRemix,
  serializeStudioProjectFile,
  STUDIO_PROJECT_MAX_CANVAS_HEIGHT,
  STUDIO_PROJECT_MAX_PAGES,
} from "./studio-project-file";
import { createStudioReferenceBoardDocument } from "./studio-reference-board";
import {
  createStudioShared3dStageCollectionDocument,
  migrateStudioShared3dStageCollectionDocument,
} from "./studio-shared-3d-stage-collection";
import {
  STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
  STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
} from "./studio-shared-3d-stage-document";
import {
  STUDIO_VRM_SCENE_DOCUMENT_VERSION,
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "./vrm/studio-vrm-scene-document";

const page = { id: "p1", elements: [], bg: "#ffffff", bgGrad: null, canvasH: 1080 };
const PRIVATE_PROMPT = "원작자의 비공개 결말 프롬프트";
const AI_IMAGE_REFERENCES = hydrateStudioAiImageReferenceDocument({
  version: 1,
  references: [{
    id: "character-ref-1",
    role: "character",
    asset: { assetId: "asset-character-1", sha256: `sha256:${"a".repeat(64)}` },
    label: "주인공 정면",
    guidance: "얼굴 비율만 유지",
  }],
});

function schemaV1Scene(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const current = createDefaultStudioBg3dSceneDocument();
  const candidateCamera =
    overrides.camera && typeof overrides.camera === "object" && !Array.isArray(overrides.camera)
      ? overrides.camera as Record<string, unknown>
      : current.camera as unknown as Record<string, unknown>;
  const {
    nearClip: _discardedNearClip,
    up: _discardedUp,
    ...schemaV1Camera
  } = candidateCamera;
  return {
    ...current,
    ...overrides,
    version: 1,
    camera: schemaV1Camera,
    budgets: {
      complexity: {
        maxNodes: current.budgets.complexity.maxNodes,
        maxTriangles: current.budgets.complexity.maxTriangles,
        maxDrawCalls: current.budgets.complexity.maxDrawCalls,
        maxMaterials: current.budgets.complexity.maxMaterials,
        maxLights: current.budgets.complexity.maxLights,
        maxModelBytes: current.budgets.complexity.maxModelBytes,
      },
      textures: { ...current.budgets.textures },
    },
  };
}

function retainedAiProvenance() {
  return appendStudioAiOperation(
    createEmptyStudioAiProvenanceDocument(),
    {
      id: "operation-1",
      kind: "image",
      task: "background-image",
      provider: "image-provider",
      model: "image-v1",
      transport: "byok",
      promptVersion: 2,
      prompt: PRIVATE_PROMPT,
      createdAt: "2026-07-10T00:00:00.000Z",
      requestId: "private-provider-request",
      target: { pageId: "private-page", elementId: "private-element" },
    },
    { retainRawPrompt: true }
  );
}

describe("studio project file", () => {
  it("Canvas LT 레이어·공유 Stage·명시적 Shot의 linked3dRender를 함께 왕복하고 dangling 링크를 거부한다", () => {
    const linkedPage = createStudioLinked3dRenderPageFixture("page-linked-project");
    const { linked3dRender } = linkedPage;
    const project = {
      version: 2,
      pagesList: [{ ...page, ...linkedPage }],
    };

    const parsed = parseStudioProjectFile(project);
    expect(parsed.pagesList[0]?.linked3dRender).toEqual(linked3dRender);
    expect(parseStudioProjectFile(JSON.parse(serializeStudioProjectFile(parsed))))
      .toMatchObject({ pagesList: [{ linked3dRender }] });

    expect(() => parseStudioProjectFile({
      ...project,
      pagesList: [{
        ...project.pagesList[0],
        elements: [],
      }],
    })).toThrow("Canvas 권위");
    expect(() => parseStudioProjectFile({
      ...project,
      pagesList: [{
        ...project.pagesList[0],
        shared3dStage: undefined,
      }],
    })).toThrow("Canvas 권위");
    expect(() => parseStudioProjectFile({
      ...project,
      pagesList: [{
        ...project.pagesList[0],
        linked3dRender: undefined,
      }],
    })).toThrow("reserved 상태");
    expect(() => parseStudioProjectFile({
      ...project,
      master: {
        elements: [{
          id: "master-linked-raster",
          type: "image",
          src: linked3dRender!.links[0]!.passRevision.artifact.locator,
        }],
      },
    })).toThrow("문서 마스터");
  });

  it("페이지 Shared Stage v1을 v3 컬렉션으로 승격하고 손상·미래 버전을 전체 거부한다", () => {
    const shared3dStage = {
      kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
      version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "require-all-linked",
      background: {
        bundleId: "bundle-1",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      characters: [{
        elementId: "character-1",
        modelRuntimeKey: `character-1:sha256:${"c".repeat(64)}`,
        sourceHash: `sha256:${"b".repeat(64)}`,
        hiddenByStage: true,
      }],
    };
    const migrated = migrateStudioShared3dStageCollectionDocument(shared3dStage)!;
    const project = {
      version: 2,
      pagesList: [{ ...page, shared3dStage }],
    };

    const parsed = parseStudioProjectFile(project);
    expect(parsed.pagesList[0]?.shared3dStage).toEqual(migrated);
    expect(parseStudioProjectFile(JSON.parse(serializeStudioProjectFile(project))))
      .toMatchObject({ pagesList: [{ shared3dStage: migrated }] });

    expect(() => parseStudioProjectFile({
      ...project,
      pagesList: [{
        ...page,
        shared3dStage: { ...shared3dStage, version: 2 },
      }],
    })).toThrow("공유 3D Stage");
    expect(() => parseStudioProjectFile({
      ...project,
      pagesList: [{
        ...page,
        shared3dStage: { ...shared3dStage, unknownRuntimeKey: true },
      }],
    })).toThrow("공유 3D Stage");
  });

  it("두 배경을 가진 native v3 공유 3D 장면을 직렬화 왕복해도 정확히 보존한다", () => {
    const createLegacyStage = (bundleId: string, characterId: string, seed: string) => ({
      kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
      version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "require-all-linked",
      background: {
        bundleId,
        sourceHash: `sha256:${seed.repeat(64)}`,
      },
      characters: [{
        elementId: characterId,
        modelRuntimeKey: `${characterId}:sha256:${seed.repeat(64)}`,
        sourceHash: `sha256:${seed.repeat(64)}`,
        hiddenByStage: true,
      }],
    });
    const first = migrateStudioShared3dStageCollectionDocument(
      createLegacyStage("bundle-a", "character-a", "a"),
    )!;
    const second = migrateStudioShared3dStageCollectionDocument(
      createLegacyStage("bundle-b", "character-b", "b"),
    )!;
    const collection = {
      ...first,
      stages: [...first.stages, ...second.stages],
      visibilityReceipts: [
        ...first.visibilityReceipts,
        ...second.visibilityReceipts,
      ],
    };
    const project = {
      version: 2,
      pagesList: [{ ...page, shared3dStage: collection }],
    };

    const parsed = parseStudioProjectFile(project);
    expect(parsed.pagesList[0]?.shared3dStage).toEqual(collection);
    expect(parseStudioProjectFile(JSON.parse(serializeStudioProjectFile(parsed))))
      .toMatchObject({ pagesList: [{ shared3dStage: collection }] });
  });

  it("65개 shared 3D Stage의 v4 page authority를 프로젝트 저장·재열기에서 보존한다", () => {
    const seed = migrateStudioShared3dStageCollectionDocument({
      kind: STUDIO_SHARED_3D_STAGE_DOCUMENT_KIND,
      version: STUDIO_SHARED_3D_STAGE_DOCUMENT_VERSION,
      authority: "page-background-with-linked-character-sources",
      capturePolicy: "background-only",
      background: {
        bundleId: "bundle-seed",
        sourceHash: `sha256:${"a".repeat(64)}`,
      },
      characters: [],
    })!;
    const stages = Array.from({ length: 65 }, (_, index) => ({
      ...seed.stages[0]!,
      id: `stage-${index}`,
      background: {
        ...seed.stages[0]!.background,
        bundleId: `bundle-${index}`,
      },
    }));
    const collection = createStudioShared3dStageCollectionDocument({
      stages,
      visibilityReceipts: [],
    });
    if (!collection || collection.version !== 4) {
      throw new Error("Expected a paged shared 3D Stage collection.");
    }
    const project = parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, shared3dStage: collection }],
    });
    const reopened = parseStudioProjectFile(JSON.parse(serializeStudioProjectFile(project)));

    const reopenedCollection = migrateStudioShared3dStageCollectionDocument(
      reopened.pagesList[0]?.shared3dStage,
    );
    expect(reopenedCollection?.version).toBe(4);
    expect(reopenedCollection?.stages.map((stage) => stage.id))
      .toEqual(stages.map((stage) => stage.id));
  });

  it("v2 문서의 게시·편집 메타데이터를 함께 보존한다", () => {
    expect(
      parseStudioProjectFile({
        version: 2,
        title: "제목",
        description: "설명",
        tagsText: "일상, 학원",
        pagesList: [page],
        currentPageId: "p1",
        webtoonTheme: "soft",
        panelGutter: 32,
        characterBible: { version: 1, characters: [{ id: "hero", name: "윤슬" }] },
        writerRoom: { version: 1, stages: { premise: { text: "비밀" } } },
        comments: { version: 1, threads: [{ id: "comment-1" }] },
        releaseSchedule: { version: 1, items: [{ id: "release-1" }] },
        publicationAnalytics: { version: 1, records: [{ id: "metric-1" }] },
        publishPack: { profile: "webtoon", aiUsage: "assisted", disclosure: "번역 초안에 AI 사용" },
      })
    ).toMatchObject({
      description: "설명",
      tagsText: "일상, 학원",
      webtoonTheme: "soft",
      panelGutter: 32,
      characterBible: { version: 1, characters: [{ id: "hero", name: "윤슬" }] },
      writerRoom: { version: 1, stages: { premise: { text: "비밀" } } },
      comments: { version: 1, threads: [{ id: "comment-1" }] },
      releaseSchedule: { version: 1, items: [{ id: "release-1" }] },
      publicationAnalytics: { version: 1, records: [{ id: "metric-1" }] },
      publishPack: { profile: "webtoon", aiUsage: "assisted", disclosure: "번역 초안에 AI 사용" },
    });
  });

  it("페이지 리뷰 메타데이터를 정규화해 잠금 상태를 안전 값으로 바꾼다", () => {
    const parsed = parseStudioProjectFile({
      version: 2,
      title: "잠금 정규화",
      description: "검증",
      tagsText: "test",
      pagesList: [{
        ...page,
        review: { status: "done", locked: "yes", assignee: 111 },
      }],
      currentPageId: "p1",
      webtoonTheme: "classic",
      panelGutter: 24,
    });

    expect(parsed.pagesList[0].review).toEqual({ status: "draft", locked: false });
  });

  it("기존 1.0 pages 파일을 v2 형태로 마이그레이션한다", () => {
    expect(parseStudioProjectFile({ version: "1.0", title: "과거", pages: [page] })).toMatchObject({
      version: 2,
      title: "과거",
      pagesList: [page],
      currentPageId: "p1",
    });
  });

  it("프로젝트 AI 이력을 정규화하고 가져오기에서 원문 프롬프트를 제거한다", () => {
    const serialized = serializeStudioProjectFile({
      version: 2,
      pagesList: [page],
      aiProvenance: retainedAiProvenance(),
    });
    const parsed = parseStudioProjectFile(JSON.parse(serialized));

    expect(serialized).not.toContain(PRIVATE_PROMPT);
    expect(parsed.aiProvenance?.operations).toHaveLength(1);
    expect(parsed.aiProvenance?.operations[0].prompt.retention).toBe("hash-only");
    expect(parsed.aiProvenance?.operations[0].prompt).not.toHaveProperty("raw");
    expect(JSON.stringify(parsed)).not.toContain(PRIVATE_PROMPT);
  });

  it("레거시 프로젝트의 AI 이력도 보존하고 이력 없는 파일은 선택 필드를 만들지 않는다", () => {
    const withHistory = parseStudioProjectFile({
      version: "1.0",
      title: "과거",
      pages: [page],
      aiProvenance: retainedAiProvenance(),
    });
    const withoutHistory = parseStudioProjectFile({ version: "1.0", title: "과거", pages: [page] });

    expect(withHistory.aiProvenance?.operations).toHaveLength(1);
    expect(withoutHistory.aiProvenance).toBeUndefined();
  });

  it("리믹스는 원작자의 AI 이력을 상속하지 않고 독립된 빈 이력으로 시작한다", () => {
    const source = parseStudioProjectFile({
      version: 2,
      pagesList: [page],
      aiProvenance: retainedAiProvenance(),
    });
    const remix = resetStudioAiProvenanceForRemix();

    expect(source.aiProvenance?.operations).toHaveLength(1);
    expect(remix).toEqual({ version: 1, operations: [] });
    expect(JSON.stringify(remix)).not.toContain(source.aiProvenance?.operations[0].prompt.sha256);
  });

  it("페이지가 없거나 페이지 구조가 손상된 파일을 거부한다", () => {
    expect(() => parseStudioProjectFile({ version: 2, title: "빈 파일", pagesList: [] })).toThrow(/프로젝트/);
    expect(() => parseStudioProjectFile({ version: 2, pagesList: [{ id: "p1" }] })).toThrow(/프로젝트/);
    expect(() => parseStudioProjectFile({
      version: 2,
      pagesList: [page],
      master: { elements: Array.from({ length: 10_001 }, (_, index) => ({ id: `m-${index}` })) },
    })).toThrow(/마스터 요소 수/);
    expect(() => parseStudioProjectFile({
      version: 2,
      pagesList: Array.from({ length: STUDIO_PROJECT_MAX_PAGES + 1 }, (_, index) => ({
        ...page,
        id: `p-${index}`,
      })),
    })).toThrow(/프로젝트/);
    expect(() => parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, canvasH: STUDIO_PROJECT_MAX_CANVAS_HEIGHT + 1 }],
    })).toThrow(/프로젝트/);
  });

  it("페이지와 마스터의 canonical 3D 배경 장면을 별도 메타데이터로 왕복한다", () => {
    const scene = createDefaultStudioBg3dSceneDocument();
    const image = {
      id: "image-1",
      type: "image",
      src: "data:image/png;base64,iVBORw0KGgo=",
      bg3dScene: scene,
    };
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, elements: [image] }],
      master: { elements: [{ ...image, id: "master-image" }] },
    });
    const pageImage = parsed.pagesList[0].elements[0] as typeof image;
    const masterImage = (parsed.master as { elements: typeof image[] }).elements[0];

    expect(pageImage.src).not.toContain("#");
    expect(pageImage.bg3dScene).toEqual(scene);
    expect(masterImage.bg3dScene).toEqual(scene);
    expect(JSON.parse(serializeStudioProjectFile(parsed)).pagesList[0].elements[0].bg3dScene).toEqual(scene);
  });

  it("VRM 포저 장면을 캡처 PNG와 분리해 페이지·마스터로 왕복하고 손상본은 거부한다", () => {
    const vrmScene = createStudioVrmSceneDocument({
      source: "bundled",
      id: "sample-vrm",
      name: "루미",
    });
    const image = {
      id: "vrm-image-1",
      type: "image",
      src: "data:image/png;base64,iVBORw0KGgo=",
      vrmScene,
    };
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, elements: [image] }],
      master: { elements: [{ ...image, id: "master-vrm-image" }] },
    });
    const pageImage = parsed.pagesList[0].elements[0] as typeof image;
    const masterImage = (parsed.master as { elements: typeof image[] }).elements[0];

    expect(pageImage.src).not.toContain("#");
    expect(pageImage.vrmScene).toEqual(vrmScene);
    expect(masterImage.vrmScene).toEqual(vrmScene);
    expect(JSON.parse(serializeStudioProjectFile(parsed)).pagesList[0].elements[0].vrmScene)
      .toEqual(vrmScene);

    expect(() => parseStudioProjectFile({
      version: 2,
      pagesList: [{
        ...page,
        elements: [{ ...image, vrmScene: { ...vrmScene, version: 99 } }],
      }],
    })).toThrow(/3D 데생 인형 장면/);
  });

  it("페이지와 마스터의 strict VRM v1 장면을 authored 값 손실 없이 현재 장면으로 승격한다", () => {
    const current = normalizeStudioVrmSceneDocument({
      ...createStudioVrmSceneDocument(),
      pose: {
        bones: {
          leftUpperArm: { rotation: [0.25, -0.5, 0.75] },
          rightUpperArm: { rotation: [0.25, 0.5, -0.75] },
        },
        yOffset: 0.12,
        bodyRotationY: -0.35,
        fingerOverrides: {
          leftIndexProximal: [0.1, 0.2, -0.3],
          rightIndexProximal: [0.1, -0.2, 0.3],
        },
      },
      expressions: { happy: 0.7 },
      props: { items: [{ id: "book" }] },
    });
    const {
      rig: _rig,
      surfacePaint: _surfacePaint,
      lightingTone: _lightingTone,
      ...versionOne
    } = JSON.parse(JSON.stringify(current)) as Record<string, unknown> & {
      rig: unknown;
      surfacePaint: unknown;
      lightingTone: unknown;
    };
    delete ((versionOne.pose as Record<string, unknown>).translations);
    delete ((versionOne.pose as Record<string, unknown>).ikConstraints);
    versionOne.version = 1;
    const image = {
      id: "legacy-vrm-image",
      type: "image",
      src: "data:image/png;base64,iVBORw0KGgo=",
      vrmScene: versionOne,
    };

    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, elements: [image] }],
      master: { elements: [{ ...image, id: "legacy-vrm-master" }] },
    });
    const pageScene = (parsed.pagesList[0].elements[0] as {
      vrmScene: ReturnType<typeof createStudioVrmSceneDocument>;
    }).vrmScene;
    const masterScene = ((parsed.master as { elements: Array<{ vrmScene: typeof pageScene }> })
      .elements[0]).vrmScene;

    for (const scene of [pageScene, masterScene]) {
      expect(scene.version).toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
      expect(scene.pose).toEqual(current.pose);
      expect(scene.expressions).toEqual(current.expressions);
      expect(scene.props).toEqual(current.props);
      expect(scene.lightingTone).toBe("morning");
      expect(scene.rig).toMatchObject({
        version: 1,
        jointProfile: { version: 1, id: "neutral" },
        fullBodyIk: false,
        footPlant: false,
        floorHeight: 0,
      });
      expect(scene.pose.translations).toEqual({
        version: 1,
        root: [0, 0, 0],
        hips: [0, 0, 0],
        spine: [0, 0, 0],
      });
    }
    const serialized = JSON.parse(serializeStudioProjectFile(parsed));
    expect(serialized.pagesList[0].elements[0].vrmScene.version)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(serialized.master.elements[0].vrmScene.version)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
  });

  it("페이지별 드로잉 보조 문서를 프로젝트 파일로 왕복하고 손상본은 거부한다", () => {
    const drawingAssist = createDefaultStudioDrawingAssistDocument({
      canvasWidth: 800,
      canvasHeight: 1_080,
    });
    drawingAssist.perspective = {
      active: true,
      points: [{ id: "vp-a", x: 400, y: 320 }],
      eyeLevelY: 320,
      lockHorizon: false,
    };
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, drawingAssist }],
    });
    expect(parsed.pagesList[0].drawingAssist).toEqual(drawingAssist);
    expect(JSON.parse(serializeStudioProjectFile(parsed)).pagesList[0].drawingAssist)
      .toEqual(drawingAssist);

    expect(() => parseStudioProjectFile({
      version: 2,
      pagesList: [{
        ...page,
        drawingAssist: {
          ...drawingAssist,
          isometric: { ...drawingAssist.isometric, active: true },
        },
      }],
    })).toThrow(/드로잉 보조/);
  });

  it("여러 포즈 참고의 해시·변형·z순서를 프로젝트로 왕복하고 바이너리 URL은 거부한다", () => {
    const referenceBoard = createStudioReferenceBoardDocument([
      {
        id: "reference-back",
        asset: {
          sha256: `sha256:${"a".repeat(64)}`,
          assetId: "device-asset-a",
          name: "전신 포즈",
          mimeType: "image/png",
          width: 1200,
          height: 1800,
        },
        view: {
          centerX: 0.35,
          centerY: 0.55,
          zoom: 0.8,
          rotationDeg: -12,
          flipX: false,
          flipY: false,
          opacity: 0.72,
          grayscale: true,
        },
      },
      {
        id: "reference-front",
        asset: { sha256: `sha256:${"b".repeat(64)}` },
        view: {
          centerX: 0.7,
          centerY: 0.4,
          zoom: 1.4,
          rotationDeg: 18,
          flipX: true,
          flipY: false,
          opacity: 1,
          grayscale: false,
        },
      },
    ]);
    const parsed = parseStudioProjectFile({ version: 2, pagesList: [page], referenceBoard });

    expect(parsed.referenceBoard).toEqual(referenceBoard);
    expect(JSON.parse(serializeStudioProjectFile(parsed)).referenceBoard).toEqual(referenceBoard);
    expect(JSON.stringify(parsed.referenceBoard)).not.toContain("data:");

    expect(() => parseStudioProjectFile({
      version: 2,
      pagesList: [page],
      referenceBoard: {
        version: 1,
        items: [{
          id: "unsafe",
          asset: { sha256: "data:image/png;base64,AA==" },
          view: referenceBoard.items[0]?.view,
        }],
      },
    })).toThrow(/포즈 참고 보드/);
  });

  it("페이지와 마스터에 저장된 실제 schema-v1 3D 장면을 v2로 마이그레이션한다", () => {
    const scene = schemaV1Scene();
    const image = {
      id: "image-1",
      type: "image",
      src: "data:image/png;base64,iVBORw0KGgo=",
      bg3dScene: scene,
    };
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [{ ...page, elements: [image] }],
      master: { elements: [{ ...image, id: "master-image" }] },
    });
    const pageScene = (parsed.pagesList[0].elements[0] as typeof image).bg3dScene;
    const masterScene = ((parsed.master as { elements: typeof image[] }).elements[0]).bg3dScene;

    expect(pageScene).toMatchObject({
      version: STUDIO_BG3D_SCENE_DOCUMENT_VERSION,
      budgets: {
        complexity: {
          maxAnimations: expect.any(Number),
          maxDecodedGeometryBytes: expect.any(Number),
        },
      },
    });
    expect(masterScene).toEqual(pageScene);
  });

  it("schema-v1 파노라마 URL만 제거하고 3D 편집 원본을 보존해 가져온다", () => {
    const current = createDefaultStudioBg3dSceneDocument();
    const historicalScene = schemaV1Scene({
      camera: { ...current.camera, position: [8, 4, 6] },
      background: {
        ...current.background,
        skyPresetId: "sunset",
        panoramaRotation: 35,
        panoramaUrl: "https://private.invalid/legacy.webp?access_token=secret",
      },
    });
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [{
        ...page,
        elements: [{
          id: "image-1",
          type: "image",
          src: "data:image/png;base64,AA==",
          bg3dScene: historicalScene,
        }],
      }],
    });
    const image = parsed.pagesList[0].elements[0] as Record<string, unknown>;
    const migrated = image.bg3dScene as typeof current;

    expect(migrated.version).toBe(STUDIO_BG3D_SCENE_DOCUMENT_VERSION);
    expect(migrated.camera.position).toEqual([8, 4, 6]);
    expect(migrated.background).toMatchObject({
      panoramaRotation: 35,
      skyPresetId: "sunset",
    });
    expect(JSON.stringify(migrated)).not.toContain("panoramaUrl");
    expect(JSON.stringify(migrated)).not.toContain("private.invalid");
    expect(JSON.stringify(migrated)).not.toContain("access_token");
  });

  it("3D 장면의 알 수 없는 런타임 필드를 조용히 제거하지 않고 가져오기를 거부한다", () => {
    const scene = {
      ...createDefaultStudioBg3dSceneDocument(),
      runtimeUrl: "blob:https://private.invalid/model",
      storageKey: "private-indexed-db-key",
    };
    const input = {
      version: 2,
      pagesList: [{
        ...page,
        elements: [{ id: "image-1", type: "image", src: "data:image/png;base64,AA==", bg3dScene: scene }],
      }],
    };
    expect(() => parseStudioProjectFile(input)).toThrow(/3D 배경 장면/);
    expect(scene).toHaveProperty("runtimeUrl");
    expect(scene).toHaveProperty("storageKey");
  });

  it("손상되거나 미래 버전인 canonical 3D 장면은 조용히 유실시키지 않고 프로젝트 가져오기를 거부한다", () => {
    const withScene = (bg3dScene: unknown) => ({
      version: 2,
      pagesList: [{
        ...page,
        elements: [{ id: "image-1", type: "image", src: "data:image/png;base64,AA==", bg3dScene }],
      }],
    });

    expect(() => parseStudioProjectFile(withScene({
      ...createDefaultStudioBg3dSceneDocument(),
      version: 99,
    }))).toThrow(/3D 배경 장면/);
    expect(() => parseStudioProjectFile(withScene({
      kind: "toonspectrum.bg3d-scene",
      version: 1,
      nodes: [],
      attachments: [],
    }))).toThrow(/3D 배경 장면/);
    expect(() => parseStudioProjectFile(withScene({
      tool: "bg3d",
      primitives: [],
    }))).toThrow(/3D 배경 장면/);
    expect(() => parseStudioProjectFile(withScene({
      ...createDefaultStudioBg3dSceneDocument(),
      attachments: [{
        id: "broken-model",
        name: "broken.glb",
        mime: "model/gltf-binary",
        byteSize: 48,
        hash: "sha256:broken",
        rights: { status: "owned", commercialUse: true, attributionRequired: false },
        source: "upload",
      }],
      nodes: [{
        id: "broken-node",
        name: "손상 모델",
        kind: "model",
        attachmentId: "broken-model",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        visible: true,
        castsShadow: true,
        receivesShadow: true,
      }],
    }))).toThrow(/3D 배경 장면/);
  });

  it("레거시 PNG fragment는 기존 호환 경로를 위해 그대로 보존한다", () => {
    const src = "data:image/png;base64,AA==#%7B%22tool%22%3A%22bg3d%22%2C%22primitives%22%3A%5B%5D%7D";
    const parsed = parseStudioProjectFile({
      version: "1.0",
      pages: [{
        ...page,
        elements: [{ id: "legacy-bg", type: "image", src }],
      }],
    });
    const image = parsed.pagesList[0].elements[0] as Record<string, unknown>;

    expect(image.src).toBe(src);
    expect(image).not.toHaveProperty("bg3dScene");
  });

  it("preserves metadata-only AI image roles in canonical project JSON", () => {
    const parsed = parseStudioProjectFile({
      version: 2,
      pagesList: [page],
      aiImageReferences: AI_IMAGE_REFERENCES,
    });
    expect(parsed.aiImageReferences).toEqual(AI_IMAGE_REFERENCES);
    expect(JSON.parse(serializeStudioProjectFile(parsed)).aiImageReferences)
      .toEqual(AI_IMAGE_REFERENCES);
    expect(JSON.stringify(parsed.aiImageReferences)).not.toContain("data:");
  });
});
