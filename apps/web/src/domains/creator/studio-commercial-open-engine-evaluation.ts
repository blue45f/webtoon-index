/**
 * Commercial-grade / formerly commercial engines with **open source available**.
 *
 * Policy:
 * - Analyze and integrate only under a clear open license (MIT/ISC/Apache/BSD/GPL with care).
 * - Non-commercial (CC BY-NC) or missing license → catalog + block, do not ship.
 * - Closed paid engines (CSP, Rebelle, Magma, Expresii, Procreate…) stay behaviour references only.
 * - Texture-first pin; no silent cross-engine fallback.
 */

export const STUDIO_COMMERCIAL_OPEN_ENGINE_EVAL_VERSION =
  "studio-commercial-open-engine-eval-v1" as const;

export type StudioOpenEngineLicenseClass =
  | "permissive-ship" // MIT/ISC/Apache/BSD — can vendor/adapt into product
  | "copyleft-isolate" // GPL — study / optional separate process, not silent link into core
  | "non-commercial-block" // CC BY-NC — needs paid commercial license before product use
  | "no-license-block" // no LICENSE file
  | "closed-reference-only"; // paid/closed — demos only

export type StudioOpenEngineProductRole =
  | "primary-pin-candidate"
  | "supporting-kernel"
  | "parity-lab-benchmark"
  | "concept-inspiration"
  | "blocked-do-not-ship"
  | "closed-behaviour-reference";

export interface StudioCommercialOpenEngineEntry {
  readonly id: string;
  readonly name: string;
  readonly commercialContext: string;
  readonly sourceUrl: string;
  readonly license: string;
  readonly licenseClass: StudioOpenEngineLicenseClass;
  readonly mayShipInProduct: boolean;
  readonly productRole: StudioOpenEngineProductRole;
  readonly textureKinds: readonly string[];
  readonly mapsToStudio: readonly string[];
  readonly recommendation: string;
}

/**
 * Engines that are (or were) commercial products / ship in commercial apps,
 * or are the industry open engines commercial tools re-use, with public source.
 */
