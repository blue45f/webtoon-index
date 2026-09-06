/**
 * Studio-wide fallback for body-portalled modal focus restoration.
 * Observe only body's direct children, not the hot canvas subtree. A dialog that
 * restores its own focus always wins: retry only while focus is on the document.
 */
const MODAL_SELECTOR = '[aria-modal="true"]';
const FALLBACK_ANCHOR_SELECTOR = "[data-studio-main-menu-trigger]";

function asElement(node: Node | null): Element | null {
  return node?.nodeType === 1 ? (node as Element) : null;
}

function modalWithin(root: Element): Element | null {
  return root.matches(MODAL_SELECTOR) ? root : root.querySelector(MODAL_SELECTOR);
}

function insideModal(element: Element): boolean {
  return element.closest(MODAL_SELECTOR) !== null;
}

/**
 * Check eligibility without moving focus or relying on layout measurements.
 * getClientRects() would reject every element in jsdom, and offscreen controls
 * remain valid programmatic focus destinations. Native :disabled includes a
 * disabled fieldset while retaining the first-legend exception.
 */
export function canReturnStudioDialogFocus(
  element: Element | null,
  ownerDocument: Document,
): element is HTMLElement {
  if (!element || element.ownerDocument !== ownerDocument) return false;
  const candidate = element as HTMLElement;
  if (typeof candidate.focus !== "function" || !candidate.isConnected) return false;
  if (candidate === ownerDocument.body || candidate === ownerDocument.documentElement) return false;
  if (candidate.closest("[inert], [hidden], [aria-hidden='true']")) return false;
  if (candidate.matches(":disabled")) return false;

  const view = ownerDocument.defaultView;
  if (view) {
    const visibility = view.getComputedStyle(candidate).visibility;
    if (visibility === "hidden" || visibility === "collapse") return false;
    // A child's visibility may explicitly override its parent's; display:none
    // and content-visibility:hidden, unlike visibility, cannot be overridden.
    for (let ancestor: Element | null = candidate; ancestor; ancestor = ancestor.parentElement) {
      const style = view.getComputedStyle(ancestor);
      if (style.display === "none" || style.contentVisibility === "hidden") return false;
    }
  }
  // Closed details hide everything except the first summary and its descendants.
  for (let ancestor = candidate.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.tagName !== "DETAILS" || ancestor.hasAttribute("open")) continue;
    const summary = Array.from(ancestor.children).find((child) => child.tagName === "SUMMARY");
    if (!summary?.contains(candidate)) return false;
  }
  return true;
}

export function studioDialogFocusWasDropped(ownerDocument: Document): boolean {
  const active = ownerDocument.activeElement;
  return active === null || active === ownerDocument.body || active === ownerDocument.documentElement;
}

export function resolveStudioDialogOpener(
  ownerDocument: Document,
  lastOutsideFocus: Element | null,
): HTMLElement | null {
  const active = ownerDocument.activeElement;
  if (active && !insideModal(active) && canReturnStudioDialogFocus(active, ownerDocument)) return active;
  return canReturnStudioDialogFocus(lastOutsideFocus, ownerDocument) ? lastOutsideFocus : null;
}

/** Skip hidden desktop/mobile copies and temporarily disabled menu triggers. */
export function studioDialogFocusAnchor(ownerDocument: Document): HTMLElement | null {
  for (const anchor of ownerDocument.querySelectorAll<HTMLElement>(FALLBACK_ANCHOR_SELECTOR)) {
    if (canReturnStudioDialogFocus(anchor, ownerDocument)) return anchor;
  }
  return null;
}

/** Try only the supplied scope; callers own whether background fallbacks are allowed. */
function focusStudioDialogCandidates(
  candidates: readonly (Element | null)[],
  ownerDocument: Document,
): boolean {
  const attempted = new Set<Element>();
  for (const target of candidates) {
    if (!canReturnStudioDialogFocus(target, ownerDocument) || attempted.has(target)) continue;
    attempted.add(target);
    try {
      target.focus({ preventScroll: true });
    } catch {
      // A detached browsing context or a custom focus implementation can fail.
      // Continue to a verified fallback instead of reporting a false success.
      continue;
    }
    if (ownerDocument.activeElement === target) return true;
  }
  return false;
}

/** Return true only when the browser actually accepted a focus destination. */
export function returnStudioDialogFocus(opener: Element | null, ownerDocument: Document): boolean {
  return focusStudioDialogCandidates([
    opener,
    ...ownerDocument.querySelectorAll<HTMLElement>(FALLBACK_ANCHOR_SELECTOR),
  ], ownerDocument);
}

interface StudioModalFocusEntry {
  readonly modal: Element;
  // Retain the ancestor chain even if multiple portals close in one DOM batch.
  readonly openers: readonly (Element | null)[];
}

// Each owner document has its own lifecycle (preview windows / iframe hosts).
const installations = new WeakMap<Document, () => void>();

