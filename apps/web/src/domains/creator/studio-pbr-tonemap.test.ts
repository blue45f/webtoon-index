import { describe, expect, it } from "vitest";

import {
  STUDIO_PBR_ACES_CEILING,
  applyStudioPbrToneMap,
  invertStudioPbrToneMap,
  studioPbrAcesChannel,
  studioPbrAcesChannelInverse,
  studioPbrNeutral,
  studioPbrNeutralInverse,
  studioPbrToneBandThresholds,
  type StudioPbrRgb,
  type StudioPbrToneMapMode,
} from "./studio-pbr-tonemap";

const MODES: StudioPbrToneMapMode[] = ["none", "neutral", "aces"];

/** 회색·유채색·고대비를 섞은 왕복 프로브. */
const PROBES: StudioPbrRgb[] = [
  [0, 0, 0],
  [0.01, 0.01, 0.01],
  [0.05, 0.02, 0.09],
  [0.18, 0.18, 0.18],
  [0.5, 0.5, 0.5],
  [0.9, 0.4, 0.1],
  [1, 1, 1],
  [2.5, 1.2, 0.3],
  [6, 6, 6],
  [12, 3, 0.8],
];

describe("studio-pbr-tonemap: none", () => {
  it("노출만 곱하고 커브는 없다", () => {
    expect(applyStudioPbrToneMap([0.3, 0.5, 0.7], { mode: "none", exposure: 2 })).toEqual([0.6, 1, 1.4]);
  });

  it("왕복이 정확하다", () => {
    for (const probe of PROBES) {
      const mapped = applyStudioPbrToneMap(probe, { mode: "none", exposure: 1.7 });
      const back = invertStudioPbrToneMap(mapped, { mode: "none", exposure: 1.7 });
      for (let c = 0; c < 3; c += 1) expect(back[c]).toBeCloseTo(probe[c], 12);
    }
  });
});

describe("studio-pbr-tonemap: aces(Narkowicz 피팅)", () => {
  it("0 에서 0, 상한이 2.51/2.43 이다", () => {
    expect(studioPbrAcesChannel(0)).toBe(0);
    expect(STUDIO_PBR_ACES_CEILING).toBeCloseTo(2.51 / 2.43, 15);
    expect(studioPbrAcesChannel(1e6)).toBeLessThan(STUDIO_PBR_ACES_CEILING);
    expect(studioPbrAcesChannel(1e6)).toBeGreaterThan(STUDIO_PBR_ACES_CEILING - 1e-3);
  });

  it("[0,∞) 에서 단조 증가한다", () => {
    let previous = -1;
    for (let i = 0; i <= 400; i += 1) {
      const x = (i / 400) * 20;
      const y = studioPbrAcesChannel(x);
      expect(y).toBeGreaterThan(previous);
      previous = y;
    }
  });

  it("채널별 닫힌 형태 역함수가 정확하다", () => {
    for (let i = 0; i <= 200; i += 1) {
      const x = (i / 200) * 16;
      const y = studioPbrAcesChannel(x);
      expect(studioPbrAcesChannelInverse(y)).toBeCloseTo(x, 9);
    }
  });

  it("커브 상한 이상은 Infinity 를 돌려준다(정보 소실 구간)", () => {
    expect(studioPbrAcesChannelInverse(STUDIO_PBR_ACES_CEILING)).toBe(Number.POSITIVE_INFINITY);
    expect(studioPbrAcesChannelInverse(2)).toBe(Number.POSITIVE_INFINITY);
    expect(studioPbrAcesChannelInverse(0)).toBe(0);
  });

  it("1.0 을 넘길 수 있다 — forward 가 클램프하지 않는다는 계약", () => {
    expect(studioPbrAcesChannel(50)).toBeGreaterThan(1);
  });
});

