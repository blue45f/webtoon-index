import { describe, expect, it } from "vitest";

import {
  STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS,
  normalizeStudioBrushR8GrainAssetReference,
  normalizeStudioBrushR8TextureGrainSource,
  serializeStudioBrushR8TextureGrainSourceCanonical,
} from "./studio-brush-r8-grain-asset-contract";

const ENCODED_HASH = "A".repeat(64);
const DECODED_HASH = "b".repeat(64);

function sourceFixture() {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: "paper.cold-press.v1",
      encodedSha256: ENCODED_HASH,
      decodedSha256: `sha256:${DECODED_HASH}`,
      byteLength: 3_417,
      mediaType: "image/png",
      width: 64,
      height: 32,
      channel: "luminance",
      encoding: "r8-unorm",
    },
  };
}

describe("studio brush R8 grain asset contract", () => {
  it("canonicalizes both encoded and decoded identities without retaining binary data", () => {
    const normalized = normalizeStudioBrushR8TextureGrainSource(sourceFixture());
    expect(normalized).toEqual({
      kind: "r8-texture-v1",
      asset: {
        assetId: "paper.cold-press.v1",
        encodedSha256: `sha256:${ENCODED_HASH.toLowerCase()}`,
        decodedSha256: `sha256:${DECODED_HASH}`,
        byteLength: 3_417,
        mediaType: "image/png",
        width: 64,
        height: 32,
        channel: "luminance",
        encoding: "r8-unorm",
      },
    });
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(Object.isFrozen(normalized?.asset)).toBe(true);
    expect(JSON.stringify(normalized)).not.toMatch(/bytes|data:|blob:|https?:/u);
  });

  it("serializes in one stable canonical order", () => {
    const expected = `{"kind":"r8-texture-v1","asset":{"assetId":"paper.cold-press.v1","encodedSha256":"sha256:${ENCODED_HASH.toLowerCase()}","decodedSha256":"sha256:${DECODED_HASH}","byteLength":3417,"mediaType":"image/png","width":64,"height":32,"channel":"luminance","encoding":"r8-unorm"}}`;
    const first = serializeStudioBrushR8TextureGrainSourceCanonical(sourceFixture());
    const replay = serializeStudioBrushR8TextureGrainSourceCanonical(
      first ? JSON.parse(first) : null,
    );
    expect(first).toBe(expected);
    expect(replay).toBe(expected);
  });

  it.each([
    ["unknown source kind", { ...sourceFixture(), kind: "r8-texture-v2" }],
    ["unknown source field", { ...sourceFixture(), fallbackUrl: "https://example.invalid" }],
    ["binary source field", { ...sourceFixture(), bytes: new Uint8Array([1, 2, 3]) }],
    ["unknown asset field", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, data: "data:image/png;base64,AA==" },
    }],
    ["invalid encoded hash", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, encodedSha256: "sha256:not-a-hash" },
    }],
    ["invalid decoded hash", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, decodedSha256: "0".repeat(63) },
    }],
    ["unsupported media type", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, mediaType: "image/jpeg" },
    }],
    ["unsupported channel", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, channel: "rgba" },
    }],
    ["unsupported encoding", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, encoding: "rgba8-unorm" },
    }],
    ["unsafe asset id", {
      ...sourceFixture(),
      asset: { ...sourceFixture().asset, assetId: "data:image/png;base64,AA==" },
    }],
    ["encoded byte budget", {
      ...sourceFixture(),
      asset: {
        ...sourceFixture().asset,
        byteLength: STUDIO_BRUSH_R8_GRAIN_ASSET_LIMITS.maxEncodedByteLength + 1,
      },
    }],
    ["decoded byte budget", {
      ...sourceFixture(),
      asset: {
        ...sourceFixture().asset,
        width: 16_384,
        height: 16_384,
      },
    }],
  ])("fails closed for %s", (_label, candidate) => {
    expect(normalizeStudioBrushR8TextureGrainSource(candidate)).toBeNull();
    expect(serializeStudioBrushR8TextureGrainSourceCanonical(candidate)).toBeNull();
  });

  it("never evaluates accessor-backed poison", () => {
    let reads = 0;
    const source = sourceFixture();
    Object.defineProperty(source, "asset", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(normalizeStudioBrushR8TextureGrainSource(source)).toBeNull();
    expect(reads).toBe(0);
  });

  it("rejects non-plain and inherited records", () => {
    const inherited = Object.create(sourceFixture());
    const pollutedAsset = Object.assign(
      Object.create({ bytes: new Uint8Array([1]) }),
      sourceFixture().asset,
    );
    expect(normalizeStudioBrushR8TextureGrainSource(inherited)).toBeNull();
    expect(normalizeStudioBrushR8GrainAssetReference(pollutedAsset)).toBeNull();
  });
});
