/**
 * Pure ruby (furigana / 루비) glyph-run layout for dialogue lettering.
 *
 * Engine-free: merges non-overlapping `rubySpans` into ordered base/ruby runs so Konva (or any
 * canvas) can paint stacked glyphs without a full rich-text engine. The legacy horizontal run API
 * keeps its first-valid-span behaviour; the vertical API returns explicit unsupported entries for
 * overlaps, invalid ranges, empty readings, and layout mismatches.
 *
 * Overlay helpers below provide two renderer-independent paths:
 * - horizontal: base stays one full string; ruby sits above estimated base advances;
 * - vertical-rl: ruby follows the actual vertical base layout, sits to the right of its base span,
 *   and reports every malformed or unmappable annotation instead of silently dropping it.
 */

export type StudioRubyGlyphRun = {
  /** Base text slice (UTF-16 code units, matching textarea selection offsets). */
  readonly base: string;
  /** Optional reading rendered above (or beside for vertical) the base. */
  readonly ruby?: string;
  readonly start: number;
  readonly end: number;
};

export type StudioRubySpanInput = {
  readonly start: number;
  readonly end: number;
  readonly ruby: string;
};

/** Approximate Konva-local placement for one ruby reading above a base segment. */
export type StudioRubyOverlayPlacement = {
  readonly base: string;
  readonly ruby: string;
  readonly start: number;
  readonly end: number;
  /** Left edge of the base segment in the text-box coordinate system (y=0 = top of base text). */
  readonly x: number;
  /** Top of the ruby glyph (typically negative so it sits above the base). */
  readonly y: number;
  /** Estimated advance width of the base segment (center ruby with width + align="center"). */
  readonly baseWidth: number;
  readonly rubyFontSize: number;
};

export type PlanDialogueRubyOverlayOptions = {
  readonly fontSize: number;
  readonly letterSpacing?: number;
  /**
   * Text box width used for left/center/right origin. When omitted, uses the estimated full
   * advance of `text` (single-line left-aligned behaviour).
   */
  readonly textWidth?: number;
  readonly align?: "left" | "center" | "right";
  /** Ruby size as a fraction of base fontSize (default 0.45). */
  readonly rubySizeRatio?: number;
  /**
   * Top of ruby relative to the base text top. Default: `-rubyFontSize * 0.9`.
   * Multi-line wrap is not modelled — all overlays share this first-line approximation.
   */
  readonly rubyY?: number;
};

/** Minimal structural view of the vertical text core; deliberately independent from Konva/DOM. */
export type StudioVerticalRubyBaseLayout = {
  readonly width: number;
  readonly height: number;
  readonly columnAdvance: number;
  readonly columns: readonly {
    readonly index: number;
    readonly items: readonly {
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly rotation: 0 | 90;
      readonly length: number;
      readonly glyphAdvance: number;
    }[];
  }[];
};

export type PlanDialogueVerticalRubyOptions = {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing?: number;
  readonly rubySizeRatio?: number;
  readonly sideGap?: number;
};

export type StudioVerticalRubyIssueCode =
  | "empty-reading"
  | "fractional-offset"
  | "invalid-offset"
  | "layout-source-mismatch"
  | "no-base-glyphs"
  | "out-of-range"
  | "overlapping-span"
  | "ruby-too-short-for-column-split"
  | "split-surrogate-pair";

export type StudioVerticalRubyIssue = {
  readonly code: StudioVerticalRubyIssueCode;
  readonly message: string;
  readonly spanIndex: number | null;
};

export type StudioVerticalRubyWarning = {
  readonly code: "bounded-option" | "span-split-across-columns";
  readonly message: string;
  readonly spanIndex: number | null;
};

/** One paintable vertical ruby fragment. A span can produce several fragments after a column break. */
export type StudioVerticalRubyOverlayPlacement = {
  readonly orientation: "vertical-upright";
  readonly writingMode: "vertical-rl";
  readonly side: "right";
  readonly base: string;
  readonly ruby: string;
  readonly sourceRuby: string;
  readonly start: number;
  readonly end: number;
  readonly spanIndex: number;
  readonly fragmentIndex: number;
  readonly fragmentCount: number;
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly baseX: number;
  readonly baseY: number;
  readonly baseWidth: number;
  readonly baseHeight: number;
  readonly rubyFontSize: number;
  readonly rubyGlyphAdvance: number;
};

