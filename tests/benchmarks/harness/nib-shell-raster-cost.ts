/**
 * 닙 밀도 레이어를 실제로 "칠하는" 비용 — 계획 비용이 아니라 래스터 비용.
 *
 * 이 하네스가 존재하는 이유: 누적 셸(cumulative shells)을 계측 없이 머지했다가 되돌린 적이
 * 있다. 셸 k 는 밴드 k 이상의 폴리곤을 전부 다시 칠하므로 같은 기하가 스무 번 넘게 채워지고,
 * 긴 획 하나가 110.8ms 였다(같은 기하 1회 채우기는 8.5ms). 품질을 깎아 속도를 사는 것은
 * 금지돼 있으므로, 답은 "밴드를 줄인다"가 아니라 "같은 그림을 1회 채우기로 얻는다"여야 한다.
 *
 * 그래서 세 전략을 같은 기하로, 같은 브라우저에서, 같은 픽셀을 만들어내는지까지 확인하며 잰다:
 *   legacy  — 예전 그대로 단일 합집합 1회 채우기(톤 없음, 하한 기준)
 *   shells  — 누적 셸(SVG 가 쓰는 형태), source-over
 *   bands   — 분리 밴드를 스크래치에 destination-over 로 칠하고 1회 블릿(캔버스가 쓸 형태)
 *
 * 정직성 규칙(이 디렉터리의 형제 하네스와 동일):
 *   - 실제 브라우저, 실제 Canvas2D. 시뮬레이션 없음.
 *   - 백분위와 함께 표본 전체를 JSON 에 남긴다.
 *   - 속도만 재고 끝내지 않는다. bands 와 shells 의 결과 픽셀 차이를 같이 재서, 싸진 대신
 *     그림이 달라졌다면 그 자체로 실패다.
 *
 * 실행: pnpm exec tsx tests/benchmarks/harness/nib-shell-raster-cost.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

import { planStudioAngledNibStrokeLocalCoverage } from "../../../apps/web/src/domains/creator/brush/studio-stroke-local-coverage";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../results/nib-shell-raster-cost.json");

const SAMPLE_COUNTS = [100, 200, 400, 900];
const REPEATS = 25;
const STROKE_WIDTH = 24;
const ELEMENT_OPACITY = 0.85;
const COLOR = "#1b1b1f";
const DEVICE_PIXELS_PER_UNIT = 2;

/** 벤치용 획: 곡률과 필압이 같이 변해야 밴드가 실제로 여러 개 나온다. */
function strokeOf(sampleCount: number): { points: number[]; pressures: number[] } {
  const points: number[] = [];
  const pressures: number[] = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const t = index / (sampleCount - 1);
    points.push(40 + t * 900, 300 + Math.sin(t * Math.PI * 3) * 140);
    pressures.push(0.12 + 0.85 * Math.sin(Math.PI * t) ** 0.8);
  }
  return { points, pressures };
}

interface PlanPayload {
  readonly sampleCount: number;
  readonly polygonCount: number;
  readonly shellCount: number;
  readonly bandCount: number;
  readonly polygons: readonly (readonly number[])[];
  readonly shells: readonly { opacity: number; polygons: readonly number[][] }[];
  readonly bands: readonly { opacity: number; polygons: readonly number[][] }[];
}

function payloadFor(sampleCount: number): PlanPayload {
  const { points, pressures } = strokeOf(sampleCount);
  const plan = planStudioAngledNibStrokeLocalCoverage(points, STROKE_WIDTH, -Math.PI / 6, {
    profileId: "brush",
    pressures,
    elementOpacity: ELEMENT_OPACITY,
  });
  const flatten = (
    layers: readonly { opacity: number; polygons: readonly { points: readonly number[] }[] }[],
  ) => layers.map((layer) => ({
    opacity: layer.opacity,
    polygons: layer.polygons.map((polygon) => [...polygon.points]),
  }));
  return {
    sampleCount,
    polygonCount: plan.polygons.length,
    shellCount: plan.shells.length,
    bandCount: plan.bands.length,
    polygons: plan.polygons.map((polygon) => [...polygon.points]),
    shells: flatten(plan.shells),
    bands: flatten(plan.bands),
  };
}

/**
 * 브라우저 안에서 도는 본체. 여기서 만드는 픽셀이 렌더러가 만들 픽셀과 같아야 하므로,
 * `bands` 전략은 `studio-stroke-coverage-raster.ts` 와 같은 순서·같은 합성 모드를 쓴다.
 */
