/**
 * Studio Stroke & Shape Panel
 * 선/도형 공용 스트로크 스타일(점선 프리셋 6종·선 끝·시작/끝 화살촉) +
 * 도형 파라미터(별 꼭짓점 수/내부 반경, 다각형 변 수, 사각형 모서리 반경) +
 * 손그림 스케치 스타일(rough.js — 거칠기/휘어짐/채우기 질감) 인스펙터.
 * studio-stroke-shapes 엔진의 StrokeStyle/ShapeParams와 studio-rough-shape의
 * StudioSketchStyle을 props로 읽고 onPatch* 콜백으로만 쓴다. 상태 없는 순수 프레젠테이션.
 */
import { RotateCcw } from "lucide-react";

import {
  DEFAULT_SHAPE_PARAMS,
  DEFAULT_STROKE_STYLE,
  isDefaultShapeParams,
  isDefaultStrokeStyle,
  pathPointsToSvg,
  polygonPathPoints,
  SHAPE_PARAM_RANGES,
  starPathPoints,
  STROKE_ARROW_HEADS,
  STROKE_DASH_PRESETS,
  STROKE_LINE_CAPS,
  strokeDashArray,
  type ShapeParams,
  type StrokeArrowHead,
  type StrokeShapeKind,
  type StrokeStyle,
} from "./brush/studio-stroke-shapes";
import { PANEL_LABEL_ROW, StudioSliderRow, StudioToggleChip } from "./studio-panel-ui";
import {
  DEFAULT_STUDIO_SKETCH_STYLE,
  isDefaultStudioSketchStyle,
  STUDIO_SKETCH_FILL_STYLES,
  STUDIO_SKETCH_RANGES,
  type StudioSketchStyle,
} from "./studio-rough-shape";

import { buttonClass } from "@/shared/components/ui/button-utils";

// 칩 안 점선 미리보기 굵기 — 패턴 차이가 또렷하게 보이는 2px 기준으로 스케일.
const DASH_PREVIEW_WIDTH = 2;

// 도형 미리보기(SVG 48×48) 중심/반경 — star/polygon 패스 포인트 함수를 그대로 사용.
const PREVIEW_CENTER = 24;
const PREVIEW_RADIUS = 17;

// 화살촉 시작/끝 선택 한 줄 — 라벨 + 없음/화살촉/점 칩.
function ArrowHeadRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: StrokeArrowHead;
  onChange: (next: StrokeArrowHead) => void;
}): React.ReactElement {
  return (
    <div className={PANEL_LABEL_ROW}>
      {label}
      <span className="flex flex-wrap justify-end gap-1.5">
        {STROKE_ARROW_HEADS.map((head) => (
          <StudioToggleChip key={head.id} active={value === head.id} title={head.tip} onClick={() => onChange(head.id)}>
            {head.label}
          </StudioToggleChip>
        ))}
      </span>
    </div>
  );
}

