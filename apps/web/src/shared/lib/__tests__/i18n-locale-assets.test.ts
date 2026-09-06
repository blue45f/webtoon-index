import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  appI18nAssetUrl,
  getAppI18nFallbackChain,
  getAppI18nLocaleStatus,
  getAppI18nTranslatedRatio,
  getLanguageOptions,
  i18nDict,
  isFullyTranslatedAppLocale,
  loadAppI18nLocale,
  parseAppI18nDictionary,
  resolveAppI18nAssetLocale,
  resolveI18nValue,
} from "@/shared/lib/i18n";
import {
  APP_I18N_ASSET_LOCALES,
  APP_I18N_BUILT_IN_LOCALES,
  APP_I18N_LOCALE_TRANSLATED_RATIO,
  APP_I18N_TRANSLATED_LOCALE_THRESHOLD,
} from "@/shared/lib/i18n-locale-catalog";
import {
  buildCatalogSource,
  measureTranslatedRatio,
  readAppLocaleDictionaries,
} from "../../../../../../scripts/generate-app-i18n-catalog.mjs";

const ASSET_DIRECTORY = path.resolve(process.cwd(), "apps/web/public", "i18n", "app");
const REFERENCE_LOCALE = "en";
/** The app-shell key surface every published dictionary was authored against. */
const BASELINE_APP_KEY_COUNT = 525;
/**
 * Keys that exist only in the built-in ko/en pair. They describe the fallback chain itself, so
 * every other locale reaches them through that chain rather than through its own asset.
 */
const SHELL_ONLY_KEYS = [
  "control.language.group.englishBase",
  "control.language.group.translated",
];
/**
 * Translated strings for `contact` / `play` / `fortune` surfaces that neither ko nor en publish
 * and no `t()` call reads. They are unreachable through the fallback chain, so they cost nothing
 * beyond a few bytes of a lazily fetched asset — but the set is frozen here so the next orphan
 * has to be an explicit decision rather than a silent accumulation.
 */
const KNOWN_ORPHAN_KEY_PREFIXES = ["contact.", "play.", "fortune."];
const KNOWN_ORPHAN_LOCALES = ["de", "es", "fr", "ja", "zh", "zh-hant"];
const KNOWN_ORPHAN_KEY_COUNT = 17;

