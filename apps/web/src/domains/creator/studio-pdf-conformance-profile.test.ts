import { describe, expect, it } from "vitest";

import {
  buildVectorPdf,
  type StudioPdfConformanceTarget,
  type StudioPdfDocument,
} from "./render/studio-canvaskit-pdf-vector";
import {
  importStudioVeraPdfResult,
  preflightStudioPdfConformance,
  resolveStudioPdfConformanceProfile,
  scanStudioPdfConformanceEvidence,
  STUDIO_PDF_CONFORMANCE_PROFILE_IDS,
  STUDIO_PDF_CONFORMANCE_PROFILES,
  STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA,
  STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION,
  STUDIO_PDF_CONFORMANCE_SCANNER_ID,
  STUDIO_PDF_CONFORMANCE_SCANNER_VERSION,
  STUDIO_VERAPDF_RESULT_SCHEMA,
  STUDIO_VERAPDF_RESULT_VERSION,
  STUDIO_VERAPDF_RULE_IDS,
  type StudioPdfConformanceEvidence,
  type StudioPdfConformanceReceipt,
  type StudioPdfSha256,
  type StudioVeraPdfResultEnvelope,
  verifyStudioPdfConformanceReceipt,
} from "./studio-pdf-conformance-profile";

const FILE_ID = "0123456789ABCDEF0123456789ABCDEF";
const SOURCE_DIGEST = `sha256:${"a".repeat(64)}` as const;

function cmykIccProfile(): Uint8Array {
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.byteLength, false);
  bytes.set(new TextEncoder().encode("CMYK"), 16);
  bytes.set(new TextEncoder().encode("acsp"), 36);
  return bytes;
}

function candidateDocument(target: StudioPdfConformanceTarget): StudioPdfDocument {
  return {
    pages: [
      {
        widthPt: 200,
        heightPt: 300,
        trimBox: [10, 10, 190, 290],
        bleedBox: [5, 5, 195, 295],
        ops: [
          {
            op: "path",
            commands: [
              { op: "move", x: 20, y: 20 },
              { op: "line", x: 180, y: 20 },
              { op: "line", x: 180, y: 280 },
              { op: "close" },
            ],
            fill: {
              color: {
                space: "cmyk",
                c: 0.2,
                m: 0.3,
                y: 0.4,
                k: 0.1,
              },
              alpha: 0.75,
            },
          },
        ],
      },
    ],
    title: "Conformance candidate",
    outputIntent: {
      profileBytes: cmykIccProfile(),
      identifier: "Test CMYK",
      condition: "Test print condition",
      info: "Test-owned synthetic profile",
      components: 4,
    },
    conformance: {
      target,
      fileIdentifierHex: FILE_ID,
      createdAt: "2026-07-30T00:00:00Z",
      modifiedAt: "2026-07-30T00:00:01Z",
    },
  };
}

