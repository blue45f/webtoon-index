import {
  ArrowDownToLine,
  ArrowUpToLine,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Combine,
  FlipHorizontal2,
  FlipVertical2,
  FolderMinus,
  FolderPlus,
  Lock,
  LockOpen,
  Loader2,
  PaintBucket,
  ScanSearch,
} from "lucide-react";
import { useRef } from "react";

import { presentStudioAutosaveDocumentLeadership } from "../studio-autosave-document-leader";
import { StudioReliabilityStatusRail } from "../StudioReliabilityStatusRail";
import { StudioToolHintTarget } from "../StudioToolHint";

import type {
  StudioAutosaveDocumentLeadershipBasis,
  StudioAutosaveDocumentRole,
} from "../studio-autosave-document-leader";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";
import { useIsMobile } from "@/src/hooks/use-media-query";

const SELECTION_LAYOUT_HINTS = {
  group: {
    id: "selection-layout-group",
    title: "선택 요소 그룹화",
    description: "선택한 요소 2개 이상을 한 조작 단위로 묶고, 만든 그룹을 계속 선택한 상태로 둡니다.",
    preview: "selection-layout",
    previewVariant: "group",
    tip: "그룹은 함께 이동·변형되며 레이어 패널에서 한 번에 잠그거나 다시 해제할 수 있어요.",
  },
  ungroup: {
    id: "selection-layout-ungroup",
    title: "그룹 해제",
    description: "선택한 그룹의 요소는 그대로 두고, 함께 묶인 관계만 해제합니다.",
    tip: "요소의 위치와 앞뒤 순서는 바뀌지 않으며 한 번에 실행 취소할 수 있어요.",
  },
  lock: {
    id: "selection-layout-lock",
    title: "선택 잠금",
    description: "선택 요소를 실수로 이동하거나 변형하지 않도록 한 번에 잠급니다.",
    tip: "그룹 전체를 선택했다면 그룹 잠금으로 저장되어 새 멤버에도 일관되게 적용됩니다.",
  },
  unlock: {
    id: "selection-layout-unlock",
    title: "선택 잠금 해제",
    description: "선택 요소 또는 그룹의 잠금을 한 번에 풀어 다시 편집할 수 있게 합니다.",
  },
  front: {
    id: "selection-layout-front",
    title: "맨 앞으로",
    description: "선택한 요소와 완전한 그룹을 상대 순서 그대로 문서 맨 앞으로 옮깁니다.",
  },
  back: {
    id: "selection-layout-back",
    title: "맨 뒤로",
    description: "선택한 요소와 완전한 그룹을 상대 순서 그대로 문서 맨 뒤로 옮깁니다.",
  },
  left: {
    id: "selection-layout-align-left",
    title: "왼쪽 정렬",
    description:
      "하나만 선택하면 포함 패널(없으면 캔버스)의 왼쪽에, 여러 개면 선택 범위의 왼쪽 끝에 맞춥니다.",
    preview: "selection-layout",
    previewVariant: "align-left",
  },
  hcenter: {
    id: "selection-layout-align-hcenter",
    title: "가로 가운데 정렬",
    description:
      "하나만 선택하면 포함 패널(없으면 캔버스)의 가로 중앙에, 여러 개면 선택 범위의 가로 중앙에 맞춥니다.",
    preview: "selection-layout",
    previewVariant: "align-hcenter",
  },
  right: {
    id: "selection-layout-align-right",
    title: "오른쪽 정렬",
    description:
      "하나만 선택하면 포함 패널(없으면 캔버스)의 오른쪽에, 여러 개면 선택 범위의 오른쪽 끝에 맞춥니다.",
    preview: "selection-layout",
    previewVariant: "align-right",
  },
  top: {
    id: "selection-layout-align-top",
    title: "위쪽 정렬",
    description:
      "하나만 선택하면 포함 패널(없으면 캔버스)의 위쪽에, 여러 개면 선택 범위의 위쪽 끝에 맞춥니다.",
    preview: "selection-layout",
    previewVariant: "align-top",
  },
  vcenter: {
    id: "selection-layout-align-vcenter",
    title: "세로 가운데 정렬",
    description:
      "하나만 선택하면 포함 패널(없으면 캔버스)의 세로 중앙에, 여러 개면 선택 범위의 세로 중앙에 맞춥니다.",
    preview: "selection-layout",
    previewVariant: "align-vcenter",
  },
  bottom: {
    id: "selection-layout-align-bottom",
    title: "아래쪽 정렬",
    description:
      "하나만 선택하면 포함 패널(없으면 캔버스)의 아래쪽에, 여러 개면 선택 범위의 아래쪽 끝에 맞춥니다.",
    preview: "selection-layout",
    previewVariant: "align-bottom",
  },
  distributeH: {
    id: "selection-layout-distribute-horizontal",
    title: "가로 균등 분배",
    description:
      "3개 이상 선택했을 때 양 끝 요소의 중심은 고정하고, 사이 요소의 중심을 같은 가로 간격으로 배치합니다.",
    preview: "selection-layout",
    previewVariant: "distribute-horizontal",
  },
  distributeV: {
    id: "selection-layout-distribute-vertical",
    title: "세로 균등 분배",
    description:
      "3개 이상 선택했을 때 위·아래 끝 요소의 중심은 고정하고, 사이 요소의 중심을 같은 세로 간격으로 배치합니다.",
    preview: "selection-layout",
    previewVariant: "distribute-vertical",
  },
  zoomToSelection: {
    id: "selection-layout-zoom-to-selection",
    title: "선택 영역으로 확대",
    description:
      "선택 범위가 화면 대부분을 채우도록 확대합니다. Figma의 Zoom to selection과 같은 빠른 포커스예요.",
    tip: "단축키 ⇧F",
    preview: "zoom-view",
    previewVariant: "zoom-in",
  },
  flipH: {
    id: "selection-layout-flip-horizontal",
    title: "좌우 반전",
    description:
      "선택 범위 중심을 기준으로 좌우로 뒤집습니다. 이미지는 그림까지 미러링되고, 여러 개를 골랐다면 배치가 뒤집혀요.",
    tip: "단축키 ⇧H",
    preview: "selection-layout",
    previewVariant: "flip-horizontal",
  },
  flipV: {
    id: "selection-layout-flip-vertical",
    title: "상하 반전",
    description:
      "선택 범위 중심을 기준으로 상하로 뒤집습니다. 이미지는 그림까지 미러링되고, 여러 개를 골랐다면 배치가 뒤집혀요.",
    tip: "단축키 ⇧V",
    preview: "selection-layout",
    previewVariant: "flip-vertical",
  },
} as const;

