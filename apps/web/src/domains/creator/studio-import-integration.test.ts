/**
 * Studio 가져오기 파이프라인 통합 매트릭스 — 모든 파일 가져오기 경로를 "실제 바이트"로 검증한다.
 *
 * 각 포맷은 (a) 스펙대로 손으로 만든 픽스처 바이트 또는 (b) 대칭 내보내기(export)가 있는 경우
 * export→import 왕복으로 검증한다. 픽셀·레이어·메타데이터 결과까지 단언해, accept 문자열만 있고
 * 실제로는 디코드되지 않는 "죽은 가져오기" 회귀를 이 파일 하나로 잡는 것이 목적이다.
 *
 * 매트릭스(포맷 → 디코더):
 *  - BMP/TGA/PPM/PAM/QOI/TIFF → studio-raster-interchange (+ studio-canvas-image-io 라우팅)
 *  - GIF(정적/애니) → studio-gif-element / studio-reference-import 시그니처 검사
 *  - 참고 이미지 배치 예산 → studio-reference-import
 *  - 커스텀 브러시 팁 PNG(실제 zlib IDAT) → studio-brush-tip-import
 *  - PSD(ag-psd 실바이트 왕복) → studio-psd-import
 *  - ORA 왕복 → studio-openraster-interchange
 *  - CBZ(ComicInfo 포함) 왕복 → studio-cbz-interchange
 *  - 프로젝트 .json 왕복 → studio-project-file
 *  - .toonproject.zip 왕복(+손상 거부) → studio-project-archive / studio-zip-reader
 *  - ABR(스펙대로 손으로 만든 v10 바이트) → studio-abr-import
 *  - 3D GLB 무결성(sha256) → studio-bg3d-glb-validation / studio-bg3d-model-import 플래너
 *  - VRM(GLB 컨테이너 + VRM 확장) → vrm-library
 *  - 팔레트(ACO/ACT/ASE/PAL/GPL/CSS/JSON) 왕복 → studio-palette-interchange
 *  - UI accept ↔ 디코더 경계(소스 단면 검증)
 */

import { readFileSync } from "node:fs";
import { crc32, deflateSync, inflateSync } from "node:zlib";

import { initializeCanvas, writePsdBuffer } from "ag-psd";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
  STUDIO_BG3D_GLB_MAX_BYTES,
  STUDIO_BG3D_GLB_MIME_TYPE,
  validateStudioBg3dGlb,
  type StudioBg3dGlbValidationOptions,
} from "./bg3d/studio-bg3d-glb-validation";
import {
  planStudioBg3dModelImports,
  STUDIO_BG3D_IMPORT_COMPANION_FORMATS,
  STUDIO_BG3D_IMPORT_PRIMARY_FORMATS,
  StudioBg3dModelImportError,
} from "./bg3d/studio-bg3d-model-import";
import {
  buildStudioBrushTipAlphaMask,
  importStudioBrushTipPng,
  parseStudioBrushTipPngHeader,
  StudioBrushTipImportError,
  type StudioBrushTipDecodedPixels,
} from "./brush/studio-brush-tip-import";
import {
  STUDIO_CANVAS_IMAGE_ACCEPT,
  studioOpenRasterFormatForFile,
} from "./canvas/studio-canvas-image-io";
import {
  decodeStudioRasterInterchange,
  encodeStudioRasterInterchange,
  StudioRasterInterchangeError,
  type StudioRasterInterchangeFormat,
} from "./render/studio-raster-interchange";
import { parseStudioAbrBuffer, StudioAbrImportError } from "./studio-abr-import";
import {
  buildStudioCbzBytes,
  importStudioCbz,
  StudioCbzError,
} from "./studio-cbz-interchange";
import { readStudioCuttoonEditorSource } from "./studio-cuttoon-editor/read-studio-cuttoon-editor-source";
import { isAnimatedGifBytes, isAnimatedGifDataUrl, isGifFile } from "./studio-gif-element";
import {
  buildStudioOpenRasterBytes,
  importStudioOpenRaster,
  StudioOpenRasterError,
} from "./studio-openraster-interchange";
import { buildStudioPackageArchiveBytes } from "./studio-package-archive";
import {
  exportStudioPalette,
  importStudioPalette,
  type StudioPaletteInterchangeFormat,
} from "./studio-palette-interchange";
import {
  buildStudioProjectArchive,
  importStudioProjectArchive,
} from "./studio-project-archive";
import { parseStudioProjectFile, serializeStudioProjectFile } from "./studio-project-file";
import { importPsdFile } from "./studio-psd-import";
import {
  assertStudioReferenceGifSignature,
  assertStudioReferenceImportBatch,
  isStudioReferenceImportFile,
  planStudioReferenceImports,
  STUDIO_REFERENCE_IMPORT_ACCEPT,
} from "./studio-reference-import";
import { readStudioZipArchive, StudioZipReaderError } from "./studio-zip-reader";
import { validateVrmGlbBytes } from "./vrm/vrm-library";

const encoder = new TextEncoder();

function componentSource(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), "utf8");
}

// ── 공용 픽스처 빌더 ─────────────────────────────────────────────────────────

/** 시그니처+IHDR+IDAT+IEND 골격 PNG — 헤더 검증 기반 가져오기(ORA/CBZ/GLB) 픽스처. */
function pngHeaderBytes(width: number, height: number, seed = 1): Uint8Array {
  const bytes = new Uint8Array(58);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set(encoder.encode("IHDR"), 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes.set([8, 6, 0, 0, 0], 24);
  view.setUint32(33, 1, false);
  bytes.set(encoder.encode("IDAT"), 37);
  bytes[41] = seed;
  view.setUint32(46, 0, false);
  bytes.set(encoder.encode("IEND"), 50);
  return bytes;
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + payload.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length, false);
  chunk.set(encoder.encode(type), 4);
  chunk.set(payload, 8);
  view.setUint32(8 + payload.length, crc32(chunk.subarray(4, 8 + payload.length)), false);
  return chunk;
}

/** zlib IDAT까지 갖춘 완전한 8-bit RGBA PNG(필터 0) — 실제 픽셀 디코드가 가능한 진짜 PNG. */
function realRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  expect(rgba.length).toBe(width * height * 4);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (1 + width * 4) + 1);
  }
  const idat = new Uint8Array(deflateSync(raw));
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0))];
  const total = signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(total);
  bytes.set(signature, 0);
  let offset = signature.length;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/** realRgbaPng의 역방향(필터 0 전용) — 브라우저 없이 IDAT 픽셀을 실제로 되읽는다. */
function decodeRealRgbaPng(bytes: Uint8Array): { width: number; height: number; data: Uint8ClampedArray } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const idatStart = 8 + 12 + 13;
  const idatLength = view.getUint32(idatStart, false);
  const raw = new Uint8Array(inflateSync(bytes.subarray(idatStart + 8, idatStart + 8 + idatLength)));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    expect(raw[y * (1 + width * 4)]).toBe(0);
    data.set(raw.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4)), y * width * 4);
  }
  return { width, height, data };
}

function dataUrlOf(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

// ── 래스터 인터체인지(BMP/TGA/PPM/PAM/QOI/TIFF) ─────────────────────────────

/** 알파가 섞인 4×3 RGBA 패턴 — 모든 왕복 테스트의 기준 비트맵. */
function sampleBitmap(): { width: number; height: number; data: Uint8ClampedArray } {
  const width = 4;
  const height = 3;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = (index * 21) % 256;
    data[index * 4 + 1] = (index * 47) % 256;
    data[index * 4 + 2] = (index * 89) % 256;
    data[index * 4 + 3] = index % 3 === 0 ? 128 : 255;
  }
  return { width, height, data };
}

