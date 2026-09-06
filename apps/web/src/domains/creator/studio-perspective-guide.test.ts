import { describe, expect, it } from "vitest";

import {
  MAX_VANISHING_POINTS,
  PERSPECTIVE_LOCK_MIN_DRAG,
  addVanishingPoint,
  alignVanishingPointsToEyeLevel,
  canAddVanishingPoint,
  constrainVanishingPointToEyeLevel,
  defaultPerspectiveEyeLevelY,
  defaultVanishingPointPosition,
  movePerspectiveEyeLevel,
  moveVanishingPoint,
  moveVanishingPointWithEyeLevel,
  perspectiveFanRays,
  projectPointOntoPerspectiveRay,
  removeVanishingPoint,
  resolvePerspectiveRay,
  snapStrokePointToPerspective,
  type PerspectiveRay,
  type VanishingPoint,
} from "./studio-perspective-guide";

/** 테스트용 소실점 빌더. */
const vp = (id: string, x: number, y: number): VanishingPoint => ({ id, x, y });

describe("resolvePerspectiveRay", () => {
  it("소실점이 하나도 없으면 null", () => {
    expect(resolvePerspectiveRay([], 0, 0, 50, 0)).toBeNull();
  });

  it("드래그 거리가 minDragDist 미만이면 null", () => {
    const result = resolvePerspectiveRay([vp("a", 100, 0)], 0, 0, 1, 0, {
      minDragDist: PERSPECTIVE_LOCK_MIN_DRAG,
    });
    expect(result).toBeNull();
  });

  it("소실점 1개, 드래그 방향이 일치하면 정규화된 방향 벡터를 돌려준다", () => {
    const result = resolvePerspectiveRay([vp("a", 100, 0)], 0, 0, 50, 0);
    expect(result).not.toBeNull();
    expect(result!.vpId).toBe("a");
    expect(result!.originX).toBe(0);
    expect(result!.originY).toBe(0);
    expect(Math.hypot(result!.dirX, result!.dirY)).toBeCloseTo(1, 10);
    expect(result!.dirX).toBeCloseTo(1, 10);
    expect(result!.dirY).toBeCloseTo(0, 10);
  });

  it("소실점 2개 — 각도가 더 가까운 쪽을 고른다", () => {
    // A: 시작점에서 0°(오른쪽), B: 시작점에서 90°(위쪽). 드래그는 0°에서 10°만큼만 기운 방향.
    const pointA = vp("A", 100, 0);
    const pointB = vp("B", 0, 100);
    const angleRad = (10 * Math.PI) / 180;
    const dragX = 50 * Math.cos(angleRad);
    const dragY = 50 * Math.sin(angleRad);
    const result = resolvePerspectiveRay([pointA, pointB], 0, 0, dragX, dragY);
    expect(result).not.toBeNull();
    expect(result!.vpId).toBe("A");
  });

  it("소실점이 시작점과 같은 위치면 후보에서 제외되고 다음 유효한 소실점으로 넘어간다", () => {
    const coincident = vp("A", 0, 0);
    const valid = vp("B", 100, 0);
    const result = resolvePerspectiveRay([coincident, valid], 0, 0, 50, 0);
    expect(result).not.toBeNull();
    expect(result!.vpId).toBe("B");
  });

  it("유효한 소실점이 하나도 없으면(전부 시작점과 같은 위치) null", () => {
    const result = resolvePerspectiveRay([vp("A", 0, 0)], 0, 0, 50, 0);
    expect(result).toBeNull();
  });

  it("NaN/Infinity 좌표를 가진 소실점은 건너뛰고 throw 하지 않는다", () => {
    const broken = vp("bad", NaN, Infinity);
    const valid = vp("ok", 100, 0);
    expect(() => resolvePerspectiveRay([broken, valid], 0, 0, 50, 0)).not.toThrow();
    const result = resolvePerspectiveRay([broken, valid], 0, 0, 50, 0);
    expect(result?.vpId).toBe("ok");
  });

  it("시작점/드래그 지점 좌표 자체가 NaN/Infinity 면 null, throw 하지 않는다", () => {
    expect(() => resolvePerspectiveRay([vp("a", 100, 0)], NaN, 0, 50, 0)).not.toThrow();
    expect(resolvePerspectiveRay([vp("a", 100, 0)], NaN, 0, 50, 0)).toBeNull();
    expect(resolvePerspectiveRay([vp("a", 100, 0)], 0, 0, Infinity, 0)).toBeNull();
  });
});

