import { beforeEach, describe, expect, it } from "vitest";

import { buildStudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";
import {
  DEFAULT_STUDIO_PAPER_SURFACE,
  acquireStudioPaperGranulationTile,
  clearStudioPaperGranulationTileCache,
  resolveStudioPaperGranulationAlphaMultiplierAt,
} from "./studio-paper-granulation-runtime";
import { composeStudioPaperTipAlphaMap } from "./studio-paper-tip-composition";

const RESPONSE = { granulation: 0.7, staining: 0.04, scale: 1.5 } as const;

beforeEach(() => {
  clearStudioPaperGranulationTileCache();
});

function tile() {
  return acquireStudioPaperGranulationTile(DEFAULT_STUDIO_PAPER_SURFACE, RESPONSE)!;
}

const DAB = {
  scale: RESPONSE.scale,
  centerX: 137.25,
  centerY: 88.5,
  radiusX: 33,
  radiusY: 27,
  angleRadians: 0.6,
} as const;

describe("tip x paper composition", () => {
  it("matches the reference document-space sampler texel for texel", () => {
    const tip = buildStudioBrushTipAlphaMap({ shape: "hard", softness: 0.38 });
    const composed = composeStudioPaperTipAlphaMap({ tip, tile: tile(), ...DAB })!;
    expect(composed.size).toBe(tip.size);

    const cosine = Math.cos(DAB.angleRadians);
    const sine = Math.sin(DAB.angleRadians);
    let worst = 0;
    for (let y = 0; y < tip.size; y += 7) {
      const unitY = ((y + 0.5) / tip.size) * 2 - 1;
      for (let x = 0; x < tip.size; x += 7) {
        const index = y * tip.size + x;
        const tipAlpha = tip.alphas[index]!;
        if (tipAlpha <= 0) continue;
        const unitX = ((x + 0.5) / tip.size) * 2 - 1;
        const localX = unitX * DAB.radiusX;
        const localY = unitY * DAB.radiusY;
        // 인라인 아핀 루프는 이 참조식과 같은 답을 내야 한다 — 상수 인자만 다르다.
        const expected = Math.min(
          1,
          tipAlpha
          * resolveStudioPaperGranulationAlphaMultiplierAt(
            tile(),
            DAB.centerX + localX * cosine - localY * sine,
            DAB.centerY + localX * sine + localY * cosine,
            DAB.scale,
          ),
        );
        worst = Math.max(worst, Math.abs(composed.alphas[index]! - expected));
      }
    }
    expect(worst).toBeLessThan(1e-5);
  });

  it("leaves the tip footprint untouched — paper redistributes, never creates", () => {
    const tip = buildStudioBrushTipAlphaMap({ shape: "grain", softness: 0.4 });
    const composed = composeStudioPaperTipAlphaMap({ tip, tile: tile(), ...DAB })!;
    let zerosPreserved = 0;
    let modulated = 0;
    for (let index = 0; index < tip.alphas.length; index += 1) {
      if (tip.alphas[index]! <= 0) {
        // 팁이 비어 있던 자리에 종이가 안료를 만들어 내면 획의 모양이 바뀐다.
        expect(composed.alphas[index]).toBe(0);
        zerosPreserved += 1;
      } else if (composed.alphas[index] !== tip.alphas[index]) {
        modulated += 1;
      }
    }
    expect(zerosPreserved).toBeGreaterThan(0);
    expect(modulated).toBeGreaterThan(tip.alphas.length / 4);
  });

  it("redistributes rather than darkens: the footprint mean barely moves", () => {
    const tip = buildStudioBrushTipAlphaMap({ shape: "hard", softness: 0.38 });
    const composed = composeStudioPaperTipAlphaMap({ tip, tile: tile(), ...DAB })!;
    let before = 0;
    let after = 0;
    let variance = 0;
    for (let index = 0; index < tip.alphas.length; index += 1) {
      before += tip.alphas[index]!;
      after += composed.alphas[index]!;
      variance += (composed.alphas[index]! - tip.alphas[index]!) ** 2;
    }
    // dab 하나는 타일 전체가 아니라 그 일부만 덮으므로 평균 보존은 근사다. 10% 이내면
    // "종이가 안료를 옮겼다"이고, 그 이상이면 "종이가 획을 어둡게 만들었다"이다.
    expect(Math.abs(after / before - 1)).toBeLessThan(0.1);
    // 그러면서 실제로 변조는 일어나야 한다.
    expect(variance).toBeGreaterThan(0);
  });

  it("is deterministic and gives equal content an equal revision", () => {
    const tip = buildStudioBrushTipAlphaMap({ shape: "hard", softness: 0.38 });
    const first = composeStudioPaperTipAlphaMap({ tip, tile: tile(), ...DAB })!;
    const second = composeStudioPaperTipAlphaMap({ tip, tile: tile(), ...DAB })!;
    expect(second.revision).toBe(first.revision);
    expect(Array.from(second.alphas)).toEqual(Array.from(first.alphas));
    const moved = composeStudioPaperTipAlphaMap({
      tip,
      tile: tile(),
      ...DAB,
      centerX: DAB.centerX + 37,
    })!;
    // 문서 좌표가 달라지면 결도 달라지고 리비전도 달라져야 스탬프 캐시가 오염되지 않는다.
    expect(moved.revision).not.toBe(first.revision);
    expect(Array.from(moved.alphas)).not.toEqual(Array.from(first.alphas));
  });

  it("rejects degenerate geometry instead of emitting a silently wrong stamp", () => {
    const tip = buildStudioBrushTipAlphaMap({ shape: "hard", softness: 0.38 });
    for (const override of [
      { radiusX: 0 },
      { radiusY: -3 },
      { centerX: Number.NaN },
      { angleRadians: Number.POSITIVE_INFINITY },
    ]) {
      expect(
        composeStudioPaperTipAlphaMap({ tip, tile: tile(), ...DAB, ...override }),
      ).toBeNull();
    }
  });
});
