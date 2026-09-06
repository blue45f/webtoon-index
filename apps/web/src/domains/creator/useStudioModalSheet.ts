import {
  useEffectEvent,
  useLayoutEffect,
  type RefObject,
} from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface AttributeSnapshot {
  ariaHidden: string | null;
  element: Element;
  inert: string | null;
}

export interface StudioModalSheetActivationOptions {
  dialog: HTMLElement;
  document: Document;
  fallbackReturnFocus?: HTMLElement | null;
  initialFocus?: HTMLElement | null;
  onDismiss: () => void;
  returnFocus?: HTMLElement | null;
  root: HTMLElement;
}

interface UseStudioModalSheetOptions {
  activeKey: string | null;
  dialogRef: RefObject<HTMLElement | null>;
  fallbackReturnFocusRef?: RefObject<HTMLElement | null>;
  onDismiss: () => void;
  resolveInitialFocus?: (dialog: HTMLElement) => HTMLElement | null;
  resolveReturnFocus?: () => HTMLElement | null;
  rootRef: RefObject<HTMLElement | null>;
  /**
   * 사용자가 부른 게 아니라 스스로 뜨는 시트(코치·안내)는 이걸 켠다. 활성화 시점에 남의
   * 모달이 이미 포커스를 쥐고 있으면 계약을 아예 걸지 않는다 — 걸었다가 푸는 것으로는
   * 부족하다. 해제 경로가 포커스를 자기 복귀 지점(메뉴바 첫 트리거)으로 돌려보내서,
   * 사용자가 방금 연 다이얼로그에서 포커스를 빼앗는 것이 실측된 회귀였다
   * (2026-08-21 verify-studio-launch: `focus holder: button[File]`).
   * 사용자가 다이얼로그 안 컨트롤로 연 중첩 확인창은 이 옵션을 켜지 않으므로 영향이 없다.
   */
  yieldToOpenModal?: boolean;
}

function canReceiveFocus(element: Element | null): element is HTMLElement {
  if (!element || typeof (element as HTMLElement).focus !== "function") return false;
  const candidate = element as HTMLElement;
  if (candidate.hasAttribute("hidden")) return false;
  if (candidate.closest("[hidden], [inert], [aria-hidden='true']")) return false;
  if ("disabled" in candidate && Boolean((candidate as HTMLButtonElement).disabled)) return false;

  const view = candidate.ownerDocument?.defaultView;
  if (view && typeof candidate.getClientRects === "function") {
    const style = view.getComputedStyle(candidate);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (candidate.getClientRects().length === 0) return false;
  }
  return true;
}

function canRestoreFocusLater(element: Element | null): element is HTMLElement {
  if (!element || typeof (element as HTMLElement).focus !== "function") return false;
  const candidate = element as HTMLElement;
  if (
    candidate === candidate.ownerDocument.body
    || candidate === candidate.ownerDocument.documentElement
  ) return false;
  if (!candidate.isConnected) return false;
  if ("disabled" in candidate && Boolean((candidate as HTMLButtonElement).disabled)) return false;
  // A launcher can become inert in the same React commit that mounts the modal (brush settings →
  // brush manager). It is still the correct return target once that sibling is promoted again.
  return true;
}

function focusElement(element: HTMLElement | null | undefined): boolean {
  const candidate = element ?? null;
  if (!canReceiveFocus(candidate)) return false;
  candidate.focus({ preventScroll: true });
  return true;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (element) => element.tabIndex >= 0 && canReceiveFocus(element),
  );
}

function defaultInitialFocus(dialog: HTMLElement): HTMLElement | null {
  const requested = dialog.querySelector<HTMLElement>("[data-autofocus]");
  if (canReceiveFocus(requested)) return requested;
  return focusableElements(dialog)[0] ?? null;
}

function targetsAnotherModal(target: EventTarget | null, dialog: HTMLElement): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const targetModal = (target as Element).closest<HTMLElement>("[aria-modal='true']");
  return targetModal !== null && targetModal !== dialog;
}

function isolateModalBranch(root: HTMLElement, dialog: HTMLElement): () => void {
  if (!root.contains(dialog)) return () => undefined;

  const snapshots: AttributeSnapshot[] = [];
  let branch: Element = dialog;
  while (branch !== root) {
    const parent = branch.parentElement;
    if (!parent) break;
    for (const sibling of [...parent.children]) {
      if (sibling === branch) continue;
      // The visual scrim is intentionally pointer-only and already aria-hidden. Keeping it out of
      // `inert` lets a touch outside the sheet dismiss the modal while the focus loop still keeps
      // keyboard and assistive-technology navigation inside the dialog.
      if (sibling.getAttribute("data-studio-modal-backdrop") === "true") continue;
      snapshots.push({
        ariaHidden: sibling.getAttribute("aria-hidden"),
        element: sibling,
        inert: sibling.getAttribute("inert"),
      });
      sibling.setAttribute("aria-hidden", "true");
      sibling.setAttribute("inert", "");
    }
    branch = parent;
  }

  return () => {
    for (const snapshot of snapshots) {
      // React may have intentionally changed a sibling while the modal closes (notably brushes →
      // draw removes the underlying draw sheet's own `inert`). Restore only attributes that still
      // carry the exact value imposed by this isolator; never overwrite newer application state.
      if (snapshot.element.getAttribute("aria-hidden") === "true") {
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
        else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
      }
      if (snapshot.element.getAttribute("inert") === "") {
        if (snapshot.inert === null) snapshot.element.removeAttribute("inert");
        else snapshot.element.setAttribute("inert", snapshot.inert);
      }
    }
  };
}