function readAsset(locale: string): Record<string, string> {
  return JSON.parse(
    readFileSync(path.join(ASSET_DIRECTORY, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

describe("published app locale assets", () => {
  it("keeps the generated catalog in sync with the assets on disk", () => {
    const regenerated = buildCatalogSource(readAppLocaleDictionaries());
    const committed = readFileSync(
      path.resolve(process.cwd(), "lib", "i18n-locale-catalog.ts"),
      "utf8",
    );

    // Drift here means the shipped translation ratios no longer describe the shipped assets —
    // exactly the state that let 70 locales look translated while rendering English.
    expect(regenerated).toBe(committed);
  });

  it("publishes one dictionary per catalog locale, each covering the baseline key surface", () => {
    const reference = readAsset(REFERENCE_LOCALE);
    const referenceKeys = Object.keys(reference);
    expect(referenceKeys.length).toBeGreaterThanOrEqual(BASELINE_APP_KEY_COUNT);

    for (const locale of APP_I18N_ASSET_LOCALES) {
      const dictionary = readAsset(locale);
      const missing = referenceKeys.filter((key) => typeof dictionary[key] !== "string");
      const expectedMissing = (APP_I18N_BUILT_IN_LOCALES as readonly string[]).includes(locale)
        ? []
        : SHELL_ONLY_KEYS;

      // Anything an asset omits must be a documented shell-only key, never an accidental hole
      // that would surface as a raw translation key on screen.
      expect(missing.sort(), `${locale} omits unexpected keys`).toEqual(expectedMissing);
      expect(
        Object.values(dictionary).every((value) => typeof value === "string"),
        `${locale} has a non-string value`,
      ).toBe(true);

      // An asset key the reference locale does not publish can never be reached through the
      // fallback chain. Only the frozen legacy set is tolerated; anything new is a bug.
      const orphans = Object.keys(dictionary).filter((key) => reference[key] === undefined);
      const unexpectedOrphans = orphans.filter(
        (key) => !KNOWN_ORPHAN_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
      );
      expect(unexpectedOrphans, `${locale} introduced unreachable keys`).toEqual([]);
      expect(
        orphans.length,
        `${locale} orphan key count changed`,
      ).toBe(KNOWN_ORPHAN_LOCALES.includes(locale) ? KNOWN_ORPHAN_KEY_COUNT : 0);
    }
  });

  it("passes the shipped parser for every published asset", () => {
    for (const locale of APP_I18N_ASSET_LOCALES) {
      const parsed = parseAppI18nDictionary(
        readFileSync(path.join(ASSET_DIRECTORY, `${locale}.json`), "utf8"),
      );
      expect(parsed, `${locale} failed parseAppI18nDictionary`).not.toBeNull();
    }
  });

  it("rejects malformed dictionaries instead of registering partial data", () => {
    expect(parseAppI18nDictionary("")).toBeNull();
    expect(parseAppI18nDictionary("not json")).toBeNull();
    expect(parseAppI18nDictionary("[]")).toBeNull();
    expect(parseAppI18nDictionary("{}")).toBeNull();
    expect(parseAppI18nDictionary('{"a": 1}')).toBeNull();
    expect(parseAppI18nDictionary('{"a": "ok"}')).toEqual({ a: "ok" });
    // "" is a translation, not a hole: several locales render no unit suffix at all.
    expect(parseAppI18nDictionary('{"a": ""}')).toEqual({ a: "" });
  });

  it("stops an empty English string from falling through to the Korean fallback", () => {
    // en publishes "" for the age-gate unit suffixes; ko publishes 년/월/일. A truthiness-based
    // resolver skipped the empty English value and rendered Korean units to every other locale.
    expect(i18nDict.en["ageGate.yearSuffix"]).toBe("");
    expect(i18nDict.ko["ageGate.yearSuffix"]).toBe("년");
    expect(resolveI18nValue("en", "ageGate.yearSuffix")).toBe("");
    expect(resolveI18nValue("en-US", "ageGate.daySuffix")).toBe("");
    expect(resolveI18nValue("ko", "ageGate.yearSuffix")).toBe("년");
  });
});

describe("measured translation coverage", () => {
  it("reports the five locales that carry a real translation", () => {
    const fullyTranslated = APP_I18N_ASSET_LOCALES.filter((locale) =>
      APP_I18N_LOCALE_TRANSLATED_RATIO[locale] >= APP_I18N_TRANSLATED_LOCALE_THRESHOLD,
    );

    expect([...fullyTranslated].sort()).toEqual(["en", "ja", "ko", "zh", "zh-hant"]);
  });

  it("does not let a mostly-English locale claim to be translated", () => {
    // These render English for ~97% of the product surface. The picker must not present them
    // the same way it presents Japanese.
    for (const locale of ["af", "id", "pt", "sv", "es", "fr", "de"]) {
      expect(
        isFullyTranslatedAppLocale(locale),
        `${locale} must not be advertised as fully translated`,
      ).toBe(false);
      expect(getAppI18nTranslatedRatio(locale)).toBeLessThan(
        APP_I18N_TRANSLATED_LOCALE_THRESHOLD,
      );
    }
  });

  it("measures ratios from the assets rather than from a hand-maintained list", () => {
    const reference = readAsset(REFERENCE_LOCALE);
    for (const locale of ["af", "es", "ja"]) {
      expect(measureTranslatedRatio(readAsset(locale), reference)).toBe(
        APP_I18N_LOCALE_TRANSLATED_RATIO[locale],
      );
    }
  });

  it("carries coverage onto every language option, including region variants", () => {
    const options = getLanguageOptions("en");
    const byCode = new Map(options.map((option) => [option.code, option]));

    expect(byCode.get("ja")?.fullyTranslated).toBe(true);
    expect(byCode.get("af")?.fullyTranslated).toBe(false);
    // es-419 has no asset of its own; it inherits the Spanish asset's measured coverage.
    expect(byCode.get("es-419")?.translatedRatio).toBe(
      APP_I18N_LOCALE_TRANSLATED_RATIO.es,
    );
    // A Google Play locale with no dictionary at all is reported as 0, not as "probably fine".
    expect(byCode.get("cy")?.translatedRatio).toBe(0);
  });
});

describe("explicit fallback chain", () => {
  it("walks requested locale → en → ko", () => {
    expect(getAppI18nFallbackChain("af")).toEqual(["af", "en", "ko"]);
    expect(getAppI18nFallbackChain("zh-Hant-TW")).toEqual([
      "zh-hant-tw",
      "zh-hant",
      "zh",
      "en",
      "ko",
    ]);
  });

  it("narrows a requested locale to the asset that will actually serve it", () => {
    expect(resolveAppI18nAssetLocale("af")).toBe("af");
    expect(resolveAppI18nAssetLocale("es-419")).toBe("es");
    expect(resolveAppI18nAssetLocale("zh-Hant-TW")).toBe("zh-hant");
    // The fallback chain must not be mistaken for an asset — otherwise "no dictionary published"
    // becomes indistinguishable from "English dictionary published".
    expect(resolveAppI18nAssetLocale("eo")).toBeNull();
    expect(resolveAppI18nAssetLocale("cy")).toBeNull();
  });

  it("builds asset URLs under the published app namespace", () => {
    expect(appI18nAssetUrl("af", "/")).toBe("/i18n/app/nav/af.json");
    expect(appI18nAssetUrl("af", "/base")).toBe("/base/i18n/app/nav/af.json");
  });
});

describe("lazy locale loading", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("serves the built-in pair without touching the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));

    for (const locale of [...APP_I18N_BUILT_IN_LOCALES, "en-US", "ko-KR"]) {
      const status = await loadAppI18nLocale(locale);
      expect(status.state, `${locale} should resolve from the shell`).toBe("builtin");
    }

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads only the requested locale and registers it under the serving asset", async () => {
    const status = await loadAppI18nLocale("sv");

    expect(status.state).toBe("loaded");
    expect(status.served).toBe("sv");
    expect(status.chain).toEqual(["sv", "en", "ko"]);
    expect(resolveI18nValue("sv", "nav.home")).toBe("Hem");

    // Loading Swedish must not drag any other published app dictionary into memory. (Studio
    // route assets are registered separately by the Vitest setup, so probe an app-shell key.)
    expect(i18nDict.no?.["nav.home"]).toBeUndefined();
    expect(i18nDict.pt?.["nav.home"]).toBeUndefined();
  });

  it("reports an unpublished locale instead of silently rendering English", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));

    const status = await loadAppI18nLocale("cy");

    expect(status.state).toBe("unavailable");
    expect(status.served).toBeNull();
    expect(status.reason).toContain("cy");
    expect(status.chain).toEqual(["cy", "en", "ko"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The screen still works — through the chain that the status just made explicit.
    expect(resolveI18nValue("cy", "nav.home")).toBe(i18nDict.en["nav.home"]);
  });

  it("records a failed asset load and keeps rendering through the chain", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // An injected fetch bypasses the on-disk test source, so this exercises the real HTTP path.
    const status = await loadAppI18nLocale("da", {
      fetchImpl: (() => Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch,
      baseUrl: "/",
    });

    expect(status.state).toBe("failed");
    expect(status.served).toBe("da");
    expect(status.chain).toEqual(["da", "en", "ko"]);
    expect(status.reason).toContain("404");
    // A failed load is loud, not silent: it is both recorded and reported.
    expect(getAppI18nLocaleStatus("da")).toBe(status);
    expect(warnSpy).toHaveBeenCalled();
    // And the screen still renders — through the chain the status just made explicit.
    expect(resolveI18nValue("da", "nav.home")).toBe(i18nDict.en["nav.home"]);
  });
});
