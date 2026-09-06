import { describe, it, expect } from "vitest";

import {
  parseSfntEmbeddingPolicy,
  type StudioPdfFontResource,
  type StudioSfntMetrics,
} from "./studio-canvaskit-pdf-font";
import { inspectPdf, readPdf, type StudioPdfReadDocument } from "./studio-canvaskit-pdf-reader";
import {
  STUDIO_PDF_PX_TO_PT,
  buildVectorPdf,
  fillColorOperator,
  mmToPt,
  pdfHexText,
  pdfName,
  pdfNumber,
  printPageBoxes,
  pxToPt,
  strokeColorOperator,
  type StudioPdfDocument,
  type StudioPdfOp,
} from "./studio-canvaskit-pdf-vector";

// ── 바이트 유틸 — latin1(바이트↔문자 1:1)이라 문자열 인덱스가 곧 바이트 오프셋이다 ──

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]!);
  return out;
}

const countOf = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/**
 * 실제 xref 표의 시작 오프셋. `lastIndexOf("xref")` 는 `startxref` 를 먼저 잡는 함정이 있어
 * 반드시 trailer 의 startxref 값을 따라가야 한다.
 */
function xrefTableStart(text: string): number {
  const match = /startxref\n(\d+)\n%%EOF$/u.exec(text);
  if (!match) throw new Error("startxref를 찾지 못했다");
  return Number(match[1]);
}

/** SOI/EOI를 갖춘 가짜 JPEG — "endstream"·개행·UTF-8 멀티바이트 미끼 바이트 포함. */
function fakeJpeg(seed: number): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, seed & 0xff,
    0xea, 0xb0, 0x80, // "가"의 UTF-8 — 문자열 경유 조립이면 길이가 어긋난다
    0x0a, 0x0d,
    0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d, // "endstream" 미끼
    0xff, 0xd9,
  ]);
}

const metrics: StudioSfntMetrics = {
  unitsPerEm: 1000,
  numGlyphs: 5,
  advanceWidths: [500, 600, 700, 1000, 1000],
  cmap: new Map([
    [0x41, 1],
    [0x42, 2],
    [0xac00, 3],
    [0xb098, 4],
  ]),
  ascender: 800,
  descender: -200,
  bbox: [0, -200, 1000, 800],
  capHeight: 700,
  hasCffOutlines: false,
  embeddingPolicy: parseSfntEmbeddingPolicy(0),
};

const cidFont: StudioPdfFontResource = {
  kind: "truetype-cid",
  resourceName: "F0",
  baseFont: "TestKR",
  fontBytes: Uint8Array.from([0x00, 0x01, 0x00, 0x00, 0x0a, 0xff, 0xd9]),
  metrics,
  usedGlyphIds: [0, 1, 3, 4],
};

const standardFont: StudioPdfFontResource = {
  kind: "standard-14",
  resourceName: "F1",
  baseFont: "Helvetica",
};

const rectPath: StudioPdfOp = {
  op: "path",
  commands: [
    { op: "move", x: 10, y: 10 },
    { op: "line", x: 110, y: 10 },
    { op: "cubic", x1: 130, y1: 30, x2: 130, y2: 70, x: 110, y: 90 },
    { op: "line", x: 10, y: 90 },
    { op: "close" },
  ],
  fill: { color: { space: "cmyk", c: 0, m: 0.4, y: 0.4, k: 0.6 } },
  stroke: { color: { space: "cmyk", c: 0, m: 0, y: 0, k: 1 }, width: 1.5, cap: 1, join: 1, dash: { pattern: [3, 2], phase: 0 } },
};

function simpleDoc(overrides: Partial<StudioPdfDocument> = {}): StudioPdfDocument {
  return {
    pages: [{ widthPt: 420, heightPt: 594, ops: [rectPath] }],
    title: "테스트 원고",
    ...overrides,
  };
}

function readOk(bytes: Uint8Array): StudioPdfReadDocument {
  const result = readPdf(bytes);
  if (!result.ok) throw new Error(`예상과 달리 PDF 파싱 실패: ${result.error}`);
  return result.document;
}

