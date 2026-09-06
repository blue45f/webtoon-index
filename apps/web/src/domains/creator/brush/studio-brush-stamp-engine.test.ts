import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginStampWalker,
  drawStampStroke,
  drawStudioStampBrushDabs,
  planStudioStampBrushDabs,
  resolveStudioStampBrushKind,
  resolveStudioStampBrushStyle,
  STUDIO_STAMP_BRUSH_DEFAULTS,
  STUDIO_STAMP_BRUSH_MAX_DABS,
  stampJitter,
  stampStrokeDot,
  studioStampOssTipCoverage,
  walkStampSegment,
  type StudioStampBrushKind,
  type StudioStampBrushStyle,
  type StudioStampOssTexturedTipKind,
} from "./studio-brush-stamp-engine";

/** canvas2d 호출을 기록하는 가짜 컨텍스트 — 픽셀 대신 dab 시퀀스로 검증한다. */
interface RecordedDab {
  x: number;
  y: number;
  r: number;
  alpha: number;
}
function recordingContext() {
  const dabs: RecordedDab[] = [];
  const strokes: RecordedDab[] = [];
  let alpha = 1;
  let pathArc: { x: number; y: number; r: number } | null = null;
  const context = {
    set globalAlpha(value: number) {
      alpha = value;
    },
    get globalAlpha() {
      return alpha;
    },
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => {
      pathArc = null;
    },
    arc: (x: number, y: number, r: number) => {
      pathArc = { x, y, r };
    },
    fill: () => {
      if (pathArc) dabs.push({ ...pathArc, alpha });
    },
    stroke: () => {
      if (pathArc) strokes.push({ ...pathArc, alpha });
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, dabs, strokes };
}

function style(kind: StudioStampBrushKind, overrides?: Partial<StudioStampBrushStyle>): StudioStampBrushStyle {
  return {
    kind,
    color: "#223344",
    size: 12,
    opacity: 1,
    ...STUDIO_STAMP_BRUSH_DEFAULTS[kind],
    ...overrides,
  };
}

const LINE: number[] = [];
const LINE_PRESSURES: number[] = [];
for (let i = 0; i <= 20; i += 1) {
  LINE.push(i * 6, 0);
  LINE_PRESSURES.push(0.3 + 0.6 * (i / 20));
}

describe("studio stamp brush engine", () => {
  it("stampJitter is deterministic and in [0,1)", () => {
    for (let i = 0; i < 50; i += 1) {
      const a = stampJitter(i, 7);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
      expect(stampJitter(i, 7)).toBe(a);
    }
    expect(stampJitter(1, 7)).not.toBe(stampJitter(2, 7));
  });

  it("incremental walking equals whole-stroke replay (pixel-convention contract)", () => {
    for (const kind of [
      "airbrush", "pencil", "ink", "watercolor", "crayon", "chalk", "charcoal", "pastel",
    ] as const) {
      const whole = recordingContext();
      drawStampStroke(whole.context, style(kind), LINE, LINE_PRESSURES);

      const incremental = recordingContext();
      stampStrokeDot(incremental.context, style(kind), LINE[0]!, LINE[1]!, LINE_PRESSURES[0]!);
      const state = beginStampWalker(LINE[0]!, LINE[1]!, LINE_PRESSURES[0]!);
      state.stampIndex = 1;
      for (let i = 1; i * 2 < LINE.length; i += 1) {
        walkStampSegment(
          incremental.context,
          style(kind),
          state,
          LINE[i * 2]!,
          LINE[i * 2 + 1]!,
          LINE_PRESSURES[i]!
        );
      }
      expect(incremental.dabs).toEqual(whole.dabs);
      expect(incremental.strokes).toEqual(whole.strokes);
    }
  });

  // 의도적 변경(2026-07-23 스트로크 렌더 품질 감사): 시작 도트 위에 t=0 중복 dab을 얹지 않는다.
  it("does not double-stamp the stroke head: exactly one dab sits on the start point", () => {
    for (const kind of [
      "airbrush", "pencil", "ink", "watercolor", "crayon", "chalk", "charcoal", "pastel",
    ] as const) {
      const planned = planStudioStampBrushDabs(style(kind), [5, 5, 65, 5], [0.6, 0.6]);
      const headDabs = planned.filter((dab) => dab.x === 5 && dab.y === 5);
      expect(headDabs).toHaveLength(1);
      expect(headDabs[0]!.index).toBe(0);
      // 첫 워커 dab은 시작 도트에서 최소 한 간격만큼 떨어져 있고, 이후 간격과 동일한 리듬이다.
      const first = planned[1]!;
      const second = planned[2]!;
      expect(first.x - 5).toBeGreaterThan(0);
      expect(second.x - first.x).toBeCloseTo(first.x - 5, 10);
    }
  });

  it("keeps the t=0 dab for a dot-less walker (stampIndex 0) exactly as before", () => {
    const rec = recordingContext();
    const state = beginStampWalker(0, 0, 0.8);
    walkStampSegment(rec.context, style("ink"), state, 40, 0, 0.8);
    expect(rec.dabs[0]).toMatchObject({ x: 0, y: 0 });
  });

  it("pure dab planner preserves tap, short-stroke and long-stroke ordering deterministically", () => {
    const ink = style("ink", { size: 16, minSizeRatio: 0.2 });
    const tap = planStudioStampBrushDabs(ink, [7, 9], [0.25]);
    const short = planStudioStampBrushDabs(ink, [7, 9, 17, 9], [0.25, 0.7]);
    const long = planStudioStampBrushDabs(ink, [7, 9, 117, 9], [0.25, 0.7]);

    expect(tap).toHaveLength(1);
    expect(tap[0]).toMatchObject({ x: 7, y: 9, index: 0, alpha: 1 });
    expect(short.length).toBeGreaterThan(tap.length);
    expect(long.length).toBeGreaterThan(short.length);
    expect(long.map((dab) => dab.index)).toEqual(
      Array.from({ length: long.length }, (_, index) => index)
    );
    expect(planStudioStampBrushDabs(ink, [7, 9, 117, 9], [0.25, 0.7])).toEqual(long);
  });

  it("pure planner and Canvas primary dabs share the same footprint", () => {
    for (const kind of [
      "airbrush", "ink", "watercolor", "crayon", "chalk", "charcoal", "pastel",
    ] as const) {
      const brushStyle = style(kind, { opacity: 0.65 });
      const planned = planStudioStampBrushDabs(brushStyle, LINE, LINE_PRESSURES);
      const rendered = recordingContext();
      drawStampStroke(rendered.context, brushStyle, LINE, LINE_PRESSURES);
      expect(rendered.dabs).toEqual(planned.map(({ x, y, radius, alpha }) => ({
        x,
        y,
        r: radius,
        alpha,
      })));
    }
  });

  it("bounds huge finite segments identically in the planner, replay, and incremental walker", () => {
    const brushStyle = style("ink", { size: 1, minSizeRatio: 1 });
    const points = [0, 0, 1_000_000_000, 0];
    const planned = planStudioStampBrushDabs(brushStyle, points, [0.5, 0.5], 7);
    expect(planned).toHaveLength(7);

    const replay = recordingContext();
    drawStampStroke(replay.context, brushStyle, points, [0.5, 0.5], 7);
    expect(replay.dabs).toHaveLength(7);

    const incremental = recordingContext();
    stampStrokeDot(incremental.context, brushStyle, 0, 0, 0.5);
    const state = beginStampWalker(0, 0, 0.5);
    state.stampIndex = 1;
    walkStampSegment(incremental.context, brushStyle, state, 1_000_000_000, 0, 0.5, 7);
    expect(incremental.dabs).toHaveLength(7);
    expect(incremental.dabs).toEqual(replay.dabs);
    expect(state.stampIndex).toBe(7);
    walkStampSegment(incremental.context, brushStyle, state, 2_000_000_000, 0, 0.5, 7);
    expect(incremental.dabs).toHaveLength(7);
  });

  it("stops at the first non-finite coordinate pair and falls back corrupt pressure to 0.5", () => {
    const brushStyle = style("ink", { size: 10, minSizeRatio: 0 });
    const points = [2, 3, 8, 3, Number.NaN, 4, 100, 100];
    const corrupt = planStudioStampBrushDabs(
      brushStyle,
      points,
      [Number.NaN, Number.POSITIVE_INFINITY, 1, 1],
      100,
    );
    const canonical = planStudioStampBrushDabs(
      brushStyle,
      [2, 3, 8, 3],
      [0.5, 0.5],
      100,
    );

    expect(corrupt).toEqual(canonical);
    expect(corrupt.every((dab) =>
      [dab.x, dab.y, dab.radius, dab.alpha].every(Number.isFinite)
    )).toBe(true);
  });

  it("pressure grows dab radius between min-size and full size", () => {
    const soft = recordingContext();
    drawStampStroke(soft.context, style("ink"), [0, 0, 40, 0], [0.05, 0.05]);
    const hard = recordingContext();
    drawStampStroke(hard.context, style("ink"), [0, 0, 40, 0], [1, 1]);
    const softMax = Math.max(...soft.dabs.map((d) => d.r));
    const hardMax = Math.max(...hard.dabs.map((d) => d.r));
    expect(hardMax).toBeGreaterThan(softMax * 2);
  });

  it("ink thins with speed (velocity-reactive dip pen)", () => {
    const slow = recordingContext();
    {
      const state = beginStampWalker(0, 0, 0.8);
      walkStampSegment(slow.context, style("ink"), state, 4, 0, 0.8);
    }
    const fast = recordingContext();
    {
      const state = beginStampWalker(0, 0, 0.8);
      walkStampSegment(fast.context, style("ink"), state, 90, 0, 0.8);
    }
    // Measured on the SETTLED body, not on the maximum. Both strokes start from rest — the pen has
    // no speed at the instant it touches down — so both now open at full width and the velocity
    // response eases in over the first few dabs. Comparing maxima therefore compares two identical
    // heads and says nothing about thinning; it passed before only because the fast stroke's very
    // first dab was attenuated by a speed it had not travelled yet, which is the head blob this
    // easing removed (1.470x its own body radius, in one dab).
    const settled = (dabs: readonly { r: number }[]): number => dabs.at(-1)!.r;
    expect(settled(fast.dabs)).toBeLessThan(settled(slow.dabs));
    // And the head is the same width in both, which is the other half of the contract.
    expect(fast.dabs[0]!.r).toBeCloseTo(slow.dabs[0]!.r, 6);
  });

  it("opens a fast ink stroke without a step between the head and the body", () => {
    // A fast stroke pins inkVelocityFactor at its 0.35 floor, so before the easing the stroke went
    // from a full-width first dab straight to a 0.35 body — a visible blob at the head of every
    // quick ink line. The contract is that the width falls off continuously instead.
    const fast = recordingContext();
    const state = beginStampWalker(0, 0, 0.8);
    for (let step = 1; step <= 6; step += 1) {
      walkStampSegment(fast.context, style("ink"), state, step * 90, 0, 0.8);
    }
    const radii = fast.dabs.map((dab) => dab.r);
    expect(radii.length).toBeGreaterThan(8);
    // Falls to the body width, so the velocity response is still doing its job…
    expect(Math.min(...radii)).toBeLessThan(radii[0]! * 0.75);
    // …but never in one step. The largest single-dab drop bounds the visible discontinuity; the
    // pre-easing plan measured 1.470 here.
    let steepest = 1;
    for (let index = 1; index < radii.length; index += 1) {
      steepest = Math.max(steepest, radii[index - 1]! / Math.max(1e-6, radii[index]!));
    }
    expect(steepest).toBeLessThan(1.28);
  });

  it("flow builds up: airbrush dab alpha stays below stroke opacity", () => {
    const rec = recordingContext();
    drawStampStroke(rec.context, style("airbrush"), [0, 0, 30, 0], [0.7, 0.7]);
    expect(rec.dabs.length).toBeGreaterThan(3);
    for (const dab of rec.dabs) {
      expect(dab.alpha).toBeLessThanOrEqual(STUDIO_STAMP_BRUSH_DEFAULTS.airbrush.flow + 1e-9);
    }
  });

  it("watercolor adds a wet-edge ring per dab", () => {
    const rec = recordingContext();
    drawStampStroke(rec.context, style("watercolor"), [0, 0, 24, 0], [0.6, 0.6]);
    expect(rec.strokes.length).toBe(rec.dabs.length);
    expect(rec.strokes[0]!.r).toBeLessThan(rec.dabs[0]!.r);
  });

  it("pencil grain jitters deterministically (two runs identical)", () => {
    const a = recordingContext();
    drawStampStroke(a.context, style("pencil"), LINE, LINE_PRESSURES);
    const b = recordingContext();
    drawStampStroke(b.context, style("pencil"), LINE, LINE_PRESSURES);
    expect(a.dabs).toEqual(b.dabs);
    // 그레인 보조 점이 본 dab 보다 많다(도장당 2개).
    expect(a.dabs.length).toBeGreaterThan(LINE.length / 2);
  });
});

const DRY_STAMP_LANES = [
  { brushId: "crayon--klecks-stamp", kind: "crayon" },
  { brushId: "chalk--klecks-stamp", kind: "chalk" },
  { brushId: "charcoal--mypaint-stamp", kind: "charcoal" },
  { brushId: "pastel--soft-stamp", kind: "pastel" },
] as const;

const DRY_STAMP_KINDS = ["crayon", "chalk", "charcoal", "pastel"] as const;

/** 단위 원 안을 그리드 샘플링해 팁 커버리지 필드를 얻는다(팁 라스터와 같은 순수 함수). */
function sampleTipCoverageField(
  kind: StudioStampOssTexturedTipKind,
  seed: number,
  hardness: number,
): number[] {
  const values: number[] = [];
  const grid = 40;
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const nx = ((x + 0.5) / grid) * 2 - 1;
      const ny = ((y + 0.5) / grid) * 2 - 1;
      if (Math.hypot(nx, ny) >= 1) continue;
      values.push(studioStampOssTipCoverage(kind, nx, ny, seed, hardness));
    }
  }
  return values;
}

