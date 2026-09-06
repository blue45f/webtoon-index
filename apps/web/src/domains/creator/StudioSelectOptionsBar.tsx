/**
 * Select tool options strip — Photoshop / CSP-style context actions when elements are selected.
 * Icon-first commercial chrome; labels live in title/aria.
 */
import {
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Lock,
  LockOpen,
  MessageSquareText,
  MousePointer2,
  ScanText,
  Trash2,
  type LucideIcon,
} from "lucide-react";

import {
  studioSelectionBadgeText,
  studioSelectionCountChip,
} from "./studio-commercial-residuals";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "./studio-panel-ui";
import { StudioToolHintTarget } from "./StudioToolHint";

import type {
  StudioToolHintPreviewKind,
  StudioToolHintPreviewVariant,
} from "./studio-tool-hint-preview-kind";
import type { StudioToolHintSpec } from "./studio-tool-hints";
import type { ReactElement } from "react";

import { cn } from "@/shared/lib/utils";

export interface StudioSelectOptionsBarProps {
  selectionLabel: string | null;
  selectionCount: number;
  locked?: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onBringFront: () => void;
  onSendBack: () => void;
  textEditLabel?: "대사 편집" | "글자 편집" | null;
  onEditText?: () => void;
  onFitBubble?: () => void;
  onToggleLock?: () => void;
  className?: string;
}

function Action({
  id,
  icon: Icon,
  label,
  description,
  preview,
  previewVariant,
  tip,
  danger,
  showLabel,
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  description: string;
  preview: StudioToolHintPreviewKind;
  previewVariant?: StudioToolHintPreviewVariant<"bubble">;
  tip?: string;
  danger?: boolean;
  showLabel?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <StudioToolHintTarget
      preferredSide="bottom"
      hint={{
        id: `selection-action-${id}`,
        title: label,
        description,
        preview,
        previewVariant,
        tip,
      } as StudioToolHintSpec}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          showLabel
            ? "inline-flex h-11 items-center gap-1.5 rounded-xl border px-2.5 sm:h-8"
            : "grid size-11 place-items-center rounded-xl border sm:size-8",
          STUDIO_EASE,
          STUDIO_FOCUS_RING,
          danger
            ? "border-bad/35 bg-bad/10 text-bad hover:bg-bad/15"
            : "border-line/70 bg-card/95 text-fg-2 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.05)] hover:border-line hover:bg-raised hover:text-fg"
        )}
      >
        <Icon size={14} strokeWidth={1.75} aria-hidden />
        {showLabel ? <span className="text-[0.68rem] font-semibold">{label}</span> : null}
      </button>
    </StudioToolHintTarget>
  );
}

export function StudioSelectOptionsBar({
  selectionLabel,
  selectionCount,
  locked = false,
  onDuplicate,
  onDelete,
  onBringFront,
  onSendBack,
  textEditLabel,
  onEditText,
  onFitBubble,
  onToggleLock,
  className,
}: StudioSelectOptionsBarProps): ReactElement | null {
  if (selectionCount <= 0) return null;
  const badgeText = studioSelectionBadgeText(selectionCount, selectionLabel);
  const countChip = studioSelectionCountChip(selectionCount);
  return (
    <div
      role="toolbar"
      aria-label="선택 옵션"
      data-studio-select-options="true"
      data-studio-icon-first="true"
      className={cn(
        "relative z-[40] flex h-11 min-h-11 shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-b border-line px-2.5",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      <span
        data-studio-selection-badge="true"
        title={selectionCount > 1 ? `${selectionCount}개 선택` : badgeText}
        className={cn(
          "mr-0.5 inline-flex max-w-[12rem] items-center gap-1.5 truncate rounded-xl border border-accent/35",
          "bg-[linear-gradient(135deg,oklch(0.72_0.185_42/0.16),oklch(0.2_0.01_66/0.55))] px-2 py-1",
          "text-[0.68rem] font-bold tracking-tight text-fg shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.08)]"
        )}
      >
        <span
          aria-hidden
          className="grid size-6 shrink-0 place-items-center rounded-md bg-accent text-on-accent"
        >
          {selectionCount > 1 ? (
            <span className="text-[0.58rem] font-black tabular-nums">{countChip}</span>
          ) : (
            <MousePointer2 size={12} strokeWidth={1.75} />
          )}
        </span>
        {selectionCount === 1 ? (
          <span className="min-w-0 truncate">{badgeText}</span>
        ) : (
          <span className="sr-only">{selectionCount}개 선택</span>
        )}
      </span>
      {textEditLabel && onEditText ? (
        <Action
          id="edit-text"
          icon={MessageSquareText}
          label={textEditLabel}
          description="선택한 레터링을 캔버스 위에서 바로 수정합니다. 기본 문구는 곧바로 덮어쓸 수 있어요."
          preview="text"
          tip="T를 눌러도 선택한 말풍선이나 글자를 즉시 편집할 수 있어요."
          showLabel
          onClick={onEditText}
        />
      ) : null}
      {onFitBubble ? (
        <Action
          id="fit-bubble"
          icon={ScanText}
          label="텍스트 맞춤"
          description="대사 길이에 맞춰 말풍선 높이를 자동으로 조절합니다."
          preview="bubble"
          previewVariant="fit-text"
          tip="긴 대사를 붙여넣은 뒤 한 번 눌러 여백을 정돈하세요."
          onClick={onFitBubble}
        />
      ) : null}
      <div className="studio-opt-cluster flex shrink-0 items-center gap-0.5">
        <Action
          id="duplicate"
          icon={Copy}
          label="복제"
          description="선택한 요소를 같은 위치에 복제해 즉시 이동하거나 변형할 수 있게 합니다."
          preview="layer-duplicate"
          tip="복제 직후 방향키로 살짝 이동하면 원본과 겹치지 않게 배치할 수 있어요."
          onClick={onDuplicate}
        />
        <Action
          id="bring-front"
          icon={ArrowUpToLine}
          label="맨 앞"
          description="선택한 요소를 현재 페이지의 가장 앞쪽으로 올립니다."
          preview="layer-reorder-front"
          tip="말풍선과 효과음처럼 항상 보여야 하는 요소를 정리할 때 유용해요."
          onClick={onBringFront}
        />
        <Action
          id="send-back"
          icon={ArrowDownToLine}
          label="맨 뒤"
          description="선택한 요소를 현재 페이지의 가장 뒤쪽으로 보냅니다."
          preview="layer-reorder-back"
          tip="배경이나 톤 소재를 다른 모든 요소 뒤로 정리할 때 사용하세요."
          onClick={onSendBack}
        />
        {onToggleLock ? (
          <Action
            id={locked ? "unlock" : "lock"}
            icon={locked ? LockOpen : Lock}
            label={locked ? "잠금 해제" : "잠금"}
            description={
              locked
                ? "선택 요소의 잠금을 풀어 다시 이동·변형·편집할 수 있게 합니다."
                : "선택 요소를 고정해 실수로 이동하거나 편집하지 않도록 보호합니다."
            }
            preview="layer-lock"
            onClick={onToggleLock}
          />
        ) : null}
      </div>
      <Action
        id="delete"
        icon={Trash2}
        label="삭제"
        description="현재 선택한 요소를 페이지에서 제거합니다. 실행취소로 되돌릴 수 있어요."
        preview="layer-delete"
        tip="여러 요소를 선택했다면 모두 한 번에 삭제됩니다."
        danger
        onClick={onDelete}
      />
    </div>
  );
}
