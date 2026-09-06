import { createHash } from "node:crypto";

import { Image, encodePng } from "image-js";
import { describe, expect, it, vi } from "vitest";

import {
  assertStudioR8GrainAdmissionContents,
  type StudioR8GrainDecodedPng,
} from "./studio-r8-grain-admission";

import type { StudioWorkAssetContent } from "./studio-work-asset.repository";
import type { StudioBrushR8TextureGrainSource } from "../../../../web/src/shared/lib/studio-brush-r8-grain-asset-contract";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function rgbaPng(
  width: number,
  height: number,
  values: readonly number[]
): Uint8Array {
  return encodePng(new Image(width, height, {
    colorModel: "RGBA",
    bitDepth: 8,
    data: Uint8Array.from(values),
  }));
}

function sourceFor(
  assetId: string,
  encoded: Uint8Array,
  decoded: Uint8Array,
  width: number,
  height: number,
  channel: "alpha" | "luminance"
): StudioBrushR8TextureGrainSource {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId,
      encodedSha256: `sha256:${sha256(encoded)}`,
      decodedSha256: `sha256:${sha256(decoded)}`,
      byteLength: encoded.byteLength,
      mediaType: "image/png",
      width,
      height,
      channel,
      encoding: "r8-unorm",
    },
  };
}

function contentFor(
  source: StudioBrushR8TextureGrainSource,
  encoded: Uint8Array
): StudioWorkAssetContent {
  return {
    manifest: {
      version: 1,
      assetId: source.asset.assetId,
      elementType: "image",
      mimeType: "image/png",
      byteSize: encoded.byteLength,
      sha256: sha256(encoded),
      intrinsicImage: {
        width: source.asset.width,
        height: source.asset.height,
        decodedRgbaBytes: source.asset.width * source.asset.height * 4,
      },
      descriptor: {
        version: 1,
        element: {
          id: source.asset.assetId,
          type: "image",
          x: 0,
          y: 0,
          width: source.asset.width,
          height: source.asset.height,
          rotation: 0,
        },
      },
      updatedAt: "2026-07-29T00:00:00.000Z",
    },
    payload: Uint8Array.from(encoded),
  };
}

