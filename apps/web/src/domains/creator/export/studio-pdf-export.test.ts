import { describe, it, expect } from "vitest";

import { JPEG_QUALITY } from "./studio-export";
import {
  PDF_PX_TO_PT,
  buildPdfFromJpegPages,
  canvasToJpegBytes,
  exportPagesToPdf,
  formatPdfFileSize,
  pdfExportFileName,
  pdfExportResultMessage,
  renderPagesToPdf,
  type PdfJpegPage,
} from "./studio-pdf-export";

// ── 바이트 유틸 — latin1(바이트↔문자 1:1)로 문자열 인덱스가 곧 바이트 오프셋이 되게 한다 ──

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** SOI/EOI를 갖춘 가짜 JPEG — UTF-8 멀티바이트·개행·"%%EOF" 미끼 등 함정 바이트 포함. */
function fakeJpeg(seed: number, extra: number[] = []): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0 마커 흉내
    seed & 0xff,
    0xea, 0xb0, 0x80, // "가"의 UTF-8 — 문자열 경유 조립이면 길이가 어긋난다
    0x0a, 0x0d, // 개행류
    0x25, 0x25, 0x45, 0x4f, 0x46, // "%%EOF" 미끼 — 구조 파싱이 마지막 EOF를 봐야 한다
    ...extra,
    0xff, 0xd9, // EOI
  ]);
}

const pageA: PdfJpegPage = { jpegBytes: fakeJpeg(1), width: 690, height: 1280 };
const pageB: PdfJpegPage = { jpegBytes: fakeJpeg(2, [0x00, 0x80, 0xff]), width: 720, height: 900 };
const pageC: PdfJpegPage = { jpegBytes: fakeJpeg(3), width: 800, height: 800 };

interface ParsedXref {
  text: string;
  size: number;
  xrefOffset: number;
  offsets: number[];
  entries: string[];
  trailer: string;
}

/** startxref → xref 테이블 → 오브젝트 오프셋 목록을 실제 파일 규칙대로 파싱한다. */
function parseXref(bytes: Uint8Array): ParsedXref {
  const text = latin1(bytes);
  const startxrefAt = text.lastIndexOf("startxref\n");
  expect(startxrefAt).toBeGreaterThan(-1);
  const xrefOffset = Number(/^startxref\n(\d+)\n/.exec(text.slice(startxrefAt))?.[1]);
  const head = /^xref\n0 (\d+)\n/.exec(text.slice(xrefOffset));
  expect(head).not.toBeNull();
  const size = Number(head![1]);
  const entriesStart = xrefOffset + head![0].length;
  const entries: string[] = [];
  const offsets: number[] = [];
  for (let n = 0; n < size; n++) {
    const entry = text.slice(entriesStart + n * 20, entriesStart + (n + 1) * 20);
    entries.push(entry);
    offsets.push(Number(entry.slice(0, 10)));
  }
  return { text, size, xrefOffset, offsets, entries, trailer: text.slice(text.indexOf("trailer", entriesStart)) };
}

/** 오브젝트 시작 오프셋에서 스트림 데이터를 /Length 만큼 잘라낸다. */
function extractStream(bytes: Uint8Array, text: string, objOffset: number): { data: Uint8Array; length: number } {
  const streamAt = text.indexOf("stream\n", objOffset);
  const length = Number(/\/Length (\d+)/.exec(text.slice(objOffset, streamAt))?.[1]);
  const start = streamAt + "stream\n".length;
  return { data: bytes.slice(start, start + length), length };
}