describe("studio-pbr-tonemap: neutral(Khronos PBR Neutral)", () => {
  it("압축 임계 아래에서는 toe 오프셋만 뺀다", () => {
    // 어두운 값: min 채널이 0.08 미만이라 offset = x - 6.25x².
    const input: StudioPbrRgb = [0.05, 0.06, 0.07];
    const out = studioPbrNeutral(input);
    const offset = 0.05 - 6.25 * 0.05 * 0.05;
    expect(out[0]).toBeCloseTo(0.05 - offset, 12);
    expect(out[1]).toBeCloseTo(0.06 - offset, 12);
    expect(out[2]).toBeCloseTo(0.07 - offset, 12);
  });

  it("아무리 밝아도 1 을 넘지 않는다(하이라이트 롤오프)", () => {
    for (const value of [1, 4, 20, 1000]) {
      const out = studioPbrNeutral([value, value, value]);
      expect(Math.max(...out)).toBeLessThan(1);
      expect(Math.max(...out)).toBeGreaterThan(0.75);
    }
  });

  it("압축 구간에서 하이라이트가 실제로 탈채도된다", () => {
    const saturated: StudioPbrRgb = [8, 1, 0.2];
    const out = studioPbrNeutral(saturated);
    const inputRatio = saturated[1] / saturated[0];
    const outputRatio = out[1] / out[0];
    // 채널 비가 1 쪽으로 끌려와야 한다(흰색으로 수렴).
    expect(outputRatio).toBeGreaterThan(inputRatio);
  });

  it("스칼라 입력에 대해 단조 증가한다", () => {
    let previous = -1;
    for (let i = 0; i <= 400; i += 1) {
      const x = (i / 400) * 20;
      const value = studioPbrNeutral([x, x, x])[0];
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });

  it("해석적 역함수가 유채색까지 정확히 되돌린다", () => {
    for (const probe of PROBES) {
      const out = studioPbrNeutral(probe);
      const back = studioPbrNeutralInverse(out);
      for (let c = 0; c < 3; c += 1) expect(back[c]).toBeCloseTo(probe[c], 6);
    }
  });

  it("역함수가 압축/비압축 분기를 정확히 가른다", () => {
    // 임계 바로 아래/위를 각각 통과시켜 두 분기가 모두 왕복하는지 본다.
    for (const value of [0.7, 0.79, 0.8, 0.81, 1.2]) {
      const out = studioPbrNeutral([value, value, value]);
      const back = studioPbrNeutralInverse(out);
      expect(back[0]).toBeCloseTo(value, 6);
    }
  });
});

describe("studio-pbr-tonemap: 공개 API 왕복", () => {
  it("세 모드 모두 노출을 포함해 왕복한다", () => {
    for (const mode of MODES) {
      for (const exposure of [0.5, 1, 2.2]) {
        for (const probe of PROBES) {
          const mapped = applyStudioPbrToneMap(probe, { mode, exposure });
          const back = invertStudioPbrToneMap(mapped, { mode, exposure });
          for (let c = 0; c < 3; c += 1) {
            expect(back[c]).toBeCloseTo(probe[c], mode === "none" ? 12 : 5);
          }
        }
      }
    }
  });

  it("모든 모드가 스칼라 입력에 대해 단조다", () => {
    for (const mode of MODES) {
      let previous = -1;
      for (let i = 0; i <= 200; i += 1) {
        const x = (i / 200) * 12;
        const value = applyStudioPbrToneMap([x, x, x], { mode, exposure: 1 })[0];
        expect(value).toBeGreaterThan(previous);
        previous = value;
      }
    }
  });

  it("잘못된 노출은 던진다", () => {
    expect(() => applyStudioPbrToneMap([1, 1, 1], { mode: "aces", exposure: 0 })).toThrow();
    expect(() => applyStudioPbrToneMap([1, 1, 1], { mode: "aces", exposure: -1 })).toThrow();
    expect(() => applyStudioPbrToneMap([1, 1, 1], { mode: "aces", exposure: Number.NaN })).toThrow();
  });
});

describe("studio-pbr-tonemap: cel 밴드 경계 역산", () => {
  it("경계 개수가 levels-1 이고 단조 증가한다", () => {
    const thresholds = studioPbrToneBandThresholds(5, { mode: "aces", exposure: 1 });
    expect(thresholds.length).toBe(4);
    for (let i = 1; i < thresholds.length; i += 1) {
      expect(thresholds[i]).toBeGreaterThan(thresholds[i - 1]);
    }
  });

  it("none 모드에서 경계가 정확히 표시값/노출이다", () => {
    const thresholds = studioPbrToneBandThresholds(4, { mode: "none", exposure: 2 });
    expect(thresholds[0]).toBeCloseTo(0.25 / 2, 12);
    expect(thresholds[1]).toBeCloseTo(0.5 / 2, 12);
    expect(thresholds[2]).toBeCloseTo(0.75 / 2, 12);
  });

  it("노출을 올리면 모든 밴드 경계의 선형 광량이 낮아진다(스크린톤이 밝아짐)", () => {
    const low = studioPbrToneBandThresholds(5, { mode: "aces", exposure: 1 });
    const high = studioPbrToneBandThresholds(5, { mode: "aces", exposure: 3 });
    for (let i = 0; i < low.length; i += 1) {
      expect(high[i]).toBeLessThan(low[i]);
    }
  });

  it("역산한 경계를 다시 톤매핑하면 원래 표시값이 나온다", () => {
    for (const mode of MODES) {
      const levels = 6;
      const thresholds = studioPbrToneBandThresholds(levels, { mode, exposure: 1.4 });
      for (let i = 0; i < thresholds.length; i += 1) {
        const linear = thresholds[i];
        const display = applyStudioPbrToneMap([linear, linear, linear], { mode, exposure: 1.4 })[0];
        expect(display).toBeCloseTo((i + 1) / levels, 6);
      }
    }
  });

  it("levels 가 2 미만이면 던진다", () => {
    expect(() => studioPbrToneBandThresholds(1, { mode: "none" })).toThrow();
  });
});