const IN_PAGE = `(payload, repeats, dpr, color, opacity) => {
  const W = 1024;
  const H = 640;
  const target = document.createElement("canvas");
  target.width = W * dpr;
  target.height = H * dpr;
  const ctx = target.getContext("2d");
  const scratch = document.createElement("canvas");
  scratch.width = target.width;
  scratch.height = target.height;
  const sctx = scratch.getContext("2d");

  const trace = (context, polygons) => {
    context.beginPath();
    for (const points of polygons) {
      context.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) context.lineTo(points[i], points[i + 1]);
      context.closePath();
    }
  };

  const legacy = () => {
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    trace(ctx, payload.polygons);
    ctx.fill("nonzero");
  };
  const shells = () => {
    ctx.fillStyle = color;
    for (const shell of payload.shells) {
      ctx.globalAlpha = shell.opacity;
      trace(ctx, shell.polygons);
      ctx.fill("nonzero");
    }
  };
  const bands = () => {
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.globalCompositeOperation = "destination-over";
    sctx.fillStyle = color;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const band of payload.bands) {
      sctx.globalAlpha = band.opacity;
      trace(sctx, band.polygons);
      sctx.fill("nonzero");
    }
    sctx.restore();
    ctx.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, 0, 0, W, H);
  };
  // destination-over 는 "먼저 칠한 밴드가 이긴다"가 아니다 — 나중 밴드를 뒤에 깔 뿐이라, 굽은
  // 구간에서 서로 겹친 밝은 밴드가 짙은 밴드를 더 어둡게 만든다. 실제로 필요한 것은 스텐실:
  // 밝은 밴드부터 각 밴드의 영역을 지우고 그 자리에 자기 절대 알파로 칠한다. 그러면 여러 밴드가
  // 겹친 픽셀은 마지막(가장 짙은) 밴드 값으로 남고, 이웃한 밴드 경계는 두 커버리지의 선형 혼합이
  // 되어 이음매가 생기지 않는다. 폴리곤당 채우기 2회지만 Path2D 로 경로는 한 번만 만든다.
  const bandsStencil = () => {
    const paths = payload.bands.map((band) => {
      const path = new Path2D();
      for (const points of band.polygons) {
        path.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
        path.closePath();
      }
      return path;
    });
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.fillStyle = color;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 밝은 밴드부터 — payload.bands 는 짙은 밴드가 먼저이므로 역순으로 걷는다.
    for (let index = paths.length - 1; index >= 0; index -= 1) {
      sctx.globalAlpha = 1;
      sctx.globalCompositeOperation = "destination-out";
      sctx.fill(paths[index], "nonzero");
      sctx.globalAlpha = payload.bands[index].opacity;
      sctx.globalCompositeOperation = "source-over";
      sctx.fill(paths[index], "nonzero");
    }
    sctx.restore();
    ctx.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, 0, 0, W, H);
  };

  // 같은 셸을 같은 순서로, 같은 알파로 칠한다 — 다른 것은 경로를 32번 다시 걷지 않는다는 것뿐.
  // 밴드마다 Path2D 를 한 번 만들고, 셸은 addPath 로 누적한다. 픽셀은 정의상 shells 와 동일해야
  // 한다. 만약 이것만으로 비용이 무너진다면 비용의 정체는 래스터화가 아니라 JS 경로 호출이었다.
  const shellsPath2D = () => {
    const bandPaths = payload.bands.map((band) => {
      const path = new Path2D();
      for (const points of band.polygons) {
        path.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) path.lineTo(points[i], points[i + 1]);
        path.closePath();
      }
      return path;
    });
    // payload.bands 는 짙은 밴드가 먼저. 셸 k 는 밴드 k 이상의 합집합이므로, 짙은 쪽부터 접어
    // 올리면 셸 하나당 addPath 한 번으로 끝난다.
    const cumulative = [];
    let acc = new Path2D();
    for (let i = 0; i < bandPaths.length; i += 1) {
      const next = new Path2D();
      next.addPath(acc);
      next.addPath(bandPaths[i]);
      acc = next;
      cumulative.push(acc);
    }
    ctx.fillStyle = color;
    // shells[k] 는 바깥(옅은)부터이므로, 누적 배열을 뒤에서부터 읽으면 같은 순서가 된다.
    for (let k = 0; k < payload.shells.length; k += 1) {
      ctx.globalAlpha = payload.shells[k].opacity;
      ctx.fill(cumulative[cumulative.length - 1 - k], "nonzero");
    }
  };

  // 이음매의 정체: 부분 커버리지 위에서 지우고-다시-칠하면 두 기여가 곱해진다. 빈 대상 위의
  // source-over 만이 c·t 를 정확히 준다. 그러므로 밴드를 빈 스크래치에 '더한다' — 맞닿은 두
  // 밴드 경계에서 c·tA + (1-c)·tB, 즉 정확한 선형 혼합이 되어 이음매가 사라진다. 밴드 하나는
  // 여전히 한 번의 합성 채우기라 자기 자신과는 더해지지 않는다.
  const bandsAdditive = () => {
    sctx.save();
    sctx.setTransform(1, 0, 0, 1, 0, 0);
    sctx.clearRect(0, 0, scratch.width, scratch.height);
    sctx.globalCompositeOperation = "lighter";
    sctx.fillStyle = color;
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const band of payload.bands) {
      sctx.globalAlpha = band.opacity;
      trace(sctx, band.polygons);
      sctx.fill("nonzero");
    }
    sctx.restore();
    ctx.globalAlpha = 1;
    ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, 0, 0, W, H);
  };

  const strategies = { legacy, shells, bands, bandsStencil, shellsPath2D, bandsAdditive };
  const timings = {};
  const snapshots = {};
  for (const [name, run] of Object.entries(strategies)) {
    // 워밍업 후 측정. 각 반복은 깨끗한 대상에서 시작해야 합성 이력이 섞이지 않는다.
    for (let i = 0; i < 3; i += 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      run();
    }
    const samples = [];
    for (let i = 0; i < repeats; i += 1) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "source-over";
      const started = performance.now();
      run();
      // getImageData 로 GPU/래스터 큐를 실제로 비워야 시간이 정직해진다.
      ctx.getImageData(0, 0, 1, 1);
      samples.push(performance.now() - started);
    }
    samples.sort((a, b) => a - b);
    timings[name] = samples;
    snapshots[name] = Array.from(
      ctx.getImageData(0, 0, target.width, target.height).data,
    );
  }

  // 픽셀 일치: 같은 그림인지. 알파 채널만 비교하면 색이 같은 한 충분하다.
  //
  // 전체와 INTERIOR 를 나눠 재는 게 핵심이다. 안티에일리어싱된 가장자리에서는 어떤 전략이든
  // 서로 다를 수밖에 없다 — 누적 셸은 부분 커버리지 c 를 여러 번 합성해 c 에 대해 비선형으로
  // 어두워지고, 밴드는 c·target 이라는 선형값을 준다. 그건 톤 오차가 아니라 가장자리 해석
  // 차이다. 실제로 물어야 할 것은 "획 안쪽 톤이 같은가"이므로, 마스크를 3px 침식해 가장자리를
  // 제외한 비교를 따로 낸다.
  const buildInterior = (ref) => {
    const w = target.width;
    const h = target.height;
    const mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < ref.length; i += 4, p += 1) mask[p] = ref[i + 3] > 0 ? 1 : 0;
    let current = mask;
    for (let pass = 0; pass < 3; pass += 1) {
      const next = new Uint8Array(w * h);
      for (let y = 1; y < h - 1; y += 1) {
        for (let x = 1; x < w - 1; x += 1) {
          const p = y * w + x;
          next[p] = current[p]
            && current[p - 1] && current[p + 1]
            && current[p - w] && current[p + w] ? 1 : 0;
        }
      }
      current = next;
    }
    return current;
  };
  const compare = (a, b, interior) => {
    let worst = 0;
    let sum = 0;
    let counted = 0;
    let interiorWorst = 0;
    let interiorSum = 0;
    let interiorCount = 0;
    for (let i = 3, p = 0; i < a.length; i += 4, p += 1) {
      const diff = Math.abs(a[i] - b[i]);
      if (a[i] > 0 || b[i] > 0) { counted += 1; sum += diff; }
      if (diff > worst) worst = diff;
      if (interior[p]) {
        interiorCount += 1;
        interiorSum += diff;
        if (diff > interiorWorst) interiorWorst = diff;
      }
    }
    return {
      worstAlphaDiff: worst,
      meanAlphaDiff: counted ? sum / counted : 0,
      counted,
      interiorWorstAlphaDiff: interiorWorst,
      interiorMeanAlphaDiff: interiorCount ? interiorSum / interiorCount : 0,
      interiorCounted: interiorCount,
    };
  };
  const interior = buildInterior(snapshots.shells);

  return {
    timings,
    bandsVsShells: compare(snapshots.bands, snapshots.shells, interior),
    stencilVsShells: compare(snapshots.bandsStencil, snapshots.shells, interior),
    path2dVsShells: compare(snapshots.shellsPath2D, snapshots.shells, interior),
    additiveVsShells: compare(snapshots.bandsAdditive, snapshots.shells, interior),
    legacyVsShells: compare(snapshots.legacy, snapshots.shells, interior),
  };
}`;

