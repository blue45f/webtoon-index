// 실측 몸통 실루엣 단위 테스트 — 재단(studio-vrm-wardrobe)이 이 모듈 하나에 통째로 기대므로
// "링이 그럴듯하게 나왔나"가 아니라 계약이 깨지는 지점을 노려서 짠다: 표본이 모자란 실측 거절,
// 이물(머리카락·장식) 배제, 빈 구간 보간, 손상된 입력 정규화, 서명의 충돌 여부.
//
// 합성 몸통은 전부 균등 각도 타원이라 난수도 시간도 쓰지 않는다 — 같은 입력이면 같은 링이다.

import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_BODY_SILHOUETTE_VERSION,
  bodySilhouetteSignature,
  buildBodySilhouette,
  narrowestHalfWidthBetween,
  percentileOfSorted,
  sampleBodySilhouette,
  sanitizeBodySilhouette,
  widestHalfWidth,
} from "./studio-vrm-body-silhouette";

import type {
  BodySilhouette,
  BodySilhouetteRing,
  BodySilhouetteSample,
} from "./studio-vrm-body-silhouette";

/** 모듈 기본 분할 수. 테스트가 링 인덱스를 t 로 되짚을 때 쓴다. */
const DEFAULT_RINGS = 12;

/** 모듈이 실측으로 인정하는 최소 링 수(MIN_VALID_RINGS). 비공개 상수라 여기서 한 번만 적는다. */
const MIN_VALID_RINGS = 4;

/** 한 높이의 균등 각도 타원. count 를 40 이상으로 두면 상위 분위수가 참값의 98.8% 근처로 수렴한다. */
function ellipseRing(
  t: number,
  halfWidth: number,
  halfDepth: number,
  count: number,
  centerX = 0,
  centerZ = 0,
): BodySilhouetteSample[] {
  const samples: BodySilhouetteSample[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (2 * Math.PI * index) / count;
    samples.push({
      t,
      x: centerX + halfWidth * Math.cos(angle),
      z: centerZ + halfDepth * Math.sin(angle),
    });
  }
  return samples;
}

// 엉덩이(t=0)에서 가슴(t=1)으로 갈수록 폭은 좁아지고 깊이는 깊어지는 합성 몸통.
// 깊이 비율이 0.64 → 0.96 으로 움직이므로 "전 구간 고정 타원" 구현은 이 몸통을 못 따라간다.
const HIP_HALF_WIDTH = 0.18;
const CHEST_HALF_WIDTH = 0.13;
const HIP_HALF_DEPTH = 0.115;
const CHEST_HALF_DEPTH = 0.125;

const halfWidthAt = (t: number): number => HIP_HALF_WIDTH + (CHEST_HALF_WIDTH - HIP_HALF_WIDTH) * t;
const halfDepthAt = (t: number): number => HIP_HALF_DEPTH + (CHEST_HALF_DEPTH - HIP_HALF_DEPTH) * t;

function taperedTorso(perRing = 40, rings = DEFAULT_RINGS): BodySilhouetteSample[] {
  const samples: BodySilhouetteSample[] = [];
  for (let index = 0; index < rings; index += 1) {
    const t = (index + 0.5) / rings;
    samples.push(...ellipseRing(t, halfWidthAt(t), halfDepthAt(t), perRing));
  }
  return samples;
}

/** null 을 그대로 흘리면 `!` 가 번지므로, 실측 실패는 여기서 테스트 실패로 바꾼다. */
function requireSilhouette(silhouette: BodySilhouette | null): BodySilhouette {
  if (!silhouette) throw new Error("expected a measured silhouette, got null");
  return silhouette;
}

function ring(
  t: number,
  halfWidth: number,
  halfDepth: number,
  centerX = 0,
  centerZ = 0,
): BodySilhouetteRing {
  return { t, halfWidth, halfDepth, centerX, centerZ };
}

function silhouetteOf(rings: readonly BodySilhouetteRing[], sampleCount = 480): BodySilhouette {
  return {
    version: STUDIO_VRM_BODY_SILHOUETTE_VERSION,
    source: "measured",
    rings,
    sampleCount,
    measuredRingCount: rings.length,
  };
}

/** 밖으로 나가도 되는 실루엣의 불변식 — 재단이 이걸 전제로 링을 읽는다. */
function isWellFormed(silhouette: BodySilhouette): boolean {
  if (silhouette.source !== "measured") return false;
  if (silhouette.version !== STUDIO_VRM_BODY_SILHOUETTE_VERSION) return false;
  if (silhouette.rings.length < MIN_VALID_RINGS) return false;
  if (!Number.isInteger(silhouette.sampleCount) || silhouette.sampleCount < 0) return false;
  return silhouette.rings.every((current, index) => {
    if (index > 0 && current.t <= silhouette.rings[index - 1].t) return false;
    return (
      Number.isFinite(current.t) &&
      Number.isFinite(current.centerX) &&
      Number.isFinite(current.centerZ) &&
      current.halfWidth > 0 &&
      Number.isFinite(current.halfWidth) &&
      current.halfDepth > 0 &&
      Number.isFinite(current.halfDepth)
    );
  });
}

const FOUR_RINGS: readonly BodySilhouetteRing[] = [
  ring(0.1, 0.2, 0.12, 0.001, 0.01),
  ring(0.4, 0.14, 0.1, 0.002, 0.02),
  ring(0.7, 0.16, 0.11),
  ring(0.9, 0.18, 0.13),
];

