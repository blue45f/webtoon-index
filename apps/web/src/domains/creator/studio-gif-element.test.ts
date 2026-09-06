import { describe, expect, it } from "vitest";

import {
  GIF_SCAN_BYTE_LIMIT,
  gifBytesFromDataUrl,
  isAnimatedGifBytes,
  isAnimatedGifDataUrl,
  isGifFile,
} from "./studio-gif-element";

// ---------------------------------------------------------------------------
// 합성 GIF 바이트 빌더 — 실제 인코더 출력 없이 GIF89a 블록 구조를 손으로 조립한다.
// 헤더 주석의 "블록 구조 요약"과 1:1 대응되므로, 값이 바뀌면 그 주석도 함께 갱신할 것.
// ---------------------------------------------------------------------------

const HEADER_89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"

function lsd(packed = 0x00): number[] {
  // width=1,height=1(2바이트씩 LE) + packed + bgColorIndex(0) + pixelAspect(0)
  return [0x01, 0x00, 0x01, 0x00, packed, 0x00, 0x00];
}

function imageDescriptor(packed = 0x00): number[] {
  // 도입자(0x2C) + left/top/width/height(2바이트씩, 전부 0/1) + packed
  return [0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, packed];
}

/** 최소 이미지 데이터: LZW 최소 코드 크기(1B) + 서브블록 1개(1바이트) + 종료(0). */
const MINIMAL_IMAGE_DATA = [0x02, 0x01, 0x00, 0x00];

const TRAILER = [0x3b];

/** Graphic Control Extension 블록(8바이트): 도입자+Label+size(4)+data(4)+terminator(0). */
const GCE_BLOCK = [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00];

