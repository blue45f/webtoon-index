import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  Boxes,
  Copy,
  Sparkles,
  Trash2,
} from "lucide-react";

import { preloadStudioBackground3D } from "./studio-background-3d-loader";
import { parseStudio3dTool } from "./studio-background-3d-metadata";
import { StudioInspectorSection } from "./StudioInspectorSection";

import type { StudioBg3dSceneDocument } from "./bg3d/studio-bg3d-scene-document";
import type { El } from "./studio-element-model";
import type { ReactNode } from "react";

import { buttonClass } from "@/shared/components/ui/button-utils";

export type StudioInspectorAlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "distributeH"
  | "distributeV";

interface StudioInspectorSelectionActionsProps {
  selectionCount: number;
  leadingActions?: ReactNode;
  reorder: (dir: "front" | "back" | "forward" | "backward") => void;
  alignSelected: (mode: StudioInspectorAlignMode) => void;
  duplicateSelected: () => void;
  removeSelected: () => void;
}

interface ActionButtonProps {
  label: string;
  shortLabel: string;
  controlId: string;
  onClick: () => void;
  icon: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
}

function ActionButton({
  label,
  shortLabel,
  controlId,
  onClick,
  icon,
  disabled = false,
  disabledReason,
}: ActionButtonProps) {
  const title = disabled ? (disabledReason ?? label) : label;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={title}
      data-inspector-control-id={controlId}
      data-inspector-priority="advanced"
      className={buttonClass({
        size: "sm",
        variant: "quiet",
        className: "min-h-9 min-w-0 gap-1 px-2 text-[0.6875rem] pointer-coarse:min-h-11",
      })}
    >
      {icon}
      <span className="truncate">{shortLabel}</span>
    </button>
  );
}

/**
 * Shared selection action surface. A single object and a marquee selection use the same actions,
 * labels, touch targets and accessibility metadata, so the Inspector cannot drift into two
 * different command sets as features grow.
 */
export function StudioInspectorSelectionActions({
  selectionCount,
  leadingActions,
  reorder,
  alignSelected,
  duplicateSelected,
  removeSelected,
}: StudioInspectorSelectionActionsProps) {
  const canDistribute = selectionCount >= 3;
  const distributeReason = "간격 분배는 요소를 3개 이상 선택하면 사용할 수 있어요.";

  return (
    <>
      <StudioInspectorSection sectionId="element.order-align" loadingLabel="정렬·순서를 여는 중...">
        {selectionCount > 1 ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-canvas/45 px-2 py-1.5 text-[0.6875rem] text-fg-3">
            <span>선택 묶음 기준으로 정렬합니다.</span>
            <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px font-bold tabular-nums text-accent">
              {selectionCount}개
            </span>
          </div>
        ) : null}

        {leadingActions ? (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="선택 요소 전용 작업">
            {leadingActions}
          </div>
        ) : null}

        <div className="space-y-1.5" role="group" aria-label="레이어 순서">
          <p className="text-[0.6875rem] font-bold text-fg-3">레이어 순서</p>
          <div className="grid grid-cols-2 gap-1.5">
            <ActionButton
              label="선택을 맨 앞으로"
              shortLabel="맨 앞으로"
              controlId="selection.order.front"
              onClick={() => reorder("front")}
              icon={<ArrowUpToLine size={14} aria-hidden />}
            />
            <ActionButton
              label="선택을 맨 뒤로"
              shortLabel="맨 뒤로"
              controlId="selection.order.back"
              onClick={() => reorder("back")}
              icon={<ArrowDownToLine size={14} aria-hidden />}
            />
          </div>
        </div>

        <div className="space-y-1.5" role="group" aria-label="선택 정렬">
          <p className="text-[0.6875rem] font-bold text-fg-3">정렬</p>
          <div className="grid grid-cols-3 gap-1.5">
            <ActionButton
              label="왼쪽 정렬"
              shortLabel="왼쪽"
              controlId="selection.align.left"
              onClick={() => alignSelected("left")}
              icon={<AlignStartVertical size={14} aria-hidden />}
            />
            <ActionButton
              label="가로 가운데 정렬"
              shortLabel="가로 중앙"
              controlId="selection.align.hcenter"
              onClick={() => alignSelected("hcenter")}
              icon={<AlignHorizontalJustifyCenter size={14} aria-hidden />}
            />
            <ActionButton
              label="오른쪽 정렬"
              shortLabel="오른쪽"
              controlId="selection.align.right"
              onClick={() => alignSelected("right")}
              icon={<AlignEndVertical size={14} aria-hidden />}
            />
            <ActionButton
              label="위쪽 정렬"
              shortLabel="위쪽"
              controlId="selection.align.top"
              onClick={() => alignSelected("top")}
              icon={<AlignStartHorizontal size={14} aria-hidden />}
            />
            <ActionButton
              label="세로 가운데 정렬"
              shortLabel="세로 중앙"
              controlId="selection.align.vcenter"
              onClick={() => alignSelected("vcenter")}
              icon={<AlignVerticalJustifyCenter size={14} aria-hidden />}
            />
            <ActionButton
              label="아래쪽 정렬"
              shortLabel="아래쪽"
              controlId="selection.align.bottom"
              onClick={() => alignSelected("bottom")}
              icon={<AlignEndHorizontal size={14} aria-hidden />}
            />
          </div>
        </div>

        <div className="space-y-1.5" role="group" aria-label="선택 간격 분배">
          <p className="text-[0.6875rem] font-bold text-fg-3">간격</p>
          <div className="grid grid-cols-2 gap-1.5">
            <ActionButton
              label="가로 등간격 분배"
              shortLabel="가로 균등"
              controlId="selection.distribute.horizontal"
              onClick={() => alignSelected("distributeH")}
              icon={<AlignHorizontalJustifyCenter size={14} className="rotate-90" aria-hidden />}
              disabled={!canDistribute}
              disabledReason={distributeReason}
            />
            <ActionButton
              label="세로 등간격 분배"
              shortLabel="세로 균등"
              controlId="selection.distribute.vertical"
              onClick={() => alignSelected("distributeV")}
              icon={<AlignVerticalJustifyCenter size={14} className="rotate-90" aria-hidden />}
              disabled={!canDistribute}
              disabledReason={distributeReason}
            />
          </div>
        </div>
      </StudioInspectorSection>

      <div className="mt-3 grid grid-cols-2 gap-1.5" role="group" aria-label="선택 빠른 작업">
        <button
          type="button"
          onClick={duplicateSelected}
          aria-label={`${selectionCount}개 선택 복제`}
          title="복제 (⌘J)"
          data-inspector-control-id="selection.duplicate"
          data-inspector-priority="essential"
          className={buttonClass({
            size: "sm",
            variant: "quiet",
            className: "min-h-9 gap-1 pointer-coarse:min-h-11",
          })}
        >
          <Copy size={14} aria-hidden /> 복제
        </button>
        <button
          type="button"
          onClick={removeSelected}
          aria-label={`${selectionCount}개 선택 삭제`}
          title="삭제 (Delete)"
          data-inspector-control-id="selection.delete"
          data-inspector-priority="essential"
          className={buttonClass({
            size: "sm",
            variant: "quiet",
            className: "min-h-9 gap-1 text-bad pointer-coarse:min-h-11",
          })}
        >
          <Trash2 size={14} aria-hidden /> 삭제
        </button>
      </div>
    </>
  );
}

