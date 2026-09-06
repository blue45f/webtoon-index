import { LoaderCircle } from "lucide-react";
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";
import { STUDIO_Z_CLASS } from "../studio-z-index";
import { useStudioModalSheet } from "../useStudioModalSheet";

import type {
  StudioVrmProjectArchiveAttestationPlan,
  StudioVrmProjectArchiveUseContextInput,
} from "./studio-vrm-license-product-gate";
import type { StudioVrmProjectArchiveAttestationDialogProps } from "./StudioVrmProjectArchiveAttestationDialog";

type ReadyArchiveAttestationPlan = Extract<
  StudioVrmProjectArchiveAttestationPlan,
  { readonly ok: true }
>;

type ArchiveAttestationResult = StudioVrmProjectArchiveUseContextInput | null;
type ArchiveAttestationPresenter = (
  plan: ReadyArchiveAttestationPlan,
) => Promise<ArchiveAttestationResult>;

interface PresenterRegistration {
  readonly owner: symbol;
  readonly present: ArchiveAttestationPresenter;
  readonly revoke: () => void;
}

interface PendingAttestation {
  readonly key: number;
  readonly plan: ReadyArchiveAttestationPlan;
  readonly settle: (result: ArchiveAttestationResult) => void;
}

export type StudioVrmProjectArchiveAttestationDialogLoader = () => Promise<{
  readonly default: ComponentType<StudioVrmProjectArchiveAttestationDialogProps>;
}>;

export interface StudioVrmProjectArchiveAttestationHostProps {
  /** Focused tests may inject a controlled lazy chunk; production always uses the real dialog. */
  readonly loadDialog?: StudioVrmProjectArchiveAttestationDialogLoader;
}

let presenterRegistration: PresenterRegistration | null = null;

const loadDefaultDialog: StudioVrmProjectArchiveAttestationDialogLoader = () =>
  import( "./StudioVrmProjectArchiveAttestationDialog").then((module) => ({
    default: module.StudioVrmProjectArchiveAttestationDialog,
  }));

const ARCHIVE_ATTESTATION_CHUNK_TIMEOUT_MS = 10_000;

function onceOnly(
  resolve: (result: ArchiveAttestationResult) => void,
): (result: ArchiveAttestationResult) => void {
  let settled = false;
  return (result) => {
    if (settled) return;
    settled = true;
    resolve(result);
  };
}

/**
 * Stable orchestration seam. No mounted product presenter means a neutral, fail-closed cancel;
 * native confirm/prompt is never used as a fallback.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the mounted host owns this seam.
export function requestStudioVrmProjectArchiveUseContext(
  plan: ReadyArchiveAttestationPlan,
): Promise<ArchiveAttestationResult> {
  return presenterRegistration?.present(plan) ?? Promise.resolve(null);
}

interface ChunkErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onChunkError: () => void;
}

interface ChunkErrorBoundaryState {
  readonly failed: boolean;
}

class ArchiveAttestationChunkErrorBoundary extends Component<
  ChunkErrorBoundaryProps,
  ChunkErrorBoundaryState
> {
  state: ChunkErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChunkErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.onChunkError();
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function ArchiveAttestationDialogReady({
  children,
  onReady,
}: {
  readonly children: ReactNode;
  readonly onReady: () => void;
}): ReactElement {
  useLayoutEffect(() => {
    onReady();
  }, [onReady]);
  return <>{children}</>;
}

function ArchiveAttestationLoadingDialog({
  activeKey,
  onCancel,
}: {
  readonly activeKey: number;
  readonly onCancel: () => void;
}): ReactElement | null {
  const dialogRef = useRef<HTMLElement>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );

  useStudioModalSheet({
    activeKey: `vrm-project-archive-attestation-loading:${activeKey}`,
    dialogRef,
    onDismiss: onCancel,
    resolveInitialFocus: (dialog) =>
      dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`fixed inset-0 flex items-end justify-center sm:items-center sm:p-4 ${STUDIO_Z_CLASS.legal}`}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.84)] backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-vrm-archive-attestation-loading-title"
        aria-describedby="studio-vrm-archive-attestation-loading-description"
        data-studio-vrm-project-archive-attestation-loading="true"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-t-2xl border border-line-strong bg-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-fg shadow-[0_18px_60px_oklch(0.08_0.01_70/0.48)] sm:rounded-2xl sm:pb-5"
      >
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
            <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="studio-vrm-archive-attestation-loading-title" className="text-sm font-bold text-fg">
              VRM 이용 조건 불러오는 중
            </h2>
            <p
              id="studio-vrm-archive-attestation-loading-description"
              aria-live="polite"
              className="mt-1 text-xs leading-relaxed text-fg-2"
            >
              archive에 포함될 모델의 확인 화면을 준비하고 있습니다.
            </p>
          </div>
        </div>
        <button
          type="button"
          data-autofocus="true"
          onClick={onCancel}
          className={`mt-4 min-h-11 w-full rounded-xl border border-line bg-card px-4 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg ${STUDIO_EASE} ${STUDIO_FOCUS_RING}`}
        >
          취소
        </button>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Single-owner, serial Promise presenter for VRM archive attestations. Every queued request owns a
 * monotonically increasing render key, so no form state can leak into the next archive attempt.
 */
