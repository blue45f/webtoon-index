/**
 * Runtime decision registry for third-party drawing libraries.
 *
 * These entries describe narrow specialist roles, not competing document engines. ToonSpectrum's
 * canonical stroke plan remains the only source of persistence, replay, collaboration and export
 * truth; every external library is therefore explicitly non-authoritative.
 */

export const STUDIO_DRAWING_LIBRARY_STRATEGY_VERSION =
  "studio-drawing-library-strategy-v10" as const;

export type StudioDrawingLibraryProductLayer =
  | "live-stroke-geometry"
  | "input-stabilization"
  | "rough-shape-rendering"
  | "natural-media-worker"
  | "settled-procedural-raster"
  | "object-selection-overlay"
  | "path-quality-worker"
  | "vector-geometry"
  | "vector-tessellation"
  | "deterministic-raster-oracle"
  | "filter-worker"
  | "gpu-vector-research"
  | "browser-runtime-benchmark"
  | "quality-benchmark"
  | "scene-model";

export type StudioDrawingLibraryRuntimeInstallation =
  | "installed-active"
  | "installed-opt-in"
  | "installed-isolated-provider"
  | "not-installed-poc"
  | "not-installed-benchmark-only"
  | "not-installed-research-only"
  | "not-installed-rejected";

export type StudioDrawingLibraryDecision =
  | "runtime-pressure-outline"
  | "opt-in-input-stabilizer"
  | "runtime-rough-shape-renderer"
  | "isolated-live-natural-media-provider-ready-for-wiring"
  | "isolated-live-natural-media-provider-active-30-routes"
  | "isolated-settled-only-provider"
  | "runtime-object-selection-overlay"
  | "isolated-gpu-scene-overlay-provider"
  | "isolated-worker-path-quality-provider"
  | "isolated-vector-geometry-provider"
  | "poc-vector-tessellation-provider"
  | "poc-deterministic-raster-oracle"
  | "benchmark-first-filter-worker-provider"
  | "research-only-gpu-vector-provider"
  | "native-browser-compatibility-benchmark"
  | "benchmark-oracle-only"
  | "rejected-duplicate-scene-model";

export interface StudioDrawingLibraryStrategy {
  readonly registryVersion: typeof STUDIO_DRAWING_LIBRARY_STRATEGY_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly packageName: string;
  readonly license: string;
  readonly productLayer: StudioDrawingLibraryProductLayer;
  readonly decision: StudioDrawingLibraryDecision;
  readonly runtimeInstallation: StudioDrawingLibraryRuntimeInstallation;
  /** External libraries must never own persisted/replayed document meaning. */
  readonly canonicalAuthority: false;
  /** Brush pixels remain owned by ToonSpectrum's versioned live/committed render contracts. */
  readonly brushPixelAuthority: false;
  readonly maintenanceNote: string;
  readonly riskNotes: readonly string[];
}

function strategy(
  value: Omit<
    StudioDrawingLibraryStrategy,
    "registryVersion" | "canonicalAuthority" | "brushPixelAuthority"
  >
): StudioDrawingLibraryStrategy {
  return Object.freeze({
    registryVersion: STUDIO_DRAWING_LIBRARY_STRATEGY_VERSION,
    ...value,
    canonicalAuthority: false,
    brushPixelAuthority: false,
    riskNotes: Object.freeze([...value.riskNotes]),
  });
}

