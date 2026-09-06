// 최근 검색어 — 순수 로직(스토어/뷰에서 공유). 정규화·중복 제거·상한 적용을 한곳에 모아 단위 테스트한다.
// 저장은 zustand persist(localStorage)가 담당하고, 여기서는 "다음 목록"을 계산만 한다(부수효과 없음).

export const RECENT_SEARCH_LIMIT = 8;
const MAX_QUERY_LENGTH = 80;

// 입력을 표시·저장용으로 정규화 — 앞뒤 공백 제거, 내부 연속 공백 1칸, 길이 상한.
export function normalizeQuery(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
}

// 새 검색어를 목록 맨 앞에 추가하고 대소문자 무시 중복을 제거한 뒤 상한까지 자른다.
// 빈 문자열은 무시(기존 목록 그대로 반환).
export function addRecentSearch(
  list: readonly string[],
  raw: string,
  limit = RECENT_SEARCH_LIMIT
): string[] {
  const next = normalizeQuery(raw);
  if (!next) return [...list];
  const folded = next.toLocaleLowerCase("ko-KR");
  const deduped = list.filter((entry) => entry.toLocaleLowerCase("ko-KR") !== folded);
  return [next, ...deduped].slice(0, Math.max(0, limit));
}

// 특정 검색어 1건 제거(대소문자 무시).
export function removeRecentSearch(list: readonly string[], raw: string): string[] {
  const folded = normalizeQuery(raw).toLocaleLowerCase("ko-KR");
  if (!folded) return [...list];
  return list.filter((entry) => entry.toLocaleLowerCase("ko-KR") !== folded);
}
