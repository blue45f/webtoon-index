/**
 * 최종 중복 리포트 조립 — 세 단계의 측정을 하나의 감사 문서로 접는다.
 *
 *   probe   : 굵기·불투명도를 나눠서 없앤 다섯 축의 정규화 특징 (전 브러시)
 *   audit   : 브러시 자신의 스칼라 잔차를 눈금으로 쓴 페어 관문 + 전수 거리 행렬
 *   confirm : 살아남은 후보를 굵기·위상 탐색과 함께 다시 굽고 픽셀로 직접 대조
 *
 * 여기서는 판정하지 않고 근거를 붙인다 — 엔진 배선이 있는가(엔진 프로그램 vs 맨 별칭),
 * 실측 비용은 얼마인가, 그 질감을 이미 몇 개가 덮고 있는가. 남길 하나는 그 셋으로 고른다.
 *
 * 출력: results/brush-duplicate-audit.json
 */
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { exportPageToSvg } from "../../../apps/web/src/domains/creator/export/studio-svg-export";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const RESULTS = resolve(ROOT, "tests/benchmarks/results");

/** 픽셀 관문. 확인 단계 분포에 0.0128 과 0.0902 사이 7배 공백이 있어 그 안에 세웠다. */
const PIXEL_GATE = 0.02;

interface Pair {
  a: string;
  b: string;
  distance: Record<string, number>;
  gate: Record<string, number>;
  worstRatio: number;
  worstAxis: string;
  widthRatio: number;
  opacityRatio: number;
  pixel: { p95: number; nrmse: number; bestStrokeWidth: number; bestShiftPx: number } | null;
}

const matrix = JSON.parse(await readFile(resolve(RESULTS, "brush-duplicate-matrix.json"), "utf8"));
const confirm = JSON.parse(
  await readFile(resolve(RESULTS, "brush-duplicate-confirm.json"), "utf8"),
) as { pairs: Pair[]; method: string; search: Record<string, unknown> };
const probe = JSON.parse(await readFile(resolve(RESULTS, "brush-duplicate-probe.json"), "utf8"));

const catalogById = new Map<string, Record<string, unknown>>(
  probe.catalog.map((row: Record<string, unknown>) => [row.id as string, row]),
);
const featureById = new Map<string, Record<string, unknown>>(
  probe.features.map((row: Record<string, unknown>) => [row.id as string, row]),
);

// ── 근거 1: 브러시 id 로 직접 배선된 곳이 있는가 ────────────────────────────────────────────
/**
 * "진짜 엔진 프로그램이 있는가, 아니면 맨 별칭인가" 는 문자열 id 로 분기하는 파일이 있는지로
 * 답할 수 있다. 카탈로그 선언 자체(레인 카탈로그 행)와 순수 장식 모듈(아이콘·툴팁·커서)은
 * 배선이 아니므로 세지 않는다 — 아이콘은 170개 전부가 갖고 있어 변별력이 0 이다.
 */
const COSMETIC = /studio-brush-icons\.ts|studio-creative-ux\.ts|studio-canvas-cursor\.ts|studio-brush-visual\.ts/;
const DECLARATION = /studio-brush-runtime-contract\.ts|studio-brush\.ts$/;
const GOVERNANCE = /studio-brush-variant-group-manifest\.ts|studio-brush-quarantine\.ts|studio-search-corpus\.ts/;
const LANE_CATALOG = "studio-brush-engine-lane-catalog.ts";

/**
 * 레인 카탈로그 파일은 통째로 뺄 수 없다 — 카탈로그 행 선언과 엔진 프로그램 핀 표
 * (ENGINE_LANE_WATERCOLOR_MATERIAL, ENGINE_LANE_STAMP_TUNING, ENGINE_LANE_CROQUIS_CAPSULE_PROGRAM,
 * ENGINE_LANE_COLOR_PIGMENT_TUNING)가 같은 파일에 산다. 행 선언은 배선이 아니지만 핀은 배선이다.
 * 그래서 파일 단위가 아니라 등장 횟수로 세고, 이 파일에서는 행 선언 한 번을 뺀다.
 */