describe("percentileOfSorted", () => {
  it("returns 0 for an empty sample list", () => {
    expect(percentileOfSorted([], 0.92)).toBe(0);
    expect(percentileOfSorted([], 0)).toBe(0);
  });

  it("returns the only sample for every percentile of a single-element list", () => {
    expect(percentileOfSorted([0.42], 0)).toBe(0.42);
    expect(percentileOfSorted([0.42], 0.5)).toBe(0.42);
    expect(percentileOfSorted([0.42], 1)).toBe(0.42);
  });

  it("hits the exact endpoints at p=0 and p=1", () => {
    expect(percentileOfSorted([1, 2, 3, 4], 0)).toBe(1);
    expect(percentileOfSorted([1, 2, 3, 4], 1)).toBe(4);
    expect(percentileOfSorted([10, 20], 0)).toBe(10);
    expect(percentileOfSorted([10, 20], 1)).toBe(20);
  });

  it("interpolates linearly between two neighbouring samples", () => {
    expect(percentileOfSorted([10, 20], 0.25)).toBe(12.5);
    expect(percentileOfSorted([10, 20], 0.5)).toBe(15);
    expect(percentileOfSorted([0, 1, 2, 3], 0.5)).toBe(1.5);
    // position = 0.1 * 3 = 0.3 → sorted[0] + 0.3 * (sorted[1] - sorted[0])
    expect(percentileOfSorted([0, 10, 20, 30], 0.1)).toBeCloseTo(3, 10);
  });

  it("clamps a percentile outside [0,1] instead of reading past the array", () => {
    expect(percentileOfSorted([1, 2, 3, 4], -3)).toBe(1);
    expect(percentileOfSorted([1, 2, 3, 4], 9)).toBe(4);
    expect(percentileOfSorted([1, 2, 3, 4], Number.NEGATIVE_INFINITY)).toBe(1);
    expect(percentileOfSorted([1, 2, 3, 4], Number.POSITIVE_INFINITY)).toBe(4);
  });

  it("never leaves the sample range for any percentile in a deterministic sweep", () => {
    const sorted = [0.01, 0.04, 0.09, 0.16, 0.25, 0.36];
    for (let step = 0; step <= 20; step += 1) {
      const value = percentileOfSorted(sorted, step / 20);
      expect(value).toBeGreaterThanOrEqual(sorted[0]);
      expect(value).toBeLessThanOrEqual(sorted[sorted.length - 1]);
    }
  });

  it("is monotonically non-decreasing in the percentile", () => {
    const sorted = [0.02, 0.02, 0.05, 0.31, 0.33, 0.9];
    let previous = Number.NEGATIVE_INFINITY;
    for (let step = 0; step <= 40; step += 1) {
      const value = percentileOfSorted(sorted, step / 40);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe("buildBodySilhouette", () => {
  it("returns null when fewer than four heights carry enough samples", () => {
    const threeHeights = [
      ...ellipseRing(0.04, 0.15, 0.1, 10),
      ...ellipseRing(0.12, 0.15, 0.1, 10),
      ...ellipseRing(0.21, 0.15, 0.1, 10),
    ];
    expect(buildBodySilhouette(threeHeights, DEFAULT_RINGS)).toBeNull();
  });

  it("does not count a height with fewer than six samples as measured", () => {
    const threeHeights = [
      ...ellipseRing(0.04, 0.15, 0.1, 10),
      ...ellipseRing(0.12, 0.15, 0.1, 10),
      ...ellipseRing(0.21, 0.15, 0.1, 10),
    ];
    // 다섯 개짜리 구간은 링이 되지 못하므로 유효 링은 여전히 3개다.
    expect(buildBodySilhouette([...threeHeights, ...ellipseRing(0.3, 0.15, 0.1, 5)], DEFAULT_RINGS)).toBeNull();
    expect(buildBodySilhouette([...threeHeights, ...ellipseRing(0.3, 0.15, 0.1, 6)], DEFAULT_RINGS)).not.toBeNull();
  });

  it("returns null when every sample is unusable", () => {
    const garbage: BodySilhouetteSample[] = [
      { t: Number.NaN, x: 0.1, z: 0.1 },
      { t: 0.5, x: Number.NaN, z: 0.1 },
      { t: 0.5, x: 0.1, z: Number.POSITIVE_INFINITY },
      { t: 1.4, x: 0.1, z: 0.1 },
      { t: -0.2, x: 0.1, z: 0.1 },
    ];
    expect(buildBodySilhouette(garbage, DEFAULT_RINGS)).toBeNull();
    expect(buildBodySilhouette([], DEFAULT_RINGS)).toBeNull();
  });

  it("skips NaN, infinite and out-of-[0,1] samples instead of poisoning the rings", () => {
    const clean = [
      ...ellipseRing(0.04, 0.15, 0.1, 10),
      ...ellipseRing(0.12, 0.15, 0.1, 10),
      ...ellipseRing(0.21, 0.15, 0.1, 10),
      ...ellipseRing(0.3, 0.15, 0.1, 10),
    ];
    const dirty: BodySilhouetteSample[] = [
      ...clean,
      { t: Number.NaN, x: 0.1, z: 0.1 },
      { t: 0.5, x: Number.POSITIVE_INFINITY, z: 0.1 },
      { t: 0.5, x: 0.1, z: Number.NEGATIVE_INFINITY },
      { t: 0.5, x: 0.1, z: Number.NaN },
      { t: 1.0001, x: 0.1, z: 0.1 },
      { t: -0.0001, x: 0.1, z: 0.1 },
    ];
    const silhouette = requireSilhouette(buildBodySilhouette(dirty, DEFAULT_RINGS));

    // 버려진 표본은 개수에도 잡히지 않는다 — 영수증이 실측량을 부풀리면 안 된다.
    expect(silhouette.sampleCount).toBe(40);
    expect(silhouette.rings).toEqual(requireSilhouette(buildBodySilhouette(clean, DEFAULT_RINGS)).rings);
    for (const current of silhouette.rings) {
      expect(Number.isFinite(current.halfWidth)).toBe(true);
      expect(Number.isFinite(current.halfDepth)).toBe(true);
      expect(Number.isFinite(current.centerX)).toBe(true);
      expect(Number.isFinite(current.centerZ)).toBe(true);
    }
  });

  it("keeps samples sitting exactly on t=0 and t=1", () => {
    // 네 구간 각각에 표본을 하나씩 두는데, 경계 표본이 버려지면 유효 링이 3개가 되어 null 이 된다.
    const edges = [
      ...ellipseRing(0, 0.2, 0.1, 8),
      ...ellipseRing(0.3, 0.2, 0.1, 8),
      ...ellipseRing(0.6, 0.2, 0.1, 8),
      ...ellipseRing(1, 0.2, 0.1, 8),
    ];
    const silhouette = requireSilhouette(buildBodySilhouette(edges, 4));
    expect(silhouette.sampleCount).toBe(32);
    expect(silhouette.rings.map((current) => current.t)).toEqual([0.125, 0.375, 0.625, 0.875]);
  });

  it("tracks a tapering synthetic torso at every ring", () => {
    const silhouette = requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS));
    expect(silhouette.source).toBe("measured");
    expect(silhouette.version).toBe(STUDIO_VRM_BODY_SILHOUETTE_VERSION);
    expect(silhouette.rings).toHaveLength(DEFAULT_RINGS);
    expect(silhouette.sampleCount).toBe(DEFAULT_RINGS * 40);

    for (const current of silhouette.rings) {
      const trueWidth = halfWidthAt(current.t);
      const trueDepth = halfDepthAt(current.t);
      // 상위 분위수라 참 표면보다 살짝 안쪽에 앉아야 한다 — 넘어가면 이물까지 먹은 것이다.
      expect(current.halfWidth / trueWidth).toBeGreaterThan(0.96);
      expect(current.halfWidth / trueWidth).toBeLessThanOrEqual(1);
      expect(current.halfDepth / trueDepth).toBeGreaterThan(0.96);
      expect(current.halfDepth / trueDepth).toBeLessThanOrEqual(1);
      expect(Math.abs(current.halfWidth - trueWidth)).toBeLessThan(0.005);
      expect(Math.abs(current.halfDepth - trueDepth)).toBeLessThan(0.005);
      // 중심이 원점인 몸통이므로 중심도 원점이어야 한다(0.5mm 이내).
      expect(Math.abs(current.centerX)).toBeLessThan(0.0005);
      expect(Math.abs(current.centerZ)).toBeLessThan(0.0005);
    }
  });

  it("follows an off-centre torso instead of assuming the spine is the centre", () => {
    // 배가 앞으로 나온 캐릭터: 단면 중심이 z 로 4cm 밀려 있다.
    const samples: BodySilhouetteSample[] = [];
    for (let index = 0; index < DEFAULT_RINGS; index += 1) {
      const t = (index + 0.5) / DEFAULT_RINGS;
      samples.push(...ellipseRing(t, 0.16, 0.12, 48, 0.03, 0.04));
    }
    const silhouette = requireSilhouette(buildBodySilhouette(samples, DEFAULT_RINGS));
    for (const current of silhouette.rings) {
      expect(current.centerX).toBeCloseTo(0.03, 3);
      expect(current.centerZ).toBeCloseTo(0.04, 3);
      // 중심이 밀렸다고 반경까지 커지면 안 된다.
      expect(Math.abs(current.halfWidth - 0.16)).toBeLessThan(0.005);
      expect(Math.abs(current.halfDepth - 0.12)).toBeLessThan(0.005);
    }
  });

  it("gives every ring its own depth ratio rather than one ellipse for the whole torso", () => {
    const silhouette = requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS));
    const ratios = silhouette.rings.map((current) => current.halfDepth / current.halfWidth);
    const first = ratios[0];
    const last = ratios[ratios.length - 1];
    expect(last).toBeGreaterThan(first * 1.35);
    for (let index = 1; index < ratios.length; index += 1) {
      expect(ratios[index]).toBeGreaterThan(ratios[index - 1]);
    }
  });

  it("does not let a handful of far outliers inflate a ring", () => {
    const clean = [
      ...ellipseRing(0.04, 0.15, 0.1, 80),
      ...ellipseRing(0.12, 0.15, 0.1, 80),
      ...ellipseRing(0.21, 0.15, 0.1, 80),
      ...ellipseRing(0.3, 0.15, 0.1, 80),
    ];
    // 몸통 본에 물린 머리카락 끝·장식: 가장 아래 구간에만 붙는 소수의 먼 정점.
    const strays: BodySilhouetteSample[] = [
      { t: 0.04, x: 0.62, z: 0.55 },
      { t: 0.04, x: -0.58, z: -0.51 },
      { t: 0.04, x: 0.71, z: 0.66 },
      { t: 0.04, x: -0.66, z: 0.6 },
    ];
    const measured = requireSilhouette(buildBodySilhouette(clean, DEFAULT_RINGS));
    const polluted = requireSilhouette(buildBodySilhouette([...clean, ...strays], DEFAULT_RINGS));

    // 최대값을 썼다면 60cm 대로 튀었을 링이다.
    expect(polluted.rings[0].halfWidth).toBeLessThan(0.16);
    expect(polluted.rings[0].halfDepth).toBeLessThan(0.11);
    expect(Math.abs(polluted.rings[0].halfWidth - measured.rings[0].halfWidth)).toBeLessThan(0.01);
    expect(Math.abs(polluted.rings[0].halfDepth - measured.rings[0].halfDepth)).toBeLessThan(0.01);
    // 다른 높이는 아예 건드리지 못한다.
    expect(polluted.rings.slice(1)).toEqual(measured.rings.slice(1));
    expect(polluted.sampleCount).toBe(measured.sampleCount + strays.length);
  });

  it("fills empty height buckets by interpolating between the measured neighbours", () => {
    const gapped = [
      ...ellipseRing(0.04, 0.2, 0.12, 20),
      ...ellipseRing(0.12, 0.2, 0.12, 20),
      ...ellipseRing(0.88, 0.1, 0.06, 20),
      ...ellipseRing(0.96, 0.1, 0.06, 20),
    ];
    const silhouette = requireSilhouette(buildBodySilhouette(gapped, DEFAULT_RINGS));
    expect(silhouette.rings).toHaveLength(DEFAULT_RINGS);

    const low = silhouette.rings[1];
    const high = silhouette.rings[10];
    expect(low.halfWidth).toBeGreaterThan(high.halfWidth);
    for (let index = 2; index <= 9; index += 1) {
      const filled = silhouette.rings[index];
      const ratio = (filled.t - low.t) / (high.t - low.t);
      expect(filled.halfWidth).toBeCloseTo(low.halfWidth + (high.halfWidth - low.halfWidth) * ratio, 10);
      expect(filled.halfDepth).toBeCloseTo(low.halfDepth + (high.halfDepth - low.halfDepth) * ratio, 10);
      // 보간된 링도 두 이웃 사이를 벗어나면 안 된다.
      expect(filled.halfWidth).toBeLessThan(low.halfWidth);
      expect(filled.halfWidth).toBeGreaterThan(high.halfWidth);
    }
  });

  it("clamps to the nearest measured ring outside the measured span instead of collapsing to zero", () => {
    // 3~8번 구간에만 표본이 있는 부분 실측: 위아래 구간은 가장 가까운 실측 링의 복사본이 된다.
    const partial: BodySilhouetteSample[] = [];
    for (let index = 3; index <= 8; index += 1) {
      const t = (index + 0.5) / DEFAULT_RINGS;
      partial.push(...ellipseRing(t, 0.17 - 0.02 * t, 0.1, 20));
    }
    const silhouette = requireSilhouette(buildBodySilhouette(partial, DEFAULT_RINGS));
    for (let index = 0; index < 3; index += 1) {
      expect(silhouette.rings[index].halfWidth).toBe(silhouette.rings[3].halfWidth);
      expect(silhouette.rings[index].halfDepth).toBe(silhouette.rings[3].halfDepth);
    }
    for (let index = 9; index < DEFAULT_RINGS; index += 1) {
      expect(silhouette.rings[index].halfWidth).toBe(silhouette.rings[8].halfWidth);
      expect(silhouette.rings[index].halfDepth).toBe(silhouette.rings[8].halfDepth);
    }
  });

  it("returns rings that strictly increase in t", () => {
    const dense = requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS));
    const gapped = requireSilhouette(
      buildBodySilhouette(
        [
          ...ellipseRing(0.04, 0.2, 0.12, 20),
          ...ellipseRing(0.12, 0.2, 0.12, 20),
          ...ellipseRing(0.88, 0.1, 0.06, 20),
          ...ellipseRing(0.96, 0.1, 0.06, 20),
        ],
        DEFAULT_RINGS,
      ),
    );
    for (const silhouette of [dense, gapped]) {
      expect(isWellFormed(silhouette)).toBe(true);
      for (let index = 1; index < silhouette.rings.length; index += 1) {
        expect(silhouette.rings[index].t).toBeGreaterThan(silhouette.rings[index - 1].t);
      }
      expect(silhouette.rings[0].t).toBeGreaterThan(0);
      expect(silhouette.rings[silhouette.rings.length - 1].t).toBeLessThan(1);
    }
  });

  it("clamps implausible radii into the metre range", () => {
    const giant: BodySilhouetteSample[] = [];
    const speck: BodySilhouetteSample[] = [];
    for (let index = 0; index < 4; index += 1) {
      const t = (index + 0.5) / DEFAULT_RINGS;
      giant.push(...ellipseRing(t, 5, 5, 20));
      speck.push(...ellipseRing(t, 0.0001, 0.0001, 20));
    }
    const wide = requireSilhouette(buildBodySilhouette(giant, DEFAULT_RINGS));
    const narrow = requireSilhouette(buildBodySilhouette(speck, DEFAULT_RINGS));
    for (const current of wide.rings) {
      expect(current.halfWidth).toBe(0.9);
      expect(current.halfDepth).toBe(0.9);
    }
    for (const current of narrow.rings) {
      expect(current.halfWidth).toBe(0.01);
      expect(current.halfDepth).toBe(0.01);
    }
  });

  it("normalises a broken ring count instead of producing an unusable profile", () => {
    const torso = taperedTorso();
    expect(requireSilhouette(buildBodySilhouette(torso, 0)).rings).toHaveLength(12);
    expect(requireSilhouette(buildBodySilhouette(torso, Number.NaN)).rings).toHaveLength(12);
    expect(requireSilhouette(buildBodySilhouette(torso, 12.9)).rings).toHaveLength(12);
    expect(requireSilhouette(buildBodySilhouette(torso, 1)).rings).toHaveLength(MIN_VALID_RINGS);
    expect(requireSilhouette(buildBodySilhouette(torso, -8)).rings).toHaveLength(MIN_VALID_RINGS);
    expect(requireSilhouette(buildBodySilhouette(torso, 1000)).rings).toHaveLength(24);
  });

  it("does not depend on the order the samples arrive in", () => {
    const torso = taperedTorso();
    const forward = requireSilhouette(buildBodySilhouette(torso, DEFAULT_RINGS));
    const reversed = requireSilhouette(buildBodySilhouette([...torso].reverse(), DEFAULT_RINGS));
    const interleaved = requireSilhouette(
      buildBodySilhouette(
        [...torso.filter((_, index) => index % 2 === 0), ...torso.filter((_, index) => index % 2 === 1)],
        DEFAULT_RINGS,
      ),
    );
    expect(reversed).toEqual(forward);
    expect(interleaved).toEqual(forward);
    expect(bodySilhouetteSignature(reversed)).toBe(bodySilhouetteSignature(forward));
  });
});

