
import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "./canvas/read-studio-canvas-viewport-stack";



const viewportSource = readStudioCanvasViewportStack(import.meta.url, "./canvas/");

describe("physical overlay surface lifecycle boundary", () => {
  it("does not transiently unmount Living Ink during dependency rerenders", () => {
    const start = viewportSource.indexOf("const canvas = livingInkCanvasRef.current;");
    const end = viewportSource.indexOf("function splitDialogueText", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const effect = viewportSource.slice(start, end);
    expect(effect).toContain("setLivingInkOverlaySurface(null);");
    expect(effect).toContain("return undefined;");
    expect(effect).not.toContain("return () => setLivingInkOverlaySurface(null)");

    const keyStart = effect.indexOf('const surfaceKey = [\n      "living-ink",');
    const keyEnd = effect.indexOf('].join(":");', keyStart);
    expect(keyStart).toBeGreaterThan(-1);
    expect(keyEnd).toBeGreaterThan(keyStart);
    const key = effect.slice(keyStart, keyEnd);
    // Visible viewport clipping may change when a contextual bar opens or closes. Living Ink
    // presents a full composite into the resized canvas, so clip dimensions are not field identity.
    expect(key).not.toContain("hokusaiSurfaceWidth");
    expect(key).not.toContain("hokusaiSurfaceHeight");
    expect(key).toContain("CANVAS_W");
    expect(key).toContain("canvasH");
  });

  it("does not transiently unmount Hokusai during dependency rerenders", () => {
    const start = viewportSource.indexOf("const canvas = hokusaiLiveCanvasRef.current;");
    const end = viewportSource.indexOf("const canvas = livingInkCanvasRef.current;", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const effect = viewportSource.slice(start, end);
    expect(effect).toContain("setHokusaiLiveOverlaySurface(null);");
    expect(effect).toContain("return undefined;");
    expect(effect).not.toContain("return () => setHokusaiLiveOverlaySurface(null)");
    // Hokusai composes dirty patches, rather than a full-frame bitmap, so a backing resize still
    // invalidates its accumulated surface and remains part of its stricter key.
    expect(effect).toContain("hokusaiSurfaceWidth");
    expect(effect).toContain("hokusaiSurfaceHeight");
  });
});
