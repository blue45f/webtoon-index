import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  ApngEncodeCancelledError,
  assembleApng,
  isApngEncodeCancelled,
  parsePngChunks,
  pngChunkCrc32,
  type ApngEncodeProgress,
} from "./studio-apng-encoder";

// ── 테스트 전용 독립 CRC32 — 인코더 구현과 교차 검증한다 ──────────────

const TEST_CRC_TABLE = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table.push(value >>> 0);
  }
  return table;
})();

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ TEST_CRC_TABLE[(crc ^ byte) & 0xff]!;
  return (crc ^ 0xffffffff) >>> 0;
}

// ── PNG 조립 헬퍼(입력 프레임 생성 + 출력 검증용 파서) ─────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function rawChunk(type: string, data: Uint8Array, crcOverride?: number): number[] {
  const typeBytes = [...type].map((ch) => ch.charCodeAt(0));
  const crcInput = Uint8Array.from([...typeBytes, ...data]);
  const crc = crcOverride ?? testCrc32(crcInput);
  return [...u32be(data.byteLength), ...typeBytes, ...data, ...u32be(crc)];
}

function ihdrData(width: number, height: number): Uint8Array {
  return Uint8Array.from([...u32be(width), ...u32be(height), 8, 6, 0, 0, 0]);
}

interface TestPngOptions {
  width?: number;
  height?: number;
  idatParts?: Uint8Array[];
  withText?: boolean;
  extraChunks?: number[][];
  badCrc?: boolean;
}

function makePng(options: TestPngOptions = {}): Uint8Array {
  const width = options.width ?? 4;
  const height = options.height ?? 4;
  // 실제와 비슷한 IDAT — 필터 바이트 0 + RGBA 스캔라인의 deflate 스트림.
  const raw = new Uint8Array(height * (1 + width * 4));
  const idatParts = options.idatParts ?? [new Uint8Array(deflateSync(raw))];
  const bytes: number[] = [...PNG_SIGNATURE];
  bytes.push(
    ...rawChunk("IHDR", ihdrData(width, height), options.badCrc ? 0xdeadbeef : undefined)
  );
  if (options.withText) {
    bytes.push(...rawChunk("tEXt", Uint8Array.from([0x53, 0x00, 0x74])));
  }
  for (const part of idatParts) bytes.push(...rawChunk("IDAT", part));
  for (const extra of options.extraChunks ?? []) bytes.push(...extra);
  bytes.push(...rawChunk("IEND", new Uint8Array(0)));
  return Uint8Array.from(bytes);
}

interface ParsedChunk {
  type: string;
  data: Uint8Array;
  crcValid: boolean;
}

function readChunks(bytes: Uint8Array): ParsedChunk[] {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    expect(bytes[i]).toBe(PNG_SIGNATURE[i]);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: ParsedChunk[] = [];
  let offset = PNG_SIGNATURE.length;
  while (offset < bytes.byteLength) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    );
    const data = bytes.slice(offset + 8, offset + 8 + length);
    const declaredCrc = view.getUint32(offset + 8 + length, false);
    const crcInput = new Uint8Array(4 + length);
    crcInput.set(bytes.subarray(offset + 4, offset + 8));
    crcInput.set(data, 4);
    chunks.push({ type, data, crcValid: declaredCrc === testCrc32(crcInput) });
    offset += 12 + length;
  }
  expect(offset).toBe(bytes.byteLength);
  return chunks;
}

const immediateYield = (): Promise<void> => Promise.resolve();

