import { describe, expect, it } from "vitest";

import {
  STUDIO_WORK_ASSET_DESTRUCTIVE_EDIT_REASON,
  studioWorkAssetDestructiveEditReason,
  studioWorkAssetDocumentSourceTransitionReason,
  studioWorkAssetSourceReplacementReason,
  studioWorkAssetSourceTransitionReason,
} from "./studio-work-asset-edit-guard";

describe("studio work asset destructive edit guard", () => {
  const admitted = {
    id: "asset-1",
    type: "image",
    src: "work-asset://image/asset-1",
  };

  it("blocks source replacement so an immutable collaboration reference cannot be tombstoned", () => {
    expect(studioWorkAssetSourceReplacementReason(admitted, {
      src: "data:image/png;base64,baked",
    })).toBe(STUDIO_WORK_ASSET_DESTRUCTIVE_EDIT_REASON);
    expect(studioWorkAssetSourceReplacementReason(admitted, { opacity: 0.5 })).toBeNull();
    expect(studioWorkAssetSourceReplacementReason(admitted, { src: admitted.src })).toBeNull();
  });

  it("does not lock ordinary local images or malformed cross-ID references", () => {
    expect(studioWorkAssetDestructiveEditReason({
      ...admitted,
      src: "data:image/png;base64,local",
    })).toBeNull();
    expect(studioWorkAssetDestructiveEditReason({
      ...admitted,
      src: "work-asset://image/different",
    })).toBeNull();
  });

  it("blocks source replacement in bulk transitions but permits durable tombstones", () => {
    expect(studioWorkAssetSourceTransitionReason(
      [admitted],
      [{ ...admitted, src: "data:image/png;base64,frame" }]
    )).toBe(STUDIO_WORK_ASSET_DESTRUCTIVE_EDIT_REASON);
    expect(studioWorkAssetSourceTransitionReason([admitted], [])).toBeNull();
    expect(studioWorkAssetSourceTransitionReason(
      [admitted],
      [{ ...admitted, src: admitted.src }]
    )).toBeNull();
  });

  it("tracks immutable source identity when a bulk operation moves an element between pages", () => {
    expect(studioWorkAssetDocumentSourceTransitionReason(
      [{ elements: [admitted] }, { elements: [] }],
      [{ elements: [] }, { elements: [{ ...admitted, src: "data:image/png;base64,moved" }] }]
    )).toBe(STUDIO_WORK_ASSET_DESTRUCTIVE_EDIT_REASON);
    expect(studioWorkAssetDocumentSourceTransitionReason(
      [{ elements: [admitted] }],
      []
    )).toBeNull();
  });
});
