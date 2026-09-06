import { describe, expect, it } from "vitest";

import {
  defaultStudioWorkbenchPrefs,
  loadStudioWorkbenchPrefs,
  normalizeStudioWorkbenchPrefs,
  pickStudioWorkbenchOption,
  saveStudioWorkbenchPrefs,
  STUDIO_WORKBENCH_CROQUIS_INTERVALS_SEC,
  STUDIO_WORKBENCH_PREFS_STORAGE_KEY,
  studioWorkbenchPrefsStorage,
  type StudioWorkbenchPrefs,
  type StudioWorkbenchPrefsStorage,
} from "./studio-workbench-prefs";

function memoryStorage(seed?: Record<string, string>): StudioWorkbenchPrefsStorage & {
  readonly map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe("studio-workbench-prefs storage key", () => {
  it("uses the versioned repo-convention key", () => {
    expect(STUDIO_WORKBENCH_PREFS_STORAGE_KEY).toBe("toonspectrum-studio-workbench-prefs:v1");
  });
});

describe("defaultStudioWorkbenchPrefs", () => {
  it("defaults every id to a value that exists in the shipped catalogs", () => {
    expect(defaultStudioWorkbenchPrefs()).toEqual({
      assistant: {
        activeTab: "spec-slicer",
        platformId: "naver-webtoon",
        readerSpeed: "casual",
        skinToneId: "warm-fair",
        focusStage: "storyboard",
        focusPreset: "standard-25",
        croquisIntervalSec: 60,
      },
      aiSuite: {
        activeTab: "style-filter",
        styleId: "romance-manhwa",
        lightDirection: "top-left",
        ambientLight: "warm-dawn",
        genreHint: "",
      },
    });
  });

  it("returns a fresh object each call so callers cannot mutate the defaults", () => {
    const a = defaultStudioWorkbenchPrefs();
    const b = defaultStudioWorkbenchPrefs();
    expect(a).not.toBe(b);
    expect(a.assistant).not.toBe(b.assistant);
    a.assistant.platformId = "mutated";
    expect(defaultStudioWorkbenchPrefs().assistant.platformId).toBe("naver-webtoon");
  });
});

describe("normalizeStudioWorkbenchPrefs — total, never throws", () => {
  const hostile: readonly unknown[] = [
    undefined,
    null,
    0,
    1,
    NaN,
    "",
    "prefs",
    true,
    false,
    [],
    [1, 2, 3],
    Symbol("x"),
    () => undefined,
    new Map(),
    { assistant: null, aiSuite: null },
    { assistant: 42, aiSuite: "nope" },
    { assistant: [], aiSuite: [] },
  ];

  it.each(hostile.map((value, index) => [index, value] as const))(
    "returns defaults for hostile input #%i",
    (_index, value) => {
      expect(() => normalizeStudioWorkbenchPrefs(value)).not.toThrow();
      expect(normalizeStudioWorkbenchPrefs(value)).toEqual(defaultStudioWorkbenchPrefs());
    }
  );

  it("survives a prototype-polluting payload without throwing", () => {
    const parsed: unknown = JSON.parse('{"__proto__":{"polluted":true},"assistant":{}}');
    expect(() => normalizeStudioWorkbenchPrefs(parsed)).not.toThrow();
    expect(normalizeStudioWorkbenchPrefs(parsed)).toEqual(defaultStudioWorkbenchPrefs());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps valid values verbatim", () => {
    const input: StudioWorkbenchPrefs = {
      assistant: {
        activeTab: "croquis-pose",
        platformId: "lezhin-comics",
        readerSpeed: "immersive",
        skinToneId: "dark-rich",
        focusStage: "lineart",
        focusPreset: "deep-flow-50",
        croquisIntervalSec: 180,
      },
      aiSuite: {
        activeTab: "shading-assist",
        styleId: "thriller-noir-grit",
        lightDirection: "backlight-rim",
        ambientLight: "cool-moon",
        genreHint: "느와르 스릴러",
      },
    };
    expect(normalizeStudioWorkbenchPrefs(input)).toEqual(input);
  });

  it("falls back per field, leaving sibling fields intact", () => {
    const result = normalizeStudioWorkbenchPrefs({
      assistant: { platformId: "kakao-page", readerSpeed: 999 },
      aiSuite: { styleId: null, ambientLight: "sunset-golden" },
    });
    expect(result.assistant.platformId).toBe("kakao-page");
    expect(result.assistant.readerSpeed).toBe("casual");
    expect(result.aiSuite.styleId).toBe("romance-manhwa");
    expect(result.aiSuite.ambientLight).toBe("sunset-golden");
  });

  it("trims id strings and rejects whitespace-only ids", () => {
    const result = normalizeStudioWorkbenchPrefs({
      assistant: { activeTab: "  focus-timer  ", skinToneId: "   " },
    });
    expect(result.assistant.activeTab).toBe("focus-timer");
    expect(result.assistant.skinToneId).toBe("warm-fair");
  });

  it("caps absurdly long ids instead of storing them whole", () => {
    const result = normalizeStudioWorkbenchPrefs({
      assistant: { platformId: "p".repeat(5_000) },
    });
    expect(result.assistant.platformId).toHaveLength(64);
  });

  it("keeps an empty genreHint (그 자체가 '지정 안 함' 상태)", () => {
    expect(normalizeStudioWorkbenchPrefs({ aiSuite: { genreHint: "" } }).aiSuite.genreHint).toBe("");
    expect(normalizeStudioWorkbenchPrefs({ aiSuite: { genreHint: "   " } }).aiSuite.genreHint).toBe(
      ""
    );
    expect(
      normalizeStudioWorkbenchPrefs({ aiSuite: { genreHint: "x".repeat(500) } }).aiSuite.genreHint
    ).toHaveLength(120);
  });

  it("is idempotent", () => {
    const once = normalizeStudioWorkbenchPrefs({
      assistant: { croquisIntervalSec: 47, activeTab: "  color-harmony " },
      aiSuite: { genreHint: "  로맨스 판타지  " },
    });
    expect(normalizeStudioWorkbenchPrefs(once)).toEqual(once);
  });
});

describe("croquisIntervalSec snapping", () => {
  it("exposes the allowed set", () => {
    expect([...STUDIO_WORKBENCH_CROQUIS_INTERVALS_SEC]).toEqual([30, 60, 180]);
  });

  it.each([
    [30, 30],
    [60, 60],
    [180, 180],
    [0, 30],
    [-500, 30],
    [31, 30],
    [47, 60],
    [100, 60],
    [140, 180],
    [10_000, 180],
  ])("snaps %s to %s", (input, expected) => {
    expect(
      normalizeStudioWorkbenchPrefs({ assistant: { croquisIntervalSec: input } }).assistant
        .croquisIntervalSec
    ).toBe(expected);
  });

  it.each([[NaN], [Infinity], [-Infinity], ["60"], [null], [undefined], [{}]])(
    "falls back to the default for non-finite/non-number %s",
    (input) => {
      expect(
        normalizeStudioWorkbenchPrefs({ assistant: { croquisIntervalSec: input } }).assistant
          .croquisIntervalSec
      ).toBe(60);
    }
  );
});

describe("pickStudioWorkbenchOption", () => {
  const allowed = ["casual", "skimmer", "immersive"] as const;

  it("passes through a member of the catalog", () => {
    expect(pickStudioWorkbenchOption("immersive", allowed, "casual")).toBe("immersive");
  });

  it("falls back for an id the catalog no longer contains", () => {
    expect(pickStudioWorkbenchOption("retired-profile", allowed, "casual")).toBe("casual");
    expect(pickStudioWorkbenchOption("", allowed, "casual")).toBe("casual");
  });

  it("does not match inherited Object properties", () => {
    expect(pickStudioWorkbenchOption("toString", allowed, "casual")).toBe("casual");
    expect(pickStudioWorkbenchOption("constructor", allowed, "casual")).toBe("casual");
  });
});

describe("load / save round trip", () => {
  it("returns defaults when storage is missing or empty", () => {
    expect(loadStudioWorkbenchPrefs(null)).toEqual(defaultStudioWorkbenchPrefs());
    expect(loadStudioWorkbenchPrefs(undefined)).toEqual(defaultStudioWorkbenchPrefs());
    expect(loadStudioWorkbenchPrefs(memoryStorage())).toEqual(defaultStudioWorkbenchPrefs());
  });

  it("round-trips a saved value", () => {
    const storage = memoryStorage();
    const prefs = defaultStudioWorkbenchPrefs();
    prefs.assistant.platformId = "postype";
    prefs.aiSuite.genreHint = "학원 액션";

    expect(saveStudioWorkbenchPrefs(storage, prefs)).toBe(true);
    expect(storage.map.has(STUDIO_WORKBENCH_PREFS_STORAGE_KEY)).toBe(true);
    expect(loadStudioWorkbenchPrefs(storage)).toEqual(prefs);
  });

  it("normalizes on the way out, so a hand-edited value never reaches storage", () => {
    const storage = memoryStorage();
    saveStudioWorkbenchPrefs(storage, {
      assistant: { croquisIntervalSec: 47 },
      aiSuite: { styleId: 12 },
    } as unknown as StudioWorkbenchPrefs);

    const raw = storage.map.get(STUDIO_WORKBENCH_PREFS_STORAGE_KEY) ?? "";
    expect(JSON.parse(raw)).toEqual({
      ...defaultStudioWorkbenchPrefs(),
      assistant: { ...defaultStudioWorkbenchPrefs().assistant, croquisIntervalSec: 60 },
    });
  });

  it("returns defaults for corrupt JSON instead of throwing", () => {
    const storage = memoryStorage({
      [STUDIO_WORKBENCH_PREFS_STORAGE_KEY]: "{not json at all",
    });
    expect(() => loadStudioWorkbenchPrefs(storage)).not.toThrow();
    expect(loadStudioWorkbenchPrefs(storage)).toEqual(defaultStudioWorkbenchPrefs());
  });

  it("returns defaults for JSON that is valid but the wrong shape", () => {
    const storage = memoryStorage({ [STUDIO_WORKBENCH_PREFS_STORAGE_KEY]: '"just a string"' });
    expect(loadStudioWorkbenchPrefs(storage)).toEqual(defaultStudioWorkbenchPrefs());
  });

  it("returns defaults when getItem itself throws (Safari private mode)", () => {
    const hostile: StudioWorkbenchPrefsStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
    };
    expect(() => loadStudioWorkbenchPrefs(hostile)).not.toThrow();
    expect(loadStudioWorkbenchPrefs(hostile)).toEqual(defaultStudioWorkbenchPrefs());
  });

  it("reports false (never throws) when setItem throws — quota exceeded", () => {
    const full: StudioWorkbenchPrefsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveStudioWorkbenchPrefs(full, defaultStudioWorkbenchPrefs())).toBe(false);
  });

  it("reports false for a missing storage", () => {
    expect(saveStudioWorkbenchPrefs(null, defaultStudioWorkbenchPrefs())).toBe(false);
    expect(saveStudioWorkbenchPrefs(undefined, defaultStudioWorkbenchPrefs())).toBe(false);
  });
});

describe("studioWorkbenchPrefsStorage", () => {
  it("returns null when localStorage is absent (node env) and never throws", () => {
    expect(() => studioWorkbenchPrefsStorage()).not.toThrow();
    const storage = studioWorkbenchPrefsStorage();
    expect(storage === null || typeof storage.getItem === "function").toBe(true);
  });
});
