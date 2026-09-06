// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canReturnStudioDialogFocus,
  installStudioDialogFocusReturn,
  returnStudioDialogFocus,
  studioDialogFocusAnchor,
} from "./studio-dialog-focus-return";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function button(host: HTMLElement = document.body, anchor = false): HTMLButtonElement {
  const node = host.ownerDocument.createElement("button");
  if (anchor) node.setAttribute("data-studio-main-menu-trigger", "file");
  host.append(node);
  return node;
}

function wrapper(): HTMLDivElement {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

 describe("Studio focus-return integrity", () => {
  it.each(["none"])("rejects a display:%s ancestor", (display) => {
    const host = wrapper();
    host.style.display = display;
    expect(canReturnStudioDialogFocus(button(host), document)).toBe(false);
  });

  it.each(["hidden", "collapse"])("rejects visibility:%s", (visibility) => {
    const node = button();
    node.style.visibility = visibility;
    expect(canReturnStudioDialogFocus(node, document)).toBe(false);
  });

  it("allows an explicit child visibility override", () => {
    const host = wrapper();
    host.style.visibility = "hidden";
    const node = button(host);
    node.style.visibility = "visible";
    expect(canReturnStudioDialogFocus(node, document)).toBe(true);
  });

  it("rejects content-visibility:hidden ancestors", () => {
    const host = wrapper();
    host.style.contentVisibility = "hidden";
    expect(canReturnStudioDialogFocus(button(host), document)).toBe(false);
  });

  it.each(["inert", "hidden", "aria-hidden"])("rejects a %s ancestor", (attribute) => {
    const host = wrapper();
    host.setAttribute(attribute, attribute === "aria-hidden" ? "true" : "");
    expect(canReturnStudioDialogFocus(button(host), document)).toBe(false);
  });

  it("honors inherited fieldset disabled state and its first legend exception", () => {
    const fieldset = document.createElement("fieldset");
    fieldset.disabled = true;
    const legend = document.createElement("legend");
    fieldset.append(legend);
    document.body.append(fieldset);
    expect(canReturnStudioDialogFocus(button(fieldset), document)).toBe(false);
    expect(canReturnStudioDialogFocus(button(legend), document)).toBe(true);
  });

  it("rejects closed-details content but accepts its summary and open content", () => {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    details.append(summary);
    document.body.append(details);
    const node = button(details);
    expect(canReturnStudioDialogFocus(node, document)).toBe(false);
    expect(canReturnStudioDialogFocus(button(summary), document)).toBe(true);
    details.open = true;
    expect(canReturnStudioDialogFocus(node, document)).toBe(true);
  });

  it("does not confuse a later summary with the first summary", () => {
    const details = document.createElement("details");
    details.append(document.createElement("summary"));
    const second = document.createElement("summary");
    details.append(second);
    document.body.append(details);
    expect(canReturnStudioDialogFocus(button(second), document)).toBe(false);
  });

  it("skips hidden and disabled responsive copies when selecting the anchor", () => {
    const hidden = button(document.body, true);
    hidden.style.display = "none";
    const disabled = button(document.body, true);
    disabled.disabled = true;
    const visible = button(document.body, true);
    expect(studioDialogFocusAnchor(document)).toBe(visible);
    expect(returnStudioDialogFocus(null, document)).toBe(true);
    expect(document.activeElement).toBe(visible);
  });

  it("does not report success for an unfocusable opener", () => {
    expect(returnStudioDialogFocus(wrapper(), document)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("falls back after the requested control silently refuses focus", () => {
    const opener = button();
    vi.spyOn(opener, "focus").mockImplementation(() => undefined);
    const anchor = button(document.body, true);
    expect(returnStudioDialogFocus(opener, document)).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it("continues past a throwing focus implementation", () => {
    const opener = button();
    vi.spyOn(opener, "focus").mockImplementation(() => { throw new Error("detached context"); });
    const anchor = button(document.body, true);
    expect(returnStudioDialogFocus(opener, document)).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it("tries each destination once and advances to the next fallback", () => {
    const first = button(document.body, true);
    const focus = vi.spyOn(first, "focus").mockImplementation(() => undefined);
    const second = button(document.body, true);
    expect(returnStudioDialogFocus(first, document)).toBe(true);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(second);
  });

  it("uses preventScroll rather than moving the canvas viewport", () => {
    const opener = button();
    const focus = vi.spyOn(opener, "focus");
    expect(returnStudioDialogFocus(opener, document)).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("never restores into a different owner document", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const otherDocument = frame.contentDocument;
    if (!otherDocument) throw new Error("iframe document missing");
    const foreign = button(otherDocument.body);
    expect(canReturnStudioDialogFocus(foreign, document)).toBe(false);
    const anchor = button(document.body, true);
    expect(returnStudioDialogFocus(foreign, document)).toBe(true);
    expect(document.activeElement).toBe(anchor);
  });

  it("has independent, idempotent document lifecycles", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const otherDocument = frame.contentDocument;
    if (!otherDocument) throw new Error("iframe document missing");
    const first = installStudioDialogFocusReturn(document);
    const other = installStudioDialogFocusReturn(otherDocument);
    disposers.push(first, other);
    expect(other).not.toBe(first);
    expect(installStudioDialogFocusReturn(document)).toBe(first);
    first();
    const replacement = installStudioDialogFocusReturn(document);
    disposers.push(replacement);
    first();
    expect(installStudioDialogFocusReturn(document)).toBe(replacement);
    expect(installStudioDialogFocusReturn(otherDocument)).toBe(other);
  });

  it("supports a missing document during server rendering", () => {
    expect(() => installStudioDialogFocusReturn(null)()).not.toThrow();
  });
});
