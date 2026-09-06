/**
 * 브러시 중복 프로브 — "수치만 조금씩 다른" 브러시를 픽셀에서 찾아낸다.
 *
 * 오너 불만: 굵기(WIDTH)와 불투명도(OPACITY) 스칼라만 다르고 질감은 같은 브러시가 셸프를 채운다.
 * 그래서 이 프로브가 뽑는 모든 특징은 두 스칼라를 나눠서 없앤 "모양"과 "비율"뿐이다.
 *
 *   1) 단면 프로파일 — 획을 세로로 잘라 열마다 무게중심·2차 모멘트(sigma)를 구하고 u=(y-c)/sigma
 *      축으로 48빈에 리샘플한다. sigma 로 나누는 순간 WIDTH 가, 평균을 1.0 으로 맞추는 순간
 *      OPACITY 가 사라진다. 남는 건 엣지가 하드한지, 소프트 꼬리를 끄는지, 어깨가 어디서 꺾이는지.
 *   2) 그레인 히스토그램 — 잉크 픽셀 밀도를 평균 잉크로 나눈 비율 r=a/mean 의 분포. 비율이라
 *      OPACITY 불변이고, 매끈한 획(r≈1 에 집중)과 거친 획(0~2 로 퍼짐)을 가른다.
 *   3) 방향 응답 — 0/45/90/135도 획의 유효폭 비. 치즐·앵글드 리본은 각도마다 굵기가 변하고
 *      둥근 팁은 변하지 않는다. 수평 획 하나만 보면 치즐과 펜이 같은 사각 단면으로 보인다 —
 *      실제로 1차 시안에서 마커 치즐이 펜과 한 클러스터에 묶였다. 그래서 넣었다.
 *   4) 필압 응답 — 필압 0.2/0.45/0.7/0.95 에서의 유효폭 비와 잉크 비. 같은 굵기·같은 질감이라도
 *      필압 매핑이 다르면 손맛이 다르다. 이 축이 "진짜 변종"과 "굵기만 다른 별칭"을 가른다.
 *
 * 유효폭은 단면을 다시 재지 않고 면적/길이로 구한다 — 45도 획을 수직 샘플링하지 않아도 되고,
 * 산란형(스프레이)처럼 단면이 정의되지 않는 브러시에도 그대로 통한다.
 *
 * 모든 측정은 두 위상(phase)에서 반복한다 — 위상 0 은 굵기 16/불투명도 1, 위상 1 은 굵기
 * 24/불투명도 0.7. 즉 같은 브러시에 오너가 지목한 두 노브를 실제로 돌려본 것이다. 정규화가
 * 옳다면 두 위상의 거리는 0 이어야 하고, 남는 잔차가 "같은 브러시인데 수치만 다를 때" 관측되는
 * 거리의 상한이다. 임계값은 눈대중이 아니라 그 잔차에서 나온다.
 *
 * 출력: results/brush-duplicate-probe.json. 판정은 brush-duplicate-audit.ts 가 한다.
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
const OUT_DIR = resolve(ROOT, "tests/benchmarks/results");

/** 확대 렌더 — 1배에서는 그레인이 안티에일리어싱에 묻혀 히스토그램이 전부 r≈1 로 붕괴한다. */
const TEXTURE_SCALE = Number(process.env.BRUSH_PROBE_SCALE ?? 4);
/** 응답 스윕은 총 잉크량만 쓰므로 해상도를 낮춰도 된다 — 렌더 시간의 대부분이 여기다. */
const RESPONSE_SCALE = Number(process.env.BRUSH_PROBE_RESPONSE_SCALE ?? 3);
const FILTER = process.env.BRUSH_PROBE_FILTER ? new RegExp(process.env.BRUSH_PROBE_FILTER) : null;

/** 질감 캔버스 — 열이 많을수록 단면 평균이 안정된다. */
const TEX_W = 460;
const TEX_H = 96;
/** 응답 캔버스 — 45도 획이 캡까지 여유롭게 들어가는 정사각. */
const RES_SIZE = 220;
const RES_LEN = 150;

