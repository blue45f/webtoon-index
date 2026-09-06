import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { FortuneResult, FortuneTab } from "./FortunePage";

// 운세 페이지 재방문 영속화 — 생년월일 등 입력을 기억해 재입력을 없애고,
// 운세를 본 날짜를 모아 '연속 출석(스트릭)'을 계산하고, 최근 본 운세를 보관(재방문)한다.
// localStorage 영속.

export interface SavedFortune {
  id: string;
  tab: FortuneTab;
  characterId: string;
  characterName: string;
  characterAvatar: string;
  dateLabel: string; // 표시용 날짜
  summary: string; // 짧은 요약(점수·일주·카드명 등)
  result: FortuneResult;
}

export interface FortuneProfile {
  lastCharacterId: string | null;
  birthDate: string;
  birthTime: string;
  gender: string;
  partnerBirthDate: string;
  partnerBirthTime: string;
}

interface FortuneStore extends FortuneProfile {
  viewedDates: string[]; // 운세를 본 KST 날짜(YYYY-MM-DD) 모음
  history: SavedFortune[]; // 최근 본 운세(최신순, 최대 8개)
  bonusDates: string[]; // 스페셜 부적 카드를 연 KST 날짜(보상형 광고 보상 — 하루 1회 잠금해제)
  setProfile: (patch: Partial<FortuneProfile>) => void;
  recordView: () => void;
  recordBonusUnlock: () => void;
  addToHistory: (rec: Omit<SavedFortune, "id" | "dateLabel">) => void;
  removeFromHistory: (id: string) => void;
  clearHistory: () => void;
}

// KST 기준 오늘 날짜
export function todayKst(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export const useFortuneStore = create<FortuneStore>()(
  persist(
    (set) => ({
      lastCharacterId: null,
      birthDate: "",
      birthTime: "",
      gender: "none",
      partnerBirthDate: "",
      partnerBirthTime: "",
      viewedDates: [],
      history: [],
      bonusDates: [],
      setProfile: (patch) => set(patch),
      recordView: () =>
        set((s) => {
          const today = todayKst();
          if (s.viewedDates.includes(today)) return s;
          // 최근 60일치만 보관
          const next = [...s.viewedDates, today].slice(-60);
          return { viewedDates: next };
        }),
      // 보상형 광고 userEarnedReward 수신 시에만 호출 — 오늘의 스페셜 부적 카드를 잠금해제한다.
      recordBonusUnlock: () =>
        set((s) => {
          const today = todayKst();
          if (s.bonusDates.includes(today)) return s;
          return { bonusDates: [...s.bonusDates, today].slice(-60) };
        }),
      addToHistory: (rec) =>
        set((s) => {
          const id =
            typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
          const dateLabel = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
          const full: SavedFortune = { ...rec, id, dateLabel };
          return { history: [full, ...s.history].slice(0, 8) };
        }),
      removeFromHistory: (id) => set((s) => ({ history: s.history.filter((h) => h.id !== id) })),
      clearHistory: () => set({ history: [] }),
    }),
    {
      name: "toonspectrum-fortune",
      version: 1, // history는 추가 필드라 기본 merge로 처리됨(버전 범프·migrate 불필요)
    }
  )
);

// 연속 출석일 계산 — 오늘(또는 어제)부터 끊김 없이 이어진 일수
export function computeStreak(viewedDates: string[]): number {
  if (viewedDates.length === 0) return 0;
  const set = new Set(viewedDates);
  const dayMs = 24 * 60 * 60 * 1000;
  const base = new Date(todayKst() + "T00:00:00Z").getTime();
  // 오늘 안 봤으면 어제부터 카운트(아직 오늘 볼 수 있으니 끊김 아님)
  let cursor = set.has(todayKst()) ? base : base - dayMs;
  let streak = 0;
  while (set.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= dayMs;
  }
  return streak;
}
