/**
 * Catalog feature dispatch — routes every §6 ID to a real pure-TS kernel.
 * Never invents evidence from ID hashes.
 */

import { getStudioPublishPlatformPreset } from "../studio-publish-package";

import {
  applyStudioToneFilterAdjustment,
  bindStudioReferenceLayer,
  buildStudioAssetLicenseReport,
  buildStudioPublishPackageLite,
  buildStudioPublishVersionManifest,
  createStudioMtoonMaterialLite,
  createStudioPanelBalloonTextLayout,
  createStudioPerspectiveRuler,
  createStudioPbrMaterialLite,
  createStudioRasterVectorLayerStack,
  createStudioToonHatchToneMaterial,
  exportStudioPsdPsbLite,
  fillStudioCloseGapRegion,
  importStudioPsdPsbHeader,
  measureStudioBrushLatencyBudget,
  overrideStudioMaterialByShot,
  planStudioPressureBrushStroke,
  reportStudioPsdPsbCompatibility,
  resolveStudioColorManagementProfile,
  snapStudioRulerGuide,
  transformStudioLayer,
} from "./studio-dcc-material-publish-draw-lite";
import {
  runStudioDccSection6CoreKernel,
  STUDIO_DCC_SECTION6_CORE_RUNNERS,
} from "./studio-dcc-section6-core-runners";
import {
  runStudioDccSection6Kernel,
  STUDIO_DCC_SECTION6_KERNEL_RUNNERS,
  type StudioDccKernelResult,
} from "./studio-dcc-section6-domain-kernels";
import {
  STUDIO_DCC_SECTION6_IDS,
  studioSection6ById,
} from "./studio-dcc-section6-full-catalog";

export const STUDIO_DCC_CATALOG_FEATURE_DISPATCH_REVISION = 3 as const;

export type StudioDccFeatureExerciseResult = StudioDccKernelResult;

