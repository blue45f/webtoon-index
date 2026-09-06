import { describe, expect, it } from "vitest";

import {
  buildStudioVrmComponentCapturePlan,
  type StudioVrmRenderableDescriptor,
} from "./studio-vrm-component-pass-plan";

function descriptor(
  objectId: string,
  objectName: string,
  overrides: Partial<StudioVrmRenderableDescriptor> = {},
): StudioVrmRenderableDescriptor {
  return Object.freeze({ objectId, objectName, ...overrides });
}

describe("VRM semantic component capture planning", () => {
  it("lets explicit Blender/ToonStudio metadata win over misleading names", () => {
    const plan = buildStudioVrmComponentCapturePlan([
      descriptor("mesh-hair", "Hair_Cap", {
        materialId: "material-skin",
        materialName: "SkinFace",
        materialUserData: { toonstudio_role: "clothes" },
      }),
    ]);
    expect(plan.classifications).toEqual([
      expect.objectContaining({
        renderableId: "mesh-hair:material-skin",
        component: "clothes",
        confidence: "explicit",
      }),
    ]);
    expect(plan.requests.find((request) => request.id === "clothes")?.includeRenderableIds).toEqual([
      "mesh-hair:material-skin",
    ]);
    expect(plan.requiresReview).toBe(false);
  });

  it("builds deterministic webtoon passes from conservative name classification", () => {
    const source = [
      descriptor("mesh-clothes", "Hero_Jacket", { materialName: "Outfit_Blue" }),
      descriptor("mesh-eye", "Eye.L", { materialName: "Iris" }),
      descriptor("mesh-hair", "Hair_Bangs", { materialName: "Hair_Base" }),
      descriptor("mesh-skin", "Face", { materialName: "Skin" }),
      descriptor("mesh-prop", "Glasses", { materialName: "Accessory" }),
    ];
    const plan = buildStudioVrmComponentCapturePlan(source);
    const reordered = buildStudioVrmComponentCapturePlan([...source].reverse());

    expect(plan.signature).toBe(reordered.signature);
    expect(plan.classifications.map(({ component }) => component).sort()).toEqual([
      "clothes", "eyes", "hair", "props", "skin",
    ]);
    expect(plan.requests.map(({ id }) => id)).toEqual([
      "line",
      "highlight",
      "props",
      "clothes",
      "hair",
      "eyes",
      "skin",
      "shadow",
      "base-color",
      "material-id",
      "depth",
    ]);
    expect(plan.requests.filter(({ utility }) => utility).map(({ id }) => id)).toEqual([
      "material-id",
      "depth",
    ]);
    expect(plan.requiresReview).toBe(false);
  });

  it("keeps ambiguous or unsupported surfaces visible in global passes but requires review", () => {
    const plan = buildStudioVrmComponentCapturePlan([
      descriptor("mesh-unknown", "Mesh_042", { materialName: "Material_01" }),
      descriptor("mesh-ambiguous", "Hair_Jacket", { materialName: "Skin_Outfit" }),
    ]);
    expect(plan.unclassifiedRenderableIds).toContain("mesh-unknown");
    expect(plan.requiresReview).toBe(true);
    expect(plan.requests.find(({ id }) => id === "base-color")?.includeRenderableIds).toEqual([
      "mesh-ambiguous",
      "mesh-unknown",
    ]);
  });

  it("excludes hidden renderables without letting malformed hidden IDs poison future plans", () => {
    const plan = buildStudioVrmComponentCapturePlan([
      descriptor("visible", "Hair", { visible: true }),
      descriptor("hidden", "Outfit", { visible: false }),
    ]);
    expect(plan.renderableCount).toBe(2);
    expect(plan.visibleRenderableCount).toBe(1);
    expect(plan.classifications.map(({ renderableId }) => renderableId)).toEqual(["visible"]);
    expect(plan.requests.every(({ includeRenderableIds }) => !includeRenderableIds.includes("hidden"))).toBe(true);
  });

  it("fails closed on empty input, duplicate IDs, invalid metadata, and unbounded scenes", () => {
    expect(() => buildStudioVrmComponentCapturePlan([])).toThrow(/at least one/u);
    expect(() => buildStudioVrmComponentCapturePlan([
      descriptor("same", "Hair"),
      descriptor("same", "Skin"),
    ])).toThrow(/duplicate/u);
    // `:` is deliberately allowed — glTF/VRM node paths use it, along with `/`, `@`, `.`, `-`.
    // A space is what the rule actually rejects.
    expect(() => buildStudioVrmComponentCapturePlan([
      descriptor("bad id", "Hair"),
    ])).toThrow(/unsupported identifier/u);
    expect(() => buildStudioVrmComponentCapturePlan([
      descriptor("mesh", "Hair", { objectUserData: { toonstudioComponent: "not-a-component" } }),
    ])).not.toThrow();
    expect(() => buildStudioVrmComponentCapturePlan(
      Array.from({ length: 20_001 }, (_, index) => descriptor(`mesh-${index}`, "Hair")),
    )).toThrow(/20000/u);
  });
});
