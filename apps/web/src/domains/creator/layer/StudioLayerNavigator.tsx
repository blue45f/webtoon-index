import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  FolderMinus,
  FolderPlus,
  Ghost,
  Crosshair,
  Grid2X2,
  Layers3,
  ListChecks,
  Lock,
  LockOpen,
  Palette,
  ScanLine,
  Search,
  SlidersHorizontal,
  Tags,
  Trash2,
  Type as TypeIcon,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { useStudioLiveCollaboration } from "../live/studio-live-collaboration-context";
import {
  reuseOrBuildStudioLiveLayerOwnershipByItemId,
  studioLiveSelectionEditGate,
  summarizeStudioLiveSelectionOwnership,
  type StudioLiveLayerOwnership,
} from "../live/studio-live-layer-ownership";
import { useStudioStableHandlers } from "../studio-stable-handlers";

import { studioLayerSourcesBakeToSingleLayer } from "./studio-layer-merge";
import {
  DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS,
  STUDIO_LAYER_COLORS,
  STUDIO_LAYER_COLOR_LABELS,
  STUDIO_LAYER_FLAG_LABELS,
  STUDIO_LAYER_KIND_LABELS,
  STUDIO_LAYER_ROLES,
  STUDIO_LAYER_ROLE_LABELS,
  buildStudioLayerNavigatorNodes,
  countActiveStudioLayerFilters,
  countStudioLayerSelectionOutsideResults,
  filterStudioLayerNavigatorItems,
  reduceStudioLayerSelection,
  summarizeStudioLayerNavigator,
  type StudioLayerColor,
  type StudioLayerNavigatorFilters,
  type StudioLayerNavigatorItem,
  type StudioLayerNavigatorResult,
  type StudioLayerRole,
  type StudioLayerSelectionMode,
} from "./studio-layer-navigator";
import {
  STUDIO_LAYER_NAVIGATOR_COARSE_TARGET as coarseTarget,
  STUDIO_LAYER_NAVIGATOR_FOCUS_RING as focusRing,
  studioLayerNavigatorItemStatusLabel as itemStatusLabel,
} from "./studio-layer-navigator-row-ui";
import { StudioLayerNavigatorBatchBar } from "./StudioLayerNavigatorBatchBar";
import { StudioLayerNavigatorFilterPanel } from "./StudioLayerNavigatorFilterPanel";
import {
  StudioLayerNavigatorItemRow as LayerNavigatorItemRow,
  type LayerNavigatorRowHandlers,
} from "./StudioLayerNavigatorItemRow";
import { StudioLayerNavigatorTree } from "./StudioLayerNavigatorTree";


import type { LayerGroup } from "../studio-layers";

import { cn } from "@/shared/lib/utils";

const EMPTY_LIVE_LAYER_OWNERSHIP_BY_ITEM_ID: ReadonlyMap<
  string,
  StudioLiveLayerOwnership
> = new Map();

type LiveOwnershipCache = {
  fingerprint: string;
  pageId: string;
  selfSessionId: string;
  elementKey: string;
  map: ReadonlyMap<string, StudioLiveLayerOwnership>;
};
export type StudioLayerNavigatorItemFlag = "alphaLocked" | "fillReference" | "maskEnabled";

export type StudioLayerNavigatorAction =
  | { type: "group-selection" }
  | { type: "ungroup-selection" }
  | { type: "create-group"; seedIds: readonly string[] }
  /**
   * CSP-class frame folder seed: bind selected layers under a contiguous group for a frame cut,
   * forcing panel clip (`noClip: false`). Shared-gutter edit topology is not included.
   */
  | { type: "create-frame-folder"; frameId: string; seedIds: readonly string[] }
  | { type: "rename-item"; id: string; name: string }
  | { type: "rename-group"; groupId: string; name: string }
  | {
      type: "set-group-flag";
      groupId: string;
      flag: "collapsed" | "hidden" | "locked";
      value: boolean;
    }
  | { type: "set-items-hidden"; ids: readonly string[]; hidden: boolean }
  | { type: "set-items-locked"; ids: readonly string[]; locked: boolean }
  /**
   * 0–1. Emitted by the row's inline opacity scrubber (V5 §15 레이어 행 동작 120px).
   *
   * `live`는 아직 포인터를 놓지 않은 **드래그 중 프리뷰** 표본이다. 수신자는 이 표본도 실제
   * 문서에 적용해 캔버스가 즉시 따라오게 하되, 한 제스처가 undo 한 번으로 남도록 같은 키로
   * 합쳐야 한다. 마지막(놓는 순간) 표본은 `live` 없이 와서 합치기 체인을 끊는다.
   */
  | { type: "set-items-opacity"; ids: readonly string[]; opacity: number; live?: boolean }
  | { type: "set-item-flag"; id: string; flag: StudioLayerNavigatorItemFlag; value: boolean }
  | { type: "assign-items-to-group"; ids: readonly string[]; groupId?: string }
  | { type: "set-items-role"; ids: readonly string[]; role?: StudioLayerRole }
  | { type: "set-items-color"; ids: readonly string[]; color?: StudioLayerColor }
  /** up=FRONT/높은 z 쪽, down=BACK/낮은 z 쪽. 필터 활성 중에는 UI가 명령을 내보내지 않는다. */
  | { type: "move-item"; id: string; direction: "up" | "down" }
  | { type: "move-group"; groupId: string; direction: "up" | "down" }
  | { type: "ungroup"; groupId: string }
  /** 선택 ID 집합 전체를 하나의 삭제 의도로 전달한다. 잠금·히스토리·선택 정리는 상위 문서 어댑터 책임이다. */
  | { type: "delete-items"; ids: readonly string[] }
  /** Merge selected layer with the one below (toward BACK). */
  | { type: "merge-down"; id: string }
  /** Merge all selected layers (2+). */
  | { type: "merge-selected"; ids: readonly string[] }
  /** Flatten all visible unlocked layers into one group plan (non-destructive group until raster bake). */
  | { type: "flatten-visible" };

export interface StudioLayerNavigatorProps {
  /** 문서의 BACK→FRONT 레이어. zIndex를 기준으로 FRONT→BACK 표시 순서를 안정적으로 만든다. */
  items: readonly StudioLayerNavigatorItem[];
  groups: readonly LayerGroup[];
  /** 단일·다중을 통합한 현재 선택. 내비게이터는 결과 순서의 고유 ID 최대 500개를 반환한다. */
  selectedIds: readonly string[];
  /** 페이지가 바뀔 때 포커스·범위 anchor·임시 편집만 초기화한다. 검색 필터는 작업공간 상태로 유지한다. */
  pageKey: string;
  /**
   * Active page id for live collaboration lock projection. When omitted (or room idle),
   * ownership badges stay off so solo editing stays allocation-light.
   */
  livePageId?: string | null;
  readOnly?: boolean;
  /** 마스터 레이어처럼 그룹 데이터 모델을 지원하지 않는 작업면에서 그룹 생성·배정·해제·이동만 잠근다. */
  groupingDisabled?: boolean;
  /** 문서(CRDT)에 반영되지 않는, 이 클라이언트에서만 켜진 "나만 숨기기" 대상. */
  localHiddenIds: ReadonlySet<string>;
  onToggleLocalHidden: (id: string) => void;
  /**
   * CSP-class solo: temporary local view of one layer (others hidden only on this client).
   * Null when solo is off.
   */
  soloLayerId?: string | null;
  onToggleLayerSolo?: (id: string) => void;
  onSelectionChange: (ids: readonly string[]) => void;
  onAction: (action: StudioLayerNavigatorAction) => void;
}

type RenameTarget = { kind: "item" | "group"; id: string; value: string };
type ActionTarget =
  | { kind: "item" | "group"; id: string }
  | { kind: "batch"; id: "selection" };