// ---------------------------------------------------------------------------

describe("숫자·문자열 표기", () => {
  it("지수 표기를 만들지 않고 꼬리 0을 없앤다", () => {
    expect(pdfNumber(0)).toBe("0");
    expect(pdfNumber(-0)).toBe("0");
    expect(pdfNumber(1e-9)).toBe("0");
    expect(pdfNumber(12)).toBe("12");
    expect(pdfNumber(0.5)).toBe("0.5");
    expect(pdfNumber(1.23456)).toBe("1.2346");
    expect(pdfNumber(-3.14159)).toBe("-3.1416");
    expect(pdfNumber(1000000)).toBe("1000000");
    expect(pdfNumber(0.000001)).toBe("0");
  });

  it("NaN·무한대는 조립 중에 잡는다", () => {
    expect(() => pdfNumber(Number.NaN)).toThrow("NaN");
    expect(() => pdfNumber(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("PDF 이름은 구분자·비ASCII를 바이트 단위 #xx로 이스케이프한다", () => {
    expect(pdfName("F0")).toBe("/F0");
    expect(pdfName("my font")).toBe("/my#20font");
    expect(pdfName("a/b")).toBe("/a#2Fb");
    expect(pdfName("a#b")).toBe("/a#23b");
    expect(pdfName("(x)")).toBe("/#28x#29");
    // "가" = U+AC00 = UTF-8 EA B0 80 → 코드 유닛 하나가 아니라 바이트 세 개다.
    expect(pdfName("가")).toBe("/#EA#B0#80");
  });

  it("hex 텍스트는 UTF-16BE + BOM이다", () => {
    expect(pdfHexText("A")).toBe("<FEFF0041>");
    expect(pdfHexText("가")).toBe("<FEFFAC00>");
  });

  it("단위 변환 계수가 기존 래스터 라이터와 일치한다", () => {
    expect(STUDIO_PDF_PX_TO_PT).toBe(0.75);
    expect(pxToPt(690)).toBe(517.5);
    expect(mmToPt(25.4)).toBeCloseTo(72, 12);
  });
});

describe("색 연산자 — DeviceCMYK 방출", () => {
  it("채움은 소문자 k, 획은 대문자 K를 쓴다", () => {
    expect(fillColorOperator({ space: "cmyk", c: 0, m: 0.4, y: 0.4, k: 1 })).toBe("0 0.4 0.4 1 k");
    expect(strokeColorOperator({ space: "cmyk", c: 0.6, m: 0, y: 0, k: 1 })).toBe("0.6 0 0 1 K");
  });

  it("RGB·Gray 연산자도 규격대로 낸다", () => {
    expect(fillColorOperator({ space: "rgb", r: 1, g: 0.5, b: 0 })).toBe("1 0.5 0 rg");
    expect(strokeColorOperator({ space: "rgb", r: 0, g: 0, b: 1 })).toBe("0 0 1 RG");
    expect(fillColorOperator({ space: "gray", gray: 0.25 })).toBe("0.25 g");
    expect(strokeColorOperator({ space: "gray", gray: 0 })).toBe("0 G");
  });

  it("콘텐츠 스트림에 CMYK 연산자가 실제로 들어간다", () => {
    const text = latin1(buildVectorPdf(simpleDoc()));
    expect(text).toContain("0 0.4 0.4 0.6 k");
    expect(text).toContain("0 0 0 1 K");
    expect(text).toContain("[3 2] 0 d");
    expect(text).toContain("1 J");
    expect(text).toContain("B");
  });
});

describe("바이트 구조 — 헤더·xref·trailer", () => {
  const bytes = buildVectorPdf(simpleDoc());
  const text = latin1(bytes);

  it("헤더와 바이너리 마커가 규격대로 앞에 온다", () => {
    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(Array.from(bytes.subarray(9, 15))).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
  });

  it("%%EOF로 끝나고 startxref가 정확히 하나다", () => {
    expect(text.endsWith("%%EOF")).toBe(true);
    expect(countOf(text, "startxref")).toBe(1);
    expect(countOf(text, "%%EOF")).toBe(1);
  });

  it("startxref 오프셋이 실제 xref 표 위치를 가리킨다", () => {
    const match = /startxref\n(\d+)\n%%EOF$/u.exec(text);
    expect(match).not.toBeNull();
    const offset = Number(match![1]);
    expect(text.startsWith("xref\n", offset)).toBe(true);
  });

  it("xref 항목은 정확히 20바이트이고 모든 오브젝트 오프셋이 'N 0 obj'를 가리킨다", () => {
    const xrefStart = xrefTableStart(text);
    const header = /^xref\n0 (\d+)\n/u.exec(text.slice(xrefStart))!;
    const size = Number(header[1]);
    const entriesStart = xrefStart + header[0].length;
    expect(text.slice(entriesStart, entriesStart + 20)).toBe("0000000000 65535 f \n");
    for (let num = 1; num < size; num++) {
      const entry = text.slice(entriesStart + num * 20, entriesStart + (num + 1) * 20);
      expect(entry).toHaveLength(20);
      const entryMatch = /^(\d{10}) 00000 n \n$/u.exec(entry);
      expect(entryMatch, `xref 항목 ${num}: ${JSON.stringify(entry)}`).not.toBeNull();
      const offset = Number(entryMatch![1]);
      expect(text.startsWith(`${num} 0 obj`, offset), `오브젝트 ${num}`).toBe(true);
    }
    // trailer는 항목 바로 뒤에 온다.
    expect(text.startsWith("trailer\n", entriesStart + size * 20)).toBe(true);
  });

  it("trailer의 /Size가 실제 오브젝트 수 + 1이다", () => {
    const size = Number(/\/Size (\d+)/u.exec(text)![1]);
    const objCount = countOf(text, " 0 obj\n");
    expect(size).toBe(objCount + 1);
  });

  it("오브젝트 번호는 1부터 빈틈없이 이어진다", () => {
    const numbers = [...text.matchAll(/^(\d+) 0 obj$/gmu)].map((match) => Number(match[1]));
    expect(numbers).toEqual(numbers.slice().sort((a, b) => a - b));
    expect(numbers[0]).toBe(1);
    for (let i = 1; i < numbers.length; i++) expect(numbers[i]).toBe(numbers[i - 1]! + 1);
  });

  it("/Length가 스트림 실제 바이트 수와 정확히 맞는다(바이너리 안전)", () => {
    const withImage = buildVectorPdf(
      simpleDoc({
        images: [{ name: "Im0", jpegBytes: fakeJpeg(7), widthPx: 100, heightPx: 50, colorSpace: "rgb" }],
        pages: [{ widthPt: 200, heightPt: 100, ops: [{ op: "image", name: "Im0", x: 0, y: 0, width: 200, height: 100 }] }],
      }),
    );
    const raw = latin1(withImage);
    const pattern = /\/Length (\d+) >>\nstream\n/gu;
    let match: RegExpExecArray | null = pattern.exec(raw);
    let checked = 0;
    while (match) {
      const length = Number(match[1]);
      const dataStart = match.index + match[0].length;
      expect(raw.startsWith("\nendstream", dataStart + length)).toBe(true);
      checked++;
      match = pattern.exec(raw);
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe("결정성", () => {
  it("같은 입력이면 바이트가 완전히 같다", () => {
    const a = buildVectorPdf(simpleDoc());
    const b = buildVectorPdf(simpleDoc());
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("기본값으로는 날짜를 넣지 않는다", () => {
    expect(latin1(buildVectorPdf(simpleDoc()))).not.toContain("/CreationDate");
  });

  it("주입한 날짜만 정확히 그대로 나온다", () => {
    const text = latin1(buildVectorPdf(simpleDoc({ creationDate: "D:20260724120000+09'00'" })));
    expect(text).toContain("/CreationDate (D:20260724120000+09'00')");
  });

  it("페이지 순서가 바뀌면 바이트도 달라진다(민감도 확인)", () => {
    const one = buildVectorPdf(simpleDoc({ pages: [{ widthPt: 100, heightPt: 200, ops: [] }] }));
    const two = buildVectorPdf(simpleDoc({ pages: [{ widthPt: 200, heightPt: 100, ops: [] }] }));
    expect(latin1(one)).not.toBe(latin1(two));
  });
});

describe("왕복 — 직접 만든 리더로 되읽기", () => {
  it("페이지 수·크기·제목을 그대로 되읽는다", () => {
    const bytes = buildVectorPdf({
      pages: [
        { widthPt: 420, heightPt: 594, ops: [rectPath] },
        { widthPt: 300, heightPt: 300, ops: [] },
      ],
      title: "웹툰 원고",
      author: "작가",
    });
    const document = readOk(bytes);
    expect(document.version).toBe("1.7");
    expect(document.pages).toHaveLength(2);
    expect(document.pages[0]!.mediaBox).toEqual([0, 0, 420, 594]);
    expect(document.pages[1]!.mediaBox).toEqual([0, 0, 300, 300]);
    expect(document.info).toContain(pdfHexText("웹툰 원고"));
    expect(document.info).toContain("/Producer (ToonSpectrum Studio)");
  });

  it("xref가 선언한 오브젝트 수와 실제로 읽힌 오브젝트 수가 일치한다", () => {
    const document = readOk(buildVectorPdf(simpleDoc()));
    expect(document.objectOffsets.size).toBe(document.size - 1);
    expect(document.objectBodies.size).toBe(document.size - 1);
  });

  it("콘텐츠 스트림 연산자를 되읽는다(좌상단 원점 뒤집기 포함)", () => {
    const document = readOk(buildVectorPdf(simpleDoc()));
    const content = document.pages[0]!.content;
    expect(content.startsWith("q\n1 0 0 -1 0 594 cm")).toBe(true);
    expect(content).toContain("10 10 m");
    expect(content).toContain("130 30 130 70 110 90 c");
    expect(content).toContain("h");
    expect(content.endsWith("Q")).toBe(true);
  });

  it("originTopLeft를 끄면 뒤집기 행렬을 넣지 않는다", () => {
    const document = readOk(buildVectorPdf(simpleDoc({ originTopLeft: false })));
    expect(document.pages[0]!.content).not.toContain("1 0 0 -1 0 594 cm");
  });

  it("재단·도련 박스를 되읽는다", () => {
    const boxes = printPageBoxes({ trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3 });
    const document = readOk(
      buildVectorPdf({
        pages: [{ widthPt: boxes.widthPt, heightPt: boxes.heightPt, ops: [], trimBox: boxes.trimBox, bleedBox: boxes.bleedBox }],
      }),
    );
    const page = document.pages[0]!;
    expect(page.trimBox).not.toBeNull();
    expect(page.trimBox![0]).toBeCloseTo(mmToPt(3), 3);
    expect(page.trimBox![2]! - page.trimBox![0]!).toBeCloseTo(mmToPt(148), 2);
    expect(page.mediaBox[2]).toBeCloseTo(mmToPt(154), 2);
  });

  it("이미지 XObject와 CMYK JPEG 반전 지시를 되읽는다", () => {
    const document = readOk(
      buildVectorPdf({
        pages: [{ widthPt: 200, heightPt: 100, ops: [{ op: "image", name: "Im0", x: 0, y: 0, width: 200, height: 100 }] }],
        images: [
          { name: "Im0", jpegBytes: fakeJpeg(3), widthPx: 400, heightPx: 200, colorSpace: "cmyk", adobeInverted: true },
        ],
      }),
    );
    expect(document.pages[0]!.content).toContain("/Im0 Do");
    expect(document.pages[0]!.dict).toContain("/XObject");
    const imageBody = [...document.objectBodies.values()].find((body) => body.includes("/Subtype /Image"))!;
    expect(imageBody).toContain("/ColorSpace /DeviceCMYK");
    expect(imageBody).toContain("/Decode [1 0 1 0 1 0 1 0]");
    expect(imageBody).toContain("/Filter /DCTDecode");
  });

  it("투명도는 ExtGState로 모이고 같은 조합은 하나로 합쳐진다", () => {
    const translucent: StudioPdfOp = {
      op: "path",
      commands: [{ op: "move", x: 0, y: 0 }, { op: "line", x: 10, y: 10 }],
      fill: { color: { space: "gray", gray: 0 }, alpha: 0.5 },
    };
    const document = readOk(
      buildVectorPdf({ pages: [{ widthPt: 100, heightPt: 100, ops: [translucent, translucent] }] }),
    );
    const states = [...document.objectBodies.values()].filter((body) => body.includes("/Type /ExtGState"));
    expect(states).toHaveLength(1);
    expect(states[0]).toContain("/ca 0.5");
    expect(countOf(document.pages[0]!.content, "/GS0 gs")).toBe(2);
  });

  it("불투명한 그리기에는 ExtGState를 만들지 않는다", () => {
    const document = readOk(buildVectorPdf(simpleDoc()));
    expect([...document.objectBodies.values()].some((body) => body.includes("/ExtGState"))).toBe(false);
  });
});

describe("글꼴 임베드", () => {
  it("표준 14 폰트는 바이트 없이 Type1로 참조한다", () => {
    const document = readOk(
      buildVectorPdf({
        pages: [
          {
            widthPt: 200,
            heightPt: 100,
            ops: [{ op: "text", text: "AB", font: "F1", size: 12, x: 10, y: 20, color: { space: "gray", gray: 0 } }],
          },
        ],
        fonts: [standardFont],
      }),
    );
    const fontBody = [...document.objectBodies.values()].find((body) => body.includes("/Subtype /Type1"))!;
    expect(fontBody).toContain("/BaseFont /Helvetica");
    expect(fontBody).toContain("/Encoding /WinAnsiEncoding");
    // WinAnsi hex — 'A'=41, 'B'=42.
    expect(document.pages[0]!.content).toContain("<4142> Tj");
  });

  it("표준 14 폰트로 표현할 수 없는 유니코드는 물음표로 바꾸지 않고 fail-closed한다", () => {
    expect(() => buildVectorPdf({
      pages: [{
        widthPt: 200,
        heightPt: 100,
        ops: [{ op: "text", text: "漢字", font: "F1", size: 12, x: 10, y: 20, color: { space: "gray", gray: 0 } }],
      }],
      fonts: [standardFont],
    })).toThrow("CID TrueType 글꼴");
  });

  it("CID 임베드는 Type0 + CIDFontType2 + FontFile2 체인을 만든다", () => {
    const bytes = buildVectorPdf({
      pages: [
        {
          widthPt: 200,
          heightPt: 100,
          ops: [{ op: "text", text: "가나", font: "F0", size: 16, x: 10, y: 30, color: { space: "cmyk", c: 0, m: 0, y: 0, k: 1 } }],
        },
      ],
      fonts: [cidFont],
      fontEmbeddingIntent: "editable",
    });
    const document = readOk(bytes);
    const bodies = [...document.objectBodies.values()];
    expect(bodies.some((body) => body.includes("/Subtype /Type0") && body.includes("/Encoding /Identity-H"))).toBe(true);
    const descendant = bodies.find((body) => body.includes("/Subtype /CIDFontType2"))!;
    expect(descendant).toContain("/Ordering (Identity)");
    expect(descendant).toContain("/CIDToGIDMap /Identity");
    // 연속 글리프(0,1)는 한 묶음, 떨어진 (3,4)는 다음 묶음으로 합쳐진다.
    expect(descendant).toContain("/W [0 [500 600] 3 [1000 1000]]");
    const descriptor = bodies.find((body) => body.includes("/Type /FontDescriptor"))!;
    expect(descriptor).toContain("/FontBBox [0 -200 1000 800]");
    expect(descriptor).toContain("/Ascent 800");
    expect(descriptor).toContain("/CapHeight 700");
    // 글리프 인덱스로 인코딩됐는지 — 가=3, 나=4.
    expect(document.pages[0]!.content).toContain("<00030004> Tj");
    // 폰트 바이트가 원본 그대로 스트림에 들어갔는지(바이너리 안전).
    const fontStream = [...document.streams.values()].find((stream) => stream.length === 7);
    expect(fontStream).toBeDefined();
    expect(Array.from(fontStream!)).toEqual(Array.from(cidFont.kind === "truetype-cid" ? cidFont.fontBytes : []));
    expect(latin1(bytes)).toContain("/Length1 7");
  });

  it("CID 글꼴에 없는 루비/본문 글리프를 .notdef로 조용히 바꾸지 않는다", () => {
    expect(() => buildVectorPdf({
      pages: [{
        widthPt: 200,
        heightPt: 100,
        ops: [{ op: "text", text: "漢", font: "F0", size: 12, x: 10, y: 20, color: { space: "gray", gray: 0 } }],
      }],
      fonts: [cidFont],
      fontEmbeddingIntent: "editable",
    })).toThrow("필요한 글리프");
  });

  it("CID 글꼴은 문서 의도를 생략하면 임베딩하지 않는다(fail-closed)", () => {
    expect(() => buildVectorPdf(simpleDoc({ fonts: [cidFont] }))).toThrow("읽기·인쇄 전용인지");
  });

  it("CFF 윤곽선을 TrueType CIDFontType2/FontFile2로 잘못 포장하지 않는다", () => {
    const cffFont: StudioPdfFontResource = {
      ...cidFont,
      metrics: { ...metrics, hasCffOutlines: true },
    };
    expect(() =>
      buildVectorPdf(simpleDoc({
        fonts: [cffFont],
        fontEmbeddingIntent: "editable",
      })),
    ).toThrow("CIDFontType0/FontFile3");
  });

  it("Restricted·Bitmap-only 글꼴은 FontFile2 아웃라인 스트림 생성을 막는다", () => {
    const restricted: StudioPdfFontResource = {
      ...cidFont,
      metrics: { ...metrics, embeddingPolicy: parseSfntEmbeddingPolicy(2) },
    };
    const bitmapOnly: StudioPdfFontResource = {
      ...cidFont,
      metrics: { ...metrics, embeddingPolicy: parseSfntEmbeddingPolicy(0x0208) },
    };
    expect(() =>
      buildVectorPdf(simpleDoc({ fonts: [restricted], fontEmbeddingIntent: "preview-print" })),
    ).toThrow("Restricted License");
    expect(() =>
      buildVectorPdf(simpleDoc({ fonts: [bitmapOnly], fontEmbeddingIntent: "editable" })),
    ).toThrow("내장 비트맵만");
  });

  it("Preview & Print 글꼴은 읽기·인쇄 의도만 허용한다", () => {
    const previewPrint: StudioPdfFontResource = {
      ...cidFont,
      metrics: { ...metrics, embeddingPolicy: parseSfntEmbeddingPolicy(4) },
    };
    expect(() =>
      buildVectorPdf(simpleDoc({ fonts: [previewPrint], fontEmbeddingIntent: "editable" })),
    ).toThrow("읽기·인쇄 전용 PDF");
    expect(() =>
      buildVectorPdf(simpleDoc({ fonts: [previewPrint], fontEmbeddingIntent: "preview-print" })),
    ).not.toThrow();
  });

  it("텍스트가 없는 글꼴을 참조하면 조립 단계에서 막는다", () => {
    expect(() =>
      buildVectorPdf({
        pages: [
          {
            widthPt: 100,
            heightPt: 100,
            ops: [{ op: "text", text: "A", font: "없는폰트", size: 12, x: 0, y: 0, color: { space: "gray", gray: 0 } }],
          },
        ],
        fonts: [standardFont],
      }),
    ).toThrow("없는폰트");
  });

  it("글꼴 리소스 이름이 겹치면 거절한다", () => {
    expect(() => buildVectorPdf(simpleDoc({ fonts: [standardFont, { ...standardFont }] }))).toThrow("겹쳐요");
  });

  it("텍스트 행렬이 좌상단 원점에서 글자를 바로 세운다", () => {
    const document = readOk(
      buildVectorPdf({
        pages: [
          {
            widthPt: 200,
            heightPt: 100,
            ops: [{ op: "text", text: "A", font: "F1", size: 12, x: 5, y: 40, color: { space: "gray", gray: 0 } }],
          },
        ],
        fonts: [standardFont],
      }),
    );
    expect(document.pages[0]!.content).toContain("1 0 0 -1 5 40 Tm");
  });
});

describe("OutputIntent — 인쇄 조건 선언", () => {
  it("ICC 프로파일 바이트를 스트림으로 넣고 카탈로그에서 참조한다", () => {
    const profile = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const document = readOk(
      buildVectorPdf(
        simpleDoc({
          outputIntent: {
            profileBytes: profile,
            identifier: "FOGRA39",
            condition: "Coated FOGRA39 (ISO 12647-2:2004)",
            info: "인쇄소 제공",
            components: 4,
          },
        }),
      ),
    );
    expect(document.catalog).toContain("/OutputIntents [");
    const intent = [...document.objectBodies.values()].find((body) => body.includes("/Type /OutputIntent"))!;
    expect(intent).toContain("/S /GTS_PDFX");
    expect(intent).toContain("/OutputConditionIdentifier (FOGRA39)");
    expect(intent).toContain("/DestOutputProfile");
    const profileBody = [...document.objectBodies.values()].find((body) => body.includes("/N 4"))!;
    expect(profileBody).toBeDefined();
  });

  it("괄호가 든 조건 문자열을 이스케이프한다(리터럴 문자열 깨짐 방지)", () => {
    const document = readOk(
      buildVectorPdf(
        simpleDoc({
          outputIntent: {
            profileBytes: Uint8Array.from([0]),
            identifier: "X(1)",
            condition: "a) b(",
            info: "c\\d",
            components: 4,
          },
        }),
      ),
    );
    const intent = [...document.objectBodies.values()].find((body) => body.includes("/Type /OutputIntent"))!;
    expect(intent).toContain("(X\\(1\\))");
    expect(intent).toContain("(a\\) b\\()");
    expect(intent).toContain("(c\\\\d)");
  });
});

describe("사전검사 리포트", () => {
  it("CMYK·재단선·글꼴 임베드 여부를 요약한다", () => {
    const boxes = printPageBoxes({ trimWidthMm: 148, trimHeightMm: 210, bleedMm: 3 });
    const document = readOk(
      buildVectorPdf({
        pages: [
          {
            widthPt: boxes.widthPt,
            heightPt: boxes.heightPt,
            ops: [rectPath, { op: "text", text: "가", font: "F0", size: 12, x: 10, y: 20, color: { space: "cmyk", c: 0, m: 0, y: 0, k: 1 } }],
            trimBox: boxes.trimBox,
            bleedBox: boxes.bleedBox,
          },
        ],
        fonts: [cidFont],
        fontEmbeddingIntent: "editable",
        outputIntent: {
          profileBytes: Uint8Array.from([0, 1]),
          identifier: "FOGRA39",
          condition: "Coated",
          info: "test",
          components: 4,
        },
      }),
    );
    const report = inspectPdf(document);
    expect(report.pageCount).toBe(1);
    expect(report.usesCmyk).toBe(true);
    expect(report.usesRgb).toBe(false);
    expect(report.hasTrimBoxes).toBe(true);
    expect(report.hasOutputIntent).toBe(true);
    expect(report.embeddedFontCount).toBe(1);
    expect(report.summary).toContain("CMYK 색 사용");
    expect(report.summary).toContain("재단선(TrimBox) 있음");
  });

  it("RGB만 쓴 문서는 그렇게 보고한다", () => {
    const document = readOk(
      buildVectorPdf({
        pages: [
          {
            widthPt: 100,
            heightPt: 100,
            ops: [
              {
                op: "path",
                commands: [{ op: "move", x: 0, y: 0 }, { op: "line", x: 10, y: 10 }],
                fill: { color: { space: "rgb", r: 1, g: 0, b: 0 } },
              },
            ],
          },
        ],
      }),
    );
    const report = inspectPdf(document);
    expect(report.usesCmyk).toBe(false);
    expect(report.usesRgb).toBe(true);
    expect(report.hasTrimBoxes).toBe(false);
    expect(report.hasOutputIntent).toBe(false);
    expect(report.embeddedFontCount).toBe(0);
    expect(report.summary).toContain("RGB 색만 사용");
  });
});

describe("입력 검증", () => {
  it("페이지가 없으면 거절한다", () => {
    expect(() => buildVectorPdf({ pages: [] })).toThrow("내보낼 페이지가 없어요");
  });

  it("페이지 크기가 0이거나 NaN이면 거절한다", () => {
    expect(() => buildVectorPdf({ pages: [{ widthPt: 0, heightPt: 100, ops: [] }] })).toThrow("크기가 올바르지 않아요");
    expect(() => buildVectorPdf({ pages: [{ widthPt: Number.NaN, heightPt: 100, ops: [] }] })).toThrow();
  });

  it("JPEG이 아닌 이미지는 거절한다(PNG 폴백 가드)", () => {
    expect(() =>
      buildVectorPdf(
        simpleDoc({ images: [{ name: "Im0", jpegBytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), widthPx: 1, heightPx: 1, colorSpace: "rgb" }] }),
      ),
    ).toThrow("JPEG 형식이 아니");
  });

  it("클립 패스는 W/W* n으로 방출된다", () => {
    const document = readOk(
      buildVectorPdf({
        pages: [
          {
            widthPt: 100,
            heightPt: 100,
            ops: [
              { op: "save" },
              { op: "clip", commands: [{ op: "move", x: 0, y: 0 }, { op: "line", x: 50, y: 50 }, { op: "close" }], rule: "evenodd" },
              rectPath,
              { op: "restore" },
            ],
          },
        ],
      }),
    );
    expect(document.pages[0]!.content).toContain("W* n");
    expect(countOf(document.pages[0]!.content, "\nq\n")).toBeGreaterThanOrEqual(1);
  });

  it("even-odd 채움은 f*를, nonzero는 f를 쓴다", () => {
    const make = (rule: "nonzero" | "evenodd") =>
      latin1(
        buildVectorPdf({
          pages: [
            {
              widthPt: 100,
              heightPt: 100,
              ops: [
                {
                  op: "path",
                  commands: [{ op: "move", x: 0, y: 0 }, { op: "line", x: 10, y: 0 }, { op: "close" }],
                  fill: { color: { space: "gray", gray: 0 }, rule },
                },
              ],
            },
          ],
        }),
      );
    expect(make("evenodd")).toContain("\nf*\n");
    expect(make("nonzero")).toContain("\nf\n");
  });
});

describe("리더 방어", () => {
  it("PDF가 아닌 바이트를 거절한다", () => {
    const result = readPdf(Uint8Array.from([1, 2, 3, 4]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("%PDF");
  });

  it("startxref가 어긋나면 거절한다", () => {
    const bytes = buildVectorPdf(simpleDoc());
    const text = latin1(bytes).replace(/startxref\n\d+/u, "startxref\n7");
    const result = readPdf(Uint8Array.from(text, (char) => char.charCodeAt(0)));
    expect(result.ok).toBe(false);
  });

  it("오브젝트 오프셋이 어긋나면 거절한다(xref 무결성)", () => {
    const bytes = buildVectorPdf(simpleDoc());
    const text = latin1(bytes);
    const xrefStart = xrefTableStart(text);
    const header = /^xref\n0 (\d+)\n/u.exec(text.slice(xrefStart))!;
    const first = xrefStart + header[0].length + 20;
    const broken = `${text.slice(0, first)}0000000099${text.slice(first + 10)}`;
    const result = readPdf(Uint8Array.from(broken, (char) => char.charCodeAt(0)));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("오브젝트");
  });

  it("스트림 /Length가 거짓이면 거절한다", () => {
    const text = latin1(buildVectorPdf(simpleDoc())).replace(/\/Length (\d+) >>\nstream/u, "/Length 3 >>\nstream");
    const result = readPdf(Uint8Array.from(text, (char) => char.charCodeAt(0)));
    expect(result.ok).toBe(false);
  });
});
