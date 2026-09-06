import { describe, expect, it } from "vitest";

import {
  createStudioHighBitSurface,
  decodeStudioHighBitStorageValue,
  encodeStudioHighBitStorageValue,
  readStudioHighBitPixel,
  studioHighBitSurfaceFromBytes,
  studioHighBitSurfaceToBytes,
  writeStudioHighBitPixel,
  type StudioHighBitStorage,
} from "./studio-highbit-buffer";
import {
  accumulateStudioHighBitDab,
  blendStudioHighBitPixel,
  compositeStudioHighBitErasePixel,
  compositeStudioHighBitOverPixel,
  compositeStudioHighBitSurface,
  compositeStudioLegacy8BitOverPixel,
  studioHighBitDabCoverage,
} from "./studio-highbit-composite";
import {
  studioHighBitLinearToByte,
  studioHighBitLinearToSrgb,
  studioHighBitSrgbToLinear,
} from "./studio-highbit-transfer";

describe("선형광 vs 감마 공간 합성 — 알려진 색쌍의 수치 차이", () => {
  it("검정 위 흰색 알파 0.5 에서 60 코드 차이가 난다", () => {
    const legacy = compositeStudioLegacy8BitOverPixel([0, 0, 0, 255], [255, 255, 255, 255], 0.5);
    expect(legacy[0]).toBe(128);

    const linear = compositeStudioHighBitOverPixel(
      [0, 0, 0, 1],
      [1 * 0.5, 1 * 0.5, 1 * 0.5, 0.5]
    );
    const encoded = studioHighBitLinearToByte(linear[0]);
    expect(encoded).toBe(188);
    expect(encoded - legacy[0]).toBe(60);
  });

  it("빨강 위 초록 50% 도 같은 60 코드 오차를 채널마다 만든다", () => {
    const legacy = compositeStudioLegacy8BitOverPixel([255, 0, 0, 255], [0, 255, 0, 255], 0.5);
    expect(legacy[0]).toBe(128);
    expect(legacy[1]).toBe(128);

    const red = studioHighBitSrgbToLinear(1);
    const linear = compositeStudioHighBitOverPixel(
      [red, 0, 0, 1],
      [0, red * 0.5, 0, 0.5]
    );
    expect(studioHighBitLinearToByte(linear[0])).toBe(188);
    expect(studioHighBitLinearToByte(linear[1])).toBe(188);
  });

  it("모든 8비트 코드에 대해 감마 50% 혼합의 최대 오차는 60 코드다", () => {
    let worst = 0;
    for (let code = 0; code <= 255; code += 1) {
      const gammaMix = Math.round((code + 255) / 2);
      const linearMix = studioHighBitLinearToByte(
        (studioHighBitSrgbToLinear(code / 255) + studioHighBitSrgbToLinear(1)) / 2
      );
      worst = Math.max(worst, Math.abs(linearMix - gammaMix));
    }
    expect(worst).toBe(60);
  });

  it("불투명하거나 완전 투명한 극단에서는 두 방식이 일치한다", () => {
    expect(compositeStudioLegacy8BitOverPixel([10, 20, 30, 255], [200, 100, 50, 255], 1))
      .toEqual([200, 100, 50, 255]);
    expect(compositeStudioLegacy8BitOverPixel([10, 20, 30, 255], [200, 100, 50, 0], 1))
      .toEqual([10, 20, 30, 255]);
    const opaque = compositeStudioHighBitOverPixel([0.1, 0.2, 0.3, 1], [0.7, 0.5, 0.2, 1]);
    expect(opaque).toEqual([0.7, 0.5, 0.2, 1]);
  });
});