export type StudioVerticalRubyLayoutPlan = {
  readonly placements: readonly StudioVerticalRubyOverlayPlacement[];
  readonly warnings: readonly StudioVerticalRubyWarning[];
  readonly unsupported: readonly StudioVerticalRubyIssue[];
};

function isFiniteOffset(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Plans ordered glyph runs covering `text` from optional ruby spans.
 *
 * - Sorts spans by start (then end)
 * - Clamps to [0, text.length]; drops empty / inverted / empty-ruby spans
 * - Skips spans that overlap a previously accepted span (first wins after sort)
 * - Fills gaps and the trailing tail with base-only runs
 * - Never mutates `text` or `spans`
 */
export function planDialogueRubyRuns(
  text: string,
  spans: readonly StudioRubySpanInput[] | undefined,
): readonly StudioRubyGlyphRun[] {
  const source = typeof text === "string" ? text : "";
  const length = source.length;

  if (!Array.isArray(spans) || spans.length === 0) {
    if (length === 0) return Object.freeze([]);
    return Object.freeze([
      Object.freeze({ base: source, start: 0, end: length }),
    ]);
  }

  type Accepted = { start: number; end: number; ruby: string };
  const accepted: Accepted[] = [];

  const ordered = [...spans].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );

  for (const span of ordered) {
    if (!span || typeof span !== "object") continue;
    if (!isFiniteOffset(span.start) || !isFiniteOffset(span.end)) continue;
    const start = Math.max(0, Math.min(length, Math.trunc(span.start)));
    const end = Math.max(0, Math.min(length, Math.trunc(span.end)));
    if (start >= end) continue;
    if (typeof span.ruby !== "string") continue;
    const ruby = span.ruby;
    // Empty readings become base-only coverage via the gap filler, not a ruby run.
    if (ruby.length === 0) continue;

    const overlaps = accepted.some(
      (prior) => start < prior.end && prior.start < end,
    );
    if (overlaps) continue;
    accepted.push({ start, end, ruby });
  }

  accepted.sort((left, right) => left.start - right.start || left.end - right.end);

  const runs: StudioRubyGlyphRun[] = [];
  let cursor = 0;
  for (const span of accepted) {
    if (span.start > cursor) {
      runs.push(
        Object.freeze({
          base: source.slice(cursor, span.start),
          start: cursor,
          end: span.start,
        }),
      );
    }
    runs.push(
      Object.freeze({
        base: source.slice(span.start, span.end),
        ruby: span.ruby,
        start: span.start,
        end: span.end,
      }),
    );
    cursor = span.end;
  }
  if (cursor < length) {
    runs.push(
      Object.freeze({
        base: source.slice(cursor),
        start: cursor,
        end: length,
      }),
    );
  }

  return Object.freeze(runs);
}

/**
 * Duck-typed reader for `rubySpans` on dialogue elements. Returns `undefined` when absent or empty
 * so mounts can keep the plain single-Text path.
 */
export function readDialogueRubySpans(
  value: unknown,
): readonly StudioRubySpanInput[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value as readonly StudioRubySpanInput[];
}

/**
 * Honest CJK-biased glyph width: halfwidth / basic Latin ≈ 0.55em, everything else ≈ 1em.
 * Surrogate pairs are one visual glyph. Not a substitute for canvas measureText.
 */
export function estimateDialogueGlyphWidth(char: string, fontSize: number): number {
  if (typeof char !== "string" || char.length === 0) return 0;
  if (!(fontSize > 0) || !Number.isFinite(fontSize)) return 0;
  const code = char.codePointAt(0) ?? 0;
  // Basic Latin + Latin-1 + common halfwidth punctuation/digits.
  if (code < 0x1100) return fontSize * 0.55;
  return fontSize;
}

