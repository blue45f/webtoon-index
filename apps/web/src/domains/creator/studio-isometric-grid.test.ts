import { describe, expect, it } from "vitest";

import {
  clampIsometricAngleDeg,
  clampIsometricCellSize,
  DEFAULT_ISOMETRIC_ANGLE_DEG,
  DEFAULT_ISOMETRIC_CELL_SIZE,
  defaultIsometricOrigin,
  ISOMETRIC_ANGLE_MAX_DEG,
  ISOMETRIC_ANGLE_MIN_DEG,
  ISOMETRIC_CELL_SIZE_MAX,
  ISOMETRIC_CELL_SIZE_MIN,
  ISOMETRIC_LOCK_MIN_DRAG,
  isometricAxisAngles,
  isometricGridLines,
  MAX_LINES_PER_AXIS,
  projectPointOntoIsometricAxis,
  resolveIsometricAxisRay,
  shouldSnapStrokeToIsometricAxis,
  snapStrokePointToIsometricGrid,
  type IsometricAxisRay,
  type IsometricGridConfig,
} from "./studio-isometric-grid";

const config = (overrides: Partial<IsometricGridConfig> = {}): IsometricGridConfig => ({
  angleDeg: 30,
  cellSize: 40,
  originX: 400,
  originY: 300,
  ...overrides,
});

describe("isometricAxisAngles", () => {
  it("angleDeg=30 이면 [30, 150, 90]", () => {
    expect(isometricAxisAngles(30)).toEqual([30, 150, 90]);
  });

  it("angleDeg=45 이면 [45, 135, 90]", () => {
    expect(isometricAxisAngles(45)).toEqual([45, 135, 90]);
  });

  it("세 번째 축은 항상 90(수직)이다", () => {
    expect(isometricAxisAngles(15)[2]).toBe(90);
    expect(isometricAxisAngles(60)[2]).toBe(90);
  });
});

describe("clampIsometricAngleDeg / clampIsometricCellSize", () => {
  it("범위 안 값은 그대로 통과시킨다", () => {
    expect(clampIsometricAngleDeg(30)).toBe(30);
    expect(clampIsometricCellSize(40)).toBe(40);
  });

  it("범위 밖 값은 경계로 클램프한다", () => {
    expect(clampIsometricAngleDeg(-10)).toBe(ISOMETRIC_ANGLE_MIN_DEG);
    expect(clampIsometricAngleDeg(999)).toBe(ISOMETRIC_ANGLE_MAX_DEG);
    expect(clampIsometricCellSize(0)).toBe(ISOMETRIC_CELL_SIZE_MIN);
    expect(clampIsometricCellSize(10000)).toBe(ISOMETRIC_CELL_SIZE_MAX);
  });

  it("NaN/Infinity 는 기본값으로 대체한다", () => {
    expect(clampIsometricAngleDeg(NaN)).toBe(DEFAULT_ISOMETRIC_ANGLE_DEG);
    expect(clampIsometricAngleDeg(Infinity)).toBe(DEFAULT_ISOMETRIC_ANGLE_DEG);
    expect(clampIsometricCellSize(NaN)).toBe(DEFAULT_ISOMETRIC_CELL_SIZE);
    expect(clampIsometricCellSize(-Infinity)).toBe(DEFAULT_ISOMETRIC_CELL_SIZE);
  });
});

describe("defaultIsometricOrigin", () => {
  it("캔버스 정중앙을 돌려준다", () => {
    expect(defaultIsometricOrigin(800, 600)).toEqual({ x: 400, y: 300 });
  });
});

