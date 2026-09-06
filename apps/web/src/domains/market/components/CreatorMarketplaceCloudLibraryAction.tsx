import { Archive, ArchiveRestore, Cloud, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  CreatorMarketplaceAcquisitionTarget,
  CreatorMarketplaceCloudLibraryItem,
  CreatorMarketplaceCloudLibraryMembership,
} from "@/shared/lib/creator-marketplace-cloud-library-contract";
import type { CreatorMarketplaceResourceRecord } from "@/shared/lib/creator-marketplace-resource-contract";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { creatorMarketplaceStudioPackId } from "@/shared/lib/creator-marketplace-package-identity";
import { useSession } from "@/src/compat/auth-session-store";
import {
  acquireCreatorMarketplaceCloudLibraryRelease,
  listCreatorMarketplaceCloudLibrary,
  resolveCreatorMarketplaceCloudLibraryAcquisitionTarget,
  setCreatorMarketplaceCloudLibraryArchived,
} from "@/src/infrastructure/creator-marketplace-client";

interface ReceiptSnapshot {
  readonly libraryItemId: string;
  readonly membership: CreatorMarketplaceCloudLibraryMembership;
}

interface FocusRestoreRequest {
  readonly recordId: string;
  readonly logicalPackId: string;
  readonly origin: HTMLButtonElement;
  readonly target: "action" | "retry";
}

type LibraryLoadState = "idle" | "loading" | "ready" | "error";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function catalogStatus(item: CreatorMarketplaceCloudLibraryItem): string {
  if (item.catalog.state === "unavailable") {
    const reason = {
      moderated: "관리자 검수로 현재 카탈로그에서 숨겨짐",
      "owner-delisted": "배급자가 현재 공개 목록에서 내림",
      "publisher-unavailable": "배급자 계정을 사용할 수 없음",
      removed: "현재 카탈로그에서 제거됨",
    }[item.catalog.reason];
    return `카탈로그 사용 불가 · ${reason}`;
  }
  if (item.updateState === "account-confirmed-update-available") {
    return `계정 설치 확인 v${item.confirmation.state === "confirmed"
      ? item.confirmation.resourceVersion
      : "?"} · 현재 v${item.catalog.head.resourceVersion} 업데이트 가능`;
  }
  if (item.updateState === "account-confirmed-current-head") {
    return `계정에 Studio v${item.catalog.head.resourceVersion} 설치 확인됨`;
  }
  return "이 계정에서 확인된 Studio 설치 없음";
}

