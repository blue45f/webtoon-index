/**
 * 획 내부 톤 계측 — "질감이 있다"를 눈이 아니라 숫자로 확인한다.
 *
 * 대조 시트는 결함을 보여주지만 정도를 말해주지 않는다. 이 프로브는 같은 획을 같은 직렬화로
 * 굽고, 실루엣 안쪽(안티에일리어싱 가장자리를 침식으로 제외한 진짜 내부)에서 서로 다른 톤의
 * 개수와 표준편차를 센다. 평평한 칠은 distinct=1, sd=0 으로 정직하게 드러난다.
 *
 * 대조 시트와 똑같이 브러시 자신의 dynamics 스냅샷과 drawMode 를 고정한다. 고정하지 않으면
 * studio-svg-export 가 핀을 벗겨내고 다른 캐리어가 그림을 가져가, 엉뚱한 엔진을 재게 된다.
 * 그래서 실제로 어떤 캐리어를 쟀는지도 함께 보고한다.
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

const CELL_W = 700;
const CELL_H = 140;
const SCALE = 3;
const STROKE_COLOR = "#1b1b1f";
/** 가장자리 안티에일리어싱을 톤 분포에서 빼기 위한 침식 반경(렌더 픽셀). */
const EROSION = 3;

const REQUESTED = process.env.TONE_PROBE_BRUSHES ?? "brush,flat-brush";
const BRUSHES = REQUESTED === "all"
  ? [...new Set([
      ...STUDIO_BRUSH_RUNTIME_CONTRACT.map(({ id }) => id),
      ...STUDIO_BRUSH_ENGINE_LANE_CATALOG_ROWS.map(({ id }) => id),
    ])]
  : REQUESTED.split(",");

/**
 * 샘플 간격(px). 대조 시트는 12px 를 쓰지만 실제 포인터 스트림은 훨씬 촘촘하다. 획 내부의
 * 계단이 밴드 양자화 탓인지 샘플 간격 탓인지는 이 값을 흔들어야만 갈린다.
 */
const SPACING = Number(process.env.TONE_PROBE_SPACING ?? 12);
/**
 * 모든 샘플을 중립 필압으로 고정한다. 굵기 변조가 필압에서 오는지, 촉 각도와 진행 방향의
 * 투영에서만 오는지를 가르는 대조군.
 */
/**
 * 필압 고정. `1` 이면 예전처럼 0.5, 숫자를 주면 그 값으로 전 구간을 고정한다.
 *
 * 숫자를 받게 만든 이유가 이 하네스의 존재 이유와 직결된다. 기본 획은 필압 0.12~0.90 램프인데,
 * pastel 의 폭 매핑이 `pressure 0.62 -> 1.24` 라 깃털 터치에서도 접촉량이 0.70 아래로 내려가지
 * 않는다. 그래서 구워진 셀의 스탬프 3885개 중 접촉량 0.7 미만은 25개뿐이고, 그 25개를 불투명도
 * 0 으로 만들어도 peakInk 가 0.0 움직인다 — 가벼운 터치를 겨냥한 변경이 **구조적으로 측정
 * 불가능**했다. 그것 때문에 세 번의 시도가 "수치가 안 변한다"로 잘못 기각됐다.
 */
const FLAT_PRESSURE_RAW = process.env.TONE_PROBE_FLAT_PRESSURE;
const FLAT_PRESSURE = FLAT_PRESSURE_RAW !== undefined && FLAT_PRESSURE_RAW !== "";
const FLAT_PRESSURE_VALUE = FLAT_PRESSURE_RAW === "1" || FLAT_PRESSURE_RAW === undefined
  ? 0.5
  : Math.min(1, Math.max(0, Number(FLAT_PRESSURE_RAW) || 0.5));
/** 고정 필압 셀은 파일명에 값을 달아, 가벼운 셀과 눌린 셀이 공존하게 한다. */
const CELL_SUFFIX = FLAT_PRESSURE ? `@p${FLAT_PRESSURE_VALUE}` : "";

