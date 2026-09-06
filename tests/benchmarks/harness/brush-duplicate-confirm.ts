/**
 * 중복 후보 픽셀 확인 — 특징 벡터가 가깝다는 말을, 실제로 겹쳐 보고 확인한다.
 *
 * 앞 단계(probe → audit)는 정규화된 요약 통계로 판정한다. 요약은 서로 다른 그림을 같은 숫자로
 * 접을 수 있다 — 실제로 gpen 과 pen 은 단면 거리 0.00004 로 사실상 동일했지만 픽셀을 겹쳐 보니
 * 전혀 다른 그림이었다. 그래서 최종 후보는 여기서 다시 굽고 직접 뺀다.
 *
 * 질문의 형태가 중요하다. "B 를 A 와 같은 굵기로 맞추면 같은 그림인가" 가 아니라
 * "B 의 굵기 노브를 어떻게 돌려도 A 와 같은 그림이 되는 설정이 있는가" 를 묻는다 — 굵기는
 * 어차피 정규화 대상이므로, 최적 굵기를 찾아 주는 것이 공정하다. 그래서 굵기 격자와 세로
 * 서브픽셀 이동을 함께 훑고 최소값을 취한다.
 *
 * 이동 탐색이 필요한 이유는 실측으로 배웠다. 처음에는 굵기만 1% 오차로 맞추고 그대로 뺐는데,
 * 하드 엣지 브러시는 엣지가 픽셀 격자 어디에 떨어지느냐만으로 nrmse 가 요동쳤다 — brush 대
 * flat-brush 는 0.238, brush 대 marker--chisel-ribbon 은 0.00002 이 나와 삼각부등식이 깨졌다.
 * 그건 질감 차이가 아니라 위상 차이였다.
 *
 * 판정 지표는 nrmse 가 아니라 |Δ| 의 p95 다. nrmse 는 엣지 몇 줄에 지배되지만, p95 는 획의
 * 몸통이 같은지를 말해 준다.
 *
 * 입력: results/brush-duplicate-matrix.json · 출력: results/brush-duplicate-confirm.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportPageToSvg } from "../../../apps/web/src/domains/creator/export/studio-svg-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULTS = resolve(ROOT, "tests/benchmarks/results");

const CANVAS_W = 460;
const CANVAS_H = 96;
const SCALE = 4;
const BASE_WIDTH = 16;
const STROKE_COLOR = "#1b1b1f";
const BG_LUMA = 255;
const INK_SPAN = BG_LUMA - 0x1b;

/**
 * 굵기 미세 격자 — 해석적으로 푼 굵기 주변만 훑는다.
 *
 * 처음에는 ±10% 를 0.02 간격으로 훑었는데, 하드 엣지 밴드에서는 그걸로도 모자랐다. 유효폭이
 * 0.15px 만 어긋나도 엣지 두 줄이 통째로 틀리고, 밴드 두께가 32px 이면 그 두 줄이 전체의 6% 라
 * p95 가 바로 엣지에 걸린다 — brush 대 flat-brush 가 0.238 로 나오는데 둘 다 marker--chisel-ribbon
 * 과는 0.00002 인 삼각부등식 위반이 그렇게 생겼다. 그래서 격자로 찾지 않고 직접 푼다.
 */
const WIDTH_REFINE = [0.99, 0.995, 1, 1.005, 1.01] as const;
/**
 * 세로 위상 탐색 — 하드 엣지의 격자 정렬 운을 지운다. 반픽셀 단계까지 훑는 이유는 실측 때문이다:
 * brush·flat-chisel 계열은 전부 경계가 딱 떨어지는 solid 밴드라, 밴드 두께가 짝수 픽셀이냐
 * 홀수 픽셀이냐에 따라 중심이 반 픽셀 어긋나고 정수 이동으로는 절대 겹쳐지지 않는다.
 */
const SHIFTS = [-2, -1.75, -1.5, -1.25, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.25, 1.5,
  1.75, 2] as const;

interface Field {
  data: Float32Array;
  width: number;
  height: number;
}

const module_ = await import("@resvg/resvg-wasm");
const require = createRequire(import.meta.url);
await module_.initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

