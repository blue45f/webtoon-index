import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  STUDIO_HOT_PATH_COMMIT_BUDGETS,
  evaluateStudioHotPathBudget,
  studioHotPathBudgetFor,
} from "./studio-hot-path-commit-budget";

const gateSource = readFileSync(
  new URL("../../../../../tests/benchmarks/harness/studio-runtime-commit-gate.ts", import.meta.url),
  "utf8",
);
const sharedRuntimeSource = readFileSync(
  new URL("./canvas/studio-canvas-shared-runtime.ts", import.meta.url),
  "utf8",
);

describe("studio hot path commit budget", () => {
  it("keeps the idle baseline at absolute zero", () => {
    // Every other budget is only meaningful if nothing renders without input.
    const idle = studioHotPathBudgetFor("idle");
    expect(idle).toBeDefined();
    expect(idle?.maxEditorRenders).toBe(0);
    expect(idle?.maxCanvasRenders).toBe(0);
    expect(idle?.maxReactCommits).toBe(0);
  });

  it("forbids page renders during the wheel-zoom gesture window", () => {
    const gesture = studioHotPathBudgetFor("zoom:wheel-gesture");
    expect(gesture?.maxEditorRenders).toBe(0);
    expect(gesture?.maxCanvasRenders).toBe(0);
  });

  it("holds pan and stroke to a page-render ceiling, not a commit ceiling", () => {
    // Both gestures legitimately commit isolated store subscribers per frame.
    // The line that must not move is how often the editor shell itself renders.
    for (const gesture of ["pan:hand-drag", "stroke:pen-paced"]) {
      const budget = studioHotPathBudgetFor(gesture);
      expect(budget).toBeDefined();
      expect(budget!.maxEditorRenders).toBeLessThanOrEqual(2);
      expect(budget!.maxCanvasRenders).toBeLessThanOrEqual(2);
      expect(budget!.maxReactCommits).toBeGreaterThan(budget!.maxEditorRenders);
    }
  });

  it("gives every budget a rationale so a future raise has to argue with one", () => {
    for (const budget of STUDIO_HOT_PATH_COMMIT_BUDGETS) {
      expect(budget.rationale.length).toBeGreaterThan(40);
      expect(budget.input.length).toBeGreaterThan(4);
    }
  });

  it("passes a reading that is inside budget", () => {
    expect(
      evaluateStudioHotPathBudget({
        gesture: "pan:hand-drag",
        editorRenders: 1,
        canvasRenders: 1,
        reactCommits: 22,
      }),
    ).toEqual([]);
  });

  it("fails the measured pre-fix pan regression", () => {
    // docs/perf/canvas-findings.md §3: 40 pointer moves produced 42 react-dom
    // commits and re-rendered StudioPage every frame. The gate has to reject it.
    const violations = evaluateStudioHotPathBudget({
      gesture: "pan:hand-drag",
      editorRenders: 40,
      canvasRenders: 40,
      reactCommits: 42,
    });
    expect(violations.map((violation) => violation.metric)).toEqual([
      "editorRenders",
      "canvasRenders",
    ]);
  });

  it("treats an unknown gesture as a violation rather than a silent pass", () => {
    // A gate that ignores scenarios it does not recognise is how the pan
    // regression survived every source-text assertion.
    expect(
      evaluateStudioHotPathBudget({
        gesture: "marquee:drag",
        editorRenders: 0,
        canvasRenders: 0,
        reactCommits: 0,
      }),
    ).toHaveLength(1);
  });
});

describe("runtime gate wiring", () => {
  it("drives every budgeted gesture", () => {
    for (const budget of STUDIO_HOT_PATH_COMMIT_BUDGETS) {
      expect(gateSource).toContain(`"${budget.gesture}"`);
    }
  });

  it("refuses to report budgets when instrumentation cannot be proven live", () => {
    expect(gateSource).toContain("countersProvenLive");
    expect(gateSource).toContain("refusing to report budgets");
    // A pan that never scrolled, or a hand tool that never armed, would report a
    // flattering zero; both are checked before the reading counts.
    expect(gateSource).toContain("pan gesture never scrolled the view");
    expect(gateSource).toContain("hand tool did not activate");
  });

  it("counts product renders through the armed sink, not through DevTools", () => {
    expect(gateSource).toContain("__studioHotPathRenderCounters");
    expect(sharedRuntimeSource).toContain("export function recordStudioHotPathRender");
    // Armed gating: with no sink installed the recorder must allocate nothing.
    expect(sharedRuntimeSource).toMatch(/const sink = [\s\S]*?if \(!sink\) return;/u);
  });
});
