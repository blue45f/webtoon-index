/**
 * 긴 획 떨림 전수 검사.
 *
 * 완벽하게 곧은 입력을 일정한 필압으로 길게 그으면, 나오는 실루엣도 곧아야 한다. 실루엣의
 * 위·아래 경계가 출렁이면 그건 재질이 아니라 떨림이다 — 브러시가 의도한 결(그레인·강모)은
 * 획 안쪽의 농도로 나타나지 경계선의 파형으로 나타나지 않는다.
 *
 * 측정: 열마다 잉크가 있는 첫 픽셀(위 경계)과 마지막 픽셀(아래 경계)을 찾고, 각 경계를 3차
 * 다항식으로 맞춘 뒤 잔차의 RMS 를 본다. 다항식을 빼는 이유는 taper 로 폭이 변하는 건 떨림이
 * 아니기 때문이다. 남는 고주파 성분만 떨림으로 센다.
 *
 * 시각 확인용 PNG 도 같이 굽는다 — 수치가 애매한 경우 눈으로 판정할 수 있어야 한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS } from "../../../apps/web/src/domains/creator/brush/studio-brush-engine-lane-catalog";
import { STUDIO_BRUSH_RUNTIME_CONTRACT } from "../../../apps/web/src/domains/creator/brush/studio-brush-runtime-contract";
import { exportPageToSvg } from "../../../apps/web/src/domains/creator/export/studio-svg-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = resolve(ROOT, "tests/benchmarks/results/brush-tremor");
const RESULT_PATH = resolve(ROOT, "tests/benchmarks/results/brush-tremor.json");

const W = 900;
const H = 80;
const SAMPLES = 120;
const STROKE_WIDTH = 18;
const SCALE = 2;

/** 떨림으로 판정할 잔차 RMS(문서 픽셀). 0.5px 이상이면 곧은 획에서 눈에 보인다. */
const TREMOR_LIMIT_PX = 0.5;

function straightSvg(brush: string): string {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    points.push(30 + (index / (SAMPLES - 1)) * (W - 60), H / 2);
    pressures.push(0.68);
  }
  const { svg } = exportPageToSvg({
    width: W,
    height: H,
    bg: "#ffffff",
    elements: [{
      id: `${brush}-tremor`,
      type: "draw",
      kind: "freehand",
      brush,
      points,
      pressures,
      stroke: "#101014",
      strokeWidth: STROKE_WIDTH,
      opacity: 1,
      seed: 991,
    }] as never,
  });
  return svg;
}