function flattenOnWhite(channel: number, alpha: number): number {
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

describe("래스터 인터체인지 — encode→sniff→decode 왕복", () => {
  const losslessFormats: StudioRasterInterchangeFormat[] = ["tga", "pam", "qoi", "tiff"];

  it.each(losslessFormats)("%s는 알파 포함 RGBA를 바이트 단위로 보존한다", (format) => {
    const bitmap = sampleBitmap();
    const encoded = encodeStudioRasterInterchange(format, bitmap);
    expect(encoded.lossy).toBe(false);
    expect(encoded.extension).toBe(`.${format}`);
    const decoded = decodeStudioRasterInterchange(encoded.bytes);
    expect(decoded.format).toBe(format);
    expect(decoded.bitmap.width).toBe(bitmap.width);
    expect(decoded.bitmap.height).toBe(bitmap.height);
    expect(Array.from(decoded.bitmap.data)).toEqual(Array.from(bitmap.data));
  });

  it.each(["bmp", "ppm"] as StudioRasterInterchangeFormat[])(
    "%s는 투명 픽셀을 흰색 배경에 합성하고 손실을 경고한다",
    (format) => {
      const bitmap = sampleBitmap();
      const encoded = encodeStudioRasterInterchange(format, bitmap);
      expect(encoded.lossy).toBe(true);
      expect(encoded.warnings.join(" ")).toContain("흰색 배경");
      const decoded = decodeStudioRasterInterchange(encoded.bytes, format);
      expect(decoded.bitmap.width).toBe(bitmap.width);
      expect(decoded.bitmap.height).toBe(bitmap.height);
      for (let index = 0; index < bitmap.width * bitmap.height; index += 1) {
        const alpha = bitmap.data[index * 4 + 3]!;
        expect(decoded.bitmap.data[index * 4]).toBe(flattenOnWhite(bitmap.data[index * 4]!, alpha));
        expect(decoded.bitmap.data[index * 4 + 3]).toBe(255);
      }
    }
  );

  it("외부 인코더 스타일의 24-bit bottom-up BMP를 손으로 만든 바이트로 디코드한다", () => {
    // 2×2, 행은 4바이트 정렬(2*3=6 → 8), 픽셀은 BGR, 아래 행부터 저장.
    const bytes = new Uint8Array(54 + 16);
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    view.setUint32(2, bytes.length, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, 2, true);
    view.setInt32(22, 2, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    // 아래 행(y=1): (0,1)=파랑, (1,1)=초록 / 위 행(y=0): (0,0)=빨강, (1,0)=흰색
    bytes.set([255, 0, 0, 0, 255, 0], 54); // BGR: blue, green
    bytes.set([0, 0, 255, 255, 255, 255], 54 + 8); // BGR: red, white
    const decoded = decodeStudioRasterInterchange(bytes);
    expect(decoded.format).toBe("bmp");
    expect(Array.from(decoded.bitmap.data)).toEqual([
      255, 0, 0, 255, 255, 255, 255, 255,
      0, 0, 255, 255, 0, 255, 0, 255,
    ]);
  });

  // Windows/GIMP의 사실상 표준 32-bit 저장 경로 — BITMAPV4HEADER + BI_BITFIELDS(BGRA 마스크).
  function bitfieldsBmp(overrides?: {
    dibSize?: number;
    redMask?: number;
    alphaMask?: number;
  }): Uint8Array {
    const dibSize = overrides?.dibSize ?? 108;
    // 40-byte header에서는 3-마스크 블록이 header 뒤에 별도로 붙는다(V4/V5는 header 내부 필드).
    const pixelOffset = 14 + dibSize + (dibSize === 40 ? 12 : 0);
    const bytes = new Uint8Array(pixelOffset + 8); // 2×1, 32bpp → 행 8바이트
    const view = new DataView(bytes.buffer);
    bytes[0] = 0x42;
    bytes[1] = 0x4d;
    view.setUint32(2, bytes.length, true);
    view.setUint32(10, pixelOffset, true);
    view.setUint32(14, dibSize, true);
    view.setInt32(18, 2, true);
    view.setInt32(22, -1, true); // top-down
    view.setUint16(26, 1, true);
    view.setUint16(28, 32, true);
    view.setUint32(30, 3, true); // BI_BITFIELDS
    view.setUint32(54, overrides?.redMask ?? 0x00ff_0000, true);
    view.setUint32(58, 0x0000_ff00, true);
    view.setUint32(62, 0x0000_00ff, true);
    if (dibSize >= 56) view.setUint32(66, overrides?.alphaMask ?? 0xff00_0000, true);
    // BGRA: 반투명 빨강, 불투명 파랑
    bytes.set([0, 0, 255, 128, 255, 0, 0, 255], pixelOffset);
    return bytes;
  }

  it("BI_BITFIELDS 32-bit BMP(V4 알파 마스크)를 표준 BGRA 배치로 디코드한다", () => {
    const decoded = decodeStudioRasterInterchange(bitfieldsBmp());
    expect(decoded.format).toBe("bmp");
    expect(decoded.warnings).toHaveLength(0);
    expect(Array.from(decoded.bitmap.data)).toEqual([255, 0, 0, 128, 0, 0, 255, 255]);
  });

  it("40-byte header + 3-마스크 BI_BITFIELDS BMP는 알파 없이 불투명으로 디코드한다", () => {
    const decoded = decodeStudioRasterInterchange(bitfieldsBmp({ dibSize: 40 }));
    expect(decoded.warnings).toHaveLength(0);
    expect(Array.from(decoded.bitmap.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
  });

  it("비표준 비트필드 마스크는 한국어 오류로 거부한다", () => {
    expect(() => decodeStudioRasterInterchange(bitfieldsBmp({ redMask: 0x0000_00ff, alphaMask: 0 })))
      .toThrow("표준 BGRA 마스크의 32-bit BI_BITFIELDS BMP만 지원합니다.");
  });

  it("id 필드가 있는 bottom-left 원점 24-bit TGA를 손으로 만든 바이트로 디코드한다", () => {
    const width = 2;
    const height = 2;
    const idField = [0xaa, 0xbb];
    const bytes = new Uint8Array(18 + idField.length + width * height * 3);
    const view = new DataView(bytes.buffer);
    bytes[0] = idField.length;
    bytes[2] = 2; // uncompressed true-color
    view.setUint16(12, width, true);
    view.setUint16(14, height, true);
    bytes[16] = 24;
    bytes[17] = 0; // bottom-left origin
    bytes.set(idField, 18);
    // 저장 순서: 아래 행 먼저 — (0,1)=노랑, (1,1)=검정, (0,0)=빨강, (1,0)=파랑 (BGR)
    bytes.set([0, 255, 255, 0, 0, 0, 0, 0, 255, 255, 0, 0], 20);
    const decoded = decodeStudioRasterInterchange(bytes, "tga");
    expect(Array.from(decoded.bitmap.data)).toEqual([
      255, 0, 0, 255, 0, 0, 255, 255,
      255, 255, 0, 255, 0, 0, 0, 255,
    ]);
  });

  it("주석이 섞인 P6 PPM 헤더와 RGB-only P7 PAM을 디코드한다", () => {
    const ppm = Uint8Array.from([
      ...encoder.encode("P6\n# integration comment\n2 1\n255\n"),
      10, 20, 30, 200, 100, 50,
    ]);
    const ppmDecoded = decodeStudioRasterInterchange(ppm);
    expect(ppmDecoded.format).toBe("ppm");
    expect(Array.from(ppmDecoded.bitmap.data)).toEqual([10, 20, 30, 255, 200, 100, 50, 255]);

    const pam = Uint8Array.from([
      ...encoder.encode("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n"),
      1, 2, 3, 4, 5, 6,
    ]);
    const pamDecoded = decodeStudioRasterInterchange(pam);
    expect(pamDecoded.format).toBe("pam");
    expect(Array.from(pamDecoded.bitmap.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });

  it("RGB 채널 플래그의 손제작 QOI 스트림을 디코드하고 불투명 해석을 고지한다", () => {
    const bytes = new Uint8Array(14 + 4 + 1 + 8);
    const view = new DataView(bytes.buffer);
    bytes.set([0x71, 0x6f, 0x69, 0x66]);
    view.setUint32(4, 2, false);
    view.setUint32(8, 2, false);
    bytes[12] = 3; // RGB
    bytes[13] = 0;
    bytes.set([0xfe, 40, 80, 120], 14); // QOI_OP_RGB
    bytes[18] = 0xc0 | (3 - 1); // 같은 픽셀 3개 run
    bytes[bytes.length - 1] = 1; // 종료 마커 00…01
    const decoded = decodeStudioRasterInterchange(bytes, "qoi");
    expect(decoded.warnings.join(" ")).toContain("불투명");
    expect(Array.from(decoded.bitmap.data)).toEqual([
      40, 80, 120, 255, 40, 80, 120, 255,
      40, 80, 120, 255, 40, 80, 120, 255,
    ]);
  });

  it("확장자 지정과 실제 바이트가 다르면 한국어 오류로 거부한다", () => {
    const encoded = encodeStudioRasterInterchange("qoi", sampleBitmap());
    expect(() => decodeStudioRasterInterchange(encoded.bytes, "bmp"))
      .toThrow(StudioRasterInterchangeError);
    expect(() => decodeStudioRasterInterchange(encoded.bytes, "bmp"))
      .toThrow("파일 내용은 .qoi인데 .bmp로 지정되었습니다.");
  });

  it("캔버스 accept 문자열의 모든 래스터 확장자가 디코더 포맷으로 라우팅된다", () => {
    const tokens = STUDIO_CANVAS_IMAGE_ACCEPT.split(",");
    expect(tokens[0]).toBe("image/*");
    const extensionTokens = tokens.slice(1);
    expect(extensionTokens.length).toBeGreaterThanOrEqual(11);
    for (const token of extensionTokens) {
      expect(token.startsWith(".")).toBe(true);
      const format = studioOpenRasterFormatForFile({ name: `sample${token}`, type: "" });
      expect(format, `${token} 확장자는 디코더 포맷으로 라우팅되어야 한다`).not.toBeNull();
      // 실제 그 포맷의 바이트가 sniffer로도 같은 포맷으로 식별되는지 재확인한다.
      const encoded = encodeStudioRasterInterchange(format!, sampleBitmap());
      expect(decodeStudioRasterInterchange(encoded.bytes).format).toBe(format);
    }
    // MIME 단독 파일(확장자 없음)도 같은 라우터가 처리한다.
    expect(studioOpenRasterFormatForFile({ name: "clipboard", type: "image/x-portable-pixmap" })).toBe("ppm");
    expect(studioOpenRasterFormatForFile({ name: "photo.jpg", type: "image/jpeg" })).toBeNull();
  });
});

// ── GIF 감지 + 참고 이미지 가져오기 ─────────────────────────────────────────

function staticGifBytes(): Uint8Array {
  return Uint8Array.from([
    ...encoder.encode("GIF87a"),
    1, 0, 1, 0, 0, 0, 0, // Logical Screen Descriptor(GCT 없음)
    0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, // Image Descriptor
    2, 1, 0x44, 0, // LZW min code + 1바이트 서브블록 + 종료
    0x3b,
  ]);
}

function animatedGifBytes(): Uint8Array {
  const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x44, 0];
  return Uint8Array.from([
    ...encoder.encode("GIF89a"),
    1, 0, 1, 0, 0, 0, 0,
    0x21, 0xf9, 4, 0, 10, 0, 0, 0, // Graphic Control Extension(delay 10)
    ...frame,
    0x21, 0xf9, 4, 0, 10, 0, 0, 0,
    ...frame,
    0x3b,
  ]);
}

describe("GIF 감지와 참고 이미지 가져오기", () => {
  it("실제 GIF 바이트에서 정적/애니메이션을 구분한다", () => {
    expect(isAnimatedGifBytes(staticGifBytes())).toBe(false);
    expect(isAnimatedGifBytes(animatedGifBytes())).toBe(true);
    expect(isAnimatedGifDataUrl(dataUrlOf("image/gif", animatedGifBytes()))).toBe(true);
    expect(isAnimatedGifDataUrl(dataUrlOf("image/gif", staticGifBytes()))).toBe(false);
    expect(isGifFile({ name: "sticker.GIF", type: "" })).toBe(true);
  });

  it("참고 이미지 accept 문자열의 모든 항목이 판정 함수와 일치한다", () => {
    for (const token of STUDIO_REFERENCE_IMPORT_ACCEPT.split(",")) {
      const file = token.startsWith(".")
        ? { name: `reference${token}`, type: "" }
        : { name: "reference.bin", type: token };
      expect(isStudioReferenceImportFile(file), `${token}은 참고 이미지로 허용되어야 한다`).toBe(true);
    }
    expect(isStudioReferenceImportFile({ name: "reference.psd", type: "" })).toBe(false);
  });

  it("지원/비지원/슬롯 초과를 분리하고 예산 위반을 한국어로 거부한다", () => {
    const files = [
      { name: "a.png", size: 10, type: "image/png", arrayBuffer: async () => new ArrayBuffer(0) },
      { name: "b.txt", size: 10, type: "text/plain", arrayBuffer: async () => new ArrayBuffer(0) },
      { name: "c.webp", size: 10, type: "image/webp", arrayBuffer: async () => new ArrayBuffer(0) },
    ];
    const plan = planStudioReferenceImports(files, 1);
    expect(plan.files.map((file) => file.name)).toEqual(["a.png"]);
    expect(plan.unsupported.map((file) => file.name)).toEqual(["b.txt"]);
    expect(plan.overflow.map((file) => file.name)).toEqual(["c.webp"]);

    expect(() => assertStudioReferenceImportBatch([
      { name: "big.png", size: 13 * 1024 * 1024, type: "image/png" },
    ])).toThrow("12MB를 초과합니다");
    expect(() => assertStudioReferenceImportBatch([
      { name: "hack.exe", size: 10, type: "application/octet-stream" },
    ])).toThrow("지원하지 않습니다");
  });

  it("GIF 시그니처를 실제 바이트로 검사하고 위조를 거부한다", async () => {
    const genuine = new File([animatedGifBytes() as BlobPart], "ani.gif", { type: "image/gif" });
    await expect(assertStudioReferenceGifSignature(genuine)).resolves.toBeUndefined();
    const forged = new File([Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]) as BlobPart], "fake.gif", {
      type: "image/gif",
    });
    await expect(assertStudioReferenceGifSignature(forged)).rejects.toThrow("GIF 헤더를 확인하지 못했습니다");
  });
});

// ── 커스텀 브러시 팁 PNG ─────────────────────────────────────────────────────

/** realRgbaPng 바이트를 진짜로 되읽는 디코드 어댑터 — 브라우저 캔버스 대신 zlib 경로. */
async function decodeBrushTipFixture(
  file: File,
  header: { width: number; height: number },
  outputSize: number
): Promise<StudioBrushTipDecodedPixels> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoded = decodeRealRgbaPng(bytes);
  expect(decoded.width).toBe(header.width);
  expect(decoded.height).toBe(header.height);
  expect(decoded.width).toBe(outputSize);
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

describe("커스텀 브러시 팁 PNG 가져오기", () => {
  it("실제 zlib IDAT PNG를 헤더 검증→디코드→알파 마스크로 변환한다", async () => {
    const size = 32;
    const rgba = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const distance = Math.hypot(x - 15.5, y - 15.5);
        rgba[(y * size + x) * 4 + 3] = distance <= 10 ? 255 : 0;
      }
    }
    const bytes = realRgbaPng(size, size, rgba);
    const header = parseStudioBrushTipPngHeader(bytes);
    expect(header).toEqual({ width: size, height: size });

    const file = new File([bytes as BlobPart], "tip.png", { type: "image/png" });
    const imported = await importStudioBrushTipPng(file, { decode: decodeBrushTipFixture });
    expect(imported.source).toBe("alpha");
    expect(imported.alphaMapSize).toBe(size);
    expect(imported.sourceWidth).toBe(size);
    const mask = Buffer.from(imported.alphaMapBase64, "base64");
    expect(mask.length).toBe(size * size);
    expect(mask[16 * size + 16]).toBe(255); // 중심은 완전 불투명
    expect(mask[0]).toBe(0); // 모서리는 완전 투명
  });

  it("불투명 그레이스케일 팁은 어두운 중심 극성으로 해석한다", () => {
    const size = 16;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dark = Math.hypot(x - 7.5, y - 7.5) <= 5;
        const value = dark ? 10 : 245;
        data[(y * size + x) * 4] = value;
        data[(y * size + x) * 4 + 1] = value;
        data[(y * size + x) * 4 + 2] = value;
        data[(y * size + x) * 4 + 3] = 255;
      }
    }
    const mask = buildStudioBrushTipAlphaMask({ width: size, height: size, data });
    expect(mask.source).toBe("grayscale-dark");
    expect(mask.bytes[8 * size + 8]).toBeGreaterThan(200);
  });

  it("PNG가 아닌 바이트와 PNG 아닌 MIME을 한국어 오류로 거부한다", async () => {
    expect(() => parseStudioBrushTipPngHeader(encoder.encode("definitely not a png....")))
      .toThrow(StudioBrushTipImportError);
    const jpeg = new File([Uint8Array.from([0xff, 0xd8, 0xff]) as BlobPart], "tip.jpg", { type: "image/jpeg" });
    await expect(importStudioBrushTipPng(jpeg)).rejects.toThrow("PNG");
  });
});