function scanCandidate(
  target: StudioPdfConformanceTarget,
): StudioPdfConformanceEvidence {
  const result = scanStudioPdfConformanceEvidence(
    buildVectorPdf(candidateDocument(target)),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.evidence;
}

function scanPlainPdf(): StudioPdfConformanceEvidence {
  const result = scanStudioPdfConformanceEvidence(
    buildVectorPdf({
      pages: [
        {
          widthPt: 100,
          heightPt: 100,
          ops: [],
        },
      ],
    }),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.evidence;
}

function mutableEvidence(
  evidence: StudioPdfConformanceEvidence,
): Record<string, any> {
  return JSON.parse(JSON.stringify(evidence)) as Record<string, any>;
}

function ruleStatus(
  receipt: StudioPdfConformanceReceipt,
  id: StudioPdfConformanceReceipt["rules"][number]["id"],
): "failed" | "passed" | undefined {
  return receipt.rules.find((rule) => rule.id === id)?.status;
}

function passingVeraPdf(
  sourceDigest: StudioPdfSha256 = SOURCE_DIGEST,
): StudioVeraPdfResultEnvelope {
  return {
    schema: STUDIO_VERAPDF_RESULT_SCHEMA,
    version: STUDIO_VERAPDF_RESULT_VERSION,
    provider: "veraPDF",
    providerVersion: "1.28.2",
    profile: "PDF/A-2b",
    sourceDigest,
    validationComplete: true,
    isCompliant: true,
    rules: STUDIO_VERAPDF_RULE_IDS.map((id) => ({
      id,
      status: "passed",
      failedChecks: 0,
    })),
  };
}

describe("Studio PDF conformance profile registry", () => {
  it("keeps PDF 1.7, PDF/A-2b, and PDF/X-4 as distinct fail-closed profiles", () => {
    expect(STUDIO_PDF_CONFORMANCE_PROFILE_IDS).toEqual([
      "pdf-1.7",
      "pdf-a-2b",
      "pdf-x-4",
    ]);
    expect(STUDIO_PDF_CONFORMANCE_PROFILES["pdf-1.7"]).toMatchObject({
      standard: "ISO 32000-1:2008",
      requiredPdfVersion: "1.7",
      veraPdfFlavour: null,
    });
    expect(STUDIO_PDF_CONFORMANCE_PROFILES["pdf-a-2b"]).toMatchObject({
      standard: "ISO 19005-2:2011",
      requiredPdfVersion: "1.7",
      veraPdfFlavour: "2b",
    });
    expect(STUDIO_PDF_CONFORMANCE_PROFILES["pdf-x-4"]).toMatchObject({
      standard: "ISO 15930-7:2010",
      requiredPdfVersion: "1.6",
      veraPdfFlavour: null,
    });
    for (const profile of Object.values(STUDIO_PDF_CONFORMANCE_PROFILES)) {
      expect(profile.claim).toBe("local-candidate-only");
      expect(profile.thirdPartyCertification).toBe("not-claimed");
      expect(profile.allowedFeatures).toEqual(
        expect.arrayContaining(["transparency", "optional-content"]),
      );
      expect(Object.isFrozen(profile)).toBe(true);
    }
  });

  it("does not alias or downgrade unknown profile identifiers", () => {
    expect(resolveStudioPdfConformanceProfile("pdf-a-2b")?.id).toBe("pdf-a-2b");
    expect(resolveStudioPdfConformanceProfile("PDF/A-2b")).toBeNull();
    expect(resolveStudioPdfConformanceProfile("pdf-a-3b")).toBeNull();
    expect(resolveStudioPdfConformanceProfile(null)).toBeNull();
  });
});

describe("Studio PDF conformance evidence scanner", () => {
  it("reads the existing deterministic PDF 1.7 writer subset", () => {
    const evidence = scanPlainPdf();

    expect(evidence).toMatchObject({
      scanner: {
        id: STUDIO_PDF_CONFORMANCE_SCANNER_ID,
        version: STUDIO_PDF_CONFORMANCE_SCANNER_VERSION,
        inspectionComplete: true,
      },
      structureValid: true,
      pdfVersion: "1.7",
      pageCount: 1,
      fileIdentifier: { present: false, valid: false },
      pages: {
        allHaveMediaBox: true,
        allHaveTrimOrArtBox: false,
      },
      fonts: {
        used: 0,
        embedded: 0,
        resourceResolutionComplete: true,
        allUsedEmbedded: true,
      },
    });
    expect(evidence.sourceDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it.each([
    {
      target: "pdf-a-2b" as const,
      version: "1.7",
      outputIntent: "GTS_PDFA1",
      pdfaPart: 2,
      pdfaConformance: "B",
      pdfxVersion: null,
      infoPdfxVersion: null,
      trapped: null,
    },
    {
      target: "pdf-x-4" as const,
      version: "1.6",
      outputIntent: "GTS_PDFX",
      pdfaPart: null,
      pdfaConformance: null,
      pdfxVersion: "PDF/X-4",
      infoPdfxVersion: "PDF/X-4",
      trapped: "False",
    },
  ])(
    "extracts $target XMP, Info, ID, page-box, ICC, and transparency evidence",
    ({
      target,
      version,
      outputIntent,
      pdfaPart,
      pdfaConformance,
      pdfxVersion,
      infoPdfxVersion,
      trapped,
    }) => {
      const evidence = scanCandidate(target);

      expect(evidence.pdfVersion).toBe(version);
      expect(evidence.fileIdentifier).toEqual({
        present: true,
        valid: true,
        permanentId: FILE_ID.toLowerCase(),
        revisionId: FILE_ID.toLowerCase(),
      });
      expect(evidence.metadata).toMatchObject({
        xmpPresent: true,
        pdfaPart,
        pdfaConformance,
        pdfxVersion,
        infoPdfxVersion,
        trapped,
      });
      expect(evidence.pages).toEqual({
        allHaveMediaBox: true,
        allHaveTrimOrArtBox: true,
        hasTrimArtConflict: false,
        pageBoundariesValid: true,
      });
      expect(evidence.color).toMatchObject({
        usesDeviceCmyk: true,
        outputIntentCount: 1,
        outputIntent,
        outputIntentIccEmbedded: true,
        outputIntentComponents: 4,
        outputIntentIdentifierPresent: true,
        deviceColorMatchesOutputIntent: true,
      });
      expect(evidence.features.transparency).toBe(true);
    },
  );

  it("returns bounded failure evidence for malformed bytes", () => {
    const result = scanStudioPdfConformanceEvidence(
      Uint8Array.from([0x50, 0x44, 0x46]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "pdf-parse-failed" },
    });
    expect(
      result.ok ? result.evidence.sourceDigest : result.sourceDigest,
    ).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });
});

describe("PDF 1.7 local candidate", () => {
  it("requires only the bounded PDF structure and does not borrow PDF/A or PDF/X claims", () => {
    const evidence = mutableEvidence(scanPlainPdf());
    evidence.features.encrypted = true;
    evidence.features.javascript = true;
    evidence.features.multimedia = true;
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-1.7",
      evidence,
    });

    expect(receipt.result).toEqual({
      decision: "local-candidate",
      localPreflight: "passed",
      externalValidation: "not-run",
      thirdPartyCertification: "not-claimed",
    });
    expect(receipt.rules.every((rule) => rule.status === "passed")).toBe(true);
    expect(receipt.rules.some((rule) => rule.id.startsWith("pdf-a."))).toBe(
      false,
    );
    expect(receipt.rules.some((rule) => rule.id.startsWith("pdf-x."))).toBe(
      false,
    );
  });

  it("rejects a different PDF version instead of treating every PDF as 1.7", () => {
    const evidence = mutableEvidence(scanPlainPdf());
    evidence.pdfVersion = "1.6";
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-1.7",
      evidence,
    });

    expect(receipt.result.decision).toBe("rejected");
    expect(ruleStatus(receipt, "pdf.version-1.7")).toBe("failed");
  });
});

