import {
  resolveAppI18nAssetLocale,
  loadAppI18nLocale, loadStudioAssetIfAvailable 
} from "./i18n-asset-loader";
import {
  DICT,
  FALLBACK_LANG,
  triggerTranslationBundleUpdate,
} from "./i18n-core";
import { normalizeLocaleCode } from "./i18n-intl-utils";

import type { Dict } from "./i18n-core";

const RUNTIME_TRANSLATION_SOURCE = "en";
const RUNTIME_TRANSLATION_CACHE_VERSION = 1;
const I18N_TRANSLATION_ENDPOINT = "https://api.mymemory.translated.net/get";
const I18N_TRANSLATION_TARGET_LOCALE_FALLBACK = "en";
const I18N_TRANSLATION_CONCURRENCY = 4;
const RUNTIME_TRANSLATION_TIMEOUT_MS = 8000;
const RUNTIME_TRANSLATION_CACHE_TTL_MS = 1000 * 60 * 60 * 24;
const RUNTIME_TRANSLATION_STORAGE_PREFIX = "toonspectrum-i18n-runtime";

const runtimeTranslationBundles = new Map<string, Dict>();
const runtimeTranslationLoads = new Map<string, Promise<void>>();

type RuntimeTranslationCachePayload = {
  v: number;
  locale: string;
  updatedAt: number;
  dict: Dict;
};

function normalizeTranslatorLocale(raw: string): string {
  const normalized = normalizeLocaleCode(raw);
  if (!normalized) return I18N_TRANSLATION_TARGET_LOCALE_FALLBACK;

  const parts = normalized.split("-");
  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^\d{3}$/.test(part)) return part;
      if (part.length === 4)
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
      return part.toUpperCase();
    })
    .join("-");
}

function getTranslatorLocaleCandidates(locale: string): string[] {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized) return [I18N_TRANSLATION_TARGET_LOCALE_FALLBACK];

  const parts = normalized.split("-");
  const candidates = new Set<string>();

  if (parts.length > 0) {
    candidates.add(normalizeTranslatorLocale(parts.join("-")));
  }

  if (parts.length >= 2) {
    candidates.add(normalizeTranslatorLocale(parts[0]));
  }

  if (parts.length >= 3) {
    candidates.add(normalizeTranslatorLocale(`${parts[0]}-${parts[1]}`));
    candidates.add(
      normalizeTranslatorLocale(`${parts[0]}-${parts[parts.length - 1]}`),
    );
  }

  // 항상 en을 최후의 폴백으로 남겨두고, 정합성/중복을 정리.
  candidates.add(I18N_TRANSLATION_TARGET_LOCALE_FALLBACK);

  return [...candidates];
}

function shouldTranslateLocale(locale: string): boolean {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized) return false;
  if (normalized === FALLBACK_LANG) return false;
  if (normalized === RUNTIME_TRANSLATION_SOURCE) return false;
  // 사전이 지연 자산으로 바뀐 뒤 DICT 존재 여부만 보면, 아직 로드되지 않은 배포 로케일이
  // "번역 없음"으로 오판돼 525개 키에 대한 외부 기계번역 호출이 터진다. 판단 기준은
  // 언제나 "배포된 자산이 있는가"여야 한다.
  if (resolveAppI18nAssetLocale(normalized)) return false;
  if (DICT[normalized]) return false;

  const root = normalized.split("-")[0];
  if (DICT[root]) return false;

  return true;
}

function parseMymemoryResponse(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const typed = data as {
    responseData?: {
      translatedText?: unknown;
    };
    responseStatus?: number | string;
  };

  if (typeof typed.responseData?.translatedText !== "string") return null;
  if (typed.responseStatus !== undefined) {
    const status =
      typeof typed.responseStatus === "string"
        ? Number.parseInt(typed.responseStatus, 10)
        : typed.responseStatus;
    if (status !== 200) return null;
  }
  return typed.responseData.translatedText.trim() || null;
}

function getRuntimeTranslationStorageKey(locale: string): string {
  return `${RUNTIME_TRANSLATION_STORAGE_PREFIX}:v${RUNTIME_TRANSLATION_CACHE_VERSION}:${locale}`;
}

function clearInvalidRuntimeTranslationCache(locale: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(getRuntimeTranslationStorageKey(locale));
}

