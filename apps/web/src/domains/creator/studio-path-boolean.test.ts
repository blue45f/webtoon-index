import { describe, expect, it } from "vitest";

import {
  combineStudioShapePolygons,
  combineStudioShapes,
  drawElToStudioPathBooleanSpec,
  isStudioPathBooleanOp,
  STUDIO_PATH_BOOLEAN_MIN_CURVE_SEGMENTS,
  STUDIO_PATH_BOOLEAN_OPS,
  STUDIO_PATH_BOOLEAN_RESULT_SAMPLE_SPACING,
  studioPathBooleanOpLabel,
  studioPathBooleanOutputFromPolygons,
  studioPathBooleanPieceToDrawElSeed,
  studioPathBooleanUnavailableReason,
  studioPathSignedArea,
  studioShapeToPolygon,
  type StudioPathBooleanShapeSpec,
  type StudioPathRing,
} from "./studio-path-boolean";

import type { DrawEl, El } from "./studio-element-model";

/** 사각형 스펙 — 드래그 두 모서리 + 모서리 반경 0(순수 4각). */
function rectSpec(x1: number, y1: number, x2: number, y2: number): StudioPathBooleanShapeSpec {
  return { kind: "rect", points: [x1, y1, x2, y2], shapeParams: { cornerRadius: 0 } };
}

/** [x,y] 쌍 목록 → 정점 좌표 문자열 집합(순회 시작점/방향 무시 비교용). */
function vertexSet(flat: readonly number[]): Set<string> {
  const set = new Set<string>();
  const n = Math.floor(flat.length / 2);
  for (let i = 0; i < n; i++) set.add(`${flat[i * 2]},${flat[i * 2 + 1]}`);
  return set;
}

function drawEl(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "el",
    type: "draw",
    kind: "rect",
    points: [0, 0, 100, 100],
    stroke: "#111111",
    strokeWidth: 2,
    ...overrides,
  };
}

describe("STUDIO_PATH_BOOLEAN_OPS 카탈로그", () => {
  it("4개 연산이 지정된 한글 라벨로 존재한다", () => {
    expect(STUDIO_PATH_BOOLEAN_OPS.map((op) => op.label)).toEqual([
      "합치기",
      "빼기",
      "교차",
      "제외",
    ]);
    expect(new Set(STUDIO_PATH_BOOLEAN_OPS.map((op) => op.id)).size).toBe(4);
    for (const op of STUDIO_PATH_BOOLEAN_OPS) {
      expect(op.tip.length).toBeGreaterThan(0);
    }
  });

  it("id 가드·라벨 조회가 카탈로그와 일치한다", () => {
    expect(isStudioPathBooleanOp("union")).toBe(true);
    expect(isStudioPathBooleanOp("merge")).toBe(false);
    expect(studioPathBooleanOpLabel("subtract")).toBe("빼기");
    expect(studioPathBooleanOpLabel("unknown-op")).toBe("unknown-op");
  });
});

