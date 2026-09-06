import { readFileSync } from "node:fs";
import Module from "node:module";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  createStudioEngineVectorGeometryProvider,
  type StudioEngineVectorGeometryArtifact,
  type StudioEngineVectorGeometryResult,
} from "./studio-engine-vector-geometry-provider";

interface NodeModuleLoader {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const nodeModuleLoader = Module as unknown as NodeModuleLoader;
const originalNodeModuleLoad = nodeModuleLoader._load;

// Paper's Node adapter opportunistically creates a jsdom canvas when jsdom happens to
// be installed. Geometry does not need one. Making that optional dependency unavailable
// exercises Paper's own canvas-free Node path, which is also its worker-style path.
beforeAll(() => {
  nodeModuleLoader._load = function loadWithoutOptionalJsdom(
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (request === "jsdom") throw new Error("Paper geometry test omits optional jsdom");
    return originalNodeModuleLoad.call(this, request, parent, isMain);
  };
});

afterAll(() => {
  nodeModuleLoader._load = originalNodeModuleLoad;
});

function requireArtifact(
  result: StudioEngineVectorGeometryResult,
): StudioEngineVectorGeometryArtifact {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail}`);
  return result.artifact;
}

const LEFT_CURVED_SHAPE = [
  "M 50 0",
  "C 77.614 0 100 22.386 100 50",
  "C 100 77.614 77.614 100 50 100",
  "C 22.386 100 0 77.614 0 50",
  "C 0 22.386 22.386 0 50 0",
  "Z",
].join(" ");

const RIGHT_CURVED_SHAPE = [
  "M 100 0",
  "C 127.614 0 150 22.386 150 50",
  "C 150 77.614 127.614 100 100 100",
  "C 72.386 100 50 77.614 50 50",
  "C 50 22.386 72.386 0 100 0",
  "Z",
].join(" ");

describe("StudioEngineVectorGeometryProvider", () => {
  it("stays cold for import, validation failures, and pre-import budget rejection", async () => {
    const provider = createStudioEngineVectorGeometryProvider({
      limits: { maxPathDataCodeUnits: 32, maxTotalPathDataCodeUnits: 64 },
    });

    expect(provider.getDiagnostics()).toMatchObject({
      phase: "cold",
      paperLoaded: false,
      createdProjectCount: 0,
    });
    await expect(provider.execute({
      operation: "parse",
      pathData: "M 0 0 L 1 1",
      legacyCanvasNode: {},
    })).resolves.toMatchObject({ ok: false, reason: "invalid-input" });
    await expect(provider.parseSvgPath(`M 0 0 L ${"1 ".repeat(40)}`)).resolves.toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
    expect(provider.getDiagnostics()).toMatchObject({
      phase: "cold",
      paperLoaded: false,
      createdProjectCount: 0,
      rejectedOperationCount: 2,
    });
  });

  it("parses cubic SVG path data into deterministic plain path data and bounds", async () => {
    const provider = createStudioEngineVectorGeometryProvider();
    const first = requireArtifact(await provider.parseSvgPath(LEFT_CURVED_SHAPE));
    const second = requireArtifact(await provider.parseSvgPath(LEFT_CURVED_SHAPE));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      kind: "studio-engine-vector-geometry",
      version: 1,
      operation: "parse",
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 100,
        maxY: 100,
        width: 100,
        height: 100,
      },
      curveCount: 4,
      subpathCount: 1,
      provider: {
        packageName: "paper",
        packageVersion: "0.12.18",
        role: "ephemeral-vector-geometry",
        sceneAuthority: false,
        vendorObjectsReturned: false,
      },
    });
    expect(first.pathData).toMatch(/[Cc]/);
    expect(first.pathData).not.toMatch(/,/);
    expect(first.contours).toHaveLength(1);
    expect(first.contours[0]).toMatchObject({ closed: true });
    expect(first.contours[0]!.points.length).toBeGreaterThan(8);
    expect(first.flattenedPointCount).toBe(first.contours[0]!.points.length / 2);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.bounds)).toBe(true);
    expect(Object.isFrozen(first.contours)).toBe(true);
    expect(Object.isFrozen(first.contours[0])).toBe(true);
    expect(Object.isFrozen(first.contours[0]!.points)).toBe(true);
    expect(Object.isFrozen(first.provider)).toBe(true);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));

    expect(provider.getDiagnostics()).toMatchObject({
      phase: "ready",
      activeProjectCount: 0,
      peakActiveProjectCount: 1,
      createdProjectCount: 2,
      removedProjectCount: 2,
      completedOperationCount: 2,
    });
    provider.dispose();
    expect(provider.getDiagnostics()).toMatchObject({
      phase: "disposed",
      activeProjectCount: 0,
      createdProjectCount: 2,
      removedProjectCount: 2,
    });
  });

  it("smooths and simplifies anchor paths into bounded cubic geometry", async () => {
    const provider = createStudioEngineVectorGeometryProvider();
    const polyline = [
      "M 0 0",
      "L 10 20",
      "L 20 -10",
      "L 30 20",
      "L 40 0",
      "L 50 10",
      "L 60 0",
    ].join(" ");
    const smoothed = requireArtifact(await provider.smoothPath(polyline, {
      type: "catmull-rom",
      factor: 0.5,
    }));
    const noisyLine = [
      "M 0 0",
      "L 5 0.2",
      "L 10 -0.1",
      "L 15 0.15",
      "L 20 -0.2",
      "L 25 0.1",
      "L 30 0",
      "L 35 -0.1",
      "L 40 0.2",
      "L 45 -0.15",
      "L 50 0.1",
      "L 55 -0.2",
      "L 60 0",
    ].join(" ");
    const simplified = requireArtifact(await provider.simplifyPath(noisyLine, 1));

    expect(smoothed.operation).toBe("smooth");
    expect(smoothed.pathData).toMatch(/[Cc]/);
    expect(smoothed.curveCount).toBe(6);
    expect(smoothed.contours).toHaveLength(1);
    expect(smoothed.contours[0]!.closed).toBe(false);
    expect(smoothed.flattenedPointCount).toBeGreaterThan(smoothed.curveCount);
    expect(smoothed.bounds.minY).toBeLessThan(-9);
    expect(smoothed.bounds.maxY).toBeGreaterThan(19);

    expect(simplified.operation).toBe("simplify");
    expect(simplified.pathData).toMatch(/[Cc]/);
    expect(simplified.curveCount).toBeLessThan(12);
    expect(simplified.bounds.minX).toBe(0);
    expect(simplified.bounds.maxX).toBe(60);
    expect(provider.getDiagnostics()).toMatchObject({
      activeProjectCount: 0,
      createdProjectCount: 2,
      removedProjectCount: 2,
    });
  });

  it.each([
    ["unite", { minX: 0, minY: 0, maxX: 150, maxY: 100 }],
    ["subtract", { minX: 0, minY: 0, maxX: 75, maxY: 100 }],
    ["intersect", { minX: 50, minY: 6.689, maxX: 100, maxY: 93.311 }],
    ["exclude", { minX: 0, minY: 0, maxX: 150, maxY: 100 }],
  ] as const)(
    "performs deterministic curved %s boolean geometry",
    async (operator, expectedBounds) => {
      const provider = createStudioEngineVectorGeometryProvider();
      const first = requireArtifact(
        await provider.booleanPath(operator, LEFT_CURVED_SHAPE, RIGHT_CURVED_SHAPE),
      );
      const second = requireArtifact(
        await provider.booleanPath(operator, LEFT_CURVED_SHAPE, RIGHT_CURVED_SHAPE),
      );

      expect(first).toEqual(second);
      expect(first.operation).toBe(operator);
      expect(first.curveCount).toBeGreaterThan(0);
      expect(first.pathData).toMatch(/[Cc]/);
      expect(first.contours).toHaveLength(first.subpathCount);
      expect(first.flattenedPointCount).toBe(
        first.contours.reduce((count, contour) => count + contour.points.length / 2, 0),
      );
      expect(first.bounds.minX).toBeCloseTo(expectedBounds.minX, 2);
      expect(first.bounds.minY).toBeCloseTo(expectedBounds.minY, 2);
      expect(first.bounds.maxX).toBeCloseTo(expectedBounds.maxX, 2);
      expect(first.bounds.maxY).toBeCloseTo(expectedBounds.maxY, 2);
      expect(provider.getDiagnostics()).toMatchObject({
        activeProjectCount: 0,
        createdProjectCount: 2,
        removedProjectCount: 2,
      });
    },
  );

  it("represents an empty boolean result explicitly without leaking a Paper item", async () => {
    const provider = createStudioEngineVectorGeometryProvider();
    const disjoint = "M 200 0 C 210 0 210 10 200 10 C 190 10 190 0 200 0 Z";
    const artifact = requireArtifact(
      await provider.booleanPath("intersect", LEFT_CURVED_SHAPE, disjoint),
    );

    expect(artifact).toMatchObject({
      operation: "intersect",
      pathData: "",
      empty: true,
      curveCount: 0,
      subpathCount: 0,
      contours: [],
      flattenedPointCount: 0,
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 },
    });
    expect(provider.getDiagnostics()).toMatchObject({
      activeProjectCount: 0,
      createdProjectCount: 1,
      removedProjectCount: 1,
    });
  });

  it("fails closed on curve-pair budgets, cancellation, malformed input, and disposal", async () => {
    const budgeted = createStudioEngineVectorGeometryProvider({
      limits: { maxBooleanCurvePairWorkUnits: 8 },
    });
    await expect(
      budgeted.booleanPath("unite", LEFT_CURVED_SHAPE, RIGHT_CURVED_SHAPE),
    ).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });
    expect(budgeted.getDiagnostics()).toMatchObject({
      activeProjectCount: 0,
      createdProjectCount: 1,
      removedProjectCount: 1,
    });

    const flattenedBudget = createStudioEngineVectorGeometryProvider({
      limits: { maxOutputFlattenedPoints: 2 },
    });
    await expect(
      flattenedBudget.parseSvgPath(LEFT_CURVED_SHAPE),
    ).resolves.toMatchObject({ ok: false, reason: "budget-exceeded" });
    expect(flattenedBudget.getDiagnostics()).toMatchObject({
      activeProjectCount: 0,
      createdProjectCount: 1,
      removedProjectCount: 1,
    });

    const provider = createStudioEngineVectorGeometryProvider();
    const controller = new AbortController();
    controller.abort();
    await expect(provider.parseSvgPath(LEFT_CURVED_SHAPE, {
      signal: controller.signal,
    })).resolves.toMatchObject({ ok: false, reason: "cancelled" });
    await expect(provider.parseSvgPath("M 0 0 <script>")).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });
    expect(provider.getDiagnostics().paperLoaded).toBe(false);

    provider.dispose();
    await expect(provider.parseSvgPath(LEFT_CURVED_SHAPE)).resolves.toMatchObject({
      ok: false,
      reason: "disposed",
    });
  });

  it("rejects adversarial flattening before Paper allocates any flattened segments", async () => {
    const paperModule = await import("paper");
    const flattenSpy = vi.spyOn(paperModule.default.Path.prototype, "flatten");
    try {
      const provider = createStudioEngineVectorGeometryProvider({
        limits: { maxOutputFlattenedPoints: 8 },
      });
      const highCurvatureLoop = [
        "M 0 0",
        "C 1000000 1000000 -1000000 1000000 0 0",
      ].join(" ");
      const compoundWithAdmittedPrefix = [
        "M 0 0 L 1 1",
        highCurvatureLoop,
      ].join(" ");

      await expect(provider.parseSvgPath(highCurvatureLoop)).resolves.toMatchObject({
        ok: false,
        reason: "budget-exceeded",
        detail: "Geometry result exceeds the flattened-point budget",
      });
      await expect(provider.parseSvgPath(compoundWithAdmittedPrefix)).resolves.toMatchObject({
        ok: false,
        reason: "budget-exceeded",
      });
      expect(flattenSpy).not.toHaveBeenCalled();
      expect(provider.getDiagnostics()).toMatchObject({
        activeProjectCount: 0,
        createdProjectCount: 2,
        removedProjectCount: 2,
        rejectedOperationCount: 2,
      });
    } finally {
      flattenSpy.mockRestore();
    }
  });

  it("keeps line-heavy paths at the exact flattened-point budget admitted", async () => {
    const pointBudget = 257;
    const linePath = [
      "M 0 0",
      ...Array.from({ length: pointBudget - 1 }, (_, index) => (
        `L ${index + 1} ${index % 2}`
      )),
    ].join(" ");
    const provider = createStudioEngineVectorGeometryProvider({
      limits: { maxOutputFlattenedPoints: pointBudget },
    });

    const artifact = requireArtifact(await provider.parseSvgPath(linePath));

    expect(artifact.flattenedPointCount).toBe(pointBudget);
    expect(artifact.contours).toHaveLength(1);
    expect(artifact.contours[0]!.points).toHaveLength(pointBudget * 2);
  });

  it("keeps the Paper boundary lazy and contains no Konva renderer dependency", () => {
    const geometrySource = readFileSync(
      new URL("./studio-engine-vector-geometry-provider.ts", import.meta.url),
      "utf8",
    );
    const spatialSource = readFileSync(
      new URL("./studio-engine-scene-spatial-index.ts", import.meta.url),
      "utf8",
    );

    expect(geometrySource).toContain('paperLibraryPromise ??= import("paper")');
    expect(geometrySource).toContain('import type paper from "paper"');
    expect(geometrySource).not.toMatch(/import\s+(?!type\b)[^;]*from\s+["']paper["']/);
    expect(geometrySource).toContain("this.scope.settings.insertItems = false");
    expect(geometrySource).toContain("removeProject(project)");

    for (const source of [geometrySource, spatialSource]) {
      expect(source).not.toMatch(/(?:react-)?konva/i);
    }
  });
});