function strokes() {
  const straight = { points: [] as number[], pressures: [] as number[] };
  const straightCount = Math.max(24, Math.round(CELL_W / SPACING));
  for (let i = 0; i < straightCount; i += 1) {
    const t = i / (straightCount - 1);
    straight.points.push(16 + t * (CELL_W - 32), 26);
    straight.pressures.push(0.12 + 0.78 * Math.sin(Math.PI * t));
  }
  const curve = { points: [] as number[], pressures: [] as number[] };
  const curveCount = Math.max(40, Math.round(CELL_W / (SPACING * 0.667)));
  for (let i = 0; i < curveCount; i += 1) {
    const t = i / (curveCount - 1);
    curve.points.push(16 + t * (CELL_W - 32), 82 + Math.sin(t * Math.PI * 2.2) * 14);
    curve.pressures.push(0.55 + 0.35 * Math.cos(t * Math.PI * 3));
  }
  if (FLAT_PRESSURE) {
    straight.pressures.fill(FLAT_PRESSURE_VALUE);
    curve.pressures.fill(FLAT_PRESSURE_VALUE);
  }
  return [
    { id: "straight", ...straight },
    { id: "curve", ...curve },
  ];
}

function cellSvg(brush: string, brushDynamics: unknown, drawMode: string | null): string {
  // 앱이 포인터 다운에서 실제로 찍는 계약을 그대로 쓴다. 이 핀이 없으면 요소에
  // materialPressureModel 이 없어 필압이 지오메트리에도 밀도에도 닿지 않는 레거시 경로가
  // 그려진다 — 아무 작가도 지나지 않는 경로다.
  const pressureContract = captureStudioDrawPointerPressureContract(
    { drawMode: drawMode ?? "pen", brush, strokeWidth: 16 },
    false,
  );
  const elements = strokes().map((stroke, index) => ({
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
    strokeWidth: 16,
    opacity: 1,
    seed: 4_100 + index,
    ...(brushDynamics ? { brushDynamics } : {}),
    ...(drawMode ? { mode: drawMode } : {}),
  }));
  return exportPageToSvg({
    width: CELL_W,
    height: CELL_H,
    bg: "#ffffff",
    elements: elements as never,
  }).svg;
}

/** 획 내부(침식 후) 픽셀의 톤 분포. 배경 흰색 대비 충분히 어두운 픽셀만 실루엣으로 본다. */
function interiorTones(
  pixels: Uint8Array,
  width: number,
  height: number,
): number[] {
  const luminance = new Float64Array(width * height);
  const covered = new Uint8Array(width * height);
  for (let index = 0; index < width * height; index += 1) {
    const r = pixels[index * 4]!;
    const g = pixels[index * 4 + 1]!;
    const b = pixels[index * 4 + 2]!;
    const value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance[index] = value;
    covered[index] = value < 245 ? 1 : 0;
  }
  const tones: number[] = [];
  for (let y = EROSION; y < height - EROSION; y += 1) {
    for (let x = EROSION; x < width - EROSION; x += 1) {
      let interior = true;
      for (let dy = -EROSION; dy <= EROSION && interior; dy += 1) {
        for (let dx = -EROSION; dx <= EROSION; dx += 1) {
          if (covered[(y + dy) * width + (x + dx)] === 0) {
            interior = false;
            break;
          }
        }
      }
      if (interior) tones.push(luminance[y * width + x]!);
    }
  }
  return tones;
}

/**
 * 실루엣 굵기 변조 — 열마다 덮인 픽셀 수를 센다.
 *
 * 내부 톤과 굵기는 서로 다른 표현 변수다. 평평한 톤이 결함인지 매체의 성질인지는 이 둘을
 * 갈라야만 답할 수 있다: 끌촉(chisel nib)은 밀도가 아니라 촉의 각도와 진행 방향이 만드는
 * 굵기로 말하므로, 톤 sd 가 0 이어도 굵기 sd 가 크면 그 획은 이미 옳다.
 */
function silhouetteWidths(
  pixels: Uint8Array,
  width: number,
  height: number,
  bandTop: number,
  bandBottom: number,
): number[] {
  const widths: number[] = [];
  for (let x = 0; x < width; x += 1) {
    let covered = 0;
    for (let y = Math.max(0, bandTop); y < Math.min(height, bandBottom); y += 1) {
      const index = (y * width + x) * 4;
      const luminance = 0.2126 * pixels[index]!
        + 0.7152 * pixels[index + 1]!
        + 0.0722 * pixels[index + 2]!;
      if (luminance < 245) covered += 1;
    }
    if (covered > 0) widths.push(covered);
  }
  return widths;
}

