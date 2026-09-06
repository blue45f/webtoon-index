import { describe, expect, it } from "vitest";

import {
  NODE_SMOOTH_DEFAULT_STRENGTH,
  NODE_SMOOTH_DRAG_RANGE_PX,
  NODE_SMOOTH_MIN_WINDOW_POINTS,
  NODE_SMOOTH_RADIUS_PX,
  catmullRomPoint,
  evaluateCatmullRomChain,
  findSmoothWindow,
  smoothPointsAroundIndex,
  updateSmoothStrengthDrag,
} from "./studio-curve-smoothing";

/** 직선을 따라 n개 점을 spacing 간격으로 생성 — [0,0, spacing,0, 2*spacing,0, ...]. */
function straightLinePoints(n: number, spacing = 1): number[] {
  return Array.from({ length: n }, (_, i) => [i * spacing, 0]).flat();
}

/** points 사본에서 pointIndex 의 y 값만 교체 — 톱니 스파이크 등 테스트용 노이즈 주입. */
function withYAt(points: readonly number[], pointIndex: number, y: number): number[] {
  const out = points.slice();
  out[pointIndex * 2 + 1] = y;
  return out;
}

describe("catmullRomPoint", () => {
  const p0 = { x: 0, y: 5 };
  const p1 = { x: 2, y: 7 };
  const p2 = { x: 9, y: -3 };
  const p3 = { x: 4, y: 1 };

  it("t=0 이면 p1 과 정확히 일치한다", () => {
    expect(catmullRomPoint(p0, p1, p2, p3, 0)).toEqual(p1);
  });

  it("t=1 이면 p2 와 정확히 일치한다", () => {
    expect(catmullRomPoint(p0, p1, p2, p3, 1)).toEqual(p2);
  });

  it("등간격 공선(축 정렬) 제어점은 순수 선형 보간과 일치한다", () => {
    const line = { a: { x: -1, y: 0 }, b: { x: 0, y: 0 }, c: { x: 1, y: 0 }, d: { x: 2, y: 0 } };
    for (const t of [0.25, 0.5, 0.75]) {
      const q = catmullRomPoint(line.a, line.b, line.c, line.d, t);
      expect(q.x).toBeCloseTo(t, 9);
      expect(q.y).toBeCloseTo(0, 9);
    }
  });

  it("등간격 공선(대각선) 제어점도 순수 선형 보간과 일치한다", () => {
    // p_i = (i, 2i) — x/y 모두 등간격 공선.
    const a = { x: -1, y: -2 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 2 };
    const d = { x: 2, y: 4 };
    const q = catmullRomPoint(a, b, c, d, 0.4);
    expect(q.x).toBeCloseTo(0.4, 9);
    expect(q.y).toBeCloseTo(0.8, 9);
  });
});

describe("evaluateCatmullRomChain", () => {
  it("제어점이 0개면 원점으로 방어적 폴백한다", () => {
    expect(evaluateCatmullRomChain([], 0.5)).toEqual({ x: 0, y: 0 });
  });

  it("제어점이 1개면 u 와 무관하게 그 점을 그대로 반환한다", () => {
    const only = { x: 5, y: 9 };
    expect(evaluateCatmullRomChain([only], 0)).toEqual(only);
    expect(evaluateCatmullRomChain([only], 0.5)).toEqual(only);
    expect(evaluateCatmullRomChain([only], 3)).toEqual(only);
  });

  it("u=0 이면 첫 제어점과, u=마지막 인덱스면 마지막 제어점과 정확히 일치한다", () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 5, y: 8 },
      { x: 10, y: 0 },
    ];
    expect(evaluateCatmullRomChain(cps, 0)).toEqual(cps[0]);
    expect(evaluateCatmullRomChain(cps, 2)).toEqual(cps[2]);
  });

  it("u 가 범위를 벗어나면 양 끝으로 clamp 된다", () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 5, y: 8 },
      { x: 10, y: 0 },
    ];
    expect(evaluateCatmullRomChain(cps, -5)).toEqual(cps[0]);
    expect(evaluateCatmullRomChain(cps, 99)).toEqual(cps[2]);
  });

  it("정수 u 는 내부 제어점이라도 정확히 지난다(세그먼트 경계)", () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
    ];
    expect(evaluateCatmullRomChain(cps, 1)).toEqual(cps[1]);
    expect(evaluateCatmullRomChain(cps, 2)).toEqual(cps[2]);
  });

  it("제어점 2개(최소 구성)에서는 순수 선형 보간으로 퇴화한다", () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 10, y: 20 },
    ];
    const q = evaluateCatmullRomChain(cps, 0.5);
    expect(q.x).toBeCloseTo(5, 9);
    expect(q.y).toBeCloseTo(10, 9);
  });
});

