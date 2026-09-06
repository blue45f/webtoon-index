import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_PANORAMA_HEIGHT,
  STUDIO_BG3D_PANORAMA_WIDTH,
  createStudioBg3dProceduralPanoramaPixels,
  createStudioBg3dProceduralPanoramaTexture,
  mountStudioBg3dProceduralPanorama,
} from "./studio-bg3d-procedural-panorama";

const PROCEDURAL_PRESETS = ["clear_day", "sunset", "night"] as const;

function rgbAt(rgba: Uint8Array, x: number, y: number): readonly number[] {
  const offset = (y * STUDIO_BG3D_PANORAMA_WIDTH + x) * 4;
  return Array.from(rgba.slice(offset, offset + 3));
}

describe("Studio BG3D procedural panorama", () => {
  it("keeps blank as a solid clear background and generates all allowlisted skies locally", () => {
    expect(createStudioBg3dProceduralPanoramaPixels("blank")).toBeNull();
    expect(createStudioBg3dProceduralPanoramaTexture("blank")).toBeNull();

    for (const presetId of PROCEDURAL_PRESETS) {
      const panorama = createStudioBg3dProceduralPanoramaPixels(presetId);
      expect(panorama).toMatchObject({
        width: STUDIO_BG3D_PANORAMA_WIDTH,
        height: STUDIO_BG3D_PANORAMA_HEIGHT,
      });
      expect(panorama?.rgba).toHaveLength(
        STUDIO_BG3D_PANORAMA_WIDTH * STUDIO_BG3D_PANORAMA_HEIGHT * 4,
      );
      expect(panorama?.rgba.every((channel, index) => index % 4 !== 3 || channel === 255)).toBe(
        true,
      );
    }
  });

  it("reuses one RGBA render per preset across repeated and quad-view texture mounts", () => {
    const firstPixels = createStudioBg3dProceduralPanoramaPixels("clear_day");
    const secondPixels = createStudioBg3dProceduralPanoramaPixels("clear_day");
    expect(secondPixels).toBe(firstPixels);

    const firstTexture = createStudioBg3dProceduralPanoramaTexture("clear_day");
    const secondTexture = createStudioBg3dProceduralPanoramaTexture("clear_day");
    expect(firstTexture).not.toBe(secondTexture);
    expect(firstTexture?.image.data).toBe(firstPixels?.rgba);
    expect(secondTexture?.image.data).toBe(firstPixels?.rgba);
    firstTexture?.dispose();
    secondTexture?.dispose();
  });

  it.each(PROCEDURAL_PRESETS)("generates a seamless, vertically varied %s panorama", (presetId) => {
    const panorama = createStudioBg3dProceduralPanoramaPixels(presetId);
    expect(panorama).not.toBeNull();
    if (!panorama) return;

    for (const y of [0, 32, 96, 128, 192, STUDIO_BG3D_PANORAMA_HEIGHT - 1]) {
      expect(rgbAt(panorama.rgba, 0, y)).toEqual(
        rgbAt(panorama.rgba, STUDIO_BG3D_PANORAMA_WIDTH - 1, y),
      );
    }
    const x = Math.floor(STUDIO_BG3D_PANORAMA_WIDTH * 0.31);
    expect(new Set([
      rgbAt(panorama.rgba, x, 0).join(","),
      rgbAt(panorama.rgba, x, Math.floor(STUDIO_BG3D_PANORAMA_HEIGHT / 2)).join(","),
      rgbAt(panorama.rgba, x, STUDIO_BG3D_PANORAMA_HEIGHT - 1).join(","),
    ]).size).toBe(3);
  });

  it("creates an sRGB equirectangular DataTexture with bounded sampling settings", () => {
    const texture = createStudioBg3dProceduralPanoramaTexture("clear_day");
    expect(texture).toBeInstanceOf(THREE.DataTexture);
    expect(texture).toMatchObject({
      mapping: THREE.EquirectangularReflectionMapping,
      colorSpace: THREE.SRGBColorSpace,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      flipY: false,
    });
    expect(texture?.version).toBeGreaterThan(0);
    texture?.dispose();
  });

  it("lights PBR from the local sky, updates scene yaw, and restores prior state exactly once", () => {
    const scene = new THREE.Scene();
    const previousBackground = new THREE.Color("#123456");
    const previousEnvironment = new THREE.DataTexture();
    scene.background = previousBackground;
    scene.environment = previousEnvironment;
    scene.backgroundRotation.set(0.1, 0.2, 0.3);
    scene.environmentRotation.set(0.4, 0.5, 0.6);
    const previousRotation = scene.backgroundRotation.clone();
    const previousEnvironmentRotation = scene.environmentRotation.clone();
    const binding = mountStudioBg3dProceduralPanorama(scene, "sunset", 45);
    expect(binding.texture).toBeInstanceOf(THREE.DataTexture);
    expect(scene.background).toBe(binding.texture);
    expect(scene.environment).toBe(binding.texture);
    expect(scene.backgroundRotation.y).toBeCloseTo(Math.PI / 4);
    expect(scene.environmentRotation.y).toBeCloseTo(Math.PI / 4);

    const texture = binding.texture;
    binding.setRotation(270);
    expect(binding.texture).toBe(texture);
    expect(scene.backgroundRotation.y).toBeCloseTo(-Math.PI / 2);
    expect(scene.environmentRotation.y).toBeCloseTo(-Math.PI / 2);

    const dispose = vi.spyOn(texture!, "dispose");
    binding.dispose();
    binding.dispose();
    expect(scene.background).toBe(previousBackground);
    expect(scene.environment).toBe(previousEnvironment);
    expect(scene.backgroundRotation).toEqual(previousRotation);
    expect(scene.environmentRotation).toEqual(previousEnvironmentRotation);
    expect(dispose).toHaveBeenCalledOnce();
    previousEnvironment.dispose();
  });

  it("does not overwrite a newer scene owner during stale cleanup", () => {
    const scene = new THREE.Scene();
    const binding = mountStudioBg3dProceduralPanorama(scene, "night", 30);
    const newerBackground = new THREE.Color("#abcdef");
    scene.background = newerBackground;
    scene.backgroundRotation.set(0, 1.2, 0);

    binding.dispose();
    expect(scene.background).toBe(newerBackground);
    expect(scene.backgroundRotation.y).toBeCloseTo(1.2);
    expect(scene.environment).toBeNull();
  });
});
