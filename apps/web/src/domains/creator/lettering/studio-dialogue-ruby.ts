/**
 * Partial-range lettering + 루비 (furigana) for dialogue text/bubbles.
 *
 * CSP EX stores ruby as range annotations. We keep a compact, JSON-serializable
 * `rubySpans` array on dialogue elements so save/reload and undo stay lossless without
 * inventing a full rich-text engine. Rendering can map spans to <rt> or stacked glyphs.
 */
import { isEffectivelyLocked } from "../studio-layers";

import {
  isDialogueElement,
  type DialogueElementLike,
  type DialoguePageLike,
} from "./studio-dialogue-batch";

import type { StudioDialogueRubySpan } from "../studio-element-model";

export type DialogueRubySpan = StudioDialogueRubySpan;

export type DialogueRangeFormatPatch = {
  readonly fontSize?: number;
  readonly fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  readonly textColor?: string;
};

export type ApplyDialogueRubyRequest = {
  readonly pageId: string;
  readonly elementId: string;
  /** Current draft text (may differ from stored until commit). */
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly ruby: string;
  readonly includeLocked?: boolean;
};

export type ApplyDialogueRangeFormatRequest = {
  readonly pageId: string;
  readonly elementId: string;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  readonly patch: DialogueRangeFormatPatch;
  readonly includeLocked?: boolean;
};

type DialogueRubyElement = DialogueElementLike & {
  rubySpans?: readonly DialogueRubySpan[];
  /** Optional range styles layered on top of base typography (subset of full rich text). */
  rangeFormats?: readonly {
    start: number;
    end: number;
    fontSize?: number;
    fontStyle?: string;
    textColor?: string;
  }[];
};

const MAX_RUBY_CODE_UNITS = 80;
const MAX_SPANS_PER_ELEMENT = 64;

function finiteOffset(value: unknown, textLength: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const offset = Math.trunc(value);
  if (offset < 0 || offset > textLength) return null;
  return offset;
}

function sanitizeRuby(value: string): string | null {
  if (typeof value !== "string") return null;
  let safe = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 31 || (code >= 127 && code <= 159)) continue;
    safe += character;
  }
  safe = safe.normalize("NFKC").trim().slice(0, MAX_RUBY_CODE_UNITS);
  return safe || null;
}

function normalizeSpan(
  start: number,
  end: number,
  ruby: string
): DialogueRubySpan | null {
  if (start >= end) return null;
  const reading = sanitizeRuby(ruby);
  if (!reading) return null;
  return Object.freeze({ start, end, ruby: reading });
}

function spansOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number }
): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Attach or replace a ruby annotation on a text range. Overlapping prior spans are removed.
 * No-op (same reference) when locked / invalid / empty reading.
 */
export function applyDialogueRubySpan(
  pages: readonly DialoguePageLike[],
  request: ApplyDialogueRubyRequest
): readonly DialoguePageLike[] {
  const text = typeof request.text === "string" ? request.text : "";
  const start = finiteOffset(request.start, text.length);
  const end = finiteOffset(request.end, text.length);
  if (start == null || end == null || start >= end) return pages;
  const span = normalizeSpan(start, end, request.ruby);
  if (!span) return pages;

  let changed = false;
  const next = pages.map((page) => {
    if (page.id !== request.pageId) return page;
    const groups = page.groups ?? [];
    const elements = page.elements.map((element) => {
      if (element.id !== request.elementId || !isDialogueElement(element)) return element;
      if (!request.includeLocked && isEffectivelyLocked(element, groups)) return element;
      const rich = element as DialogueRubyElement;
      const existing = [...(rich.rubySpans ?? [])].filter(
        (candidate) => !spansOverlap(candidate, span)
      );
      if (existing.length >= MAX_SPANS_PER_ELEMENT) return element;
      existing.push(span);
      existing.sort((left, right) => left.start - right.start || left.end - right.end);
      changed = true;
      return {
        ...rich,
        text,
        rubySpans: existing.map((item) => Object.freeze({ ...item })),
      };
    });
    return changed ? { ...page, elements } : page;
  });
  return changed ? next : pages;
}