const BASE_WIDTH = 16;
const STROKE_COLOR = "#1b1b1f";
const BG_LUMA = 255;
const INK_LUMA = 0x1b;
const INK_SPAN = BG_LUMA - INK_LUMA;

const PROFILE_BINS = 48;
const PROFILE_SPAN = 3;
const GRAIN_BINS = 25;
const GRAIN_MAX = 2.4;
const INK_FLOOR = 0.03;

const ANGLES_DEG = [0, 45, 90, 135] as const;
const PRESSURES = [0.2, 0.45, 0.7, 0.95] as const;
const REFERENCE_PRESSURE = 0.7;

interface Field {
  data: Float32Array;
  width: number;
  height: number;
}

interface Phase {
  x: number;
  y: number;
  seed: number;
  strokeWidth: number;
  opacity: number;
}

/**
 * 두 번째 위상이 이 하니스의 눈금자다.
 *
 * 같은 브러시를 굵기 16/불투명도 1 과 굵기 24/불투명도 0.7 로 두 번 굽는다 — 오너가 지목한 바로
 * 그 두 스칼라만 돌린 것이다. 정규화가 옳다면 다섯 축 거리가 전부 0 이어야 하고, 남는 값이
 * "같은 브러시인데 노브만 다를 때의 잔차" 다. 서로 다른 두 브러시가 그 잔차 안쪽이면 노브를
 * 돌린 것과 구별되지 않는다 — 그게 곧 중복의 정의다.
 *
 * 처음에는 서브픽셀 이동만으로 잡음 바닥을 잡았는데, 벡터 렌더러라 재현성이 사실상 완벽해
 * 바닥이 0 으로 붕괴했다. 래스터 안정성은 여기서 물어야 할 질문이 아니었다.
 */
const PHASES: readonly Phase[] = [
  { x: 0, y: 0, seed: 7_331, strokeWidth: 16, opacity: 1 },
  { x: 0.37, y: 0.29, seed: 20_929, strokeWidth: 24, opacity: 0.7 },
];

const module_ = await import("@resvg/resvg-wasm");
const require = createRequire(import.meta.url);
await module_.initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

/**
 * The pins the app applies at pointer-down, cached per brush.
 *
 * Without them this probe compares the WRONG ENGINES. `studio-svg-export` strips an absent
 * dynamics snapshot through `studioReplaySafeBrushDynamicsSettingsForBrushId`, so dry media falls
 * to the union carrier and serialises as one flat path instead of ~900 stamps; without
 * `materialPressureModel` the retained media take their pre-rollout fixed-width route where
 * pressure reaches neither nib nor pigment; and without `mode` an eraser draws as a pen. A
 * duplicate verdict measured on a route no artist can take is not a verdict about the brushes.
 */
const pinCache = new Map<string, {
  brushDynamics: unknown;
  drawMode: string | null;
  materialPressureModel: unknown;
  materialMinimumDiameterRatio: number | undefined;
}>();

async function pinsFor(brush: string, strokeWidth: number) {
  const cached = pinCache.get(brush);
  if (cached) return cached;
  const selection = await materializeStudioBrushCatalogSelection(brush);
  const drawMode = (selection as { drawMode?: string } | null)?.drawMode ?? null;
  const contract = captureStudioDrawPointerPressureContract(
    { drawMode: drawMode ?? "pen", brush, strokeWidth },
    false,
  );
  const pins = {
    brushDynamics: selection?.brushDynamics ?? null,
    drawMode,
    materialPressureModel: contract.materialPressureModel ?? null,
    materialMinimumDiameterRatio: contract.materialMinimumDiameterRatio,
  };
  pinCache.set(brush, pins);
  return pins;
}

