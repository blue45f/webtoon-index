import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Eye,
  FilePenLine,
  LockKeyhole,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  UserRound,
  UsersRound,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type Ref,
} from "react";
import { Link } from "react-router-dom";


import { buildStudioHref } from "./creator-studio-links";
import {
  getStudioSharedWorks,
  isStudioSharedWorksScopeCurrent,
  mergeStudioSharedWorks,
  STUDIO_SHARED_WORKS_PAGE_SIZE,
  type StudioSharedWork,
  type StudioSharedWorksRequestScope,
} from "./studio-shared-works-client";

import type { StudioTeamRole } from "./studio-team-client";

import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";

const ROLE_LABEL: Record<StudioTeamRole, string> = {
  owner: "소유자",
  admin: "관리자",
  editor: "편집자",
  commenter: "검토자",
  viewer: "열람자",
};

const UPDATED_AT_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export interface StudioSharedWorksPanelProps {
  /** 닫힌 상위 패널에서는 네트워크 요청과 마크업을 모두 생략한다. */
  open?: boolean;
  loggedIn: boolean;
  authScopeKey: string | null;
  currentWorkId?: string | null;
  /** 초대 수락처럼 상위 surface에서 목록 구성 자체가 바뀐 뒤 재조회를 요청하는 토큰. */
  refreshKey?: string | number;
  className?: string;
  /** 상위 drawer를 닫는 등, 링크 이동 직전 필요한 가벼운 UI 정리에만 사용한다. */
  onOpenWork?: (work: StudioSharedWork) => void;
}

