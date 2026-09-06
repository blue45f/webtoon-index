/**
 * Renderer-neutral, prefix-stable dry-media grain kernel.
 *
 * The existing dynamic-brush renderer can consume the returned marks as rotated ellipses or
 * capsules. SVG can lower the same contract to paths, while WebGPU can upload the packed float
 * layout below. The kernel deliberately owns no Canvas, SVG, DOM or GPU state.
 *
 * Every random-looking value is a stateless hash of the stroke seed, station index and fibre lane.
 * Consequently an accepted live prefix never changes when more pointer samples arrive, and batch
 * planning is byte-for-byte equivalent to arbitrary streaming chunk boundaries.
 */

export const STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1 = 1 as const;

export const STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1 = Object.freeze({
  coordinateAbs: 1_000_000_000,
  baseWidth: Object.freeze({ min: 0.25, max: 4_096 }),
  stations: Object.freeze({ min: 1, max: 131_072 }),
  marks: Object.freeze({ min: 1, max: 1_048_576 }),
  packedBytes: Object.freeze({ min: 64, max: 256 * 1024 * 1024 }),
});

export const DEFAULT_STUDIO_DRY_MEDIA_MAX_STATIONS_V1 = 131_072;
export const DEFAULT_STUDIO_DRY_MEDIA_MAX_MARKS_V1 = 524_288;
export const DEFAULT_STUDIO_DRY_MEDIA_PACKED_BYTE_BUDGET_V1 = 64 * 1024 * 1024;

const TAU = Math.PI * 2;
const POINT_EPSILON = 1e-7;
const MIN_STATION_SPACING = 0.25;
const UINT32_RANGE = 0x1_0000_0000;

export type StudioDryMediaAnisotropicPresetIdV1 =
  | "crayon"
  | "charcoal"
  | "chalk"
  | "pastel";

export type StudioDryMediaAnisotropicMarkShapeV1 =
  | "wax-ribbon"
  | "carbon-fiber"
  | "mineral-flake"
  | "soft-pigment-fiber";

export interface StudioDryMediaAnisotropicPresetV1 {
  readonly id: StudioDryMediaAnisotropicPresetIdV1;
  readonly shape: StudioDryMediaAnisotropicMarkShapeV1;
  readonly laneCount: number;
  readonly minimumLaneCount: number;
  readonly density: number;
  readonly spacingRatio: number;
  readonly minimumSpacing: number;
  readonly widthScale: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
    readonly pressureCurve: number;
  }>;
  readonly opacityScale: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
    readonly pressureCurve: number;
  }>;
  readonly flowScale: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
    readonly pressureCurve: number;
  }>;
  readonly halfLengthRatio: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
  }>;
  readonly halfThicknessRatio: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
  }>;
  /** Every emitted mark satisfies this, preventing a round-dot silhouette at any zoom. */
  readonly minimumAspectRatio: number;
  readonly lateralSpread: number;
  readonly longitudinalJitter: number;
  readonly orientationJitterRadians: number;
  readonly tangentResponse: number;
  readonly tiltOrientationInfluence: number;
  readonly twistInfluence: number;
  readonly hardness: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
  }>;
  readonly edgeRoughness: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
  }>;
  readonly grainFrequency: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
  }>;
  /** 2 is an ellipse; larger values form a flatter mineral/wax flake. */
  readonly superellipseExponent: Readonly<{
    readonly minimum: number;
    readonly maximum: number;
  }>;
}

function freezePreset(
  preset: StudioDryMediaAnisotropicPresetV1,
): StudioDryMediaAnisotropicPresetV1 {
  return Object.freeze({
    ...preset,
    widthScale: Object.freeze({ ...preset.widthScale }),
    opacityScale: Object.freeze({ ...preset.opacityScale }),
    flowScale: Object.freeze({ ...preset.flowScale }),
    halfLengthRatio: Object.freeze({ ...preset.halfLengthRatio }),
    halfThicknessRatio: Object.freeze({ ...preset.halfThicknessRatio }),
    hardness: Object.freeze({ ...preset.hardness }),
    edgeRoughness: Object.freeze({ ...preset.edgeRoughness }),
    grainFrequency: Object.freeze({ ...preset.grainFrequency }),
    superellipseExponent: Object.freeze({ ...preset.superellipseExponent }),
  });
}

/**
 * Four material responses intentionally differ in density, edge shape and fibre geometry instead
 * of merely changing opacity on one circular stamp.
 */
