import { describe, expect, it } from "vitest";

import { refineStudioVrmContact, sameStudioVrmContactValues } from "./studio-vrm-contact-refinement";

function fixture(measure: (angles: readonly number[]) => number | null, initial = [0.4, 0.6, 0.3]) {
  let angles = [...initial];
  let writes = 0;
  return {
    run: () => refineStudioVrmContact({ initial, limits: [1.4, 1.75, 1.13], goal: 0.001,
      apply: (value) => { angles = [...value]; writes += 1; }, measure: () => measure(angles) }),
    read: () => angles, writes: () => writes,
  };
}

describe("transactional contact refinement", () => {
  it.each([1, -1])("retains only improving, bounded trials for side sign %s", (sign) => {
    const initial = [0.4, 0.6, 0.3].map((value) => value * sign);
    const test = fixture((values) => values.reduce((sum, value) => sum + (Math.abs(value) - 0.85) ** 2, 0), initial);
    const result = test.run();
    expect(result.reason).toBe("improved");
    expect(result.after!).toBeLessThan(result.before!);
    expect(test.read()).toEqual(result.angles);
    expect(test.read().every((value) => Math.sign(value) === sign)).toBe(true);
    expect(test.writes()).toBeLessThanOrEqual(80);
  });
  it("rolls back a valid trial that makes the contact worse", () => {
    const test = fixture((values) => values.reduce((sum, value) => sum + value, 0));
    expect(test.run().reason).toBe("no-improvement");
    expect(test.read()).toEqual([0.4, 0.6, 0.3]);
  });
  it("rolls back non-finite or throwing trial measurements", () => {
    for (const throwing of [false, true]) {
      const test = fixture((values) => {
        if (values[0] === 0.4) return 1;
        if (throwing) throw new Error("bad bone");
        return NaN;
      });
      test.run();
      expect(test.read()).toEqual([0.4, 0.6, 0.3]);
    }
  });
  it("leaves an already contacting pose unchanged", () => {
    const test = fixture(() => 0);
    expect(test.run().reason).toBe("already-contact");
    expect(test.read()).toEqual([0.4, 0.6, 0.3]);
  });
  it("never grows a joint that is already over the refinement limit", () => {
    let applied: readonly number[] = [2];
    refineStudioVrmContact({ initial: [2], limits: [1], goal: 0, apply: (a) => { applied = a; }, measure: () => 1 });
    expect(applied).toEqual([2]);
  });
  it("rejects invalid inputs before mutating the rig", () => {
    for (const value of [NaN, Infinity, -1]) {
      let writes = 0;
      const result = refineStudioVrmContact({ initial: [0.5], limits: [1], goal: value,
        apply: () => { writes += 1; }, measure: () => 1 });
      expect(result.reason).toBe("invalid");
      expect(writes).toBe(0);
    }
    expect(sameStudioVrmContactValues([NaN], [NaN])).toBe(false);
  });
});
