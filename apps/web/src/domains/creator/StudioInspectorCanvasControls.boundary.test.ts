import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(name: string): string {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

describe("StudioInspectorCanvasControls percent guide boundary", () => {
  it("persists the optional converted px position while preserving center defaults", () => {
    const aside = source("./StudioInspectorAsideShell.tsx");
    const start = aside.indexOf("onAddUserGuide={withCanvasControlsGuard");
    expect(start).toBeGreaterThanOrEqual(0);

    const wiring = aside.slice(start, start + 560);
    expect(wiring).toContain("(type, pos?: number)");
    expect(wiring).toContain(
      "pos: pos ?? (type === \"v\" ? CANVAS_W / 2 : canvasH / 2)",
    );
  });
});