/**
 * Estimated horizontal advance of `text` at `fontSize`, with optional letterSpacing between
 * Unicode code points (not UTF-16 units). Pure — no DOM/canvas.
 */
export function estimateDialogueTextAdvanceWidth(
  text: string,
  fontSize: number,
  letterSpacing = 0,
): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  if (!(fontSize > 0) || !Number.isFinite(fontSize)) return 0;
  const spacing =
    typeof letterSpacing === "number" && Number.isFinite(letterSpacing) ? letterSpacing : 0;

  let width = 0;
  let glyphs = 0;
  for (const char of text) {
    if (glyphs > 0) width += spacing;
    width += estimateDialogueGlyphWidth(char, fontSize);
    glyphs += 1;
  }
  return width;
}

/**
 * Cumulative advance widths keyed by UTF-16 offset: `advances[i]` = width of `text.slice(0, i)`.
 * Letter-spacing is applied between Unicode code points only.
 */
function estimateAdvancesByUtf16Offset(
  text: string,
  fontSize: number,
  letterSpacing: number,
): Float64Array {
  const advances = new Float64Array(text.length + 1);
  let width = 0;
  let index = 0;
  let glyphs = 0;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    let next = index + 1;
    let char = text[index]!;
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        char = text.slice(index, index + 2);
        next = index + 2;
      }
    }
    if (glyphs > 0) width += letterSpacing;
    width += estimateDialogueGlyphWidth(char, fontSize);
    glyphs += 1;
    // Fill every UTF-16 unit boundary inside a surrogate pair with the same post-glyph width so
    // slice offsets mid-pair still get a defined advance (planDialogueRubyRuns keeps pairs whole).
    for (let fill = index + 1; fill <= next; fill += 1) {
      advances[fill] = width;
    }
    index = next;
  }
  return advances;
}

/**
 * Plans stacked ruby overlays for horizontal dialogue lettering (MVP).
 *
 * - Base remains a single full-string Text at the paint mount
 * - Each accepted run with a reading gets one smaller Text centered over its base segment
 * - X uses estimated glyph advances (not canvas measureText); multi-line wrap is not modelled
 * - Returns an empty frozen array when there is nothing to overlay
 */
export function planDialogueRubyOverlayPlacements(
  text: string,
  spans: readonly StudioRubySpanInput[] | undefined,
  options: PlanDialogueRubyOverlayOptions,
): readonly StudioRubyOverlayPlacement[] {
  if (!options || !(options.fontSize > 0) || !Number.isFinite(options.fontSize)) {
    return Object.freeze([]);
  }
  const source = typeof text === "string" ? text : "";
  if (source.length === 0) return Object.freeze([]);

  const runs = planDialogueRubyRuns(source, spans);
  const withRuby = runs.filter(
    (run): run is StudioRubyGlyphRun & { ruby: string } =>
      typeof run.ruby === "string" && run.ruby.length > 0,
  );
  if (withRuby.length === 0) return Object.freeze([]);

  const fontSize = options.fontSize;
  const letterSpacing =
    typeof options.letterSpacing === "number" && Number.isFinite(options.letterSpacing)
      ? options.letterSpacing
      : 0;
  const ratio =
    typeof options.rubySizeRatio === "number"
    && Number.isFinite(options.rubySizeRatio)
    && options.rubySizeRatio > 0
      ? options.rubySizeRatio
      : 0.45;
  const rubyFontSize = Math.max(6, fontSize * ratio);
  const rubyY =
    typeof options.rubyY === "number" && Number.isFinite(options.rubyY)
      ? options.rubyY
      : -rubyFontSize * 0.9;

  const advances = estimateAdvancesByUtf16Offset(source, fontSize, letterSpacing);
  const totalAdvance = advances[source.length] ?? 0;
  const boxWidth =
    typeof options.textWidth === "number"
    && Number.isFinite(options.textWidth)
    && options.textWidth > 0
      ? options.textWidth
      : totalAdvance;
  const align = options.align === "center" || options.align === "right" ? options.align : "left";
  let originX = 0;
  if (align === "center") originX = (boxWidth - totalAdvance) / 2;
  else if (align === "right") originX = boxWidth - totalAdvance;

  const placements: StudioRubyOverlayPlacement[] = withRuby.map((run) => {
    const prefix = advances[run.start] ?? 0;
    const endAdvance = advances[run.end] ?? prefix;
    const baseWidth = Math.max(0, endAdvance - prefix);
    return Object.freeze({
      base: run.base,
      ruby: run.ruby,
      start: run.start,
      end: run.end,
      x: originX + prefix,
      y: rubyY,
      baseWidth,
      rubyFontSize,
    });
  });

  return Object.freeze(placements);
}

