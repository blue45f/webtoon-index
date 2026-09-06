import { ChevronDown, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreatorMarketplaceOwnedHistoryPage,
  CreatorMarketplaceOwnedRelease,
  CreatorMarketplaceResourceRelistReceipt,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { cx } from "@/shared/lib/cx";
import {
  listCreatorMarketplaceOwnedHistory,
  relistCreatorMarketplaceResource,
} from "@/src/infrastructure/creator-marketplace-client";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-panel";
const ACTION =
  `min-h-11 rounded-lg border border-line bg-card px-3 text-[0.58rem] font-bold text-fg-2 hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45 ${FOCUS}`;
const HISTORY_LIMIT = 8;

function lifecycleLabel(release: CreatorMarketplaceOwnedRelease): string {
  if (release.hidden) return "관리자 숨김";
  if (release.delistedAt) return "목록 내림";
  return "공개 중";
}

function lifecycleClass(release: CreatorMarketplaceOwnedRelease): string {
  if (release.hidden) return "border-bad/30 bg-bad/10 text-bad";
  if (release.delistedAt) return "border-warn/30 bg-warn/10 text-warn";
  return "border-good/30 bg-good/10 text-good";
}

function lifecycleError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function StudioOwnedLifecycleBadge({
  release,
}: {
  readonly release: CreatorMarketplaceOwnedRelease;
}) {
  return (
    <span
      className={cx(
        "rounded-full border px-1.5 py-0.5 text-[0.52rem] font-black",
        lifecycleClass(release),
      )}
    >
      {lifecycleLabel(release)}
    </span>
  );
}

export interface StudioOwnedReleaseLifecycleActionsProps {
  readonly release: CreatorMarketplaceOwnedRelease;
  readonly onDelist: (release: CreatorMarketplaceOwnedRelease) => Promise<boolean>;
  readonly onRelisted: (
    release: CreatorMarketplaceOwnedRelease,
    receipt: CreatorMarketplaceResourceRelistReceipt,
  ) => void;
}

export function StudioOwnedReleaseLifecycleActions({
  release,
  onDelist,
  onRelisted,
}: StudioOwnedReleaseLifecycleActionsProps) {
  const [armedAction, setArmedAction] = useState<"delist" | "relist" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    requestGenerationRef.current += 1;
    setArmedAction(null);
    setError(null);
    setPending(false);
    return () => {
      requestGenerationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [release.resource.id, release.hidden, release.delistedAt]);

  async function commitDelist(): Promise<void> {
    if (pending || release.delistedAt) return;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setPending(true);
    setError(null);
    try {
      const changed = await onDelist(release);
      if (requestGenerationRef.current !== generation) return;
      if (!changed) {
        setError("목록 내리기를 완료하지 못했습니다. 다시 시도해 주세요.");
        return;
      }
      setArmedAction(null);
    } catch (caught) {
      if (requestGenerationRef.current !== generation) return;
      setError(lifecycleError(caught, "목록 내리기를 완료하지 못했습니다."));
    } finally {
      if (requestGenerationRef.current === generation) setPending(false);
    }
  }

  async function commitRelist(): Promise<void> {
    if (pending || release.hidden || !release.delistedAt) return;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    setPending(true);
    setError(null);
    try {
      const receipt = await relistCreatorMarketplaceResource(
        release.resource.id,
        controller.signal,
      );
      if (requestGenerationRef.current !== generation) return;
      onRelisted(release, receipt);
      setArmedAction(null);
    } catch (caught) {
      if (requestGenerationRef.current !== generation) return;
      setError(lifecycleError(caught, "다시 공개하지 못했습니다."));
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      if (requestGenerationRef.current === generation) setPending(false);
    }
  }

  if (release.hidden && release.delistedAt) {
    return (
      <p className="mt-2 rounded-md border border-bad/25 bg-bad/10 px-2 py-2 text-[0.56rem] leading-relaxed text-bad">
        이 head는 관리자 숨김과 목록 내림 상태입니다. 관리자 숨김이 해제되기 전에는 다시 공개하거나 새 릴리스를 게시할 수 없습니다.
      </p>
    );
  }

  const action = release.delistedAt ? "relist" : "delist";
  const label = action === "relist" ? "다시 공개" : "목록에서 내리기";
  return (
    <div className="mt-2">
      {release.hidden ? (
        <p className="mb-2 rounded-md border border-bad/25 bg-bad/10 px-2 py-2 text-[0.56rem] leading-relaxed text-bad">
          관리자 숨김 중에도 이 head를 목록에서 내릴 수 있습니다. 숨김이 해제되기 전에는 다시 공개하거나 새 릴리스를 게시할 수 없습니다.
        </p>
      ) : null}
      {armedAction === action ? (
        <div role="group" aria-label={`${label} 확인: ${release.resource.name}`} className="flex gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setArmedAction(null);
              setError(null);
            }}
            className={cx("flex-1", ACTION)}
          >
            취소
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => void (action === "relist" ? commitRelist() : commitDelist())}
            className={cx(
              "flex-1",
              ACTION,
              action === "relist"
                ? "border-good/30 bg-good/10 text-good"
                : "border-warn/30 bg-warn/10 text-warn",
            )}
          >
            {pending ? "처리 중…" : `${label} 확인`}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setArmedAction(action);
            setError(null);
          }}
          className={cx("w-full", ACTION)}
        >
          {label}
        </button>
      )}
      {error ? <p role="alert" className="mt-1.5 text-[0.56rem] leading-relaxed text-bad">{error}</p> : null}
    </div>
  );
}

