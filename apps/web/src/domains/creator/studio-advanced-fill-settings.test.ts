import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
  loadStudioAdvancedFillSettings,
  normalizeStudioAdvancedFillSettings,
  saveStudioAdvancedFillSettings,
  STUDIO_ADVANCED_FILL_LEAK_REMEDIES,
  STUDIO_ADVANCED_FILL_LEAK_REMEDY_IDS,
  STUDIO_ADVANCED_FILL_LIMITS,
  STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_DESCRIPTIONS,
  STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_LABELS,
  STUDIO_ADVANCED_FILL_REFERENCE_SCOPES,
  STUDIO_ADVANCED_FILL_SETTING_LABELS,
  STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY,
  type StudioAdvancedFillSettingsStorage,
} from "./studio-advanced-fill-settings";

function memoryStorage(initial: Record<string, string> = {}): StudioAdvancedFillSettingsStorage & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("studio advanced fill settings contract", () => {
  it("exposes the stable reference scopes and commercial-safe defaults", () => {
    expect(STUDIO_ADVANCED_FILL_REFERENCE_SCOPES).toEqual([
      "current",
      "reference",
      "all-visible",
    ]);
    expect(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS).toEqual({
      version: 1,
      referenceScope: "current",
      tolerance: 32,
      contiguous: true,
      expansionPx: 1.5,
      closeGapPx: 0,
      antiAlias: true,
      continuousFill: true,
      leakGuard: true,
      leakGuardMaxFillRatio: 0.65,
      treatCanvasEdgeAsBoundary: true,
    });
    expect(Object.isFrozen(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS)).toBe(true);
  });

  it("publishes exact numeric ranges and steps for UI controls", () => {
    expect(STUDIO_ADVANCED_FILL_LIMITS).toEqual({
      tolerance: { min: 0, max: 255, step: 1 },
      expansionPx: { min: -16, max: 16, step: 0.5 },
      closeGapPx: { min: 0, max: 32, step: 1 },
      leakGuardMaxFillRatio: { min: 0.05, max: 0.95, step: 0.01 },
    });
  });

  it("provides complete Korean reference and setting copy", () => {
    expect(STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_LABELS).toEqual({
      current: "현재 레이어",
      reference: "참조 레이어",
      "all-visible": "표시 래스터(편집 대상 제외)",
    });
    expect(Object.keys(STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_DESCRIPTIONS).sort()).toEqual(
      [...STUDIO_ADVANCED_FILL_REFERENCE_SCOPES].sort()
    );
    expect(Object.keys(STUDIO_ADVANCED_FILL_SETTING_LABELS).sort()).toEqual(
      [
        "antiAlias",
        "closeGapPx",
        "contiguous",
        "continuousFill",
        "expansionPx",
        "leakGuard",
        "leakGuardMaxFillRatio",
        "referenceScope",
        "tolerance",
        "treatCanvasEdgeAsBoundary",
      ].sort()
    );

    for (const copy of [
      ...Object.values(STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_LABELS),
      ...Object.values(STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_DESCRIPTIONS),
      ...Object.values(STUDIO_ADVANCED_FILL_SETTING_LABELS),
    ]) {
      expect(copy.trim().length).toBeGreaterThan(0);
      expect(copy).toMatch(/[가-힣]/);
    }
  });

  it("provides ordered, unique, immutable Korean leak remedies", () => {
    expect(STUDIO_ADVANCED_FILL_LEAK_REMEDIES.map(({ id }) => id)).toEqual(
      STUDIO_ADVANCED_FILL_LEAK_REMEDY_IDS
    );
    expect(new Set(STUDIO_ADVANCED_FILL_LEAK_REMEDY_IDS).size).toBe(
      STUDIO_ADVANCED_FILL_LEAK_REMEDY_IDS.length
    );
    expect(Object.isFrozen(STUDIO_ADVANCED_FILL_LEAK_REMEDIES)).toBe(true);

    for (const remedy of STUDIO_ADVANCED_FILL_LEAK_REMEDIES) {
      expect(Object.isFrozen(remedy)).toBe(true);
      expect(remedy.label).toMatch(/[가-힣]/);
      expect(remedy.description).toMatch(/[가-힣]/);
    }
  });
});

