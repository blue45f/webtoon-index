import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { applyCharacterIrisTint, canTintCharacterIris } from "./character-shaper-iris-tint";

import type { VRM } from "@pixiv/three-vrm";

type ShadedMaterial = THREE.MeshStandardMaterial & { shadeColorFactor?: THREE.Color; isOutline?: boolean };

function material(name: string, hex: string, extra: Partial<ShadedMaterial> = {}): ShadedMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: hex }) as ShadedMaterial;
  mat.name = name;
  Object.assign(mat, extra);
  return mat;
}

function mesh(name: string, materials: THREE.Material | THREE.Material[]): THREE.Mesh {
  const object = new THREE.Mesh(new THREE.BoxGeometry(), materials);
  object.name = name;
  return object;
}

function hexOf(mat: THREE.MeshStandardMaterial): string {
  return `#${mat.color.getHexString()}`;
}

function buildScene() {
  const iris = material("F00_000_00_EyeIris_00_EYE", "#5a3a2a", { shadeColorFactor: new THREE.Color("#3a2418") });
  iris.map = new THREE.Texture();
  const highlight = material("F00_000_00_EyeHighlight_00_EYE", "#ffffff");
  const white = material("F00_000_00_EyeWhite_00_EYE", "#f4f4f4");
  const eyelash = material("F00_000_00_FaceEyelash_00_FACE", "#222222");
  const brow = material("F00_000_00_FaceBrow_00_FACE", "#332211");
  const mouth = material("F00_000_00_FaceMouth_00_FACE", "#e8b4a0");
  const outline = material("F00_000_00_EyeIris_00_EYE (Outline)", "#000000", { isOutline: true });
  const generic = material("Material.003", "#7a5a3a");
  const lashGeneric = material("Material.004", "#111111");
  const hair = material("Hair_01", "#3a2a2a");

  const scene = new THREE.Group();
  scene.add(mesh("Face", [mouth, iris, highlight, white, eyelash, brow]));
  scene.add(mesh("Face_Outline", outline));
  scene.add(mesh("Eye_L", generic));
  scene.add(mesh("EyeLashes", lashGeneric));
  scene.add(mesh("Hair", hair));
  const vrm = { scene } as unknown as VRM;
  return { vrm, iris, highlight, white, eyelash, brow, mouth, outline, generic, lashGeneric, hair };
}

describe("character shaper iris tint", () => {
  it("detects iris materials by material name, then by mesh name, never eyelash / white / outline", () => {
    const { vrm } = buildScene();
    expect(canTintCharacterIris(vrm)).toBe(true);
    expect(canTintCharacterIris(null)).toBe(false);
    expect(canTintCharacterIris({ scene: new THREE.Group() } as unknown as VRM)).toBe(false);
    expect(canTintCharacterIris({ scene: (() => { const group = new THREE.Group(); group.add(mesh("Body", material("Skin", "#f5c6a0"))); return group; })() } as unknown as VRM)).toBe(false);
  });

  it("tints only iris materials, keeping textures, and restores the exact original on null", () => {
    const scene = buildScene();
    const untouched = [scene.highlight, scene.white, scene.eyelash, scene.brow, scene.mouth, scene.outline, scene.lashGeneric, scene.hair];
    const before = untouched.map(hexOf);
    const originalMap = scene.iris.map;

    expect(applyCharacterIrisTint(scene.vrm, "#3b6fb6")).toBe(2);
    expect(hexOf(scene.iris)).not.toBe("#5a3a2a");
    expect(hexOf(scene.generic)).not.toBe("#7a5a3a");
    expect(untouched.map(hexOf)).toEqual(before);
    expect(scene.iris.map).toBe(originalMap);
    expect(scene.iris.userData.__characterIrisOriginalColor).toBe("#5a3a2a");
    expect(scene.iris.userData.__characterIrisOriginalShade).toBe("#3a2418");
    expect(scene.iris.shadeColorFactor?.getHexString()).not.toBe("3a2418");

    const hsl = { h: 0, s: 0, l: 0 };
    scene.iris.color.getHSL(hsl);
    const target = { h: 0, s: 0, l: 0 };
    new THREE.Color("#3b6fb6").getHSL(target);
    expect(Math.abs(hsl.h - target.h)).toBeLessThan(0.03);
    expect(hsl.s).toBeGreaterThan(0.3);

    expect(applyCharacterIrisTint(scene.vrm, null)).toBe(2);
    expect(hexOf(scene.iris)).toBe("#5a3a2a");
    expect(hexOf(scene.generic)).toBe("#7a5a3a");
    expect(scene.iris.shadeColorFactor?.getHexString()).toBe("3a2418");
    expect(applyCharacterIrisTint(scene.vrm, null)).toBe(0);
  });

  it("always tints from the stored original, so repeated tints do not accumulate", () => {
    const direct = buildScene();
    applyCharacterIrisTint(direct.vrm, "#3f8f5a");
    const chained = buildScene();
    applyCharacterIrisTint(chained.vrm, "#b83a3a");
    applyCharacterIrisTint(chained.vrm, "#7b4fb0");
    applyCharacterIrisTint(chained.vrm, "#3f8f5a");
    expect(hexOf(chained.iris)).toBe(hexOf(direct.iris));
    expect(hexOf(chained.generic)).toBe(hexOf(direct.generic));
  });

  it("treats an invalid colour string as a restore and skips mannequin-painted materials", () => {
    const scene = buildScene();
    applyCharacterIrisTint(scene.vrm, "#3b6fb6");
    expect(applyCharacterIrisTint(scene.vrm, "blue")).toBe(2);
    expect(hexOf(scene.iris)).toBe("#5a3a2a");
    scene.iris.userData.__vrmMannequinActive = true;
    expect(applyCharacterIrisTint(scene.vrm, "#3b6fb6")).toBe(1);
    expect(hexOf(scene.iris)).toBe("#5a3a2a");
  });
});
