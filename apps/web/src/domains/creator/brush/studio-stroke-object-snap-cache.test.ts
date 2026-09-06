import { describe, expect, it, vi } from "vitest";

import { resolveStudioStrokeObjectSnapTargets } from "./studio-stroke-object-snap-cache";

import type { GuideBox } from "../studio-smart-guides";

const box = (id: string): GuideBox => ({
  id,
  x: 0,
  y: 0,
  width: 10,
  height: 10,
});

describe("resolveStudioStrokeObjectSnapTargets", () => {
  it("collects once per stroke id and reuses the frozen target list", () => {
    const collect = vi.fn(() => [box("a"), box("b")]);
    const first = resolveStudioStrokeObjectSnapTargets({
      cache: null,
      strokeId: "stroke-1",
      collect,
    });
    expect(first.collected).toBe(true);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(first.targets).toHaveLength(2);

    const second = resolveStudioStrokeObjectSnapTargets({
      cache: first.cache,
      strokeId: "stroke-1",
      collect,
    });
    expect(second.collected).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(second.targets).toBe(first.targets);
    expect(second.cache).toBe(first.cache);
  });

  it("recollects when the stroke id changes (new pointer contact)", () => {
    const collect = vi.fn((() => {
      let n = 0;
      return () => {
        n += 1;
        return [box(`gen-${n}`)];
      };
    })());
    const first = resolveStudioStrokeObjectSnapTargets({
      cache: null,
      strokeId: "stroke-1",
      collect,
    });
    const next = resolveStudioStrokeObjectSnapTargets({
      cache: first.cache,
      strokeId: "stroke-2",
      collect,
    });
    expect(collect).toHaveBeenCalledTimes(2);
    expect(next.collected).toBe(true);
    expect(next.cache.strokeId).toBe("stroke-2");
    expect(next.targets[0]?.id).toBe("gen-2");
  });
});
