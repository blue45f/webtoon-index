import { AlertTriangle, ChevronDown, ListOrdered, Replace, Tag } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { planStudioBatchRename } from "./studio-batch-rename";
import { isEffectivelyLocked } from "./studio-layers";

import type {
  StudioBatchRenameMode,
  StudioBatchRenameOrder,
} from "./studio-batch-rename";
import type { El } from "./studio-element-model";
import type { LayerGroup } from "./studio-layers";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

const inputClass =
  "min-h-11 min-w-0 rounded-lg border border-line bg-card px-2 text-xs font-semibold text-fg outline-none placeholder:text-fg-3 focus-visible:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent lg:min-h-9 pointer-coarse:min-h-11";

export interface StudioInspectorBatchRenameSectionProps {
  readonly elements: readonly El[];
  readonly selectedIds: readonly string[];
  readonly groups: LayerGroup[];
  readonly commit: (next: El[]) => boolean;
  readonly announce: (message: string) => void;
}

/** Atomic Figma-style batch rename with preview, stable ordering and explicit fail-closed reasons. */
export function StudioInspectorBatchRenameSection({
  elements,
  selectedIds,
  groups,
  commit,
  announce,
}: StudioInspectorBatchRenameSectionProps) {
  const panelId = useId();
  const statusId = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<StudioBatchRenameMode>("template");
  const [template, setTemplate] = useState("{type} {n}");
  const [search, setSearch] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [order, setOrder] = useState<StudioBatchRenameOrder>("layer-top");
  const [start, setStart] = useState(1);
  const [step, setStep] = useState(1);
  const [digits, setDigits] = useState(2);
  const [status, setStatus] = useState<string | null>(null);

  const plan = useMemo(
    () =>
      planStudioBatchRename(
        elements,
        selectedIds,
        {
          mode,
          template,
          search,
          replacement,
          caseSensitive,
          order,
          start,
          step,
          digits,
        },
        { isLocked: (element) => isEffectivelyLocked(element, groups) },
      ),
    [
      caseSensitive,
      digits,
      elements,
      groups,
      mode,
      order,
      replacement,
      search,
      selectedIds,
      start,
      step,
      template,
    ],
  );
  const preview = plan.previews.slice(0, 5);
  const remainingPreviewCount = Math.max(0, plan.previews.length - preview.length);
  const planReason = plan.kind === "changed" ? null : plan.reason;

  function applyRename() {
    if (plan.kind !== "changed") {
      setStatus(plan.reason);
      return;
    }
    if (!commit(plan.next)) {
      setStatus("현재 문서 상태에서는 이름을 변경할 수 없어요.");
      return;
    }
    setStatus(`${plan.announcement} 완료`);
    announce(plan.announcement);
  }

  return (
    <section
      data-studio-inspector-batch-rename="true"
      data-inspector-section="selection.batch-rename"
      data-inspector-section-open={open ? "true" : "false"}
      className="mt-3 rounded-lg border border-line/70 bg-canvas/35"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
          setStatus(null);
        }}
        data-inspector-control-id="selection.rename.toggle"
        data-inspector-priority="chrome"
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:min-h-9 pointer-coarse:min-h-11"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Tag size={14} className="shrink-0 text-accent" aria-hidden />
          <span className="min-w-0">
            <span className="block text-xs font-bold text-fg">일괄 이름 변경</span>
            <span className="block truncate text-[0.6875rem] font-medium text-fg-3">
              미리보기 후 {selectedIds.length}개를 한 번에 적용
            </span>
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      <div id={panelId} hidden={!open}>
        {open ? (
          <div className="space-y-2 border-t border-line/60 p-2.5">
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="이름 변경 방식">
              <button
                type="button"
                aria-pressed={mode === "template"}
                onClick={() => {
                  setMode("template");
                  setStatus(null);
                }}
                data-inspector-control-id="selection.rename.mode-template"
                data-inspector-priority="advanced"
                className={buttonClass({
                  size: "sm",
                  variant: mode === "template" ? "solid" : "quiet",
                  className: "min-h-11 gap-1.5 pointer-coarse:min-h-11 lg:min-h-9",
                })}
              >
                <ListOrdered size={14} aria-hidden /> 형식·번호
              </button>
              <button
                type="button"
                aria-pressed={mode === "replace"}
                onClick={() => {
                  setMode("replace");
                  setStatus(null);
                }}
                data-inspector-control-id="selection.rename.mode-replace"
                data-inspector-priority="advanced"
                className={buttonClass({
                  size: "sm",
                  variant: mode === "replace" ? "solid" : "quiet",
                  className: "min-h-11 gap-1.5 pointer-coarse:min-h-11 lg:min-h-9",
                })}
              >
                <Replace size={14} aria-hidden /> 찾기·바꾸기
              </button>
            </div>

            {mode === "template" ? (
              <>
                <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                  이름 형식
                  <input
                    type="text"
                    value={template}
                    maxLength={240}
                    aria-describedby={statusId}
                    onChange={(event) => {
                      setTemplate(event.currentTarget.value);
                      setStatus(null);
                    }}
                    data-inspector-control-id="selection.rename.template"
                    data-inspector-priority="advanced"
                    className={inputClass}
                  />
                </label>
                <p className="text-[0.6875rem] leading-relaxed text-fg-3">
                  <code>{"{n}"}</code> 번호 · <code>{"{type}"}</code> 요소 유형 · <code>{"{name}"}</code> 현재 이름
                </p>
                <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                  번호 순서
                  <select
                    value={order}
                    onChange={(event) => {
                      setOrder(event.currentTarget.value as StudioBatchRenameOrder);
                      setStatus(null);
                    }}
                    data-inspector-control-id="selection.rename.order"
                    data-inspector-priority="advanced"
                    className={inputClass}
                  >
                    <option value="layer-top">레이어 위에서 아래</option>
                    <option value="layer-bottom">레이어 아래에서 위</option>
                    <option value="canvas-top">캔버스 위에서 아래</option>
                    <option value="canvas-left">캔버스 왼쪽에서 오른쪽</option>
                  </select>
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                    시작
                    <input
                      type="number"
                      inputMode="numeric"
                      value={start}
                      onChange={(event) => {
                        setStart(Number(event.currentTarget.value));
                        setStatus(null);
                      }}
                      data-inspector-control-id="selection.rename.start"
                      data-inspector-priority="advanced"
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                    증가
                    <input
                      type="number"
                      inputMode="numeric"
                      value={step}
                      onChange={(event) => {
                        setStep(Number(event.currentTarget.value));
                        setStatus(null);
                      }}
                      data-inspector-control-id="selection.rename.step"
                      data-inspector-priority="advanced"
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                    자릿수
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={6}
                      value={digits}
                      onChange={(event) => {
                        setDigits(Number(event.currentTarget.value));
                        setStatus(null);
                      }}
                      data-inspector-control-id="selection.rename.digits"
                      data-inspector-priority="advanced"
                      className={inputClass}
                    />
                  </label>
                </div>
              </>
            ) : (
              <>
                <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                  찾을 문자열
                  <input
                    type="text"
                    value={search}
                    maxLength={160}
                    onChange={(event) => {
                      setSearch(event.currentTarget.value);
                      setStatus(null);
                    }}
                    data-inspector-control-id="selection.rename.search"
                    data-inspector-priority="advanced"
                    className={inputClass}
                  />
                </label>
                <label className="grid gap-1 text-[0.6875rem] font-bold text-fg-3">
                  바꿀 문자열
                  <input
                    type="text"
                    value={replacement}
                    maxLength={160}
                    onChange={(event) => {
                      setReplacement(event.currentTarget.value);
                      setStatus(null);
                    }}
                    data-inspector-control-id="selection.rename.replacement"
                    data-inspector-priority="advanced"
                    className={inputClass}
                  />
                </label>
                <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line bg-card px-2 text-xs font-semibold text-fg pointer-coarse:min-h-11 lg:min-h-9">
                  <input
                    type="checkbox"
                    checked={caseSensitive}
                    onChange={(event) => {
                      setCaseSensitive(event.currentTarget.checked);
                      setStatus(null);
                    }}
                    data-inspector-control-id="selection.rename.case-sensitive"
                    data-inspector-priority="advanced"
                    className="size-4 accent-accent"
                  />
                  대소문자 구분
                </label>
              </>
            )}

            <div className="rounded-lg border border-line/70 bg-card/70 p-2" aria-label="이름 변경 미리보기">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[0.6875rem] font-bold text-fg">미리보기</p>
                <span className="text-[0.6875rem] font-semibold tabular-nums text-fg-3">
                  {plan.previews.length}개
                </span>
              </div>
              {preview.length > 0 ? (
                <ol className="space-y-1">
                  {preview.map((item) => (
                    <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 text-[0.6875rem]">
                      <span className="truncate text-fg-3" title={item.currentName}>{item.currentName}</span>
                      <span aria-hidden className="text-fg-3">→</span>
                      <span className="truncate font-semibold text-fg" title={item.nextName}>{item.nextName || "(빈 이름)"}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[0.6875rem] leading-relaxed text-fg-3">입력하면 변경될 이름을 먼저 보여 줍니다.</p>
              )}
              {remainingPreviewCount > 0 ? (
                <p className="mt-1 text-[0.6875rem] font-medium text-fg-3">외 {remainingPreviewCount}개</p>
              ) : null}
            </div>

            {plan.kind === "changed" && plan.duplicateNames.length > 0 ? (
              <p className="flex items-start gap-1.5 rounded-lg bg-warn/10 px-2 py-1.5 text-[0.6875rem] leading-relaxed text-warn">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                같은 이름 {plan.duplicateNames.length}건이 생깁니다. 레이어 이름 중복은 허용되지만 구분이 어려울 수 있어요.
              </p>
            ) : null}

            <p id={statusId} aria-live="polite" className="min-h-4 text-[0.6875rem] leading-relaxed text-fg-3">
              {status ?? planReason ?? "미리보기를 확인한 뒤 한 번에 적용합니다."}
            </p>

            <button
              type="button"
              disabled={plan.kind !== "changed"}
              onClick={applyRename}
              aria-describedby={statusId}
              data-inspector-control-id="selection.rename.apply"
              data-inspector-priority="essential"
              className={buttonClass({
                size: "md",
                variant: "solid",
                className: "min-h-11 w-full justify-center pointer-coarse:min-h-11",
              })}
            >
              {selectedIds.length}개 이름 적용
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
