/**
 * StudioWebtoonCelShadePanel.tsx
 *
 * Professional Webtoon Cel-Shading & Skin Tone Harmony Panel.
 * Benchmarks: Naver Webtoon AI Painter, Clip Studio Paint color sets, and Korean webtoon coloring studios.
 * - Algorithmic 6-step Comic Hue-Shift Shadow: Prevents dirty muddy gray shadows by rotating hue toward cool indigo.
 * - 5 Archetypal Character Skin Tone presets with highlight, base, and 1st/2nd cel shadows.
 */

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";

import {
  generateWebtoonCelShading,
  type WebtoonCelShadeResult,
} from "./studio-color-harmony-engine";

export interface StudioWebtoonCelShadePanelProps {
  readonly value: string;
  readonly onSelectColor: (hex: string) => void;
  readonly onSaveAsPalette?: (name: string, colors: string[]) => void;
}

interface SkinPreset {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly colors: readonly string[];
}

const WEBTOON_CHARACTER_SKIN_PRESETS: readonly SkinPreset[] = [
  {
    id: "warm-fair",
    name: "웜톤 주인공 (표준)",
    role: "화사한 살구빛 피부",
    colors: ["#fffbf5", "#ffedd5", "#fbcfe8", "#e0b0d5", "#fb7185"],
  },
  {
    id: "cool-pale",
    name: "쿨톤 창백 (로판 남주)",
    role: "북부대공·뱀파이어",
    colors: ["#f8fafc", "#f1f5f9", "#cbd5e1", "#94a3b8", "#f472b6"],
  },
  {
    id: "blush-peach",
    name: "생기 피치 (히로인)",
    role: "청순 복숭아빛 홍조",
    colors: ["#fff1f2", "#ffe4e6", "#fecdd3", "#fda4af", "#f43f5e"],
  },
  {
    id: "sun-tan",
    name: "구릿빛 태닝 (액션)",
    role: "건강미 액션·스포츠",
    colors: ["#fed7aa", "#f97316", "#c2410c", "#7c2d12", "#ea580c"],
  },
  {
    id: "dark-rich",
    name: "다크 엘프 (판타지)",
    role: "윤기 있는 깊은 갈색톤",
    colors: ["#a8a29e", "#78716c", "#44403c", "#1c1917", "#991b1b"],
  },
];

