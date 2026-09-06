/**
 * Studio Channel Mixer Panel
 * 선택된 이미지의 채널 믹서(Channel Mixer) 보정 인스펙터 — 원클릭 프리셋 + 흑백 토글 +
 * 출력 채널별(빨강/초록/파랑, 또는 흑백 시 회색) R·G·B 소스 가중치와 상수 슬라이더.
 * studio-channel-mixer 엔진의 ChannelMixer를 props로 읽고 onPatch/onApplyPreset/onReset으로만 쓴다.
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음).
 */
import { RotateCcw } from "lucide-react";

import {
  CHANNEL_MIXER_CONST_RANGE,
  CHANNEL_MIXER_GAIN_RANGE,
  CHANNEL_MIXER_PRESETS,
  isIdentityChannelMixer,
  type ChannelMixer,
  type MixerChannel,
} from "./studio-channel-mixer";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다(가중치 -2..2·상수 -1..1, 소수 2자리 수용).
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-9 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// 한 출력 채널 안의 슬라이더 4줄 — 소스 가중치 3개(가중치 범위)와 상수 1개(상수 범위).
// gain은 r·g·b 소스 비중, constant는 0..255 기준 오프셋(소수 2자리로 표시).
const MIXER_ROWS: { key: keyof MixerChannel; label: string; constant?: boolean }[] = [
  { key: "r", label: "빨강 소스" },
  { key: "g", label: "초록 소스" },
  { key: "b", label: "파랑 소스" },
  { key: "constant", label: "상수", constant: true },
];

// 출력 채널 정의 — 표시 순서·한글 라벨. 흑백 모드에서는 회색(value.red) 한 줄만, 아니면 빨강/초록/파랑 세 줄.
const OUTPUT_SECTIONS: { channel: keyof ChannelMixer & ("red" | "green" | "blue"); label: string }[] = [
  { channel: "red", label: "출력 빨강" },
  { channel: "green", label: "출력 초록" },
  { channel: "blue", label: "출력 파랑" },
];

export function StudioChannelMixerPanel({
  value,
  onPatch,
  onApplyPreset,
  onReset,
}: {
  value: ChannelMixer;
  onPatch: (patch: Partial<ChannelMixer>) => void;
  onApplyPreset: (mixer: ChannelMixer) => void;
  onReset: () => void;
}): React.ReactElement {
  // 항등(흑백 아님 + 세 채널 모두 자기 자신 1배)이면 리셋 비활성 + "기본" 프리셋 칩을 활성으로 표시.
  const isIdentity = isIdentityChannelMixer(value);

  // 흑백 모드면 빨강 행(value.red)을 회색 공식으로 단독 노출, 아니면 출력 R·G·B 세 채널을 노출한다.
  const sections: { channel: keyof ChannelMixer & ("red" | "green" | "blue"); label: string }[] = value.monochrome
    ? [{ channel: "red", label: "회색(Gray)" }]
    : OUTPUT_SECTIONS;

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">채널 믹서 (Channel Mixer)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="채널 믹서를 제거하고 원본 채널로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 채널 혼합 프리셋 칩 — 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {CHANNEL_MIXER_PRESETS.map((preset) => {
          const active = preset.id === "identity" && isIdentity;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset.mixer)}
              title={preset.tip}
              className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 흑백 토글 — 켜면 빨강 행으로 회색값을 구해 R=G=B에 똑같이 넣는다(green/blue 무시). */}
      <label className={LABEL_ROW}>
        흑백(Monochrome)
        <input
          type="checkbox"
          checked={value.monochrome}
          onChange={(e) => onPatch({ monochrome: e.target.checked })}
          className="size-3.5 accent-accent cursor-pointer"
        />
      </label>

      {/* 출력 채널별 소스 가중치(r·g·b)와 상수 슬라이더 — 범위는 가중치/상수 RANGE에서. */}
      {sections.map(({ channel, label }) => (
        <div key={channel} className="space-y-1.5">
          <p className="text-[0.66rem] font-semibold text-fg-2">{label}</p>
          {MIXER_ROWS.map(({ key, label: rowLabel, constant }) => {
            const range = constant ? CHANNEL_MIXER_CONST_RANGE : CHANNEL_MIXER_GAIN_RANGE;
            const current = value[channel][key];
            return (
              <label key={key} className={LABEL_ROW}>
                {rowLabel}
                <span className="flex items-center gap-1.5">
                  <input
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={current}
                    onChange={(e) =>
                      // 해당 키만 바꾼 새 채널 객체를 불변으로 만들어 그 출력 채널만 패치한다.
                      onPatch({
                        [channel]: { ...value[channel], [key]: Number(e.target.value) } as MixerChannel,
                      } as Partial<ChannelMixer>)
                    }
                    className={RANGE_CLASS}
                  />
                  <span className={READOUT_CLASS}>{current.toFixed(2)}</span>
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}
