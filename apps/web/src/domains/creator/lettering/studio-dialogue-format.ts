/**
 * Multi-select lettering format + text→bubble conversion (CLIP STUDIO EX story gap).
 *
 * Pure document transforms only: no Konva/React. Callers pass multi-selected text/bubble
 * ids and commit the returned page array as one undo step. Locked elements are skippable
 * (fail-closed for that id) and no-op inputs return the original pages reference.
 */
import { isEffectivelyLocked } from "../studio-layers";

import {
  isDialogueElement,
  type DialogueElementLike,
  type DialoguePageLike,
} from "./studio-dialogue-batch";

import type { BubbleVariant } from "../studio-assets";

export type DialogueFormatAlign = "left" | "center" | "right";
export type DialogueFormatFontStyle = "normal" | "bold" | "italic" | "bold italic";

/** Dialogue element fields used by format/conversion beyond the batch list contract. */
type DialogueFormatElement = DialogueElementLike & {
  fontSize?: number;
  font?: string;
  fill?: string;
  textFill?: string;
  align?: DialogueFormatAlign;
  fontStyle?: DialogueFormatFontStyle;
  letterSpacing?: number;
  lineHeight?: number;
  vertical?: boolean;
  height?: number;
  rotation?: number;
  stroke?: string;
  strokeWidth?: number;
  textPath?: unknown;
  fillType?: unknown;
  gradientColorStart?: unknown;
  gradientColorEnd?: unknown;
  gradientDirection?: unknown;
};

/** Shared typography patch applied to selected bubble and free text dialogue. */
export type DialogueFormatPatch = {
  fontSize?: number;
  font?: string;
  /** Text fill / bubble textFill. */
  textColor?: string;
  align?: DialogueFormatAlign;
  fontStyle?: DialogueFormatFontStyle;
  letterSpacing?: number;
  lineHeight?: number;
  vertical?: boolean;
};

export type ApplyDialogueFormatRequest = {
  /** Element ids across one or many pages (multi-select / range). */
  elementIds: readonly string[];
  patch: DialogueFormatPatch;
  /** When false (default), locked dialogue is left untouched. */
  includeLocked?: boolean;
};

export type ConvertTextToBubbleRequest = {
  elementIds: readonly string[];
  /** Default speech bubble. Unknown values fall back to speech. */
  variant?: BubbleVariant | string;
  includeLocked?: boolean;
  /**
   * Optional explicit id map for deterministic tests. Missing entries keep the source id
   * (in-place type conversion) so undo/history and selection stay stable.
   */
  idMap?: ReadonlyMap<string, string> | Record<string, string>;
};

const BUBBLE_VARIANTS = new Set<string>([
  "speech",
  "double",
  "thought",
  "shout",
  "box",
  "whisper",
  "scared",
  "system",
  "heart",
  "phone",
  "angry",
]);

function resolveVariant(value: string | undefined): BubbleVariant {
  if (value && BUBBLE_VARIANTS.has(value)) return value as BubbleVariant;
  return "speech";
}

