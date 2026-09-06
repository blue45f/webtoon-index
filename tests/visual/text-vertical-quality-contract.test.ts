import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

const ROOT = join(__dirname, "..", "..");
const RESULT_PATH = join(ROOT, "tests/benchmarks/results/text-vertical-quality.json");
const PRODUCT_PNG = join(ROOT, "tests/corpus/text/golden/vertical-quality-product.png");
const VELLO_PNG = join(ROOT, "tests/corpus/text/golden/vertical-quality-engine-vello.png");
const SKIA_PNG = join(ROOT, "tests/corpus/text/golden/vertical-quality-engine-skia.png");

const EXPECTED_HASHES = {
  product: "24040c0bfeedcf61736694393628d0abea528d6865b1c7a96ddd4ea41b64d2fa",
  vello: "e55646d6bf5467b7d63bdd633bde1137d4a55ae86c1bfec6839eb4d8816a6f59",
  skia: "e03e781da67d1ee0548c4779751e6c2c5516e3deef2fd8471cfdd4a4709c96eb",
  appleGothic: "def69dc2b5e12746049a5dcb189f95341ec460589f47587938567313af3020b1",
  arialUnicode: "876af2cd4854644e7f3e7feb2f688997fdb3343c6df6693611209c9dfb47ccec",
} as const;

const latencySchema = z.object({
  p50: z.number().nonnegative(),
  p95: z.number().nonnegative(),
  p99: z.number().nonnegative(),
  max: z.number().nonnegative(),
});

