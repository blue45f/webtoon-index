#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const sourceDir = join(root, "apps/web/src/domains/creator/storyworld");
const outDir = mkdtempSync(join(tmpdir(), "toonspectrum-storyworld-"));
let checks = 0;

function checkEqual(actual, expected, message) {
  checks += 1;
  assert.equal(actual, expected, message);
}

function checkDeepEqual(actual, expected, message) {
  checks += 1;
  assert.deepEqual(actual, expected, message);
}

function checkOk(value, message) {
  checks += 1;
  assert.ok(value, message);
}

function healthyProject(engine) {
  return {
    schemaVersion: engine.STUDIO_STORYWORLD_SCHEMA_VERSION,
    id: "verify-healthy",
    title: "검증용 건강한 세계",
    productionCapacityMinutes: 120,
    metadata: { receiptTimestampIso: "2026-09-05T00:00:00.000Z" },
    characters: [{ id: "hero", name: "주인공", initialFactIds: ["door-open"] }],
    facts: [{
      id: "door-open",
      label: "문이 열려 있다",
      subjectId: "door",
      key: "open",
      initialValue: true,
      intendedReaderRevealOrder: 1,
    }],
    scenes: [{
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
    }],
  };
}

function validateCssCoverage() {
  const page = readFileSync(join(sourceDir, "StudioStoryworldLabPage.tsx"), "utf8");
  const css = readFileSync(join(sourceDir, "studio-storyworld-lab.css"), "utf8");
  const used = new Set();
  for (const match of page.matchAll(/storyworld-[a-z0-9_-]+/g)) used.add(match[0]);
  const nonClassTokens = new Set(["storyworld-causality", "storyworld-catalog", "storyworld-lab"]);
  const missing = [...used].filter((className) =>
    !nonClassTokens.has(className) && !css.includes(`.${className}`)
  );
  checkDeepEqual(missing, [], `CSS selectors missing for: ${missing.join(", ")}`);
  return used.size;
}

// Use the compiler installed by the lockfile, never a global tsc or permissive mock declarations.
function runTypeScript(args) {
  execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), ...args], {
    cwd: root,
    stdio: "inherit",
  });
}

function validateStrictSurfaceTypes() {
  runTypeScript(["--project", join(root, "tsconfig.json"), "--noEmit", "--incremental", "false", "--pretty", "false"]);
  checkOk(true, "real repository Storyworld UI/test typecheck");
}

function compileEngine() {
  const inputDir = join(outDir, "src");
  mkdirSync(inputDir, { recursive: true });
  const files = ["studio-storyworld-causality.ts", "studio-storyworld-catalog.ts"];
  for (const filename of files) {
    writeFileSync(join(inputDir, filename), readFileSync(join(sourceDir, filename)));
  }
  // A private CommonJS compilation boundary keeps require() independent of the repository's
  // package type. An explicit project avoids TypeScript 6's implicit-config CLI ambiguity.
  writeFileSync(join(outDir, "package.json"), JSON.stringify({ private: true, type: "commonjs" }));
  const config = join(outDir, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      strict: true,
      noEmit: false,
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2023", "DOM"],
      types: [],
      rootDir: inputDir,
      outDir: join(outDir, "compiled"),
    },
    files: files.map((filename) => join(inputDir, filename)),
  }, null, 2));
  runTypeScript(["--project", config, "--pretty", "false"]);
}

