import {
  STUDIO_PROJECT_MAX_CANVAS_HEIGHT,
  STUDIO_PROJECT_MAX_PAGES,
} from "./studio-project-file";

import type { El } from "./studio-element-model";
import type { LayerGroup } from "./studio-layers";

const DEFAULT_MAX_EMBEDDED_BYTES = 128 * 1024 * 1024;
const MAX_IMPORT_PAGE_NAME_CHARACTERS = 120;

export interface StudioArchiveImportApplyLimits {
  readonly maxEmbeddedBytes: number;
  readonly maxPages: number;
  readonly maxLayersPerPage: number;
  readonly maxCanvasHeight: number;
}

export const STUDIO_ARCHIVE_IMPORT_APPLY_LIMITS: StudioArchiveImportApplyLimits = Object.freeze({
  maxEmbeddedBytes: DEFAULT_MAX_EMBEDDED_BYTES,
  maxPages: STUDIO_PROJECT_MAX_PAGES,
  maxLayersPerPage: 500,
  maxCanvasHeight: STUDIO_PROJECT_MAX_CANVAS_HEIGHT,
});

export class StudioArchiveImportApplyError extends Error {
  readonly code:
    | "ABORTED"
    | "EMBEDDED_SIZE_LIMIT"
    | "IMAGE_DECODE_FAILED"
    | "INVALID_DIMENSION"
    | "LAYER_COUNT_LIMIT"
    | "PAGE_COUNT_LIMIT"
    | "SOURCE_READ_FAILED";

  constructor(
    code: StudioArchiveImportApplyError["code"],
    message: string,
  ) {
    super(message);
    this.name = "StudioArchiveImportApplyError";
    this.code = code;
  }
}

export interface StudioArchiveImportPageDraft {
  readonly name: string;
  readonly canvasH: number;
  readonly elements: readonly El[];
  readonly groups?: readonly LayerGroup[];
}

export interface StudioOpenRasterLayerSource {
  readonly name: string;
  readonly png: Blob;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
  readonly opacity: number;
  readonly visible: boolean;
  readonly effectiveOpacity?: number;
  readonly effectiveVisible?: boolean;
  readonly blendMode: string;
  /** Optional flattened ancestry supplied by the ORA parser. */
  readonly groupPath?: readonly string[];
  /** Stable ORA stack identities; names alone are not unique between sibling groups. */
  readonly groupIds?: readonly string[];
}

export interface StudioOpenRasterImportSource {
  readonly width: number;
  readonly height: number;
  readonly name?: string;
  readonly layers: readonly StudioOpenRasterLayerSource[];
}

export interface StudioCbzPageSource {
  readonly path: string;
  readonly image: Blob;
  readonly width: number;
  readonly height: number;
  readonly mimeType?: string;
  readonly frameCount?: number;
}

export interface StudioCbzImportSource {
  readonly pages: readonly StudioCbzPageSource[];
  readonly metadata?: Readonly<{
    title?: string;
    series?: string;
  }>;
}

export interface StudioArchiveImportApplyOptions {
  readonly canvasWidth: number;
  readonly createId: () => string;
  readonly signal?: AbortSignal;
  readonly existingPageCount?: number;
  readonly limits?: Partial<StudioArchiveImportApplyLimits>;
  readonly blobToDataUrl?: (blob: Blob, signal?: AbortSignal) => Promise<string>;
  readonly decodeImageBlob?: (
    blob: Blob,
    signal?: AbortSignal,
  ) => Promise<Readonly<{ width: number; height: number }>>;
}

function fail(
  code: StudioArchiveImportApplyError["code"],
  message: string,
): never {
  throw new StudioArchiveImportApplyError(code, message);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("ABORTED", "문서 가져오기가 취소되었습니다.");
}

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0 || resolved > fallback) {
    fail("INVALID_DIMENSION", `${label} 한도가 올바르지 않습니다.`);
  }
  return resolved;
}