export const STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1 = Object.freeze({
  crayon: freezePreset({
    id: "crayon",
    shape: "wax-ribbon",
    laneCount: 5,
    minimumLaneCount: 3,
    density: 0.9,
    spacingRatio: 0.26,
    minimumSpacing: 0.4,
    // Strong wax pack under pressure: light touch scuffs paper tooth, heavy contact occludes it.
    widthScale: { minimum: 0.34, maximum: 1.16, pressureCurve: 0.72 },
    opacityScale: { minimum: 0.28, maximum: 0.96, pressureCurve: 0.68 },
    flowScale: { minimum: 0.4, maximum: 0.98, pressureCurve: 0.76 },
    // Longer anisotropic ribbons keep continuous tooth; thickness stays narrow so lanes read as
    // wax streaks rather than isotropic noise tiles or isolated lozenges.
    halfLengthRatio: { minimum: 0.58, maximum: 0.82 },
    halfThicknessRatio: { minimum: 0.09, maximum: 0.14 },
    minimumAspectRatio: 3.6,
    lateralSpread: 0.3,
    longitudinalJitter: 0.06,
    orientationJitterRadians: 0.032,
    tangentResponse: 0.9,
    tiltOrientationInfluence: 0.36,
    twistInfluence: 0.1,
    hardness: { minimum: 0.62, maximum: 0.94 },
    edgeRoughness: { minimum: 0.22, maximum: 0.54 },
    grainFrequency: { minimum: 1.15, maximum: 2.6 },
    superellipseExponent: { minimum: 2.9, maximum: 5.2 },
  }),
  charcoal: freezePreset({
    id: "charcoal",
    shape: "carbon-fiber",
    laneCount: 7,
    minimumLaneCount: 3,
    density: 0.72,
    spacingRatio: 0.27,
    minimumSpacing: 0.4,
    widthScale: { minimum: 0.35, maximum: 1.22, pressureCurve: 0.66 },
    opacityScale: { minimum: 0.2, maximum: 0.82, pressureCurve: 0.82 },
    flowScale: { minimum: 0.3, maximum: 0.84, pressureCurve: 0.72 },
    halfLengthRatio: { minimum: 0.68, maximum: 0.95 },
    halfThicknessRatio: { minimum: 0.16, maximum: 0.2 },
    minimumAspectRatio: 3.4,
    lateralSpread: 0.46,
    longitudinalJitter: 0.1,
    orientationJitterRadians: 0.075,
    tangentResponse: 0.7,
    tiltOrientationInfluence: 0.48,
    twistInfluence: 0.12,
    hardness: { minimum: 0.32, maximum: 0.7 },
    edgeRoughness: { minimum: 0.48, maximum: 0.92 },
    grainFrequency: { minimum: 1.25, maximum: 3.4 },
    superellipseExponent: { minimum: 1.8, maximum: 2.5 },
  }),
  chalk: freezePreset({
    id: "chalk",
    shape: "mineral-flake",
    laneCount: 7,
    minimumLaneCount: 5,
    density: 0.64,
    spacingRatio: 0.38,
    minimumSpacing: 0.55,
    widthScale: { minimum: 0.48, maximum: 1.12, pressureCurve: 0.88 },
    opacityScale: { minimum: 0.26, maximum: 0.78, pressureCurve: 0.9 },
    flowScale: { minimum: 0.35, maximum: 0.76, pressureCurve: 0.9 },
    halfLengthRatio: { minimum: 0.38, maximum: 0.6 },
    halfThicknessRatio: { minimum: 0.15, maximum: 0.2 },
    minimumAspectRatio: 2.1,
    lateralSpread: 0.43,
    longitudinalJitter: 0.12,
    orientationJitterRadians: 0.11,
    tangentResponse: 0.62,
    tiltOrientationInfluence: 0.36,
    twistInfluence: 0.08,
    hardness: { minimum: 0.5, maximum: 0.86 },
    edgeRoughness: { minimum: 0.58, maximum: 0.98 },
    grainFrequency: { minimum: 1.8, maximum: 4.2 },
    superellipseExponent: { minimum: 3.2, maximum: 6 },
  }),
  pastel: freezePreset({
    id: "pastel",
    shape: "soft-pigment-fiber",
    laneCount: 7,
    minimumLaneCount: 5,
    density: 0.88,
    spacingRatio: 0.24,
    minimumSpacing: 0.35,
    widthScale: { minimum: 0.4, maximum: 1.16, pressureCurve: 0.72 },
    opacityScale: { minimum: 0.3, maximum: 0.86, pressureCurve: 0.76 },
    flowScale: { minimum: 0.42, maximum: 0.9, pressureCurve: 0.72 },
    halfLengthRatio: { minimum: 0.68, maximum: 0.92 },
    halfThicknessRatio: { minimum: 0.17, maximum: 0.22 },
    minimumAspectRatio: 3.05,
    lateralSpread: 0.48,
    longitudinalJitter: 0.08,
    orientationJitterRadians: 0.075,
    tangentResponse: 0.76,
    tiltOrientationInfluence: 0.42,
    twistInfluence: 0.1,
    hardness: { minimum: 0.2, maximum: 0.58 },
    edgeRoughness: { minimum: 0.28, maximum: 0.64 },
    grainFrequency: { minimum: 0.9, maximum: 2.6 },
    superellipseExponent: { minimum: 1.8, maximum: 2.8 },
  }),
} as const satisfies Readonly<
  Record<StudioDryMediaAnisotropicPresetIdV1, StudioDryMediaAnisotropicPresetV1>
>);

export const STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1 = Object.freeze({
  "powder-sketch": "chalk",
  "round-sketch": "charcoal",
  "fiber-sketch": "charcoal",
  "precision-pencil": "charcoal",
  "comfort-pencil": "charcoal",
  "needle-graphite": "charcoal",
  "chalk-powder": "chalk",
  "chalk-rough": "chalk",
  "chalk-compressed": "chalk",
  "velvet-charcoal": "charcoal",
  "scattered-flat": "pastel",
  "directional-flat": "pastel",
  "fiber-marker": "pastel",
  "rough-grain": "chalk",
  "strong-rough-grain": "chalk",
  "heavy-rough-grain": "chalk",
  "plaster-texture": "chalk",
  "paint-roller": "crayon",
  "rough-ink": "charcoal",
  "fine-rake": "charcoal",
  "wide-rake": "charcoal",
  "dry-rake": "charcoal",
  "broken-nib-ink": "charcoal",
  "side-graphite-shade": "charcoal",
  "compressed-charcoal-edge": "charcoal",
  "oil-filbert": "crayon",
  "taper-brush-marker": "pastel",
  "cloth-fold-rake": "charcoal",
  "pencil-4b-rough": "charcoal",
  "pencil-hb-mechanical": "charcoal",
  "pencil-colored-soft": "crayon",
  "pencil-charcoal-stick": "charcoal",
  "pencil-tilt-shading": "charcoal",
  "oil-dry-scumble": "crayon",
  "crayon-wax-bold": "crayon",
  "pastel-paper-soft": "pastel",
  "wood-grain-flow": "charcoal",
  "bristle-fan-dry": "charcoal",
  "bristle-flat-streak": "pastel",
  "watercolor-dry-granule": "chalk",
  "gouache-grain-flat": "crayon",
  "oil-linen-filbert": "crayon",
  "sumi-wash-fray": "charcoal",
  "wood-knot-rake": "charcoal",
  "hatching-contour-rake": "charcoal",
} as const satisfies Readonly<Record<string, StudioDryMediaAnisotropicPresetIdV1>>);

/**
 * These dry-media runtime brushes intentionally deposit recognisable motif/stamp particles.
 * Passing them through a continuous fibre carrier would erase their authored visual language, so
 * the product keeps their existing discrete renderer explicitly rather than treating them as an
 * unknown fallback.
 */
export const STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_IDS_V1 =
  Object.freeze([
    "willow-fiber",
    "fabric-texture",
    "sand-texture",
    "rock-texture",
    "bumpy-grain",
    "foliage-texture",
    "loose-grass",
    "dense-grass",
    "rough-stripe",
    "cross-hatch",
    "canvas-weave",
    "sponge-stipple-dab",
    "fabric-knit-loop",
    "metal-scratch-brush",
    "tree-bark-crack",
    "rock-shard-texture",
  ] as const);

const STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_ID_SET_V1 =
  new Set<string>(STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_IDS_V1);

export type StudioDryMediaCatalogClassificationV1 =
  | Readonly<{
      readonly kind: "anisotropic-continuous";
      readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
    }>
  | Readonly<{
      readonly kind: "intentional-discrete";
    }>;