describe("반복 합성 드리프트 — 8비트 스톨 vs 고비트 안정성", () => {
  const ITERATIONS = 500;
  const STEP_ALPHA = 0.002;

  function accumulate(storage: StudioHighBitStorage): number {
    let raw = encodeStudioHighBitStorageValue(1, storage);
    for (let step = 0; step < ITERATIONS; step += 1) {
      const value = decodeStudioHighBitStorageValue(raw, storage);
      raw = encodeStudioHighBitStorageValue(value * (1 - STEP_ALPHA), storage);
    }
    return decodeStudioHighBitStorageValue(raw, storage) * 255;
  }

  it("알파 0.002 로 500회 어둡게: 8비트는 250에서 멈추고 참값은 93.7 이다", () => {
    const truth = 255 * Math.pow(1 - STEP_ALPHA, ITERATIONS);
    expect(truth).toBeCloseTo(93.715, 3);

    let legacy: [number, number, number, number] = [255, 255, 255, 255];
    const trace: number[] = [];
    for (let step = 0; step < ITERATIONS; step += 1) {
      legacy = compositeStudioLegacy8BitOverPixel(legacy, [0, 0, 0, 255], STEP_ALPHA);
      trace.push(legacy[0]);
    }
    // 250 에서 증분(0.5 코드)이 반올림 임계 아래로 떨어져 영구 정지한다.
    expect(legacy[0]).toBe(250);
    expect(trace[10]).toBe(250);
    expect(trace[ITERATIONS - 1]).toBe(250);
    expect(legacy[0] - truth).toBeGreaterThan(150);

    const uint16 = accumulate("uint16");
    const float32 = accumulate("float32");
    expect(Math.abs(uint16 - truth)).toBeLessThan(0.05);
    expect(Math.abs(float32 - truth)).toBeLessThan(0.01);
    // 드리프트 개선 배수: 156 코드 → 0.01 코드 수준.
    expect(Math.abs(legacy[0] - truth) / Math.abs(uint16 - truth)).toBeGreaterThan(1000);
  });

  it("알파 0.004 로 300회 밝게: 8비트는 48 코드 뒤처진다", () => {
    const steps = 300;
    const alpha = 0.004;
    const truth = 255 * (1 - Math.pow(1 - alpha, steps));
    expect(truth).toBeCloseTo(178.380, 3);

    let legacy: [number, number, number, number] = [0, 0, 0, 255];
    for (let step = 0; step < steps; step += 1) {
      legacy = compositeStudioLegacy8BitOverPixel(legacy, [255, 255, 255, 255], alpha);
    }
    expect(legacy[0]).toBe(130);
    expect(truth - legacy[0]).toBeGreaterThan(48);

    let raw = encodeStudioHighBitStorageValue(0, "uint16");
    for (let step = 0; step < steps; step += 1) {
      const value = decodeStudioHighBitStorageValue(raw, "uint16");
      raw = encodeStudioHighBitStorageValue(value + alpha * (1 - value), "uint16");
    }
    expect(Math.abs(decodeStudioHighBitStorageValue(raw, "uint16") * 255 - truth)).toBeLessThan(0.05);
  });

  /**
   * Konva 필터 체인(`studio-konva-filters.ts` 의 `filters.push(...)` 배열)은 필터마다 같은
   * `Uint8ClampedArray` 를 제자리 갱신한다. 6개 감마 보정 + 그 역보정 12스텝을 태우면
   * 항등이어야 할 왕복이 8비트에서만 어긋난다.
   */
  it("12단 감마 필터 체인에서 8비트는 256코드 중 59개가 최대 3코드 어긋난다", () => {
    const gammas = [0.9, 1.15, 0.82, 1.3, 0.95, 1.08];
    const chain: ((value: number) => number)[] = [
      ...gammas.map((gamma) => (value: number) => 255 * Math.pow(Math.max(0, value) / 255, gamma)),
      ...[...gammas].reverse().map((gamma) => (value: number) =>
        255 * Math.pow(Math.max(0, value) / 255, 1 / gamma)),
    ];

    let drifted = 0;
    let worstLegacy = 0;
    let worstUint16 = 0;
    let worstFloat32 = 0;
    for (let start = 0; start <= 255; start += 1) {
      const legacy = new Uint8ClampedArray([start]);
      let uint16 = encodeStudioHighBitStorageValue(start / 255, "uint16");
      let float32 = encodeStudioHighBitStorageValue(start / 255, "float32");
      for (const step of chain) {
        legacy[0] = step(legacy[0]!);
        uint16 = encodeStudioHighBitStorageValue(
          step(decodeStudioHighBitStorageValue(uint16, "uint16") * 255) / 255,
          "uint16"
        );
        float32 = encodeStudioHighBitStorageValue(
          step(decodeStudioHighBitStorageValue(float32, "float32") * 255) / 255,
          "float32"
        );
      }
      const legacyError = Math.abs(legacy[0]! - start);
      if (legacyError > 0) drifted += 1;
      worstLegacy = Math.max(worstLegacy, legacyError);
      worstUint16 = Math.max(
        worstUint16,
        Math.abs(decodeStudioHighBitStorageValue(uint16, "uint16") * 255 - start)
      );
      worstFloat32 = Math.max(
        worstFloat32,
        Math.abs(decodeStudioHighBitStorageValue(float32, "float32") * 255 - start)
      );
    }

    expect(drifted).toBe(59);
    expect(worstLegacy).toBe(3);
    expect(worstUint16).toBeLessThan(0.01);
    expect(worstFloat32).toBeLessThan(1e-4);
  });

  /**
   * 정직한 한계: 이 표면은 display-referred(0..1 클램프)다. 대비를 올려 0/255 밖으로 밀려난
   * 값은 고비트여도 되살아나지 않는다 — 클리핑은 양자화와 다른 종류의 손실이고, 이를 막으려면
   * scene-referred(부호 있는·1 초과 허용) 저장이 필요하다.
   */
  it("클램프로 잘려나간 정보는 고비트로도 복구되지 않는다", () => {
    const boost = (value: number): number => (value - 128) * 1.2 + 128;
    const restore = (value: number): number => (value - 128) / 1.2 + 128;
    const start = 250;
    let high = encodeStudioHighBitStorageValue(start / 255, "uint16");
    high = encodeStudioHighBitStorageValue(boost(decodeStudioHighBitStorageValue(high, "uint16") * 255) / 255, "uint16");
    high = encodeStudioHighBitStorageValue(restore(decodeStudioHighBitStorageValue(high, "uint16") * 255) / 255, "uint16");
    const recovered = decodeStudioHighBitStorageValue(high, "uint16") * 255;
    expect(recovered).toBeLessThan(start - 6);
    expect(recovered).toBeCloseTo(restore(255), 2);
  });
});