export type StudioCanvasSelectionAlignment =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "distributeH"
  | "distributeV";

type SelectionLayoutHint = (typeof SELECTION_LAYOUT_HINTS)[keyof typeof SELECTION_LAYOUT_HINTS];
export type StudioCanvasSelectionLockState = "locked" | "unlocked" | "mixed";

const HORIZONTAL_ALIGNMENT_ACTIONS = [
  ["left", "선택 요소 왼쪽 정렬", SELECTION_LAYOUT_HINTS.left, AlignLeft],
  ["hcenter", "선택 요소 가로 가운데 정렬", SELECTION_LAYOUT_HINTS.hcenter, AlignCenter],
  ["right", "선택 요소 오른쪽 정렬", SELECTION_LAYOUT_HINTS.right, AlignRight],
] as const;

const VERTICAL_ALIGNMENT_ACTIONS = [
  ["top", "선택 요소 위쪽 정렬", SELECTION_LAYOUT_HINTS.top, "상"],
  ["vcenter", "선택 요소 세로 가운데 정렬", SELECTION_LAYOUT_HINTS.vcenter, "중"],
  ["bottom", "선택 요소 아래쪽 정렬", SELECTION_LAYOUT_HINTS.bottom, "하"],
] as const;

const DISTRIBUTION_ACTIONS = [
  ["distributeH", "선택 요소 가로 균등 분배", SELECTION_LAYOUT_HINTS.distributeH, "가로 분배"],
  ["distributeV", "선택 요소 세로 균등 분배", SELECTION_LAYOUT_HINTS.distributeV, "세로 분배"],
] as const;

function SelectionLayoutAction({
  hint,
  label,
  onClick,
  className,
  ariaKeyShortcuts,
  disabled = false,
  unavailableReason,
  children,
}: {
  hint: SelectionLayoutHint;
  label: string;
  onClick: () => void;
  className: string;
  ariaKeyShortcuts?: string;
  disabled?: boolean;
  unavailableReason?: string;
  children: ReactNode;
}) {
  return (
    <StudioToolHintTarget
      hint={hint}
      disabled={disabled}
      unavailableReason={unavailableReason}
      preferredSide="top"
    >
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          className,
          "max-lg:min-h-11 max-lg:min-w-11 pointer-coarse:min-h-11 pointer-coarse:min-w-11",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          "disabled:cursor-not-allowed disabled:opacity-45"
        )}
        aria-label={label}
        aria-keyshortcuts={ariaKeyShortcuts}
      >
        {children}
      </button>
    </StudioToolHintTarget>
  );
}

