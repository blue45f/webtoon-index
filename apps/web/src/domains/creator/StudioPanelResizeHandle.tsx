import { GripVertical } from "lucide-react";
import { useId } from "react";

import type { Resizable } from "@/src/hooks/use-resizable";

import { cn } from "@/shared/lib/utils";

export interface StudioPanelResizeHandleProps {
  readonly dragging: boolean;
  readonly handleProps: Resizable["handleProps"];
  readonly label: string;
}

/** Shared desktop splitter for the Studio page and inspector edge panels. */
export function StudioPanelResizeHandle({
  handleProps,
  dragging,
  label,
}: StudioPanelResizeHandleProps) {
  const helpId = useId();
  return (
    <>
      <div
        {...handleProps}
        aria-label={label}
        aria-describedby={helpId}
        title={`${label} · 현재 ${handleProps["aria-valuenow"]}px · 드래그 / 더블클릭·더블탭·Enter(기본) / ←→`}
        data-studio-panel-resizer="true"
        data-dragging={dragging ? "true" : "false"}
        className={cn(
          "group relative hidden w-3 shrink-0 touch-none cursor-col-resize select-none items-center justify-center self-stretch border-x border-line/35 bg-panel/35 transition-[background-color,border-color] motion-reduce:transition-none lg:flex",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-6 before:-translate-x-1/2 before:content-['']",
          "focus-visible:z-10 focus-visible:border-accent/60 focus-visible:bg-accent/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          "active:border-accent/50 active:bg-accent/15",
          dragging
            ? "border-accent/60 bg-accent/20"
            : "hover:border-accent/35 hover:bg-accent/10"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "grid h-12 w-2.5 place-items-center rounded-full border shadow-sm transition-[color,background-color,border-color,transform] motion-reduce:transition-none",
            dragging
              ? "scale-105 border-accent bg-accent text-on-accent"
              : "border-line bg-raised text-fg-3 group-hover:border-accent/50 group-hover:bg-accent-soft group-hover:text-accent group-focus-visible:border-accent group-focus-visible:bg-accent-soft group-focus-visible:text-accent"
          )}
        >
          <GripVertical size={10} strokeWidth={2.25} />
        </span>
      </div>
      <span
        id={helpId}
        className="sr-only"
      >
        좌우 방향키로 조금씩 조절하고 Home과 End로 최소·최대 너비를 선택할 수 있습니다. Enter를 누르거나 더블클릭·더블탭하면 기본 너비로 돌아갑니다.
      </span>
    </>
  );
}
