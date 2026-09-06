import {
  Eye,
  EyeOff,
  Grid2X2,
  Layers3,
  Lock,
  LockOpen,
  MoreHorizontal,
} from "lucide-react";


import { StudioToolHintTarget } from "../StudioToolHint";

import {
  STUDIO_LAYER_NAVIGATOR_COARSE_TARGET as coarseTarget,
  STUDIO_LAYER_NAVIGATOR_FOCUS_RING as focusRing,
} from "./studio-layer-navigator-row-ui";

import type { StudioLayerNavigatorAction } from "./StudioLayerNavigator";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioLayerNavigatorBatchBarProps {
  selectedIds: readonly string[];
  outsideSelectionCount: number;
  batchSelectedIds: readonly string[];
  batchShowIds: readonly string[];
  batchUnlockIds: readonly string[];
  batchShowBlockedCount: number;
  batchUnlockBlockedCount: number;
  mutationDisabled: boolean;
  readOnly: boolean;
  batchMergeFallbackNote: string | null;
  flattenVisibleFallbackNote: string | null;
  mergeFallbackNoteId: string;
  flattenFallbackNoteId: string;
  actionPopoverId: string;
  actionTargetKind: string | null;
  onAction: (action: StudioLayerNavigatorAction) => void;
  onOpenActionMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    target: { kind: "batch"; id: "selection" }
  ) => void;
}