// 별/다각형 파라미터 옆에 붙는 실시간 도형 미리보기(순수 SVG).
function ShapePreview({ points }: { points: number[] }): React.ReactElement {
  return (
    <svg
      width="44"
      height="44"
      viewBox="0 0 48 48"
      aria-hidden
      className="shrink-0 rounded-xl border border-line bg-card/45 text-fg-2"
    >
      <polygon points={pathPointsToSvg(points)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function StudioStrokeShapePanel({
  kind,
  strokeStyle,
  shapeParams,
  sketch,
  onPatchStrokeStyle,
  onPatchShapeParams,
  onPatchSketch,
}: {
  kind: StrokeShapeKind;
  strokeStyle: StrokeStyle;
  shapeParams: ShapeParams;
  sketch: StudioSketchStyle;
  onPatchStrokeStyle: (patch: Partial<StrokeStyle>) => void;
  onPatchShapeParams: (patch: Partial<ShapeParams>) => void;
  onPatchSketch: (patch: Partial<StudioSketchStyle>) => void;
}): React.ReactElement {
  // 전부 기본값이면 리셋 비활성.
  const isIdentity =
    isDefaultStrokeStyle(strokeStyle) &&
    isDefaultShapeParams(shapeParams) &&
    isDefaultStudioSketchStyle(sketch);
  // 화살촉은 선("line")에서만 그려진다(도형 외곽선에는 의미 없음, arrow는 자체 머리 보유).
  const showArrowHeads = kind === "line";
  // 도형 파라미터가 있는 종류에서만 하단 섹션 노출.
  const showShapeSection = kind === "star" || kind === "polygon" || kind === "rect";
  // 채우기 질감은 채우기 색이 가능한 도형에서만 의미가 있다(선·화살표 제외).
  const showSketchFillStyles = kind !== "line" && kind !== "arrow";
  const innerRatioPercent = Math.round(shapeParams.starInnerRatio * 100);
  const sketchRoughness = Math.round(sketch.roughness * 10) / 10;

  return (
    <div className="space-y-2.5">
      {/* 헤더 + 기본값 복귀 */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">선 스타일</p>
        <button
          type="button"
          onClick={() => {
            onPatchStrokeStyle(DEFAULT_STROKE_STYLE);
            onPatchShapeParams(DEFAULT_SHAPE_PARAMS);
            onPatchSketch(DEFAULT_STUDIO_SKETCH_STYLE);
          }}
          disabled={isIdentity}
          className={buttonClass({ size: "sm", variant: "quiet" })}
          title="선 스타일·도형 파라미터·손그림 스케치를 기본값으로 되돌립니다."
        >
          <RotateCcw className="size-3.5" />
          기본값
        </button>
      </div>

      {/* 점선 프리셋 6종 — 칩 안에 실제 패턴 미리보기(SVG)를 그린다. */}
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="점선 스타일">
        {STROKE_DASH_PRESETS.map((preset) => (
          <StudioToggleChip
            key={preset.id}
            active={strokeStyle.dash === preset.id}
            title={`${preset.label} — ${preset.tip}`}
            onClick={() => onPatchStrokeStyle({ dash: preset.id })}
          >
            <svg width="30" height="8" viewBox="0 0 30 8" aria-hidden className="block">
              <line
                x1="2"
                y1="4"
                x2="28"
                y2="4"
                stroke="currentColor"
                strokeWidth={DASH_PREVIEW_WIDTH}
                strokeDasharray={(strokeDashArray(preset.id, DASH_PREVIEW_WIDTH) ?? []).join(" ") || undefined}
              />
            </svg>
            <span className="sr-only">{preset.label}</span>
          </StudioToggleChip>
        ))}
      </div>

      {/* 선 끝 모양 — 평면/둥근/사각(점선 세그먼트와 선 양끝에 함께 적용). */}
      <div className={PANEL_LABEL_ROW}>
        선 끝
        <span className="flex flex-wrap justify-end gap-1.5">
          {STROKE_LINE_CAPS.map((cap) => (
            <StudioToggleChip
              key={cap.id}
              active={strokeStyle.lineCap === cap.id}
              title={cap.tip}
              onClick={() => onPatchStrokeStyle({ lineCap: cap.id })}
            >
              {cap.label}
            </StudioToggleChip>
          ))}
        </span>
      </div>

      {/* 화살촉 — 선 전용. 시작/끝을 각각 없음·화살촉·점으로 지정. */}
      {showArrowHeads && (
        <div className="space-y-2 border-t border-line/40 pt-2.5">
          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">화살촉</p>
          <ArrowHeadRow
            label="시작"
            value={strokeStyle.arrowStart}
            onChange={(next) => onPatchStrokeStyle({ arrowStart: next })}
          />
          <ArrowHeadRow
            label="끝"
            value={strokeStyle.arrowEnd}
            onChange={(next) => onPatchStrokeStyle({ arrowEnd: next })}
          />
        </div>
      )}

      {/* 도형 파라미터 — 별 꼭짓점/내부 반경, 다각형 변 수, 사각형 모서리 반경. */}
      {showShapeSection && (
        <div className="space-y-2 border-t border-line/40 pt-2.5">
          <p className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">도형 파라미터</p>

          {kind === "star" && (
            <div className="flex items-center gap-3">
              <ShapePreview points={starPathPoints(PREVIEW_CENTER, PREVIEW_CENTER, PREVIEW_RADIUS, shapeParams)} />
              <div className="min-w-0 flex-1 space-y-2">
                <StudioSliderRow
                  label="꼭짓점"
                  min={SHAPE_PARAM_RANGES.starPoints.min}
                  max={SHAPE_PARAM_RANGES.starPoints.max}
                  step={SHAPE_PARAM_RANGES.starPoints.step}
                  value={shapeParams.starPoints}
                  onChange={(n) => onPatchShapeParams({ starPoints: n })}
                  readout={`${shapeParams.starPoints}개`}
                />
                <StudioSliderRow
                  label="내부 반경"
                  min={SHAPE_PARAM_RANGES.starInnerRatio.min * 100}
                  max={SHAPE_PARAM_RANGES.starInnerRatio.max * 100}
                  step={SHAPE_PARAM_RANGES.starInnerRatio.step * 100}
                  value={innerRatioPercent}
                  onChange={(n) => onPatchShapeParams({ starInnerRatio: n / 100 })}
                  readout={`${innerRatioPercent}%`}
                />
              </div>
            </div>
          )}

          {kind === "polygon" && (
            <div className="flex items-center gap-3">
              <ShapePreview
                points={polygonPathPoints(PREVIEW_CENTER, PREVIEW_CENTER, PREVIEW_RADIUS, shapeParams.polygonSides)}
              />
              <div className="min-w-0 flex-1">
                <StudioSliderRow
                  label="변 수"
                  min={SHAPE_PARAM_RANGES.polygonSides.min}
                  max={SHAPE_PARAM_RANGES.polygonSides.max}
                  step={SHAPE_PARAM_RANGES.polygonSides.step}
                  value={shapeParams.polygonSides}
                  onChange={(n) => onPatchShapeParams({ polygonSides: n })}
                  readout={`${shapeParams.polygonSides}변`}
                />
              </div>
            </div>
          )}

          {kind === "rect" && (
            <StudioSliderRow
              label="모서리 반경"
              min={SHAPE_PARAM_RANGES.cornerRadius.min}
              max={SHAPE_PARAM_RANGES.cornerRadius.max}
              step={SHAPE_PARAM_RANGES.cornerRadius.step}
              value={shapeParams.cornerRadius}
              onChange={(n) => onPatchShapeParams({ cornerRadius: n })}
              readout={`${shapeParams.cornerRadius}px`}
            />
          )}
        </div>
      )}

      {/* 손그림 스케치 — rough.js 렌더 토글 + 거칠기/휘어짐 + 채우기 질감. */}
      <div className="space-y-2 border-t border-line/40 pt-2.5">
        <div className={PANEL_LABEL_ROW}>
          <span className="text-[0.66rem] font-semibold text-fg-3 uppercase tracking-wider">
            손그림 스케치
          </span>
          <StudioToggleChip
            active={sketch.enabled}
            title="도형을 손으로 그린 듯한 흔들리는 선(rough.js)으로 그립니다."
            onClick={() => onPatchSketch({ enabled: !sketch.enabled })}
          >
            {sketch.enabled ? "켬" : "끔"}
          </StudioToggleChip>
        </div>

        {sketch.enabled && (
          <>
            <StudioSliderRow
              label="거칠기"
              min={STUDIO_SKETCH_RANGES.roughness.min}
              max={STUDIO_SKETCH_RANGES.roughness.max}
              step={STUDIO_SKETCH_RANGES.roughness.step}
              value={sketchRoughness}
              onChange={(n) => onPatchSketch({ roughness: n })}
              readout={`${sketchRoughness}`}
            />
            <StudioSliderRow
              label="휘어짐"
              min={STUDIO_SKETCH_RANGES.bowing.min}
              max={STUDIO_SKETCH_RANGES.bowing.max}
              step={STUDIO_SKETCH_RANGES.bowing.step}
              value={sketch.bowing}
              onChange={(n) => onPatchSketch({ bowing: n })}
              readout={`${sketch.bowing}`}
            />
            {showSketchFillStyles && (
              <div className={PANEL_LABEL_ROW}>
                채우기 질감
                <span className="flex flex-wrap justify-end gap-1.5">
                  {STUDIO_SKETCH_FILL_STYLES.map((item) => (
                    <StudioToggleChip
                      key={item.id}
                      active={sketch.fillStyle === item.id}
                      title={item.tip}
                      onClick={() => onPatchSketch({ fillStyle: item.id })}
                    >
                      {item.label}
                    </StudioToggleChip>
                  ))}
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
