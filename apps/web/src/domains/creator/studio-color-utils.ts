// 색상 입력/최근 색 저장 유틸. 팔레트 데이터와 분리해 /studio 첫 청크가 큐레이션 팔레트를 당겨오지 않게 한다.

// #rgb / #rrggbb (대소문자 허용)만 유효한 헥스 색으로 인정한다.
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** #rgb 또는 #rrggbb 형식인지 검사(대소문자 허용). */
export function isValidHexColor(v: string): boolean {
  return typeof v === "string" && HEX_COLOR_RE.test(v);
}

/**
 * 헥스 색 정규화 — #RGB는 #rrggbb로 확장하고 전체를 소문자로 맞춘다.
 * 유효하지 않은 입력은 null.
 */
export function normalizeHexColor(v: string): string | null {
  if (!isValidHexColor(v)) return null;
  const body = v.slice(1).toLowerCase();
  if (body.length === 3) {
    const [r, g, b] = body;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return `#${body}`;
}

/**
 * 최근 사용 색 목록에 색을 추가한 "새 배열"을 반환(입력 배열은 변형하지 않음).
 * - 정규화 후 유효하지 않으면 원본 list를 그대로 반환(같은 참조 OK).
 * - 같은 색(정규화 기준)이 이미 있으면 맨 앞으로 끌어올린다.
 * - max(기본 12) 초과분은 뒤에서 잘라낸다.
 */
export function pushRecentColor(list: string[], color: string, max = 12): string[] {
  const normalized = normalizeHexColor(color);
  if (normalized === null) return list;
  const safeMax = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 12;
  const rest = list.filter((item) => normalizeHexColor(item) !== normalized);
  return [normalized, ...rest].slice(0, safeMax);
}

// 최근 사용 색 localStorage 키.
export const RECENT_COLORS_KEY = "toonspectrum-studio-recent-colors";

/** Normalizes untrusted persisted data to the bounded recent-color list. */
export function normalizeRecentColors(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const color = normalizeHexColor(item);
    if (color === null || normalized.includes(color)) continue;
    normalized.push(color);
    if (normalized.length >= Math.max(0, Math.floor(max))) break;
  }
  return normalized;
}

/**
 * 저장소에서 최근 사용 색 목록을 읽는다.
 * JSON 배열을 파싱해 유효한 헥스 색만 남기고, 파싱 실패·예외(getItem throw 포함) 시 [].
 */
export function readRecentColors(storage: Pick<Storage, "getItem">): string[] {
  try {
    const raw = storage.getItem(RECENT_COLORS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return normalizeRecentColors(parsed);
  } catch {
    return [];
  }
}

/** 최근 사용 색 목록을 JSON으로 저장한다. 실패(쿼터 초과 등)는 조용히 무시. */
export function storeRecentColors(storage: Pick<Storage, "setItem">, list: string[]): void {
  try {
    storage.setItem(RECENT_COLORS_KEY, JSON.stringify(list));
  } catch {
    // 저장 실패는 치명적이지 않으므로 무시한다(최근 색은 보조 기능).
  }
}