describe("PDF/A-2b local candidate", () => {
  const requiredMutations: readonly [
    string,
    (evidence: Record<string, any>) => void,
    StudioPdfConformanceReceipt["rules"][number]["id"],
  ][] = [
    [
      "complete inspection",
      (evidence) => {
        evidence.scanner.inspectionComplete = false;
      },
      "scanner.inspection-complete",
    ],
    [
      "PDF 1.7",
      (evidence) => {
        evidence.pdfVersion = "1.6";
      },
      "pdf.version-1.7",
    ],
    [
      "file identifier",
      (evidence) => {
        evidence.fileIdentifier = {
          present: false,
          valid: false,
          permanentId: null,
          revisionId: null,
        };
      },
      "pdf.file-identifier",
    ],
    [
      "part 2, level B XMP",
      (evidence) => {
        evidence.metadata.pdfaPart = 3;
      },
      "pdf-a.xmp-identification",
    ],
    [
      "GTS_PDFA1 output intent",
      (evidence) => {
        evidence.color.outputIntent = "GTS_PDFX";
      },
      "pdf-a.output-intent",
    ],
    [
      "output-condition identifier",
      (evidence) => {
        evidence.color.outputIntentIdentifierPresent = false;
      },
      "pdf-a.output-intent",
    ],
    [
      "embedded used fonts",
      (evidence) => {
        evidence.fonts = {
          used: 1,
          embedded: 0,
          resourceResolutionComplete: true,
          allUsedEmbedded: false,
        };
      },
      "pdf-a.fonts-embedded",
    ],
  ];

  it("passes the writer candidate with live transparency and no certification claim", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-a-2b"));
    evidence.features.optionalContent = true;
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
    });

    expect(receipt.result).toEqual({
      decision: "local-candidate",
      localPreflight: "passed",
      externalValidation: "not-run",
      thirdPartyCertification: "not-claimed",
    });
    expect(receipt.rules.every((rule) => rule.status === "passed")).toBe(true);
  });

  it.each(requiredMutations)(
    "rejects missing required condition: %s",
    (_label, mutate, expectedRule) => {
      const evidence = mutableEvidence(scanCandidate("pdf-a-2b"));
      mutate(evidence);
      const receipt = preflightStudioPdfConformance({
        profile: "pdf-a-2b",
        evidence,
      });

      expect(receipt.result.decision).toBe("rejected");
      expect(ruleStatus(receipt, expectedRule)).toBe("failed");
    },
  );

  it.each([
    ["encryption", "encrypted", "pdf-a.no-encryption"],
    ["JavaScript", "javascript", "pdf-a.no-active-content"],
    ["launch action", "launchActions", "pdf-a.no-active-content"],
    ["external reference", "externalReferences", "pdf-a.no-external-content"],
    ["multimedia", "multimedia", "pdf-a.no-multimedia-or-3d"],
    ["3D", "threeD", "pdf-a.no-multimedia-or-3d"],
    [
      "unverified embedded file",
      "embeddedFiles",
      "pdf-a.no-unverified-embedded-files",
    ],
  ] as const)(
    "rejects forbidden %s",
    (_label, feature, expectedRule) => {
      const evidence = mutableEvidence(scanCandidate("pdf-a-2b"));
      evidence.features[feature] = true;
      const receipt = preflightStudioPdfConformance({
        profile: "pdf-a-2b",
        evidence,
      });

      expect(receipt.result.decision).toBe("rejected");
      expect(ruleStatus(receipt, expectedRule)).toBe("failed");
    },
  );

  it("rejects annotations the conservative scanner cannot fully validate", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-a-2b"));
    evidence.features.annotations = 1;
    evidence.features.nonPrintingAnnotations = true;
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
    });

    expect(ruleStatus(receipt, "pdf-a.no-unverified-annotations")).toBe(
      "failed",
    );
  });
});

