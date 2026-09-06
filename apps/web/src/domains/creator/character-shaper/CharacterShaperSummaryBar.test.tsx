// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { CharacterShaperSummaryBar } from "./CharacterShaperSummaryBar";

import type {
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotCatalog,
} from "./character-shaper-contract";
import type { CharacterShaperBinding } from "./character-shaper-ui-contract";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

vi.mock("./character-shaper-recipe", () => ({
  describeCharacterRecipe: () => ({ style: "7두신 · 보브 · 교복", lines: ["7두신"], changedSlots: [] }),
  diffCharacterRecipes: (left: CharacterRecipe, right: CharacterRecipe) =>
    (Object.keys(left.slots) as (keyof CharacterRecipe["slots"])[]).filter(
      (slot) => JSON.stringify(left.slots[slot]) !== JSON.stringify(right.slots[slot]),
    ),
}));

function makeRecipe(slots: Partial<CharacterRecipe["slots"]> = {}): CharacterRecipe {
  const base = Object.fromEntries(CHARACTER_SLOT_KINDS.map((slot) => [slot, slot === "accessory" ? [] : null]));
  return {
    version: 1,
    slots: { ...base, ...slots } as CharacterRecipe["slots"],
    colors: { skin: "#f5c6a0", hairBase: "#2b1d16", hairTip: null, iris: "#5a3a2a", top: "#3355aa", bottom: null, shoes: null },
    handSide: "both",
  };
}