// ── PSD(ag-psd 실바이트 왕복) ────────────────────────────────────────────────

interface StubImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** ag-psd가 node에서 레이어 픽셀을 실체화할 수 있게 하는 최소 캔버스 브리지. */
class StubCanvas {
  width: number;
  height: number;
  private imageData: StubImageData;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.imageData = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  }

  getContext(): {
    canvas: StubCanvas;
    createImageData: (width: number, height: number) => StubImageData;
    putImageData: (data: StubImageData) => void;
    getImageData: () => StubImageData;
  } {
    return {
      canvas: this,
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (data: StubImageData) => {
        this.imageData = data;
      },
      getImageData: () => this.imageData,
    };
  }

  toDataURL(): string {
    return `data:image/png;base64,${Buffer.from(this.imageData.data).toString("base64")}`;
  }
}

function stubImageData(width: number, height: number, rgba: number[]): StubImageData {
  return { width, height, data: new Uint8ClampedArray(rgba) };
}

describe("PSD 가져오기(ag-psd 실바이트 왕복)", () => {
  initializeCanvas(
    (width: number, height: number) => new StubCanvas(width, height) as unknown as HTMLCanvasElement,
    (width: number, height: number) =>
      ({ width, height, data: new Uint8ClampedArray(width * height * 4) }) as unknown as ImageData
  );
  const identityDownscale = async (dataUrl: string) => dataUrl;

  it("레이어 좌표·순서·불투명도·블렌드·숨김을 실제 PSD 바이트에서 복원한다", async () => {
    const red = Array.from({ length: 4 * 2 }, () => [255, 0, 0, 255]).flat();
    const blue = Array.from({ length: 2 * 2 }, () => [0, 0, 255, 255]).flat();
    const buffer = writePsdBuffer(
      {
        width: 100,
        height: 60,
        children: [
          // ag-psd 순서: [0]=패널 맨 위. Studio로 오면 뒤집힌다.
          {
            name: "Top Layer",
            left: 10,
            top: 20,
            right: 12,
            bottom: 22,
            imageData: stubImageData(2, 2, blue) as unknown as ImageData,
            opacity: 0.5,
            blendMode: "multiply",
            hidden: true,
          },
          {
            name: "Bottom Layer",
            left: 0,
            top: 0,
            right: 4,
            bottom: 2,
            imageData: stubImageData(4, 2, red) as unknown as ImageData,
          },
        ],
      },
      { generateThumbnail: false, noBackground: true }
    );
    const file = new File([new Uint8Array(buffer) as BlobPart], "roundtrip.psd", {
      type: "image/vnd.adobe.photoshop",
    });
    const result = await importPsdFile(file, 50, { downscaleImpl: identityDownscale });

    expect(result.sourceWidth).toBe(100);
    expect(result.sourceHeight).toBe(60);
    expect(result.scale).toBe(0.5);
    expect(result.elements).toHaveLength(2);

    const [bottom, top] = result.elements;
    expect(bottom!.name).toBe("Bottom Layer");
    expect(bottom!.x).toBe(0);
    expect(bottom!.width).toBe(2); // 4px * 0.5 스케일
    expect(bottom!.opacity).toBeUndefined();
    expect(bottom!.blendMode).toBeUndefined();
    // 픽셀까지 실제 디코드됐는지 — data URL payload가 빨강 RGBA로 시작해야 한다.
    const bottomPixels = Buffer.from(bottom!.src.split(",")[1]!, "base64");
    expect([bottomPixels[0], bottomPixels[1], bottomPixels[2], bottomPixels[3]]).toEqual([255, 0, 0, 255]);

    expect(top!.name).toBe("Top Layer");
    expect(top!.x).toBe(5);
    expect(top!.y).toBe(10);
    expect(top!.opacity).toBeCloseTo(0.5, 1);
    expect(top!.blendMode).toBe("multiply");
    expect(top!.hidden).toBe(true);
  });

  it("깨진 PSD 바이트를 한국어 오류로 거부한다", async () => {
    const file = new File([encoder.encode("not a psd") as BlobPart], "broken.psd", {
      type: "image/vnd.adobe.photoshop",
    });
    await expect(importPsdFile(file, 720, { downscaleImpl: identityDownscale }))
      .rejects.toThrow("PSD 파일을 해석하지 못했어요");
  });
});

