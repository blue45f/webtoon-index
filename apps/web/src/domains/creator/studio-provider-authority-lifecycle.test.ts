import { describe, expect, it } from "vitest";

import {
  AUTHORITY_STAGES,
  authorityStagePosture,
  classifyAuthorityTransition,
  createAuthorityPromotionReceipt,
  isAuthorityStage,
  isLegalAuthorityTransition,
  nextStagesOf,
  requireQualityShadowStagePosture,
  STUDIO_PROVIDER_AUTHORITY_LIFECYCLE_VERSION,
  type AuthorityPromotionReceiptInput,
  type AuthorityStage,
} from "./studio-provider-authority-lifecycle";

const EXPECTED_TRANSITIONS: Readonly<Record<AuthorityStage, readonly AuthorityStage[]>> = {
  "legacy-authoritative": ["observed"],
  observed: ["legacy-authoritative", "quality-shadow"],
  "quality-shadow": ["observed", "dual-publish", "quarantined"],
  "dual-publish": ["quality-shadow", "canary-presentation", "quarantined"],
  "canary-presentation": ["dual-publish", "next-authoritative", "quarantined"],
  "next-authoritative": ["canary-presentation", "quarantined"],
  quarantined: ["legacy-authoritative", "observed"],
};

function receiptInput(
  overrides: Partial<AuthorityPromotionReceiptInput> = {},
): AuthorityPromotionReceiptInput {
  return {
    capabilityId: "brush/dry-media-final-parity",
    from: "quality-shadow",
    to: "dual-publish",
    providerId: "vnext-gpu-specialist",
    corpusHash: "corpus:8192-plan-sweep:5f2a9c",
    qualityEvidenceRefs: ["parity-sweep://2026-08-20/8192-of-8192"],
    performanceEvidenceRefs: [],
    rollbackProviderId: "legacy-konva-canvas",
    ...overrides,
  };
}

