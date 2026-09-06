import { getCharacters } from "@toonspectrum/core";
import {
  Sparkles,
  User,
  Calendar,
  Clock,
  ArrowRight,
  RotateCcw,
  Play,
  Pause,
  Square,
  Volume2,
  SkipBack,
  SkipForward,
  Sparkle,
  Share2,
  X,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";
import { useState, useEffect, useRef } from "react";

import { CountUp, ConfettiBurst } from "./fortune-fx";
import { useFortuneStore, computeStreak } from "./fortune-store";
import { charThemeVars } from "./fortune-theme";
import { FortuneLoading } from "./FortuneLoading";
import { FortuneShareModal } from "./FortuneShareModal";
import { TarotCardFace } from "./TarotCardFace";
import { useFortunePlayback } from "./useFortunePlayback";
import { WebtoonStrip } from "./WebtoonStrip";

import type { SavedFortune } from "./fortune-store";
import type { FortunePanel } from "./fortune-types";
import type { Title } from "@/shared/lib/types";

import { TitleCard } from "@/shared/components/title-card";
// 배포 환경에서도 root-relative 이미지 경로가 올바른 오리진을 가리키도록 정규화한다.
import { withCsrfProtection } from "@/shared/lib/csrf";
import { cn } from "@/shared/lib/utils";
import { resolveAssetUrl } from "@/src/shared/catalog/catalog-static";

interface Character {
  id: string;
  name: string;
  origin: string;
  greeting: string;
  avatarUrl: string;
}

interface SajuPillar {
  kan: string;
  ji: string;
  kanKorean: string;
  jiKorean: string;
  elementKan: string;
  elementJi: string;
}

interface SajuData {
  yearPillar: SajuPillar;
  monthPillar: SajuPillar;
  dayPillar: SajuPillar;
  hourPillar: SajuPillar;
  elementsRatio: {
    wood: number;
    fire: number;
    earth: number;
    metal: number;
    water: number;
  };
}

interface TarotCardData {
  id: number;
  name: string;
  nameEn: string;
  type: "upright" | "reversed";
  keywords: string[];
  description: string;
}

interface TodayFortuneData {
  score: number;
  color: string;
  direction: string;
  time: string;
  luckyNumber: number;
}

// 백엔드 명리 분석(사주/오늘 일진/궁합) — 응답에 포함, 공유 카드·표시에 사용
export interface SajuAnalysisData {
  dayMasterKan: string;
  dayMasterElement: string;
  yinYang: string;
  strength: string;
  dominantTenGod: string;
  usefulElement: string;
  usefulElementEn: string;
  personality: string;
  summary: string;
}
export interface IljinData {
  todayPillar: string;
  relationTenGod: string;
  themeName: string;
  themeFocus: string;
  score: number;
}
export interface CompatData {
  score: number;
  grade: string;
  factors: string[];
  positives?: string[];
  cautions?: string[];
  elementComplement?: number;
}
export interface ZodiacData {
  id: string;
  ko: string;
  en: string;
  glyph: string;
  element: string;
  dateRange: string;
  traits: string[];
  ruling: string;
  score: number;
  luckyColor: string;
  luckyNumber: number;
}

export interface YearLuckData {
  year: number;
  kanji: string;
  relationTenGod: string;
  themeName: string;
  themeFocus: string;
  score: number;
}

export interface FortuneResult {
  interpretation: string;
  panels?: FortunePanel[];
  saju?: SajuData;
  yearLuck?: { thisYear: YearLuckData; nextYear: YearLuckData };
  mySaju?: SajuData;
  partnerSaju?: SajuData;
  card?: TarotCardData;
  cards?: (TarotCardData & { position?: string })[];
  spread?: "one" | "three";
  today?: TodayFortuneData;
  analysis?: SajuAnalysisData | null;
  iljin?: IljinData | null;
  categories?: { love: number; money: number; work: number; health: number } | null;
  compat?: CompatData;
  zodiac?: ZodiacData;
  luckyElement?: string | null;
  score?: number;
  query?: string;
  recommendations: Title[];
}

export type FortuneTab = "today" | "saju" | "compatibility" | "tarot" | "prescription" | "zodiac";

// 보관함 표시용 짧은 요약
function fortuneSummary(tab: FortuneTab, r: FortuneResult): string {
  if (tab === "today" && r.today) return `오늘의 운세 ${r.today.score}점`;
  if (tab === "zodiac" && r.zodiac) return `${r.zodiac.ko} ${r.zodiac.score}점`;
  if (tab === "saju" && r.saju) return `사주 ${r.saju.dayPillar.kanKorean}${r.saju.dayPillar.jiKorean}일주`;
  if (tab === "compatibility" && r.compat) return `궁합 ${r.compat.score}%`;
  if (tab === "tarot" && r.card) return `타로 ${r.card.name}`;
  if (tab === "prescription") return "독서 처방";
  return "운세 결과";
}

const TAB_LABEL_KO: Record<FortuneTab, string> = {
  today: "오늘의 운세", zodiac: "별자리", saju: "사주팔자", compatibility: "인연 궁합", prescription: "독서 처방", tarot: "타로",
};

// 오행 영문키 → 한글 (오늘의 운세 개인화 표시용)
const ELEMENT_KO: Record<string, string> = {
  wood: "목(木)", fire: "화(火)", earth: "토(土)", metal: "금(金)", water: "수(水)",
};

// 오행 색상 매핑 (ToonSpectrum 디자인 토큰을 활용한 프리미엄 컬러 세트)
const ELEMENT_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  "목": { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-500" },
  "화": { bg: "bg-red-500/10", text: "text-red-400", dot: "bg-red-500" },
  "토": { bg: "bg-amber-600/10", text: "text-amber-500", dot: "bg-amber-600" },
  "금": { bg: "bg-slate-300/10", text: "text-slate-200", dot: "bg-slate-300" },
  "수": { bg: "bg-sky-500/10", text: "text-sky-400", dot: "bg-sky-500" },
};

export function FortunePage() {
  // 재방문 영속화 — 저장된 프로필로 입력 초기값을 채운다(재입력 제거)
  const savedProfile = useFortuneStore.getState();
  const setProfile = useFortuneStore((s) => s.setProfile);
  const recordView = useFortuneStore((s) => s.recordView);
  const viewedDates = useFortuneStore((s) => s.viewedDates);
  const streak = computeStreak(viewedDates);
  const addToHistory = useFortuneStore((s) => s.addToHistory);
  const history = useFortuneStore((s) => s.history);
  const clearHistory = useFortuneStore((s) => s.clearHistory);
  const removeFromHistory = useFortuneStore((s) => s.removeFromHistory);

  // 캐릭터 목록은 @toonspectrum/core 의 정적 데이터(웹·API 단일 출처)로 즉시 채운다 —
  // API(/api/fortune/characters, 로컬은 dev:api 필요)가 없거나 실패해도 피커가 동작한다.
  const [characters, setCharacters] = useState<Character[]>(() => getCharacters());
  const [selectedChar, setSelectedChar] = useState<Character | null>(null);
  const [activeTab, setActiveTab] = useState<FortuneTab>("today");

  // 사주 입력 상태 (저장값으로 초기화)
  const [birthDate, setBirthDate] = useState(savedProfile.birthDate);
  const [birthTime, setBirthTime] = useState(savedProfile.birthTime);
  const [gender, setGender] = useState(savedProfile.gender);

  // 궁합 입력 상태
  const [partnerBirthDate, setPartnerBirthDate] = useState(savedProfile.partnerBirthDate);
  const [partnerBirthTime, setPartnerBirthTime] = useState(savedProfile.partnerBirthTime);
  
  // 처방전 입력 상태
  const [prescriptionQuery, setPrescriptionQuery] = useState("");
  
  // 타로 상태
  const [tarotStep, setTarotStep] = useState<"idle" | "shuffling" | "spread" | "revealed">("idle");
  const [tarotSpread, setTarotSpread] = useState<"one" | "three">("one");
  
  // 결과 상태 — 탭별로 캐시해 탭을 옮겨도 이전 결과가 유지된다
  const [isLoading, setIsLoading] = useState(false);
  const [resultsByTab, setResultsByTab] = useState<Partial<Record<FortuneTab, FortuneResult>>>({});
  const fortuneResult = resultsByTab[activeTab] ?? null;
  const setActiveTabResult = (tab: FortuneTab, data: FortuneResult | null) =>
    setResultsByTab((prev) => ({ ...prev, [tab]: data ?? undefined }));

  // 운세 웹툰 재생 오케스트레이터 — 음성(Web Speech) + 컷 애니메이션 동기
  const playback = useFortunePlayback(fortuneResult?.panels);

  // 결과 공유/저장 모달
  const [shareOpen, setShareOpen] = useState(false);

  // 에러·재시도 (운세 호출 실패 시)
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [charLoadFailed, setCharLoadFailed] = useState(false);
  const retryRef = useRef<(() => void) | null>(null);
  // 결과 헤딩 포커스용(접근성) + 라이브 안내
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const [liveMsg, setLiveMsg] = useState("");

  // 운세 API 공용 호출 — 로딩/에러/재시도/낭독정지를 일관 처리
  const callFortune = async (
    url: string,
    body: Record<string, unknown>,
    retry: () => void,
    onSuccess?: (data: FortuneResult) => void
  ): Promise<FortuneResult | null> => {
    playback.stop();
    // 입력 프로필 영속화 — 다음 방문 시 재입력 제거
    setProfile({
      birthDate,
      birthTime,
      gender,
      partnerBirthDate,
      partnerBirthTime,
      lastCharacterId: selectedChar?.id ?? null,
    });
    setErrorMsg(null);
    setLiveMsg("");
    setIsLoading(true);
    setActiveTabResult(activeTab, null);
    retryRef.current = retry;
    try {
      const response = await fetch(url, withCsrfProtection({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }));
      if (!response.ok) {
        // 검증 실패(400) 등 — 서버 메시지를 그대로 보여준다
        let serverMsg = "";
        try {
          const err = await response.json();
          serverMsg = Array.isArray(err?.message) ? err.message[0] : err?.message ?? "";
        } catch {
          /* ignore */
        }
        setErrorMsg(serverMsg || "운세를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
        return null;
      }
      const data: FortuneResult = await response.json();
      setActiveTabResult(activeTab, data);
      onSuccess?.(data);
      recordView(); // 출석(스트릭)은 실제 새 조회에서만
      if (selectedChar) {
        addToHistory({
          tab: activeTab,
          characterId: selectedChar.id,
          characterName: selectedChar.name,
          characterAvatar: selectedChar.avatarUrl,
          summary: fortuneSummary(activeTab, data),
          result: data,
        });
      }
      return data;
    } catch (error) {
      console.error("운세 호출 실패:", error);
      setErrorMsg("네트워크 오류로 운세를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.");
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // 1. 캐릭터 리스트 — 정적 데이터가 이미 채워져 있으니, API 는 최신본으로 "갱신"만 시도한다.
  // API 가 유효한 배열을 주면 반영하고, 실패해도 정적 목록이 남아 피커는 계속 동작한다(에러 UI 억제).
  const loadCharacters = () => {
    setCharLoadFailed(false);
    fetch("/api/fortune/characters")
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) setCharacters(data);
      })
      .catch((err) => {
        // 정적 폴백이 이미 있으므로 사용자에겐 에러를 띄우지 않는다(콘솔에만 기록).
        console.error("캐릭터 정보 API 로드 실패 — 내장 정적 목록 사용:", err);
        setCharacters((prev) => (prev.length > 0 ? prev : getCharacters()));
      });
  };
  useEffect(() => {
    loadCharacters();
     
  }, []);

  // 결과 도착 시 결과 헤딩으로 포커스 이동 + 스크린리더 안내(접근성)
  useEffect(() => {
    if (!fortuneResult) return;
    const name = selectedChar?.name ?? "캐릭터";
    const score = fortuneResult.today?.score ?? fortuneResult.score;
    setLiveMsg(`${name}의 운세 결과가 도착했어요.${score != null ? ` 지수 ${score}점.` : ""}`);
    resultHeadingRef.current?.focus();
  }, [fortuneResult, selectedChar]);

  // 보관함에서 운세 복원
  const restoreFortune = (saved: SavedFortune) => {
    const char =
      characters.find((c) => c.id === saved.characterId) ?? {
        id: saved.characterId,
        name: saved.characterName,
        origin: "ToonSpectrum",
        greeting: "",
        avatarUrl: saved.characterAvatar,
      };
    playback.stop();
    setErrorMsg(null);
    setSelectedChar(char);
    setActiveTab(saved.tab);
    setTarotStep(saved.tab === "tarot" ? "revealed" : "idle");
    setResultsByTab({ [saved.tab]: saved.result }); // 복원은 단일 결과로 교체(이전 캐시 제거)
  };

  // 재생/일시정지/이어듣기 토글
  const handleTogglePlay = () => {
    if (playback.status === "playing") playback.pause();
    else if (playback.status === "paused") playback.resume();
    else playback.play();
  };

  // 오늘의 운세 — 생년월일 입력 시 사주 오행으로 개인화(같은 날·같은 사람은 항상 동일)
  const handleAnalyzeToday = () => {
    if (!selectedChar) return;
    callFortune(
      "/api/fortune/today",
      { characterId: selectedChar.id, birthDate: birthDate || undefined, birthTime: birthTime || undefined, gender },
      handleAnalyzeToday
    );
  };

  // 별자리(서양 점성) — 생년월일의 월/일만 사용
  const handleAnalyzeZodiac = () => {
    if (!selectedChar || !birthDate) return;
    const [, m, d] = birthDate.split("-").map(Number);
    callFortune(
      "/api/fortune/zodiac",
      { characterId: selectedChar.id, month: m, day: d },
      handleAnalyzeZodiac
    );
  };

  // 궁합
  const handleAnalyzeCompatibility = (e: React.FormEvent) => {
    e.preventDefault();
    if (!birthDate || !partnerBirthDate || !selectedChar) return;
    callFortune(
      "/api/fortune/compatibility",
      {
        myBirthDate: birthDate,
        myBirthTime: birthTime || undefined,
        partnerBirthDate,
        partnerBirthTime: partnerBirthTime || undefined,
        characterId: selectedChar.id,
      },
      () => handleAnalyzeCompatibility(e)
    );
  };

  // 독서 처방
  const handleAnalyzePrescription = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prescriptionQuery.trim() || !selectedChar) return;
    callFortune(
      "/api/fortune/prescription",
      { query: prescriptionQuery, characterId: selectedChar.id },
      () => handleAnalyzePrescription(e)
    );
  };

  // 사주 분석
  const handleAnalyzeSaju = (e: React.FormEvent) => {
    e.preventDefault();
    if (!birthDate || !selectedChar) return;
    callFortune(
      "/api/fortune/saju",
      { birthDate, birthTime: birthTime || undefined, gender, characterId: selectedChar.id },
      () => handleAnalyzeSaju(e)
    );
  };

  // 타로 셔플 시작
  const startTarotShuffle = () => {
    setTarotStep("shuffling");
    setTimeout(() => {
      setTarotStep("spread");
    }, 1800);
  };

  // 타로 카드 선택 및 해석 요청 — 고른 카드 위치(cardIdx)가 결과를 결정한다
  const handleSelectTarotCard = (cardIdx: number) => {
    if (!selectedChar || tarotStep !== "spread") return;
    callFortune(
      "/api/fortune/tarot",
      { characterId: selectedChar.id, cardIdx, spread: tarotSpread },
      () => {
        setTarotStep("spread");
        handleSelectTarotCard(cardIdx);
      },
      () => setTarotStep("revealed")
    );
  };

  // 상태 초기화
  const handleReset = () => {
    playback.stop();
    setResultsByTab({});
    setTarotStep("idle");
    setBirthDate("");
    setBirthTime("");
    setPartnerBirthDate("");
    setPartnerBirthTime("");
    setPrescriptionQuery("");
    setGender("none");
  };

  return (
    <MotionConfig reducedMotion="user">
    <div className="mx-auto min-h-screen w-full max-w-[1180px] px-4 py-6 sm:px-6 sm:py-8">
      {/* 스크린리더 전용 라이브 영역 — 운세 결과 도착 안내 */}
      <p className="sr-only" role="status" aria-live="polite">{liveMsg}</p>

      {/* 타이틀 헤더 */}
      <header className="mb-7 text-center sm:mb-10">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft px-3.5 py-1 text-xs font-semibold text-accent">
          <Sparkles className="h-3 w-3" />
          <span>페르소나 캐릭터 운세 레이어</span>
        </div>
        <h1 className="font-display text-[clamp(1.6rem,8vw,1.875rem)] font-extrabold tracking-tight text-fg sm:text-4xl">
          CHARACTER FORTUNE
        </h1>
        <p className="mx-auto mt-2 max-w-md text-pretty text-sm leading-relaxed text-fg-2">
          최애 웹툰 캐릭터가 제안하는 사주팔자와 타로 큐레이션
        </p>
      </header>

      {/* 1단계: 캐릭터 에이전트 선택 */}
      {!selectedChar ? (
        <section className="mt-8">
          {/* 최근 본 운세 보관함 — 클릭 시 그 결과로 복원 */}
          {history.length > 0 && (
            <div className="mx-auto mb-8 max-w-3xl rounded-2xl border border-line bg-panel/30 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-fg-3">
                  <Sparkles className="h-3.5 w-3.5 text-accent" /> 최근 본 운세
                </h2>
                <button onClick={clearHistory} className="text-[11px] text-fg-3 hover:text-fg">전체 지우기</button>
              </div>
              <div className="rail flex gap-2.5 overflow-x-auto pb-1">
                {history.map((h) => (
                  <div key={h.id} className="group relative shrink-0">
                    <button
                      type="button"
                      onClick={() => restoreFortune(h)}
                      className="flex min-w-[150px] items-center gap-2.5 rounded-xl border border-line bg-card/50 p-2.5 pr-7 text-left transition-colors hover:border-line-strong hover:bg-raised"
                    >
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-line/50">
                        {h.characterAvatar ? (
                          <img src={resolveAssetUrl(h.characterAvatar)} alt="" className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-fg">{h.summary}</div>
                        <div className="text-[10px] text-fg-3">{TAB_LABEL_KO[h.tab]} · {h.dateLabel}</div>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeFromHistory(h.id)}
                      aria-label="이 운세 기록 삭제"
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full text-fg-3 opacity-0 transition-opacity hover:bg-raised hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2 className="mb-6 text-center text-lg font-bold text-fg-2">
            당신의 운세를 해석해줄 캐릭터 에이전트를 고르세요.
          </h2>
          {charLoadFailed && characters.length === 0 && (
            <div role="alert" className="mx-auto mb-6 max-w-md rounded-xl border border-bad/30 bg-bad/10 p-4 text-center">
              <p className="text-sm text-fg-2">캐릭터를 불러오지 못했어요.</p>
              <button
                type="button"
                onClick={loadCharacters}
                className="mt-3 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-on-accent hover:bg-accent-2"
              >
                다시 시도
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {characters.map((char, idx) => (
              <motion.button
                key={char.id}
                type="button"
                onClick={() => {
                  setSelectedChar(char);
                  setResultsByTab({}); // 캐릭터별 결과라 새 캐릭터 선택 시 캐시 비움
                }}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.45, delay: idx * 0.09, ease: "easeOut" }}
                whileHover={{ y: -6, boxShadow: "0 18px 44px -14px oklch(0.72 0.185 42 / 0.5)" }}
                whileTap={{ scale: 0.97 }}
                className="group relative text-left w-full block cursor-pointer overflow-hidden rounded-2xl border border-line bg-card/65 p-4 hover:border-line-strong hover:bg-raised"
              >
                {/* 캐릭터 아바타 이미지 (없을 경우 텍스트 fallback) */}
                <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br from-accent-soft to-panel/80 flex items-center justify-center border border-line/40">
                  {char.avatarUrl ? (
                    <img
                      src={resolveAssetUrl(char.avatarUrl)}
                      alt={char.name}
                      className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="font-display text-4xl font-extrabold text-accent/60 group-hover:scale-105 transition-transform duration-300">
                      {char.name[0]}
                    </span>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[oklch(0.13_0.012_70/0.85)] via-transparent to-transparent opacity-80" />
                  <div className="absolute bottom-3 left-3 text-left z-10">
                    <span className="text-[10px] uppercase tracking-wider text-accent font-semibold block">
                      {char.origin}
                    </span>
                    <span className="text-base font-bold text-fg">
                      {char.name}
                    </span>
                  </div>
                </div>
                
                <p className="mt-3 text-xs leading-relaxed text-fg-3 line-clamp-2">
                  "{char.greeting}"
                </p>
                <div className="mt-3 flex items-center justify-end text-[10px] font-bold text-accent group-hover:translate-x-1 transition-transform">
                  선택하기 <ArrowRight className="ml-1 h-3 w-3" />
                </div>
              </motion.button>
            ))}
          </div>
        </section>
      ) : (
        /* 캐릭터가 선택되었을 때의 본문 인터페이스 — 캐릭터 무드색을 CSS 변수로 주입 */
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12" style={charThemeVars(selectedChar.id)}>
          
          {/* 왼쪽: 에이전트 정보 및 말풍선 (3/12 cols) */}
          <aside className="lg:col-span-4 flex flex-col gap-4">
            <div className="rounded-2xl border border-line bg-panel/35 p-5 flex flex-col items-center text-center">
              <div className="relative aspect-square w-24 overflow-hidden rounded-full bg-gradient-to-br from-accent/20 to-panel border-2 flex items-center justify-center shadow-lg" style={{ borderColor: "var(--char-accent)" }}>
                {selectedChar.avatarUrl ? (
                  <img
                    src={resolveAssetUrl(selectedChar.avatarUrl)}
                    alt={selectedChar.name}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <span className="font-display text-3xl font-extrabold text-accent">{selectedChar.name[0]}</span>
                )}
              </div>
              <h2 className="mt-3 text-lg font-bold text-fg">{selectedChar.name}</h2>
              <span className="text-xs text-fg-3">《{selectedChar.origin}》</span>

              {/* 연속 출석 스트릭 */}
              {streak > 0 && (
                <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent">
                  🔥 {streak}일 연속 출석
                </span>
              )}

              <button
                onClick={() => {
                  setSelectedChar(null);
                  handleReset();
                }}
                className="mt-4 flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-fg-2 hover:bg-card transition-colors"
              >
                <RotateCcw className="h-3 w-3" /> 다른 캐릭터 선택
              </button>
            </div>

            {/* 에이전트 인사말 + 음성 안내 패널 */}
            <div className="flex-1 rounded-2xl border border-line bg-card/40 p-5 flex flex-col gap-4">
              <div>
                <span className="text-[10px] tracking-wider text-accent uppercase font-bold mb-2 block">AGENT'S VOICE</span>
                <p className="font-serif text-sm leading-relaxed text-fg-2 whitespace-pre-wrap">
                  {`"${selectedChar.greeting}"`}
                </p>
              </div>

              {/* 웹툰 재생 상태 — 결과가 있을 때만 노출 */}
              {fortuneResult?.panels?.length ? (
                <div className="mt-auto rounded-xl border border-line/70 bg-panel/40 p-3 space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-fg-3">웹툰 음성 재생</span>
                  {playback.supported ? (
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent-2"
                    >
                      {playback.status === "playing" ? (
                        <><Pause className="h-3.5 w-3.5" /> 일시정지</>
                      ) : playback.status === "paused" ? (
                        <><Play className="h-3.5 w-3.5" /> 이어 보기</>
                      ) : (
                        <><Play className="h-3.5 w-3.5" /> 웹툰 재생</>
                      )}
                    </button>
                  ) : (
                    <p className="text-center text-[10px] leading-relaxed text-fg-3">
                      이 브라우저는 음성을 지원하지 않아요. (Chrome·Safari 권장)
                    </p>
                  )}
                  {playback.status === "playing" && (
                    <p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-accent">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
                      </span>
                      {playback.activeStep + 1} / {playback.steps.length} 컷 상영 중…
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </aside>

          {/* 오른쪽: 메인 입력 및 결과창 (8/12 cols) */}
          <main className="lg:col-span-8 flex flex-col gap-6">
            
            {/* 탭 네비게이션 — 항상 노출(결과를 보면서도 전환, 탭별 결과 유지) · 모바일 가로 스크롤 + ARIA */}
            <div
              role="tablist"
              aria-label="운세 종류"
              className="rail flex gap-1 overflow-x-auto rounded-xl border border-line bg-panel/30 p-1"
            >
              {([
                { key: "today", label: "오늘의 운세" },
                { key: "zodiac", label: "별자리" },
                { key: "saju", label: "사주팔자" },
                { key: "compatibility", label: "인연 궁합" },
                { key: "prescription", label: "독서 처방" },
                { key: "tarot", label: "타로 리딩" },
              ] as const).map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={activeTab === tab.key}
                  onClick={() => {
                    playback.stop();
                    setActiveTab(tab.key);
                  }}
                  className={cn(
                    "min-h-11 min-w-fit shrink-0 whitespace-nowrap rounded-lg px-3.5 text-xs font-semibold transition-all",
                    activeTab === tab.key ? "bg-accent text-on-accent shadow" : "text-fg-3 hover:text-fg"
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* 컨텐츠 카드 영역 */}
            <div
              className="rounded-2xl border border-line bg-panel/20 p-6 min-h-[400px] flex flex-col justify-center"
              aria-live="polite"
              aria-busy={isLoading}
            >

              {/* 에러 + 재시도 */}
              {!isLoading && errorMsg && (
                <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="rounded-full border border-bad/30 bg-bad/10 px-4 py-2 text-sm text-fg-2">{errorMsg}</div>
                  <button
                    type="button"
                    onClick={() => retryRef.current?.()}
                    className="rounded-lg bg-accent px-4 py-2 text-xs font-bold text-on-accent hover:bg-accent-2"
                  >
                    다시 시도
                  </button>
                </div>
              )}

              {/* 로딩 — 탭별 스켈레톤(DESIGN.md: 스피너 금지) */}
              {isLoading && (
                <div role="status">
                  <FortuneLoading tab={activeTab} characterName={selectedChar.name} avatarUrl={selectedChar.avatarUrl} />
                </div>
              )}

              {/* 결과 출력창 */}
              {!isLoading && fortuneResult && (
                <div className="space-y-8 animate-reveal">
                  
                  {/* 결과 상단 공통 헤더 */}
                  <div className="border-b border-line/60 pb-4 flex justify-between items-center">
                    <div>
                      <h3
                        ref={resultHeadingRef}
                        tabIndex={-1}
                        className="text-xl font-extrabold text-fg font-display uppercase tracking-tight outline-none"
                      >
                        {activeTab === "today" ? "TODAY'S ORACLE" : activeTab === "saju" ? "SAJU MANSE" : activeTab === "compatibility" ? "RELATION COMPATIBILITY" : activeTab === "prescription" ? "READING PRESCRIPTION" : activeTab === "zodiac" ? "ZODIAC HOROSCOPE" : "TAROT READING"}
                      </h3>
                      <p className="text-xs text-fg-3 mt-0.5">
                        {activeTab === "today" ? "오늘 하루의 종합 운세 기운" : activeTab === "saju" ? "생년월일 오행 밸런스 결과" : activeTab === "compatibility" ? "두 사람의 기운 융합 및 매칭 스코어" : activeTab === "prescription" ? "당신의 고민을 치유해 줄 맞춤 처방 책장" : activeTab === "zodiac" ? "생일로 보는 별자리 오늘의 운세" : "선택한 카드의 오늘 기운"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShareOpen(true)}
                        className="flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-accent hover:text-on-accent"
                      >
                        <Share2 className="h-3 w-3" /> 공유·저장
                      </button>
                      <button
                        onClick={handleReset}
                        className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg"
                      >
                        <RotateCcw className="h-3 w-3" /> 다시 보기
                      </button>
                    </div>
                  </div>

                  {/* 오늘의 운세 전용 결과 디스플레이 */}
                  {activeTab === "today" && fortuneResult.today && (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                      
                      {/* 오늘의 운세 지수 원형 도넛/게이지 */}
                      <div className="md:col-span-4 flex flex-col items-center justify-center p-4 border border-line/45 rounded-2xl bg-card/30 relative overflow-hidden">
                        {/* 고득점 축포 — 컨페티 버스트 */}
                        {fortuneResult.today.score >= 85 && <ConfettiBurst count={28} />}
                        <span className="text-[10px] font-bold text-fg-3 uppercase tracking-wider mb-2">FORTUNE SCORE</span>
                        <div className="relative flex items-center justify-center w-28 h-28">
                          {/* SVG 원형 프로그레스 */}
                          <svg className="w-full h-full transform -rotate-90">
                            <circle
                              cx="56"
                              cy="56"
                              r="48"
                              className="stroke-line/50"
                              strokeWidth="8"
                              fill="transparent"
                            />
                            <circle
                              cx="56"
                              cy="56"
                              r="48"
                              className="transition-all duration-1000 ease-out"
                              style={{ stroke: "var(--char-accent)" }}
                              strokeWidth="8"
                              fill="transparent"
                              strokeDasharray={2 * Math.PI * 48}
                              strokeDashoffset={2 * Math.PI * 48 * (1 - fortuneResult.today.score / 100)}
                              strokeLinecap="round"
                            />
                          </svg>
                          <div className="absolute flex flex-col items-center">
                            <CountUp value={fortuneResult.today.score} className="text-3xl font-extrabold font-display text-fg" />
                            <span className="text-[9px] font-bold text-accent">SCORE</span>
                          </div>
                        </div>
                        <p className="mt-3 text-xs font-semibold text-fg-2">
                          {fortuneResult.today.score >= 90 ? "★ 최고의 하루 ★" : fortuneResult.today.score >= 80 ? "☆ 맑음 & 평온 ☆" : "무난하고 조심스러운 하루"}
                        </p>
                      </div>

                      {/* 행운의 요소 그리드 */}
                      <div className="md:col-span-8 grid grid-cols-2 gap-3.5">
                        {[
                          { label: "행운의 컬러", value: fortuneResult.today.color, desc: "의상이나 소품으로 챙겨보세요" },
                          { label: "행운의 방향", value: fortuneResult.today.direction, desc: "이 방향으로 이동해 보세요" },
                          { label: "행운의 시간대", value: fortuneResult.today.time, desc: "가장 좋은 일이 생길 타이밍" },
                          { label: "행운의 숫자", value: fortuneResult.today.luckyNumber, desc: "오늘 당신의 수호 숫자" },
                        ].map((item, idx) => (
                          <div key={idx} className="p-3 border border-line/45 bg-card/20 rounded-xl flex flex-col">
                            <span className="text-[10px] font-bold text-accent uppercase tracking-wider">{item.label}</span>
                            <span className="text-base font-extrabold text-fg mt-1 font-serif">{item.value}</span>
                            <span className="text-[9px] text-fg-3 mt-0.5">{item.desc}</span>
                          </div>
                        ))}
                      </div>

                      {/* 사주 기반 개인화 안내 — 생년월일 입력 시 노출 */}
                      {fortuneResult.luckyElement && fortuneResult.saju && (
                        <div className="md:col-span-12 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-accent/20 bg-accent-soft/40 px-4 py-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-accent">내 사주 연동</span>
                          <span className="text-xs text-fg-2">
                            일주 <strong className="text-fg">{fortuneResult.saju.dayPillar.kanKorean}{fortuneResult.saju.dayPillar.jiKorean}</strong>
                          </span>
                          <span className="text-xs text-fg-2">
                            오늘 보완하면 좋은 기운 <strong className="text-fg">{ELEMENT_KO[fortuneResult.luckyElement] ?? fortuneResult.luckyElement}</strong>
                          </span>
                          <span className="text-[10px] text-fg-3">→ 행운 컬러·방향이 이 기운에 맞춰졌어요</span>
                        </div>
                      )}

                      {/* 세부운 4분면 — 애정·금전·직장·건강 (일진 십성 기반) */}
                      {fortuneResult.categories && (
                        <div className="md:col-span-12 grid grid-cols-2 gap-x-5 gap-y-3 rounded-xl border border-line/45 bg-card/20 p-4 sm:grid-cols-4">
                          {([
                            { key: "love", label: "애정운", emoji: "💕", hue: 350 },
                            { key: "money", label: "금전운", emoji: "💰", hue: 90 },
                            { key: "work", label: "직장운", emoji: "💼", hue: 250 },
                            { key: "health", label: "건강운", emoji: "🌿", hue: 150 },
                          ] as const).map((cat) => {
                            const val = fortuneResult.categories![cat.key];
                            return (
                              <div key={cat.key} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-semibold text-fg-2">{cat.emoji} {cat.label}</span>
                                  <span className="font-display font-bold text-fg">{val}</span>
                                </div>
                                <div className="h-2 w-full overflow-hidden rounded-full bg-card">
                                  <motion.div
                                    className="h-full rounded-full"
                                    style={{ background: `oklch(0.72 0.15 ${cat.hue})` }}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${val}%` }}
                                    transition={{ duration: 0.9, ease: "easeOut" }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                    </div>
                  )}

                  {/* 별자리 전용 결과 디스플레이 */}
                  {activeTab === "zodiac" && fortuneResult.zodiac && (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                      {/* 별자리 글리프 카드 */}
                      <div className="md:col-span-4 flex flex-col items-center justify-center rounded-2xl border border-line/45 bg-card/30 p-5 text-center">
                        <motion.span
                          className="text-6xl"
                          initial={{ scale: 0, rotate: -30, opacity: 0 }}
                          animate={{ scale: 1, rotate: 0, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 140, damping: 12 }}
                          style={{ filter: "drop-shadow(0 3px 14px var(--color-accent))" }}
                        >
                          {fortuneResult.zodiac.glyph}
                        </motion.span>
                        <span className="mt-2 text-lg font-bold text-fg">{fortuneResult.zodiac.ko}</span>
                        <span className="text-[11px] text-fg-3">{fortuneResult.zodiac.en} · {fortuneResult.zodiac.dateRange}</span>
                        <span className="mt-2 rounded-full border border-accent/25 bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent">
                          {fortuneResult.zodiac.element}의 별자리 · {fortuneResult.zodiac.ruling}
                        </span>
                      </div>

                      {/* 별자리 운세 지수 + 성향 + 행운 */}
                      <div className="md:col-span-8 space-y-4">
                        <div className="flex items-baseline gap-2">
                          <CountUp value={fortuneResult.zodiac.score} className="font-display text-4xl font-extrabold" style={{ color: "var(--char-accent)" }} />
                          <span className="text-sm font-bold text-fg-2">점 · 오늘의 별자리 운세</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {fortuneResult.zodiac.traits.map((tr) => (
                            <span key={tr} className="rounded-full border border-line/50 bg-card/40 px-3 py-1 text-xs font-semibold text-fg-2">
                              #{tr}
                            </span>
                          ))}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="rounded-xl border border-line/45 bg-card/20 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent">행운 컬러</span>
                            <span className="mt-1 block font-serif text-base font-extrabold text-fg">{fortuneResult.zodiac.luckyColor}</span>
                          </div>
                          <div className="rounded-xl border border-line/45 bg-card/20 p-3">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-accent">행운 숫자</span>
                            <span className="mt-1 block font-serif text-base font-extrabold text-fg">{fortuneResult.zodiac.luckyNumber}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 독서 처방전 전용 결과 디스플레이 */}
                  {activeTab === "prescription" && fortuneResult.query && (
                    <div className="p-5 border border-amber-500/15 bg-gradient-to-br from-amber-500/5 to-card rounded-2xl relative overflow-hidden space-y-4 text-left">
                      {/* 고풍스러운 문양 장식 */}
                      <div className="absolute top-2 right-4 text-[10px] font-bold text-amber-500/40 uppercase tracking-widest font-display">Prescribed by {selectedChar.name}</div>
                      
                      <div className="space-y-1">
                        <span className="text-[10px] font-bold text-amber-500/70 uppercase tracking-wider">PRESCRIPTION SLIP</span>
                        <h4 className="text-sm font-semibold text-fg-2">진단된 고민: "{fortuneResult.query}"</h4>
                      </div>
                      
                      <div className="h-px bg-amber-500/10" />
                      
                      {/* 복약 가이드 / 연출 문구 */}
                      <div className="space-y-2">
                        <span className="text-[10px] font-bold text-amber-500/60 uppercase tracking-wider block">복약 처방전 가이드</span>
                        <p className="text-xs leading-relaxed text-fg-3 italic">
                          * 아래 추천된 책(웹툰)을 하루 1회, 3화 이상 읽으며 마음에 평온을 부어넣으세요. 부작용으로 몰입 과다에 따른 수면 부족이 생길 수 있으니 주의 바랍니다.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 궁합 전용 결과 디스플레이 */}
                  {activeTab === "compatibility" && fortuneResult.score && fortuneResult.mySaju && fortuneResult.partnerSaju && (
                    <div className="space-y-6">
                      
                      {/* 궁합 요약 매칭 바 */}
                      <div className="p-5 border border-line/45 bg-card/30 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6">
                        <div className="flex flex-col gap-1 text-center md:text-left">
                          <span className="text-[10px] font-bold text-accent uppercase tracking-wider">COMPATIBILITY MATCH</span>
                          <h4 className="text-lg font-bold text-fg">웹툰 주인공 같은 두 사람의 만남</h4>
                          <p className="text-xs text-fg-3">오행의 상생 흐름과 상성 결합도를 분석한 결과입니다.</p>
                        </div>
                        <div className="flex items-center gap-3.5 bg-card px-5 py-3.5 rounded-xl border border-line/40">
                          <div className="text-right">
                            <span className="text-[10px] font-bold text-fg-3 block">궁합 지수</span>
                            <span className="text-2xl font-extrabold text-accent font-display">
                              <CountUp value={fortuneResult.score} />%
                            </span>
                          </div>
                          <div className="h-8 w-px bg-line" />
                          <span className="text-xs font-semibold text-fg-2">
                            {fortuneResult.score >= 90 ? "신이 내린 찰떡궁합" : fortuneResult.score >= 80 ? "든든하고 편안한 연인" : fortuneResult.score >= 70 ? "서로 맞춰가는 든든한 동반자" : "유연한 소통이 필요한 인연"}
                          </span>
                        </div>
                      </div>

                      {/* 두 사람의 사주 대조 뷰 */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* 본인 사주 */}
                        <div className="p-4 border border-line/40 rounded-xl bg-card/15 space-y-2">
                          <span className="text-[9px] font-bold text-accent uppercase tracking-wider">나의 사주 기운</span>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-fg">일주: {fortuneResult.mySaju.dayPillar.kanKorean}{fortuneResult.mySaju.dayPillar.jiKorean}</span>
                            <span className="text-[10px] text-fg-3">
                              목({fortuneResult.mySaju.elementsRatio.wood}%) 화({fortuneResult.mySaju.elementsRatio.fire}%) 토({fortuneResult.mySaju.elementsRatio.earth}%) 금({fortuneResult.mySaju.elementsRatio.metal}%) 수({fortuneResult.mySaju.elementsRatio.water}%)
                            </span>
                          </div>
                        </div>
                        {/* 상대방 사주 */}
                        <div className="p-4 border border-line/40 rounded-xl bg-card/15 space-y-2">
                          <span className="text-[9px] font-bold text-accent uppercase tracking-wider">상대방의 사주 기운</span>
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-bold text-fg">일주: {fortuneResult.partnerSaju.dayPillar.kanKorean}{fortuneResult.partnerSaju.dayPillar.jiKorean}</span>
                            <span className="text-[10px] text-fg-3">
                              목({fortuneResult.partnerSaju.elementsRatio.wood}%) 화({fortuneResult.partnerSaju.elementsRatio.fire}%) 토({fortuneResult.partnerSaju.elementsRatio.earth}%) 금({fortuneResult.partnerSaju.elementsRatio.metal}%) 수({fortuneResult.partnerSaju.elementsRatio.water}%)
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 명리 근거 — 잘 맞는 점 / 조율이 필요한 점 + 오행 보완 */}
                      {fortuneResult.compat && (fortuneResult.compat.positives?.length || fortuneResult.compat.cautions?.length) && (
                        <div className="space-y-3">
                          {fortuneResult.compat.elementComplement != null && (
                            <div className="rounded-xl border border-line/45 bg-card/20 p-3">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-semibold text-fg-2">오행 보완도</span>
                                <span className="font-display font-bold text-accent">{fortuneResult.compat.elementComplement}</span>
                              </div>
                              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-card">
                                <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${fortuneResult.compat.elementComplement}%` }} transition={{ duration: 0.9, ease: "easeOut" }} />
                              </div>
                            </div>
                          )}
                          {fortuneResult.compat.positives && fortuneResult.compat.positives.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {fortuneResult.compat.positives.map((p, i) => (
                                <span key={i} className="rounded-full border border-good/25 bg-good/10 px-2.5 py-1 text-[11px] font-semibold text-good">✓ {p}</span>
                              ))}
                            </div>
                          )}
                          {fortuneResult.compat.cautions && fortuneResult.compat.cautions.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {fortuneResult.compat.cautions.map((c, i) => (
                                <span key={i} className="rounded-full border border-warn/25 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn">⚠ {c}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  )}

                  {/* 사주 전용 결과 디스플레이 */}
                  {activeTab === "saju" && fortuneResult.saju && (
                    <div className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                      {/* 사주 8자 격자 표 */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-fg-3 uppercase tracking-wider">사주 원판 (四柱八字)</h4>
                        <div className="grid grid-cols-4 gap-2 text-center">
                          {/* 열 헤더: 시, 일, 월, 년 */}
                          {["시주", "일주", "월주", "년주"].map((h, i) => (
                            <div key={i} className="text-[10px] font-bold text-fg-3 border-b border-line pb-1">
                              {h}
                            </div>
                          ))}
                          
                          {/* 천간행 */}
                          {[
                            fortuneResult.saju.hourPillar,
                            fortuneResult.saju.dayPillar,
                            fortuneResult.saju.monthPillar,
                            fortuneResult.saju.yearPillar
                          ].map((p, i) => {
                            const col = ELEMENT_COLORS[p.elementKan];
                            return (
                              <div key={i} className={cn("rounded-lg p-2 flex flex-col items-center justify-center border border-line/40", col.bg)}>
                                <span className={cn("text-2xl font-bold font-display", col.text)}>{p.kan}</span>
                                <span className="text-[10px] text-fg-3 mt-0.5">{p.kanKorean} ({p.elementKan})</span>
                              </div>
                            );
                          })}

                          {/* 지지행 */}
                          {[
                            fortuneResult.saju.hourPillar,
                            fortuneResult.saju.dayPillar,
                            fortuneResult.saju.monthPillar,
                            fortuneResult.saju.yearPillar
                          ].map((p, i) => {
                            const col = ELEMENT_COLORS[p.elementJi];
                            return (
                              <div key={i} className={cn("rounded-lg p-2 flex flex-col items-center justify-center border border-line/40", col.bg)}>
                                <span className={cn("text-2xl font-bold font-display", col.text)}>{p.ji}</span>
                                <span className="text-[10px] text-fg-3 mt-0.5">{p.jiKorean} ({p.elementJi})</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* 오행 비율 스펙트럼 바 */}
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold text-fg-3 uppercase tracking-wider">음양오행 강약 비율</h4>
                        <div className="space-y-2.5">
                          {([
                            { key: "wood", label: "목 (Wood)", ratio: fortuneResult.saju.elementsRatio.wood, col: ELEMENT_COLORS["목"] },
                            { key: "fire", label: "화 (Fire)", ratio: fortuneResult.saju.elementsRatio.fire, col: ELEMENT_COLORS["화"] },
                            { key: "earth", label: "토 (Earth)", ratio: fortuneResult.saju.elementsRatio.earth, col: ELEMENT_COLORS["토"] },
                            { key: "metal", label: "금 (Metal)", ratio: fortuneResult.saju.elementsRatio.metal, col: ELEMENT_COLORS["금"] },
                            { key: "water", label: "수 (Water)", ratio: fortuneResult.saju.elementsRatio.water, col: ELEMENT_COLORS["수"] },
                          ]).map((el) => (
                            <div key={el.key} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="font-semibold text-fg-2">{el.label}</span>
                                <span className={cn("font-bold font-display", el.col.text)}>{el.ratio}%</span>
                              </div>
                              {/* 오행 게이지 바 */}
                              <div className="h-2 w-full rounded-full bg-card overflow-hidden">
                                <div 
                                  className={cn("h-full rounded-full transition-all duration-500", el.col.dot)} 
                                  style={{ width: `${el.ratio}%` }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* 세운(歲運) — 올해/내년의 운세 (웹툰 컷 연출) */}
                    {fortuneResult.yearLuck && (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {[fortuneResult.yearLuck.thisYear, fortuneResult.yearLuck.nextYear].map((y, i) => (
                          <motion.div
                            key={y.year}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: i === 1 ? 0.92 : 1, y: 0 }}
                            transition={{ duration: 0.5, delay: 0.1 + i * 0.12, ease: "easeOut" }}
                            className="relative overflow-hidden rounded-2xl p-4"
                            style={{ border: "2px solid var(--char-accent)", background: "var(--char-accent-soft)" }}
                          >
                            {/* 스크린톤(하프톤) */}
                            <span
                              aria-hidden
                              className="pointer-events-none absolute inset-0 opacity-50"
                              style={{ backgroundImage: "radial-gradient(oklch(1 0 0 / 0.06) 1px, transparent 1.4px)", backgroundSize: "7px 7px" }}
                            />
                            {/* 干支 도장 워터마크 */}
                            <span aria-hidden className="pointer-events-none absolute -right-1 -top-2 select-none font-display text-5xl font-black opacity-10" style={{ color: "var(--char-accent)" }}>
                              {y.kanji}
                            </span>
                            <div className="relative">
                              <div className="flex items-center justify-between">
                                <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--char-accent)", color: "var(--color-on-accent)" }}>
                                  {i === 0 ? "올해의 운세 · 세운" : "내년 미리보기"}
                                </span>
                                <span className="text-[10px] text-fg-3">{y.year} {y.kanji}年</span>
                              </div>
                              <div className="mt-1.5 flex items-baseline gap-2">
                                <CountUp value={y.score} className="font-display text-2xl font-extrabold" style={{ color: "var(--char-accent)" }} />
                                <span className="text-sm font-bold text-fg-2">{y.themeName}</span>
                              </div>
                              <p className="mt-1 text-xs leading-relaxed text-fg-3">{y.themeFocus}</p>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    )}
                    </div>
                  )}

                  {/* 타로 전용 결과 디스플레이 — 3카드 스프레드 / 단일 카드 */}
                  {activeTab === "tarot" && fortuneResult.cards && fortuneResult.cards.length > 1 && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-3 gap-3 sm:gap-5">
                        {fortuneResult.cards.map((c, i) => (
                          <div key={i} className="flex flex-col items-center gap-2">
                            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-bold text-accent">{c.position}</span>
                            <motion.div
                              className="w-full max-w-[160px]"
                              style={{ perspective: 1000 }}
                              initial={{ rotateY: 180, scale: 0.7, opacity: 0 }}
                              animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                              transition={{ duration: 0.7, ease: "easeOut", type: "spring", stiffness: 120, damping: 14, delay: i * 0.18 }}
                            >
                              <TarotCardFace card={c} />
                            </motion.div>
                          </div>
                        ))}
                      </div>
                      <p className="text-center text-xs text-fg-3">과거 · 현재 · 미래의 흐름을 {selectedChar.name}가 웹툰으로 풀어드려요.</p>
                    </div>
                  )}
                  {activeTab === "tarot" && fortuneResult.card && (!fortuneResult.cards || fortuneResult.cards.length <= 1) && (
                    <div className="flex flex-col md:flex-row gap-6 items-center">
                      {/* 카드별 고유 디자인의 타로 카드 페이스 — 3D 플립 리빌 */}
                      <motion.div
                        className="w-52 shrink-0"
                        style={{ perspective: 1000 }}
                        initial={{ rotateY: 180, scale: 0.7, opacity: 0 }}
                        animate={{ rotateY: 0, scale: 1, opacity: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut", type: "spring", stiffness: 120, damping: 14 }}
                      >
                        <TarotCardFace card={fortuneResult.card} />
                      </motion.div>

                      {/* 타로 카드 풀이 */}
                      <div className="flex-1 space-y-4 text-left">
                        <div className="space-y-1">
                          <span className="text-[10px] tracking-wider text-accent uppercase font-bold">CARD OVERVIEW</span>
                          <h4 className="text-lg font-bold text-fg">
                            {fortuneResult.card.name} 카드의 수호 메시지
                          </h4>
                        </div>
                        <p className="text-sm leading-relaxed text-fg-3">
                          오늘 당신이 드로우한 <strong>{fortuneResult.card.name}</strong> 카드는 {fortuneResult.card.type === "upright" ? "순리적인 출발과 원활한 조화" : "통제하기 어려운 과잉 혹은 억압 상태"}를 상징합니다.
                          이 기운에 매핑되는 캐릭터 조언을 곱씹으며 오늘 하루 조심스러운 균형을 잡아보시길 바랍니다.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 운세 웹툰 — 캐릭터가 컷·말풍선으로 풀어주는 해석 (음성+애니메이션 재생) */}
                  {fortuneResult.panels && fortuneResult.panels.length > 0 && (
                    <div className="border-t border-line/80 pt-6">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-fg-3">
                          <Sparkle className="h-3.5 w-3.5 text-accent" />
                          <span>{selectedChar.name}의 운세 웹툰</span>
                        </h4>

                        {/* 재생 컨트롤바 */}
                        {playback.supported && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={playback.prev}
                              aria-label="이전 컷"
                              disabled={playback.status === "idle"}
                              className="flex items-center justify-center rounded-full border border-line px-2 py-1.5 text-fg-2 transition-colors hover:bg-card disabled:opacity-40"
                            >
                              <SkipBack className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={handleTogglePlay}
                              className="flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-3 py-1.5 text-[11px] font-bold text-accent transition-colors hover:bg-accent hover:text-on-accent"
                            >
                              {playback.status === "playing" ? (
                                <><Pause className="h-3 w-3" /> 일시정지</>
                              ) : playback.status === "paused" ? (
                                <><Play className="h-3 w-3" /> 이어 보기</>
                              ) : (
                                <><Play className="h-3 w-3" /> 웹툰 재생</>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={playback.next}
                              aria-label="다음 컷"
                              disabled={playback.status === "idle"}
                              className="flex items-center justify-center rounded-full border border-line px-2 py-1.5 text-fg-2 transition-colors hover:bg-card disabled:opacity-40"
                            >
                              <SkipForward className="h-3 w-3" />
                            </button>
                            {playback.status !== "idle" && (
                              <button
                                type="button"
                                onClick={playback.stop}
                                aria-label="정지"
                                className="flex items-center justify-center rounded-full border border-line px-2 py-1.5 text-fg-2 transition-colors hover:bg-card"
                              >
                                <Square className="h-3 w-3" />
                              </button>
                            )}
                            {/* 재생 속도 */}
                            <div className="flex items-center overflow-hidden rounded-full border border-line">
                              {[0.8, 1, 1.3].map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => playback.setSpeed(s)}
                                  className={cn(
                                    "px-2 py-1.5 text-[10px] font-bold transition-colors",
                                    playback.speed === s ? "bg-accent text-on-accent" : "text-fg-3 hover:text-fg"
                                  )}
                                >
                                  {s}×
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 음성 안내 — 아라·레오나만 음성, 그 외 캐릭터는 무음 자막 재생 */}
                      {playback.supported && (
                        <p className="mb-4 flex items-center gap-1.5 text-[11px] text-fg-3">
                          <Volume2 className="h-3.5 w-3.5" />
                          {selectedChar.id === "ara" || selectedChar.id === "leona"
                            ? "유나 보이스로 낭독됩니다."
                            : "이 캐릭터는 아직 음성이 없어 자막으로 재생돼요. (아라·레오나는 음성 지원)"}
                        </p>
                      )}

                      <WebtoonStrip
                        panels={fortuneResult.panels}
                        characters={characters}
                        selectedCharacterId={selectedChar.id}
                        playback={{
                          active: playback.status !== "idle",
                          steps: playback.steps,
                          activeStep: playback.activeStep,
                          activePanel: playback.activePanel,
                          typed: playback.typed,
                        }}
                      />
                    </div>
                  )}

                  {/* 행운의 웹툰/웹소설 추천 영역 */}
                  <div className="border-t border-line/80 pt-6">
                    <h4 className="text-xs font-bold text-fg-3 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Sparkles className="h-3.5 w-3.5 text-accent" />
                      <span>{selectedChar.name}가 당신에게 제안하는 행운의 타이틀</span>
                    </h4>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                      {fortuneResult.recommendations.map((title) => (
                        <TitleCard key={title.id} title={title} size="sm" />
                      ))}
                    </div>
                  </div>

                </div>
              )}

              {/* 입력 폼: 오늘의 운세 */}
              {!isLoading && !fortuneResult && activeTab === "today" && (
                <div className="space-y-6 text-center max-w-md mx-auto w-full py-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-fg">오늘 하루는 어떨까요?</h3>
                    <p className="text-xs text-fg-2 leading-relaxed">
                      생년월일을 입력하면 {selectedChar.name}가 당신의 사주 오행으로 <strong className="text-fg-2">개인화된</strong> 오늘의 운세를 풀어드려요. 같은 날에는 결과가 바뀌지 않아요.
                    </p>
                  </div>

                  {/* 생년월일 입력 (선택) — 입력 시 사주 기반 개인화 */}
                  <div className="rounded-xl border border-line/50 bg-card/15 p-4 text-left space-y-3">
                    <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                      <Calendar className="h-3.5 w-3.5" /> 내 생년월일 (선택 입력 시 개인화)
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label htmlFor="today-birth-date" className="text-[11px] font-semibold text-fg-2">생년월일 (양력)</label>
                        <input
                          id="today-birth-date"
                          type="date"
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="today-birth-time" className="text-[11px] font-semibold text-fg-2">태어난 시간</label>
                        <input
                          id="today-birth-time"
                          type="time"
                          value={birthTime}
                          onChange={(e) => setBirthTime(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card px-3 py-2.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {["none", "male", "female"].map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGender(g)}
                          className={cn(
                            "min-h-10 flex-1 rounded-lg border py-2 text-[11px] font-semibold transition-all",
                            gender === g
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-card text-fg-2 hover:text-fg"
                          )}
                        >
                          {g === "none" ? "선택 안 함" : g === "male" ? "남성" : "여성"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleAnalyzeToday}
                    className="w-full rounded-lg bg-accent py-3.5 text-xs font-bold text-on-accent hover:bg-accent-2 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>{birthDate ? "내 사주로 오늘의 운세 보기" : "오늘의 운세 확인하기"}</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* 입력 폼: 별자리 (생일의 월/일만 사용) */}
              {!isLoading && !fortuneResult && activeTab === "zodiac" && (
                <div className="space-y-6 text-center max-w-md mx-auto w-full py-4">
                  <div className="space-y-2">
                    <h3 className="text-lg font-bold text-fg">생일로 보는 별자리 운세</h3>
                    <p className="text-xs text-fg-2 leading-relaxed">
                      생년월일만 입력하면 {selectedChar.name}가 당신의 별자리와 오늘의 별빛 흐름을 풀어드려요. (월·일만 사용)
                    </p>
                  </div>
                  <div className="rounded-xl border border-line/50 bg-card/15 p-4 text-left space-y-2">
                    <label htmlFor="zodiac-birth-date" className="flex items-center gap-1.5 text-xs font-semibold text-fg-2">
                      <Calendar className="h-3.5 w-3.5 text-fg-3" /> 생년월일
                    </label>
                    <input
                      id="zodiac-birth-date"
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAnalyzeZodiac}
                    disabled={!birthDate}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-3.5 text-xs font-bold text-on-accent transition-colors hover:bg-accent-2 disabled:opacity-50"
                  >
                    <span>{selectedChar.name}에게 별자리 운세 보기</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* 입력 폼: 독서 처방전 */}
              {!isLoading && !fortuneResult && activeTab === "prescription" && (
                <form onSubmit={handleAnalyzePrescription} className="space-y-5 max-w-md mx-auto w-full text-left">
                  <div className="text-center mb-6">
                    <h3 className="text-lg font-bold text-fg">아라의 가상 서재: AI 독서 처방전</h3>
                    <p className="text-xs text-fg-3 mt-1">오늘 당신의 지친 마음이나 보고 싶은 분위기를 적어보세요.</p>
                  </div>
                  
                  <div className="space-y-2">
                    <label htmlFor="prescription-query" className="text-xs font-semibold text-fg-2 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-accent-soft" /> 어떤 이야기가 필요한가요?
                    </label>
                    <textarea
                      id="prescription-query"
                      required
                      rows={4}
                      value={prescriptionQuery}
                      onChange={(e) => setPrescriptionQuery(e.target.value)}
                      placeholder="예: 오늘 회사에서 너무 힘든 일이 있어서 완전 시원하고 통쾌한 사이다 웹툰을 읽으며 스트레스 날려버리고 싶어!"
                      className="w-full rounded-xl border border-line bg-card px-3 py-2.5 text-xs text-fg placeholder:text-fg-4 focus:border-accent focus:outline-none resize-none leading-relaxed"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-4 rounded-lg bg-accent py-3.5 text-xs font-bold text-on-accent hover:bg-accent-2 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>{selectedChar.name}에게 도서 처방받기</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}

              {/* 입력 폼: 궁합 */}
              {!isLoading && !fortuneResult && activeTab === "compatibility" && (
                <form onSubmit={handleAnalyzeCompatibility} className="space-y-5 max-w-md mx-auto w-full text-left">
                  <div className="text-center mb-6">
                    <h3 className="text-lg font-bold text-fg">두 사람의 궁합 분석 정보 입력</h3>
                    <p className="text-xs text-fg-3 mt-1">상대방과의 궁합을 웹툰 콘티 연출 형태로 보여 드립니다.</p>
                  </div>
                  
                  {/* 본인 정보 */}
                  <div className="border border-line/40 rounded-xl p-4 bg-card/10 space-y-3">
                    <span className="text-[10px] font-bold text-accent uppercase tracking-wider">나의 생년월일시</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label htmlFor="my-birth-date" className="text-[11px] font-semibold text-fg-2">생년월일 *</label>
                        <input
                          id="my-birth-date"
                          type="date"
                          required
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="my-birth-time" className="text-[11px] font-semibold text-fg-2">태어난 시간</label>
                        <input
                          id="my-birth-time"
                          type="time"
                          value={birthTime}
                          onChange={(e) => setBirthTime(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 상대방 정보 */}
                  <div className="border border-line/40 rounded-xl p-4 bg-card/10 space-y-3">
                    <span className="text-[10px] font-bold text-accent uppercase tracking-wider">상대방의 생년월일시</span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label htmlFor="partner-birth-date" className="text-[11px] font-semibold text-fg-2">생년월일 *</label>
                        <input
                          id="partner-birth-date"
                          type="date"
                          required
                          value={partnerBirthDate}
                          onChange={(e) => setPartnerBirthDate(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="partner-birth-time" className="text-[11px] font-semibold text-fg-2">태어난 시간</label>
                        <input
                          id="partner-birth-time"
                          type="time"
                          value={partnerBirthTime}
                          onChange={(e) => setPartnerBirthTime(e.target.value)}
                          className="w-full rounded-lg border border-line bg-card px-3 py-1.5 text-xs text-fg focus:border-accent focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-6 rounded-lg bg-accent py-3.5 text-xs font-bold text-on-accent hover:bg-accent-2 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>{selectedChar.name}에게 궁합 풀이받기 (웹툰 연출형)</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}

              {/* 입력 폼: 사주 */}
              {!isLoading && !fortuneResult && activeTab === "saju" && (
                <form onSubmit={handleAnalyzeSaju} className="space-y-5 max-w-md mx-auto w-full text-left">
                  <div className="text-center mb-6">
                    <h3 className="text-lg font-bold text-fg">사주팔자 분석 정보 입력</h3>
                    <p className="text-xs text-fg-3 mt-1">정확한 연산을 위해 생년월일시를 입력하세요.</p>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label htmlFor="birth-date" className="text-xs font-semibold text-fg-2 flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-fg-3" /> 생년월일 (양력 기준)
                    </label>
                    <input
                      id="birth-date"
                      type="date"
                      required
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                      className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="birth-time" className="text-xs font-semibold text-fg-2 flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-fg-3" /> 태어난 시간 (선택사항)
                    </label>
                    <input
                      id="birth-time"
                      type="time"
                      value={birthTime}
                      onChange={(e) => setBirthTime(e.target.value)}
                      className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-fg-2 flex items-center gap-1">
                      <User className="h-3.5 w-3.5 text-fg-3" /> 성별 (선택사항)
                    </div>
                    <div className="flex gap-2">
                      {["none", "male", "female"].map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGender(g)}
                          className={cn(
                            "flex-1 rounded-lg border py-2 text-xs font-semibold transition-all",
                            gender === g
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-line bg-card text-fg-3 hover:text-fg"
                          )}
                        >
                          {g === "none" ? "선택 안 함" : g === "male" ? "남성" : "여성"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full mt-6 rounded-lg bg-accent py-3 text-xs font-bold text-on-accent hover:bg-accent-2 transition-colors flex items-center justify-center gap-2"
                  >
                    <span>{selectedChar.name}에게 사주 풀이받기</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </form>
              )}

              {/* 인터랙션: 타로 */}
              {!isLoading && !fortuneResult && activeTab === "tarot" && (
                <div className="space-y-6 text-center max-w-lg mx-auto w-full">
                  {tarotStep === "idle" && (
                    <div className="py-10 space-y-4">
                      <h3 className="text-lg font-bold text-fg">오늘의 타로 리딩</h3>
                      <p className="text-xs text-fg-3 max-w-sm mx-auto leading-relaxed">
                        정신을 집중하고 카드를 섞은 뒤, 오늘의 조언을 줄 카드를 직접 뽑아보세요.
                      </p>
                      {/* 스프레드 선택 — 1장 / 3장(과거·현재·미래) */}
                      <div className="mx-auto flex max-w-xs items-center overflow-hidden rounded-full border border-line">
                        {([
                          { key: "one", label: "1장 뽑기" },
                          { key: "three", label: "3장 (과거·현재·미래)" },
                        ] as const).map((s) => (
                          <button
                            key={s.key}
                            type="button"
                            onClick={() => setTarotSpread(s.key)}
                            className={cn(
                              "flex-1 py-2 text-[11px] font-bold transition-colors",
                              tarotSpread === s.key ? "bg-accent text-on-accent" : "text-fg-3 hover:text-fg"
                            )}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={startTarotShuffle}
                        className="rounded-lg bg-accent px-6 py-2.5 text-xs font-bold text-on-accent hover:bg-accent-2 transition-colors"
                      >
                        타로 카드 섞기 시작
                      </button>
                    </div>
                  )}

                  {/* 셔플링 애니메이션 */}
                  {tarotStep === "shuffling" && (
                    <div className="py-16 space-y-6">
                      <div className="flex justify-center items-center gap-3">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            animate={{
                              x: [0, (i - 1) * 60, 0],
                              y: [0, -10, 0],
                              scale: [1, 1.05, 1],
                              rotate: [0, (i - 1) * 15, 0]
                            }}
                            transition={{
                              duration: 1.2,
                              repeat: Infinity,
                              ease: "easeInOut"
                            }}
                            className="w-24 aspect-[2/3] rounded-xl border border-amber-500/20 bg-cover bg-center shadow-md"
                            style={{ backgroundImage: `url('${resolveAssetUrl("/images/tarot/tarot-back.jpg")}')` }}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-fg-3 animate-pulse">카드를 엄숙히 섞고 있습니다...</p>
                    </div>
                  )}

                  {/* 카드 드로우 선택 단계 */}
                  {tarotStep === "spread" && (
                    <div className="py-8 space-y-6">
                      <h3 className="text-sm font-bold text-fg-2">오늘의 대답을 전해줄 카드를 한 장 터치하세요.</h3>
                      <div className="flex justify-center gap-4">
                        {[0, 1, 2].map((idx) => (
                          <motion.button
                            key={idx}
                            type="button"
                            whileHover={{ y: -10, scale: 1.03 }}
                            onClick={() => handleSelectTarotCard(idx)}
                            className="w-28 cursor-pointer aspect-[2/3] rounded-xl border border-amber-500/20 bg-cover bg-center flex items-center justify-center relative overflow-hidden shadow-lg transition-all hover:border-amber-400 focus:outline-none"
                            style={{ backgroundImage: `url('${resolveAssetUrl("/images/tarot/tarot-back.jpg")}')` }}
                          >
                            {/* 카드 뒷면에 호버 시 미세한 골드 이펙트 오버레이 */}
                            <div className="absolute inset-0 bg-black/10 hover:bg-transparent transition-colors" />
                          </motion.button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </div>
          </main>

        </div>
      )}

      {/* 결과 공유·저장 모달 */}
      {shareOpen && fortuneResult && selectedChar && (
        <FortuneShareModal
          result={fortuneResult}
          character={selectedChar}
          tab={activeTab}
          onClose={() => setShareOpen(false)}
        />
      )}

      {/* 법적 면책 조항 및 자체 캐릭터 안내문 (Disclaimer) */}
      <footer className="mt-16 border-t border-line/40 pt-6 text-center max-w-2xl mx-auto space-y-2">
        <p className="text-[10px] text-fg-3 leading-relaxed">
          <strong>법적 고지 (Disclaimer)</strong>: 본 운세 서비스는 가벼운 엔터테인먼트와 도서 큐레이션을 목적으로 제공됩니다. 
          풀이 내용 및 행운 지수는 인공지능 기반 가상의 결과이며 법적·과학적 효력을 지니지 않습니다.
        </p>
        <p className="text-[10px] text-fg-3 leading-relaxed">
          본 서비스에 등장하는 에이전트(사서 아라, 도깨비 단우, 점술가 레오나, 검객 가온)는 ToonSpectrum이 독자적으로 기획·창작한 고유 캐릭터이며, 
          특정 실존 인물, 단체 또는 타사 웹툰 저작물과 무관합니다.
        </p>
      </footer>
    </div>
    </MotionConfig>
  );
}
