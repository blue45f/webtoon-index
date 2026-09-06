import { describe, expect, it } from "vitest";

import {
  anchorQuickShapePoints,
  anchorQuickShapePointsForLiveDrag,
  classifyQuickShape,
  promoteFreehandQuickShapeOnRelease,
  QUICKSHAPE_HOLD_MS,
  QUICKSHAPE_LOCK_HOLD_MS,
  regularizeQuickShapePoints,
  trimQuickShapeDwellTail,
} from "./studio-quickshape";

// ---------------------------------------------------------------------------
// 결정적 손그림 픽스처 생성기 — studio-node-edit.test.ts 의 straightLinePoints 관례를 따른다.
// 지터는 studio-brush.ts 의 hash() 와 같은 방식의 결정적 사인 해시로 재현 가능하게 만든다.
// ---------------------------------------------------------------------------

function detHash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

/** 편평한 벽에 아주 살짝만 지터를 준 "거의 직선" 프리핸드 스트로크. */
function nearLinePoints(x0: number, y0: number, x1: number, y1: number, n = 24, jitterAmp = 0.6): number[] {
  const pts: number[] = [];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len; // 수직 방향(지터용)
  const ny = dx / len;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const jitter = (detHash(i * 3.1) - 0.5) * 2 * jitterAmp;
    pts.push(x0 + dx * t + nx * jitter, y0 + dy * t + ny * jitter);
  }
  return pts;
}

/** 완전 직선(지터 없음) — deviationRatio 경계 테스트용. */
function straightLine(x0: number, y0: number, x1: number, y1: number, n = 12): number[] {
  return nearLinePoints(x0, y0, x1, y1, n, 0);
}

/**
 * 정n각형 변을 따라 각 변에 pointsPerEdge 개 점을 찍는 "손그림 다각형" 스트로크.
 * jitterAmp>0 이면 각 점에 결정적 지터를 준다. 시작점 근처로 돌아와 닫힌 루프를 흉내낸다.
 */
function polygonStrokePoints(
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  pointsPerEdge = 8,
  jitterAmp = 0
): number[] {
  const verts: { x: number; y: number }[] = [];
  for (let i = 0; i <= sides; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    verts.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
  }
  const pts: number[] = [];
  let seq = 0;
  for (let e = 0; e < sides; e++) {
    const a = verts[e]!;
    const b = verts[e + 1]!;
    for (let k = 0; k < pointsPerEdge; k++) {
      const t = k / pointsPerEdge;
      const jitter = jitterAmp > 0 ? (detHash(seq * 7.7) - 0.5) * 2 * jitterAmp : 0;
      pts.push(a.x + (b.x - a.x) * t + jitter, a.y + (b.y - a.y) * t + jitter);
      seq++;
    }
  }
  // 닫힘: 마지막 정점(= 첫 정점)까지 도달.
  pts.push(verts[sides]!.x, verts[sides]!.y);
  return pts;
}

/** 손그림 원/타원 — 각도로 균등 샘플, 살짝 닫히지 않은 끝(closureRatio 판정용 자연스러운 갭). */
function ellipseStrokePoints(cx: number, cy: number, rx: number, ry: number, segments = 48, jitterAmp = 0): number[] {
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI * 0.98) / segments; // 2% 못 닫은 갭(자연스러운 손그림)
    const jitter = jitterAmp > 0 ? (detHash(i * 5.3) - 0.5) * 2 * jitterAmp : 0;
    pts.push(cx + (rx + jitter) * Math.cos(angle), cy + (ry + jitter) * Math.sin(angle));
  }
  return pts;
}

/**
 * 손그림 축정렬 사각형 — polygonStrokePoints(sides=4)와 달리 실제로 x/y축에 평행한 변을 가진
 * 직사각형을 생성한다("정사각형과 같은 정n각형 공식으로 4각을 만들면 대각선이 45°인 마름모가
 * 되어 실제 손그림 사각형과 지오메트리가 전혀 다르다").
 */
