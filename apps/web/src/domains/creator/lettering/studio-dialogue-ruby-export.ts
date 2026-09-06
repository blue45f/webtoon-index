/**
 * Dialogue ruby export bridge shared by PDF and PSD.
 *
 * Layout is deliberately delegated to the product cores:
 * - horizontal ruby: `planDialogueRubyOverlayPlacements`
 * - vertical-rl base: `layoutVerticalText`
 * - vertical ruby: `planDialogueVerticalRubyOverlayPlacements`
 *
 * This module only lowers those placements to positioned PDF text operations and serializes the
 * source annotation as deterministic XMP for formats (notably PSD) that cannot represent ruby as
 * an editable native text feature. It never invents a successful annotation when a source range is
 * malformed: every rejected range is returned in `unsupported`, while the original JSON-compatible
 * `rubySpans` value remains in the metadata record.
 */

import {
  layoutVerticalText,
  verticalBlockAlign,
  verticalTextItemGeometry,
  type VerticalTextLayout,
  type VerticalTextMeasurer,
} from "../studio-vertical-text";

import {
  estimateDialogueTextAdvanceWidth,
  planDialogueRubyOverlayPlacements,
  planDialogueVerticalRubyOverlayPlacements,
  readDialogueRubySpans,
  type StudioRubySpanInput,
  type StudioVerticalRubyIssue,
  type StudioVerticalRubyWarning,
} from "./studio-dialogue-ruby-layout";

import type { StudioPdfColor, StudioPdfOp } from "../render/studio-canvaskit-pdf-vector";

export const DIALOGUE_RUBY_EXPORT_METADATA_VERSION = 1;
export const DIALOGUE_RUBY_EXPORT_XMP_NAMESPACE = "https://toonspectrum.com/ns/dialogue-ruby/1.0/";

export type DialogueRubyExportDisposition =
  | "editable-positioned-pdf-text"
  | "visible-raster-metadata-psd";

export type DialogueRubyExportIssue = {
  readonly code:
    | StudioVerticalRubyIssue["code"]
    | "cross-line-span"
    | "invalid-span"
    | "metadata-not-json-compatible";
  readonly message: string;
  readonly spanIndex: number | null;
};

export type DialogueRubyExportWarning = {
  readonly code:
    | StudioVerticalRubyWarning["code"]
    | "font-metrics-approximated"
    | "horizontal-position-approximated"
    | "pdf-vertical-glyph-overlays"
    | "psd-ruby-raster-fallback";
  readonly message: string;
  readonly spanIndex: number | null;
};

export interface DialogueRubyExportMetadataRecord {
  readonly version: 1;
  readonly elementId: string;
  readonly layerName: string;
  readonly text: string;
  readonly writingMode: "horizontal-tb" | "vertical-rl";
  readonly rubySpans: unknown;
  readonly disposition: DialogueRubyExportDisposition;
}

export interface DialogueRubyExportXmpManifest {
  readonly version: 1;
  readonly records: readonly DialogueRubyExportMetadataRecord[];
}

export interface DialogueRubyTextExportInput {
  readonly elementId: string;
  readonly layerName?: string;
  readonly text: string;
  readonly rubySpans?: unknown;
  readonly vertical?: boolean;
  /** Text box inline extent in product px. Vertical-rl uses this as column length. */
  readonly width: number;
  readonly fontSize: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly fontFamily?: string;
  readonly fontStyle?: string;
  readonly align?: "left" | "center" | "right";
  readonly x?: number;
  readonly y?: number;
  readonly rubySizeRatio?: number;
  /** Optional product-quality width port. The deterministic CJK estimate is used when absent. */
  readonly measurer?: VerticalTextMeasurer;
}

export interface DialogueRubyPdfLoweringOptions {
  readonly fontResourceName: string;
  readonly color: StudioPdfColor;
  /** Product px to PDF pt. Defaults to CSS 96dpi -> PDF 72dpi. */
  readonly pxToPt?: number;
  readonly alpha?: number;
}

