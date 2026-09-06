import { describe, expect, it } from "vitest";

import {
  computeStudioQualityRevisionKey,
  createStudioQualityIssue,
  inspectStudioQuality,
} from "./studio-quality-inspection";

import type { BubbleTextMeasurer } from "./lettering/studio-bubble-text-fit";
import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

const deterministicMeasurer: BubbleTextMeasurer = {
  measureWidth(text, fontPx) {
    return [...text].length * fontPx * 0.6;
  },
};

function page(
  elements: readonly El[] = [],
  overrides: Partial<PageState> = {}
): PageState {
  return {
    id: "page-1",
    elements: [...elements],
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 2_000,
    review: { status: "approved", locked: true },
    ...overrides,
  };
}

function bubble(overrides: Partial<Extract<El, { type: "bubble" }>> = {}): Extract<
  El,
  { type: "bubble" }
> {
  return {
    id: "bubble-1",
    type: "bubble",
    variant: "speech",
    text: "안녕하세요",
    x: 80,
    y: 120,
    width: 280,
    height: 140,
    fill: "#ffffff",
    textFill: "#111111",
    rotation: 0,
    ...overrides,
  };
}

function issueCodes(result: ReturnType<typeof inspectStudioQuality>): Set<string> {
  return new Set(result.issues.map((issue) => issue.code));
}

describe("studio quality inspection", () => {
  it("blocks finalization when the project has no pages", () => {
    const result = inspectStudioQuality(
      { pages: [] },
      { textMeasurer: deterministicMeasurer }
    );

    expect(result.canFinalize).toBe(false);
    expect(result.counts.blocking).toBe(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: "NO_PAGES", severity: "blocking" })
    );
  });

  it("reports damaged document identities, geometry, and missing raster sources", () => {
    const elements = [
      {
        id: "duplicate",
        type: "image",
        src: "",
        x: 0,
        y: 0,
        width: 0,
        height: 100,
        rotation: 0,
      },
      {
        id: "duplicate",
        type: "image",
        src: "blob:ephemeral",
        x: 10,
        y: 10,
        width: 100,
        height: 100,
        rotation: 0,
      },
    ] as El[];
    const result = inspectStudioQuality(
      {
        pages: [
          page(elements, { id: "same", canvasH: 0 }),
          page([], { id: "same" }),
        ],
      },
      { textMeasurer: deterministicMeasurer }
    );
    const codes = issueCodes(result);

    for (const code of [
      "DUPLICATE_PAGE_ID",
      "INVALID_CANVAS_HEIGHT",
      "DUPLICATE_ELEMENT_ID",
      "INVALID_ELEMENT_GEOMETRY",
      "MISSING_IMAGE_SOURCE",
      "NON_PERSISTENT_IMAGE_SOURCE",
    ]) {
      expect(codes.has(code)).toBe(true);
    }
    expect(result.canFinalize).toBe(false);
  });

  it("detects bubble overflow, contrast failure, and damaged range annotations", () => {
    const result = inspectStudioQuality(
      {
        pages: [
          page([
            bubble({
              text: "말풍선 안에 절대로 들어갈 수 없을 만큼 아주 긴 대사가 여러 번 이어집니다.",
              width: 90,
              height: 28,
              fontSize: 22,
              fill: "#ffffff",
              textFill: "#ffffff",
              rubySpans: [{ start: 0, end: 500, ruby: "잘못된 루비" }],
            }),
          ]),
        ],
      },
      { textMeasurer: deterministicMeasurer }
    );
    const codes = issueCodes(result);

    expect(codes.has("BUBBLE_TEXT_OVERFLOW")).toBe(true);
    expect(codes.has("BUBBLE_LOW_CONTRAST")).toBe(true);
    expect(codes.has("INVALID_DIALOGUE_RANGE")).toBe(true);
    expect(result.categoryCounts.lettering).toBeGreaterThanOrEqual(3);
    expect(result.canFinalize).toBe(false);
  });

  it("combines workflow, continuity, and browser-probe findings into one report", () => {
    const runtimeIssue = createStudioQualityIssue({
      code: "BROKEN_RASTER_ASSET",
      category: "asset",
      severity: "blocking",
      title: "이미지 디코딩 실패",
      message: "브라우저가 이미지를 열지 못했습니다.",
      remediation: "원본을 다시 연결하세요.",
      pageId: "page-1",
      pageIndex: 0,
      elementId: "image-1",
    });
    const result = inspectStudioQuality(
      {
        pages: [
          page([bubble()], {
            review: { status: "changes-requested", locked: false },
          }),
        ],
        openCommentCount: 3,
        continuityIssues: [
          {
            severity: "error",
            code: "UNKNOWN_CHARACTER",
            message: "미등록 캐릭터가 있습니다.",
            sceneRefs: ["scene-1"],
          },
        ],
        supplementalIssues: [runtimeIssue],
      },
      { textMeasurer: deterministicMeasurer }
    );
    const codes = issueCodes(result);

    expect(codes.has("PAGE_CHANGES_REQUESTED")).toBe(true);
    expect(codes.has("OPEN_EDITORIAL_COMMENTS")).toBe(true);
    expect(codes.has("CONTINUITY_ISSUE")).toBe(true);
    expect(codes.has("BROKEN_RASTER_ASSET")).toBe(true);
    expect(result.counts.blocking).toBeGreaterThan(0);
    expect(result.counts.error).toBeGreaterThanOrEqual(3);
  });

  it("keeps fingerprints deterministic, changes them with the document, and does not mutate input", () => {
    const pages = [page([bubble()])];
    const before = JSON.stringify(pages);
    const first = inspectStudioQuality(
      { pages },
      { textMeasurer: deterministicMeasurer }
    );
    const second = inspectStudioQuality(
      { pages },
      { textMeasurer: deterministicMeasurer }
    );
    const changed = [
      page([bubble({ text: "수정된 대사" })]),
    ];

    expect(first.revisionKey).toBe(second.revisionKey);
    expect(first.issues.map((issue) => issue.id)).toEqual(
      second.issues.map((issue) => issue.id)
    );
    expect(computeStudioQualityRevisionKey({ pages })).not.toBe(
      computeStudioQualityRevisionKey({ pages: changed })
    );
    expect(JSON.stringify(pages)).toBe(before);
  });

  it("caps oversized reports and exposes the omitted issue count", () => {
    const pages = Array.from({ length: 8 }, (_, index) =>
      page([], { id: `page-${index + 1}`, review: { status: "draft", locked: false } })
    );
    const result = inspectStudioQuality(
      { pages },
      { maxIssues: 3, textMeasurer: deterministicMeasurer }
    );

    expect(result.suppressedIssueCount).toBeGreaterThan(0);
    expect(result.issues).toHaveLength(4);
    expect(result.issues.at(-1)).toEqual(
      expect.objectContaining({ code: "ISSUE_LIMIT_REACHED" })
    );
  });
});
