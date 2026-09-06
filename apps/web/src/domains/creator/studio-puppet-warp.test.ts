import { describe, expect, it } from "vitest";

import { flipNormalizedPoint } from "./studio-magic-wand";
import {
  MAX_PUPPET_PINS,
  PUPPET_PIN_MIN_DIST,
  PUPPET_WARP_CORNERS,
  addPuppetPin,
  bakePuppetWarpToCanvas,
  canAddPuppetPin,
  delaunayTriangulate,
  isPuppetWarpNoop,
  movePuppetPin,
  puppetMeshTriangleLines,
  puppetMeshVertices,
  removePuppetPin,
  resetPuppetPinPositions,
  triangleAffineTransform,
  triangulatePuppetMesh,
  type PuppetPin,
  type PuppetWarpCanvasFactory,
  type PuppetWarpCtx2DLike,
} from "./studio-puppet-warp";

import type { MaskCanvasLike, MaskImageSource, SelPoint } from "./studio-selection-tools";

function pin(id: string, x: number, y: number, cur?: { x: number; y: number }): PuppetPin {
  return { id, restX: x, restY: y, x: cur?.x ?? x, y: cur?.y ?? y };
}

// ---------------------------------------------------------------------------
// (1) 핀 데이터 모델
// ---------------------------------------------------------------------------

describe("canAddPuppetPin / addPuppetPin", () => {
  it("빈 배열에 정상 좌표를 추가하면 rest===current 인 핀 1개가 생긴다", () => {
    const next = addPuppetPin([], { id: "p1", x: 0.5, y: 0.5 });
    expect(next).toEqual([{ id: "p1", restX: 0.5, restY: 0.5, x: 0.5, y: 0.5 }]);
  });

  it("좌표를 0..1 로 클램프한다", () => {
    // x=-1→0, y=2→1 인데 (0,1) 은 코너라 거절될 수 있으니 y 는 코너에서 먼 값으로 검증한다.
    const next = addPuppetPin([], { id: "p1", x: -1, y: 0.5 });
    expect(next[0]).toEqual({ id: "p1", restX: 0, restY: 0.5, x: 0, y: 0.5 });
  });

  it("±Infinity 는 NaN 과 달리 방향대로 0/1 로 saturate 한다(버그 수정: 예전엔 +Infinity 도 fallback 0 으로 떨어졌다)", () => {
    const posInf = addPuppetPin([], { id: "p1", x: Number.POSITIVE_INFINITY, y: 0.5 });
    expect(posInf[0]).toEqual({ id: "p1", restX: 1, restY: 0.5, x: 1, y: 0.5 });
    const negInf = addPuppetPin([], { id: "p2", x: Number.NEGATIVE_INFINITY, y: 0.4 });
    expect(negInf[0]).toEqual({ id: "p2", restX: 0, restY: 0.4, x: 0, y: 0.4 });
    // NaN 은 방향이 없으니 여전히 fallback(0).
    const nan = addPuppetPin([], { id: "p3", x: Number.NaN, y: 0.6 });
    expect(nan[0]).toEqual({ id: "p3", restX: 0, restY: 0.6, x: 0, y: 0.6 });
  });

  it("코너와 너무 가까우면 추가하지 않는다(기존 배열 참조 그대로)", () => {
    const pins: PuppetPin[] = [];
    const tooClose = { id: "p1", x: 0.001, y: 0.001 }; // 코너 (0,0) 바로 옆.
    const next = addPuppetPin(pins, tooClose);
    expect(next).toBe(pins);
  });

  it("기존 핀과 너무 가까우면 추가하지 않는다", () => {
    const pins = addPuppetPin([], { id: "p1", x: 0.5, y: 0.5 });
    const next = addPuppetPin(pins, { id: "p2", x: 0.5 + PUPPET_PIN_MIN_DIST / 2, y: 0.5 });
    expect(next).toBe(pins);
  });

  it("최소거리보다 멀면 정상 추가된다", () => {
    const pins = addPuppetPin([], { id: "p1", x: 0.5, y: 0.5 });
    const next = addPuppetPin(pins, { id: "p2", x: 0.5 + PUPPET_PIN_MIN_DIST * 3, y: 0.5 });
    expect(next.length).toBe(2);
  });

  it("MAX_PUPPET_PINS 개면 더 추가되지 않는다", () => {
    let pins: PuppetPin[] = [];
    for (let i = 0; i < MAX_PUPPET_PINS; i += 1) {
      // 격자 배치로 서로 충분히 떨어뜨린다(min-dist 거절 방지).
      const gx = 0.1 + (i % 6) * 0.15;
      const gy = 0.1 + Math.floor(i / 6) * 0.2;
      pins = addPuppetPin(pins, { id: `p${i}`, x: gx, y: gy });
    }
    expect(pins.length).toBe(MAX_PUPPET_PINS);
    expect(canAddPuppetPin(pins)).toBe(false);
    const next = addPuppetPin(pins, { id: "overflow", x: 0.9, y: 0.9 });
    expect(next).toBe(pins);
  });
});

