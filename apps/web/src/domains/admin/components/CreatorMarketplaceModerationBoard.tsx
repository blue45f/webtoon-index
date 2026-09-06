import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Flag,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type {
  CreatorMarketplaceResourceModerationAction,
  CreatorMarketplaceResourceModerationQueueItem,
  CreatorMarketplaceResourceModerationQueuePage,
  CreatorMarketplaceResourceReportReason,
} from "@/shared/lib/creator-marketplace-resource-contract";

import { CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS } from "@/shared/lib/creator-marketplace-resource-contract";
import { cn } from "@/shared/lib/utils";
import Link from "@/src/compat/router-link";
import {
  dismissOrphanedReport,
  listCreatorMarketplaceModerationQueue,
  moderateCreatorMarketplaceResource,
} from "@/src/infrastructure/creator-marketplace-client";

const PAGE_SIZE = 10;

const REASON_LABELS: Record<CreatorMarketplaceResourceReportReason, string> = {
  copyright: "저작권·권리 침해",
  unsafe: "위험·유해 콘텐츠",
  spam: "스팸·무관한 리소스",
  misleading: "오해를 부르는 설명",
  other: "기타",
};

const ACTION_LABELS: Record<CreatorMarketplaceResourceModerationAction, string> = {
  hide: "관리자 숨김",
  restore: "관리자 숨김 해제",
  dismiss: "신고 기각",
};

interface ModerationFocusRestoreRequest {
  readonly origin: HTMLButtonElement;
  readonly target: "action" | "status";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatByteSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function currentState(item: CreatorMarketplaceResourceModerationQueueItem): {
  readonly label: string;
  readonly description: string;
  readonly tone: "bad" | "good" | "warn";
} {
  if (!item.currentResource) {
    return {
      label: "현재 릴리스 행 없음",
      description: "신고 당시 증거는 보존됐지만 현재 리소스가 없어 숨김·복원할 수 없습니다. 증거 확인 후 이 신고만 기각할 수 있습니다.",
      tone: "warn",
    };
  }
  const currentPackage = item.currentPackage;
  if (!currentPackage) {
    return {
      label: "현재 패키지 확인 불가",
      description: "신고 릴리스 행은 남아 있지만 현재 패키지 권한 상태를 확인할 수 없어 공개 링크를 제공하지 않습니다.",
      tone: "warn",
    };
  }
  if (currentPackage.availability.state === "available") {
    return {
      label: "공개 중",
      description: "현재 절대 head와 배급자 계정이 공개 가능한 상태입니다.",
      tone: "good",
    };
  }
  if (currentPackage.availability.reason === "moderated") {
    return {
      label: "관리자 숨김",
      description: "관리자가 현재 패키지의 공개 상세와 목록 노출을 숨긴 상태입니다.",
      tone: "bad",
    };
  }
  if (currentPackage.availability.reason === "owner-delisted") {
    return {
      label: "배급자 목록 내림",
      description: "배급자가 절대 head를 목록에서 내렸습니다. 신고된 과거 릴리스도 공개 상세로 연결하지 않으며, 관리자 복원 액션으로 다시 게시되지 않습니다.",
      tone: "warn",
    };
  }
  return {
    label: "배급자 사용 불가",
    description: "배급자 계정이 현재 활동 상태가 아니므로 패키지와 과거 릴리스의 공개 상세를 제공하지 않습니다.",
    tone: "warn",
  };
}

function actionResultMessage(
  action: CreatorMarketplaceResourceModerationAction,
  item: CreatorMarketplaceResourceModerationQueueItem,
  result: {
    readonly hidden: boolean;
    readonly delisted: boolean;
    readonly reviewedReportCount: number;
  },
): string {
  const state = result.hidden && result.delisted
    ? "관리자 숨김이 적용되었고 배급자 목록 내림은 유지됩니다."
    : result.hidden
      ? "관리자 숨김이 적용되었습니다."
    : result.delisted
      ? "관리자 숨김은 해제됐지만 배급자 목록 내림은 유지됩니다."
      : "관리자 숨김 없이 공개 가능한 상태입니다.";
  return `${item.evidence.name}: ${ACTION_LABELS[action]} 완료 · 연관된 열린 신고 ${result.reviewedReportCount}건 처리. ${state}`;
}

export function CreatorMarketplaceModerationBoard() {
  const headingId = useId();
  const requestGenerationRef = useRef(0);
  const busyTargetRef = useRef<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement | null>(null);
  const focusRestoreRef = useRef<ModerationFocusRestoreRequest | null>(null);
  const [page, setPage] = useState<CreatorMarketplaceResourceModerationQueuePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<{
    readonly targetKey: string;
    readonly action: CreatorMarketplaceResourceModerationAction;
  } | null>(null);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void listCreatorMarketplaceModerationQueue(
      { status: "open", limit: PAGE_SIZE, offset },
      controller.signal,
    )
      .then((nextPage) => {
        if (requestGenerationRef.current !== generation) return;
        setPage(nextPage);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted || requestGenerationRef.current !== generation) return;
        setError(errorMessage(caught, "마켓 신고 검수 목록을 불러오지 못했습니다."));
      })
      .finally(() => {
        if (requestGenerationRef.current === generation) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, refreshToken]);

