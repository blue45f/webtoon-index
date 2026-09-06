import { History as HistoryIcon, Redo2, Undo2 } from "lucide-react";
import { memo, type ComponentProps } from "react";

import {
  StudioQuickActionsBar,
  studioChromeIconClass,
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
} from "./studio-chrome-ui";
import { studioToolHintFromLabel } from "./studio-tool-hints";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { PageState } from "./studio-page-state";

import { cn } from "@/shared/lib/utils";

type StudioToolBeltHintTargetProps = Omit<ComponentProps<typeof StudioToolHintTarget>, "preferredSide">;

function StudioToolBeltHintTarget(props: StudioToolBeltHintTargetProps) {
  return <StudioToolHintTarget preferredSide="bottom" {...props} />;
}

const QUICK_ACTION_HINTS = {
  undo: studioToolHintFromLabel(
    "실행취소",
    "가장 최근 편집 작업을 한 단계 되돌립니다.",
    "⌘Z"
  ),
  redo: studioToolHintFromLabel(
    "다시실행",
    "실행취소로 되돌린 작업을 한 단계 다시 적용합니다.",
    "⌘⇧Z"
  ),
  history: studioToolHintFromLabel(
    "작업 내역",
    "편집 기록을 열어 이전 작업 지점을 확인하고 원하는 상태로 이동합니다.",
    undefined,
    "history"
  ),
} as const;

export interface StudioToolBeltQuickActionsProps {
  collaborationDocumentLocked: boolean;
  collaborationLockMessage: () => string;
  hi: number;
  buttonClass?: string;
  history: PageState[][];
  historyPanelOpen: boolean;
  isRedoDisabled: boolean;
  isUndoDisabled: boolean;
  redo: () => void;
  setHistoryPanelOpen: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  toolBtn: (active: boolean) => string;
  undo: () => void;
}

export const StudioToolBeltQuickActions = memo(function StudioToolBeltQuickActions(
  props: StudioToolBeltQuickActionsProps,
) {
  const {
    collaborationDocumentLocked,
    collaborationLockMessage,
    hi,
    history,
    buttonClass,
    historyPanelOpen,
    isRedoDisabled,
    isUndoDisabled,
    redo,
    setHistoryPanelOpen,
    toolBtn,
    undo,
  } = props;

  return (
    <StudioQuickActionsBar>
      <StudioToolBeltHintTarget
        hint={QUICK_ACTION_HINTS.undo}
        disabled={isUndoDisabled}
        unavailableReason={
          collaborationDocumentLocked
            ? collaborationLockMessage()
            : hi === 0
              ? "되돌릴 이전 작업이 없습니다."
              : undefined
        }
      >
        <button
          type="button"
          onClick={undo}
          disabled={isUndoDisabled}
          className={cn(toolBtn(false), "h-8 px-1.5 disabled:opacity-40", buttonClass)}
          aria-label="실행취소"
        >
          <Undo2
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({
              tone: isUndoDisabled ? "muted" : "default",
              disabled: isUndoDisabled,
            })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget
        hint={QUICK_ACTION_HINTS.redo}
        disabled={isRedoDisabled}
        unavailableReason={
          collaborationDocumentLocked
            ? collaborationLockMessage()
            : hi >= history.length - 1
              ? "다시 적용할 작업이 없습니다."
              : undefined
        }
      >
        <button
          type="button"
          onClick={redo}
          disabled={isRedoDisabled}
          className={cn(toolBtn(false), "h-8 px-1.5 disabled:opacity-40", buttonClass)}
          aria-label="다시실행"
        >
          <Redo2
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({
              tone: isRedoDisabled ? "muted" : "default",
              disabled: isRedoDisabled,
            })}
          />
        </button>
      </StudioToolBeltHintTarget>
      <StudioToolBeltHintTarget hint={QUICK_ACTION_HINTS.history}>
        <button
          type="button"
          onClick={() => setHistoryPanelOpen((v) => !v)}
          aria-pressed={historyPanelOpen}
          className={cn(toolBtn(historyPanelOpen), "h-8 px-1.5", buttonClass)}
          aria-label="작업 내역"
        >
          <HistoryIcon
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({
              tone: historyPanelOpen ? "accent" : "default",
              active: historyPanelOpen,
            })}
          />
        </button>
      </StudioToolBeltHintTarget>
    </StudioQuickActionsBar>
  );
});
