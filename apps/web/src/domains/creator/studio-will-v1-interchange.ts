/**
 * Original clean-room implementation of the public Wacom WILL Data Format Specification v1.0.
 *
 * This module was written from the public specification and is offered for use under Wacom's
 * public patent license for that specification. It contains no Wacom SDK code. It is not a Wacom
 * SDK, WILL 3/UIM implementation, vendor certification, trademark license, or authorization to
 * use Wacom marks. License conditions and the specification's no-warranty terms still apply.
 *
 * This first checkpoint implements the Annex A Path protobuf profile and the Section 5.3.3
 * length-delimited Path sequence. Annex B OPC/ZIP document packaging is intentionally outside
 * this module until its independent container conformance suite is complete.
 *
 * The public document leaves a few Annex A details informal. This bounded profile makes those
 * choices explicit: fixed-point conversion truncates toward zero; X and Y deltas use independent
 * accumulators; widths and RGBA components each use their own sequential stream; deterministic
 * protobuf output emits fields 1–6 in ascending order, including explicit scalar defaults.
 */

export const STUDIO_WILL_V1_SPECIFICATION_URL =
  "https://cdn.wacom.com/u/marketplace/INK-SDK/will/170801_WILL_Data_Format_Spec.pdf" as const;
export const STUDIO_WILL_V1_PUBLIC_PATENT_LICENSE_URL =
  "https://cdn.wacom.com/u/marketplace/INK-SDK/will/170801_WILL_Data_Format_Spec_Public_Patent_License.pdf" as const;
export const STUDIO_WILL_V1_PATH_MEDIA_TYPE =
  "application/vnd.willfileformat.path+protobuf" as const;
export const STUDIO_WILL_V1_PROFILE =
  "will-data-format-v1.0/annex-a-protobuf/toonspectrum-clean-room-1" as const;

export const STUDIO_WILL_V1_LIMITS = Object.freeze({
  maxStrokesBytes: 32 * 1024 * 1024,
  maxPathMessageBytes: 4 * 1024 * 1024,
  maxPaths: 10_000,
  maxPointsPerPath: 100_000,
  maxTotalPoints: 1_000_000,
  maxDecimalPrecision: 6,
  maxCoordinateMagnitude: 1_000_000,
  maxStrokeWidth: 100_000,
});

export interface StudioWillV1Limits {
  readonly maxStrokesBytes: number;
  readonly maxPathMessageBytes: number;
  readonly maxPaths: number;
  readonly maxPointsPerPath: number;
  readonly maxTotalPoints: number;
  readonly maxDecimalPrecision: number;
  readonly maxCoordinateMagnitude: number;
  readonly maxStrokeWidth: number;
}

export interface StudioWillV1Point {
  readonly x: number;
  readonly y: number;
}

export interface StudioWillV1Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export interface StudioWillV1PathInput {
  /** Four or more Catmull-Rom control positions. N positions describe N - 3 segments. */
  readonly points: readonly StudioWillV1Point[];
  /** Positive widths. A final width is repeated when fewer widths than points are supplied. */
  readonly strokeWidths: readonly number[];
  /** This strict public-v1 profile represents one 8-bit RGBA color per Path. */
  readonly strokeColor: StudioWillV1Rgba;
  readonly startParameter?: number;
  readonly endParameter?: number;
  readonly decimalPrecision?: number;
}

export interface StudioWillV1Path {
  readonly points: readonly StudioWillV1Point[];
  readonly strokeWidths: readonly number[];
  readonly strokeColor: Readonly<StudioWillV1Rgba>;
  readonly startParameter: number;
  readonly endParameter: number;
  readonly decimalPrecision: number;
  readonly segmentCount: number;
}

export type StudioWillV1LossCode =
  | "END_PARAMETER_BINARY32_QUANTIZED"
  | "POSITION_FIXED_POINT_QUANTIZED"
  | "START_PARAMETER_BINARY32_QUANTIZED"
  | "STROKE_WIDTH_FIXED_POINT_QUANTIZED";