describe("findSmoothWindow", () => {
  it("빈 points 는 {lo:0, hi:0}", () => {
    expect(findSmoothWindow([], 0)).toEqual({ lo: 0, hi: 0 });
  });

  it("radiusPx 가 점 간격보다 작으면 anchor 자신만 포함한다", () => {
    // radiusPx=0 은 sanitizePositive 관례상 "미지정"으로 취급돼 기본 반경(60)으로 폴백한다
    // (studio-node-edit.ts 의 minSpacingPx/rangePx 와 동일 관례) — 그래서 0 이 아니라 점 간격
    // (spacing=1)보다 작은 유효 양수(0.5)로 "확장 불가"를 검증한다.
    const points = straightLinePoints(11, 1);
    expect(findSmoothWindow(points, 5, 0.5)).toEqual({ lo: 5, hi: 5 });
  });

  it("직선 위 앞뒤로 대칭에 가깝게 확장한다", () => {
    const points = straightLinePoints(21, 1);
    expect(findSmoothWindow(points, 10, 3)).toEqual({ lo: 7, hi: 13 });
  });

  it("스트로크 시작 근처에서는 앞쪽이 짧게(0으로 클램프) 잘린다", () => {
    const points = straightLinePoints(21, 1);
    expect(findSmoothWindow(points, 2, 100)).toEqual({ lo: 0, hi: 20 });
  });

  it("스트로크 끝 근처에서는 뒤쪽이 짧게 잘려 비대칭 창이 된다", () => {
    const points = straightLinePoints(21, 1);
    expect(findSmoothWindow(points, 18, 5)).toEqual({ lo: 13, hi: 20 });
  });

  it("범위 밖 anchorIndex 는 points 범위 안으로 클램프된다", () => {
    const points = straightLinePoints(11, 1);
    expect(findSmoothWindow(points, -5, 2)).toEqual({ lo: 0, hi: 2 });
    expect(findSmoothWindow(points, 999, 2)).toEqual({ lo: 8, hi: 10 });
  });
});

