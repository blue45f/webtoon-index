import { describe, expect, it, vi } from "vitest";

import {
  buildStudioWillV1OpcBytes,
  importStudioWillV1Opc,
} from "./studio-will-v1-opc-interchange";
import {
  STUDIO_WILL_V1_OPC_PACKED_MAGIC,
  STUDIO_WILL_V1_OPC_PACKED_SCHEMA_VERSION,
  StudioWillV1OpcPackedError,
  inspectStudioWillV1OpcPacked,
  packStudioWillV1OpcBuildResult,
  packStudioWillV1OpcExportInput,
  packStudioWillV1OpcImportResult,
  unpackStudioWillV1OpcBuildResult,
  unpackStudioWillV1OpcExportInput,
  unpackStudioWillV1OpcImportResult,
  unpackStudioWillV1OpcImportResultWithMetrics,
} from "./studio-will-v1-opc-packed-codec";

const SAMPLE_INPUT = {
  width: 640,
  height: 480,
  title: "Packed 압력선",
  createdAt: "2026-07-30T00:00:00Z",
  application: "ToonSpectrum",
  applicationVersion: "2.0",
  paths: [
    {
      points: [
        { x: -1.25, y: 2.5 },
        { x: 1, y: 2 },
        { x: 3.5, y: 5.25 },
        { x: 8, y: 13 },
      ],
      strokeWidths: [0.5, 1, 1.5, 2],
      strokeColor: { r: 12, g: 34, b: 56, a: 210 },
      startParameter: 0.125,
      endParameter: 0.875,
      decimalPrecision: 3,
    },
  ],
};

function clonePacket(packet: Uint8Array): Uint8Array {
  return Uint8Array.from(packet);
}

