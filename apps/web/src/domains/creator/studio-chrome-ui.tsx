/**
 * Studio chrome UI — toolbar, dock, and menu-shell primitives shared by StudioPage.
 *
 * Commercial drawing-app IA (names not cloned):
 * - Editor shell: Top Bar + left vertical Toolbar + center Canvas + right Properties/Layers
 *   + bottom Status Bar + Quick Actions (undo/redo/zoom/fit)
 *   Layout density modes Super Simple / Simple / Full
 * - CSP / Fresco: labeled tool groups
 * - Figma: edge-dock shell
 *
 * Canvas-max policy: chrome is dense, flush, and sticky — never steals vertical
 * space with marketing headers or multi-row wrap on desktop.
 *
 * Pure presentation only — no document state.
 */
import { ArrowUpRight } from "lucide-react";
import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
  STUDIO_TOUCH_TARGET,
  studioSegmentChipClass,
  studioToolButtonClass,
} from "./studio-panel-ui";
import {
  localizeStudioRailShellText,
  localizeStudioRailToolLabel,
} from "./studio-rail-tool-localization";
import { studioToolHintFromLabel } from "./studio-tool-hints";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioToolHintConsumerPreviewFields } from "./studio-tool-hint-preview-kind";
import type { LucideIcon } from "lucide-react";

import { useI18n, useT } from "@/shared/lib/i18n";
import { cn } from "@/shared/lib/utils";

/* eslint-disable react-refresh/only-export-components -- chrome tokens shared with StudioPage toolbar shell */
export const STUDIO_ICON_SIZE = {
  subtab: 13,
  tool: 16,
  toolCompact: 15,
  dock: 18,
  header: 15,
  rail: 18,
  edge: 15,
  nav: 17,
  contextMenu: 13,
  context: 16,
  identity: 16,
} as const;

/** Default stroke for small chrome icons — slightly thicker reads cleaner at 14–16px. */
export const STUDIO_ICON_STROKE = 1.85;

const STUDIO_ICON_CLASS = "shrink-0 transition-colors duration-150";

type StudioChromeIconTone = "default" | "muted" | "accent" | "danger" | "warn" | "good";

export function studioChromeIconClass({
  tone = "default",
  active = false,
  disabled = false,
}: {
  tone?: StudioChromeIconTone;
  active?: boolean;
  disabled?: boolean;
}): string {
  return cn(
    STUDIO_ICON_CLASS,
    tone === "default" && "text-fg-2",
    tone === "muted" && "text-fg/55",
    tone === "accent" && "text-accent",
    tone === "danger" && "text-bad",
    tone === "warn" && "text-warn",
    tone === "good" && "text-good",
    active && !disabled && "text-accent",
    disabled && "opacity-60"
  );
}

/** Horizontal hairline between tool groups (CSP-style tool belt). */
export function StudioToolbarDivider({
  label,
  className,
}: {
  label?: string;
  className?: string;
}): ReactElement {
  if (label) {
    return (
      <span
        role="separator"
        aria-label={label}
        className={cn(
          "mx-0.5 hidden h-7 shrink-0 items-center gap-1 self-center lg:inline-flex",
          className
        )}
      >
        <span aria-hidden className="h-5 w-px bg-line-strong/70" />
        <span className="select-none text-[0.55rem] font-bold uppercase tracking-[0.12em] text-fg-3">
          {label}
        </span>
        <span aria-hidden className="h-5 w-px bg-line-strong/70" />
      </span>
    );
  }
  return (
    <span
      role="separator"
      aria-hidden
      className={cn("mx-0.5 h-5 w-px shrink-0 self-center bg-line-strong/55", className)}
    />
  );
}

