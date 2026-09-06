import { describe, expect, it } from "vitest";

import {
  STUDIO_DRAWING_LIBRARY_STRATEGIES,
  STUDIO_DRAWING_LIBRARY_STRATEGY_VERSION,
  STUDIO_DRAWING_SOURCE_AUDIT,
  STUDIO_DRAWING_SOURCE_AUDIT_VERSION,
  listStudioDrawingLibraryStrategiesByLayer,
  resolveStudioDrawingLibraryStrategy,
  resolveStudioDrawingSourceAudit,
  validateStudioDrawingLibraryStrategies,
} from "./studio-drawing-library-strategy";

describe("studio drawing library strategy", () => {
  it("keeps an extensible specialist inventory without document or brush-pixel authority", () => {
    expect(STUDIO_DRAWING_LIBRARY_STRATEGY_VERSION)
      .toBe("studio-drawing-library-strategy-v10");
    const requiredIds = [
      "perfect-freehand",
      "lazy-brush",
      "roughjs",
      "hokusai",
      "p5-brush",
      "konva",
      "pixi",
      "paper",
      "canvaskit",
      "lyon",
      "tiny-skia",
      "photon",
      "vello",
      "servo",
      "signature-pad",
      "atrament",
      "croquis",
      "fabric",
    ];
    const ids = STUDIO_DRAWING_LIBRARY_STRATEGIES.map(({ id }) => id);

    expect(ids).toEqual(expect.arrayContaining(requiredIds));
    expect(
      new Set(ids).size
    ).toBe(STUDIO_DRAWING_LIBRARY_STRATEGIES.length);
    for (const entry of STUDIO_DRAWING_LIBRARY_STRATEGIES) {
      expect(entry.registryVersion).toBe(
        STUDIO_DRAWING_LIBRARY_STRATEGY_VERSION
      );
      expect(entry.canonicalAuthority).toBe(false);
      expect(entry.brushPixelAuthority).toBe(false);
      expect(entry.license.length).toBeGreaterThan(0);
      expect(entry.maintenanceNote.length).toBeGreaterThan(0);
      expect(entry.riskNotes.length).toBeGreaterThan(0);
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.riskNotes)).toBe(true);
    }
    expect(validateStudioDrawingLibraryStrategies()).toEqual({
      valid: true,
      duplicateIds: [],
      conflictingCanonicalAuthorityIds: [],
    });
  });

  it("encodes the approved runtime, isolated, benchmark and rejection roles", () => {
    expect(resolveStudioDrawingLibraryStrategy("perfect-freehand")).toMatchObject({
      productLayer: "live-stroke-geometry",
      decision: "runtime-pressure-outline",
      runtimeInstallation: "installed-active",
      license: "MIT",
      maintenanceNote:
        "Stable, focused outline generator, statically ready before the first live frame and synchronous export.",
    });
    expect(resolveStudioDrawingLibraryStrategy("lazy-brush")).toMatchObject({
      productLayer: "input-stabilization",
      decision: "opt-in-input-stabilizer",
      runtimeInstallation: "installed-opt-in",
    });
    expect(resolveStudioDrawingLibraryStrategy("roughjs")).toMatchObject({
      productLayer: "rough-shape-rendering",
      decision: "runtime-rough-shape-renderer",
    });
    const hokusai = resolveStudioDrawingLibraryStrategy("hokusai");
    expect(hokusai).toMatchObject({
      packageName: "studio-hokusai-wasm",
      license: "MIT OR Apache-2.0",
      productLayer: "natural-media-worker",
      decision: "isolated-live-natural-media-provider-active-30-routes",
      runtimeInstallation: "installed-isolated-provider",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(hokusai?.maintenanceNote).toContain("pins Hokusai 0.3.0 exactly");
    expect(hokusai?.maintenanceNote).toContain("Nineteen verified");
    expect(hokusai?.maintenanceNote).toContain("transferable packed-dirty");
    expect(hokusai?.maintenanceNote).toContain("canonical transparent PNG");
    expect(hokusai?.riskNotes.join(" ")).toContain(
      "Only 19 quality-gated",
    );
    expect(hokusai?.riskNotes.join(" ")).toContain("real-browser runtime QA");
    expect(hokusai?.riskNotes.join(" ")).toContain("cross-platform bit identity");
    expect(hokusai?.riskNotes.join(" ")).toContain("live Worker protocol v1");
    expect(hokusai?.maintenanceNote).toContain("select its transferable");
    expect(hokusai?.maintenanceNote).toContain("before the stroke begins");
    expect(hokusai?.riskNotes.join(" ")).toContain(
      "Provider failure is terminal for the selected stroke",
    );
    expect(hokusai?.riskNotes.join(" ")).toContain(
      "only before the next stroke",
    );
    expect(hokusai?.riskNotes.join(" ")).toContain(
      "separately selected protocol-v2 conversion route",
    );
    const p5Brush = resolveStudioDrawingLibraryStrategy("p5-brush");
    expect(p5Brush).toMatchObject({
      productLayer: "settled-procedural-raster",
      decision: "isolated-settled-only-provider",
      runtimeInstallation: "installed-isolated-provider",
    });
    expect(p5Brush?.maintenanceNote).toContain("2.2.1-adapter.3");
    expect(p5Brush?.maintenanceNote).toContain("watercolor fills");
    expect(p5Brush?.maintenanceNote).toContain("flat washes");
    expect(p5Brush?.riskNotes).toContain(
      "Composited fills use a stricter eight-frame resident-memory admission budget.",
    );
    expect(resolveStudioDrawingLibraryStrategy("konva")).toMatchObject({
      productLayer: "object-selection-overlay",
      decision: "runtime-object-selection-overlay",
    });
    const pixi = resolveStudioDrawingLibraryStrategy("pixi");
    expect(pixi).toMatchObject({
      packageName: "pixi.js",
      license: "MIT",
      productLayer: "object-selection-overlay",
      decision: "isolated-gpu-scene-overlay-provider",
      runtimeInstallation: "installed-isolated-provider",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(pixi?.maintenanceNote).toContain("explicitly selected WebGPU or WebGL");
    expect(pixi?.maintenanceNote).toContain("always-on");
    expect(pixi?.maintenanceNote).toContain("StudioPixiSceneOverlayHost");
    expect(pixi?.riskNotes).toContain(
      "It must never rasterize live or committed brush paint or share another renderer's GPUCanvasContext.",
    );
    // The audit rationale must not contradict the maintenance note: the host is mounted, so the
    // entry may not still describe the provider as unwired.
    const pixiAudit = STUDIO_DRAWING_SOURCE_AUDIT.find((entry) => entry.id === "pixi");
    expect(pixiAudit?.rationale).toContain("StudioPixiSceneOverlayHost");
    expect(pixiAudit?.rationale).not.toContain("unwired");
    expect(resolveStudioDrawingLibraryStrategy("paper")).toMatchObject({
      productLayer: "vector-geometry",
      decision: "isolated-vector-geometry-provider",
    });
    const canvasKit = resolveStudioDrawingLibraryStrategy("canvaskit");
    expect(canvasKit).toMatchObject({
      packageName: "canvaskit-wasm",
      license: "BSD-3-Clause",
      productLayer: "path-quality-worker",
      decision: "isolated-worker-path-quality-provider",
      runtimeInstallation: "installed-isolated-provider",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(canvasKit?.maintenanceNote).toContain("module Worker/WASM");
    expect(canvasKit?.maintenanceNote).toContain("PathOps");
    expect(canvasKit?.maintenanceNote).toContain("stroke-to-fill");
    expect(canvasKit?.maintenanceNote).toContain(
      "settled shape Boolean flow",
    );
    expect(canvasKit?.maintenanceNote).toContain(
      "stroke-to-fill conversion remains implemented but unwired",
    );
    expect(canvasKit?.riskNotes).toContain(
      "Only plain SVG path data and structured receipts may cross the Worker boundary; Embind objects and WASM pointers never enter the document.",
    );
    const lyon = resolveStudioDrawingLibraryStrategy("lyon");
    expect(lyon).toMatchObject({
      packageName: "lyon",
      license: "MIT OR Apache-2.0 OR MPL-2.0",
      productLayer: "vector-tessellation",
      decision: "poc-vector-tessellation-provider",
      runtimeInstallation: "not-installed-poc",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(lyon?.maintenanceNote).toContain("1.0.19");
    expect(lyon?.riskNotes.join(" ")).toContain(
      "no built-in antialiasing",
    );
    expect(lyon?.riskNotes.join(" ")).toContain("Adoption gate:");

    const tinySkia = resolveStudioDrawingLibraryStrategy("tiny-skia");
    expect(tinySkia).toMatchObject({
      packageName: "tiny-skia",
      license: "BSD-3-Clause",
      productLayer: "deterministic-raster-oracle",
      decision: "poc-deterministic-raster-oracle",
      runtimeInstallation: "not-installed-poc",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(tinySkia?.maintenanceNote).toContain("0.12.0");
    expect(tinySkia?.riskNotes.join(" ")).toContain("CPU-only RGBA8888");
    expect(tinySkia?.riskNotes.join(" ")).toContain(
      "not by itself a cross-browser",
    );
    expect(tinySkia?.maintenanceNote).toContain("CPU golden-image oracle");
    expect(tinySkia?.riskNotes.join(" ")).toContain(
      "separately selected CanvasKit and Canvas2D provider routes",
    );
    expect(canvasKit?.riskNotes.join(" ")).toContain(
      "fails closed at the explicitly selected first-party text boundary",
    );

    const photon = resolveStudioDrawingLibraryStrategy("photon");
    expect(photon).toMatchObject({
      packageName: "@silvia-odwyer/photon",
      license: "Apache-2.0",
      productLayer: "filter-worker",
      decision: "benchmark-first-filter-worker-provider",
      runtimeInstallation: "not-installed-poc",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(photon?.maintenanceNote).toContain("0.3.3");
    expect(photon?.riskNotes.join(" ")).toContain(
      "premultiplied alpha",
    );
    expect(photon?.riskNotes.join(" ")).toContain(
      "must not own filter-stack",
    );

    const vello = resolveStudioDrawingLibraryStrategy("vello");
    expect(vello).toMatchObject({
      packageName: "vello",
      license: "MIT OR Apache-2.0",
      productLayer: "gpu-vector-research",
      decision: "isolated-vector-geometry-provider",
      runtimeInstallation: "installed-active",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(vello?.maintenanceNote).toContain("WGPU 2D vector path renderer engine");
    const servo = resolveStudioDrawingLibraryStrategy("servo");
    expect(servo).toMatchObject({
      packageName: "servo",
      license: "MPL-2.0",
      productLayer: "browser-runtime-benchmark",
      decision: "native-browser-compatibility-benchmark",
      runtimeInstallation: "not-installed-benchmark-only",
      canonicalAuthority: false,
      brushPixelAuthority: false,
    });
    expect(servo?.maintenanceNote).toContain("0.3.0");
    expect(servo?.maintenanceNote).toContain("LTS 0.1.2");
    expect(servo?.riskNotes.join(" ")).toContain("not a brush");
    expect(servo?.riskNotes.join(" ")).toContain("pointerrawupdate");
    expect(servo?.riskNotes.join(" ")).toContain("WebGPU default-off");
    expect(resolveStudioDrawingLibraryStrategy("fabric")).toMatchObject({
      productLayer: "scene-model",
      decision: "rejected-duplicate-scene-model",
      runtimeInstallation: "not-installed-rejected",
    });
  });

  it("keeps Signature Pad, Atrament and Croquis as non-installed benchmark oracles", () => {
    const benchmarkIds = listStudioDrawingLibraryStrategiesByLayer(
      "quality-benchmark"
    ).map(({ id }) => id);
    expect(benchmarkIds).toEqual(["signature-pad", "atrament", "croquis"]);
    for (const id of benchmarkIds) {
      expect(resolveStudioDrawingLibraryStrategy(id)).toMatchObject({
        decision: "benchmark-oracle-only",
        runtimeInstallation: "not-installed-benchmark-only",
        canonicalAuthority: false,
      });
    }
    expect(resolveStudioDrawingLibraryStrategy("croquis")?.packageName).toBe(
      "croquis.js"
    );
  });

  it("resolves by id, lists immutable layer snapshots and rejects unknown ids", () => {
    expect(resolveStudioDrawingLibraryStrategy("paper")?.packageName).toBe(
      "paper"
    );
    expect(resolveStudioDrawingLibraryStrategy("missing")).toBeNull();
    expect(resolveStudioDrawingLibraryStrategy(null)).toBeNull();

    const layer = listStudioDrawingLibraryStrategiesByLayer(
      "input-stabilization"
    );
    expect(layer.map(({ id }) => id)).toEqual(["lazy-brush"]);
    expect(Object.isFrozen(layer)).toBe(true);
  });

  it("reports duplicate ids and any attempted external canonical authority", () => {
    const validation = validateStudioDrawingLibraryStrategies([
      { id: "perfect-freehand", canonicalAuthority: false },
      { id: "perfect-freehand", canonicalAuthority: false },
      { id: "rogue-scene-engine", canonicalAuthority: true },
      { id: "unknown-authority", canonicalAuthority: "yes" },
    ]);
    expect(validation).toEqual({
      valid: false,
      duplicateIds: ["perfect-freehand"],
      conflictingCanonicalAuthorityIds: [
        "rogue-scene-engine",
        "unknown-authority",
      ],
    });
  });
});

describe("studio drawing source adoption audit", () => {
  const candidateIds = [
    "toonspectrum-canonical-core",
    "pointer-events-l3",
    "toonspectrum-adaptive-stabilizer",
    "worker-offscreen-canvas",
    "raw-webgl2",
    "raw-webgpu",
    "perfect-freehand",
    "lazy-brush",
    "stroke-stabilizer-core",
    "roughjs",
    "hokusai",
    "p5-brush",
    "konva",
    "pixi",
    "paper",
    "canvaskit",
    "lyon",
    "tiny-skia",
    "photon",
    "vello",
    "servo",
    "wacom-will",
    "brushlib-wasm",
    "glbrush",
    "wickbrush",
    "fuderu",
    "signature-pad",
    "atrament",
    "croquis",
    "js-draw",
    "drauu",
    "chickenpaint",
    "fabric",
    "harmony",
    "fabric-brushes",
    "klecks",
    "minipaint",
    "brush-viewer",
    "mypaint-brushes",
  ] as const;

  it("freezes the complete reviewed candidate set and provenance fields", () => {
    expect(STUDIO_DRAWING_SOURCE_AUDIT_VERSION)
      .toBe("studio-drawing-source-audit-v8");
    expect(STUDIO_DRAWING_SOURCE_AUDIT.map(({ id }) => id)).toEqual(
      candidateIds,
    );
    expect(new Set(candidateIds).size).toBe(candidateIds.length);
    expect(Object.isFrozen(STUDIO_DRAWING_SOURCE_AUDIT)).toBe(true);

    for (const entry of STUDIO_DRAWING_SOURCE_AUDIT) {
      expect(entry.auditVersion).toBe(STUDIO_DRAWING_SOURCE_AUDIT_VERSION);
      expect(entry.officialSource.length, entry.id).toBeGreaterThan(0);
      expect(entry.versionEvidence.length, entry.id).toBeGreaterThan(0);
      expect(entry.license.length, entry.id).toBeGreaterThan(0);
      expect(entry.rationale.length, entry.id).toBeGreaterThan(0);
      expect(Object.isFrozen(entry), entry.id).toBe(true);
    }
  });

  it("records active, opt-in, reference and excluded sources without creating a second authority", () => {
    for (const id of [
      "pointer-events-l3",
      "toonspectrum-adaptive-stabilizer",
      "worker-offscreen-canvas",
      "raw-webgl2",
      "perfect-freehand",
      "roughjs",
      "p5-brush",
      "konva",
      "mypaint-brushes",
    ]) {
      expect(resolveStudioDrawingSourceAudit(id)?.disposition, id)
        .toBe("adopted-active");
    }

    for (const id of [
      "raw-webgpu",
      "lazy-brush",
      "hokusai",
      "pixi",
      "paper",
      "canvaskit",
      "vello",
    ]) {
      expect(resolveStudioDrawingSourceAudit(id)?.disposition, id)
        .toBe("adopted-opt-in");
    }

    for (const id of ["lyon", "tiny-skia", "photon"]) {
      expect(resolveStudioDrawingSourceAudit(id)?.disposition, id)
        .toBe("candidate-poc");
      expect(resolveStudioDrawingSourceAudit(id)?.codePolicy, id)
        .toBe("proof-of-concept-only");
    }

    expect(resolveStudioDrawingSourceAudit("vello")).toMatchObject({
      disposition: "adopted-opt-in",
      codePolicy: "isolated-runtime",
      brushAuthorityOverlap: "path-renderer-overlap",
    });
    expect(resolveStudioDrawingSourceAudit("servo")).toMatchObject({
      disposition: "research-only",
      codePolicy: "research-only",
      brushAuthorityOverlap: "none-infrastructure",
    });

    for (const id of [
      "stroke-stabilizer-core",
      "wacom-will",
      "glbrush",
      "wickbrush",
      "fuderu",
      "signature-pad",
      "atrament",
      "croquis",
      "js-draw",
      "drauu",
      "chickenpaint",
      "harmony",
      "fabric-brushes",
      "klecks",
      "minipaint",
      "brush-viewer",
    ]) {
      expect(resolveStudioDrawingSourceAudit(id)?.disposition, id)
        .toBe("reference-only");
      expect(resolveStudioDrawingSourceAudit(id)?.codePolicy, id)
        .toBe("behavioral-reference-only");
    }

    for (const id of ["brushlib-wasm", "fabric"]) {
      expect(resolveStudioDrawingSourceAudit(id)?.disposition, id)
        .toBe("excluded");
      expect(resolveStudioDrawingSourceAudit(id)?.codePolicy, id)
        .toBe("excluded-from-product-code");
    }
  });

  it("records evidence and fail-closed gates for candidates and the bounded Vello provider", () => {
    expect(resolveStudioDrawingSourceAudit("lyon")).toMatchObject({
      officialSource: "https://github.com/nical/lyon",
      versionEvidence:
        "crates.io stable lyon 1.0.19 audited 2026-07-30; not installed",
      license: "MIT OR Apache-2.0 OR MPL-2.0",
      brushAuthorityOverlap: "geometry-only",
    });
    expect(resolveStudioDrawingSourceAudit("lyon")?.rationale)
      .toContain("not a renderer");
    expect(resolveStudioDrawingSourceAudit("lyon")?.rationale)
      .toContain("deterministic receipts");

    expect(resolveStudioDrawingSourceAudit("tiny-skia")).toMatchObject({
      officialSource: "https://github.com/linebender/tiny-skia",
      versionEvidence:
        "crates.io stable tiny-skia 0.12.0 audited 2026-07-30; not installed",
      license: "BSD-3-Clause",
      brushAuthorityOverlap: "path-renderer-overlap",
    });
    expect(resolveStudioDrawingSourceAudit("tiny-skia")?.rationale)
      .toContain("native/WASM hash parity");
    expect(resolveStudioDrawingSourceAudit("tiny-skia")?.rationale)
      .toContain("cannot supply GPU");

    expect(resolveStudioDrawingSourceAudit("photon")).toMatchObject({
      officialSource: "https://github.com/silvia-odwyer/photon",
      versionEvidence:
        "crates.io stable photon-rs 0.3.3 audited 2026-07-30; not installed",
      license: "Apache-2.0",
      brushAuthorityOverlap: "filter-renderer-overlap",
    });
    expect(resolveStudioDrawingSourceAudit("photon")?.rationale)
      .toContain("alpha/color correctness");
    expect(resolveStudioDrawingSourceAudit("photon")?.rationale)
      .toContain("existing WebGPU/OpenCV/image-js routes");

    expect(resolveStudioDrawingSourceAudit("vello")).toMatchObject({
      officialSource: "https://github.com/linebender/vello",
      versionEvidence:
        "workspace Rust/WASM fork pinned to Vello 0.9.0 with CPU and browser-GPU artifacts, exact integrity manifests and product probes",
      license: "MIT OR Apache-2.0",
      activity: "young-fast-moving",
    });
    expect(resolveStudioDrawingSourceAudit("vello")?.rationale)
      .toContain("bounded product document slice");
    expect(resolveStudioDrawingSourceAudit("vello")?.rationale)
      .toContain("never starts another provider");

    expect(resolveStudioDrawingSourceAudit("servo")).toMatchObject({
      officialSource: "https://github.com/servo/servo",
      versionEvidence:
        "regular 0.3.0 (2026-06-25), LTS 0.1.2 (2026-07-06), main 0.4.0-dev audited 2026-07-30; not installed",
      license: "MPL-2.0",
      activity: "active",
      brushAuthorityOverlap: "none-infrastructure",
    });
    expect(resolveStudioDrawingSourceAudit("servo")?.rationale)
      .toContain("browser/runtime compatibility benchmark");
    expect(resolveStudioDrawingSourceAudit("servo")?.rationale)
      .toContain("COEP credentialless isolation failure");
  });

  it("records the quality-gated Hokusai live slice without claiming all shelf routes", () => {
    expect(resolveStudioDrawingSourceAudit("hokusai")).toMatchObject({
      versionEvidence:
        "local studio-hokusai-wasm 0.1.0; hokusai-core/brush/tile-mem exact =0.3.0",
      license: "MIT OR Apache-2.0",
      activity: "young-fast-moving",
      disposition: "adopted-opt-in",
      codePolicy: "isolated-runtime",
      brushAuthorityOverlap: "brush-renderer-overlap",
    });
    expect(resolveStudioDrawingSourceAudit("hokusai")?.rationale)
      .toContain("selected before the stroke for 19 verified");
    expect(resolveStudioDrawingSourceAudit("hokusai")?.rationale)
      .toContain("finish-tail acknowledgement");
    expect(resolveStudioDrawingSourceAudit("hokusai")?.rationale)
      .toContain("canonical full-frame parity");
    expect(resolveStudioDrawingSourceAudit("hokusai")?.rationale)
      .toContain("runtime failure never switches the active stroke");
  });

  it("records the narrow receipt-gated raw WebGPU product host without claiming a default live core", () => {
    expect(resolveStudioDrawingSourceAudit("raw-webgpu")).toMatchObject({
      sourceKind: "browser-standard",
      disposition: "adopted-opt-in",
      codePolicy: "browser-native",
      brushAuthorityOverlap: "none-infrastructure",
    });
    expect(resolveStudioDrawingSourceAudit("raw-webgpu")?.rationale)
      .toContain("RGBA16F");
    expect(resolveStudioDrawingSourceAudit("raw-webgpu")?.rationale)
      .toContain("promotes one selected, top-most, unclipped");
    expect(resolveStudioDrawingSourceAudit("raw-webgpu")?.rationale)
      .toContain("never reveals a Konva replacement frame");
  });

  it("keeps commercially gated and copyleft editors out of product code", () => {
    expect(resolveStudioDrawingSourceAudit("wacom-will")).toMatchObject({
      sourceKind: "commercial-sdk",
      license:
        "MIT sample code; proprietary/commercial SDK EULA and domain license",
      codePolicy: "behavioral-reference-only",
      brushAuthorityOverlap: "document-and-brush-overlap",
    });
    expect(resolveStudioDrawingSourceAudit("chickenpaint")).toMatchObject({
      license: "GPL-3.0-or-later",
      disposition: "reference-only",
      codePolicy: "behavioral-reference-only",
    });
    expect(resolveStudioDrawingSourceAudit("chickenpaint")?.rationale)
      .toContain("code, bundle, copied structure");
    expect(resolveStudioDrawingSourceAudit("brushlib-wasm")?.license)
      .toContain("no authoritative LICENSE");
  });

  it("resolves the first-party canonical owner and rejects unknown audit ids", () => {
    expect(resolveStudioDrawingSourceAudit("toonspectrum-canonical-core"))
      .toMatchObject({
        sourceKind: "first-party",
        disposition: "adopted-active",
        codePolicy: "first-party-authority",
        brushAuthorityOverlap: "canonical-owner",
      });
    expect(resolveStudioDrawingSourceAudit("missing")).toBeNull();
    expect(resolveStudioDrawingSourceAudit(null)).toBeNull();
  });
});