function rectStrokePoints(x0: number, y0: number, x1: number, y1: number, pointsPerEdge = 10, jitterAmp = 0): number[] {
  const verts = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
    { x: x0, y: y0 },
  ];
  const pts: number[] = [];
  let seq = 0;
  for (let e = 0; e < 4; e++) {
    const a = verts[e]!;
    const b = verts[e + 1]!;
    for (let k = 0; k < pointsPerEdge; k++) {
      const t = k / pointsPerEdge;
      const jitter = jitterAmp > 0 ? (detHash(seq * 7.7) - 0.5) * 2 * jitterAmp : 0;
      pts.push(a.x + (b.x - a.x) * t + jitter, a.y + (b.y - a.y) * t + jitter);
      seq++;
    }
  }
  pts.push(verts[4]!.x, verts[4]!.y);
  return pts;
}

describe("classifyQuickShape — 가드(guard)", () => {
  const rect = rectStrokePoints(40, 40, 160, 160, 8);

  it("holdDurationMs 가 QUICKSHAPE_HOLD_MS 미만이면 항상 null", () => {
    expect(classifyQuickShape(rect, QUICKSHAPE_HOLD_MS - 1)).toBeNull();
    expect(classifyQuickShape(rect, 0)).toBeNull();
  });

  it("holdDurationMs 가 음수/NaN 이면 null(NaN<임계값은 JS 상 false 라 별도 가드가 필요)", () => {
    expect(classifyQuickShape(rect, -100)).toBeNull();
    expect(classifyQuickShape(rect, Number.NaN)).toBeNull();
  });

  it("점 개수가 QUICKSHAPE_MIN_POINTS 미만이면 null", () => {
    expect(classifyQuickShape([0, 0, 10, 10], QUICKSHAPE_HOLD_MS)).toBeNull();
  });

  it("바운딩박스 대각선이 QUICKSHAPE_MIN_SIZE_PX 미만이면 null(우발적 탭 방지)", () => {
    const tap = nearLinePoints(50, 50, 52, 51, 6, 0.2);
    expect(classifyQuickShape(tap, QUICKSHAPE_HOLD_MS)).toBeNull();
  });

  it("points 길이가 홀수면 null", () => {
    expect(classifyQuickShape([0, 0, 10, 10, 20], QUICKSHAPE_HOLD_MS)).toBeNull();
  });

  it("points 에 NaN/비수치가 섞여 있으면 null", () => {
    const bad = [...rect];
    bad[4] = Number.NaN;
    expect(classifyQuickShape(bad, QUICKSHAPE_HOLD_MS)).toBeNull();
  });
});

describe("classifyQuickShape — 열린 스트로크(직선)", () => {
  it("거의 곧은 손그림 선 → line, 끝점은 실제 투영된 min/max", () => {
    const pts = nearLinePoints(10, 10, 210, 14, 30, 0.5);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("line");
    expect(match?.points[0]).toBeCloseTo(10, 0);
    expect(match?.points[2]).toBeCloseTo(210, 0);
  });

  it("완전 직선(지터 없음)도 인식된다", () => {
    const pts = straightLine(0, 0, 300, 300);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("line");
  });

  it("지터가 허용 범위를 넘는 삐뚤빼뚤한 열린 스트로크는 null(추측하지 않음)", () => {
    // 매 점마다 큰 진폭의 무작위성 있는 지그재그 — deviationRatio 가 임계값을 크게 초과하도록.
    const pts: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = i / 19;
      const zigzag = i % 2 === 0 ? 40 : -40;
      pts.push(t * 300, 150 + zigzag);
    }
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match).toBeNull();
  });
});