export interface StudioWillV1LossItem {
  readonly code: StudioWillV1LossCode;
  readonly pathIndex: number;
  readonly changedValues: number;
  readonly maximumAbsoluteError: number;
  readonly message: string;
}

export interface StudioWillV1LossReport {
  /** `exact` means the supplied model is exactly representable by this bounded v1 profile. */
  readonly status: "declared" | "exact";
  readonly quantization: "truncate-toward-zero";
  readonly items: readonly StudioWillV1LossItem[];
}

export interface StudioWillV1PathEncoding {
  readonly bytes: Uint8Array;
  readonly path: StudioWillV1Path;
  readonly loss: StudioWillV1LossReport;
}

export interface StudioWillV1PathListEncoding {
  readonly bytes: Uint8Array;
  readonly paths: readonly StudioWillV1Path[];
  readonly loss: StudioWillV1LossReport;
}

export interface StudioWillV1ExportOptions {
  readonly limits?: Partial<StudioWillV1Limits>;
}

export type StudioWillV1ImportOptions = StudioWillV1ExportOptions;

export type StudioWillV1ErrorCode =
  | "DELTA_INVALID"
  | "FIXED_POINT_OVERFLOW"
  | "LIMIT_INVALID"
  | "MODEL_INVALID"
  | "PROTOBUF_INVALID"
  | "RESOURCE_LIMIT"
  | "VARINT_INVALID"
  | "WIRE_TYPE_UNSUPPORTED";

const ERROR_MESSAGES: Readonly<Record<StudioWillV1ErrorCode, string>> = Object.freeze({
  DELTA_INVALID: "WILL v1 delta 스트림이 signed 32-bit 범위를 벗어났습니다.",
  FIXED_POINT_OVERFLOW: "WILL v1 고정소수점 값이 signed 32-bit 범위를 벗어났습니다.",
  LIMIT_INVALID: "WILL v1 처리 한도가 올바르지 않습니다.",
  MODEL_INVALID: "WILL v1 Path 모델 값이 올바르지 않습니다.",
  PROTOBUF_INVALID: "WILL v1 Annex A protobuf 바이트가 올바르지 않거나 잘렸습니다.",
  RESOURCE_LIMIT: "WILL v1 데이터가 안전 처리 한도를 넘었습니다.",
  VARINT_INVALID: "WILL v1 Base-128 varint가 올바르지 않거나 비정규 인코딩입니다.",
  WIRE_TYPE_UNSUPPORTED: "WILL v1 strict profile에서 허용하지 않는 protobuf wire type입니다.",
});

export class StudioWillV1InterchangeError extends Error {
  readonly code: StudioWillV1ErrorCode;
  readonly path?: string;

  constructor(
    code: StudioWillV1ErrorCode,
    options: { readonly cause?: unknown; readonly path?: string } = {}
  ) {
    super(ERROR_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StudioWillV1InterchangeError";
    this.code = code;
    if (options.path !== undefined) this.path = options.path;
  }
}

const INT32_MIN = -0x8000_0000;
const INT32_MAX = 0x7fff_ffff;
const UINT32_MAX = 0xffff_ffff;
const PATH_FIELD_START = 1;
const PATH_FIELD_END = 2;
const PATH_FIELD_PRECISION = 3;
const PATH_FIELD_POINTS = 4;
const PATH_FIELD_WIDTHS = 5;
const PATH_FIELD_COLOR = 6;
const WIRE_VARINT = 0;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

interface MutableLossSummary {
  items: StudioWillV1LossItem[];
}

interface ByteCursor {
  readonly bytes: Uint8Array;
  offset: number;
  readonly end: number;
}

interface ParsedVarint {
  readonly value: number;
  readonly bytes: number;
}

interface PreparedPath {
  readonly path: StudioWillV1Path;
  readonly fixedPoints: readonly number[];
  readonly fixedWidths: readonly number[];
  readonly color: readonly number[];
  readonly loss: StudioWillV1LossReport;
}

function fail(
  code: StudioWillV1ErrorCode,
  options?: { readonly cause?: unknown; readonly path?: string }
): never {
  throw new StudioWillV1InterchangeError(code, options);
}

function sourceBytes(source: Uint8Array | ArrayBuffer): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  return fail("PROTOBUF_INVALID");
}

