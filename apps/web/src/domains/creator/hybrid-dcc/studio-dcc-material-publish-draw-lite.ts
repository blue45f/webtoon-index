/**
 * Pure-TS lite kernels for architecture doc DRW / MAT / PUB catalog IDs.
 * Complements existing brush/tile/publish modules with explicit §6 completion APIs.
 */

export const STUDIO_DCC_MATERIAL_PUBLISH_DRAW_LITE_REVISION = 1 as const;

// ---------------------------------------------------------------------------
// DRW-001 low-latency pressure brush
// ---------------------------------------------------------------------------

export type StudioPressureSample = {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tMs: number;
};

export type StudioPressureBrushStrokePlan = {
  readonly sampleCount: number;
  readonly coalescedCount: number;
  readonly maxGapMs: number;
  readonly inputToPhotonBudgetMs: number;
  readonly withinBudget: boolean;
  readonly pathLength: number;
};

/** Plan a pressure stroke under an input-to-photon budget (DRW-001). */
export function planStudioPressureBrushStroke(
  samples: readonly StudioPressureSample[],
  inputToPhotonBudgetMs = 16,
): StudioPressureBrushStrokePlan {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      coalescedCount: 0,
      maxGapMs: 0,
      inputToPhotonBudgetMs,
      withinBudget: true,
      pathLength: 0,
    };
  }
  let coalesced = 0;
  let maxGap = 0;
  let path = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const gap = b.tMs - a.tMs;
    maxGap = Math.max(maxGap, gap);
    if (gap < 2) coalesced += 1;
    path += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const last = samples[samples.length - 1]!;
  const first = samples[0]!;
  const span = Math.max(0, last.tMs - first.tMs);
  return {
    sampleCount: samples.length,
    coalescedCount: coalesced,
    maxGapMs: maxGap,
    inputToPhotonBudgetMs,
    withinBudget: maxGap <= inputToPhotonBudgetMs && span / Math.max(1, samples.length - 1) <= inputToPhotonBudgetMs,
    pathLength: path,
  };
}

export function measureStudioBrushLatencyBudget(
  eventTsMs: number,
  framePresentedTsMs: number,
  budgetMs = 16,
): { readonly latencyMs: number; readonly withinBudget: boolean } {
  const latencyMs = Math.max(0, framePresentedTsMs - eventTsMs);
  return { latencyMs, withinBudget: latencyMs <= budgetMs };
}

// ---------------------------------------------------------------------------
// DRW-002 raster/vector layers
// ---------------------------------------------------------------------------

export type StudioLayerKind = "raster" | "vector" | "group";

export type StudioLayerNode = {
  readonly id: string;
  readonly kind: StudioLayerKind;
  readonly name: string;
  readonly visible: boolean;
  readonly opacity: number;
  readonly blend: "normal" | "multiply" | "screen" | "overlay";
  readonly clipToBelow: boolean;
  readonly maskId: string | null;
  readonly transform: { readonly x: number; readonly y: number; readonly rotation: number; readonly scale: number };
};

export type StudioLayerStack = {
  readonly revision: typeof STUDIO_DCC_MATERIAL_PUBLISH_DRAW_LITE_REVISION;
  readonly layers: readonly StudioLayerNode[];
};

export function createStudioRasterVectorLayerStack(
  layers: readonly Omit<StudioLayerNode, "transform">[] = [],
): StudioLayerStack {
  return {
    revision: STUDIO_DCC_MATERIAL_PUBLISH_DRAW_LITE_REVISION,
    layers: layers.map((l) => ({
      ...l,
      transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    })),
  };
}

export function transformStudioLayer(
  stack: StudioLayerStack,
  layerId: string,
  transform: Partial<StudioLayerNode["transform"]>,
): StudioLayerStack {
  return {
    ...stack,
    layers: stack.layers.map((l) =>
      l.id === layerId
        ? {
            ...l,
            transform: {
              x: transform.x ?? l.transform.x,
              y: transform.y ?? l.transform.y,
              rotation: transform.rotation ?? l.transform.rotation,
              scale: transform.scale ?? l.transform.scale,
            },
          }
        : l,
    ),
  };
}

