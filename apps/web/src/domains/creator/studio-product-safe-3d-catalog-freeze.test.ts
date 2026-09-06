import { describe, expect, it } from "vitest";

import {
  resolveStudioBg3dLightingStudioPreset,
  STUDIO_BG3D_LIGHTING_STUDIO_PRESETS,
} from "./bg3d/studio-bg3d-lighting-studio";
import { COMPOSITE_PRESETS } from "./studio-background-3d-composites";
import {
  BG_SCENE_TEMPLATES,
  instantiateSceneTemplate,
} from "./studio-background-3d-scene-templates";
import {
  EXTRA_POSE_PRESETS,
  POSER_KNOWN_BONES,
  type PoseDirectionTarget,
} from "./studio-pose-presets";
import { VRM_PROPS } from "./vrm/studio-vrm-props";
import {
  WARDROBE_FABRICS,
  WARDROBE_ITEMS,
  WARDROBE_SETS,
} from "./vrm/studio-vrm-wardrobe";

const ACCEPTED_CATALOG_MANIFEST = Object.freeze({
  lighting: Object.freeze(["cinematic-3point"]),
  poses: Object.freeze(["xp_wave_greeting"]),
  scenes: Object.freeze(["fantasy_tavern"]),
});

const REJECTED_CATALOG_MANIFEST = Object.freeze({
  scenes: Object.freeze([
    "cyberpunk_street",
    "modern_cafe",
    "traditional_dojo",
    "sci_fi_bridge",
    "webtoon_studio_room",
  ]),
  props: Object.freeze([
    "cyber_blade",
    "magic_grimoire",
    "smart_watch",
    "sci_fi_helmet",
    "detective_fedora",
    "tactical_pouch",
  ]),
  wardrobeItems: Object.freeze([
    "cyberpunk_suit",
    "hanbok_modern",
    "trenchcoat",
    "tactical_vest",
  ]),
  wardrobeFabrics: Object.freeze(["semi_gloss_leather"]),
  wardrobeSets: Object.freeze([
    "cyberpunk_techwear",
    "modern_hanbok",
    "detective_trench",
    "tactical_agent",
  ]),
});

function directionVector(direction: PoseDirectionTarget): readonly number[] {
  if ("sideX" in direction) return [direction.sideX, direction.y, direction.z ?? 0];
  return direction;
}