function makeBinding(overrides: Partial<CharacterShaperBinding> = {}): CharacterShaperBinding {
  const catalog: CharacterSlotCatalog = {
    version: 1,
    slots: CHARACTER_SLOT_KINDS.map((id) => ({ id, label: id, labelEn: id, hint: "", group: "identity", icon: "Shapes", multi: id === "accessory" })),
    entries: [],
  };
  return {
    catalog,
    profile: {} as CharacterCapabilityProfile,
    snapshot: {} as CharacterHostSnapshot,
    recipe: makeRecipe({ hair: "hair:bob" }),
    baselineRecipe: makeRecipe(),
    history: { canUndo: true, canRedo: false, recentLabels: ["헤어: 보브"], length: 1 },
    busyReason: null,
    handSide: "both",
    compareActive: false,
    evaluate: vi.fn(),
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

function installMatchMedia(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const match = /\(min-width:\s*(\d+)px\)/u.exec(query);
    return {
      matches: match ? width >= Number(match[1]) : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  });
}

/** Mirrors the poser host: `handleSaveFullLocal` reads `fullStateName` from the latest render. */
function Harness({ binding, host, onSaved }: { binding: CharacterShaperBinding; host: Record<string, unknown>; onSaved: (name: string) => void }) {
  const [fullStateName, setFullStateName] = useState("");
  const [savedFullStates, setSavedFullStates] = useState<Record<string, unknown>>({});
  const h: StudioVrmPoserHost = {
    ...host,
    fullStateName,
    savedFullStates,
    setFullStateName,
    handleSaveFullLocal: () => {
      onSaved(fullStateName);
      setSavedFullStates((current) => ({ ...current, [fullStateName]: {} }));
    },
  };
  return (
    <CharacterShaperSummaryBar
      h={h}
      binding={binding}
      advanced={false}
      onToggleAdvanced={vi.fn()}
      onClose={vi.fn()}
      titleId="title"
      descriptionId="description"
    />
  );
}

function baseHost(): Record<string, unknown> {
  return {
    status: "ready",
    libraryEntries: [
      { id: "lumi", name: "루미", source: "sample", thumbnail: null, createdAt: 0, updatedAt: 0 },
      { id: "mio", name: "미오", source: "sqlite-opfs", thumbnail: null, createdAt: 0, updatedAt: 0 },
    ],
    activeModelId: "lumi",
    closeButtonRef: { current: null },
    loadModelFromLibraryEntry: vi.fn(),
  };
}

beforeEach(() => {
  installMatchMedia(1440);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CharacterShaperSummaryBar", () => {
  it("shows model, style, palette and the changed count, and drives undo / redo", () => {
    const binding = makeBinding();
    render(<Harness binding={binding} host={baseHost()} onSaved={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "캐릭터 셰이퍼" }).id).toBe("title");
    expect((screen.getByLabelText("모델") as HTMLSelectElement).value).toBe("lumi");
    expect(screen.getByText("7두신 · 보브 · 교복")).toBeTruthy();
    expect(screen.getByText("변경 1")).toBeTruthy();
    expect(screen.getByRole("img", { name: "피부 #f5c6a0" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "하의 색 없음" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "실행 취소" }));
    expect(binding.undo).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("button", { name: "다시 실행" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("holds to compare with pointer and keyboard", () => {
    const binding = makeBinding();
    render(<Harness binding={binding} host={baseHost()} onSaved={vi.fn()} />);
    const compare = screen.getByRole("button", { name: "기준 상태와 비교 (누르고 있기)" });
    fireEvent.pointerDown(compare, { button: 0, pointerId: 1 });
    expect(binding.setCompareActive).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(compare, { pointerId: 1 });
    expect(binding.setCompareActive).toHaveBeenLastCalledWith(false);
    fireEvent.keyDown(compare, { key: " " });
    expect(binding.setCompareActive).toHaveBeenLastCalledWith(true);
    fireEvent.keyUp(compare, { key: " " });
    expect(binding.setCompareActive).toHaveBeenLastCalledWith(false);
    expect(binding.setCompareActive).toHaveBeenCalledTimes(4);
  });

  it("disables compare and reset when nothing changed", () => {
    const binding = makeBinding({ recipe: makeRecipe(), baselineRecipe: makeRecipe() });
    render(<Harness binding={binding} host={baseHost()} onSaved={vi.fn()} />);
    expect((screen.getByRole("button", { name: "기준 상태와 비교 (누르고 있기)" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "되돌리기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("변경 0")).toBeTruthy();
  });

  it("confirms before resetting to the baseline and closes on Escape", () => {
    const binding = makeBinding();
    render(<Harness binding={binding} host={baseHost()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    expect(screen.getByRole("dialog", { name: "처음 상태로 되돌리기" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "처음 상태로 되돌리기" })).toBeNull();
    expect(binding.resetToBaseline).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
    const confirm = screen.getByRole("dialog", { name: "처음 상태로 되돌리기" });
    fireEvent.click(confirm.querySelectorAll("button")[1]!);
    expect(binding.resetToBaseline).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "처음 상태로 되돌리기" })).toBeNull();
  });

  it("saves a named variant only after the host echoes the name back", () => {
    const binding = makeBinding();
    const onSaved = vi.fn();
    render(<Harness binding={binding} host={baseHost()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    const input = screen.getByLabelText("변형 이름") as HTMLInputElement;
    expect(input.value).toBe("루미 변형");
    fireEvent.change(input, { target: { value: "  교복 버전  " } });
    fireEvent.submit(input.closest("form")!);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("교복 버전");
    expect(screen.getByRole("status").textContent).toContain("저장됨 · 교복 버전");
  });

  it("switches models through the picker", () => {
    const host = baseHost();
    render(<Harness binding={makeBinding()} host={host} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("모델"), { target: { value: "mio" } });
    expect(host.loadModelFromLibraryEntry).toHaveBeenCalledWith(expect.objectContaining({ id: "mio" }));
  });

  it("folds secondary actions into a 더 보기 panel on narrow screens", () => {
    installMatchMedia(390);
    const binding = makeBinding();
    render(<Harness binding={binding} host={baseHost()} onSaved={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "고급 편집" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    expect(screen.getByRole("dialog", { name: "더 보기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "고급 편집" })).toBeTruthy();
    expect(screen.getByLabelText("변형 이름")).toBeTruthy();
  });
});
