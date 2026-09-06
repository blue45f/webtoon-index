import { describe, expect, it } from "vitest";

import {
  STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA,
  createStudioFirstPartyRasterConformanceEvidence,
} from "./studio-first-party-raster-codec-conformance";
import {
  STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS,
  STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS,
} from "./studio-first-party-raster-codec-provider";

describe("first-party raster codec conformance evidence", () => {
  it.each(STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS)(
    "binds deterministic vectors, provider receipts, and alpha policy for %s",
    async (format) => {
      const first =
        await createStudioFirstPartyRasterConformanceEvidence(format);
      const second =
        await createStudioFirstPartyRasterConformanceEvidence(format);
      expect(first.evidence.schema).toBe(
        STUDIO_FIRST_PARTY_RASTER_CONFORMANCE_SCHEMA,
      );
      expect(first.evidence.providerId).toBe(
        `toonspectrum.raster.${format}.v1`,
      );
      expect(first.evidence.decision).toBe("passed");
      expect(first.evidence.cases).toHaveLength(2);
      expect(first.evidence.cases.every((entry) => entry.pixelMatch)).toBe(
        true,
      );
      expect(first.bytes).toEqual(second.bytes);
      expect(first.sha256).toBe(second.sha256);
      expect(new TextDecoder().decode(first.bytes)).toContain(
        '"decision":"passed"',
      );
    },
  );

  it("records only the declared alpha loss for opaque-only formats", async () => {
    for (const format of STUDIO_FIRST_PARTY_RASTER_CODEC_FORMATS) {
      const bundle =
        await createStudioFirstPartyRasterConformanceEvidence(format);
      const expected =
        format === "bmp" || format === "ppm"
          ? "flatten-on-white"
          : "preserve-straight-alpha";
      expect(
        bundle.evidence.cases.map((entry) => entry.alphaPolicy),
      ).toEqual([expected, expected]);
    }
  });

  it("fails closed when the exact first-party provider identity is absent", async () => {
    await expect(
      createStudioFirstPartyRasterConformanceEvidence(
        "qoi",
        STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.filter(
          (provider) => provider.manifest.format !== "qoi",
        ),
      ),
    ).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
    });
  });

  it("rejects a manifest-compatible provider substitution before execution", async () => {
    const original = STUDIO_FIRST_PARTY_RASTER_CODEC_PROVIDERS.find(
      (provider) => provider.manifest.format === "qoi",
    )!;
    const corrupt = {
      manifest: original.manifest,
      async execute(execution: Parameters<typeof original.execute>[0]) {
        const result = await original.execute(execution);
        if (
          execution.request.direction !== "decode"
          || typeof result !== "object"
          || result === null
          || !("bytes" in result)
          || !("outputSha256" in result)
          || !(result.bytes instanceof Uint8Array)
        ) {
          return result;
        }
        const bytes = Uint8Array.from(result.bytes);
        bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
        return {
          ...result,
          bytes,
          outputSha256:
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        };
      },
    };
    await expect(
      createStudioFirstPartyRasterConformanceEvidence("qoi", [corrupt]),
    ).rejects.toMatchObject({
      code: "PROVIDER_NOT_FOUND",
    });
  });
});