const median = (sorted: readonly number[]): number => (
  sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!
);

async function main(): Promise<void> {
  const payloads = SAMPLE_COUNTS.map(payloadFor);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent("<!doctype html><meta charset=utf-8><title>nib raster cost</title>");

  const rows: unknown[] = [];
  for (const payload of payloads) {
    const result = await page.evaluate(
      ([body, args]) => (
         
        new Function(`return (${body})`)()(...(args as unknown[]))
      ),
      [IN_PAGE, [payload, REPEATS, DEVICE_PIXELS_PER_UNIT, COLOR, ELEMENT_OPACITY]] as const,
    ) as {
      timings: Record<string, number[]>;
      bandsVsShells: { worstAlphaDiff: number; meanAlphaDiff: number; counted: number; interiorWorstAlphaDiff: number; interiorMeanAlphaDiff: number; interiorCounted: number };
      stencilVsShells: { worstAlphaDiff: number; meanAlphaDiff: number; counted: number; interiorWorstAlphaDiff: number; interiorMeanAlphaDiff: number; interiorCounted: number };
      path2dVsShells: { worstAlphaDiff: number; meanAlphaDiff: number; counted: number; interiorWorstAlphaDiff: number; interiorMeanAlphaDiff: number; interiorCounted: number };
      additiveVsShells: { worstAlphaDiff: number; meanAlphaDiff: number; counted: number; interiorWorstAlphaDiff: number; interiorMeanAlphaDiff: number; interiorCounted: number };
      legacyVsShells: { worstAlphaDiff: number; meanAlphaDiff: number; counted: number; interiorWorstAlphaDiff: number; interiorMeanAlphaDiff: number; interiorCounted: number };
    };

    const row = {
      sampleCount: payload.sampleCount,
      polygonCount: payload.polygonCount,
      shellCount: payload.shellCount,
      bandCount: payload.bandCount,
      medianMs: Object.fromEntries(
        Object.entries(result.timings).map(([name, samples]) => [name, median(samples)]),
      ),
      samplesMs: result.timings,
      bandsVsShells: result.bandsVsShells,
      stencilVsShells: result.stencilVsShells,
      path2dVsShells: result.path2dVsShells,
      additiveVsShells: result.additiveVsShells,
      legacyVsShells: result.legacyVsShells,
    };
    rows.push(row);
    const m = row.medianMs;
    console.log(
      `n=${payload.sampleCount} polys=${payload.polygonCount} shells=${payload.shellCount} `
      + `bands=${payload.bandCount} | legacy ${m.legacy!.toFixed(2)}ms `
      + `shells ${m.shells!.toFixed(2)}ms bands ${m.bands!.toFixed(2)}ms `
      + `stencil ${m.bandsStencil!.toFixed(2)}ms additive ${m.bandsAdditive!.toFixed(2)}ms`
      + `\n    additive vs shells: max ${result.additiveVsShells.worstAlphaDiff} mean `
      + `${result.additiveVsShells.meanAlphaDiff.toFixed(3)}`
      + `\n    INTERIOR vs shells (alpha max/mean): bands `
      + `${result.bandsVsShells.interiorWorstAlphaDiff}/`
      + `${result.bandsVsShells.interiorMeanAlphaDiff.toFixed(3)} · stencil `
      + `${result.stencilVsShells.interiorWorstAlphaDiff}/`
      + `${result.stencilVsShells.interiorMeanAlphaDiff.toFixed(3)} · legacy `
      + `${result.legacyVsShells.interiorWorstAlphaDiff}/`
      + `${result.legacyVsShells.interiorMeanAlphaDiff.toFixed(3)}`,
    );
  }

  await browser.close();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(
    OUT,
    `${JSON.stringify({
      generatedBy: "tests/benchmarks/harness/nib-shell-raster-cost.ts",
      strokeWidth: STROKE_WIDTH,
      elementOpacity: ELEMENT_OPACITY,
      devicePixelsPerUnit: DEVICE_PIXELS_PER_UNIT,
      repeats: REPEATS,
      rows,
    }, null, 2)}\n`,
    "utf8",
  );
  console.log(`\nwrote ${OUT}`);
}

await main();
