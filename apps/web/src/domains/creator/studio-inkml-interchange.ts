/**
 * Product interchange orchestration for the bounded InkML codec.
 *
 * The codec and conformance validator stay DOM/UI independent; this layer maps retained Studio
 * freehand elements to public InkML traces and maps validated traces back to conservative pen
 * elements. Unsupported element semantics are reported instead of silently rasterizing them.
 */

import {
  STUDIO_INKML_MEDIA_TYPE,
  decodeStudioInkMl,
  encodeStudioInkMl,
  studioDrawElementToInkMlTrace,
  type StudioInkMlCodecOptions,
  type StudioInkMlTraceInput,
} from "./studio-inkml-codec";
import {
  validateStudioInkMlConformance,
  type StudioInkMlConformanceReceipt,
} from "./studio-inkml-conformance";

import type { DrawEl } from "./studio-element-model";

export type StudioInkMlExportSkipReason =
  | "eraser-semantic-not-representable"
  | "hidden-element"
  | "non-freehand-shape";

export interface StudioInkMlExportSkip {
  readonly elementId: string;
  readonly reason: StudioInkMlExportSkipReason;
}

export interface StudioInkMlExportResult {
  readonly xml: string;
  readonly mediaType: typeof STUDIO_INKML_MEDIA_TYPE;
  readonly exportedStrokeIds: readonly string[];
  readonly skipped: readonly StudioInkMlExportSkip[];
  readonly conformance: StudioInkMlConformanceReceipt;
}

export interface StudioInkMlImportOptions extends StudioInkMlCodecOptions {
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly opacity?: number;
  readonly brushId?: string;
  readonly idPrefix?: string;
}

export interface StudioInkMlImportResult {
  readonly elements: readonly DrawEl[];
  readonly ignoredChannels: readonly string[];
  readonly conformance: StudioInkMlConformanceReceipt;
}

function conformancePassed(
  receipt: StudioInkMlConformanceReceipt,
): boolean {
  return (
    receipt.negotiation.status === "accepted"
    && receipt.result.conformance === "passed"
    && receipt.result.normalization === "stable"
    && receipt.error === null
  );
}

function requireConformance(
  receipt: StudioInkMlConformanceReceipt,
  operation: "가져오기" | "내보내기",
): void {
  if (conformancePassed(receipt)) return;
  const code = receipt.error?.code ?? receipt.negotiation.error?.code ?? "UNKNOWN";
  throw new Error(`InkML ${operation} 적합성 검사에 실패했습니다(${code}).`);
}

function normalizedImportOptions(
  options: StudioInkMlImportOptions,
): Required<Pick<StudioInkMlImportOptions, "brushId" | "idPrefix" | "opacity" | "stroke" | "strokeWidth">> {
  const stroke = options.stroke ?? "#111827";
  const strokeWidth = options.strokeWidth ?? 4;
  const opacity = options.opacity ?? 1;
  const brushId = options.brushId ?? "pen";
  const idPrefix = options.idPrefix ?? "inkml-";
  if (!/^#[0-9a-f]{6}$/iu.test(stroke)) {
    throw new Error("InkML 가져오기 선 색은 6자리 hex 색상이어야 해요.");
  }
  if (!Number.isFinite(strokeWidth) || strokeWidth < 0.25 || strokeWidth > 512) {
    throw new Error("InkML 가져오기 선 굵기는 0.25px 이상 512px 이하여야 해요.");
  }
  if (!Number.isFinite(opacity) || opacity < 0.05 || opacity > 1) {
    throw new Error("InkML 가져오기 불투명도는 0.05 이상 1 이하여야 해요.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(brushId)) {
    throw new Error("InkML 가져오기 브러시 ID가 올바르지 않아요.");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,39}$/iu.test(idPrefix)) {
    throw new Error("InkML 가져오기 요소 ID 접두사가 올바르지 않아요.");
  }
  return { stroke: stroke.toLowerCase(), strokeWidth, opacity, brushId, idPrefix };
}

/**
 * Exports visible pen freehand strokes and returns an explicit loss list for unsupported semantics.
 */
export async function exportStudioInkMl(
  elements: readonly Readonly<DrawEl>[],
  options: StudioInkMlCodecOptions = {},
): Promise<StudioInkMlExportResult> {
  const traces: StudioInkMlTraceInput[] = [];
  const exportedStrokeIds: string[] = [];
  const skipped: StudioInkMlExportSkip[] = [];
  for (const element of elements) {
    if (element.hidden) {
      skipped.push({ elementId: element.id, reason: "hidden-element" });
      continue;
    }
    if (element.kind !== undefined && element.kind !== "freehand") {
      skipped.push({ elementId: element.id, reason: "non-freehand-shape" });
      continue;
    }
    if (element.mode === "eraser") {
      skipped.push({
        elementId: element.id,
        reason: "eraser-semantic-not-representable",
      });
      continue;
    }
    traces.push(studioDrawElementToInkMlTrace(element));
    exportedStrokeIds.push(element.id);
  }
  if (traces.length === 0) {
    throw new Error("InkML로 내보낼 수 있는 보이는 펜 자유곡선이 없어요.");
  }
  const xml = encodeStudioInkMl(traces, options);
  const conformance = await validateStudioInkMlConformance(xml, options);
  requireConformance(conformance, "내보내기");
  return Object.freeze({
    xml,
    mediaType: STUDIO_INKML_MEDIA_TYPE,
    exportedStrokeIds: Object.freeze(exportedStrokeIds),
    skipped: Object.freeze(skipped.map((item) => Object.freeze(item))),
    conformance,
  });
}

/** Imports only after the XML survives negotiation, bounded parsing, and deterministic round-trip. */
export async function importStudioInkMl(
  source: unknown,
  options: StudioInkMlImportOptions = {},
): Promise<StudioInkMlImportResult> {
  if (typeof source !== "string") {
    throw new Error("InkML 가져오기 입력은 UTF-8 XML 문자열이어야 해요.");
  }
  const normalized = normalizedImportOptions(options);
  const conformance = await validateStudioInkMlConformance(source, options);
  requireConformance(conformance, "가져오기");
  const document = decodeStudioInkMl(source, options);
  const elements = document.traces.map((trace): DrawEl => ({
    id: `${normalized.idPrefix}${trace.id}`,
    type: "draw",
    kind: "freehand",
    mode: "pen",
    points: [...trace.points],
    stroke: normalized.stroke,
    strokeWidth: normalized.strokeWidth,
    opacity: normalized.opacity,
    brush: normalized.brushId,
    pressures: [...trace.pressures],
    tiltXs: [...trace.tiltXs],
    tiltYs: [...trace.tiltYs],
    twists: [...trace.twists],
    speeds: [...trace.speeds],
    tangentialPressures: [...trace.tangentialPressures],
  }));
  return Object.freeze({
    elements: Object.freeze(elements),
    ignoredChannels: Object.freeze([...document.ignoredChannels]),
    conformance,
  });
}

export function studioInkMlFileName(title: string): string {
  const safe = Array.from(title.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && !"\\/:*?\"<>|".includes(character);
    })
    .join("")
    .trim()
    .slice(0, 120);
  return `${safe || "toonspectrum-ink"}.inkml`;
}