function bytesOf(...chunks: number[][]): Uint8Array {
  return Uint8Array.from(chunks.flat());
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

// ---------------------------------------------------------------------------

describe("isGifFile", () => {
  it("MIME 타입이 image/gif면 true", () => {
    expect(isGifFile({ name: "photo.png", type: "image/gif" })).toBe(true);
  });

  it("확장자가 .gif(대소문자 무관)면 true", () => {
    expect(isGifFile({ name: "anim.gif", type: "" })).toBe(true);
    expect(isGifFile({ name: "ANIM.GIF", type: "" })).toBe(true);
  });

  it("둘 다 아니면 false", () => {
    expect(isGifFile({ name: "photo.png", type: "image/png" })).toBe(false);
    expect(isGifFile({ name: "photo", type: "" })).toBe(false);
  });

  it("type이 없어도(undefined) 확장자만으로 판단한다", () => {
    expect(isGifFile({ name: "loop.gif" })).toBe(true);
  });
});

describe("isAnimatedGifBytes: 정적(비애니메이션) GIF", () => {
  it("GCT/LCT/확장 없이 이미지 1장뿐이면 false", () => {
    const bytes = bytesOf(HEADER_89A, lsd(0x00), imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("Local Color Table이 있어도 GCE가 없으면 false(LCT 스킵 산술 검증)", () => {
    // packed=0x80: LCT flag set, size필드=0 → 2엔트리×3B=6바이트 로컬 컬러테이블.
    const bytes = bytesOf(
      HEADER_89A,
      lsd(0x00),
      imageDescriptor(0x80),
      [0x00, 0x00, 0x00, 0xff, 0xff, 0xff], // 로컬 컬러테이블 6바이트
      MINIMAL_IMAGE_DATA,
      TRAILER
    );
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("Comment Extension만 있고 GCE가 없으면 false(제네릭 서브블록 스킵 검증)", () => {
    const commentExt = [0x21, 0xfe, 0x03, 0x41, 0x42, 0x43, 0x00]; // "ABC" 코멘트
    const bytes = bytesOf(HEADER_89A, lsd(0x00), commentExt, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("Application Extension(예: NETSCAPE2.0 루프) 만으로는 false(다중 서브블록 스킵 검증)", () => {
    const appExt = [
      0x21,
      0xff,
      0x0b, // 서브블록1 크기=11
      0x4e,
      0x45,
      0x54,
      0x53,
      0x43,
      0x41,
      0x50,
      0x45,
      0x32,
      0x2e,
      0x30, // "NETSCAPE2.0"
      0x03, // 서브블록2 크기=3
      0x01,
      0x00,
      0x00, // 루프 카운트 페이로드
      0x00, // 종료
    ];
    const bytes = bytesOf(HEADER_89A, lsd(0x00), appExt, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });
});

describe("isAnimatedGifBytes: 애니메이션 GIF(GCE 존재)", () => {
  it("GCE + 이미지 1장이면 true", () => {
    const bytes = bytesOf(HEADER_89A, lsd(0x00), GCE_BLOCK, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    expect(isAnimatedGifBytes(bytes)).toBe(true);
  });

  it("Global Color Table을 스킵한 뒤에도 GCE를 정확히 찾는다(GCT 스킵 산술 검증)", () => {
    // packed=0x80: GCT flag set, size필드=0 → 2엔트리×3B=6바이트 글로벌 컬러테이블.
    const bytes = bytesOf(
      HEADER_89A,
      lsd(0x80),
      [0x00, 0x00, 0x00, 0xff, 0xff, 0xff], // 글로벌 컬러테이블 6바이트
      GCE_BLOCK,
      imageDescriptor(0x00),
      MINIMAL_IMAGE_DATA,
      TRAILER
    );
    expect(isAnimatedGifBytes(bytes)).toBe(true);
  });

  it("두 번째 프레임 앞의 GCE도 찾는다(첫 프레임엔 GCE 없이 시작하는 경우)", () => {
    const bytes = bytesOf(
      HEADER_89A,
      lsd(0x00),
      imageDescriptor(0x00),
      MINIMAL_IMAGE_DATA, // 프레임 1(GCE 없음)
      GCE_BLOCK,
      imageDescriptor(0x00),
      MINIMAL_IMAGE_DATA, // 프레임 2(GCE 있음)
      TRAILER
    );
    expect(isAnimatedGifBytes(bytes)).toBe(true);
  });
});

describe("isAnimatedGifBytes: 방어적 처리(fail-closed)", () => {
  it("GIF가 아닌 시그니처(PNG)면 false", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(isAnimatedGifBytes(png)).toBe(false);
  });

  it("6바이트 미만(너무 짧음)이면 false", () => {
    expect(isAnimatedGifBytes(Uint8Array.from([0x47, 0x49, 0x46]))).toBe(false);
  });

  it("헤더는 있지만 Logical Screen Descriptor가 잘렸으면 false", () => {
    expect(isAnimatedGifBytes(Uint8Array.from(HEADER_89A))).toBe(false);
  });

  it("Extension Introducer 직후(Label 이전)에서 잘리면 예외 없이 false", () => {
    const full = bytesOf(HEADER_89A, lsd(0x00), GCE_BLOCK, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    const truncated = full.slice(0, 14); // Header(6)+LSD(7)+0x21 딱 1바이트만.
    expect(isAnimatedGifBytes(truncated)).toBe(false);
  });

  it("ArrayBuffer를 직접 넘겨도 동작한다(Uint8Array로 정규화)", () => {
    const bytes = bytesOf(HEADER_89A, lsd(0x00), GCE_BLOCK, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    const arrayBuffer = new ArrayBuffer(bytes.length);
    new Uint8Array(arrayBuffer).set(bytes);
    expect(isAnimatedGifBytes(arrayBuffer)).toBe(true);
  });

  it("GIF_SCAN_BYTE_LIMIT은 양수 상수다", () => {
    expect(GIF_SCAN_BYTE_LIMIT).toBeGreaterThan(0);
  });

  it("알 수 없는 블록 도입자를 만나면 예외 없이 false(catch-all 분기 검증)", () => {
    // 0x99는 Trailer(0x3B)/Extension(0x21)/Image Descriptor(0x2C) 중 어느 것도 아니다.
    const bytes = bytesOf(HEADER_89A, lsd(0x00), [0x99, 0x00, 0x00]);
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("Image Descriptor 자체가 10바이트 미만으로 잘리면 false", () => {
    // 도입자(0x2C) 뒤에 5바이트만 있고 나머지(packed 필드까지 총 10바이트)가 없음.
    const bytes = bytesOf(HEADER_89A, lsd(0x00), [0x2c, 0x00, 0x00, 0x00, 0x00, 0x01]);
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("Image Descriptor 직후 LZW 최소 코드 크기 바이트가 없으면 false", () => {
    // 완전한 10바이트 디스크립터(로컬 컬러테이블 없음)만 있고 그 뒤 이미지 데이터가 전혀 없음.
    const bytes = bytesOf(HEADER_89A, lsd(0x00), imageDescriptor(0x00));
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("이미지 데이터 서브블록이 선언된 크기보다 일찍 잘리면 false", () => {
    // LZW(1) + 서브블록 크기=5 선언 + 실제 데이터 2바이트뿐(3바이트 부족).
    const bytes = bytesOf(HEADER_89A, lsd(0x00), imageDescriptor(0x00), [0x02, 0x05, 0x11, 0x22]);
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });

  it("GIF_SCAN_BYTE_LIMIT을 넘어서야 나오는 GCE는 찾지 못한다(스캔 상한 실동작 검증)", () => {
    // Comment Extension 하나를 최대 크기(255바이트) 서브블록으로 스캔 상한 너머까지 이어붙인 뒤에야
    // 종료 마커와 GCE_BLOCK을 배치한다 — 상한 안에서는 둘 다 만나지 못하고 스캔이 먼저 끝나야 한다
    // (GIF_SCAN_BYTE_LIMIT이 "상수로 존재"할 뿐 아니라 실제로 스캔을 잘라낸다는 것 자체를 검증).
    const REPEAT_UNIT = [0xff, ...new Array(255).fill(0x00)]; // 크기=255 서브블록(1+255=256바이트)
    const repeatCount = Math.ceil(GIF_SCAN_BYTE_LIMIT / REPEAT_UNIT.length) + 1; // 상한을 확실히 초과
    const filler: number[] = [];
    for (let i = 0; i < repeatCount; i++) filler.push(...REPEAT_UNIT);
    const bytes = bytesOf(
      HEADER_89A,
      lsd(0x00),
      [0x21, 0xfe], // Comment Extension 도입자+Label
      filler, // 스캔 상한 안에서는 종료 마커에 절대 도달하지 못하는 서브블록열
      [0x00], // 서브블록 종료(스캔 상한 때문에 실제로는 도달 못함)
      GCE_BLOCK, // 도달 못함 — 있어도 못 찾아야 함
      TRAILER
    );
    expect(isAnimatedGifBytes(bytes)).toBe(false);
  });
});

describe("gifBytesFromDataUrl / isAnimatedGifDataUrl", () => {
  it("data: base64 URL에서 원본 바이트를 정확히 복원한다", () => {
    const original = bytesOf(HEADER_89A, lsd(0x00), GCE_BLOCK, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    const dataUrl = `data:image/gif;base64,${toBase64(original)}`;
    const decoded = gifBytesFromDataUrl(dataUrl);
    expect(decoded).not.toBeNull();
    expect(Array.from(decoded!)).toEqual(Array.from(original));
  });

  it("data: URL이 아니면 null", () => {
    expect(gifBytesFromDataUrl("not-a-data-url")).toBeNull();
    expect(gifBytesFromDataUrl("data:text/plain,hello")).toBeNull(); // base64 아님
  });

  it("잘못된 base64 페이로드는 예외 없이 null", () => {
    expect(gifBytesFromDataUrl("data:image/gif;base64,!!!not-base64!!!")).toBeNull();
  });

  it("isAnimatedGifDataUrl: 애니메이션 GIF data URL이면 true", () => {
    const bytes = bytesOf(HEADER_89A, lsd(0x00), GCE_BLOCK, imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    expect(isAnimatedGifDataUrl(`data:image/gif;base64,${toBase64(bytes)}`)).toBe(true);
  });

  it("isAnimatedGifDataUrl: 정적 GIF data URL이면 false", () => {
    const bytes = bytesOf(HEADER_89A, lsd(0x00), imageDescriptor(0x00), MINIMAL_IMAGE_DATA, TRAILER);
    expect(isAnimatedGifDataUrl(`data:image/gif;base64,${toBase64(bytes)}`)).toBe(false);
  });

  it("isAnimatedGifDataUrl: GIF가 아닌 data URL(PNG)이면 false", () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(isAnimatedGifDataUrl(`data:image/png;base64,${toBase64(png)}`)).toBe(false);
  });
});
