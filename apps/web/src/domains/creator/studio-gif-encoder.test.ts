import { describe, expect, it } from "vitest";

import {
  GIF_DITHER_PRESETS,
  GifEncodeCancelledError,
  encodeGif,
  gifDelayCentiseconds,
  isGifEncodeCancelled,
  type GifEncodeProgress,
} from "./studio-gif-encoder";

// ── 테스트 전용 최소 GIF 디코더 — 인코더와 독립 구현으로 왕복을 검증한다 ──

interface DecodedGifFrame {
  delayCs: number;
  disposal: number;
  transparentIndex: number | null;
  indices: Uint8Array;
}

interface DecodedGif {
  width: number;
  height: number;
  palette: [number, number, number][];
  loopCount: number | null;
  frames: DecodedGifFrame[];
  sawTrailer: boolean;
}

function readSubBlocks(bytes: Uint8Array, start: number): { data: Uint8Array; next: number } {
  const parts: number[] = [];
  let offset = start;
  for (;;) {
    const size = bytes[offset]!;
    offset += 1;
    if (size === 0) break;
    for (let i = 0; i < size; i += 1) parts.push(bytes[offset + i]!);
    offset += size;
  }
  return { data: Uint8Array.from(parts), next: offset };
}

function lzwDecode(minCodeSize: number, data: Uint8Array, expectedPixels: number): Uint8Array {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dictionary: number[][] = [];
  let nextEntry = 0;
  const reset = (): void => {
    dictionary = [];
    for (let i = 0; i < clearCode; i += 1) dictionary[i] = [i];
    nextEntry = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };
  reset();

  const output: number[] = [];
  let previous: number[] | null = null;
  let bitBuffer = 0;
  let bitCount = 0;
  let byteIndex = 0;
  for (;;) {
    while (bitCount < codeSize) {
      if (byteIndex >= data.length) throw new Error("LZW stream ended early");
      bitBuffer |= data[byteIndex]! << bitCount;
      byteIndex += 1;
      bitCount += 8;
    }
    const code = bitBuffer & ((1 << codeSize) - 1);
    bitBuffer >>>= codeSize;
    bitCount -= codeSize;

    if (code === clearCode) {
      reset();
      previous = null;
      continue;
    }
    if (code === eoiCode) break;
    let entry: number[];
    if (code < nextEntry && dictionary[code]) {
      entry = dictionary[code]!;
    } else if (code === nextEntry && previous) {
      entry = [...previous, previous[0]!];
    } else {
      throw new Error(`invalid LZW code ${code}`);
    }
    output.push(...entry);
    if (previous && nextEntry < 4096) {
      dictionary[nextEntry] = [...previous, entry[0]!];
      nextEntry += 1;
      if (nextEntry === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    previous = entry;
    if (output.length >= expectedPixels) break;
  }
  if (output.length !== expectedPixels) throw new Error("LZW pixel count mismatch");
  return Uint8Array.from(output);
}

function decodeGif(bytes: Uint8Array): DecodedGif {
  const header = String.fromCharCode(...bytes.subarray(0, 6));
  if (header !== "GIF89a") throw new Error(`unexpected header ${header}`);
  const width = bytes[6]! | (bytes[7]! << 8);
  const height = bytes[8]! | (bytes[9]! << 8);
  const packed = bytes[10]!;
  if ((packed & 0x80) === 0) throw new Error("expected global color table");
  const tableSize = 1 << ((packed & 0x07) + 1);
  let offset = 13;
  const palette: [number, number, number][] = [];
  for (let i = 0; i < tableSize; i += 1) {
    palette.push([bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!]);
    offset += 3;
  }

  let loopCount: number | null = null;
  const frames: DecodedGifFrame[] = [];
  let pendingDelay = 0;
  let pendingDisposal = 0;
  let pendingTransparent: number | null = null;
  let sawTrailer = false;
  while (offset < bytes.length) {
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = bytes[offset]!;
      offset += 1;
      if (label === 0xf9) {
        const blockSize = bytes[offset]!;
        if (blockSize !== 4) throw new Error("bad GCE size");
        const flags = bytes[offset + 1]!;
        pendingDisposal = (flags >> 2) & 0x07;
        pendingDelay = bytes[offset + 2]! | (bytes[offset + 3]! << 8);
        pendingTransparent = flags & 0x01 ? bytes[offset + 4]! : null;
        offset += 5;
        if (bytes[offset] !== 0) throw new Error("missing GCE terminator");
        offset += 1;
      } else if (label === 0xff) {
        const blockSize = bytes[offset]!;
        const app = String.fromCharCode(...bytes.subarray(offset + 1, offset + 1 + blockSize));
        offset += 1 + blockSize;
        const sub = readSubBlocks(bytes, offset);
        offset = sub.next;
        if (app === "NETSCAPE2.0" && sub.data[0] === 0x01) {
          loopCount = sub.data[1]! | (sub.data[2]! << 8);
        }
      } else {
        const sub = readSubBlocks(bytes, offset);
        offset = sub.next;
      }
      continue;
    }
    if (marker === 0x2c) {
      const frameWidth = bytes[offset + 4]! | (bytes[offset + 5]! << 8);
      const frameHeight = bytes[offset + 6]! | (bytes[offset + 7]! << 8);
      const framePacked = bytes[offset + 8]!;
      if ((framePacked & 0x80) !== 0) throw new Error("unexpected local color table");
      offset += 9;
      const minCodeSize = bytes[offset]!;
      offset += 1;
      const sub = readSubBlocks(bytes, offset);
      offset = sub.next;
      frames.push({
        delayCs: pendingDelay,
        disposal: pendingDisposal,
        transparentIndex: pendingTransparent,
        indices: lzwDecode(minCodeSize, sub.data, frameWidth * frameHeight),
      });
      pendingDelay = 0;
      pendingDisposal = 0;
      pendingTransparent = null;
      continue;
    }
    throw new Error(`unexpected block marker 0x${marker.toString(16)}`);
  }
  return { width, height, palette, loopCount, frames, sawTrailer };
}

// ── 픽셀 헬퍼 ────────────────────────────────────────────────────────

function solidFrame(width: number, height: number, rgba: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) data.set(rgba, i * 4);
  return data;
}

