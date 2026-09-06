/**
 * Studio Color Balance Panel
 * 선택된 이미지의 색상 균형(Color Balance) 보정 인스펙터 — 원클릭 톤 프리셋 +
 * 그림자/중간톤/하이라이트별 R·G·B 슬라이더.
 * studio-color-balance 엔진의 ColorBalance를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  COLOR_BALANCE_PRESETS,
  COLOR_BALANCE_RANGE,
  isIdentityColorBalance,
  type ColorBalance,
  type RgbShift,
} from "./studio-color-balance";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다(-100..100 수용).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 톤 영역(그림자/중간톤/하이라이트) 정의 — 표시 순서·한글 라벨.
const TONE_SECTIONS: { tone: keyof ColorBalance; label: string }[] = [
  { tone: "shadows", label: "그림자" },
  { tone: "midtones", label: "중간톤" },
  { tone: "highlights", label: "하이라이트" },
];

// 각 톤 영역의 R·G·B 채널 정의 — 채널 인덱스·양끝 한글 라벨(음수↔양수 방향).
const CHANNEL_ROWS: { channel: number; label: string }[] = [
  { channel: 0, label: "빨강 ↔ 청록" },
  { channel: 1, label: "초록 ↔ 자홍" },
  { channel: 2, label: "파랑 ↔ 노랑" },
];

export function StudioColorBalancePanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: ColorBalance;
  onPatch: (patch: Partial<ColorBalance>) => void;
  onApplyPreset: (balance: ColorBalance) => void;
  onReset: () => void;
}): React.ReactElement {
  // 세 영역 전부 0(보정 없음)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityColorBalance(value);

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">컬러 밸런스 (Color Balance)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="컬러 밸런스를 제거하고 원본 색감으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 색감 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {COLOR_BALANCE_PRESETS.map((preset) => {
          const active = preset.id === "neutral" && isIdentity;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.balance)}
              title={preset.tip}
              className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 그림자/중간톤/하이라이트 톤 영역별 R·G·B 슬라이더 — 범위는 COLOR_BALANCE_RANGE에서. */}
      {TONE_SECTIONS.map(({ tone, label }) => (
        <div key={tone} className="space-y-1.5">
          <p className="text-[0.66rem] font-semibold text-fg-2">{label}</p>
          {CHANNEL_ROWS.map(({ channel, label: channelLabel }) => {
            const current = value[tone][channel] ?? 0;
            return (
              <label key={channel} className={LABEL_ROW}>
                {channelLabel}
                <span className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={COLOR_BALANCE_RANGE.min}
                    max={COLOR_BALANCE_RANGE.max}
                    step={COLOR_BALANCE_RANGE.step}
                    value={current}
                    onChange={(e) => {
                      // 해당 채널만 바꾼 새 R·G·B 트리플을 불변으로 만들어 패치한다.
                      const n = Number(e.target.value);
                      const next = [...value[tone]] as RgbShift;
                      next[channel] = n;
                      onPatch({ [tone]: next } as Partial<ColorBalance>);
                    }}
                    className={RANGE_CLASS}
                  />
                  <span className={READOUT_CLASS}>{current}</span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
