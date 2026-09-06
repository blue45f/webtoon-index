import { describe, expect, it } from "vitest";

import {
  STUDIO_DENOISE_CONTRACT_VERSION,
  STUDIO_DENOISE_DEFAULT_OPTIONS,
  StudioDenoiseInputError,
  resolveStudioDenoiseOptions,
  sanitizeStudioDenoiseFrame,
  studioDenoiseLuminance,
  validateStudioDenoiseFrame,
} from "./studio-denoise-contract";

function rgb(pixels: number, value = 0): Float32Array {
  return new Float32Array(pixels * 3).fill(value);
}

describe("studio-denoise 계약 — 검증", () => {
  it("계약 버전을 노출한다", () => {
    expect(STUDIO_DENOISE_CONTRACT_VERSION).toBe(1);
  });

  it("최소 프레임(색만)은 유효하다", () => {
    expect(validateStudioDenoiseFrame({ width: 2, height: 2, color: rgb(4) })).toEqual([]);
  });

  it("차원이 정수가 아니거나 음수면 거부한다", () => {
    expect(validateStudioDenoiseFrame({ width: 2.5, height: 2, color: rgb(4) })[0].code).toBe(
      "dimensions",
    );
    expect(validateStudioDenoiseFrame({ width: -1, height: 2, color: rgb(4) })[0].code).toBe(
      "dimensions",
    );
  });

  it("각 보조 버퍼의 길이 불일치를 코드로 구분해 보고한다", () => {
    const issues = validateStudioDenoiseFrame({
      width: 2,
      height: 2,
      color: rgb(4),
      albedo: rgb(3),
      normal: rgb(5),
      depth: new Float32Array(3),
    });
    expect(issues.map((i) => i.code).sort()).toEqual([
      "albedo-length",
      "depth-length",
      "normal-length",
    ]);
  });

  it("모멘트는 반드시 쌍으로 와야 한다", () => {
    const issues = validateStudioDenoiseFrame({
      width: 2,
      height: 2,
      color: rgb(4),
      momentLuma: new Float32Array(4),
    });
    expect(issues.map((i) => i.code)).toContain("moments-pair");
  });

  it("픽셀별 sampleCount 길이도 검증한다", () => {
    const issues = validateStudioDenoiseFrame({
      width: 2,
      height: 2,
      color: rgb(4),
      sampleCount: new Uint32Array(3),
    });
    expect(issues.map((i) => i.code)).toContain("sampleCount-length");
  });

  it("sanitize 는 구조 오류에서 issues 를 담은 오류를 던진다", () => {
    expect(() =>
      sanitizeStudioDenoiseFrame({ width: 2, height: 2, color: rgb(3) }),
    ).toThrow(StudioDenoiseInputError);
  });
});

describe("studio-denoise 계약 — 정규화", () => {
  it("NaN/Inf/음수 색을 0 으로 복구하고 통계를 남긴다", () => {
    const color = rgb(2, 0.5);
    color[0] = Number.NaN;
    color[1] = Number.POSITIVE_INFINITY;
    color[2] = -0.25;
    const s = sanitizeStudioDenoiseFrame({ width: 2, height: 1, color });
    expect(Array.from(s.color).slice(0, 3)).toEqual([0, 0, 0]);
    expect(s.repairs.nonFiniteColor).toBe(2);
    expect(s.repairs.negativeColor).toBe(1);
  });

  it("노멀을 단위 길이로 정규화하고 영벡터는 (0,0,1) 로 대체한다", () => {
    const normal = new Float32Array([0, 0, 5, 0, 0, 0]);
    const s = sanitizeStudioDenoiseFrame({ width: 2, height: 1, color: rgb(2), normal });
    expect(Array.from(s.normal).slice(0, 3)).toEqual([0, 0, 1]);
    expect(Array.from(s.normal).slice(3, 6)).toEqual([0, 0, 1]);
    expect(s.repairs.degenerateNormal).toBe(1);
  });

  it("depth <= 0 / 비유한 깊이를 배경으로 분류한다", () => {
    const depth = new Float32Array([5, 0, -1, Number.NaN]);
    const s = sanitizeStudioDenoiseFrame({ width: 2, height: 2, color: rgb(4), depth });
    expect(Array.from(s.valid)).toEqual([1, 0, 0, 0]);
    expect(s.repairs.invalidDepth).toBe(3);
  });

  it("깊이 버퍼가 없으면 전 픽셀을 유효로 본다", () => {
    const s = sanitizeStudioDenoiseFrame({ width: 2, height: 2, color: rgb(4) });
    expect(Array.from(s.valid)).toEqual([1, 1, 1, 1]);
    expect(s.hasDepth).toBe(false);
  });

  it("알베도를 [0,1] 로 클램프하고, 없으면 1 로 채운다", () => {
    const albedo = new Float32Array([2, -1, 0.5, 0, 0, 0]);
    const s = sanitizeStudioDenoiseFrame({ width: 2, height: 1, color: rgb(2), albedo });
    expect(Array.from(s.albedo).slice(0, 3)).toEqual([1, 0, 0.5]);
    const none = sanitizeStudioDenoiseFrame({ width: 1, height: 1, color: rgb(1) });
    expect(Array.from(none.albedo)).toEqual([1, 1, 1]);
    expect(none.hasAlbedo).toBe(false);
  });

  it("스칼라/배열 sampleCount 를 모두 픽셀별 배열로 정규화한다", () => {
    const scalar = sanitizeStudioDenoiseFrame({
      width: 2,
      height: 1,
      color: rgb(2),
      sampleCount: 32,
    });
    expect(Array.from(scalar.sampleCount)).toEqual([32, 32]);

    const perPixel = sanitizeStudioDenoiseFrame({
      width: 2,
      height: 1,
      color: rgb(2),
      sampleCount: new Uint32Array([4, 0]),
    });
    expect(Array.from(perPixel.sampleCount)).toEqual([4, 0]);

    const bogus = sanitizeStudioDenoiseFrame({
      width: 1,
      height: 1,
      color: rgb(1),
      sampleCount: Number.NaN,
    });
    expect(Array.from(bogus.sampleCount)).toEqual([0]);
  });

  it("모멘트에서 평균의 분산을 계산한다 (표본분산 / 샘플수)", () => {
    // E[L]=2, E[L²]=8 → 표본분산 4. 샘플 4개 → 평균의 분산 1.
    const s = sanitizeStudioDenoiseFrame({
      width: 1,
      height: 1,
      color: rgb(1),
      sampleCount: 4,
      momentLuma: new Float32Array([2]),
      momentLuma2: new Float32Array([8]),
    });
    expect(s.momentVariance?.[0]).toBeCloseTo(1, 10);
  });

  it("모멘트 분산은 음수가 되지 않는다 (부동소수 오차 방어)", () => {
    const s = sanitizeStudioDenoiseFrame({
      width: 1,
      height: 1,
      color: rgb(1),
      sampleCount: 10,
      momentLuma: new Float32Array([2]),
      momentLuma2: new Float32Array([3.9]),
    });
    expect(s.momentVariance?.[0]).toBe(0);
  });

  it("0x0 프레임도 정규화된다", () => {
    const s = sanitizeStudioDenoiseFrame({ width: 0, height: 0, color: new Float32Array(0) });
    expect(s.pixelCount).toBe(0);
    expect(s.color.length).toBe(0);
  });
});

