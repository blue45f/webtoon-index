import { describe, expect, it } from "vitest";

import {
  STUDIO_RETOUCH_EDITABLE_COPY_NOTE,
  STUDIO_RETOUCH_TOOL_HELP,
  STUDIO_RETOUCH_TOOL_IDS,
} from "./studio-retouch-help";

describe("studio retouch help language", () => {
  it("네 도구가 행동 이름과 익숙한 전문 용어를 함께 제공한다", () => {
    expect(STUDIO_RETOUCH_TOOL_IDS).toEqual([
      "smudge",
      "wet-mix",
      "dodge-burn",
      "liquify",
    ]);

    for (const id of STUDIO_RETOUCH_TOOL_IDS) {
      const help = STUDIO_RETOUCH_TOOL_HELP[id];
      expect(help.actionName.trim().length).toBeGreaterThan(0);
      expect(help.technicalName.trim().length).toBeGreaterThan(0);
      expect(help.railName).toContain(help.actionName);
      expect(help.summary.trim().length).toBeGreaterThan(0);
    }
  });

  it("각 도구의 첫 사용 흐름은 대상 준비·실행·실행취소의 정확한 3단계다", () => {
    for (const id of STUDIO_RETOUCH_TOOL_IDS) {
      const help = STUDIO_RETOUCH_TOOL_HELP[id];
      expect(help.steps).toHaveLength(3);
      expect(help.steps[0].body).toBe(STUDIO_RETOUCH_EDITABLE_COPY_NOTE);
      expect(help.steps[0].body).toContain("벡터 선·도형");
      expect(help.steps[0].body).toContain("원본은 숨겨 보존");
      expect(help.steps[2].body).toContain("⌘Z");
    }
  });

  it("스머지와 혼색은 새 색을 칠하는지 여부로 즉시 구분된다", () => {
    expect(STUDIO_RETOUCH_TOOL_HELP.smudge.summary).toContain("새 색은 칠하지 않습니다");
    expect(STUDIO_RETOUCH_TOOL_HELP["wet-mix"].summary).toContain("현재 색을 새로 칠하면서");
  });
});