describe("Studio provider authority lifecycle", () => {
  describe("transition legality matrix", () => {
    it("admits exactly the documented transitions across the full stage matrix", () => {
      for (const from of AUTHORITY_STAGES) {
        for (const to of AUTHORITY_STAGES) {
          expect(isLegalAuthorityTransition(from, to), `${from} -> ${to}`)
            .toBe(EXPECTED_TRANSITIONS[from].includes(to));
        }
        expect(nextStagesOf(from)).toEqual(EXPECTED_TRANSITIONS[from]);
        expect(Object.isFrozen(nextStagesOf(from))).toBe(true);
      }
    });

    it("never allows a self transition or a skipped rung", () => {
      for (const stage of AUTHORITY_STAGES) {
        expect(isLegalAuthorityTransition(stage, stage)).toBe(false);
      }
      expect(isLegalAuthorityTransition("legacy-authoritative", "quality-shadow")).toBe(false);
      expect(isLegalAuthorityTransition("observed", "dual-publish")).toBe(false);
      expect(isLegalAuthorityTransition("quality-shadow", "canary-presentation")).toBe(false);
      expect(isLegalAuthorityTransition("quality-shadow", "next-authoritative")).toBe(false);
      expect(isLegalAuthorityTransition("dual-publish", "next-authoritative")).toBe(false);
    });

    it("fails closed for unknown stages", () => {
      const bogus = "renderer-takeover" as AuthorityStage;
      expect(isAuthorityStage(bogus)).toBe(false);
      expect(nextStagesOf(bogus)).toEqual([]);
      expect(isLegalAuthorityTransition(bogus, "observed")).toBe(false);
      expect(isLegalAuthorityTransition("observed", bogus)).toBe(false);
      expect(classifyAuthorityTransition(bogus, "observed")).toBeNull();
      expect(authorityStagePosture(bogus)).toBeNull();
    });

    it("only exits quarantine onto stages where the next provider performs no work", () => {
      for (const to of nextStagesOf("quarantined")) {
        expect(authorityStagePosture(to)?.executesNextProvider).toBe(false);
      }
    });

    it("never grants presentation one hop after the quality shadow", () => {
      for (const to of nextStagesOf("quality-shadow")) {
        const posture = authorityStagePosture(to);
        expect(posture?.presentationPayloadAllowed).toBe(false);
        expect(posture?.authoritativeHandoffAllowed).toBe(false);
        expect(posture?.uiRendererChangeAllowed).toBe(false);
      }
    });

    it("reserves authoritative handoff for the next-authoritative stage alone", () => {
      for (const stage of AUTHORITY_STAGES) {
        expect(authorityStagePosture(stage)?.authoritativeHandoffAllowed)
          .toBe(stage === "next-authoritative");
      }
    });
  });

  describe("quality-shadow stage invariant", () => {
    it("derives the literal shadow posture from the lifecycle table", () => {
      const posture = requireQualityShadowStagePosture("quality-shadow");
      expect(posture).toEqual({
        stage: "quality-shadow",
        presentationPayload: null,
        authoritativeHandoff: false,
        uiRendererChanged: false,
      });
      expect(Object.isFrozen(posture)).toBe(true);
    });

    it("throws for any stage that is not the quality shadow", () => {
      for (const stage of AUTHORITY_STAGES) {
        if (stage === "quality-shadow") continue;
        expect(() => requireQualityShadowStagePosture(stage)).toThrow(/quality-shadow/);
      }
      expect(() => requireQualityShadowStagePosture("presented" as AuthorityStage)).toThrow();
    });
  });

  describe("promotion receipt validation", () => {
    it("creates a frozen receipt for a legal promotion with quality evidence", () => {
      const result = createAuthorityPromotionReceipt(receiptInput());
      expect(result.status).toBe("created");
      if (result.status !== "created") return;
      expect(result.receipt).toEqual({
        kind: "studio-provider-authority-promotion-receipt",
        version: STUDIO_PROVIDER_AUTHORITY_LIFECYCLE_VERSION,
        capabilityId: "brush/dry-media-final-parity",
        from: "quality-shadow",
        to: "dual-publish",
        transition: "promotion",
        providerId: "vnext-gpu-specialist",
        corpusHash: "corpus:8192-plan-sweep:5f2a9c",
        qualityEvidenceRefs: ["parity-sweep://2026-08-20/8192-of-8192"],
        performanceEvidenceRefs: [],
        rollbackProviderId: "legacy-konva-canvas",
      });
      expect(Object.isFrozen(result.receipt)).toBe(true);
      expect(Object.isFrozen(result.receipt.qualityEvidenceRefs)).toBe(true);
    });

    it("rejects every illegal transition", () => {
      expect(createAuthorityPromotionReceipt(receiptInput({
        from: "legacy-authoritative",
        to: "next-authoritative",
      }))).toEqual({
        status: "rejected",
        reason: "illegal-transition",
        detail: "legacy-authoritative->next-authoritative",
      });
      expect(createAuthorityPromotionReceipt(receiptInput({
        from: "quality-shadow",
        to: "quality-shadow",
      }))).toMatchObject({ status: "rejected", reason: "illegal-transition" });
      expect(createAuthorityPromotionReceipt(receiptInput({
        from: "takeover" as AuthorityStage,
      }))).toEqual({ status: "rejected", reason: "unknown-stage" });
    });

    it("demands quality evidence before dual-publish and both evidences before presentation", () => {
      expect(createAuthorityPromotionReceipt(receiptInput({
        qualityEvidenceRefs: [],
      }))).toEqual({
        status: "rejected",
        reason: "missing-quality-evidence",
        detail: "dual-publish",
      });
      expect(createAuthorityPromotionReceipt(receiptInput({
        from: "dual-publish",
        to: "canary-presentation",
        performanceEvidenceRefs: [],
      }))).toEqual({
        status: "rejected",
        reason: "missing-performance-evidence",
        detail: "canary-presentation",
      });
      const canary = createAuthorityPromotionReceipt(receiptInput({
        from: "dual-publish",
        to: "canary-presentation",
        performanceEvidenceRefs: ["frame-budget://canary/2026-08-20"],
      }));
      expect(canary.status).toBe("created");
      const authoritative = createAuthorityPromotionReceipt(receiptInput({
        from: "canary-presentation",
        to: "next-authoritative",
        performanceEvidenceRefs: ["frame-budget://full/2026-08-20"],
      }));
      expect(authoritative.status).toBe("created");
    });

    it("does not demand evidence for early promotions, retreats, quarantine or reentry", () => {
      const early = createAuthorityPromotionReceipt(receiptInput({
        from: "observed",
        to: "quality-shadow",
        qualityEvidenceRefs: [],
      }));
      expect(early.status).toBe("created");
      if (early.status === "created") expect(early.receipt.transition).toBe("promotion");

      const retreat = createAuthorityPromotionReceipt(receiptInput({
        from: "dual-publish",
        to: "quality-shadow",
        qualityEvidenceRefs: [],
      }));
      expect(retreat.status).toBe("created");
      if (retreat.status === "created") expect(retreat.receipt.transition).toBe("retreat");

      const quarantine = createAuthorityPromotionReceipt(receiptInput({
        from: "next-authoritative",
        to: "quarantined",
        qualityEvidenceRefs: [],
      }));
      expect(quarantine.status).toBe("created");
      if (quarantine.status === "created") expect(quarantine.receipt.transition).toBe("quarantine");

      const reentry = createAuthorityPromotionReceipt(receiptInput({
        from: "quarantined",
        to: "observed",
        qualityEvidenceRefs: [],
      }));
      expect(reentry.status).toBe("created");
      if (reentry.status === "created") expect(reentry.receipt.transition).toBe("reentry");
    });

    it("rejects malformed identities and evidence references", () => {
      expect(createAuthorityPromotionReceipt(receiptInput({ capabilityId: "" })))
        .toEqual({ status: "rejected", reason: "invalid-capability-id" });
      expect(createAuthorityPromotionReceipt(receiptInput({ providerId: "has spaces" })))
        .toEqual({ status: "rejected", reason: "invalid-provider-id" });
      expect(createAuthorityPromotionReceipt(receiptInput({ rollbackProviderId: "-leading" })))
        .toEqual({ status: "rejected", reason: "invalid-rollback-provider-id" });
      expect(createAuthorityPromotionReceipt(receiptInput({ corpusHash: "" })))
        .toEqual({ status: "rejected", reason: "invalid-corpus-hash" });
      expect(createAuthorityPromotionReceipt(receiptInput({
        qualityEvidenceRefs: ["dup-ref", "dup-ref"],
      }))).toEqual({ status: "rejected", reason: "invalid-evidence-refs" });
      expect(createAuthorityPromotionReceipt(receiptInput({
        performanceEvidenceRefs: ["ok", 7 as unknown as string],
      }))).toEqual({ status: "rejected", reason: "invalid-evidence-refs" });
      expect(createAuthorityPromotionReceipt(null as unknown as AuthorityPromotionReceiptInput))
        .toEqual({ status: "rejected", reason: "invalid-input" });
    });
  });
});
