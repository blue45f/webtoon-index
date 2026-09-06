import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  PAPER_GRAIN_KINDS,
  PAPER_TEXTURE_PRESETS,
  PIGMENT_GRANULATION_PROFILES,
  accumulateEdgeDarkening,
  createPaperGranulationGain,
  createPaperHeightField,
  samplePaperHeight,
  settlePigmentOnPaper,
  type PaperGrainKind,
  type PaperHeightField,
} from "../../apps/web/src/domains/creator/brush/studio-paper-texture";
import { GRAIN_BANDS, grainMetrics } from "../benchmarks/harness/brush-texture-lab";

/**
 * 종이 결 / 입자 침착 / 가장자리 어두워짐 정량 게이트.
 *
 * 수채화를 수채화로 읽히게 하는 두 특징(Curtis et al. 1997 얕은 물 모델의 granulation과
 * edge darkening)이 "물리적으로 맞는 방향"으로 동작하는지를 숫자로 고정한다. 눈으로 보는
 * 대신 다음을 잰다.
 *
 *   - 종이: RMS 거칠기·자기상관 길이가 세목<중목<황목 순서이고, 타일 이음선이 내부 결보다
 *     튀지 않는다(seamless).
 *   - 침착: 균일 워시가 종이 위에서 분산을 얻고, 그 패턴이 높이맵과 강한 음의 상관을
 *     가진다(= 골에 몰린다). 총 안료량은 보존된다.
 *   - 가장자리: 원형 워시가 마른 뒤 링 평균이 중심부보다 진하고, strength=0이면 비트 단위로
 *     사라진다(조작 감지).
 *
 * 실측치는 `tests/benchmarks/results/paper-texture.json`에 결정적으로(타임스탬프 없이)
 * 기록되므로, 물리를 바꾸면 그 파일이 git diff로 드러난다 — 이 파일 자체가 회귀 핀이다.
 */

const TILE = 128;
const SEED = 41;
const RESULT_PATH = join(__dirname, "..", "benchmarks", "results", "paper-texture.json");

// ---------------------------------------------------------------------------
// 통계 헬퍼
// ---------------------------------------------------------------------------

function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let index = 0; index < values.length; index++) sum += values[index]!;
  return sum / values.length;
}

function standardDeviation(values: ArrayLike<number>): number {
  const average = mean(values);
  let sum = 0;
  for (let index = 0; index < values.length; index++) sum += (values[index]! - average) ** 2;
  return Math.sqrt(sum / values.length);
}

function pearson(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const meanLeft = mean(left);
  const meanRight = mean(right);
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (let index = 0; index < left.length; index++) {
    const a = left[index]! - meanLeft;
    const b = right[index]! - meanRight;
    covariance += a * b;
    varianceLeft += a * a;
    varianceRight += b * b;
  }
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}

const AUTOCORRELATION_THRESHOLD = Math.exp(-1);

/**
 * 자기상관 길이 — 정규화 자기상관이 1/e 아래로 떨어지는 lag(선형 보간).
 * 높이맵이 주기적이라 순환 시프트를 써도 경계 왜곡이 없다.
 */
function autocorrelationLength(field: PaperHeightField, axis: "x" | "y"): number {
  const { width, height, values } = field;
  const average = mean(values);
  const variance = standardDeviation(values) ** 2;
  if (variance <= 0) return 0;
  const maxLag = Math.floor((axis === "x" ? width : height) / 2);
  let previous = 1;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const shiftedX = axis === "x" ? (x + lag) % width : x;
        const shiftedY = axis === "y" ? (y + lag) % height : y;
        sum += (values[y * width + x]! - average) * (values[shiftedY * width + shiftedX]! - average);
      }
    }
    const correlation = sum / (width * height) / variance;
    if (correlation < AUTOCORRELATION_THRESHOLD) {
      const t = (previous - AUTOCORRELATION_THRESHOLD) / (previous - correlation);
      return lag - 1 + t;
    }
    previous = correlation;
  }
  return maxLag;
}

/**
 * 타일 이음선 계측 — 마지막 열/행과 첫 열/행 사이의 평균 계단을 내부 인접 픽셀 계단과 비교한다.
 * 비가 1에 가까우면 이음선이 내부 결과 구분되지 않는다(= 보이지 않는다).
 */
