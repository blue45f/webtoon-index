/**
 * Studio Levels Panel
 * 선택된 이미지의 레벨(Levels) 보정 인스펙터 — 채널 세그먼트(RGB/R/G/B) + 원클릭 톤 프리셋 +
 * 입력/감마/출력 슬라이더. studio-levels 엔진의 LevelsParams(마스터)와 LevelsRgbChannels(r/g/b)를
 * props로 읽고 onPatch/onChannelsChange/onApplyPreset/onReset으로만 쓴다.
 * onChannelsChange가 없으면 채널 UI를 숨긴다(하위호환). 로컬 상태는 편집 채널(channel) 하나뿐.
 * histogramSource(선택 이미지 디코드 픽셀)가 주어지면 슬라이더 위에 히스토그램을 그린다 —
 * 없으면 기존과 완전히 동일하게 렌더된다(하위호환).
 */
import { RotateCcw } from "lucide-react";
import { useState } from "react";

import { TONE_CHANNELS, type ToneChannel } from "./studio-curves";
import {
  DEFAULT_LEVELS,
  isIdentityLevels,
  isIdentityLevelsChannels,
  LEVELS_PRESETS,
  LEVELS_RANGES,
  normalizeLevelsChannels,
  type LevelsParams,
  type LevelsRgbChannels,
} from "./studio-levels";
import { StudioPanelChip, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import { StudioHistogramSection } from "./StudioHistogramGraph";

import type { StudioImageDataLike } from "./studio-filters";

import { buttonClass } from "@/shared/components/ui/button-utils";


// 슬라이더 정의 — 표시 순서·한글 라벨·readout 포맷(감마만 소수 2자리, 나머지는 정수).
const LEVELS_SLIDERS: { key: keyof LevelsParams; label: string; gamma?: boolean }[] = [
  { key: "blackPoint", label: "입력 검정" },
  { key: "whitePoint", label: "입력 흰색" },
  { key: "gamma", label: "감마 (중간톤)", gamma: true },
  { key: "outBlack", label: "출력 검정" },
  { key: "outWhite", label: "출력 흰색" },
];

export function StudioLevelsPanel({
  value,
  channels,
  histogramSource,
  onPatch,
  onChannelsChange,
  onApplyPreset,
  onReset,
}: {
  value: LevelsParams;
  /** r/g/b 개별 채널 레벨(마스터는 value). 미지정이면 전 채널 항등으로 본다. */
  channels?: LevelsRgbChannels;
  /**
   * 선택 이미지의 디코드 픽셀 — 지정된 경우에만 슬라이더 위에 히스토그램을 그린다
   * (마스터=휘도, r/g/b=해당 채널 분포). 미지정/null이면 기존 렌더와 동일.
   */
  histogramSource?: StudioImageDataLike | null;
  onPatch: (patch: Partial<LevelsParams>) => void;
  /** 채널 레벨 변경 콜백 — 지정된 경우에만 채널 세그먼트 UI를 노출한다. */
  onChannelsChange?: (channels: LevelsRgbChannels) => void;
  onApplyPreset: (params: LevelsParams) => void;
  onReset: () => void;
}): React.ReactElement {
  // 편집 중인 채널 — master=RGB 전체. 채널 편집이 꺼져 있으면 항상 master.
  const [channel, setChannel] = useState<ToneChannel>("master");
  const channelEditable = typeof onChannelsChange === "function";
  const activeChannel: ToneChannel = channelEditable ? channel : "master";

  // 채널별 정규화 파라미터와 항등 여부 — 세그먼트 점 배지·프리셋 활성·리셋 버튼 활성화에 쓴다.
  const channelParams = normalizeLevelsChannels(channels);
  const identityByChannel: Record<ToneChannel, boolean> = {
    master: isIdentityLevels(value),
    r: isIdentityLevels(channelParams.r),
    g: isIdentityLevels(channelParams.g),
    b: isIdentityLevels(channelParams.b),
  };
  const allIdentity = identityByChannel.master && isIdentityLevelsChannels(channels);

  // 지금 편집 중인 채널의 파라미터와 슬라이더 패치 라우팅 —
  // master는 onPatch(기존), r/g/b는 raw 부분값으로 저장하고 읽을 때 normalize한다(마스터와 동일 흐름).
  const current = activeChannel === "master" ? value : channelParams[activeChannel];
  const patchActive = (key: keyof LevelsParams, n: number): void => {
    if (activeChannel === "master") {
      onPatch({ [key]: n });
      return;
    }
    onChannelsChange?.({
      ...channels,
      [activeChannel]: { ...channels?.[activeChannel], [key]: n },
    });
  };

  return (
    <div className="space-y-2">
      {/* 헤더 + 항등 복귀(모든 채널) */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">레벨 보정 (Levels)</p>
        <button
          type="button"
          onClick={onReset}
          disabled={channelEditable ? allIdentity : identityByChannel.master}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="레벨 보정(모든 채널)을 제거하고 원본 톤으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 채널 세그먼트 — RGB(마스터)/R/G/B. 조정된 채널에는 점 배지를 띄운다. */}
      {channelEditable && (
        <div role="group" aria-label="레벨 채널" className="flex flex-wrap gap-1.5">
          {TONE_CHANNELS.map((c) => (
            <StudioToggleChip key={c.id} active={activeChannel === c.id} title={c.tip} onClick={() => setChannel(c.id)}>
              {c.label}
              {!identityByChannel[c.id] && (
                <>
                  <span aria-hidden className="ml-1 inline-block size-1.5 rounded-full bg-accent align-middle" />
                  <span className="sr-only">(조정됨)</span>
                </>
              )}
            </StudioToggleChip>
          ))}
        </div>
      )}

      {/* 원클릭 톤 프리셋 칩 — 마스터(RGB) 채널에서만. 절대값으로 덮어쓴다(누적 아님). */}
      {activeChannel === "master" && (
        <div className="flex flex-wrap gap-1.5">
          {LEVELS_PRESETS.map((preset) => (
            <StudioPanelChip
              key={preset.id}
              active={preset.id === "identity" && identityByChannel.master}
              onClick={() => onApplyPreset(preset.params)}
              title={preset.tip}
            >
              {preset.label}
            </StudioPanelChip>
          ))}
        </div>
      )}

      {/* 히스토그램 — 선택 이미지 픽셀이 주어졌을 때만. 편집 채널을 따라간다(마스터=휘도). */}
      <StudioHistogramSection source={histogramSource} channel={activeChannel} />

      {/* 입력 검정/흰점 · 중간톤 감마 · 출력 하한/상한 슬라이더 — 범위는 LEVELS_RANGES에서. */}
      <div className="space-y-2">
        {LEVELS_SLIDERS.map(({ key, label, gamma }) => {
          const range = LEVELS_RANGES[key];
          const currentValue = current[key] ?? DEFAULT_LEVELS[key];
          return (
            <StudioSliderRow
              key={key}
              label={label}
              min={range.min}
              max={range.max}
              step={range.step}
              value={currentValue}
              onChange={(n) => patchActive(key, n)}
              readout={gamma ? currentValue.toFixed(2) : currentValue}
            />
          );
        })}
      </div>
    </div>
  );
}