describe("sampleBodySilhouette", () => {
  const silhouette = silhouetteOf(FOUR_RINGS);

  it("reproduces a ring exactly at its own t", () => {
    for (const current of FOUR_RINGS) {
      const sampled = sampleBodySilhouette(silhouette, current.t);
      expect(sampled.halfWidth).toBeCloseTo(current.halfWidth, 12);
      expect(sampled.halfDepth).toBeCloseTo(current.halfDepth, 12);
      expect(sampled.centerX).toBeCloseTo(current.centerX, 12);
      expect(sampled.centerZ).toBeCloseTo(current.centerZ, 12);
    }
  });

  it("interpolates linearly between two rings", () => {
    const mid = sampleBodySilhouette(silhouette, 0.25);
    expect(mid.t).toBe(0.25);
    expect(mid.halfWidth).toBeCloseTo(0.17, 12);
    expect(mid.halfDepth).toBeCloseTo(0.11, 12);
    expect(mid.centerX).toBeCloseTo(0.0015, 12);
    expect(mid.centerZ).toBeCloseTo(0.015, 12);

    const quarter = sampleBodySilhouette(silhouette, 0.475);
    expect(quarter.halfWidth).toBeCloseTo(0.14 + (0.16 - 0.14) * 0.25, 12);
  });

  it("clamps below the first ring rather than collapsing to zero", () => {
    for (const t of [0.1, 0.05, 0, -0.4, -12]) {
      const sampled = sampleBodySilhouette(silhouette, t);
      expect(sampled.halfWidth).toBe(FOUR_RINGS[0].halfWidth);
      expect(sampled.halfDepth).toBe(FOUR_RINGS[0].halfDepth);
      expect(sampled.centerZ).toBe(FOUR_RINGS[0].centerZ);
    }
  });

  it("clamps above the last ring rather than collapsing to zero", () => {
    const last = FOUR_RINGS[FOUR_RINGS.length - 1];
    for (const t of [0.9, 0.95, 1, 4.5]) {
      const sampled = sampleBodySilhouette(silhouette, t);
      expect(sampled.halfWidth).toBe(last.halfWidth);
      expect(sampled.halfDepth).toBe(last.halfDepth);
      expect(sampled.centerZ).toBe(last.centerZ);
    }
  });

  it("stays inside the neighbouring rings across a deterministic sweep", () => {
    const widest = widestHalfWidth(silhouette);
    const narrowest = narrowestHalfWidthBetween(silhouette, 0, 1);
    for (let step = 0; step <= 60; step += 1) {
      const sampled = sampleBodySilhouette(silhouette, -0.2 + (step / 60) * 1.4);
      expect(sampled.halfWidth).toBeGreaterThanOrEqual(narrowest - 1e-12);
      expect(sampled.halfWidth).toBeLessThanOrEqual(widest + 1e-12);
      expect(Number.isFinite(sampled.halfDepth)).toBe(true);
    }
  });

  it("never answers with NaN radii for a non-finite t", () => {
    // 어느 링으로 접히든 상관없지만, NaN 반경이 나가면 재단 지오메트리가 통째로 깨진다.
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const sampled = sampleBodySilhouette(silhouette, t);
      expect(Number.isFinite(sampled.halfWidth)).toBe(true);
      expect(Number.isFinite(sampled.halfDepth)).toBe(true);
      expect(sampled.halfWidth).toBeGreaterThan(0);
    }
    expect(sampleBodySilhouette(silhouette, Number.NaN).halfWidth).toBe(FOUR_RINGS[0].halfWidth);
  });
});

