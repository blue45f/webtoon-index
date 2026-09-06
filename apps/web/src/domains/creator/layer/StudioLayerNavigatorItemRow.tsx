import {
  Check,
  CircleDot,
  CornerDownRight,
  Eye,
  EyeOff,
  Film,
  Ghost,
  Grid2X2,
  Layers3,
  Lock,
  LockOpen,
  MoreHorizontal,
  ScanLine,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import {
  memo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { StudioInlineScrubber } from "../StudioInlineScrubber";

import {
  STUDIO_LAYER_COLOR_LABELS,
  STUDIO_LAYER_ROLE_LABELS,
  type StudioLayerColor,
  type StudioLayerKind,
  type StudioLayerNavigatorItem,
} from "./studio-layer-navigator";
import {
  STUDIO_LAYER_NAVIGATOR_COARSE_TARGET,
  STUDIO_LAYER_NAVIGATOR_FOCUS_RING,
  STUDIO_LAYER_NAVIGATOR_KIND_ICONS,
} from "./studio-layer-navigator-row-ui";
import {
  buildStudioLayerPaletteStatuses,
  resolveStudioLayerSemanticKind,
  STUDIO_LAYER_SEMANTIC_KIND_CLASSES,
  STUDIO_LAYER_SEMANTIC_KIND_LABELS,
  visibleStudioLayerPaletteStatuses,
  type StudioLayerPaletteStatusKind,
} from "./studio-layer-palette-visual";

import type { StudioLiveLayerOwnership } from "../live/studio-live-layer-ownership";

import { cn } from "@/shared/lib/utils";

const COLOR_DOT_CLASS: Record<StudioLayerColor, string> = {
  red: "bg-bad",
  orange: "bg-accent",
  yellow: "bg-warning",
  green: "bg-good",
  blue: "bg-cool",
  violet: "bg-[oklch(0.68_0.18_312)]",
};

const STATUS_ICONS: Record<StudioLayerPaletteStatusKind, LucideIcon> = {
  "local-hidden": Ghost,
  hidden: EyeOff,
  locked: Lock,
  reference: ScanLine,
  mask: Layers3,
  "mask-disabled": Layers3,
  clipping: CornerDownRight,
  "alpha-locked": Grid2X2,
  ai: Sparkles,
  animated: Film,
};

const STATUS_CLASSES: Record<StudioLayerPaletteStatusKind, string> = {
  "local-hidden": "border-line-strong bg-raised text-fg-2",
  hidden: "border-line-strong bg-raised text-fg-3",
  locked: "border-accent/30 bg-accent-soft/35 text-accent",
  reference: "border-cool/30 bg-cool/10 text-cool",
  mask: "border-good/30 bg-good/10 text-good",
  "mask-disabled": "border-line bg-card text-fg-3/60",
  clipping: "border-[oklch(0.68_0.16_312/0.3)] bg-[oklch(0.68_0.16_312/0.1)] text-[oklch(0.76_0.13_312)]",
  "alpha-locked": "border-accent/30 bg-accent-soft/35 text-accent",
  ai: "border-warning/30 bg-warning/10 text-warning",
  animated: "border-cool/30 bg-cool/10 text-cool",
};

export interface LayerNavigatorRowHandlers {
  onRowFocus: (key: string) => void;
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLElement>, key: string) => void;
  onRowClick: (event: ReactMouseEvent<HTMLElement>, itemId: string) => void;
  onRowDoubleClick: (
    event: ReactMouseEvent<HTMLElement>,
    itemId: string,
    label: string
  ) => void;
  onToggleItemHidden: (itemId: string, hidden: boolean) => void;
  onToggleItemLocked: (itemId: string, locked: boolean) => void;
  /** `opacity` is 0–1. */
  onSetItemOpacity: (itemId: string, opacity: number) => void;
  /** `opacity` is 0–1. Mid-scrub sample: apply to the canvas now, coalesce into one undo step. */
  onPreviewItemOpacity: (itemId: string, opacity: number) => void;
  onOpenItemActionMenu: (
    event: ReactMouseEvent<HTMLButtonElement>,
    itemId: string
  ) => void;
  registerRowRef: (key: string, node: HTMLElement | null) => void;
}

export interface StudioLayerNavigatorItemRowProps {
  item: StudioLayerNavigatorItem;
  rowKey: string;
  level: number;
  kind: Exclude<StudioLayerKind, "all">;
  groupName: string | null;
  effectivelyHidden: boolean;
  locallyHidden: boolean;
  effectivelyLocked: boolean;
  statusLabel: string;
  selected: boolean;
  current: boolean;
  selectionCount: number;
  tabStop: boolean;
  renameInput: ReactNode | null;
  mobileMultiSelect: boolean;
  readOnly: boolean;
  hiddenByGroup: boolean;
  lockedByGroup: boolean;
  actionOpen: boolean;
  actionPopoverId: string;
  stableHandlers: LayerNavigatorRowHandlers;
  /**
   * Live collaboration ownership for this layer. Null/undefined when free or offline.
   * Peer ownership blocks local opacity/lock controls until the lease ends.
   */
  liveOwnership?: StudioLiveLayerOwnership | null;
}

/**
 * A row stays memoized even when the parent rebuilds its result list. The parent passes only the
 * stable item reference, primitive projections, and an identity-stable handler bridge so a settled
 * document commit rerenders the rows that actually changed.
 */
export const StudioLayerNavigatorItemRow = memo(
  function StudioLayerNavigatorItemRow({
    item,
    rowKey,
    level,
    kind,
    groupName,
    effectivelyHidden,
    locallyHidden,
    effectivelyLocked,
    statusLabel,
    selected,
    current,
    selectionCount,
    tabStop,
    renameInput,
    mobileMultiSelect,
    readOnly,
    hiddenByGroup,
    lockedByGroup,
    actionOpen,
    actionPopoverId,
    stableHandlers,
    liveOwnership = null,
  }: StudioLayerNavigatorItemRowProps) {
    const Icon = STUDIO_LAYER_NAVIGATOR_KIND_ICONS[kind];
    const peerBlocked = liveOwnership?.blocksLocalEdit === true;
    const liveStatusLabel =
      liveOwnership && liveOwnership.kind !== "free"
        ? liveOwnership.statusLabel
        : null;
    const displayedStatusLabel = [
      statusLabel || null,
      liveStatusLabel,
      locallyHidden ? "나만 숨김" : null,
    ]
      .filter(Boolean)
      .join(", ");
    const semanticKind = resolveStudioLayerSemanticKind(item);
    const accessibleMetadata = [
      current ? "현재 작업 레이어" : selected ? "다중 선택됨" : null,
      STUDIO_LAYER_SEMANTIC_KIND_LABELS[semanticKind],
      groupName ? `그룹 ${groupName}` : null,
      item.role ? `역할 ${STUDIO_LAYER_ROLE_LABELS[item.role]}` : null,
      item.color ? `색 라벨 ${STUDIO_LAYER_COLOR_LABELS[item.color]}` : null,
      displayedStatusLabel || null,
    ]
      .filter(Boolean)
      .join(", ");
    const visuallyHidden = effectivelyHidden || locallyHidden;
    const multipleSelection = selectionCount > 1;
    const selectionState = current ? "current" : selected ? "selected" : "none";
    const statuses = buildStudioLayerPaletteStatuses({
      effectivelyHidden,
      locallyHidden,
      effectivelyLocked: effectivelyLocked || peerBlocked,
      fillReference: item.fillReference,
      masked: item.masked,
      maskEnabled: item.maskEnabled,
      clipBelow: item.clipBelow,
      alphaLocked: item.alphaLocked,
      aiGenerated: item.aiGenerated,
      animated: item.animated,
    });
    const visibleStatuses = visibleStudioLayerPaletteStatuses(statuses);
    const statusSummary = [
      ...statuses.map((status) => status.label),
      liveStatusLabel,
    ]
      .filter(Boolean)
      .join(", ");
    const committedOpacityPercent = Math.round(
      Math.min(1, Math.max(0, item.opacity ?? 1)) * 100
    );
    const liveOwnerInitial =
      liveOwnership?.ownerDisplayName?.trim().charAt(0) ||
      (liveOwnership?.kind === "self" ? "나" : "·");
    const showLiveOwnershipBadge =
      liveOwnership != null && liveOwnership.kind !== "free";
    // One scrub gesture must be one undo step — and the canvas must follow the pointer while it
    // happens. Mid-scrub samples go to the document as `live` previews that the editor coalesces
    // under one history key, so the pixels move in real time and ⌘Z still rewinds the whole
    // gesture at once. The draft is kept because a rejected preview (locked page, save in flight)
    // never comes back as `item.opacity`, and the row must still track the pointer.
    const [opacityDraft, setOpacityDraft] = useState<number | null>(null);
    const opacityPercent = opacityDraft ?? committedOpacityPercent;

    return (
      <li role="none">
        <div
          id={`studio-layer-${item.id}`}
          ref={(node) => stableHandlers.registerRowRef(rowKey, node)}
          role="treeitem"
          aria-level={level}
          aria-selected={selected}
          aria-current={current ? "true" : undefined}
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter Space F2 Shift+F10 Control+A Meta+A Control+G Meta+G Shift+Control+G Shift+Meta+G"
          aria-label={`${item.label}, ${accessibleMetadata}`}
          tabIndex={tabStop ? 0 : -1}
          onFocus={() => stableHandlers.onRowFocus(rowKey)}
          onKeyDown={(event) => stableHandlers.onRowKeyDown(event, rowKey)}
          onClick={(event) => stableHandlers.onRowClick(event, item.id)}
          onDoubleClick={(event) =>
            stableHandlers.onRowDoubleClick(event, item.id, item.label)
          }
          className={cn(
            "group/layer relative flex min-h-9 items-center gap-1 rounded-lg border px-1 py-0.5 text-left transition-[border-color,background-color,box-shadow] duration-150 [contain-intrinsic-size:44px] [content-visibility:auto] motion-reduce:transition-none max-lg:min-h-11 pointer-coarse:min-h-11",
            current
              ? "border-accent/75 bg-accent-soft/65 shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.18),0_1px_5px_oklch(0.1_0.01_60/0.18)]"
              : selected
                ? "border-accent/50 bg-accent-soft/35 shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.1)]"
              : "border-transparent hover:border-line/80 hover:bg-raised/60",
            STUDIO_LAYER_NAVIGATOR_FOCUS_RING
          )}
          data-studio-layer-row="true"
          data-studio-layer-selected={selected ? "true" : "false"}
          data-studio-layer-selection-state={selectionState}
          data-studio-layer-local-hidden={locallyHidden ? "true" : "false"}
          data-studio-live-ownership={
            showLiveOwnershipBadge ? liveOwnership!.kind : "free"
          }
          data-studio-live-ownership-blocked={peerBlocked ? "true" : "false"}
        >
          <span
            aria-hidden
            data-studio-layer-selection-marker={selectionState}
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-md border transition-colors duration-150 motion-reduce:transition-none",
              current
                ? "border-accent bg-accent text-on-accent shadow-sm"
                : selected
                  ? "border-accent/80 bg-accent-soft text-accent"
                  : mobileMultiSelect || multipleSelection
                    ? "border-line-strong bg-card text-transparent"
                    : "border-transparent bg-transparent text-transparent group-hover/layer:border-line"
            )}
          >
            {current ? <CircleDot size={13} strokeWidth={2.25} /> : selected ? <Check size={13} strokeWidth={2.5} /> : null}
          </span>
          {item.color ? (
            <span
              aria-label={`색 라벨 ${STUDIO_LAYER_COLOR_LABELS[item.color]}`}
              className={cn(
                "h-5 w-1.5 shrink-0 rounded-full shadow-sm",
                COLOR_DOT_CLASS[item.color]
              )}
            />
          ) : null}
          <span
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-lg border border-line/50 bg-[linear-gradient(160deg,oklch(0.24_0.01_66),oklch(0.19_0.009_68))] text-fg-3 shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.05)]",
              visuallyHidden && !selected && "text-fg-3",
              selected && "border-accent/35 text-accent"
            )}
            aria-hidden
          >
            <Icon size={13} strokeWidth={1.75} />
          </span>
          <span
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 px-0.5"
            )}
          >
            <span className="min-w-0 flex-1">
              {renameInput ?? (
                <span
                  className={cn(
                    "block truncate text-[0.72rem] font-semibold",
                    selected ? "text-fg" : "text-fg-2",
                    item.hidden && "line-through decoration-fg-3/80"
                  )}
                >
                  {item.label}
                </span>
              )}
              <span className={cn(
                "flex min-w-0 items-center gap-1 text-[0.68rem] lg:text-[0.58rem]",
                selected ? "text-fg-2" : "text-fg-3"
              )}>
                <span
                  data-studio-layer-kind-badge={semanticKind}
                  className={cn(
                    "inline-flex h-4 shrink-0 items-center rounded border px-1 text-[0.58rem] font-bold leading-none",
                    STUDIO_LAYER_SEMANTIC_KIND_CLASSES[semanticKind]
                  )}
                >
                  {STUDIO_LAYER_SEMANTIC_KIND_LABELS[semanticKind]}
                </span>
                {groupName ? (
                  <span className="truncate">{groupName}</span>
                ) : null}
                {item.role ? (
                  <span className="shrink-0 rounded bg-raised px-1 py-0.5">
                    {STUDIO_LAYER_ROLE_LABELS[item.role]}
                  </span>
                ) : null}
              </span>
            </span>
          </span>
          {showLiveOwnershipBadge ? (
            <span
              data-studio-live-ownership-badge={liveOwnership!.kind}
              title={liveStatusLabel ?? undefined}
              aria-label={liveStatusLabel ?? "협업 편집 상태"}
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border text-[0.58rem] font-bold leading-none text-white shadow-sm",
                peerBlocked
                  ? "border-white/25 ring-1 ring-bad/40"
                  : "border-white/20 ring-1 ring-good/35"
              )}
              style={{
                backgroundColor: liveOwnership!.ownerColor ?? "oklch(0.45 0.04 260)",
              }}
            >
              <span aria-hidden>{liveOwnerInitial}</span>
            </span>
          ) : null}
          {visibleStatuses.visible.length > 0 ? (
            <span
              data-studio-layer-status-strip="true"
              aria-label={statusSummary}
              title={statusSummary}
              className="flex max-w-[4.25rem] shrink-0 items-center gap-0.5 overflow-hidden"
            >
              {visibleStatuses.visible.map((status) => {
                const StatusIcon = STATUS_ICONS[status.kind];
                return (
                  <span
                    key={status.kind}
                    data-studio-layer-status={status.kind}
                    aria-hidden
                    className={cn(
                      "grid size-4 shrink-0 place-items-center rounded border",
                      STATUS_CLASSES[status.kind]
                    )}
                  >
                    <StatusIcon size={10} strokeWidth={2} />
                  </span>
                );
              })}
              {visibleStatuses.hiddenCount > 0 ? (
                <span
                  aria-hidden
                  data-studio-layer-status-overflow={visibleStatuses.hiddenCount}
                  className="inline-flex h-4 shrink-0 items-center rounded border border-line bg-card px-1 text-[0.52rem] font-bold tabular-nums text-fg-3"
                >
                  +{visibleStatuses.hiddenCount}
                </span>
              ) : null}
            </span>
          ) : null}
          <button
            type="button"
            tabIndex={-1}
            data-layer-row-control
            data-studio-layer-row-action="visibility"
            onClick={(event) => {
              event.stopPropagation();
              stableHandlers.onToggleItemHidden(item.id, !item.hidden);
            }}
            disabled={readOnly || hiddenByGroup}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded text-fg-3 transition-colors hover:bg-raised hover:text-fg disabled:opacity-35",
              STUDIO_LAYER_NAVIGATOR_COARSE_TARGET,
              STUDIO_LAYER_NAVIGATOR_FOCUS_RING
            )}
            aria-label={
              hiddenByGroup
                ? `${item.label}, 그룹에서 숨김`
                : item.hidden
                  ? `${item.label} 표시`
                  : `${item.label} 숨김`
            }
            title={
              hiddenByGroup
                ? "상위 그룹이 숨겨져 있어 그룹을 먼저 표시해야 해요"
                : undefined
            }
          >
            {effectivelyHidden ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
          {/*
            표시·잠금·불투명도를 행 안에 둔다. 이전에는 잠금·불투명도가 `…` 팝오버 안에만
            있어서 행에서 클릭한 뒤 팝오버까지 다시 이동해야 했다 (V5 §15 레이어 행 동작 120px).
          */}
          <button
            type="button"
            tabIndex={-1}
            data-layer-row-control
            data-studio-layer-row-action="lock"
            onClick={(event) => {
              event.stopPropagation();
              stableHandlers.onToggleItemLocked(item.id, !item.locked);
            }}
            disabled={readOnly || lockedByGroup || peerBlocked}
            aria-pressed={effectivelyLocked || peerBlocked}
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded transition-colors hover:bg-raised hover:text-fg disabled:opacity-35",
              effectivelyLocked || peerBlocked ? "text-accent" : "text-fg-3",
              STUDIO_LAYER_NAVIGATOR_COARSE_TARGET,
              STUDIO_LAYER_NAVIGATOR_FOCUS_RING
            )}
            aria-label={
              peerBlocked
                ? `${item.label}, ${liveStatusLabel ?? "다른 참가자가 편집 중"}`
                : lockedByGroup
                  ? `${item.label}, 그룹에서 잠김`
                  : item.locked
                    ? `${item.label} 잠금 해제`
                    : `${item.label} 잠금`
            }
            title={
              peerBlocked
                ? (liveStatusLabel ?? "다른 참가자가 편집 중이에요")
                : lockedByGroup
                  ? "상위 그룹이 잠겨 있어 그룹 잠금을 먼저 해제해야 해요"
                  : undefined
            }
          >
            {effectivelyLocked || peerBlocked ? (
              <Lock size={13} />
            ) : (
              <LockOpen size={13} />
            )}
          </button>
          <StudioInlineScrubber
            surface="layer-opacity"
            rowAction="opacity"
            tabIndex={-1}
            label={`${item.label} 불투명도`}
            value={opacityPercent}
            min={0}
            max={100}
            step={1}
            valueText={`${opacityPercent}%`}
            disabled={readOnly || effectivelyLocked || peerBlocked}
            onChange={(next) => {
              setOpacityDraft(next);
              if (next === (opacityDraft ?? committedOpacityPercent)) return;
              stableHandlers.onPreviewItemOpacity(item.id, next / 100);
            }}
            onCommit={(next) => {
              // Clearing the draft in the same batch as the mutation means a rejected commit
              // (read-only page, save in flight) snaps back to the truth instead of lying.
              const scrubbed = opacityDraft !== null;
              setOpacityDraft(null);
              // After a live scrub the document already holds `next`, so the value test would
              // skip this call — but the settling commit is also what closes the coalesce chain.
              // Skipping it would fold the *next* gesture into this gesture's undo entry.
              if (!scrubbed && next === committedOpacityPercent) return;
              stableHandlers.onSetItemOpacity(item.id, next / 100);
            }}
            className={cn(
              "grid h-7 w-9 shrink-0 place-items-center rounded text-[0.58rem] font-bold tabular-nums text-fg-3 transition-colors hover:bg-raised hover:text-fg",
              STUDIO_LAYER_NAVIGATOR_COARSE_TARGET,
              STUDIO_LAYER_NAVIGATOR_FOCUS_RING
            )}
          >
            <span aria-hidden>{opacityPercent}</span>
          </StudioInlineScrubber>
          <button
            type="button"
            tabIndex={-1}
            data-layer-row-control
            data-studio-layer-row-action="menu"
            onClick={(event) => {
              event.stopPropagation();
              stableHandlers.onOpenItemActionMenu(event, item.id);
            }}
            aria-haspopup="dialog"
            aria-expanded={actionOpen}
            aria-controls={actionPopoverId}
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded text-fg-3 transition-colors hover:bg-raised hover:text-fg",
              STUDIO_LAYER_NAVIGATOR_COARSE_TARGET,
              STUDIO_LAYER_NAVIGATOR_FOCUS_RING
            )}
            aria-label={`${item.label} 레이어 작업`}
          >
            <MoreHorizontal size={15} />
          </button>
        </div>
      </li>
    );
  }
);
