// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { CHARACTER_FAVORITES_KEY } from "./character-shaper-favorites";
import { pushCharacterShaperKeyLayer } from "./character-shaper-ui-model";
import { CharacterShaperShelf } from "./CharacterShaperShelf";

import type { CharacterRecipe, CharacterSlotEntry } from "./character-shaper-contract";
import type { CharacterShaperBinding, CharacterShaperShelfProps } from "./character-shaper-ui-contract";

vi.mock("./character-shaper-preview", () => ({ CharacterSlotPreview: () => <svg aria-hidden /> }));
vi.mock("./character-shaper-catalog", () => ({ CHARACTER_GENRE_TAG_LABELS: { school: "학원", daily: "일상" } }));

const entry = (id: string, label: string, slot: "accessory" | "hand-pose", featured = false): CharacterSlotEntry => ({
  id, label, slot, featured, hint: "프리셋", tags: ["school"], keywords: [],
  preview: { kind: "glyph", icon: "Eye", caption: "" }, apply: { kind: "none" },
  requires: [], exportLayer: "none", license: "toonstudio-original", order: 0,
});
const entries = [entry("accessory:glasses", "안경", "accessory", true), entry("accessory:hat", "모자", "accessory"),
  entry("accessory:pin", "머리핀", "accessory"), entry("hand-pose:peace", "브이", "hand-pose")];
const recipe: CharacterRecipe = {
  version: 1,
  slots: {
    "face-shape": null, eyes: null, irises: null, nose: null, mouth: null, ears: null,
    hair: null, body: null, top: null, bottom: null, shoes: null,
    accessory: ["accessory:glasses", "accessory:hat"], expression: null, pose: null, "hand-pose": null,
  },
  colors: { skin: null, hairBase: null, hairTip: null, iris: null, top: null, bottom: null, shoes: null }, handSide: "both",
};
function binding(overrides: Partial<CharacterShaperBinding> = {}): CharacterShaperBinding {
  return {
    catalog: { version: 1, slots: [
      { id: "accessory", label: "액세서리", labelEn: "Accessory", hint: "소품", group: "figure", icon: "Gem", multi: true },
      { id: "hand-pose", label: "손 포즈", labelEn: "Hand", hint: "손", group: "performance", icon: "Hand", multi: false },
    ], entries },
    profile: {} as CharacterShaperBinding["profile"], snapshot: {} as CharacterShaperBinding["snapshot"],
    recipe, baselineRecipe: recipe, history: { canUndo: false, canRedo: false, recentLabels: [], length: 0 },
    busyReason: null, compareActive: false, handSide: "both",
    evaluate: () => ({ status: "available", reason: null, missing: [] }),
    plan: vi.fn(), commit: vi.fn(), clear: vi.fn(), remove: vi.fn(), setHandSide: vi.fn(),
    undo: vi.fn(), redo: vi.fn(), setCompareActive: vi.fn(), resetToBaseline: vi.fn(),
    commitFaceParams: vi.fn(), commitSemanticMorphs: vi.fn(), commitHairParams: vi.fn(), commitColor: vi.fn(),
    ...overrides,
  };
}
function props(overrides: Partial<CharacterShaperShelfProps> = {}): CharacterShaperShelfProps {
  return { binding: binding(), slot: "accessory", query: "", tag: null, onQueryChange: vi.fn(),
    onTagChange: vi.fn(), onHoverEntry: vi.fn(), onCommitEntry: vi.fn(), ...overrides };
}
const advance = (ms = 130) => act(() => { vi.advanceTimersByTime(ms); });
const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-character-slot-card]"));
const cardIds = () => cards().map((card) => card.dataset.characterSlotCard);

beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); localStorage.clear(); });

