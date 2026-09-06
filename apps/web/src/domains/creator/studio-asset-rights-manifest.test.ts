import { describe, expect, it } from "vitest";

import {
  STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER,
  STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA,
  STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS,
  buildStudioAssetRightsManifest,
  canonicalJson,
  hashStudioAssetRightsManifest,
  parseStudioAssetRightsManifestJson,
  serializeStudioAssetRightsManifestCsv,
  serializeStudioAssetRightsManifestJson,
  type StudioAssetRightsManifestBuildInput,
  type StudioAssetRightsUsageInput,
} from "./studio-asset-rights-manifest";

const NOW = Date.parse("2026-07-26T06:00:00.000Z");
const REVIEWED_AT = "2026-07-26T05:55:00.000Z";

function validUsage(
  overrides: Partial<StudioAssetRightsUsageInput> = {}
): StudioAssetRightsUsageInput {
  return {
    assetId: "asset-city-night",
    assetVersion: "sha256:city-night-v4",
    source: { kind: "community", id: "catalog:city-night" },
    scope: ["commercial-publication"],
    licenseId: "cc-by-4.0",
    attributionRequired: true,
    attributionText: "City Night © Hana · CC BY 4.0",
    commercialUse: true,
    aiTraining: "unknown",
    redistribution: true,
    expiresAt: null,
    pageId: "page-02",
    elementId: "background-04",
    ...overrides,
  };
}

function validInput(
  usages: readonly StudioAssetRightsUsageInput[] = [validUsage()],
  overrides: Partial<StudioAssetRightsManifestBuildInput> = {}
): StudioAssetRightsManifestBuildInput {
  return {
    workId: "work-episode-007",
    usages,
    attestation: {
      status: "confirmed",
      reviewedAt: REVIEWED_AT,
      reviewer: "납품 검수자",
    },
    now: NOW,
    ...overrides,
  };
}

function diagnosticCodes(input: StudioAssetRightsManifestBuildInput): string[] {
  return buildStudioAssetRightsManifest(input).diagnostics.map(({ code }) => code);
}

describe("studio asset rights manifest normalization", () => {
  it("builds a fail-closed, deeply readonly publish-preflight projection", () => {
    const result = buildStudioAssetRightsManifest(validInput());

    expect(result.readyForPublishPreflight).toBe(true);
    expect(result.manifest).toMatchObject({
      workId: "work-episode-007",
      localOnly: true,
      disclaimer: STUDIO_ASSET_RIGHTS_MANIFEST_DISCLAIMER,
      attestation: {
        status: "confirmed",
        reviewedAt: REVIEWED_AT,
        reviewer: "납품 검수자",
      },
      summary: {
        inputUsageCount: 1,
        assetCount: 1,
        placementCount: 1,
        errorCount: 0,
        warningCount: 0,
        readyForPublishPreflight: true,
      },
    });
    expect(result.assets[0]).toMatchObject({
      assetId: "asset-city-night",
      assetVersion: "sha256:city-night-v4",
      source: { kind: "community", id: "catalog:city-night" },
      scope: ["commercial-publication", "current-work"],
      license: {
        id: "cc-by-4.0",
        declaredId: "cc-by-4.0",
        label: "CC BY",
      },
      attribution: {
        requirement: "required",
        text: "City Night © Hana · CC BY 4.0",
      },
      commercialUse: "allowed",
      redistribution: "allowed",
      expiryState: "none",
      expiresAt: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.manifest)).toBe(true);
    expect(Object.isFrozen(result.assets)).toBe(true);
    expect(Object.isFrozen(result.assets[0]?.usages)).toBe(true);
  });

  it("projects stable asset versions onto sorted pages and elements", () => {
    const result = buildStudioAssetRightsManifest(validInput([
      validUsage({ pageId: "page-10", elementId: "z" }),
      validUsage({ pageId: "page-02", elementId: "b" }),
      validUsage({ pageId: "page-02", elementId: "a" }),
      validUsage({
        assetId: "asset-character",
        assetVersion: "v2",
        source: { kind: "work-asset", id: "work-asset:character:v2" },
        licenseId: "creator-owned",
        attributionRequired: false,
        attributionText: "",
        commercialUse: true,
        redistribution: "unknown",
        pageId: "page-02",
        elementId: "character-1",
      }),
    ]));

    expect(result.pageProjection).toEqual([
      {
        pageId: "page-02",
        assetCount: 2,
        elementCount: 3,
        assets: [
          {
            assetId: "asset-character",
            assetVersion: "v2",
            elementIds: ["character-1"],
          },
          {
            assetId: "asset-city-night",
            assetVersion: "sha256:city-night-v4",
            elementIds: ["a", "b"],
          },
        ],
      },
      {
        pageId: "page-10",
        assetCount: 1,
        elementCount: 1,
        assets: [{
          assetId: "asset-city-night",
          assetVersion: "sha256:city-night-v4",
          elementIds: ["z"],
        }],
      },
    ]);
    expect(result.elementProjection.map(({ pageId, elementId, assetId }) => [
      pageId,
      elementId,
      assetId,
    ])).toEqual([
      ["page-02", "a", "asset-city-night"],
      ["page-02", "b", "asset-city-night"],
      ["page-02", "character-1", "asset-character"],
      ["page-10", "z", "asset-city-night"],
    ]);
  });

  it("normalizes Unicode and whitespace without retaining secret-shaped metadata", () => {
    const result = buildStudioAssetRightsManifest(validInput([
      validUsage({
        assetId: "  cafe\u0301   skyline  ",
        source: { kind: "external", id: "sk-secretmaterialvalue" },
        licenseId: "custom",
        licenseLabel: "  계약   사용권  ",
        attributionRequired: false,
      }),
    ]));

    expect(result.assets[0]?.assetId).toBe("café skyline");
    expect(result.assets[0]?.license.label).toBe("계약 사용권");
    expect(result.assets[0]?.source).toEqual({ kind: "external", id: null });
    expect(diagnosticCodes(validInput([
      validUsage({
        source: { kind: "external", id: "api key: private-secret-value" },
      }),
    ]))).toContain("SOURCE_MISSING");
    expect(JSON.stringify(result.manifest)).not.toContain("private-secret");
  });
});