function seamContinuity(field: PaperHeightField): {
  seamStepX: number;
  interiorStepX: number;
  ratioX: number;
  seamStepY: number;
  interiorStepY: number;
  ratioY: number;
} {
  const { width, height, values } = field;
  let seamX = 0;
  let interiorX = 0;
  for (let y = 0; y < height; y++) {
    seamX += Math.abs(values[y * width + width - 1]! - values[y * width]!);
    for (let x = 0; x < width - 1; x++) interiorX += Math.abs(values[y * width + x + 1]! - values[y * width + x]!);
  }
  seamX /= height;
  interiorX /= height * (width - 1);

  let seamY = 0;
  let interiorY = 0;
  for (let x = 0; x < width; x++) {
    seamY += Math.abs(values[(height - 1) * width + x]! - values[x]!);
    for (let y = 0; y < height - 1; y++) interiorY += Math.abs(values[(y + 1) * width + x]! - values[y * width + x]!);
  }
  seamY /= width;
  interiorY /= width * (height - 1);

  return {
    seamStepX: seamX,
    interiorStepX: interiorX,
    ratioX: seamX / interiorX,
    seamStepY: seamY,
    interiorStepY: interiorY,
    ratioY: seamY / interiorY,
  };
}

function fieldSha(field: PaperHeightField): string {
  return createHash("sha256").update(Buffer.from(field.values.buffer.slice(0))).digest("hex").slice(0, 16);
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// 실측 1 — 종이 결 통계
// ---------------------------------------------------------------------------

interface PaperStats {
  rmsRoughness: number;
  autocorrelationX: number;
  autocorrelationY: number;
  fibreAnisotropyMeasured: number;
  seamRatioX: number;
  seamRatioY: number;
  seamStepX: number;
  interiorStepX: number;
  seamStepY: number;
  interiorStepY: number;
  min: number;
  max: number;
  mean: number;
  sha256: string;
}

const fields = new Map<PaperGrainKind, PaperHeightField>();
const paperStats = {} as Record<PaperGrainKind, PaperStats>;

for (const kind of PAPER_GRAIN_KINDS) {
  const field = createPaperHeightField({ kind, width: TILE, height: TILE, seed: SEED });
  fields.set(kind, field);
  const seam = seamContinuity(field);
  const autocorrelationX = autocorrelationLength(field, "x");
  const autocorrelationY = autocorrelationLength(field, "y");
  paperStats[kind] = {
    rmsRoughness: round(standardDeviation(field.values)),
    autocorrelationX: round(autocorrelationX, 3),
    autocorrelationY: round(autocorrelationY, 3),
    fibreAnisotropyMeasured: round(autocorrelationX / autocorrelationY, 3),
    seamRatioX: round(seam.ratioX, 3),
    seamRatioY: round(seam.ratioY, 3),
    seamStepX: round(seam.seamStepX),
    interiorStepX: round(seam.interiorStepX),
    seamStepY: round(seam.seamStepY),
    interiorStepY: round(seam.interiorStepY),
    min: round(Math.min(...field.values), 4),
    max: round(Math.max(...field.values), 4),
    mean: round(mean(field.values)),
    sha256: fieldSha(field),
  };
}

// ---------------------------------------------------------------------------
// 실측 2 — 입자 침착(granulation)
// ---------------------------------------------------------------------------

const UNIFORM_WASH = 0.5;
const coldPress = fields.get("cold-press")!;
const uniformWash = new Float32Array(TILE * TILE).fill(UNIFORM_WASH);

interface GranulationStats {
  mean: number;
  standardDeviation: number;
  coefficientOfVariation: number;
  heightCorrelation: number;
  min: number;
  max: number;
}

function measureGranulation(strength: number, staining: number): GranulationStats {
  const settled = settlePigmentOnPaper({ pigment: uniformWash, paper: coldPress }, { strength, staining });
  const deviation = standardDeviation(settled);
  return {
    mean: round(mean(settled), 8),
    standardDeviation: round(deviation, 6),
    coefficientOfVariation: round(deviation / mean(settled), 6),
    heightCorrelation: deviation > 0 ? round(pearson(settled, coldPress.values), 5) : 0,
    min: round(Math.min(...settled), 4),
    max: round(Math.max(...settled), 4),
  };
}

const granulationStats: Record<string, GranulationStats> = {};
for (const profile of PIGMENT_GRANULATION_PROFILES) {
  granulationStats[profile.id] = measureGranulation(profile.granulation, profile.staining);
}
granulationStats["granulation-off"] = measureGranulation(0, 0);

// ---------------------------------------------------------------------------
// 실측 3 — 가장자리 어두워짐(edge darkening)
// ---------------------------------------------------------------------------

const WASH_RADIUS = 40;
const WASH_CENTER = TILE / 2;
const RING_INNER = 0.78;
const CORE_OUTER = 0.45;
/** 원 안쪽 최소 습윤도. 0이면 pinning 임계에 걸려 중심부가 마른 셀로 취급된다. */
const WASH_MIN_WETNESS = 0.05;

const washPigment = new Float32Array(TILE * TILE);
const washWetness = new Float32Array(TILE * TILE);
for (let y = 0; y < TILE; y++) {
  for (let x = 0; x < TILE; x++) {
    const radius = Math.hypot(x - WASH_CENTER, y - WASH_CENTER);
    if (radius > WASH_RADIUS) continue;
    const index = y * TILE + x;
    washPigment[index] = 1;
    // 얕은 접시 모양 물웅덩이: 중심이 가장 깊고 가장자리로 갈수록 얇아진다.
    washWetness[index] = Math.max(WASH_MIN_WETNESS, 1 - (radius / WASH_RADIUS) ** 2);
  }
}

interface RingStats {
  ringMean: number;
  coreMean: number;
  ringToCore: number;
  totalPigment: number;
}

function measureRing(values: ArrayLike<number>): RingStats {
  let ring = 0;
  let ringCount = 0;
  let core = 0;
  let coreCount = 0;
  let total = 0;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const radius = Math.hypot(x - WASH_CENTER, y - WASH_CENTER);
      const value = values[y * TILE + x]!;
      total += value;
      if (radius <= WASH_RADIUS * CORE_OUTER) {
        core += value;
        coreCount++;
      } else if (radius >= WASH_RADIUS * RING_INNER && radius <= WASH_RADIUS) {
        ring += value;
        ringCount++;
      }
    }
  }
  const ringMean = ring / ringCount;
  const coreMean = core / coreCount;
  return {
    ringMean: round(ringMean, 4),
    coreMean: round(coreMean, 4),
    ringToCore: round(ringMean / coreMean, 4),
    totalPigment: round(total, 3),
  };
}