describe("CharacterShaperShelf discovery integration", () => {
  it("provides all fifteen slots without asserting a partial fixture into a complete recipe", () => {
    expect(Object.keys(recipe.slots).sort()).toEqual([...CHARACTER_SLOT_KINDS].sort());
  });
  it("preserves explicit catalog order ahead of the Korean label tie-break", () => {
    const h = binding();
    const ordered = h.catalog.entries.map((item) => ({ ...item, order: item.id === "accessory:glasses" ? -1 : 0 }));
    render(<CharacterShaperShelf {...props({ binding: { ...h, catalog: { ...h.catalog, entries: ordered } } })} />);
    fireEvent.click(screen.getByRole("button", { name: "선택됨" }));
    expect(cardIds()).toEqual(["accessory:glasses", "accessory:hat"]);
  });
  it("cancels stale search when switching slots whose external queries are both empty", () => {
    const p = props(); const view = render(<CharacterShaperShelf {...p} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "안" } });
    view.rerender(<CharacterShaperShelf {...p} slot="hand-pose" />); advance();
    expect(p.onQueryChange).not.toHaveBeenCalled();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(cardIds()).toEqual(["hand-pose:peace"]);
  });
  it("does not publish partial IME composition", () => {
    const p = props(); render(<CharacterShaperShelf {...p} />); const search = screen.getByRole("searchbox");
    fireEvent.compositionStart(search); fireEvent.change(search, { target: { value: "안경" } }); advance();
    expect(p.onQueryChange).not.toHaveBeenCalled(); fireEvent.compositionEnd(search); advance();
    expect(p.onQueryChange).toHaveBeenCalledTimes(1); expect(p.onQueryChange).toHaveBeenCalledWith("안경");
  });
  it("does not restart debounce on unrelated host callback identity changes", () => {
    const p = props(); const view = render(<CharacterShaperShelf {...p} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "모자" } }); advance(80);
    const nextCallback = vi.fn(); view.rerender(<CharacterShaperShelf {...p} onQueryChange={nextCallback} />); advance(41);
    expect(p.onQueryChange).not.toHaveBeenCalled(); expect(nextCallback).toHaveBeenCalledTimes(1); expect(nextCallback).toHaveBeenCalledWith("모자");
  });
  it("clears search before the shell handles Escape", () => {
    const shell = vi.fn(() => true); const release = pushCharacterShaperKeyLayer(shell, window);
    try {
      const p = props(); render(<CharacterShaperShelf {...p} />); const search = screen.getByRole("searchbox");
      fireEvent.change(search, { target: { value: "안" } }); fireEvent.keyDown(search, { key: "Escape" });
      expect(shell).not.toHaveBeenCalled(); expect(p.onQueryChange).toHaveBeenCalledWith("");
    } finally { release(); }
  });
  it("bookmarks without committing a scene change and reuses those bookmarks", () => {
    const p = props(); render(<CharacterShaperShelf {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "모자 즐겨찾기 추가" }));
    expect(p.onCommitEntry).not.toHaveBeenCalled(); expect(p.binding.commit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "즐겨찾기" }));
    expect(cardIds()).toEqual(["accessory:hat"]);
    expect(JSON.parse(localStorage.getItem(CHARACTER_FAVORITES_KEY) ?? "null")).toEqual({ version: 1, ids: ["accessory:hat"] });
  });
  it("shows every selected accessory in the catalog's Korean label tie-break order", () => {
    render(<CharacterShaperShelf {...props()} />); fireEvent.click(screen.getByRole("button", { name: "선택됨" }));
    expect(cardIds()).toEqual(["accessory:hat", "accessory:glasses"]);
  });
  it("excludes partial and unavailable entries only after explicit full-support filtering", () => {
    const p = props({ binding: binding({ evaluate: (item) => ({
      status: item.id === "accessory:glasses" ? "available" : item.id === "accessory:hat" ? "partial" : "unavailable",
      reason: "지원 범위", missing: [],
    }) }) });
    render(<CharacterShaperShelf {...p} />); expect(cards()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /완전 지원만/u })); expect(cardIds()).toEqual(["accessory:glasses"]);
  });
  it("refreshes support filtering after a model change", () => {
    const p = props(); const view = render(<CharacterShaperShelf {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /완전 지원만/u }));
    view.rerender(<CharacterShaperShelf {...p} binding={binding({ evaluate: (item) => ({
      status: item.id === "accessory:hat" ? "available" : "unavailable", reason: null, missing: [],
    }) })} />);
    expect(cardIds()).toEqual(["accessory:hat"]);
  });
  it.each([{ busyReason: "캡처 중" }, { compareActive: true }])("guards cards, featured selections and removals while locked: %j", (lock) => {
    const p = props({ binding: binding(lock) }); render(<CharacterShaperShelf {...p} />);
    fireEvent.click(cards()[0]!);
    fireEvent.click(document.querySelector<HTMLElement>("[data-character-shaper-featured]")!);
    fireEvent.click(screen.getByRole("button", { name: "안경 해제" }));
    expect(p.onCommitEntry).not.toHaveBeenCalled(); expect(p.binding.remove).not.toHaveBeenCalled();
    expect(cards()[0]?.getAttribute("aria-disabled")).toBe("true");
  });
  it("disables hand-side mutations while comparing", () => {
    const p = props({ slot: "hand-pose", binding: binding({ compareActive: true }) }); render(<CharacterShaperShelf {...p} />);
    const button = screen.getByRole("button", { name: "왼손" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); fireEvent.click(button); expect(p.binding.setHandSide).not.toHaveBeenCalled();
  });
  it("returns focus to search after removing the last visible favorite", () => {
    localStorage.setItem(CHARACTER_FAVORITES_KEY, JSON.stringify({ version: 1, ids: ["accessory:hat"] }));
    render(<CharacterShaperShelf {...props()} />); fireEvent.click(screen.getByRole("button", { name: "즐겨찾기" }));
    fireEvent.click(screen.getByRole("button", { name: "모자 즐겨찾기 해제" }));
    expect(cards()).toHaveLength(0); expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });
  it("does not nest favorite actions inside selectable card buttons", () => {
    render(<CharacterShaperShelf {...props()} />); expect(document.querySelectorAll("button button")).toHaveLength(0);
  });
  it("offers an explicit save retry after quota failure without changing the scene", () => {
    const p = props(); render(<CharacterShaperShelf {...p} />);
    const write = vi.spyOn(Storage.prototype, "setItem");
    try {
      write.mockImplementationOnce(() => { throw new DOMException("quota", "QuotaExceededError"); });
      fireEvent.click(screen.getByRole("button", { name: "모자 즐겨찾기 추가" }));
      expect(screen.getByRole("button", { name: "즐겨찾기 저장 다시 시도" })).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "즐겨찾기 저장 다시 시도" }));
      expect(screen.queryByRole("button", { name: "즐겨찾기 저장 다시 시도" })).toBeNull();
      expect(JSON.parse(localStorage.getItem(CHARACTER_FAVORITES_KEY) ?? "null").ids).toContain("accessory:hat");
      expect(p.onCommitEntry).not.toHaveBeenCalled(); expect(p.binding.commit).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

});