async function svgFor(
  brush: string,
  canvas: { width: number; height: number },
  points: number[],
  pressures: number[],
  phase: Phase,
): Promise<string> {
  const pins = await pinsFor(brush, phase.strokeWidth);
  const { svg } = exportPageToSvg({
    width: canvas.width,
    height: canvas.height,
    bg: "#ffffff",
    elements: [
      {
        id: `${brush}-probe`,
        type: "draw" as const,
        kind: "freehand" as const,
        brush,
        points,
        pressures,
        stroke: STROKE_COLOR,
        strokeWidth: phase.strokeWidth,
        opacity: phase.opacity,
        seed: phase.seed,
        ...(pins.brushDynamics ? { brushDynamics: pins.brushDynamics } : {}),
        ...(pins.drawMode ? { mode: pins.drawMode } : {}),
        ...(pins.materialPressureModel
          ? { materialPressureModel: pins.materialPressureModel }
          : {}),
        ...(pins.materialMinimumDiameterRatio === undefined
          ? {}
          : { materialMinimumDiameterRatio: pins.materialMinimumDiameterRatio }),
      },
    ] as never,
  });
  return svg;
}

/** RGBA → 잉크 커버리지 [0,1]. 흰 배경 합성이라 (255 - v) / (255 - ink) 가 알파다. */
function renderField(svg: string, fitWidth: number): Field {
  const renderer = new module_.Resvg(svg, {
    shapeRendering: 2,
    font: { loadSystemFonts: false },
    fitTo: { mode: "width", value: fitWidth },
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

/**
 * 잉크 판정 문턱은 절대값이 아니라 그 렌더 자신의 상위 잉크에 비례해야 한다. 고정 0.03 을 쓰면
 * 불투명도를 낮춘 렌더에서 부드러운 꼬리가 통째로 잘려 나가, 정규화로 지웠어야 할 OPACITY 가
 * 문턱을 통해 다시 새어 들어온다.
 */
function inkFloorFor(field: Field): number {
  const nonZero: number[] = [];
  // 전수 정렬은 비싸다 — 등간격 표본으로 상위 분위를 추정한다.
  const step = Math.max(1, Math.floor(field.data.length / 40_000));
  for (let index = 0; index < field.data.length; index += step) {
    if (field.data[index] > 0.002) nonZero.push(field.data[index]);
  }
  if (nonZero.length === 0) return INK_FLOOR;
  nonZero.sort((a, b) => a - b);
  const peak = nonZero[Math.min(nonZero.length - 1, Math.floor(nonZero.length * 0.995))];
  return Math.max(0.004, INK_FLOOR * peak);
}

function sample(field: Field, x: number, y: number): number {
  if (y < 0 || y > field.height - 1) return 0;
  const y0 = Math.floor(y);
  const y1 = Math.min(y0 + 1, field.height - 1);
  const f = y - y0;
  return field.data[y0 * field.width + x] * (1 - f) + field.data[y1 * field.width + x] * f;
}

// ── 질감 측정 (수평 등압 획) ───────────────────────────────────────────────────────────────
interface TextureMeasure {
  sigmaPx: number;
  meanInk: number;
  coverage: number;
  columns: number;
  profile: number[];
  grain: number[];
  anisotropy: number;
  grainScaleRatio: number;
}

function measureTexture(field: Field): TextureMeasure | null {
  const { width, height, data } = field;
  const inkFloor = inkFloorFor(field);
  const profile = new Float64Array(PROFILE_BINS);
  let columns = 0;
  let sigmaSum = 0;
  // 양끝 8% 는 시작·끝 처리(캡, 테이퍼)가 지배하므로 단면 통계에서 뺀다.
  const x0 = Math.floor(width * 0.08);
  const x1 = Math.floor(width * 0.92);
  for (let x = x0; x < x1; x += 1) {
    let total = 0;
    let weighted = 0;
    for (let y = 0; y < height; y += 1) {
      const a = data[y * width + x];
      if (a <= 0) continue;
      total += a;
      weighted += a * y;
    }
    if (total < 0.5) continue;
    const centre = weighted / total;
    let variance = 0;
    for (let y = 0; y < height; y += 1) {
      const a = data[y * width + x];
      if (a <= 0) continue;
      const d = y - centre;
      variance += a * d * d;
    }
    const sigma = Math.sqrt(variance / total);
    if (!(sigma >= 1.5) || sigma > height / 4) continue;
    const local = new Float64Array(PROFILE_BINS);
    let localSum = 0;
    for (let bin = 0; bin < PROFILE_BINS; bin += 1) {
      const u = -PROFILE_SPAN + ((bin + 0.5) / PROFILE_BINS) * (2 * PROFILE_SPAN);
      const value = sample(field, x, centre + u * sigma);
      local[bin] = value;
      localSum += value;
    }
    if (localSum <= 0) continue;
    // 열마다 평균 1.0 으로 맞춘 뒤 누적 — 진한 열이 평균을 끌고 가지 않게.
    const norm = PROFILE_BINS / localSum;
    for (let bin = 0; bin < PROFILE_BINS; bin += 1) profile[bin] += local[bin] * norm;
    sigmaSum += sigma;
    columns += 1;
  }
  if (columns < 20) return null;
  for (let bin = 0; bin < PROFILE_BINS; bin += 1) profile[bin] /= columns;

  let inked = 0;
  let inkSum = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] > inkFloor) {
      inked += 1;
      inkSum += data[index];
    }
  }
  if (inked < 200) return null;
  const meanInk = inkSum / inked;
  const grain = new Float64Array(GRAIN_BINS);
  for (let index = 0; index < data.length; index += 1) {
    const a = data[index];
    if (a <= inkFloor) continue;
    const ratio = a / meanInk;
    const bin = ratio >= GRAIN_MAX
      ? GRAIN_BINS - 1
      : Math.floor((ratio / GRAIN_MAX) * (GRAIN_BINS - 1));
    grain[bin] += 1;
  }
  for (let bin = 0; bin < GRAIN_BINS; bin += 1) grain[bin] /= inked;

  // 등방성: 잉크 영역의 가로/세로 기울기 에너지 비. 점묘(≈1) 대 결(<1).
  let gx = 0;
  let gy = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (data[y * width + x] <= inkFloor) continue;
      gx += Math.abs(data[y * width + x + 1] - data[y * width + x - 1]);
      gy += Math.abs(data[(y + 1) * width + x] - data[(y - 1) * width + x]);
    }
  }
  const anisotropy = gy > 0 ? gx / gy : 0;

  // 획 방향 자기상관 — 중심선 밀도 변동이 얼마나 멀리까지 상관되는가(그레인 알갱이 크기).
  const sigmaMean = sigmaSum / columns;
  const centreRow = Math.round(height / 2);
  const line: number[] = [];
  for (let x = x0; x < x1; x += 1) line.push(data[centreRow * width + x]);
  const lineMean = line.reduce((a, b) => a + b, 0) / line.length;
  let variance0 = 0;
  for (const v of line) variance0 += (v - lineMean) ** 2;
  variance0 /= line.length;
  let grainScaleRatio = 0;
  if (variance0 > 1e-9) {
    const maxLag = Math.min(120, Math.floor(line.length / 4));
    for (let lag = 1; lag <= maxLag; lag += 1) {
      let cov = 0;
      for (let index = 0; index + lag < line.length; index += 1) {
        cov += (line[index] - lineMean) * (line[index + lag] - lineMean);
      }
      cov /= line.length - lag;
      if (cov / variance0 < 0.5) {
        grainScaleRatio = lag / sigmaMean;
        break;
      }
      if (lag === maxLag) grainScaleRatio = maxLag / sigmaMean;
    }
  }

  return {
    sigmaPx: sigmaMean,
    meanInk,
    coverage: inked / data.length,
    columns,
    profile: [...profile].map((v) => Number(v.toFixed(6))),
    grain: [...grain].map((v) => Number(v.toFixed(6))),
    anisotropy: Number(anisotropy.toFixed(5)),
    grainScaleRatio: Number(grainScaleRatio.toFixed(5)),
  };
}