const EDGE_CASES = [
  { id: "off", strength: 0, steps: 12 },
  { id: "gentle", strength: 0.3, steps: 6 },
  { id: "studio-default", strength: 0.6, steps: 6 },
  { id: "full", strength: 1, steps: 12 },
] as const;

const edgeResults = new Map<string, Float32Array>();
const edgeStats: Record<string, RingStats & { strength: number; steps: number }> = {};
for (const testCase of EDGE_CASES) {
  const dried = accumulateEdgeDarkening(
    { pigment: washPigment, wetness: washWetness, width: TILE, height: TILE },
    { strength: testCase.strength, steps: testCase.steps },
  );
  edgeResults.set(testCase.id, dried);
  edgeStats[testCase.id] = { strength: testCase.strength, steps: testCase.steps, ...measureRing(dried) };
}
const baselineRing = measureRing(washPigment);

// ---------------------------------------------------------------------------
// 실측 4 — 그레인 스펙트럼(브러시 질감 랩과 같은 자)
// ---------------------------------------------------------------------------

/**
 * 브러시 질감 랩(`tests/benchmarks/harness/brush-texture-lab.ts`)이 wash-soft를 재보니
 * dab 스케일 중주파(8~32px) 에너지가 3.6%뿐이고 96.2%가 저주파 감쇠 엔벨로프였다 —
 * 워시 내부에 재질 질감이 사실상 없다는 뜻이다. granulation이 성공했다면 **같은 자로**
 * 잰 중주파 비율이 유의하게 올라가야 하므로, 랩의 `grainMetrics`(64창, DC 제거 + Hann
 * 테이퍼, 분리형 2D DFT, 대역 f≤1/32 / 1/32~1/8 / >1/8)를 그대로 import 해서 쓴다.
 *
 * 여기 워시는 브러시 엔진 없이도 돌아가도록 만든 wash-soft 대역 특성 대역체다 —
 * 매끈한 감쇠 엔벨로프만 있어 기준선 중주파 비율이 랩 실측(0.036476)과 같은 자릿수다.
 * 이 파일은 종이 커널 자체를 재므로 브러시 랩 게이트(wash-soft grainMidBandRatio
 * [0.018238, 0.073318])와는 독립이다 — 랩은 libmypaint/hokusai 렌더 경로만 재고
 * 그 경로는 아직 종이 커널을 쓰지 않는다.
 */