describe("widestHalfWidth / narrowestHalfWidthBetween", () => {
  const silhouette = silhouetteOf(FOUR_RINGS);

  it("reports the widest ring of a known set", () => {
    expect(widestHalfWidth(silhouette)).toBe(0.2);
    expect(widestHalfWidth(silhouetteOf([ring(0.1, 0.11, 0.1), ring(0.2, 0.09, 0.1), ring(0.3, 0.31, 0.1), ring(0.4, 0.12, 0.1)]))).toBe(0.31);
  });

  it("reports the narrowest ring inside an inclusive range", () => {
    expect(narrowestHalfWidthBetween(silhouette, 0, 1)).toBe(0.14);
    expect(narrowestHalfWidthBetween(silhouette, 0.4, 0.7)).toBe(0.14);
    expect(narrowestHalfWidthBetween(silhouette, 0.5, 1)).toBe(0.16);
    expect(narrowestHalfWidthBetween(silhouette, 0.7, 0.7)).toBe(0.16);
  });

  it("falls back to the widest when the range selects nothing", () => {
    expect(narrowestHalfWidthBetween(silhouette, 0.41, 0.69)).toBe(0.2);
    expect(narrowestHalfWidthBetween(silhouette, 2, 3)).toBe(0.2);
    expect(narrowestHalfWidthBetween(silhouette, -3, -2)).toBe(0.2);
  });

  it("falls back to the widest for an inverted range", () => {
    expect(narrowestHalfWidthBetween(silhouette, 0.9, 0.1)).toBe(0.2);
  });
});

