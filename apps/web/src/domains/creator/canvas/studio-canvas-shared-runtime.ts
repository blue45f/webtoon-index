import type Konva from "konva";

/**
 * Resolve a Studio element id while walking through Konva wrapper groups.
 *
 * Both the editor pointer controller and the extracted viewport renderer use this
 * leaf helper. Keeping it outside either React module prevents a circular import.
 */
export function studioElementIdOf(node: Konva.Node | null): string | null {
  let current: Konva.Node | null = node;
  while (current) {
    const id = current.getAttr("studioElementId");
    if (typeof id === "string" && id) return id;
    current = current.getParent();
  }
  return null;
}

/**
 * Global sink for the armed hot-path render counters.
 *
 * The "hot path de-React" contract is about *page renders*, not react-dom
 * commits: a stroke frame that re-renders one isolated store subscriber is
 * healthy, while a pan frame that re-renders `StudioPage` is not. react-dom's
 * DevTools commit hook cannot tell those apart, so the contract needs a signal
 * the product itself emits.
 *
 * Armed gating keeps that free in production: the counters only exist if a
 * measurement harness installed the sink object *before* any app script ran.
 * With no sink the recorder is a single property read and allocates nothing, so
 * shipping users pay nothing for a gate that only CI arms.
 */
export const STUDIO_HOT_PATH_RENDER_COUNTER_KEY = "__studioHotPathRenderCounters" as const;

type StudioHotPathRenderCounterSink = Record<string, number>;

function studioHotPathRenderCounterSink(): StudioHotPathRenderCounterSink | null {
  const target = globalThis as typeof globalThis & {
    __studioHotPathRenderCounters?: StudioHotPathRenderCounterSink;
  };
  const sink = target.__studioHotPathRenderCounters;
  return typeof sink === "object" && sink !== null ? sink : null;
}

/**
 * Record that `id` re-rendered once.
 *
 * Call it from a dependency-less `useEffect` so the count follows real renders:
 * a bailed-out component runs no effect and is therefore not counted, and the
 * render function itself stays free of side effects (React Compiler safe).
 */
export function recordStudioHotPathRender(id: string): void {
  const sink = studioHotPathRenderCounterSink();
  if (!sink) return;
  sink[id] = (sink[id] ?? 0) + 1;
}

/**
 * Development-only React commit profiling shared by the editor shell and canvas.
 */
export function recordStudioRenderProfile(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number
): void {
  if (!import.meta.env.DEV) return;
  const target = globalThis as typeof globalThis & {
    __studioRenderProfile?: { id: string; phase: string; ms: number; at: number }[];
  };
  const buffer = (target.__studioRenderProfile ??= []);
  buffer.push({
    id,
    phase,
    ms: Math.round(actualDuration * 10) / 10,
    at: Math.round(performance.now()),
  });
  if (buffer.length > 80) buffer.splice(0, buffer.length - 80);
}
