/**
 * 발광 리본 증분 빌더 게이트.
 *
 * `createStudioIncrementalFxLuminousRibbonBuilder` 는 자라나는 획에서 이미 소비한 섹션·런·폴리곤을
 * 붙들고 꼬리만 다시 만든다. 그 재사용이 **정확히** 배치 플래너와 같은 플랜을 내놓지 않으면 유지
 * 경로가 커밋/SVG와 다른 픽셀을 찍는다 — 그래서 이 파일의 1급 단언은 "비슷하다"가 아니라 자라나는
 * 모든 prefix에서 플랜 전체 `toEqual` 이다(`quantizeFxLuminous` 가 -0 까지 정규화하므로 수치는
 * 정확히 같아야 한다). 폴리곤 digest 를 먼저 비교하는 건 실패했을 때 읽히는 진단을 남기려는 것.
 *
 * 유지 Path2D 쪽은 커맨드 스트림 동일성과 "패스당 프레임당 fill 정확히 한 번"으로 잡는다. 후자가
 * 단일 fill 커버리지 계약 그 자체다 — 안정 prefix 와 꼬리를 따로 채우면 겹침이 두 번 합성돼
 * (a + a(1-a)) 이음매가 생긴다.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createStudioFxLuminousRetainedPass,
  fillStudioFxLuminousRibbonPass,
  type StudioFxLuminousRibbonFillContext,
} from "./brush/studio-fx-luminous-retained-path";
import {
  createStudioIncrementalFxLuminousRibbonBuilder,
  createStudioIncrementalFxPressurePathBuilder,
  planGlowBrushPasses,
  planNeonBrushPasses,
  planStudioFxBrushPressurePath,
  planStudioFxLuminousRibbonPass,
  traceStudioFxLuminousRibbonPass,
  type StudioFxLuminousBrushId,
  type StudioFxLuminousRibbonPassPlan,
  type StudioFxLuminousRibbonPolygon,
} from "./studio-fx-brush";
import { STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1 } from "./studio-material-pressure-model";

/** 결함 재현에 쓰인 그 획 — 반지름 150 원. */
const SAMPLE_COUNT = 360;
const BASE_WIDTH = 24;
const TENSION = 0.3;
/**
 * 자라나는 prefix 를 몇 샘플마다 배치와 대조할지.
 *
 * 빌더 자체는 **매 샘플** append 되고(실제 포인터 이동과 같은 소비 순서), 안정 prefix 객체
 * 동일성도 매 샘플 검사한다 — 이 간격이 줄이는 건 배치 재계획과 플랜 전체 비교뿐이다. 배치가
 * O(k) 라 전부 대조하면 O(n²) 가 되어 이 파일이 30 초 타임아웃에 붙는다(간격 3 에서 워스트 25.2 초
 * 측정). 6 은 압력 빌더의 휘발 꼬리(세그먼트 3)보다 크므로 재사용 경계는 매 대조마다 지나간다.
 */
const COMPARE_STEP = 6;
/** 유지 경로 커맨드 스트림 대조용 획 길이 — 세 셸을 동시에 몰기 때문에 더 짧게 잡는다. */
const TRACE_SAMPLES = 180;

interface LuminousShell {
  readonly passWidthScale: number;
  readonly passOpacity: number;
  readonly luminousCore: boolean;
}

function circleStroke(sampleCount: number): {
  points: number[];
  pressures: number[];
} {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const angle = index / sampleCount * Math.PI * 2;
    points.push(400 + Math.cos(angle) * 150, 400 + Math.sin(angle) * 150);
    // 폭·농도 보간과 셸별 subdivision 분기를 전부 지나도록 필압을 흔든다.
    pressures.push(0.35 + 0.45 * (1 + Math.sin(angle * 3)) / 2);
  }
  return { points, pressures };
}

