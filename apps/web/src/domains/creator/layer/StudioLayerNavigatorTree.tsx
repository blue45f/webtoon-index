import { ChevronDown, ChevronRight, Eye, EyeOff, Folder, Lock, LockOpen, MoreHorizontal, Search, Layers3, Check, Minus } from "lucide-react";

import {
  STUDIO_LAYER_NAVIGATOR_COARSE_TARGET as coarseTarget,
  STUDIO_LAYER_NAVIGATOR_FOCUS_RING as focusRing,
} from "./studio-layer-navigator-row-ui";

import type { StudioLayerNavigatorNode, StudioLayerNavigatorResult } from "./studio-layer-navigator";
import type { FocusTarget, StudioLayerNavigatorAction } from "./StudioLayerNavigator";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";



import { cn } from "@/shared/lib/utils";

export interface StudioLayerNavigatorTreeProps {
  nodes: readonly StudioLayerNavigatorNode[];
  filterActive: boolean;
  selectedIdSet: ReadonlySet<string>;
  tabStopKey: string | null;
  mutationDisabled: boolean;
  mobileMultiSelect: boolean;
  getGroupItemIds: (groupId: string) => readonly string[];
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
  renameTarget: { kind: "item" | "group"; id: string; value: string } | null;
  actionTargetKind: string | null;
  actionTargetId: string | null;
  actionPopoverId: string;
  onSelectionChange: (ids: readonly string[]) => void;
  visibleItemIds: readonly string[];
  setFocusedKey: (key: string | null) => void;
  handleTreeItemKeyDown: (event: ReactKeyboardEvent<HTMLElement>, target: FocusTarget) => void;
  selectGroupItems: (itemIds: readonly string[]) => void;
  replaceWithGroupItems: (itemIds: readonly string[]) => void;
  beginRename: (kind: "item" | "group", id: string, value: string) => void;
  renderRenameInput: (target: { kind: "item" | "group"; id: string; value: string }, focusKey: string) => ReactNode;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  onAction: (action: StudioLayerNavigatorAction) => void;
  openActionMenu: (event: React.MouseEvent<HTMLButtonElement>, target: { kind: "group"; id: string }) => void;
  renderItemRow: (entry: StudioLayerNavigatorResult, key: string, level: number) => ReactNode;
  resetFilters: () => void;
}

function isLayerRowControl(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-layer-row-control]") !== null;
}

