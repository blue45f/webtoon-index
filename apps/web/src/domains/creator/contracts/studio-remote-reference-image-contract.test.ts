import { describe, expect, it } from "vitest";

import {
  STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES,
  STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES,
  StudioRemoteReferenceImageResponseSchema,
} from "./studio-remote-reference-image-contract";

describe("Studio remote-reference production response size", () => {
  it("keeps the maximum raw image and all JSON metadata below the deployment margin", () => {
    expect(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES).toBe(3_000_000);
    const rawBytes = Buffer.alloc(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES);
    const response = StudioRemoteReferenceImageResponseSchema.parse({
      version: STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION,
      mediaType: "image/webp",
      byteLength: rawBytes.byteLength,
      width: 16_384,
      height: 1_024,
      decodedRgbaBytes: 67_108_864,
      sha256: "a".repeat(64),
      dataUrl: `data:image/webp;base64,${rawBytes.toString("base64")}`,
    });

    const serializedBytes = Buffer.byteLength(JSON.stringify(response), "utf8");
    expect(serializedBytes).toBeLessThanOrEqual(STUDIO_REMOTE_REFERENCE_IMAGE_MAX_JSON_BYTES);
    expect(serializedBytes).toBeLessThanOrEqual(4_200_000);
  });

  it("rejects a response contract that declares one raw byte above the shared cap", () => {
    expect(StudioRemoteReferenceImageResponseSchema.safeParse({
      version: STUDIO_REMOTE_REFERENCE_IMAGE_CONTRACT_VERSION,
      mediaType: "image/png",
      byteLength: STUDIO_REMOTE_REFERENCE_IMAGE_MAX_BYTES + 1,
      width: 1,
      height: 1,
      decodedRgbaBytes: 4,
      sha256: "a".repeat(64),
      dataUrl: "data:image/png;base64,AA==",
    }).success).toBe(false);
  });
});