function wiringFor(id: string) {
  let lines: string[];
  try {
    lines = execFileSync(
      "grep",
      ["-rnE", `["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "apps/web/src/domains/creator"],
      { cwd: ROOT, encoding: "utf8" },
    ).split("\n").filter(Boolean);
  } catch {
    lines = [];
  }
  const hits = new Map<string, number>();
  for (const line of lines) {
    const file = line.slice(0, line.indexOf(":")).replace("apps/web/src/domains/creator/", "");
    if (/\.test\.tsx?$/.test(file) || COSMETIC.test(file) || DECLARATION.test(file)
      || GOVERNANCE.test(file)) continue;
    hits.set(file, (hits.get(file) ?? 0) + 1);
  }
  // 레인 카탈로그의 첫 등장은 카탈로그 행 그 자체 — 배선이 아니다.
  if (hits.has(LANE_CATALOG)) {
    const remaining = (hits.get(LANE_CATALOG) ?? 0) - 1;
    if (remaining > 0) hits.set(LANE_CATALOG, remaining);
    else hits.delete(LANE_CATALOG);
  }
  const files = [...hits.keys()].sort();
  const sites = [...hits.values()].reduce((a, b) => a + b, 0);
  return {
    renderWiringFiles: files.length,
    renderWiringSites: sites,
    /** 자기 카탈로그 행 말고는 아무 데서도 id 로 분기되지 않는다 = 맨 별칭. */
    declaredOnlyInCatalogue: files.length === 0,
    files,
  };
}

// ── 근거 2: 실측 비용 ───────────────────────────────────────────────────────────────────────
/**
 * 저장소에 브러시별 ms 표는 없다 — 벤치 결과는 씬·프로파일 단위이고, 브러시 축을 가진 건
 * brush-texture-lab-wired.json 의 4개(dabCount)와 brush-defect-lab 의 26개뿐이다. 그래서 여기서
 * 직접 잰다: 같은 획을 내보냈을 때의 마크 수·바이트가 문서 무게이자 재생 드로우콜의 대리 지표다.
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
  const serialiseUs = Number(process.hrtime.bigint() - started) / 1000;
  const marks = (svg.match(/<(path|circle|ellipse|rect|line|polygon|polyline|use|image)\b/g) ?? [])
    .length;
  return { marks, bytes: svg.length, serialiseUs: Number(serialiseUs.toFixed(1)) };
}

// ── 근거 3: 같은 질감을 이미 몇 개가 덮고 있나 ──────────────────────────────────────────────
const allIds = [...catalogById.keys()];
function coverage(id: string) {
  const row = catalogById.get(id);
  const signature = allIds.filter(
    (other) => other !== id
      && catalogById.get(other)?.engine === row?.engine
      && catalogById.get(other)?.engineVariant === row?.engineVariant,
  );
  const textureClass = allIds.filter(
    (other) => other !== id
      && catalogById.get(other)?.family === row?.family
      && catalogById.get(other)?.texture === row?.texture,
  );
  return { sameEngineSignature: signature, sameEngineSignatureCount: signature.length, sameTextureClassCount: textureClass.length };
}


/**
 * 남길 하나를 고르는 규칙 — 순서대로 적용한다.
 *   (a) 엔진 배선: id 로 실제로 분기하는 코드가 있는가. 카탈로그 행 말고 아무 데도 없으면 맨
 *       별칭이고, 선언한 엔진 변형은 페인트 시점에 존재하지 않는다(이미 격리된 glitter--star-field
 *       와 같은 실패 유형이다).
 *   (b) 실측 비용: 같은 그림에 더 적은 마크·바이트를 쓰는 쪽.
 *   (c) 커버리지: 같은 실행 시그니처를 이미 몇 개가 덮고 있는가 — 다른 브러시들이 canonical 로
 *       가리키는 id 를 남긴다.
 */
const RECOMMENDATION: Record<string, {
  keep: string[];
  drop: string[];
  confidence: "high" | "medium";
  reason: string;
}> = {
  "pencil|pencil--side-shade|pencil-2b": {
    keep: ["pencil"],
    drop: ["pencil--side-shade", "pencil-2b"],
    confidence: "high",
    reason:
      "pencil--side-shade has zero render wiring — its id appears nowhere outside its own"
      + " catalogue row, so the engine-variant it declares does not exist at paint time; pencil-2b"
      + " is wired only into tag/route/alias tables and its alias entry is diameterScale 1.1 on an"
      + " identity pressure curve. Both render bit-identically to pencil (p95 <= 0.00014).",
  },
  "mypaint-cc0--marker-fat|mypaint-cc0--marker-small": {
    keep: ["mypaint-cc0--marker-small"],
    drop: ["mypaint-cc0--marker-fat"],
    confidence: "high",
    reason:
      "identical wiring (2 sites each, both profile-variant -> ink-brush) and an effective-width"
      + " ratio of 1.006 at the same toolbar width — the catalogue defaults 24 vs 10 are the whole"
      + " difference. marker-small draws the same picture in 27,699 bytes against 46,749.",
  },
  "brush|flat-brush|marker--chisel-ribbon": {
    keep: ["brush"],
    drop: ["marker--chisel-ribbon", "flat-brush"],
    confidence: "medium",
    reason:
      "all three emit a structurally identical SVG skeleton (same tags, only numbers differ) and"
      + " overlay bit-identically. marker--chisel-ribbon has zero render wiring while advertising"
      + " an angled-ribbon chisel nib — the chisel is not in the code. flat-brush is wired but"
      + " differs only by diameterScale 1.3; medium confidence because its alias pressure curve"
      + " may still separate it on the Canvas path this SVG-export audit does not exercise.",
  },
  "gouache--flat-stamp|ink-brush|gpen--causal-round|gpen--croquis-capsule": {
    keep: ["ink-brush", "gpen--croquis-capsule"],
    drop: ["gpen--causal-round", "gouache--flat-stamp"],
    confidence: "medium",
    reason:
      "two engines converging on the same solid line. gpen--causal-round has zero render wiring"
      + " and is a declared profile-variant of pen. gouache--flat-stamp carries the gouache product"
      + " name but paints the ink-brush stamp it declares as its canonical, at 37,559 bytes against"
      + " ink-brush's 27,896. gpen--croquis-capsule is kept because its lane pins a real"
      + " croquis-capsule-v1 program; ink-brush is the unique canonical eight lanes point at.",
  },
  "highlighter|pastel-highlighter": {
    keep: ["highlighter"],
    drop: ["pastel-highlighter"],
    confidence: "high",
    reason:
      "pastel-highlighter is declared an engine-variant of highlighter but overlays at p95 0.00021"
      + " and shares the same studio-highlighter-wash-ribbon path; its alias entry is"
      + " diameterScale 1.1. highlighter carries more wiring (12 files vs 8) and is the canonical.",
  },
  "calligraphy--perfect-chisel|felt-tip|perfect-marker": {
    keep: ["perfect-marker", "felt-tip"],
    drop: ["calligraphy--perfect-chisel"],
    confidence: "high",
    reason:
      "calligraphy--perfect-chisel is a declared profile-variant of perfect-marker with one wiring"
      + " site and overlays at p95 0.00002. felt-tip is kept as a different engine (causal-ink, its"
      + " own marker-nib profile) that merely coincides on this stroke — but note it spends 48"
      + " marks / 5,432 bytes where perfect-marker spends 2 / 2,573 for the same line, which is a"
      + " cost defect worth its own ticket rather than a catalogue trim.",
  },
  "pen--perfect-taper|perfect-ink": {
    keep: ["perfect-ink"],
    drop: ["pen--perfect-taper"],
    confidence: "high",
    reason:
      "pen--perfect-taper is a declared profile-variant of perfect-ink with a single wiring site"
      + " (its perfect-freehand profile), overlays at p95 0.00021, and costs marginally more"
      + " (1,504 vs 1,487 bytes) for the same picture.",
  },
  "mypaint-cc0--kabura|pen": {
    keep: ["pen"],
    drop: ["mypaint-cc0--kabura"],
    confidence: "high",
    reason:
      "the sharpest cost finding in the audit: mypaint-cc0--kabura spends 86,347 bytes where pen"
      + " spends 5,428 — 15.9x the export weight — for a line that overlays at p95 0.0118. It has"
      + " two wiring sites, both tag/route tables, and declares ink-brush as its canonical.",
  },
  "marker-bold|technical-pen": {
    keep: ["marker-bold", "technical-pen"],
    drop: [],
    confidence: "medium",
    reason:
      "the purest 'only the numbers differ' pair: same engine, identical SVG skeleton, overlay p95"
      + " 0.00045, alias diameterScale 1.5 vs 0.55 on near-identical pressure curves"
      + " ({0.92,1,0.55} vs {0.9,1,0.5}). Both keep real wiring (marker nib profile; thin-line ink"
      + " input admit list), so the fix is to present them as width presets of one shelf entry"
      + " rather than to delete either.",
  },
  "fineliner|gel-pen": {
    keep: ["fineliner"],
    drop: ["gel-pen"],
    confidence: "medium",
    reason:
      "both are profile-variants of pen with five wiring sites each and both sit in the same"
      + " thin-line-ink admit list; they overlay at p95 0.00059 and differ by diameterScale 0.48"
      + " vs 0.74 on nearly the same pressure curve. Keep fineliner as the standard name; gel-pen"
      + " adds a width, not a texture.",
  },
};

// ── 클리크 ───────────────────────────────────────────────────────────────────────────────────
const confirmed = confirm.pairs.filter((pair) => pair.pixel && pair.pixel.p95 <= PIXEL_GATE);
const edge = new Set(confirmed.map((pair) => `${pair.a}|${pair.b}`));
const linked = (a: string, b: string) => edge.has(`${a}|${b}`) || edge.has(`${b}|${a}`);
const nodes = [...new Set(confirmed.flatMap((pair) => [pair.a, pair.b]))];

const ordered = [...confirmed].sort((x, y) => x.worstRatio - y.worstRatio);
const claimed = new Set<string>();
const cliques: string[][] = [];
for (const seed of ordered) {
  if (claimed.has(seed.a) || claimed.has(seed.b)) continue;
  const members = [seed.a, seed.b];
  for (const candidate of nodes) {
    if (members.includes(candidate) || claimed.has(candidate)) continue;
    if (members.every((member) => linked(member, candidate))) members.push(candidate);
  }
  for (const member of members) claimed.add(member);
  cliques.push(members);
}

const evidence = new Map<string, Record<string, unknown>>();
for (const id of nodes) {
  const row = catalogById.get(id) ?? {};
  const feature = featureById.get(id) ?? {};
  evidence.set(id, {
    id,
    name: row.name,
    family: row.family,
    engine: row.engine,
    engineVariant: row.engineVariant,
    declaredCanonicalId: row.canonicalId,
    declaredDistinctness: row.distinctness,
    texture: row.texture,
    dynamics: row.dynamics,
    defaultWidth: row.defaultWidth,
    defaultOpacity: row.defaultOpacity,
    wiring: wiringFor(id),
    cost: costFor(id),
    coverage: coverage(id),
    measured: {
      effectiveWidthPx: (feature.scalars as { widthPx?: number } | undefined)?.widthPx,
      inkAtReference: (feature.scalars as { inkAtReference?: number } | undefined)?.inkAtReference,
      directionResponse: feature.directionResponse,
      sizeResponse: feature.sizeResponse,
      inkResponse: feature.inkResponse,
    },
  });
}

const clusters = cliques.map((members, index) => {
  const pairs = confirmed
    .filter((pair) => members.includes(pair.a) && members.includes(pair.b))
    .map((pair) => ({
      pair: [pair.a, pair.b],
      pixelP95: pair.pixel?.p95,
      pixelNrmse: pair.pixel?.nrmse,
      responseWorstRatio: pair.worstRatio,
      responseWorstAxis: pair.worstAxis,
      normalisedDistance: pair.distance,
      perPairGate: pair.gate,
      /** 정규화로 없앤 스칼라가 실제로 얼마나 달랐는지 — "수치만 다르다"의 증거. */
      measuredWidthRatio: pair.widthRatio,
      measuredOpacityRatio: pair.opacityRatio,
    }));
  const tier = pairs.every((pair) => (pair.responseWorstRatio ?? 9) <= 1) ? "A" : "B";
  const recommendation = RECOMMENDATION[[...members].sort().join("|")]
    ?? RECOMMENDATION[members.join("|")];
  return {
    cluster: index + 1,
    tier,
    members,
    recommendation: recommendation ?? {
      keep: [],
      drop: [],
      confidence: "medium",
      reason: "no recommendation recorded",
    },
    pairs,
    rows: members.map((id) => evidence.get(id)),
  };
});

const rejected = confirm.pairs
  .filter((pair) => pair.worstRatio <= 1 && (!pair.pixel || pair.pixel.p95 > PIXEL_GATE))
  .map((pair) => ({
    pair: [pair.a, pair.b],
    normalisedDistance: pair.distance,
    responseWorstRatio: pair.worstRatio,
    pixelP95: pair.pixel?.p95,
    note: "passed every normalised response gate but the pixels disagree — not a duplicate",
  }));

await writeFile(
  resolve(RESULTS, "brush-duplicate-audit.json"),
  `${JSON.stringify(
    {
      generatedAtUtc: new Date().toISOString(),
      question:
        "which brushes differ only by the WIDTH and OPACITY scalars, i.e. render the same texture"
        + " once those two knobs are normalised away",
      pipeline: {
        "1_probe": {
          harness: "tests/benchmarks/harness/brush-duplicate-probe.ts",
          output: "tests/benchmarks/results/brush-duplicate-probe.json",
          what: matrix.method.axes,
          normalisation: probe.normalisation,
        },
        "2_matrix": {
          harness: "tests/benchmarks/harness/brush-duplicate-audit.ts",
          output: "tests/benchmarks/results/brush-duplicate-matrix.json",
          gate: matrix.method.gate,
          calibration: matrix.method.noiseFloor,
        },
        "3_pixelConfirm": {
          harness: "tests/benchmarks/harness/brush-duplicate-confirm.ts",
          output: "tests/benchmarks/results/brush-duplicate-confirm.json",
          method: confirm.method,
          search: confirm.search,
          gate: {
            metric: "p95 of per-pixel |difference| after mean-ink normalisation",
            threshold: PIXEL_GATE,
            rationale:
              "the confirmed-candidate distribution has a 7x empty gap between 0.0128 and 0.0902;"
              + " the threshold sits inside that gap",
          },
        },
      },
      tiers: {
        A: "same picture on pixels AND all five normalised response axes inside the pair's own"
          + " scalar residual — safe to collapse",
        B: "same picture on pixels, but one response axis sits 1.0-1.4x outside the gate — the"
          + " brushes do differ somewhere (angle or pressure), just not enough to read as a"
          + " different texture; collapse only if the shelf wants fewer knobs",
      },
      limitations: [
        "Measured on the SVG export path (studio-svg-export), which the repo's own catalogue"
        + " contract test already uses as the durable-parity surface. A difference that lives only"
        + " in the live Canvas/WebGPU path would not appear here — that is why alias-table pressure"
        + " curves are called out per cluster rather than assumed inert.",
        "The texture probe draws one horizontal constant-pressure stroke; angle and pressure"
        + " behaviour are covered by the separate direction/size/ink response axes, not by the"
        + " pixel overlay.",
        "The two erase presets (standard-eraser, kneaded-eraser) are excluded: with nothing"
        + " underneath, the export draws their carrier and they measure bit-identical to pen.",
      ],
      population: matrix.population,
      clusterCount: clusters.length,
      clusters,
      rejectedByPixelConfirm: rejected,
    },
    null,
    1,
  )}\n`,
);

console.log(`clusters ${clusters.length} (pixel gate p95 <= ${PIXEL_GATE})`);
for (const cluster of clusters) {
  console.log(
    `\n[tier ${cluster.tier}] ${cluster.members.join(", ")}`
    + `\n   -> keep ${cluster.recommendation.keep.join(", ") || "(none)"}`
    + `; drop ${cluster.recommendation.drop.join(", ") || "(none)"}`
    + ` [${cluster.recommendation.confidence}]`,
  );
  for (const row of cluster.rows) {
    const r = row as Record<string, never>;
    const wiring = r.wiring as unknown as { renderWiringFiles: number };
    const cost = r.cost as unknown as { marks: number; bytes: number };
    const cover = r.coverage as unknown as { sameEngineSignatureCount: number };
    console.log(
      `   ${String(r.id).padEnd(28)} wiring ${String(wiring.renderWiringFiles).padStart(3)}`
      + `  marks ${String(cost.marks).padStart(5)}  bytes ${String(cost.bytes).padStart(7)}`
      + `  engineSiblings ${cover.sameEngineSignatureCount}`
      + `  ${String(r.declaredDistinctness)} -> ${String(r.declaredCanonicalId)}`,
    );
  }
}
console.log(`\nrejected by pixel confirm: ${rejected.length}`);
for (const item of rejected) console.log(`   ${item.pair.join(" ~ ")}  pixelP95 ${item.pixelP95}`);
