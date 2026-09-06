import {
  STUDIO_TRANSFORM_FIELD_SYNTAX_HINT,
  StudioTransformField,
} from "./StudioTransformField";
import { StudioTransformQuickActions } from "./StudioTransformQuickActions";

import type {
  StudioFigmaSelectionLayoutMetrics,
  StudioFigmaSelectionLayoutPatch,
  StudioSelectionResizeAnchor,
  StudioSelectionStrokeWidthPolicy,
} from "./studio-selection-transform-advanced";

export interface StudioTransformGeometryFieldsProps {
  readonly metrics: StudioFigmaSelectionLayoutMetrics;
  readonly disabled: boolean;
  readonly interactionDisabledReason: string | null;
  readonly precisionControls: boolean;
  readonly multi: boolean;
  readonly widthDisabled: boolean;
  readonly heightDisabled: boolean;
  readonly rotationDisabled: boolean;
  readonly resizeAnchor: StudioSelectionResizeAnchor;
  readonly strokeWidthPolicy: StudioSelectionStrokeWidthPolicy;
  readonly onChange: (patch: StudioFigmaSelectionLayoutPatch) => void;
  readonly onZoomToSelection?: () => void;
  readonly onFlipHorizontal?: () => void;
  readonly onFlipVertical?: () => void;
}

export function StudioTransformGeometryFields({
  metrics,
  disabled,
  interactionDisabledReason,
  precisionControls,
  multi,
  widthDisabled,
  heightDisabled,
  rotationDisabled,
  resizeAnchor,
  strokeWidthPolicy,
  onChange,
  onZoomToSelection,
  onFlipHorizontal,
  onFlipVertical,
}: StudioTransformGeometryFieldsProps) {
  const sizePatch = (dimension: "width" | "height", value: number) => ({
    [dimension]: value,
    ...(precisionControls ? { resizeAnchor } : {}),
    ...(precisionControls && multi && metrics.hasStrokeWidthSensitiveMember
      ? { strokeWidthPolicy }
      : {}),
  }) as StudioFigmaSelectionLayoutPatch;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <StudioTransformField
          key={`x:${metrics.selectionKey}`}
          label="가로 위치 X"
          controlId="selection.x"
          priority="advanced"
          value={metrics.x}
          disabled={disabled}
          disabledReason={interactionDisabledReason}
          coarseStep={10}
          fineStep={0.1}
          suffix="px"
          onCommit={(x) => onChange({ x })}
        />
        <StudioTransformField
          key={`y:${metrics.selectionKey}`}
          label="세로 위치 Y"
          controlId="selection.y"
          priority="advanced"
          value={metrics.y}
          disabled={disabled}
          disabledReason={interactionDisabledReason}
          coarseStep={10}
          fineStep={0.1}
          suffix="px"
          onCommit={(y) => onChange({ y })}
        />
        <StudioTransformField
          key={`w:${metrics.selectionKey}`}
          label={multi ? "전체 너비 W" : "너비 W"}
          controlId="selection.width"
          priority="advanced"
          value={metrics.width}
          disabled={widthDisabled}
          disabledReason={interactionDisabledReason ?? metrics.widthDisabledReason}
          min={1}
          coarseStep={10}
          fineStep={0.1}
          suffix="px"
          onCommit={(width) => onChange(sizePatch("width", width))}
        />
        <StudioTransformField
          key={`h:${metrics.selectionKey}`}
          label={multi ? "전체 높이 H" : "높이 H"}
          controlId="selection.height"
          priority="advanced"
          value={metrics.height}
          disabled={heightDisabled}
          disabledReason={interactionDisabledReason ?? metrics.heightDisabledReason}
          min={1}
          coarseStep={10}
          fineStep={0.1}
          suffix="px"
          onCommit={(height) => onChange(sizePatch("height", height))}
        />
        <StudioTransformField
          key={`rotation:${metrics.selectionKey}`}
          label={metrics.rotationIsRelative ? "회전(상대)" : "회전"}
          controlId="selection.rotation"
          priority="advanced"
          value={metrics.rotation}
          disabled={rotationDisabled}
          disabledReason={interactionDisabledReason ?? metrics.rotationDisabledReason}
          step={1}
          coarseStep={15}
          fineStep={0.1}
          suffix="°"
          onCommit={(rotation) => onChange({ rotation })}
        />
        <StudioTransformQuickActions
          disabled={disabled}
          disabledReason={interactionDisabledReason}
          onZoomToSelection={onZoomToSelection}
          onFlipHorizontal={onFlipHorizontal}
          onFlipVertical={onFlipVertical}
        />
      </div>

      {precisionControls ? (
        <p className="mt-2 text-[0.625rem] font-medium leading-relaxed text-fg-3">
          수식 입력: {STUDIO_TRANSFORM_FIELD_SYNTAX_HINT}. 크기 기준점은 W/H에만 적용되고 회전은 항상 선택 중심을 사용합니다.
        </p>
      ) : null}
      {multi ? (
        <div className="mt-2 space-y-1.5 rounded-lg bg-canvas/45 px-2 py-2 text-[0.6875rem] leading-relaxed text-fg-3">
          <p>
            {precisionControls
              ? "X/Y는 묶음을 이동하고, 전체 너비나 높이 한쪽을 입력하면 간격을 보존한 채 현재 비율을 유지해 모두 함께 크기를 조절합니다. 회전 값은 현재 상태에서 더할 각도입니다."
              : "가로·세로 위치는 선택 묶음 전체를 이동하고, 불투명도는 한 번에 적용합니다. 크기와 회전은 캔버스 핸들에서 조절해 주세요."}
          </p>
          {precisionControls ? (
            <p className="font-medium text-fg-2">
              모든 대상이 한 번에 바뀌며, 잠금 또는 호환되지 않는 요소가 있으면 전체를 그대로 유지합니다.
            </p>
          ) : null}
          <p className="font-medium text-fg-2">
            색상·글자·클리핑처럼 대상마다 다른 속성은 한 개만 선택하면 표시됩니다.
          </p>
        </div>
      ) : null}
      {!multi && (!metrics.supportsWidth || !metrics.supportsHeight) ? (
        <p className="mt-2 rounded-md bg-canvas/45 px-2 py-1.5 text-[0.6875rem] leading-relaxed text-fg-3">
          {metrics.widthDisabledReason ?? metrics.heightDisabledReason}
        </p>
      ) : null}
      {metrics.rotationIsRelative && metrics.supportsRotation ? (
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-3">
          {multi ? (
            <>
              여러 요소의 회전 칸은 현재 각도가 아니라 &ldquo;여기서 몇 도 더&rdquo;예요.
              15를 넣으면 선택 중심을 기준으로 모두 15° 돌아가고 칸은 0으로 돌아옵니다.
            </>
          ) : (
            <>
              선화는 회전이 점에 그대로 구워져요. 회전 칸은 현재 각도가 아니라 &ldquo;여기서 몇 도 더&rdquo;예요 — 15를 넣으면 15° 돌아가고 칸은 0으로 돌아옵니다.
            </>
          )}
        </p>
      ) : null}
      {metrics.rotationIsRelative && metrics.rotationDisabledReason ? (
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-fg-3">
          {metrics.rotationDisabledReason}
        </p>
      ) : null}
    </>
  );
}
