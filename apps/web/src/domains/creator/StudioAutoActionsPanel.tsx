import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Circle,
  Download,
  FileStack,
  Layers3,
  MousePointer2,
  Play,
  ScanSearch,
  Square,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type {
  StudioAutoActionCommand,
  StudioAutoActionExecutionProgress,
  StudioAutoActionPlan,
  StudioAutoActionScope,
  StudioAutoActionSet,
} from "./studio-auto-actions";

const COMMAND_LABELS: Record<StudioAutoActionCommand["type"], string> = {
  "lettering.set-font": "글꼴 통일",
  "lettering.set-size": "글자 크기 통일",
  "lettering.set-color": "글자 색 통일",
  "element.set-opacity": "요소 불투명도",
  "element.set-blend-mode": "요소 블렌드 모드",
  "element.set-hidden": "요소 표시 상태",
  "element.set-locked": "요소 잠금 상태",
  "page.set-background": "페이지 배경",
  "page.apply-grade-preset": "페이지 색보정",
};

export interface StudioAutoActionsPanelProps {
  open: boolean;
  actionSet: StudioAutoActionSet | null;
  scope: StudioAutoActionScope;
  pageOptions: readonly { id: string; label: string }[];
  selectedPageIds: readonly string[];
  plan: StudioAutoActionPlan | null;
  progress?: StudioAutoActionExecutionProgress | null;
  status?: string | null;
  busy: boolean;
  error: string | null;
  /** Macro session recording into an Auto Action set. */
  macroRecording?: boolean;
  macroCommandCount?: number;
  onStartMacroRecord?: () => void;
  onStopMacroRecord?: () => void;
  onClose: () => void;
  onScopeChange: (scope: StudioAutoActionScope) => void;
  onSelectedPageIdsChange: (pageIds: readonly string[]) => void;
  onImportJson: (json: string, fileName: string) => void | Promise<void>;
  onExportJson: () => void;
  onRequestPlan: () => void;
  onExecute: () => void;
  onCancel: () => void;
}

function scopeLabel(scope: StudioAutoActionScope): string {
  if (scope.kind === "current") return "현재 페이지";
  if (scope.kind === "selected-pages") return `선택 ${scope.pageIds.length}페이지`;
  return "전체 페이지";
}

function commandDetail(command: StudioAutoActionCommand): string {
  if (command.type === "lettering.set-font") return command.font;
  if (command.type === "lettering.set-size") return `${command.fontSize}px`;
  if (command.type === "lettering.set-color") return command.color;
  if (command.type === "element.set-opacity") return `${Math.round(command.opacity * 100)}%`;
  if (command.type === "element.set-blend-mode") return command.blendMode;
  if (command.type === "element.set-hidden") return command.hidden ? "숨김" : "표시";
  if (command.type === "element.set-locked") return command.locked ? "잠금" : "잠금 해제";
  if (command.type === "page.set-background") {
    return command.background.kind === "solid"
      ? command.background.color
      : command.background.colors.join(" → ");
  }
  return command.preset;
}

function scopeButtonClass(active: boolean): string {
  return [
    "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 text-xs font-semibold",
    "transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
    active
      ? "border-accent/55 bg-accent-soft text-accent"
      : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
  ].join(" ");
}

