import { describe, expect, it } from "vitest";

import { JPEG_QUALITY } from "./export/studio-export";
import {
  CONTACT_SHEET_PAGE_PRESETS,
  contactSheetFileName,
  contactSheetResultMessage,
  drawContactSheet,
  exportContactSheetPdf,
  planContactSheetLayout,
  type ContactSheetCellPlan,
  type ContactSheetExportResult,
  type ContactSheetPageInput,
} from "./studio-pdf-contact-sheet";

// 이 파일은 "buildPdfFromJpegPages 에 올바른 개수/크기의 JPEG 항목이 전달됐는지"까지만
// 검증한다. PDF 바이트/xref 구조 자체는 studio-pdf-export.test.ts 가 이미 다룬다.

/** SOI/EOI를 갖춘 가짜 JPEG(studio-pdf-export.test.ts 와 동일 관례). */
function fakeJpeg(seed: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, seed & 0xff, 0xff, 0xd9]);
}

// ── 가짜 캔버스/컨텍스트 — drawImage/strokeRect/fillText 인자까지 기록한다 ──

class FakeContext2D {
  fillStyle: unknown = "";
  strokeStyle: unknown = "";
  lineWidth = 0;
  font = "";
  textAlign = "";
  textBaseline = "";
  measureCharWidth = 6;
  fillRects: number[][] = [];
  strokeRects: number[][] = [];
  drawnImages: { source: unknown; dx: number; dy: number; dw: number; dh: number }[] = [];
  fillTexts: { text: string; x: number; y: number }[] = [];

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push([x, y, w, h]);
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.strokeRects.push([x, y, w, h]);
  }

  drawImage(source: unknown, dx: number, dy: number, dw: number, dh: number): void {
    this.drawnImages.push({ source, dx, dy, dw, dh });
  }

  fillText(text: string, x: number, y: number): void {
    this.fillTexts.push({ text, x, y });
  }

  measureText(text: string): { width: number } {
    return { width: text.length * this.measureCharWidth };
  }
}

class FakeCanvas {
  ctx = new FakeContext2D();

  constructor(
    public width: number,
    public height: number,
    private contextAvailable = true
  ) {}

  getContext(_type: string): FakeContext2D | null {
    return this.contextAvailable ? this.ctx : null;
  }
}

const asCanvas = (fake: FakeCanvas) => fake as unknown as HTMLCanvasElement;

// ─────────────────────────────────────────────────────────────────────────────
// planContactSheetLayout
// ─────────────────────────────────────────────────────────────────────────────

describe("planContactSheetLayout — perSheet/sheetCount 산술", () => {
  it("정확히 나눠떨어지면 마지막 시트도 꽉 찬다(12페이지, 3×4)", () => {
    const plan = planContactSheetLayout(12, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false });
    expect(plan).not.toBeNull();
    expect(plan!.perSheet).toBe(12);
    expect(plan!.sheetCount).toBe(1);
    expect(plan!.sheets[0]).toHaveLength(12);
  });

  it("나머지가 있으면 마지막 시트는 그만큼만 채워진다(13페이지, 3×4)", () => {
    const plan = planContactSheetLayout(13, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false });
    expect(plan!.sheetCount).toBe(2);
    expect(plan!.sheets[0]).toHaveLength(12);
    expect(plan!.sheets[1]).toHaveLength(1);
    expect(plan!.sheets[1][0].pageIndex).toBe(12);
  });

  it("페이지 1장이면 시트 1장에 셀 1개뿐이다", () => {
    const plan = planContactSheetLayout(1, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false });
    expect(plan!.sheetCount).toBe(1);
    expect(plan!.sheets).toHaveLength(1);
    expect(plan!.sheets[0]).toHaveLength(1);
    expect(plan!.sheets[0][0].pageIndex).toBe(0);
  });

  it("24페이지, 3×4 격자면 시트 2장 모두 꽉 찬다", () => {
    const plan = planContactSheetLayout(24, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false });
    expect(plan!.sheetCount).toBe(2);
    expect(plan!.sheets[0]).toHaveLength(12);
    expect(plan!.sheets[1]).toHaveLength(12);
  });
});

