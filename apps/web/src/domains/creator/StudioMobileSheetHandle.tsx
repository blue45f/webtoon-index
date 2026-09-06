import {
  collapseStudioMobileSheetSnap,
  expandStudioMobileSheetSnap,
  nextStudioMobileSheetSnap,
  studioMobileSheetSnapLabel,
  studioMobileSheetSnapValue,
  type StudioMobileSheetSnap,
} from "./studio-mobile-sheet-snap";
import { useStudioBottomSheetGesture } from "./useStudioBottomSheetGesture";

import type { RefObject } from "react";

import { cn } from "@/shared/lib/utils";

export type StudioMobileSheetKind = "pages" | "props" | "draw" | "brushes";

interface StudioMobileSheetHandleProps {
  active: boolean;
  className?: string;
  kind: StudioMobileSheetKind;
  label: string;
  onDismiss: () => void;
  onSnapChange?: (snap: StudioMobileSheetSnap) => void;
  sheetRef: RefObject<HTMLElement | null>;
  snap?: StudioMobileSheetSnap;
}

/**
 * Shared 44px grabber for Studio's mobile sheets. Snap-enabled sheets expand upward and collapse
 * one step downward; only a compact-down gesture dismisses. Legacy callers without a snap contract
 * retain tap/swipe-to-close behavior. Content scrollports keep their native momentum scrolling.
 */
export function StudioMobileSheetHandle({
  active,
  className,
  kind,
  label,
  onDismiss,
  onSnapChange,
  sheetRef,
  snap,
}: StudioMobileSheetHandleProps) {
  const snapLabel = snap ? studioMobileSheetSnapLabel(snap) : null;
  const snapEnabled = snap !== undefined && onSnapChange !== undefined;
  const { handleProps } = useStudioBottomSheetGesture({
    activeKey: active ? kind : null,
    ariaLabel: snapEnabled
      ? `${label} 크기 조절 — 현재 ${snapLabel}. 위아래로 밀거나 눌러 크기 전환`
      : `${label} 닫기 — 아래로 밀거나 눌러 닫기`,
    onActivate: snapEnabled
      ? () => onSnapChange(nextStudioMobileSheetSnap(snap))
      : undefined,
    onCollapse: snapEnabled
      ? () => {
          const nextSnap = collapseStudioMobileSheetSnap(snap);
          if (nextSnap) onSnapChange(nextSnap);
          else onDismiss();
        }
      : undefined,
    onDismiss,
    onExpand: snapEnabled
      ? () => onSnapChange(expandStudioMobileSheetSnap(snap))
      : undefined,
    // ARIA slider keyboard semantics clamp ArrowDown at the minimum. Pointer collapse remains an
    // intentional compact-down dismissal, and the sheet also retains its explicit X button.
    onKeyboardCollapse: snapEnabled
      ? () => {
          const nextSnap = collapseStudioMobileSheetSnap(snap);
          if (nextSnap) onSnapChange(nextSnap);
        }
      : undefined,
    sheetRef,
  });

  return (
    <button
      {...handleProps}
      aria-orientation={snapEnabled ? "vertical" : undefined}
      aria-valuemax={snapEnabled ? 2 : undefined}
      aria-valuemin={snapEnabled ? 0 : undefined}
      aria-valuenow={snapEnabled ? studioMobileSheetSnapValue(snap) : undefined}
      aria-valuetext={snapLabel ? `시트 높이 ${snapLabel}` : undefined}
      data-studio-sheet-kind={kind}
      data-studio-sheet-snap={snap}
      role={snapEnabled ? "slider" : undefined}
      tabIndex={active ? undefined : -1}
      title={snapEnabled ? `${label} 크기 전환 (현재 ${snapLabel})` : `${label} 닫기`}
      className={cn(
        "group relative flex min-h-11 w-full shrink-0 cursor-grab select-none items-start justify-center rounded-xl pt-2 active:cursor-grabbing",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
        "lg:hidden",
        className,
      )}
    >
      <span
        aria-hidden
        className="h-1 w-10 rounded-full bg-line-strong shadow-[0_1px_0_oklch(0.97_0.01_85/0.05)] transition-[width,background-color] duration-150 group-hover:w-12 group-hover:bg-fg-3 group-focus-visible:w-12 group-focus-visible:bg-accent motion-reduce:transition-none"
      />
    </button>
  );
}