export function classifyStudioDryMediaCatalogIdV1(
  catalogId: unknown,
): StudioDryMediaCatalogClassificationV1 | null {
  if (typeof catalogId !== "string") return null;
  if (Object.hasOwn(STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1, catalogId)) {
    return Object.freeze({
      kind: "anisotropic-continuous",
      presetId: STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1[
        catalogId as keyof typeof STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1
      ],
    });
  }
  return STUDIO_DRY_MEDIA_INTENTIONAL_DISCRETE_CATALOG_ID_SET_V1.has(catalogId)
    ? Object.freeze({ kind: "intentional-discrete" })
    : null;
}

export function isStudioDryMediaAnisotropicPresetIdV1(
  value: unknown,
): value is StudioDryMediaAnisotropicPresetIdV1 {
  return typeof value === "string"
    && Object.hasOwn(STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1, value);
}

/**
 * Resolves core physical brush ids directly and every shipped `dry-media` catalogue id through the
 * explicit classification table above. Continuous pencil, chalk, charcoal, crayon, dry-ink,
 * roller and rake materials receive an anisotropic carrier; only entries explicitly classified as
 * intentional motif/stamp deposits keep their authored discrete renderer. A generic `dry-media`
 * id without catalogue provenance remains unsupported rather than being guessed.
 *
 * This resolver is a stored-replay authority: persisted material identity is recomputed from it on
 * every render, so its answers are frozen for every id combination that ever shipped.
 * - The runtime brush id wins with EXACT matching only. Engine-lane ids such as
 *   `crayon--wax-scrape` or `oil-pastel--waxy-film` are pre-wave persisted dynamic lanes whose
 *   identity is null (bridge identity pass, mark multiplier 1); any prefix heuristic would flip
 *   their stored strokes into a 3–5x anisotropic lane expansion.
 * - Catalogue classification consults the explicit `brushCatalogId` key table only, never the
 *   brush id, so a core runtime id (`"chalk"`) is never overridden by its catalogue material.
 * A new lane that deserves a material identity must be added as an explicit exact entry to
 * `STUDIO_DRY_MEDIA_ANISOTROPIC_CATALOG_PRESETS_V1` instead of widening this matcher.
 */
export function resolveStudioDryMediaAnisotropicPresetIdV1(
  brushId: unknown,
  brushCatalogId?: unknown,
): StudioDryMediaAnisotropicPresetIdV1 | null {
  if (
    brushId === "crayon"
    || brushId === "charcoal"
    || brushId === "chalk"
    || brushId === "pastel"
  ) return brushId;
  if (brushId === "oil-pastel") return "pastel";
  const classification = classifyStudioDryMediaCatalogIdV1(brushCatalogId);
  return classification?.kind === "anisotropic-continuous"
    ? classification.presetId
    : null;
}

export interface StudioDryMediaAnisotropicDabResponseInputV1 {
  readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
  readonly seed: number;
  readonly stationIndex: number;
  /** Canonical pre-floor pressure. Pigment density must never be derived from a width floor. */
  readonly pressure: number;
  readonly tangentRadians: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly twist?: number;
}

export interface StudioDryMediaAnisotropicDabResponseV1 {
  readonly shape: StudioDryMediaAnisotropicMarkShapeV1;
  /** Independent canonical-pressure responses for geometry and pigment deposition. */
  readonly widthScale: number;
  readonly opacityScale: number;
  readonly flowScale: number;
  /** Converts the nominal brush footprint to the fibre's major ellipse diameter. */
  readonly majorAxisScale: number;
  readonly roundness: number;
  readonly angleRadians: number;
  readonly longitudinalOffsetRatio: number;
  readonly lateralOffsetRatio: number;
  readonly coverageScale: number;
}

/**
 * Stateless one-deposit projection used by the production causal brush resolver.
 *
 * The full planner below emits several material lanes per station for future GPU lowering. The
 * current shared Canvas/SVG dab contract accepts one ellipse per causal deposit, so this adapter
 * deterministically walks those lanes by station index. It preserves the same pressure, tangent,
 * tilt and seeded material ranges without introducing a second renderer or changing prefix work.
 */
export function resolveStudioDryMediaAnisotropicDabResponseV1(
  input: StudioDryMediaAnisotropicDabResponseInputV1,
): StudioDryMediaAnisotropicDabResponseV1 | null {
  if (
    !isStudioDryMediaAnisotropicPresetIdV1(input?.presetId)
    || !Number.isSafeInteger(input.seed)
    || input.seed < 0
    || input.seed > 0xffff_ffff
    || !Number.isSafeInteger(input.stationIndex)
    || input.stationIndex < 0
    || !Number.isFinite(input.pressure)
    || input.pressure < 0
    || input.pressure > 1
    || !Number.isFinite(input.tangentRadians)
  ) return null;
  const tiltX = input.tiltX ?? 0;
  const tiltY = input.tiltY ?? 0;
  const twist = input.twist ?? 0;
  if (
    !Number.isFinite(tiltX)
    || tiltX < -90
    || tiltX > 90
    || !Number.isFinite(tiltY)
    || tiltY < -90
    || tiltY > 90
    || !Number.isFinite(twist)
    || twist < 0
    || twist > 359
  ) return null;

  const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1[input.presetId];
  const laneIndex = input.stationIndex % preset.laneCount;
  const laneUnit = preset.laneCount <= 1
    ? 0
    : laneIndex / (preset.laneCount - 1) * 2 - 1;
  const tiltLength = Math.hypot(tiltX, tiltY);
  const tiltMagnitude = clamp01(tiltLength / 90);
  const tiltAzimuth = tiltLength <= POINT_EPSILON
    ? input.tangentRadians
    : Math.atan2(tiltY, tiltX);
  const orientation = normalizeRadians(
    mixRadians(
      input.tangentRadians,
      tiltAzimuth,
      tiltMagnitude * preset.tiltOrientationInfluence,
    )
    + twist / 360 * TAU * preset.twistInfluence
    + (deterministicUnit(input.seed, input.stationIndex, laneIndex, 5) * 2 - 1)
      * preset.orientationJitterRadians,
  );
  const halfLengthRatio = mix(
    preset.halfLengthRatio.minimum,
    preset.halfLengthRatio.maximum,
    deterministicUnit(input.seed, input.stationIndex, laneIndex, 3),
  );
  const sampledHalfThicknessRatio = mix(
    preset.halfThicknessRatio.minimum,
    preset.halfThicknessRatio.maximum,
    deterministicUnit(input.seed, input.stationIndex, laneIndex, 4),
  );
  const halfThicknessRatio = Math.max(
    0.01,
    Math.min(
      sampledHalfThicknessRatio,
      halfLengthRatio / preset.minimumAspectRatio,
    ),
  );
  const lateralNoise =
    deterministicUnit(input.seed, input.stationIndex, laneIndex, 1) * 2 - 1;
  const longitudinalNoise =
    deterministicUnit(input.seed, input.stationIndex, laneIndex, 2) * 2 - 1;

  return Object.freeze({
    shape: preset.shape,
    widthScale: mappedPressure(
      input.pressure,
      preset.widthScale.minimum,
      preset.widthScale.maximum,
      preset.widthScale.pressureCurve,
    ),
    opacityScale: mappedPressure(
      input.pressure,
      preset.opacityScale.minimum,
      preset.opacityScale.maximum,
      preset.opacityScale.pressureCurve,
    ),
    flowScale: mappedPressure(
      input.pressure,
      preset.flowScale.minimum,
      preset.flowScale.maximum,
      preset.flowScale.pressureCurve,
    ),
    majorAxisScale: halfLengthRatio * 2,
    roundness: clamp(halfThicknessRatio / halfLengthRatio, 0.08, 1),
    angleRadians: orientation,
    longitudinalOffsetRatio:
      preset.spacingRatio * preset.longitudinalJitter * longitudinalNoise,
    lateralOffsetRatio:
      preset.lateralSpread
      // A lane is a continuous fibre, not a fresh random stamp. The former 28% station-local
      // lateral noise made neighbouring centres jump far enough to reveal leaf/confetti motifs in
      // long strokes. Preserve a small seeded tooth while keeping the lane centre causal and
      // visually continuous; fine paper grain is applied inside the connected pigment bed.
      * clamp(laneUnit * 0.92 + lateralNoise * 0.08, -1, 1),
    coverageScale:
      0.78 + deterministicUnit(
        input.seed,
        input.stationIndex,
        laneIndex,
        6,
      ) * 0.22,
  });
}