const layoutCaseSchema = z.object({
  id: z.string().min(1),
  sourceGlyphs: z.number().int().positive(),
  paintedGlyphs: z.number().int().positive(),
  columns: z.number().int().positive(),
  forms: z.record(z.string(), z.number().int().nonnegative()),
  kinsokuViolations: z.number().int().nonnegative(),
  columnsRightToLeft: z.boolean(),
  tateChuYokoWithinOneCell: z.boolean(),
  deterministic: z.boolean(),
  geometrySha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const rubyCaseSchema = z.object({
  id: z.string().min(1),
  placements: z.number().int().positive(),
  warningCodes: z.array(z.string()),
  unsupportedCodes: z.array(z.string()),
  readingExact: z.boolean(),
  rightOfBase: z.boolean(),
  centered: z.boolean(),
  columnsRightToLeft: z.boolean(),
  sourceRubyPreserved: z.boolean(),
  readingSha256: z.string().regex(/^[0-9a-f]{64}$/u),
});

const allTrueGatesSchema = z.record(z.string(), z.literal(true));

const verticalFeatureEvidenceSchema = z.object({
  text: z.literal("「」、。！？"),
  sourceCodePoints: z.literal(6),
  glyphs: z.literal(6),
  noGlyphDrop: z.literal(true),
  deterministic: z.literal(true),
  shapeSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  verticalFeatures: z.object({
    requested: z.tuple([z.literal("vert"), z.literal("vrt2")]),
    fontHasVert: z.literal(true),
    fontHasVrt2: z.literal(false),
    application: z.literal("applied"),
    appliedGlyphs: z.literal(2),
    geometricFallbackGlyphs: z.literal(4),
    strategy: z.literal("mixed"),
  }),
  glyphEvidence: z.array(z.object({
    source: z.string().length(1),
    glyphId: z.number().int().nonnegative(),
    verticalAlternate: z.boolean(),
    verticalFallback: z.enum(["rotate", "offset", "upright-center"]).nullable(),
    rotated: z.boolean(),
  })).length(6),
  warnings: z.array(z.string()).min(4),
  manualPresentationFormSubstitutionClaimed: z.literal(false),
  harfBuzzReference: z.object({
    executable: z.literal("/opt/homebrew/bin/hb-shape"),
    version: z.literal("hb-shape (HarfBuzz) 14.2.1"),
    fontPath: z.literal("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
    fontBytesCopied: z.literal(false),
    text: z.literal("「」、。！？"),
    requestedFeatures: z.tuple([z.literal("vert"), z.literal("vrt2")]),
    ltr: z.object({
      direction: z.literal("ltr"),
      args: z.array(z.string()).length(4),
      output: z.string().includes("gid4599"),
      glyphIds: z.tuple([
        z.literal(4599), z.literal(4600), z.literal(4588),
        z.literal(4589), z.literal(6621), z.literal(6651),
      ]),
    }),
    ttb: z.object({
      direction: z.literal("ttb"),
      args: z.array(z.string()).length(4),
      output: z.string().includes("gid6445"),
      glyphIds: z.tuple([
        z.literal(6445), z.literal(6446), z.literal(4588),
        z.literal(4589), z.literal(6621), z.literal(6651),
      ]),
    }),
    changedGlyphIndices: z.tuple([z.literal(0), z.literal(1)]),
    directionDependent: z.literal(true),
    note: z.string().includes("no font bytes are copied or redistributed"),
  }),
  apiFinding: z.object({
    skrifa: z.string().includes("GSUB"),
    parley: z.string().includes("no vertical-direction builder API"),
    selectedApproach: z.string().includes("Direction::TopToBottom"),
  }),
});

const resultSchema = z.object({
  schema: z.literal("toon-text-vertical-quality-v1"),
  runtime: z.object({ execution: z.string().includes("no mock") }),
  integrity: z.object({
    cpu: z.object({ files: z.literal(5), manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u) }),
    gpu: z.object({ files: z.literal(5), manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u) }),
  }),
  fonts: z.object({
    wasmShaping: z.object({
      family: z.literal("AppleGothic"),
      path: z.literal("/System/Library/Fonts/Supplemental/AppleGothic.ttf"),
      sha256: z.literal(EXPECTED_HASHES.appleGothic),
      bytes: z.literal(15_255_648),
      redistribution: z.string().includes("not committed"),
    }),
    browserVisual: z.object({
      family: z.literal("Arial Unicode"),
      path: z.literal("/System/Library/Fonts/Supplemental/Arial Unicode.ttf"),
      sha256: z.literal(EXPECTED_HASHES.arialUnicode),
      bytes: z.literal(23_278_008),
      redistribution: z.string().includes("not committed"),
    }),
  }),
  product: z.object({
    execution: z.string().includes("product layout/ruby functions"),
    chromium: z.string().includes("HeadlessChrome/140.0.7339.186"),
    workload: z.object({
      warmupRounds: z.literal(40),
      sampleCount: z.literal(240),
      innerRounds: z.literal(20),
      layoutCasesPerSample: z.literal(8),
      rubyCasesPerSample: z.literal(3),
    }),
    layout: z.object({
      latencyPerCorpusBatchMs: latencySchema,
      rawSamplesMs: z.array(z.number().nonnegative()).length(240),
      cases: z.array(layoutCaseSchema).length(8),
    }),
    ruby: z.object({
      latencyPerCorpusBatchMs: latencySchema,
      rawSamplesMs: z.array(z.number().nonnegative()).length(240),
      cases: z.array(rubyCaseSchema).length(3),
    }),
    visual: z.object({
      width: z.literal(348),
      height: z.literal(315),
      sha256: z.literal(EXPECTED_HASHES.product),
      geometrySha256: z.string().regex(/^[0-9a-f]{64}$/u),
      byteExactRepeat: z.literal(true),
      geometryExactRepeat: z.literal(true),
      contains: z.array(z.string()).min(6),
      file: z.literal("tests/corpus/text/golden/vertical-quality-product.png"),
    }),
    gates: allTrueGatesSchema,
  }),
  wasm: z.object({
    workload: z.object({
      warmupRounds: z.literal(30),
      sampleCount: z.literal(160),
      casesPerSample: z.literal(6),
      fontSizePx: z.literal(32),
    }),
    latencyPerSixCaseBatchMs: latencySchema.extend({
      rawSamplesMs: z.array(z.number().nonnegative()).length(160),
    }),
    cases: z.array(z.object({
      id: z.string().min(1),
      sourceCodePoints: z.number().int().positive(),
      glyphs: z.number().int().positive(),
      columns: z.number().int().positive(),
      warnings: z.array(z.string()),
      tateChuYokoGlyphs: z.number().int().nonnegative(),
      rotatedGlyphs: z.number().int().nonnegative(),
      noGlyphDrop: z.literal(true),
      deterministic: z.literal(true),
      tateChuYokoWithinOneCell: z.literal(true),
      expectedOrientation: z.literal(true),
      shapeSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    })).length(6),
    verticalFeatureEvidence: verticalFeatureEvidenceSchema,
    memory: z.object({
      observedRssDeltaBytes: z.number(),
      observedHeapUsedDeltaBytes: z.number(),
      peakCpuBytes: z.null(),
      peakGpuBytes: z.null(),
    }),
    rendererPixelEvidence: z.object({
      scene: z.object({ width: z.literal(204), height: z.literal(204), glyphs: z.literal(21), columns: z.literal(5) }),
      warnings: z.array(z.string()).length(0),
      fuzzy: z.object({ delta: z.literal(48), mismatchPct: z.literal(0.002403), gatePct: z.literal(0.6) }),
      vello: z.object({
        inkPixels: z.literal(4476),
        bounds: z.object({ minX: z.literal(8), minY: z.literal(2), maxX: z.literal(177), maxY: z.literal(174) }),
        pngSha256: z.literal(EXPECTED_HASHES.vello),
        byteExactRepeat: z.literal(true),
      }),
      canvaskit: z.object({
        inkPixels: z.literal(4354),
        bounds: z.object({ minX: z.literal(8), minY: z.literal(2), maxX: z.literal(177), maxY: z.literal(174) }),
        pngSha256: z.literal(EXPECTED_HASHES.skia),
        byteExactRepeat: z.literal(true),
      }),
      inkCoverageDifferencePct: z.literal(2.725648),
      separation: z.string().includes("vertical ruby remains product-geometry"),
    }),
    gates: allTrueGatesSchema,
  }),
  limitations: z.array(z.string()).min(6),
});

type Result = z.infer<typeof resultSchema>;

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
}

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function recomputeStats(samples: readonly number[]) {
  return {
    p50: round(percentile(samples, 0.5)),
    p95: round(percentile(samples, 0.95)),
    p99: round(percentile(samples, 0.99)),
    max: round(Math.max(...samples)),
  };
}

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function loadResult(): Promise<Result> {
  return resultSchema.parse(JSON.parse(await readFile(RESULT_PATH, "utf8")));
}

