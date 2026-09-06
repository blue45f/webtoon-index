import { describe, expect, it } from "vitest";

import {
  resolveStudioPaperBrushMedium,
  resolveStudioPaperBrushResponse,
} from "./studio-paper-brush-response";
import {
  DEFAULT_STUDIO_PAPER_SURFACE,
  acquireStudioPaperGranulationTile,
  clearStudioPaperGranulationTileCache,
  resolveStudioPaperContactToothAlphaMultiplierAt,
  resolveStudioPaperGranulationAlphaMultiplierAt,
  sampleStudioPaperDetiledHeightAt,
  sampleStudioPaperHeightAt,
} from "./studio-paper-granulation-runtime";
import {
  STUDIO_PAPER_MEDIA_INTERACTION_V1,
  resolveStudioPaperDepositScaleForHeightV1,
  type StudioPaperMediumV1,
} from "./studio-paper-media-profile-v1";
import {
  STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2,
  isStudioPaperSubstrateModel,
  normalizeStudioPaperSubstrateModel,
  studioPaperUsesContactTooth,
} from "./studio-paper-substrate-model";
import {
  PAPER_GRAIN_KINDS,
  PAPER_TEXTURE_PRESETS,
  STUDIO_PAPER_HEIGHT_CONTRAST_SHAPED_V2,
  createPaperHeightField,
  type PaperGrainKind,
} from "./studio-paper-texture";

/**
 * contact-tooth-v2 게이트.
 *
 * 이 스위트가 지키는 계약은 두 가지다.
 *
 * 1. **키 없는 획은 한 비트도 안 바뀐다.** ToonSpectrum 획은 커밋 시점에 래스터화되지 않고
 *    저장된 점·필압에서 **매 렌더마다 다시 계획**된다. 그래서 substrate를 고치면서 키를 두지
 *    않으면 이미 완성된 페이지가 다음에 열릴 때 조용히 다시 칠해진다 — 이 프로젝트가
 *    USED_PRESET_DATA_PRESERVED 정책으로 막으려는 바로 그 부류의 사고다.
 * 2. **키가 있는 획은 사양대로 그려진다.** `docs/candidates/brush-catalog-v17/design.md:38` —
 *    "건식=peak-catch, 수채=valley-settle, 유화=weave-reveal".
 */

const PAPER: PaperGrainKind = "rough";
const SURFACE = { kind: PAPER, seed: 41 } as const;
const V2 = STUDIO_PAPER_SUBSTRATE_MODEL_CONTACT_TOOTH_V2;

/** peak-catch(건식) 매체를 실제로 태우는 대표 브러시들. */
const DRY_BRUSHES = ["pencil", "charcoal", "pastel-soft"] as const;

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i += 1) {
    meanA += a[i]!;
    meanB += b[i]!;
  }
  meanA /= n;
  meanB /= n;
  let covariance = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    covariance += da * db;
    varA += da * da;
    varB += db * db;
  }
  return covariance / Math.sqrt(varA * varB);
}

function contactToothField(brushId: string, pressure: number) {
  const medium = resolveStudioPaperBrushMedium(brushId);
  const response = resolveStudioPaperBrushResponse(brushId, PAPER, { pressure, model: V2, medium });
  const tile = acquireStudioPaperGranulationTile(SURFACE, response, V2);
  return { medium, response, tile };
}

describe("studio paper substrate model — the versioned key", () => {
  it("recognizes only the model it knows how to render", () => {
    expect(isStudioPaperSubstrateModel(V2)).toBe(true);
    for (const value of ["contact-tooth-v3", "", "legacy", null, undefined, 2, {}]) {
      expect(isStudioPaperSubstrateModel(value), String(value)).toBe(false);
      expect(normalizeStudioPaperSubstrateModel(value), String(value)).toBeUndefined();
    }
  });

  it("treats an omitted model as the historical contract, never as an upgrade", () => {
    // 이 한 줄이 완성된 작품을 지킨다. true가 되는 순간 모든 기존 문서가 다시 칠해진다.
    expect(studioPaperUsesContactTooth(undefined)).toBe(false);
    expect(studioPaperUsesContactTooth(V2)).toBe(true);
  });
});