function render(brush: string, strokeWidth: number): Field {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 72; index += 1) {
    const t = index / 71;
    points.push(18 + t * (CANVAS_W - 36), CANVAS_H / 2);
    pressures.push(0.7);
  }
  const { svg } = exportPageToSvg({
    width: CANVAS_W,
    height: CANVAS_H,
    bg: "#ffffff",
    elements: [
      {
        id: `${brush}-confirm`,
        type: "draw" as const,
        kind: "freehand" as const,
        brush,
        points,
        pressures,
        stroke: STROKE_COLOR,
        strokeWidth,
        opacity: 1,
        seed: 7_331,
      },
    ] as never,
  });
  const renderer = new module_.Resvg(svg, {
    shapeRendering: 2,
    font: { loadSystemFonts: false },
    fitTo: { mode: "width", value: CANVAS_W * SCALE },
  });
  const rendered = renderer.render();
  const { width, height } = rendered;
  const rgba = rendered.pixels;
  const data = new Float32Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    const alpha = rgba[offset + 3] / 255;
    const mean = (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3;
    const composited = mean * alpha + BG_LUMA * (1 - alpha);
    const ink = (BG_LUMA - composited) / INK_SPAN;
    data[index] = ink < 0 ? 0 : ink > 1 ? 1 : ink;
  }
  rendered.free();
  renderer.free();
  return { data, width, height };
}

function inkFloor(field: Field): number {
  let peak = 0;
  for (let index = 0; index < field.data.length; index += 7) {
    if (field.data[index] > peak) peak = field.data[index];
  }
  return Math.max(0.004, 0.03 * peak);
}

/** 총 잉크를 획 길이로 나눈 유효폭 — 굵기 격자의 중심을 잡을 때 쓴다. */
function effectiveWidth(field: Field) {
  const floor = inkFloor(field);
  let inked = 0;
  let sum = 0;
  for (let index = 0; index < field.data.length; index += 1) {
    if (field.data[index] > floor) {
      inked += 1;
      sum += field.data[index];
    }
  }
  if (inked === 0) return { width: 0, meanInk: 0, floor, inked };
  const meanInk = sum / inked;
  return { width: sum / meanInk / ((CANVAS_W - 36) * SCALE), meanInk, floor, inked };
}

/** 잉크 평균 1.0 으로 맞춘 두 장을, B 를 세로로 shift 만큼 옮겨 뺀다(반픽셀은 선형 보간). */
function sampleShifted(b: Field, x: number, y: number): number {
  const y0 = Math.floor(y);
  const y1 = y0 + 1;
  const f = y - y0;
  const low = y0 >= 0 && y0 < b.height ? b.data[y0 * b.width + x] : 0;
  const high = y1 >= 0 && y1 < b.height ? b.data[y1 * b.width + x] : 0;
  return low * (1 - f) + high * f;
}

function difference(a: Field, b: Field, shift: number) {
  const statsA = effectiveWidth(a);
  const statsB = effectiveWidth(b);
  if (!(statsA.meanInk > 0) || !(statsB.meanInk > 0)) return null;
  let count = 0;
  let squared = 0;
  const deltas: number[] = [];
  for (let y = 0; y < a.height; y += 1) {
    const ys = y + shift;
    if (ys < -1 || ys >= b.height) continue;
    for (let x = 0; x < a.width; x += 1) {
      const va = a.data[y * a.width + x];
      const vb = sampleShifted(b, x, ys);
      if (va <= statsA.floor && vb <= statsB.floor) continue;
      const delta = va / statsA.meanInk - vb / statsB.meanInk;
      squared += delta * delta;
      count += 1;
      if (count % 3 === 0) deltas.push(Math.abs(delta));
    }
  }
  if (count === 0) return null;
  deltas.sort((x, y) => x - y);
  return {
    nrmse: Math.sqrt(squared / count),
    p95: deltas[Math.floor(deltas.length * 0.95)] ?? 0,
    pixels: count,
  };
}

/**
 * B 를 A 와 같은 유효폭으로 만드는 굵기를 푼다. 유효폭은 굵기에 대해 선형이되 원점을 지나지
 * 않는다(실측: flat-brush 는 eff ≈ 2.5·w + 2). 두 점으로 기울기와 절편을 잡고 목표를 역산한 뒤,
 * 남은 비선형은 한 번의 뉴턴 보정으로 흡수한다.
 */
function solveWidth(brushB: string, targetWidth: number) {
  const low = { strokeWidth: BASE_WIDTH, ...measure(brushB, BASE_WIDTH) };
  const high = { strokeWidth: BASE_WIDTH * 1.5, ...measure(brushB, BASE_WIDTH * 1.5) };
  const slope = (high.width - low.width) / (high.strokeWidth - low.strokeWidth);
  if (!(Math.abs(slope) > 1e-6)) return BASE_WIDTH;
  const intercept = low.width - slope * low.strokeWidth;
  let strokeWidth = (targetWidth - intercept) / slope;
  for (let step = 0; step < 2; step += 1) {
    if (!(strokeWidth > 0.2) || strokeWidth > 200) return BASE_WIDTH;
    const seen = measure(brushB, strokeWidth);
    const error = seen.width - targetWidth;
    if (Math.abs(error) < 0.02) break;
    strokeWidth -= error / slope;
  }
  return strokeWidth;
}

