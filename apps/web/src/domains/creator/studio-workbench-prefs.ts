/**
 * Studio Workbench Prefs — 컴패니언 창(어시스턴트 · AI 스위트)이 재방문 시 복원하는 선택 상태.
 *
 * studio-app-settings.ts 의 규범을 그대로 따른다: 버전 붙은 저장 키, default/normalize/load/save,
 * 절대 throw 하지 않는 total normalize, localStorage 부재를 견디는 접근자. React 는 여기 없다.
 *
 * 값은 평문 string/number 만 쓴다 — UI·엔진 모듈을 import 하지 않기 위해서다. 그래서 id 계열
 * 문자열은 "카탈로그 소속"까지는 검증하지 못하고 "쓸 수 있는 문자열"까지만 보장한다. 소비하는
 * 화면은 자기 카탈로그로 한 번 걸러 쓰라고 `pickStudioWorkbenchOption` 을 함께 제공한다.
 * (엔진 카탈로그를 여기서 복제하면 항목이 늘 때마다 조용히 낡는다.)
 */

export const STUDIO_WORKBENCH_PREFS_STORAGE_KEY = "toonspectrum-studio-workbench-prefs:v1";

export type StudioWorkbenchPrefsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type StudioWorkbenchAssistantPrefs = {
  /** 어시스턴트 모달의 마지막 탭 id. */
  activeTab: string;
  /** 플랫폼 스펙 검증 대상 id. */
  platformId: string;
  /** 스크롤 페이싱 시뮬레이터의 독자 속도 프로필 id. */
  readerSpeed: string;
  /** 컬러 하모니 피부톤 팔레트 id. */
  skinToneId: string;
  /** 집중 타이머가 겨냥한 제작 단계 id. */
  focusStage: string;
  /** 집중 타이머 뽀모도로 프리셋 id. */
  focusPreset: string;
  /** 크로키 타이머 간격(초). 허용 집합으로 스냅된다. */
  croquisIntervalSec: number;
};

export type StudioWorkbenchAiSuitePrefs = {
  /** AI 슈퍼 스위트의 마지막 탭 id. */
  activeTab: string;
  /** 웹툰 아트 스타일 필터 id. */
  styleId: string;
  /** 셰이딩 어시스트 광원 방향 프리셋 id. */
  lightDirection: string;
  /** 환경광 색온도 프리셋 id. */
  ambientLight: string;
  /** 프롬프트 보정에 얹는 장르 힌트(자유 입력, 비어 있을 수 있음). */
  genreHint: string;
};

export type StudioWorkbenchPrefs = {
  assistant: StudioWorkbenchAssistantPrefs;
  aiSuite: StudioWorkbenchAiSuitePrefs;
};

/**
 * 크로키 타이머가 허용하는 간격. 엔진의 `CroquisTimerIntervalSec`(30|60|180)과 같은 집합을
 * 의도적으로 여기 한 번 더 적는다 — 이 모듈은 엔진을 import 하지 않기 때문. 상수로 export 해서
 * 두 곳이 갈라지면 grep 으로 잡히게 둔다. (studio-app-settings 의 PIXEL_GRID_SIZES 와 같은 패턴.)
 */
export const STUDIO_WORKBENCH_CROQUIS_INTERVALS_SEC = [30, 60, 180] as const;

/** id 문자열: 트림 + 길이 상한. 문자열이 아니거나 비면 기본값. */
function asId(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().slice(0, 64);
  return trimmed === "" ? fallback : trimmed;
}

/** 자유 입력 텍스트: 빈 값도 정당한 상태라 그대로 통과시킨다. */
function asFreeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return value.trim().slice(0, 120);
}

/** 허용 숫자 집합 중 가장 가까운 값으로 스냅. 비유한/비숫자는 기본값. */
function snapToAllowed(value: unknown, allowed: readonly number[], fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  let best = allowed[0] ?? fallback;
  for (const candidate of allowed) {
    if (Math.abs(candidate - value) < Math.abs(best - value)) best = candidate;
  }
  return best;
}

/**
 * 저장된 id 를 화면 자신의 카탈로그로 거른다. 카탈로그에 없으면 fallback.
 * 저장 당시엔 유효했지만 이후 카탈로그에서 사라진 id 때문에 빈 패널이 뜨는 것을 막는다.
 */
export function pickStudioWorkbenchOption<T extends string>(
  stored: string,
  allowed: readonly T[],
  fallback: T
): T {
  return (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
}

export function defaultStudioWorkbenchPrefs(): StudioWorkbenchPrefs {
  return {
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
      // 장르 힌트는 "지정 안 함"이 기본이다 — 임의 장르를 프롬프트에 몰래 얹지 않는다.
      genreHint: "",
    },
  };
}

export function normalizeStudioWorkbenchPrefs(value?: unknown): StudioWorkbenchPrefs {
  const d = defaultStudioWorkbenchPrefs();
  if (!value || typeof value !== "object") return d;
  const record = value as Record<string, unknown>;

  const assistant = (
    record.assistant && typeof record.assistant === "object" ? record.assistant : {}
  ) as Record<string, unknown>;
  const aiSuite = (
    record.aiSuite && typeof record.aiSuite === "object" ? record.aiSuite : {}
  ) as Record<string, unknown>;

  return {
    assistant: {
      activeTab: asId(assistant.activeTab, d.assistant.activeTab),
      platformId: asId(assistant.platformId, d.assistant.platformId),
      readerSpeed: asId(assistant.readerSpeed, d.assistant.readerSpeed),
      skinToneId: asId(assistant.skinToneId, d.assistant.skinToneId),
      focusStage: asId(assistant.focusStage, d.assistant.focusStage),
      focusPreset: asId(assistant.focusPreset, d.assistant.focusPreset),
      croquisIntervalSec: snapToAllowed(
        assistant.croquisIntervalSec,
        STUDIO_WORKBENCH_CROQUIS_INTERVALS_SEC,
        d.assistant.croquisIntervalSec
      ),
    },
    aiSuite: {
      activeTab: asId(aiSuite.activeTab, d.aiSuite.activeTab),
      styleId: asId(aiSuite.styleId, d.aiSuite.styleId),
      lightDirection: asId(aiSuite.lightDirection, d.aiSuite.lightDirection),
      ambientLight: asId(aiSuite.ambientLight, d.aiSuite.ambientLight),
      genreHint: asFreeText(aiSuite.genreHint, d.aiSuite.genreHint),
    },
  };
}

export function loadStudioWorkbenchPrefs(
  storage: StudioWorkbenchPrefsStorage | null | undefined
): StudioWorkbenchPrefs {
  if (!storage) return defaultStudioWorkbenchPrefs();
  try {
    const raw = storage.getItem(STUDIO_WORKBENCH_PREFS_STORAGE_KEY);
    if (!raw) return defaultStudioWorkbenchPrefs();
    return normalizeStudioWorkbenchPrefs(JSON.parse(raw));
  } catch {
    return defaultStudioWorkbenchPrefs();
  }
}

export function saveStudioWorkbenchPrefs(
  storage: StudioWorkbenchPrefsStorage | null | undefined,
  prefs: StudioWorkbenchPrefs
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      STUDIO_WORKBENCH_PREFS_STORAGE_KEY,
      JSON.stringify(normalizeStudioWorkbenchPrefs(prefs))
    );
    return true;
  } catch {
    return false;
  }
}

export function studioWorkbenchPrefsStorage(): StudioWorkbenchPrefsStorage | null {
  try {
    return typeof globalThis.localStorage === "undefined" ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}