// ── ORA / CBZ 왕복 ──────────────────────────────────────────────────────────

describe("OpenRaster(.ora) 왕복", () => {
  it("레이어 이름·오프셋·불투명도·블렌드·가시성을 보존한다", async () => {
    const built = await buildStudioOpenRasterBytes(
      {
        width: 8,
        height: 8,
        layers: [
          { name: "배경", png: pngHeaderBytes(8, 8, 11), x: 0, y: 0 },
          {
            name: "라인아트",
            png: pngHeaderBytes(2, 2, 12),
            x: 3,
            y: 4,
            opacity: 0.5,
            blendMode: "multiply",
            visible: false,
          },
        ],
        mergedImage: pngHeaderBytes(8, 8, 13),
        thumbnail: pngHeaderBytes(1, 1, 14),
        name: "통합 테스트 문서",
      },
      { crc32ExecutionMode: "direct-headless" },
    );
    expect(built.warnings).toHaveLength(0);

    const imported = await importStudioOpenRaster(built.bytes);
    expect(imported.width).toBe(8);
    expect(imported.height).toBe(8);
    expect(imported.layers).toHaveLength(2);
    const [background, lineart] = imported.layers;
    expect(background!.z).toBe(0);
    expect(background!.name).toBe("배경");
    expect(background!.width).toBe(8);
    expect(lineart!.z).toBe(1);
    expect(lineart!.name).toBe("라인아트");
    expect(lineart!.x).toBe(3);
    expect(lineart!.y).toBe(4);
    expect(lineart!.opacity).toBeCloseTo(0.5, 3);
    expect(lineart!.blendMode).toBe("multiply");
    expect(lineart!.visible).toBe(false);
    expect(lineart!.width).toBe(2);
    expect(lineart!.height).toBe(2);
    expect(imported.summary.layerCount).toBe(2);
    expect(imported.summary.hiddenLayerCount).toBe(1);
    // 레이어 PNG 바이트 자체도 무손실 왕복이어야 한다.
    const lineartBytes = new Uint8Array(await lineart!.png.arrayBuffer());
    expect(Array.from(lineartBytes)).toEqual(Array.from(pngHeaderBytes(2, 2, 12)));
  });

  it("mimetype 항목이 틀린 아카이브를 한국어 오류로 거부한다", async () => {
    const forged = await buildStudioPackageArchiveBytes(
      [
        { path: "mimetype", data: encoder.encode("image/not-openraster") },
        { path: "stack.xml", data: encoder.encode("<image w='1' h='1'/>") },
      ],
      { crc32ExecutionMode: "direct-headless" },
    );
    const failure = await importStudioOpenRaster(forged).then(
      () => null,
      (cause: unknown) => cause
    );
    expect(failure).toBeInstanceOf(StudioOpenRasterError);
    expect((failure as StudioOpenRasterError).message).toMatch(/[가-힣]/u);
  });
});

