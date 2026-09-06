import {
  Circle,
  CircleDot,
  Equal,
  Eye,
  EyeOff,
  Plus,
  Spline,
  Sun,
  Target,
  Trash2,
} from "lucide-react";

import {
  STUDIO_ADVANCED_RULER_MAX_COUNT,
  type StudioAdvancedRuler,
  type StudioAdvancedRulerDocument,
} from "./studio-advanced-ruler-document";
import {
  STUDIO_GUIDE_RULER_MAX_SPACING,
  STUDIO_GUIDE_RULER_MIN_SPACING,
} from "./studio-advanced-ruler-guide-snap";
import {
  STUDIO_FISHEYE_MAX_FOV_DEG,
  STUDIO_FISHEYE_MAX_STRENGTH,
  STUDIO_FISHEYE_MIN_FOV_DEG,
  STUDIO_FISHEYE_MIN_RADIUS,
  STUDIO_FISHEYE_MIN_STRENGTH,
} from "./studio-fisheye-ruler";
import {
  StudioCoordinateInput,
  StudioPanelChip,
  StudioSliderRow,
} from "./studio-panel-ui";

import type { LucideIcon } from "lucide-react";
import type { ReactElement } from "react";

const RULER_KIND_LABELS: Record<StudioAdvancedRuler["type"], string> = {
  curve: "곡선자",
  fisheye: "어안자",
  parallel: "평행선자",
  concentric: "동심원자",
  radial: "방사선자",
};

const ADD_RULER_BUTTONS: readonly {
  type: StudioAdvancedRuler["type"];
  title: string;
  Icon: LucideIcon;
}[] = [
  { type: "curve", title: "3차 Bézier 곡선자 추가", Icon: Spline },
  { type: "fisheye", title: "구면 어안자 추가", Icon: Circle },
  { type: "parallel", title: "평행선 자 추가", Icon: Equal },
  { type: "concentric", title: "동심원 자 추가", Icon: CircleDot },
  { type: "radial", title: "방사선 자 추가", Icon: Sun },
];

export interface StudioAdvancedRulerPanelProps {
  document: StudioAdvancedRulerDocument;
  groups: readonly { id: string; name: string }[];
  canvasWidth: number;
  canvasHeight: number;
  disabled?: boolean;
  disabledReason?: string;
  onAdd: (type: StudioAdvancedRuler["type"]) => void;
  onPatch: (id: string, patch: Partial<StudioAdvancedRuler>) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string | null) => void;
  onSetActiveSnap: (id: string | null) => void;
}
const NOOP_PREVIEW = (): void => undefined;
const SELECT_CLASS = "h-8 w-full rounded-md border border-line bg-card px-2 text-[0.68rem] text-fg outline-none focus:border-accent/60 disabled:opacity-45";

function selectedRuler(document: StudioAdvancedRulerDocument): StudioAdvancedRuler | null {
  return document.rulers.find((ruler) => ruler.id === document.selectedRulerId) ?? null;
}

function CoordinatePair({
  label,
  x,
  y,
  disabled,
  onCommit,
}: {
  label: string;
  x: number;
  y: number;
  disabled: boolean;
  onCommit: (x: number, y: number) => void;
}): ReactElement {
  return (
    <div className="space-y-1">
      <p className="text-[0.65rem] font-semibold text-fg-3">{label}</p>
      <div className="flex gap-1.5">
        <StudioCoordinateInput
          label="X"
          ariaLabel={`${label} X`}
          value={x}
          disabled={disabled}
          onCommit={(next) => onCommit(next, y)}
        />
        <StudioCoordinateInput
          label="Y"
          ariaLabel={`${label} Y`}
          value={y}
          disabled={disabled}
          onCommit={(next) => onCommit(x, next)}
        />
      </div>
    </div>
  );
}