/** Desktop tool-group shell: keeps related actions visually clustered. */
export function StudioToolbarCluster({
  label,
  children,
  className,
  showCaption = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Optional desktop caption under the cluster (draw-app IA). */
  showCaption?: boolean;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        // The belt is a single-row horizontal scroller: clusters must keep their
        // intrinsic width. A max-w-full cap resolves against the scrollport, so a
        // cluster wider than the viewport clipped its own tail buttons under the
        // next cluster (e.g. 그리기 도구 "프레임" under 참조·3D "3D 캐릭터" at 320px).
        "flex shrink-0 flex-col items-stretch gap-px",
        className
      )}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 rounded-xl border border-line/50 bg-card/40 p-0.5",
          "shadow-[inset_0_1px_0_oklch(0.97_0.01_85/0.05)]"
        )}
      >
        {children}
      </div>
      {showCaption ? (
        <span className="hidden select-none px-0.5 text-center text-[0.52rem] font-semibold uppercase tracking-[0.1em] text-fg-3 lg:block">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** Outer tool-belt rail — full-width sticky chrome for the draw-app shell. */
export function StudioToolBelt({
  children,
  className,
  id = "studio-tool-belt",
  inert,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel = "스튜디오 도구",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  inert?: boolean;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
}): ReactElement {
  const lang = useI18n((state) => state.lang);
  const t = useT();
  return (
    <div
      id={id}
      role="toolbar"
      tabIndex={-1}
      aria-label={localizeStudioRailShellText(ariaLabel, lang, t)}
      aria-hidden={ariaHidden}
      inert={inert ? true : undefined}
      data-studio-tool-belt="true"
      className={cn(
        // Single-row draw-app belt (Figma/CSP): horizontal scroll, never multi-row wrap.
        "sticky top-0 z-[30] flex max-w-full shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto",
        "border-b border-line bg-panel/95 px-2 py-1.5",
        // backdrop-filter 는 fixed 자손의 containing block 이 되어 데스크톱 파킹 시
        // 팝오버를 -100vw 쪽으로 끌고 감 → 블러는 모바일만, 팝오버는 포털 사용.
        "shadow-[0_1px_0_oklch(0.2_0.01_70/0.08)] max-lg:backdrop-blur-md",
        "[-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "lg:gap-2 lg:px-2.5 lg:py-1.5",
        className
      )}
    >
      {children}
    </div>
  );
}

/**
 * 툴바 그룹 팝오버 — document.body 포털.
 * 데스크톱에서 레거시 툴벨트가 off-screen fixed 로 파킹돼 있어도 뷰포트 기준으로 표시된다.
 */
export function StudioFloatingToolPopover({
  open,
  children,
  className,
  id = "tool",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}): ReactElement | null {
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      data-studio-tool-popover={id}
      role="dialog"
      aria-modal="false"
      className={className}
    >
      {children}
    </div>,
    document.body
  );
}

/**
 * Compact app menubar — document + file actions.
 * Outer shell is overflow-visible + z-50 so dropdowns are never clipped by the
 * horizontal scroll row (CSS: overflow-x:auto forces y clipping of absolute menus).
 */
export function StudioAppMenubar({
  children,
  className,
  id = "studio-menubar",
  "aria-label": ariaLabel = "문서 메뉴",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  "aria-label"?: string;
}): ReactElement {
  return (
    <div
      id={id}
      role="banner"
      tabIndex={-1}
      aria-label={ariaLabel}
      data-testid="studio-menubar"
      data-studio-app-menubar="true"
      className={cn(
        // Sumo-class top bar — denser commercial app chrome, still canvas-max height.
        // Height grows with content (CSP 명령 바 second row) instead of a hard 44px:
        // a fixed height clipped the strip, and the immersive pill already relies on
        // the same auto/min-height shape in globals.css.
        "relative z-[50] min-h-11 shrink-0 border-b border-line",
        // Critical: do NOT put overflow-x-auto here — it clips File/Edit dropdowns.
        "overflow-visible",
        className
      )}
    >
      <div
        data-testid="studio-menubar-scroll"
        data-studio-app-menubar-scroll="true"
        className={cn(
          "flex min-h-11 w-full flex-nowrap items-center gap-2 px-2.5 sm:gap-2.5 sm:px-3",
          // Mobile actions are a bounded 44px icon cluster and all overlays use portals. Keeping
          // this lane visible prevents focus rings and the final Publish action from being hard
          // clipped by the top-bar shell. Desktop keeps the clipping boundary around its long
          // two-row application menu.
          "max-md:overflow-visible md:overflow-hidden"
        )}
      >
        {children}
      </div>
    </div>
  );
}

export interface StudioToolButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  /** Show label next to icon (default true). Icon-only keeps aria-label. */
  showLabel?: boolean;
  chevron?: "up" | "down" | false;
  accented?: boolean;
}

