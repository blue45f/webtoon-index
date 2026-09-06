import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { ImageEmbedder } from "@mediapipe/tasks-vision";
import { describe, expect, it } from "vitest";

import {
  AVATAR_FORGE_PRESETS,
  applyAvatarForgeBodyPreset,
  createAvatarForgeState,
} from "./studio-vrm-avatar-forge";
import {
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH,
  STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY,
  STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY,
  admitStudioVrmAvatarReferenceCatalogueEnvelope,
  resolveStudioVrmAvatarReferenceAppearanceState,
  studioVrmAvatarReferenceEmbeddingSha256,
  studioVrmAvatarReferencePresetStateSha256,
} from "./studio-vrm-avatar-reference-product";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
  STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
  rankStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceCatalogue,
} from "./studio-vrm-avatar-reference-recommendation";

function catalogue(presetIds = ["natural-short", "soft-bob"]): StudioVrmAvatarReferenceCatalogue {
  return {
    version: STUDIO_VRM_AVATAR_REFERENCE_PROTOCOL_VERSION,
    providerId: STUDIO_VRM_AVATAR_REFERENCE_PROVIDER_ID,
    modelId: STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
    modelRevision: STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
    modelSha256: STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
    catalogueRevision: "avatar-forge-render-v1",
    entries: presetIds.map((presetId, index) => ({
      presetId,
      embedding: {
        headIndex: 0,
        headName: "feature",
        floatEmbedding: index === 0 ? [1, 0] : [0, 1],
      },
    })),
  };
}

function selection(source = catalogue()) {
  const receipt = rankStudioVrmAvatarReferenceRecommendations({
    catalogue: source,
    queryEmbedding: { headIndex: 0, headName: "feature", floatEmbedding: [1, 0] },
    queryEmbeddingSha256: "a".repeat(64),
    topK: 2,
    cosineSimilarity: ImageEmbedder.cosineSimilarity,
  });
  return {
    presetId: "natural-short",
    state: createAvatarForgeState("natural-short"),
    receipt,
  };
}

function completeEnvelope() {
  const presetIds = AVATAR_FORGE_PRESETS.map(({ id }) => id).sort((left, right) =>
    left.localeCompare(right, "en")
  );
  const dimensions = STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.dimensions;
  const completeCatalogue: StudioVrmAvatarReferenceCatalogue = {
    ...catalogue(presetIds.slice(0, 2)),
    entries: presetIds.map((presetId, index) => ({
      presetId,
      embedding: {
        headIndex: STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.headIndex,
        headName: STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.headName,
        floatEmbedding: Array.from(
          { length: dimensions },
          (_unused, componentIndex) => componentIndex === index ? 1 : 0,
        ),
      },
    })),
  };
  return {
    authority: { ...STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY },
    renders: presetIds.map((presetId, index) => ({
      presetId,
      presetStateSha256: studioVrmAvatarReferencePresetStateSha256(presetId)!,
      referenceImageSha256: (index + 1).toString(16).padStart(64, "0"),
      referenceImageByteLength: 512 * 512 * 4,
      embeddingSha256: studioVrmAvatarReferenceEmbeddingSha256(
        completeCatalogue.entries[index]!.embedding,
      ),
    })),
    catalogue: completeCatalogue,
  };
}