const WASH_FRAME_SIZE = 128;
const GRAIN_WINDOW = 64;
/** 랩이 wash-soft에서 실측한 중주파 비율. 우리가 넘어야 할 "질감 없음" 기준선. */
const LAB_WASH_SOFT_MID_BAND_RATIO = 0.036476;

interface AlphaFrame {
  data: Uint8Array;
  width: number;
  height: number;
}

function makeSmoothWashFrame(): AlphaFrame {
  const data = new Uint8Array(WASH_FRAME_SIZE * WASH_FRAME_SIZE * 4);
  const centre = WASH_FRAME_SIZE / 2;
  for (let y = 0; y < WASH_FRAME_SIZE; y++) {
    for (let x = 0; x < WASH_FRAME_SIZE; x++) {
      const radius = Math.hypot(x - centre, y - centre);
      // 저주파만 있는 가우시안 감쇠 — 중주파 대역이 거의 비어 있는 "매끈한 워시".
      const envelope = 0.42 * Math.exp(-((radius / 52) ** 2));
      const offset = (y * WASH_FRAME_SIZE + x) * 4;
      data[offset] = 40;
      data[offset + 1] = 60;
      data[offset + 2] = 90;
      data[offset + 3] = Math.round(255 * Math.min(1, envelope));
    }
  }
  return { data, width: WASH_FRAME_SIZE, height: WASH_FRAME_SIZE };
}

function granulateFrame(base: AlphaFrame, gain: Float32Array): AlphaFrame {
  const data = new Uint8Array(base.data);
  for (let index = 0; index < WASH_FRAME_SIZE * WASH_FRAME_SIZE; index++) {
    const alpha = base.data[index * 4 + 3]! / 255;
    const settled = Math.max(0, Math.min(1, alpha * (1 + gain[index]!)));
    data[index * 4 + 3] = Math.round(settled * 255);
  }
  return { data, width: WASH_FRAME_SIZE, height: WASH_FRAME_SIZE };
}

const washFrame = makeSmoothWashFrame();
const washBaselineGrain = grainMetrics(washFrame, WASH_FRAME_SIZE / 2, WASH_FRAME_SIZE / 2, GRAIN_WINDOW);

interface GrainRecord {
  midBandRatio: number;
  lowBandRatio: number;
  highBandRatio: number;
  midBandRatioGainVsSmoothWash: number;
  midBandPowerNormalised: number;
  midBandPeakPeriodPx: number;
  alphaDeltaHeightCorrelation: number;
  /** 8bit 알파가 실제로 바뀐 픽셀 수. 0이면 상관계수는 정의되지 않아 0으로 기록한다. */
  alphaDeltaMovedPixels: number;
}

function measureGrainFor(kind: PaperGrainKind, strength: number, staining: number): GrainRecord {
  const paper = createPaperHeightField({
    kind,
    width: WASH_FRAME_SIZE,
    height: WASH_FRAME_SIZE,
    seed: SEED,
  });
  const gain = createPaperGranulationGain(paper, { strength, staining });
  const grained = granulateFrame(washFrame, gain);
  const metrics = grainMetrics(grained, WASH_FRAME_SIZE / 2, WASH_FRAME_SIZE / 2, GRAIN_WINDOW);

  // 상승분의 공간 패턴이 종이 높이맵과 음의 상관인지 — DFT 창과 같은 영역에서만 잰다.
  const delta: number[] = [];
  const heights: number[] = [];
  let moved = 0;
  const start = (WASH_FRAME_SIZE - GRAIN_WINDOW) / 2;
  for (let y = start; y < start + GRAIN_WINDOW; y++) {
    for (let x = start; x < start + GRAIN_WINDOW; x++) {
      const index = y * WASH_FRAME_SIZE + x;
      const difference = grained.data[index * 4 + 3]! - washFrame.data[index * 4 + 3]!;
      if (difference !== 0) moved++;
      delta.push(difference / 255);
      heights.push(paper.values[index]!);
    }
  }

  return {
    alphaDeltaMovedPixels: moved,
    midBandRatio: round(metrics.midBandRatio, 6),
    lowBandRatio: round(metrics.lowBandRatio, 6),
    highBandRatio: round(metrics.highBandRatio, 6),
    midBandRatioGainVsSmoothWash: round(metrics.midBandRatio / washBaselineGrain.midBandRatio, 3),
    midBandPowerNormalised: round(metrics.midBandPowerNormalised, 9),
    midBandPeakPeriodPx: round(metrics.midBandPeakPeriodPx, 3),
    // 알파가 한 계단도 안 움직이면 상관은 정의되지 않는다 — NaN을 흘리지 않고 0으로 남긴다.
    alphaDeltaHeightCorrelation: moved === 0 ? 0 : round(pearson(delta, heights), 4),
  };
}

