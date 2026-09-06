import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
  rankStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceCatalogue,
} from "./studio-vrm-avatar-reference-recommendation";
import {
  isStudioVrmAvatarReferenceWorkerRequest,
  isStudioVrmAvatarReferenceWorkerResponse,
  studioVrmAvatarReferenceRequestTransfers,
  type StudioVrmAvatarReferenceWorkerRequest,
} from "./studio-vrm-avatar-reference-worker-protocol";

function catalogue(): StudioVrmAvatarReferenceCatalogue {
  return {
    version: 1,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: "catalogue-v1",
    entries: [{
      presetId: "natural-short",
      embedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
    }],
  };
}

function bitmap(width = 512, height = 512): ImageBitmap {
  return { width, height, close() {} } as ImageBitmap;
}

describe("Avatar reference ImageEmbedder Worker protocol", () => {
  it("admits a bounded bitmap/catalogue request and transfers only its bitmap", () => {
    const image = bitmap();
    const request: StudioVrmAvatarReferenceWorkerRequest = {
      version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
      kind: "recommend",
      requestId: 1,
      generationId: 2,
      bitmap: image,
      catalogue: catalogue(),
      topK: 3,
    };

    expect(isStudioVrmAvatarReferenceWorkerRequest(request)).toBe(true);
    expect(studioVrmAvatarReferenceRequestTransfers(request)).toEqual([image]);
    expect(studioVrmAvatarReferenceRequestTransfers({
      version: 1,
      kind: "cancel",
      requestId: 1,
      generationId: 2,
    })).toEqual([]);
  });

  it.each([
    ["oversized edge", bitmap(1_025, 100)],
    ["oversized pixels", bitmap(1_024, 1_025)],
    ["zero edge", bitmap(0, 100)],
  ])("rejects a %s before inference", (_label, image) => {
    expect(isStudioVrmAvatarReferenceWorkerRequest({
      version: 1,
      kind: "recommend",
      requestId: 1,
      generationId: 1,
      bitmap: image,
      catalogue: catalogue(),
      topK: 3,
    })).toBe(false);
  });

  it("rejects a forged catalogue authority and out-of-budget top-K", () => {
    const request = {
      version: 1,
      kind: "recommend",
      requestId: 1,
      generationId: 1,
      bitmap: bitmap(),
      catalogue: catalogue(),
      topK: 3,
    };
    expect(isStudioVrmAvatarReferenceWorkerRequest({
      ...request,
      catalogue: { ...request.catalogue, modelSha256: "f".repeat(64) },
    })).toBe(false);
    expect(isStudioVrmAvatarReferenceWorkerRequest({ ...request, topK: 6 })).toBe(false);
  });

  it("admits only receipts with exact request and model-bound result structure", () => {
    const receipt = rankStudioVrmAvatarReferenceRecommendations({
      catalogue: catalogue(),
      queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
      queryEmbeddingSha256: "a".repeat(64),
      topK: 1,
      cosineSimilarity: () => 1,
    });
    const response = {
      version: 1,
      kind: "result",
      requestId: 1,
      generationId: 1,
      receipt,
    };
    expect(isStudioVrmAvatarReferenceWorkerResponse(response)).toBe(true);
    expect(isStudioVrmAvatarReferenceWorkerResponse({
      ...response,
      receipt: { ...receipt, modelId: "forged" },
    })).toBe(false);
    expect(isStudioVrmAvatarReferenceWorkerResponse({
      version: 1,
      kind: "progress",
      requestId: 1,
      generationId: 1,
      stage: "embedding",
      progress: 1.1,
    })).toBe(false);
  });
});
