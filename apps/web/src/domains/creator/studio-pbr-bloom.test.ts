import { describe, expect, it } from "vitest";

import {
  STUDIO_PBR_BLOOM_DOWNSAMPLE_TAPS,
  STUDIO_PBR_BLOOM_SAFE_PASSES,
  STUDIO_PBR_BLOOM_UPSAMPLE_TAPS,
  buildStudioPbrBloomChain,
  composeStudioPbrBloom,
  downsampleStudioPbrBloom,
  extractStudioPbrBloomBright,
  studioPbrBloomKneeWeight,
  upsampleStudioPbrBloom,
  type StudioPbrBloomImage,
} from "./studio-pbr-bloom";

function uniformImage(width: number, height: number, value: number): StudioPbrBloomImage {
  return { width, height, rgb: new Float32Array(width * height * 3).fill(value) };
}

function deltaImage(width: number, height: number, x: number, y: number, value: number): StudioPbrBloomImage {
  const rgb = new Float32Array(width * height * 3);
  const i = (y * width + x) * 3;
  rgb[i] = value;
  rgb[i + 1] = value;
  rgb[i + 2] = value;
  return { width, height, rgb };
}

function totalEnergy(image: StudioPbrBloomImage): number {
  let sum = 0;
  for (let i = 0; i < image.rgb.length; i += 3) sum += image.rgb[i];
  return sum;
}

describe("studio-pbr-bloom: 소프트 니 커브", () => {
  const params = { threshold: 1, knee: 0.5 };

  it("threshold-knee 아래는 정확히 0 이다", () => {
    for (const br of [0, 0.1, 0.4, 0.5]) {
      expect(studioPbrBloomKneeWeight(br, params)).toBe(0);
    }
  });

  it("threshold+knee 위는 정확히 (br-threshold)/br 이다", () => {
    for (const br of [1.5, 2, 5, 20]) {
      expect(studioPbrBloomKneeWeight(br, params)).toBeCloseTo((br - params.threshold) / br, 12);
    }
  });

  it("니 구간은 0 과 하드 커브 사이를 연속으로 잇는다", () => {
    // 경계에서 좌우 극한이 만나야 한다(불연속 = 밴딩).
    const belowKnee = studioPbrBloomKneeWeight(0.5 - 1e-9, params);
    const atKneeStart = studioPbrBloomKneeWeight(0.5 + 1e-9, params);
    expect(Math.abs(atKneeStart - belowKnee)).toBeLessThan(1e-8);
    const atKneeEnd = studioPbrBloomKneeWeight(1.5, params);
    expect(atKneeEnd).toBeCloseTo(0.5 / 1.5, 12);
    // 임계 정확히 위에서는 하드 컷과 달리 이미 0 보다 크다(소프트).
    expect(studioPbrBloomKneeWeight(1, params)).toBeGreaterThan(0);
  });

  it("knee 0 은 하드 컷이다 — 임계 아래 0, 위는 즉시 하드 커브", () => {
    const hard = { threshold: 1, knee: 0 };
    expect(studioPbrBloomKneeWeight(0.999, hard)).toBe(0);
    expect(studioPbrBloomKneeWeight(1, hard)).toBe(0);
    expect(studioPbrBloomKneeWeight(2, hard)).toBeCloseTo(0.5, 12);
  });

  it("밝기에 대해 단조 증가하고 1 을 넘지 않는다", () => {
    let previous = -1;
    for (let i = 0; i <= 400; i += 1) {
      const br = (i / 400) * 10;
      const w = studioPbrBloomKneeWeight(br, params);
      expect(w).toBeGreaterThanOrEqual(previous);
      expect(w).toBeLessThan(1);
      previous = w;
    }
  });
});

