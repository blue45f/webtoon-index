/**
 * 파괴적 명령 승인 창 — Wave E 의 preview 텍스트를 온캔버스 다이얼로그로 띄운다.
 *
 * 왜 네이티브 `confirm()` 을 버리는가: 브라우저 confirm 은 (1) 줄바꿈·강조 없이 한 덩어리로
 * 뭉개져 "무엇이 사라지는지"가 읽히지 않고, (2) 버튼이 늘 "확인/취소"라 취소가 **두 번째
 * 동작**인 명령(내보내기 분할 vs 배율 낮추기)에서 무엇을 고르는지 알 수 없으며, (3) 일부
 * 브라우저/임베드에서 아예 차단돼 fail-closed 로 아무 일도 일어나지 않는다. 셋 다
 * "사용자가 결과를 모르는" 조용한 실패다.
 *
 * 이 창은 요청 구조(`StudioDestructiveActionRequest`)를 그대로 읽어 그린다 — 문구는
 * 카탈로그가 소유하고, 여기서는 배치·포커스·키보드만 책임진다.
 */

import { AlertTriangle, Info, OctagonAlert } from "lucide-react";
import { useId, useRef, type ReactElement } from "react";
import { createPortal } from "react-dom";

import {
  studioDestructiveReversibilityHint,
  type StudioDestructiveActionRequest,
  type StudioDestructiveReversibility,
} from "./studio-destructive-action-preview";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "./studio-panel-ui";
import { STUDIO_Z_CLASS } from "./studio-z-index";
import { useStudioModalSheet } from "./useStudioModalSheet";

import { cn } from "@/shared/lib/utils";

export interface StudioDestructiveConfirmDialogProps {
  readonly request: StudioDestructiveActionRequest;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** 뒤에 대기 중인 승인 요청 수 — 0이면 표시하지 않는다. */
  readonly queuedCount?: number;
}

const TONE = Object.freeze({
  irreversible: {
    icon: OctagonAlert,
    badge: "되돌릴 수 없음",
    shell: "border-bad/40 bg-bad/10 text-bad",
    confirm: "bg-bad text-white hover:bg-bad/90",
    defaultConfirmLabel: "영구 삭제",
  },
  undoable: {
    icon: AlertTriangle,
    badge: "실행 취소 가능",
    shell: "border-warn/40 bg-warn/10 text-warn",
    confirm: "bg-accent text-on-accent hover:bg-accent-hover",
    defaultConfirmLabel: "실행",
  },
  "document-untouched": {
    icon: Info,
    badge: "문서 변경 없음",
    shell: "border-accent/35 bg-accent-soft/55 text-accent",
    confirm: "bg-accent text-on-accent hover:bg-accent-hover",
    defaultConfirmLabel: "계속",
  },
} satisfies Record<
  StudioDestructiveReversibility,
  {
    icon: typeof Info;
    badge: string;
    shell: string;
    confirm: string;
    defaultConfirmLabel: string;
  }
>);

function formatLossText(label: string, count: number | undefined): string {
  return typeof count === "number" && Number.isFinite(count)
    ? `${label} ${count}개`
    : label;
}

