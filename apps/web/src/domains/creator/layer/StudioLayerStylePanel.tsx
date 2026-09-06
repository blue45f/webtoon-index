/**
 * Studio Layer Style Panel
 * 선택된 이미지의 레이어 스타일 인스펙터 — 원클릭 그림자/모서리 프리셋 +
 * 그림자 색 + 번짐/오프셋/농도/모서리 슬라이더.
 *
 * 선택적 outline 채널(outline/onOutlineChange)이 연결되면 웹툰 스티커용 기능이 추가된다:
 * - 콤보 프리셋: "스티커(흰 테두리+그림자)" · "이중 테두리" · "네온(글로우+테두리)" —
 *   기존 patch 메커니즘(reset 위 절대값 덮어쓰기)과 outline 통째 교체를 한 클릭에 조합.
 * - 이중 외곽선 컨트롤: 안/바깥 링 색 + 굵기(studio-outline의 secondColor/secondWidth).
 * 채널이 없으면(레거시 호출부) 기존과 완전히 동일하게 렌더된다.
 *
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음, props만 읽고 콜백으로 쓴다).
 */
import { RotateCcw } from "lucide-react";

import {
  DEFAULT_OUTLINE_SECOND_COLOR,
  isIdentityOutline,
  normalizeOutline,
  OUTLINE_WIDTH_RANGE,
  type Outline,
} from "../studio-outline";

import {
  COMBO_LAYER_STYLE_PRESETS,
  LAYER_STYLE_PRESETS,
  LAYER_STYLE_RANGES,
  layerStyleResetPatch,
  type LayerStylePatch,
} from "./studio-layer-styles";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// input[type=color]는 빈 값 불가 — 그림자 색 미지정 시 보여줄 폴백(검정).
const SHADOW_FALLBACK_COLOR = "#000000";

// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다.
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-8 text-right text-[10px] tabular-nums text-fg-3";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

// LayerStylePatch의 6개 키 — pristine 판정은 이 키들만 본다(호출부가 엘리먼트 전체를
// values로 캐스팅해 넘기므로 Object.values(values) 전체를 보면 절대 pristine이 안 된다).
const LAYER_STYLE_KEYS = Object.keys(layerStyleResetPatch()) as (keyof LayerStylePatch)[];

