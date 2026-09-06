import { describe, expect, it } from "vitest";

import {
  addRightsBomItem,
  auditRightsCompliance,
  createRightsBomRegistry,
  generateProvenanceCertificate,
  removeRightsBomItem,
  type RightsBomItem,
} from "./studio-rights-bom-provenance";

describe("Studio Rights BOM & Provenance Engine", () => {
  const fontItem: RightsBomItem = {
    id: "bom_font_1",
    assetRef: "font:gmarket_sans",
    assetName: "Gmarket Sans Bold",
    kind: "font",
    attribution: { creatorName: "Gmarket", copyrightHolder: "Gmarket Corp" },
    license: "commercial-unlimited",
    permissions: {
      allowCommercialUse: true,
      allowModification: false,
      allowRedistribution: false,
      requireAttribution: false,
    },
    allowedMediaTypes: ["webtoon", "print"],
  };

  const personal3dItem: RightsBomItem = {
    id: "bom_3d_personal",
    assetRef: "prop:blender_sword",
    assetName: "Hero Magic Sword",
    kind: "3d-prop",
    attribution: { creatorName: "Artist_A", copyrightHolder: "Artist_A" },
    license: "editorial-only",
    permissions: {
      allowCommercialUse: false, // Non-commercial only
      allowModification: true,
      allowRedistribution: false,
      requireAttribution: true,
    },
  };

  const expiringItem: RightsBomItem = {
    id: "bom_music_1",
    assetRef: "audio:bgm_intro",
    assetName: "Epic Intro Theme",
    kind: "audio-track",
    attribution: { creatorName: "Composer_K", copyrightHolder: "AudioStudio" },
    license: "custom-contract",
    permissions: {
      allowCommercialUse: true,
      allowModification: false,
      allowRedistribution: false,
      requireAttribution: true,
    },
    expiresAtMs: 1_700_000_000_000, // 2023-11
  };

  it("creates and manages BOM registry", () => {
    let reg = createRightsBomRegistry({ id: "reg_1", episodeId: "ep_1" });
    expect(reg.items).toHaveLength(0);

    reg = addRightsBomItem(reg, fontItem);
    expect(reg.items).toHaveLength(1);

    reg = removeRightsBomItem(reg, "bom_font_1");
    expect(reg.items).toHaveLength(0);
  });

  it("audits commercial compliance and expiration", () => {
    const now = 1_700_000_000_000 + 1000; // after expiry
    const reg = createRightsBomRegistry({
      id: "reg_audit",
      episodeId: "ep_1",
      items: [fontItem, personal3dItem, expiringItem],
    });

    const diags = auditRightsCompliance(reg, { isCommercial: true, targetMediaType: "webtoon" }, now);

    // 1. Non commercial item used commercially -> error
    expect(diags.some((d) => d.code === "COMMERCIAL_USE_FORBIDDEN" && d.itemId === "bom_3d_personal")).toBe(true);

    // 2. Expired item -> error
    expect(diags.some((d) => d.code === "LICENSE_EXPIRED" && d.itemId === "bom_music_1")).toBe(true);
  });

  it("generates provenance certificate with AI disclosure", () => {
    const aiItem: RightsBomItem = {
      id: "bom_ai_ref",
      assetRef: "ai:concept_background",
      assetName: "Concept BG Ref",
      kind: "ai-reference",
      attribution: { creatorName: "GenAI", copyrightHolder: "Studio" },
      license: "proprietary",
      permissions: { allowCommercialUse: true, allowModification: true, allowRedistribution: false, requireAttribution: false },
    };

    const reg = createRightsBomRegistry({ id: "reg_prov", episodeId: "ep_5", items: [fontItem, aiItem] });
    const cert = generateProvenanceCertificate(reg, { humanAuthors: ["작가 김웹툰"], nowMs: 1_700_000_000_000 });

    expect(cert.episodeId).toBe("ep_5");
    expect(cert.humanAuthors).toEqual(["작가 김웹툰"]);
    expect(cert.aiAssistanceDeclared).toBe(true);
    expect(cert.totalTrackedAssets).toBe(2);
    expect(cert.manifestDigest).toContain("c2pa:toonspectrum:ep_5");
  });
});