describe("buildPdfFromJpegPages — 파일 골격", () => {
  it("%PDF-1.4 헤더로 시작한다", () => {
    const pdf = buildPdfFromJpegPages([pageA]);
    expect(latin1(pdf).startsWith("%PDF-1.4\n")).toBe(true);
  });

  it("헤더 다음 줄은 고비트 바이너리 마커 주석이다", () => {
    const pdf = buildPdfFromJpegPages([pageA]);
    expect(Array.from(pdf.slice(9, 15))).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  });

  it("%%EOF로 끝난다(JPEG 안 미끼 %%EOF가 아니라 파일 끝)", () => {
    const pdf = buildPdfFromJpegPages([pageA, pageB]);
    expect(latin1(pdf).endsWith("%%EOF")).toBe(true);
  });

  it("페이지 수가 /Kids·/Count에 그대로 반영된다(3페이지)", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA, pageB, pageC]));
    expect(text).toContain("/Kids [3 0 R 6 0 R 9 0 R] /Count 3");
  });

  it("1페이지면 /Count 1", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA]));
    expect(text).toContain("/Kids [3 0 R] /Count 1");
  });

  it("페이지마다 Page·Image(DCTDecode) 오브젝트가 하나씩 생긴다", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA, pageB, pageC]));
    expect(countOf(text, "<< /Type /Page /Parent")).toBe(3);
    expect(countOf(text, "/Subtype /Image")).toBe(3);
    expect(countOf(text, "/Filter /DCTDecode")).toBe(3);
  });
});

describe("buildPdfFromJpegPages — xref 정합", () => {
  it("xref 오프셋들이 실제 오브젝트 시작 바이트와 일치한다", () => {
    const { text, size, offsets } = parseXref(buildPdfFromJpegPages([pageA, pageB, pageC], { title: "내 만화" }));
    const mismatched: number[] = [];
    for (let num = 1; num < size; num++) {
      if (!text.startsWith(`${num} 0 obj\n`, offsets[num])) mismatched.push(num);
    }
    expect(mismatched).toEqual([]);
  });

  it("xref 엔트리는 정확히 20바이트 규격이다", () => {
    const { entries } = parseXref(buildPdfFromJpegPages([pageA, pageB]));
    expect(entries[0]).toBe("0000000000 65535 f \n");
    for (const entry of entries.slice(1)) {
      expect(entry).toMatch(/^\d{10} 00000 n \n$/);
    }
  });

  it("startxref가 xref 키워드의 바이트 오프셋을 가리킨다", () => {
    const { text, xrefOffset } = parseXref(buildPdfFromJpegPages([pageA]));
    expect(text.startsWith("xref\n", xrefOffset)).toBe(true);
  });

  it("trailer의 /Size·/Root·/Info가 오브젝트 배치와 맞는다(N페이지 → 4+3N)", () => {
    const { size, trailer } = parseXref(buildPdfFromJpegPages([pageA, pageB]));
    expect(size).toBe(4 + 3 * 2);
    expect(trailer).toContain(`/Size ${size}`);
    expect(trailer).toContain("/Root 1 0 R");
    expect(trailer).toContain("/Info 9 0 R");
  });
});

describe("buildPdfFromJpegPages — 이미지 임베드", () => {
  it("JPEG 바이트가 그대로 포함된다(멀티바이트·널·고비트 함정 바이트 포함)", () => {
    const pdf = buildPdfFromJpegPages([pageA, pageB]);
    const text = latin1(pdf);
    expect(text.indexOf(latin1(pageA.jpegBytes))).toBeGreaterThan(-1);
    expect(text.indexOf(latin1(pageB.jpegBytes))).toBeGreaterThan(-1);
  });

  it("이미지 스트림 /Length가 JPEG 바이트 길이와 일치하고 내용이 원본과 동일하다", () => {
    const pdf = buildPdfFromJpegPages([pageA, pageB]);
    const { text, offsets } = parseXref(pdf);
    // 페이지 0의 이미지 오브젝트 번호 = 5, 페이지 1 = 8.
    const first = extractStream(pdf, text, offsets[5]);
    const second = extractStream(pdf, text, offsets[8]);
    expect(first.length).toBe(pageA.jpegBytes.length);
    expect(Array.from(first.data)).toEqual(Array.from(pageA.jpegBytes));
    expect(second.length).toBe(pageB.jpegBytes.length);
    expect(Array.from(second.data)).toEqual(Array.from(pageB.jpegBytes));
  });

  it("스트림 데이터 직후에 endstream이 온다(/Length 초과·부족 없음)", () => {
    const pdf = buildPdfFromJpegPages([pageA]);
    const { text, offsets } = parseXref(pdf);
    const streamAt = text.indexOf("stream\n", offsets[5]);
    const end = streamAt + "stream\n".length + pageA.jpegBytes.length;
    expect(text.startsWith("\nendstream\nendobj\n", end)).toBe(true);
  });

  it("/Width·/Height는 px 그대로, DeviceRGB 8bit로 선언한다", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA]));
    expect(text).toContain("/Width 690 /Height 1280");
    expect(text).toContain("/ColorSpace /DeviceRGB /BitsPerComponent 8");
  });
});

