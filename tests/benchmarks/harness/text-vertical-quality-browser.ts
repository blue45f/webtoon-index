import { planDialogueVerticalRubyOverlayPlacements } from "../../../apps/web/src/domains/creator/lettering/studio-dialogue-ruby-layout";
import {
  classifyVerticalPunctuation,
  isVerticalNoBreakAfter,
  isVerticalNoBreakBefore,
  layoutVerticalText,
  verticalTextItemGeometry,
} from "../../../apps/web/src/domains/creator/studio-vertical-text";

import type { StudioRubySpanInput } from "../../../apps/web/src/domains/creator/lettering/studio-dialogue-ruby-layout";
import type {
  VerticalTextItem,
  VerticalTextLayout,
  VerticalTextLayoutInput,
  VerticalTextMeasurer,
} from "../../../apps/web/src/domains/creator/studio-vertical-text";

const FONT_FAMILY = "ToonVerticalCjkVisual";
const FONT_ROUTE = "/__toon_text_vertical_quality_cjk.ttf";
const FONT_SIZE = 28;
const LINE_HEIGHT = 1.45;
const LETTER_SPACING = 1;
const WARMUP_ROUNDS = 40;
const SAMPLE_COUNT = 240;
const INNER_ROUNDS = 20;

type ProductCase = {
  readonly id: string;
  readonly text: string;
  readonly maxColumnLength: number;
  readonly requiredForms?: readonly ("tate-chu-yoko" | "rotated")[];
};

const PRODUCT_CORPUS: readonly ProductCase[] = [
  { id: "ko-dialogue", text: "세로쓰기 말풍선 품질", maxColumnLength: 174 },
  { id: "ja-dialogue", text: "「縦書きの品質です。」", maxColumnLength: 174 },
  {
    id: "tate-chu-yoko-1-to-4",
    text: "「第1話」、第12話。第123話！第2026話？",
    maxColumnLength: 174,
    requiredForms: ["tate-chu-yoko"],
  },
  {
    id: "five-digit-rotated-fallback",
    text: "第12345話",
    maxColumnLength: 174,
    requiredForms: ["rotated"],
  },
  {
    id: "kinsoku-punctuation",
    text: "「これは、品質です。」「『次も！？』」",
    maxColumnLength: 174,
  },
  { id: "explicit-newline", text: "東京2026\n서울12345", maxColumnLength: 174 },
  { id: "automatic-wrap", text: "一二三四五六七八九十、続行。", maxColumnLength: 87 },
  { id: "surrogate-cjk", text: "𠮷野家と한국어", maxColumnLength: 116 },
] as const;

type LayoutAudit = {
  readonly id: string;
  readonly sourceGlyphs: number;
  readonly paintedGlyphs: number;
  readonly columns: number;
  readonly forms: Record<string, number>;
  readonly kinsokuViolations: number;
  readonly columnsRightToLeft: boolean;
  readonly tateChuYokoWithinOneCell: boolean;
  readonly deterministic: boolean;
  readonly geometrySha256: string;
};

function canvasMeasurer(): VerticalTextMeasurer {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D unavailable for the product vertical-text probe");
  return {
    measureWidth(text, fontPx, fontFamily, fontStyle) {
      context.font = `${fontStyle} ${fontPx}px ${fontFamily}`;
      return context.measureText(text).width;
    },
  };
}

function inputFor(entry: ProductCase): VerticalTextLayoutInput {
  return {
    text: entry.text,
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    letterSpacing: LETTER_SPACING,
    fontFamily: FONT_FAMILY,
    fontStyle: "bold",
    maxColumnLength: entry.maxColumnLength,
    blockAlign: "start",
  };
}

function itemGlyphs(item: VerticalTextItem): string[] {
  return [...item.text].filter((character) => character !== "\n");
}

function firstGlyph(item: VerticalTextItem): string | undefined {
  return itemGlyphs(item)[0];
}

function lastGlyph(item: VerticalTextItem): string | undefined {
  return itemGlyphs(item).at(-1);
}