describe("classifyQuickShape — 닫힌 루프(코너 카운팅)", () => {
  it("홀드 중 펜 지터 꼬리를 제외하면 사각형 라이브/릴리스 인식이 유지된다", () => {
    const clean = rectStrokePoints(0, 0, 200, 100, 10, 0);
    const jittered = [...clean];
    for (let index = 0; index < 20; index += 1) {
      const angle = (index * Math.PI * 2) / 7;
      const radius = 2 + (index % 4);
      jittered.push(Math.cos(angle) * radius, Math.sin(angle) * radius);
    }

    const recognitionRoute = trimQuickShapeDwellTail(jittered, clean.length);

    expect(classifyQuickShape(recognitionRoute, QUICKSHAPE_HOLD_MS)?.kind).toBe("rect");
    expect(promoteFreehandQuickShapeOnRelease(recognitionRoute)?.kind).toBe("rect");
    expect(recognitionRoute).toEqual(clean);
  });

  it("손그림 축정렬 사각형(4코너, 약간 지터) → rect, points 는 바운딩 박스", () => {
    const pts = rectStrokePoints(40, 20, 160, 140, 10, 0.3);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("rect");
    const [x0, y0, x1, y1] = match!.points;
    // 바운딩박스는 지터가 섞인 원본 점들의 실제 min/max 이므로 지터 진폭만큼의 오차를 허용한다.
    expect(Math.min(x0, x1)).toBeCloseTo(40, 0);
    expect(Math.max(x0, x1)).toBeCloseTo(160, 0);
    expect(Math.min(y0, y1)).toBeCloseTo(20, 0);
    expect(Math.max(y0, y1)).toBeCloseTo(140, 0);
  });

  it("가로/세로 비율이 큰(3:1~4:1) 손그림 직사각형도 rect 로 인식된다(짧은 변 양끝 코너 뭉개짐 회귀 방지)", () => {
    // 적대적 리뷰에서 발견: 리샘플 루프의 코너 병합 반경이 각도 평활 window 와 같아, 짧은 변의
    // 양끝 두 코너가 하나로 뭉개져 cornerCount 가 4→2 로 떨어지며 "정직사각형"인데도 null 이
    // 되던 회귀. 만화 패널/말풍선처럼 흔한 가늘고 긴 직사각형에서 실사용 임팩트가 컸다.
    for (const ratio of [2, 3, 4]) {
      const w = 120;
      const h = w / ratio;
      const pts = rectStrokePoints(0, 0, w, h, 12, 0.3);
      const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
      expect(match?.kind).toBe("rect");
    }
  });

  it("45°로 회전한 정사각형(다이아몬드)도 지터와 무관하게 rect 로 인식된다(면적비 문턱 경계 회귀 방지)", () => {
    // 적대적 리뷰에서 발견: 이전 나비매듭 가드(shoelace 면적/바운딩박스 면적 ≤ 0.5)는 45° 회전한
    // 정사각형의 면적비가 수학적으로 정확히 0.5 — 문턱과 동일값 — 이라 지터 방향에 따라 무작위로
    // rect/null 이 갈렸다. segmentsIntersect 기반 자기교차 검사로 교체해 결정적으로 통과해야 한다.
    for (let seed = 0; seed < 8; seed++) {
      const verts: { x: number; y: number }[] = [];
      for (let i = 0; i <= 4; i++) {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 4;
        verts.push({ x: 100 + 75 * Math.cos(angle), y: 100 + 75 * Math.sin(angle) });
      }
      const pts: number[] = [];
      let s = 0;
      for (let e = 0; e < 4; e++) {
        const a = verts[e]!;
        const b = verts[e + 1]!;
        for (let k = 0; k < 10; k++) {
          const t = k / 10;
          const jitter = (detHash((s + seed * 97) * 7.7) - 0.5) * 2 * 0.5;
          pts.push(a.x + (b.x - a.x) * t + jitter, a.y + (b.y - a.y) * t + jitter);
          s++;
        }
      }
      pts.push(verts[4]!.x, verts[4]!.y);
      const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
      expect(match?.kind).toBe("rect");
    }
  });

  it("손그림 삼각형(3코너) → triangle", () => {
    const pts = polygonStrokePoints(100, 100, 70, 3, 10, 1);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("triangle");
  });

  it("손그림 원 → ellipse(코너 없음)", () => {
    const pts = ellipseStrokePoints(100, 100, 60, 60, 48, 0.8);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("ellipse");
  });

  it("살짝 납작한 타원(닫힘 비율은 작지만 코너 없음) → ellipse", () => {
    const pts = ellipseStrokePoints(100, 100, 63, 57, 48, 0.5);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("ellipse");
  });

  it("아주 납작한 타원(장단축비 4.5:1)은 끝점 곡률이 코너 문턱을 넘어 null — 잘못된 kind로 추측하지 않는다", () => {
    // 극단적으로 긴 타원의 뾰족한 양 끝은 국소 곡률이 매우 높아, 이 모듈의 코너 검출기가 두 지점을
    // "코너 후보"로 잡는다(코너 2개는 어떤 kind 로도 매치되지 않아 null) — 원형 인식의 알려진
    // 잔여 한계이며, 잘못된 kind 를 반환하지 않는 안전한 실패 모드다(설계 문서 §5 참조).
    const pts = ellipseStrokePoints(100, 100, 90, 20, 48, 0.5);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match).toBeNull();
  });

  it("손그림 정오각형(5코너, 변 길이 고름) → polygon, polygonSides=5", () => {
    const pts = polygonStrokePoints(100, 100, 70, 5, 10, 1);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("polygon");
    expect(match?.polygonSides).toBe(5);
  });

  it("손그림 정육각형(6코너) → polygon, polygonSides=6", () => {
    const pts = polygonStrokePoints(100, 100, 70, 6, 10, 1);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("polygon");
    expect(match?.polygonSides).toBe(6);
  });

  it("손그림 정십각형(10코너, QUICKSHAPE_MAX_POLYGON_SIDES 경계) → polygon, sides=10", () => {
    const pts = polygonStrokePoints(100, 100, 80, 10, 8, 0.6);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("polygon");
    expect(match?.polygonSides).toBe(10);
  });

  it("11각 이상 정n각형은 polygon 으로 잘못 스냅하지 않는다(원형이면 ellipse 폴백 허용)", () => {
    // 정십이각형은 반경 CV 가 원에 가까워 ellipse 폴백이 될 수 있다 — 잘못된 "polygon sides=10/12"
    // 추측만 막으면 된다(손그림 다각 별/별똥별 낙서를 정십이각형으로 고정하는 것보다 안전).
    const pts = polygonStrokePoints(100, 100, 80, 12, 6, 0.4);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).not.toBe("polygon");
    expect(match === null || match?.kind === "ellipse").toBe(true);
  });

  it("변 길이가 들쭉날쭉한 5~10코너 낙서는 null(고름성 CV 가드)", () => {
    // 정오각형을 한쪽만 크게 찌그러뜨려 변 길이 변동계수를 크게 키운다.
    const verts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 5; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const r = i === 1 ? 200 : 60; // 한 꼭짓점만 크게 돌출
      verts.push({ x: 100 + r * Math.cos(angle), y: 100 + r * Math.sin(angle) });
    }
    const pts: number[] = [];
    for (let e = 0; e < 5; e++) {
      const a = verts[e]!;
      const b = verts[e + 1]!;
      for (let k = 0; k < 10; k++) {
        const t = k / 10;
        pts.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
    pts.push(verts[5]!.x, verts[5]!.y);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    // 찌그러진 오각형은 polygon 으로 잘못 스냅되지 않아야 한다(null 이거나, 코너 수가 달리
    // 세어져 다른 kind 로 떨어질 수도 있으나 정오각형 규칙성 가드를 통과한 "polygon"이면 안 된다).
    if (match?.kind === "polygon") {
      throw new Error("들쭉날쭉한 변을 정다각형으로 잘못 스냅했습니다");
    }
  });

  it("자기교차(나비매듭) 낙서는 rect 로 오인하지 않는다(대각선 교차 가드)", () => {
    // (0,0) → (100,100) → (100,0) → (0,100) → (0,0): 4개 꼭짓점이지만 스스로 교차하는 나비매듭.
    const bowtie: number[] = [];
    const verts = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
      { x: 0, y: 0 },
    ];
    for (let e = 0; e < verts.length - 1; e++) {
      const a = verts[e]!;
      const b = verts[e + 1]!;
      for (let k = 0; k < 10; k++) {
        const t = k / 10;
        bowtie.push(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      }
    }
    bowtie.push(0, 0);
    const match = classifyQuickShape(bowtie, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).not.toBe("rect");
  });

  it("느리고 신중하게 그린 원(점 수백 개)도 올바르게 ellipse 로 인식된다(입력 크기 무관 정확도)", () => {
    const pts = ellipseStrokePoints(150, 150, 80, 80, 400, 0.3);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("ellipse");
  });
});

