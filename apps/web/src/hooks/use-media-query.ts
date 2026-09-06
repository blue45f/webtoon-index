
import { useEffect, useState } from "react";

const evaluate = (query: string): boolean =>
  typeof window !== "undefined" &&
  typeof globalThis.matchMedia === "function" &&
  globalThis.matchMedia(query).matches;

/**
 * CSS 미디어 쿼리에 반응하는 상태. 뷰포트 변화에 따라 재평가된다.
 * SPA(클라이언트 전용)라 초기값을 동기로 읽어 깜빡임 없이 시작한다.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => evaluate(query));

  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const mql = globalThis.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange(); // 쿼리 변경/마운트 시 현재 상태로 동기화
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Tailwind `lg`(1024px) 기준 모바일/태블릿 여부 — 스튜디오의 데스크톱↔모바일 레이아웃 분기 단일 출처. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 1023px)");
}
