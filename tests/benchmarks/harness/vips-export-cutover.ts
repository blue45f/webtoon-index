/**
 * vips export cutover — 웨이브 A-④ 실측 하네스.
 *
 * 대형 캔버스 규격 내보내기(exportPresetSlices)의 wasm-vips 레인 실배선 전/후를
 * 동일 입력으로 비교한다:
 *  - before: 브라우저 ctx.drawImage(imageSmoothingQuality "high") 프록시인
 *    CanvasKit linear(no-mips) 다운스케일 — quality-lab 과 동일 프록시.
 *  - after: 컷오버 경로 그대로 prepareVipsRoutedPresetPages → downscaleForExport
 *    (wasm-vips lanczos3, 단일 스레드).
 *  - 레퍼런스: float 면적평균(부분 픽셀 가중 포함 — 비정수 배율 일반화) —
 *    quality-lab 방법론의 직사각형·분수 배율 확장.
 *  - pristine: 인코어 예산(8192 edge/면적) 이하 캔버스는 prepare 가 원본 참조를
 *    그대로 돌려주고 바이트가 불변임을 sha256 으로 증명한다.
 *
 * 실행: pnpm exec tsx tests/benchmarks/harness/vips-export-cutover.ts
 * 결과: tests/benchmarks/results/vips-export-cutover.json
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { loadCanvasKitNode } from "@toonspectrum/studio-engine-skia/node";

import {
  findExportPreset,
  planPresetSliceExport,
  prepareVipsRoutedPresetPages,
  type ExportPreset,
} from "../../../apps/web/src/domains/creator/export/studio-export-presets";
import {
  downscaleForExport,
  loadVipsForExport,
  planVipsExportRoute,
  type StudioVipsRaster,
} from "../../../apps/web/src/domains/creator/export/studio-vips-export";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;
const RESULTS_DIR = join(REPO_ROOT, "tests", "benchmarks", "results");

// ── quality-lab detail card 의 직사각형 일반화(동일 콘텐츠 클래스) ──

function detailCardLuma(width: number, height: number): Float64Array {
  const card = new Float64Array(width * height);
  const scale = width / 512; // 폭 축 기준 스케일 — 세로 스트립에서도 선 굵기 일정
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0.5 + 0.45 * (x / width);
      if (Math.floor(x / scale) % 8 === 0 || Math.floor(y / scale) % 8 === 0) {
        value = 0.08;
      }
      const dx = x - width * 0.7;
      const dy = y - height * 0.3;
      const radius = Math.hypot(dx, dy);
      if (Math.sin(radius / (1.5 * scale)) > 0.6) value = Math.min(value, 0.15);
      if ((x + y) % Math.round(11 * scale) < 1.2 * scale) value = 0.92;
      card[y * width + x] = value;
    }
  }
  return card;
}

function lumaToRgba(luma: Float64Array): Uint8Array {
  const out = new Uint8Array(luma.length * 4);
  for (let index = 0; index < luma.length; index += 1) {
    const v = Math.round(Math.min(1, Math.max(0, luma[index] ?? 0)) * 255);
    out[index * 4] = v;
    out[index * 4 + 1] = v;
    out[index * 4 + 2] = v;
    out[index * 4 + 3] = 255;
  }
  return out;
}

function rgbaToLuma(rgba: Uint8Array): Float64Array {
  const out = new Float64Array(rgba.length / 4);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = (rgba[index * 4] ?? 0) / 255;
  }
  return out;
}

/** 축 하나의 면적평균 가중(부분 픽셀 커버리지 포함) — 비정수 배율 정확 처리. */
function axisBins(srcLen: number, dstLen: number): { start: number; weights: number[] }[] {
  const factor = srcLen / dstLen;
  const bins: { start: number; weights: number[] }[] = [];
  for (let index = 0; index < dstLen; index += 1) {
    const from = index * factor;
    const to = (index + 1) * factor;
    const start = Math.floor(from);
    const end = Math.min(srcLen, Math.ceil(to));
    const weights: number[] = [];
    for (let s = start; s < end; s += 1) {
      weights.push(Math.min(to, s + 1) - Math.max(from, s));
    }
    bins.push({ start, weights });
  }
  return bins;
}

