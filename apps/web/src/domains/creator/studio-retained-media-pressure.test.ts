import { describe, expect, it } from "vitest";

import {
  createStudioIncrementalRetainedMediaCurveBuilder,
  planStudioRetainedMediaPressureCurve,
  planStudioRetainedMediaTapDab,
  resolveStudioRetainedMediaPressure,
  resolveStudioRetainedMediaPressureProfileId,
  resolveStudioRetainedMediaPressureSeries,
} from "./studio-retained-media-pressure";

describe("studio retained media pressure", () => {
  it("keeps neutral mouse pressure at the exact nominal material response", () => {
    const profileNominals = {
      pencil: 0.58,
      "pencil-2b": 0.58,
      "pencil-6b": 0.58,
      "soft-pencil": 0.58,
      "colored-pencil": 0.58,
      brush: 0.65,
      "flat-brush": 0.65,
    } as const;
    for (const [profile, nominal] of Object.entries(profileNominals) as Array<
      [keyof typeof profileNominals, number]
    >) {
      for (const pressure of [0.5, nominal]) {
        expect(resolveStudioRetainedMediaPressure(profile, pressure)).toEqual({
          pressure,
          sizeScale: 1,
          opacityScale: 1,
          flowScale: 1,
        });
      }
    }
  });

  it("maps light-to-heavy pressure into wider and more pigmented media", () => {
    for (const profile of ["pencil", "pencil-6b", "brush", "flat-brush"] as const) {
      const light = resolveStudioRetainedMediaPressure(profile, 0);
      const heavy = resolveStudioRetainedMediaPressure(profile, 1);
      expect(heavy.sizeScale, profile).toBeGreaterThan(light.sizeScale);
      expect(heavy.opacityScale, profile).toBeGreaterThan(light.opacityScale);
      expect(heavy.flowScale, profile).toBeGreaterThan(light.flowScale);
    }
  });

  it("keeps the chisel marker's footprint near-invariant while pressure drives ink delivery", () => {
    expect(resolveStudioRetainedMediaPressureProfileId("marker--chisel-ribbon"))
      .toBe("marker-chisel");
    const light = resolveStudioRetainedMediaPressure("marker-chisel", 0);
    const heavy = resolveStudioRetainedMediaPressure("marker-chisel", 1);
    // A firm felt wedge barely changes width — that is what separates this lane from the
    // pressure-broadened canonical brush it was quarantined against.
    expect(heavy.sizeScale / light.sizeScale).toBeLessThan(1.35);
    expect(heavy.flowScale / light.flowScale).toBeGreaterThan(1.8);
    expect(heavy.opacityScale).toBeGreaterThan(light.opacityScale);
  });

  it.each(["pencil", "brush"] as const)(
    "%s applies the selected minimum only to geometry",
    (profile) => {
      const sliderZero = resolveStudioRetainedMediaPressure(profile, 0, 0);
      const sliderFull = resolveStudioRetainedMediaPressure(profile, 0, 1);

      expect(sliderFull.sizeScale).toBe(1);
      expect(sliderFull.sizeScale).toBeGreaterThan(sliderZero.sizeScale);
      expect(sliderFull.opacityScale).toBe(sliderZero.opacityScale);
      expect(sliderFull.flowScale).toBe(sliderZero.flowScale);
      expect(sliderFull.pressure).toBe(sliderZero.pressure);
    },
  );

  it("recognizes only retained pressure-owned families and excludes fixed-grid brushes", () => {
    expect(resolveStudioRetainedMediaPressureProfileId("pencil-2b")).toBe("pencil-2b");
    expect(resolveStudioRetainedMediaPressureProfileId("flat-brush")).toBe("flat-brush");
    expect(resolveStudioRetainedMediaPressureProfileId("pixel-pencil")).toBeNull();
    expect(resolveStudioRetainedMediaPressureProfileId("screentone")).toBeNull();
    expect(resolveStudioRetainedMediaPressureProfileId("airbrush")).toBeNull();
  });

  it("plans deterministic quadratic segments with aligned pressure and exact endpoints", () => {
    const input = {
      points: [0, 0, 20, 12, 45, 8, 72, 30],
      pressures: [0.1, 0.35, 0.72, 1],
    } as const;
    const first = planStudioRetainedMediaPressureCurve(
      input.points,
      input.pressures,
      "pencil",
    );
    const second = planStudioRetainedMediaPressureCurve(
      input.points,
      input.pressures,
      "pencil",
    );

    expect(first).toEqual(second);
    expect(first.segments).toHaveLength(3);
    expect(first.segments[0]).toMatchObject({ moveX: 0, moveY: 0 });
    expect(first.segments.at(-1)).toMatchObject({ endX: 72, endY: 30 });
    expect(first.segments.at(-1)!.sizeScale).toBeGreaterThan(
      first.segments[0]!.sizeScale,
    );
    expect(first.segments.at(-1)!.opacityScale).toBeGreaterThan(
      first.segments[0]!.opacityScale,
    );
  });

  it("resamples sparse pressure journals without changing the renderer point count", () => {
    const series = resolveStudioRetainedMediaPressureSeries(
      "flat-brush",
      [0, 1],
      5,
    );
    expect(series).toHaveLength(5);
    expect(series.map(({ pressure }) => pressure)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(series[2]!.sizeScale).toBe(1);
  });

  it("resolves a contact dab only while the gesture has no extent", () => {
    const contact = planStudioRetainedMediaTapDab([12, 34], [1], "pencil");
    const held = planStudioRetainedMediaTapDab(
      [12, 34, 12, 34, 12, 34],
      [0.2, 0.6, 1],
      "pencil",
    );
    const light = planStudioRetainedMediaTapDab([12, 34], [0], "pencil");

    expect(contact).toMatchObject({ x: 12, y: 34, pressure: 1 });
    expect(contact!.sizeScale).toBeGreaterThan(1);
    // A held tap is the same mark: the response follows the contact sample, not the journal tail.
    expect(held).toEqual(planStudioRetainedMediaTapDab([12, 34], [0.2], "pencil"));
    expect(light!.sizeScale).toBeLessThan(contact!.sizeScale);
    expect(light!.opacityScale).toBeLessThan(contact!.opacityScale);
    expect(planStudioRetainedMediaTapDab([], undefined, "pencil")).toBeNull();
  });

  it("never resolves a contact dab once any sample has travelled", () => {
    for (const points of [
      [0, 0, 0.001, 0],
      [0, 0, 0, -0.001],
      [5, 5, 5, 5, 5.5, 5],
      [0, 0, 20, 12, 45, 8],
    ]) {
      expect(planStudioRetainedMediaTapDab(points, [0.5], "pencil"), String(points))
        .toBeNull();
    }
    // A malformed suffix is discarded before the extent test, so its prefix still taps.
    expect(planStudioRetainedMediaTapDab(
      [3, 4, Number.NaN, 9, 80, 80],
      [0.5],
      "brush",
    )).toMatchObject({ x: 3, y: 4 });
  });

  it("fails closed at malformed coordinates and clamps malformed pressures", () => {
    const malformed = planStudioRetainedMediaPressureCurve(
      [0, 0, 10, 0, Number.NaN, 2, 40, 0],
      [-10, Number.NaN, 20],
      "brush",
    );
    expect(malformed.sourcePointCount).toBe(2);
    expect(malformed.segments).toHaveLength(1);
    expect(Object.values(malformed.segments[0]!).every((value) => (
      typeof value !== "number" || Number.isFinite(value)
    ))).toBe(true);
  });
});

describe("createStudioIncrementalRetainedMediaCurveBuilder", () => {
  // pointCount - 1 = 16 (2의 거듭제곱)이면 배치 빌더의 진행률 위치 i/(n-1)·(n-1)가
  // 부동소수에서도 정확히 정수 i로 떨어져, 나란한 필압 배열에서 두 빌더가 바이트 동일해진다.
  const pointCount = 17;
  const points = Array.from({ length: pointCount }, (_, index) => [
    index * 6 + Math.sin(index * 0.7) * 2,
    30 + Math.cos(index * 0.5) * 9,
  ]).flat();
  const pressures = Array.from({ length: pointCount }, (_, index) => 0.15 + (index % 6) / 8);
  const options = { minimumDiameterRatio: 0.2 };

  it("matches the batch planner exactly for parallel per-point pressures", () => {
    const batch = planStudioRetainedMediaPressureCurve(points, pressures, "pencil", options);
    const builder = createStudioIncrementalRetainedMediaCurveBuilder("pencil", options);
    const whole = builder.append(points, pressures);
    expect(whole.sourcePointCount).toBe(batch.sourcePointCount);
    expect(whole.segments).toEqual([...batch.segments]);

    // chunk 단위로 나눠 넣어도 같은 곡선이 자라난다 — 직전 최종 선분의 끝이 중점으로 물러나는
    // "교체 가능한 꼬리"까지 배치와 일치해야 한다.
    const chunked = createStudioIncrementalRetainedMediaCurveBuilder("pencil", options);
    for (const consumed of [2, 3, 6, 7, 11, pointCount]) {
      const plan = chunked.append(points.slice(0, consumed * 2), pressures.slice(0, consumed));
      // 부분 prefix도 그 길이의 배치 결과와 같아야 한다(9점: n-1=8도 2의 거듭제곱).
      if (consumed === 3 || consumed === pointCount) {
        expect(plan.segments).toEqual([
          ...planStudioRetainedMediaPressureCurve(
            points.slice(0, consumed * 2),
            pressures.slice(0, consumed),
            "pencil",
            options,
          ).segments,
        ]);
      }
    }
    expect(chunked.append(points, pressures).segments).toEqual([...batch.segments]);
  });

  it("matches the batch planner without pressures and rebuilds on shrink", () => {
    const builder = createStudioIncrementalRetainedMediaCurveBuilder("brush", null);
    builder.append(points, undefined);
    const shrunk = builder.append(points.slice(0, 18), undefined);
    expect(shrunk.segments).toEqual([
      ...planStudioRetainedMediaPressureCurve(points.slice(0, 18), undefined, "brush").segments,
    ]);
    expect(builder.append(points, undefined).segments).toEqual([
      ...planStudioRetainedMediaPressureCurve(points, undefined, "brush").segments,
    ]);
  });

  it("truncates at the first malformed coordinate like the batch planner", () => {
    // 유효 점 5개(n-1=4) 뒤에 NaN: 거기서 절단하고, 다음 append도 같은 자리에서 멈춘다.
    const corrupt = [...points.slice(0, 10), Number.NaN, 3, ...points.slice(12)];
    const builder = createStudioIncrementalRetainedMediaCurveBuilder("pencil", options);
    const plan = builder.append(corrupt, pressures);
    expect(plan.sourcePointCount).toBe(5);
    expect(plan.segments).toEqual([
      ...planStudioRetainedMediaPressureCurve(
        points.slice(0, 10),
        pressures.slice(0, 5),
        "pencil",
        options,
      ).segments,
    ]);
    expect(builder.append(corrupt, pressures).segments).toHaveLength(4);
  });
});
