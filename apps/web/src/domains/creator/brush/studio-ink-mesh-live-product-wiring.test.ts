import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioCanvasViewportStack } from "../canvas/read-studio-canvas-viewport-stack";
import { readStudioCuttoonEditorSource } from "../studio-cuttoon-editor/read-studio-cuttoon-editor-source";

function source(file: string): string {
  if (file.endsWith("StudioPage.tsx") || file.endsWith("StudioCuttoonEditorHost.tsx")) return readStudioCuttoonEditorSource();
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

describe("Google Ink mesh actual /studio product wiring", () => {
  const page = source("../StudioCuttoonEditorHost.tsx");
  const viewport = readStudioCanvasViewportStack(import.meta.url, "../canvas/");
  const host = source("../StudioInkMeshLivePreviewHost.tsx");
  const runtime = source("./studio-ink-mesh-live-preview.ts");

  it("starts from the existing pointerdown live-ink admission without changing its owner route", () => {
    expect(page).toContain("armTransientPenInkSurfaces({");
    expect(page).toContain("inkMeshLivePreviewRuntimeRef.current?.begin(");
    expect(page.indexOf("armTransientPenInkSurfaces({"))
      .toBeLessThan(page.indexOf("inkMeshLivePreviewRuntimeRef.current?.begin("));
    expect(page).toContain("liveInkAdmitted: liveInkOverlayStarted");
    expect(runtime).toContain("retainedPixelAuthority: \"canvas2d-perfect-freehand\"");
  });

  it("feeds authoritative coalesced suffixes and keeps predictions in a replacement-only call", () => {
    const batchStart = page.indexOf("function consumeFreehandPointerBatch(");
    const batchEnd = page.indexOf("function publishAuthoritativeFreehandSuffix(", batchStart);
    const batch = page.slice(batchStart, batchEnd);
    const publishEnd = page.indexOf("drawingCrdtPublisherRef.current.append", batchEnd);
    const publish = page.slice(batchEnd, publishEnd);
    expect(batch).toContain("collectStudioStrokePointerBatch(session, pointerEvent");
    expect(batch).toContain("for (const [sampleIndex, sample] of batch.authoritative.entries())");
    expect(batch).toContain("for (const sample of batch.predicted)");
    expect(batch).toContain("previewPredicted(");
    expect(batch).toContain("liveInkPredictionRendererRef.current.clear()");
    expect(publish).toContain("synchronizeAuthoritative(");
    expect(publish.indexOf("synchronizeAuthoritative("))
      .toBeLessThan(publish.indexOf("appendStudioLivingInkAuthoritativeSuffix"));
  });

  it("finishes, cancels, and unmount-cleans the mesh island while the normal commit path remains", () => {
    expect(page).toContain("inkMeshLivePreviewRuntimeRef.current?.finish(");
    expect(page.match(/inkMeshLivePreviewRuntimeRef\.current\?\.cancel\(\)/gu)?.length ?? 0)
      .toBeGreaterThanOrEqual(3);
    expect(page).toContain("const committed = commit([...baseElements, finished])");
    expect(page).toContain("draftPreviewStoreRef.current.settle(finished)");
  });

  it("loads the optional mesh island after mount without blocking the synchronous stroke route", () => {
    const loader = source("./studio-ink-mesh-live-preview-loader.ts");
    expect(page).toContain('from "./brush/studio-ink-mesh-live-preview-loader"');
    expect(page).not.toMatch(/from\s+["']\.\/studio-ink-mesh-live-preview["']/u);
    expect(viewport).not.toMatch(/from\s+["']\.\/studio-ink-mesh-live-preview["']/u);
    expect(host).not.toMatch(/from\s+["']\.\/studio-ink-mesh-live-preview["']/u);
    expect(loader).toContain('import("./studio-ink-mesh-live-preview")');
    expect(page).toContain("void loadStudioInkMeshLivePreviewModule()");
    expect(page).toContain("inkMeshLivePreviewRuntimeRef.current?.begin(");
    expect(page).toContain("inkMeshLivePreviewRuntime={inkMeshLivePreviewRuntime}");
    expect(viewport).toContain("webGpuViewportSurface && inkMeshLivePreviewRuntime");
  });

  it("mounts a real clipped live canvas over the existing viewport and never claims document authority", () => {
    expect(viewport).toContain("<StudioInkMeshLivePreviewHost");
    expect(viewport).toContain("runtime={inkMeshLivePreviewRuntime}");
    expect(host).toContain('data-studio-ink-mesh-live-preview="predicted-tail-only"');
    expect(host).toContain('className="pointer-events-none absolute z-[11]"');
    const normalizedRuntime = runtime.replace(/\s+/gu, " ");
    expect(normalizedRuntime).toContain("replaceable predicted tail");
    expect(normalizedRuntime).toContain("retained Perfect Freehand remains authoritative");
  });

  it("uses GPU subrange writes with no interactive GPU-to-CPU transfer surface", () => {
    expect(runtime).toContain("this.device.queue.writeBuffer(");
    expect(runtime).toContain("delta.retainedVertexCount * 2 * FLOAT_BYTES");
    expect(runtime).toContain("delta.retainedTriangleCount * 3 * INDEX_BYTES");
    expect(runtime).not.toMatch(/\.mapAsync\(|getMappedRange|copyTextureToBuffer|copyBufferToBuffer/u);
  });
});
