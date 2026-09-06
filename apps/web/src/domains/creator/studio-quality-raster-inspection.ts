/**
 * Browser-time raster finishing inspection.
 *
 * The static quality engine can validate document references, but only a decoder can prove that an
 * image still opens and expose its intrinsic pixel dimensions. This module performs that bounded,
 * cancellable probe without reading pixels, so remote images do not require canvas CORS access.
 */

import {
  createStudioQualityIssue,
  type StudioQualityIssue,
} from "./studio-quality-inspection";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

export interface StudioRasterProbeMetadata {
  readonly width: number;
  readonly height: number;
}

export type StudioRasterMetadataProbe = (
  source: string,
  signal: AbortSignal | undefined
) => Promise<StudioRasterProbeMetadata>;

export interface StudioRasterInspectionProgress {
  readonly completed: number;
  readonly total: number;
}

export interface StudioRasterInspectionOptions {
  readonly signal?: AbortSignal;
  readonly probe?: StudioRasterMetadataProbe;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly maxSources?: number;
  /** Intrinsic pixels / rendered CSS-canvas pixels below this ratio produce a warning. */
  readonly warningScaleRatio?: number;
  /** Intrinsic pixels / rendered CSS-canvas pixels below this ratio produce an error. */
  readonly criticalScaleRatio?: number;
  readonly onProgress?: (progress: StudioRasterInspectionProgress) => void;
}

export interface StudioRasterInspectionResult {
  readonly status: "complete" | "aborted" | "unavailable";
  readonly issues: readonly StudioQualityIssue[];
  readonly assetReferenceCount: number;
  readonly probedSourceCount: number;
  readonly skippedSourceCount: number;
}

type RasterRole = "image" | "animation-frame" | "layer-mask" | "filter-mask";

interface RasterReference {
  readonly source: string;
  readonly sourceKey: string;
  readonly role: RasterRole;
  readonly pageId: string;
  readonly pageIndex: number;
  readonly pageName: string;
  readonly elementId: string;
  readonly displayWidth?: number;
  readonly displayHeight?: number;
  readonly frameIndex?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_MAX_SOURCES = 400;
const DEFAULT_WARNING_SCALE_RATIO = 0.9;
const DEFAULT_CRITICAL_SCALE_RATIO = 0.5;
const LARGE_EMBEDDED_ASSET_BYTES = 24 * 1024 * 1024;

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)));
}

function boundedRatio(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value! <= 0) return fallback;
  return Math.min(1, value!);
}

function sourceFingerprint(source: string): string {
  let hash = 2_166_136_261;
  const sample =
    source.length <= 2_048
      ? source
      : `${source.length}:${source.slice(0, 512)}:${source.slice(-512)}`;
  for (let index = 0; index < sample.length; index += 1) {
    hash ^= sample.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function pageName(page: PageState, pageIndex: number): string {
  return page.name?.trim() || `${pageIndex + 1}페이지`;
}

function addReference(
  references: RasterReference[],
  source: string | null | undefined,
  page: PageState,
  pageIndex: number,
  el: El,
  role: RasterRole,
  extra: Pick<RasterReference, "displayWidth" | "displayHeight" | "frameIndex"> = {}
): void {
  const normalized = source?.trim();
  if (!normalized) return;
  references.push({
    source: normalized,
    sourceKey: sourceFingerprint(normalized),
    role,
    pageId: page.id,
    pageIndex,
    pageName: pageName(page, pageIndex),
    elementId: el.id,
    ...extra,
  });
}

function collectRasterReferences(pages: readonly PageState[]): RasterReference[] {
  const references: RasterReference[] = [];
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    for (const el of page.elements) {
      if (el.type === "image") {
        if ((el.frames?.length ?? 0) === 0) {
          addReference(references, el.src, page, pageIndex, el, "image", {
            displayWidth: el.width,
            displayHeight: el.height,
          });
        }
        for (let frameIndex = 0; frameIndex < (el.frames?.length ?? 0); frameIndex += 1) {
          const frame = el.frames![frameIndex]!;
          addReference(references, frame.src, page, pageIndex, el, "animation-frame", {
            displayWidth: el.width,
            displayHeight: el.height,
            frameIndex,
          });
        }
        if (el.filterMaskEnabled) {
          addReference(references, el.filterMaskSrc, page, pageIndex, el, "filter-mask");
        }
      }
      if (el.maskEnabled) {
        addReference(references, el.maskSrc, page, pageIndex, el, "layer-mask");
      }
    }
  }
  return references;
}

function abortError(): Error {
  const error = new Error("Raster inspection aborted");
  error.name = "AbortError";
  return error;
}

function loadImageMetadata(
  source: string,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<StudioRasterProbeMetadata> {
  if (typeof Image === "undefined") {
    return Promise.reject(new Error("IMAGE_DECODER_UNAVAILABLE"));
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const image = new Image();
    image.decoding = "async";
    let settled = false;
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      image.onload = null;
      image.onerror = null;
      callback();
    };
    const onAbort = () => settle(() => reject(abortError()));
    const timer = globalThis.setTimeout(
      () => settle(() => reject(new Error("IMAGE_DECODE_TIMEOUT"))),
      timeoutMs
    );
    image.onload = () =>
      settle(() => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        if (!finitePositive(width) || !finitePositive(height)) {
          reject(new Error("IMAGE_DIMENSIONS_INVALID"));
          return;
        }
        resolve({ width, height });
      });
    image.onerror = () => settle(() => reject(new Error("IMAGE_DECODE_FAILED")));
    signal?.addEventListener("abort", onAbort, { once: true });
    image.src = source;
  });
}

