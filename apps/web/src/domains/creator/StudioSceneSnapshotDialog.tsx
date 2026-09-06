import { X } from "lucide-react";
import { useEffect, useEffectEvent, useRef } from "react";
import { createPortal } from "react-dom";

import {
  StudioSceneSnapshotPanel,
  type StudioSceneSnapshotPanelProps,
} from "./StudioSceneSnapshotPanel";

export interface StudioSceneSnapshotDialogProps
  extends Omit<StudioSceneSnapshotPanelProps, "repository"> {
  repository?: StudioSceneSnapshotPanelProps["repository"];
  onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The snapshot library is an isolated local-storage workflow, so it opens as one modal instead of
 * competing with the inspector and canvas tool sheets. The inner panel remains reusable in future
 * desktop sidecars while this wrapper owns modal focus, scroll locking and dismissal.
 */
export function StudioSceneSnapshotDialog({
  sourcePage,
  theme,
  sourceWorkId,
  repository,
  onApply,
  onClose,
}: StudioSceneSnapshotDialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const closeFromEffect = useEffectEvent(onClose);

  useEffect(() => {
    if (typeof document === "undefined") return;
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const overlay = overlayRef.current;
    const inertStates: Array<readonly [HTMLElement, boolean]> = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement) || child === overlay) continue;
      inertStates.push([child, child.inert]);
      child.inert = true;
    }

    const focusFrame = requestAnimationFrame(() => {
      closeButtonRef.current?.focus({ preventScroll: true });
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeFromEffect();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []),
      ].filter((element) => !element.hidden);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const [element, wasInert] of inertStates) element.inert = wasInert;
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[110] flex items-end justify-center bg-canvas/80 sm:items-center sm:p-5"
      data-studio-scene-snapshot-dialog="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-scene-snapshot-title"
        data-studio-modal-owner="scene-snapshot"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative h-[min(48rem,calc(100dvh-env(safe-area-inset-top)))] min-h-0 w-full max-w-2xl overflow-hidden rounded-t-2xl border border-line bg-panel shadow-2xl sm:h-[min(48rem,calc(100dvh-2.5rem))] sm:rounded-2xl [&>section>header]:pr-16"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="장면 스냅샷 닫기"
          className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-xl border border-line bg-card text-fg-3 shadow-sm transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X size={17} aria-hidden="true" />
        </button>
        <StudioSceneSnapshotPanel
          sourcePage={sourcePage}
          theme={theme}
          sourceWorkId={sourceWorkId}
          repository={repository}
          onApply={onApply}
        />
      </div>
    </div>,
    document.body
  );
}
