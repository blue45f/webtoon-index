import { describe, expect, it } from "vitest";

import {
  STUDIO_ERASE_TO_INTERSECTION_LABEL,
  compareStudioStrokeParams,
  findStudioStrokeCuts,
  intersectStudioSegments,
  locateStudioStrokeHit,
  planStudioEraseToIntersection,
  studioStrokePiecePatchFields,
  type StudioEraseToIntersectionResult,
  type StudioStrokePiece,
} from "./studio-vector-erase-to-intersection";

// ---------------------------------------------------------------------------
// 픽스처 헬퍼 — 전부 결정적(난수 없음).
// ---------------------------------------------------------------------------

/** y 고정 수평선: x = 0, step, 2*step, ... length 까지. */
function horizontalStroke(length: number, step: number, y = 0): number[] {
  const out: number[] = [];
  for (let x = 0; x <= length; x += step) out.push(x, y);
  return out;
}

/** 세로 선분 1개(2점). */
function verticalStroke(x: number, y0: number, y1: number): number[] {
  return [x, y0, x, y1];
}

function expectOk(
  result: StudioEraseToIntersectionResult
): Extract<StudioEraseToIntersectionResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result;
}

function firstPoint(piece: StudioStrokePiece): [number, number] {
  return [piece.points[0] as number, piece.points[1] as number];
}

function lastPoint(piece: StudioStrokePiece): [number, number] {
  const n = piece.points.length;
  return [piece.points[n - 2] as number, piece.points[n - 1] as number];
}

// ---------------------------------------------------------------------------
// 선분–선분 교차(저수준)
// ---------------------------------------------------------------------------

