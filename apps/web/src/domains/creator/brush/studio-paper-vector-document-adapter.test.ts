import Module from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  refineStudioDrawElementWithPaper,
  studioPaperVectorDocumentIneligibilityReason,
} from "./studio-paper-vector-document-adapter";
import {
  createStudioPaperVectorRefinementProvider,
  type StudioPaperVectorRefinementProvider,
} from "./studio-paper-vector-refinement-provider";

import type { DrawEl } from "../studio-element-model";

interface NodeModuleLoader {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const nodeModuleLoader = Module as unknown as NodeModuleLoader;
const originalNodeModuleLoad = nodeModuleLoader._load;

beforeAll(() => {
  nodeModuleLoader._load = function loadWithoutOptionalJsdom(
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (request === "jsdom") {
      throw new Error("Paper document adapter test omits optional jsdom");
    }
    return originalNodeModuleLoad.call(this, request, parent, isMain);
  };
});

afterAll(() => {
  nodeModuleLoader._load = originalNodeModuleLoad;
});

function provider(engineEpoch = 3): StudioPaperVectorRefinementProvider {
  const result = createStudioPaperVectorRefinementProvider({ engineEpoch });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.reason);
  return result.provider;
}

function draw(overrides: Partial<DrawEl> = {}): DrawEl {
  return {
    id: "stroke-1",
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [0, 0, 10, 10, 20, 0, 30, 10, 40, 0, 50, 10, 60, 0],
    stroke: "#102030",
    strokeWidth: 7,
    brush: "gpen",
    ...overrides,
  };
}

