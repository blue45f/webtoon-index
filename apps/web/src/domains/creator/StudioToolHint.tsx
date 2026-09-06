/**
 * Lightweight interaction shell for Studio motion-coach hints.
 * The rich bubble and animated previews are prefetched on intent and remain
 * outside the editor's startup graph.
 */
import {
  createContext,
  Fragment,
  Suspense,
  cloneElement,
  isValidElement,
  lazy,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type AriaAttributes,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import {
  createStudioToolHintCoordinator,
  type StudioToolHintCoordinator,
} from "./studio-tool-hint-coordinator";
import {
  createStudioToolHintExposureManager,
  type StudioToolHintExposureManager,
  type StudioToolHintRevealIntent,
} from "./studio-tool-hint-exposure";
import { consumeStudioToolHintFocusSuppression } from "./studio-tool-hint-focus-suppression";
import {
  DEFAULT_STUDIO_TOOL_HINT_MODE,
  DEFAULT_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
  type StudioToolHintMode,
} from "./studio-tool-hint-preferences";

import type { StudioToolHintBubbleProps } from "./components/StudioToolHintBubble";
import type { StudioToolHintSide } from "./studio-tool-hint-position";
import type { StudioToolHintSpec } from "./studio-tool-hints";

import { cn } from "@/shared/lib/utils";

const SHOW_DELAY_MS = 280;
const EXPAND_DELAY_MS = 620;
// Long enough to cross the visual gap from the target into the portal bubble.
// Entering the bubble cancels this timer, satisfying hoverable-content accessibility.
const HIDE_DELAY_MS = 280;
const TOUCH_HOLD_MOVE_TOLERANCE_PX = 10;
const TOUCH_PAN_SUPPRESSION_DISTANCE_PX = 8;
const POINTER_HINT_SUPPRESSION_DISTANCE_PX = 6;
const POINTER_HINT_SUPPRESSION_MS = 720;
const FALLBACK_WIDTH = 240;
const FALLBACK_HEIGHT = 92;
const FALLBACK_GAP = 10;
const VIEWPORT_PADDING = 10;
const ANCHOR_READ_RETRY_COUNT = 4;
const ANCHOR_READ_RETRY_DELAY_MS = 14;
const ANCHOR_READ_RETRY_BACKOFF_FACTOR = 2;

export const STUDIO_TOOL_HINT_SCROLL_HOVER_SUPPRESSION_MS = 720;

function isUsableRect(value: DOMRect | null): value is DOMRect {
  return (
    value !== null
    && Number.isFinite(value.left)
    && Number.isFinite(value.top)
    && Number.isFinite(value.right)
    && Number.isFinite(value.bottom)
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
  );
}

function hasUsableArea(value: DOMRect | null): boolean {
  return isUsableRect(value) && value.width > 0 && value.height > 0;
}

type StudioToolHintInteractionManager = {
  suppressHover: (now?: number) => void;
  isHoverSuppressed: (now?: number) => boolean;
  getHoverSuppressionUntil: () => number;
  markReveal: (hintId: string, intent: StudioToolHintRevealIntent) => void;
  getRevealIntent: (hintId: string) => StudioToolHintRevealIntent | null;
  clearReveal: (hintId?: string) => void;
  reset: () => void;
};

function createStudioToolHintInteractionManager(): StudioToolHintInteractionManager {
  let hoverSuppressedUntil = 0;
  let activeReveal: Readonly<{
    hintId: string;
    intent: StudioToolHintRevealIntent;
  }> | null = null;

  return {
    suppressHover(now = Date.now()) {
      hoverSuppressedUntil = Math.max(
        hoverSuppressedUntil,
        now + STUDIO_TOOL_HINT_SCROLL_HOVER_SUPPRESSION_MS
      );
    },
    isHoverSuppressed(now = Date.now()) {
      return now < hoverSuppressedUntil;
    },
    getHoverSuppressionUntil() {
      return hoverSuppressedUntil;
    },
    markReveal(hintId, intent) {
      activeReveal = { hintId, intent };
    },
    getRevealIntent(hintId) {
      return activeReveal?.hintId === hintId ? activeReveal.intent : null;
    },
    clearReveal(hintId) {
      if (hintId && activeReveal?.hintId !== hintId) return;
      activeReveal = null;
    },
    reset() {
      hoverSuppressedUntil = 0;
      activeReveal = null;
    },
  };
}

type StudioToolHintPreferences = {
  mode: StudioToolHintMode;
  touchHoldDelayMs: number;
  reduceMotion: boolean;
};

type StudioToolHintContextValue = StudioToolHintPreferences & {
  coordinator: StudioToolHintCoordinator;
  exposure: StudioToolHintExposureManager;
  interaction: StudioToolHintInteractionManager;
};

const defaultStudioToolHintCoordinator = createStudioToolHintCoordinator();
const defaultStudioToolHintExposure = createStudioToolHintExposureManager();
const defaultStudioToolHintInteraction = createStudioToolHintInteractionManager();

const StudioToolHintPreferencesContext = createContext<StudioToolHintContextValue>({
  mode: DEFAULT_STUDIO_TOOL_HINT_MODE,
  touchHoldDelayMs: DEFAULT_STUDIO_TOOL_HINT_TOUCH_HOLD_MS,
  reduceMotion: false,
  coordinator: defaultStudioToolHintCoordinator,
  exposure: defaultStudioToolHintExposure,
  interaction: defaultStudioToolHintInteraction,
});

export function StudioToolHintPreferencesProvider({
  mode,
  touchHoldDelayMs,
  reduceMotion,
  children,
}: StudioToolHintPreferences & { children: ReactNode }): ReactElement {
  const coordinatorRef = useRef<StudioToolHintCoordinator | null>(null);
  coordinatorRef.current ??= createStudioToolHintCoordinator();
  const coordinator = coordinatorRef.current;
  const exposureRef = useRef<StudioToolHintExposureManager | null>(null);
  exposureRef.current ??= createStudioToolHintExposureManager();
  const exposure = exposureRef.current;
  const interactionRef = useRef<StudioToolHintInteractionManager | null>(null);
  interactionRef.current ??= createStudioToolHintInteractionManager();
  const interaction = interactionRef.current;

  useEffect(() => {
    let touchPanStart: Readonly<{
      pointerId: number;
      x: number;
      y: number;
    }> | null = null;

    function dismissAll() {
      dismissToolHintsImmediately(coordinator, interaction);
    }

    function suppressPassivePointerHints() {
      interaction.suppressHover();
      const activeHintId = coordinator.getActiveHintId();
      if (
        activeHintId &&
        interaction.getRevealIntent(activeHintId) === "focus"
      ) {
        return;
      }
      dismissAll();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissAll();
    }
    function onPointerDown(event: PointerEvent) {
      touchPanStart = event.pointerType === "touch"
        ? {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          }
        : null;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-studio-tool-hint-target="true"]')
      ) {
        return;
      }
      clearPointerSuppression();
      dismissAll();
    }
    function onPointerMove(event: PointerEvent) {
      const start = touchPanStart;
      if (
        event.pointerType !== "touch" ||
        !start ||
        start.pointerId !== event.pointerId ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y)
          <= TOUCH_PAN_SUPPRESSION_DISTANCE_PX
      ) {
        return;
      }
      touchPanStart = null;
      suppressPassivePointerHints();
    }
    function onPointerEnd(event: PointerEvent) {
      if (touchPanStart?.pointerId === event.pointerId) touchPanStart = null;
    }
    function onPointerOver(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element) || coordinator.getActiveHintId() === null) return;
      const titledTarget = target.closest("[title]");
      if (
        !titledTarget ||
        titledTarget.closest('[data-studio-tool-hint-target="true"]') ||
        titledTarget.closest('[data-studio-tool-hint="true"]')
      ) {
        return;
      }
      dismissAll();
    }
    function onFocusIn(event: FocusEvent) {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        target.closest('[data-studio-tool-hint-target="true"]') ||
        target.closest('[data-studio-tool-hint="true"]')
      ) {
        return;
      }
      dismissAll();
    }

    const passiveCapture = { capture: true, passive: true } as const;
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("pointerdown", onPointerDown, passiveCapture);
    globalThis.addEventListener("pointermove", onPointerMove, passiveCapture);
    globalThis.addEventListener("pointerup", onPointerEnd, passiveCapture);
    globalThis.addEventListener("pointercancel", onPointerEnd, passiveCapture);
    globalThis.addEventListener("pointerover", onPointerOver, passiveCapture);
    globalThis.addEventListener("focusin", onFocusIn, passiveCapture);
    globalThis.addEventListener("wheel", suppressPassivePointerHints, passiveCapture);
    globalThis.addEventListener("scroll", suppressPassivePointerHints, passiveCapture);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("pointerdown", onPointerDown, passiveCapture);
      globalThis.removeEventListener("pointermove", onPointerMove, passiveCapture);
      globalThis.removeEventListener("pointerup", onPointerEnd, passiveCapture);
      globalThis.removeEventListener("pointercancel", onPointerEnd, passiveCapture);
      globalThis.removeEventListener("pointerover", onPointerOver, passiveCapture);
      globalThis.removeEventListener("focusin", onFocusIn, passiveCapture);
      globalThis.removeEventListener("wheel", suppressPassivePointerHints, passiveCapture);
      globalThis.removeEventListener("scroll", suppressPassivePointerHints, passiveCapture);
      interaction.reset();
      clearPointerSuppression();
    };
  }, [coordinator, interaction]);

  return (
    <StudioToolHintPreferencesContext.Provider
      value={{
        mode,
        touchHoldDelayMs,
        reduceMotion,
        coordinator,
        exposure,
        interaction,
      }}
    >
      {children}
    </StudioToolHintPreferencesContext.Provider>
  );
}

