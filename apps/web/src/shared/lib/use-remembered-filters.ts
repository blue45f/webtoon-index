
import { useEffect, useState } from "react";

import { EMPTY_TITLE_FILTERS, type TitleFilterState } from "./title-filters";

// 작품 필터를 브라우저에 기억(persist)하는 훅 — useState<TitleFilterState> 의 드롭인 대체.
// "필터 기억"이 켜져 있으면 현재 필터를 localStorage 에 저장하고 다음 방문 때 복원한다.
// 끄면 저장분을 지우고 매 방문 빈 필터로 시작(기존 동작). 기억 여부는 전역 1개 선호값,
// 필터 값은 페이지(scope)별로 분리 저장한다(랭킹·추천·캘린더가 서로 안 섞이게).
const FLAG_KEY = "toonspectrum-filters-remember";
const dataKey = (scope: string) => `toonspectrum-filters:${scope}`;

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return false;
  }
}
function readSaved(scope: string): TitleFilterState | null {
  try {
    const raw = localStorage.getItem(dataKey(scope));
    if (!raw) return null;
    // 스키마 변화에 안전하도록 빈 필터 위에 병합.
    return { ...EMPTY_TITLE_FILTERS, ...JSON.parse(raw) };
  } catch {
    return null;
  }
}

// 설정 페이지용 전역 헬퍼 — "필터 기억" 선호값 읽기/쓰기 + 저장된 필터 전체 초기화.
export function getRememberFlag(): boolean {
  return readFlag();
}
export function setRememberFlag(on: boolean): void {
  try {
    localStorage.setItem(FLAG_KEY, on ? "1" : "0");
    if (!on) clearAllRememberedFilters(false);
  } catch {
    /* 무시 */
  }
}
// 저장된 모든 페이지의 필터 값 제거(선택적으로 기억 플래그도 끔).
export function clearAllRememberedFilters(alsoFlag = true): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith("toonspectrum-filters:")) localStorage.removeItem(k);
    }
    if (alsoFlag) localStorage.setItem(FLAG_KEY, "0");
  } catch {
    /* 무시 */
  }
}

export function useRememberedFilters(scope: string) {
  const [remember, setRemember] = useState(false);
  const [filters, setFilters] = useState<TitleFilterState>(EMPTY_TITLE_FILTERS);

  // 복원은 클라이언트 마운트 이후에만(하이드레이션 안전). 기억 ON 이었으면 저장분을 불러온다.
  useEffect(() => {
    if (!readFlag()) return;
    setRemember(true);
    const saved = readSaved(scope);
    if (saved) setFilters(saved);
  }, [scope]);

  // 기억 ON 인 동안 변경분을 저장.
  useEffect(() => {
    if (!remember) return;
    try {
      localStorage.setItem(dataKey(scope), JSON.stringify(filters));
    } catch {
      /* 저장 실패는 무시(프라이빗 모드 등) */
    }
  }, [scope, filters, remember]);

  const toggleRemember = () => {
    setRemember((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(FLAG_KEY, next ? "1" : "0");
        if (next) localStorage.setItem(dataKey(scope), JSON.stringify(filters));
        else localStorage.removeItem(dataKey(scope));
      } catch {
        /* 무시 */
      }
      return next;
    });
  };

  return { filters, setFilters, remember, toggleRemember };
}