function resolveLimits(value?: Partial<StudioArchiveImportApplyLimits>): StudioArchiveImportApplyLimits {
  return {
    maxEmbeddedBytes: resolvePositiveInteger(
      value?.maxEmbeddedBytes,
      STUDIO_ARCHIVE_IMPORT_APPLY_LIMITS.maxEmbeddedBytes,
      "프로젝트 포함 바이트",
    ),
    maxPages: resolvePositiveInteger(
      value?.maxPages,
      STUDIO_ARCHIVE_IMPORT_APPLY_LIMITS.maxPages,
      "페이지 수",
    ),
    maxLayersPerPage: resolvePositiveInteger(
      value?.maxLayersPerPage,
      STUDIO_ARCHIVE_IMPORT_APPLY_LIMITS.maxLayersPerPage,
      "페이지당 레이어 수",
    ),
    maxCanvasHeight: resolvePositiveInteger(
      value?.maxCanvasHeight,
      STUDIO_ARCHIVE_IMPORT_APPLY_LIMITS.maxCanvasHeight,
      "페이지 세로 크기",
    ),
  };
}

function safeDimension(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    fail("INVALID_DIMENSION", `${label} 크기가 올바르지 않습니다.`);
  }
  return value;
}

function displayScale(sourceWidth: number, canvasWidth: number): number {
  const safeSourceWidth = safeDimension(sourceWidth, "원본 너비");
  const safeCanvasWidth = safeDimension(canvasWidth, "캔버스 너비");
  return Math.min(1, safeCanvasWidth / safeSourceWidth);
}

function safeCanvasHeight(value: number, maximum: number): number {
  const height = safeDimension(value, "가져온 페이지 높이");
  if (height > maximum) {
    fail(
      "INVALID_DIMENSION",
      `가져온 페이지 높이 ${height.toLocaleString("ko-KR")}px가 프로젝트 저장 한도 ${maximum.toLocaleString("ko-KR")}px를 넘습니다. 원본을 나누거나 크기를 줄여 주세요.`,
    );
  }
  return height;
}

function normalizeName(value: string | undefined, fallback: string): string {
  const withoutControls = Array.from(value ?? "", (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("");
  const normalized = withoutControls
    .replace(/\s+/gu, " ")
    .trim();
  return (normalized || fallback).slice(0, MAX_IMPORT_PAGE_NAME_CHARACTERS);
}

function baseName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const leaf = normalized.slice(normalized.lastIndexOf("/") + 1);
  const extensionIndex = leaf.lastIndexOf(".");
  return extensionIndex > 0 ? leaf.slice(0, extensionIndex) : leaf;
}

function projectedDataUrlStorageBytes(blob: Blob): number {
  // FileReader emits an ASCII `data:<mime>;base64,` string. JSON persistence stores that payload
  // roughly byte-for-byte, so budget the 4/3 expansion before allocating it. The fixed allowance
  // is deliberately conservative for MIME/header variance and JSON field syntax.
  return Math.ceil(blob.size / 3) * 4 + 128;
}

function sumProjectedDataUrlStorageBytes(blobs: readonly Blob[], maximum: number): number {
  let total = 0;
  for (const blob of blobs) {
    const projected = projectedDataUrlStorageBytes(blob);
    if (projected > maximum - total) {
      fail(
        "EMBEDDED_SIZE_LIMIT",
        `가져올 이미지의 프로젝트 저장 payload가 포함 한도 ${Math.round(maximum / 1024 / 1024)}MB를 넘습니다. 파일을 나누거나 원본 크기를 줄여 주세요.`,
      );
    }
    total += projected;
  }
  return total;
}

/** FileReader is kept behind this async user-action boundary so archive codecs stay DOM-free. */
export function readStudioArchiveBlobAsDataUrl(
  blob: Blob,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const onAbort = () => reader.abort();
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    reader.addEventListener("load", () => {
      cleanup();
      if (typeof reader.result !== "string") {
        reject(new StudioArchiveImportApplyError(
          "SOURCE_READ_FAILED",
          "가져온 이미지 데이터를 프로젝트 형식으로 변환하지 못했습니다.",
        ));
        return;
      }
      resolve(reader.result);
    }, { once: true });
    reader.addEventListener("error", () => {
      cleanup();
      reject(new StudioArchiveImportApplyError(
        "SOURCE_READ_FAILED",
        "가져온 이미지 데이터를 읽지 못했습니다.",
      ));
    }, { once: true });
    reader.addEventListener("abort", () => {
      cleanup();
      reject(new StudioArchiveImportApplyError("ABORTED", "문서 가져오기가 취소되었습니다."));
    }, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    reader.readAsDataURL(blob);
  });
}

