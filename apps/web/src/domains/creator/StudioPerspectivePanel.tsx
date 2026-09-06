/**
 * Studio Perspective Panel — 원근자(소실점 스냅) 인스펙터: on/off 토글 + 소실점
 * 목록(좌표 입력 + 삭제) + 추가 버튼. 캔버스 위 핸들 드래그는 StudioPerspectiveOverlay
 * (Konva, Stage 트리 안에 있어야 해서 별도 파일)가 담당하고 동일한 onMovePoint 콜백을
 * 공유한다. 좌표 입력은 로컬 편집 버퍼를 사용하며, 미리보기와 최종 문서 커밋을 분리한다.
 */
import { Plus, Sparkles, Trash2 } from "lucide-react";

import { StudioCoordinateInput, StudioToggleChip } from "./studio-panel-ui";
import {
  canAddVanishingPoint,
  defaultPerspectiveEyeLevelY,
  MAX_VANISHING_POINTS,
  type VanishingPoint,
} from "./studio-perspective-guide";

import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

/**
 * X/Y 좌표 입력 한 칸 — 완전히 controlled(부모 value가 유일한 진실)로 만들면 "-"만 입력한 순간
 * Number("-")===NaN 이 되어 매 키스트로크마다 0으로 스냅되며 방금 타이핑한 걸 지워버린다.
 * 로컬 텍스트 버퍼를 두어 파싱 가능한 값은 선택적으로 미리보기만 하고 Enter/blur에서
 * 한 번 커밋한다. 외부 값은 편집 중이 아닐 때만 버퍼에 재동기화한다.
 */
function VpCoordInput({
  value,
  onPreview,
  onCommit,
  label,
  ariaLabel,
  disabled,
}: {
  value: number;
  onPreview?: (next: number) => void;
  onCommit: (next: number) => void;
  label: string;
  ariaLabel: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <StudioCoordinateInput
      value={value}
      onPreview={onPreview}
      onCommit={onCommit}
      label={label}
      ariaLabel={ariaLabel}
      disabled={disabled}
    />
  );
}

type MoveVanishingPoint = (id: string, x: number, y: number) => void;

type StudioPerspectivePanelBaseProps = {
  active: boolean;
  points: VanishingPoint[];
  /** Independent horizon line (document px). null = not authored yet. */
  eyeLevelY?: number | null;
  /** Pin vanishing-point y to eyeLevelY while dragging/editing. */
  lockHorizon?: boolean;
  /** Canvas height used only to seed a default eye level when none is authored. */
  canvasHeight?: number;
  onToggleActive: () => void;
  onAddPoint: () => void;
  onRemovePoint: (id: string) => void;
  onToggleLockHorizon?: (next: boolean) => void;
  onCommitEyeLevelY?: (next: number) => void;
  onPreviewEyeLevelY?: (next: number) => void;
  onAlignToEyeLevel?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  /** Optional transient canvas preview. It must not append undo/CRDT history. */
  onPreviewPoint?: MoveVanishingPoint;
};

type StudioPerspectivePanelCommitProps =
  | {
      /** Final document/history commit after Enter or blur. */
      onCommitPoint: MoveVanishingPoint;
      /** @deprecated Use onCommitPoint. Retained for incremental StudioPage migration. */
      onMovePoint?: MoveVanishingPoint;
    }
  | {
      onCommitPoint?: undefined;
      /** Legacy final commit callback. It is no longer called on every keystroke. */
      onMovePoint: MoveVanishingPoint;
    };

export type StudioPerspectivePanelProps = StudioPerspectivePanelBaseProps & StudioPerspectivePanelCommitProps;

