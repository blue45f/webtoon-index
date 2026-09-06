import { describe, expect, it } from "vitest";

import {
  createStudioLivingInkCanonicalTransaction,
  createStudioLivingInkDocumentReceipt,
  studioLivingInkReceiptReplayToken,
  verifyStudioLivingInkCanonicalImageAuthority,
  type StudioLivingInkCanonicalResult,
} from "./studio-living-ink-document";
import { STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION } from "./studio-living-ink-execution-protocol";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import { sha256HexPortable } from "./studio-sha256";

import type { DrawEl, El, ImageEl } from "./studio-element-model";

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function pngDataUrl(bytes = PNG_SIGNATURE): `data:image/png;base64,${string}` {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return `data:image/png;base64,${globalThis.btoa(binary)}`;
}

function draw(id: string, overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id,
    type: "draw",
    mode: "pen",
    kind: "freehand",
    points: [0, 0, 10, 10],
    pressures: [0.5, 0.5],
    stroke: "#112233",
    strokeWidth: 4,
    ...overrides,
  };
}

function canonical(pageId = "page-1", routeKey = "route-1"): StudioLivingInkCanonicalResult {
  return {
    src: pngDataUrl(),
    pngSha256: `sha256:${sha256HexPortable(PNG_SIGNATURE)}`,
    routeKey,
    pageId,
    documentWidth: 800,
    documentHeight: 1200,
    config: {
      displayWidth: 800,
      displayHeight: 1200,
      fieldWidth: 512,
      fieldHeight: 768,
      coarseBase: 128,
      seed: 7,
      material: DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS,
      displayMode: "composite",
    },
    journal: [{ kind: "advance", version: 1, sequence: 1, fixedTicks: 120 }],
    finalExecutionReceipt: {
      kind: "studio-living-ink-execution-receipt",
      version: 1,
      engineVersion: STUDIO_LIVING_INK_EXECUTION_ENGINE_VERSION,
      requestId: 1,
      revision: 1,
      operationKind: "advance",
      backend: "webgl2-offscreen-half-float",
      displaySha256: `sha256:${"b".repeat(64)}`,
      operationSha256: `sha256:${"c".repeat(64)}`,
      dirtyBounds: { x: 0, y: 0, width: 512, height: 768 },
      dirtyTileCount: 1,
      passCount: 1,
      pressureIterations: 22,
      simulationTicks: 120,
      elapsedMilliseconds: 2,
      fixedPigmentPolicy: "immutable",
      dryingWindowSeconds: 2,
      fixDurationSeconds: 1.2,
      determinism: "same-runtime-replay",
      crossDeviceBitExact: false,
      cpuOperationHashCrossDeviceDeterministic: true,
      canonicalFrameAuthority: "first-rendered-rgba8-frame",
      replayValidation: "bounded-visual-parity",
      displayReadbackOrientation: "webgl-bottom-left-row-major",
      gpuError: 0,
      readbackFormat: "rgba8-staging-fbo",
      imageOwnership: "caller-must-close",
      contextRecovery: "worker-rebuild-journal-replay",
    },
  };
}

