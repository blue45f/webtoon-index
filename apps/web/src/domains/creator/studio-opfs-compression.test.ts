import { describe, expect, it } from "vitest";

import {
  chooseStudioOpfsCodec,
  compressStudioOpfsBytes,
  decompressStudioOpfsBytes,
  describeStudioOpfsCompression,
  encodeStudioOpfsPayload,
  isStudioOpfsCodec,
  isStudioOpfsPrecompressedMime,
  STUDIO_OPFS_MIN_COMPRESS_BYTES,
  studioOpfsCompressionSaving,
  studioOpfsCompressionSupport,
} from "./studio-opfs-compression";

/** 결정적 PRNG — 측정값이 실행마다 흔들리면 "실측"이라고 부를 수 없다. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomBytes(count: number, seed: number): Uint8Array {
  const random = createRandom(seed);
  const bytes = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) bytes[index] = Math.floor(random() * 256);
  return bytes;
}

/** 실제 브러시 라이브러리와 같은 모양의 JSON payload(120종). */
function realisticBrushLibraryJson(): string {
  const random = createRandom(0x51a7c0de);
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(random() * values.length)] as T;
  const brushes = Array.from({ length: 120 }, (_unused, index) => ({
    id: Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join(""),
    name: `${pick(["잉크", "마루", "지펜", "에어브러시", "수채", "마커"])} 펜 ${index}`,
    createdAt: 1_753_000_000_000 + Math.floor(random() * 9e7),
    updatedAt: 1_753_000_000_000 + Math.floor(random() * 9e7),
    pinned: random() < 0.07,
    lastUsedAt: random() < 0.4 ? 1_753_000_000_000 + Math.floor(random() * 9e7) : null,
    brushId: pick(["ink-pen", "g-pen", "maru-pen", "airbrush", "watercolor", "marker"]),
    strokeWidth: 1 + Math.floor(random() * 79),
    brushOpacity: Math.round(random() * 95 + 5) / 100,
    color: `#${Array.from({ length: 6 }, () => "0123456789abcdef"[Math.floor(random() * 16)]).join("")}`,
    stabilizer: Math.floor(random() * 11),
    stabilizerMode: pick(["standard", "velocity", "precise"]),
    pressureCurve: Math.round((0.3 + random() * 2.7) * 100) / 100,
    useVelocityPressure: random() < 0.5,
    velocitySensitivity: Math.round(random() * 90 + 10) / 100,
    tiltEnabled: random() < 0.5,
    tipAngle: Math.floor(random() * 360),
    tipRoundness: Math.round((0.08 + random() * 0.92) * 100) / 100,
    brushDynamics: Object.fromEntries(
      [
        "sizeJitter", "sizeByPressure", "sizeByVelocity", "sizeByTilt", "opacityJitter",
        "opacityByPressure", "opacityByVelocity", "spacing", "spacingJitter", "scatter",
        "scatterCount", "angleJitter", "angleByDirection", "angleByTwist", "hueJitter",
        "saturationJitter", "brightnessJitter",
      ].map((key) => [key, Math.round(random() * 100) / 100])
    ),
    stampTuning:
      random() < 0.5
        ? { flow: Math.round(random() * 100) / 100, hardness: Math.round(random() * 100) / 100, minSize: Math.round(random() * 100) / 100 }
        : null,
  }));
  return JSON.stringify({ version: 1, brushes });
}

