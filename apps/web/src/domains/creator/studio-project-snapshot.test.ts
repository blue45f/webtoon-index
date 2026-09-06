import { describe, expect, it } from "vitest";

import {
  createEmptyStudioAiImageReferenceDocument,
  hydrateStudioAiImageReferenceDocument,
} from "./ai/studio-ai-image-reference-roles";
import { createEmptyStudioAiProvenanceDocument } from "./ai/studio-ai-provenance";
import { createDefaultStudioDrawingAssistDocument } from "./brush/studio-drawing-assist-document";
import {
  createEmptyStudioCharacterBible,
  normalizeStudioCharacterBible,
} from "./studio-character-bible";
import { createEmptyStudioCommentsDocument } from "./studio-comments";
import { createStudioLinked3dRenderPageFixture } from "./studio-linked-3d-render-test-fixture";
import { parseStudioProjectFile, serializeStudioProjectFile } from "./studio-project-file";
import {
  buildStudioProjectFileSnapshot,
  resolveStudioDurableProjectPages,
  studioProjectSnapshotHasMeaningfulContent,
  type BuildStudioProjectFileSnapshotInput,
} from "./studio-project-snapshot";
import { createEmptyStudioPublicationAnalyticsDocument } from "./studio-publication-analytics";
import { normalizeStudioPublishCompliance } from "./studio-publish-compliance";
import { DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS } from "./studio-publish-package";
import {
  createDefaultStudioReferenceBoardDocument,
  createStudioReferenceBoardDocument,
  createStudioReferenceBoardItem,
} from "./studio-reference-board";
import { createEmptyStudioReleaseSchedule } from "./studio-release-schedule";
import { createEmptyStudioWriterRoomDocument } from "./studio-writer-room";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

const CANVAS_WIDTH = 800;
const SAVED_AT = "2026-07-19T09:30:00.000Z";

function page(id = "page-1"): PageState {
  return {
    id,
    elements: [],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1_080,
  };
}

function testElement(id: string, extra: Record<string, unknown> = {}): El {
  return {
    id,
    type: "text",
    text: id,
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    rotation: 0,
    fontSize: 16,
    fill: "#111111",
    ...extra,
  } as unknown as El;
}

function baseInput(): BuildStudioProjectFileSnapshotInput {
  return {
    savedAt: SAVED_AT,
    title: "",
    description: "",
    tagsText: "",
    linkedTitleId: null,
    linkedSeriesId: null,
    linkedChallengeId: null,
    pagesList: [page()],
    master: { elements: [] },
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
      profile: "generic",
      aiUsage: "none",
      disclosure: "",
      compliance: normalizeStudioPublishCompliance(undefined),
      packageSettings: {
        ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS,
        requestedThumbnailSlots: [
          ...DEFAULT_STUDIO_PUBLISH_PACKAGE_SETTINGS.requestedThumbnailSlots,
        ],
      },
      packageCredits: "",
    },
  };
}

function snapshot(
  mutate: (input: BuildStudioProjectFileSnapshotInput) => void = () => undefined
) {
  const input = baseInput();
  mutate(input);
  return buildStudioProjectFileSnapshot(input);
}

describe("resolveStudioDurableProjectPages", () => {
  it("uses ref-backed history over a stale render and overlays the deferred stroke once", () => {
    const staleRender = [{ id: "page-1", elements: [{ id: "render-old" }] }];
    const authoritative = [{ id: "page-1", elements: [{ id: "history-new" }] }];
    const result = resolveStudioDurableProjectPages({
      pagesHistory: [[{ id: "page-1", elements: [] }], authoritative],
      historyIndex: 1,
      fallbackPages: staleRender,
      pendingStrokeCommits: {
        pageId: "page-1",
        strokes: [{ id: "deferred-stroke" }],
      },
    });

    expect(result.status).toBe("projected");
    expect(result.pagesList[0]?.elements).toEqual([
      { id: "history-new" },
      { id: "deferred-stroke" },
    ]);
    expect(authoritative[0]?.elements).toEqual([{ id: "history-new" }]);
    expect(staleRender[0]?.elements).toEqual([{ id: "render-old" }]);
  });

  it("bounds the undo index, preserves an authoritative reference without pending ink, and falls back before history exists", () => {
    const first = [{ id: "page-1", elements: [{ id: "first" }] }];
    const latest = [{ id: "page-1", elements: [{ id: "latest" }] }];
    const bounded = resolveStudioDurableProjectPages({
      pagesHistory: [first, latest],
      historyIndex: 99,
      fallbackPages: first,
      pendingStrokeCommits: null,
    });
    expect(bounded.status).toBe("no-pending");
    expect(bounded.pagesList).toBe(latest);

    const fallback = [{ id: "fallback", elements: [] }];
    const beforeHistory = resolveStudioDurableProjectPages({
      pagesHistory: [],
      historyIndex: 0,
      fallbackPages: fallback,
    });
    expect(beforeHistory.pagesList).toBe(fallback);
  });

  it("retains pending-stroke diagnostics instead of guessing a missing or ambiguous page", () => {
    const pendingStrokeCommits = {
      pageId: "target",
      strokes: [{ id: "stroke-1" }],
    };
    const missing = resolveStudioDurableProjectPages({
      pagesHistory: [[{ id: "other", elements: [] }]],
      historyIndex: 0,
      fallbackPages: [],
      pendingStrokeCommits,
    });
    const ambiguous = resolveStudioDurableProjectPages({
      pagesHistory: [[
        { id: "target", elements: [] },
        { id: "target", elements: [] },
      ]],
      historyIndex: 0,
      fallbackPages: [],
      pendingStrokeCommits,
    });

    expect(missing.status).toBe("page-missing");
    expect(ambiguous.status).toBe("page-ambiguous");
    expect(missing.appliedStrokeIds).toEqual([]);
    expect(ambiguous.appliedStrokeIds).toEqual([]);
  });
});