describe("studio-pbr-bloom: 밝기 추출", () => {
  it("임계 아래 이미지는 전부 정확히 0 이다", () => {
    const bright = extractStudioPbrBloomBright(uniformImage(8, 8, 0.3), { threshold: 1, knee: 0.2 });
    for (let i = 0; i < bright.rgb.length; i += 1) expect(bright.rgb[i]).toBe(0);
  });

  it("색상비를 보존한 채 계수만 곱한다", () => {
    const rgb = new Float32Array([4, 2, 1]);
    const bright = extractStudioPbrBloomBright({ width: 1, height: 1, rgb }, { threshold: 1, knee: 0 });
    // 밝기 척도는 max(r,g,b)=4 → weight = 3/4.
    expect(bright.rgb[0]).toBeCloseTo(3, 12);
    expect(bright.rgb[1]).toBeCloseTo(1.5, 12);
    expect(bright.rgb[2]).toBeCloseTo(0.75, 12);
    expect(bright.rgb[1] / bright.rgb[0]).toBeCloseTo(2 / 4, 12);
  });

  it("채도 높은 단색 네온이 살아남는다(휘도 기준이 아니라 max 기준)", () => {
    // 순수 파랑 (0,0,3): 휘도 기준이면 0.21 정도라 임계 1 을 못 넘어 사라진다.
    const neon = new Float32Array([0, 0, 3]);
    const bright = extractStudioPbrBloomBright({ width: 1, height: 1, rgb: neon }, { threshold: 1, knee: 0 });
    expect(bright.rgb[2]).toBeCloseTo(2, 12);
  });

  it("해상도/길이 불일치는 던진다", () => {
    expect(() =>
      extractStudioPbrBloomBright({ width: 4, height: 4, rgb: new Float32Array(10) }, { threshold: 1, knee: 0 }),
    ).toThrow();
  });
});

describe("studio-pbr-bloom: 리샘플 커널", () => {
  it("13탭 다운샘플 가중치 합이 정확히 1 이다", () => {
    const total = STUDIO_PBR_BLOOM_DOWNSAMPLE_TAPS.reduce((sum, tap) => sum + tap[2], 0);
    expect(total).toBeCloseTo(1, 12);
    expect(STUDIO_PBR_BLOOM_DOWNSAMPLE_TAPS.length).toBe(13);
  });

  it("9탭 텐트 업샘플 가중치 합이 정확히 1 이다", () => {
    const total = STUDIO_PBR_BLOOM_UPSAMPLE_TAPS.reduce((sum, tap) => sum + tap[2], 0);
    expect(total).toBeCloseTo(1, 12);
    expect(STUDIO_PBR_BLOOM_UPSAMPLE_TAPS.length).toBe(9);
  });

  it("균일 필드가 다운샘플·업샘플을 지나도 정확히 보존된다", () => {
    const source = uniformImage(16, 16, 2.5);
    const down = downsampleStudioPbrBloom(source);
    expect(down.width).toBe(8);
    expect(down.height).toBe(8);
    for (let i = 0; i < down.rgb.length; i += 1) expect(down.rgb[i]).toBeCloseTo(2.5, 6);
    const up = upsampleStudioPbrBloom(down, 16, 16);
    for (let i = 0; i < up.rgb.length; i += 1) expect(up.rgb[i]).toBeCloseTo(2.5, 6);
  });

  it("델타를 다운샘플하면 실제로 퍼진다(단일 텍셀이 아니게 된다)", () => {
    const source = deltaImage(16, 16, 8, 8, 1);
    const down = downsampleStudioPbrBloom(source);
    let nonZero = 0;
    for (let i = 0; i < down.rgb.length; i += 3) if (down.rgb[i] > 0) nonZero += 1;
    expect(nonZero).toBeGreaterThan(1);
    // 13탭 중 델타를 잡는 탭의 가중치만 남으므로 총합 ≤ 1.
    expect(totalEnergy(down)).toBeGreaterThan(0);
    expect(totalEnergy(down)).toBeLessThanOrEqual(1 + 1e-6);
  });

  it("최소 해상도에서 1×1 아래로 내려가지 않는다", () => {
    const down = downsampleStudioPbrBloom(uniformImage(1, 1, 1));
    expect(down.width).toBe(1);
    expect(down.height).toBe(1);
  });
});