type HistoryState =
  | { readonly status: "idle" | "loading"; readonly page: null; readonly error: null }
  | { readonly status: "error"; readonly page: null; readonly error: string }
  | { readonly status: "ready"; readonly page: CreatorMarketplaceOwnedHistoryPage; readonly error: null };

function mergeOwnedHistory(
  current: readonly CreatorMarketplaceOwnedRelease[],
  incoming: readonly CreatorMarketplaceOwnedRelease[],
): CreatorMarketplaceOwnedRelease[] {
  const ids = new Set(current.map((release) => release.resource.id));
  return [...current, ...incoming.filter((release) => !ids.has(release.resource.id))];
}

export function StudioOwnedPackageHistory({
  head,
}: {
  readonly head: CreatorMarketplaceOwnedRelease;
}) {
  const [open, setOpen] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: "idle", page: null, error: null });
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const invalidateActiveRequest = useCallback(() => {
    const activeController = controllerRef.current;
    activeController?.abort();
    if (controllerRef.current === activeController) {
      controllerRef.current = null;
    }
    generationRef.current += 1;
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setState({ status: "loading", page: null, error: null });
    setLoadingMore(false);
    setLoadMoreError(null);
    void listCreatorMarketplaceOwnedHistory({
      packageId: head.resource.packageId,
      limit: HISTORY_LIMIT,
    }, controller.signal).then((page) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setState({ status: "ready", page, error: null });
    }).catch((caught: unknown) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setState({
        status: "error",
        page: null,
        error: lifecycleError(caught, "내 릴리스 이력을 불러오지 못했습니다."),
      });
    });
    return () => {
      controller.abort();
      invalidateActiveRequest();
    };
  }, [head.resource.packageId, invalidateActiveRequest, open, retryGeneration]);

  const loadMore = useCallback(() => {
    if (state.status !== "ready" || !state.page.hasMore) return;
    const cursor = state.page.nextCursor;
    if (cursor === null) return;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const currentPage = state.page;
    setLoadingMore(true);
    setLoadMoreError(null);
    void listCreatorMarketplaceOwnedHistory({
      packageId: head.resource.packageId,
      limit: HISTORY_LIMIT,
      cursor,
    }, controller.signal).then((page) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setState({
        status: "ready",
        page: { ...page, items: mergeOwnedHistory(currentPage.items, page.items) },
        error: null,
      });
      setLoadingMore(false);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      setLoadMoreError(lifecycleError(caught, "이전 릴리스를 더 불러오지 못했습니다."));
      setLoadingMore(false);
    });
  }, [head.resource.packageId, state]);

  return (
    <details
      open={open}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (!nextOpen) {
          invalidateActiveRequest();
          setLoadingMore(false);
        }
        setOpen(nextOpen);
      }}
      className="mt-2 rounded-md border border-line bg-panel"
    >
      <summary className={cx("flex min-h-11 cursor-pointer list-none items-center justify-between px-2.5 text-[0.58rem] font-bold text-fg-2 [&::-webkit-details-marker]:hidden", FOCUS)}>
        내 릴리스 이력
        <ChevronDown size={13} className="text-fg-3" aria-hidden />
      </summary>
      <div className="border-t border-line p-2">
        {state.status === "loading" || state.status === "idle" ? (
          <p role="status" className="flex items-center gap-1.5 text-[0.56rem] text-fg-2">
            <LoaderCircle size={12} className="animate-spin" aria-hidden /> 이력을 불러오는 중…
          </p>
        ) : null}
        {state.status === "error" ? (
          <div role="alert" className="text-[0.56rem] text-bad">
            <p>{state.error}</p>
            <button type="button" className={cx("mt-2", ACTION)} onClick={() => setRetryGeneration((value) => value + 1)}>
              다시 시도
            </button>
          </div>
        ) : null}
        {state.status === "ready" ? (
          <>
            {state.page.items.length === 0 ? (
              <p className="text-[0.56rem] text-fg-3">저장된 릴리스 이력이 없습니다.</p>
            ) : (
              <ol className="space-y-1.5">
                {state.page.items.map((release) => (
                  <li key={release.resource.id} className="rounded-md border border-line bg-card p-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-[0.6rem] text-fg">v{release.resource.resourceVersion}</strong>
                      <StudioOwnedLifecycleBadge release={release} />
                      {release.resource.id === head.resource.id ? (
                        <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[0.52rem] font-black text-accent">현재 헤드</span>
                      ) : null}
                      <span className="ml-auto text-[0.52rem] text-fg-3">릴리스 #{release.releaseOrdinal}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-[0.56rem] leading-relaxed text-fg-2">
                      {release.resource.releaseNotes ?? "릴리스 노트 없음"}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            {loadMoreError ? <p role="alert" className="mt-2 text-[0.56rem] text-bad">{loadMoreError}</p> : null}
            {state.page.hasMore ? (
              <button type="button" disabled={loadingMore} onClick={loadMore} className={cx("mt-2 w-full", ACTION)}>
                {loadingMore ? "더 불러오는 중…" : loadMoreError ? "다시 불러오기" : "이전 릴리스 더 보기"}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </details>
  );
}