function resolveIntegerLimit(
  supplied: number | undefined,
  hardMaximum: number
): number {
  if (supplied === undefined) return hardMaximum;
  if (!Number.isSafeInteger(supplied) || supplied < 0 || supplied > hardMaximum) {
    return fail("LIMIT_INVALID");
  }
  return supplied;
}

function resolveLimits(value?: Partial<StudioWillV1Limits>): StudioWillV1Limits {
  return {
    maxStrokesBytes: resolveIntegerLimit(
      value?.maxStrokesBytes,
      STUDIO_WILL_V1_LIMITS.maxStrokesBytes
    ),
    maxPathMessageBytes: resolveIntegerLimit(
      value?.maxPathMessageBytes,
      STUDIO_WILL_V1_LIMITS.maxPathMessageBytes
    ),
    maxPaths: resolveIntegerLimit(value?.maxPaths, STUDIO_WILL_V1_LIMITS.maxPaths),
    maxPointsPerPath: resolveIntegerLimit(
      value?.maxPointsPerPath,
      STUDIO_WILL_V1_LIMITS.maxPointsPerPath
    ),
    maxTotalPoints: resolveIntegerLimit(
      value?.maxTotalPoints,
      STUDIO_WILL_V1_LIMITS.maxTotalPoints
    ),
    maxDecimalPrecision: resolveIntegerLimit(
      value?.maxDecimalPrecision,
      STUDIO_WILL_V1_LIMITS.maxDecimalPrecision
    ),
    maxCoordinateMagnitude: resolveIntegerLimit(
      value?.maxCoordinateMagnitude,
      STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude
    ),
    maxStrokeWidth: resolveIntegerLimit(
      value?.maxStrokeWidth,
      STUDIO_WILL_V1_LIMITS.maxStrokeWidth
    ),
  };
}

function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

function assertFiniteRange(
  value: unknown,
  minimum: number,
  maximum: number
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail("MODEL_INVALID");
  }
}

function freezePath(
  points: readonly StudioWillV1Point[],
  widths: readonly number[],
  color: StudioWillV1Rgba,
  startParameter: number,
  endParameter: number,
  decimalPrecision: number
): StudioWillV1Path {
  const frozenPoints = Object.freeze(
    points.map((point) => Object.freeze({ x: point.x, y: point.y }))
  );
  return Object.freeze({
    points: frozenPoints,
    strokeWidths: Object.freeze([...widths]),
    strokeColor: Object.freeze({ r: color.r, g: color.g, b: color.b, a: color.a }),
    startParameter,
    endParameter,
    decimalPrecision,
    segmentCount: frozenPoints.length - 3,
  });
}

function noteLoss(
  summary: MutableLossSummary,
  code: StudioWillV1LossCode,
  pathIndex: number,
  changedValues: number,
  maximumAbsoluteError: number,
  message: string
): void {
  if (changedValues === 0) return;
  summary.items.push(
    Object.freeze({
      code,
      pathIndex,
      changedValues,
      maximumAbsoluteError,
      message,
    })
  );
}

function finishLoss(items: readonly StudioWillV1LossItem[]): StudioWillV1LossReport {
  return Object.freeze({
    status: items.length === 0 ? "exact" : "declared",
    quantization: "truncate-toward-zero",
    items: Object.freeze([...items]),
  });
}

function float32(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  return view.getFloat32(0, true);
}

function fixedPoint(
  value: number,
  scale: number
): { readonly integer: number; readonly decoded: number } {
  const scaled = value * scale;
  const nearestInteger = Math.round(scaled);
  const representationTolerance =
    Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  // Values reconstructed from an existing fixed-point integer must remain stable when a binary64
  // multiplication lands infinitesimally below that integer (for example 2.34 * 100). Outside
  // representation noise, the public profile's declared rule remains truncation toward zero.
  const truncated =
    Math.abs(scaled - nearestInteger) <= representationTolerance
      ? nearestInteger
      : Math.trunc(scaled);
  const integer = Object.is(truncated, -0) ? 0 : truncated;
  if (!isInt32(integer)) fail("FIXED_POINT_OVERFLOW");
  return { integer, decoded: integer / scale };
}

