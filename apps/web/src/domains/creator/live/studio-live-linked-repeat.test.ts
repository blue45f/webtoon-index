import { describe, expect, it } from "vitest";

import {
  STUDIO_LINKED_REPEAT_MAX_INSTANCES,
  applyStudioLinkedRepeatParameterPatch,
  createStudioLinkedRepeatHandlePatch,
  expandStudioLinkedRepeat,
  planStudioLinkedRepeat,
  transformStudioLinkedRepeatPoint,
  type StudioLinkedRepeatGridParameters,
  type StudioLinkedRepeatMirrorParameters,
  type StudioLinkedRepeatRadialParameters,
  type StudioLinkedRepeatSource,
} from "./studio-live-linked-repeat";

interface PointGeometry {
  readonly points: readonly (readonly [number, number])[];
}

const pointSource: StudioLinkedRepeatSource<PointGeometry> = {
  id: "source-star",
  geometry: { points: [[0, 0], [2, 0], [1, 2]] },
};

const gridParameters: StudioLinkedRepeatGridParameters = {
  repeatId: "repeat-grid",
  mode: "grid",
  transformSpace: "global",
  rows: 2,
  columns: 3,
  spacingX: 20,
  spacingY: 30,
  gridType: "uniform",
  flipRows: "none",
  flipColumns: "none",
};

const radialParameters: StudioLinkedRepeatRadialParameters = {
  repeatId: "repeat-radial",
  mode: "radial",
  transformSpace: "global",
  count: 4,
  centerX: 100,
  centerY: 200,
  radius: 20,
  startAngleDegrees: 0,
  sweepAngleDegrees: 360,
  rotateInstances: true,
  reverseOverlap: false,
};

const mirrorParameters: StudioLinkedRepeatMirrorParameters = {
  repeatId: "repeat-mirror",
  mode: "mirror",
  transformSpace: "global",
  axisX: 10,
  axisY: 0,
  angleDegrees: 90,
  spacing: 0,
};

function expectPoint(
  point: readonly [number, number],
  expectedX: number,
  expectedY: number
): void {
  expect(point[0]).toBeCloseTo(expectedX, 10);
  expect(point[1]).toBeCloseTo(expectedY, 10);
}

