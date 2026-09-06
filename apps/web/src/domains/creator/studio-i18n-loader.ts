import { STUDIO_I18N_NAMESPACES } from "@/shared/lib/i18n-asset-manifest";
import { registerI18nLocaleEntries, getLocaleCandidates } from "@/shared/lib/i18n";

export const STUDIO_I18N_ASSET_LOCALES = [
  "af",
  "am",
  "ar",
  "as",
  "az",
  "be",
  "bg",
  "bn",
  "bs",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "en",
  "es",
  "et",
  "eu",
  "fa",
  "fi",
  "fil",
  "fr",
  "gl",
  "gu",
  "he",
  "hi",
  "hr",
  "hu",
  "hy",
  "id",
  "is",
  "it",
  "ja",
  "ka",
  "kk",
  "km",
  "kn",
  "ko",
  "ky",
  "lo",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "my",
  "ne",
  "nl",
  "no",
  "or",
  "pa",
  "pl",
  "pt",
  "ro",
  "ru",
  "si",
  "sk",
  "sl",
  "sq",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "ur",
  "uz",
  "vi",
  "zh",
  "zh-hant",
  "zu",
] as const;
export const STUDIO_I18N_MAX_ASSET_CHARACTERS = 512_000;
export const STUDIO_I18N_MAX_ENTRY_COUNT = 2_000;
export const STUDIO_I18N_MAX_VALUE_CHARACTERS = 4_000;

export type StudioI18nAssetLocale =
  (typeof STUDIO_I18N_ASSET_LOCALES)[number];

export type StudioI18nDictionary = Readonly<Record<string, string>>;

export interface StudioI18nLoaderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

const pendingLoads = new Map<string, Promise<void>>();

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function studioI18nAssetUrl(
  locale: string,
  baseUrl = import.meta.env.BASE_URL,
  namespace = "mainMenu",
): string {
  return `${normalizedBaseUrl(baseUrl)}i18n/studio/${namespace}/${locale}.json`;
}

export function parseStudioI18nDictionary(
  source: string,
): StudioI18nDictionary | null {
  if (source.length === 0 || source.length > STUDIO_I18N_MAX_ASSET_CHARACTERS) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
  ) {
    return null;
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > STUDIO_I18N_MAX_ENTRY_COUNT) {
    return null;
  }
  const dictionary: Record<string, string> = Object.create(null);
  for (const [key, value] of entries) {
    if (
      !key.startsWith("studio.")
      || typeof value !== "string"
      || value.length === 0
      || value.length > STUDIO_I18N_MAX_VALUE_CHARACTERS
    ) {
      return null;
    }
    dictionary[key] = value;
  }
  return Object.freeze(dictionary);
}

export async function loadStudioI18nLocale(
  locale: string,
  options: StudioI18nLoaderOptions = {},
): Promise<void> {
  const candidates = getLocaleCandidates(locale);
  const targetAssetLocale = candidates.find((c) =>
    (STUDIO_I18N_ASSET_LOCALES as readonly string[]).includes(c)
  );

  const assetLocale = targetAssetLocale || "en";
  const existing = pendingLoads.get(assetLocale);
  if (existing) return existing;

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("Studio translation assets require the Fetch API.");
  }
  const job = (async () => {
    const merged: Record<string, string> = {};
    for (const namespace of STUDIO_I18N_NAMESPACES) {
      const response = await fetchImpl(
        studioI18nAssetUrl(assetLocale, options.baseUrl, namespace),
        { cache: "force-cache", credentials: "same-origin" },
      );
      if (!response.ok) {
        throw new Error(
          `Studio translation asset failed to load (${assetLocale}/${namespace}, ${response.status}).`,
        );
      }
      const dictionary = parseStudioI18nDictionary(await response.text());
      if (!dictionary) {
        throw new Error(`Studio translation asset is invalid (${assetLocale}/${namespace}).`);
      }
      Object.assign(merged, dictionary);
    }
    registerI18nLocaleEntries(assetLocale, merged);
    if (locale !== assetLocale) {
      registerI18nLocaleEntries(locale, merged);
    }
  })();

  pendingLoads.set(assetLocale, job);
  try {
    await job;
  } catch (error) {
    pendingLoads.delete(assetLocale);
    throw error;
  }
}

export const STUDIO_I18N_PRELOAD_LOCALES = ["ko", "en"] as const;

/**
 * Preloads primary Studio asset locales ("ko", "en") before Studio route commits.
 */
export async function loadStudioI18nDictionaries(
  options: StudioI18nLoaderOptions = {},
): Promise<void> {
  await Promise.all(
    STUDIO_I18N_PRELOAD_LOCALES.map((locale) =>
      loadStudioI18nLocale(locale, options)
    ),
  );
}