/** 3차 최소자승 — taper 로 인한 완만한 폭 변화는 떨림이 아니다. */
function cubicResidualRms(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (n < 8) return 0;
  const design: number[][] = xs.map((x) => [1, x, x * x, x * x * x]);
  const ata = Array.from({ length: 4 }, () => new Array<number>(4).fill(0));
  const atb = new Array<number>(4).fill(0);
  for (let row = 0; row < n; row += 1) {
    for (let i = 0; i < 4; i += 1) {
      atb[i]! += design[row]![i]! * ys[row]!;
      for (let j = 0; j < 4; j += 1) ata[i]![j]! += design[row]![i]! * design[row]![j]!;
    }
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < 4; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 4; row += 1) {
      if (Math.abs(ata[row]![col]!) > Math.abs(ata[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(ata[pivot]![col]!) < 1e-12) return 0;
    [ata[col], ata[pivot]] = [ata[pivot]!, ata[col]!];
    [atb[col], atb[pivot]] = [atb[pivot]!, atb[col]!];
    for (let row = col + 1; row < 4; row += 1) {
      const factor = ata[row]![col]! / ata[col]![col]!;
      for (let j = col; j < 4; j += 1) ata[row]![j]! -= factor * ata[col]![j]!;
      atb[row]! -= factor * atb[col]!;
    }
  }
  const coefficients = new Array<number>(4).fill(0);
  for (let row = 3; row >= 0; row -= 1) {
    let sum = atb[row]!;
    for (let col = row + 1; col < 4; col += 1) sum -= ata[row]![col]! * coefficients[col]!;
    coefficients[row] = sum / ata[row]![row]!;
  }
  let squared = 0;
  for (let index = 0; index < n; index += 1) {
    const x = xs[index]!;
    const fitted = coefficients[0]! + coefficients[1]! * x
      + coefficients[2]! * x * x + coefficients[3]! * x * x * x;
    squared += (ys[index]! - fitted) ** 2;
  }
  return Math.sqrt(squared / n);
}

const module_ = await import("@resvg/resvg-wasm");
const require = createRequire(import.meta.url);
await module_.initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
await mkdir(OUT_DIR, { recursive: true });

const seen = new Set<string>();
const ids: string[] = [];
for (const row of [...STUDIO_BRUSH_RUNTIME_CONTRACT, ...STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS]) {
  if (seen.has(row.id)) continue;
  seen.add(row.id);
  ids.push(row.id);
}

const rows: {
  id: string;
  topRms: number;
  bottomRms: number;
  worstRms: number;
  inkedColumns: number;
}[] = [];
const failures: { id: string; error: string }[] = [];

for (const id of ids) {
  try {
    const renderer = new module_.Resvg(straightSvg(id), {
      shapeRendering: 2,
      font: { loadSystemFonts: false },
      fitTo: { mode: "width", value: W * SCALE },
    });
    const rendered = renderer.render();
    const pixels = rendered.pixels;
    const width = rendered.width;
    const height = rendered.height;
    const xs: number[] = [];
    const tops: number[] = [];
    const bottoms: number[] = [];
    for (let column = 0; column < width; column += 1) {
      let top = -1;
      let bottom = -1;
      for (let row = 0; row < height; row += 1) {
        const offset = (row * width + column) * 4;
        const luminance = 0.299 * pixels[offset]! + 0.587 * pixels[offset + 1]!
          + 0.114 * pixels[offset + 2]!;
        if (luminance < 200) {
          if (top < 0) top = row;
          bottom = row;
        }
      }
      if (top < 0) continue;
      xs.push(column / SCALE);
      tops.push(top / SCALE);
      bottoms.push(bottom / SCALE);
    }
    // 양 끝 taper 구간은 경계가 급격히 모이므로 중앙 80% 만 본다.
    const start = Math.floor(xs.length * 0.1);
    const end = Math.ceil(xs.length * 0.9);
    const topRms = cubicResidualRms(xs.slice(start, end), tops.slice(start, end));
    const bottomRms = cubicResidualRms(xs.slice(start, end), bottoms.slice(start, end));
    rows.push({
      id,
      topRms,
      bottomRms,
      worstRms: Math.max(topRms, bottomRms),
      inkedColumns: xs.length,
    });
    rendered.free();
    renderer.free();
  } catch (error) {
    failures.push({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

rows.sort((left, right) => right.worstRms - left.worstRms);
const over = rows.filter((row) => row.worstRms > TREMOR_LIMIT_PX);

// 상위 결함만 시각 확인용으로 굽는다.
for (const row of over.slice(0, 12)) {
  const renderer = new module_.Resvg(straightSvg(row.id), {
    shapeRendering: 2,
    font: { loadSystemFonts: false },
    fitTo: { mode: "width", value: W * 2 },
  });
  const rendered = renderer.render();
  await writeFile(
    resolve(OUT_DIR, `${row.id.replace(/[^a-z0-9-]/gi, "_")}.png`),
    Buffer.from(rendered.asPng()),
  );
  rendered.free();
  renderer.free();
}

await writeFile(RESULT_PATH, `${JSON.stringify({
  schema: "toon-brush-tremor-sweep-v1",
  generatedAtUtc: new Date().toISOString(),
  limitPx: TREMOR_LIMIT_PX,
  measured: rows.length,
  overLimit: over.length,
  worst: rows.slice(0, 24),
  failures,
}, null, 2)}\n`);

console.log(`measured ${rows.length} brushes, ${over.length} over ${TREMOR_LIMIT_PX}px`);
for (const row of rows.slice(0, 14)) {
  console.log(`  ${row.worstRms.toFixed(3)}px  ${row.id}`);
}