describe("buildStudioProjectFileSnapshot", () => {
  it("preserves every persisted editor field through the StudioProjectFile boundary", () => {
    const input = baseInput();
    const masterElement = testElement("master-label", {
      groupId: "unsupported-master-group",
      clipBelow: true,
    });
    input.title = "여름의 스펙트럼";
    input.description = "1화 원고";
    input.tagsText = "드라마, 일상";
    input.linkedTitleId = "title-7";
    input.linkedSeriesId = "series-3";
    input.linkedChallengeId = "challenge-2";
    input.master = { elements: [masterElement] };
    input.characterBible = normalizeStudioCharacterBible({
      version: 1,
      characters: [{ id: "hero", name: "윤슬" }],
    });
    input.currentPageId = "page-1";
    input.webtoonTheme = "soft";
    input.panelGutter = 32;
    input.publishPack = {
      ...input.publishPack,
      profile: "webtoon",
      aiUsage: "assisted",
      disclosure: "배경 후보 탐색에 AI 사용",
      packageCredits: "배경 모델 · Studio Asset Team",
      packageSettings: {
        ...input.publishPack.packageSettings,
        destination: "webtoon",
        aiUsage: "assisted",
        aiDisclosure: "배경 후보 탐색에 AI 사용",
        includeReviewPdf: true,
      },
    };

    const built = buildStudioProjectFileSnapshot(input);
    const serialized = serializeStudioProjectFile(built, 2);
    const parsed = parseStudioProjectFile(JSON.parse(serialized));

    expect(built).toMatchObject({
      version: 2,
      savedAt: SAVED_AT,
      title: "여름의 스펙트럼",
      description: "1화 원고",
      tagsText: "드라마, 일상",
      linkedTitleId: "title-7",
      linkedSeriesId: "series-3",
      linkedChallengeId: "challenge-2",
      currentPageId: "page-1",
      webtoonTheme: "soft",
      panelGutter: 32,
      characterBible: input.characterBible,
      writerRoom: input.writerRoom,
      aiProvenance: input.aiProvenance,
      aiImageReferences: input.aiImageReferences,
      comments: input.comments,
      releaseSchedule: input.releaseSchedule,
      publicationAnalytics: input.publicationAnalytics,
      referenceBoard: input.referenceBoard,
      publishPack: input.publishPack,
    });
    expect(parsed).toMatchObject({
      linkedTitleId: "title-7",
      linkedSeriesId: "series-3",
      linkedChallengeId: "challenge-2",
      publishPack: input.publishPack,
    });
    expect(built.master?.elements[0]).not.toHaveProperty("groupId");
    expect(built.master?.elements[0]).not.toHaveProperty("clipBelow");
    expect(masterElement).toMatchObject({
      groupId: "unsupported-master-group",
      clipBelow: true,
    });
  });

  it("omits an empty master from serialized legacy-compatible JSON without dropping its other fields", () => {
    const built = snapshot();
    const json = JSON.parse(JSON.stringify(built)) as Record<string, unknown>;

    expect(built.master).toBeUndefined();
    expect(json).not.toHaveProperty("master");
    expect(Object.keys(json)).toEqual(expect.arrayContaining([
      "version",
      "savedAt",
      "pagesList",
      "characterBible",
      "writerRoom",
      "aiProvenance",
      "aiImageReferences",
      "comments",
      "releaseSchedule",
      "publicationAnalytics",
      "referenceBoard",
      "publishPack",
    ]));
  });

  it("preserves the linked Scene Shot authority through archive and checkpoint snapshots", () => {
    const linkedPage = createStudioLinked3dRenderPageFixture();
    const built = snapshot((input) => {
      input.pagesList = [linkedPage];
      input.currentPageId = linkedPage.id;
    });
    const parsed = parseStudioProjectFile(JSON.parse(serializeStudioProjectFile(built, 2)));

    expect(built.pagesList[0]?.linked3dRender).toBe(linkedPage.linked3dRender);
    expect(parsed.pagesList[0]?.linked3dRender).toEqual(linkedPage.linked3dRender);
    expect(parsed.pagesList[0]?.shared3dStage).toEqual(linkedPage.shared3dStage);
  });
});