describe("studio-denoise 계약 — 옵션 정규화", () => {
  it("옵션 미지정이면 기본값 객체를 그대로 돌려준다", () => {
    expect(resolveStudioDenoiseOptions()).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS);
  });

  it("비유한/비양수 값을 기본값으로 되돌린다", () => {
    const r = resolveStudioDenoiseOptions({
      sigmaLuma: Number.NaN,
      sigmaNormal: -5,
      albedoFloor: 0,
      epsLuma: Number.POSITIVE_INFINITY,
    });
    expect(r.sigmaLuma).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS.sigmaLuma);
    expect(r.sigmaNormal).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS.sigmaNormal);
    expect(r.albedoFloor).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS.albedoFloor);
    expect(r.epsLuma).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS.epsLuma);
  });

  it("levels 를 정수 [0,12] 로 클램프한다", () => {
    expect(resolveStudioDenoiseOptions({ levels: -3 }).levels).toBe(0);
    expect(resolveStudioDenoiseOptions({ levels: 99 }).levels).toBe(12);
    expect(resolveStudioDenoiseOptions({ levels: 3.6 }).levels).toBe(4);
  });

  it("sampleCountScaleRange 는 뒤집혀 들어와도 정렬한다", () => {
    const r = resolveStudioDenoiseOptions({ sampleCountScaleRange: [8, 0.5] });
    expect(r.sampleCountScaleMin).toBe(0.5);
    expect(r.sampleCountScaleMax).toBe(8);
  });

  it("hdrDomain 은 알 수 없는 값이면 기본(log1p)으로 되돌린다", () => {
    expect(resolveStudioDenoiseOptions({ hdrDomain: "linear" }).hdrDomain).toBe("linear");
    expect(
      resolveStudioDenoiseOptions({ hdrDomain: "srgb" as unknown as "linear" }).hdrDomain,
    ).toBe("log1p");
  });

  it("firefly 옵션을 부분 지정해도 나머지는 기본값을 유지한다", () => {
    const r = resolveStudioDenoiseOptions({ firefly: { minRatio: 5 } });
    expect(r.fireflyMinRatio).toBe(5);
    expect(r.fireflySigmas).toBe(STUDIO_DENOISE_DEFAULT_OPTIONS.fireflySigmas);
    expect(r.fireflyEnabled).toBe(true);
  });
});

describe("studio-denoise 계약 — 휘도", () => {
  it("Rec.709 계수를 쓴다", () => {
    expect(studioDenoiseLuminance(1, 0, 0)).toBeCloseTo(0.2126, 10);
    expect(studioDenoiseLuminance(0, 1, 0)).toBeCloseTo(0.7152, 10);
    expect(studioDenoiseLuminance(0, 0, 1)).toBeCloseTo(0.0722, 10);
    expect(studioDenoiseLuminance(1, 1, 1)).toBeCloseTo(1, 10);
  });
});