type VerticalSourceGlyph = {
  readonly char: string;
  readonly start: number;
  readonly end: number;
};

type VerticalBaseCell = VerticalSourceGlyph & {
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

function boundedNumber(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): { value: number; bounded: boolean } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { value: fallback, bounded: value !== undefined };
  }
  const bounded = Math.max(minimum, Math.min(maximum, value));
  return { value: bounded, bounded: bounded !== value };
}

function verticalSourceGlyphs(text: string): readonly VerticalSourceGlyph[] {
  const glyphs: VerticalSourceGlyph[] = [];
  let offset = 0;
  for (const char of text) {
    const start = offset;
    offset += char.length;
    if (char !== "\n") glyphs.push({ char, start, end: offset });
  }
  return glyphs;
}

function utf16CodePointBoundaries(text: string): ReadonlySet<number> {
  const boundaries = new Set<number>([0]);
  let offset = 0;
  for (const char of text) {
    offset += char.length;
    boundaries.add(offset);
  }
  return boundaries;
}

function freezeVerticalRubyPlan(
  placements: StudioVerticalRubyOverlayPlacement[],
  warnings: StudioVerticalRubyWarning[],
  unsupported: StudioVerticalRubyIssue[],
): StudioVerticalRubyLayoutPlan {
  return Object.freeze({
    placements: Object.freeze(placements.map((entry) => Object.freeze(entry))),
    warnings: Object.freeze(warnings.map((entry) => Object.freeze(entry))),
    unsupported: Object.freeze(unsupported.map((entry) => Object.freeze(entry))),
  });
}

function mapVerticalLayoutCells(
  source: string,
  layout: StudioVerticalRubyBaseLayout,
  fontSize: number,
  letterSpacing: number,
): { cells: VerticalBaseCell[]; issue?: StudioVerticalRubyIssue } {
  const sourceGlyphs = verticalSourceGlyphs(source);
  const cells: VerticalBaseCell[] = [];
  let sourceCursor = 0;

  for (const column of layout.columns) {
    for (const item of column.items) {
      // Upright runs use embedded newlines only as Konva line separators; they are not source text.
      const itemGlyphs = [...item.text].filter((char) => char !== "\n");
      if (itemGlyphs.length === 0) continue;

      const mapped = sourceGlyphs.slice(sourceCursor, sourceCursor + itemGlyphs.length);
      if (
        mapped.length !== itemGlyphs.length
        || mapped.some((glyph, index) => glyph.char !== itemGlyphs[index])
      ) {
        return {
          cells: [],
          issue: {
            code: "layout-source-mismatch",
            message: `Vertical layout item ${JSON.stringify(item.text)} does not match source offset ${mapped[0]?.start ?? source.length}.`,
            spanIndex: null,
          },
        };
      }

      const isRotated = item.rotation === 90;
      const isSingleCellHorizontal =
        !isRotated
        && itemGlyphs.length > 1
        && !item.text.includes("\n")
        && item.length <= item.glyphAdvance * 1.01;

      if (isRotated) {
        const rawWeights = itemGlyphs.map(
          (char) => Math.max(0.01, estimateDialogueGlyphWidth(char, fontSize) + letterSpacing),
        );
        const weightTotal = rawWeights.reduce((total, weight) => total + weight, 0);
        let cursorY = item.y;
        mapped.forEach((glyph, index) => {
          const height = index === mapped.length - 1
            ? Math.max(0.01, item.y + item.length - cursorY)
            : Math.max(0.01, item.length * (rawWeights[index]! / weightTotal));
          cells.push({
            ...glyph,
            column: column.index,
            x: item.x,
            y: cursorY,
            width: fontSize,
            height,
          });
          cursorY += height;
        });
      } else if (isSingleCellHorizontal) {
        // Tate-chu-yoko: several source glyphs share one upright cell. Keep the whole cell as each
        // glyph's base geometry so a ruby span over any/all digits remains centered on that cell.
        for (const glyph of mapped) {
          cells.push({
            ...glyph,
            column: column.index,
            x: item.x,
            y: item.y,
            width: fontSize,
            height: item.length,
          });
        }
      } else {
        mapped.forEach((glyph, index) => {
          cells.push({
            ...glyph,
            column: column.index,
            x: item.x,
            y: item.y + index * item.glyphAdvance,
            width: fontSize,
            height: item.glyphAdvance,
          });
        });
      }
      sourceCursor += itemGlyphs.length;
    }
  }

  if (sourceCursor !== sourceGlyphs.length) {
    return {
      cells: [],
      issue: {
        code: "layout-source-mismatch",
        message: `Vertical layout mapped ${sourceCursor} of ${sourceGlyphs.length} source glyphs.`,
        spanIndex: null,
      },
    };
  }
  return { cells };
}