export function StudioLayerNavigatorBatchBar({
  selectedIds,
  outsideSelectionCount,
  batchSelectedIds,
  batchShowIds,
  batchUnlockIds,
  batchShowBlockedCount,
  batchUnlockBlockedCount,
  mutationDisabled,
  readOnly,
  batchMergeFallbackNote,
  flattenVisibleFallbackNote,
  mergeFallbackNoteId,
  flattenFallbackNoteId,
  actionPopoverId,
  actionTargetKind,
  onAction,
  onOpenActionMenu,
}: StudioLayerNavigatorBatchBarProps) {
  if (selectedIds.length === 0) return null;

  return (
    <div
      aria-label="선택 레이어 일괄 작업"
      role="toolbar"
      className="flex max-w-full items-center gap-1 overflow-x-auto overscroll-x-contain border-b border-line/70 bg-accent-soft/20 px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>*]:shrink-0"
    >
      <span
        className={cn(
          "min-w-0 truncate px-1 text-[0.68rem] font-bold",
          outsideSelectionCount > 0 ? "text-warning" : "text-accent"
        )}
        title={
          outsideSelectionCount > 0
            ? `전체 선택 ${selectedIds.length}개 중 현재 결과 ${batchSelectedIds.length}개만 일괄 작업 대상입니다.`
            : `선택 ${selectedIds.length}개`
        }
      >
        선택 {batchSelectedIds.length}개
        {outsideSelectionCount > 0 ? ` · 밖 ${outsideSelectionCount}` : ""}
      </span>
      <StudioToolHintTarget
        disabled={mutationDisabled || batchShowIds.length === 0}
        unavailableReason={
          readOnly
            ? "읽기 전용 작업공간에서는 레이어 표시 상태를 바꿀 수 없어요."
            : batchShowIds.length === 0
              ? batchShowBlockedCount > 0
                ? `숨긴 상위 그룹 안의 ${batchShowBlockedCount}개는 그룹을 먼저 표시해야 해요.`
                : "현재 선택에는 다시 표시할 숨긴 레이어가 없어요."
              : undefined
        }
        preferredSide="top"
        hint={{
          id: "layer-batch-show",
          title: "선택 레이어 표시",
          description: "현재 검색 결과 안에서 선택한 숨김 레이어를 다시 보이게 합니다.",
          preview: "layer-visibility",
        }}
      >
        <button
          type="button"
          disabled={mutationDisabled || batchShowIds.length === 0}
          onClick={() => onAction({ type: "set-items-hidden", ids: batchShowIds, hidden: false })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label={`현재 결과의 선택 ${batchShowIds.length}개 표시${
            batchShowBlockedCount > 0 ? `, 숨긴 상위 그룹 ${batchShowBlockedCount}개 제외` : ""
          }`}
        >
          <Eye size={13} />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        disabled={mutationDisabled || batchSelectedIds.length === 0}
        unavailableReason={
          readOnly
            ? "읽기 전용 작업공간에서는 레이어를 숨길 수 없어요."
            : batchSelectedIds.length === 0
              ? "먼저 레이어를 하나 이상 선택하세요."
              : undefined
        }
        preferredSide="top"
        hint={{
          id: "layer-batch-hide",
          title: "선택 레이어 숨김",
          description: "선택한 레이어를 문서에서 지우지 않고 캔버스에서만 숨깁니다.",
          preview: "layer-visibility",
          tip: "나중에 눈 아이콘으로 다시 표시할 수 있어요.",
        }}
      >
        <button
          type="button"
          disabled={mutationDisabled || batchSelectedIds.length === 0}
          onClick={() => onAction({ type: "set-items-hidden", ids: batchSelectedIds, hidden: true })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label={`현재 결과의 선택 ${batchSelectedIds.length}개 숨김`}
        >
          <EyeOff size={13} />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        disabled={mutationDisabled || batchSelectedIds.length === 0}
        unavailableReason={
          readOnly
            ? "읽기 전용 작업공간에서는 레이어를 잠글 수 없어요."
            : batchSelectedIds.length === 0
              ? "먼저 레이어를 하나 이상 선택하세요."
              : undefined
        }
        preferredSide="top"
        hint={{
          id: "layer-batch-lock",
          title: "선택 레이어 잠금",
          description: "선택한 레이어를 고정해 캔버스에서 실수로 이동하거나 편집하지 않도록 보호합니다.",
          preview: "layer-lock",
        }}
      >
        <button
          type="button"
          disabled={mutationDisabled || batchSelectedIds.length === 0}
          onClick={() => onAction({ type: "set-items-locked", ids: batchSelectedIds, locked: true })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label={`현재 결과의 선택 ${batchSelectedIds.length}개 잠금`}
        >
          <Lock size={13} />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        disabled={mutationDisabled || batchUnlockIds.length === 0}
        unavailableReason={
          readOnly
            ? "읽기 전용 작업공간에서는 레이어 잠금을 해제할 수 없어요."
            : batchUnlockIds.length === 0
              ? batchUnlockBlockedCount > 0
                ? `잠긴 상위 그룹 안의 ${batchUnlockBlockedCount}개는 그룹 잠금을 먼저 풀어야 해요.`
                : "현재 선택에는 잠금을 풀 수 있는 레이어가 없어요."
              : undefined
        }
        preferredSide="top"
        hint={{
          id: "layer-batch-unlock",
          title: "선택 레이어 잠금 해제",
          description: "선택한 레이어의 보호 상태를 풀어 다시 이동·변형·편집할 수 있게 합니다.",
          preview: "layer-lock",
        }}
      >
        <button
          type="button"
          disabled={mutationDisabled || batchUnlockIds.length === 0}
          onClick={() => onAction({ type: "set-items-locked", ids: batchUnlockIds, locked: false })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label={`현재 결과의 선택 ${batchUnlockIds.length}개 잠금 해제${
            batchUnlockBlockedCount > 0 ? `, 잠긴 상위 그룹 ${batchUnlockBlockedCount}개 제외` : ""
          }`}
        >
          <LockOpen size={13} />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        disabled={mutationDisabled || batchSelectedIds.length < 2}
        unavailableReason={
          readOnly
            ? "읽기 전용 작업공간에서는 레이어를 병합할 수 없어요."
            : batchSelectedIds.length < 2
              ? "병합할 레이어를 두 개 이상 선택하세요."
              : undefined
        }
        preferredSide="top"
        hint={{
          id: "layer-batch-merge-selected",
          title: batchMergeFallbackNote ? "선택 레이어 묶기 (병합 보류)" : "선택 레이어 병합",
          description:
            batchMergeFallbackNote ??
            "선택한 두 개 이상의 레이어를 표시 순서대로 하나의 결과로 합칩니다.",
          preview: "layer-merge",
          tip: "편집 가능한 원본을 유지하려면 병합 전에 프로젝트 체크포인트를 만들어 두세요.",
        }}
      >
        <button
          type="button"
          disabled={mutationDisabled || batchSelectedIds.length < 2}
          onClick={() => onAction({ type: "merge-selected", ids: batchSelectedIds })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label="선택 레이어 병합"
          aria-describedby={batchMergeFallbackNote ? mergeFallbackNoteId : undefined}
          title={batchMergeFallbackNote ?? undefined}
        >
          <Layers3 size={13} />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        disabled={mutationDisabled}
        unavailableReason={
          readOnly ? "읽기 전용 작업공간에서는 표시 레이어를 병합할 수 없어요." : undefined
        }
        preferredSide="top"
        hint={{
          id: "layer-batch-flatten-visible",
          title: flattenVisibleFallbackNote ? "표시 레이어 묶기 (병합 보류)" : "표시 레이어 병합",
          description:
            flattenVisibleFallbackNote ??
            "현재 보이는 레이어 전체를 화면에 보이는 순서대로 하나의 결과로 합칩니다.",
          preview: "layer-merge",
          tip: "숨겨진 레이어는 결과에 포함되지 않아요.",
        }}
      >
        <button
          type="button"
          disabled={mutationDisabled}
          onClick={() => onAction({ type: "flatten-visible" })}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label="표시 레이어 병합"
          aria-describedby={flattenVisibleFallbackNote ? flattenFallbackNoteId : undefined}
          title={flattenVisibleFallbackNote ?? undefined}
        >
          <Grid2X2 size={13} />
        </button>
      </StudioToolHintTarget>
      <StudioToolHintTarget
        preferredSide="top"
        hint={{
          id: "layer-batch-more",
          title: "일괄 작업 더보기",
          description: "선택 레이어의 그룹·역할·색 라벨·삭제 작업을 한 메뉴에서 실행합니다.",
          preview: "layer-actions",
        }}
      >
        <button
          type="button"
          onClick={(event) => onOpenActionMenu(event, { kind: "batch", id: "selection" })}
          aria-haspopup="dialog"
          aria-expanded={actionTargetKind === "batch"}
          aria-controls={actionPopoverId}
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label="선택 레이어 일괄 작업 더보기"
        >
          <MoreHorizontal size={15} />
        </button>
      </StudioToolHintTarget>
    </div>
  );
}
