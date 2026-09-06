import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";

import {
  createTextShapeCache,
  fitPolylineToPath,
  renderSceneToPixels,
  shapeTextCached,
} from "@toonspectrum/studio-engine-vello";
import { loadVelloNode } from "@toonspectrum/studio-engine-vello/node";
import { beforeAll, describe, expect, it } from "vitest";

import {
  COMPOSITION_PRESETS,
  PATTERN_STAR_MOTIF,
  PATTERN_STAR_MOTIF_SVG_PATH_DATA,
  UNAVAILABLE_COMPOSITION_ROWS,
  V12_SECTION_12_2_ROW_NAMES,
  describeCompositionChain,
  executeCompositionProgram,
  standardCompositionStrokeSamples,
} from "../../packages/studio-brush-platform/src/brush-composition";
import { loadInkStrokeModeler } from "../../packages/studio-brush-platform/src/ink-modeler";
import { loadLibMypaint } from "../../packages/studio-brush-platform/src/libmypaint/index";
import { parseSvgToScene } from "../../packages/studio-format-gateway/src/svg";

import type {
  CompositionEngines,
  CompositionProgramIR,
  ExecuteCompositionResult,
} from "../../packages/studio-brush-platform/src/brush-composition";
import type { HokusaiModuleLike } from "../../packages/studio-brush-platform/src/raster-compile";
import type { ModeledSampleIR } from "@toonspectrum/studio-project-model";

/**
 * Composition brush program gate (V12 §12.2 "대표 공격적 조합") — every
 * shipped preset chains REAL engines (ink-stroke-modeler / ema / spring →
 * perfect-freehand [+ Kurbo fit] / raster-dab → Vello CPU / libmypaint /
 * Hokusai → deterministic composite) on the shared preview canvas.
 *
 * Gates:
 * - determinism: same program + input + engines → byte-identical pixels;
 * - 구별성: every preset paints a distinct pixel identity;
 * - stage-manipulation detection: swapping ONLY the stabilizer backend (or
 *   only the layer order) shifts the sha;
 * - 필압 보존: pressure-driven presets keep column-thickness ↔ pressure-ramp
 *   correlation > 0.9 on a straight ramp stroke (pressure-fidelity 패턴 준용);
 * - 실측 처리량: pts/ms per preset above a conservative floor (measured,
 *   optionally dumped via COMPOSITION_THROUGHPUT_OUT);
 * - golden manifest: sha256 + ink count per preset committed; regenerate
 *   with REGEN_V11_GOLDENS=1 plus visual review.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const HOKUSAI_PKG_DIR = join(REPO_ROOT, "packages", "studio-hokusai-wasm", "pkg");
const GOLDEN_PATH = join(
  REPO_ROOT,
  "tests",
  "corpus",
  "brushes",
  "brush-composition-goldens.json",
);
const FONT_PATH = join(
  REPO_ROOT,
  "tests",
  "corpus",
  "text",
  "fonts",
  "Roboto-Regular.ttf",
);
const REGEN = process.env.REGEN_V11_GOLDENS === "1";
const THROUGHPUT_OUT = process.env.COMPOSITION_THROUGHPUT_OUT;
const PRESSURE_OUT = process.env.COMPOSITION_PRESSURE_OUT;

const WIDTH = 192;
const HEIGHT = 96;
const SEED = 7;
const SAMPLE_COUNT = 96;
/** Conservative pts/ms floor — an order of magnitude under measured rates. */
const THROUGHPUT_FLOOR_PTS_PER_MS = 0.1;
const PRESSURE_CORRELATION_GATE = 0.9;

/**
 * Presets excluded from the per-COLUMN pressure correlation, with the reason:
 * - 모노라인·기술펜: uniform width by design (thinning 0);
 * - 텍스트 브러시: a column is not a quantum of a text brush. Glyph outlines
 *   modulate column mass by tens of percent at CONSTANT pressure ('T' stem vs
 *   'O' bowl vs inter-glyph gap), so per-column Pearson measures the font, not
 *   the pressure response. Its 필압 응답 is gated separately, per glyph cell,
 *   in "텍스트 브러시 keeps 필압 응답 per glyph cell" below.
 */
