
import {
  resolveStudioHokusaiProductLiveAdmission,
  type StudioHokusaiProductLivePresetId,
} from "./brush/studio-brush-backend-quality-policy";
import { studioLivingInkAdmitsBrush } from "./studio-living-ink-brush-admission";
import { loadStudioPixelEditBrushRuntime } from "./studio-page-editor-runtime-loaders";

import type { StudioHokusaiLiveSampleLike } from "./render/studio-hokusai-live-brush-protocol";
import type { DrawEl, El } from "./studio-element-model";
import type { StudioLivingInkAuthoritativeSample } from "./studio-living-ink-studio-coordinator";


import { isStudioInkInputContractV2 } from "@/shared/lib/studio-ink-input-contract";

type StudioUiPreferencesSqliteModule =
  typeof import("./studio-ui-preferences-sqlite");

type StudioWatermarkPreferencesSqliteModule =
  typeof import("./studio-watermark-preferences-sqlite");

let studioUiPreferencesSqliteModulePromise:
  | Promise<StudioUiPreferencesSqliteModule>
  | null = null;
let studioWatermarkPreferencesSqliteModulePromise:
  | Promise<StudioWatermarkPreferencesSqliteModule>
  | null = null;

export function loadStudioUiPreferencesSqliteModule():
  Promise<StudioUiPreferencesSqliteModule> {
  studioUiPreferencesSqliteModulePromise ??= import("./studio-ui-preferences-sqlite");
  studioUiPreferencesSqliteModulePromise.catch(() => {
    studioUiPreferencesSqliteModulePromise = null;
  });
  return studioUiPreferencesSqliteModulePromise;
}

export async function acquireProductStudioUiPreferencesRepository() {
  const module = await loadStudioUiPreferencesSqliteModule();
  return module.acquireProductStudioUiPreferencesRepository();
}

export function loadStudioWatermarkPreferencesSqliteModule():
  Promise<StudioWatermarkPreferencesSqliteModule> {
  studioWatermarkPreferencesSqliteModulePromise ??= import("./studio-watermark-preferences-sqlite"
  );
  studioWatermarkPreferencesSqliteModulePromise.catch(() => {
    studioWatermarkPreferencesSqliteModulePromise = null;
  });
  return studioWatermarkPreferencesSqliteModulePromise;
}

export function studioInkGestureTimeOrigin(
  contract: unknown,
  timeStamp: number,
): number | null {
  return isStudioInkInputContractV2(contract)
    && Number.isFinite(timeStamp)
    && timeStamp >= 0
    ? timeStamp
    : null;
}

export function studioLivingInkSupportsElement(
  element: DrawEl,
  physicalModeEnabled: boolean,
): boolean {
  return element.mode === "pen"
    && (element.kind ?? "freehand") === "freehand"
    && !element.fill
    && (element.symmetry?.type ?? "none") === "none"
    && studioLivingInkAdmitsBrush({
      brushId: element.brush,
      catalogId: element.brushCatalogId,
      physicalModeEnabled,
    });
}

export function studioLivingInkLinearColor(
  value: string
): readonly [number, number, number, number] | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(value);
  if (!match) return null;
  const linear = (channel: string) => {
    const normalized = Number.parseInt(channel, 16) / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return Object.freeze([linear(match[1]!), linear(match[2]!), linear(match[3]!), 1]);
}

export function studioHokusaiProductLivePreset(
  brushId: string,
  catalogId: string | null | undefined,
): StudioHokusaiProductLivePresetId | null {
  // Brush identity is not an opt-in. The committed full-size comparison failed both the visual
  // parity and 1.2x throughput promotion gates, so the normal shelf never starts Hokusai live.
  // The selected-stroke inspector remains the explicit, user-visible experimental surface.
  const admission = resolveStudioHokusaiProductLiveAdmission({ brushId, catalogId });
  return admission.status === "admitted" ? admission.presetId : null;
}

export function studioHokusaiColor(value: string): `#${string}` | null {
  return /^#[0-9a-f]{6}$/iu.test(value) ? value.toLowerCase() as `#${string}` : null;
}

export function studioHokusaiStrokeSeed(element: DrawEl): number {
  const persistedSeed = element.brushDynamics?.seed;
  if (Number.isSafeInteger(persistedSeed) && (persistedSeed ?? -1) >= 0) {
    return (persistedSeed as number) >>> 0;
  }
  let hash = 0x811c_9dc5;
  for (let index = 0; index < element.id.length; index += 1) {
    hash ^= element.id.charCodeAt(index);
    hash = Math.imul(hash, 0x0100_0193) >>> 0;
  }
  return hash;
}