export function StudioLayerNavigatorTree({
  nodes,
  filterActive,
  selectedIdSet,
  tabStopKey,
  mutationDisabled,
  mobileMultiSelect,
  getGroupItemIds,
  rowRefs,
  renameTarget,
  actionTargetKind,
  actionTargetId,
  actionPopoverId,
  onSelectionChange,
  visibleItemIds,
  setFocusedKey,
  handleTreeItemKeyDown,
  selectGroupItems,
  replaceWithGroupItems,
  beginRename,
  renderRenameInput,
  setGroupCollapsed,
  onAction,
  openActionMenu,
  renderItemRow,
  resetFilters,
}: StudioLayerNavigatorTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="grid min-h-40 place-items-center px-4 py-8 text-center" role="status">
        <div>
          {filterActive ? (
            <Search size={22} className="mx-auto text-fg-3" aria-hidden />
          ) : (
            <Layers3 size={22} className="mx-auto text-fg-3" aria-hidden />
          )}
          <p className="mt-2 text-xs font-semibold text-fg-2">
            {filterActive ? "조건에 맞는 레이어가 없습니다" : "아직 레이어가 없습니다"}
          </p>
          <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
            {filterActive
              ? "검색어나 필터를 지우고 다시 확인해 보세요."
              : "이미지, 말풍선, 텍스트 또는 선화를 추가하면 이곳에서 관리할 수 있어요."}
          </p>
          {filterActive ? (
            <button
              type="button"
              onClick={resetFilters}
              className={cn(
                "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40",
                coarseTarget,
                focusRing,
                "mt-3"
              )}
            >
              필터 지우기
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <ul
      role="tree"
      aria-label="레이어 트리"
      aria-multiselectable="true"
      className="flex flex-col gap-0.5"
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLocaleLowerCase() === "a" &&
          event.target === event.currentTarget
        ) {
          event.preventDefault();
          event.stopPropagation();
          onSelectionChange(visibleItemIds.slice(0, 500));
        }
      }}
    >
      {nodes.map((node) => {
        if (node.kind === "item") return renderItemRow(node.entry, node.key, 1);
        const key = node.key;
        const editing = renameTarget?.kind === "group" && renameTarget.id === node.group.id;
        const target = {
          key,
          kind: "group" as const,
          group: node.group,
          itemIds: node.entries.map((entry) => entry.item.id),
          expanded: node.expanded,
        };
        const selectedChildCount = target.itemIds.filter((id) => selectedIdSet.has(id)).length;
        const allChildrenSelected =
          target.itemIds.length > 0 && selectedChildCount === target.itemIds.length;
        const partiallySelected = selectedChildCount > 0 && !allChildrenSelected;
        const groupStatus = [
          node.group.hidden ? "숨김" : null,
          node.group.locked ? "잠김" : null,
          selectedChildCount > 0 ? `${selectedChildCount}개 선택` : null,
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <li
            key={key}
            role="none"
            className={cn(
              "rounded-lg border bg-card/25 transition-[border-color,background-color] duration-150 motion-reduce:transition-none",
              allChildrenSelected
                ? "border-accent/55 bg-accent-soft/20"
                : partiallySelected
                  ? "border-cool/45 bg-cool/5"
                  : "border-line/65"
            )}
            data-studio-layer-group-selection={
              allChildrenSelected ? "all" : partiallySelected ? "partial" : "none"
            }
          >
            <div
              ref={(element) => {
                if (element) rowRefs.current.set(key, element);
                else rowRefs.current.delete(key);
              }}
              role="treeitem"
              aria-level={1}
              aria-selected={allChildrenSelected}
              aria-expanded={node.empty ? undefined : node.expanded}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter Space F2 Shift+F10 Control+A Meta+A Control+G Meta+G Shift+Control+G Shift+Meta+G"
              aria-label={`${node.group.name}, 그룹, ${node.entries.length}개 레이어${
                groupStatus ? `, ${groupStatus}` : ""
              }`}
              tabIndex={tabStopKey === key ? 0 : -1}
              onFocus={() => setFocusedKey(key)}
              onKeyDown={(event) => handleTreeItemKeyDown(event, target)}
              onClick={(event) => {
                if (isLayerRowControl(event.target) || node.empty) return;
                const itemIds = getGroupItemIds(node.group.id);
                const additive =
                  event.shiftKey || event.metaKey || event.ctrlKey || mobileMultiSelect;
                if (additive) selectGroupItems(itemIds);
                else replaceWithGroupItems(itemIds);
              }}
              onDoubleClick={(event) => {
                if (isLayerRowControl(event.target)) return;
                beginRename("group", node.group.id, node.group.name);
              }}
              className={cn(
                "flex min-h-9 items-center gap-1 rounded-lg px-1 py-0.5 [contain-intrinsic-size:44px] [content-visibility:auto] max-lg:min-h-11 pointer-coarse:min-h-11",
                allChildrenSelected
                  ? "bg-accent-soft/25 hover:bg-accent-soft/40"
                  : partiallySelected
                    ? "bg-cool/5 hover:bg-cool/10"
                    : "hover:bg-raised/60",
                focusRing
              )}
            >
              {node.empty ? (
                <span className="grid size-7 shrink-0 place-items-center text-fg-3" aria-hidden>
                  <ChevronRight size={14} />
                </span>
              ) : (
                <button
                  type="button"
                  tabIndex={-1}
                  data-layer-row-control
                  onClick={(event) => {
                    event.stopPropagation();
                    setGroupCollapsed(node.group.id, node.expanded);
                  }}
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded text-fg-3 hover:bg-raised",
                    coarseTarget,
                    focusRing
                  )}
                  aria-label={
                    node.expanded
                      ? `${node.group.name} 그룹 접기`
                      : `${node.group.name} 그룹 펼치기`
                  }
                >
                  {node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              )}
              <span
                aria-hidden
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-md border",
                  allChildrenSelected
                    ? "border-accent bg-accent text-on-accent"
                    : partiallySelected
                      ? "border-cool/70 bg-cool/10 text-cool"
                      : "border-line/70 bg-card text-transparent"
                )}
              >
                {allChildrenSelected ? (
                  <Check size={12} strokeWidth={2.5} />
                ) : partiallySelected ? (
                  <Minus size={12} strokeWidth={2.5} />
                ) : null}
              </span>
              <Folder size={14} className="shrink-0 text-accent" aria-hidden />
              {editing && renameTarget ? (
                renderRenameInput(renameTarget, key)
              ) : (
                // The member count is its own chip, outside the truncating name. Inlined
                // and unitless it fused with the name — `병합 e6659cca` + `2` read as one
                // string, `병합 e6659cca2`.
                <>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[0.7rem] font-bold",
                      selectedChildCount > 0 ? "text-fg" : "text-fg-2",
                      node.group.hidden && "line-through decoration-fg-3/80"
                    )}
                  >
                    {node.group.name}
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 rounded bg-raised px-1 py-0.5 text-[0.62rem] font-normal tabular-nums text-fg-3 lg:text-[0.56rem]"
                  >
                    {node.empty ? "비어 있음" : `${node.entries.length}개`}
                  </span>
                </>
              )}
              {selectedChildCount > 0 ? (
                <span
                  aria-hidden
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[0.58rem] font-bold tabular-nums",
                    allChildrenSelected ? "bg-accent text-on-accent" : "bg-cool/15 text-cool"
                  )}
                >
                  {selectedChildCount}
                </span>
              ) : null}
              <button
                type="button"
                tabIndex={-1}
                data-layer-row-control
                onClick={(event) => {
                  event.stopPropagation();
                  onAction({
                    type: "set-group-flag",
                    groupId: node.group.id,
                    flag: "locked",
                    value: !node.group.locked,
                  });
                }}
                disabled={mutationDisabled}
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded text-fg-3 hover:bg-raised disabled:opacity-35",
                  coarseTarget,
                  focusRing
                )}
                aria-label={
                  node.group.locked
                    ? `${node.group.name} 그룹 잠금 해제`
                    : `${node.group.name} 그룹 잠금`
                }
                aria-pressed={node.group.locked === true}
              >
                {node.group.locked ? <Lock size={13} /> : <LockOpen size={13} />}
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-layer-row-control
                onClick={(event) => {
                  event.stopPropagation();
                  onAction({
                    type: "set-group-flag",
                    groupId: node.group.id,
                    flag: "hidden",
                    value: !node.group.hidden,
                  });
                }}
                disabled={mutationDisabled}
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded text-fg-3 hover:bg-raised disabled:opacity-35",
                  coarseTarget,
                  focusRing
                )}
                aria-label={
                  node.group.hidden ? `${node.group.name} 그룹 표시` : `${node.group.name} 그룹 숨김`
                }
              >
                {node.group.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
              <button
                type="button"
                tabIndex={-1}
                data-layer-row-control
                onClick={(event) => openActionMenu(event, { kind: "group", id: node.group.id })}
                aria-haspopup="dialog"
                aria-expanded={
                  actionTargetKind === "group" && actionTargetId === node.group.id
                }
                aria-controls={actionPopoverId}
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded text-fg-3 hover:bg-raised",
                  coarseTarget,
                  focusRing
                )}
                aria-label={`${node.group.name} 그룹 작업`}
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
            {node.expanded && node.entries.length > 0 ? (
              <ul
                role="group"
                aria-label={`${node.group.name} 그룹 레이어`}
                className="flex flex-col gap-0.5 border-t border-line/45 p-1 pl-3"
              >
                {node.entries.map((entry) =>
                  renderItemRow(entry, `${node.key}:item:${entry.item.id}`, 2)
                )}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