describe("planContactSheetLayout — columns/rows 정규화", () => {
  it("소수는 내림(floor) 처리된다", () => {
    const plan = planContactSheetLayout(1, { sheetWidth: 794, sheetHeight: 1123, columns: 2.9, rows: 3.9, showLabels: false });
    expect(plan!.columns).toBe(2);
    expect(plan!.rows).toBe(3);
  });

  it("0/음수는 최소 1로 클램프된다", () => {
    const zero = planContactSheetLayout(1, { sheetWidth: 794, sheetHeight: 1123, columns: 0, rows: 0, showLabels: false });
    expect(zero!.columns).toBe(1);
    expect(zero!.rows).toBe(1);
    const negative = planContactSheetLayout(1, { sheetWidth: 794, sheetHeight: 1123, columns: -3, rows: -5, showLabels: false });
    expect(negative!.columns).toBe(1);
    expect(negative!.rows).toBe(1);
  });
});

describe("planContactSheetLayout — 배치 불가능 → null", () => {
  it("페이지 수가 0 이하면 null", () => {
    expect(planContactSheetLayout(0, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false })).toBeNull();
    expect(planContactSheetLayout(-1, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false })).toBeNull();
  });

  it("시트 크기가 비유한(non-finite)·0·음수면 null", () => {
    const base = { columns: 3, rows: 4, showLabels: false } as const;
    expect(planContactSheetLayout(1, { ...base, sheetWidth: Number.NaN, sheetHeight: 1123 })).toBeNull();
    expect(planContactSheetLayout(1, { ...base, sheetWidth: Number.POSITIVE_INFINITY, sheetHeight: 1123 })).toBeNull();
    expect(planContactSheetLayout(1, { ...base, sheetWidth: 0, sheetHeight: 1123 })).toBeNull();
    expect(planContactSheetLayout(1, { ...base, sheetWidth: -100, sheetHeight: 1123 })).toBeNull();
    expect(planContactSheetLayout(1, { ...base, sheetWidth: 794, sheetHeight: 0 })).toBeNull();
  });

  it("여백·간격·라벨 줄이 시트 크기를 넘는 등 칸 크기가 무너지면 null", () => {
    // 열 50칸을 좁은 시트에 욱여넣으면 칸 폭이 1px 이하가 된다.
    expect(planContactSheetLayout(3, { sheetWidth: 100, sheetHeight: 200, columns: 50, rows: 2, showLabels: false })).toBeNull();
    // 라벨 줄 높이가 칸 높이보다 커서 이미지 영역이 남지 않는 경우.
    expect(
      planContactSheetLayout(1, {
        sheetWidth: 200,
        sheetHeight: 100,
        columns: 1,
        rows: 1,
        showLabels: true,
        margin: 0,
        gap: 0,
        labelHeight: 200,
      })
    ).toBeNull();
  });
});

