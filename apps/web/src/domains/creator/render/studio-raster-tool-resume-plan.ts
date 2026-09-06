import type { StudioRasterToolId } from "./studio-raster-tool-availability";

export type StudioRasterRetouchResumeToolId =
  | "smudge"
  | "dodge-burn"
  | "wet-mix"
  | "liquify";

export type StudioRasterSelectionResumeToolId =
  | "pixel-marquee"
  | "pixel-lasso"
  | "magic-wand";

export interface StudioRasterSelectionResumeToolMap {
  readonly "pixel-marquee": "rect";
  readonly "pixel-lasso": "lasso";
  readonly "magic-wand": "wand";
}

export type StudioRasterInspectorResumeToolId =
  | "pixel-transform"
  | "content-aware-fill"
  | "heal"
  | "clone-stamp"
  | "history-brush"
  | "puppet-warp"
  | "layer-mask";

export type StudioRasterInspectorResumeSection =
  | "retouch"
  | "mask"
  | "transform";

export type StudioRasterInspectorNextRequirement =
  | "make-pixel-selection"
  | "pick-clone-source"
  | "pick-history-source"
  | "move-puppet-pin"
  | "choose-layer-mask-action";

export interface StudioRasterInspectorResumeSpec {
  readonly "pixel-transform": {
    readonly section: "retouch";
    readonly nextRequirement: "make-pixel-selection";
  };
  readonly "content-aware-fill": {
    readonly section: "retouch";
    readonly nextRequirement: "make-pixel-selection";
  };
  readonly heal: {
    readonly section: "retouch";
    readonly nextRequirement: "pick-clone-source";
  };
  readonly "clone-stamp": {
    readonly section: "retouch";
    readonly nextRequirement: "pick-clone-source";
  };
  readonly "history-brush": {
    readonly section: "retouch";
    readonly nextRequirement: "pick-history-source";
  };
  readonly "puppet-warp": {
    readonly section: "transform";
    readonly nextRequirement: "move-puppet-pin";
  };
  readonly "layer-mask": {
    readonly section: "mask";
    readonly nextRequirement: "choose-layer-mask-action";
  };
}

export type StudioRasterFailClosedResumeToolId =
  | "paint-bucket"
  | "filter"
  | "frame-animation";

export interface StudioRasterFailClosedResumeReasonMap {
  readonly "paint-bucket": "explicit-canvas-point-required";
  readonly filter: "explicit-filter-choice-required";
  readonly "frame-animation": "explicit-frame-action-required";
}

export type StudioRasterRetouchResumePlan = {
  [ToolId in StudioRasterRetouchResumeToolId]: {
    readonly kind: "arm-retouch";
    readonly toolId: ToolId;
    readonly retouchTool: ToolId;
  };
}[StudioRasterRetouchResumeToolId];

export interface StudioRasterCropResumePlan {
  readonly kind: "start-crop";
  readonly toolId: "crop";
  readonly inspectorRoute: {
    readonly primary: "properties";
    readonly image: "transform";
  };
}

export type StudioRasterSelectionResumePlan = {
  [ToolId in StudioRasterSelectionResumeToolId]: {
    readonly kind: "activate-selection";
    readonly toolId: ToolId;
    readonly selectionTool: StudioRasterSelectionResumeToolMap[ToolId];
  };
}[StudioRasterSelectionResumeToolId];

export type StudioRasterInspectorResumePlan = {
  [ToolId in StudioRasterInspectorResumeToolId]: {
    readonly kind: "open-inspector";
    readonly toolId: ToolId;
    readonly inspectorRoute: {
      readonly primary: "properties";
      readonly image: StudioRasterInspectorResumeSpec[ToolId]["section"];
    };
    readonly nextRequirement: StudioRasterInspectorResumeSpec[ToolId]["nextRequirement"];
  };
}[StudioRasterInspectorResumeToolId];

export type StudioRasterFailClosedResumePlan = {
  [ToolId in StudioRasterFailClosedResumeToolId]: {
    readonly kind: "no-automatic-resume";
    readonly toolId: ToolId;
    readonly reason: StudioRasterFailClosedResumeReasonMap[ToolId];
  };
}[StudioRasterFailClosedResumeToolId];

export type StudioRasterToolResumePlan =
  | StudioRasterRetouchResumePlan
  | StudioRasterCropResumePlan
  | StudioRasterSelectionResumePlan
  | StudioRasterInspectorResumePlan
  | StudioRasterFailClosedResumePlan;

type StudioRasterToolResumePlanFor<ToolId extends StudioRasterToolId> =
  Extract<StudioRasterToolResumePlan, { readonly toolId: ToolId }>;

type StudioRasterToolResumePlanRecord = {
  readonly [ToolId in StudioRasterToolId]: StudioRasterToolResumePlanFor<ToolId>;
};

const STUDIO_RASTER_TOOL_RESUME_PLANS = {
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
} satisfies StudioRasterToolResumePlanRecord;

/**
 * Chooses the interaction that should follow creation of an editable page composite.
 *
 * Destructive or point-sensitive tools deliberately return `no-automatic-resume`: creating the
 * raster target must never also fill pixels, apply a filter, or mutate an animation frame.
 */
export function resolveStudioRasterToolResumePlan(
  toolId: StudioRasterToolId,
): StudioRasterToolResumePlan {
  return STUDIO_RASTER_TOOL_RESUME_PLANS[toolId];
}