export function installStudioDialogFocusReturn(
  ownerDocument: Document | null = typeof document === "undefined" ? null : document,
): () => void {
  if (!ownerDocument) return () => undefined;
  const existing = installations.get(ownerDocument);
  if (existing) return existing;
  const view = ownerDocument.defaultView;
  const Observer = view?.MutationObserver;
  const body = ownerDocument.body;
  if (!body || !Observer || !view) return () => undefined;

  const openers = new Map<Element, StudioModalFocusEntry>();
  const modalFocus = new WeakMap<Element, Element>();
  let lastOutsideFocus: Element | null = resolveStudioDialogOpener(ownerDocument, null);
  let settleTimer: number | null = null;
  let settleFrame: number | null = null;
  let disposed = false;

  const cancelSettle = () => {
    if (settleTimer !== null) view.clearTimeout(settleTimer);
    if (settleFrame !== null) view.cancelAnimationFrame(settleFrame);
    settleTimer = null;
    settleFrame = null;
  };
  const activeModalEntry = (): StudioModalFocusEntry | null => {
    let latest: StudioModalFocusEntry | null = null;
    for (const [portal, entry] of openers) {
      if (portal.isConnected && entry.modal.getAttribute("aria-modal") === "true") latest = entry;
    }
    return latest;
  };
  const restoreIfDropped = (candidates: readonly (Element | null)[]) => {
    if (disposed || !studioDialogFocusWasDropped(ownerDocument)) return;
    const entry = activeModalEntry();
    if (entry) {
      // A surviving parent/child modal owns the return path. Never use the
      // background menubar just because its opener is inert or was removed.
      const scope = entry.modal;
      focusStudioDialogCandidates([
        ...candidates.filter((candidate) => candidate !== null && scope.contains(candidate)),
        modalFocus.get(scope) ?? null,
        scope.querySelector("[autofocus]"),
        scope,
        ...scope.querySelectorAll("button, a[href], input, select, textarea, [tabindex], [contenteditable='true']"),
      ], ownerDocument);
      return;
    }
    focusStudioDialogCandidates([
      ...candidates,
      ...ownerDocument.querySelectorAll<HTMLElement>(FALLBACK_ANCHOR_SELECTOR),
    ], ownerDocument);
  };
  // Backdrop mousedown can drop focus after the first restoration. Passive
  // cleanup may also release inert later. Recheck, never unconditionally focus.
  const restoreWhenSettled = (candidates: readonly (Element | null)[]) => {
    cancelSettle();
    restoreIfDropped(candidates);
    settleTimer = view.setTimeout(() => {
      settleTimer = null;
      restoreIfDropped(candidates);
    }, 0);
    settleFrame = view.requestAnimationFrame(() => {
      settleFrame = null;
      restoreIfDropped(candidates);
    });
  };
  const onFocusIn = (event: Event) => {
    const target = asElement(event.target as Node | null);
    if (!target || target === body) return;
    const modal = target.closest(MODAL_SELECTOR);
    if (modal) modalFocus.set(modal, target);
    else lastOutsideFocus = target;
  };
  const rememberPortal = (element: Element) => {
    if (openers.has(element)) return;
    const modal = modalWithin(element);
    if (!modal) return;
    const parent = activeModalEntry();
    const active = ownerDocument.activeElement;
    const current = active && !element.contains(active) && active !== body
      && (!parent || parent.modal.contains(active)) ? active : null;
    // Capture before testing eligibility: a child's layout effect can already
    // have made its parent inert. Eligibility is rechecked on each return tick.
    const candidates = parent
      ? [current, modalFocus.get(parent.modal) ?? null, parent.modal, ...parent.openers]
      : [current, lastOutsideFocus];
    openers.set(element, { modal, openers: candidates });
  };
  // A host may install after another modal has already mounted.
  for (const element of body.children) rememberPortal(element);
  const observer = new Observer((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        const element = asElement(node);
        if (element) rememberPortal(element);
      }
    }
    const pendingCandidates: (Element | null)[] = [];
    let pendingRestore = false;
    for (const record of records) {
      for (const node of record.removedNodes) {
        const element = asElement(node);
        if (!element || element.isConnected) continue;
        const entry = openers.get(element);
        if (!entry) continue;
        // The latest removed portal's opener chain is tried first, followed by
        // earlier chains if their controls were removed in the same batch.
        pendingCandidates.unshift(...entry.openers);
        pendingRestore = true;
        openers.delete(element);
      }
    }
    if (pendingRestore) restoreWhenSettled(pendingCandidates);
  });
  ownerDocument.addEventListener("focusin", onFocusIn, true);
  observer.observe(body, { childList: true });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ownerDocument.removeEventListener("focusin", onFocusIn, true);
    observer.disconnect();
    cancelSettle();
    openers.clear();
    if (installations.get(ownerDocument) === dispose) installations.delete(ownerDocument);
  };
  installations.set(ownerDocument, dispose);
  return dispose;
}