describe("CBZ(ComicInfo 포함) 왕복", () => {
  it("페이지 순서·크기·ComicInfo 메타데이터를 보존한다", async () => {
    const built = await buildStudioCbzBytes(
      {
        pages: [
          { image: pngHeaderBytes(4, 6, 21) },
          { image: pngHeaderBytes(3, 5, 22) },
          { image: pngHeaderBytes(2, 9, 23) },
        ],
        metadata: {
          title: "통합 테스트 1화",
          series: "통합 테스트",
          writer: "에이치준",
          genre: ["판타지"],
          languageISO: "ko",
        },
      },
      { crc32ExecutionMode: "direct-headless" },
    );

    const imported = await importStudioCbz(built.bytes);
    expect(imported.pages).toHaveLength(3);
    expect(imported.pages.map((page) => page.index)).toEqual([0, 1, 2]);
    expect(imported.pages.map((page) => [page.width, page.height])).toEqual([
      [4, 6],
      [3, 5],
      [2, 9],
    ]);
    expect(imported.pages.every((page) => page.mimeType === "image/png")).toBe(true);
    expect(imported.summary.hasComicInfo).toBe(true);
    expect(imported.summary.pageCount).toBe(3);
    expect(imported.metadata.title).toBe("통합 테스트 1화");
    expect(imported.metadata.writer).toBe("에이치준");
    expect(imported.metadata.languageISO).toBe("ko");
    const firstPage = new Uint8Array(await imported.pages[0]!.image.arrayBuffer());
    expect(Array.from(firstPage)).toEqual(Array.from(pngHeaderBytes(4, 6, 21)));
  });

  it("ZIP이 아닌 바이트를 한국어 오류로 거부한다", async () => {
    const failure = await importStudioCbz(encoder.encode("this is not a zip archive")).then(
      () => null,
      (cause: unknown) => cause
    );
    expect(failure).toBeInstanceOf(StudioCbzError);
    expect((failure as StudioCbzError).message).toMatch(/[가-힣]/u);
  });
});

// ── 프로젝트 백업(.json / .toonproject.zip) ──────────────────────────────────

function sampleProject(elements: unknown[] = []): Record<string, unknown> {
  return {
    version: 2,
    title: "통합 테스트 프로젝트",
    description: "가져오기 매트릭스",
    tagsText: "테스트",
    pagesList: [{ id: "page-1", elements, bg: "#ffffff", bgGrad: null, canvasH: 1_280 }],
    currentPageId: "page-1",
    webtoonTheme: "classic",
    panelGutter: 24,
  };
}

describe("프로젝트 백업 가져오기", () => {
  it(".json 직렬화→파싱 왕복이 페이지·요소·설정을 보존한다", () => {
    const project = sampleProject([{ id: "el-1", type: "text", text: "안녕", x: 1, y: 2 }]);
    const serialized = serializeStudioProjectFile(project);
    const parsed = parseStudioProjectFile(JSON.parse(serialized));
    expect(parsed.title).toBe("통합 테스트 프로젝트");
    expect(parsed.pagesList).toHaveLength(1);
    expect(parsed.pagesList[0]!.elements).toEqual([{ id: "el-1", type: "text", text: "안녕", x: 1, y: 2 }]);
    expect(parsed.panelGutter).toBe(24);
  });

  it("깨진 .json은 한국어 오류로 거부한다", () => {
    expect(() => parseStudioProjectFile({ version: 99 }))
      .toThrow("올바르지 않은 ToonSpectrum 프로젝트 파일입니다.");
  });

  it(".toonproject.zip 왕복이 내장 이미지 자산까지 복원한다", async () => {
    const embedded = dataUrlOf("image/png", pngHeaderBytes(2, 2, 31));
    const project = sampleProject([
      { id: "image-1", type: "image", src: embedded, x: 0, y: 0, width: 2, height: 2 },
    ]);
    const built = await buildStudioProjectArchive(
      { project },
      { crc32ExecutionMode: "direct-headless" },
    );
    expect(built.manifest.attachments).toHaveLength(1);

    const imported = await importStudioProjectArchive(built.blob);
    const element = imported.project.pagesList[0]!.elements[0] as Record<string, unknown>;
    expect(element.src).toBe(embedded);
    expect(imported.attachments.size).toBe(1);
    expect(imported.isSelfContained).toBe(true);
  });

  it("손상된 아카이브 바이트는 자산을 복원하지 않고 한국어 오류를 던진다", async () => {
    const embedded = dataUrlOf("image/png", pngHeaderBytes(2, 2, 32));
    const built = await buildStudioProjectArchive(
      {
        project: sampleProject([
          { id: "image-1", type: "image", src: embedded, x: 0, y: 0, width: 2, height: 2 },
        ]),
      },
      { crc32ExecutionMode: "direct-headless" },
    );
    const bytes = new Uint8Array(await built.blob.arrayBuffer());
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const failure = await importStudioProjectArchive(new Blob([bytes as BlobPart])).then(
      () => null,
      (cause: unknown) => cause
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/[가-힣]/u);
  });

  it("ZIP 리더가 항목 목록과 바이트를 그대로 되돌려준다", async () => {
    const entries = [
      { path: "mimetype", data: encoder.encode("application/vnd.toonspectrum.project+zip") },
      { path: "assets/one.bin", data: Uint8Array.from({ length: 128 }, (_, index) => index % 251) },
    ];
    const bytes = await buildStudioPackageArchiveBytes(entries, {
      crc32ExecutionMode: "direct-headless",
    });
    const archive = await readStudioZipArchive(bytes);
    expect(archive.entries.map((entry) => entry.path).sort()).toEqual([
      "assets/one.bin",
      "mimetype",
    ]);
    const read = await archive.readEntry("assets/one.bin");
    expect(Array.from(read)).toEqual(Array.from(entries[1]!.data));

    const truncated = bytes.subarray(0, Math.floor(bytes.length / 3));
    const failure = await readStudioZipArchive(truncated).then(
      () => null,
      (cause: unknown) => cause
    );
    expect(failure).toBeInstanceOf(StudioZipReaderError);
    expect((failure as StudioZipReaderError).message).toMatch(/[가-힣]/u);
  });
});