function kinsokuViolations(layout: VerticalTextLayout): number {
  let violations = 0;
  for (const column of layout.columns) {
    const first = column.items[0] ? firstGlyph(column.items[0]) : undefined;
    const last = column.items.at(-1) ? lastGlyph(column.items.at(-1)!) : undefined;
    if (first && isVerticalNoBreakBefore(first)) violations += 1;
    if (last && isVerticalNoBreakAfter(last)) violations += 1;
  }
  return violations;
}

function punctuationRolesIsolated(layout: VerticalTextLayout): boolean {
  return layout.columns.every((column) =>
    column.items.every((item) => {
      const glyphs = itemGlyphs(item);
      const punctuation = glyphs.filter((glyph) => classifyVerticalPunctuation(glyph) !== "none");
      return punctuation.length === 0 || glyphs.length === 1;
    }),
  );
}

function tateChuYokoWithinOneCell(layout: VerticalTextLayout): boolean {
  return layout.columns.every((column) =>
    column.items.every((item) => {
      if (item.form !== "tate-chu-yoko") return true;
      const geometry = verticalTextItemGeometry(item, FONT_SIZE);
      const visualWidth = geometry.boxWidth * geometry.scaleX;
      return (
        item.rotation === 0
        && item.length <= FONT_SIZE + LETTER_SPACING + 1e-9
        && visualWidth <= FONT_SIZE + 1e-9
      );
    }),
  );
}

function columnsRightToLeft(layout: VerticalTextLayout): boolean {
  return layout.columns.every(
    (column, index) => index === 0 || layout.columns[index - 1]!.centerX > column.centerX,
  );
}

