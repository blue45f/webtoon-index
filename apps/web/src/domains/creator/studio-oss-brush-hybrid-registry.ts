/**
 * Texture-first hybrid engine matching — one verified stack per brush kind.
 *
 * Product rules (hybrid-design.md §0 + §4 + quality policy):
 * - Pin the best texture engine per brush kind (not a failure ladder).
 * - No cross-engine product fallback; fail closed on pin unavailability.
 * - Optimize performance on the same pin; deliberate pin replace only after lab evidence.
 *
 * Closed sites (Expresii, Magma, Photopea, Krita Web UI) are behaviour references only.
 * Open engines/kernels (Hokusai, Klecks, libmypaint recipes, Krita math, dry anisotropic)
 * provide the actual product texture DNA.
 */

import {
  resolveStudioBrushEngineLaneBaseId,
  studioBrushEngineLaneRowById,
} from "./brush/studio-brush-engine-lane-catalog";
import {
  STUDIO_OSS_BRUSH_KERNELS_VERSION,
  STUDIO_OSS_BRUSH_PROVENANCE,
  type StudioOssBrushProvenanceId,
} from "./studio-oss-brush-kernels";

export const STUDIO_OSS_BRUSH_HYBRID_REGISTRY_VERSION =
  "studio-oss-brush-hybrid-registry-v3" as const;

/**
 * Texture kinds — finer than quality-policy families so oil ≠ gouache ≠ watercolor.
 * Maps onto product live/commit specialists already shipping in Studio.
 */
export type StudioBrushTextureKind =
  | "line-ink"
  | "line-gpen"
  | "calligraphy"
  | "marker"
  | "highlighter"
  | "fx-particle"
  | "paint-bristle"
  | "paint-oil"
  | "paint-acrylic"
  | "paint-gouache"
  | "wet-watercolor"
  | "wet-inkwash"
  | "spray-airbrush"
  | "spray-splatter"
  | "dry-graphite"
  | "dry-charcoal"
  | "dry-crayon"
  | "dry-chalk"
  | "dry-pastel"
  | "dry-oil-pastel"
  | "stamp-tone"
  | "eraser"
  | "dynamics-generic";

/** @deprecated Use StudioBrushTextureKind — kept for call-site compatibility. */
export type StudioOssBrushFamily =
  | "wet-watercolor"
  | "wet-oil"
  | "dry-scrape"
  | "spray-air"
  | "graphite";

export interface StudioBrushTextureEngineMatch {
  readonly kind: StudioBrushTextureKind;
  /** Human label for inspector / provenance UI. */
  readonly labelKo: string;
  /** Site or OSS source that defines the target feel. */
  readonly textureReference: string;
  /**
   * Primary pixel authority for live + commit (module / planner name).
   * Never swapped silently for another kind's engine.
   */
  readonly primaryEngine: string;
  /** Supporting modules that share the same pin (texture kernels, carriers). */
  readonly supportingEngines: readonly string[];
  /** Optional settled/experimental enhancer — never automatic product fallback. */
  readonly optionalEnhancer: string | null;
  /** quality-policy route profile id string for alignment. */
  readonly qualityRouteProfile: string;
  readonly ossKernelProvenance: readonly StudioOssBrushProvenanceId[];
  readonly notes: string;
}

function match(
  partial: StudioBrushTextureEngineMatch,
): StudioBrushTextureEngineMatch {
  return Object.freeze({
    ...partial,
    supportingEngines: Object.freeze([...partial.supportingEngines]),
    ossKernelProvenance: Object.freeze([...partial.ossKernelProvenance]),
  });
}

/**
 * Canonical texture-engine pins per kind.
 * Prefer the strongest verified texture stack; performance is optimized later on the same pin.
 */
