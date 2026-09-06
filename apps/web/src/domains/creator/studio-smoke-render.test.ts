import { describe, expect, it } from "vitest";

import { STUDIO_SMOKE_CLOSED_BOUNDARY, createStudioSmokeState, studioSmokeCellIndex } from "./studio-smoke-grid";
import {
  DEFAULT_STUDIO_SMOKE_RENDER,
  STUDIO_SMOKE_ABSORPTION_RANGE,
  STUDIO_SMOKE_SUPERSAMPLE_RANGE,
  computeStudioSmokeShadowField,
  normalizeStudioSmokeRenderOptions,
  renderStudioSmokeVolume,
} from "./studio-smoke-render";

import type { StudioSmokeState } from "./studio-smoke-grid";

// normalizeStudioSmokeRenderOptions 의 samplesPerCell 하한(테스트 가독용 별칭).
const STUDIO_SMOKE_SAMPLES_MIN = 1;

function blobState(density = 1, temperature = 0): StudioSmokeState {
  const state = createStudioSmokeState({ nx: 16, ny: 16, nz: 16, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
  const { spec, fields } = state;
  for (let k = 4; k < 12; k += 1) {
    for (let j = 4; j < 12; j += 1) {
      for (let i = 4; i < 12; i += 1) {
        const cell = studioSmokeCellIndex(spec, i, j, k);
        fields.density[cell] = density;
        fields.temperature[cell] = temperature;
      }
    }
  }
  return state;
}

function maxAlpha(image: { data: Uint8ClampedArray }): number {
  let max = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    if (image.data[index] > max) max = image.data[index];
  }
  return max;
}

function totalAlpha(image: { data: Uint8ClampedArray }): number {
  let sum = 0;
  for (let index = 3; index < image.data.length; index += 4) sum += image.data[index];
  return sum;
}

describe("studio-smoke-render: 기본 계약", () => {
  it("요청한 크기의 RGBA 버퍼를 만든다", () => {
    const image = renderStudioSmokeVolume(blobState(), { width: 40, height: 24 });
    expect(image.width).toBe(40);
    expect(image.height).toBe(24);
    expect(image.data.length).toBe(40 * 24 * 4);
    expect(image.data).toBeInstanceOf(Uint8ClampedArray);
  });

  it("빈 볼륨은 완전히 투명하다(모든 바이트 0)", () => {
    const empty = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    const image = renderStudioSmokeVolume(empty, { width: 16, height: 16 });
    expect(Array.from(image.data).every((value) => value === 0)).toBe(true);
  });

  it("premultiplied 불변식: 모든 픽셀에서 r,g,b ≤ a", () => {
    const image = renderStudioSmokeVolume(blobState(3, 4), {
      width: 32,
      height: 32,
      absorption: 4,
      emission: 3,
      scatter: 1.5,
    });
    for (let index = 0; index < image.data.length; index += 4) {
      const alpha = image.data[index + 3];
      expect(image.data[index]).toBeLessThanOrEqual(alpha);
      expect(image.data[index + 1]).toBeLessThanOrEqual(alpha);
      expect(image.data[index + 2]).toBeLessThanOrEqual(alpha);
    }
  });

  it("결정적이다 — 같은 입력이면 바이트 동일", () => {
    const state = blobState(2, 2);
    const options = { width: 24, height: 24, supersample: 2, shadowStrength: 1.5, samplesPerCell: 2 };
    const a = renderStudioSmokeVolume(state, options);
    const b = renderStudioSmokeVolume(state, options);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
});

describe("studio-smoke-render: 감쇠 단조성", () => {
  it("밀도가 커질수록 알파가 커진다", () => {
    const alphas = [0.25, 0.5, 1, 2, 4].map((density) =>
      totalAlpha(renderStudioSmokeVolume(blobState(density), { width: 24, height: 24 })),
    );
    for (let index = 1; index < alphas.length; index += 1) {
      expect(alphas[index]).toBeGreaterThan(alphas[index - 1]);
    }
  });

  it("흡수 계수가 커질수록 알파가 커지고 0 이면 완전 투명", () => {
    const state = blobState(1);
    expect(maxAlpha(renderStudioSmokeVolume(state, { width: 16, height: 16, absorption: 0 }))).toBe(0);
    const low = totalAlpha(renderStudioSmokeVolume(state, { width: 16, height: 16, absorption: 0.5 }));
    const high = totalAlpha(renderStudioSmokeVolume(state, { width: 16, height: 16, absorption: 5 }));
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
  });

  it("알파는 절대 255 를 넘지 않고 두꺼운 연기는 포화한다", () => {
    const image = renderStudioSmokeVolume(blobState(50), {
      width: 16,
      height: 16,
      absorption: STUDIO_SMOKE_ABSORPTION_RANGE.max,
    });
    expect(maxAlpha(image)).toBe(255);
    for (let index = 3; index < image.data.length; index += 4) {
      expect(image.data[index]).toBeLessThanOrEqual(255);
    }
  });
});

describe("studio-smoke-render: 방향·색", () => {
  it("이미지 위쪽이 격자 +y 다 — 위쪽에만 연기를 두면 상단 절반에 그려진다", () => {
    const state = createStudioSmokeState({ nx: 8, ny: 8, nz: 8, boundary: STUDIO_SMOKE_CLOSED_BOUNDARY });
    const { spec, fields } = state;
    for (let k = 0; k < 8; k += 1) {
      for (let j = 5; j < 8; j += 1) {
        for (let i = 0; i < 8; i += 1) fields.density[studioSmokeCellIndex(spec, i, j, k)] = 2;
      }
    }
    const image = renderStudioSmokeVolume(state, { width: 16, height: 16, absorption: 3 });
    let topAlpha = 0;
    let bottomAlpha = 0;
    for (let py = 0; py < 16; py += 1) {
      for (let px = 0; px < 16; px += 1) {
        const alpha = image.data[(py * 16 + px) * 4 + 3];
        if (py < 8) topAlpha += alpha;
        else bottomAlpha += alpha;
      }
    }
    expect(topAlpha).toBeGreaterThan(0);
    expect(bottomAlpha).toBe(0);
  });

  it("온도가 높으면 방출색(따뜻한 색)이 섞여 R 이 B 보다 커진다", () => {
    // 게인을 낮춰 채널 포화(255 클램프)를 피한다 — 포화하면 색 차이가 사라져 검증이 무의미해진다.
    const tone = { width: 16, height: 16, absorption: 3, scatter: 0.3, emission: 0.6 } as const;
    const cold = renderStudioSmokeVolume(blobState(2, 0), tone);
    const hot = renderStudioSmokeVolume(blobState(2, 5), tone);
    const center = (8 * 16 + 8) * 4;
    expect(hot.data[center]).toBeGreaterThan(cold.data[center]);
    // 기본 hotColor 는 주황이라 R > B 가 되어야 한다.
    expect(hot.data[center]).toBeGreaterThan(hot.data[center + 2]);
    // 온도 0 인 연기는 회백색이라 채널이 거의 같다.
    expect(Math.abs(cold.data[center] - cold.data[center + 2])).toBeLessThan(12);
  });

  it("scatter=0·emission=0 이면 색은 0 이지만 알파는 남는다(순수 그림자 연기)", () => {
    const image = renderStudioSmokeVolume(blobState(2, 5), {
      width: 16,
      height: 16,
      absorption: 3,
      scatter: 0,
      emission: 0,
    });
    expect(maxAlpha(image)).toBeGreaterThan(0);
    for (let index = 0; index < image.data.length; index += 4) {
      expect(image.data[index]).toBe(0);
      expect(image.data[index + 1]).toBe(0);
      expect(image.data[index + 2]).toBe(0);
    }
  });
});

describe("studio-smoke-render: 그림자", () => {
  it("그림자 필드는 최상단이 1 이고 아래로 갈수록 단조 감소한다", () => {
    const state = blobState(3);
    const light = computeStudioSmokeShadowField(state, 2);
    const { spec } = state;
    for (let k = 0; k < spec.nz; k += 1) {
      for (let i = 0; i < spec.nx; i += 1) {
        expect(light[studioSmokeCellIndex(spec, i, spec.ny - 1, k)]).toBe(1);
        for (let j = spec.ny - 2; j >= 0; j -= 1) {
          const above = light[studioSmokeCellIndex(spec, i, j + 1, k)];
          const here = light[studioSmokeCellIndex(spec, i, j, k)];
          expect(here).toBeLessThanOrEqual(above);
          expect(here).toBeGreaterThan(0);
        }
      }
    }
  });

  it("그림자를 켜면 연기가 어두워지지만 알파는 그대로다(흡수와 무관)", () => {
    const state = blobState(3);
    const flat = renderStudioSmokeVolume(state, { width: 20, height: 20, absorption: 3, shadowStrength: 0 });
    const shaded = renderStudioSmokeVolume(state, { width: 20, height: 20, absorption: 3, shadowStrength: 3 });
    let flatLuma = 0;
    let shadedLuma = 0;
    for (let index = 0; index < flat.data.length; index += 4) {
      flatLuma += flat.data[index] + flat.data[index + 1] + flat.data[index + 2];
      shadedLuma += shaded.data[index] + shaded.data[index + 1] + shaded.data[index + 2];
    }
    expect(shadedLuma).toBeLessThan(flatLuma);
    expect(totalAlpha(shaded)).toBe(totalAlpha(flat));
  });
});

describe("studio-smoke-render: 옵션 정규화", () => {
  it("누락 옵션은 기본값으로 채워진다", () => {
    const resolved = normalizeStudioSmokeRenderOptions({ width: 10, height: 10 });
    expect(resolved.absorption).toBe(DEFAULT_STUDIO_SMOKE_RENDER.absorption);
    expect(resolved.supersample).toBe(DEFAULT_STUDIO_SMOKE_RENDER.supersample);
    expect(resolved.samplesPerCell).toBe(DEFAULT_STUDIO_SMOKE_RENDER.samplesPerCell);
  });

  it("비유한/범위 밖 값은 흡수·클램프된다", () => {
    const resolved = normalizeStudioSmokeRenderOptions({
      width: Number.NaN,
      height: -4,
      absorption: 1e9,
      supersample: 99,
      samplesPerCell: 0.2,
    });
    expect(resolved.width).toBe(1);
    expect(resolved.height).toBe(1);
    expect(resolved.absorption).toBe(STUDIO_SMOKE_ABSORPTION_RANGE.max);
    expect(resolved.supersample).toBe(STUDIO_SMOKE_SUPERSAMPLE_RANGE.max);
    expect(resolved.samplesPerCell).toBe(STUDIO_SMOKE_SAMPLES_MIN);
  });

  it("temperatureRange 는 t1 > t0 을 보장한다(0 나눗셈 방지)", () => {
    const resolved = normalizeStudioSmokeRenderOptions({ width: 4, height: 4, temperatureRange: [2, 2] });
    expect(resolved.temperatureRange[1]).toBeGreaterThan(resolved.temperatureRange[0]);
    const reversed = normalizeStudioSmokeRenderOptions({ width: 4, height: 4, temperatureRange: [5, 1] });
    expect(reversed.temperatureRange[1]).toBeGreaterThan(reversed.temperatureRange[0]);
  });

  it("색 배열이 아니거나 성분이 비유한이면 기본 색으로 되돌린다", () => {
    const resolved = normalizeStudioSmokeRenderOptions({
      width: 4,
      height: 4,
      smokeColor: "white" as never,
      hotColor: [Number.NaN, 999, -5] as never,
    });
    expect(resolved.smokeColor).toEqual(DEFAULT_STUDIO_SMOKE_RENDER.smokeColor);
    expect(resolved.hotColor[0]).toBe(DEFAULT_STUDIO_SMOKE_RENDER.hotColor[0]);
    expect(resolved.hotColor[1]).toBe(255);
    expect(resolved.hotColor[2]).toBe(0);
  });

  it("슈퍼샘플을 올려도 결과가 유효 범위 안이고 알파가 폭주하지 않는다", () => {
    const state = blobState(2);
    // 해상도가 낮으면 경계 픽셀 비중이 커서 안티에일리어싱 차이가 과대평가된다(12² 에서 23%).
    const plain = renderStudioSmokeVolume(state, { width: 48, height: 48, absorption: 2, supersample: 1 });
    const superSampled = renderStudioSmokeVolume(state, {
      width: 48,
      height: 48,
      absorption: 2,
      supersample: 3,
    });
    expect(maxAlpha(superSampled)).toBeLessThanOrEqual(255);
    // 같은 볼륨이라 총 알파가 크게 달라지면 안 된다(경계 안티에일리어싱 정도만).
    expect(Math.abs(totalAlpha(superSampled) - totalAlpha(plain)) / totalAlpha(plain)).toBeLessThan(0.15);
  });

  it("samplesPerCell 을 올리면 결과가 수렴한다(적분 정확도)", () => {
    const state = blobState(2);
    const alphas = [1, 2, 4, 8].map((samplesPerCell) =>
      totalAlpha(renderStudioSmokeVolume(state, { width: 12, height: 12, absorption: 2, samplesPerCell })),
    );
    const gapLow = Math.abs(alphas[1] - alphas[0]);
    const gapHigh = Math.abs(alphas[3] - alphas[2]);
    expect(gapHigh).toBeLessThanOrEqual(gapLow);
  });
});
