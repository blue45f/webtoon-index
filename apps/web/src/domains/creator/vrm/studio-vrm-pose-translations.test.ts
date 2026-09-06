import { describe, expect, it } from "vitest";

import {
  cloneStudioVrmPoseTranslations,
  mirrorStudioVrmPoseTranslations,
  normalizeStudioVrmPoseTranslations,
} from "./studio-vrm-pose-translations";

const translations = {
  version: 1 as const,
  root: [0.4, 0, -0.2] as const,
  hips: [0.1, -0.05, 0.03] as const,
  spine: [-0.08, 0.12, 0.04] as const,
};

describe("Studio VRM pose translations", () => {
  it("strictly normalizes and detaches the bounded v1 block", () => {
    const normalized = normalizeStudioVrmPoseTranslations(translations)!;
    expect(normalized).toEqual(translations);
    expect(normalized).not.toBe(translations);
    expect(Object.isFrozen(normalized)).toBe(true);
    const cloned = cloneStudioVrmPoseTranslations(normalized);
    expect(cloned).toEqual(translations);
    expect(cloned.root).not.toBe(normalized.root);
  });

  it("mirrors all body offsets or only the upper-body spine offset by scope", () => {
    expect(mirrorStudioVrmPoseTranslations(translations, "all")).toEqual({
      version: 1,
      root: [-0.4, 0, -0.2],
      hips: [-0.1, -0.05, 0.03],
      spine: [0.08, 0.12, 0.04],
    });
    expect(mirrorStudioVrmPoseTranslations(translations, "arms")).toEqual({
      ...translations,
      spine: [0.08, 0.12, 0.04],
    });
    expect(mirrorStudioVrmPoseTranslations(translations, "torso")).toEqual({
      ...translations,
      hips: [-0.1, -0.05, 0.03],
      spine: [0.08, 0.12, 0.04],
    });
    expect(mirrorStudioVrmPoseTranslations(translations, "legs")).toEqual(translations);
  });

  it("rejects foreign keys, nonzero root Y, range overflow, and nested accessors", () => {
    expect(normalizeStudioVrmPoseTranslations({ ...translations, future: true })).toBeNull();
    expect(normalizeStudioVrmPoseTranslations({ ...translations, root: [0, 0.1, 0] })).toBeNull();
    expect(normalizeStudioVrmPoseTranslations({ ...translations, spine: [0, 0.8, 0] })).toBeNull();
    let reads = 0;
    const hostile = { ...translations } as Record<string, unknown>;
    Object.defineProperty(hostile, "hips", {
      enumerable: true,
      get() {
        reads += 1;
        return [0, 0, 0];
      },
    });
    expect(normalizeStudioVrmPoseTranslations(hostile)).toBeNull();
    expect(reads).toBe(0);

    const hostileRoot = [0, 0, 0];
    Object.defineProperty(hostileRoot, "0", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("nested getter must not execute");
      },
    });
    expect(normalizeStudioVrmPoseTranslations({
      ...translations,
      root: hostileRoot,
    })).toBeNull();
    expect(reads).toBe(0);
  });
});
