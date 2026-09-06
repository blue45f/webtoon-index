import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_1_PUBLIC_LICENSE_URL,
  STUDIO_VRM_CC0_1_LICENSE_URL,
  STUDIO_VRM_CC_BY_4_LICENSE_URL,
  STUDIO_VRM_CC_BY_NC_4_LICENSE_URL,
} from "./studio-vrm-license-metadata";
import {
  createStudioVrmProjectArchiveUseContextReceipt,
  createStudioVrmRenderedPoseUseContextReceipt,
  evaluateStudioVrmLicenseAuthority,
  inspectStudioVrmLicenseAuthority,
  planStudioVrmRenderedPoseMarketplaceShare,
  prepareStudioVrmProjectArchiveAttestation,
  prepareStudioVrmRenderedPoseMarketplaceAttestation,
  presentStudioVrmLicenseAuthority,
  STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT,
  studioVrmProjectArchiveActionContext,
  studioVrmEmbeddedCreditIsRetained,
  type StudioVrmLicenseAuthority,
  unknownStudioVrmLicenseAuthority,
} from "./studio-vrm-license-product-gate";

function vrm1(meta: Record<string, unknown>): unknown {
  return {
    extensions: {
      VRMC_vrm: { specVersion: "1.0", meta },
    },
  };
}

function vrm0(meta: Record<string, unknown>): unknown {
  return { extensions: { VRM: { meta } } };
}

function shareContext(
  authority: StudioVrmLicenseAuthority,
  overrides: Partial<Parameters<typeof createStudioVrmRenderedPoseUseContextReceipt>[0]> = {},
) {
  const attestation = prepareStudioVrmRenderedPoseMarketplaceAttestation(authority);
  if (!attestation.ok) throw new Error(attestation.message);
  return {
    useContextReceipt: createStudioVrmRenderedPoseUseContextReceipt({
      confirmedByUser: true,
      avatarPermissionBasis: "other",
      publisherKind: "corporation",
      confirmedAttributionText: attestation.attributionText,
      containsModifiedModel: true,
      excessivelyViolent: "absent",
      excessivelySexual: "absent",
      politicalOrReligious: "absent",
      antisocialOrHate: "absent",
      shareAlike: "not-satisfied",
      ...overrides,
    }),
    toonspectrumRenderedPoseGrant: STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT,
  };
}

