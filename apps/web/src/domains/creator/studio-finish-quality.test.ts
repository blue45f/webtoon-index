import { describe, expect, it } from "vitest";

import { inspectStudioFinishQuality } from "./studio-finish-quality";

import type { StudioCommentsDocument } from "./studio-comments";
import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

function page(
  id: string,
  elements: El[] = [],
  overrides: Partial<PageState> = {}
): PageState {
  return {
    id,
    elements,
    bg: "#ffffff",
    bgGrad: null,
    canvasH: 1800,
    review: { status: "approved", locked: true },
    ...overrides,
  };
}

const commentActor = { id: "reviewer", displayName: "검수자" };
const timestamp = "2026-09-05T00:00:00.000Z";

function comments(pageId: string, elementId: string): StudioCommentsDocument {
  return {
    version: 1,
    threads: [
      {
        id: "thread-1",
        author: commentActor,
        body: "수정 확인 필요",
        mentions: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        anchor: { type: "element", pageId, elementId },
        replies: [],
        resolved: false,
      },
    ],
  };
}

describe("Studio finish quality inspection", () => {
  it("blocks structurally corrupted page and stroke data", () => {
    const result = inspectStudioFinishQuality({
      documentTitle: "마감 원고",
      pages: [
        page("page-1", [
          {
            id: "stroke-1",
            type: "draw",
            points: [0, 0, Number.NaN],
            stroke: "#000000",
            strokeWidth: 0,
          },
        ]),
      ],
    });

    expect(result.canExport).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "STROKE_POINTS_ODD",
        "STROKE_POINT_INVALID",
        "STROKE_WIDTH_INVALID",
      ])
    );
  });

  it("finds review, placeholder, overflow, contrast and temporary-layer risks", () => {
    const result = inspectStudioFinishQuality({
      documentTitle: "마감 원고",
      pages: [
        page(
          "page-1",
          [
            {
              id: "bubble-1",
              type: "bubble",
              variant: "speech",
              text: "{{NAME}} 님, 이 문장은 아주 작은 말풍선 안에서 여러 줄로 잘릴 가능성이 큽니다.",
              x: 10,
              y: 20,
              width: 80,
              height: 40,
              fill: "#ffffff",
              textFill: "#ffffff",
              rotation: 0,
              fontSize: 16,
              name: "final dialogue",
            },
            {
              id: "guide-1",
              type: "frame",
              x: 0,
              y: 0,
              width: 720,
              height: 600,
              name: "rough guide",
            },
          ],
          { review: { status: "changes-requested", locked: false } }
        ),
      ],
    });

    expect(result.canExport).toBe(true);
    expect(result.readyForFinalReview).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "PAGE_CHANGES_REQUESTED",
        "DIALOGUE_PLACEHOLDER",
        "BUBBLE_TEXT_OVERFLOW",
        "BUBBLE_CONTRAST_LOW",
        "VISIBLE_PRODUCTION_GUIDE",
      ])
    );
  });

  it("reports ephemeral images, animation conflicts and stale comment anchors", () => {
    const result = inspectStudioFinishQuality({
      documentTitle: "마감 원고",
      pages: [
        page("page-1", [
          {
            id: "image-1",
            type: "image",
            src: "blob:temporary",
            x: 0,
            y: 0,
            width: 720,
            height: 900,
            rotation: 0,
            isAnimatedGif: true,
            frames: [],
          },
        ]),
      ],
      comments: comments("page-1", "removed-element"),
    });

    expect(result.openCommentCount).toBe(1);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "IMAGE_SOURCE_EPHEMERAL",
        "ANIMATION_FRAMES_EMPTY",
        "ANIMATION_MODEL_CONFLICT",
        "COMMENTS_OPEN",
        "COMMENT_TARGET_MISSING",
      ])
    );
  });

  it("keeps ordering, fingerprints and score deterministic", () => {
    const input = {
      documentTitle: "마감 원고",
      pages: [
        page("page-1", [], {
          review: { status: "approved", locked: false },
        }),
      ],
    } as const;

    const first = inspectStudioFinishQuality(input);
    const second = inspectStudioFinishQuality(input);

    expect(second).toEqual(first);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(new Set(first.issues.map((issue) => issue.fingerprint)).size).toBe(
      first.issues.length
    );
  });

  it("bounds issue floods without hiding the truncation fact", () => {
    const elements: El[] = Array.from({ length: 20 }, (_, index) => ({
      id: `empty-${index}`,
      type: "text",
      text: "TODO",
      x: 0,
      y: index * 20,
      width: 100,
      fontSize: 8,
      fill: "#000000",
      rotation: 0,
    }));
    const result = inspectStudioFinishQuality(
      { documentTitle: "마감 원고", pages: [page("page-1", elements)] },
      { maxIssues: 5 }
    );

    expect(result.issues).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });
});
