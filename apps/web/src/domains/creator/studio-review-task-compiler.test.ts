import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  compileStudioReviewTask,
  type StudioReviewTaskSource,
} from "./studio-review-task-compiler";

import type { StudioCommentAnchor } from "./studio-comments";

const PAGE_ANCHOR: StudioCommentAnchor = { type: "page", pageId: "page-1" };

function source(
  body: string,
  replies: readonly string[] = [],
  anchor: StudioCommentAnchor = PAGE_ANCHOR
): StudioReviewTaskSource {
  return {
    body,
    replies: replies.map((reply) => ({ body: reply })),
    anchor,
  };
}

describe("compileStudioReviewTask", () => {
  it.each([
    ["말풍선 줄바꿈과 오탈자를 수정해 주세요.", "lettering", "식자", []],
    ["확인 부탁합니다.", "continuity", "연속성", ["앞 컷과 의상이 달라 연속성이 깨져요."]],
    ["3D 카메라 원근과 소실점을 다시 맞춰 주세요.", "perspective-3d", "3D·원근", []],
    ["선화와 채색 명암 경계를 정리해 주세요.", "art-color", "채색·작화", []],
    ["이 폰트의 라이선스와 상업 이용 범위를 확인해 주세요.", "rights", "권리", []],
    ["전체적으로 한 번 확인해 주세요.", "general", "일반", []],
  ] as const)(
    "classifies %s as %s",
    (body, expectedKind, expectedLabel, replies) => {
      const suggestion = compileStudioReviewTask(source(body, replies));
      expect(suggestion.kind).toBe(expectedKind);
      expect(suggestion.kindLabel).toBe(expectedLabel);
      expect(suggestion.completionChecklist.length).toBeGreaterThanOrEqual(3);
    }
  );

  it("uses replies as evidence without copying arbitrary comment text into the task title", () => {
    const suggestion = compileStudioReviewTask(
      source(
        "확인 부탁합니다. <script>위험한 제목</script>",
        ["답글에서 말풍선 글꼴과 행간을 수정해 달라고 했습니다."]
      )
    );

    expect(suggestion.kind).toBe("lettering");
    expect(suggestion.rationale[0]).toContain("답글에서 식자 관련 표현");
    expect(suggestion.matchedSignals).toEqual(expect.arrayContaining(["말풍선", "글꼴", "행간"]));
    expect(suggestion.title).toBe("식자와 대사 표현 점검");
    expect(suggestion.title).not.toContain("script");
  });

  it("gives rights signals safety precedence over visual-editing signals", () => {
    const suggestion = compileStudioReviewTask(
      source("말풍선 폰트와 채색은 좋지만 폰트 라이선스와 사용 허가를 확인해야 합니다.")
    );

    expect(suggestion.kind).toBe("rights");
    expect(suggestion.priority).toBe("high");
    expect(suggestion.rationale[1]).toContain("게시 가능성");
  });

  it.each([
    ["긴급: 게시 전 저작권 침해 가능성을 즉시 확인해 주세요.", "urgent", "긴급"],
    ["이미지가 깨짐 상태라 수정 필요합니다.", "high", "높음"],
    ["여유되면 나중에 참고 제안으로 반영해 주세요.", "low", "낮음"],
    ["일반적인 검토를 부탁합니다.", "normal", "보통"],
  ] as const)("derives deterministic priority for %s", (body, priority, label) => {
    const suggestion = compileStudioReviewTask(source(body));
    expect(suggestion.priority).toBe(priority);
    expect(suggestion.priorityLabel).toBe(label);
  });

  it.each([
    [{ type: "page", pageId: "p" }, "댓글이 연결된 페이지 전체"],
    [{ type: "frame", pageId: "p", frameId: "f" }, "댓글이 연결된 컷"],
    [{ type: "element", pageId: "p", elementId: "e" }, "댓글이 연결된 요소"],
    [{ type: "point", pageId: "p", x: 0.25, y: 0.75 }, "댓글 핀 주변"],
  ] satisfies readonly [StudioCommentAnchor, string][])(
    "derives a safe fallback scope from a %s anchor",
    (anchor, expectedScope) => {
      expect(compileStudioReviewTask(source("검토", [], anchor)).targetScope).toBe(
        expectedScope
      );
    }
  );

  it("normalizes and bounds a supplied human-readable anchor label", () => {
    const suggestion = compileStudioReviewTask(source("검토"), {
      anchorLabel: `  1페이지\n  2컷 ${"가".repeat(200)}  `,
    });

    expect(suggestion.targetScope).not.toContain("\n");
    expect(Array.from(suggestion.targetScope)).toHaveLength(120);
    expect(suggestion.targetScope.startsWith("1페이지 2컷")).toBe(true);
  });

  it("normalizes compatibility characters and avoids a short-token English false positive", () => {
    expect(compileStudioReviewTask(source("３Ｄ 원근을 맞춰 주세요.")).kind).toBe(
      "perspective-3d"
    );
    expect(compileStudioReviewTask(source("I like this general suggestion.")).kind).toBe(
      "general"
    );
  });

  it("returns the same complete value for the same input without clock, randomness, or network", () => {
    const input = source(
      "앞 컷과 머리색이 달라 수정 필요합니다.",
      ["다음 컷의 의상도 기준 시트와 대조해 주세요."],
      { type: "frame", pageId: "page-1", frameId: "frame-2" }
    );
    const first = compileStudioReviewTask(input, { anchorLabel: "1페이지 · 2컷" });
    const second = compileStudioReviewTask(input, { anchorLabel: "1페이지 · 2컷" });
    const compilerSource = readFileSync(
      new URL("./studio-review-task-compiler.ts", import.meta.url),
      "utf8"
    );

    expect(first).toEqual(second);
    expect(first.targetScope).toBe("1페이지 · 2컷");
    expect(new Set(first.completionChecklist).size).toBe(first.completionChecklist.length);
    expect(compilerSource).not.toMatch(/\bfetch\s*\(/u);
    expect(compilerSource).not.toContain("Date.");
    expect(compilerSource).not.toContain("Math.random");
  });
});
