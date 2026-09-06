import { describe, expect, it } from "vitest";

import {
  STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS,
  adaptStudioVelocityBezierInkDrawElement,
  appendStudioVelocityBezierInkStream,
  createStudioVelocityBezierInkStream,
  sealStudioVelocityBezierInkStream,
  type StudioVelocityBezierInkDrawSource,
  type StudioVelocityBezierInkPlan,
  type StudioVelocityBezierInkStreamState,
} from "./studio-velocity-bezier-ink-adapter";

function draw(
  points: readonly number[],
  pressures: readonly number[],
  strokeWidth = 10,
  id = "draw-1",
): StudioVelocityBezierInkDrawSource {
  return { id, points, pressures, strokeWidth };
}

function expectSuccess<T extends { ok: boolean }>(
  result: T,
): asserts result is Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
}

function combinedPreviewStations(plan: StudioVelocityBezierInkPlan) {
  const preview = plan.previewStations;
  if (preview.length === 0) return [...plan.settledStations];
  const settledLast = plan.settledStations.at(-1);
  const previewStart = preview[0];
  const duplicateBridge = settledLast
    && previewStart
    && settledLast.x === previewStart.x
    && settledLast.y === previewStart.y
    && settledLast.pressure === previewStart.pressure;
  return [
    ...plan.settledStations,
    ...preview.slice(duplicateBridge ? 1 : 0),
  ];
}