describe("PDF/X-4 local candidate", () => {
  const requiredMutations: readonly [
    string,
    (evidence: Record<string, any>) => void,
    StudioPdfConformanceReceipt["rules"][number]["id"],
  ][] = [
    [
      "PDF 1.6",
      (evidence) => {
        evidence.pdfVersion = "1.7";
      },
      "pdf.version-1.6",
    ],
    [
      "PDF/X XMP",
      (evidence) => {
        evidence.metadata.pdfxVersion = "PDF/X-4p";
      },
      "pdf-x.xmp-identification",
    ],
    [
      "Info version",
      (evidence) => {
        evidence.metadata.infoPdfxVersion = null;
      },
      "pdf-x.info-identification",
    ],
    [
      "Trapped declaration",
      (evidence) => {
        evidence.metadata.trapped = null;
      },
      "pdf-x.trapped-declared",
    ],
    [
      "GTS_PDFX output intent",
      (evidence) => {
        evidence.color.outputIntent = "GTS_PDFA1";
      },
      "pdf-x.output-intent",
    ],
    [
      "ICC registry declaration",
      (evidence) => {
        evidence.color.outputIntentRegistryName = null;
      },
      "pdf-x.output-intent",
    ],
    [
      "embedded used fonts",
      (evidence) => {
        evidence.fonts = {
          used: 1,
          embedded: 0,
          resourceResolutionComplete: true,
          allUsedEmbedded: false,
        };
      },
      "pdf-x.fonts-embedded",
    ],
    [
      "TrimBox or ArtBox",
      (evidence) => {
        evidence.pages.allHaveTrimOrArtBox = false;
      },
      "pdf-x.page-boundaries",
    ],
    [
      "valid page-boundary geometry",
      (evidence) => {
        evidence.pages.pageBoundariesValid = false;
      },
      "pdf-x.page-boundaries",
    ],
    [
      "device color/output consistency",
      (evidence) => {
        evidence.color.deviceColorMatchesOutputIntent = false;
      },
      "pdf-x.device-color-consistency",
    ],
  ];

  it("passes the writer candidate while retaining PDF/X-4 transparency", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-x-4"));
    evidence.features.optionalContent = true;
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-x-4",
      evidence,
    });

    expect(receipt.result).toEqual({
      decision: "local-candidate",
      localPreflight: "passed",
      externalValidation: "not-run",
      thirdPartyCertification: "not-claimed",
    });
    expect(evidence.features.transparency).toBe(true);
  });

  it.each(requiredMutations)(
    "rejects missing required condition: %s",
    (_label, mutate, expectedRule) => {
      const evidence = mutableEvidence(scanCandidate("pdf-x-4"));
      mutate(evidence);
      const receipt = preflightStudioPdfConformance({
        profile: "pdf-x-4",
        evidence,
      });

      expect(receipt.result.decision).toBe("rejected");
      expect(ruleStatus(receipt, expectedRule)).toBe("failed");
    },
  );

  it("rejects mutually present TrimBox and ArtBox", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-x-4"));
    evidence.pages.hasTrimArtConflict = true;
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-x-4",
      evidence,
    });

    expect(ruleStatus(receipt, "pdf-x.page-boundaries")).toBe("failed");
  });

  it.each([
    ["encryption", "encrypted", "pdf-x.no-encryption"],
    ["JavaScript", "javascript", "pdf-x.no-active-content"],
    ["launch action", "launchActions", "pdf-x.no-active-content"],
    ["external reference", "externalReferences", "pdf-x.no-external-content"],
    ["multimedia", "multimedia", "pdf-x.no-multimedia-or-3d"],
    ["3D", "threeD", "pdf-x.no-multimedia-or-3d"],
    ["embedded file", "embeddedFiles", "pdf-x.no-embedded-files"],
  ] as const)(
    "rejects forbidden %s",
    (_label, feature, expectedRule) => {
      const evidence = mutableEvidence(scanCandidate("pdf-x-4"));
      evidence.features[feature] = true;
      const receipt = preflightStudioPdfConformance({
        profile: "pdf-x-4",
        evidence,
      });

      expect(receipt.result.decision).toBe("rejected");
      expect(ruleStatus(receipt, expectedRule)).toBe("failed");
    },
  );

  it("rejects annotations in the complete-exchange candidate subset", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-x-4"));
    evidence.features.annotations = 1;
    evidence.features.nonPrintingAnnotations = true;
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-x-4",
      evidence,
    });

    expect(ruleStatus(receipt, "pdf-x.no-annotations")).toBe("failed");
  });
});

