import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

/**
 * Blend modes were applied per stamp instead of per element.
 *
 * A Konva Group with `globalCompositeOperation` does not composite as one unit — it sets the mode
 * on the context and then draws each child against the layer canvas. A freehand stroke is dozens of
 * stamps, so the same physics ran dozens of times and most modes collapsed to the fixed point of
 * repeated compositing. Measured before the fix: a single tap (one fill) with multiply landed on
 * [113,26,23] against a theoretical [113,26,22] — accurate to 1/255 — while a 30-stamp stroke of the
 * same brush went black. Only darken and lighten were correct, because only those two are idempotent
 * under repeated application.
 *
 * The same code path carried `source-in` for below-layer clipping, where repeated intersection drove
 * the result to the empty set and erased the clipped layer entirely.
 *
 * These assertions are source-level because the defect lives in how nodes are arranged for Konva,
 * and jsdom has no canvas to composite with. They are written to fail if the arrangement regresses.
 */
describe("blend modes composite once per element", () => {
  it("routes every non-source-over composite through the isolating cache group", () => {
    const viewport = source("./canvas/StudioCanvasViewportDocumentLayer.tsx");
    expect(viewport).toContain("BlendIsolationGroup");
    expect(viewport).toContain('const isolatedComposite = composite !== "source-over"');
    // The bare-Group fallback must carry clipping only. If `globalCompositeOperation` ever appears
    // on it again, stamps are compositing individually and every non-idempotent mode is broken.
    const bareClipGroup = /<Group key=\{el\.id\} clipX=\{clip\.x\}[^>]*>/u.exec(viewport)?.[0] ?? "";
    expect(bareClipGroup).not.toBe("");
    expect(bareClipGroup).not.toContain("globalCompositeOperation");
  });

  it("puts the composite on the group that gets cached, not on a child", () => {
    const group = source("./BlendIsolationGroup.tsx");
    // Caching is what makes Konva draw the subtree as one bitmap and apply the mode a single time.
    expect(group).toContain("node.cache()");
    expect(group).toContain("node.clearCache()");
    // The ref'd (cached) Group must be the one carrying the composite. ClipMaskGroup deliberately
    // does the opposite — composite on a child, cache to contain it — and copying that arrangement
    // here would isolate the stroke without ever blending it into the layer below.
    const groupTag = /<Group\s+ref=\{ref\}[\s\S]*?>/u.exec(group)?.[0] ?? "";
    expect(groupTag).not.toBe("");
    expect(groupTag).toContain("globalCompositeOperation={composite}");
  });

  it("re-caches when the element's rendered result changes", () => {
    const viewport = source("./canvas/StudioCanvasViewportDocumentLayer.tsx");
    const group = source("./BlendIsolationGroup.tsx");
    // A cache that never invalidates would freeze the stroke at its first painted state.
    expect(group).toContain("[cacheKey]");
    expect(viewport).toMatch(
      /\[\s*el\.id,\s*composite,\s*pagesHi,\s*previewSequence\s*\?\?\s*"authoritative",\s*JSON\.stringify\(elBounds\(el\)\),\s*\]\.join\("\|"\)/u,
    );
  });

  it("keeps the alpha-clipping arrangement intact", () => {
    const viewport = source("./canvas/StudioCanvasViewportDocumentLayer.tsx");
    // `source-in` must stay a child of ClipMaskGroup so it intersects the mask sibling rather than
    // the whole layer. Isolation fixes the repetition; it must not relocate the operand.
    expect(viewport).toContain('renderWithOwnMask({ compositeOverride: "source-in" })');
    expect(viewport).toContain("<ClipMaskGroup key={el.id} cacheKey={ck}>");
  });
});