/** Primary toolbar control — icon + short label, competitor-style affordance. */
export function StudioToolButton({
  active = false,
  icon: Icon,
  label,
  showLabel = true,
  chevron = false,
  accented = false,
  className,
  disabled,
  type = "button",
  ...rest
}: StudioToolButtonProps): ReactElement {
  return (
    <button
      type={type}
      disabled={disabled}
      aria-label={showLabel ? undefined : label}
      title={showLabel ? undefined : label}
      className={cn(
        studioToolButtonClass(active, { dense: true }),
        !showLabel && "justify-center px-2",
        accented && !active && "border-accent/25 bg-accent-soft/25 text-accent hover:bg-accent-soft/40",
        disabled && "cursor-not-allowed opacity-40",
        className
      )}
      {...rest}
    >
      <Icon
        size={showLabel ? STUDIO_ICON_SIZE.toolCompact : STUDIO_ICON_SIZE.tool}
        strokeWidth={STUDIO_ICON_STROKE}
        aria-hidden
        className={studioChromeIconClass({ tone: "default", active, disabled })}
      />
      {showLabel ? <span className="truncate">{label}</span> : null}
      {chevron ? (
        <span
          aria-hidden
          className={cn(
            "inline-block size-0 border-x-[3.5px] border-x-transparent border-t-[4px] border-t-current opacity-70 transition-transform duration-150",
            chevron === "up" && "rotate-180"
          )}
        />
      ) : null}
    </button>
  );
}

/** Sticky header inside a toolbar group popover (CSP-style subtool panel). */
export function StudioMenuPopoverHeader({
  title,
  description,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}): ReactElement {
  return (
    <div
      className={cn(
        "mb-1.5 flex min-w-0 items-start gap-2 rounded-lg border border-line/80 bg-canvas/45 px-2 py-1.5",
        className
      )}
    >
      {Icon ? (
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-accent-soft text-accent ring-1 ring-accent/15">
          <Icon
            size={STUDIO_ICON_SIZE.header}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "accent" })}
          />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.72rem] font-bold tracking-tight text-fg">{title}</p>
        {description ? (
          <p className="mt-0.5 text-[0.6rem] leading-snug text-fg-3 text-pretty">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

export interface StudioMenuSubtabItem {
  id: string;
  label: string;
  icon: LucideIcon;
  title?: string;
  disabled?: boolean;
}

/** Segmented subtabs for group menus — sticky above scrollable content. */
export function StudioMenuSubtabs({
  items,
  activeId,
  onSelect,
  className,
  "aria-label": ariaLabel = "메뉴 구역",
}: {
  items: readonly StudioMenuSubtabItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  className?: string;
  "aria-label"?: string;
}): ReactElement {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "sticky top-0 z-10 -mx-0.5 mb-1.5 flex flex-wrap gap-1 border-b border-line/70 bg-panel pb-1.5",
        className
      )}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const active = activeId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            title={item.title ?? item.label}
            onClick={() => onSelect(item.id)}
            className={cn(
              studioSegmentChipClass(active),
              // 8탭 이상 에셋 메뉴에서도 라벨이 잘리지 않게 최소 터치·가독 폭 확보
              "min-h-8 px-2 text-[0.68rem] max-lg:min-h-11 lg:min-h-9",
              item.disabled && "cursor-not-allowed opacity-40"
            )}
          >
            <Icon
              size={STUDIO_ICON_SIZE.subtab}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioChromeIconClass({ tone: "default" })}
            />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Collapsed edge rail (Figma/CSP style) — thin vertical strip that re-opens a dock.
 * Prefer over wide rounded cards when panels are collapsed so canvas stays wide.
 */
export function StudioEdgeRailButton({
  label,
  side,
  onClick,
  icon: Icon,
  className,
  title,
}: {
  label: string;
  side: "left" | "right";
  onClick: () => void;
  icon?: LucideIcon;
  className?: string;
  title?: string;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? `${label} 펼치기`}
      aria-label={`${label} 펼치기`}
      data-studio-edge-rail={side}
      className={cn(
        "group hidden w-8 shrink-0 flex-col items-center gap-2.5 border-line bg-panel py-4 text-fg-3",
        "transition-colors duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-raised hover:text-fg",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent",
        side === "left" && "border-r",
        side === "right" && "border-l",
        "lg:flex",
        className
      )}
    >
      {Icon ? (
        <Icon
          size={STUDIO_ICON_SIZE.edge}
          strokeWidth={STUDIO_ICON_STROKE}
          aria-hidden
          className={studioChromeIconClass({ tone: "muted", disabled: false })}
        />
      ) : null}
      <span className="text-[0.6rem] font-semibold tracking-[0.14em] text-fg-3 [writing-mode:vertical-rl] group-hover:text-fg-2">
        {label}
      </span>
    </button>
  );
}