describe("intersectStudioSegments", () => {
  const horizontal = { x0: 0, y0: 0, x1: 100, y1: 0 };

  it("일반 교차 → 두 선분의 파라미터 1쌍", () => {
    const hits = intersectStudioSegments(horizontal, { x0: 25, y0: -10, x1: 25, y1: 10 });
    expect(hits).toEqual([{ tA: 0.25, tB: 0.5, collinear: false }]);
  });

  it("T자 이음(상대의 끝점이 대상 내부에 닿음)도 교차로 인정한다", () => {
    const hits = intersectStudioSegments(horizontal, { x0: 40, y0: 0, x1: 40, y1: 30 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.tA).toBeCloseTo(0.4, 12);
    expect(hits[0]!.tB).toBeCloseTo(0, 12);
  });

  it("끝점을 공유해도(교차 아님이 아니라) 교점으로 잡힌다", () => {
    const hits = intersectStudioSegments(horizontal, { x0: 100, y0: 0, x1: 100, y1: 40 });
    expect(hits).toEqual([{ tA: 1, tB: 0, collinear: false }]);
  });

  it("평행하지만 공선이 아니면 교차 없음", () => {
    expect(intersectStudioSegments(horizontal, { x0: 0, y0: 5, x1: 100, y1: 5 })).toEqual([]);
  });

  it("공선 겹침은 겹치는 구간의 양 끝 두 점을 낸다", () => {
    const hits = intersectStudioSegments(horizontal, { x0: 20, y0: 0, x1: 60, y1: 0 });
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.tA)).toEqual([0.2, 0.6]);
    expect(hits.every((h) => h.collinear)).toBe(true);
  });

  it("공선이지만 겹치지 않으면 교차 없음", () => {
    expect(intersectStudioSegments(horizontal, { x0: 150, y0: 0, x1: 200, y1: 0 })).toEqual([]);
  });

  it("공선 한 점 접촉(끝끼리 맞닿음)은 교점 1개", () => {
    const hits = intersectStudioSegments(horizontal, { x0: 100, y0: 0, x1: 160, y1: 0 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.tA).toBe(1);
    expect(hits[0]!.collinear).toBe(true);
  });

  it("아주 얕은(near-tangent) 교차는 여전히 실제 교점으로 계산된다", () => {
    // sinθ ≈ 0.01 — 기본 parallelSinEpsilon(1e-9)보다 훨씬 크므로 점 교차 경로를 탄다.
    const hits = intersectStudioSegments(horizontal, { x0: 0, y0: -0.5, x1: 100, y1: 0.5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.collinear).toBe(false);
    expect(hits[0]!.tA).toBeCloseTo(0.5, 10);
  });

  it("parallelSinEpsilon 을 크게 주면 얕은 교차가 평행으로 강등된다(비공선 → 교차 없음)", () => {
    const hits = intersectStudioSegments(
      horizontal,
      { x0: 0, y0: -0.5, x1: 100, y1: 0.5 },
      { parallelSinEpsilon: 0.5 }
    );
    expect(hits).toEqual([]);
  });

  it("길이 0 선분은 교차 대상이 아니다", () => {
    expect(intersectStudioSegments(horizontal, { x0: 50, y0: 0, x1: 50, y1: 0 })).toEqual([]);
  });

  it("살짝 못 미친 끝점은 기본(touchTolerancePx=0)으로는 탈락, 허용치를 주면 교점", () => {
    const nearly = { x0: 40, y0: 0.4, x1: 40, y1: 30 };
    expect(intersectStudioSegments(horizontal, nearly)).toEqual([]);
    const withTolerance = intersectStudioSegments(horizontal, nearly, { touchTolerancePx: 1 });
    expect(withTolerance).toHaveLength(1);
    expect(withTolerance[0]!.tA).toBeCloseTo(0.4, 12);
  });
});

// ---------------------------------------------------------------------------
// 히트 위치
// ---------------------------------------------------------------------------

describe("locateStudioStrokeHit", () => {
  it("선 위로 투영한 위치·호길이·거리를 돌려준다", () => {
    const hit = locateStudioStrokeHit(horizontalStroke(100, 10), { x: 35, y: 4 });
    expect(hit).not.toBeNull();
    expect(hit!.segmentIndex).toBe(3);
    expect(hit!.t).toBeCloseTo(0.5, 12);
    expect(hit!.x).toBeCloseTo(35, 12);
    expect(hit!.arcLength).toBeCloseTo(35, 12);
    expect(hit!.distancePx).toBeCloseTo(4, 12);
  });

  it("점이 부족하거나 좌표가 비유한이면 null", () => {
    expect(locateStudioStrokeHit([0, 0], { x: 0, y: 0 })).toBeNull();
    expect(locateStudioStrokeHit([0, 0, Number.NaN, 5], { x: 0, y: 0 })).toBeNull();
    expect(locateStudioStrokeHit([0, 0, 10, 0], { x: Number.NaN, y: 0 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 교차 시나리오 — 십자
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 십자 교차", () => {
  const target = horizontalStroke(100, 10);
  const crossing = verticalStroke(50, -10, 10);

  it("교점 오른쪽을 누르면 교점부터 끝까지(overhang)만 지운다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 80, y: 0 }, [crossing])
    );
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]!.arcLength).toBeCloseTo(50, 12);
    expect(result.erasedFrom?.arcLength).toBeCloseTo(50, 12);
    expect(result.erasedTo).toBeNull();
    expect(result.erasedLengthPx).toBeCloseTo(50, 12);
    expect(result.pieces).toHaveLength(1);
    expect(firstPoint(result.pieces[0]!)).toEqual([0, 0]);
    expect(lastPoint(result.pieces[0]!)).toEqual([50, 0]);
    expect(result.pieces[0]!.lengthPx).toBeCloseTo(50, 12);
  });

  it("교점 왼쪽을 누르면 시작부터 교점까지 지운다(반대쪽 overhang)", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 20, y: 0 }, [crossing])
    );
    expect(result.erasedFrom).toBeNull();
    expect(result.erasedTo?.arcLength).toBeCloseTo(50, 12);
    expect(result.pieces).toHaveLength(1);
    expect(firstPoint(result.pieces[0]!)).toEqual([50, 0]);
    expect(lastPoint(result.pieces[0]!)).toEqual([100, 0]);
  });

  it("히트를 (segmentIndex,t) 파라미터로 직접 줘도 같은 결과", () => {
    const byPoint = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 80, y: 0 }, [crossing])
    );
    const byParam = expectOk(
      planStudioEraseToIntersection({ points: target }, { segmentIndex: 8, t: 0 }, [crossing])
    );
    expect(byParam.pieces).toEqual(byPoint.pieces);
    expect(byParam.hit.distancePx).toBe(0);
  });

  it("결정적 — 같은 입력이면 같은 결과", () => {
    const a = planStudioEraseToIntersection({ points: target }, { x: 80, y: 0 }, [crossing]);
    const b = planStudioEraseToIntersection({ points: target }, { x: 80, y: 0 }, [crossing]);
    expect(a).toEqual(b);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const points = horizontalStroke(100, 10);
    const pressures = points.map((_, i) => i / points.length);
    const snapshotPoints = points.slice();
    const snapshotPressures = pressures.slice();
    planStudioEraseToIntersection({ points, attributes: { pressures } }, { x: 80, y: 0 }, [
      crossing,
    ]);
    expect(points).toEqual(snapshotPoints);
    expect(pressures).toEqual(snapshotPressures);
  });
});