export async function decodeStudioArchiveImageBlob(
  blob: Blob,
  signal?: AbortSignal,
): Promise<Readonly<{ width: number; height: number }>> {
  throwIfAborted(signal);
  if (typeof globalThis.createImageBitmap === "function") {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await globalThis.createImageBitmap(blob, { imageOrientation: "none" });
      throwIfAborted(signal);
      return { width: bitmap.width, height: bitmap.height };
    } catch (cause) {
      if (cause instanceof StudioArchiveImportApplyError) throw cause;
      throwIfAborted(signal);
      throw new StudioArchiveImportApplyError(
        "IMAGE_DECODE_FAILED",
        "이미지 픽셀 스트림을 브라우저가 해독하지 못했습니다. 손상되지 않은 원본으로 다시 시도해 주세요.",
      );
    } finally {
      bitmap?.close();
    }
  }

  if (
    typeof globalThis.Image === "function" &&
    typeof globalThis.URL?.createObjectURL === "function" &&
    typeof globalThis.URL?.revokeObjectURL === "function"
  ) {
    const objectUrl = globalThis.URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const image = new globalThis.Image();
        let settled = false;
        const finish = (result: "abort" | "error" | "load") => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          image.onload = null;
          image.onerror = null;
          if (result === "abort") {
            image.src = "";
            reject(new StudioArchiveImportApplyError("ABORTED", "문서 가져오기가 취소되었습니다."));
          } else if (result === "error") {
            reject(new StudioArchiveImportApplyError(
              "IMAGE_DECODE_FAILED",
              "이미지 픽셀 스트림을 브라우저가 해독하지 못했습니다. 손상되지 않은 원본으로 다시 시도해 주세요.",
            ));
          } else {
            resolve({
              width: image.naturalWidth || image.width,
              height: image.naturalHeight || image.height,
            });
          }
        };
        const onAbort = () => finish("abort");
        image.onload = () => finish("load");
        image.onerror = () => finish("error");
        signal?.addEventListener("abort", onAbort, { once: true });
        image.src = objectUrl;
      });
    } finally {
      globalThis.URL.revokeObjectURL(objectUrl);
    }
  }

  fail(
    "IMAGE_DECODE_FAILED",
    "이 브라우저에서는 가져온 이미지의 실제 픽셀 무결성을 검사할 수 없습니다.",
  );
}

async function verifyImageBlobs(
  images: readonly Readonly<{ blob: Blob; width: number; height: number; label: string }>[],
  options: StudioArchiveImportApplyOptions,
): Promise<void> {
  const decode = options.decodeImageBlob ?? decodeStudioArchiveImageBlob;
  for (const image of images) {
    throwIfAborted(options.signal);
    const decoded = await decode(image.blob, options.signal);
    throwIfAborted(options.signal);
    if (decoded.width !== image.width || decoded.height !== image.height) {
      fail(
        "IMAGE_DECODE_FAILED",
        `${normalizeName(image.label, "이미지")}의 실제 크기 ${decoded.width.toLocaleString("ko-KR")}×${decoded.height.toLocaleString("ko-KR")}px가 파일 헤더의 ${image.width.toLocaleString("ko-KR")}×${image.height.toLocaleString("ko-KR")}px와 다릅니다.`,
      );
    }
  }
}