/** Remove all ruby spans that intersect [start, end). */
export function clearDialogueRubyRange(
  pages: readonly DialoguePageLike[],
  request: Omit<ApplyDialogueRubyRequest, "ruby">
): readonly DialoguePageLike[] {
  const text = typeof request.text === "string" ? request.text : "";
  const start = finiteOffset(request.start, text.length);
  const end = finiteOffset(request.end, text.length);
  if (start == null || end == null || start >= end) return pages;

  let changed = false;
  const next = pages.map((page) => {
    if (page.id !== request.pageId) return page;
    const groups = page.groups ?? [];
    const elements = page.elements.map((element) => {
      if (element.id !== request.elementId || !isDialogueElement(element)) return element;
      if (!request.includeLocked && isEffectivelyLocked(element, groups)) return element;
      const rich = element as DialogueRubyElement;
      const existing = rich.rubySpans ?? [];
      if (existing.length === 0) return element;
      const filtered = existing.filter(
        (candidate) => !spansOverlap(candidate, { start, end })
      );
      if (filtered.length === existing.length) return element;
      changed = true;
      return {
        ...rich,
        text,
        rubySpans: filtered.length > 0 ? filtered.map((item) => Object.freeze({ ...item })) : undefined,
      };
    });
    return changed ? { ...page, elements } : page;
  });
  return changed ? next : pages;
}

/**
 * Partial-range typography overlay (bold/size/color on a span). Stored beside base fields so
 * full-element format and range format can coexist until a full rich-text model lands.
 */
export function applyDialogueRangeFormat(
  pages: readonly DialoguePageLike[],
  request: ApplyDialogueRangeFormatRequest
): readonly DialoguePageLike[] {
  const text = typeof request.text === "string" ? request.text : "";
  const start = finiteOffset(request.start, text.length);
  const end = finiteOffset(request.end, text.length);
  if (start == null || end == null || start >= end) return pages;
  const patch = request.patch;
  const hasPatch =
    patch.fontSize != null || patch.fontStyle != null || patch.textColor != null;
  if (!hasPatch) return pages;

  let changed = false;
  const next = pages.map((page) => {
    if (page.id !== request.pageId) return page;
    const groups = page.groups ?? [];
    const elements = page.elements.map((element) => {
      if (element.id !== request.elementId || !isDialogueElement(element)) return element;
      if (!request.includeLocked && isEffectivelyLocked(element, groups)) return element;
      const rich = element as DialogueRubyElement;
      const existing = [...(rich.rangeFormats ?? [])].filter(
        (candidate) => !spansOverlap(candidate, { start, end })
      );
      if (existing.length >= MAX_SPANS_PER_ELEMENT) return element;
      existing.push({
        start,
        end,
        ...(patch.fontSize != null ? { fontSize: patch.fontSize } : {}),
        ...(patch.fontStyle != null ? { fontStyle: patch.fontStyle } : {}),
        ...(patch.textColor != null ? { textColor: patch.textColor } : {}),
      });
      existing.sort((left, right) => left.start - right.start || left.end - right.end);
      changed = true;
      return { ...rich, text, rangeFormats: existing };
    });
    return changed ? { ...page, elements } : page;
  });
  return changed ? next : pages;
}

/** Plain-text preview of ruby for export / accessibility: 漢字(かんじ). */
export function formatDialogueTextWithRubyPreview(
  text: string,
  spans: readonly DialogueRubySpan[] | undefined
): string {
  if (!spans?.length) return text;
  const ordered = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = 0;
  let out = "";
  for (const span of ordered) {
    if (span.start < cursor || span.end > text.length) continue;
    out += text.slice(cursor, span.start);
    out += `${text.slice(span.start, span.end)}(${span.ruby})`;
    cursor = span.end;
  }
  out += text.slice(cursor);
  return out;
}
