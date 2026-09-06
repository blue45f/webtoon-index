import {
  DICT,
  registerI18nLocaleEntries,
  FALLBACK_LANG,
  triggerTranslationBundleUpdate,
} from "./i18n-core";
import {
  normalizeLocaleCode,
  getLocaleCandidates,
  getLocaleCandidateChain,
} from "./i18n-intl-utils";
import { APP_I18N_NAMESPACES, STUDIO_I18N_NAMESPACES } from "./i18n-asset-manifest";
import {
  APP_I18N_ASSET_LOCALES,
  APP_I18N_BUILT_IN_LOCALES,
  APP_I18N_LOCALE_TRANSLATED_RATIO,
  APP_I18N_TRANSLATED_LOCALE_THRESHOLD,
} from "./i18n-locale-catalog";


import type { Dict } from "./i18n-core";

/* ------------------------------------------------------------------------ *
 * 앱 셸 로케일 자산 (public/i18n/app/<namespace>/<locale>.json)
 *
 * 계약:
 *  1. ko/en 은 번들에 컴파일된다 — 폴백 체인은 절대 I/O 를 기다리지 않는다.
 *  2. 그 외 로케일은 요청 시 1회 로드된다. 활성 로케일 하나만 받는다.
 *  3. 자산이 없거나(unavailable) 로드가 실패해도(failed) 화면은 en → ko 로 계속 동작하되,
 *     그 사실은 getAppI18nLocaleStatus()로 항상 조회 가능하고 failed 는 콘솔에도 남는다.
 * ------------------------------------------------------------------------ */

const APP_I18N_ASSET_LOCALE_SET: ReadonlySet<string> = new Set(
  APP_I18N_ASSET_LOCALES,
);
const APP_I18N_BUILT_IN_LOCALE_SET: ReadonlySet<string> = new Set(
  APP_I18N_BUILT_IN_LOCALES,
);
const APP_I18N_MAX_ASSET_CHARACTERS = 512_000;
const APP_I18N_MAX_ENTRY_COUNT = 2_000;
const APP_I18N_MAX_VALUE_CHARACTERS = 4_000;

export type AppI18nLocaleState =
  /** 앱 셸에 컴파일된 사전이 직접 처리한다(ko/en). */
  | "builtin"
  /** 지연 자산을 받아 DICT 에 등록했다. */
  | "loaded"
  /** 이 로케일용으로 배포된 자산 자체가 없다 — 설계상 en → ko 폴백. */
  | "unavailable"
  /** 자산은 있는데 받지 못했다 — 폴백은 되지만 회귀 신호다. */
  | "failed";

export interface AppI18nLocaleStatus {
  /** 정규화된 요청 로케일. */
  readonly requested: string;
  /** 실제로 문자열을 공급하는 자산 로케일. 없으면 null. */
  readonly served: string | null;
  readonly state: AppI18nLocaleState;
  /** resolveTranslation 이 이 로케일에 대해 실제로 훑는 순서. */
  readonly chain: readonly string[];
  /** unavailable/failed 사유(사람이 읽는 문장). */
  readonly reason?: string;
}

export interface AppI18nLoadOptions {
  readonly fetchImpl?: typeof fetch;
  readonly baseUrl?: string;
}

/**
 * 자산 본문을 공급하는 대체 경로. 브라우저에서는 항상 null 이며, HTTP 서버가 없는
 * 테스트 그래프가 같은 자산을 디스크에서 읽도록 열어 둔 유일한 이음새다.
 */
export type AppI18nAssetSource = (
  assetLocale: string,
) => Promise<string | null>;

let appI18nAssetSource: AppI18nAssetSource | null = null;

export function setAppI18nAssetSource(source: AppI18nAssetSource | null): void {
  appI18nAssetSource = source;
}

const appLocaleStatuses = new Map<string, AppI18nLocaleStatus>();
const appLocaleLoads = new Map<string, Promise<AppI18nLocaleStatus>>();
const reportedAppLocaleFailures = new Set<string>();

