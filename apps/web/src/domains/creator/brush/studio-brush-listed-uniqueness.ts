/**
 * Listed-paint uniqueness keys — picker exposure, not registration.
 *
 * Execution signature is the engine path. Profile-variants may share that path when a renderer
 * branch (alias wash/pressure, calligraphy nib, Stam fluid) actually distinguishes them. Pack
 * presets share three runtimes, so their listed identity is the tip footprint (runtime + motif
 * + alpha map + layers + 45° angle bucket), matching the 2026-08-21 roster audit.
 *
 * Governance/CI only: this module loads the lazy catalogue and pack runtime.
 */

import { resolveStudioBrushAliasProfile } from "./studio-brush-alias-profile";
import {
  STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS,
} from "./studio-brush-catalog";
import { studioBrushPackDescriptorById } from "./studio-brush-pack-index";
import { materializeStudioBrushPackSelection } from "./studio-brush-pack-runtime";
import {
  resolveStudioBrushRuntimeContract,
  studioBrushRuntimeExecutionSignature,
} from "./studio-brush-runtime-contract";
import { resolveStudioCalligraphyNibProfile } from "./studio-calligraphy-nib-profile";
import { isStudioInkwashFluidBrush } from "./studio-inkwash-fluid-brushes";

/** Listed paint count immediately before the 2026-09-02 feel-cull wave. */
export const STUDIO_LISTED_PAINT_PRE_CHANGE_COUNT = 234;

/** Exposure-only drop set from the 2026-09-02 feel-cull. Runtime rows stay registered. */
export const STUDIO_BRUSH_FEEL_CULL_PRESET_IDS = [
  "fineliner",
  "marker-bold",
  "pencil-6b",
  "colored-pencil",
  "flat-brush",
  "crosshatch",
  "mypaint-cc0--kabura",
  "mypaint-cc0--marker-fat",
  "mypaint-cc0--splatter",
  "mypaint-cc0--dry-brush",
  "mypaint-cc0--2b-pencil",
  "rock-texture",
  "compressed-charcoal-edge",
  "pastel-paper-soft",
  "sponge-stipple-dab",
  "technical-needle-ink",
  "maru-pen-fine",
  "ink-splatter-burst",
  "stage-safe-splatter",
  "round-shading",
  "hard-oval",
  "smooth-oval",
  "spoon-pen-round",
  "bokeh-scatter",
  "watercolor-wet-bleed",
  "marker-colorless-blender",
  "bumpy-grain",
  "pencil-4b-rough",
  "crayon-wax-bold",
  "calligraphy-tilt-nib",
  "marker-wide-chisel",
  "taper-brush-marker",
  "oil-dry-scumble",
  "side-graphite-shade",
  "gouache-grain-flat",
  "dust-mote-depth",
  "cloud-billow-soft",
  "bristle-flat-streak",
  "wood-knot-rake",
  "sumi-wash-fray",
  "bristle-round-loaded",
  "snow-flurry-flake",
  "leaf-fall-flurry",
  "sparkle-glint-cross",
  "brush-pen-ink",
  // 2026-09-02 유사 브러시 정리: web-blend-softener 와 실행 서명이 같고 잔상이 실재하지 않음.
  "web-smudge-trail",
  // 2026-09-03 마크 거리 축소 웨이브. 팁 알파맵·간격/산포/플로/그레인·스탬프 각도로 잰 거리에서
  // 홑잎 3종이 서로 0.064 안에 들어오고(fresh<->long 0.0355 가 팩 전체 최근접), fur-soft-clumps
  // 는 rake 최근접 쌍(hair-fiber 0.0494)이었습니다. 사유는 격리 원장에 있습니다.
  "fresh-leaf",
  "long-leaf",
  "fur-soft-clumps",
] as const;

function alphaDigest(alphaMapBase64: string | null | undefined): string {
  if (!alphaMapBase64) return "none";
  let hash = 0x811c9dc5;
  for (let index = 0; index < alphaMapBase64.length; index += 1) {
    hash ^= alphaMapBase64.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function angleBucket(angleDeg: number): number {
  if (!Number.isFinite(angleDeg)) return 0;
  const wrapped = ((angleDeg % 180) + 180) % 180;
  return Math.round(wrapped / 45) * 45 % 180;
}

function isIdentityPressure(pressure: {
  readonly minimum: number;
  readonly maximum: number;
  readonly exponent: number;
}): boolean {
  return pressure.minimum === 0 && pressure.maximum === 1 && pressure.exponent === 1;
}

/**
 * Pack listed identity: runtime + tip motif/alpha + layer shapes + 45° angle bucket.
 * Horizontal vs vertical chisels stay distinct; slider-scale siblings collapse.
 */
export function studioBrushListedTipFootprint(catalogId: string): string | null {
  const selection = materializeStudioBrushPackSelection(catalogId);
  if (!selection) return null;
  const tip = selection.brushDynamics.tip;
  const layers = selection.brushDynamics.tipLayers ?? [];
  const layerKey = layers.map((layer) => layer.tip.shape).join("|") || "none";
  return [
    selection.runtimeBrushId,
    tip.shape,
    alphaDigest(tip.alphaMapBase64),
    layerKey,
    String(angleBucket(selection.brushDynamics.angle.base)),
  ].join("/");
}

/**
 * Listed uniqueness key for one paint id. Null for unknown / non-paint ids.
 */
export function studioBrushListedUniquenessKey(catalogId: string): string | null {
  if (typeof catalogId !== "string" || catalogId.length === 0) return null;
  const pack = studioBrushPackDescriptorById(catalogId);
  if (pack) {
    const footprint = studioBrushListedTipFootprint(catalogId);
    return footprint ? `pack:${footprint}` : null;
  }
  const contract = resolveStudioBrushRuntimeContract(catalogId);
  if (!contract || contract.operation === "erase") return null;
  const signature = studioBrushRuntimeExecutionSignature(contract);
  if (isStudioInkwashFluidBrush(catalogId)) {
    return `wet-fluid:${catalogId}`;
  }
  const nib = resolveStudioCalligraphyNibProfile(catalogId);
  if (nib) {
    return `exec:${signature}:nib:${nib.angleDeg}:${nib.roundness}`;
  }
  const alias = resolveStudioBrushAliasProfile(catalogId);
  if (alias && alias.id !== contract.canonicalId) {
    if (alias.watercolor) return `exec:${signature}:wash:${alias.id}`;
    if ((alias.pencilPasses?.length ?? 0) > 1) {
      return `exec:${signature}:passes:${alias.id}`;
    }
    if (!isIdentityPressure(alias.pressure)) {
      return `exec:${signature}:pressure:${alias.id}`;
    }
  }
  return `exec:${signature}`;
}

export interface StudioListedPaintUniquenessCollision {
  readonly key: string;
  readonly ids: readonly string[];
}

/** Empty when the listed paint shelf is uniqueness-gated. */
export function listStudioListedPaintUniquenessCollisions(): readonly StudioListedPaintUniquenessCollision[] {
  const byKey = new Map<string, string[]>();
  for (const item of STUDIO_LISTED_PAINT_BRUSH_CATALOG_ITEMS) {
    const key = studioBrushListedUniquenessKey(item.id);
    if (!key) {
      const group = byKey.get("MISSING") ?? [];
      group.push(item.id);
      byKey.set("MISSING", group);
      continue;
    }
    const group = byKey.get(key) ?? [];
    group.push(item.id);
    byKey.set(key, group);
  }
  return [...byKey.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids: Object.freeze([...ids]) }))
    .sort((left, right) => right.ids.length - left.ids.length || left.key.localeCompare(right.key));
}
