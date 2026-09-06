import { describe, expect, it } from "vitest";

import {
  STUDIO_WILL_V1_PROFILE,
  STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL,
  STUDIO_WILL_V1_SPECIFICATION_URL,
  StudioWillV1InterchangeError,
  decodeStudioWillV1Path,
  decodeStudioWillV1PathList,
  encodeStudioWillV1Path,
  encodeStudioWillV1PathDetailed,
  encodeStudioWillV1PathList,
  encodeStudioWillV1PathListDetailed,
  type StudioWillV1PathInput,
} from "./studio-will-v1-interchange";

const MINIMAL_PATH = Object.freeze({
  points: Object.freeze([
    Object.freeze({ x: 1, y: 2 }),
    Object.freeze({ x: 1.25, y: 2.5 }),
    Object.freeze({ x: 0.75, y: 2 }),
    Object.freeze({ x: 0.75, y: 2 }),
  ]),
  strokeWidths: Object.freeze([1]),
  strokeColor: Object.freeze({ r: 0, g: 0, b: 0, a: 255 }),
  startParameter: 0,
  endParameter: 1,
  decimalPrecision: 2,
} satisfies StudioWillV1PathInput);

function bytes(hex: string): Uint8Array {
  const compact = hex.replaceAll(/\s/gu, "");
  if (compact.length % 2 !== 0) throw new Error("Invalid test hex.");
  return Uint8Array.from(
    compact.match(/.{2}/gu)?.map((pair) => Number.parseInt(pair, 16)) ?? [],
  );
}

function hex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function varint(value: number): number[] {
  const output: number[] = [];
  let remaining = value;
  do {
    const low = remaining % 128;
    remaining = Math.floor(remaining / 128);
    output.push(low | (remaining > 0 ? 0x80 : 0));
  } while (remaining > 0);
  return output;
}

function zigZag(value: number): number {
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function packed(field: number, values: readonly number[]): number[] {
  const payload = values.flatMap((value) => varint(zigZag(value)));
  return [(field << 3) | 2, ...varint(payload.length), ...payload];
}

function framed(message: Uint8Array): Uint8Array {
  return Uint8Array.from([...varint(message.byteLength), ...message]);
}

function expectCode(
  operation: () => unknown,
  code: StudioWillV1InterchangeError["code"],
): void {
  try {
    operation();
    throw new Error(`Expected ${code}.`);
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioWillV1InterchangeError);
    expect((cause as StudioWillV1InterchangeError).code).toBe(code);
  }
}

