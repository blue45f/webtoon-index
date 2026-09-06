import { type ComponentProps, lazy, Suspense } from "react";

import { studioMobileSheetSizeStyle } from "./studio-mobile-sheet-snap";

import type { StudioMobileSheetSnap } from "./studio-mobile-sheet-snap";

import { cn } from "@/shared/lib/utils";

const LazyStudioMobileSheetHandle = lazy(() =>
  import("./StudioMobileSheetHandle").then(({ StudioMobileSheetHandle }) => ({
    default: StudioMobileSheetHandle,
  }))
);

export function StudioMobileSheetHandleBoundary(
  props: ComponentProps<typeof import("./StudioMobileSheetHandle").StudioMobileSheetHandle>
) {
  return (
    <Suspense fallback={<div aria-hidden className="min-h-11 lg:hidden" />}>
      <LazyStudioMobileSheetHandle {...props} />
    </Suspense>
  );
}

export function StudioInspectorAsideFallback({
  isMobile,
  keyboardInset,
  propsSheetRef,
  snap,
  visible,
  width,
}: {
  isMobile: boolean;
  keyboardInset: number;
  propsSheetRef: import("react").RefObject<HTMLElement | null>;
  snap: StudioMobileSheetSnap;
  visible: boolean;
  width: number;
}) {
  const safeKeyboardInset = Number.isFinite(keyboardInset)
    ? Math.max(0, Math.round(keyboardInset))
    : 0;
  return (
    <aside
      ref={propsSheetRef}
      role={isMobile ? "dialog" : undefined}
      aria-modal={isMobile ? true : undefined}
      aria-busy="true"
      aria-label="작업 패널 불러오는 중"
      data-studio-sheet-id="props"
      data-studio-mobile-sheet={isMobile ? "true" : undefined}
      data-studio-sheet-snap={isMobile ? snap : undefined}
      data-popup-kind={isMobile ? "sheet" : undefined}
      tabIndex={isMobile ? -1 : undefined}
      className={cn(
        "flex min-h-0 flex-col gap-3 overflow-hidden border-line bg-panel/50 p-3",
        "fixed inset-x-0 bottom-0 z-[60] rounded-t-3xl border shadow-2xl",
        "lg:static lg:z-auto lg:flex-none lg:self-stretch lg:rounded-none lg:border-y-0 lg:border-r-0 lg:shadow-none",
        !visible && "lg:hidden",
      )}
      style={isMobile
        ? {
            bottom: safeKeyboardInset,
            ...studioMobileSheetSizeStyle(snap, safeKeyboardInset),
          }
        : { minWidth: 240, width }}
    >
      <div className="h-5 w-24 animate-pulse rounded bg-raised motion-reduce:animate-none" />
      <div className="h-10 animate-pulse rounded-xl bg-raised/80 motion-reduce:animate-none" />
      <div className="h-28 animate-pulse rounded-xl bg-raised/60 motion-reduce:animate-none" />
      <div className="h-20 animate-pulse rounded-xl bg-raised/40 motion-reduce:animate-none" />
    </aside>
  );
}
