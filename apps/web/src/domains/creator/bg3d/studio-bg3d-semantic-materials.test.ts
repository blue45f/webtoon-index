import { describe, expect, it } from "vitest";

import {
  classifyStudioBg3dSemanticMaterials,
  createStudioBg3dSemanticRenderPassPlan,
  STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS,
  STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND,
  STUDIO_BG3D_SEMANTIC_RENDER_PASS_KINDS,
  type StudioBg3dSemanticMaterialAssignment,
  type StudioBg3dSemanticMaterialDescriptor,
  type StudioBg3dSemanticRenderPassPlan,
} from "./studio-bg3d-semantic-materials";

function assignments(
  descriptors: readonly StudioBg3dSemanticMaterialDescriptor[],
): readonly StudioBg3dSemanticMaterialAssignment[] {
  const result = classifyStudioBg3dSemanticMaterials(descriptors);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.assignments;
}

function plan(
  selections: unknown,
  kind: unknown,
  options?: unknown,
): StudioBg3dSemanticRenderPassPlan {
  const result = createStudioBg3dSemanticRenderPassPlan(selections, kind, options);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.plan;
}

describe("Studio BG3D semantic material suggestions", () => {
  it("classifies character and environment slots from weighted multilingual material metadata", () => {
    const result = classifyStudioBg3dSemanticMaterials([
      { materialKey: "material-0", materialName: "Face_Skin_01" },
      { materialKey: "material-1", meshNames: ["CharacterHairMesh"] },
      { materialKey: "material-2", materialName: "캐릭터_홍채_재질" },
      { materialKey: "material-3", materialName: "Hero_Jacket_MAT" },
      { materialKey: "material-4", materialName: "안경 프레임" },
      { materialKey: "material-5", meshNames: ["Interior_Wall"] },
      { materialKey: "material-6", materialName: "Material.001" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments.map(({ slot }) => slot)).toEqual([
      "skin",
      "hair",
      "eyes",
      "clothes",
      "accessory",
      "background",
      "unknown",
    ]);
    expect(result.counts).toEqual({ total: 7, high: 6, medium: 0, low: 0, unknown: 1 });
    expect(result.assignments[0]?.evidence[0]).toMatchObject({
      slot: "skin",
      term: "skin",
      source: "material-name",
    });
  });

  it("uses token boundaries, source weights, and conservative ambiguity confidence", () => {
    const result = assignments([
      { materialKey: "chair", materialName: "ChairMaterial" },
      { materialKey: "skinner", materialName: "skinner_bodyguard" },
      { materialKey: "weighted", materialName: "hair", meshNames: ["Face_Skin"] },
      { materialKey: "ambiguous", materialName: "hair_skin" },
    ]);

    expect(result[0]).toMatchObject({ slot: "unknown", confidence: "none" });
    expect(result[1]).toMatchObject({ slot: "unknown", confidence: "none" });
    expect(result[2]).toMatchObject({ slot: "hair", confidence: "medium" });
    expect(result[3]).toMatchObject({ slot: "skin", confidence: "low" });
    expect(result[3]?.alternatives.slice(0, 2)).toEqual([
      { slot: "skin", score: 20 },
      { slot: "hair", score: 20 },
    ]);
  });

  it("does not let repeated shared-material usages inflate the same vocabulary match", () => {
    const one = assignments([
      { materialKey: "one", meshNames: ["Hair"] },
    ])[0];
    const repeated = assignments([
      { materialKey: "many", meshNames: ["Hair", "Hair.001", "Hair.002", "Hair.003"] },
    ])[0];

    expect(one?.score).toBe(12);
    expect(repeated?.score).toBe(one?.score);
    expect(repeated?.evidence).toHaveLength(1);
  });

  it("returns deeply frozen plans without copying caller-owned names or URL-like values", () => {
    const rawName = "https://untrusted.example/Face_Skin.glb";
    const result = classifyStudioBg3dSemanticMaterials([
      { materialKey: "material-safe", materialName: rawName },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid-descriptor");

    const safeResult = classifyStudioBg3dSemanticMaterials([
      { materialKey: "material-safe", materialName: "Face Skin" },
    ]);
    expect(safeResult.ok).toBe(true);
    if (!safeResult.ok) return;
    expect(JSON.stringify(safeResult)).not.toContain("Face Skin");
    expect(Object.isFrozen(safeResult)).toBe(true);
    expect(Object.isFrozen(safeResult.assignments)).toBe(true);
    expect(Object.isFrozen(safeResult.assignments[0]?.evidence)).toBe(true);
  });

  it("fails closed on malformed descriptors, unsafe keys, controls, duplicates, and proxies", () => {
    expect(classifyStudioBg3dSemanticMaterials(null)).toEqual({
      ok: false,
      code: "invalid-input",
    });
    expect(classifyStudioBg3dSemanticMaterials([
      { materialKey: "__proto__", materialName: "skin" },
    ])).toEqual({ ok: false, code: "invalid-descriptor" });
    expect(classifyStudioBg3dSemanticMaterials([
      { materialKey: "a", materialName: "skin\u0000hidden" },
    ])).toEqual({ ok: false, code: "invalid-descriptor" });
    expect(classifyStudioBg3dSemanticMaterials([
      { materialKey: "a", materialName: "skin", textureUrl: "https://example.test/a.png" },
    ])).toEqual({ ok: false, code: "invalid-descriptor" });
    expect(classifyStudioBg3dSemanticMaterials([
      { materialKey: "same", materialName: "skin" },
      { materialKey: "same", materialName: "hair" },
    ])).toEqual({ ok: false, code: "duplicate-material-key" });
    const throwing = new Proxy({}, { ownKeys: () => { throw new Error("nope"); } });
    expect(classifyStudioBg3dSemanticMaterials([throwing])).toEqual({
      ok: false,
      code: "invalid-input",
    });
  });

  it("enforces item, per-kind name, name-byte, and cumulative metadata budgets", () => {
    const tooMany = Array.from(
      { length: STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS + 1 },
      (_, index) => ({ materialKey: `material-${index}` }),
    );
    expect(classifyStudioBg3dSemanticMaterials(tooMany)).toEqual({
      ok: false,
      code: "material-budget-exceeded",
    });
    expect(classifyStudioBg3dSemanticMaterials([{
      materialKey: "too-many-names",
      meshNames: Array.from(
        { length: STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_NAMES_PER_KIND + 1 },
        (_, index) => `mesh-${index}`,
      ),
    }])).toEqual({ ok: false, code: "invalid-descriptor" });
    expect(classifyStudioBg3dSemanticMaterials([{
      materialKey: "long-name",
      materialName: "가".repeat(43),
    }])).toEqual({ ok: false, code: "invalid-descriptor" });

    const cumulative = Array.from({ length: 48 }, (_, descriptorIndex) => ({
      materialKey: `bulk-${descriptorIndex}`,
      meshNames: Array.from({ length: 16 }, (_, nameIndex) => (
        `${descriptorIndex}-${nameIndex}-${"x".repeat(112)}`
      )),
      nodeNames: Array.from({ length: 16 }, (_, nameIndex) => (
        `${descriptorIndex}-${nameIndex}-${"y".repeat(112)}`
      )),
    }));
    expect(classifyStudioBg3dSemanticMaterials(cumulative)).toEqual({
      ok: false,
      code: "metadata-budget-exceeded",
    });
  });
});

describe("Studio BG3D semantic render-pass plans", () => {
  const source = assignments([
    { materialKey: "skin", materialName: "skin" },
    { materialKey: "hair", materialName: "hair_skin" },
    { materialKey: "room", materialName: "background" },
    { materialKey: "default", materialName: "Material.001" },
  ]);

  it("derives conservative character/background visibility without forcing hidden sources visible", () => {
    const character = plan(source, "character-only");
    const background = plan(source, "background-only");

    expect(character.operations.map(({ materialKey, resolvedSlot, visibility }) => ({
      materialKey,
      resolvedSlot,
      visibility,
    }))).toEqual([
      { materialKey: "skin", resolvedSlot: "skin", visibility: "preserve" },
      { materialKey: "hair", resolvedSlot: "unknown", visibility: "hide" },
      { materialKey: "room", resolvedSlot: "background", visibility: "hide" },
      { materialKey: "default", resolvedSlot: "unknown", visibility: "hide" },
    ]);
    expect(character.reviewMaterialKeys).toEqual(["hair", "default"]);
    expect(character.counts).toEqual({ total: 4, included: 1, hidden: 3, review: 2 });
    expect(background.operations.map(({ visibility }) => visibility)).toEqual([
      "hide",
      "hide",
      "preserve",
      "hide",
    ]);
  });

  it("lets an explicit unresolved policy and confirmed slot safely override heuristic uncertainty", () => {
    const withUnknown = plan(source, "character-only", { unresolvedVisibility: "preserve" });
    expect(withUnknown.operations.map(({ visibility }) => visibility)).toEqual([
      "preserve",
      "preserve",
      "hide",
      "preserve",
    ]);

    const confirmed = plan([
      { materialKey: "manual-hair", slot: "hair", confidence: "confirmed" },
    ], "character-only", { minimumConfidence: "high" });
    expect(confirmed.operations[0]).toEqual({
      materialKey: "manual-hair",
      resolvedSlot: "hair",
      visibility: "preserve",
    });
    expect(confirmed.reviewMaterialKeys).toEqual([]);
  });

  it("creates alpha-preserving unlit mattes and stable semantic ID colors", () => {
    const matte = plan(source, "character-matte");
    expect(matte.operations[0]?.materialOverride).toEqual({
      shading: "unlit",
      color: "#ffffff",
      opacity: 1,
      preserveSourceAlpha: true,
      doubleSided: true,
      depthWrite: true,
    });
    expect(matte.operations[1]?.materialOverride).toBeUndefined();

    const semantic = plan(source, "semantic-id");
    expect(semantic.operations.map((operation) => operation.materialOverride?.color)).toEqual([
      "#ff7043",
      "#78909c",
      "#26a69a",
      "#78909c",
    ]);
    expect(semantic.operations.every((operation) => operation.visibility === "preserve")).toBe(true);
    expect(Object.isFrozen(semantic)).toBe(true);
    expect(Object.isFrozen(semantic.operations)).toBe(true);
    expect(Object.isFrozen(semantic.operations[0]?.materialOverride)).toBe(true);
  });

  it("keeps beauty passes non-destructive while still surfacing review candidates", () => {
    const beauty = plan(source, "beauty");
    expect(beauty.operations.every((operation) => (
      operation.visibility === "preserve" && operation.materialOverride === undefined
    ))).toBe(true);
    expect(beauty.reviewMaterialKeys).toEqual(["hair", "default"]);
  });

  it("supports every declared pass and never mutates caller-owned selections", () => {
    const mutable = source.map((item) => ({ ...item }));
    const snapshot = structuredClone(mutable);
    for (const kind of STUDIO_BG3D_SEMANTIC_RENDER_PASS_KINDS) {
      expect(createStudioBg3dSemanticRenderPassPlan(mutable, kind).ok).toBe(true);
    }
    expect(mutable).toEqual(snapshot);
  });

  it("rejects malformed, duplicate, over-budget, unsupported, and contradictory selections", () => {
    expect(createStudioBg3dSemanticRenderPassPlan(null, "beauty")).toEqual({
      ok: false,
      code: "invalid-input",
    });
    expect(createStudioBg3dSemanticRenderPassPlan([], "future-pass")).toEqual({
      ok: false,
      code: "unsupported-pass",
    });
    expect(createStudioBg3dSemanticRenderPassPlan([], "beauty", { minimumConfidence: "certain" }))
      .toEqual({ ok: false, code: "invalid-options" });
    expect(createStudioBg3dSemanticRenderPassPlan([
      { materialKey: "same", slot: "skin", confidence: "high" },
      { materialKey: "same", slot: "hair", confidence: "high" },
    ], "beauty")).toEqual({ ok: false, code: "duplicate-material-key" });
    expect(createStudioBg3dSemanticRenderPassPlan([
      { materialKey: "unknown", slot: "unknown", confidence: "high" },
    ], "beauty")).toEqual({ ok: false, code: "invalid-selection" });
    expect(createStudioBg3dSemanticRenderPassPlan(
      Array.from({ length: STUDIO_BG3D_SEMANTIC_MATERIAL_MAX_ITEMS + 1 }, (_, index) => ({
        materialKey: `material-${index}`,
        slot: "skin",
        confidence: "high",
      })),
      "beauty",
    )).toEqual({ ok: false, code: "material-budget-exceeded" });
  });
});
