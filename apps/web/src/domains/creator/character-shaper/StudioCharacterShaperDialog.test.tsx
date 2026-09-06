// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import { StudioCharacterShaperDialog } from "./StudioCharacterShaperDialog";

import type {
  CharacterApplyPlan,
  CharacterCapabilityProfile,
  CharacterHostSnapshot,
  CharacterRecipe,
  CharacterSlotAvailability,
  CharacterSlotCatalog,
  CharacterSlotEntry,
  CharacterSlotMeta,
} from "./character-shaper-contract";
import type { CharacterShaperBinding, CharacterShaperCommitResult } from "./character-shaper-ui-contract";
import type { StudioVrmPoserHost } from "../vrm/StudioVrmPoserHost";

vi.mock("../vrm/StudioVrmPoserViewport", () => ({
  StudioVrmPoserViewport: ({ presentation }: { presentation?: string }) => <section data-testid="viewport" data-presentation={presentation}>viewport</section>,
}));
vi.mock("./character-shaper-preview", () => ({
  CharacterSlotPreview: ({ spec, title }: { spec: { kind: string }; title?: string }) => (
    <svg data-testid="preview" data-preview-kind={spec.kind} aria-hidden>
      <title>{title}</title>
    </svg>
  ),
}));
vi.mock("./character-shaper-catalog", () => ({
  CHARACTER_GENRE_TAG_LABELS: {
    romance: "로맨스",
    school: "학원",
    action: "액션",
    fantasy: "판타지",
    modern: "현대",
    comedy: "코미디",
    noir: "누아르",
    medical: "메디컬",
    daily: "일상",
  },
}));
vi.mock("./character-shaper-recipe", () => ({
  describeCharacterRecipe: () => ({ style: "7두신 · 보브 · 교복", lines: ["7두신", "보브"], changedSlots: [] }),
  diffCharacterRecipes: (left: CharacterRecipe, right: CharacterRecipe) =>
    (Object.keys(left.slots) as (keyof CharacterRecipe["slots"])[]).filter(
      (slot) => JSON.stringify(left.slots[slot]) !== JSON.stringify(right.slots[slot]),
    ),
}));
vi.mock("./CharacterShaperInspector", () => ({
  CharacterShaperInspector: ({ slot, hoveredEntryId }: { slot: string; hoveredEntryId: string | null }) => (
    <div data-testid="inspector" data-slot={slot} data-hovered={hoveredEntryId ?? ""} />
  ),
}));
vi.mock("./CharacterShaperReferenceDrawer", () => ({
  CharacterShaperReferenceDrawer: ({ mode, onClose }: { mode: string; onClose: () => void }) => (
    <div data-testid="drawer" data-mode={mode}>
      <button type="button" onClick={onClose}>
        드로어 닫기
      </button>
    </div>
  ),
}));
vi.mock("./CharacterShaperOutputDock", () => ({
  CharacterShaperOutputDock: ({
    onOpenDrawer,
    onTogglePaint,
    paintActive,
    compact,
  }: {
    onOpenDrawer: (mode: "reference") => void;
    onTogglePaint: () => void;
    paintActive: boolean;
    compact: boolean;
  }) => (
    <div data-testid="dock" data-compact={String(compact)}>
      <button type="button" onClick={() => onOpenDrawer("reference")}>
        참고 이미지 AI 추천
      </button>
      <button type="button" aria-pressed={paintActive} onClick={onTogglePaint}>
        표면 드로잉
      </button>
    </div>
  ),
}));
vi.mock("./CharacterShaperPaintHud", () => ({
  CharacterShaperPaintHud: ({ onExit }: { onExit: () => void }) => (
    <div data-testid="paint-hud">
      <button type="button" onClick={onExit}>
        드로잉 종료
      </button>
    </div>
  ),
}));

const SLOT_LABELS: Record<(typeof CHARACTER_SLOT_KINDS)[number], string> = {
  "face-shape": "얼굴형",
  eyes: "눈",
  irises: "눈동자",
  nose: "코",
  mouth: "입",
  ears: "귀",
  hair: "헤어",
  body: "체형",
  top: "상의",
  bottom: "하의",
  shoes: "신발",
  accessory: "액세서리",
  expression: "표정",
  pose: "포즈",
  "hand-pose": "손 포즈",
};