function appI18nBaseUrl(): string {
  const configured =
    typeof window !== "undefined"
      ? (window as unknown as Record<string, string | undefined>)
          .__VITE_BASE_URL__
      : undefined;
  const baseUrl = configured || "/";
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function appI18nAssetUrl(
  assetLocale: string,
  baseUrl?: string,
  namespace = "nav",
): string {
  const normalizedBase = baseUrl
    ? baseUrl.endsWith("/")
      ? baseUrl
      : `${baseUrl}/`
    : appI18nBaseUrl();
  return `${normalizedBase}i18n/app/${namespace}/${assetLocale}.json`;
}

/**
 * 요청 로케일을 실제 배포 자산으로 좁힌다. 폴백 체인(en → ko)은 **의도적으로 제외한다** —
 * 여기에 en 을 섞으면 모든 로케일이 "자산 있음"으로 보여, 자산이 없다는 사실 자체가 사라진다.
 */
export function resolveAppI18nAssetLocale(locale: string): string | null {
  for (const candidate of getLocaleCandidateChain(locale, [])) {
    if (APP_I18N_ASSET_LOCALE_SET.has(candidate)) return candidate;
  }
  return null;
}

/** resolveTranslation 이 이 로케일에 대해 훑는 후보 순서 — 폴백이 암묵적이지 않다는 증거. */
export function getAppI18nFallbackChain(locale: string): readonly string[] {
  return getLocaleCandidates(locale);
}

/** 이 로케일 자산의 실측 번역률(0~1). 자산이 없으면 0. */
export function getAppI18nTranslatedRatio(locale: string): number {
  const assetLocale = resolveAppI18nAssetLocale(locale);
  if (!assetLocale) return 0;
  return APP_I18N_LOCALE_TRANSLATED_RATIO[assetLocale] ?? 0;
}

/**
 * 이 로케일을 "번역된 언어"로 제시해도 되는지. false 면 사용자는 사실상 영어를 보게 된다.
 */
export function isFullyTranslatedAppLocale(locale: string): boolean {
  return (
    getAppI18nTranslatedRatio(locale) >= APP_I18N_TRANSLATED_LOCALE_THRESHOLD
  );
}

export function parseAppI18nDictionary(source: string): Dict | null {
  if (source.length === 0 || source.length > APP_I18N_MAX_ASSET_CHARACTERS)
    return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return null;

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > APP_I18N_MAX_ENTRY_COUNT)
    return null;

  const dictionary: Dict = {};
  for (const [key, value] of entries) {
    // An empty string is a legitimate translation: several locales render no unit suffix at all
    // (`ageGate.yearSuffix`), which is exactly why resolveTranslation treats "present" — not
    // "truthy" — as an answer.
    if (
      key.length === 0 ||
      typeof value !== "string" ||
      value.length > APP_I18N_MAX_VALUE_CHARACTERS
    ) {
      return null;
    }
    dictionary[key] = value;
  }
  return dictionary;
}

function recordAppLocaleStatus(
  status: AppI18nLocaleStatus,
): AppI18nLocaleStatus {
  appLocaleStatuses.set(status.requested, status);
  if (
    status.state === "failed" &&
    !reportedAppLocaleFailures.has(status.requested)
  ) {
    reportedAppLocaleFailures.add(status.requested);
    // 폴백은 동작하지만 배포된 번역이 사라진 상태다. 조용히 영어로 렌더하고 끝내지 않는다.
    console.warn(
      `[i18n] locale asset "${status.served}" failed to load; falling back through ${status.chain.join(" → ")}.`,
      status.reason,
    );
  }
  return status;
}

/** 이 로케일이 어떤 자산으로 해소됐는지 — 로드 전이면 undefined. */
export function getAppI18nLocaleStatus(
  locale: string,
): AppI18nLocaleStatus | undefined {
  return appLocaleStatuses.get(normalizeLocaleCode(locale));
}

/** 로드가 시도된 모든 로케일의 상태(진단·테스트용). */
export function getAppI18nLocaleStatuses(): readonly AppI18nLocaleStatus[] {
  return [...appLocaleStatuses.values()];
}

/**
 * 지연 등록된 앱 사전을 DICT 에 병합하고 상태를 "loaded"로 고정한다. 프로덕션 로더와,
 * HTTP 서버가 없는 테스트 그래프가 공유하는 단일 등록 경로다.
 */
export function registerAppI18nLocaleDictionary(
  assetLocale: string,
  dictionary: Readonly<Record<string, string>>,
  requestedLocale = assetLocale,
): AppI18nLocaleStatus {
  const normalizedAsset = normalizeLocaleCode(assetLocale);
  const normalizedRequested =
    normalizeLocaleCode(requestedLocale) || normalizedAsset;

  registerI18nLocaleEntries(normalizedAsset, dictionary);
  if (normalizedRequested !== normalizedAsset) {
    registerI18nLocaleEntries(normalizedRequested, dictionary);
  }

  return recordAppLocaleStatus({
    requested: normalizedRequested,
    served: normalizedAsset,
    state: "loaded",
    chain: getAppI18nFallbackChain(normalizedRequested),
  });
}