export const STUDIO_DRAWING_LIBRARY_STRATEGIES: readonly StudioDrawingLibraryStrategy[] =
  Object.freeze([
    strategy({
      id: "perfect-freehand",
      displayName: "perfect-freehand",
      packageName: "perfect-freehand",
      license: "MIT",
      productLayer: "live-stroke-geometry",
      decision: "runtime-pressure-outline",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "Stable, focused outline generator, statically ready before the first live frame and synchronous export.",
      riskNotes: [
        "It emits outline coordinates and does not own compositing, texture, history or persistence.",
        "Real pointer pressure requires simulatePressure=false at the adapter boundary.",
      ],
    }),
    strategy({
      id: "lazy-brush",
      displayName: "lazy-brush",
      packageName: "lazy-brush",
      license: "MIT",
      productLayer: "input-stabilization",
      decision: "opt-in-input-stabilizer",
      runtimeInstallation: "installed-opt-in",
      maintenanceNote:
        "Small, stable stateful leash implementation suitable for an explicit precision mode.",
      riskNotes: [
        "Mutable brush state must be reset per stroke and must not be mutated by predicted samples.",
        "Default pen input remains direct; mandatory lazy stabilization would add visible latency.",
      ],
    }),
    strategy({
      id: "roughjs",
      displayName: "Rough.js",
      packageName: "roughjs",
      license: "MIT",
      productLayer: "rough-shape-rendering",
      decision: "runtime-rough-shape-renderer",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "Stable Canvas/SVG/generator library retained for intentionally hand-drawn shapes.",
      riskNotes: [
        "A deterministic seed must be persisted or the same shape can replay differently.",
        "It is a shape style provider, not the freehand brush or scene authority.",
      ],
    }),
    strategy({
      id: "hokusai",
      displayName: "Hokusai",
      packageName: "studio-hokusai-wasm",
      license: "MIT OR Apache-2.0",
      productLayer: "natural-media-worker",
      decision: "isolated-live-natural-media-provider-active-30-routes",
      runtimeInstallation: "installed-isolated-provider",
      maintenanceNote:
        "The local Rust/WASM wrapper pins Hokusai 0.3.0 exactly. Nineteen verified pencil, charcoal and oil identities may select its transferable packed-dirty Dedicated Worker before the stroke begins; the canonical transparent PNG plus hash-keyed Konva draw receipt owns commit handoff.",
      riskNotes: [
        "Only 19 quality-gated pencil, charcoal and oil identities expose this pre-stroke provider selection; the other 207 shelf identities keep their existing exact routes.",
        "Provider failure is terminal for the selected stroke; a different provider may be selected only before the next stroke, and mid-stroke pixel-authority promotion remains forbidden.",
        "The selected-stroke transparent PNG transform is a separately selected protocol-v2 conversion route.",
        "The stock WASM binding flattens the full surface over opaque white, so ToonSpectrum ships its own packed dirty-frame binding and fail-closed live Worker protocol v1.",
        "License inventory, checked-in integrity hashes, byte-reproducible release build and real-browser runtime QA gate the local provider.",
        "The project is young and deterministic intent does not imply cross-platform bit identity; version, seed, adapter, dirty bounds, output dimensions, pixel layout and output hashes must be receipted.",
      ],
    }),
    strategy({
      id: "p5-brush",
      displayName: "p5.brush",
      packageName: "p5.brush",
      license: "MIT",
      productLayer: "settled-procedural-raster",
      decision: "isolated-settled-only-provider",
      runtimeInstallation: "installed-isolated-provider",
      maintenanceNote:
        "Actively maintained specialist; verified adapter 2.2.1-adapter.3 exposes flow fields, hatching, mass strokes, watercolor fills and flat washes.",
      riskNotes: [
        "Runs only in a dedicated Worker on a private OffscreenCanvas WebGL2 surface.",
        "Every special-effect family remains behind browser capability, quality and bounded-memory gates.",
        "Live-stage execution is forbidden; only copied settled pixels and deterministic receipts cross the provider boundary.",
        "Image and custom tips remain fail-closed until their real adapter path passes the same browser quality gates.",
        "Composited fills use a stricter eight-frame resident-memory admission budget.",
      ],
    }),
    strategy({
      id: "konva",
      displayName: "Konva",
      packageName: "konva",
      license: "MIT",
      productLayer: "object-selection-overlay",
      decision: "runtime-object-selection-overlay",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "Actively maintained retained-mode canvas library already suited to transforms, text and selection overlays.",
      riskNotes: [
        "It must not become the canonical raster brush authority.",
        "Large retained node counts require culling and layer-cache discipline.",
      ],
    }),
    strategy({
      id: "pixi",
      displayName: "PixiJS",
      packageName: "pixi.js",
      license: "MIT",
      productLayer: "object-selection-overlay",
      decision: "isolated-gpu-scene-overlay-provider",
      runtimeInstallation: "installed-isolated-provider",
      maintenanceNote:
        "pixi.js 8.19 is installed with a lazy, explicitly selected WebGPU or WebGL selectable-scene provider. StudioPixiSceneOverlayHost uses an always-on mount for the WebGPU lane on the canvas stage for selection overlays (pointer-inactive) and fails closed if it is unavailable.",
      riskNotes: [
        "It owns only a dedicated transparent pointer-inactive overlay canvas; the document, selection commands and hit-test meaning remain ToonSpectrum-owned.",
        "It must never rasterize live or committed brush paint or share another renderer's GPUCanvasContext.",
        "Always-on host is a presentation overlay only; Konva remains the interactive selection/transform authority.",
      ],
    }),
    strategy({
      id: "paper",
      displayName: "Paper.js",
      packageName: "paper",
      license: "MIT",
      productLayer: "vector-geometry",
      decision: "isolated-vector-geometry-provider",
      runtimeInstallation: "installed-isolated-provider",
      maintenanceNote:
        "Mature, low-churn vector geometry provider with strong simplify, smooth and Boolean path operations.",
      riskNotes: [
        "Keep it dynamically isolated so its global/project state cannot own the Studio scene.",
        "Simplification tolerance changes geometry and must be explicit in canonical commands.",
      ],
    }),
    strategy({
      id: "canvaskit",
      displayName: "CanvasKit/Skia",
      packageName: "canvaskit-wasm",
      license: "BSD-3-Clause",
      productLayer: "path-quality-worker",
      decision: "isolated-worker-path-quality-provider",
      runtimeInstallation: "installed-isolated-provider",
      maintenanceNote:
        "canvaskit-wasm 0.41.1 is installed behind a module Worker/WASM protocol. Bounded Skia PathOps is connected to the settled shape Boolean flow, while stroke-to-fill conversion remains implemented but unwired pending a canonical fill-only vector document boundary.",
      riskNotes: [
        "Only plain SVG path data and structured receipts may cross the Worker boundary; Embind objects and WASM pointers never enter the document.",
        "It has no live or committed brush-pixel authority and cannot replace the canonical stroke plan.",
        "Every allocated CanvasKit path must be deleted inside the Worker epoch, and unsupported text shaping fails closed at the explicitly selected first-party text boundary.",
      ],
    }),
    strategy({
      id: "lyon",
      displayName: "Lyon",
      packageName: "lyon",
      license: "MIT OR Apache-2.0 OR MPL-2.0",
      productLayer: "vector-tessellation",
      decision: "poc-vector-tessellation-provider",
      runtimeInstallation: "not-installed-poc",
      maintenanceNote:
        "Candidate Rust/WASM tessellator for Illustrator-style Art Brush and Pattern Brush path geometry; upstream stable 1.0.19 is not installed and has no product route.",
      riskNotes: [
        "Lyon only converts SVG-compliant fills and strokes into triangles; it is not a renderer and has no built-in antialiasing.",
        "Adoption gate: a bounded Worker PoC must beat the existing Paper.js/CanvasKit path pipeline on long-path latency, memory and deterministic geometry receipts.",
        "Adoption gate: first-party commands must retain Art Brush stretching, pattern side/start/end/corner tile meaning, while the selected GPU renderer owns coverage antialiasing.",
      ],
    }),
    strategy({
      id: "tiny-skia",
      displayName: "tiny-skia",
      packageName: "tiny-skia",
      license: "BSD-3-Clause",
      productLayer: "deterministic-raster-oracle",
      decision: "poc-deterministic-raster-oracle",
      runtimeInstallation: "not-installed-poc",
      maintenanceNote:
        "Candidate Rust/WASM CPU golden-image oracle; upstream stable 0.12.0 is not installed and has no product route.",
      riskNotes: [
        "The supported surface is CPU-only RGBA8888 and excludes GPU rendering, text, ICC profiles, advanced path operations and non-PNG codecs.",
        "Upstream's goal of matching Skia output is not by itself a cross-browser or cross-architecture determinism guarantee.",
        "Adoption gate: native/WASM golden hashes, alpha/blend fixtures and bounded Worker benchmarks must outperform or materially simplify separately selected CanvasKit and Canvas2D provider routes.",
      ],
    }),
    strategy({
      id: "photon",
      displayName: "Photon",
      packageName: "@silvia-odwyer/photon",
      license: "Apache-2.0",
      productLayer: "filter-worker",
      decision: "benchmark-first-filter-worker-provider",
      runtimeInstallation: "not-installed-poc",
      maintenanceNote:
        "Candidate isolated Rust/WASM filter Worker; upstream photon-rs 0.3.3 is not installed and remains benchmark-first against the current filter graph.",
      riskNotes: [
        "A broad function count does not prove better quality, latency or memory than ToonSpectrum's existing WebGPU, OpenCV and image-js paths.",
        "Adoption gate: representative large-canvas color, convolution, dithering and transform benchmarks must validate premultiplied alpha, color-space behavior and transfer-memory budgets.",
        "Adoption gate: only deterministic pixels plus a versioned receipt may cross the Worker boundary; Photon must not own filter-stack, mask or document semantics.",
      ],
    }),
    strategy({
      id: "libmypaint-wasm",
      displayName: "libmypaint-wasm",
      packageName: "libmypaint-wasm",
      license: "MIT",
      productLayer: "natural-media-worker",
      decision: "isolated-live-natural-media-provider-ready-for-wiring",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "MyPaint natural brush simulation engine providing smudge color loading, dynamic bristle hardness, velocity slowness, and HSV jitter dynamics.",
      riskNotes: [
        "Smudge blending requires active canvas sampling under dabs.",
        "Must run synchronously or within bounded Dedicated Worker tiles to preserve low-latency responsiveness.",
      ],
    }),
    strategy({
      id: "krita-core",
      displayName: "Krita Core",
      packageName: "krita-core-engine",
      license: "GPL-3.0-or-later / MIT",
      productLayer: "settled-procedural-raster",
      decision: "isolated-settled-only-provider",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "Krita digital painting core engine algorithms for parametric auto-brush tip generation, dual brush mask blending (multiply, screen, overlay), and texture grain dynamics.",
      riskNotes: [
        "Parametric tip masks must be generated with subpixel precision.",
        "Dual brush mask blending requires matching tip bounding boxes.",
      ],
    }),
    strategy({
      id: "glance",
      displayName: "Glance",
      packageName: "glance-gpu",
      license: "MIT",
      productLayer: "filter-worker",
      decision: "isolated-gpu-scene-overlay-provider",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "Fast WebGL2/WebGPU instant shader preview and visual canvas feedback engine for wet-edge gloss, paper bump, tone mapping and bloom.",
      riskNotes: [
        "Preview shaders run offscreen and must not mutate canonical canvas paint state.",
      ],
    }),
    strategy({
      id: "vello",
      displayName: "Vello",
      packageName: "vello",
      license: "MIT OR Apache-2.0",
      productLayer: "gpu-vector-research",
      decision: "isolated-vector-geometry-provider",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "WGPU 2D vector path renderer engine providing coarse/fine stroke tile binning and subpixel anti-aliased path rasterization.",
      riskNotes: [
        "The selected Vello WebGPU operation fails closed when WebGPU is unavailable; CanvasKit and Canvas2D are independent providers that may only be selected before another operation.",
      ],
    }),
    strategy({
      id: "pathfinder",
      displayName: "Pathfinder",
      packageName: "pathfinder-gpu",
      license: "MIT OR Apache-2.0",
      productLayer: "vector-geometry",
      decision: "isolated-vector-geometry-provider",
      runtimeInstallation: "installed-active",
      maintenanceNote:
        "GPU vector path boolean operations & path offsetting engine for variable-radius stroke expanding and path clipping.",
      riskNotes: [
        "Path offsetting must preserve continuous outline vertex ordering.",
      ],
    }),
    strategy({
      id: "servo",
      displayName: "Servo",
      packageName: "servo",
      license: "MPL-2.0",
      productLayer: "browser-runtime-benchmark",
      decision: "native-browser-compatibility-benchmark",
      runtimeInstallation: "not-installed-benchmark-only",
      maintenanceNote:
        "Active embeddable browser-engine research candidate; regular 0.3.0, LTS 0.1.2 and main 0.4.0-dev were audited on 2026-07-30. Servo is not installed in the Vite bundle and has no Studio renderer route.",
      riskNotes: [
        "Servo is a browser runtime and native-shell compatibility target, not a brush, vector, filter or canonical document provider.",
        "Current upstream compatibility evidence still includes pointerrawupdate and pen coalesced-event failures, Worker OffscreenCanvas gaps, WebGPU default-off behavior and a COEP credentialless isolation failure.",
        "Adoption gate: keep any experiment in a separate native shell and require the production Studio browser QA corpus to pass before considering distribution.",
      ],
    }),
    strategy({
      id: "signature-pad",
      displayName: "Signature Pad",
      packageName: "signature_pad",
      license: "MIT",
      productLayer: "quality-benchmark",
      decision: "benchmark-oracle-only",
      runtimeInstallation: "not-installed-benchmark-only",
      maintenanceNote:
        "Maintained reference implementation for velocity-filtered cubic Bézier handwriting.",
      riskNotes: [
        "Its width model is velocity-driven and does not use recorded pointer pressure for width.",
        "Direct runtime use would duplicate the canonical stroke sampler and final renderer.",
      ],
    }),
    strategy({
      id: "atrament",
      displayName: "Atrament",
      packageName: "atrament",
      license: "MIT (upstream repository; package metadata: SEE LICENSE)",
      productLayer: "quality-benchmark",
      decision: "benchmark-oracle-only",
      runtimeInstallation: "not-installed-benchmark-only",
      maintenanceNote:
        "Compact Canvas2D reference for adaptive thickness, pressure smoothing, erase and fill interactions.",
      riskNotes: [
        "Its direct Canvas ownership conflicts with canonical live/settled replay parity.",
        "Use its interaction behavior as an oracle, not as a document or renderer dependency.",
      ],
    }),
    strategy({
      id: "croquis",
      displayName: "croquis.js",
      packageName: "croquis.js",
      license: "MIT OR Apache-2.0",
      productLayer: "quality-benchmark",
      decision: "benchmark-oracle-only",
      runtimeInstallation: "not-installed-benchmark-only",
      maintenanceNote:
        "Stale but useful reference for pulled-string stabilization and snake-style stroke smoothing.",
      riskNotes: [
        "Low maintenance activity makes direct runtime adoption unsuitable.",
        "Its layer/history model would duplicate current Studio ownership.",
      ],
    }),
    strategy({
      id: "fabric",
      displayName: "Fabric.js",
      packageName: "fabric",
      license: "MIT",
      productLayer: "scene-model",
      decision: "rejected-duplicate-scene-model",
      runtimeInstallation: "not-installed-rejected",
      maintenanceNote:
        "Actively maintained object-canvas engine, but its strongest role overlaps the existing Konva scene layer.",
      riskNotes: [
        "A second retained object model would create duplicate selection, serialization and hit-test authorities.",
        "Its basic PencilBrush does not justify the migration and integration cost.",
      ],
    }),
  ]);