describe("buildPdfFromJpegPages — px→pt 규약(1px = 0.75pt)", () => {
  it("PDF_PX_TO_PT 계수는 0.75(CSS 96dpi ↔ PDF 72pt/inch)", () => {
    expect(PDF_PX_TO_PT).toBe(0.75);
  });

  it("MediaBox는 px×0.75pt — 690×1280px → 517.5×960pt", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA]));
    expect(text).toContain("/MediaBox [0 0 517.5 960]");
  });

  it("cm 행렬이 페이지 크기와 같아 이미지가 페이지를 가득 채운다", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA]));
    expect(text).toContain("q\n517.5 0 0 960 0 0 cm\n/Im0 Do\nQ");
  });

  it("콘텐츠 스트림 /Length가 실제 연산자 바이트 길이와 일치한다", () => {
    const pdf = buildPdfFromJpegPages([pageA]);
    const { text, offsets } = parseXref(pdf);
    const content = extractStream(pdf, text, offsets[4]);
    const expected = "q\n517.5 0 0 960 0 0 cm\n/Im0 Do\nQ";
    expect(content.length).toBe(expected.length);
    expect(latin1(content.data)).toBe(expected);
  });

  it("정수 pt는 소수점 없이, 소수 pt는 꼬리 0 없이 표기된다(720×900px → 540×675pt)", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageB]));
    expect(text).toContain("/MediaBox [0 0 540 675]");
    expect(text).not.toContain("517.50");
  });

  it("소수 px 크기는 픽셀 정수로 반올림해 담는다", () => {
    const { text } = parseXref(buildPdfFromJpegPages([{ jpegBytes: fakeJpeg(9), width: 689.6, height: 1279.5 }]));
    expect(text).toContain("/Width 690 /Height 1280");
    expect(text).toContain("/MediaBox [0 0 517.5 960]");
  });
});

describe("buildPdfFromJpegPages — docinfo·결정성", () => {
  it("한글 제목은 UTF-16BE(BOM) hex 문자열로 /Title에 담는다", () => {
    const { text } = parseXref(buildPdfFromJpegPages([pageA], { title: "웹툰A" }));
    // 웹 U+C6F9 · 툰 U+D230 · A U+0041
    expect(text).toContain("/Title <FEFFC6F9D2300041>");
    expect(text).toContain("/Producer (ToonSpectrum Studio)");
  });

  it("제목이 없거나 공백이면 /Title을 생략하고 /Producer만 남긴다", () => {
    for (const opts of [undefined, { title: "   " }]) {
      const { text } = parseXref(buildPdfFromJpegPages([pageA], opts));
      expect(text).not.toContain("/Title");
      expect(text).toContain("/Producer (ToonSpectrum Studio)");
    }
  });

  it("같은 입력이면 바이트 단위로 같은 출력(결정적 — 날짜 메타데이터 없음)", () => {
    const first = buildPdfFromJpegPages([pageA, pageB], { title: "내 만화" });
    const second = buildPdfFromJpegPages([pageA, pageB], { title: "내 만화" });
    expect(first).toEqual(second);
    expect(latin1(first)).not.toContain("/CreationDate");
  });
});

