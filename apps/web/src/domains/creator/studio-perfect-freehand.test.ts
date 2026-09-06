import { strokeOutlinePath } from "@toonspectrum/studio-brush-platform";
import { brushProgramIRSchema, type StrokeIR } from "@toonspectrum/studio-project-model";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildStudioPerfectFreehandOutline,
  buildStudioPerfectFreehandPathData,
  loadStudioPerfectFreehandStroker,
  peekStudioPerfectFreehandStroker,
  resolveStudioPerfectFreehandProfile,
  STUDIO_PERFECT_FREEHAND_PROFILES,
  studioPerfectFreehandEffectiveSizeAt,
  studioPerfectFreehandEncodeDynamicsPressure,
  studioPerfectFreehandMaximumPaintRadius,
  studioPerfectFreehandOutlineToPathData,
  studioPerfectFreehandStrokeOptions,
  studioPerfectFreehandWorkUpperBound,
  type StudioPerfectFreehandProfile,
  type StudioPerfectFreehandSizeDynamicMapping,
  type StudioPerfectFreehandStroker,
} from "./studio-perfect-freehand";

describe("studioPerfectFreehandWorkUpperBound", () => {
  it("pins the perfect-freehand@1.2.3 sharp-turn, cap and Q-path expansion", () => {
    expect(studioPerfectFreehandWorkUpperBound(2)).toEqual({
      strokePointCount: 5,
      outlinePointCount: 182,
      outlineCoordinateScalars: 364,
      pathCoordinateScalars: 730,
      pathCommands: 184,
    });
    expect(studioPerfectFreehandWorkUpperBound(256)).toEqual({
      strokePointCount: 256,
      outlinePointCount: 7_210,
      outlineCoordinateScalars: 14_420,
      pathCoordinateScalars: 28_842,
      pathCommands: 7_212,
    });
    expect(studioPerfectFreehandWorkUpperBound(Number.NaN)).toBeNull();
  });

  it("bounds a real adversarial zigzag outline from the pinned stroker", () => {
    const pointCount = 256;
    const outline = buildStudioPerfectFreehandOutline(
      peekStudioPerfectFreehandStroker()!,
      {
        points: Array.from({ length: pointCount }, (_, index) => [
          index * 2,
          index % 2 === 0 ? 0 : 100,
        ]).flat(),
        pressures: Array.from({ length: pointCount }, () => 1),
        strokeWidth: 400,
        profile: STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"],
      },
    );
    const upper = studioPerfectFreehandWorkUpperBound(pointCount)!;

    expect(outline.length).toBeGreaterThan(pointCount);
    expect(outline.length).toBeLessThanOrEqual(upper.outlinePointCount);
    expect(studioPerfectFreehandOutlineToPathData(outline).match(/Q/g)?.length ?? 0)
      .toBe(outline.length);
  });

  it("adds compact-dot floors to the paint bound without changing planner size", () => {
    expect(studioPerfectFreehandMaximumPaintRadius(1)).toBe(3);
    expect(studioPerfectFreehandMaximumPaintRadius(12)).toBe(12);
    expect(studioPerfectFreehandMaximumPaintRadius(100_000)).toBe(400);
    expect(studioPerfectFreehandMaximumPaintRadius(Number.NaN)).toBe(6);
    expect(studioPerfectFreehandStrokeOptions(
      STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"],
      1,
      true,
    ).size).toBe(1);
  });
});

describe("loadStudioPerfectFreehandStroker / peekStudioPerfectFreehandStroker", () => {
  it("첫 동기 프레임부터 준비된 같은 스트로커를 반환한다", async () => {
    const peeked = peekStudioPerfectFreehandStroker();
    expect(typeof peeked).toBe("function");
    const stroker = await loadStudioPerfectFreehandStroker();
    expect(stroker).toBe(peeked);
    expect(peekStudioPerfectFreehandStroker()).toBe(stroker);
    await expect(loadStudioPerfectFreehandStroker()).resolves.toBe(stroker);
  });
});

