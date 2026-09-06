/**
 * Character Shaper — the 15-slot rail (vertical on desktop/tablet, horizontal scroll on mobile).
 *
 * Roving tabindex: only the active slot is in the tab order; arrows / Home / End move and select
 * (automatic activation — switching a slot only changes the shelf, never the scene). Digits `1`–`9`
 * and `0` jump to the first ten slots while focus is inside the rail.
 */
import { useMemo, useRef } from "react";

import { STUDIO_FOCUS_RING } from "../studio-panel-ui";

import {
  characterShaperSlotIcon,
  characterSlotDiffersFromBaseline,
  characterSlotForHotkey,
  characterSlotHotkeyLabel,
  groupCharacterSlotMetas,
} from "./character-shaper-ui-model";

import type { CharacterSlotKind } from "./character-shaper-contract";
import type { CharacterShaperSlotRailProps } from "./character-shaper-ui-contract";
import type { KeyboardEvent } from "react";

import { cn } from "@/shared/lib/utils";

export function CharacterShaperSlotRail({ binding, activeSlot, onSelectSlot, orientation }: CharacterShaperSlotRailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const metas = binding.catalog.slots;
  const groups = useMemo(() => groupCharacterSlotMetas(metas), [metas]);
  const slotIds = useMemo(() => metas.map((meta) => meta.id), [metas]);
  const vertical = orientation === "vertical";

  const focusSlot = (slot: CharacterSlotKind) => {
    containerRef.current?.querySelector<HTMLButtonElement>(`[data-character-slot="${slot}"]`)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    const currentSlot = target?.closest("[data-character-slot]")?.getAttribute("data-character-slot") ?? null;
    if (!currentSlot) return;
    const index = slotIds.indexOf(currentSlot as CharacterSlotKind);
    const count = slotIds.length;
    if (index < 0 || count === 0) return;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    else {
      const hotkeySlot = characterSlotForHotkey(event.key, slotIds);
      if (hotkeySlot) next = slotIds.indexOf(hotkeySlot);
    }
    if (next === null || next < 0) return;
    event.preventDefault();
    const slot = slotIds[next];
    if (!slot) return;
    onSelectSlot(slot);
    focusSlot(slot);
  };

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="캐릭터 슬롯"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      data-character-shaper-rail={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex min-h-0 min-w-0 shrink-0 bg-panel [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        vertical
          ? "h-full w-[72px] flex-col overflow-y-auto overscroll-contain border-r border-line px-1.5 py-1.5"
          : "w-full items-stretch gap-1 overflow-x-auto overscroll-x-contain border-b border-line px-2 py-1.5",
      )}
    >
      {groups.map((group, groupIndex) => (
        <div
          key={group.group}
          role="group"
          aria-label={group.label}
          className={cn(
            "flex min-w-0 shrink-0",
            vertical
              ? cn("flex-col gap-0.5", groupIndex > 0 && "mt-1 border-t border-line/70 pt-1")
              : cn("items-stretch gap-1", groupIndex > 0 && "ml-1 border-l border-line/70 pl-2"),
          )}
        >
          {vertical ? (
            <p className="px-1 pb-1 pt-1.5 text-center text-[0.56rem] font-semibold tracking-wider text-fg-3" aria-hidden>
              {group.label}
            </p>
          ) : null}
          {group.metas.map((meta) => {
            const Icon = characterShaperSlotIcon(meta.icon, meta.id);
            const active = meta.id === activeSlot;
            const changed = characterSlotDiffersFromBaseline(binding.recipe, binding.baselineRecipe, meta.id);
            const hotkey = characterSlotHotkeyLabel(slotIds.indexOf(meta.id));
            return (
              <button
                key={meta.id}
                type="button"
                data-character-slot={meta.id}
                aria-current={active ? "true" : undefined}
                aria-keyshortcuts={hotkey ?? undefined}
                tabIndex={active ? 0 : -1}
                title={`${meta.label} · ${meta.hint}${hotkey ? ` (${hotkey})` : ""}`}
                onClick={() => onSelectSlot(meta.id)}
                className={cn(
                  "relative flex shrink-0 items-center justify-center rounded-xl border text-[0.62rem] font-semibold leading-none",
                  "transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
                  STUDIO_FOCUS_RING,
                  vertical ? "min-h-12 w-full flex-col gap-1 px-1 py-1.5" : "min-h-11 min-w-11 flex-col gap-1 px-2.5 py-1.5",
                  active
                    ? "border-accent/55 bg-accent-soft text-accent"
                    : "border-transparent text-fg-2 hover:border-line/70 hover:bg-raised hover:text-fg",
                )}
              >
                <span className="relative inline-flex">
                  <Icon size={18} aria-hidden className={active ? "" : "opacity-85"} />
                  {changed ? (
                    <span
                      aria-hidden
                      className="absolute -right-1.5 -top-1 size-2 rounded-full bg-accent ring-2 ring-panel"
                    />
                  ) : null}
                </span>
                <span className="max-w-full truncate">{meta.label}</span>
                {changed ? <span className="sr-only">변경됨</span> : null}
                {vertical && hotkey ? (
                  <kbd
                    aria-hidden
                    className="absolute right-1 top-1 font-sans text-[0.52rem] font-semibold tabular-nums text-fg-3/80"
                  >
                    {hotkey}
                  </kbd>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