const module_ = await import("@resvg/resvg-wasm");
const require = createRequire(import.meta.url);
await module_.initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));

/**
 * "이전" 산출물의 정확한 재구성 — 셸 0 은 정의상 모든 폴리곤을 담은 전체 실루엣이므로, 셸
 * 그룹을 셸 0 의 `d` 하나로 접으면 이 캐리어가 예전에 내보내던 단일 합성 패스와 완전히 같다.
 * git 을 건드리지 않고 같은 실행 안에서 before/after 를 재는 방법.
 */
function collapseShells(svg: string): string {
  return svg.replaceAll(
    /<g data-brush-shells="angled-nib-density">(.*?)<\/g>/gu,
    (_, group: string) => {
      const first = /<path d="([^"]+)" fill="([^"]+)"/u.exec(group);
      if (!first) return group;
      return `<path d="${first[1]}" fill="${first[2]}" fill-rule="nonzero"`
        + ` data-brush-engine="angled-nib-local-coverage"/>`;
    },
  );
}

function measure(svg: string): {
  distinct: number;
  sd: number;
  mean: number;
  pixels: number;
  range: number;
  widthSd: number;
  widthMean: number;
  widthRange: number;
} {
  const renderer = new module_.Resvg(svg, {
    shapeRendering: 2,
    font: { loadSystemFonts: false },
    fitTo: { mode: "width", value: CELL_W * SCALE },
  });
  const rendered = renderer.render();
  const scale = rendered.width / CELL_W;
  const tones = interiorTones(rendered.pixels, rendered.width, rendered.height);
  // 직선 획만 — 곡선 획과 세로로 섞이지 않게 그 밴드로 제한한다.
  const widths = silhouetteWidths(
    rendered.pixels,
    rendered.width,
    rendered.height,
    0,
    Math.round(52 * scale),
  );
  rendered.free();
  renderer.free();

  const average = (values: readonly number[]) => (
    values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
  );
  const deviation = (values: readonly number[], mean: number) => Math.sqrt(
    values.reduce((total, value) => total + (value - mean) ** 2, 0) / Math.max(1, values.length),
  );
  const mean = average(tones);
  const widthMean = average(widths);
  const sorted = [...tones].sort((left, right) => left - right);
  const sortedWidths = [...widths].sort((left, right) => left - right);
  return {
    distinct: new Set(tones.map((tone) => Math.round(tone))).size,
    sd: deviation(tones, mean),
    mean,
    pixels: tones.length,
    range: (sorted.at(-1) ?? 0) - (sorted[0] ?? 0),
    widthSd: deviation(widths, widthMean) / scale,
    widthMean: widthMean / scale,
    widthRange: ((sortedWidths.at(-1) ?? 0) - (sortedWidths[0] ?? 0)) / scale,
  };
}

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
  "tests/benchmarks/results/brush-contact-sheet",
);

/**
 * 밴드 경계가 등고선으로 보이는지는 1배에서 판정할 수 없다. 획의 한 구간만 잘라 크게 굽는다 —
 * 톤이 계단으로 끊기는지, 이어지는지는 눈으로만 확인된다.
 */
async function writeZoom(brush: string, svg: string, x: number, w: number): Promise<void> {
  const inner = svg.replace(/^<svg[^>]*>/u, "").replace(/<\/svg>$/u, "");
  const cropped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} 6 ${w} 40"`
    + ` width="${w}" height="40">${inner}</svg>`;
  const renderer = new module_.Resvg(cropped, {
    shapeRendering: 2,
    font: { loadSystemFonts: false },
    fitTo: { mode: "width", value: 1400 },
  });
  const rendered = renderer.render();
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(resolve(OUT_DIR, `zoom-${brush}.png`), Buffer.from(rendered.asPng()));
  rendered.free();
  renderer.free();
}