export function StudioAutoActionsPanel({
  open,
  actionSet,
  scope,
  pageOptions,
  selectedPageIds,
  plan,
  progress = null,
  status = null,
  busy,
  error,
  macroRecording = false,
  macroCommandCount = 0,
  onStartMacroRecord,
  onStopMacroRecord,
  onClose,
  onScopeChange,
  onSelectedPageIdsChange,
  onImportJson,
  onExportJson,
  onRequestPlan,
  onExecute,
  onCancel,
}: StudioAutoActionsPanelProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busy) onCancel();
        else onClose();
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      globalThis.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [busy, onCancel, onClose, open]);

  if (!open || typeof document === "undefined") return null;

  const hasPlanFailures = (plan?.failures.length ?? 0) > 0;
  const canExecute = Boolean(
    actionSet &&
    plan &&
    plan.targetPageIds.length > 0 &&
    plan.mutationCount > 0 &&
    !hasPlanFailures &&
    !busy
  );
  const visibleError = fileError ?? error;

  const panel = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-auto-actions-title"
      className="fixed inset-0 z-[80] bg-[oklch(0.08_0.01_70/0.82)] p-2 text-fg backdrop-blur-sm sm:p-4"
    >
      <div
        ref={dialogRef}
        className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3 sm:px-5">
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <WandSparkles size={18} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="studio-auto-actions-title" className="text-base font-bold tracking-tight text-fg">
              Auto Actions
            </h2>
            <p className="mt-0.5 max-w-[70ch] text-xs leading-relaxed text-fg-3">
              허용된 반복 명령만 페이지에 순서대로 적용합니다. 먼저 영향 범위를 확인한 뒤 한 번의 실행취소 단위로 반영하세요.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={busy ? onCancel : onClose}
            aria-label={busy ? "Auto Actions 취소" : "Auto Actions 닫기"}
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <X size={15} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <section aria-labelledby="auto-action-file-title" className="border-b border-line px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 id="auto-action-file-title" className="text-sm font-bold text-fg">
                  {actionSet?.name ?? "Action Set을 불러오세요"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-fg-3">
                  {actionSet
                    ? `${actionSet.commands.length}단계 · v${actionSet.version} · ${actionSet.description || "설명 없음"}`
                    : "JSON 파일은 명령 allowlist와 크기 제한을 통과해야 열립니다."}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (!file) return;
                    setFileError(null);
                    void file.text()
                      .then((json) => onImportJson(json, file.name))
                      .catch(() => setFileError("Action Set 파일을 읽지 못했습니다."));
                  }}
                />
                {onStartMacroRecord && onStopMacroRecord ? (
                  <button
                    type="button"
                    onClick={() => (macroRecording ? onStopMacroRecord() : onStartMacroRecord())}
                    disabled={busy}
                    aria-pressed={macroRecording}
                    className={[
                      "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45",
                      macroRecording
                        ? "border-bad/45 bg-bad/15 text-bad hover:bg-bad/25"
                        : "border-line bg-card text-fg-2 hover:bg-raised hover:text-fg",
                    ].join(" ")}
                    title={
                      macroRecording
                        ? "녹음을 멈추고 Action Set으로 저장합니다."
                        : "허용된 레이어·레터링 조작을 매크로로 녹음합니다."
                    }
                  >
                    {macroRecording ? (
                      <>
                        <Square size={13} aria-hidden /> 녹음 종료 ({macroCommandCount})
                      </>
                    ) : (
                      <>
                        <Circle size={13} className="fill-bad text-bad" aria-hidden /> 매크로 녹음
                      </>
                    )}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Upload size={13} aria-hidden /> 가져오기
                </button>
                <button
                  type="button"
                  onClick={onExportJson}
                  disabled={!actionSet || busy}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Download size={13} aria-hidden /> 내보내기
                </button>
              </div>
            </div>
            {macroRecording ? (
              <p
                role="status"
                className="mt-3 flex items-center gap-2 rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-[0.7rem] font-semibold text-bad"
              >
                <Circle size={10} className="fill-bad animate-pulse" aria-hidden />
                녹음 중 — 불투명도·표시·잠금·블렌드·글자 크기/색 변경이 Action Set에 쌓입니다 ({macroCommandCount}단계).
              </p>
            ) : null}

            {actionSet ? (
              <ol className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line" aria-label="Auto Action 명령 목록">
                {actionSet.commands.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-3 bg-card/45 px-3 py-2.5">
                    <span className="w-6 shrink-0 text-right font-display text-xs tabular-nums text-fg-3">
                      {index + 1}
                    </span>
                    <span
                      className={`size-2 shrink-0 rounded-full ${item.enabled ? "bg-good" : "bg-line-strong"}`}
                      aria-label={item.enabled ? "활성" : "비활성"}
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-xs font-semibold ${item.enabled ? "text-fg" : "text-fg-3"}`}>
                        {COMMAND_LABELS[item.type]}
                      </p>
                      <p className="mt-0.5 truncate text-[0.68rem] text-fg-3">{commandDetail(item)}</p>
                    </div>
                    <code className="hidden max-w-48 truncate text-[0.65rem] text-fg-3 sm:block">{item.id}</code>
                  </li>
                ))}
              </ol>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="mt-3 grid min-h-36 w-full place-items-center rounded-xl border border-dashed border-line bg-card/25 px-4 text-center hover:border-accent/45 hover:bg-accent-soft/10"
              >
                <span>
                  <FileStack size={24} className="mx-auto text-fg-3" aria-hidden />
                  <span className="mt-2 block text-sm font-semibold text-fg-2">반복 작업 JSON 가져오기</span>
                  <span className="mt-1 block text-xs text-fg-3">임의 스크립트는 실행되지 않습니다.</span>
                </span>
              </button>
            )}
          </section>

          <section aria-labelledby="auto-action-scope-title" className="border-b border-line px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="auto-action-scope-title" className="text-sm font-bold text-fg">적용 범위</h3>
              <span className="text-[0.68rem] text-fg-3">현재 선택: {scopeLabel(scope)}</span>
            </div>
            <div className="mt-3 flex gap-2" role="group" aria-label="Auto Actions 페이지 범위">
              <button
                type="button"
                aria-pressed={scope.kind === "current"}
                onClick={() => onScopeChange({ kind: "current" })}
                className={scopeButtonClass(scope.kind === "current")}
              >
                <MousePointer2 size={14} aria-hidden /> 현재
              </button>
              <button
                type="button"
                aria-pressed={scope.kind === "selected-pages"}
                disabled={pageOptions.length === 0}
                onClick={() => {
                  const pageIds = selectedPageIds.length > 0
                    ? [...selectedPageIds]
                    : pageOptions.slice(0, 1).map((page) => page.id);
                  onSelectedPageIdsChange(pageIds);
                  onScopeChange({ kind: "selected-pages", pageIds });
                }}
                className={`${scopeButtonClass(scope.kind === "selected-pages")} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <Layers3 size={14} aria-hidden /> 선택 {selectedPageIds.length}
              </button>
              <button
                type="button"
                aria-pressed={scope.kind === "all"}
                onClick={() => onScopeChange({ kind: "all" })}
                className={scopeButtonClass(scope.kind === "all")}
              >
                <FileStack size={14} aria-hidden /> 전체
              </button>
            </div>
            {scope.kind === "selected-pages" ? (
              <fieldset className="mt-3 rounded-xl border border-line bg-card/30 p-2">
                <legend className="px-1 text-[0.68rem] font-semibold text-fg-3">적용할 페이지</legend>
                <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
                  {pageOptions.map((page) => {
                    const checked = selectedPageIds.includes(page.id);
                    const disableLast = checked && selectedPageIds.length === 1;
                    return (
                      <label
                        key={page.id}
                        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-xs text-fg-2 hover:bg-raised focus-within:outline focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-accent"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disableLast}
                          onChange={(event) => {
                            const next = event.currentTarget.checked
                              ? [...selectedPageIds, page.id]
                              : selectedPageIds.filter((id) => id !== page.id);
                            onSelectedPageIdsChange(next);
                          }}
                          className="size-4 accent-[var(--color-accent)]"
                        />
                        <span className="min-w-0 flex-1 truncate">{page.label}</span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}
          </section>

          <section aria-labelledby="auto-action-plan-title" className="px-4 py-4 sm:px-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 id="auto-action-plan-title" className="text-sm font-bold text-fg">Dry run</h3>
                <p className="mt-0.5 text-xs text-fg-3">문서는 바꾸지 않고 영향만 계산합니다.</p>
              </div>
              <button
                type="button"
                onClick={onRequestPlan}
                disabled={!actionSet || busy}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft/20 px-3 text-xs font-semibold text-accent hover:bg-accent-soft/40 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ScanSearch size={14} aria-hidden /> 영향 다시 계산
              </button>
            </div>

            {plan ? (
              <div className="mt-3">
                <dl className="grid grid-cols-3 divide-x divide-line overflow-hidden rounded-xl border border-line bg-card/45 text-center">
                  <div className="px-2 py-3">
                    <dt className="text-[0.65rem] text-fg-3">대상</dt>
                    <dd className="mt-1 font-display text-base font-bold tabular-nums text-fg">{plan.targetPageIds.length}p</dd>
                  </div>
                  <div className="px-2 py-3">
                    <dt className="text-[0.65rem] text-fg-3">변경 페이지</dt>
                    <dd className="mt-1 font-display text-base font-bold tabular-nums text-fg">{plan.affectedPageIds.length}p</dd>
                  </div>
                  <div className="px-2 py-3">
                    <dt className="text-[0.65rem] text-fg-3">변경 요소</dt>
                    <dd className="mt-1 font-display text-base font-bold tabular-nums text-fg">{plan.affectedElementCount}</dd>
                  </div>
                </dl>

                {plan.failures.length > 0 ? (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-bad/35 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">
                    <Ban size={14} className="mt-0.5 shrink-0" aria-hidden />
                    실패 페이지 {new Set(plan.failures.map((failure) => failure.pageId)).size}개가 있어 실행을 차단했습니다.
                  </p>
                ) : (
                  <p className="mt-3 flex items-start gap-2 rounded-lg border border-good/30 bg-good/10 px-3 py-2 text-xs leading-relaxed text-good">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />
                    검증을 통과했습니다. 적용하면 호출부가 새 pages를 한 번만 commit해야 합니다.
                  </p>
                )}

                {plan.warnings.length > 0 ? (
                  <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-warn" aria-label="Dry run 경고">
                    {plan.warnings.map((warning) => (
                      <li key={warning} className="flex items-start gap-2">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {warning}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 grid min-h-32 place-items-center rounded-xl border border-dashed border-line bg-card/25 px-4 text-center">
                <p className="max-w-[60ch] text-xs leading-relaxed text-fg-3">
                  Action Set과 범위를 고른 뒤 영향 계산을 실행하세요. Dry run 없이 실제 적용 버튼은 활성화되지 않습니다.
                </p>
              </div>
            )}
          </section>

          {visibleError ? (
            <p role="alert" className="mx-4 mb-4 flex items-start gap-2 rounded-lg border border-bad/35 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad sm:mx-5">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {visibleError}
            </p>
          ) : null}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-card/35 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {status ? (
              <p role="status" className="flex max-w-[58ch] items-start gap-2 text-[0.7rem] font-semibold leading-relaxed text-good">
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden /> {status}
              </p>
            ) : (
              <p className="max-w-[58ch] text-[0.68rem] leading-relaxed text-fg-3">
                실패·취소 시 원문은 유지됩니다. 실행 직전 자동 복구 지점을 만들고, 성공 결과는 실행취소 한 단계로 반영합니다.
              </p>
            )}
            {busy && progress ? (
              <div className="mt-2" aria-live="polite">
                <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-150 motion-reduce:transition-none"
                    style={{
                      width: `${progress.totalOperations > 0
                        ? Math.min(100, Math.round((progress.completedOperations / progress.totalOperations) * 100))
                        : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[0.65rem] text-fg-3">
                  {progress.phase === "planning" ? "실행 안전성 확인" : "페이지 변환"} · {progress.completedOperations}/{progress.totalOperations}
                </p>
              </div>
            ) : null}
          </div>
          {busy ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-4 text-xs font-semibold text-warn hover:bg-warn/20"
            >
              <Ban size={14} aria-hidden /> 실행 취소
            </button>
          ) : (
            <button
              type="button"
              onClick={onExecute}
              disabled={!canExecute}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-semibold text-on-accent hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Play size={14} aria-hidden /> 한 번에 적용
            </button>
          )}
        </footer>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}