describe("Avatar reference recommendation product authority", () => {
  it("pins the retired canonical VRM by exact bytes without shipping it", () => {
    expect(STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.sourceUrl)
      .toBe("/vrm/TS_Minseo_Campus.vrm");
    expect(STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.sourceByteLength).toBe(1_325_288);
    expect(STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.sourceSha256).toBe(
      "903601a5ffa71383188a3885509653283fb842e9a3f0025dca222b1c9b78ebea",
    );
    // Retired with the procedural pack; the committed artifact below is the runtime authority.
    expect(existsSync(new URL("../../../../public/vrm/TS_Minseo_Campus.vrm", import.meta.url)))
      .toBe(false);
    expect(Object.isFrozen(STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.camera))
      .toBe(true);
    expect(Object.isFrozen(
      STUDIO_VRM_AVATAR_REFERENCE_CANONICAL_RENDER_AUTHORITY.softwareGpu.swiftShaderLibraries,
    )).toBe(true);
  });

  it("pins and admits the real public catalogue artifact", () => {
    const bytes = readFileSync(new URL("../../../../public/catalog/studio-vrm-avatar-reference-catalogue-v1.json",
      import.meta.url,
    ));
    expect(bytes.byteLength).toBe(STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_BYTE_LENGTH);
    expect(createHash("sha256").update(bytes).digest("hex"))
      .toBe(STUDIO_VRM_AVATAR_REFERENCE_CATALOGUE_SHA256);

    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    expect(decoded.endsWith("\n")).toBe(true);
    const admitted = admitStudioVrmAvatarReferenceCatalogueEnvelope(JSON.parse(decoded));
    expect(admitted).not.toBeNull();
    expect(admitted?.catalogue.catalogueRevision)
      .toBe("avatar-forge-reference-v1-1f8584c7b07e687d");
    expect(admitted?.catalogue.entries).toHaveLength(21);
    expect(admitted?.catalogue.entries[0]?.embedding).toMatchObject({
      headIndex: STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.headIndex,
      headName: STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.headName,
    });
    expect(admitted?.catalogue.entries[0]?.embedding.floatEmbedding)
      .toHaveLength(STUDIO_VRM_AVATAR_REFERENCE_EMBEDDING_AUTHORITY.dimensions);
  });

  it("admits only a complete all-preset render envelope tied to exact state and image hashes", () => {
    const source = completeEnvelope();
    const admitted = admitStudioVrmAvatarReferenceCatalogueEnvelope(source);
    expect(admitted?.renders).toHaveLength(AVATAR_FORGE_PRESETS.length);
    expect(admitted?.catalogue.entries).toHaveLength(AVATAR_FORGE_PRESETS.length);
    expect(Object.isFrozen(admitted?.renders)).toBe(true);

    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      authority: Object.fromEntries(Object.entries(source.authority).reverse()),
    })).not.toBeNull();

    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      renders: source.renders.slice(1),
    })).toBeNull();
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      authority: { ...source.authority, rendererRevision: "latest" },
    })).toBeNull();
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      renders: source.renders.map((entry, index) => index === 0
        ? { ...entry, presetStateSha256: "f".repeat(64) }
        : entry),
    })).toBeNull();

    for (const driftedEmbedding of [
      { ...source.catalogue.entries[0]!.embedding, headName: "other" },
      {
        ...source.catalogue.entries[0]!.embedding,
        floatEmbedding: source.catalogue.entries[0]!.embedding.floatEmbedding.slice(1),
      },
    ]) {
      expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
        ...source,
        renders: source.renders.map((entry, index) => index === 0
          ? {
              ...entry,
              embeddingSha256: studioVrmAvatarReferenceEmbeddingSha256(driftedEmbedding),
            }
          : entry),
        catalogue: {
          ...source.catalogue,
          entries: source.catalogue.entries.map((entry, index) => index === 0
            ? { ...entry, embedding: driftedEmbedding }
            : entry),
        },
      })).toBeNull();
    }
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      renders: [...source.renders].reverse(),
    })).toBeNull();
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      renders: source.renders.map((entry, index) => index === 0
        ? { ...entry, referenceImageByteLength: 1 }
        : entry),
    })).toBeNull();
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      renders: source.renders.map((entry, index) => index === 0
        ? { ...entry, embeddingSha256: "f".repeat(64) }
        : entry),
    })).toBeNull();
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...source,
      catalogue: {
        ...source.catalogue,
        entries: source.catalogue.entries.map((entry, index) => index === 0
          ? {
              ...entry,
              embedding: {
                ...entry.embedding,
                floatEmbedding: entry.embedding.floatEmbedding.map(() => 0),
              },
            }
          : entry),
      },
    })).toBeNull();

    const collinear = completeEnvelope();
    const scaledEmbedding = {
      ...collinear.catalogue.entries[1]!.embedding,
      floatEmbedding: collinear.catalogue.entries[0]!.embedding.floatEmbedding.map(
        (component) => component * 2,
      ),
    };
    expect(admitStudioVrmAvatarReferenceCatalogueEnvelope({
      ...collinear,
      renders: collinear.renders.map((entry, index) => index === 1
        ? {
            ...entry,
            embeddingSha256: studioVrmAvatarReferenceEmbeddingSha256(scaledEmbedding),
          }
        : entry),
      catalogue: {
        ...collinear.catalogue,
        entries: collinear.catalogue.entries.map((entry, index) => index === 1
          ? { ...entry, embedding: scaledEmbedding }
          : entry),
      },
    })).toBeNull();
  });

  it("applies only receipt-bound preset appearance while preserving body and proportions", () => {
    const source = catalogue();
    const current = applyAvatarForgeBodyPreset(createAvatarForgeState("wave-diva"), "hero");
    const next = resolveStudioVrmAvatarReferenceAppearanceState({
      current,
      selection: selection(source),
      catalogue: source,
    });

    expect(next).not.toBeNull();
    expect(next?.hair).toEqual(createAvatarForgeState("natural-short").hair);
    expect(next?.face).toEqual(createAvatarForgeState("natural-short").face);
    expect(next?.body).toEqual(current.body);
    expect(next?.bodyPresetId).toBe(current.bodyPresetId);
    expect(next?.proportions).toEqual(current.proportions);
    expect(next?.presetId).toBeUndefined();
  });

  it("rejects a stale receipt, forged preset state, or unavailable catalogue", () => {
    const source = catalogue();
    const valid = selection(source);
    const current = createAvatarForgeState("wave-diva");
    expect(resolveStudioVrmAvatarReferenceAppearanceState({
      current,
      catalogue: null,
      selection: valid,
    })).toBeNull();
    expect(resolveStudioVrmAvatarReferenceAppearanceState({
      current,
      catalogue: source,
      selection: {
        ...valid,
        state: createAvatarForgeState("soft-bob"),
      },
    })).toBeNull();
    expect(resolveStudioVrmAvatarReferenceAppearanceState({
      current,
      catalogue: source,
      selection: {
        ...valid,
        receipt: { ...valid.receipt, catalogueRevision: "stale" },
      },
    })).toBeNull();
  });
});