// ── 응답 측정 (면적/길이 유효폭) ────────────────────────────────────────────────────────────
/**
 * 총 잉크를 경로 길이로 나눈 "유효폭". 단면을 재지 않으므로 45도 획도, 단면이 정의되지 않는
 * 산란형 브러시도 같은 잣대로 잰다. inkArea = 유효폭 x 평균잉크 x 길이 이므로 폭은 면적/잉크다.
 */
function measureResponse(field: Field, pathLengthPx: number) {
  const { data } = field;
  const inkFloor = inkFloorFor(field);
  let inked = 0;
  let inkSum = 0;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] > inkFloor) {
      inked += 1;
      inkSum += data[index];
    }
  }
  if (inked < 50) return null;
  const meanInk = inkSum / inked;
  const inkArea = inkSum;
  return {
    effectiveWidthPx: inkArea / meanInk / pathLengthPx,
    meanInk,
    footprintPx: inked / pathLengthPx,
  };
}

function responseStroke(angleDeg: number, pressure: number, phase: Phase) {
  const centre = RES_SIZE / 2;
  const radians = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const points: number[] = [];
  const pressures: number[] = [];
  const samples = 48;
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1) - 0.5;
    points.push(centre + phase.x + dx * t * RES_LEN, centre + phase.y + dy * t * RES_LEN);
    pressures.push(pressure);
  }
  return { points, pressures };
}