describe("studio Paper vector document adapter", () => {
  it("deterministically refines one open polyline and remaps pointer metadata by arc length", async () => {
    const refinementProvider = provider();
    const brushTip = { tiltEnabled: true, angleDeg: 23, roundness: 0.62 };
    const strokeStyle = {
      dash: "solid" as const,
      lineCap: "round" as const,
      arrowStart: "none" as const,
      arrowEnd: "none" as const,
    };
    const source = draw({
      name: "ink layer",
      groupId: "group-a",
      locked: true,
      opacity: 0.82,
      blendMode: "multiply",
      brushCatalogId: "core:gpen",
      brushCatalogName: "G pen",
      brushTip,
      strokeStyle,
      pressures: [0.1, 0.25, 0.4, 0.55, 0.7, 0.8, 0.9],
      tiltXs: [-30, -20, -10, 0, 10, 20, 30],
      tiltYs: [20, 15, 10, 5, 0, -5, -10],
      twists: [350, 355, 0, 5, 10, 15, 20],
      tangentialPressures: [-0.5, -0.25, 0, 0.25, 0.5, 0.25, 0],
      speeds: [1, 2, 3, 4, 5, 6, 7],
    });

    const first = await refineStudioDrawElementWithPaper({
      element: source,
      provider: refinementProvider,
      requestSequence: 1,
      engineEpoch: 3,
      refinement: { kind: "simplify", tolerance: 1 },
    });
    const second = await refineStudioDrawElementWithPaper({
      element: source,
      provider: refinementProvider,
      requestSequence: 2,
      engineEpoch: 3,
      refinement: { kind: "simplify", tolerance: 1 },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Expected successful refinements");
    expect(first.replacement).toEqual(second.replacement);
    expect(first.replacement).not.toBe(source);
    expect(first.replacement.points).not.toBe(source.points);
    expect(first.replacement.points.length).toBeGreaterThanOrEqual(4);
    expect(first.replacement.points.length % 2).toBe(0);
    expect(first.replacement.points.slice(0, 2)).toEqual([0, 0]);
    expect(first.replacement.points.slice(-2)).toEqual([60, 0]);

    const outputPointCount = first.replacement.points.length / 2;
    expect(first.replacement.pressures).toHaveLength(outputPointCount);
    expect(first.replacement.tiltXs).toHaveLength(outputPointCount);
    expect(first.replacement.tiltYs).toHaveLength(outputPointCount);
    expect(first.replacement.twists).toHaveLength(outputPointCount);
    expect(first.replacement.tangentialPressures).toHaveLength(outputPointCount);
    expect(first.replacement.pressures?.[0]).toBe(0.1);
    expect(first.replacement.pressures?.at(-1)).toBe(0.9);
    expect(first.replacement.twists?.every((value) => value >= 0 && value < 360)).toBe(true);
    expect(first.replacement.speeds).toBeUndefined();

    expect(first.replacement).toMatchObject({
      id: "stroke-1",
      name: "ink layer",
      groupId: "group-a",
      locked: true,
      opacity: 0.82,
      blendMode: "multiply",
      brushCatalogId: "core:gpen",
      brushCatalogName: "G pen",
      stroke: "#102030",
      strokeWidth: 7,
      brush: "gpen",
    });
    expect(first.replacement.brushTip).toBe(brushTip);
    expect(first.replacement.strokeStyle).toBe(strokeStyle);
    expect(source.speeds).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(source.points).toEqual([0, 0, 10, 10, 20, 0, 30, 10, 40, 0, 50, 10, 60, 0]);
  });

  it("accepts bounded smoothing but rejects geometry-changing brush semantics before Paper loads", async () => {
    const refinementProvider = provider();
    const smoothed = await refineStudioDrawElementWithPaper({
      element: draw({ brush: "marker" }),
      provider: refinementProvider,
      requestSequence: 1,
      engineEpoch: 3,
      refinement: {
        kind: "smooth",
        smoothing: { type: "catmull-rom", factor: 0.5 },
      },
    });
    expect(smoothed.ok).toBe(true);
    if (!smoothed.ok) throw new Error(smoothed.detail);
    expect(smoothed.replacement.points.length).toBeGreaterThan(4);

    const coldProvider = provider();
    const rejectedElements = [
      draw({ kind: "rect" }),
      draw({ mode: "eraser" }),
      draw({ fill: "#fff" }),
      draw({
        symmetry: {
          type: "vertical",
          centerX: 50,
          centerY: 50,
        },
      }),
      draw({ brush: "watercolor" }),
      draw({
        brush: "gpen",
        brushDynamics: {
          version: 1,
        } as DrawEl["brushDynamics"],
      }),
    ];
    for (const [index, element] of rejectedElements.entries()) {
      expect(studioPaperVectorDocumentIneligibilityReason(element)).not.toBeNull();
      await expect(refineStudioDrawElementWithPaper({
        element,
        provider: coldProvider,
        requestSequence: index + 1,
        engineEpoch: 3,
        refinement: { kind: "simplify", tolerance: 1 },
      })).resolves.toMatchObject({
        ok: false,
        reason: "ineligible-element",
      });
    }
    expect(coldProvider.snapshot()).toMatchObject({
      phase: "cold",
      paperLoaded: false,
      completed: 0,
      rejected: 0,
    });
  });

  it("fails closed for degenerate input and input/output geometry budgets", async () => {
    const refinementProvider = provider();

    await expect(refineStudioDrawElementWithPaper({
      element: draw({ points: [5, 5, 5, 5, 5, 5] }),
      provider: refinementProvider,
      requestSequence: 1,
      engineEpoch: 3,
      refinement: { kind: "simplify", tolerance: 1 },
    })).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });

    await expect(refineStudioDrawElementWithPaper({
      element: draw({ points: [0, 0, 10] }),
      provider: refinementProvider,
      requestSequence: 2,
      engineEpoch: 3,
      refinement: { kind: "simplify", tolerance: 1 },
    })).resolves.toMatchObject({
      ok: false,
      reason: "invalid-input",
    });

    await expect(refineStudioDrawElementWithPaper({
      element: draw({ points: [0, 0, 10, 10, 20, 0] }),
      provider: refinementProvider,
      requestSequence: 3,
      engineEpoch: 3,
      refinement: { kind: "simplify", tolerance: 1 },
      limits: { maxInputPoints: 2 },
    })).resolves.toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });

    await expect(refineStudioDrawElementWithPaper({
      element: draw(),
      provider: refinementProvider,
      requestSequence: 4,
      engineEpoch: 3,
      refinement: {
        kind: "smooth",
        smoothing: { type: "catmull-rom", factor: 0.5 },
      },
      limits: { maxOutputPoints: 2 },
    })).resolves.toMatchObject({
      ok: false,
      reason: "budget-exceeded",
    });
  });

  it("propagates provider budget rejection without returning a partial replacement", async () => {
    const creation = createStudioPaperVectorRefinementProvider({
      engineEpoch: 3,
      limits: { maxOutputFlattenedPoints: 2 },
    });
    expect(creation.status).toBe("ready");
    if (creation.status !== "ready") throw new Error(creation.reason);

    await expect(refineStudioDrawElementWithPaper({
      element: draw(),
      provider: creation.provider,
      requestSequence: 1,
      engineEpoch: 3,
      refinement: {
        kind: "smooth",
        smoothing: { type: "catmull-rom", factor: 0.5 },
      },
    })).resolves.toMatchObject({
      ok: false,
      reason: "budget-exceeded",
      providerReason: "budget-exceeded",
    });
  });
});
