import * as Dialog from "@radix-ui/react-dialog";
import { CheckCircle2, Flag, LoaderCircle, X } from "lucide-react";
import { useId, useRef, useState } from "react";

import type {
  CreatorMarketplaceResourceRecord,
  CreatorMarketplaceResourceReportReason,
} from "@/shared/lib/creator-marketplace-resource-contract";

import {
  CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS,
} from "@/shared/lib/creator-marketplace-resource-contract";
import { cx } from "@/shared/lib/cx";
import { useSession } from "@/src/compat/auth-session-store";
import {
  creatorMarketplaceReportErrorCode,
  reportCreatorMarketplaceResource,
} from "@/src/infrastructure/creator-marketplace-client";

const REASON_OPTIONS: ReadonlyArray<{
  readonly value: CreatorMarketplaceResourceReportReason;
  readonly label: string;
}> = [
  { value: "copyright", label: "저작권 또는 권리 침해" },
  { value: "unsafe", label: "위험하거나 유해한 콘텐츠" },
  { value: "spam", label: "스팸 또는 무관한 리소스" },
  { value: "misleading", label: "오해를 부르는 설명" },
  { value: "other", label: "기타" },
];

type ReportableResource = Pick<
  CreatorMarketplaceResourceRecord,
  "id" | "isOwner" | "name" | "publisher" | "resourceVersion"
>;

type SubmissionState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "success" }
  | { readonly kind: "duplicate" }
  | { readonly kind: "error"; readonly message: string };

export interface CreatorMarketplaceReportActionProps {
  readonly record: ReportableResource;
  readonly className?: string;
  readonly compact?: boolean;
}

