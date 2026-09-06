/**
 * Studio Image Filter Panel
 * 선택된 이미지의 보정 인스펙터 — 원클릭 프리셋 + 기존 코미포 스타일 슬라이더/체크박스
 * + 신규 보정(채도/색조/색온도/샤픈/픽셀화/반전/먹선/듀오톤).
 * StudioPage에서 분리한 순수 프레젠테이션 컴포넌트(상태 없음, props만 읽고 onPatch로 쓴다).
 */
import { RotateCcw } from "lucide-react";

import { DUOTONE_PRESETS } from "./studio-color-palettes";
import {
  IMAGE_ADJUSTMENT_RANGES,
  IMAGE_FILTER_PRESETS,
  imageFilterResetPatch,
  type ImageFilterPatch,
} from "./studio-filters";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";


// 듀오톤 토글 ON 기본 색쌍(어둠=남색, 빛=분홍).
const DUOTONE_DEFAULT_SHADOW = "#1a1a40";
const DUOTONE_DEFAULT_HIGHLIGHT = "#ff8fb3";

// 듀오톤 색 입력 누락 시 보여줄 폴백(input[type=color]는 빈 값 불가).
const DUOTONE_FALLBACK_SHADOW = "#000000";
const DUOTONE_FALLBACK_HIGHLIGHT = "#ffffff";

// 공용 라벨 + 슬라이더 한 줄. 우측 readout은 항상 같은 폭으로 정렬한다.
const LABEL_ROW = "flex items-center justify-between gap-2 text-xs text-fg-2";
const RANGE_CLASS = "w-24 accent-accent cursor-pointer";
const READOUT_CLASS = "w-5 text-right text-[10px] tabular-nums text-fg-3";
const CHECK_CLASS = "size-3.5 accent-accent";
const CHECK_LABEL = "flex items-center gap-1.5 text-xs text-fg-2 cursor-pointer";
const CHIP_CLASS =
  "rounded-md border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-2 transition-colors hover:bg-raised hover:text-fg";