/**
 * Broader source audit used when deciding whether a library belongs in the product, remains an
 * implementation oracle, or must stay out of the bundle. This is deliberately separate from the
 * runtime strategy list: browser standards and first-party infrastructure are not third-party
 * libraries, while GPL/proprietary references may be useful without being product dependencies.
 */
export const STUDIO_DRAWING_SOURCE_AUDIT_VERSION =
  "studio-drawing-source-audit-v8" as const;

export type StudioDrawingSourceKind =
  | "first-party"
  | "browser-standard"
  | "open-source"
  | "commercial-sdk";

export type StudioDrawingSourceDisposition =
  | "adopted-active"
  | "adopted-opt-in"
  | "candidate-poc"
  | "research-only"
  | "reference-only"
  | "excluded";

export type StudioDrawingSourceCodePolicy =
  | "first-party-authority"
  | "browser-native"
  | "runtime-import"
  | "isolated-runtime"
  | "proof-of-concept-only"
  | "research-only"
  | "behavioral-reference-only"
  | "excluded-from-product-code";

export type StudioDrawingSourceActivity =
  | "first-party-active"
  | "browser-standard"
  | "active"
  | "low-churn"
  | "young-fast-moving"
  | "stale"
  | "commercial-release";

export type StudioDrawingSourceBrushAuthorityOverlap =
  | "canonical-owner"
  | "none-infrastructure"
  | "input-only"
  | "geometry-only"
  | "shape-style-only"
  | "brush-renderer-overlap"
  | "path-renderer-overlap"
  | "filter-renderer-overlap"
  | "scene-model-overlap"
  | "document-and-brush-overlap";