describe("Studio R8 grain first-admission verification", () => {
  it("accepts real 8-bit alpha and fixed integer BT.709 luminance PNGs", async () => {
    const encoded = rgbaPng(2, 1, [
      255, 0, 0, 40,
      0, 255, 0, 230,
    ]);
    const alpha = Uint8Array.of(40, 230);
    const luminance = Uint8Array.of(
      (54 * 255 + 128) >> 8,
      (183 * 255 + 128) >> 8
    );
    const alphaSource = sourceFor("paper-alpha", encoded, alpha, 2, 1, "alpha");
    const luminanceSource = sourceFor(
      "paper-luminance",
      encoded,
      luminance,
      2,
      1,
      "luminance"
    );
    const alphaContent = contentFor(alphaSource, encoded);
    const luminanceContent = contentFor(luminanceSource, encoded);

    await expect(assertStudioR8GrainAdmissionContents([
      { source: alphaSource, content: alphaContent },
      { source: luminanceSource, content: luminanceContent },
    ])).resolves.toBeUndefined();

    expect([...alphaContent.payload]).toEqual(new Array(encoded.byteLength).fill(0));
    expect([...luminanceContent.payload]).toEqual(new Array(encoded.byteLength).fill(0));
  });

  it("fails before decode for malformed metadata or changed at-rest encoded bytes", async () => {
    const encoded = rgbaPng(1, 1, [20, 40, 60, 80]);
    const source = sourceFor("paper-encoded", encoded, Uint8Array.of(80), 1, 1, "alpha");
    const decoder = vi.fn();
    const wrongDimensions = contentFor(source, encoded);
    wrongDimensions.manifest.intrinsicImage!.width = 2;

    await expect(assertStudioR8GrainAdmissionContents(
      [{ source, content: wrongDimensions }],
      { decodePng: decoder }
    )).rejects.toThrow(/콘텐츠 계약/u);
    expect(decoder).not.toHaveBeenCalled();
    expect(wrongDimensions.payload.every((value) => value === 0)).toBe(true);

    const changedPayload = contentFor(source, encoded);
    changedPayload.payload[changedPayload.payload.length - 1] ^= 1;
    await expect(assertStudioR8GrainAdmissionContents(
      [{ source, content: changedPayload }],
      { decodePng: decoder }
    )).rejects.toThrow(/인코딩 해시/u);
    expect(decoder).not.toHaveBeenCalled();
    expect(changedPayload.payload.every((value) => value === 0)).toBe(true);
  });

  it("rejects missing alpha, non-8-bit pixels, and decoded hash mismatches fail closed", async () => {
    const encoded = Uint8Array.of(1, 2, 3);
    const source = sourceFor("paper-decode", encoded, Uint8Array.of(90), 1, 1, "alpha");
    const content = contentFor(source, encoded);
    const rgbData = Uint8Array.of(10, 20, 30);
    await expect(assertStudioR8GrainAdmissionContents(
      [{ source, content }],
      {
        decodePng: () => ({
          width: 1,
          height: 1,
          bitDepth: 8,
          colorModel: "RGB",
          components: 3,
          channels: 3,
          alpha: false,
          data: rgbData,
          getValueByIndex: (index, channel) => rgbData[index * 3 + channel]!,
        }),
      }
    )).rejects.toThrow(/알파 채널/u);
    expect([...rgbData]).toEqual([0, 0, 0]);
    expect(content.payload.every((value) => value === 0)).toBe(true);

    const sixteenBitContent = contentFor(source, encoded);
    await expect(assertStudioR8GrainAdmissionContents(
      [{ source, content: sixteenBitContent }],
      {
        decodePng: () => ({
          width: 1,
          height: 1,
          bitDepth: 16,
          colorModel: "RGBA",
          components: 3,
          channels: 4,
          alpha: true,
          getValueByIndex: () => 90,
        }),
      }
    )).rejects.toThrow(/비트 깊이/u);

    const wrongDimensionsContent = contentFor(source, encoded);
    await expect(assertStudioR8GrainAdmissionContents(
      [{ source, content: wrongDimensionsContent }],
      {
        decodePng: () => ({
          width: 2,
          height: 1,
          bitDepth: 8,
          colorModel: "RGBA",
          components: 3,
          channels: 4,
          alpha: true,
          getValueByIndex: () => 90,
        }),
      }
    )).rejects.toThrow(/고유 크기/u);

    const wrongHashSource = sourceFor(
      "paper-wrong-decoded",
      encoded,
      Uint8Array.of(91),
      1,
      1,
      "alpha"
    );
    const wrongHashContent = contentFor(wrongHashSource, encoded);
    await expect(assertStudioR8GrainAdmissionContents(
      [{ source: wrongHashSource, content: wrongHashContent }],
      {
        decodePng: () => ({
          width: 1,
          height: 1,
          bitDepth: 8,
          colorModel: "RGBA",
          components: 3,
          channels: 4,
          alpha: true,
          getValueByIndex: (_index, channel) => channel === 3 ? 90 : 0,
        }),
      }
    )).rejects.toThrow(/디코딩 결과 해시/u);
  });

  it("bounds aggregate work before decode and decodes admitted images serially", async () => {
    const encodedA = Uint8Array.of(1, 2);
    const encodedB = Uint8Array.of(3, 4);
    const decodedA = Uint8Array.of(10);
    const decodedB = Uint8Array.of(20);
    const sourceA = sourceFor("paper-a", encodedA, decodedA, 1, 1, "luminance");
    const sourceB = sourceFor("paper-b", encodedB, decodedB, 1, 1, "luminance");
    const overBudgetA = contentFor(sourceA, encodedA);
    const overBudgetB = contentFor(sourceB, encodedB);
    const decoder = vi.fn();

    await expect(assertStudioR8GrainAdmissionContents([
      { source: sourceA, content: overBudgetA },
      { source: sourceB, content: overBudgetB },
    ], {
      decodePng: decoder,
      maximumTotalEncodedBytes: 3,
    })).rejects.toThrow(/인코딩 바이트/u);
    expect(decoder).not.toHaveBeenCalled();

    const valuesByFirstByte = new Map([[1, 10], [3, 20]]);
    let active = 0;
    let maximumActive = 0;
    const serialDecoder = vi.fn(async (bytes: Uint8Array): Promise<StudioR8GrainDecodedPng> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      const value = valuesByFirstByte.get(bytes[0]!)!;
      active -= 1;
      return {
        width: 1,
        height: 1,
        bitDepth: 8,
        colorModel: "GREY",
        components: 1,
        channels: 1,
        alpha: false,
        getValueByIndex: () => value,
      };
    });
    await expect(assertStudioR8GrainAdmissionContents([
      { source: sourceA, content: contentFor(sourceA, encodedA) },
      { source: sourceB, content: contentFor(sourceB, encodedB) },
    ], {
      decodePng: serialDecoder,
    })).resolves.toBeUndefined();
    expect(serialDecoder).toHaveBeenCalledTimes(2);
    expect(maximumActive).toBe(1);
  });
});
