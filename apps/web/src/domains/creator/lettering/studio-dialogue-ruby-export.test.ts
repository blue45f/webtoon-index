import { describe, expect, it } from "vitest";

import { parseSfntEmbeddingPolicy, type StudioPdfFontResource } from "../render/studio-canvaskit-pdf-font";
import { buildVectorPdf } from "../render/studio-canvaskit-pdf-vector";

import {
  buildDialogueRubyExportXmp,
  createDialogueRubyMetadataRecord,
  parseDialogueRubyExportXmp,
  planDialogueRubyPdfOps,
  type DialogueRubyTextExportInput,
} from "./studio-dialogue-ruby-export";

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const codePoints = [...new Set([..."漢字かん東京とうきょう縦2026横にせん天地玄黄てんちげんこうA😀Bplain"].map(
  (char) => char.codePointAt(0)!,
))];
const cmap = new Map(codePoints.map((codePoint, index) => [codePoint, index + 1]));
const cidFont: StudioPdfFontResource = {
  kind: "truetype-cid",
  resourceName: "F0",
  baseFont: "RubyTest",
  fontBytes: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0]),
  metrics: {
    unitsPerEm: 1_000,
    numGlyphs: codePoints.length + 1,
    advanceWidths: Array.from({ length: codePoints.length + 1 }, () => 1_000),
    cmap,
    ascender: 820,
    descender: -180,
    bbox: [0, -180, 1_000, 820],
    capHeight: 700,
    hasCffOutlines: false,
    embeddingPolicy: parseSfntEmbeddingPolicy(0),
  },
  usedGlyphIds: [0, ...cmap.values()],
};

const pdfOptions = {
  fontResourceName: "F0",
  color: { space: "gray", gray: 0 } as const,
};

function input(overrides: Partial<DialogueRubyTextExportInput> = {}): DialogueRubyTextExportInput {
  return {
    elementId: "dialogue-a",
    layerName: "대사 A",
    text: "漢字",
    rubySpans: [{ start: 0, end: 1, ruby: "かん" }],
    width: 120,
    fontSize: 24,
    lineHeight: 1.4,
    letterSpacing: 0,
    fontFamily: "RubyTest",
    fontStyle: "normal",
    align: "left",
    ...overrides,
  };
}

