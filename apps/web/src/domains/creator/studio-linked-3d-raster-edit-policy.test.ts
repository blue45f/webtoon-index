import { describe, expect, it } from "vitest";

import {
  STUDIO_LINKED_3D_PASS_DESTRUCTIVE_EDIT_REASON,
  isStudioLinked3dReservedRasterSource,
  studioLinked3dPassDestructiveEditReason,
  studioLinked3dPassSourceReplacementReason,
} from "./studio-linked-3d-raster-edit-policy";

const LOCATOR = `studio-opfs-cas:sha256:${"a".repeat(64)}`;

describe("Studio linked 3D raster edit policy", () => {
  it("blocks strict and malformed reserved sources before destructive pixel work", () => {
    expect(studioLinked3dPassDestructiveEditReason({ type: "image", src: LOCATOR }))
      .toBe(STUDIO_LINKED_3D_PASS_DESTRUCTIVE_EDIT_REASON);
    expect(studioLinked3dPassDestructiveEditReason({
      type: "image",
      src: "studio-opfs-cas:not-a-valid-locator",
    })).toBe(STUDIO_LINKED_3D_PASS_DESTRUCTIVE_EDIT_REASON);
    expect(isStudioLinked3dReservedRasterSource("studio-opfs-cas:corrupt"))
      .toBe(true);
  });

  it("allows metadata and same-source patches but rejects a source replacement", () => {
    const element = { type: "image", src: LOCATOR };
    expect(studioLinked3dPassSourceReplacementReason(element, { opacity: 0.5 }))
      .toBeNull();
    expect(studioLinked3dPassSourceReplacementReason(element, { src: LOCATOR }))
      .toBeNull();
    expect(studioLinked3dPassSourceReplacementReason(element, {
      src: "data:image/png;base64,AAAA",
    })).toBe(STUDIO_LINKED_3D_PASS_DESTRUCTIVE_EDIT_REASON);
  });

  it("does not classify ordinary raster or non-image sources as linked authority", () => {
    expect(studioLinked3dPassDestructiveEditReason({
      type: "image",
      src: "data:image/png;base64,AAAA",
    })).toBeNull();
    expect(studioLinked3dPassDestructiveEditReason({ type: "draw", src: LOCATOR }))
      .toBeNull();
    expect(isStudioLinked3dReservedRasterSource("https://example.test/image.png"))
      .toBe(false);
  });
});
