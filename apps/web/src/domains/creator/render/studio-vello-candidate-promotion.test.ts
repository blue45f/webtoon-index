import { describe, expect, it } from "vitest";

import {
  STUDIO_VELLO_CANDIDATE_ADVANTAGES,
  STUDIO_VELLO_CANDIDATE_CONTRACT_VERSION,
  STUDIO_VELLO_CANDIDATE_PROVENANCE,
  STUDIO_VELLO_CURRENT_CANDIDATE_EVALUATION,
  STUDIO_VELLO_CURRENT_RESEARCH_EVIDENCE,
  STUDIO_VELLO_CURRENT_RESEARCH_RISKS,
  STUDIO_VELLO_PROMOTION_GATES,
  STUDIO_VELLO_PROMOTION_LIMITS,
  STUDIO_VELLO_REQUIRED_BROWSER_TARGETS,
  evaluateStudioVelloCandidate,
  evaluateStudioVelloPromotionGates,
  scoreStudioVelloPromotionEvidence,
  type StudioVelloPromotionEvidence,
  type StudioVelloPromotionGateId,
} from "./studio-vello-candidate-promotion";

const PASSING_EVIDENCE_IDENTITY = Object.freeze({
  evaluatedVersion: "1.2.0",
  sourceCommit: "a".repeat(40),
  buildFingerprint: `sha256:${"b".repeat(64)}`,
});

function passingEvidence(): StudioVelloPromotionEvidence {
  const limits = STUDIO_VELLO_PROMOTION_LIMITS;
  return {
    ...PASSING_EVIDENCE_IDENTITY,
    officialWebSupport: {
      ...PASSING_EVIDENCE_IDENTITY,
      maturity: "production-grade",
      webIsPrimaryTarget: true,
      sourceUrl: `${STUDIO_VELLO_CANDIDATE_PROVENANCE.officialSource}/releases/tag/v1.2.0`,
    },
    upstreamMaturity: {
      ...PASSING_EVIDENCE_IDENTITY,
      releaseStage: "stable",
      alphaLabelPresent: false,
      productionBlockers: [],
      sourceUrl: "https://docs.rs/vello_api/1.2.0/vello_api/",
    },
    webGpuRecovery: {
      ...PASSING_EVIDENCE_IDENTITY,
      probe: "passed",
      adapterAcquisitionPassed: true,
      deviceAcquisitionPassed: true,
      deviceLossTrials: limits.minimumDeviceLossTrials,
      recoveredDeviceLossTrials: limits.minimumDeviceLossTrials,
      recreatedFromCanonicalScene: true,
      staleGpuWorkRejected: true,
    },
    visualParity: {
      ...PASSING_EVIDENCE_IDENTITY,
      probe: "passed",
      canvas2d: {
        ...PASSING_EVIDENCE_IDENTITY,
        total: limits.minimumParityFixturesPerOracle,
        passed: limits.minimumParityFixturesPerOracle,
      },
      svg: {
        ...PASSING_EVIDENCE_IDENTITY,
        total: limits.minimumParityFixturesPerOracle,
        passed: limits.minimumParityFixturesPerOracle,
      },
      canonical: {
        ...PASSING_EVIDENCE_IDENTITY,
        total: limits.minimumParityFixturesPerOracle,
        passed: limits.minimumParityFixturesPerOracle,
      },
      maxPerceptualDelta: limits.maximumPerceptualDelta,
      maxAlphaChannelDelta: limits.maximumAlphaChannelDelta,
      premultipliedAlphaFixturesPassed: true,
      compositingFixturesPassed: true,
    },
    longStrokeLatency: {
      ...PASSING_EVIDENCE_IDENTITY,
      probe: "passed",
      acceptedPointCount: limits.minimumLongStrokeAcceptedPoints,
      measuredFrameCount: limits.minimumLongStrokeMeasuredFrames,
      candidateP95Milliseconds: limits.maximumLongStrokeP95Milliseconds,
      candidateP99Milliseconds: limits.maximumLongStrokeP99Milliseconds,
      canonicalP95Milliseconds: limits.maximumLongStrokeP95Milliseconds,
    },
    memory: {
      ...PASSING_EVIDENCE_IDENTITY,
      probe: "passed",
      retainedScenePathCount: limits.minimumRetainedScenePathCount,
      peakGpuBytes: limits.maximumPeakGpuBytes,
      peakHostBytes: limits.maximumPeakHostBytes,
      postDisposeRetainedBytes: limits.maximumPostDisposeRetainedBytes,
      unboundedGrowthDetected: false,
    },
    legacyCompatibility: {
      ...PASSING_EVIDENCE_IDENTITY,
      probe: "passed",
      compatibilityKind: "legacy-canvas2d-svg",
      replayTrials: limits.minimumCompatibilityReplayTrials,
      uniqueReplayHashes: 1,
      compatibilitySelectionDeclaredBeforeExecution: true,
      canvas2dHashMatchesCanonical: true,
      svgExportHashStable: true,
      canonicalReceiptVerified: true,
    },
    browsers: STUDIO_VELLO_REQUIRED_BROWSER_TARGETS.map((browser) => ({
      ...PASSING_EVIDENCE_IDENTITY,
      browser,
      support: "production",
      computeShaderSuitePassed: true,
      adapterDeviceSuitePassed: true,
      deviceLossSuitePassed: true,
    })),
  };
}

