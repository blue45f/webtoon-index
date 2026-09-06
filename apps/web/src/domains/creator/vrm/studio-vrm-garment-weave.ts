import type { WardrobeFabricPreset } from "./studio-vrm-wardrobe";

type Weave = Pick<WardrobeFabricPreset, "id" | "weaveFrequency" | "weaveStrength">;

/** VRM geometry uses meters. The authored strength is an amount, not centimeters of relief. */
export function studioVrmGarmentBumpScaleM(fabric: Weave): number {
  if (!Number.isFinite(fabric.weaveStrength) || fabric.weaveStrength <= 0) return 0;
  return Math.min(0.001, fabric.weaveStrength * 0.02);
}

/** Every axis uses integer periods: repeat wrapping must not introduce a seam in the fabric. */
export function sampleStudioVrmGarmentWeave(fabric: Weave, u: number, v: number): number {
  if (!Number.isFinite(u) || !Number.isFinite(v)) return 128;
  const frequency = Number.isFinite(fabric.weaveFrequency)
    ? Math.max(1, Math.min(24, Math.round(fabric.weaveFrequency))) : 1;
  const phase = Math.PI * 2 * frequency;
  const warp = Math.sin(u * phase);
  const weft = Math.sin(v * phase);
  const diagonal = fabric.id === "denim" ? Math.sin((u + v) * phase) * 0.55 : 0;
  const knit = fabric.id === "knit" ? Math.cos((u - v) * phase) * 0.38 : 0;
  return Math.round(Math.max(0, Math.min(255, 128 + warp * 34 + weft * 26 + diagonal * 28 + knit * 28)));
}