export function StudioPerspectivePanel({
  active,
  points,
  eyeLevelY = null,
  lockHorizon = false,
  canvasHeight = 1200,
  onToggleActive,
  onAddPoint,
  onRemovePoint,
  onToggleLockHorizon,
  onCommitEyeLevelY,
  onPreviewEyeLevelY,
  onAlignToEyeLevel,
  disabled = false,
  disabledReason,
  onPreviewPoint,
  onCommitPoint,
  onMovePoint,
}: StudioPerspectivePanelProps): ReactElement {
  const canAdd = canAddVanishingPoint(points);
  const commitPoint = onCommitPoint ?? onMovePoint;
  const resolvedEyeLevelY = eyeLevelY ?? defaultPerspectiveEyeLevelY(canvasHeight);
  return (
    <div className="pt-2.5 border-t border-line/35 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-fg-3">원근자 (Perspective)</p>
        <StudioToggleChip
          active={active}
          disabled={disabled}
          onClick={onToggleActive}
          aria-label={`원근자 ${active ? "끄기" : "켜기"}`}
          title={disabledReason ?? "소실점을 향해 선이 자동으로 정렬됩니다. (펜·직선 도구에 적용)"}
        >
          {active ? "켜짐" : "꺼짐"}
        </StudioToggleChip>
      </div>

      {active && (
        <div className="space-y-2 pl-1.5 border-l border-line/50 ml-1 py-1 animate-fade-in">
          {points.length === 0 ? (
            <p className="text-[0.7rem] leading-relaxed text-fg-3">
              소실점을 추가하면 그 방향으로 선이 스냅돼요.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {points.map((vp, index) => (
                <li key={vp.id} className="flex items-center gap-1.5">
                  <span className="w-14 shrink-0 text-[0.68rem] font-semibold text-fg-3">
                    소실점 {index + 1}
                  </span>
                  <VpCoordInput
                    label="X"
                    ariaLabel={`소실점 ${index + 1} X`}
                    value={vp.x}
                    disabled={disabled}
                    onPreview={onPreviewPoint ? (next) => onPreviewPoint(vp.id, next, vp.y) : undefined}
                    onCommit={(next) => commitPoint(vp.id, next, vp.y)}
                  />
                  <VpCoordInput
                    label="Y"
                    ariaLabel={`소실점 ${index + 1} Y`}
                    value={vp.y}
                    disabled={disabled || lockHorizon}
                    onPreview={
                      !lockHorizon && onPreviewPoint
                        ? (next) => onPreviewPoint(vp.id, vp.x, next)
                        : undefined
                    }
                    onCommit={(next) => commitPoint(vp.id, vp.x, next)}
                  />
                  <button
                    type="button"
                    aria-label={`소실점 ${index + 1} 삭제`}
                    title={disabledReason ?? "이 소실점 삭제"}
                    disabled={disabled}
                    onClick={() => onRemovePoint(vp.id)}
                    className="grid size-6 shrink-0 place-items-center rounded border border-line text-fg-3 transition-colors hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:size-11"
                  >
                    <Trash2 className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            onClick={onAddPoint}
            disabled={disabled || !canAdd}
            title={disabledReason ?? (canAdd ? "소실점 추가" : `소실점은 최대 ${MAX_VANISHING_POINTS}개까지 추가할 수 있어요.`)}
            className={cn(
              "flex w-full items-center justify-center gap-1 rounded border border-line bg-card py-1 text-[0.68rem] font-semibold text-fg-2 transition-colors pointer-coarse:min-h-11",
              canAdd && !disabled ? "hover:bg-raised cursor-pointer" : "cursor-not-allowed opacity-45"
            )}
          >
            <Plus className="size-3" aria-hidden />
            소실점 추가
          </button>

          <div className="space-y-1.5 rounded border border-line/50 bg-card/40 p-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[0.68rem] font-semibold text-fg-3">눈높이 (수평선)</span>
              {onToggleLockHorizon && (
                <StudioToggleChip
                  active={lockHorizon}
                  disabled={disabled}
                  onClick={() => onToggleLockHorizon(!lockHorizon)}
                  aria-label={`눈높이 잠금 ${lockHorizon ? "끄기" : "켜기"}`}
                  title={disabledReason ?? "켜면 소실점 세로 위치가 눈높이에 고정됩니다."}
                >
                  {lockHorizon ? "잠금" : "자유"}
                </StudioToggleChip>
              )}
            </div>
            {onCommitEyeLevelY && (
              <div className="flex items-center gap-1.5">
                <VpCoordInput
                  label="Y"
                  ariaLabel="눈높이 Y"
                  value={resolvedEyeLevelY}
                  disabled={disabled}
                  onPreview={onPreviewEyeLevelY}
                  onCommit={onCommitEyeLevelY}
                />
                {onAlignToEyeLevel && (
                  <button
                    type="button"
                    disabled={disabled || points.length === 0}
                    onClick={onAlignToEyeLevel}
                    title={disabledReason ?? "모든 소실점을 눈높이로 맞춥니다."}
                    className="shrink-0 rounded border border-line px-1.5 py-1 text-[0.65rem] font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11"
                  >
                    맞추기
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="flex items-start gap-1 text-[0.68rem] leading-relaxed text-fg-3">
            <Sparkles className="mt-0.5 shrink-0 size-3 text-accent" aria-hidden />
            소실점 1~3개 + 독립 눈높이로 1·2점 원근 수평선을 맞춥니다. 잠그면 VP가 수평선 위에 유지됩니다.
          </p>
        </div>
      )}
    </div>
  );
}
