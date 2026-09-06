import { describe, expect, it } from "vitest";

import {
  applyAiChangeSet,
  createAiChangeSet,
  rejectAiChangeSet,
  rollbackAiChangeSet,
} from "./studio-ai-change-set";

describe("Studio AI Change Set & Semantic Production Graph", () => {
  function makeChangeSet() {
    return createAiChangeSet({
      id: "cs_gen_01",
      episodeId: "ep_1",
      panelId: "p_1",
      authorUserId: "artist_kim",
      modelConfig: {
        modelName: "WebtoonDiffuser-v2",
        version: "2.1.0",
        prompt: "anime school classroom sunset anime aesthetic",
        seed: 42,
      },
      inputReferences: [
        { assetId: "pose_01", assetName: "Standing Pose", role: "pose-skeleton" },
      ],
      proposedLayers: [
        { layerId: "l_bg", layerName: "AI 배경 레이어", assetUri: "blob:bg.png", blendMode: "source-over", opacity: 1.0 },
        { layerId: "l_light", layerName: "AI 노을 광원", assetUri: "blob:light.png", blendMode: "screen", opacity: 0.8 },
      ],
      computeTokensUsed: 150,
      nowMs: 1_000,
    });
  }

  it("creates proposed change set with full lineage and prompt metadata", () => {
    const cs = makeChangeSet();
    expect(cs.status).toBe("proposed");
    expect(cs.modelConfig.modelName).toBe("WebtoonDiffuser-v2");
    expect(cs.inputReferences).toHaveLength(1);
    expect(cs.proposedLayers).toHaveLength(2);
  });

  it("partially applies selected layers and supports rollback", () => {
    let cs = makeChangeSet();

    // Select only the background layer (l_bg)
    cs = applyAiChangeSet(cs, ["l_bg"], 2_000, "배경만 채택, 광원은 수작업 진행");
    expect(cs.status).toBe("partially-applied");
    expect(cs.proposedLayers.find((l) => l.layerId === "l_bg")?.isSelectedForApply).toBe(true);
    expect(cs.proposedLayers.find((l) => l.layerId === "l_light")?.isSelectedForApply).toBe(false);

    // Rollback
    cs = rollbackAiChangeSet(cs, 3_000);
    expect(cs.status).toBe("rolled-back");
  });

  it("rejects proposal with reason", () => {
    let cs = makeChangeSet();
    cs = rejectAiChangeSet(cs, "화풍 불일치", 2_000);
    expect(cs.status).toBe("rejected");
    expect(cs.reviewNote).toBe("화풍 불일치");
  });
});