function preparePath(
  input: StudioWillV1PathInput,
  pathIndex: number,
  limits: StudioWillV1Limits
): PreparedPath {
  if (typeof input !== "object" || input === null) fail("MODEL_INVALID");
  if (!Array.isArray(input.points) || input.points.length < 4) fail("MODEL_INVALID");
  if (input.points.length > limits.maxPointsPerPath) fail("RESOURCE_LIMIT");
  if (
    !Array.isArray(input.strokeWidths) ||
    input.strokeWidths.length < 1 ||
    input.strokeWidths.length > input.points.length
  ) {
    fail("MODEL_INVALID");
  }
  const decimalPrecision = input.decimalPrecision ?? 2;
  if (
    !Number.isSafeInteger(decimalPrecision) ||
    decimalPrecision < 0 ||
    decimalPrecision > limits.maxDecimalPrecision
  ) {
    fail("MODEL_INVALID");
  }
  const startInput = input.startParameter ?? 0;
  const endInput = input.endParameter ?? 1;
  assertFiniteRange(startInput, 0, 1);
  assertFiniteRange(endInput, 0, 1);
  if (input.points.length === 4 && startInput > endInput) fail("MODEL_INVALID");
  const startParameter = float32(startInput);
  const endParameter = float32(endInput);
  const scale = 10 ** decimalPrecision;
  const loss: MutableLossSummary = { items: [] };
  noteLoss(
    loss,
    "START_PARAMETER_BINARY32_QUANTIZED",
    pathIndex,
    Object.is(startInput, startParameter) ? 0 : 1,
    Math.abs(startInput - startParameter),
    "startParameter가 Annex A binary32로 양자화되었습니다."
  );
  noteLoss(
    loss,
    "END_PARAMETER_BINARY32_QUANTIZED",
    pathIndex,
    Object.is(endInput, endParameter) ? 0 : 1,
    Math.abs(endInput - endParameter),
    "endParameter가 Annex A binary32로 양자화되었습니다."
  );

  const points: StudioWillV1Point[] = [];
  const fixedPoints: number[] = [];
  let changedPoints = 0;
  let maximumPointError = 0;
  for (const point of input.points) {
    if (typeof point !== "object" || point === null) fail("MODEL_INVALID");
    assertFiniteRange(point.x, -limits.maxCoordinateMagnitude, limits.maxCoordinateMagnitude);
    assertFiniteRange(point.y, -limits.maxCoordinateMagnitude, limits.maxCoordinateMagnitude);
    const x = fixedPoint(point.x, scale);
    const y = fixedPoint(point.y, scale);
    fixedPoints.push(x.integer, y.integer);
    points.push({ x: x.decoded, y: y.decoded });
    for (const [before, after] of [
      [point.x, x.decoded],
      [point.y, y.decoded],
    ] as const) {
      const error = Math.abs(before - after);
      if (!Object.is(before, after)) changedPoints += 1;
      maximumPointError = Math.max(maximumPointError, error);
    }
  }
  noteLoss(
    loss,
    "POSITION_FIXED_POINT_QUANTIZED",
    pathIndex,
    changedPoints,
    maximumPointError,
    `Position이 소수점 ${decimalPrecision}자리 고정소수점으로 양자화되었습니다.`
  );

  const widths: number[] = [];
  const fixedWidths: number[] = [];
  let changedWidths = 0;
  let maximumWidthError = 0;
  for (const width of input.strokeWidths) {
    assertFiniteRange(width, Number.MIN_VALUE, limits.maxStrokeWidth);
    const fixed = fixedPoint(width, scale);
    if (fixed.integer <= 0) fail("MODEL_INVALID");
    fixedWidths.push(fixed.integer);
    widths.push(fixed.decoded);
    const error = Math.abs(width - fixed.decoded);
    if (!Object.is(width, fixed.decoded)) changedWidths += 1;
    maximumWidthError = Math.max(maximumWidthError, error);
  }
  noteLoss(
    loss,
    "STROKE_WIDTH_FIXED_POINT_QUANTIZED",
    pathIndex,
    changedWidths,
    maximumWidthError,
    `Stroke Width가 소수점 ${decimalPrecision}자리 고정소수점으로 양자화되었습니다.`
  );

  const colorInput = input.strokeColor;
  if (typeof colorInput !== "object" || colorInput === null) fail("MODEL_INVALID");
  const color = [colorInput.r, colorInput.g, colorInput.b, colorInput.a];
  for (const channel of color) {
    if (!Number.isInteger(channel) || channel < 0 || channel > 255) fail("MODEL_INVALID");
  }
  const frozenPath = freezePath(
    points,
    widths,
    { r: color[0], g: color[1], b: color[2], a: color[3] },
    startParameter,
    endParameter,
    decimalPrecision
  );
  return {
    path: frozenPath,
    fixedPoints,
    fixedWidths,
    color,
    loss: finishLoss(loss.items),
  };
}