describe("sanitizeBodySilhouette", () => {
  it("rejects null, undefined and non-objects", () => {
    expect(sanitizeBodySilhouette(null)).toBeNull();
    expect(sanitizeBodySilhouette(undefined)).toBeNull();
    expect(sanitizeBodySilhouette(0)).toBeNull();
    expect(sanitizeBodySilhouette("measured")).toBeNull();
    expect(sanitizeBodySilhouette(true)).toBeNull();
    expect(sanitizeBodySilhouette([1, 2, 3])).toBeNull();
  });

  it("rejects a silhouette that is not a measurement", () => {
    expect(sanitizeBodySilhouette({ rings: FOUR_RINGS, sampleCount: 4 })).toBeNull();
    expect(sanitizeBodySilhouette({ source: "skeleton", rings: FOUR_RINGS, sampleCount: 4 })).toBeNull();
    expect(sanitizeBodySilhouette({ source: "guessed", rings: FOUR_RINGS, sampleCount: 4 })).toBeNull();
    expect(sanitizeBodySilhouette({ source: "Measured", rings: FOUR_RINGS, sampleCount: 4 })).toBeNull();
  });

  it("rejects a missing or non-array rings field", () => {
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured" })).toBeNull();
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: "x" })).toBeNull();
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: { 0: FOUR_RINGS[0] } })).toBeNull();
  });

  it("rejects fewer than four usable rings", () => {
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [], sampleCount: 0 })).toBeNull();
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: FOUR_RINGS.slice(0, 3), sampleCount: 3 })).toBeNull();
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [null, undefined, 1, "ring"], sampleCount: 4 })).toBeNull();
  });

  it("rejects duplicate and near-duplicate ring heights", () => {
    const duplicated = [ring(0.1, 0.2, 0.1), ring(0.1, 0.2, 0.1), ring(0.5, 0.2, 0.1), ring(0.8, 0.2, 0.1)];
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: duplicated, sampleCount: 4 })).toBeNull();
    const nearlyDuplicated = [ring(0.1, 0.2, 0.1), ring(0.1 + 1e-9, 0.2, 0.1), ring(0.5, 0.2, 0.1), ring(0.8, 0.2, 0.1)];
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: nearlyDuplicated, sampleCount: 4 })).toBeNull();
  });

  it("rejects a silhouette whose heights collapse onto each other after clamping", () => {
    // t 는 [-0.5, 1.5] 로 접히므로, 범위를 벗어난 두 링이 같은 값으로 무너지면 재단이 불가능하다.
    const collapsing = [ring(9, 0.2, 0.1), ring(10, 0.2, 0.1), ring(0.5, 0.2, 0.1), ring(0.7, 0.2, 0.1)];
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: collapsing, sampleCount: 4 })).toBeNull();
  });

  it("drops rings with non-finite radii and rejects when too few survive", () => {
    const withNaN = [
      ring(0.1, Number.NaN, 0.1),
      ring(0.3, 0.2, 0.1),
      ring(0.5, 0.2, 0.1),
      ring(0.7, 0.2, 0.1),
      ring(0.9, 0.2, 0.1),
    ];
    const survived = sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: withNaN, sampleCount: 9 });
    expect(survived?.rings.map((current) => current.t)).toEqual([0.3, 0.5, 0.7, 0.9]);

    const tooFewLeft = [
      ring(0.1, Number.NaN, 0.1),
      ring(0.3, 0.2, Number.POSITIVE_INFINITY),
      ring(0.5, 0.2, 0.1),
      ring(0.7, 0.2, 0.1),
      ring(Number.NaN, 0.2, 0.1),
      ring(0.9, 0.2, 0.1),
    ];
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: tooFewLeft, sampleCount: 9 })).toBeNull();
  });

  it("normalises negative and oversized radii instead of leaking them", () => {
    const broken = [ring(0.1, -0.5, -2), ring(0.3, 40, 40), ring(0.5, 0.2, 0.1), ring(0.7, 0.2, 0.1)];
    const sanitized = sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: broken, sampleCount: 9 });
    const rings = requireSilhouette(sanitized).rings;
    expect(rings[0].halfWidth).toBeCloseTo(0.01, 12);
    expect(rings[0].halfDepth).toBeCloseTo(0.01, 12);
    expect(rings[1].halfWidth).toBeCloseTo(0.9, 12);
    expect(rings[1].halfDepth).toBeCloseTo(0.9, 12);
  });

  it("defaults missing centres and a broken sample count", () => {
    const partial = [
      { t: 0.1, halfWidth: 0.2, halfDepth: 0.1 },
      { t: 0.3, halfWidth: 0.2, halfDepth: 0.1, centerX: Number.NaN, centerZ: 0.02 },
      { t: 0.5, halfWidth: 0.2, halfDepth: 0.1 },
      { t: 0.7, halfWidth: 0.2, halfDepth: 0.1 },
    ];
    const sanitized = requireSilhouette(
      sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: partial, sampleCount: Number.NaN }),
    );
    expect(sanitized.rings[0].centerX).toBe(0);
    expect(sanitized.rings[0].centerZ).toBe(0);
    expect(sanitized.rings[1].centerX).toBe(0);
    expect(sanitized.rings[1].centerZ).toBe(0.02);
    expect(sanitized.sampleCount).toBe(0);
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: partial, sampleCount: -7 })?.sampleCount).toBe(0);
    expect(sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: partial, sampleCount: 12.9 })?.sampleCount).toBe(12);
  });

  it("round-trips a measured silhouette unchanged", () => {
    const built = requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS));
    const restored = requireSilhouette(sanitizeBodySilhouette(built));
    expect(restored).toEqual(built);
    expect(bodySilhouetteSignature(restored)).toBe(bodySilhouetteSignature(built));
    // JSON 왕복(저장 → 로드)도 같은 실루엣이어야 한다.
    const throughJson = requireSilhouette(sanitizeBodySilhouette(JSON.parse(JSON.stringify(built)) as unknown));
    expect(throughJson).toEqual(built);
  });

  it("orders a scrambled ring list so the caller never sees a non-monotonic profile", () => {
    // 모듈 주석은 "t가 단조가 아니면 null"이라고 하지만 구현은 정렬해서 살린다. 어느 쪽이든
    // 밖으로 나가는 실루엣이 t 오름차순이라는 불변식은 반드시 지켜져야 한다.
    const scrambled = [ring(0.9, 0.11, 0.1), ring(0.1, 0.22, 0.1), ring(0.5, 0.33, 0.1), ring(0.7, 0.44, 0.1)];
    const sanitized = sanitizeBodySilhouette({ version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: scrambled, sampleCount: 4 });
    expect(sanitized === null || isWellFormed(sanitized)).toBe(true);
    const heights = sanitized === null ? [] : sanitized.rings.map((current) => current.t);
    const widths = sanitized === null ? [] : sanitized.rings.map((current) => current.halfWidth);
    expect(heights).toEqual([0.1, 0.5, 0.7, 0.9]);
    // 정렬은 링을 재배열할 뿐 데이터를 섞으면 안 된다.
    expect(widths).toEqual([0.22, 0.33, 0.44, 0.11]);
  });

  it("returns a fully formed silhouette or nothing at all", () => {
    const hostile: readonly unknown[] = [
      null,
      undefined,
      0,
      "",
      "measured",
      [],
      {},
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured" },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [] },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [ring(0.1, 0.2, 0.1)] },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [null, undefined, 1, "ring"], sampleCount: 4 },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [ring(0.1, 0.2, 0.1), ring(0.1, 0.2, 0.1), ring(0.5, 0.2, 0.1), ring(0.8, 0.2, 0.1)] },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [ring(0.1, 0, 0), ring(0.3, -1, -1), ring(0.5, 0.2, 0.1), ring(0.7, 0.2, 0.1)] },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: [ring(9, 0.2, 0.1), ring(10, 0.2, 0.1), ring(0.5, 0.2, 0.1), ring(0.7, 0.2, 0.1)] },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: FOUR_RINGS, sampleCount: Number.NaN },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: FOUR_RINGS, sampleCount: -12.5 },
      { version: STUDIO_VRM_BODY_SILHOUETTE_VERSION, source: "measured", rings: FOUR_RINGS.map((current) => ({ ...current, t: Number.NaN })) },
      { version: 7, source: "measured", rings: FOUR_RINGS, sampleCount: 4 },
      { source: "guessed", rings: FOUR_RINGS, sampleCount: 4 },
      requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS)),
    ];
    for (const [index, input] of hostile.entries()) {
      const sanitized = sanitizeBodySilhouette(input);
      const verdict = sanitized === null || isWellFormed(sanitized);
      expect({ index, verdict }).toEqual({ index, verdict: true });
    }
  });
});

