import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowUp,
  BringToFront,
  CopyPlus,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import {
  planStudioSelectionContextBarPlacement,
  studioOnCanvasSafeArea,
  type StudioSurfaceRect,
} from "./studio-oncanvas-command-surfaces";

import type { StudioQuickActionId } from "./studio-quick-actions";

import { cn } from "@/shared/lib/utils";

export type StudioSelectionAlignMode =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "distributeH"
  | "distributeV";

export type StudioSelectionReorderDirection = "front" | "back" | "forward" | "backward";

export interface StudioSelectionContextBarHandlers {
  /**
   * Runs the shared quick-action dispatcher — the same entry point the radial
   * menu, the mobile deck and the keyboard use, so 복제/삭제/맨 앞으로/속성 keep
   * exactly one implementation (V5 §15 "명령 일관성 — 중복 구현 금지").
   */
  onQuickAction: (action: StudioQuickActionId) => void;
  onReorder: (direction: StudioSelectionReorderDirection) => void;
  onAlign: (mode: StudioSelectionAlignMode) => void;
  /** Selection bounding box in client coordinates, or null when unavailable. */
  getSelectionRect: () => StudioSurfaceRect | null;
  /** Canvas host client rect, used to build the safe area. */
  getCanvasRect: () => StudioSurfaceRect | null;
}

export interface StudioSelectionContextBarProps {
  visible: boolean;
  selectionCount: number;
  readOnly: boolean;
  canDelete: boolean;
  stableHandlers: StudioSelectionContextBarHandlers;
}

interface BarCommand {
  readonly key: string;
  readonly label: string;
  readonly Icon: LucideIcon;
  readonly run: (handlers: StudioSelectionContextBarHandlers) => void;
  readonly destructive?: boolean;
}

/**
 * The primary row is the measured "자주 쓰는" set: every id here already earned a
 * default slot in `QUICK_ACTION_IDS` or is one of the 1–2–3 rule failures the
 * audit logged for Layer/Transform (§2.2). Nothing new was invented.
 */
const PRIMARY_COMMANDS: readonly BarCommand[] = Object.freeze([
  {
    key: "duplicate",
    label: "복제",
    Icon: CopyPlus,
    run: (handlers) => handlers.onQuickAction("duplicate"),
  },
  {
    key: "forward",
    label: "앞으로",
    Icon: ArrowUp,
    run: (handlers) => handlers.onReorder("forward"),
  },
  {
    key: "backward",
    label: "뒤로",
    Icon: ArrowDown,
    run: (handlers) => handlers.onReorder("backward"),
  },
  {
    key: "bring-front",
    label: "맨 앞으로",
    Icon: BringToFront,
    run: (handlers) => handlers.onQuickAction("bring-front"),
  },
  {
    key: "properties",
    label: "속성",
    Icon: SlidersHorizontal,
    run: (handlers) => handlers.onQuickAction("properties"),
  },
  {
    key: "delete",
    label: "삭제",
    Icon: Trash2,
    destructive: true,
    run: (handlers) => handlers.onQuickAction("delete"),
  },
]);

const ALIGN_COMMANDS: readonly {
  readonly mode: StudioSelectionAlignMode;
  readonly label: string;
  readonly Icon: LucideIcon;
}[] = Object.freeze([
  { mode: "left", label: "왼쪽 정렬", Icon: AlignStartVertical },
  { mode: "hcenter", label: "가로 가운데 정렬", Icon: AlignCenterVertical },
  { mode: "right", label: "오른쪽 정렬", Icon: AlignEndVertical },
  { mode: "top", label: "위 정렬", Icon: AlignStartHorizontal },
  { mode: "vcenter", label: "세로 가운데 정렬", Icon: AlignCenterHorizontal },
  { mode: "bottom", label: "아래 정렬", Icon: AlignEndHorizontal },
  { mode: "distributeH", label: "가로 분배", Icon: AlignHorizontalSpaceAround },
  { mode: "distributeV", label: "세로 분배", Icon: AlignVerticalSpaceAround },
]);

function viewportRect(): StudioSurfaceRect {
  const visual = globalThis.visualViewport;
  return {
    left: visual?.offsetLeft ?? 0,
    top: visual?.offsetTop ?? 0,
    width: visual?.width ?? globalThis.innerWidth ?? 0,
    height: visual?.height ?? globalThis.innerHeight ?? 0,
  };
}

/**
 * Selection context bar — the §15.1 `Canvas + Context Bar` row, finally on canvas.
 *
 * The audit measured 사각 선택 495px, 올가미 522px and 선택 후 변형 556px from the
 * canvas centre, two of them scrolled clean off a 1440×900 viewport. This bar
 * parks the six commands that actually follow a selection against the selection
 * box itself, inside the 180px budget.
 *
 * Position is written imperatively for the same reason as the brush HUD: dragging
 * a selected element fires `pointermove` at frame rate, and publishing that
 * through React would re-render the editor shell every frame.
 */
