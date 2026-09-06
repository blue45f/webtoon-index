import { describe, expect, it } from "vitest";

import {
  addRemixDerivative,
  calculateRevenueDistribution,
  createCommunityRemixTree,
  validateIpSandboxRules,
  type OfficialIpSandboxRule,
} from "./studio-community-remix-tree";

describe("Studio Community Remix Tree & IP Sandbox", () => {
  const rootWork = {
    workId: "work_original",
    title: "마법학교의 일상 (원작)",
    authorUserId: "orig_author",
    derivativeType: "official-spin-off" as const,
    attributionCredit: "원작: 작가 A",
    isCommercialAllowed: true,
    revenueShares: [{ recipientUserId: "orig_author", role: "original-creator" as const, shareRatio: 1.0 }],
    createdAtMs: 1_000,
  };

  it("builds derivative remix tree and calculates genealogy depth", () => {
    let tree = createCommunityRemixTree({ id: "tree_magic", rootWork });
    expect(tree.nodes).toHaveLength(1);
    expect(tree.nodes[0].depthLevel).toBe(0);

    // 1st generation remix: English localization
    tree = addRemixDerivative(tree, "work_original", {
      workId: "work_remix_en",
      title: "Daily Life in Magic School (EN)",
      authorUserId: "translator_bob",
      derivativeType: "localization",
      attributionCredit: "원작: 작가 A / 번역: Bob",
      isCommercialAllowed: true,
      revenueShares: [
        { recipientUserId: "orig_author", role: "original-creator", shareRatio: 0.7 },
        { recipientUserId: "translator_bob", role: "translator", shareRatio: 0.3 },
      ],
      createdAtMs: 2_000,
    });

    expect(tree.nodes).toHaveLength(2);
    const remixNode = tree.nodes.find((n) => n.workId === "work_remix_en")!;
    expect(remixNode.depthLevel).toBe(1);
    expect(remixNode.parentWorkId).toBe("work_original");
  });

  it("calculates multi-party revenue distribution accurately", () => {
    const remixWork = {
      ...rootWork,
      depthLevel: 0,
      revenueShares: [
        { recipientUserId: "orig_author", role: "original-creator" as const, shareRatio: 0.6 },
        { recipientUserId: "remixer_1", role: "remixer" as const, shareRatio: 0.4 },
      ],
    };

    const payout = calculateRevenueDistribution(remixWork, 1_000_000); // 1,000,000 KRW
    expect(payout.find((p) => p.recipientUserId === "orig_author")?.amountKrw).toBe(600_000);
    expect(payout.find((p) => p.recipientUserId === "remixer_1")?.amountKrw).toBe(400_000);
  });

  it("validates official IP sandbox constraints", () => {
    const sandboxRule: OfficialIpSandboxRule = {
      officialIpId: "ip_magic",
      ipName: "마법학교 공식 IP",
      allowedCharacterIds: ["char_hero", "char_friend"],
      allowedCostumeIds: ["uniform_standard"],
      prohibitedKeywords: ["성인", "잔혹"],
      mandatoryWatermark: "Official Fan Derivative",
    };

    const badWork = {
      charactersUsed: ["char_hero", "unauthorized_villain"],
      synopsis: "잔혹한 전투가 벌어집니다.",
    };

    const violations = validateIpSandboxRules(badWork, sandboxRule);
    expect(violations).toHaveLength(2);
    expect(violations.some((v) => v.code === "UNAUTHORIZED_CHARACTER")).toBe(true);
    expect(violations.some((v) => v.code === "PROHIBITED_COMBINATION")).toBe(true);
  });
});