async function encodeBlobs(
  blobs: readonly Blob[],
  options: StudioArchiveImportApplyOptions,
): Promise<string[]> {
  const encode = options.blobToDataUrl ?? readStudioArchiveBlobAsDataUrl;
  const maximum = resolveLimits(options.limits).maxEmbeddedBytes;
  const encoded: string[] = [];
  let totalStorageBytes = 0;
  // Sequential conversion keeps peak base64 + FileReader working memory bounded on mobile.
  for (const blob of blobs) {
    throwIfAborted(options.signal);
    const dataUrl = await encode(blob, options.signal);
    totalStorageBytes += dataUrl.length;
    if (!Number.isSafeInteger(totalStorageBytes) || totalStorageBytes > maximum) {
      fail(
        "EMBEDDED_SIZE_LIMIT",
        `변환된 이미지 payload가 프로젝트 포함 한도 ${Math.round(maximum / 1024 / 1024)}MB를 넘습니다. 파일을 나누거나 원본 크기를 줄여 주세요.`,
      );
    }
    encoded.push(dataUrl);
  }
  throwIfAborted(options.signal);
  return encoded;
}

function studioBlendMode(value: string): string | undefined {
  if (value === "normal" || value === "source-over") return undefined;
  // OpenRaster names the additive Porter-Duff mode `plus`; Canvas/Konva exposes the same
  // operation as `lighter`. Passing `plus` through would silently fall back in browsers.
  return value === "plus" ? "lighter" : value;
}

export async function prepareStudioOpenRasterImportPage(
  source: StudioOpenRasterImportSource,
  options: StudioArchiveImportApplyOptions,
): Promise<StudioArchiveImportPageDraft> {
  const limits = resolveLimits(options.limits);
  if (source.layers.length === 0 || source.layers.length > limits.maxLayersPerPage) {
    fail("LAYER_COUNT_LIMIT", "OpenRaster 레이어 수가 Studio 적용 한도를 벗어났습니다.");
  }
  const sourceWidth = safeDimension(source.width, "OpenRaster 캔버스 너비");
  const sourceHeight = safeDimension(source.height, "OpenRaster 캔버스 높이");
  for (const layer of source.layers) {
    safeDimension(layer.width, `${layer.name} 레이어 너비`);
    safeDimension(layer.height, `${layer.name} 레이어 높이`);
  }
  sumProjectedDataUrlStorageBytes(
    source.layers.map((layer) => layer.png),
    limits.maxEmbeddedBytes,
  );
  await verifyImageBlobs(source.layers.map((layer) => ({
    blob: layer.png,
    width: layer.width,
    height: layer.height,
    label: layer.name,
  })), options);
  const dataUrls = await encodeBlobs(source.layers.map((layer) => layer.png), options);
  const scale = displayScale(sourceWidth, options.canvasWidth);
  const groups: LayerGroup[] = [];

  const groupKeys = source.layers.map((layer) => {
    const identities = layer.groupIds?.filter(Boolean) ?? [];
    if (identities.length > 0) return `id:${identities.join("/")}`;
    const names = layer.groupPath?.map((entry) => normalizeName(entry, "그룹")) ?? [];
    return names.length > 0 ? `name:${names.join("/")}` : null;
  });
  const totalRunsByKey = new Map<string, number>();
  let previousKey: string | null = null;
  for (const key of groupKeys) {
    if (key && key !== previousKey) {
      totalRunsByKey.set(key, (totalRunsByKey.get(key) ?? 0) + 1);
    }
    previousKey = key;
  }
  const seenRunsByKey = new Map<string, number>();
  const groupIdByLayer = new Map<number, string>();
  previousKey = null;
  let currentGroupId: string | null = null;
  for (let index = 0; index < source.layers.length; index += 1) {
    const key = groupKeys[index] ?? null;
    if (!key) {
      previousKey = null;
      currentGroupId = null;
      continue;
    }
    if (key !== previousKey) {
      const layer = source.layers[index]!;
      const groupPath = layer.groupPath?.map((entry) => normalizeName(entry, "그룹")) ?? [];
      const baseName = groupPath.join(" / ") || "OpenRaster 그룹";
      const runIndex = (seenRunsByKey.get(key) ?? 0) + 1;
      seenRunsByKey.set(key, runIndex);
      const runCount = totalRunsByKey.get(key) ?? 1;
      currentGroupId = options.createId();
      groups.push({
        id: currentGroupId,
        name: runCount > 1 ? `${baseName} · 구간 ${runIndex}` : baseName,
        collapsed: false,
      });
    }
    groupIdByLayer.set(index, currentGroupId!);
    previousKey = key;
  }

  const elements = source.layers.map((layer, index): El => {
    const groupId = groupIdByLayer.get(index);
    const opacity = layer.effectiveOpacity ?? layer.opacity;
    const visible = layer.effectiveVisible ?? layer.visible;
    return {
      id: options.createId(),
      type: "image",
      src: dataUrls[index]!,
      x: Math.round(layer.x * scale),
      y: Math.round(layer.y * scale),
      width: Math.max(1, Math.round(layer.width * scale)),
      height: Math.max(1, Math.round(layer.height * scale)),
      rotation: 0,
      name: normalizeName(layer.name, `ORA 레이어 ${index + 1}`),
      ...(opacity < 1 ? { opacity: Math.max(0, Math.min(1, opacity)) } : {}),
      ...(!visible ? { hidden: true } : {}),
      ...(studioBlendMode(layer.blendMode)
        ? { blendMode: studioBlendMode(layer.blendMode) }
        : {}),
      ...(groupId ? { groupId } : {}),
    } as El;
  });

  return Object.freeze({
    name: normalizeName(source.name, "OpenRaster 가져오기"),
    canvasH: safeCanvasHeight(Math.max(1, Math.round(sourceHeight * scale)), limits.maxCanvasHeight),
    elements: Object.freeze(elements),
    ...(groups.length > 0 ? { groups: Object.freeze(groups) } : {}),
  });
}

