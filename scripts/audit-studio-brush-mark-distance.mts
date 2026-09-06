/**
 * scripts/audit-studio-brush-mark-distance.mts
 * Ranks the picker-listed procedural brushes by how alike they actually paint.
 *
 * `studio-brush-listed-uniqueness.ts` already forbids two listed ids from sharing an execution
 * signature, but that key is exact: two presets whose tips differ by a handful of alpha levels pass
 * it while an artist scrubbing the drawer cannot tell them apart. This audit measures the gap
 * instead of asserting it away, over the channels that decide what a mark looks like:
 *
 *   - the tip's alpha silhouette, resampled to a common grid and compared pixel-wise (0.38),
 *   - tip roundness (0.12) — the dab's aspect; a round billow and a flattened streak read as
 *     different brushes even when every other channel agrees,
 *   - the stamp angle, folded to 180° (0.12) — a chisel's whole identity,
 *   - spacing, scatter, flow, softness and grain (0.18) — how the dab repeats and deposits,
 *   - nib width as a log ratio (0.15) — the same shape at twice the width is a different brush,
 *   - whether taper is on (0.05) — a stroke that thins into its ends versus one that does not.
 *
 * Above all of that sits a floor: two brushes that disagree on dual-brush, tip-layer count or grain
 * space are never near-duplicates however closely their tips match, because each of those changes
 * the mark outright. oil-impasto-heavy and oil-linen-filbert stamp near-identical silhouettes
 * (tip 0.033) and the floor is the only thing that keeps them from being nominated.
 *
 * Roundness and taper were added after a first sweep flagged pairs an artist reads as clearly
 * distinct: cloud-cirrus-stream vs smoke-wisp-layered agree on tip and scalars but sit at roundness
 * 0.42 vs 0.84, and horizontal-blade vs directional-flat share a byte-identical chisel alpha map
 * while differing in roundness, taper and scatter. A metric blind to those channels nominates cuts
 * that would flatten real expressive axes.
 *
 * The tip is built with the renderer's own `buildStudioBrushTipAlphaMap`, so primitive-tip brushes
 * count too. Reading the raw `alphaMapBase64` only ever saw the custom maps, which silently hid 20
 * of the 87 listed presets — whole categories could never be nominated, and the audit reported a
 * clean sweep over a population it had quietly cut by a quarter.
 *
 * The per-index noise seed is excluded on purpose: it moves grain placement without changing the
 * character an artist is choosing between. Only same-category pairs are reported, because the
 * quarantine ledger's removal precondition is an exposed in-group alternative.
 *
 * Run: pnpm run audit:studio-brush-mark-distance [--limit 8] [--threshold 0.12]
 * Output is a report, never a gate — every cut still needs an owner-auditable ledger entry.
 */
import { STUDIO_BRUSH_PACK_DESCRIPTORS } from "../apps/web/src/domains/creator/brush/studio-brush-pack-index";
import { materializeStudioBrushPackDynamics } from "../apps/web/src/domains/creator/brush/studio-brush-pack-runtime";
import { isStudioBrushQuarantinedPresetId } from "../apps/web/src/domains/creator/brush/studio-brush-quarantine";
import { buildStudioBrushTipAlphaMap } from "../apps/web/src/domains/creator/brush/studio-brush-tip-stamp";

const SCALAR_CHANNELS = [
  "spacingRatio",
  "scatterRatio",
  "flow",
  "softness",
  "grainAmount",
  "grainScale",
  "grainContrast",
] as const;

type ScalarChannel = (typeof SCALAR_CHANNELS)[number];

/**
 * Every tip is compared on this grid. Primitive tips come back at 128 and custom ones at 64, so a
 * raw difference would be measuring the resolution rather than the silhouette.
 */
const TIP_GRID = 64;

