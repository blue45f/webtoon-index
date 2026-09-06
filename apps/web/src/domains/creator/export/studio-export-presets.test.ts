import { describe, it, expect } from "vitest";

import { MAX_CANVAS_DIM } from "./studio-export";
import {
  EXPORT_PRESETS,
  exportPresetSlices,
  findExportPreset,
  planPresetSliceExport,
  planSliceDrawOps,
  planStripSlices,
  presetExportResultMessage,
  presetSliceFileName,
  recommendScale,
  resolvePresetFormat,
  validateExport,
  type ExportPreset,
  type PresetPageLayout,
} from "./studio-export-presets";

const naver = findExportPreset("naver-challenge") as ExportPreset;
const canvas = findExportPreset("webtoon-canvas") as ExportPreset;
const lezhin = findExportPreset("lezhin") as ExportPreset;
const original = findExportPreset("original") as ExportPreset;

describe("EXPORT_PRESETS 데이터", () => {
  it("프리셋 id는 유일하다", () => {
    const ids = EXPORT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("권장 포맷은 허용 포맷에 포함된다", () => {
    for (const p of EXPORT_PRESETS) {
      expect(p.allowedFormats).toContain(p.recommendedFormat);
      expect(p.allowedFormats.length).toBeGreaterThan(0);
    }
  });

  it("네이버 도전만화는 JPG 전용·690폭·5MB 제한", () => {
    expect(naver.width).toBe(690);
    expect(naver.allowedFormats).toEqual(["jpg"]);
    expect(naver.maxFileBytes).toBe(5 * 1024 * 1024);
    expect(naver.maxImageHeight).toBe(1280);
  });

  it("원본 고해상도는 폭 0(원본 유지)·모든 포맷 허용", () => {
    expect(original.width).toBe(0);
    expect(original.allowedFormats).toEqual(["png", "jpg", "webp"]);
  });

  it("findExportPreset은 없는 id에 undefined", () => {
    expect(findExportPreset("nope")).toBeUndefined();
  });
});

describe("planStripSlices", () => {
  it("균등 분할", () => {
    expect(planStripSlices(2560, 1280)).toEqual([
      { index: 0, y: 0, height: 1280 },
      { index: 1, y: 1280, height: 1280 },
    ]);
  });

  it("나머지가 있으면 마지막 칸이 더 짧다", () => {
    const slices = planStripSlices(3000, 1280);
    expect(slices).toHaveLength(3);
    expect(slices[2]).toEqual({ index: 2, y: 2560, height: 440 });
    // 슬라이스 높이 합 = 전체 높이
    expect(slices.reduce((s, x) => s + x.height, 0)).toBe(3000);
  });

  it("한 장에 들어가면 슬라이스 1개", () => {
    expect(planStripSlices(800, 1280)).toEqual([{ index: 0, y: 0, height: 800 }]);
  });

  it("0/음수 입력은 []", () => {
    expect(planStripSlices(0, 1280)).toEqual([]);
    expect(planStripSlices(2000, 0)).toEqual([]);
    expect(planStripSlices(-100, 1280)).toEqual([]);
    expect(planStripSlices(2000, -5)).toEqual([]);
  });
});

describe("recommendScale", () => {
  it("폭 변환 없음(원본) 또는 잘못된 캔버스폭은 1", () => {
    expect(recommendScale(720, original)).toBe(1);
    expect(recommendScale(0, naver)).toBe(1);
    expect(recommendScale(-10, naver)).toBe(1);
  });

  it("캔버스 720 → 네이버 690 ≈ 0.96", () => {
    expect(recommendScale(720, naver)).toBeCloseTo(0.96, 2);
  });

  it("추천 배율을 적용하면 플랫폼 권장 폭에 맞는 출력 픽셀이 된다", () => {
    expect(Math.round(720 * recommendScale(720, naver))).toBe(naver.width);
    expect(Math.round(720 * recommendScale(720, canvas))).toBe(canvas.width);
  });

  it("캔버스 720 → 웹툰 캔버스 800 ≈ 1.11", () => {
    expect(recommendScale(720, canvas)).toBeCloseTo(1.11, 2);
  });

  it("아주 작은 캔버스폭은 상한 4로 클램프", () => {
    expect(recommendScale(10, canvas)).toBe(4);
  });

  it("아주 큰 캔버스폭은 하한 0.25로 클램프", () => {
    expect(recommendScale(10000, naver)).toBe(0.25);
  });
});

describe("validateExport", () => {
  it("규격을 모두 만족하면 ok:true·경고 없음", () => {
    const r = validateExport({ width: 690, height: 1280, format: "jpg", bytes: 1_000_000 }, naver);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("허용되지 않은 포맷은 format 경고(PNG→네이버)", () => {
    const r = validateExport({ width: 690, height: 1000, format: "png" }, naver);
    expect(r.ok).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("format");
  });

  it("최대 높이 초과는 height 경고", () => {
    const r = validateExport({ width: 690, height: 4000, format: "jpg" }, naver);
    expect(r.warnings.map((w) => w.code)).toContain("height");
  });

  it("최대 용량 초과는 filesize 경고", () => {
    const r = validateExport(
      { width: 690, height: 1000, format: "jpg", bytes: 6 * 1024 * 1024 },
      naver
    );
    expect(r.warnings.map((w) => w.code)).toContain("filesize");
  });

  it("폭이 권장 폭과 다르면 width 경고", () => {
    const r = validateExport({ width: 720, height: 1000, format: "jpg" }, naver);
    expect(r.warnings.map((w) => w.code)).toContain("width");
  });

  it("폭 0(원본)은 width 경고를 내지 않는다", () => {
    const r = validateExport({ width: 1234, height: 500, format: "png" }, original);
    expect(r.warnings.map((w) => w.code)).not.toContain("width");
  });

  it("용량 정보가 없으면 filesize 경고는 건너뛴다", () => {
    const r = validateExport({ width: 690, height: 1000, format: "jpg" }, naver);
    expect(r.warnings.map((w) => w.code)).not.toContain("filesize");
  });
});

describe("resolvePresetFormat", () => {
  it("허용 포맷이면 그대로 둔다", () => {
    expect(resolvePresetFormat(naver, "jpg")).toBe("jpg");
    expect(resolvePresetFormat(canvas, "png")).toBe("png");
  });

  it("허용하지 않는 포맷은 권장 포맷으로 강제한다(네이버 PNG→JPG)", () => {
    expect(resolvePresetFormat(naver, "png")).toBe("jpg");
    expect(resolvePresetFormat(canvas, "webp")).toBe("jpg");
  });
});

describe("planPresetSliceExport", () => {
  it("한 페이지를 규격 폭으로 리샘플해 규격 높이 단위로 자른다(네이버 720×2560)", () => {
    const plan = planPresetSliceExport([{ width: 720, height: 2560 }], naver, "png");
    expect(plan).not.toBeNull();
    // 690/720 리샘플: round(2560×690/720)=2453 → 1280 + 1173 두 장.
    expect(plan?.targetWidth).toBe(690);
    expect(plan?.totalHeight).toBe(2453);
    expect(plan?.sliceHeight).toBe(1280);
    expect(plan?.format).toBe("jpg"); // 네이버는 JPG 전용 — 포맷 강제
    expect(plan?.slices).toEqual([
      { index: 0, y: 0, height: 1280 },
      { index: 1, y: 1280, height: 1173 },
    ]);
    expect(plan?.pages).toEqual([{ y: 0, height: 2453, sourceWidth: 720, sourceHeight: 2560 }]);
  });

  it("여러 페이지는 간격 0으로 이어 붙인다", () => {
    const plan = planPresetSliceExport(
      [
        { width: 720, height: 1280 },
        { width: 720, height: 1280 },
      ],
      naver,
      "jpg"
    );
    // 페이지당 round(1280×690/720)=1227 → 총 2454.
    expect(plan?.pages.map((p) => p.y)).toEqual([0, 1227]);
    expect(plan?.totalHeight).toBe(2454);
    expect(plan?.slices.map((s) => s.height)).toEqual([1280, 1174]);
  });

  it("원본 유지(width 0)는 첫 페이지 폭을 쓰고 캔버스 한계로만 자른다", () => {
    const plan = planPresetSliceExport([{ width: 1440, height: 2000 }], original, "png");
    expect(plan?.targetWidth).toBe(1440);
    expect(plan?.sliceHeight).toBe(MAX_CANVAS_DIM);
    expect(plan?.slices).toEqual([{ index: 0, y: 0, height: 2000 }]);
    expect(plan?.format).toBe("png");
  });

  it("최대 높이가 없는 프리셋(레진)도 캔버스 한계로 자른다", () => {
    const plan = planPresetSliceExport([{ width: 1440, height: 40000 }], lezhin, "jpg");
    expect(plan?.sliceHeight).toBe(MAX_CANVAS_DIM);
    expect(plan?.slices.length).toBe(Math.ceil(40000 / MAX_CANVAS_DIM));
  });

  it("규격 최대 높이가 캔버스 한계보다 크면 한계로 클램프한다", () => {
    const plan = planPresetSliceExport([{ width: 720, height: 10000 }], naver, "jpg", 1000);
    expect(plan?.sliceHeight).toBe(1000);
  });

  it("유효한 페이지가 없으면 null", () => {
    expect(planPresetSliceExport([], naver, "jpg")).toBeNull();
    expect(planPresetSliceExport([{ width: 0, height: 100 }], naver, "jpg")).toBeNull();
    expect(planPresetSliceExport([{ width: 100, height: -1 }], naver, "jpg")).toBeNull();
  });
});

describe("planSliceDrawOps", () => {
  // 페이지1은 원본이 2배 해상도(ratio 2), 페이지2는 1:1.
  const layout: PresetPageLayout[] = [
    { y: 0, height: 100, sourceWidth: 100, sourceHeight: 200 },
    { y: 100, height: 100, sourceWidth: 100, sourceHeight: 100 },
  ];

  it("슬라이스가 두 페이지에 걸치면 각 페이지 조각을 좌표 환산해 그린다", () => {
    const ops = planSliceDrawOps({ index: 0, y: 50, height: 100 }, layout);
    expect(ops).toEqual([
      { pageIndex: 0, srcY: 100, srcHeight: 100, destY: 0, destHeight: 50 },
      { pageIndex: 1, srcY: 0, srcHeight: 50, destY: 50, destHeight: 50 },
    ]);
  });

  it("겹치지 않는 페이지는 제외한다", () => {
    const ops = planSliceDrawOps({ index: 1, y: 150, height: 50 }, layout);
    expect(ops).toEqual([{ pageIndex: 1, srcY: 50, srcHeight: 50, destY: 0, destHeight: 50 }]);
  });

  it("슬라이스가 페이지 안에 완전히 들어가면 조각 하나", () => {
    const ops = planSliceDrawOps({ index: 0, y: 10, height: 20 }, layout);
    expect(ops).toEqual([{ pageIndex: 0, srcY: 20, srcHeight: 40, destY: 0, destHeight: 20 }]);
  });
});

describe("presetSliceFileName", () => {
  it("여러 장이면 -NofM 접미사", () => {
    expect(presetSliceFileName("내 만화", "naver-challenge", "jpg", { index: 0, total: 3 })).toBe(
      "내 만화-naver-challenge-1of3.jpg"
    );
    expect(presetSliceFileName("내 만화", "naver-challenge", "jpg", { index: 2, total: 3 })).toBe(
      "내 만화-naver-challenge-3of3.jpg"
    );
  });

  it("한 장이면 접미사 없음", () => {
    expect(presetSliceFileName("내 만화", "kakaopage", "png", { index: 0, total: 1 })).toBe("내 만화-kakaopage.png");
  });

  it("빈 제목은 기본 파일명으로", () => {
    expect(presetSliceFileName("  ", "webtoon-canvas", "png", { index: 0, total: 1 })).toBe(
      "toonspectrum-webtoon-webtoon-canvas.png"
    );
  });
});

describe("presetExportResultMessage", () => {
  it("성공 안내(폭·포맷·장수)", () => {
    const msg = presetExportResultMessage({ files: 2, oversized: 0, format: "jpg", targetWidth: 690 }, naver);
    expect(msg).toBe("폭 690px JPG 2장으로 저장했어요.");
  });

  it("용량 초과가 있으면 제한값과 함께 경고를 덧붙인다", () => {
    const msg = presetExportResultMessage({ files: 3, oversized: 1, format: "jpg", targetWidth: 690 }, naver);
    expect(msg).toContain("3장으로 저장했어요");
    expect(msg).toContain("1장은 5MB 제한을 넘어요");
  });

  it("용량 제한이 없는 프리셋은 초과 카운트가 있어도 경고를 만들지 않는다", () => {
    const msg = presetExportResultMessage({ files: 1, oversized: 1, format: "png", targetWidth: 800 }, canvas);
    expect(msg).toBe("폭 800px PNG 1장으로 저장했어요.");
  });
});

// ── exportPresetSlices — 브라우저 캔버스 없이 가짜 캔버스로 실행 흐름 검증 ──

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
  fillRects: number[][] = [];
  drawImages: { srcY: number; srcHeight: number; destY: number; destHeight: number; destWidth: number }[] = [];
  strokeTexts: string[] = [];
  fillTexts: string[] = [];

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push([x, y, w, h]);
  }

  drawImage(
    _image: unknown,
    _sx: number,
    sy: number,
    _sw: number,
    sh: number,
    _dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void {
    this.drawImages.push({ srcY: sy, srcHeight: sh, destY: dy, destHeight: dh, destWidth: dw });
  }

  save(): void {}
  restore(): void {}

  strokeText(text: string): void {
    this.strokeTexts.push(text);
  }

  fillText(text: string): void {
    this.fillTexts.push(text);
  }
}

class FakeCanvas {
  ctx = new FakeContext2D();

  constructor(
    public width: number,
    public height: number,
    private blobBytes = 8
  ) {}

  getContext(_type: string): FakeContext2D {
    return this.ctx;
  }

  toBlob(callback: (blob: Blob | null) => void, type = "image/png"): void {
    const prefix = type === "image/jpeg"
      ? Uint8Array.of(0xff, 0xd8, 0xff)
      : type === "image/webp"
        ? new TextEncoder().encode("RIFF0000WEBP")
        : Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    const bytes = new Uint8Array(Math.max(this.blobBytes, prefix.byteLength));
    bytes.set(prefix);
    callback(new Blob([bytes], { type }));
  }
}

const asCanvas = (fake: FakeCanvas) => fake as unknown as HTMLCanvasElement;

describe("exportPresetSlices", () => {
  it("두 페이지를 규격 폭으로 리샘플·분할 저장한다(포맷 강제·파일명·좌표·진행)", async () => {
    const pages = [new FakeCanvas(720, 1280), new FakeCanvas(720, 1280)];
    const created: FakeCanvas[] = [];
    const downloads: { name: string; size: number }[] = [];
    const progress: number[][] = [];

    const result = await exportPresetSlices({
      pages: pages.map(asCanvas),
      preset: naver,
      format: "png", // 네이버는 JPG 전용 → 강제 전환돼야 한다
      title: "내 만화",
      delayMs: 0,
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      download: (blob, name) => downloads.push({ name, size: blob.size }),
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(result).toEqual({ files: 2, oversized: 0, format: "jpg", targetWidth: 690 });
    expect(created.map((c) => [c.width, c.height])).toEqual([
      [690, 1280],
      [690, 1174],
    ]);
    expect(downloads.map((d) => d.name)).toEqual([
      "내 만화-naver-challenge-1of2.jpg",
      "내 만화-naver-challenge-2of2.jpg",
    ]);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
    // 첫 슬라이스: 흰 배경을 먼저 깔고, 페이지1 전체 + 페이지2 상단(경계 걸침)을 그린다.
    expect(created[0].ctx.fillRects[0]).toEqual([0, 0, 690, 1280]);
    expect(created[0].ctx.imageSmoothingQuality).toBe("high");
    expect(created[0].ctx.drawImages).toHaveLength(2);
    expect(created[0].ctx.drawImages[0]).toMatchObject({ destY: 0, destHeight: 1227, destWidth: 690 });
    expect(created[0].ctx.drawImages[1]).toMatchObject({ destY: 1227, destHeight: 53 });
    // 둘째 슬라이스: 페이지2의 나머지.
    expect(created[1].ctx.drawImages).toHaveLength(1);
    expect(created[1].ctx.drawImages[0]).toMatchObject({ destY: 0, destHeight: 1174 });
    // 워터마크 미지정 → 텍스트 그리기 없음.
    expect(created[0].ctx.strokeTexts).toEqual([]);
  });

  it("워터마크가 켜져 있으면 슬라이스마다 서명을 찍는다", async () => {
    const created: FakeCanvas[] = [];
    await exportPresetSlices({
      pages: [asCanvas(new FakeCanvas(720, 2560))],
      preset: naver,
      format: "jpg",
      title: "",
      watermark: { enabled: true, text: "© 툰스펙트럼", position: "br", opacity: 0.5, size: 0.028 },
      delayMs: 0,
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      download: () => {},
    });
    expect(created).toHaveLength(2);
    for (const slice of created) {
      expect(slice.ctx.strokeTexts).toEqual(["© 툰스펙트럼"]);
      expect(slice.ctx.fillTexts).toEqual(["© 툰스펙트럼"]);
    }
  });

  it("꺼진 워터마크·빈 텍스트는 그리지 않는다", async () => {
    const created: FakeCanvas[] = [];
    await exportPresetSlices({
      pages: [asCanvas(new FakeCanvas(690, 1000))],
      preset: naver,
      format: "jpg",
      title: "x",
      watermark: { enabled: false, text: "© x", position: "br", opacity: 0.5, size: 0.028 },
      delayMs: 0,
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      download: () => {},
    });
    expect(created[0].ctx.strokeTexts).toEqual([]);
  });

  it("프리셋 용량 제한을 넘는 파일 수를 세어 돌려준다", async () => {
    const result = await exportPresetSlices({
      pages: [asCanvas(new FakeCanvas(690, 1000))],
      preset: naver,
      format: "jpg",
      title: "big",
      delayMs: 0,
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h, 6 * 1024 * 1024)),
      download: () => {},
    });
    expect(result.files).toBe(1);
    expect(result.oversized).toBe(1);
  });

  it("유효한 페이지가 없으면 한글 메시지로 던진다", async () => {
    await expect(
      exportPresetSlices({
        pages: [],
        preset: naver,
        format: "jpg",
        title: "x",
        delayMs: 0,
        download: () => {},
      })
    ).rejects.toThrow("내보낼 페이지가 없어요");
  });

  // 연속 다운로드 차단 회피용 간격은 "다운로드 뒤 고정 정지"가 아니라
  // "다운로드 사이 최소 간격"이다 — 다음 슬라이스 인코딩 시간이 간격에 함께 계산된다.
  describe("다운로드 간격", () => {
    /** 가짜 단조 시계 + 인코딩 비용을 가진 하네스. 실제 타이머를 쓰지 않는다. */
    function runWithClock(encodeCostMs: number, delayMs: number) {
      let clock = 0;
      const slept: number[] = [];
      const downloadedAt: number[] = [];
      const files: { name: string; size: number }[] = [];
      const created: FakeCanvas[] = [];
      return exportPresetSlices({
        // 690×3840 → 1280 높이 3장
        pages: [asCanvas(new FakeCanvas(690, 3840))],
        preset: naver,
        format: "jpg",
        title: "t",
        delayMs,
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms);
          clock += ms;
        },
        createCanvas: (w, h) => {
          const fake = new FakeCanvas(w, h);
          created.push(fake);
          const originalToBlob = fake.toBlob.bind(fake);
          fake.toBlob = (callback, type) => {
            clock += encodeCostMs; // 합성·인코딩에 실제로 흘러간 시간
            originalToBlob(callback, type);
          };
          return asCanvas(fake);
        },
        download: (blob, name) => {
          downloadedAt.push(clock);
          files.push({ name, size: blob.size });
        },
      }).then((result) => ({ result, slept, downloadedAt, files, created }));
    }

    it("인코딩이 간격보다 오래 걸리면 추가 정지가 0이다", async () => {
      const { result, slept, downloadedAt } = await runWithClock(300, 250);
      expect(result.files).toBe(3);
      expect(slept).toEqual([]);
      expect(downloadedAt).toEqual([300, 600, 900]);
    });

    it("인코딩이 짧아도 다운로드 사이 최소 간격은 지킨다(모자란 만큼만 대기)", async () => {
      const { slept, downloadedAt } = await runWithClock(100, 250);
      // 고정 정지였다면 장당 250ms씩 총 500ms를 쉬었을 자리.
      expect(slept).toEqual([150, 150]);
      expect(downloadedAt).toEqual([100, 350, 600]);
      for (let i = 1; i < downloadedAt.length; i += 1) {
        expect(downloadedAt[i] - downloadedAt[i - 1]).toBeGreaterThanOrEqual(250);
      }
    });

    it("delayMs 0이면 아무 대기도 하지 않는다", async () => {
      const { slept, downloadedAt } = await runWithClock(100, 0);
      expect(slept).toEqual([]);
      expect(downloadedAt).toEqual([100, 200, 300]);
    });

    // 간격은 "언제 저장하는가"만 바꾼다 — 산출물(파일 수·이름·바이트·그려진 픽셀 연산)은
    // delayMs 와 무관하게 동일해야 한다.
    it("간격 값이 달라도 산출물은 완전히 동일하다", async () => {
      const noDelay = await runWithClock(100, 0);
      const withDelay = await runWithClock(100, 250);
      const longEncode = await runWithClock(300, 250);

      const shape = (run: Awaited<ReturnType<typeof runWithClock>>) => ({
        result: run.result,
        files: run.files,
        canvases: run.created.map((c) => [c.width, c.height]),
        drawImages: run.created.map((c) => c.ctx.drawImages),
        fillRects: run.created.map((c) => c.ctx.fillRects),
      });

      expect(shape(withDelay)).toEqual(shape(noDelay));
      expect(shape(longEncode)).toEqual(shape(noDelay));
    });
  });
});