const COLUMN_PRESSURE_EXEMPT_IDS = new Set(["monoline-technical-pen", "text-brush"]);
const PRESSURE_DRIVEN_IDS = new Set(
  COMPOSITION_PRESETS.filter(
    (preset) => !COLUMN_PRESSURE_EXEMPT_IDS.has(preset.id),
  ).map((preset) => preset.id),
);

type HokusaiModule =
  typeof import("../../packages/studio-hokusai-wasm/pkg/studio_hokusai_wasm.js");

let engines: CompositionEngines;
let strokeInput: ModeledSampleIR[];

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function execute(program: CompositionProgramIR): ExecuteCompositionResult {
  return executeCompositionProgram(program, strokeInput, engines, {
    width: WIDTH,
    height: HEIGHT,
    seed: SEED,
  });
}

/** Pixels whose RGB differs from the white background by more than 8/255. */
function inkedPixels(pixels: Uint8Array): number {
  let ink = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (
      Math.abs((pixels[index] ?? 255) - 255) > 8 ||
      Math.abs((pixels[index + 1] ?? 255) - 255) > 8 ||
      Math.abs((pixels[index + 2] ?? 255) - 255) > 8
    ) {
      ink += 1;
    }
  }
  return ink;
}

/** Straight horizontal stroke carrying a linear 0.1→1.0 pressure ramp. */
function pressureRampSamples(): ModeledSampleIR[] {
  const margin = 16;
  const count = 96;
  const samples: ModeledSampleIR[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = index / (count - 1);
    samples.push({
      x: margin + t * (WIDTH - 2 * margin),
      y: HEIGHT / 2,
      tMs: index * 6,
      pressure: 0.1 + 0.9 * t,
      velocity: 1,
      altitudeDeg: 90,
      azimuthDeg: 0,
    });
  }
  return samples;
}

/** Ink mass per column (darkness vs the white background). */
function columnDarkness(pixels: Uint8Array): number[] {
  const columns = new Array<number>(WIDTH).fill(0);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const base = (y * WIDTH + x) * 4;
      columns[x] =
        (columns[x] ?? 0) +
        (3 * 255 -
          ((pixels[base] ?? 255) +
            (pixels[base + 1] ?? 255) +
            (pixels[base + 2] ?? 255)));
    }
  }
  return columns;
}

function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < n; index += 1) {
    const da = (a[index] ?? 0) - meanA;
    const db = (b[index] ?? 0) - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  if (varianceA === 0 || varianceB === 0) return 0;
  return covariance / Math.sqrt(varianceA * varianceB);
}

beforeAll(async () => {
  const [libmypaint] = await Promise.all([loadLibMypaint(), loadVelloNode()]);
  const inkModeler = await loadInkStrokeModeler();
  const hokusaiModule = (await import(
    join(HOKUSAI_PKG_DIR, "studio_hokusai_wasm.js")
  )) as HokusaiModule;
  const wasmBytes = await readFile(
    join(HOKUSAI_PKG_DIR, "studio_hokusai_wasm_bg.wasm"),
  );
  await hokusaiModule.default({ module_or_path: wasmBytes });
  // 텍스트 브러시 lane: the parley shaper with the corpus font bound, fronted
  // by the package's own LRU so repeated executions re-shape at most once.
  const fontBytes = new Uint8Array(
    await readFile(FONT_PATH),
  );
  const textShapeCache = createTextShapeCache({ maxEntries: 32, maxBytes: 4_000_000 });
  engines = {
    libmypaint,
    hokusai: hokusaiModule as unknown as HokusaiModuleLike,
    inkModeler,
    vello: { renderScene: renderSceneToPixels, fitPolyline: fitPolylineToPath },
    text: {
      shapeText: (text, options) =>
        shapeTextCached(textShapeCache, text, fontBytes, options),
    },
  };
  strokeInput = standardCompositionStrokeSamples(WIDTH, HEIGHT, SAMPLE_COUNT);
}, 120_000);