describe("veraPDF import boundary", () => {
  it("accepts only the complete normalized PDF/A-2b result for the exact source", () => {
    const result = importStudioVeraPdfResult(
      passingVeraPdf(),
      {
        profile: "pdf-a-2b",
        sourceDigest: SOURCE_DIGEST,
      },
    );

    expect(result).toMatchObject({
      accepted: true,
      result: {
        provider: "veraPDF",
        profile: "PDF/A-2b",
        validationComplete: true,
        isCompliant: true,
      },
    });
    expect(result.accepted && Object.isFrozen(result.result)).toBe(true);
  });

  it("elevates wording to external-validator-confirmed but never to certified", () => {
    const evidence = scanCandidate("pdf-a-2b");
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
      veraPdf: passingVeraPdf(evidence.sourceDigest),
    });

    expect(receipt.result).toEqual({
      decision: "external-validator-confirmed",
      localPreflight: "passed",
      externalValidation: "passed",
      thirdPartyCertification: "not-claimed",
    });
    expect(receipt.externalValidation?.provider).toBe("veraPDF");
    expect(JSON.stringify(receipt).toLowerCase()).not.toContain("certified");
  });

  it("imports a complete noncompliant report but rejects the conformance candidate", () => {
    const evidence = scanCandidate("pdf-a-2b");
    const report = JSON.parse(
      JSON.stringify(passingVeraPdf(evidence.sourceDigest)),
    ) as Record<string, any>;
    report.isCompliant = false;
    report.rules[2] = {
      id: "verapdf.pdf-a-2b-validation",
      status: "failed",
      failedChecks: 2,
    };
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
      veraPdf: report,
    });

    expect(receipt.result.localPreflight).toBe("passed");
    expect(receipt.result.externalValidation).toBe("failed");
    expect(receipt.result.decision).toBe("rejected");
    expect(ruleStatus(receipt, "external.verapdf-compliance")).toBe("failed");
  });

  it.each([
    [
      "unknown rule",
      (report: Record<string, any>) => {
        report.rules[2].id = "verapdf.future-rule";
      },
      "unknown-rule",
    ],
    [
      "profile mismatch",
      (report: Record<string, any>) => {
        report.profile = "PDF/A-3b";
      },
      "profile-mismatch",
    ],
    [
      "digest mismatch",
      (report: Record<string, any>) => {
        report.sourceDigest = `sha256:${"b".repeat(64)}`;
      },
      "digest-mismatch",
    ],
    [
      "incomplete rules",
      (report: Record<string, any>) => {
        report.rules.pop();
      },
      "incomplete-validation",
    ],
    [
      "false certification field",
      (report: Record<string, any>) => {
        report.thirdPartyCertification = "certified";
      },
      "invalid-shape",
    ],
  ] as const)(
    "fails closed for %s",
    (_label, mutate, expectedCode) => {
      const report = JSON.parse(
        JSON.stringify(passingVeraPdf()),
      ) as Record<string, any>;
      mutate(report);
      const result = importStudioVeraPdfResult(report, {
        profile: "pdf-a-2b",
        sourceDigest: SOURCE_DIGEST,
      });

      expect(result).toEqual({ accepted: false, code: expectedCode });
    },
  );

  it("rejects veraPDF as an unsupported authority for PDF/X-4", () => {
    const evidence = scanCandidate("pdf-x-4");
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-x-4",
      evidence,
      veraPdf: passingVeraPdf(evidence.sourceDigest),
    });

    expect(receipt.result.decision).toBe("rejected");
    expect(receipt.result.externalValidation).toBe("failed");
    expect(ruleStatus(receipt, "external.verapdf-import")).toBe("failed");
  });
});

