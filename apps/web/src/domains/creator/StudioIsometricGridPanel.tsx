/**
 * Studio Isometric Grid Panel — 아이소메트릭 그리드 인스펙터: on/off 토글 + 각도 슬라이더
 * (15°/30°/45°/60° 프리셋 칩 포함) + 셀 크기 슬라이더 + 기준점 초기화 버튼. 캔버스 위
 * 기준점 핸들 드래그는 StudioIsometricGridOverlay(Konva, Stage 트리 안에 있어야 해서
 * 별도 파일)가 담당한다. 슬라이더는 로컬 draft/선택적 preview와 최종 커밋을 분리한다.
 */
import { Box, RotateCcw } from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  ISOMETRIC_ANGLE_MAX_DEG,
  ISOMETRIC_ANGLE_MIN_DEG,
  ISOMETRIC_ANGLE_PRESETS_DEG,
  ISOMETRIC_CELL_SIZE_MAX,
  ISOMETRIC_CELL_SIZE_MIN,
  clampIsometricCellSize,
  type IsometricGridConfig,
} from "./studio-isometric-grid";
import {
  STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX,
  STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN,
  STUDIO_ISOMETRIC_STAIRS_STEPS_MAX,
  STUDIO_ISOMETRIC_STAIRS_STEPS_MIN,
  type StudioIsometricPrimitiveKind,
  type StudioIsometricPrimitiveSpec,
} from "./studio-isometric-primitive-contract";
import {
  StudioCoordinateInput,
  StudioPanelChip,
  StudioSliderRow,
  StudioToggleChip,
} from "./studio-panel-ui";

type ChangeIsometricValue = (next: number) => void;
type ChangeIsometricOrigin = (x: number, y: number) => void;

const NOOP_PREVIEW = (): void => undefined;

type StudioIsometricGridPanelBaseProps = {
  active: boolean;
  config: IsometricGridConfig;
  onToggleActive: () => void;
  onResetOrigin: () => void;
  /** Creates three independently editable vector faces at the current origin. */
  onInsertSolid?: () => void;
  /** Creates a caller-committed, independently editable primitive face batch. */
  onInsertPrimitive?: (spec: StudioIsometricPrimitiveSpec) => void | Promise<void>;
  disabled?: boolean;
  disabledReason?: string;
  /** Optional transient canvas preview; must not append undo/CRDT history. */
  onPreviewAngle?: ChangeIsometricValue;
  /** Optional transient canvas preview; must not append undo/CRDT history. */
  onPreviewCellSize?: ChangeIsometricValue;
  /** Optional keyboard-accessible origin preview; must not append undo/CRDT history. */
  onPreviewOrigin?: ChangeIsometricOrigin;
  /** Final origin commit after Enter or blur. When omitted the coordinate fields stay hidden. */
  onCommitOrigin?: ChangeIsometricOrigin;
};

type StudioIsometricAngleCommitProps =
  | {
      /** One final document/history commit per completed interaction. */
      onCommitAngle: ChangeIsometricValue;
      /** @deprecated Use onCommitAngle. */
      onChangeAngle?: ChangeIsometricValue;
    }
  | {
      onCommitAngle?: undefined;
      /** Legacy final callback, now deferred until the interaction ends. */
      onChangeAngle: ChangeIsometricValue;
    };

type StudioIsometricCellCommitProps =
  | {
      /** One final document/history commit per completed interaction. */
      onCommitCellSize: ChangeIsometricValue;
      /** @deprecated Use onCommitCellSize. */
      onChangeCellSize?: ChangeIsometricValue;
    }
  | {
      onCommitCellSize?: undefined;
      /** Legacy final callback, now deferred until the interaction ends. */
      onChangeCellSize: ChangeIsometricValue;
    };

export type StudioIsometricGridPanelProps = StudioIsometricGridPanelBaseProps &
  StudioIsometricAngleCommitProps &
  StudioIsometricCellCommitProps;

const PRIMITIVE_CELL_MIN = 0.25;
const PRIMITIVE_CELL_MAX = 64;
const PRIMITIVE_KIND_LABELS: Readonly<Record<StudioIsometricPrimitiveKind, string>> = {
  box: "상자",
  cylinder: "원기둥",
  stairs: "계단",
  wedge: "쐐기",
};

