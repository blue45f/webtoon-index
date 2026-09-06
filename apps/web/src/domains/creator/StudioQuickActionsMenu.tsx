import {
  Move,
  Settings2,
  X,
} from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  STUDIO_ICON_SIZE,
  STUDIO_ICON_STROKE,
  studioChromeIconClass,
} from "./studio-chrome-ui";
import { STUDIO_QUICK_ACTION_PRESENTATION } from "./studio-quick-action-presentation";
import {
  clampStudioQuickActionsCenter,
  QUICK_ACTION_IDS,
  QUICK_ACTION_SLOTS,
  quickActionSlotFromVector,
  updateStudioQuickActionSlot,
} from "./studio-quick-actions";

import type {
  StudioQuickActionId,
  StudioQuickActionsPoint,
  StudioQuickActionsPreferences,
  StudioQuickActionSlot,
} from "./studio-quick-actions";

const QUICK_ACTION_RADIUS_PX = 104;
const QUICK_ACTION_MARGIN_PX = 48;
const QUICK_ACTION_BOTTOM_DOCK_PX = 104;
const QUICK_ACTION_DEAD_ZONE_PX = 28;

const SLOT_PRESENTATION: Record<
  StudioQuickActionSlot,
  { label: string; offset: StudioQuickActionsPoint }
> = {
  north: { label: "위 슬롯", offset: { x: 0, y: -QUICK_ACTION_RADIUS_PX } },
  northEast: { label: "오른쪽 위 슬롯", offset: { x: 90, y: -52 } },
  southEast: { label: "오른쪽 아래 슬롯", offset: { x: 90, y: 52 } },
  south: { label: "아래 슬롯", offset: { x: 0, y: QUICK_ACTION_RADIUS_PX } },
  southWest: { label: "왼쪽 아래 슬롯", offset: { x: -90, y: 52 } },
  northWest: { label: "왼쪽 위 슬롯", offset: { x: -90, y: -52 } },
};

const ACTION_PRESENTATION = STUDIO_QUICK_ACTION_PRESENTATION;

export interface StudioQuickActionsMenuProps {
  open: boolean;
  anchor: StudioQuickActionsPoint;
  preferences: StudioQuickActionsPreferences;
  disabledActions: readonly StudioQuickActionId[];
  onExecute: (action: StudioQuickActionId) => void;
  onPreferencesChange: (preferences: StudioQuickActionsPreferences) => void;
  onClose: () => void;
}

export interface StudioQuickActionsCustomizationSheetProps {
  preferences: StudioQuickActionsPreferences;
  onPreferencesChange: (preferences: StudioQuickActionsPreferences) => void;
  onDone: () => void;
}

function viewportFrame(): { width: number; height: number; offsetX: number; offsetY: number } {
  if (typeof window === "undefined") {
    return { width: 390, height: 844, offsetX: 0, offsetY: 0 };
  }
  const visualViewport = window.visualViewport;
  return {
    width: Math.max(0, visualViewport?.width ?? window.innerWidth),
    height: Math.max(0, visualViewport?.height ?? window.innerHeight),
    offsetX: Math.max(0, visualViewport?.offsetLeft ?? 0),
    offsetY: Math.max(0, visualViewport?.offsetTop ?? 0),
  };
}

function actionIsDisabled(
  disabledActions: readonly StudioQuickActionId[],
  action: StudioQuickActionId
): boolean {
  return disabledActions.includes(action);
}

function slotButtonClass(highlighted: boolean, disabled: boolean): string {
  const stateClass = disabled
    ? "cursor-not-allowed border-line bg-card/95 text-fg-3 opacity-70"
    : highlighted
      ? "scale-105 border-accent bg-accent text-on-accent shadow-xl"
      : "border-line-strong bg-panel/95 text-fg shadow-lg hover:border-accent/65 hover:bg-raised active:scale-95";
  return `flex h-16 w-[5.25rem] flex-col items-center justify-center gap-0.5 rounded-2xl border px-1.5 text-center transition-[transform,background-color,border-color,color] duration-200 ease-out-expo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transform-none motion-reduce:transition-none ${stateClass}`;
}

