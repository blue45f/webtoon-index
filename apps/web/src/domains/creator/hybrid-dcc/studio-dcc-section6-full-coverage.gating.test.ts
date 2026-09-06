/**
 * Architecture doc §6 full-catalog gating.
 * Every table ID must be in SSOT with apis; every ID must be exerciseable;
 * DRW/PUB/MAT P0–P1 drive real lite kernel APIs (not dispatch-only stubs).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { getStudioPublishPlatformPreset } from "../studio-publish-package";

import {
  exerciseAllStudioDccCatalogFeatures,
  exerciseStudioDccCatalogFeature,
} from "./studio-dcc-catalog-feature-dispatch";
import {
  applyStudioToneFilterAdjustment,
  bindStudioReferenceLayer,
  buildStudioAssetLicenseReport,
  buildStudioPublishPackageLite,
  buildStudioPublishVersionManifest,
  createStudioPanelBalloonTextLayout,
  createStudioPerspectiveRuler,
  createStudioPbrMaterialLite,
  createStudioRasterVectorLayerStack,
  createStudioToonHatchToneMaterial,
  fillStudioCloseGapRegion,
  measureStudioBrushLatencyBudget,
  planStudioPressureBrushStroke,
  reportStudioPsdPsbCompatibility,
  resolveStudioColorManagementProfile,
  snapStudioRulerGuide,
  transformStudioLayer,
} from "./studio-dcc-material-publish-draw-lite";
import {
  assertStudioSection6FullCoverage,
  STUDIO_DCC_SECTION6_CATALOG,
  STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS,
  STUDIO_DCC_SECTION6_IDS,
  studioSection6ById,
  studioSection6CoverageStats,
} from "./studio-dcc-section6-full-catalog";

const ARCH_DOC = resolve(
  __dirname,
  "../../../../docs/reference/studio-hybrid-dcc-section6-ids.md",
);

function extractDocSection6Ids(markdown: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const line of markdown.split(/\r?\n/u)) {
    const m = /^\|\s*([A-Z]{2,5}-\d{3})\s*\|/.exec(line);
    if (!m) continue;
    const id = m[1]!;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

describe("§6 full catalog SSOT", () => {
  it("covers every architecture-doc table ID with apis and valid status", () => {
    const docIds = extractDocSection6Ids(readFileSync(ARCH_DOC, "utf8"));
    expect(docIds.length).toBeGreaterThan(150);
    const set = new Set(STUDIO_DCC_SECTION6_IDS);
    const missingFromSsot = docIds.filter((id) => !set.has(id));
    expect(missingFromSsot).toEqual([]);
    const coverage = assertStudioSection6FullCoverage();
    expect(coverage.missing).toEqual([]);
    expect(coverage.withoutApis).toEqual([]);
    expect(coverage.ok).toBe(true);
    const stats = studioSection6CoverageStats();
    expect(stats.total).toBeGreaterThanOrEqual(docIds.length);
    expect(stats.kernelShipped + stats.partial + stats.bridgeOnly).toBe(stats.total);
    expect(stats.productionActivated).toBe(0);
    // partials must declare ceilings
    for (const e of STUDIO_DCC_SECTION6_CATALOG) {
      if (e.kernelStatus === "partial") {
        expect(e.ceilingNote && e.ceilingNote.length > 0).toBe(true);
      }
      expect(e.apis.length).toBeGreaterThan(0);
    }
  });

  it("does not promote kernel fixtures into unverified product delivery stages", () => {
    expect(STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS).toHaveLength(
      STUDIO_DCC_SECTION6_CATALOG.length,
    );
    for (const assessment of STUDIO_DCC_SECTION6_DELIVERY_ASSESSMENTS) {
      const catalogEntry = studioSection6ById(assessment.id);
      expect(catalogEntry).not.toBeNull();
      expect(assessment.unverifiedStages).toEqual([
        "ui-wired",
        "document-integrated",
        "persistence-verified",
        "collaboration-verified",
        "browser-verified",
        "production-activated",
      ]);
      expect(assessment.verifiedStages).toEqual(
        catalogEntry?.kernelStatus === "kernel-shipped" ? ["kernel-shipped"] : [],
      );
    }
  });

  it("exercises every catalog ID through real domain/core kernels", async () => {
    const all = await exerciseAllStudioDccCatalogFeatures();
    expect(all.failures).toEqual([]);
    expect(all.ok).toBe(true);
    expect(all.exercised).toBe(STUDIO_DCC_SECTION6_IDS.length);
    const drw = await exerciseStudioDccCatalogFeature("DRW-001");
    expect(drw.evidence.sampleCount).toBeGreaterThan(0);
    expect(drw.evidence.pathLength).toBeGreaterThan(0);
    const pub = await exerciseStudioDccCatalogFeature("PUB-001");
    expect(pub.evidence.fileCount).toBeGreaterThan(0);
    const mod = await exerciseStudioDccCatalogFeature("MOD-018");
    expect(mod.evidence.facesAfter).toBeDefined();
    const cad = await exerciseStudioDccCatalogFeature("CAD-005");
    expect(Number(cad.evidence.extrudeTris)).toBeGreaterThan(0);
  });

  it("rejects unknown IDs instead of inventing hash evidence", async () => {
    await expect(exerciseStudioDccCatalogFeature("ZZZ-999")).rejects.toThrow(/unknown catalog id/);
  });

  it("honesty: no typeof-only stubs; every shipped apis[0] is called; evidence has numbers", async () => {
    const coreSrc = readFileSync(
      resolve(__dirname, "studio-dcc-section6-core-runners.ts"),
      "utf8",
    );
    const domainSrc = readFileSync(
      resolve(__dirname, "studio-dcc-section6-domain-kernels.ts"),
      "utf8",
    );
    const liteSrc = readFileSync(
      resolve(__dirname, "studio-dcc-section6-lite-ops.ts"),
      "utf8",
    );
    const domainOpsSrc = readFileSync(
      resolve(__dirname, "studio-dcc-domain-ops.ts"),
      "utf8",
    );
    const dispatchSrc = readFileSync(
      resolve(__dirname, "studio-dcc-catalog-feature-dispatch.ts"),
      "utf8",
    );
    const cadSrc = readFileSync(resolve(__dirname, "../studio-cad-kernel-lite.ts"), "utf8");
    const meshOpsSrc = readFileSync(resolve(__dirname, "../studio-mesh-ops-advanced.ts"), "utf8");
    const matSrc = readFileSync(
      resolve(__dirname, "studio-dcc-material-publish-draw-lite.ts"),
      "utf8",
    );
    const rhinoSrc = readFileSync(resolve(__dirname, "../studio-rhino3dm-lite.ts"), "utf8");
    const bimSrc = readFileSync(resolve(__dirname, "../studio-bim-room-builder-map.ts"), "utf8");
    const occtSrc = readFileSync(resolve(__dirname, "../studio-occt-wasm-facade.ts"), "utf8");
    const combined = [
      coreSrc,
      domainSrc,
      domainOpsSrc,
      liteSrc,
      dispatchSrc,
      cadSrc,
      meshOpsSrc,
      matSrc,
      rhinoSrc,
      bimSrc,
      occtSrc,
    ].join("\n");
    // Structural ban on presence-only theater
    expect(combined).not.toMatch(/typeof\s+\w+\s*===\s*["']function["']/u);
    const typeofOnlyHits = [...combined.matchAll(/api:\s*typeof\s+/gu)];
    expect(typeofOnlyHits).toEqual([]);

    /** Doc 구현·완료 기준 → required evidence keys (skeptic residual set). */
    const DOC_CRITERIA_EVIDENCE: Readonly<Record<string, readonly string[]>> = {
      "DOC-009": ["mergedHash", "parentCount", "mergeStrategy", "mergeRev", "conflict"],
      "MOD-014": ["ok", "faces", "facesBefore", "backend", "tris", "solidViable"],
      "CHR-012": ["ok", "missing", "mapped", "scale", "source", "target"],
      "CAD-006": ["sweepTris", "loftTris", "pathSamples", "failedSections"],
      "CAD-008": [
        "shellVolume",
        "thickness",
        "draftDeg",
        "failureFaces",
        "largeShellVolume",
        "largeThickness",
      ],
      "CAD-010": ["originX", "originY", "originZ", "orthogonal", "frameHash"],
      "CAD-012": ["mateCount", "locked", "kinds"],
      "CAD-015": ["exportBytes", "importMeshes", "importPoints", "exportPoints"],
      "CAD-016": [
        "layers",
        "curves",
        "curvePoints",
        "binaryBytes",
        "format",
        "chunkCount",
        "bodyMeshes",
        "bodyVerts",
        "bodyFaces",
        "nurbsSamples",
        "nurbsTangents",
        "backend",
      ],
      "CAD-018": [
        "wallCount",
        "pointCount",
        "meshes",
        "bodyTriangleCount",
        "meshTriangleCount",
        "polyloopCount",
        "webIfcVertices",
        "buildingCount",
        "cityScale",
        "backend",
      ],
      "CAD-019": [
        "parts",
        "walls",
        "totalWallLength",
        "openingArea",
        "wallPartsWithPose",
        "wallVolume",
        "roomWidth",
        "roomDepth",
      ],
      "SCP-006": [
        "facesBefore",
        "facesAfterRefine",
        "affectedRefine",
        "boundaryBefore",
        "boundaryAfterRefine",
        "boundaryAfterCoarsen",
        "facesAfterCoarsen",
      ],
      "SCP-011": ["targetFaces", "guideSamples", "meanError", "errorMapLen", "symmetryX"],
      "SCP-014": [
        "resolution",
        "paddingPx",
        "texelCount",
        "coveredTexels",
        "meanNormalLength",
        "meanAoLinear",
        "meanCurvature",
        "distinctFaceIds",
      ],
      "CHR-020": ["jsonBytes", "humanoidMapped", "documentHash", "hasAsset"],
      "GAR-009": ["weights", "weightSumError", "influencesPerVert", "skinHash"],
      "NPR-002": ["edges", "creases", "silhouettes", "boundaries", "edgeHash"],
      "NPR-003": ["segments", "overlapPairs", "contactLength", "contactHash"],
      "DRW-007": ["parseOk", "width", "height", "exportBytes", "parseLosses", "exportLosses"],
    };

    // Domain-ops (former lite-ops) must not contain pure hardcoded return bodies for CAD-010
    expect(domainOpsSrc).not.toMatch(
      /createStudioCadDatumPlaneAxisCsys[\s\S]{0,200}planeNormalY:\s*1,\s*axisDirY:\s*1,\s*datums:\s*2/u,
    );
    // lite-ops must only re-export — no function bodies for domain ops
    expect(liteSrc).toMatch(/from\s+["']\.\/studio-dcc-domain-ops["']/u);
    expect(liteSrc).not.toMatch(/export function mergeStudioBinaryLockBranch/u);
    // CAD-008 must not hardcode thickness*2 >= 1 unit check
    expect(cadSrc).not.toMatch(/thickness\s*\*\s*2\s*>=\s*1/u);
    // SCP-006 coarsen must not drop every other triangle
    expect(meshOpsSrc).not.toMatch(/triNear\(t\)\s*&&\s*t\s*%\s*2\s*===\s*1/u);
    // SCP-006 refine must implement red-green promotion (not naive near-only 1→4)
    expect(meshOpsSrc).toMatch(/splitEdges/u);
    expect(meshOpsSrc).toMatch(/n\s*>=\s*2/u);
    // Industrial OCCT facade must load real WASM MakeBox in browser + node paths
    expect(occtSrc).toMatch(/BRepPrimAPI_MakeBox_1/u);
    expect(occtSrc).toMatch(/opencascade\.wasm/u);
    expect(occtSrc).toMatch(/loadBrowserOcctFactory|isBrowserEnvironment/u);
    expect(occtSrc).not.toMatch(/^import\s+fs\s+from\s+["']node:fs["']/mu);
    expect(occtSrc).not.toMatch(/^import\s+\{\s*createRequire/mu);

    const missingExportCall: string[] = [];
    const missingNumeric: string[] = [];
    const missingCriteria: string[] = [];
    const countEchoFails: string[] = [];
    for (const entry of STUDIO_DCC_SECTION6_CATALOG) {
      const primary = entry.apis[0]!;
      // Primary export must appear as a call site in sealed runner sources
      const callRe = new RegExp(`\\b${primary}\\s*\\(`, "u");
      if (
        !callRe.test(combined)
        && !domainOpsSrc.includes(`function ${primary}`)
        && !liteSrc.includes(`function ${primary}`)
      ) {
        missingExportCall.push(`${entry.id}:${primary}`);
      }
      // Domain-ops definitions count as sealed real APIs when SSOT points at them
      if (
        (entry.module.includes("domain-ops") || entry.module.includes("lite-ops"))
        && !domainOpsSrc.includes(`function ${primary}`)
        && !domainOpsSrc.includes(`export function ${primary}`)
      ) {
        missingExportCall.push(`${entry.id}:missing-domain-def:${primary}`);
      }
      // Runtime evidence must include a non-constant-looking numeric domain metric
      const r = await exerciseStudioDccCatalogFeature(entry.id);
      // Ban nested domain failure wrapped as catalog success
      if (r.evidence.ok === false) {
        countEchoFails.push(`${entry.id}:evidence.ok=false`);
      }
      if (
        ("faces" in r.evidence || "facesAfter" in r.evidence)
        && Number(r.evidence.faces ?? r.evidence.facesAfter ?? 0) === 0
        && entry.id.startsWith("MOD-")
      ) {
        countEchoFails.push(`${entry.id}:mesh-faces=0`);
      }
      const numericKeys = Object.entries(r.evidence).filter(
        ([, v]) => typeof v === "number" && Number.isFinite(v),
      );
      if (numericKeys.length === 0) {
        missingNumeric.push(entry.id);
      }
      // Domain-ops rows must produce ≥2 numeric fields AND at least one string hash/id field
      // (blocks pure count-echo of a single input number).
      if (entry.module.includes("domain-ops") || entry.module.includes("lite-ops")) {
        const stringKeys = Object.entries(r.evidence).filter(
          ([, v]) => typeof v === "string" && v.length > 0,
        );
        if (numericKeys.length < 2) {
          countEchoFails.push(`${entry.id}:domain-ops-need-2-numeric`);
        }
        if (stringKeys.length < 1 && !("conflict" in r.evidence) && !("orthogonal" in r.evidence)) {
          // allow boolean-only if also ≥3 numerics (geometry)
          if (numericKeys.length < 3) {
            countEchoFails.push(`${entry.id}:domain-ops-need-hash-or-bool-structure`);
          }
        }
      }
      const required = DOC_CRITERIA_EVIDENCE[entry.id];
      if (required) {
        for (const key of required) {
          if (!(key in r.evidence)) {
            missingCriteria.push(`${entry.id}:missing-evidence:${key}`);
          }
        }
        // Ban pure extrude-proxy theater for CAD-006 (must have sweep path samples)
        if (entry.id === "MOD-014") {
          expect(r.evidence.ok).toBe(true);
          expect(r.evidence.solidViable).toBe(true);
          // Non-degenerate solid: unit-cube difference is a closed shell (≥8 faces / ≥12 tris)
          expect(Number(r.evidence.faces)).toBeGreaterThanOrEqual(8);
          expect(Number(r.evidence.tris)).toBeGreaterThanOrEqual(12);
          expect(Number(r.evidence.facesBefore)).toBeGreaterThan(0);
          expect(Number(r.evidence.faces)).toBeGreaterThan(Number(r.evidence.facesBefore) / 2);
          expect(String(r.evidence.backend)).toMatch(/manifold|default|pure-convex/u);
        }
        if (entry.id === "CHR-012") {
          expect(r.evidence.ok).toBe(true);
          expect(Number(r.evidence.missing)).toBe(0);
          expect(Number(r.evidence.mapped)).toBeGreaterThan(0);
        }
        if (entry.id === "CAD-006") {
          expect(Number(r.evidence.pathSamples)).toBeGreaterThan(2);
          expect(Number(r.evidence.sweepTris)).toBeGreaterThan(0);
        }
        if (entry.id === "CAD-008") {
          expect(Number(r.evidence.largeShellVolume)).toBeGreaterThan(0);
          expect(Number(r.evidence.largeThickness)).toBe(0.6);
        }
        if (entry.id === "CAD-015") {
          expect(Number(r.evidence.exportBytes)).toBeGreaterThan(50);
          expect(Number(r.evidence.importPoints)).toBeGreaterThan(0);
        }
        if (entry.id === "DRW-007") {
          expect(r.evidence.parseOk).toBe(true);
          expect(Number(r.evidence.width)).toBe(64);
          expect(Number(r.evidence.exportBytes)).toBeGreaterThan(26);
        }
        if (entry.id === "SCP-006") {
          expect(Number(r.evidence.facesAfterRefine)).toBeGreaterThan(
            Number(r.evidence.facesBefore),
          );
          // Closed unit-cube fixture must enter refine with 0 boundary edges
          expect(Number(r.evidence.boundaryBefore)).toBe(0);
          // Crack-free refine: partial brush on closed input must stay watertight
          expect(Number(r.evidence.boundaryAfterRefine)).toBe(0);
          // Crack-free coarsen: boundary edges must not explode vs refine
          expect(Number(r.evidence.boundaryAfterCoarsen)).toBeLessThanOrEqual(
            Number(r.evidence.boundaryAfterRefine) + 2,
          );
          expect(Number(r.evidence.boundaryAfterCoarsen)).toBe(0);
          expect(Number(r.evidence.facesAfterCoarsen)).toBeLessThan(
            Number(r.evidence.facesAfterRefine),
          );
        }
        if (entry.id === "CAD-016") {
          expect(r.evidence.format).toBe("3dm-binary");
          expect(Number(r.evidence.binaryBytes)).toBeGreaterThan(32);
          expect(Number(r.evidence.curvePoints) + Number(r.evidence.layers)).toBeGreaterThan(1);
          expect(Number(r.evidence.bodyMeshes)).toBeGreaterThan(0);
          expect(Number(r.evidence.bodyVerts)).toBeGreaterThanOrEqual(3);
          expect(Number(r.evidence.bodyFaces)).toBeGreaterThan(0);
          // Full openNURBS: samples + tangents + surface suite
          expect(Number(r.evidence.nurbsSamples)).toBeGreaterThan(4);
          expect(Number(r.evidence.nurbsTangents)).toBeGreaterThan(4);
          expect(r.evidence.backend).toBe("rhino3dm-opennurbs");
          expect(Number(r.evidence.surfaceSuiteFaces ?? 0) + Number(r.evidence.rationalCircleSamples ?? 0)).toBeGreaterThan(8);
        }
        if (entry.id === "CAD-018") {
          expect(Number(r.evidence.meshTriangleCount) + Number(r.evidence.bodyTriangleCount)).toBeGreaterThan(0);
          // Industrial web-ifc multi-building city path
          expect(Number(r.evidence.webIfcVertices ?? 0)).toBeGreaterThan(0);
          expect(Number(r.evidence.buildingCount ?? 0)).toBeGreaterThanOrEqual(1);
          expect(r.evidence.backend).toBe("web-ifc");
          expect(r.evidence.cityScale).toBe(true);
          expect(r.evidence.geometryGrade === "A" || r.evidence.geometryGrade === "B").toBe(true);
        }
        if (entry.id === "CAD-019") {
          expect(Number(r.evidence.totalWallLength)).toBeGreaterThan(1);
          expect(Number(r.evidence.wallPartsWithPose)).toBeGreaterThan(0);
          expect(Number(r.evidence.wallVolume)).toBeGreaterThan(0);
          expect(Number(r.evidence.roomWidth)).toBeGreaterThan(0);
        }
        if (entry.id === "SCP-014") {
          expect(Number(r.evidence.coveredTexels)).toBeGreaterThan(4);
          expect(Number(r.evidence.meanNormalLength)).toBeGreaterThan(0.5);
          expect(Number(r.evidence.distinctFaceIds)).toBeGreaterThan(1);
          // Ban constant AO theater: linear mean must be in (0,1) from bent-normal
          expect(Number(r.evidence.meanAoLinear)).toBeGreaterThan(0.2);
          expect(Number(r.evidence.meanAoLinear)).toBeLessThan(0.95);
        }
        if (entry.id === "DOC-009") {
          expect(r.evidence.mergeStrategy === "lww-branch" || r.evidence.conflict === true).toBe(
            true,
          );
          expect(String(r.evidence.mergedHash).length).toBeGreaterThan(4);
        }
        if (entry.id === "NPR-002") {
          expect(Number(r.evidence.edges)).toBeGreaterThan(0);
          expect(String(r.evidence.edgeHash)).not.toBe("h00000000");
        }
        if (entry.id === "NPR-003") {
          expect(Number(r.evidence.overlapPairs)).toBeGreaterThan(0);
          expect(Number(r.evidence.contactLength)).toBeGreaterThan(0);
        }
        if (entry.id === "CHR-020") {
          expect(r.evidence.hasAsset).toBe(true);
          expect(Number(r.evidence.jsonBytes)).toBeGreaterThan(50);
        }
        if (entry.id === "GAR-009") {
          expect(Number(r.evidence.weightSumError)).toBeLessThan(1e-5);
          expect(Number(r.evidence.influencesPerVert)).toBeGreaterThan(0);
        }
        if (entry.id === "CAD-010") {
          expect(r.evidence.orthogonal).toBe(true);
          expect(Number(r.evidence.originX)).toBe(1);
          expect(String(r.evidence.frameHash).length).toBeGreaterThan(4);
        }
      }
    }
    expect(missingExportCall).toEqual([]);
    expect(missingNumeric).toEqual([]);
    expect(missingCriteria).toEqual([]);
    expect(countEchoFails).toEqual([]);
  });
});

describe("§6 P0/P1 DRW/MAT/PUB real lite kernels", () => {
  it("DRW-001 pressure brush latency budget", () => {
    const plan = planStudioPressureBrushStroke(
      [
        { x: 0, y: 0, pressure: 0.2, tMs: 0 },
        { x: 2, y: 1, pressure: 0.8, tMs: 4 },
        { x: 4, y: 2, pressure: 0.5, tMs: 8 },
      ],
      16,
    );
    expect(plan.sampleCount).toBe(3);
    expect(plan.pathLength).toBeGreaterThan(0);
    expect(plan.withinBudget).toBe(true);
    const lat = measureStudioBrushLatencyBudget(1000, 1012, 16);
    expect(lat.latencyMs).toBe(12);
    expect(lat.withinBudget).toBe(true);
    expect(studioSection6ById("DRW-001")?.priority).toBe("P0");
    expect(studioSection6ById("DRW-002")?.priority).toBe("P0");
  });

  it("DRW-002..006 layer/fill/ruler/panel/tone", () => {
    let stack = createStudioRasterVectorLayerStack([
      {
        id: "raster-1",
        kind: "raster",
        name: "Ink",
        visible: true,
        opacity: 1,
        blend: "normal",
        clipToBelow: false,
        maskId: null,
      },
      {
        id: "vec-1",
        kind: "vector",
        name: "Line",
        visible: true,
        opacity: 1,
        blend: "multiply",
        clipToBelow: true,
        maskId: null,
      },
    ]);
    stack = transformStudioLayer(stack, "raster-1", { x: 10, y: 20, scale: 1.5 });
    expect(stack.layers.find((l) => l.id === "raster-1")?.transform.x).toBe(10);

    const fill = fillStudioCloseGapRegion({
      width: 32,
      height: 32,
      seedX: 16,
      seedY: 16,
      gapPx: 3,
    });
    expect(fill.gapClosed).toBe(true);
    expect(fill.filledPixels).toBeGreaterThan(0);
    expect(bindStudioReferenceLayer(stack, "raster-1", "vec-1").ok).toBe(true);

    const ruler = createStudioPerspectiveRuler([{ x: 0, y: 0 }, { x: 100, y: 0 }], 15);
    const snapped = snapStudioRulerGuide(ruler, { x: 0, y: 0 }, { x: 10, y: 3 });
    expect(Number.isFinite(snapped.angleDeg)).toBe(true);

    const layout = createStudioPanelBalloonTextLayout({
      panels: [{ id: "p1", x: 0, y: 0, w: 100, h: 200 }],
      balloons: [{ id: "b1", panelId: "p1", text: "안녕" }],
    });
    expect(layout.panelCount).toBe(1);
    expect(layout.textChars).toBe(2);

    const tone = applyStudioToneFilterAdjustment({
      pixels: new Float32Array([0.1, 0.5, 0.9]),
      toneSteps: 3,
      contrast: 1.2,
    });
    expect(tone.toneSteps).toBe(3);
    expect(tone.pixels.length).toBe(3);

    const psd = reportStudioPsdPsbCompatibility({
      kind: "psd",
      layerCount: 12,
      hasSmartObjects: true,
    });
    expect(psd.grade).toBe("B");
    expect(psd.losses.length).toBeGreaterThan(0);
  });

  it("MAT-010/012 color management and hatch tone", () => {
    const cm = resolveStudioColorManagementProfile({ linear: true, icc: true, exr: true });
    expect(cm.workingSpace).toBe("linear-sRGB");
    expect(cm.exrPass).toBe(true);
    const hatch = createStudioToonHatchToneMaterial("hatch-1", {
      toneBands: 4,
      cameraScaleInvariant: true,
    });
    expect(hatch.model).toBe("toon-hatch-tone");
    expect(hatch.toneBands).toBe(4);
    const pbr = createStudioPbrMaterialLite("mat-1", { metallic: 0.2, roughness: 0.4 });
    expect(pbr.model).toBe("pbr-metallic-roughness");
  });

  it("PUB-001..003 publish package / platform / license report", () => {
    const pkg = buildStudioPublishPackageLite({
      images: ["page-1.png"],
      metadata: { title: "ep1" },
      fonts: ["NotoSans"],
      rights: ["CC-BY"],
      version: "1.2.0",
    });
    expect(pkg.format).toBe("toonspectrum.publish-package-lite");
    expect(pkg.fileCount).toBeGreaterThan(0);
    const preset = getStudioPublishPlatformPreset("webtoon");
    expect(preset).toBeTruthy();
    const report = buildStudioAssetLicenseReport([
      { id: "a1", license: "CC0-1.0", source: "studio" },
      { id: "a2", license: "unknown", source: "import" },
    ]);
    expect(report.assetCount).toBe(2);
    expect(report.unknownLicenseCount).toBe(1);
    const man = buildStudioPublishVersionManifest({
      documentId: "doc-1",
      version: "1.2.0",
      packageHash: "sha256:abc",
    });
    expect(man.kind).toBe("publish-version-manifest");
  });
});

describe("§6 gating catalog P0 includes DRW", () => {
  it("P0 required IDs from doc include DOC + NPR + SHT + DRW", () => {
    const p0 = STUDIO_DCC_SECTION6_CATALOG.filter((e) => e.priority === "P0").map((e) => e.id);
    for (const id of [
      "DOC-001",
      "DOC-002",
      "DOC-003",
      "DOC-004",
      "DOC-005",
      "DOC-006",
      "NPR-001",
      "SHT-001",
      "DRW-001",
      "DRW-002",
    ]) {
      expect(p0).toContain(id);
    }
    const p1 = STUDIO_DCC_SECTION6_CATALOG.filter((e) => e.priority === "P1").map((e) => e.id);
    for (const id of ["DRW-003", "DRW-004", "DRW-005", "DRW-006", "PUB-001", "PUB-002", "PUB-003", "MAT-010", "MAT-012"]) {
      expect(p1).toContain(id);
    }
  });
});