export function StudioDestructiveConfirmDialog({
  request,
  onConfirm,
  onCancel,
  queuedCount = 0,
}: StudioDestructiveConfirmDialogProps): ReactElement | null {
  const id = useId().replace(/:/gu, "");
  const dialogRef = useRef<HTMLElement>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const tone = TONE[request.reversibility];
  const ToneIcon = tone.icon;
  const showLosses = request.losses.length > 0 || !request.intro;
  const confirmLabel = request.confirmLabel?.trim() || tone.defaultConfirmLabel;
  const cancelLabel = request.cancelLabel?.trim() || "취소";

  useStudioModalSheet({
    activeKey: `destructive-confirm:${request.id}`,
    dialogRef,
    onDismiss: onCancel,
    resolveInitialFocus: (dialog) =>
      dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  if (typeof document === "undefined") return null;

  const content = (
    <div
      className={cn(
        "fixed inset-0 flex items-end justify-center pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:items-center sm:p-4",
        STUDIO_Z_CLASS.destructiveConfirm,
      )}
    >
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.82)] backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-studio-destructive-confirm={request.id}
        data-studio-destructive-reversibility={request.reversibility}
        data-studio-shortcut-boundary="true"
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top)))] w-full min-w-0 max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-panel pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl sm:max-h-[min(88dvh,40rem)] sm:rounded-2xl sm:pb-0"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <span
            className={cn(
              "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border",
              tone.shell,
            )}
          >
            <ToneIcon size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[0.62rem] font-bold",
                  tone.shell,
                )}
              >
                {tone.badge}
              </span>
              {queuedCount > 0 ? (
                <span className="rounded-full border border-line bg-card px-2 py-0.5 text-[0.62rem] font-semibold text-fg-3">
                  뒤에 {queuedCount}건 대기
                </span>
              ) : null}
            </p>
            <h2
              id={titleId}
              className="mt-1 break-words text-sm font-bold tracking-tight text-fg [overflow-wrap:anywhere]"
            >
              {request.title}
            </h2>
          </div>
        </header>

        <div
          id={descriptionId}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-width:thin]"
        >
          {request.intro ? (
            <p className="break-words text-xs leading-relaxed text-fg-2 [overflow-wrap:anywhere]">
              {request.intro}
            </p>
          ) : null}

          {showLosses ? (
            <section className="rounded-xl border border-line bg-card/45 p-3">
              <h3 className="text-[0.68rem] font-bold uppercase tracking-wider text-fg-3">
                사라지는 것
              </h3>
              <ul className="mt-1.5 space-y-1.5" data-studio-destructive-losses>
                {request.losses.length === 0 ? (
                  <li className="text-xs leading-relaxed text-fg-2">확인된 손실 없음</li>
                ) : (
                  request.losses.map((loss) => (
                    <li
                      key={`${loss.label}:${loss.count ?? ""}`}
                      className="break-words text-xs leading-relaxed text-fg [overflow-wrap:anywhere]"
                    >
                      <span className="font-semibold">
                        {formatLossText(loss.label, loss.count)}
                      </span>
                      {loss.note ? (
                        <span className="mt-0.5 block text-[0.68rem] font-medium text-fg-3">
                          {loss.note}
                        </span>
                      ) : null}
                    </li>
                  ))
                )}
              </ul>
            </section>
          ) : null}

          {request.gains && request.gains.length > 0 ? (
            <section className="rounded-xl border border-line bg-card/45 p-3">
              <h3 className="text-[0.68rem] font-bold uppercase tracking-wider text-fg-3">
                대신 들어오는 것
              </h3>
              <ul className="mt-1.5 space-y-1" data-studio-destructive-gains>
                {request.gains.map((gain) => (
                  <li
                    key={gain}
                    className="break-words text-xs leading-relaxed text-fg-2 [overflow-wrap:anywhere]"
                  >
                    {gain}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <p
            data-studio-destructive-reversibility-hint
            className={cn(
              "rounded-xl border px-3 py-2 text-xs font-semibold leading-relaxed",
              tone.shell,
            )}
          >
            {studioDestructiveReversibilityHint(request.reversibility)}
            {request.undoNote ? (
              <span className="mt-1 block text-[0.68rem] font-medium opacity-90">
                {request.undoNote}
              </span>
            ) : null}
          </p>
        </div>

        <footer className="grid shrink-0 grid-cols-1 gap-2 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur min-[360px]:grid-cols-2">
          <button
            type="button"
            data-autofocus="true"
            data-studio-destructive-cancel
            onClick={onCancel}
            className={cn(
              "min-h-11 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-studio-destructive-confirm-button
            onClick={onConfirm}
            className={cn(
              "min-h-11 rounded-xl px-3 text-xs font-bold",
              tone.confirm,
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
            )}
          >
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