describe("studio asset rights diagnostics", () => {
  it("reports missing and unknown rights fields without promoting them to allowed", () => {
    const result = buildStudioAssetRightsManifest({
      workId: "",
      usages: [{
        assetId: "asset-unknown",
        assetVersion: "",
        source: null,
        scope: [
          "commercial-publication",
          "ai-training",
          "redistribution",
        ],
        licenseId: "mystery-license",
        expiresAt: undefined,
        pageId: null,
        elementId: "orphan-element",
      }],
      now: NOW,
    });

    expect(result.readyForPublishPreflight).toBe(false);
    expect(result.assets[0]).toMatchObject({
      assetVersion: null,
      source: { kind: "unknown", id: null },
      license: { id: "unknown", declaredId: "mystery-license" },
      commercialUse: "unknown",
      aiTraining: "unknown",
      redistribution: "unknown",
      expiryState: "unknown",
    });
    expect(result.errors.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "WORK_ID_MISSING",
      "ASSET_VERSION_MISSING",
      "SOURCE_MISSING",
      "LICENSE_UNKNOWN",
      "EXPIRY_UNKNOWN",
      "USAGE_LOCATION_INCOMPATIBLE",
      "COMMERCIAL_USE_UNKNOWN",
      "AI_TRAINING_UNKNOWN",
      "REDISTRIBUTION_UNKNOWN",
      "ATTESTATION_REQUIRED",
    ]));
  });

  it("reports missing stable asset IDs while preserving the bounded audit", () => {
    const result = buildStudioAssetRightsManifest(validInput([
      validUsage({ assetId: "" }),
      validUsage({ assetId: "valid" }),
    ]));

    expect(result.assets.map(({ assetId }) => assetId)).toEqual(["valid"]);
    expect(result.errors.some(({ code }) => code === "ASSET_ID_MISSING")).toBe(true);
    expect(result.readyForPublishPreflight).toBe(false);
  });

  it("detects expired, invalid and unchecked expiry declarations", () => {
    expect(diagnosticCodes(validInput([
      validUsage({ expiresAt: "2026-07-26T05:59:59.999Z" }),
    ]))).toContain("RIGHTS_EXPIRED");
    expect(diagnosticCodes(validInput([
      validUsage({ expiresAt: "not-a-date" }),
    ]))).toContain("EXPIRY_INVALID");
    expect(diagnosticCodes(validInput([
      validUsage({ expiresAt: undefined }),
    ]))).toContain("EXPIRY_UNKNOWN");
  });

  it("applies known license conditions over contradictory declarations", () => {
    const result = buildStudioAssetRightsManifest(validInput([
      validUsage({
        licenseId: "cc-by-nc-4.0",
        commercialUse: true,
        scope: ["commercial-publication"],
      }),
    ]));

    expect(result.assets[0]?.commercialUse).toBe("prohibited");
    expect(result.errors.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "LICENSE_DECLARATION_INCOMPATIBLE",
      "COMMERCIAL_USE_PROHIBITED",
    ]));
  });

  it("checks only requested legal scopes and keeps unknown rights fail-closed when requested", () => {
    const currentWork = buildStudioAssetRightsManifest(validInput([
      validUsage({
        licenseId: "creator-owned",
        attributionRequired: false,
        aiTraining: "unknown",
        redistribution: "unknown",
        scope: ["current-work"],
      }),
    ]));
    expect(currentWork.errors).toHaveLength(0);

    const expanded = buildStudioAssetRightsManifest(validInput([
      validUsage({
        licenseId: "creator-owned",
        attributionRequired: false,
        aiTraining: "unknown",
        redistribution: false,
        scope: ["ai-training", "redistribution"],
      }),
    ]));
    expect(expanded.errors.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "AI_TRAINING_UNKNOWN",
      "REDISTRIBUTION_PROHIBITED",
    ]));
  });

  it("merges duplicates deterministically and records rights conflicts", () => {
    const first = validUsage({ pageId: "page-01", elementId: "same" });
    const duplicate = { ...first };
    const conflict = validUsage({
      pageId: "page-03",
      elementId: "different",
      source: { kind: "external", id: "vendor:city-night" },
      licenseId: "custom",
      licenseLabel: "Vendor EULA",
      attributionRequired: false,
      attributionText: "",
      commercialUse: false,
      redistribution: false,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    const result = buildStudioAssetRightsManifest(validInput([
      conflict,
      duplicate,
      first,
    ]));

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]).toMatchObject({
      source: { kind: "unknown", id: null },
      license: { id: "unknown" },
      commercialUse: "prohibited",
      redistribution: "prohibited",
      expiryState: "unknown",
    });
    expect(result.assets[0]?.usages).toEqual([
      { pageId: "page-01", elementId: "same" },
      { pageId: "page-03", elementId: "different" },
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "DUPLICATE_USAGE",
      "SOURCE_CONFLICT",
      "LICENSE_CONFLICT",
      "ATTRIBUTION_CONFLICT",
      "EXPIRY_CONFLICT",
    ]));
  });

  it("reports one asset identifier resolving to multiple versions", () => {
    expect(diagnosticCodes(validInput([
      validUsage({ assetVersion: "v1" }),
      validUsage({ assetVersion: "v2", pageId: "page-03", elementId: "other" }),
    ]))).toContain("ASSET_VERSION_CONFLICT");
  });

  it("rejects absent, rejected, private and future-dated attestations", () => {
    expect(diagnosticCodes(validInput(undefined, { attestation: null })))
      .toContain("ATTESTATION_REQUIRED");
    expect(diagnosticCodes(validInput(undefined, {
      attestation: {
        status: "rejected",
        reviewedAt: REVIEWED_AT,
        reviewer: "검수자",
      },
    }))).toContain("ATTESTATION_REJECTED");
    expect(diagnosticCodes(validInput(undefined, {
      attestation: {
        status: "confirmed",
        reviewedAt: REVIEWED_AT,
        reviewer: "reviewer@example.com",
      },
    }))).toContain("ATTESTATION_INVALID");
    expect(diagnosticCodes(validInput(undefined, {
      attestation: {
        status: "confirmed",
        reviewedAt: "2026-07-26T06:06:00.000Z",
        reviewer: "검수자",
      },
    }))).toContain("ATTESTATION_INVALID");
  });

  it("enforces unique-asset and usage safety budgets without unbounded output", () => {
    const usages = Array.from(
      { length: STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.assets + 1 },
      (_, index) => validUsage({
        assetId: `asset-${String(index).padStart(3, "0")}`,
        assetVersion: "v1",
        source: { kind: "builtin", id: `builtin-${index}` },
        pageId: "page-01",
        elementId: `element-${index}`,
      })
    );
    const result = buildStudioAssetRightsManifest(validInput(usages));

    expect(result.assets).toHaveLength(STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.assets);
    expect(result.errors.some(({ code }) => code === "ASSET_LIMIT_EXCEEDED")).toBe(true);
    expect(result.manifest.diagnostics.length).toBeLessThanOrEqual(
      STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.diagnostics
    );
  });
});