function readCachedRuntimeTranslation(locale: string): Dict | null {
  if (typeof localStorage === "undefined") return null;
  const key = getRuntimeTranslationStorageKey(locale);
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RuntimeTranslationCachePayload;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      parsed.v !== RUNTIME_TRANSLATION_CACHE_VERSION ||
      parsed.locale !== locale ||
      typeof parsed.updatedAt !== "number" ||
      Date.now() - parsed.updatedAt > RUNTIME_TRANSLATION_CACHE_TTL_MS ||
      typeof parsed.dict !== "object" ||
      parsed.dict === null
    ) {
      clearInvalidRuntimeTranslationCache(locale);
      return null;
    }

    return parsed.dict;
  } catch {
    clearInvalidRuntimeTranslationCache(locale);
    return null;
  }
}

function writeRuntimeTranslationCache(locale: string, dict: Dict): void {
  if (typeof localStorage === "undefined") return;
  const key = getRuntimeTranslationStorageKey(locale);
  const payload: RuntimeTranslationCachePayload = {
    v: RUNTIME_TRANSLATION_CACHE_VERSION,
    locale,
    updatedAt: Date.now(),
    dict,
  };

  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // localStorage 용량 초과/차단 시 폴백으로 캐시만 스킵.
  }
}

async function translateViaMymemory(
  source: string,
  targetLocale: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    RUNTIME_TRANSLATION_TIMEOUT_MS,
  );

  try {
    const url = `${I18N_TRANSLATION_ENDPOINT}?${new URLSearchParams({
      q: source,
      langpair: `${RUNTIME_TRANSLATION_SOURCE}|${normalizeTranslatorLocale(targetLocale)}`,
    }).toString()}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;

    const payload = await response.json();
    return parseMymemoryResponse(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function translateViaMymemoryWithFallback(
  source: string,
  targetLocale: string,
): Promise<string | null> {
  for (const candidate of getTranslatorLocaleCandidates(targetLocale)) {
    const translated = await translateViaMymemory(source, candidate);
    if (translated) return translated;
  }

  return null;
}

export function getRuntimeTranslationBundle(locale: string): Dict | undefined {
  return runtimeTranslationBundles.get(normalizeLocaleCode(locale));
}

export async function loadRuntimeTranslationBundle(locale: string): Promise<void> {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized) return;

  // 활성 로케일 하나만 받는다. ko/en 은 셸에 있으므로 즉시 반환하고, 그 외에는
  // public/i18n/app/<namespace>/<locale>.json 1건만 요청한다.
  await loadAppI18nLocale(normalized);
  void loadStudioAssetIfAvailable(normalized);

  if (!shouldTranslateLocale(normalized)) return;

  const existing = getRuntimeTranslationBundle(normalized);
  if (existing) return;

  const cached = readCachedRuntimeTranslation(normalized);
  if (cached) {
    runtimeTranslationBundles.set(normalized, cached);
    triggerTranslationBundleUpdate();
    // ({

    return;
  }

  const existingLoad = runtimeTranslationLoads.get(normalized);
  if (existingLoad) {
    await existingLoad;
    return;
  }

  const allKeys = Object.keys(DICT[RUNTIME_TRANSLATION_SOURCE]);
  const bundle: Dict = {};

  const loadJob = (async () => {
    for (
      let index = 0;
      index < allKeys.length;
      index += I18N_TRANSLATION_CONCURRENCY
    ) {
      const chunkKeys = allKeys.slice(
        index,
        index + I18N_TRANSLATION_CONCURRENCY,
      );
      const translated = await Promise.all(
        chunkKeys.map(async (key) => {
          const source = DICT[RUNTIME_TRANSLATION_SOURCE][key];
          if (!source) return null;
          const translatedText = await translateViaMymemoryWithFallback(
            source,
            normalized,
          );
          if (!translatedText) return null;
          return [key, translatedText] as const;
        }),
      );

      for (const entry of translated) {
        if (!entry) continue;
        const [key, value] = entry;
        bundle[key] = value;
      }
    }

    runtimeTranslationBundles.set(normalized, bundle);
    writeRuntimeTranslationCache(normalized, bundle);
    if (Object.keys(bundle).length > 0) {
      triggerTranslationBundleUpdate();
      // ({
    }
  })();

  runtimeTranslationLoads.set(normalized, loadJob);
  await loadJob;
  runtimeTranslationLoads.delete(normalized);
}

export async function ensureRuntimeLocaleBundle(locale: string): Promise<void> {
  await loadRuntimeTranslationBundle(locale);
}
