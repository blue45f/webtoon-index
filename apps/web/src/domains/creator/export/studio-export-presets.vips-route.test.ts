// wasm-vips 대형 캔버스 내보내기 컷오버 계약 — exportPresetSlices 실배선 검증.
//
// 계약(웨이브 A-④):
// 1) 라우팅 경계: 인코어 표면 예산(8192 edge / 8192² area) 이하 페이지는 vips 를
//    전혀 건드리지 않는다(pristine — 기존 drawImage 경로 바이트 불변).
// 2) 예산 초과(그리고 규격 폭 < 원본 폭) 페이지만 wasm-vips lanczos3 로 선축소해
//    슬라이스 합성이 1:1 blit 이 되게 한다.
// 3) vips/out-of-core가 선택된 뒤 실패하면 다운로드 전 중단하고 다른 provider로 재실행하지 않는다.
// 4) 품질 게이트: 실 wasm-vips 로 quality-lab 기준(2048→512 PSNR>25.31dB
//    canvaskit-linear 기록치)을 컷오버 경로 그대로 재현한다.
import { describe, expect, it, vi } from "vitest";

import {
  PresetVipsUnavailableError,
  exportPresetSlices,
  findExportPreset,
  planPresetSliceExport,
  prepareVipsRoutedPresetPages,
  presetExportResultMessage,
  type ExportPreset,
  type PresetSliceExportOptions,
} from "./studio-export-presets";
import {
  STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX,
  loadVipsForExport,
  type StudioVipsExportLimits,
  type StudioVipsExportRuntime,
  type StudioVipsRaster,
} from "./studio-vips-export";


const naver = findExportPreset("naver-challenge") as ExportPreset;
const EDGE = STUDIO_VIPS_EXPORT_SINGLE_SURFACE_EDGE_PX; // 8192

// ── 테스트 더블: 기존 studio-export-presets.test.ts 의 FakeCanvas 패턴 재사용 ──

class FakeContext2D {
  fillStyle: unknown = "";
  imageSmoothingEnabled = false;
  imageSmoothingQuality = "low";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  lineJoin = "";
  lineWidth = 0;
  strokeStyle: unknown = "";
  drawImages: {
    image: unknown;
    srcY: number;
    srcHeight: number;
    destY: number;
    destHeight: number;
  }[] = [];

  fillRect(): void {}

  drawImage(
    image: unknown,
    _sx: number,
    sy: number,
    _sw: number,
    sh: number,
    _dx: number,
    dy: number,
    _dw: number,
    dh: number
  ): void {
    this.drawImages.push({ image, srcY: sy, srcHeight: sh, destY: dy, destHeight: dh });
  }

  save(): void {}
  restore(): void {}
  strokeText(): void {}
  fillText(): void {}
}

class FakeCanvas {
  ctx = new FakeContext2D();

  constructor(
    public width: number,
    public height: number,
    /** blob 내용 재현성 — 같은 그리기 입력이면 같은 바이트(pristine 비교용). */
    public tag = "page"
  ) {}

  getContext(_type: string): FakeContext2D {
    return this.ctx;
  }

  toBlob(callback: (blob: Blob | null) => void, type = "image/png"): void {
    // 그려진 op 목록을 그대로 인코딩 — drawImage 입력이 곧 출력 바이트가 된다.
    const payload = JSON.stringify({
      width: this.width,
      height: this.height,
      ops: this.ctx.drawImages.map((op) => ({
        page: (op.image as FakeCanvas).tag,
        srcY: op.srcY,
        srcHeight: op.srcHeight,
        destY: op.destY,
        destHeight: op.destHeight,
      })),
    });
    const prefix = type === "image/jpeg"
      ? Uint8Array.of(0xff, 0xd8, 0xff)
      : type === "image/webp"
        ? new TextEncoder().encode("RIFF0000WEBP")
        : Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    callback(new Blob([prefix, payload], { type }));
  }
}

const asCanvas = (fake: FakeCanvas) => fake as unknown as HTMLCanvasElement;