export function StudioVrmProjectArchiveAttestationHost({
  loadDialog = loadDefaultDialog,
}: StudioVrmProjectArchiveAttestationHostProps = {}): ReactElement | null {
  const [queue, setQueue] = useState<readonly PendingAttestation[]>([]);
  const queueRef = useRef<readonly PendingAttestation[]>([]);
  const nextKeyRef = useRef(0);
  const [Dialog] = useState(() => lazy(loadDialog));
  const [dialogLoaded, setDialogLoaded] = useState(false);
  const markDialogLoaded = useCallback(() => setDialogLoaded(true), []);

  const settleAll = useCallback(() => {
    const pending = queueRef.current;
    if (pending.length === 0) return;
    queueRef.current = [];
    for (const entry of pending) entry.settle(null);
    setQueue([]);
  }, []);

  useEffect(() => {
    const owner = Symbol("studio-vrm-project-archive-attestation-host");
    const present: ArchiveAttestationPresenter = (plan) =>
      new Promise<ArchiveAttestationResult>((resolve) => {
        nextKeyRef.current += 1;
        const pending: PendingAttestation = {
          key: nextKeyRef.current,
          plan,
          settle: onceOnly(resolve),
        };
        const next = [...queueRef.current, pending];
        // Synchronous mirror: a second request or an unmount in this same turn sees this promise.
        queueRef.current = next;
        setQueue(next);
      });
    // A route transition may briefly mount two hosts. The newest host takes the seam only after
    // closing every promise owned by the previous one; two legal dialogs can never stay active.
    presenterRegistration?.revoke();
    presenterRegistration = { owner, present, revoke: settleAll };

    return () => {
      if (presenterRegistration?.owner === owner) presenterRegistration = null;
      settleAll();
    };
  }, [settleAll]);

  const answer = useCallback((key: number, result: ArchiveAttestationResult) => {
    const current = queueRef.current;
    const pending = current.find((entry) => entry.key === key);
    if (!pending) return;
    const next = current.filter((entry) => entry.key !== key);
    queueRef.current = next;
    pending.settle(result);
    setQueue(next);
  }, []);

  const active = queue[0] ?? null;

  useEffect(() => {
    if (!active || dialogLoaded) return;
    const timeout = globalThis.setTimeout(() => {
      // A permanently pending dynamic import must not strand any archive command behind it.
      settleAll();
    }, ARCHIVE_ATTESTATION_CHUNK_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timeout);
  }, [active, dialogLoaded, settleAll]);

  if (!active) return null;

  return (
    <ArchiveAttestationChunkErrorBoundary
      key={active.key}
      onChunkError={settleAll}
    >
      <Suspense
        fallback={(
          <ArchiveAttestationLoadingDialog
            activeKey={active.key}
            onCancel={() => answer(active.key, null)}
          />
        )}
      >
        <ArchiveAttestationDialogReady onReady={markDialogLoaded}>
          <Dialog
            key={active.key}
            plan={active.plan}
            queuedCount={queue.length - 1}
            onSubmit={(input) => answer(active.key, input)}
            onCancel={() => answer(active.key, null)}
          />
        </ArchiveAttestationDialogReady>
      </Suspense>
    </ArchiveAttestationChunkErrorBoundary>
  );
}