export const STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES = Object.freeze({
  "line-ink": match({
    kind: "line-ink",
    labelKo: "선화·펜",
    textureReference: "CSP/AutoDraw clean ink · perfect-freehand geometry",
    primaryEngine: "canvas2d-causal-ink / webgpu-live-causal-ink",
    supportingEngines: [
      "studio-brush-alias-profile (pen family)",
      "perfect-freehand-outline (gpen/outline pair)",
    ],
    optionalEnhancer: null,
    qualityRouteProfile: "continuous-analytic",
    ossKernelProvenance: Object.freeze([]),
    notes: "Continuous coverage; no dry/wet texture kernels on the line pin.",
  }),
  "line-gpen": match({
    kind: "line-gpen",
    labelKo: "G펜·만화 선화",
    textureReference: "CSP G-pen pressure taper · perfect-freehand",
    primaryEngine: "perfect-freehand-outline + causal-ink commit",
    supportingEngines: [
      "studio-brush-alias-profile gpen pressure",
      "webgpu-live-causal-ink preview pair",
    ],
    optionalEnhancer: null,
    qualityRouteProfile: "continuous-outline",
    ossKernelProvenance: Object.freeze([]),
    notes: "Pressure-elastic outline; not Hokusai charcoal.",
  }),
  calligraphy: match({
    kind: "calligraphy",
    labelKo: "캘리·만년필·평행펜",
    textureReference: "libmypaint/Hokusai calligraphy elliptical dab + tilt",
    primaryEngine: "canvas2d-material-specialist (calligraphy dynamics)",
    supportingEngines: [
      "studio-hokusai-wasm calligraphy .myb (experimental opt-in)",
      "studio-brush-alias-profile calligraphy diameter/pressure",
    ],
    optionalEnhancer: "hokusai-myb-worker calligraphy carrier",
    qualityRouteProfile: "continuous-specialist",
    ossKernelProvenance: Object.freeze([]),
    notes: "Tilt/chisel ribbon; Hokusai only as explicit experimental conversion.",
  }),
  marker: match({
    kind: "marker",
    labelKo: "마커·펠트",
    textureReference: "Canva/Express marker · soft chisel continuous",
    primaryEngine: "canvas2d-causal-ink / continuous-analytic marker alias",
    supportingEngines: [
      "studio-brush-alias-profile marker family",
      "studio-hokusai-wasm marker .myb (experimental)",
    ],
    optionalEnhancer: "hokusai-myb-worker marker carrier",
    qualityRouteProfile: "continuous-analytic",
    ossKernelProvenance: Object.freeze([]),
    notes: "Semi-opaque continuous fill; not dry anisotropic grain.",
  }),
  highlighter: match({
    kind: "highlighter",
    labelKo: "형광펜",
    textureReference: "Consumer highlighter translucent chisel",
    primaryEngine: "canvas2d-material-specialist highlighter",
    supportingEngines: ["studio-brush-alias-profile highlighter pressure"],
    optionalEnhancer: null,
    qualityRouteProfile: "continuous-specialist",
    ossKernelProvenance: Object.freeze([]),
    notes: "High transparency continuous; separate from pastel dry media.",
  }),
  "fx-particle": match({
    kind: "fx-particle",
    labelKo: "글리터·글로우·파티클 FX",
    textureReference: "PicsArt FX particle / glow stamps",
    primaryEngine: "canvas2d-dynamic-coverage + fx particle planner",
    supportingEngines: [
      "studio-fx-brush glitter/glow plans",
      "canonical-webgpu-textured when admitted",
    ],
    optionalEnhancer: null,
    qualityRouteProfile: "spray-specialist",
    ossKernelProvenance: Object.freeze(["klecksScatter"] as StudioOssBrushProvenanceId[]),
    notes: "Seeded particles; equal-area scatter DNA for dust/splatter variants.",
  }),
  "paint-bristle": match({
    kind: "paint-bristle",
    labelKo: "일반 붓·평붓",
    textureReference: "Magma/Krita bristle stroke · painterly body",
    primaryEngine: "canvas2d-wet-ribbon / fiber-bristle when admitted",
    supportingEngines: [
      "studio-fx-brush painterly path",
      "studio-hokusai texture v2 painterly (oil carrier experimental)",
      "professional-bristle-webgpu / fiber-bristle-worker",
    ],
    optionalEnhancer: "hokusai-myb-worker oil carrier + painterly profile",
    qualityRouteProfile: "wet-specialist",
    ossKernelProvenance: Object.freeze([
      "libmypaintModelling",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Generic brush is bristle/painterly, not soft airbrush.",
  }),
  "paint-oil": match({
    kind: "paint-oil",
    labelKo: "유화",
    textureReference: "Magma oil blend + libmypaint modelling / Wet_Paint DNA",
    primaryEngine: "studio-fx-brush planOilBrushDabs + studio-oil-ribbon-carrier",
    supportingEngines: [
      "studio-oss-brush-kernels oil bristle film",
      "studio-hokusai-wasm oil .myb + texture v2 paint-film",
      "STUDIO_OSS_OIL_FILM_RECIPE",
      "studio-spectral-pigment-mix-approx (public KM; Mixbox NC blocked)",
      "studio-oil-wet-into-wet applyStudioOilWetIntoWetStroke",
    ],
    optionalEnhancer: "hokusai-myb-worker oil (experimental opt-in)",
    qualityRouteProfile: "wet-specialist",
    ossKernelProvenance: Object.freeze([
      "libmypaintModelling",
      "libmypaintWetPaint",
    ] as StudioOssBrushProvenanceId[]),
    notes:
      "Multi-lane bristle body. Smudge off on transparent canvas. paint-film colour (no white glitter).",
  }),
  "paint-acrylic": match({
    kind: "paint-acrylic",
    labelKo: "아크릴",
    textureReference: "Digital acrylic flat polymer body (Hokusai acrylic texture)",
    primaryEngine: "canvas2d-wet-ribbon acrylic specialist",
    supportingEngines: [
      "studio-hokusai texture v2 acrylic (oil carrier)",
      "compactPaintBodyFields polymer tooth",
    ],
    optionalEnhancer: "hokusai-myb-worker oil carrier + acrylic profile",
    qualityRouteProfile: "wet-specialist",
    ossKernelProvenance: Object.freeze([
      "libmypaintModelling",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Harder polymer body than oil; less impasto lift.",
  }),
  "paint-gouache": match({
    kind: "paint-gouache",
    labelKo: "과슈",
    textureReference: "Matte gouache coverage (Hokusai gouache texture)",
    primaryEngine: "canvas2d-material-specialist gouache / wet-specialist",
    supportingEngines: [
      "studio-hokusai texture v2 gouache",
      "studio-brush-alias-profile gouache watercolor material scales",
    ],
    optionalEnhancer: "hokusai-myb-worker oil carrier + gouache profile",
    qualityRouteProfile: "wet-specialist",
    ossKernelProvenance: Object.freeze([]),
    notes: "Matte opaque body — not oil bristle ribbon and not wet bleed wash.",
  }),
  "wet-watercolor": match({
    kind: "wet-watercolor",
    labelKo: "수채",
    textureReference:
      "Expresii CFD (closed) + Inkwash UX concepts + Pavel MIT fluid transport → Living Ink",
    primaryEngine: "studio-wet-ink-brush-runtime + causal watercolor dabs",
    supportingEngines: [
      "studio-brush-alias-profile watercolor core/diffuse",
      "studio-oss-brush-kernels watercolor tip (wet-edge + granulation)",
      "studio-living-ink-field (physical opt-in; may be product-gated)",
      "studio-hand-feel-media-load-v1 speed/pressure film",
      "studio-webgl-stable-fluid-core (MIT Stam/Pavel advection kernel, evaluation)",
      "canvas2d-stamp watercolor tip when stamp path admitted",
    ],
    optionalEnhancer: "studio-living-ink physical settle",
    qualityRouteProfile: "wet-field",
    ossKernelProvenance: Object.freeze([
      "klecksChalkAlpha",
    ] as StudioOssBrushProvenanceId[]),
    notes:
      "Primary pin Living Ink/wet-ink. Pavel fluid = supporting transport math (MIT). "
      + "Inkwash = concept only (no LICENSE). Not an airbrush pin.",
  }),
  "wet-inkwash": match({
    kind: "wet-inkwash",
    labelKo: "수묵·잉크워시",
    textureReference:
      "Inkwash pen/water dual tool (concept) + sumi dense core/bleed + Pavel vorticity",
    primaryEngine: "studio-wet-ink-brush-runtime ink-wash recipe",
    supportingEngines: [
      "studio-brush-alias-profile ink-wash material (compact core, wide diffuse)",
      "studio-living-ink field when admitted",
      "studio-living-ink-field advanceStudioInkWashField",
      "studio-hand-feel-media-load-v1 speed/pressure film",
      "studio-webgl-stable-fluid-core wet-mask velocity confinement",
    ],
    optionalEnhancer: "studio-living-ink physical settle",
    qualityRouteProfile: "wet-field",
    ossKernelProvenance: Object.freeze([
      "klecksChalkAlpha",
    ] as StudioOssBrushProvenanceId[]),
    notes:
      "Denser stations/darker core than soft watercolor. Inkwash HTML not vendored.",
  }),
  "spray-airbrush": match({
    kind: "spray-airbrush",
    labelKo: "에어브러시·소프트 미스트",
    textureReference: "Kleki / Klecks soft airbrush + Krita spray √U",
    primaryEngine: "studio-brush-dynamics airbrush + soft-falloff stamp",
    supportingEngines: [
      "studio-brush-stamp-engine airbrush OSS grit tip",
      "studio-oss-brush-kernels spray tip + equal-area disk",
      "studio-brush-soft-falloff-stamp analytic mask",
    ],
    optionalEnhancer: null,
    qualityRouteProfile: "spray-dynamics",
    ossKernelProvenance: Object.freeze([
      "klecksScatter",
      "kritaPolarDistance",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Soft envelope + multi-octave grit; dynamics use √U scatter.",
  }),
  "spray-splatter": match({
    kind: "spray-splatter",
    labelKo: "스프레이·스플래터",
    textureReference: "Klecks pen scatter + Krita spray particle distributions",
    primaryEngine: "studio-brush-dynamics spray/splatter + particle coverage",
    supportingEngines: [
      "studioOssEqualAreaDiskOffset",
      "physics-particle-worker when admitted",
    ],
    optionalEnhancer: null,
    qualityRouteProfile: "spray-dynamics",
    ossKernelProvenance: Object.freeze([
      "klecksScatter",
      "kritaPolarDistance",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Wide scatter cloud — not continuous oil ribbon.",
  }),
  "dry-graphite": match({
    kind: "dry-graphite",
    labelKo: "연필·흑연",
    textureReference: "Magma/CSP pencil + Hokusai pencil texture v2 fibre/paper",
    primaryEngine: "canvas2d-material-specialist pencil + Hokusai pencil texture v2",
    supportingEngines: [
      "studio-hokusai-wasm pencil .myb (experimental)",
      "studio-brush-stamp-engine pencil grain",
      "studio-brush-alias-profile pencil passes (soft multi-pass)",
    ],
    optionalEnhancer: "hokusai-myb-worker pencil",
    qualityRouteProfile: "dry-specialist",
    ossKernelProvenance: Object.freeze([
      "libmypaintCharcoal",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Graphite fibre + paper tooth; continuous centreline required.",
  }),
  "dry-charcoal": match({
    kind: "dry-charcoal",
    labelKo: "목탄",
    textureReference: "libmypaint charcoal.myb + dry anisotropic carbon fiber",
    primaryEngine: "studio-dry-media-anisotropic-grain-v1 charcoal",
    supportingEngines: [
      "studio-brush-dynamics dry-media",
      "studio-hokusai charcoal carrier + charcoal texture v2",
      "STUDIO_OSS_DRY_CARRIER_RECIPE",
    ],
    optionalEnhancer: "hokusai-myb-worker charcoal",
    qualityRouteProfile: "dry-dynamics",
    ossKernelProvenance: Object.freeze([
      "libmypaintCharcoal",
      "klecksScatter",
    ] as StudioOssBrushProvenanceId[]),
    notes: "High offset_by_random DNA; powder edge without beading.",
  }),
  "dry-crayon": match({
    kind: "dry-crayon",
    labelKo: "크레용·왁스",
    textureReference: "Krita/Photopea wax scrape · directional fibre",
    primaryEngine: "studio-dry-media-anisotropic-grain-v1 crayon (wax-ribbon)",
    supportingEngines: [
      "studio-oss-brush-kernels directional wax scrape",
      "studio-hokusai charcoal carrier + crayon texture v2",
    ],
    optionalEnhancer: "hokusai-myb-worker charcoal + crayon profile",
    qualityRouteProfile: "dry-dynamics",
    ossKernelProvenance: Object.freeze([
      "libmypaintCharcoal",
      "klecksScatter",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Stroke-aligned wax scrape — not isotropic noise tiles.",
  }),
  "dry-chalk": match({
    kind: "dry-chalk",
    labelKo: "초크",
    textureReference: "Klecks chalk multi-octave alpha (genBrushAlpha01)",
    primaryEngine: "studio-dry-media-anisotropic-grain-v1 chalk (mineral-flake)",
    supportingEngines: [
      "studio-oss-brush-kernels Klecks chalk coverage",
      "studio-hokusai charcoal carrier + chalk texture v2",
    ],
    optionalEnhancer: "hokusai-myb-worker charcoal + chalk profile",
    qualityRouteProfile: "dry-dynamics",
    ossKernelProvenance: Object.freeze([
      "klecksChalkAlpha",
      "klecksChalkRotate",
      "libmypaintCharcoal",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Mineral multi-octave powder; position-based grain rotation DNA.",
  }),
  "dry-pastel": match({
    kind: "dry-pastel",
    labelKo: "파스텔",
    textureReference: "Krita soft pastel cake · soft-pigment-fiber",
    primaryEngine: "studio-dry-media-anisotropic-grain-v1 pastel + fx pastel fibres",
    supportingEngines: [
      "studio-fx-brush pastel dabs",
      "studio-hokusai charcoal carrier + pastel texture v2",
    ],
    optionalEnhancer: "hokusai-myb-worker charcoal + pastel profile",
    qualityRouteProfile: "dry-dynamics",
    ossKernelProvenance: Object.freeze([
      "libmypaintCharcoal",
      "klecksChalkAlpha",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Soft cake build; broader powder than crayon scrape.",
  }),
  "dry-oil-pastel": match({
    kind: "dry-oil-pastel",
    labelKo: "오일 파스텔",
    textureReference: "Krita oil pastel · wax + soft oil film hybrid",
    primaryEngine: "studio-dry-media-anisotropic + Hokusai oil-pastel texture",
    supportingEngines: [
      "studio-oss oilPastelTexture (oil film + wax tooth)",
      "charcoal carrier experimental",
    ],
    optionalEnhancer: "hokusai-myb-worker charcoal + oil-pastel profile",
    qualityRouteProfile: "dry-dynamics",
    ossKernelProvenance: Object.freeze([
      "libmypaintModelling",
      "libmypaintCharcoal",
    ] as StudioOssBrushProvenanceId[]),
    notes: "Between crayon wax and oil film — paint-film colour mode.",
  }),
  "stamp-tone": match({
    kind: "stamp-tone",
    labelKo: "스크린톤·해칭 스탬프",
    textureReference: "Document-aligned tone stamps",
    primaryEngine: "canvas2d-stamp-pattern document-aligned",
    supportingEngines: ["studio-brush-textured-stamp", "pattern seed receipts"],
    optionalEnhancer: null,
    qualityRouteProfile: "stamp-specialist",
    ossKernelProvenance: Object.freeze([]),
    notes: "Discrete pattern stamps; not continuous wet/dry pigment.",
  }),
  eraser: match({
    kind: "eraser",
    labelKo: "지우개",
    textureReference: "Destination-out continuous / kneaded soft",
    primaryEngine: "canvas2d-causal-ink destination-out",
    supportingEngines: ["webgpu-live-causal-ink erase pair"],
    optionalEnhancer: null,
    qualityRouteProfile: "continuous-analytic",
    ossKernelProvenance: Object.freeze([]),
    notes: "Erase pin — never texture media fallback.",
  }),
  "dynamics-generic": match({
    kind: "dynamics-generic",
    labelKo: "카탈로그 다이나믹스 일반",
    textureReference: "Catalog dynamics coverage v3",
    primaryEngine: "canvas2d-dynamic-coverage",
    supportingEngines: ["canonical-webgpu-textured when admitted"],
    optionalEnhancer: null,
    qualityRouteProfile: "continuous-catalog-dynamics",
    ossKernelProvenance: Object.freeze([]),
    notes: "Pack/web catalog defaults until a kind-specific pin is assigned.",
  }),
} as const satisfies Record<StudioBrushTextureKind, StudioBrushTextureEngineMatch>);

/** Explicit core preset → texture kind (complete for BRUSH_PRESETS). */
const CORE_BRUSH_TEXTURE_KIND: Readonly<Record<string, StudioBrushTextureKind>> =
  Object.freeze({
    pen: "line-ink",
    fineliner: "line-ink",
    ballpoint: "line-ink",
    "gel-pen": "line-ink",
    "glass-pen": "line-ink",
    "ruling-pen": "line-ink",
    "technical-pen": "line-ink",
    gpen: "line-gpen",
    "school-pen": "line-gpen",
    "maru-pen": "line-gpen",
    "mapping-pen": "line-gpen",
    kaburapen: "line-gpen",
    liner: "line-gpen",
    "ink-brush": "line-ink",
    calligraphy: "calligraphy",
    "fountain-pen": "calligraphy",
    "parallel-pen": "calligraphy",
    "brush-pen": "calligraphy",
    "perfect-ink": "line-gpen",
    "perfect-marker": "marker",
    "standard-eraser": "eraser",
    "kneaded-eraser": "eraser",
    marker: "marker",
    "felt-tip": "marker",
    "marker-bold": "marker",
    "alcohol-marker": "marker",
    highlighter: "highlighter",
    "chisel-highlighter": "highlighter",
    "pastel-highlighter": "highlighter",
    neon: "fx-particle",
    glow: "fx-particle",
    "soft-glow": "fx-particle",
    glitter: "fx-particle",
    "star-dust": "fx-particle",
    "sparkle-star": "fx-particle",
    brush: "paint-bristle",
    "flat-brush": "paint-bristle",
    watercolor: "wet-watercolor",
    "ink-wash": "wet-inkwash",
    "inkwash-pen": "wet-inkwash",
    "inkwash-water-brush": "wet-watercolor",
    "inkwash-bleed-wash": "wet-inkwash",
    "inkwash-white-ink": "wet-inkwash",
    gouache: "paint-gouache",
    oil: "paint-oil",
    acrylic: "paint-acrylic",
    "paint-tube": "paint-oil",
    airbrush: "spray-airbrush",
    "hard-airbrush": "spray-airbrush",
    "airbrush-fine": "spray-airbrush",
    "wash-brush": "wet-watercolor",
    "soft-brush": "spray-airbrush",
    spray: "spray-splatter",
    splatter: "spray-splatter",
    pencil: "dry-graphite",
    "erodible-pencil": "dry-graphite",
    "pencil-2b": "dry-graphite",
    "pencil-6b": "dry-graphite",
    "soft-pencil": "dry-graphite",
    "pencil-grain": "dry-graphite",
    "colored-pencil": "dry-graphite",
    "dry-media": "dry-charcoal",
    crayon: "dry-crayon",
    chalk: "dry-chalk",
    charcoal: "dry-charcoal",
    pastel: "dry-pastel",
    "oil-pastel": "dry-oil-pastel",
    "ink-particle": "fx-particle",
    "tangent-normal-brush": "dynamics-generic",
    // 2026-08-13 wave 3: CC0 MyPaint harvest lanes pin their upstream medium identity.
    "mypaint-cc0--charcoal": "dry-charcoal",
    "mypaint-cc0--charcoal-tanda": "dry-charcoal",
    "mypaint-cc0--2b-pencil": "dry-graphite",
    "mypaint-cc0--dry-brush": "paint-bristle",
    "mypaint-cc0--splatter": "spray-splatter",
    "mypaint-cc0--ink-blot": "line-ink",
    "mypaint-cc0--kabura": "line-gpen",
    "mypaint-cc0--calligraphy": "calligraphy",
    "mypaint-cc0--marker-fat": "marker",
    "mypaint-cc0--marker-small": "marker",
    "mypaint-cc0--slow-ink": "line-ink",
    "mypaint-cc0--knife": "paint-oil",
    "mypaint-cc0--watercolor-fringe": "wet-watercolor",
    "mypaint-cc0--watercolor-expressive": "wet-watercolor",
    "mypaint-cc0--oil-paint": "paint-oil",
    "mypaint-cc0--pastel": "dry-pastel",
    "mypaint-cc0--spray": "spray-airbrush",
    screentone: "stamp-tone",
    crosshatch: "stamp-tone",
    // Sketchpad / web specialty pack — pin by texture role, not generic default.
    "sketchpad-tile": "stamp-tone",
    "sketchpad-mirror": "line-ink",
    "sketchpad-soft-marker": "marker",
    "web-multi-agent": "fx-particle",
    "web-rough-ink": "line-ink",
    "web-gravity-drip": "fx-particle",
    "web-soft-cloud": "spray-airbrush",
    "web-calligraphy-ribbon": "calligraphy",
    "web-dash-stitch": "stamp-tone",
    "web-scatter-stamp": "spray-splatter",
    "web-rainbow-flow": "fx-particle",
    "web-lazy-ink": "line-ink",
    "web-hatch-color": "stamp-tone",
    "web-cel-flat": "marker",
    "web-blend-softener": "spray-airbrush",
    "web-dot-tone": "stamp-tone",
    "web-kaleido-ink": "fx-particle",
    "web-fur-strand": "paint-bristle",
    "web-contour-double": "line-ink",
    "web-radial-burst": "fx-particle",
    "web-mirror-ink": "line-ink",
    "web-grid-ink": "stamp-tone",
    "web-spiro-orbit": "fx-particle",
    "web-zigzag-edge": "line-ink",
    "web-neon-tube": "fx-particle",
    "web-pressure-flat": "marker",
    // 강모 경로가 없는 소프트 블렌드 — web-blend-softener 와 같은 핀.
    "web-smudge-trail": "spray-airbrush",
    "web-cross-hatch-pen": "stamp-tone",
  });

/**
 * True when the id carries an explicit per-id texture-kind pin. Collection-base lanes (e.g. the
 * heterogeneous-media mypaint-cc0 harvest) pin per id, deliberately diverging from their base id.
 */
export function hasStudioBrushTextureKindExactPin(
  brushId: string | null | undefined,
): boolean {
  if (!brushId) return false;
  return CORE_BRUSH_TEXTURE_KIND[brushId.trim().toLowerCase()] !== undefined;
}

/**
 * Resolve texture kind for any brush id (core + pack aliases).
 * Heuristics only apply when the id is not in the explicit core table.
 */
export function resolveStudioBrushTextureKind(
  brushId: string | null | undefined,
): StudioBrushTextureKind {
  if (!brushId) return "dynamics-generic";
  const id = brushId.trim().toLowerCase();
  const exact = CORE_BRUSH_TEXTURE_KIND[id];
  if (exact) return exact;

  const laneBase = resolveStudioBrushEngineLaneBaseId(id);
  if (laneBase) {
    const baseExact = CORE_BRUSH_TEXTURE_KIND[laneBase];
    if (baseExact) return baseExact;
    return resolveStudioBrushTextureKind(laneBase);
  }

  if (/(?:eraser|kneaded)/u.test(id)) return "eraser";
  if (/(?:screentone|crosshatch|hatch-tone)/u.test(id)) return "stamp-tone";
  if (/(?:glitter|glow|sparkle|star-dust|neon|particle)/u.test(id)) {
    return "fx-particle";
  }
  if (/(?:splatter|scatter|spray-can|web-soft-cloud)/u.test(id)) {
    return "spray-splatter";
  }
  if (/(?:airbrush|soft-brush|mist-soft|grand-soft)/u.test(id)) {
    return "spray-airbrush";
  }
  if (/(?:inkwash|ink-wash|sumi)/u.test(id)) return "wet-inkwash";
  if (/(?:watercolor|wet-wash|flat-wash|bleed-wash|wash-brush)/u.test(id)) {
    return "wet-watercolor";
  }
  if (/(?:oil-pastel)/u.test(id)) return "dry-oil-pastel";
  if (/(?:oil|impasto|filbert|paint-tube)/u.test(id)) return "paint-oil";
  if (/(?:acrylic)/u.test(id)) return "paint-acrylic";
  if (/(?:gouache)/u.test(id)) return "paint-gouache";
  if (/(?:crayon|wax)/u.test(id)) return "dry-crayon";
  if (/(?:chalk)/u.test(id)) return "dry-chalk";
  if (/(?:charcoal|dry-media)/u.test(id)) return "dry-charcoal";
  if (/(?:pastel)/u.test(id) && !/(?:highlighter)/u.test(id)) return "dry-pastel";
  if (/(?:pencil|graphite)/u.test(id)) return "dry-graphite";
  if (/(?:calligraphy|fountain|parallel|brush-pen)/u.test(id)) {
    return "calligraphy";
  }
  if (/(?:highlighter)/u.test(id)) return "highlighter";
  if (/(?:marker|felt-tip)/u.test(id)) return "marker";
  if (/(?:gpen|maru|mapping|kabura|liner|school-pen)/u.test(id)) {
    return "line-gpen";
  }
  if (/(?:bristle|filbert|flat-brush|^brush$)/u.test(id)) return "paint-bristle";
  if (/(?:pen|ink)/u.test(id)) return "line-ink";
  return "dynamics-generic";
}

export function resolveStudioBrushTextureEngineMatch(
  brushId: string | null | undefined,
): StudioBrushTextureEngineMatch {
  const kind = resolveStudioBrushTextureKind(brushId);
  return STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES[kind];
}

/** Map fine texture kinds onto the legacy 5-family hybrid buckets. */
export function studioBrushTextureKindToLegacyFamily(
  kind: StudioBrushTextureKind,
): StudioOssBrushFamily | null {
  switch (kind) {
    case "wet-watercolor":
    case "wet-inkwash":
      return "wet-watercolor";
    case "paint-oil":
    case "paint-acrylic":
    case "paint-gouache":
    case "paint-bristle":
      return "wet-oil";
    case "dry-charcoal":
    case "dry-crayon":
    case "dry-chalk":
    case "dry-pastel":
    case "dry-oil-pastel":
      return "dry-scrape";
    case "spray-airbrush":
    case "spray-splatter":
    case "fx-particle":
      return "spray-air";
    case "dry-graphite":
      return "graphite";
    default:
      return null;
  }
}

/** @deprecated Prefer resolveStudioBrushTextureKind / resolveStudioBrushTextureEngineMatch */
export function resolveStudioOssBrushHybridFamily(
  brushId: string | null | undefined,
): StudioOssBrushFamily | null {
  return studioBrushTextureKindToLegacyFamily(
    resolveStudioBrushTextureKind(brushId),
  );
}

/** Legacy 5-route view for older call sites. */
export const STUDIO_OSS_BRUSH_HYBRID_ROUTES = Object.freeze({
  "wet-watercolor": STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["wet-watercolor"],
  "wet-oil": STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["paint-oil"],
  "dry-scrape": STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["dry-crayon"],
  "spray-air": STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["spray-airbrush"],
  graphite: STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES["dry-graphite"],
} as const);

export type StudioOssBrushHybridRoute = StudioBrushTextureEngineMatch;

export function describeStudioOssBrushHybridStack(
  brushId: string | null | undefined,
): Readonly<{
  version: typeof STUDIO_OSS_BRUSH_HYBRID_REGISTRY_VERSION;
  kernelsVersion: typeof STUDIO_OSS_BRUSH_KERNELS_VERSION;
  family: StudioOssBrushFamily | null;
  kind: StudioBrushTextureKind;
  route: StudioBrushTextureEngineMatch;
  match: StudioBrushTextureEngineMatch;
  provenanceNotes: readonly string[];
  crossEngineProductFallbackAllowed: false;
  textureFirst: true;
  /** Present when brush id is an engine-lane shelf variant (`oil--filbert-ribbon`). */
  engineLane: Readonly<{
    id: string;
    lane: string;
    baseId: string;
    runtimeEngine: string;
    runtimeVariant: string;
  }> | null;
}> {
  const kind = resolveStudioBrushTextureKind(brushId);
  const matchResult = STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES[kind];
  const family = studioBrushTextureKindToLegacyFamily(kind);
  const laneRow = studioBrushEngineLaneRowById(
    typeof brushId === "string" ? brushId : null,
  );
  return Object.freeze({
    version: STUDIO_OSS_BRUSH_HYBRID_REGISTRY_VERSION,
    kernelsVersion: STUDIO_OSS_BRUSH_KERNELS_VERSION,
    family,
    kind,
    route: matchResult,
    match: matchResult,
    provenanceNotes: Object.freeze(
      matchResult.ossKernelProvenance.map(
        (id) => STUDIO_OSS_BRUSH_PROVENANCE[id],
      ),
    ),
    crossEngineProductFallbackAllowed: false,
    textureFirst: true,
    engineLane: laneRow
      ? Object.freeze({
          id: laneRow.id,
          lane: laneRow.lane,
          baseId: laneRow.baseId,
          runtimeEngine: laneRow.engine,
          runtimeVariant: laneRow.engineVariant,
        })
      : null,
  });
}

/** All texture kinds that own a distinct verified engine pin. */
export function listStudioBrushTextureEngineMatches(): readonly StudioBrushTextureEngineMatch[] {
  return Object.freeze(
    (Object.keys(STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES) as StudioBrushTextureKind[])
      .map((kind) => STUDIO_BRUSH_TEXTURE_ENGINE_MATCHES[kind]),
  );
}