describe("WILL Data Format v1 clean-room Annex A codec", () => {
  it("publishes the exact public-spec and patent-license boundary without a vendor claim", () => {
    expect(STUDIO_WILL_V1_SPECIFICATION_URL).toContain(
      "WILL_Data_Format_Spec.pdf",
    );
    expect(STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL).toContain(
      "Public_Patent_License.pdf",
    );
    expect(STUDIO_WILL_V1_PROFILE).toBe(
      "will-data-format-v1.0/annex-a-protobuf/toonspectrum-clean-room-1",
    );
    expect(STUDIO_WILL_V1_PROFILE).not.toContain("annex-b");
  });

  it("emits deterministic field-order bytes with explicit proto2 scalar defaults", () => {
    const expected = bytes(`
      0d00000000
      150000803f
      1802
      220ac8019003326463630000
      2a02c801
      3205000000fe03
    `);
    const first = encodeStudioWillV1Path(MINIMAL_PATH);
    const second = encodeStudioWillV1Path({ ...MINIMAL_PATH });

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
    expect(hex(encodeStudioWillV1PathList([MINIMAL_PATH]))).toBe(
      `23${hex(expected)}`,
    );
    expect(encodeStudioWillV1PathDetailed(MINIMAL_PATH).loss).toMatchObject({
      status: "exact",
      quantization: "truncate-toward-zero",
      items: [],
    });
  });

  it("decodes the independently derived minimal public-profile vector", () => {
    const vector = bytes(
      "17220ac80190033264636300002a02c8013205000000fe03",
    );
    const decoded = decodeStudioWillV1PathList(vector);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toEqual({
      points: MINIMAL_PATH.points,
      strokeWidths: MINIMAL_PATH.strokeWidths,
      strokeColor: MINIMAL_PATH.strokeColor,
      startParameter: 0,
      endParameter: 1,
      decimalPrecision: 2,
      segmentCount: 1,
    });
  });

  it("round-trips multiple paths and declares every fixed-point/binary32 loss", () => {
    const quantized: StudioWillV1PathInput = {
      points: [
        { x: 0.0019, y: -0.0019 },
        { x: 1.2349, y: 2.3459 },
        { x: 3.4569, y: 4.5679 },
        { x: 5.6789, y: 6.7899 },
        { x: 7.8909, y: 8.9019 },
      ],
      strokeWidths: [0.129, 0.259],
      strokeColor: { r: 12, g: 34, b: 56, a: 200 },
      startParameter: 0.123456789,
      endParameter: 0.987654321,
      decimalPrecision: 2,
    };
    const encoded = encodeStudioWillV1PathListDetailed([
      MINIMAL_PATH,
      quantized,
    ]);
    const decoded = decodeStudioWillV1PathList(encoded.bytes);

    expect(encoded.paths).toHaveLength(2);
    expect(decoded).toEqual(encoded.paths);
    expect(encoded.loss.status).toBe("declared");
    expect(new Set(encoded.loss.items.map((item) => item.code))).toEqual(
      new Set([
        "START_PARAMETER_BINARY32_QUANTIZED",
        "END_PARAMETER_BINARY32_QUANTIZED",
        "POSITION_FIXED_POINT_QUANTIZED",
        "STROKE_WIDTH_FIXED_POINT_QUANTIZED",
      ]),
    );
    expect(decoded[1]?.segmentCount).toBe(2);
  });

  it("accepts split packed and unpacked repeated fields in encounter order", () => {
    const pointDeltas = [100, 200, 25, 50, -50, -50, 0, 0];
    const unpackedPoints = pointDeltas.flatMap((value) => [
      0x20,
      ...varint(zigZag(value)),
    ]);
    const unpackedWidths = [0x28, ...varint(zigZag(100))];
    const splitColor = [
      ...packed(6, [0, 0]),
      0x30,
      ...varint(zigZag(0)),
      0x30,
      ...varint(zigZag(255)),
    ];
    const message = Uint8Array.from([
      ...bytes("0d00000000150000803f1802"),
      ...unpackedPoints,
      ...unpackedWidths,
      ...splitColor,
    ]);

    expect(decodeStudioWillV1Path(message)).toEqual({
      points: MINIMAL_PATH.points,
      strokeWidths: MINIMAL_PATH.strokeWidths,
      strokeColor: MINIMAL_PATH.strokeColor,
      startParameter: 0,
      endParameter: 1,
      decimalPrecision: 2,
      segmentCount: 1,
    });
  });

  it("rejects malformed and non-canonical outer framing", () => {
    expectCode(
      () => decodeStudioWillV1PathList(Uint8Array.of()),
      "MODEL_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1PathList(bytes("80")),
      "VARINT_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1PathList(bytes("810000")),
      "VARINT_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1PathList(bytes("050d0000")),
      "PROTOBUF_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1PathList(bytes("00")),
      "MODEL_INVALID",
    );
  });

  it("rejects unsafe scalar, point, color, and wire representations", () => {
    expectCode(
      () => decodeStudioWillV1Path(bytes("0d0000c07f")),
      "MODEL_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1Path(bytes("18ffffffff0f")),
      "MODEL_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1Path(bytes("220100")),
      "MODEL_INVALID",
    );
    expectCode(
      () => decodeStudioWillV1Path(
        Uint8Array.from([
          ...encodeStudioWillV1Path(MINIMAL_PATH),
          0x38,
          0,
        ]),
      ),
      "PROTOBUF_INVALID",
    );
  });

  it("rejects signed-int32 cumulative delta overflow", () => {
    const message = Uint8Array.from([
      ...bytes("0d00000000150000803f1802"),
      ...packed(4, [0x7fff_ffff, 0, 1, 0, 0, 0, 0, 0]),
      ...packed(5, [100]),
      ...packed(6, [0, 0, 0, 255]),
    ]);
    expectCode(
      () => decodeStudioWillV1PathList(framed(message)),
      "DELTA_INVALID",
    );
  });

  it("enforces strict Catmull-Rom model and bounded resources", () => {
    expectCode(
      () => encodeStudioWillV1Path({
        ...MINIMAL_PATH,
        points: MINIMAL_PATH.points.slice(0, 3),
      }),
      "MODEL_INVALID",
    );
    expectCode(
      () => encodeStudioWillV1Path({
        ...MINIMAL_PATH,
        strokeWidths: [0],
      }),
      "MODEL_INVALID",
    );
    expectCode(
      () => encodeStudioWillV1Path({
        ...MINIMAL_PATH,
        strokeColor: { r: 0, g: 0, b: 0, a: 256 },
      }),
      "MODEL_INVALID",
    );
    expectCode(
      () => encodeStudioWillV1Path({
        ...MINIMAL_PATH,
        startParameter: 0.75,
        endParameter: 0.25,
      }),
      "MODEL_INVALID",
    );
    expectCode(
      () => encodeStudioWillV1PathList(
        [MINIMAL_PATH, MINIMAL_PATH],
        { limits: { maxPaths: 1 } },
      ),
      "RESOURCE_LIMIT",
    );
    expectCode(
      () => decodeStudioWillV1PathList(
        encodeStudioWillV1PathList([MINIMAL_PATH]),
        { limits: { maxStrokesBytes: 4 } },
      ),
      "RESOURCE_LIMIT",
    );
  });

  it("fails closed instead of silently accepting quantized zero widths", () => {
    expectCode(
      () => encodeStudioWillV1Path({
        ...MINIMAL_PATH,
        strokeWidths: [0.001],
        decimalPrecision: 2,
      }),
      "MODEL_INVALID",
    );
  });

  it("processes a large valid Path below the declared point limit without spread-argument crashes", () => {
    const points = Array.from(
      { length: 70_000 },
      () => ({ x: 1, y: 2 }),
    );
    const encoded = encodeStudioWillV1PathList([
      {
        points,
        strokeWidths: [1],
        strokeColor: { r: 0, g: 0, b: 0, a: 255 },
        decimalPrecision: 2,
      },
    ]);
    const decoded = decodeStudioWillV1PathList(encoded);

    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.points).toHaveLength(70_000);
    expect(decoded[0]?.segmentCount).toBe(69_997);
  });
});
