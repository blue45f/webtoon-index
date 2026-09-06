import { describe, expect, it } from "vitest";

import { buildMatrixTrcIccProfile } from "../render/studio-canvaskit-icc-profile";
import { STUDIO_BUNDLED_SRGB_ICC_MANIFEST } from "../studio-icc-profile-policy";

import { exportStudioPdfConformanceCandidate } from "./studio-pdf-conformance-export";

import type { StudioPdfDocument } from "../render/studio-canvaskit-pdf-vector";

const fileIdentifierHex = "00112233445566778899AABBCCDDEEFF";

function candidate(
  target: "pdf-a-2b" | "pdf-x-4",
  overrides: Partial<StudioPdfDocument> = {},
): StudioPdfDocument {
  return {
    pages: [
      {
        widthPt: 120,
        heightPt: 180,
        ops: [],
        ...(target === "pdf-x-4"
          ? {
              trimBox: [6, 6, 114, 174] as const,
              bleedBox: [3, 3, 117, 177] as const,
            }
          : {}),
      },
    ],
    title: "Publication candidate",
    outputIntent: {
      profileBytes: buildMatrixTrcIccProfile(),
      identifier: "ToonSpectrum-sRGB",
      condition: "sRGB IEC 61966-2-1",
      info: "ToonSpectrum deterministic public profile",
      components: 3,
    },
    conformance: {
      target,
      fileIdentifierHex,
      createdAt: "2026-07-30T01:02:03Z",
      modifiedAt: "2026-07-30T04:05:06Z",
    },
    ...overrides,
  };
}

describe("Studio PDF conformance publication pipeline", () => {
  it.each(["pdf-a-2b", "pdf-x-4"] as const)(
    "%s 후보를 ICC 정책부터 바이트 재검사까지 통과시킨다",
    async (target) => {
      const result = await exportStudioPdfConformanceCandidate({
        document: candidate(target),
        iccManifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.profile).toBe(target);
      expect(result.bytes.byteLength).toBeGreaterThan(500);
      expect(result.iccPolicy.verdict).toBe("accepted");
      expect(result.conformance.result).toEqual({
        decision: "local-candidate",
        localPreflight: "passed",
        externalValidation: "not-run",
        thirdPartyCertification: "not-claimed",
      });
      expect(result.certification.thirdParty).toBe("not-claimed");
    },
  );

  it("정확히 같은 바이트의 veraPDF 결과만 PDF/A 후보에 결합한다", async () => {
    const local = await exportStudioPdfConformanceCandidate({
      document: candidate("pdf-a-2b"),
      iccManifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
    });
    expect(local.ok).toBe(true);
    if (!local.ok) return;

    const result = await exportStudioPdfConformanceCandidate({
      document: candidate("pdf-a-2b"),
      iccManifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
      veraPdf: {
        schema: "toonspectrum.external.verapdf-result",
        version: 1,
        provider: "veraPDF",
        providerVersion: "1.28.2",
        profile: "PDF/A-2b",
        sourceDigest: local.conformance.sourceDigest,
        validationComplete: true,
        isCompliant: true,
        rules: [
          { id: "verapdf.parser", status: "passed", failedChecks: 0 },
          {
            id: "verapdf.profile-selection",
            status: "passed",
            failedChecks: 0,
          },
          {
            id: "verapdf.pdf-a-2b-validation",
            status: "passed",
            failedChecks: 0,
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conformance.result.decision).toBe(
      "external-validator-confirmed",
    );
    expect(result.conformance.result.thirdPartyCertification).toBe(
      "not-claimed",
    );
  });

  it("ICC 권리·정체성 오류를 PDF 작성 전에 거부한다", async () => {
    const result = await exportStudioPdfConformanceCandidate({
      document: candidate("pdf-a-2b"),
      iccManifest: {
        ...STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
        profileKey: "user-srgb",
        source: {
          kind: "user",
          providerId: "local-user-upload",
          provenance: null,
        },
        rights: {
          ...STUDIO_BUNDLED_SRGB_ICC_MANIFEST.rights,
          licenseClass: "user-authorized",
          licenseId: "user-declaration",
          embedding: "forbidden",
        },
        expected: {
          ...STUDIO_BUNDLED_SRGB_ICC_MANIFEST.expected,
          sha256: null,
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "icc-policy-rejected",
      iccPolicy: { verdict: "rejected", rejectionCode: "RIGHTS_DENIED" },
    });
  });

  it("누락된 규격 선언과 OutputIntent를 fail-closed로 거부한다", async () => {
    const withoutDeclaration = await exportStudioPdfConformanceCandidate({
      document: { pages: candidate("pdf-a-2b").pages },
      iccManifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
    });
    expect(withoutDeclaration).toMatchObject({
      ok: false,
      code: "conformance-declaration-required",
    });

    const withoutOutputIntent = await exportStudioPdfConformanceCandidate({
      document: candidate("pdf-x-4", { outputIntent: undefined }),
      iccManifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
    });
    expect(withoutOutputIntent).toMatchObject({
      ok: false,
      code: "output-intent-required",
    });
  });

  it("잘못되거나 다른 해시의 외부 검증 결과를 후보에 결합하지 않는다", async () => {
    const result = await exportStudioPdfConformanceCandidate({
      document: candidate("pdf-a-2b"),
      iccManifest: STUDIO_BUNDLED_SRGB_ICC_MANIFEST,
      veraPdf: {
        schema: "toonspectrum.external.verapdf-result",
        version: 1,
        provider: "veraPDF",
        providerVersion: "1.28.2",
        profile: "PDF/A-2b",
        sourceDigest: `sha256:${"0".repeat(64)}`,
        validationComplete: true,
        isCompliant: true,
        rules: [],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "conformance-rejected",
      conformance: {
        result: {
          decision: "rejected",
          externalValidation: "failed",
          thirdPartyCertification: "not-claimed",
        },
      },
    });
  });
});