interface StudioInspectorOrderAlignSectionProps {
  selected: El;
  selectedBg3dEditSource: { readonly scene?: StudioBg3dSceneDocument; readonly legacyDataUrl?: string } | null;
  patchEl: (id: string, patch: Partial<El>) => void;
  reorder: (dir: "front" | "back" | "forward" | "backward") => void;
  alignSelected: (mode: StudioInspectorAlignMode) => void;
  duplicateSelected: () => void;
  removeSelected: () => void;
  setPoserInitialDataUrl: (url: string | undefined) => void;
  setPoserInitialElementId: (id: string | undefined) => void;
  setPoserVrmOpen: (open: boolean) => void;
  setBg3dInitialScene: (scene: StudioBg3dSceneDocument | undefined) => void;
  setBg3dInitialDataUrl: (url: string | undefined) => void;
  setBg3dInitialElementId: (id: string | undefined) => void;
  setBg3dOpen: (open: boolean) => void;
}

export function StudioInspectorOrderAlignSection({
  selected,
  selectedBg3dEditSource,
  reorder,
  alignSelected,
  duplicateSelected,
  removeSelected,
  setPoserInitialDataUrl,
  setPoserInitialElementId,
  setPoserVrmOpen,
  setBg3dInitialScene,
  setBg3dInitialDataUrl,
  setBg3dInitialElementId,
  setBg3dOpen,
}: StudioInspectorOrderAlignSectionProps) {
  const canEditVrm =
    selected.type === "image"
    && Boolean(selected.vrmScene || parseStudio3dTool(selected.src) === "vrm-poser");
  const elementActions =
    selected.type === "image" && (canEditVrm || selectedBg3dEditSource) ? (
    <>
      {canEditVrm ? (
        <button
          type="button"
          onClick={() => {
            setPoserInitialDataUrl(selected.src);
            setPoserInitialElementId(selected.id);
            setPoserVrmOpen(true);
          }}
          aria-label="3D 캐릭터 재편집"
          data-inspector-control-id="selection.edit-vrm"
          data-inspector-priority="advanced"
          className={buttonClass({
            size: "sm",
            variant: "solid",
            className: "min-h-9 gap-1 font-semibold pointer-coarse:min-h-11",
          })}
          title="3D 캐릭터 재편집"
        >
          <Sparkles size={14} aria-hidden /> 3D 재편집
        </button>
      ) : null}
      {selectedBg3dEditSource ? (
        <button
          type="button"
          onClick={() => {
            setBg3dInitialScene(selectedBg3dEditSource.scene);
            setBg3dInitialDataUrl(selectedBg3dEditSource.legacyDataUrl);
            setBg3dInitialElementId(selected.id);
            setBg3dOpen(true);
          }}
          onPointerEnter={preloadStudioBackground3D}
          onPointerDown={preloadStudioBackground3D}
          onFocus={preloadStudioBackground3D}
          aria-label="3D 배경 재편집"
          data-inspector-control-id="selection.edit-bg3d"
          data-inspector-priority="advanced"
          className={buttonClass({
            size: "sm",
            variant: "solid",
            className: "min-h-9 gap-1 font-semibold pointer-coarse:min-h-11",
          })}
          title="3D 배경 재편집"
        >
          <Boxes size={14} aria-hidden /> 배경 재편집
        </button>
      ) : null}
    </>
  ) : null;

  return (
    <StudioInspectorSelectionActions
      selectionCount={1}
      leadingActions={elementActions}
      reorder={reorder}
      alignSelected={alignSelected}
      duplicateSelected={duplicateSelected}
      removeSelected={removeSelected}
    />
  );
}
