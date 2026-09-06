import { describe, expect, it } from "vitest";

import {
  parseStudioLiveLockResourceScope,
  studioLiveLockResourcesConflict,
} from "./studio-live-lock-resource";

import { studioLiveLayerAwareLockResourcesConflict } from "@/src/domains/creator/live/studio-live-mutation-guard";

describe("studio live lock resource grammar", () => {
  it("parses canonical page/layer/element scopes and leaves legacy ids opaque", () => {
    expect(parseStudioLiveLockResourceScope("page:p1")).toEqual({
      kind: "page",
      pageId: "p1",
    });
    expect(parseStudioLiveLockResourceScope("layer:p1:l1")).toEqual({
      kind: "layer",
      pageId: "p1",
      layerId: "l1",
    });
    // Layer ids may themselves contain separators; the first `:` splits page from layer.
    expect(parseStudioLiveLockResourceScope("layer:p1:l:sub")).toEqual({
      kind: "layer",
      pageId: "p1",
      layerId: "l:sub",
    });
    expect(parseStudioLiveLockResourceScope("element:p1:e1")).toEqual({
      kind: "element",
      pageId: "p1",
      elementId: "e1",
    });
    // Malformed layer shapes fall back to opaque legacy semantics.
    expect(parseStudioLiveLockResourceScope("layer:p1:")).toBeNull();
    expect(parseStudioLiveLockResourceScope("layer::l1")).toBeNull();
    expect(parseStudioLiveLockResourceScope("layer:")).toBeNull();
    expect(parseStudioLiveLockResourceScope("page:")).toBeNull();
    expect(parseStudioLiveLockResourceScope("element:p1")).toBeNull();
    expect(parseStudioLiveLockResourceScope("legacy-lock")).toBeNull();
  });

  it("page covers its layers; sibling layers stay independent", () => {
    // Page ↔ layer, both directions.
    expect(studioLiveLockResourcesConflict("page:p1", "layer:p1:l1")).toBe(true);
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "page:p1")).toBe(true);
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "page:p2")).toBe(false);
    // Layer ↔ layer: exact match only.
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "layer:p1:l1")).toBe(true);
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "layer:p1:l2")).toBe(false);
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "layer:p2:l1")).toBe(false);
    // Layer ↔ element: never at the grammar level — element ids do not encode their layer, so
    // callers claim the containing layer resource alongside element resources instead.
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "element:p1:e1")).toBe(false);
    expect(studioLiveLockResourcesConflict("element:p1:e1", "layer:p1:l1")).toBe(false);
    // Layer ↔ unknown/legacy ids: exact-match semantics only.
    expect(studioLiveLockResourcesConflict("layer:p1:l1", "legacy-lock")).toBe(false);
    expect(studioLiveLockResourcesConflict("legacy-lock", "legacy-lock")).toBe(true);
  });

  it("keeps page/element and legacy semantics byte-identical to the pre-layer grammar", () => {
    expect(studioLiveLockResourcesConflict("page:p1", "element:p1:e1")).toBe(true);
    expect(studioLiveLockResourcesConflict("element:p1:e1", "page:p1")).toBe(true);
    expect(studioLiveLockResourcesConflict("element:p1:e1", "element:p1:e2")).toBe(false);
    expect(studioLiveLockResourcesConflict("page:p1", "element:p2:e1")).toBe(false);
    expect(studioLiveLockResourcesConflict("legacy-a", "legacy-b")).toBe(false);
    expect(studioLiveLockResourcesConflict("page:", "page:")).toBe(true);
    // A malformed layer id is opaque: exact match only, no page coverage.
    expect(studioLiveLockResourcesConflict("layer:p1:", "layer:p1:")).toBe(true);
    expect(studioLiveLockResourcesConflict("page:p1", "layer:p1:")).toBe(false);
  });

  it("matches the client layer-aware guard over the full resource matrix", () => {
    const resources = [
      "page:p1",
      "page:p2",
      "page:",
      "layer:p1:l1",
      "layer:p1:l2",
      "layer:p2:l1",
      "layer:p1:l:sub",
      "layer:p1:",
      "layer::l1",
      "layer:",
      "element:p1:e1",
      "element:p1:e2",
      "element:p2:e1",
      "element:p1",
      "legacy-lock",
      "another-legacy",
    ] as const;
    for (const left of resources) {
      for (const right of resources) {
        const authoritative = studioLiveLockResourcesConflict(left, right);
        // The server grammar and the client guard must agree on every pair, both ways.
        expect(
          authoritative,
          `lib vs guard mismatch for ${left} ↔ ${right}`
        ).toBe(studioLiveLayerAwareLockResourcesConflict(left, right));
        expect(
          authoritative,
          `asymmetric conflict for ${left} ↔ ${right}`
        ).toBe(studioLiveLockResourcesConflict(right, left));
      }
    }
  });
});
