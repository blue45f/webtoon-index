import { deflateSync } from "node:zlib";

import { calculateStudioCrc32 } from "../studio-crc32";

import type { StudioLift3dSourceImage } from "./studio-lift3d-contract";

export interface TestRgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

function writePixel(
  pixels: Uint8ClampedArray,
  index: number,
  color: TestRgba,
): void {
  pixels[index] = color.r;
  pixels[index + 1] = color.g;
  pixels[index + 2] = color.b;
  pixels[index + 3] = color.a;
}

/** 투명 배경 위의 불투명 원반. 알파 마스크 경로와 inflate 위상의 기본 표본. */
export function discImage(
  size: number,
  radiusRatio = 0.4,
  fill: TestRgba = { r: 220, g: 90, b: 60, a: 255 },
): StudioLift3dSourceImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size * radiusRatio;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = Math.hypot(x - center, y - center) <= radius;
      writePixel(pixels, (y * size + x) * 4, inside ? fill : { r: 0, g: 0, b: 0, a: 0 });
    }
  }
  return { width: size, height: size, pixels };
}

/**
 * 알파가 없는 불투명 원화. 배경색과 **똑같은 색의 구멍**이 피사체 안에 있어서, 색 임계만
 * 쓰는 구현은 그 구멍을 뚫어버리고 플러드 필을 쓰는 구현만 살려낸다.
 */
export function opaqueSquareImage(
  size: number,
  background: TestRgba = { r: 240, g: 240, b: 240, a: 255 },
): StudioLift3dSourceImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const low = Math.round(size * 0.25);
  const high = Math.round(size * 0.75);
  const holeLow = Math.round(size * 0.45);
  const holeHigh = Math.round(size * 0.55);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inSquare = x >= low && x < high && y >= low && y < high;
      const inHole = x >= holeLow && x < holeHigh && y >= holeLow && y < holeHigh;
      const color = !inSquare || inHole ? background : { r: 30, g: 60, b: 140, a: 255 };
      writePixel(pixels, (y * size + x) * 4, color);
    }
  }
  return { width: size, height: size, pixels };
}

/**
 * 명암이 완전히 고른 불투명 이미지. relief 깊이장이 어디서나 같은 값이 되므로 밴드가 하나로
 * 뭉친다 — 시차 레이어가 카드 한 장으로 주저앉는 경우를 만들 때 쓴다.
 */
export function flatImage(
  size: number,
  colour: TestRgba = { r: 128, g: 128, b: 128, a: 255 },
): StudioLift3dSourceImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let index = 0; index < size * size; index += 1) writePixel(pixels, index * 4, colour);
  return { width: size, height: size, pixels };
}

/** 위에서 아래로 밝아지는 불투명 그라데이션. relief(명암→높이) 경로용. */
export function verticalGradientImage(size: number): StudioLift3dSourceImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    const level = Math.round((y / Math.max(1, size - 1)) * 255);
    for (let x = 0; x < size; x += 1) {
      writePixel(pixels, (y * size + x) * 4, { r: level, g: level, b: level, a: 255 });
    }
  }
  return { width: size, height: size, pixels };
}

/**
 * 큰 명암 경사 위에 **고운 잔결**이 얹힌 불투명 배경. 숲·수풀처럼 흔한 배경 원화다.
 *
 * 경사가 모든 깊이 밴드를 채우고 잔결이 한 칸에서 여러 밴드를 건너뛰게 하므로, 층수를 원화의
 * 깊이 잔결보다 잘게 잡았을 때 카드 사이에 틈이 생기는 조건을 그대로 재현한다.
 */
export function texturedBackgroundImage(size: number): StudioLift3dSourceImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const shade = 0.5 + 0.3 * (y / Math.max(1, size - 1))
        + 0.18 * Math.sin(x / 4) * Math.cos(y / 5);
      const level = Math.max(0, Math.min(255, Math.round(shade * 255)));
      writePixel(pixels, (y * size + x) * 4, { r: level, g: level, b: level, a: 255 });
    }
  }
  return { width: size, height: size, pixels };
}

/**
 * 왼쪽 절반과 오른쪽 절반의 명암이 **딱 끊기는** 불투명 배경. 화면을 세로로 가르는 균열
 * 하나가 생기는 원화라, 균열의 길이가 아니라 비율로 판정할 때 분모를 무엇으로 잡았는지가
 * 그대로 드러난다.
 */
export function cliffBackgroundImage(size: number): StudioLift3dSourceImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const level = x < size / 2 ? 38 : 217;
      writePixel(pixels, (y * size + x) * 4, { r: level, g: level, b: level, a: 255 });
    }
  }
  return { width: size, height: size, pixels };
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(8 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(4 + body.length, calculateStudioCrc32(body) >>> 0, false);
  return out;
}

/** 진짜 PNG 를 만든다 — GLB 검증 게이트가 이미지 헤더에서 실제 크기를 읽기 때문이다. */
export function encodeTestPng(image: StudioLift3dSourceImage): Uint8Array {
  const { width, height, pixels } = image;
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = new Uint8Array(deflateSync(Buffer.from(raw)));
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const png = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    png.set(chunk, offset);
    offset += chunk.length;
  }
  return png;
}

/** 발산 정리로 구한 닫힌 메시의 부호 있는 부피. 면 감기가 바깥을 향하면 양수다. */
export function signedVolume(positions: Float32Array, indices: Uint32Array): number {
  let volume = 0;
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const ax = positions[a]!;
    const ay = positions[a + 1]!;
    const az = positions[a + 2]!;
    const bx = positions[b]!;
    const by = positions[b + 1]!;
    const bz = positions[b + 2]!;
    const cx = positions[c]!;
    const cy = positions[c + 1]!;
    const cz = positions[c + 2]!;
    volume += (
      ax * (by * cz - bz * cy)
      - ay * (bx * cz - bz * cx)
      + az * (bx * cy - by * cx)
    ) / 6;
  }
  return volume;
}