export function StudioImageFilterPanel({
  values,
  onPatch,
}: {
  values: ImageFilterPatch;
  onPatch: (patch: ImageFilterPatch) => void;
}): React.ReactElement {
  // 보정이 하나도 없으면 "원본" 프리셋을 활성으로 표시(작은 부가 표시).
  const isPristine = Object.values(values).every((v) => v === undefined || v === false);
  const duotoneOn = values.duotoneShadow !== undefined || values.duotoneHighlight !== undefined;

  return (
    <div className="space-y-3">
      {/* 헤더 + 원본 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">이미지 필터 효과</p>
        <button
          type="button"
          onClick={() => onPatch(imageFilterResetPatch())}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="모든 보정을 제거하고 원본으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          원본으로
        </button>
      </div>

      {/* 원클릭 프리셋 칩 — reset 후 적용해 절대값으로 덮어쓴다(누적 아님). */}
      <div className="flex flex-wrap gap-1.5">
        {IMAGE_FILTER_PRESETS.map((preset) => {
          const active = preset.id === "original" && isPristine;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => onPatch({ ...imageFilterResetPatch(), ...preset.patch })}
              title={preset.tip}
              className={cn(CHIP_CLASS, active && "border-accent bg-raised text-fg")}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* 기존 코미포 스타일 슬라이더/체크박스 */}
      <div className="space-y-2">
        <label className={LABEL_ROW}>
          블러 (흐림)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={30}
              value={values.blur ?? 0}
              onChange={(e) => onPatch({ blur: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.blur ?? 0}</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          밝기 (Bright)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={-0.8}
              max={0.8}
              step={0.05}
              value={values.brightness ?? 0}
              onChange={(e) => onPatch({ brightness: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{Math.round((values.brightness ?? 0) * 100)}</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          대비 (Contrast)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={-80}
              max={80}
              value={values.contrast ?? 0}
              onChange={(e) => onPatch({ contrast: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.contrast ?? 0}</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          <label className={CHECK_LABEL}>
            <input
              type="checkbox"
              checked={!!values.grayscale}
              onChange={(e) => onPatch({ grayscale: e.target.checked })}
              className={CHECK_CLASS}
            />
            흑백
          </label>
          <label className={CHECK_LABEL}>
            <input
              type="checkbox"
              checked={!!values.sepia}
              onChange={(e) => onPatch({ sepia: e.target.checked })}
              className={CHECK_CLASS}
            />
            세피아
          </label>
          <label className={CHECK_LABEL}>
            <input
              type="checkbox"
              checked={!!values.screentone}
              onChange={(e) => onPatch({ screentone: e.target.checked })}
              className={CHECK_CLASS}
            />
            스크린톤 (만화망점)
          </label>
          <label className={CHECK_LABEL}>
            <input
              type="checkbox"
              checked={!!values.lineart}
              onChange={(e) => onPatch({ lineart: e.target.checked })}
              className={CHECK_CLASS}
            />
            외곽선 (선화추출)
          </label>
        </div>

        <label className={cn(LABEL_ROW, "mt-2")}>
          색수차 왜곡 (Chromatic)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={12}
              step={1}
              value={values.chromatic ?? 0}
              onChange={(e) => onPatch({ chromatic: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.chromatic ?? 0}px</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          툰 쉐이딩 단계 (Toon)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={values.posterize ?? 0}
              onChange={(e) => onPatch({ posterize: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.posterize ?? 0}</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          노이즈 (Noise)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={values.noise ?? 0}
              onChange={(e) => onPatch({ noise: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.noise ?? 0}%</span>
          </span>
        </label>
      </div>

      {/* 신규 보정 — 범위는 IMAGE_ADJUSTMENT_RANGES에서 가져온다. */}
      <div className="space-y-2 border-t border-line/50 pt-2">
        <label className={LABEL_ROW}>
          채도 (Saturation)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={IMAGE_ADJUSTMENT_RANGES.saturation.min}
              max={IMAGE_ADJUSTMENT_RANGES.saturation.max}
              step={IMAGE_ADJUSTMENT_RANGES.saturation.step}
              value={values.saturation ?? 0}
              onChange={(e) => onPatch({ saturation: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{Math.round((values.saturation ?? 0) * 100)}</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          색조 회전 (Hue)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={IMAGE_ADJUSTMENT_RANGES.hue.min}
              max={IMAGE_ADJUSTMENT_RANGES.hue.max}
              step={IMAGE_ADJUSTMENT_RANGES.hue.step}
              value={values.hue ?? 0}
              onChange={(e) => onPatch({ hue: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.hue ?? 0}°</span>
          </span>
        </label>

        <label className={LABEL_ROW} title="음수=차갑게, 양수=따뜻하게">
          색온도 (Temperature)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={IMAGE_ADJUSTMENT_RANGES.temperature.min}
              max={IMAGE_ADJUSTMENT_RANGES.temperature.max}
              step={IMAGE_ADJUSTMENT_RANGES.temperature.step}
              value={values.temperature ?? 0}
              onChange={(e) => onPatch({ temperature: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.temperature ?? 0}</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          선명도 (Sharpen)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={IMAGE_ADJUSTMENT_RANGES.sharpen.min}
              max={IMAGE_ADJUSTMENT_RANGES.sharpen.max}
              step={IMAGE_ADJUSTMENT_RANGES.sharpen.step}
              value={values.sharpen ?? 0}
              onChange={(e) => onPatch({ sharpen: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{Math.round((values.sharpen ?? 0) * 100)}</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          픽셀화 (Pixelate)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={IMAGE_ADJUSTMENT_RANGES.pixelate.min}
              max={IMAGE_ADJUSTMENT_RANGES.pixelate.max}
              step={IMAGE_ADJUSTMENT_RANGES.pixelate.step}
              value={values.pixelate ?? 0}
              onChange={(e) => onPatch({ pixelate: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{values.pixelate ?? 0}px</span>
          </span>
        </label>

        <label className={LABEL_ROW}>
          먹선 임계 (Ink)
          <span className="flex items-center gap-1.5">
            <input
              type="range"
              min={IMAGE_ADJUSTMENT_RANGES.inkThreshold.min}
              max={IMAGE_ADJUSTMENT_RANGES.inkThreshold.max}
              step={IMAGE_ADJUSTMENT_RANGES.inkThreshold.step}
              value={values.inkThreshold ?? 0}
              onChange={(e) => onPatch({ inkThreshold: Number(e.target.value) })}
              className={RANGE_CLASS}
            />
            <span className={READOUT_CLASS}>{Math.round((values.inkThreshold ?? 0) * 100)}</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-1">
          <label className={CHECK_LABEL}>
            <input
              type="checkbox"
              checked={!!values.invert}
              onChange={(e) => onPatch({ invert: e.target.checked })}
              className={CHECK_CLASS}
            />
            반전 (Invert)
          </label>
        </div>
      </div>

      {/* 듀오톤(그라디언트 맵) — 토글 + 색쌍 + 프리셋 칩 */}
      <div className="space-y-2 border-t border-line/50 pt-2">
        <label className={CHECK_LABEL}>
          <input
            type="checkbox"
            checked={duotoneOn}
            onChange={(e) =>
              onPatch(
                e.target.checked
                  ? { duotoneShadow: DUOTONE_DEFAULT_SHADOW, duotoneHighlight: DUOTONE_DEFAULT_HIGHLIGHT }
                  : { duotoneShadow: undefined, duotoneHighlight: undefined }
              )
            }
            className={CHECK_CLASS}
          />
          듀오톤
        </label>

        {duotoneOn && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[0.6rem] text-fg-3">
                어둠
                <input
                  type="color"
                  value={values.duotoneShadow ?? DUOTONE_FALLBACK_SHADOW}
                  onChange={(e) => onPatch({ duotoneShadow: e.target.value })}
                  className="size-5 cursor-pointer rounded border border-line bg-card"
                />
              </label>
              <label className="flex items-center gap-1.5 text-[0.6rem] text-fg-3">
                빛
                <input
                  type="color"
                  value={values.duotoneHighlight ?? DUOTONE_FALLBACK_HIGHLIGHT}
                  onChange={(e) => onPatch({ duotoneHighlight: e.target.value })}
                  className="size-5 cursor-pointer rounded border border-line bg-card"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DUOTONE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onPatch({ duotoneShadow: preset.shadow, duotoneHighlight: preset.highlight })}
                  title={`${preset.label} 듀오톤`}
                  className={CHIP_CLASS}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