describe("studioShapeToPolygon", () => {
  it("모서리 반경 0 사각형은 4정점 링·정확한 넓이", () => {
    const result = studioShapeToPolygon(rectSpec(0, 0, 100, 100));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ring = result.polygon[0]!;
    expect(ring).toHaveLength(4);
    expect(Math.abs(studioPathSignedArea(ring.flat()))).toBeCloseTo(10000, 5);
  });

  it("드래그 방향이 뒤집혀도(끝→시작) 같은 bbox 링이 나온다", () => {
    const forward = studioShapeToPolygon(rectSpec(0, 0, 100, 100));
    const reversed = studioShapeToPolygon(rectSpec(100, 100, 0, 0));
    expect(forward.ok && reversed.ok).toBe(true);
    if (!forward.ok || !reversed.ok) return;
    expect(vertexSet(reversed.polygon[0]!.flat())).toEqual(vertexSet(forward.polygon[0]!.flat()));
  });

  it("타원은 세그먼트 근사(기본 64)·닫힘 정점 미반복·넓이 ≈ πab", () => {
    const result = studioShapeToPolygon({ kind: "ellipse", points: [0, 0, 100, 100] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ring = result.polygon[0]!;
    expect(ring.length).toBe(STUDIO_PATH_BOOLEAN_MIN_CURVE_SEGMENTS);
    const [firstX, firstY] = ring[0]!;
    const [lastX, lastY] = ring[ring.length - 1]!;
    expect(firstX === lastX && firstY === lastY).toBe(false); // 엔진 정규형: 꼬리 중복 없음
    const area = Math.abs(studioPathSignedArea(ring.flat()));
    expect(area).toBeGreaterThan(Math.PI * 50 * 50 * 0.99);
    expect(area).toBeLessThan(Math.PI * 50 * 50 * 1.001);
  });

  it("curveSegments 는 64 미만을 64 로 클램프한다", () => {
    const result = studioShapeToPolygon(
      { kind: "ellipse", points: [0, 0, 40, 20] },
      { curveSegments: 8 }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.polygon[0]!.length).toBe(STUDIO_PATH_BOOLEAN_MIN_CURVE_SEGMENTS);
  });

  it("회전은 bbox 중심 기준으로 적용된다(가로 100×50 사각형 90° → 세로 50×100)", () => {
    const result = studioShapeToPolygon({ ...rectSpec(0, 0, 100, 50), rotationDeg: 90 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ring = result.polygon[0]!;
    expect(vertexSet(ring.flat())).toEqual(
      new Set(["25,-25", "75,-25", "75,75", "25,75"])
    );
    expect(Math.abs(studioPathSignedArea(ring.flat()))).toBeCloseTo(5000, 5);
  });

  it("삼각형·다각형·별은 렌더 규약과 같은 정점 수를 만든다", () => {
    const triangle = studioShapeToPolygon({ kind: "triangle", points: [0, 0, 80, 60] });
    const hexagon = studioShapeToPolygon({
      kind: "polygon",
      points: [0, 0, 80, 80],
      shapeParams: { polygonSides: 6 },
    });
    const star = studioShapeToPolygon({
      kind: "star",
      points: [0, 0, 80, 80],
      shapeParams: { starPoints: 5, starInnerRatio: 0.5 },
    });
    expect(triangle.ok && hexagon.ok && star.ok).toBe(true);
    if (!triangle.ok || !hexagon.ok || !star.ok) return;
    expect(triangle.polygon[0]!).toHaveLength(3);
    expect(hexagon.polygon[0]!).toHaveLength(6);
    expect(star.polygon[0]!).toHaveLength(10); // 꼭짓점 5 × (외곽+내부)
  });

  it("freehand 는 points 를 링으로 쓰고 꼬리 닫힘 정점을 정리한다", () => {
    const result = studioShapeToPolygon({
      kind: "freehand",
      points: [0, 0, 100, 0, 100, 100, 0, 100, 0, 0],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.polygon[0]!).toHaveLength(4);
    expect(Math.abs(studioPathSignedArea(result.polygon[0]!.flat()))).toBeCloseTo(10000, 5);
  });

  it("면적 없는 도형·손상 좌표·점 부족은 사유와 함께 거부한다", () => {
    expect(studioShapeToPolygon(rectSpec(0, 0, 0, 100))).toMatchObject({ ok: false });
    expect(
      studioShapeToPolygon({ kind: "rect", points: [0, 0, Number.NaN, 100] })
    ).toMatchObject({ ok: false });
    expect(
      studioShapeToPolygon({ kind: "freehand", points: [0, 0, 100, 100] })
    ).toMatchObject({ ok: false });
    const degenerate = studioShapeToPolygon(rectSpec(5, 5, 5.001, 200));
    expect(degenerate.ok).toBe(false);
    if (!degenerate.ok) expect(degenerate.reason.length).toBeGreaterThan(0);
  });
});

describe("combineStudioShapes — 불리언 결과", () => {
  const a = rectSpec(0, 0, 100, 100);
  const b = rectSpec(50, 50, 150, 150);

  it("합집합: 겹친 사각형 2개 → 8정점 한 조각, 넓이 17500", async () => {
    const result = await combineStudioShapes(a, b, "union");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces).toHaveLength(1);
    const piece = result.output.pieces[0]!;
    expect(piece.holeCount).toBe(0);
    expect(Math.abs(studioPathSignedArea(piece.points))).toBeCloseTo(17500, 5);
    expect(vertexSet(piece.points)).toEqual(
      new Set([
        "0,0",
        "100,0",
        "100,50",
        "150,50",
        "150,150",
        "50,150",
        "50,100",
        "0,100",
      ])
    );
    expect(result.output.bounds).toEqual({ x: 0, y: 0, width: 150, height: 150 });
  });

  it("빼기: 겹친 모서리를 오려낸 L자 — 6정점, 넓이 7500", async () => {
    const result = await combineStudioShapes(a, b, "subtract");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces).toHaveLength(1);
    const piece = result.output.pieces[0]!;
    expect(piece.holeCount).toBe(0);
    expect(Math.abs(studioPathSignedArea(piece.points))).toBeCloseTo(7500, 5);
    expect(vertexSet(piece.points)).toEqual(
      new Set(["0,0", "100,0", "100,50", "50,50", "50,100", "0,100"])
    );
  });

  it("빼기: 완전 포함된 위 도형은 구멍(키홀 링)으로 남는다", async () => {
    const result = await combineStudioShapes(a, rectSpec(25, 25, 75, 75), "subtract");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces).toHaveLength(1);
    const piece = result.output.pieces[0]!;
    expect(piece.holeCount).toBe(1);
    // 키홀 링의 신발끈 넓이 = 외곽 − 구멍(브리지는 왕복이라 0 기여).
    expect(Math.abs(studioPathSignedArea(piece.points))).toBeCloseTo(10000 - 2500, 5);
    // 명시적으로 닫힌 평탄 링(첫 정점을 끝에 반복).
    expect(piece.points[0]).toBe(piece.points[piece.points.length - 2]);
    expect(piece.points[1]).toBe(piece.points[piece.points.length - 1]);
    expect(piece.bounds).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("교차: 겹친 영역 50..100 정사각형 — 넓이 2500", async () => {
    const result = await combineStudioShapes(a, b, "intersect");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces).toHaveLength(1);
    const piece = result.output.pieces[0]!;
    expect(Math.abs(studioPathSignedArea(piece.points))).toBeCloseTo(2500, 5);
    expect(vertexSet(piece.points)).toEqual(
      new Set(["50,50", "100,50", "100,100", "50,100"])
    );
  });

  it("제외(XOR): 두 L자 조각 — 총 넓이 15000", async () => {
    const result = await combineStudioShapes(a, b, "exclude");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces.length).toBeGreaterThanOrEqual(1);
    const total = result.output.pieces.reduce(
      (sum, piece) => sum + Math.abs(studioPathSignedArea(piece.points)),
      0
    );
    expect(total).toBeCloseTo(15000, 5);
  });

  it("떨어진 도형 빼기 → 아래 도형이 그대로 남는다", async () => {
    const result = await combineStudioShapes(a, rectSpec(300, 300, 400, 400), "subtract");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.output.pieces).toHaveLength(1);
    const piece = result.output.pieces[0]!;
    expect(piece.holeCount).toBe(0);
    expect(Math.abs(studioPathSignedArea(piece.points))).toBeCloseTo(10000, 5);
    expect(vertexSet(piece.points)).toEqual(vertexSet([0, 0, 100, 0, 100, 100, 0, 100]));
  });

  it("떨어진 도형 교차 → ok:false + 사유", async () => {
    const result = await combineStudioShapes(a, rectSpec(300, 300, 400, 400), "intersect");
    expect(result).toEqual({ ok: false, reason: "두 도형이 겹치지 않아 교차 영역이 없어요." });
  });

  it("동일 도형 제외 → ok:false + 사유", async () => {
    const result = await combineStudioShapes(a, rectSpec(0, 0, 100, 100), "exclude");
    expect(result).toEqual({ ok: false, reason: "두 도형이 완전히 겹쳐 남는 면이 없어요." });
  });

  it("타원 ∪ 사각형: 결과가 두 넓이 사이·결정적", async () => {
    const ellipse: StudioPathBooleanShapeSpec = { kind: "ellipse", points: [50, 0, 150, 100] };
    const first = await combineStudioShapes(a, ellipse, "union");
    const second = await combineStudioShapes(a, ellipse, "union");
    expect(first).toEqual(second); // 결정성 — 같은 입력이면 JSON 단위로 동일
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const area = first.output.pieces.reduce(
      (sum, piece) => sum + Math.abs(studioPathSignedArea(piece.points)),
      0
    );
    expect(area).toBeGreaterThan(10000); // 사각형 하나보단 넓고
    expect(area).toBeLessThan(10000 + Math.PI * 50 * 50); // 단순 합보단 좁다(겹침 존재)
  });

  it("손상된 스펙은 아래/위 도형 사유로 구분해 실패한다", async () => {
    const broken: StudioPathBooleanShapeSpec = { kind: "rect", points: [0, 0] };
    const below = await combineStudioShapes(broken, b, "union");
    expect(below.ok).toBe(false);
    if (!below.ok) expect(below.reason.startsWith("아래 도형:")).toBe(true);
    const above = await combineStudioShapes(a, broken, "union");
    expect(above.ok).toBe(false);
    if (!above.ok) expect(above.reason.startsWith("위 도형:")).toBe(true);
  });
});

describe("combineStudioShapePolygons / studioPathBooleanOutputFromPolygons", () => {
  it("결합 결과 링에는 꼬리 닫힘 정점이 없다(정규형)", async () => {
    const square: StudioPathRing = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const shifted: StudioPathRing = [
      [5, 0],
      [15, 0],
      [15, 10],
      [5, 10],
    ];
    const polygons = await combineStudioShapePolygons([square], [shifted], "union");
    expect(polygons).toHaveLength(1);
    for (const ring of polygons[0]!) {
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      expect(first[0] === last[0] && first[1] === last[1]).toBe(false);
    }
  });

  it("빈 MultiPolygon 은 op 별 사유로 실패한다", () => {
    expect(studioPathBooleanOutputFromPolygons([], "union")).toEqual({
      ok: false,
      reason: "결합 결과가 비어 있어요.",
    });
    expect(studioPathBooleanOutputFromPolygons([], "subtract")).toEqual({
      ok: false,
      reason: "위 도형이 아래 도형을 완전히 덮어 남는 면이 없어요.",
    });
  });
});

describe("DrawEl 연동 헬퍼", () => {
  it("결합 가능한 도형은 스펙으로, 선·화살표·지우개·대칭은 null", () => {
    expect(drawElToStudioPathBooleanSpec(drawEl())).toEqual({
      kind: "rect",
      points: [0, 0, 100, 100],
      shapeParams: undefined,
    });
    expect(drawElToStudioPathBooleanSpec(drawEl({ kind: undefined }))).toMatchObject({
      kind: "freehand",
    });
    expect(drawElToStudioPathBooleanSpec(drawEl({ kind: "line" }))).toBeNull();
    expect(drawElToStudioPathBooleanSpec(drawEl({ kind: "arrow" }))).toBeNull();
    expect(drawElToStudioPathBooleanSpec(drawEl({ mode: "eraser" }))).toBeNull();
    expect(
      drawElToStudioPathBooleanSpec(
        drawEl({ symmetry: { type: "vertical", centerX: 0, centerY: 0 } })
      )
    ).toBeNull();
    expect(
      drawElToStudioPathBooleanSpec(
        drawEl({ symmetry: { type: "none", centerX: 0, centerY: 0 } })
      )
    ).not.toBeNull();
  });

  it("선택 게이트: 2개 아님·비도형·면 없는 종류를 한국어 사유로 막는다", () => {
    const shapeA = drawEl({ id: "a" }) as El;
    const shapeB = drawEl({ id: "b", points: [50, 50, 150, 150] }) as El;
    expect(studioPathBooleanUnavailableReason([shapeA, shapeB])).toBeNull();
    expect(studioPathBooleanUnavailableReason([shapeA])).toBe(
      "캔버스에서 도형 2개를 함께 선택하세요(드래그 선택)."
    );
    const sticker = { id: "s", type: "sticker", text: "★", x: 0, y: 0, fontSize: 20, rotation: 0 } as El;
    expect(studioPathBooleanUnavailableReason([shapeA, sticker])).toBe(
      "그리기 도형끼리만 결합할 수 있어요(이미지·글자·말풍선 제외)."
    );
    expect(studioPathBooleanUnavailableReason([shapeA, drawEl({ id: "l", kind: "line" }) as El])).toBe(
      "선·화살표는 면이 없어 결합할 수 없어요."
    );
  });

  it("조각 시드는 freehand+fill+sampleSpacing 계약으로 스타일을 계승한다", async () => {
    const result = await combineStudioShapes(
      rectSpec(0, 0, 100, 100),
      rectSpec(50, 50, 150, 150),
      "union"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seed = studioPathBooleanPieceToDrawElSeed(result.output.pieces[0]!, {
      stroke: "#123456",
      strokeWidth: 4,
      fill: "#abcdef",
      opacity: 0.8,
    });
    expect(seed).toMatchObject({
      type: "draw",
      kind: "freehand",
      mode: "pen",
      stroke: "#123456",
      strokeWidth: 4,
      fill: "#abcdef",
      opacity: 0.8,
      sampleSpacing: STUDIO_PATH_BOOLEAN_RESULT_SAMPLE_SPACING,
    });
    expect(seed.points).toEqual(result.output.pieces[0]!.points);
    expect(seed.points).not.toBe(result.output.pieces[0]!.points); // 방어적 복사
    const noFill = studioPathBooleanPieceToDrawElSeed(result.output.pieces[0]!, {
      stroke: "#000000",
      strokeWidth: 1,
    });
    expect("fill" in noFill).toBe(false);
    expect("opacity" in noFill).toBe(false);
  });
});
