import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_CHAIN,
  GOOGLE_PLAY_LOCALE_LIST,
  getLanguageOptions,
  getLocaleCandidates,
  resolveSelectableLocale,
  i18nDict,
  ensureRuntimeLocaleBundle,
  resolveI18nValue,
} from "@/shared/lib/i18n";
import { APP_I18N_BUILT_IN_LOCALES } from "@/shared/lib/i18n-locale-catalog";

function mockTranslationResponseForRequest(url: string): Response {
  const parsed = new URL(url);
  const source = parsed.searchParams.get("q") ?? "";

  return new Response(
    JSON.stringify({
      responseData: {
        translatedText: `${source}-translated`,
      },
      responseStatus: 200,
    }),
    { status: 200 }
  );
}

function makeCachedLocalePayload(locale: string, dict: Record<string, string>) {
  return {
    v: 1,
    locale,
    updatedAt: Date.now(),
    dict,
  };
}

async function withLocalStorage<T>(fn: () => T | Promise<T>): Promise<T> {
  const originalStorage = (globalThis as { localStorage?: Storage | undefined }).localStorage;
  const map = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    key: () => null,
  };

  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    configurable: true,
    writable: true,
  });

  try {
    return await fn();
  } finally {
    if (originalStorage === undefined) {
      Object.defineProperty(globalThis, "localStorage", {
        value: undefined,
        configurable: true,
      });
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        value: originalStorage,
        configurable: true,
        writable: true,
      });
    }
  }
}

function collectSourceI18nKeys(): Set<string> {
  const roots = ["components", "lib", "src"];
  const visited = new Set<string>();
  const used = new Set<string>();
  const keyRe = /\bt\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  const walk = (dir: string): void => {
    if (visited.has(dir)) return;
    visited.add(dir);

    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".git" || name === "__tests__") continue;

      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }

      if (![".ts", ".tsx", ".js", ".jsx"].includes(extname(full))) continue;

      const text = readFileSync(full, "utf8");
      for (const match of text.matchAll(keyRe)) {
        used.add(match[1]);
      }
    }
  };

  for (const root of roots) {
    walk(root);
  }

  return used;
}