/** 정확한 목표 크기를 돌려주는 가짜 vips 런타임 — resize 호출을 기록한다. */
function fakeVipsRuntime(log?: { resizes: { from: number[]; to: number[] }[] }): StudioVipsExportRuntime {
  const makeHandle = (width: number, height: number): Record<string, unknown> => ({
    width,
    height,
    resize(hscale: number, resizeOptions?: { vscale?: number }) {
      const nextWidth = Math.round(width * hscale);
      const nextHeight = Math.round(height * (resizeOptions?.vscale ?? hscale));
      log?.resizes.push({ from: [width, height], to: [nextWidth, nextHeight] });
      return makeHandle(nextWidth, nextHeight);
    },
    writeToMemory() {
      return new Uint8Array(width * height * 4).fill(7);
    },
    delete() {},
  });
  return {
    vips: {
      Image: {
        newFromMemory: (_data: Uint8Array, width: number, height: number) => makeHandle(width, height),
      },
      concurrency: () => undefined,
    },
  } as unknown as StudioVipsExportRuntime;
}

/** vips 훅이 절대 호출되면 안 되는(pristine) 주입 세트. */
function poisonedVipsDeps(): Pick<
  PresetSliceExportOptions,
  "loadVipsRuntime" | "readPageRgba" | "createResampledPage"
> {
  return {
    loadVipsRuntime: () => {
      throw new Error("pristine 경로에서 vips 런타임을 로드하면 안 됩니다.");
    },
    readPageRgba: () => {
      throw new Error("pristine 경로에서 페이지 픽셀을 읽으면 안 됩니다.");
    },
    createResampledPage: () => {
      throw new Error("pristine 경로에서 리샘플 캔버스를 만들면 안 됩니다.");
    },
  };
}

function makeRgba(width: number, height: number, fill = 128): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  for (let index = 0; index < out.length; index += 4) {
    out[index] = fill;
    out[index + 1] = fill;
    out[index + 2] = fill;
    out[index + 3] = 255;
  }
  return out;
}

interface RunOptions {
  pages: FakeCanvas[];
  preset?: ExportPreset;
  extra?: Partial<PresetSliceExportOptions>;
}

async function runPresetExport({ pages, preset = naver, extra = {} }: RunOptions) {
  const created: FakeCanvas[] = [];
  const downloads: { name: string; bytes: Promise<string> }[] = [];
  const result = await exportPresetSlices({
    pages: pages.map(asCanvas),
    preset,
    format: "jpg",
    title: "컷오버",
    delayMs: 0,
    createCanvas: (w, h) => {
      const fake = new FakeCanvas(w, h, "slice");
      created.push(fake);
      return asCanvas(fake);
    },
    download: (blob, name) => downloads.push({ name, bytes: blob.text() }),
    ...extra,
  });
  return { result, created, downloads };
}

// ─────────────────────────── 라우팅 경계(8192±1) ───────────────────────────