/** Mobile dock / contextual toolbar control — icon over caption. */
type StudioDockButtonBaseProps = {
    active?: boolean;
    icon?: LucideIcon;
    label: string;
    danger?: boolean;
    swatch?: ReactNode;
    className?: string;
    hintDescription?: string;
    hintShortcut?: string;
    hintUnavailableReason?: string;
  } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">;

export type StudioDockButtonProps = StudioDockButtonBaseProps
  & StudioToolHintConsumerPreviewFields;

export const StudioDockButton = forwardRef<
  HTMLButtonElement,
  StudioDockButtonProps
>(function StudioDockButton(
  {
    active = false,
    icon: Icon,
    label,
    danger = false,
    className,
    disabled,
    type = "button",
    swatch,
    hintDescription,
    hintPreview,
    hintPreviewVariant,
    hintShortcut,
    hintUnavailableReason,
    title,
    ...rest
  },
  ref
): ReactElement {
  const button = (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      title={hintDescription ? undefined : title}
      className={cn(
        "flex min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[0.6875rem] font-semibold leading-none",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        STUDIO_TOUCH_TARGET,
        active
          ? "bg-accent text-on-accent shadow-sm"
          : danger
            ? "text-bad hover:bg-bad/10"
            : "text-fg-2 hover:bg-raised active:bg-raised",
        disabled && "cursor-not-allowed opacity-35",
        className
      )}
      {...rest}
    >
      {swatch ??
        (Icon ? (
          <Icon
            size={STUDIO_ICON_SIZE.dock}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({
              tone: danger ? "danger" : active ? "accent" : "default",
              active,
              disabled,
            })}
          />
        ) : null)}
      <span>{label}</span>
    </button>
  );

  if (!hintDescription) return button;
  const hint = hintPreview === undefined
    ? studioToolHintFromLabel(label, hintDescription, hintShortcut)
    : studioToolHintFromLabel(
        label,
        hintDescription,
        hintShortcut,
        hintPreview,
        hintPreviewVariant
      );
  return (
    <StudioToolHintTarget
      disabled={disabled}
      unavailableReason={
        disabled
          ? hintUnavailableReason ?? (typeof title === "string" ? title : "현재 작업 상태에서는 이 도구를 사용할 수 없어요.")
          : undefined
      }
      preferredSide="top"
      className="min-w-11 flex-1"
      hint={hint}
    >
      {button}
    </StudioToolHintTarget>
  );
});

