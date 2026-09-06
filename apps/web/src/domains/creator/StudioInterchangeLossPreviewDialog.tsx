import {
  AlertTriangle,
  Blend,
  CheckCircle2,
  ChevronDown,
  Files,
  Gauge,
  Info,
  Layers3,
  Loader2,
  OctagonX,
  Palette,
  PenLine,
  ScanLine,
  ShieldAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useId,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import {
  summarizeStudioInterchangeLoss,
  type StudioInterchangeLossCategory,
  type StudioInterchangeLossFinding,
  type StudioInterchangeLossPreviewInput,
  type StudioInterchangeLossSeverity,
} from "./studio-interchange-loss-preview";
import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
} from "./studio-panel-ui";
import { useStudioModalSheet } from "./useStudioModalSheet";

import { cn } from "@/shared/lib/utils";

export interface StudioInterchangeLossPreviewChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly recommended?: boolean;
  readonly disabled?: boolean;
}

export interface StudioInterchangeLossPreviewDialogProps {
  readonly open: boolean;
  readonly preview: StudioInterchangeLossPreviewInput;
  readonly busy?: boolean;
  readonly confirmLabel?: string;
  /** Optional controlled destination choices, e.g. new page versus current-page placement. */
  readonly choices?: readonly StudioInterchangeLossPreviewChoice[];
  readonly selectedChoiceId?: string;
  readonly onSelectedChoiceChange?: (choiceId: string) => void;
  readonly onConfirm: (selectedChoiceId: string | null) => void;
  readonly onCancel: () => void;
}

const CATEGORY_ICONS: Readonly<Record<StudioInterchangeLossCategory, LucideIcon>> = Object.freeze({
  pages: Files,
  layers: Layers3,
  resolution: ScanLine,
  alpha: Blend,
  "color-space": Palette,
  editability: PenLine,
  proxy: Gauge,
});

const SEVERITY_LABELS: Readonly<Record<StudioInterchangeLossSeverity, string>> = Object.freeze({
  neutral: "유지",
  notice: "확인",
  warning: "변경",
  critical: "중단",
});

const SEVERITY_CLASSES: Readonly<Record<StudioInterchangeLossSeverity, string>> = Object.freeze({
  neutral: "border-good/30 bg-good/10 text-good",
  notice: "border-accent/30 bg-accent-soft/55 text-accent",
  warning: "border-warn/35 bg-warn/10 text-warn",
  critical: "border-bad/35 bg-bad/10 text-bad",
});

const STATUS_CLASSES = Object.freeze({
  ready: "border-good/30 bg-good/10",
  review: "border-warn/35 bg-warn/10",
  blocked: "border-bad/35 bg-bad/10",
});

const STATUS_ICON_CLASSES = Object.freeze({
  ready: "bg-good/10 text-good",
  review: "bg-warn/10 text-warn",
  blocked: "bg-bad/10 text-bad",
});

function StatusIcon({ status }: { status: "blocked" | "ready" | "review" }): ReactElement {
  const Icon = status === "ready" ? CheckCircle2 : status === "blocked" ? OctagonX : AlertTriangle;
  return <Icon size={18} aria-hidden />;
}

function uniqueChoices(
  choices: readonly StudioInterchangeLossPreviewChoice[] | undefined,
): readonly StudioInterchangeLossPreviewChoice[] {
  if (!choices?.length) return [];
  const ids = new Set<string>();
  const result: StudioInterchangeLossPreviewChoice[] = [];
  for (const choice of choices) {
    const id = choice.id.trim();
    const label = choice.label.trim();
    if (!id || !label || ids.has(id)) continue;
    ids.add(id);
    result.push({ ...choice, id, label, description: choice.description.trim() });
  }
  return result;
}

