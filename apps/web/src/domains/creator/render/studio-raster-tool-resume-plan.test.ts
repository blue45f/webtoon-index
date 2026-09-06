import { describe, expect, it } from "vitest";

import {
  STUDIO_RASTER_TOOL_IDS,
  type StudioRasterToolId,
} from "./studio-raster-tool-availability";
import {
  resolveStudioRasterToolResumePlan,
  type StudioRasterToolResumePlan,
} from "./studio-raster-tool-resume-plan";

const EXPECTED_PLANS = {
  "paint-bucket": {
    kind: "no-automatic-resume",
    toolId: "paint-bucket",
    reason: "explicit-canvas-point-required",
  },
  filter: {
    kind: "no-automatic-resume",
    toolId: "filter",
    reason: "explicit-filter-choice-required",
  },
  "pixel-marquee": {
    kind: "activate-selection",
    toolId: "pixel-marquee",
    selectionTool: "rect",
  },
  "pixel-lasso": {
    kind: "activate-selection",
    toolId: "pixel-lasso",
    selectionTool: "lasso",
  },
  "magic-wand": {
    kind: "activate-selection",
    toolId: "magic-wand",
    selectionTool: "wand",
  },
  "pixel-transform": {
    kind: "open-inspector",
    toolId: "pixel-transform",
    inspectorRoute: { primary: "properties", image: "retouch" },
    nextRequirement: "make-pixel-selection",
  },
  "content-aware-fill": {
    kind: "open-inspector",
    toolId: "content-aware-fill",
    inspectorRoute: { primary: "properties", image: "retouch" },
    nextRequirement: "make-pixel-selection",
  },
  crop: {
    kind: "start-crop",
    toolId: "crop",
    inspectorRoute: { primary: "properties", image: "transform" },
  },
  smudge: {
    kind: "arm-retouch",
    toolId: "smudge",
    retouchTool: "smudge",
  },
  "dodge-burn": {
    kind: "arm-retouch",
    toolId: "dodge-burn",
    retouchTool: "dodge-burn",
  },
  "wet-mix": {
    kind: "arm-retouch",
    toolId: "wet-mix",
    retouchTool: "wet-mix",
  },
  liquify: {
    kind: "arm-retouch",
    toolId: "liquify",
    retouchTool: "liquify",
  },
  heal: {
    kind: "open-inspector",
    toolId: "heal",
    inspectorRoute: { primary: "properties", image: "retouch" },
    nextRequirement: "pick-clone-source",
  },
  "clone-stamp": {
    kind: "open-inspector",
    toolId: "clone-stamp",
    inspectorRoute: { primary: "properties", image: "retouch" },
    nextRequirement: "pick-clone-source",
  },
  "history-brush": {
    kind: "open-inspector",
    toolId: "history-brush",
    inspectorRoute: { primary: "properties", image: "retouch" },
    nextRequirement: "pick-history-source",
  },
  "puppet-warp": {
    kind: "open-inspector",
    toolId: "puppet-warp",
    inspectorRoute: { primary: "properties", image: "transform" },
    nextRequirement: "move-puppet-pin",
  },
  "layer-mask": {
    kind: "open-inspector",
    toolId: "layer-mask",
    inspectorRoute: { primary: "properties", image: "mask" },
    nextRequirement: "choose-layer-mask-action",
  },
  "frame-animation": {
    kind: "no-automatic-resume",
    toolId: "frame-animation",
    reason: "explicit-frame-action-required",
  },
} satisfies Readonly<Record<StudioRasterToolId, StudioRasterToolResumePlan>>;

describe("resolveStudioRasterToolResumePlan", () => {
  it("keeps the exhaustive resume contract in sync with every canonical raster tool ID", () => {
    expect(Object.keys(EXPECTED_PLANS).sort()).toEqual(
      [...STUDIO_RASTER_TOOL_IDS].sort(),
    );
  });

  it.each(STUDIO_RASTER_TOOL_IDS)(
    "returns the deterministic post-composite plan for %s",
    (toolId) => {
      expect(resolveStudioRasterToolResumePlan(toolId)).toEqual(
        EXPECTED_PLANS[toolId],
      );
    },
  );

  it.each(["paint-bucket", "filter", "frame-animation"] as const)(
    "fails closed instead of automatically applying %s",
    (toolId) => {
      expect(resolveStudioRasterToolResumePlan(toolId).kind).toBe(
        "no-automatic-resume",
      );
    },
  );
});
