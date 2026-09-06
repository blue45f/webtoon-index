// studio-vips-export 계약 테스트 — 실 wasm-vips 를 node 에서 로드해 검증한다
// (Quality Lab tests/benchmarks/harness/quality-lab.ts 가 동일 방식의 node 로드를 실증).
// 품질 기준 수치는 tests/benchmarks/results/quality-lab.json(2026-08-07) 인용:
//   downscale 2048→512 wasm-vips-lanczos3 PSNR 27.26dB / SSIM 0.9887 (1위),
//   canvaskit-linear-nomips 25.31dB / 0.9834 (2위).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import {
  evaluateLicenseGate,
  wasmVipsPipelineDescriptor,
} from "@toonspectrum/studio-engine-registry";
import ts from "typescript";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  STUDIO_VIPS_EXPORT_ATTRIBUTION,
  STUDIO_VIPS_EXPORT_DEFAULT_LIMITS,
  STUDIO_VIPS_EXPORT_LICENSE,
  STUDIO_VIPS_EXPORT_MAX_INPUT_PIXELS,
  STUDIO_VIPS_EXPORT_MAX_PYRAMID_LEVELS,
  STUDIO_VIPS_EXPORT_PROVIDER_ID,
  STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX,
  STUDIO_VIPS_EXPORT_SINGLE_SURFACE_PIXELS,
  VipsUnavailableError,
  canHandleExport,
  downscaleForExport,
  exportPyramid,
  loadVipsForExport,
  planVipsExportRoute,
  resetStudioVipsExportRuntimeForTests,
  type StudioVipsExportRuntime,
} from "./studio-vips-export";

