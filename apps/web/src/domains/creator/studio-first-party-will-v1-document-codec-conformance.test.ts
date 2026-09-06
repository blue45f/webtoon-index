import { describe, expect, it } from "vitest";

import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA,
  createStudioFirstPartyWillV1DocumentConformanceEvidence,
} from "./studio-first-party-will-v1-document-codec-conformance";
import {
  STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER,
} from "./studio-first-party-will-v1-document-codec-provider";

import type { StudioCodecProvider } from "./studio-codec-provider-contract";

describe("first-party WILL v1 Annex B document conformance", () => {
  it("creates deterministic exact seven-part document evidence", async () => {
    const first =
      await createStudioFirstPartyWillV1DocumentConformanceEvidence();
    const second =
      await createStudioFirstPartyWillV1DocumentConformanceEvidence();

    expect(first.evidence).toMatchObject({
      schema: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CONFORMANCE_SCHEMA,
      coverage: "annex-b-bounded-seven-part-document",
      annexAPathStreamCovered: true,
      annexBOpcContainerCovered: true,
      boundedSevenPartProfile: true,
      wacomSdkCodeUsed: false,
      thirdPartyCodecCertification: false,
      vendorTrademarkAuthorization: false,
      arbitraryVendorFileInteroperabilityCertified: false,
      decision: "passed",
      case: {
        deterministicEncodeMatch: true,
        roundTripMatch: true,
      },
    });
    expect(first.evidence.case.sourceSha256).toBe(
      first.evidence.case.decodedSha256,
    );
    expect(first.evidence.case.encodedSha256).toBe(
      first.evidence.case.repeatedEncodedSha256,
    );
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
  });

  it("fails closed without the exact built-in provider identity", async () => {
    const substituted: StudioCodecProvider = Object.freeze({
      manifest: STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.manifest,
      execute:
        STUDIO_FIRST_PARTY_WILL_V1_DOCUMENT_CODEC_PROVIDER.execute,
    });
    await expect(
      createStudioFirstPartyWillV1DocumentConformanceEvidence([]),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });
    await expect(
      createStudioFirstPartyWillV1DocumentConformanceEvidence([substituted]),
    ).rejects.toMatchObject({ code: "PROVIDER_NOT_FOUND" });
  });
});