export const StudioSelectionContextBar = memo(function StudioSelectionContextBar({
  visible,
  selectionCount,
  readOnly,
  canDelete,
  stableHandlers,
}: StudioSelectionContextBarProps) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const multiple = selectionCount > 1;

  useEffect(() => {
    if (!visible) return;
    const node = barRef.current;
    if (!node) return;

    let frame = 0;
    let disposed = false;

    const hide = () => {
      node.style.visibility = "hidden";
      node.style.pointerEvents = "none";
    };

    // 프레임마다 독 rect를 재측정하지 않는다 — 브러시 HUD의 장애물 갱신과 같은 250ms TTL.
    // 독은 뷰포트 상단 고정이라 rect 변동이 드물고, paint는 pointermove마다 rAF로 돈다.
    const DOCK_OBSTACLE_REFRESH_MS = 250;
    let dockObstacle: StudioSurfaceRect | null = null;
    let dockObstacleAt = -Infinity;

    const paint = () => {
      frame = 0;
      if (disposed) return;
      const selection = stableHandlers.getSelectionRect();
      const canvasRect = stableHandlers.getCanvasRect();
      if (!selection || !canvasRect || node.offsetWidth === 0) {
        hide();
        return;
      }
      // 라이브 협업 프레즌스 독(저장 상태 필, z-[56])이 캔버스 우상단에 떠 있다.
      // 장애물로 알려줘야 명령 바가 그 아래에 깔려 버튼이 가려지는 일이 없다.
      const now = performance.now();
      if (now - dockObstacleAt >= DOCK_OBSTACLE_REFRESH_MS) {
        dockObstacleAt = now;
        const rect = globalThis.document
          .querySelector('[data-studio-presence-dock="true"]')
          ?.getBoundingClientRect();
        dockObstacle = rect && rect.width > 0 && rect.height > 0
          ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
          : null;
      }
      const obstacles = dockObstacle ? [dockObstacle] : [];
      const placement = planStudioSelectionContextBarPlacement({
        selection,
        bar: { width: node.offsetWidth, height: node.offsetHeight },
        safeArea: studioOnCanvasSafeArea(canvasRect, viewportRect()),
        obstacles,
      });
      node.style.visibility = "visible";
      node.style.pointerEvents = "auto";
      node.style.transform = `translate3d(${Math.round(placement.rect.left)}px, ${Math.round(placement.rect.top)}px, 0)`;
      node.dataset.studioSelectionBarSide = placement.side;
      node.dataset.studioSelectionBarWithinBudget = placement.withinBudget ? "true" : "false";
    };

    const schedule = () => {
      if (frame !== 0) return;
      frame = globalThis.requestAnimationFrame(paint);
    };

    const passive = { passive: true, capture: true } as const;
    globalThis.addEventListener("pointermove", schedule, passive);
    globalThis.addEventListener("pointerup", schedule, passive);
    globalThis.addEventListener("wheel", schedule, passive);
    globalThis.addEventListener("scroll", schedule, passive);
    globalThis.addEventListener("resize", schedule, { passive: true });
    globalThis.visualViewport?.addEventListener("resize", schedule);
    globalThis.visualViewport?.addEventListener("scroll", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(node);

    hide();
    schedule();
    return () => {
      disposed = true;
      if (frame !== 0) globalThis.cancelAnimationFrame(frame);
      observer?.disconnect();
      globalThis.removeEventListener("pointermove", schedule, passive);
      globalThis.removeEventListener("pointerup", schedule, passive);
      globalThis.removeEventListener("wheel", schedule, passive);
      globalThis.removeEventListener("scroll", schedule, passive);
      globalThis.removeEventListener("resize", schedule);
      globalThis.visualViewport?.removeEventListener("resize", schedule);
      globalThis.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [visible, multiple, stableHandlers]);

  if (!visible || typeof globalThis.document === "undefined") return null;

  const buttonClass = cn(
    "grid size-8 shrink-0 place-items-center rounded-md text-fg-2 transition-colors",
    "hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-35",
    "max-lg:size-9 pointer-coarse:size-9",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cool"
  );

  return createPortal(
    <div
      ref={barRef}
      role="toolbar"
      aria-label={multiple ? `선택 ${selectionCount}개 명령` : "선택 명령"}
      data-studio-selection-context-bar="true"
      data-studio-selection-count={selectionCount}
      data-studio-shortcut-boundary="true"
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        transform: "translate3d(-9999px, -9999px, 0)",
        visibility: "hidden",
      }}
      className="z-[47] flex w-max flex-col gap-1 rounded-xl bg-panel/95 p-1 shadow-[0_0_0_1px_oklch(0.38_0.01_66),0_10px_30px_oklch(0.06_0.02_70/0.45)] backdrop-blur-md"
    >
      <div className="flex items-center gap-0.5">
        {PRIMARY_COMMANDS.map((command) => (
          <button
            key={command.key}
            type="button"
            data-studio-selection-command={command.key}
            aria-label={command.label}
            title={command.label}
            disabled={readOnly || (command.destructive && !canDelete)}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              command.run(stableHandlers);
            }}
            className={cn(buttonClass, command.destructive && "hover:bg-bad/15 hover:text-bad")}
          >
            <command.Icon size={15} />
          </button>
        ))}
      </div>
      {multiple ? (
        <div
          role="group"
          aria-label="선택 정렬"
          className="flex items-center gap-0.5 border-t border-line/70 pt-1"
        >
          {ALIGN_COMMANDS.map((command) => (
            <button
              key={command.mode}
              type="button"
              data-studio-selection-command={`align-${command.mode}`}
              aria-label={command.label}
              title={command.label}
              disabled={readOnly}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                stableHandlers.onAlign(command.mode);
              }}
              className={buttonClass}
            >
              <command.Icon size={14} />
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    document.body
  );
});