function CreatorMarketplaceReportActionState({
  record,
  className,
  compact = false,
}: CreatorMarketplaceReportActionProps) {
  const { data: session, ready, status } = useSession();
  const reasonId = useId();
  const detailsId = useId();
  const eligibilityId = useId();
  const reasonRef = useRef<HTMLSelectElement | null>(null);
  const pendingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<CreatorMarketplaceResourceReportReason | "">("");
  const [details, setDetails] = useState("");
  const [submission, setSubmission] = useState<SubmissionState>({ kind: "idle" });

  const userId = session?.user.id;
  const authenticated = ready && status === "authenticated" && Boolean(userId);
  const owner = authenticated && (record.isOwner || userId === record.publisher.id);
  const settled = submission.kind === "success" || submission.kind === "duplicate";
  const dialogAllowed = authenticated && !owner;
  const eligible = dialogAllowed && !settled;
  const pending = submission.kind === "pending";

  const eligibilityMessage = !ready
    ? "로그인 상태를 확인하고 있습니다."
    : !authenticated
      ? "로그인한 계정만 마켓 리소스를 신고할 수 있습니다."
      : owner
        ? "자신이 배포한 마켓 리소스는 신고할 수 없습니다."
        : submission.kind === "success"
          ? "신고가 접수되었습니다. 관리자 검수 전에는 공개 상태가 달라지지 않습니다."
          : submission.kind === "duplicate"
            ? "현재 패키지 릴리스 주기에서 이미 신고했습니다. 중복 신고는 새로 제출되지 않았습니다."
            : null;

  const triggerLabel = !ready
    ? "세션 확인 중"
    : !authenticated
      ? "로그인 후 신고"
      : owner
        ? "내 리소스 신고 불가"
        : submission.kind === "success"
          ? "신고 접수됨"
          : submission.kind === "duplicate"
            ? "신고 확인됨"
            : "리소스 신고";

  function requestOpenChange(nextOpen: boolean) {
    if (!nextOpen && pendingRef.current) return;
    setOpen(nextOpen && eligible);
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason || pendingRef.current || !eligible) return;
    pendingRef.current = true;
    setSubmission({ kind: "pending" });
    try {
      await reportCreatorMarketplaceResource(record.id, { reason, details });
      setSubmission({ kind: "success" });
    } catch (error) {
      const code = creatorMarketplaceReportErrorCode(error);
      if (code === "creator_marketplace_report_duplicate") {
        setSubmission({ kind: "duplicate" });
      } else {
        setSubmission({
          kind: "error",
          message: error instanceof Error && error.message
            ? error.message
            : "신고를 제출하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.",
        });
      }
    } finally {
      pendingRef.current = false;
    }
  }

  return (
    <div className={cx("min-w-0", className)}>
      <Dialog.Root open={open && dialogAllowed} onOpenChange={requestOpenChange}>
        <Dialog.Trigger asChild>
          <button
            type="button"
            disabled={!eligible}
            aria-describedby={eligibilityMessage ? eligibilityId : undefined}
            className={cx(
              "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line font-semibold text-fg-2 transition-colors hover:border-bad/40 hover:bg-bad/10 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-not-allowed disabled:opacity-55",
              compact ? "px-2.5 text-[0.58rem]" : "w-full px-3 text-xs",
            )}
          >
            <Flag size={compact ? 12 : 14} aria-hidden />
            {triggerLabel}
          </button>
        </Dialog.Trigger>

        <Dialog.Portal>
          <div role="region" aria-label={`${record.name} 신고 대화상자`}>
            <Dialog.Overlay className="fixed inset-0 z-[180] bg-[oklch(0.12_0.012_70/0.68)] backdrop-blur-sm" />
            <Dialog.Content
              aria-modal="true"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                reasonRef.current?.focus();
              }}
              onEscapeKeyDown={(event) => {
                if (pendingRef.current) event.preventDefault();
              }}
              onPointerDownOutside={(event) => {
                if (pendingRef.current) event.preventDefault();
              }}
              className="fixed left-1/2 top-1/2 z-[181] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-line-strong bg-panel p-5 shadow-2xl focus:outline-none sm:p-6"
            >
            <div className="flex items-start gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-bad/20 bg-bad/10 text-bad">
                <Flag size={18} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="font-display text-base font-bold text-fg">
                  {record.name} 신고
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs leading-relaxed text-fg-3">
                  현재 릴리스 v{record.resourceVersion}에 대한 신고입니다. 접수만으로 숨김 처리되지 않으며 관리자 검수 후 결정됩니다.
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  type="button"
                  disabled={pending}
                  aria-label="신고 창 닫기"
                  className="grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-wait disabled:opacity-45"
                >
                  <X size={18} aria-hidden />
                </button>
              </Dialog.Close>
            </div>

            {submission.kind === "success" || submission.kind === "duplicate" ? (
              <div
                role="status"
                aria-live="polite"
                className="mt-5 rounded-xl border border-good/30 bg-good/10 p-4 text-sm leading-relaxed text-good"
              >
                <p className="flex items-center gap-2 font-semibold">
                  <CheckCircle2 size={17} aria-hidden />
                  {submission.kind === "success" ? "신고가 접수되었습니다." : "현재 패키지 주기에 이미 신고했습니다."}
                </p>
                <p className="mt-1 text-xs">
                  {submission.kind === "success"
                    ? "관리자 검수 전에는 리소스 공개 상태가 달라지지 않습니다."
                    : "같은 관리자 상태와 절대 head 릴리스에 대한 중복 요청은 새 신고로 제출되지 않았습니다."}
                </p>
              </div>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={(event) => void submitReport(event)}>
                <div>
                  <label htmlFor={reasonId} className="text-xs font-semibold text-fg-2">
                    신고 사유
                  </label>
                  <select
                    ref={reasonRef}
                    id={reasonId}
                    required
                    value={reason}
                    onChange={(event) => {
                      setReason(event.target.value as CreatorMarketplaceResourceReportReason | "");
                      if (submission.kind === "error") setSubmission({ kind: "idle" });
                    }}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                  >
                    <option value="">사유를 선택해 주세요</option>
                    {REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor={detailsId} className="text-xs font-semibold text-fg-2">
                      상세 설명 (선택)
                    </label>
                    <span className="text-[0.68rem] tabular-nums text-fg-3" aria-hidden="true">
                      {details.length}/{CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS}
                    </span>
                  </div>
                  <textarea
                    id={detailsId}
                    value={details}
                    maxLength={CREATOR_MARKETPLACE_RESOURCE_REPORT_DETAILS_MAX_CHARACTERS}
                    rows={5}
                    onChange={(event) => {
                      setDetails(event.target.value);
                      if (submission.kind === "error") setSubmission({ kind: "idle" });
                    }}
                    placeholder="검수자가 확인할 위치, 권리 관계, 오해 소지가 있는 설명을 적어 주세요."
                    className="mt-1.5 w-full resize-y rounded-lg border border-line bg-card px-3 py-2.5 text-sm leading-relaxed text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
                  />
                </div>

                {submission.kind === "error" ? (
                  <p role="alert" className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
                    {submission.message} 입력한 내용은 유지되었습니다. 다시 제출할 때만 새 요청을 보냅니다.
                  </p>
                ) : null}

                <p className="text-[0.68rem] leading-relaxed text-fg-3">
                  신고 계정과 사유는 운영 검수에만 사용됩니다. 허위 또는 반복 신고는 제한될 수 있습니다.
                </p>
                <div className="flex justify-end gap-2">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      disabled={pending}
                      className="min-h-11 rounded-lg border border-line px-4 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:cursor-wait disabled:opacity-45"
                    >
                      취소
                    </button>
                  </Dialog.Close>
                  <button
                    type="submit"
                    disabled={!reason || pending}
                    aria-busy={pending}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-bad px-4 text-xs font-bold text-on-accent hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/70 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {pending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
                    {pending
                      ? "신고 제출 중…"
                      : submission.kind === "error"
                        ? "다시 제출"
                        : "신고 제출"}
                  </button>
                </div>
              </form>
            )}

            {submission.kind === "success" || submission.kind === "duplicate" ? (
              <div className="mt-5 flex justify-end">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="min-h-11 rounded-lg border border-line px-4 text-xs font-semibold text-fg-2 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  >
                    확인
                  </button>
                </Dialog.Close>
              </div>
            ) : null}
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {eligibilityMessage ? (
        <p
          id={eligibilityId}
          role={settled ? "status" : undefined}
          aria-live={settled ? "polite" : undefined}
          className={cx(
            "mt-1.5 leading-relaxed text-fg-3",
            compact ? "text-[0.52rem]" : "text-center text-[0.68rem]",
          )}
        >
          {eligibilityMessage}
        </p>
      ) : null}
    </div>
  );
}

export function CreatorMarketplaceReportAction(
  props: CreatorMarketplaceReportActionProps,
) {
  return <CreatorMarketplaceReportActionState key={props.record.id} {...props} />;
}