export interface StudioDrawingSourceAuditEntry {
  readonly auditVersion: typeof STUDIO_DRAWING_SOURCE_AUDIT_VERSION;
  readonly id: string;
  readonly displayName: string;
  readonly sourceKind: StudioDrawingSourceKind;
  readonly officialSource: string;
  readonly versionEvidence: string;
  readonly license: string;
  readonly activity: StudioDrawingSourceActivity;
  readonly disposition: StudioDrawingSourceDisposition;
  readonly codePolicy: StudioDrawingSourceCodePolicy;
  readonly brushAuthorityOverlap: StudioDrawingSourceBrushAuthorityOverlap;
  readonly rationale: string;
}

function sourceAudit(
  value: Omit<StudioDrawingSourceAuditEntry, "auditVersion">
): StudioDrawingSourceAuditEntry {
  return Object.freeze({
    auditVersion: STUDIO_DRAWING_SOURCE_AUDIT_VERSION,
    ...value,
  });
}

export const STUDIO_DRAWING_SOURCE_AUDIT:
readonly StudioDrawingSourceAuditEntry[] = Object.freeze([
  sourceAudit({
    id: "toonspectrum-canonical-core",
    displayName: "ToonSpectrum tile/layer/history/preset core",
    sourceKind: "first-party",
    officialSource: "apps/web/src/domains/creator",
    versionEvidence: "versioned canonical contracts and receipts",
    license: "First-party product code",
    activity: "first-party-active",
    disposition: "adopted-active",
    codePolicy: "first-party-authority",
    brushAuthorityOverlap: "canonical-owner",
    rationale:
      "The first-party tile, layer, history, preset and stroke-plan formats remain the sole persisted, replayed and collaborative authority.",
  }),
  sourceAudit({
    id: "pointer-events-l3",
    displayName: "Pointer Events Level 3",
    sourceKind: "browser-standard",
    officialSource: "https://www.w3.org/TR/pointerevents3/",
    versionEvidence: "Pointer Events Level 3 plus deployed browser capability checks",
    license: "W3C Document License / browser implementation",
    activity: "browser-standard",
    disposition: "adopted-active",
    codePolicy: "browser-native",
    brushAuthorityOverlap: "input-only",
    rationale:
      "Pointer capture, pointerrawupdate and getCoalescedEvents are the primary low-latency input transport; prediction never mutates committed samples.",
  }),
  sourceAudit({
    id: "toonspectrum-adaptive-stabilizer",
    displayName: "ToonSpectrum adaptive stabilizer",
    sourceKind: "first-party",
    officialSource: "apps/web/src/domains/creator/studio-stroke-stabilizer.ts",
    versionEvidence: "first-party adaptive time-constant and lag-bound implementation",
    license: "First-party product code",
    activity: "first-party-active",
    disposition: "adopted-active",
    codePolicy: "first-party-authority",
    brushAuthorityOverlap: "input-only",
    rationale:
      "The product-owned adaptive causal path remains the default stabilizer; stronger lazy precision is explicit opt-in so the normal pen path does not inherit avoidable lag.",
  }),
  sourceAudit({
    id: "worker-offscreen-canvas",
    displayName: "Dedicated Worker + OffscreenCanvas",
    sourceKind: "browser-standard",
    officialSource: "https://html.spec.whatwg.org/multipage/canvas.html#the-offscreencanvas-interface",
    versionEvidence: "browser-native capability gate",
    license: "WHATWG specification / browser implementation",
    activity: "browser-standard",
    disposition: "adopted-active",
    codePolicy: "browser-native",
    brushAuthorityOverlap: "none-infrastructure",
    rationale:
      "Heavy settled raster, path and procedural providers run behind bounded Worker protocols instead of owning UI-thread document state.",
  }),
  sourceAudit({
    id: "raw-webgl2",
    displayName: "Raw WebGL2",
    sourceKind: "browser-standard",
    officialSource: "https://registry.khronos.org/webgl/specs/latest/2.0/",
    versionEvidence: "WebGL 2.0 browser capability gate",
    license: "Khronos specification / browser implementation",
    activity: "browser-standard",
    disposition: "adopted-active",
    codePolicy: "browser-native",
    brushAuthorityOverlap: "none-infrastructure",
    rationale:
      "Raw WebGL2 is retained as an isolated, explicitly selected GPU transport and never becomes a same-operation replacement for WebGPU or an independent document/history model.",
  }),
  sourceAudit({
    id: "raw-webgpu",
    displayName: "Raw WebGPU",
    sourceKind: "browser-standard",
    officialSource: "https://www.w3.org/TR/webgpu/",
    versionEvidence:
      "browser-native capability plus receipt-gated RGBA16F presentation contracts",
    license: "W3C Document License / browser implementation",
    activity: "browser-standard",
    disposition: "adopted-opt-in",
    codePolicy: "browser-native",
    brushAuthorityOverlap: "none-infrastructure",
    rationale:
      "The textured dry-media vertical slice uses ToonSpectrum-owned WebGPU lowering and a shared RGBA16F presentation surface behind capability, exact-receipt and atomic-authority gates. The normal Studio viewport promotes one selected, top-most, unclipped dry-media stroke only after exact parity receipts; a failed selected WebGPU operation never reveals a Konva replacement frame.",
  }),
  sourceAudit({
    id: "perfect-freehand",
    displayName: "perfect-freehand",
    sourceKind: "open-source",
    officialSource: "https://github.com/steveruizok/perfect-freehand",
    versionEvidence: "manifest exact 1.2.3; resolved 1.2.3",
    license: "MIT",
    activity: "low-churn",
    disposition: "adopted-active",
    codePolicy: "runtime-import",
    brushAuthorityOverlap: "geometry-only",
    rationale:
      "It supplies pressure-aware outline coordinates synchronously while ToonSpectrum owns samples, compositing, persistence and replay.",
  }),
  sourceAudit({
    id: "lazy-brush",
    displayName: "lazy-brush",
    sourceKind: "open-source",
    officialSource: "https://github.com/dulnan/lazy-brush",
    versionEvidence: "manifest ^2.0.2; resolved 2.0.2",
    license: "MIT",
    activity: "low-churn",
    disposition: "adopted-opt-in",
    codePolicy: "runtime-import",
    brushAuthorityOverlap: "input-only",
    rationale:
      "The stateful leash is restricted to an explicit precision mode because mandatory use adds visible lag and duplicates direct-pen dynamics.",
  }),
  sourceAudit({
    id: "stroke-stabilizer-core",
    displayName: "@stroke-stabilizer/core",
    sourceKind: "open-source",
    officialSource: "https://github.com/usapopopooon/stroke-stabilizer",
    versionEvidence: "0.3.1 observed during the 2026-07 audit; not installed",
    license: "MIT",
    activity: "young-fast-moving",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "input-only",
    rationale:
      "Useful benchmark for stabilizer behavior, but a second mutable sampler would overlap the first-party adaptive stabilizer and parity receipts.",
  }),
  sourceAudit({
    id: "roughjs",
    displayName: "Rough.js",
    sourceKind: "open-source",
    officialSource: "https://github.com/rough-stuff/rough",
    versionEvidence: "manifest ^4.6.6; resolved 4.6.6",
    license: "MIT",
    activity: "low-churn",
    disposition: "adopted-active",
    codePolicy: "runtime-import",
    brushAuthorityOverlap: "shape-style-only",
    rationale:
      "Seeded hand-drawn shape styling is narrow and does not compete with the freehand brush engine.",
  }),
  sourceAudit({
    id: "hokusai",
    displayName: "Hokusai",
    sourceKind: "open-source",
    officialSource: "https://github.com/reearth/hokusai",
    versionEvidence:
      "local studio-hokusai-wasm 0.1.0; hokusai-core/brush/tile-mem exact =0.3.0",
    license: "MIT OR Apache-2.0",
    activity: "young-fast-moving",
    disposition: "adopted-opt-in",
    codePolicy: "isolated-runtime",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "The installed Rust/WASM binding is selected before the stroke for 19 verified pencil, charcoal and oil identities: packed dirty deltas, one-frame backpressure, finish-tail acknowledgement, overlay composition, canonical full-frame parity, transparent PNG and a hash-keyed document draw receipt. The other shelf identities retain explicitly planned compatibility routes; runtime failure never switches the active stroke to another renderer.",
  }),
  sourceAudit({
    id: "p5-brush",
    displayName: "p5.brush",
    sourceKind: "open-source",
    officialSource: "https://github.com/acamposuribe/p5.brush",
    versionEvidence: "exact package pin 2.2.1 and adapter 2.2.1-adapter.3",
    license: "MIT",
    activity: "active",
    disposition: "adopted-active",
    codePolicy: "isolated-runtime",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Flow fields, hatching and watercolor generators are accepted only as browser-gated settled pixels from a private Worker OffscreenCanvas.",
  }),
  sourceAudit({
    id: "konva",
    displayName: "Konva",
    sourceKind: "open-source",
    officialSource: "https://github.com/konvajs/konva",
    versionEvidence: "manifest ^10.3.0; resolved 10.3.0",
    license: "MIT",
    activity: "active",
    disposition: "adopted-active",
    codePolicy: "runtime-import",
    brushAuthorityOverlap: "scene-model-overlap",
    rationale:
      "Konva remains the retained selection/text/transform overlay and is explicitly barred from canonical raster brush ownership.",
  }),
  sourceAudit({
    id: "pixi",
    displayName: "PixiJS",
    sourceKind: "open-source",
    officialSource: "https://github.com/pixijs/pixijs",
    versionEvidence: "manifest ^8.19.0; resolved 8.19.0",
    license: "MIT",
    activity: "active",
    disposition: "adopted-opt-in",
    codePolicy: "isolated-runtime",
    brushAuthorityOverlap: "scene-model-overlap",
    rationale:
      "The explicitly selected WebGPU selectable overlay provider is isolated and mounted by StudioPixiSceneOverlayHost; it stays a pointer-inactive presentation overlay while Konva keeps selection and transform authority, and it never switches to WebGL during the same operation.",
  }),
  sourceAudit({
    id: "paper",
    displayName: "Paper.js",
    sourceKind: "open-source",
    officialSource: "https://github.com/paperjs/paper.js",
    versionEvidence: "exact package pin 0.12.18",
    license: "MIT",
    activity: "low-churn",
    disposition: "adopted-opt-in",
    codePolicy: "isolated-runtime",
    brushAuthorityOverlap: "path-renderer-overlap",
    rationale:
      "Vector simplify, smooth and Boolean operations run as explicit settled tools without owning the scene.",
  }),
  sourceAudit({
    id: "canvaskit",
    displayName: "CanvasKit/Skia",
    sourceKind: "open-source",
    officialSource: "https://skia.org/docs/user/modules/canvaskit/",
    versionEvidence: "exact package pin 0.41.1",
    license: "BSD-3-Clause",
    activity: "active",
    disposition: "adopted-opt-in",
    codePolicy: "isolated-runtime",
    brushAuthorityOverlap: "path-renderer-overlap",
    rationale:
      "Bounded PathOps and stroke-to-fill run behind a module Worker; no Embind object, pointer or Skia scene enters the document.",
  }),
  sourceAudit({
    id: "lyon",
    displayName: "Lyon",
    sourceKind: "open-source",
    officialSource: "https://github.com/nical/lyon",
    versionEvidence:
      "crates.io stable lyon 1.0.19 audited 2026-07-30; not installed",
    license: "MIT OR Apache-2.0 OR MPL-2.0",
    activity: "active",
    disposition: "candidate-poc",
    codePolicy: "proof-of-concept-only",
    brushAuthorityOverlap: "geometry-only",
    rationale:
      "Official upstream defines Lyon as SVG-compliant fill/stroke tessellation into GPU-ready triangles, not a renderer, and notes that antialiasing is not built in. A Worker PoC may target Art/Pattern Brush geometry only after deterministic receipts, memory/latency benchmarks and a first-party semantic-command boundary pass.",
  }),
  sourceAudit({
    id: "tiny-skia",
    displayName: "tiny-skia",
    sourceKind: "open-source",
    officialSource: "https://github.com/linebender/tiny-skia",
    versionEvidence:
      "crates.io stable tiny-skia 0.12.0 audited 2026-07-30; not installed",
    license: "BSD-3-Clause",
    activity: "active",
    disposition: "candidate-poc",
    codePolicy: "proof-of-concept-only",
    brushAuthorityOverlap: "path-renderer-overlap",
    rationale:
      "Its official CPU-only RGBA8888 Skia subset can be evaluated as a deterministic golden/reference oracle, but native/WASM hash parity, alpha/blend fixtures and Worker benchmarks must pass before adoption; it cannot supply GPU, text, ICC or advanced PathOps.",
  }),
  sourceAudit({
    id: "photon",
    displayName: "Photon",
    sourceKind: "open-source",
    officialSource: "https://github.com/silvia-odwyer/photon",
    versionEvidence:
      "crates.io stable photon-rs 0.3.3 audited 2026-07-30; not installed",
    license: "Apache-2.0",
    activity: "active",
    disposition: "candidate-poc",
    codePolicy: "proof-of-concept-only",
    brushAuthorityOverlap: "filter-renderer-overlap",
    rationale:
      "Official upstream provides Rust/WebAssembly image processing, but an isolated Worker benchmark must prove quality, alpha/color correctness, large-canvas latency and bounded memory against existing WebGPU/OpenCV/image-js routes before any filter provider is installed.",
  }),
  sourceAudit({
    id: "vello",
    displayName: "Vello",
    sourceKind: "open-source",
    officialSource: "https://github.com/linebender/vello",
    versionEvidence:
      "workspace Rust/WASM fork pinned to Vello 0.9.0 with CPU and browser-GPU artifacts, exact integrity manifests and product probes",
    license: "MIT OR Apache-2.0",
    activity: "young-fast-moving",
    disposition: "adopted-opt-in",
    codePolicy: "isolated-runtime",
    brushAuthorityOverlap: "path-renderer-overlap",
    rationale:
      "The workspace fork now owns a bounded product document slice through exact scene-revision and GPU-presentation receipts. Upstream remains alpha and incomplete for filters, artifact handling, allocation reuse and glyph caching, so unsupported content is selected into a compatibility provider before rendering and a Vello failure never starts another provider.",
  }),
  sourceAudit({
    id: "servo",
    displayName: "Servo",
    sourceKind: "open-source",
    officialSource: "https://github.com/servo/servo",
    versionEvidence:
      "regular 0.3.0 (2026-06-25), LTS 0.1.2 (2026-07-06), main 0.4.0-dev audited 2026-07-30; not installed",
    license: "MPL-2.0",
    activity: "active",
    disposition: "research-only",
    codePolicy: "research-only",
    brushAuthorityOverlap: "none-infrastructure",
    rationale:
      "Servo is evaluated only as an independent embeddable browser/runtime compatibility benchmark and possible future native Studio shell. Current pointerrawupdate and pen coalesced-event failures, Worker OffscreenCanvas gaps, WebGPU default-off behavior and COEP credentialless isolation failure prohibit treating it as a product rendering provider or supported runtime today.",
  }),
  sourceAudit({
    id: "wacom-will",
    displayName: "Wacom WILL Ink SDK",
    sourceKind: "commercial-sdk",
    officialSource: "https://github.com/Wacom-Developer/will-ink-sdk-js-samples",
    versionEvidence: "WILL SDK 2.0.0 release line; samples audited 2026-07",
    license: "MIT sample code; proprietary/commercial SDK EULA and domain license",
    activity: "commercial-release",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Particle ink and UIM behavior are quality references only; the private registry, token and deployment license prevent silent runtime adoption.",
  }),
  sourceAudit({
    id: "brushlib-wasm",
    displayName: "brushlib-wasm",
    sourceKind: "open-source",
    officialSource: "https://github.com/eliot-akira/brushlib-wasm",
    versionEvidence: "repository package version 1.0.0; last activity observed 2022",
    license: "Package metadata says ISC; repository has no authoritative LICENSE file",
    activity: "stale",
    disposition: "excluded",
    codePolicy: "excluded-from-product-code",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Vendored libmypaint provenance and absent repository license evidence are unacceptable; Hokusai is the auditable replacement path.",
  }),
  sourceAudit({
    id: "glbrush",
    displayName: "glbrush.js",
    sourceKind: "open-source",
    officialSource: "https://github.com/Oletus/glbrush.js",
    versionEvidence: "repository last activity observed 2020",
    license: "MIT",
    activity: "stale",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Its 16-bit soft-brush and replay behavior are useful oracles, but its own layer/history serialization would create a second canonical document.",
  }),
  sourceAudit({
    id: "wickbrush",
    displayName: "WickBrush",
    sourceKind: "open-source",
    officialSource: "https://github.com/Wicklets/WickBrush",
    versionEvidence: "repository last activity observed 2021",
    license: "MIT",
    activity: "stale",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Spring-node and custom-tip behavior can inform tests, but its circle-dab carrier and dormant maintenance are not a production engine.",
  }),
  sourceAudit({
    id: "fuderu",
    displayName: "Fuderu",
    sourceKind: "open-source",
    officialSource: "https://github.com/tejasbenibagde/fuderu",
    versionEvidence: "upstream moving from 1.2.2 toward 1.3.0 during the 2026-07 audit; not installed",
    license: "MIT",
    activity: "young-fast-moving",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Its natural-media UX is worth benchmarking, but its layer/history/document surface overlaps first-party authority and the release line was moving during audit.",
  }),
  sourceAudit({
    id: "signature-pad",
    displayName: "Signature Pad",
    sourceKind: "open-source",
    officialSource: "https://github.com/szimek/signature_pad",
    versionEvidence: "5.1.3 observed during the 2026-07 audit; not installed",
    license: "MIT",
    activity: "active",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Velocity-filtered cubic Bézier handwriting remains a benchmark, not a replacement for pressure-recorded canonical samples.",
  }),
  sourceAudit({
    id: "atrament",
    displayName: "Atrament",
    sourceKind: "open-source",
    officialSource: "https://github.com/jakubfiala/atrament.js",
    versionEvidence: "5.1.0 observed during the 2026-07 audit; not installed",
    license: "MIT upstream; package metadata says SEE LICENSE",
    activity: "low-churn",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Adaptive thickness, pressure smoothing, erase and fill interactions are behavior oracles; direct Canvas ownership would break replay parity.",
  }),
  sourceAudit({
    id: "croquis",
    displayName: "croquis.js",
    sourceKind: "open-source",
    officialSource: "https://github.com/tennisonchan/croquis.js",
    versionEvidence: "0.0.3; last package activity observed 2020",
    license: "MIT OR Apache-2.0",
    activity: "stale",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Pulled-string and snake smoothing remain useful benchmark behaviors, but stale maintenance and duplicate layer/history ownership block adoption.",
  }),
  sourceAudit({
    id: "js-draw",
    displayName: "js-draw",
    sourceKind: "open-source",
    officialSource: "https://github.com/personalizedrefrigerator/js-draw",
    versionEvidence: "1.33.0 observed during the 2026-07 audit; not installed",
    license: "MIT",
    activity: "active",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "The complete vector editor is a UX and accessibility reference, not a second scene, command, history and export authority.",
  }),
  sourceAudit({
    id: "drauu",
    displayName: "Drauu",
    sourceKind: "open-source",
    officialSource: "https://github.com/antfu/drauu",
    versionEvidence: "1.0.0 observed during the 2026-07 audit; not installed",
    license: "MIT",
    activity: "active",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Its headless SVG board is a compact interaction reference, but its SVG scene and undo model overlap canonical commands.",
  }),
  sourceAudit({
    id: "chickenpaint",
    displayName: "ChickenPaint",
    sourceKind: "open-source",
    officialSource: "https://github.com/thenickdude/chickenpaint",
    versionEvidence: "0.4.1 observed; low recent package activity",
    license: "GPL-3.0-or-later",
    activity: "stale",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Only externally observed behavior may inform independent tests; ChickenPaint code, bundle, copied structure and derived implementation are excluded from product code.",
  }),
  sourceAudit({
    id: "fabric",
    displayName: "Fabric.js",
    sourceKind: "open-source",
    officialSource: "https://github.com/fabricjs/fabric.js",
    versionEvidence: "active upstream; not installed",
    license: "MIT",
    activity: "active",
    disposition: "excluded",
    codePolicy: "excluded-from-product-code",
    brushAuthorityOverlap: "scene-model-overlap",
    rationale:
      "A second retained object canvas duplicates Konva selection, serialization and hit-testing without improving the canonical brush carrier.",
  }),
  sourceAudit({
    id: "harmony",
    displayName: "Harmony",
    sourceKind: "open-source",
    officialSource: "https://github.com/mrdoob/harmony",
    versionEvidence: "procedural drawing experiments audited 2026-08; not installed",
    license: "GPL-3.0-or-later",
    activity: "stale",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Procedural sketchy, shaded and web proximity-connection algorithms serve as clean-room behavioral inspiration for ToonSpectrum's assist kit; code and assets are excluded.",
  }),
  sourceAudit({
    id: "fabric-brushes",
    displayName: "fabric-brushes",
    sourceKind: "open-source",
    officialSource: "https://github.com/av01d/fabric-brushes",
    versionEvidence: "fabric.js brush extensions audited 2026-08; not installed",
    license: "MIT",
    activity: "low-churn",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Geometric Crayon, Fur, Ribbon, Squares and Spray mathematical dab distributions provide algorithmic reference for clean-room assistive brushes.",
  }),
  sourceAudit({
    id: "klecks",
    displayName: "Klecks / Kleki",
    sourceKind: "open-source",
    officialSource: "https://github.com/bitbof/klecks",
    versionEvidence: "web painting app release line audited 2026-08; not installed",
    license: "MIT (code only; Kleki brand excluded)",
    activity: "active",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Reference for canvas pixel sampling under smudge/blend brushes, stabilizer-to-pressure pipeline order, and layered painting UX.",
  }),
  sourceAudit({
    id: "minipaint",
    displayName: "miniPaint",
    sourceKind: "open-source",
    officialSource: "https://github.com/viliusle/miniPaint",
    versionEvidence: "browser image editor audited 2026-08; not installed",
    license: "MIT",
    activity: "active",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "document-and-brush-overlap",
    rationale:
      "Image editing UX, canvas zoom/pan transform math, and layer composition benchmark.",
  }),
  sourceAudit({
    id: "brush-viewer",
    displayName: "brush-viewer (ABR)",
    sourceKind: "open-source",
    officialSource: "https://github.com/jlai/brush-viewer",
    versionEvidence: "ABR parser implementation audited 2026-08; not installed",
    license: "MIT",
    activity: "low-churn",
    disposition: "reference-only",
    codePolicy: "behavioral-reference-only",
    brushAuthorityOverlap: "shape-style-only",
    rationale:
      "Photoshop .abr brush tip texture extraction reference informing format gateway's ABR import capabilities.",
  }),
  sourceAudit({
    id: "mypaint-brushes",
    displayName: "MyPaint Official Brushes",
    sourceKind: "open-source",
    officialSource: "https://github.com/mypaint/mypaint-brushes",
    versionEvidence: "v2.0.2 / OpenToonz brush collection CC0 presets",
    license: "CC0-1.0 / Public Domain (brush settings)",
    activity: "low-churn",
    disposition: "adopted-active",
    codePolicy: "runtime-import",
    brushAuthorityOverlap: "brush-renderer-overlap",
    rationale:
      "Authoritative natural-media brush presets (Classic, Deevad, Ramon, Tanda) imported through the format gateway into ToonSpectrum brush dynamics.",
  }),
]);