function slotMetas(): CharacterSlotMeta[] {
  return CHARACTER_SLOT_KINDS.map((id, index) => ({
    id,
    label: SLOT_LABELS[id],
    labelEn: id,
    hint: `${SLOT_LABELS[id]} 힌트`,
    group: index < 7 ? "identity" : index < 12 ? "figure" : "performance",
    icon: "Shapes",
    multi: id === "accessory",
  }));
}

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
  entry({ id: "face-shape:balanced", slot: "face-shape", label: "균형", order: 0, featured: true }),
  entry({ id: "face-shape:egg", slot: "face-shape", label: "계란형", order: 1 }),
  entry({ id: "eyes:cat", slot: "eyes", label: "고양이 눈", hint: "치켜 올라간 눈꼬리", tags: ["romance"], keywords: ["cat"], order: 1 }),
  entry({ id: "eyes:round", slot: "eyes", label: "둥근 동안", hint: "크고 둥근 눈", tags: ["comedy"], order: 0 }),
  entry({ id: "eyes:far", slot: "eyes", label: "먼 눈", hint: "간격이 넓은 눈", tags: ["comedy"], order: 2 }),
  entry({ id: "hair:bob", slot: "hair", label: "보브", order: 0 }),
  entry({ id: "hair:long", slot: "hair", label: "롱 스트레이트", order: 1 }),
  entry({ id: "accessory:glasses", slot: "accessory", label: "안경", order: 0 }),
  entry({ id: "accessory:hat", slot: "accessory", label: "모자", order: 1 }),
  entry({ id: "hand-pose:peace", slot: "hand-pose", label: "브이", order: 0 }),
];

const AVAILABILITY: Record<string, CharacterSlotAvailability> = {
  "eyes:far": { status: "unavailable", reason: "이 모델에는 눈 간격 shape key가 없어 적용할 수 없습니다.", missing: ["eyeSpacing"] },
  "eyes:cat": { status: "partial", reason: "눈 기울기 shape key가 없어 크기만 적용됩니다.", missing: ["eyeTilt"] },
};

function makeRecipe(slots: Partial<CharacterRecipe["slots"]> = {}): CharacterRecipe {
  const base = Object.fromEntries(CHARACTER_SLOT_KINDS.map((slot) => [slot, slot === "accessory" ? [] : null]));
  return {
    version: 1,
    slots: { ...base, ...slots } as CharacterRecipe["slots"],
    colors: { skin: "#f5c6a0", hairBase: "#2b1d16", hairTip: null, iris: "#5a3a2a", top: null, bottom: null, shoes: null },
    handSide: "both",
  };
}

