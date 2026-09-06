import { describe, expect, it } from "vitest";

import {
  getKaleidoscopePoints,
  kaleidoscopePointVariations,
  mirrorAxisAngle,
  wedgeBoundaryAngle,
  type KaleidoscopeSpec,
} from "./studio-kaleidoscope";

// ---------------------------------------------------------------------------
// StudioPage.tsx의 기존 getSymmetricPoints radial 분기를 그대로 옮겨온 참조 구현 — "mirror=false면
// 기존 radial과 바이트 단위로 동일해야 한다"는 회귀 방지 계약을 이 사본과 직접 대조해 고정한다
// (이 저장소 컨벤션 — 순수 모듈마다 자체 테스트 픽스처를 갖고, StudioPage.tsx를 import하지 않는다).
// ---------------------------------------------------------------------------
function referenceRadial(points: number[], cx: number, cy: number, count: number): number[][] {
  const result: number[][] = [points];
  for (let s = 1; s < count; s++) {
    const angle = (s * 2 * Math.PI) / count;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated: number[] = [];
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      if (x !== undefined && y !== undefined) {
        const dx = x - cx;
        const dy = y - cy;
        rotated.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
      }
    }
    result.push(rotated);
  }
  return result;
}

describe("wedgeBoundaryAngle / mirrorAxisAngle", () => {
  it("wedgeBoundaryAngle은 0..2π를 radialCount 등분한다", () => {
    expect(wedgeBoundaryAngle(0, 4)).toBeCloseTo(0);
    expect(wedgeBoundaryAngle(1, 4)).toBeCloseTo(Math.PI / 2);
    expect(wedgeBoundaryAngle(2, 4)).toBeCloseTo(Math.PI);
    expect(wedgeBoundaryAngle(3, 4)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("mirrorAxisAngle은 wedgeBoundaryAngle의 정확히 절반 스텝이다(대수적 동치의 전제)", () => {
    for (const count of [3, 4, 6, 8]) {
      for (let s = 0; s < count; s++) {
        expect(mirrorAxisAngle(s, count)).toBeCloseTo(wedgeBoundaryAngle(s, count) / 2);
      }
    }
  });

  it("mirrorAxisAngle(0..count-1)은 0..π 구간을 count등분한다", () => {
    expect(mirrorAxisAngle(0, 6)).toBeCloseTo(0);
    expect(mirrorAxisAngle(6, 6)).toBeCloseTo(Math.PI); // count번째(범위 밖)는 정확히 π — 등분 검산용
  });
});

describe("kaleidoscopePointVariations — 점 하나 변환", () => {
  it("mirror=false면 정확히 radialCount개(원본 포함)를 반환한다", () => {
    const spec: KaleidoscopeSpec = { centerX: 0, centerY: 0, radialCount: 6, mirror: false };
    const out = kaleidoscopePointVariations({ x: 10, y: 0 }, spec);
    expect(out).toHaveLength(6);
    expect(out[0]).toEqual({ x: 10, y: 0 });
  });

  it("mirror=true면 2*radialCount개를 반환한다", () => {
    const spec: KaleidoscopeSpec = { centerX: 0, centerY: 0, radialCount: 6, mirror: true };
    const out = kaleidoscopePointVariations({ x: 10, y: 0 }, spec);
    expect(out).toHaveLength(12);
  });

  it("radialCount 미지정/0/NaN은 4로 정규화된다(기존 radial 기본값과 동일)", () => {
    const base = { centerX: 0, centerY: 0, mirror: false } as const;
    expect(kaleidoscopePointVariations({ x: 1, y: 0 }, { ...base })).toHaveLength(4);
    expect(kaleidoscopePointVariations({ x: 1, y: 0 }, { ...base, radialCount: 0 })).toHaveLength(4);
    expect(kaleidoscopePointVariations({ x: 1, y: 0 }, { ...base, radialCount: Number.NaN })).toHaveLength(4);
  });

  it("반사 축각도 0(mirror family의 s=0)은 기존 'horizontal' 대칭(y만 반전)과 동일하다", () => {
    const spec: KaleidoscopeSpec = { centerX: 5, centerY: 7, radialCount: 4, mirror: true };
    const out = kaleidoscopePointVariations({ x: 12, y: 20 }, spec);
    // out[4] = family B의 s=0 (out[0..3]이 회전 계열, out[4]부터 반사 계열)
    const mirrored = out[4];
    expect(mirrored?.x).toBeCloseTo(12); // x는 그대로
    expect(mirrored?.y).toBeCloseTo(7 * 2 - 20); // y는 cy 기준 반전 — 기존 horizontal 공식과 동일
  });

  it("반사 축각도 π/2(mirror family의 count/4번째, count=4일 때 s=2)는 기존 'vertical' 대칭(x만 반전)과 동일하다", () => {
    const spec: KaleidoscopeSpec = { centerX: 5, centerY: 7, radialCount: 4, mirror: true };
    const out = kaleidoscopePointVariations({ x: 12, y: 20 }, spec);
    // mirrorAxisAngle(2, 4) = 2*(π/4) = π/2
    const mirrored = out[4 + 2];
    expect(mirrored?.x).toBeCloseTo(5 * 2 - 12); // x는 cx 기준 반전 — 기존 vertical 공식과 동일
    expect(mirrored?.y).toBeCloseTo(20); // y는 그대로
  });
});

describe("getKaleidoscopePoints — 스트로크(평탄 좌표 배열) 변환", () => {
  it("mirror=false면 기존 StudioPage radial 분기와 바이트 단위로 동일하다(회귀 고정)", () => {
    const points = [12, 34, 56, 78, 9, 100];
    for (const count of [3, 4, 6, 8, 12]) {
      const spec: KaleidoscopeSpec = { centerX: 40, centerY: 60, radialCount: count, mirror: false };
      const actual = getKaleidoscopePoints(points, spec);
      const expected = referenceRadial(points, 40, 60, count);
      expect(actual).toHaveLength(expected.length);
      for (let v = 0; v < expected.length; v++) {
        const a = actual[v] ?? [];
        const e = expected[v] ?? [];
        expect(a).toHaveLength(e.length);
        for (let i = 0; i < e.length; i++) expect(a[i]).toBeCloseTo(e[i] as number);
      }
    }
  });

  it("mirror=true면 회전 N개 뒤에 반사 N개가 이어져 총 2N개 변형을 반환한다", () => {
    const points = [10, 0, 20, 0];
    const spec: KaleidoscopeSpec = { centerX: 0, centerY: 0, radialCount: 5, mirror: true };
    const result = getKaleidoscopePoints(points, spec);
    expect(result).toHaveLength(10);
    // 앞 5개(인덱스 0..4)는 mirror=false일 때와 동일해야 한다(회전 계열은 mirror 여부와 무관).
    const rotationOnly = getKaleidoscopePoints(points, { ...spec, mirror: false });
    expect(result.slice(0, 5)).toEqual(rotationOnly);
  });

  it("원본은 항상 결과의 첫 항목으로 그대로 보존된다(참조 동일성 — getSymmetricPoints 관례)", () => {
    const points = [1, 2, 3, 4];
    const spec: KaleidoscopeSpec = { centerX: 0, centerY: 0, radialCount: 6, mirror: true };
    const result = getKaleidoscopePoints(points, spec);
    expect(result[0]).toBe(points);
  });

  it("빈 점 배열은 [points] 그대로 반환한다(기존 getSymmetricPoints의 points.length===0 가드와 동일)", () => {
    const points: number[] = [];
    const spec: KaleidoscopeSpec = { centerX: 0, centerY: 0, radialCount: 6, mirror: true };
    expect(getKaleidoscopePoints(points, spec)).toEqual([[]]);
  });

  it("홀수 길이 좌표 배열은 마지막 낙오 좌표를 무시한다(기존 분기와 동일한 방어)", () => {
    const points = [10, 0, 99]; // 마지막 99는 짝이 없다
    const spec: KaleidoscopeSpec = { centerX: 0, centerY: 0, radialCount: 4, mirror: false };
    const result = getKaleidoscopePoints(points, spec);
    expect(result[1]).toHaveLength(2); // 낙오 좌표는 버려지고 (x,y) 한 쌍만 변환된다
  });

  it("여러 방향 벡터에 대해 반사가 실제로 등거리 대칭(원 위의 점 보존)임을 확인한다", () => {
    const cx = 100;
    const cy = 200;
    const radius = 37;
    const points = [cx + radius, cy]; // 중심에서 radius만큼 떨어진 점 하나
    const spec: KaleidoscopeSpec = { centerX: cx, centerY: cy, radialCount: 7, mirror: true };
    const result = getKaleidoscopePoints(points, spec);
    for (const variation of result) {
      const x = variation[0] as number;
      const y = variation[1] as number;
      expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(radius); // 회전/반사 둘 다 원점으로부터 거리 보존
    }
  });
});