describe("projectPointOntoPerspectiveRay", () => {
  it("수평 ray 위로 수직 투영", () => {
    const ray: PerspectiveRay = { vpId: "a", originX: 0, originY: 0, dirX: 1, dirY: 0 };
    const [x, y] = projectPointOntoPerspectiveRay(5, 7, ray);
    expect(x).toBeCloseTo(5, 10);
    expect(y).toBeCloseTo(0, 10);
  });

  it("대각선 ray 위로 수직 투영(손계산 검증)", () => {
    const inv = 1 / Math.SQRT2;
    const ray: PerspectiveRay = { vpId: "a", originX: 0, originY: 0, dirX: inv, dirY: inv };
    const [x, y] = projectPointOntoPerspectiveRay(2, 0, ray);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(1, 10);
  });

  it("ray 위에 이미 있는 점은 그대로 유지된다(부동소수 오차 이내)", () => {
    const ray: PerspectiveRay = { vpId: "a", originX: 0, originY: 0, dirX: 1, dirY: 0 };
    const [x, y] = projectPointOntoPerspectiveRay(10, 0, ray);
    expect(x).toBeCloseTo(10, 10);
    expect(y).toBeCloseTo(0, 10);
  });
});

describe("snapStrokePointToPerspective", () => {
  it("ray 가 null 이면 입력을 그대로 통과시킨다", () => {
    expect(snapStrokePointToPerspective(12.5, -3.25, null)).toEqual([12.5, -3.25]);
  });
});

describe("addVanishingPoint / removeVanishingPoint / moveVanishingPoint — no-op identity", () => {
  it("상한(MAX_VANISHING_POINTS)에서 추가하면 원본 배열 참조를 그대로 돌려준다", () => {
    const points = [vp("a", 0, 0), vp("b", 1, 1), vp("c", 2, 2)];
    expect(points.length).toBe(MAX_VANISHING_POINTS);
    expect(canAddVanishingPoint(points)).toBe(false);
    const next = addVanishingPoint(points, vp("d", 3, 3));
    expect(next).toBe(points);
  });

  it("존재하지 않는 id 제거는 원본 배열 참조를 그대로 돌려준다", () => {
    const points = [vp("a", 0, 0)];
    const next = removeVanishingPoint(points, "nope");
    expect(next).toBe(points);
  });

  it("NaN 좌표로 이동시키면 원본 배열 참조를 그대로 돌려준다", () => {
    const points = [vp("a", 0, 0)];
    const next = moveVanishingPoint(points, "a", NaN, 5);
    expect(next).toBe(points);
  });

  it("존재하지 않는 id 이동은 원본 배열 참조를 그대로 돌려준다", () => {
    const points = [vp("a", 0, 0)];
    const next = moveVanishingPoint(points, "nope", 10, 10);
    expect(next).toBe(points);
  });

  it("정상 이동은 새 배열을 돌려주고 해당 소실점 좌표를 갱신한다", () => {
    const points = [vp("a", 0, 0), vp("b", 1, 1)];
    const next = moveVanishingPoint(points, "a", 10, 20);
    expect(next).not.toBe(points);
    expect(next[0]).toEqual({ id: "a", x: 10, y: 20 });
    expect(next[1]).toEqual(points[1]);
  });
});

