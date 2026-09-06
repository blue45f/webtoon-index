/**
 * 브러시 중복 판정 — 프로브가 뽑은 정규화 특징에서 "정말 같은 브러시"만 골라낸다.
 *
 * 임계값은 눈대중이 아니라 브러시 자신에게서 온다. 프로브는 브러시마다 굵기·불투명도 노브를
 * 실제로 돌린 복제본(16/1.0 대 24/0.7)을 함께 재고, 그 자기거리가 "같은 브러시인데 수치만 다를
 * 때" 관측되는 거리다. 서로 다른 두 브러시가 다섯 축 전부 그 안쪽이면 — 노브를 돌린 것과
 * 구별되지 않는다. 그게 오너가 말한 "수치만 조금씩 차이나는 브러시"의 조작적 정의다.
 *
 * 잔차는 브러시마다 크게 다르다(펜 단면 0.000, 수채 0.073). 그래서 관문은 전역 상수가 아니라
 * 페어의 두 브러시가 각자 보인 잔차에서 만든다 — 수채 페어는 수채의 자기 잔차를, 펜 페어는
 * 펜의 자기 잔차를 넘어야 한다.
 *
 * 다섯 축을 모두 통과해야 중복이다 — 단면 모양, 그레인 분포, 방향 응답, 필압→굵기, 필압→농도.
 * 한 축만 통과하면 형제일 뿐이다. 1차 시안은 단면+그레인만 봤고, 그 결과 마커 치즐이 펜과 같은
 * 클러스터에 묶였다(등압 수평 획에서는 둘 다 같은 사각 단면이다). 축을 늘린 이유가 그것이다.
 *
 * 클러스터는 연결 성분이 아니라 클리크(clique)로 만든다. 연결 성분을 쓰면 A~B, B~C 만으로
 * A~C 가 아닌데도 한 덩어리가 되고, 실제로 1차 시안에서 71개짜리 클러스터가 나왔다. 클러스터에
 * 들어가려면 기존 멤버 전원과 직접 중복이어야 한다.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportPageToSvg } from "../../../apps/web/src/domains/creator/export/studio-svg-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULTS = resolve(ROOT, "tests/benchmarks/results");

interface Feature {
  id: string;
  sigmaPx: number;
  meanInk: number;
  coverage: number;
  profile: number[];
  grain: number[];
  anisotropy: number;
  grainScaleRatio: number;
  directionResponse: number[];
  sizeResponse: number[];
  inkResponse: number[];
  scalars: { widthPx: number; inkAtReference: number };
}

interface CatalogRow {
  id: string;
  name: string;
  family: string;
  engine: string;
  engineVariant: string;
  canonicalId: string;
  distinctness: string;
  tip: string;
  texture: string;
  dynamics: string;
  preview: string;
  operation: string;
  lane: string | null;
  baseId: string | null;
  defaultWidth: number | null;
  defaultOpacity: number | null;
}

const probe = JSON.parse(
  await readFile(resolve(RESULTS, "brush-duplicate-probe.json"), "utf8"),
) as {
  features: Feature[];
  scalarReplicate: Feature[];
  catalog: CatalogRow[];
  scale: Record<string, number>;
  canvas: Record<string, unknown>;
  normalisation: Record<string, string>;
};

const AXES = ["profile", "grain", "direction", "size", "ink"] as const;
type Axis = (typeof AXES)[number];

/** 두 벡터 모두 평균 1.0 으로 정규화돼 있어 평균절대차가 곧 상대 오차다. */
function meanAbs(a: number[], b: number[]): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / a.length;
}

/**
 * 그레인 분포 거리는 총변동이 아니라 EMD(1-Wasserstein)로 잰다.
 *
 * 매끈한 브러시는 잉크 픽셀이 전부 같은 농도라 r=a/mean 히스토그램이 사실상 델타다. 델타 두 개가
 * 이웃 빈에 떨어지기만 해도 총변동은 1.0 으로 포화한다 — 실제로 highlighter 대 pastel-highlighter
 * 가 단면 거리 0.0003 인데 그레인 총변동 0.65 로 나왔다. 질감 차이가 아니라 빈 경계 문제였다.
 * EMD 는 그 경우 "빈 하나만큼" 이라 답한다. 단위는 밀도비(r) 축의 평균 이동량이다.
 */
const GRAIN_BIN_WIDTH = 2.4 / 24;
function earthMover(a: number[], b: number[]): number {
  let cumulative = 0;
  let work = 0;
  for (let index = 0; index < a.length; index += 1) {
    cumulative += a[index] - b[index];
    work += Math.abs(cumulative);
  }
  return work * GRAIN_BIN_WIDTH;
}