const rows: string[] = [];
const survey: { brush: string; carriers: string; sd: number; distinct: number }[] = [];
for (const brush of BRUSHES) {
  const selection = await materializeStudioBrushCatalogSelection(brush);
  const svg = cellSvg(
    brush,
    selection?.brushDynamics ?? null,
    (selection as { drawMode?: string } | null)?.drawMode ?? null,
  );
  const carriers = [
    ...new Set(
      Array.from(
        svg.matchAll(/data-(?:brush-engine|brush-coverage|brush-shells|paint-carrier)="([^"]+)"/gu),
        (match) => match[1]!,
      ),
    ),
  ];
  const after = measure(svg);
  const before = measure(collapseShells(svg));
  if (process.env.TONE_PROBE_ZOOM) await writeZoom(brush, svg, 20, 200);
  // resvg 의 20배 확대는 텍스처 팁 경로에서 wasm unreachable 로 죽는다(측정용 1배 래스터는 멀쩡).
  // 그래서 육안 확인은 SVG 를 그대로 떨궈 실제 브라우저에서 보게 한다 — 죽은 래스터라이저의
  // 마지막 성공 출력이 그대로 남아 "안 바뀌었다"로 읽히는 함정을 피하는 게 목적이다.
  if (process.env.TONE_PROBE_WRITE_SVG) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(resolve(OUT_DIR, `cell-${brush}${CELL_SUFFIX}.svg`), svg, "utf8");
  }
  const format = (label: string, m: ReturnType<typeof measure>) => [
    `${label}: interiorPx=${m.pixels}`,
    `distinctTones=${m.distinct}`,
    `toneSd=${m.sd.toFixed(3)}`,
    `toneRange=${m.range.toFixed(1)}`,
    `| widthMean=${m.widthMean.toFixed(2)}`,
    `widthSd=${m.widthSd.toFixed(3)}`,
    `widthRange=${m.widthRange.toFixed(2)}`,
  ].join("  ");
  // 기하 비용 — 셸 k 는 자기 위의 모든 폴리곤을 다시 칠하므로, 배출된 서브패스 총수가
  // 예전 단일 합성 패스 대비 몇 배인지가 이 캐리어가 치르는 실제 값이다.
  const emittedSubpaths = (svg.match(/M /gu) ?? []).length;
  const baseSubpaths = (collapseShells(svg).match(/M /gu) ?? []).length;
  survey.push({
    brush,
    carriers: carriers.join("+") || "none",
    sd: after.sd,
    distinct: after.distinct,
  });
  // 이 브러시가 애초에 필압 모델에 옵트인하는가 — 평평함의 원인이 "밀도를 버린 것"인지
  // "필압 계약에 들어오지 않은 것"인지를 가르는 값이다.
  const optIn = captureStudioDrawPointerPressureContract(
    {
      drawMode: (selection as { drawMode?: string } | null)?.drawMode ?? "pen",
      brush,
      strokeWidth: 16,
    },
    false,
  ).materialPressureModel ?? "none";
  rows.push(
    `brush=${brush}  carriers=${carriers.join("+") || "none"}  pressureModel=${optIn}`
    + `  shellPaths=${(svg.match(/data-nib-density-band="/gu) ?? []).length}`
    + `  subpaths=${emittedSubpaths} vs ${baseSubpaths}`
    + ` (${(emittedSubpaths / Math.max(1, baseSubpaths)).toFixed(1)}x)`,
    `  ${format("before", before)}`,
    `  ${format("after ", after)}`,
  );
}
if (process.env.TONE_PROBE_SURVEY) {
  // 카탈로그 전수 — 내부가 평평한 브러시(획 안쪽 톤이 사실상 한 가지)를 캐리어별로 모은다.
  // "어디까지 일반화되는가"는 추측이 아니라 이 목록으로 답한다.
  const flat = survey
    .filter(({ sd }) => sd < 1)
    .sort((left, right) => left.carriers.localeCompare(right.carriers));
  process.stdout.write(
    `\nflat interiors: ${flat.length}/${survey.length}\n`
    + flat.map(({ brush, carriers, sd, distinct }) => (
      `  ${brush.padEnd(28)} ${carriers.padEnd(38)} sd=${sd.toFixed(3)} tones=${distinct}`
    )).join("\n")
    + "\n",
  );
} else {
  process.stdout.write(`${rows.join("\n")}\n`);
}