describe("studio-velocity-bezier-ink-adapter", () => {
  it("converts DrawEl flat channels to canonical source-pressure provenance", () => {
    const result = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([0, 0, 10, 2, 20, 0], [0.2, 0.8, 0.4], 12),
    });
    expectSuccess(result);

    expect(result.value.sourcePath.options.widthStrategy).toBe("source-pressure");
    expect(result.value.options.widthStrategy).toBe("source-pressure");
    expect(result.value.sourcePath.sourceSamples.map((sample) => ({
      pressure: sample.pressure,
      provenance: sample.pressureProvenance,
    }))).toEqual([
      {
        pressure: 0.2,
        provenance: {
          source: "canonical",
          sourceSequence: 0,
          inputPressure: 0.2,
          resolvedPressure: 0.2,
        },
      },
      {
        pressure: 0.8,
        provenance: {
          source: "canonical",
          sourceSequence: 1,
          inputPressure: 0.8,
          resolvedPressure: 0.8,
        },
      },
      {
        pressure: 0.4,
        provenance: {
          source: "canonical",
          sourceSequence: 2,
          inputPressure: 0.4,
          resolvedPressure: 0.4,
        },
      },
    ]);
    expect(result.value.settledWidths[0]).toBeCloseTo(2.4);
    expect(result.value.settledWidths.at(-1)).toBeCloseTo(4.8);
  });

  it("flattens cubics with both flatness and arc-length leaf limits", () => {
    const straight = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([0, 0, 12, 0], [0.2, 1]),
      options: {
        flatness: 0.01,
        maximumStationSpacing: 3,
      },
    });
    expectSuccess(straight);
    expect(straight.value.settledStations.length).toBeGreaterThanOrEqual(5);
    for (let index = 1; index < straight.value.settledStations.length; index += 1) {
      const left = straight.value.settledStations[index - 1]!;
      const right = straight.value.settledStations[index]!;
      expect(Math.hypot(right.x - left.x, right.y - left.y)).toBeLessThanOrEqual(3 + 1e-9);
    }

    const curved = adaptStudioVelocityBezierInkDrawElement({
      draw: draw(
        [0, 0, 8, 20, 16, -20, 24, 0],
        [0.2, 0.4, 0.7, 1],
      ),
      options: {
        flatness: 0.05,
        maximumStationSpacing: 100,
      },
    });
    expectSuccess(curved);
    expect(curved.value.settledStations.length).toBeGreaterThan(4);
  });

  it("interpolates pressure and width at the exact cubic parameter", () => {
    const result = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([0, 0, 8, 0], [0, 1], 20),
      options: {
        flatness: 0.01,
        maximumStationSpacing: 2,
      },
    });
    expectSuccess(result);

    const midpoint = result.value.settledStations.find(
      (station) => station.parameter === 0.5,
    );
    expect(midpoint).toMatchObject({
      pressure: 0.5,
      width: 10,
    });
    expect(result.value.settledPressures).toEqual(
      result.value.settledStations.map((station) => station.pressure),
    );
    expect(result.value.settledPoints).toEqual(
      result.value.settledStations.flatMap(({ x, y }) => [x, y]),
    );
  });

  it("keeps preview prefix immutable and exposes a replaceable bridge tail", () => {
    const first = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([0, 0, 8, 3, 16, 0], [0.2, 0.8, 0.4]),
      phase: "preview",
    });
    const appended = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([0, 0, 8, 3, 16, 0, 24, 5], [0.2, 0.8, 0.4, 1]),
      phase: "preview",
    });
    expectSuccess(first);
    expectSuccess(appended);

    expect(first.value.settledStations.length).toBeGreaterThan(0);
    expect(first.value.previewStations[0]?.bridge).toBe(true);
    expect(appended.value.settledStations.slice(
      0,
      first.value.settledStations.length,
    )).toEqual(first.value.settledStations);
    expect(Object.isFrozen(first.value.settledStations)).toBe(true);
    expect(Object.isFrozen(first.value.previewStations)).toBe(true);
  });

  it("seals identical preview geometry without retaining the duplicate bridge", () => {
    const source = draw(
      [0, 0, 5, 3, 11, 8, 19, 2, 27, 6],
      [0.15, 0.35, 0.8, 0.55, 1],
      14,
    );
    const preview = adaptStudioVelocityBezierInkDrawElement({
      draw: source,
      phase: "preview",
    });
    const committed = adaptStudioVelocityBezierInkDrawElement({
      draw: source,
      phase: "committed",
    });
    expectSuccess(preview);
    expectSuccess(committed);

    expect(combinedPreviewStations(preview.value).map((station) => ({
      x: station.x,
      y: station.y,
      pressure: station.pressure,
      width: station.width,
      distance: station.distance,
      parameter: station.parameter,
      segmentIndex: station.segmentIndex,
      ordinal: station.ordinal,
    }))).toEqual(committed.value.settledStations.map((station) => ({
      x: station.x,
      y: station.y,
      pressure: station.pressure,
      width: station.width,
      distance: station.distance,
      parameter: station.parameter,
      segmentIndex: station.segmentIndex,
      ordinal: station.ordinal,
    })));
    expect(committed.value.previewStations).toHaveLength(0);
  });

  it("supports tap and two-point strokes in preview and committed phases", () => {
    const tapPreview = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([4, 7], [0.3], 10),
      phase: "preview",
    });
    const tapCommitted = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([4, 7], [0.3], 10),
      phase: "committed",
    });
    const short = adaptStudioVelocityBezierInkDrawElement({
      draw: draw([4, 7, 10, 9], [0.3, 0.9], 10),
      phase: "committed",
    });
    expectSuccess(tapPreview);
    expectSuccess(tapCommitted);
    expectSuccess(short);

    expect(tapPreview.value.settledStations).toHaveLength(0);
    expect(tapPreview.value.previewStations[0]).toMatchObject({
      primitive: "tap",
      bridge: true,
      pressure: 0.3,
      width: 3,
    });
    expect(tapCommitted.value.settledStations[0]).toMatchObject({
      primitive: "tap",
      bridge: false,
    });
    expect(short.value.settledStations.length).toBeGreaterThan(1);
    expect(short.value.settledStations.at(-1)?.pressure).toBe(0.9);
  });

  it.each([
    [draw([0, 0, 1], [0.5]), "invalid-input"],
    [draw([0, 0, 1, 1], [0.5]), "invalid-input"],
    [draw([0, 0], [Number.NaN]), "invalid-input"],
    [draw([0, 0], [1.2]), "invalid-input"],
    [{ ...draw([0, 0], [0.5]), pressures: undefined }, "invalid-input"],
  ] as const)("rejects malformed DrawEl flat prefixes fail-closed: %o", (source, reason) => {
    expect(
      adaptStudioVelocityBezierInkDrawElement({ draw: source }),
    ).toEqual({ ok: false, reason });
  });

  it("fails closed when flatness depth or station budgets cannot be satisfied", () => {
    expect(
      adaptStudioVelocityBezierInkDrawElement({
        draw: draw([0, 0, 100, 100], [0.5, 0.5]),
        options: {
          flatness: 0.01,
          maximumStationSpacing: 0.01,
          maximumSubdivisionDepth: 1,
        },
      }),
    ).toEqual({ ok: false, reason: "flattening-limit" });
    expect(
      adaptStudioVelocityBezierInkDrawElement({
        draw: draw([0, 0, 100, 100], [0.5, 0.5]),
        options: {
          maximumStationSpacing: 1,
          maximumStations: 2,
        },
      }),
    ).toEqual({ ok: false, reason: "budget-exceeded" });
  });

  it("matches incremental stream seal with the complete batch plan exactly", () => {
    const source = draw(
      Array.from({ length: 80 }, (_, index) => [
        index * 1.25,
        Math.sin(index / 5) * 13,
      ]).flat(),
      Array.from({ length: 80 }, (_, index) => 0.2 + (index % 9) * 0.08),
      18,
      "stream-parity",
    );
    const options = {
      flatness: 0.12,
      maximumStationSpacing: 1.5,
      maximumSubdivisionDepth: 20,
    };
    const created = createStudioVelocityBezierInkStream({
      drawId: source.id,
      strokeWidth: source.strokeWidth,
      options,
    });
    expectSuccess(created);
    let state: StudioVelocityBezierInkStreamState = created.state;
    for (let start = 0; start < source.pressures!.length; start += 7) {
      const end = Math.min(source.pressures!.length, start + 7);
      const advanced = appendStudioVelocityBezierInkStream(state, {
        previousSourceSampleCount: state.sourceSampleCount,
        points: source.points.slice(start * 2, end * 2),
        pressures: source.pressures!.slice(start, end),
      });
      expectSuccess(advanced);
      state = advanced.state;
    }
    const sealed = sealStudioVelocityBezierInkStream(state);
    const batch = adaptStudioVelocityBezierInkDrawElement({
      draw: source,
      options,
      phase: "committed",
    });
    expectSuccess(sealed);
    expectSuccess(batch);

    expect(sealed.plan).toEqual(batch.value);
    expect(sealed.state.sealed).toBe(true);
    expect(
      appendStudioVelocityBezierInkStream(sealed.state, {
        previousSourceSampleCount: 80,
        points: [],
        pressures: [],
      }),
    ).toEqual({ ok: false, reason: "sealed-stream" });
  });

  it("rejects stale prefix receipts before admitting a stream suffix", () => {
    const created = createStudioVelocityBezierInkStream({
      drawId: "prefix",
      strokeWidth: 8,
    });
    expectSuccess(created);
    const first = appendStudioVelocityBezierInkStream(created.state, {
      previousSourceSampleCount: 0,
      points: [0, 0, 2, 1],
      pressures: [0.3, 0.6],
    });
    expectSuccess(first);
    expect(
      appendStudioVelocityBezierInkStream(first.state, {
        previousSourceSampleCount: 1,
        points: [4, 2],
        pressures: [0.7],
      }),
    ).toEqual({ ok: false, reason: "prefix-mismatch" });
    expect(first.state.sourceSampleCount).toBe(2);
  });

  it("keeps adapter snapshots immutable when a prior state is explicitly branched", () => {
    const created = createStudioVelocityBezierInkStream({
      drawId: "ink-branch",
      strokeWidth: 8,
    });
    expectSuccess(created);
    const trunk = appendStudioVelocityBezierInkStream(created.state, {
      previousSourceSampleCount: 0,
      points: [0, 0, 3, 1, 6, 3, 9, 1],
      pressures: [0.2, 0.4, 0.8, 0.5],
    });
    expectSuccess(trunk);
    const trunkPoints = [...trunk.plan.settledPoints];
    const forward = appendStudioVelocityBezierInkStream(trunk.state, {
      previousSourceSampleCount: 4,
      points: [12, 2, 15, 5],
      pressures: [0.7, 0.9],
    });
    expectSuccess(forward);
    const branch = appendStudioVelocityBezierInkStream(trunk.state, {
      previousSourceSampleCount: 4,
      points: [10, -4, 11, -8],
      pressures: [0.3, 0.1],
    });
    expectSuccess(branch);

    expect([...trunk.plan.settledPoints]).toEqual(trunkPoints);
    expect(forward.plan.previewPoints).not.toEqual(branch.plan.previewPoints);
    expect(forward.state.metrics.branchPrefixCopies).toBe(0);
    expect(branch.state.metrics.branchPrefixCopies).toBeGreaterThan(0);
    expect(Object.isFrozen(trunk.plan.settledPoints)).toBe(true);
  });

  it(
    "keeps long-stroke stream work near-linear and enforces the station budget",
    () => {
      const sampleCount = 32_768;
      const chunkSize = 512;
      const created = createStudioVelocityBezierInkStream({
        drawId: "long-ink",
        strokeWidth: 8,
        options: {
          flatness: 0.5,
          maximumStationSpacing: 2,
          maximumStations:
            STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxStations,
        },
      });
      expectSuccess(created);
      let state = created.state;
      let latestPlan = created.plan;
      const startedAt = performance.now();
      for (let offset = 0; offset < sampleCount; offset += chunkSize) {
        const count = Math.min(chunkSize, sampleCount - offset);
        const points: number[] = [];
        const pressures: number[] = [];
        for (let local = 0; local < count; local += 1) {
          const index = offset + local;
          points.push(index * 0.5, Math.sin(index / 19) * 4);
          pressures.push(0.25 + (index % 11) * 0.06);
        }
        const advanced = appendStudioVelocityBezierInkStream(state, {
          previousSourceSampleCount: state.sourceSampleCount,
          points,
          pressures,
        });
        expectSuccess(advanced);
        state = advanced.state;
        latestPlan = advanced.plan;
      }
      const elapsedMilliseconds = performance.now() - startedAt;
      const transitions = Math.ceil(sampleCount / chunkSize);

      expect(state.metrics.acceptedSourceSamples).toBe(sampleCount);
      expect(state.metrics.evaluatedCubicSegments).toBe(
        sampleCount - 2 + transitions,
      );
      expect(state.metrics.finalizerEvaluatedSegments).toBe(
        sampleCount - 2 + transitions,
      );
      expect(state.metrics.branchPrefixCopies).toBe(0);
      expect(state.metrics.emittedStationWork).toBeLessThan(sampleCount * 5);
      expect(
        latestPlan.settledStations.length + latestPlan.previewStations.length,
      ).toBeLessThanOrEqual(
        STUDIO_VELOCITY_BEZIER_INK_ADAPTER_BUDGETS.maxStations,
      );
      expect(elapsedMilliseconds).toBeLessThan(8_000);
    },
    15_000,
  );
});