function textureStroke(phase: Phase) {
  const points: number[] = [];
  const pressures: number[] = [];
  const samples = 72;
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    points.push(18 + phase.x + t * (TEX_W - 36), TEX_H / 2 + phase.y);
    // 등압 — taper 를 빼야 열마다 독립적인 단면 표본이 된다.
    pressures.push(REFERENCE_PRESSURE);
  }
  return { points, pressures };
}

function normalised(values: number[]): number[] {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (!(mean > 0)) return values.map(() => 0);
  return values.map((v) => Number((v / mean).toFixed(6)));
}

export interface BrushProbeFeature {
  id: string;
  phase: number;
  sigmaPx: number;
  meanInk: number;
  coverage: number;
  columns: number;
  profile: number[];
  grain: number[];
  anisotropy: number;
  grainScaleRatio: number;
  /** 0/45/90/135도 유효폭 비 (평균 1.0). 치즐이면 흔들리고 둥글면 평평하다. */
  directionResponse: number[];
  /** 필압 0.2/0.45/0.7/0.95 유효폭 비 (평균 1.0). 필압→굵기 매핑의 모양. */
  sizeResponse: number[];
  /** 같은 필압에서의 잉크 비 (평균 1.0). 필압→농도 매핑의 모양. */
  inkResponse: number[];
  /** 정규화해서 버린 스칼라 — 무엇을 버렸는지는 남긴다. */
  scalars: { widthPx: number; inkAtReference: number };
}

function brushRows() {
  const laneById = new Map(STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of STUDIO_BRUSH_RUNTIME_CONTRACT) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const lane = laneById.get(row.id);
    out.push({
      id: row.id,
      name: lane?.name ?? row.id,
      family: row.family,
      engine: row.engine,
      engineVariant: row.engineVariant,
      canonicalId: row.canonicalId,
      distinctness: row.distinctness,
      tip: row.tip,
      texture: row.texture,
      dynamics: row.dynamics,
      preview: row.preview,
      operation: row.operation ?? "paint",
      lane: lane?.lane ?? null,
      baseId: lane?.baseId ?? null,
      defaultWidth: lane?.defaultWidth ?? null,
      defaultOpacity: lane?.defaultOpacity ?? null,
    });
  }
  return out;
}

await mkdir(OUT_DIR, { recursive: true });

const rows = brushRows().filter((row) => !FILTER || FILTER.test(String(row.id)));
const features: BrushProbeFeature[] = [];
const skipped: { id: string; reason: string }[] = [];
const started = Date.now();