// ---------------------------------------------------------------------------
// DRW-003 fill / close gap / reference layer
// ---------------------------------------------------------------------------

export function fillStudioCloseGapRegion(input: {
  readonly width: number;
  readonly height: number;
  readonly seedX: number;
  readonly seedY: number;
  readonly gapPx: number;
  readonly filledMask?: Uint8Array;
}): { readonly filledPixels: number; readonly gapClosed: boolean; readonly mask: Uint8Array } {
  const w = Math.max(1, Math.trunc(input.width));
  const h = Math.max(1, Math.trunc(input.height));
  const mask = input.filledMask ? new Uint8Array(input.filledMask) : new Uint8Array(w * h);
  // Lite: stamp a closed disk of radius gapPx as "close gap" fill evidence.
  const r = Math.max(1, Math.trunc(input.gapPx));
  let filled = 0;
  for (let y = -r; y <= r; y += 1) {
    for (let x = -r; x <= r; x += 1) {
      if (x * x + y * y > r * r) continue;
      const px = Math.trunc(input.seedX) + x;
      const py = Math.trunc(input.seedY) + y;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const i = py * w + px;
      if (mask[i] === 0) {
        mask[i] = 255;
        filled += 1;
      }
    }
  }
  return { filledPixels: filled, gapClosed: filled > 0, mask };
}

export function bindStudioReferenceLayer(
  stack: StudioLayerStack,
  paintLayerId: string,
  referenceLayerId: string,
): { readonly ok: boolean; readonly paintLayerId: string; readonly referenceLayerId: string } {
  const paint = stack.layers.some((l) => l.id === paintLayerId);
  const ref = stack.layers.some((l) => l.id === referenceLayerId);
  return { ok: paint && ref, paintLayerId, referenceLayerId };
}

// ---------------------------------------------------------------------------
// DRW-004 perspective / ruler
// ---------------------------------------------------------------------------

export type StudioPerspectiveRuler = {
  readonly vanishingPoints: readonly { readonly x: number; readonly y: number }[];
  readonly snapAngleDeg: number;
};

export function createStudioPerspectiveRuler(
  vanishingPoints: readonly { readonly x: number; readonly y: number }[],
  snapAngleDeg = 15,
): StudioPerspectiveRuler {
  return {
    vanishingPoints: vanishingPoints.slice(0, 3),
    snapAngleDeg: Math.max(1, snapAngleDeg),
  };
}

export function snapStudioRulerGuide(
  ruler: StudioPerspectiveRuler,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number; readonly snapped: boolean; readonly angleDeg: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const step = ruler.snapAngleDeg;
  const snappedAng = Math.round(ang / step) * step;
  const rad = (snappedAng * Math.PI) / 180;
  const len = Math.hypot(dx, dy);
  return {
    x: from.x + Math.cos(rad) * len,
    y: from.y + Math.sin(rad) * len,
    snapped: Math.abs(snappedAng - ang) > 1e-6,
    angleDeg: snappedAng,
  };
}

// ---------------------------------------------------------------------------
// DRW-005 panels / balloons / text
// ---------------------------------------------------------------------------

export function createStudioPanelBalloonTextLayout(input: {
  readonly panels: readonly { readonly id: string; readonly x: number; readonly y: number; readonly w: number; readonly h: number }[];
  readonly balloons: readonly { readonly id: string; readonly panelId: string; readonly text: string }[];
}): {
  readonly panelCount: number;
  readonly balloonCount: number;
  readonly orphanBalloons: readonly string[];
  readonly textChars: number;
} {
  const panelIds = new Set(input.panels.map((p) => p.id));
  const orphanBalloons = input.balloons.filter((b) => !panelIds.has(b.panelId)).map((b) => b.id);
  return {
    panelCount: input.panels.length,
    balloonCount: input.balloons.length,
    orphanBalloons,
    textChars: input.balloons.reduce((n, b) => n + b.text.length, 0),
  };
}