describe("블렌드 모드", () => {
  it("normal 은 프리멀티 source-over 와 동일하다", () => {
    const destination = [0.2, 0.4, 0.6, 0.8] as const;
    const source = [0.1, 0.2, 0.3, 0.5] as const;
    expect(blendStudioHighBitPixel(destination, source)).toEqual(
      compositeStudioHighBitOverPixel(destination, source)
    );
  });

  it("multiply 는 작업 공간에 따라 결과가 달라진다(선형이 기본)", () => {
    const half = studioHighBitSrgbToLinear(0.5);
    const destination = [half, half, half, 1] as const;
    const source = [half, half, half, 1] as const;
    const linear = blendStudioHighBitPixel(destination, source, { mode: "multiply", space: "linear" });
    const encoded = blendStudioHighBitPixel(destination, source, { mode: "multiply", space: "encoded" });
    // 감마 공간 곱은 0.5×0.5=0.25(=코드 64), 선형 곱은 더 어둡다.
    expect(studioHighBitLinearToByte(encoded[0])).toBe(Math.round(0.25 * 255));
    expect(studioHighBitLinearToByte(linear[0])).toBeLessThan(studioHighBitLinearToByte(encoded[0]));
    expect(studioHighBitLinearToByte(encoded[0]) - studioHighBitLinearToByte(linear[0]))
      .toBeGreaterThanOrEqual(3);
  });

  it("multiply 의 두 작업 공간 차이는 256² 조합에서 최대 8코드다", () => {
    let worst = 0;
    for (let backdrop = 0; backdrop <= 255; backdrop += 1) {
      for (let source = 0; source <= 255; source += 1) {
        const encoded = Math.round((backdrop / 255) * (source / 255) * 255);
        const linear = studioHighBitLinearToByte(
          studioHighBitSrgbToLinear(backdrop / 255) * studioHighBitSrgbToLinear(source / 255)
        );
        worst = Math.max(worst, Math.abs(encoded - linear));
      }
    }
    expect(worst).toBe(8);
  });

  it("screen/overlay/linear-dodge 가 사양 공식을 따른다", () => {
    const backdrop = [0.25, 0.25, 0.25, 1] as const;
    const source = [0.5, 0.5, 0.5, 1] as const;
    const screen = blendStudioHighBitPixel(backdrop, source, { mode: "screen" });
    expect(screen[0]).toBeCloseTo(0.25 + 0.5 - 0.125, 12);
    const dodge = blendStudioHighBitPixel(backdrop, source, { mode: "linear-dodge" });
    expect(dodge[0]).toBeCloseTo(0.75, 12);
    const overlay = blendStudioHighBitPixel(backdrop, source, { mode: "overlay" });
    expect(overlay[0]).toBeCloseTo(2 * 0.25 * 0.5, 12);
  });

  it("불투명도 0 또는 투명 배경에서 경계 규약을 지킨다", () => {
    const destination = [0.2, 0.3, 0.4, 0.5] as const;
    expect(blendStudioHighBitPixel(destination, [1, 1, 1, 1], { opacity: 0 }))
      .toEqual([0.2, 0.3, 0.4, 0.5]);
    const overTransparent = blendStudioHighBitPixel([0, 0, 0, 0], [0.5, 0.25, 0.1, 0.5], {
      mode: "multiply",
    });
    expect(overTransparent).toEqual([0.5, 0.25, 0.1, 0.5]);
  });

  it("지우개는 색과 알파를 같은 비율로 줄인다(프리멀티 불변식 유지)", () => {
    const erased = compositeStudioHighBitErasePixel([0.4, 0.2, 0.1, 0.8], 0.5);
    expect(erased).toEqual([0.2, 0.1, 0.05, 0.4]);
    // 스트레이트 색은 변하지 않아야 한다.
    expect(erased[0] / erased[3]).toBeCloseTo(0.4 / 0.8, 12);
  });
});