describe("vips 라우팅 경계 — exportPresetSlices 실배선", () => {
  it(`${EDGE - 1}px edge(예산 -1)는 기존 경로 — vips 훅이 전혀 호출되지 않는다`, async () => {
    const { result } = await runPresetExport({
      pages: [new FakeCanvas(720, EDGE - 1)],
      extra: poisonedVipsDeps(),
    });
    expect(result.vipsRoutedPages).toBeUndefined();
  });

  it(`${EDGE}px edge(예산 경계 포함)도 기존 경로다`, async () => {
    const { result } = await runPresetExport({
      pages: [new FakeCanvas(720, EDGE)],
      extra: poisonedVipsDeps(),
    });
    expect(result.vipsRoutedPages).toBeUndefined();
  });

  it(`${EDGE + 1}px edge(예산 +1)는 vips 레인으로 라우팅된다`, async () => {
    const log = { resizes: [] as { from: number[]; to: number[] }[] };
    const resampled: StudioVipsRaster[] = [];
    const { result } = await runPresetExport({
      pages: [new FakeCanvas(720, EDGE + 1)],
      extra: {
        loadVipsRuntime: () => Promise.resolve(fakeVipsRuntime(log)),
        readPageRgba: (page) => makeRgba(page.width, page.height),
        createResampledPage: (raster) => {
          resampled.push(raster);
          return asCanvas(new FakeCanvas(raster.width, raster.height, "vips"));
        },
      },
    });
    expect(result.vipsRoutedPages).toBe(1);
    // 목표 크기 = 슬라이스 계획과 동일한 반올림: round(8193×690/720) = 7852.
    expect(log.resizes).toEqual([{ from: [720, EDGE + 1], to: [690, 7852] }]);
    expect(resampled[0]).toMatchObject({ width: 690, height: 7852 });
  });

  it("면적 예산(edge² 초과)도 독립적으로 vips 라우팅을 일으킨다(주입 한계)", async () => {
    // edge 한계는 넉넉히 올리고 면적만 좁힌 커스텀 예산 — 면적 규칙 배선 증명.
    const limits: StudioVipsExportLimits = {
      singleSurfaceEdgePx: 100_000,
      singleSurfacePixels: 1_000_000, // 1000²
      maxInputPixels: 268_435_456,
    };
    const log = { resizes: [] as { from: number[]; to: number[] }[] };
    const { result } = await runPresetExport({
      pages: [new FakeCanvas(720, 1_500)], // 1.08M px > 1M
      extra: {
        vipsLimits: limits,
        loadVipsRuntime: () => Promise.resolve(fakeVipsRuntime(log)),
        readPageRgba: (page) => makeRgba(page.width, page.height),
        createResampledPage: (raster) => asCanvas(new FakeCanvas(raster.width, raster.height, "vips")),
      },
    });
    expect(result.vipsRoutedPages).toBe(1);
    expect(log.resizes).toHaveLength(1);
  });
});

// ────────────────────────────── pristine 계약 ──────────────────────────────

describe("pristine 계약 — 예산 이하 문서는 바이트 불변", () => {
  it("동일 입력의 저장 바이트가 vips 주입 여부와 무관하게 완전히 같다", async () => {
    const makePages = () => [new FakeCanvas(720, 1280, "p0"), new FakeCanvas(720, 1280, "p1")];
    // 기준 실행: 컷오버 훅 없이(기본 경로 그대로 — 라우팅 대상 없음 → 훅 미사용).
    const baseline = await runPresetExport({ pages: makePages() });
    // 비교 실행: vips 훅을 독약으로 주입 — 호출되면 throw 로 즉시 실패한다.
    const guarded = await runPresetExport({ pages: makePages(), extra: poisonedVipsDeps() });

    const baselineBytes = await Promise.all(baseline.downloads.map((d) => d.bytes));
    const guardedBytes = await Promise.all(guarded.downloads.map((d) => d.bytes));
    expect(guardedBytes).toEqual(baselineBytes);
    expect(baseline.downloads.map((d) => d.name)).toEqual(guarded.downloads.map((d) => d.name));
    // 결과 shape 도 기존 그대로 — 새 키가 존재하지 않는다.
    expect("vipsRoutedPages" in guarded.result).toBe(false);
  });

  it("라우팅된 페이지의 슬라이스 합성은 1:1 blit(리샘플 결과가 화질을 소유)", async () => {
    const vipsPage = new FakeCanvas(0, 0, "vips"); // 크기는 아래에서 채움
    const { created } = await runPresetExport({
      pages: [new FakeCanvas(720, EDGE + 8)],
      extra: {
        loadVipsRuntime: () => Promise.resolve(fakeVipsRuntime()),
        readPageRgba: (page) => makeRgba(page.width, page.height),
        createResampledPage: (raster) => {
          vipsPage.width = raster.width;
          vipsPage.height = raster.height;
          return asCanvas(vipsPage);
        },
      },
    });
    // 모든 슬라이스 drawImage 가 리샘플 캔버스를 소스로, 비율 1(src==dest 높이)로 그린다.
    const ops = created.flatMap((slice) => slice.ctx.drawImages);
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.image).toBe(vipsPage);
      expect(op.srcHeight).toBe(op.destHeight);
    }
  });
});

