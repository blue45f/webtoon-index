import { CheckCircle2, MonitorCog, Save, Trash2, TriangleAlert } from "lucide-react";
import { useId } from "react";

import type { StudioCompanionWindowLayoutSurface } from "./studio-companion-window-layout";

import { cn } from "@/shared/lib/utils";

export type StudioCompanionWindowSurface = StudioCompanionWindowLayoutSurface;
export type StudioCompanionWindowLayoutPersistenceStatus =
  | "persistent"
  | "session-only"
  | "unsupported";

export interface StudioCompanionWindowLayoutControlsProps {
  surface: StudioCompanionWindowSurface;
  enabled: boolean;
  disabled: boolean;
  hasSavedLayout: boolean;
  persistenceStatus: StudioCompanionWindowLayoutPersistenceStatus;
  onEnabledChange: (enabled: boolean) => void;
  /** Optional until the companion page wires manual capture into its placement runtime. */
  onCapture?: () => void;
  onClear: () => void;
}

const SURFACE_LABELS: Readonly<Record<StudioCompanionWindowSurface, string>> = {
  workspace: "작업공간",
  navigator: "Navigator",
  review: "검수",
  reference: "레퍼런스",
};

function describePersistence(
  status: StudioCompanionWindowLayoutPersistenceStatus,
  enabled: boolean,
  hasSavedLayout: boolean
): { label: string; detail: string; warning: boolean } {
  if (status === "unsupported") {
    return {
      label: "자동 배치 미지원",
      detail: "이 브라우저에서는 창 위치 자동 복원을 지원하지 않습니다.",
      warning: true,
    };
  }

  if (status === "session-only") {
    return {
      label: "현재 세션만",
      detail: enabled
        ? "브라우저 저장이 제한되어 창을 닫기 전까지만 기억합니다."
        : "브라우저 저장이 제한되어 켜더라도 현재 세션에서만 유지됩니다.",
      warning: true,
    };
  }

  if (!enabled) {
    return {
      label: "기억 꺼짐",
      detail: "켜면 이 역할의 창 위치와 크기를 자동으로 기억합니다.",
      warning: false,
    };
  }

  if (hasSavedLayout) {
    return {
      label: "배치 저장됨",
      detail: "다음에 같은 역할의 창을 열면 저장된 배치로 복원합니다.",
      warning: false,
    };
  }

  return {
    label: "이동 후 저장",
    detail: "창을 옮기거나 크기를 바꾸면 이 역할의 배치를 기억합니다.",
    warning: false,
  };
}