describe("legacy substrate stays byte-frozen", () => {
  it("keeps the mean-only height field for every one of the 21 papers", () => {
    for (const kind of PAPER_GRAIN_KINDS as readonly PaperGrainKind[]) {
      const field = createPaperHeightField({ kind, seed: 41 });
      let sum = 0;
      for (const value of field.values) sum += value;
      // 평균만 빼는 역사적 경로의 지문: 타일 평균이 정확히 0.5다.
      expect(sum / field.values.length, kind).toBeCloseTo(0.5, 6);
    }
  });

  it("gives a key-less stroke the same tile, the same sampler and the same valley polarity", () => {
    clearStudioPaperGranulationTileCache();
    for (const brushId of DRY_BRUSHES) {
      const response = resolveStudioPaperBrushResponse(brushId, PAPER);
      // 3번째 인자를 생략한 호출은 예전 반환값과 정확히 같아야 한다.
      expect(resolveStudioPaperBrushResponse(brushId, PAPER, undefined), brushId)
        .toEqual(response);
      const tile = acquireStudioPaperGranulationTile(SURFACE, response)!;
      // 키가 없으면 타일 키에 모델 접미사가 붙지 않는다 — 캐시가 세대를 섞지 않는 근거.
      expect(tile.key, brushId).not.toContain(V2);
      expect(tile.model, brushId).toBeUndefined();

      const heights: number[] = [];
      const deposits: number[] = [];
      for (let y = 0; y < 96; y += 1) {
        for (let x = 0; x < 96; x += 1) {
          const px = x * response.scale;
          const py = y * response.scale;
          heights.push(sampleStudioPaperHeightAt(tile, px, py, response.scale));
          deposits.push(
            resolveStudioPaperGranulationAlphaMultiplierAt(tile, px, py, response.scale),
          );
        }
      }
      // 레거시는 건식도 골에 쌓는다(사양과 반대). 그게 이미 저장된 그림의 모습이므로 보존한다.
      expect(pearson(heights, deposits), brushId).toBeLessThan(-0.9);
    }
  });

  it("keeps a separate cache entry so the two generations never share a tile", () => {
    clearStudioPaperGranulationTileCache();
    const legacy = resolveStudioPaperBrushResponse("charcoal", PAPER);
    const legacyTile = acquireStudioPaperGranulationTile(SURFACE, legacy)!;
    const { tile: v2Tile } = contactToothField("charcoal", 0.5);
    expect(v2Tile).not.toBeNull();
    expect(v2Tile!.key).not.toBe(legacyTile.key);
    expect(v2Tile!.field.values).not.toEqual(legacyTile.field.values);
  });
});