/** Nearest-neighbour resample of a square 0..1 alpha map onto TIP_GRID. */
function resampleTip(alphas: Float32Array, size: number): Float32Array {
  if (size === TIP_GRID) return alphas;
  const out = new Float32Array(TIP_GRID * TIP_GRID);
  for (let y = 0; y < TIP_GRID; y += 1) {
    const sourceY = Math.min(size - 1, Math.floor((y * size) / TIP_GRID));
    for (let x = 0; x < TIP_GRID; x += 1) {
      const sourceX = Math.min(size - 1, Math.floor((x * size) / TIP_GRID));
      out[y * TIP_GRID + x] = alphas[sourceY * size + sourceX] ?? 0;
    }
  }
  return out;
}

interface BrushMark {
  readonly id: string;
  readonly name: string;
  readonly runtime: string;
  readonly category: string;
  readonly angle: number;
  readonly roundness: number;
  readonly tapered: boolean;
  readonly alpha: Float32Array;
  readonly defaultWidth: number;
  /** Channels that change the mark outright; a mismatch floors the distance rather than nudging it. */
  readonly dualBrush: boolean;
  readonly tipLayers: number;
  readonly grainSpace: string;
  readonly scalars: Readonly<Record<ScalarChannel, number>>;
}

function numberArg(flag: string, fallback: number): number {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function collectMarks(): BrushMark[] {
  const marks: BrushMark[] = [];
  for (const descriptor of STUDIO_BRUSH_PACK_DESCRIPTORS) {
    if (isStudioBrushQuarantinedPresetId(descriptor.catalogId)) continue;
    const dynamics = materializeStudioBrushPackDynamics(descriptor.catalogId);
    if (!dynamics) continue;
    // Build the tip the renderer would stamp. Reading `alphaMapBase64` directly only ever saw the
    // custom maps and silently skipped every primitive-tip brush — 20 of the 87 listed presets,
    // including whole categories, were invisible to this audit and could never be nominated.
    const tip = buildStudioBrushTipAlphaMap(dynamics.tip);
    marks.push({
      id: descriptor.catalogId,
      name: descriptor.catalogName,
      runtime: descriptor.runtimeBrushId,
      category: descriptor.category,
      angle: Number(dynamics.angle.base ?? 0),
      roundness: Number(dynamics.roundness.base ?? 1),
      tapered: dynamics.taper.enabled === true,
      alpha: resampleTip(tip.alphas, tip.size),
      defaultWidth: Number(descriptor.defaultWidth ?? 0),
      dualBrush: (dynamics as { dualBrush?: { enabled?: boolean } }).dualBrush?.enabled === true,
      tipLayers: dynamics.tipLayers?.length ?? 0,
      grainSpace: String(dynamics.grain.space ?? ""),
      scalars: {
        spacingRatio: Number(dynamics.spacingRatio ?? 0),
        scatterRatio: Number(dynamics.scatterRatio ?? 0),
        flow: Number(dynamics.flow.base ?? 0),
        softness: Number(dynamics.tip.softness ?? 0),
        grainAmount: Number(dynamics.grain.amount ?? 0),
        grainScale: Number(dynamics.grain.scale ?? 0),
        grainContrast: Number(dynamics.grain.contrast ?? 0),
      },
    });
  }
  return marks;
}

/** Mean absolute alpha difference on the common grid; 0 means the two tips stamp the same shape. */
function tipDistance(left: BrushMark, right: BrushMark): number {
  if (left.alpha.length !== right.alpha.length) return 1;
  let total = 0;
  for (let index = 0; index < left.alpha.length; index += 1) {
    total += Math.abs(left.alpha[index]! - right.alpha[index]!);
  }
  // Samples are already 0..1, so the mean is the distance.
  return total / left.alpha.length;
}

/**
 * A floor for differences the silhouette cannot show. A second tip stamped alongside the first, an
 * extra tip layer, or grain pinned to the canvas instead of the stroke each change the mark
 * outright, so two brushes that disagree on any of them are never near-duplicates however closely
 * their tips match. Without this the widened population nominates oil-impasto-heavy against
 * oil-linen-filbert — same silhouette, but one lays a dual-brush stamp the other does not.
 */
const STRUCTURAL_FLOOR = 0.18;

function structuralFloor(left: BrushMark, right: BrushMark): number {
  const differs =
    left.dualBrush !== right.dualBrush
    || left.tipLayers !== right.tipLayers
    || left.grainSpace !== right.grainSpace;
  return differs ? STRUCTURAL_FLOOR : 0;
}

/**
 * Nib size as a log ratio, so a 3px liner is never scored against a 7px shader on silhouette alone —
 * the same shape at twice the width is a different brush to draw with.
 */
function widthDistance(left: BrushMark, right: BrushMark): number {
  const a = Math.max(1, left.defaultWidth);
  const b = Math.max(1, right.defaultWidth);
  return Math.min(1, Math.abs(Math.log2(a / b)) / 2);
}

function main(): void {
  const limit = numberArg("--limit", 8);
  const threshold = numberArg("--threshold", 0.12);
  const marks = collectMarks();
  if (marks.length === 0) {
    console.error("no listed procedural brush produced a tip alpha map");
    process.exitCode = 1;
    return;
  }

  const ranges = new Map<ScalarChannel, number>(
    SCALAR_CHANNELS.map((channel) => {
      const values = marks.map((mark) => mark.scalars[channel]);
      return [channel, Math.max(...values) - Math.min(...values) || 1];
    }),
  );

  function markDistance(left: BrushMark, right: BrushMark): {
    total: number;
    tip: number;
    scalar: number;
    angle: number;
    roundness: number;
  } {
    const tip = tipDistance(left, right);
    let squared = 0;
    for (const channel of SCALAR_CHANNELS) {
      const delta = (left.scalars[channel] - right.scalars[channel]) / ranges.get(channel)!;
      squared += delta * delta;
    }
    const scalar = Math.sqrt(squared / SCALAR_CHANNELS.length);
    const wrapped = (((left.angle - right.angle) % 180) + 180) % 180;
    const angle = Math.min(wrapped, 180 - wrapped) / 90;
    const roundness = Math.min(1, Math.abs(left.roundness - right.roundness));
    const taper = left.tapered === right.tapered ? 0 : 1;
    const width = widthDistance(left, right);
    const weighted =
      tip * 0.38 + roundness * 0.12 + angle * 0.12 + scalar * 0.18 + taper * 0.05 + width * 0.15;
    return {
      total: Math.max(weighted, structuralFloor(left, right)),
      tip,
      scalar,
      angle,
      roundness,
    };
  }

  const byCategory = new Map<string, BrushMark[]>();
  for (const mark of marks) {
    const list = byCategory.get(mark.category) ?? [];
    list.push(mark);
    byCategory.set(mark.category, list);
  }

  console.log(`listed procedural brushes with tips: ${marks.length}`);
  console.log(`reporting same-category pairs under ${threshold} (max ${limit} per category)`);
  let reported = 0;
  for (const [category, list] of [...byCategory].sort((a, b) => b[1].length - a[1].length)) {
    if (list.length < 2) continue;
    const pairs = [];
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        pairs.push({ ...markDistance(list[i]!, list[j]!), left: list[i]!, right: list[j]! });
      }
    }
    const close = pairs.filter((pair) => pair.total < threshold).sort((a, b) => a.total - b.total);
    if (close.length === 0) continue;
    reported += close.length;
    console.log(`\n### ${category} — ${list.length} listed, ${close.length} pair(s) under ${threshold}`);
    for (const pair of close.slice(0, limit)) {
      console.log(
        `  ${pair.total.toFixed(4)}  tip=${pair.tip.toFixed(4)} round=${pair.roundness.toFixed(3)}`
        + ` angle=${pair.angle.toFixed(3)} scalar=${pair.scalar.toFixed(3)}`
        + `  ${pair.left.name}(${pair.left.id})  <->  ${pair.right.name}(${pair.right.id})`,
      );
    }
  }
  if (reported === 0) console.log("\nno same-category pair is closer than the threshold");
}

main();