describe("normalizeStudioAdvancedFillSettings", () => {
  it.each([
    undefined,
    null,
    false,
    1,
    [],
    {},
    { version: 0 },
    { version: 2 },
    { version: "1" },
  ])("uses defaults for an invalid root or version: %j", (raw) => {
    expect(normalizeStudioAdvancedFillSettings(raw)).toEqual(
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS
    );
  });

  it.each(["", "{bad json", "null", "[]", "{}", '{"version":2}'])
    ("uses defaults for corrupt or incompatible JSON: %s", (raw) => {
      expect(normalizeStudioAdvancedFillSettings(raw)).toEqual(
        DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS
      );
    });

  it.each(STUDIO_ADVANCED_FILL_REFERENCE_SCOPES)("preserves the supported %s scope", (scope) => {
    expect(
      normalizeStudioAdvancedFillSettings({
        ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
        referenceScope: scope,
      }).referenceScope
    ).toBe(scope);
  });

  it("normalizes valid object and JSON inputs without retaining extra fields", () => {
    const raw = {
      version: 1,
      referenceScope: "reference",
      tolerance: 80,
      contiguous: false,
      expansionPx: -2.5,
      closeGapPx: 7,
      antiAlias: false,
      continuousFill: false,
      leakGuard: false,
      leakGuardMaxFillRatio: 0.42,
      treatCanvasEdgeAsBoundary: false,
      unknownOption: "discard me",
    };
    const expected = {
      version: 1,
      referenceScope: "reference",
      tolerance: 80,
      contiguous: false,
      expansionPx: -2.5,
      closeGapPx: 7,
      antiAlias: false,
      continuousFill: false,
      leakGuard: false,
      leakGuardMaxFillRatio: 0.42,
      treatCanvasEdgeAsBoundary: false,
    };

    expect(normalizeStudioAdvancedFillSettings(raw)).toEqual(expected);
    expect(normalizeStudioAdvancedFillSettings(JSON.stringify(raw))).toEqual(expected);
    expect(normalizeStudioAdvancedFillSettings(raw)).not.toHaveProperty("unknownOption");
  });

  it("recovers every invalid v1 field independently", () => {
    expect(
      normalizeStudioAdvancedFillSettings({
        version: 1,
        referenceScope: "specific-layer",
        tolerance: "64",
        contiguous: 1,
        expansionPx: null,
        closeGapPx: Number.NaN,
        antiAlias: "false",
        continuousFill: undefined,
        leakGuard: 0,
        leakGuardMaxFillRatio: Number.POSITIVE_INFINITY,
        treatCanvasEdgeAsBoundary: "true",
      })
    ).toEqual(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
  });

  it.each([
    [-100, 0],
    [-0.6, 0],
    [0.49, 0],
    [0.5, 1],
    [31.5, 32],
    [32.49, 32],
    [32.5, 33],
    [254.5, 255],
    [999, 255],
  ])("clamps and rounds tolerance %s to %s", (input, expected) => {
    expect(
      normalizeStudioAdvancedFillSettings({
        ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
        tolerance: input,
      }).tolerance
    ).toBe(expected);
  });

  it.each([
    [-100, -16],
    [-16.24, -16],
    [-15.76, -16],
    [-1.26, -1.5],
    [-1.25, -1.5],
    [-1.24, -1],
    [-0.25, -0.5],
    [-0.24, 0],
    [0, 0],
    [0.24, 0],
    [0.25, 0.5],
    [1.24, 1],
    [1.25, 1.5],
    [1.26, 1.5],
    [15.76, 16],
    [100, 16],
  ])("clamps expansion %s to the nearest 0.5px as %s", (input, expected) => {
    const actual = normalizeStudioAdvancedFillSettings({
      ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
      expansionPx: input,
    }).expansionPx;
    expect(actual).toBe(expected);
    expect(Object.is(actual, -0)).toBe(false);
  });

  it.each([
    [-2, 0],
    [0.49, 0],
    [0.5, 1],
    [9.49, 9],
    [9.5, 10],
    [31.5, 32],
    [80, 32],
  ])("clamps and rounds close-gap %s to %s pixels", (input, expected) => {
    expect(
      normalizeStudioAdvancedFillSettings({
        ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
        closeGapPx: input,
      }).closeGapPx
    ).toBe(expected);
  });

  it.each([
    [-1, 0.05],
    [0, 0.05],
    [0.049, 0.05],
    [0.054, 0.05],
    [0.055, 0.06],
    [0.654, 0.65],
    [0.655, 0.66],
    [0.949, 0.95],
    [1, 0.95],
  ])("keeps leak ratio %s inside the safe stepped range as %s", (input, expected) => {
    expect(
      normalizeStudioAdvancedFillSettings({
        ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
        leakGuardMaxFillRatio: input,
      }).leakGuardMaxFillRatio
    ).toBe(expected);
  });

  it.each([
    "contiguous",
    "antiAlias",
    "continuousFill",
    "leakGuard",
    "treatCanvasEdgeAsBoundary",
  ] as const)("accepts only real booleans for %s", (key) => {
    expect(
      normalizeStudioAdvancedFillSettings({
        ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
        [key]: false,
      })[key]
    ).toBe(false);
    expect(
      normalizeStudioAdvancedFillSettings({
        ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
        [key]: "false",
      })[key]
    ).toBe(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS[key]);
  });

  it("never mutates the source and returns fresh defaults", () => {
    const source = { version: 1, tolerance: -20 };
    const before = { ...source };
    const first = normalizeStudioAdvancedFillSettings(source);
    const second = normalizeStudioAdvancedFillSettings(null);
    const third = normalizeStudioAdvancedFillSettings(null);

    expect(source).toEqual(before);
    expect(first).not.toBe(source);
    expect(second).not.toBe(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
    expect(second).not.toBe(third);
    second.tolerance = 200;
    expect(third.tolerance).toBe(32);
    expect(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS.tolerance).toBe(32);
  });
});

describe("studio advanced fill settings persistence", () => {
  it("round-trips normalized settings under the versioned key", () => {
    const storage = memoryStorage();
    const settings = {
      ...DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS,
      referenceScope: "reference" as const,
      tolerance: 48,
      expansionPx: -1.5,
    };

    saveStudioAdvancedFillSettings(storage, settings);

    expect([...storage.values.keys()]).toEqual([STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY]);
    expect(loadStudioAdvancedFillSettings(storage)).toEqual(settings);
  });

  it("normalizes untrusted input before writing it", () => {
    const storage = memoryStorage();

    saveStudioAdvancedFillSettings(storage, {
      version: 1,
      referenceScope: "bad",
      tolerance: 999,
      contiguous: false,
      expansionPx: 1.26,
      closeGapPx: -50,
      antiAlias: false,
      continuousFill: false,
      leakGuard: false,
      leakGuardMaxFillRatio: 0,
      treatCanvasEdgeAsBoundary: false,
      injected: "not persisted",
    });

    const serialized = storage.values.get(STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY);
    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized ?? "null")).toEqual({
      version: 1,
      referenceScope: "current",
      tolerance: 255,
      contiguous: false,
      expansionPx: 1.5,
      closeGapPx: 0,
      antiAlias: false,
      continuousFill: false,
      leakGuard: false,
      leakGuardMaxFillRatio: 0.05,
      treatCanvasEdgeAsBoundary: false,
    });
  });

  it("returns defaults for absent, missing, corrupt, and incompatible persisted data", () => {
    expect(loadStudioAdvancedFillSettings(null)).toEqual(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
    expect(loadStudioAdvancedFillSettings(undefined)).toEqual(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
    expect(loadStudioAdvancedFillSettings(memoryStorage())).toEqual(
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS
    );
    expect(
      loadStudioAdvancedFillSettings(
        memoryStorage({ [STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY]: "{corrupt" })
      )
    ).toEqual(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
    expect(
      loadStudioAdvancedFillSettings(
        memoryStorage({
          [STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY]: JSON.stringify({ version: 2 }),
        })
      )
    ).toEqual(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
  });

  it("reads exactly once from the versioned key", () => {
    const getItem = vi.fn(() => JSON.stringify(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS));
    const storage: StudioAdvancedFillSettingsStorage = { getItem, setItem: vi.fn() };

    expect(loadStudioAdvancedFillSettings(storage)).toEqual(DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(getItem).toHaveBeenCalledWith(STUDIO_ADVANCED_FILL_SETTINGS_STORAGE_KEY);
  });

  it("does not throw when storage reads or writes fail", () => {
    const readFailure: StudioAdvancedFillSettingsStorage = {
      getItem: vi.fn(() => {
        throw new Error("storage read blocked");
      }),
      setItem: vi.fn(),
    };
    const writeFailure: StudioAdvancedFillSettingsStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error("storage write blocked");
      }),
    };

    expect(loadStudioAdvancedFillSettings(readFailure)).toEqual(
      DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS
    );
    expect(() =>
      saveStudioAdvancedFillSettings(writeFailure, DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS)
    ).not.toThrow();
    expect(() =>
      saveStudioAdvancedFillSettings(null, DEFAULT_STUDIO_ADVANCED_FILL_SETTINGS)
    ).not.toThrow();
  });
});