describe("isometricGridLines", () => {
  it("캔버스 크기가 0 이하이면 []", () => {
    expect(isometricGridLines(config(), 0, 600)).toEqual([]);
    expect(isometricGridLines(config(), 800, -10)).toEqual([]);
  });

  it("cellSize 가 0 이하이면 []", () => {
    expect(isometricGridLines(config({ cellSize: 0 }), 800, 600)).toEqual([]);
    expect(isometricGridLines(config({ cellSize: -5 }), 800, 600)).toEqual([]);
  });

  it("cellSize/origin/angleDeg 가 NaN/Infinity 면 []", () => {
    expect(isometricGridLines(config({ cellSize: NaN }), 800, 600)).toEqual([]);
    expect(isometricGridLines(config({ originX: Infinity }), 800, 600)).toEqual([]);
    expect(isometricGridLines(config({ originY: NaN }), 800, 600)).toEqual([]);
    expect(isometricGridLines(config({ angleDeg: NaN }), 800, 600)).toEqual([]);
  });

  it("origin 을 지나는 선(오프셋 0)이 각 축마다 정확히 origin 을 중점으로 갖는다", () => {
    const cfg = config({ originX: 400, originY: 300 });
    const lines = isometricGridLines(cfg, 800, 600);
    for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
      const originLine = lines.find((l) => {
        if (l.axisIndex !== axisIndex) return false;
        const midX = (l.x1 + l.x2) / 2;
        const midY = (l.y1 + l.y2) / 2;
        return Math.abs(midX - cfg.originX) < 1e-6 && Math.abs(midY - cfg.originY) < 1e-6;
      });
      expect(originLine, `axis ${axisIndex} 에 origin을 지나는 선이 있어야 함`).toBeDefined();
    }
  });

  it("각 축마다 최소 한 개 이상의 선을 만든다(캔버스를 덮는 일반적인 설정)", () => {
    const lines = isometricGridLines(config(), 800, 600);
    for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
      expect(lines.filter((l) => l.axisIndex === axisIndex).length).toBeGreaterThan(0);
    }
  });

  it("각 선분은 캔버스를 완전히 가로지를 만큼 길다(양 끝점이 캔버스 밖으로 나간다)", () => {
    const lines = isometricGridLines(config(), 800, 600);
    for (const l of lines) {
      // 선분 길이가 캔버스 대각선 이상이어야 어느 각도로도 캔버스를 완전히 덮는다.
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      expect(len).toBeGreaterThanOrEqual(Math.hypot(800, 600));
    }
  });

  it("MAX_LINES_PER_AXIS 를 초과하는 촘촘한 cellSize 는 축당 개수를 캡한다", () => {
    const lines = isometricGridLines(config({ cellSize: 1 }), 1000, 1000);
    for (let axisIndex = 0; axisIndex < 3; axisIndex++) {
      const count = lines.filter((l) => l.axisIndex === axisIndex).length;
      expect(count).toBeLessThanOrEqual(MAX_LINES_PER_AXIS);
      expect(count).toBe(MAX_LINES_PER_AXIS);
    }
    expect(lines.length).toBe(MAX_LINES_PER_AXIS * 3);
  });

  it("origin 이 캔버스 밖 멀리 있어도 계산이 깨지지 않고 캔버스를 덮는 선을 만든다", () => {
    const lines = isometricGridLines(config({ originX: -5000, originY: -5000 }), 800, 600);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
      expect(Number.isFinite(len)).toBe(true);
    }
  });
});

