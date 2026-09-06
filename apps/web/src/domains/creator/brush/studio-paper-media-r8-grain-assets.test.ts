/**
 * F1 — W7 종이 프리셋 R8 타일 bake·등록 계약.
 *
 * 고정하는 계약:
 * 1. 결정성 라운드트립: 같은 프리셋은 항상 같은 바이트·같은 해시이고, 해시는 실제 바이트를
 *    가리키며, 인코딩 PNG 는 다시 디코드하면 정확히 baked R8 바이트가 나온다.
 * 2. 질감 하한: 판화지(깊은 이빨) 타일은 살아 있는 분산을 갖고, 켄트지(미세 이빨)보다
 *    뚜렷이 거칠다. 반복 경계는 내부 그레이디언트 수준으로 이어진다(seamless).
 * 3. 하이드레이션: 검증된 R8 레지스트리 규약 그대로 등록되고 샘플러가 열린다.
 * 4. 무배선: import 부작용으로 공유 레지스트리에 아무것도 등록하지 않는다(F1 계약).
 */

import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { StudioBrushR8GrainRegistry } from "./studio-brush-r8-grain-runtime";
import { STUDIO_PAPER_PRESET_IDS_V1 } from "./studio-paper-media-profile-v1";
import {
  bakeStudioPaperMediaR8GrainTileV1,
  encodeStudioPaperMediaR8PngV1,
  registerStudioPaperMediaR8GrainPresetTilesV1,
  STUDIO_PAPER_MEDIA_R8_ASSET_ID_PREFIX_V1,
  STUDIO_PAPER_MEDIA_R8_TILE_SIZE_V1,
} from "./studio-paper-media-r8-grain-assets";

const SIZE = STUDIO_PAPER_MEDIA_R8_TILE_SIZE_V1;

function normalizedTile(bytes: Uint8Array): number[] {
  return [...bytes].map((value) => value / 255);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function variance(values: readonly number[]): number {
  const center = mean(values);
  return mean(values.map((value) => (value - center) ** 2));
}

describe("F1 paper media R8 tile bake", () => {
  it("bakes deterministic tiles whose hashes bind the exact bytes (roundtrip)", () => {
    const first = bakeStudioPaperMediaR8GrainTileV1("printmaking");
    const second = bakeStudioPaperMediaR8GrainTileV1("printmaking");
    expect(second.source).toEqual(first.source);
    expect([...second.decodedBytes]).toEqual([...first.decodedBytes]);
    expect([...second.encodedBytes]).toEqual([...first.encodedBytes]);
    // 사본 계약: 호출마다 새 버퍼라 소비자가 바이트를 가져가도 캐시가 오염되지 않는다.
    expect(second.decodedBytes).not.toBe(first.decodedBytes);

    expect(first.decodedBytes.length).toBe(SIZE * SIZE);
    expect(first.source.asset.assetId).toBe(
      `${STUDIO_PAPER_MEDIA_R8_ASSET_ID_PREFIX_V1}.printmaking.${SIZE}`,
    );
    expect(first.source.asset.width).toBe(SIZE);
    expect(first.source.asset.height).toBe(SIZE);
    expect(first.source.asset.byteLength).toBe(first.encodedBytes.length);
    expect(first.source.asset.decodedSha256).toBe(
      `sha256:${sha256HexPortable(first.decodedBytes)}`,
    );
    expect(first.source.asset.encodedSha256).toBe(
      `sha256:${sha256HexPortable(first.encodedBytes)}`,
    );
  });

  it("encodes a real grayscale PNG that inflates back to the exact R8 bytes", () => {
    const baked = bakeStudioPaperMediaR8GrainTileV1("watercolor-rough");
    const png = baked.encodedBytes;
    // PNG 시그니처 + IHDR(256×256, bit depth 8, grayscale) + IEND 구조.
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe("IHDR");
    const width = (png[16]! << 24) | (png[17]! << 16) | (png[18]! << 8) | png[19]!;
    const height = (png[20]! << 24) | (png[21]! << 16) | (png[22]! << 8) | png[23]!;
    expect(width).toBe(SIZE);
    expect(height).toBe(SIZE);
    expect(png[24]).toBe(8); // bit depth
    expect(png[25]).toBe(0); // color type: grayscale
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe("IEND");

    // IDAT(zlib) 라운드트립 — 필터 0 스캔라인을 벗기면 정확히 baked 바이트다.
    const idatLength =
      (png[33]! << 24) | (png[34]! << 16) | (png[35]! << 8) | png[36]!;
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe("IDAT");
    const idat = png.subarray(41, 41 + idatLength);
    const raw = inflateSync(idat);
    expect(raw.length).toBe(SIZE * (SIZE + 1));
    const unfiltered = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y += 1) {
      expect(raw[y * (SIZE + 1)]).toBe(0); // filter type None
      unfiltered.set(raw.subarray(y * (SIZE + 1) + 1, (y + 1) * (SIZE + 1)), y * SIZE);
    }
    expect([...unfiltered]).toEqual([...baked.decodedBytes]);
  });

  it("rejects dimension/byte mismatches in the encoder instead of emitting corrupt PNGs", () => {
    expect(() => encodeStudioPaperMediaR8PngV1(4, 4, new Uint8Array(15))).toThrow();
    expect(() => encodeStudioPaperMediaR8PngV1(0, 4, new Uint8Array(0))).toThrow();
  });

  it("keeps printmaking tooth alive, coarser than kent, and inside honest bounds", () => {
    const printmaking = normalizedTile(
      bakeStudioPaperMediaR8GrainTileV1("printmaking").decodedBytes,
    );
    const kent = normalizedTile(bakeStudioPaperMediaR8GrainTileV1("kent").decodedBytes);
    // 대비: 균일 타일(분산≈0)은 이빨을 렌더할 수 없다 — 판화지는 깊고 켄트지는 미세하다.
    expect(variance(printmaking)).toBeGreaterThan(0.01);
    expect(variance(kent)).toBeGreaterThan(0.000_05);
    expect(variance(printmaking)).toBeGreaterThan(variance(kent) * 4);
    // 평균 높이는 중립대(0.5) 근방 — 타일이 전체적으로 밝거나 어둡게 치우치면 침착이 왜곡된다.
    expect(mean(printmaking)).toBeGreaterThan(0.3);
    expect(mean(printmaking)).toBeLessThan(0.7);
    // 동적 범위: 봉우리와 골이 실제로 존재한다.
    expect(Math.min(...printmaking)).toBeLessThan(0.2);
    expect(Math.max(...printmaking)).toBeGreaterThan(0.8);
  });

  it("ties the repeat boundary to interior-gradient scale (seamless torus blend)", () => {
    const bytes = bakeStudioPaperMediaR8GrainTileV1("printmaking").decodedBytes;
    const at = (x: number, y: number): number => bytes[y * SIZE + x]! / 255;
    let seamSum = 0;
    let interiorSum = 0;
    for (let y = 0; y < SIZE; y += 1) {
      // 가로 반복 경계(마지막 열 → 첫 열) vs 타일 중앙의 이웃 열.
      seamSum += Math.abs(at(SIZE - 1, y) - at(0, y));
      interiorSum += Math.abs(at(SIZE / 2, y) - at(SIZE / 2 - 1, y));
    }
    for (let x = 0; x < SIZE; x += 1) {
      seamSum += Math.abs(at(x, SIZE - 1) - at(x, 0));
      interiorSum += Math.abs(at(x, SIZE / 2) - at(x, SIZE / 2 - 1));
    }
    const seamMean = seamSum / (SIZE * 2);
    const interiorMean = interiorSum / (SIZE * 2);
    expect(interiorMean).toBeGreaterThan(0); // 내부에 결이 있어야 비교가 유효하다
    expect(seamMean).toBeLessThanOrEqual(interiorMean * 2.5);
  });
});

