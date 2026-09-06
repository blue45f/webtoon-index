import { describe, expect, it, vi } from "vitest";

import { CHARACTER_SLOT_KINDS } from "./character-shaper-contract";
import {
  characterLightingToneLabel,
  characterShaperSlotIcon,
  characterSlotDiffersFromBaseline,
  characterSlotForHotkey,
  characterSlotHotkeyLabel,
  characterSlotSelection,
  collapseCharacterSheet,
  collectShelfTags,
  countCharacterShaperKeyLayers,
  createCharacterShaperUiState,
  cycleCharacterSheet,
  describeAvailabilityBadge,
  expandCharacterSheet,
  filterShelfEntries,
  groupCharacterSlotMetas,
  isCharacterEntrySelected,
  isCharacterShaperTypingTarget,
  listShelfEntries,
  moveCharacterGridIndex,
  nextCharacterLightingTone,
  pushCharacterShaperKeyLayer,
  reduceCharacterShaperUiState,
  resolveCharacterShaperLayout,
} from "./character-shaper-ui-model";

import type { CharacterRecipe, CharacterSlotEntry, CharacterSlotMeta } from "./character-shaper-contract";

function entry(overrides: Partial<CharacterSlotEntry> & { readonly id: string }): CharacterSlotEntry {
  return {
    slot: "eyes",
    label: overrides.id,
    hint: "",
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

function recipe(slots: Partial<CharacterRecipe["slots"]> = {}): CharacterRecipe {
  const base = Object.fromEntries(CHARACTER_SLOT_KINDS.map((slot) => [slot, slot === "accessory" ? [] : null]));
  return {
    version: 1,
    slots: { ...base, ...slots } as CharacterRecipe["slots"],
    colors: { skin: null, hairBase: null, hairTip: null, iris: null, top: null, bottom: null, shoes: null },
    handSide: "both",
  };
}

describe("character-shaper-ui-model layout + state", () => {
  it("maps widths to desktop / tablet / mobile", () => {
    expect(resolveCharacterShaperLayout(1440)).toBe("desktop");
    expect(resolveCharacterShaperLayout(1280)).toBe("desktop");
    expect(resolveCharacterShaperLayout(1279)).toBe("tablet");
    expect(resolveCharacterShaperLayout(768)).toBe("tablet");
    expect(resolveCharacterShaperLayout(390)).toBe("mobile");
    expect(resolveCharacterShaperLayout(Number.NaN)).toBe("desktop");
  });

  it("select-slot resets search state, keeps identity for the same slot, and lifts a collapsed sheet", () => {
    const state = createCharacterShaperUiState({ query: "고양이", tag: "romance", hoveredEntryId: "eyes:x", mobileSheet: "collapsed" });
    expect(reduceCharacterShaperUiState(state, { type: "select-slot", slot: state.activeSlot })).toBe(state);
    const next = reduceCharacterShaperUiState(state, { type: "select-slot", slot: "hair" });
    expect(next).toMatchObject({ activeSlot: "hair", query: "", tag: null, hoveredEntryId: null, mobileSheet: "half" });
  });

  it("escape closes drawer → mobile sheet → paint, then reports no change", () => {
    const start = createCharacterShaperUiState({ drawer: "photo", paintActive: true, mobileSheet: "full" });
    const afterDrawer = reduceCharacterShaperUiState(start, { type: "escape", layout: "mobile" });
    expect(afterDrawer.drawer).toBeNull();
    expect(afterDrawer.mobileSheet).toBe("full");
    const afterSheet = reduceCharacterShaperUiState(afterDrawer, { type: "escape", layout: "mobile" });
    expect(afterSheet.mobileSheet).toBe("collapsed");
    expect(afterSheet.paintActive).toBe(true);
    const afterPaint = reduceCharacterShaperUiState(afterSheet, { type: "escape", layout: "mobile" });
    expect(afterPaint.paintActive).toBe(false);
    expect(reduceCharacterShaperUiState(afterPaint, { type: "escape", layout: "mobile" })).toBe(afterPaint);
    // Desktop never touches the sheet.
    const desktop = reduceCharacterShaperUiState(createCharacterShaperUiState({ mobileSheet: "full" }), { type: "escape", layout: "desktop" });
    expect(desktop.mobileSheet).toBe("full");
  });

  it("no-op actions return the same state object", () => {
    const state = createCharacterShaperUiState();
    expect(reduceCharacterShaperUiState(state, { type: "set-query", query: "" })).toBe(state);
    expect(reduceCharacterShaperUiState(state, { type: "close-drawer" })).toBe(state);
    expect(reduceCharacterShaperUiState(state, { type: "set-inspector", open: true })).toBe(state);
  });

  it("cycles and steps the mobile sheet", () => {
    expect(expandCharacterSheet("collapsed")).toBe("half");
    expect(expandCharacterSheet("full")).toBe("full");
    expect(collapseCharacterSheet("half")).toBe("collapsed");
    expect(collapseCharacterSheet("collapsed")).toBe("collapsed");
    expect(cycleCharacterSheet("full")).toBe("collapsed");
  });
});

describe("character-shaper-ui-model grid + hotkeys", () => {
  it("moves through a 2-column grid without wrapping", () => {
    expect(moveCharacterGridIndex(0, 5, "left")).toBe(0);
    expect(moveCharacterGridIndex(0, 5, "right")).toBe(1);
    expect(moveCharacterGridIndex(1, 5, "down")).toBe(3);
    expect(moveCharacterGridIndex(3, 5, "down")).toBe(4);
    expect(moveCharacterGridIndex(4, 5, "down")).toBe(4);
    expect(moveCharacterGridIndex(1, 5, "up")).toBe(1);
    expect(moveCharacterGridIndex(4, 5, "up")).toBe(2);
    expect(moveCharacterGridIndex(3, 5, "home")).toBe(0);
    expect(moveCharacterGridIndex(0, 5, "end")).toBe(4);
    expect(moveCharacterGridIndex(9, 5, "right")).toBe(4);
    expect(moveCharacterGridIndex(2, 0, "down")).toBe(0);
  });

  it("maps digits to the first ten slots only", () => {
    expect(characterSlotForHotkey("1")).toBe(CHARACTER_SLOT_KINDS[0]);
    expect(characterSlotForHotkey("9")).toBe(CHARACTER_SLOT_KINDS[8]);
    expect(characterSlotForHotkey("0")).toBe(CHARACTER_SLOT_KINDS[9]);
    expect(characterSlotForHotkey("q")).toBeNull();
    expect(characterSlotForHotkey("1", ["hair"])).toBe("hair");
    expect(characterSlotForHotkey("2", ["hair"])).toBeNull();
    expect(characterSlotHotkeyLabel(9)).toBe("0");
    expect(characterSlotHotkeyLabel(10)).toBeNull();
  });
});

describe("character-shaper-ui-model badges, icons, groups", () => {
  it("describes availability in plain Korean", () => {
    expect(describeAvailabilityBadge({ status: "available", reason: null, missing: [] })).toEqual({ label: "적용 가능", tone: "good", detail: null });
    expect(describeAvailabilityBadge({ status: "partial", reason: "눈 간격 shape key가 없습니다.", missing: ["eyeSpacing"] })).toMatchObject({ label: "일부 적용", tone: "warn", detail: "눈 간격 shape key가 없습니다." });
    expect(describeAvailabilityBadge({ status: "unavailable", reason: null, missing: [] })).toMatchObject({ label: "적용 불가", tone: "bad" });
    expect(describeAvailabilityBadge({ status: "unavailable", reason: null, missing: [] }).detail).toBeTruthy();
  });

  it("resolves lucide names in any casing and falls back per slot", () => {
    expect(characterShaperSlotIcon("ScanFace")).toBe(characterShaperSlotIcon("scan-face"));
    expect(characterShaperSlotIcon("scanFace")).toBe(characterShaperSlotIcon("scan_face"));
    expect(characterShaperSlotIcon("NoSuchIcon", "hair")).toBe(characterShaperSlotIcon("Scissors"));
    expect(characterShaperSlotIcon(null, "hand-pose")).toBe(characterShaperSlotIcon("Hand"));
    // Names the shipped catalog uses resolve directly instead of falling back.
    expect(characterShaperSlotIcon("CircleUserRound", "face-shape")).not.toBe(characterShaperSlotIcon("ScanFace"));
    expect(characterShaperSlotIcon("Aperture", "irises")).not.toBe(characterShaperSlotIcon("CircleDot"));
    expect(characterShaperSlotIcon("RectangleVertical", "bottom")).not.toBe(characterShaperSlotIcon("Layers2"));
    expect(typeof characterShaperSlotIcon(undefined)).not.toBe("undefined");
  });

  it("groups metas by first appearance and keeps order inside groups", () => {
    const metas: CharacterSlotMeta[] = [
      { id: "eyes", label: "눈", labelEn: "Eyes", hint: "", group: "identity", icon: "Eye", multi: false },
      { id: "pose", label: "포즈", labelEn: "Pose", hint: "", group: "performance", icon: "Move", multi: false },
      { id: "face-shape", label: "얼굴형", labelEn: "Face", hint: "", group: "identity", icon: "ScanFace", multi: false },
    ];
    const groups = groupCharacterSlotMetas(metas);
    expect(groups.map((group) => group.group)).toEqual(["identity", "performance"]);
    expect(groups[0]?.metas.map((meta) => meta.id)).toEqual(["eyes", "face-shape"]);
    expect(groups[0]?.label).toBe("얼굴");
  });
});

describe("character-shaper-ui-model recipe + shelf helpers", () => {
  it("normalises single and multi selections", () => {
    const current = recipe({ eyes: "eyes:cat", accessory: ["prop:glasses", "prop:hat"] });
    expect(characterSlotSelection(current, "eyes")).toEqual(["eyes:cat"]);
    expect(characterSlotSelection(current, "hair")).toEqual([]);
    expect(characterSlotSelection(current, "accessory")).toEqual(["prop:glasses", "prop:hat"]);
    expect(isCharacterEntrySelected(current, entry({ id: "prop:hat", slot: "accessory" }))).toBe(true);
    expect(isCharacterEntrySelected(current, entry({ id: "eyes:round" }))).toBe(false);
  });

  it("detects per-slot drift from the baseline without touching other slots", () => {
    const baseline = recipe({ eyes: "eyes:cat", accessory: ["prop:hat"] });
    const current = recipe({ eyes: "eyes:round", accessory: ["prop:hat"] });
    expect(characterSlotDiffersFromBaseline(current, baseline, "eyes")).toBe(true);
    expect(characterSlotDiffersFromBaseline(current, baseline, "accessory")).toBe(false);
    expect(characterSlotDiffersFromBaseline(current, baseline, "hair")).toBe(false);
    expect(characterSlotDiffersFromBaseline(recipe({ accessory: ["prop:hat", "prop:glasses"] }), baseline, "accessory")).toBe(true);
  });

  it("lists a slot's entries by order and filters by query / tag", () => {
    const entries = [
      entry({ id: "eyes:cat", label: "고양이 눈", hint: "치켜 올라간 눈꼬리", tags: ["romance", "action"], keywords: ["cat", "sharp"], order: 2 }),
      entry({ id: "eyes:round", label: "둥근 동안", hint: "크고 둥근 눈", tags: ["comedy"], keywords: ["round"], order: 1 }),
      entry({ id: "hair:bob", slot: "hair", label: "보브", order: 0 }),
    ];
    const listed = listShelfEntries(entries, "eyes");
    expect(listed.map((item) => item.id)).toEqual(["eyes:round", "eyes:cat"]);
    expect(filterShelfEntries(listed, "  고양이 ", null).map((item) => item.id)).toEqual(["eyes:cat"]);
    expect(filterShelfEntries(listed, "CAT", null).map((item) => item.id)).toEqual(["eyes:cat"]);
    expect(filterShelfEntries(listed, "둥근 눈", null).map((item) => item.id)).toEqual(["eyes:round"]);
    expect(filterShelfEntries(listed, "", "comedy").map((item) => item.id)).toEqual(["eyes:round"]);
    expect(filterShelfEntries(listed, "고양이", "comedy")).toEqual([]);
    expect(filterShelfEntries(listed, "로맨스", null)).toEqual([]);
    expect(filterShelfEntries(listed, "로맨스", null, { romance: "로맨스" }).map((item) => item.id)).toEqual(["eyes:cat"]);
    expect(filterShelfEntries(listed, "round", null).map((item) => item.id)).toEqual(["eyes:round"]);
    expect(collectShelfTags(listed)).toEqual(["romance", "action", "comedy"]);
  });

  it("cycles lighting tones with Korean labels", () => {
    expect(characterLightingToneLabel("night")).toBe("밤");
    expect(characterLightingToneLabel(undefined)).toBe("아침");
    expect(nextCharacterLightingTone("morning")).toBe("sunset");
    expect(nextCharacterLightingTone("studio")).toBe("morning");
    expect(nextCharacterLightingTone("bogus")).toBe("morning");
  });

  it("recognises typing targets", () => {
    expect(isCharacterShaperTypingTarget({ tagName: "input" } as unknown as EventTarget)).toBe(true);
    expect(isCharacterShaperTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isCharacterShaperTypingTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isCharacterShaperTypingTarget(null)).toBe(false);
  });
});

describe("character-shaper-ui-model key layers", () => {
  it("dispatches newest layer first, stops at the first handler, and releases cleanly", () => {
    const target = new EventTarget();
    const before = countCharacterShaperKeyLayers();
    const outer = vi.fn(() => false);
    const inner = vi.fn(() => true);
    const releaseOuter = pushCharacterShaperKeyLayer(outer, target);
    const releaseInner = pushCharacterShaperKeyLayer(inner, target);
    expect(countCharacterShaperKeyLayers()).toBe(before + 2);

    target.dispatchEvent(new Event("keydown"));
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();

    releaseInner();
    target.dispatchEvent(new Event("keydown"));
    expect(outer).toHaveBeenCalledTimes(1);

    releaseOuter();
    releaseOuter();
    expect(countCharacterShaperKeyLayers()).toBe(before);
    target.dispatchEvent(new Event("keydown"));
    expect(outer).toHaveBeenCalledTimes(1);
  });
});
