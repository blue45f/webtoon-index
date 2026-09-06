import { useSyncExternalStore } from "react";

import { useApp } from "./store";
import { deriveSavedTitleIds } from "./types";

// SSR/CSR 하이드레이션 가드 — persist 가 클라이언트에서 채워질 때까지 false.
// useSyncExternalStore 로 외부(persist) 상태를 구독 (effect 내 setState 없이 SSR 안전).
export function useHydrated(): boolean {
  return useSyncExternalStore(
    (cb) => useApp.persist.onFinishHydration(cb),
    () => useApp.persist.hasHydrated(),
    () => false
  );
}

// 파생 셀렉터 헬퍼 — '관심(want)'만 북마크로 간주
export function useIsBookmarked(titleId: string): boolean {
  return useApp((s) => s.reads[titleId] === "want");
}

// '내 찜·서재' = 사용자가 저장/구독/컬렉션에 담은 모든 작품 id 집합(하차 제외).
// 페이지 필터의 "내 찜만 보기"에 사용. 합집합 규칙은 @toonspectrum/core 의 순수
// deriveSavedTitleIds 로 추출돼 여러 웹 화면이 공유한다(세 레코드 참조는 안정적이라 React Compiler가 메모이즈).
export function useSavedTitleIds(): Set<string> {
  const reads = useApp((s) => s.reads);
  const subscriptions = useApp((s) => s.subscriptions);
  const collections = useApp((s) => s.collections);
  return deriveSavedTitleIds(reads, subscriptions, collections);
}
