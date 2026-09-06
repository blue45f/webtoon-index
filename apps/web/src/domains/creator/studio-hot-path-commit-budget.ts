/**
 * Runtime budgets for the Studio "hot path de-React" contract.
 *
 * Until now the contract was only checked by reading source text — for example
 * `studio-freehand-hot-path-boundary.test.ts` pins the exact `flushSync` +
 * isolated-store call shape of the freehand draft commit. Those tests protect a
 * *mechanism*, and they do it well, but they cannot see a gesture that violates
 * the contract through some other code path. The measured pan regression proved
 * it: 40 pointer moves produced 42 react-dom commits and re-rendered the whole
 * editor every frame while every source assertion still passed.
 *
 * This module states the contract as numbers a real browser run can check.
 * `tests/benchmarks/harness/studio-runtime-commit-gate.ts` drives the shipped
 * production build with trusted input and fails when a gesture exceeds these.
 *
 * Two different signals, deliberately:
 *
 * - `pageRenders` counts renders of the editor shell / canvas viewport, emitted
 *   by the product through `recordStudioHotPathRender`. This is what the
 *   contract actually forbids ("React setState 금지" on the input hot path), and
 *   it is the number that must stay near zero.
 * - `reactCommits` counts react-dom commits of any root. An isolated store
 *   subscriber (draft preview layer, live scroll viewport box) legitimately
 *   commits per frame, so this budget is a loose upper bound that catches a
 *   runaway, not a zero-tolerance line.
 *
 * Budgets are ceilings measured with headroom over the observed values, not
 * aspirations: raising one must be justified by a measurement, and lowering one
 * is always safe.
 */

export interface StudioHotPathGestureBudget {
  /** Gesture id, matching the runtime gate's scenario name. */
  readonly gesture: string;
  /** What the gate does to produce the gesture. */
  readonly input: string;
  /** Max renders of the editor shell (`studio:editor`) during the window. */
  readonly maxEditorRenders: number;
  /** Max renders of the canvas viewport (`studio:canvas`) during the window. */
  readonly maxCanvasRenders: number;
  /** Max react-dom commits of any root during the window. */
  readonly maxReactCommits: number;
  /** Why this ceiling, in product terms. */
  readonly rationale: string;
}

export const STUDIO_HOT_PATH_COMMIT_BUDGETS: readonly StudioHotPathGestureBudget[] =
  Object.freeze([
    Object.freeze({
      gesture: "idle",
      input: "2s with no input at all",
      maxEditorRenders: 0,
      maxCanvasRenders: 0,
      maxReactCommits: 0,
      rationale:
        "Nothing may render without input. This is also the validity baseline: " +
        "a non-zero gesture count can only be attributed to the gesture if idle is 0.",
    }),
    Object.freeze({
      gesture: "pan:hand-drag",
      input: "hand tool, 40 pointermove drag",
      maxEditorRenders: 2,
      maxCanvasRenders: 2,
      maxReactCommits: 48,
      rationale:
        "Panning is a view gesture: scroll offsets reach the live store, and React " +
        "sees one settled snapshot at the end. Two editor renders cover the tool " +
        "switch and the settle commit — that is the zero-tolerance line. The live " +
        "scroll subscribers (rulers, minimap viewport box) may legitimately commit " +
        "once per animation frame, so the commit ceiling is drag-length shaped and " +
        "only catches a runaway.",
    }),
    Object.freeze({
      gesture: "zoom:wheel-gesture",
      input: "20 wheel notches over the canvas",
      maxEditorRenders: 0,
      maxCanvasRenders: 0,
      maxReactCommits: 2,
      rationale:
        "The wheel gesture is CSS-transform only until settle. This already held " +
        "at zero commits when it was measured; the gate keeps it that way.",
    }),
    Object.freeze({
      gesture: "zoom:wheel-settle",
      input: "the commit after the wheel gesture stops",
      maxEditorRenders: 2,
      maxCanvasRenders: 2,
      maxReactCommits: 6,
      rationale:
        "Settling zoom is a real layout change and is allowed to commit: once for " +
        "the zoom level, once for the anchor scroll correction it performs.",
    }),
    Object.freeze({
      gesture: "stroke:pen-paced",
      input: "pen brush, 60 pointermove drag at ~60Hz",
      maxEditorRenders: 2,
      maxCanvasRenders: 2,
      maxReactCommits: 90,
      rationale:
        "Stroke frames commit into the isolated draft-preview store, which is the " +
        "designed behaviour, so the commit ceiling is per-frame-shaped. What must " +
        "not happen is the editor shell re-rendering per sample — that is the line " +
        "the render budget draws.",
    }),
  ]);

export function studioHotPathBudgetFor(
  gesture: string,
): StudioHotPathGestureBudget | undefined {
  return STUDIO_HOT_PATH_COMMIT_BUDGETS.find((budget) => budget.gesture === gesture);
}

export interface StudioHotPathGestureSample {
  readonly gesture: string;
  readonly editorRenders: number;
  readonly canvasRenders: number;
  readonly reactCommits: number;
}

export interface StudioHotPathBudgetViolation {
  readonly gesture: string;
  readonly metric: "editorRenders" | "canvasRenders" | "reactCommits";
  readonly observed: number;
  readonly budget: number;
}

/**
 * Compare a measured gesture against its budget.
 *
 * An unknown gesture is a violation, not a pass: a gate that silently ignores
 * scenarios it does not recognise is how the pan regression survived.
 */
export function evaluateStudioHotPathBudget(
  sample: StudioHotPathGestureSample,
): readonly StudioHotPathBudgetViolation[] {
  const budget = studioHotPathBudgetFor(sample.gesture);
  if (!budget) {
    return [
      {
        gesture: sample.gesture,
        metric: "editorRenders",
        observed: sample.editorRenders,
        budget: Number.NaN,
      },
    ];
  }
  const violations: StudioHotPathBudgetViolation[] = [];
  if (sample.editorRenders > budget.maxEditorRenders) {
    violations.push({
      gesture: sample.gesture,
      metric: "editorRenders",
      observed: sample.editorRenders,
      budget: budget.maxEditorRenders,
    });
  }
  if (sample.canvasRenders > budget.maxCanvasRenders) {
    violations.push({
      gesture: sample.gesture,
      metric: "canvasRenders",
      observed: sample.canvasRenders,
      budget: budget.maxCanvasRenders,
    });
  }
  if (sample.reactCommits > budget.maxReactCommits) {
    violations.push({
      gesture: sample.gesture,
      metric: "reactCommits",
      observed: sample.reactCommits,
      budget: budget.maxReactCommits,
    });
  }
  return violations;
}