export function StudioWebtoonCelShadePanel({
  value,
  onSelectColor,
  onSaveAsPalette,
}: StudioWebtoonCelShadePanelProps) {
  const [subTab, setSubTab] = useState<"hue-shift" | "skin-tones">("hue-shift");
  const [savedBadge, setSavedBadge] = useState<string | null>(null);

  const celShades: WebtoonCelShadeResult = generateWebtoonCelShading(value);

  const celShadeSteps = [
    { label: "하이라이트", hex: celShades.highlight, desc: "따뜻한 광원 (-12°)", badge: "난색광" },
    { label: "밑색 (현재)", hex: celShades.base, desc: "기본 지정색", badge: "기준" },
    { label: "1차 음영", hex: celShades.celShadow1, desc: "쿨톤 쉬프트 (+25°)", badge: "쿨인디고" },
    { label: "2차 딥음영", hex: celShades.celShadow2, desc: "깊은 음영 (+42°)", badge: "딥섀도" },
    { label: "생기 틴트", hex: celShades.blushTint, desc: "홍조·틴트", badge: "생기" },
    { label: "림라이트", hex: celShades.rimLight, desc: "외곽 역광", badge: "하이빔" },
  ];

  const handleSaveShadePalette = () => {
    const name = `만화 음영 세트 (${value})`;
    const colors = celShadeSteps.map((s) => s.hex);
    onSaveAsPalette?.(name, colors);
    setSavedBadge("음영 세트 저장됨!");
    setTimeout(() => setSavedBadge(null), 1800);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* Subtab Toggle */}
      <div
        role="tablist"
        aria-label="웹툰 채색 모드"
        className="flex rounded-xl border border-line/70 bg-raised/50 p-1 backdrop-blur-sm"
      >
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "hue-shift"}
          aria-label="쿨톤 음영 자동 생성기"
          onClick={() => setSubTab("hue-shift")}
          className={`flex-1 rounded-lg py-1 text-[0.65rem] font-medium transition-all ${
            subTab === "hue-shift"
              ? "bg-card text-accent font-semibold shadow-sm border border-accent/40"
              : "text-fg-3 hover:text-fg-1"
          }`}
        >
          쿨톤 음영 생성기
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={subTab === "skin-tones"}
          aria-label="인물 피부톤 프리셋"
          onClick={() => setSubTab("skin-tones")}
          className={`flex-1 rounded-lg py-1 text-[0.65rem] font-medium transition-all ${
            subTab === "skin-tones"
              ? "bg-card text-accent font-semibold shadow-sm border border-accent/40"
              : "text-fg-3 hover:text-fg-1"
          }`}
        >
          인물 피부톤 프리셋
        </button>
      </div>

      {subTab === "hue-shift" ? (
        <div className="flex flex-col gap-2">
          {/* Continuous Tone Ribbon preview */}
          <div className="flex items-center justify-between px-0.5">
            <span className="text-[0.64rem] font-medium text-fg-2">
              맑은 음영 색상환 회전 (탁한 회색 방지)
            </span>
            <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[0.56rem] font-mono font-bold text-accent">
              Anti-Muddy
            </span>
          </div>

          <div className="relative overflow-hidden rounded-lg border border-line/60 p-1 bg-raised/40">
            <div
              className="h-2 w-full rounded-md shadow-inner"
              style={{
                background: `linear-gradient(to right, ${celShades.highlight}, ${celShades.base}, ${celShades.celShadow1}, ${celShades.celShadow2}, ${celShades.blushTint}, ${celShades.rimLight})`,
              }}
            />
          </div>

          <div
            className="grid grid-cols-3 gap-1.5"
            role="radiogroup"
            aria-label="웹툰 음영 단계 목록"
          >
            {celShadeSteps.map((step) => {
              const isSelected = step.hex.toLowerCase() === value.toLowerCase();
              return (
                <button
                  key={step.label}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={`${step.label} ${step.hex} 선택`}
                  onClick={() => onSelectColor(step.hex)}
                  className={`flex flex-col items-center gap-1 rounded-xl border p-1.5 transition-all duration-150 hover:-translate-y-0.5 active:scale-95 ${
                    isSelected
                      ? "border-accent bg-accent-soft/35 ring-1 ring-accent shadow-sm"
                      : "border-line/70 bg-card/60 hover:bg-card hover:border-line-strong"
                  }`}
                >
                  <div className="flex items-center justify-between w-full px-0.5">
                    <span className="text-[0.56rem] font-semibold text-fg-2">{step.label}</span>
                    <span className="text-[0.48rem] font-mono text-fg-3">{step.badge}</span>
                  </div>

                  <div
                    className="relative size-8 rounded-lg border border-white/20 shadow-inner"
                    style={{ backgroundColor: step.hex }}
                  >
                    {isSelected && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <Check className="size-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]" />
                      </span>
                    )}
                  </div>

                  <span className="font-mono text-[0.58rem] font-medium text-fg-2">{step.hex}</span>
                </button>
              );
            })}
          </div>

          {onSaveAsPalette && (
            <button
              type="button"
              aria-label="이 음영 세트를 내 팔레트로 저장"
              onClick={handleSaveShadePalette}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-1.5 text-[0.66rem] font-semibold text-accent transition-all hover:bg-accent/20 hover:border-accent/60 active:scale-[0.98] shadow-sm"
            >
              <Sparkles className="size-3" aria-hidden />
              {savedBadge ? "음영 세트를 저장했어요!" : "이 음영 세트를 내 팔레트로 저장"}
            </button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[0.64rem] text-fg-3 px-0.5">
            웹툰 연재 스튜디오에서 검증된 5대 캐릭터 피부 톤입니다.
          </p>
          <div className="space-y-1.5">
            {WEBTOON_CHARACTER_SKIN_PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="flex flex-col gap-1.5 rounded-xl border border-line/80 bg-card/60 p-2 transition-colors hover:border-line-strong hover:bg-card"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[0.66rem] font-semibold text-fg-1">{preset.name}</span>
                  <span className="rounded bg-raised px-1.5 py-0.5 text-[0.56rem] text-fg-3">{preset.role}</span>
                </div>
                <div
                  className="flex items-center gap-1.5"
                  role="radiogroup"
                  aria-label={`${preset.name} 피부톤 색상`}
                >
                  {preset.colors.map((hex, i) => {
                    const isSelected = hex.toLowerCase() === value.toLowerCase();
                    const stageNames = ["하이라이트", "베이스", "1차 음영", "2차 음영", "틴트"];
                    return (
                      <button
                        key={`${hex}-${i}`}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`${preset.name} ${stageNames[i] ?? ""} ${hex} 선택`}
                        onClick={() => onSelectColor(hex)}
                        className={`flex-1 h-7 rounded-lg border border-white/20 shadow-sm transition-all hover:scale-105 active:scale-95 ${
                          isSelected ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : ""
                        }`}
                        style={{ backgroundColor: hex }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
