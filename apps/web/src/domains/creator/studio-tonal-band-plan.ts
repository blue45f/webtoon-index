/**
 * Turning a per-polygon deposit into paintable layers, in the two forms the two surfaces need.
 *
 * Extracted from the angled-nib coverage planner when a second carrier needed exactly the same
 * thing. Both carriers face the same problem: they resolve how dark each piece of a mark should be
 * and then have to hand that to renderers which can only fill a path at ONE alpha. Solving it twice
 * would guarantee the two carriers drift, so the ladder, the visibility floor and the equivalence
 * between the cumulative and disjoint forms live here once.
 *
 * The two forms and why both exist are documented on the interfaces below. In short: SVG has no
 * private surface so it composites cumulative `shells`; a canvas painter owns a surface and paints
 * disjoint `bands` additively for one fill per polygon. See `studio-stroke-coverage-raster.ts`.
 *
 * Generic over the polygon type on purpose — the nib carries plain point rings, the ink ribbon
 * carries rings tagged with a role, and neither needs to know about the other.
 */


/** Anything with a closed point ring can be banded; the carrier keeps its own extra fields. */
export interface StudioTonalPolygon {
  readonly points: readonly number[];
}

/**
 * One paint layer. Read as a CUMULATIVE shell it carries every polygon at or above its band and
 * `opacity` is the incremental deposit that lands the fold on this band's target. Read as a
 * DISJOINT band it carries only its own polygons and `opacity` is the absolute target. Which one
 * you have is decided by which array you took it from, never by inspecting it.
 */
export interface StudioTonalLayer<T extends StudioTonalPolygon> {
  readonly band: number;
  readonly opacity: number;
  readonly polygons: readonly T[];
}

export interface StudioTonalLayerPlan<T extends StudioTonalPolygon> {
  /** Outermost (lightest) first; one entry means the mark has no resolvable tonal range. */
  readonly shells: readonly StudioTonalLayer<T>[];
  /** Darkest first — the order a destination-owning painter has to walk. */
  readonly bands: readonly StudioTonalLayer<T>[];
}

/** Below this an 8-bit destination cannot record the deposit, so the shell is pure cost. */
const MIN_VISIBLE_DEPOSIT = 1 / 255;
/**
 * Rung budget for a LOW-contrast mark, in destination alpha. A band boundary is a transverse line
 * across the mark, so the step has to stay under what reads as a contour — 1/32 measured as ~8
 * levels of 255 at full black and contoured plainly, so the rungs are much finer than that. This
 * bound is what keeps a nearly flat mark cheap; a mark with real tonal range hits the cap below
 * instead, so between them the two constants set the floor and the ceiling on shells.
 */
const MAX_TONE_STEP = 1 / 128;
/** Ceiling on shells per mark. Shell k repaints everything above it, so this bounds the fan-out. */
export const MAX_DENSITY_BANDS = 32;
/**
 * Curvature of the density ladder; below 1 the rungs bunch toward the peak. See the ladder comment
 * in the shell planner for why the dark end is both where the steps show and where they are cheap.
 */
const DENSITY_LADDER_EXPONENT = 0.7;
// Deliberately NOT dithered. The oil bed scatters its band cuts with a per-hair phase stride, and
// the same trick was tried here first: offset each segment's rung by a golden-ratio sequence so a
// boundary is carried by an interleave instead of one continuous contour. It reads worse, and the
// reason is structural — the oil bed has seven hairs to scatter ACROSS, so its steps break into a
// mosaic, while this carrier has a single lane and every segment spans the mark's full width. A
// dithered segment is therefore a full-width stripe, and the measured result was clean contours
// replaced by conspicuous diagonal hatching. With one lane the only real cure for a tonal step is
// a smaller step, so the rungs below are simply fine enough.

/**
 * Turns per-polygon densities into cumulative shells.
 *
 * Density is banded RELATIVE to the mark's own peak, never in absolute terms. That keeps this
 * change strictly one-directional: the heaviest touch still lands on exactly the element opacity
 * the flat union already painted, and only lighter touches lift off it. A mark whose pressure
 * never varies has no range to resolve, collapses to one band, and serializes byte-identically to
 * the emission this replaced — which is what protects saved documents.
 */
export function planStudioTonalBands<T extends StudioTonalPolygon>(
  polygons: readonly T[],
  densities: readonly number[],
  elementOpacity: number,
): StudioTonalLayerPlan<T> {
  let densityPeak = 0;
  for (const density of densities) densityPeak = Math.max(densityPeak, density);
  let densityMin = Number.POSITIVE_INFINITY;
  for (const density of densities) densityMin = Math.min(densityMin, density);
  return planStudioTonalBandsFromExtremes(
    polygons,
    densities,
    elementOpacity,
    densityPeak,
    densityMin,
  );
}

/**
 * `planStudioTonalBands`, 밀도 극값을 호출자가 이미 알 때의 형태.
 *
 * 증분 커버리지 빌더는 밀도를 append 전용으로 유지하므로 최대/최소가 O(1) 러닝 값이다 — 매
 * 이동 두 번의 전체 스캔이 (특히 평면 판정으로 즉시 접히는 무필압 획에서) 이동당 비용의
 * 지배항이 되는 것을 막는다. `densityPeak`은 `Math.max` 폴드(초기 0), `densityMin`은
 * `Math.min` 폴드(초기 +∞)와 정확히 같아야 한다. 원래의 원소별 `min(dᵢ/peak)` 폴드와
 * `min(dᵢ)/peak` 은 IEEE 나눗셈의 단조성으로 비트 동일하므로(0 ≤ dᵢ ≤ peak 에서 몫 ≤ 1
 * 포함) 배치 결과가 바이트 단위로 보존된다.
 */
