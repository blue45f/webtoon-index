// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { CharacterShaperShelf } from "./CharacterShaperShelf";
import { CharacterSlotCard } from "./CharacterSlotCard";

import type {
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotAvailability,
  CharacterSlotCatalog,
  CharacterSlotEntry,
} from "./character-shaper-contract";
import type { CharacterShaperBinding } from "./character-shaper-ui-contract";

vi.mock("./character-shaper-preview", () => ({
  CharacterSlotPreview: ({ spec }: { spec: { kind: string } }) => <svg data-testid="preview" data-preview-kind={spec.kind} aria-hidden />,
}));
vi.mock("./character-shaper-catalog", () => ({
  CHARACTER_GENRE_TAG_LABELS: { romance: "로맨스", school: "학원", action: "액션", fantasy: "판타지", modern: "현대", comedy: "코미디", noir: "누아르", medical: "메디컬", daily: "일상" },
}));

function entry(overrides: Partial<CharacterSlotEntry> & { readonly id: string; readonly slot: CharacterSlotEntry["slot"] }): CharacterSlotEntry {
  return {
    label: overrides.id,
    hint: "한 줄 의도",
    tags: [],
    keywords: [],
    preview: { kind: "glyph", icon: "Eye", caption: "" },
    apply: { kind: "none" },
    requires: [],
    exportLayer: "none",
    license: "toonstudio-original",
    order: 0,
    ...overrides,
  };
}

const ENTRIES: CharacterSlotEntry[] = [
  entry({ id: "accessory:glasses", slot: "accessory", label: "안경", tags: ["school"], order: 0, featured: true }),
  entry({ id: "accessory:hat", slot: "accessory", label: "모자", tags: ["daily"], order: 1 }),
  entry({ id: "accessory:sword", slot: "accessory", label: "검", tags: ["action", "fantasy"], order: 2 }),
  entry({ id: "hand-pose:peace", slot: "hand-pose", label: "브이", order: 0 }),
  entry({ id: "hand-pose:fist", slot: "hand-pose", label: "주먹", order: 1 }),
];

function makeRecipe(slots: Partial<CharacterRecipe["slots"]> = {}): CharacterRecipe {
  const base = Object.fromEntries(CHARACTER_SLOT_KINDS.map((slot) => [slot, slot === "accessory" ? [] : null]));
  return {
    version: 1,
    slots: { ...base, ...slots } as CharacterRecipe["slots"],
    colors: { skin: null, hairBase: null, hairTip: null, iris: null, top: null, bottom: null, shoes: null },
    handSide: "both",
  };
}

function makeBinding(overrides: Partial<CharacterShaperBinding> = {}): CharacterShaperBinding {
  const catalog: CharacterSlotCatalog = {
    version: 1,
    slots: [
      { id: "accessory", label: "액세서리", labelEn: "Accessory", hint: "여러 개를 함께 장착", group: "figure", icon: "Gem", multi: true },
      { id: "hand-pose", label: "손 포즈", labelEn: "Hand pose", hint: "손 모양", group: "performance", icon: "Hand", multi: false },
    ],
    entries: ENTRIES,
  };
  return {
    catalog,
    profile: {} as CharacterCapabilityProfile,
    snapshot: {} as CharacterHostSnapshot,
    recipe: makeRecipe({ accessory: ["accessory:glasses"] }),
    baselineRecipe: makeRecipe(),
    history: { canUndo: false, canRedo: false, recentLabels: [], length: 0 },
    busyReason: null,
    handSide: "both",
    compareActive: false,
    evaluate: vi.fn((): CharacterSlotAvailability => ({ status: "available", reason: null, missing: [] })),
    plan: vi.fn(),
    commit: vi.fn(),
    clear: vi.fn(() => null),
    remove: vi.fn(() => null),
    setHandSide: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    setCompareActive: vi.fn(),
    resetToBaseline: vi.fn(),
    commitFaceParams: vi.fn(),
    commitSemanticMorphs: vi.fn(),
    commitHairParams: vi.fn(),
    commitColor: vi.fn(),
    ...overrides,
  };
}