function meanOf(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function varianceOf(values: readonly number[]): number {
  const mean = meanOf(values);
  return meanOf(values.map((value) => (value - mean) ** 2));
}

function meanAbsoluteDifference(a: readonly number[], b: readonly number[]): number {
  return meanOf(a.map((value, index) => Math.abs(value - (b[index] ?? 0))));
}

describe("studio dry-media stamp lane (verified OSS kernels)", () => {
  it("maps the engine-lane stamp ids while core dry ids stay on dynamic-dabs", () => {
    for (const lane of DRY_STAMP_LANES) {
      expect(resolveStudioStampBrushKind(lane.brushId)).toBe(lane.kind);
    }
    // 저자 계약: 코어 드라이 id 와 dry-dynamic 레인은 dynamic-dabs 파이프라인에 남는다.
    for (const coreId of ["crayon", "chalk", "charcoal", "pastel", "oil-pastel"]) {
      expect(resolveStudioStampBrushKind(coreId), `${coreId}: must stay dynamic`).toBeNull();
    }
    for (const dynamicLaneId of ["crayon--wax-scrape", "chalk--klecks-powder", "charcoal--vine-soft", "pastel--cake-soft"]) {
      expect(
        resolveStudioStampBrushKind(dynamicLaneId),
        `${dynamicLaneId}: dry-dynamic lane must not ride the stamp walker`
      ).toBeNull();
    }
  });

  it("keeps dry stamp defaults and spacing in the continuous-bed regime", () => {
    for (const lane of DRY_STAMP_LANES) {
      const defaults = STUDIO_STAMP_BRUSH_DEFAULTS[lane.kind];
      expect(defaults.flow).toBeGreaterThanOrEqual(0.3);
      expect(defaults.flow).toBeLessThanOrEqual(0.9);
      expect(defaults.hardness).toBeGreaterThan(0);
      expect(defaults.hardness).toBeLessThan(1);
      expect(defaults.minSizeRatio).toBeGreaterThan(0);
      expect(defaults.minSizeRatio).toBeLessThan(1);
      const resolved = resolveStudioStampBrushStyle(
        lane.kind,
        { color: "#334455", size: 14, opacity: 0.9 },
        null,
        lane.brushId,
      );
      // 왁스/파우더 베드가 폴리곤 확장 없이 이어지려면 연필(0.24)보다 촘촘해야 한다.
      expect(resolved.spacingRatio).toBeGreaterThanOrEqual(0.03);
      expect(resolved.spacingRatio).toBeLessThanOrEqual(0.2);
      expect(resolved.flow).toBeGreaterThan(0);
      expect(resolved.size).toBeGreaterThan(0);
    }
  });

  it("bakes deterministic, non-uniform, kind-distinct tip texture", () => {
    const hardnessByKind: Record<(typeof DRY_STAMP_KINDS)[number], number> = {
      crayon: STUDIO_STAMP_BRUSH_DEFAULTS.crayon.hardness,
      chalk: STUDIO_STAMP_BRUSH_DEFAULTS.chalk.hardness,
      charcoal: STUDIO_STAMP_BRUSH_DEFAULTS.charcoal.hardness,
      pastel: STUDIO_STAMP_BRUSH_DEFAULTS.pastel.hardness,
    };
    const fields = new Map<string, number[]>();
    for (const kind of DRY_STAMP_KINDS) {
      const field = sampleTipCoverageField(kind, 1234, hardnessByKind[kind]);
      expect(field).toEqual(sampleTipCoverageField(kind, 1234, hardnessByKind[kind]));
      for (const value of field) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
      // 질감 바닥: 균일 원판/그라디언트(분산≈0)와 달리 결이 살아 있어야 한다.
      expect(varianceOf(field), `${kind}: flat tip`).toBeGreaterThan(0.004);
      expect(meanOf(field), `${kind}: empty tip`).toBeGreaterThan(0.05);
      fields.set(kind, field);
    }
    // 의도적 유사 변종이라도 종류 간 필드는 뚜렷이 달라야 한다(같은 커널 재사용 금지 게이트).
    for (let i = 0; i < DRY_STAMP_KINDS.length; i += 1) {
      for (let j = i + 1; j < DRY_STAMP_KINDS.length; j += 1) {
        const difference = meanAbsoluteDifference(
          fields.get(DRY_STAMP_KINDS[i]!)!,
          fields.get(DRY_STAMP_KINDS[j]!)!,
        );
        expect(
          difference,
          `${DRY_STAMP_KINDS[i]} vs ${DRY_STAMP_KINDS[j]}: kinds render identically`
        ).toBeGreaterThan(0.03);
      }
    }
  });

  it("responds to the hardness knob on every dry kind", () => {
    for (const kind of DRY_STAMP_KINDS) {
      const soft = sampleTipCoverageField(kind, 1234, 0.1);
      const hard = sampleTipCoverageField(kind, 1234, 0.9);
      expect(
        meanAbsoluteDifference(soft, hard),
        `${kind}: hardness is a dead control`
      ).toBeGreaterThan(0.015);
    }
  });

  it("fills the crayon footprint to a ragged wax rim and stays inside the tip canvas", () => {
    // 옛 공식은 r≈0.69 에서 원판이 잘려 반경의 30% 를 버렸다. 림은 r≥0.9 까지 닿아야 한다.
    let rimCoverage = 0;
    for (let step = 0; step < 64; step += 1) {
      const angle = (step / 64) * Math.PI * 2;
      rimCoverage = Math.max(
        rimCoverage,
        studioStampOssTipCoverage("crayon", Math.cos(angle) * 0.9, Math.sin(angle) * 0.9, 1234, 0.88),
      );
    }
    expect(rimCoverage).toBeGreaterThan(0.02);
    // 팁 캔버스 여백(radius*2+4px) 밖으로는 어떤 종류도 새지 않는다.
    for (const kind of DRY_STAMP_KINDS) {
      for (let step = 0; step < 48; step += 1) {
        const angle = (step / 48) * Math.PI * 2;
        expect(
          studioStampOssTipCoverage(kind, Math.cos(angle) * 1.3, Math.sin(angle) * 1.3, 99, 0.9),
        ).toBe(0);
      }
    }
  });

  it("plans a 2000-sample stroke within the 150ms latency budget per kind", () => {
    const points: number[] = [];
    const pressures: number[] = [];
    for (let index = 0; index < 2000; index += 1) {
      points.push(index * 3, (index % 2) * 4);
      pressures.push(0.25 + 0.5 * ((index % 100) / 100));
    }
    for (const lane of DRY_STAMP_LANES) {
      const brushStyle = resolveStudioStampBrushStyle(
        lane.kind,
        { color: "#223344", size: 12, opacity: 0.85 },
        null,
        lane.brushId,
      );
      const startedAt = performance.now();
      const dabs = planStudioStampBrushDabs(brushStyle, points, pressures);
      const elapsedMs = performance.now() - startedAt;
      expect(elapsedMs, `${lane.brushId}: plan too slow`).toBeLessThan(150);
      expect(dabs.length).toBeGreaterThan(100);
      expect(dabs.length).toBeLessThanOrEqual(STUDIO_STAMP_BRUSH_MAX_DABS);
      // F1 종이 핀 이후 계약: 알파는 [0, flow×opacity] — 저필압 종이 골의 0 알파(이빨 공백)는
      // 정상이다. 획 전체가 비는 것은 여전히 금지한다.
      const alphaCeiling = brushStyle.flow * brushStyle.opacity + 1e-9;
      for (const dab of dabs.slice(0, 32)) {
        expect(Number.isFinite(dab.x) && Number.isFinite(dab.y)).toBe(true);
        expect(dab.radius).toBeGreaterThan(0);
        expect(dab.alpha).toBeGreaterThanOrEqual(0);
        expect(dab.alpha).toBeLessThanOrEqual(alphaCeiling);
      }
      expect(
        dabs.some((dab) => dab.alpha > 0),
        `${lane.brushId}: fully blank stroke`
      ).toBe(true);
    }
  });
});

/**
 * 캐시된 촉 래스터 blit 의 발자국 계약.
 *
 * 촉은 캐시 적중률을 위해 `Math.max(1, Math.round(radius))` 정수 반지름으로 굽는다. 굽는 건
 * 그대로 두되, blit 은 계획된 연속 반지름으로 되돌려야 한다 — 자연 크기로 찍으면 화면 반지름이
 * 정수로 양자화되어 1.4 는 1.0, 1.6 은 2.0, 테이퍼 하한 0.35 는 1.0(약 2.86배)이 되고, 같은
 * dab 을 정확한 radius 로 쓰는 폴백 arc 경로 및 SVG 내보내기(`r = dab.radius`)와 아트보드가
 * 어긋난다. 이 스위트는 실제 캔버스 경로(window + document 스텁)를 태워 그 계약을 고정한다.
 */
interface RecordedBlit {
  source: object;
  dx: number;
  dy: number;
  dw: number | undefined;
  dh: number | undefined;
}

/** getCachedDabTipCanvas 가 실제로 촉을 구울 수 있는 최소 document/window 스텁. */
function stubRealCanvasEnvironment(): { createdTips: { width: number; height: number }[] } {
  const createdTips: { width: number; height: number }[] = [];
  vi.stubGlobal("window", {} as Window & typeof globalThis);
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`unexpected element: ${tag}`);
      const tip = {
        width: 0,
        height: 0,
        getContext: (kind: string) =>
          kind === "2d"
            ? {
                fillStyle: "",
                strokeStyle: "",
                lineWidth: 0,
                beginPath: () => undefined,
                arc: () => undefined,
                fill: () => undefined,
                stroke: () => undefined,
                createRadialGradient: () => ({ addColorStop: () => undefined }),
              }
            : null,
      };
      createdTips.push(tip);
      return tip;
    },
  });
  return { createdTips };
}