function makeBinding(overrides: Partial<CharacterShaperBinding> = {}): CharacterShaperBinding {
  const catalog: CharacterSlotCatalog = { version: 1, slots: slotMetas(), entries: ENTRIES };
  const recipe = makeRecipe({ eyes: "eyes:round", accessory: ["accessory:glasses"] });
  const baselineRecipe = makeRecipe({ eyes: "eyes:cat" });
  const profile = { status: "ready", modelId: "lumi", modelName: "루미" } as unknown as CharacterCapabilityProfile;
  const binding: CharacterShaperBinding = {
    catalog,
    profile,
    snapshot: {} as CharacterHostSnapshot,
    recipe,
    baselineRecipe,
    history: { canUndo: true, canRedo: false, recentLabels: ["눈: 둥근 동안"], length: 1 },
    busyReason: null,
    handSide: "both",
    compareActive: false,
    evaluate: vi.fn((item: CharacterSlotEntry): CharacterSlotAvailability => AVAILABILITY[item.id] ?? { status: "available", reason: null, missing: [] }),
    plan: vi.fn((item: CharacterSlotEntry): CharacterApplyPlan => ({
      entryId: item.id,
      slot: item.slot,
      label: item.label,
      steps: [],
      availability: { status: "available", reason: null, missing: [] },
    })),
    commit: vi.fn((item: CharacterSlotEntry): CharacterShaperCommitResult => ({
      ok: true,
      plan: { entryId: item.id, slot: item.slot, label: item.label, steps: [], availability: { status: "available", reason: null, missing: [] } },
      reason: null,
    })),
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
  return binding;
}

function makeHost(overrides: Record<string, unknown> = {}): StudioVrmPoserHost {
  return {
    status: "ready",
    error: "",
    vrm: {},
    libraryEntries: [{ id: "lumi", name: "루미", source: "sample", thumbnail: null, createdAt: 0, updatedAt: 0 }],
    activeModelId: "lumi",
    activeCameraId: "front",
    turntable: false,
    transparentBackground: true,
    lightingTone: "morning",
    texturePaintModeSelected: false,
    activePanelTab: "pose",
    activeCharacterSection: "forge",
    isCapturing: false,
    fullStateName: "",
    savedFullStates: {},
    dialogRef: { current: null },
    closeButtonRef: { current: null },
    dialogTitleId: "shaper-title",
    dialogDescriptionId: "shaper-description",
    onClose: vi.fn(),
    setTurntable: vi.fn(),
    setActiveCameraId: vi.fn(),
    setTransparentBackground: vi.fn(),
    setLightingTone: vi.fn(),
    zoomViewport: vi.fn(),
    handleViewReset: vi.fn(),
    handlePanelTabChange: vi.fn(),
    handleCharacterSectionChange: vi.fn(),
    handleSampleLoad: vi.fn(),
    handleFileChange: vi.fn(),
    setFullStateName: vi.fn(),
    handleSaveFullLocal: vi.fn(),
    loadModelFromLibraryEntry: vi.fn(),
    cancelActiveTexturePaintStroke: vi.fn(),
    cancelPendingPoseShare: vi.fn(),
    ...overrides,
  };
}

function installMatchMedia(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const match = /\(min-width:\s*(\d+)px\)/u.exec(query);
    const matches = match ? width >= Number(match[1]) : false;
    return {
      matches,
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

/**
 * Mirrors the poser runtime: `texturePaintModeSelected` is derived from the active panel tab +
 * character section, which the tab/section handlers update on the next render.
 */
function HostHarness({ base, binding, onOpenAdvanced }: { base: StudioVrmPoserHost; binding: CharacterShaperBinding; onOpenAdvanced?: () => void }) {
  const [panel, setPanel] = useState({ tab: "pose", section: "forge" });
  const h: StudioVrmPoserHost = {
    ...base,
    activePanelTab: panel.tab,
    activeCharacterSection: panel.section,
    texturePaintModeSelected: panel.tab === "character" && panel.section === "surface",
    handlePanelTabChange: (tab: string) => {
      base.handlePanelTabChange(tab);
      setPanel((current) => ({ ...current, tab }));
    },
    handleCharacterSectionChange: (section: string) => {
      base.handleCharacterSectionChange(section);
      setPanel((current) => ({ ...current, section }));
    },
  };
  return <StudioCharacterShaperDialog h={h} binding={binding} onOpenAdvanced={onOpenAdvanced} />;
}

function renderDialog(options: { width?: number; h?: StudioVrmPoserHost; binding?: CharacterShaperBinding; onOpenAdvanced?: () => void } = {}) {
  installMatchMedia(options.width ?? 1440);
  const h = options.h ?? makeHost();
  const binding = options.binding ?? makeBinding();
  const view = render(<HostHarness base={h} binding={binding} onOpenAdvanced={options.onOpenAdvanced} />);
  return { ...view, h, binding };
}

const dialogRoot = () => document.querySelector<HTMLElement>('[data-character-shaper="true"]');
const rail = () => screen.getByRole("toolbar", { name: "캐릭터 슬롯" });
const railButton = (slot: string) => {
  const button = rail().querySelector<HTMLButtonElement>(`[data-character-slot="${slot}"]`);
  if (!button) throw new Error(`rail button missing: ${slot}`);
  return button;
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("StudioCharacterShaperDialog shell", () => {
  it("owns a single viewport chrome and routes contact inspection through the existing camera", () => {
    const { h } = renderDialog({ width: 390 });
    expect(screen.getByTestId("viewport").getAttribute("data-presentation")).toBe("shaper");
    const selector = screen.getByRole("combobox", { name: "부위·방향 확대 검사" });
    expect(selector.querySelectorAll("option")).toHaveLength(10);
    fireEvent.change(selector, { target: { value: "inspectRightHand" } });
    expect(h.setActiveCameraId).toHaveBeenCalledWith("inspectRightHand");
    expect(h.handleViewReset).not.toHaveBeenCalled();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: /^확대$/ })).toHaveLength(1);
  });
  it.each([
    { isCapturing: true }, { isThumbnailCapturing: true }, { isSharingPose: true },
    { viewportCameraInteractionLocked: true }, { status: "loading" },
  ])("locks inspection and quick cameras while unavailable: %o", (state) => {
    renderDialog({ h: makeHost(state) });
    expect((screen.getByRole("combobox", { name: "부위·방향 확대 검사" }) as HTMLSelectElement).disabled).toBe(true);
    for (const button of screen.getByRole("group", { name: "카메라 프리셋" }).querySelectorAll("button")) expect(button.disabled).toBe(true);
  });
  it("announces the inspection choice without replacing the five quick camera buttons", () => {
    renderDialog({ h: makeHost({ activeCameraId: "inspectFeet" }) });
    expect((screen.getByRole("combobox", { name: "부위·방향 확대 검사" }) as HTMLSelectElement).value).toBe("inspectFeet");
    expect(screen.getByRole("group", { name: "카메라 프리셋" }).querySelectorAll("button")).toHaveLength(5);
  });

  it("renders a labelled modal dialog with the legacy tooling hook and the four desktop regions", () => {
    const { h } = renderDialog();
    const root = dialogRoot();
    expect(root).toBeTruthy();
    expect(root?.getAttribute("role")).toBe("dialog");
    expect(root?.getAttribute("aria-modal")).toBe("true");
    expect(root?.getAttribute("data-studio-vrm-dialog")).toBe("true");
    expect(root?.getAttribute("aria-labelledby")).toBe("shaper-title");
    expect(root?.getAttribute("data-character-shaper-layout")).toBe("desktop");
    expect((h.dialogRef as { current: HTMLElement | null }).current).toBe(root);
    expect((h.closeButtonRef as { current: HTMLElement | null }).current?.getAttribute("aria-label")).toBe("닫기");
    expect(screen.getByRole("heading", { name: "캐릭터 셰이퍼" })).toBeTruthy();
    expect(rail().querySelectorAll("[data-character-slot]")).toHaveLength(15);
    expect(screen.getByTestId("viewport")).toBeTruthy();
    expect(screen.getByTestId("inspector").getAttribute("data-slot")).toBe("face-shape");
    expect(screen.getByRole("complementary", { name: "정밀 조절" })).toBeTruthy();
    expect(screen.getByTestId("dock").getAttribute("data-compact")).toBe("false");
    // Shelf starts on the first slot with its cards.
    expect(document.querySelectorAll("[data-character-slot-card]")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "카메라 프리셋" })).toBeTruthy();
  });

  it("switches slots from the rail, marks aria-current, and moves the shelf + inspector", () => {
    renderDialog();
    fireEvent.click(railButton("hair"));
    expect(railButton("hair").getAttribute("aria-current")).toBe("true");
    expect(railButton("face-shape").getAttribute("aria-current")).toBeNull();
    const cards = Array.from(document.querySelectorAll("[data-character-slot-card]")).map((card) => card.getAttribute("data-character-slot-card"));
    expect(cards).toEqual(["hair:bob", "hair:long"]);
    expect(screen.getByTestId("inspector").getAttribute("data-slot")).toBe("hair");
    // The slot that differs from the baseline carries a change marker.
    expect(railButton("eyes").textContent).toContain("변경됨");
    expect(railButton("hair").textContent).not.toContain("변경됨");
  });

  it("jumps slots with digits and arrows while focus is inside the rail", () => {
    renderDialog();
    const first = railButton("face-shape");
    first.focus();
    fireEvent.keyDown(first, { key: "3" });
    expect(railButton("irises").getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(railButton("irises"));
    fireEvent.keyDown(railButton("irises"), { key: "ArrowDown" });
    expect(railButton("nose").getAttribute("aria-current")).toBe("true");
    fireEvent.keyDown(railButton("nose"), { key: "End" });
    expect(railButton("hand-pose").getAttribute("aria-current")).toBe("true");
  });

  it("filters the shelf by query (debounced) and commits on click and Enter", () => {
    const { binding } = renderDialog();
    fireEvent.click(railButton("eyes"));
    expect(document.querySelectorAll("[data-character-slot-card]")).toHaveLength(3);
    const search = screen.getByRole("searchbox", { name: "눈 프리셋 검색" });
    fireEvent.change(search, { target: { value: "고양이" } });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    const cards = document.querySelectorAll<HTMLElement>("[data-character-slot-card]");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-character-slot-card")).toBe("eyes:cat");
    fireEvent.click(cards[0]!);
    expect(binding.commit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(binding.commit).mock.calls[0]?.[0]?.id).toBe("eyes:cat");
    // Escape in a non-empty search clears it instead of closing anything.
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(document.querySelectorAll("[data-character-slot-card]")).toHaveLength(3);
    const round = document.querySelector<HTMLElement>('[data-character-slot-card="eyes:round"]')!;
    round.focus();
    fireEvent.keyDown(round, { key: "Enter" });
    fireEvent.click(round);
    expect(binding.commit).toHaveBeenCalledTimes(2);
    expect(round.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps unavailable cards focusable but inert, with the reason exposed", () => {
    const { binding } = renderDialog();
    fireEvent.click(railButton("eyes"));
    const far = document.querySelector<HTMLElement>('[data-character-slot-card="eyes:far"]')!;
    expect(far.getAttribute("aria-disabled")).toBe("true");
    expect(far.getAttribute("tabindex")).toBe("-1");
    expect(far.textContent).toContain("적용 불가");
    expect(far.textContent).toContain("이 모델에는 눈 간격 shape key가 없어 적용할 수 없습니다.");
    expect(far.getAttribute("title")).toContain("눈 간격 shape key");
    fireEvent.click(far);
    expect(binding.commit).not.toHaveBeenCalled();
    const cat = document.querySelector<HTMLElement>('[data-character-slot-card="eyes:cat"]')!;
    expect(cat.textContent).toContain("일부 적용");
    expect(cat.getAttribute("aria-disabled")).toBeNull();
    // Roving focus: only the selected card is in the tab order; arrows move focus.
    const round = document.querySelector<HTMLElement>('[data-character-slot-card="eyes:round"]')!;
    expect(round.getAttribute("tabindex")).toBe("0");
    round.focus();
    fireEvent.keyDown(round, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cat);
    fireEvent.keyDown(cat, { key: "ArrowDown" });
    expect(document.activeElement).toBe(far);
    fireEvent.keyDown(far, { key: "Home" });
    expect(document.activeElement).toBe(round);
  });

  it("routes ⌘Z / ⇧⌘Z to the Shaper history and leaves typing alone", () => {
    const { binding } = renderDialog();
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(binding.undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(binding.redo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(binding.undo).toHaveBeenCalledTimes(2);
    const search = screen.getByRole("searchbox");
    fireEvent.keyDown(search, { key: "z", metaKey: true });
    expect(binding.undo).toHaveBeenCalledTimes(2);
  });

  it("closes the reference drawer before the dialog on Escape and returns focus to the dock button", () => {
    const { h } = renderDialog();
    const opener = screen.getByRole("button", { name: "참고 이미지 AI 추천" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId("drawer").getAttribute("data-mode")).toBe("reference");
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "참고 도구" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("drawer")).toBeNull();
    expect(h.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(opener);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.cancelActiveTexturePaintStroke).toHaveBeenCalled();
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("toggles 표면 드로잉 through the host tab/section handlers and restores on exit", () => {
    const { h } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "표면 드로잉" }));
    expect(h.handlePanelTabChange).toHaveBeenLastCalledWith("character");
    expect(h.handleCharacterSectionChange).toHaveBeenLastCalledWith("surface");
    expect(screen.getByTestId("paint-hud")).toBeTruthy();
    expect(dialogRoot()?.getAttribute("data-character-shaper-paint")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "드로잉 종료" }));
    expect(h.handlePanelTabChange).toHaveBeenLastCalledWith("pose");
    expect(screen.queryByTestId("paint-hud")).toBeNull();
    // B toggles paint, T toggles the turntable.
    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByTestId("paint-hud")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("paint-hud")).toBeNull();
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "t" });
    expect(h.setTurntable).toHaveBeenCalledTimes(1);
  });

  it("shows a skeleton while loading and an honest empty state with sample / upload actions", () => {
    const loading = renderDialog({ h: makeHost({ status: "loading", vrm: null }) });
    expect(screen.getByRole("status", { name: "프리셋 불러오는 중" })).toBeTruthy();
    expect(document.querySelectorAll("[data-character-slot-card]")).toHaveLength(0);
    loading.unmount();
    cleanup();
    const { h } = renderDialog({ h: makeHost({ status: "empty", vrm: null, activeModelId: null }) });
    fireEvent.click(screen.getByRole("button", { name: "샘플 캐릭터 불러오기" }));
    expect(h.handleSampleLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "VRM 업로드" })).toBeTruthy();
    expect(screen.getByLabelText("VRM 파일 선택").getAttribute("accept")).toBe(".vrm");
  });

  it("surfaces a refused commit and the busy reason without failing silently", () => {
    const binding = makeBinding({
      busyReason: "캡처가 끝난 뒤 바꿀 수 있습니다.",
      commit: vi.fn((item: CharacterSlotEntry): CharacterShaperCommitResult => ({
        ok: false,
        plan: { entryId: item.id, slot: item.slot, label: item.label, steps: [], availability: { status: "available", reason: null, missing: [] } },
        reason: "캡처가 끝난 뒤 바꿀 수 있습니다.",
      })),
    });
    renderDialog({ binding });
    fireEvent.click(document.querySelector<HTMLElement>('[data-character-slot-card="face-shape:egg"]')!);
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("캡처가 끝난 뒤"))).toBe(true);
  });

  it("stacks viewport, horizontal rail and the bottom sheet on mobile and collapses the sheet on Escape first", () => {
    const { h } = renderDialog({ width: 390 });
    expect(dialogRoot()?.getAttribute("data-character-shaper-layout")).toBe("mobile");
    expect(rail().getAttribute("aria-orientation")).toBe("horizontal");
    expect(screen.getByTestId("dock").getAttribute("data-compact")).toBe("true");
    const sheet = screen.getByRole("region", { name: "프리셋과 정밀 조절" });
    expect(sheet.getAttribute("data-character-shaper-sheet")).toBe("half");
    expect(screen.getByRole("tab", { name: "프리셋" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "정밀 조절" }));
    expect(screen.getByTestId("inspector")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(sheet.getAttribute("data-character-shaper-sheet")).toBe("collapsed");
    expect(h.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });

  it("collapses the inspector column on desktop and folds it into a slide-over on tablet", () => {
    const desktop = renderDialog({ width: 1440 });
    fireEvent.click(screen.getByRole("button", { name: "정밀 조절" }));
    expect(screen.queryByRole("complementary", { name: "정밀 조절" })).toBeNull();
    desktop.unmount();
    cleanup();
    renderDialog({ width: 1024 });
    expect(dialogRoot()?.getAttribute("data-character-shaper-layout")).toBe("tablet");
    const aside = screen.getByRole("complementary", { name: "정밀 조절" });
    expect(aside.getAttribute("data-character-shaper-inspector")).toBe("slide-over");
    fireEvent.click(screen.getByRole("button", { name: "정밀 조절 닫기" }));
    expect(screen.queryByRole("complementary", { name: "정밀 조절" })).toBeNull();
  });
});