describe("smoothPointsAroundIndex", () => {
  it("strength<=0(0 또는 음수)이면 값은 동일하되 항상 새 배열을 반환한다", () => {
    const points = straightLinePoints(11, 1);
    const zero = smoothPointsAroundIndex(points, 5, 0);
    const negative = smoothPointsAroundIndex(points, 5, -0.5);
    expect(zero).toEqual(points);
    expect(zero).not.toBe(points);
    expect(negative).toEqual(points);
    expect(negative).not.toBe(points);
  });

  it("출력 길이는 anchor/strength 유효성과 무관하게 항상 입력과 같다", () => {
    const points = straightLinePoints(11, 1);
    expect(smoothPointsAroundIndex(points, 5, 1)).toHaveLength(points.length);
    expect(smoothPointsAroundIndex(points, -1, 1)).toHaveLength(points.length);
    expect(smoothPointsAroundIndex(points, 5, 0)).toHaveLength(points.length);
    expect(smoothPointsAroundIndex([], 0, 1)).toHaveLength(0);
  });

  it("창 경계(lo/hi) 점은 강도가 최대여도 원래 위치 그대로다(seam 방지)", () => {
    // 창 내부에 스파이크를 여러 개 흩뿌려도 lo/hi 자체는 항상 원본과 정확히 같아야 한다.
    let points = straightLinePoints(21, 1);
    points = withYAt(points, 8, 40);
    points = withYAt(points, 12, -30);
    const { lo, hi } = findSmoothWindow(points, 10, 3);
    const result = smoothPointsAroundIndex(points, 10, 1, { radiusPx: 3 });
    expect([result[lo * 2], result[lo * 2 + 1]]).toEqual([points[lo * 2], points[lo * 2 + 1]]);
    expect([result[hi * 2], result[hi * 2 + 1]]).toEqual([points[hi * 2], points[hi * 2 + 1]]);
  });

  it("창 밖 점은 좌표가 전혀 변하지 않는다", () => {
    const points = straightLinePoints(41, 1);
    const result = smoothPointsAroundIndex(points, 20, 1, { radiusPx: 3 });
    // anchor=20, radius=3 → window 은 [17,23] 부근뿐 — 훨씬 먼 인덱스는 확실히 창 밖이다.
    for (const idx of [0, 1, 5, 35, 39, 40]) {
      expect(result[idx * 2]).toBe(points[idx * 2]);
      expect(result[idx * 2 + 1]).toBe(points[idx * 2 + 1]);
    }
  });

  it("범위 밖 anchorIndex(음수/초과/비정수)는 원본과 동일한 값의 복사본을 반환한다", () => {
    const points = straightLinePoints(11, 1);
    expect(smoothPointsAroundIndex(points, -1, 1)).toEqual(points);
    expect(smoothPointsAroundIndex(points, 11, 1)).toEqual(points);
    expect(smoothPointsAroundIndex(points, 5.5, 1)).toEqual(points);
  });

  it("같은 입력에는 항상 같은 출력을 낸다(결정적)", () => {
    const points = withYAt(straightLinePoints(21, 1), 10, 25);
    const a = smoothPointsAroundIndex(points, 10, 0.6, { radiusPx: 5 });
    const b = smoothPointsAroundIndex(points, 10, 0.6, { radiusPx: 5 });
    expect(a).toEqual(b);
  });

  it("strength 는 항상 [0,1] 로 클램프된다", () => {
    const points = withYAt(straightLinePoints(21, 1), 10, 25);
    const over = smoothPointsAroundIndex(points, 10, 5, { radiusPx: 5 });
    const atOne = smoothPointsAroundIndex(points, 10, 1, { radiusPx: 5 });
    const under = smoothPointsAroundIndex(points, 10, -3, { radiusPx: 5 });
    const atZero = smoothPointsAroundIndex(points, 10, 0, { radiusPx: 5 });
    expect(over).toEqual(atOne);
    expect(under).toEqual(atZero);
  });

  it("창이 NODE_SMOOTH_MIN_WINDOW_POINTS 미만이면 스무딩을 조용히 생략한다", () => {
    const points = straightLinePoints(50, 1);
    // anchor=0(스트로크 맨 앞) + radius=1 → 창은 [0,1] 2점뿐, MIN_WINDOW_POINTS(5) 미만.
    const result = smoothPointsAroundIndex(points, 0, 1, { radiusPx: 1 });
    expect(result).toEqual(points);
    expect(NODE_SMOOTH_MIN_WINDOW_POINTS).toBeGreaterThan(2);
  });

  it("톱니 스파이크 한 점은 강도가 커질수록 기준선(y=0)에 더 가까워진다(회귀 가드)", () => {
    // anchor 자신은 목표 곡선 제어점 후보에서 제외되므로, anchor 를 제외한 창 안의 모든 점이
    // y=0 위에 있으면 목표 곡선의 y 성분은 창 전체에서 정확히 0 이 된다 — 그러므로 스파이크의
    // blended y = origY*(1-strength) 를 강하게(부동소수 오차 없이) 예측할 수 있다.
    // radiusPx 는 넉넉히 크게 잡는다 — findSmoothWindow 의 호길이는 "현재" 좌표로 재는데,
    // anchor 바로 옆 세그먼트가 스파이크(hypot(1,50)≈50)를 포함해 급격히 길어지므로, 반경이
    // 그 첫 걸음 길이보다 작으면 창이 anchor 하나로 붕괴해(§min-window 가드) 스무딩 자체가
    // 생략돼버린다(이 좁은 반경 함정은 findSmoothWindow 자체의 버그가 아니라 이 테스트가
    // 창을 충분히 넓게 요청해야 한다는 뜻).
    const points = withYAt(straightLinePoints(21, 1), 10, 50);
    const at = (strength: number) => {
      const out = smoothPointsAroundIndex(points, 10, strength, { radiusPx: 100 });
      return out[10 * 2 + 1]!;
    };

    const y02 = at(0.2);
    const y06 = at(0.6);
    const y10 = at(1.0);

    expect(y02).toBeCloseTo(50 * 0.8, 6);
    expect(y06).toBeCloseTo(50 * 0.4, 6);
    expect(y10).toBe(0);

    // 강도가 커질수록 단조적으로 기준선에 접근한다(초기 구현에서 실패했던 비단조 회귀).
    expect(Math.abs(y06)).toBeLessThan(Math.abs(y02));
    expect(Math.abs(y10)).toBeLessThan(Math.abs(y06));
  });

  it("anchor 가 창 경계(스트로크 맨 앞)에 있어도 정상 동작하고 그 점 자체는 불변이다", () => {
    const points = straightLinePoints(30, 1);
    const result = smoothPointsAroundIndex(points, 0, 1, { radiusPx: 10 });
    expect(result).toHaveLength(points.length);
    expect(result[0]).toBe(points[0]);
    expect(result[1]).toBe(points[1]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const points = withYAt(straightLinePoints(21, 1), 10, 50);
    const copy = points.slice();
    smoothPointsAroundIndex(points, 10, 1, { radiusPx: 10 });
    expect(points).toEqual(copy);
  });

  it("opts 없이 호출해도(기본 반경 사용) 정상 동작한다", () => {
    const points = withYAt(straightLinePoints(21, 1), 10, 50);
    const result = smoothPointsAroundIndex(points, 10, 0.5);
    expect(result).toHaveLength(points.length);
    expect(NODE_SMOOTH_RADIUS_PX).toBe(60);
    // 기본 반경(60)은 21점(총 길이 20) 스트로크 전체를 가볍게 덮으므로 스파이크가 실제로 움직인다.
    expect(result[10 * 2 + 1]).not.toBe(50);
  });

  it("anchor 가 아닌 창 내부의 다른 점도 강도가 커질수록 단조적으로 기준선에 접근한다(회귀 가드 확장)", () => {
    // 위 "톱니 스파이크" 회귀 가드는 anchor 자신의 단조성만 검증한다. 핵심 설계 결정 1(목표
    // 곡선은 strength 와 무관하게 창 하나당 한 번만 계산되고, blend 는 순수 선형)이 사실이라면
    // 이 단조성은 anchor 뿐 아니라 창 안의 **모든** 점에 대해 성립해야 한다 — anchor 가 아닌
    // 인덱스(8)에 스파이크를 둬서 이를 별도로 확인한다. anchor(10)는 이번엔 스파이크가 없으므로
    // 제어점 후보에서 제외돼도 무해하고, 인덱스 8 은 위 anchor=10 케이스와 동일한 창/제어점
    // 선정(lo=0,hi=20,keyIndices=[0,1,11,19,20])에 들어가지 않는 "내부 비제어점"이라 목표 y 는
    // 여전히 정확히 0(모든 제어점의 y=0)이다 — blended y = origY*(1-strength) 를 그대로 예측한다.
    const points = withYAt(straightLinePoints(21, 1), 8, 30);
    const at = (strength: number) => smoothPointsAroundIndex(points, 10, strength, { radiusPx: 100 })[8 * 2 + 1]!;

    const y03 = at(0.3);
    const y07 = at(0.7);
    const y10 = at(1.0);

    expect(y03).toBeCloseTo(30 * 0.7, 6);
    expect(y07).toBeCloseTo(30 * 0.3, 6);
    expect(y10).toBe(0);
    expect(Math.abs(y07)).toBeLessThan(Math.abs(y03));
    expect(Math.abs(y10)).toBeLessThan(Math.abs(y07));
  });

  it("점이 1개뿐인 스트로크에서도 크래시하지 않고 원본과 동일한 값을 반환한다", () => {
    const points = [5, 9];
    expect(smoothPointsAroundIndex(points, 0, 1)).toEqual(points);
  });

  it("스트로크 전체 점 개수가 MIN_WINDOW_POINTS 미만이면 기본(넓은) 반경에서도 스무딩을 생략한다", () => {
    // 위 "창이 MIN_WINDOW_POINTS 미만" 테스트는 radiusPx 를 일부러 작게 줘서 창을 좁힌 경우다.
    // 여기서는 반경과 무관하게 스트로크 자체가 3점뿐이라 창이 절대 5점에 도달할 수 없는,
    // 별도 경로(스트로크 끝에서 lo/hi 가 동시에 클램프)를 검증한다.
    const points = straightLinePoints(3, 1);
    const result = smoothPointsAroundIndex(points, 1, 1);
    expect(result).toEqual(points);
  });

  it("points 길이가 홀수(오염된 입력)여도 낙오 좌표를 무시하고 크래시 없이 나머지를 정상 처리한다", () => {
    // nodeEditPointCount 는 Math.floor(length/2) 이므로 마지막 홀수 낙오 요소는 어떤 점의
    // 좌표로도 읽히지 않는다 — 그 요소가 출력에서도 그대로(변형 없이) 보존되는지까지 확인한다.
    const clean = straightLinePoints(11, 1);
    const points = [...clean, 999];
    let result: number[] = [];
    expect(() => {
      result = smoothPointsAroundIndex(points, 5, 1);
    }).not.toThrow();
    expect(result).toHaveLength(points.length);
    expect(result[22]).toBe(999);
  });
});

describe("updateSmoothStrengthDrag", () => {
  it("위로 끌면(pointerY < startPointerY) 강도가 baseline 보다 커진다", () => {
    const next = updateSmoothStrengthDrag(0.4, 100, 60, 160);
    expect(next).toBeCloseTo(0.65, 9);
    expect(next).toBeGreaterThan(0.4);
  });

  it("아래로 끌면(pointerY > startPointerY) 강도가 baseline 보다 작아진다", () => {
    const next = updateSmoothStrengthDrag(0.4, 100, 140, 160);
    expect(next).toBeCloseTo(0.15, 9);
    expect(next).toBeLessThan(0.4);
  });

  it("드래그가 없으면(pointerY===startPointerY) baseline 그대로다", () => {
    expect(updateSmoothStrengthDrag(0.7, 100, 100, 160)).toBe(0.7);
  });

  it("극단적으로 끌어도 결과는 항상 [0,1] 로 클램프된다", () => {
    expect(updateSmoothStrengthDrag(0.4, 100, -1e6, 160)).toBe(1);
    expect(updateSmoothStrengthDrag(0.4, 100, 1e6, 160)).toBe(0);
  });

  it("baselineStrength 가 비유한(NaN)이면 기본 강도로 폴백한다", () => {
    expect(updateSmoothStrengthDrag(NaN, 100, 100, 160)).toBe(NODE_SMOOTH_DEFAULT_STRENGTH);
  });

  it("baselineStrength 가 범위를 벗어난 유한값이면 경계로 클램프된다(폴백이 아니라 clamp)", () => {
    expect(updateSmoothStrengthDrag(5, 100, 100, 160)).toBe(1);
    expect(updateSmoothStrengthDrag(-2, 100, 100, 160)).toBe(0);
  });

  it("rangePx 가 0 이하/비유한이면 기본 드래그 범위로 대체된다", () => {
    const withDefault = updateSmoothStrengthDrag(0.4, 100, 60);
    const withZero = updateSmoothStrengthDrag(0.4, 100, 60, 0);
    const withNegative = updateSmoothStrengthDrag(0.4, 100, 60, -10);
    expect(withZero).toBeCloseTo(withDefault, 9);
    expect(withNegative).toBeCloseTo(withDefault, 9);
    expect(NODE_SMOOTH_DRAG_RANGE_PX).toBe(160);
  });
});
