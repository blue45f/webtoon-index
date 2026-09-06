import { describe, expect, it } from "vitest";

import { fillStudioCausalInkDabs, type StudioCausalInkFillContext } from "./studio-causal-ink-canvas";

import type { StudioStrokePaintModel } from "./brush/studio-stroke-paint-model";
import type { StudioCausalInkDab } from "./studio-causal-ink";

class RecordingFillContext implements StudioCausalInkFillContext {
  fillStyle: string | CanvasGradient | CanvasPattern = "";
  readonly operations: string[] = [];

  beginPath(): void {
    this.operations.push("begin");
  }

  moveTo(x: number, y: number): void {
    this.operations.push(`move:${x},${y}`);
  }

  arc(x: number, y: number, radius: number): void {
    this.operations.push(`arc:${x},${y},${radius}`);
  }

  fill(): void {
    this.operations.push("fill");
  }
}

const DABS: readonly StudioCausalInkDab[] = [
  { x: 10, y: 20, radius: 8, pressure: 1 },
  { x: 13, y: 20, radius: 8, pressure: 1 },
];

describe("causal ink Canvas fill batching", () => {
  it("keeps omitted legacy strokes on one source-over fill per dab", () => {
    const context = new RecordingFillContext();
    fillStudioCausalInkDabs(context, DABS, "#123456");

    expect(context.fillStyle).toBe("#123456");
    expect(context.operations).toEqual([
      "begin", "arc:10,20,8", "fill",
      "begin", "arc:13,20,8", "fill",
    ]);
  });

  it("fills a layered-flow-v1 stroke union once and separates every circle subpath", () => {
    const context = new RecordingFillContext();
    fillStudioCausalInkDabs(context, DABS, "#abcdef", "layered-flow-v1");

    expect(context.fillStyle).toBe("#abcdef");
    expect(context.operations).toEqual([
      "begin",
      "move:18,20", "arc:10,20,8",
      "move:21,20", "arc:13,20,8",
      "fill",
    ]);
  });

  it("fails closed to frozen legacy semantics for an unknown future paint model", () => {
    const context = new RecordingFillContext();
    fillStudioCausalInkDabs(
      context,
      DABS,
      "#111111",
      "layered-flow-v2" as StudioStrokePaintModel,
    );

    expect(context.operations.filter((operation) => operation === "fill")).toHaveLength(2);
    expect(context.operations.some((operation) => operation.startsWith("move:"))).toBe(false);
  });

  it("does not mutate the context for an empty plan", () => {
    const context = new RecordingFillContext();
    fillStudioCausalInkDabs(context, [], "#ffffff", "layered-flow-v1");
    expect(context.fillStyle).toBe("");
    expect(context.operations).toEqual([]);
  });
});