describe("planStudioLinkedRepeat grid", () => {
  it("builds a deterministic row-major linked instance plan", () => {
    const first = planStudioLinkedRepeat(pointSource, gridParameters);
    const second = planStudioLinkedRepeat(pointSource, { ...gridParameters });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(first.value.instances).toHaveLength(6);
    expect(first.value.instances.map(({ logicalIndex, row, column, paintIndex }) => ({
      logicalIndex,
      row,
      column,
      paintIndex,
    }))).toEqual([
      { logicalIndex: 0, row: 0, column: 0, paintIndex: 0 },
      { logicalIndex: 1, row: 0, column: 1, paintIndex: 1 },
      { logicalIndex: 2, row: 0, column: 2, paintIndex: 2 },
      { logicalIndex: 3, row: 1, column: 0, paintIndex: 3 },
      { logicalIndex: 4, row: 1, column: 1, paintIndex: 4 },
      { logicalIndex: 5, row: 1, column: 2, paintIndex: 5 },
    ]);
    expectPoint(
      transformStudioLinkedRepeatPoint(2, 3, first.value.instances[5]!.transform),
      42,
      33
    );
    expect(first.value.instances.every((instance) => instance.sourceId === pointSource.id)).toBe(true);
    expect(first.value.instances.every((instance) => instance.linked)).toBe(true);
  });

  it("supports brick layouts plus independent alternating row and column flips", () => {
    const planned = planStudioLinkedRepeat(pointSource, {
      ...gridParameters,
      gridType: "brick-row",
      flipRows: "horizontal",
      flipColumns: "vertical",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const oddRow = planned.value.instances[3]!;
    const oddColumn = planned.value.instances[1]!;
    const oddRowAndColumn = planned.value.instances[4]!;
    expectPoint(transformStudioLinkedRepeatPoint(2, 3, oddRow.transform), 8, 33);
    expectPoint(transformStudioLinkedRepeatPoint(2, 3, oddColumn.transform), 22, -3);
    expectPoint(transformStudioLinkedRepeatPoint(2, 3, oddRowAndColumn.transform), 28, 27);
  });

  it("composes repeats after the source in global space and before it in local space", () => {
    const transformedSource: StudioLinkedRepeatSource<PointGeometry> = {
      ...pointSource,
      transform: { a: 2, b: 0, c: 0, d: 2, e: 5, f: 7 },
    };
    const global = planStudioLinkedRepeat(transformedSource, {
      ...gridParameters,
      rows: 1,
      columns: 2,
      spacingX: 10,
      transformSpace: "global",
    });
    const local = planStudioLinkedRepeat(transformedSource, {
      ...gridParameters,
      rows: 1,
      columns: 2,
      spacingX: 10,
      transformSpace: "local",
    });
    expect(global.ok && local.ok).toBe(true);
    if (!global.ok || !local.ok) return;

    expectPoint(transformStudioLinkedRepeatPoint(0, 0, global.value.instances[1]!.transform), 15, 7);
    expectPoint(transformStudioLinkedRepeatPoint(0, 0, local.value.instances[1]!.transform), 25, 7);
  });
});

describe("planStudioLinkedRepeat radial", () => {
  it("places a full circle without duplicating the first endpoint", () => {
    const planned = planStudioLinkedRepeat(pointSource, radialParameters);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.value.instances.map((instance) => instance.angleDegrees)).toEqual([
      0,
      90,
      180,
      270,
    ]);
    const origins = planned.value.instances.map((instance) => (
      transformStudioLinkedRepeatPoint(0, 0, instance.transform)
    ));
    expectPoint(origins[0]!, 120, 200);
    expectPoint(origins[1]!, 100, 220);
    expectPoint(origins[2]!, 80, 200);
    expectPoint(origins[3]!, 100, 180);
    expectPoint(
      transformStudioLinkedRepeatPoint(2, 0, planned.value.instances[1]!.transform),
      100,
      222
    );
  });

  it("includes both endpoints for partial and clockwise arcs", () => {
    const planned = planStudioLinkedRepeat(pointSource, {
      ...radialParameters,
      count: 3,
      startAngleDegrees: 90,
      sweepAngleDegrees: -180,
      rotateInstances: false,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.instances.map((instance) => instance.angleDegrees)).toEqual([90, 0, -90]);
    expectPoint(
      transformStudioLinkedRepeatPoint(0, 0, planned.value.instances[2]!.transform),
      100,
      180
    );
  });

  it("reverses painter overlap without changing stable logical ids", () => {
    const normal = planStudioLinkedRepeat(pointSource, radialParameters);
    const reversed = planStudioLinkedRepeat(pointSource, {
      ...radialParameters,
      reverseOverlap: true,
    });
    expect(normal.ok && reversed.ok).toBe(true);
    if (!normal.ok || !reversed.ok) return;

    expect(normal.value.instances.map((instance) => instance.logicalIndex)).toEqual([0, 1, 2, 3]);
    expect(reversed.value.instances.map((instance) => instance.logicalIndex)).toEqual([3, 2, 1, 0]);
    expect(reversed.value.instances.map((instance) => instance.paintIndex)).toEqual([0, 1, 2, 3]);
    expect(reversed.value.instances[0]!.id).toBe("repeat-radial:instance:3");
  });

  it("places document-space radial anchors exactly even when the source is translated", () => {
    const planned = planStudioLinkedRepeat({
      ...pointSource,
      transform: { a: 2, b: 0, c: 0, d: 2, e: 500, f: -300 },
    }, {
      ...radialParameters,
      count: 2,
      centerX: 10,
      centerY: 20,
      radius: 5,
      startAngleDegrees: 0,
      sweepAngleDegrees: 180,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expectPoint(
      transformStudioLinkedRepeatPoint(0, 0, planned.value.instances[0]!.transform),
      15,
      20
    );
    expectPoint(
      transformStudioLinkedRepeatPoint(0, 0, planned.value.instances[1]!.transform),
      5,
      20
    );
  });
});

describe("planStudioLinkedRepeat mirror", () => {
  it("reflects around an arbitrary axis while retaining the linked source half", () => {
    const planned = planStudioLinkedRepeat(pointSource, mirrorParameters);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    expect(planned.value.instances).toHaveLength(2);
    expect(planned.value.instances.map((instance) => instance.reflected)).toEqual([false, true]);
    expectPoint(
      transformStudioLinkedRepeatPoint(4, 3, planned.value.instances[0]!.transform),
      4,
      3
    );
    expectPoint(
      transformStudioLinkedRepeatPoint(4, 3, planned.value.instances[1]!.transform),
      16,
      3
    );
  });

  it("applies mirror spacing along the axis normal", () => {
    const planned = planStudioLinkedRepeat(pointSource, {
      ...mirrorParameters,
      axisX: 0,
      angleDegrees: 0,
      spacing: 5,
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expectPoint(
      transformStudioLinkedRepeatPoint(2, 3, planned.value.instances[1]!.transform),
      2,
      2
    );
  });
});

describe("linked repeat parameter patches", () => {
  it("creates reversible coalescible handle patches without mutating input", () => {
    const before = structuredClone(radialParameters);
    const patch = createStudioLinkedRepeatHandlePatch(radialParameters, {
      kind: "radial-arc",
      centerX: 140,
      centerY: 210,
      startAngleDegrees: 15,
      sweepAngleDegrees: 180,
    });
    expect(patch.ok).toBe(true);
    if (!patch.ok) return;

    expect(patch.value.changedFields).toEqual([
      "centerX",
      "centerY",
      "startAngleDegrees",
      "sweepAngleDegrees",
    ]);
    expect(patch.value.coalesceKey).toBe("repeat-radial:handle:radial-arc");
    expect(patch.value.forward).toEqual({
      centerX: 140,
      centerY: 210,
      startAngleDegrees: 15,
      sweepAngleDegrees: 180,
    });
    expect(radialParameters).toEqual(before);

    const redone = applyStudioLinkedRepeatParameterPatch(radialParameters, patch.value, "forward");
    expect(redone.ok).toBe(true);
    if (!redone.ok) return;
    expect(redone.value).toEqual(patch.value.after);
    const undone = applyStudioLinkedRepeatParameterPatch(redone.value, patch.value, "inverse");
    expect(undone).toEqual({ ok: true, value: patch.value.before });
  });

  it("supports common transform-space patches and reports no-op handle moves", () => {
    const transformPatch = createStudioLinkedRepeatHandlePatch(gridParameters, {
      kind: "transform-space",
      transformSpace: "local",
    });
    const noOp = createStudioLinkedRepeatHandlePatch(gridParameters, {
      kind: "grid-spacing",
      spacingX: gridParameters.spacingX,
      spacingY: gridParameters.spacingY,
    });
    expect(transformPatch.ok && noOp.ok).toBe(true);
    if (!transformPatch.ok || !noOp.ok) return;
    expect(transformPatch.value.changedFields).toEqual(["transformSpace"]);
    expect(noOp.value.changedFields).toEqual([]);
    expect(noOp.value.forward).toEqual({});
    expect(noOp.value.inverse).toEqual({});
  });

  it("fails closed for cross-mode handles and stale history", () => {
    const mismatch = createStudioLinkedRepeatHandlePatch(gridParameters, {
      kind: "radial-radius",
      radius: 50,
    });
    expect(mismatch).toMatchObject({
      ok: false,
      error: { code: "handle-mode-mismatch" },
    });

    const patch = createStudioLinkedRepeatHandlePatch(gridParameters, {
      kind: "grid-spacing",
      spacingX: 40,
      spacingY: 50,
    });
    expect(patch.ok).toBe(true);
    if (!patch.ok) return;
    const stale = applyStudioLinkedRepeatParameterPatch(
      { ...gridParameters, spacingX: 99 },
      patch.value,
      "forward"
    );
    expect(stale).toMatchObject({ ok: false, error: { code: "patch-mismatch" } });
  });
});

describe("linked repeat validation", () => {
  it("rejects grid and radial instance-budget overruns before allocation", () => {
    const grid = planStudioLinkedRepeat(pointSource, {
      ...gridParameters,
      rows: STUDIO_LINKED_REPEAT_MAX_INSTANCES,
      columns: 2,
    });
    const radial = planStudioLinkedRepeat(pointSource, {
      ...radialParameters,
      count: 5,
    }, { maxInstances: 4 });
    expect(grid).toMatchObject({
      ok: false,
      error: { code: "instance-budget-exceeded" },
    });
    expect(radial).toMatchObject({
      ok: false,
      error: { code: "instance-budget-exceeded" },
    });
  });

  it("rejects non-finite parameters, unsafe options, and singular source transforms", () => {
    expect(planStudioLinkedRepeat(pointSource, {
      ...radialParameters,
      radius: Number.NaN,
    })).toMatchObject({ ok: false, error: { code: "invalid-parameter", field: "radius" } });
    expect(planStudioLinkedRepeat(pointSource, gridParameters, {
      maxInstances: STUDIO_LINKED_REPEAT_MAX_INSTANCES + 1,
    })).toMatchObject({ ok: false, error: { code: "invalid-option" } });
    expect(planStudioLinkedRepeat({
      ...pointSource,
      transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 },
    }, gridParameters)).toMatchObject({
      ok: false,
      error: { code: "transform-overflow" },
    });
  });

  it("rejects zero sweep for stacked multi-instance radial input", () => {
    expect(planStudioLinkedRepeat(pointSource, {
      ...radialParameters,
      sweepAngleDegrees: 0,
    })).toMatchObject({
      ok: false,
      error: { code: "invalid-parameter", field: "sweepAngleDegrees" },
    });
  });
});

describe("expandStudioLinkedRepeat", () => {
  it("bakes every transform into independent geometry and breaks the source link", () => {
    const plan = planStudioLinkedRepeat(pointSource, {
      ...gridParameters,
      rows: 1,
      columns: 2,
      spacingX: 10,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const expanded = expandStudioLinkedRepeat(
      pointSource,
      plan.value,
      (geometry, transform) => ({
        points: geometry.points.map(([x, y]) => transformStudioLinkedRepeatPoint(x, y, transform)),
      })
    );
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;

    expect(expanded.value.objects.map(({ id, linked }) => ({ id, linked }))).toEqual([
      { id: "repeat-grid:expanded:0", linked: false },
      { id: "repeat-grid:expanded:1", linked: false },
    ]);
    expect(expanded.value.objects[0]!.geometry).not.toBe(pointSource.geometry);
    expect(expanded.value.objects[1]!.geometry).not.toBe(expanded.value.objects[0]!.geometry);
    expect(expanded.value.objects[0]!.geometry.points).toEqual([[0, 0], [2, 0], [1, 2]]);
    expect(expanded.value.objects[1]!.geometry.points).toEqual([[10, 0], [12, 0], [11, 2]]);
    expect(pointSource.geometry.points).toEqual([[0, 0], [2, 0], [1, 2]]);
  });

  it("uses current linked source geometry while the transform plan remains stable", () => {
    const plan = planStudioLinkedRepeat(pointSource, {
      ...gridParameters,
      rows: 1,
      columns: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const editedSource: StudioLinkedRepeatSource<PointGeometry> = {
      ...pointSource,
      geometry: { points: [[5, 6]] },
    };
    const expanded = expandStudioLinkedRepeat(
      editedSource,
      plan.value,
      (geometry, transform) => ({
        points: geometry.points.map(([x, y]) => transformStudioLinkedRepeatPoint(x, y, transform)),
      })
    );
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;
    expect(expanded.value.objects[0]!.geometry.points).toEqual([[5, 6]]);
  });

  it("returns no partial output when an adapter throws or aliases geometry", () => {
    const plan = planStudioLinkedRepeat(pointSource, {
      ...gridParameters,
      rows: 1,
      columns: 2,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const thrown = expandStudioLinkedRepeat(pointSource, plan.value, (_geometry, _transform, instance) => {
      if (instance.logicalIndex === 1) throw new Error("synthetic adapter failure");
      return { points: [] };
    });
    const aliased = expandStudioLinkedRepeat(
      pointSource,
      plan.value,
      (geometry) => geometry
    );
    const sharedGeometry: PointGeometry = { points: [] };
    const reused = expandStudioLinkedRepeat(
      pointSource,
      plan.value,
      () => sharedGeometry
    );
    expect(thrown).toMatchObject({
      ok: false,
      error: { code: "geometry-expansion-failed" },
    });
    expect(aliased).toMatchObject({ ok: false, error: { code: "geometry-alias" } });
    expect(reused).toMatchObject({ ok: false, error: { code: "geometry-alias" } });
  });

  it("requires replanning after the linked source transform changes", () => {
    const plan = planStudioLinkedRepeat(pointSource, gridParameters);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const changedSource = {
      ...pointSource,
      transform: { a: 1, b: 0, c: 0, d: 1, e: 1, f: 0 },
    };
    expect(expandStudioLinkedRepeat(
      changedSource,
      plan.value,
      (geometry) => ({ points: [...geometry.points] })
    )).toMatchObject({
      ok: false,
      error: { code: "source-mismatch", field: "source.transform" },
    });
  });
});
