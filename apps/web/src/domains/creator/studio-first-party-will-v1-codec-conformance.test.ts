import { describe, expect, it } from "vitest";

import {
  STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA,
  createStudioFirstPartyWillV1ConformanceEvidence,
} from "./studio-first-party-will-v1-codec-conformance";

describe("first-party WILL v1 Annex A conformance", () => {
  it("creates deterministic exact round-trip evidence with an explicit Annex B exclusion", async () => {
    const first = await createStudioFirstPartyWillV1ConformanceEvidence();
    const second = await createStudioFirstPartyWillV1ConformanceEvidence();

    expect(first.evidence).toMatchObject({
      schema: STUDIO_FIRST_PARTY_WILL_V1_CONFORMANCE_SCHEMA,
      coverage: "annex-a-path-stream-only",
      annexBContainerCovered: false,
      decision: "passed",
      case: {
        roundTripMatch: true,
      },
    });
    expect(first.evidence.case.sourceSha256).toBe(
      first.evidence.case.decodedSha256,
    );
    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
  });

  it("fails closed without the exact provider", async () => {
    await expect(
      createStudioFirstPartyWillV1ConformanceEvidence([]),
    ).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
    });
  });
});
