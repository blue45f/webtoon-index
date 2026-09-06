/**
 * Character Shaper — mobile bottom sheet (shelf + inspector) with three snap states.
 *
 * The grabber reuses the studio's compositor-only sheet gesture (`useStudioBottomSheetGesture`):
 * drag up/down to step between collapsed / half / full, tap to cycle, ArrowUp / ArrowDown on the
 * keyboard. The sheet lives in normal flow under the viewport, so it never hides the model
 * completely; the dialog decides whether the background needs to be inert.
 */
import { useRef } from "react";

import { useStudioBottomSheetGesture } from "../useStudioBottomSheetGesture";

import {
  characterSheetStateIndex,
  characterSheetStateLabel,
  collapseCharacterSheet,
  cycleCharacterSheet,
  expandCharacterSheet,
} from "./character-shaper-ui-model";

import type { CharacterShaperMobileSheetProps } from "./character-shaper-ui-contract";

import { cn } from "@/shared/lib/utils";

const SHEET_HEIGHT: Readonly<Record<CharacterShaperMobileSheetProps["state"], string>> = {
  collapsed: "4.75rem",
  half: "min(40dvh, 22rem)",
  full: "min(62dvh, 34rem)",
};

export function CharacterShaperMobileSheet({ state, onStateChange, title, children }: CharacterShaperMobileSheetProps) {
  const sheetRef = useRef<HTMLElement | null>(null);
  const stateLabel = characterSheetStateLabel(state);
  const { handleProps } = useStudioBottomSheetGesture({
    activeKey: "character-shaper",
    ariaLabel: `${title} 시트 높이 — 현재 ${stateLabel}. 위아래로 밀거나 눌러 크기 전환`,
    onActivate: () => onStateChange(cycleCharacterSheet(state)),
    onCollapse: () => onStateChange(collapseCharacterSheet(state)),
    onDismiss: () => onStateChange("collapsed"),
    onExpand: () => onStateChange(expandCharacterSheet(state)),
    onKeyboardCollapse: () => onStateChange(collapseCharacterSheet(state)),
    sheetRef,
  });
  const collapsed = state === "collapsed";

  return (
    <section
      ref={sheetRef}
      aria-label={title}
      data-character-shaper-sheet={state}
      className={cn(
        "relative flex min-h-0 w-full shrink flex-col rounded-t-2xl border-t border-line bg-panel",
        "shadow-[0_-12px_32px_oklch(0.05_0.01_70/0.35)] transition-[height] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
      )}
      style={{ height: SHEET_HEIGHT[state] }}
    >
      <button
        {...handleProps}
        role="slider"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={2}
        aria-valuenow={characterSheetStateIndex(state)}
        aria-valuetext={`시트 높이 ${stateLabel}`}
        title={`${title} 크기 전환 (현재 ${stateLabel})`}
        className={cn(
          "group relative flex min-h-11 w-full shrink-0 cursor-grab select-none items-start justify-center rounded-t-2xl pt-2 active:cursor-grabbing",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
        )}
      >
        <span
          aria-hidden
          className="h-1 w-10 rounded-full bg-line-strong transition-[width,background-color] duration-150 group-hover:w-12 group-hover:bg-fg-3 group-focus-visible:w-12 group-focus-visible:bg-accent motion-reduce:transition-none"
        />
      </button>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1.5">
        <p className="truncate text-[0.8rem] font-bold text-fg">{title}</p>
        <button
          type="button"
          onClick={() => onStateChange(collapsed ? "half" : "collapsed")}
          className={cn(
            "inline-flex min-h-11 items-center rounded-lg px-2 text-[0.68rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          )}
        >
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>
      <div
        hidden={collapsed}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {children}
      </div>
    </section>
  );
}