export async function prepareStudioCbzImportPages(
  source: StudioCbzImportSource,
  options: StudioArchiveImportApplyOptions,
): Promise<readonly StudioArchiveImportPageDraft[]> {
  const limits = resolveLimits(options.limits);
  const existingPageCount = options.existingPageCount ?? 0;
  if (!Number.isSafeInteger(existingPageCount) || existingPageCount < 0) {
    fail("PAGE_COUNT_LIMIT", "현재 Studio 페이지 수를 확인할 수 없습니다.");
  }
  if (
    source.pages.length === 0 ||
    source.pages.length > limits.maxPages ||
    existingPageCount > limits.maxPages - source.pages.length
  ) {
    fail("PAGE_COUNT_LIMIT", "CBZ 페이지 수가 Studio 적용 한도를 벗어났습니다.");
  }
  for (const page of source.pages) {
    safeDimension(page.width, `${page.path} 너비`);
    safeDimension(page.height, `${page.path} 높이`);
  }
  sumProjectedDataUrlStorageBytes(
    source.pages.map((page) => page.image),
    limits.maxEmbeddedBytes,
  );
  await verifyImageBlobs(source.pages.map((page) => ({
    blob: page.image,
    width: page.width,
    height: page.height,
    label: page.path,
  })), options);
  const dataUrls = await encodeBlobs(source.pages.map((page) => page.image), options);
  const seriesName = normalizeName(source.metadata?.title ?? source.metadata?.series, "CBZ");
  const drafts = source.pages.map((page, index): StudioArchiveImportPageDraft => {
    const scale = displayScale(page.width, options.canvasWidth);
    const width = Math.max(1, Math.round(page.width * scale));
    const height = safeCanvasHeight(
      Math.max(1, Math.round(page.height * scale)),
      limits.maxCanvasHeight,
    );
    const pageLabel = normalizeName(baseName(page.path), `${seriesName} ${index + 1}`);
    return Object.freeze({
      name: pageLabel,
      canvasH: height,
      elements: Object.freeze([{
        id: options.createId(),
        type: "image",
        src: dataUrls[index]!,
        x: Math.round((options.canvasWidth - width) / 2),
        y: 0,
        width,
        height,
        rotation: 0,
        name: pageLabel,
        // Studio's historical flag name says GIF, but the renderer contract is the generic
        // "live browser-decoded image; do not cache and request periodic redraw" path. Reuse it
        // for validated APNG and animated WebP pages as well.
        ...((page.frameCount ?? 1) > 1
          ? { isAnimatedGif: true }
          : {}),
      } as El]),
    });
  });
  return Object.freeze(drafts);
}