export type FocusTarget =
  | { key: string; kind: "item"; entry: StudioLayerNavigatorResult }
  | {
      key: string;
      kind: "group";
      group: LayerGroup;
      itemIds: readonly string[];
      expanded: boolean;
    };

const compactControl = cn(
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40",
  coarseTarget,
  focusRing
);

function uniqueGroups(groups: readonly LayerGroup[]): readonly LayerGroup[] {
  const seen = new Set<string>();
  return groups.filter((group) => {
    if (seen.has(group.id)) return false;
    seen.add(group.id);
    return true;
  });
}

function stableFrontToBack(items: readonly StudioLayerNavigatorItem[]): readonly StudioLayerNavigatorItem[] {
  return items
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => right.item.zIndex - left.item.zIndex || left.sourceIndex - right.sourceIndex)
    .map(({ item }) => item);
}

function commonValue<Value extends string>(values: readonly (Value | undefined)[]): Value | "__mixed__" | undefined {
  if (values.length === 0) return undefined;
  const first = values[0];
  return values.every((value) => value === first) ? first : "__mixed__";
}

function selectionModeFromPointer(
  event: ReactMouseEvent<HTMLElement>,
  mobileMultiSelect: boolean
): StudioLayerSelectionMode {
  const modifier = event.metaKey || event.ctrlKey;
  if (event.shiftKey) return modifier ? "add-range" : "range";
  if (modifier || mobileMultiSelect) return "toggle";
  return "replace";
}

function isLayerRowControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-layer-row-control]") !== null;
}

/**
 * The host can only bake a merge when every source is an image layer; anything else falls back to a
 * non-destructive group, which *adds* a row. A control called 병합 that grows the layer list is the
 * label lying about what it does, so every merge door reads this before the click and says which of
 * the two outcomes it is actually about to produce.
 *
 * Returns null when the merge really does collapse into one layer.
 */
function mergeGroupFallbackNote(sources: readonly StudioLayerNavigatorItem[]): string | null {
  if (sources.length < 2) return null;
  if (studioLayerSourcesBakeToSingleLayer(sources)) return null;
  const vectorCount = sources.filter((item) => item.type !== "image").length;
  return `이미지가 아닌 레이어 ${vectorCount}개가 있어 한 장으로 굽지 못해요 — 원본을 지키는 그룹으로 묶이고 레이어 수는 줄지 않습니다.`;
}