describe("planContactSheetLayout — 셀 지오메트리", () => {
  it("showLabels=false 이면 imageAreaHeight === height", () => {
    const plan = planContactSheetLayout(2, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false });
    for (const cell of plan!.sheets[0]) {
      expect(cell.imageAreaHeight).toBe(cell.height);
    }
  });

  it("showLabels=true 이면 imageAreaHeight = height - labelHeight", () => {
    const plan = planContactSheetLayout(1, {
      sheetWidth: 794,
      sheetHeight: 1123,
      columns: 3,
      rows: 4,
      showLabels: true,
      labelHeight: 24,
    });
    const cell = plan!.sheets[0][0];
    expect(cell.imageAreaHeight).toBeCloseTo(cell.height - 24, 6);
  });

  it("정확한 x/y 격자 산술(794×1123, 3×4, 기본 여백32/간격14)", () => {
    const plan = planContactSheetLayout(5, { sheetWidth: 794, sheetHeight: 1123, columns: 3, rows: 4, showLabels: false });
    const cells = plan!.sheets[0];
    // cellW = (794-64-28)/3 = 234, cellH = (1123-64-42)/4 = 254.25
    expect(cells[0]).toMatchObject({ pageIndex: 0, x: 32, y: 32, width: 234, height: 254.25 });
    expect(cells[1]).toMatchObject({ pageIndex: 1, x: 280, y: 32 });
    expect(cells[2]).toMatchObject({ pageIndex: 2, x: 528, y: 32 });
    // 행 우선(row-major) 채움 — 4번째 페이지부터 다음 행(row 1)으로 넘어간다.
    expect(cells[3]).toMatchObject({ pageIndex: 3, x: 32, y: 300.25 });
    expect(cells[4]).toMatchObject({ pageIndex: 4, x: 280, y: 300.25 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// drawContactSheet
// ─────────────────────────────────────────────────────────────────────────────

describe("drawContactSheet", () => {
  const cells: ContactSheetCellPlan[] = [
    { pageIndex: 0, x: 0, y: 0, width: 100, height: 80, imageAreaHeight: 60, labelBaselineY: 74 },
    { pageIndex: 1, x: 110, y: 0, width: 100, height: 80, imageAreaHeight: 60, labelBaselineY: 74 },
  ];

  it("셀마다 테두리를 그리고 소스 이미지를 하나씩 그린다", () => {
    const canvas = new FakeCanvas(300, 80);
    const pages: ContactSheetPageInput[] = [
      { source: asCanvas(new FakeCanvas(200, 100)), label: "표지" },
      { source: asCanvas(new FakeCanvas(200, 100)) },
    ];
    drawContactSheet(asCanvas(canvas), cells, pages, { showLabels: true, sheetWidth: 300, sheetHeight: 80 });

    expect(canvas.ctx.strokeRects).toEqual([
      [0.5, 0.5, 99, 79],
      [110.5, 0.5, 99, 79],
    ]);
    expect(canvas.ctx.drawnImages).toHaveLength(2);
    expect(canvas.ctx.drawnImages[0].source).toBe(pages[0].source);
    expect(canvas.ctx.drawnImages[1].source).toBe(pages[1].source);
  });

  it("showLabels && label 이 있을 때만 fillText를 호출한다", () => {
    const canvas = new FakeCanvas(300, 80);
    const pages: ContactSheetPageInput[] = [
      { source: asCanvas(new FakeCanvas(200, 100)), label: "표지" },
      { source: asCanvas(new FakeCanvas(200, 100)) }, // 라벨 없음
    ];
    drawContactSheet(asCanvas(canvas), cells, pages, { showLabels: true, sheetWidth: 300, sheetHeight: 80 });
    expect(canvas.ctx.fillTexts).toHaveLength(1);
    expect(canvas.ctx.fillTexts[0].text).toBe("표지");
  });

  it("showLabels=false 면 라벨이 있어도 fillText를 호출하지 않는다", () => {
    const canvas = new FakeCanvas(300, 80);
    const pages: ContactSheetPageInput[] = [
      { source: asCanvas(new FakeCanvas(200, 100)), label: "표지" },
      { source: asCanvas(new FakeCanvas(200, 100)), label: "1페이지" },
    ];
    drawContactSheet(asCanvas(canvas), cells, pages, { showLabels: false, sheetWidth: 300, sheetHeight: 80 });
    expect(canvas.ctx.fillTexts).toHaveLength(0);
  });

  it("셀 폭보다 넓은 라벨은 말줄임(…) 처리된다", () => {
    const canvas = new FakeCanvas(300, 80);
    const wideCells: ContactSheetCellPlan[] = [
      { pageIndex: 0, x: 0, y: 0, width: 80, height: 80, imageAreaHeight: 60, labelBaselineY: 74 },
    ];
    const pages: ContactSheetPageInput[] = [{ source: asCanvas(new FakeCanvas(200, 100)), label: "ABCDEFGHIJKLMNOPQRST" }];
    canvas.ctx.measureCharWidth = 10; // maxWidth = 80 - 6*2 = 68 → 5글자+말줄임(6*10=60<=68, 7*10=70>68)
    drawContactSheet(asCanvas(canvas), wideCells, pages, { showLabels: true, sheetWidth: 300, sheetHeight: 80 });
    expect(canvas.ctx.fillTexts).toHaveLength(1);
    expect(canvas.ctx.fillTexts[0].text).toBe("ABCDE…");
    expect(canvas.ctx.fillTexts[0].text.length).toBeLessThan("ABCDEFGHIJKLMNOPQRST".length);
  });

  it("pages 배열에 대응 인덱스가 없어도(방어적 인덱싱) 그 칸은 조용히 건너뛴다", () => {
    const canvas = new FakeCanvas(300, 80);
    drawContactSheet(asCanvas(canvas), cells, [], { showLabels: true, sheetWidth: 300, sheetHeight: 80 });
    expect(canvas.ctx.drawnImages).toHaveLength(0);
    expect(canvas.ctx.fillTexts).toHaveLength(0);
    // 테두리는 이미지/라벨 유무와 무관하게 그려진다.
    expect(canvas.ctx.strokeRects).toHaveLength(2);
  });

  it("2D 컨텍스트를 얻지 못하면 조용히 반환한다(throw 없음)", () => {
    const canvas = new FakeCanvas(300, 80, false);
    expect(() =>
      drawContactSheet(asCanvas(canvas), cells, [], { showLabels: true, sheetWidth: 300, sheetHeight: 80 })
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// contactSheetFileName · contactSheetResultMessage
// ─────────────────────────────────────────────────────────────────────────────

describe("contactSheetFileName · contactSheetResultMessage", () => {
  it("파일명은 `<제목>-contact-sheet.pdf`, 빈 제목은 기본 파일명", () => {
    expect(contactSheetFileName("내 만화")).toBe("내 만화-contact-sheet.pdf");
    expect(contactSheetFileName("   ")).toBe("toonspectrum-webtoon-contact-sheet.pdf");
  });

  it("결과 안내는 페이지 수·격자·시트 수를 담는다", () => {
    const result: ContactSheetExportResult = { pageCount: 13, sheetCount: 2, columns: 3, rows: 4, bytes: 1000, fileName: "x.pdf" };
    expect(contactSheetResultMessage(result)).toBe("전체 13페이지를 3×4 콘택트시트 2장(PDF)으로 저장했어요.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportContactSheetPdf
// ─────────────────────────────────────────────────────────────────────────────

describe("exportContactSheetPdf", () => {
  function makeToJpeg() {
    const calls: { width: number; height: number; quality: number }[] = [];
    const toJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> => {
      calls.push({ width: canvas.width, height: canvas.height, quality });
      return Promise.resolve(fakeJpeg(calls.length));
    };
    return { calls, toJpeg };
  }

  it("perSheet 초과 페이지를 시트 여러 장으로 나눠 PDF 한 파일로 다운로드한다", async () => {
    const pages = Array.from({ length: 13 }, () => asCanvas(new FakeCanvas(690, 1280)));
    const created: FakeCanvas[] = [];
    const downloads: { blob: Blob; name: string }[] = [];
    const progress: number[][] = [];
    const { calls, toJpeg } = makeToJpeg();
    const preset = CONTACT_SHEET_PAGE_PRESETS[0]; // A4

    const result = await exportContactSheetPdf({
      pages,
      pageLabels: pages.map((_, i) => `${i + 1}페이지`),
      columns: 3,
      rows: 4,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: true,
      title: "내 만화",
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      toJpeg,
      download: (blob, name) => downloads.push({ blob, name }),
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(created).toHaveLength(2); // 13페이지 / (3*4=12) → 시트 2장
    expect(created.every((c) => c.width === preset.widthPx && c.height === preset.heightPx)).toBe(true);
    expect(calls).toHaveLength(2);
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("내 만화-contact-sheet.pdf");
    expect(downloads[0].blob.type).toBe("application/pdf");
    expect(downloads[0].blob.size).toBe(result.bytes);
    expect(result).toMatchObject({ pageCount: 13, sheetCount: 2, columns: 3, rows: 4, fileName: "내 만화-contact-sheet.pdf" });
  });

  it("JPEG 품질은 기본 studio-export JPEG_QUALITY, 지정 시 그대로 전달된다", async () => {
    const preset = CONTACT_SHEET_PAGE_PRESETS[0];
    const first = makeToJpeg();
    await exportContactSheetPdf({
      pages: [asCanvas(new FakeCanvas(100, 100))],
      columns: 2,
      rows: 2,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: false,
      title: "x",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg: first.toJpeg,
      download: () => {},
    });
    expect(first.calls[0].quality).toBe(JPEG_QUALITY);

    const second = makeToJpeg();
    await exportContactSheetPdf({
      pages: [asCanvas(new FakeCanvas(100, 100))],
      columns: 2,
      rows: 2,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: false,
      title: "x",
      quality: 0.6,
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg: second.toJpeg,
      download: () => {},
    });
    expect(second.calls[0].quality).toBe(0.6);
  });

  it("유효한(양수 크기) 페이지가 없으면 한글 메시지로 거부한다", async () => {
    const preset = CONTACT_SHEET_PAGE_PRESETS[0];
    const base = {
      columns: 3,
      rows: 4,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: false,
      title: "x",
      download: () => {},
    };
    await expect(exportContactSheetPdf({ ...base, pages: [] })).rejects.toThrow("콘택트시트로 만들 페이지가 없어요.");
    await expect(exportContactSheetPdf({ ...base, pages: [asCanvas(new FakeCanvas(0, 100))] })).rejects.toThrow(
      "콘택트시트로 만들 페이지가 없어요."
    );
  });

  it("열/행 수가 시트 크기에 비해 배치 불가능하면 한글 메시지로 거부한다", async () => {
    await expect(
      exportContactSheetPdf({
        pages: [asCanvas(new FakeCanvas(100, 100))],
        columns: 50,
        rows: 50,
        sheetWidth: 100,
        sheetHeight: 100,
        showLabels: false,
        title: "x",
        download: () => {},
      })
    ).rejects.toThrow("열/행 수가 용지 크기에 비해 너무 많아요. 열이나 행을 줄여주세요.");
  });

  it("pageLabels 가 pages보다 짧아도 에러 없이 진행한다(빈 칸은 라벨 없이)", async () => {
    const preset = CONTACT_SHEET_PAGE_PRESETS[0];
    const { toJpeg } = makeToJpeg();
    const result = await exportContactSheetPdf({
      pages: [asCanvas(new FakeCanvas(100, 100)), asCanvas(new FakeCanvas(100, 100)), asCanvas(new FakeCanvas(100, 100))],
      pageLabels: ["표지"],
      columns: 3,
      rows: 4,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: true,
      title: "x",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg,
      download: () => {},
    });
    expect(result.pageCount).toBe(3);
  });

  it("중간 페이지가 0 크기로 필터링돼도 pageLabels는 원본 인덱스 기준으로 정렬 유지된다", async () => {
    const preset = CONTACT_SHEET_PAGE_PRESETS[0];
    const created: FakeCanvas[] = [];
    const { toJpeg } = makeToJpeg();
    await exportContactSheetPdf({
      // B(인덱스 1)는 0 크기라 필터링된다 — valid 배열 안에서는 A, C가 인덱스 0/1이 되지만
      // 라벨은 원본 인덱스(0/2)를 따라가야 한다.
      pages: [asCanvas(new FakeCanvas(100, 100)), asCanvas(new FakeCanvas(0, 0)), asCanvas(new FakeCanvas(100, 100))],
      pageLabels: ["A라벨", "B라벨", "C라벨"],
      columns: 2,
      rows: 2,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: true,
      title: "x",
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      toJpeg,
      download: () => {},
    });
    expect(created[0].ctx.fillTexts.map((t) => t.text)).toEqual(["A라벨", "C라벨"]);
  });

  it("빈 제목은 기본 파일명으로 저장한다", async () => {
    const preset = CONTACT_SHEET_PAGE_PRESETS[0];
    const downloads: { blob: Blob; name: string }[] = [];
    const { toJpeg } = makeToJpeg();
    await exportContactSheetPdf({
      pages: [asCanvas(new FakeCanvas(100, 100))],
      columns: 2,
      rows: 2,
      sheetWidth: preset.widthPx,
      sheetHeight: preset.heightPx,
      showLabels: false,
      title: "   ",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg,
      download: (blob, name) => downloads.push({ blob, name }),
    });
    expect(downloads[0].name).toBe("toonspectrum-webtoon-contact-sheet.pdf");
  });
});
