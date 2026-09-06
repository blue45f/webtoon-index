import { useId, type ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

interface StudioThreeDToggleIndicatorProps {
  readonly checked: boolean;
}

/**
 * Shared visual authority for binary controls across the Studio 3D surfaces.
 * The explicit left/top origin and integer 20px travel keep the thumb centered
 * at both ends instead of relying on the browser's static-position fallback.
 */
export function StudioThreeDToggleIndicator({
  checked,
}: StudioThreeDToggleIndicatorProps) {
  return (
    <span
      aria-hidden="true"
      data-studio-three-d-toggle-indicator="true"
      data-state={checked ? "on" : "off"}
      className={cn(
        "relative block h-6 w-11 shrink-0 rounded-full border transition-colors duration-150 motion-reduce:transition-none",
        checked ? "border-accent bg-accent" : "border-line-strong bg-raised",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 size-5 rounded-full shadow-sm transition-[transform,background-color] duration-150 motion-reduce:transition-none",
          checked ? "translate-x-5 bg-on-accent" : "translate-x-0 bg-fg-2",
        )}
      />
    </span>
  );
}

interface StudioThreeDToggleControlProps {
  readonly checked: boolean;
  readonly label: ReactNode;
  readonly onChange: (checked: boolean) => void;
  readonly className?: string;
  readonly description?: ReactNode;
  readonly descriptionClassName?: string;
  readonly disabled?: boolean;
  readonly labelClassName?: string;
}

/**
 * Accessible switch shell with stable narrow-panel behavior. Labels may wrap,
 * but the switch track always retains its full 44px visual width and touch row.
 */
export function StudioThreeDToggleControl({
  checked,
  label,
  onChange,
  className,
  description,
  descriptionClassName,
  disabled = false,
  labelClassName,
}: StudioThreeDToggleControlProps) {
  const labelId = useId();
  const descriptionId = useId();
  const hasDescription = description !== undefined && description !== null;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      data-studio-three-d-toggle="true"
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      className={cn(
        "group flex min-h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-3 text-left transition-[color,background-color,border-color] duration-150 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45",
        className,
      )}
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0 flex-1">
        <span
          id={labelId}
          className={cn(
            "block break-words [overflow-wrap:anywhere]",
            labelClassName,
          )}
        >
          {label}
        </span>
        {hasDescription ? (
          <span
            id={descriptionId}
            className={cn(
              "mt-0.5 block break-words [overflow-wrap:anywhere]",
              descriptionClassName,
            )}
          >
            {description}
          </span>
        ) : null}
      </span>
      <StudioThreeDToggleIndicator checked={checked} />
    </button>
  );
}

interface StudioThreeDStatePillProps {
  readonly active: boolean;
  readonly accessibleLabel: string;
}

/** Read-only counterpart for DCC state rows; it must not pretend to be a button. */
export function StudioThreeDStatePill({
  active,
  accessibleLabel,
}: StudioThreeDStatePillProps) {
  return (
    <span
      aria-label={accessibleLabel}
      data-studio-three-d-state-pill="true"
      data-state={active ? "on" : "off"}
      className={cn(
        "inline-flex min-h-6 min-w-12 shrink-0 items-center justify-center rounded-full border px-2 text-[0.625rem] font-bold leading-none",
        active
          ? "border-good/35 bg-good/10 text-good"
          : "border-line bg-raised text-fg-3",
      )}
    >
      {active ? "켜짐" : "꺼짐"}
    </span>
  );
}
