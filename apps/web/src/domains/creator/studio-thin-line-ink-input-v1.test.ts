import { describe, expect, it } from "vitest";

import {
  createStudioThinLineInkInputState,
  filterStudioThinLineInkInput,
  isStudioThinLineInkBrush,
  shouldFilterStudioThinLineInkInput,
} from "./studio-thin-line-ink-input-v1";

describe("studio thin-line ink input v1", () => {
  it("names only the monoline causal aliases", () => {
    expect(isStudioThinLineInkBrush("fineliner")).toBe(true);
    expect(isStudioThinLineInkBrush("technical-pen")).toBe(true);
    expect(isStudioThinLineInkBrush("liner")).toBe(true);
    expect(isStudioThinLineInkBrush("glass-pen")).toBe(true);
    expect(isStudioThinLineInkBrush("dip-pen")).toBe(true);
    expect(isStudioThinLineInkBrush("g-pen")).toBe(true);
    expect(isStudioThinLineInkBrush("pen")).toBe(false);
    expect(isStudioThinLineInkBrush("marker")).toBe(false);
    expect(shouldFilterStudioThinLineInkInput({
      brushId: "fineliner",
      immediateCausalInput: true,
    })).toBe(true);
    expect(shouldFilterStudioThinLineInkInput({
      brushId: "fineliner",
      immediateCausalInput: false,
    })).toBe(false);
  });

  it("lowers high-frequency lateral energy on a long noisy line without rewriting earlier samples", () => {
    const samples = Array.from({ length: 80 }, (_, index) => ({
      x: index * 4,
      y: Math.sin(index * 2.7) * 1.4,
      timeStamp: index * 8,
    }));
    let state = createStudioThinLineInkInputState(samples[0]!);
    const filtered: { x: number; y: number }[] = [{ x: samples[0]!.x, y: samples[0]!.y }];
    for (const sample of samples.slice(1)) {
      const next = filterStudioThinLineInkInput(state, sample, 1);
      state = next.state;
      filtered.push({ x: next.x, y: next.y });
    }

    const rawLateral = samples.reduce((sum, sample) => sum + sample.y * sample.y, 0);
    const filteredLateral = filtered.reduce((sum, sample) => sum + sample.y * sample.y, 0);
    expect(filteredLateral).toBeLessThan(rawLateral * 0.55);
    expect(filtered[0]).toEqual({ x: samples[0]!.x, y: samples[0]!.y });
    expect(filtered[20]!.x).toBeGreaterThan(filtered[10]!.x);
  });
});
