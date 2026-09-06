import { describe, expect, it } from "vitest";

import { studioToolHintPreview } from "./studio-tool-hint-preview-routing";

describe("Studio motion-coach semantic preview contract", () => {
  it.each([
    ["toolbar:undo", "undo"],
    ["quick-access/brush_size", "brush-size"],
    ["engine:filters/gaussian_blur", "filter"],
    ["studio:tools/marquee_rect", "marquee-rect"],
  ] as const)("uses the namespaced action identity %s", (id, expected) => {
    expect(
      studioToolHintPreview({
        id,
        title: "동적 플러그인 액션",
        description: "통합 제공자가 자유롭게 작성한 도움말입니다.",
      })
    ).toBe(expected);
  });

  it("never lets incidental words in help prose choose an unknown action's visual", () => {
    expect(
      studioToolHintPreview({
        id: "external-sharpen-v2",
        title: "선명하게 2",
        description: "펜과 레이어, 필터를 함께 사용하는 외부 확장 도움말입니다.",
      })
    ).toBe("select");
  });

  it("honors an explicit authored preview when one action needs a contextual demonstration", () => {
    expect(
      studioToolHintPreview({
        id: "undo",
        title: "필터 단계 되돌리기",
        description: "현재 필터 단계만 되돌립니다.",
        preview: "filter",
      })
    ).toBe("filter");
  });
});