// Selecting a tool can synchronously replace its control while the pointer is
// still parked over it. This guard survives that remount and stays armed until
// the pointer physically moves (or keyboard focus deliberately takes over).
let suppressedPointerHintAt:
  | Readonly<{
      hintId: string;
      x: number;
      y: number;
      suppressUntil: number;
    }>
  | null = null;
let clearPointerSuppressionListener: (() => void) | null = null;
let clearPointerSuppressionTimeout: ReturnType<typeof setTimeout> | null = null;

function clearPointerSuppression() {
  clearPointerSuppressionListener?.();
  clearPointerSuppressionListener = null;
  if (clearPointerSuppressionTimeout !== null) {
    globalThis.clearTimeout(clearPointerSuppressionTimeout);
    clearPointerSuppressionTimeout = null;
  }
  suppressedPointerHintAt = null;
}

function isPointerSuppressionActiveForTip(tipId: string): boolean {
  return getPointerSuppressionRemainingForTip(tipId) !== null;
}

function getPointerSuppressionRemainingForTip(
  tipId: string,
  now = Date.now()
): number | null {
  if (!suppressedPointerHintAt || suppressedPointerHintAt.hintId !== tipId) return null;
  if (suppressedPointerHintAt.suppressUntil <= now) return null;
  return suppressedPointerHintAt.suppressUntil - now;
}

