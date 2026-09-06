import { describe, expect, it } from "vitest";

import {
  createStudioIncrementalAngledNibCoverageBuilder,
  planStudioAngledNibStrokeLocalCoverage,
} from "./studio-stroke-local-coverage";

/** 결정적 의사난수 — 테스트 재현성. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function growingStroke(random: () => number, pointCount: number): {
  points: number[];
  pressures: number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  let x = 70;
  let y = 130;
  let heading = -0.3;
  for (let index = 0; index < pointCount; index += 1) {
    if (random() < 0.05 && index > 0) {
      // 퇴화 세그먼트(면적 0): normalize 가 폴리곤을 거부하는 분기.
      points.push(points[points.length - 2]!, points[points.length - 1]!);
    } else {
      heading += (random() - 0.45) * 0.6;
      x += Math.cos(heading) * (2 + random() * 8);
      y += Math.sin(heading) * (2 + random() * 8);
      points.push(x, y);
    }
    pressures.push(0.15 + random() * 0.8);
  }
  return { points, pressures };
}

describe("createStudioIncrementalAngledNibCoverageBuilder", () => {
  it("matches the batch planner exactly across growth without pressure input", () => {
    const random = mulberry32(0xa4b1);
    const { points } = growingStroke(random, 150);
    const builder = createStudioIncrementalAngledNibCoverageBuilder();
    for (let pairCount = 1; pairCount <= 150; pairCount += 1) {
      const prefix = points.slice(0, pairCount * 2);
      const incremental = builder.plan(prefix, 18, -Math.PI / 6, null);
      const batch = planStudioAngledNibStrokeLocalCoverage(prefix, 18, -Math.PI / 6, null);
      expect(incremental).toEqual({ ...batch });
    }
  });

  it("matches the batch planner exactly on cold builds with canonical pressures", () => {
    // 필압 응답은 소비 시점 진행률로 잠근다: 콜드 1회 소비는 배치와 같은 최종 카운트로
    // 계산하므로 정확히 일치하고, 성장 소비의 유지 값은 ulp 수준만 다르다(아래 시험).
    const random = mulberry32(0xbe7a);
    const { points, pressures } = growingStroke(random, 90);
    for (const pairCount of [3, 20, 55, 90]) {
      const builder = createStudioIncrementalAngledNibCoverageBuilder();
      const input = {
        profileId: "marker-chisel" as const,
        pressures: pressures.slice(0, pairCount),
        minimumDiameterRatio: 0.2,
        elementOpacity: 0.85,
      };
      const prefix = points.slice(0, pairCount * 2);
      expect(builder.plan(prefix, 18, -Math.PI / 6, input)).toEqual({
        ...planStudioAngledNibStrokeLocalCoverage(prefix, 18, -Math.PI / 6, input),
      });
    }
  });

  it("stays within float-lock tolerance across pressured growth", () => {
    const random = mulberry32(0x5a17);
    const { points, pressures } = growingStroke(random, 120);
    const builder = createStudioIncrementalAngledNibCoverageBuilder();
    for (let pairCount = 2; pairCount <= 120; pairCount += 7) {
      const input = {
        profileId: "brush" as const,
        pressures: pressures.slice(0, pairCount),
        elementOpacity: 0.9,
      };
      const prefix = points.slice(0, pairCount * 2);
      const incremental = builder.plan(prefix, 18, -Math.PI / 6, input);
      const batch = planStudioAngledNibStrokeLocalCoverage(prefix, 18, -Math.PI / 6, input);
      expect(incremental.acceptedSegmentCount).toBe(batch.acceptedSegmentCount);
      expect(incremental.polygons.length).toBe(batch.polygons.length);
      for (let index = 0; index < batch.polygons.length; index += 1) {
        const left = incremental.polygons[index]!.points;
        const right = batch.polygons[index]!.points;
        expect(left.length).toBe(right.length);
        for (let coordinate = 0; coordinate < right.length; coordinate += 1) {
          expect(left[coordinate]!).toBeCloseTo(right[coordinate]!, 9);
        }
      }
    }
  });

  it("rebuilds to exact parity on shrink, rewrite, config change, and delegates non-parallel pressures", () => {
    const random = mulberry32(0x9d2c);
    const { points, pressures } = growingStroke(random, 60);
    const builder = createStudioIncrementalAngledNibCoverageBuilder();
    builder.plan(points, 18, -Math.PI / 6, null);
    const shrunk = points.slice(0, 30 * 2);
    expect(builder.plan(shrunk, 18, -Math.PI / 6, null)).toEqual({
      ...planStudioAngledNibStrokeLocalCoverage(shrunk, 18, -Math.PI / 6, null),
    });
    const rewritten = shrunk.slice();
    rewritten[58] = rewritten[58]! - 12;
    expect(builder.plan(rewritten, 18, -Math.PI / 6, null)).toEqual({
      ...planStudioAngledNibStrokeLocalCoverage(rewritten, 18, -Math.PI / 6, null),
    });
    expect(builder.plan(rewritten, 24, -Math.PI / 5, null)).toEqual({
      ...planStudioAngledNibStrokeLocalCoverage(rewritten, 24, -Math.PI / 5, null),
    });
    // 나란하지 않은 필압: 전방 보간이 배열 길이에 소급 의존하므로 배치로 위임한다.
    const nonParallel = {
      profileId: "brush" as const,
      pressures: pressures.slice(0, 7),
      elementOpacity: 1,
    };
    expect(builder.plan(rewritten, 24, -Math.PI / 5, nonParallel)).toEqual(
      planStudioAngledNibStrokeLocalCoverage(rewritten, 24, -Math.PI / 5, nonParallel),
    );
    // 무효 폭/각: 배치의 빈 플랜 그대로.
    expect(builder.plan(rewritten, 0, -Math.PI / 5, null)).toEqual({
      ...planStudioAngledNibStrokeLocalCoverage(rewritten, 0, -Math.PI / 5, null),
    });
  });
});
