import { ImageEmbedder } from "@mediapipe/tasks-vision";
import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
  StudioVrmAvatarReferenceError,
  admitStudioVrmAvatarReferenceCatalogue,
  isStudioVrmAvatarReferenceRecommendationReceipt,
  rankStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceCatalogue,
} from "./studio-vrm-avatar-reference-recommendation";

const QUERY_HASH = "a".repeat(64);

function catalogue(
  entries: Array<{ presetId: string; vector: number[] }> = [
    { presetId: "natural-short", vector: [1, 0, 0] },
    { presetId: "soft-bob", vector: [0, 1, 0] },
    { presetId: "romance-long", vector: [-1, 0, 0] },
  ],
): StudioVrmAvatarReferenceCatalogue {
  return {
    version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: "avatar-forge-render-v1",
    entries: entries.map(({ presetId, vector }) => ({
      presetId,
      embedding: { headIndex: 0, headName: "feature", floatEmbedding: vector },
    })),
  };
}

describe("Avatar reference preset recommendation core", () => {
  it("ranks with the official MediaPipe cosine utility and emits a model-bound receipt", () => {
    const similarity = vi.fn(ImageEmbedder.cosineSimilarity);
    const receipt = rankStudioVrmAvatarReferenceRecommendations({
      catalogue: catalogue(),
      queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0, 0] },
      queryEmbeddingSha256: QUERY_HASH,
      topK: 3,
      cosineSimilarity: similarity,
    });

    expect(similarity).toHaveBeenCalledTimes(3);
    expect(receipt.recommendations.map(({ presetId, similarity: score }) => [presetId, score]))
      .toEqual([
        ["natural-short", 1],
        ["soft-bob", 0],
        ["romance-long", -1],
      ]);
    expect(receipt).toMatchObject({
      providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
      modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
      modelRevision: "1",
      modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
      queryEmbeddingSha256: QUERY_HASH,
      catalogueRevision: "avatar-forge-render-v1",
    });
    expect(receipt.cataloguePresetIds).toEqual([
      "natural-short",
      "romance-long",
      "soft-bob",
    ]);
    expect(isStudioVrmAvatarReferenceRecommendationReceipt(receipt)).toBe(true);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.recommendations)).toBe(true);
  });

  it("breaks equal-score ties by preset id for deterministic top-K output", () => {
    const source = catalogue([
      { presetId: "soft-bob", vector: [1, 0] },
      { presetId: "natural-short", vector: [1, 0] },
      { presetId: "romance-long", vector: [1, 0] },
    ]);
    const run = () => rankStudioVrmAvatarReferenceRecommendations({
      catalogue: source,
      queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
      queryEmbeddingSha256: QUERY_HASH,
      topK: 2,
      cosineSimilarity: ImageEmbedder.cosineSimilarity,
    });

    expect(run().recommendations.map(({ presetId }) => presetId)).toEqual([
      "natural-short",
      "romance-long",
    ]);
    expect(run()).toEqual(run());
  });

  it("deep-clones and freezes admitted reference vectors", () => {
    const source = catalogue();
    const admitted = admitStudioVrmAvatarReferenceCatalogue(source);
    (source.entries[0]!.embedding.floatEmbedding as number[])[0] = 0.25;

    expect(admitted.entries[0]!.embedding.floatEmbedding[0]).toBe(1);
    expect(Object.isFrozen(admitted.entries)).toBe(true);
    expect(Object.isFrozen(admitted.entries[0]!.embedding.floatEmbedding)).toBe(true);
  });

  it.each([
    ["unknown preset", () => catalogue([{ presetId: "not-a-preset", vector: [1] }])],
    ["duplicate preset", () => catalogue([
      { presetId: "natural-short", vector: [1] },
      { presetId: "natural-short", vector: [1] },
    ])],
    ["wrong model id", () => ({ ...catalogue(), modelId: "other" })],
    ["wrong revision", () => ({ ...catalogue(), modelRevision: "latest" })],
    ["wrong model digest", () => ({ ...catalogue(), modelSha256: "b".repeat(64) })],
    ["mismatched dimensions", () => catalogue([
      { presetId: "natural-short", vector: [1, 0] },
      { presetId: "soft-bob", vector: [1] },
    ])],
    ["non-finite vector", () => catalogue([{ presetId: "natural-short", vector: [Number.NaN] }])],
  ])("rejects a %s catalogue fail-closed", (_label, create) => {
    expect(() => admitStudioVrmAvatarReferenceCatalogue(create())).toThrowError(
      expect.objectContaining<Partial<StudioVrmAvatarReferenceError>>({ code: "protocol" }),
    );
  });

  it("rejects query/catalogue head mismatch, invalid top-K and invalid similarity", () => {
    const base = {
      catalogue: catalogue(),
      queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0, 0] },
      queryEmbeddingSha256: QUERY_HASH,
      topK: 3,
      cosineSimilarity: ImageEmbedder.cosineSimilarity,
    };
    expect(() => rankStudioVrmAvatarReferenceRecommendations({
      ...base,
      queryEmbedding: { ...base.queryEmbedding, headName: "other" },
    })).toThrowError(StudioVrmAvatarReferenceError);
    expect(() => rankStudioVrmAvatarReferenceRecommendations({ ...base, topK: 6 }))
      .toThrowError(StudioVrmAvatarReferenceError);
    expect(() => rankStudioVrmAvatarReferenceRecommendations({
      ...base,
      cosineSimilarity: () => Number.NaN,
    })).toThrowError(StudioVrmAvatarReferenceError);
  });

  it("rejects a receipt when any provider authority field or rank is altered", () => {
    const receipt = rankStudioVrmAvatarReferenceRecommendations({
      catalogue: catalogue(),
      queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0, 0] },
      queryEmbeddingSha256: QUERY_HASH,
      topK: 3,
      cosineSimilarity: ImageEmbedder.cosineSimilarity,
    });
    expect(isStudioVrmAvatarReferenceRecommendationReceipt({
      ...receipt,
      modelSha256: "b".repeat(64),
    })).toBe(false);
    expect(isStudioVrmAvatarReferenceRecommendationReceipt({
      ...receipt,
      recommendations: [{ ...receipt.recommendations[0], rank: 2 }],
    })).toBe(false);
    expect(isStudioVrmAvatarReferenceRecommendationReceipt({
      ...receipt,
      cataloguePresetIds: [...receipt.cataloguePresetIds].reverse(),
    })).toBe(false);
    expect(isStudioVrmAvatarReferenceRecommendationReceipt({
      ...receipt,
      recommendations: [...receipt.recommendations].reverse().map((item, index) => ({
        ...item,
        rank: index + 1,
      })),
    })).toBe(false);
  });
});