describe("product-safe 3D catalog freeze", () => {
  it("freezes the honest cinematic key/fill/environment preset with normalized directions", () => {
    const preset = STUDIO_BG3D_LIGHTING_STUDIO_PRESETS.find(
      ({ id }) => id === ACCEPTED_CATALOG_MANIFEST.lighting[0],
    );

    expect(preset).toMatchObject({
      id: "cinematic-3point",
      label: "시네마틱 3점",
      exposure: 1.12,
      lighting: {
        ambientColor: "#222a36",
        ambientIntensity: 0.42,
        key: { color: "#ffdfa0", intensity: 1.65, castsShadow: true },
        fill: { color: "#60a5fa", intensity: 0.45, castsShadow: false },
      },
    });
    expect(preset?.description).toContain("따뜻한 키");
    expect(preset?.description).toContain("차가운 필");
    expect(preset?.description).not.toMatch(/4K|림 라이트/u);
    expect(Math.hypot(...(preset?.lighting.key.direction ?? []))).toBeCloseTo(1, 10);
    expect(Math.hypot(...(preset?.lighting.fill.direction ?? []))).toBeCloseTo(1, 10);
    expect(Object.isFrozen(preset)).toBe(true);
    expect(
      preset
        ? resolveStudioBg3dLightingStudioPreset(preset.lighting, preset.exposure)
        : null,
    ).toBe(preset);
  });

  it("freezes one finite, known-bone right-hand greeting pose", () => {
    const pose = EXTRA_POSE_PRESETS.find(
      ({ id }) => id === ACCEPTED_CATALOG_MANIFEST.poses[0],
    );
    expect(pose).toMatchObject({
      id: "xp_wave_greeting",
      label: "손들어 인사",
    });
    expect(pose?.bones.rightUpperArm?.direction).toBeDefined();
    expect(pose?.bones.rightLowerArm?.direction).toBeDefined();
    expect(pose?.bones.rightHand?.rotation).toBeDefined();
    if (pose?.bones.rightUpperArm?.direction) {
      expect(directionVector(pose.bones.rightUpperArm.direction)[1]).toBeGreaterThan(0.4);
    }
    if (pose?.bones.rightLowerArm?.direction) {
      expect(directionVector(pose.bones.rightLowerArm.direction)[1]).toBeGreaterThan(0.8);
    }

    const knownBones = new Set<string>(POSER_KNOWN_BONES);
    for (const [boneName, spec] of Object.entries(pose?.bones ?? {})) {
      expect(knownBones.has(boneName), boneName).toBe(true);
      if (spec.direction) {
        const vector = directionVector(spec.direction);
        expect(vector.every(Number.isFinite), `${boneName} direction`).toBe(true);
        expect(Math.hypot(...vector), `${boneName} direction`).toBeGreaterThan(0.01);
      }
      if (spec.rotation) {
        expect(spec.rotation.every(Number.isFinite), `${boneName} rotation`).toBe(true);
      }
    }
  });

  it("freezes one deterministic built-in-only tavern scene with literal catalog copy", () => {
    const scene = BG_SCENE_TEMPLATES.find(
      ({ id }) => id === ACCEPTED_CATALOG_MANIFEST.scenes[0],
    );
    expect(scene).toMatchObject({
      id: "fantasy_tavern",
      category: "interior",
      label: "목재 주점",
      description: "목재 바닥 · 테이블 좌석 · 술통 · 벽 랜턴",
      footprint: { width: 8, depth: 8 },
    });
    expect(scene).toBeDefined();
    if (!scene) return;

    const compositeIds = new Set(COMPOSITE_PRESETS.map(({ id }) => id));
    for (const placement of scene.placements) {
      if (placement.type === "composite") {
        expect(compositeIds.has(placement.presetId), placement.presetId).toBe(true);
      } else {
        expect([
          ...placement.position,
          ...placement.rotation,
          ...placement.scale,
        ].every(Number.isFinite)).toBe(true);
      }
    }

    const withoutGeneratedIds = () => instantiateSceneTemplate(scene, 0).map(
      ({ id: _id, ...primitive }) => primitive,
    );
    expect(withoutGeneratedIds()).toEqual(withoutGeneratedIds());
  });

  it("keeps unrendered or misleading stash candidates outside selectable catalogs", () => {
    const sceneIds = new Set<string>(BG_SCENE_TEMPLATES.map(({ id }) => id));
    const propIds = new Set<string>(VRM_PROPS.map(({ id }) => id));
    const wardrobeItemIds = new Set<string>(WARDROBE_ITEMS.map(({ id }) => id));
    const wardrobeFabricIds = new Set<string>(WARDROBE_FABRICS.map(({ id }) => id));
    const wardrobeSetIds = new Set<string>(WARDROBE_SETS.map(({ id }) => id));

    for (const id of REJECTED_CATALOG_MANIFEST.scenes) expect(sceneIds.has(id), id).toBe(false);
    for (const id of REJECTED_CATALOG_MANIFEST.props) expect(propIds.has(id), id).toBe(false);
    for (const id of REJECTED_CATALOG_MANIFEST.wardrobeItems) {
      expect(wardrobeItemIds.has(id), id).toBe(false);
    }
    for (const id of REJECTED_CATALOG_MANIFEST.wardrobeFabrics) {
      expect(wardrobeFabricIds.has(id), id).toBe(false);
    }
    for (const id of REJECTED_CATALOG_MANIFEST.wardrobeSets) {
      expect(wardrobeSetIds.has(id), id).toBe(false);
    }
  });
});