function armPointerSuppression(hintId: string, x: number, y: number) {
  clearPointerSuppression();
  const suppressUntil = Date.now() + POINTER_HINT_SUPPRESSION_MS;
  suppressedPointerHintAt = { hintId, x, y, suppressUntil };
  clearPointerSuppressionTimeout = globalThis.setTimeout(() => {
    clearPointerSuppression();
  }, POINTER_HINT_SUPPRESSION_MS) as ReturnType<typeof setTimeout>;

  function onPointerMove(event: PointerEvent) {
    if (!suppressedPointerHintAt || suppressedPointerHintAt.hintId !== hintId) return;
    if (
      Math.hypot(
        event.clientX - suppressedPointerHintAt.x,
        event.clientY - suppressedPointerHintAt.y
      ) <= POINTER_HINT_SUPPRESSION_DISTANCE_PX
    ) {
      return;
    }
    clearPointerSuppression();
  }
  const passiveCapture = { capture: true, passive: true } as const;
  globalThis.addEventListener("pointermove", onPointerMove, passiveCapture);
  clearPointerSuppressionListener = () =>
    globalThis.removeEventListener("pointermove", onPointerMove, passiveCapture);
}

function hideRenderedToolHintElement(hintId: string | null) {
  if (!hintId || typeof document === "undefined") return;
  const rendered = document.getElementById(hintId);
  if (rendered?.matches('[data-studio-tool-hint="true"]')) rendered.hidden = true;
}

function dismissToolHintsImmediately(
  coordinator: StudioToolHintCoordinator,
  interaction?: StudioToolHintInteractionManager
): number {
  hideRenderedToolHintElement(coordinator.getActiveHintId());
  interaction?.clearReveal();
  return coordinator.dismissAll();
}

let studioToolHintBubbleModulePromise:
  | Promise<typeof import("./components/StudioToolHintBubble")>
  | null = null;

function loadStudioToolHintBubbleModule() {
  studioToolHintBubbleModulePromise ??= import("./components/StudioToolHintBubble").catch(
    (error: unknown) => {
      // Do not retain a rejected speculative preload in this module-level request cache.
      studioToolHintBubbleModulePromise = null;
      throw error;
    }
  );
  return studioToolHintBubbleModulePromise;
}

function preloadStudioToolHintBubbleModule(): void {
  void loadStudioToolHintBubbleModule().catch(() => {
    // Hover/focus/touch preloading is best effort. The rendered lazy boundary owns real errors.
  });
}

const LazyStudioToolHintBubble = lazy(async () => ({
  default: (await loadStudioToolHintBubbleModule()).StudioToolHintBubble,
}));

type DescribedChildProps = Pick<
  AriaAttributes,
  | "aria-checked"
  | "aria-controls"
  | "aria-current"
  | "aria-describedby"
  | "aria-disabled"
  | "aria-expanded"
  | "aria-haspopup"
  | "aria-hidden"
  | "aria-keyshortcuts"
  | "aria-label"
  | "aria-pressed"
  | "aria-selected"
