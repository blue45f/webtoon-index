
import { AlertTriangle, ArrowLeft, RotateCcw } from "lucide-react";
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";

import { announceStudioRenderFailure } from "../../shared/lib/render-failure-event";

import { activateStudioModalSheet } from "./useStudioModalSheet";

export interface StudioSurfaceErrorBoundaryProps {
  readonly children: ReactNode;
  readonly detail?: string;
  readonly exitLabel?: string;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  readonly onExit: () => void;
  readonly resetKey: unknown;
  readonly retryLabel?: string;
  readonly returnFocus?: HTMLElement | null;
  readonly surfaceLabel: string;
}

interface StudioSurfaceErrorBoundaryState {
  readonly error: Error | null;
}

interface StudioSurfaceRecoveryFallbackProps {
  readonly detail: string;
  readonly exitLabel: string;
  readonly onExit: () => void;
  readonly onRetry: () => void;
  readonly retryLabel: string | null;
  readonly returnFocus: HTMLElement | null;
  readonly surfaceLabel: string;
}

function StudioSurfaceRecoveryFallback({
  detail,
  exitLabel,
  onExit,
  onRetry,
  retryLabel,
  returnFocus,
  surfaceLabel,
}: StudioSurfaceRecoveryFallbackProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const exitButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const detailId = useId();
  const exitFromEffect = useEffectEvent(onExit);

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
      initialFocus: exitButtonRef.current,
      onDismiss: exitFromEffect,
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
      className="fixed inset-0 z-[130] flex items-stretch justify-stretch bg-panel"
      data-studio-surface-recovery="true"
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        data-studio-modal-owner="surface-recovery"
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative z-10 flex h-[100dvh] w-full flex-col overflow-hidden bg-panel"
      >
        <header className="flex min-h-14 items-center gap-2 border-b border-line bg-panel px-2 py-2 sm:px-3">
          <button
            ref={exitButtonRef}
            type="button"
            onClick={onExit}
            className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            aria-label={exitLabel}
          >
            <ArrowLeft size={17} aria-hidden="true" />
            <span className="hidden sm:inline">{exitLabel}</span>
          </button>
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">
            {surfaceLabel}
          </p>
        </header>

        <div className="grid min-h-0 flex-1 place-items-center bg-canvas/35 p-5 text-center sm:p-8">
          <section className="w-full max-w-md rounded-lg border border-bad/40 bg-panel px-5 py-6 shadow-xl sm:px-7">
            <span className="mx-auto grid size-11 place-items-center rounded-lg bg-[oklch(0.66_0.2_25/0.14)] text-bad">
              <AlertTriangle size={22} aria-hidden="true" />
            </span>
            <h2 id={titleId} className="mt-4 text-base font-bold text-fg">
              {surfaceLabel}를 계속 열 수 없습니다.
            </h2>
            <p id={detailId} className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-fg-2">
              {detail}
            </p>
            <div className="mt-5 flex flex-col-reverse justify-center gap-2 sm:flex-row">
              {retryLabel ? (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-line-strong px-4 text-sm font-semibold text-fg transition-colors hover:border-accent/70 hover:bg-accent-soft hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  <RotateCcw size={16} aria-hidden="true" />
                  {retryLabel}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onExit}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-sm font-bold text-on-accent transition-colors hover:bg-accent-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                <ArrowLeft size={16} aria-hidden="true" />
                {exitLabel}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Isolates an optional Studio surface from the long-lived editor owner.
 *
 * A lazy/render failure replaces only the failing surface. The canvas, document state, collaboration
 * provider, and undo history remain mounted behind the modal recovery screen. Changing `resetKey`
 * retries with a fresh error-boundary state; explicit retry is useful for transient renderer faults.
 */
export class StudioSurfaceErrorBoundary extends Component<
  StudioSurfaceErrorBoundaryProps,
  StudioSurfaceErrorBoundaryState
> {
  state: StudioSurfaceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): StudioSurfaceErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previous: StudioSurfaceErrorBoundaryProps): void {
    if (
      this.state.error
      && !Object.is(previous.resetKey, this.props.resetKey)
    ) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      this.props.onError?.(error, info);
    } catch {
      // Diagnostics are observational. A failing sink must not escape this surface boundary.
    }
    announceStudioRenderFailure({
      surface: this.props.surfaceLabel,
      error,
      componentStack: info.componentStack ?? null,
    });
    if (import.meta.env.DEV) {
      console.error(`Studio surface failed (${this.props.surfaceLabel}):`, error, info.componentStack);
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <StudioSurfaceRecoveryFallback
        detail={this.props.detail
          ?? "도구 화면만 안전하게 닫았습니다. 캔버스와 편집 기록은 그대로 보존되어 있습니다."}
        exitLabel={this.props.exitLabel ?? "2D 캔버스로 돌아가기"}
        onExit={this.props.onExit}
        onRetry={this.retry}
        retryLabel={this.props.retryLabel ?? null}
        returnFocus={this.props.returnFocus ?? null}
        surfaceLabel={this.props.surfaceLabel}
      />
    );
  }
}