function varintBytes(value: number): number[] {
  if (!Number.isSafeInteger(value) || value < 0 || value > UINT32_MAX) {
    fail("VARINT_INVALID");
  }
  const output: number[] = [];
  let remaining = value;
  do {
    const low = remaining % 128;
    remaining = Math.floor(remaining / 128);
    output.push(low | (remaining > 0 ? 0x80 : 0));
  } while (remaining > 0);
  return output;
}

function zigZagEncode(value: number): number {
  if (!isInt32(value)) fail("DELTA_INVALID");
  return value >= 0 ? value * 2 : -value * 2 - 1;
}

function zigZagDecode(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    fail("PROTOBUF_INVALID");
  }
  return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
}

function deltaEncodeScalar(values: readonly number[]): number[] {
  const output: number[] = [];
  let previous = 0;
  for (const value of values) {
    const delta = value - previous;
    if (!isInt32(delta)) fail("DELTA_INVALID");
    output.push(delta);
    previous = value;
  }
  return output;
}

function deltaEncodePoints(values: readonly number[]): number[] {
  const output: number[] = [];
  let previousX = 0;
  let previousY = 0;
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x === undefined || y === undefined) fail("MODEL_INVALID");
    const deltaX = x - previousX;
    const deltaY = y - previousY;
    if (!isInt32(deltaX) || !isInt32(deltaY)) fail("DELTA_INVALID");
    output.push(deltaX, deltaY);
    previousX = x;
    previousY = y;
  }
  return output;
}

function appendNumbers(
  target: number[],
  source: Iterable<number>,
): void {
  for (const value of source) target.push(value);
}

function encodePacked(field: number, values: readonly number[]): number[] {
  const payload: number[] = [];
  for (const value of values) {
    appendNumbers(payload, varintBytes(zigZagEncode(value)));
  }
  const output: number[] = [];
  appendNumbers(
    output,
    varintBytes((field << 3) | WIRE_LENGTH_DELIMITED),
  );
  appendNumbers(output, varintBytes(payload.length));
  appendNumbers(output, payload);
  return output;
}

function encodePreparedPath(prepared: PreparedPath): Uint8Array {
  const output: number[] = [];
  const writeFloat = (field: number, value: number): void => {
    output.push((field << 3) | WIRE_FIXED32);
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setFloat32(0, value, true);
    output.push(...bytes);
  };
  writeFloat(PATH_FIELD_START, prepared.path.startParameter);
  writeFloat(PATH_FIELD_END, prepared.path.endParameter);
  output.push((PATH_FIELD_PRECISION << 3) | WIRE_VARINT);
  appendNumbers(output, varintBytes(prepared.path.decimalPrecision));
  appendNumbers(
    output,
    encodePacked(PATH_FIELD_POINTS, deltaEncodePoints(prepared.fixedPoints)),
  );
  appendNumbers(
    output,
    encodePacked(PATH_FIELD_WIDTHS, deltaEncodeScalar(prepared.fixedWidths)),
  );
  appendNumbers(
    output,
    encodePacked(PATH_FIELD_COLOR, deltaEncodeScalar(prepared.color)),
  );
  return Uint8Array.from(output);
}