// ---------------------------------------------------------------------------
// T자 이음 / 끝점 접촉 / 교차 없음
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — T자·끝점·교차 없음", () => {
  const target = horizontalStroke(100, 10);

  it("T자 이음(상대의 끝점이 선 위에 놓임)도 절단점이 된다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 90, y: 0 }, [
        verticalStroke(40, 0, 40),
      ])
    );
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]!.arcLength).toBeCloseTo(40, 12);
    expect(result.pieces).toHaveLength(1);
    expect(lastPoint(result.pieces[0]!)).toEqual([40, 0]);
  });

  it("교점이 없으면 스트로크 전체가 지워진다(조각 0개)", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 50, y: 0 }, [
        verticalStroke(500, -10, 10),
      ])
    );
    expect(result.cuts).toEqual([]);
    expect(result.pieces).toEqual([]);
    expect(result.erasedFrom).toBeNull();
    expect(result.erasedTo).toBeNull();
    expect(result.erasedLengthPx).toBeCloseTo(100, 12);
  });

  it("교점이 스트로크의 끝점뿐이면 남는 조각이 없다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 50, y: 0 }, [
        verticalStroke(100, -10, 10),
      ])
    );
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]!.arcLength).toBeCloseTo(100, 12);
    expect(result.erasedTo?.arcLength).toBeCloseTo(100, 12);
    expect(result.pieces).toEqual([]);
  });

  it("교점이 시작점뿐이어도 남는 조각이 없다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 50, y: 0 }, [
        verticalStroke(0, -10, 10),
      ])
    );
    expect(result.erasedFrom?.arcLength).toBeCloseTo(0, 12);
    expect(result.pieces).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 여러 교차 + 중복 병합
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 여러 교차", () => {
  const target = horizontalStroke(100, 10);
  const others = [verticalStroke(30, -10, 10), verticalStroke(70, -10, 10)];

  it("두 교점 사이를 누르면 그 구간만 지우고 조각 2개가 남는다", () => {
    const result = expectOk(planStudioEraseToIntersection({ points: target }, { x: 50, y: 0 }, others));
    expect(result.cuts.map((c) => Math.round(c.arcLength))).toEqual([30, 70]);
    expect(result.erasedLengthPx).toBeCloseTo(40, 12);
    expect(result.pieces).toHaveLength(2);
    expect(lastPoint(result.pieces[0]!)).toEqual([30, 0]);
    expect(firstPoint(result.pieces[1]!)).toEqual([70, 0]);
    expect(result.pieces[0]!.points).toEqual([0, 0, 10, 0, 20, 0, 30, 0]);
    expect(result.pieces[1]!.points).toEqual([70, 0, 80, 0, 90, 0, 100, 0]);
  });

  it("정점 위에서 만난 교점은 인접 두 선분이 각각 보고해도 하나로 병합된다", () => {
    // x=30 은 대상의 정점 — 선분 2의 t=1 과 선분 3의 t=0 이 같은 위치를 보고한다.
    const cuts = findStudioStrokeCuts(target, [verticalStroke(30, -10, 10)]);
    expect(cuts).not.toBeNull();
    expect(cuts).toHaveLength(1);
    expect(cuts![0]!.segmentIndex).toBe(3);
    expect(cuts![0]!.t).toBe(0);
  });

  it("가장 가까운 두 교점만 경계로 쓴다(3개 이상이어도)", () => {
    const many = [
      verticalStroke(15, -5, 5),
      verticalStroke(45, -5, 5),
      verticalStroke(75, -5, 5),
    ];
    const result = expectOk(planStudioEraseToIntersection({ points: target }, { x: 60, y: 0 }, many));
    expect(result.cuts).toHaveLength(3);
    expect(result.erasedFrom?.arcLength).toBeCloseTo(45, 12);
    expect(result.erasedTo?.arcLength).toBeCloseTo(75, 12);
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces[0]!.toArcLength).toBeCloseTo(45, 12);
    expect(result.pieces[1]!.fromArcLength).toBeCloseTo(75, 12);
  });

  it("others 순서가 바뀌어도 절단 위치는 동일하다", () => {
    const forward = findStudioStrokeCuts(target, others)!;
    const reversed = findStudioStrokeCuts(target, others.slice().reverse())!;
    expect(reversed.map((c) => c.arcLength)).toEqual(forward.map((c) => c.arcLength));
  });
});

