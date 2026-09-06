import { beforeEach, describe, expect, it } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import {
  StudioBrushR8GrainRegistry,
  composeStudioBrushR8TipPaperAlphaMap,
} from "./studio-brush-r8-grain-runtime";

import type { NormalizedStudioBrushGrainSettings } from "./studio-brush-material-dynamics";
import type { StudioBrushTipAlphaMap } from "./studio-brush-tip-stamp";

function sourceFor(
  id: string,
  bytes: Uint8Array,
  width: number,
  height: number,
) {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: id,
      encodedSha256: `sha256:${"e".repeat(64)}`,
      decodedSha256: `sha256:${sha256HexPortable(bytes)}`,
      byteLength: Math.max(1, Math.ceil(bytes.byteLength / 2)),
      mediaType: "image/png",
      width,
      height,
      channel: "luminance",
      encoding: "r8-unorm",
    },
  };
}

function sampleInput(overrides: Record<string, unknown> = {}) {
  return {
    x: 3.25,
    y: 5.75,
    strokeOriginX: 1,
    strokeOriginY: 2,
    strokeSeed: 41,
    space: "canvas-fixed" as const,
    scale: 8,
    amount: 0.8,
    contrast: 0.35,
    seed: 73,
    ...overrides,
  };
}

describe("studio brush decoded R8 grain registry", () => {
  let registry: StudioBrushR8GrainRegistry;

  beforeEach(() => {
    registry = new StudioBrushR8GrainRegistry({
      maxEntries: 2,
      maxBytes: 16,
    });
  });

  it("owns a verified private copy and exposes only a synchronous sampler", () => {
    const bytes = new Uint8Array([0, 64, 192, 255]);
    const source = sourceFor("paper-a", bytes, 2, 2);
    const hydrated = registry.hydrate(source, bytes);
    expect(hydrated).toMatchObject({
      status: "ready",
      receipt: {
        assetId: "paper-a",
        decodedByteLength: 4,
        cached: false,
      },
    });
    const sampler = registry.resolve(source);
    expect(sampler).not.toBeNull();
    const beforeMutation = sampler!.sampleAlphaMultiplierAt(sampleInput());
    bytes.fill(255);
    expect(sampler!.sampleAlphaMultiplierAt(sampleInput())).toBe(beforeMutation);
    expect(JSON.stringify({ hydrated, sampler })).not.toMatch(/0,64,192,255|bytes|data:/u);
  });

  it.each([
    {
      name: "dimension mismatch",
      mutate: (
        source: ReturnType<typeof sourceFor>,
        bytes: Uint8Array,
      ) => ({ source, bytes: bytes.subarray(0, bytes.length - 1) }),
      reason: "decoded-dimension-mismatch",
    },
    {
      name: "decoded hash mismatch",
      mutate: (
        source: ReturnType<typeof sourceFor>,
        bytes: Uint8Array,
      ) => ({ source, bytes: new Uint8Array(bytes).fill(7) }),
      reason: "decoded-hash-mismatch",
    },
    {
      name: "binary in source",
      mutate: (
        source: ReturnType<typeof sourceFor>,
        bytes: Uint8Array,
      ) => ({ source: { ...source, bytes }, bytes }),
      reason: "invalid-source",
    },
  ])("rejects $name without exposing a lookup", ({ mutate, reason }) => {
    const original = new Uint8Array([0, 64, 192, 255]);
    const source = sourceFor("paper-a", original, 2, 2);
    const candidate = mutate(source, original);
    expect(registry.hydrate(candidate.source, candidate.bytes)).toEqual({
      status: "rejected",
      reason,
    });
    expect(registry.resolve(source)).toBeNull();
  });

  it("anchors repeats deterministically in canvas or stroke space", () => {
    const bytes = new Uint8Array([
      0, 32, 64, 96,
      128, 160, 192, 224,
      255, 224, 192, 160,
      128, 96, 64, 32,
    ]);
    const source = sourceFor("paper-grid", bytes, 4, 4);
    expect(registry.hydrate(source, bytes).status).toBe("ready");
    const sampler = registry.resolve(source)!;
    const canvas = sampler.sampleAlphaMultiplierAt(sampleInput());
    expect(sampler.sampleAlphaMultiplierAt(sampleInput())).toBe(canvas);
    expect(sampler.sampleAlphaMultiplierAt(sampleInput({
      x: 103.25,
      y: -34.25,
    }))).not.toBeCloseTo(canvas, 8);

    const stroke = sampler.sampleAlphaMultiplierAt(sampleInput({
      space: "stroke-fixed",
    }));
    expect(sampler.sampleAlphaMultiplierAt(sampleInput({
      x: 103.25,
      y: -34.25,
      strokeOriginX: 101,
      strokeOriginY: -38,
      space: "stroke-fixed",
    }))).toBeCloseTo(stroke, 12);
  });

  it("evicts least-recently-used entries and supports explicit release/reset", () => {
    const firstBytes = new Uint8Array([0, 1, 2, 3]);
    const secondBytes = new Uint8Array([4, 5, 6, 7]);
    const thirdBytes = new Uint8Array([8, 9, 10, 11]);
    const first = sourceFor("first", firstBytes, 2, 2);
    const second = sourceFor("second", secondBytes, 2, 2);
    const third = sourceFor("third", thirdBytes, 2, 2);
    expect(registry.hydrate(first, firstBytes).status).toBe("ready");
    expect(registry.hydrate(second, secondBytes).status).toBe("ready");
    expect(registry.resolve(first)).not.toBeNull();
    expect(registry.hydrate(third, thirdBytes).status).toBe("ready");
    expect(registry.resolve(second)).toBeNull();
    expect(registry.resolve(first)).not.toBeNull();
    expect(registry.resolve(third)).not.toBeNull();
    expect(registry.stats()).toMatchObject({
      entries: 2,
      bytes: 8,
      evictions: 1,
    });
    expect(registry.release(first)).toBe(true);
    expect(registry.resolve(first)).toBeNull();
    registry.reset();
    expect(registry.stats()).toEqual({
      entries: 0,
      bytes: 0,
      maxEntries: 2,
      maxBytes: 16,
      hits: 0,
      misses: 0,
      hydrations: 0,
      evictions: 0,
    });
  });

  it("creates bounded private transferable snapshots and omits malformed or evicted sources", () => {
    const firstBytes = new Uint8Array([0, 64, 128, 255]);
    const secondBytes = new Uint8Array([9, 8, 7, 6]);
    const thirdBytes = new Uint8Array([1, 3, 5, 7]);
    const first = sourceFor("snapshot-first", firstBytes, 2, 2);
    const second = sourceFor("snapshot-second", secondBytes, 2, 2);
    const third = sourceFor("snapshot-third", thirdBytes, 2, 2);
    expect(registry.hydrate(first, firstBytes).status).toBe("ready");
    expect(registry.hydrate(second, secondBytes).status).toBe("ready");

    const privateSnapshot = registry.snapshotForTransfer(first);
    expect(privateSnapshot).toMatchObject({
      sourceKey: JSON.stringify(first),
      source: first,
      decodedBytes: firstBytes,
    });
    privateSnapshot!.decodedBytes.fill(255);
    expect(registry.snapshotForTransfer(first)?.decodedBytes).toEqual(firstBytes);

    expect(registry.hydrate(third, thirdBytes).status).toBe("ready");
    expect(registry.snapshotForTransfer(first)).toBeNull();
    expect(registry.snapshotForTransfer({ ...second, unexpected: true })).toBeNull();

    const batch = registry.snapshotManyForTransfer([
      first,
      second,
      second,
      third,
      null,
    ]);
    expect(batch.entries.map(({ source }) => source.asset.assetId)).toEqual([
      "snapshot-second",
      "snapshot-third",
    ]);
    expect(batch.totalDecodedBytes).toBe(8);
    expect(batch.totalDecodedBytes).toBeLessThanOrEqual(registry.stats().maxBytes);
    batch.entries[0]!.decodedBytes.fill(0);
    expect(registry.snapshotForTransfer(second)?.decodedBytes).toEqual(secondBytes);
  });

  it("multiplies verified paper samples into one deterministic tip alpha map", () => {
    const bytes = new Uint8Array([
      0, 255,
      255, 0,
    ]);
    const source = sourceFor("checker", bytes, 2, 2);
    expect(registry.hydrate(source, bytes).status).toBe("ready");
    const sampler = registry.resolve(source)!;
    const tip: StudioBrushTipAlphaMap = {
      size: 2,
      alphas: new Float32Array([1, 0.5, 0.25, 1]),
      shape: "hard",
      softness: 0,
      custom: true,
      revision: "tip-a",
    };
    const grain = {
      space: "canvas-fixed",
      amount: 1,
      scale: 4,
      contrast: 0,
      seed: 1,
      source: sampler.source,
    } satisfies NormalizedStudioBrushGrainSettings;
    const input = {
      tip,
      sampler,
      grain,
      centerX: 10,
      centerY: 20,
      radiusX: 4,
      radiusY: 2,
      angleRadians: Math.PI / 6,
      strokeOriginX: 10,
      strokeOriginY: 20,
      strokeSeed: 71,
    };
    const first = composeStudioBrushR8TipPaperAlphaMap(input);
    const replay = composeStudioBrushR8TipPaperAlphaMap(input);
    expect(first).not.toBeNull();
    expect(replay).not.toBeNull();
    expect([...first!.alphas]).toEqual([...replay!.alphas]);
    expect(first!.revision).toBe(replay!.revision);
    expect(first!.revision).toMatch(/^r8-tip-paper-v1:sha256:[0-9a-f]{64}$/u);
    expect([...first!.alphas]).not.toEqual([...tip.alphas]);
    expect(first!.alphas.every((alpha, index) =>
      alpha >= 0 && alpha <= tip.alphas[index]!
    )).toBe(true);
  });
});