describe("deterministic receipt and fail-closed verification", () => {
  it("produces byte-for-byte stable receipt JSON and SHA-256 for identical evidence", () => {
    const evidence = scanCandidate("pdf-a-2b");
    const first = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
    });
    const second = preflightStudioPdfConformance({
      evidence: JSON.parse(JSON.stringify(evidence)),
      profile: "pdf-a-2b",
    });

    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.receiptHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.evidenceHash).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.schema).toBe(STUDIO_PDF_CONFORMANCE_RECEIPT_SCHEMA);
    expect(first.version).toBe(STUDIO_PDF_CONFORMANCE_RECEIPT_VERSION);
    expect(Object.isFrozen(first)).toBe(true);
    expect(verifyStudioPdfConformanceReceipt(first)).toMatchObject({
      valid: true,
    });
  });

  it("changes the receipt fingerprint when exact source identity changes", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-a-2b"));
    const first = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
    });
    evidence.sourceDigest = `sha256:${"f".repeat(64)}`;
    const second = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
    });

    expect(second.receiptHash).not.toBe(first.receiptHash);
    expect(second.sourceDigest).not.toBe(first.sourceDigest);
  });

  it("detects semantic receipt tampering", () => {
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence: scanCandidate("pdf-a-2b"),
    });
    const tampered = JSON.parse(JSON.stringify(receipt));
    tampered.result.decision = "external-validator-confirmed";

    expect(verifyStudioPdfConformanceReceipt(tampered)).toEqual({
      valid: false,
      code: "fingerprint-mismatch",
    });
  });

  it("rejects unknown receipt profiles and rules before considering their claims", () => {
    const receipt = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence: scanCandidate("pdf-a-2b"),
    });
    const unknownProfile = JSON.parse(JSON.stringify(receipt));
    unknownProfile.profile = "pdf-a-9z";
    expect(verifyStudioPdfConformanceReceipt(unknownProfile)).toEqual({
      valid: false,
      code: "unknown-profile",
    });

    const unknownRule = JSON.parse(JSON.stringify(receipt));
    unknownRule.rules[0].id = "pdf.future-rule";
    expect(verifyStudioPdfConformanceReceipt(unknownRule)).toEqual({
      valid: false,
      code: "unknown-rule",
    });
  });

  it("rejects unknown profile requests and extra evidence without fallback", () => {
    const evidence = mutableEvidence(scanCandidate("pdf-a-2b"));
    const unknown = preflightStudioPdfConformance({
      profile: "pdf-a-9z",
      evidence,
    });
    expect(unknown).toMatchObject({
      profile: null,
      result: {
        decision: "rejected",
        localPreflight: "not-run",
      },
      rules: [{ id: "request.profile-known", status: "failed" }],
    });

    evidence.futureRuleEvidence = true;
    const extraEvidence = preflightStudioPdfConformance({
      profile: "pdf-a-2b",
      evidence,
    });
    expect(extraEvidence).toMatchObject({
      profile: "pdf-a-2b",
      result: {
        decision: "rejected",
        localPreflight: "not-run",
      },
      rules: [{ id: "request.valid", status: "failed" }],
    });
    expect(verifyStudioPdfConformanceReceipt(extraEvidence)).toMatchObject({
      valid: true,
    });
  });
});