// ---------------------------------------------------------------------------
// 공선 겹침
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 공선 겹침", () => {
  it("겹쳐 누운 상대 선의 양 끝이 절단 경계가 된다", () => {
    const target = horizontalStroke(100, 10);
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 40, y: 0 }, [[20, 0, 60, 0]])
    );
    expect(result.cuts).toHaveLength(2);
    expect(result.cuts.map((c) => c.collinear)).toEqual([true, true]);
    expect(result.cuts.map((c) => c.arcLength)).toEqual([20, 60]);
    expect(result.pieces).toHaveLength(2);
    expect(lastPoint(result.pieces[0]!)).toEqual([20, 0]);
    expect(firstPoint(result.pieces[1]!)).toEqual([60, 0]);
  });

  it("평행하지만 떨어진 선은 절단하지 않는다", () => {
    const cuts = findStudioStrokeCuts(horizontalStroke(100, 10), [[0, 5, 100, 5]]);
    expect(cuts).toEqual([]);
  });

  it("겹침이 대상 정점 여러 개를 가로질러도 정점이 교점으로 둔갑하지 않는다", () => {
    const cuts = findStudioStrokeCuts(horizontalStroke(100, 10), [[25, 0, 55, 0]])!;
    expect(cuts.map((c) => c.arcLength)).toEqual([25, 55]);
  });

  it("맞닿은 두 상대 선의 겹침 구간은 하나로 이어 붙는다", () => {
    const cuts = findStudioStrokeCuts(horizontalStroke(100, 10), [
      [20, 0, 50, 0],
      [50, 0, 80, 0],
    ])!;
    expect(cuts.map((c) => c.arcLength)).toEqual([20, 80]);
  });

  it("겹침 구간 한가운데를 지나는 실제 교차는 그대로 남는다", () => {
    const cuts = findStudioStrokeCuts(horizontalStroke(100, 10), [
      [20, 0, 80, 0],
      verticalStroke(45, -5, 5),
    ])!;
    expect(cuts.map((c) => c.arcLength)).toEqual([20, 45, 80]);
  });

  it("자기 자신 위로 되돌아온 구간(자기 공선)도 구간 경계만 절단점이 된다", () => {
    // 마지막 구간 (20,0)→(80,0) 이 첫 구간 (0,0)→(100,0) 위를 되짚는다.
    const doubledBack = [0, 0, 100, 0, 100, 20, 20, 20, 20, 0, 80, 0];
    const cuts = findStudioStrokeCuts(doubledBack, [])!;
    expect(cuts.map((c) => c.arcLength)).toEqual([20, 80, 220, 280]);
    expect(cuts.every((c) => c.source === "self")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 자기교차
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 자기교차", () => {
  // (0,0)→(80,0)→(80,40)→(20,40)→(20,-20): 마지막 세로 구간이 첫 가로 구간을 (20,0)에서 지난다.
  const loopTail = [0, 0, 80, 0, 80, 40, 20, 40, 20, -20];

  it("자기교차는 두 위치(호길이 20 · 220) 모두 절단 후보로 잡힌다", () => {
    const cuts = findStudioStrokeCuts(loopTail, [])!;
    expect(cuts.map((c) => Math.round(c.arcLength))).toEqual([20, 220]);
    expect(cuts.every((c) => c.source === "self")).toBe(true);
    // 좌표는 같지만 호길이가 달라 병합되지 않는다.
    expect(cuts[0]!.x).toBeCloseTo(cuts[1]!.x, 12);
    expect(cuts[0]!.y).toBeCloseTo(cuts[1]!.y, 12);
  });

  it("자기교차를 지나 삐져나온 꼬리를 누르면 그 꼬리만 지운다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: loopTail }, { x: 20, y: -10 }, [])
    );
    expect(result.erasedFrom?.arcLength).toBeCloseTo(220, 12);
    expect(result.erasedTo).toBeNull();
    expect(result.pieces).toHaveLength(1);
    expect(lastPoint(result.pieces[0]!)).toEqual([20, 0]);
  });

  it("고리 안쪽을 누르면 자기교차 두 지점 사이가 지워져 조각 2개가 남는다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: loopTail }, { x: 50, y: 0 }, [])
    );
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces[0]!.points).toEqual([0, 0, 20, 0]);
    expect(result.pieces[1]!.points).toEqual([20, 0, 20, -20]);
  });

  it("includeSelfIntersections:false 면 자기교차를 무시한다", () => {
    const cuts = findStudioStrokeCuts(loopTail, [], { includeSelfIntersections: false });
    expect(cuts).toEqual([]);
  });

  it("이웃한 두 선분이 공유하는 끝점은 자기교차가 아니다", () => {
    expect(findStudioStrokeCuts([0, 0, 50, 0, 50, 50], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 닫힌 고리
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 닫힌 고리", () => {
  // 둘레 400 의 정사각형(호길이: 아래 0–100, 오른 100–200, 위 200–300, 왼 300–400).
  const square = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0];
  const verticalCut = verticalStroke(50, -20, 120); // 아래(50,0)·위(50,100) 두 곳을 지난다

  it("두 교점 사이를 지우고 이음매를 넘는 한 조각만 남긴다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: square }, { x: 100, y: 50 }, [verticalCut])
    );
    expect(result.closedLoop).toBe(true);
    expect(result.cuts.map((c) => c.arcLength)).toEqual([50, 250]);
    expect(result.erasedFrom?.arcLength).toBe(50);
    expect(result.erasedTo?.arcLength).toBe(250);
    expect(result.erasedLengthPx).toBeCloseTo(200, 12);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]!.points).toEqual([50, 100, 0, 100, 0, 0, 50, 0]);
    expect(result.pieces[0]!.lengthPx).toBeCloseTo(200, 12);
  });

  it("이음매 근처를 눌러도 순환 브래킷으로 한 조각이 남는다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: square }, { x: 20, y: 0 }, [verticalCut])
    );
    expect(result.erasedFrom?.arcLength).toBe(250);
    expect(result.erasedTo?.arcLength).toBe(50);
    expect(result.erasedLengthPx).toBeCloseTo(200, 12);
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]!.points).toEqual([50, 0, 100, 0, 100, 100, 50, 100]);
  });

  it("교점이 하나뿐인 닫힌 고리는 전부 지워진다", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: square }, { x: 20, y: 0 }, [
        verticalStroke(50, -20, -5).concat(),
        [50, -20, 50, 5], // 아래 변만 지나는 상대
      ])
    );
    expect(result.cuts).toHaveLength(1);
    expect(result.pieces).toEqual([]);
    expect(result.erasedLengthPx).toBeCloseTo(400, 12);
  });

  it("교점이 없는 닫힌 고리도 전부 지워진다", () => {
    const result = expectOk(planStudioEraseToIntersection({ points: square }, { x: 20, y: 0 }, []));
    expect(result.pieces).toEqual([]);
    expect(result.erasedLengthPx).toBeCloseTo(400, 12);
  });

  it("정사각형 고리는 마주보는 변끼리 자기교차로 잡히지 않는다", () => {
    expect(findStudioStrokeCuts(square, [])).toEqual([]);
  });

  it("이음매에 중복점이 있어도 가짜 자기교차가 생기지 않는다", () => {
    expect(findStudioStrokeCuts([...square, 0, 0], [])).toEqual([]);
  });

  it("closedLoopTolerancePx 를 넘기면 살짝 벌어진 고리도 닫힌 것으로 다룬다", () => {
    const nearlyClosed = [0, 0, 100, 0, 100, 100, 0, 100, 0, 0.4];
    const strict = expectOk(
      planStudioEraseToIntersection({ points: nearlyClosed }, { x: 100, y: 50 }, [verticalCut])
    );
    expect(strict.closedLoop).toBe(false);
    expect(strict.pieces).toHaveLength(2);
    const lenient = expectOk(
      planStudioEraseToIntersection({ points: nearlyClosed }, { x: 100, y: 50 }, [verticalCut], {
        closedLoopTolerancePx: 1,
      })
    );
    expect(lenient.closedLoop).toBe(true);
    expect(lenient.pieces).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 포인트별 속성 보간
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 속성 보간", () => {
  const target = [0, 0, 50, 0, 100, 0];

  it("절단면 속성은 이웃 두 점의 선형 보간, 원본 점은 원본 값 유지", () => {
    const result = expectOk(
      planStudioEraseToIntersection(
        { points: target, attributes: { pressures: [0, 0.5, 1] } },
        { x: 80, y: 0 },
        [verticalStroke(25, -5, 5)]
      )
    );
    expect(result.pieces).toHaveLength(1);
    expect(result.pieces[0]!.points).toEqual([0, 0, 25, 0]);
    expect(result.pieces[0]!.attributes.pressures).toEqual([0, 0.25]);
  });

  it("모든 포인트별 키를 함께 보간한다", () => {
    const result = expectOk(
      planStudioEraseToIntersection(
        {
          points: target,
          attributes: {
            pressures: [0, 1, 0],
            tiltXs: [10, 20, 30],
            tiltYs: [-10, -20, -30],
            twists: [0, 180, 360],
            speeds: [1, 3, 5],
            tangentialPressures: [0.2, 0.4, 0.6],
          },
        },
        { x: 10, y: 0 },
        [verticalStroke(75, -5, 5)]
      )
    );
    const piece = result.pieces[0]!;
    expect(piece.points).toEqual([75, 0, 100, 0]);
    expect(piece.attributes.pressures![0]).toBeCloseTo(0.5, 12);
    expect(piece.attributes.tiltXs![0]).toBeCloseTo(25, 12);
    expect(piece.attributes.tiltYs![0]).toBeCloseTo(-25, 12);
    expect(piece.attributes.twists![0]).toBeCloseTo(270, 12);
    expect(piece.attributes.speeds![0]).toBeCloseTo(4, 12);
    expect(piece.attributes.tangentialPressures![0]).toBeCloseTo(0.5, 12);
    expect(piece.attributes.pressures).toHaveLength(2);
  });

  it("속성이 없으면 만들어내지 않는다(빈 속성 + points 만 담은 패치)", () => {
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 80, y: 0 }, [
        verticalStroke(25, -5, 5),
      ])
    );
    expect(result.pieces[0]!.attributes).toEqual({});
    expect(studioStrokePiecePatchFields(result.pieces[0]!)).toEqual({ points: [0, 0, 25, 0] });
    expect(Object.keys(studioStrokePiecePatchFields(result.pieces[0]!))).toEqual(["points"]);
  });

  it("포인트 수보다 짧은 속성 배열은 마지막 값으로 이어 붙인다(상수 발명 없음)", () => {
    const result = expectOk(
      planStudioEraseToIntersection(
        { points: target, attributes: { pressures: [0.8] } },
        { x: 80, y: 0 },
        [verticalStroke(25, -5, 5)]
      )
    );
    expect(result.pieces[0]!.attributes.pressures).toEqual([0.8, 0.8]);
  });

  it("비유한 속성값은 가장 가까운 유한 이웃으로 메우고, 전부 비유한이면 키를 버린다", () => {
    const patched = expectOk(
      planStudioEraseToIntersection(
        { points: target, attributes: { pressures: [Number.NaN, 0.6, 1] } },
        { x: 80, y: 0 },
        [verticalStroke(25, -5, 5)]
      )
    );
    expect(patched.pieces[0]!.attributes.pressures).toEqual([0.6, 0.6]);
    const dropped = expectOk(
      planStudioEraseToIntersection(
        { points: target, attributes: { pressures: [Number.NaN, Number.NaN, Number.NaN] } },
        { x: 80, y: 0 },
        [verticalStroke(25, -5, 5)]
      )
    );
    expect(dropped.pieces[0]!.attributes).toEqual({});
  });

  it("두 조각 모두 각자 구간의 속성을 물려받는다", () => {
    const result = expectOk(
      planStudioEraseToIntersection(
        { points: [0, 0, 100, 0], attributes: { pressures: [0, 1] } },
        { x: 50, y: 0 },
        [verticalStroke(20, -5, 5), verticalStroke(80, -5, 5)]
      )
    );
    expect(result.pieces).toHaveLength(2);
    expect(result.pieces[0]!.attributes.pressures).toEqual([0, 0.2]);
    expect(result.pieces[1]!.attributes.pressures).toEqual([0.8, 1]);
    expect(studioStrokePiecePatchFields(result.pieces[1]!)).toEqual({
      points: [80, 0, 100, 0],
      pressures: [0.8, 1],
    });
  });
});