describe("dialogue ruby PDF lowering", () => {
  it("renders horizontal base and ruby as Unicode positioned text with ToUnicode and ActualText", () => {
    const plan = planDialogueRubyPdfOps(input(), pdfOptions);
    expect(plan.baseOps).toHaveLength(1);
    expect(plan.rubyOps).toHaveLength(1);
    expect(plan.baseOps[0]).toMatchObject({ op: "text", text: "漢字", actualText: "漢字" });
    expect(plan.rubyOps[0]).toMatchObject({ op: "text", text: "かん", actualText: "かん" });
    expect(plan.unsupported).toEqual([]);

    const bytes = buildVectorPdf({
      pages: [{ widthPt: 300, heightPt: 200, ops: plan.ops }],
      fonts: [cidFont],
      fontEmbeddingIntent: "editable",
    });
    const body = latin1(bytes);
    expect(body).toContain("/ToUnicode");
    expect(body).toContain("/CMapName /TS-F0-Unicode def");
    expect(body).toContain("/ActualText <FEFF6F225B57>");
    expect(body).toContain("/ActualText <FEFF304B3093>");
    expect(body).toContain(`<${cmap.get(0x6f22)!.toString(16).toUpperCase().padStart(4, "0")}> <6F22>`);
  });

  it("renders vertical-rl ruby as upright glyph overlays beside product-core base placements", () => {
    const plan = planDialogueRubyPdfOps(input({
      text: "東京",
      rubySpans: [{ start: 0, end: 2, ruby: "とうきょう" }],
      vertical: true,
      width: 80,
    }), pdfOptions);
    expect(plan.verticalLayout).not.toBeNull();
    expect(plan.baseOps).toHaveLength(2);
    expect(plan.rubyOps.map((op) => op.op === "text" ? op.text : "").join("")).toBe("とうきょう");
    expect(plan.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "pdf-vertical-glyph-overlays" }),
    ]));
    expect(plan.unsupported).toEqual([]);
  });

  it("keeps tate-chu-yoko in one scaled base op and places adjacent vertical ruby", () => {
    const plan = planDialogueRubyPdfOps(input({
      text: "縦2026横",
      rubySpans: [{ start: 1, end: 5, ruby: "にせん" }],
      vertical: true,
      width: 100,
    }), pdfOptions);
    const tcy = plan.baseOps.find((op) => op.op === "text" && op.text === "2026");
    expect(tcy).toMatchObject({ op: "text", matrix: [expect.any(Number), 0, 0, 1] });
    expect(tcy?.op === "text" ? tcy.matrix?.[0] : undefined).toBeLessThan(1);
    expect(plan.rubyOps.map((op) => op.op === "text" ? op.text : "").join("")).toBe("にせん");
    expect(plan.unsupported).toEqual([]);
  });

  it("reports malformed, overlapping, and surrogate-splitting spans without dropping source metadata", () => {
    const rubySpans = [
      { start: 0, end: 1, ruby: "a" },
      { start: 0, end: 4, ruby: "overlap" },
      { start: 1, end: 2, ruby: "split" },
      { start: 1.5, end: 3, ruby: "fraction" },
      { start: -1, end: 99, ruby: "range" },
    ];
    const plan = planDialogueRubyPdfOps(input({ text: "A😀B", rubySpans }), pdfOptions);
    expect(plan.rubyOps).toHaveLength(1);
    expect(plan.unsupported.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "overlapping-span",
      "split-surrogate-pair",
      "fractional-offset",
      "out-of-range",
    ]));
    expect(plan.metadata?.rubySpans).toEqual(rubySpans);
    expect(plan.metadata?.rubySpans).not.toBe(rubySpans);
  });

  it("splits a valid vertical ruby span across columns and retains every reading glyph", () => {
    const plan = planDialogueRubyPdfOps(input({
      text: "天地玄黄",
      rubySpans: [{ start: 0, end: 4, ruby: "てんちげんこう" }],
      vertical: true,
      width: 25,
      fontSize: 20,
    }), pdfOptions);
    expect(plan.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "span-split-across-columns" }),
    ]));
    expect(plan.rubyOps.map((op) => op.op === "text" ? op.text : "").join("")).toBe("てんちげんこう");
  });

  it("leaves plain horizontal text as one base operation with no ruby metadata", () => {
    const first = planDialogueRubyPdfOps(input({ text: "plain", rubySpans: undefined }), pdfOptions);
    const second = planDialogueRubyPdfOps(input({ text: "plain", rubySpans: undefined }), pdfOptions);
    expect(first).toEqual(second);
    expect(first.baseOps).toHaveLength(1);
    expect(first.rubyOps).toEqual([]);
    expect(first.metadata).toBeNull();
    expect(first.unsupported).toEqual([]);
  });
});

describe("dialogue ruby metadata XMP", () => {
  it("is canonical, deterministic, XML-safe, and round-trips exact source spans", () => {
    const firstRecord = createDialogueRubyMetadataRecord(input({
      elementId: "z",
      layerName: "<대사&Z>",
    }), "visible-raster-metadata-psd")!;
    const secondRecord = createDialogueRubyMetadataRecord(input({
      elementId: "a",
      rubySpans: [{ ruby: "とう", end: 1, start: 0 }],
    }), "visible-raster-metadata-psd")!;
    const first = buildDialogueRubyExportXmp([firstRecord, secondRecord]);
    const second = buildDialogueRubyExportXmp([secondRecord, firstRecord]);
    expect(first).toBe(second);
    expect(first).toContain("&lt;대사&amp;Z&gt;");
    const parsed = parseDialogueRubyExportXmp(first);
    expect(parsed?.records.map((record) => record.elementId)).toEqual(["a", "z"]);
    expect(parsed?.records[0]?.rubySpans).toEqual([{ start: 0, end: 1, ruby: "とう" }]);
  });
});