function FindingRow({
  finding,
  detailsOpen,
}: {
  finding: StudioInterchangeLossFinding;
  detailsOpen: boolean;
}): ReactElement {
  const Icon = CATEGORY_ICONS[finding.category];
  return (
    <li
      data-loss-category={finding.category}
      data-loss-severity={finding.severity}
      data-loss-gate={finding.gate}
      className={cn(
        "flex min-w-0 items-start gap-3 rounded-xl border px-3 py-3",
        finding.gate === "blocking" ? "border-bad/35 bg-bad/5" : "border-line bg-card/45",
      )}
    >
      <span
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg border",
          SEVERITY_CLASSES[finding.severity],
        )}
      >
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h3 className="text-xs font-bold text-fg">{finding.label}</h3>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[0.62rem] font-bold",
              SEVERITY_CLASSES[finding.severity],
            )}
          >
            {SEVERITY_LABELS[finding.severity]}
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold",
              finding.gate === "blocking"
                ? "border-bad/35 bg-bad/10 text-bad"
                : "border-line bg-panel text-fg-3",
            )}
          >
            {finding.gate === "blocking" ? "진행 차단" : "안내"}
          </span>
        </div>
        <p className="mt-1 break-words text-xs leading-relaxed text-fg-2 [overflow-wrap:anywhere]">
          {finding.summary}
        </p>
        {detailsOpen ? (
          <div className="mt-2 border-t border-line/75 pt-2 text-[0.68rem] leading-relaxed text-fg-3">
            <dl className="grid grid-cols-[3.2rem_minmax(0,1fr)] gap-x-2 gap-y-1">
              <dt className="font-semibold text-fg-3">원본</dt>
              <dd className="min-w-0 break-words text-fg-2 [overflow-wrap:anywhere]">
                {finding.sourceValue}
              </dd>
              <dt className="font-semibold text-fg-3">가져온 뒤</dt>
              <dd className="min-w-0 break-words text-fg-2 [overflow-wrap:anywhere]">
                {finding.resultValue}
              </dd>
            </dl>
            <p className="mt-1.5">{finding.detail}</p>
            {finding.notes.length > 0 ? (
              <ul className="mt-1.5 space-y-1" aria-label={`${finding.label} 추가 안내`}>
                {finding.notes.map((note, index) => (
                  <li key={`${finding.category}-${index}`} className="flex items-start gap-1.5">
                    <Info size={12} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words [overflow-wrap:anywhere]">{note}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function StudioInterchangeLossPreviewDialog({
  open,
  preview,
  busy = false,
  confirmLabel = "확인하고 가져오기",
  choices,
  selectedChoiceId,
  onSelectedChoiceChange,
  onConfirm,
  onCancel,
}: StudioInterchangeLossPreviewDialogProps): ReactElement | null {
  const id = useId().replace(/:/gu, "");
  const dialogRef = useRef<HTMLElement>(null);
  const portalRootRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : document.body,
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const summary = summarizeStudioInterchangeLoss(preview);
  const visibleChoices = uniqueChoices(choices);
  const selectedChoice = visibleChoices.find(
    (choice) => choice.id === selectedChoiceId && !choice.disabled,
  ) ?? null;
  const choiceRequired = visibleChoices.length > 0;
  const selectionMissing = choiceRequired && selectedChoice === null;
  const confirmDisabled = busy || !summary.canConfirm || selectionMissing;
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const statusDescriptionId = `${id}-status-description`;
  const detailsId = `${id}-details`;
  const choicesHintId = `${id}-choices-hint`;
  const choicesErrorId = `${id}-choices-error`;
  const resolvedConfirmLabel = confirmLabel.trim() || "확인하고 가져오기";

  const dismiss = () => {
    if (!busy) onCancel();
  };

  useStudioModalSheet({
    activeKey: open ? `interchange-loss:${summary.formatLabel}:${summary.fileName}` : null,
    dialogRef,
    onDismiss: dismiss,
    resolveInitialFocus: (dialog) => dialog.querySelector<HTMLElement>("[data-autofocus='true']"),
    rootRef: portalRootRef,
  });

  if (!open || typeof document === "undefined") return null;

  const content = (
    <div className="fixed inset-0 z-[130] flex items-end justify-center pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        data-studio-modal-backdrop="true"
        onClick={dismiss}
        className="absolute inset-0 cursor-default bg-[oklch(0.08_0.01_70/0.82)] backdrop-blur-sm"
      />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${statusDescriptionId}`}
        aria-busy={busy || undefined}
        data-studio-shortcut-boundary="true"
        data-loss-preview-status={summary.status}
        tabIndex={-1}
        className="relative flex max-h-[calc(100dvh-max(0.5rem,env(safe-area-inset-top)))] w-full min-w-0 max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line-strong bg-panel pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl sm:max-h-[min(88dvh,46rem)] sm:rounded-2xl sm:pb-0"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-3 py-3 sm:px-4">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl border border-accent/30 bg-accent-soft text-accent">
            <ShieldAlert size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[0.65rem] font-bold uppercase text-accent">{summary.formatLabel} 가져오기</p>
            <h2 id={titleId} className="mt-0.5 break-words text-sm font-bold tracking-tight text-fg [overflow-wrap:anywhere]">
              변환 전 손실 확인
            </h2>
            <p id={descriptionId} className="mt-0.5 break-words text-[0.7rem] leading-relaxed text-fg-3 [overflow-wrap:anywhere]">
              <span className="font-semibold text-fg-2">{summary.fileName}</span>을 가져온 뒤 유지되는 내용을 먼저 확인하세요.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            aria-label="손실 확인 창 닫기"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl text-fg-3 hover:bg-raised hover:text-fg disabled:cursor-wait disabled:opacity-45 sm:size-10 pointer-coarse:size-11",
              STUDIO_EASE,
              STUDIO_FOCUS_RING,
            )}
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 [scrollbar-width:thin] sm:px-4 sm:py-4">
          <div
            className={cn(
              "flex items-start gap-3 rounded-xl border p-3",
              STATUS_CLASSES[summary.status],
            )}
            role={summary.status === "blocked" ? "alert" : "status"}
          >
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", STATUS_ICON_CLASSES[summary.status])}>
              <StatusIcon status={summary.status} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-fg">{summary.headline}</p>
              <p id={statusDescriptionId} className="mt-0.5 text-[0.7rem] leading-relaxed text-fg-2">
                {summary.description}
              </p>
            </div>
          </div>

          {choiceRequired ? (
            <fieldset
              className="mt-3 rounded-xl border border-line bg-card/35 p-3"
              disabled={busy}
              aria-describedby={selectionMissing ? `${choicesHintId} ${choicesErrorId}` : choicesHintId}
            >
              <legend className="px-1 text-xs font-bold text-fg">가져올 위치</legend>
              <p id={choicesHintId} className="mb-2 text-[0.68rem] leading-relaxed text-fg-3">
                원본 구조와 현재 작업 흐름에 맞는 배치 방식을 선택하세요.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {visibleChoices.map((choice) => {
                  const selected = choice.id === selectedChoiceId && !choice.disabled;
                  return (
                    <div
                      key={choice.id}
                      className={cn(
                        "relative flex min-h-14 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
                        STUDIO_EASE,
                        selected
                          ? "border-accent/60 bg-accent-soft/55 shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.12)]"
                          : "border-line bg-panel hover:border-line-strong hover:bg-raised/70",
                        (!onSelectedChoiceChange || busy || choice.disabled) &&
                          "cursor-not-allowed opacity-60",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${id}-destination`}
                        value={choice.id}
                        aria-label={`${choice.label}. ${choice.description}`}
                        aria-describedby={choicesHintId}
                        checked={selected}
                        disabled={!onSelectedChoiceChange || busy || choice.disabled}
                        onChange={() => onSelectedChoiceChange?.(choice.id)}
                        className="absolute inset-0 z-10 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      />
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border",
                          selected ? "border-accent bg-accent" : "border-line-strong bg-panel",
                        )}
                      >
                        {selected ? <span className="size-2 rounded-full bg-on-accent" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-fg">
                          {choice.label}
                          {choice.recommended ? (
                            <span className="rounded-full bg-good/10 px-2 py-0.5 text-[0.6rem] font-bold text-good">
                              권장
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block break-words text-[0.68rem] leading-relaxed text-fg-3 [overflow-wrap:anywhere]">
                          {choice.description}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              {selectionMissing ? (
                <p
                  id={choicesErrorId}
                  className="mt-2 flex items-center gap-1.5 text-[0.68rem] font-semibold text-warn"
                  role="status"
                >
                  <AlertTriangle size={13} aria-hidden /> 가져올 위치를 선택해야 계속할 수 있습니다.
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-xs font-bold text-fg">변환 항목</h3>
              <p className="mt-0.5 text-[0.68rem] text-fg-3">원본과 가져온 뒤 상태를 7개 기준으로 비교합니다.</p>
            </div>
            <button
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              onClick={() => setDetailsOpen((current) => !current)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-[0.68rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              {detailsOpen ? "세부 정보 접기" : "세부 정보 보기"}
              <ChevronDown
                size={14}
                className={cn("transition-transform motion-reduce:transition-none", detailsOpen && "rotate-180")}
                aria-hidden
              />
            </button>
          </div>

          <ol id={detailsId} className="mt-2 grid gap-2 sm:grid-cols-2" aria-label="가져오기 변환 항목">
            {summary.findings.map((finding) => (
              <FindingRow key={finding.category} finding={finding} detailsOpen={detailsOpen} />
            ))}
          </ol>
        </div>

        <footer className="shrink-0 border-t border-line bg-panel/95 px-3 py-3 backdrop-blur sm:px-4">
          {busy ? (
            <p className="mb-2 flex items-center gap-2 text-[0.68rem] font-semibold text-accent" role="status" aria-live="polite">
              <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
              파일을 안전하게 가져오는 중입니다. 필요하면 아래에서 중단할 수 있어요.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
            <button
              type="button"
              data-autofocus="true"
              onClick={() => {
                if (busy) onCancel();
                else dismiss();
              }}
              className={cn(
                "min-h-11 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              {busy ? "가져오기 중단" : "취소"}
            </button>
            <button
              type="button"
              disabled={confirmDisabled}
              aria-describedby={selectionMissing ? choicesErrorId : undefined}
              onClick={() => {
                if (!confirmDisabled) onConfirm(selectedChoice?.id ?? null);
              }}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-xs font-bold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
              )}
            >
              {busy ? <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden /> : null}
              {summary.status === "blocked" ? "먼저 문제 해결" : resolvedConfirmLabel}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );

  return createPortal(content, document.body);
}
