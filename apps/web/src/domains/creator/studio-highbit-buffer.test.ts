import { describe, expect, it } from "vitest";

import {
  STUDIO_HIGHBIT_PAGE_BUDGET,
  STUDIO_HIGHBIT_UINT16_MAX,
  createStudioHighBitSurface,
  decodeStudioHighBitStorageValue,
  encodeStudioHighBitStorageValue,
  estimateStudioHighBitSurfaceBytes,
  premultiplyStudioHighBitRgb,
  readStudioHighBitPixel,
  readStudioHighBitPremultiplied,
  recommendStudioHighBitStorage,
  roundStudioHighBitQuantizer,
  studioHighBitSurfaceFromBytes,
  studioHighBitSurfaceToBytes,
  unpremultiplyStudioHighBitRgb,
  writeStudioHighBitPixel,
  type StudioHighBitStorage,
} from "./studio-highbit-buffer";
import {
  convertStudioHighBitLinearGamut,
  type StudioHighBitRgb,
} from "./studio-highbit-colorspace";
import { studioHighBitByteToLinear } from "./studio-highbit-transfer";

describe("표면 생성과 메모리 예산", () => {
  it("4000×6000 원고 1장의 포맷별 메모리를 고정한다", () => {
    expect(STUDIO_HIGHBIT_PAGE_BUDGET.legacyRgba8Bytes / 1024 / 1024).toBeCloseTo(91.55, 2);
    expect(STUDIO_HIGHBIT_PAGE_BUDGET.uint16Bytes / 1024 / 1024).toBeCloseTo(183.11, 2);
    expect(STUDIO_HIGHBIT_PAGE_BUDGET.float32Bytes / 1024 / 1024).toBeCloseTo(366.21, 2);
    expect(STUDIO_HIGHBIT_PAGE_BUDGET.float32Bytes).toBe(STUDIO_HIGHBIT_PAGE_BUDGET.uint16Bytes * 2);
  });

  it("페이지 규모는 uint16, 타일 스크래치는 float32 를 추천한다", () => {
    const page = recommendStudioHighBitStorage({ width: 4000, height: 6000, role: "page" });
    expect(page.storage).toBe("uint16");
    expect(page.estimatedBytes).toBe(STUDIO_HIGHBIT_PAGE_BUDGET.uint16Bytes);

    const tile = recommendStudioHighBitStorage({ width: 256, height: 256, role: "dab-scratch" });
    expect(tile.storage).toBe("float32");
    // 256×256 float32 타일 = 정확히 1 MiB.
    expect(tile.estimatedBytes).toBe(1024 * 1024);
  });

  it("잘못된 크기를 거부한다", () => {
    expect(() => createStudioHighBitSurface({ width: 0, height: 4 })).toThrow();
    expect(() => createStudioHighBitSurface({ width: 4.5, height: 4 })).toThrow();
  });

  it("저장 배열 타입과 길이가 포맷을 따른다", () => {
    const uint16 = createStudioHighBitSurface({ width: 3, height: 2 });
    expect(uint16.data).toBeInstanceOf(Uint16Array);
    expect(uint16.data.length).toBe(24);
    expect(estimateStudioHighBitSurfaceBytes({ width: 3, height: 2, storage: "uint16" })).toBe(48);

    const float32 = createStudioHighBitSurface({ width: 3, height: 2, storage: "float32" });
    expect(float32.data).toBeInstanceOf(Float32Array);
    expect(estimateStudioHighBitSurfaceBytes({ width: 3, height: 2, storage: "float32" })).toBe(96);
  });
});