describe("regularizeQuickShapePoints", () => {
  it("rect: 앵커(x0,y0) 고정, s=max(|dx|,|dy|) 로 정사각형화(기존 Shift 락과 동일 공식)", () => {
    const [x0, y0, x1, y1] = regularizeQuickShapePoints("rect", [0, 0, 100, 40]);
    expect(x0).toBe(0);
    expect(y0).toBe(0);
    expect(Math.abs(x1 - x0)).toBeCloseTo(Math.abs(y1 - y0), 6);
    expect(Math.abs(x1 - x0)).toBeCloseTo(100, 6);
  });

  it("ellipse/triangle/polygon 도 동일한 정사각형화 공식을 쓴다", () => {
    for (const kind of ["ellipse", "triangle", "polygon"] as const) {
      const [x0, y0, x1, y1] = regularizeQuickShapePoints(kind, [10, 10, 10 + 30, 10 + 90]);
      expect(x0).toBe(10);
      expect(y0).toBe(10);
      expect(Math.abs(x1 - x0)).toBeCloseTo(Math.abs(y1 - y0), 6);
    }
  });

  it("음수 방향 dx/dy 도 부호를 보존해 정사각형화한다", () => {
    const [x0, y0, x1, y1] = regularizeQuickShapePoints("rect", [50, 50, 10, 5]);
    expect(x1).toBeLessThan(x0);
    expect(y1).toBeLessThan(y0);
    expect(Math.abs(x1 - x0)).toBeCloseTo(Math.abs(y1 - y0), 6);
  });

  it("line: 길이를 보존한 채 가장 가까운 45° 배수로 각도를 스냅한다", () => {
    const [x0, y0, x1, y1] = regularizeQuickShapePoints("line", [0, 0, 100, 12]);
    const len = Math.hypot(100, 12);
    expect(x0).toBe(0);
    expect(y0).toBe(0);
    // round2(소수 둘째 자리 반올림) 오차 범위 내로 비교 — 완전한 정밀 일치는 요구하지 않는다.
    expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(len, 1);
    expect(y1).toBeCloseTo(0, 1); // 12° 는 0°(수평)로 스냅
  });

  it("line: 45°에 가까운 각은 정확히 45°로 스냅된다", () => {
    const [x0, y0, x1, y1] = regularizeQuickShapePoints("line", [0, 0, 100, 92]);
    expect(x1 - x0).toBeCloseTo(y1 - y0, 4); // dx===dy → 정확히 45°
  });

  it("길이 0(퇴화) 입력은 NaN 없이 그대로 반환한다", () => {
    const result = regularizeQuickShapePoints("line", [5, 5, 5, 5]);
    expect(result).toEqual([5, 5, 5, 5]);
  });
});