/**
 * Encodes one deterministic Annex A Path message (without the outer Path-list length prefix).
 */
export function encodeStudioWillV1Path(
  input: StudioWillV1PathInput,
  options: Pick<StudioWillV1ExportOptions, "limits"> = {}
): Uint8Array {
  return encodeStudioWillV1PathDetailed(input, options).bytes;
}

export function encodeStudioWillV1PathDetailed(
  input: StudioWillV1PathInput,
  options: Pick<StudioWillV1ExportOptions, "limits"> = {}
): StudioWillV1PathEncoding {
  const limits = resolveLimits(options.limits);
  const prepared = preparePath(input, 0, limits);
  const bytes = encodePreparedPath(prepared);
  if (bytes.byteLength > limits.maxPathMessageBytes) fail("RESOURCE_LIMIT");
  return Object.freeze({ bytes, path: prepared.path, loss: prepared.loss });
}

function readVarint(cursor: ByteCursor): ParsedVarint {
  const start = cursor.offset;
  let value = 0;
  let multiplier = 1;
  for (let index = 0; index < 5; index += 1) {
    if (cursor.offset >= cursor.end) fail("VARINT_INVALID");
    const byte = cursor.bytes[cursor.offset];
    cursor.offset += 1;
    if (byte === undefined) fail("VARINT_INVALID");
    if (index === 4 && (byte & 0xf0) !== 0) fail("VARINT_INVALID");
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      const used = cursor.offset - start;
      if (used > 1 && value < 2 ** (7 * (used - 1))) fail("VARINT_INVALID");
      return { value, bytes: used };
    }
    multiplier *= 128;
  }
  return fail("VARINT_INVALID");
}

function readFixed32Float(cursor: ByteCursor): number {
  if (cursor.offset + 4 > cursor.end) fail("PROTOBUF_INVALID");
  const value = new DataView(
    cursor.bytes.buffer,
    cursor.bytes.byteOffset + cursor.offset,
    4
  ).getFloat32(0, true);
  cursor.offset += 4;
  if (!Number.isFinite(value)) fail("MODEL_INVALID");
  return value;
}

function readPackedSint32(
  cursor: ByteCursor,
  maximumValues: number
): number[] {
  const length = readVarint(cursor).value;
  if (length > cursor.end - cursor.offset) fail("PROTOBUF_INVALID");
  const end = cursor.offset + length;
  const packedCursor: ByteCursor = { bytes: cursor.bytes, offset: cursor.offset, end };
  const output: number[] = [];
  while (packedCursor.offset < end) {
    if (output.length >= maximumValues) fail("RESOURCE_LIMIT");
    output.push(zigZagDecode(readVarint(packedCursor).value));
  }
  cursor.offset = end;
  return output;
}

function appendUnpackedSint32(
  output: number[],
  cursor: ByteCursor,
  maximumValues: number
): void {
  if (output.length >= maximumValues) fail("RESOURCE_LIMIT");
  output.push(zigZagDecode(readVarint(cursor).value));
}

function deltaDecodeScalar(values: readonly number[]): number[] {
  const output: number[] = [];
  let previous = 0;
  for (const delta of values) {
    const value = previous + delta;
    if (!isInt32(value)) fail("DELTA_INVALID");
    output.push(value);
    previous = value;
  }
  return output;
}

function deltaDecodePoints(values: readonly number[]): number[] {
  if (values.length % 2 !== 0) fail("MODEL_INVALID");
  const output: number[] = [];
  let previousX = 0;
  let previousY = 0;
  for (let index = 0; index < values.length; index += 2) {
    const deltaX = values[index];
    const deltaY = values[index + 1];
    if (deltaX === undefined || deltaY === undefined) fail("MODEL_INVALID");
    const x = previousX + deltaX;
    const y = previousY + deltaY;
    if (!isInt32(x) || !isInt32(y)) fail("DELTA_INVALID");
    output.push(x, y);
    previousX = x;
    previousY = y;
  }
  return output;
}