// ── ABR(Photoshop 브러시 팩) — 스펙대로 손으로 만든 v10 바이트 ────────────────

/** big-endian 바이트 라이터 — ABR 픽스처 전용. */
class AbrByteWriter {
  private readonly bytes: number[] = [];

  u8(value: number): this {
    this.bytes.push(value & 0xff);
    return this;
  }

  u16(value: number): this {
    return this.u8(value >>> 8).u8(value);
  }

  u32(value: number): this {
    return this.u8(value >>> 24).u8(value >>> 16).u8(value >>> 8).u8(value);
  }

  f64(value: number): this {
    const buffer = new Uint8Array(8);
    new DataView(buffer.buffer).setFloat64(0, value, false);
    for (const byte of buffer) this.u8(byte);
    return this;
  }

  ascii(text: string): this {
    for (let index = 0; index < text.length; index += 1) this.u8(text.charCodeAt(index));
    return this;
  }

  raw(values: ArrayLike<number>): this {
    for (let index = 0; index < values.length; index += 1) this.u8(values[index]!);
    return this;
  }

  out(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

type AbrDescriptorValue =
  | string
  | boolean
  | { untfUnits: string; untfValue: number }
  | AbrDescriptorValue[]
  | AbrDescriptorObject;

interface AbrDescriptorObject {
  classId?: string;
  fields: ReadonlyArray<readonly [key: string, value: AbrDescriptorValue]>;
}

function writeAbrUnicode(writer: AbrByteWriter, text: string): void {
  writer.u32(text.length + 1);
  for (let index = 0; index < text.length; index += 1) writer.u16(text.charCodeAt(index));
  writer.u16(0);
}

function writeAbrKey(writer: AbrByteWriter, key: string): void {
  if (key.length === 4) writer.u32(0).ascii(key);
  else writer.u32(key.length).ascii(key);
}

function writeAbrValue(writer: AbrByteWriter, value: AbrDescriptorValue): void {
  if (typeof value === "string") {
    writer.ascii("TEXT");
    writeAbrUnicode(writer, value);
  } else if (typeof value === "boolean") {
    writer.ascii("bool").u8(value ? 1 : 0);
  } else if (Array.isArray(value)) {
    writer.ascii("VlLs").u32(value.length);
    for (const item of value) writeAbrValue(writer, item);
  } else if ("untfUnits" in value) {
    writer.ascii("UntF").ascii(value.untfUnits).f64(value.untfValue);
  } else {
    writer.ascii("Objc");
    writeAbrDescriptor(writer, value);
  }
}

function writeAbrDescriptor(writer: AbrByteWriter, descriptor: AbrDescriptorObject): void {
  writeAbrUnicode(writer, "");
  writeAbrKey(writer, descriptor.classId ?? "null");
  writer.u32(descriptor.fields.length);
  for (const [key, value] of descriptor.fields) {
    writeAbrKey(writer, key);
    writeAbrValue(writer, value);
  }
}

const abrPercent = (value: number): AbrDescriptorValue => ({ untfUnits: "#Prc", untfValue: value });
const abrPixels = (value: number): AbrDescriptorValue => ({ untfUnits: "#Pxl", untfValue: value });
const abrAngle = (value: number): AbrDescriptorValue => ({ untfUnits: "#Ang", untfValue: value });

function abrSection(signature: string, body: Uint8Array): Uint8Array {
  const writer = new AbrByteWriter();
  writer.ascii("8BIM").ascii(signature).u32(body.length).raw(body);
  const remainder = body.length % 4;
  if (remainder) for (let index = 0; index < 4 - remainder; index += 1) writer.u8(0);
  return writer.out();
}

function abrSampBody(id: string, width: number, height: number, alpha: Uint8Array): Uint8Array {
  const brush = new AbrByteWriter();
  brush.u8(id.length).ascii(id); // pascal string id
  for (let index = 0; index < 264; index += 1) brush.u8(0); // minor version 2 예약 블록
  brush.u32(0).u32(0).u32(height).u32(width); // top/left/bottom/right
  brush.u16(8).u8(0); // 8-bit raw
  brush.raw(alpha);
  const body = brush.out();
  const writer = new AbrByteWriter();
  writer.u32(body.length).raw(body);
  const remainder = body.length % 4;
  if (remainder) for (let index = 0; index < 4 - remainder; index += 1) writer.u8(0);
  return writer.out();
}

function abrDescBody(brushName: string, sampleId: string): Uint8Array {
  const writer = new AbrByteWriter();
  writer.u32(16); // descriptor version
  writeAbrDescriptor(writer, {
    fields: [
      [
        "Brsh",
        [
          {
            fields: [
              ["Nm  ", brushName],
              [
                "Brsh",
                {
                  classId: "sampledBrush",
                  fields: [
                    ["Dmtr", abrPixels(24)],
                    ["Angl", abrAngle(0)],
                    ["Rndn", abrPercent(100)],
                    ["Spcn", abrPercent(25)],
                    ["Intr", true],
                    ["flipX", false],
                    ["flipY", false],
                    ["Nm  ", brushName],
                    ["sampledData", sampleId],
                  ],
                },
              ],
              ["Spcn", abrPercent(25)],
              ["Wtdg", false],
              ["Nose", false],
              ["useBrushSize", true],
            ],
          },
        ],
      ],
    ],
  });
  return writer.out();
}

function integrationAbrBytes(): Uint8Array {
  const width = 6;
  const height = 4;
  const alpha = Uint8Array.from({ length: width * height }, (_, index) => 40 + index * 8);
  const head = new AbrByteWriter().u16(10).u16(2).out();
  const samp = abrSection("samp", abrSampBody("integration-tip", width, height, alpha));
  const desc = abrSection("desc", abrDescBody("Integration Brush", "integration-tip"));
  const bytes = new Uint8Array(head.length + samp.length + desc.length);
  bytes.set(head, 0);
  bytes.set(samp, head.length);
  bytes.set(desc, head.length + samp.length);
  return bytes;
}

describe("ABR 브러시 팩 가져오기(실바이트)", () => {
  it("손으로 만든 v10 ABR에서 샘플 팁 브러시를 변환한다", async () => {
    const bytes = integrationAbrBytes();
    const result = await parseStudioAbrBuffer(bytes.buffer.slice(0) as ArrayBuffer);
    expect(result.sourceBrushCount).toBe(1);
    expect(result.sourceSampleCount).toBe(1);
    expect(result.brushes).toHaveLength(1);
    const brush = result.brushes[0]!;
    expect(brush.name).toBe("Integration Brush");
    expect(brush.sourceShape).toBe("sampled");
    expect(brush.sourceSampleId).toBe("integration-tip");
    expect(brush.snapshot.strokeWidth).toBe(24);
    expect(brush.snapshot.brushDynamics.tip.alphaMapBase64).toBeTruthy();
  });

  it("레거시 버전·손상 시그니처·브러시 없는 문서를 코드별 한국어 오류로 거부한다", async () => {
    const legacy = new AbrByteWriter().u16(1).u16(1).raw(new Uint8Array(16)).out();
    await expect(parseStudioAbrBuffer(legacy.buffer.slice(0) as ArrayBuffer))
      .rejects.toMatchObject({ code: "unsupported-version" });

    const garbage = encoder.encode("Z".repeat(64));
    const garbageFailure = await parseStudioAbrBuffer(garbage.buffer.slice(0) as ArrayBuffer).then(
      () => null,
      (cause: unknown) => cause
    );
    expect(garbageFailure).toBeInstanceOf(StudioAbrImportError);

    const sampOnly = (() => {
      const head = new AbrByteWriter().u16(10).u16(2).out();
      const samp = abrSection(
        "samp",
        abrSampBody("lonely", 4, 4, Uint8Array.from({ length: 16 }, () => 200))
      );
      const bytes = new Uint8Array(head.length + samp.length);
      bytes.set(head, 0);
      bytes.set(samp, head.length);
      return bytes;
    })();
    await expect(parseStudioAbrBuffer(sampOnly.buffer.slice(0) as ArrayBuffer))
      .rejects.toMatchObject({ code: "no-brushes" });
  });
});

// ── 3D GLB / VRM ─────────────────────────────────────────────────────────────

function assembleGlb(chunks: ReadonlyArray<{ type: number; bytes: Uint8Array }>): Uint8Array {
  const paddedChunks = chunks.map((chunk) => {
    const padded = new Uint8Array(Math.ceil(chunk.bytes.length / 4) * 4);
    padded.fill(chunk.type === 0x4e4f_534a ? 0x20 : 0x00);
    padded.set(chunk.bytes);
    return { type: chunk.type, bytes: padded };
  });
  const total = 12 + paddedChunks.reduce((sum, chunk) => sum + 8 + chunk.bytes.length, 0);
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  output.set(encoder.encode("glTF"), 0);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let offset = 12;
  for (const chunk of paddedChunks) {
    view.setUint32(offset, chunk.bytes.length, true);
    view.setUint32(offset + 4, chunk.type, true);
    output.set(chunk.bytes, offset + 8);
    offset += 8 + chunk.bytes.length;
  }
  return output;
}

function makeGlb(root: Record<string, unknown>, bin?: Uint8Array): Uint8Array {
  const chunks: Array<{ type: number; bytes: Uint8Array }> = [
    { type: 0x4e4f_534a, bytes: encoder.encode(JSON.stringify(root)) },
  ];
  if (bin) chunks.push({ type: 0x004e_4942, bytes: bin });
  return assembleGlb(chunks);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function glbOptionsFor(
  bytes: Uint8Array,
  overrides: Partial<StudioBg3dGlbValidationOptions> = {}
): Promise<StudioBg3dGlbValidationOptions> {
  return {
    declared: {
      byteSize: bytes.byteLength,
      sha256: `sha256:${await sha256Hex(bytes)}`,
      mimeType: STUDIO_BG3D_GLB_MIME_TYPE,
    },
    cumulative: { usedBytes: 0, maximumBytes: STUDIO_BG3D_GLB_MAX_BYTES },
    profile: "desktop",
    budgets: DEFAULT_STUDIO_BG3D_GLB_BUDGET_PROFILES,
    supportedRequiredExtensions: [],
    ...overrides,
  };
}

function integrationGlb(): Uint8Array {
  const bin = pngHeaderBytes(2, 3, 41);
  return makeGlb(
    {
      asset: { version: "2.0", generator: "integration-test" },
      buffers: [{ byteLength: bin.byteLength }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bin.byteLength }],
      accessors: [{ count: 6, type: "VEC3", componentType: 5126 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      materials: [{}],
      nodes: [{ mesh: 0 }],
      images: [{ bufferView: 0, mimeType: "image/png" }],
      textures: [{ source: 0 }],
    },
    bin
  );
}

describe("3D GLB 가져오기 무결성 검증", () => {
  it("선언된 sha256과 일치하는 유효 GLB를 통과시킨다", async () => {
    const bytes = integrationGlb();
    const result = await validateStudioBg3dGlb(bytes, await glbOptionsFor(bytes));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.metrics.meshes).toBe(1);
      expect(result.metrics.textures).toBe(1);
      expect(result.metrics.byteSize).toBe(bytes.byteLength);
    }
  });

  it("바이트 변조와 길이 불일치를 코드로 구분해 거부한다", async () => {
    const bytes = integrationGlb();
    const options = await glbOptionsFor(bytes);
    const tampered = Uint8Array.from(bytes);
    tampered[tampered.length - 1] ^= 0xff;
    const tamperedResult = await validateStudioBg3dGlb(tampered, options);
    expect(tamperedResult.ok).toBe(false);
    if (!tamperedResult.ok) expect(tamperedResult.code).toBe("hash-mismatch");

    const sizeMismatch = await validateStudioBg3dGlb(
      bytes,
      await glbOptionsFor(bytes, {
        declared: {
          byteSize: bytes.byteLength + 4,
          sha256: `sha256:${await sha256Hex(bytes)}`,
          mimeType: STUDIO_BG3D_GLB_MIME_TYPE,
        },
      })
    );
    expect(sizeMismatch.ok).toBe(false);
    if (!sizeMismatch.ok) expect(sizeMismatch.code).toBe("byte-size-mismatch");
  });

  it("3D 모델 파일 플래너가 주 모델과 동반 리소스를 분류한다", () => {
    const files = [
      new File([Uint8Array.from([1]) as BlobPart], "Room.glb"),
      new File([Uint8Array.from([2]) as BlobPart], "prop.obj"),
      new File([Uint8Array.from([3]) as BlobPart], "prop.mtl"),
      new File([Uint8Array.from([4]) as BlobPart], "texture.png"),
      new File([Uint8Array.from([5]) as BlobPart], "notes.txt"),
    ];
    const plan = planStudioBg3dModelImports(files);
    expect(plan.items.map((item) => item.format).sort()).toEqual(["glb", "obj"]);
    expect(plan.resources.size).toBe(4);
    expect(plan.ignoredFiles).toEqual(["notes.txt"]);

    expect(() => planStudioBg3dModelImports([new File([Uint8Array.from([1]) as BlobPart], "alone.mtl")]))
      .toThrow(StudioBg3dModelImportError);
  });
});

describe("VRM 가져오기 검증", () => {
  function vrmGlb(extensions: Record<string, unknown>): Uint8Array {
    return makeGlb({ asset: { version: "2.0" }, extensions });
  }

  it("VRM 0.x와 1.x 확장을 버전으로 구분한다", () => {
    expect(validateVrmGlbBytes(vrmGlb({ VRM: { meta: {} } }))).toEqual({ vrmVersion: 0 });
    expect(validateVrmGlbBytes(vrmGlb({ VRMC_vrm: { specVersion: "1.0" } }))).toEqual({ vrmVersion: 1 });
  });

  it("VRM 확장 없는 GLB·잘못된 컨테이너를 한국어 오류로 거부한다", () => {
    expect(() => validateVrmGlbBytes(makeGlb({ asset: { version: "2.0" } })))
      .toThrow("VRM 확장(VRM 또는 VRMC_vrm)이 없습니다");
    expect(() => validateVrmGlbBytes(encoder.encode("clearly-not-a-glb-container")))
      .toThrow("GLB 'glTF' 헤더");
    const truncatedLength = makeGlb({ asset: { version: "2.0" }, extensions: { VRM: {} } });
    new DataView(truncatedLength.buffer).setUint32(8, truncatedLength.byteLength + 8, true);
    expect(() => validateVrmGlbBytes(truncatedLength)).toThrow("길이 정보");
  });
});

// ── 팔레트 인터체인지 ────────────────────────────────────────────────────────

describe("팔레트 라이브러리 가져오기 왕복", () => {
  const paletteFormats: StudioPaletteInterchangeFormat[] = [
    "aco", "act", "ase", "css", "gpl", "json", "pal",
  ];
  const paletteDocument = {
    name: "Integration Palette",
    colors: [{ hex: "#ff0000" }, { hex: "#00ff80" }, { hex: "#0033ff" }],
  };

  it.each(paletteFormats)("%s 내보내기→가져오기가 색상을 보존한다", (format) => {
    const exported = exportStudioPalette(format, paletteDocument);
    const imported = importStudioPalette(format, exported.data);
    const roundtripped = imported.palette.colors.slice(0, 3).map((color) => color.hex.toLowerCase());
    expect(roundtripped).toEqual(["#ff0000", "#00ff80", "#0033ff"]);
  });

  it("판별 불가능한 바이트는 한국어 오류로 거부한다", () => {
    expect(() => importStudioPalette("ase", Uint8Array.from([1, 2, 3, 4])))
      .toThrow(/[가-힣]/u);
  });
});

// ── UI accept ↔ 디코더 경계(소스 단면 검증) ──────────────────────────────────

describe("가져오기 UI accept ↔ 디코더 경계", () => {
  it("캔버스 이미지 accept 사본 3곳이 canonical 상수와 동일하다", () => {
    for (const fileName of ["studio-legacy-editor-runtime-helpers.ts", "StudioLeftToolRail.tsx", "StudioToolBeltContent.tsx"]) {
      expect(componentSource(fileName), `${fileName}의 accept 사본이 canonical과 어긋났다`)
        .toContain(`"${STUDIO_CANVAS_IMAGE_ACCEPT}"`);
    }
    // 드롭 경로의 확장자 정규식도 accept 확장자 집합과 동일해야 한다.
    const acceptExtensions = STUDIO_CANVAS_IMAGE_ACCEPT
      .split(",")
      .filter((token) => token.startsWith("."))
      .map((token) => token.slice(1))
      .sort();
    const dropRegex = /const STUDIO_OPEN_RASTER_FILE_EXTENSION = \/\\\.\(\?::?([^)]+)\)\$\/iu;/u
      .exec(readStudioCuttoonEditorSource());
    expect(dropRegex).not.toBeNull();
    expect(dropRegex![1]!.split("|").sort()).toEqual(acceptExtensions);
  });

  it("문서 가져오기 파일 입력의 accept가 각 디코더 게이트와 일치한다", () => {
    // Inputs live on StudioPage root (data-studio-document-import-inputs), not lazy menubar.
    const page = readStudioCuttoonEditorSource();
    expect(page).toContain('data-studio-document-import-inputs="true"');
    expect(page).toContain('accept=".json"');
    expect(page).toContain(
      'accept=".toonproject.zip,.zip,application/zip,application/vnd.toonspectrum.project+zip"'
    );
    expect(page).toContain('accept=".psd,image/vnd.adobe.photoshop"');
    expect(page).toContain(
      'accept=".ora,.cbz,.will,image/openraster,application/vnd.comicbook+zip,application/vnd.toonspectrum.will-v1-bounded+zip"'
    );
  });

  it("브러시 팁·브러시 팩·VRM 입력의 accept가 해당 디코더와 일치한다", () => {
    expect(componentSource("./brush/StudioBrushStudio.tsx")).toContain('accept=".png,image/png"');
    // 브러시 팩 accept 는 라이브러리 패널과 그리기 메뉴가 같은 상수를 쓴다. 한쪽만
    // 확장자를 늘리면 "파서는 있는데 고를 수 없는 포맷"이 다시 생기므로 상수 자체를 검사한다.
    const accept = /export const STUDIO_BRUSH_PACK_ACCEPT =\s*"([^"]+)"/u.exec(
      componentSource("./brush/studio-brush-pack-format.ts")
    );
    expect(accept).not.toBeNull();
    for (const extension of [".json", ".abr", ".myb", ".kpp"]) {
      expect(accept![1]!).toContain(extension);
    }
    expect(componentSource("./brush/StudioBrushLibraryPanel.tsx")).toContain("accept={STUDIO_BRUSH_PACK_ACCEPT}");
    expect(readStudioCuttoonEditorSource()).toContain("accept={STUDIO_BRUSH_PACK_ACCEPT}");
    expect(componentSource("./vrm/StudioVrmCharacterLibraryPanel.tsx")).toContain('accept=".vrm"');
  });

  it("3D 모델 패널 accept 확장자가 플래너의 주/동반 포맷 집합과 일치한다", () => {
    const source = componentSource("./bg3d/StudioBg3dAssetLibraryPanel.tsx");
    const match = /const MODEL_FILE_ACCEPT =\s*"([^"]+)"/u.exec(source);
    expect(match).not.toBeNull();
    const extensions = match![1]!
      .split(",")
      .filter((token) => token.startsWith("."))
      .map((token) => token.slice(1));
    const supported = new Set<string>([
      ...STUDIO_BG3D_IMPORT_PRIMARY_FORMATS,
      ...STUDIO_BG3D_IMPORT_COMPANION_FORMATS,
    ]);
    for (const extension of extensions) {
      expect(supported.has(extension), `.${extension}은 3D 가져오기 플래너가 처리해야 한다`).toBe(true);
    }
  });

  it("팔레트 패널 accept 확장자가 인터체인지 포맷 집합에 포함된다", () => {
    const source = componentSource("StudioPaletteLibraryPanel.tsx");
    const match = /const PALETTE_IMPORT_ACCEPT =\s*"([^"]+)"/u.exec(source);
    expect(match).not.toBeNull();
    const extensions = match![1]!
      .split(",")
      .filter((token) => token.startsWith("."))
      .map((token) => token.slice(1));
    expect(extensions.sort()).toEqual(["aco", "act", "ase", "css", "gpl", "json", "pal"]);
  });
});