describe("studio asset rights deterministic interchange", () => {
  it("produces the same canonical manifest and hash for shuffled usage input", async () => {
    const a = validUsage({ pageId: "page-03", elementId: "z" });
    const b = validUsage({ pageId: "page-01", elementId: "a" });
    const c = validUsage({
      assetId: "asset-a",
      assetVersion: "v1",
      source: { kind: "builtin", id: "builtin-a" },
      licenseId: "toonspectrum-standard",
      attributionRequired: false,
      attributionText: "",
      pageId: "page-02",
      elementId: "m",
    });
    const left = buildStudioAssetRightsManifest(validInput([a, b, c])).manifest;
    const right = buildStudioAssetRightsManifest(validInput([c, a, b])).manifest;

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(await hashStudioAssetRightsManifest(left)).toBe(
      await hashStudioAssetRightsManifest(right)
    );
  });

  it("round-trips strict integrity-bearing JSON", async () => {
    const manifest = buildStudioAssetRightsManifest(validInput()).manifest;
    const serialized = await serializeStudioAssetRightsManifestJson(manifest);
    const parsedEnvelope = JSON.parse(serialized) as {
      schema: string;
      integrity: { algorithm: string; canonicalHash: string };
    };

    expect(serialized.endsWith("\n")).toBe(true);
    expect(parsedEnvelope.schema).toBe(STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA);
    expect(parsedEnvelope.integrity).toMatchObject({
      algorithm: "SHA-256",
      canonicalHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
    });
    await expect(parseStudioAssetRightsManifestJson(serialized, NOW))
      .resolves.toEqual(manifest);
  });

  it("fails closed on malformed, oversized, extended, tampered and stale-ready JSON", async () => {
    const manifest = buildStudioAssetRightsManifest(validInput([
      validUsage({ expiresAt: "2026-07-27T00:00:00.000Z" }),
    ])).manifest;
    const serialized = await serializeStudioAssetRightsManifestJson(manifest);
    const envelope = JSON.parse(serialized) as Record<string, unknown>;

    await expect(parseStudioAssetRightsManifestJson("{broken", NOW))
      .rejects.toThrow("해석");
    await expect(parseStudioAssetRightsManifestJson(
      " ".repeat(STUDIO_ASSET_RIGHTS_MANIFEST_LIMITS.jsonBytes + 1),
      NOW
    )).rejects.toThrow("크기");

    await expect(parseStudioAssetRightsManifestJson(JSON.stringify({
      ...envelope,
      privateLocalPath: "/Users/private/source.glb",
    }), NOW)).rejects.toThrow("형식");

    const tampered = structuredClone(envelope) as {
      manifest: { workId: string | null };
    };
    tampered.manifest.workId = "tampered";
    await expect(parseStudioAssetRightsManifestJson(JSON.stringify(tampered), NOW))
      .rejects.toThrow("무결성");

    await expect(parseStudioAssetRightsManifestJson(
      serialized,
      Date.parse("2026-07-28T00:00:00.000Z")
    )).rejects.toThrow("미확인 권리");
  });

  it("rejects non-canonical ordering even when the integrity hash matches", async () => {
    const manifest = buildStudioAssetRightsManifest(validInput([
      validUsage({ assetId: "asset-b" }),
      validUsage({
        assetId: "asset-a",
        source: { kind: "builtin", id: "builtin-a" },
        licenseId: "toonspectrum-standard",
        attributionRequired: false,
        attributionText: "",
      }),
    ])).manifest;
    const reversed = {
      ...manifest,
      assets: [...manifest.assets].reverse(),
    };
    const canonicalHash = await hashStudioAssetRightsManifest(reversed);
    const serialized = JSON.stringify({
      schema: STUDIO_ASSET_RIGHTS_MANIFEST_EXPORT_SCHEMA,
      version: 1,
      integrity: { algorithm: "SHA-256", canonicalHash },
      manifest: reversed,
    });

    await expect(parseStudioAssetRightsManifestJson(serialized, NOW))
      .rejects.toThrow("정렬");
  });

  it("serializes deterministic RFC 4180 CSV and neutralizes spreadsheet formulas", () => {
    const manifest = buildStudioAssetRightsManifest(validInput([
      validUsage({
        attributionText: '=HYPERLINK("https://evil.invalid","click")',
        pageId: "page-01",
        elementId: "panel,1",
      }),
    ])).manifest;
    const first = serializeStudioAssetRightsManifestCsv(manifest);
    const second = serializeStudioAssetRightsManifestCsv(manifest);

    expect(first).toBe(second);
    expect(first.endsWith("\r\n")).toBe(true);
    expect(first.split("\r\n")[0]).toContain('"asset_id","asset_version"');
    expect(first).toContain(
      `"'=HYPERLINK(""https://evil.invalid"",""click"")"`
    );
    expect(first).toContain('"panel,1"');
    expect(first).not.toContain("/Users/");
  });
});