describe("studio-pbr-bloom: 체인 · 합성", () => {
  it("체인 해상도가 절반씩 줄고 조기 종료한다", () => {
    const chain = buildStudioPbrBloomChain(uniformImage(32, 32, 1), 8);
    expect(chain[0].width).toBe(32);
    expect(chain[1].width).toBe(16);
    expect(chain[2].width).toBe(8);
    // 2 이하가 되면 멈춘다 — 8 레벨을 요구해도 그만큼 안 만든다.
    expect(chain.length).toBeLessThan(8);
    for (const mip of chain) expect(mip.width).toBeGreaterThan(1);
  });

  it("intensity 0 은 원본과 바이트 동일한 복사본이다(항등)", () => {
    const hdr = uniformImage(8, 8, 1.25);
    hdr.rgb[7] = 9;
    const chain = buildStudioPbrBloomChain(extractStudioPbrBloomBright(hdr, { threshold: 1, knee: 0.5 }), 3);
    const composed = composeStudioPbrBloom(hdr, chain, { intensity: 0 });
    expect(Array.from(composed.rgb)).toEqual(Array.from(hdr.rgb));
    expect(composed.rgb).not.toBe(hdr.rgb);
  });

  it("intensity 가 커질수록 결과가 단조로 밝아진다", () => {
    const hdr = deltaImage(16, 16, 8, 8, 12);
    const chain = buildStudioPbrBloomChain(extractStudioPbrBloomBright(hdr, { threshold: 1, knee: 0.5 }), 3);
    const energies = [0, 0.3, 0.7, 1.5].map((intensity) =>
      totalEnergy(composeStudioPbrBloom(hdr, chain, { intensity })),
    );
    for (let i = 1; i < energies.length; i += 1) expect(energies[i]).toBeGreaterThan(energies[i - 1]);
  });

  it("밝은 점 주변으로 실제 헤일로가 생긴다 — 웹툰 LT 패스에서 블룸이 해로운 이유", () => {
    const hdr = deltaImage(16, 16, 8, 8, 12);
    const chain = buildStudioPbrBloomChain(extractStudioPbrBloomBright(hdr, { threshold: 1, knee: 0.5 }), 3);
    const composed = composeStudioPbrBloom(hdr, chain, { intensity: 1 });
    const neighbour = composed.rgb[(8 * 16 + 10) * 3];
    // 원래 0 이던 이웃 픽셀에 빛이 번져 나온다 = 선 경계를 넘어간다.
    expect(hdr.rgb[(8 * 16 + 10) * 3]).toBe(0);
    expect(neighbour).toBeGreaterThan(0);
  });

  it("levelBlend 를 키우면 더 넓게 퍼진다", () => {
    const hdr = deltaImage(32, 32, 16, 16, 20);
    const chain = buildStudioPbrBloomChain(extractStudioPbrBloomBright(hdr, { threshold: 1, knee: 0.5 }), 4);
    const spreadOf = (levelBlend: number): number => {
      const composed = composeStudioPbrBloom(hdr, chain, { intensity: 1, levelBlend });
      let count = 0;
      for (let i = 0; i < composed.rgb.length; i += 3) if (composed.rgb[i] > 1e-4) count += 1;
      return count;
    };
    expect(spreadOf(0.9)).toBeGreaterThanOrEqual(spreadOf(0.1));
  });

  it("LT 계열 패스는 안전 목록에서 명시적으로 빠져 있다", () => {
    expect(STUDIO_PBR_BLOOM_SAFE_PASSES).toContain("beauty");
    expect(STUDIO_PBR_BLOOM_SAFE_PASSES).toContain("color");
    expect(STUDIO_PBR_BLOOM_SAFE_PASSES).not.toContain("main-line");
    expect(STUDIO_PBR_BLOOM_SAFE_PASSES).not.toContain("texture-line");
    expect(STUDIO_PBR_BLOOM_SAFE_PASSES).not.toContain("tone");
  });

  it("잘못된 levels·빈 체인은 던진다", () => {
    expect(() => buildStudioPbrBloomChain(uniformImage(8, 8, 1), 0)).toThrow();
    expect(() => composeStudioPbrBloom(uniformImage(8, 8, 1), [], { intensity: 1 })).toThrow();
  });
});