describe("perspective eye level (CSP horizon)", () => {
  it("defaults eye level to half canvas height", () => {
    expect(defaultPerspectiveEyeLevelY(1200)).toBe(600);
    expect(defaultPerspectiveEyeLevelY(0)).toBe(0);
  });

  it("constrains y to eye level only when horizon lock is on", () => {
    expect(constrainVanishingPointToEyeLevel(10, 20, { eyeLevelY: 300, lockHorizon: false }))
      .toEqual({ x: 10, y: 20 });
    expect(constrainVanishingPointToEyeLevel(10, 20, { eyeLevelY: 300, lockHorizon: true }))
      .toEqual({ x: 10, y: 300 });
    expect(constrainVanishingPointToEyeLevel(10, 20, { eyeLevelY: null, lockHorizon: true }))
      .toEqual({ x: 10, y: 20 });
  });

  it("moves only vanishing points that sit on the previous horizon", () => {
    const points = [vp("a", 0, 300), vp("b", 100, 300), vp("c", 50, 10)];
    const next = movePerspectiveEyeLevel(points, 300, 420);
    expect(next).toEqual([
      { id: "a", x: 0, y: 420 },
      { id: "b", x: 100, y: 420 },
      { id: "c", x: 50, y: 10 },
    ]);
    expect(movePerspectiveEyeLevel(points, null, 420)).toBe(points);
  });

  it("aligns every vanishing point to the eye level", () => {
    const points = [vp("a", 0, 10), vp("b", 1, 20)];
    expect(alignVanishingPointsToEyeLevel(points, 300)).toEqual([
      { id: "a", x: 0, y: 300 },
      { id: "b", x: 1, y: 300 },
    ]);
    expect(alignVanishingPointsToEyeLevel(points, Number.NaN)).toBe(points);
  });

  it("moveVanishingPointWithEyeLevel locks y when horizon lock is active", () => {
    const points = [vp("a", 0, 0), vp("b", 1, 1)];
    const locked = moveVanishingPointWithEyeLevel(points, "a", 40, 99, {
      eyeLevelY: 250,
      lockHorizon: true,
    });
    expect(locked[0]).toEqual({ id: "a", x: 40, y: 250 });
    const free = moveVanishingPointWithEyeLevel(points, "a", 40, 99, {
      eyeLevelY: 250,
      lockHorizon: false,
    });
    expect(free[0]).toEqual({ id: "a", x: 40, y: 99 });
  });
});

describe("defaultVanishingPointPosition", () => {
  it("0개 — 캔버스 정중앙", () => {
    expect(defaultVanishingPointPosition([], 800, 600)).toEqual({ x: 400, y: 300 });
  });

  it("1개 — 첫 소실점과 같은 높이, 캔버스 오른쪽 바깥", () => {
    const existing = [vp("a", 400, 150)];
    expect(defaultVanishingPointPosition(existing, 800, 600)).toEqual({ x: 400 + 800 * 0.9, y: 150 });
  });

  it("2개 이상 — 캔버스 폭 중앙, 캔버스 위쪽 바깥", () => {
    const existing = [vp("a", 400, 150), vp("b", 1120, 150)];
    expect(defaultVanishingPointPosition(existing, 800, 600)).toEqual({ x: 400, y: 300 - 600 * 0.9 });
  });
});

describe("perspectiveFanRays", () => {
  it("소실점이 없으면 []", () => {
    expect(perspectiveFanRays([], 800, 600)).toEqual([]);
  });

  it("rayCount 만큼 소실점당 안내선을 만든다", () => {
    const points = [vp("a", 100, 100), vp("b", 700, 500)];
    const rays = perspectiveFanRays(points, 800, 600, 4);
    expect(rays.length).toBe(points.length * 4);
  });

  it("각 안내선의 중점은 해당 소실점 좌표와 같다(직선이 소실점 기준 대칭)", () => {
    const points = [vp("a", 100, 100), vp("b", 700, 500)];
    const rays = perspectiveFanRays(points, 800, 600, 6);
    for (const ray of rays) {
      const source = points.find((p) => p.id === ray.vpId)!;
      expect((ray.x1 + ray.x2) / 2).toBeCloseTo(source.x, 6);
      expect((ray.y1 + ray.y2) / 2).toBeCloseTo(source.y, 6);
    }
  });

  it("캔버스 크기가 0 이하이면 []", () => {
    const points = [vp("a", 100, 100)];
    expect(perspectiveFanRays(points, 0, 600)).toEqual([]);
    expect(perspectiveFanRays(points, 800, -10)).toEqual([]);
  });
});