/**
 * 퀵 액션 슬롯을 즉시 교체하는 독립 시트. 메인 오버레이와 정적 렌더 테스트가 같은
 * 마크업을 공유하도록 별도 컴포넌트로 둔다.
 */
export function StudioQuickActionsCustomizationSheet({
  preferences,
  onPreferencesChange,
  onDone,
}: StudioQuickActionsCustomizationSheetProps) {
  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-actions-customize-title"
      className="fixed inset-x-2 bottom-2 z-[71] mx-auto max-h-[min(42rem,calc(100dvh-1rem))] w-auto max-w-xl overflow-y-auto rounded-2xl border border-line bg-panel text-fg shadow-2xl sm:bottom-4"
      style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
    >
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Settings2
            size={STUDIO_ICON_SIZE.dock}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "accent" })}
          />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="quick-actions-customize-title" className="text-sm font-bold text-fg">
            퀵 액션 구성
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-3">
            여섯 방향마다 원하는 작업을 고르세요. 같은 작업을 여러 방향에 둘 수도 있어요.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          aria-label="퀵 액션 구성 닫기"
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <X
            size={STUDIO_ICON_SIZE.toolCompact}
            strokeWidth={STUDIO_ICON_STROKE}
            aria-hidden
            className={studioChromeIconClass({ tone: "default" })}
          />
        </button>
      </header>

      <div className="grid gap-2 px-4 py-3 sm:grid-cols-2">
        {QUICK_ACTION_SLOTS.map((slot, index) => {
          const action = preferences.slots[slot];
          return (
            <label
              key={slot}
              className="rounded-xl border border-line bg-card/45 px-3 py-2 text-xs font-semibold text-fg-2 focus-within:border-accent"
            >
              <span className="flex items-center justify-between gap-2">
                <span>{SLOT_PRESENTATION[slot].label}</span>
                <span className="font-normal text-fg-3">{ACTION_PRESENTATION[action].label}</span>
              </span>
              <select
                data-quick-actions-initial-focus={index === 0 ? "true" : undefined}
                data-quick-action-slot={slot}
                aria-label={`${SLOT_PRESENTATION[slot].label} 액션`}
                value={action}
                onChange={(event) =>
                  onPreferencesChange(
                    updateStudioQuickActionSlot(
                      preferences,
                      slot,
                      event.currentTarget.value as StudioQuickActionId
                    )
                  )
                }
                className="mt-1.5 min-h-11 w-full rounded-lg border border-line-strong bg-panel px-2.5 text-sm text-fg outline-none transition-colors hover:border-accent/60 focus:border-accent"
              >
                {QUICK_ACTION_IDS.map((actionId) => (
                  <option key={actionId} value={actionId}>
                    {ACTION_PRESENTATION[actionId].label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <div className="sticky bottom-0 border-t border-line bg-panel px-4 pb-1 pt-3">
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 w-full rounded-xl bg-accent px-4 text-sm font-bold text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          구성 완료
        </button>
      </div>
    </section>
  );
}

export function StudioQuickActionsMenu({
  open,
  anchor,
  preferences,
  disabledActions,
  onExecute,
  onPreferencesChange,
  onClose,
}: StudioQuickActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const activePointerRef = useRef<number | null>(null);
  const highlightedSlotRef = useRef<StudioQuickActionSlot | null>(null);
  const closeRequestedRef = useRef(false);
  const executedRef = useRef(false);
  const [customizing, setCustomizing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [highlightedSlot, setHighlightedSlot] = useState<StudioQuickActionSlot | null>(null);
  const [, setViewportRevision] = useState(0);

  const viewport = viewportFrame();
  const relativeCenter = clampStudioQuickActionsCenter(
    { x: anchor.x - viewport.offsetX, y: anchor.y - viewport.offsetY },
    viewport,
    {
    radius: QUICK_ACTION_RADIUS_PX,
    margin: QUICK_ACTION_MARGIN_PX,
    bottomInset: QUICK_ACTION_BOTTOM_DOCK_PX,
    }
  );
  const center = {
    x: relativeCenter.x + viewport.offsetX,
    y: relativeCenter.y + viewport.offsetY,
  };

  function clearGesture(): void {
    activePointerRef.current = null;
    highlightedSlotRef.current = null;
    setDragging(false);
    setHighlightedSlot(null);
  }

  function requestClose(): void {
    if (closeRequestedRef.current) return;
    closeRequestedRef.current = true;
    setCustomizing(false);
    clearGesture();
    onClose();
  }

  function executeAction(action: StudioQuickActionId): void {
    if (executedRef.current || actionIsDisabled(disabledActions, action)) return;
    executedRef.current = true;
    onExecute(action);
    requestClose();
  }

  function updateHighlightedSlot(slot: StudioQuickActionSlot | null): void {
    if (highlightedSlotRef.current === slot) return;
    highlightedSlotRef.current = slot;
    setHighlightedSlot(slot);
    if (slot && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(8);
    }
  }

  const requestCloseFromEffect = useEffectEvent(requestClose);

  useEffect(() => {
    if (!open) return;
    closeRequestedRef.current = false;
    executedRef.current = false;
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => hubRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(focusTimer);
      restoreFocusRef.current?.focus({ preventScroll: true });
      restoreFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const focusTimer = window.setTimeout(() => {
      const target = customizing
        ? rootRef.current?.querySelector<HTMLElement>("[data-quick-actions-initial-focus]")
        : hubRef.current;
      target?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [customizing, open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestCloseFromEffect();
      else handleFocusTrap(event);
    };
    // 키보드·주소창·분할 화면이 만드는 resize는 메뉴를 닫지 않고 보이는 visual viewport 안으로
    // 다시 배치한다. 물리적 방향 전환만 제스처 문맥이 크게 바뀌므로 닫는다.
    const handleViewportChange = () => setViewportRevision((revision) => revision + 1);
    const handleOrientationChange = () => requestCloseFromEffect();
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.screen.orientation?.addEventListener("change", handleOrientationChange);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.screen.orientation?.removeEventListener("change", handleOrientationChange);
    };
  }, [open]);

  if (!open) return null;

  function handleFocusTrap(event: KeyboardEvent): void {
    if (event.key !== "Tab") return;
    const focusable = [...(rootRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]):not([tabindex="-1"]), select:not([disabled]), [tabindex="0"]'
    ) ?? [])].filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const enabledItems = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"]:not([disabled])'
    ) ?? [])];
    if (enabledItems.length === 0) return;
    const currentIndex = enabledItems.findIndex((item) => item === document.activeElement);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (Math.max(0, currentIndex) + 1) % enabledItems.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex <= 0 ? enabledItems.length : currentIndex) - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledItems.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    enabledItems[nextIndex]?.focus();
  }

  function focusFirstEnabledAction(): void {
    if (executedRef.current) return;
    menuRef.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled])')
      ?.focus({ preventScroll: true });
  }

  function handleHubPointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    highlightedSlotRef.current = null;
    setHighlightedSlot(null);
    setDragging(true);
  }

  function handleHubPointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    if (activePointerRef.current !== event.pointerId) return;
    updateHighlightedSlot(
      quickActionSlotFromVector(
        event.clientX - center.x,
        event.clientY - center.y,
        QUICK_ACTION_DEAD_ZONE_PX
      )
    );
  }

  function handleHubPointerUp(event: React.PointerEvent<HTMLButtonElement>): void {
    if (activePointerRef.current !== event.pointerId) return;
    const slot = quickActionSlotFromVector(
      event.clientX - center.x,
      event.clientY - center.y,
      QUICK_ACTION_DEAD_ZONE_PX
    );
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearGesture();
    if (!slot) return;
    const action = preferences.slots[slot];
    if (!actionIsDisabled(disabledActions, action)) executeAction(action);
  }

  function handleHubPointerCancel(event: React.PointerEvent<HTMLButtonElement>): void {
    if (activePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clearGesture();
  }

  const overlay = (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[70] text-fg"
      style={{
        paddingTop: "max(0.75rem, env(safe-area-inset-top))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
      }}
      data-quick-actions-overlay="true"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="퀵 액션 닫기"
        onClick={requestClose}
        className="absolute inset-0 cursor-default bg-canvas/65"
      />
      {customizing ? (
        <StudioQuickActionsCustomizationSheet
          preferences={preferences}
          onPreferencesChange={onPreferencesChange}
          onDone={() => setCustomizing(false)}
        />
      ) : (
        <>
          <div
            ref={menuRef}
            role="menu"
            aria-label="캔버스 퀵 액션"
            tabIndex={-1}
            className="absolute size-0"
            style={{ left: center.x, top: center.y }}
            onKeyDown={handleMenuKeyDown}
          >
            {QUICK_ACTION_SLOTS.map((slot) => {
              const action = preferences.slots[slot];
              const actionPresentation = ACTION_PRESENTATION[action];
              const slotPresentation = SLOT_PRESENTATION[slot];
              const disabled = actionIsDisabled(disabledActions, action);
              const highlighted = highlightedSlot === slot;
              const Icon = actionPresentation.Icon;
              return (
                <div
                  key={slot}
                  className="absolute"
                  style={{
                    left: slotPresentation.offset.x,
                    top: slotPresentation.offset.y,
                    transform: "translate(-50%, -50%)",
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    data-quick-action-slot={slot}
                    data-highlighted={highlighted ? "true" : "false"}
                    aria-label={`${slotPresentation.label}: ${actionPresentation.label}${disabled ? " (사용 불가)" : ""}`}
                    aria-disabled={disabled}
                    disabled={disabled}
                    onClick={() => executeAction(action)}
                    className={slotButtonClass(highlighted, disabled)}
                  >
                    <Icon
                      size={STUDIO_ICON_SIZE.dock}
                      strokeWidth={STUDIO_ICON_STROKE}
                      aria-hidden
                      className={studioChromeIconClass({ tone: "default" })}
                    />
                    <span className="max-w-full truncate text-[0.68rem] font-bold leading-tight">
                      {actionPresentation.label}
                    </span>
                    <span className="max-w-full truncate text-[0.58rem] font-medium leading-tight opacity-75">
                      {disabled ? "사용 불가" : slotPresentation.label}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          <button
            ref={hubRef}
            type="button"
            aria-label="퀵 액션 드래그 선택"
            aria-describedby="quick-actions-drag-hint"
            data-dragging={dragging ? "true" : "false"}
            onClick={focusFirstEnabledAction}
            onPointerDown={handleHubPointerDown}
            onPointerMove={handleHubPointerMove}
            onPointerUp={handleHubPointerUp}
            onPointerCancel={handleHubPointerCancel}
            className={`absolute grid size-16 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full border-2 shadow-2xl transition-[transform,background-color,border-color] duration-200 ease-out-expo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent motion-reduce:transition-none ${
              dragging
                ? "scale-95 border-accent bg-accent text-on-accent"
                : "border-line-strong bg-panel text-fg hover:border-accent"
            }`}
            style={{ left: center.x, top: center.y }}
          >
            <span className="flex flex-col items-center gap-0.5">
              <Move
                size={STUDIO_ICON_SIZE.dock}
                strokeWidth={STUDIO_ICON_STROKE}
                aria-hidden
                className={studioChromeIconClass({ tone: "accent" })}
              />
              <span className="text-[0.6rem] font-bold">드래그</span>
            </span>
          </button>
          <p id="quick-actions-drag-hint" className="sr-only">
            원하는 방향으로 끌었다 놓으면 작업을 실행합니다. 중앙에서 놓으면 아무 작업도 실행하지 않습니다.
            키보드에서는 Enter 또는 Space로 방향 작업 목록으로 이동합니다.
          </p>

          <button
            type="button"
            onClick={() => {
              clearGesture();
              setCustomizing(true);
            }}
            className="fixed inset-x-0 bottom-3 mx-auto flex min-h-11 w-fit items-center justify-center gap-2 rounded-xl border border-line-strong bg-panel px-4 text-xs font-bold text-fg shadow-xl transition-colors hover:border-accent hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ bottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            aria-label="퀵 액션 구성 열기"
          >
            <Settings2
              size={STUDIO_ICON_SIZE.toolCompact}
              strokeWidth={STUDIO_ICON_STROKE}
              aria-hidden
              className={studioChromeIconClass({ tone: "accent" })}
            />
            퀵 액션 구성
          </button>
        </>
      )}
    </div>
  );
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