export function CreatorMarketplaceCloudLibraryAction({
  record,
  compact = false,
  onChanged,
}: {
  readonly record: CreatorMarketplaceResourceRecord;
  readonly compact?: boolean;
  readonly onChanged?: () => void;
}) {
  const { data: session, ready, status: sessionStatus } = useSession();
  const authenticated = ready && sessionStatus === "authenticated";
  const userId = authenticated ? session.user.id : null;
  const logicalPackId = creatorMarketplaceStudioPackId(record);
  const [loadState, setLoadState] = useState<LibraryLoadState>("idle");
  const [item, setItem] = useState<CreatorMarketplaceCloudLibraryItem | null>(null);
  const [acquisitionTarget, setAcquisitionTarget] =
    useState<CreatorMarketplaceAcquisitionTarget | null>(null);
  const [receipt, setReceipt] = useState<ReceiptSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const actionButtonRef = useRef<HTMLButtonElement | null>(null);
  const retryButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusRestoreRef = useRef<FocusRestoreRequest | null>(null);

  const refresh = useCallback(() => {
    const retryButton = retryButtonRef.current;
    if (retryButton && document.activeElement === retryButton) {
      focusRestoreRef.current = {
        recordId: record.id,
        logicalPackId,
        origin: retryButton,
        target: "action",
      };
    }
    setReloadToken((value) => value + 1);
  }, [logicalPackId, record.id]);

  useEffect(() => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setItem(null);
    setAcquisitionTarget(null);
    setReceipt(null);
    setError(null);
    setMessage(null);
    setPending(false);
    if (!ready || !authenticated || !userId) {
      setLoadState("idle");
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    const isCurrent = () => (
      !controller.signal.aborted && generationRef.current === generation
    );
    setLoadState("loading");
    void (async () => {
      const page = await listCreatorMarketplaceCloudLibrary({
        view: "all",
        limit: 2,
        logicalPackId,
      }, controller.signal);
      if (!isCurrent()) return;
      if (
        page.items.length > 1
        || page.items.some((candidate) => candidate.logicalPackId !== logicalPackId)
      ) {
        throw new Error("계정 라이브러리 패키지 식별자가 일치하지 않습니다.");
      }
      const nextItem = page.items[0] ?? null;
      let nextTarget: CreatorMarketplaceAcquisitionTarget | null = null;
      if (!nextItem) {
        nextTarget = await resolveCreatorMarketplaceCloudLibraryAcquisitionTarget(
          record.id,
          controller.signal,
        );
        if (!isCurrent()) return;
        if (
          nextTarget.requestReleaseId !== record.id
          || nextTarget.publisherId !== record.publisher.id
          || nextTarget.packageId !== record.packageId
          || nextTarget.kind !== record.kind
          || nextTarget.logicalPackId !== logicalPackId
        ) {
          throw new Error("현재 획득 대상의 패키지 식별자가 상세 릴리스와 일치하지 않습니다.");
        }
      }
      setItem(nextItem);
      setAcquisitionTarget(nextTarget);
      setLoadState("ready");
    })()
      .catch((caught: unknown) => {
        if (!isCurrent()) return;
        setLoadState("error");
        setError(errorMessage(caught, "계정 라이브러리 상태를 확인하지 못했습니다."));
        if (
          focusRestoreRef.current?.recordId === record.id
          && focusRestoreRef.current.logicalPackId === logicalPackId
        ) {
          focusRestoreRef.current = {
            ...focusRestoreRef.current,
            target: "retry",
          };
        }
      });
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
      if (generationRef.current === generation) generationRef.current += 1;
    };
  }, [
    authenticated,
    logicalPackId,
    ready,
    record.id,
    record.kind,
    record.packageId,
    record.publisher.id,
    reloadToken,
    userId,
  ]);

  const effective = item
    ? { libraryItemId: item.id, membership: item.membership }
    : receipt;

  useEffect(() => {
    const request = focusRestoreRef.current;
    if (!request || pending) return;
    if (request.recordId !== record.id || request.logicalPackId !== logicalPackId) {
      focusRestoreRef.current = null;
      return;
    }
    if (request.target === "action" && loadState !== "ready") return;
    if (request.target === "retry" && loadState !== "error") return;

    const target = request.target === "retry"
      ? retryButtonRef.current
      : actionButtonRef.current;
    if (!target?.isConnected || target.disabled) return;

    const active = document.activeElement;
    if (active === target) {
      focusRestoreRef.current = null;
      return;
    }
    if (
      active === null
      || active === document.body
      || active === document.documentElement
      || active === request.origin
    ) {
      target.focus();
    }
    focusRestoreRef.current = null;
  }, [loadState, logicalPackId, pending, record.id]);

  async function mutateLibrary(): Promise<void> {
    if (!authenticated || pending || loadState === "loading") return;
    const actionButton = actionButtonRef.current;
    focusRestoreRef.current = actionButton && document.activeElement === actionButton
      ? {
          recordId: record.id,
          logicalPackId,
          origin: actionButton,
          target: "action",
        }
      : null;
    const generation = generationRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      if (!effective) {
        if (!acquisitionTarget || acquisitionTarget.state !== "available") return;
        const next = await acquireCreatorMarketplaceCloudLibraryRelease(
          acquisitionTarget.currentHead.id,
          controller.signal,
        );
        if (controller.signal.aborted || generationRef.current !== generation) return;
        if (next.logicalPackId !== logicalPackId) {
          throw new Error("획득된 계정 라이브러리 패키지 식별자가 일치하지 않습니다.");
        }
        setReceipt({
          libraryItemId: next.libraryItemId,
          membership: next.membership,
        });
        const historical = acquisitionTarget.currentHead.id !== record.id;
        setMessage(next.changed
          ? historical
            ? `현재 v${acquisitionTarget.currentHead.resourceVersion}을 이 계정의 마켓 라이브러리에 추가했습니다.`
            : "이 계정의 마켓 라이브러리에 추가했습니다."
          : "이미 이 계정의 마켓 라이브러리에 있습니다.");
      } else {
        const archived = effective.membership === "active";
        const next = await setCreatorMarketplaceCloudLibraryArchived(
          effective.libraryItemId,
          archived,
          controller.signal,
        );
        if (controller.signal.aborted || generationRef.current !== generation) return;
        setReceipt({
          libraryItemId: next.libraryItemId,
          membership: next.membership,
        });
        setItem((current) => current ? {
          ...current,
          membership: next.membership,
          archivedAt: next.membership === "archived" ? next.updatedAt : null,
        } : current);
        setMessage(next.changed
          ? archived
            ? "계정 라이브러리에서 보관했습니다. 로컬 설치는 제거하지 않았습니다."
            : "계정 라이브러리의 활성 목록으로 복원했습니다."
          : archived
            ? "이미 계정 라이브러리에 보관되어 있습니다."
            : "이미 계정 라이브러리의 활성 목록에 있습니다.");
      }
      setLoadState("ready");
      onChanged?.();
    } catch (caught: unknown) {
      if (controller.signal.aborted || generationRef.current !== generation) return;
      if (!effective) {
        setAcquisitionTarget(null);
        setLoadState("error");
        if (focusRestoreRef.current) {
          focusRestoreRef.current = {
            ...focusRestoreRef.current,
            target: "retry",
          };
        }
      }
      setError(errorMessage(caught, "계정 라이브러리 상태를 변경하지 못했습니다."));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (!controller.signal.aborted && generationRef.current === generation) {
        setPending(false);
      }
    }
  }

  if (!ready) {
    return (
      <div role="status" className="rounded-lg border border-line bg-panel px-3 py-2.5 text-xs text-fg-2">
        <LoaderCircle className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        계정 라이브러리 세션 확인 중
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="rounded-lg border border-line bg-panel px-3 py-2.5 text-left">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <Cloud className="h-3.5 w-3.5 text-fg-3" aria-hidden="true" />
          로그인 후 계정 라이브러리 사용
        </p>
        {!compact ? (
          <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
            계정 라이브러리는 기기별 설치와 별개이며, 로그인한 계정에서만 동기화됩니다.
          </p>
        ) : null}
      </div>
    );
  }

  const actionLabel = !effective
    ? acquisitionTarget?.state === "available"
      && acquisitionTarget.currentHead.id !== record.id
      ? `현재 v${acquisitionTarget.currentHead.resourceVersion} 라이브러리에 추가`
      : "계정 라이브러리에 추가"
    : effective.membership === "active"
      ? "계정 라이브러리에 보관"
      : "계정 라이브러리로 복원";
  const ActionIcon = !effective
    ? Cloud
    : effective.membership === "active"
      ? Archive
      : ArchiveRestore;

  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2.5 text-left">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-fg">
        <Cloud className="h-3.5 w-3.5 text-cool" aria-hidden="true" />
        {!effective
          ? loadState === "loading"
            ? "계정 라이브러리 확인 중"
            : "계정 라이브러리에 없음"
          : effective.membership === "active"
            ? "계정 라이브러리 · 활성"
            : "계정 라이브러리 · 보관됨"}
      </p>
      {item && !compact ? (
        <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
          {catalogStatus(item)}. 이 표시는 계정 이력이며 현재 기기의 설치 증명이 아닙니다.
        </p>
      ) : acquisitionTarget?.state === "unavailable" && !compact ? (
        <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
          {{
            moderated: "관리자 검수로 현재 패키지를 계정 라이브러리에 추가할 수 없습니다.",
            "owner-delisted": "배급자가 현재 패키지를 내려 계정 라이브러리에 추가할 수 없습니다.",
            "publisher-unavailable": "현재 활동 중인 배급자의 패키지만 계정 라이브러리에 추가할 수 있습니다.",
          }[acquisitionTarget.reason]}
        </p>
      ) : acquisitionTarget?.state === "available"
        && acquisitionTarget.currentHead.id !== record.id
        && !compact ? (
        <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
          선택한 릴리스는 과거 버전입니다. 계정 라이브러리에는 현재 v{acquisitionTarget.currentHead.resourceVersion}을 추가합니다.
        </p>
      ) : !compact ? (
        <p className="mt-1 text-[0.68rem] leading-relaxed text-fg-3">
          계정 멤버십과 이 기기·브라우저의 실제 설치는 서로 독립적으로 관리됩니다.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="mt-2 rounded-md border border-bad/25 bg-bad/10 px-2 py-1.5 text-[0.68rem] leading-relaxed text-bad">
          {error}
          <button
            ref={retryButtonRef}
            type="button"
            onClick={refresh}
            className="ml-1 inline-flex min-h-8 items-center gap-1 rounded px-1.5 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            다시 확인
          </button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="mt-2 text-[0.68rem] leading-relaxed text-good">
          {message}
        </p>
      ) : null}
      <button
        ref={actionButtonRef}
        type="button"
        onClick={() => void mutateLibrary()}
        disabled={
          pending
          || loadState === "loading"
          || loadState === "error"
          || (!effective && acquisitionTarget?.state !== "available")
        }
        className={buttonClass({
          variant: effective?.membership === "active" ? "ghost" : "outline",
          size: "sm",
          className: "mt-2 w-full",
        })}
      >
        {pending || loadState === "loading" ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <ActionIcon className="h-3.5 w-3.5" aria-hidden="true" />
        )}
        {pending ? "계정 라이브러리 변경 중" : actionLabel}
      </button>
    </div>
  );
}