describe("Living Ink document transaction", () => {
  it("hides the recoverable source and inserts one canonical physical image in one history payload", () => {
    const result = createStudioLivingInkCanonicalTransaction({
      elements: [draw("stroke-1")],
      sourceElementId: "stroke-1",
      canonicalImageId: "living-image-1",
      result: canonical(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.transaction.historyEntryCount).toBe(1);
    expect(result.transaction.nextElements).toHaveLength(2);
    expect(result.transaction.nextElements[0]).toMatchObject({
      id: "stroke-1",
      type: "draw",
      hidden: true,
    });
    expect(result.transaction.nextElements[1]).toMatchObject({
      id: "living-image-1",
      type: "image",
      blendMode: "multiply",
      livingInkReceipt: {
        pageId: "page-1",
        routeKey: "route-1",
        restorePolicy: "replay-or-flattened-raster-fail-closed",
        historyEntryCount: 1,
      },
    });
  });

  it("replaces the existing page physical layer instead of stacking opaque paper images", () => {
    const first = createStudioLivingInkCanonicalTransaction({
      elements: [draw("stroke-1")],
      sourceElementId: "stroke-1",
      canonicalImageId: "living-image-1",
      result: canonical(),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const secondSource = draw("stroke-2");
    const second = createStudioLivingInkCanonicalTransaction({
      elements: [...first.transaction.nextElements, secondSource] as El[],
      sourceElementId: "stroke-2",
      canonicalImageId: "ignored-new-id",
      result: canonical("page-1", "route-2"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const physical = second.transaction.nextElements.filter((element): element is El & ImageEl =>
      element.type === "image" && Boolean(element.livingInkReceipt)
    );
    expect(physical).toHaveLength(1);
    expect(physical[0]?.id).toBe("living-image-1");
    expect(physical[0]?.livingInkReceipt?.sourceElementIds).toEqual(["stroke-1", "stroke-2"]);
  });

  it("fails closed for a locked source without mutating the element list", () => {
    const elements = [draw("stroke-1", { locked: true })];
    expect(createStudioLivingInkCanonicalTransaction({
      elements,
      sourceElementId: "stroke-1",
      canonicalImageId: "living-image-1",
      result: canonical(),
    })).toMatchObject({ ok: false, code: "source-locked" });
    expect(elements[0]?.hidden).not.toBe(true);
  });

  it("changes the replay token for same-length journal/config and final GPU receipt changes", () => {
    const baseResult = canonical();
    const base = createStudioLivingInkDocumentReceipt({ result: baseResult, sourceElementIds: [] });
    const operationChanged = createStudioLivingInkDocumentReceipt({
      result: {
        ...baseResult,
        finalExecutionReceipt: {
          ...baseResult.finalExecutionReceipt,
          operationSha256: `sha256:${"d".repeat(64)}`,
        },
      },
      sourceElementIds: [],
    });
    const configChanged = createStudioLivingInkDocumentReceipt({
      result: {
        ...baseResult,
        config: {
          ...baseResult.config,
          material: { ...baseResult.config.material, bleed: 0.73 },
        },
      },
      sourceElementIds: [],
    });
    expect(base).not.toBeNull();
    expect(operationChanged).not.toBeNull();
    expect(configChanged).not.toBeNull();
    expect(studioLivingInkReceiptReplayToken(operationChanged)).not.toBe(
      studioLivingInkReceiptReplayToken(base),
    );
    expect(studioLivingInkReceiptReplayToken(configChanged)).not.toBe(
      studioLivingInkReceiptReplayToken(base),
    );
  });

  it("admits replay only after the canonical ImageEl PNG bytes, geometry, page, and receipt match", async () => {
    const transaction = createStudioLivingInkCanonicalTransaction({
      elements: [draw("stroke-1")],
      sourceElementId: "stroke-1",
      canonicalImageId: "living-image-1",
      result: canonical(),
    });
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) return;
    const image = transaction.transaction.nextElements.find(
      (element): element is ImageEl => element.type === "image",
    );
    expect(image).toBeDefined();
    if (!image) return;
    await expect(verifyStudioLivingInkCanonicalImageAuthority({
      image,
      expectedPageId: "page-1",
    })).resolves.toMatchObject({
      ok: true,
      pngSha256: `sha256:${sha256HexPortable(PNG_SIGNATURE)}`,
    });
  });

  it.each([
    ["PNG bytes", { src: pngDataUrl(new Uint8Array([...PNG_SIGNATURE, 1])) }, "png-sha256-mismatch"],
    ["MIME spoof", { src: "data:image/png;base64,AAAA" }, "png-invalid"],
    ["page", {}, "page-mismatch"],
    ["geometry", { width: 799 }, "geometry-mismatch"],
  ] as const)("keeps the flattened raster fail-visible but refuses %s corruption", async (
    _label,
    patch,
    code,
  ) => {
    const transaction = createStudioLivingInkCanonicalTransaction({
      elements: [],
      canonicalImageId: "living-image-1",
      result: canonical(),
    });
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) return;
    const source = transaction.transaction.nextElements[0];
    expect(source?.type).toBe("image");
    if (source?.type !== "image") return;
    const image: ImageEl = { ...source, ...patch };
    const expectedPageId = code === "page-mismatch" ? "page-2" : "page-1";
    await expect(verifyStudioLivingInkCanonicalImageAuthority({ image, expectedPageId }))
      .resolves.toMatchObject({ ok: false, code });
    // Verification is read-only; the corrupt but visible PNG is never removed as a side effect.
    expect(image.src).toBe((patch as Partial<ImageEl>).src ?? source.src);
  });

  it("abandons a stale verification epoch without granting replay authority", async () => {
    const transaction = createStudioLivingInkCanonicalTransaction({
      elements: [],
      canonicalImageId: "living-image-1",
      result: canonical(),
    });
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) return;
    const image = transaction.transaction.nextElements[0];
    if (image?.type !== "image") return;
    const controller = new AbortController();
    controller.abort();
    await expect(verifyStudioLivingInkCanonicalImageAuthority({
      image,
      expectedPageId: "page-1",
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects a valid-looking PNG before replay when the persisted journal sequence is corrupt", async () => {
    const transaction = createStudioLivingInkCanonicalTransaction({
      elements: [],
      canonicalImageId: "living-image-1",
      result: canonical(),
    });
    expect(transaction.ok).toBe(true);
    if (!transaction.ok) return;
    const source = transaction.transaction.nextElements[0];
    if (source?.type !== "image" || !source.livingInkReceipt) return;
    const image: ImageEl = {
      ...source,
      livingInkReceipt: {
        ...source.livingInkReceipt,
        journal: source.livingInkReceipt.journal.map((operation) => ({
          ...operation,
          sequence: operation.sequence + 1,
        })),
      },
    };
    await expect(verifyStudioLivingInkCanonicalImageAuthority({
      image,
      expectedPageId: "page-1",
    })).resolves.toMatchObject({ ok: false, code: "receipt-invalid" });
  });
});
