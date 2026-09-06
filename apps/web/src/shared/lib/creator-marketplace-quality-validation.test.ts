import { describe, expect, it } from "vitest";

import {
  CREATOR_MARKETPLACE_REQUIRED_QUALITY_SCENARIOS,
  createCreatorMarketplaceAuthoringDraft,
  validateCreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringDraft,
  type CreatorMarketplaceAuthoringKind,
} from "./creator-marketplace-authoring-workshop";

function validDraft(kind: CreatorMarketplaceAuthoringKind): CreatorMarketplaceAuthoringDraft {
  const draft = createCreatorMarketplaceAuthoringDraft(kind);
  return {
    ...draft,
    title: `${kind} production asset`,
    summary: "A complete reusable asset prepared for marketplace installation.",
    description: "This listing describes the recommended workflow, compatibility, limitations and installation behavior in enough detail.",
    tags: [kind, "production"],
    technical: {
      ...draft.technical,
      qualityScenarios: CREATOR_MARKETPLACE_REQUIRED_QUALITY_SCENARIOS[kind],
    },
    media: [{
      id: "preview",
      kind: kind === "brush" ? "stroke-sheet" as const : "image" as const,
      name: "Quality preview",
      alt: `${kind} quality scenario result`,
    }],
    rights: {
      ...draft.rights,
      originalWorkAttested: true,
      previewRightsAttested: true,
    },
  };
}

describe("marketplace asset quality validation", () => {
  it.each([
    "brush",
    "tone",
    "palette",
    "pose",
    "3d",
    "background",
    "bubble",
    "template",
    "material",
  ] as const)("requires the %s quality plan before submission", (kind) => {
    const withoutPlan = validDraft(kind);
    withoutPlan.technical = {};
    const missing = validateCreatorMarketplaceAuthoringDraft(withoutPlan);
    expect(missing.map((item) => item.id)).toContain("quality-plan");

    const complete = validateCreatorMarketplaceAuthoringDraft(validDraft(kind));
    expect(complete.map((item) => item.id)).not.toContain("quality-plan");
  });

  it("blocks preview media without accessible descriptions", () => {
    const draft = validDraft("3d");
    draft.media = [{ id: "turntable", kind: "turntable", name: "Turntable", alt: "" }];
    expect(validateCreatorMarketplaceAuthoringDraft(draft).map((item) => item.id))
      .toContain("preview-alt");
  });

  it("blocks incomplete dependency records", () => {
    const draft = validDraft("template");
    draft.bundle = [{
      id: "font",
      kind: "font",
      name: "",
      required: true,
      role: "",
    }];
    expect(validateCreatorMarketplaceAuthoringDraft(draft).map((item) => item.id))
      .toContain("bundle-metadata");
  });
});