describe("resolveIsometricAxisRay", () => {
  it("드래그 거리가 minDragDist 미만이면 null", () => {
    expect(
      resolveIsometricAxisRay(30, 0, 0, 1, 0, { minDragDist: ISOMETRIC_LOCK_MIN_DRAG })
    ).toBeNull();
  });

  it("드래그 방향이 axis 0(angleDeg)과 정확히 일치하면 axisIndex 0을 고른다", () => {
    const angleRad = (30 * Math.PI) / 180;
    const dragX = 50 * Math.cos(angleRad);
    const dragY = 50 * Math.sin(angleRad);
    const result = resolveIsometricAxisRay(30, 0, 0, dragX, dragY);
    expect(result).not.toBeNull();
    expect(result!.axisIndex).toBe(0);
    expect(result!.originX).toBe(0);
    expect(result!.originY).toBe(0);
    expect(Math.hypot(result!.dirX, result!.dirY)).toBeCloseTo(1, 10);
  });

  it("드래그 방향이 수직(90°)과 일치하면 axisIndex 2를 고른다", () => {
    const result = resolveIsometricAxisRay(30, 0, 0, 0, 50);
    expect(result).not.toBeNull();
    expect(result!.axisIndex).toBe(2);
  });

  it("직선은 양방향이라 반대 부호 드래그도 같은 축을 고른다", () => {
    const angleRad = (30 * Math.PI) / 180;
    const dragX = -50 * Math.cos(angleRad);
    const dragY = -50 * Math.sin(angleRad);
    const result = resolveIsometricAxisRay(30, 0, 0, dragX, dragY);
    expect(result).not.toBeNull();
    expect(result!.axisIndex).toBe(0);
  });

  it("수평 드래그는 axis0(30°)과 axis1(150°) 사이 동률이며, 먼저 나온 axis0이 이긴다", () => {
    const result = resolveIsometricAxisRay(30, 0, 0, 50, 0);
    expect(result).not.toBeNull();
    expect(result!.axisIndex).toBe(0);
  });

  it("angleDeg 이 NaN 이면 대각선 두 축은 무효화되고, 상수인 수직축(90°)만 남아 그 축으로 락 걸린다", () => {
    // 세 번째 축은 isometricAxisAngles 공식상 angleDeg 와 무관하게 항상 90° 라 계속 유효하다.
    const result = resolveIsometricAxisRay(NaN, 0, 0, 50, 0);
    expect(result).not.toBeNull();
    expect(result!.axisIndex).toBe(2);
  });

  it("시작점/드래그 지점 좌표가 NaN/Infinity 면 null, throw 하지 않는다", () => {
    expect(() => resolveIsometricAxisRay(30, NaN, 0, 50, 0)).not.toThrow();
    expect(resolveIsometricAxisRay(30, NaN, 0, 50, 0)).toBeNull();
    expect(resolveIsometricAxisRay(30, 0, 0, Infinity, 0)).toBeNull();
  });
});

describe("projectPointOntoIsometricAxis", () => {
  it("수평 ray 위로 수직 투영", () => {
    const ray: IsometricAxisRay = { axisIndex: 0, originX: 0, originY: 0, dirX: 1, dirY: 0 };
    const [x, y] = projectPointOntoIsometricAxis(5, 7, ray);
    expect(x).toBeCloseTo(5, 10);
    expect(y).toBeCloseTo(0, 10);
  });

  it("대각선 ray 위로 수직 투영(손계산 검증)", () => {
    const inv = 1 / Math.SQRT2;
    const ray: IsometricAxisRay = { axisIndex: 0, originX: 0, originY: 0, dirX: inv, dirY: inv };
    const [x, y] = projectPointOntoIsometricAxis(2, 0, ray);
    expect(x).toBeCloseTo(1, 10);
    expect(y).toBeCloseTo(1, 10);
  });

  it("ray 위에 이미 있는 점은 그대로 유지된다(부동소수 오차 이내)", () => {
    const ray: IsometricAxisRay = { axisIndex: 2, originX: 10, originY: 10, dirX: 0, dirY: 1 };
    const [x, y] = projectPointOntoIsometricAxis(10, 50, ray);
    expect(x).toBeCloseTo(10, 10);
    expect(y).toBeCloseTo(50, 10);
  });
});

describe("snapStrokePointToIsometricGrid", () => {
  it("ray 가 null 이면 입력을 그대로 통과시킨다", () => {
    expect(snapStrokePointToIsometricGrid(12.5, -3.25, null)).toEqual([12.5, -3.25]);
  });

  it("ray 가 있으면 투영된 좌표를 돌려준다", () => {
    const ray: IsometricAxisRay = { axisIndex: 0, originX: 0, originY: 0, dirX: 1, dirY: 0 };
    expect(snapStrokePointToIsometricGrid(5, 7, ray)).toEqual([5, 0]);
  });
});

describe("shouldSnapStrokeToIsometricAxis", () => {
  it("treats the grid as a visual hint for freehand and constrains only the line tool", () => {
    expect(shouldSnapStrokeToIsometricAxis({
      active: true,
      mode: "pen",
      kind: "freehand",
    })).toBe(false);
    expect(shouldSnapStrokeToIsometricAxis({
      active: true,
      mode: "pen",
      kind: "line",
    })).toBe(true);
    expect(shouldSnapStrokeToIsometricAxis({
      active: true,
      mode: "eraser",
      kind: "line",
    })).toBe(false);
    expect(shouldSnapStrokeToIsometricAxis({
      active: false,
      mode: "pen",
      kind: "line",
    })).toBe(false);
  });
});