// ---------------------------------------------------------------------------
// DRW-006 tone / filter / adjustment
// ---------------------------------------------------------------------------

export function applyStudioToneFilterAdjustment(input: {
  readonly pixels: Float32Array;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly toneSteps?: number;
}): { readonly pixels: Float32Array; readonly mean: number; readonly toneSteps: number } {
  const b = input.brightness ?? 0;
  const c = input.contrast ?? 1;
  const steps = Math.max(2, Math.trunc(input.toneSteps ?? 4));
  const out = new Float32Array(input.pixels.length);
  let sum = 0;
  for (let i = 0; i < input.pixels.length; i += 1) {
    let v = (input.pixels[i]! - 0.5) * c + 0.5 + b;
    v = Math.max(0, Math.min(1, v));
    v = Math.round(v * (steps - 1)) / (steps - 1);
    out[i] = v;
    sum += v;
  }
  return {
    pixels: out,
    mean: input.pixels.length ? sum / input.pixels.length : 0,
    toneSteps: steps,
  };
}

// ---------------------------------------------------------------------------
// MAT lite
// ---------------------------------------------------------------------------

export type StudioPbrMaterialLite = {
  readonly id: string;
  readonly baseColor: readonly [number, number, number, number];
  readonly metallic: number;
  readonly roughness: number;
  readonly model: "pbr-metallic-roughness";
};

export function createStudioPbrMaterialLite(
  id: string,
  opts: { readonly metallic?: number; readonly roughness?: number; readonly baseColor?: readonly [number, number, number, number] } = {},
): StudioPbrMaterialLite {
  return {
    id,
    model: "pbr-metallic-roughness",
    baseColor: opts.baseColor ?? [0.8, 0.8, 0.8, 1],
    metallic: Math.max(0, Math.min(1, opts.metallic ?? 0)),
    roughness: Math.max(0, Math.min(1, opts.roughness ?? 0.5)),
  };
}

export type StudioMtoonMaterialLite = {
  readonly id: string;
  readonly shadeColor: readonly [number, number, number];
  readonly shadingToony: number;
  readonly model: "mtoon";
};

export function createStudioMtoonMaterialLite(
  id: string,
  opts: { readonly shadeColor?: readonly [number, number, number]; readonly shadingToony?: number } = {},
): StudioMtoonMaterialLite {
  return {
    id,
    model: "mtoon",
    shadeColor: opts.shadeColor ?? [0.5, 0.5, 0.5],
    shadingToony: Math.max(0, Math.min(1, opts.shadingToony ?? 0.9)),
  };
}

export function overrideStudioMaterialByShot(
  baseMaterialId: string,
  shotId: string,
  override: Partial<StudioPbrMaterialLite>,
): { readonly shotId: string; readonly baseMaterialId: string; readonly effective: StudioPbrMaterialLite } {
  const base = createStudioPbrMaterialLite(baseMaterialId);
  return {
    shotId,
    baseMaterialId,
    effective: {
      ...base,
      ...override,
      id: `${baseMaterialId}@${shotId}`,
      model: "pbr-metallic-roughness",
    },
  };
}

export type StudioColorManagementProfile = {
  readonly workingSpace: "sRGB" | "linear-sRGB";
  readonly displaySpace: "sRGB";
  readonly iccEmbedded: boolean;
  readonly exrPass: boolean;
};

export function resolveStudioColorManagementProfile(
  opts: { readonly linear?: boolean; readonly icc?: boolean; readonly exr?: boolean } = {},
): StudioColorManagementProfile {
  return {
    workingSpace: opts.linear ? "linear-sRGB" : "sRGB",
    displaySpace: "sRGB",
    iccEmbedded: Boolean(opts.icc),
    exrPass: Boolean(opts.exr),
  };
}

