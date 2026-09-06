import { readFileSync } from "node:fs";
import Module from "node:module";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createStudioPaperVectorRefinementProvider,
  STUDIO_PAPER_VECTOR_REFINEMENT_CAPABILITIES,
  type StudioPaperVectorRefinementArtifact,
  type StudioPaperVectorRefinementCommand,
  type StudioPaperVectorRefinementProvider,
  type StudioPaperVectorRefinementRequest,
  type StudioPaperVectorRefinementResult,
} from "./studio-paper-vector-refinement-provider";

interface NodeModuleLoader {
  _load(request: string, parent: unknown, isMain: boolean): unknown;
}

const nodeModuleLoader = Module as unknown as NodeModuleLoader;
const originalNodeModuleLoad = nodeModuleLoader._load;

// Paper's Node adapter opportunistically selects jsdom when it is installed.
// Vector geometry needs no canvas, so exercise Paper's own canvas-free path.
beforeAll(() => {
  nodeModuleLoader._load = function loadWithoutOptionalJsdom(
    request: string,
    parent: unknown,
    isMain: boolean,
  ): unknown {
    if (request === "jsdom") {
      throw new Error("Paper refinement test omits optional jsdom");
    }
    return originalNodeModuleLoad.call(this, request, parent, isMain);
  };
});

afterAll(() => {
  nodeModuleLoader._load = originalNodeModuleLoad;
});

