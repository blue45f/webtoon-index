/** Deterministic, URL-free equirectangular skies for the Studio 3D viewport and color pass. */

import * as THREE from "three";

import { getSkyPreset, normalizePanoramaRotationDegrees } from "../studio-background-3d-sky";

import type { StudioBg3dSkyPresetId } from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_PANORAMA_WIDTH = 512;
export const STUDIO_BG3D_PANORAMA_HEIGHT = 256;

type Rgb = readonly [number, number, number];

interface PanoramaPalette {
  readonly nadir: Rgb;
  readonly horizon: Rgb;
  readonly zenith: Rgb;
  readonly cloud: Rgb;
  readonly light: Rgb;
  readonly lightLongitude: number;
  readonly lightLatitude: number;
}

export interface StudioBg3dProceduralPanoramaPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
}

export interface StudioBg3dProceduralPanoramaBinding {
  readonly texture: THREE.DataTexture | null;
  readonly setRotation: (rotationDegrees: number) => void;
  readonly dispose: () => void;
}

const PALETTES: Readonly<Record<Exclude<StudioBg3dSkyPresetId, "blank">, PanoramaPalette>> = {
  clear_day: {
    nadir: [171, 185, 190],
    horizon: [225, 239, 247],
    zenith: [45, 126, 205],
    cloud: [247, 250, 252],
    light: [255, 249, 218],
    lightLongitude: -0.72,
    lightLatitude: 0.42,
  },
  sunset: {
    nadir: [57, 45, 61],
    horizon: [250, 139, 82],
    zenith: [56, 73, 133],
    cloud: [161, 89, 103],
    light: [255, 230, 158],
    lightLongitude: 0.9,
    lightLatitude: 0.1,
  },
  night: {
    nadir: [8, 12, 24],
    horizon: [34, 45, 72],
    zenith: [5, 10, 31],
    cloud: [38, 47, 76],
    light: [225, 234, 248],
    lightLongitude: -1.15,
    lightLatitude: 0.5,
  },
};

// Quad view can mount the same preset in four R3F view roots. Keep one deterministic RGBA result
// per allowlisted preset so those mounts allocate only lightweight DataTexture wrappers instead of
// repeating the ~130k-pixel trigonometric render.
const PANORAMA_PIXEL_CACHE = new Map<
  Exclude<StudioBg3dSkyPresetId, "blank">,
  StudioBg3dProceduralPanoramaPixels
