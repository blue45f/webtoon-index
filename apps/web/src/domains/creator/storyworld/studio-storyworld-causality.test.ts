import { describe, expect, it } from "vitest";

import {
  STORYWORLD_CAPABILITIES,
  storyworldCapabilityCounts,
} from "./studio-storyworld-catalog";
import {
  STORYWORLD_DEMO_PROJECT,
  STUDIO_STORYWORLD_SCHEMA_VERSION,
  analyzeStoryworldProject,
  fingerprintStoryworldValue,
  rankStoryworldParetoFrontier,
  simulateStoryworldCounterfactual,
  type StoryworldProject,
} from "./studio-storyworld-causality";

function healthyProject(): StoryworldProject {
  return {
    schemaVersion: STUDIO_STORYWORLD_SCHEMA_VERSION,
    id: "healthy",
    title: "건강한 세계",
    productionCapacityMinutes: 120,
    metadata: { receiptTimestampIso: "2026-09-05T00:00:00.000Z" },
    characters: [
      { id: "hero", name: "주인공", initialFactIds: ["door-open"] },
    ],
    facts: [
      {
        id: "door-open",
        label: "문이 열려 있다",
        subjectId: "door",
        key: "open",
        initialValue: true,
        intendedReaderRevealOrder: 1,
      },
    ],
    scenes: [
      {
        id: "scene-1",
        title: "열린 문",
        order: 1,
        participantIds: ["hero"],
        preconditions: [{ factId: "door-open", comparator: "equals", value: true }],
        knowledgeUses: [{ characterId: "hero", factId: "door-open" }],
        reveals: [{ factId: "door-open", audiences: ["reader"] }],
        emotionalBeats: [{ characterId: "hero", valence: 0.1, arousal: 0.2 }],
        localization: [{
          locale: "en-US",
          sourceCharacters: 6,
          translatedCharacters: 7,
          balloonCapacityCharacters: 10,
        }],
        accessibility: {
          logicalReadingOrder: true,
          nonColorCue: true,
          textAlternative: true,
          soundMeaningVisualized: true,
          reducedMotionEquivalent: true,
        },
        assets: [{
          assetId: "door-bg",
          label: "문 배경",
          revision: "sha256:door",
          licenseStatus: "cleared",
          consentStatus: "not-required",
          reusable: true,
        }],
        production: {
          drawingMinutes: 30,
          letteringMinutes: 10,
          renderMinutes: 5,
          reviewMinutes: 5,
          complexity: 3,
        },
      },
    ],
  };
}