export interface StudioCanvasStatusRailProps {
  mobileImmersive: boolean;
  hasAutosave: boolean;
  autosaveRestoreBlockedReason:
    | "legacy-unversioned"
    | "work-mismatch"
    | "revision-mismatch"
    | null;
  selectionCount: number;
  advancedFillBusy: boolean;
  advancedFillPreviewMessage: string | null;
  advancedFillActive: boolean;
  /** 그룹 내부 편집 모드에서 지속적으로 표시할 현재 그룹 이름. */
  activeGroupName?: string | null;
  selectionGroupName?: string | null;
  selectionLockState?: StudioCanvasSelectionLockState;
  groupSelectionDisabledReason?: string | null;
  lockSelectionDisabledReason?: string | null;
  layoutSelectionDisabledReason?: string | null;
  alignmentSelectionDisabledReason?: string | null;
  onDownloadAutosaveBackup: () => void;
  onRestoreAutosave: () => void | Promise<void>;
  /**
   * 임시저장본 영구 삭제. 파괴 승인 다이얼로그를 지나므로 비동기다 — 승인 결과와 무관하게
   * 결정이 끝나면 안전한 기본 행동인 "복구하기"로 포커스를 되돌린다.
   */
  onClearAutosave: () => void | Promise<void>;
  /**
   * 이 탭이 문서 저장을 맡는지(leader) 아닌지(follower). 결정 전(`null`)에는 아무 고지도
   * 하지 않는다 — 아직 모르는 것을 단정하는 쪽이 더 나쁜 실패다.
   */
  autosaveLiveJam?: boolean;
  autosaveDocumentLeadership?: {
    readonly role: StudioAutosaveDocumentRole;
    readonly basis: StudioAutosaveDocumentLeadershipBasis;
  } | null;
  onGroupSelection: () => void;
  onUngroupSelection?: () => void;
  onToggleSelectionLock?: () => void;
  onReorderSelection?: (direction: "front" | "back") => void;
  onAlignSelection: (alignment: StudioCanvasSelectionAlignment) => void;
  /** Figma-like zoom-to-selection / flip affordances on the selection chip strip. */
  onZoomToSelection?: () => void;
  onFlipSelection?: (axis: "horizontal" | "vertical") => void;
  /** 다중 선택에 병합 가능한 말풍선(2개 이상)이 있어 "말풍선 병합" 액션을 노출할지. */
  showBubbleMerge?: boolean;
  /** 병합 비활성 사유(null이면 활성) — 혼합 선택·개수 범위 초과 시 툴팁으로 안내. */
  bubbleMergeDisabledReason?: string | null;
  onMergeBubbles?: () => void;
  onDuplicateSelection: () => void;
  onRemoveSelection: () => void;
  onClearSelection: () => void;
  onCancelAdvancedFillPreview: () => void;
  onApplyAdvancedFillPreview: () => void;
  onCancelAdvancedFillCalculation: () => void;
}

