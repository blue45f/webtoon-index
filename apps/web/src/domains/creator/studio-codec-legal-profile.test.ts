import { describe, expect, it } from "vitest";

import {
  STUDIO_CODEC_LEGAL_PROFILE_VERSION,
  STUDIO_WEBM_CODEC_LEGAL_PROFILES,
  StudioCodecLegalProfileError,
  studioWebmCodecLegalProfile,
  validateStudioCodecLegalProfile,
} from "./studio-codec-legal-profile";

describe("Studio codec capability/distribution profile", () => {
  it.each([
    ["V_AV1", "av1"],
    ["V_VP8", "vp8"],
    ["V_VP9", "vp9"],
  ] as const)("separates the %s muxer from its runtime-provided %s encoder", (codecId, id) => {
    const profile = studioWebmCodecLegalProfile(codecId);

    expect(profile).toMatchObject({
      profileVersion: STUDIO_CODEC_LEGAL_PROFILE_VERSION,
      container: {
        id: "webm",
        implementation: "toonspectrum-ebml-webm-muxer",
        technicalAvailability: "product-implemented",
        distributionStatus: "first-party-source-included",
        provider: "ToonSpectrum",
      },
      codec: {
        id,
        matroskaCodecId: codecId,
        implementation: "browser-webcodecs-videoencoder",
        technicalAvailability: "runtime-probe-required",
        distributionStatus: "runtime-implementation-not-bundled",
        provider: "browser-runtime",
      },
      certification: {
        status: "not-claimed",
        provider: null,
      },
    });
    expect(profile.notices).not.toHaveLength(0);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.codec)).toBe(true);
  });

  it("rejects an unknown track id instead of inventing an availability or rights profile", () => {
    expect(() => studioWebmCodecLegalProfile("V_H264")).toThrowError(
      expect.objectContaining({
        name: "StudioCodecLegalProfileError",
        code: "UNSUPPORTED_WEBM_CODEC_PROFILE",
        path: "/codecId",
      })
    );
  });

  it("rejects misleading or unknown distribution conclusions", () => {
    const valid = structuredClone(STUDIO_WEBM_CODEC_LEGAL_PROFILES.V_VP9);
    const invalid = {
      ...valid,
      codec: {
        ...valid.codec,
        distributionStatus: "royalty-free",
      },
    };

    expect(() => validateStudioCodecLegalProfile(invalid)).toThrowError(
      expect.objectContaining({
        code: "INVALID_CODEC_PROFILE",
        path: "/codec/distributionStatus",
      })
    );
  });

  it("rejects valid vocabulary when it misstates who distributes an implementation", () => {
    const valid = structuredClone(STUDIO_WEBM_CODEC_LEGAL_PROFILES.V_VP9);

    expect(() =>
      validateStudioCodecLegalProfile({
        ...valid,
        codec: {
          ...valid.codec,
          distributionStatus: "first-party-source-included",
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_CODEC_PROFILE",
        path: "/codec/distributionStatus",
      })
    );
    expect(() =>
      validateStudioCodecLegalProfile({
        ...valid,
        codec: {
          ...valid.codec,
          technicalAvailability: "product-implemented",
        },
      })
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_CODEC_PROFILE",
        path: "/codec/technicalAvailability",
      })
    );
  });

  it("rejects asserted certification, missing notices, and unknown keys", () => {
    const valid = structuredClone(STUDIO_WEBM_CODEC_LEGAL_PROFILES.V_VP8);

    expect(() =>
      validateStudioCodecLegalProfile({
        ...valid,
        certification: { status: "official", provider: "self-issued" },
      })
    ).toThrowError(StudioCodecLegalProfileError);
    expect(() => validateStudioCodecLegalProfile({ ...valid, notices: [] })).toThrowError(
      expect.objectContaining({ path: "/notices" })
    );
    expect(() => validateStudioCodecLegalProfile({ ...valid, entitlement: true })).toThrowError(
      expect.objectContaining({ path: "" })
    );
  });

  it("rejects mismatched codec and Matroska ids", () => {
    const valid = structuredClone(STUDIO_WEBM_CODEC_LEGAL_PROFILES.V_AV1);

    expect(() =>
      validateStudioCodecLegalProfile({
        ...valid,
        codec: { ...valid.codec, matroskaCodecId: "V_VP9" },
      })
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_CODEC_PROFILE",
        path: "/codec/matroskaCodecId",
      })
    );
  });
});