function parsePathMessage(
  bytes: Uint8Array,
  limits: StudioWillV1Limits
): StudioWillV1Path {
  if (bytes.byteLength > limits.maxPathMessageBytes) fail("RESOURCE_LIMIT");
  const cursor: ByteCursor = { bytes, offset: 0, end: bytes.byteLength };
  let startParameter = 0;
  let endParameter = 1;
  let decimalPrecision = 2;
  let seenStart = false;
  let seenEnd = false;
  let seenPrecision = false;
  const pointDeltas: number[] = [];
  const widthDeltas: number[] = [];
  const colorDeltas: number[] = [];

  while (cursor.offset < cursor.end) {
    const tag = readVarint(cursor).value;
    const field = Math.floor(tag / 8);
    const wireType = tag & 7;
    if (field < PATH_FIELD_START || field > PATH_FIELD_COLOR) {
      fail("PROTOBUF_INVALID");
    }
    if (field === PATH_FIELD_START || field === PATH_FIELD_END) {
      if (wireType !== WIRE_FIXED32) fail("WIRE_TYPE_UNSUPPORTED");
      const value = readFixed32Float(cursor);
      if (field === PATH_FIELD_START) {
        startParameter = value;
        seenStart = true;
      } else {
        endParameter = value;
        seenEnd = true;
      }
      continue;
    }
    if (field === PATH_FIELD_PRECISION) {
      if (wireType !== WIRE_VARINT) fail("WIRE_TYPE_UNSUPPORTED");
      decimalPrecision = readVarint(cursor).value;
      seenPrecision = true;
      continue;
    }
    const output =
      field === PATH_FIELD_POINTS
        ? pointDeltas
        : field === PATH_FIELD_WIDTHS
          ? widthDeltas
          : colorDeltas;
    const maximum =
      field === PATH_FIELD_POINTS
        ? limits.maxPointsPerPath * 2
        : field === PATH_FIELD_WIDTHS
          ? limits.maxPointsPerPath
          : 4;
    if (wireType === WIRE_LENGTH_DELIMITED) {
      appendNumbers(
        output,
        readPackedSint32(cursor, maximum - output.length),
      );
    } else if (wireType === WIRE_VARINT) {
      appendUnpackedSint32(output, cursor, maximum);
    } else {
      fail("WIRE_TYPE_UNSUPPORTED");
    }
  }
  // Read variables intentionally track protobuf's proto2 last-value-wins scalar behavior.
  void seenStart;
  void seenEnd;
  void seenPrecision;

  if (
    !Number.isSafeInteger(decimalPrecision) ||
    decimalPrecision < 0 ||
    decimalPrecision > limits.maxDecimalPrecision
  ) {
    fail("MODEL_INVALID");
  }
  assertFiniteRange(startParameter, 0, 1);
  assertFiniteRange(endParameter, 0, 1);
  const fixedPoints = deltaDecodePoints(pointDeltas);
  if (fixedPoints.length < 8) fail("MODEL_INVALID");
  const pointCount = fixedPoints.length / 2;
  if (pointCount > limits.maxPointsPerPath) fail("RESOURCE_LIMIT");
  if (pointCount === 4 && startParameter > endParameter) fail("MODEL_INVALID");
  const fixedWidths = deltaDecodeScalar(widthDeltas);
  if (fixedWidths.length < 1 || fixedWidths.length > pointCount) fail("MODEL_INVALID");
  const color = deltaDecodeScalar(colorDeltas);
  if (color.length !== 4 || color.some((channel) => channel < 0 || channel > 255)) {
    fail("MODEL_INVALID");
  }
  const scale = 10 ** decimalPrecision;
  const points: StudioWillV1Point[] = [];
  for (let index = 0; index < fixedPoints.length; index += 2) {
    const x = fixedPoints[index];
    const y = fixedPoints[index + 1];
    if (x === undefined || y === undefined) fail("MODEL_INVALID");
    const decodedX = x / scale;
    const decodedY = y / scale;
    assertFiniteRange(
      decodedX,
      -limits.maxCoordinateMagnitude,
      limits.maxCoordinateMagnitude
    );
    assertFiniteRange(
      decodedY,
      -limits.maxCoordinateMagnitude,
      limits.maxCoordinateMagnitude
    );
    points.push({ x: decodedX, y: decodedY });
  }
  const widths = fixedWidths.map((width) => {
    const decoded = width / scale;
    assertFiniteRange(decoded, Number.MIN_VALUE, limits.maxStrokeWidth);
    return decoded;
  });
  return freezePath(
    points,
    widths,
    { r: color[0]!, g: color[1]!, b: color[2]!, a: color[3]! },
    startParameter,
    endParameter,
    decimalPrecision
  );
}