async function sha256(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function auditLayout(
  entry: ProductCase,
  measurer: VerticalTextMeasurer,
): Promise<{ layout: VerticalTextLayout; audit: LayoutAudit }> {
  const layout = layoutVerticalText(inputFor(entry), measurer);
  const repeated = layoutVerticalText(inputFor(entry), measurer);
  const serialized = JSON.stringify(layout);
  const sourceGlyphs = [...entry.text].filter((character) => character !== "\n").length;
  const paintedGlyphs = layout.columns.reduce(
    (total, column) => total + column.items.reduce((sum, item) => sum + itemGlyphs(item).length, 0),
    0,
  );
  const forms: Record<string, number> = {};
  for (const column of layout.columns) {
    for (const item of column.items) forms[item.form] = (forms[item.form] ?? 0) + 1;
  }
  for (const form of entry.requiredForms ?? []) {
    if (!(forms[form] && forms[form]! > 0)) {
      throw new Error(`${entry.id} did not exercise required form ${form}`);
    }
  }
  return {
    layout,
    audit: {
      id: entry.id,
      sourceGlyphs,
      paintedGlyphs,
      columns: layout.columns.length,
      forms,
      kinsokuViolations: kinsokuViolations(layout),
      columnsRightToLeft: columnsRightToLeft(layout),
      tateChuYokoWithinOneCell: tateChuYokoWithinOneCell(layout),
      deterministic: serialized === JSON.stringify(repeated),
      geometrySha256: await sha256(serialized),
    },
  };
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function latencyStats(values: readonly number[]) {
  return {
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(Math.max(...values)),
  };
}

function runProductLayoutBatch(measurer: VerticalTextMeasurer): void {
  for (const entry of PRODUCT_CORPUS) layoutVerticalText(inputFor(entry), measurer);
}

function spanFor(text: string, needle: string, ruby: string): StudioRubySpanInput {
  const start = text.indexOf(needle);
  if (start < 0) throw new Error(`missing visual ruby base ${needle}`);
  return { start, end: start + needle.length, ruby };
}

function makeRubyCases(measurer: VerticalTextMeasurer) {
  const crossColumnText = "東京𠮷野都心한국";
  const crossColumnLayout = layoutVerticalText(
    {
      text: crossColumnText,
      fontSize: FONT_SIZE,
      lineHeight: LINE_HEIGHT,
      letterSpacing: LETTER_SPACING,
      fontFamily: FONT_FAMILY,
      fontStyle: "bold",
      maxColumnLength: 58,
    },
    measurer,
  );
  const crossColumnReading = "とうきょうよしのとしん한글";
  const crossColumn = planDialogueVerticalRubyOverlayPlacements(
    crossColumnText,
    [{ start: 0, end: crossColumnText.length, ruby: crossColumnReading }],
    crossColumnLayout,
    { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, letterSpacing: LETTER_SPACING },
  );

  const surrogateText = "𠮷野家";
  const surrogateLayout = layoutVerticalText(
    { ...inputFor({ id: "ruby-surrogate", text: surrogateText, maxColumnLength: 174 }) },
    measurer,
  );
  const surrogate = planDialogueVerticalRubyOverlayPlacements(
    surrogateText,
    [{ start: 0, end: 2, ruby: "よし" }],
    surrogateLayout,
    { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, letterSpacing: LETTER_SPACING },
  );

  const tcyText = "第2026話";
  const tcyLayout = layoutVerticalText(
    { ...inputFor({ id: "ruby-tcy", text: tcyText, maxColumnLength: 174 }) },
    measurer,
  );
  const tcy = planDialogueVerticalRubyOverlayPlacements(
    tcyText,
    [spanFor(tcyText, "2026", "にせんにじゅうろく")],
    tcyLayout,
    { fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT, letterSpacing: LETTER_SPACING },
  );
  return [
    { id: "cross-column-surrogate", layout: crossColumnLayout, plan: crossColumn, reading: crossColumnReading },
    { id: "surrogate-boundary", layout: surrogateLayout, plan: surrogate, reading: "よし" },
    { id: "tate-chu-yoko-base-cell", layout: tcyLayout, plan: tcy, reading: "にせんにじゅうろく" },
  ] as const;
}

function auditRubyCases(cases: ReturnType<typeof makeRubyCases>) {
  return cases.map((entry) => {
    const reading = entry.plan.placements.map((placement) => placement.ruby).join("");
    const rightOfBase = entry.plan.placements.every(
      (placement) => placement.x >= placement.baseX + placement.baseWidth,
    );
    const centered = entry.plan.placements.every((placement) =>
      Math.abs(
        placement.y + placement.height / 2
        - (placement.baseY + placement.baseHeight / 2),
      ) <= 1e-9,
    );
    return {
      id: entry.id,
      placements: entry.plan.placements.length,
      warningCodes: entry.plan.warnings.map((warning) => warning.code),
      unsupportedCodes: entry.plan.unsupported.map((issue) => issue.code),
      readingSha256Input: reading,
      readingExact: reading === entry.reading,
      rightOfBase,
      centered,
      columnsRightToLeft: columnsRightToLeft(entry.layout),
      sourceRubyPreserved: entry.plan.placements.every(
        (placement) => placement.sourceRuby === entry.reading,
      ),
    };
  });
}

function runRubyBatch(measurer: VerticalTextMeasurer): void {
  makeRubyCases(measurer);
}

function drawProductReference(
  measurer: VerticalTextMeasurer,
): { bytes: Uint8Array; width: number; height: number; geometry: unknown } {
  const text = "「東京2026」、。！？」「『品質』」한국어12345𠮷野";
  const layout = layoutVerticalText(
    {
      text,
      fontSize: 32,
      lineHeight: 1.5,
      letterSpacing: 1,
      fontFamily: FONT_FAMILY,
      fontStyle: "bold",
      maxColumnLength: 190,
      blockAlign: "start",
    },
    measurer,
  );
  const spans = [
    spanFor(text, "東京", "とうきょう"),
    spanFor(text, "品質", "ひんしつ"),
    spanFor(text, "한국어", "한글"),
    spanFor(text, "𠮷野", "よしの"),
  ];
  const ruby = planDialogueVerticalRubyOverlayPlacements(text, spans, layout, {
    fontSize: 32,
    lineHeight: 1.5,
    letterSpacing: 1,
  });
  if (ruby.unsupported.length > 0) {
    throw new Error(`visual ruby unsupported: ${JSON.stringify(ruby.unsupported)}`);
  }

  const margin = 42;
  const width = Math.ceil(layout.width + margin * 2 + 24);
  const height = Math.ceil(Math.max(250, layout.height + margin * 2));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas 2D unavailable for reference raster");
  context.fillStyle = "#fbfaf6";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#171410";
  context.textBaseline = "top";
  context.font = `bold 32px ${FONT_FAMILY}`;

  for (const column of layout.columns) {
    for (const item of column.items) {
      const originX = margin + item.x;
      const originY = margin + item.y;
      const geometry = verticalTextItemGeometry(item, 32);
      if (item.rotation === 90) {
        context.save();
        context.translate(originX, originY);
        context.rotate(Math.PI / 2);
        context.textAlign = "left";
        context.fillText(item.text, 0, 0);
        context.restore();
        continue;
      }
      if (item.form === "tate-chu-yoko") {
        context.save();
        context.translate(originX, originY);
        context.scale(geometry.scaleX, 1);
        context.textAlign = "center";
        context.fillText(item.text, geometry.boxWidth / 2, 0);
        context.restore();
        continue;
      }
      context.textAlign = "center";
      item.text.split("\n").forEach((glyph, index) => {
        context.fillText(glyph, originX + geometry.boxWidth / 2, originY + index * item.glyphAdvance);
      });
    }
  }

  for (const placement of ruby.placements) {
    context.font = `bold ${placement.rubyFontSize}px ${FONT_FAMILY}`;
    context.textAlign = "center";
    [...placement.ruby].forEach((glyph, index) => {
      context.fillText(
        glyph,
        margin + placement.x + placement.width / 2,
        margin + placement.y + index * placement.rubyGlyphAdvance,
      );
    });
  }
  const dataUrl = canvas.toDataURL("image/png");
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return {
    bytes,
    width,
    height,
    geometry: { text, layout, ruby },
  };
}

export type TextVerticalProductProbe = Awaited<ReturnType<typeof runProductProbe>>;

async function runProductProbe() {
  const fontFace = new FontFace(
    FONT_FAMILY,
    `url(${JSON.stringify(FONT_ROUTE)}) format("truetype")`,
    { style: "normal", weight: "700" },
  );
  await fontFace.load();
  document.fonts.add(fontFace);
  const loaded = await document.fonts.load(`bold ${FONT_SIZE}px ${FONT_FAMILY}`, "縦書き한글𠮷");
  if (loaded.length === 0) throw new Error(`${FONT_FAMILY} did not load in Chromium`);
  const measurer = canvasMeasurer();

  for (let index = 0; index < WARMUP_ROUNDS; index += 1) {
    runProductLayoutBatch(measurer);
    runRubyBatch(measurer);
  }

  const layoutSamplesMs: number[] = [];
  const rubySamplesMs: number[] = [];
  for (let sample = 0; sample < SAMPLE_COUNT; sample += 1) {
    let started = performance.now();
    for (let inner = 0; inner < INNER_ROUNDS; inner += 1) runProductLayoutBatch(measurer);
    layoutSamplesMs.push((performance.now() - started) / INNER_ROUNDS);
    started = performance.now();
    for (let inner = 0; inner < INNER_ROUNDS; inner += 1) runRubyBatch(measurer);
    rubySamplesMs.push((performance.now() - started) / INNER_ROUNDS);
  }

  const audited = await Promise.all(PRODUCT_CORPUS.map((entry) => auditLayout(entry, measurer)));
  const rubyCases = makeRubyCases(measurer);
  const rubyAudits = auditRubyCases(rubyCases);
  const firstVisual = drawProductReference(measurer);
  const secondVisual = drawProductReference(measurer);
  const visualByteExact =
    firstVisual.bytes.length === secondVisual.bytes.length
    && firstVisual.bytes.every((byte, index) => byte === secondVisual.bytes[index]);
  const visualGeometryExact = JSON.stringify(firstVisual.geometry) === JSON.stringify(secondVisual.geometry);

  const gates = {
    noGlyphDrop: audited.every(({ audit }) => audit.sourceGlyphs === audit.paintedGlyphs),
    tateChuYokoWithinOneCell: audited.every(({ audit }) => audit.tateChuYokoWithinOneCell),
    columnsRightToLeft: audited.every(({ audit }) => audit.columnsRightToLeft),
    kinsokuViolationsZero: audited.every(({ audit }) => audit.kinsokuViolations === 0),
    punctuationRolesIsolated: audited.every(({ layout }) => punctuationRolesIsolated(layout)),
    layoutDeterministic: audited.every(({ audit }) => audit.deterministic),
    rubyNoUnsupported: rubyAudits.every((audit) => audit.unsupportedCodes.length === 0),
    rubyReadingExact: rubyAudits.every((audit) => audit.readingExact && audit.sourceRubyPreserved),
    rubyRightAndCentered: rubyAudits.every((audit) => audit.rightOfBase && audit.centered),
    visualByteAndGeometryExact: visualByteExact && visualGeometryExact,
  };
  if (Object.entries(gates).some(([, passed]) => !passed)) {
    throw new Error(
      `product vertical quality gate failed: ${JSON.stringify({
        gates,
        layoutAudits: audited.map(({ audit }) => audit),
        rubyAudits,
      })}`,
    );
  }
  const crossWarningCodes = rubyAudits.find((entry) => entry.id === "cross-column-surrogate")?.warningCodes;
  if (JSON.stringify(crossWarningCodes) !== JSON.stringify(["span-split-across-columns"])) {
    throw new Error(`unexpected cross-column warnings: ${JSON.stringify(crossWarningCodes)}`);
  }
  if (rubyAudits.some((entry) => entry.id !== "cross-column-surrogate" && entry.warningCodes.length > 0)) {
    throw new Error(`unexpected ruby warnings: ${JSON.stringify(rubyAudits)}`);
  }

  return {
    execution: "Chromium Canvas 2D using product layout/ruby functions and exact installed Arial Unicode bytes served in-memory by the harness",
    chromium: navigator.userAgent,
    fontFamily: FONT_FAMILY,
    workload: {
      warmupRounds: WARMUP_ROUNDS,
      sampleCount: SAMPLE_COUNT,
      innerRounds: INNER_ROUNDS,
      layoutCasesPerSample: PRODUCT_CORPUS.length,
      rubyCasesPerSample: rubyCases.length,
    },
    layout: {
      latencyPerCorpusBatchMs: latencyStats(layoutSamplesMs),
      rawSamplesMs: layoutSamplesMs.map((value) => round(value)),
      cases: audited.map(({ audit }) => audit),
    },
    ruby: {
      latencyPerCorpusBatchMs: latencyStats(rubySamplesMs),
      rawSamplesMs: rubySamplesMs.map((value) => round(value)),
      cases: await Promise.all(rubyAudits.map(async (audit) => ({
        ...audit,
        readingSha256: await sha256(audit.readingSha256Input),
        readingSha256Input: undefined,
      }))),
    },
    visual: {
      width: firstVisual.width,
      height: firstVisual.height,
      pngBase64: btoa(String.fromCharCode(...firstVisual.bytes)),
      sha256: await sha256(firstVisual.bytes),
      geometrySha256: await sha256(JSON.stringify(firstVisual.geometry)),
      byteExactRepeat: visualByteExact,
      geometryExactRepeat: visualGeometryExact,
      contains: [
        "upright CJK",
        "tate-chu-yoko 2026",
        "five-digit rotated fallback",
        "vertical ruby",
        "vertical punctuation",
        "adjacent close/open punctuation",
        "nested punctuation",
        "multiple right-to-left columns",
      ],
    },
    gates,
  };
}

declare global {
  interface Window {
    __TOON_TEXT_VERTICAL_QUALITY_PROBE__?: () => ReturnType<typeof runProductProbe>;
  }
}

window.__TOON_TEXT_VERTICAL_QUALITY_PROBE__ = runProductProbe;
document.documentElement.dataset.textVerticalQualityReady = "true";
