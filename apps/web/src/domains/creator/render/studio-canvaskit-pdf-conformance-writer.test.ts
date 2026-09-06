import { describe, expect, it } from "vitest";

import { buildMatrixTrcIccProfile } from "./studio-canvaskit-icc-profile";
import {
  buildVectorPdf,
  type StudioPdfDocument,
} from "./studio-canvaskit-pdf-vector";

import type { StudioPdfFontResource } from "./studio-canvaskit-pdf-font";

const encoder = new TextDecoder("latin1");
const utf8Decoder = new TextDecoder();
const fileIdentifierHex = "00112233445566778899AABBCCDDEEFF";
const createdAt = "2026-07-30T01:02:03Z";
const modifiedAt = "2026-07-30T04:05:06Z";

function latin1(bytes: Uint8Array): string {
  return encoder.decode(bytes);
}

function outputIntent() {
  return {
    profileBytes: buildMatrixTrcIccProfile(),
    identifier: "ToonSpectrum-sRGB",
    condition: "sRGB IEC 61966-2-1",
    info: "ToonSpectrum deterministic public profile",
    components: 3 as const,
  };
}

function candidate(
  target: "pdf-a-2b" | "pdf-x-4",
  overrides: Partial<StudioPdfDocument> = {},
): StudioPdfDocument {
  return {
    pages: [
      {
        widthPt: 120,
        heightPt: 180,
        ops: [],
        ...(target === "pdf-x-4"
          ? {
              trimBox: [6, 6, 114, 174] as const,
              bleedBox: [3, 3, 117, 177] as const,
            }
          : {}),
      },
    ],
    title: "검증 <원고>",
    author: "Toon & Team",
    producer: "ToonSpectrum Studio",
    outputIntent: outputIntent(),
    conformance: {
      target,
      fileIdentifierHex,
      createdAt,
      modifiedAt,
    },
    ...overrides,
  };
}

describe("Studio vector PDF conformance candidate writer", () => {
  it("PDF/A-2b 후보는 PDF 1.7·XMP·GTS_PDFA1·결정적 trailer ID를 기록한다", () => {
    const text = latin1(buildVectorPdf(candidate("pdf-a-2b")));

    expect(text.startsWith("%PDF-1.7\n")).toBe(true);
    expect(text).toContain("/S /GTS_PDFA1");
    expect(text).toContain("/Type /Metadata /Subtype /XML");
    expect(text).toContain("pdfaid:part=\"2\"");
    expect(text).toContain("pdfaid:conformance=\"B\"");
    expect(text).toContain("<xmp:CreateDate>2026-07-30T01:02:03Z</xmp:CreateDate>");
    expect(text).toContain("<xmp:ModifyDate>2026-07-30T04:05:06Z</xmp:ModifyDate>");
    expect(text).toContain("/CreationDate (D:20260730010203Z)");
    expect(text).toContain("/ModDate (D:20260730040506Z)");
    expect(text).toContain(`/ID [<${fileIdentifierHex}><${fileIdentifierHex}>]`);
    expect(text).not.toContain("/GTS_PDFXVersion");
  });

  it("PDF/X-4 후보는 PDF 1.6·XMP·인쇄 조건·Trapped 선언을 기록한다", () => {
    const text = latin1(buildVectorPdf(candidate("pdf-x-4")));

    expect(text.startsWith("%PDF-1.6\n")).toBe(true);
    expect(text).toContain("/S /GTS_PDFX");
    expect(text).toContain("/RegistryName (http://www.color.org)");
    expect(text).toContain("pdfxid:GTS_PDFXVersion=\"PDF/X-4\"");
    expect(text).toContain("/GTS_PDFXVersion (PDF/X-4)");
    expect(text).toContain("/Trapped /False");
    expect(text).toContain("/TrimBox [6 6 114 174]");
    expect(text).toContain("/BleedBox [3 3 117 177]");
  });

  it("XMP 사용자 문자열을 XML로 이스케이프하고 출력은 결정적이다", () => {
    const first = buildVectorPdf(candidate("pdf-a-2b"));
    const second = buildVectorPdf(candidate("pdf-a-2b"));
    const text = utf8Decoder.decode(first);

    expect(Array.from(first)).toEqual(Array.from(second));
    expect(text).toContain("검증 &lt;원고&gt;");
    expect(text).toContain("Toon &amp; Team");
  });

  it("OutputIntent·ICC 서명·프로필 크기·색공간을 fail-closed로 검사한다", () => {
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", { outputIntent: undefined })),
    ).toThrow("ICC OutputIntent");
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", {
        outputIntent: { ...outputIntent(), profileBytes: new Uint8Array(132) },
      })),
    ).toThrow("ICC 프로파일의 선언 크기");
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", {
        outputIntent: { ...outputIntent(), components: 4 },
      })),
    ).toThrow("ICC 색공간과 성분 수");
  });

  it("PDF/X-4의 TrimBox와 BleedBox 포함 관계를 강제한다", () => {
    expect(() =>
      buildVectorPdf(candidate("pdf-x-4", {
        pages: [{ widthPt: 100, heightPt: 100, ops: [] }],
      })),
    ).toThrow("TrimBox");
    expect(() =>
      buildVectorPdf(candidate("pdf-x-4", {
        pages: [{
          widthPt: 100,
          heightPt: 100,
          ops: [],
          trimBox: [-1, 0, 90, 90],
        }],
      })),
    ).toThrow("MediaBox");
    expect(() =>
      buildVectorPdf(candidate("pdf-x-4", {
        pages: [{
          widthPt: 100,
          heightPt: 100,
          ops: [],
          trimBox: [5, 5, 95, 95],
          bleedBox: [10, 10, 90, 90],
        }],
      })),
    ).toThrow("BleedBox");
  });

  it("적합성 식별자·날짜를 엄격히 검증한다", () => {
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", {
        conformance: {
          target: "pdf-a-2b",
          fileIdentifierHex: "ABC",
          createdAt,
          modifiedAt,
        },
      })),
    ).toThrow("32자리 hex");
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", {
        conformance: {
          target: "pdf-a-2b",
          fileIdentifierHex,
          createdAt: "2026-07-30",
          modifiedAt,
        },
      })),
    ).toThrow("UTC ISO-8601");
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", {
        conformance: {
          target: "pdf-a-2b",
          fileIdentifierHex,
          createdAt: modifiedAt,
          modifiedAt: createdAt,
        },
      })),
    ).toThrow("생성 날짜보다");
  });

  it("표시 텍스트가 표준 14 폰트에 기대는 후보 파일을 거부한다", () => {
    const standardFont: StudioPdfFontResource = {
      kind: "standard-14",
      resourceName: "F1",
      baseFont: "Helvetica",
    };
    expect(() =>
      buildVectorPdf(candidate("pdf-a-2b", {
        pages: [{
          widthPt: 100,
          heightPt: 100,
          ops: [{
            op: "text",
            text: "A",
            font: "F1",
            size: 12,
            x: 10,
            y: 10,
            color: { space: "gray", gray: 0 },
          }],
        }],
        fonts: [standardFont],
      })),
    ).toThrow("모든 글꼴 프로그램을 임베드");
  });
});