describe("bodySilhouetteSignature", () => {
  const silhouette = silhouetteOf(FOUR_RINGS);
  const baseline = bodySilhouetteSignature(silhouette);

  it("reports none when there is no measurement", () => {
    expect(bodySilhouetteSignature(null)).toBe("none");
  });

  it("is stable for two equal silhouettes built independently", () => {
    const twin = silhouetteOf(FOUR_RINGS.map((current) => ({ ...current })), 480);
    expect(bodySilhouetteSignature(twin)).toBe(baseline);
    expect(bodySilhouetteSignature(silhouetteOf(FOUR_RINGS, 9_999))).toBe(baseline);
    const rebuilt = requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS));
    expect(bodySilhouetteSignature(rebuilt)).toBe(
      bodySilhouetteSignature(requireSilhouette(buildBodySilhouette(taperedTorso(), DEFAULT_RINGS))),
    );
  });

  it("changes when a ring's height, half-width or half-depth changes", () => {
    const wider = silhouetteOf([{ ...FOUR_RINGS[0], halfWidth: 0.21 }, ...FOUR_RINGS.slice(1)]);
    const deeper = silhouetteOf([{ ...FOUR_RINGS[0], halfDepth: 0.13 }, ...FOUR_RINGS.slice(1)]);
    const raised = silhouetteOf([{ ...FOUR_RINGS[0], t: 0.15 }, ...FOUR_RINGS.slice(1)]);
    expect(bodySilhouetteSignature(wider)).not.toBe(baseline);
    expect(bodySilhouetteSignature(deeper)).not.toBe(baseline);
    expect(bodySilhouetteSignature(raised)).not.toBe(baseline);
    expect(bodySilhouetteSignature(silhouetteOf(FOUR_RINGS.slice(0, 3)))).not.toBe(baseline);
  });

  it("changes when the torso centre moves front-to-back", () => {
    const bellied = silhouetteOf([{ ...FOUR_RINGS[0], centerZ: 0.05 }, ...FOUR_RINGS.slice(1)]);
    expect(bodySilhouetteSignature(bellied)).not.toBe(baseline);
  });

  // 좌우로 밀린 몸통은 다른 몸통이다. centerX 가 해시에서 빠져 있으면 캐시 무효화가 그 차이를
  // 놓치고 A 의 재단이 B 에게 그대로 재사용된다.
  it("changes when the torso centre moves left-to-right", () => {
    const shifted = silhouetteOf([{ ...FOUR_RINGS[0], centerX: 0.09 }, ...FOUR_RINGS.slice(1)]);
    expect(bodySilhouetteSignature(shifted)).not.toBe(baseline);
  });

  it("quantises sub-0.1mm jitter so re-measuring the same body keeps the cache warm", () => {
    const jittered = silhouetteOf([{ ...FOUR_RINGS[0], halfWidth: 0.2 + 1e-6 }, ...FOUR_RINGS.slice(1)]);
    expect(bodySilhouetteSignature(jittered)).toBe(baseline);
  });

  it("keeps the sil1 shape so a stored receipt stays comparable", () => {
    expect(baseline).toMatch(/^sil1:[0-9a-f]{8}$/);
  });
});