describe("V12 §12.2 composition brush programs (real engine chain)", () => {
  it("covers the §12.2 table: 12 composed presets + 1 explicit unavailable row", () => {
    expect(COMPOSITION_PRESETS).toHaveLength(12);
    expect(UNAVAILABLE_COMPOSITION_ROWS).toHaveLength(1);
    expect(
      [...COMPOSITION_PRESETS.map((preset) => preset.name),
        ...UNAVAILABLE_COMPOSITION_ROWS.map((row) => row.name)].sort(),
    ).toEqual([...V12_SECTION_12_2_ROW_NAMES].sort());
    // The one remaining gap must name the shipped-but-unreachable provider,
    // not a vague "not implemented" — zero silent loss applies to the record.
    expect(UNAVAILABLE_COMPOSITION_ROWS[0]?.name).toBe("3D 표면 브러시");
    expect(UNAVAILABLE_COMPOSITION_ROWS[0]?.missing).toContain(
      "apps/web/src/domains/creator/studio-vrm-texture-uv.ts",
    );
  });

  it("the 장식·패턴 motif is exactly what the SVG lane parses (자산 연결 증명)", () => {
    const { scene, unsupported, warnings } = parseSvgToScene(
      `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">` +
        `<path d="${PATTERN_STAR_MOTIF_SVG_PATH_DATA}" fill="#000"/></svg>`,
    );
    expect(unsupported).toEqual([]);
    expect(warnings).toEqual([]);
    const node = scene.nodes[0];
    expect(node?.kind).toBe("fill-path");
    expect(node?.kind === "fill-path" ? node.path : null).toEqual(
      PATTERN_STAR_MOTIF,
    );
  });

  it("every row-9..12 provider reports the instances it actually emitted", () => {
    const providerRows = new Map<string, string>([
      ["decoration-pattern", "pattern-stamp"],
      ["particle-spray", "particle-splat"],
      ["ribbon-hair-rope", "ribbon-xpbd"],
      ["text-brush", "text-on-path"],
    ]);
    for (const preset of COMPOSITION_PRESETS) {
      const expectedGeometry = providerRows.get(preset.id);
      if (expectedGeometry === undefined) continue;
      const report = execute(preset).layers[0];
      expect(report?.geometry, `${preset.id} geometry stage`).toBe(
        expectedGeometry,
      );
      expect(report?.instances ?? 0, `${preset.id} instances`).toBeGreaterThan(4);
    }
    // The eight rows that shipped first never grew an `instances` field.
    for (const preset of COMPOSITION_PRESETS) {
      if (providerRows.has(preset.id)) continue;
      for (const layer of execute(preset).layers) {
        expect(layer.instances, `${preset.id}.${layer.id} instances`).toBeUndefined();
      }
    }
  });

  it("every preset renders deterministically on the shared canvas", () => {
    for (const preset of COMPOSITION_PRESETS) {
      const first = execute(preset);
      const second = execute(preset);
      expect(sha256(second.pixels), `${preset.id} determinism`).toBe(
        sha256(first.pixels),
      );
      expect(first.width, `${preset.id} canvas width`).toBe(WIDTH);
      expect(first.height, `${preset.id} canvas height`).toBe(HEIGHT);
      expect(inkedPixels(first.pixels), `${preset.id} ink coverage`).toBeGreaterThan(
        200,
      );
      expect(second.warnings, `${preset.id} warnings determinism`).toEqual(
        first.warnings,
      );
    }
  });

  it("every preset paints a distinct pixel identity (조합 구별성)", () => {
    const hashes = new Set(
      COMPOSITION_PRESETS.map((preset) => sha256(execute(preset).pixels)),
    );
    expect(hashes.size).toBe(COMPOSITION_PRESETS.length);
  });

  it("swapping only the stabilizer backend shifts every preset's sha", () => {
    for (const preset of COMPOSITION_PRESETS) {
      const swappedBackend =
        preset.input.backend === "ema"
          ? ("spring" as const)
          : ("ema" as const);
      const swapped: CompositionProgramIR = {
        ...preset,
        input: { ...preset.input, backend: swappedBackend },
      };
      expect(
        sha256(execute(swapped).pixels),
        `${preset.id} ${preset.input.backend}→${swappedBackend} detection`,
      ).not.toBe(sha256(execute(preset).pixels));
    }
  });

  it("swapping only the layer order shifts every multi-layer preset's sha", () => {
    const multiLayer = COMPOSITION_PRESETS.filter(
      (preset) => preset.layers.length > 1,
    );
    expect(multiLayer.length).toBeGreaterThanOrEqual(3);
    for (const preset of multiLayer) {
      const reversed: CompositionProgramIR = {
        ...preset,
        layers: [...preset.layers].reverse(),
      };
      expect(
        sha256(execute(reversed).pixels),
        `${preset.id} layer-order detection`,
      ).not.toBe(sha256(execute(preset).pixels));
    }
  });

  it("pressure-driven presets keep ramp correlation > 0.9 (필압 응답 보존)", async () => {
    const ramp = pressureRampSamples();
    const margin = 24; // stroke margin + dab-radius bleed
    const measured: Array<{ id: string; correlation: number }> = [];
    for (const preset of COMPOSITION_PRESETS) {
      if (!PRESSURE_DRIVEN_IDS.has(preset.id)) continue;
      const result = executeCompositionProgram(preset, ramp, engines, {
        width: WIDTH,
        height: HEIGHT,
        seed: SEED,
      });
      const columns = columnDarkness(result.pixels);
      const gated: number[] = [];
      const pressures: number[] = [];
      for (let x = margin; x < WIDTH - margin; x += 1) {
        gated.push(columns[x] ?? 0);
        pressures.push(0.1 + (0.9 * (x - margin)) / (WIDTH - 2 * margin));
      }
      const correlation = pearson(pressures, gated);
      measured.push({ id: preset.id, correlation });
      expect(
        correlation,
        `${preset.id} 필압 램프 상관 (measured ${correlation.toFixed(4)})`,
      ).toBeGreaterThan(PRESSURE_CORRELATION_GATE);
    }
    if (PRESSURE_OUT) {
      await mkdir(dirname(PRESSURE_OUT), { recursive: true });
      await writeFile(
        PRESSURE_OUT,
        `${JSON.stringify(
          { gate: PRESSURE_CORRELATION_GATE, margin, measured },
          null,
          2,
        )}\n`,
      );
    }
  });

  it("텍스트 브러시 keeps 필압 응답 per glyph cell (컬럼 대신 글리프 단위)", () => {
    const preset = COMPOSITION_PRESETS.find((entry) => entry.id === "text-brush");
    expect(preset, "text-brush preset").toBeDefined();
    if (preset === undefined) return;

    // (1) The ramp profile, box-smoothed over one glyph cell (font size +
    // letter spacing ≈ 17 px, rounded up to an odd 21 px window), still tracks
    // pressure: the glyph comb is quotiented out, the mass gradient is not.
    const ramp = pressureRampSamples();
    const margin = 24;
    const columns = columnDarkness(
      executeCompositionProgram(preset, ramp, engines, {
        width: WIDTH,
        height: HEIGHT,
        seed: SEED,
      }).pixels,
    );
    const window = 21;
    const half = (window - 1) / 2;
    const smoothed: number[] = [];
    const pressures: number[] = [];
    for (let x = margin; x < WIDTH - margin; x += 1) {
      let sum = 0;
      for (let offset = -half; offset <= half; offset += 1) {
        sum += columns[Math.min(WIDTH - 1, Math.max(0, x + offset))] ?? 0;
      }
      smoothed.push(sum / window);
      pressures.push(0.1 + (0.9 * (x - margin)) / (WIDTH - 2 * margin));
    }
    const correlation = pearson(pressures, smoothed);
    expect(
      correlation,
      `text-brush 글리프셀 필압 상관 (measured ${correlation.toFixed(4)})`,
    ).toBeGreaterThan(PRESSURE_CORRELATION_GATE);

    // (2) Direct proof, immune to any smoothing choice: flat-pressure strokes
    // must deposit strictly more ink as pressure rises.
    const flatInk = [0.25, 0.6, 1].map((pressure) => {
      const flat = ramp.map((sample) => ({ ...sample, pressure }));
      return inkedPixels(
        executeCompositionProgram(preset, flat, engines, {
          width: WIDTH,
          height: HEIGHT,
          seed: SEED,
        }).pixels,
      );
    });
    for (let index = 1; index < flatInk.length; index += 1) {
      const previous = flatInk[index - 1] ?? 0;
      const current = flatInk[index] ?? 0;
      expect(
        current,
        `text-brush flat-pressure ink ${JSON.stringify(flatInk)}`,
      ).toBeGreaterThan(previous * 1.15);
    }
  });

  it("keeps measured throughput above the floor (실측 pts/ms, 조합별)", async () => {
    const rows: Array<{ id: string; ptsPerMs: number; bestMs: number }> = [];
    for (const preset of COMPOSITION_PRESETS) {
      let bestMs = Number.POSITIVE_INFINITY;
      for (let run = 0; run < 3; run += 1) {
        const startedAt = performance.now();
        execute(preset);
        bestMs = Math.min(bestMs, performance.now() - startedAt);
      }
      const ptsPerMs = strokeInput.length / bestMs;
      rows.push({ id: preset.id, ptsPerMs, bestMs });
      expect(
        ptsPerMs,
        `${preset.id} throughput (measured ${ptsPerMs.toFixed(2)} pts/ms)`,
      ).toBeGreaterThan(THROUGHPUT_FLOOR_PTS_PER_MS);
    }
    if (THROUGHPUT_OUT) {
      await mkdir(dirname(THROUGHPUT_OUT), { recursive: true });
      await writeFile(
        THROUGHPUT_OUT,
        `${JSON.stringify({ canvas: { WIDTH, HEIGHT, SEED, SAMPLE_COUNT }, rows }, null, 2)}\n`,
      );
    }
  });

  it("matches the committed golden manifest (regen with REGEN_V11_GOLDENS=1)", async () => {
    const current = COMPOSITION_PRESETS.map((preset) => {
      const result = execute(preset);
      return {
        id: preset.id,
        name: preset.name,
        lane: preset.lane,
        chain: describeCompositionChain(preset),
        outSamples: result.input.outSamples,
        sha256: sha256(result.pixels),
        inkedPixels: inkedPixels(result.pixels),
        layers: result.layers,
        warnings: result.warnings,
      };
    });

    if (REGEN) {
      await mkdir(dirname(GOLDEN_PATH), { recursive: true });
      await writeFile(
        GOLDEN_PATH,
        `${JSON.stringify(
          {
            harness: "tests/visual/brush-composition.test.ts",
            api: "executeCompositionProgram (packages/studio-brush-platform/src/brush-composition.ts)",
            doc: "docs/architecture/ToonStudio_Vello차세대엔진_공격적활용_CSP초월_인플레이스최종아키텍처_V12_2026-08-08.md §12.2",
            engines:
              "ink-stroke-modeler pinned wasm | libmypaint 1.6.1 pinned wasm | hokusai 0.3.0 via studio-hokusai-wasm | vello_cpu via studio-engine-vello (render + kurbo fit)",
            canvas: { width: WIDTH, height: HEIGHT, seed: SEED, samples: SAMPLE_COUNT },
            path: "standardCompositionStrokeSamples (preview-spec zigzag lifted to ModeledSampleIR)",
            unavailableRows: UNAVAILABLE_COMPOSITION_ROWS,
            presets: current,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    const golden = JSON.parse(await readFile(GOLDEN_PATH, "utf8")) as {
      presets: Array<{
        id: string;
        chain: string;
        outSamples: number;
        sha256: string;
        inkedPixels: number;
        layers: unknown[];
        warnings: string[];
      }>;
    };
    expect(golden.presets).toHaveLength(current.length);
    for (const [index, preset] of current.entries()) {
      const expected = golden.presets[index];
      expect(preset.id, `preset order[${index}]`).toBe(expected?.id);
      expect(preset.chain, `${preset.id} chain`).toBe(expected?.chain);
      expect(preset.outSamples, `${preset.id} stabilized samples`).toBe(
        expected?.outSamples,
      );
      expect(preset.sha256, `${preset.id} golden hash`).toBe(expected?.sha256);
      expect(preset.inkedPixels, `${preset.id} golden coverage`).toBe(
        expected?.inkedPixels,
      );
      expect(preset.layers, `${preset.id} per-layer report`).toEqual(
        expected?.layers,
      );
      expect(preset.warnings, `${preset.id} golden warnings`).toEqual(
        expected?.warnings,
      );
    }
  });
});