function distances(a: Feature, b: Feature): Record<Axis, number> {
  return {
    profile: meanAbs(a.profile, b.profile),
    grain: earthMover(a.grain, b.grain),
    direction: meanAbs(a.directionResponse, b.directionResponse),
    size: meanAbs(a.sizeResponse, b.sizeResponse),
    ink: meanAbs(a.inkResponse, b.inkResponse),
  };
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const low = Math.floor(pos);
  const high = Math.min(low + 1, sorted.length - 1);
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

const catalogById = new Map(probe.catalog.map((row) => [row.id, row]));
/**
 * 지우개는 뺀다. SVG 내보내기에서 erase 프리셋은 아래에 지울 것이 없으면 자기 캐리어를 그대로
 * 그리므로 흰 배경 프로브에서 pen 과 비트 단위로 같은 그림이 나온다 — 셸프 중복이 아니라
 * 측정 조건의 산물이다.
 */
const paintable = (id: string) => (catalogById.get(id)?.operation ?? "paint") === "paint";
const featureById = new Map(probe.features.filter((f) => paintable(f.id)).map((f) => [f.id, f]));
const replicateById = new Map(
  probe.scalarReplicate.filter((f) => paintable(f.id)).map((f) => [f.id, f]),
);
const excludedIds = probe.features.filter((f) => !paintable(f.id)).map((f) => f.id);
const ids = [...featureById.keys()].sort();

// ── 잡음 바닥: 같은 브러시, 노브만 다름 ─────────────────────────────────────────────────────
const selfDistance = new Map<string, Record<Axis, number>>();
const selfPool: Record<Axis, number[]> = { profile: [], grain: [], direction: [], size: [], ink: [] };
for (const id of ids) {
  const first = featureById.get(id);
  const second = replicateById.get(id);
  if (!first || !second) continue;
  const d = distances(first, second);
  selfDistance.set(id, d);
  for (const axis of AXES) selfPool[axis].push(d[axis]);
}
for (const axis of AXES) selfPool[axis].sort((a, b) => a - b);

const noiseFloor = Object.fromEntries(
  AXES.map((axis) => [
    axis,
    {
      p10: Number(quantile(selfPool[axis], 0.1).toFixed(6)),
      p50: Number(quantile(selfPool[axis], 0.5).toFixed(6)),
      p90: Number(quantile(selfPool[axis], 0.9).toFixed(6)),
      p95: Number(quantile(selfPool[axis], 0.95).toFixed(6)),
      max: Number((selfPool[axis].at(-1) ?? 0).toFixed(6)),
    },
  ]),
) as Record<Axis, { p10: number; p50: number; p90: number; p95: number; max: number }>;

/**
 * 페어별 관문 = 두 브러시가 각자 보인 스칼라 잔차의 큰 쪽. 바닥은 전체 p10 — 노브에 완전히
 * 불변인 브러시(필압 곡선이 항등인 연필류)라도 0 을 요구하지는 않는다. 천장은 전체 p95 —
 * 수채처럼 잔차가 큰 브러시 하나가 셸프 절반을 삼키지 못하게 눌러 둔다.
 */
const TOLERANCE = Number(process.env.BRUSH_AUDIT_TOLERANCE ?? 1);
function gateFor(axis: Axis, a: string, b: string): number {
  const selfA = selfDistance.get(a)?.[axis] ?? 0;
  const selfB = selfDistance.get(b)?.[axis] ?? 0;
  const residual = TOLERANCE * Math.max(selfA, selfB);
  return Math.min(Math.max(residual, noiseFloor[axis].p10), noiseFloor[axis].p95);
}

// ── 전수 페어 ────────────────────────────────────────────────────────────────────────────────
interface Pair {
  a: string;
  b: string;
  distance: Record<Axis, number>;
  gate: Record<Axis, number>;
  /** 가장 빡빡한 축의 여유율. <=1 이면 전 축 통과. */
  worstRatio: number;
  worstAxis: Axis;
  /** 정규화해서 없앤 스칼라가 실제로 얼마나 달랐는지 — "수치만 다르다"의 증거. */
  widthRatio: number;
  opacityRatio: number;
}

const duplicatePairs: Pair[] = [];
const nearMiss: Pair[] = [];
const pooled: Record<Axis, number[]> = { profile: [], grain: [], direction: [], size: [], ink: [] };
let compared = 0;
const dupKey = new Set<string>();

for (let i = 0; i < ids.length; i += 1) {
  for (let j = i + 1; j < ids.length; j += 1) {
    const a = featureById.get(ids[i]);
    const b = featureById.get(ids[j]);
    if (!a || !b) continue;
    compared += 1;
    const d = distances(a, b);
    for (const axis of AXES) pooled[axis].push(d[axis]);
    let worstRatio = 0;
    let worstAxis: Axis = "profile";
    const gate = {} as Record<Axis, number>;
    for (const axis of AXES) {
      gate[axis] = gateFor(axis, ids[i], ids[j]);
      const ratio = gate[axis] > 0 ? d[axis] / gate[axis] : d[axis] > 0 ? Infinity : 0;
      if (ratio > worstRatio) {
        worstRatio = ratio;
        worstAxis = axis;
      }
    }
    if (worstRatio > 3) continue;
    const pair: Pair = {
      a: ids[i],
      b: ids[j],
      distance: Object.fromEntries(
        AXES.map((axis) => [axis, Number(d[axis].toFixed(6))]),
      ) as Record<Axis, number>,
      gate: Object.fromEntries(
        AXES.map((axis) => [axis, Number(gate[axis].toFixed(6))]),
      ) as Record<Axis, number>,
      worstRatio: Number(worstRatio.toFixed(3)),
      worstAxis,
      widthRatio: Number((a.scalars.widthPx / b.scalars.widthPx).toFixed(4)),
      opacityRatio: Number((a.scalars.inkAtReference / b.scalars.inkAtReference).toFixed(4)),
    };
    if (worstRatio <= 1) {
      duplicatePairs.push(pair);
      dupKey.add(`${ids[i]} ${ids[j]}`);
    } else if (worstRatio <= 2) nearMiss.push(pair);
  }
}
for (const axis of AXES) pooled[axis].sort((a, b) => a - b);
duplicatePairs.sort((a, b) => a.worstRatio - b.worstRatio);
nearMiss.sort((a, b) => a.worstRatio - b.worstRatio);

// ── 클리크 클러스터 ─────────────────────────────────────────────────────────────────────────
const isDuplicate = (a: string, b: string) =>
  dupKey.has(a < b ? `${a} ${b}` : `${b} ${a}`);
const assigned = new Set<string>();
const cliques: string[][] = [];
for (const seed of duplicatePairs) {
  if (assigned.has(seed.a) || assigned.has(seed.b)) continue;
  const members = [seed.a, seed.b];
  for (const candidate of ids) {
    if (members.includes(candidate) || assigned.has(candidate)) continue;
    if (members.every((member) => isDuplicate(member, candidate))) members.push(candidate);
  }
  for (const member of members) assigned.add(member);
  cliques.push(members);
}

// ── 비용 측정: 같은 획을 내보냈을 때의 마크 수 / 바이트 / 직렬화 시간 ────────────────────────
/**
 * 저장소에 브러시별 ms 표는 없다(벤치 결과는 씬·프로파일 단위다). 그래서 여기서 직접 잰다 —
 * 같은 획을 SVG 로 내보냈을 때의 마크 수와 바이트가 문서 무게이자 재생 비용의 대리 지표이고,
 * 캔버스 드로우콜 수와 같은 축으로 움직인다.
 */
function costFor(brush: string) {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < 48; index += 1) {
    const t = index / 47;
    points.push(20 + t * 260, 60 + Math.sin(t * Math.PI * 2) * 18);
    pressures.push(0.35 + 0.55 * Math.sin(Math.PI * t));
  }
  const started = process.hrtime.bigint();
  const { svg } = exportPageToSvg({
    width: 300,
    height: 120,
    bg: "#ffffff",
    elements: [
      {
        id: `${brush}-cost`,
        type: "draw" as const,
        kind: "freehand" as const,
        brush,
        points,
        pressures,
        stroke: "#1b1b1f",
        strokeWidth: 16,
        opacity: 1,
        seed: 4_242,
      },
    ] as never,
  });
  const elapsedUs = Number(process.hrtime.bigint() - started) / 1000;
  const marks = (svg.match(/<(path|circle|ellipse|rect|line|polygon|polyline|use|image|g)\b/g) ?? [])
    .length;
  return { marks, bytes: svg.length, serialiseUs: Number(elapsedUs.toFixed(1)) };
}