const grainStats: Record<string, GrainRecord> = {};
for (const kind of PAPER_GRAIN_KINDS) {
  for (const profile of [
    PIGMENT_GRANULATION_PROFILES.find((entry) => entry.id === "ultramarine-blue")!,
    PIGMENT_GRANULATION_PROFILES.find((entry) => entry.id === "sumi-ink")!,
    PIGMENT_GRANULATION_PROFILES.find((entry) => entry.id === "phthalo-blue")!,
  ]) {
    grainStats[`${kind}/${profile.id}`] = measureGrainFor(kind, profile.granulation, profile.staining);
  }
}

// ---------------------------------------------------------------------------
// 게이트
// ---------------------------------------------------------------------------

describe("종이 결 통계 — 세목 < 중목 < 황목", () => {
  it("RMS 거칠기가 프리셋 순서대로 유의하게 커진다", () => {
    const hot = paperStats["hot-press"].rmsRoughness;
    const cold = paperStats["cold-press"].rmsRoughness;
    const rough = paperStats.rough.rmsRoughness;
    expect(hot).toBeGreaterThan(0);
    expect(cold).toBeGreaterThan(hot * 1.5);
    expect(rough).toBeGreaterThan(cold * 1.3);
  });

  it("자기상관 길이(결의 굵기)도 같은 순서로 커진다", () => {
    const hot = paperStats["hot-press"].autocorrelationX;
    const cold = paperStats["cold-press"].autocorrelationX;
    const rough = paperStats.rough.autocorrelationX;
    expect(cold).toBeGreaterThan(hot * 1.35);
    expect(rough).toBeGreaterThan(cold * 1.35);
  });

  it("중목은 섬유 방향 이방성을 갖고 세목은 등방성이다", () => {
    // cold-press의 fibreAnisotropy 1.55 → 결이 가로로 늘어나 x 상관길이가 길다.
    expect(paperStats["cold-press"].fibreAnisotropyMeasured).toBeGreaterThan(1.3);
    expect(PAPER_TEXTURE_PRESETS["cold-press"].fibreAnisotropy).toBeGreaterThan(1);
    // hot-press는 이방성 1 → 측정값도 1 근처.
    expect(Math.abs(paperStats["hot-press"].fibreAnisotropyMeasured - 1)).toBeLessThan(0.15);
  });

  it("타일 경계 계단이 내부 인접 계단을 넘지 않는다(이음선 없음)", () => {
    // Classical watercolor grades keep the strict 1.25 seam budget; specialty surfaces
    // (canvas weave / long washi fibre) may sit slightly higher while still tiling periodically.
    const classical = ["hot-press", "cold-press", "rough"] as const;
    for (const kind of classical) {
      const stats = paperStats[kind];
      expect(stats.seamRatioX).toBeLessThanOrEqual(1.25);
      expect(stats.seamRatioY).toBeLessThanOrEqual(1.25);
    }
    for (const kind of PAPER_GRAIN_KINDS) {
      const stats = paperStats[kind];
      expect(stats.seamRatioX, kind).toBeLessThanOrEqual(1.5);
      expect(stats.seamRatioY, kind).toBeLessThanOrEqual(1.5);
    }
  });

  it("주기 경계에서 정확히 같은 값을 샘플링한다", () => {
    for (const kind of PAPER_GRAIN_KINDS) {
      const field = fields.get(kind)!;
      for (const probe of [0, 7, 63, 127]) {
        expect(samplePaperHeight(field, TILE + probe, probe)).toBe(samplePaperHeight(field, probe, probe));
        expect(samplePaperHeight(field, probe, TILE + probe)).toBe(samplePaperHeight(field, probe, probe));
        expect(samplePaperHeight(field, -TILE + probe, probe)).toBe(samplePaperHeight(field, probe, probe));
      }
    }
  });

  it("높이는 0..1 안에 있고 평균은 0.5 근처다", () => {
    for (const kind of PAPER_GRAIN_KINDS) {
      const stats = paperStats[kind];
      expect(stats.min).toBeGreaterThanOrEqual(0);
      expect(stats.max).toBeLessThanOrEqual(1);
      expect(Math.abs(stats.mean - 0.5)).toBeLessThan(0.01);
    }
  });
});

