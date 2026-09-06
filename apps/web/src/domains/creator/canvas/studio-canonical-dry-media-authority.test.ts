import { describe, expect, it } from "vitest";

import {
  resolveStudioCanonicalDryMediaViewportAuthority,
  studioCanonicalDryMediaOwnsDocumentElement,
} from "./studio-canonical-dry-media-authority";

import type { DrawEl } from "../studio-element-model";
import type {
  StudioCanonicalVNextDryMediaCanvasAuthority,
  StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority,
} from "../StudioCanonicalVNextDryMediaCanvas";

const element = {
  id: "dry-media-authority",
  type: "draw",
  points: [0, 0, 10, 10],
  stroke: "#111827",
  strokeWidth: 8,
  brush: "dry-media",
} as DrawEl;

function authorized(): StudioCanonicalVNextDryMediaCanvasAuthorizedAuthority {
  return {
    kind: "studio-canonical-vnext-dry-media-canvas-authority",
    version: 1,
    status: "authorized",
    element,
    layoutKey: "layout:1",
    canonicalPlanHash: "hash",
    dynamicPlanDigest: "sha256:dynamic",
    sourceDabCount: 2,
    texturedDabCount: 10,
    laneCount: 5,
    parityReceipt: {} as never,
  };
}

describe("canonical dry-media viewport authority", () => {
  it("keeps Konva hidden for an exact authorized WebGPU frame", () => {
    expect(resolveStudioCanonicalDryMediaViewportAuthority(
      authorized(),
      element,
      "layout:1",
    )).toMatchObject({
      canvasVisible: true,
      hiddenElementId: element.id,
      authorized: { status: "authorized" },
      unavailable: null,
    });
  });

  it("keeps Konva hidden when unavailable retains the exact last-good WebGPU frame", () => {
    const lastPresented = authorized();
    const unavailable: StudioCanonicalVNextDryMediaCanvasAuthority = {
      kind: "studio-canonical-vnext-dry-media-canvas-authority",
      version: 1,
      status: "unavailable",
      element,
      layoutKey: "layout:1",
      reason: "device-lost",
      retainsLastGoodFrame: true,
      lastPresented,
      retryPolicy: "explicit-next-selection-only",
    };
    const resolved = resolveStudioCanonicalDryMediaViewportAuthority(
      unavailable,
      element,
      "layout:1",
    );

    expect(resolved).toMatchObject({
      canvasVisible: true,
      hiddenElementId: element.id,
      authorized: null,
      unavailable: { reason: "device-lost" },
    });
    expect(studioCanonicalDryMediaOwnsDocumentElement(
      element.id,
      resolved.hiddenElementId,
    )).toBe(true);
  });

  it("does not hide Konva for preflight unavailability without a receipted frame", () => {
    const unavailable: StudioCanonicalVNextDryMediaCanvasAuthority = {
      kind: "studio-canonical-vnext-dry-media-canvas-authority",
      version: 1,
      status: "unavailable",
      element,
      layoutKey: "layout:1",
      reason: "webgpu-unavailable",
      retainsLastGoodFrame: false,
      lastPresented: null,
      retryPolicy: "explicit-next-selection-only",
    };

    expect(resolveStudioCanonicalDryMediaViewportAuthority(
      unavailable,
      element,
      "layout:1",
    )).toMatchObject({
      canvasVisible: false,
      hiddenElementId: null,
      authorized: null,
      unavailable: { reason: "webgpu-unavailable" },
    });
    expect(studioCanonicalDryMediaOwnsDocumentElement(element.id, null)).toBe(false);
  });

  it("refuses a retained last-good frame whose own layout differs from the current layout", () => {
    // The envelope is stamped with the *current* layout at publish time; only the snapshot's own
    // layoutKey reveals that the bitmap was receipted at a different surface size/scale/DPR.
    const staleFrame = { ...authorized(), layoutKey: "layout:1" };
    const unavailable: StudioCanonicalVNextDryMediaCanvasAuthority = {
      kind: "studio-canonical-vnext-dry-media-canvas-authority",
      version: 1,
      status: "unavailable",
      element,
      layoutKey: "layout:2",
      reason: "presentation:runtime-rejected",
      retainsLastGoodFrame: true,
      lastPresented: staleFrame,
      retryPolicy: "explicit-next-selection-only",
    };

    const resolved = resolveStudioCanonicalDryMediaViewportAuthority(
      unavailable,
      element,
      "layout:2",
    );
    expect(resolved).toMatchObject({
      canvasVisible: false,
      hiddenElementId: null,
      authorized: null,
      unavailable: { reason: "presentation:runtime-rejected" },
    });
    expect(studioCanonicalDryMediaOwnsDocumentElement(element.id, resolved.hiddenElementId))
      .toBe(false);

    // Same envelope, but the frame really was receipted in this layout → ownership stays.
    expect(resolveStudioCanonicalDryMediaViewportAuthority(
      { ...unavailable, lastPresented: { ...staleFrame, layoutKey: "layout:2" } },
      element,
      "layout:2",
    ).hiddenElementId).toBe(element.id);
  });

  it("rejects stale layout and DrawEl identities before changing document ownership", () => {
    const authority = authorized();
    const replacedElement = { ...element };

    expect(resolveStudioCanonicalDryMediaViewportAuthority(
      authority,
      element,
      "layout:2",
    ).hiddenElementId).toBeNull();
    expect(resolveStudioCanonicalDryMediaViewportAuthority(
      authority,
      replacedElement,
      "layout:1",
    ).hiddenElementId).toBeNull();
  });
});