describe("studio-apng-encoder", () => {
  it("pngChunkCrc32는 표준 PNG CRC32와 일치한다", () => {
    const data = Uint8Array.from([1, 2, 3, 4, 5]);
    const reference = testCrc32(
      Uint8Array.from([..."IDAT"].map((ch) => ch.charCodeAt(0)).concat([...data]))
    );
    expect(pngChunkCrc32("IDAT", data)).toBe(reference);
  });

  it("3프레임을 acTL→fcTL/fdAT 시퀀스 번호와 유효한 CRC로 조립한다", async () => {
    const frames = [
      { png: makePng({ withText: true }), delayMs: 100 },
      {
        png: makePng({
          idatParts: [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5, 6, 7])],
        }),
        delayMs: 50,
      },
      { png: makePng(), delayMs: 700 },
    ];
    const bytes = await assembleApng({ frames, yieldToUi: immediateYield });
    const chunks = readChunks(bytes);

    // 모든 chunk의 CRC가 유효하다.
    for (const chunk of chunks) expect(chunk.crcValid).toBe(true);

    // 구조: IHDR → acTL → (첫 프레임 ancillary 보존) → fcTL → IDAT → fcTL → fdAT×2 → fcTL → fdAT → IEND
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "acTL",
      "tEXt",
      "fcTL",
      "IDAT",
      "fcTL",
      "fdAT",
      "fdAT",
      "fcTL",
      "fdAT",
      "IEND",
    ]);

    const acTL = chunks[1]!;
    const acView = new DataView(acTL.data.buffer, acTL.data.byteOffset);
    expect(acView.getUint32(0, false)).toBe(3); // num_frames
    expect(acView.getUint32(4, false)).toBe(0); // num_plays 0 = 무한 반복

    // sequence 번호는 fcTL/fdAT가 하나의 이름공간을 0부터 공유한다.
    const sequenceOf = (chunk: ParsedChunk): number =>
      new DataView(chunk.data.buffer, chunk.data.byteOffset).getUint32(0, false);
    expect(sequenceOf(chunks[3]!)).toBe(0); // 프레임1 fcTL
    expect(sequenceOf(chunks[5]!)).toBe(1); // 프레임2 fcTL
    expect(sequenceOf(chunks[6]!)).toBe(2); // 프레임2 fdAT #1
    expect(sequenceOf(chunks[7]!)).toBe(3); // 프레임2 fdAT #2
    expect(sequenceOf(chunks[8]!)).toBe(4); // 프레임3 fcTL
    expect(sequenceOf(chunks[9]!)).toBe(5); // 프레임3 fdAT

    // fcTL: 크기·오프셋·지연·dispose/blend
    for (const [chunkIndex, delayMs] of [
      [3, 100],
      [5, 50],
      [8, 700],
    ] as const) {
      const fcTL = chunks[chunkIndex]!;
      expect(fcTL.data.byteLength).toBe(26);
      const view = new DataView(fcTL.data.buffer, fcTL.data.byteOffset);
      expect(view.getUint32(4, false)).toBe(4); // width
      expect(view.getUint32(8, false)).toBe(4); // height
      expect(view.getUint32(12, false)).toBe(0); // x_offset
      expect(view.getUint32(16, false)).toBe(0); // y_offset
      expect(view.getUint16(20, false)).toBe(delayMs); // delay_num
      expect(view.getUint16(22, false)).toBe(1000); // delay_den
      expect(fcTL.data[24]).toBe(0); // dispose_op NONE
      expect(fcTL.data[25]).toBe(0); // blend_op SOURCE
    }

    // fdAT 데이터 = 4바이트 sequence + 원본 IDAT 페이로드.
    expect([...chunks[6]!.data.subarray(4)]).toEqual([1, 2, 3]);
    expect([...chunks[7]!.data.subarray(4)]).toEqual([4, 5, 6, 7]);

    // 결정성 — 같은 입력이면 바이트 단위로 동일하다.
    expect(await assembleApng({ frames, yieldToUi: immediateYield })).toEqual(bytes);
  });

  it("프레임 PNG의 IHDR가 서로 다르면 조립을 거부한다", async () => {
    await expect(
      assembleApng({
        frames: [
          { png: makePng({ width: 4, height: 4 }), delayMs: 100 },
          { png: makePng({ width: 8, height: 4 }), delayMs: 100 },
        ],
        yieldToUi: immediateYield,
      })
    ).rejects.toThrow("프레임 PNG 형식이 서로 달라 APNG로 합칠 수 없어요. 다시 시도해주세요.");
  });

  it("CRC가 깨진 입력·이미 애니메이션 chunk를 가진 입력은 fail-closed로 거부한다", () => {
    expect(() => parsePngChunks(makePng({ badCrc: true }))).toThrow(
      "PNG 프레임 CRC 검증에 실패했어요. 다시 시도해주세요."
    );
    const withAcTL = makePng({
      extraChunks: [rawChunk("acTL", Uint8Array.from([...u32be(1), ...u32be(0)]))],
    });
    expect(() => parsePngChunks(withAcTL)).toThrow(
      "이미 애니메이션 정보를 가진 PNG는 프레임으로 쓸 수 없어요."
    );
    expect(() => parsePngChunks(Uint8Array.from([1, 2, 3]))).toThrow(
      "PNG 프레임 데이터가 손상됐어요. 다시 시도해주세요."
    );
  });

  it("진행률은 단조 증가하며 assemble phase로 1.0까지 보고된다", async () => {
    const events: ApngEncodeProgress[] = [];
    await assembleApng({
      frames: [
        { png: makePng(), delayMs: 40 },
        { png: makePng(), delayMs: 40 },
        { png: makePng(), delayMs: 40 },
      ],
      onProgress: (progress) => events.push(progress),
      yieldToUi: immediateYield,
    });
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.phase).toBe("assemble");
      expect(event.totalFrames).toBe(3);
    }
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i]!.ratio).toBeGreaterThanOrEqual(events[i - 1]!.ratio);
    }
    expect(events[events.length - 1]!.ratio).toBe(1);
  });

  it("isCancelled가 참이 되면 다음 양보 지점에서 ApngEncodeCancelledError로 중단한다", async () => {
    let cancelled = false;
    const pending = assembleApng({
      frames: [
        { png: makePng(), delayMs: 40 },
        { png: makePng(), delayMs: 40 },
      ],
      isCancelled: () => cancelled,
      yieldToUi: () => {
        cancelled = true;
        return Promise.resolve();
      },
    });
    await expect(pending).rejects.toBeInstanceOf(ApngEncodeCancelledError);
    await pending.catch((err: unknown) => {
      expect(isApngEncodeCancelled(err)).toBe(true);
    });
  });

  it("지연 시간은 1ms 하한과 65535ms 상한으로 클램프된다", async () => {
    const bytes = await assembleApng({
      frames: [
        { png: makePng(), delayMs: 0 },
        { png: makePng(), delayMs: 1_000_000 },
      ],
      yieldToUi: immediateYield,
    });
    const fcTLs = readChunks(bytes).filter((chunk) => chunk.type === "fcTL");
    expect(fcTLs).toHaveLength(2);
    const delayOf = (chunk: ParsedChunk): number =>
      new DataView(chunk.data.buffer, chunk.data.byteOffset).getUint16(20, false);
    expect(delayOf(fcTLs[0]!)).toBe(1);
    expect(delayOf(fcTLs[1]!)).toBe(65_535);
  });
});
