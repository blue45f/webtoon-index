import { describe, expect, it } from "vitest";

import {
  canonicalStudioVrmLicenseMetadataReceiptJson,
  parseStudioVrmLicenseMetadata,
  STUDIO_VRM_1_PUBLIC_LICENSE_URL,
  STUDIO_VRM_CC0_1_LICENSE_URL,
  STUDIO_VRM_CC_BY_4_LICENSE_URL,
  STUDIO_VRM_CC_BY_NC_4_LICENSE_URL,
  STUDIO_VRM_LICENSE_METADATA_LIMITS,
  type StudioVrmLicenseMetadataReceipt,
} from "./studio-vrm-license-metadata";

function parseReceipt(input: unknown): StudioVrmLicenseMetadataReceipt {
  const result = parseStudioVrmLicenseMetadata(input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.receipt;
}

function vrm1(meta: Record<string, unknown>, specVersion: unknown = "1.0"): unknown {
  return {
    asset: { version: "2.0" },
    extensions: {
      VRMC_vrm: {
        specVersion,
        meta,
        humanoid: {},
      },
    },
  };
}

describe("studio VRM license metadata admission", () => {
  it("normalizes complete VRM 1.0 metadata and preserves its declared intent", () => {
    const receipt = parseReceipt(vrm1({
      name: "  아바타  A ",
      authors: [" Alice ", "김 작가"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      allowRedistribution: true,
      creditNotation: "unnecessary",
      avatarPermission: "everyone",
      allowExcessivelyViolentUsage: true,
      allowExcessivelySexualUsage: false,
      allowPoliticalOrReligiousUsage: true,
      allowAntisocialOrHateUsage: false,
      thirdPartyLicenses: "Texture: CC0\r\nHair: licensed separately",
    }));

    expect(receipt).toMatchObject({
      spec: "vrm1",
      sourcePath: "extensions.VRMC_vrm.meta",
      declaredSpecVersion: "1.0",
      conformance: "conformant",
      title: "아바타 A",
      authors: ["Alice", "김 작가"],
      licenseIdentifier: "VRM-Public-License-1.0",
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      commercial: "corporation",
      modification: "allow-modification-redistribution",
      redistribution: "allow",
      credit: "unnecessary",
      avatarPermission: "everyone",
      violent: "allow",
      sexual: "disallow",
      politicalOrReligious: "allow",
      antisocialOrHate: "disallow",
      thirdPartyLicenses: "Texture: CC0\nHair: licensed separately",
      rawIntent: {
        title: "  아바타  A ",
        authors: [" Alice ", "김 작가"],
        commercial: "corporation",
        modification: "allowModificationRedistribution",
        redistribution: true,
        credit: "unnecessary",
        avatarPermission: "everyone",
        violent: true,
        sexual: false,
        politicalOrReligious: true,
        antisocialOrHate: false,
        thirdPartyLicenses: "Texture: CC0\r\nHair: licensed separately",
      },
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.authors)).toBe(true);
    expect(Object.isFrozen(receipt.rawIntent)).toBe(true);
  });

  it.each([
    {
      otherLicenseUrl: STUDIO_VRM_CC0_1_LICENSE_URL,
      licenseIdentifier: "CC0",
      commercial: "allow",
      credit: "unnecessary",
    },
    {
      otherLicenseUrl: STUDIO_VRM_CC_BY_4_LICENSE_URL,
      licenseIdentifier: "CC_BY",
      commercial: "allow",
      credit: "required",
    },
    {
      otherLicenseUrl: STUDIO_VRM_CC_BY_NC_4_LICENSE_URL,
      licenseIdentifier: "CC_BY_NC",
      commercial: "disallow",
      credit: "required",
    },
  ] as const)(
    "treats exact VRM 1.0 $licenseIdentifier otherLicenseUrl as the explicit model license",
    ({ otherLicenseUrl, licenseIdentifier, commercial, credit }) => {
      const receipt = parseReceipt(vrm1({
        name: `${licenseIdentifier} model`,
        authors: ["Model Creator"],
        licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
        otherLicenseUrl,
        avatarPermission: "everyone",
        commercialUsage: "corporation",
        allowRedistribution: true,
        modification: "allowModificationRedistribution",
        creditNotation: "unnecessary",
      }));

      expect(receipt).toMatchObject({
        conformance: "conformant",
        licenseIdentifier,
        licenseUrl: otherLicenseUrl,
        additionalLicenseUrl: null,
        commercial,
        modification: "allow-modification-redistribution",
        redistribution: "allow",
        credit,
        shareAlike: "not-required",
        rawIntent: {
          licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
          otherLicenseUrl,
        },
      });
    },
  );

  it("keeps unrecognized or noncanonical VRM 1.0 otherLicenseUrl terms fail-closed", () => {
    for (const otherLicenseUrl of [
      "https://licenses.example/custom",
      `${STUDIO_VRM_CC_BY_4_LICENSE_URL}?variant=custom`,
      "http://creativecommons.org/licenses/by/4.0/",
    ]) {
      const receipt = parseReceipt(vrm1({
        name: "Unrecognized terms",
        authors: ["Creator"],
        licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
        otherLicenseUrl,
      }));
      expect(receipt).toMatchObject({
        licenseIdentifier: "VRM-Public-License-1.0",
        licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
        additionalLicenseUrl: otherLicenseUrl,
      });
    }
  });

  it("applies official VRM 1.0 defaults only when optional declarations are absent", () => {
    const receipt = parseReceipt(vrm1({
      name: "Defaulted",
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
    }));

    expect(receipt).toMatchObject({
      conformance: "conformant",
      commercial: "personal-nonprofit",
      modification: "prohibited",
      redistribution: "disallow",
      credit: "required",
      avatarPermission: "only-author",
      violent: "disallow",
      sexual: "disallow",
      politicalOrReligious: "disallow",
      antisocialOrHate: "disallow",
      thirdPartyLicenses: null,
    });
    expect(receipt.rawIntent).toMatchObject({
      title: "Defaulted",
      authors: ["Author"],
      commercial: null,
      modification: null,
      redistribution: null,
      credit: null,
      avatarPermission: null,
      violent: null,
      sexual: null,
      politicalOrReligious: null,
      antisocialOrHate: null,
      thirdPartyLicenses: null,
    });
  });

  it("does not turn malformed VRM 1.0 declarations into permissive defaults", () => {
    const receipt = parseReceipt(vrm1({
      name: "Malformed",
      authors: ["Author"],
      licenseUrl: "javascript:alert(1)",
      commercialUsage: "allCompanies",
      modification: "anything",
      allowRedistribution: "true",
      creditNotation: "optional",
      avatarPermission: "friendsOnly",
      allowExcessivelyViolentUsage: "yes",
      allowExcessivelySexualUsage: 1,
      allowPoliticalOrReligiousUsage: "yes",
      allowAntisocialOrHateUsage: 1,
      thirdPartyLicenses: 42,
    }));

    expect(receipt).toMatchObject({
      conformance: "nonconformant",
      licenseUrl: null,
      commercial: "unknown",
      modification: "unknown",
      redistribution: "unknown",
      credit: "unknown",
      avatarPermission: "unknown",
      violent: "unknown",
      sexual: "unknown",
      politicalOrReligious: "unknown",
      antisocialOrHate: "unknown",
      thirdPartyLicenses: null,
    });
    expect(receipt.rawIntent).toMatchObject({
      licenseUrl: "javascript:alert(1)",
      commercial: "allCompanies",
      modification: "anything",
      redistribution: "true",
      credit: "optional",
      avatarPermission: "friendsOnly",
      violent: "yes",
      sexual: null,
      politicalOrReligious: "yes",
      antisocialOrHate: null,
      thirdPartyLicenses: null,
    });
    expect(receipt.diagnostics.map(({ code }) => code)).toContain("invalid-url");
    expect(receipt.diagnostics.map(({ code }) => code)).toContain("invalid-field-value");
    expect(receipt.diagnostics.map(({ code }) => code)).toContain("invalid-field-type");
  });

  it("rejects invisible format controls before they can alter displayed credit intent", () => {
    const receipt = parseReceipt(vrm1({
      name: "Safe\u202Etxt",
      authors: ["Creator\u200BName"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      thirdPartyLicenses: "Texture\u2066terms",
    }));

    expect(receipt).toMatchObject({
      conformance: "nonconformant",
      title: null,
      authors: [],
      thirdPartyLicenses: null,
    });
    expect(receipt.rawIntent).toMatchObject({
      title: "Safe\u202Etxt",
      authors: ["Creator\u200BName"],
      thirdPartyLicenses: "Texture\u2066terms",
    });
  });

  it("reports missing VRM 1.0 required fields without manufacturing identity or authority", () => {
    const receipt = parseReceipt(vrm1({}));

    expect(receipt.conformance).toBe("nonconformant");
    expect(receipt.title).toBeNull();
    expect(receipt.authors).toEqual([]);
    expect(receipt.licenseUrl).toBeNull();
    expect(receipt.diagnostics.filter(({ code }) => code === "missing-required-field"))
      .toHaveLength(3);
  });

  it("preserves a custom license as conformant but does not turn it into known authority", () => {
    const custom = parseReceipt(vrm1({
      name: "Future",
      authors: ["Author"],
      licenseUrl: "https://example.com/custom-license",
    }));

    expect(custom.conformance).toBe("conformant");
    expect(custom.licenseUrl).toBe("https://example.com/custom-license");
    expect(custom.licenseIdentifier).toBeNull();
    expect(custom.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "unsupported-license-document",
    }));

    const unsupportedVersion = parseReceipt(vrm1({
      name: "Future",
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
    }, "2.0"));
    expect(unsupportedVersion.conformance).toBe("nonconformant");
    expect(unsupportedVersion.diagnostics.map(({ path }) => path))
      .toContain("extensions.VRMC_vrm.specVersion");
  });

  it("normalizes legacy CC BY-NC-SA permissions and marks contradictory commercial intent", () => {
    const receipt = parseReceipt({
      extensions: {
        VRM: {
          meta: {
            title: "Legacy",
            author: "Creator",
            licenseName: "CC_BY_NC_SA",
            allowedUserName: "Everyone",
            commercialUssageName: "Allow",
            violentUssageName: "Disallow",
            sexualUssageName: "Allow",
          },
        },
      },
    });

    expect(receipt).toMatchObject({
      spec: "vrm0",
      title: "Legacy",
      authors: ["Creator"],
      licenseIdentifier: "CC_BY_NC_SA",
      avatarPermission: "everyone",
      commercial: "disallow",
      modification: "allow-modification-redistribution",
      redistribution: "allow",
      credit: "required",
      violent: "disallow",
      sexual: "allow",
      shareAlike: "required",
      conformance: "nonconformant",
    });
    expect(receipt.rawIntent.commercial).toBe("Allow");
    expect(receipt.rawIntent.avatarPermission).toBe("Everyone");
    expect(receipt.diagnostics.map(({ code }) => code))
      .toContain("conflicting-license-declarations");
  });

  it("keeps legacy custom terms as bounded URLs without treating them as a known license", () => {
    const receipt = parseReceipt({
      extensions: {
        VRM: {
          meta: {
            licenseName: "Other",
            otherLicenseUrl: " https://licenses.example/terms#section ",
            otherPermissionUrl: "http://permissions.example/extra",
          },
        },
      },
    });

    expect(receipt).toMatchObject({
      conformance: "conformant",
      licenseIdentifier: "Other",
      licenseUrl: "https://licenses.example/terms",
      additionalLicenseUrl: "https://licenses.example/terms",
      additionalPermissionUrl: "http://permissions.example/extra",
      commercial: "unknown",
      modification: "unknown",
      redistribution: "unknown",
    });
    expect(receipt.rawIntent.otherLicenseUrl).toBe(" https://licenses.example/terms#section ");
  });

  it("rejects version ambiguity instead of choosing a more permissive declaration", () => {
    const result = parseStudioVrmLicenseMetadata({
      extensions: {
        VRM: { meta: {} },
        VRMC_vrm: { specVersion: "1.0", meta: {} },
      },
    });

    expect(result).toEqual(expect.objectContaining({ ok: false, code: "ambiguous-metadata" }));
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("enforces string, entry, depth, and JSON-data budgets before producing a receipt", () => {
    const overlong = parseStudioVrmLicenseMetadata(vrm1({
      name: "x".repeat(STUDIO_VRM_LICENSE_METADATA_LIMITS.maxStringBytes + 1),
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
    }));
    expect(overlong).toEqual(expect.objectContaining({
      ok: false,
      code: "metadata-budget-exceeded",
    }));

    let nested: unknown = "leaf";
    for (let index = 0; index <= STUDIO_VRM_LICENSE_METADATA_LIMITS.maxDepth; index += 1) {
      nested = { nested };
    }
    const tooDeep = parseStudioVrmLicenseMetadata(vrm1({
      name: "Deep",
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      extras: nested,
    }));
    expect(tooDeep).toEqual(expect.objectContaining({
      ok: false,
      code: "metadata-budget-exceeded",
    }));

    const cyclic: Record<string, unknown> = {
      name: "Cycle",
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
    };
    cyclic.self = cyclic;
    const cycleResult = parseStudioVrmLicenseMetadata(vrm1(cyclic));
    expect(cycleResult).toEqual(expect.objectContaining({ ok: false, code: "metadata-not-json" }));
  });

  it("rejects accessor-backed metadata without invoking the accessor", () => {
    let invoked = false;
    const meta = {
      name: "Safe",
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
    } as Record<string, unknown>;
    Object.defineProperty(meta, "commercialUsage", {
      enumerable: true,
      get() {
        invoked = true;
        return "corporation";
      },
    });

    const result = parseStudioVrmLicenseMetadata(vrm1(meta));
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "metadata-not-json" }));
    expect(invoked).toBe(false);
  });

  it("canonicalizes equivalent receipts independently of input object key order", () => {
    const left = parseReceipt(vrm1({
      name: "Canonical",
      authors: ["Author"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
    }));
    const right = parseReceipt({
      extensions: {
        VRMC_vrm: {
          humanoid: {},
          meta: {
            modification: "allowModificationRedistribution",
            allowRedistribution: true,
            licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
            authors: ["Author"],
            name: "Canonical",
          },
          specVersion: "1.0",
        },
      },
      asset: { version: "2.0" },
    });

    expect(canonicalStudioVrmLicenseMetadataReceiptJson(left))
      .toBe(canonicalStudioVrmLicenseMetadataReceiptJson(right));
    expect(left.metadataJsonBytes).toBe(
      new TextEncoder().encode(JSON.stringify({
        name: "Canonical",
        authors: ["Author"],
        licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
        allowRedistribution: true,
        modification: "allowModificationRedistribution",
      })).byteLength
    );
  });
});
