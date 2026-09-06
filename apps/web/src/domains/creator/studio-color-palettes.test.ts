import { describe, expect, it } from "vitest";

import {
  DUOTONE_PRESETS,
  RECENT_COLORS_KEY,
  STUDIO_PALETTES,
  isValidHexColor,
  normalizeHexColor,
  pushRecentColor,
  readRecentColors,
  storeRecentColors,
} from "./studio-color-palettes";

// 휘도(0.299r + 0.587g + 0.114b) — 듀오톤 shadow/highlight 명암 검증용.
const luminance = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

// 인메모리 storage 스텁(라운드트립용).
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
};

describe("STUDIO_PALETTES", () => {
  it("has unique ids and non-empty label/tip", () => {
    const ids = STUDIO_PALETTES.map((palette) => palette.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const palette of STUDIO_PALETTES) {
      expect(palette.id.trim().length).toBeGreaterThan(0);
      expect(palette.label.trim().length).toBeGreaterThan(0);
      expect(palette.tip.trim().length).toBeGreaterThan(0);
    }
  });

  it("contains 8~12 colors per palette, all lowercase #rrggbb", () => {
    for (const palette of STUDIO_PALETTES) {
      expect(palette.colors.length).toBeGreaterThanOrEqual(8);
      expect(palette.colors.length).toBeLessThanOrEqual(12);
      for (const color of palette.colors) {
        expect(isValidHexColor(color)).toBe(true);
        expect(color).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("has no duplicate colors within a palette", () => {
    for (const palette of STUDIO_PALETTES) {
      expect(new Set(palette.colors).size).toBe(palette.colors.length);
    }
  });

  it("covers the core webtoon coloring scenes", () => {
    const ids = STUDIO_PALETTES.map((palette) => palette.id);
    for (const required of ["skin-natural", "mono-ink", "sky-hours"]) {
      expect(ids).toContain(required);
    }
  });
});

describe("DUOTONE_PRESETS", () => {
  it("has unique ids and non-empty labels", () => {
    const ids = DUOTONE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DUOTONE_PRESETS.length).toBeGreaterThanOrEqual(6);
    for (const preset of DUOTONE_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("uses valid hex colors with shadow clearly darker than highlight", () => {
    for (const preset of DUOTONE_PRESETS) {
      expect(isValidHexColor(preset.shadow)).toBe(true);
      expect(isValidHexColor(preset.highlight)).toBe(true);
      expect(luminance(preset.shadow)).toBeLessThan(luminance(preset.highlight));
    }
  });
});

describe("isValidHexColor", () => {
  it("accepts #rgb and #rrggbb in any case", () => {
    expect(isValidHexColor("#fff")).toBe(true);
    expect(isValidHexColor("#FFF")).toBe(true);
    expect(isValidHexColor("#a1b2c3")).toBe(true);
    expect(isValidHexColor("#A1B2C3")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isValidHexColor("fff")).toBe(false);
    expect(isValidHexColor("#ffff")).toBe(false);
    expect(isValidHexColor("#ffffff0")).toBe(false);
    expect(isValidHexColor("#ggg")).toBe(false);
    expect(isValidHexColor("red")).toBe(false);
    expect(isValidHexColor("")).toBe(false);
  });
});

describe("normalizeHexColor", () => {
  it("expands #RGB to lowercase #rrggbb", () => {
    expect(normalizeHexColor("#FFF")).toBe("#ffffff");
    expect(normalizeHexColor("#abc")).toBe("#aabbcc");
  });

  it("lowercases #RRGGBB", () => {
    expect(normalizeHexColor("#AbCdEf")).toBe("#abcdef");
    expect(normalizeHexColor("#123456")).toBe("#123456");
  });

  it("returns null for invalid input", () => {
    expect(normalizeHexColor("red")).toBeNull();
    expect(normalizeHexColor("")).toBeNull();
    expect(normalizeHexColor("#ffff")).toBeNull();
  });
});

describe("pushRecentColor", () => {
  it("prepends a new color (normalized)", () => {
    expect(pushRecentColor(["#111111"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(pushRecentColor([], "#ABC")).toEqual(["#aabbcc"]);
  });

  it("promotes an existing color to the front instead of duplicating", () => {
    const out = pushRecentColor(["#111111", "#222222", "#333333"], "#333333");
    expect(out).toEqual(["#333333", "#111111", "#222222"]);
  });

  it("deduplicates across #RGB / case variants of the same color", () => {
    const out = pushRecentColor(["#aabbcc", "#111111"], "#ABC");
    expect(out).toEqual(["#aabbcc", "#111111"]);
  });

  it("truncates from the tail beyond max (default 12)", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `#1111${String(i).padStart(2, "0")}`);
    const out = pushRecentColor(twelve, "#ffffff");
    expect(out).toHaveLength(12);
    expect(out[0]).toBe("#ffffff");
    expect(out).not.toContain(twelve[11]);
    expect(pushRecentColor(["#111111", "#222222"], "#333333", 2)).toEqual(["#333333", "#111111"]);
  });

  it("does not mutate the input array", () => {
    const original = ["#111111", "#222222"];
    const snapshot = [...original];
    pushRecentColor(original, "#333333");
    pushRecentColor(original, "#222222");
    expect(original).toEqual(snapshot);
  });

  it("returns the original list (same reference OK) for invalid colors", () => {
    const original = ["#111111"];
    expect(pushRecentColor(original, "red")).toBe(original);
    expect(pushRecentColor(original, "")).toBe(original);
    expect(pushRecentColor(original, "#ffff")).toBe(original);
  });
});

describe("readRecentColors / storeRecentColors", () => {
  it("round-trips a list through a stub storage", () => {
    const storage = memoryStorage();
    const list = ["#aabbcc", "#112233", "#ffffff"];
    storeRecentColors(storage, list);
    expect(readRecentColors(storage)).toEqual(list);
  });

  it("uses the shared RECENT_COLORS_KEY", () => {
    const storage = memoryStorage();
    storeRecentColors(storage, ["#123456"]);
    expect(storage.getItem(RECENT_COLORS_KEY)).toBe(JSON.stringify(["#123456"]));
  });

  it("returns [] when nothing is stored", () => {
    expect(readRecentColors(memoryStorage())).toEqual([]);
  });

  it("returns [] for broken JSON or non-array payloads", () => {
    expect(readRecentColors({ getItem: () => "{not json" })).toEqual([]);
    expect(readRecentColors({ getItem: () => '{"a":1}' })).toEqual([]);
    expect(readRecentColors({ getItem: () => "42" })).toEqual([]);
  });

  it("filters out non-hex entries from stored arrays", () => {
    const raw = JSON.stringify(["#aabbcc", "red", 7, null, "#fff", "#zzzzzz"]);
    expect(readRecentColors({ getItem: () => raw })).toEqual(["#aabbcc", "#ffffff"]);
  });

  it("returns [] when getItem throws", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(readRecentColors(storage)).toEqual([]);
  });

  it("swallows setItem failures silently", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota exceeded");
      },
    };
    expect(() => storeRecentColors(storage, ["#aabbcc"])).not.toThrow();
  });
});
