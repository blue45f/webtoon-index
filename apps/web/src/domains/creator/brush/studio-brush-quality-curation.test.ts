import { describe, expect, it } from "vitest";

import {
  compareStudioBrushCurationCandidates,
  curateStudioBrushCandidates,
  type StudioBrushCurationCandidate,
  type StudioBrushMarkFingerprint,
} from "./studio-brush-quality-curation";

function fingerprint(value: number, edge = 0.2): StudioBrushMarkFingerprint {
  const darkness = [
    0, value, value, 0,
    0, value, value, 0,
    0, value, value, 0,
    0, value, value, 0,
  ];
  return {
    darkness,
    silhouette: darkness.map((entry) => entry > 0 ? 1 : 0),
    width: 4,
    height: 4,
    toneHistogram: [0.5, 0.5],
    horizontalProfile: [0, 0.5, 0.5, 0],
    verticalProfile: [0, 0.5, 0.5, 0],
    inkDensity: 0.5,
    edgeDensity: edge,
    gradientDensity: 0.3,
    textureEntropy: 0.6,
  };
}

function candidate(
  id: string,
  overrides: Partial<StudioBrushCurationCandidate> = {},
): StudioBrushCurationCandidate {
  return {
    id,
    comparisonGroup: "paint/ink/strict-continuous",
    listedOrder: 0,
    protectedFromCulling: false,
    qualityPassed: true,
    browserErrorCount: 0,
    refusedStrokeCount: 0,
    centerlineCoverage: 1,
    liveCommitFidelity: 0.99,
    settledStability: 1,
    inputDeliveryRatio: 1,
    frameP95Milliseconds: 20,
    textureQuality: 0.8,
    gpuApproved: false,
    fingerprint: fingerprint(0.7),
    ...overrides,
  };
}

describe("quality-first brush curation", () => {
  it("accepts only visually near-identical marks in the same comparison group", () => {
    const pair = compareStudioBrushCurationCandidates(candidate("a"), candidate("b"));
    expect(pair.duplicateCandidate).toBe(true);

    const differentGroup = compareStudioBrushCurationCandidates(
      candidate("a"),
      candidate("b", { comparisonGroup: "paint/watercolor/soft-wet-continuous" }),
    );
    expect(differentGroup.duplicateCandidate).toBe(false);
    expect(differentGroup.failedGates).toContain("comparison-group");
  });

  it("keeps a visibly different texture even when metadata is otherwise identical", () => {
    const pair = compareStudioBrushCurationCandidates(
      candidate("a"),
      candidate("b", { fingerprint: fingerprint(0.35, 0.4) }),
    );
    expect(pair.duplicateCandidate).toBe(false);
    expect(pair.failedGates).toContain("darkness");
  });

  it("chooses quality before GPU and uses GPU only as a near-quality tie-breaker", () => {
    const clusters = curateStudioBrushCandidates([
      candidate("gpu-fast", { gpuApproved: true, liveCommitFidelity: 0.94, listedOrder: 1 }),
      candidate("quality-best", { gpuApproved: false, liveCommitFidelity: 1, listedOrder: 2 }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.representativeId).toBe("quality-best");

    const tied = curateStudioBrushCandidates([
      candidate("canvas", { gpuApproved: false, listedOrder: 2 }),
      candidate("gpu", { gpuApproved: true, listedOrder: 1 }),
    ]);
    expect(tied[0]?.representativeId).toBe("gpu");
  });

  it("does not let frame speed compensate for lower measured mark quality", () => {
  const clusters = curateStudioBrushCandidates([
    candidate("slower-quality", {
      frameP95Milliseconds: 180,
      textureQuality: 0.9,
      listedOrder: 0,
    }),
    candidate("fast-gpu-lower-quality", {
      gpuApproved: true,
      frameP95Milliseconds: 5,
      textureQuality: 0.84,
      listedOrder: 1,
    }),
  ]);
  expect(clusters[0]?.representativeId).toBe("slower-quality");
});

  it("never lets a protected but failing brush beat a passing representative", () => {
  const clusters = curateStudioBrushCandidates([
    candidate("protected-failing", {
      protectedFromCulling: true,
      qualityPassed: false,
      listedOrder: 0,
    }),
    candidate("passing", {
      protectedFromCulling: false,
      qualityPassed: true,
      listedOrder: 1,
    }),
  ]);
  expect(clusters[0]?.representativeId).toBe("passing");
});

  it("never suggests removing more than one protected canonical brush automatically", () => {
    const clusters = curateStudioBrushCandidates([
      candidate("canonical-a", { protectedFromCulling: true }),
      candidate("canonical-b", { protectedFromCulling: true, listedOrder: 1 }),
    ]);
    expect(clusters[0]?.suggestedQuarantineIds).toEqual([]);
  });

  it("uses complete-link clustering so similarity cannot chain through a middle brush", () => {
    const thresholds = {
      silhouetteIntersectionOverUnionMinimum: 0.9,
      darknessMeanAbsoluteErrorMaximum: 0.15,
      toneHistogramIntersectionMinimum: 0.9,
      horizontalProfileCorrelationMinimum: 0.9,
      verticalProfileCorrelationMinimum: 0.9,
      inkDensityRatioMinimum: 0.8,
      inkDensityRatioMaximum: 1.2,
      edgeDensityRatioMinimum: 0.8,
      edgeDensityRatioMaximum: 1.2,
      gradientDensityRatioMinimum: 0.8,
      gradientDensityRatioMaximum: 1.2,
      weightedDistanceMaximum: 0.2,
    } as const;
    const clusters = curateStudioBrushCandidates([
      candidate("a", { fingerprint: fingerprint(0.9), listedOrder: 0 }),
      candidate("b", { fingerprint: fingerprint(0.7), listedOrder: 1 }),
      candidate("c", { fingerprint: fingerprint(0.5), listedOrder: 2 }),
    ], thresholds);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.memberIds).toHaveLength(2);
  });
});