describe("resolveStudioPerfectFreehandProfile", () => {
  it("퍼펙트 브러시와 네 가지 만화 펜을 연속 아웃라인 프로필로 해석한다", () => {
    expect(resolveStudioPerfectFreehandProfile("perfect-ink")).toBe(
      STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"]
    );
    expect(resolveStudioPerfectFreehandProfile("perfect-marker")).toBe(
      STUDIO_PERFECT_FREEHAND_PROFILES["perfect-marker"]
    );
    for (const brushId of ["gpen", "mapping-pen", "kaburapen", "liner"]) {
      expect(resolveStudioPerfectFreehandProfile(brushId)).toBe(
        STUDIO_PERFECT_FREEHAND_PROFILES.gpen
      );
    }
    expect(resolveStudioPerfectFreehandProfile("maru-pen")).toBe(
      STUDIO_PERFECT_FREEHAND_PROFILES["maru-pen"]
    );
    expect(STUDIO_PERFECT_FREEHAND_PROFILES["maru-pen"].thinning)
      .toBeGreaterThan(STUDIO_PERFECT_FREEHAND_PROFILES.gpen.thinning);
    expect(resolveStudioPerfectFreehandProfile("pen")).toBeNull();
    expect(resolveStudioPerfectFreehandProfile("calligraphy")).toBeNull();
    expect(resolveStudioPerfectFreehandProfile("")).toBeNull();
    expect(resolveStudioPerfectFreehandProfile(null)).toBeNull();
    expect(resolveStudioPerfectFreehandProfile(42)).toBeNull();
  });

  it("잉크는 테이퍼·강한 thinning, 마커는 캡 마감·약한 thinning으로 서로 다른 실행 프로필이다", () => {
    const ink = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"];
    const marker = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-marker"];
    expect(ink.taperStartFactor).toBeGreaterThan(0);
    expect(ink.taperEndFactor).toBeGreaterThan(0);
    expect(marker.taperStartFactor).toBe(0);
    expect(marker.taperEndFactor).toBe(0);
    expect(ink.thinning).toBeGreaterThan(marker.thinning);
  });

  it("G펜 프로필은 기존 0.22 + 1.55p 폭 곡선을 연속 outline thinning으로 보존한다", () => {
    const gpen = STUDIO_PERFECT_FREEHAND_PROFILES.gpen;
    const perfectFreehandDiameterFactor = (pressure: number) =>
      1 + 2 * gpen.thinning * (pressure - 0.5);
    for (const pressure of [0, 0.1, 0.5, 0.9, 1]) {
      expect(perfectFreehandDiameterFactor(pressure)).toBeCloseTo(
        0.225 + pressure * 1.55,
        10
      );
    }
    expect(gpen.smoothing).toBeGreaterThan(0.6);
    expect(gpen.streamline).toBeLessThan(0.3);
  });
});

describe("studioPerfectFreehandStrokeOptions", () => {
  it("굵기를 size로 클램프하고 필압 배열이 없을 때만 속도 시뮬레이션을 켠다", () => {
    const profile = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"];
    const withPressure = studioPerfectFreehandStrokeOptions(profile, 12, true);
    expect(withPressure.size).toBe(12);
    expect(withPressure.simulatePressure).toBe(false);
    expect(withPressure.last).toBe(true);
    expect(withPressure.start?.taper).toBe(12 * profile.taperStartFactor);
    expect(withPressure.end?.taper).toBe(12 * profile.taperEndFactor);

    const simulated = studioPerfectFreehandStrokeOptions(profile, Number.NaN, false);
    expect(simulated.size).toBe(6);
    expect(simulated.simulatePressure).toBe(true);
    expect(studioPerfectFreehandStrokeOptions(profile, 100_000, true).size).toBe(400);
  });

  it("짧거나 무효한 segmentLength에서는 양끝 테이퍼를 비활성화한다", () => {
    const profile = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"];
    expect(studioPerfectFreehandStrokeOptions(profile, 12, true, 3).start?.taper).toBe(0);
    expect(studioPerfectFreehandStrokeOptions(profile, 12, true, 12).end?.taper).toBe(0);
    expect(studioPerfectFreehandStrokeOptions(profile, 12, true, Number.NaN).start?.taper).toBe(0);
    expect(studioPerfectFreehandStrokeOptions(profile, 12, true, Number.POSITIVE_INFINITY).end?.taper).toBe(0);

    // 충분히 긴 획은 프로필 값을 그대로 받는다. 예산이 프로필 전량을 덮는 길이는
    // 1.4×size(짧은 획 경계) + (2.8 + 3.4)×size 다.
    const long = studioPerfectFreehandStrokeOptions(profile, 12, true, 12 * 7.6);
    expect(long.start?.taper).toBe(12 * profile.taperStartFactor);
    expect(long.end?.taper).toBe(12 * profile.taperEndFactor);
  });

  it("짧은 획 경계를 끊지 않고 연속으로 넘어간다", () => {
    // 예전에는 boolean 이었다: 길이 1.39×size 는 테이퍼 0, 1.41×size 는 프로필 전량
    // (12px 브러시에서 시작 33.60 / 끝 40.80)이라 거의 같은 길이의 두 획이 뭉툭한 막대와
    // 바늘로 갈렸다. 짧은 해칭을 반복하는 선화에서 그대로 드러난다.
    const profile = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"];
    const size = 12;
    const taperAt = (multiple: number): number => {
      const t = studioPerfectFreehandStrokeOptions(profile, size, true, size * multiple).start?.taper;
      return typeof t === "number" ? t : -1;
    };

    // 경계 양쪽이 이어져 있다 — 한 걸음의 변화가 프로필 전량 근처일 수 없다.
    expect(taperAt(1.39)).toBe(0);
    expect(taperAt(1.41)).toBeGreaterThan(0);
    expect(taperAt(1.41)).toBeLessThan(size * profile.taperStartFactor * 0.05);

    // 그리고 길이에 대해 단조 증가한 뒤 프로필 값에서 멈춘다.
    const samples = [1.4, 1.6, 2, 3, 5, 7.6, 12, 40].map(taperAt);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThanOrEqual(samples[index - 1]!);
    }
    expect(Math.max(...samples)).toBe(size * profile.taperStartFactor);
  });
});