export const STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG = Object.freeze([
  Object.freeze({
    id: "libmypaint",
    name: "libmypaint / MyPaint brush engine",
    commercialContext:
      "Used inside Krita (commercial-grade free app) and many FOSS painters; de-facto .myb standard",
    sourceUrl: "https://github.com/mypaint/libmypaint",
    license: "ISC",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "parity-lab-benchmark" as const,
    textureKinds: Object.freeze([
      "paint-oil",
      "paint-acrylic",
      "dry-charcoal",
      "dry-graphite",
      "calligraphy",
    ]),
    mapsToStudio: Object.freeze([
      "studio-hokusai-wasm .myb carriers",
      "studio-hokusai-natural-media-presets (modelling/charcoal DNA)",
      "packages/studio-brush-platform libmypaint lane",
    ]),
    recommendation:
      "Benchmark + .myb recipe DNA. Not automatic product fallback when Hokusai is down (fail-closed).",
  }),
  Object.freeze({
    id: "krita-paintops",
    name: "Krita brush engines (colorsmudge, spray, hairy, mypaint)",
    commercialContext:
      "Professional free digital painting suite; engines rival paid apps for dry/wet/smudge",
    sourceUrl: "https://invent.kde.org/graphics/krita (plugins/paintops)",
    license: "GPL-2.0-or-later",
    licenseClass: "copyleft-isolate" as const,
    mayShipInProduct: false,
    productRole: "concept-inspiration" as const,
    textureKinds: Object.freeze([
      "paint-oil",
      "spray-airbrush",
      "spray-splatter",
      "dry-crayon",
      "paint-bristle",
    ]),
    mapsToStudio: Object.freeze([
      "studio-oss-brush-kernels (√U spray, chalk)",
      "studio-dry-media-anisotropic-grain-v1",
      "colorsmudge concepts for future smudge-on-underpaint only",
    ]),
    recommendation:
      "Do not statically link GPL paintops into proprietary product binary without legal review. "
      + "Reimplement math (√U scatter, smudge modes) clean-room under product license.",
  }),
  Object.freeze({
    id: "pavel-webgl-fluid",
    name: "WebGL Fluid Simulation (PavelDoGreat)",
    commercialContext:
      "Industry-standard web fluid demo; algorithms used widely in commercial interactive art",
    sourceUrl: "https://github.com/PavelDoGreat/WebGL-Fluid-Simulation",
    license: "MIT",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "supporting-kernel" as const,
    textureKinds: Object.freeze(["wet-watercolor", "wet-inkwash", "spray-splatter"]),
    mapsToStudio: Object.freeze([
      "studio-webgl-stable-fluid-core",
      "Living Ink advection/vorticity future GPU port",
    ]),
    recommendation:
      "Supporting wet transport kernel under MIT notice. Not entertainment bloom UI.",
  }),
  Object.freeze({
    id: "google-liquidfun-paint",
    name: "LiquidFun Paint (Google)",
    commercialContext:
      "Shipped on Google Play as a commercial-style creative demo app; powered by open LiquidFun",
    sourceUrl: "https://github.com/google/liquidfunpaint",
    license: "Apache-2.0",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "concept-inspiration" as const,
    textureKinds: Object.freeze(["spray-splatter", "wet-watercolor", "fx-particle"]),
    mapsToStudio: Object.freeze([
      "physics-particle-worker (when admitted)",
      "liquid vs sticky vs dry tool split → pen/water/fix UX",
    ]),
    recommendation:
      "Tool taxonomy (liquid / sticky / dry) inspires product modes. Full Android app not embedded; "
      + "particle fluid is optional spray/wet enhancer, not oil pin.",
  }),
  Object.freeze({
    id: "google-liquidfun",
    name: "LiquidFun particle fluids (Box2D extension)",
    commercialContext: "Google open physics used in commercial mobile titles and LiquidFun Paint",
    sourceUrl: "https://github.com/google/liquidfun",
    license: "zlib (Box2D lineage) / project terms — treat as permissive FOSS",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "supporting-kernel" as const,
    textureKinds: Object.freeze(["spray-splatter", "fx-particle"]),
    mapsToStudio: Object.freeze([
      "physics-particle-worker",
      "splatter / gravity drip specialty brushes",
    ]),
    recommendation:
      "Particle fluid for splatter/drip specialty only. Heavy for every watercolor stroke.",
  }),
  Object.freeze({
    id: "mixbox",
    name: "Mixbox pigment mixing (Secret Weapons)",
    commercialContext:
      "Ships in Rebelle 5 Pro pigments and Flip Fluids (Blender) — commercial pigment stack",
    sourceUrl: "https://github.com/scrtwpns/mixbox",
    license: "CC BY-NC 4.0 (commercial license sold separately)",
    licenseClass: "non-commercial-block" as const,
    mayShipInProduct: false,
    productRole: "blocked-do-not-ship" as const,
    textureKinds: Object.freeze(["paint-oil", "paint-acrylic", "paint-gouache"]),
    mapsToStudio: Object.freeze([
      "Would map to oil smudge / spectral mix — blocked until commercial Mixbox license",
      "studio-spectral-pigment-mix-approx (public KM theory, not Mixbox code)",
    ]),
    recommendation:
      "Do not vendor mixbox.js into production ToonSpectrum without commercial license. "
      + "Use public-domain Kubelka–Munk approximation or Hokusai paint_mode until licensed.",
  }),
  Object.freeze({
    id: "open-brush-tilt-brush",
    name: "Open Brush (ex Tilt Brush, Google commercial VR paint)",
    commercialContext:
      "Tilt Brush was a paid Google VR product; open-sourced, community fork Open Brush",
    sourceUrl: "https://github.com/icosa-foundation/open-brush",
    license: "Apache-2.0",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "concept-inspiration" as const,
    textureKinds: Object.freeze(["paint-bristle", "fx-particle", "line-ink"]),
    mapsToStudio: Object.freeze([
      "stroke ribbon geometry ideas",
      "not primary 2D natural-media pin",
    ]),
    recommendation:
      "Apache OK to study stroke/brush tip geometry. VR-focused; not drop-in for 2D Studio canvas.",
  }),
  Object.freeze({
    id: "klecks-kleki",
    name: "Klecks (open source of Kleki web painter)",
    commercialContext:
      "Kleki is a widely used free web painter with commercial-adjacent UX; Klecks is OSS",
    sourceUrl: "https://github.com/bitbof/klecks",
    license: "MIT",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "supporting-kernel" as const,
    textureKinds: Object.freeze([
      "spray-airbrush",
      "dry-chalk",
      "line-ink",
      "paint-bristle",
    ]),
    mapsToStudio: Object.freeze([
      "studio-oss-brush-kernels (scatter, chalk alpha)",
      "studio-brush-stamp-engine spray tip",
    ]),
    recommendation: "Already integrated as MIT kernel DNA for spray/chalk.",
  }),
  Object.freeze({
    id: "hokusai-wasm",
    name: "Hokusai (libmypaint-class natural media WASM)",
    commercialContext:
      "Commercial product target quality for .myb natural media on the web",
    sourceUrl: "packages/studio-hokusai-wasm (MIT OR Apache-2.0 crates)",
    license: "MIT OR Apache-2.0",
    licenseClass: "permissive-ship" as const,
    mayShipInProduct: true,
    productRole: "primary-pin-candidate" as const,
    textureKinds: Object.freeze([
      "paint-oil",
      "dry-graphite",
      "dry-charcoal",
      "calligraphy",
    ]),
    mapsToStudio: Object.freeze([
      "hokusai-myb-worker",
      "texture v2 material profiles",
    ]),
    recommendation:
      "Primary natural-media pin candidate after quality gates; experimental opt-in until promoted.",
  }),
  Object.freeze({
    id: "inkwash",
    name: "Inkwash living-water ink demo",
    commercialContext: "Commercial-quality wet ink UX demo (not a sold engine)",
    sourceUrl: "https://github.com/johnowhitaker/inkwash",
    license: "none-found",
    licenseClass: "no-license-block" as const,
    mayShipInProduct: false,
    productRole: "blocked-do-not-ship" as const,
    textureKinds: Object.freeze(["wet-inkwash", "wet-watercolor"]),
    mapsToStudio: Object.freeze([
      "Living Ink field vocabulary (concept)",
      "pen vs water dual tool (concept)",
    ]),
    recommendation: "Analyze freely; do not copy sources until a license is published.",
  }),
  Object.freeze({
    id: "clip-studio-paint",
    name: "Clip Studio Paint",
    commercialContext: "Paid industry standard for comics/illustration",
    sourceUrl: "(closed)",
    license: "proprietary",
    licenseClass: "closed-reference-only" as const,
    mayShipInProduct: false,
    productRole: "closed-behaviour-reference" as const,
    textureKinds: Object.freeze(["line-gpen", "dry-graphite", "paint-oil"]),
    mapsToStudio: Object.freeze(["blind-test quality bar only"]),
    recommendation: "No source analysis of binaries. Behaviour/blind-test target only.",
  }),
  Object.freeze({
    id: "rebelle",
    name: "Rebelle (Escape Motions)",
    commercialContext: "Paid natural-media leader; uses Mixbox pigments commercially",
    sourceUrl: "(closed; Mixbox is the open-adjacent pigment stack)",
    license: "proprietary",
    licenseClass: "closed-reference-only" as const,
    mayShipInProduct: false,
    productRole: "closed-behaviour-reference" as const,
    textureKinds: Object.freeze(["wet-watercolor", "paint-oil"]),
    mapsToStudio: Object.freeze(["wet-field quality bar", "Mixbox commercial path if licensed"]),
    recommendation: "Do not reverse engineer. License Mixbox if pigment mix must match Rebelle.",
  }),
] as const satisfies readonly StudioCommercialOpenEngineEntry[]);

