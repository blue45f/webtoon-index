import { describe, expect, it } from "vitest";

import {
  parseStudioVrmLicenseMetadata,
  STUDIO_VRM_1_PUBLIC_LICENSE_URL,
  STUDIO_VRM_CC0_1_LICENSE_URL,
  type StudioVrmLicenseMetadataReceipt,
} from "./studio-vrm-license-metadata";
import {
  evaluateStudioVrmLicenseAction,
  type StudioVrmLicenseActionContext,
} from "./studio-vrm-license-policy";

function receiptFor(
  overrides: Record<string, unknown> = {},
  includePermissiveAvatarPermission = true,
): StudioVrmLicenseMetadataReceipt {
  const result = parseStudioVrmLicenseMetadata({
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        humanoid: {},
        meta: {
          name: "Policy avatar",
          authors: ["Author"],
          licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
          ...(includePermissiveAvatarPermission ? { avatarPermission: "everyone" } : {}),
          ...overrides,
        },
      },
    },
  });
  if (!result.ok) throw new Error(result.message);
  return result.receipt;
}

function outgoingContext(
  overrides: StudioVrmLicenseActionContext = {},
): StudioVrmLicenseActionContext {
  return {
    avatarActorBasis: "other",
    containsViolentContent: false,
    containsSexualContent: false,
    containsPoliticalOrReligiousContent: false,
    containsAntisocialOrHateContent: false,
    ...overrides,
  };
}

function policy(
  receipt: StudioVrmLicenseMetadataReceipt,
  action: Parameters<typeof evaluateStudioVrmLicenseAction>[1],
  context?: StudioVrmLicenseActionContext
) {
  return evaluateStudioVrmLicenseAction(receipt, action, context);
}