const moduleUrl = new URL("./studio-vips-export.ts", import.meta.url);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Quality Lab detailCardLuma 그대로(quality-lab.ts) — 비교 가능성을 위해 복제. */
function detailCardLuma(size: number): Float64Array {
  const card = new Float64Array(size * size);
  const scale = size / 512;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0.5 + 0.45 * (x / size);
      if (Math.floor(x / scale) % 8 === 0 || Math.floor(y / scale) % 8 === 0) {
        value = 0.08;
      }
      const dx = x - size * 0.7;
      const dy = y - size * 0.3;
      const radius = Math.hypot(dx, dy);
      if (Math.sin(radius / (1.5 * scale)) > 0.6) value = Math.min(value, 0.15);
      if ((x + y) % Math.round(11 * scale) < 1.2 * scale) value = 0.92;
      card[y * size + x] = value;
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

/** Quality Lab 기준 레퍼런스: float box-average(area) 축소 — 엔진 독립. */
function boxReduce(luma: Float64Array, src: number, dst: number): Float64Array {
  const factor = src / dst;
  const out = new Float64Array(dst * dst);
  for (let y = 0; y < dst; y += 1) {
    for (let x = 0; x < dst; x += 1) {
      let sum = 0;
      for (let sy = 0; sy < factor; sy += 1) {
        for (let sx = 0; sx < factor; sx += 1) {
          sum += luma[(y * factor + sy) * src + (x * factor + sx)] ?? 0;
        }
      }
      out[y * dst + x] = sum / (factor * factor);
    }
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

function psnr(a: Float64Array, b: Float64Array): number {
  let mse = 0;
  for (let index = 0; index < a.length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    mse += diff * diff;
  }
  mse /= a.length;
  if (mse === 0) return Infinity;
  return 10 * Math.log10(1 / mse);
}

/** Quality Lab meanSsim 그대로 — 비겹침 8×8 luma 창. */
function meanSsim(a: Float64Array, b: Float64Array, size: number): number {
  const window = 8;
  const c1 = 0.01 ** 2;
  const c2 = 0.03 ** 2;
  let total = 0;
  let count = 0;
  for (let by = 0; by + window <= size; by += window) {
    for (let bx = 0; bx + window <= size; bx += window) {
      let meanA = 0;
      let meanB = 0;
      for (let y = 0; y < window; y += 1) {
        for (let x = 0; x < window; x += 1) {
          meanA += a[(by + y) * size + (bx + x)] ?? 0;
          meanB += b[(by + y) * size + (bx + x)] ?? 0;
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
          const da = (a[(by + y) * size + (bx + x)] ?? 0) - meanA;
          const db = (b[(by + y) * size + (bx + x)] ?? 0) - meanB;
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
  return total / count;
}

function makeRgba(
  width: number,
  height: number,
  paint: (x: number, y: number) => readonly [number, number, number, number],
): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const offset = (y * width + x) * 4;
      out[offset] = r;
      out[offset + 1] = g;
      out[offset + 2] = b;
      out[offset + 3] = a;
    }
  }
  return out;
}

let runtime: StudioVipsExportRuntime;

beforeAll(async () => {
  resetStudioVipsExportRuntimeForTests();
  runtime = await loadVipsForExport();
}, 60_000);

afterEach(() => {
  resetStudioVipsExportRuntimeForTests();
});

describe("catalog parity (filter-providers descriptor)", () => {
  it("matches the wasm-vips-pipeline descriptor identity and capability set", () => {
    expect(STUDIO_VIPS_EXPORT_PROVIDER_ID).toBe(wasmVipsPipelineDescriptor.id);
    expect(STUDIO_VIPS_EXPORT_LICENSE).toBe(wasmVipsPipelineDescriptor.license);
    expect(STUDIO_VIPS_EXPORT_ATTRIBUTION).toBe(
      wasmVipsPipelineDescriptor.attribution,
    );
    expect(wasmVipsPipelineDescriptor.capabilities).toEqual(
      expect.arrayContaining([
        "filter.op.resize",
        "filter.op.pyramid",
        "filter.phase.final",
      ]),
    );
    // final/export 레인 전용 — preview capability 가 생기면 계약 위반.
    expect(wasmVipsPipelineDescriptor.capabilities).not.toContain(
      "filter.phase.preview",
    );
  });

  it("passes the license gate only in isolated mode (LGPL, never bundled)", () => {
    expect(evaluateLicenseGate(STUDIO_VIPS_EXPORT_LICENSE)).toEqual({
      mode: "isolated",
    });
  });

  it("loads wasm-vips through exactly one dynamic import and no static import", () => {
    const source = readFileSync(moduleUrl, "utf8");
    const file = ts.createSourceFile(
      moduleUrl.pathname,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const staticImports: string[] = [];
    const dynamicImports: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node)
        && ts.isStringLiteral(node.moduleSpecifier)
      ) {
        staticImports.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node)
        && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments.length === 1
      ) {
        const [specifier] = node.arguments;
        if (specifier !== undefined && ts.isStringLiteral(specifier)) {
          dynamicImports.push(specifier.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(staticImports).not.toContain("wasm-vips");
    expect(dynamicImports).toEqual(["wasm-vips"]);
  });
});

describe("loadVipsForExport", () => {
  const fakeVipsModule = {
    Image: { newFromMemory: () => ({}) },
    concurrency: () => undefined,
  };

  it("initializes once and shares the cached runtime across callers", async () => {
    resetStudioVipsExportRuntimeForTests();
    let importCount = 0;
    const importVips = (): Promise<unknown> => {
      importCount += 1;
      return Promise.resolve({
        default: () => Promise.resolve(fakeVipsModule),
      });
    };
    const [first, second] = await Promise.all([
      loadVipsForExport({ importVips }),
      loadVipsForExport({ importVips }),
    ]);
    const third = await loadVipsForExport({ importVips });
    expect(importCount).toBe(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("wraps import failure in VipsUnavailableError with the cause preserved", async () => {
    resetStudioVipsExportRuntimeForTests();
    const cause = new Error("network blocked");
    await expect(
      loadVipsForExport({ importVips: () => Promise.reject(cause) }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(VipsUnavailableError);
      expect((error as VipsUnavailableError).cause).toBe(cause);
      return true;
    });
  });

  it("clears the cache on failure so the next call retries the import", async () => {
    resetStudioVipsExportRuntimeForTests();
    let importCount = 0;
    const importVips = (): Promise<unknown> => {
      importCount += 1;
      return importCount === 1
        ? Promise.reject(new Error("first load fails"))
        : Promise.resolve({ default: () => Promise.resolve(fakeVipsModule) });
    };
    await expect(loadVipsForExport({ importVips })).rejects.toBeInstanceOf(
      VipsUnavailableError,
    );
    const recovered = await loadVipsForExport({ importVips });
    expect(importCount).toBe(2);
    expect(typeof recovered.vips.concurrency).toBe("function");
  });

  it("rejects modules without a default factory as VipsUnavailableError", async () => {
    resetStudioVipsExportRuntimeForTests();
    await expect(
      loadVipsForExport({ importVips: () => Promise.resolve({ default: 42 }) }),
    ).rejects.toBeInstanceOf(VipsUnavailableError);
  });

  it("rejects factories that resolve to a non-vips shape", async () => {
    resetStudioVipsExportRuntimeForTests();
    await expect(
      loadVipsForExport({
        importVips: () =>
          Promise.resolve({ default: () => Promise.resolve({ notVips: true }) }),
      }),
    ).rejects.toBeInstanceOf(VipsUnavailableError);
  });

  it("caches the real dynamic import on the default path", async () => {
    resetStudioVipsExportRuntimeForTests();
    const first = await loadVipsForExport();
    const second = await loadVipsForExport();
    expect(second).toBe(first);
    expect(typeof first.vips.Image.newFromMemory).toBe("function");
  }, 60_000);
});

describe("downscaleForExport", () => {
  it("is deterministic: identical bytes (sha256) across repeated runs", async () => {
    const size = 256;
    const source = lumaToRgba(detailCardLuma(size));
    const first = await downscaleForExport(source, size, size, 64, 64, { runtime });
    const second = await downscaleForExport(source, size, size, 64, 64, { runtime });
    expect(first.width).toBe(64);
    expect(first.height).toBe(64);
    expect(first.rgba.length).toBe(64 * 64 * 4);
    expect(sha256(first.rgba)).toBe(sha256(second.rgba));
  });

  it("reproduces the Quality Lab winner: 2048→512 PSNR/SSIM vs the box reference", async () => {
    // quality-lab.json 기록치: wasm-vips-lanczos3 27.26dB / 0.9887,
    // 차점 canvaskit-linear-nomips 25.31dB / 0.9834. 동일 카드·동일 레퍼런스로
    // 기록치 근방(±0.8dB 여유)과 차점 초과를 함께 고정한다.
    const src = 2048;
    const dst = 512;
    const sourceLuma = detailCardLuma(src);
    const referenceLuma = boxReduce(sourceLuma, src, dst);
    const result = await downscaleForExport(
      lumaToRgba(sourceLuma),
      src,
      src,
      dst,
      dst,
      { runtime },
    );
    const measuredPsnr = psnr(referenceLuma, rgbaToLuma(result.rgba));
    const measuredSsim = meanSsim(referenceLuma, rgbaToLuma(result.rgba), dst);
    expect(measuredPsnr).toBeGreaterThanOrEqual(26.5);
    expect(measuredPsnr).toBeGreaterThan(25.31);
    expect(measuredSsim).toBeGreaterThanOrEqual(0.985);
  }, 60_000);

  it("hits exact odd target dimensions (7x5→3x2, 5x5→1x1)", async () => {
    const odd = makeRgba(7, 5, (x, y) => [x * 30, y * 40, 128, 255]);
    const small = await downscaleForExport(odd, 7, 5, 3, 2, { runtime });
    expect(small.width).toBe(3);
    expect(small.height).toBe(2);
    expect(small.rgba.length).toBe(3 * 2 * 4);

    const uniform = makeRgba(5, 5, () => [200, 100, 50, 255]);
    const single = await downscaleForExport(uniform, 5, 5, 1, 1, { runtime });
    expect(single.width).toBe(1);
    expect(single.height).toBe(1);
    expect(Array.from(single.rgba)).toEqual([200, 100, 50, 255]);
  });

  it("returns a defensive copy for identity requests without touching vips", async () => {
    const poisoned = {
      vips: {
        Image: {
          newFromMemory: (): never => {
            throw new Error("identity path must not resample");
          },
        },
        concurrency: () => undefined,
      },
    } as unknown as StudioVipsExportRuntime;
    const source = makeRgba(1, 1, () => [9, 8, 7, 255]);
    const copy = await downscaleForExport(source, 1, 1, 1, 1, {
      runtime: poisoned,
    });
    expect(Array.from(copy.rgba)).toEqual([9, 8, 7, 255]);
    expect(copy.rgba).not.toBe(source);
    copy.rgba[0] = 0;
    expect(source[0]).toBe(9);
  });

  it("rejects upscale requests — this is a downscale-only lane", async () => {
    const source = makeRgba(4, 4, () => [1, 2, 3, 255]);
    await expect(
      downscaleForExport(source, 4, 4, 8, 4, { runtime }),
    ).rejects.toThrow(RangeError);
    await expect(
      downscaleForExport(source, 4, 4, 4, 0, { runtime }),
    ).rejects.toThrow(RangeError);
  });

  it("rejects malformed source buffers loudly", async () => {
    await expect(
      downscaleForExport(new Uint8Array(15), 2, 2, 1, 1, { runtime }),
    ).rejects.toThrow(RangeError);
    await expect(
      downscaleForExport(
        [] as unknown as Uint8Array,
        2,
        2,
        1,
        1,
        { runtime },
      ),
    ).rejects.toThrow(TypeError);
  });

  it("keeps premultiplied alpha edges clean (no transparent-color fringe)", async () => {
    // 왼쪽 절반 불투명 빨강, 오른쪽 절반 완전투명 초록. 프리멀티플라이 없이
    // 섞으면 경계 픽셀에 초록이 절반 수준(≈127)으로 번진다 — vips resize 는
    // 알파를 프리멀티플라이해 경계의 초록 오염이 잔물결 수준에 머문다.
    const source = makeRgba(8, 8, (x) =>
      x < 4 ? [255, 0, 0, 255] : [0, 255, 0, 0],
    );
    const result = await downscaleForExport(source, 8, 8, 4, 4, { runtime });
    const boundary = result.rgba.slice(4, 8); // row 0, x=1 (불투명 쪽 경계)
    expect(boundary[3] ?? 0).toBeGreaterThan(200);
    expect(boundary[1] ?? 0).toBeLessThan(40);
  });
});

describe("exportPyramid", () => {
  it("builds floor-halved lanczos3 levels deterministically", async () => {
    const source = lumaToRgba(detailCardLuma(64)).slice(0, 64 * 48 * 4);
    const first = await exportPyramid(source, 64, 48, 5, { runtime });
    const second = await exportPyramid(source, 64, 48, 5, { runtime });
    expect(
      first.map((level) => [level.level, level.width, level.height]),
    ).toEqual([
      [1, 32, 24],
      [2, 16, 12],
      [3, 8, 6],
      [4, 4, 3],
      [5, 2, 1],
    ]);
    for (const [index, level] of first.entries()) {
      expect(level.rgba.length).toBe(level.width * level.height * 4);
      expect(sha256(level.rgba)).toBe(sha256(second[index]?.rgba ?? new Uint8Array()));
    }
  });

  it("clamps the short edge at 1 and truncates once both edges reach 1", async () => {
    const source = makeRgba(64, 4, (x, y) => [x * 4, y * 60, 0, 255]);
    const pyramid = await exportPyramid(
      source,
      64,
      4,
      STUDIO_VIPS_EXPORT_MAX_PYRAMID_LEVELS,
      { runtime },
    );
    expect(
      pyramid.map((level) => [level.level, level.width, level.height]),
    ).toEqual([
      [1, 32, 2],
      [2, 16, 1],
      [3, 8, 1],
      [4, 4, 1],
      [5, 2, 1],
      [6, 1, 1],
    ]);
  });

  it("returns an empty pyramid for a 1x1 source", async () => {
    const source = makeRgba(1, 1, () => [10, 20, 30, 255]);
    await expect(exportPyramid(source, 1, 1, 4, { runtime })).resolves.toEqual([]);
  });

  it("validates the requested level count", async () => {
    const source = makeRgba(2, 2, () => [0, 0, 0, 255]);
    await expect(exportPyramid(source, 2, 2, 0, { runtime })).rejects.toThrow(
      RangeError,
    );
    await expect(
      exportPyramid(
        source,
        2,
        2,
        STUDIO_VIPS_EXPORT_MAX_PYRAMID_LEVELS + 1,
        { runtime },
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe("canHandleExport / planVipsExportRoute", () => {
  it("keeps single in-core surfaces on canvaskit up to 8192px edges", () => {
    expect(canHandleExport(8192, 8192)).toBe(false);
    expect(planVipsExportRoute(8192, 8192).route).toBe("canvas2d");
    expect(planVipsExportRoute(1, 1).route).toBe("canvas2d");
  });

  it("owns exports past the in-core edge budget up to the 16384^2 input cap", () => {
    expect(canHandleExport(8193, 1)).toBe(true);
    expect(canHandleExport(1, 8193)).toBe(true);
    // 웹툰 세로 스크롤 대표형: 2048×30720 = 62.9M px, 한 변이 8192 초과.
    expect(canHandleExport(2048, 30_720)).toBe(true);
    // 입력 상한 경계: 16384² 는 정확히 캡이라 아직 vips 소유.
    expect(canHandleExport(16_384, 16_384)).toBe(true);
  });

  it("routes past the 1GiB RGBA input cap to the out-of-core provider", () => {
    const route = planVipsExportRoute(16_385, 16_384);
    expect(route.route).toBe("out-of-core");
    expect(route.reason).toContain("out-of-core");
    expect(canHandleExport(16_385, 16_384)).toBe(false);
  });

  it("honors the area budget independently when custom limits raise the edge", () => {
    const limits = {
      singleSurfaceEdgePx: 16_384,
      singleSurfacePixels: STUDIO_VIPS_EXPORT_SINGLE_SURFACE_PIXELS,
      maxInputPixels: STUDIO_VIPS_EXPORT_MAX_INPUT_PIXELS,
    };
    // 16000×5000 = 80M px — 양 변 모두 상향된 edge 한도 안이지만 면적 예산 초과.
    expect(canHandleExport(16_000, 5000, limits)).toBe(true);
    expect(planVipsExportRoute(16_000, 5000, limits).route).toBe("vips");
  });

  it("documents the default threshold provenance as invariants", () => {
    // edge 8192(WebGL 텍스처 보수 기준선)와 면적 8192²는
    // out-of-core 예산 maxTileRenderPixels(67,108,864)와 같은 축이어야 한다.
    expect(STUDIO_VIPS_EXPORT_SINGLE_SURFACE_PIXELS).toBe(
      STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX ** 2,
    );
    // 입력 캡 16384² = studio-export.ts MAX_CANVAS_DIM 의 제곱(1GiB RGBA).
    expect(STUDIO_VIPS_EXPORT_MAX_INPUT_PIXELS).toBe(16_384 ** 2);
    expect(STUDIO_VIPS_EXPORT_DEFAULT_LIMITS).toEqual({
      singleSurfaceEdgePx: STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX,
      singleSurfacePixels: STUDIO_VIPS_EXPORT_SINGLE_SURFACE_PIXELS,
      maxInputPixels: STUDIO_VIPS_EXPORT_MAX_INPUT_PIXELS,
    });
  });
});