describe("F1 paper media R8 registration", () => {
  it("does not register anything as an import side effect (no default wiring)", () => {
    const registry = new StudioBrushR8GrainRegistry();
    const baked = bakeStudioPaperMediaR8GrainTileV1("newsprint");
    expect(registry.resolve(baked.source)).toBeNull();
  });

  it("hydrates all six W7 sheets through the verified R8 registry contract", () => {
    const registry = new StudioBrushR8GrainRegistry();
    const registrations = registerStudioPaperMediaR8GrainPresetTilesV1(registry);
    expect(registrations.map(({ presetId }) => presetId)).toEqual([
      ...STUDIO_PAPER_PRESET_IDS_V1,
    ]);
    for (const registration of registrations) {
      expect(registration.result.status, registration.presetId).toBe("ready");
      if (registration.result.status !== "ready") continue;
      expect(registration.result.receipt.decodedByteLength).toBe(SIZE * SIZE);
      expect(registration.result.receipt.decodedSha256).toBe(
        registration.source.asset.decodedSha256,
      );
      const sampler = registry.resolve(registration.source);
      expect(sampler, registration.presetId).not.toBeNull();
      // 샘플러 계약: 배율은 [0,1] 이고 위치마다 결이 살아 있다.
      const samples = [0, 1, 2, 3, 4].map((step) => sampler!.sampleAlphaMultiplierAt({
        x: step * 37.5,
        y: step * 21.25,
        strokeOriginX: 0,
        strokeOriginY: 0,
        strokeSeed: 7,
        space: "canvas-fixed",
        scale: SIZE,
        amount: 1,
        contrast: 0,
        seed: 7,
      }));
      for (const sample of samples) {
        expect(sample).toBeGreaterThanOrEqual(0);
        expect(sample).toBeLessThanOrEqual(1);
      }
      expect(new Set(samples.map((value) => value.toFixed(5))).size).toBeGreaterThan(1);
    }
    // 재등록은 캐시 히트다(중복 엔트리·재해시 없음).
    const again = registerStudioPaperMediaR8GrainPresetTilesV1(registry);
    for (const registration of again) {
      expect(registration.result.status).toBe("ready");
      if (registration.result.status === "ready") {
        expect(registration.result.receipt.cached).toBe(true);
      }
    }
    expect(registry.stats().entries).toBe(STUDIO_PAPER_PRESET_IDS_V1.length);
  });
});
