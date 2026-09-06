import { ListFilter, MousePointer2 } from "lucide-react";
import { useId, useState } from "react";

import type {
  StudioSelectMatchingCriterion,
  StudioSelectMatchingOption,
} from "./studio-select-matching";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export interface StudioSelectionMatchingPanelProps {
  readonly options: readonly StudioSelectMatchingOption[];
  readonly onSelect: (criterion: StudioSelectMatchingCriterion) => void;
  readonly className?: string;
}

/**
 * Compact Figma-style "Select all with same…" surface.
 *
 * Selection is navigation, not a document mutation, so this remains available while review or
 * collaboration locks make the property controls read-only. The parent supplies only visible
 * page candidates; hidden layers can therefore never appear selected without a visible cause.
 */
export function StudioSelectionMatchingPanel({
  options,
  onSelect,
  className,
}: StudioSelectionMatchingPanelProps) {
  const selectId = useId();
  const descriptionId = useId();
  const [preferredCriterion, setPreferredCriterion] =
    useState<StudioSelectMatchingCriterion | null>(null);
  const activeOption =
    options.find((option) => option.criterion === preferredCriterion) ?? options[0];

  if (!activeOption) return null;

  return (
    <section
      aria-label="같은 항목 선택"
      data-studio-selection-matching-panel="true"
      data-inspector-section="selection.matching"
      data-inspector-section-open="true"
      className={cn(
        "rounded-xl border border-line/80 bg-panel/50 p-2.5 shadow-[inset_0_1px_0_oklch(0.98_0.01_85/0.04)]",
        className,
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-accent/25 bg-accent-soft/35 text-accent"
        >
          <ListFilter size={14} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold tracking-tight text-fg">같은 항목 선택</p>
          <p className="mt-0.5 text-[0.6875rem] font-medium leading-relaxed text-fg-3">
            현재 페이지의 표시 레이어에서 같은 속성을 한 번에 찾습니다.
          </p>
        </div>
      </div>

      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5">
        <label htmlFor={selectId} className="sr-only">
          같은 항목 선택 기준
        </label>
        <select
          id={selectId}
          aria-label="같은 항목 선택 기준"
          aria-describedby={descriptionId}
          data-inspector-control-id="selection.matching.criterion"
          data-inspector-priority="contextual"
          value={activeOption.criterion}
          onChange={(event) =>
            setPreferredCriterion(event.currentTarget.value as StudioSelectMatchingCriterion)
          }
          className={cn(
            "min-h-11 min-w-0 rounded-lg border border-line bg-card px-2 text-xs font-semibold text-fg outline-none",
            "focus-visible:border-accent/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
            "lg:min-h-9 pointer-coarse:min-h-11",
          )}
        >
          {options.map((option) => (
            <option key={option.criterion} value={option.criterion}>
              {option.label} · {option.count}개
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onSelect(activeOption.criterion)}
          aria-label={`${activeOption.label} ${activeOption.count}개 전체 선택`}
          aria-describedby={descriptionId}
          data-studio-select-matching-action={activeOption.criterion}
          data-inspector-control-id="selection.matching.select"
          data-inspector-priority="contextual"
          className={buttonClass({
            size: "md",
            variant: "quiet",
            className: "min-h-11 gap-1.5 whitespace-nowrap px-2.5 lg:min-h-9 pointer-coarse:min-h-11",
          })}
        >
          <MousePointer2 size={14} aria-hidden />
          전체 선택
        </button>
      </div>

      <p
        id={descriptionId}
        aria-live="polite"
        className="mt-1.5 text-[0.6875rem] font-medium leading-relaxed text-fg-3"
      >
        {activeOption.description}
      </p>
    </section>
  );
}
