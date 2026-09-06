import { describe, expect, it } from "vitest";

import {
  applyStudioMannequinHeadStyle,
  build3DModelTextureBatchManifest,
  computeCameraFollowingLightDirection,
  computeExponentialHeightFogFactor,
  STUDIO_MANNEQUIN_HEAD_STYLES,
} from "./studio-3d-feature-pack-2026";
import { buildStudioMannequinSpec } from "./studio-mannequin-model";

describe("studio-3d-feature-pack-2026", () => {
  const baseSpec = buildStudioMannequinSpec({ heightCm: 170, headCount: 7 });

  describe("Mannequin Head Replace & Hide", () => {
    it("lists standard head styles", () => {
      expect(STUDIO_MANNEQUIN_HEAD_STYLES.map((s) => s.id)).toEqual([
        "default",
        "anime",
        "chibi",
        "featureless",
        "hidden",
      ]);
    });

    it("hides all head primitives when style is 'hidden'", () => {
      const hiddenSpec = applyStudioMannequinHeadStyle(baseSpec, "hidden");
      expect(hiddenSpec.primitives.some((p) => p.jointId === "head")).toBe(false);
      // Other joints still exist
      expect(hiddenSpec.primitives.some((p) => p.jointId === "chest")).toBe(true);
    });

    it("replaces with smooth featureless ellipsoid", () => {
      const featurelessSpec = applyStudioMannequinHeadStyle(baseSpec, "featureless");
      const headPrimitives = featurelessSpec.primitives.filter((p) => p.jointId === "head");
      expect(headPrimitives).toHaveLength(1);
      expect(headPrimitives[0].kind).toBe("sphere");
    });

    it("replaces with anime styled head primitives", () => {
      const animeSpec = applyStudioMannequinHeadStyle(baseSpec, "anime");
      const headPrimitives = animeSpec.primitives.filter((p) => p.jointId === "head");
      expect(headPrimitives.length).toBeGreaterThanOrEqual(2);
      expect(headPrimitives.some((p) => p.kind === "capsule")).toBe(true); // chin/jaw
    });
  });

  describe("Camera-Following Light", () => {
    it("computes light direction pointing toward target from camera direction", () => {
      const cameraPos = [0, 5, 10] as const;
      const targetPos = [0, 0, 0] as const;

      const lightDir = computeCameraFollowingLightDirection(cameraPos, targetPos, {
        azimuthDeg: 0,
        elevationDeg: 0,
      });

      // Unit vector should have length 1.0
      const len = Math.hypot(lightDir[0], lightDir[1], lightDir[2]);
      expect(len).toBeCloseTo(1.0, 3);
      // Pointing generally along +Z and +Y
      expect(lightDir[2]).toBeGreaterThan(0);
      expect(lightDir[1]).toBeGreaterThan(0);
    });
  });

  describe("Exponential Height Fog", () => {
    it("gives 0 fog when object is closer than near plane", () => {
      const factor = computeExponentialHeightFogFactor([0, 0, 0], [0, 0, 0.5]);
      expect(factor).toBe(0);
    });

    it("gives higher fog at ground level than in the sky", () => {
      const groundObj = [0, 0, 30] as const; // Y = 0 (ground)
      const skyObj = [0, 40, 30] as const;   // Y = 40 (sky)
      const camera = [0, 5, 0] as const;

      const groundFog = computeExponentialHeightFogFactor(groundObj, camera);
      const skyFog = computeExponentialHeightFogFactor(skyObj, camera);

      expect(groundFog).toBeGreaterThan(skyFog);
    });
  });

  describe("3D Model Texture Batch Exporter", () => {
    it("packages textures into a structured batch manifest", () => {
      const textures = [
        { textureId: "t1", mapType: "baseColor" as const, materialName: "Body", width: 2048, height: 2048 },
        { textureId: "t2", mapType: "normal" as const, materialName: "Body", width: 2048, height: 2048 },
        { textureId: "t3", mapType: "roughness" as const, materialName: "Hair", width: 1024, height: 1024 },
      ];

      const manifest = build3DModelTextureBatchManifest("HeroCharacter", textures);
      expect(manifest.modelName).toBe("herocharacter");
      expect(manifest.totalTextures).toBe(3);
      expect(manifest.textures[0].fileName).toBe("herocharacter_body_baseColor_1.png");
      expect(manifest.textures[0].resolution).toBe("2048x2048");
      expect(manifest.textures[1].fileName).toBe("herocharacter_body_normal_2.png");
    });
  });
});
