/**
 * 전 브러시 시각 대조 시트 — 통계가 아니라 픽셀을 본다.
 *
 * 이 저장소에서 질감 결함을 실제로 잡은 건 매번 확대 렌더였다. 오일 베드는 톤 지표가 좋아진
 * 뒤에도 3배로 키우자 합판 무늬가 드러났고, 수묵은 프로브가 엉뚱한 경로를 재고 있었다. 집계
 * 수치는 "무엇이 잘못됐는지"를 말해주지 않고, 평평함과 규칙성을 서로 상쇄해 가리기까지 한다.
 *
 * 그래서 이 하니스는 판정하지 않는다. 제품의 SVG 직렬화(캔버스와 같은 기하)를 그대로 래스터로
 * 굽고, 사람이 볼 수 있는 시트로 타일링만 한다. 판정은 눈이 한다.
 *
 * 각 브러시는 세 획으로 그린다 — 직선(시작·끝 처리), 곡선(꺾임), 짧은 탭(단독 접점). 이 셋이
 * 이번 세션에서 보고된 결함 유형("시작과 끝", "꺾이는 구간", "튜브류")과 정확히 대응한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS } from "../../../apps/web/src/domains/creator/brush/studio-brush-engine-lane-catalog";
import { STUDIO_BRUSH_RUNTIME_CONTRACT } from "../../../apps/web/src/domains/creator/brush/studio-brush-runtime-contract";
import { materializeStudioBrushCatalogSelection } from "../../../apps/web/src/domains/creator/brush/studio-brush-selection";
import { captureStudioDrawPointerPressureContract } from "../../../apps/web/src/domains/creator/brush/studio-draw-pointer-pressure-contract";
import { exportPageToSvg } from "../../../apps/web/src/domains/creator/export/studio-svg-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = resolve(ROOT, "tests/benchmarks/results/brush-contact-sheet");

/** 확대해야 보인다 — 1배에서는 격자도 계단도 안티에일리어싱에 묻힌다. */
const SCALE = Number(process.env.BRUSH_SHEET_SCALE ?? 3);
/** 계열만 골라 크게 보려면 BRUSH_SHEET_FILTER 에 정규식을 준다. */
const FILTER = process.env.BRUSH_SHEET_FILTER
  ? new RegExp(process.env.BRUSH_SHEET_FILTER)
  : null;
const PREFIX = process.env.BRUSH_SHEET_PREFIX ?? "sheet";
const CELL_W = Number(process.env.BRUSH_SHEET_CELL_W ?? 300);
const CELL_H = 140;
const COLUMNS = Number(process.env.BRUSH_SHEET_COLUMNS ?? 2);
const ROWS_PER_SHEET = 5;

const STROKE_COLOR = "#1b1b1f";

/** 직선: 시작·끝 처리. 곡선: 꺾임과 자기 근접. 탭: 단독 접점. */
function strokes(width: number) {
  const straight = { points: [] as number[], pressures: [] as number[] };
  for (let i = 0; i < Math.max(24, Math.round(CELL_W / 12)); i += 1) {
    const t = i / (Math.max(24, Math.round(CELL_W / 12)) - 1);
    straight.points.push(16 + t * (CELL_W - 32), 26);
    // 양끝이 얇고 가운데가 두꺼운 자연스러운 필압 — taper 처리를 드러낸다.
    straight.pressures.push(0.12 + 0.78 * Math.sin(Math.PI * t));
  }
  const curve = { points: [] as number[], pressures: [] as number[] };
  for (let i = 0; i < Math.max(40, Math.round(CELL_W / 8)); i += 1) {
    const t = i / (Math.max(40, Math.round(CELL_W / 8)) - 1);
    curve.points.push(16 + t * (CELL_W - 32), 82 + Math.sin(t * Math.PI * 2.2) * 14);
    curve.pressures.push(0.55 + 0.35 * Math.cos(t * Math.PI * 3));
  }
  const tap = { points: [CELL_W - 60, 126, CELL_W - 56, 127], pressures: [0.8, 0.8] };
  return [
    { id: "straight", ...straight, strokeWidth: width },
    { id: "curve", ...curve, strokeWidth: width },
    { id: "tap", ...tap, strokeWidth: width },
  ];
}

function brushIds(): { id: string; name: string }[] {
  const laneById = new Map(
    STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map((row) => [row.id, row.name]),
  );
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const row of STUDIO_BRUSH_RUNTIME_CONTRACT) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, name: laneById.get(row.id) ?? row.id });
  }
  for (const row of STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, name: row.name });
  }
  return out;
}

/**
 * The brush's own pinned dynamics snapshot — the same one the app materialises at pointer-down.
 *
 * Without it this sheet was drawing a DIFFERENT ENGINE for anything whose look lives in its
 * dynamics. Measured on dry media: unpinned, every one of crayon/chalk/charcoal/pastel/oil-pastel
 * serialises as a single flat `dry-media-union-ribbon` path, because studio-svg-export strips an
 * absent pin through studioReplaySafeBrushDynamicsSettingsForBrushId and the union carrier takes
 * ownership. Pinned, the same strokes serialise as 871-1835 alpha-map stamps. The five media
 * "sharing one pointed-shard texture" was that union silhouette, on a route no artist ever draws
 * with — a harness artefact reported as a product defect.
 */