describe("polarity matches design.md — 건식=peak-catch, 수채=valley-settle, 유화=weave-reveal", () => {
  it("puts dry pigment on the PEAKS", () => {
    for (const brushId of DRY_BRUSHES) {
      const { medium, response, tile } = contactToothField(brushId, 0.5);
      expect(medium, brushId).not.toBeNull();
      expect(
        STUDIO_PAPER_MEDIA_INTERACTION_V1[medium as StudioPaperMediumV1].mode,
        brushId,
      ).toBe("peak-catch");
      const heights: number[] = [];
      const deposits: number[] = [];
      for (let y = 0; y < 96; y += 1) {
        for (let x = 0; x < 96; x += 1) {
          const px = x * response.scale;
          const py = y * response.scale;
          heights.push(sampleStudioPaperDetiledHeightAt(tile!, px, py, response.scale));
          deposits.push(
            resolveStudioPaperContactToothAlphaMultiplierAt(
              tile!,
              px,
              py,
              response.scale,
              medium,
              0.5,
            ),
          );
        }
      }
      // 레거시가 -0.99였던 자리. 부호가 뒤집힌 것이 이 작업의 헤드라인이다.
      expect(pearson(heights, deposits), brushId).toBeGreaterThan(0.85);
    }
  });

  it("leaves watercolour settling into the VALLEYS", () => {
    const brushId = "watercolor-round";
    const { medium, response, tile } = contactToothField(brushId, 0.5);
    expect(STUDIO_PAPER_MEDIA_INTERACTION_V1[medium as StudioPaperMediumV1].mode)
      .toBe("valley-settle");
    const heights: number[] = [];
    const deposits: number[] = [];
    for (let y = 0; y < 96; y += 1) {
      for (let x = 0; x < 96; x += 1) {
        const px = x * response.scale;
        const py = y * response.scale;
        heights.push(sampleStudioPaperDetiledHeightAt(tile!, px, py, response.scale));
        deposits.push(
          resolveStudioPaperContactToothAlphaMultiplierAt(
            tile!, px, py, response.scale, medium, 0.5,
          ),
        );
      }
    }
    expect(pearson(heights, deposits)).toBeLessThan(-0.9);
  });

  it("keeps oil on weave-reveal, where thin paint — not light pressure — shows the threads", () => {
    const { medium, response, tile } = contactToothField("oil-round", 0.5);
    expect(STUDIO_PAPER_MEDIA_INTERACTION_V1[medium as StudioPaperMediumV1].mode)
      .toBe("weave-reveal");
    const at = (pressure: number) => {
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < 512; i += 1) {
        const value = resolveStudioPaperContactToothAlphaMultiplierAt(
          tile!, i * 3.1, i * 1.7, response.scale, medium, pressure,
        );
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
      return high - low;
    };
    // 두꺼운 물감(높은 필압 → thinness↓)은 직조를 덮는다. 얇을수록 결이 더 드러난다.
    expect(at(0.15)).toBeGreaterThan(at(0.95));
  });

  it("keeps tools that do not read the sheet at exact identity", () => {
    for (const brushId of ["pen", "g-pen", "technical-pen", "airbrush-soft"]) {
      const medium = resolveStudioPaperBrushMedium(brushId);
      if (medium !== null) continue;
      expect(
        resolveStudioPaperContactToothAlphaMultiplierAt(null, 3, 5, 1, medium, 0.5),
        brushId,
      ).toBe(1);
    }
  });
});

describe("pressure enters the coupling", () => {
  it("empties the pits at a light touch and fills them under a heavy one", () => {
    for (const brushId of ["pencil", "charcoal"] as const) {
      const bare: number[] = [];
      for (const pressure of [0.15, 0.35, 0.55, 0.75, 1]) {
        const { medium, response, tile } = contactToothField(brushId, pressure);
        let empty = 0;
        let total = 0;
        for (let y = 0; y < 96; y += 1) {
          for (let x = 0; x < 96; x += 1) {
            const value = resolveStudioPaperContactToothAlphaMultiplierAt(
              tile!, x * response.scale, y * response.scale, response.scale, medium, pressure,
            );
            if (value < 0.15) empty += 1;
            total += 1;
          }
        }
        bare.push((empty / total) * 100);
      }
      // 가벼운 필압에서 바탕이 절반 넘게 드러나고, 필압이 오를수록 단조 감소한다.
      expect(bare[0]!, brushId).toBeGreaterThan(40);
      for (let i = 1; i < bare.length; i += 1) {
        expect(bare[i]!, `${brushId} @${i}`).toBeLessThanOrEqual(bare[i - 1]!);
      }
      expect(bare.at(-1)!, brushId).toBeLessThan(5);
    }
  });

  it("keeps the response monotonic in pressure without changing the 2-argument answer", () => {
    const legacy = resolveStudioPaperBrushResponse("charcoal", PAPER);
    expect(resolveStudioPaperBrushResponse("charcoal", PAPER, undefined)).toEqual(legacy);
    const medium = resolveStudioPaperBrushMedium("charcoal");
    let previous = Number.POSITIVE_INFINITY;
    for (const pressure of [0, 0.25, 0.5, 0.75, 1]) {
      const heavy = resolveStudioPaperBrushResponse(
        "charcoal", PAPER, { pressure, model: V2, medium },
      );
      // 필압이 오르면 이빨이 메워져 결의 가시성이 떨어진다(burnishing).
      expect(heavy.granulation).toBeLessThanOrEqual(previous);
      previous = heavy.granulation;
    }
    // 세 번째 인자를 숫자 하나로 넘기는 축약형도 같은 축을 태운다.
    expect(resolveStudioPaperBrushResponse("charcoal", PAPER, 0.5))
      .toEqual(resolveStudioPaperBrushResponse("charcoal", PAPER, { pressure: 0.5 }));
  });
});

