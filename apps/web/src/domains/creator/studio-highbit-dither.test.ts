import { describe, expect, it } from "vitest";

import {
  createStudioHighBitSurface,
  studioHighBitSurfaceToBytes,
  writeStudioHighBitPixel,
} from "./studio-highbit-buffer";
import {
  STUDIO_HIGHBIT_BAYER_8,
  STUDIO_HIGHBIT_BAYER_EDGE,
  STUDIO_HIGHBIT_DITHER_MODES,
  createStudioHighBitDitherQuantizer,
  measureStudioHighBitBanding,
  studioHighBitDitherHash,
  studioHighBitDitherOffset,
  type StudioHighBitBandingReport,
  type StudioHighBitDitherMode,
} from "./studio-highbit-dither";
import { studioHighBitSrgbToLinear } from "./studio-highbit-transfer";

const WIDTH = 512;

/** 8비트 코드 도메인의 완만한 램프. 실제 밴딩이 보이는 조건(폭 512px 에 1.6코드)을 재현한다. */
function shallowRamp(low: number, high: number): Float64Array {
  const reference = new Float64Array(WIDTH);
  for (let x = 0; x < WIDTH; x += 1) {
    reference[x] = low + (high - low) * (x / (WIDTH - 1));
  }
  return reference;
}

function quantizeRow(
  reference: Float64Array,
  mode: StudioHighBitDitherMode,
  seed = 7,
  row = 0
): Uint8ClampedArray {
  const quantize = createStudioHighBitDitherQuantizer({ mode, seed });
  const out = new Uint8ClampedArray(reference.length);
  for (let x = 0; x < reference.length; x += 1) {
    out[x] = quantize(reference[x]! / 255, x, row, 0);
  }
  return out;
}

function report(mode: StudioHighBitDitherMode, reference: Float64Array): StudioHighBitBandingReport {
  return measureStudioHighBitBanding(quantizeRow(reference, mode), reference, 16);
}

describe("Bayer 행렬", () => {
  it("8×8 이 0..63 을 정확히 한 번씩 담는다", () => {
    expect(STUDIO_HIGHBIT_BAYER_8).toHaveLength(64);
    expect([...STUDIO_HIGHBIT_BAYER_8].sort((a, b) => a - b))
      .toEqual(Array.from({ length: 64 }, (_, index) => index));
    expect(STUDIO_HIGHBIT_BAYER_EDGE).toBe(8);
    expect(STUDIO_HIGHBIT_BAYER_8[0]).toBe(0);
  });
});

describe("디더 오프셋", () => {
  it("정렬/블루노이즈는 ±0.5 LSB, TPDF 는 ±1 LSB 안에 있다", () => {
    const bounds: Record<string, { min: number; max: number }> = {};
    for (const mode of STUDIO_HIGHBIT_DITHER_MODES) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let y = 0; y < 24; y += 1) {
        for (let x = 0; x < 256; x += 1) {
          for (let channel = 0; channel < 4; channel += 1) {
            const offset = studioHighBitDitherOffset(mode, 3, x, y, channel);
            min = Math.min(min, offset);
            max = Math.max(max, offset);
          }
        }
      }
      bounds[mode] = { min, max };
    }
    expect(bounds.none).toEqual({ min: 0, max: 0 });
    expect(bounds.ordered!.min).toBeGreaterThanOrEqual(-0.5);
    expect(bounds.ordered!.max).toBeLessThan(0.5);
    expect(bounds["blue-noise"]!.min).toBeGreaterThanOrEqual(-0.5);
    expect(bounds["blue-noise"]!.max).toBeLessThan(0.5);
    expect(bounds.triangular!.min).toBeGreaterThan(-1);
    expect(bounds.triangular!.max).toBeLessThan(1);
    expect(bounds.triangular!.min).toBeLessThan(-0.9);
    expect(bounds.triangular!.max).toBeGreaterThan(0.9);
  });

  it("오프셋 평균이 0 에 가깝다(밝기 편향 없음)", () => {
    for (const mode of STUDIO_HIGHBIT_DITHER_MODES) {
      let sum = 0;
      let count = 0;
      for (let y = 0; y < 64; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          sum += studioHighBitDitherOffset(mode, 1, x, y, 0);
          count += 1;
        }
      }
      expect(Math.abs(sum / count)).toBeLessThan(0.02);
    }
  });

  it("해시가 [0,1) 균등이고 결정적이다", () => {
    expect(studioHighBitDitherHash(1, 2, 3, 0)).toBe(studioHighBitDitherHash(1, 2, 3, 0));
    expect(studioHighBitDitherHash(1, 2, 3, 0)).not.toBe(studioHighBitDitherHash(1, 2, 3, 1));
    let sum = 0;
    const samples = 4096;
    for (let index = 0; index < samples; index += 1) {
      const value = studioHighBitDitherHash(9, index, index * 7, index % 4);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / samples).toBeGreaterThan(0.45);
    expect(sum / samples).toBeLessThan(0.55);
  });
});

