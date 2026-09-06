/**
 * 꺾이는 구간 전수 검사 — 방향이 급히 바뀔 때 실루엣이 무너지는 브러시를 찾는다.
 *
 * 긴 직선은 떨림 스윕이 본다. 여기서 보는 건 반대쪽 실패다: 획이 꺾이는 지점에서 재료가 밖으로
 * 튀어나오거나(스파이크·덩어리), 안쪽이 파이거나(노치·구멍) 하는 현상. 둘 다 눈에는 그냥
 * "어색하다"로 보이지만 원인이 다르다.
 *
 * 측정은 두 가지, 둘 다 **브러시 자기 자신을 기준으로 정규화**한다. 스프레이나 목탄처럼 원래
 * 흩뿌리는 재료는 어디서나 밖으로 나가고 어디서나 구멍이 있으므로, 절대값으로 재면 질감을 결함
 * 으로 오인한다. 꼭짓점 근방과 직선 팔 구간에서 같은 양을 재고 그 비를 본다 — 꺾임이 만든
 * 차이만 남는다.
 *
 *   overshootRatio  획 밴드(중심선에서 반폭) 밖으로 나간 잉크의 99.5 분위 거리. 근방 ÷ 직선.
 *   coreHoleRatio   중심선 근처(반폭의 절반 안쪽)에서 잉크가 비어 있는 비율. 근방 ÷ 직선.
 *
 * 판정하지 않고 순위만 매긴다. 상위 결함은 PNG 로 구워서 눈으로 확인한다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS } from "../../../apps/web/src/domains/creator/brush/studio-brush-engine-lane-catalog";
import { STUDIO_BRUSH_RUNTIME_CONTRACT } from "../../../apps/web/src/domains/creator/brush/studio-brush-runtime-contract";
import { exportPageToSvg } from "../../../apps/web/src/domains/creator/export/studio-svg-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const OUT_DIR = resolve(ROOT, "tests/benchmarks/results/brush-corner");
const RESULT_PATH = resolve(ROOT, "tests/benchmarks/results/brush-corner.json");

const W = 420;
const H = 300;
const SCALE = 2;
const STROKE_WIDTH = 22;
const HALF_WIDTH = STROKE_WIDTH / 2;
const VERTEX_X = 210;
const VERTEX_Y = 250;
const ARM = 190;
const SAMPLES_PER_ARM = 70;

/** 꼭짓점 근방으로 볼 반경(문서 px) — 조인이 실제로 만들어지는 범위. */
const NEAR_RADIUS = STROKE_WIDTH * 1.4;
/** 직선 기준 구간: 조인의 영향에서 충분히 벗어난 팔의 중간. */
const FAR_INNER = STROKE_WIDTH * 3;
const FAR_OUTER = STROKE_WIDTH * 7;

const ARM_A = { x: VERTEX_X - ARM * 0.707, y: VERTEX_Y - ARM * 0.707 };
const ARM_B = { x: VERTEX_X + ARM * 0.707, y: VERTEX_Y - ARM * 0.707 };

function cornerSvg(brush: string): string {
  const points: number[] = [];
  const pressures: number[] = [];
  const push = (x: number, y: number) => {
    points.push(x, y);
    pressures.push(0.72);
  };
  for (let index = 0; index < SAMPLES_PER_ARM; index += 1) {
    const t = index / SAMPLES_PER_ARM;
    push(ARM_A.x + (VERTEX_X - ARM_A.x) * t, ARM_A.y + (VERTEX_Y - ARM_A.y) * t);
  }
  for (let index = 0; index <= SAMPLES_PER_ARM; index += 1) {
    const t = index / SAMPLES_PER_ARM;
    push(VERTEX_X + (ARM_B.x - VERTEX_X) * t, VERTEX_Y + (ARM_B.y - VERTEX_Y) * t);
  }
  const { svg } = exportPageToSvg({
    width: W,
    height: H,
    bg: "#ffffff",
    elements: [{
      id: `${brush}-corner`,
      type: "draw",
      kind: "freehand",
      brush,
      points,
      pressures,
      stroke: "#101014",
      strokeWidth: STROKE_WIDTH,
      opacity: 1,
      seed: 617,
    }] as never,
  });
  return svg;
}

function distanceToSegment(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 0
    ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared))
    : 0;
  return Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
}

/** 중심선(두 선분)까지의 거리, 문서 px. */
function distanceToPath(x: number, y: number): number {
  return Math.min(
    distanceToSegment(x, y, ARM_A.x, ARM_A.y, VERTEX_X, VERTEX_Y),
    distanceToSegment(x, y, VERTEX_X, VERTEX_Y, ARM_B.x, ARM_B.y),
  );
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  values.sort((left, right) => left - right);
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]!;
}