type EvidenceMutation = (
  evidence: StudioVelloPromotionEvidence,
) => StudioVelloPromotionEvidence;

const HARD_GATE_FAILURES: readonly Readonly<{
  id: StudioVelloPromotionGateId;
  fail: EvidenceMutation;
}>[] = [
  {
    id: "official-web-support-maturity",
    fail: (evidence) => ({
      ...evidence,
      officialWebSupport: {
        ...evidence.officialWebSupport,
        maturity: "experimental",
      },
    }),
  },
  {
    id: "upstream-release-maturity",
    fail: (evidence) => ({
      ...evidence,
      upstreamMaturity: {
        ...evidence.upstreamMaturity,
        releaseStage: "alpha",
        alphaLabelPresent: true,
      },
    }),
  },
  {
    id: "webgpu-adapter-device-loss-recovery",
    fail: (evidence) => ({
      ...evidence,
      webGpuRecovery: {
        ...evidence.webGpuRecovery,
        recoveredDeviceLossTrials:
          evidence.webGpuRecovery.deviceLossTrials - 1,
      },
    }),
  },
  {
    id: "canvas-svg-canonical-visual-parity",
    fail: (evidence) => ({
      ...evidence,
      visualParity: {
        ...evidence.visualParity,
        svg: {
          ...evidence.visualParity.svg,
          passed: evidence.visualParity.svg.passed - 1,
        },
      },
    }),
  },
  {
    id: "long-stroke-latency",
    fail: (evidence) => ({
      ...evidence,
      longStrokeLatency: {
        ...evidence.longStrokeLatency,
        candidateP95Milliseconds:
          STUDIO_VELLO_PROMOTION_LIMITS.maximumLongStrokeP95Milliseconds
          + 0.01,
      },
    }),
  },
  {
    id: "bounded-memory",
    fail: (evidence) => ({
      ...evidence,
      memory: {
        ...evidence.memory,
        peakGpuBytes:
          STUDIO_VELLO_PROMOTION_LIMITS.maximumPeakGpuBytes + 1,
      },
    }),
  },
  {
    id: "deterministic-legacy-compatibility-boundary",
    fail: (evidence) => ({
      ...evidence,
      legacyCompatibility: {
        ...evidence.legacyCompatibility,
        uniqueReplayHashes: 2,
      },
    }),
  },
  {
    id: "required-browser-support",
    fail: (evidence) => ({
      ...evidence,
      browsers: evidence.browsers.map((browser) => browser.browser === "safari"
        ? { ...browser, support: "experimental" }
        : browser),
    }),
  },
];