> & {
  tabIndex?: number;
  title?: string;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function removeAriaDescription(target: HTMLElement, descriptionId: string) {
  const descriptions = (target.getAttribute("aria-describedby") ?? "")
    .split(/\s+/u)
    .filter((id) => id && id !== descriptionId);
  if (descriptions.length > 0) target.setAttribute("aria-describedby", descriptions.join(" "));
  else target.removeAttribute("aria-describedby");
}

function compactFallbackStyle(
  anchor: DOMRect,
  preferredSide: StudioToolHintSide | undefined,
  hasUnavailableReason: boolean
): CSSProperties {
  const viewportWidth = typeof globalThis.innerWidth === "number" ? globalThis.innerWidth : 1280;
  const viewportHeight = typeof globalThis.innerHeight === "number" ? globalThis.innerHeight : 800;
  const fallbackHeight = hasUnavailableReason ? 124 : FALLBACK_HEIGHT;
  const side = preferredSide ?? (anchor.bottom > viewportHeight * 0.72 ? "top" : "right");
  let left = anchor.right + FALLBACK_GAP;
  let top = anchor.top + anchor.height / 2 - fallbackHeight / 2;
  if (side === "left") left = anchor.left - FALLBACK_GAP - FALLBACK_WIDTH;
  if (side === "bottom" || side === "top") {
    left = anchor.left + anchor.width / 2 - FALLBACK_WIDTH / 2;
    top = side === "bottom"
      ? anchor.bottom + FALLBACK_GAP
      : anchor.top - FALLBACK_GAP - fallbackHeight;
  }
  return {
    left: clamp(left, VIEWPORT_PADDING, viewportWidth - FALLBACK_WIDTH - VIEWPORT_PADDING),
    top: clamp(top, VIEWPORT_PADDING, viewportHeight - fallbackHeight - VIEWPORT_PADDING),
  };
}

function StudioToolHintCompactFallback({
  id,
  hint,
  anchor,
  unavailableReason,
  preferredSide,
  reducedMotion = false,
  onMouseEnter,
  onMouseLeave,
}: Pick<
  StudioToolHintBubbleProps,
  | "id"
  | "hint"
  | "anchor"
  | "unavailableReason"
  | "preferredSide"
  | "onMouseEnter"
  | "onMouseLeave"
> & { reducedMotion?: boolean }): ReactElement {
  return (
    <div
      id={id}
      role="tooltip"
      data-studio-tool-hint="true"
      data-studio-tool-hint-expanded="false"
      data-studio-tool-hint-loading="true"
      className="studio-tool-hint-compact"
      style={{
        ...compactFallbackStyle(anchor as DOMRect, preferredSide, Boolean(unavailableReason)),
        animation: reducedMotion ? "none" : undefined,
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-[0.8125rem] font-bold leading-tight text-fg">{hint.title}</p>
        {hint.shortcut ? (
          <kbd className="shrink-0 rounded-md border border-line/70 bg-canvas/75 px-1.5 py-0.5 text-[0.625rem] font-semibold text-fg-2">
            {hint.shortcut}
          </kbd>
        ) : null}
      </div>
      <p className="mt-1.5 line-clamp-2 text-[0.75rem] leading-relaxed text-fg-2">{hint.description}</p>
      {unavailableReason ? (
        <div
          data-studio-tool-hint-unavailable="true"
          className="mt-2 flex items-start gap-1.5 rounded-md border border-warn/35 bg-warn/10 px-2 py-1.5 text-[0.7rem] leading-relaxed"
        >
          <span className="shrink-0 font-bold text-warn">사용 조건</span>
          <span className="min-w-0 text-fg-2">{unavailableReason}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Wraps a tool control and provides pointer, keyboard, touch-focus, viewport
 * repositioning, Escape dismissal, and an exact ARIA description relation.
 */
export function StudioToolHintTarget({
  hint,
  children,
  className,
  disabled,
  unavailableReason,
  preferredSide,
}: {
  hint: StudioToolHintSpec | null | undefined;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  unavailableReason?: string;
  preferredSide?: StudioToolHintSide;
}): ReactElement {
  const preferences = useContext(StudioToolHintPreferencesContext);
  const richCoachEnabled = preferences.mode === "rich";
  const tipId = useId();
  const coordinator = preferences.coordinator;
  const exposure = preferences.exposure;
  const interaction = preferences.interaction;
  const open = useSyncExternalStore(
    coordinator.subscribe,
    () => coordinator.getActiveHintId() === tipId,
    () => false
  );
  const dismissEpoch = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getDismissEpoch,
    () => 0
  );
  const wrapRef = useRef<HTMLSpanElement>(null);
  const showTimer = useRef<number>(0);
  const expandTimer = useRef<number>(0);
  const hideTimer = useRef<number>(0);
  const touchHoldTimer = useRef<number>(0);
  const touchHoldStart = useRef<Readonly<{
    pointerId: number;
    x: number;
    y: number;
  }> | null>(null);
  const touchHoldOpened = useRef(false);
  const pointerDismissed = useRef(false);
  const activeRevealIntent = useRef<StudioToolHintRevealIntent | null>(null);
  const describedFocusTarget = useRef<HTMLElement | null>(null);
  const observedDismissEpoch = useRef(dismissEpoch);
  const [expanded, setExpanded] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const lastValidAnchor = useRef<DOMRect | null>(null);

  function scheduleHintRevealWithDelay(delayMs: number) {
    if (showTimer.current) {
      globalThis.clearTimeout(showTimer.current);
    }
    const intentEpoch = coordinator.getDismissEpoch();
    coordinator.markPending(tipId);
    showTimer.current = globalThis.setTimeout(() => {
      showTimer.current = 0;
      if (!coordinator.clearPending(tipId)) return;
      if (coordinator.getDismissEpoch() !== intentEpoch) return;
      if (isPointerSuppressionActiveForTip(tipId)) {
        const remaining = getPointerSuppressionRemainingForTip(tipId);
        scheduleHintRevealWithDelay(Math.max(remaining ?? 0, SHOW_DELAY_MS));
        return;
      }
      if (interaction.isHoverSuppressed()) {
        const now = Date.now();
        const hoverRemaining = Math.max(interaction.getHoverSuppressionUntil() - now, 0);
        scheduleHintRevealWithDelay(Math.max(hoverRemaining, SHOW_DELAY_MS));
        return;
      }
      reveal(false, "hover");
    }, delayMs) as unknown as number;
  }

  function clearTimers() {
    if (showTimer.current) globalThis.clearTimeout(showTimer.current);
    if (expandTimer.current) globalThis.clearTimeout(expandTimer.current);
    if (hideTimer.current) globalThis.clearTimeout(hideTimer.current);
    if (touchHoldTimer.current) globalThis.clearTimeout(touchHoldTimer.current);
    showTimer.current = 0;
    expandTimer.current = 0;
    hideTimer.current = 0;
    touchHoldTimer.current = 0;
    touchHoldStart.current = null;
  }

  function clearHideTimer() {
    if (hideTimer.current) {
      globalThis.clearTimeout(hideTimer.current);
      hideTimer.current = 0;
    }
  }

  function hideRenderedTooltipImmediately(hintId = tipId) {
    hideRenderedToolHintElement(hintId);
  }

  function dismissCoordinatedHintsImmediately() {
    activeRevealIntent.current = null;
    observedDismissEpoch.current = dismissToolHintsImmediately(coordinator, interaction);
  }

  function readAnchor(): DOMRect | null {
    const el = wrapRef.current;
    const rootRect = el?.getBoundingClientRect() ?? null;
    if (isUsableRect(rootRect)) return rootRect;

    const childRect = el?.firstElementChild?.getBoundingClientRect() ?? null;
    if (isUsableRect(childRect)) return childRect;

    return null;
  }

  function reveal(
    expandImmediately: boolean,
    intent: StudioToolHintRevealIntent,
    anchorRetryRemaining = ANCHOR_READ_RETRY_COUNT
  ) {
    if (!hint || preferences.mode === "off") return;
    const alreadyOpen = coordinator.getActiveHintId() === tipId;
    const previousIntent = interaction.getRevealIntent(tipId);
    if (
      intent === "hover" &&
      interaction.isHoverSuppressed() &&
      previousIntent !== "focus"
    ) {
      coordinator.clearPending(tipId);
      return;
    }
    const effectiveIntent = alreadyOpen && previousIntent === "focus" && intent === "hover"
      ? "focus"
      : intent;
    // A usage condition is operational accessibility information, not passive
    // coaching. Keep it available on every deliberate hover/focus even after
    // ordinary feature coaches have reached their repetition cooldown.
    if (!alreadyOpen && !unavailableReason && !exposure.canReveal(hint.id, intent)) {
      coordinator.clearPending(tipId);
      return;
    }
    coordinator.clearPending(tipId);
    preloadStudioToolHintBubbleModule();
    if (hideTimer.current) {
      globalThis.clearTimeout(hideTimer.current);
      hideTimer.current = 0;
    }
    const nextAnchor = readAnchor();
    const fallbackAnchor = isUsableRect(lastValidAnchor.current)
      ? lastValidAnchor.current
      : null;

    if (!isUsableRect(nextAnchor)) {
      if (fallbackAnchor) {
        setAnchor(fallbackAnchor);
      }
      if (fallbackAnchor && anchorRetryRemaining <= 0) {
        // Continue with last known geometry rather than dropping the tooltip
        // when the layout briefly reports a zero-sized rect.
      } else {
      if (anchorRetryRemaining <= 0) return;
      const retryDelay = ANCHOR_READ_RETRY_DELAY_MS
        * ANCHOR_READ_RETRY_BACKOFF_FACTOR ** (ANCHOR_READ_RETRY_COUNT - anchorRetryRemaining);
        showTimer.current = globalThis.setTimeout(() => {
          showTimer.current = 0;
          // If geometry is being recalculated right as the control remounts,
          // retry before dropping the hint intent.
          reveal(expandImmediately, intent, anchorRetryRemaining - 1);
        }, retryDelay) as unknown as number;
        return;
      }
    }

    const anchorToUse = isUsableRect(nextAnchor)
      ? nextAnchor
      : fallbackAnchor && hasUsableArea(fallbackAnchor)
        ? fallbackAnchor
        : null;
    if (!anchorToUse) return;

    lastValidAnchor.current = anchorToUse;
    setAnchor(anchorToUse);
    activeRevealIntent.current = effectiveIntent;
    interaction.markReveal(tipId, effectiveIntent);
    const previousHintId = coordinator.claim(tipId);
    if (!alreadyOpen && !unavailableReason) exposure.markRevealed(hint.id, intent);
    if (previousHintId && previousHintId !== tipId) {
      hideRenderedTooltipImmediately(previousHintId);
    }
    if (!richCoachEnabled) {
      if (expandTimer.current) globalThis.clearTimeout(expandTimer.current);
      expandTimer.current = 0;
      setExpanded(false);
      return;
    }
    if (effectiveIntent === "touch") {
      if (expandTimer.current) globalThis.clearTimeout(expandTimer.current);
      expandTimer.current = 0;
      setExpanded(false);
      return;
    }
    if (expandImmediately) {
      setExpanded(true);
      return;
    }
    // Preserve an already-expanded rich coach while the pointer crosses the
    // hoverable gap from the bubble back to its target.
    if (expanded) return;
    if (expandTimer.current) globalThis.clearTimeout(expandTimer.current);
    expandTimer.current = globalThis.setTimeout(() => {
      setExpanded(true);
      expandTimer.current = 0;
    }, EXPAND_DELAY_MS) as unknown as number;
  }

  function scheduleShow() {
    if (!hint || preferences.mode === "off") return;
    if (open) {
      reveal(false, "hover");
      return;
    }

    clearHideTimer();

    const now = Date.now();
    const pointerSuppressionRemaining = getPointerSuppressionRemainingForTip(tipId, now);
    if (pointerSuppressionRemaining !== null) {
      scheduleHintRevealWithDelay(pointerSuppressionRemaining + SHOW_DELAY_MS);
      return;
    }
    if (interaction.isHoverSuppressed(now)) {
      const hoverRemaining = Math.max(interaction.getHoverSuppressionUntil() - now, 0);
      scheduleHintRevealWithDelay(hoverRemaining + SHOW_DELAY_MS);
      return;
    }
    if (!open && !unavailableReason && !exposure.canReveal(hint.id, "hover")) return;
    preloadStudioToolHintBubbleModule();
    scheduleHintRevealWithDelay(SHOW_DELAY_MS);
  }

  function scheduleHide() {
    if (showTimer.current) globalThis.clearTimeout(showTimer.current);
    if (expandTimer.current) globalThis.clearTimeout(expandTimer.current);
    showTimer.current = 0;
    expandTimer.current = 0;
    coordinator.clearPending(tipId);
    if (hideTimer.current) globalThis.clearTimeout(hideTimer.current);
    hideTimer.current = globalThis.setTimeout(() => {
      if (coordinator.getActiveHintId() === tipId) hideRenderedTooltipImmediately();
      coordinator.release(tipId);
      interaction.clearReveal(tipId);
      activeRevealIntent.current = null;
      setExpanded(false);
      hideTimer.current = 0;
    }, HIDE_DELAY_MS) as unknown as number;
  }

  function keepOpenFromBubble() {
    if (hideTimer.current) globalThis.clearTimeout(hideTimer.current);
    hideTimer.current = 0;
  }

  function leaveBubble() {
    pointerDismissed.current = false;
    scheduleHide();
  }

  function dismissPointerActivation(
    event?: Pick<ReactPointerEvent<HTMLSpanElement>, "clientX" | "clientY">
  ) {
    // A pointer activation moves focus to the control immediately after
    // pointerdown. Keep that synthetic focus transition from reopening the
    // coach under the user's cursor; leaving the target re-arms hover/focus.
    pointerDismissed.current = true;
    if (hint && !disabled && !unavailableReason) exposure.markActivated(hint.id);
    armPointerSuppression(tipId, event?.clientX ?? 0, event?.clientY ?? 0);
    touchHoldOpened.current = false;
    clearTimers();
    dismissCoordinatedHintsImmediately();
    setExpanded(false);
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") {
      dismissPointerActivation(event);
      return;
    }
    if (preferences.mode === "off") return;

    clearTimers();
    dismissCoordinatedHintsImmediately();
    touchHoldStart.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    pointerDismissed.current = true;
    armPointerSuppression(tipId, event.clientX, event.clientY);
    touchHoldOpened.current = false;
    setExpanded(false);
    preloadStudioToolHintBubbleModule();
    const intentEpoch = coordinator.getDismissEpoch();
    coordinator.markPending(tipId);
    touchHoldTimer.current = globalThis.setTimeout(() => {
      touchHoldTimer.current = 0;
      coordinator.clearPending(tipId);
      if (coordinator.getDismissEpoch() !== intentEpoch) return;
      touchHoldStart.current = null;
      touchHoldOpened.current = true;
      pointerDismissed.current = false;
      clearPointerSuppression();
      reveal(false, "touch");
    }, preferences.touchHoldDelayMs) as unknown as number;
  }

  function handlePointerMoveCapture(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch" || !touchHoldTimer.current) return;
    const start = touchHoldStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - start.x, event.clientY - start.y)
      <= TOUCH_HOLD_MOVE_TOLERANCE_PX
    ) {
      return;
    }
    globalThis.clearTimeout(touchHoldTimer.current);
    touchHoldTimer.current = 0;
    touchHoldStart.current = null;
    coordinator.clearPending(tipId);
  }

  function handlePointerUpCapture(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") return;
    touchHoldStart.current = null;
    if (touchHoldTimer.current) {
      globalThis.clearTimeout(touchHoldTimer.current);
      touchHoldTimer.current = 0;
      coordinator.clearPending(tipId);
    }
    // A completed long-press is a tooltip-only gesture. Keep the coach visible
    // after release so it can actually be read; the following synthetic click
    // is consumed below, and outside tap/Escape dismisses the coach.
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLSpanElement>) {
    if (touchHoldOpened.current) {
      touchHoldOpened.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (disabled) {
      // Preserve native disabled controls and also guard custom button-like
      // descendants that do not implement disabled semantics themselves.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    dismissPointerActivation(event);
  }

  function handlePointerCancelCapture(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") return;
    clearTimers();
    dismissCoordinatedHintsImmediately();
    touchHoldOpened.current = false;
    touchHoldStart.current = null;
    pointerDismissed.current = false;
    clearPointerSuppression();
    setExpanded(false);
  }

  function clearFocusedDescription(target = describedFocusTarget.current) {
    if (!target) return;
    removeAriaDescription(target, tipId);
    if (describedFocusTarget.current === target) describedFocusTarget.current = null;
  }

  function describeFocusedControl(target: EventTarget | null) {
    if (disabled || !(target instanceof HTMLElement) || target === wrapRef.current) return;
    clearFocusedDescription();
    const descriptions = new Set(
      (target.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean)
    );
    descriptions.add(tipId);
    target.setAttribute("aria-describedby", [...descriptions].join(" "));
    describedFocusTarget.current = target;
  }

  function handleFocus(event: React.FocusEvent<HTMLSpanElement>) {
    if (consumeStudioToolHintFocusSuppression(event.target)) {
      pointerDismissed.current = true;
      clearFocusedDescription();
      dismissCoordinatedHintsImmediately();
      return;
    }
    clearHideTimer();
    if (pointerDismissed.current || preferences.mode === "off") return;
    // Pointer focus is already filtered by pointerdown suppression. Opening on
    // every remaining focus path clears any suppression left by a previously
    // clicked target. This lets Tab/assistive focus deliberately take over even
    // when the physical pointer has not moved yet, and also covers Safari/
    // embedded WebViews that do not reliably expose :focus-visible.
    pointerDismissed.current = false;
    clearPointerSuppression();
    describeFocusedControl(event.target);
    reveal(richCoachEnabled, "focus");
  }

  function handleMouseLeave(event: ReactMouseEvent<HTMLSpanElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      // Ignore synthetic leave events while traversal stays inside target DOM.
      return;
    }
    if (
      nextTarget instanceof Element &&
      nextTarget.closest('[data-studio-tool-hint="true"]') !== null
    ) {
      // Don't dismiss while moving into the currently rendered bubble itself.
      return;
    }
    const rect = wrapRef.current?.getBoundingClientRect();
    if (
      rect &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    ) {
      // Switching the active tool can replace descendants and synthesize a
      // mouseleave even though the physical pointer never left the hit target.
      return;
    }
    pointerDismissed.current = false;
    scheduleHide();
  }

  function handleBlur(event: React.FocusEvent<HTMLSpanElement>) {
    if (event.target === describedFocusTarget.current) clearFocusedDescription(event.target);
    pointerDismissed.current = false;
    scheduleHide();
  }

  useEffect(() => {
    if (preferences.mode !== "rich") {
      if (showTimer.current) globalThis.clearTimeout(showTimer.current);
      showTimer.current = 0;
      if (expandTimer.current) globalThis.clearTimeout(expandTimer.current);
      expandTimer.current = 0;
      setExpanded(false);
      if (preferences.mode === "off") {
        if (coordinator.getActiveHintId() === tipId) hideRenderedToolHintElement(tipId);
        coordinator.release(tipId);
        interaction.clearReveal(tipId);
        activeRevealIntent.current = null;
      }
    }
    return () => {
      clearTimers();
      coordinator.clearPending(tipId);
    };
  }, [coordinator, interaction, preferences.mode, tipId]);

  useEffect(
    () => () => {
      const target = describedFocusTarget.current;
      if (target) removeAriaDescription(target, tipId);
      coordinator.release(tipId);
      interaction.clearReveal(tipId);
      activeRevealIntent.current = null;
    },
    [coordinator, interaction, tipId]
  );

  useEffect(() => {
    if (observedDismissEpoch.current === dismissEpoch) return;
    observedDismissEpoch.current = dismissEpoch;
    clearTimers();
    activeRevealIntent.current = null;
    setExpanded(false);
    const target = describedFocusTarget.current;
    if (target) removeAriaDescription(target, tipId);
    describedFocusTarget.current = null;
  }, [dismissEpoch, tipId]);

  useEffect(() => {
    if (open) return;
    clearTimers();
    interaction.clearReveal(tipId);
    activeRevealIntent.current = null;
    setExpanded(false);
    const target = describedFocusTarget.current;
    if (!target) return;
    removeAriaDescription(target, tipId);
    describedFocusTarget.current = null;
  }, [interaction, open, tipId]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    function updatePosition() {
      globalThis.cancelAnimationFrame?.(frame);
      frame = globalThis.requestAnimationFrame?.(() => {
        const nextAnchor = readAnchor();
        if (nextAnchor) {
          lastValidAnchor.current = nextAnchor;
          setAnchor(nextAnchor);
        } else if (lastValidAnchor.current) {
          setAnchor(lastValidAnchor.current);
        }
      }) ?? 0;
    }
    globalThis.addEventListener("resize", updatePosition);
    globalThis.addEventListener("scroll", updatePosition, true);
    return () => {
      globalThis.cancelAnimationFrame?.(frame);
      globalThis.removeEventListener("resize", updatePosition);
      globalThis.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  if (!hint) {
    return <span className={cn("inline-flex", className)}>{children}</span>;
  }

  const canDescribeChild = isValidElement<DescribedChildProps>(children) && children.type !== Fragment;
  const childAccessibleLabel = canDescribeChild
    ? children.props["aria-label"] ?? children.props.title
    : undefined;
  let describedChildren = children;
  if (canDescribeChild) {
    describedChildren = cloneElement(children, {
      title: undefined,
      "aria-label": childAccessibleLabel,
      ...(disabled
        ? {
            "aria-disabled": true,
            tabIndex: -1,
          }
        : open
          ? {
              "aria-describedby": [children.props["aria-describedby"], tipId]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
    });
  }
  const needsWrapperDescription = open && (disabled || !canDescribeChild);

  return (
    <span
      ref={wrapRef}
      data-studio-tool-hint-target="true"
      data-studio-tool-hint-unavailable={disabled ? "true" : undefined}
      className={cn(
        "relative inline-flex",
        disabled && "rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        className
      )}
      onMouseEnter={scheduleShow}
      onMouseLeave={handleMouseLeave}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerCancelCapture={handlePointerCancelCapture}
      onClickCapture={handleClickCapture}
      onFocus={handleFocus}
      onBlur={handleBlur}
      role={disabled ? "group" : undefined}
      aria-label={disabled ? childAccessibleLabel ?? hint.title : undefined}
      aria-describedby={needsWrapperDescription ? tipId : undefined}
      tabIndex={disabled ? 0 : undefined}
    >
      {describedChildren}
      {open && !isPointerSuppressionActiveForTip(tipId) && anchor && typeof document !== "undefined"
        ? createPortal(
            <Suspense
              fallback={(
                <StudioToolHintCompactFallback
                  id={tipId}
                  hint={hint}
                  anchor={anchor}
                  unavailableReason={unavailableReason}
                  preferredSide={preferredSide}
                  reducedMotion={preferences.reduceMotion}
                  onMouseEnter={keepOpenFromBubble}
                  onMouseLeave={leaveBubble}
                />
              )}
            >
              <LazyStudioToolHintBubble
                id={tipId}
                hint={hint}
                anchor={anchor}
                expanded={expanded}
                richPreviewEnabled={
                  richCoachEnabled && activeRevealIntent.current !== "touch"
                }
                reducedMotion={preferences.reduceMotion}
                unavailableReason={unavailableReason}
                preferredSide={preferredSide}
                onMouseEnter={keepOpenFromBubble}
                onMouseLeave={leaveBubble}
              />
            </Suspense>,
            document.body
          )
        : null}
    </span>
  );
}