describe("표면 합성", () => {
  it("크기·개멋이 다르면 거부한다", () => {
    const a = createStudioHighBitSurface({ width: 2, height: 2 });
    const b = createStudioHighBitSurface({ width: 3, height: 2 });
    expect(() => compositeStudioHighBitSurface(a, b)).toThrow(/크기/u);
    const p3 = createStudioHighBitSurface({ width: 2, height: 2, gamut: "display-p3" });
    expect(() => compositeStudioHighBitSurface(a, p3)).toThrow(/개멋/u);
  });

  it("불투명 소스로 덮으면 목적지가 소스와 같아진다", () => {
    const destination = createStudioHighBitSurface({ width: 2, height: 1, storage: "float32" });
    const source = createStudioHighBitSurface({ width: 2, height: 1, storage: "float32" });
    writeStudioHighBitPixel(source, 0, 0, [0.3, 0.6, 0.9, 1]);
    writeStudioHighBitPixel(source, 1, 0, [0.1, 0.2, 0.3, 1]);
    compositeStudioHighBitSurface(destination, source);
    expect(readStudioHighBitPixel(destination, 0, 0)[1]).toBeCloseTo(0.6, 6);
    expect(readStudioHighBitPixel(destination, 1, 0)[2]).toBeCloseTo(0.3, 6);
  });
});