function shellsUnderTest(brush: StudioFxLuminousBrushId): LuminousShell[] {
  const passes = brush === "neon"
    ? planNeonBrushPasses(BASE_WIDTH).map((pass, index, all) => ({
        widthScale: pass.widthScale,
        opacity: pass.opacity,
        luminousCore: pass.tone === "white-core" && index === all.length - 1,
      }))
    : planGlowBrushPasses(BASE_WIDTH, brush === "soft-glow").map(
        (pass, index, all) => ({
          widthScale: pass.widthScale,
          opacity: pass.opacity,
          luminousCore: index === all.length - 1,
        }),
      );
  // 가장 넓은 셸 / 가운데 / 가장 좁은 코어 — passWidth 가 다르면 subdivision 수도 달라진다.
  return [0, Math.floor((passes.length - 1) / 2), passes.length - 1].map(
    (index) => ({
      passWidthScale: passes[index]!.widthScale,
      passOpacity: passes[index]!.opacity,
      luminousCore: passes[index]!.luminousCore,
    }),
  );
}

const SHELL_POSITIONS = ["widest", "middle", "narrowest"] as const;

const GROWTH_CASES = (["neon", "glow", "soft-glow"] as const).flatMap((brush) =>
  shellsUnderTest(brush).map((shell, position) => [
    `${brush} ${SHELL_POSITIONS[position]!} shell`,
    brush,
    shell,
  ] as const),
);

function polygonDigest(plan: StudioFxLuminousRibbonPassPlan): string {
  return plan.polygons
    .map((polygon) => `${polygon.role}:${polygon.points.join(",")}`)
    .join("|");
}

function traceCommands(plan: StudioFxLuminousRibbonPassPlan): string[] {
  const commands: string[] = [];
  traceStudioFxLuminousRibbonPass(
    {
      moveTo: (x, y) => commands.push(`M${x},${y}`),
      lineTo: (x, y) => commands.push(`L${x},${y}`),
      closePath: () => commands.push("Z"),
    },
    plan,
  );
  return commands;
}

function pressurePathInput(
  brush: StudioFxLuminousBrushId,
  points: readonly number[],
  pressures: readonly number[],
  sampleCount: number,
) {
  return {
    brushId: brush,
    points: points.slice(0, sampleCount * 2),
    pressures: pressures.slice(0, sampleCount),
    pressureModel: STUDIO_MATERIAL_PRESSURE_MODEL_CANONICAL_V1,
    tension: TENSION,
  } as const;
}

function batchPlan(
  brush: StudioFxLuminousBrushId,
  shell: LuminousShell,
  fxInput: ReturnType<typeof pressurePathInput>,
): StudioFxLuminousRibbonPassPlan {
  return planStudioFxLuminousRibbonPass({
    brushId: brush,
    pressurePath: planStudioFxBrushPressurePath(fxInput),
    baseWidth: BASE_WIDTH,
    ...shell,
  });
}