describe("프리멀티플라이 정확성", () => {
  it("float 도메인 왕복이 사실상 무손실이다", () => {
    let worst = 0;
    for (let colorStep = 0; colorStep <= 64; colorStep += 1) {
      const color = colorStep / 64;
      for (let alphaStep = 1; alphaStep <= 64; alphaStep += 1) {
        const alpha = alphaStep / 64;
        const back = unpremultiplyStudioHighBitRgb(
          premultiplyStudioHighBitRgb([color, color, color], alpha),
          alpha
        );
        worst = Math.max(worst, Math.abs(back[0] - color));
      }
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it("알파 0 은 색을 0 으로 만든다(NaN·유령색 금지)", () => {
    expect(premultiplyStudioHighBitRgb([1, 0.5, 0.25], 0)).toEqual([0, 0, 0]);
    expect(unpremultiplyStudioHighBitRgb([0.4, 0.4, 0.4], 0)).toEqual([0, 0, 0]);
    expect(unpremultiplyStudioHighBitRgb([0.4, 0.4, 0.4], Number.NaN)).toEqual([0, 0, 0]);
  });

  /**
   * 회귀 방지의 핵심 수치. 8비트 프리멀티플라이드 저장은 알파가 낮을수록 색을 통째로 잃는다
   * (studio-webgpu-readback.ts 의 언프리멀티플라이 경로가 정확히 이 형태다).
   */
  it("낮은 알파에서 8비트 프리멀티는 붕괴하지만 uint16 은 0.5코드 안에 든다", () => {
    const alphas = [1, 2, 4, 8].map((code) => code / 255);
    const measure = (roundTrip: (color: number, alpha: number) => number): number => {
      let worst = 0;
      for (const alpha of alphas) {
        for (let code = 0; code <= 255; code += 1) {
          const color = code / 255;
          worst = Math.max(worst, Math.abs(roundTrip(color, alpha) - color) * 255);
        }
      }
      return worst;
    };

    const legacy8 = measure((color, alpha) => {
      const stored = Math.round(color * alpha * 255);
      return stored === 0 ? 0 : Math.min(255, Math.round((stored * 255) / (alpha * 255))) / 255;
    });
    const uint16 = measure((color, alpha) => {
      const stored = Math.round(color * alpha * STUDIO_HIGHBIT_UINT16_MAX);
      return Math.min(1, stored / STUDIO_HIGHBIT_UINT16_MAX / alpha);
    });
    const float32 = measure((color, alpha) => Math.fround(Math.fround(color * alpha) / alpha));

    // 8비트: 알파 1/255 에서 색 오차가 100코드를 넘는다(실질적으로 색 정보 소멸).
    expect(legacy8).toBeGreaterThan(100);
    // uint16: 최악도 0.5 코드 미만 — 256배 이상 개선.
    expect(uint16).toBeLessThan(0.5);
    expect(legacy8 / uint16).toBeGreaterThan(200);
    expect(float32).toBeLessThan(0.001);
  });
});

describe("저장 인코딩", () => {
  it("uint16 은 정수로, float32 는 실수로 저장한다", () => {
    expect(encodeStudioHighBitStorageValue(1, "uint16")).toBe(STUDIO_HIGHBIT_UINT16_MAX);
    expect(encodeStudioHighBitStorageValue(0.5, "uint16")).toBe(32768);
    expect(encodeStudioHighBitStorageValue(0.5, "float32")).toBe(0.5);
    expect(decodeStudioHighBitStorageValue(32768, "uint16")).toBeCloseTo(0.5, 4);
  });

  it("범위 밖과 비유한 값을 클램프한다", () => {
    const storages: StudioHighBitStorage[] = ["uint16", "float32"];
    for (const storage of storages) {
      expect(decodeStudioHighBitStorageValue(encodeStudioHighBitStorageValue(-1, storage), storage)).toBe(0);
      expect(decodeStudioHighBitStorageValue(encodeStudioHighBitStorageValue(2, storage), storage)).toBe(1);
      expect(decodeStudioHighBitStorageValue(encodeStudioHighBitStorageValue(Number.NaN, storage), storage)).toBe(0);
    }
  });
});

describe("픽셀 접근", () => {
  it("스트레이트로 쓰고 스트레이트로 읽으면 값이 보존된다", () => {
    const surface = createStudioHighBitSurface({ width: 2, height: 2, storage: "float32" });
    writeStudioHighBitPixel(surface, 1, 1, [0.25, 0.5, 0.75, 0.5]);
    const read = readStudioHighBitPixel(surface, 1, 1);
    expect(read[0]).toBeCloseTo(0.25, 6);
    expect(read[1]).toBeCloseTo(0.5, 6);
    expect(read[2]).toBeCloseTo(0.75, 6);
    expect(read[3]).toBeCloseTo(0.5, 6);
    // 내부 저장은 프리멀티플라이드다.
    const premultiplied = readStudioHighBitPremultiplied(surface, 1, 1);
    expect(premultiplied[0]).toBeCloseTo(0.125, 6);
  });

  it("범위 밖 좌표는 투명을 주고 쓰기는 무시한다", () => {
    const surface = createStudioHighBitSurface({ width: 2, height: 2 });
    expect(readStudioHighBitPixel(surface, -1, 0)).toEqual([0, 0, 0, 0]);
    expect(readStudioHighBitPixel(surface, 0, 5)).toEqual([0, 0, 0, 0]);
    writeStudioHighBitPixel(surface, 9, 9, [1, 1, 1, 1]);
    expect(Array.from(surface.data).every((value) => value === 0)).toBe(true);
  });
});

describe("8비트 경계 변환", () => {
  const bytes = new Uint8ClampedArray([
    0, 0, 0, 255,
    255, 255, 255, 255,
    128, 64, 32, 255,
    200, 100, 50, 128,
  ]);

  it("불투명 픽셀은 float32 왕복에서 바이트가 완전 동일하다", () => {
    const surface = studioHighBitSurfaceFromBytes(bytes, { width: 2, height: 2, storage: "float32" });
    const out = studioHighBitSurfaceToBytes(surface);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it("uint16 왕복도 256 코드 전부에서 무손실이다", () => {
    const ramp = new Uint8ClampedArray(256 * 4);
    for (let code = 0; code < 256; code += 1) {
      ramp[code * 4] = code;
      ramp[code * 4 + 1] = code;
      ramp[code * 4 + 2] = code;
      ramp[code * 4 + 3] = 255;
    }
    const surface = studioHighBitSurfaceFromBytes(ramp, { width: 256, height: 1 });
    const out = studioHighBitSurfaceToBytes(surface);
    expect(Array.from(out)).toEqual(Array.from(ramp));
  });

  it("선형광으로 디코드한다(감마 값 그대로 담지 않는다)", () => {
    const surface = studioHighBitSurfaceFromBytes(bytes, { width: 2, height: 2, storage: "float32" });
    const gray = readStudioHighBitPixel(surface, 0, 1);
    expect(gray[0]).toBeCloseTo(studioHighBitByteToLinear(128), 6);
    expect(gray[0]).toBeCloseTo(0.2158605, 6);
    expect(gray[0]).not.toBeCloseTo(128 / 255, 3);
  });

  it("반투명 픽셀도 왕복에서 1코드 이내로 복원된다", () => {
    const surface = studioHighBitSurfaceFromBytes(bytes, { width: 2, height: 2, storage: "uint16" });
    const out = studioHighBitSurfaceToBytes(surface);
    expect(out[12]).toBe(200);
    expect(out[13]).toBe(100);
    expect(out[14]).toBe(50);
    expect(out[15]).toBe(128);
  });

  it("길이가 맞지 않는 입력을 거부한다", () => {
    expect(() => studioHighBitSurfaceFromBytes(new Uint8ClampedArray(7), { width: 2, height: 1 }))
      .toThrow(/폭×높이×4/u);
  });

  it("sRGB→P3 인코드는 같은 색을 더 작은 좌표로 옮긴다", () => {
    const red = new Uint8ClampedArray([255, 0, 0, 255]);
    const surface = studioHighBitSurfaceFromBytes(red, { width: 1, height: 1, storage: "float32" });
    const p3 = studioHighBitSurfaceToBytes(surface, { targetGamut: "display-p3" });
    // P3 는 더 넓으므로, 같은 물리색은 더 낮은 R 코드 + 약간의 G/B 로 표현된다.
    expect(p3[0]).toBeLessThan(255);
    expect(p3[0]).toBeGreaterThan(224);
    expect(p3[1]).toBeGreaterThan(0);
  });

  /**
   * 정직한 한계: **8비트를 거치는** P3 왕복은 무손실이 아니다. 어두운 채널에서 sRGB OETF 의
   * 기울기가 12.92 라 P3 쪽 0.5코드 양자화 오차가 sRGB 로 돌아올 때 최대 7코드까지 증폭된다.
   * 고비트 표면에 머무는 동안의 변환은 정확하므로, 결론은 "P3 는 출력 경계에서만" 이다.
   */
  it("8비트를 거치는 P3 왕복은 어두운 채널에서 최대 7코드까지 벌어진다", () => {
    const samples: number[] = [];
    for (let red = 0; red <= 255; red += 17) {
      for (let green = 0; green <= 255; green += 17) {
        for (let blue = 0; blue <= 255; blue += 17) samples.push(red, green, blue, 255);
      }
    }
    const source = new Uint8ClampedArray(samples);
    const width = samples.length / 4;
    const srgbSurface = studioHighBitSurfaceFromBytes(source, { width, height: 1, storage: "float32" });
    const p3Bytes = studioHighBitSurfaceToBytes(srgbSurface, { targetGamut: "display-p3" });
    const p3Surface = studioHighBitSurfaceFromBytes(p3Bytes, {
      width,
      height: 1,
      storage: "float32",
      sourceGamut: "display-p3",
      gamut: "srgb",
    });
    const back = studioHighBitSurfaceToBytes(p3Surface);
    let worst = 0;
    for (let index = 0; index < source.length; index += 1) {
      worst = Math.max(worst, Math.abs(back[index]! - source[index]!));
    }
    expect(worst).toBeGreaterThan(1);
    expect(worst).toBeLessThanOrEqual(8);
  });

  it("고비트 표면 안에서의 개멋 왕복은 사실상 무손실이다", () => {
    const source = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 12, 34, 56, 255]);
    const srgb = studioHighBitSurfaceFromBytes(source, { width: 3, height: 1, storage: "float32" });
    let worst = 0;
    for (let x = 0; x < 3; x += 1) {
      const straight = readStudioHighBitPixel(srgb, x, 0);
      const linear: StudioHighBitRgb = [straight[0], straight[1], straight[2]];
      const p3 = convertStudioHighBitLinearGamut(linear, "srgb", "display-p3");
      const back = convertStudioHighBitLinearGamut(p3, "display-p3", "srgb");
      for (let channel = 0; channel < 3; channel += 1) {
        worst = Math.max(worst, Math.abs(back[channel]! - linear[channel]!));
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it("기본 양자화기는 단순 반올림·클램프다", () => {
    expect(roundStudioHighBitQuantizer(0.5, 0, 0, 0)).toBe(128);
    expect(roundStudioHighBitQuantizer(-1, 0, 0, 0)).toBe(0);
    expect(roundStudioHighBitQuantizer(9, 0, 0, 0)).toBe(255);
  });
});