describe("입자 침착 — 균일 워시가 종이 골에 몰린다", () => {
  it("종이가 없을 때 분산 0이던 워시가 종이 위에서 분산을 얻는다", () => {
    expect(granulationStats["granulation-off"]!.standardDeviation).toBe(0);
    expect(granulationStats["ultramarine-blue"]!.standardDeviation).toBeGreaterThan(0.05);
    expect(granulationStats["ultramarine-blue"]!.coefficientOfVariation).toBeGreaterThan(0.15);
  });

  it("침착 패턴이 종이 높이맵과 강한 음의 상관을 보인다(골에 몰림)", () => {
    expect(granulationStats["ultramarine-blue"]!.heightCorrelation).toBeLessThan(-0.8);
    expect(granulationStats["burnt-umber"]!.heightCorrelation).toBeLessThan(-0.8);
    expect(granulationStats["sumi-ink"]!.heightCorrelation).toBeLessThan(-0.8);
  });

  it("granulating 안료와 staining 안료의 침착 세기가 확연히 다르다", () => {
    const granulating = granulationStats["ultramarine-blue"]!.coefficientOfVariation;
    const staining = granulationStats["phthalo-blue"]!.coefficientOfVariation;
    expect(granulating).toBeGreaterThan(staining * 20);
  });

  it("총 안료량은 보존된다(재배치만 일어난다)", () => {
    for (const stats of Object.values(granulationStats)) {
      expect(Math.abs(stats.mean - UNIFORM_WASH)).toBeLessThan(1e-6);
    }
  });

  it("국소 워시(원형)에서도 총 안료량이 보존된다", () => {
    const settled = settlePigmentOnPaper(
      { pigment: washPigment, paper: coldPress },
      { strength: 0.88, staining: 0.12 },
    );
    expect(mean(settled) * settled.length).toBeCloseTo(baselineRing.totalPigment, 2);
    // 워시 바깥의 마른 종이에는 침착이 생기지 않는다.
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (Math.hypot(x - WASH_CENTER, y - WASH_CENTER) <= WASH_RADIUS) continue;
        expect(settled[y * TILE + x]!).toBe(0);
      }
    }
  });

  it("strength 0이면 입력을 그대로 돌려준다(조작 감지)", () => {
    const settled = settlePigmentOnPaper({ pigment: uniformWash, paper: coldPress }, { strength: 0 });
    expect(Array.from(settled)).toEqual(Array.from(uniformWash));
  });

  it("종이가 거칠수록 같은 안료가 더 강하게 뭉친다", () => {
    const byKind = PAPER_GRAIN_KINDS.map((kind) => {
      const settled = settlePigmentOnPaper(
        { pigment: uniformWash, paper: fields.get(kind)! },
        { strength: 0.88, staining: 0.12 },
      );
      return standardDeviation(settled);
    });
    expect(byKind[1]!).toBeGreaterThan(byKind[0]! * 1.5);
    expect(byKind[2]!).toBeGreaterThan(byKind[1]! * 1.3);
  });
});