export function StudioCanvasStatusRail({
  mobileImmersive,
  hasAutosave,
  autosaveRestoreBlockedReason,
  selectionCount,
  advancedFillBusy,
  advancedFillPreviewMessage,
  advancedFillActive,
  activeGroupName = null,
  selectionGroupName = null,
  selectionLockState = "unlocked",
  groupSelectionDisabledReason = null,
  lockSelectionDisabledReason = null,
  layoutSelectionDisabledReason = null,
  alignmentSelectionDisabledReason = null,
  onDownloadAutosaveBackup,
  onRestoreAutosave,
  onClearAutosave,
  autosaveLiveJam = false,
  autosaveDocumentLeadership = null,
  onGroupSelection,
  onUngroupSelection,
  onToggleSelectionLock,
  onReorderSelection,
  onAlignSelection,
  onZoomToSelection,
  onFlipSelection,
  showBubbleMerge = false,
  bubbleMergeDisabledReason = null,
  onMergeBubbles,
  onDuplicateSelection,
  onRemoveSelection,
  onClearSelection,
  onCancelAdvancedFillPreview,
  onApplyAdvancedFillPreview,
  onCancelAdvancedFillCalculation,
}: StudioCanvasStatusRailProps) {
  const hasAdvancedFillPreview = advancedFillPreviewMessage !== null;
  const normalizedActiveGroupName = activeGroupName?.trim() || null;
  /**
   * 모바일(<lg)에는 선택 명령 레인을 **예약조차 하지 않는다.**
   *
   * 상시 예약은 "선택이 캔버스 기하를 바꾸지 못하게" 하려고 도입했고 그 목적은 지금도
   * 유효하다. 다만 360×640 에서는 예약 비용이 그대로 그리기 면적 손실이다(레인 43px +
   * mb-2 8px = 51px). 게다가 이 레인의 명령은 모바일에서 이미 중복이다 — 요소를 고르면
   * 플로팅 "선택 항목 빠른 작업" 바가 속성·복제·앞으로·뒤로·잠금·대사 편집·삭제·해제를
   * 엄지 영역에 띄운다.
   *
   * 조건이 **선택 상태가 아니라 뷰포트**라는 점이 핵심이다. 모바일에서는 선택 유무와
   * 무관하게 항상 없으므로, 예약을 없애도 "선택 시 레이아웃 이동 0px" 불변식은 그대로다.
   * 데스크톱(lg 이상)은 현행 상시 예약을 유지한다.
   */
  const selectionCommandLaneMounted = !useIsMobile();
  /**
   * 후발(follower) 탭에는 **복구 버튼이 뜨면 안 된다.** 누르면 선행 탭의 문서를 메모리에
   * 올려놓고 저장은 못 하는 최악의 상태가 된다 — 화면에는 작업이 있는데 어디에도 남지 않는다.
   * 그래서 복구 배너 자리를 읽기 전용 고지로 통째로 대체한다.
   */
  const followerNotice =
    autosaveDocumentLeadership && autosaveDocumentLeadership.role === "follower"
      ? presentStudioAutosaveDocumentLeadership(autosaveDocumentLeadership, {
          liveJam: autosaveLiveJam,
        })
      : null;
  // 복구 배너의 안전한 기본 행동은 "복구하기"(복구가 막혔으면 "JSON 백업")다. 영구 삭제
  // 승인 창을 닫고 나면 포커스를 파괴 버튼이 아니라 이 안전한 쪽에 되돌려 준다.
  const autosaveSafeActionRef = useRef<HTMLButtonElement | null>(null);
  const requestClearAutosave = () => {
    void Promise.resolve(onClearAutosave()).finally(() => {
      autosaveSafeActionRef.current?.focus();
    });
  };

  /**
   * 모바일 몰입 모드의 고지 띠에 **지금 담긴 것이 있는지**.
   *
   * 예전에는 이 띠가 늘 흐름 안에 있었고, 담긴 것이 하나도 없어도 떠 있는 상단 바를
   * 피하려는 3.75rem(60px) 여백만으로 세로 60px 을 먹었다. 360×640 에서 60px 은 그리기
   * 면적의 9.4% 다. 아래 분기는 그 예약을 "담을 게 있을 때만"으로 좁힌다.
   */
  const mobileNoticeStripFilled =
    followerNotice !== null
    || hasAutosave
    || normalizedActiveGroupName !== null
    || selectionCommandLaneMounted
    || advancedFillBusy
    || hasAdvancedFillPreview;

  return (
    <>
      {/*
       * 저장·GPU·저장소 상태와 Safe Mode 고지 — prop 없이 스토어를 직접 구독한다.
       * 레일 자신이 absolute 오버레이(캔버스 오른쪽 아래 HUD 줄)라 흐름 높이는 0 이다.
       * 여기서는 바닥 오프셋만 정해 준다: 모바일에는 떠 있는 편집 독이 있어 그만큼 띄운다.
       */}
      <div
        data-studio-reliability-overlay-anchor
        className="contents"
        style={
          selectionCommandLaneMounted
            ? undefined
            : ({
                "--studio-reliability-rail-bottom":
                  "calc(5.5rem + env(safe-area-inset-bottom))",
              } as CSSProperties)
        }
      >
        <StudioReliabilityStatusRail />
      </div>

      <div
        data-studio-canvas-status-rail
        data-studio-canvas-status-rail-filled={mobileImmersive ? String(mobileNoticeStripFilled) : undefined}
        style={mobileImmersive && mobileNoticeStripFilled ? { paddingTop: "3.75rem" } : undefined}
        className={cn(
          mobileImmersive
            ? mobileNoticeStripFilled
              /*
               * 담을 게 생기면 **캔버스를 밀지 않고 덮는다.** 흐름 안에 있었다면 배너가
               * 붙는 순간 스테이지 원점이 통째로 내려가고, 이미 시작된 Konva 드래그·획이
               * 그만큼 튄다(선택 명령 레인이 상시 예약으로 막아 둔 것과 같은 결함).
               */
              // 우상단 presence dock은 모바일에서 44px 아이콘과 컨테이너 여백을 쓴다.
              // 복구/비우기 같은 안전 조치가 그 아래로 들어가면 두 버튼이 동시에 눌리는
              // 치명적 상태가 되므로 모든 고지 카드에 해당 hit-area를 구조적으로 비워 둔다.
              ? "absolute inset-x-0 top-0 z-20 max-h-[min(30dvh,12rem)] overflow-y-auto overscroll-contain pl-2 pr-[5.25rem] [scrollbar-gutter:stable]"
              : "hidden"
            : "contents"
        )}
      >
      {followerNotice ? (
        <div
          data-studio-autosave-document-follower
          data-studio-autosave-live-jam={followerNotice.tone === "good" ? "true" : undefined}
          role="status"
          aria-live="polite"
          className={cn(
            "mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2.5 text-xs",
            followerNotice.tone === "good"
              ? "border-accent/30 bg-accent-soft/20 text-fg"
              : "border-warning/30 bg-warning-soft/20 text-warning",
          )}
        >
          <span className="min-w-0 flex-1 leading-relaxed">
            <strong className="block font-bold">
              {followerNotice.tone === "warn" ? "⚠️ " : null}
              {followerNotice.title}
            </strong>
            <span className="mt-0.5 block font-medium">{followerNotice.detail}</span>
          </span>
          {followerNotice.actionLabel ? (
            <button
              type="button"
              onClick={() => globalThis.location.reload()}
              className="ml-auto min-h-11 shrink-0 rounded-lg bg-accent/20 px-3 py-2 font-bold text-accent hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {followerNotice.actionLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {hasAutosave && !followerNotice && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning/30 bg-warning-soft/20 p-2.5 text-xs text-warning">
          <span className="min-w-0 flex-1 font-medium leading-relaxed">
            {autosaveRestoreBlockedReason
              ? autosaveRestoreBlockedReason === "revision-mismatch"
                ? "⚠️ 임시저장본이 현재 서버 revision과 달라 자동 복구를 차단했습니다. JSON으로 백업해 수동 병합해 주세요."
                : "⚠️ 출처 revision을 확인할 수 없는 공동 임시저장본입니다. 자동 복구하지 않고 원본을 보존합니다."
              : "⚠️ 이전에 작성 중이던 임시저장 데이터가 있습니다."}
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {autosaveRestoreBlockedReason ? (
              <button
                type="button"
                ref={autosaveSafeActionRef}
                onClick={onDownloadAutosaveBackup}
                className="min-h-11 rounded-lg bg-accent/20 px-3 py-2 font-bold text-accent hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                JSON 백업
              </button>
            ) : (
              <button
                type="button"
                ref={autosaveSafeActionRef}
                onClick={() => void onRestoreAutosave()}
                className="min-h-11 rounded-lg bg-accent/20 px-3 py-2 font-bold text-accent hover:bg-accent/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                복구하기
              </button>
            )}
            <button
              type="button"
              onClick={requestClearAutosave}
              className="min-h-11 rounded-lg bg-line px-3 py-2 font-medium text-fg-3 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              비우기
            </button>
          </div>
        </div>
      )}

      {normalizedActiveGroupName ? (
        <div
          data-studio-group-internal-edit-status
          role="status"
          aria-live="polite"
          aria-atomic="true"
          aria-label={`${normalizedActiveGroupName} 내부 편집 중. Esc로 그룹 전체 선택`}
          className="mb-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-cool/35 bg-cool/10 px-2.5 py-1.5 text-xs text-cool"
        >
          <span className="flex min-w-0 max-w-full items-center gap-1.5 font-semibold">
            <span className="size-1.5 shrink-0 rounded-full bg-cool" aria-hidden />
            <span className="min-w-0 max-w-[min(12rem,58vw)] truncate">
              {normalizedActiveGroupName}
            </span>
            <span className="shrink-0 text-cool/60" aria-hidden>
              ·
            </span>
            <span className="shrink-0">내부 편집</span>
          </span>
          <span className="ml-auto shrink-0 text-[0.68rem] font-medium text-fg-3">
            <kbd className="mr-1 rounded border border-line bg-panel px-1.5 py-0.5 font-sans text-[0.62rem] font-bold text-fg-2">
              Esc
            </kbd>
            로 그룹 전체 선택
          </span>
        </div>
      ) : null}

      {/*
       * 선택 명령 레인 — 높이를 **상시 예약**한다.
       *
       * 이 바는 캔버스 열의 흐름(flow) 안에 있고, 선택이 생길 때만 마운트되면 그 아래 캔버스
       * 뷰포트를 통째로 밀어 내린다(실측 51px = 바 43px + mb-2 8px). 그 밀림은 보기 흉한 데서
       * 끝나지 않는다: 요소를 눌러 선택하는 순간 바가 붙으면서 스테이지 원점이 51px 내려가는데,
       * 이미 시작된 Konva 드래그는 누를 때 잡아 둔 원점을 계속 쓰므로 첫 move에서 요소가 정확히
       * 51px 위로 튄다(실측). 즉 "선택 상태가 캔버스 기하를 바꾸는 것" 하나가 두 결함의 뿌리다.
       *
       * 오버레이(absolute)로 띄우면 흰 원고 위를 덮으므로, 이미 §select-options 스트립이 쓰고 있는
       * 관례(빈 상태에도 자리를 잡아 두는 예약 띠)를 그대로 따른다. 선택 유무와 무관하게 레인
       * 높이가 고정되므로 캔버스 원점 이동은 0px이고, 캔버스 콘텐츠는 아무것도 가려지지 않는다.
       *
       * 단, 그 예약은 **데스크톱에서만** 값을 한다 — 모바일 분기는
       * `selectionCommandLaneMounted` 주석 참고.
       */}
      {selectionCommandLaneMounted ? (
      <div
        data-studio-selection-command-lane="true"
        className="mb-2 h-[2.6875rem] shrink-0"
      >
      {selectionCount > 0 ? (
        <div className="flex h-full min-w-0 items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/30 px-2.5 py-1.5 text-xs shadow-sm">
          <span className="flex shrink-0 items-center gap-1.5 font-semibold text-accent">
            <span>{selectionCount}개 선택</span>
            {selectionGroupName ? (
              <span className="max-w-28 truncate rounded-full bg-accent/12 px-2 py-0.5 text-[0.64rem] text-accent">
                {selectionGroupName}
              </span>
            ) : null}
          </span>
          <span className="hidden shrink-0 text-fg-3 xl:inline">
            {selectionGroupName
              ? "드래그·방향키 전체 이동 · 더블클릭 내부 편집"
              : "드래그·방향키 이동 · 정렬·분배"}
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain pb-0.5 [scrollbar-width:thin]">
            {selectionGroupName && onUngroupSelection ? (
              <SelectionLayoutAction
                hint={SELECTION_LAYOUT_HINTS.ungroup}
                label="선택 그룹 해제"
                onClick={onUngroupSelection}
                ariaKeyShortcuts="Shift+Control+G Shift+Meta+G"
                disabled={layoutSelectionDisabledReason !== null}
                unavailableReason={layoutSelectionDisabledReason ?? undefined}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-line bg-card px-2 py-1 font-semibold text-fg-2 transition-colors hover:bg-raised"
              >
                <FolderMinus size={13} aria-hidden />
                <span>그룹 해제</span>
              </SelectionLayoutAction>
            ) : selectionCount >= 2 ? (
              <SelectionLayoutAction
                hint={SELECTION_LAYOUT_HINTS.group}
                label="선택 요소 그룹화"
                onClick={onGroupSelection}
                ariaKeyShortcuts="Control+G Meta+G"
                disabled={groupSelectionDisabledReason !== null}
                unavailableReason={groupSelectionDisabledReason ?? undefined}
                className="flex cursor-pointer items-center gap-1 rounded-md border border-line bg-card px-2 py-1 font-semibold text-fg-2 transition-colors hover:bg-raised"
              >
                <FolderPlus size={13} aria-hidden />
                <span>그룹화</span>
              </SelectionLayoutAction>
            ) : null}
            {onToggleSelectionLock ? (
              <SelectionLayoutAction
                hint={
                  selectionLockState === "locked"
                    ? SELECTION_LAYOUT_HINTS.unlock
                    : SELECTION_LAYOUT_HINTS.lock
                }
                label={
                  selectionLockState === "locked"
                    ? "선택 잠금 해제"
                    : selectionLockState === "mixed"
                      ? "선택 잠금 통일"
                      : "선택 잠금"
                }
                onClick={onToggleSelectionLock}
                disabled={lockSelectionDisabledReason !== null}
                unavailableReason={lockSelectionDisabledReason ?? undefined}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-line bg-card px-2 py-1 font-semibold text-fg-2 transition-colors hover:bg-raised"
              >
                {selectionLockState === "locked" ? (
                  <LockOpen size={13} aria-hidden />
                ) : (
                  <Lock size={13} aria-hidden />
                )}
                <span>{selectionLockState === "locked" ? "잠금 해제" : "잠금"}</span>
                {selectionLockState === "mixed" ? (
                  <span className="rounded bg-warning-soft px-1 text-[0.58rem] text-warning">
                    혼합
                  </span>
                ) : null}
              </SelectionLayoutAction>
            ) : null}
            {showBubbleMerge && onMergeBubbles && (
              <button
                type="button"
                onClick={onMergeBubbles}
                disabled={bubbleMergeDisabledReason !== null}
                aria-label="선택한 말풍선 병합"
                title={
                  bubbleMergeDisabledReason ??
                  "겹친 말풍선을 하나의 외곽선으로 병합합니다(실행취소 1회)."
                }
                className="flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-card"
              >
                <Combine size={13} aria-hidden />
                <span>말풍선 병합</span>
              </button>
            )}
            {onReorderSelection ? (
              <div
                className="inline-flex shrink-0 gap-0.5 rounded-md border border-line bg-card/50 p-0.5"
                role="group"
                aria-label="앞뒤 순서"
              >
                <SelectionLayoutAction
                  hint={SELECTION_LAYOUT_HINTS.front}
                  label="선택 요소 맨 앞으로"
                  onClick={() => onReorderSelection("front")}
                  disabled={layoutSelectionDisabledReason !== null}
                  unavailableReason={layoutSelectionDisabledReason ?? undefined}
                  className="cursor-pointer rounded p-1 text-fg-3 hover:bg-raised hover:text-fg"
                >
                  <ArrowUpToLine size={13} aria-hidden />
                </SelectionLayoutAction>
                <SelectionLayoutAction
                  hint={SELECTION_LAYOUT_HINTS.back}
                  label="선택 요소 맨 뒤로"
                  onClick={() => onReorderSelection("back")}
                  disabled={layoutSelectionDisabledReason !== null}
                  unavailableReason={layoutSelectionDisabledReason ?? undefined}
                  className="cursor-pointer rounded p-1 text-fg-3 hover:bg-raised hover:text-fg"
                >
                  <ArrowDownToLine size={13} aria-hidden />
                </SelectionLayoutAction>
              </div>
            ) : null}
            {onZoomToSelection || onFlipSelection ? (
              <div
                className="inline-flex shrink-0 gap-0.5 rounded-md border border-line bg-card/50 p-0.5"
                role="group"
                aria-label="선택 보기 · 반전"
              >
                {onZoomToSelection ? (
                  <SelectionLayoutAction
                    hint={SELECTION_LAYOUT_HINTS.zoomToSelection}
                    label="선택 영역으로 확대"
                    onClick={onZoomToSelection}
                    ariaKeyShortcuts="Shift+F"
                    className="cursor-pointer rounded p-1 text-fg-3 hover:bg-raised hover:text-fg"
                  >
                    <ScanSearch size={13} aria-hidden />
                  </SelectionLayoutAction>
                ) : null}
                {onFlipSelection ? (
                  <>
                    <SelectionLayoutAction
                      hint={SELECTION_LAYOUT_HINTS.flipH}
                      label="선택 좌우 반전"
                      onClick={() => onFlipSelection("horizontal")}
                      ariaKeyShortcuts="Shift+H"
                      disabled={alignmentSelectionDisabledReason !== null}
                      unavailableReason={alignmentSelectionDisabledReason ?? undefined}
                      className="cursor-pointer rounded p-1 text-fg-3 hover:bg-raised hover:text-fg"
                    >
                      <FlipHorizontal2 size={13} aria-hidden />
                    </SelectionLayoutAction>
                    <SelectionLayoutAction
                      hint={SELECTION_LAYOUT_HINTS.flipV}
                      label="선택 상하 반전"
                      onClick={() => onFlipSelection("vertical")}
                      ariaKeyShortcuts="Shift+V"
                      disabled={alignmentSelectionDisabledReason !== null}
                      unavailableReason={alignmentSelectionDisabledReason ?? undefined}
                      className="cursor-pointer rounded p-1 text-fg-3 hover:bg-raised hover:text-fg"
                    >
                      <FlipVertical2 size={13} aria-hidden />
                    </SelectionLayoutAction>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="mx-1 h-4 w-px shrink-0 bg-line/60" />
            <div
              className="inline-flex shrink-0 gap-0.5 rounded-md border border-line bg-card/50 p-0.5"
              role="group"
              aria-label="가로 정렬"
            >
              {HORIZONTAL_ALIGNMENT_ACTIONS.map(([mode, label, hint, Icon]) => (
                <SelectionLayoutAction
                  key={mode}
                  hint={hint}
                  label={selectionGroupName ? label.replace("선택 요소", "선택 그룹") : label}
                  onClick={() => onAlignSelection(mode)}
                  disabled={alignmentSelectionDisabledReason !== null}
                  unavailableReason={alignmentSelectionDisabledReason ?? undefined}
                  className="cursor-pointer rounded p-1 text-fg-3 hover:bg-raised hover:text-fg"
                >
                  <Icon size={13} aria-hidden />
                </SelectionLayoutAction>
              ))}
            </div>
            <div
              className="inline-flex shrink-0 gap-0.5 rounded-md border border-line bg-card/50 p-0.5"
              role="group"
              aria-label="세로 정렬"
            >
              {VERTICAL_ALIGNMENT_ACTIONS.map(([mode, label, hint, text]) => (
                <SelectionLayoutAction
                  key={mode}
                  hint={hint}
                  label={selectionGroupName ? label.replace("선택 요소", "선택 그룹") : label}
                  onClick={() => onAlignSelection(mode)}
                  disabled={alignmentSelectionDisabledReason !== null}
                  unavailableReason={alignmentSelectionDisabledReason ?? undefined}
                  className="cursor-pointer rounded px-1.5 py-0.5 text-[0.66rem] font-bold text-fg-3 hover:bg-raised hover:text-fg"
                >
                  {text}
                </SelectionLayoutAction>
              ))}
            </div>
            {selectionCount >= 3 && !selectionGroupName && (
              <div
                className="inline-flex shrink-0 gap-0.5 rounded-md border border-line bg-card/50 p-0.5"
                role="group"
                aria-label="균등 분배"
              >
                {DISTRIBUTION_ACTIONS.map(([mode, label, hint, text]) => (
                  <SelectionLayoutAction
                    key={mode}
                    hint={hint}
                    label={label}
                    onClick={() => onAlignSelection(mode)}
                    disabled={alignmentSelectionDisabledReason !== null}
                    unavailableReason={alignmentSelectionDisabledReason ?? undefined}
                    className="cursor-pointer rounded px-1.5 py-0.5 text-[0.66rem] font-bold text-fg-3 hover:bg-raised hover:text-fg"
                  >
                    {text}
                  </SelectionLayoutAction>
                ))}
              </div>
            )}
            <div className="mx-1 h-4 w-px shrink-0 bg-line/60" />
            <button
              type="button"
              onClick={onDuplicateSelection}
              className="shrink-0 cursor-pointer rounded-md border border-line bg-card px-2 py-1 font-semibold text-fg-2 transition-colors hover:bg-raised"
            >
              복제
            </button>
            <button
              type="button"
              onClick={onRemoveSelection}
              className="shrink-0 cursor-pointer rounded-md border border-line bg-card px-2 py-1 font-semibold text-bad transition-colors hover:bg-raised"
            >
              삭제
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="shrink-0 cursor-pointer rounded-md border border-line bg-card px-2 py-1 font-semibold text-fg-2 transition-colors hover:bg-raised"
            >
              해제
            </button>
          </div>
        </div>
      ) : (
        <div
          data-studio-selection-command-reserve="true"
          aria-hidden="true"
          className="flex h-full min-w-0 items-center gap-2 overflow-hidden rounded-xl border border-line/45 px-2.5 py-1.5 text-[0.7rem] text-fg-3"
        >
          <span className="size-1.5 shrink-0 rounded-full bg-line" />
          <span className="truncate">
            요소를 선택하면 정렬·복제·삭제 명령이 여기에 표시됩니다
          </span>
        </div>
      )}
      </div>
      ) : null}

      {(advancedFillBusy || hasAdvancedFillPreview) && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "mb-2 flex min-h-12 flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs shadow-sm",
            hasAdvancedFillPreview
              ? "border-good/35 bg-good-soft/20 text-fg"
              : "border-accent/35 bg-accent-soft/25 text-fg"
          )}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-panel/80 text-accent">
            {advancedFillBusy ? (
              <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <PaintBucket size={16} aria-hidden />
            )}
          </span>
          <span className="min-w-0 flex-1 leading-relaxed">
            <strong className="block font-bold">
              {advancedFillBusy ? "고급 채우기 분석 중" : "채우기 미리보기"}
            </strong>
            <span className="text-fg-3">
              {advancedFillBusy
                ? "참조 경계와 누수 가능성을 확인하고 있어요."
                : `${advancedFillPreviewMessage ?? ""}${advancedFillActive ? " · 다른 영역을 탭해 한 번의 적용으로 누적할 수 있어요." : ""}`}
            </span>
          </span>
          {hasAdvancedFillPreview && !advancedFillBusy && (
            <span className="ml-auto flex min-w-full gap-2 sm:min-w-0">
              <button
                type="button"
                onClick={onCancelAdvancedFillPreview}
                className="min-h-11 flex-1 rounded-lg border border-line bg-card px-3 font-semibold text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-none"
              >
                취소
              </button>
              <button
                type="button"
                onClick={onApplyAdvancedFillPreview}
                className="min-h-11 flex-1 rounded-lg bg-accent px-4 font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:flex-none"
              >
                적용 · 실행취소 1회
              </button>
            </span>
          )}
          {advancedFillBusy && (
            <button
              type="button"
              onClick={onCancelAdvancedFillCalculation}
              className="ml-auto min-h-11 min-w-24 rounded-lg border border-accent/35 bg-card px-3 font-bold text-accent transition-colors hover:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              계산 취소
            </button>
          )}
        </div>
      )}
      </div>
    </>
  );
}
