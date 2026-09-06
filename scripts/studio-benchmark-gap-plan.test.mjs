import assert from "node:assert/strict";
import nodeTest from "node:test";
import { test as vitestTest } from "vitest";

const test = process.env.VITEST ? vitestTest : nodeTest;

import {
  buildStudioBenchmarkGapPlan,
  renderStudioBenchmarkGapPlanMarkdown,
  scoreStudioBenchmarkProductAgainstLane,
} from "./studio-benchmark-gap-plan.mjs";

const CAMPAIGN = {
  campaignId: "test-campaign",
  lanes: [
    {
      id: "text-lettering",
      title: "Text, fonts, balloons, lettering, and multilingual layout",
      issueQueue: [584],
      focusTerms: ["text", "font", "balloon", "lettering", "ruby", "vertical", "typography"],
      fallbackTracks: ["balloon-lettering", "multilingual-text"],
      pathHints: ["apps/web/src/domains/creator/*text*"],
    },
    {
      id: "comic-pages-panels",
      title: "Comic pages, panels, gutters, templates, and pagination",
      issueQueue: [585],
      focusTerms: ["panel", "page", "comic", "episode", "gutter", "template", "pagination"],
      fallbackTracks: ["panel-authoring", "episode-workflow"],
      pathHints: ["apps/web/src/domains/creator/*panel*"],
    },
    {
      id: "three-d-rig-pose",
      title: "3D rigs, humanoids, IK, pose, morphs, and retargeting",
      issueQueue: [588],
      focusTerms: ["rig", "pose", "ik", "humanoid", "morph", "retarget", "skeleton"],
      fallbackTracks: ["pose-library", "motion-retargeting"],
      pathHints: ["apps/web/src/domains/creator/bg3d/*pose*"],
    },
    {
      id: "import-export",
      title: "Import, export, interchange, PSD, archives, and clipboard",
      issueQueue: [575],
      focusTerms: ["import", "export", "psd", "archive", "format", "round-trip"],
      fallbackTracks: ["psd-round-trip", "export-quality"],
      pathHints: ["apps/web/src/domains/creator/*export*"],
    },
    {
      id: "quality-delivery",
      title: "Diagnostics, startup, delivery, offline, and publication quality",
      issueQueue: [592],
      focusTerms: ["quality", "delivery", "diagnostic", "offline", "startup", "publication"],
      fallbackTracks: ["production-smoke"],
      pathHints: ["scripts/verify-*"],
    },
  ],
};

function registry(id, products) {
  return { id, document: { schemaVersion: 1, products } };
}

test("explicit lane hints outrank lexical similarity while retaining matched evidence", () => {
  const product = {
    id: "tool",
    name: "Tool",
    priority: "P0",
    focus: ["automatic-speech-bubbles", "vertical-scroll"],
    laneHints: ["text-lettering"],
    registryIds: ["test"],
  };
  const lanes = CAMPAIGN.lanes.map((lane) => ({
    id: lane.id,
    title: lane.title,
    issueQueue: lane.issueQueue,
    phrases: new Set([lane.id, ...lane.focusTerms]),
    words: new Set(lane.focusTerms),
  }));
  const text = scoreStudioBenchmarkProductAgainstLane(product, lanes[0]);
  const comic = scoreStudioBenchmarkProductAgainstLane(product, lanes[1]);
  assert.ok(text.score > comic.score);
  assert.ok(text.matchedFocus.includes("automatic-speech-bubbles"));
});

test("semantic aliases map webtoon workflow features into implementation lanes", () => {
  const plan = buildStudioBenchmarkGapPlan({
    campaign: CAMPAIGN,
    generatedAt: "2026-09-03T00:00:00.000Z",
    registries: [
      registry("ecosystem", [
        {
          id: "webtoon-suite",
          name: "Webtoon Suite",
          priority: "P0",
          focus: [
            "automatic-speech-bubbles",
            "vertical-scroll",
            "camera-pose-capture",
            "layered-psd-export",
          ],
        },
      ]),
    ],
  });

  const top = plan.products[0].topLanes.map((lane) => lane.laneId);
  assert.ok(top.includes("text-lettering"));
  assert.ok(top.includes("comic-pages-panels") || top.includes("import-export"));
  assert.equal(plan.stats.mappedProductCount, 1);
});

test("duplicate products merge focus, lane hints, registries, and strongest priority", () => {
  const plan = buildStudioBenchmarkGapPlan({
    campaign: CAMPAIGN,
    generatedAt: "2026-09-03T00:00:00.000Z",
    registries: [
      registry("major", [
        {
          id: "same-tool",
          name: "Same Tool",
          priority: "P1",
          focus: ["vertical-scroll"],
        },
      ]),
      registry("startup", [
        {
          id: "same-tool",
          name: "Same Tool",
          priority: "P0",
          focus: ["layered-psd-export"],
          laneHints: ["import-export"],
        },
      ]),
    ],
  });

  assert.equal(plan.products.length, 1);
  assert.equal(plan.products[0].priority, "P0");
  assert.deepEqual(plan.products[0].registryIds.sort(), ["major", "startup"]);
  assert.deepEqual(plan.products[0].focus.sort(), ["layered-psd-export", "vertical-scroll"]);
  assert.equal(plan.products[0].topLanes[0].laneId, "import-export");
});

test("unmapped products remain explicit instead of being assigned by priority alone", () => {
  const plan = buildStudioBenchmarkGapPlan({
    campaign: CAMPAIGN,
    generatedAt: "2026-09-03T00:00:00.000Z",
    registries: [
      registry("unknown", [
        {
          id: "mystery",
          name: "Mystery",
          priority: "P0",
          focus: ["quantum-banjo-resonance"],
        },
      ]),
    ],
  });

  assert.deepEqual(plan.unmappedProducts, ["mystery"]);
  assert.equal(plan.products[0].topLanes.length, 0);
  assert.deepEqual(plan.products[0].unmappedFocus, ["quantum-banjo-resonance"]);
});

test("plan and markdown are deterministic for the same inputs", () => {
  const input = {
    campaign: CAMPAIGN,
    generatedAt: "2026-09-03T00:00:00.000Z",
    registries: [
      registry("ecosystem", [
        {
          id: "creator-tool",
          name: "Creator Tool",
          priority: "P0",
          focus: ["vertical-scroll", "creator-analytics"],
          laneHints: ["comic-pages-panels", "quality-delivery"],
        },
      ]),
    ],
  };
  const first = buildStudioBenchmarkGapPlan(input);
  const second = buildStudioBenchmarkGapPlan(input);
  assert.deepEqual(second, first);

  const markdown = renderStudioBenchmarkGapPlanMarkdown(first);
  assert.match(markdown, /Studio benchmark → implementation lane plan/u);
  assert.match(markdown, /comic-pages-panels · #585/u);
  assert.match(markdown, /Creator Tool/u);
});