describe("studioProjectSnapshotHasMeaningfulContent", () => {
  it("does not replace a recovery for a genuinely empty project or view-only metadata", () => {
    const empty = snapshot((input) => {
      input.linkedTitleId = "navigation-context-only";
      input.webtoonTheme = "vivid";
      input.panelGutter = 64;
      input.publishPack.compliance.ownershipRightsConfirmed = true;
    });

    expect(studioProjectSnapshotHasMeaningfulContent(empty, {
      canvasWidth: CANVAS_WIDTH,
    })).toBe(false);
  });

  it("recognizes canvas, drawing-assist, master, planning, review, publishing, and text content", () => {
    const referenceItem = createStudioReferenceBoardItem({
      id: "reference-1",
      sha256: `sha256:${"a".repeat(64)}`,
      name: "표정 참고",
    });
    expect(referenceItem).not.toBeNull();

    const cases: Array<[string, (input: BuildStudioProjectFileSnapshotInput) => void]> = [
      ["page element", (input) => { input.pagesList[0]!.elements.push(testElement("ink")); }],
      ["drawing assist", (input) => {
        const assist = createDefaultStudioDrawingAssistDocument({
          canvasWidth: CANVAS_WIDTH,
          canvasHeight: input.pagesList[0]!.canvasH,
        });
        assist.perspective.active = true;
        input.pagesList[0]!.drawingAssist = assist;
      }],
      ["master", (input) => { input.master = { elements: [testElement("logo")] }; }],
      ["character bible", (input) => {
        input.characterBible = normalizeStudioCharacterBible({
          version: 1,
          characters: [{ id: "hero", name: "윤슬" }],
        });
      }],
      ["writer room", (input) => { input.writerRoom.stages.premise.text = "두 사람의 재회"; }],
      ["AI provenance", (input) => { input.aiProvenance.operations.push({} as never); }],
      ["AI image references", (input) => {
        input.aiImageReferences = hydrateStudioAiImageReferenceDocument({
          version: 1,
          references: [{
            id: "method-ref-1",
            role: "method",
            asset: { assetId: "asset-method-1" },
            guidance: "카메라 구도만 참고",
          }],
        });
      }],
      ["comments", (input) => { input.comments.threads.push({} as never); }],
      ["release schedule", (input) => { input.releaseSchedule.items.push({} as never); }],
      ["publication analytics", (input) => { input.publicationAnalytics.records.push({} as never); }],
      ["reference board", (input) => {
        input.referenceBoard = createStudioReferenceBoardDocument([referenceItem!]);
      }],
      ["publish profile", (input) => { input.publishPack.profile = "webtoon"; }],
      ["AI usage", (input) => { input.publishPack.aiUsage = "assisted"; }],
      ["AI disclosure", (input) => { input.publishPack.disclosure = "AI 보조"; }],
      ["package credits", (input) => { input.publishPack.packageCredits = "모델: 작가 소유"; }],
      ["review PDF", (input) => { input.publishPack.packageSettings.includeReviewPdf = true; }],
      ["credits exclusion", (input) => { input.publishPack.packageSettings.includeCredits = false; }],
      ["thumbnail slots", (input) => {
        input.publishPack.packageSettings.requestedThumbnailSlots = ["episode", "series-square"];
      }],
      ["title", (input) => { input.title = "제목"; }],
      ["description", (input) => { input.description = "설명"; }],
      ["tags", (input) => { input.tagsText = "일상"; }],
    ];

    for (const [label, mutate] of cases) {
      expect(
        studioProjectSnapshotHasMeaningfulContent(snapshot(mutate), {
          canvasWidth: CANVAS_WIDTH,
        }),
        label
      ).toBe(true);
    }
  });
});