/** Secondary mobile bar (pages / props / zoom). */
export function StudioDockNavButton({
  active = false,
  icon: Icon,
  label,
  className,
  disabled,
  type = "button",
  ...rest
}: {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">): ReactElement {
  return (
    <button
      type={type}
      disabled={disabled}
      className={cn(
        "flex min-h-11 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1 text-[0.6875rem] font-medium",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        active ? "bg-accent-soft/70 text-accent" : "text-fg-2 hover:bg-raised",
        disabled && "opacity-40",
        className
      )}
      {...rest}
    >
      <Icon
        size={STUDIO_ICON_SIZE.nav}
        strokeWidth={STUDIO_ICON_STROKE}
        aria-hidden
        className={studioChromeIconClass({ tone: active ? "accent" : "default", active })}
      />
      <span>{label}</span>
    </button>
  );
}

/** Contextual selection bar chip (Photoshop Mobile style). */
export function StudioContextActionButton({
  icon: Icon,
  label,
  danger = false,
  active = false,
  className,
  onKeyDown,
  type = "button",
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  danger?: boolean;
  active?: boolean;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">): ReactElement {
  return (
    <button
      type={type}
      className={cn(
        "flex min-h-11 min-w-14 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.62rem] font-semibold",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        active && "bg-accent text-on-accent",
        !active && danger && "text-bad hover:bg-bad/10",
        !active && !danger && "text-fg-2 hover:bg-raised",
        className
      )}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        // The Studio canvas owns Space/Enter shortcuts at the window boundary. Native context
        // buttons must consume their activation keys first so reopening a sheet after focus
        // restoration behaves exactly like a pointer click.
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
      {...rest}
    >
      <Icon
        size={STUDIO_ICON_SIZE.context}
        strokeWidth={STUDIO_ICON_STROKE}
        aria-hidden
        className={studioChromeIconClass({
          tone: danger ? "danger" : active ? "accent" : "default",
          active,
        })}
      />
      {label}
    </button>
  );
}

/**
 * Krita/Ibis-style left vertical Toolbar — icon-first tools left of the canvas.
 * Grouped tools can show a flyout chevron (triangle affordance signals alternate tools).
 */
export function StudioVerticalToolRail({
  children,
  className,
  footer,
  id = "studio-tool-rail",
  "aria-label": ariaLabel = "그리기 도구",
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  id?: string;
  "aria-label"?: string;
}): ReactElement {
  const lang = useI18n((state) => state.lang);
  const t = useT();
  return (
    <div
      id={id}
      role="toolbar"
      tabIndex={-1}
      aria-orientation="vertical"
      aria-label={localizeStudioRailShellText(ariaLabel, lang, t)}
      data-studio-tool-rail="true"
      className={cn(
        "hidden min-h-0 w-12 shrink-0 flex-col overflow-hidden border-r border-line",
        "lg:flex",
        className
      )}
    >
      <div
        data-studio-tool-rail-scroll="true"
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto overscroll-contain py-2.5",
          "xl:gap-2 xl:py-3",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        )}
      >
        {children}
      </div>
      {footer ? (
        <div
          data-studio-tool-rail-footer="true"
          className="relative z-[1] flex shrink-0 justify-center border-t border-line/70 bg-panel px-1 py-1.5 shadow-[0_-10px_20px_-16px_oklch(0.08_0.015_70/0.9)]"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-3 h-3 bg-gradient-to-t from-panel/90 to-transparent"
          />
          {footer}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Krita/Pixlr tool-options identity — “what am I using right now?”
 * Lives at the start of the draw options strip (not marketing copy).
 */
export function StudioToolIdentity({
  icon: Icon,
  title,
  detail,
  shortcut,
  /** Icon + metrics only — tool name lives in title tooltip (CSP/Krita dense chrome). */
  iconFirst = true,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  detail?: string;
  shortcut?: string;
  iconFirst?: boolean;
  className?: string;
}): ReactElement {
  return (
    <div
      data-studio-tool-identity="true"
      data-studio-tool-identity-icon-first={iconFirst ? "true" : undefined}
      className={cn("inline-flex shrink-0 items-center gap-1.5", className)}
      title={detail ? `${title} — ${detail}` : title}
      aria-label={detail ? `${title}, ${detail}` : title}
    >
      {Icon ? (
        <span className="grid size-8 place-items-center rounded-lg bg-canvas/60 text-accent shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.18)]">
          <Icon
            size={STUDIO_ICON_SIZE.identity}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "accent" })}
          />
        </span>
      ) : null}
      {iconFirst ? (
        detail ? (
          <span className="hidden min-w-0 tabular-nums text-[0.62rem] font-bold tracking-tight text-fg-2 sm:block">
            {detail}
          </span>
        ) : null
      ) : (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[0.72rem] font-bold tracking-tight text-fg">{title}</span>
          {detail ? (
            <span className="block truncate text-[0.58rem] font-medium text-fg-3">{detail}</span>
          ) : null}
        </span>
      )}
      {shortcut ? (
        <StudioKbdBadge className="ml-0.5 hidden sm:inline-flex">{shortcut}</StudioKbdBadge>
      ) : null}
    </div>
  );
}

/** Photopea/CSP-style keyboard chip — menus, identity, HUD. */
export function StudioKbdBadge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <kbd
      data-studio-kbd="true"
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border border-line/70 bg-canvas/55 px-1.5 py-0.5",
        "text-[0.58rem] font-semibold tabular-nums tracking-wide text-fg-3",
        className
      )}
    >
      {children}
    </kbd>
  );
}