// ---------------------------------------------------------------------------
// 방어적 입력 · 예산
// ---------------------------------------------------------------------------

describe("planStudioEraseToIntersection — 방어", () => {
  it("점이 2개 미만이면 거절", () => {
    const result = planStudioEraseToIntersection({ points: [0, 0] }, { x: 0, y: 0 }, []);
    expect(result.ok).toBe(false);
  });

  it("비유한 좌표가 섞이면 거절", () => {
    const result = planStudioEraseToIntersection(
      { points: [0, 0, Number.POSITIVE_INFINITY, 0] },
      { x: 0, y: 0 },
      []
    );
    expect(result.ok).toBe(false);
  });

  it("길이가 0인 스트로크는 거절", () => {
    const result = planStudioEraseToIntersection({ points: [5, 5, 5, 5] }, { x: 5, y: 5 }, []);
    expect(result.ok).toBe(false);
  });

  it("hitTolerancePx 밖을 누르면 거절", () => {
    const target = horizontalStroke(100, 10);
    expect(
      planStudioEraseToIntersection({ points: target }, { x: 50, y: 40 }, [], {
        hitTolerancePx: 10,
      }).ok
    ).toBe(false);
    expect(
      planStudioEraseToIntersection({ points: target }, { x: 50, y: 4 }, [], { hitTolerancePx: 10 })
        .ok
    ).toBe(true);
  });

  it("선분쌍 예산을 넘으면 계산을 포기한다", () => {
    const target = horizontalStroke(100, 1);
    const result = planStudioEraseToIntersection(
      { points: target },
      { x: 50, y: 0 },
      [verticalStroke(50, -5, 5)],
      { maxSegmentPairs: 3 }
    );
    expect(result.ok).toBe(false);
    expect(findStudioStrokeCuts(target, [verticalStroke(50, -5, 5)], { maxSegmentPairs: 3 })).toBeNull();
  });

  it("비어 있거나 망가진 상대 스트로크는 조용히 건너뛴다", () => {
    const cuts = findStudioStrokeCuts(horizontalStroke(100, 10), [
      [],
      [10, 10],
      [50, Number.NaN, 50, 10],
      verticalStroke(50, -5, 5),
    ]);
    expect(cuts).toHaveLength(1);
    expect(cuts![0]!.arcLength).toBeCloseTo(50, 12);
    expect(cuts![0]!.source).toBe("other");
    expect(cuts![0]!.otherIndex).toBe(3);
  });

  it("중복된 연속 점(길이 0 선분)이 있어도 결과가 흔들리지 않는다", () => {
    const withDuplicates = [0, 0, 30, 0, 30, 0, 60, 0, 100, 0];
    const result = expectOk(
      planStudioEraseToIntersection({ points: withDuplicates }, { x: 80, y: 0 }, [
        verticalStroke(45, -5, 5),
      ])
    );
    expect(result.cuts.map((c) => c.arcLength)).toEqual([45]);
    expect(lastPoint(result.pieces[0]!)).toEqual([45, 0]);
  });

  it("교점 위를 정확히 눌러도 결정적으로 한쪽 경계를 고른다", () => {
    const target = horizontalStroke(100, 10);
    const result = expectOk(
      planStudioEraseToIntersection({ points: target }, { x: 30, y: 0 }, [
        verticalStroke(30, -5, 5),
        verticalStroke(70, -5, 5),
      ])
    );
    expect(result.erasedFrom?.arcLength).toBe(30);
    expect(result.erasedTo?.arcLength).toBe(70);
    expect(result.pieces).toHaveLength(2);
  });

  it("좌표 스케일이 커져도 얕은 교차를 놓치지 않는다(각도 기준 엡실론)", () => {
    const big = [0, 20000, 40000, 20000];
    const cuts = findStudioStrokeCuts(big, [[20000, 19999.99, 20000, 20000.01]])!;
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.x).toBeCloseTo(20000, 6);
  });

  it("범위를 벗어난 파라미터 히트는 거절", () => {
    const result = planStudioEraseToIntersection(
      { points: horizontalStroke(100, 10) },
      { segmentIndex: 99, t: 0 },
      []
    );
    expect(result.ok).toBe(false);
  });
});

describe("보조 export", () => {
  it("파라미터 비교는 선분 인덱스 → t 순", () => {
    expect(compareStudioStrokeParams({ segmentIndex: 1, t: 0.9 }, { segmentIndex: 2, t: 0 })).toBeLessThan(0);
    expect(compareStudioStrokeParams({ segmentIndex: 2, t: 0.1 }, { segmentIndex: 2, t: 0.9 })).toBeLessThan(0);
    expect(compareStudioStrokeParams({ segmentIndex: 2, t: 0.5 }, { segmentIndex: 2, t: 0.5 })).toBe(0);
  });

  it("UI 라벨이 존재한다", () => {
    expect(STUDIO_ERASE_TO_INTERSECTION_LABEL).toBe("교점까지 지우기");
  });
});
