// @ts-expect-error -- jsdom is a test-only runtime fixture and does not bundle TypeScript types.
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA,
  createStudioFirstPartyInkConformanceEvidence,
} from "./studio-first-party-ink-codec-conformance";
import {
  STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS,
} from "./studio-first-party-ink-codec-provider";

const originalDomParser = globalThis.DOMParser;

beforeEach(() => {
  const window = new JSDOM("").window;
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: window.DOMParser,
  });
});

afterEach(() => {
  if (originalDomParser) {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: originalDomParser,
    });
  } else {
    Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

describe("first-party ink codec conformance evidence", () => {
  for (const format of ["toonink", "inkml"] as const) {
    it(`proves a deterministic exact ${format} transport round trip`, async () => {
      const first = await createStudioFirstPartyInkConformanceEvidence(format);
      const second = await createStudioFirstPartyInkConformanceEvidence(format);

      expect(first.evidence).toMatchObject({
        schema: STUDIO_FIRST_PARTY_INK_CONFORMANCE_SCHEMA,
        implementation: "toonspectrum-first-party-ink-codecs",
        format,
        decision: "passed",
      });
      expect(first.evidence.cases).toHaveLength(1);
      expect(first.evidence.cases[0]).toMatchObject({
        roundTripMatch: true,
      });
      expect(first.evidence.cases[0]?.sourceSha256).toBe(
        first.evidence.cases[0]?.decodedSha256,
      );
      expect(first.bytes).toEqual(second.bytes);
      expect(first.sha256).toBe(second.sha256);
    });
  }

  it("fails closed when the expected provider is unavailable", async () => {
    await expect(
      createStudioFirstPartyInkConformanceEvidence("inkml", [
        STUDIO_FIRST_PARTY_INK_CODEC_PROVIDERS[0]!,
      ]),
    ).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
    });
  });
});