describe("measurement honesty", () => {
  /** 12칸 중 앞 5칸만 채운다 — 나머지 7칸은 이웃에서 보간될 수밖에 없다. */
  function partialTorso() {
    const samples = [];
    for (let bucket = 0; bucket < 5; bucket += 1) {
      for (let index = 0; index < 20; index += 1) {
        const t = (bucket + 0.5) / 12;
        const angle = (index / 20) * Math.PI * 2;
        samples.push({ t, x: Math.cos(angle) * 0.18, z: Math.sin(angle) * 0.11 });
      }
    }
    return samples;
  }

  it("reports how many rings were actually measured, not how many it returns", () => {
    const silhouette = buildBodySilhouette(partialTorso(), 12);
    expect(silhouette).not.toBeNull();
    expect(silhouette?.rings).toHaveLength(12);
    // 부풀리지 않는다: 실측은 5칸뿐이고 나머지는 이웃에서 채운 것이다.
    expect(silhouette?.measuredRingCount).toBe(5);
  });

  it("counts only the vertices that shaped a ring", () => {
    const samples = [
      ...partialTorso(),
      // 6개 미만이라 링이 되지 못하는 구간 — 이 정점들은 실측량에 들어가면 안 된다.
      { t: 0.95, x: 0.2, z: 0.1 },
      { t: 0.96, x: 0.2, z: 0.1 },
      { t: 0.97, x: 0.2, z: 0.1 },
    ];
    const silhouette = buildBodySilhouette(samples, 12);
    expect(silhouette?.sampleCount).toBe(100);
  });
});