// ─────────────────────────────── fail-closed ───────────────────────────────

describe("vips exact provider — 실패 시 다운로드 전에 중단", () => {
  it("vips 로드 실패 시 Canvas2D로 재실행하지 않고 다운로드하지 않는다", async () => {
    const download = vi.fn();
    const failure = await runPresetExport({
      pages: [new FakeCanvas(720, EDGE + 1)],
      extra: {
        loadVipsRuntime: () => Promise.reject(new Error("wasm import blocked")),
        download,
      },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PresetVipsUnavailableError);
    expect(failure).toMatchObject({
      name: "PresetVipsUnavailableError",
      stage: "load",
      pageIndex: null,
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("첫 페이지 리샘플 실패 시 뒤 페이지를 처리하거나 다운로드하지 않는다", async () => {
    let call = 0;
    const runtime = {
      vips: {
        Image: {
          newFromMemory: (_data: Uint8Array, width: number, height: number) => {
            call += 1;
            if (call === 1) throw new Error("첫 페이지 리샘플 실패");
            return (fakeVipsRuntime().vips.Image as {
              newFromMemory: (d: Uint8Array, w: number, h: number, b: number, f: string) => unknown;
            }).newFromMemory(_data, width, height, 4, "uchar");
          },
        },
        concurrency: () => undefined,
      },
    } as unknown as StudioVipsExportRuntime;
    const download = vi.fn();
    await expect(runPresetExport({
      pages: [new FakeCanvas(720, EDGE + 1, "a"), new FakeCanvas(720, EDGE + 2, "b")],
      extra: {
        loadVipsRuntime: () => Promise.resolve(runtime),
        readPageRgba: (page) => makeRgba(page.width, page.height),
        createResampledPage: (raster) => asCanvas(new FakeCanvas(raster.width, raster.height, "vips")),
        download,
      },
    })).rejects.toMatchObject({
      name: "PresetVipsUnavailableError",
      stage: "resample",
      pageIndex: 0,
    });
    expect(call).toBe(1);
    expect(download).not.toHaveBeenCalled();
  });

  it("페이지 픽셀을 읽을 수 없으면 다른 provider로 재실행하지 않는다", async () => {
    const download = vi.fn();
    await expect(runPresetExport({
      pages: [new FakeCanvas(720, EDGE + 1)],
      extra: {
        loadVipsRuntime: () => Promise.resolve(fakeVipsRuntime()),
        readPageRgba: () => null,
        download,
      },
    })).rejects.toMatchObject({
      name: "PresetVipsUnavailableError",
      stage: "read",
      pageIndex: 0,
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("vips 결과 표면을 만들 수 없으면 다운로드하지 않는다", async () => {
    const download = vi.fn();
    await expect(runPresetExport({
      pages: [new FakeCanvas(720, EDGE + 1)],
      extra: {
        loadVipsRuntime: () => Promise.resolve(fakeVipsRuntime()),
        readPageRgba: (page) => makeRgba(page.width, page.height),
        createResampledPage: () => null,
        download,
      },
    })).rejects.toMatchObject({
      name: "PresetVipsUnavailableError",
      stage: "materialize",
      pageIndex: 0,
    });
    expect(download).not.toHaveBeenCalled();
  });

  it("단일 처리 한계(16384²px) 초과 페이지는 타일 provider 필요 상태로 중단한다", async () => {
    // 16385×16384 = maxInputPixels + 16384 → out-of-core 라우트.
    const loadVipsRuntime = vi.fn();
    const readPageRgba = vi.fn();
    const createResampledPage = vi.fn();
    const download = vi.fn();
    await expect(runPresetExport({
      pages: [new FakeCanvas(16_385, 16_384)],
      extra: { loadVipsRuntime, readPageRgba, createResampledPage, download },
    })).rejects.toMatchObject({
      name: "PresetVipsUnavailableError",
      stage: "out-of-core",
      pageIndex: 0,
    });
    expect(loadVipsRuntime).not.toHaveBeenCalled();
    expect(readPageRgba).not.toHaveBeenCalled();
    expect(createResampledPage).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("규격 폭이 원본 폭 이상이면(업스케일) vips 레인을 쓰지 않는다 — 다운스케일 전용", async () => {
    // 원본 유지 프리셋: targetWidth = 첫 페이지 폭. 두 번째 페이지(좁고 김)는
    // edge 초과지만 targetWidth(900) > sourceWidth(690) → 기존 경로 유지, 경고 없음.
    const original = findExportPreset("original") as ExportPreset;
    const { result } = await runPresetExport({
      pages: [new FakeCanvas(900, 1_000, "wide"), new FakeCanvas(690, EDGE + 1, "tall")],
      preset: original,
      extra: poisonedVipsDeps(),
    });
    expect(result.vipsRoutedPages).toBeUndefined();
  });
});

// ─────────────────────────── 결과 메시지 표면화 ───────────────────────────

describe("presetExportResultMessage — vips 레인 안내", () => {
  it("라우팅된 페이지 수를 한글로 안내한다", () => {
    const message = presetExportResultMessage(
      { files: 3, oversized: 0, format: "jpg", targetWidth: 690, vipsRoutedPages: 2 },
      naver
    );
    expect(message).toContain("고해상 페이지 2장은 고품질 축소(wasm-vips)로 저장했어요.");
  });

});

// ─────────────────────── 품질 게이트(실 wasm-vips 런타임) ───────────────────────

/** quality-lab detailCardLuma 그대로 — 컷오버 경로 품질을 같은 기준으로 잰다. */
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

describe("품질 게이트 — 컷오버 경로가 quality-lab 승자 품질을 그대로 전달한다", () => {
  it("2048² 페이지를 규격 폭 512로: PSNR > canvaskit-linear 기록치(25.31dB)", async () => {
    const src = 2048;
    const dst = 512;
    const sourceLuma = detailCardLuma(src);
    // 커스텀 예산으로 2048² 를 vips 라우트로 강제 — 실제 8K+ 경로와 동일 코드가 돈다.
    const limits: StudioVipsExportLimits = {
      singleSurfaceEdgePx: 1024,
      singleSurfacePixels: 1024 * 1024,
      maxInputPixels: 268_435_456,
    };
    const preset: ExportPreset = {
      id: "quality-gate",
      label: "품질 게이트",
      platform: "테스트",
      width: dst,
      allowedFormats: ["png"],
      recommendedFormat: "png",
      note: "quality-lab 재현",
    };
    const plan = planPresetSliceExport([{ width: src, height: src }], preset, "png");
    expect(plan).not.toBeNull();
    if (!plan) return;
    const runtime = await loadVipsForExport();
    const rasters: StudioVipsRaster[] = [];
    const prepared = await prepareVipsRoutedPresetPages(
      [asCanvas(new FakeCanvas(src, src))],
      plan,
      {
        vipsLimits: limits,
        loadVipsRuntime: () => Promise.resolve(runtime),
        readPageRgba: () => lumaToRgba(sourceLuma),
        createResampledPage: (raster) => {
          rasters.push(raster);
          return asCanvas(new FakeCanvas(raster.width, raster.height, "vips"));
        },
      }
    );
    expect(prepared.vipsRoutedPages).toBe(1);
    const raster = rasters[0];
    expect(raster).toBeDefined();
    if (!raster) return;
    expect(raster.width).toBe(dst);
    expect(raster.height).toBe(dst);
    const reference = boxReduce(sourceLuma, src, dst);
    const measured = psnr(
      reference,
      (() => {
        const luma = new Float64Array(raster.rgba.length / 4);
        for (let index = 0; index < luma.length; index += 1) {
          luma[index] = (raster.rgba[index * 4] ?? 0) / 255;
        }
        return luma;
      })()
    );
    // quality-lab.json: wasm-vips-lanczos3 27.26dB, canvaskit-linear-nomips 25.31dB.
    expect(measured).toBeGreaterThan(25.31);
    expect(measured).toBeGreaterThanOrEqual(26.5);
  }, 60_000);
});