const cost = new Map<string, ReturnType<typeof costFor>>();
for (const id of ids) {
  try {
    cost.set(id, costFor(id));
  } catch {
    cost.set(id, { marks: -1, bytes: -1, serialiseUs: -1 });
  }
}

// ── 텍스처 커버리지: 같은 질감을 이미 몇 개가 덮고 있나 ────────────────────────────────────
const bySignature = new Map<string, string[]>();
for (const id of ids) {
  const row = catalogById.get(id);
  const key = `${row?.engine}/${row?.engineVariant}`;
  if (!bySignature.has(key)) bySignature.set(key, []);
  bySignature.get(key)?.push(id);
}
const byTexture = new Map<string, string[]>();
for (const id of ids) {
  const row = catalogById.get(id);
  const key = `${row?.family}/${row?.texture}`;
  if (!byTexture.has(key)) byTexture.set(key, []);
  byTexture.get(key)?.push(id);
}

function describe(id: string) {
  const row = catalogById.get(id);
  const feature = featureById.get(id);
  return {
    id,
    name: row?.name,
    family: row?.family,
    engine: row?.engine,
    engineVariant: row?.engineVariant,
    canonicalId: row?.canonicalId,
    distinctness: row?.distinctness,
    texture: row?.texture,
    dynamics: row?.dynamics,
    tip: row?.tip,
    lane: row?.lane,
    baseId: row?.baseId,
    defaultWidth: row?.defaultWidth,
    defaultOpacity: row?.defaultOpacity,
    measured: {
      effectiveWidthPx: feature?.scalars.widthPx,
      inkAtReference: feature?.scalars.inkAtReference,
      anisotropy: feature?.anisotropy,
      grainScaleRatio: feature?.grainScaleRatio,
      directionResponse: feature?.directionResponse,
      sizeResponse: feature?.sizeResponse,
      inkResponse: feature?.inkResponse,
    },
    cost: cost.get(id),
    sharesEngineSignatureWith: (bySignature.get(`${row?.engine}/${row?.engineVariant}`) ?? [])
      .filter((other) => other !== id),
    sharesTextureClassWith: (byTexture.get(`${row?.family}/${row?.texture}`) ?? []).length - 1,
  };
}

