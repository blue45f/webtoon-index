import { describe, expect, it } from "vitest";

import {
  createStudioWetInkField,
  depositStudioWetInkStroke,
  simulateStudioWetInkField,
  studioWetInkFieldDigest,
  type StudioWetInkField,
} from "./studio-wet-ink-field";
import {
  STUDIO_WET_INK_SNAPSHOT_LIMITS,
  decodeStudioWetInkFieldSnapshot,
  encodeStudioWetInkFieldSnapshot,
} from "./studio-wet-ink-persistence";

function physicalField(): StudioWetInkField {
  const created = createStudioWetInkField({
    width: 72,
    height: 56,
    tileSize: 16,
    seed: 101,
    maxTiles: 64,
    maxCells: 8_192,
    maxSimulationSteps: 256,
    maxUploadBytes: 1_048_576,
    inkColor: { r: 42, g: 31, b: 54 },
  });
  if (!created.ok) throw new Error(created.reason);
  const deposited = depositStudioWetInkStroke(created.value, {
    samples: [
      { x: 7, y: 11, timeMs: 0, pressure: 0.3 },
      { x: 28, y: 17, timeMs: 24, pressure: 0.82 },
      { x: 60, y: 41, timeMs: 58, pressure: 0.55 },
    ],
    radius: 5.5,
    hardness: 0.31,
    spacing: 3,
    waterLoad: 0.86,
    pigmentLoad: 0.69,
    wetnessLoad: 0.91,
    seed: 77,
    maxDabs: 2_048,
  });
  if (!deposited.ok) throw new Error(deposited.reason);
  const simulated = simulateStudioWetInkField(created.value, 4);
  if (!simulated.ok) throw new Error(simulated.reason);
  return created.value;
}

function encodedField(): {
  field: StudioWetInkField;
  bytes: Uint8Array;
} {
  const field = physicalField();
  const encoded = encodeStudioWetInkFieldSnapshot(field);
  if (!encoded.ok) throw new Error(encoded.reason);
  return { field, bytes: encoded.value.bytes };
}

describe("Studio wet-ink physical-state persistence", () => {
  it("round-trips every physical tile and publishes an integrity receipt", () => {
    const field = physicalField();
    const encoded = encodeStudioWetInkFieldSnapshot(field);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    const decoded = decodeStudioWetInkFieldSnapshot(encoded.value.bytes);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;

    expect(studioWetInkFieldDigest(decoded.value.field)).toBe(
      studioWetInkFieldDigest(field),
    );
    expect(decoded.value.field.config).toEqual(field.config);
    expect(decoded.value.field.activeBounds).toEqual(field.activeBounds);
    expect(decoded.value.field.dirtyBounds).toEqual(field.dirtyBounds);
    expect(decoded.value.receipt).toMatchObject({
      kind: "studio-wet-ink-snapshot-receipt",
      snapshotKind: "toonspectrum.wet-ink-snapshot",
      snapshotVersion: 1,
      fieldVersion: 1,
      byteLength: encoded.value.bytes.byteLength,
      tileCount: field.tiles.size,
      allocatedCells: field.allocatedCells,
      simulationStep: field.simulationStep,
      fieldDigest: studioWetInkFieldDigest(field),
      continuation: "physical-state-preserved",
    });
    expect(decoded.value.receipt.snapshotSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("continues diffusion and drying identically after reopening", () => {
    const field = physicalField();
    const encoded = encodeStudioWetInkFieldSnapshot(field);
    if (!encoded.ok) throw new Error(encoded.reason);
    const decoded = decodeStudioWetInkFieldSnapshot(encoded.value.bytes);
    if (!decoded.ok) throw new Error(decoded.reason);

    const originalContinuation = simulateStudioWetInkField(field, 7);
    const reopenedContinuation = simulateStudioWetInkField(decoded.value.field, 7);
    expect(originalContinuation.ok).toBe(true);
    expect(reopenedContinuation.ok).toBe(true);
    expect(studioWetInkFieldDigest(decoded.value.field)).toBe(
      studioWetInkFieldDigest(field),
    );
  });

  it("is deterministic regardless of sparse Map insertion order", () => {
    const field = physicalField();
    const first = encodeStudioWetInkFieldSnapshot(field);
    if (!first.ok) throw new Error(first.reason);

    const reverse = [...field.tiles.entries()].reverse();
    field.tiles.clear();
    for (const [key, tile] of reverse) field.tiles.set(key, tile);
    const second = encodeStudioWetInkFieldSnapshot(field);
    if (!second.ok) throw new Error(second.reason);

    expect(second.value.bytes).toEqual(first.value.bytes);
    expect(second.value.receipt.snapshotSha256).toBe(
      first.value.receipt.snapshotSha256,
    );
  });

  it("returns detached decoded arrays and detached encoded bytes", () => {
    const field = physicalField();
    const encoded = encodeStudioWetInkFieldSnapshot(field);
    if (!encoded.ok) throw new Error(encoded.reason);
    const beforeBytes = encoded.value.bytes.slice();
    const decoded = decodeStudioWetInkFieldSnapshot(encoded.value.bytes);
    if (!decoded.ok) throw new Error(decoded.reason);

    const sourceTile = [...field.tiles.values()][0]!;
    const decodedTile = [...decoded.value.field.tiles.values()][0]!;
    const sourceWater = sourceTile.water[0]!;
    decodedTile.water[0] = Math.min(4, decodedTile.water[0]! + 0.25);

    expect(sourceTile.water[0]).toBe(sourceWater);
    expect(encoded.value.bytes).toEqual(beforeBytes);
  });

  it("fails closed on truncation, unsupported versions and invalid physics", () => {
    const { bytes } = encodedField();
    expect(
      decodeStudioWetInkFieldSnapshot(bytes.subarray(0, bytes.byteLength - 1)),
    ).toMatchObject({ ok: false, code: "invalid-snapshot" });

    const unsupported = bytes.slice();
    new DataView(unsupported.buffer).setUint16(4, 2, true);
    expect(decodeStudioWetInkFieldSnapshot(unsupported)).toMatchObject({
      ok: false,
      code: "unsupported-version",
    });

    const nonFinite = bytes.slice();
    const view = new DataView(nonFinite.buffer);
    const metadataBytes = view.getUint32(8, true);
    const firstChannelOffset =
      STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes
      + metadataBytes
      + STUDIO_WET_INK_SNAPSHOT_LIMITS.tileHeaderBytes;
    view.setFloat32(firstChannelOffset, Number.NaN, true);
    expect(decodeStudioWetInkFieldSnapshot(nonFinite)).toMatchObject({
      ok: false,
      code: "invalid-snapshot",
    });
  });

  it("enforces caller byte budgets before hydration or allocation", () => {
    const { field, bytes } = encodedField();
    expect(
      encodeStudioWetInkFieldSnapshot(field, {
        maxBytes: STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes + 1,
      }),
    ).toMatchObject({ ok: false, code: "budget-exceeded" });
    expect(
      decodeStudioWetInkFieldSnapshot(bytes, {
        maxBytes: STUDIO_WET_INK_SNAPSHOT_LIMITS.headerBytes + 1,
      }),
    ).toMatchObject({ ok: false, code: "budget-exceeded" });
  });
});