export function studioHokusaiSamplesFromDrawElement(
  element: DrawEl,
  startSampleIndex: number,
): StudioHokusaiLiveSampleLike[] {
  const sampleCount = Math.floor(element.points.length / 2);
  const start = Math.max(0, Math.min(sampleCount, Math.floor(startSampleIndex)));
  const samples: StudioHokusaiLiveSampleLike[] = [];
  for (let index = start; index < sampleCount; index += 1) {
    const x = element.points[index * 2];
    const y = element.points[index * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pressure = element.pressures?.[index];
    const tiltX = element.tiltXs?.[index];
    const tiltY = element.tiltYs?.[index];
    const timeMilliseconds = element.sampleTimeOffsets?.[index];
    samples.push({
      x: x as number,
      y: y as number,
      ...(Number.isFinite(pressure) ? { pressure } : {}),
      ...(Number.isFinite(tiltX) ? { tiltX } : {}),
      ...(Number.isFinite(tiltY) ? { tiltY } : {}),
      ...(Number.isFinite(timeMilliseconds) ? { timeMilliseconds } : {}),
    });
  }
  return samples;
}

export function studioLivingInkSamplesFromDrawElement(
  element: DrawEl,
  startSampleIndex: number,
  fieldScale: number,
): StudioLivingInkAuthoritativeSample[] {
  const sampleCount = Math.floor(element.points.length / 2);
  const start = Math.max(0, Math.min(sampleCount, Math.floor(startSampleIndex)));
  const samples: StudioLivingInkAuthoritativeSample[] = [];
  for (let index = start; index < sampleCount; index += 1) {
    const x = element.points[index * 2];
    const y = element.points[index * 2 + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const pressure = element.pressures?.[index];
    const timeMs = element.sampleTimeOffsets?.[index];
    const tiltX = element.tiltXs?.[index];
    const tiltY = element.tiltYs?.[index];
    samples.push(Object.freeze({
      x: (x as number) * fieldScale,
      y: (y as number) * fieldScale,
      pressure: Number.isFinite(pressure) ? Math.max(0, Math.min(1, pressure as number)) : 0.5,
      timeMs: Number.isFinite(timeMs) ? Math.max(0, timeMs as number) : index * 8,
      ...(Number.isFinite(tiltX) ? { tiltX } : {}),
      ...(Number.isFinite(tiltY) ? { tiltY } : {}),
    }));
  }
  return samples;
}

export const STUDIO_CANVAS_IMAGE_ACCEPT =
  "image/*,.bmp,.dib,.tga,.icb,.vda,.vst,.ppm,.pam,.qoi,.tif,.tiff";

const STUDIO_OPEN_RASTER_FILE_EXTENSION = /\.(?:bmp|dib|tga|icb|vda|vst|ppm|pam|qoi|tif|tiff)$/iu;

export function isStudioOpenRasterDropFile(file: Pick<File, "name">): boolean {
  return STUDIO_OPEN_RASTER_FILE_EXTENSION.test(file.name);
}

export async function loadStudioCanvasImageFile(file: File) {
  const { loadImageFileForCanvas } = await loadStudioCanvasImageIo();
  return loadImageFileForCanvas(file);
}

export async function downscaleStudioCanvasDataUrl(dataUrl: string, maxWidth: number) {
  const { downscaleDataUrl } = await loadStudioCanvasImageIo();
  return downscaleDataUrl(dataUrl, maxWidth);
}

export async function loadStudioPixelEditImage(src: string, abort?: AbortSignal) {
  const { loadPixelEditImage } = await loadStudioCanvasImageIo();
  return loadPixelEditImage(src, abort);
}

export function createStudioPixelEditCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

export async function encodeStudioPixelEditResultPng(
  canvas: HTMLCanvasElement,
  signal?: AbortSignal,
): Promise<string> {
  // The product operation preselects the pixel-edit runtime encoder. Module-load and encode
  // failures are terminal for this operation; the same canvas is never re-encoded elsewhere.
  const runtime = await loadStudioPixelEditBrushRuntime();
  return runtime.encodeStudioRetouchCanvasPng(canvas, { signal });
}

export async function yieldStudioPixelEditMainThread(): Promise<void> {
  const { yieldStudioMainThread } = await import("./studio-pixel-edit-async");
  return yieldStudioMainThread();
}

export function readyStudioWorkAssetImageSources(
  hydrator: {
    readySources(): ReadonlyMap<string, { type: string }>;
  }
): Map<string, El> {
  const sources = new Map<string, El>();
  for (const [assetId, source] of hydrator.readySources()) {
    if (source.type === "image") sources.set(assetId, source as El);
  }
  return sources;
}

function loadStudioCanvasImageIo() {
  return import( "./canvas/studio-canvas-image-io");
}