export interface DialogueRubyPdfPlan {
  readonly ops: readonly StudioPdfOp[];
  readonly baseOps: readonly StudioPdfOp[];
  readonly rubyOps: readonly StudioPdfOp[];
  readonly warnings: readonly DialogueRubyExportWarning[];
  readonly unsupported: readonly DialogueRubyExportIssue[];
  readonly metadata: DialogueRubyExportMetadataRecord | null;
  readonly verticalLayout: VerticalTextLayout | null;
}

type AcceptedRubySpan = StudioRubySpanInput & { readonly spanIndex: number };

function codePointBoundaries(text: string): ReadonlySet<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const char of text) {
    offset += char.length;
    boundaries.add(offset);
  }
  return boundaries;
}

function validateHorizontalRubySpans(
  text: string,
  value: unknown,
): { accepted: readonly AcceptedRubySpan[]; unsupported: readonly DialogueRubyExportIssue[] } {
  if (!Array.isArray(value) || value.length === 0) {
    return { accepted: Object.freeze([]), unsupported: Object.freeze([]) };
  }
  const boundaries = codePointBoundaries(text);
  const accepted: AcceptedRubySpan[] = [];
  const unsupported: DialogueRubyExportIssue[] = [];
  value.forEach((candidate, spanIndex) => {
    if (!candidate || typeof candidate !== "object") {
      unsupported.push({
        code: "invalid-span",
        message: "Ruby entries must be objects with start, end, and ruby fields.",
        spanIndex,
      });
      return;
    }
    const span = candidate as Partial<StudioRubySpanInput>;
    if (
      typeof span.start !== "number"
      || typeof span.end !== "number"
      || !Number.isFinite(span.start)
      || !Number.isFinite(span.end)
    ) {
      unsupported.push({
        code: "invalid-offset",
        message: "Ruby offsets must be finite numbers.",
        spanIndex,
      });
      return;
    }
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end)) {
      unsupported.push({
        code: "fractional-offset",
        message: "Ruby offsets must be integer UTF-16 boundaries.",
        spanIndex,
      });
      return;
    }
    if (span.start < 0 || span.end > text.length || span.start >= span.end) {
      unsupported.push({
        code: "out-of-range",
        message: `Ruby range ${span.start}..${span.end} is outside 0..${text.length}.`,
        spanIndex,
      });
      return;
    }
    if (!boundaries.has(span.start) || !boundaries.has(span.end)) {
      unsupported.push({
        code: "split-surrogate-pair",
        message: `Ruby range ${span.start}..${span.end} splits a Unicode code point.`,
        spanIndex,
      });
      return;
    }
    if (typeof span.ruby !== "string" || span.ruby.trim().length === 0) {
      unsupported.push({
        code: "empty-reading",
        message: "Ruby readings must contain a visible glyph.",
        spanIndex,
      });
      return;
    }
    if (text.slice(span.start, span.end).includes("\n")) {
      unsupported.push({
        code: "cross-line-span",
        message: `Ruby range ${span.start}..${span.end} crosses a horizontal line boundary.`,
        spanIndex,
      });
      return;
    }
    accepted.push({ start: span.start, end: span.end, ruby: span.ruby, spanIndex });
  });

  accepted.sort((left, right) => left.start - right.start || left.end - right.end || left.spanIndex - right.spanIndex);
  const nonOverlapping: AcceptedRubySpan[] = [];
  for (const span of accepted) {
    const prior = nonOverlapping[nonOverlapping.length - 1];
    if (prior && span.start < prior.end) {
      unsupported.push({
        code: "overlapping-span",
        message: `Ruby range ${span.start}..${span.end} overlaps accepted range ${prior.start}..${prior.end}.`,
        spanIndex: span.spanIndex,
      });
    } else {
      nonOverlapping.push(span);
    }
  }
  return {
    accepted: Object.freeze(nonOverlapping.map((span) => Object.freeze(span))),
    unsupported: Object.freeze(unsupported.map((issue) => Object.freeze(issue))),
  };
}

const ESTIMATED_TEXT_MEASURER: VerticalTextMeasurer = {
  measureWidth(text, fontPx) {
    return estimateDialogueTextAdvanceWidth(text, fontPx, 0);
  },
};

