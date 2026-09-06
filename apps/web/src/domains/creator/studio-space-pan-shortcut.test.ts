// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { shouldStartStudioSpacePan } from "./studio-space-pan-shortcut";

describe("Studio Space pan shortcut", () => {
  it("starts from the canvas or its non-interactive keyboard host", () => {
    const canvas = document.createElement("canvas");
    const keyboardHost = document.createElement("div");
    keyboardHost.tabIndex = 0;

    expect(shouldStartStudioSpacePan({
      code: "Space",
      editing: false,
      isSpacePressed: false,
      target: canvas,
    })).toBe(true);
    expect(shouldStartStudioSpacePan({
      code: "Space",
      editing: false,
      isSpacePressed: false,
      target: keyboardHost,
    })).toBe(true);
    expect(shouldStartStudioSpacePan({
      code: "Space",
      editing: false,
      isSpacePressed: false,
      target: null,
    })).toBe(true);
  });

  it("preserves Space activation for native and ARIA controls, including icon descendants", () => {
    const button = document.createElement("button");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    button.append(icon);
    const roleButton = document.createElement("div");
    roleButton.setAttribute("role", "button");

    for (const target of [button, icon, roleButton]) {
      expect(shouldStartStudioSpacePan({
        code: "Space",
        editing: false,
        isSpacePressed: false,
        target,
      })).toBe(false);
    }
  });

  it.each([
    "combobox",
    "listbox",
    "menuitemcheckbox",
    "menuitemradio",
    "searchbox",
    "spinbutton",
    "tree",
    "treeitem",
  ])("preserves Space for a custom %s widget", (role) => {
    const widget = document.createElement("div");
    widget.setAttribute("role", role);
    widget.tabIndex = 0;
    const icon = document.createElement("span");
    widget.append(icon);

    for (const target of [widget, icon]) {
      expect(shouldStartStudioSpacePan({
        code: "Space",
        editing: false,
        isSpacePressed: false,
        target,
      })).toBe(false);
    }
  });

  it("does not restart while editing, already panning, or handling another key", () => {
    const canvas = document.createElement("canvas");

    expect(shouldStartStudioSpacePan({
      code: "KeyB",
      editing: false,
      isSpacePressed: false,
      target: canvas,
    })).toBe(false);
    expect(shouldStartStudioSpacePan({
      code: "Space",
      editing: true,
      isSpacePressed: false,
      target: canvas,
    })).toBe(false);
    expect(shouldStartStudioSpacePan({
      code: "Space",
      editing: false,
      isSpacePressed: true,
      target: canvas,
    })).toBe(false);
  });
});
