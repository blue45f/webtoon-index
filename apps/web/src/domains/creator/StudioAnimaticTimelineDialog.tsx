import { useEffect } from "react";
import { createPortal } from "react-dom";

import { StudioAnimaticTimelinePanel } from "./StudioAnimaticTimelinePanel";
import { StudioFloatingSurface } from "./StudioFloatingSurface";
import { useStudioFloatingSurfaceLayout } from "./use-studio-floating-surface-layout";

import type { StudioAnimaticPageLike } from "./studio-animatic-timeline";

import { useIsMobile } from "@/src/hooks/use-media-query";

export interface StudioAnimaticTimelineDialogProps {
  readonly open: boolean;
  readonly workScope: string;
  readonly pages: readonly StudioAnimaticPageLike[];
  readonly reducedMotion?: boolean;
  /** Deterministic responsive seam; product callers normally omit it. */
  readonly isMobile?: boolean;
  readonly onClose: () => void;
}

const DEFAULT_STUDIO_ANIMATIC_FLOATING_LAYOUT = Object.freeze({
  version: 2 as const,
  xRatio: 0.5,
  yRatio: 1,
  width: 1_100,
  height: 480,
  dock: "bottom" as const,
  positionLocked: false,
  sizeLocked: false,
});

function scopeHash(value: string): string {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function studioAnimaticFloatingSurfaceId(workScope: string): string {
  const readable = workScope
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9._~-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 72);
  return `animatic-${readable || "work"}-${scopeHash(workScope)}`;
}

export function StudioAnimaticTimelineDialog({
  open,
  workScope,
  pages,
  reducedMotion,
  isMobile: isMobileOverride,
  onClose,
}: StudioAnimaticTimelineDialogProps) {
  const responsiveMobile = useIsMobile();
  const isMobile = isMobileOverride ?? responsiveMobile;
  const surfaceId = studioAnimaticFloatingSurfaceId(workScope);
  const {
    layout,
    authority,
    failure,
    setLayout,
  } = useStudioFloatingSurfaceLayout({
    surfaceId,
    defaultLayout: DEFAULT_STUDIO_ANIMATIC_FLOATING_LAYOUT,
    enabled: open && !isMobile,
  });

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    if (isMobile) document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      if (isMobile) document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobile, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  if (!isMobile) {
    return createPortal(
      <StudioFloatingSurface
        surfaceId={surfaceId}
        label="웹툰 애니매틱"
        layout={layout}
        defaultLayout={DEFAULT_STUDIO_ANIMATIC_FLOATING_LAYOUT}
        minWidth={640}
        minHeight={360}
        maxWidth={1_600}
        maxHeight={1_000}
        insetTop={76}
        insetRight={12}
        insetBottom={12}
        insetLeft={12}
        allowedDockEdges={["left", "right", "bottom"]}
        onLayoutChange={setLayout}
        onClose={onClose}
        rootDataAttributes={{
          "data-studio-animatic-dialog": "true",
          "data-studio-animatic-presentation": "desktop",
          "data-dock-edge": layout.dock,
          "data-studio-shortcut-boundary": "true",
          "data-layout-authority": authority,
          "data-layout-failure": failure ?? undefined,
        }}
        contentClassName={[
          "min-h-0 overflow-hidden",
          "[&>section]:h-full [&>section]:rounded-none",
          "[&>section]:border-0 [&>section]:shadow-none",
          "[&>section>header]:hidden",
        ].join(" ")}
      >
        <StudioAnimaticTimelinePanel
          key={workScope}
          workScope={workScope}
          pages={pages}
          reducedMotion={reducedMotion}
          className="h-full max-h-none"
        />
      </StudioFloatingSurface>,
      document.body,
    );
  }

  return createPortal(
    <div
      data-studio-animatic-dialog="true"
      data-studio-animatic-presentation="mobile"
      className="fixed inset-0 z-[120] flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-label="애니매틱 배경 닫기"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-canvas/80 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="웹툰 애니매틱"
        className="relative z-10 flex max-h-[100dvh] w-full max-w-6xl"
      >
        <StudioAnimaticTimelinePanel
          key={workScope}
          workScope={workScope}
          pages={pages}
          reducedMotion={reducedMotion}
          onClose={onClose}
          className="max-h-[100dvh] rounded-b-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-b-2xl"
        />
      </div>
    </div>,
    document.body,
  );
}
