import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

function sourceSection(
  contents: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = contents.indexOf(startMarker);
  const end = contents.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) {
    throw new Error(`Missing source boundary: ${startMarker} -> ${endMarker}`);
  }
  return contents.slice(start, end);
}

const contract = source("../studio-scene-provider.ts");
const implementation = source("./studio-pixi-scene-provider.ts");

describe("Studio Pixi scene provider source boundary", () => {
  it("keeps the public contract renderer-neutral", () => {
    expect(contract).not.toMatch(/\bpixi(?:\.js)?\b/iu);
    expect(contract).not.toMatch(/\bkonva\b/iu);
    expect(contract).not.toContain("GPUCanvasContext");
    expect(contract).toContain("opaque runtime handles");
    expect(contract).toContain("readonly contextSharing: \"forbidden\"");
  });

  it("loads Pixi lazily without a static value import or a Konva dependency", () => {
    expect(implementation).toContain('return await import("pixi.js")');
    expect(implementation).toMatch(
      /^import type \{[\s\S]*?\} from "pixi\.js";/mu,
    );
    expect(implementation).not.toMatch(
      /^import\s+(?!type\b)[^\n]*from "pixi\.js";/mu,
    );
    expect(implementation).not.toMatch(/\bkonva\b/iu);
  });

  it("owns a new transparent overlay and never accepts or requests another canvas context", () => {
    const options = sourceSection(
      implementation,
      "export interface CreateStudioPixiSceneProviderOptions",
      "interface StudioPixiOverlayEntry",
    );
    expect(options).not.toMatch(/readonly\s+canvas\s*:/u);
    expect(implementation).toContain('ownerDocument.createElement("canvas")');
    expect(implementation).toContain(
      'canvas.dataset.studioSceneInputAuthority = "inactive"',
    );
    expect(implementation).toContain('canvas.style.background = "transparent"');
    expect(implementation).not.toContain(".getContext(");
    expect(implementation).not.toContain("GPUCanvasContext");
    expect(implementation).not.toContain(".appendChild(");
  });

  it("requires one renderer, excludes every alternate, and emits a fail-closed receipt", () => {
    expect(implementation).toContain('readonly renderer: "webgpu" | "webgl"');
    expect(implementation).toContain("preference: [options.renderer]");
    expect(implementation).toContain('failureIsolation: "fail-closed"');
    expect(implementation).toContain("automatic renderer substitution is forbidden");
    expect(implementation).not.toContain("STUDIO_PIXI_RENDERER_ORDER");
    expect(implementation).toContain(
      '"Pixi selected an unsupported renderer; Studio scene overlays require WebGPU or WebGL."',
    );
  });

  it("installs a render group plus deterministic ordering and custom selectable hit areas", () => {
    expect(implementation).toContain("isRenderGroup: true");
    expect(implementation).toContain("root.sortableChildren = true");
    expect(implementation).toContain("this.root.sortChildren()");
    expect(implementation).toContain(
      "left.overlay.documentId.localeCompare(right.overlay.documentId)",
    );
    expect(implementation).toContain('graphics.eventMode = overlay.selectable === false ? "none" : "static"');
    expect(implementation).toContain("graphics.hitArea = new runtime.Rectangle");
    expect(implementation).toContain("graphics.hitArea = new runtime.Ellipse");
    expect(implementation).toContain("graphics.hitArea = new runtime.Polygon");
    expect(implementation).toContain("this.documentIdsByLabel.set");
  });

  it("keeps resize, render, and teardown explicit instead of starting a hidden ticker", () => {
    expect(implementation).toContain("autoStart: false");
    expect(implementation).toContain("sharedTicker: false");
    expect(implementation).toContain(
      "this.app.renderer.resize(viewport.width, viewport.height, viewport.dpr)",
    );
    expect(implementation).toContain("this.app.render()");
    expect(implementation).toContain("{ removeView: true }");
    expect(implementation).toContain("if (this.isDestroyed) return");
  });
});
