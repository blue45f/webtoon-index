import { creatorWorkflowIndex } from "./creator-home-navigation";

import type { CreatorHomeCopy } from "./creator-home-content";

export function CreatorWorkflowPicker({ copy, stage, onChange, placement = "preview" }: {
  copy: CreatorHomeCopy;
  stage: number;
  onChange: (stage: number) => void;
  placement?: "preview" | "process";
}) {
  return (
    <div className={placement === "preview" ? "ch-preview-options" : "ch-process-options"} role="group" aria-label={copy.tools}>
      {copy.stages.map((item, index) => (
        <button
          key={item.id}
          type="button"
          data-creator-stage={item.id}
          aria-pressed={stage === index}
          aria-controls="creator-stage-description"
          onClick={() => onChange(index)}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const next = creatorWorkflowIndex(event.key, index, copy.stages.length);
            if (next === null) return;
            event.preventDefault();
            onChange(next);
            event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus({ preventScroll: true });
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