function hasRubyInput(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export function createDialogueRubyMetadataRecord(
  input: DialogueRubyTextExportInput,
  disposition: DialogueRubyExportDisposition,
): DialogueRubyExportMetadataRecord | null {
  if (!hasRubyInput(input.rubySpans)) return null;
  return Object.freeze({
    version: DIALOGUE_RUBY_EXPORT_METADATA_VERSION,
    elementId: input.elementId,
    layerName: input.layerName?.trim() || input.elementId,
    text: input.text,
    writingMode: input.vertical ? "vertical-rl" : "horizontal-tb",
    // Snapshot now, before asynchronous raster/PSD work can yield to UI mutations.
    rubySpans: canonicalJsonValue(input.rubySpans, "rubySpans", new Set()),
    disposition,
  });
}

type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

function canonicalJsonValue(value: unknown, path: string, seen: Set<object>): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} is not JSON-compatible.`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle.`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => canonicalJsonValue(entry, `${path}[${index}]`, seen));
    }
    const record = value as Record<string, unknown>;
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalJsonValue(record[key], `${path}.${key}`, seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/\r/gu, "&#13;");
}

function unescapeXmlText(value: string): string {
  return value
    .replace(/&#13;/gu, "\r")
    .replace(/&gt;/gu, ">")
    .replace(/&lt;/gu, "<")
    .replace(/&amp;/gu, "&");
}

/** Deterministic document-level XMP packet used by PSD and optionally by other format adapters. */
export function buildDialogueRubyExportXmp(
  records: readonly DialogueRubyExportMetadataRecord[],
): string {
  const ordered = [...records].sort(
    (left, right) => left.elementId.localeCompare(right.elementId, "en") || left.layerName.localeCompare(right.layerName, "en"),
  );
  const manifest = canonicalJsonValue({
    version: DIALOGUE_RUBY_EXPORT_METADATA_VERSION,
    records: ordered,
  }, "dialogueRubyManifest", new Set());
  const json = JSON.stringify(manifest);
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:tsruby="${DIALOGUE_RUBY_EXPORT_XMP_NAMESPACE}">`,
    `<tsruby:manifest>${escapeXmlText(json)}</tsruby:manifest>`,
    "</rdf:Description>",
    "</rdf:RDF>",
    "</x:xmpmeta>",
    '<?xpacket end="w"?>',
  ].join("");
}

export function parseDialogueRubyExportXmp(xmp: string): DialogueRubyExportXmpManifest | null {
  const match = /<tsruby:manifest>([\s\S]*?)<\/tsruby:manifest>/u.exec(xmp);
  if (!match) return null;
  try {
    const value = JSON.parse(unescapeXmlText(match[1]!)) as Partial<DialogueRubyExportXmpManifest>;
    if (value.version !== DIALOGUE_RUBY_EXPORT_METADATA_VERSION || !Array.isArray(value.records)) return null;
    return value as DialogueRubyExportXmpManifest;
  } catch {
    return null;
  }
}

function toPdfTextOp(
  text: string,
  xPx: number,
  yPx: number,
  sizePx: number,
  input: DialogueRubyPdfLoweringOptions,
  matrix?: readonly [number, number, number, number],
  actualText = text,
): StudioPdfOp {
  const scale = input.pxToPt ?? 0.75;
  return {
    op: "text",
    text,
    actualText,
    font: input.fontResourceName,
    size: sizePx * scale,
    x: xPx * scale,
    y: yPx * scale,
    color: input.color,
    ...(matrix ? { matrix } : {}),
    ...(input.alpha === undefined ? {} : { alpha: input.alpha }),
  };
}

function horizontalLineRanges(text: string): readonly { text: string; start: number; end: number; line: number }[] {
  const ranges: { text: string; start: number; end: number; line: number }[] = [];
  let start = 0;
  let line = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index !== text.length && text[index] !== "\n") continue;
    ranges.push({ text: text.slice(start, index), start, end: index, line });
    start = index + 1;
    line += 1;
  }
  return ranges;
}

function horizontalAlignedX(
  line: string,
  width: number,
  fontSize: number,
  letterSpacing: number,
  align: "left" | "center" | "right",
): number {
  const advance = estimateDialogueTextAdvanceWidth(line, fontSize, letterSpacing);
  if (align === "center") return (width - advance) / 2;
  if (align === "right") return width - advance;
  return 0;
}

/**
 * Lowers base dialogue and ruby to native PDF text operators. Vertical text is intentionally a set
 * of positioned glyph overlays because PDF has no editable `vertical-rl + ruby` primitive. The
 * returned warning makes that approximation machine-readable; all strings remain Unicode text.
 */
export function planDialogueRubyPdfOps(
  input: DialogueRubyTextExportInput,
  pdf: DialogueRubyPdfLoweringOptions,
): DialogueRubyPdfPlan {
  const text = typeof input.text === "string" ? input.text : "";
  const fontSize = Number.isFinite(input.fontSize) && input.fontSize > 0 ? input.fontSize : 16;
  const lineHeight = Number.isFinite(input.lineHeight) && (input.lineHeight ?? 0) > 0 ? input.lineHeight! : 1.4;
  const letterSpacing = Number.isFinite(input.letterSpacing) ? input.letterSpacing ?? 0 : 0;
  const width = Number.isFinite(input.width) && input.width > 0 ? input.width : fontSize;
  const x = Number.isFinite(input.x) ? input.x ?? 0 : 0;
  const y = Number.isFinite(input.y) ? input.y ?? 0 : 0;
  const align = input.align === "center" || input.align === "right" ? input.align : "left";
  const baseOps: StudioPdfOp[] = [];
  const rubyOps: StudioPdfOp[] = [];
  const warnings: DialogueRubyExportWarning[] = [];
  const unsupported: DialogueRubyExportIssue[] = [];
  const spans = readDialogueRubySpans(input.rubySpans);
  let metadata: DialogueRubyExportMetadataRecord | null = null;
  try {
    metadata = createDialogueRubyMetadataRecord(input, "editable-positioned-pdf-text");
  } catch (error) {
    unsupported.push({
      code: "metadata-not-json-compatible",
      message: error instanceof Error ? error.message : String(error),
      spanIndex: null,
    });
  }
  let verticalLayout: VerticalTextLayout | null = null;

  if (!input.vertical) {
    const validated = validateHorizontalRubySpans(text, input.rubySpans);
    unsupported.push(...validated.unsupported);
    const lineRanges = horizontalLineRanges(text);
    for (const range of lineRanges) {
      const lineTop = range.line * fontSize * lineHeight;
      if (range.text.length > 0) {
        baseOps.push(toPdfTextOp(
          range.text,
          x + horizontalAlignedX(range.text, width, fontSize, letterSpacing, align),
          y + lineTop + fontSize * 0.82,
          fontSize,
          pdf,
          undefined,
          range.line < lineRanges.length - 1 ? `${range.text}\n` : range.text,
        ));
      }
      const localSpans = validated.accepted
        .filter((span) => span.start >= range.start && span.end <= range.end)
        .map((span) => ({ start: span.start - range.start, end: span.end - range.start, ruby: span.ruby }));
      const placements = planDialogueRubyOverlayPlacements(range.text, localSpans, {
        fontSize,
        letterSpacing,
        textWidth: width,
        align,
        rubySizeRatio: input.rubySizeRatio,
      });
      for (const placement of placements) {
        const rubyAdvance = estimateDialogueTextAdvanceWidth(
          placement.ruby,
          placement.rubyFontSize,
          letterSpacing * (placement.rubyFontSize / fontSize),
        );
        rubyOps.push(toPdfTextOp(
          placement.ruby,
          x + placement.x + (placement.baseWidth - rubyAdvance) / 2,
          y + lineTop + placement.y + placement.rubyFontSize * 0.82,
          placement.rubyFontSize,
          pdf,
        ));
      }
    }
    if (rubyOps.length > 0) {
      warnings.push({
        code: "horizontal-position-approximated",
        message: "PDF ruby uses the product's deterministic CJK advance estimate; embedded-font shaping can differ slightly.",
        spanIndex: null,
      });
    }
  } else {
    const measurer = input.measurer ?? ESTIMATED_TEXT_MEASURER;
    verticalLayout = layoutVerticalText({
      text,
      fontSize,
      lineHeight,
      letterSpacing,
      fontFamily: input.fontFamily ?? "Pretendard, sans-serif",
      fontStyle: input.fontStyle ?? "bold",
      maxColumnLength: width,
      blockAlign: verticalBlockAlign(align),
    }, measurer);
    for (const column of verticalLayout.columns) {
      for (const item of column.items) {
        const geometry = verticalTextItemGeometry(item, fontSize);
        if (item.form === "rotated") {
          baseOps.push(toPdfTextOp(
            item.text,
            // Konva rotates around the text node's top-left. Its baseline starts ~0.82em below
            // that origin, so a clockwise 90deg rotation moves the baseline 0.82em to the left.
            x + item.x - fontSize * 0.82,
            y + item.y,
            fontSize,
            pdf,
            [0, 1, -1, 0],
          ));
          continue;
        }
        if (item.form === "tate-chu-yoko") {
          const measured = Math.max(1, measurer.measureWidth(
            item.text,
            fontSize,
            input.fontFamily ?? "Pretendard, sans-serif",
            input.fontStyle ?? "bold",
          ));
          const localBoxWidth = geometry.boxWidth;
          const localX = Math.max(0, (localBoxWidth - measured) / 2);
          baseOps.push(toPdfTextOp(
            item.text,
            x + item.x + localX * geometry.scaleX,
            y + item.y + fontSize * 0.82,
            fontSize,
            pdf,
            [geometry.scaleX, 0, 0, 1],
          ));
          continue;
        }
        const glyphs = [...item.text].filter((char) => char !== "\n");
        glyphs.forEach((char, glyphIndex) => {
          const glyphWidth = estimateDialogueTextAdvanceWidth(char, fontSize, 0);
          baseOps.push(toPdfTextOp(
            char,
            x + item.x + Math.max(0, (fontSize - glyphWidth) / 2),
            y + item.y + glyphIndex * item.glyphAdvance + fontSize * 0.82,
            fontSize,
            pdf,
          ));
        });
      }
    }
    const verticalRuby = planDialogueVerticalRubyOverlayPlacements(text, spans, verticalLayout, {
      fontSize,
      lineHeight,
      letterSpacing,
      rubySizeRatio: input.rubySizeRatio,
    });
    warnings.push(...verticalRuby.warnings);
    unsupported.push(...verticalRuby.unsupported);
    for (const placement of verticalRuby.placements) {
      [...placement.ruby].forEach((char, glyphIndex) => {
        const glyphWidth = estimateDialogueTextAdvanceWidth(char, placement.rubyFontSize, 0);
        rubyOps.push(toPdfTextOp(
          char,
          x + placement.x + Math.max(0, (placement.width - glyphWidth) / 2),
          y + placement.y + glyphIndex * placement.rubyGlyphAdvance + placement.rubyFontSize * 0.82,
          placement.rubyFontSize,
          pdf,
        ));
      });
    }
    if (!input.measurer) {
      warnings.push({
        code: "font-metrics-approximated",
        message: "Vertical export layout used the deterministic CJK width estimate because no font measurer was supplied.",
        spanIndex: null,
      });
    }
    if (spans) {
      warnings.push({
        code: "pdf-vertical-glyph-overlays",
        message: "PDF has no editable vertical-ruby primitive; base and ruby remain Unicode positioned glyph overlays.",
        spanIndex: null,
      });
    }
  }

  return Object.freeze({
    ops: Object.freeze([...baseOps, ...rubyOps]),
    baseOps: Object.freeze(baseOps),
    rubyOps: Object.freeze(rubyOps),
    warnings: Object.freeze(warnings.map((warning) => Object.freeze(warning))),
    unsupported: Object.freeze(unsupported.map((issue) => Object.freeze(issue))),
    metadata,
    verticalLayout,
  });
}