  useEffect(() => {
    const request = focusRestoreRef.current;
    if (!request || busyAction) return;
    const target = request.target === "status"
      ? statusRef.current
      : request.origin;
    if (!target?.isConnected) return;
    if (target instanceof HTMLButtonElement && target.disabled) return;

    const active = document.activeElement;
    if (active !== target && (
      active === null
      || active === document.body
      || active === document.documentElement
      || active === request.origin
    )) {
      target.focus();
    }
    focusRestoreRef.current = null;
  }, [actionError, busyAction, page, statusMessage]);

  async function moderate(
    item: CreatorMarketplaceResourceModerationQueueItem,
    action: CreatorMarketplaceResourceModerationAction,
    trigger: HTMLButtonElement,
  ) {
    const resourceId = item.currentPackage?.moderationTargetId
      ?? item.currentResource?.id;
    const targetKey = resourceId ?? `report:${item.reportId}`;
    const note = (notes[item.reportId] ?? "").trim();
    if (!note || busyTargetRef.current || (!resourceId && action !== "dismiss")) return;

    focusRestoreRef.current = document.activeElement === trigger
      ? { origin: trigger, target: "action" }
      : null;

    busyTargetRef.current = targetKey;
    setBusyAction({ targetKey, action });
    setActionError(null);
    setStatusMessage(null);
    try {
      const resourceResult = resourceId
        ? await moderateCreatorMarketplaceResource(resourceId, {
            action,
            sourceReportId: item.reportId,
            note,
          })
        : null;
      const orphanResult = resourceId
        ? null
        : await dismissOrphanedReport(item.reportId, note);
      const pageBeforeMutation = page;
      const targetPackage = item.currentPackage;
      const resolvesCandidate = (
        candidate: CreatorMarketplaceResourceModerationQueueItem,
      ) => {
        if (!resourceId) return candidate.reportId === item.reportId;
        if (candidate.evidence.resourceId === item.evidence.resourceId) return true;
        if (!targetPackage) return false;
        const candidatePackage = candidate.currentPackage
          ?? (candidate.evidence.schemaVersion !== 1
            ? {
                publisherId: candidate.evidence.publisherId,
                packageId: candidate.evidence.packageId,
              }
            : null);
        return candidatePackage?.publisherId === targetPackage.publisherId
          && candidatePackage.packageId === targetPackage.packageId;
      };
      const relatedReportIds = new Set(
        pageBeforeMutation?.items
          .filter(resolvesCandidate)
          .map((candidate) => candidate.reportId) ?? [],
      );
      const remainingItems = pageBeforeMutation?.items.filter(
        (candidate) => !resolvesCandidate(candidate),
      ) ?? [];
      setPage((current) => current
        ? {
            ...current,
            items: current.items.filter((candidate) => !resolvesCandidate(candidate)),
          }
        : current);
      setNotes((current) => Object.fromEntries(
        Object.entries(current).filter(([reportId]) => !relatedReportIds.has(reportId)),
      ));
      setStatusMessage(resourceResult
        ? actionResultMessage(action, item, resourceResult)
        : `${item.evidence.name}: 원본 릴리스가 없어 신고 ${orphanResult?.dismissedReportCount ?? 0}건만 기각했습니다. 리소스 공개 상태는 변경하지 않았습니다.`);
      if (focusRestoreRef.current) {
        focusRestoreRef.current = {
          ...focusRestoreRef.current,
          target: "status",
        };
      }

      if (remainingItems.length === 0) {
        if (pageBeforeMutation?.hasMore) {
          setRefreshToken((token) => token + 1);
        } else if (offset > 0) {
          setOffset(Math.max(0, offset - PAGE_SIZE));
        }
      }
    } catch (caught) {
      setActionError(errorMessage(
        caught,
        resourceId
          ? `${item.evidence.name} 검수 상태를 변경하지 못했습니다.`
          : `${item.evidence.name}의 원본 없는 신고를 종결하지 못했습니다.`,
      ));
    } finally {
      busyTargetRef.current = null;
      setBusyAction(null);
    }
  }

  const visibleStart = page && page.items.length > 0 ? page.offset + 1 : 0;
  const visibleEnd = page ? page.offset + page.items.length : 0;

