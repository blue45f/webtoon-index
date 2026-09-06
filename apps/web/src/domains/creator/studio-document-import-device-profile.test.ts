import { describe, expect, it } from "vitest";

import { studioDocumentImportDeviceProfile } from "./studio-document-import-device-profile";

describe("studio document import device profile", () => {
  it("narrows archive bytes and decoded memory before mobile parsing", () => {
    const maxMaterializedImageBytes = Math.floor(64 * 1024 * 1024 * 3 / 4) - 64 * 1024;
    const profile = studioDocumentImportDeviceProfile(true, 12);
    expect(profile).toMatchObject({
      maxEmbeddedBytes: 64 * 1024 * 1024,
      remainingPageCapacity: 188,
      openRasterLimits: {
        maxArchiveBytes: 64 * 1024 * 1024,
        maxTotalImageBytes: maxMaterializedImageBytes,
        maxTotalDecodedRgbaBytes: 96 * 1024 * 1024,
      },
      cbzLimits: {
        maxArchiveBytes: 64 * 1024 * 1024,
        maxPages: 188,
        maxTotalPageBytes: maxMaterializedImageBytes,
        maxPageDimension: 32_768,
        maxPagePixels: 16 * 1024 * 1024,
        maxTotalDecodedPixels: 64 * 1024 * 1024,
        maxTotalDecodedBytes: 256 * 1024 * 1024,
      },
    });
  });

  it("reports zero remaining capacity without giving the codec an invalid zero limit", () => {
    expect(studioDocumentImportDeviceProfile(false, 200)).toMatchObject({
      maxEmbeddedBytes: 128 * 1024 * 1024,
      remainingPageCapacity: 0,
      cbzLimits: { maxPages: 1 },
    });
  });

  it("rejects page counts outside the persisted project contract", () => {
    expect(() => studioDocumentImportDeviceProfile(false, 201)).toThrow(/페이지 수/u);
  });
});