interface Zone {
  /** 잉크가 찍힌 픽셀의 중심선 거리 (문서 px). */
  readonly inkDistances: number[];
  /** 코어(반폭의 절반 안쪽) 픽셀 수와 그중 비어 있는 수. */
  coreTotal: number;
  coreEmpty: number;
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
  overshootRatio: number;
  coreHoleRatio: number;
  nearOvershootPx: number;
  farOvershootPx: number;
  nearHole: number;
  farHole: number;
}[] = [];
const failures: { id: string; error: string }[] = [];

for (const id of ids) {
  try {
    const renderer = new module_.Resvg(cornerSvg(id), {
      shapeRendering: 2,
      font: { loadSystemFonts: false },
      fitTo: { mode: "width", value: W * SCALE },
    });
    const rendered = renderer.render();
    const { pixels, width, height } = rendered;
    const near: Zone = { inkDistances: [], coreTotal: 0, coreEmpty: 0 };
    const far: Zone = { inkDistances: [], coreTotal: 0, coreEmpty: 0 };
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const documentX = column / SCALE;
        const documentY = row / SCALE;
        const toVertex = Math.hypot(documentX - VERTEX_X, documentY - VERTEX_Y);
        const zone = toVertex <= NEAR_RADIUS
          ? near
          : toVertex >= FAR_INNER && toVertex <= FAR_OUTER
            ? far
            : null;
        if (!zone) continue;
        const offset = (row * width + column) * 4;
        const luminance = 0.299 * pixels[offset]! + 0.587 * pixels[offset + 1]!
          + 0.114 * pixels[offset + 2]!;
        const inked = luminance < 200;
        const distance = distanceToPath(documentX, documentY);
        if (inked) zone.inkDistances.push(distance);
        if (distance <= HALF_WIDTH * 0.5) {
          zone.coreTotal += 1;
          if (!inked) zone.coreEmpty += 1;
        }
      }
    }
    rendered.free();
    renderer.free();
    const nearOvershootPx = percentile(near.inkDistances, 0.995);
    const farOvershootPx = percentile(far.inkDistances, 0.995);
    const nearHole = near.coreTotal > 0 ? near.coreEmpty / near.coreTotal : 0;
    const farHole = far.coreTotal > 0 ? far.coreEmpty / far.coreTotal : 0;
    rows.push({
      id,
      // 팔 쪽이 0 이면(완전히 밴드 안) 근방도 밴드 안이어야 정상이므로 반폭으로 정규화한다.
      overshootRatio: farOvershootPx > 0.5
        ? nearOvershootPx / farOvershootPx
        : nearOvershootPx / HALF_WIDTH,
      // 팔 쪽에 구멍이 거의 없으면(연속 캐리어) 근방 구멍은 그대로 결함이다.
      coreHoleRatio: farHole > 0.02 ? nearHole / farHole : nearHole / 0.02,
      nearOvershootPx,
      farOvershootPx,
      nearHole,
      farHole,
    });
  } catch (error) {
    failures.push({ id, error: error instanceof Error ? error.message : String(error) });
  }
}

const OVERSHOOT_LIMIT = 1.3;
const HOLE_LIMIT = 2;
const suspect = rows.filter((row) =>
  row.overshootRatio > OVERSHOOT_LIMIT || row.coreHoleRatio > HOLE_LIMIT);
const severity = (row: { overshootRatio: number; coreHoleRatio: number }) =>
  Math.max(row.overshootRatio / OVERSHOOT_LIMIT, row.coreHoleRatio / HOLE_LIMIT);
rows.sort((left, right) => severity(right) - severity(left));

const bake = Number(process.env.CORNER_BAKE ?? 16);
for (const row of rows.filter((candidate) => severity(candidate) > 1).slice(0, bake)) {
  const renderer = new module_.Resvg(cornerSvg(row.id), {
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
  schema: "toon-brush-corner-sweep-v2",
  generatedAtUtc: new Date().toISOString(),
  strokeWidth: STROKE_WIDTH,
  nearRadius: NEAR_RADIUS,
  farBand: [FAR_INNER, FAR_OUTER],
  overshootLimit: OVERSHOOT_LIMIT,
  holeLimit: HOLE_LIMIT,
  measured: rows.length,
  suspect: suspect.length,
  worst: rows.slice(0, 40),
  failures,
}, null, 2)}\n`);

console.log(`measured ${rows.length} brushes, ${suspect.length} suspect`);
for (const row of rows.slice(0, 22)) {
  console.log(
    `  overshoot=${row.overshootRatio.toFixed(2)} (${row.nearOvershootPx.toFixed(1)}px)`
    + ` hole=${row.coreHoleRatio.toFixed(2)} (${(row.nearHole * 100).toFixed(1)}%)  ${row.id}`,
  );
}