const measureCache = new Map<string, { width: number }>();
function measure(brush: string, strokeWidth: number) {
  const key = `${brush}@${strokeWidth.toFixed(4)}`;
  const cached = measureCache.get(key);
  if (cached) return cached;
  const value = { width: effectiveWidth(render(brush, strokeWidth)).width };
  measureCache.set(key, value);
  return value;
}

/**
 * B 의 굵기·위상을 훑어 A 와 가장 잘 겹치는 설정을 찾는다. 굵기는 정규화 대상이므로 최적값을
 * 찾아 주는 것이 공정하고, 위상은 래스터 격자의 우연이므로 지워야 한다.
 */
function bestOverlay(a: Field, brushB: string, targetWidth: number) {
  const solved = solveWidth(brushB, targetWidth);
  let best: { nrmse: number; p95: number; pixels: number; strokeWidth: number; shift: number }
    | null = null;
  for (const scale of WIDTH_REFINE) {
    const strokeWidth = solved * scale;
    if (!(strokeWidth > 0.2) || strokeWidth > 200) continue;
    const field = render(brushB, strokeWidth);
    for (const shift of SHIFTS) {
      const result = difference(a, field, shift);
      if (!result) continue;
      if (!best || result.p95 < best.p95 || (result.p95 === best.p95 && result.nrmse < best.nrmse)) {
        best = { ...result, strokeWidth, shift };
      }
    }
  }
  return best;
}

interface Pair {
  a: string;
  b: string;
  distance: Record<string, number>;
  gate: Record<string, number>;
  worstRatio: number;
  worstAxis: string;
  widthRatio: number;
  opacityRatio: number;
}

const matrix = JSON.parse(
  await readFile(resolve(RESULTS, "brush-duplicate-matrix.json"), "utf8"),
) as { duplicatePairs: Pair[]; nearMissPairs: Pair[] };

const candidates = [
  ...matrix.duplicatePairs,
  ...matrix.nearMissPairs.filter((p) => p.worstRatio <= 1.4),
];

const baseline = new Map<string, { field: Field; width: number }>();
function baseFor(id: string) {
  const cached = baseline.get(id);
  if (cached) return cached;
  const field = render(id, BASE_WIDTH);
  const entry = { field, width: effectiveWidth(field).width };
  baseline.set(id, entry);
  return entry;
}

const confirmed = candidates.map((pair) => {
  const base = baseFor(pair.a);
  const best = bestOverlay(base.field, pair.b, base.width);
  return {
    ...pair,
    pixel: best
      ? {
        p95: Number(best.p95.toFixed(5)),
        nrmse: Number(best.nrmse.toFixed(5)),
        pixelsCompared: best.pixels,
        bestStrokeWidth: Number(best.strokeWidth.toFixed(3)),
        bestShiftPx: best.shift,
      }
      : null,
  };
});
confirmed.sort((x, y) => (x.pixel?.p95 ?? 99) - (y.pixel?.p95 ?? 99));

await writeFile(
  resolve(RESULTS, "brush-duplicate-confirm.json"),
  `${JSON.stringify(
    {
      generatedAtUtc: new Date().toISOString(),
      method:
        "B is re-rendered over a stroke-width grid centred on the width that matches A's measured"
        + " effective width, each render compared against A at five vertical sub-pixel shifts,"
        + " both normalised to mean ink 1.0; the best overlay is reported. Judged on p95 of the"
        + " per-pixel |difference| — nrmse is dominated by a few edge rows, p95 answers whether"
        + " the body of the stroke is the same picture.",
      canvas: { width: CANVAS_W, height: CANVAS_H, scale: SCALE, pressure: 0.7 },
      search: {
        width: "solved analytically (two-point linear fit of effective width vs stroke width plus"
          + " a Newton correction), then refined over " + JSON.stringify([...WIDTH_REFINE]),
        shiftsPx: [...SHIFTS],
      },
      candidates: confirmed.length,
      pairs: confirmed,
    },
    null,
    1,
  )}\n`,
);

console.log(`confirmed ${confirmed.length} candidate pairs on pixels`);
for (const pair of confirmed) {
  if (!pair.pixel) continue;
  console.log(
    `  p95 ${pair.pixel.p95.toFixed(5).padStart(8)}  nrmse ${pair.pixel.nrmse.toFixed(4)}`
    + `  gate ${pair.worstRatio.toFixed(2).padStart(5)}  ${pair.a} ~ ${pair.b}`,
  );
}