function renderShelf(options: { slot?: "accessory" | "hand-pose"; binding?: CharacterShaperBinding; query?: string; tag?: string | null } = {}) {
  const binding = options.binding ?? makeBinding();
  const onQueryChange = vi.fn();
  const onTagChange = vi.fn();
  const onHoverEntry = vi.fn();
  const onCommitEntry = vi.fn();
  const view = render(
    <CharacterShaperShelf
      binding={binding}
      slot={options.slot ?? "accessory"}
      query={options.query ?? ""}
      tag={options.tag ?? null}
      onQueryChange={onQueryChange}
      onTagChange={onTagChange}
      onHoverEntry={onHoverEntry}
      onCommitEntry={onCommitEntry}
    />,
  );
  return { ...view, binding, onQueryChange, onTagChange, onHoverEntry, onCommitEntry };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CharacterShaperShelf", () => {
  it("shows the slot header, count, only the genre tags present, and the equipped strip for multi slots", () => {
    const { binding, onTagChange } = renderShelf();
    expect(screen.getByRole("heading", { name: "액세서리" })).toBeTruthy();
    expect(screen.getByText("3개")).toBeTruthy();
    const tagGroup = screen.getByRole("group", { name: "장르 필터" });
    expect(Array.from(tagGroup.querySelectorAll("button")).map((button) => button.textContent)).toEqual(["전체", "학원", "액션", "판타지", "일상"]);
    fireEvent.click(screen.getByRole("button", { name: "액션" }));
    expect(onTagChange).toHaveBeenCalledWith("action");
    const equipped = screen.getByRole("region", { name: "장착 중" });
    expect(equipped.textContent).toContain("안경");
    fireEvent.click(screen.getByRole("button", { name: "안경 해제" }));
    expect(binding.remove).toHaveBeenCalledWith("accessory", "accessory:glasses");
    expect(screen.getByRole("region", { name: "추천" }).textContent).toContain("안경");
  });

  it("debounces the search draft and syncs when the query prop changes", () => {
    const { onQueryChange, rerender, binding } = renderShelf();
    const search = screen.getByRole("searchbox", { name: "액세서리 프리셋 검색" });
    fireEvent.change(search, { target: { value: "모" } });
    expect(onQueryChange).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(130);
    });
    expect(onQueryChange).toHaveBeenCalledWith("모");
    rerender(
      <CharacterShaperShelf binding={binding} slot="accessory" query="모" tag={null} onQueryChange={onQueryChange} onTagChange={vi.fn()} onHoverEntry={vi.fn()} onCommitEntry={vi.fn()} />,
    );
    expect(document.querySelectorAll("[data-character-slot-card]")).toHaveLength(1);
    expect(screen.getByText("1/3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "검색 지우기" }));
    expect(onQueryChange).toHaveBeenLastCalledWith("");
  });

  it("filters by tag, teaches the empty state, and clears both filters from it", () => {
    const { onQueryChange, onTagChange } = renderShelf({ query: "없는이름", tag: "noir" });
    expect(screen.getByText("검색 결과가 없습니다")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "검색·필터 지우기" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(onTagChange).toHaveBeenCalledWith(null);
  });

  it("offers the hand side selector for hand poses", () => {
    const { binding } = renderShelf({ slot: "hand-pose" });
    const group = screen.getByRole("group", { name: "적용할 손" });
    expect(group.querySelector('[aria-pressed="true"]')?.textContent).toBe("양손");
    fireEvent.click(screen.getByRole("button", { name: "왼손" }));
    expect(binding.setHandSide).toHaveBeenCalledWith("left");
    expect(screen.queryByRole("region", { name: "장착 중" })).toBeNull();
  });

  it("reports hover and focus to the inspector and commits from the grid", () => {
    const { onHoverEntry, onCommitEntry } = renderShelf();
    const hat = document.querySelector<HTMLElement>('[data-character-slot-card="accessory:hat"]')!;
    fireEvent.pointerEnter(hat);
    expect(onHoverEntry).toHaveBeenLastCalledWith("accessory:hat");
    fireEvent.pointerLeave(hat);
    expect(onHoverEntry).toHaveBeenLastCalledWith(null);
    hat.focus();
    expect(onHoverEntry).toHaveBeenLastCalledWith("accessory:hat");
    fireEvent.click(hat);
    expect(onCommitEntry).toHaveBeenCalledTimes(1);
    expect(vi.mocked(onCommitEntry).mock.calls[0]?.[0]?.id).toBe("accessory:hat");
  });
});

describe("CharacterSlotCard", () => {
  it("exposes selected, partial and unavailable states beyond color", () => {
    const base = entry({ id: "accessory:hat", slot: "accessory", label: "모자", hint: "챙이 넓은 모자" });
    const onCommit = vi.fn();
    const onKeyNavigate = vi.fn();
    const { rerender } = render(
      <CharacterSlotCard
        entry={base}
        availability={{ status: "available", reason: null, missing: [] }}
        selected
        tabIndex={0}
        onCommit={onCommit}
        onHover={vi.fn()}
        onFocus={vi.fn()}
        onKeyNavigate={onKeyNavigate}
      />,
    );
    const card = screen.getByRole("button", { name: /모자/ });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(card.getAttribute("data-character-slot-card-selected")).toBe("true");
    fireEvent.keyDown(card, { key: "ArrowDown" });
    expect(onKeyNavigate).toHaveBeenCalledWith("down");
    fireEvent.keyDown(card, { key: "End" });
    expect(onKeyNavigate).toHaveBeenCalledWith("end");

    rerender(
      <CharacterSlotCard
        entry={base}
        availability={{ status: "partial", reason: "머리 소품 앵커가 없어 위치가 다를 수 있습니다.", missing: [] }}
        selected={false}
        tabIndex={-1}
        onCommit={onCommit}
        onHover={vi.fn()}
        onFocus={vi.fn()}
        onKeyNavigate={onKeyNavigate}
      />,
    );
    expect(card.textContent).toContain("일부 적용");
    expect(card.getAttribute("aria-describedby")).toBeTruthy();
    expect(document.getElementById(card.getAttribute("aria-describedby")!)?.textContent).toContain("머리 소품 앵커");
    fireEvent.click(card);
    expect(onCommit).toHaveBeenCalledTimes(1);

    rerender(
      <CharacterSlotCard
        entry={base}
        availability={{ status: "unavailable", reason: "소품 런타임이 준비되지 않았습니다.", missing: [] }}
        selected={false}
        tabIndex={0}
        onCommit={onCommit}
        onHover={vi.fn()}
        onFocus={vi.fn()}
        onKeyNavigate={onKeyNavigate}
      />,
    );
    expect(card.getAttribute("aria-disabled")).toBe("true");
    expect(card.getAttribute("tabindex")).toBe("0");
    fireEvent.click(card);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