export interface StudioDryMediaAnisotropicSampleV1 {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly twist?: number;
}

export interface StudioDryMediaAnisotropicOptionsV1 {
  readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
  readonly seed: number;
  readonly baseWidth: number;
  readonly maximumStations?: number;
  readonly maximumMarks?: number;
}

export interface StudioDryMediaAnisotropicStationV1 {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly cumulativeDistance: number;
  readonly tangentRadians: number;
  readonly tiltAzimuthRadians: number;
  readonly orientationRadians: number;
  readonly pressure: number;
  readonly tiltMagnitude: number;
  readonly width: number;
  readonly opacity: number;
  readonly flow: number;
  readonly spacing: number;
}

export interface StudioDryMediaAnisotropicMarkV1 {
  readonly version: typeof STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1;
  readonly shape: StudioDryMediaAnisotropicMarkShapeV1;
  readonly stationIndex: number;
  readonly laneIndex: number;
  readonly x: number;
  readonly y: number;
  readonly halfLength: number;
  readonly halfThickness: number;
  readonly angleRadians: number;
  /** Product of station opacity, flow and deterministic lane coverage. */
  readonly alpha: number;
  readonly opacity: number;
  readonly flow: number;
  readonly hardness: number;
  readonly edgeRoughness: number;
  readonly grainFrequency: number;
  readonly grainPhase: number;
  readonly superellipseExponent: number;
}

export interface StudioDryMediaAnisotropicWorkV1 {
  readonly sourceSamples: number;
  readonly evaluatedSegments: number;
  readonly emittedStations: number;
  readonly evaluatedMarkCandidates: number;
  readonly emittedMarks: number;
}

interface StudioDryMediaNormalizedSampleV1 {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
}

export interface StudioDryMediaAnisotropicStateV1 {
  readonly kind: "studio-dry-media-anisotropic-state";
  readonly version: typeof STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1;
  readonly presetId: StudioDryMediaAnisotropicPresetIdV1;
  readonly seed: number;
  readonly baseWidth: number;
  readonly maximumStations: number;
  readonly maximumMarks: number;
  readonly previousSample: StudioDryMediaNormalizedSampleV1;
  readonly lastTangentRadians: number;
  readonly cumulativeDistance: number;
  readonly distanceSinceLastStation: number;
  readonly lastSpacing: number;
  readonly nextStationIndex: number;
  readonly emittedMarkCount: number;
  readonly sourceSampleCount: number;
  readonly evaluatedSegmentCount: number;
  readonly evaluatedMarkCandidateCount: number;
}

export type StudioDryMediaAnisotropicFailureReasonV1 =
  | "invalid-input"
  | "invalid-options"
  | "invalid-state"
  | "station-budget"
  | "mark-budget"
  | "numeric-overflow";

interface StudioDryMediaAnisotropicFailureV1 {
  readonly ok: false;
  readonly reason: StudioDryMediaAnisotropicFailureReasonV1;
}

export type StudioDryMediaAnisotropicBeginResultV1 =
  | Readonly<{
      readonly ok: true;
      readonly state: StudioDryMediaAnisotropicStateV1;
      readonly station: StudioDryMediaAnisotropicStationV1;
      readonly marks: readonly StudioDryMediaAnisotropicMarkV1[];
      readonly work: StudioDryMediaAnisotropicWorkV1;
    }>
  | StudioDryMediaAnisotropicFailureV1;

export type StudioDryMediaAnisotropicAppendResultV1 =
  | Readonly<{
      readonly ok: true;
      readonly state: StudioDryMediaAnisotropicStateV1;
      readonly stations: readonly StudioDryMediaAnisotropicStationV1[];
      readonly marks: readonly StudioDryMediaAnisotropicMarkV1[];
      readonly work: StudioDryMediaAnisotropicWorkV1;
    }>
  | StudioDryMediaAnisotropicFailureV1;

export interface StudioDryMediaAnisotropicPlanInputV1 {
  readonly samples: readonly StudioDryMediaAnisotropicSampleV1[];
  readonly options: StudioDryMediaAnisotropicOptionsV1;
}

export type StudioDryMediaAnisotropicPlanResultV1 =
  | Readonly<{
      readonly ok: true;
      readonly state: StudioDryMediaAnisotropicStateV1;
      readonly stations: readonly StudioDryMediaAnisotropicStationV1[];
      readonly marks: readonly StudioDryMediaAnisotropicMarkV1[];
      readonly work: StudioDryMediaAnisotropicWorkV1;
    }>
  | StudioDryMediaAnisotropicFailureV1;