const report = {
  generatedAtUtc: new Date().toISOString(),
  method: {
    render: probe.canvas,
    scale: probe.scale,
    normalisation: probe.normalisation,
    axes: {
      profile: "width- and opacity-normalised cross-section shape (48 bins, mean absolute difference)",
      grain:
      "opacity-normalised ink density histogram (25 bins over r = a/meanInk), compared by"
      + " earth-mover distance in r units — total variation saturates on smooth brushes whose"
      + " histogram is a near-delta",
      direction: "effective width at 0/45/90/135 deg, divided by its own mean (chisel vs round)",
      size: "effective width at pressure 0.2/0.45/0.7/0.95, divided by its own mean",
      ink: "mean ink at those pressures, divided by its own mean",
    },
    gate:
      `per pair, per axis: clamp(${TOLERANCE} x max(scalarResidual(a), scalarResidual(b)),`
      + " pooledResidual.p10, pooledResidual.p95). A pair is a duplicate only when ALL five axes"
      + " are inside their gate — the conjunction, not any single axis, carries the precision.",
    clustering:
      "cliques, not connected components: a brush joins a cluster only if it is a duplicate of"
      + " every member already in it",
    noiseFloor: {
      source:
        "same brush re-rendered with the two knobs the owner named actually turned:"
        + " strokeWidth 16 -> 24 and opacity 1.0 -> 0.7 (plus a sub-pixel path offset)."
        + " Whatever distance survives normalisation here is what 'only the numbers differ'"
        + " measures like, per brush.",
      samples: selfPool.profile.length,
      ...noiseFloor,
    },
  },
  population: {
    brushes: ids.length,
    excludedFromJudgement: excludedIds,
    pairsCompared: compared,
    distanceQuantiles: Object.fromEntries(
      AXES.map((axis) => [
        axis,
        {
          p01: Number(quantile(pooled[axis], 0.01).toFixed(6)),
          p05: Number(quantile(pooled[axis], 0.05).toFixed(6)),
          p50: Number(quantile(pooled[axis], 0.5).toFixed(6)),
          p95: Number(quantile(pooled[axis], 0.95).toFixed(6)),
        },
      ]),
    ),
  },
  clusters: cliques.map((members) => ({
    members,
    pairs: duplicatePairs.filter((p) => members.includes(p.a) && members.includes(p.b)),
    rows: members.map(describe),
  })),
  duplicatePairs,
  nearMissPairs: nearMiss.slice(0, 60),
};

await writeFile(
  resolve(RESULTS, "brush-duplicate-matrix.json"),
  `${JSON.stringify(report, null, 1)}\n`,
);

console.log(`${ids.length} brushes, ${compared} pairs (2 excluded erasers)`);
console.log("scalar residual (same brush, width 16->24 & opacity 1.0->0.7):");
for (const axis of AXES) {
  console.log(
    `  ${axis.padEnd(10)} p10 ${noiseFloor[axis].p10.toFixed(5)}`
    + ` p50 ${noiseFloor[axis].p50.toFixed(5)}`
    + ` p95 ${noiseFloor[axis].p95.toFixed(5)}`
    + `  | population p05 ${quantile(pooled[axis], 0.05).toFixed(5)}`
    + ` p50 ${quantile(pooled[axis], 0.5).toFixed(5)}`,
  );
}
console.log(`duplicate pairs ${duplicatePairs.length}, near-miss ${nearMiss.length}`);
console.log(`clusters ${cliques.length}:`);
for (const members of cliques) console.log(`  [${members.join(", ")}]`);