function readRouteDictionary(relativePath: string): Record<string, string> {
  const parsed = JSON.parse(readFileSync(relativePath, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid route dictionary: ${relativePath}`);
  }
  return parsed as Record<string, string>;
}


describe("i18n locale candidates", () => {
  it("prioritizes requested locale and fallback chain", () => {
    const candidates = getLocaleCandidates("en-US");
    expect(candidates[0]).toBe("en-us");
    expect(candidates).toContain("en");
    expect(candidates).toContain(FALLBACK_CHAIN[FALLBACK_CHAIN.length - 1]);
  });

  it("uses hierarchy fallback for script and region codes", () => {
    const candidates = getLocaleCandidates("zh-Hant-TW");

    expect(candidates[0]).toBe("zh-hant-tw");
    expect(candidates).toContain("zh-hant");
    expect(candidates).toContain("zh");
    expect(candidates).toContain("en");
    expect(candidates).toContain("ko");
  });

  it("maps browser-only region variants to a locale exposed by the language control", () => {
    expect(resolveSelectableLocale("ko-KR")).toBe("ko");
    expect(resolveSelectableLocale("zh-Hant-TW")).toBe("zh-hant");
    expect(resolveSelectableLocale("en-US")).toBe("en-us");
    expect(resolveSelectableLocale("not-a-published-locale")).toBe("ko");
  });
});

describe("getLanguageOptions", () => {
  it("builds options from known and Google Play locales", () => {
    const options = getLanguageOptions("en");
    const optionCodes = new Set(options.map((item) => item.code));
    const normalizedGooglePlay = new Set(
      GOOGLE_PLAY_LOCALE_LIST.map((code) => code.trim().replace(/_/g, "-").toLowerCase())
    );

    expect(options).toHaveLength(optionCodes.size);
    expect(optionCodes.size).toBe(normalizedGooglePlay.size);

    for (const requiredCode of ["en", "ko", "zh", "zh-hans", "zh-hant", "es-419"]) {
      expect(optionCodes.has(requiredCode)).toBe(true);
    }
  });

  it("preserves labels for english locale", () => {
    const options = getLanguageOptions("en");
    const english = options.find((entry) => entry.code === "en");

    expect(english?.code).toBe("en");
    expect(english?.nativeLabel).toBe("English");
    expect(english?.englishLabel).toBe("English");
    expect(english?.label).toBe("English");
  });

  it("uses locale candidate fallback when resolving missing translations", () => {
    expect(resolveI18nValue("fr-CA", "app.name", ["en"])).toBe(i18nDict.en["app.name"]);
    expect(resolveI18nValue("pt-BR", "search.title")).toBe(i18nDict.en["search.title"]);
    expect(resolveI18nValue("fr-CA", "does-not-exist", [])).toBe("does-not-exist");
    expect(resolveI18nValue("xx-YY", "missing", [])).toBe("missing");
  });
});

describe("runtime translation bundles", () => {
  // Every test below installs a fetch spy and restores it on its last line. When an assertion in
  // between fails, that restore never runs, and the next `vi.spyOn(globalThis, "fetch")` reuses the
  // still-installed spy — call history included — so one failure cascades into
  // "fetch called 2008 times" in the tests that assert no network. Restore unconditionally.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds locale runtime translation bundle using external translator", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) => Promise.resolve(mockTranslationResponseForRequest(url.toString())));

    await ensureRuntimeLocaleBundle("eo");

    expect(fetchSpy).toHaveBeenCalled();
    expect(resolveI18nValue("eo", "app.name")).toBe(`${i18nDict.en["app.name"]}-translated`);

    fetchSpy.mockRestore();
  });

  it("skips translation when locale is already covered by base dictionary root", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("should not be called"));
    await ensureRuntimeLocaleBundle("en-US");
    await ensureRuntimeLocaleBundle("ko-KR");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(resolveI18nValue("en-US", "app.name")).toBe(i18nDict.en["app.name"]);
    expect(resolveI18nValue("ko-KR", "app.name")).toBe(i18nDict.ko["app.name"]);

    fetchSpy.mockRestore();
  });

  it("builds runtime translation bundle for locale outside Google Play locale list", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) => Promise.resolve(mockTranslationResponseForRequest(url.toString())));

    await ensureRuntimeLocaleBundle("tlh");

    expect(fetchSpy).toHaveBeenCalled();
    expect(resolveI18nValue("tlh", "app.name")).toBe(`${i18nDict.en["app.name"]}-translated`);

    fetchSpy.mockRestore();
  });

  it("can translate Google Play script/region variants", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url) => Promise.resolve(mockTranslationResponseForRequest(url.toString())));

    await ensureRuntimeLocaleBundle("eo-EO");

    expect(fetchSpy).toHaveBeenCalled();
    expect(resolveI18nValue("eo-EO", "search.title")).toBe(
      `${i18nDict.en["search.title"]}-translated`
    );

    fetchSpy.mockRestore();
  });

    it("falls back to language root when locale-specific translation variant is unavailable", async () => {
      const calls: string[] = [];
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        const parsed = new URL(url.toString());
        const langpair = parsed.searchParams.get("langpair") ?? "";
        const target = langpair.split("|")[1] ?? "";
        calls.push(langpair);

        if (target !== "xx-YY") {
          const source = parsed.searchParams.get("q") ?? "";
          return Promise.resolve(
            new Response(
              JSON.stringify({
                responseData: {
                translatedText: `${source}-base-lang`,
              },
              responseStatus: 200,
            }),
            { status: 200 }
          )
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            responseData: {
              translatedText: `${parsed.searchParams.get("q")}-bad-locale`,
            },
            responseStatus: 503,
          }),
          { status: 200 }
          )
      );
    });

    await ensureRuntimeLocaleBundle("xx-YY");

    expect(calls.some((value) => value.includes("|xx-YY"))).toBe(true);
    expect(calls.some((value) => value.includes("|xx"))).toBe(true);
    expect(resolveI18nValue("xx-YY", "app.name")).toBe(`${i18nDict.en["app.name"]}-base-lang`);

    fetchSpy.mockRestore();
  });

  it("uses cached runtime translation bundle without calling translator", async () => {
    return withLocalStorage(async () => {
      const cacheKey = "toonspectrum-i18n-runtime:v1:ia";
      localStorage.setItem(
        cacheKey,
        JSON.stringify(
          makeCachedLocalePayload("ia", {
            "app.name": "ToonSpectrum Cached",
            "common.loading": "Cargando cached",
          })
        )
      );

      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          '{"responseStatus":200,"responseData":{"translatedText":"x"}}',
          {
            status: 200,
          }
        )
      );

      await ensureRuntimeLocaleBundle("ia");

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(resolveI18nValue("ia", "app.name")).toBe("ToonSpectrum Cached");
      expect(resolveI18nValue("ia", "common.loading")).toBe("Cargando cached");

      fetchSpy.mockRestore();
    });
  });

  it("falls back when translator returns non-success status", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ responseData: { translatedText: "Not used" }, responseStatus: 503 }),
          { status: 200 }
        )
      );

    await ensureRuntimeLocaleBundle("de");

    expect(resolveI18nValue("de", "app.name", ["en", "ko"])).toBe(i18nDict.en["app.name"]);

    fetchSpy.mockRestore();
  });
});

describe("translation dictionary completeness", () => {
  it("keeps every t() key covered by its shell or lazy route dictionaries", () => {
    const usedKeys = collectSourceI18nKeys();
    const shellKeys = new Set([...Object.keys(i18nDict.ko), ...Object.keys(i18nDict.en)]);
    const adminEn = readRouteDictionary("apps/web/public/i18n/admin");
    const adminKo = readRouteDictionary("apps/web/public/i18n/admin");
    const adminKeys = [...usedKeys].filter((key) => key.startsWith("admin."));
    const shellMissing = [...usedKeys]
      .filter((key) => !key.startsWith("admin.") && !shellKeys.has(key))
      .sort();
    const adminEnMissing = adminKeys.filter((key) => !adminEn[key]).sort();
    const adminKoMissing = adminKeys.filter((key) => !adminKo[key]).sort();

    expect({ shellMissing, adminEnMissing, adminKoMissing }).toEqual({
      shellMissing: [],
      adminEnMissing: [],
      adminKoMissing: [],
    });
  });

  // Per-locale coverage of the 75 published dictionaries lives in i18n-locale-assets.test.ts;
  // it reads public/i18n/app/<namespace>/<locale>.json directly because those assets are no longer bundled.
  it("compiles only the ko/en fallback pair into the app shell", () => {
    expect([...APP_I18N_BUILT_IN_LOCALES]).toEqual(["ko", "en"]);

    // FALLBACK_CHAIN is the last line of defence for every one of the 75 locales, so every link
    // in it must resolve out of the shell without awaiting an asset.
    for (const locale of FALLBACK_CHAIN) {
      expect(
        (APP_I18N_BUILT_IN_LOCALES as readonly string[]).includes(locale),
        `fallback locale ${locale} must be compiled into the shell`,
      ).toBe(true);
      const appKeys = Object.keys(i18nDict[locale]).filter((key) => !key.startsWith("studio."));
      expect(appKeys.length, `shell locale ${locale} app key count`).toBeGreaterThanOrEqual(525);
    }
  });

  it("resolves valid translations for every Google Play country/locale in the world", () => {
    for (const rawLocale of GOOGLE_PLAY_LOCALE_LIST) {
      const appName = resolveI18nValue(rawLocale, "app.name");
      const commonClose = resolveI18nValue(rawLocale, "common.close");
      const searchTitle = resolveI18nValue(rawLocale, "search.title");

      expect(appName, `app.name for ${rawLocale}`).toBeTruthy();
      expect(commonClose, `common.close for ${rawLocale}`).toBeTruthy();
      expect(searchTitle, `search.title for ${rawLocale}`).toBeTruthy();
    }
  });

  it("resolves authentic non-English Studio and App translations for Chinese, Japanese, Spanish, etc.", async () => {
    await ensureRuntimeLocaleBundle("zh");
    expect(resolveI18nValue("zh", "common.close")).toBe("关闭");
    expect(resolveI18nValue("zh", "studio.settings.title")).toBe("应用程序设置");

    await ensureRuntimeLocaleBundle("zh-hant");
    expect(resolveI18nValue("zh-hant", "common.close")).toBe("關閉");
    expect(resolveI18nValue("zh-hant", "studio.settings.title")).toBe("應用程式設定");

    await ensureRuntimeLocaleBundle("ja");
    expect(resolveI18nValue("ja", "common.close")).toBe("閉じる");
    expect(resolveI18nValue("ja", "studio.settings.title")).toBe("アプリケーション設定");

    await ensureRuntimeLocaleBundle("es");
    expect(resolveI18nValue("es", "common.close")).toBe("Cerrar");

    await ensureRuntimeLocaleBundle("fr");
    expect(resolveI18nValue("fr", "common.close")).toBe("Fermer");

    await ensureRuntimeLocaleBundle("de");
    expect(resolveI18nValue("de", "common.close")).toBe("Schließen");
  });
});