const immediateYield = (): Promise<void> => Promise.resolve();

describe("studio-gif-encoder", () => {
  it("delayMs → centiseconds 변환은 하한 2cs·상한 65535cs로 클램프된다", () => {
    expect(gifDelayCentiseconds(100)).toBe(10);
    expect(gifDelayCentiseconds(83.3)).toBe(8);
    expect(gifDelayCentiseconds(5)).toBe(2);
    expect(gifDelayCentiseconds(0)).toBe(2);
    expect(gifDelayCentiseconds(Number.NaN)).toBe(2);
    expect(gifDelayCentiseconds(10_000_000)).toBe(65_535);
  });

  it("2프레임 4x4 애니메이션을 GIF89a로 인코딩하고 최소 디코더 왕복이 원본 픽셀과 일치한다", async () => {
    const red = solidFrame(4, 4, [255, 0, 0, 255]);
    const blue = solidFrame(4, 4, [0, 0, 255, 255]);
    // 두 번째 프레임 한 픽셀만 초록 — 프레임별 인덱스 스트림이 실제로 다른지 확인
    blue.set([0, 255, 0, 255], (2 * 4 + 1) * 4);

    const bytes = await encodeGif({
      width: 4,
      height: 4,
      frames: [
        { rgba: red, delayCs: 10 },
        { rgba: blue, delayCs: 5 },
      ],
      yieldToUi: immediateYield,
    });

    expect(String.fromCharCode(...bytes.subarray(0, 6))).toBe("GIF89a");
    expect(bytes[bytes.length - 1]).toBe(0x3b);

    const decoded = decodeGif(bytes);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.sawTrailer).toBe(true);
    expect(decoded.loopCount).toBe(0); // NETSCAPE2.0 무한 반복
    expect(decoded.frames).toHaveLength(2);
    expect(decoded.frames[0]!.delayCs).toBe(10);
    expect(decoded.frames[1]!.delayCs).toBe(5);
    expect(decoded.frames[0]!.transparentIndex).toBeNull();

    const framePixels = (frame: DecodedGifFrame): [number, number, number][] =>
      [...frame.indices].map((index) => decoded.palette[index]!);
    expect(framePixels(decoded.frames[0]!)).toEqual(Array.from({ length: 16 }, () => [255, 0, 0]));
    const secondPixels = framePixels(decoded.frames[1]!);
    expect(secondPixels[2 * 4 + 1]).toEqual([0, 255, 0]);
    expect(secondPixels[0]).toEqual([0, 0, 255]);
  });

  it("alpha<128 픽셀은 1비트 투명 인덱스로 기록되고 GCE에 투명 플래그가 선다", async () => {
    const frame = solidFrame(4, 4, [10, 20, 30, 255]);
    frame.set([0, 0, 0, 0], 0); // (0,0) 완전 투명
    frame.set([50, 60, 70, 40], 4); // (1,0) 반투명 → 임계값 미달 → 투명

    const bytes = await encodeGif({
      width: 4,
      height: 4,
      frames: [
        { rgba: frame, delayCs: 4 },
        { rgba: frame, delayCs: 4 },
      ],
      yieldToUi: immediateYield,
    });

    const decoded = decodeGif(bytes);
    const first = decoded.frames[0]!;
    expect(first.transparentIndex).not.toBeNull();
    expect(first.disposal).toBe(2); // 투명 사용 시 배경 복원
    expect(first.indices[0]).toBe(first.transparentIndex);
    expect(first.indices[1]).toBe(first.transparentIndex);
    expect(decoded.palette[first.indices[2]!]).toEqual([10, 20, 30]);
  });

  it("고유 색이 maxColors를 넘으면 median-cut으로 팔레트를 결정적으로 줄인다", async () => {
    const width = 16;
    const height = 16;
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
      rgba.set([i, 255 - i, (i * 7) & 0xff, 255], i * 4); // 256개 전부 다른 색
    }
    const encodeOnce = () =>
      encodeGif({
        width,
        height,
        frames: [
          { rgba, delayCs: 3 },
          { rgba, delayCs: 3 },
        ],
        maxColors: 16,
        yieldToUi: immediateYield,
      });

    const bytes = await encodeOnce();
    const decoded = decodeGif(bytes);
    expect(decoded.palette.length).toBeLessThanOrEqual(16);
    for (const frame of decoded.frames) {
      for (const index of frame.indices) expect(index).toBeLessThan(decoded.palette.length);
    }
    // 결정성 — 같은 입력이면 바이트 단위로 동일하다.
    expect(await encodeOnce()).toEqual(bytes);
  });

  for (const preset of GIF_DITHER_PRESETS) {
    it(`${preset.id} 디더링 출력도 유효한 GIF로 왕복 디코딩된다`, async () => {
      const width = 8;
      const height = 8;
      const rgba = new Uint8Array(width * height * 4);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = Math.round(((y * width + x) / (width * height - 1)) * 255);
          rgba.set([value, value, value, 255], (y * width + x) * 4);
        }
      }
      const bytes = await encodeGif({
        width,
        height,
        frames: [
          { rgba, delayCs: 6 },
          { rgba, delayCs: 6 },
        ],
        maxColors: 4,
        dither: preset.id,
        yieldToUi: immediateYield,
      });
      const decoded = decodeGif(bytes);
      expect(decoded.frames).toHaveLength(2);
      for (const frame of decoded.frames) {
        for (const index of frame.indices) expect(index).toBeLessThan(decoded.palette.length);
      }
      expect(await encodeGif({
        width,
        height,
        frames: [
          { rgba, delayCs: 6 },
          { rgba, delayCs: 6 },
        ],
        maxColors: 4,
        dither: preset.id,
        yieldToUi: immediateYield,
      })).toEqual(bytes);
    });
  }

  it("진행률은 quantize→encode 순으로 단조 증가하며 1.0으로 끝난다", async () => {
    const events: GifEncodeProgress[] = [];
    await encodeGif({
      width: 4,
      height: 4,
      frames: [
        { rgba: solidFrame(4, 4, [1, 2, 3, 255]), delayCs: 3 },
        { rgba: solidFrame(4, 4, [4, 5, 6, 255]), delayCs: 3 },
        { rgba: solidFrame(4, 4, [7, 8, 9, 255]), delayCs: 3 },
      ],
      onProgress: (progress) => events.push(progress),
      yieldToUi: immediateYield,
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.phase).toBe("quantize");
    expect(events[events.length - 1]).toMatchObject({ phase: "encode", frameIndex: 2, totalFrames: 3, ratio: 1 });
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.ratio).toBeGreaterThanOrEqual(events[i - 1]!.ratio);
    }
    const phases = new Set(events.map((event) => event.phase));
    expect(phases).toEqual(new Set(["quantize", "encode"]));
  });

  it("isCancelled가 참이 되면 다음 양보 지점에서 GifEncodeCancelledError로 중단한다", async () => {
    let cancelled = false;
    const pending = encodeGif({
      width: 4,
      height: 4,
      frames: [
        { rgba: solidFrame(4, 4, [255, 0, 0, 255]), delayCs: 3 },
        { rgba: solidFrame(4, 4, [0, 255, 0, 255]), delayCs: 3 },
      ],
      isCancelled: () => cancelled,
      yieldToUi: () => {
        cancelled = true;
        return Promise.resolve();
      },
    });
    await expect(pending).rejects.toBeInstanceOf(GifEncodeCancelledError);
    await pending.catch((err: unknown) => {
      expect(isGifEncodeCancelled(err)).toBe(true);
    });
  });

  it("빈 프레임 목록과 크기 불일치 픽셀 버퍼는 fail-closed로 거부한다", async () => {
    await expect(encodeGif({ width: 4, height: 4, frames: [], yieldToUi: immediateYield })).rejects.toThrow(
      "내보낼 프레임이 없어요."
    );
    await expect(
      encodeGif({
        width: 4,
        height: 4,
        frames: [{ rgba: new Uint8Array(8), delayCs: 3 }],
        yieldToUi: immediateYield,
      })
    ).rejects.toThrow("프레임 픽셀 데이터가 크기와 맞지 않아요. 다시 시도해주세요.");
  });
});
