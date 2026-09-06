import {
  getAppI18nTranslatedRatio,
  isFullyTranslatedAppLocale,
} from "./i18n-asset-loader";
import { FALLBACK_LANG, FALLBACK_CHAIN } from "./i18n-core";
import {
  NORMALIZED_LOCALE_OPTIONS,
  normalizeLocaleCode,
} from "./i18n-locale-list";

import type { LanguageLocaleOption } from "./i18n-core";

export { normalizeLocaleCode };

const DEFAULT_COLLATOR_LOCALE = "en";

const displayNameCache = new Map<string, Intl.DisplayNames>();
const collatorCache = new Map<string, Intl.Collator>();

export function getLocaleCandidateChain(
  raw: string,
  fallbackChain: readonly string[],
): string[] {
  const normalized = normalizeLocaleCode(raw);
  const candidates = new Set<string>();

  if (!normalized) {
    for (const fallback of fallbackChain) {
      candidates.add(fallback);
    }
    return [...candidates];
  }

  const parts = normalized.split("-");
  for (let i = parts.length; i >= 1; i--) {
    const candidate = parts.slice(0, i).join("-");
    candidates.add(candidate);
  }

  for (const fallback of fallbackChain) {
    candidates.add(fallback);
  }

  return [...candidates];
}

export function getLocaleCandidates(
  raw: string,
  fallbackChain: readonly string[] = FALLBACK_CHAIN,
): string[] {
  return getLocaleCandidateChain(raw, fallbackChain);
}

export function getSupportedIntlLocale(raw: string, fallback: string): string {
  const candidates = getLocaleCandidateChain(raw, [fallback]);
  for (const candidate of candidates) {
    if (Intl.Collator.supportedLocalesOf([candidate]).length > 0)
      return candidate;
  }
  return fallback;
}

export function getDisplayNamesFormatter(locale: string): Intl.DisplayNames {
  const key = normalizeLocaleCode(locale) || FALLBACK_LANG;
  const cached = displayNameCache.get(key);
  if (cached) return cached;

  let formatter: Intl.DisplayNames | undefined;
  const candidates = getLocaleCandidateChain(key, [DEFAULT_COLLATOR_LOCALE]);
  for (const candidate of candidates) {
    try {
      if (Intl.Collator.supportedLocalesOf([candidate]).length === 0) continue;
      formatter = new Intl.DisplayNames([candidate], { type: "language" });
      break;
    } catch {
      // 해당 locale 포맷터 미지원이면 다음 후보 사용
    }
  }
  if (!formatter) {
    formatter = new Intl.DisplayNames(["en"], { type: "language" });
  }
  displayNameCache.set(key, formatter);
  return formatter;
}

export function getCollator(locale: string): Intl.Collator {
  const key = locale || FALLBACK_LANG;
  const cached = collatorCache.get(key);
  if (cached) return cached;

  const localeForCollator = getSupportedIntlLocale(
    key,
    DEFAULT_COLLATOR_LOCALE,
  );
  const collator = new Intl.Collator(localeForCollator, {
    sensitivity: "base",
  });
  collatorCache.set(key, collator);
  return collator;
}

export function detectBrowserLocale(): string {
  // Node 24+ exposes navigator.language even during SSR. A navigator-only guard therefore makes
  // server markup depend on the host machine's locale and can disagree with the browser during
  // hydration. Only consult the browser locale when an actual Window is present.
  if (typeof window === "undefined" || typeof navigator === "undefined")
    return FALLBACK_LANG;
  return resolveSelectableLocale(navigator.language);
}

/**
 * Maps a browser/persisted locale to a value that the application's language
 * controls can actually select. Browsers commonly report region variants such
 * as `ko-KR` even when the published locale catalog intentionally exposes the
 * language root (`ko`) only. Keeping the unmatched variant in a controlled
 * `<select>` makes the browser visually fall back to its first option while the
 * page continues rendering another language.
 */
export function resolveSelectableLocale(raw?: string | null): string {
  const supported = new Set(NORMALIZED_LOCALE_OPTIONS);
  const match = getLocaleCandidateChain(raw ?? "", []).find((candidate) =>
    supported.has(candidate)
  );
  return match ?? FALLBACK_LANG;
}

export function getLanguageDisplayName(
  locale?: string,
  inLocale?: string,
): string {
  if (!locale) return "";
  const formatter = getDisplayNamesFormatter(inLocale || FALLBACK_LANG);
  try {
    const direct = formatter.of(locale);
    if (direct) return direct;
  } catch {}
  if (locale.includes("-")) {
    try {
      const base = formatter.of(locale.split("-")[0]!);
      if (base) return base;
    } catch {}
  }
  return locale;
}

export function getLanguageOptions(
  displayLocale?: string,
): LanguageLocaleOption[] {
  const inLocale = normalizeLocaleCode(displayLocale || FALLBACK_LANG);
  const collator = getCollator(inLocale);
  return NORMALIZED_LOCALE_OPTIONS.map((code: string): LanguageLocaleOption => {
    const nativeLabel = getLanguageDisplayName(code, code);
    const englishLabel = getLanguageDisplayName(code, "en");
    const label =
      nativeLabel === englishLabel || !englishLabel
        ? nativeLabel
        : `${nativeLabel} / ${englishLabel}`;
    return {
      code,
      label,
      nativeLabel,
      englishLabel,
      translatedRatio: getAppI18nTranslatedRatio(code),
      fullyTranslated: isFullyTranslatedAppLocale(code),
    };
  }).sort((left: LanguageLocaleOption, right: LanguageLocaleOption) => collator.compare(left.label, right.label));
}

export function getLanguageOptionLookup(
  locale: string,
): Record<string, string> {
  const normalized = normalizeLocaleCode(locale);
  return {
    native:
      getLanguageDisplayName(normalized, normalized || FALLBACK_LANG) ||
      normalized,
    english: getLanguageDisplayName(normalized, "en"),
  };
}