export function StudioLayerNavigator({
  items,
  groups,
  selectedIds,
  pageKey,
  livePageId = null,
  readOnly = false,
  groupingDisabled = false,
  localHiddenIds,
  onToggleLocalHidden,
  soloLayerId = null,
  onToggleLayerSolo,
  onSelectionChange,
  onAction,
}: StudioLayerNavigatorProps) {
  const live = useStudioLiveCollaboration();
  const liveOwnershipCacheRef = useRef<LiveOwnershipCache | null>(null);
  let liveOwnershipByItemId = EMPTY_LIVE_LAYER_OWNERSHIP_BY_ITEM_ID;
  if (live.room && livePageId) {
    const next = reuseOrBuildStudioLiveLayerOwnershipByItemId({
      pageId: livePageId,
      elementIds: items.map((item) => item.id),
      locks: live.locks,
      selfSessionId: live.room.participant.sessionId,
      previous: liveOwnershipCacheRef.current,
    });
    liveOwnershipCacheRef.current = {
      fingerprint: next.fingerprint,
      pageId: next.pageId,
      selfSessionId: next.selfSessionId,
      elementKey: next.elementKey,
      map: next.map,
    };
    liveOwnershipByItemId = next.map;
  } else {
    liveOwnershipCacheRef.current = null;
  }
  const selectionOwnership = summarizeStudioLiveSelectionOwnership({
    selectedIds,
    ownershipByItemId: liveOwnershipByItemId,
  });
  const selectionEditGate = studioLiveSelectionEditGate({
    selectedIds,
    ownershipByItemId: liveOwnershipByItemId,
  });
  const liveSelectionBlocked = selectionEditGate.allowed === false;
  /** Document read-only or peer-held selection — blocks batch and item mutations. */
  const mutationDisabled = readOnly || liveSelectionBlocked;
  const filterPanelId = useId();
  const actionPopoverId = useId();
  const resultStatusId = useId();
  const mergeFallbackNoteId = useId();
  const flattenFallbackNoteId = useId();
  const mergeDownFallbackNoteId = useId();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<StudioLayerNavigatorFilters>(() => ({
    ...DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS,
    flags: [],
  }));
  const [filterOpen, setFilterOpen] = useState(false);
  const [mobileMultiSelect, setMobileMultiSelect] = useState(false);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [readOnlyCollapsed, setReadOnlyCollapsed] = useState<Record<string, boolean>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const filterTriggerRef = useRef<HTMLButtonElement>(null);
  const filterPanelRef = useRef<HTMLDivElement>(null);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const actionPopoverRef = useRef<HTMLDivElement>(null);
  const actionFallbackKeyRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  const displayItems = stableFrontToBack(items);
  const availableGroups = uniqueGroups(groups).map((group) =>
    readOnly && Object.hasOwn(readOnlyCollapsed, group.id)
      ? { ...group, collapsed: readOnlyCollapsed[group.id] }
      : group
  );
  const stats = summarizeStudioLayerNavigator(displayItems, availableGroups);
  const activeFilterCount = countActiveStudioLayerFilters(filters);
  const filterActive = query.trim().length > 0 || activeFilterCount > 0;
  const results = filterStudioLayerNavigatorItems(displayItems, availableGroups, query, filters);
  const resultIds = [...new Set(results.map((entry) => entry.item.id))];
  const resultIdSet = new Set(resultIds);
  const nodes = buildStudioLayerNavigatorNodes(results, availableGroups, {
    filterActive,
    includeEmptyGroups: true,
  });
  const selectedIdSet = new Set(selectedIds);
  const selectionCount = selectedIdSet.size;
  const outsideSelectionCount = countStudioLayerSelectionOutsideResults(selectedIds, resultIds);
  const batchSelectedIds = [...new Set(
    filterActive ? selectedIds.filter((id) => resultIdSet.has(id)) : selectedIds
  )].slice(0, 500);
  const batchSelectedIdSet = new Set(batchSelectedIds);
  const batchSelectedItems = displayItems.filter((item) => batchSelectedIdSet.has(item.id));
  const availableGroupById = new Map(availableGroups.map((group) => [group.id, group]));
  const batchShowIds = batchSelectedItems
    .filter((item) => !item.groupId || availableGroupById.get(item.groupId)?.hidden !== true)
    .map((item) => item.id);
  const batchUnlockIds = batchSelectedItems
    .filter((item) => !item.groupId || availableGroupById.get(item.groupId)?.locked !== true)
    .map((item) => item.id);
  const batchShowBlockedCount = batchSelectedIds.length - batchShowIds.length;
  const batchUnlockBlockedCount = batchSelectedIds.length - batchUnlockIds.length;
  const commonSelectedGroup = commonValue(batchSelectedItems.map((item) => item.groupId));
  const selectionContainsGroupedItems = batchSelectedItems.some(
    (item) => item.groupId !== undefined
  );
  const createGroupUnavailableReason = readOnly
    ? "읽기 전용 작업공간에서는 그룹을 만들 수 없어요."
    : groupingDisabled
      ? "현재 작업면은 레이어 그룹을 지원하지 않아요."
      : filterActive
        ? "검색·필터를 지운 뒤 그룹을 만들 수 있어요."
        : selectionContainsGroupedItems
          ? "기존 그룹이 포함되어 있어요. 먼저 그룹을 해제해 주세요."
          : liveSelectionBlocked
            ? (selectionEditGate.reason ?? "다른 참가자가 편집 중인 레이어예요.")
            : undefined;
  const commonSelectedRole = commonValue(batchSelectedItems.map((item) => item.role));
  const commonSelectedColor = commonValue(batchSelectedItems.map((item) => item.color));

  // Merge pre-flight — see `mergeGroupFallbackNote`. Sources mirror the host planners exactly:
  // merge-selected takes the batch, flatten-visible takes every effectively visible layer, and
  // merge-down takes the row plus its BACK-side neighbour (displayItems is FRONT→BACK).
  const effectivelyVisibleItems = displayItems.filter(
    (item) =>
      item.hidden !== true &&
      (!item.groupId || availableGroupById.get(item.groupId)?.hidden !== true)
  );
  const batchMergeFallbackNote = mergeGroupFallbackNote(batchSelectedItems);
  const flattenVisibleFallbackNote = mergeGroupFallbackNote(effectivelyVisibleItems);
  function mergeDownFallbackNote(itemId: string): string | null {
    const index = displayItems.findIndex((item) => item.id === itemId);
    const below = index < 0 ? undefined : displayItems[index + 1];
    return below ? mergeGroupFallbackNote([below, displayItems[index]!]) : null;
  }

  const focusTargets: FocusTarget[] = [];
  for (const node of nodes) {
    if (node.kind === "item") {
      focusTargets.push({ key: node.key, kind: "item", entry: node.entry });
      continue;
    }
    focusTargets.push({
      key: node.key,
      kind: "group",
      group: node.group,
      itemIds: node.entries.map((entry) => entry.item.id),
      expanded: node.expanded,
    });
    if (!node.expanded) continue;
    for (const entry of node.entries) {
      focusTargets.push({
        key: `${node.key}:item:${entry.item.id}`,
        kind: "item",
        entry,
      });
    }
  }
  const visibleItemIds = focusTargets.flatMap((target) =>
    target.kind === "item" ? [target.entry.item.id] : []
  );
  const focusKeySet = new Set(focusTargets.map((target) => target.key));
  const selectedFocusTarget = focusTargets.find(
    (target) => target.kind === "item" && selectedIdSet.has(target.entry.item.id)
  );
  const tabStopKey = focusedKey && focusKeySet.has(focusedKey)
    ? focusedKey
    : (selectedFocusTarget?.key ?? focusTargets[0]?.key ?? null);

  const activeItem = actionTarget?.kind === "item"
    ? displayItems.find((item) => item.id === actionTarget.id) ?? null
    : null;
  const activeGroup = actionTarget?.kind === "group"
    ? availableGroups.find((group) => group.id === actionTarget.id) ?? null
    : null;
  const actionTargetKind = actionTarget?.kind ?? null;
  const actionTargetId = actionTarget?.id ?? null;
  const actionTargetExists =
    actionTargetKind === "batch" || activeItem !== null || activeGroup !== null;
  const activeGroupItemIds = activeGroup
    ? displayItems.filter((item) => item.groupId === activeGroup.id).map((item) => item.id)
    : [];
  const activeGroupAllSelected =
    activeGroupItemIds.length > 0 &&
    activeGroupItemIds.every((id) => selectedIdSet.has(id));
  const activeItemGroup = activeItem?.groupId
    ? (availableGroups.find((group) => group.id === activeItem.groupId) ?? null)
    : null;
  const activeItemHiddenByGroup = activeItemGroup?.hidden === true && activeItem?.hidden !== true;
  const activeItemLockedByGroup = activeItemGroup?.locked === true && activeItem?.locked !== true;
  const activeItemEffectivelyLocked = activeItem?.locked === true || activeItemGroup?.locked === true;
  const activeItemLocallyHidden = activeItem ? localHiddenIds.has(activeItem.id) : false;
  const activeItemMergeDownFallbackNote = activeItem ? mergeDownFallbackNote(activeItem.id) : null;

  useEffect(() => {
    void pageKey;
    setSelectionAnchorId(null);
    setFocusedKey(null);
    setRenameTarget(null);
    setActionTarget(null);
    setFilterOpen(false);
    setMobileMultiSelect(false);
    setReadOnlyCollapsed({});
    actionFallbackKeyRef.current = null;
  }, [pageKey]);

  useEffect(() => {
    if (!filterOpen && !actionTarget) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        filterOpen &&
        !filterPanelRef.current?.contains(target) &&
        !filterTriggerRef.current?.contains(target)
      ) {
        setFilterOpen(false);
      }
      if (
        actionTarget &&
        !actionPopoverRef.current?.contains(target) &&
        !actionTriggerRef.current?.contains(target)
      ) {
        setActionTarget(null);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || renameTarget) return;
      if (actionTarget) {
        event.preventDefault();
        event.stopPropagation();
        setActionTarget(null);
        actionTriggerRef.current?.focus();
      } else if (filterOpen) {
        event.preventDefault();
        event.stopPropagation();
        setFilterOpen(false);
        filterTriggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [actionTarget, filterOpen, renameTarget]);

  useEffect(() => {
    if (!filterOpen) return;
    globalThis.requestAnimationFrame?.(() => filterPanelRef.current?.focus());
  }, [filterOpen]);

  useEffect(() => {
    if (!actionTargetKind) return;
    if (actionTargetExists) {
      globalThis.requestAnimationFrame?.(() => actionPopoverRef.current?.focus());
      return;
    }
    const fallbackKey = actionFallbackKeyRef.current;
    setActionTarget(null);
    globalThis.requestAnimationFrame?.(() => {
      const fallback = fallbackKey ? rowRefs.current.get(fallbackKey) : null;
      if (fallback) {
        setFocusedKey(fallbackKey);
        fallback.focus();
      } else {
        searchInputRef.current?.focus();
      }
    });
  }, [
    actionTargetId,
    actionTargetKind,
    actionTargetExists,
  ]);

  function applyItemSelection(targetId: string, mode: StudioLayerSelectionMode) {
    const next = reduceStudioLayerSelection({
      orderedVisibleIds: visibleItemIds,
      currentIds: selectedIds,
      anchorId: selectionAnchorId,
      targetId,
      mode,
      maximum: 500,
    });
    setSelectionAnchorId(next.anchorId);
    onSelectionChange(next.selectedIds);
  }

  function selectGroupItems(itemIds: readonly string[]) {
    if (itemIds.length === 0) return;
    const allSelected = itemIds.every((id) => selectedIdSet.has(id));
    if (allSelected) {
      const groupSet = new Set(itemIds);
      onSelectionChange([...new Set(selectedIds)].filter((id) => !groupSet.has(id)));
      return;
    }
    onSelectionChange([...new Set([...selectedIds, ...itemIds])].slice(0, 500));
    setSelectionAnchorId(itemIds[0] ?? null);
  }

  function replaceWithGroupItems(itemIds: readonly string[]) {
    if (itemIds.length === 0) return;
    onSelectionChange([...new Set(itemIds)].slice(0, 500));
    setSelectionAnchorId(itemIds[0] ?? null);
  }

  function focusRow(key: string) {
    setFocusedKey(key);
    rowRefs.current.get(key)?.focus();
  }

  function moveRowFocus(currentKey: string, key: "ArrowUp" | "ArrowDown" | "Home" | "End") {
    if (focusTargets.length === 0) return;
    const currentIndex = Math.max(0, focusTargets.findIndex((target) => target.key === currentKey));
    const nextIndex = key === "ArrowUp"
      ? Math.max(0, currentIndex - 1)
      : key === "ArrowDown"
        ? Math.min(focusTargets.length - 1, currentIndex + 1)
        : key === "Home"
          ? 0
          : focusTargets.length - 1;
    const next = focusTargets[nextIndex];
    if (next) focusRow(next.key);
  }

  function beginRename(kind: RenameTarget["kind"], id: string, value: string) {
    if (readOnly) return;
    setRenameTarget({ kind, id, value });
    setActionTarget(null);
    globalThis.requestAnimationFrame?.(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }

  function commitRename() {
    if (!renameTarget) return;
    const value = renameTarget.value.trim();
    if (value) {
      onAction(
        renameTarget.kind === "item"
          ? { type: "rename-item", id: renameTarget.id, name: value }
          : { type: "rename-group", groupId: renameTarget.id, name: value }
      );
    }
    setRenameTarget(null);
  }

  function cancelRename(focusKey?: string) {
    setRenameTarget(null);
    if (focusKey) globalThis.requestAnimationFrame?.(() => focusRow(focusKey));
  }

  function handleRenameKeyDown(event: ReactKeyboardEvent<HTMLInputElement>, focusKey: string) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      commitRename();
      globalThis.requestAnimationFrame?.(() => focusRow(focusKey));
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelRename(focusKey);
    }
  }

  function setGroupCollapsed(groupId: string, collapsed: boolean) {
    if (filterActive) return;
    if (readOnly) {
      setReadOnlyCollapsed((current) => ({ ...current, [groupId]: collapsed }));
      return;
    }
    onAction({ type: "set-group-flag", groupId, flag: "collapsed", value: collapsed });
  }

  function actionFallbackForKey(key: string): string | null {
    const index = focusTargets.findIndex((target) => target.key === key);
    if (index < 0) return null;
    return focusTargets[index + 1]?.key ?? focusTargets[index - 1]?.key ?? null;
  }

  function openActionTarget(trigger: HTMLElement, target: ActionTarget, focusKey?: string) {
    actionTriggerRef.current = trigger;
    actionFallbackKeyRef.current = focusKey ? actionFallbackForKey(focusKey) : null;
    setFilterOpen(false);
    setActionTarget((current) =>
      current?.kind === target.kind && current.id === target.id ? null : target
    );
  }

  function handleTreeItemKeyDown(event: ReactKeyboardEvent<HTMLElement>, target: FocusTarget) {
    if (event.target !== event.currentTarget) return;
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      (event.code === "KeyG" || event.key.toLocaleLowerCase() === "g")
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      onAction({
        type: event.shiftKey ? "ungroup-selection" : "group-selection",
      });
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      onSelectionChange(visibleItemIds.slice(0, 500));
      setSelectionAnchorId(visibleItemIds[0] ?? null);
      return;
    }
    if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
      event.preventDefault();
      event.stopPropagation();
      openActionTarget(
        event.currentTarget,
        target.kind === "item"
          ? { kind: "item", id: target.entry.item.id }
          : { kind: "group", id: target.group.id },
        target.key
      );
      return;
    }
    if (
      event.key === "ArrowUp" ||
      event.key === "ArrowDown" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      event.stopPropagation();
      moveRowFocus(target.key, event.key);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "group") {
        if (target.itemIds.length === 0) return;
        const expanded = target.expanded;
        if (event.key === "ArrowRight") {
          if (!expanded) setGroupCollapsed(target.group.id, false);
          else {
            const index = focusTargets.findIndex((candidate) => candidate.key === target.key);
            const child = focusTargets[index + 1];
            if (child?.kind === "item") focusRow(child.key);
          }
        } else if (expanded) {
          setGroupCollapsed(target.group.id, true);
        }
      } else if (event.key === "ArrowLeft") {
        const marker = target.key.indexOf(":item:");
        if (marker > 0) focusRow(target.key.slice(0, marker));
      }
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "item") beginRename("item", target.entry.item.id, target.entry.item.label);
      else beginRename("group", target.group.id, target.group.name);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "item") applyItemSelection(target.entry.item.id, "replace");
      else if (target.itemIds.length > 0) setGroupCollapsed(target.group.id, target.expanded);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (target.kind === "item") applyItemSelection(target.entry.item.id, "toggle");
      else selectGroupItems(target.itemIds);
    }
  }

  function openActionMenu(event: ReactMouseEvent<HTMLButtonElement>, target: ActionTarget) {
    event.stopPropagation();
    const row = event.currentTarget.closest<HTMLElement>("[role='treeitem']");
    const focusKey = row
      ? [...rowRefs.current.entries()].find(([, element]) => element === row)?.[0]
      : undefined;
    openActionTarget(event.currentTarget, target, focusKey);
  }

  function resetFilters() {
    setQuery("");
    setFilters({ ...DEFAULT_STUDIO_LAYER_NAVIGATOR_FILTERS, flags: [] });
  }

  function setSelectedRole(value: string, ids = selectedIds) {
    if (value === "__mixed__") return;
    onAction({
      type: "set-items-role",
      ids: [...ids],
      role: value === "" ? undefined : (value as StudioLayerRole),
    });
  }

  function setSelectedColor(value: string, ids = selectedIds) {
    if (value === "__mixed__") return;
    onAction({
      type: "set-items-color",
      ids: [...ids],
      color: value === "" ? undefined : (value as StudioLayerColor),
    });
  }

  function setSelectedGroup(value: string, ids = selectedIds) {
    if (value === "__mixed__") return;
    onAction({
      type: "assign-items-to-group",
      ids: [...ids],
      groupId: value || undefined,
    });
  }

  // 행 memo 를 깨지 않는 identity-stable 이벤트 브리지 — 이벤트 시점에 최신 클로저를 읽는다.
  const rowHandlers = useStudioStableHandlers<LayerNavigatorRowHandlers>({
    onRowFocus: (key) => setFocusedKey(key),
    onRowKeyDown: (event, key) => {
      const target = focusTargets.find((candidate) => candidate.key === key);
      if (target) handleTreeItemKeyDown(event, target);
    },
    onRowClick: (event, itemId) => {
      if (isLayerRowControl(event.target)) return;
      applyItemSelection(itemId, selectionModeFromPointer(event, mobileMultiSelect));
    },
    onRowDoubleClick: (event, itemId, label) => {
      if (isLayerRowControl(event.target)) return;
      beginRename("item", itemId, label);
    },
    onToggleItemHidden: (itemId, hidden) => {
      onAction({ type: "set-items-hidden", ids: [itemId], hidden });
    },
    onToggleItemLocked: (itemId, locked) => {
      onAction({ type: "set-items-locked", ids: [itemId], locked });
    },
    onSetItemOpacity: (itemId, opacity) => {
      onAction({ type: "set-items-opacity", ids: [itemId], opacity });
    },
    onPreviewItemOpacity: (itemId, opacity) => {
      onAction({ type: "set-items-opacity", ids: [itemId], opacity, live: true });
    },
    onOpenItemActionMenu: (event, itemId) => {
      openActionMenu(event, { kind: "item", id: itemId });
    },
    registerRowRef: (key, node) => {
      if (node) rowRefs.current.set(key, node);
      else rowRefs.current.delete(key);
    },
  });

  function renderRenameInput(target: RenameTarget, focusKey: string) {
    return (
      <input
        ref={renameInputRef}
        value={target.value}
        maxLength={160}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setRenameTarget({ ...target, value: event.target.value })}
        onKeyDown={(event) => handleRenameKeyDown(event, focusKey)}
        onBlur={commitRename}
        className={cn(
          "min-h-8 min-w-0 flex-1 rounded-md border border-accent bg-card px-2 text-xs font-semibold text-fg",
          focusRing
        )}
        aria-label={target.kind === "item" ? "레이어 이름 편집" : "그룹 이름 편집"}
      />
    );
  }

  function renderItemRow(entry: StudioLayerNavigatorResult, key: string, level: number) {
    const item = entry.item;
    const editing = renameTarget?.kind === "item" && renameTarget.id === item.id;
    const liveOwnership = liveOwnershipByItemId.get(item.id) ?? null;
    return (
      <LayerNavigatorItemRow
        key={key}
        rowKey={key}
        item={item}
        level={level}
        kind={entry.kind}
        groupName={entry.group?.name ?? null}
        effectivelyHidden={entry.effectivelyHidden}
        locallyHidden={localHiddenIds.has(item.id)}
        effectivelyLocked={entry.effectivelyLocked}
        statusLabel={itemStatusLabel(entry)}
        selected={selectedIdSet.has(item.id)}
        current={selectionCount === 1 && selectedIdSet.has(item.id)}
        selectionCount={selectionCount}
        tabStop={tabStopKey === key}
        renameInput={editing && renameTarget ? renderRenameInput(renameTarget, key) : null}
        mobileMultiSelect={mobileMultiSelect}
        readOnly={readOnly}
        hiddenByGroup={entry.group?.hidden === true && item.hidden !== true}
        lockedByGroup={entry.group?.locked === true && item.locked !== true}
        actionOpen={actionTarget?.kind === "item" && actionTarget.id === item.id}
        actionPopoverId={actionPopoverId}
        stableHandlers={rowHandlers}
        liveOwnership={liveOwnership}
      />
    );
  }

  return (
    <section
      className="relative flex h-full min-h-0 flex-col rounded-xl border border-line bg-panel/50 shadow-[inset_0_1px_0_oklch(0.95_0.01_85/0.03)]"
      aria-label="전문 레이어 내비게이터"
      data-page-key={pageKey}
      data-studio-shortcut-boundary="true"
    >
      {/* The icon-only merge doors keep a stable accessible name; the caveat rides along as a
          description so a screen-reader user hears "그룹으로 묶인다" before activating them. */}
      {batchMergeFallbackNote ? (
        <span id={mergeFallbackNoteId} className="sr-only">{batchMergeFallbackNote}</span>
      ) : null}
      {flattenVisibleFallbackNote ? (
        <span id={flattenFallbackNoteId} className="sr-only">{flattenVisibleFallbackNote}</span>
      ) : null}
      {activeItemMergeDownFallbackNote ? (
        <span id={mergeDownFallbackNoteId} className="sr-only">{activeItemMergeDownFallbackNote}</span>
      ) : null}
      <div className="border-b border-line/70 bg-panel/70 p-2.5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/15" aria-hidden>
            <Layers3 size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-1.5">
              <h3 className="text-xs font-bold tracking-tight text-fg">레이어 {stats.total}</h3>
              <span id={resultStatusId} role="status" aria-live="polite" className="rounded-full bg-raised px-1.5 py-0.5 text-[0.62rem] font-semibold tabular-nums text-fg-3">
                결과 {results.length}{selectionCount > 0 ? ` · 선택 ${selectionCount}` : ""}
              </span>
            </div>
            <p className="truncate text-[0.68rem] text-fg-3 lg:text-[0.58rem]">
              표시 {stats.visible} · 숨김 {stats.hidden} · 잠금 {stats.locked}
              {outsideSelectionCount > 0 ? ` · 선택 ${outsideSelectionCount}개는 필터 밖` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMobileMultiSelect((current) => !current)}
            aria-pressed={mobileMultiSelect}
            className={cn(compactControl, mobileMultiSelect && "border-accent bg-accent-soft text-accent")}
            title="터치에서도 여러 레이어를 선택할 수 있어요"
          >
            <ListChecks size={13} />
            <span className="hidden min-[350px]:inline">다중 선택</span>
          </button>
          <button
            type="button"
            onClick={() => onAction({ type: "create-group", seedIds: [...selectedIds] })}
            disabled={createGroupUnavailableReason !== undefined}
            className={compactControl}
            aria-label={`새 레이어 그룹${createGroupUnavailableReason ? `, 사용 불가: ${createGroupUnavailableReason}` : ""}`}
            title={createGroupUnavailableReason ?? "선택 레이어로 새 그룹 만들기"}
          >
            <FolderPlus size={13} />
            <span className="hidden min-[390px]:inline">그룹</span>
          </button>
        </div>

        {selectionOwnership.bannerLabel ? (
          <p
            role="status"
            data-studio-live-selection-ownership={
              selectionOwnership.primaryKind ?? "free"
            }
            data-studio-live-selection-blocked={
              selectionOwnership.blocksLocalEdit ? "true" : "false"
            }
            className={cn(
              "mt-2 truncate rounded-md border px-2 py-1 text-[0.62rem] font-semibold",
              selectionOwnership.blocksLocalEdit
                ? "border-bad/35 bg-bad/10 text-bad"
                : "border-good/30 bg-good/10 text-good"
            )}
            title={selectionOwnership.bannerLabel}
          >
            {selectionOwnership.bannerLabel}
          </p>
        ) : null}

        <div className="mt-2 flex items-center gap-1.5">
          <label className="relative min-w-0 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-3" aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && query) {
                  event.preventDefault();
                  setQuery("");
                } else if (event.key === "Enter") {
                  const firstItem = focusTargets.find((target) => target.kind === "item");
                  if (firstItem) {
                    event.preventDefault();
                    focusRow(firstItem.key);
                  }
                }
              }}
              maxLength={512}
              aria-label="레이어 이름·텍스트·그룹 검색"
              aria-describedby={resultStatusId}
              placeholder="이름, 대사, 종류, 그룹 검색"
              className={cn(
                "min-h-9 w-full rounded-lg border border-line bg-card py-1.5 pl-8 pr-8 text-xs text-fg placeholder:text-fg-3",
                "max-lg:min-h-11 pointer-coarse:min-h-11",
                focusRing
              )}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className={cn(
                  "absolute right-0 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded text-fg-3 hover:text-fg",
                  coarseTarget,
                  focusRing
                )}
                aria-label="레이어 검색어 지우기"
              >
                <X size={13} />
              </button>
            ) : null}
          </label>
          <button
            ref={filterTriggerRef}
            type="button"
            onClick={() => {
              setActionTarget(null);
              setFilterOpen((current) => !current);
            }}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            aria-controls={filterPanelId}
            className={cn(
              compactControl,
              (activeFilterCount > 0 || query) && "border-accent bg-accent-soft text-accent"
            )}
          >
            <SlidersHorizontal size={13} />
            필터
            {activeFilterCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-[0.55rem] text-on-accent">
                {activeFilterCount}
              </span>
            ) : null}
          </button>
        </div>

        {filterActive ? (
          <div className="mt-1.5 flex max-w-full items-center gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <span className="shrink-0 text-[0.58rem] font-semibold text-accent">
              {results.length}/{stats.total}
            </span>
            {query ? <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem] text-fg-2">“{query}”</span> : null}
            {filters.kind !== "all" ? <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem]">{STUDIO_LAYER_KIND_LABELS[filters.kind]}</span> : null}
            {filters.visibility !== "all" ? (
              <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem]">
                {filters.visibility === "visible" ? "표시만" : "숨김만"}
              </span>
            ) : null}
            {filters.lock !== "all" ? (
              <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem]">
                {filters.lock === "locked" ? "잠김만" : "잠금 해제만"}
              </span>
            ) : null}
            {filters.role !== "all" ? (
              <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem]">
                {filters.role === "unassigned" ? "역할 없음" : STUDIO_LAYER_ROLE_LABELS[filters.role]}
              </span>
            ) : null}
            {filters.color !== "all" ? (
              <span className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem]">
                {filters.color === "none" ? "색 없음" : STUDIO_LAYER_COLOR_LABELS[filters.color]}
              </span>
            ) : null}
            {filters.flags.map((flag) => (
              <span key={flag} className="shrink-0 rounded bg-raised px-1.5 py-0.5 text-[0.58rem]">
                {STUDIO_LAYER_FLAG_LABELS[flag]}
              </span>
            ))}
            <button
              type="button"
              onClick={resetFilters}
              className={cn("ml-auto shrink-0 rounded px-1.5 py-1 text-[0.68rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg lg:text-[0.58rem]", coarseTarget, focusRing)}
            >
              모두 지우기
            </button>
          </div>
        ) : null}
      </div>

      <StudioLayerNavigatorFilterPanel
        id={filterPanelId}
        panelRef={filterPanelRef}
        triggerRef={filterTriggerRef}
        open={filterOpen}
        onOpenChange={setFilterOpen}
        filters={filters}
        setFilters={setFilters}
        onReset={resetFilters}
        filterActive={filterActive}
        stats={stats}
      />

      {selectedIds.length > 0 ? (
        <StudioLayerNavigatorBatchBar
          selectedIds={selectedIds}
          outsideSelectionCount={outsideSelectionCount}
          batchSelectedIds={batchSelectedIds}
          batchShowIds={batchShowIds}
          batchUnlockIds={batchUnlockIds}
          batchShowBlockedCount={batchShowBlockedCount}
          batchUnlockBlockedCount={batchUnlockBlockedCount}
          mutationDisabled={mutationDisabled}
          readOnly={readOnly}
          batchMergeFallbackNote={batchMergeFallbackNote}
          flattenVisibleFallbackNote={flattenVisibleFallbackNote}
          mergeFallbackNoteId={mergeFallbackNoteId}
          flattenFallbackNoteId={flattenFallbackNoteId}
          actionPopoverId={actionPopoverId}
          actionTargetKind={actionTarget?.kind ?? null}
          onAction={onAction}
          onOpenActionMenu={openActionMenu}
        />
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 overscroll-contain [scrollbar-gutter:stable]">
        <StudioLayerNavigatorTree
          nodes={nodes}
          filterActive={filterActive}
          selectedIdSet={selectedIdSet}
          tabStopKey={tabStopKey}
          mutationDisabled={mutationDisabled}
          mobileMultiSelect={mobileMultiSelect}
          getGroupItemIds={(groupId) =>
            displayItems.filter((item) => item.groupId === groupId).map((item) => item.id)
          }
          rowRefs={rowRefs}
          renameTarget={renameTarget}
          actionTargetKind={actionTarget?.kind ?? null}
          actionTargetId={actionTarget?.id ?? null}
          actionPopoverId={actionPopoverId}
          onSelectionChange={onSelectionChange}
          visibleItemIds={visibleItemIds}
          setFocusedKey={setFocusedKey}
          handleTreeItemKeyDown={handleTreeItemKeyDown}
          selectGroupItems={selectGroupItems}
          replaceWithGroupItems={replaceWithGroupItems}
          beginRename={beginRename}
          renderRenameInput={renderRenameInput}
          setGroupCollapsed={setGroupCollapsed}
          onAction={onAction}
          openActionMenu={openActionMenu}
          renderItemRow={renderItemRow}
          resetFilters={resetFilters}
        />
      </div>

      {actionTarget && (actionTarget.kind === "batch" || activeItem || activeGroup) ? (
        <div
          id={actionPopoverId}
          ref={actionPopoverRef}
          role="dialog"
          aria-modal="false"
          aria-label={
            actionTarget.kind === "batch"
              ? "선택 레이어 일괄 작업"
              : activeItem
                ? `${activeItem.label} 레이어 작업`
                : `${activeGroup?.name ?? "그룹"} 그룹 작업`
          }
          tabIndex={-1}
          className="absolute inset-x-2 bottom-2 z-40 max-h-[min(28rem,68vh)] overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-2xl"
        >
          <div className="flex items-start justify-between gap-2 border-b border-line pb-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-fg">
                {actionTarget.kind === "batch" ? `선택 ${batchSelectedIds.length}개` : activeItem?.label ?? activeGroup?.name}
              </p>
              <p className="text-[0.68rem] text-fg-3 lg:text-[0.6rem]">
                {actionTarget.kind === "batch"
                  ? outsideSelectionCount > 0
                    ? `현재 결과만 적용 · 필터 밖 ${outsideSelectionCount}개 제외`
                    : "그룹 · 역할 · 색 · 삭제"
                  : activeItem
                    ? "레이어 작업"
                    : `그룹 작업 · ${activeGroupItemIds.length}개`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setActionTarget(null);
                actionTriggerRef.current?.focus();
              }}
              className={cn("grid size-8 place-items-center rounded text-fg-3 hover:bg-raised hover:text-fg", coarseTarget, focusRing)}
              aria-label="레이어 작업 닫기"
            >
              <X size={14} />
            </button>
          </div>

          {actionTarget.kind === "batch" ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {outsideSelectionCount > 0 ? (
                <p className="col-span-2 rounded-md border border-warning/35 bg-warning-soft/20 px-2 py-2 text-[0.68rem] leading-relaxed text-warning">
                  화면에 보이는 선택 {batchSelectedIds.length}개에만 적용합니다. 필터 밖 선택 {outsideSelectionCount}개는 변경하거나 삭제하지 않습니다.
                </p>
              ) : null}
              <label className="col-span-2 text-[0.68rem] font-semibold text-fg-3">
                그룹
                <select
                  value={commonSelectedGroup ?? ""}
                  disabled={mutationDisabled || groupingDisabled || filterActive || batchSelectedIds.length === 0}
                  onChange={(event) => setSelectedGroup(event.target.value, batchSelectedIds)}
                  aria-label="선택 레이어 그룹"
                  title={
                    groupingDisabled
                      ? "현재 작업면은 레이어 그룹을 지원하지 않아요"
                      : filterActive
                        ? "검색·필터를 지운 뒤 그룹을 바꿀 수 있어요"
                        : undefined
                  }
                  className={cn("mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11", focusRing)}
                >
                  {commonSelectedGroup === "__mixed__" ? <option value="__mixed__" disabled>여러 그룹</option> : null}
                  <option value="">그룹 없음</option>
                  {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label className="text-[0.68rem] font-semibold text-fg-3">
                작업 역할
                <select
                  value={commonSelectedRole ?? ""}
                  disabled={mutationDisabled || batchSelectedIds.length === 0}
                  onChange={(event) => setSelectedRole(event.target.value, batchSelectedIds)}
                  aria-label="선택 레이어 역할"
                  className={cn("mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11", focusRing)}
                >
                  {commonSelectedRole === "__mixed__" ? <option value="__mixed__" disabled>여러 역할</option> : null}
                  <option value="">역할 없음</option>
                  {STUDIO_LAYER_ROLES.map((role) => <option key={role} value={role}>{STUDIO_LAYER_ROLE_LABELS[role]}</option>)}
                </select>
              </label>
              <label className="text-[0.68rem] font-semibold text-fg-3">
                색 라벨
                <select
                  value={commonSelectedColor ?? ""}
                  disabled={mutationDisabled || batchSelectedIds.length === 0}
                  onChange={(event) => setSelectedColor(event.target.value, batchSelectedIds)}
                  aria-label="선택 레이어 색 라벨"
                  className={cn("mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11", focusRing)}
                >
                  {commonSelectedColor === "__mixed__" ? <option value="__mixed__" disabled>여러 색</option> : null}
                  <option value="">색 없음</option>
                  {STUDIO_LAYER_COLORS.map((color) => <option key={color} value={color}>{STUDIO_LAYER_COLOR_LABELS[color]}</option>)}
                </select>
              </label>
              <button
                type="button"
                disabled={
                  createGroupUnavailableReason !== undefined ||
                  batchSelectedIds.length === 0
                }
                onClick={() => onAction({ type: "create-group", seedIds: batchSelectedIds })}
                className={compactControl}
                aria-label={`새 그룹으로 묶기${
                  createGroupUnavailableReason
                    ? `, 사용 불가: ${createGroupUnavailableReason}`
                    : batchSelectedIds.length === 0
                      ? ", 사용 불가: 먼저 레이어를 선택하세요."
                      : ""
                }`}
                title={
                  createGroupUnavailableReason ??
                  (batchSelectedIds.length === 0
                    ? "먼저 레이어를 선택하세요."
                    : "선택 레이어를 새 그룹으로 묶기")
                }
              >
                <FolderPlus size={13} /> 새 그룹으로 묶기
              </button>
              <button
                type="button"
                disabled={mutationDisabled || batchSelectedIds.length < 2}
                onClick={() => {
                  onAction({ type: "merge-selected", ids: batchSelectedIds });
                  setActionTarget(null);
                }}
                className={compactControl}
                title={batchMergeFallbackNote ?? "선택한 레이어를 한 장으로 굽습니다"}
                aria-label={batchMergeFallbackNote ? "선택 묶기, 병합 보류" : "선택 레이어 병합"}
                aria-describedby={batchMergeFallbackNote ? mergeFallbackNoteId : undefined}
              >
                <Layers3 size={13} /> {batchMergeFallbackNote ? "선택 묶기" : "선택 병합"}
              </button>
              <button
                type="button"
                disabled={mutationDisabled}
                onClick={() => {
                  onAction({ type: "flatten-visible" });
                  setActionTarget(null);
                }}
                className={compactControl}
                title={flattenVisibleFallbackNote ?? "표시 중인 레이어를 한 장으로 굽습니다"}
                aria-label={flattenVisibleFallbackNote ? "표시 묶기, 병합 보류" : "표시 레이어 병합"}
                aria-describedby={flattenVisibleFallbackNote ? flattenFallbackNoteId : undefined}
              >
                <Grid2X2 size={13} /> {flattenVisibleFallbackNote ? "표시 묶기" : "표시 병합"}
              </button>
              {batchMergeFallbackNote || flattenVisibleFallbackNote ? (
                <p className="col-span-2 rounded-md bg-warning-soft/20 px-2 py-1.5 text-[0.6rem] leading-relaxed text-warning">
                  {batchMergeFallbackNote ?? flattenVisibleFallbackNote}
                </p>
              ) : null}
              <button
                type="button"
                disabled={mutationDisabled || batchSelectedIds.length === 0}
                onClick={() => {
                  onAction({ type: "delete-items", ids: batchSelectedIds });
                  setActionTarget(null);
                  globalThis.requestAnimationFrame?.(() => searchInputRef.current?.focus());
                }}
                className={cn(compactControl, "text-bad")}
              >
                <Trash2 size={13} /> 현재 결과 삭제
              </button>
              <button
                type="button"
                onClick={() => {
                  onSelectionChange([]);
                  setActionTarget(null);
                  globalThis.requestAnimationFrame?.(() => searchInputRef.current?.focus());
                }}
                className={cn(compactControl, "col-span-2")}
              >
                선택 전체 해제
              </button>
            </div>
          ) : activeItem ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button type="button" disabled={mutationDisabled} onClick={() => beginRename("item", activeItem.id, activeItem.label)} className={compactControl}>
                <TypeIcon size={13} /> 이름 변경
              </button>
              {activeItem.type === "frame" ? (
                <button
                  type="button"
                  disabled={
                    readOnly
                    || groupingDisabled
                    || selectedIds.filter((id) => id !== activeItem.id).length === 0
                  }
                  onClick={() =>
                    onAction({
                      type: "create-frame-folder",
                      frameId: activeItem.id,
                      seedIds: selectedIds,
                    })
                  }
                  className={compactControl}
                  title="선택한 다른 레이어를 이 컷의 폴더로 묶고 패널 클립을 켭니다 (공유 거터 편집은 후속)"
                >
                  <FolderPlus size={13} /> 컷 폴더로 묶기
                </button>
              ) : null}
              <button
                type="button"
                disabled={mutationDisabled || activeItemHiddenByGroup}
                onClick={() => onAction({ type: "set-items-hidden", ids: [activeItem.id], hidden: !activeItem.hidden })}
                className={compactControl}
                title={activeItemHiddenByGroup ? "상위 그룹이 숨겨져 있어 그룹을 먼저 표시해야 해요" : undefined}
              >
                {activeItem.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                {activeItemHiddenByGroup ? "그룹에서 숨김" : activeItem.hidden ? "표시" : "숨김"}
              </button>
              <button
                type="button"
                onClick={() => onToggleLocalHidden(activeItem.id)}
                className={compactControl}
                title="다른 협업자 화면에는 그대로 보이고, 내 화면에서만 숨겨요"
              >
                <Ghost size={13} /> {activeItemLocallyHidden ? "나만 숨기기 해제" : "나만 숨기기"}
              </button>
              {onToggleLayerSolo ? (
                <button
                  type="button"
                  onClick={() => onToggleLayerSolo(activeItem.id)}
                  className={cn(
                    compactControl,
                    soloLayerId === activeItem.id && "border-accent/40 bg-accent-soft/50 text-accent"
                  )}
                  title="이 레이어만 내 화면에 남기고 나머지는 임시로 숨겨요 (협업 문서에는 반영되지 않아요)"
                  aria-pressed={soloLayerId === activeItem.id}
                >
                  <Crosshair size={13} />
                  {soloLayerId === activeItem.id ? "솔로 해제" : "솔로"}
                </button>
              ) : null}
              <button
                type="button"
                disabled={mutationDisabled || activeItemLockedByGroup}
                onClick={() => onAction({ type: "set-items-locked", ids: [activeItem.id], locked: !activeItem.locked })}
                className={compactControl}
                title={activeItemLockedByGroup ? "상위 그룹이 잠겨 있어 그룹 잠금을 먼저 해제해야 해요" : undefined}
              >
                {activeItem.locked ? <LockOpen size={13} /> : <Lock size={13} />}
                {activeItemLockedByGroup ? "그룹에서 잠김" : activeItem.locked ? "잠금 해제" : "잠금"}
              </button>
              {activeItem.type === "image" ? (
                <>
                  <button type="button" disabled={mutationDisabled || activeItemEffectivelyLocked} onClick={() => onAction({ type: "set-item-flag", id: activeItem.id, flag: "alphaLocked", value: !activeItem.alphaLocked })} className={compactControl}>
                    <Grid2X2 size={13} /> {activeItem.alphaLocked ? "알파 락 해제" : "알파 락"}
                  </button>
                  <button type="button" disabled={mutationDisabled} onClick={() => onAction({ type: "set-item-flag", id: activeItem.id, flag: "fillReference", value: !activeItem.fillReference })} className={compactControl}>
                    <ScanLine size={13} /> {activeItem.fillReference ? "참조 해제" : "채우기 참조"}
                  </button>
                  {activeItem.masked ? (
                    <button type="button" disabled={mutationDisabled || activeItemEffectivelyLocked} onClick={() => onAction({ type: "set-item-flag", id: activeItem.id, flag: "maskEnabled", value: activeItem.maskEnabled === false })} className={compactControl}>
                      <Layers3 size={13} /> {activeItem.maskEnabled === false ? "마스크 켜기" : "마스크 끄기"}
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                disabled={mutationDisabled || filterActive}
                onClick={() => onAction({ type: "move-item", id: activeItem.id, direction: "up" })}
                className={compactControl}
                title={filterActive ? "검색·필터를 지우면 전체 레이어 순서를 바꿀 수 있어요" : "앞으로 이동"}
              >
                <ArrowUp size={13} /> 앞으로
              </button>
              <button
                type="button"
                disabled={mutationDisabled || filterActive}
                onClick={() => onAction({ type: "move-item", id: activeItem.id, direction: "down" })}
                className={compactControl}
                title={filterActive ? "검색·필터를 지우면 전체 레이어 순서를 바꿀 수 있어요" : "뒤로 이동"}
              >
                <ArrowDown size={13} /> 뒤로
              </button>

              {filterActive ? (
                <p className="col-span-2 rounded-md bg-warning-soft/20 px-2 py-1.5 text-[0.6rem] leading-relaxed text-warning">
                  필터된 목록에서는 보이지 않는 레이어와 순서가 섞이지 않도록 재정렬을 잠급니다.
                </p>
              ) : null}

              <label className="col-span-2 text-[0.62rem] font-semibold text-fg-3">
                그룹
                <select
                  value={availableGroups.some((group) => group.id === activeItem.groupId) ? activeItem.groupId : ""}
                  disabled={mutationDisabled || groupingDisabled || filterActive}
                  onChange={(event) => setSelectedGroup(event.target.value, [activeItem.id])}
                  title={
                    groupingDisabled
                      ? "현재 작업면은 레이어 그룹을 지원하지 않아요"
                      : filterActive
                        ? "검색·필터를 지운 뒤 그룹을 바꿀 수 있어요"
                        : undefined
                  }
                  className={cn("mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11", focusRing)}
                >
                  <option value="">그룹 없음</option>
                  {availableGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
              </label>
              <label className="text-[0.62rem] font-semibold text-fg-3">
                <span className="inline-flex items-center gap-1"><Tags size={11} /> 작업 역할</span>
                <select
                  value={activeItem.role ?? ""}
                  disabled={mutationDisabled}
                  onChange={(event) => setSelectedRole(event.target.value, [activeItem.id])}
                  className={cn("mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11", focusRing)}
                >
                  <option value="">역할 없음</option>
                  {STUDIO_LAYER_ROLES.map((role) => <option key={role} value={role}>{STUDIO_LAYER_ROLE_LABELS[role]}</option>)}
                </select>
              </label>
              <label className="text-[0.62rem] font-semibold text-fg-3">
                <span className="inline-flex items-center gap-1"><Palette size={11} /> 색 라벨</span>
                <select
                  value={activeItem.color ?? ""}
                  disabled={mutationDisabled}
                  onChange={(event) => setSelectedColor(event.target.value, [activeItem.id])}
                  className={cn("mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11", focusRing)}
                >
                  <option value="">색 없음</option>
                  {STUDIO_LAYER_COLORS.map((color) => <option key={color} value={color}>{STUDIO_LAYER_COLOR_LABELS[color]}</option>)}
                </select>
              </label>
              <button
                type="button"
                disabled={mutationDisabled}
                onClick={() => {
                  onAction({ type: "merge-down", id: activeItem.id });
                  setActionTarget(null);
                }}
                className={compactControl}
                title={
                  activeItemMergeDownFallbackNote
                    ?? "아래 레이어와 한 장으로 굽습니다 (레이어 1장이 줄어요)"
                }
                aria-label={activeItemMergeDownFallbackNote ? "아래와 묶기, 병합 보류" : "아래로 병합"}
                aria-describedby={activeItemMergeDownFallbackNote ? mergeDownFallbackNoteId : undefined}
              >
                <Layers3 size={13} />
                {activeItemMergeDownFallbackNote ? "아래와 묶기" : "아래로 병합"}
              </button>
              <button
                type="button"
                disabled={mutationDisabled}
                onClick={() => {
                  onAction({ type: "flatten-visible" });
                  setActionTarget(null);
                }}
                className={compactControl}
                title={
                  flattenVisibleFallbackNote
                    ?? "표시 중인 레이어를 한 장으로 굽습니다"
                }
                aria-label={flattenVisibleFallbackNote ? "표시 묶기, 병합 보류" : "표시 레이어 병합"}
                aria-describedby={flattenVisibleFallbackNote ? flattenFallbackNoteId : undefined}
              >
                <Grid2X2 size={13} />
                {flattenVisibleFallbackNote ? "표시 묶기" : "표시 병합"}
              </button>
              {activeItemMergeDownFallbackNote || flattenVisibleFallbackNote ? (
                <p className="col-span-2 rounded-md bg-warning-soft/20 px-2 py-1.5 text-[0.6rem] leading-relaxed text-warning">
                  {activeItemMergeDownFallbackNote ?? flattenVisibleFallbackNote}
                </p>
              ) : null}
              <button
                type="button"
                disabled={mutationDisabled}
                onClick={() => onAction({ type: "delete-items", ids: [activeItem.id] })}
                className={cn(compactControl, "col-span-2 text-bad")}
              >
                <Trash2 size={13} /> 레이어 삭제
              </button>
            </div>
          ) : activeGroup ? (
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <button type="button" disabled={mutationDisabled} onClick={() => beginRename("group", activeGroup.id, activeGroup.name)} className={compactControl}>
                <TypeIcon size={13} /> 이름 변경
              </button>
              <button
                type="button"
                onClick={() => selectGroupItems(activeGroupItemIds)}
                aria-label={
                  activeGroupAllSelected
                    ? `${activeGroup.name} 그룹 선택 해제`
                    : `${activeGroup.name} 그룹 모두 선택`
                }
                aria-pressed={activeGroupAllSelected}
                className={compactControl}
              >
                <ListChecks size={13} />
                {activeGroupAllSelected ? "그룹 선택 해제" : "모두 선택"}
              </button>
              <button type="button" disabled={mutationDisabled} onClick={() => onAction({ type: "set-group-flag", groupId: activeGroup.id, flag: "hidden", value: !activeGroup.hidden })} className={compactControl}>
                {activeGroup.hidden ? <Eye size={13} /> : <EyeOff size={13} />}
                {activeGroup.hidden ? "그룹 표시" : "그룹 숨김"}
              </button>
              <button type="button" disabled={mutationDisabled} onClick={() => onAction({ type: "set-group-flag", groupId: activeGroup.id, flag: "locked", value: !activeGroup.locked })} className={compactControl}>
                {activeGroup.locked ? <LockOpen size={13} /> : <Lock size={13} />}
                {activeGroup.locked ? "잠금 해제" : "그룹 잠금"}
              </button>
              <button
                type="button"
                disabled={mutationDisabled || groupingDisabled || filterActive || activeGroupItemIds.length === 0}
                onClick={() => onAction({ type: "move-group", groupId: activeGroup.id, direction: "up" })}
                className={compactControl}
                title={filterActive ? "검색·필터를 지우면 그룹 블록 순서를 바꿀 수 있어요" : "그룹 블록을 앞으로 이동"}
              >
                <ArrowUp size={13} /> 그룹 앞으로
              </button>
              <button
                type="button"
                disabled={mutationDisabled || groupingDisabled || filterActive || activeGroupItemIds.length === 0}
                onClick={() => onAction({ type: "move-group", groupId: activeGroup.id, direction: "down" })}
                className={compactControl}
                title={filterActive ? "검색·필터를 지우면 그룹 블록 순서를 바꿀 수 있어요" : "그룹 블록을 뒤로 이동"}
              >
                <ArrowDown size={13} /> 그룹 뒤로
              </button>
              {filterActive ? (
                <p className="col-span-2 rounded-md bg-warning-soft/20 px-2 py-1.5 text-[0.6rem] leading-relaxed text-warning">
                  필터된 목록에서는 그룹 밖 레이어와 순서가 섞이지 않도록 그룹 이동을 잠급니다.
                </p>
              ) : null}
              <button
                type="button"
                disabled={mutationDisabled || groupingDisabled || filterActive}
                onClick={() => onAction({ type: "ungroup", groupId: activeGroup.id })}
                className={cn(compactControl, "col-span-2")}
                title={
                  groupingDisabled
                    ? "현재 작업면은 레이어 그룹을 지원하지 않아요"
                    : filterActive
                      ? "검색·필터를 지운 뒤 그룹을 해제할 수 있어요"
                      : undefined
                }
              >
                <FolderMinus size={13} /> 그룹 해제 · 레이어 보존
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