describe("anchorQuickShapePoints", () => {
  it("line: anchor 에서 더 먼 끝점은 고정, 더 가까운 끝점만 anchor 로 이동", () => {
    const points: [number, number, number, number] = [0, 0, 100, 0];
    const result = anchorQuickShapePoints("line", points, { x: 98, y: 1 });
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(98);
    expect(result[3]).toBe(1);
  });

  it("line: anchor 가 반대쪽 끝에 더 가까우면 그쪽이 이동한다", () => {
    const points: [number, number, number, number] = [0, 0, 100, 0];
    const result = anchorQuickShapePoints("line", points, { x: 2, y: -1 });
    expect(result[0]).toBe(2);
    expect(result[1]).toBe(-1);
    expect(result[2]).toBe(100);
    expect(result[3]).toBe(0);
  });

  it("rect: anchor 에서 가장 먼 모서리를 고정하고 anchor 를 반대 모서리로 쓴다", () => {
    const points: [number, number, number, number] = [0, 0, 100, 100];
    // anchor 가 (0,0) 근처에 멈췄다면 가장 먼 모서리 (100,100)이 고정돼야 한다.
    const result = anchorQuickShapePoints("rect", points, { x: 3, y: 2 });
    expect(result[0]).toBe(100);
    expect(result[1]).toBe(100);
    expect(result[2]).toBe(3);
    expect(result[3]).toBe(2);
  });

  it("rect: anchor 가 반대 모서리 근처면 그 반대쪽이 고정된다", () => {
    const points: [number, number, number, number] = [0, 0, 100, 100];
    const result = anchorQuickShapePoints("rect", points, { x: 99, y: 98 });
    expect(result[0]).toBe(0);
    expect(result[1]).toBe(0);
    expect(result[2]).toBe(99);
    expect(result[3]).toBe(98);
  });

  it.each(["ellipse", "triangle", "polygon"] as const)(
    "%s: 변/꼭짓점의 닫힘 포인터를 bbox 모서리로 오인해 한 축을 줄이지 않는다",
    (kind) => {
      const points: [number, number, number, number] = [10, 20, 310, 140];
      // 원/삼각형/다각형은 흔히 위쪽 중앙에서 시작해 같은 곳에서 닫힌다.
      expect(anchorQuickShapePoints(kind, points, { x: 160, y: 20 })).toEqual(points);
    }
  );

  it.each(["ellipse", "triangle", "polygon"] as const)(
    "%s: live hold 뒤 1px 이동해도 전체 bbox를 유지한 채 연속 리사이즈한다",
    (kind) => {
      const recognized: [number, number, number, number] = [10, 20, 310, 140];
      const pointer = { x: 160, y: 20 };
      const live = anchorQuickShapePointsForLiveDrag(kind, recognized, pointer);
      const moved: [number, number, number, number] = [
        live.points[0],
        live.points[1],
        pointer.x + 1 + live.pointerOffset.x,
        pointer.y + 1 + live.pointerOffset.y,
      ];
      const width = Math.abs(moved[2] - moved[0]);
      const height = Math.abs(moved[3] - moved[1]);

      expect(Math.abs(live.points[2] - live.points[0])).toBe(300);
      expect(Math.abs(live.points[3] - live.points[1])).toBe(120);
      expect(width).toBeGreaterThanOrEqual(299);
      expect(height).toBeGreaterThanOrEqual(119);
    }
  );
});