describe("declared amplitude finally means something", () => {
  it("makes RMS proportional to the declared amplitude across all 21 presets", () => {
    const ratios: number[] = [];
    for (const kind of PAPER_GRAIN_KINDS as readonly PaperGrainKind[]) {
      const field = createPaperHeightField({
        kind,
        seed: 41,
        contrast: STUDIO_PAPER_HEIGHT_CONTRAST_SHAPED_V2,
      });
      let sum = 0;
      for (const value of field.values) sum += value;
      const mean = sum / field.values.length;
      let variance = 0;
      let clipped = 0;
      for (const value of field.values) {
        variance += (value - mean) ** 2;
        if (value <= 0.0001 || value >= 0.9999) clipped += 1;
      }
      const rms = Math.sqrt(variance / field.values.length);
      // tanh 성형이 꼬리를 눌러 준 덕분에 어떤 프리셋도 0/1에 하드 클립되지 않는다.
      expect((clipped / field.values.length) * 100, kind).toBeLessThan(0.01);
      ratios.push(rms / PAPER_TEXTURE_PRESETS[kind].amplitude);
    }
    const low = Math.min(...ratios);
    const high = Math.max(...ratios);
    // 배선 전 이 비는 0.086~0.154로 1.8배 흔들렸다 — 선언값이 렌더에 도달하지 못했다는 뜻.
    expect(high / low).toBeLessThan(1.1);
    expect(low).toBeGreaterThan(0.25);
  });
});

describe("the sheet no longer tiles", () => {
  it("has no exact period anywhere an A4 300dpi export could show one", () => {
    const { response, tile } = contactToothField("charcoal", 0.5);
    const scale = response.scale;
    let sum = 0;
    let sumSquares = 0;
    const samples = 4096;
    for (let i = 0; i < samples; i += 1) {
      const height = sampleStudioPaperDetiledHeightAt(tile!, i * 7.3, i * 3.9, scale);
      sum += height;
      sumSquares += height * height;
    }
    const rms = Math.sqrt(sumSquares / samples - (sum / samples) ** 2);
    expect(rms).toBeGreaterThan(0.05);

    // 128 * scale 은 레거시가 비트 단위로 반복하던 바로 그 주기다(황목·목탄에서 240px).
    for (const period of [64, 128, 128 * scale, 192, 240, 256, 512, 1024, 2480]) {
      let worst = 0;
      for (let i = 0; i < 2048; i += 1) {
        const x = (i * 137.51) % 2000;
        const y = (i * 71.13) % 2000;
        worst = Math.max(
          worst,
          Math.abs(
            sampleStudioPaperDetiledHeightAt(tile!, x, y, scale)
            - sampleStudioPaperDetiledHeightAt(tile!, x + period, y, scale),
          ),
        );
      }
      // 차이가 필드 자신의 RMS 규모라면 그 오프셋에 반복이 없다는 뜻이다.
      expect(worst, `period ${period}`).toBeGreaterThan(rms);
    }
  });

  it("still reads a baked tile at every sample, so a GPU mirror can reproduce it", () => {
    const { response, tile } = contactToothField("charcoal", 0.5);
    // 값이 전부 타일 텍셀의 이중선형 조합이면 [0,1]을 절대 벗어나지 않는다.
    for (let i = 0; i < 2048; i += 1) {
      const height = sampleStudioPaperDetiledHeightAt(
        tile!, i * 11.7, i * 5.3, response.scale,
      );
      expect(height).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThanOrEqual(1);
    }
    // 같은 좌표는 항상 같은 값 — 결정적이라 CPU/GPU 비트 패리티를 논할 수 있다.
    expect(sampleStudioPaperDetiledHeightAt(tile!, 123.5, 77.25, response.scale))
      .toBe(sampleStudioPaperDetiledHeightAt(tile!, 123.5, 77.25, response.scale));
  });

  it("guards non-finite coordinates and degenerate scales", () => {
    const { medium, tile } = contactToothField("charcoal", 0.5);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const height = sampleStudioPaperDetiledHeightAt(tile!, value, 0, 1);
      expect(Number.isFinite(height)).toBe(true);
      const multiplier = resolveStudioPaperContactToothAlphaMultiplierAt(
        tile!, value, 0, 1, medium, value,
      );
      expect(Number.isFinite(multiplier)).toBe(true);
      expect(multiplier).toBeGreaterThanOrEqual(0);
    }
    expect(
      Number.isFinite(
        resolveStudioPaperContactToothAlphaMultiplierAt(tile!, 4, 4, 0, medium, 0.5),
      ),
    ).toBe(true);
    expect(
      resolveStudioPaperContactToothAlphaMultiplierAt(null, 4, 4, 1, medium, 0.5),
    ).toBe(1);
  });
});

