// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CharacterSlotCard } from "./CharacterSlotCard";

import type { CharacterSlotEntry } from "./character-shaper-contract";

vi.mock("./character-shaper-preview", () => ({ CharacterSlotPreview: () => <span aria-hidden>preview</span> }));
afterEach(cleanup);
const entry: CharacterSlotEntry = {
  id: "eyes:test", slot: "eyes", label: "모델별 지원 범위를 확인하는 눈 프리셋", hint: "테스트",
  tags: [], keywords: [], preview: { kind: "glyph", icon: "eye", caption: "눈" },
  apply: { kind: "none" }, requires: [], exportLayer: "eyes", license: "toonstudio-original", order: 0,
};
function card(status: "available" | "unavailable", onCommit = vi.fn(), onKeyNavigate = vi.fn()) {
  return <CharacterSlotCard entry={entry} selected={false} tabIndex={0}
    availability={{ status, reason: status === "unavailable" ? "이 모델에는 눈 크기 셰이프키가 없습니다." : null, missing: [] }}
    onCommit={onCommit} onHover={vi.fn()} onFocus={vi.fn()} onKeyNavigate={onKeyNavigate} />;
}
describe("CharacterSlotCard touch and keyboard accessibility", () => {
  it("renders unsupported reason without hover-only or hidden classes", () => {
    render(card("unavailable"));
    const reason = screen.getByText("이 모델에는 눈 크기 셰이프키가 없습니다.");
    expect(reason.className.split(" ")).not.toContain("hidden");
    expect(reason.className).not.toContain("group-hover:");
    expect(screen.getByRole("button").getAttribute("aria-describedby")).toBe(reason.id);
  });
  it("does not commit an unsupported touch/click selection", () => {
    const commit = vi.fn(); render(card("unavailable", commit)); fireEvent.click(screen.getByRole("button")); expect(commit).not.toHaveBeenCalled();
  });
  it("keeps grid arrow navigation from also reaching an ancestor", () => {
    const parent = vi.fn(), navigate = vi.fn();
    render(card("available", vi.fn(), navigate));
    document.addEventListener("keydown", parent);
    try {
      fireEvent.keyDown(screen.getByRole("button"), { key: "ArrowRight" });
      expect(navigate).toHaveBeenCalledWith("right"); expect(parent).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", parent);
    }
  });
  it("wraps a long label rather than truncating the only visible name", () => {
    render(card("available")); expect(screen.getByText(entry.label).className.split(" ")).not.toContain("truncate");
  });
});