export function planStudioTonalBandsFromExtremes<T extends StudioTonalPolygon>(
  polygons: readonly T[],
  densities: readonly number[],
  elementOpacity: number,
  densityPeak: number,
  densityMin: number,
): StudioTonalLayerPlan<T> {
  const flatLayers = Object.freeze([
    Object.freeze({ band: 0, opacity: elementOpacity, polygons }),
  ]);
  // One layer, so cumulative and disjoint are the same object — a flat mark cannot disagree with
  // itself across the two surfaces.
  const flat = Object.freeze({ shells: flatLayers, bands: flatLayers });
  if (polygons.length === 0) {
    return Object.freeze({ shells: Object.freeze([]), bands: Object.freeze([]) });
  }

  const peak = densityPeak;
  if (!(peak > 0)) return flat;
  const floor = Math.min(
    1,
    Math.max(0, densities.length === 0 ? 1 : densityMin / peak),
  );
  // Whole tonal range invisible at this opacity — banding it would only cost geometry.
  if ((1 - floor) * elementOpacity < MIN_VISIBLE_DEPOSIT) return flat;

  const span = 1 - floor;
  const bandCount = Math.min(
    MAX_DENSITY_BANDS,
    Math.max(2, 1 + Math.ceil(span / MAX_TONE_STEP)),
  );
  const topBand = bandCount - 1;
  // The ladder is deliberately NOT uniform in alpha. A fixed alpha step is far more conspicuous
  // against a dark neighbour than a light one — Weber, and it is exactly what the probe shows: at
  // any band count the surviving contours all sit in the mark's dark half while the pale taper
  // reads smooth. Bunching the rungs toward the peak is also the cheap direction, because a shell
  // repaints everything above it and the dark bands are the ones holding the fewest segments.
  // Measured on the pressure-hump probe, this buys the tonal resolution a 48-rung uniform ladder
  // needed for roughly half its emitted geometry.
  const rungDensity = (rung: number) => rung ** DENSITY_LADDER_EXPONENT;
  // The top rung is exactly the peak either way, so the darkest pixels keep the tone the flat
  // union already gave them, to the bit.
  const grouped: T[][] = Array.from(
    { length: bandCount },
    () => [],
  );
  for (const [index, polygon] of polygons.entries()) {
    const relative = Math.min(1, Math.max(0, (densities[index] ?? peak) / peak));
    const rung = ((relative - floor) / span) ** (1 / DENSITY_LADDER_EXPONENT);
    const band = Math.round(rung * topBand);
    grouped[Math.min(topBand, Math.max(0, band))]!.push(polygon);
  }
  const occupied: { band: number; target: number }[] = [];
  for (const [band, members] of grouped.entries()) {
    if (members.length === 0) continue;
    occupied.push({
      band,
      target: elementOpacity * (floor + span * rungDensity(band / topBand)),
    });
  }
  if (occupied.length <= 1) return flat;

  // Incremental deposit that lands the fold on this band's target given everything the shells
  // outside it already laid. A shell too faint to survive 8-bit quantisation is never built, and
  // skipping it deliberately does NOT advance `carried`, so its target passes to the next shell
  // that IS worth painting and the tone stays exact instead of drifting. Shell 0 is always kept:
  // it is the silhouette, and dropping it would shrink the mark.
  const emitted: { slot: number; band: number; opacity: number; target: number }[] = [];
  let carried = 0;
  for (const [slot, entry] of occupied.entries()) {
    const deposit = carried >= 1
      ? 0
      : Math.min(1, Math.max(0, 1 - (1 - entry.target) / (1 - carried)));
    if (slot > 0 && deposit < MIN_VISIBLE_DEPOSIT) continue;
    carried = entry.target;
    emitted.push({ slot, band: entry.band, opacity: deposit, target: entry.target });
  }
  if (emitted.length <= 1) return flat;

  // Built inward as suffixes and shared, so each polygon is referenced once per shell it belongs
  // to rather than re-walked: shell k is exactly `its own bands ++ shell k+1`. Shell 0 reuses the
  // plan's own polygon array, which is why the outer silhouette is identical by construction.
  const shells = new Array<StudioTonalLayer<T>>(emitted.length);
  // Disjoint twin, filled in the same descending walk so a band and its shell can never be built
  // from different groupings. Written back-to-front too, then reversed, so it ends up darkest
  // first — the order a destination-over painter has to walk it in.
  const bands = new Array<StudioTonalLayer<T>>(emitted.length);
  let outer: readonly T[] = [];
  for (let index = emitted.length - 1; index >= 0; index -= 1) {
    // A shell absorbs every band from its own slot up to the next EMITTED slot, so bands whose
    // deposit was too faint to paint are carried by the shell below them rather than dropped.
    const to = emitted[index + 1]?.slot ?? occupied.length;
    const own: T[] = [];
    for (let cursor = emitted[index]!.slot; cursor < to; cursor += 1) {
      own.push(...grouped[occupied[cursor]!.band]!);
    }
    if (index === 0) {
      // Shell 0 covers every band, so it IS the plan's polygon list — reused rather than rebuilt,
      // which keeps the outer silhouette identical by construction and in its original order.
      outer = polygons;
    } else {
      outer = Object.freeze(own.concat(outer));
    }
    shells[index] = Object.freeze({
      band: emitted[index]!.band,
      opacity: emitted[index]!.opacity,
      polygons: outer,
    });
    bands[index] = Object.freeze({
      band: emitted[index]!.band,
      // ABSOLUTE, not the incremental deposit: a disjoint painter lays each band exactly once.
      opacity: emitted[index]!.target,
      polygons: Object.freeze(own),
    });
  }
  return Object.freeze({
    shells: Object.freeze(shells),
    bands: Object.freeze(bands.reverse()),
  });
}

