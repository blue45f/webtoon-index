import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAPER_GRAIN_KIND,
  PAPER_GRAIN_KINDS,
  PAPER_REFERENCE_TILE,
  PAPER_TEXTURE_PRESETS,
  PIGMENT_GRANULATION_PROFILES,
  accumulateEdgeDarkening,
  createPaperGranulationGain,
  createPaperHeightField,
  dryWashOnPaper,
  normalizePaperGrainKind,
  normalizePaperTextureParams,
  samplePaperHeight,
  settlePigmentOnPaper,
} from "./studio-paper-texture";

function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < values.length; index++) sum += values[index]!;
  return sum / values.length;
}

function spread(values: ArrayLike<number>): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < values.length; index++) {
    min = Math.min(min, values[index]!);
    max = Math.max(max, values[index]!);
  }
  return max - min;
}

describe("종이 종류 정규화", () => {
  it("알 수 없는 값은 기본 종이(중목)로 되돌린다", () => {
    expect(normalizePaperGrainKind("rough")).toBe("rough");
    expect(normalizePaperGrainKind("hot-press")).toBe("hot-press");
    expect(normalizePaperGrainKind("washi")).toBe("washi");
    expect(normalizePaperGrainKind("papyrus")).toBe(DEFAULT_PAPER_GRAIN_KIND);
    expect(normalizePaperGrainKind(undefined)).toBe(DEFAULT_PAPER_GRAIN_KIND);
    expect(normalizePaperGrainKind(7)).toBe(DEFAULT_PAPER_GRAIN_KIND);
    expect(DEFAULT_PAPER_GRAIN_KIND).toBe("cold-press");
  });

  it("수채 3종은 결의 굵기·진폭이 단조롭게 커지고, 확장 카탈로그도 프리셋을 갖는다", () => {
    expect(PAPER_GRAIN_KINDS).toContain("hot-press");
    expect(PAPER_GRAIN_KINDS).toContain("cold-press");
    expect(PAPER_GRAIN_KINDS).toContain("rough");
    expect(PAPER_GRAIN_KINDS).toContain("sanded-pastel");
    expect(PAPER_GRAIN_KINDS).toContain("linen-canvas");
    expect(PAPER_GRAIN_KINDS).toContain("rice-paper");
    expect(PAPER_GRAIN_KINDS.length).toBeGreaterThanOrEqual(18);
    const hot = PAPER_TEXTURE_PRESETS["hot-press"];
    const cold = PAPER_TEXTURE_PRESETS["cold-press"];
    const rough = PAPER_TEXTURE_PRESETS.rough;
    // baseCells가 작을수록 결이 굵다.
    expect(hot.baseCells).toBeGreaterThan(cold.baseCells);
    expect(cold.baseCells).toBeGreaterThan(rough.baseCells);
    expect(hot.amplitude).toBeLessThan(cold.amplitude);
    expect(cold.amplitude).toBeLessThan(rough.amplitude);
    for (const kind of PAPER_GRAIN_KINDS) {
      expect(PAPER_TEXTURE_PRESETS[kind]).toBeDefined();
      const field = createPaperHeightField({ kind, width: 32, height: 32, seed: 7 });
      expect(field.values.length).toBe(32 * 32);
      expect(field.kind).toBe(kind);
    }
  });
});

describe("normalizePaperTextureParams", () => {
  it("범위 밖·무효 값은 클램프하고 정수 필드는 내림한다", () => {
    const base = PAPER_TEXTURE_PRESETS["cold-press"];
    expect(
      normalizePaperTextureParams(
        {
          octaves: 99,
          baseCells: 0,
          lacunarity: 1,
          persistence: 5,
          fibreAnisotropy: -3,
          amplitude: 12,
          toothBias: Number.NaN,
        },
        base,
      ),
    ).toEqual({
      octaves: 8,
      baseCells: 1,
      lacunarity: 2,
      persistence: 0.95,
      fibreAnisotropy: 0.25,
      amplitude: 1,
      toothBias: base.toothBias,
    });
  });

  it("null/누락은 베이스 프리셋 그대로다", () => {
    const base = PAPER_TEXTURE_PRESETS.rough;
    expect(normalizePaperTextureParams(null, base)).toEqual(base);
    expect(normalizePaperTextureParams(undefined, base)).toEqual(base);
  });
});

