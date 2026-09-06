import { Suspense, useState } from "react";

import { studioColorPopoverTriggerHint } from "./studio-color-popover-hints";
import {
  StudioColorPopoverContent,
  preloadStudioColorPopover,
} from "./studio-page-lazy-ui";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioColorPopoverProps } from "./StudioColorPopover";

export type LazyStudioColorPopoverProps = Omit<
  StudioColorPopoverProps,
  "initialOpen"
> & {
  onLoadRecentColors?: () => void;
};

function StudioColorPopoverFallback({
  value,
  label = "색상 선택",
  purpose = "generic",
  className,
  onWarm,
  onActivate,
  busy = false,
}: Pick<LazyStudioColorPopoverProps, "value" | "label" | "purpose" | "className"> & {
  onWarm?: () => void;
  onActivate?: () => void;
  busy?: boolean;
}) {
  const warm = () => {
    preloadStudioColorPopover();
    onWarm?.();
  };

  return (
    <span className={className ? `relative inline-block ${className}` : "relative inline-block"}>
      <StudioToolHintTarget
        hint={studioColorPopoverTriggerHint(label, purpose)}
        preferredSide="bottom"
      >
        <button
          type="button"
          aria-label={label}
          aria-expanded={false}
          aria-busy={busy || undefined}
          onClick={onActivate}
          onFocus={warm}
          onMouseEnter={warm}
          className="h-7 w-7 cursor-pointer rounded border border-line pointer-coarse:size-11"
          style={{ background: value }}
        />
      </StudioToolHintTarget>
    </span>
  );
}

export function LazyStudioColorPopover({
  onLoadRecentColors,
  ...props
}: LazyStudioColorPopoverProps) {
  const [activated, setActivated] = useState(false);
  const activate = () => {
    onLoadRecentColors?.();
    setActivated(true);
  };

  if (!activated) {
    return (
      <StudioColorPopoverFallback
        {...props}
        onWarm={onLoadRecentColors}
        onActivate={activate}
      />
    );
  }

  return (
    <Suspense fallback={<StudioColorPopoverFallback {...props} busy />}>
      <StudioColorPopoverContent {...props} initialOpen />
    </Suspense>
  );
}