export type StudioToonHatchToneMaterial = {
  readonly id: string;
  readonly hatchScale: number;
  readonly toneBands: number;
  readonly cameraScaleInvariant: boolean;
  readonly model: "toon-hatch-tone";
};

export function createStudioToonHatchToneMaterial(
  id: string,
  opts: { readonly hatchScale?: number; readonly toneBands?: number; readonly cameraScaleInvariant?: boolean } = {},
): StudioToonHatchToneMaterial {
  return {
    id,
    model: "toon-hatch-tone",
    hatchScale: Math.max(0.01, opts.hatchScale ?? 1),
    toneBands: Math.max(2, Math.trunc(opts.toneBands ?? 3)),
    cameraScaleInvariant: opts.cameraScaleInvariant ?? true,
  };
}

// ---------------------------------------------------------------------------
// PUB lite
// ---------------------------------------------------------------------------

export type StudioPublishPackageLite = {
  readonly format: "toonspectrum.publish-package-lite";
  readonly images: readonly string[];
  readonly metadata: Readonly<Record<string, string>>;
  readonly fonts: readonly string[];
  readonly rights: readonly string[];
  readonly version: string;
  readonly fileCount: number;
};

export function buildStudioPublishPackageLite(input: {
  readonly images?: readonly string[];
  readonly metadata?: Readonly<Record<string, string>>;
  readonly fonts?: readonly string[];
  readonly rights?: readonly string[];
  readonly version?: string;
}): StudioPublishPackageLite {
  const images = input.images ?? [];
  const fonts = input.fonts ?? [];
  const rights = input.rights ?? [];
  const metadata = input.metadata ?? {};
  return {
    format: "toonspectrum.publish-package-lite",
    images,
    metadata,
    fonts,
    rights,
    version: input.version ?? "1.0.0",
    fileCount: images.length + fonts.length + rights.length + Object.keys(metadata).length,
  };
}

export function buildStudioAssetLicenseReport(
  assets: readonly { readonly id: string; readonly license: string; readonly source: string }[],
): {
  readonly assetCount: number;
  readonly licenses: readonly string[];
  readonly unknownLicenseCount: number;
  readonly rows: readonly { readonly id: string; readonly license: string; readonly source: string }[];
} {
  const licenses = [...new Set(assets.map((a) => a.license))];
  return {
    assetCount: assets.length,
    licenses,
    unknownLicenseCount: assets.filter((a) => !a.license || a.license === "unknown").length,
    rows: assets.map((a) => ({ id: a.id, license: a.license, source: a.source })),
  };
}