describe("createStudioIncrementalFxLuminousRibbonBuilder", () => {
  it.each(GROWTH_CASES)(
    "matches the batch plan across point-by-point growth (%s)",
    (_label, brush, shell) => {
      const { points, pressures } = circleStroke(SAMPLE_COUNT);
      const producer = createStudioIncrementalFxPressurePathBuilder();
      const ribbon = createStudioIncrementalFxLuminousRibbonBuilder();
      let stablePrefix: readonly StudioFxLuminousRibbonPolygon[] = [];
      for (
        let sampleCount = 1;
        sampleCount <= SAMPLE_COUNT;
        sampleCount += 1
      ) {
        const fxInput = pressurePathInput(brush, points, pressures, sampleCount);
        const incremental = ribbon.append({
          brushId: brush,
          pressurePath: producer.append(fxInput),
          producer,
          baseWidth: BASE_WIDTH,
          ...shell,
        });
        // 유지 Path2D 가 기대는 계약: 안정 prefix 는 값이 아니라 **객체**가 그대로여야 한다.
        for (let index = 0; index < stablePrefix.length; index += 1) {
          expect(
            incremental.polygons[index],
            `n=${sampleCount} stable polygon ${index} was rewritten`,
          ).toBe(stablePrefix[index]);
        }
        const stableCount = ribbon.stablePolygonCount();
        expect(stableCount).toBeGreaterThanOrEqual(stablePrefix.length);
        expect(stableCount).toBeLessThanOrEqual(incremental.polygons.length);
        stablePrefix = incremental.polygons.slice(0, stableCount);
        if (sampleCount % COMPARE_STEP !== 0 && sampleCount !== SAMPLE_COUNT) {
          continue;
        }
        const batch = batchPlan(brush, shell, fxInput);
        expect(
          polygonDigest(incremental),
          `n=${sampleCount} polygon digest`,
        ).toBe(polygonDigest(batch));
        expect(incremental, `n=${sampleCount} plan`).toEqual(batch);
      }
    },
  );

  it("rebuilds and still matches the batch plan when the consumed prefix is rewritten", () => {
    const brush = "glow" as const;
    const shell = shellsUnderTest(brush)[0]!;
    const { points, pressures } = circleStroke(64);
    const producer = createStudioIncrementalFxPressurePathBuilder();
    const ribbon = createStudioIncrementalFxLuminousRibbonBuilder();
    const append = (
      nextPoints: readonly number[],
      nextPressures: readonly number[],
    ) => {
      const fxInput = pressurePathInput(
        brush,
        nextPoints,
        nextPressures,
        Math.floor(nextPoints.length / 2),
      );
      return {
        incremental: ribbon.append({
          brushId: brush,
          pressurePath: producer.append(fxInput),
          producer,
          baseWidth: BASE_WIDTH,
          ...shell,
        }),
        batch: batchPlan(brush, shell, fxInput),
      };
    };
    append(points, pressures);
    const settledGeneration = ribbon.generation();

    // 같은 길이의 내부 재작성. 압력 빌더의 O(1) 앵커가 잡도록 꼬리도 함께 움직인다 —
    // 잡히지 않는 내부 재작성은 압력 빌더 쪽 계약이고, 여기서 검사하는 것은 그 뒤의 리본이
    // 생산자의 리셋을 그대로 따라가느냐다.
    const rewritten = points.slice();
    rewritten[20] = rewritten[20]! + 17;
    rewritten[rewritten.length - 2] = rewritten[rewritten.length - 2]! + 3;
    const afterRewrite = append(rewritten, pressures);
    expect(ribbon.generation()).toBeGreaterThan(settledGeneration);
    expect(afterRewrite.incremental).toEqual(afterRewrite.batch);

    // 되돌리기(획이 줄어든다).
    const shrunk = append(rewritten.slice(0, 30 * 2), pressures.slice(0, 30));
    expect(shrunk.incremental).toEqual(shrunk.batch);
  });

  it("rebuilds when a producer re-emits a segment the ribbon already consumed", () => {
    // 객체 동일성 앵커를 직접 겨눈다. 실제 압력 빌더는 소비 워터마크 **뒤**만 다시 방출하고
    // prefix 를 고쳐 쓸 때는 스스로 세대를 올리므로, 이 상황을 스스로 만들지 못한다 — 워터마크를
    // 과대 보고하면서 세대는 고정하는 대역 생산자를 세워야 가드가 실제로 발동한다.
    const brush = "glow" as const;
    const shell = shellsUnderTest(brush)[0]!;
    const { points, pressures } = circleStroke(48);
    const ribbon = createStudioIncrementalFxLuminousRibbonBuilder();
    const pathFor = (source: readonly number[]) => planStudioFxBrushPressurePath(
      pressurePathInput(brush, source, pressures, 40),
    );
    const overReporting = (
      path: ReturnType<typeof pathFor>,
    ): Parameters<typeof ribbon.append>[0]["producer"] => ({
      append: () => path,
      stableSegmentCount: () => path.segments.length,
      generation: () => 7,
    });
    const appendWith = (source: readonly number[]) => {
      const path = pathFor(source);
      return {
        incremental: ribbon.append({
          brushId: brush,
          pressurePath: path,
          producer: overReporting(path),
          baseWidth: BASE_WIDTH,
          ...shell,
        }),
        batch: planStudioFxLuminousRibbonPass({
          brushId: brush,
          pressurePath: path,
          baseWidth: BASE_WIDTH,
          ...shell,
        }),
      };
    };
    appendWith(points);
    const settledGeneration = ribbon.generation();
    // 길이도 세대도 워터마크도 그대로지만 이미 소비한 인덱스의 좌표가 달라졌다.
    const moved = points.slice();
    moved[12] = moved[12]! + 11;
    moved[13] = moved[13]! - 7;
    const rebuilt = appendWith(moved);
    expect(ribbon.generation()).toBeGreaterThan(settledGeneration);
    expect(rebuilt.incremental).toEqual(rebuilt.batch);
  });

  it("rebuilds when the pass width changes mid-draft", () => {
    const brush = "soft-glow" as const;
    const [wide, narrow] = shellsUnderTest(brush);
    const { points, pressures } = circleStroke(48);
    const producer = createStudioIncrementalFxPressurePathBuilder();
    const ribbon = createStudioIncrementalFxLuminousRibbonBuilder();
    const fxInput = pressurePathInput(brush, points, pressures, 48);
    ribbon.append({
      brushId: brush,
      pressurePath: producer.append(fxInput),
      producer,
      baseWidth: BASE_WIDTH,
      ...wide!,
    });
    const settledGeneration = ribbon.generation();
    const switched = ribbon.append({
      brushId: brush,
      pressurePath: producer.append(fxInput),
      producer,
      baseWidth: BASE_WIDTH,
      ...narrow!,
    });
    expect(ribbon.generation()).toBeGreaterThan(settledGeneration);
    expect(switched).toEqual(batchPlan(brush, narrow!, fxInput));
  });

  it("rebuilds when the producer bumps its generation", () => {
    const brush = "neon" as const;
    const shell = shellsUnderTest(brush)[1]!;
    const { points, pressures } = circleStroke(40);
    const producer = createStudioIncrementalFxPressurePathBuilder();
    const ribbon = createStudioIncrementalFxLuminousRibbonBuilder();
    const fxInput = pressurePathInput(brush, points, pressures, 40);
    ribbon.append({
      brushId: brush,
      pressurePath: producer.append(fxInput),
      producer,
      baseWidth: BASE_WIDTH,
      ...shell,
    });
    const settledRibbon = ribbon.generation();
    const settledProducer = producer.generation();
    // 리샘플·레거시 문서처럼 필압이 점과 나란하지 않으면 압력 빌더는 스스로를 비우고 배치로
    // 위임한다 — 리본은 그 세대 변화만 보고 자기 prefix 신뢰를 버려야 한다.
    producer.append({
      ...fxInput,
      pressures: pressures.slice(0, 10),
    });
    expect(producer.generation()).toBeGreaterThan(settledProducer);
    const rebuilt = ribbon.append({
      brushId: brush,
      pressurePath: producer.append(fxInput),
      producer,
      baseWidth: BASE_WIDTH,
      ...shell,
    });
    expect(ribbon.generation()).toBeGreaterThan(settledRibbon);
    expect(rebuilt).toEqual(batchPlan(brush, shell, fxInput));
  });
});

