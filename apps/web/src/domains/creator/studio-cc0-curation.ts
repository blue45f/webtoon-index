import type { StudioCc0Asset } from "./studio-cc0-asset-delivery";

export type StudioCc0StyleFilter = "all" | "detailed" | "stylized";
export interface StudioCc0CurationOptions {
  readonly includeComponents?: boolean;
  readonly style?: StudioCc0StyleFilter;
}

/** Confirmed in the actual 2026-09-06 review, sheet 10, item 228.
 * Keep its original URL for existing works; do not offer it for new insertion.
 */
export const STUDIO_CC0_QUARANTINED_IDS: readonly string[] = Object.freeze([
  "kenney-food-glass-wine",
]);

/** Assembly components are useful, but are not finished backgrounds/props. */
export function isStudioCc0AssemblyComponent(asset: Pick<StudioCc0Asset, "id">): boolean {
  const id = asset.id;
  return id.startsWith("kenney-building-")
    || /^kenney-furniture-(?:floor|wall|panelling)(?:-|$)/u.test(id)
    || /^kenney-nature-(?:cliff|ground|path|platform|bridge-center|bridge-side)(?:-|$)/u.test(id)
    || /^kenney-survival-(?:floor|metal-panel|structure|tent-frame)(?:-|$)/u.test(id)
    || /^kenney-suburban-(?:driveway|fence|path)(?:-|$)/u.test(id)
    || /^kenney-roads-(?:bridge-pillar|electricity-wires|road|tile|sign-object|traffic-light-object)(?:-|$)/u.test(id)
    || /^kenney-watercraft-(?:arrow|gate)(?:-|$)/u.test(id)
    || id === "polyhaven-modular-street-seating";
}

export function isStudioCc0Quarantined(asset: Pick<StudioCc0Asset, "id">): boolean {
  return STUDIO_CC0_QUARANTINED_IDS.includes(asset.id);
}

export function studioCc0StyleLabel(asset: Pick<StudioCc0Asset, "kind" | "provider">): string {
  if (asset.kind !== "model") return asset.kind === "effect-mask" ? "투명 효과" : "원본 표면 재질";
  return asset.provider === "Poly Haven" ? "디테일 PBR" : "스타일라이즈 · 로우폴리";
}

/** Apply after the ordinary text/kind filter; default selection hides parts.
 * This also protects against a stale cached manifest offering a quarantined ID.
 * Stable copies preserve the source array and every retained asset identity.
 */
export function curateStudioCc0Selection(
  assets: readonly StudioCc0Asset[],
  options: StudioCc0CurationOptions = {},
): readonly StudioCc0Asset[] {
  return assets.filter((asset) => {
    if (isStudioCc0Quarantined(asset)) return false;
    if (!options.includeComponents && isStudioCc0AssemblyComponent(asset)) return false;
    if (options.style === "detailed" && asset.provider !== "Poly Haven") return false;
    if (options.style === "stylized" && (asset.kind !== "model" || asset.provider === "Poly Haven")) return false;
    return true;
  }).toSorted((a, b) => Number(b.provider === "Poly Haven") - Number(a.provider === "Poly Haven"));
}
