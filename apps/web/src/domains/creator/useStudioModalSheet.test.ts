import { describe, expect, it, vi } from "vitest";

import { activateStudioModalSheet } from "./useStudioModalSheet";

type Listener = EventListenerOrEventListenerObject;

class InteractionDocument {
  activeElement: InteractionElement | null = null;
  readonly defaultView = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener | null): void {
    if (!listener) return;
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener | null): void {
    if (listener) this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class InteractionElement {
  readonly attributes = new Map<string, string>();
  readonly children: InteractionElement[] = [];
  disabled = false;
  isConnected = true;
  parentElement: InteractionElement | null = null;
  tabIndex = -1;

  constructor(
    readonly ownerDocument: InteractionDocument,
    readonly name: string,
  ) {}

  append(...children: InteractionElement[]): void {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }

  closest(selector: string): InteractionElement | null {
    if (selector.includes("[hidden]") && this.hasAttribute("hidden")) return this;
    if (selector.includes("[inert]") && this.hasAttribute("inert")) return this;
    if (
      selector.includes("[aria-hidden='true']") &&
      this.getAttribute("aria-hidden") === "true"
    ) {
      return this;
    }
    if (selector.includes("aria-modal") && this.getAttribute("aria-modal") === "true") {
      return this;
    }
    return this.parentElement?.closest(selector) ?? null;
  }

  contains(node: unknown): boolean {
    if (node === this) return true;
    return this.children.some((child) => child.contains(node));
  }

  focus(): void {
    this.ownerDocument.activeElement = this;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  querySelector<T>(selector: string): T | null {
    const matches = this.descendants().find(
      (element) => selector === "[data-autofocus]" && element.hasAttribute("data-autofocus"),
    );
    return (matches as T | undefined) ?? null;
  }

  querySelectorAll<T>(): T[] {
    return this.descendants()
      .filter((element) => element.tabIndex >= 0)
      .map((element) => element as T);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  private descendants(): InteractionElement[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }
}

function asDocument(document: InteractionDocument): Document {
  return document as unknown as Document;
}

function asElement(element: InteractionElement): HTMLElement {
  return element as unknown as HTMLElement;
}

function keyboardEvent(
  key: string,
  shiftKey = false,
  target?: InteractionElement,
) {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  return {
    event: {
      altKey: false,
      ctrlKey: false,
      key,
      metaKey: false,
      preventDefault,
      shiftKey,
      stopPropagation,
      target,
    } as unknown as KeyboardEvent,
    preventDefault,
    stopPropagation,
  };
}

function focusEvent(target: InteractionElement): FocusEvent {
  return { target } as unknown as FocusEvent;
}

function modalFixture(modal = true) {
  const document = new InteractionDocument();
  const root = new InteractionElement(document, "root");
  const toolbar = new InteractionElement(document, "toolbar");
  const trigger = new InteractionElement(document, "trigger");
  trigger.tabIndex = 0;
  const workspace = new InteractionElement(document, "workspace");
  const canvas = new InteractionElement(document, "canvas");
  const dialog = new InteractionElement(document, "dialog");
  dialog.setAttribute("aria-modal", modal ? "true" : "false");
  const first = new InteractionElement(document, "first");
  first.tabIndex = 0;
  first.setAttribute("data-autofocus", "true");
  const last = new InteractionElement(document, "last");
  last.tabIndex = 0;

  root.append(toolbar, workspace);
  toolbar.append(trigger);
  workspace.append(canvas, dialog);
  dialog.append(first, last);
  trigger.focus();
  return { canvas, dialog, document, first, last, root, toolbar, trigger, workspace };
}

describe("activateStudioModalSheet", () => {
  it("focuses the requested control, isolates only background branches, then restores exact attributes and trigger focus", () => {
    const fixture = modalFixture();
    fixture.toolbar.setAttribute("aria-hidden", "false");
    fixture.canvas.setAttribute("inert", "legacy");

    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss: vi.fn(),
      returnFocus: asElement(fixture.trigger),
      root: asElement(fixture.root),
    });

    expect(fixture.document.activeElement).toBe(fixture.first);
    expect(fixture.toolbar.getAttribute("aria-hidden")).toBe("true");
    expect(fixture.toolbar.getAttribute("inert")).toBe("");
    expect(fixture.canvas.getAttribute("aria-hidden")).toBe("true");
    expect(fixture.canvas.getAttribute("inert")).toBe("");
    expect(fixture.workspace.hasAttribute("inert")).toBe(false);
    expect(fixture.dialog.hasAttribute("inert")).toBe(false);

    deactivate();

    expect(fixture.toolbar.getAttribute("aria-hidden")).toBe("false");
    expect(fixture.toolbar.hasAttribute("inert")).toBe(false);
    expect(fixture.canvas.hasAttribute("aria-hidden")).toBe(false);
    expect(fixture.canvas.getAttribute("inert")).toBe("legacy");
    expect(fixture.document.activeElement).toBe(fixture.trigger);
    expect(fixture.document.listenerCount("keydown")).toBe(0);
    expect(fixture.document.listenerCount("focusin")).toBe(0);
  });

  it("keeps the aria-hidden pointer scrim interactive while isolating the canvas", () => {
    const fixture = modalFixture();
    const backdrop = new InteractionElement(fixture.document, "backdrop");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.setAttribute("data-studio-modal-backdrop", "true");
    fixture.workspace.append(backdrop);

    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss: vi.fn(),
      root: asElement(fixture.root),
    });

    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.hasAttribute("inert")).toBe(false);
    expect(fixture.canvas.getAttribute("inert")).toBe("");

    deactivate();
    expect(backdrop.getAttribute("aria-hidden")).toBe("true");
    expect(backdrop.hasAttribute("inert")).toBe(false);
  });

  it("falls back to the persistent dock trigger when the original launcher disappears", () => {
    const fixture = modalFixture();
    const persistentDockTrigger = new InteractionElement(fixture.document, "dock-trigger");
    persistentDockTrigger.tabIndex = 0;
    fixture.toolbar.append(persistentDockTrigger);

    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      fallbackReturnFocus: asElement(persistentDockTrigger),
      onDismiss: vi.fn(),
      returnFocus: asElement(fixture.trigger),
      root: asElement(fixture.root),
    });

    fixture.trigger.isConnected = false;
    deactivate();

    expect(fixture.document.activeElement).toBe(persistentDockTrigger);
  });

  it("does not resurrect a sibling inert state that React removed during modal close", () => {
    const fixture = modalFixture();
    const nestedLauncher = new InteractionElement(fixture.document, "nested-launcher");
    nestedLauncher.tabIndex = 0;
    fixture.canvas.append(nestedLauncher);
    fixture.canvas.setAttribute("inert", "");

    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss: vi.fn(),
      returnFocus: asElement(nestedLauncher),
      root: asElement(fixture.root),
    });

    expect(fixture.canvas.getAttribute("aria-hidden")).toBe("true");
    expect(fixture.canvas.getAttribute("inert")).toBe("");
    // The next React commit promotes this previously hidden sibling into the active non-modal
    // sheet before the old modal layout effect runs its cleanup.
    fixture.canvas.removeAttribute("inert");
    deactivate();

    expect(fixture.canvas.hasAttribute("inert")).toBe(false);
    expect(fixture.canvas.hasAttribute("aria-hidden")).toBe(false);
    expect(fixture.document.activeElement).toBe(nestedLauncher);
  });

  it("wraps Tab and Shift+Tab and rebounds programmatic focus that escapes the sheet", () => {
    const fixture = modalFixture();
    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss: vi.fn(),
      root: asElement(fixture.root),
    });

    fixture.last.focus();
    const forward = keyboardEvent("Tab");
    fixture.document.dispatch("keydown", forward.event);
    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.document.activeElement).toBe(fixture.first);

    const backward = keyboardEvent("Tab", true);
    fixture.document.dispatch("keydown", backward.event);
    expect(backward.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.document.activeElement).toBe(fixture.last);

    fixture.trigger.focus();
    fixture.document.dispatch("focusin", focusEvent(fixture.trigger));
    expect(fixture.document.activeElement).toBe(fixture.first);

    fixture.last.focus();
    fixture.document.dispatch("focusin", focusEvent(fixture.last));
    expect(fixture.document.activeElement).toBe(fixture.last);
    deactivate();
  });

  it("dismisses once on Escape and consumes the global shortcut event", () => {
    const fixture = modalFixture();
    const onDismiss = vi.fn();
    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss,
      root: asElement(fixture.root),
    });
    const escape = keyboardEvent("Escape");

    fixture.document.dispatch("keydown", escape.event);

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(escape.stopPropagation).toHaveBeenCalledOnce();
    deactivate();
    fixture.document.dispatch("keydown", keyboardEvent("Escape").event);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("focuses the dialog itself and keeps Tab there when it has no focusable controls", () => {
    const fixture = modalFixture();
    fixture.first.tabIndex = -1;
    fixture.first.removeAttribute("data-autofocus");
    fixture.last.tabIndex = -1;
    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss: vi.fn(),
      root: asElement(fixture.root),
    });

    expect(fixture.document.activeElement).toBe(fixture.dialog);
    const tab = keyboardEvent("Tab");
    fixture.document.dispatch("keydown", tab.event);
    expect(tab.preventDefault).toHaveBeenCalledOnce();
    expect(fixture.document.activeElement).toBe(fixture.dialog);
    deactivate();
  });

  it("yields Escape and focus ownership to a nested modal", () => {
    const fixture = modalFixture();
    const onDismiss = vi.fn();
    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss,
      root: asElement(fixture.root),
    });
    const nestedDialog = new InteractionElement(fixture.document, "nested-dialog");
    nestedDialog.setAttribute("aria-modal", "true");
    const nestedButton = new InteractionElement(fixture.document, "nested-button");
    nestedButton.tabIndex = 0;
    nestedDialog.append(nestedButton);
    fixture.root.append(nestedDialog);
    nestedButton.focus();

    fixture.document.dispatch("focusin", focusEvent(nestedButton));
    expect(fixture.document.activeElement).toBe(nestedButton);
    const escape = keyboardEvent("Escape", false, nestedButton);
    fixture.document.dispatch("keydown", escape.event);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(escape.preventDefault).not.toHaveBeenCalled();
    deactivate();
  });

  it("does not trap or isolate the non-modal brush settings sheet", () => {
    const fixture = modalFixture(false);
    const onDismiss = vi.fn();
    const deactivate = activateStudioModalSheet({
      dialog: asElement(fixture.dialog),
      document: asDocument(fixture.document),
      onDismiss,
      root: asElement(fixture.root),
    });

    expect(fixture.document.activeElement).toBe(fixture.trigger);
    expect(fixture.toolbar.hasAttribute("inert")).toBe(false);
    expect(fixture.canvas.hasAttribute("aria-hidden")).toBe(false);
    expect(fixture.document.listenerCount("keydown")).toBe(0);

    fixture.document.dispatch("keydown", keyboardEvent("Escape").event);
    expect(onDismiss).not.toHaveBeenCalled();
    deactivate();
  });
});