/**
 * jsdom 에도 node 에도 `Path2D` 는 없다(`studio-manga-focus-lines.test.ts` 의 선례). 유지 경로를
 * 실제로 실행하려면 기록형 shim 을 깔아야 하고, 그 shim 이 곧 커맨드 스트림 관측 지점이 된다.
 */
class RecordingPath2D {
  readonly commands: string[] = [];
  addPath(other: RecordingPath2D): void {
    this.commands.push(...other.commands);
  }
  moveTo(x: number, y: number): void {
    this.commands.push(`M${x},${y}`);
  }
  lineTo(x: number, y: number): void {
    this.commands.push(`L${x},${y}`);
  }
  closePath(): void {
    this.commands.push("Z");
  }
}

class RecordingFillContext {
  readonly fills: string[][] = [];
  private direct: string[] = [];
  beginPath(): void {
    this.direct = [];
  }
  moveTo(x: number, y: number): void {
    this.direct.push(`M${x},${y}`);
  }
  lineTo(x: number, y: number): void {
    this.direct.push(`L${x},${y}`);
  }
  closePath(): void {
    this.direct.push("Z");
  }
  fill(pathOrRule?: unknown): void {
    this.fills.push(
      pathOrRule instanceof RecordingPath2D
        ? [...pathOrRule.commands]
        : [...this.direct],
    );
  }
}