/** float 면적평균 축소(직사각형·분수 배율) — 엔진 독립 레퍼런스. */
function areaReduce(
  luma: Float64Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float64Array {
  const xBins = axisBins(srcW, dstW);
  const horizontal = new Float64Array(dstW * srcH);
  const xFactor = srcW / dstW;
  for (let y = 0; y < srcH; y += 1) {
    for (let x = 0; x < dstW; x += 1) {
      const bin = xBins[x];
      if (!bin) continue;
      let sum = 0;
      for (let k = 0; k < bin.weights.length; k += 1) {
        sum += (luma[y * srcW + bin.start + k] ?? 0) * (bin.weights[k] ?? 0);
      }
      horizontal[y * dstW + x] = sum / xFactor;
    }
  }
  const yBins = axisBins(srcH, dstH);
  const out = new Float64Array(dstW * dstH);
  const yFactor = srcH / dstH;
  for (let y = 0; y < dstH; y += 1) {
    const bin = yBins[y];
    if (!bin) continue;
    for (let x = 0; x < dstW; x += 1) {
      let sum = 0;
      for (let k = 0; k < bin.weights.length; k += 1) {
        sum += (horizontal[(bin.start + k) * dstW + x] ?? 0) * (bin.weights[k] ?? 0);
      }
      out[y * dstW + x] = sum / yFactor;
    }
  }
  return out;
}

function psnr(a: Float64Array, b: Float64Array): number {
  let mse = 0;
  for (let index = 0; index < a.length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    mse += diff * diff;
  }
  mse /= a.length;
  if (mse === 0) return Infinity;
  return Number((10 * Math.log10(1 / mse)).toFixed(2));
}

/** 비겹침 8×8 luma SSIM — quality-lab 그대로, 직사각형 지원. */
function meanSsim(a: Float64Array, b: Float64Array, width: number, height: number): number {
  const window = 8;
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  let total = 0;
  let count = 0;
  for (let by = 0; by + window <= height; by += window) {
    for (let bx = 0; bx + window <= width; bx += window) {
      let meanA = 0;
      let meanB = 0;
      for (let y = 0; y < window; y += 1) {
        for (let x = 0; x < window; x += 1) {
          meanA += a[(by + y) * width + (bx + x)] ?? 0;
          meanB += b[(by + y) * width + (bx + x)] ?? 0;
        }
      }
      const n = window * window;
      meanA /= n;
      meanB /= n;
      let varA = 0;
      let varB = 0;
      let cov = 0;
      for (let y = 0; y < window; y += 1) {
        for (let x = 0; x < window; x += 1) {
          const da = (a[(by + y) * width + (bx + x)] ?? 0) - meanA;
          const db = (b[(by + y) * width + (bx + x)] ?? 0) - meanB;
          varA += da * da;
          varB += db * db;
          cov += da * db;
        }
      }
      varA /= n - 1;
      varB /= n - 1;
      cov /= n - 1;
      total +=
        ((2 * meanA * meanB + c1) * (2 * cov + c2)) /
        ((meanA * meanA + meanB * meanB + c1) * (varA + varB + c2));
      count += 1;
    }
  }
  return Number((total / count).toFixed(4));
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** prepare 가 소비하는 최소 캔버스 더블 — width/height 만 실제로 쓰인다. */
function fakePage(width: number, height: number): HTMLCanvasElement {
  return { width, height } as unknown as HTMLCanvasElement;
}

async function main(): Promise<void> {
  const ck = await loadCanvasKitNode();
  const naver = findExportPreset("naver-challenge") as ExportPreset;
  const instagram = findExportPreset("instagram-square") as ExportPreset;

  // ── 라우팅 결정표(경계 8192±1 포함) ──
  const routes = [
    [720, 8191],
    [720, 8192],
    [720, 8193],
    [4096, 4096],
    [2048, 16384],
    [16384, 16384],
    [16385, 16384],
  ].map(([width, height]) => ({
    canvas: `${width}x${height}`,
    route: planVipsExportRoute(width as number, height as number).route,
  }));

  // ── pristine: 4096² (인스타그램 1080) — 인코어 예산 이하 → prepare 는 no-op ──
  const squareSize = 4096;
  const squareLuma = detailCardLuma(squareSize, squareSize);
  const squareRgba = lumaToRgba(squareLuma);
  const squareShaBefore = sha256(squareRgba);
  const squarePlan = planPresetSliceExport(
    [{ width: squareSize, height: squareSize }],
    instagram,
    "jpg",
  );
  if (!squarePlan) throw new Error("square plan failed");
  const squarePage = fakePage(squareSize, squareSize);
  const squarePrepared = await prepareVipsRoutedPresetPages([squarePage], squarePlan, {
    loadVipsRuntime: () => {
      throw new Error("pristine 경로에서 vips 를 로드하면 안 됩니다.");
    },
    readPageRgba: () => {
      throw new Error("pristine 경로에서 픽셀을 읽으면 안 됩니다.");
    },
  });
  const pristine = {
    case: "square-4096-instagram1080",
    route: planVipsExportRoute(squareSize, squareSize).route,
    pagePassedThroughUntouched:
      squarePrepared.drawPages[0] === squarePage && squarePrepared.vipsRoutedPages === 0,
    sourceSha256: squareShaBefore,
    sourceSha256AfterPrepare: sha256(squareRgba),
    bytesIdentical: sha256(squareRgba) === squareShaBefore,
  };

  // ── routed: 2048×16384 웹툰 스트립 → 네이버 690 (690×5520) ──
  const stripW = 2048;
  const stripH = 16384;
  const stripPlan = planPresetSliceExport([{ width: stripW, height: stripH }], naver, "jpg");
  if (!stripPlan) throw new Error("strip plan failed");
  const targetW = stripPlan.targetWidth; // 690
  const targetH = stripPlan.pages[0]?.height ?? 0; // round(16384*690/2048) = 5520
  const stripLuma = detailCardLuma(stripW, stripH);
  const stripRgba = lumaToRgba(stripLuma);
  const reference = areaReduce(stripLuma, stripW, stripH, targetW, targetH);

  // before 레인: CanvasKit linear(no-mips) — 브라우저 drawImage 프록시(quality-lab 동일).
  const info = {
    width: stripW,
    height: stripH,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  };
  const image = ck.MakeImage(info, stripRgba, stripW * 4);
  if (!image) throw new Error("MakeImage failed");
  const surface = ck.MakeSurface(targetW, targetH);
  if (!surface) throw new Error("MakeSurface failed");
  const canvas = surface.getCanvas();
  const beforeStart = performance.now();
  canvas.drawImageRectOptions(
    image,
    ck.XYWHRect(0, 0, stripW, stripH),
    ck.XYWHRect(0, 0, targetW, targetH),
    ck.FilterMode.Linear,
    ck.MipmapMode.None,
  );
  surface.flush();
  const beforeWallMs = performance.now() - beforeStart;
  const beforePixels = canvas.readPixels(0, 0, {
    width: targetW,
    height: targetH,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  });
  surface.dispose();
  image.delete();
  if (!beforePixels) throw new Error("readPixels failed");
  const beforeLuma = rgbaToLuma(new Uint8Array(beforePixels as Uint8Array));

  // after 레인: 컷오버 경로 그대로 prepareVipsRoutedPresetPages(실 wasm-vips).
  const loadStart = performance.now();
  const runtime = await loadVipsForExport();
  const loadMs = performance.now() - loadStart;
  const rasters: StudioVipsRaster[] = [];
  const afterStart = performance.now();
  const prepared = await prepareVipsRoutedPresetPages([fakePage(stripW, stripH)], stripPlan, {
    loadVipsRuntime: () => Promise.resolve(runtime),
    readPageRgba: () => stripRgba,
    createResampledPage: (raster) => {
      rasters.push(raster);
      return fakePage(raster.width, raster.height);
    },
  });
  const afterWallMs = performance.now() - afterStart;
  const raster = rasters[0];
  if (prepared.vipsRoutedPages !== 1 || !raster) {
    throw new Error(`routed case did not go through vips: ${JSON.stringify(prepared)}`);
  }
  if (raster.width !== targetW || raster.height !== targetH) {
    throw new Error(`size drift: ${raster.width}x${raster.height}`);
  }
  const afterLuma = rgbaToLuma(raster.rgba);

  // 정합 검증: downscaleForExport 직접 호출과 컷오버 경로 결과가 바이트 동일해야 한다.
  const direct = await downscaleForExport(stripRgba, stripW, stripH, targetW, targetH, { runtime });
  const cutoverMatchesDirectLane = sha256(direct.rgba) === sha256(raster.rgba);

  const results = {
    harness:
      "tests/benchmarks/harness/vips-export-cutover.ts (pnpm exec tsx …) — one-shot cutover measurement",
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model ?? "unknown",
      node: process.version,
    },
    cutover: {
      wiring:
        "apps/web/src/domains/creator/export/studio-export-presets.ts exportPresetSlices → prepareVipsRoutedPresetPages",
      routing:
        "apps/web/src/domains/creator/export/studio-vips-export.ts planVipsExportRoute (edge 8192 / area 8192² / input 16384²)",
      fallback:
        "vips 로드·리샘플 실패 시 기존 drawImage 경로 + PresetExportResult.qualityWarning 표면화",
    },
    methodology: {
      runsPerCase: 1,
      reference:
        "float area-average (fractional pixel coverage, rectangular) — quality-lab 방법론의 비정수 배율 일반화",
      beforeLane:
        "CanvasKit linear/no-mips drawImageRectOptions — 브라우저 ctx.drawImage 프록시(quality-lab canvaskit-linear-nomips 와 동일)",
      afterLane:
        "prepareVipsRoutedPresetPages → downscaleForExport (wasm-vips lanczos3, concurrency 1) — 실배선 경로 그대로",
      note:
        "wallMs 는 단일 실행 실측(공유 개발 호스트). after.wallMs 는 prepare 전체(복사 포함), loadMs 는 wasm 초기화 별도.",
    },
    routes,
    pristine,
    routed: {
      case: "webtoon-strip-2048x16384-naver690",
      route: planVipsExportRoute(stripW, stripH).route,
      source: `${stripW}x${stripH}`,
      target: `${targetW}x${targetH}`,
      inputMB: Number(((stripW * stripH * 4) / (1024 * 1024)).toFixed(1)),
      before: {
        lane: "canvaskit-linear-nomips (browser drawImage proxy)",
        wallMs: Number(beforeWallMs.toFixed(2)),
        psnrDb: psnr(reference, beforeLuma),
        ssim: meanSsim(reference, beforeLuma, targetW, targetH),
      },
      after: {
        lane: "wasm-vips-lanczos3 (cutover: prepareVipsRoutedPresetPages)",
        wallMs: Number(afterWallMs.toFixed(2)),
        loadMs: Number(loadMs.toFixed(2)),
        psnrDb: psnr(reference, afterLuma),
        ssim: meanSsim(reference, afterLuma, targetW, targetH),
      },
      cutoverMatchesDirectLane,
    },
  };

  await mkdir(RESULTS_DIR, { recursive: true });
  const out = join(RESULTS_DIR, "vips-export-cutover.json");
  await writeFile(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`wrote ${out}`);
  console.log(JSON.stringify(results.routed, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