const NOISY_LINE = [
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

const LEFT_RECTANGLE = "M 0 0 L 100 0 L 100 100 L 0 100 Z";
const RIGHT_RECTANGLE = "M 50 0 L 150 0 L 150 100 L 50 100 Z";

function provider(
  options: Readonly<{
    engineEpoch?: number;
    limits?: Readonly<Record<string, number>>;
  }> = {},
): StudioPaperVectorRefinementProvider {
  const result = createStudioPaperVectorRefinementProvider({
    engineEpoch: options.engineEpoch ?? 4,
    limits: options.limits,
  });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error(result.reason);
  return result.provider;
}

function request(
  command: StudioPaperVectorRefinementCommand,
  overrides: Partial<StudioPaperVectorRefinementRequest> = {},
): StudioPaperVectorRefinementRequest {
  return {
    kind: "studio-paper-vector-refinement/request",
    version: 1,
    requestSequence: 1,
    engineEpoch: 4,
    stage: "settled",
    command,
    ...overrides,
  };
}

function artifact(
  result: StudioPaperVectorRefinementResult,
): StudioPaperVectorRefinementArtifact {
  expect(result.status).toBe("completed");
  if (result.status !== "completed") throw new Error(result.reason);
  return result.artifact;
}

describe("StudioPaperVectorRefinementProvider", () => {
  it("rejects invalid options without constructing a provider", () => {
    expect(createStudioPaperVectorRefinementProvider(null)).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
    expect(createStudioPaperVectorRefinementProvider({
      engineEpoch: -1,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
    expect(createStudioPaperVectorRefinementProvider({
      engineEpoch: 0,
      legacySceneAuthority: true,
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
    expect(createStudioPaperVectorRefinementProvider({
      engineEpoch: 0,
      limits: { maxPathDataCodeUnits: 0 },
    })).toEqual({
      status: "rejected",
      reason: "invalid-options",
      path: "options",
    });
  });

  it("produces deterministic serializable simplify artifacts and receipts", async () => {
    const refinement = provider();
    const first = artifact(await refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    })));
    const second = artifact(await refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }, {
      requestSequence: 2,
    })));

    expect(first.pathData).toBe(second.pathData);
    expect(first.contours).toEqual(second.contours);
    expect(first.curveCount).toBeLessThan(12);
    expect(first.receipt.inputFingerprint).toBe(
      second.receipt.inputFingerprint,
    );
    expect(first.receipt.outputFingerprint).toBe(
      second.receipt.outputFingerprint,
    );
    expect(first.receipt.replayFingerprint).toBe(
      second.receipt.replayFingerprint,
    );
    expect(first.receipt).toMatchObject({
      command: "simplify",
      requestSequence: 1,
      engineEpoch: 4,
      package: { name: "paper", version: "0.12.18" },
      execution: {
        stage: "settled",
        geometryBoundary: "studio-engine-vector-geometry-provider",
        project: "ephemeral-isolated",
        dynamicImport: true,
      },
      authority: {
        mainScene: false,
        document: false,
        history: false,
        persistence: false,
        output: "settled-vector-refinement-suggestion",
      },
      budget: {
        inputPathDataCodeUnits: NOISY_LINE.length,
        outputPathDataCodeUnits: first.pathData.length,
        outputCurveCount: first.curveCount,
        outputSubpathCount: 1,
        outputFlattenedPointCount: first.contours[0]!.points.length / 2,
        delegatedPathNumberCurveAndWorkBudgets: true,
      },
      capabilitiesUsed: [
        "refine:simplify",
        "execution:settled-only",
        "project:ephemeral-isolated",
        "output:serializable-svg-path-data",
        "output:frozen-flattened-contours",
        "authority:none",
      ],
      complete: true,
    });
    expect(first.receipt.inputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.receipt.outputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.receipt.replayFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.bounds)).toBe(true);
    expect(Object.isFrozen(first.contours)).toBe(true);
    expect(Object.isFrozen(first.contours[0])).toBe(true);
    expect(Object.isFrozen(first.contours[0]!.points)).toBe(true);
    expect(Object.isFrozen(first.receipt)).toBe(true);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(
      /PaperScope|Project|PathItem|Segment/u,
    );
    expect(refinement.snapshot()).toMatchObject({
      phase: "ready",
      engineEpoch: 4,
      active: false,
      paperLoaded: true,
      activeProjectCount: 0,
      completed: 2,
      rejected: 0,
      authority: "none",
      execution: "settled-only",
    });
  });

  it("snapshots mutable caller commands before delegated async execution", async () => {
    const refinement = provider();
    const mutableCommand: {
      kind: "simplify";
      pathData: string;
      tolerance: number;
    } = {
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    };
    const pending = refinement.refine(request(mutableCommand));

    mutableCommand.pathData = "M 0 0 L 500 500 L 1000 0";
    mutableCommand.tolerance = 8;

    const completed = artifact(await pending);
    const replay = artifact(await refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }, {
      requestSequence: 2,
    })));

    expect(completed.pathData).toBe(replay.pathData);
    expect(completed.receipt.inputFingerprint).toBe(
      replay.receipt.inputFingerprint,
    );
    expect(completed.receipt.budget.inputPathDataCodeUnits).toBe(
      NOISY_LINE.length,
    );
  });

  it("supports bounded smoothing and the four admitted boolean operations", async () => {
    const refinement = provider();
    const smoothed = artifact(await refinement.refine(request({
      kind: "smooth",
      pathData: "M 0 0 L 10 20 L 20 -10 L 30 20 L 40 0",
      smoothing: { type: "catmull-rom", factor: 0.5 },
    })));
    expect(smoothed.pathData).toMatch(/[Cc]/u);
    expect(smoothed.receipt.command).toBe("smooth");

    for (const [index, operator] of [
      "unite",
      "subtract",
      "intersect",
      "exclude",
    ].entries()) {
      const booleanArtifact = artifact(await refinement.refine(request({
        kind: "boolean",
        operator: operator as "unite" | "subtract" | "intersect" | "exclude",
        leftPathData: LEFT_RECTANGLE,
        rightPathData: RIGHT_RECTANGLE,
      }, {
        requestSequence: index + 2,
      })));
      expect(booleanArtifact.receipt.command).toBe(operator);
      expect(booleanArtifact.receipt.capabilitiesUsed).toContain(
        `boolean:${operator}`,
      );
      expect(booleanArtifact.subpathCount).toBeGreaterThan(0);
    }
  });

  it("returns explicit serializable empty geometry for disjoint intersection", async () => {
    const refinement = provider();
    const result = artifact(await refinement.refine(request({
      kind: "boolean",
      operator: "intersect",
      leftPathData: LEFT_RECTANGLE,
      rightPathData: "M 200 0 L 300 0 L 300 100 L 200 100 Z",
    })));

    expect(result).toMatchObject({
      pathData: "",
      empty: true,
      curveCount: 0,
      subpathCount: 0,
      contours: [],
      bounds: {
        minX: 0,
        minY: 0,
        maxX: 0,
        maxY: 0,
        width: 0,
        height: 0,
      },
    });
    expect(result.receipt.budget.outputFlattenedPointCount).toBe(0);
    expect(result.receipt.outputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("delegates path, point/curve, memory and boolean-work budgets fail closed", async () => {
    const refinement = provider({
      limits: {
        maxPathDataCodeUnits: 32,
        maxTotalPathDataCodeUnits: 64,
        maxInputNumbersPerPath: 12,
        maxInputCurvesPerPath: 4,
        maxBooleanCurvePairWorkUnits: 4,
        maxOutputPathDataCodeUnits: 64,
        maxOutputCurves: 8,
      },
    });

    await expect(refinement.refine(request({
      kind: "simplify",
      pathData: `M 0 0 ${"L 1 1 ".repeat(10)}`,
      tolerance: 1,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      consumed: false,
    });
    expect(refinement.snapshot()).toMatchObject({
      phase: "cold",
      paperLoaded: false,
      activeProjectCount: 0,
      completed: 0,
      rejected: 1,
    });

    const flattenedBudget = provider({
      limits: {
        maxOutputFlattenedPoints: 2,
      },
    });
    await expect(flattenedBudget.refine(request({
      kind: "smooth",
      pathData: "M 0 0 L 10 20 L 20 -10 L 30 20 L 40 0",
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "budget-exceeded",
      consumed: false,
    });
  });

  it("rejects live, malformed and unsupported flatten commands before Paper loads", async () => {
    const refinement = provider();
    await expect(refinement.refine({
      ...request({
        kind: "simplify",
        pathData: NOISY_LINE,
        tolerance: 1,
      }),
      stage: "live",
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "live-stage-forbidden",
    });
    await expect(refinement.refine(request({
      kind: "smooth",
      pathData: NOISY_LINE,
      smoothing: { type: "catmull-rom", factor: 2 },
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-request",
    });
    await expect(refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }, {
      command: {
        kind: "flatten",
        pathData: NOISY_LINE,
        flatness: 0.25,
      } as unknown as StudioPaperVectorRefinementCommand,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "unsupported-command",
    });
    await expect(refinement.refine({
      ...request({
        kind: "simplify",
        pathData: NOISY_LINE,
        tolerance: 1,
      }),
      legacyHistoryAuthority: true,
    })).resolves.toMatchObject({
      status: "rejected",
      reason: "invalid-request",
    });
    expect(refinement.snapshot()).toMatchObject({
      phase: "cold",
      paperLoaded: false,
      activeProjectCount: 0,
      completed: 0,
      rejected: 4,
    });
  });

  it("applies fail-fast backpressure while one refinement is active", async () => {
    const refinement = provider();
    const first = refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }));
    const second = refinement.refine(request({
      kind: "smooth",
      pathData: NOISY_LINE,
    }, {
      requestSequence: 2,
    }));

    await expect(second).resolves.toMatchObject({
      status: "rejected",
      reason: "backpressure",
      consumed: false,
    });
    await expect(first).resolves.toMatchObject({
      status: "completed",
      consumed: false,
    });
    expect(refinement.snapshot()).toMatchObject({
      active: false,
      completed: 1,
      rejected: 1,
      activeProjectCount: 0,
    });
  });

  it("invalidates active commands on epoch advance and admits the new epoch", async () => {
    const refinement = provider();
    const stale = refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }));
    expect(refinement.advanceEngineEpoch()).toBe(5);

    await expect(stale).resolves.toMatchObject({
      status: "rejected",
      reason: "epoch-mismatch",
      consumed: false,
    });
    await expect(refinement.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }, {
      requestSequence: 2,
      engineEpoch: 5,
    }))).resolves.toMatchObject({
      status: "completed",
      consumed: false,
    });
    expect(refinement.snapshot()).toMatchObject({
      engineEpoch: 5,
      active: false,
      completed: 1,
      rejected: 1,
    });
  });

  it("observes caller abort and provider disposal without leaking an active project", async () => {
    const abortedProvider = provider();
    const controller = new AbortController();
    controller.abort("caller-cancelled");
    await expect(abortedProvider.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }, {
      signal: controller.signal,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "aborted",
    });
    expect(abortedProvider.snapshot()).toMatchObject({
      phase: "cold",
      paperLoaded: false,
      active: false,
      activeProjectCount: 0,
    });

    const disposedProvider = provider();
    const pending = disposedProvider.refine(request({
      kind: "smooth",
      pathData: NOISY_LINE,
    }));
    disposedProvider.dispose();
    disposedProvider.dispose();
    await expect(pending).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
      consumed: false,
    });
    await expect(disposedProvider.refine(request({
      kind: "simplify",
      pathData: NOISY_LINE,
      tolerance: 1,
    }))).resolves.toMatchObject({
      status: "rejected",
      reason: "disposed",
    });
    expect(disposedProvider.advanceEngineEpoch()).toBe(4);
    expect(disposedProvider.snapshot()).toMatchObject({
      phase: "disposed",
      engineEpoch: 4,
      active: false,
      activeProjectCount: 0,
      completed: 0,
      rejected: 2,
      authority: "none",
    });
  });

  it("keeps one lower geometry authority and exposes no direct Paper runtime", () => {
    const source = readFileSync(
      new URL("./studio-paper-vector-refinement-provider.ts", import.meta.url),
      "utf8",
    );
    const delegatedGeometrySource = readFileSync(
      new URL("../render/studio-engine-vector-geometry-provider.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("createStudioEngineVectorGeometryProvider");
    expect(source).not.toMatch(/import\s+type\s+paper\s+from/u);
    expect(source).not.toContain('import("paper")');
    expect(source).not.toMatch(/new\s+(?:library\.)?PaperScope/u);
    expect(source).not.toMatch(/(?:react-)?konva/u);
    expect(source).toContain('readonly stage: "settled"');
    expect(source).toContain('readonly mainScene: false');
    expect(source).toContain('readonly history: false');
    expect(source).toContain('readonly persistence: false');
    expect(source).toContain('"unsupported-command"');
    expect(STUDIO_PAPER_VECTOR_REFINEMENT_CAPABILITIES).not.toContain(
      "refine:flatten",
    );

    expect(delegatedGeometrySource).toContain(
      'paperLibraryPromise ??= import("paper")',
    );
    expect(delegatedGeometrySource).toContain(
      "this.scope ??= new library.PaperScope()",
    );
    expect(delegatedGeometrySource).toContain(
      "this.scope.settings.insertItems = false",
    );
    expect(delegatedGeometrySource).toContain("removeProject(project)");
  });
});