describe("studio-opfs-compression", () => {
  const support = studioOpfsCompressionSupport();

  it("이 런타임에서 gzip을 지원한다(측정 전제)", () => {
    expect(support.supported("identity")).toBe(true);
    expect(support.supported("gzip")).toBe(true);
  });

  it("지원하지 않는 런타임은 identity만 남긴다", () => {
    const none = studioOpfsCompressionSupport({});
    expect(none.codecs).toEqual(["identity"]);
    expect(none.supported("gzip")).toBe(false);
  });

  it("format 단위 거부(구형 Safari의 deflate-raw)를 존재 검사가 아니라 생성으로 잡는다", () => {
    class PartialStream {
      constructor(format: string) {
        if (format !== "gzip") throw new TypeError("unsupported");
      }
    }
    const partial = studioOpfsCompressionSupport({
      CompressionStream: PartialStream,
      DecompressionStream: PartialStream,
    });
    expect(partial.supported("gzip")).toBe(true);
    expect(partial.supported("deflate-raw")).toBe(false);
  });

  it.each(["gzip", "deflate-raw"] as const)("%s 왕복이 바이트를 그대로 보존한다", async (codec) => {
    const original = new TextEncoder().encode(realisticBrushLibraryJson());
    const compressed = await compressStudioOpfsBytes(original, codec);
    const restored = await decompressStudioOpfsBytes(compressed, codec);
    expect(restored.byteLength).toBe(original.byteLength);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it("identity는 무손실 복사본이며 원본과 메모리를 공유하지 않는다", async () => {
    const original = new Uint8Array([1, 2, 3]);
    const stored = await compressStudioOpfsBytes(original, "identity");
    stored[0] = 9;
    expect(original[0]).toBe(1);
    expect(Array.from(await decompressStudioOpfsBytes(new Uint8Array([1, 2, 3]), "identity"))).toEqual([1, 2, 3]);
  });

  it("고엔트로피 바이너리 왕복도 손실이 없다", async () => {
    const original = randomBytes(200_000, 0xbeef);
    const restored = await decompressStudioOpfsBytes(
      await compressStudioOpfsBytes(original, "gzip"),
      "gzip"
    );
    expect(Array.from(restored.subarray(0, 64))).toEqual(Array.from(original.subarray(0, 64)));
    expect(restored.byteLength).toBe(original.byteLength);
  });

  it("브러시 라이브러리 JSON에서 최소 50% 이상 줄인다(실측 고정)", async () => {
    const original = new TextEncoder().encode(realisticBrushLibraryJson());
    const compressed = await compressStudioOpfsBytes(original, "gzip");
    const ratio = compressed.byteLength / original.byteLength;
    // 실측: 112 KB → 19.7 KB(17.5%). 회귀 감지를 위해 넉넉한 상한만 고정한다.
    expect(original.byteLength).toBeGreaterThan(90_000);
    expect(ratio).toBeLessThan(0.5);
    expect(studioOpfsCompressionSaving(original.byteLength, compressed.byteLength)).toBeGreaterThan(0.5);
  });

  it("이미 압축된 컨테이너는 압축하지 않는다", () => {
    expect(isStudioOpfsPrecompressedMime("font/woff2")).toBe(true);
    expect(isStudioOpfsPrecompressedMime("image/PNG")).toBe(true);
    expect(isStudioOpfsPrecompressedMime("model/gltf-binary")).toBe(true);
    expect(isStudioOpfsPrecompressedMime("application/json")).toBe(false);

    expect(chooseStudioOpfsCodec("font/woff2", 3_000_000, support)).toBe("identity");
    expect(chooseStudioOpfsCodec("application/json", 3_000_000, support)).toBe("gzip");
  });

  it("작은 payload는 헤더 비용 때문에 압축하지 않는다", () => {
    expect(chooseStudioOpfsCodec("application/json", STUDIO_OPFS_MIN_COMPRESS_BYTES - 1, support)).toBe("identity");
    expect(chooseStudioOpfsCodec("application/json", STUDIO_OPFS_MIN_COMPRESS_BYTES, support)).toBe("gzip");
  });

  it("압축해도 줄지 않으면 identity로 되돌린다(더 커진 결과를 저장하지 않는다)", async () => {
    // MIME은 압축 대상이라고 말하지만 내용은 난수 — 정책이 아니라 실제 크기로 판단해야 한다.
    const incompressible = randomBytes(64_000, 0x1234);
    const encoded = await encodeStudioOpfsPayload(incompressible, "application/octet-stream", support);
    expect(encoded.codec).toBe("identity");
    expect(encoded.bytes.byteLength).toBe(incompressible.byteLength);
  });

  it("압축 대상 payload는 코덱과 실제 이득을 함께 보고한다", async () => {
    const json = new TextEncoder().encode(realisticBrushLibraryJson());
    const encoded = await encodeStudioOpfsPayload(json, "application/json", support);
    expect(encoded.codec).toBe("gzip");
    expect(encoded.ratio).toBeLessThan(0.5);
    expect(encoded.bytes.byteLength).toBeLessThan(json.byteLength);
    expect(describeStudioOpfsCompression(json.byteLength, encoded.bytes.byteLength)).toMatch(/% 절약$/u);
  });

  it("압축을 못 하는 런타임에서도 저장은 실패하지 않는다(identity로 강등)", async () => {
    const json = new TextEncoder().encode(realisticBrushLibraryJson());
    const encoded = await encodeStudioOpfsPayload(json, "application/json", studioOpfsCompressionSupport({}), {});
    expect(encoded.codec).toBe("identity");
    expect(encoded.bytes.byteLength).toBe(json.byteLength);
  });

  it("복원 불가 런타임은 조용히 빈 값을 주는 대신 한국어로 거절한다", async () => {
    await expect(decompressStudioOpfsBytes(new Uint8Array([1, 2, 3]), "gzip", {})).rejects.toThrow(
      /압축 해제를 지원하지 않아/u
    );
  });

  it("코덱 이름 판별", () => {
    expect(isStudioOpfsCodec("gzip")).toBe(true);
    expect(isStudioOpfsCodec("brotli")).toBe(false);
  });
});