describe("Storyworld causality engine", () => {
  it("runs the demo as a deterministic narrative digital twin", () => {
    const first = analyzeStoryworldProject(STORYWORLD_DEMO_PROJECT);
    const second = analyzeStoryworldProject(STORYWORLD_DEMO_PROJECT);

    expect(first.receipt).toEqual(second.receipt);
    expect(first.orderedSceneIds).toEqual(["s10", "s20", "s30", "s40"]);
    const codes = first.issues.map((issue) => issue.code);
    for (const expectedCode of [
      "knowledge-leak",
      "localization-overflow",
      "accessibility-gap",
      "rights-risk",
      "missing-provenance",
      "production-over-capacity",
    ] as const) {
      expect(codes).toContain(expectedCode);
    }
    expect(first.worldTimeline).toHaveLength(4);
    expect(first.knowledgeMatrix.find((row) => row.characterId === "haeun")?.knownFactIds)
      .toContain("dojin-is-brother");
  });

  it("keeps a fully evidenced project issue-free", () => {
    const result = analyzeStoryworldProject(healthyProject());

    expect(result.issues).toEqual([]);
    expect(result.overallScore).toBe(100);
    expect(result.production.utilizationPercent).toBe(42);
    expect(result.receipt.deterministic).toBe(true);
  });

  it("finds the causal impact cone when a required scene is disabled", () => {
    const branch = simulateStoryworldCounterfactual(STORYWORLD_DEMO_PROJECT, {
      kind: "disable-scene",
      sceneId: "s20",
    });

    expect(branch.impactedSceneIds).toEqual(["s20", "s30", "s40"]);
    expect(branch.branch.issues.some((issue) =>
      issue.code === "inactive-dependency" && issue.sceneId === "s30"
    )).toBe(true);
    expect(branch.branch.issues.some((issue) =>
      issue.code === "contradicted-precondition" && issue.factId === "key-owned"
    )).toBe(true);
    expect(branch.scoreDelta).toBeLessThan(0);
  });

  it("rejects dependencies that occur after their dependent scene", () => {
    const project = healthyProject();
    const shifted: StoryworldProject = {
      ...project,
      scenes: [
        { ...project.scenes[0], id: "later", title: "나중 원인", order: 20 },
        {
          ...project.scenes[0],
          id: "earlier",
          title: "먼저 나온 결과",
          order: 10,
          dependsOnSceneIds: ["later"],
        },
      ],
    };

    expect(analyzeStoryworldProject(shifted).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "dependency-order", sceneId: "earlier" }),
    ]));
  });

  it("distinguishes character knowledge from author knowledge", () => {
    const project = healthyProject();
    const withoutInitialKnowledge: StoryworldProject = {
      ...project,
      characters: [{ id: "hero", name: "주인공" }],
      scenes: [
        {
          ...project.scenes[0],
          id: "use-too-soon",
          title: "너무 이른 사용",
          order: 1,
          reveals: [],
        },
        {
          ...project.scenes[0],
          id: "learn",
          title: "학습",
          order: 2,
          knowledgeUses: [],
          reveals: [{ factId: "door-open", audiences: ["hero", "reader"] }],
        },
        {
          ...project.scenes[0],
          id: "use-after-learning",
          title: "학습 후 사용",
          order: 3,
          reveals: [],
        },
      ],
    };
    const result = analyzeStoryworldProject(withoutInitialKnowledge);
    const leaks = result.issues.filter((issue) => issue.code === "knowledge-leak");

    expect(leaks).toHaveLength(1);
    expect(leaks[0]?.sceneId).toBe("use-too-soon");
  });

  it("treats motif gaps as intervening scenes rather than numeric order labels", () => {
    const project = healthyProject();
    const motifProject: StoryworldProject = {
      ...project,
      motifs: [{ id: "bell", label: "종", minOccurrences: 2, maxGapScenes: 1 }],
      scenes: [
        { ...project.scenes[0], id: "a", order: 10, motifIds: ["bell"] },
        { ...project.scenes[0], id: "b", order: 100, motifIds: [] },
        { ...project.scenes[0], id: "c", order: 1000, motifIds: ["bell"] },
      ],
    };
    const result = analyzeStoryworldProject(motifProject);

    expect(result.motifLedger[0]?.largestGapScenes).toBe(1);
    expect(result.issues.some((issue) => issue.code === "motif-gap")).toBe(false);
  });

  it("reports early reveals and missed reveal contracts separately", () => {
    const project = healthyProject();
    const revealProject: StoryworldProject = {
      ...project,
      facts: [
        { ...project.facts[0], id: "early", intendedReaderRevealOrder: 10 },
        { ...project.facts[0], id: "missed", intendedReaderRevealOrder: 1 },
      ],
      characters: [{ id: "hero", name: "주인공", initialFactIds: ["early"] }],
      scenes: [{
        ...project.scenes[0],
        preconditions: [],
        knowledgeUses: [],
        reveals: [{ factId: "early", audiences: ["reader"] }],
      }],
    };
    const codes = analyzeStoryworldProject(revealProject).issues.map((issue) => issue.code);

    expect(codes).toContain("premature-reader-reveal");
    expect(codes).toContain("reader-reveal-missed");
  });

  it("keeps creative trade-offs explicit with a Pareto frontier", () => {
    const healthy = analyzeStoryworldProject(healthyProject());
    const { accessibility: _accessibility, ...sceneWithoutAccessibility } = healthyProject().scenes[0];
    const risky = analyzeStoryworldProject({
      ...healthyProject(),
      scenes: [sceneWithoutAccessibility],
    });
    const candidates = rankStoryworldParetoFrontier([
      { id: "healthy", label: "건강", result: healthy },
      { id: "risky", label: "위험", result: risky },
    ]);

    expect(candidates.find((item) => item.id === "healthy")?.frontier).toBe(true);
    expect(candidates.find((item) => item.id === "healthy")?.dominatesIds).toContain("risky");
    expect(candidates.find((item) => item.id === "risky")?.dominatedByIds).toContain("healthy");
  });

  it("creates stable fingerprints independent of object key order", () => {
    expect(fingerprintStoryworldValue({ a: 1, b: 2 })).toBe(
      fingerprintStoryworldValue({ b: 2, a: 1 }),
    );
  });
});

describe("Storyworld creative capability catalogue", () => {
  it("ships fifty unique, maturity-labelled expansion contracts", () => {
    const ids = STORYWORLD_CAPABILITIES.map((capability) => capability.id);
    const counts = storyworldCapabilityCounts();

    expect(STORYWORLD_CAPABILITIES).toHaveLength(50);
    expect(new Set(ids).size).toBe(ids.length);
    expect(counts.engine + counts.adapter + counts.experimental).toBe(50);
    expect(counts.engine).toBeGreaterThan(20);
    expect(counts.adapter).toBeGreaterThan(15);
  });
});