describe("buildPdfFromJpegPages — 입력 검증", () => {
  it("빈 페이지 배열은 한글 메시지로 던진다", () => {
    expect(() => buildPdfFromJpegPages([])).toThrow("PDF로 내보낼 페이지가 없어요.");
  });

  it("크기가 0·음수·NaN이면 페이지 번호와 함께 던진다", () => {
    expect(() => buildPdfFromJpegPages([{ jpegBytes: fakeJpeg(1), width: 0, height: 100 }])).toThrow(
      "페이지 1의 크기가 올바르지 않아요."
    );
    expect(() =>
      buildPdfFromJpegPages([pageA, { jpegBytes: fakeJpeg(1), width: 100, height: -5 }])
    ).toThrow("페이지 2의 크기가 올바르지 않아요.");
    expect(() => buildPdfFromJpegPages([{ jpegBytes: fakeJpeg(1), width: Number.NaN, height: 100 }])).toThrow(
      /크기가 올바르지 않아요/
    );
  });

  it("SOI(FFD8)가 없으면 JPEG 아님 오류(canvas.toBlob PNG 폴백 가드)", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => buildPdfFromJpegPages([{ jpegBytes: png, width: 100, height: 100 }])).toThrow(
      "페이지 1의 이미지가 JPEG 형식이 아니에요. 다시 시도해주세요."
    );
    expect(() => buildPdfFromJpegPages([{ jpegBytes: new Uint8Array(0), width: 100, height: 100 }])).toThrow(
      /JPEG 형식이 아니에요/
    );
  });
});

// ── 브라우저 어댑터 — 가짜 캔버스/변환기로 실행 흐름 검증 ──

class FakeContext2D {
  fillStyle: unknown = "";
  globalAlpha = 1;
  font = "";
  textAlign = "";
  textBaseline = "";
  lineJoin = "";
  lineWidth = 0;
  strokeStyle: unknown = "";
  fillRects: number[][] = [];
  drawnSources: unknown[] = [];
  strokeTexts: string[] = [];
  fillTexts: string[] = [];

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push([x, y, w, h]);
  }

  drawImage(source: unknown): void {
    this.drawnSources.push(source);
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
    private contextAvailable = true
  ) {}

  getContext(_type: string): FakeContext2D | null {
    return this.contextAvailable ? this.ctx : null;
  }
}

const asCanvas = (fake: FakeCanvas) => fake as unknown as HTMLCanvasElement;