/** Concepts/Ibis compact metric pill for the status bar. */
export function StudioHudPill({
  children,
  className,
  title,
  accent,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  accent?: boolean;
}): ReactElement {
  return (
    <span
      data-studio-hud-pill="true"
      title={title}
      className={cn(
        // 밝은 원고 위에서도 읽히도록 프로스트 글라스(blur+saturate) 위에 얹는다 — 반투명
        // 캔버스색 단독으로는 흰 배경에서 대비가 무너졌다.
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-line/50 bg-panel/70 px-2 py-0.5",
        "backdrop-blur-md backdrop-saturate-150 shadow-[0_1px_2px_oklch(0.08_0.01_70/0.35),inset_0_1px_0_oklch(0.95_0.02_85/0.06)]",
        "text-[0.65rem] font-semibold tabular-nums tracking-tight text-fg-2",
        accent && "border-accent/40 bg-accent-soft/60 text-accent",
        className
      )}
    >
      {children}
    </span>
  );
}

type StudioRailToolButtonBaseProps =
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  active?: boolean;
  icon: LucideIcon;
  label: string;
  /** Longer body for the rich hover tooltip (shown with StudioToolHintTarget). */
  description?: string;
  /** Group indicator (long-press / alternate tools exist). */
  grouped?: boolean;
  /**
   * The button opens a panel or workspace instead of changing the canvas tool
   * (3D 인형·캐릭터·배경, Hybrid DCC, 참고 이미지, 프레임 애니메이션). UX 감사 2026-09-02
   * §4.3: direct tools and launchers shared one button grammar, so the artist could not
   * predict whether a press would change the cursor or open a surface. Launchers get a
   * corner ↗ glyph, a softer corner radius and `aria-haspopup="dialog"`.
   */
  launcher?: boolean;
  accented?: boolean;
  /** Why the underlying tool is unavailable; remains discoverable from the disabled coach. */
  unavailableReason?: string;
};

export type StudioRailToolButtonProps = StudioRailToolButtonBaseProps
  & StudioToolHintConsumerPreviewFields;

/** Icon-only tool on the left Ibis-style rail. */
export function StudioRailToolButton({
  active = false,
  icon: Icon,
  label,
  description,
  hintPreview,
  hintPreviewVariant,
  grouped = false,
  launcher = false,
  accented = false,
  unavailableReason,
  className,
  disabled,
  "aria-keyshortcuts": ariaKeyShortcuts,
  type = "button",
  title,
  ...rest
}: StudioRailToolButtonProps): ReactElement {
  // 레일 라벨의 로케일 전환은 여기 한 군데서 한다. 34개 버튼이 저마다 문자열 리터럴·헬프
  // 카탈로그·단축키 조합으로 라벨을 만들고 있어서, 호출부를 하나씩 고치면 다음에 추가되는
  // 버튼이 또 한국어로 새어 나간다. 버튼마다 이미 `data-studio-rail-tool-id`가 붙어 있으므로
  // 그 id로 도구 카탈로그 번역을 찾아 갈아끼우면 새 버튼도 공짜로 번역된다.
  const lang = useI18n((state) => state.lang);
  const t = useT();
  const localizedLabel = localizeStudioRailToolLabel({
    toolId: (rest as Record<string, unknown>)["data-studio-rail-tool-id"] as string | undefined,
    authoredLabel: label,
    lang,
    t,
  });
  // When a rich description is provided, leave title empty so the rich hint bubble is the only hover UI.
  const nativeTitle = description ? undefined : (title ?? localizedLabel);
  const button = (
    <button
      type={type}
      disabled={disabled}
      aria-label={localizedLabel}
      aria-keyshortcuts={ariaKeyShortcuts}
      title={nativeTitle}
      data-studio-tool-description={description ? "true" : undefined}
      data-studio-rail-launcher={launcher ? "true" : undefined}
      aria-haspopup={launcher ? "dialog" : undefined}
      aria-pressed={active}
      className={cn(
        // Fresco-style: slightly larger hit, soft radius, no hard bevel.
        "relative grid size-10 place-items-center border border-transparent xl:size-11",
        // Direct tools stay pill-round; launchers square off so the two kinds read apart at a glance.
        launcher ? "rounded-lg border-dashed border-line/60" : "rounded-2xl",
        STUDIO_EASE,
        STUDIO_FOCUS_RING,
        active
          ? "bg-accent-soft text-fg shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.32),0_2px_8px_oklch(0.72_0.185_42/0.14)]"
          : accented
            ? "text-accent hover:bg-accent-soft/50"
            : "text-fg-2 hover:bg-raised/90 hover:text-fg hover:shadow-[inset_0_0_0_1px_oklch(0.4_0.012_64/0.35)]",
        disabled && "cursor-not-allowed opacity-35",
        className
      )}
      {...rest}
    >
      <Icon
        size={STUDIO_ICON_SIZE.rail}
        strokeWidth={STUDIO_ICON_STROKE}
        aria-hidden
        className={studioChromeIconClass({
          tone: active ? "accent" : "default",
          active,
          disabled,
        })}
      />
      {grouped ? (
        <span
          aria-hidden
          className="absolute bottom-0.5 right-0.5 size-0 border-b-[4px] border-r-[4px] border-b-current border-r-transparent opacity-55"
        />
      ) : null}
      {launcher ? (
        <ArrowUpRight
          size={9}
          strokeWidth={2.5}
          aria-hidden
          className="absolute right-0.5 top-0.5 opacity-60"
        />
      ) : null}
    </button>
  );

  if (!description) return button;
  const hint = hintPreview === undefined
    ? studioToolHintFromLabel(
        label,
        description,
        label.match(/\(([^)]+)\)\s*$/u)?.[1]
      )
    : studioToolHintFromLabel(
        label,
        description,
        label.match(/\(([^)]+)\)\s*$/u)?.[1],
        hintPreview,
        hintPreviewVariant
      );
  return (
    <StudioToolHintTarget
      disabled={disabled}
      unavailableReason={
        disabled
          ? unavailableReason ?? (typeof title === "string" ? title : "선택 항목과 편집 권한 조건을 확인하세요.")
          : undefined
      }
      hint={hint}
    >
      {button}
    </StudioToolHintTarget>
  );
}