function failure(
  reason: StudioDryMediaAnisotropicFailureReasonV1,
): StudioDryMediaAnisotropicFailureV1 {
  return Object.freeze({ ok: false, reason });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function mix(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function normalizeRadians(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return ((value + Math.PI) % TAU + TAU) % TAU - Math.PI;
}

function mixRadians(left: number, right: number, amount: number): number {
  const t = clamp01(amount);
  const x = Math.cos(left) * (1 - t) + Math.cos(right) * t;
  const y = Math.sin(left) * (1 - t) + Math.sin(right) * t;
  if (Math.abs(x) <= POINT_EPSILON && Math.abs(y) <= POINT_EPSILON) {
    return normalizeRadians(left);
  }
  return Math.atan2(y, x);
}

function hash32(value: number): number {
  let result = value >>> 0;
  result ^= result >>> 16;
  result = Math.imul(result, 0x7feb352d);
  result ^= result >>> 15;
  result = Math.imul(result, 0x846ca68b);
  result ^= result >>> 16;
  return result >>> 0;
}

function deterministicUnit(
  seed: number,
  stationIndex: number,
  laneIndex: number,
  channel: number,
): number {
  const value = (seed >>> 0)
    ^ Math.imul(stationIndex + 1, 0x9e3779b1)
    ^ Math.imul(laneIndex + 1, 0x85ebca77)
    ^ Math.imul(channel + 1, 0xc2b2ae3d);
  return hash32(value) / UINT32_RANGE;
}

function mappedPressure(
  pressure: number,
  minimum: number,
  maximum: number,
  curve: number,
): number {
  return mix(minimum, maximum, Math.pow(clamp01(pressure), curve));
}

function normalizedSample(
  input: StudioDryMediaAnisotropicSampleV1,
): StudioDryMediaNormalizedSampleV1 | null {
  if (
    typeof input !== "object"
    || input === null
    || !Number.isFinite(input.x)
    || Math.abs(input.x) > STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.coordinateAbs
    || !Number.isFinite(input.y)
    || Math.abs(input.y) > STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.coordinateAbs
    || !Number.isFinite(input.pressure)
    || input.pressure < 0
    || input.pressure > 1
  ) return null;
  const tiltX = input.tiltX ?? 0;
  const tiltY = input.tiltY ?? 0;
  const twist = input.twist ?? 0;
  if (
    !Number.isFinite(tiltX)
    || tiltX < -90
    || tiltX > 90
    || !Number.isFinite(tiltY)
    || tiltY < -90
    || tiltY > 90
    || !Number.isFinite(twist)
    || twist < 0
    || twist > 359
  ) return null;
  return Object.freeze({
    x: input.x,
    y: input.y,
    pressure: input.pressure,
    tiltX,
    tiltY,
    twist,
  });
}

function sampleBetween(
  start: StudioDryMediaNormalizedSampleV1,
  end: StudioDryMediaNormalizedSampleV1,
  amount: number,
): StudioDryMediaNormalizedSampleV1 {
  const t = clamp01(amount);
  return {
    x: mix(start.x, end.x, t),
    y: mix(start.y, end.y, t),
    pressure: mix(start.pressure, end.pressure, t),
    tiltX: mix(start.tiltX, end.tiltX, t),
    tiltY: mix(start.tiltY, end.tiltY, t),
    twist: mix(start.twist, end.twist, t),
  };
}

function optionsAreValid(options: StudioDryMediaAnisotropicOptionsV1): boolean {
  if (typeof options !== "object" || options === null) return false;
  const maximumStations =
    options.maximumStations ?? DEFAULT_STUDIO_DRY_MEDIA_MAX_STATIONS_V1;
  const maximumMarks =
    options.maximumMarks ?? DEFAULT_STUDIO_DRY_MEDIA_MAX_MARKS_V1;
  return Object.hasOwn(STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1, options.presetId)
    && Number.isSafeInteger(options.seed)
    && options.seed >= 0
    && options.seed <= 0xffff_ffff
    && Number.isFinite(options.baseWidth)
    && options.baseWidth >= STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.baseWidth.min
    && options.baseWidth <= STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.baseWidth.max
    && Number.isSafeInteger(maximumStations)
    && maximumStations >= STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.stations.min
    && maximumStations <= STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.stations.max
    && Number.isSafeInteger(maximumMarks)
    && maximumMarks >= STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.marks.min
    && maximumMarks <= STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.marks.max;
}

function stateIsValid(state: StudioDryMediaAnisotropicStateV1): boolean {
  if (
    typeof state !== "object"
    || state === null
    || state.kind !== "studio-dry-media-anisotropic-state"
    || state.version !== STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1
    || !Object.hasOwn(STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1, state.presetId)
    || normalizedSample(state.previousSample) === null
    || !Number.isSafeInteger(state.seed)
    || state.seed < 0
    || state.seed > 0xffff_ffff
    || !Number.isFinite(state.baseWidth)
    || state.baseWidth < STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.baseWidth.min
    || state.baseWidth > STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.baseWidth.max
    || !Number.isSafeInteger(state.maximumStations)
    || state.maximumStations < STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.stations.min
    || state.maximumStations > STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.stations.max
    || !Number.isSafeInteger(state.maximumMarks)
    || state.maximumMarks < STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.marks.min
    || state.maximumMarks > STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.marks.max
  ) return false;
  const finiteNonNegative = [
    state.cumulativeDistance,
    state.distanceSinceLastStation,
    state.lastSpacing,
  ].every((value) => Number.isFinite(value) && value >= 0);
  return Number.isFinite(state.lastTangentRadians)
    && finiteNonNegative
    && state.lastSpacing >= MIN_STATION_SPACING
    && Number.isSafeInteger(state.nextStationIndex)
    && state.nextStationIndex >= 1
    && state.nextStationIndex <= state.maximumStations
    && Number.isSafeInteger(state.emittedMarkCount)
    && state.emittedMarkCount >= 0
    && state.emittedMarkCount <= state.maximumMarks
    && Number.isSafeInteger(state.sourceSampleCount)
    && state.sourceSampleCount >= 1
    && Number.isSafeInteger(state.evaluatedSegmentCount)
    && state.evaluatedSegmentCount >= 0
    && Number.isSafeInteger(state.evaluatedMarkCandidateCount)
    && state.evaluatedMarkCandidateCount >= state.emittedMarkCount;
}

function frozenState(
  state: Omit<StudioDryMediaAnisotropicStateV1, "kind" | "version">,
): StudioDryMediaAnisotropicStateV1 {
  return Object.freeze({
    kind: "studio-dry-media-anisotropic-state",
    version: STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1,
    ...state,
    previousSample: Object.freeze({ ...state.previousSample }),
  });
}

function tiltMetrics(
  sample: StudioDryMediaNormalizedSampleV1,
): Readonly<{ magnitude: number; azimuth: number }> {
  const length = Math.hypot(sample.tiltX, sample.tiltY);
  if (length <= POINT_EPSILON) return { magnitude: 0, azimuth: 0 };
  return {
    magnitude: clamp01(length / 90),
    azimuth: Math.atan2(sample.tiltY, sample.tiltX),
  };
}

function createStation(
  index: number,
  sample: StudioDryMediaNormalizedSampleV1,
  cumulativeDistance: number,
  tangentRadians: number,
  baseWidth: number,
  preset: StudioDryMediaAnisotropicPresetV1,
): StudioDryMediaAnisotropicStationV1 | null {
  const tilt = tiltMetrics(sample);
  const tiltMix = tilt.magnitude * preset.tiltOrientationInfluence;
  const tiltOrTangent = tilt.magnitude > 0
    ? mixRadians(tangentRadians, tilt.azimuth, tiltMix)
    : tangentRadians;
  const orientationRadians = normalizeRadians(
    tiltOrTangent + sample.twist / 360 * TAU * preset.twistInfluence,
  );
  const width = baseWidth * mappedPressure(
    sample.pressure,
    preset.widthScale.minimum,
    preset.widthScale.maximum,
    preset.widthScale.pressureCurve,
  );
  const opacity = mappedPressure(
    sample.pressure,
    preset.opacityScale.minimum,
    preset.opacityScale.maximum,
    preset.opacityScale.pressureCurve,
  );
  const flow = mappedPressure(
    sample.pressure,
    preset.flowScale.minimum,
    preset.flowScale.maximum,
    preset.flowScale.pressureCurve,
  );
  const spacing = Math.max(
    MIN_STATION_SPACING,
    preset.minimumSpacing,
    width * preset.spacingRatio,
  );
  const numeric = [
    cumulativeDistance,
    tangentRadians,
    tilt.azimuth,
    orientationRadians,
    width,
    opacity,
    flow,
    spacing,
  ];
  if (!numeric.every(Number.isFinite) || width <= 0 || spacing <= 0) return null;
  return Object.freeze({
    index,
    x: sample.x,
    y: sample.y,
    cumulativeDistance,
    tangentRadians: normalizeRadians(tangentRadians),
    tiltAzimuthRadians: normalizeRadians(tilt.azimuth),
    orientationRadians,
    pressure: sample.pressure,
    tiltMagnitude: tilt.magnitude,
    width,
    opacity: clamp01(opacity),
    flow: clamp01(flow),
    spacing,
  });
}

function createMarks(
  station: StudioDryMediaAnisotropicStationV1,
  preset: StudioDryMediaAnisotropicPresetV1,
  seed: number,
): Readonly<{
  marks: readonly StudioDryMediaAnisotropicMarkV1[];
  evaluatedCandidates: number;
}> | null {
  const marks: StudioDryMediaAnisotropicMarkV1[] = [];
  const tangentCosine = Math.cos(station.tangentRadians);
  const tangentSine = Math.sin(station.tangentRadians);
  const normalX = -tangentSine;
  const normalY = tangentCosine;

  for (let laneIndex = 0; laneIndex < preset.laneCount; laneIndex += 1) {
    const enabled = laneIndex < preset.minimumLaneCount
      || deterministicUnit(seed, station.index, laneIndex, 0) < preset.density;
    if (!enabled) continue;
    const laneUnit = preset.laneCount <= 1
      ? 0
      : laneIndex / (preset.laneCount - 1) * 2 - 1;
    const lateralNoise =
      deterministicUnit(seed, station.index, laneIndex, 1) * 2 - 1;
    const longitudinalNoise =
      deterministicUnit(seed, station.index, laneIndex, 2) * 2 - 1;
    const lateralOffset = station.width
      * preset.lateralSpread
      * clamp(laneUnit * 0.82 + lateralNoise * 0.28, -1, 1);
    const longitudinalOffset = station.spacing
      * preset.longitudinalJitter
      * longitudinalNoise;
    const halfLength = station.width * mix(
      preset.halfLengthRatio.minimum,
      preset.halfLengthRatio.maximum,
      deterministicUnit(seed, station.index, laneIndex, 3),
    );
    const sampledHalfThickness = station.width * mix(
      preset.halfThicknessRatio.minimum,
      preset.halfThicknessRatio.maximum,
      deterministicUnit(seed, station.index, laneIndex, 4),
    );
    const halfThickness = Math.max(
      0.08,
      Math.min(sampledHalfThickness, halfLength / preset.minimumAspectRatio),
    );
    const angleRadians = normalizeRadians(
      station.orientationRadians
        + (deterministicUnit(seed, station.index, laneIndex, 5) * 2 - 1)
          * preset.orientationJitterRadians,
    );
    const laneCoverage =
      0.58 + deterministicUnit(seed, station.index, laneIndex, 6) * 0.42;
    const alpha = clamp01(station.opacity * station.flow * laneCoverage);
    const mark: StudioDryMediaAnisotropicMarkV1 = Object.freeze({
      version: STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1,
      shape: preset.shape,
      stationIndex: station.index,
      laneIndex,
      x:
        station.x
        + tangentCosine * longitudinalOffset
        + normalX * lateralOffset,
      y:
        station.y
        + tangentSine * longitudinalOffset
        + normalY * lateralOffset,
      halfLength,
      halfThickness,
      angleRadians,
      alpha,
      opacity: station.opacity,
      flow: station.flow,
      hardness: mix(
        preset.hardness.minimum,
        preset.hardness.maximum,
        deterministicUnit(seed, station.index, laneIndex, 7),
      ),
      edgeRoughness: mix(
        preset.edgeRoughness.minimum,
        preset.edgeRoughness.maximum,
        deterministicUnit(seed, station.index, laneIndex, 8),
      ),
      grainFrequency: mix(
        preset.grainFrequency.minimum,
        preset.grainFrequency.maximum,
        deterministicUnit(seed, station.index, laneIndex, 9),
      ),
      grainPhase: deterministicUnit(seed, station.index, laneIndex, 10) * TAU,
      superellipseExponent: mix(
        preset.superellipseExponent.minimum,
        preset.superellipseExponent.maximum,
        deterministicUnit(seed, station.index, laneIndex, 11),
      ),
    });
    const numeric = [
      mark.x,
      mark.y,
      mark.halfLength,
      mark.halfThickness,
      mark.angleRadians,
      mark.alpha,
      mark.opacity,
      mark.flow,
      mark.hardness,
      mark.edgeRoughness,
      mark.grainFrequency,
      mark.grainPhase,
      mark.superellipseExponent,
    ];
    if (
      !numeric.every(Number.isFinite)
      || mark.halfLength <= 0
      || mark.halfThickness <= 0
      || mark.halfLength / mark.halfThickness + POINT_EPSILON
        < preset.minimumAspectRatio
    ) return null;
    marks.push(mark);
  }
  return Object.freeze({
    marks: Object.freeze(marks),
    evaluatedCandidates: preset.laneCount,
  });
}

function emptyWork(sourceSamples: number): StudioDryMediaAnisotropicWorkV1 {
  return Object.freeze({
    sourceSamples,
    evaluatedSegments: 0,
    emittedStations: 0,
    evaluatedMarkCandidates: 0,
    emittedMarks: 0,
  });
}

export function beginStudioDryMediaAnisotropicGrainV1(
  sampleInput: StudioDryMediaAnisotropicSampleV1,
  options: StudioDryMediaAnisotropicOptionsV1,
): StudioDryMediaAnisotropicBeginResultV1 {
  if (!optionsAreValid(options)) return failure("invalid-options");
  const sample = normalizedSample(sampleInput);
  if (!sample) return failure("invalid-input");
  const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1[options.presetId];
  const maximumStations =
    options.maximumStations ?? DEFAULT_STUDIO_DRY_MEDIA_MAX_STATIONS_V1;
  const maximumMarks =
    options.maximumMarks ?? DEFAULT_STUDIO_DRY_MEDIA_MAX_MARKS_V1;
  const tilt = tiltMetrics(sample);
  const initialTangent = tilt.magnitude > 0
    ? tilt.azimuth
    : normalizeRadians(sample.twist / 360 * TAU);
  const station = createStation(
    0,
    sample,
    0,
    initialTangent,
    options.baseWidth,
    preset,
  );
  if (!station) return failure("numeric-overflow");
  const plannedMarks = createMarks(station, preset, options.seed);
  if (!plannedMarks) return failure("numeric-overflow");
  if (plannedMarks.marks.length > maximumMarks) return failure("mark-budget");
  const state = frozenState({
    presetId: options.presetId,
    seed: options.seed,
    baseWidth: options.baseWidth,
    maximumStations,
    maximumMarks,
    previousSample: sample,
    lastTangentRadians: initialTangent,
    cumulativeDistance: 0,
    distanceSinceLastStation: 0,
    lastSpacing: station.spacing,
    nextStationIndex: 1,
    emittedMarkCount: plannedMarks.marks.length,
    sourceSampleCount: 1,
    evaluatedSegmentCount: 0,
    evaluatedMarkCandidateCount: plannedMarks.evaluatedCandidates,
  });
  return Object.freeze({
    ok: true,
    state,
    station,
    marks: plannedMarks.marks,
    work: Object.freeze({
      ...emptyWork(1),
      emittedStations: 1,
      evaluatedMarkCandidates: plannedMarks.evaluatedCandidates,
      emittedMarks: plannedMarks.marks.length,
    }),
  });
}

export function appendStudioDryMediaAnisotropicGrainV1(
  state: StudioDryMediaAnisotropicStateV1,
  sampleInputs: readonly StudioDryMediaAnisotropicSampleV1[],
): StudioDryMediaAnisotropicAppendResultV1 {
  if (!stateIsValid(state)) return failure("invalid-state");
  if (!Array.isArray(sampleInputs)) return failure("invalid-input");

  const preset = STUDIO_DRY_MEDIA_ANISOTROPIC_PRESETS_V1[state.presetId];
  let previousSample = state.previousSample;
  let lastTangentRadians = state.lastTangentRadians;
  let cumulativeDistance = state.cumulativeDistance;
  let distanceSinceLastStation = state.distanceSinceLastStation;
  let lastSpacing = state.lastSpacing;
  let nextStationIndex = state.nextStationIndex;
  let emittedMarkCount = state.emittedMarkCount;
  let evaluatedSegments = 0;
  let evaluatedMarkCandidates = 0;
  const stations: StudioDryMediaAnisotropicStationV1[] = [];
  const marks: StudioDryMediaAnisotropicMarkV1[] = [];

  for (const sampleInput of sampleInputs) {
    const nextSample = normalizedSample(sampleInput);
    if (!nextSample) return failure("invalid-input");
    evaluatedSegments += 1;
    const dx = nextSample.x - previousSample.x;
    const dy = nextSample.y - previousSample.y;
    const segmentLength = Math.hypot(dx, dy);
    if (!Number.isFinite(segmentLength)) return failure("numeric-overflow");
    if (segmentLength <= POINT_EPSILON) {
      previousSample = nextSample;
      continue;
    }

    const rawTangent = Math.atan2(dy, dx);
    const segmentTangent = mixRadians(
      lastTangentRadians,
      rawTangent,
      preset.tangentResponse,
    );
    let segmentOffset = 0;
    let remainingToNext = Math.max(
      MIN_STATION_SPACING,
      lastSpacing - distanceSinceLastStation,
    );
    while (
      remainingToNext <= segmentLength - segmentOffset + POINT_EPSILON
    ) {
      if (nextStationIndex >= state.maximumStations) {
        return failure("station-budget");
      }
      segmentOffset += remainingToNext;
      const amount = clamp01(segmentOffset / segmentLength);
      const sampled = sampleBetween(previousSample, nextSample, amount);
      const station = createStation(
        nextStationIndex,
        sampled,
        cumulativeDistance + segmentOffset,
        segmentTangent,
        state.baseWidth,
        preset,
      );
      if (!station) return failure("numeric-overflow");
      const plannedMarks = createMarks(station, preset, state.seed);
      if (!plannedMarks) return failure("numeric-overflow");
      evaluatedMarkCandidates += plannedMarks.evaluatedCandidates;
      if (
        emittedMarkCount + marks.length + plannedMarks.marks.length
          > state.maximumMarks
      ) return failure("mark-budget");
      stations.push(station);
      marks.push(...plannedMarks.marks);
      nextStationIndex += 1;
      lastSpacing = station.spacing;
      distanceSinceLastStation = 0;
      remainingToNext = lastSpacing;
    }
    distanceSinceLastStation += Math.max(0, segmentLength - segmentOffset);
    cumulativeDistance += segmentLength;
    lastTangentRadians = segmentTangent;
    previousSample = nextSample;
  }

  emittedMarkCount += marks.length;
  const nextState = frozenState({
    presetId: state.presetId,
    seed: state.seed,
    baseWidth: state.baseWidth,
    maximumStations: state.maximumStations,
    maximumMarks: state.maximumMarks,
    previousSample,
    lastTangentRadians,
    cumulativeDistance,
    distanceSinceLastStation,
    lastSpacing,
    nextStationIndex,
    emittedMarkCount,
    sourceSampleCount: state.sourceSampleCount + sampleInputs.length,
    evaluatedSegmentCount: state.evaluatedSegmentCount + evaluatedSegments,
    evaluatedMarkCandidateCount:
      state.evaluatedMarkCandidateCount + evaluatedMarkCandidates,
  });
  return Object.freeze({
    ok: true,
    state: nextState,
    stations: Object.freeze(stations),
    marks: Object.freeze(marks),
    work: Object.freeze({
      sourceSamples: sampleInputs.length,
      evaluatedSegments,
      emittedStations: stations.length,
      evaluatedMarkCandidates,
      emittedMarks: marks.length,
    }),
  });
}

export function planStudioDryMediaAnisotropicGrainV1(
  input: StudioDryMediaAnisotropicPlanInputV1,
): StudioDryMediaAnisotropicPlanResultV1 {
  if (
    typeof input !== "object"
    || input === null
    || !Array.isArray(input.samples)
    || input.samples.length < 1
  ) return failure("invalid-input");
  const begun = beginStudioDryMediaAnisotropicGrainV1(
    input.samples[0]!,
    input.options,
  );
  if (!begun.ok) return begun;
  const appended = appendStudioDryMediaAnisotropicGrainV1(
    begun.state,
    input.samples.slice(1),
  );
  if (!appended.ok) return appended;
  const stations = Object.freeze([begun.station, ...appended.stations]);
  const marks = Object.freeze([...begun.marks, ...appended.marks]);
  return Object.freeze({
    ok: true,
    state: appended.state,
    stations,
    marks,
    work: Object.freeze({
      sourceSamples: input.samples.length,
      evaluatedSegments: appended.work.evaluatedSegments,
      emittedStations: stations.length,
      evaluatedMarkCandidates:
        begun.work.evaluatedMarkCandidates
        + appended.work.evaluatedMarkCandidates,
      emittedMarks: marks.length,
    }),
  });
}

/**
 * Interleaved upload layout for WebGPU/WebGL. Canvas and SVG should consume the mark objects
 * directly; GPU renderers can upload this buffer without depending on the dynamic-brush UI model.
 */
export const STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1 = 16;

export const STUDIO_DRY_MEDIA_PACKED_MARK_OFFSETS_V1 = Object.freeze({
  x: 0,
  y: 1,
  halfLength: 2,
  halfThickness: 3,
  angleRadians: 4,
  alpha: 5,
  opacity: 6,
  flow: 7,
  hardness: 8,
  edgeRoughness: 9,
  grainFrequency: 10,
  grainPhase: 11,
  superellipseExponent: 12,
  shapeCode: 13,
  stationIndex: 14,
  laneIndex: 15,
});

const MARK_SHAPE_CODES: Readonly<
  Record<StudioDryMediaAnisotropicMarkShapeV1, number>
> = Object.freeze({
  "wax-ribbon": 0,
  "carbon-fiber": 1,
  "mineral-flake": 2,
  "soft-pigment-fiber": 3,
});

export type StudioDryMediaPackedMarksResultV1 =
  | Readonly<{
      readonly ok: true;
      readonly version: typeof STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1;
      readonly stride: typeof STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1;
      readonly markCount: number;
      readonly values: Float32Array;
    }>
  | Readonly<{
      readonly ok: false;
      readonly reason: "invalid-mark" | "buffer-budget";
    }>;

function markIsValid(mark: StudioDryMediaAnisotropicMarkV1): boolean {
  return typeof mark === "object"
    && mark !== null
    && mark.version === STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1
    && Object.hasOwn(MARK_SHAPE_CODES, mark.shape)
    && Number.isSafeInteger(mark.stationIndex)
    && mark.stationIndex >= 0
    && Number.isSafeInteger(mark.laneIndex)
    && mark.laneIndex >= 0
    && [
      mark.x,
      mark.y,
      mark.halfLength,
      mark.halfThickness,
      mark.angleRadians,
      mark.alpha,
      mark.opacity,
      mark.flow,
      mark.hardness,
      mark.edgeRoughness,
      mark.grainFrequency,
      mark.grainPhase,
      mark.superellipseExponent,
    ].every(Number.isFinite)
    && mark.halfLength > 0
    && mark.halfThickness > 0
    && mark.alpha >= 0
    && mark.alpha <= 1
    && mark.opacity >= 0
    && mark.opacity <= 1
    && mark.flow >= 0
    && mark.flow <= 1;
}

function markShapeCode(shape: StudioDryMediaAnisotropicMarkShapeV1): number {
  switch (shape) {
    case "wax-ribbon":
      return 0;
    case "carbon-fiber":
      return 1;
    case "mineral-flake":
      return 2;
    case "soft-pigment-fiber":
      return 3;
  }
}

export function packStudioDryMediaAnisotropicMarksV1(
  marks: readonly StudioDryMediaAnisotropicMarkV1[],
  maximumBytes = DEFAULT_STUDIO_DRY_MEDIA_PACKED_BYTE_BUDGET_V1,
): StudioDryMediaPackedMarksResultV1 {
  if (
    !Array.isArray(marks)
    || !Number.isSafeInteger(maximumBytes)
    || maximumBytes < STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.packedBytes.min
    || maximumBytes > STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_LIMITS_V1.packedBytes.max
  ) return Object.freeze({ ok: false, reason: "buffer-budget" });
  const floatCount = marks.length * STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1;
  const byteLength = floatCount * Float32Array.BYTES_PER_ELEMENT;
  if (
    !Number.isSafeInteger(floatCount)
    || byteLength > maximumBytes
  ) return Object.freeze({ ok: false, reason: "buffer-budget" });
  const values = new Float32Array(floatCount);
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]!;
    if (!markIsValid(mark)) {
      return Object.freeze({ ok: false, reason: "invalid-mark" });
    }
    const offset = index * STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1;
    values[offset] = mark.x;
    values[offset + 1] = mark.y;
    values[offset + 2] = mark.halfLength;
    values[offset + 3] = mark.halfThickness;
    values[offset + 4] = mark.angleRadians;
    values[offset + 5] = mark.alpha;
    values[offset + 6] = mark.opacity;
    values[offset + 7] = mark.flow;
    values[offset + 8] = mark.hardness;
    values[offset + 9] = mark.edgeRoughness;
    values[offset + 10] = mark.grainFrequency;
    values[offset + 11] = mark.grainPhase;
    values[offset + 12] = mark.superellipseExponent;
    values[offset + 13] = markShapeCode(mark.shape);
    values[offset + 14] = mark.stationIndex;
    values[offset + 15] = mark.laneIndex;
  }
  return Object.freeze({
    ok: true,
    version: STUDIO_DRY_MEDIA_ANISOTROPIC_GRAIN_VERSION_V1,
    stride: STUDIO_DRY_MEDIA_PACKED_MARK_FLOAT_STRIDE_V1,
    markCount: marks.length,
    values,
  });
}