describe("밴딩 감소 — 수치 증명", () => {
  const reference = shallowRamp(40.2, 41.8);

  it("디더 없이는 평탄역이 320px 까지 이어진다", () => {
    const none = report("none", reference);
    expect(none.longestRun).toBeGreaterThanOrEqual(300);
    expect(none.transitionCount).toBeLessThanOrEqual(3);
    expect(none.meanAbsoluteLowPassError).toBeGreaterThan(0.25);
  });

  it("블루노이즈가 평탄역을 10배 줄이고 저역통과 오차를 5배 줄인다", () => {
    const none = report("none", reference);
    const blue = report("blue-noise", reference);
    expect(blue.longestRun).toBeLessThan(none.longestRun / 5);
    expect(blue.longestRun).toBeLessThanOrEqual(40);
    expect(blue.transitionCount).toBeGreaterThan(150);
    expect(blue.meanAbsoluteLowPassError).toBeLessThan(none.meanAbsoluteLowPassError / 4);
    expect(blue.meanAbsoluteLowPassError).toBeLessThan(0.08);
    expect(blue.maxAbsoluteLowPassError).toBeLessThan(none.maxAbsoluteLowPassError / 2);
  });

  it("TPDF 는 평탄역을 가장 잘게 부순다", () => {
    const none = report("none", reference);
    const triangular = report("triangular", reference);
    expect(triangular.longestRun).toBeLessThan(20);
    expect(triangular.meanAbsoluteLowPassError).toBeLessThan(none.meanAbsoluteLowPassError / 2);
  });

  it("Bayer 정렬 디더도 개선하지만 블루노이즈보다 약하다", () => {
    const none = report("none", reference);
    const ordered = report("ordered", reference);
    const blue = report("blue-noise", reference);
    expect(ordered.longestRun).toBeLessThan(none.longestRun);
    expect(ordered.meanAbsoluteLowPassError).toBeLessThan(none.meanAbsoluteLowPassError);
    expect(ordered.meanAbsoluteLowPassError).toBeGreaterThan(blue.meanAbsoluteLowPassError);
  });

  it("8코드 램프에서도 순위가 유지된다(none > ordered > triangular > blue-noise)", () => {
    const wide = shallowRamp(40, 48);
    const errors = new Map<StudioHighBitDitherMode, number>();
    for (const mode of STUDIO_HIGHBIT_DITHER_MODES) {
      let sum = 0;
      const rows = 32;
      for (let row = 0; row < rows; row += 1) {
        sum += measureStudioHighBitBanding(quantizeRow(wide, mode, 7, row), wide, 16)
          .meanAbsoluteLowPassError;
      }
      errors.set(mode, sum / rows);
    }
    expect(errors.get("none")!).toBeGreaterThan(0.15);
    expect(errors.get("blue-noise")!).toBeLessThan(0.06);
    expect(errors.get("blue-noise")!).toBeLessThan(errors.get("triangular")!);
    expect(errors.get("triangular")!).toBeLessThan(errors.get("ordered")!);
    expect(errors.get("ordered")!).toBeLessThan(errors.get("none")!);
  });

  it("정확히 표현 가능한 코드는 디더하지 않는다(평면 채움·순백/순흑 보호)", () => {
    const quantize = createStudioHighBitDitherQuantizer({ mode: "triangular", seed: 5 });
    for (let x = 0; x < 256; x += 1) {
      expect(quantize(0, x, 0, 0)).toBe(0);
      expect(quantize(1, x, 0, 0)).toBe(255);
      expect(quantize(-5, x, 0, 0)).toBe(0);
      expect(quantize(9, x, 0, 0)).toBe(255);
      // 임의의 정확한 8비트 코드도 그대로 통과한다.
      expect(quantize(137 / 255, x, 0, 0)).toBe(137);
    }
  });

  it("표현 불가능한 중간값만 흩는다", () => {
    const quantize = createStudioHighBitDitherQuantizer({ mode: "blue-noise", seed: 5 });
    let spread = 0;
    for (let x = 0; x < 256; x += 1) {
      if (quantize(137.4 / 255, x, 0, 0) !== 137) spread += 1;
    }
    expect(spread).toBeGreaterThan(60);
    expect(spread).toBeLessThan(160);
  });

  it("알파 채널은 기본적으로 디더하지 않는다(마스크 경계 보호)", () => {
    const withoutAlpha = createStudioHighBitDitherQuantizer({ mode: "triangular", seed: 3 });
    const withAlpha = createStudioHighBitDitherQuantizer({
      mode: "triangular",
      seed: 3,
      ditherAlpha: true,
    });
    let differences = 0;
    for (let x = 0; x < 256; x += 1) {
      expect(withoutAlpha(0.5, x, 0, 3)).toBe(128);
      if (withAlpha(0.5, x, 0, 3) !== 128) differences += 1;
    }
    expect(differences).toBeGreaterThan(50);
  });
});