export function StudioCompanionWindowLayoutControls({
  surface,
  enabled,
  disabled,
  hasSavedLayout,
  persistenceStatus,
  onEnabledChange,
  onCapture,
  onClear,
}: StudioCompanionWindowLayoutControlsProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const statusId = `${id}-status`;
  const privacyId = `${id}-privacy`;
  const surfaceLabel = SURFACE_LABELS[surface];
  const persistence = describePersistence(persistenceStatus, enabled, hasSavedLayout);
  const switchDisabled = disabled || persistenceStatus === "unsupported";
  const captureDisabled = disabled
    || !enabled
    || persistenceStatus === "unsupported"
    || !onCapture;
  const clearDisabled = disabled || !hasSavedLayout;

  return (
    <section
      aria-labelledby={titleId}
      className="min-w-0 rounded-lg border border-line/70 bg-card/70 p-2.5"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-raised text-fg-2"
        >
          <MonitorCog className="size-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id={titleId} className="min-w-0 text-xs font-semibold text-fg-2">
              {surfaceLabel} 창 배치
            </h2>
            <span
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.61rem] font-semibold leading-none",
                persistence.warning
                  ? "border-warn/35 bg-warn/10 text-warn"
                  : "border-good/35 bg-good/10 text-good"
              )}
            >
              {persistence.warning ? (
                <TriangleAlert className="size-2.5 shrink-0" aria-hidden />
              ) : (
                <CheckCircle2 className="size-2.5 shrink-0" aria-hidden />
              )}
              {persistence.label}
            </span>
          </div>
          <p id={descriptionId} className="mt-0.5 text-[0.66rem] leading-relaxed text-fg-3">
            역할마다 독립적으로 위치와 크기를 복원합니다.
          </p>
        </div>
      </div>

      <div data-layout-controls className="mt-2 grid min-w-0 grid-cols-2 gap-1.5">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-describedby={`${descriptionId} ${statusId} ${privacyId}`}
          disabled={switchDisabled}
          onClick={() => onEnabledChange(!enabled)}
          className={cn(
            "col-span-2 flex min-h-11 min-w-0 w-full items-center justify-between gap-2 rounded-lg border px-2.5 text-left outline-none",
            "transition-[border-color,background-color,color] duration-150 motion-reduce:transition-none",
            "focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
            "disabled:cursor-not-allowed disabled:opacity-45",
            enabled
              ? "border-accent/45 bg-accent-soft text-fg"
              : "border-line bg-raised text-fg-2 hover:border-line-strong hover:text-fg"
          )}
        >
          <span className="min-w-0 text-[0.68rem] font-semibold leading-tight">
            위치·크기 기억
          </span>
          <span
            aria-hidden
            className={cn(
              "flex h-6 w-10 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-150 motion-reduce:transition-none",
              enabled ? "border-accent bg-accent" : "border-line-strong bg-panel"
            )}
          >
            <span
              className={cn(
                "size-4 rounded-full shadow-sm transition-transform duration-150 motion-reduce:transition-none",
                enabled ? "translate-x-4 bg-on-accent" : "translate-x-0 bg-fg-3"
              )}
            />
          </span>
        </button>

        <button
          type="button"
          aria-describedby={`${descriptionId} ${statusId} ${privacyId}`}
          disabled={captureDisabled}
          onClick={onCapture}
          className={cn(
            "inline-flex min-h-11 min-w-0 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-2",
            "text-[0.68rem] font-semibold text-fg-2 outline-none transition-[border-color,background-color,color] duration-150",
            "hover:border-accent/40 hover:bg-accent-soft hover:text-fg motion-reduce:transition-none",
            "focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-raised disabled:hover:text-fg-2"
          )}
        >
          <Save className="size-3.5 shrink-0" aria-hidden />
          현재 위치 저장
        </button>

        <button
          type="button"
          aria-describedby={`${statusId} ${privacyId}`}
          disabled={clearDisabled}
          onClick={onClear}
          className={cn(
            "inline-flex min-h-11 min-w-0 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-raised px-2",
            "text-[0.68rem] font-semibold text-fg-2 outline-none transition-[border-color,background-color,color] duration-150",
            "hover:border-danger/40 hover:bg-danger/10 hover:text-danger motion-reduce:transition-none",
            "focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-offset-2 focus-visible:ring-offset-panel",
            "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-raised disabled:hover:text-fg-2"
          )}
        >
          <Trash2 className="size-3.5 shrink-0" aria-hidden />
          저장 배치 삭제
        </button>
      </div>

      <p
        id={statusId}
        role="status"
        aria-live="polite"
        className={cn(
          "mt-1.5 break-words text-[0.64rem] leading-relaxed",
          persistence.warning ? "text-warn" : "text-fg-3"
        )}
      >
        {persistence.detail}
      </p>
      <p id={privacyId} className="mt-0.5 break-words text-[0.61rem] leading-relaxed text-fg-3">
        창 위치·크기와 복원에 필요한 최소한의 모니터 크기·배율·상대 배치 특성만 이 기기에 저장합니다.
        모니터 이름·ID와 작품·세션·계정 정보는 저장하지 않습니다.
      </p>
    </section>
  );
}

export default StudioCompanionWindowLayoutControls;
