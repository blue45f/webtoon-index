import {
  AlertTriangle,
  BookmarkPlus,
  Cloud,
  HardDrive,
  History,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { STUDIO_CHECKPOINT_LIMIT, type StudioCheckpoint } from "./studio-checkpoints";
import {
  studioRevisionCurrentLocation,
  type StudioRevisionCompareLocation,
} from "./studio-revision-compare-location";
import { StudioRevisionCompareView } from "./StudioRevisionCompareView";

import type { StudioProjectFile } from "./studio-project-file";
import type { StudioRevisionChange } from "./studio-revision-diff";
import type { StudioServerRevisionComparison } from "./studio-server-revision-comparison";

import { getWorkRevisionComparison } from "@/src/infrastructure/creator-client";

export interface StudioServerRevisionSummary {
  revision: number;
  restoredFromRevision: number | null;
  createdAt: string;
}

export interface StudioCheckpointPanelProps {
  open: boolean;
  onClose: () => void;
  checkpoints: readonly StudioCheckpoint[];
  error: string | null;
  onCreate: (name: string) => void;
  onRestore: (checkpoint: StudioCheckpoint) => void;
  onDelete: (checkpoint: StudioCheckpoint) => void;
  serverRevisions?: readonly StudioServerRevisionSummary[];
  serverCurrentRevision?: number;
  serverLoading?: boolean;
  serverError?: string | null;
  onReloadServer?: () => void;
  serverWorkId?: string;
  getCurrentProject?: () => StudioProjectFile;
  getCurrentProjectGeneration?: () => number;
  onRestoreServer?: (
    revision: StudioServerRevisionSummary,
    comparedBaseRevision: number
  ) => boolean | Promise<boolean>;
  onNavigateServerChange?: (location: StudioRevisionCompareLocation) => void;
}

function checkpointDate(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(time)
    : value;
}

function projectPageLabels(project: StudioProjectFile): Readonly<Record<string, string>> {
  return Object.fromEntries(project.pagesList.map((page, index) => {
    const candidate = "name" in page && typeof page.name === "string" ? page.name.trim() : "";
    return [page.id, candidate || `${index + 1}페이지`];
  }));
}

function canNavigateStudioRevisionChange(
  project: StudioProjectFile,
  change: StudioRevisionChange
): boolean {
  const location = studioRevisionCurrentLocation(change);
  if (!location) return false;
  const page = project.pagesList.find((candidate) => candidate.id === location.pageId);
  if (!page) return false;
  return !location.elementId || page.elements.some(
    (element) => Boolean(element && typeof element === "object" && "id" in element && element.id === location.elementId)
  );
}

export function StudioCheckpointPanel({
  open,
  onClose,
  checkpoints,
  error,
  onCreate,
  onRestore,
  onDelete,
  serverRevisions = [],
  serverCurrentRevision,
  serverLoading = false,
  serverError = null,
  onReloadServer,
  serverWorkId,
  getCurrentProject,
  getCurrentProjectGeneration,
  onRestoreServer,
  onNavigateServerChange,
}: StudioCheckpointPanelProps) {
  const [name, setName] = useState("");
  const serverAvailable = Boolean(
    onReloadServer &&
    onRestoreServer &&
    serverWorkId &&
    getCurrentProject &&
    getCurrentProjectGeneration &&
    serverCurrentRevision
  );
  const [activeTab, setActiveTab] = useState<"local" | "server">("local");
  const visibleTab = serverAvailable ? activeTab : "local";
  const [selectedServerRevision, setSelectedServerRevision] = useState<StudioServerRevisionSummary | null>(null);
  const [serverComparison, setServerComparison] = useState<StudioServerRevisionComparison | null>(null);
  const [comparisonProject, setComparisonProject] = useState<StudioProjectFile | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [confirmingServerRestore, setConfirmingServerRestore] = useState(false);
  const [serverRestoreBusy, setServerRestoreBusy] = useState(false);
  const serverRestoreBusyRef = useRef(serverRestoreBusy);
  serverRestoreBusyRef.current = serverRestoreBusy;
  const [showServerRestoreError, setShowServerRestoreError] = useState(false);
  const comparisonRequestRef = useRef(0);
  const comparisonProjectGenerationRef = useRef<number | null>(null);
  const comparisonAbortRef = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const localTabRef = useRef<HTMLButtonElement | null>(null);
  const serverTabRef = useRef<HTMLButtonElement | null>(null);
  const tabListId = useId();
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const currentComparisonScopeRef = useRef({
    open,
    workId: serverWorkId,
    baseRevision: serverCurrentRevision,
  });
  currentComparisonScopeRef.current = {
    open,
    workId: serverWorkId,
    baseRevision: serverCurrentRevision,
  };
  const interactionLocked = serverRestoreBusy;

  function resetServerComparison() {
    comparisonRequestRef.current += 1;
    comparisonAbortRef.current?.abort();
    comparisonAbortRef.current = null;
    setSelectedServerRevision(null);
    setServerComparison(null);
    setComparisonProject(null);
    comparisonProjectGenerationRef.current = null;
    setComparisonLoading(false);
    setComparisonError(null);
    setConfirmingServerRestore(false);
    setServerRestoreBusy(false);
    setShowServerRestoreError(false);
  }

  function activateTab(tab: "local" | "server") {
    if (interactionLocked) return;
    if (tab === "server" && !serverAvailable) return;
    if (tab === visibleTab) return;
    if (tab !== "server") resetServerComparison();
    setActiveTab(tab);
    if (tab === "server") onReloadServer?.();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!serverAvailable) return;
    let target: "local" | "server" | null = null;
    if (event.key === "Home") target = "local";
    if (event.key === "End") target = "server";
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      target = visibleTab === "local" ? "server" : "local";
    }
    if (!target) return;
    event.preventDefault();
    activateTab(target);
    (target === "local" ? localTabRef : serverTabRef).current?.focus();
  }

  useEffect(() => {
    if (serverRestoreBusyRef.current) return;
    comparisonRequestRef.current += 1;
    comparisonAbortRef.current?.abort();
    comparisonAbortRef.current = null;
    setSelectedServerRevision(null);
    setServerComparison(null);
    setComparisonProject(null);
    comparisonProjectGenerationRef.current = null;
    setComparisonLoading(false);
    setComparisonError(null);
    setConfirmingServerRestore(false);
    setShowServerRestoreError(false);
  }, [open, serverCurrentRevision, serverWorkId]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    openerRef.current = activeElement instanceof HTMLElement ? activeElement : null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    const overlay = dialogRef.current?.parentElement;
    const inertStates: Array<readonly [HTMLElement, boolean]> = [];
    for (const child of document.body.children) {
      if (!(child instanceof HTMLElement) || child === overlay) continue;
      inertStates.push([child, child.inert]);
      child.inert = true;
    }
    const focusFrame = requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      for (const [element, wasInert] of inertStates) element.inert = wasInert;
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (interactionLocked) return;
        if (confirmingServerRestore) setConfirmingServerRestore(false);
        else if (selectedServerRevision) resetServerComparison();
        else onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ) ?? [])].filter((element) => !element.hidden && element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [confirmingServerRestore, interactionLocked, onClose, open, selectedServerRevision]);

  useEffect(() => () => comparisonAbortRef.current?.abort(), []);

  async function reviewServerRevision(revision: StudioServerRevisionSummary) {
    if (
      !serverWorkId ||
      !serverCurrentRevision ||
      !getCurrentProject ||
      !getCurrentProjectGeneration ||
      revision.revision === serverCurrentRevision ||
      serverRestoreBusy
    ) return;

    const requestId = comparisonRequestRef.current + 1;
    comparisonRequestRef.current = requestId;
    comparisonAbortRef.current?.abort();
    const controller = new AbortController();
    comparisonAbortRef.current = controller;
    const workId = serverWorkId;
    const baseRevision = serverCurrentRevision;
    const targetRevision = revision.revision;
    const requestScopeIsCurrent = () => {
      const current = currentComparisonScopeRef.current;
      return requestId === comparisonRequestRef.current &&
        current.open &&
        current.workId === workId &&
        current.baseRevision === baseRevision;
    };
    const requestIsCurrent = () =>
      !controller.signal.aborted && requestScopeIsCurrent();

    setSelectedServerRevision(revision);
    setServerComparison(null);
    setComparisonProject(null);
    setComparisonLoading(true);
    setComparisonError(null);
    setConfirmingServerRestore(false);
    setShowServerRestoreError(false);

    try {
      const projectGeneration = getCurrentProjectGeneration();
      const localProject = getCurrentProject();
      if (getCurrentProjectGeneration() !== projectGeneration) {
        throw new Error("편집본을 캡처하는 동안 내용이 변경됐어요. 다시 비교해 주세요.");
      }
      const [targetDetail, baseDetail, { runStudioRevisionComparison }] = await Promise.all([
        getWorkRevisionComparison(workId, targetRevision, controller.signal),
        getWorkRevisionComparison(workId, baseRevision, controller.signal),
        import("./studio-revision-compare-worker-client"),
      ]);
      if (!requestIsCurrent()) return;
      if (targetDetail.revision !== targetRevision || baseDetail.revision !== baseRevision) {
        throw new Error("요청한 revision과 서버가 반환한 revision이 달라 비교를 중단했습니다.");
      }
      const comparison = await runStudioRevisionComparison(
        {
          targetRevision,
          baseRevision,
          targetSnapshot: targetDetail.snapshot,
          baseSnapshot: baseDetail.snapshot,
          localProject,
        },
        { executionBackend: "worker", signal: controller.signal }
      );
      if (!requestIsCurrent()) return;
      if (getCurrentProjectGeneration() !== projectGeneration) {
        throw new Error("비교 중 편집본이 변경됐어요. 최신 상태로 다시 비교해 주세요.");
      }
      comparisonProjectGenerationRef.current = projectGeneration;
      setComparisonProject(localProject);
      setServerComparison(comparison);
    } catch (cause) {
      const shouldReport = requestScopeIsCurrent();
      const requestWasAborted = controller.signal.aborted;
      controller.abort();
      if (!shouldReport) return;
      if (cause instanceof Error && cause.name === "AbortError" && requestWasAborted) return;
      setComparisonError(cause instanceof Error ? cause.message : "서버 버전을 비교하지 못했어요.");
    } finally {
      if (comparisonAbortRef.current === controller) comparisonAbortRef.current = null;
      // 실패 시 sibling fetch/Worker를 취소하기 위해 catch에서 abort하더라도, 여전히 같은
      // 요청/작품/기준 revision이면 로딩은 반드시 끝낸다. superseded 요청만 새 스피너를 건드리지 않는다.
      if (requestScopeIsCurrent()) setComparisonLoading(false);
    }
  }

  async function confirmServerRevisionRestore() {
    if (
      !selectedServerRevision ||
      !serverComparison ||
      !comparisonProject ||
      !serverCurrentRevision ||
      !getCurrentProject ||
      !getCurrentProjectGeneration ||
      !onRestoreServer ||
      serverRestoreBusy
    ) return;

    setShowServerRestoreError(false);
    setComparisonError(null);
    try {
      if (getCurrentProjectGeneration() !== comparisonProjectGenerationRef.current) {
        setConfirmingServerRestore(false);
        setComparisonError("변경 검토 후 편집본이 달라졌어요. 최신 상태로 다시 비교한 뒤 복원해 주세요.");
        return;
      }
      if (serverCurrentRevision !== serverComparison.baseRevision) {
        setConfirmingServerRestore(false);
        setComparisonError("서버 revision이 비교 후 변경됐어요. 목록을 새로고침하고 다시 검토해 주세요.");
        return;
      }
      setServerRestoreBusy(true);
      const restored = await onRestoreServer(selectedServerRevision, serverComparison.baseRevision);
      if (restored) {
        resetServerComparison();
      } else {
        setShowServerRestoreError(true);
        setComparisonError("서버 버전을 복원하지 못했어요. 아래 안내를 확인하고 다시 비교해 주세요.");
      }
    } catch (cause) {
      setShowServerRestoreError(true);
      setComparisonError(cause instanceof Error ? cause.message : "서버 버전을 복원하지 못했어요.");
    } finally {
      setServerRestoreBusy(false);
    }
  }

  if (!open || typeof document === "undefined") return null;
  const visibleError = visibleTab === "server" ? serverError : error;
  const comparisonVisible = visibleTab === "server" && selectedServerRevision !== null;
  const pageLabels = serverComparison?.pageLabels ?? (
    comparisonProject ? projectPageLabels(comparisonProject) : {}
  );

  const modal = (
    <div
      data-studio-checkpoint-overlay=""
      role="dialog"
      aria-modal="true"
      aria-labelledby={dialogTitleId}
      aria-describedby={dialogDescriptionId}
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] text-fg backdrop-blur-sm sm:p-4"
    >
      <div ref={dialogRef} tabIndex={-1} className="mx-auto flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <History size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={dialogTitleId} className="text-base font-bold tracking-tight text-fg">버전 및 복구</h2>
            <p id={dialogDescriptionId} className="mt-0.5 text-xs leading-relaxed text-fg-3">
              브라우저에 이름 있는 지점을 남기고, 저장된 작품은 서버 자동 버전도 비교·복원할 수 있어요.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => {
              if (!interactionLocked) onClose();
            }}
            disabled={interactionLocked}
            aria-label="복구 지점 닫기"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg disabled:cursor-wait disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        <div
          id={tabListId}
          role="tablist"
          aria-label="버전 저장 위치"
          className="grid shrink-0 grid-cols-2 gap-1 border-b border-line bg-card/25 p-2"
        >
          <button
            ref={localTabRef}
            type="button"
            role="tab"
            aria-selected={visibleTab === "local"}
            aria-controls={`${tabListId}-local-panel`}
            tabIndex={visibleTab === "local" ? 0 : -1}
            disabled={interactionLocked}
            onKeyDown={handleTabKeyDown}
            onClick={() => activateTab("local")}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors ${
              visibleTab === "local" ? "bg-panel text-fg shadow-sm" : "text-fg-3 hover:bg-raised"
            }`}
          >
            <HardDrive size={15} aria-hidden /> 브라우저 지점 {checkpoints.length}
          </button>
          <button
            ref={serverTabRef}
            type="button"
            role="tab"
            aria-selected={visibleTab === "server"}
            aria-controls={`${tabListId}-server-panel`}
            aria-disabled={!serverAvailable}
            tabIndex={visibleTab === "server" ? 0 : -1}
            disabled={!serverAvailable || interactionLocked}
            onKeyDown={handleTabKeyDown}
            onClick={() => activateTab("server")}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
              visibleTab === "server" ? "bg-panel text-fg shadow-sm" : "text-fg-3 hover:bg-raised"
            }`}
          >
            <Cloud size={15} aria-hidden /> 서버 자동 버전 {serverRevisions.length}
          </button>
        </div>

        {comparisonVisible && selectedServerRevision ? (
          <div
            id={`${tabListId}-server-panel`}
            role="tabpanel"
            aria-label={`서버 revision ${selectedServerRevision.revision} 변경 검토`}
            className="flex min-h-0 flex-1 flex-col"
          >
            <StudioRevisionCompareView
              targetRevision={selectedServerRevision.revision}
              baseRevision={serverComparison?.baseRevision ?? serverCurrentRevision ?? 1}
              comparison={serverComparison}
              loading={comparisonLoading}
              error={showServerRestoreError ? (serverError ?? comparisonError) : comparisonError}
              restoring={serverRestoreBusy || serverLoading}
              confirmingRestore={confirmingServerRestore}
              pageLabels={pageLabels}
              canNavigateChange={(change) => Boolean(
                comparisonProject && canNavigateStudioRevisionChange(comparisonProject, change)
              )}
              onBack={resetServerComparison}
              onRetry={() => void reviewServerRevision(selectedServerRevision)}
              onRequestRestore={() => setConfirmingServerRestore(true)}
              onCancelRestore={() => setConfirmingServerRestore(false)}
              onConfirmRestore={() => void confirmServerRevisionRestore()}
              onNavigateChange={onNavigateServerChange ? (location) => {
                if (interactionLocked) return;
                onNavigateServerChange(location);
                onClose();
              } : undefined}
            />
          </div>
        ) : (
        <div
          id={`${tabListId}-${visibleTab}-panel`}
          role="tabpanel"
          aria-label={visibleTab === "local" ? "브라우저 복구 지점" : "서버 자동 버전"}
          className="flex min-h-0 flex-1 flex-col"
        >
        {visibleTab === "local" ? <form
          className="flex shrink-0 flex-wrap gap-2 border-b border-line bg-card/35 px-4 py-3"
          onSubmit={(event) => {
            event.preventDefault();
            const normalized = name.trim();
            if (!normalized) return;
            onCreate(normalized);
            setName("");
          }}
        >
          <label className="min-w-[12rem] flex-1 text-xs font-semibold text-fg-2">
            새 복구 지점 이름
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 80))}
              maxLength={80}
              placeholder="예: 1화 대사 수정 전"
              className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim()}
            className="mt-auto inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
          >
            <BookmarkPlus size={14} aria-hidden /> 지금 상태 저장
          </button>
        </form> : null}

        {visibleError && (
          <p className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
            {visibleError}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {visibleTab === "local" ? (checkpoints.length === 0 ? (
            <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-line bg-card/30 px-4 text-center">
              <div>
                <History size={24} className="mx-auto text-fg-3" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-fg-2">아직 저장한 복구 지점이 없어요</p>
                <p className="mt-1 text-xs text-fg-3">큰 편집이나 AI 적용 전에 하나 만들어 두면 안전합니다.</p>
              </div>
            </div>
          ) : (
            <ol className="space-y-2" aria-label="저장된 복구 지점">
              {checkpoints.map((checkpoint) => (
                <li
                  key={checkpoint.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card/55 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{checkpoint.name}</p>
                    <time dateTime={checkpoint.createdAt} className="mt-0.5 block text-[0.68rem] text-fg-3">
                      {checkpointDate(checkpoint.createdAt)}
                    </time>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRestore(checkpoint)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent-soft/25 px-3 text-xs font-semibold text-accent hover:bg-accent-soft/45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <RotateCcw size={12} aria-hidden /> 이 시점 복원
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(checkpoint)}
                    aria-label={`${checkpoint.name} 복구 지점 삭제`}
                    className="grid size-11 place-items-center rounded-lg border border-line text-fg-3 hover:border-bad/45 hover:bg-bad/10 hover:text-bad focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bad"
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          )) : (
            <div>
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card/45 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-fg">현재 서버 revision {serverCurrentRevision}</p>
                  <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                    저장마다 자동 생성하며 최신 20개를 보존합니다. 다른 창이 먼저 저장하면 덮어쓰지 않고 충돌을 알려요.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onReloadServer}
                  disabled={serverLoading}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-xs font-semibold text-fg-2 hover:bg-raised disabled:cursor-wait disabled:opacity-55"
                >
                  <RefreshCw size={13} className={serverLoading ? "animate-spin" : undefined} aria-hidden /> 새로고침
                </button>
              </div>
              {serverLoading && serverRevisions.length === 0 ? (
                <div className="grid min-h-48 place-items-center text-center text-xs text-fg-3">
                  <div><RefreshCw size={22} className="mx-auto mb-2 animate-spin" aria-hidden />서버 버전을 불러오는 중…</div>
                </div>
              ) : serverRevisions.length === 0 ? (
                <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-line bg-card/30 px-4 text-center">
                  <div>
                    <Cloud size={24} className="mx-auto text-fg-3" aria-hidden />
                    <p className="mt-2 text-sm font-semibold text-fg-2">아직 서버에 저장된 버전이 없어요</p>
                    <p className="mt-1 text-xs text-fg-3">로그인한 작품을 저장하면 자동 revision이 생성됩니다.</p>
                  </div>
                </div>
              ) : (
                <ol className="space-y-2" aria-label="서버 자동 버전">
                  {serverRevisions.map((revision) => {
                    const current = revision.revision === serverCurrentRevision;
                    return (
                      <li
                        key={revision.revision}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card/55 px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-fg">
                            revision {revision.revision}
                            {current ? <span className="rounded-full bg-good-soft px-2 py-0.5 text-[0.62rem] text-good">현재</span> : null}
                            {revision.restoredFromRevision ? (
                              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.62rem] text-accent">
                                r{revision.restoredFromRevision}에서 복원
                              </span>
                            ) : null}
                          </p>
                          <time dateTime={revision.createdAt} className="mt-0.5 block text-[0.68rem] text-fg-3">
                            {checkpointDate(revision.createdAt)}
                          </time>
                        </div>
                        <button
                          type="button"
                          onClick={() => void reviewServerRevision(revision)}
                          disabled={current || serverLoading}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent-soft/25 px-3 text-xs font-semibold text-accent hover:bg-accent-soft/45 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <History size={12} aria-hidden /> {current ? "현재 버전" : "변경 검토"}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          )}
        </div>

        <p className="shrink-0 border-t border-line px-4 py-2 text-[0.68rem] leading-relaxed text-fg-3">
          {visibleTab === "local"
            ? `브라우저 지점은 기기 변경에 유지되지 않으므로 JSON 또는 프로젝트 archive도 함께 보관하세요. 최신 ${STUDIO_CHECKPOINT_LIMIT}개까지 저장합니다.`
            : "서버 복원은 기존 revision을 덮어쓰지 않고 새 revision으로 기록됩니다. 작품 소유자에게만 목록과 내용이 열립니다."}
        </p>
        </div>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