describe("결정성", () => {
  it("같은 시드는 동일 바이트, 다른 시드는 다른 바이트를 만든다", () => {
    const reference = shallowRamp(40.2, 41.8);
    const first = quantizeRow(reference, "blue-noise", 7);
    const second = quantizeRow(reference, "blue-noise", 7);
    const other = quantizeRow(reference, "blue-noise", 8);
    expect(Array.from(first)).toEqual(Array.from(second));
    expect(Array.from(first)).not.toEqual(Array.from(other));
    // 시드를 바꿔도 품질은 유지된다.
    const quality = measureStudioHighBitBanding(other, reference, 16);
    expect(quality.meanAbsoluteLowPassError).toBeLessThan(0.08);
  });

  it("표면 → 바이트 경로에 주입해도 결정적이다", () => {
    const encode = (): Uint8ClampedArray => {
      const surface = createStudioHighBitSurface({ width: 64, height: 4, storage: "float32" });
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 64; x += 1) {
          const level = studioHighBitSrgbToLinear((40.2 + (1.6 * x) / 63) / 255);
          writeStudioHighBitPixel(surface, x, y, [level, level, level, 1]);
        }
      }
      return studioHighBitSurfaceToBytes(surface, {
        quantizer: createStudioHighBitDitherQuantizer({ mode: "blue-noise", seed: 42 }),
      });
    };
    expect(Array.from(encode())).toEqual(Array.from(encode()));
  });

  it("고비트 표면 + 디더가 8비트 왕복보다 그라데이션을 잘 보존한다", () => {
    const width = 512;
    const surface = createStudioHighBitSurface({ width, height: 1, storage: "float32" });
    const reference = new Float64Array(width);
    for (let x = 0; x < width; x += 1) {
      const code = 40.2 + (1.6 * x) / (width - 1);
      reference[x] = code;
      const level = studioHighBitSrgbToLinear(code / 255);
      writeStudioHighBitPixel(surface, x, 0, [level, level, level, 1]);
    }
    const plain = studioHighBitSurfaceToBytes(surface);
    const dithered = studioHighBitSurfaceToBytes(surface, {
      quantizer: createStudioHighBitDitherQuantizer({ mode: "blue-noise", seed: 11 }),
    });
    const redOf = (bytes: Uint8ClampedArray): Uint8ClampedArray => {
      const out = new Uint8ClampedArray(width);
      for (let x = 0; x < width; x += 1) out[x] = bytes[x * 4]!;
      return out;
    };
    const plainReport = measureStudioHighBitBanding(redOf(plain), reference, 16);
    const ditheredReport = measureStudioHighBitBanding(redOf(dithered), reference, 16);
    expect(plainReport.longestRun).toBeGreaterThan(200);
    expect(ditheredReport.longestRun).toBeLessThan(50);
    expect(ditheredReport.meanAbsoluteLowPassError)
      .toBeLessThan(plainReport.meanAbsoluteLowPassError / 3);
  });
});

describe("계측기 자체 검증", () => {
  it("길이가 다르거나 비면 거부한다", () => {
    expect(() => measureStudioHighBitBanding([], [], 4)).toThrow();
    expect(() => measureStudioHighBitBanding([1, 2], [1], 4)).toThrow();
  });

  it("완전 평탄한 신호는 run = 길이, transition = 0 이다", () => {
    const flat = new Uint8ClampedArray(64).fill(100);
    const result = measureStudioHighBitBanding(flat, new Float64Array(64).fill(100), 8);
    expect(result.distinctLevels).toBe(1);
    expect(result.longestRun).toBe(64);
    expect(result.transitionCount).toBe(0);
    expect(result.meanAbsoluteLowPassError).toBe(0);
  });
});