function isVectorSource(source: string): boolean {
  const lower = source.slice(0, 256).toLocaleLowerCase();
  return lower.startsWith("data:image/svg+xml") || /\.svg(?:[?#]|$)/u.test(lower);
}

function embeddedAssetBytes(source: string): number | null {
  if (!source.startsWith("data:image/")) return null;
  const comma = source.indexOf(",");
  if (comma < 0) return null;
  const header = source.slice(0, comma).toLocaleLowerCase();
  const payloadLength = source.length - comma - 1;
  if (header.includes(";base64")) return Math.ceil((payloadLength * 3) / 4);
  return new TextEncoder().encode(source.slice(comma + 1)).byteLength;
}

function roleLabel(role: RasterRole): string {
  if (role === "image") return "이미지 레이어";
  if (role === "animation-frame") return "애니메이션 프레임";
  if (role === "layer-mask") return "레이어 마스크";
  return "필터 마스크";
}

function decodeFailureIssue(reference: RasterReference): StudioQualityIssue {
  return createStudioQualityIssue({
    code: "BROKEN_RASTER_ASSET",
    category: "asset",
    severity: reference.role === "image" ? "blocking" : "error",
    title: `${roleLabel(reference.role)} 디코딩 실패`,
    message: `${reference.pageName}의 ${roleLabel(reference.role)} 원본을 브라우저가 열지 못했습니다.`,
    remediation: "원본 파일을 다시 연결하고 저장한 뒤 재검사하세요.",
    pageId: reference.pageId,
    pageIndex: reference.pageIndex,
    elementId: reference.elementId,
    idSuffix: `${reference.role}:${reference.frameIndex ?? "-"}:${reference.sourceKey}`,
  });
}

function embeddedAssetIssue(reference: RasterReference, bytes: number): StudioQualityIssue {
  return createStudioQualityIssue({
    code: "EMBEDDED_ASSET_LARGE",
    category: "asset",
    severity: "warning",
    title: "대용량 인라인 이미지",
    message: `${reference.pageName}의 ${roleLabel(reference.role)}가 약 ${(bytes / 1024 / 1024).toFixed(1)}MB로 문서에 직접 포함되어 있습니다.`,
    remediation: "저장·동기화 속도가 느리면 프로젝트 자산 저장소의 영구 참조로 교체하세요.",
    pageId: reference.pageId,
    pageIndex: reference.pageIndex,
    elementId: reference.elementId,
    idSuffix: `${reference.role}:${reference.frameIndex ?? "-"}:${reference.sourceKey}`,
    evidence: { embeddedBytes: bytes },
  });
}

function intrinsicQualityIssues(
  reference: RasterReference,
  metadata: StudioRasterProbeMetadata,
  warningScaleRatio: number,
  criticalScaleRatio: number
): StudioQualityIssue[] {
  if (
    isVectorSource(reference.source) ||
    !finitePositive(reference.displayWidth) ||
    !finitePositive(reference.displayHeight) ||
    (reference.role !== "image" && reference.role !== "animation-frame")
  ) {
    return [];
  }

  const widthRatio = metadata.width / reference.displayWidth;
  const heightRatio = metadata.height / reference.displayHeight;
  const scaleRatio = Math.min(widthRatio, heightRatio);
  const naturalAspect = metadata.width / metadata.height;
  const displayAspect = reference.displayWidth / reference.displayHeight;
  const aspectDifference = Math.abs(naturalAspect / displayAspect - 1);
  const issues: StudioQualityIssue[] = [];

  if (scaleRatio < criticalScaleRatio) {
    issues.push(
      createStudioQualityIssue({
        code: "EXTREME_RASTER_UPSCALE",
        category: "asset",
        severity: "error",
        title: "심한 래스터 확대",
        message: `${reference.pageName}의 ${roleLabel(reference.role)}가 원본 픽셀보다 약 ${(1 / Math.max(scaleRatio, 0.01)).toFixed(1)}배 크게 배치되어 선과 톤이 흐려질 수 있습니다.`,
        remediation: "더 큰 원본으로 교체하거나 배치 크기를 줄인 뒤 100%·200% 확대에서 확인하세요.",
        pageId: reference.pageId,
        pageIndex: reference.pageIndex,
        elementId: reference.elementId,
        idSuffix: `${reference.role}:${reference.frameIndex ?? "-"}:${reference.sourceKey}`,
        evidence: {
          intrinsicWidth: metadata.width,
          intrinsicHeight: metadata.height,
          displayWidth: Math.round(reference.displayWidth),
          displayHeight: Math.round(reference.displayHeight),
          pixelRatio: Number(scaleRatio.toFixed(3)),
        },
      })
    );
  } else if (scaleRatio < warningScaleRatio) {
    issues.push(
      createStudioQualityIssue({
        code: "LOW_RASTER_RESOLUTION",
        category: "asset",
        severity: "warning",
        title: "래스터 해상도 부족 가능성",
        message: `${reference.pageName}의 ${roleLabel(reference.role)}가 표시 크기보다 작은 원본 픽셀을 사용합니다.`,
        remediation: "고해상도 원본으로 교체하거나 실제 게시 배율에서 선명도를 확인하세요.",
        pageId: reference.pageId,
        pageIndex: reference.pageIndex,
        elementId: reference.elementId,
        idSuffix: `${reference.role}:${reference.frameIndex ?? "-"}:${reference.sourceKey}`,
        evidence: {
          intrinsicWidth: metadata.width,
          intrinsicHeight: metadata.height,
          displayWidth: Math.round(reference.displayWidth),
          displayHeight: Math.round(reference.displayHeight),
          pixelRatio: Number(scaleRatio.toFixed(3)),
        },
      })
    );
  }

  if (aspectDifference > 0.15) {
    issues.push(
      createStudioQualityIssue({
        code: "RASTER_ASPECT_RATIO_DISTORTION",
        category: "asset",
        severity: "review",
        title: "이미지 비율 변형 확인",
        message: `${reference.pageName}의 ${roleLabel(reference.role)} 표시 비율이 원본과 ${Math.round(aspectDifference * 100)}% 다릅니다.`,
        remediation: "의도한 늘이기인지 확인하고, 아니라면 원본 비율을 복원하거나 자르기 도구를 사용하세요.",
        pageId: reference.pageId,
        pageIndex: reference.pageIndex,
        elementId: reference.elementId,
        idSuffix: `${reference.role}:${reference.frameIndex ?? "-"}:${reference.sourceKey}`,
        evidence: {
          intrinsicAspect: Number(naturalAspect.toFixed(4)),
          displayAspect: Number(displayAspect.toFixed(4)),
        },
      })
    );
  }

  return issues;
}

function dimensionMismatchIssues(
  references: readonly RasterReference[],
  metadataBySource: ReadonlyMap<string, StudioRasterProbeMetadata>
): StudioQualityIssue[] {
  const byElement = new Map<string, RasterReference[]>();
  for (const reference of references) {
    const key = `${reference.pageId}:${reference.elementId}`;
    const group = byElement.get(key) ?? [];
    group.push(reference);
    byElement.set(key, group);
  }

  const issues: StudioQualityIssue[] = [];
  for (const group of byElement.values()) {
    const image = group.find((reference) => reference.role === "image");
    const imageMetadata = image ? metadataBySource.get(image.source) : undefined;
    const frames = group
      .filter((reference) => reference.role === "animation-frame")
      .sort((a, b) => (a.frameIndex ?? 0) - (b.frameIndex ?? 0));
    const baselineFrame = frames.find((reference) => metadataBySource.has(reference.source));
    const baselineMetadata = baselineFrame
      ? metadataBySource.get(baselineFrame.source)
      : undefined;

    if (baselineFrame && baselineMetadata) {
      for (const frame of frames) {
        if (frame === baselineFrame) continue;
        const metadata = metadataBySource.get(frame.source);
        if (!metadata) continue;
        if (metadata.width === baselineMetadata.width && metadata.height === baselineMetadata.height) {
          continue;
        }
        issues.push(
          createStudioQualityIssue({
            code: "ANIMATION_FRAME_DIMENSION_MISMATCH",
            category: "asset",
            severity: "review",
            title: "애니메이션 프레임 크기 불일치",
            message: `${frame.pageName}의 애니메이션 프레임 ${Number(frame.frameIndex ?? 0) + 1} 크기가 기준 프레임과 다릅니다.`,
            remediation: "재생 중 위치가 튀지 않는지 확인하고, 필요하면 모든 프레임 캔버스 크기를 통일하세요.",
            pageId: frame.pageId,
            pageIndex: frame.pageIndex,
            elementId: frame.elementId,
            idSuffix: `frame:${frame.frameIndex ?? "-"}:${frame.sourceKey}`,
            evidence: {
              baselineWidth: baselineMetadata.width,
              baselineHeight: baselineMetadata.height,
              frameWidth: metadata.width,
              frameHeight: metadata.height,
            },
          })
        );
      }
    }

    const maskBaseline = imageMetadata ?? baselineMetadata;
    if (maskBaseline) {
      for (const mask of group.filter(
        (reference) => reference.role === "layer-mask" || reference.role === "filter-mask"
      )) {
        const metadata = metadataBySource.get(mask.source);
        if (!metadata) continue;
        if (metadata.width === maskBaseline.width && metadata.height === maskBaseline.height) {
          continue;
        }
        issues.push(
          createStudioQualityIssue({
            code: "MASK_DIMENSION_MISMATCH",
            category: "layer",
            severity: "warning",
            title: "마스크 해상도 불일치",
            message: `${mask.pageName}의 ${roleLabel(mask.role)} 크기가 원본 이미지 크기와 다릅니다.`,
            remediation: "마스크 정렬이 어긋나지 않는지 확인하고 원본과 같은 픽셀 크기로 다시 생성하세요.",
            pageId: mask.pageId,
            pageIndex: mask.pageIndex,
            elementId: mask.elementId,
            idSuffix: `${mask.role}:${mask.sourceKey}`,
            evidence: {
              imageWidth: maskBaseline.width,
              imageHeight: maskBaseline.height,
              maskWidth: metadata.width,
              maskHeight: metadata.height,
            },
          })
        );
      }
    }
  }
  return issues;
}

export async function inspectStudioRasterAssets(
  pages: readonly PageState[],
  options: StudioRasterInspectionOptions = {}
): Promise<StudioRasterInspectionResult> {
  const references = collectRasterReferences(pages);
  const distinctSources = [...new Set(references.map((reference) => reference.source))];
  if (distinctSources.length === 0) {
    options.onProgress?.({ completed: 0, total: 0 });
    return {
      status: "complete",
      issues: [],
      assetReferenceCount: 0,
      probedSourceCount: 0,
      skippedSourceCount: 0,
    };
  }
  if (!options.probe && typeof Image === "undefined") {
    return {
      status: "unavailable",
      issues: [],
      assetReferenceCount: references.length,
      probedSourceCount: 0,
      skippedSourceCount: distinctSources.length,
    };
  }

  const timeoutMs = clampInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 60_000);
  const concurrency = clampInteger(options.concurrency, DEFAULT_CONCURRENCY, 1, 12);
  const maxSources = clampInteger(options.maxSources, DEFAULT_MAX_SOURCES, 1, 2_000);
  const warningScaleRatio = boundedRatio(
    options.warningScaleRatio,
    DEFAULT_WARNING_SCALE_RATIO
  );
  const criticalScaleRatio = Math.min(
    warningScaleRatio,
    boundedRatio(options.criticalScaleRatio, DEFAULT_CRITICAL_SCALE_RATIO)
  );
  const selectedSources = distinctSources.slice(0, maxSources);
  const skippedSourceCount = Math.max(0, distinctSources.length - selectedSources.length);
  const probe =
    options.probe ??
    ((source: string, signal: AbortSignal | undefined) =>
      loadImageMetadata(source, signal, timeoutMs));
  const metadataBySource = new Map<string, StudioRasterProbeMetadata>();
  const failedSources = new Set<string>();
  let cursor = 0;
  let completed = 0;
  let aborted = false;

  options.onProgress?.({ completed: 0, total: selectedSources.length });
  const worker = async () => {
    while (cursor < selectedSources.length) {
      if (options.signal?.aborted) {
        aborted = true;
        return;
      }
      const sourceIndex = cursor;
      cursor += 1;
      const source = selectedSources[sourceIndex]!;
      try {
        const metadata = await probe(source, options.signal);
        if (!finitePositive(metadata.width) || !finitePositive(metadata.height)) {
          failedSources.add(source);
        } else {
          metadataBySource.set(source, metadata);
        }
      } catch (error) {
        if ((error as { name?: unknown })?.name === "AbortError" || options.signal?.aborted) {
          aborted = true;
          return;
        }
        failedSources.add(source);
      } finally {
        completed += 1;
        options.onProgress?.({ completed, total: selectedSources.length });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, selectedSources.length) }, () => worker())
  );
  if (aborted || options.signal?.aborted) {
    return {
      status: "aborted",
      issues: [],
      assetReferenceCount: references.length,
      probedSourceCount: metadataBySource.size,
      skippedSourceCount,
    };
  }

  const selectedSourceSet = new Set(selectedSources);
  const selectedReferences = references.filter((reference) => selectedSourceSet.has(reference.source));
  const issues: StudioQualityIssue[] = [];
  for (const reference of selectedReferences) {
    const embeddedBytes = embeddedAssetBytes(reference.source);
    if (embeddedBytes !== null && embeddedBytes > LARGE_EMBEDDED_ASSET_BYTES) {
      issues.push(embeddedAssetIssue(reference, embeddedBytes));
    }
    if (failedSources.has(reference.source)) {
      issues.push(decodeFailureIssue(reference));
      continue;
    }
    const metadata = metadataBySource.get(reference.source);
    if (!metadata) continue;
    issues.push(
      ...intrinsicQualityIssues(
        reference,
        metadata,
        warningScaleRatio,
        criticalScaleRatio
      )
    );
  }
  issues.push(...dimensionMismatchIssues(selectedReferences, metadataBySource));

  if (skippedSourceCount > 0) {
    issues.push(
      createStudioQualityIssue({
        code: "RASTER_PROBE_LIMIT_REACHED",
        category: "asset",
        severity: "review",
        title: "래스터 검사 표시 한도 도달",
        message: `성능 보호를 위해 이미지 원본 ${skippedSourceCount}개의 디코딩·해상도 검사를 생략했습니다.`,
        remediation: "현재 오류를 먼저 정리한 뒤 페이지 범위를 나누어 다시 검사하세요.",
        idSuffix: `${distinctSources.length}:${maxSources}`,
        evidence: {
          totalSourceCount: distinctSources.length,
          inspectedSourceCount: selectedSources.length,
          skippedSourceCount,
        },
      })
    );
  }

  const uniqueIssues = [...new Map(issues.map((issue) => [issue.id, issue])).values()];
  return {
    status: "complete",
    issues: uniqueIssues,
    assetReferenceCount: references.length,
    probedSourceCount: metadataBySource.size,
    skippedSourceCount,
  };
}