export function StudioLayerStylePanel({
  values,
  onPatch,
  outline,
  onOutlineChange,
}: {
  values: LayerStylePatch;
  onPatch: (patch: LayerStylePatch) => void;
  /** 선택 엘리먼트의 스티커 테두리(el.outline) — onOutlineChange와 함께 줄 때만 의미 있다. */
  outline?: Outline;
  /** 테두리 절대값 교체 콜백(undefined면 테두리 제거). 있으면 콤보 프리셋·이중 외곽선 UI가 켜진다. */
  onOutlineChange?: (next: Outline | undefined) => void;
}): React.ReactElement {
  const hasOutlineChannel = typeof onOutlineChange === "function";
  const currentOutline = normalizeOutline(outline);
  const outlineIdentity = isIdentityOutline(currentOutline);

  // 레이어 스타일 6키가 전부 비어 있고(그리고 outline 채널이 있으면 테두리도 항등이면) pristine.
  const isPristine =
    LAYER_STYLE_KEYS.every((key) => values[key] === undefined) && (!hasOutlineChannel || outlineIdentity);

  // 이중 외곽선 부분 패치 — 현재 정규화 값 위에 덮고 다시 정규화해 절대값으로 교체한다.
  const patchOutline = (patch: Partial<Outline>): void => {
    onOutlineChange?.(normalizeOutline({ ...currentOutline, ...patch }));
  };

  return (
    <div className="space-y-2">
      {/* 헤더 + 원본 복귀 — outline 채널이 있으면 테두리까지 함께 지운다. */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
          {hasOutlineChannel ? "레이어 스타일 (그림자·모서리·테두리)" : "레이어 스타일 (그림자·모서리)"}
        </p>
        <button
          type="button"
          onClick={() => {
            onPatch(layerStyleResetPatch());
            if (hasOutlineChannel) onOutlineChange(undefined);
          }}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="모든 레이어 스타일을 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 프리셋 칩 — reset 후 적용해 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {LAYER_STYLE_PRESETS.map((preset) => {
          const active = preset.id === "none" && isPristine;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onPatch({ ...layerStyleResetPatch(), ...preset.patch });
                // "기본"은 원본 복귀 — outline 채널이 있으면 테두리도 함께 제거한다.
                if (hasOutlineChannel && preset.id === "none") onOutlineChange(undefined);
              }}
              title={preset.tip}
              className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 콤보 프리셋 — 그림자와 스티커 테두리를 한 클릭에 함께 세팅(outline 채널 필요). */}
      {hasOutlineChannel && (
        <div className="flex flex-wrap gap-1.5">
          {COMBO_LAYER_STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                onPatch({ ...layerStyleResetPatch(), ...preset.layer });
                onOutlineChange(preset.outline);
              }}
              title={preset.tip}
              className={cn(CHIP_CLASS, "border-accent/40")}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      {/* 그림자 색 — input[type=color]는 빈 값 불가라 미지정 시 검정 폴백. */}
      <label className="flex items-center gap-2 text-xs text-fg-2">
        그림자 색
        <input
          type="color"
          value={values.shadowColor ?? SHADOW_FALLBACK_COLOR}
          onChange={(e) => onPatch({ shadowColor: e.target.value })}
          className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
        />
      </label>

      {/* 그림자/모서리 슬라이더 — 범위는 LAYER_STYLE_RANGES에서 가져온다. */}
      <label className={LABEL_ROW}>
        그림자 번짐
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={LAYER_STYLE_RANGES.shadowBlur.min}
            max={LAYER_STYLE_RANGES.shadowBlur.max}
            step={LAYER_STYLE_RANGES.shadowBlur.step}
            value={values.shadowBlur ?? 0}
            onChange={(e) => onPatch({ shadowBlur: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{values.shadowBlur ?? 0}px</span>
        </span>
      </label>

      <label className={LABEL_ROW}>
        가로 오프셋
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={LAYER_STYLE_RANGES.shadowOffsetX.min}
            max={LAYER_STYLE_RANGES.shadowOffsetX.max}
            step={LAYER_STYLE_RANGES.shadowOffsetX.step}
            value={values.shadowOffsetX ?? 0}
            onChange={(e) => onPatch({ shadowOffsetX: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{values.shadowOffsetX ?? 0}px</span>
        </span>
      </label>

      <label className={LABEL_ROW}>
        세로 오프셋
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={LAYER_STYLE_RANGES.shadowOffsetY.min}
            max={LAYER_STYLE_RANGES.shadowOffsetY.max}
            step={LAYER_STYLE_RANGES.shadowOffsetY.step}
            value={values.shadowOffsetY ?? 0}
            onChange={(e) => onPatch({ shadowOffsetY: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{values.shadowOffsetY ?? 0}px</span>
        </span>
      </label>

      <label className={LABEL_ROW}>
        그림자 농도
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={LAYER_STYLE_RANGES.shadowOpacity.min}
            max={LAYER_STYLE_RANGES.shadowOpacity.max}
            step={LAYER_STYLE_RANGES.shadowOpacity.step}
            value={values.shadowOpacity ?? 0}
            onChange={(e) => onPatch({ shadowOpacity: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{Math.round((values.shadowOpacity ?? 0) * 100)}</span>
        </span>
      </label>

      <label className={LABEL_ROW}>
        모서리 둥글기
        <span className="flex items-center gap-1.5">
          <input
            type="range"
            min={LAYER_STYLE_RANGES.cornerRadius.min}
            max={LAYER_STYLE_RANGES.cornerRadius.max}
            step={LAYER_STYLE_RANGES.cornerRadius.step}
            value={values.cornerRadius ?? 0}
            onChange={(e) => onPatch({ cornerRadius: Number(e.target.value) })}
            className={RANGE_CLASS}
          />
          <span className={READOUT_CLASS}>{values.cornerRadius ?? 0}px</span>
        </span>
      </label>

      {/* 이중 외곽선 — 안쪽 링(color/width) + 바깥 링(secondColor/secondWidth). outline 채널 필요. */}
      {hasOutlineChannel && (
        <div className="space-y-2 border-t border-line/60 pt-2">
          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">이중 외곽선 (스티커 테두리)</p>

          <label className="flex items-center gap-2 text-xs text-fg-2">
            안쪽 테두리 색
            <input
              type="color"
              value={currentOutline.color}
              onChange={(e) => patchOutline({ color: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
            />
          </label>

          <label className={LABEL_ROW}>
            안쪽 굵기
            <span className="flex items-center gap-1.5">
              <input
                type="range"
                min={OUTLINE_WIDTH_RANGE.min}
                max={OUTLINE_WIDTH_RANGE.max}
                step={OUTLINE_WIDTH_RANGE.step}
                value={currentOutline.width}
                onChange={(e) => patchOutline({ width: Number(e.target.value) })}
                className={RANGE_CLASS}
              />
              <span className={READOUT_CLASS}>{currentOutline.width}px</span>
            </span>
          </label>

          <label className="flex items-center gap-2 text-xs text-fg-2">
            바깥 테두리 색
            <input
              type="color"
              value={currentOutline.secondColor ?? DEFAULT_OUTLINE_SECOND_COLOR}
              onChange={(e) => patchOutline({ secondColor: e.target.value })}
              className="h-7 w-7 cursor-pointer rounded border border-line bg-card"
            />
          </label>

          <label className={LABEL_ROW}>
            바깥 굵기
            <span className="flex items-center gap-1.5">
              <input
                type="range"
                min={OUTLINE_WIDTH_RANGE.min}
                max={OUTLINE_WIDTH_RANGE.max}
                step={OUTLINE_WIDTH_RANGE.step}
                value={currentOutline.secondWidth ?? 0}
                onChange={(e) => patchOutline({ secondWidth: Number(e.target.value) })}
                className={RANGE_CLASS}
              />
              <span className={READOUT_CLASS}>{currentOutline.secondWidth ?? 0}px</span>
            </span>
          </label>

          {/* 안내 — 테두리는 실루엣 바깥으로 자라므로 투명 배경에서 효과가 또렷하다. */}
          <p className="text-[0.6rem] leading-relaxed text-fg-3">
            투명 배경 이미지(캐릭터·스티커)에서 잘 보여요. 안쪽 흰색+바깥 검정이 웹툰 스티커 조합이에요.
          </p>
        </div>
      )}
    </div>
  );
}
