import { ArrowLeft } from "lucide-react";
import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { activateStudioModalSheet } from "../useStudioModalSheet";

export interface StudioHybridDccRouteGateProps {
  readonly detail: string;
  readonly label: string;
  readonly onClose: () => void;
  readonly returnFocus?: HTMLElement | null;
}

/**
 * Eager route shell used before permission, hydration, or the heavy DCC chunk is ready.
 * It owns the same modal/focus boundary as the final workspace, so a slow chunk cannot leave
 * the underlying canvas keyboard-active while the URL already belongs to DCC.
 */
export function StudioHybridDccRouteGate({
  detail,
  label,
  onClose,
  returnFocus = null,
}: StudioHybridDccRouteGateProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeFromEffect = useEffectEvent(onClose);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || typeof document === "undefined") return;
    const ownerDocument = dialog.ownerDocument;
    const previousBodyOverflow = ownerDocument.body.style.overflow;
    const previousRootOverflow = ownerDocument.documentElement.style.overflow;
    ownerDocument.body.style.overflow = "hidden";
    ownerDocument.documentElement.style.overflow = "hidden";
    const deactivate = activateStudioModalSheet({
      dialog,
      document: ownerDocument,
      fallbackReturnFocus: ownerDocument.getElementById("main-content"),
      initialFocus: closeButtonRef.current,
      onDismiss: closeFromEffect,
      returnFocus,
      root: ownerDocument.body,
    });
    return () => {
      deactivate();
      ownerDocument.body.style.overflow = previousBodyOverflow;
      ownerDocument.documentElement.style.overflow = previousRootOverflow;
    };
  }, [returnFocus]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-stretch justify-stretch bg-panel"
      data-studio-hybrid-dcc-route-gate="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-hybrid-dcc-route-gate-title"
        data-studio-modal-owner="hybrid-dcc-route-gate"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden bg-panel"
      >
        <header className="flex min-h-14 items-center gap-2 border-b border-line bg-panel px-2 py-2 sm:px-3">
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label="캔버스로 돌아가기"
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span className="hidden sm:inline">캔버스</span>
          </button>
          <div className="min-w-0 flex-1">
            <h2
              id="studio-hybrid-dcc-route-gate-title"
              className="truncate text-sm font-semibold tracking-tight"
            >
              ToonSpectrum 전문 3D 제작
            </h2>
            <p className="truncate text-[11px] text-fg-3">
              편집 가능한 원본 메시 · 정밀 CAD·솔리드 · 웹툰 컷·선화 전달
            </p>
          </div>
        </header>
        <div
          className="grid min-h-0 flex-1 place-items-center bg-canvas/35 p-6 text-center"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-sm rounded-2xl border border-line bg-panel px-6 py-5 shadow-xl">
            <p className="text-sm font-semibold text-fg">{label}</p>
            <p className="mt-1 text-xs leading-relaxed text-fg-3">{detail}</p>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