/**
 * Plans JLREQ-style vertical ruby against the actual vertical base layout.
 *
 * Base glyphs flow top-to-bottom and columns retain the renderer's right-to-left geometry. Ruby is
 * upright on the right side of each corresponding base fragment and vertically centered. UTF-16
 * annotation offsets remain compatible with textarea selections, but offsets inside surrogate pairs
 * are rejected. Cross-column spans are split deterministically without dropping reading glyphs.
 */
export function planDialogueVerticalRubyOverlayPlacements(
  text: string,
  spans: readonly StudioRubySpanInput[] | undefined,
  layout: StudioVerticalRubyBaseLayout,
  options: PlanDialogueVerticalRubyOptions,
): StudioVerticalRubyLayoutPlan {
  const source = typeof text === "string" ? text : "";
  const warnings: StudioVerticalRubyWarning[] = [];
  const unsupported: StudioVerticalRubyIssue[] = [];
  const placements: StudioVerticalRubyOverlayPlacement[] = [];

  const font = boundedNumber(options?.fontSize, 16, 4, 512);
  const lineHeight = boundedNumber(options?.lineHeight, 1.4, 0.5, 4);
  const spacing = boundedNumber(options?.letterSpacing, 0, -font.value * 0.25, font.value * 2);
  const ratio = boundedNumber(options?.rubySizeRatio, 0.45, 0.25, 0.65);
  const defaultGap = font.value * Math.min(0.16, lineHeight.value * 0.06);
  const gap = boundedNumber(options?.sideGap, defaultGap, 0, font.value);
  for (const [name, result] of [
    ["fontSize", font],
    ["lineHeight", lineHeight],
    ["letterSpacing", spacing],
    ["rubySizeRatio", ratio],
    ["sideGap", gap],
  ] as const) {
    if (result.bounded) {
      warnings.push({
        code: "bounded-option",
        message: `${name} was bounded to ${result.value}.`,
        spanIndex: null,
      });
    }
  }

  if (!Array.isArray(spans) || spans.length === 0) {
    return freezeVerticalRubyPlan(placements, warnings, unsupported);
  }

  const mapped = mapVerticalLayoutCells(source, layout, font.value, spacing.value);
  if (mapped.issue) {
    unsupported.push(mapped.issue);
    return freezeVerticalRubyPlan(placements, warnings, unsupported);
  }

  const boundaries = utf16CodePointBoundaries(source);
  type Accepted = StudioRubySpanInput & { readonly spanIndex: number };
  const accepted: Accepted[] = [];
  spans.forEach((span, spanIndex) => {
    if (
      !span
      || typeof span !== "object"
      || !isFiniteOffset(span.start)
      || !isFiniteOffset(span.end)
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
    if (span.start < 0 || span.end > source.length || span.start >= span.end) {
      unsupported.push({
        code: "out-of-range",
        message: `Ruby range ${span.start}..${span.end} is outside 0..${source.length}.`,
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
        message: "Vertical ruby readings must contain a visible glyph.",
        spanIndex,
      });
      return;
    }
    accepted.push({ ...span, spanIndex });
  });

  accepted.sort((left, right) => left.start - right.start || left.end - right.end);
  const nonOverlapping: Accepted[] = [];
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

  const rubyFontSize = Math.max(4, font.value * ratio.value);
  const rubyGlyphAdvance = Math.max(1, rubyFontSize + spacing.value * ratio.value);

  for (const span of nonOverlapping) {
    const spanCells = mapped.cells.filter(
      (cell) => cell.start >= span.start && cell.end <= span.end,
    );
    if (spanCells.length === 0) {
      unsupported.push({
        code: "no-base-glyphs",
        message: `Ruby range ${span.start}..${span.end} contains no paintable base glyph.`,
        spanIndex: span.spanIndex,
      });
      continue;
    }

    const fragments: VerticalBaseCell[][] = [];
    for (const cell of spanCells) {
      const prior = fragments[fragments.length - 1];
      if (prior && prior[0]!.column === cell.column) prior.push(cell);
      else fragments.push([cell]);
    }
    const readingGlyphs = [...span.ruby];
    if (fragments.length > readingGlyphs.length) {
      unsupported.push({
        code: "ruby-too-short-for-column-split",
        message: `Ruby reading has ${readingGlyphs.length} glyphs for ${fragments.length} column fragments.`,
        spanIndex: span.spanIndex,
      });
      continue;
    }
    if (fragments.length > 1) {
      warnings.push({
        code: "span-split-across-columns",
        message: `Ruby range ${span.start}..${span.end} was split across ${fragments.length} columns.`,
        spanIndex: span.spanIndex,
      });
    }

    const totalBaseGlyphs = fragments.reduce((total, fragment) => total + fragment.length, 0);
    let readingCursor = 0;
    let consumedBaseGlyphs = 0;
    fragments.forEach((fragment, fragmentIndex) => {
      consumedBaseGlyphs += fragment.length;
      const remainingFragments = fragments.length - fragmentIndex - 1;
      const proportionalEnd = fragmentIndex === fragments.length - 1
        ? readingGlyphs.length
        : Math.round((consumedBaseGlyphs / totalBaseGlyphs) * readingGlyphs.length);
      const readingEnd = Math.max(
        readingCursor + 1,
        Math.min(readingGlyphs.length - remainingFragments, proportionalEnd),
      );
      const ruby = readingGlyphs.slice(readingCursor, readingEnd).join("");
      readingCursor = readingEnd;

      const baseX = Math.min(...fragment.map((cell) => cell.x));
      const baseY = Math.min(...fragment.map((cell) => cell.y));
      const baseRight = Math.max(...fragment.map((cell) => cell.x + cell.width));
      const baseBottom = Math.max(...fragment.map((cell) => cell.y + cell.height));
      const rubyHeight = [...ruby].length * rubyGlyphAdvance;
      placements.push({
        orientation: "vertical-upright",
        writingMode: "vertical-rl",
        side: "right",
        base: fragment.map((cell) => cell.char).join(""),
        ruby,
        sourceRuby: span.ruby,
        start: fragment[0]!.start,
        end: fragment[fragment.length - 1]!.end,
        spanIndex: span.spanIndex,
        fragmentIndex,
        fragmentCount: fragments.length,
        column: fragment[0]!.column,
        x: baseRight + gap.value,
        y: baseY + (baseBottom - baseY - rubyHeight) / 2,
        width: rubyFontSize,
        height: rubyHeight,
        baseX,
        baseY,
        baseWidth: baseRight - baseX,
        baseHeight: baseBottom - baseY,
        rubyFontSize,
        rubyGlyphAdvance,
      });
    });
  }

  return freezeVerticalRubyPlan(placements, warnings, unsupported);
}