describe("canvasToJpegBytes", () => {
  it("image/jpeg·기본 품질 0.92로 인코드해 Blob 바이트를 돌려준다", async () => {
    const calls: { type: string; quality: number | undefined }[] = [];
    const payload = Uint8Array.from([0xff, 0xd8, 0x01, 0xff, 0xd9]);
    const convert = (_canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> => {
      calls.push({ type, quality });
      return Promise.resolve(new Blob([payload]));
    };
    const bytes = await canvasToJpegBytes(asCanvas(new FakeCanvas(10, 10)), undefined, convert);
    expect(calls).toEqual([{ type: "image/jpeg", quality: JPEG_QUALITY }]);
    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });

  it("지정한 품질이 그대로 전달된다", async () => {
    const qualities: (number | undefined)[] = [];
    const convert = (_c: HTMLCanvasElement, _t: string, quality?: number): Promise<Blob> => {
      qualities.push(quality);
      return Promise.resolve(new Blob([Uint8Array.from([0xff, 0xd8])]));
    };
    await canvasToJpegBytes(asCanvas(new FakeCanvas(10, 10)), 0.8, convert);
    expect(qualities).toEqual([0.8]);
  });
});

describe("pdfExportFileName · formatPdfFileSize · pdfExportResultMessage", () => {
  it("파일명은 `<제목>.pdf`, 빈 제목은 기본 파일명", () => {
    expect(pdfExportFileName("내 만화")).toBe("내 만화.pdf");
    expect(pdfExportFileName("  ")).toBe("toonspectrum-webtoon.pdf");
  });

  it("1MB 미만은 KB(최소 1KB), 이상은 소수 1자리 MB로 표기한다", () => {
    expect(formatPdfFileSize(500)).toBe("1KB");
    expect(formatPdfFileSize(300 * 1024)).toBe("300KB");
    expect(formatPdfFileSize(1024 * 1024)).toBe("1.0MB");
    expect(formatPdfFileSize(2.4 * 1024 * 1024)).toBe("2.4MB");
  });

  it("결과 안내는 페이지 수·파일 크기를 담는다", () => {
    const msg = pdfExportResultMessage({ pageCount: 3, bytes: 2 * 1024 * 1024, fileName: "내 만화.pdf" });
    expect(msg).toBe("전체 3페이지를 PDF 한 파일(2.0MB)로 저장했어요.");
  });
});

describe("renderPagesToPdf · exportPagesToPdf", () => {
  const watermarkOff = { enabled: false, text: "© x", position: "br", opacity: 0.5, size: 0.028 } as const;

  function makeToJpeg() {
    const calls: { width: number; height: number; quality: number }[] = [];
    const toJpeg = (canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> => {
      calls.push({ width: canvas.width, height: canvas.height, quality });
      return Promise.resolve(fakeJpeg(calls.length));
    };
    return { calls, toJpeg };
  }

  it("다운로드 없이 재사용 가능한 PDF Blob과 파일 메타데이터를 반환한다", async () => {
    const sources = [new FakeCanvas(690, 1280), new FakeCanvas(690, 900)];
    const progress: number[][] = [];
    const { toJpeg } = makeToJpeg();

    const result = await renderPagesToPdf({
      pages: sources.map(asCanvas),
      title: "검토본",
      createCanvas: (width, height) => asCanvas(new FakeCanvas(width, height)),
      toJpeg,
      onProgress: (done, total) => progress.push([done, total]),
    });

    expect(result).toMatchObject({
      fileName: "검토본.pdf",
      pageCount: 2,
      bytes: result.blob.size,
    });
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe("application/pdf");
    expect(progress).toEqual([[1, 2], [2, 2]]);
    const pdf = new Uint8Array(await result.blob.arrayBuffer());
    const { text } = parseXref(pdf);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text).toContain("/Title <FEFF");
  });

  it("Blob 렌더에서도 워터마크와 품질 주입을 유지하고 임시 캔버스를 해제한다", async () => {
    const created: FakeCanvas[] = [];
    const released: FakeCanvas[] = [];
    const { calls, toJpeg } = makeToJpeg();

    await renderPagesToPdf({
      pages: [asCanvas(new FakeCanvas(690, 1280)), asCanvas(new FakeCanvas(690, 900))],
      title: "x",
      quality: 0.73,
      watermark: {
        enabled: true,
        text: "© 툰스펙트럼",
        position: "br",
        opacity: 0.5,
        size: 0.028,
      },
      createCanvas: (width, height) => {
        const canvas = new FakeCanvas(width, height);
        created.push(canvas);
        return asCanvas(canvas);
      },
      toJpeg,
      releaseCanvas: (canvas) => {
        const fake = canvas as unknown as FakeCanvas;
        released.push(fake);
        canvas.width = 0;
        canvas.height = 0;
      },
    });

    expect(calls).toEqual([
      { width: 690, height: 1280, quality: 0.73 },
      { width: 690, height: 900, quality: 0.73 },
    ]);
    expect(released).toEqual(created);
    expect(created.map(({ width, height }) => [width, height])).toEqual([[0, 0], [0, 0]]);
    for (const canvas of created) {
      expect(canvas.ctx.strokeTexts).toEqual(["© 툰스펙트럼"]);
      expect(canvas.ctx.fillTexts).toEqual(["© 툰스펙트럼"]);
    }
  });

  it("JPEG 인코딩 실패 때도 임시 캔버스를 해제하고 원래 오류를 보존한다", async () => {
    const created = new FakeCanvas(100, 200);
    const released: HTMLCanvasElement[] = [];
    const progress: number[][] = [];

    await expect(renderPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 200))],
      title: "x",
      createCanvas: () => asCanvas(created),
      toJpeg: () => Promise.reject(new Error("JPEG encoder failed")),
      releaseCanvas: (canvas) => {
        released.push(canvas);
        throw new Error("cleanup failed");
      },
      onProgress: (done, total) => progress.push([done, total]),
    })).rejects.toThrow("JPEG encoder failed");

    expect(released).toEqual([asCanvas(created)]);
    expect(progress).toEqual([]);
  });

  it("페이지별 준비 캔버스를 한 장씩 인코드한 뒤 즉시 해제하고 원본 인덱스를 보존한다", async () => {
    const sources = [new FakeCanvas(100, 200), new FakeCanvas(0, 50), new FakeCanvas(120, 240)];
    const prepared: FakeCanvas[] = [];
    const sourceIndexes: number[] = [];
    const events: string[] = [];
    const { calls, toJpeg } = makeToJpeg();

    const result = await renderPagesToPdf({
      pages: sources.map(asCanvas),
      title: "주석 검토본",
      preparePage: (_source, sourceIndex) => {
        sourceIndexes.push(sourceIndex);
        events.push(`prepare:${sourceIndex}`);
        const canvas = new FakeCanvas(300 + sourceIndex, 400 + sourceIndex);
        prepared.push(canvas);
        return asCanvas(canvas);
      },
      releasePreparedPage: (_page, sourceIndex) => events.push(`release:${sourceIndex}`),
      createCanvas: (width, height) => asCanvas(new FakeCanvas(width, height)),
      toJpeg: async (canvas, quality) => {
        events.push(`encode:${canvas.width - 300}`);
        return toJpeg(canvas, quality);
      },
    });

    expect(result.pageCount).toBe(2);
    expect(sourceIndexes).toEqual([0, 2]);
    expect(calls.map(({ width, height }) => [width, height])).toEqual([[300, 400], [302, 402]]);
    expect(events).toEqual([
      "prepare:0",
      "encode:0",
      "release:0",
      "prepare:2",
      "encode:2",
      "release:2",
    ]);
    expect(prepared).toHaveLength(2);
  });

  it("평탄화 캔버스 생성이 실패해도 준비된 페이지를 해제하고 원래 오류를 보존한다", async () => {
    const prepared = asCanvas(new FakeCanvas(300, 400));
    const released: number[] = [];

    await expect(renderPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 200))],
      title: "x",
      preparePage: () => prepared,
      releasePreparedPage: (_page, sourceIndex) => {
        released.push(sourceIndex);
        throw new Error("cleanup failed");
      },
      createCanvas: () => {
        throw new Error("canvas allocation failed");
      },
    })).rejects.toThrow("canvas allocation failed");

    expect(released).toEqual([0]);
  });

  it("준비된 페이지 크기가 잘못돼도 해당 캔버스를 해제하고 크기 오류를 보존한다", async () => {
    const prepared = asCanvas(new FakeCanvas(0, 400));
    const released: number[] = [];

    await expect(renderPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 200))],
      title: "x",
      preparePage: () => prepared,
      releasePreparedPage: (_page, sourceIndex) => {
        released.push(sourceIndex);
        throw new Error("cleanup failed");
      },
      createCanvas: () => {
        throw new Error("must not allocate");
      },
    })).rejects.toThrow("PDF 페이지 1의 준비된 크기가 올바르지 않아요.");

    expect(released).toEqual([0]);
  });

  it("기존 다운로드 API는 Blob 렌더 결과를 한 번만 저장하고 Blob 없는 계약을 유지한다", async () => {
    const source = asCanvas(new FakeCanvas(100, 200));
    const toJpeg = () => Promise.resolve(fakeJpeg(7));
    const rendered = await renderPagesToPdf({
      pages: [source],
      title: "동일 결과",
      createCanvas: (width, height) => asCanvas(new FakeCanvas(width, height)),
      toJpeg,
    });
    const downloads: { blob: Blob; name: string }[] = [];
    const exported = await exportPagesToPdf({
      pages: [source],
      title: "동일 결과",
      createCanvas: (width, height) => asCanvas(new FakeCanvas(width, height)),
      toJpeg,
      download: (blob, name) => downloads.push({ blob, name }),
    });

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.name).toBe(rendered.fileName);
    expect(new Uint8Array(await downloads[0]!.blob.arrayBuffer()))
      .toEqual(new Uint8Array(await rendered.blob.arrayBuffer()));
    expect(exported).toEqual({
      pageCount: rendered.pageCount,
      bytes: rendered.bytes,
      fileName: rendered.fileName,
    });
    expect(exported).not.toHaveProperty("blob");
  });

  it("Blob 렌더도 유효한 페이지가 없으면 기존 한글 오류를 유지한다", async () => {
    await expect(renderPagesToPdf({ pages: [], title: "x" }))
      .rejects.toThrow("내보낼 페이지가 없어요.");
    await expect(renderPagesToPdf({
      pages: [asCanvas(new FakeCanvas(0, 100))],
      title: "x",
    })).rejects.toThrow("내보낼 페이지가 없어요.");
  });

  it("페이지마다 흰 배경→원본 합성→JPEG 인코드 후 PDF 한 파일을 다운로드한다", async () => {
    const sources = [new FakeCanvas(690, 1280), new FakeCanvas(690, 900)];
    const created: FakeCanvas[] = [];
    const downloads: { blob: Blob; name: string }[] = [];
    const { calls, toJpeg } = makeToJpeg();

    const result = await exportPagesToPdf({
      pages: sources.map(asCanvas),
      title: "내 만화",
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      toJpeg,
      download: (blob, name) => downloads.push({ blob, name }),
    });

    expect(created.map((c) => [c.width, c.height])).toEqual([
      [690, 1280],
      [690, 900],
    ]);
    expect(created[0].ctx.fillRects[0]).toEqual([0, 0, 690, 1280]);
    expect(created[0].ctx.drawnSources[0]).toBe(sources[0]);
    expect(created[1].ctx.drawnSources[0]).toBe(sources[1]);
    expect(calls.map((c) => [c.width, c.height])).toEqual([
      [690, 1280],
      [690, 900],
    ]);

    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe("내 만화.pdf");
    expect(downloads[0].blob.type).toBe("application/pdf");
    expect(downloads[0].blob.size).toBe(result.bytes);
    expect(result).toMatchObject({ pageCount: 2, fileName: "내 만화.pdf" });

    // 다운로드된 바이트가 실제 유효한 2페이지 PDF인지 구조까지 확인한다.
    const pdf = new Uint8Array(await downloads[0].blob.arrayBuffer());
    const { text } = parseXref(pdf);
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.indexOf(latin1(fakeJpeg(1)))).toBeGreaterThan(-1);
    expect(text.indexOf(latin1(fakeJpeg(2)))).toBeGreaterThan(-1);
    expect(text).toContain("/Title <FEFF"); // docinfo 제목 포함
  });

  it("진행 콜백이 1..N으로 온다", async () => {
    const progress: number[][] = [];
    const { toJpeg } = makeToJpeg();
    await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 100)), asCanvas(new FakeCanvas(100, 100))],
      title: "x",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg,
      download: () => {},
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("JPEG 품질은 기본 0.92, 지정 시 그대로 전달된다", async () => {
    const first = makeToJpeg();
    await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 100))],
      title: "x",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg: first.toJpeg,
      download: () => {},
    });
    expect(first.calls[0].quality).toBe(JPEG_QUALITY);

    const second = makeToJpeg();
    await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 100))],
      title: "x",
      quality: 0.7,
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg: second.toJpeg,
      download: () => {},
    });
    expect(second.calls[0].quality).toBe(0.7);
  });

  it("워터마크가 켜져 있으면 페이지마다 서명을 찍는다", async () => {
    const created: FakeCanvas[] = [];
    const { toJpeg } = makeToJpeg();
    await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(690, 1280)), asCanvas(new FakeCanvas(690, 900))],
      title: "x",
      watermark: { enabled: true, text: "© 툰스펙트럼", position: "br", opacity: 0.5, size: 0.028 },
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      toJpeg,
      download: () => {},
    });
    for (const canvas of created) {
      expect(canvas.ctx.strokeTexts).toEqual(["© 툰스펙트럼"]);
      expect(canvas.ctx.fillTexts).toEqual(["© 툰스펙트럼"]);
    }
  });

  it("꺼진 워터마크는 그리지 않는다", async () => {
    const created: FakeCanvas[] = [];
    const { toJpeg } = makeToJpeg();
    await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(690, 1280))],
      title: "x",
      watermark: watermarkOff,
      createCanvas: (w, h) => {
        const fake = new FakeCanvas(w, h);
        created.push(fake);
        return asCanvas(fake);
      },
      toJpeg,
      download: () => {},
    });
    expect(created[0].ctx.strokeTexts).toEqual([]);
    expect(created[0].ctx.fillTexts).toEqual([]);
  });

  it("0 크기 페이지는 걸러지고 유효 페이지만 담긴다", async () => {
    const { calls, toJpeg } = makeToJpeg();
    const result = await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(0, 0)), asCanvas(new FakeCanvas(100, 200))],
      title: "x",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg,
      download: () => {},
    });
    expect(result.pageCount).toBe(1);
    expect(calls).toHaveLength(1);
  });

  it("유효한 페이지가 없으면 한글 메시지로 거부한다", async () => {
    await expect(
      exportPagesToPdf({ pages: [], title: "x", download: () => {} })
    ).rejects.toThrow("내보낼 페이지가 없어요.");
    await expect(
      exportPagesToPdf({ pages: [asCanvas(new FakeCanvas(0, 100))], title: "x", download: () => {} })
    ).rejects.toThrow("내보낼 페이지가 없어요.");
  });

  it("2D 컨텍스트를 얻지 못하면 한글 메시지로 거부한다", async () => {
    const { toJpeg } = makeToJpeg();
    await expect(
      exportPagesToPdf({
        pages: [asCanvas(new FakeCanvas(100, 100))],
        title: "x",
        createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h, false)),
        toJpeg,
        download: () => {},
      })
    ).rejects.toThrow("PDF 페이지 캔버스를 만들지 못했어요. 다시 시도해주세요.");
  });

  it("빈 제목은 기본 파일명으로 저장하고 /Title을 생략한다", async () => {
    const downloads: { blob: Blob; name: string }[] = [];
    const { toJpeg } = makeToJpeg();
    await exportPagesToPdf({
      pages: [asCanvas(new FakeCanvas(100, 100))],
      title: "  ",
      createCanvas: (w, h) => asCanvas(new FakeCanvas(w, h)),
      toJpeg,
      download: (blob, name) => downloads.push({ blob, name }),
    });
    expect(downloads[0].name).toBe("toonspectrum-webtoon.pdf");
    const text = latin1(new Uint8Array(await downloads[0].blob.arrayBuffer()));
    expect(text).not.toContain("/Title");
  });
});