/** 실제 캔버스로 판정되는(= 캐시 blit 경로를 타는) 기록용 컨텍스트. */
function blitRecordingContext() {
  const blits: RecordedBlit[] = [];
  const arcs: { x: number; y: number; r: number }[] = [];
  let pathArc: { x: number; y: number; r: number } | null = null;
  const context = {
    canvas: {} as HTMLCanvasElement,
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    beginPath: () => {
      pathArc = null;
    },
    arc: (x: number, y: number, r: number) => {
      pathArc = { x, y, r };
    },
    fill: () => {
      if (pathArc) arcs.push(pathArc);
    },
    stroke: () => undefined,
    drawImage: (
      source: object,
      dx: number,
      dy: number,
      dw?: number,
      dh?: number
    ) => {
      blits.push({ source, dx, dy, dw, dh });
    },
  } as unknown as CanvasRenderingContext2D;
  return { context, blits, arcs };
}

/**
 * blit 이 실제로 칠하는 반지름. 촉 래스터는 `bake*2 + 4` 픽셀 정사각형 안에 반지름 `bake` 의
 * 원을 그리므로, 목적 사각형 폭에서 같은 비율을 되돌리면 화면 반지름이 나온다.
 */
function blittedRadius(blit: RecordedBlit, bakedRadius: number): number {
  const tipSize = bakedRadius * 2 + 4;
  expect(Number.isFinite(blit.dw ?? Number.NaN)).toBe(true);
  expect(blit.dw).toBe(blit.dh);
  return ((blit.dw as number) / tipSize) * bakedRadius;
}