describe("WILL v1 OPC packed transport codec", () => {
  it("roundtrips export input, build result, and import result without point objects on wire", async () => {
    const inputPacket = packStudioWillV1OpcExportInput(SAMPLE_INPUT);
    expect(inputPacket.byteOffset).toBe(0);
    expect(inputPacket.byteLength).toBe(inputPacket.buffer.byteLength);
    expect(new TextDecoder().decode(inputPacket.subarray(0, 8))).toBe(
      STUDIO_WILL_V1_OPC_PACKED_MAGIC,
    );
    expect(new DataView(inputPacket.buffer).getUint16(8, true)).toBe(
      STUDIO_WILL_V1_OPC_PACKED_SCHEMA_VERSION,
    );
    expect(inspectStudioWillV1OpcPacked(inputPacket, "export-input")).toMatchObject({
      kind: "export-input",
      pathCount: 1,
      totalPoints: 4,
      totalStrokeWidths: 4,
    });
    expect(unpackStudioWillV1OpcExportInput(inputPacket)).toEqual(SAMPLE_INPUT);

    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    const buildPacket = packStudioWillV1OpcBuildResult(built);
    const unpackedBuild = unpackStudioWillV1OpcBuildResult(
      built.bytes.slice(),
      buildPacket,
    );
    expect(unpackedBuild).toEqual(built);

    const imported = await importStudioWillV1Opc(built.bytes);
    const importPacket = packStudioWillV1OpcImportResult(imported);
    expect(unpackStudioWillV1OpcImportResult(importPacket)).toEqual(imported);
    expect(unpackStudioWillV1OpcImportResultWithMetrics(importPacket, {
      willLimits: { maxTotalPoints: 200_000 },
    })).toMatchObject({
      result: imported,
      metrics: {
        materializedPathObjects: 1,
        materializedPointObjects: 4,
        packedPointCount: 4,
        pointObjectBudget: 200_000,
      },
    });
  });

  it("fails closed on wrong magic, schema, endian, offsets, reserved bytes, and subviews", () => {
    const original = packStudioWillV1OpcExportInput(SAMPLE_INPUT);
    const mutations: Array<(packet: Uint8Array) => void> = [
      (packet) => {
        packet[0] = 0;
      },
      (packet) => {
        new DataView(packet.buffer).setUint16(8, 999, true);
      },
      (packet) => {
        new DataView(packet.buffer).setUint32(12, 0x0403_0201, true);
      },
      (packet) => {
        new DataView(packet.buffer).setUint32(44, 129, true);
      },
      (packet) => {
        packet[18] = 1;
      },
      (packet) => {
        packet[128 + 22] = 1;
      },
    ];
    for (const mutate of mutations) {
      const packet = clonePacket(original);
      mutate(packet);
      expect(() =>
        inspectStudioWillV1OpcPacked(packet, "export-input")
      ).toThrow(StudioWillV1OpcPackedError);
    }
    const oversizedBacking = new Uint8Array(original.byteLength + 2);
    oversizedBacking.set(original, 1);
    const subview = oversizedBacking.subarray(1, -1);
    expect(() =>
      inspectStudioWillV1OpcPacked(subview, "export-input")
    ).toThrow(/소유권/u);
    expect(() =>
      inspectStudioWillV1OpcPacked(original, "build-result")
    ).toThrow(/header/u);
  });

  it("rejects allocation overflow, non-finite geometry, and silent UTF-8 replacement", async () => {
    expect(() =>
      packStudioWillV1OpcExportInput(SAMPLE_INPUT, { maxPackedBytes: 200 })
    ).toThrowError(
      expect.objectContaining({ code: "RESOURCE_LIMIT" }),
    );
    expect(() =>
      packStudioWillV1OpcExportInput({
        ...SAMPLE_INPUT,
        paths: [{
          ...SAMPLE_INPUT.paths[0]!,
          points: [
            ...SAMPLE_INPUT.paths[0]!.points.slice(0, 3),
            { x: Number.NaN, y: 0 },
          ],
        }],
      })
    ).toThrowError(expect.objectContaining({ code: "MODEL_INVALID" }));
    expect(() =>
      packStudioWillV1OpcExportInput({
        ...SAMPLE_INPUT,
        title: "\ud800",
      })
    ).toThrow(/UTF-8/u);

    const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
    expect(() =>
      packStudioWillV1OpcBuildResult({
        ...built,
        loss: {
          ...built.loss,
          status: "declared",
          items: [{
            code: "POSITION_FIXED_POINT_QUANTIZED",
            pathIndex: 0,
            changedValues: 1,
            maximumAbsoluteError: 0.1,
            message: "\ud800",
          }],
        },
      })
    ).toThrow(/UTF-8/u);
  });

  it(
    "packs the bounded one-million-point maximum into one transferable buffer",
    () => {
      const sharedPoint = { x: 1.25, y: -2.5 };
      const paths = Array.from({ length: 10 }, (_, pathIndex) => ({
        points: new Array(100_000).fill(sharedPoint),
        strokeWidths: [pathIndex + 1],
        strokeColor: { r: pathIndex, g: 20, b: 30, a: 255 },
      }));
      const packet = packStudioWillV1OpcExportInput({
        width: 100,
        height: 100,
        paths,
      });
      const summary = inspectStudioWillV1OpcPacked(packet, "export-input");
      expect(summary).toMatchObject({
        pathCount: 10,
        totalPoints: 1_000_000,
        totalStrokeWidths: 10,
      });
      expect(packet.byteLength).toBeLessThan(17 * 1024 * 1024);
      expect(packet.byteOffset).toBe(0);
      expect(packet.buffer.byteLength).toBe(packet.byteLength);
    },
    30_000,
  );

  it(
    "rejects an over-budget import header before allocating any main-thread point array",
    async () => {
      const built = await buildStudioWillV1OpcBytes(SAMPLE_INPUT);
      const imported = await importStudioWillV1Opc(built.bytes);
      const sharedPoint = { x: 1, y: 2 };
      const path = (pointCount: number, color: number) => ({
        points: new Array(pointCount).fill(sharedPoint),
        strokeWidths: [1],
        strokeColor: { r: color, g: 0, b: 0, a: 255 },
        startParameter: 0,
        endParameter: 1,
        decimalPrecision: 2,
        segmentCount: pointCount - 3,
      });
      const packet = packStudioWillV1OpcImportResult({
        ...imported,
        paths: [
          path(100_000, 1),
          path(100_000, 2),
          path(4, 3),
        ],
      });
      const arrayFrom = vi.spyOn(Array, "from");
      try {
        expect(() => unpackStudioWillV1OpcImportResultWithMetrics(packet, {
          willLimits: { maxTotalPoints: 200_000 },
        })).toThrowError(expect.objectContaining({ code: "RESOURCE_LIMIT" }));
        const requestedPointSlots = (arrayFrom.mock.calls as unknown as [unknown][]).reduce(
          (total, [value]) => {
            if (
              value !== null
              && typeof value === "object"
              && "length" in value
              && typeof (value as { length: unknown }).length === "number"
            ) {
              return total + (value as { length: number }).length;
            }
            return total;
          },
          0,
        );
        expect(requestedPointSlots).toBe(0);
      } finally {
        arrayFrom.mockRestore();
      }
    },
    30_000,
  );
});
