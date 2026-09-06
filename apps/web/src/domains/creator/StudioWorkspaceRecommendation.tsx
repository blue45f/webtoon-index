import { ArrowRight, PanelLeft } from "lucide-react";
import { useId, type MouseEventHandler, type ReactElement } from "react";

import type { ResolvedStudioWorkspaceRecommendation } from "./studio-workspace-recommendation";

import { cn } from "@/shared/lib/utils";

const focusClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/80 focus-visible:ring-offset-2 focus-visible:ring-offset-panel";

export function StudioWorkspaceRecommendation({
  recommendation,
  onSelect,
}: {
  readonly recommendation: ResolvedStudioWorkspaceRecommendation;
  readonly onSelect: MouseEventHandler<HTMLButtonElement>;
}): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const { workspace } = recommendation;

  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-testid="studio-workspace-recommendation"
      data-workspace-recommendation={recommendation.id}
      className="rounded-lg border border-accent/35 bg-accent-soft/25 p-3"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-accent/25 bg-panel text-accent">
          <PanelLeft size={17} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span id={titleId} className="block text-sm font-bold text-fg">
            {workspace.name}
          </span>
          <span
            id={descriptionId}
            className="mt-1 block text-[0.6875rem] leading-relaxed text-fg-2"
          >
            {recommendation.description}
          </span>
          <span className="mt-1 block text-[0.6875rem] text-fg-3">
            {recommendation.detail}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={onSelect}
        aria-label={`${workspace.name} 작업공간으로 전환`}
        data-workspace-recommendation-action="true"
        data-workspace-id={workspace.id}
        className={cn(
          "mt-2.5 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-accent/45 bg-panel px-3 text-xs font-bold text-accent transition-colors hover:border-accent hover:bg-accent-soft",
          "pointer-coarse:min-h-11",
          focusClass
        )}
      >
        {recommendation.actionLabel}
        <ArrowRight size={14} aria-hidden />
      </button>
    </section>
  );
}
