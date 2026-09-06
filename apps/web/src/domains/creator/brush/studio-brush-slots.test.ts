import { describe, expect, it } from "vitest";

import {
  normalizeStudioBrushDynamicsSettings,
  studioBrushDynamicsPresetSettings,
} from "./studio-brush-dynamics";
import {
  assignStudioBrushSlot,
  emptyStudioBrushSlots,
  loadStudioBrushSlotsState,
  normalizeStudioBrushSlot,
  rememberStudioBrushSlot,
  saveStudioBrushSlotsState,
  STUDIO_BRUSH_SLOTS_LEGACY_STORAGE_KEY,
  STUDIO_BRUSH_SLOTS_STORAGE_KEY,
  studioBrushSlotAt,
} from "./studio-brush-slots";

describe("studio brush slots", () => {
  it("remembers recent brushes at the front for quick recall", () => {
    let state = emptyStudioBrushSlots();
    state = rememberStudioBrushSlot(state, { brushId: "pen", strokeWidth: 6, brushOpacity: 1 });
    state = rememberStudioBrushSlot(state, { brushId: "marker", strokeWidth: 16, brushOpacity: 0.6 });
    expect(state.slots[0]?.brushId).toBe("marker");
    expect(state.slots[1]?.brushId).toBe("pen");
  });

  it("assigns and recalls numbered slots 1–6", () => {
    let state = emptyStudioBrushSlots();
    state = assignStudioBrushSlot(state, 2, { brushId: "pencil", strokeWidth: 3, brushOpacity: 0.85 });
    expect(studioBrushSlotAt(state, 2)).toEqual({
      brushId: "pencil",
      strokeWidth: 3,
      brushOpacity: 0.85,
    });
    expect(studioBrushSlotAt(state, 0)).toBeNull();
  });

  it("persists through storage helpers", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    const state = rememberStudioBrushSlot(emptyStudioBrushSlots(), {
      brushId: "gpen",
      strokeWidth: 8,
      brushOpacity: 1,
    });
    expect(saveStudioBrushSlotsState(storage, state)).toBe(true);
    expect(loadStudioBrushSlotsState(storage).slots[0]?.brushId).toBe("gpen");
    expect(map.has(STUDIO_BRUSH_SLOTS_STORAGE_KEY)).toBe(true);
  });

  it("reads the unchanged v1 storage key and keeps legacy slots lightweight", () => {
    const storage = {
      getItem: (key: string) => key === STUDIO_BRUSH_SLOTS_LEGACY_STORAGE_KEY
        ? JSON.stringify({
          slots: [{ brushId: "pencil", strokeWidth: 4, brushOpacity: 0.72 }],
        })
        : null,
      setItem: () => undefined,
    };

    expect(loadStudioBrushSlotsState(storage).slots[0]).toEqual({
      brushId: "pencil",
      strokeWidth: 4,
      brushOpacity: 0.72,
    });
  });

  it("persists bounded source metadata and fully normalized brush dynamics", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => map.set(key, value),
    };
    const rawDynamics = {
      ...studioBrushDynamicsPresetSettings("dry-media"),
      seed: -42,
      spacingRatio: 999,
      width: { base: -4, mappings: [{ source: "pressure", amount: 8 }] },
    };
    const state = rememberStudioBrushSlot(emptyStudioBrushSlots(), {
      brushId: "pencil",
      strokeWidth: 5,
      brushOpacity: 0.8,
      sourcePresetId: "  essentials:pencil-grain  ",
      sourcePresetName: "  거친 흑연  ",
      brushDynamics: rawDynamics as unknown as ReturnType<typeof normalizeStudioBrushDynamicsSettings>,
    });

    expect(saveStudioBrushSlotsState(storage, state)).toBe(true);
    expect(loadStudioBrushSlotsState(storage).slots[0]).toMatchObject({
      brushId: "pencil",
      sourcePresetId: "essentials:pencil-grain",
      sourcePresetName: "거친 흑연",
      brushDynamics: normalizeStudioBrushDynamicsSettings(rawDynamics),
    });
  });

  it("keeps canonical brushId restricted to installed BRUSH_PRESETS", () => {
    expect(normalizeStudioBrushSlot({
      brushId: "essentials:pencil-grain",
      strokeWidth: 5,
      brushOpacity: 1,
      sourcePresetId: "essentials:pencil-grain",
    })).toBeNull();
    expect(normalizeStudioBrushSlot({
      brushId: "pencil",
      strokeWidth: 5,
      brushOpacity: 1,
      sourcePresetId: "essentials:pencil-grain",
    })?.brushId).toBe("pencil");
  });

  it("deduplicates only exact source and dynamics matches", () => {
    const dynamicsA = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("dry-media"),
      seed: 10,
    });
    const dynamicsB = normalizeStudioBrushDynamicsSettings({
      ...studioBrushDynamicsPresetSettings("dry-media"),
      seed: 11,
    });
    let state = emptyStudioBrushSlots();
    state = rememberStudioBrushSlot(state, {
      brushId: "pencil",
      strokeWidth: 5,
      brushOpacity: 1,
      sourcePresetId: "pack:pencil-a",
      brushDynamics: dynamicsA,
    });
    state = rememberStudioBrushSlot(state, {
      brushId: "pencil",
      strokeWidth: 5,
      brushOpacity: 1,
      sourcePresetId: "pack:pencil-b",
      brushDynamics: dynamicsA,
    });
    state = rememberStudioBrushSlot(state, {
      brushId: "pencil",
      strokeWidth: 5,
      brushOpacity: 1,
      sourcePresetId: "pack:pencil-b",
      brushDynamics: dynamicsB,
    });
    expect(state.slots.filter(Boolean)).toHaveLength(3);

    state = rememberStudioBrushSlot(state, {
      brushId: "pencil",
      strokeWidth: 5,
      brushOpacity: 1,
      sourcePresetId: "pack:pencil-b",
      brushDynamics: dynamicsB,
    });
    expect(state.slots.filter(Boolean)).toHaveLength(3);
    expect(state.slots[0]?.brushDynamics?.seed).toBe(11);
  });
});
