// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { installStudioDialogFocusReturn } from "./studio-dialog-focus-return";

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  document.body.replaceChildren();
});

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

function button(id: string, parent: HTMLElement = document.body): HTMLButtonElement {
  const element = document.createElement("button");
  element.id = id;
  parent.append(element);
  return element;
}

function modal(id: string) {
  const portal = document.createElement("div");
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.tabIndex = -1;
  dialog.id = id;
  portal.append(dialog);
  document.body.append(portal);
  return { portal, dialog };
}

async function nested(options: { autofocus?: boolean; inert?: boolean; lateInstall?: boolean } = {}) {
  const main = button("main");
  main.setAttribute("data-studio-main-menu-trigger", "file");
  main.focus();
  if (!options.lateInstall) dispose = installStudioDialogFocusReturn(document);
  const parent = modal("parent");
  await settle();
  if (options.lateInstall) dispose = installStudioDialogFocusReturn(document);
  const opener = button("child-opener", parent.dialog);
  opener.focus();
  const child = modal("child");
  if (options.inert) parent.portal.setAttribute("inert", "");
  if (options.autofocus) child.dialog.focus();
  await settle();
  child.dialog.focus();
  return { main, parent, opener, child };
}

describe("Studio nested modal focus return", () => {
  it("returns to the child opener inside the surviving parent", async () => {
    const scene = await nested();
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.opener);
  });

  it("remembers the parent opener when child autofocus runs before the observer", async () => {
    const scene = await nested({ autofocus: true });
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.opener);
  });

  it("retains the parent opener through delayed inert cleanup", async () => {
    const scene = await nested({ autofocus: true, inert: true });
    scene.child.portal.remove();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.body);
    scene.parent.portal.removeAttribute("inert");
    await settle();
    expect(document.activeElement).toBe(scene.opener);
  });

  it("does not escape to a background menu while the parent is inert", async () => {
    const scene = await nested({ autofocus: true, inert: true });
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it("lands inside the parent when its original opener was removed", async () => {
    const scene = await nested();
    scene.opener.remove();
    scene.child.portal.remove();
    await settle();
    expect(scene.parent.dialog.contains(document.activeElement)).toBe(true);
  });

  it("preserves a dialog's own nested restoration", async () => {
    const scene = await nested();
    const ownTarget = button("own-target", scene.parent.dialog);
    scene.child.portal.remove();
    ownTarget.focus();
    await settle();
    expect(document.activeElement).toBe(ownTarget);
  });

  it.each([false, true])("restores the outer opener when both close, reverse=%s", async (reverse) => {
    const scene = await nested();
    const portals = reverse
      ? [scene.child.portal, scene.parent.portal]
      : [scene.parent.portal, scene.child.portal];
    for (const portal of portals) portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.main);
  });

  it("restores three levels one at a time", async () => {
    const scene = await nested();
    const middle = button("middle-opener", scene.child.dialog);
    middle.focus();
    const third = modal("third");
    third.dialog.focus();
    await settle();
    third.portal.remove();
    await settle();
    expect(document.activeElement).toBe(middle);
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.opener);
    scene.parent.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.main);
  });

  it("keeps focus in the child when a background modal disappears", async () => {
    const scene = await nested();
    scene.child.dialog.blur();
    scene.parent.portal.remove();
    await settle();
    expect(scene.child.dialog.contains(document.activeElement)).toBe(true);
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.main);
  });

  it("supports installation after the parent is already open", async () => {
    const scene = await nested({ lateInstall: true, autofocus: true });
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.opener);
  });

  it("preserves the opener when a portal is moved in the same DOM batch", async () => {
    const scene = await nested();
    scene.child.dialog.blur();
    scene.child.portal.remove();
    document.body.append(scene.child.portal);
    await settle();
    expect(document.activeElement).toBe(document.body);
    scene.child.dialog.focus();
    scene.child.portal.remove();
    await settle();
    expect(document.activeElement).toBe(scene.opener);
  });

  it("respects a newly opened modal during a pending return", async () => {
    const scene = await nested();
    scene.child.portal.remove();
    const replacement = modal("replacement");
    await settle();
    expect(replacement.dialog.contains(document.activeElement)).toBe(true);
  });
});