describe("degradation instead of breakage", () => {
  it("rejects a silhouette whose version stamp is foreign or missing", () => {
    const foreign = { ...silhouetteOf(FOUR_RINGS), version: 7 };
    // 버전 도장은 다른 알고리즘의 측정을 무효화하라고 있는 것이다. 1로 다시 찍으면 안 된다.
    expect(sanitizeBodySilhouette(foreign)).toBeNull();

    // 도장이 아예 없는 것도 같다 — 어느 알고리즘이 만든 값인지 알 수 없으면 쓰지 않는다.
    const unstamped: Record<string, unknown> = { ...silhouetteOf(FOUR_RINGS) };
    delete unstamped.version;
    expect(sanitizeBodySilhouette(unstamped)).toBeNull();
  });

  it("bounds the ring centres, which the cut turns straight into radius", () => {
    const offset = silhouetteOf([{ ...FOUR_RINGS[0], centerX: 40, centerZ: -40 }, ...FOUR_RINGS.slice(1)]);
    const sanitized = sanitizeBodySilhouette(offset);
    expect(Math.abs(sanitized?.rings[0].centerX ?? 0)).toBeLessThanOrEqual(0.9);
    expect(Math.abs(sanitized?.rings[0].centerZ ?? 0)).toBeLessThanOrEqual(0.9);
  });

  it("falls back to a neutral radius rather than zero on a hand-built empty silhouette", () => {
    expect(widestHalfWidth(silhouetteOf([]))).toBeGreaterThan(0);
    expect(narrowestHalfWidthBetween(silhouetteOf([]), 0, 1)).toBeGreaterThan(0);
  });

  it("caps a stored measured-ring count at the rings that actually survived", () => {
    const inflated = { ...silhouetteOf(FOUR_RINGS), measuredRingCount: 99 };
    expect(sanitizeBodySilhouette(inflated)?.measuredRingCount).toBe(FOUR_RINGS.length);
  });

  it("returns a neutral ring instead of throwing on a hand-built empty silhouette", () => {
    const empty = silhouetteOf([]);
    const sampled = sampleBodySilhouette(empty, 0.5);
    expect(Number.isFinite(sampled.halfWidth)).toBe(true);
    expect(sampled.halfWidth).toBeGreaterThan(0);
    expect(sampled.t).toBe(0.5);
  });

  it("falls back to the widest half-width when a range bound is not a number", () => {
    const silhouette = silhouetteOf(FOUR_RINGS);
    const widest = widestHalfWidth(silhouette);
    expect(narrowestHalfWidthBetween(silhouette, Number.NaN, 1)).toBe(widest);
    expect(narrowestHalfWidthBetween(silhouette, 0, Number.NaN)).toBe(widest);
  });

  it("keeps a NaN percentile from poisoning a radius", () => {
    expect(percentileOfSorted([1, 2, 3, 4, 5], Number.NaN)).toBe(3);
  });
});
