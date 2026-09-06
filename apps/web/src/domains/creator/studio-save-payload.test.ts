import { describe, expect, it } from "vitest";

import { createEmptyStudioAiImageReferenceDocument } from "./ai/studio-ai-image-reference-roles";
import { createEmptyStudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import { createEmptyStudioCharacterBible } from "./studio-character-bible";
import { createEmptyStudioCommentsDocument } from "./studio-comments";
import { creatorWorkSnapshotToStudioProject } from "./studio-creator-work-project";
import { createStudioLinked3dRenderPageFixture } from "./studio-linked-3d-render-test-fixture";
import { createEmptyStudioPublicationAnalyticsDocument } from "./studio-publication-analytics";
import { DEFAULT_STUDIO_PUBLISH_COMPLIANCE } from "./studio-publish-compliance";
import { DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS } from "./studio-publish-package";
import { createDefaultStudioReferenceBoardDocument } from "./studio-reference-board";
import { createEmptyStudioReleaseSchedule } from "./studio-release-schedule";
import {
  buildStudioDirectWorkSavePlan,
  buildStudioSavePayload,
  buildStudioSharedSavePatch,
  normalizeStudioSaveTags,
  type BuildStudioSavePayloadInput,
} from "./studio-save-payload";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";
import { createNativePluralShared3dStageFixture } from "./studio-shared-3d-stage-test-fixture";
import { createEmptyStudioWriterRoomDocument } from "./studio-writer-room";

function saveInput(
  overrides: Partial<BuildStudioSavePayloadInput> = {},
): BuildStudioSavePayloadInput {
  return {
    title: "  1화 제목  ",
    description: "  소개 문구  ",
    tagsText: " #hero, drama\n#night  #hero one two three four five six",
    linkedTitleId: "title-1",
    cover: "data:image/webp;base64,cover",
    pageImages: ["data:image/png;base64,page-1", "data:image/png;base64,page-2"],
    document: {
      extensionBase: {
        fxOwnerExtension: { version: 2 },
        width: 320,
        pagesList: ["stale"],
        publishPack: { profile: "stale" },
      },
      width: 800,
      pagesList: [
        { id: "page-1", elements: [], bg: "#ffffff", bgGrad: null, canvasH: 1_200 },
        { id: "page-2", elements: [], bg: "#ffffff", bgGrad: null, canvasH: 1_600 },
      ],
      master: undefined,
      characterBible: createEmptyStudioCharacterBible(),
      writerRoom: createEmptyStudioWriterRoomDocument(),
      aiProvenance: createEmptyStudioAiProvenanceDocument(),
      aiImageReferences: createEmptyStudioAiImageReferenceDocument(),
      comments: createEmptyStudioCommentsDocument(),
      releaseSchedule: createEmptyStudioReleaseSchedule(),
      publicationAnalytics: createEmptyStudioPublicationAnalyticsDocument(),
      referenceBoard: createDefaultStudioReferenceBoardDocument(),
      currentPageId: "page-1",
      webtoonTheme: "classic",
      panelGutter: 24,
      publishPack: {
        profile: "webtoon",
        aiUsage: "assisted",
        disclosure: "배경 초안에 AI 보조 사용",
        compliance: {
          ...DEFAULT_STUDIO_PUBLISH_COMPLIANCE,
          ownershipRightsConfirmed: true,
        },
        packageSettings: DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        packageCredits: "배경 모델: 자체 제작",
      },
    },
    status: "draft",
    workId: null,
    remixId: "source-work",
    linkedSeriesId: "series-1",
    linkedChallengeId: "challenge-1",
    ...overrides,
  };
}

describe("normalizeStudioSaveTags", () => {
  it("preserves the editor's trim, hash removal, ordering, duplicates, and eight-tag cap", () => {
    expect(
      normalizeStudioSaveTags(
        " #hero, drama\n#night  #hero one two three four five six",
      ),
    ).toEqual([
      "hero",
      "drama",
      "night",
      "hero",
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});

describe("buildStudioSavePayload", () => {
  it("rejects page-owned linked-pass locators inside the document master", () => {
    const linkedPage = createStudioLinked3dRenderPageFixture("master-linked-page");
    const linkedRaster = linkedPage.elements.find((element) =>
      element.type === "image" && element.src.startsWith("studio-opfs-cas:"));
    expect(linkedRaster).toBeDefined();
    expect(() => buildStudioSavePayload(saveInput({
      document: {
        ...saveInput().document,
        master: { elements: [linkedRaster!] },
      },
    }))).toThrow("문서 마스터");
  });

  it("rejects a reserved locator hidden in a nested page raster field without a sidecar", () => {
    const linkedPage = createStudioLinked3dRenderPageFixture("nested-linked-page");
    const linkedRaster = linkedPage.elements.find((element) =>
      element.type === "image" && element.src.startsWith("studio-opfs-cas:"));
    expect(linkedRaster?.type).toBe("image");
    if (!linkedRaster || linkedRaster.type !== "image") throw new Error("fixture missing image");
    expect(() => buildStudioSavePayload(saveInput({
      document: {
        ...saveInput().document,
        pagesList: [{
          ...saveInput().document.pagesList[0]!,
          elements: [{
            ...linkedRaster,
            src: "data:image/png;base64,ordinary",
            maskSrc: linkedRaster.src,
            bg3dScene: undefined,
            bg3dLtBundleId: undefined,
            bg3dLtRole: undefined,
          }],
        }],
      },
    }))).toThrow("reserved 상태");
  });

  it("projects the captured snapshot while preserving extension fields and owned-field precedence", () => {
    const input = saveInput();
    const extensionBase = input.document.extensionBase;
    const payload = buildStudioSavePayload(input);

    expect(payload).toEqual({
      title: "1화 제목",
      description: "소개 문구",
      tags: ["hero", "drama", "night", "hero", "one", "two", "three", "four"],
      format: "cuttoon",
      titleId: "title-1",
      cover: "data:image/webp;base64,cover",
      pages: input.pageImages,
      doc: {
        fxOwnerExtension: { version: 2 },
        width: 800,
        pagesList: input.document.pagesList,
        master: undefined,
        characterBible: input.document.characterBible,
        writerRoom: input.document.writerRoom,
        aiProvenance: input.document.aiProvenance,
        aiImageReferences: input.document.aiImageReferences,
        comments: input.document.comments,
        releaseSchedule: input.document.releaseSchedule,
        publicationAnalytics: input.document.publicationAnalytics,
        referenceBoard: input.document.referenceBoard,
        currentPageId: "page-1",
        webtoonTheme: "classic",
        panelGutter: 24,
        publishPack: input.document.publishPack,
      },
      status: "draft",
      remixFromId: "source-work",
      seriesId: "series-1",
      challengeId: "challenge-1",
    });
    expect(payload.pages).toBe(input.pageImages);
    expect(payload.doc.pagesList).toBe(input.document.pagesList);
    expect(payload.doc.publishPack).toBe(input.document.publishPack);
    expect(input.document.extensionBase).toBe(extensionBase);
    expect(input.document.extensionBase).toEqual({
      fxOwnerExtension: { version: 2 },
      width: 320,
      pagesList: ["stale"],
      publishPack: { profile: "stale" },
    });
  });

  it("includes remix provenance only for a new work and preserves nullish link semantics", () => {
    const created = buildStudioSavePayload(saveInput({
      workId: null,
      remixId: "source-work",
      linkedTitleId: null,
      linkedSeriesId: null,
      linkedChallengeId: "",
    }));
    const updated = buildStudioSavePayload(saveInput({
      workId: "work-1",
      remixId: "source-work",
    }));

    expect(created).toMatchObject({
      titleId: undefined,
      remixFromId: "source-work",
      seriesId: undefined,
      challengeId: "",
    });
    expect(updated.remixFromId).toBeUndefined();
  });

  it("round-trips the canonical Shared Stage through save-payload to creator-work projection", () => {
    const shared3dStage = {
      kind: "toonspectrum.studio-shared-3d-stage" as const,
      version: 1 as const,
      authority: "page-background-with-linked-character-sources" as const,
      capturePolicy: "require-all-linked" as const,
      background: {
        bundleId: "bundle-1",
        sourceHash: `sha256:${"a".repeat(64)}` as const,
      },
      characters: [{
        elementId: "character-1",
        modelRuntimeKey: `character-1:sha256:${"b".repeat(64)}`,
        sourceHash: `sha256:${"c".repeat(64)}` as const,
        hiddenByStage: true as const,
      }],
    };
    const migrated = migrateStudioShared3dStageCollectionDocument(shared3dStage)!;
    const base = saveInput();
    const pagesList = base.document.pagesList.map((page, index) =>
      index === 0 ? { ...page, shared3dStage } : page);
    const payload = buildStudioSavePayload({
      ...base,
      document: { ...base.document, pagesList },
    });
    const hydrated = creatorWorkSnapshotToStudioProject(payload);
    const savedPages = (payload.doc as { pagesList?: unknown[] }).pagesList;

    expect(savedPages?.[0]).toMatchObject({ shared3dStage: migrated });
    expect(hydrated.pagesList[0]?.shared3dStage).toEqual(migrated);
  });

  it("round-trips two native v2 Stages and DCC provenance through the server payload", () => {
    const shared3dStage = createNativePluralShared3dStageFixture();
    const base = saveInput();
    const payload = buildStudioSavePayload({
      ...base,
      document: {
        ...base.document,
        pagesList: base.document.pagesList.map((page, index) =>
          index === 0 ? { ...page, shared3dStage } : page),
      },
    });
    const hydrated = creatorWorkSnapshotToStudioProject(payload);

    expect((payload.doc as { pagesList?: Array<{ shared3dStage?: unknown }> })
      .pagesList?.[0]?.shared3dStage).toEqual(shared3dStage);
    expect(hydrated.pagesList[0]?.shared3dStage).toEqual(shared3dStage);
  });

  it("round-trips the linked Scene Shot receipt and rejects a dangling save candidate", () => {
    const linkedPage = createStudioLinked3dRenderPageFixture();
    const base = saveInput();
    const payload = buildStudioSavePayload({
      ...base,
      document: { ...base.document, pagesList: [linkedPage] },
    });
    const savedPage = (payload.doc as { pagesList?: typeof base.document.pagesList }).pagesList?.[0];
    const hydrated = creatorWorkSnapshotToStudioProject(payload);

    expect(savedPage?.linked3dRender).toEqual(linkedPage.linked3dRender);
    expect(savedPage?.shared3dStage).toEqual(linkedPage.shared3dStage);
    expect(hydrated.pagesList[0]?.linked3dRender).toEqual(linkedPage.linked3dRender);
    expect(() => buildStudioSavePayload({
      ...base,
      document: {
        ...base.document,
        pagesList: [{ ...linkedPage, shared3dStage: undefined }],
      },
    })).toThrow("연결형 3D 렌더 권위");
    expect(() => buildStudioSavePayload({
      ...base,
      document: {
        ...base.document,
        pagesList: [{ ...linkedPage, linked3dRender: undefined }],
      },
    })).toThrow("reserved 상태");
  });
});

describe("buildStudioSharedSavePatch", () => {
  it("includes status for the owner and strips owner-only state for collaborators", () => {
    const payload = buildStudioSavePayload(saveInput({ status: "published" }));
    const ownerPatch = buildStudioSharedSavePatch({
      payload,
      baseRevision: 7,
      crdtServerSequence: "42",
      role: "owner",
    });
    const editorPatch = buildStudioSharedSavePatch({
      payload,
      baseRevision: 7,
      crdtServerSequence: "42",
      role: "editor",
    });

    expect(ownerPatch).toEqual({
      baseRevision: 7,
      crdtServerSequence: "42",
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      cover: payload.cover,
      pages: payload.pages,
      doc: payload.doc,
      status: "published",
    });
    expect(editorPatch).toEqual({
      baseRevision: 7,
      crdtServerSequence: "42",
      title: payload.title,
      description: payload.description,
      tags: payload.tags,
      cover: payload.cover,
      pages: payload.pages,
      doc: payload.doc,
    });
    expect(editorPatch).not.toHaveProperty("titleId");
    expect(editorPatch).not.toHaveProperty("status");
    expect(payload.status).toBe("published");
  });
});

describe("buildStudioDirectWorkSavePlan", () => {
  it("keeps create payload identity and adds a revision only to updates", () => {
    const payload = buildStudioSavePayload(saveInput());
    const createPlan = buildStudioDirectWorkSavePlan({ payload });
    const updatePlan = buildStudioDirectWorkSavePlan({
      payload,
      workId: "work-1",
      baseRevision: 9,
    });

    expect(createPlan).toEqual({ kind: "create", payload });
    expect(createPlan.payload).toBe(payload);
    expect(updatePlan).toEqual({
      kind: "update",
      workId: "work-1",
      payload: { ...payload, baseRevision: 9 },
    });
    expect(updatePlan.payload).not.toBe(payload);
    expect(payload).not.toHaveProperty("baseRevision");
  });

  it("preserves the former truthy revision gate", () => {
    const payload = buildStudioSavePayload(saveInput());
    const plan = buildStudioDirectWorkSavePlan({
      payload,
      workId: "work-1",
      baseRevision: 0,
    });

    expect(plan.kind).toBe("update");
    expect(plan.payload).not.toHaveProperty("baseRevision");
  });
});