describe("studioPerfectFreehandOutlineToPathData", () => {
  it("아웃라인 폴리곤을 M/Q 중점 곡선 체인 + Z로 직렬화한다", () => {
    const d = studioPerfectFreehandOutlineToPathData([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(d.startsWith("M0 0")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toContain("Q10 0 10 5");
    // 마지막 세그먼트는 첫 정점으로 되감아 폴리곤을 닫는다.
    expect(d).toContain("Q0 10 0 5");
  });

  it("정점 3개 미만·비유한 좌표는 빈 문자열(렌더러 폴백)", () => {
    expect(studioPerfectFreehandOutlineToPathData([])).toBe("");
    expect(studioPerfectFreehandOutlineToPathData([[0, 0], [1, 1]])).toBe("");
    expect(
      studioPerfectFreehandOutlineToPathData([[0, 0], [Number.NaN, 1], [2, 2]])
    ).toBe("");
    expect(
      studioPerfectFreehandOutlineToPathData([[0, 0], [Infinity, 1], [2, 2]])
    ).toBe("");
    expect(studioPerfectFreehandOutlineToPathData([[0, 0], [1], [2, 2]])).toBe("");
  });

  it("좌표를 소수 둘째 자리로 반올림해 결정적으로 직렬화한다", () => {
    const d = studioPerfectFreehandOutlineToPathData([
      [0.005, 1.114],
      [2.006, 3.339],
      [4.001, 5.008],
    ]);
    expect(d).toContain("M0.01 1.11");
    expect(d).not.toMatch(/\d\.\d{3,}/);
  });
});

describe("buildStudioPerfectFreehandOutline / PathData (실제 getStroke 주입)", () => {
  const inkProfile = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"];
  const markerProfile = STUDIO_PERFECT_FREEHAND_PROFILES["perfect-marker"];
  const gpenProfile = STUDIO_PERFECT_FREEHAND_PROFILES.gpen;
  // 수평 직선 — 아웃라인 굵기(y 범위) 측정이 쉬운 기준 지오메트리.
  const linePoints = Array.from({ length: 21 }, (_, i) => [i * 5, 50]).flat();
  let stroker: StudioPerfectFreehandStroker;

  beforeAll(async () => {
    stroker = await loadStudioPerfectFreehandStroker();
  });

  function outlineHalfWidthInWindow(
    outline: number[][],
    minX: number,
    maxX: number
  ): number {
    let widest = 0;
    for (const [x, y] of outline) {
      if (x! >= minX && x! <= maxX) widest = Math.max(widest, Math.abs(y! - 50));
    }
    return widest;
  }

  it("같은 입력은 항상 같은 패스 문자열을 만든다(협업 복제본·재렌더 결정성)", () => {
    const input = {
      points: linePoints,
      pressures: [0.2, 0.5, 0.9, 0.4, 0.7],
      strokeWidth: 12,
      profile: inkProfile,
    };
    const first = buildStudioPerfectFreehandPathData(stroker, input);
    const second = buildStudioPerfectFreehandPathData(stroker, input);
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
    // 필압 배열이 없어도(속도 시뮬레이션) 여전히 결정적이다.
    const simulated = { ...input, pressures: null };
    expect(buildStudioPerfectFreehandPathData(stroker, simulated)).toBe(
      buildStudioPerfectFreehandPathData(stroker, simulated)
    );
  });

  it("두 브러시 프로필은 같은 획에서 서로 다른 패스를 만든다(중복 렌더러 감사 지원)", () => {
    const base = { points: linePoints, pressures: [0.6], strokeWidth: 12 };
    expect(
      buildStudioPerfectFreehandPathData(stroker, { ...base, profile: inkProfile })
    ).not.toBe(
      buildStudioPerfectFreehandPathData(stroker, { ...base, profile: markerProfile })
    );
  });

  it("필압이 높을수록 아웃라인이 굵어진다(thinning 단조성)", () => {
    const light = buildStudioPerfectFreehandOutline(stroker, {
      points: linePoints,
      pressures: Array(21).fill(0.2),
      strokeWidth: 12,
      profile: inkProfile,
    });
    const heavy = buildStudioPerfectFreehandOutline(stroker, {
      points: linePoints,
      pressures: Array(21).fill(0.9),
      strokeWidth: 12,
      profile: inkProfile,
    });
    const lightWidth = outlineHalfWidthInWindow(light, 40, 60);
    const heavyWidth = outlineHalfWidthInWindow(heavy, 40, 60);
    expect(lightWidth).toBeGreaterThan(0);
    expect(heavyWidth).toBeGreaterThan(lightWidth);
  });

  it("잉크 프로필은 양끝 테이퍼로 끝이 중앙보다 가늘다(마커 프로필은 균일에 가깝다)", () => {
    const constantPressure = Array(21).fill(0.7);
    const ink = buildStudioPerfectFreehandOutline(stroker, {
      points: linePoints,
      pressures: constantPressure,
      strokeWidth: 12,
      profile: inkProfile,
    });
    const inkStart = outlineHalfWidthInWindow(ink, 0, 10);
    const inkMiddle = outlineHalfWidthInWindow(ink, 45, 55);
    expect(inkMiddle).toBeGreaterThan(0);
    expect(inkStart).toBeLessThan(inkMiddle * 0.8);

    const marker = buildStudioPerfectFreehandOutline(stroker, {
      points: linePoints,
      pressures: constantPressure,
      strokeWidth: 12,
      profile: markerProfile,
    });
    const markerStart = outlineHalfWidthInWindow(marker, 0, 10);
    const markerMiddle = outlineHalfWidthInWindow(marker, 45, 55);
    expect(markerStart).toBeGreaterThan(markerMiddle * 0.6);
  });

  it("생성된 패스는 유효한 M/Q…Z 명령과 유한 좌표만 담는다", () => {
    const d = buildStudioPerfectFreehandPathData(stroker, {
      points: linePoints,
      pressures: [0.4, 0.8],
      strokeWidth: 9,
      profile: inkProfile,
    });
    expect(d).toMatch(/^M-?\d/);
    expect(d).toContain("Q");
    expect(d.endsWith("Z")).toBe(true);
    expect(d).toMatch(/^[MQZ0-9 .-]+$/);
    for (const token of d.match(/-?\d+(?:\.\d+)?/g) ?? []) {
      expect(Number.isFinite(Number(token))).toBe(true);
    }
  });

  it("G펜 급커브도 독립 캡슐 묶음이 아닌 하나의 닫힌 이차곡선 윤곽으로 만든다", () => {
    const arcPoints = Array.from({ length: 25 }, (_, index) => {
      const angle = Math.PI * 0.12 + (Math.PI * 1.35 * index) / 24;
      return [90 + Math.cos(angle) * 58, 90 + Math.sin(angle) * 58];
    }).flat();
    const path = buildStudioPerfectFreehandPathData(stroker, {
      points: arcPoints,
      pressures: Array(25).fill(0.68),
      strokeWidth: 11,
      profile: gpenProfile,
    });

    expect(path.match(/M/g)).toHaveLength(1);
    expect(path.match(/Q/g)?.length).toBeGreaterThan(12);
    expect(path.match(/Z/g)).toHaveLength(1);
    expect(path).not.toContain(" L");
  });

  it("유효한 점이 2개 미만이거나 비유한 좌표뿐이면 빈 결과로 폴백을 알린다", () => {
    const base = { pressures: null, strokeWidth: 9, profile: inkProfile };
    expect(buildStudioPerfectFreehandOutline(stroker, { ...base, points: [] })).toEqual([]);
    expect(
      buildStudioPerfectFreehandOutline(stroker, { ...base, points: [5, 5] })
    ).toEqual([]);
    expect(
      buildStudioPerfectFreehandOutline(stroker, {
        ...base,
        points: [Number.NaN, Number.NaN, 0, 0],
      })
    ).toEqual([]);
    expect(
      buildStudioPerfectFreehandPathData(stroker, { ...base, points: [5, 5] })
    ).toBe("");
  });

  it("필압 배열 길이가 달라도 점 개수에 맞춰 재표본한다", () => {
    const twoSamples = buildStudioPerfectFreehandPathData(stroker, {
      points: linePoints,
      pressures: [0.2, 0.9],
      strokeWidth: 12,
      profile: inkProfile,
    });
    expect(twoSamples.length).toBeGreaterThan(0);
    const nanSamples = buildStudioPerfectFreehandPathData(stroker, {
      points: linePoints,
      pressures: [Number.NaN, Number.NaN],
      strokeWidth: 12,
      profile: inkProfile,
    });
    expect(nanSamples.length).toBeGreaterThan(0);
  });

  it("짧은 두 점 획에서도 테이퍼 비활성 상태로 안정적인 바운딩 박스를 만든다", () => {
    const shortStroke = buildStudioPerfectFreehandOutline(stroker, {
      points: [20, 20, 27, 27],
      pressures: [0.5, 0.5],
      strokeWidth: 9,
      profile: STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"],
    });
    const xs = shortStroke.flatMap((point) => point[0] ?? []);
    const ys = shortStroke.flatMap((point) => point[1] ?? []);
    expect(shortStroke.length).toBeGreaterThan(0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1);
    const shortPath = buildStudioPerfectFreehandPathData(stroker, {
      points: [20, 20, 27, 27],
      pressures: [0.5, 0.5],
      strokeWidth: 9,
      profile: STUDIO_PERFECT_FREEHAND_PROFILES["perfect-ink"],
    });
    expect(shortPath).toContain("Q");
    expect(shortPath).toContain("Z");
  });

  it("끝점이 시작점 근처로 돌아오는 긴 G펜도 누적 경로 길이로 테이퍼를 유지한다", () => {
    let receivedStartTaper: boolean | number | undefined;
    let receivedEndTaper: boolean | number | undefined;
    const captureOptions: StudioPerfectFreehandStroker = (_points, options) => {
      receivedStartTaper = options?.start?.taper;
      receivedEndTaper = options?.end?.taper;
      return [[0, 0], [2, 0], [1, 2]];
    };

    buildStudioPerfectFreehandOutline(captureOptions, {
      // 시작↔끝 chord는 1.4px뿐이지만 실제 C/loop 경로는 120px를 넘는다.
      points: [0, 0, 40, 0, 40, 40, 0, 40, 1, 1],
      pressures: Array(5).fill(0.6),
      strokeWidth: 12,
      profile: gpenProfile,
    });

    expect(receivedStartTaper).toBe(12 * gpenProfile.taperStartFactor);
    expect(receivedEndTaper).toBe(12 * gpenProfile.taperEndFactor);
  });
});

/**
 * 카탈로그가 "perfect-outline" 엔진이라고 선언한 레인은 실제로 그 엔진으로 그려져야 한다.
 *
 * 이 게이트가 없던 동안 pen--perfect-taper 와 calligraphy--perfect-chisel 이 조용히 빠져 있었다.
 * resolveStudioPerfectFreehandProfile 이 null 을 돌려주면 렌더러는 가변 폭 아웃라인 분기를 아예
 * 타지 않고 균일 굵기 폴리라인으로 떨어지는데, 선언과 다르다는 신호가 어디에도 없어서 두
 * 브러시는 테이퍼 없는 뭉툭한 시작·끝으로 출하돼 있었다. 브러시 id 를 여기 하드코딩하는 대신
 * 카탈로그를 원본으로 삼아, 앞으로 추가되는 레인도 같은 방식으로 빠지지 않게 한다.
 */
/**
 * D-08 — 패키지 레인(D-03)의 크기 다이내믹스 프리매핑을 라이브 레인에 포팅했다.
 *
 * 라이브 어댑터는 핫 청크(StudioDrawNode)라 studio-project-model 값 배럴(zod)을 끌어올 수
 * 없어 프리매핑 수식을 로컬 미러로 갖는다. 대신 이 크로스 레인 패리티 스위트가 같은 입력에
 * 대해 두 레인이 정점 단위로 같은 폭 아웃라인을 만든다는 것을 상호 고정한다 — 어느 쪽이든
 * 수식이 표류하면 여기서 깨진다.
 */
describe("D-08 크기 다이내믹스 프리매핑 — 패키지 레인 패리티", () => {
  /** gpen 지오메트리 수치 — 테이퍼만 0(패키지 레인은 테이퍼 옵션이 없다). */
  const PARITY_GEOMETRY = {
    thinning: 0.775,
    smoothing: 0.68,
    streamline: 0.06,
    capStart: true,
    capEnd: true,
  } as const;
  const PARITY_SIZE = 12;

  interface ParitySample {
    readonly x: number;
    readonly y: number;
    readonly pressure: number;
    readonly velocity: number;
    readonly altitudeDeg: number;
    readonly azimuthDeg: number;
  }

  // 전반부 정지 → 후반부 고속, 짝수 인덱스만 수직 틸트 — 세 입력 채널을 모두 자극한다.
  const paritySamples: readonly ParitySample[] = Array.from(
    { length: 21 },
    (_, index) => ({
      x: index * 10,
      y: 50,
      pressure: 0.35 + 0.03 * (index % 5),
      velocity: index <= 10 ? 0 : 4,
      altitudeDeg: index % 2 === 0 ? 90 : 45,
      azimuthDeg: (index * 30) % 360,
    })
  );

  const parityDynamics: readonly StudioPerfectFreehandSizeDynamicMapping[] = [
    { input: "velocity", curve: [0, 1], min: 1, max: 1.6 },
    { input: "tiltAltitude", curve: [1, 0.55], min: 0.4, max: 1 },
    { input: "pressure", curve: [0, 1], min: 0.9, max: 1.1 },
  ];

  function liveProfile(
    sizeDynamics?: readonly StudioPerfectFreehandSizeDynamicMapping[]
  ): StudioPerfectFreehandProfile {
    return {
      id: "gpen",
      ...PARITY_GEOMETRY,
      taperStartFactor: 0,
      taperEndFactor: 0,
      ...(sizeDynamics ? { sizeDynamics } : {}),
    };
  }

  function packageOutlineVertices(
    sizeDynamics: readonly StudioPerfectFreehandSizeDynamicMapping[]
  ): number[][] {
    const program = brushProgramIRSchema.parse({
      id: "parity-pen",
      name: "Parity Pen",
      stabilizer: { kind: "none", strength: 0, predictionMs: 0 },
      sizeDynamics,
      geometry: { kind: "perfect-freehand", ...PARITY_GEOMETRY },
    });
    const stroke: StrokeIR = {
      id: "parity-stroke",
      brushPresetId: "parity-pen",
      seed: 0,
      color: { r: 0, g: 0, b: 0, a: 1 },
      baseSizePx: PARITY_SIZE,
      samples: paritySamples.map((sample, index) => ({
        x: sample.x,
        y: sample.y,
        tMs: index * 8,
        pressure: sample.pressure,
        velocity: sample.velocity,
        altitudeDeg: sample.altitudeDeg,
        azimuthDeg: sample.azimuthDeg,
      })),
    };
    const vertices: number[][] = [];
    for (const verb of strokeOutlinePath(program, stroke).verbs) {
      if (verb.v !== "Z") vertices.push([verb.x, verb.y]);
    }
    return vertices;
  }

  let stroker: StudioPerfectFreehandStroker;

  beforeAll(async () => {
    stroker = await loadStudioPerfectFreehandStroker();
  });

  function liveOutlineVertices(
    sizeDynamics?: readonly StudioPerfectFreehandSizeDynamicMapping[]
  ): number[][] {
    return buildStudioPerfectFreehandOutline(stroker, {
      points: paritySamples.flatMap((sample) => [sample.x, sample.y]),
      pressures: paritySamples.map((sample) => sample.pressure),
      strokeWidth: PARITY_SIZE,
      profile: liveProfile(sizeDynamics),
      dynamics: paritySamples.map((sample) => ({
        velocity: sample.velocity,
        altitudeDeg: sample.altitudeDeg,
        azimuthDeg: sample.azimuthDeg,
      })),
    });
  }

  function expectSameVertices(actual: number[][], expected: number[][]): void {
    expect(actual.length).toBeGreaterThan(12);
    expect(actual.length).toBe(expected.length);
    actual.forEach((point, index) => {
      expect(point[0]).toBeCloseTo(expected[index]![0]!, 10);
      expect(point[1]).toBeCloseTo(expected[index]![1]!, 10);
    });
  }

  it("다이내믹스가 없어도 두 레인 픽스처는 정점 단위로 일치한다(하니스 자체 검증)", () => {
    expectSameVertices(liveOutlineVertices(undefined), packageOutlineVertices([]));
  });

  it("velocity·tilt·pressure 다이내믹스에서 패키지 레인과 정점 단위로 같은 폭을 만든다", () => {
    expectSameVertices(
      liveOutlineVertices(parityDynamics),
      packageOutlineVertices(parityDynamics)
    );
  });

  it("sizeDynamics 미선언 프로필은 dynamics 입력이 있어도 stroker 입력이 바이트 동일하다", () => {
    const calls: {
      points: number[][];
      options: Parameters<StudioPerfectFreehandStroker>[1];
    }[] = [];
    const spy: StudioPerfectFreehandStroker = (points, options) => {
      calls.push({ points: points as number[][], options });
      return [[0, 0], [2, 0], [1, 2]];
    };
    const base = {
      points: [0, 0, 10, 0, 20, 0],
      pressures: [0.2, 0.5, 0.9],
      strokeWidth: 12,
      profile: STUDIO_PERFECT_FREEHAND_PROFILES.gpen,
    };
    buildStudioPerfectFreehandOutline(spy, base);
    buildStudioPerfectFreehandOutline(spy, {
      ...base,
      dynamics: [{ velocity: 4 }, { velocity: 4 }, { velocity: 4 }],
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.points).toEqual(calls[0]!.points);
    expect(calls[1]!.options).toEqual(calls[0]!.options);
    expect(calls[0]!.options?.thinning).toBe(STUDIO_PERFECT_FREEHAND_PROFILES.gpen.thinning);
    expect(calls[0]!.points.map((point) => point[2])).toEqual([0.2, 0.5, 0.9]);
  });

  it("다이내믹스 분기는 thinning 1 고정·시뮬레이션 해제·반지름 인코딩을 수행한다", () => {
    const calls: {
      points: number[][];
      options: Parameters<StudioPerfectFreehandStroker>[1];
    }[] = [];
    const spy: StudioPerfectFreehandStroker = (points, options) => {
      calls.push({ points: points as number[][], options });
      return [[0, 0], [2, 0], [1, 2]];
    };
    buildStudioPerfectFreehandOutline(spy, {
      points: [0, 0, 10, 0, 20, 0],
      pressures: [0.7, 0.7, 0.7],
      strokeWidth: 12,
      profile: liveProfile([{ input: "velocity", curve: [0, 1], min: 1, max: 1.6 }]),
      dynamics: [{ velocity: 0 }, { velocity: 4 }, { velocity: 4 }],
    });
    const call = calls[0]!;
    expect(call.options?.thinning).toBe(1);
    expect(call.options?.simulatePressure).toBe(false);
    const encode = (effectiveSize: number) =>
      studioPerfectFreehandEncodeDynamicsPressure(effectiveSize, 0.775, 0.7, 12);
    // 정지 샘플: 유효 크기 12 → 지오메트리 thinning 이 만들었을 반지름 비율 그대로.
    expect(call.points[0]![2]).toBeCloseTo(encode(12), 12);
    // 고속 샘플: 유효 크기 19.2 → 목표 반지름이 base 를 넘어 1로 클램프(패키지와 동일).
    expect(call.points[1]![2]).toBeCloseTo(encode(12 * 1.6), 12);
    expect(call.points[1]![2]).toBe(1);
  });

  it("정지 구간은 다이내믹스 off 와 같은 폭, 고속 구간은 눈에 띄게 넓다", () => {
    const linePoints = Array.from({ length: 21 }, (_, index) => [index * 10, 50]).flat();
    const pressures = Array(21).fill(0.7) as number[];
    const dynamics = Array.from({ length: 21 }, (_, index) => ({
      velocity: index <= 10 ? 0 : 4,
    }));
    const mapping: readonly StudioPerfectFreehandSizeDynamicMapping[] = [
      { input: "velocity", curve: [0, 1], min: 1, max: 1.6 },
    ];
    const off = buildStudioPerfectFreehandOutline(stroker, {
      points: linePoints,
      pressures,
      strokeWidth: 12,
      profile: liveProfile(),
    });
    const on = buildStudioPerfectFreehandOutline(stroker, {
      points: linePoints,
      pressures,
      strokeWidth: 12,
      profile: liveProfile(mapping),
      dynamics,
    });
    const halfWidthNear = (outline: number[][], minX: number, maxX: number): number => {
      let widest = 0;
      for (const [x, y] of outline) {
        if (x! >= minX && x! <= maxX) widest = Math.max(widest, Math.abs(y! - 50));
      }
      return widest;
    };
    // 정지 구간(×1): 인코딩이 지오메트리 thinning 의 반지름을 그대로 재현해 off 와 같다.
    expect(halfWidthNear(on, 40, 60)).toBeCloseTo(halfWidthNear(off, 40, 60), 6);
    // 고속 구간(×1.6): 같은 필압에서 폭이 커진다 — 사용자가 보는 개선 그 자체.
    expect(halfWidthNear(on, 140, 160)).toBeGreaterThan(halfWidthNear(off, 140, 160) + 1.5);
  });

  it("다이내믹스 경로도 같은 입력이면 같은 패스 문자열을 만든다(결정성·무시드)", () => {
    const input = {
      points: paritySamples.flatMap((sample) => [sample.x, sample.y]),
      pressures: paritySamples.map((sample) => sample.pressure),
      strokeWidth: PARITY_SIZE,
      profile: liveProfile(parityDynamics),
      dynamics: paritySamples.map((sample) => ({ velocity: sample.velocity })),
    };
    const first = buildStudioPerfectFreehandPathData(stroker, input);
    expect(first.length).toBeGreaterThan(0);
    expect(buildStudioPerfectFreehandPathData(stroker, input)).toBe(first);
  });

  it("유효 크기는 0.1px 바닥·곡선 보간·스키마 기본값까지 패키지 의미론을 따른다", () => {
    const zeroMap: StudioPerfectFreehandSizeDynamicMapping = {
      input: "constant",
      curve: [0, 1],
      min: 0,
      max: 0,
    };
    expect(studioPerfectFreehandEffectiveSizeAt([zeroMap], 12, 0.5)).toBe(0.1);
    const velocityMap: StudioPerfectFreehandSizeDynamicMapping = {
      input: "velocity",
      curve: [0, 1],
      min: 1,
      max: 2,
    };
    // velocity 2 → min(1, 2/4) = 0.5 → 곡선 0.5 → ×1.5
    expect(
      studioPerfectFreehandEffectiveSizeAt([velocityMap], 10, 0.5, { velocity: 2 })
    ).toBeCloseTo(15, 12);
    // 결측 샘플은 패키지 스키마 기본값: velocity 0 → ×1
    expect(studioPerfectFreehandEffectiveSizeAt([velocityMap], 10, 0.5)).toBeCloseTo(10, 12);
    const tiltMap: StudioPerfectFreehandSizeDynamicMapping = {
      input: "tiltAltitude",
      curve: [1, 0.5],
      min: 0,
      max: 1,
    };
    // 결측 altitude → 90(수직) → 곡선 탭 1 → ×0.5
    expect(studioPerfectFreehandEffectiveSizeAt([tiltMap], 10, 0.5)).toBeCloseTo(5, 12);
  });

  it("인코딩 필압은 radius/baseSize 를 [0,1] 로 클램프한다", () => {
    expect(studioPerfectFreehandEncodeDynamicsPressure(12, 0.775, 0.7, 12)).toBeCloseTo(
      0.655,
      12
    );
    expect(studioPerfectFreehandEncodeDynamicsPressure(40, 0.775, 1, 12)).toBe(1);
    expect(studioPerfectFreehandEncodeDynamicsPressure(0.1, 1, 0, 12)).toBe(0);
  });

  it("카탈로그 프로필은 아직 sizeDynamics 를 선언하지 않는다(계약 스냅샷 v-next 게이트)", () => {
    // StudioOutlineStrokeProfileSnapshotV1 이 sizeDynamics 를 운반하기 전에는 카탈로그
    // 선언이 라이브 프리뷰와 커밋/SVG 리플레이를 어긋나게 한다 — 그때까지 이 게이트가
    // 실수 선언을 막는다. 스냅샷 v-next 가 들어오면 이 테스트를 함께 갱신한다.
    for (const profile of Object.values(STUDIO_PERFECT_FREEHAND_PROFILES)) {
      expect(profile.sizeDynamics).toBeUndefined();
    }
  });
});

describe("perfect-outline 레인 계약", () => {
  it("perfect-outline 로 선언된 모든 레인이 canonical 프로필을 실제로 해석한다", async () => {
    const { STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS } = await import("./brush/studio-brush-engine-lane-catalog"
    );
    const { STUDIO_BRUSH_RUNTIME_CONTRACT } = await import("./brush/studio-brush-runtime-contract"
    );
    const rows = [
      ...STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS,
      ...STUDIO_BRUSH_RUNTIME_CONTRACT,
    ].filter((row) => row.engine === "perfect-outline");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const resolved = resolveStudioPerfectFreehandProfile(row.id);
      expect(resolved, `${row.id} 가 perfect-freehand 프로필을 해석하지 못한다`).not.toBeNull();
      // Profile-variants share the canonical geometry, except maru-pen: remaining listed
      // hairline nib gets its own captured outline profile (persisted snapshots keep the
      // G-pen numbers they already stored).
      const expectedId = row.id === "maru-pen"
        ? "maru-pen"
        : resolveStudioPerfectFreehandProfile(row.canonicalId)?.id;
      expect(resolved!.id, `${row.id} 의 프로필이 canonicalId 와 어긋난다`)
        .toBe(expectedId);
    }
  });
});