async function verifyIntegrity(directory: "pkg" | "pkg-gpu", expectedManifestSha: string) {
  const root = join(ROOT, "crates/studio-engine-vello", directory);
  const manifest = await readFile(join(root, "INTEGRITY.sha256"), "utf8");
  expect(sha256(manifest)).toBe(expectedManifestSha);
  for (const line of manifest.trim().split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/u.exec(line);
    expect(match, line).not.toBeNull();
    const [, expected, file] = match!;
    expect(sha256(new Uint8Array(await readFile(join(root, file!))))).toBe(expected);
  }
}

describe("V12 vertical text quality evidence contract", () => {
  it("recomputes every reported latency percentile from committed raw samples", async () => {
    const result = await loadResult();
    expect(recomputeStats(result.product.layout.rawSamplesMs)).toEqual(
      result.product.layout.latencyPerCorpusBatchMs,
    );
    expect(recomputeStats(result.product.ruby.rawSamplesMs)).toEqual(
      result.product.ruby.latencyPerCorpusBatchMs,
    );
    expect(recomputeStats(result.wasm.latencyPerSixCaseBatchMs.rawSamplesMs)).toEqual({
      p50: result.wasm.latencyPerSixCaseBatchMs.p50,
      p95: result.wasm.latencyPerSixCaseBatchMs.p95,
      p99: result.wasm.latencyPerSixCaseBatchMs.p99,
      max: result.wasm.latencyPerSixCaseBatchMs.max,
    });
  });

  it("pins no-drop, one-cell tate-chu-yoko, ruby geometry, RTL columns, and zero corpus kinsoku violations", async () => {
    const result = await loadResult();
    expect(result.product.layout.cases.every((entry) => entry.sourceGlyphs === entry.paintedGlyphs)).toBe(true);
    expect(result.product.layout.cases.every((entry) => entry.kinsokuViolations === 0)).toBe(true);
    expect(result.product.layout.cases.every((entry) => entry.columnsRightToLeft && entry.deterministic)).toBe(true);
    expect(result.product.gates.punctuationRolesIsolated).toBe(true);
    expect(result.product.layout.cases.find((entry) => entry.id === "tate-chu-yoko-1-to-4")?.forms["tate-chu-yoko"]).toBe(4);
    expect(result.product.layout.cases.find((entry) => entry.id === "kinsoku-punctuation")).toMatchObject({
      sourceGlyphs: 19,
      paintedGlyphs: 19,
      columns: 4,
      kinsokuViolations: 0,
    });
    expect(result.product.layout.cases.find((entry) => entry.id === "five-digit-rotated-fallback")?.forms.rotated).toBe(1);
    const crossColumn = result.product.ruby.cases.find((entry) => entry.id === "cross-column-surrogate");
    expect(crossColumn).toMatchObject({
      placements: 4,
      warningCodes: ["span-split-across-columns"],
      unsupportedCodes: [],
      readingExact: true,
      rightOfBase: true,
      centered: true,
      columnsRightToLeft: true,
      sourceRubyPreserved: true,
    });
    expect(result.wasm.cases.filter((entry) => /^roboto-tcy-/u.test(entry.id)).map((entry) => entry.tateChuYokoGlyphs)).toEqual([1, 2, 3, 4]);
    expect(result.wasm.cases.find((entry) => entry.id === "roboto-five-digit-fallback")).toMatchObject({
      tateChuYokoGlyphs: 0,
      rotatedGlyphs: 5,
    });
    expect(result.wasm.verticalFeatureEvidence.glyphEvidence.map((entry) => ({
      source: entry.source,
      alternate: entry.verticalAlternate,
      fallback: entry.verticalFallback,
      rotated: entry.rotated,
    }))).toEqual([
      { source: "「", alternate: true, fallback: null, rotated: false },
      { source: "」", alternate: true, fallback: null, rotated: false },
      { source: "、", alternate: false, fallback: "offset", rotated: false },
      { source: "。", alternate: false, fallback: "offset", rotated: false },
      { source: "！", alternate: false, fallback: "upright-center", rotated: false },
      { source: "？", alternate: false, fallback: "upright-center", rotated: false },
    ]);
    expect(result.wasm.verticalFeatureEvidence.warnings.some((warning) => /U\+FE/u.test(warning))).toBe(false);
    expect(result.wasm.verticalFeatureEvidence.harfBuzzReference.changedGlyphIndices).toEqual([0, 1]);
    expect(result.wasm.rendererPixelEvidence.warnings.every((warning) =>
      /explicit (?:rotate|offset|upright-center) geometric fallback/u.test(warning))).toBe(true);
  });

  it("pins reference PNG bytes, dimensions, engine bounds, and generated WASM integrity", async () => {
    const result = await loadResult();
    const [product, vello, skia] = await Promise.all([
      readFile(PRODUCT_PNG),
      readFile(VELLO_PNG),
      readFile(SKIA_PNG),
    ]);
    expect(sha256(product)).toBe(EXPECTED_HASHES.product);
    expect(sha256(vello)).toBe(EXPECTED_HASHES.vello);
    expect(sha256(skia)).toBe(EXPECTED_HASHES.skia);
    expect(pngDimensions(product)).toEqual({ width: 348, height: 315 });
    expect(pngDimensions(vello)).toEqual({ width: 204, height: 204 });
    expect(pngDimensions(skia)).toEqual({ width: 204, height: 204 });
    expect(result.wasm.rendererPixelEvidence.vello.bounds).toEqual(
      result.wasm.rendererPixelEvidence.canvaskit.bounds,
    );
    expect(result.wasm.rendererPixelEvidence.fuzzy.mismatchPct).toBeLessThanOrEqual(
      result.wasm.rendererPixelEvidence.fuzzy.gatePct,
    );
    await Promise.all([
      verifyIntegrity("pkg", result.integrity.cpu.manifestSha256),
      verifyIntegrity("pkg-gpu", result.integrity.gpu.manifestSha256),
    ]);
  });

  it("proves the harness and shipped Konva/SVG/Rust paths use the real vertical feature sources", async () => {
    const [harness, browserHarness, textNodes, bubbleNode, svgExport, verticalCore, rubyCore, rustCore] = await Promise.all([
      readFile(join(ROOT, "tests/benchmarks/harness/text-vertical-quality.ts"), "utf8"),
      readFile(join(ROOT, "tests/benchmarks/harness/text-vertical-quality-browser.ts"), "utf8"),
      readFile(join(ROOT, "apps/web/src/domains/creator/StudioKonvaTextNodes.tsx"), "utf8"),
      readFile(join(ROOT, "apps/web/src/domains/creator/StudioKonvaBubbleNode.tsx"), "utf8"),
      readFile(join(ROOT, "apps/web/src/domains/creator/export/studio-svg-export.ts"), "utf8"),
      readFile(join(ROOT, "apps/web/src/domains/creator/studio-vertical-text.ts"), "utf8"),
      readFile(join(ROOT, "apps/web/src/domains/creator/lettering/studio-dialogue-ruby-layout.ts"), "utf8"),
      readFile(join(ROOT, "crates/studio-engine-vello/src/text_vertical.rs"), "utf8"),
    ]);
    expect(browserHarness).toContain("layoutVerticalText(");
    expect(browserHarness).toContain("planDialogueVerticalRubyOverlayPlacements(");
    expect(browserHarness).toContain("verticalTextItemGeometry(");
    expect(harness).toContain("shapeTextVerticalToGlyphPaths(");
    expect(harness).toContain("renderSceneToPixels(scene)");
    expect(harness).not.toContain("Math.random");
    for (const source of [textNodes, bubbleNode]) {
      expect(source).toContain("planDialogueVerticalRubyOverlayPlacements(");
      expect(source).toContain("scaleX={scaleX}");
      expect(source).toContain("studio-vertical-ruby");
    }
    expect(svgExport).toContain("verticalTextItemGeometry(");
    expect(verticalCore).toContain('form: "tate-chu-yoko"');
    expect(rubyCore).toContain("export function planDialogueVerticalRubyOverlayPlacements(");
    expect(rustCore).toContain("Segment::TateChuYoko(run)");
    expect(rustCore).toContain("tate_chu_yoko: true");
    expect(rustCore).toContain("Direction::TopToBottom");
    expect(rustCore).toContain('Feature::new(harfrust::Tag::new(b"vert"), 1, ..)');
    expect(rustCore).toContain('Feature::new(harfrust::Tag::new(b"vrt2"), 1, ..)');
    expect(rustCore).not.toContain("UnavailableParleyHorizontal");
    expect(rustCore).not.toContain("vertical_form_candidate");
  });
});