describe("createPaperHeightField", () => {
  it("기본값은 128px 정사각 중목 타일이다", () => {
    const field = createPaperHeightField();
    expect(field.kind).toBe("cold-press");
    expect(field.width).toBe(PAPER_REFERENCE_TILE);
    expect(field.height).toBe(PAPER_REFERENCE_TILE);
    expect(field.values.length).toBe(PAPER_REFERENCE_TILE * PAPER_REFERENCE_TILE);
  });

  it("height를 생략하면 정사각 타일이 되고 크기는 안전 범위로 클램프된다", () => {
    expect(createPaperHeightField({ width: 64 }).height).toBe(64);
    expect(createPaperHeightField({ width: 1 }).width).toBe(4);
    expect(createPaperHeightField({ width: Number.NaN }).width).toBe(PAPER_REFERENCE_TILE);
  });

  it("모든 높이는 0..1이고 매번 새 버퍼를 돌려준다", () => {
    const first = createPaperHeightField({ kind: "rough", seed: 7 });
    const second = createPaperHeightField({ kind: "rough", seed: 7 });
    expect(first.values).not.toBe(second.values);
    expect(Array.from(first.values)).toEqual(Array.from(second.values));
    for (const value of first.values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("params 덮어쓰기로 진폭을 0으로 만들면 완전 평탄한 종이가 된다", () => {
    const flat = createPaperHeightField({ kind: "rough", params: { amplitude: 0 } });
    expect(spread(flat.values)).toBe(0);
    expect(mean(flat.values)).toBeCloseTo(0.5, 6);
  });

  it("specialty papers keep unique structure while remaining seamless and deterministic", () => {
    for (const kind of ["canvas", "washi", "charcoal"] as const) {
      const a = createPaperHeightField({ kind, width: 48, height: 48, seed: 9 });
      const b = createPaperHeightField({ kind, width: 48, height: 48, seed: 9 });
      expect(Array.from(a.values)).toEqual(Array.from(b.values));
      expect(spread(a.values)).toBeGreaterThan(0.02);
      // Horizontal seam: first column equals last+1 wrap.
      for (let y = 0; y < 48; y++) {
        expect(samplePaperHeight(a, 0, y)).toBe(samplePaperHeight(a, 48, y));
        expect(samplePaperHeight(a, xSample(y), 0)).toBe(samplePaperHeight(a, xSample(y), 48));
      }
    }
    // Canvas weave should not collapse to cold-press statistics.
    const canvas = createPaperHeightField({ kind: "canvas", width: 64, seed: 3 });
    const cold = createPaperHeightField({ kind: "cold-press", width: 64, seed: 3 });
    let differing = 0;
    for (let i = 0; i < canvas.values.length; i++) {
      if (Math.abs(canvas.values[i]! - cold.values[i]!) > 1e-4) differing += 1;
    }
    expect(differing).toBeGreaterThan(canvas.values.length * 0.2);
  });

  it("정규화된 params를 그대로 노출해 프리셋 근거를 추적할 수 있다", () => {
    const field = createPaperHeightField({ kind: "hot-press", params: { octaves: 3 } });
    expect(field.params).toEqual({ ...PAPER_TEXTURE_PRESETS["hot-press"], octaves: 3 });
  });
});

function xSample(y: number): number {
  return (y * 7 + 3) % 48;
}

describe("samplePaperHeight", () => {
  it("양/음 방향 모두 주기 wrap 한다", () => {
    const field = createPaperHeightField({ width: 32, seed: 5 });
    for (const [x, y] of [
      [0, 0],
      [3, 29],
      [31, 17],
    ] as const) {
      const base = samplePaperHeight(field, x, y);
      expect(samplePaperHeight(field, x + 32, y)).toBe(base);
      expect(samplePaperHeight(field, x, y + 64)).toBe(base);
      expect(samplePaperHeight(field, x - 32, y - 32)).toBe(base);
    }
  });

  it("소수 좌표는 내림해 셀을 고른다", () => {
    const field = createPaperHeightField({ width: 16, seed: 3 });
    expect(samplePaperHeight(field, 4.9, 2.9)).toBe(samplePaperHeight(field, 4, 2));
  });
});

describe("createPaperGranulationGain", () => {
  it("이득의 평균은 0이라 총 안료량이 보존된다", () => {
    const paper = createPaperHeightField({ kind: "rough", seed: 11 });
    const gain = createPaperGranulationGain(paper, { strength: 0.9 });
    expect(Math.abs(mean(gain))).toBeLessThan(1e-6);
  });

  it("낮은 높이(골)에서 이득이 크고 봉우리에서 작다", () => {
    const paper = createPaperHeightField({ kind: "cold-press", seed: 41 });
    const gain = createPaperGranulationGain(paper, { strength: 1 });
    let lowest = 0;
    let highest = 0;
    for (let index = 1; index < paper.values.length; index++) {
      if (paper.values[index]! < paper.values[lowest]!) lowest = index;
      if (paper.values[index]! > paper.values[highest]!) highest = index;
    }
    expect(gain[lowest]!).toBeGreaterThan(0);
    expect(gain[highest]!).toBeLessThan(0);
    expect(gain[lowest]!).toBeGreaterThan(gain[highest]!);
  });

  it("strength 0 또는 staining 1이면 전 구간 이득 0(항등)이다", () => {
    const paper = createPaperHeightField({ seed: 2 });
    expect(spread(createPaperGranulationGain(paper, { strength: 0 }))).toBe(0);
    expect(spread(createPaperGranulationGain(paper, { strength: 1, staining: 1 }))).toBe(0);
  });

  it("staining이 높을수록 침착 진폭이 줄어든다", () => {
    const paper = createPaperHeightField({ seed: 2 });
    const clean = spread(createPaperGranulationGain(paper, { strength: 1, staining: 0 }));
    const stained = spread(createPaperGranulationGain(paper, { strength: 1, staining: 0.8 }));
    expect(stained).toBeLessThan(clean * 0.5);
  });

  it("완전 평탄한 종이는 재분포할 골이 없어 항등이다", () => {
    const flat = createPaperHeightField({ params: { amplitude: 0 } });
    expect(spread(createPaperGranulationGain(flat, { strength: 1 }))).toBe(0);
  });
});

describe("settlePigmentOnPaper", () => {
  it("입력 버퍼를 변형하지 않고 새 버퍼를 반환한다", () => {
    const paper = createPaperHeightField({ width: 32, seed: 9 });
    const pigment = new Float32Array(32 * 32).fill(0.4);
    const before = Array.from(pigment);
    const settled = settlePigmentOnPaper({ pigment, paper }, { strength: 0.8 });
    expect(settled).not.toBe(pigment);
    expect(Array.from(pigment)).toEqual(before);
    expect(mean(settled)).toBeCloseTo(0.4, 6);
  });

  it("안료가 0인 곳은 침착 후에도 0이다(흰 종이에 점 노이즈가 안 생긴다)", () => {
    const paper = createPaperHeightField({ width: 32, seed: 9 });
    const pigment = new Float32Array(32 * 32);
    pigment[100] = 1;
    const settled = settlePigmentOnPaper({ pigment, paper }, { strength: 1 });
    for (let index = 0; index < settled.length; index++) {
      if (index === 100) continue;
      expect(settled[index]!).toBe(0);
    }
  });

  it("버퍼가 종이 타일보다 짧으면 조용히 통과하지 않고 RangeError를 던진다", () => {
    const paper = createPaperHeightField({ width: 32, seed: 9 });
    expect(() => settlePigmentOnPaper({ pigment: new Float32Array(4), paper }, { strength: 1 })).toThrow(RangeError);
  });

  it("실제 물감 프로파일은 granulating과 staining이 확실히 갈린다", () => {
    const byId = new Map(PIGMENT_GRANULATION_PROFILES.map((profile) => [profile.id, profile]));
    const ultramarine = byId.get("ultramarine-blue")!;
    const phthalo = byId.get("phthalo-blue")!;
    expect(ultramarine.granulation).toBeGreaterThan(0.7);
    expect(ultramarine.staining).toBeLessThan(0.3);
    expect(phthalo.granulation).toBeLessThan(0.2);
    expect(phthalo.staining).toBeGreaterThan(0.8);
    expect(new Set(PIGMENT_GRANULATION_PROFILES.map((profile) => profile.id)).size).toBe(
      PIGMENT_GRANULATION_PROFILES.length,
    );
  });
});

describe("accumulateEdgeDarkening", () => {
  const WIDTH = 24;
  const HEIGHT = 24;

  function makeWash(): { pigment: Float32Array; wetness: Float32Array } {
    const pigment = new Float32Array(WIDTH * HEIGHT);
    const wetness = new Float32Array(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        const radius = Math.hypot(x - 12, y - 12);
        if (radius > 9) continue;
        const index = y * WIDTH + x;
        pigment[index] = 1;
        wetness[index] = Math.max(0.05, 1 - (radius / 9) ** 2);
      }
    }
    return { pigment, wetness };
  }

  it("입력을 변형하지 않고 새 버퍼를 반환한다", () => {
    const { pigment, wetness } = makeWash();
    const before = Array.from(pigment);
    const dried = accumulateEdgeDarkening({ pigment, wetness, width: WIDTH, height: HEIGHT }, { strength: 1 });
    expect(dried).not.toBe(pigment);
    expect(Array.from(pigment)).toEqual(before);
  });

  it("습윤도가 완전히 균일하면 그래디언트가 없어 항등이다", () => {
    const pigment = new Float32Array(WIDTH * HEIGHT).fill(0.6);
    const wetness = new Float32Array(WIDTH * HEIGHT).fill(1);
    const dried = accumulateEdgeDarkening({ pigment, wetness, width: WIDTH, height: HEIGHT }, { strength: 1 });
    expect(Array.from(dried)).toEqual(Array.from(pigment));
  });

  it("steps가 많을수록 가장자리에 더 많이 쌓인다", () => {
    const { pigment, wetness } = makeWash();
    const field = { pigment, wetness, width: WIDTH, height: HEIGHT };
    const short = accumulateEdgeDarkening(field, { strength: 1, steps: 2 });
    const long = accumulateEdgeDarkening(field, { strength: 1, steps: 16 });
    // 반경 9가 마지막 젖은 셀(= 안료가 고정되는 링). 그 안쪽은 계속 바깥으로 빠져나간다.
    const rim = 12 * WIDTH + 21;
    expect(long[rim]!).toBeGreaterThan(short[rim]!);
    expect(short[rim]!).toBeGreaterThan(1);
  });

  it("steps/strength/wetThreshold는 안전 범위로 클램프된다", () => {
    const { pigment, wetness } = makeWash();
    const field = { pigment, wetness, width: WIDTH, height: HEIGHT };
    const capped = accumulateEdgeDarkening(field, { strength: 12, steps: 999 });
    const maximal = accumulateEdgeDarkening(field, { strength: 1, steps: 32 });
    expect(Array.from(capped)).toEqual(Array.from(maximal));
    // 음수 strength는 0으로 클램프 → 항등.
    expect(Array.from(accumulateEdgeDarkening(field, { strength: -5 }))).toEqual(Array.from(pigment));
  });

  it("wetThreshold를 1로 올리면 젖은 셀이 없어 아무 것도 이동하지 않는다", () => {
    const { pigment, wetness } = makeWash();
    const dried = accumulateEdgeDarkening(
      { pigment, wetness, width: WIDTH, height: HEIGHT },
      { strength: 1, wetThreshold: 1 },
    );
    expect(Array.from(dried)).toEqual(Array.from(pigment));
  });
});

describe("dryWashOnPaper", () => {
  it("이송 후 침착 순서로 합성하며 총 안료량을 보존한다", () => {
    const paper = createPaperHeightField({ width: 32, kind: "rough", seed: 21 });
    const pigment = new Float32Array(32 * 32);
    const wetness = new Float32Array(32 * 32);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const radius = Math.hypot(x - 16, y - 16);
        if (radius > 11) continue;
        const index = y * 32 + x;
        pigment[index] = 1;
        wetness[index] = Math.max(0.05, 1 - (radius / 11) ** 2);
      }
    }
    const before = mean(pigment);
    const dried = dryWashOnPaper(
      { pigment, wetness, paper },
      { edgeDarkening: { strength: 0.8, steps: 8 }, granulation: { strength: 0.85, staining: 0.1 } },
    );
    // 이송도 침착도 안료를 만들지 않는다 — 국소 워시에서도 총량이 정확히 보존된다.
    expect(mean(dried)).toBeCloseTo(before, 6);
    expect(spread(dried)).toBeGreaterThan(spread(pigment));
  });

  it("두 효과를 모두 끄면 입력을 그대로 통과시킨다", () => {
    const paper = createPaperHeightField({ width: 16, seed: 4 });
    const pigment = new Float32Array(16 * 16).fill(0.3);
    const wetness = new Float32Array(16 * 16).fill(0.8);
    const dried = dryWashOnPaper(
      { pigment, wetness, paper },
      { edgeDarkening: { strength: 0 }, granulation: { strength: 0 } },
    );
    expect(Array.from(dried)).toEqual(Array.from(pigment));
  });
});