/** Decodes one Annex A Path message (without an outer Path-list length prefix). */
export function decodeStudioWillV1Path(
  source: Uint8Array | ArrayBuffer,
  options: Pick<StudioWillV1ImportOptions, "limits"> = {}
): StudioWillV1Path {
  return parsePathMessage(sourceBytes(source), resolveLimits(options.limits));
}

export function encodeStudioWillV1PathListDetailed(
  inputs: readonly StudioWillV1PathInput[],
  options: Pick<StudioWillV1ExportOptions, "limits"> = {}
): StudioWillV1PathListEncoding {
  const limits = resolveLimits(options.limits);
  if (!Array.isArray(inputs) || inputs.length < 1) fail("MODEL_INVALID");
  if (inputs.length > limits.maxPaths) fail("RESOURCE_LIMIT");
  const output: number[] = [];
  const paths: StudioWillV1Path[] = [];
  const losses: StudioWillV1LossItem[] = [];
  let totalPoints = 0;
  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index];
    if (input === undefined) fail("MODEL_INVALID");
    const prepared = preparePath(input, index, limits);
    totalPoints += prepared.path.points.length;
    if (totalPoints > limits.maxTotalPoints) fail("RESOURCE_LIMIT");
    const message = encodePreparedPath(prepared);
    if (message.byteLength > limits.maxPathMessageBytes) fail("RESOURCE_LIMIT");
    appendNumbers(output, varintBytes(message.byteLength));
    appendNumbers(output, message);
    if (output.length > limits.maxStrokesBytes) fail("RESOURCE_LIMIT");
    paths.push(prepared.path);
    losses.push(...prepared.loss.items);
  }
  return Object.freeze({
    bytes: Uint8Array.from(output),
    paths: Object.freeze(paths),
    loss: finishLoss(losses),
  });
}

/** Encodes the Section 5.3.3 sequence of Base-128-length-delimited Path messages. */
export function encodeStudioWillV1PathList(
  inputs: readonly StudioWillV1PathInput[],
  options: Pick<StudioWillV1ExportOptions, "limits"> = {}
): Uint8Array {
  return encodeStudioWillV1PathListDetailed(inputs, options).bytes;
}

/** Decodes the Section 5.3.3 Path sequence until exact EOF. */
export function decodeStudioWillV1PathList(
  source: Uint8Array | ArrayBuffer,
  options: Pick<StudioWillV1ImportOptions, "limits"> = {}
): readonly StudioWillV1Path[] {
  const limits = resolveLimits(options.limits);
  const bytes = sourceBytes(source);
  if (bytes.byteLength < 1) fail("MODEL_INVALID");
  if (bytes.byteLength > limits.maxStrokesBytes) fail("RESOURCE_LIMIT");
  const cursor: ByteCursor = { bytes, offset: 0, end: bytes.byteLength };
  const paths: StudioWillV1Path[] = [];
  let totalPoints = 0;
  while (cursor.offset < cursor.end) {
    if (paths.length >= limits.maxPaths) fail("RESOURCE_LIMIT");
    const length = readVarint(cursor).value;
    if (length < 1) fail("MODEL_INVALID");
    if (length > limits.maxPathMessageBytes) fail("RESOURCE_LIMIT");
    if (length > cursor.end - cursor.offset) fail("PROTOBUF_INVALID");
    const message = bytes.subarray(cursor.offset, cursor.offset + length);
    cursor.offset += length;
    const path = parsePathMessage(message, limits);
    totalPoints += path.points.length;
    if (totalPoints > limits.maxTotalPoints) fail("RESOURCE_LIMIT");
    paths.push(path);
  }
  return Object.freeze(paths);
}
