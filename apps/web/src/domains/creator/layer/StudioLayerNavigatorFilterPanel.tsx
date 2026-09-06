import { Layers3, X } from "lucide-react";


import {
  STUDIO_LAYER_COLORS,
  STUDIO_LAYER_COLOR_LABELS,
  STUDIO_LAYER_FLAGS,
  STUDIO_LAYER_FLAG_LABELS,
  STUDIO_LAYER_KIND_LABELS,
  STUDIO_LAYER_KINDS,
  STUDIO_LAYER_ROLES,
  STUDIO_LAYER_ROLE_LABELS,
  type StudioLayerFlag,
  type StudioLayerNavigatorFilters,
} from "./studio-layer-navigator";
import {
  STUDIO_LAYER_NAVIGATOR_COARSE_TARGET as coarseTarget,
  STUDIO_LAYER_NAVIGATOR_FOCUS_RING as focusRing,
  STUDIO_LAYER_NAVIGATOR_KIND_ICONS as KIND_ICONS,
} from "./studio-layer-navigator-row-ui";

import type { RefObject } from "react";

import { cn } from "@/shared/lib/utils";

const compactControl = cn(
  "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md border border-line bg-card px-2 text-[0.68rem] font-semibold text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40",
  coarseTarget,
  focusRing
);

export interface StudioLayerNavigatorFilterPanelProps {
  id: string;
  panelRef: RefObject<HTMLDivElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: StudioLayerNavigatorFilters;
  setFilters: (
    updater: (current: StudioLayerNavigatorFilters) => StudioLayerNavigatorFilters
  ) => void;
  onReset: () => void;
  filterActive: boolean;
  stats: { referenced: number; masked: number; ai: number };
}

export function StudioLayerNavigatorFilterPanel({
  id,
  panelRef,
  triggerRef,
  open,
  onOpenChange,
  filters,
  setFilters,
  onReset,
  filterActive,
  stats,
}: StudioLayerNavigatorFilterPanelProps) {
  function toggleFilterFlag(flag: StudioLayerFlag) {
    setFilters((current) => ({
      ...current,
      flags: current.flags.includes(flag)
        ? current.flags.filter((candidate) => candidate !== flag)
        : [...current.flags, flag],
    }));
  }

  return (
    <div
      id={id}
      ref={panelRef}
      role="dialog"
      aria-label="레이어 필터"
      aria-modal="false"
      tabIndex={-1}
      hidden={!open}
      className={cn(
        "absolute inset-x-2 z-30 max-h-[min(28rem,62vh)] overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-2xl",
        filterActive ? "top-[9.5rem]" : "top-[7.75rem]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-fg">레이어 필터</p>
          <p className="text-[0.6rem] text-fg-3">기능 필터는 모두 만족하는 레이어만 표시합니다.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            triggerRef.current?.focus();
          }}
          className={cn(
            "grid size-8 place-items-center rounded-md text-fg-3 hover:bg-raised hover:text-fg",
            coarseTarget,
            focusRing
          )}
          aria-label="레이어 필터 닫기"
        >
          <X size={14} />
        </button>
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1 text-[0.62rem] font-bold text-fg-2">종류</legend>
        <div className="grid grid-cols-3 gap-1">
          {STUDIO_LAYER_KINDS.map((kind) => {
            const Icon = kind === "all" ? Layers3 : KIND_ICONS[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setFilters((current) => ({ ...current, kind }))}
                aria-pressed={filters.kind === kind}
                className={cn(
                  compactControl,
                  "justify-start",
                  filters.kind === kind && "border-accent bg-accent-soft text-accent"
                )}
              >
                <Icon size={12} /> {STUDIO_LAYER_KIND_LABELS[kind]}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[0.62rem] font-bold text-fg-2">
          표시 상태
          <select
            value={filters.visibility}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                visibility: event.target.value as StudioLayerNavigatorFilters["visibility"],
              }))
            }
            className={cn(
              "mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11",
              focusRing
            )}
          >
            <option value="all">전체</option>
            <option value="visible">표시만</option>
            <option value="hidden">숨김만</option>
          </select>
        </label>
        <label className="text-[0.62rem] font-bold text-fg-2">
          잠금 상태
          <select
            value={filters.lock}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                lock: event.target.value as StudioLayerNavigatorFilters["lock"],
              }))
            }
            className={cn(
              "mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11",
              focusRing
            )}
          >
            <option value="all">전체</option>
            <option value="locked">잠김만</option>
            <option value="unlocked">잠금 해제만</option>
          </select>
        </label>
        <label className="text-[0.62rem] font-bold text-fg-2">
          작업 역할
          <select
            value={filters.role}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                role: event.target.value as StudioLayerNavigatorFilters["role"],
              }))
            }
            className={cn(
              "mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11",
              focusRing
            )}
          >
            <option value="all">전체 역할</option>
            <option value="unassigned">역할 없음</option>
            {STUDIO_LAYER_ROLES.map((role) => (
              <option key={role} value={role}>
                {STUDIO_LAYER_ROLE_LABELS[role]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[0.62rem] font-bold text-fg-2">
          색 라벨
          <select
            value={filters.color}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                color: event.target.value as StudioLayerNavigatorFilters["color"],
              }))
            }
            className={cn(
              "mt-1 min-h-9 w-full rounded-md border border-line bg-card px-2 text-xs text-fg max-lg:min-h-11 pointer-coarse:min-h-11",
              focusRing
            )}
          >
            <option value="all">전체 색</option>
            <option value="none">색 없음</option>
            {STUDIO_LAYER_COLORS.map((color) => (
              <option key={color} value={color}>
                {STUDIO_LAYER_COLOR_LABELS[color]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="mb-1 text-[0.62rem] font-bold text-fg-2">전문 상태</legend>
        <div className="grid grid-cols-2 gap-1">
          {STUDIO_LAYER_FLAGS.map((flag) => (
            <label
              key={flag}
              className={cn(
                "flex min-h-9 items-center gap-2 rounded-md border border-line bg-card px-2 text-[0.65rem] text-fg-2 hover:bg-raised max-lg:min-h-11 pointer-coarse:min-h-11",
                focusRing
              )}
            >
              <input
                type="checkbox"
                checked={filters.flags.includes(flag)}
                onChange={() => toggleFilterFlag(flag)}
                className="size-4 accent-accent"
              />
              {STUDIO_LAYER_FLAG_LABELS[flag]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2">
        <span className="text-[0.6rem] text-fg-3">
          참조 {stats.referenced} · 마스크 {stats.masked} · AI {stats.ai}
        </span>
        <button type="button" onClick={onReset} className={compactControl}>
          필터 초기화
        </button>
      </div>
    </div>
  );
}
