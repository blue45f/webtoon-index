/**
 * Inspector disclosure memory — "접었던 섹션은 접힌 채로 다시 열린다".
 *
 * `StudioInspectorSection` was closed-by-default and **forgot every toggle on
 * unmount**. Because the inspector unmounts whole tabpanels as the artist moves
 * between 속성/레이어/페이지/게시, a section the artist had opened closed itself
 * again on the next visit — so the disclosure that bought the density win also
 * charged a re-open on every round trip. Clip Studio Paint's palettes remember
 * their expanded/collapsed state per palette for exactly this reason.
 *
 * ## Why a dedicated module and not `studio-pro-draw-prefs.ts`
 *
 * This is workspace chrome, not a drawing preference: it belongs with
 * `studio-inspector-layout.ts`, which owns the other "which part of the
 * inspector am I looking at" value and uses the same storage shape. The pure
 * helpers here are the testable surface; the browser singleton at the bottom is
 * the only part that touches `localStorage`, and it is deliberately tiny so the
 * section component stays a pure render.
 *
 * The eventual home is the V12 workspace payload (`studio-workspaces.ts`), the
 * same migration `STUDIO_INSPECTOR_LAYOUT_STORAGE_KEY` already went through.
 * Until that lands this key is self-contained and safe to drop.
 */

export const STUDIO_INSPECTOR_SECTION_STATE_STORAGE_KEY =
  "toonspectrum:studio:inspector-sections:v1";

/** `true` = 펼침. 표에 없는 id 는 호출부가 넘긴 기본값을 쓴다. */
export type StudioInspectorSectionState = Readonly<Record<string, boolean>>;

export interface StudioInspectorSectionStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EMPTY_STUDIO_INSPECTOR_SECTION_STATE: StudioInspectorSectionState =
  Object.freeze({});

/**
 * 기억하는 섹션 수 상한. 인스펙터가 선언한 Advanced 섹션은 20개 미만이고,
 * 이 값은 오타·구버전 id 가 무한히 쌓여 저장소를 잡아먹는 것만 막는다.
 */
export const STUDIO_INSPECTOR_SECTION_STATE_LIMIT = 64;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 알 수 없는 입력을 `Record<string, boolean>` 으로 좁힌다. boolean 이 아닌 값과
 * 빈 키는 버리고, 상한을 넘으면 정렬 순서대로 앞쪽만 남긴다(결정적 결과).
 */
export function normalizeStudioInspectorSectionState(
  value: unknown,
): StudioInspectorSectionState {
  if (!isPlainRecord(value)) return EMPTY_STUDIO_INSPECTOR_SECTION_STATE;

  const entries = Object.entries(value)
    .filter(
      (entry): entry is [string, boolean] =>
        entry[0].trim().length > 0 && typeof entry[1] === "boolean",
    )
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, STUDIO_INSPECTOR_SECTION_STATE_LIMIT);

  if (entries.length === 0) return EMPTY_STUDIO_INSPECTOR_SECTION_STATE;
  return Object.freeze(Object.fromEntries(entries));
}

export function loadStudioInspectorSectionState(
  storage: StudioInspectorSectionStateStorage | null | undefined,
): StudioInspectorSectionState {
  if (!storage) return EMPTY_STUDIO_INSPECTOR_SECTION_STATE;
  try {
    const raw = storage.getItem(STUDIO_INSPECTOR_SECTION_STATE_STORAGE_KEY);
    if (!raw) return EMPTY_STUDIO_INSPECTOR_SECTION_STATE;
    return normalizeStudioInspectorSectionState(JSON.parse(raw));
  } catch {
    return EMPTY_STUDIO_INSPECTOR_SECTION_STATE;
  }
}

export function saveStudioInspectorSectionState(
  storage: StudioInspectorSectionStateStorage | null | undefined,
  state: StudioInspectorSectionState,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      STUDIO_INSPECTOR_SECTION_STATE_STORAGE_KEY,
      JSON.stringify(normalizeStudioInspectorSectionState(state)),
    );
  } catch {
    // 저장소가 막혀도 접기/펼치기 자체는 이번 세션 동안 계속 동작해야 한다.
  }
}

/** 표에 기록이 없으면 호출부의 기본값(대개 닫힘)을 그대로 돌려준다. */
export function isStudioInspectorSectionOpen(
  state: StudioInspectorSectionState,
  sectionId: string,
  fallback: boolean,
): boolean {
  const remembered = state[sectionId];
  return typeof remembered === "boolean" ? remembered : fallback;
}

export function setStudioInspectorSectionOpen(
  state: StudioInspectorSectionState,
  sectionId: string,
  open: boolean,
): StudioInspectorSectionState {
  if (sectionId.trim().length === 0) return state;
  if (state[sectionId] === open) return state;
  return normalizeStudioInspectorSectionState({ ...state, [sectionId]: open });
}

/* ------------------------------------------------------- browser singleton */

let cachedState: StudioInspectorSectionState | null = null;

function browserSectionStateStorage(): StudioInspectorSectionStateStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    // Safari 프라이빗 모드 등에서 접근 자체가 던진다.
    return null;
  }
}

/**
 * 섹션 컴포넌트의 `useState` 지연 초기화용. 첫 호출에서 한 번만 파싱하고 그
 * 뒤로는 모듈 캐시를 읽으므로, 인스펙터가 여는 섹션 수만큼 JSON.parse 가
 * 반복되지 않는다.
 */
export function readStudioInspectorSectionOpen(
  sectionId: string,
  fallback: boolean,
): boolean {
  cachedState ??= loadStudioInspectorSectionState(browserSectionStateStorage());
  return isStudioInspectorSectionOpen(cachedState, sectionId, fallback);
}

/** 헤더 클릭(이벤트 핸들러)에서만 호출한다 — 렌더 중 호출은 규칙 위반이다. */
export function writeStudioInspectorSectionOpen(
  sectionId: string,
  open: boolean,
): void {
  const current =
    cachedState ??
    loadStudioInspectorSectionState(browserSectionStateStorage());
  const next = setStudioInspectorSectionOpen(current, sectionId, open);
  cachedState = next;
  if (next !== current) {
    saveStudioInspectorSectionState(browserSectionStateStorage(), next);
  }
}

/** 테스트 전용 — 모듈 캐시를 비워 다음 읽기가 저장소를 다시 보게 한다. */
export function resetStudioInspectorSectionStateCache(): void {
  cachedState = null;
}