function finitePositive(value: unknown, minimum: number, maximum: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizePatch(patch: DialogueFormatPatch): DialogueFormatPatch | null {
  const next: DialogueFormatPatch = {};
  if (patch.fontSize != null) {
    const fontSize = finitePositive(patch.fontSize, 6, 400);
    if (fontSize == null) return null;
    next.fontSize = Math.round(fontSize);
  }
  if (typeof patch.font === "string") {
    const font = patch.font.trim().slice(0, 120);
    if (font) next.font = font;
  }
  if (typeof patch.textColor === "string") {
    const textColor = patch.textColor.trim().slice(0, 64);
    if (textColor) next.textColor = textColor;
  }
  if (patch.align === "left" || patch.align === "center" || patch.align === "right") {
    next.align = patch.align;
  }
  if (
    patch.fontStyle === "normal"
    || patch.fontStyle === "bold"
    || patch.fontStyle === "italic"
    || patch.fontStyle === "bold italic"
  ) {
    next.fontStyle = patch.fontStyle;
  }
  if (patch.letterSpacing != null) {
    const letterSpacing = finitePositive(patch.letterSpacing, -20, 80);
    if (letterSpacing == null) return null;
    next.letterSpacing = letterSpacing;
  }
  if (patch.lineHeight != null) {
    const lineHeight = finitePositive(patch.lineHeight, 0.6, 4);
    if (lineHeight == null) return null;
    next.lineHeight = lineHeight;
  }
  if (typeof patch.vertical === "boolean") next.vertical = patch.vertical;
  return Object.keys(next).length > 0 ? next : null;
}

function lookupIdMap(
  idMap: ConvertTextToBubbleRequest["idMap"] | undefined,
  sourceId: string
): string {
  if (!idMap) return sourceId;
  if (idMap instanceof Map) return idMap.get(sourceId) ?? sourceId;
  const record = idMap as Record<string, string>;
  return Object.prototype.hasOwnProperty.call(record, sourceId)
    ? record[sourceId] ?? sourceId
    : sourceId;
}

function hasElementId(pages: readonly DialoguePageLike[], id: string): boolean {
  return pages.some((page) => page.elements.some((element) => element.id === id));
}

function applyPatchToElement(
  element: DialogueFormatElement,
  patch: DialogueFormatPatch
): DialogueFormatElement {
  if (element.type === "text") {
    return {
      ...element,
      ...(patch.fontSize != null ? { fontSize: patch.fontSize } : {}),
      ...(patch.font != null ? { font: patch.font } : {}),
      ...(patch.textColor != null ? { fill: patch.textColor } : {}),
      ...(patch.align != null ? { align: patch.align } : {}),
      ...(patch.fontStyle != null ? { fontStyle: patch.fontStyle } : {}),
      ...(patch.letterSpacing != null ? { letterSpacing: patch.letterSpacing } : {}),
      ...(patch.lineHeight != null ? { lineHeight: patch.lineHeight } : {}),
      ...(patch.vertical != null ? { vertical: patch.vertical } : {}),
    };
  }
  // bubble
  return {
    ...element,
    ...(patch.fontSize != null ? { fontSize: patch.fontSize } : {}),
    ...(patch.font != null ? { font: patch.font } : {}),
    ...(patch.textColor != null ? { textFill: patch.textColor } : {}),
    ...(patch.align != null ? { align: patch.align } : {}),
    ...(patch.fontStyle != null ? { fontStyle: patch.fontStyle } : {}),
    ...(patch.lineHeight != null ? { lineHeight: patch.lineHeight } : {}),
    ...(patch.vertical != null ? { vertical: patch.vertical } : {}),
  };
}

function estimatedBubbleHeight(element: DialogueFormatElement): number {
  const fontSize = finitePositive(element.fontSize, 6, 400) ?? 24;
  const width = finitePositive(element.width, 24, 10_000) ?? 180;
  const text = typeof element.text === "string" ? element.text : "";
  const lines = Math.max(1, text.split("\n").length);
  const charsPerLine = Math.max(4, Math.floor(width / Math.max(8, fontSize * 0.55)));
  const wrapped = Math.max(lines, Math.ceil(Math.max(1, text.length) / charsPerLine));
  return Math.max(64, Math.round(fontSize * 1.35 * wrapped + 36));
}

function textToBubble(
  element: DialogueFormatElement,
  variant: BubbleVariant,
  nextId: string
): DialogueFormatElement {
  const fontSize = finitePositive(element.fontSize, 6, 400) ?? 24;
  const width = finitePositive(element.width, 48, 10_000) ?? Math.max(160, fontSize * 8);
  const height = finitePositive(element.height, 48, 10_000) ?? estimatedBubbleHeight(element);
  const fill = typeof element.fill === "string" && element.fill.trim() ? element.fill : "#111111";
  return {
    ...element,
    id: nextId,
    type: "bubble",
    variant,
    text: typeof element.text === "string" ? element.text : "",
    x: finitePositive(element.x, -100_000, 100_000) ?? 24,
    y: finitePositive(element.y, -100_000, 100_000) ?? 24,
    width,
    height,
    fill: "#ffffff",
    textFill: fill,
    rotation: finitePositive(element.rotation, -3600, 3600) ?? 0,
    font: typeof element.font === "string" ? element.font : undefined,
    fontSize,
    lineHeight: typeof element.lineHeight === "number" ? element.lineHeight : undefined,
    vertical: element.vertical === true,
    align:
      element.align === "left" || element.align === "center" || element.align === "right"
        ? element.align
        : "center",
    fontStyle:
      element.fontStyle === "normal"
      || element.fontStyle === "bold"
      || element.fontStyle === "italic"
      || element.fontStyle === "bold italic"
        ? element.fontStyle
        : undefined,
    stroke: typeof element.stroke === "string" ? element.stroke : undefined,
    strokeWidth: typeof element.strokeWidth === "number" ? element.strokeWidth : undefined,
    // Drop free-text-only path/letter-spacing fields that bubbles do not share.
    letterSpacing: undefined,
    textPath: undefined,
    fillType: undefined,
    gradientColorStart: undefined,
    gradientColorEnd: undefined,
    gradientDirection: undefined,
  };
}

/**
 * Apply typography to every unlocked (or includeLocked) dialogue element in `elementIds`.
 * One returned document for one undo step. Unrelated elements keep reference identity.
 */
export function applyDialogueFormatPatch(
  pages: readonly DialoguePageLike[],
  request: ApplyDialogueFormatRequest
): readonly DialoguePageLike[] {
  const patch = normalizePatch(request.patch);
  if (!patch || request.elementIds.length === 0) return pages;
  const targets = new Set(
    request.elementIds.filter((id) => typeof id === "string" && id.length > 0)
  );
  if (targets.size === 0) return pages;
  const includeLocked = request.includeLocked === true;
  let changed = false;
  const next = pages.map((page) => {
    const groups = page.groups ?? [];
    let pageChanged = false;
    const elements = page.elements.map((element) => {
      if (!targets.has(element.id) || !isDialogueElement(element)) return element;
      if (!includeLocked && isEffectivelyLocked(element, groups)) return element;
      const patched = applyPatchToElement(element as DialogueFormatElement, patch);
      if (patched === element) return element;
      pageChanged = true;
      return patched;
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? next : pages;
}

/**
 * Convert free-text dialogue elements into speech bubbles while preserving position/text/style.
 * Bubble sources are left unchanged. Returns original pages when nothing converts.
 */
export function convertTextElementsToBubbles(
  pages: readonly DialoguePageLike[],
  request: ConvertTextToBubbleRequest
): readonly DialoguePageLike[] {
  if (request.elementIds.length === 0) return pages;
  const targets = new Set(
    request.elementIds.filter((id) => typeof id === "string" && id.length > 0)
  );
  if (targets.size === 0) return pages;
  const variant = resolveVariant(
    typeof request.variant === "string" ? request.variant : undefined
  );
  const includeLocked = request.includeLocked === true;
  let changed = false;
  const next = pages.map((page) => {
    const groups = page.groups ?? [];
    let pageChanged = false;
    const elements = page.elements.map((element) => {
      if (!targets.has(element.id) || element.type !== "text" || !isDialogueElement(element)) {
        return element;
      }
      if (!includeLocked && isEffectivelyLocked(element, groups)) return element;
      const nextId = lookupIdMap(request.idMap, element.id);
      if (nextId !== element.id && hasElementId(pages, nextId)) return element;
      pageChanged = true;
      return textToBubble(element as DialogueFormatElement, variant, nextId);
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements };
  });
  return changed ? next : pages;
}

/** Count how many selected ids would convert (unlocked free text). Pure preview helper. */
export function countConvertibleTextElements(
  pages: readonly DialoguePageLike[],
  elementIds: readonly string[],
  includeLocked = false
): number {
  const targets = new Set(elementIds);
  let count = 0;
  for (const page of pages) {
    const groups = page.groups ?? [];
    for (const element of page.elements) {
      if (!targets.has(element.id) || element.type !== "text" || !isDialogueElement(element)) {
        continue;
      }
      if (!includeLocked && isEffectivelyLocked(element, groups)) continue;
      count += 1;
    }
  }
  return count;
}