export interface StudioSharedWorksPanelViewProps {
  loggedIn: boolean;
  works: StudioSharedWork[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  hasMore: boolean;
  paginationComplete: boolean;
  currentWorkId: string | null;
  headingRef?: Ref<HTMLHeadingElement>;
  loadMoreEndRef?: Ref<HTMLParagraphElement>;
  className?: string;
  onRetry: () => void;
  onLoadMore: () => void;
  onOpenWork?: (work: StudioSharedWork) => void;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? UPDATED_AT_FORMATTER.format(date) : "날짜 확인 불가";
}

function roleBadgeClass(role: StudioTeamRole): string {
  if (role === "owner" || role === "admin") return "border-accent/35 bg-accent-soft text-accent";
  if (role === "editor") return "border-cool/35 bg-cool/10 text-cool";
  if (role === "commenter") return "border-warn/35 bg-warn/10 text-warn";
  return "border-line-strong bg-raised text-fg-2";
}

function accessCopy(work: StudioSharedWork): {
  label: string;
  detail: string;
  Icon: typeof Eye;
} {
  if (work.access === "edit") {
    return { label: "편집으로 열기", detail: "공동 저장 가능", Icon: FilePenLine };
  }
  if (work.access === "comment") {
    return {
      label: "검토로 열기",
      detail: "검토 전용 · 서버 저장 불가",
      Icon: MessageSquareText,
    };
  }
  return { label: "읽기 전용으로 열기", detail: "읽기 전용 · 서버 저장 불가", Icon: Eye };
}

function CurrentReadOnlyNotice({ work }: { work: StudioSharedWork }) {
  if (work.access === "edit") return null;
  return (
    <div
      className="mt-3 flex items-start gap-2.5 rounded-xl border border-warn/35 bg-warn/10 px-3 py-2.5"
      role="note"
    >
      <LockKeyhole className="mt-0.5 shrink-0 text-warn" size={16} aria-hidden="true" />
      <div className="min-w-0 text-xs leading-relaxed">
        <p className="font-semibold text-fg">이 작품은 서버 저장이 제한됩니다</p>
        <p className="mt-0.5 text-fg-2">
          {ROLE_LABEL[work.role]} 권한으로 열었습니다. 원고를 살펴볼 수 있지만 서버 원본은
          덮어쓰지 않습니다.
        </p>
      </div>
    </div>
  );
}

function SharedWorkRow({
  work,
  current,
  onOpenWork,
}: {
  work: StudioSharedWork;
  current: boolean;
  onOpenWork?: (work: StudioSharedWork) => void;
}) {
  const copy = accessCopy(work);
  const body = (
    <>
      <div className="min-w-0 flex-1 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-fg">{work.title}</p>
          <span className="inline-flex min-h-6 shrink-0 items-center rounded-full border border-line bg-raised px-2 text-xs font-semibold text-fg-2">
            {work.format === "upload" ? "이미지 업로드" : "컷툰"}
          </span>
          <span
            className={cn(
              "inline-flex min-h-6 shrink-0 items-center rounded-full border px-2 text-xs font-semibold",
              roleBadgeClass(work.role)
            )}
          >
            {ROLE_LABEL[work.role]}
          </span>
        </div>
        <p className="mt-1 truncate text-xs text-fg-2">{work.owner.name} · 작품 소유자</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-3">
          <span className={work.access === "edit" ? "text-good" : "text-warn"}>{copy.detail}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={work.updatedAt}>{formatUpdatedAt(work.updatedAt)} 수정</time>
        </div>
      </div>
      <span className="flex min-h-11 shrink-0 items-center gap-1.5 pl-2 text-xs font-semibold text-accent">
        {current ? (
          <>
            <CheckCircle2 size={16} aria-hidden="true" /> 현재 작업
          </>
        ) : (
          <>
            <copy.Icon size={16} aria-hidden="true" />
            <span className="hidden min-[420px]:inline">{copy.label}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </>
        )}
      </span>
    </>
  );

  if (current) {
    return (
      <div
        aria-current="page"
        className="flex min-h-[5.25rem] items-center gap-2 bg-accent-soft/35 px-3"
      >
        {body}
      </div>
    );
  }

  return (
    <Link
      aria-label={`${work.title}, ${ROLE_LABEL[work.role]}, ${copy.label}`}
      className="flex min-h-[5.25rem] items-center gap-2 px-3 transition-colors duration-150 hover:bg-raised/70 focus-visible:bg-raised/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70 motion-reduce:transition-none"
      to={buildStudioHref({
        workId: work.workId,
        mode: work.format === "upload" ? "upload" : null,
      })}
      onClick={() => onOpenWork?.(work)}
    >
      {body}
    </Link>
  );
}

/** 로딩과 분리된 순수 뷰. 상위 팀 drawer 또는 독립 작품 전환 surface에서 재사용한다. */
export function StudioSharedWorksPanelView({
  loggedIn,
  works,
  loading,
  loadingMore,
  error,
  loadMoreError,
  hasMore,
  paginationComplete,
  currentWorkId,
  headingRef,
  loadMoreEndRef,
  className,
  onRetry,
  onLoadMore,
  onOpenWork,
}: StudioSharedWorksPanelViewProps) {
  const headingId = useId();
  const currentWork = works.find((work) => work.workId === currentWorkId) ?? null;

  return (
    <section
      aria-labelledby={headingId}
      className={cn("border-b border-line px-4 py-4 sm:px-5", className)}
      data-studio-shared-works="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <UsersRound className="shrink-0 text-accent" size={17} aria-hidden="true" />
            <h3
              ref={headingRef}
              className="text-sm font-bold text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
              id={headingId}
              tabIndex={-1}
            >
              팀 작품
            </h3>
            {!loading && !error && loggedIn ? (
              <span className="inline-flex min-h-6 items-center rounded-full bg-raised px-2 text-xs font-semibold tabular-nums text-fg-2">
                {works.length}
              </span>
            ) : null}
          </div>
          <p className="mt-1 max-w-[38ch] text-xs leading-relaxed text-fg-3">
            내가 소유하거나 참여 중인 작품을 역할에 맞는 모드로 엽니다.
          </p>
        </div>
        <button
          aria-label="팀 작품 새로고침"
          className="grid size-11 shrink-0 place-items-center rounded-lg border border-line text-fg-2 transition-colors duration-150 hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-45 motion-reduce:transition-none"
          disabled={!loggedIn || loading || loadingMore}
          title="새로고침"
          type="button"
          onClick={onRetry}
        >
          <RefreshCw
            className={cn(loading && "animate-spin motion-reduce:animate-none")}
            size={17}
            aria-hidden="true"
          />
        </button>
      </div>

      {!loggedIn ? (
        <div className="py-7 text-center">
          <UserRound className="mx-auto text-fg-3" size={25} aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-fg">로그인이 필요해요</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-3">
            팀 작품은 초대를 수락한 계정에 안전하게 연결됩니다.
          </p>
        </div>
      ) : loading && works.length === 0 ? (
        <div
          aria-busy="true"
          aria-label="팀 작품 불러오는 중"
          className="mt-3 space-y-1"
        >
          {[0, 1, 2].map((index) => (
            <div className="flex min-h-[5.25rem] items-center gap-3 border-t border-line px-3" key={index}>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-3/5 animate-pulse rounded bg-raised motion-reduce:animate-none" />
                <div className="h-3 w-2/5 animate-pulse rounded bg-raised/70 motion-reduce:animate-none" />
              </div>
              <div className="h-9 w-20 animate-pulse rounded-lg bg-raised motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="py-7 text-center" role="alert">
          <AlertCircle className="mx-auto text-bad" size={25} aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-fg">팀 작품을 열지 못했어요</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-fg-2">{error}</p>
          <Button className="mt-4 min-h-11" size="sm" type="button" variant="outline" onClick={onRetry}>
            <RefreshCw size={15} aria-hidden="true" /> 다시 시도
          </Button>
        </div>
      ) : works.length === 0 ? (
        <div className="py-7 text-center">
          <UsersRound className="mx-auto text-fg-3" size={25} aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-fg">참여 중인 팀 작품이 없어요</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-fg-3">
            팀 초대를 수락하면 여기에서 역할과 저장 가능 여부를 확인하고 바로 열 수 있습니다.
          </p>
        </div>
      ) : (
        <ul
          aria-label="내 팀 작품"
          aria-busy={loading || loadingMore}
          className="mt-3 max-h-[min(18rem,42dvh)] divide-y divide-line overflow-y-auto overscroll-contain border-y border-line [scrollbar-gutter:stable]"
        >
          {works.map((work) => (
            <li
              className="[contain-intrinsic-size:auto_5.25rem] [content-visibility:auto]"
              key={work.workId}
            >
              <SharedWorkRow
                current={work.workId === currentWorkId}
                work={work}
                onOpenWork={onOpenWork}
              />
            </li>
          ))}
        </ul>
      )}

      {works.length > 0 && (hasMore || loadingMore || loadMoreError) ? (
        <div className="mt-3">
          {loadMoreError ? (
            <p className="mb-2 text-xs leading-relaxed text-bad" role="alert">
              {loadMoreError}
            </p>
          ) : null}
          <Button
            aria-busy={loadingMore}
            aria-label={loadingMore ? "팀 작품 더 불러오는 중" : "팀 작품 더 불러오기"}
            className="min-h-11 w-full"
            disabled={loading || loadingMore}
            size="sm"
            type="button"
            variant="outline"
            onClick={onLoadMore}
          >
            {loadingMore ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                size={15}
                aria-hidden="true"
              />
            ) : (
              <ChevronRight className="rotate-90" size={15} aria-hidden="true" />
            )}
            {loadingMore ? "더 불러오는 중" : loadMoreError ? "다시 불러오기" : "작품 더 불러오기"}
          </Button>
        </div>
      ) : paginationComplete ? (
        <p
          ref={loadMoreEndRef}
          aria-live="polite"
          className="mt-3 text-center text-xs text-fg-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
          tabIndex={-1}
        >
          모든 팀 작품을 불러왔습니다.
        </p>
      ) : null}

      {currentWork ? <CurrentReadOnlyNotice work={currentWork} /> : null}
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "공유 작품을 불러오지 못했습니다.";
}

export function StudioSharedWorksPanel({
  open = true,
  loggedIn,
  authScopeKey,
  currentWorkId = null,
  refreshKey = 0,
  className,
  onOpenWork,
}: StudioSharedWorksPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const loadMoreEndRef = useRef<HTMLParagraphElement>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const loadMoreRequestIdRef = useRef(0);
  const currentScopeRef = useRef<{ authScopeKey: string | null }>({ authScopeKey });
  currentScopeRef.current = { authScopeKey };
  const [works, setWorks] = useState<StudioSharedWork[]>([]);
  const [worksAuthScopeKey, setWorksAuthScopeKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingAuthScopeKey, setLoadingAuthScopeKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorAuthScopeKey, setErrorAuthScopeKey] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [paginationComplete, setPaginationComplete] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const focusAfterReloadRef = useRef(false);
  const authReady = loggedIn && authScopeKey !== null;

  useEffect(
    () => () => {
      loadMoreAbortRef.current?.abort();
      loadMoreRequestIdRef.current += 1;
    },
    []
  );

  useEffect(() => {
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreRequestIdRef.current += 1;
    setWorks([]);
    setWorksAuthScopeKey(null);
    setLoading(false);
    setLoadingAuthScopeKey(null);
    setError(null);
    setErrorAuthScopeKey(null);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(null);
    setPaginationComplete(false);
    focusAfterReloadRef.current = false;
  }, [authScopeKey, loggedIn]);

  useEffect(() => {
    if (!open) {
      loadMoreAbortRef.current?.abort();
      loadMoreAbortRef.current = null;
      loadMoreRequestIdRef.current += 1;
      setLoadingMore(false);
      focusAfterReloadRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !authReady || !authScopeKey) return;
    const controller = new AbortController();
    const requestScope: StudioSharedWorksRequestScope = { authScopeKey };
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = null;
    loadMoreRequestIdRef.current += 1;
    setLoading(true);
    setLoadingAuthScopeKey(authScopeKey);
    setError(null);
    setErrorAuthScopeKey(null);
    setNextCursor(null);
    setLoadingMore(false);
    setLoadMoreError(null);
    setPaginationComplete(false);

    // 소유 작품과 공유 작품이 한 피드에 섞이므로 첫 페이지는 서버 상한으로 받고, 이후 페이지는
    // opaque cursor로 이어 붙인다. 화면 높이는 독립 스크롤로 제한한다.
    void getStudioSharedWorks({
      limit: STUDIO_SHARED_WORKS_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((page) => {
        if (
          !controller.signal.aborted &&
          isStudioSharedWorksScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setWorks(page.items);
          setWorksAuthScopeKey(authScopeKey);
          setNextCursor(page.nextCursor);
        }
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted &&
          isStudioSharedWorksScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setWorks([]);
          setWorksAuthScopeKey(null);
          setNextCursor(null);
          setError(errorMessage(cause));
          setErrorAuthScopeKey(authScopeKey);
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          isStudioSharedWorksScopeCurrent(requestScope, currentScopeRef.current)
        ) {
          setLoading(false);
          setLoadingAuthScopeKey(null);
          if (focusAfterReloadRef.current) {
            focusAfterReloadRef.current = false;
            globalThis.requestAnimationFrame?.(() => headingRef.current?.focus());
          }
        }
      });

    return () => controller.abort();
  }, [authReady, authScopeKey, open, refreshKey, reloadKey]);

  async function handleLoadMore() {
    if (
      !open ||
      !authReady ||
      !authScopeKey ||
      worksAuthScopeKey !== authScopeKey ||
      !nextCursor ||
      loading ||
      loadingMore
    ) {
      return;
    }
    const cursor = nextCursor;
    const requestScope: StudioSharedWorksRequestScope = { authScopeKey };
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = controller;
    const requestId = loadMoreRequestIdRef.current + 1;
    loadMoreRequestIdRef.current = requestId;
    setLoadingMore(true);
    setLoadMoreError(null);

    try {
      const page = await getStudioSharedWorks({
        limit: STUDIO_SHARED_WORKS_PAGE_SIZE,
        cursor,
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        requestId !== loadMoreRequestIdRef.current ||
        !isStudioSharedWorksScopeCurrent(requestScope, currentScopeRef.current)
      ) {
        return;
      }
      setWorks((current) => mergeStudioSharedWorks(current, page.items));
      setNextCursor(page.nextCursor);
      if (page.nextCursor === null) {
        setPaginationComplete(true);
        globalThis.requestAnimationFrame?.(() => loadMoreEndRef.current?.focus());
      }
    } catch (cause) {
      if (
        controller.signal.aborted ||
        requestId !== loadMoreRequestIdRef.current ||
        !isStudioSharedWorksScopeCurrent(requestScope, currentScopeRef.current)
      ) {
        return;
      }
      setLoadMoreError(errorMessage(cause));
    } finally {
      if (
        requestId === loadMoreRequestIdRef.current &&
        isStudioSharedWorksScopeCurrent(requestScope, currentScopeRef.current)
      ) {
        loadMoreAbortRef.current = null;
        setLoadingMore(false);
      }
    }
  }

  if (!open) return null;

  const visibleWorks = worksAuthScopeKey === authScopeKey ? works : [];
  const visibleLoading = loading && loadingAuthScopeKey === authScopeKey;
  const visibleError = errorAuthScopeKey === authScopeKey ? error : null;
  const visiblePagination = worksAuthScopeKey === authScopeKey;

  return (
    <StudioSharedWorksPanelView
      className={className}
      currentWorkId={currentWorkId}
      error={visibleError}
      hasMore={visiblePagination && nextCursor !== null}
      headingRef={headingRef}
      loading={visibleLoading}
      loadingMore={visiblePagination && loadingMore}
      loggedIn={authReady}
      loadMoreEndRef={loadMoreEndRef}
      loadMoreError={visiblePagination ? loadMoreError : null}
      paginationComplete={visiblePagination && paginationComplete}
      works={visibleWorks}
      onLoadMore={() => void handleLoadMore()}
      onOpenWork={onOpenWork}
      onRetry={() => {
        if (!authReady) return;
        focusAfterReloadRef.current = true;
        setReloadKey((value) => value + 1);
      }}
    />
  );
}