/** Thin hairline inside the vertical tool rail. */
export function StudioRailDivider({
  className,
  label,
  ...rest
}: {
  className?: string;
  /** Short CSP-style group caption under the hairline (scannable tool belt). */
  label?: string;
} & Record<string, string | number | undefined>): ReactElement {
  const lang = useI18n((state) => state.lang);
  const t = useT();
  const localizedLabel = label === undefined ? undefined : localizeStudioRailShellText(label, lang, t);
  if (localizedLabel) {
    return (
      <span
        role="separator"
        aria-label={localizedLabel}
        className={cn(
          "my-1 flex w-full max-w-[2.75rem] flex-col items-center gap-0.5 px-0.5",
          className,
        )}
        {...rest}
      >
        <span aria-hidden className="h-px w-6 shrink-0 bg-line/80" />
        <span className="select-none text-center text-[0.5rem] font-semibold leading-tight tracking-tight text-fg-3">
          {localizedLabel}
        </span>
      </span>
    );
  }
  return (
    <span
      role="separator"
      aria-hidden
      className={cn("my-1 h-px w-6 shrink-0 bg-line/80", className)}
      {...rest}
    />
  );
}

/**
 * Top Bar Quick Actions — undo / redo / zoom / fit, icon-first.
 * Lives in the horizontal tool belt center (quick actions strip).
 */
export function StudioQuickActionsBar({
  children,
  className,
  "aria-label": ariaLabel = "빠른 작업",
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}): ReactElement {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-studio-quick-actions="true"
      className={cn("studio-opt-cluster shrink-0", className)}
    >
      {children}
    </div>
  );
}

/**
 * Sketchbook/Krita/Concepts status bar — zoom + tool metrics over the canvas.
 * Does not steal layout height when position=absolute.
 */
export function StudioStatusBar({
  children,
  className,
  id = "studio-status-bar",
  style,
  "aria-label": ariaLabel = "캔버스 상태 및 보기",
}: {
  children: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}): ReactElement {
  return (
    <div
      id={id}
      role="group"
      aria-label={ariaLabel}
      data-studio-status-bar="true"
      tabIndex={-1}
      style={style}
      className={cn(
        "pointer-events-auto absolute bottom-3.5 left-3.5 z-[10] flex max-w-[calc(100%-1.75rem)] flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain",
        "touch-pan-x scroll-px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "sm:max-w-[min(100%,44rem)]",
        "rounded-2xl px-3 py-2 text-[0.68rem] font-semibold tracking-tight text-fg-2",
        className
      )}
    >
      {children}
    </div>
  );
}