/**
 * Activates the modal contract shared by Studio's mobile page, properties, and brush-manager
 * sheets. The dialog must already be mounted and explicitly declare aria-modal="true".
 */
export function activateStudioModalSheet({
  dialog,
  document: ownerDocument,
  fallbackReturnFocus,
  initialFocus,
  onDismiss,
  returnFocus,
  root,
}: StudioModalSheetActivationOptions): () => void {
  // The brush-settings sheet intentionally stays non-modal so artists can keep seeing and using
  // the canvas. Guarding the DOM attribute here prevents a caller from trapping it accidentally.
  if (dialog.getAttribute("aria-modal") !== "true") return () => undefined;

  const returnTarget = canRestoreFocusLater(returnFocus ?? null)
    ? returnFocus
    : canRestoreFocusLater(ownerDocument.activeElement)
      ? ownerDocument.activeElement
      : null;
  const target = canReceiveFocus(initialFocus ?? null)
    ? initialFocus
    : defaultInitialFocus(dialog);
  if (!focusElement(target)) focusElement(dialog);

  const restoreBackground = isolateModalBranch(root, dialog);
  const focusFirst = () => focusElement(focusableElements(dialog)[0]) || focusElement(dialog);

  const onKeyDown = (event: KeyboardEvent) => {
    // A sheet control may open a nested confirmation dialog (often through a portal). The newest
    // modal owns its Escape and focus loop; the underlying mobile sheet must stay dormant.
    if (targetsAnotherModal(event.target, dialog)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;

    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      focusElement(dialog);
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      focusElement(last);
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      focusElement(first);
    }
  };
  const onFocusIn = (event: FocusEvent) => {
    if (targetsAnotherModal(event.target, dialog)) return;
    if (event.target && dialog.contains(event.target as Node)) return;
    focusFirst();
  };

  ownerDocument.addEventListener("keydown", onKeyDown, true);
  ownerDocument.addEventListener("focusin", onFocusIn, true);
  return () => {
    ownerDocument.removeEventListener("keydown", onKeyDown, true);
    ownerDocument.removeEventListener("focusin", onFocusIn, true);
    restoreBackground();
    if (returnTarget?.isConnected && !returnTarget.closest("[inert]")) {
      if (focusElement(returnTarget)) return;
    }
    if (
      fallbackReturnFocus?.isConnected &&
      !fallbackReturnFocus.closest("[inert]")
    ) {
      focusElement(fallbackReturnFocus);
    }
  };
}

/** Owns focus, Escape, background isolation, and trigger restoration for one active modal sheet. */
export function useStudioModalSheet({
  activeKey,
  dialogRef,
  fallbackReturnFocusRef,
  onDismiss,
  resolveInitialFocus,
  resolveReturnFocus,
  rootRef,
  yieldToOpenModal = false,
}: UseStudioModalSheetOptions): void {
  const dismissFromEffect = useEffectEvent(onDismiss);
  const resolveInitialFocusFromEffect = useEffectEvent(
    (dialog: HTMLElement) => resolveInitialFocus?.(dialog) ?? null,
  );
  const resolveReturnFocusFromEffect = useEffectEvent(
    () => resolveReturnFocus?.() ?? null,
  );

  useLayoutEffect(() => {
    if (!activeKey) return;
    const root = rootRef.current;
    if (!root) return;
    if (yieldToOpenModal && holdsForeignModalFocus(root.ownerDocument, dialogRef.current)) {
      return;
    }
    const requestedReturnFocus = resolveReturnFocusFromEffect();
    const ownerDocument = root.ownerDocument;
    const returnFocus = canRestoreFocusLater(requestedReturnFocus)
      ? requestedReturnFocus
      : canRestoreFocusLater(ownerDocument.activeElement)
        ? ownerDocument.activeElement
        : fallbackReturnFocusRef?.current;
    let activeDialog: HTMLElement | null = null;
    let deactivate: (() => void) | null = null;

    const synchronizeDialog = () => {
      const dialog = dialogRef.current;
      if (!dialog || dialog === activeDialog) return;
      deactivate?.();
      activeDialog = dialog;
      deactivate = activateStudioModalSheet({
        dialog,
        document: dialog.ownerDocument,
        fallbackReturnFocus: fallbackReturnFocusRef?.current,
        initialFocus: resolveInitialFocusFromEffect(dialog),
        onDismiss: dismissFromEffect,
        returnFocus,
        root,
      });
    };

    synchronizeDialog();
    // A retryable Suspense boundary can replace a loading shell with the real dialog after this
    // layout effect. Rebind the modal contract to the new node instead of leaving focus ownership
    // attached to a detached fallback.
    const Observer = ownerDocument.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    const observer = Observer ? new Observer(synchronizeDialog) : null;
    observer?.observe(root, { childList: true, subtree: true });
    const frame = ownerDocument.defaultView?.requestAnimationFrame?.(synchronizeDialog);

    return () => {
      if (frame !== undefined) ownerDocument.defaultView?.cancelAnimationFrame?.(frame);
      observer?.disconnect();
      deactivate?.();
    };
  }, [activeKey, dialogRef, fallbackReturnFocusRef, rootRef, yieldToOpenModal]);
}

/** True when focus already sits inside a modal dialog that is not this sheet's own. */
export function holdsForeignModalFocus(
  ownerDocument: Document,
  ownDialog: HTMLElement | null,
): boolean {
  const active = ownerDocument.activeElement;
  if (!active) return false;
  const modal = active.closest('[aria-modal="true"]');
  if (!modal) return false;
  if (!ownDialog) return true;
  return modal !== ownDialog
    && !ownDialog.contains(modal)
    && !modal.contains(ownDialog);
}