export function StudioAdvancedRulerPanel({
  document,
  groups,
  canvasWidth,
  canvasHeight,
  disabled = false,
  disabledReason,
  onAdd,
  onPatch,
  onRemove,
  onSelect,
  onSetActiveSnap,
}: StudioAdvancedRulerPanelProps): ReactElement {
  const selected = selectedRuler(document);
  const atLimit = document.rulers.length >= STUDIO_ADVANCED_RULER_MAX_COUNT;
  const disabledTitle = disabledReason ?? "현재 문서에서는 자를 편집할 수 없습니다.";

  return (
    <div className="space-y-2 border-t border-line/35 pt-2.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-fg-3">고급 자</p>
          <p className="text-[0.58rem] text-fg-3">곡선·어안·평행선·동심원·방사선 가이드는 여러 개 표시하고 하나만 스냅합니다.</p>
        </div>
        <span className="text-[0.6rem] tabular-nums text-fg-3">
          {document.rulers.length}/{STUDIO_ADVANCED_RULER_MAX_COUNT}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {ADD_RULER_BUTTONS.map(({ type, title, Icon }) => (
          <button
            key={type}
            type="button"
            disabled={disabled || atLimit}
            title={disabled ? disabledTitle : title}
            className="flex min-h-9 items-center justify-center gap-1 rounded-md border border-line bg-card text-[0.66rem] font-semibold text-fg-2 hover:bg-raised disabled:opacity-45 pointer-coarse:min-h-11"
            onClick={() => onAdd(type)}
          >
            <Icon size={12} aria-hidden />
            <Plus size={10} aria-hidden /> {RULER_KIND_LABELS[type]}
          </button>
        ))}
      </div>

      {document.rulers.length === 0 ? (
        <p className="rounded-md border border-dashed border-line px-2 py-3 text-center text-[0.63rem] leading-relaxed text-fg-3">
          의상 곡선, 차량 곡면, 초광각 배경을 따라 그릴 자를 추가해 보세요.
        </p>
      ) : (
        <div role="list" aria-label="고급 자 목록" className="space-y-1">
          {document.rulers.map((ruler) => {
            const isSelected = ruler.id === document.selectedRulerId;
            const isActive = ruler.id === document.activeSnapRulerId;
            return (
              <div
                key={ruler.id}
                role="listitem"
                className={`flex items-center gap-1 rounded-md border px-1.5 py-1 ${isSelected ? "border-accent/60 bg-accent/8" : "border-line bg-card"}`}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  className="min-w-0 flex-1 truncate text-left text-[0.66rem] font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => onSelect(ruler.id)}
                >
                  {RULER_KIND_LABELS[ruler.type]} · {ruler.name}
                </button>
                <button
                  type="button"
                  aria-label={`${ruler.name} ${ruler.visible ? "숨기기" : "보이기"}`}
                  aria-pressed={ruler.visible}
                  disabled={disabled}
                  className="grid size-8 place-items-center rounded text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-45"
                  onClick={() => onPatch(ruler.id, { visible: !ruler.visible })}
                >
                  {ruler.visible ? <Eye size={13} aria-hidden /> : <EyeOff size={13} aria-hidden />}
                </button>
                <button
                  type="button"
                  aria-label={`${ruler.name} ${isActive ? "스냅 해제" : "스냅 활성화"}`}
                  aria-pressed={isActive}
                  disabled={disabled || !ruler.enabled}
                  className={`grid size-8 place-items-center rounded hover:bg-raised disabled:opacity-45 ${isActive ? "text-accent" : "text-fg-3"}`}
                  onClick={() => onSetActiveSnap(isActive ? null : ruler.id)}
                >
                  <Target size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`${ruler.name} 삭제`}
                  disabled={disabled}
                  className="grid size-8 place-items-center rounded text-fg-3 hover:bg-danger/10 hover:text-danger disabled:opacity-45"
                  onClick={() => onRemove(ruler.id)}
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {selected ? (
        <div className="space-y-2 border-l border-line/50 py-1 pl-2">
          <label className="block space-y-1 text-[0.65rem] font-semibold text-fg-3">
            적용 범위
            <select
              value={selected.scope.kind === "page" ? "page" : `group:${selected.scope.groupId}`}
              disabled={disabled}
              className={SELECT_CLASS}
              onChange={(event) => {
                const value = event.target.value;
                onPatch(selected.id, {
                  scope: value === "page"
                    ? { kind: "page", groupId: null }
                    : { kind: "group", groupId: value.slice("group:".length) },
                });
              }}
            >
              <option value="page">현재 페이지 전체</option>
              {groups.map((group) => (
                <option key={group.id} value={`group:${group.id}`}>그룹 · {group.name}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-1">
            <StudioPanelChip
              active={selected.enabled}
              disabled={disabled}
              onClick={() => {
                onPatch(selected.id, { enabled: !selected.enabled });
                if (selected.enabled && document.activeSnapRulerId === selected.id) onSetActiveSnap(null);
              }}
              title={disabled ? disabledTitle : "이 자의 스냅 사용 가능 여부"}
            >
              {selected.enabled ? "스냅 허용" : "스냅 잠금"}
            </StudioPanelChip>
          </div>

          {selected.type === "curve" ? (
            <>
              <label className="block space-y-1 text-[0.65rem] font-semibold text-fg-3">
                평행선 방식
                <select
                  value={selected.snapMode}
                  disabled={disabled}
                  className={SELECT_CLASS}
                  onChange={(event) => onPatch(selected.id, {
                    snapMode: event.target.value as typeof selected.snapMode,
                  })}
                >
                  <option value="through-start">획 시작점을 지나는 평행선</option>
                  <option value="on-curve">원래 곡선</option>
                  <option value="fixed">고정 오프셋</option>
                </select>
              </label>
              {selected.snapMode === "fixed" ? (
                <StudioSliderRow
                  label="오프셋"
                  min={-Math.max(canvasWidth, canvasHeight)}
                  max={Math.max(canvasWidth, canvasHeight)}
                  step={1}
                  value={selected.fixedOffset}
                  disabled={disabled}
                  onChange={NOOP_PREVIEW}
                  onCommit={(fixedOffset) => onPatch(selected.id, { fixedOffset })}
                  formatReadout={(value) => `${Math.round(value)}px`}
                />
              ) : null}
              {(["p0", "p1", "p2", "p3"] as const).map((key, index) => (
                <CoordinatePair
                  key={key}
                  label={`제어점 ${index + 1}`}
                  x={selected[key].x}
                  y={selected[key].y}
                  disabled={disabled}
                  onCommit={(x, y) => onPatch(selected.id, { [key]: { x, y } } as Partial<StudioAdvancedRuler>)}
                />
              ))}
            </>
          ) : null}

          {selected.type === "fisheye" ? (
            <>
              <CoordinatePair
                label="렌즈 중심"
                x={selected.centerX}
                y={selected.centerY}
                disabled={disabled}
                onCommit={(centerX, centerY) => onPatch(selected.id, { centerX, centerY })}
              />
              <StudioSliderRow
                label="반경"
                min={STUDIO_FISHEYE_MIN_RADIUS}
                max={Math.max(STUDIO_FISHEYE_MIN_RADIUS, Math.max(canvasWidth, canvasHeight))}
                step={1}
                value={selected.radius}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(radius) => onPatch(selected.id, { radius })}
                formatReadout={(value) => `${Math.round(value)}px`}
              />
              <StudioSliderRow
                label="회전"
                min={0}
                max={359}
                step={1}
                value={selected.rotationDeg}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(rotationDeg) => onPatch(selected.id, { rotationDeg })}
                formatReadout={(value) => `${Math.round(value)}°`}
              />
              <StudioSliderRow
                label="시야각"
                min={STUDIO_FISHEYE_MIN_FOV_DEG}
                max={STUDIO_FISHEYE_MAX_FOV_DEG}
                step={1}
                value={selected.fovDeg}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(fovDeg) => onPatch(selected.id, { fovDeg })}
                formatReadout={(value) => `${Math.round(value)}°`}
              />
              <StudioSliderRow
                label="렌즈 강도"
                min={STUDIO_FISHEYE_MIN_STRENGTH}
                max={STUDIO_FISHEYE_MAX_STRENGTH}
                step={0.05}
                value={selected.strength}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(strength) => onPatch(selected.id, { strength })}
                formatReadout={(value) => value.toFixed(2)}
              />
              <label className="block space-y-1 text-[0.65rem] font-semibold text-fg-3">
                가이드 계열
                <select
                  value={selected.guideFamily}
                  disabled={disabled}
                  className={SELECT_CLASS}
                  onChange={(event) => onPatch(selected.id, {
                    guideFamily: event.target.value as typeof selected.guideFamily,
                  })}
                >
                  <option value="auto">자동</option>
                  <option value="radial">방사형</option>
                  <option value="spherical">구면형</option>
                </select>
              </label>
              <label className="block space-y-1 text-[0.65rem] font-semibold text-fg-3">
                렌즈 밖 입력
                <select
                  value={selected.outsidePolicy}
                  disabled={disabled}
                  className={SELECT_CLASS}
                  onChange={(event) => onPatch(selected.id, {
                    outsidePolicy: event.target.value as typeof selected.outsidePolicy,
                  })}
                >
                  <option value="clamp">가장자리에 고정</option>
                  <option value="passthrough">보정 없이 통과</option>
                  <option value="reject">입력 거부</option>
                </select>
              </label>
            </>
          ) : null}

          {selected.type === "parallel" ? (
            <>
              <StudioSliderRow
                label="각도"
                min={0}
                max={179}
                step={1}
                value={selected.angleDeg}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(angleDeg) => onPatch(selected.id, { angleDeg })}
                formatReadout={(value) => `${Math.round(value)}°`}
              />
              <StudioSliderRow
                label="가이드 간격"
                min={STUDIO_GUIDE_RULER_MIN_SPACING}
                max={STUDIO_GUIDE_RULER_MAX_SPACING}
                step={1}
                value={selected.guideSpacing}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(guideSpacing) => onPatch(selected.id, { guideSpacing })}
                formatReadout={(value) => `${Math.round(value)}px`}
              />
              <CoordinatePair
                label="기준점"
                x={selected.originX}
                y={selected.originY}
                disabled={disabled}
                onCommit={(originX, originY) => onPatch(selected.id, { originX, originY })}
              />
              <p className="text-[0.58rem] leading-relaxed text-fg-3">
                획은 시작점을 지나는 같은 각도의 평행선에 스냅됩니다. 가이드 간격은 표시 전용입니다.
              </p>
            </>
          ) : null}

          {selected.type === "concentric" ? (
            <>
              <CoordinatePair
                label="중심점"
                x={selected.centerX}
                y={selected.centerY}
                disabled={disabled}
                onCommit={(centerX, centerY) => onPatch(selected.id, { centerX, centerY })}
              />
              <StudioSliderRow
                label="가이드 간격"
                min={STUDIO_GUIDE_RULER_MIN_SPACING}
                max={STUDIO_GUIDE_RULER_MAX_SPACING}
                step={1}
                value={selected.guideSpacing}
                disabled={disabled}
                onChange={NOOP_PREVIEW}
                onCommit={(guideSpacing) => onPatch(selected.id, { guideSpacing })}
                formatReadout={(value) => `${Math.round(value)}px`}
              />
              <p className="text-[0.58rem] leading-relaxed text-fg-3">
                획은 시작점을 지나는 중심 기준 원에 스냅됩니다. 가이드 간격은 표시 전용입니다.
              </p>
            </>
          ) : null}

          {selected.type === "radial" ? (
            <>
              <CoordinatePair
                label="중심점"
                x={selected.centerX}
                y={selected.centerY}
                disabled={disabled}
                onCommit={(centerX, centerY) => onPatch(selected.id, { centerX, centerY })}
              />
              <p className="text-[0.58rem] leading-relaxed text-fg-3">
                획은 중심에서 시작점을 지나는 방사선에 스냅되고 중심 반대쪽으로는 넘어가지 않습니다.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