describe("그레인 스펙트럼 — 매끈한 워시에 dab 스케일 질감이 생긴다", () => {
  it("기준 워시는 브러시 랩의 wash-soft처럼 중주파가 비어 있다", () => {
    expect(GRAIN_BANDS).toEqual({ lowMax: 1 / 32, midMax: 1 / 8 });
    expect(washBaselineGrain.lowBandRatio).toBeGreaterThan(0.9);
    // 랩 실측 wash-soft(0.036476)와 같은 "질감 없음" 영역이다.
    expect(washBaselineGrain.midBandRatio).toBeLessThan(LAB_WASH_SOFT_MID_BAND_RATIO * 1.5);
  });

  it("granulating 안료는 중주파 비율을 여러 배로 끌어올린다", () => {
    // Ultramarine mid-band gain is calibrated on classical watercolor tooth; specialty
    // papers only need a clear gain over the smooth wash baseline.
    for (const kind of ["hot-press", "cold-press", "rough"] as const) {
      const record = grainStats[`${kind}/ultramarine-blue`]!;
      expect(record.midBandRatioGainVsSmoothWash).toBeGreaterThan(5);
      expect(record.midBandRatio).toBeGreaterThan(LAB_WASH_SOFT_MID_BAND_RATIO * 4);
    }
    for (const kind of PAPER_GRAIN_KINDS) {
      const record = grainStats[`${kind}/ultramarine-blue`]!;
      expect(record.midBandRatioGainVsSmoothWash, kind).toBeGreaterThan(2);
    }
  });

  it("상승분의 공간 패턴이 종이 높이맵과 음의 상관이다(골에 몰림)", () => {
    let checked = 0;
    for (const [key, record] of Object.entries(grainStats)) {
      // 알파가 한 계단도 안 움직인 조합(=효과 없음)은 상관이 정의되지 않는다.
      if (record.alphaDeltaMovedPixels === 0) continue;
      expect(record.alphaDeltaHeightCorrelation, key).toBeLessThan(-0.8);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(PAPER_GRAIN_KINDS.length * 2);
  });

  it("staining 안료는 중주파를 거의 올리지 못한다(조작 감지)", () => {
    for (const kind of ["hot-press", "cold-press", "rough"] as const) {
      const staining = grainStats[`${kind}/phthalo-blue`]!;
      const granulating = grainStats[`${kind}/ultramarine-blue`]!;
      expect(staining.midBandRatioGainVsSmoothWash).toBeLessThan(1.5);
      expect(granulating.midBandRatio).toBeGreaterThan(staining.midBandRatio * 5);
      // 세목 위의 staining 안료는 8bit 알파를 한 계단도 못 움직인다 = 눈에 보이지 않는다.
      expect(granulating.alphaDeltaMovedPixels).toBeGreaterThan(staining.alphaDeltaMovedPixels);
    }
  });
});

describe("가장자리 어두워짐 — 마른 원형 워시에 링이 남는다", () => {
  it("링 평균 밀도가 중심부보다 유의하게 높다", () => {
    expect(baselineRing.ringToCore).toBe(1);
    expect(edgeStats.full!.ringToCore).toBeGreaterThan(1.35);
    expect(edgeStats["studio-default"]!.ringToCore).toBeGreaterThan(1.1);
  });

  it("강도가 커질수록 링 대비가 단조 증가한다", () => {
    expect(edgeStats.gentle!.ringToCore).toBeGreaterThan(edgeStats.off!.ringToCore);
    expect(edgeStats["studio-default"]!.ringToCore).toBeGreaterThan(edgeStats.gentle!.ringToCore);
    expect(edgeStats.full!.ringToCore).toBeGreaterThan(edgeStats["studio-default"]!.ringToCore);
  });

  it("strength 0이면 효과가 비트 단위로 사라진다(조작 감지)", () => {
    expect(edgeStats.off!.ringToCore).toBe(1);
    expect(Array.from(edgeResults.get("off")!)).toEqual(Array.from(washPigment));
  });

  it("이송은 안료를 옮길 뿐 만들거나 없애지 않는다", () => {
    for (const stats of Object.values(edgeStats)) {
      expect(Math.abs(stats.totalPigment - baselineRing.totalPigment)).toBeLessThan(1e-2);
    }
  });

  it("마른 바깥(젖지 않은 셀)으로는 안료가 새지 않는다", () => {
    const dried = edgeResults.get("full")!;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        if (Math.hypot(x - WASH_CENTER, y - WASH_CENTER) <= WASH_RADIUS) continue;
        expect(dried[y * TILE + x]!).toBe(0);
      }
    }
  });
});