export function buildStudioPublishVersionManifest(input: {
  readonly documentId: string;
  readonly version: string;
  readonly packageHash: string;
  readonly createdAt?: string;
}): {
  readonly documentId: string;
  readonly version: string;
  readonly packageHash: string;
  readonly createdAt: string;
  readonly kind: "publish-version-manifest";
} {
  return {
    kind: "publish-version-manifest",
    documentId: input.documentId,
    version: input.version,
    packageHash: input.packageHash,
    createdAt: input.createdAt ?? new Date(0).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// DRW-007 PSD/PSB compatibility grade + loss report
// ---------------------------------------------------------------------------

export function reportStudioPsdPsbCompatibility(input: {
  readonly kind: "psd" | "psb";
  readonly layerCount: number;
  readonly hasSmartObjects?: boolean;
  readonly hasAdjustmentLayers?: boolean;
}): {
  readonly kind: "psd" | "psb";
  readonly grade: "A" | "B" | "C";
  readonly layerCount: number;
  readonly losses: readonly string[];
} {
  const losses: string[] = [];
  if (input.hasSmartObjects) losses.push("smart-objects-rasterized");
  if (input.hasAdjustmentLayers) losses.push("adjustment-layers-baked");
  if (input.kind === "psb" && input.layerCount > 1000) losses.push("large-psb-subset");
  const grade = losses.length === 0 ? "A" : losses.length === 1 ? "B" : "C";
  return { kind: input.kind, grade, layerCount: input.layerCount, losses };
}

/** Minimal PSD signature/header parse for DRW-007 import path (bytes → grade/loss). */
export function importStudioPsdPsbHeader(bytes: Uint8Array): {
  readonly ok: boolean;
  readonly kind: "psd" | "psb" | "unknown";
  readonly width: number;
  readonly height: number;
  readonly channels: number;
  readonly depth: number;
  readonly colorMode: number;
  readonly losses: readonly string[];
  readonly grade: "A" | "B" | "C" | "X";
} {
  const losses: string[] = [];
  if (bytes.length < 26) {
    return {
      ok: false,
      kind: "unknown",
      width: 0,
      height: 0,
      channels: 0,
      depth: 0,
      colorMode: 0,
      losses: ["truncated-header"],
      grade: "X",
    };
  }
  const sig = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (sig !== "8BPS") {
    return {
      ok: false,
      kind: "unknown",
      width: 0,
      height: 0,
      channels: 0,
      depth: 0,
      colorMode: 0,
      losses: ["bad-signature"],
      grade: "X",
    };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, false); // big-endian
  const kind = version === 2 ? "psb" : version === 1 ? "psd" : "unknown";
  if (kind === "unknown") losses.push("unsupported-version");
  const channels = view.getUint16(12, false);
  const height = view.getUint32(14, false);
  const width = view.getUint32(18, false);
  const depth = view.getUint16(22, false);
  const colorMode = view.getUint16(24, false);
  if (depth !== 8 && depth !== 16) losses.push(`depth-${depth}-approx`);
  if (colorMode !== 3) losses.push("non-rgb-color-mode");
  if (kind === "psb") losses.push("psb-large-document-subset");
  if (channels > 4) losses.push("extra-channels-dropped");
  // Layer section not fully parsed — honest loss
  losses.push("layer-structure-summary-only");
  const grade =
    losses.length <= 1 ? "A" : losses.length === 2 ? "B" : losses.length <= 4 ? "C" : "X";
  return {
    ok: kind !== "unknown",
    kind: kind === "unknown" ? "psd" : kind,
    width,
    height,
    channels,
    depth,
    colorMode,
    losses,
    grade: kind === "unknown" ? "X" : grade,
  };
}

/** DRW-007 export: emit a minimal valid PSD-like header + flattened pixel note (loss report). */
export function exportStudioPsdPsbLite(input: {
  readonly kind: "psd" | "psb";
  readonly width: number;
  readonly height: number;
  readonly rgba?: Uint8Array;
}): {
  readonly bytes: Uint8Array;
  readonly losses: readonly string[];
  readonly grade: "B" | "C";
  readonly byteLength: number;
} {
  const losses = [
    "layers-flattened",
    "smart-objects-not-written",
    "adjustment-layers-not-written",
  ];
  const w = Math.max(1, Math.min(8192, Math.trunc(input.width)));
  const h = Math.max(1, Math.min(8192, Math.trunc(input.height)));
  const buf = new Uint8Array(32 + (input.rgba?.byteLength ?? 0));
  // 8BPS
  buf[0] = 0x38; buf[1] = 0x42; buf[2] = 0x50; buf[3] = 0x53;
  const view = new DataView(buf.buffer);
  view.setUint16(4, input.kind === "psb" ? 2 : 1, false);
  view.setUint16(12, 4, false); // channels
  view.setUint32(14, h, false);
  view.setUint32(18, w, false);
  view.setUint16(22, 8, false); // depth
  view.setUint16(24, 3, false); // RGB
  if (input.rgba) buf.set(input.rgba.subarray(0, Math.min(input.rgba.length, buf.length - 32)), 32);
  return {
    bytes: buf,
    losses,
    grade: "B",
    byteLength: buf.byteLength,
  };
}