for (const row of rows) {
  const id = String(row.id);
  try {
    for (const [phaseIndex, phase] of PHASES.entries()) {
      const tex = textureStroke(phase);
      const texture = measureTexture(
        renderField(await svgFor(id, { width: TEX_W, height: TEX_H }, tex.points, tex.pressures, phase), TEX_W * TEXTURE_SCALE),
      );
      if (!texture) {
        if (phaseIndex === 0) {
          skipped.push({ id, reason: "no measurable cross-section (empty or degenerate render)" });
        }
        break;
      }
      const lengthPx = RES_LEN * RESPONSE_SCALE;
      const canvas = { width: RES_SIZE, height: RES_SIZE };
      const byAngle: (ReturnType<typeof measureResponse>)[] = [];
      for (const angle of ANGLES_DEG) {
        const stroke = responseStroke(angle, REFERENCE_PRESSURE, phase);
        byAngle.push(measureResponse(
          renderField(await svgFor(id, canvas, stroke.points, stroke.pressures, phase), RES_SIZE * RESPONSE_SCALE),
          lengthPx,
        ));
      }
      const byPressure: (ReturnType<typeof measureResponse>)[] = [];
      for (const pressure of PRESSURES) {
        if (pressure === REFERENCE_PRESSURE) {
          byPressure.push(byAngle[0]);
          continue;
        }
        const stroke = responseStroke(0, pressure, phase);
        byPressure.push(measureResponse(
          renderField(await svgFor(id, canvas, stroke.points, stroke.pressures, phase), RES_SIZE * RESPONSE_SCALE),
          lengthPx,
        ));
      }
      if (byAngle.some((m) => !m) || byPressure.some((m) => !m)) {
        if (phaseIndex === 0) skipped.push({ id, reason: "response sweep produced an empty render" });
        break;
      }
      features.push({
        id,
        phase: phaseIndex,
        sigmaPx: texture.sigmaPx,
        meanInk: texture.meanInk,
        coverage: texture.coverage,
        columns: texture.columns,
        profile: texture.profile,
        grain: texture.grain,
        anisotropy: texture.anisotropy,
        grainScaleRatio: texture.grainScaleRatio,
        directionResponse: normalised(byAngle.map((m) => m?.effectiveWidthPx ?? 0)),
        sizeResponse: normalised(byPressure.map((m) => m?.effectiveWidthPx ?? 0)),
        inkResponse: normalised(byPressure.map((m) => m?.meanInk ?? 0)),
        scalars: {
          widthPx: Number((byAngle[0]?.effectiveWidthPx ?? 0).toFixed(4)),
          inkAtReference: Number((byAngle[0]?.meanInk ?? 0).toFixed(5)),
        },
      });
    }
  } catch (error) {
    skipped.push({ id, reason: error instanceof Error ? error.message : String(error) });
  }
}

const primary = features.filter((f) => f.phase === 0);
await writeFile(
  resolve(OUT_DIR, "brush-duplicate-probe.json"),
  `${JSON.stringify(
    {
      generatedAtUtc: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      scale: { texture: TEXTURE_SCALE, response: RESPONSE_SCALE },
      canvas: {
        texture: { width: TEX_W, height: TEX_H, strokeWidth: BASE_WIDTH, pressure: REFERENCE_PRESSURE },
        response: { size: RES_SIZE, strokeLength: RES_LEN, angles: [...ANGLES_DEG], pressures: [...PRESSURES] },
      },
      normalisation: {
        width:
          `cross-section resampled onto u=(y-c)/sigma over [-${PROFILE_SPAN},${PROFILE_SPAN}] in`
          + ` ${PROFILE_BINS} bins; every response vector divided by its own mean`,
        opacity:
          `profile rescaled to mean 1.0; grain histogram over ratio a/meanInk in ${GRAIN_BINS} bins;`
          + " ink response divided by its own mean",
      },
      phases: PHASES.map((p) => ({ offsetX: p.x, offsetY: p.y, seed: p.seed })),
      brushes: rows.length,
      measured: primary.length,
      skipped,
      catalog: rows,
      features: primary,
      scalarReplicate: features.filter((f) => f.phase === 1),
    },
    null,
    1,
  )}\n`,
);
console.log(
  `probed ${primary.length}/${rows.length} brushes in ${((Date.now() - started) / 1000).toFixed(1)}s`
  + (skipped.length > 0 ? `; skipped ${skipped.length}` : ""),
);
