// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { shouldSuppressStudioQuickStartAutoOpen } from "./studio-quick-start-auto-open";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Studio quick-start automatic-open guard", () => {
  it("yields to a trusted interaction that starts inside Studio before the lazy coach mounts", () => {
    const editor = document.createElement("main");
    editor.dataset.studioEditor = "true";
    const workspaceTrigger = document.createElement("button");
    editor.append(workspaceTrigger);
    document.body.append(editor);

    expect(shouldSuppressStudioQuickStartAutoOpen({
      isTrusted: true,
      ownerDocument: document,
      target: workspaceTrigger,
    })).toBe(true);
  });

  it("ignores synthetic and out-of-Studio activity", () => {
    const editor = document.createElement("main");
    editor.dataset.studioEditor = "true";
    const inside = document.createElement("button");
    const outside = document.createElement("button");
    editor.append(inside);
    document.body.append(editor, outside);

    expect(shouldSuppressStudioQuickStartAutoOpen({
      isTrusted: false,
      ownerDocument: document,
      target: inside,
    })).toBe(false);
    expect(shouldSuppressStudioQuickStartAutoOpen({
      isTrusted: true,
      ownerDocument: document,
      target: outside,
    })).toBe(false);
  });

  it("leaves dismissal to the mounted coach so its click contract is not interrupted", () => {
    const editor = document.createElement("main");
    editor.dataset.studioEditor = "true";
    const coach = document.createElement("section");
    coach.dataset.studioCreativeStarter = "true";
    const outsideControl = document.createElement("button");
    editor.append(coach, outsideControl);
    document.body.append(editor);

    expect(shouldSuppressStudioQuickStartAutoOpen({
      isTrusted: true,
      ownerDocument: document,
      target: outsideControl,
    })).toBe(false);
  });
});