describe("브러시 dab 누적", () => {
  it("커버리지가 중심 1 → 반경 밖 0 으로 단조 감소한다", () => {
    expect(studioHighBitDabCoverage(0, 10, 0.5)).toBe(1);
    expect(studioHighBitDabCoverage(10, 10, 0.5)).toBe(0);
    expect(studioHighBitDabCoverage(20, 10, 0.5)).toBe(0);
    expect(studioHighBitDabCoverage(0, 0, 1)).toBe(0);
    let previous = 1;
    for (let distance = 0; distance <= 10; distance += 0.5) {
      const coverage = studioHighBitDabCoverage(distance, 10, 0.5);
      expect(coverage).toBeLessThanOrEqual(previous + 1e-12);
      previous = coverage;
    }
    // 경도 1 이어도 가장자리에 안티에일리어싱이 남는다.
    expect(studioHighBitDabCoverage(9.6, 10, 1)).toBeGreaterThan(0);
    expect(studioHighBitDabCoverage(9.6, 10, 1)).toBeLessThan(1);
  });

  it("낮은 flow 로 200회 겹쳐도 값이 멈추지 않는다(8비트 경로는 멈춘다)", () => {
    const surface = createStudioHighBitSurface({ width: 8, height: 8, storage: "float32" });
    const flow = 0.003;
    const steps = 200;
    for (let step = 0; step < steps; step += 1) {
      accumulateStudioHighBitDab(surface, {
        x: 4,
        y: 4,
        radius: 3,
        alpha: flow,
        hardness: 1,
        color: [1, 1, 1],
      });
    }
    const center = readStudioHighBitPixel(surface, 4, 4);
    const truth = 1 - Math.pow(1 - flow, steps);
    expect(center[3]).toBeCloseTo(truth, 5);
    expect(center[3]).toBeGreaterThan(0.45);

    // 같은 시나리오의 8비트 경로: 알파 증분 0.003×255 = 0.765 → 첫 스텝에서 1, 이후 계속
    // 0.76 씩 더해지지만 반올림 손실로 참값에 크게 못 미친다.
    const legacyAlpha = new Uint8ClampedArray([0]);
    for (let step = 0; step < steps; step += 1) {
      legacyAlpha[0] = legacyAlpha[0]! + flow * (255 - legacyAlpha[0]!);
    }
    expect(Math.abs(legacyAlpha[0]! / 255 - truth) * 255).toBeGreaterThan(20);
  });

  it("지우개 dab 은 알파만 깎고 스트레이트 색을 유지한다", () => {
    const surface = createStudioHighBitSurface({ width: 4, height: 4, storage: "float32" });
    writeStudioHighBitPixel(surface, 2, 2, [0.8, 0.4, 0.2, 1]);
    accumulateStudioHighBitDab(surface, {
      x: 2.5,
      y: 2.5,
      radius: 2,
      alpha: 0.5,
      hardness: 1,
      color: [0, 0, 0],
      composite: "erase",
    });
    const pixel = readStudioHighBitPixel(surface, 2, 2);
    expect(pixel[3]).toBeCloseTo(0.5, 5);
    expect(pixel[0]).toBeCloseTo(0.8, 5);
    expect(pixel[1]).toBeCloseTo(0.4, 5);
  });

  it("결정적이다 — 같은 dab 순서면 바이트가 동일하다", () => {
    const render = (): Uint8ClampedArray => {
      const surface = createStudioHighBitSurface({ width: 16, height: 16, storage: "float32" });
      for (let step = 0; step < 24; step += 1) {
        accumulateStudioHighBitDab(surface, {
          x: 2 + step * 0.5,
          y: 8 + Math.sin(step) * 3,
          radius: 2.5,
          alpha: 0.12,
          hardness: 0.4,
          color: [0.9, 0.1, 0.3],
        });
      }
      return studioHighBitSurfaceToBytes(surface);
    };
    expect(Array.from(render())).toEqual(Array.from(render()));
  });

  it("잘못된 dab 입력은 조용히 무시된다", () => {
    const surface = createStudioHighBitSurface({ width: 4, height: 4 });
    accumulateStudioHighBitDab(surface, { x: 2, y: 2, radius: 0, alpha: 1, color: [1, 1, 1] });
    accumulateStudioHighBitDab(surface, { x: 2, y: 2, radius: 2, alpha: 0, color: [1, 1, 1] });
    accumulateStudioHighBitDab(surface, {
      x: 2,
      y: 2,
      radius: Number.NaN,
      alpha: 1,
      color: [1, 1, 1],
    });
    expect(Array.from(surface.data).every((value) => value === 0)).toBe(true);
  });
});

describe("경계 왕복 통합", () => {
  it("8비트 입력 → 고비트 합성 → 8비트 출력이 감마 합성보다 밝다", () => {
    const black = new Uint8ClampedArray([0, 0, 0, 255]);
    const surface = studioHighBitSurfaceFromBytes(black, { width: 1, height: 1, storage: "float32" });
    const white = createStudioHighBitSurface({ width: 1, height: 1, storage: "float32" });
    writeStudioHighBitPixel(white, 0, 0, [1, 1, 1, 0.5]);
    compositeStudioHighBitSurface(surface, white);
    const out = studioHighBitSurfaceToBytes(surface);
    expect(out[0]).toBe(188);
    expect(studioHighBitLinearToSrgb(0.5) * 255).toBeCloseTo(187.516, 2);
  });
});