describe("removePuppetPin", () => {
  it("id 로 핀을 제거한다", () => {
    const pins = [pin("a", 0.2, 0.2), pin("b", 0.7, 0.7)];
    const next = removePuppetPin(pins, "a");
    expect(next).toEqual([pin("b", 0.7, 0.7)]);
  });

  it("없는 id 면 기존 배열 참조를 그대로 반환한다", () => {
    const pins = [pin("a", 0.2, 0.2)];
    expect(removePuppetPin(pins, "nope")).toBe(pins);
  });
});

describe("movePuppetPin", () => {
  it("현재 위치(x/y)만 바꾸고 restX/restY 는 보존한다", () => {
    const pins = [pin("a", 0.2, 0.2)];
    const next = movePuppetPin(pins, "a", 0.6, 0.8);
    expect(next).toEqual([{ id: "a", restX: 0.2, restY: 0.2, x: 0.6, y: 0.8 }]);
  });

  it("좌표를 0..1 로 클램프한다", () => {
    const pins = [pin("a", 0.2, 0.2)];
    const next = movePuppetPin(pins, "a", -5, 5);
    expect(next[0]).toEqual({ id: "a", restX: 0.2, restY: 0.2, x: 0, y: 1 });
  });

  it("없는 id 또는 변화 없는 좌표면 기존 배열 참조를 그대로 반환한다", () => {
    const pins = [pin("a", 0.2, 0.2)];
    expect(movePuppetPin(pins, "nope", 0.9, 0.9)).toBe(pins);
    expect(movePuppetPin(pins, "a", 0.2, 0.2)).toBe(pins);
  });

  it("±Infinity 는 NaN 과 달리 방향대로 0/1 로 saturate 한다(버그 수정 회귀 테스트)", () => {
    const pins = [pin("a", 0.2, 0.2)];
    const posInf = movePuppetPin(pins, "a", Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
    expect(posInf[0]).toEqual({ id: "a", restX: 0.2, restY: 0.2, x: 1, y: 1 });
    const negInf = movePuppetPin(pins, "a", Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
    expect(negInf[0]).toEqual({ id: "a", restX: 0.2, restY: 0.2, x: 0, y: 0 });
    const nan = movePuppetPin(pins, "a", Number.NaN, Number.NaN);
    expect(nan[0]).toEqual({ id: "a", restX: 0.2, restY: 0.2, x: 0, y: 0 });
  });
});

describe("resetPuppetPinPositions", () => {
  it("드래그된 핀을 원본 위치로 되돌리되 핀 자체는 유지한다", () => {
    const pins = [pin("a", 0.2, 0.2, { x: 0.9, y: 0.1 })];
    const next = resetPuppetPinPositions(pins);
    expect(next).toEqual([pin("a", 0.2, 0.2)]);
  });

  it("이미 rest 위치면 기존 배열 참조를 그대로 반환한다", () => {
    const pins = [pin("a", 0.2, 0.2)];
    expect(resetPuppetPinPositions(pins)).toBe(pins);
  });
});

describe("isPuppetWarpNoop", () => {
  it("핀이 없으면 무연산", () => {
    expect(isPuppetWarpNoop([])).toBe(true);
  });

  it("모든 핀이 rest 위치 그대로면 무연산", () => {
    expect(isPuppetWarpNoop([pin("a", 0.3, 0.3), pin("b", 0.6, 0.6)])).toBe(true);
  });

  it("핀 하나라도 드래그됐으면 무연산이 아니다", () => {
    expect(isPuppetWarpNoop([pin("a", 0.3, 0.3), pin("b", 0.6, 0.6, { x: 0.65, y: 0.6 })])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (2) 메쉬 정점 조립
// ---------------------------------------------------------------------------

describe("puppetMeshVertices", () => {
  it("핀이 없으면 코너 4개만 반환하고 rest===current", () => {
    const { rest, current } = puppetMeshVertices([]);
    expect(rest).toEqual([...PUPPET_WARP_CORNERS]);
    expect(current).toEqual([...PUPPET_WARP_CORNERS]);
  });

  it("핀은 코너 뒤(인덱스 4..)에 순서대로 붙는다", () => {
    const pins = [pin("a", 0.3, 0.4, { x: 0.35, y: 0.4 }), pin("b", 0.6, 0.7)];
    const { rest, current } = puppetMeshVertices(pins);
    expect(rest.slice(0, 4)).toEqual([...PUPPET_WARP_CORNERS]);
    expect(rest.slice(4)).toEqual([
      { x: 0.3, y: 0.4 },
      { x: 0.6, y: 0.7 },
    ]);
    expect(current.slice(4)).toEqual([
      { x: 0.35, y: 0.4 },
      { x: 0.6, y: 0.7 },
    ]);
    // 코너는 핀과 무관하게 항상 고정.
    expect(current.slice(0, 4)).toEqual([...PUPPET_WARP_CORNERS]);
  });
});

// ---------------------------------------------------------------------------
// (3) Delaunay 삼각분할
// ---------------------------------------------------------------------------

function triangleAreaNorm(a: SelPoint, b: SelPoint, c: SelPoint): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

describe("delaunayTriangulate", () => {
  it("점이 3개 미만이면 빈 배열", () => {
    expect(delaunayTriangulate([])).toEqual([]);
    expect(delaunayTriangulate([{ x: 0, y: 0 }])).toEqual([]);
    expect(delaunayTriangulate([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual([]);
  });

  it("코너 4개만 삼각분할하면 정확히 2개의 삼각형이 단위 사각형 전체를 빈틈없이 덮는다", () => {
    const points = [...PUPPET_WARP_CORNERS];
    const triangles = delaunayTriangulate(points);
    expect(triangles.length).toBe(2);
    let totalArea = 0;
    for (const [i0, i1, i2] of triangles) {
      totalArea += triangleAreaNorm(points[i0]!, points[i1]!, points[i2]!);
    }
    expect(totalArea).toBeCloseTo(1, 10); // 단위 사각형 넓이 = 1.
  });

  it("반환된 삼각형은 슈퍼 삼각형 정점을 참조하지 않는다(모두 유효 인덱스)", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0.5, y: 0.5 },
      { x: 0.3, y: 0.7 },
    ];
    const triangles = delaunayTriangulate(points);
    for (const t of triangles) {
      for (const idx of t) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(points.length);
      }
    }
  });

  it("코너 + 내부 점 여러 개 — 오일러 공식(T = 2n - h - 2, 볼록껍질 h=4)을 만족한다", () => {
    const points: SelPoint[] = [
      ...PUPPET_WARP_CORNERS,
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.5, y: 0.6 },
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.7 },
    ];
    const triangles = delaunayTriangulate(points);
    const n = points.length;
    const h = 4; // 내부 점들은 전부 사각형 안쪽이라 볼록껍질에 기여하지 않는다.
    expect(triangles.length).toBe(2 * n - h - 2);
  });

  it("삼각분할 전체 면적의 합은 항상 볼록껍질(여기선 단위 사각형) 넓이와 같다 — 빈틈/겹침이 없다", () => {
    const points: SelPoint[] = [
      ...PUPPET_WARP_CORNERS,
      { x: 0.25, y: 0.25 },
      { x: 0.75, y: 0.25 },
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.75 },
      { x: 0.75, y: 0.75 },
    ];
    const triangles = delaunayTriangulate(points);
    let totalArea = 0;
    for (const [i0, i1, i2] of triangles) {
      totalArea += triangleAreaNorm(points[i0]!, points[i1]!, points[i2]!);
    }
    expect(totalArea).toBeCloseTo(1, 8);
  });

  it("결정적 — 같은 입력이면 항상 같은 삼각형 목록을 반환한다", () => {
    const points: SelPoint[] = [...PUPPET_WARP_CORNERS, { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }];
    expect(delaunayTriangulate(points)).toEqual(delaunayTriangulate(points));
  });
});

describe("triangulatePuppetMesh", () => {
  it("핀 배열로부터 puppetMeshVertices(pins).rest 를 삼각분할한 것과 동일하다", () => {
    const pins = [pin("a", 0.3, 0.3), pin("b", 0.7, 0.6)];
    expect(triangulatePuppetMesh(pins)).toEqual(delaunayTriangulate(puppetMeshVertices(pins).rest));
  });

  it("핀을 드래그해도(현재 위치만 바뀜) 위상(삼각형 인덱스 목록)은 그대로다", () => {
    const pins = [pin("a", 0.3, 0.3), pin("b", 0.7, 0.6)];
    const before = triangulatePuppetMesh(pins);
    const dragged = movePuppetPin(pins, "a", 0.35, 0.32);
    const after = triangulatePuppetMesh(dragged);
    expect(after).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// (4) 삼각형 아핀 변환
// ---------------------------------------------------------------------------

describe("triangleAffineTransform", () => {
  const src: [SelPoint, SelPoint, SelPoint] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  it("src===dst 이면 항등 변환", () => {
    const m = triangleAffineTransform(src, src);
    expect(m).not.toBeNull();
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
  });

  it("순수 평행이동", () => {
    const dst: [SelPoint, SelPoint, SelPoint] = [
      { x: 5, y: 3 },
      { x: 15, y: 3 },
      { x: 5, y: 13 },
    ];
    const m = triangleAffineTransform(src, dst)!;
    expect(m).toEqual({ a: 1, b: 0, c: 0, d: 1, e: 5, f: 3 });
  });

  it("일반적인 변환도 세 대응점 모두를 정확히 매핑한다(s0 뿐 아니라 s1/s2도 검증)", () => {
    const dst: [SelPoint, SelPoint, SelPoint] = [
      { x: 2, y: 2 },
      { x: 2, y: 22 }, // s1 방향이 90도 회전됨
      { x: -8, y: 2 }, // s2 방향도 회전됨
    ];
    const m = triangleAffineTransform(src, dst)!;
    const apply = (p: SelPoint) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
    expect(apply(src[0])).toEqual(dst[0]);
    expect(apply(src[1]).x).toBeCloseTo(dst[1].x, 10);
    expect(apply(src[1]).y).toBeCloseTo(dst[1].y, 10);
    expect(apply(src[2]).x).toBeCloseTo(dst[2].x, 10);
    expect(apply(src[2]).y).toBeCloseTo(dst[2].y, 10);
  });

  it("소스 삼각형이 퇴화(공선)면 null", () => {
    const collinear: [SelPoint, SelPoint, SelPoint] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    expect(triangleAffineTransform(collinear, src)).toBeNull();
  });

  it("소스 삼각형의 두 점이 같아도(면적 0) null", () => {
    const degenerate: [SelPoint, SelPoint, SelPoint] = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(triangleAffineTransform(degenerate, src)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (5) Konva 오버레이용 기하
// ---------------------------------------------------------------------------

describe("puppetMeshTriangleLines", () => {
  it("삼각형 개수만큼 평탄 좌표 배열을 반환하고, 좌표는 size 로 스케일된다", () => {
    const pins = [pin("a", 0.5, 0.5)];
    const lines = puppetMeshTriangleLines(pins, { width: 200, height: 100 });
    const expectedCount = triangulatePuppetMesh(pins).length;
    expect(lines.length).toBe(expectedCount);
    for (const line of lines) {
      expect(line.length).toBe(6);
      // 모든 좌표가 캔버스 크기 범위 안(핀이 0..1 클램프되므로).
      for (let i = 0; i < line.length; i += 2) {
        expect(line[i]!).toBeGreaterThanOrEqual(0);
        expect(line[i]!).toBeLessThanOrEqual(200);
        expect(line[i + 1]!).toBeGreaterThanOrEqual(0);
        expect(line[i + 1]!).toBeLessThanOrEqual(100);
      }
    }
  });

  it("핀을 드래그하면(현재 위치) 해당 삼각형의 좌표도 함께 움직인다", () => {
    const pins = [pin("a", 0.5, 0.5)];
    const before = puppetMeshTriangleLines(pins, { width: 100, height: 100 });
    const dragged = movePuppetPin(pins, "a", 0.9, 0.9);
    const after = puppetMeshTriangleLines(dragged, { width: 100, height: 100 });
    expect(after).not.toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// (6) bakePuppetWarpToCanvas — DOM 없는 가짜 팩토리(studio-heal-clone.test.ts 와 동일 패턴)
// ---------------------------------------------------------------------------

type FakeCanvas = MaskCanvasLike & MaskImageSource & { id: number };

function fakePuppetWarpFactory(log: string[]): PuppetWarpCanvasFactory {
  let count = 0;
  return (width, height) => {
    count += 1;
    const id = count;
    const canvas: FakeCanvas = { id, width, height };
    const ctx: PuppetWarpCtx2DLike = {
      fillStyle: "#fff",
      strokeStyle: "#fff",
      globalCompositeOperation: "source-over",
      filter: "none",
      lineWidth: 1,
      lineCap: "butt",
      lineJoin: "miter",
      beginPath: () => log.push("beginPath"),
      moveTo: (x, y) => log.push(`moveTo(${x},${y})`),
      lineTo: (x, y) => log.push(`lineTo(${x},${y})`),
      closePath: () => log.push("closePath"),
      fill: () => log.push("fill"),
      stroke: () => log.push("stroke"),
      fillRect: () => {},
      clearRect: () => {},
      drawImage: () => log.push("drawImage"),
      save: () => log.push("save"),
      restore: () => log.push("restore"),
      transform: (a, b, c, d, e, f) => log.push(`transform(${[a, b, c, d, e, f].map((n) => n.toFixed(2)).join(",")})`),
      clip: () => log.push("clip"),
    };
    return { canvas, ctx };
  };
}

describe("bakePuppetWarpToCanvas", () => {
  const source: MaskImageSource = {};

  it("핀이 없으면(무연산) 캔버스를 아예 만들지 않고 null", () => {
    const log: string[] = [];
    const out = bakePuppetWarpToCanvas(source, 100, 100, [], fakePuppetWarpFactory(log));
    expect(out).toBeNull();
    expect(log).toEqual([]);
  });

  it("모든 핀이 rest 위치 그대로면(무연산) null", () => {
    const log: string[] = [];
    const out = bakePuppetWarpToCanvas(source, 100, 100, [pin("a", 0.5, 0.5)], fakePuppetWarpFactory(log));
    expect(out).toBeNull();
    expect(log).toEqual([]);
  });

  it("너비/높이가 비정상이면 null", () => {
    const log: string[] = [];
    const pins = [pin("a", 0.5, 0.5, { x: 0.6, y: 0.5 })];
    expect(bakePuppetWarpToCanvas(source, 0, 100, pins, fakePuppetWarpFactory(log))).toBeNull();
    expect(bakePuppetWarpToCanvas(source, 100, Number.NaN, pins, fakePuppetWarpFactory(log))).toBeNull();
    expect(log).toEqual([]);
  });

  it("드래그된 핀이 있으면 폴백 바닥층 1회 + 삼각형마다 save/clip/transform/drawImage/restore 를 그린다", () => {
    const log: string[] = [];
    const pins = [pin("a", 0.5, 0.5, { x: 0.6, y: 0.45 })];
    const expectedTriangleCount = triangulatePuppetMesh(pins).length;
    const out = bakePuppetWarpToCanvas(source, 200, 100, pins, fakePuppetWarpFactory(log));
    expect(out).not.toBeNull();
    expect((out as FakeCanvas).width).toBe(200);
    expect((out as FakeCanvas).height).toBe(100);

    const drawImageCount = log.filter((l) => l === "drawImage").length;
    // 폴백 바닥층 1회 + 삼각형마다 1회.
    expect(drawImageCount).toBe(1 + expectedTriangleCount);
    const saveCount = log.filter((l) => l === "save").length;
    const restoreCount = log.filter((l) => l === "restore").length;
    expect(saveCount).toBe(expectedTriangleCount);
    expect(restoreCount).toBe(expectedTriangleCount);
    // 폴백 바닥층은 첫 호출이어야 한다(삼각형 그리기보다 먼저).
    expect(log[0]).toBe("drawImage");
  });

  it("flipX/flipY 를 반영해 좌표를 되돌린 뒤 디바이스 px 로 변환한다", () => {
    // 핀 하나만 드래그 — 결과가 flip 옵션에 따라 달라지는지(같은 좌표가 그대로 나오지 않는지)만 검증한다.
    const pins = [pin("a", 0.5, 0.5, { x: 0.9, y: 0.5 })];
    const logNoFlip: string[] = [];
    bakePuppetWarpToCanvas(source, 100, 100, pins, fakePuppetWarpFactory(logNoFlip));
    const logFlipX: string[] = [];
    bakePuppetWarpToCanvas(source, 100, 100, pins, fakePuppetWarpFactory(logFlipX), { flipX: true });
    const transformsNoFlip = logNoFlip.filter((l) => l.startsWith("transform"));
    const transformsFlipX = logFlipX.filter((l) => l.startsWith("transform"));
    expect(transformsFlipX).not.toEqual(transformsNoFlip);
  });

  // 아래 3개는 검증 스크립트(tsx 로 실제 함수를 호출해 좌표를 손으로/독립적으로 재계산)로 실측
  // 확인한 내용을 회귀 테스트로 고정한 것 — 위의 기존 테스트들은 "몇 번 호출됐는지"(call count)만
  // 확인하고 "그 좌표가 실제로 맞는지"는 확인하지 않았던 갭을 메운다.

  /** transform()/moveTo()/lineTo() 인자를 원시 숫자 배열로 기록하는 팩토리(문자열 반올림 없음 —
   * 위 fakePuppetWarpFactory 는 transform 인자를 toFixed(2) 로 반올림해 정밀 비교에 부적합하다). */
  function recordingPuppetWarpFactory(ops: { kind: string; args: number[] }[]): PuppetWarpCanvasFactory {
    return (width, height) => {
      const canvas: FakeCanvas = { id: 0, width, height };
      const ctx: PuppetWarpCtx2DLike = {
        fillStyle: "#fff",
        strokeStyle: "#fff",
        globalCompositeOperation: "source-over",
        filter: "none",
        lineWidth: 1,
        lineCap: "butt",
        lineJoin: "miter",
        beginPath: () => ops.push({ kind: "beginPath", args: [] }),
        moveTo: (x, y) => ops.push({ kind: "moveTo", args: [x, y] }),
        lineTo: (x, y) => ops.push({ kind: "lineTo", args: [x, y] }),
        closePath: () => ops.push({ kind: "closePath", args: [] }),
        fill: () => ops.push({ kind: "fill", args: [] }),
        stroke: () => ops.push({ kind: "stroke", args: [] }),
        fillRect: () => {},
        clearRect: () => {},
        drawImage: () => ops.push({ kind: "drawImage", args: [] }),
        save: () => ops.push({ kind: "save", args: [] }),
        restore: () => ops.push({ kind: "restore", args: [] }),
        transform: (a, b, c, d, e, f) => ops.push({ kind: "transform", args: [a, b, c, d, e, f] }),
        clip: () => ops.push({ kind: "clip", args: [] }),
      };
      return { canvas, ctx };
    };
  }

  it("구운 transform()/clip() 좌표가 triangleAffineTransform 직접 호출 결과와 정확히 일치한다(호출 횟수만이 아니라 기하 자체를 검증)", () => {
    let pins: PuppetPin[] = addPuppetPin([], { id: "a", x: 0.3, y: 0.3 });
    pins = addPuppetPin(pins, { id: "b", x: 0.6, y: 0.5 });
    pins = movePuppetPin(pins, "a", 0.35, 0.28);
    pins = movePuppetPin(pins, "b", 0.55, 0.6);

    const w = 400;
    const h = 300;
    const ops: { kind: string; args: number[] }[] = [];
    const out = bakePuppetWarpToCanvas(source, w, h, pins, recordingPuppetWarpFactory(ops));
    expect(out).not.toBeNull();

    const { rest, current } = puppetMeshVertices(pins);
    const triangles = triangulatePuppetMesh(pins);
    const restDevice = rest.map((p) => ({ x: p.x * w, y: p.y * h }));
    const currentDevice = current.map((p) => ({ x: p.x * w, y: p.y * h }));

    const transformOps = ops.filter((o) => o.kind === "transform");
    expect(transformOps.length).toBe(triangles.length);
    triangles.forEach(([i0, i1, i2], idx) => {
      const expected = triangleAffineTransform(
        [restDevice[i0]!, restDevice[i1]!, restDevice[i2]!],
        [currentDevice[i0]!, currentDevice[i1]!, currentDevice[i2]!]
      )!;
      const [a, b, c, d, e, f] = transformOps[idx]!.args;
      expect([a, b, c, d, e, f]).toEqual([expected.a, expected.b, expected.c, expected.d, expected.e, expected.f]);
    });

    // clip 경로(moveTo + lineTo*2)도 currentDevice 삼각형 꼭짓점과 정확히 일치해야 한다.
    let clipIdx = 0;
    for (let i = 0; i < ops.length; i += 1) {
      if (ops[i]!.kind !== "beginPath") continue;
      const [i0, i1, i2] = triangles[clipIdx]!;
      expect(ops[i + 1]).toEqual({ kind: "moveTo", args: [currentDevice[i0]!.x, currentDevice[i0]!.y] });
      expect(ops[i + 2]).toEqual({ kind: "lineTo", args: [currentDevice[i1]!.x, currentDevice[i1]!.y] });
      expect(ops[i + 3]).toEqual({ kind: "lineTo", args: [currentDevice[i2]!.x, currentDevice[i2]!.y] });
      clipIdx += 1;
    }
    expect(clipIdx).toBe(triangles.length);
  });

  it("flipX 를 켜고 구우면 transform/clip 좌표가 '화면 좌표를 flipNormalizedPoint 로 자연 px 로 되돌린 뒤 스케일'과 정확히 일치한다(부호 실수 방지)", () => {
    // 화면에 보이는(반전 표시) 이미지 기준 핀 2개 — rest/current 모두 flipX 왕복이 걸린다.
    let pins: PuppetPin[] = addPuppetPin([], { id: "a", x: 0.2, y: 0.4 });
    pins = addPuppetPin(pins, { id: "b", x: 0.7, y: 0.6 });
    pins = movePuppetPin(pins, "a", 0.25, 0.35);
    pins = movePuppetPin(pins, "b", 0.75, 0.65);

    const w = 500;
    const h = 350;
    const ops: { kind: string; args: number[] }[] = [];
    const out = bakePuppetWarpToCanvas(source, w, h, pins, recordingPuppetWarpFactory(ops), { flipX: true });
    expect(out).not.toBeNull();

    // bakePuppetWarpToCanvas 내부의 toDevice 와 정확히 동일한 공식을 여기서 독립적으로 재계산한다:
    // flipNormalizedPoint(p, true, false) 로 화면→자연 좌표로 되돌린 뒤 (w,h) 로 스케일.
    const { rest, current } = puppetMeshVertices(pins);
    const triangles = triangulatePuppetMesh(pins);
    const toNaturalDevice = (p: SelPoint) => {
      const flipped = flipNormalizedPoint(p, true, false);
      return { x: flipped.x * w, y: flipped.y * h };
    };
    const restDevice = rest.map(toNaturalDevice);
    const currentDevice = current.map(toNaturalDevice);

    const transformOps = ops.filter((o) => o.kind === "transform");
    expect(transformOps.length).toBe(triangles.length);
    triangles.forEach(([i0, i1, i2], idx) => {
      const expected = triangleAffineTransform(
        [restDevice[i0]!, restDevice[i1]!, restDevice[i2]!],
        [currentDevice[i0]!, currentDevice[i1]!, currentDevice[i2]!]
      )!;
      const [a, b, c, d, e, f] = transformOps[idx]!.args;
      expect([a, b, c, d, e, f]).toEqual([expected.a, expected.b, expected.c, expected.d, expected.e, expected.f]);
    });
  });

  it("REST 삼각형이 (극단적으로 가까운 핀 2개 탓에) 사실상 퇴화되면 그 삼각형만 건너뛰고 나머지는 정상적으로 굽는다(폴백 바닥층 덕에 크래시도 빈 구멍도 없음)", () => {
    // addPuppetPin 의 PUPPET_PIN_MIN_DIST(0.035) 가드를 우회해 손으로 직접 만든 PuppetPin 배열 —
    // 실제 UI로는 도달 불가능하지만(가드가 이미 훨씬 큰 최소거리를 강제), bakePuppetWarpToCanvas 는
    // pins 를 그대로 받는 순수 함수라 방어 코드(triangleAffineTransform 이 null 이면 continue)가
    // 정말 안전한지는 이렇게 직접 검증해야 한다 — 이전 세션 요약은 "이런 테스트를 추가했다"고
    // 주장했지만 실제 파일에는 없었다(검증 중 발견). 아래 gap=1e-11 은 검증 스크립트로 실측한,
    // 코너 보호 효과를 뚫고 실제로 면적≈0 삼각형 2개를 만들어내는 값이다.
    const gap = 1e-11;
    const pins: PuppetPin[] = [
      { id: "p1", restX: 0.5, restY: 0.5, x: 0.6, y: 0.4 },
      { id: "p2", restX: 0.5 + gap, restY: 0.5 + gap, x: 0.65, y: 0.45 },
    ];
    const triangles = triangulatePuppetMesh(pins);
    expect(triangles.length).toBe(6); // 검증 스크립트로 확인한 위상 — 4코너+2핀, 코너 보호로 완전히 붕괴하지 않음.

    // 아주 작은 캔버스(4x4)에서는 device-scale det(≈normalizedArea*w*h*2) 가 두 개의 거의-퇴화
    // 삼각형에서 triangleAffineTransform 의 1e-9 문턱보다 작아져 실제로 스킵된다.
    const log: string[] = [];
    const out = bakePuppetWarpToCanvas(source, 4, 4, pins, fakePuppetWarpFactory(log));
    expect(out).not.toBeNull(); // 폴백 바닥층 덕에 항상 null 이 아니라 유효한 캔버스.
    const drawImageCount = log.filter((l) => l === "drawImage").length;
    // 1(폴백) + (6 - 2skip) = 5 — 즉 2개 삼각형이 실제로 건너뛰어졌다(전부 그렸다면 7).
    expect(drawImageCount).toBe(5);
    expect(drawImageCount).toBeLessThan(1 + triangles.length);

    // 큰 캔버스(8000x8000)에서는 같은 gap 이 더 이상 문턱 아래로 안 떨어져 전부 그려진다(참고용
    // 대조 — "퇴화 여부는 device 스케일에 좌우된다"는 것 자체를 문서화).
    const logLarge: string[] = [];
    const outLarge = bakePuppetWarpToCanvas(source, 8000, 8000, pins, fakePuppetWarpFactory(logLarge));
    expect(outLarge).not.toBeNull();
    const drawImageCountLarge = logLarge.filter((l) => l === "drawImage").length;
    expect(drawImageCountLarge).toBe(1 + triangles.length);
  });
});