export function listShippableCommercialOpenEngines(): readonly StudioCommercialOpenEngineEntry[] {
  return STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG.filter((e) => e.mayShipInProduct);
}

export function listBlockedCommercialOpenEngines(): readonly StudioCommercialOpenEngineEntry[] {
  return STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG.filter((e) => !e.mayShipInProduct);
}

export function resolveCommercialOpenEnginesForTextureKind(
  textureKind: string,
): readonly StudioCommercialOpenEngineEntry[] {
  return STUDIO_COMMERCIAL_OPEN_ENGINE_CATALOG.filter((e) =>
    e.textureKinds.includes(textureKind),
  );
}

export function resolveStudioCommercialOpenEngineAdoptionSummary(): Readonly<{
  version: typeof STUDIO_COMMERCIAL_OPEN_ENGINE_EVAL_VERSION;
  shippableCount: number;
  blockedCount: number;
  textureFirstOrder: readonly string[];
  shippableIds: readonly string[];
  blockedIds: readonly string[];
  coreAdditions: readonly string[];
}> {
  const shippable = listShippableCommercialOpenEngines();
  const blocked = listBlockedCommercialOpenEngines();
  return Object.freeze({
    version: STUDIO_COMMERCIAL_OPEN_ENGINE_EVAL_VERSION,
    shippableCount: shippable.length,
    blockedCount: blocked.length,
    textureFirstOrder: Object.freeze([
      "pin-best-open-texture-engine-per-kind",
      "optimize-same-pin",
      "deliberate-pin-replace-with-lab-evidence",
      "never-silent-fallback-to-weaker-engine",
    ]),
    shippableIds: Object.freeze(shippable.map((e) => e.id)),
    blockedIds: Object.freeze(blocked.map((e) => e.id)),
    coreAdditions: Object.freeze([
      "studio-webgl-stable-fluid-core (MIT fluid)",
      "studio-spectral-pigment-mix-approx (public KM; not Mixbox)",
      "studio-oss-brush-kernels (Klecks MIT + Krita math)",
      "Hokusai .myb + texture v2",
      "Living Ink wet field",
    ]),
  });
}