function cellSvg(
  brush: string,
  width: number,
  brushDynamics: unknown,
  drawMode: string | null,
): string {
  // The app's own pointer-down capture policy, for the same reason the dynamics snapshot above is
  // pinned. Without `materialPressureModel` the retained media (brush/flat-brush/the pencils) and
  // the FX pressure brushes all fall to their pre-rollout fixed-width, fixed-opacity route, where
  // the pressure journal reaches neither the nib nor the pigment — so this sheet drew a constant
  // ribbon for strokes an artist can only ever draw with pressure. Taking the marker from the
  // product function rather than hard-coding it keeps the sheet on whatever the app captures.
  const pressureContract = captureStudioDrawPointerPressureContract(
    { drawMode: drawMode ?? "pen", brush, strokeWidth: width },
    false,
  );
  const elements = strokes(width).map((stroke, index) => ({
    ...(pressureContract.materialPressureModel
      ? { materialPressureModel: pressureContract.materialPressureModel }
      : {}),
    ...(pressureContract.materialMinimumDiameterRatio === undefined
      ? {}
      : { materialMinimumDiameterRatio: pressureContract.materialMinimumDiameterRatio }),
    id: `${brush}-${stroke.id}`,
    type: "draw" as const,
    kind: "freehand" as const,
    brush,
    points: stroke.points,
    pressures: stroke.pressures,
    stroke: STROKE_COLOR,
    strokeWidth: stroke.strokeWidth,
    opacity: 1,
    seed: 4_100 + index,
    ...(brushDynamics ? { brushDynamics } : {}),
    // The two erasers carry drawMode "eraser", and the exporter checks el.mode BEFORE it ever
    // resolves a brush family. Omitting it made this sheet draw standard-eraser as a PEN — and
    // report the two as byte-identical duplicates, which they are not on any route a user takes.
    ...(drawMode ? { mode: drawMode } : {}),
  }));
  const { svg } = exportPageToSvg({
    width: CELL_W,
    height: CELL_H,
    bg: "#ffffff",
    elements: elements as never,
  });
  return svg;
}

const module_ = await import("@resvg/resvg-wasm");
const require = createRequire(import.meta.url);
await module_.initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

await mkdir(OUT_DIR, { recursive: true });

const all = brushIds().filter(({ id }) => !FILTER || FILTER.test(id));
const failures: { id: string; error: string }[] = [];
const cells: { id: string; name: string; png: Uint8Array }[] = [];

for (const { id, name } of all) {
  try {
    const selection = await materializeStudioBrushCatalogSelection(id);
    const svg = cellSvg(
      id,
      16,
      selection?.brushDynamics ?? null,
      (selection as { drawMode?: string } | null)?.drawMode ?? null,
    );
    const renderer = new module_.Resvg(svg, {
      shapeRendering: 2,
      font: { loadSystemFonts: false },
      fitTo: { mode: "width", value: CELL_W * SCALE },
    });
    const rendered = renderer.render();
    cells.push({ id, name, png: rendered.asPng() });
    rendered.free();
    renderer.free();
  } catch (error) {
    failures.push({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

// 시트 조립은 SVG 로 한다 — 셀 PNG 를 data URI 로 박고 다시 구우면 별도 이미지 라이브러리가
// 필요 없고, 라벨도 같은 렌더러가 그린다.
const sheetCount = Math.ceil(cells.length / (COLUMNS * ROWS_PER_SHEET));
for (let sheet = 0; sheet < sheetCount; sheet += 1) {
  const slice = cells.slice(
    sheet * COLUMNS * ROWS_PER_SHEET,
    (sheet + 1) * COLUMNS * ROWS_PER_SHEET,
  );
  const labelH = 18;
  const sheetW = COLUMNS * CELL_W;
  const sheetH = ROWS_PER_SHEET * (CELL_H + labelH);
  const parts = slice.map((cell, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = column * CELL_W;
    const y = row * (CELL_H + labelH);
    const base64 = Buffer.from(cell.png).toString("base64");
    return `<text x="${x + 6}" y="${y + 13}" font-size="12"`
      + ` fill="#333">${cell.id}</text>`
      + `<image x="${x}" y="${y + labelH}" width="${CELL_W}" height="${CELL_H}"`
      + ` href="data:image/png;base64,${base64}"/>`
      + `<rect x="${x}" y="${y + labelH}" width="${CELL_W}" height="${CELL_H}"`
      + ` fill="none" stroke="#d6d6de"/>`;
  }).join("");
  const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW}" height="${sheetH}">`
    + `<rect width="${sheetW}" height="${sheetH}" fill="#fafafa"/>${parts}</svg>`;
  const renderer = new module_.Resvg(sheetSvg, {
    font: { loadSystemFonts: true, defaultFontFamily: "Helvetica" },
    fitTo: { mode: "width", value: sheetW * 2 },
  });
  const rendered = renderer.render();
  await writeFile(
    resolve(OUT_DIR, `${PREFIX}-${String(sheet + 1).padStart(2, "0")}.png`),
    Buffer.from(rendered.asPng()),
  );
  rendered.free();
  renderer.free();
}

await writeFile(
  resolve(OUT_DIR, "index.json"),
  `${JSON.stringify({
    generatedAtUtc: new Date().toISOString(),
    scale: SCALE,
    rendered: cells.length,
    failed: failures.length,
    sheets: sheetCount,
    order: cells.map(({ id }) => id),
    failures,
  }, null, 2)}\n`,
);
console.log(`rendered ${cells.length}/${all.length} brushes into ${sheetCount} sheets`);
if (failures.length > 0) {
  console.log(`failed: ${failures.slice(0, 12).map((f) => `${f.id} (${f.error})`).join("; ")}`);
}