  return (
    <section aria-labelledby={headingId}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow flex items-center gap-1.5 text-bad">
            <Flag size={13} aria-hidden /> CREATOR MARKET REPORTS
          </p>
          <h2 id={headingId} className="mt-1 text-xl font-bold text-fg">
            Creator Market 신고 검수
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-fg-3">
            열린 신고와 신고 시점의 변경 불가능한 릴리스 증거를 함께 확인합니다. 숨김 해제는 관리자 숨김만 제거하며 배급자의 목록 내림을 되돌리지 않습니다.
          </p>
        </div>
        <button
          type="button"
          disabled={Boolean(busyAction)}
          onClick={() => setRefreshToken((token) => token + 1)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-wait disabled:opacity-45"
        >
          <RefreshCw
            size={13}
            className={cn(loading && "animate-spin motion-reduce:animate-none")}
            aria-hidden
          />
          열린 신고 새로고침
        </button>
      </div>

      {error ? (
        <div role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="mt-2 min-h-11 rounded-lg border border-current/30 px-3 font-semibold hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/70"
          >
            목록 다시 불러오기
          </button>
        </div>
      ) : null}
      {actionError ? (
        <p role="alert" className="mb-3 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
          {actionError} 작성한 검수 메모는 유지되었습니다. 버튼을 다시 누를 때만 새 요청을 보냅니다.
        </p>
      ) : null}
      {statusMessage ? (
        <p
          ref={statusRef}
          role="status"
          aria-live="polite"
          tabIndex={-1}
          className="mb-3 rounded-lg border border-good/35 bg-good/10 px-3 py-2 text-xs leading-relaxed text-good focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-good/70"
        >
          {statusMessage}
        </p>
      ) : null}

      {loading && !page ? (
        <div role="status" className="space-y-2.5" aria-label="Creator Market 신고 목록 불러오는 중">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton h-52 rounded-xl" />
          ))}
        </div>
      ) : !loading && !error && (page?.items.length ?? 0) === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-card/40 p-8 text-center">
          <ShieldCheck className="mx-auto text-good" size={24} aria-hidden />
          <p className="mt-2 text-sm font-semibold text-fg">검수 대기 중인 Creator Market 신고가 없습니다.</p>
          <p className="mt-1 text-xs text-fg-3">이 표시는 현재 열린 신고 큐만 비어 있다는 뜻입니다.</p>
        </div>
      ) : page && page.items.length > 0 ? (
        <ul className={cn("space-y-3", loading && "opacity-65")} aria-busy={loading}>
          {page.items.map((item) => {
            const state = currentState(item);
            const note = notes[item.reportId] ?? "";
            const noteValid = note.trim().length > 0;
            const targetMissing = item.currentResource === null;
            const targetKey = item.currentPackage?.moderationTargetId
              ?? item.currentResource?.id
              ?? `report:${item.reportId}`;
            const busy = busyAction?.targetKey === targetKey;
            return (
              <li key={item.reportId} className="rounded-2xl border border-line bg-card/60 p-4 sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[0.68rem] text-fg-3">
                      <span className="rounded-full bg-bad/10 px-2 py-0.5 font-semibold text-bad">
                        {REASON_LABELS[item.reason]}
                      </span>
                      <span className="rounded-full border border-line px-2 py-0.5">열린 신고</span>
                      <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                    </div>
                    <h3 className="mt-2 break-words text-base font-bold text-fg">{item.evidence.name}</h3>
                    <p className="mt-1 break-all font-mono text-[0.68rem] text-fg-3">
                      {item.evidence.packageId} · v{item.evidence.resourceVersion}
                    </p>
                  </div>
                  <span className={cn(
                    "inline-flex min-h-7 items-center gap-1 rounded-full px-2.5 py-1 text-[0.68rem] font-semibold",
                    state.tone === "bad" && "bg-bad/10 text-bad",
                    state.tone === "warn" && "bg-warn/10 text-warn",
                    state.tone === "good" && "bg-good/10 text-good",
                  )}>
                    {state.tone === "bad" ? <EyeOff size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
                    {state.label}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <section aria-label="신고 내용" className="rounded-xl border border-line bg-panel p-3">
                    <h4 className="text-xs font-semibold text-fg">신고 내용</h4>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs leading-relaxed">
                      <dt className="text-fg-3">신고자</dt>
                      <dd className="min-w-0 break-all text-fg-2">
                        {item.reporter.name}{item.reporter.id ? ` · ${item.reporter.id}` : " · 탈퇴 계정"}
                      </dd>
                      <dt className="text-fg-3">상세</dt>
                      <dd className="whitespace-pre-wrap break-words text-fg-2">
                        {item.details || "상세 설명 없음"}
                      </dd>
                    </dl>
                  </section>

                  <section aria-label="신고 시점 릴리스 증거" className="rounded-xl border border-line bg-panel p-3">
                    <h4 className="text-xs font-semibold text-fg">신고 시점 릴리스 증거</h4>
                    <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs leading-relaxed">
                      <dt className="text-fg-3">종류·라이선스</dt>
                      <dd className="text-fg-2">{item.evidence.kind} · {item.evidence.license}</dd>
                      <dt className="text-fg-3">크기</dt>
                      <dd className="text-fg-2">{formatByteSize(item.evidence.manifestByteSize)}</dd>
                      <dt className="text-fg-3">릴리스 시각</dt>
                      <dd className="text-fg-2">
                        <time dateTime={item.evidence.releaseCreatedAt}>{formatDate(item.evidence.releaseCreatedAt)}</time>
                      </dd>
                      <dt className="text-fg-3">Manifest SHA-256</dt>
                      <dd className="break-all font-mono text-[0.68rem] text-fg-2">{item.evidence.manifestHash}</dd>
                    </dl>
                  </section>
                </div>

                <div className="mt-3 rounded-xl border border-line bg-raised/35 px-3 py-2.5 text-xs leading-relaxed">
                  <p className="font-semibold text-fg">현재 상태 · {state.label}</p>
                  <p className="mt-1 text-fg-3">{state.description}</p>
                  {item.currentPackage?.availability.state === "available" ? (
                    <Link
                      href={`/market/resource/${encodeURIComponent(item.currentPackage.availability.currentHead.id)}`}
                      className="mt-1.5 inline-flex min-h-8 items-center font-semibold text-accent underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      현재 공개 상세 확인
                    </Link>
                  ) : null}
                </div>

                <div className="mt-4">
                  <label htmlFor={`market-moderation-note-${item.reportId}`} className="text-xs font-semibold text-fg-2">
                    해결 메모 (필수)
                  </label>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[0.68rem] text-fg-3">
                    <span>검수 근거와 후속 조치를 남겨 주세요.</span>
                    <span className="tabular-nums" aria-hidden>
                      {note.length}/{CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS}
                    </span>
                  </div>
                  <textarea
                    id={`market-moderation-note-${item.reportId}`}
                    value={note}
                    rows={3}
                    required
                    maxLength={CREATOR_MARKETPLACE_RESOURCE_MODERATION_NOTE_MAX_CHARACTERS}
                    onChange={(event) => {
                      setNotes((current) => ({ ...current, [item.reportId]: event.target.value }));
                      setActionError(null);
                    }}
                    placeholder="예: 권리자 증빙 확인 전 임시 숨김. 2026-09-07 재검수 예정."
                    className="mt-1.5 w-full resize-y rounded-lg border border-line bg-canvas/50 px-3 py-2.5 text-xs leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={`${item.evidence.name} 검수 액션`}>
                  <button
                    type="button"
                    disabled={targetMissing || Boolean(busyAction) || !noteValid || item.currentPackage?.moderation.state === "hidden"}
                    aria-busy={busy && busyAction?.action === "hide"}
                    onClick={(event) => void moderate(item, "hide", event.currentTarget)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-bad/40 px-3 text-xs font-semibold text-bad hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/70 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy && busyAction?.action === "hide" ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <EyeOff size={13} aria-hidden />}
                    {busy && busyAction?.action === "hide" ? "숨김 처리 중…" : "숨김"}
                  </button>
                  <button
                    type="button"
                    disabled={targetMissing || Boolean(busyAction) || !noteValid || item.currentPackage?.moderation.state !== "hidden"}
                    aria-busy={busy && busyAction?.action === "restore"}
                    onClick={(event) => void moderate(item, "restore", event.currentTarget)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-good/40 px-3 text-xs font-semibold text-good hover:bg-good/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-good/70 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy && busyAction?.action === "restore" ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <RotateCcw size={13} aria-hidden />}
                    {busy && busyAction?.action === "restore" ? "숨김 해제 중…" : "숨김 해제"}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(busyAction) || !noteValid}
                    aria-busy={busy && busyAction?.action === "dismiss"}
                    onClick={(event) => void moderate(item, "dismiss", event.currentTarget)}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busy && busyAction?.action === "dismiss" ? <LoaderCircle size={13} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <XCircle size={13} aria-hidden />}
                    {busy && busyAction?.action === "dismiss" ? "신고 기각 중…" : "신고 기각"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {page ? (
        <nav aria-label="Creator Market 신고 페이지" className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-fg-3">
            {visibleStart === 0 ? "표시 항목 없음" : `${visibleStart}–${visibleEnd}번째 열린 신고`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={loading || Boolean(busyAction) || page.offset === 0}
              onClick={() => setOffset(Math.max(0, page.offset - PAGE_SIZE))}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={14} aria-hidden /> 이전
            </button>
            <button
              type="button"
              disabled={loading || Boolean(busyAction) || !page.hasMore || page.nextOffset === null}
              onClick={() => {
                if (page.nextOffset !== null) setOffset(page.nextOffset);
              }}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line px-3 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-40"
            >
              다음 <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