describe("one deposit authority", () => {
  it("routes every coupled family through the media-profile-v1 taxonomy", () => {
    clearStudioPaperGranulationTileCache();
    for (const brushId of [...DRY_BRUSHES, "watercolor-round", "oil-round"]) {
      const medium = resolveStudioPaperBrushMedium(brushId);
      expect(medium, brushId).not.toBeNull();
      // 극성 분류가 이 표 하나에서만 나온다는 사실 자체가 "두 물리가 한 캔버스에서 싸우던"
      // 상태의 해소다 — 스탬프 엔진 W7도 같은 표를 읽는다.
      expect(
        Object.hasOwn(STUDIO_PAPER_MEDIA_INTERACTION_V1, medium as string),
        brushId,
      ).toBe(true);
    }
  });

  it("defaults an unknown surface to the shared document sheet", () => {
    expect(DEFAULT_STUDIO_PAPER_SURFACE.seed).toBe(41);
  });

  it("agrees with the stamp engine's W7 lane on the deposit math", () => {
    /*
     * 배선 전에는 한 캔버스 위에서 두 물리가 싸웠다. granulation 런타임은 건식도
     * valley-settle 로 깔았고, 스탬프 엔진 W7 은 peak-catch 로 깔았다. 이제 두 경로가
     * **같은 함수**를 호출한다 — 이 테스트는 그 함수가 정말 하나인지를 못 박는다.
     */
    const medium: StudioPaperMediumV1 = "dry-media";
    const profile = STUDIO_PAPER_MEDIA_INTERACTION_V1[medium];
    expect(profile.mode).toBe("peak-catch");
    // 접촉 문턱은 필압에 따라 내려간다 — 두 엔진이 공유하는 유일한 침착 규약.
    expect(profile.contactThresholdHeavy).toBeLessThan(profile.contactThresholdLight);

    const heights = [0.05, 0.3, 0.5, 0.7, 0.95];
    const light = heights.map((height) =>
      resolveStudioPaperDepositScaleForHeightV1(medium, 0.15, 1, height));
    const heavy = heights.map((height) =>
      resolveStudioPaperDepositScaleForHeightV1(medium, 0.95, 1, height));
    // 가벼운 필압은 봉우리만 잡고, 무거운 필압은 골까지 메운다.
    for (let i = 0; i < heights.length; i += 1) {
      expect(heavy[i]!, `height ${heights[i]}`).toBeGreaterThanOrEqual(light[i]!);
    }
    expect(light[0]!).toBeLessThan(0.05);
    expect(heavy.at(-1)!).toBeGreaterThan(0.95);
    // 미지의 매체는 항등으로 fail-closed — 스칼라 핫패스와 같은 규약.
    expect(resolveStudioPaperDepositScaleForHeightV1("nope", 0.5, 1, 0.5)).toBe(1);
  });
});