export async function loadAppI18nLocale(
  locale: string,
  options: AppI18nLoadOptions = {},
): Promise<AppI18nLocaleStatus> {
  const normalized = normalizeLocaleCode(locale) || FALLBACK_LANG;
  const chain = getAppI18nFallbackChain(normalized);
  const assetLocale = resolveAppI18nAssetLocale(normalized);

  if (!assetLocale) {
    return recordAppLocaleStatus({
      requested: normalized,
      served: null,
      state: "unavailable",
      chain,
      reason: `No app dictionary is published for "${normalized}"; it renders through the fallback chain.`,
    });
  }

  if (APP_I18N_BUILT_IN_LOCALE_SET.has(assetLocale)) {
    return recordAppLocaleStatus({
      requested: normalized,
      served: assetLocale,
      state: "builtin",
      chain,
    });
  }

  const existingStatus = appLocaleStatuses.get(normalized);
  if (existingStatus?.state === "loaded") return existingStatus;

  const inFlight = appLocaleLoads.get(normalized);
  if (inFlight) return inFlight;

  // An explicitly injected fetch always wins over the ambient asset source, so a caller can
  // exercise the real HTTP path (including its failure modes) even where a source is installed.
  const fetchImpl = options.fetchImpl;
  const job = (async (): Promise<AppI18nLocaleStatus> => {
    try {
      let source: string | null = null;

      if (!fetchImpl && appI18nAssetSource) {
        source = await appI18nAssetSource(assetLocale);
      }
      if (source === null) {
        const resolvedFetch = fetchImpl ?? globalThis.fetch;
        if (typeof resolvedFetch !== "function") {
          throw new Error("The Fetch API is unavailable in this runtime.");
        }
        const merged: Record<string, string> = {};
        for (const namespace of APP_I18N_NAMESPACES) {
          const url = appI18nAssetUrl(assetLocale, options.baseUrl, namespace);
          const response = await resolvedFetch(url, {
            cache: "force-cache",
            credentials: "same-origin",
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${url}`);
          }
          const part = parseAppI18nDictionary(await response.text());
          if (!part) throw new Error(`Malformed app dictionary asset for "${assetLocale}/${namespace}".`);
          Object.assign(merged, part);
        }
        source = JSON.stringify(merged);
      }

      const dictionary = parseAppI18nDictionary(source);
      if (!dictionary) {
        throw new Error(`Malformed app dictionary asset for "${assetLocale}".`);
      }

      const status = registerAppI18nLocaleDictionary(
        assetLocale,
        dictionary,
        normalized,
      );
      triggerTranslationBundleUpdate();
      // ({

      return status;
    } catch (cause) {
      return recordAppLocaleStatus({
        requested: normalized,
        served: assetLocale,
        state: "failed",
        chain,
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    } finally {
      appLocaleLoads.delete(normalized);
    }
  })();

  appLocaleLoads.set(normalized, job);
  return job;
}

const studioAssetLoadStatus = new Map<string, Promise<void>>();

export async function loadStudioAssetIfAvailable(
  locale: string,
): Promise<void> {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized) return;
  const candidates = getLocaleCandidateChain(normalized, [FALLBACK_LANG]);
  for (const candidate of candidates) {
    if (
      DICT[candidate] &&
      Object.keys(DICT[candidate]).some((k) => k.startsWith("studio."))
    ) {
      return;
    }
  }
  const assetLocale =
    candidates.find(
      (c) =>
        DICT[c] ||
        c === "ko" ||
        c === "en" ||
        c === "ja" ||
        c === "zh" ||
        !c.includes("-"),
    ) ||
    candidates[0].split("-")[0] ||
    "en";

  const existingJob = studioAssetLoadStatus.get(assetLocale);
  if (existingJob) return existingJob;

  const job = (async () => {
    try {
      if (typeof fetch !== "function") return;
      const baseUrl =
        typeof window !== "undefined" &&
        (window as unknown as Record<string, string>).__VITE_BASE_URL__
          ? (window as unknown as Record<string, string>).__VITE_BASE_URL__
          : "/";
      const normBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
      const merged: Record<string, string> = {};
      for (const namespace of STUDIO_I18N_NAMESPACES) {
        const response = await fetch(
          `${normBaseUrl}i18n/studio/${namespace}/${assetLocale}.json`,
          { cache: "force-cache", credentials: "same-origin" },
        );
        if (!response.ok) continue;
        const data = await response.json();
        if (data && typeof data === "object" && !Array.isArray(data)) Object.assign(merged, data);
      }
      if (Object.keys(merged).length > 0) {
        registerI18nLocaleEntries(assetLocale, merged);
        if (assetLocale !== normalized) registerI18nLocaleEntries(normalized, merged);
        triggerTranslationBundleUpdate();
      }
    } catch {
      // Ignore if fetch not available or file not found
    }
  })();

  studioAssetLoadStatus.set(assetLocale, job);
  studioAssetLoadStatus.set(normalized, job);
  return job;
}