describe("fillStudioFxLuminousRibbonPass (retained Path2D)", () => {
  let installedPath2D = false;

  beforeAll(() => {
    if (typeof Path2D === "undefined") {
      (globalThis as unknown as Record<string, unknown>).Path2D = RecordingPath2D;
      installedPath2D = true;
    }
  });

  afterAll(() => {
    if (installedPath2D) {
      delete (globalThis as unknown as Record<string, unknown>).Path2D;
    }
  });

  it("emits the batch trace verbatim through exactly one fill per pass per frame", () => {
    expect(typeof Path2D).toBe("function");
    const brush = "glow" as const;
    const shells = shellsUnderTest(brush);
    const { points, pressures } = circleStroke(TRACE_SAMPLES);
    const producer = createStudioIncrementalFxPressurePathBuilder();
    const passes = shells.map(() => {
      const builder = createStudioIncrementalFxLuminousRibbonBuilder();
      return { builder, retained: createStudioFxLuminousRetainedPass(builder) };
    });
    for (let sampleCount = 1; sampleCount <= TRACE_SAMPLES; sampleCount += 1) {
      const fxInput = pressurePathInput(brush, points, pressures, sampleCount);
      const pressurePath = producer.append(fxInput);
      for (let shellIndex = 0; shellIndex < shells.length; shellIndex += 1) {
        const { builder, retained } = passes[shellIndex]!;
        const plan = builder.append({
          brushId: brush,
          pressurePath,
          producer,
          baseWidth: BASE_WIDTH,
          ...shells[shellIndex]!,
        });
        const context = new RecordingFillContext();
        fillStudioFxLuminousRibbonPass(
          context as unknown as StudioFxLuminousRibbonFillContext,
          plan,
          retained,
        );
        // 단일 fill 계약은 매 프레임 검사한다 — 여기가 이음매가 생기는 지점이다.
        expect(
          context.fills,
          `n=${sampleCount} shell ${shellIndex} fill count`,
        ).toHaveLength(1);
        if (sampleCount % COMPARE_STEP !== 0 && sampleCount !== TRACE_SAMPLES) {
          continue;
        }
        expect(
          context.fills[0],
          `n=${sampleCount} shell ${shellIndex} command stream`,
        ).toEqual(traceCommands(batchPlan(brush, shells[shellIndex]!, fxInput)));
      }
    }
  });

  it("falls back to one whole-plan trace when no retained pass is supplied", () => {
    const brush = "neon" as const;
    const shell = shellsUnderTest(brush)[0]!;
    const { points, pressures } = circleStroke(24);
    const fxInput = pressurePathInput(brush, points, pressures, 24);
    const plan = batchPlan(brush, shell, fxInput);
    const context = new RecordingFillContext();
    fillStudioFxLuminousRibbonPass(
      context as unknown as StudioFxLuminousRibbonFillContext,
      plan,
      null,
    );
    expect(context.fills).toHaveLength(1);
    expect(context.fills[0]).toEqual(traceCommands(plan));
  });
});