try {
  compileEngine();
  const engine = require(join(outDir, "compiled/studio-storyworld-causality.js"));
  const catalogue = require(join(outDir, "compiled/studio-storyworld-catalog.js"));

  const first = engine.analyzeStoryworldProject(engine.STORYWORLD_DEMO_PROJECT);
  const second = engine.analyzeStoryworldProject(engine.STORYWORLD_DEMO_PROJECT);
  checkDeepEqual(first.receipt, second.receipt, "proof receipt must be deterministic");
  checkDeepEqual(first.orderedSceneIds, ["s10", "s20", "s30", "s40"]);
  checkEqual(first.receipt.deterministic, true, "receipt must identify deterministic analysis");
  checkOk(/^[0-9a-f]{8}$/.test(first.receipt.projectFingerprint), "project fingerprint shape");
  checkOk(/^[0-9a-f]{8}$/.test(first.receipt.issueFingerprint), "issue fingerprint shape");
  checkEqual(first.worldTimeline.length, 4, "demo timeline projection");
  checkOk(first.knowledgeMatrix.some((row) => row.characterId === "haeun"), "knowledge projection");
  checkOk((first.production.utilizationPercent ?? 0) > 100, "demo production twin must surface overload");
  checkOk(first.repairProposals.length > 0, "explainable repair proposals");
  checkEqual(first.axisScores.length, 9, "all product quality axes must be scored");
  checkOk(first.axisScores.every((axis) => axis.score >= 0 && axis.score <= 100), "axis score bounds");
  const frontier = engine.rankStoryworldParetoFrontier([
    { id: "baseline", label: "기준", result: first },
    { id: "branch", label: "분기", result: engine.simulateStoryworldCounterfactual(
      engine.STORYWORLD_DEMO_PROJECT,
      { kind: "disable-scene", sceneId: "s20" },
    ).branch },
  ]);
  checkOk(frontier.some((candidate) => candidate.frontier), "Pareto frontier must retain an option");

  const expectedDemoCodes = [
    "knowledge-leak",
    "localization-overflow",
    "accessibility-gap",
    "rights-risk",
    "missing-provenance",
    "production-over-capacity",
  ];
  const demoCodes = new Set(first.issues.map((issue) => issue.code));
  for (const code of expectedDemoCodes) checkOk(demoCodes.has(code), `missing demo issue ${code}`);

  const healthy = engine.analyzeStoryworldProject(healthyProject(engine));
  checkEqual(healthy.issues.length, 0, "fully evidenced fixture should be issue-free");
  checkEqual(healthy.overallScore, 100);

  const branch = engine.simulateStoryworldCounterfactual(engine.STORYWORLD_DEMO_PROJECT, {
    kind: "disable-scene",
    sceneId: "s20",
  });
  checkDeepEqual(branch.impactedSceneIds, ["s20", "s30", "s40"]);
  checkOk(branch.branch.issues.some((issue) => issue.code === "inactive-dependency"));
  checkOk(branch.branch.issues.some((issue) =>
    issue.code === "contradicted-precondition" && issue.factId === "key-owned"
  ));
  checkOk(branch.scoreDelta < 0);

  const motifProject = healthyProject(engine);
  motifProject.motifs = [{ id: "bell", label: "종", minOccurrences: 2, maxGapScenes: 1 }];
  motifProject.scenes = [
    { ...motifProject.scenes[0], id: "a", order: 10, motifIds: ["bell"] },
    { ...motifProject.scenes[0], id: "b", order: 100, motifIds: [] },
    { ...motifProject.scenes[0], id: "c", order: 1000, motifIds: ["bell"] },
  ];
  const motifResult = engine.analyzeStoryworldProject(motifProject);
  checkEqual(motifResult.motifLedger[0].largestGapScenes, 1);
  checkOk(!motifResult.issues.some((issue) => issue.code === "motif-gap"));

  checkEqual(catalogue.STORYWORLD_CAPABILITIES.length, 50);
  checkEqual(
    new Set(catalogue.STORYWORLD_CAPABILITIES.map((capability) => capability.id)).size,
    50,
    "capability ids must be unique",
  );
  const maturityCounts = catalogue.storyworldCapabilityCounts();
  checkEqual(maturityCounts.engine + maturityCounts.adapter + maturityCounts.experimental, 50);

  validateStrictSurfaceTypes();
  const styledClassCount = validateCssCoverage();

  console.log(JSON.stringify({
    status: "passed",
    checks,
    demoScore: first.overallScore,
    demoIssueCount: first.issues.length,
    branchScoreDelta: branch.scoreDelta,
    capabilityCount: catalogue.STORYWORLD_CAPABILITIES.length,
    maturityCounts,
    styledClassCount,
    projectFingerprint: first.receipt.projectFingerprint,
    issueFingerprint: first.receipt.issueFingerprint,
  }, null, 2));
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