>();

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mix(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): [number, number, number] {
  const t = clamp01(amount);
  return [mix(from[0], to[0], t), mix(from[1], to[1], t), mix(from[2], to[2], t)];
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function sphericalDistance(
  longitude: number,
  latitude: number,
  targetLongitude: number,
  targetLatitude: number,
): number {
  const dot =
    Math.sin(latitude) * Math.sin(targetLatitude) +
    Math.cos(latitude) * Math.cos(targetLatitude) * Math.cos(longitude - targetLongitude);
  return Math.acos(Math.min(1, Math.max(-1, dot)));
}

function baseSkyColor(palette: PanoramaPalette, latitude: number): [number, number, number] {
  if (latitude >= 0) {
    return mixRgb(palette.horizon, palette.zenith, Math.sin(latitude) ** 0.72);
  }
  return mixRgb(palette.horizon, palette.nadir, Math.sin(-latitude) ** 0.58);
}

function periodicCloudAmount(longitude: number, latitude: number): number {
  const wave =
    Math.sin(longitude * 3 + Math.sin(latitude * 8) * 0.8) * 0.5 +
    Math.sin(longitude * 7 - latitude * 11) * 0.28 +
    Math.cos(longitude * 13 + latitude * 5) * 0.22;
  const normalizedLatitude = (latitude - 0.22) / 0.2;
  const latitudeBand = Math.exp(-(normalizedLatitude * normalizedLatitude));
  return smoothstep(0.2, 0.72, wave) * latitudeBand;
}

function deterministicStarAmount(longitude: number, latitude: number): number {
  if (latitude < 0.06) return 0;
  const longitudeGrid = ((longitude + Math.PI) / (Math.PI * 2)) * 173;
  const latitudeGrid = ((latitude + Math.PI / 2) / Math.PI) * 83;
  const longitudeCell = Math.floor(longitudeGrid);
  const latitudeCell = Math.floor(latitudeGrid);
  const seed = Math.sin(longitudeCell * 12.9898 + latitudeCell * 78.233) * 43758.5453;
  const random = seed - Math.floor(seed);
  if (random <= 0.965) return 0;

  const centerXSeed = Math.sin(longitudeCell * 39.346 + latitudeCell * 11.135) * 24634.6345;
  const centerYSeed = Math.sin(longitudeCell * 73.156 + latitudeCell * 52.235) * 56445.2341;
  const centerX = 0.2 + (centerXSeed - Math.floor(centerXSeed)) * 0.6;
  const centerY = 0.2 + (centerYSeed - Math.floor(centerYSeed)) * 0.6;
  const distance = Math.hypot(
    longitudeGrid - longitudeCell - centerX,
    latitudeGrid - latitudeCell - centerY,
  );
  const shape = 1 - smoothstep(0.08, 0.36, distance);
  return shape * mix(0.45, 1, smoothstep(0.965, 1, random));
}

function renderSkyPixel(
  presetId: Exclude<StudioBg3dSkyPresetId, "blank">,
  longitude: number,
  latitude: number,
): [number, number, number] {
  const palette = PALETTES[presetId];
  let color = baseSkyColor(palette, latitude);
  const cloud = periodicCloudAmount(longitude, latitude);

  if (presetId === "clear_day") {
    color = mixRgb(color, palette.cloud, cloud * 0.72);
  } else if (presetId === "sunset") {
    color = mixRgb(color, palette.cloud, cloud * 0.48);
    const normalizedLatitude = latitude / 0.18;
    const horizonGlow = Math.exp(-(normalizedLatitude * normalizedLatitude)) * 0.22;
    color = mixRgb(color, [255, 185, 111], horizonGlow);
  } else {
    color = mixRgb(color, palette.cloud, cloud * 0.2);
    const star = deterministicStarAmount(longitude, latitude);
    color = mixRgb(color, palette.light, star * 0.9);
  }

  const lightDistance = sphericalDistance(
    longitude,
    latitude,
    palette.lightLongitude,
    palette.lightLatitude,
  );
  const glowRadius = presetId === "sunset" ? 0.32 : presetId === "night" ? 0.19 : 0.16;
  const discRadius = presetId === "sunset" ? 0.075 : presetId === "night" ? 0.05 : 0.045;
  const glow = 1 - smoothstep(discRadius, glowRadius, lightDistance);
  const disc = 1 - smoothstep(discRadius * 0.72, discRadius, lightDistance);
  color = mixRgb(color, palette.light, glow * (presetId === "sunset" ? 0.52 : 0.28));
  color = mixRgb(color, palette.light, disc * 0.96);
  return color;
}

/**
 * Builds a seamless 2:1 panorama entirely from math. The first longitude is copied to the last
 * after generation, avoiding a one-pixel seam from floating-point differences at -PI/+PI.
 */
export function createStudioBg3dProceduralPanoramaPixels(
  presetId: StudioBg3dSkyPresetId,
): StudioBg3dProceduralPanoramaPixels | null {
  const preset = getSkyPreset(presetId);
  if (preset.kind !== "procedural-panorama") return null;

  const proceduralId = preset.id as Exclude<StudioBg3dSkyPresetId, "blank">;
  const cached = PANORAMA_PIXEL_CACHE.get(proceduralId);
  if (cached) return cached;

  const width = STUDIO_BG3D_PANORAMA_WIDTH;
  const height = STUDIO_BG3D_PANORAMA_HEIGHT;
  const rgba = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const latitude = (y / (height - 1) - 0.5) * Math.PI;
    for (let x = 0; x < width - 1; x += 1) {
      const longitude = (x / (width - 1)) * Math.PI * 2 - Math.PI;
      const [red, green, blue] = renderSkyPixel(proceduralId, longitude, latitude);
      const offset = (y * width + x) * 4;
      rgba[offset] = Math.round(red);
      rgba[offset + 1] = Math.round(green);
      rgba[offset + 2] = Math.round(blue);
      rgba[offset + 3] = 255;
    }

    const first = y * width * 4;
    const last = (y * width + width - 1) * 4;
    rgba.copyWithin(last, first, first + 4);
  }

  const pixels = Object.freeze({ width, height, rgba });
  PANORAMA_PIXEL_CACHE.set(proceduralId, pixels);
  return pixels;
}

export function createStudioBg3dProceduralPanoramaTexture(
  presetId: StudioBg3dSkyPresetId,
): THREE.DataTexture | null {
  const pixels = createStudioBg3dProceduralPanoramaPixels(presetId);
  if (!pixels) return null;

  const texture = new THREE.DataTexture(
    pixels.rgba,
    pixels.width,
    pixels.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = `Studio procedural sky: ${presetId}`;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Owns one scene background + PBR environment texture and restores prior scene state on teardown.
 * The same deterministic local panorama now lights metallic/roughness materials instead of acting
 * as a decorative backdrop only. Three derives its renderer-local PMREM cache; the source texture
 * remains the sole resource owned and disposed by this binding.
 */
export function mountStudioBg3dProceduralPanorama(
  scene: THREE.Scene,
  presetId: StudioBg3dSkyPresetId,
  rotationDegrees: number,
): StudioBg3dProceduralPanoramaBinding {
  const previousBackground = scene.background;
  const previousRotation = scene.backgroundRotation.clone();
  const previousEnvironment = scene.environment;
  const previousEnvironmentRotation = scene.environmentRotation.clone();
  const texture = createStudioBg3dProceduralPanoramaTexture(presetId);
  const mountedBackground = texture;
  const mountedEnvironment = texture;
  let disposed = false;

  scene.background = mountedBackground;
  scene.environment = mountedEnvironment;

  const setRotation = (nextRotationDegrees: number) => {
    if (disposed) return;
    const yaw = THREE.MathUtils.degToRad(
      normalizePanoramaRotationDegrees(nextRotationDegrees),
    );
    if (scene.background === mountedBackground) {
      scene.backgroundRotation.set(0, yaw, 0);
    }
    if (scene.environment === mountedEnvironment) {
      scene.environmentRotation.set(0, yaw, 0);
    }
  };
  setRotation(rotationDegrees);

  return Object.freeze({
    texture,
    setRotation,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (scene.background === mountedBackground) {
        scene.background = previousBackground;
        scene.backgroundRotation.copy(previousRotation);
      }
      if (scene.environment === mountedEnvironment) {
        scene.environment = previousEnvironment;
        scene.environmentRotation.copy(previousEnvironmentRotation);
      }
      texture?.dispose();
    },
  });
}