const STRATEGY_BY_ID = new Map(
  STUDIO_DRAWING_LIBRARY_STRATEGIES.map((entry) => [entry.id, entry])
);
const SOURCE_AUDIT_BY_ID = new Map(
  STUDIO_DRAWING_SOURCE_AUDIT.map((entry) => [entry.id, entry])
);

export function resolveStudioDrawingLibraryStrategy(
  id: unknown
): StudioDrawingLibraryStrategy | null {
  return typeof id === "string" ? STRATEGY_BY_ID.get(id) ?? null : null;
}

export function resolveStudioDrawingSourceAudit(
  id: unknown
): StudioDrawingSourceAuditEntry | null {
  return typeof id === "string" ? SOURCE_AUDIT_BY_ID.get(id) ?? null : null;
}

export function listStudioDrawingLibraryStrategiesByLayer(
  layer: StudioDrawingLibraryProductLayer
): readonly StudioDrawingLibraryStrategy[] {
  return Object.freeze(
    STUDIO_DRAWING_LIBRARY_STRATEGIES.filter(
      (entry) => entry.productLayer === layer
    )
  );
}

export interface StudioDrawingLibraryStrategyValidationCandidate {
  readonly id: unknown;
  readonly canonicalAuthority: unknown;
}

export interface StudioDrawingLibraryStrategyValidation {
  readonly valid: boolean;
  readonly duplicateIds: readonly string[];
  readonly conflictingCanonicalAuthorityIds: readonly string[];
}

/**
 * Validates registry ownership invariants independently of TypeScript. This also protects data
 * loaded from generated manifests or tests that bypass compile-time literal types.
 */
export function validateStudioDrawingLibraryStrategies(
  entries: readonly StudioDrawingLibraryStrategyValidationCandidate[] =
    STUDIO_DRAWING_LIBRARY_STRATEGIES
): StudioDrawingLibraryStrategyValidation {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const conflicts = new Set<string>();

  entries.forEach((entry, index) => {
    const id =
      typeof entry.id === "string" && entry.id.trim().length > 0
        ? entry.id
        : `<invalid:${index}>`;
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
    if (entry.canonicalAuthority !== false) conflicts.add(id);
  });

  const duplicateIds = Object.freeze([...duplicates].sort());
  const conflictingCanonicalAuthorityIds = Object.freeze(
    [...conflicts].sort()
  );
  return Object.freeze({
    valid:
      duplicateIds.length === 0
      && conflictingCanonicalAuthorityIds.length === 0,
    duplicateIds,
    conflictingCanonicalAuthorityIds,
  });
}
