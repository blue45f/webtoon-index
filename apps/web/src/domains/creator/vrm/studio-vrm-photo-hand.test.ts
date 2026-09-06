import { describe, expect, it } from "vitest";

import {
  createStudioVrmPhotoHandInferenceResult,
  createStudioVrmPhotoHandUnavailableResult,
} from "./studio-vrm-photo-hand";

function hand(offset = 0): Array<{ x: number; y: number; z: number }> {
  return Array.from({ length: 21 }, (_, index) => ({
    x: offset + index * 0.01,
    y: index * 0.02,
    z: -index * 0.005,
  }));
}

function result(labels: readonly ("Left" | "Right")[], scores?: readonly number[]) {
  return {
    landmarks: labels.map((_, index) => hand(index * 0.1)),
    worldLandmarks: labels.map((_, index) => hand(index * 0.01)),
    handedness: labels.map((label, index) => [{
      categoryName: label,
      score: scores?.[index] ?? 0.9,
    }]),
  };
}

describe("studio VRM still-photo hand boundary", () => {
  it("accepts zero, one, and two strictly correlated 21-point hands", () => {
    const none = createStudioVrmPhotoHandInferenceResult(result([]), { mirrorHorizontal: true });
    expect(none).toMatchObject({ status: "not-detected", detectedSides: [], fingerEdits: {} });

    const one = createStudioVrmPhotoHandInferenceResult(result(["Left"]), {
      mirrorHorizontal: true,
    });
    expect(one.status).toBe("detected");
    expect(one.detectedSides).toEqual(["left"]);
    expect(one.fingerEdits.leftIndexProximal).toBeDefined();
    expect(one.fingerEdits.rightIndexProximal).toBeUndefined();

    const two = createStudioVrmPhotoHandInferenceResult(result(["Left", "Right"]), {
      mirrorHorizontal: true,
    });
    expect(two.detectedSides).toEqual(["left", "right"]);
    expect(two.fingerEdits.leftThumbDistal).toBeDefined();
    expect(two.fingerEdits.rightThumbDistal).toBeDefined();
  });

  it("maps handedness through the actual preprocessing mirror setting", () => {
    const mirrored = createStudioVrmPhotoHandInferenceResult(result(["Left"]), {
      mirrorHorizontal: true,
    });
    const anatomical = createStudioVrmPhotoHandInferenceResult(result(["Left"]), {
      mirrorHorizontal: false,
    });
    expect(mirrored.detectedSides).toEqual(["left"]);
    expect(anatomical.detectedSides).toEqual(["right"]);
  });

  it("fails closed for duplicate mapped sides instead of using detector array order", () => {
    const duplicate = createStudioVrmPhotoHandInferenceResult(result(["Left", "Left"]), {
      mirrorHorizontal: true,
    });
    expect(duplicate.status).toBe("not-detected");
    expect(duplicate.ambiguousSides).toEqual(["left"]);
    expect(duplicate.warnings).toContain("ambiguous-side");
    expect(duplicate.fingerEdits).toEqual({});
  });

  it("preserves the body path by representing low-confidence and unavailable hands without fingers", () => {
    const low = createStudioVrmPhotoHandInferenceResult(result(["Right"], [0.2]), {
      mirrorHorizontal: true,
    });
    expect(low.status).toBe("not-detected");
    expect(low.warnings).toEqual(["low-confidence"]);
    expect(createStudioVrmPhotoHandUnavailableResult("model-unavailable")).toMatchObject({
      status: "unavailable",
      warnings: ["model-unavailable"],
      fingerEdits: {},
    });
  });

  it("rejects malformed counts, coordinates, category labels, scores, and excessive hands", () => {
    const short = result(["Left"]);
    short.landmarks[0] = short.landmarks[0]!.slice(0, 20);
    expect(() => createStudioVrmPhotoHandInferenceResult(short, { mirrorHorizontal: true }))
      .toThrowError(expect.objectContaining({ code: "protocol" }));

    const nonFinite = result(["Left"]);
    nonFinite.worldLandmarks[0]![4]!.z = Number.NaN;
    expect(() => createStudioVrmPhotoHandInferenceResult(nonFinite, { mirrorHorizontal: true }))
      .toThrowError(expect.objectContaining({ code: "protocol" }));

    const invalidLabel = result(["Left"]);
    invalidLabel.handedness[0]![0]!.categoryName = "Unknown" as "Left";
    expect(() => createStudioVrmPhotoHandInferenceResult(invalidLabel, { mirrorHorizontal: true }))
      .toThrowError(expect.objectContaining({ code: "protocol" }));

    const invalidScore = result(["Left"]);
    invalidScore.handedness[0]![0]!.score = 2;
    expect(() => createStudioVrmPhotoHandInferenceResult(invalidScore, { mirrorHorizontal: true }))
      .toThrowError(expect.objectContaining({ code: "protocol" }));

    expect(() => createStudioVrmPhotoHandInferenceResult(result(["Left", "Right", "Left"]), {
      mirrorHorizontal: true,
    })).toThrowError(expect.objectContaining({ code: "protocol" }));

    const uncorrelated = result(["Left"]);
    uncorrelated.worldLandmarks = [];
    expect(() => createStudioVrmPhotoHandInferenceResult(uncorrelated, { mirrorHorizontal: true }))
      .toThrowError(expect.objectContaining({ code: "protocol" }));
  });

  it("supports the deprecated handednesses field while preferring the current field", () => {
    const legacy = result(["Right"]);
    const raw = {
      landmarks: legacy.landmarks,
      worldLandmarks: legacy.worldLandmarks,
      handednesses: legacy.handedness,
    };
    expect(createStudioVrmPhotoHandInferenceResult(raw, { mirrorHorizontal: true }).detectedSides)
      .toEqual(["right"]);
  });
});