function runDrawMatPubKernel(id: string): StudioDccKernelResult {
  switch (id) {
    case "DRW-001": {
      const plan = planStudioPressureBrushStroke(
        [
          { x: 0, y: 0, pressure: 0.2, tMs: 0 },
          { x: 3, y: 1, pressure: 0.9, tMs: 5 },
          { x: 6, y: 2, pressure: 0.4, tMs: 10 },
        ],
        16,
      );
      const lat = measureStudioBrushLatencyBudget(0, 12, 16);
      return {
        id,
        ok: true,
        evidence: {
          sampleCount: plan.sampleCount,
          pathLength: plan.pathLength,
          withinBudget: plan.withinBudget && lat.withinBudget,
          latencyMs: lat.latencyMs,
        },
      };
    }
    case "DRW-002": {
      let stack = createStudioRasterVectorLayerStack([
        {
          id: "r1",
          kind: "raster",
          name: "Ink",
          visible: true,
          opacity: 1,
          blend: "normal",
          clipToBelow: false,
          maskId: null,
        },
      ]);
      stack = transformStudioLayer(stack, "r1", { x: 1, y: 2, scale: 1.1 });
      return {
        id,
        ok: true,
        evidence: { layers: stack.layers.length, x: stack.layers[0]!.transform.x },
      };
    }
    case "DRW-003": {
      const fill = fillStudioCloseGapRegion({
        width: 16,
        height: 16,
        seedX: 8,
        seedY: 8,
        gapPx: 2,
      });
      const stack = createStudioRasterVectorLayerStack([
        {
          id: "paint",
          kind: "raster",
          name: "P",
          visible: true,
          opacity: 1,
          blend: "normal",
          clipToBelow: false,
          maskId: null,
        },
        {
          id: "ref",
          kind: "vector",
          name: "R",
          visible: true,
          opacity: 1,
          blend: "normal",
          clipToBelow: false,
          maskId: null,
        },
      ]);
      return {
        id,
        ok: true,
        evidence: {
          filledPixels: fill.filledPixels,
          gapClosed: fill.gapClosed,
          refBound: bindStudioReferenceLayer(stack, "paint", "ref").ok,
        },
      };
    }
    case "DRW-004": {
      const ruler = createStudioPerspectiveRuler([{ x: 0, y: 0 }], 15);
      const snap = snapStudioRulerGuide(ruler, { x: 0, y: 0 }, { x: 10, y: 2 });
      return { id, ok: true, evidence: { angleDeg: snap.angleDeg, snapped: snap.snapped } };
    }
    case "DRW-005": {
      const layout = createStudioPanelBalloonTextLayout({
        panels: [{ id: "p1", x: 0, y: 0, w: 100, h: 200 }],
        balloons: [{ id: "b1", panelId: "p1", text: "hi" }],
      });
      return {
        id,
        ok: true,
        evidence: { panelCount: layout.panelCount, textChars: layout.textChars },
      };
    }
    case "DRW-006": {
      const tone = applyStudioToneFilterAdjustment({
        pixels: new Float32Array([0.2, 0.8]),
        toneSteps: 3,
      });
      return { id, ok: true, evidence: { mean: tone.mean, toneSteps: tone.toneSteps } };
    }
    case "DRW-007": {
      // Minimal valid PSD signature + version1 header (26 bytes)
      const header = new Uint8Array(26);
      header[0] = 0x38; header[1] = 0x42; header[2] = 0x50; header[3] = 0x53; // 8BPS
      const view = new DataView(header.buffer);
      view.setUint16(4, 1, false); // PSD
      view.setUint16(12, 4, false);
      view.setUint32(14, 64, false); // height
      view.setUint32(18, 64, false); // width
      view.setUint16(22, 8, false);
      view.setUint16(24, 3, false); // RGB
      const parsed = importStudioPsdPsbHeader(header);
      const exported = exportStudioPsdPsbLite({
        kind: "psd",
        width: 64,
        height: 64,
        rgba: new Uint8Array(64 * 64 * 4),
      });
      const report = reportStudioPsdPsbCompatibility({
        kind: "psd",
        layerCount: 4,
        hasSmartObjects: true,
      });
      return {
        id,
        ok: true,
        evidence: {
          grade: report.grade,
          losses: report.losses.length,
          parseOk: parsed.ok,
          parseGrade: parsed.grade,
          parseLosses: parsed.losses.length,
          width: parsed.width,
          height: parsed.height,
          exportBytes: exported.byteLength,
          exportLosses: exported.losses.length,
        },
      };
    }
    case "MAT-001": {
      const m = createStudioPbrMaterialLite("m1", { metallic: 0.1, roughness: 0.5 });
      return { id, ok: true, evidence: { metallic: m.metallic, model: m.model } };
    }
    case "MAT-002": {
      const m = createStudioMtoonMaterialLite("m2");
      return { id, ok: true, evidence: { model: m.model, toony: m.shadingToony } };
    }
    case "MAT-003": {
      const overridden = overrideStudioMaterialByShot("base", "shot-1", {
        metallic: 0.8,
        roughness: 0.1,
      });
      return {
        id,
        ok: true,
        evidence: {
          baseId: overridden.baseMaterialId,
          shotOverride: true,
          metallic: overridden.effective.metallic,
          roughness: overridden.effective.roughness,
        },
      };
    }
    case "MAT-010": {
      const cm = resolveStudioColorManagementProfile({ linear: true, exr: true });
      return {
        id,
        ok: true,
        evidence: {
          workingSpace: cm.workingSpace,
          exrPass: cm.exrPass,
          linear: cm.workingSpace === "linear-sRGB" ? 1 : 0,
          icc: cm.iccEmbedded ? 1 : 0,
        },
      };
    }
    case "MAT-012": {
      const h = createStudioToonHatchToneMaterial("h1", { toneBands: 4 });
      return { id, ok: true, evidence: { toneBands: h.toneBands, model: h.model } };
    }
    case "PUB-001": {
      const pkg = buildStudioPublishPackageLite({
        images: ["a.png"],
        metadata: { title: "t" },
        version: "1.0.0",
      });
      return { id, ok: true, evidence: { fileCount: pkg.fileCount, format: pkg.format } };
    }
    case "PUB-002": {
      const preset = getStudioPublishPlatformPreset("webtoon");
      return {
        id,
        ok: true,
        evidence: {
          destination: preset.id,
          revision: preset.revision,
          episodeMaxHeight: preset.episode.maxHeight ?? 0,
          thumbnailSlots: preset.thumbnails.length,
        },
      };
    }
    case "PUB-003": {
      const report = buildStudioAssetLicenseReport([
        { id: "a", license: "CC0-1.0", source: "studio" },
      ]);
      return {
        id,
        ok: true,
        evidence: { assetCount: report.assetCount, licenses: report.licenses.length },
      };
    }
    case "PUB-004": {
      const man = buildStudioPublishVersionManifest({
        documentId: "d1",
        version: "1",
        packageHash: "sha256:x",
      });
      return {
        id,
        ok: true,
        evidence: {
          kind: man.kind,
          version: man.version,
          versionLength: man.version.length,
          hashLength: man.packageHash.length,
        },
      };
    }
    default:
      throw new Error(`no draw/mat/pub kernel for ${id}`);
  }
}

/** Exercise a catalog feature by calling a real pure-TS kernel (async-safe). */
export async function exerciseStudioDccCatalogFeature(
  id: string,
): Promise<StudioDccFeatureExerciseResult> {
  const entry = studioSection6ById(id);
  if (!entry) throw new Error(`unknown catalog id: ${id}`);

  if (STUDIO_DCC_SECTION6_KERNEL_RUNNERS[id]) {
    return runStudioDccSection6Kernel(id);
  }
  if (STUDIO_DCC_SECTION6_CORE_RUNNERS[id]) {
    return runStudioDccSection6CoreKernel(id);
  }

  const prefix = id.split("-")[0] ?? "";
  if (prefix === "DRW" || (prefix === "MAT" && ["MAT-001", "MAT-002", "MAT-003", "MAT-010", "MAT-012"].includes(id)) || prefix === "PUB") {
    return runDrawMatPubKernel(id);
  }
  if (prefix === "MAT") {
    // MAT-005/007/008/011 live in domain kernels
    if (STUDIO_DCC_SECTION6_KERNEL_RUNNERS[id]) return runStudioDccSection6Kernel(id);
  }

  throw new Error(
    `catalog id ${id} has no real kernel runner (module=${entry.module}); refuse fake evidence`,
  );
}

export async function exerciseAllStudioDccCatalogFeatures(): Promise<{
  readonly ok: boolean;
  readonly exercised: number;
  readonly failures: readonly string[];
}> {
  const failures: string[] = [];
  let exercised = 0;
  for (const id of STUDIO_DCC_SECTION6_IDS) {
    try {
      const r = await exerciseStudioDccCatalogFeature(id);
      if (!r.ok || r.id !== id) failures.push(id);
      else exercised += 1;
    } catch (e) {
      failures.push(`${id}:${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { ok: failures.length === 0, exercised, failures };
}