describe("studio VRM license action policy", () => {
  it("allows a conformant local preview while the restrictive VRM 1.0 defaults block outgoing actions", () => {
    const receipt = receiptFor({}, false);

    expect(policy(receipt, "local-preview").decision).toBe("allow");
    expect(policy(receipt, "internal-edit").decision).toBe("block");
    expect(policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "individual",
      creditProvided: true,
    })).decision).toBe("block");
    expect(policy(receipt, "derivative-export", outgoingContext({ creditProvided: true })).decision)
      .toBe("block");
    expect(policy(receipt, "project-archive-redistribution", outgoingContext({
      creditProvided: true,
    })).decision).toBe("block");
    expect(policy(receipt, "marketplace-share", outgoingContext({ creditProvided: true })).decision)
      .toBe("block");
    expect(receipt.avatarPermission).toBe("only-author");
  });

  it("distinguishes personal-profit permission from corporate permission", () => {
    const personal = receiptFor({
      commercialUsage: "personalProfit",
      creditNotation: "unnecessary",
    });

    expect(policy(personal, "commercial-publish", outgoingContext({
      publisherKind: "individual",
    })).decision)
      .toBe("allow");
    expect(policy(personal, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
    })).decision)
      .toBe("block");
    expect(policy(personal, "commercial-publish", outgoingContext()).decision).toBe("unknown");

    const corporate = receiptFor({
      commercialUsage: "corporation",
      creditNotation: "unnecessary",
    });
    expect(policy(corporate, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
    })).decision)
      .toBe("allow");
  });

  it("requires confirmed attribution for publication and redistribution", () => {
    const receipt = receiptFor({
      commercialUsage: "corporation",
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
    });

    expect(policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
      creditProvided: false,
    })).decision).toBe("block");
    expect(policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
    })).decision).toBe("unknown");
    expect(policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
      creditProvided: true,
    })).decision).toBe("allow");

    expect(policy(receipt, "marketplace-share", outgoingContext({
      creditProvided: null,
    })).decision).toBe("block");
    expect(policy(receipt, "marketplace-share", outgoingContext({
      creditProvided: true,
    })).decision).toBe("allow");
  });

  it("allows a local derivative export only with known modification permission", () => {
    const localDerivative = receiptFor({
      modification: "allowModification",
      creditNotation: "unnecessary",
    });
    expect(policy(localDerivative, "derivative-export", outgoingContext()).decision).toBe("allow");

    const malformed = receiptFor({ modification: "maybe" });
    const result = policy(malformed, "derivative-export", outgoingContext({ creditProvided: true }));
    expect(result.decision).toBe("block");
    expect(result.reasons.map(({ code }) => code)).toContain("fail-closed-unknown-authority");
  });

  it("separates original redistribution from redistribution of a modified model", () => {
    const originalOnly = receiptFor({
      allowRedistribution: true,
      modification: "prohibited",
      creditNotation: "unnecessary",
    });

    expect(policy(originalOnly, "project-archive-redistribution", outgoingContext({
      containsModifiedModel: false,
    })).decision).toBe("allow");
    expect(policy(originalOnly, "project-archive-redistribution", outgoingContext({
      containsModifiedModel: true,
    })).decision).toBe("block");

    const localModificationOnly = receiptFor({
      allowRedistribution: true,
      modification: "allowModification",
      creditNotation: "unnecessary",
    });
    expect(policy(localModificationOnly, "marketplace-share", outgoingContext({
      containsModifiedModel: true,
    })).reasons.map(({ code }) => code)).toContain("modified-redistribution-prohibited");
  });

  it("requires both credit and share-alike confirmation for legacy CC BY-SA sharing", () => {
    const parsed = parseStudioVrmLicenseMetadata({
      extensions: {
        VRM: {
          meta: {
            title: "Legacy share alike",
            author: "Creator",
            licenseName: "CC_BY_SA",
            allowedUserName: "Everyone",
            commercialUssageName: "Allow",
          },
        },
      },
    });
    if (!parsed.ok) throw new Error(parsed.message);

    expect(policy(parsed.receipt, "marketplace-share", outgoingContext({
      creditProvided: true,
      shareAlikeSatisfied: false,
    })).decision).toBe("block");
    expect(policy(parsed.receipt, "marketplace-share", outgoingContext({
      creditProvided: true,
      shareAlikeSatisfied: true,
    })).decision).toBe("allow");
  });

  it("warns for unknown local rights but blocks fail-closed export and sharing", () => {
    const parsed = parseStudioVrmLicenseMetadata({
      extensions: { VRM: { meta: { title: "Undeclared" } } },
    });
    if (!parsed.ok) throw new Error(parsed.message);

    expect(policy(parsed.receipt, "local-preview").decision).toBe("warn");
    expect(policy(parsed.receipt, "internal-edit").decision).toBe("warn");
    expect(policy(parsed.receipt, "derivative-export").decision).toBe("block");
    expect(policy(parsed.receipt, "marketplace-share").decision).toBe("block");
  });

  it("does not auto-authorize additional license terms", () => {
    const receipt = receiptFor({
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      allowRedistribution: true,
      creditNotation: "unnecessary",
      otherLicenseUrl: "https://example.com/additional-terms",
    });

    expect(policy(receipt, "local-preview").decision).toBe("warn");
    expect(policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
    })).decision)
      .toBe("unknown");
    expect(policy(receipt, "derivative-export", outgoingContext()).decision).toBe("block");
    expect(policy(receipt, "marketplace-share", outgoingContext()).decision).toBe("block");
  });

  it("recognizes only the exact official CC0 URL as a canonical nonrestrictive license", () => {
    const rights = {
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      allowRedistribution: true,
      creditNotation: "unnecessary",
    } as const;
    const cc0 = receiptFor({
      ...rights,
      otherLicenseUrl: STUDIO_VRM_CC0_1_LICENSE_URL,
    });

    expect(cc0).toMatchObject({
      licenseIdentifier: "CC0",
      licenseUrl: STUDIO_VRM_CC0_1_LICENSE_URL,
      additionalLicenseUrl: null,
    });
    expect(policy(cc0, "derivative-export", outgoingContext()).decision).toBe("allow");
    expect(policy(cc0, "project-archive-redistribution", outgoingContext({
      containsModifiedModel: true,
    })).decision).toBe("allow");

    const lookalike = receiptFor({
      ...rights,
      otherLicenseUrl: `${STUDIO_VRM_CC0_1_LICENSE_URL}terms`,
    });
    expect(policy(lookalike, "derivative-export", outgoingContext()).decision).toBe("block");
    expect(policy(lookalike, "project-archive-redistribution", outgoingContext({
      containsModifiedModel: true,
    })).decision).toBe("block");
  });

  it("requires explicit content classifications and enforces all four official restrictions", () => {
    const receipt = receiptFor({
      commercialUsage: "corporation",
      creditNotation: "unnecessary",
      allowExcessivelyViolentUsage: false,
      allowExcessivelySexualUsage: false,
      allowPoliticalOrReligiousUsage: false,
      allowAntisocialOrHateUsage: false,
    });

    expect(policy(receipt, "commercial-publish", { publisherKind: "corporation" }).decision)
      .toBe("block");
    const allowed = policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
    }));
    expect(allowed.decision).toBe("allow");
    const prohibited = policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "corporation",
      containsViolentContent: true,
      containsSexualContent: true,
      containsPoliticalOrReligiousContent: true,
      containsAntisocialOrHateContent: true,
    }));
    expect(prohibited.decision).toBe("block");
    expect(prohibited.reasons.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "violent-use-prohibited",
      "sexual-use-prohibited",
      "political-or-religious-use-prohibited",
      "antisocial-or-hate-use-prohibited",
    ]));
  });

  it("enforces avatar user scope and blocks unknown actor identity", () => {
    const authorOnly = receiptFor({
      avatarPermission: "onlyAuthor",
      commercialUsage: "corporation",
      creditNotation: "unnecessary",
    });

    expect(policy(authorOnly, "commercial-publish", outgoingContext({
      avatarActorBasis: "author",
      publisherKind: "unknown",
    })).decision).toBe("allow");
    expect(policy(authorOnly, "commercial-publish", outgoingContext({
      avatarActorBasis: "other",
      publisherKind: "unknown",
    })).decision).toBe("block");
    expect(policy(authorOnly, "commercial-publish", outgoingContext({
      avatarActorBasis: "unknown",
      publisherKind: "unknown",
    })).decision).toBe("block");
  });

  it("treats third-party license notices as unreviewed outgoing terms", () => {
    const receipt = receiptFor({
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      creditNotation: "unnecessary",
      thirdPartyLicenses: "Hair texture: separate vendor terms",
    });

    expect(policy(receipt, "local-preview").decision).toBe("warn");
    expect(policy(receipt, "commercial-publish", outgoingContext({
      publisherKind: "unknown",
    })).decision).toBe("unknown");
    expect(policy(receipt, "derivative-export", outgoingContext()).decision).toBe("block");
  });

  it("returns a deterministic deeply frozen policy receipt", () => {
    const result = policy(receiptFor({ creditNotation: "unnecessary" }), "local-preview");

    expect(result).toMatchObject({
      schema: "toonspectrum.vrm-license-action-policy",
      version: 1,
      decision: "allow",
      authorized: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
    expect(result.reasons.every(Object.isFrozen)).toBe(true);
  });
});
