import { Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";

import { MiniPoster } from "./rank-row";
import { ONBOARDING_GENRES } from "./recommend-view-types";

import type { Title } from "@/shared/lib/types";

import { genreColor } from "@/shared/lib/genre-color";
import { cn } from "@/shared/lib/utils";

export interface RecommendOnboardingProps {
  initialGenres: string[];
  popular: Title[];
  onComplete: (
    selectedGenres: string[],
    selectedTitles: string[],
    selectedFormat: "all" | "webtoon" | "webnovel",
    selectedStatus: "all" | "ongoing" | "completed"
  ) => void;
  onCancel: () => void;
}

export function RecommendOnboarding({
  initialGenres,
  popular,
  onComplete,
  onCancel,
}: RecommendOnboardingProps) {
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(initialGenres);
  const [selectedTitles, setSelectedTitles] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<"all" | "webtoon" | "webnovel">("all");
  const [selectedStatus, setSelectedStatus] = useState<"all" | "ongoing" | "completed">("all");

  const onboardingTitles = popular.slice(0, 12);

  const handleComplete = () => {
    onComplete(selectedGenres, selectedTitles, selectedFormat, selectedStatus);
  };

  return (
    <div className="rounded-2xl border border-line bg-panel/75 p-6 sm:p-8 max-w-2xl mx-auto my-6 space-y-6 shadow-xl relative overflow-hidden backdrop-blur-md animate-fade-in">
      {/* Progress Bar */}
      <div className="flex items-center justify-between text-xs text-fg-3">
        <span className="font-semibold text-accent flex items-center gap-1">
          <Sparkles size={13} />
          10초 취향 온보딩 테스트
        </span>
        <span>Step {onboardingStep} of 3</span>
      </div>
      <div className="h-1.5 w-full bg-line/40 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent transition-all duration-300"
          style={{ width: `${(onboardingStep / 3) * 100}%` }}
        />
      </div>

      {onboardingStep === 1 && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight">좋아하는 장르를 2개 이상 선택해주세요 📚</h2>
            <p className="text-xs text-fg-3">선호도에 맞게 맞춤 명작을 다이나믹하게 매핑하여 골라 드립니다.</p>
          </div>
          
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ONBOARDING_GENRES.map((g) => {
              const selected = selectedGenres.includes(g);
              const color = genreColor(g);
              return (
                <button
                  key={g}
                  type="button"
                  onClick={() => {
                    setSelectedGenres((prev) =>
                      prev.includes(g) ? prev.filter((item) => item !== g) : [...prev, g]
                    );
                  }}
                  style={{
                    borderColor: selected ? color : undefined,
                    backgroundColor: selected ? `${color}18` : undefined,
                    boxShadow: selected ? `0 0 12px -3px ${color}40` : undefined,
                  }}
                  className={cn(
                    "rounded-xl border border-line bg-card p-3 text-sm font-semibold transition-all hover:bg-raised/85 cursor-pointer flex items-center justify-center h-12",
                    selected ? "text-fg font-bold" : "text-fg-2 hover:border-line-strong"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
                    {g}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex justify-between pt-4 border-t border-line/45">
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center rounded-xl border border-line bg-card px-5 py-2.5 text-xs font-semibold text-fg-2 hover:bg-raised cursor-pointer transition-all"
              >
                닫기
              </button>
            ) : <div />}
            <button
              type="button"
              disabled={selectedGenres.length < 2}
              onClick={() => setOnboardingStep(2)}
              className="inline-flex items-center justify-center rounded-xl bg-accent px-6 py-2.5 text-xs font-semibold text-on-accent shadow-md hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              다음 단계로
            </button>
          </div>
        </div>
      )}

      {onboardingStep === 2 && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight">재미있게 보았거나 좋아하는 작품을 골라주세요 🌟</h2>
            <p className="text-xs text-fg-3">선택한 명작과 유사한 결의 숨겨진 작품들이 가중 추천됩니다. (없으면 바로 넘어가실 수 있습니다)</p>
          </div>
          
          {onboardingTitles.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 max-h-[300px] overflow-y-auto pr-1">
              {onboardingTitles.map((t) => {
                const selected = selectedTitles.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTitles((prev) =>
                        prev.includes(t.id) ? prev.filter((id) => id !== t.id) : [...prev, t.id]
                      );
                    }}
                    className={cn(
                      "relative flex flex-col items-center p-2 rounded-xl border bg-card transition-all hover:scale-[1.02] cursor-pointer",
                      selected
                        ? "border-accent bg-accent-soft/30 ring-2 ring-accent/10"
                        : "border-line"
                    )}
                  >
                    <MiniPoster title={t} className="w-14 aspect-[3/4] rounded shadow-sm" />
                    <span className="mt-1.5 block text-[0.65rem] font-semibold text-fg text-center line-clamp-1 w-full px-1">
                      {t.title}
                    </span>
                    {selected && (
                      <span className="absolute top-1.5 right-1.5 bg-accent text-on-accent rounded-full size-4 flex items-center justify-center text-[10px] font-bold shadow">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-fg-3 py-10 text-center">선택 가능한 작품 데이터를 조회하고 있습니다...</p>
          )}

          <div className="flex justify-between pt-4 border-t border-line/45">
            <button
              type="button"
              onClick={() => setOnboardingStep(1)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-card px-5 py-2.5 text-xs font-semibold text-fg-2 hover:bg-raised cursor-pointer transition-all"
            >
              이전으로
            </button>
            <button
              type="button"
              onClick={() => setOnboardingStep(3)}
              className="inline-flex items-center justify-center rounded-xl bg-accent px-6 py-2.5 text-xs font-semibold text-on-accent shadow-md hover:bg-accent/90 cursor-pointer transition-all"
            >
              {selectedTitles.length > 0 ? "다음 단계로" : "선택 없이 건너뛰기"}
            </button>
          </div>
        </div>
      )}

      {onboardingStep === 3 && (
        <div className="space-y-5">
          <div className="space-y-1">
            <h2 className="text-xl font-bold tracking-tight">마지막으로, 감상 취향을 입력해주세요 ⚙️</h2>
            <p className="text-xs text-fg-3">원하는 형식과 연재 형태를 조율하여 정밀한 리스트를 완성합니다.</p>
          </div>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <span className="block text-xs font-semibold text-fg-3">선호 포맷</span>
              <div className="flex gap-2">
                {[
                  { value: "all", label: "웹툰 & 웹소설" },
                  { value: "webtoon", label: "웹툰만" },
                  { value: "webnovel", label: "웹소설만" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedFormat(opt.value as "all" | "webtoon" | "webnovel")}
                    className={cn(
                      "flex-1 rounded-xl border p-3 text-xs font-semibold transition-all cursor-pointer",
                      selectedFormat === opt.value
                        ? "border-accent bg-accent-soft/30 text-accent shadow-sm"
                        : "border-line bg-card text-fg-2 hover:bg-raised"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-semibold text-fg-3">선호 상태</span>
              <div className="flex gap-2">
                {[
                  { value: "all", label: "전체 상태" },
                  { value: "completed", label: "정주행 완결작" },
                  { value: "ongoing", label: "실시간 연재작" },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSelectedStatus(opt.value as "all" | "ongoing" | "completed")}
                    className={cn(
                      "flex-1 rounded-xl border p-3 text-xs font-semibold transition-all cursor-pointer",
                      selectedStatus === opt.value
                        ? "border-accent bg-accent-soft/30 text-accent shadow-sm"
                        : "border-line bg-card text-fg-2 hover:bg-raised"
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4 border-t border-line/45">
            <button
              type="button"
              onClick={() => setOnboardingStep(2)}
              className="inline-flex items-center justify-center rounded-xl border border-line bg-card px-5 py-2.5 text-xs font-semibold text-fg-2 hover:bg-raised cursor-pointer transition-all"
            >
              이전으로
            </button>
            <button
              type="button"
              onClick={handleComplete}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-accent px-6 py-2.5 text-xs font-bold text-on-accent shadow-lg hover:bg-accent/90 cursor-pointer transition-all animate-pulse-soft"
            >
              <Wand2 size={13} />
              취향 분석 완료 및 추천받기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
