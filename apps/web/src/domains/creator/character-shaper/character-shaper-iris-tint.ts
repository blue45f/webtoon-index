/**
 * Character Shaper — texture-preserving iris tint.
 *
 * `applyVrmCustomColors` has no eye part, so the Shaper tints iris materials itself with the same
 * HSL technique the baked-costume recolor uses (`tintColor`): hue and saturation follow the
 * target, lightness keeps the texture's own shading. Eyelash / eyeline / brow / highlight /
 * white-of-eye materials and MToon outline passes are never touched, and the original colour
 * factors are stored once in `userData` so `null` restores them exactly.
 */

import { tintColor } from "../vrm/studio-vrm-costume";

import type { VRM } from "@pixiv/three-vrm";
import type * as THREE from "three";

const IRIS_INCLUDE = /iris|hitomi|pupil|eye/iu;
const IRIS_EXCLUDE = /eyelash|eyeline|eyebrow|brow|lash|highlight|white|sclera|extra/iu;
const HEX_COLOR = /^#[0-9a-f]{6}$/iu;

const ORIGINAL_COLOR_KEY = "__characterIrisOriginalColor";
const ORIGINAL_SHADE_KEY = "__characterIrisOriginalShade";
const APPLIED_KEY = "__characterIrisTintApplied";

/** Same default strength as the costume recolor — strong hue, texture shading preserved. */
const TINT_STRENGTH = 0.85;

type ColorLike = { getHexString(): string; set(value: string): unknown };

type TintableMaterial = THREE.Material & {
  color?: ColorLike;
  shadeColorFactor?: ColorLike;
  isOutline?: boolean;
  userData: Record<string, unknown>;
};

/** `true` = iris material, `false` = explicitly protected, `null` = the name carries no signal. */
function irisSignal(name: string | null | undefined): boolean | null {
  if (!name) return null;
  if (IRIS_EXCLUDE.test(name)) return false;
  if (IRIS_INCLUDE.test(name)) return true;
  return null;
}

function isTintable(material: TintableMaterial | null | undefined): material is TintableMaterial {
  if (!material || !material.color || typeof material.color.getHexString !== "function") return false;
  if (material.isOutline === true) return false;
  if (material.userData?.__vrmMannequinActive === true) return false;
  return true;
}

function collectIrisMaterials(vrm: VRM): TintableMaterial[] {
  const found: TintableMaterial[] = [];
  const seen = new Set<TintableMaterial>();
  vrm.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of materials) {
      const material = raw as TintableMaterial | null | undefined;
      if (!isTintable(material) || seen.has(material)) continue;
      const decision = irisSignal(material.name) ?? irisSignal(mesh.name) ?? false;
      if (!decision) continue;
      seen.add(material);
      found.push(material);
    }
  });
  return found;
}

function normalizeHex(value: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return HEX_COLOR.test(trimmed) ? trimmed : null;
}

function rememberOriginal(material: TintableMaterial, key: string, color: ColorLike): string {
  const stored = material.userData[key];
  if (typeof stored === "string" && HEX_COLOR.test(stored)) return stored;
  const original = `#${color.getHexString()}`;
  material.userData[key] = original;
  return original;
}

/** Whether the model exposes at least one iris material the tint can reach. */
export function canTintCharacterIris(vrm: VRM | null): boolean {
  if (!vrm || !vrm.scene || typeof vrm.scene.traverse !== "function") return false;
  return collectIrisMaterials(vrm).length > 0;
}

/**
 * Tints every iris material (or restores the original factors when `color` is `null` or not a
 * `#rrggbb` string). Returns the number of materials touched. Idempotent: repeated calls always
 * tint from the stored original, never from a previously tinted value.
 */
export function applyCharacterIrisTint(vrm: VRM, color: string | null): number {
  const target = normalizeHex(color);
  let touched = 0;
  for (const material of collectIrisMaterials(vrm)) {
    const lit = material.color;
    if (!lit) continue;
    const originalLit = rememberOriginal(material, ORIGINAL_COLOR_KEY, lit);
    const shade = material.shadeColorFactor && typeof material.shadeColorFactor.getHexString === "function"
      ? material.shadeColorFactor
      : null;
    const originalShade = shade ? rememberOriginal(material, ORIGINAL_SHADE_KEY, shade) : null;

    if (target) {
      lit.set(tintColor(originalLit, target, TINT_STRENGTH));
      if (shade && originalShade) shade.set(tintColor(originalShade, target, TINT_STRENGTH));
      material.userData[APPLIED_KEY] = true;
      material.needsUpdate = true;
      touched += 1;
      continue;
    }

    if (material.userData[APPLIED_KEY] === true) {
      lit.set(originalLit);
      if (shade && originalShade) shade.set(originalShade);
      material.userData[APPLIED_KEY] = false;
      material.needsUpdate = true;
      touched += 1;
    }
  }
  return touched;
}
