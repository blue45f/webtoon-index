import { describe, expect, it } from "vitest";

import { buttonClass, type Size } from "./button-utils";

/**
 * 터치 승격 계약. 이 토큰은 스튜디오 패널 대부분의 상시 조작(재생·클립 추가·닫기)을 그리므로,
 * 여기서 `pointer-coarse` 승격이 빠지면 모바일 전역에서 32~40px 타깃이 되살아난다.
 */
describe("buttonClass touch targets", () => {
  it.each<[Size, string]>([
    ["sm", "pointer-coarse:h-11"],
    ["md", "pointer-coarse:h-11"],
    ["icon", "pointer-coarse:size-11"],
  ])("promotes size=%s to a 44px target on coarse pointers", (size, expected) => {
    expect(buttonClass({ size })).toContain(expected);
  });

  it("keeps the dense desktop height alongside the promotion", () => {
    expect(buttonClass({ size: "sm" })).toContain("h-8");
    expect(buttonClass({ size: "md" })).toContain("h-10");
    expect(buttonClass({ size: "icon" })).toContain("h-9");
  });

  it("leaves lg alone — 48px already clears the contract", () => {
    const large = buttonClass({ size: "lg" });
    expect(large).toContain("h-12");
    expect(large).not.toContain("pointer-coarse:h-11");
  });

  it("still composes variant and caller classes", () => {
    const composed = buttonClass({ size: "sm", variant: "outline", className: "gap-1.5" });
    expect(composed).toContain("gap-1.5");
    expect(composed).toContain("border-line-strong/90");
  });
});