describe("studio VRM license product gate", () => {
  it("keeps unknown rights available for local preview but fail-closes outgoing model files", () => {
    const unknown = unknownStudioVrmLicenseAuthority("missing-metadata", "meta 없음");

    expect(evaluateStudioVrmLicenseAuthority(unknown, "local-preview").decision).toBe("warn");
    expect(evaluateStudioVrmLicenseAuthority(unknown, "internal-edit").decision).toBe("warn");
    expect(evaluateStudioVrmLicenseAuthority(unknown, "commercial-publish").decision).toBe("unknown");
    expect(evaluateStudioVrmLicenseAuthority(unknown, "derivative-export").decision).toBe("block");
    expect(evaluateStudioVrmLicenseAuthority(unknown, "project-archive-redistribution").decision)
      .toBe("block");
    expect(evaluateStudioVrmLicenseAuthority(unknown, "marketplace-share").decision).toBe("block");
  });

  it("evaluates a verified receipt through the official action policy", () => {
    const authority = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Archive-ready",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));
    expect(authority.status).toBe("verified");
    if (authority.status !== "verified") throw new Error(authority.message);

    expect(studioVrmEmbeddedCreditIsRetained(authority.receipt)).toBe(true);
    expect(evaluateStudioVrmLicenseAuthority(
      authority,
      "project-archive-redistribution",
      {
        avatarActorBasis: "other",
        containsModifiedModel: false,
        creditProvided: true,
        containsViolentContent: false,
        containsSexualContent: false,
        containsPoliticalOrReligiousContent: false,
        containsAntisocialOrHateContent: false,
      },
    ).decision).toBe("allow");
    expect(presentStudioVrmLicenseAuthority(authority)).toMatchObject({
      tone: "blocking",
      badge: "재배포 제한",
      localPreviewAllowed: true,
    });
  });

  it("binds multi-model archive consent to actor intersection and exact attribution texts", () => {
    const authorOnly = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Author model",
      authors: ["Author A"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "onlyAuthor",
      allowRedistribution: true,
      creditNotation: "required",
    }));
    const everyone = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Everyone model",
      authors: ["Author B"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      allowRedistribution: true,
      creditNotation: "required",
    }));
    const plan = prepareStudioVrmProjectArchiveAttestation([authorOnly, everyone]);
    expect(plan).toMatchObject({
      ok: true,
      modelCount: 2,
      permittedActorBases: ["author"],
    });
    if (!plan.ok || authorOnly.status !== "verified" || everyone.status !== "verified") {
      throw new Error("expected verified archive attestation");
    }
    const receipt = createStudioVrmProjectArchiveUseContextReceipt({
      confirmedByUser: true,
      avatarPermissionBasis: "author",
      confirmedAttributionTexts: plan.exactAttributionTexts,
      excessivelyViolent: "absent",
      excessivelySexual: "absent",
      politicalOrReligious: "absent",
      antisocialOrHate: "absent",
    });

    expect(studioVrmProjectArchiveActionContext(receipt, authorOnly.receipt).creditProvided)
      .toBe(true);
    expect(studioVrmProjectArchiveActionContext(receipt, everyone.receipt).creditProvided)
      .toBe(true);
    const wrongCredit = createStudioVrmProjectArchiveUseContextReceipt({
      confirmedByUser: true,
      avatarPermissionBasis: "author",
      confirmedAttributionTexts: [],
      excessivelyViolent: "absent",
      excessivelySexual: "absent",
      politicalOrReligious: "absent",
      antisocialOrHate: "absent",
    });
    expect(studioVrmProjectArchiveActionContext(wrongCredit, authorOnly.receipt).creditProvided)
      .toBe(false);
    expect(prepareStudioVrmProjectArchiveAttestation([
      unknownStudioVrmLicenseAuthority("missing-metadata"),
    ])).toMatchObject({ ok: false, code: "authority-unknown" });
  });

  it("presents malformed metadata as a visible warning instead of silently trusting it", () => {
    const authority = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Malformed",
      authors: ["Creator"],
      licenseUrl: "javascript:bad",
    }));

    expect(authority.status).toBe("verified");
    expect(presentStudioVrmLicenseAuthority(authority)).toMatchObject({
      tone: "blocking",
      badge: "조건 오류",
    });
    expect(evaluateStudioVrmLicenseAuthority(authority, "marketplace-share").decision)
      .toBe("block");
  });

  it("distinguishes local-preview availability from a verified redistribution prohibition", () => {
    const authority = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Local only",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      allowRedistribution: false,
    }));

    expect(evaluateStudioVrmLicenseAuthority(authority, "local-preview").decision).toBe("allow");
    expect(presentStudioVrmLicenseAuthority(authority)).toMatchObject({
      tone: "blocking",
      badge: "재배포 제한",
      localPreviewAllowed: true,
    });
  });

  it("fail-closes rendered pose sharing for unknown or commercially prohibited authority", () => {
    const contextAuthority = inspectStudioVrmLicenseAuthority(vrm0({
      title: "Context source",
      author: "Creator",
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
      licenseName: "CC0",
    }));
    const unknownPlan = planStudioVrmRenderedPoseMarketplaceShare(
      unknownStudioVrmLicenseAuthority("missing-metadata"),
      shareContext(contextAuthority),
    );
    expect(unknownPlan).toMatchObject({ ok: false, code: "authority-unknown" });
    expect("rightsConfirmed" in unknownPlan).toBe(false);

    const prohibited = inspectStudioVrmLicenseAuthority(vrm0({
      title: "Noncommercial",
      author: "Creator",
      allowedUserName: "Everyone",
      commercialUssageName: "Disallow",
      licenseName: "CC_BY_NC",
    }));
    const prohibitedPlan = planStudioVrmRenderedPoseMarketplaceShare(
      prohibited,
      shareContext(prohibited),
    );
    expect(prohibitedPlan).toMatchObject({ ok: false, code: "policy-blocked" });
    expect(prohibitedPlan.policyReceipts.commercialPublish.authorized).toBe(false);
  });

  it("requires and emits bounded attribution for exact CC BY while mapping CC0 without credit", () => {
    const ccBy = inspectStudioVrmLicenseAuthority(vrm0({
      title: "Pose model",
      author: "Model Creator",
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
      licenseName: "CC_BY",
    }));
    const missingCredit = planStudioVrmRenderedPoseMarketplaceShare(
      ccBy,
      shareContext(ccBy, { confirmedAttributionText: "다른 크레딧" }),
    );
    expect(missingCredit).toMatchObject({ ok: false, code: "attribution-not-confirmed" });

    const credited = planStudioVrmRenderedPoseMarketplaceShare(ccBy, shareContext(ccBy));
    expect(credited).toMatchObject({
      ok: true,
      rightsConfirmed: true,
      license: "cc-by-4.0",
    });
    if (!credited.ok) throw new Error(credited.message);
    expect(credited.attributionText).toContain("Model Creator");
    expect(credited.attributionText).toContain("CC_BY");
    expect(Array.from(credited.attributionText).length).toBeLessThanOrEqual(160);

    const cc0 = inspectStudioVrmLicenseAuthority(vrm0({
      title: "Public domain pose",
      author: "Creator",
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
      licenseName: "CC0",
    }));
    expect(planStudioVrmRenderedPoseMarketplaceShare(cc0, shareContext(cc0))).toMatchObject({
      ok: true,
      license: "cc0-1.0",
      attributionText: "",
    });
  });

  it("maps exact VRM 1.0 Creative Commons otherLicenseUrl declarations without opening custom terms", () => {
    const explicitVrm1 = (otherLicenseUrl: string) => inspectStudioVrmLicenseAuthority(vrm1({
      name: "Explicitly licensed pose model",
      authors: ["Model Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      otherLicenseUrl,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
      creditNotation: "unnecessary",
    }));

    const cc0 = explicitVrm1(STUDIO_VRM_CC0_1_LICENSE_URL);
    expect(planStudioVrmRenderedPoseMarketplaceShare(cc0, shareContext(cc0))).toMatchObject({
      ok: true,
      rightsConfirmed: true,
      license: "cc0-1.0",
      attributionText: "",
    });

    const ccBy = explicitVrm1(STUDIO_VRM_CC_BY_4_LICENSE_URL);
    const ccByPlan = planStudioVrmRenderedPoseMarketplaceShare(ccBy, shareContext(ccBy));
    expect(ccByPlan).toMatchObject({
      ok: true,
      rightsConfirmed: true,
      license: "cc-by-4.0",
    });
    if (!ccByPlan.ok) throw new Error(ccByPlan.message);
    expect(ccByPlan.attributionText).toContain("Model Creator");
    expect(ccByPlan.attributionText).toContain("CC_BY");
    expect(ccByPlan.attributionText).toContain(STUDIO_VRM_CC_BY_4_LICENSE_URL);

    const ccByNc = explicitVrm1(STUDIO_VRM_CC_BY_NC_4_LICENSE_URL);
    expect(planStudioVrmRenderedPoseMarketplaceShare(ccByNc, shareContext(ccByNc)))
      .toMatchObject({ ok: false, code: "policy-blocked" });

    const custom = explicitVrm1("https://licenses.example/custom");
    expect(planStudioVrmRenderedPoseMarketplaceShare(custom, shareContext(custom)))
      .toMatchObject({ ok: false, code: "policy-blocked" });
  });

  it("blocks additional or unrepresentable CC terms instead of downgrading their license", () => {
    const additionalTerms = inspectStudioVrmLicenseAuthority(vrm0({
      title: "Extra terms",
      author: "Creator",
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
      licenseName: "CC_BY",
      otherLicenseUrl: "https://example.com/extra-license",
    }));
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      additionalTerms,
      shareContext(additionalTerms),
    )).toMatchObject({ ok: false, code: "policy-blocked" });

    const shareAlike = inspectStudioVrmLicenseAuthority(vrm0({
      title: "Share alike",
      author: "Creator",
      allowedUserName: "Everyone",
      commercialUssageName: "Allow",
      licenseName: "CC_BY_SA",
    }));
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      shareAlike,
      shareContext(shareAlike, { shareAlike: "satisfied" }),
    )).toMatchObject({ ok: false, code: "license-unrepresentable" });
  });

  it("projects an exact official CC0 grant from a first-party VRM 1.0 receipt", () => {
    const firstParty = inspectStudioVrmLicenseAuthority(vrm1({
      name: "ToonSpectrum first-party character",
      authors: ["ToonSpectrum"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      otherLicenseUrl: STUDIO_VRM_CC0_1_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      allowRedistribution: true,
      modification: "allowModificationRedistribution",
      creditNotation: "unnecessary",
    }));

    expect(planStudioVrmRenderedPoseMarketplaceShare(
      firstParty,
      shareContext(firstParty),
    )).toMatchObject({
      ok: true,
      license: "cc0-1.0",
      attributionText: "",
    });
  });

  it("uses ToonSpectrum standard only for a permissive VRM 1.0 rendered-only grant", () => {
    const authority = inspectStudioVrmLicenseAuthority(vrm1({
      name: "VRM 1 rendered pose",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      allowRedistribution: false,
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));
    const withoutGrant = planStudioVrmRenderedPoseMarketplaceShare(authority, {
      ...shareContext(authority),
      toonspectrumRenderedPoseGrant: undefined,
    });
    expect(withoutGrant).toMatchObject({ ok: false, code: "license-unrepresentable" });

    const plan = planStudioVrmRenderedPoseMarketplaceShare(authority, shareContext(authority));
    expect(plan).toMatchObject({
      ok: true,
      rightsConfirmed: true,
      license: "toonspectrum-standard",
    });
  });

  it("blocks personal-profit authority for an unknown publisher but accepts a corporate grant", () => {
    const personalProfit = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Personal profit only",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "personalProfit",
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      personalProfit,
      shareContext(personalProfit, { publisherKind: "unknown" }),
    )).toMatchObject({ ok: false, code: "policy-blocked" });

    const corporate = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Corporate grant",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      corporate,
      shareContext(corporate, { publisherKind: "unknown" }),
    )).toMatchObject({ ok: true, license: "toonspectrum-standard" });
  });

  it("requires a valid typed attestation receipt and enforces the official avatar scope", () => {
    const authorOnly = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Author only",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));
    const disclosure = prepareStudioVrmRenderedPoseMarketplaceAttestation(authorOnly);
    expect(disclosure).toMatchObject({
      ok: true,
      avatarPermission: "only-author",
      permittedActorBases: ["author"],
    });
    expect(Object.isFrozen(disclosure)).toBe(true);

    expect(planStudioVrmRenderedPoseMarketplaceShare(authorOnly, {
      useContextReceipt: null,
      toonspectrumRenderedPoseGrant: STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT,
    })).toMatchObject({ ok: false, code: "use-context-missing" });
    expect(planStudioVrmRenderedPoseMarketplaceShare(authorOnly, {
      useContextReceipt: { confirmedByUser: true } as never,
      toonspectrumRenderedPoseGrant: STUDIO_VRM_RENDERED_POSE_PLATFORM_GRANT,
    })).toMatchObject({ ok: false, code: "use-context-invalid" });
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      authorOnly,
      shareContext(authorOnly),
    )).toMatchObject({ ok: false, code: "policy-blocked" });
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      authorOnly,
      shareContext(authorOnly, { avatarPermissionBasis: "author" }),
    )).toMatchObject({ ok: true, rightsConfirmed: true });
  });

  it("blocks unconfirmed or prohibited official content classifications", () => {
    const authority = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Restricted contexts",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));

    const unknown = planStudioVrmRenderedPoseMarketplaceShare(
      authority,
      shareContext(authority, { politicalOrReligious: "unknown" }),
    );
    expect(unknown).toMatchObject({ ok: false, code: "policy-blocked" });
    expect(unknown.policyReceipts.commercialPublish.reasons.map(({ code }) => code))
      .toContain("content-context-unknown");

    const prohibited = planStudioVrmRenderedPoseMarketplaceShare(
      authority,
      shareContext(authority, { antisocialOrHate: "present" }),
    );
    expect(prohibited).toMatchObject({ ok: false, code: "policy-blocked" });
    expect(prohibited.policyReceipts.derivativeExport.reasons.map(({ code }) => code))
      .toContain("antisocial-or-hate-use-prohibited");
  });

  it("blocks third-party terms and credit that cannot be represented without truncation", () => {
    const thirdParty = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Third party model",
      authors: ["Creator"],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      creditNotation: "required",
      thirdPartyLicenses: "Hair texture: separate terms",
    }));
    expect(planStudioVrmRenderedPoseMarketplaceShare(
      thirdParty,
      shareContext(thirdParty),
    )).toMatchObject({ ok: false, code: "policy-blocked" });

    const overlongCredit = inspectStudioVrmLicenseAuthority(vrm1({
      name: "Long credit",
      authors: ["A".repeat(150)],
      licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
      avatarPermission: "everyone",
      commercialUsage: "corporation",
      modification: "allowModificationRedistribution",
      creditNotation: "required",
    }));
    expect(prepareStudioVrmRenderedPoseMarketplaceAttestation(overlongCredit))
      .toMatchObject({ ok: false, code: "credit-unrepresentable" });
  });
});