describe("결정성", () => {
  it("같은 시드는 같은 sha, 다른 시드는 다른 sha를 낸다", () => {
    for (const kind of PAPER_GRAIN_KINDS) {
      const repeat = createPaperHeightField({ kind, width: TILE, height: TILE, seed: SEED });
      expect(fieldSha(repeat)).toBe(paperStats[kind].sha256);
      const shifted = createPaperHeightField({ kind, width: TILE, height: TILE, seed: SEED + 1 });
      expect(fieldSha(shifted)).not.toBe(paperStats[kind].sha256);
    }
  });

  it("종류가 다르면 같은 시드여도 다른 높이맵이다", () => {
    const shas = new Set(PAPER_GRAIN_KINDS.map((kind) => paperStats[kind].sha256));
    expect(shas.size).toBe(PAPER_GRAIN_KINDS.length);
  });

  it("건조 파이프라인도 같은 입력에 같은 출력을 낸다", () => {
    const first = accumulateEdgeDarkening(
      { pigment: washPigment, wetness: washWetness, width: TILE, height: TILE },
      { strength: 0.6, steps: 6 },
    );
    const second = accumulateEdgeDarkening(
      { pigment: washPigment, wetness: washWetness, width: TILE, height: TILE },
      { strength: 0.6, steps: 6 },
    );
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});

describe("방어적 입력", () => {
  it("잘못된 기하나 짧은 버퍼는 조용히 통과하지 않고 즉시 실패한다", () => {
    expect(() =>
      accumulateEdgeDarkening(
        { pigment: new Float32Array(4), wetness: new Float32Array(4), width: 8, height: 8 },
        { strength: 1 },
      ),
    ).toThrow(RangeError);
    expect(() =>
      accumulateEdgeDarkening(
        { pigment: new Float32Array(4), wetness: new Float32Array(4), width: 0, height: 4 },
        { strength: 1 },
      ),
    ).toThrow(RangeError);
    expect(() => settlePigmentOnPaper({ pigment: new Float32Array(8), paper: coldPress }, { strength: 1 })).toThrow(
      RangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// 실측 기록 — 타임스탬프 없이 결정적으로 써서 물리 변화가 git diff로 드러나게 한다.
// ---------------------------------------------------------------------------

afterAll(() => {
  const report = {
    source: "tests/visual/paper-granulation.test.ts",
    reference: "Curtis et al. 1997, Computer-Generated Watercolor (SIGGRAPH) — edge darkening / granulation",
    deterministic: true,
    tile: { width: TILE, height: TILE, seed: SEED },
    paperPresets: PAPER_TEXTURE_PRESETS,
    paperStats,
    granulation: {
      uniformWashLevel: UNIFORM_WASH,
      paper: "cold-press",
      byPigment: granulationStats,
    },
    edgeDarkening: {
      wash: { radius: WASH_RADIUS, ringBand: [RING_INNER, 1], coreBand: [0, CORE_OUTER] },
      baseline: baselineRing,
      byCase: edgeStats,
    },
    grainSpectrum: {
      ruler: "tests/benchmarks/harness/brush-texture-lab.ts grainMetrics (64px window, DC removed, Hann taper, separable 2D DFT)",
      bands: GRAIN_BANDS,
      note:
        "브러시 랩의 wash-soft 실측 midBandRatio 0.036476(저주파 96.2%)이 '재질 질감 없음' 기준선이다. "
        + "이 표는 종이 커널만 잰 것이며 libmypaint/hokusai 렌더 경로와 무관하므로 랩 게이트 밴드에는 영향이 없다 "
        + "— 브러시 경로가 종이 커널을 채택할 때 그 밴드를 함께 갱신해야 한다.",
      labWashSoftMidBandRatio: LAB_WASH_SOFT_MID_BAND_RATIO,
      smoothWashBaseline: {
        windowMeanAlpha: round(washBaselineGrain.windowMeanAlpha, 6),
        midBandRatio: round(washBaselineGrain.midBandRatio, 6),
        lowBandRatio: round(washBaselineGrain.lowBandRatio, 6),
        highBandRatio: round(washBaselineGrain.highBandRatio, 6),
        midBandPeakPeriodPx: round(washBaselineGrain.midBandPeakPeriodPx, 3),
      },
      byPaperAndPigment: grainStats,
    },
  };
  mkdirSync(join(__dirname, "..", "benchmarks", "results"), { recursive: true });
  writeFileSync(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
});