function parseBoundedInput(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function parseBoundedIntegerInput(
  value: string,
  fallback: number,
  min: number,
  max: number,
  even = false
): number {
  const rounded = Math.round(parseBoundedInput(value, fallback, min, max));
  if (!even || rounded % 2 === 0) return rounded;
  return Math.min(max, rounded + 1);
}

export function StudioIsometricGridPanel({
  active,
  config,
  onToggleActive,
  disabled = false,
  disabledReason,
  onPreviewAngle,
  onPreviewCellSize,
  onPreviewOrigin,
  onCommitOrigin,
  onCommitAngle,
  onCommitCellSize,
  onChangeAngle,
  onChangeCellSize,
  onResetOrigin,
  onInsertSolid,
  onInsertPrimitive,
}: StudioIsometricGridPanelProps): ReactElement {
  const commitAngle = onCommitAngle ?? onChangeAngle;
  const commitCellSize = onCommitCellSize ?? onChangeCellSize;
  const [primitiveKind, setPrimitiveKind] = useState<StudioIsometricPrimitiveKind>("box");
  const [primitiveWidthCells, setPrimitiveWidthCells] = useState("3");
  const [primitiveDepthCells, setPrimitiveDepthCells] = useState("3");
  const [primitiveHeightCells, setPrimitiveHeightCells] = useState("3");
  const [primitiveSteps, setPrimitiveSteps] = useState("6");
  const [primitiveSegments, setPrimitiveSegments] = useState("24");
  const [primitiveInsertPending, setPrimitiveInsertPending] = useState(false);
  const primitiveControlsDisabled = disabled || primitiveInsertPending;
  const insertPrimitive = async (): Promise<void> => {
    if (primitiveControlsDisabled) return;
    if (!onInsertPrimitive) {
      onInsertSolid?.();
      return;
    }
    const unit = clampIsometricCellSize(config.cellSize);
    const dimensions = {
      width: parseBoundedInput(
        primitiveWidthCells,
        3,
        PRIMITIVE_CELL_MIN,
        PRIMITIVE_CELL_MAX
      ) * unit,
      depth: parseBoundedInput(
        primitiveDepthCells,
        3,
        PRIMITIVE_CELL_MIN,
        PRIMITIVE_CELL_MAX
      ) * unit,
      height: parseBoundedInput(
        primitiveHeightCells,
        3,
        PRIMITIVE_CELL_MIN,
        PRIMITIVE_CELL_MAX
      ) * unit,
    };
    let spec: StudioIsometricPrimitiveSpec;
    switch (primitiveKind) {
      case "cylinder":
        spec = {
          kind: primitiveKind,
          ...dimensions,
          segments: parseBoundedIntegerInput(
            primitiveSegments,
            24,
            STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN,
            STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX,
            true
          ),
        };
        break;
      case "stairs":
        spec = {
          kind: primitiveKind,
          ...dimensions,
          steps: parseBoundedIntegerInput(
            primitiveSteps,
            6,
            STUDIO_ISOMETRIC_STAIRS_STEPS_MIN,
            STUDIO_ISOMETRIC_STAIRS_STEPS_MAX
          ),
        };
        break;
      case "box":
      case "wedge":
        spec = { kind: primitiveKind, ...dimensions };
        break;
    }
    setPrimitiveInsertPending(true);
    try {
      await onInsertPrimitive(spec);
    } finally {
      setPrimitiveInsertPending(false);
    }
  };
  return (
    <div className="pt-2.5 border-t border-line/35 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg-3">아이소메트릭 그리드</p>
        <StudioToggleChip
          active={active}
          disabled={disabled}
          onClick={onToggleActive}
          aria-label={`아이소메트릭 그리드 ${active ? "끄기" : "켜기"}`}
          title={disabledReason ?? "자유곡선에는 안내선만 표시하고, 직선 도구는 3방향 축에 맞춥니다."}
        >
          {active ? "켜짐" : "꺼짐"}
        </StudioToggleChip>
      </div>

      {active && (
        <div className="space-y-2 pl-1.5 border-l border-line/50 ml-1 py-1 animate-fade-in">
          <StudioSliderRow
            label="각도"
            min={ISOMETRIC_ANGLE_MIN_DEG}
            max={ISOMETRIC_ANGLE_MAX_DEG}
            step={1}
            value={config.angleDeg}
            disabled={disabled}
            onChange={onPreviewAngle ?? NOOP_PREVIEW}
            onCommit={commitAngle}
            formatReadout={(draft) => `${Math.round(draft)}°`}
          />
          <div className="flex flex-wrap gap-1">
            {ISOMETRIC_ANGLE_PRESETS_DEG.map((preset) => (
              <StudioPanelChip
                key={preset}
                active={config.angleDeg === preset}
                disabled={disabled}
                onClick={() => commitAngle(preset)}
                title={disabledReason ?? `${preset}° 로 설정`}
              >
                {preset}°
              </StudioPanelChip>
            ))}
          </div>

          <StudioSliderRow
            label="셀 크기"
            min={ISOMETRIC_CELL_SIZE_MIN}
            max={ISOMETRIC_CELL_SIZE_MAX}
            step={1}
            value={config.cellSize}
            disabled={disabled}
            onChange={onPreviewCellSize ?? NOOP_PREVIEW}
            onCommit={commitCellSize}
            formatReadout={(draft) => `${Math.round(draft)}px`}
          />

          {onCommitOrigin ? (
            <div className="space-y-1">
              <p className="text-[0.68rem] font-semibold text-fg-3">기준점 좌표</p>
              <div className="flex gap-1.5">
                <StudioCoordinateInput
                  label="X"
                  ariaLabel="아이소메트릭 기준점 X"
                  value={config.originX}
                  disabled={disabled}
                  onPreview={onPreviewOrigin
                    ? (next) => onPreviewOrigin(next, config.originY)
                    : undefined}
                  onCommit={(next) => onCommitOrigin(next, config.originY)}
                />
                <StudioCoordinateInput
                  label="Y"
                  ariaLabel="아이소메트릭 기준점 Y"
                  value={config.originY}
                  disabled={disabled}
                  onPreview={onPreviewOrigin
                    ? (next) => onPreviewOrigin(config.originX, next)
                    : undefined}
                  onCommit={(next) => onCommitOrigin(config.originX, next)}
                />
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={onResetOrigin}
            disabled={disabled}
            title={disabledReason ?? "기준점을 캔버스 중앙으로 되돌립니다."}
            className="flex w-full items-center justify-center gap-1 rounded border border-line bg-card py-1 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
          >
            <RotateCcw className="size-3" aria-hidden />
            기준점 초기화
          </button>

          {onInsertPrimitive ? (
            <div
              aria-busy={primitiveInsertPending}
              className="space-y-2 rounded border border-line/60 bg-card/55 p-2"
            >
              <label className="block space-y-1 text-[0.68rem] font-semibold text-fg-3">
                <span>입체 종류</span>
                <select
                  aria-label="아이소메트릭 입체 종류"
                  value={primitiveKind}
                  disabled={primitiveControlsDisabled}
                  onChange={(event) => {
                    setPrimitiveKind(event.currentTarget.value as StudioIsometricPrimitiveKind);
                  }}
                  className="min-h-8 w-full rounded border border-line bg-panel px-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                >
                  {(Object.entries(PRIMITIVE_KIND_LABELS) as [StudioIsometricPrimitiveKind, string][])
                    .map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}
                </select>
              </label>

              <div className="grid grid-cols-3 gap-1.5">
                <label className="space-y-1 text-[0.65rem] font-semibold text-fg-3">
                  <span>너비(셀)</span>
                  <input
                    type="number"
                    aria-label="아이소메트릭 입체 너비"
                    min={PRIMITIVE_CELL_MIN}
                    max={PRIMITIVE_CELL_MAX}
                    step={0.25}
                    value={primitiveWidthCells}
                    disabled={primitiveControlsDisabled}
                    onChange={(event) => setPrimitiveWidthCells(event.currentTarget.value)}
                    className="min-h-8 w-full rounded border border-line bg-panel px-1.5 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  />
                </label>
                <label className="space-y-1 text-[0.65rem] font-semibold text-fg-3">
                  <span>깊이(셀)</span>
                  <input
                    type="number"
                    aria-label="아이소메트릭 입체 깊이"
                    min={PRIMITIVE_CELL_MIN}
                    max={PRIMITIVE_CELL_MAX}
                    step={0.25}
                    value={primitiveDepthCells}
                    disabled={primitiveControlsDisabled}
                    onChange={(event) => setPrimitiveDepthCells(event.currentTarget.value)}
                    className="min-h-8 w-full rounded border border-line bg-panel px-1.5 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  />
                </label>
                <label className="space-y-1 text-[0.65rem] font-semibold text-fg-3">
                  <span>높이(셀)</span>
                  <input
                    type="number"
                    aria-label="아이소메트릭 입체 높이"
                    min={PRIMITIVE_CELL_MIN}
                    max={PRIMITIVE_CELL_MAX}
                    step={0.25}
                    value={primitiveHeightCells}
                    disabled={primitiveControlsDisabled}
                    onChange={(event) => setPrimitiveHeightCells(event.currentTarget.value)}
                    className="min-h-8 w-full rounded border border-line bg-panel px-1.5 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  />
                </label>
              </div>

              {primitiveKind === "stairs" ? (
                <label className="block space-y-1 text-[0.68rem] font-semibold text-fg-3">
                  <span>계단 수</span>
                  <input
                    type="number"
                    aria-label="아이소메트릭 계단 수"
                    min={STUDIO_ISOMETRIC_STAIRS_STEPS_MIN}
                    max={STUDIO_ISOMETRIC_STAIRS_STEPS_MAX}
                    step={1}
                    value={primitiveSteps}
                    disabled={primitiveControlsDisabled}
                    onChange={(event) => setPrimitiveSteps(event.currentTarget.value)}
                    className="min-h-8 w-full rounded border border-line bg-panel px-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  />
                </label>
              ) : null}

              {primitiveKind === "cylinder" ? (
                <label className="block space-y-1 text-[0.68rem] font-semibold text-fg-3">
                  <span>곡면 분할</span>
                  <input
                    type="number"
                    aria-label="아이소메트릭 원기둥 분할 수"
                    min={STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MIN}
                    max={STUDIO_ISOMETRIC_CYLINDER_SEGMENTS_MAX}
                    step={2}
                    value={primitiveSegments}
                    disabled={primitiveControlsDisabled}
                    onChange={(event) => setPrimitiveSegments(event.currentTarget.value)}
                    className="min-h-8 w-full rounded border border-line bg-panel px-2 text-xs text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  />
                </label>
              ) : null}

              <p className="text-[0.62rem] leading-relaxed text-fg-3">
                각 면은 닫힌 벡터로 생성되어 색상과 노드를 따로 편집할 수 있습니다.
              </p>
              <p role="status" aria-live="polite" className="sr-only">
                {primitiveInsertPending ? "아이소메트릭 입체를 생성하고 있습니다." : ""}
              </p>
            </div>
          ) : null}

          {onInsertPrimitive || onInsertSolid ? (
            <button
              type="button"
              onClick={() => void insertPrimitive()}
              disabled={primitiveControlsDisabled}
              aria-busy={primitiveInsertPending}
              title={primitiveInsertPending
                ? "아이소메트릭 입체를 생성하고 있습니다."
                : disabledReason ?? `현재 각도·셀 크기·색상으로 편집 가능한 ${PRIMITIVE_KIND_LABELS[primitiveKind]}를 만듭니다.`}
              className="flex w-full items-center justify-center gap-1 rounded border border-accent/45 bg-accent/10 py-1.5 text-[0.68rem] font-semibold text-accent transition-colors hover:bg-accent/15 cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
            >
              <Box className="size-3" aria-hidden />
              {primitiveInsertPending
                ? "생성 중…"
                : onInsertPrimitive
                ? `${PRIMITIVE_KIND_LABELS[primitiveKind]} 생성`
                : "입체 상자 생성"}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