describe("studio stamp brush engine — cached tip blit footprint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blits the planned continuous radius, not the integer bake radius", () => {
    stubRealCanvasEnvironment();
    // 0.35 = pressureRadius 의 테이퍼 하한(굽는 반지름 1 로 올림 — 자연 크기면 약 2.86배).
    // 1.4 는 아래로, 1.6 은 위로 양자화되던 경계값.
    for (const [index, radius] of [0.35, 1.4, 1.6].entries()) {
      const { context, blits, arcs } = blitRecordingContext();
      const brushStyle = style("ink", { color: `#01020${index}` });
      drawStudioStampBrushDabs(context, brushStyle, [
        { x: 40, y: 24, radius, alpha: 0.8, index },
      ]);
      expect(blits, `radius ${radius}: cached tip lane not taken`).toHaveLength(1);
      expect(arcs, `radius ${radius}: fell through to the arc fallback`).toHaveLength(0);
      const blit = blits[0]!;
      const bakedRadius = Math.max(1, Math.round(radius));
      expect(blittedRadius(blit, bakedRadius)).toBeCloseTo(radius, 10);
      // 발자국은 계획 좌표 중심에 그대로 놓인다.
      expect(blit.dx + (blit.dw as number) / 2).toBeCloseTo(40, 10);
      expect(blit.dy + (blit.dh as number) / 2).toBeCloseTo(24, 10);
    }
  });

  it("agrees with the non-cached arc fallback for the same planned dab", () => {
    const dab = { x: 12, y: 9, radius: 1.4, alpha: 0.6, index: 3 };
    const brushStyle = style("ink", { color: "#0a0b0c" });

    // 폴백(=의도된 동작): 정확한 radius 로 arc 를 그린다.
    const fallback = recordingContext();
    drawStudioStampBrushDabs(fallback.context, brushStyle, [dab]);
    expect(fallback.dabs).toHaveLength(1);
    const fallbackRadius = fallback.dabs[0]!.r;
    expect(fallbackRadius).toBeCloseTo(dab.radius, 10);

    stubRealCanvasEnvironment();
    const cached = blitRecordingContext();
    drawStudioStampBrushDabs(cached.context, brushStyle, [dab]);
    expect(cached.blits).toHaveLength(1);
    expect(blittedRadius(cached.blits[0]!, 1)).toBeCloseTo(fallbackRadius, 10);
  });

  it("keeps one baked raster serving several fractional radii", () => {
    const { createdTips } = stubRealCanvasEnvironment();
    const { context, blits } = blitRecordingContext();
    const brushStyle = style("ink", { color: "#0d0e0f" });
    // 넷 다 Math.max(1, Math.round(r)) === 1 → 같은 캐시 키.
    const radii = [0.35, 0.6, 1.2, 1.4];
    drawStudioStampBrushDabs(
      context,
      brushStyle,
      radii.map((radius, index) => ({ x: 30, y: 30, radius, alpha: 0.5, index }))
    );

    // 캐시 적중: 촉은 한 번만 구웠다.
    expect(createdTips).toHaveLength(1);
    expect(createdTips[0]).toMatchObject({ width: 6, height: 6 });
    expect(blits).toHaveLength(radii.length);
    expect(new Set(blits.map((blit) => blit.source)).size).toBe(1);

    // 그래도 화면 발자국은 네 반지름 모두 서로 다르고 정확하다.
    const widths = blits.map((blit) => blit.dw as number);
    expect(new Set(widths).size).toBe(radii.length);
    for (const [index, radius] of radii.entries()) {
      expect(blittedRadius(blits[index]!, 1)).toBeCloseTo(radius, 10);
    }
  });
});