describe("2단계(정비율 고정) 통합 시나리오", () => {
  it("QUICKSHAPE_LOCK_HOLD_MS 이상 정지하면 regularize 를 적용해도 kind/anchor 계약이 유지된다", () => {
    const pts = rectStrokePoints(40, 40, 160, 100, 10, 1);
    const match = classifyQuickShape(pts, QUICKSHAPE_LOCK_HOLD_MS + 50);
    expect(match?.kind).toBe("rect");
    const anchored = anchorQuickShapePoints(match!.kind, match!.points, { x: match!.points[0], y: match!.points[1] });
    const locked = regularizeQuickShapePoints(match!.kind, anchored);
    expect(Math.abs(locked[2] - locked[0])).toBeCloseTo(Math.abs(locked[3] - locked[1]), 6);
  });
});

describe("promoteFreehandQuickShapeOnRelease", () => {
  it("스냅샷 없이(손을 바로 떼도) 네모 낙서를 rect 로 승격한다", () => {
    const pts = rectStrokePoints(20, 20, 180, 140, 12, 1);
    // classify with short hold would fail; release promotion bypasses wait
    expect(classifyQuickShape(pts, 50)).toBeNull();
    const promoted = promoteFreehandQuickShapeOnRelease(pts, { lockAspect: false });
    expect(promoted?.kind).toBe("rect");
    expect(promoted?.points).toHaveLength(4);
  });

  it("직선 낙서를 line 으로 승격한다", () => {
    const pts = nearLinePoints(0, 0, 120, 4, 16, 0.3);
    const promoted = promoteFreehandQuickShapeOnRelease(pts);
    expect(promoted?.kind).toBe("line");
  });

  it("잔차가 큰 거의-직선도 release 경로에서는 line 으로 승격한다", () => {
    // Live residual gate is 0.06; a wavier freehand may fail classifyQuickShape but should still
    // promote on release via the looser line pass.
    const pts = nearLinePoints(0, 0, 160, 14, 20, 1.8);
    const promoted = promoteFreehandQuickShapeOnRelease(pts, { lockAspect: false });
    expect(promoted?.kind).toBe("line");
  });

  it("닫히지 않은 원형 낙서도 release 경로에서 ellipse 로 승격한다", () => {
    // Incomplete circle (gap at end) — release closure is more tolerant than live.
    const pts: number[] = [];
    const n = 28;
    for (let i = 0; i < n; i += 1) {
      const t = (i / n) * Math.PI * 1.75; // not fully closed (~315°)
      pts.push(80 + Math.cos(t) * 50, 80 + Math.sin(t) * 48);
    }
    const promoted = promoteFreehandQuickShapeOnRelease(pts);
    expect(promoted?.kind).toBe("ellipse");
  });

  it("지터가 큰 원(가짜 코너 가능)도 release 에서 ellipse 로 승격한다", () => {
    const pts = ellipseStrokePoints(120, 120, 70, 68, 36, 2.4);
    const promoted = promoteFreehandQuickShapeOnRelease(pts);
    expect(promoted?.kind).toBe("ellipse");
  });

  it("변이 살짝 휜 손그림 삼각형도 release 에서 triangle 로 승격한다", () => {
    // 각 변 중앙을 바깥으로 불룩하게 — live 직선성 문턱(0.18)을 넘기기 쉬운 픽스처.
    const verts = [
      { x: 100, y: 20 },
      { x: 180, y: 160 },
      { x: 20, y: 160 },
      { x: 100, y: 20 },
    ];
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = verts[e]!;
      const b = verts[e + 1]!;
      for (let k = 0; k <= 14; k++) {
        const t = k / 14;
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const nl = Math.hypot(nx, ny) || 1;
        const bulge = Math.sin(t * Math.PI) * 6;
        const j = (detHash(e * 20 + k) - 0.5) * 1.2;
        pts.push(a.x + (b.x - a.x) * t + (nx / nl) * bulge + j, a.y + (b.y - a.y) * t + (ny / nl) * bulge + j);
      }
    }
    const promoted = promoteFreehandQuickShapeOnRelease(pts);
    expect(promoted?.kind).toBe("triangle");
  });

  it("끝이 덜 닫힌 원호(~270°)도 release 에서 ellipse 로 승격한다", () => {
    const pts: number[] = [];
    const n = 32;
    for (let i = 0; i < n; i++) {
      const t = -Math.PI / 2 + (i / (n - 1)) * Math.PI * 1.55; // ~279°
      const j = (detHash(i * 3) - 0.5) * 1.5;
      pts.push(100 + (55 + j) * Math.cos(t), 100 + (52 + j) * Math.sin(t));
    }
    const promoted = promoteFreehandQuickShapeOnRelease(pts);
    expect(promoted?.kind).toBe("ellipse");
  });

  it("한 꼭짓점만 3배 이상 돌출된 불규칙 5각 낙서는 release에서도 정오각형으로 승격하지 않는다", () => {
    const vertices: { x: number; y: number }[] = [];
    for (let index = 0; index <= 5; index += 1) {
      const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
      const radius = index === 1 ? 200 : 60;
      vertices.push({
        x: 100 + radius * Math.cos(angle),
        y: 100 + radius * Math.sin(angle),
      });
    }
    const points: number[] = [];
    for (let edge = 0; edge < 5; edge += 1) {
      const start = vertices[edge]!;
      const end = vertices[edge + 1]!;
      for (let sample = 0; sample < 10; sample += 1) {
        const amount = sample / 10;
        points.push(
          start.x + (end.x - start.x) * amount,
          start.y + (end.y - start.y) * amount
        );
      }
    }
    points.push(vertices[5]!.x, vertices[5]!.y);

    expect(promoteFreehandQuickShapeOnRelease(points)?.kind).not.toBe("polygon");
  });
});