describe("studio Vello candidate promotion contract", () => {
  it("records the existing research provenance, potential advantages, and explicit risks", () => {
    expect(STUDIO_VELLO_CANDIDATE_CONTRACT_VERSION)
      .toBe("studio-vello-candidate-promotion-v2");
    expect(STUDIO_VELLO_CANDIDATE_PROVENANCE).toMatchObject({
      candidateId: "vello",
      packageName: "vello",
      auditedVersion: "0.9.0",
      auditedSourceCommit: "875f324f21da93019cae9e8e61d4abfd69893206",
      auditedOn: "2026-07-30",
      versionEvidence:
        "published crates.io vello 0.9.0 audited 2026-07-30; not installed",
      officialSource: "https://github.com/linebender/vello",
      currentStrategyDisposition: "research-only",
      currentInstallation: "not-installed",
      productRoute: "none",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(STUDIO_VELLO_CANDIDATE_PROVENANCE.apiPreviewSource)
      .toContain("docs.rs/vello_api");
    expect(STUDIO_VELLO_CANDIDATE_ADVANTAGES.map(({ id }) => id)).toEqual([
      "gpu-vector-path-tessellation-compositing",
      "retained-scene-scalability",
      "antialiasing-potential",
    ]);
    expect(STUDIO_VELLO_CANDIDATE_ADVANTAGES.every(
      ({ status }) => status === "candidate-hypothesis",
    )).toBe(true);
    expect(STUDIO_VELLO_CURRENT_RESEARCH_RISKS.map(({ id }) => id)).toEqual([
      "alpha-upstream-status",
      "web-not-primary-target",
      "browser-webgpu-coverage",
      "compute-shaders-required",
      "unfinished-rendering-work",
      "cpu-hybrid-maturity-split",
    ]);
    expect(STUDIO_VELLO_CURRENT_RESEARCH_RISKS
      .find(({ id }) => id === "unfinished-rendering-work")?.evidence)
      .toContain("GPU memory allocation");
  });

  it("makes every promotion criterion hard and keeps the weighted score bounded at 100", () => {
    expect(STUDIO_VELLO_PROMOTION_GATES.map(({ id }) => id)).toEqual([
      "official-web-support-maturity",
      "upstream-release-maturity",
      "webgpu-adapter-device-loss-recovery",
      "canvas-svg-canonical-visual-parity",
      "long-stroke-latency",
      "bounded-memory",
      "deterministic-legacy-compatibility-boundary",
      "required-browser-support",
    ]);
    expect(STUDIO_VELLO_PROMOTION_GATES.every(({ hard }) => hard)).toBe(true);
    expect(STUDIO_VELLO_PROMOTION_GATES.reduce(
      (total, gate) => total + gate.weight,
      0,
    )).toBe(100);
    expect(Object.isFrozen(STUDIO_VELLO_PROMOTION_GATES)).toBe(true);
    expect(STUDIO_VELLO_REQUIRED_BROWSER_TARGETS).toEqual([
      "chrome",
      "firefox",
      "safari",
    ]);
  });

  it("holds the audited 0.9.0 baseline at research-only without inventing benchmark evidence", () => {
    expect(STUDIO_VELLO_CURRENT_RESEARCH_EVIDENCE).toMatchObject({
      evaluatedVersion: "0.9.0",
      sourceCommit: "875f324f21da93019cae9e8e61d4abfd69893206",
      buildFingerprint: "unavailable:not-installed",
      officialWebSupport: {
        evaluatedVersion: "0.9.0",
        maturity: "not-primary-target",
        webIsPrimaryTarget: false,
      },
      upstreamMaturity: {
        evaluatedVersion: "0.9.0",
        releaseStage: "alpha",
        alphaLabelPresent: true,
      },
      webGpuRecovery: { probe: "not-run" },
      visualParity: { probe: "not-run" },
      longStrokeLatency: { probe: "not-run" },
      memory: { probe: "not-run" },
      legacyCompatibility: { probe: "not-run" },
    });
    expect(STUDIO_VELLO_CURRENT_RESEARCH_EVIDENCE.upstreamMaturity
      .productionBlockers).toEqual([
      "blur-and-filter-effects",
      "conflation-artifacts",
      "gpu-memory-allocation",
      "glyph-caching",
    ]);
    expect(STUDIO_VELLO_CURRENT_RESEARCH_EVIDENCE.browsers.map(
      ({ browser, support }) => [browser, support],
    )).toEqual([
      ["chrome", "tested"],
      ["firefox", "experimental"],
      ["safari", "experimental"],
    ]);
    expect(STUDIO_VELLO_CURRENT_CANDIDATE_EVALUATION).toMatchObject({
      candidateId: "vello",
      status: "research-only",
      reason: "hard-gate-failed",
      allHardGatesPassed: false,
      failClosed: true,
      runtimeActivationAllowed: false,
      dependencyInstallationAuthorized: false,
      canonicalAuthority: false,
      brushPixelAuthority: false,
      score: {
        earned: 0,
        possible: 100,
        percent: 0,
        passedGateCount: 0,
        totalGateCount: 8,
      },
      malformedGateIds: [],
    });
    expect(STUDIO_VELLO_CURRENT_CANDIDATE_EVALUATION.blockingGateIds)
      .toEqual(STUDIO_VELLO_PROMOTION_GATES.map(({ id }) => id));
  });

  it("caps a fully passing future audit at isolated-PoC eligibility, never runtime activation", () => {
    const evidence = passingEvidence();
    const score = scoreStudioVelloPromotionEvidence(evidence);
    const result = evaluateStudioVelloCandidate(evidence);

    expect(score).toEqual({
      earned: 100,
      possible: 100,
      percent: 100,
      passedGateCount: 8,
      totalGateCount: 8,
    });
    expect(result).toMatchObject({
      status: "eligible-for-isolated-poc",
      reason: "all-hard-gates-passed",
      promotionScope: "research-to-isolated-poc-only",
      allHardGatesPassed: true,
      failClosed: false,
      runtimeActivationAllowed: false,
      dependencyInstallationAuthorized: false,
      canonicalAuthority: false,
      brushPixelAuthority: false,
      score,
      blockingGateIds: [],
      malformedGateIds: [],
    });
    expect(result.gateResults.every(({ state, passed }) =>
      state === "passed" && passed
    )).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.gateResults)).toBe(true);
    expect(Object.isFrozen(result.score)).toBe(true);
  });

  it.each(HARD_GATE_FAILURES)(
    "does not let score compensate for failed hard gate $id",
    ({ id, fail }) => {
      const result = evaluateStudioVelloCandidate(fail(passingEvidence()));
      const gateWeight = STUDIO_VELLO_PROMOTION_GATES
        .find((gate) => gate.id === id)?.weight;

      expect(gateWeight).toBeTypeOf("number");
      expect(result.status).toBe("research-only");
      expect(result.reason).toBe("hard-gate-failed");
      expect(result.failClosed).toBe(true);
      expect(result.blockingGateIds).toEqual([id]);
      expect(result.malformedGateIds).toEqual([]);
      expect(result.score.earned).toBe(100 - (gateWeight ?? 0));
      expect(result.runtimeActivationAllowed).toBe(false);
    },
  );

  it("fails closed for absent or malformed evidence and rejects non-finite metrics", () => {
    const absent = evaluateStudioVelloCandidate(null);
    expect(absent).toMatchObject({
      status: "research-only",
      reason: "missing-or-malformed-evidence",
      failClosed: true,
      score: {
        earned: 0,
        percent: 0,
        passedGateCount: 0,
        totalGateCount: 8,
      },
    });
    expect(absent.malformedGateIds)
      .toEqual(STUDIO_VELLO_PROMOTION_GATES.map(({ id }) => id));

    const evidence = passingEvidence();
    const malformed = {
      ...evidence,
      longStrokeLatency: {
        ...evidence.longStrokeLatency,
        candidateP95Milliseconds: Number.NaN,
      },
    };
    const result = evaluateStudioVelloCandidate(malformed);
    expect(result).toMatchObject({
      status: "research-only",
      reason: "missing-or-malformed-evidence",
      blockingGateIds: ["long-stroke-latency"],
      malformedGateIds: ["long-stroke-latency"],
      score: {
        earned: 90,
        percent: 90,
        passedGateCount: 7,
      },
    });
    expect(evaluateStudioVelloPromotionGates({
      ...evidence,
      memory: {
        ...evidence.memory,
        peakGpuBytes: Number.POSITIVE_INFINITY,
      },
    }).find(({ id }) => id === "bounded-memory")?.state)
      .toBe("missing-or-malformed");
  });

  it("rejects version, source, or build evidence mixed across gate records", () => {
    const evidence = passingEvidence();
    const mixed = {
      ...evidence,
      webGpuRecovery: {
        ...evidence.webGpuRecovery,
        evaluatedVersion: "1.3.0",
      },
      visualParity: {
        ...evidence.visualParity,
        svg: {
          ...evidence.visualParity.svg,
          sourceCommit: "e".repeat(40),
        },
      },
      memory: {
        ...evidence.memory,
        buildFingerprint: `sha256:${"c".repeat(64)}`,
      },
      browsers: evidence.browsers.map((browser) => browser.browser === "firefox"
        ? { ...browser, sourceCommit: "d".repeat(40) }
        : browser),
    };
    const result = evaluateStudioVelloCandidate(mixed);

    expect(result.status).toBe("research-only");
    expect(result.reason).toBe("missing-or-malformed-evidence");
    expect(result.blockingGateIds).toEqual([
      "webgpu-adapter-device-loss-recovery",
      "canvas-svg-canonical-visual-parity",
      "bounded-memory",
      "required-browser-support",
    ]);
    expect(result.malformedGateIds).toEqual(result.blockingGateIds);
    expect(result.score).toMatchObject({
      earned: 50,
      passedGateCount: 4,
    });
  });

  it("requires version-pinned official sources and a content-addressed build", () => {
    const evidence = passingEvidence();
    const driftingDocs = evaluateStudioVelloCandidate({
      ...evidence,
      upstreamMaturity: {
        ...evidence.upstreamMaturity,
        sourceUrl: "https://docs.rs/vello_api/latest/vello_api/",
      },
    });
    expect(driftingDocs.malformedGateIds).toEqual([
      "upstream-release-maturity",
    ]);

    const noBuild = evaluateStudioVelloCandidate({
      ...evidence,
      buildFingerprint: "unavailable:not-installed",
      officialWebSupport: {
        ...evidence.officialWebSupport,
        buildFingerprint: "unavailable:not-installed",
      },
      upstreamMaturity: {
        ...evidence.upstreamMaturity,
        buildFingerprint: "unavailable:not-installed",
      },
      webGpuRecovery: {
        ...evidence.webGpuRecovery,
        buildFingerprint: "unavailable:not-installed",
      },
      visualParity: {
        ...evidence.visualParity,
        buildFingerprint: "unavailable:not-installed",
        canvas2d: {
          ...evidence.visualParity.canvas2d,
          buildFingerprint: "unavailable:not-installed",
        },
        svg: {
          ...evidence.visualParity.svg,
          buildFingerprint: "unavailable:not-installed",
        },
        canonical: {
          ...evidence.visualParity.canonical,
          buildFingerprint: "unavailable:not-installed",
        },
      },
      longStrokeLatency: {
        ...evidence.longStrokeLatency,
        buildFingerprint: "unavailable:not-installed",
      },
      memory: {
        ...evidence.memory,
        buildFingerprint: "unavailable:not-installed",
      },
      legacyCompatibility: {
        ...evidence.legacyCompatibility,
        buildFingerprint: "unavailable:not-installed",
      },
      browsers: evidence.browsers.map((browser) => ({
        ...browser,
        buildFingerprint: "unavailable:not-installed",
      })),
    });
    expect(noBuild).toMatchObject({
      status: "research-only",
      reason: "hard-gate-failed",
      allHardGatesPassed: false,
      score: {
        earned: 0,
        passedGateCount: 0,
      },
    });
    expect(noBuild.gateResults.every(({ detail }) =>
      detail.includes("content-addressed build fingerprint")
    )).toBe(true);
  });
});