describe("classifyQuickShape — 원/삼각형 실사용 폴백", () => {
  it("원에 가짜 코너가 잡혀도 radial CV 가 낮으면 ellipse 로 폴백한다", () => {
    // 지터를 키워 코너 검출기가 1~3개를 잡을 수 있게 하되, 전체 반경 분포는 원형.
    const pts = ellipseStrokePoints(100, 100, 64, 62, 40, 2.0);
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("ellipse");
  });

  it("살짝 불룩한 변의 삼각형은 live 에서도 triangle 로 인식된다", () => {
    const verts = [
      { x: 100, y: 15 },
      { x: 185, y: 165 },
      { x: 15, y: 165 },
      { x: 100, y: 15 },
    ];
    const pts: number[] = [];
    for (let e = 0; e < 3; e++) {
      const a = verts[e]!;
      const b = verts[e + 1]!;
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const nx = -(b.y - a.y);
        const ny = b.x - a.x;
        const nl = Math.hypot(nx, ny) || 1;
        const bulge = Math.sin(t * Math.PI) * 4;
        pts.push(a.x + (b.x - a.x) * t + (nx / nl) * bulge, a.y + (b.y - a.y) * t + (ny / nl) * bulge);
      }
    }
    const match = classifyQuickShape(pts, QUICKSHAPE_HOLD_MS);
    expect(match?.kind).toBe("triangle");
  });
});
