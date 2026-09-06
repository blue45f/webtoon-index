import {
  STUDIO_WILL_V1_LIMITS,
  type StudioWillV1Limits,
  type StudioWillV1LossCode,
  type StudioWillV1LossItem,
  type StudioWillV1LossReport,
  type StudioWillV1Path,
  type StudioWillV1PathInput,
} from "./studio-will-v1-interchange";
import {
  STUDIO_WILL_V1_OPC_ASSURANCE,
  STUDIO_WILL_V1_OPC_LIMITS,
  type StudioWillV1OpcBuildResult,
  type StudioWillV1OpcExportInput,
  type StudioWillV1OpcImportResult,
  type StudioWillV1OpcLimits,
} from "./studio-will-v1-opc-interchange";

/**
 * Binary Worker transport. This is deliberately not a persisted file format: it is a bounded,
 * versioned wire envelope that prevents structured-cloning one object per point.
 */
export const STUDIO_WILL_V1_OPC_PACKED_MAGIC = "TSWOPC2\u0000" as const;
export const STUDIO_WILL_V1_OPC_PACKED_SCHEMA_VERSION = 2 as const;
export const STUDIO_WILL_V1_OPC_PACKED_MAX_BYTES = 64 * 1024 * 1024;

const HEADER_BYTES = 128;
const PATH_RECORD_BYTES = 48;
const LOSS_RECORD_BYTES = 32;
const ENDIAN_MARKER = 0x0102_0304;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

const enum PacketKindCode {
  ExportInput = 1,
  BuildResult = 2,
  ImportResult = 3,
}

export type StudioWillV1OpcPackedKind =
  | "build-result"
  | "export-input"
  | "import-result";

export type StudioWillV1OpcPackedErrorCode =
  | "INVALID_PACKET"
  | "MODEL_INVALID"
  | "RESOURCE_LIMIT";

export class StudioWillV1OpcPackedError extends Error {
  readonly code: StudioWillV1OpcPackedErrorCode;

  constructor(code: StudioWillV1OpcPackedErrorCode, message: string) {
    super(message);
    this.name = "StudioWillV1OpcPackedError";
    this.code = code;
  }
}

export interface StudioWillV1OpcPackedOptions {
  readonly limits?: Partial<StudioWillV1OpcLimits>;
  readonly willLimits?: Partial<StudioWillV1Limits>;
  readonly maxPackedBytes?: number;
}

export interface StudioWillV1OpcPackedSummary {
  readonly byteLength: number;
  readonly kind: StudioWillV1OpcPackedKind;
  readonly lossCount: number;
  readonly pathCount: number;
  readonly totalPoints: number;
  readonly totalStrokeWidths: number;
}

/**
 * Main-thread object-graph receipt for packed import decoding.
 *
 * `readLayout` validates `packedPointCount <= pointObjectBudget` before `decodePaths` is entered,
 * so a successful receipt is also proof that the decoder never materialized an over-budget
 * `{ x, y }` graph. Generic codec callers keep the public one-million-point default; Studio UI
 * import supplies its tighter admission budget.
 */
export interface StudioWillV1OpcImportMaterializationMetrics {
  readonly materializedPathObjects: number;
  readonly materializedPointObjects: number;
  readonly packedPointCount: number;
  readonly pointObjectBudget: number;
}

export interface StudioWillV1OpcImportWithMetrics {
  readonly result: StudioWillV1OpcImportResult;
  readonly metrics: StudioWillV1OpcImportMaterializationMetrics;
}

interface ResolvedPackedLimits {
  readonly maxDimension: number;
  readonly maxMetadataCharacters: number;
  readonly maxPackedBytes: number;
  readonly maxPaths: number;
  readonly maxPointsPerPath: number;
  readonly maxTotalPoints: number;
  readonly maxDecimalPrecision: number;
  readonly maxCoordinateMagnitude: number;
  readonly maxStrokeWidth: number;
}

interface EncodedMetadata {
  readonly block: Uint8Array;
  readonly values: readonly (string | undefined)[];
}

interface PacketLayout {
  readonly byteLength: number;
  readonly kind: PacketKindCode;
  readonly flags: number;
  readonly pathCount: number;
  readonly totalPoints: number;
  readonly totalWidths: number;
  readonly lossCount: number;
  readonly pathTableOffset: number;
  readonly pointsOffset: number;
  readonly widthsOffset: number;
  readonly metadataOffset: number;
  readonly metadataBytes: number;
  readonly lossTableOffset: number;
  readonly lossTextOffset: number;
  readonly lossTextBytes: number;
  readonly width: number;
  readonly height: number;
}

interface PackModel {
  readonly kind: PacketKindCode;
  readonly width: number;
  readonly height: number;
  readonly metadata: readonly (string | undefined)[];
  readonly paths: readonly (StudioWillV1PathInput | StudioWillV1Path)[];
  readonly loss?: StudioWillV1LossReport;
}

const LOSS_CODES: readonly StudioWillV1LossCode[] = [
  "END_PARAMETER_BINARY32_QUANTIZED",
  "POSITION_FIXED_POINT_QUANTIZED",
  "START_PARAMETER_BINARY32_QUANTIZED",
  "STROKE_WIDTH_FIXED_POINT_QUANTIZED",
];

function fail(
  code: StudioWillV1OpcPackedErrorCode,
  message: string,
): never {
  throw new StudioWillV1OpcPackedError(code, message);
}

function kindName(kind: PacketKindCode): StudioWillV1OpcPackedKind {
  if (kind === PacketKindCode.ExportInput) return "export-input";
  if (kind === PacketKindCode.BuildResult) return "build-result";
  if (kind === PacketKindCode.ImportResult) return "import-result";
  return fail("INVALID_PACKET", "WILL v1 OPC packed kind가 올바르지 않습니다.");
}

function kindCode(kind: StudioWillV1OpcPackedKind): PacketKindCode {
  if (kind === "export-input") return PacketKindCode.ExportInput;
  if (kind === "build-result") return PacketKindCode.BuildResult;
  return PacketKindCode.ImportResult;
}

function resolvedLimit(
  supplied: number | undefined,
  fallback: number,
): number {
  return supplied ?? fallback;
}

function resolveLimits(options: StudioWillV1OpcPackedOptions = {}): ResolvedPackedLimits {
  const limits: ResolvedPackedLimits = {
    maxDimension: resolvedLimit(
      options.limits?.maxDimension,
      STUDIO_WILL_V1_OPC_LIMITS.maxDimension,
    ),
    maxMetadataCharacters: resolvedLimit(
      options.limits?.maxMetadataCharacters,
      STUDIO_WILL_V1_OPC_LIMITS.maxMetadataCharacters,
    ),
    maxPackedBytes: resolvedLimit(
      options.maxPackedBytes,
      STUDIO_WILL_V1_OPC_PACKED_MAX_BYTES,
    ),
    maxPaths: resolvedLimit(
      options.willLimits?.maxPaths,
      STUDIO_WILL_V1_LIMITS.maxPaths,
    ),
    maxPointsPerPath: resolvedLimit(
      options.willLimits?.maxPointsPerPath,
      STUDIO_WILL_V1_LIMITS.maxPointsPerPath,
    ),
    maxTotalPoints: resolvedLimit(
      options.willLimits?.maxTotalPoints,
      STUDIO_WILL_V1_LIMITS.maxTotalPoints,
    ),
    maxDecimalPrecision: resolvedLimit(
      options.willLimits?.maxDecimalPrecision,
      STUDIO_WILL_V1_LIMITS.maxDecimalPrecision,
    ),
    maxCoordinateMagnitude: resolvedLimit(
      options.willLimits?.maxCoordinateMagnitude,
      STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude,
    ),
    maxStrokeWidth: resolvedLimit(
      options.willLimits?.maxStrokeWidth,
      STUDIO_WILL_V1_LIMITS.maxStrokeWidth,
    ),
  };
  const entries = Object.entries(limits);
  if (
    entries.some(([, value]) => !Number.isSafeInteger(value) || value < 0)
    || limits.maxDimension > STUDIO_WILL_V1_OPC_LIMITS.maxDimension
    || limits.maxMetadataCharacters > STUDIO_WILL_V1_OPC_LIMITS.maxMetadataCharacters
    || limits.maxPackedBytes > STUDIO_WILL_V1_OPC_PACKED_MAX_BYTES
    || limits.maxPaths > STUDIO_WILL_V1_LIMITS.maxPaths
    || limits.maxPointsPerPath > STUDIO_WILL_V1_LIMITS.maxPointsPerPath
    || limits.maxTotalPoints > STUDIO_WILL_V1_LIMITS.maxTotalPoints
    || limits.maxDecimalPrecision > STUDIO_WILL_V1_LIMITS.maxDecimalPrecision
    || limits.maxCoordinateMagnitude > STUDIO_WILL_V1_LIMITS.maxCoordinateMagnitude
    || limits.maxStrokeWidth > STUDIO_WILL_V1_LIMITS.maxStrokeWidth
  ) {
    return fail("RESOURCE_LIMIT", "WILL v1 OPC packed 처리 한도가 올바르지 않습니다.");
  }
  return limits;
}

function safeAdd(left: number, right: number, maximum: number): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value > maximum) {
    return fail("RESOURCE_LIMIT", "WILL v1 OPC packed 바이트 예산을 넘었습니다.");
  }
  return value;
}

function safeMultiply(left: number, right: number, maximum: number): number {
  if (
    !Number.isSafeInteger(left)
    || !Number.isSafeInteger(right)
    || left < 0
    || right < 0
    || (left !== 0 && right > Math.floor(maximum / left))
  ) {
    return fail("RESOURCE_LIMIT", "WILL v1 OPC packed 바이트 예산을 넘었습니다.");
  }
  return left * right;
}

function finiteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum
  );
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function encodeMetadata(
  values: readonly (string | undefined)[],
  required: boolean,
  limits: ResolvedPackedLimits,
): EncodedMetadata {
  if (values.length !== 4) {
    return fail("MODEL_INVALID", "WILL v1 OPC packed metadata 수가 올바르지 않습니다.");
  }
  const encoded: (Uint8Array | undefined)[] = [];
  let byteLength = 16;
  for (const value of values) {
    if (value === undefined) {
      if (required) {
        return fail("MODEL_INVALID", "WILL v1 OPC packed metadata가 누락되었습니다.");
      }
      encoded.push(undefined);
      continue;
    }
    if (
      typeof value !== "string"
      || value.length < 1
      || codePointLength(value) > limits.maxMetadataCharacters
      || (encoded.length === 3 && codePointLength(value) > 64)
    ) {
      return fail("MODEL_INVALID", "WILL v1 OPC packed metadata가 올바르지 않습니다.");
    }
    const bytes = textEncoder.encode(value);
    let roundTrip: string;
    try {
      roundTrip = textDecoder.decode(bytes);
    } catch {
      return fail("MODEL_INVALID", "WILL v1 OPC packed metadata UTF-8이 올바르지 않습니다.");
    }
    if (roundTrip !== value) {
      return fail("MODEL_INVALID", "WILL v1 OPC packed metadata UTF-8이 보존되지 않습니다.");
    }
    byteLength = safeAdd(byteLength, bytes.byteLength, limits.maxPackedBytes);
    encoded.push(bytes);
  }
  const block = new Uint8Array(byteLength);
  const view = new DataView(block.buffer);
  let cursor = 16;
  for (let index = 0; index < encoded.length; index += 1) {
    const bytes = encoded[index];
    if (!bytes) {
      view.setUint32(index * 4, 0xffff_ffff, true);
      continue;
    }
    view.setUint32(index * 4, bytes.byteLength, true);
    block.set(bytes, cursor);
    cursor += bytes.byteLength;
  }
  return { block, values };
}

function assertPath(
  path: StudioWillV1PathInput | StudioWillV1Path,
  index: number,
  output: boolean,
  limits: ResolvedPackedLimits,
): void {
  if (
    !path
    || typeof path !== "object"
    || !Array.isArray(path.points)
    || path.points.length < 4
    || path.points.length > limits.maxPointsPerPath
    || !Array.isArray(path.strokeWidths)
    || path.strokeWidths.length < 1
    || path.strokeWidths.length > path.points.length
  ) {
    return fail("MODEL_INVALID", `WILL v1 OPC packed path ${index} 구조가 올바르지 않습니다.`);
  }
  for (const point of path.points) {
    if (
      !point
      || typeof point !== "object"
      || !finiteInRange(
        point.x,
        -limits.maxCoordinateMagnitude,
        limits.maxCoordinateMagnitude,
      )
      || !finiteInRange(
        point.y,
        -limits.maxCoordinateMagnitude,
        limits.maxCoordinateMagnitude,
      )
    ) {
      return fail("MODEL_INVALID", `WILL v1 OPC packed path ${index} 좌표가 올바르지 않습니다.`);
    }
  }
  for (const width of path.strokeWidths) {
    if (!finiteInRange(width, Number.MIN_VALUE, limits.maxStrokeWidth)) {
      return fail("MODEL_INVALID", `WILL v1 OPC packed path ${index} 선폭이 올바르지 않습니다.`);
    }
  }
  const color = path.strokeColor;
  if (
    !color
    || typeof color !== "object"
    || ![color.r, color.g, color.b, color.a].every(
      (channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255,
    )
  ) {
    return fail("MODEL_INVALID", `WILL v1 OPC packed path ${index} 색상이 올바르지 않습니다.`);
  }
  const start = path.startParameter;
  const end = path.endParameter;
  const precision = path.decimalPrecision;
  if (
    (start !== undefined && !finiteInRange(start, 0, 1))
    || (end !== undefined && !finiteInRange(end, 0, 1))
    || (
      precision !== undefined
      && (
        !Number.isInteger(precision)
        || precision < 0
        || precision > limits.maxDecimalPrecision
      )
    )
  ) {
    return fail("MODEL_INVALID", `WILL v1 OPC packed path ${index} 속성이 올바르지 않습니다.`);
  }
  if (output) {
    const candidate = path as StudioWillV1Path;
    if (
      start === undefined
      || end === undefined
      || precision === undefined
      || candidate.segmentCount !== path.points.length - 3
    ) {
      return fail("MODEL_INVALID", `WILL v1 OPC packed path ${index} 결과가 올바르지 않습니다.`);
    }
  }
}

function encodeLoss(
  loss: StudioWillV1LossReport | undefined,
  pathCount: number,
  limits: ResolvedPackedLimits,
): {
  readonly flags: number;
  readonly records: Uint8Array;
  readonly text: Uint8Array;
} {
  if (!loss) {
    return {
      flags: 0,
      records: new Uint8Array(0),
      text: new Uint8Array(0),
    };
  }
  if (
    (loss.status !== "declared" && loss.status !== "exact")
    || loss.quantization !== "truncate-toward-zero"
    || !Array.isArray(loss.items)
    || loss.items.length > pathCount * 4
  ) {
    return fail("MODEL_INVALID", "WILL v1 OPC packed loss report가 올바르지 않습니다.");
  }
  const messages: Uint8Array[] = [];
  let textBytes = 0;
  for (const item of loss.items) {
    if (
      !item
      || typeof item !== "object"
      || !LOSS_CODES.includes(item.code)
      || !Number.isInteger(item.pathIndex)
      || item.pathIndex < 0
      || item.pathIndex >= pathCount
      || !Number.isInteger(item.changedValues)
      || item.changedValues < 1
      || !finiteInRange(item.maximumAbsoluteError, 0, Number.MAX_VALUE)
      || typeof item.message !== "string"
      || item.message.length < 1
      || item.message.length > 2_048
    ) {
      return fail("MODEL_INVALID", "WILL v1 OPC packed loss item이 올바르지 않습니다.");
    }
    const message = textEncoder.encode(item.message);
    let roundTrip: string;
    try {
      roundTrip = textDecoder.decode(message);
    } catch {
      return fail("MODEL_INVALID", "WILL v1 OPC packed loss message UTF-8이 올바르지 않습니다.");
    }
    if (roundTrip !== item.message) {
      return fail("MODEL_INVALID", "WILL v1 OPC packed loss message UTF-8이 보존되지 않습니다.");
    }
    textBytes = safeAdd(textBytes, message.byteLength, limits.maxPackedBytes);
    messages.push(message);
  }
  const recordBytes = safeMultiply(
    loss.items.length,
    LOSS_RECORD_BYTES,
    limits.maxPackedBytes,
  );
  const records = new Uint8Array(recordBytes);
  const text = new Uint8Array(textBytes);
  const view = new DataView(records.buffer);
  let textOffset = 0;
  loss.items.forEach((item, index) => {
    const recordOffset = index * LOSS_RECORD_BYTES;
    const message = messages[index]!;
    view.setUint8(recordOffset, LOSS_CODES.indexOf(item.code) + 1);
    view.setUint32(recordOffset + 4, item.pathIndex, true);
    view.setUint32(recordOffset + 8, item.changedValues, true);
    view.setUint32(recordOffset + 12, textOffset, true);
    view.setUint32(recordOffset + 16, message.byteLength, true);
    view.setFloat64(recordOffset + 24, item.maximumAbsoluteError, true);
    text.set(message, textOffset);
    textOffset += message.byteLength;
  });
  return {
    flags: loss.status === "declared" ? 1 : 0,
    records,
    text,
  };
}

function packModel(model: PackModel, options: StudioWillV1OpcPackedOptions): Uint8Array {
  const limits = resolveLimits(options);
  if (
    !Array.isArray(model.paths)
    || model.paths.length < 1
    || model.paths.length > limits.maxPaths
  ) {
    return fail("MODEL_INVALID", "WILL v1 OPC packed path 목록이 올바르지 않습니다.");
  }
  if (
    model.kind === PacketKindCode.ImportResult
    || model.kind === PacketKindCode.ExportInput
  ) {
    if (
      !finiteInRange(model.width, Number.MIN_VALUE, limits.maxDimension)
      || !finiteInRange(model.height, Number.MIN_VALUE, limits.maxDimension)
    ) {
      return fail("MODEL_INVALID", "WILL v1 OPC packed 문서 크기가 올바르지 않습니다.");
    }
  } else if (model.width !== 0 || model.height !== 0) {
    return fail("MODEL_INVALID", "WILL v1 OPC packed build result 크기가 올바르지 않습니다.");
  }
  const output = model.kind !== PacketKindCode.ExportInput;
  let totalPoints = 0;
  let totalWidths = 0;
  model.paths.forEach((path, index) => {
    assertPath(path, index, output, limits);
    totalPoints = safeAdd(totalPoints, path.points.length, limits.maxTotalPoints);
    totalWidths = safeAdd(totalWidths, path.strokeWidths.length, limits.maxTotalPoints);
  });
  const metadata = encodeMetadata(
    model.metadata,
    model.kind === PacketKindCode.ImportResult,
    limits,
  );
  if (
    model.kind === PacketKindCode.BuildResult
    && metadata.block.byteLength !== 16
  ) {
    return fail("MODEL_INVALID", "WILL v1 OPC packed build result metadata가 올바르지 않습니다.");
  }
  const loss = encodeLoss(model.loss, model.paths.length, limits);
  if (
    (model.kind === PacketKindCode.BuildResult) !== (model.loss !== undefined)
  ) {
    return fail("MODEL_INVALID", "WILL v1 OPC packed loss report 종류가 올바르지 않습니다.");
  }

  const pathBytes = safeMultiply(model.paths.length, PATH_RECORD_BYTES, limits.maxPackedBytes);
  const pointBytes = safeMultiply(totalPoints, 16, limits.maxPackedBytes);
  const widthBytes = safeMultiply(totalWidths, 8, limits.maxPackedBytes);
  const pathTableOffset = HEADER_BYTES;
  const pointsOffset = safeAdd(pathTableOffset, pathBytes, limits.maxPackedBytes);
  const widthsOffset = safeAdd(pointsOffset, pointBytes, limits.maxPackedBytes);
  const metadataOffset = safeAdd(widthsOffset, widthBytes, limits.maxPackedBytes);
  const lossTableOffset = safeAdd(
    metadataOffset,
    metadata.block.byteLength,
    limits.maxPackedBytes,
  );
  const lossTextOffset = safeAdd(
    lossTableOffset,
    loss.records.byteLength,
    limits.maxPackedBytes,
  );
  const byteLength = safeAdd(lossTextOffset, loss.text.byteLength, limits.maxPackedBytes);
  const packet = new Uint8Array(byteLength);
  const view = new DataView(packet.buffer);
  packet.set(textEncoder.encode(STUDIO_WILL_V1_OPC_PACKED_MAGIC), 0);
  view.setUint16(8, STUDIO_WILL_V1_OPC_PACKED_SCHEMA_VERSION, true);
  view.setUint16(10, HEADER_BYTES, true);
  view.setUint32(12, ENDIAN_MARKER, true);
  view.setUint8(16, model.kind);
  view.setUint8(17, loss.flags);
  view.setUint32(20, byteLength, true);
  view.setUint32(24, model.paths.length, true);
  view.setUint32(28, totalPoints, true);
  view.setUint32(32, totalWidths, true);
  view.setUint32(36, model.loss?.items.length ?? 0, true);
  view.setUint32(40, pathTableOffset, true);
  view.setUint32(44, pointsOffset, true);
  view.setUint32(48, widthsOffset, true);
  view.setUint32(52, metadataOffset, true);
  view.setUint32(56, metadata.block.byteLength, true);
  view.setUint32(60, lossTableOffset, true);
  view.setUint32(64, lossTextOffset, true);
  view.setUint32(68, loss.text.byteLength, true);
  view.setFloat64(72, model.width, true);
  view.setFloat64(80, model.height, true);

  let pointIndex = 0;
  let widthIndex = 0;
  model.paths.forEach((path, index) => {
    const recordOffset = pathTableOffset + index * PATH_RECORD_BYTES;
    view.setUint32(recordOffset, pointIndex, true);
    view.setUint32(recordOffset + 4, path.points.length, true);
    view.setUint32(recordOffset + 8, widthIndex, true);
    view.setUint32(recordOffset + 12, path.strokeWidths.length, true);
    view.setUint8(recordOffset + 16, path.strokeColor.r);
    view.setUint8(recordOffset + 17, path.strokeColor.g);
    view.setUint8(recordOffset + 18, path.strokeColor.b);
    view.setUint8(recordOffset + 19, path.strokeColor.a);
    let pathFlags = 0;
    if (path.startParameter !== undefined) pathFlags |= 1;
    if (path.endParameter !== undefined) pathFlags |= 2;
    if (path.decimalPrecision !== undefined) pathFlags |= 4;
    view.setUint8(recordOffset + 20, path.decimalPrecision ?? 0);
    view.setUint8(recordOffset + 21, pathFlags);
    view.setFloat64(recordOffset + 24, path.startParameter ?? 0, true);
    view.setFloat64(recordOffset + 32, path.endParameter ?? 1, true);
    view.setUint32(recordOffset + 40, path.points.length - 3, true);
    for (const point of path.points) {
      const pointOffset = pointsOffset + pointIndex * 16;
      view.setFloat64(pointOffset, point.x, true);
      view.setFloat64(pointOffset + 8, point.y, true);
      pointIndex += 1;
    }
    for (const width of path.strokeWidths) {
      view.setFloat64(widthsOffset + widthIndex * 8, width, true);
      widthIndex += 1;
    }
  });
  packet.set(metadata.block, metadataOffset);
  packet.set(loss.records, lossTableOffset);
  packet.set(loss.text, lossTextOffset);
  return packet;
}

function ownedPacket(value: unknown): Uint8Array | null {
  return (
    value instanceof Uint8Array
    && value.buffer instanceof ArrayBuffer
    && value.byteOffset === 0
    && value.byteLength === value.buffer.byteLength
  )
    ? value
    : null;
}

function headerReservedBytesAreZero(packet: Uint8Array): boolean {
  for (let offset = 18; offset < 20; offset += 1) {
    if (packet[offset] !== 0) return false;
  }
  for (let offset = 88; offset < HEADER_BYTES; offset += 1) {
    if (packet[offset] !== 0) return false;
  }
  return true;
}

function readLayout(
  value: unknown,
  expectedKind: StudioWillV1OpcPackedKind,
  options: StudioWillV1OpcPackedOptions,
): { readonly packet: Uint8Array; readonly view: DataView; readonly layout: PacketLayout } {
  const limits = resolveLimits(options);
  const packet = ownedPacket(value);
  if (
    !packet
    || packet.byteLength < HEADER_BYTES
    || packet.byteLength > limits.maxPackedBytes
  ) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed buffer 소유권 또는 크기가 올바르지 않습니다.");
  }
  const view = new DataView(packet.buffer);
  const magic = textDecoder.decode(packet.subarray(0, 8));
  const kind = view.getUint8(16) as PacketKindCode;
  const flags = view.getUint8(17);
  if (
    magic !== STUDIO_WILL_V1_OPC_PACKED_MAGIC
    || view.getUint16(8, true) !== STUDIO_WILL_V1_OPC_PACKED_SCHEMA_VERSION
    || view.getUint16(10, true) !== HEADER_BYTES
    || view.getUint32(12, true) !== ENDIAN_MARKER
    || kind !== kindCode(expectedKind)
    || !headerReservedBytesAreZero(packet)
    || (kind === PacketKindCode.BuildResult ? flags > 1 : flags !== 0)
  ) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed header가 올바르지 않습니다.");
  }
  const layout: PacketLayout = {
    byteLength: view.getUint32(20, true),
    kind,
    flags,
    pathCount: view.getUint32(24, true),
    totalPoints: view.getUint32(28, true),
    totalWidths: view.getUint32(32, true),
    lossCount: view.getUint32(36, true),
    pathTableOffset: view.getUint32(40, true),
    pointsOffset: view.getUint32(44, true),
    widthsOffset: view.getUint32(48, true),
    metadataOffset: view.getUint32(52, true),
    metadataBytes: view.getUint32(56, true),
    lossTableOffset: view.getUint32(60, true),
    lossTextOffset: view.getUint32(64, true),
    lossTextBytes: view.getUint32(68, true),
    width: view.getFloat64(72, true),
    height: view.getFloat64(80, true),
  };
  if (
    layout.pathCount > limits.maxPaths
    || layout.totalPoints > limits.maxTotalPoints
    || layout.totalWidths > limits.maxTotalPoints
  ) {
    return fail(
      "RESOURCE_LIMIT",
      "WILL v1 OPC packed 객체 materialization 예산을 넘었습니다.",
    );
  }
  if (
    layout.byteLength !== packet.byteLength
    || layout.pathCount < 1
    || layout.lossCount > layout.pathCount * 4
    || (kind === PacketKindCode.BuildResult ? false : layout.lossCount !== 0)
    || (
      kind === PacketKindCode.BuildResult
        ? layout.width !== 0 || layout.height !== 0
        : !finiteInRange(layout.width, Number.MIN_VALUE, limits.maxDimension)
          || !finiteInRange(layout.height, Number.MIN_VALUE, limits.maxDimension)
    )
  ) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed count 또는 크기가 올바르지 않습니다.");
  }
  const pathBytes = safeMultiply(layout.pathCount, PATH_RECORD_BYTES, limits.maxPackedBytes);
  const pointBytes = safeMultiply(layout.totalPoints, 16, limits.maxPackedBytes);
  const widthBytes = safeMultiply(layout.totalWidths, 8, limits.maxPackedBytes);
  const lossBytes = safeMultiply(layout.lossCount, LOSS_RECORD_BYTES, limits.maxPackedBytes);
  const expectedPoints = safeAdd(HEADER_BYTES, pathBytes, limits.maxPackedBytes);
  const expectedWidths = safeAdd(expectedPoints, pointBytes, limits.maxPackedBytes);
  const expectedMetadata = safeAdd(expectedWidths, widthBytes, limits.maxPackedBytes);
  const expectedLossTable = safeAdd(
    expectedMetadata,
    layout.metadataBytes,
    limits.maxPackedBytes,
  );
  const expectedLossText = safeAdd(expectedLossTable, lossBytes, limits.maxPackedBytes);
  const expectedEnd = safeAdd(
    expectedLossText,
    layout.lossTextBytes,
    limits.maxPackedBytes,
  );
  if (
    layout.pathTableOffset !== HEADER_BYTES
    || layout.pointsOffset !== expectedPoints
    || layout.widthsOffset !== expectedWidths
    || layout.metadataOffset !== expectedMetadata
    || layout.lossTableOffset !== expectedLossTable
    || layout.lossTextOffset !== expectedLossText
    || expectedEnd !== packet.byteLength
  ) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed section 경계가 올바르지 않습니다.");
  }
  validateMetadata(packet, view, layout, limits);
  validatePathRecords(packet, view, layout, limits, expectedKind !== "export-input");
  validateLossRecords(packet, view, layout);
  return { packet, view, layout };
}

function validateMetadata(
  packet: Uint8Array,
  view: DataView,
  layout: PacketLayout,
  limits: ResolvedPackedLimits,
): void {
  if (layout.metadataBytes < 16) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed metadata header가 잘렸습니다.");
  }
  let cursor = layout.metadataOffset + 16;
  const end = layout.metadataOffset + layout.metadataBytes;
  for (let index = 0; index < 4; index += 1) {
    const byteLength = view.getUint32(layout.metadataOffset + index * 4, true);
    if (byteLength === 0xffff_ffff) {
      if (layout.kind === PacketKindCode.ImportResult) {
        return fail("INVALID_PACKET", "WILL v1 OPC packed 필수 metadata가 누락되었습니다.");
      }
      continue;
    }
    if (layout.kind === PacketKindCode.BuildResult) {
      return fail("INVALID_PACKET", "WILL v1 OPC packed build result metadata가 허용되지 않습니다.");
    }
    if (byteLength < 1 || byteLength > end - cursor) {
      return fail("INVALID_PACKET", "WILL v1 OPC packed metadata 길이가 올바르지 않습니다.");
    }
    let value: string;
    try {
      value = textDecoder.decode(packet.subarray(cursor, cursor + byteLength));
    } catch {
      return fail("INVALID_PACKET", "WILL v1 OPC packed metadata UTF-8이 올바르지 않습니다.");
    }
    if (
      codePointLength(value) > limits.maxMetadataCharacters
      || (index === 3 && codePointLength(value) > 64)
    ) {
      return fail("RESOURCE_LIMIT", "WILL v1 OPC packed metadata 예산을 넘었습니다.");
    }
    cursor += byteLength;
  }
  if (cursor !== end) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed metadata tail이 올바르지 않습니다.");
  }
}

function validatePathRecords(
  packet: Uint8Array,
  view: DataView,
  layout: PacketLayout,
  limits: ResolvedPackedLimits,
  output: boolean,
): void {
  let pointCursor = 0;
  let widthCursor = 0;
  for (let index = 0; index < layout.pathCount; index += 1) {
    const offset = layout.pathTableOffset + index * PATH_RECORD_BYTES;
    const pointStart = view.getUint32(offset, true);
    const pointCount = view.getUint32(offset + 4, true);
    const widthStart = view.getUint32(offset + 8, true);
    const widthCount = view.getUint32(offset + 12, true);
    const precision = view.getUint8(offset + 20);
    const flags = view.getUint8(offset + 21);
    const start = view.getFloat64(offset + 24, true);
    const end = view.getFloat64(offset + 32, true);
    const segmentCount = view.getUint32(offset + 40, true);
    if (
      pointStart !== pointCursor
      || widthStart !== widthCursor
      || pointCount < 4
      || pointCount > limits.maxPointsPerPath
      || widthCount < 1
      || widthCount > pointCount
      || flags > 7
      || (output && flags !== 7)
      || precision > limits.maxDecimalPrecision
      || ((flags & 1) !== 0 && !finiteInRange(start, 0, 1))
      || ((flags & 2) !== 0 && !finiteInRange(end, 0, 1))
      || (flags & 1) === 0 && start !== 0
      || (flags & 2) === 0 && end !== 1
      || (flags & 4) === 0 && precision !== 0
      || segmentCount !== pointCount - 3
      || view.getUint16(offset + 22, true) !== 0
      || view.getUint32(offset + 44, true) !== 0
    ) {
      return fail("INVALID_PACKET", `WILL v1 OPC packed path ${index} record가 올바르지 않습니다.`);
    }
    pointCursor = safeAdd(pointCursor, pointCount, layout.totalPoints);
    widthCursor = safeAdd(widthCursor, widthCount, layout.totalWidths);
    for (let pointIndex = pointStart; pointIndex < pointCursor; pointIndex += 1) {
      const pointOffset = layout.pointsOffset + pointIndex * 16;
      if (
        !finiteInRange(
          view.getFloat64(pointOffset, true),
          -limits.maxCoordinateMagnitude,
          limits.maxCoordinateMagnitude,
        )
        || !finiteInRange(
          view.getFloat64(pointOffset + 8, true),
          -limits.maxCoordinateMagnitude,
          limits.maxCoordinateMagnitude,
        )
      ) {
        return fail("INVALID_PACKET", `WILL v1 OPC packed path ${index} 좌표가 올바르지 않습니다.`);
      }
    }
    for (let widthIndex = widthStart; widthIndex < widthCursor; widthIndex += 1) {
      if (
        !finiteInRange(
          view.getFloat64(layout.widthsOffset + widthIndex * 8, true),
          Number.MIN_VALUE,
          limits.maxStrokeWidth,
        )
      ) {
        return fail("INVALID_PACKET", `WILL v1 OPC packed path ${index} 선폭이 올바르지 않습니다.`);
      }
    }
  }
  if (pointCursor !== layout.totalPoints || widthCursor !== layout.totalWidths) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed path offset 합계가 올바르지 않습니다.");
  }
  void packet;
}

function validateLossRecords(
  packet: Uint8Array,
  view: DataView,
  layout: PacketLayout,
): void {
  if (layout.kind !== PacketKindCode.BuildResult) {
    if (layout.lossTextBytes !== 0) {
      return fail("INVALID_PACKET", "WILL v1 OPC packed loss section이 허용되지 않습니다.");
    }
    return;
  }
  let expectedTextOffset = 0;
  for (let index = 0; index < layout.lossCount; index += 1) {
    const offset = layout.lossTableOffset + index * LOSS_RECORD_BYTES;
    const code = view.getUint8(offset);
    const pathIndex = view.getUint32(offset + 4, true);
    const changedValues = view.getUint32(offset + 8, true);
    const messageOffset = view.getUint32(offset + 12, true);
    const messageLength = view.getUint32(offset + 16, true);
    const maximumError = view.getFloat64(offset + 24, true);
    if (
      code < 1
      || code > LOSS_CODES.length
      || packet[offset + 1] !== 0
      || packet[offset + 2] !== 0
      || packet[offset + 3] !== 0
      || view.getUint32(offset + 20, true) !== 0
      || pathIndex >= layout.pathCount
      || changedValues < 1
      || messageOffset !== expectedTextOffset
      || messageLength < 1
      || messageLength > 8_192
      || messageLength > layout.lossTextBytes - messageOffset
      || !finiteInRange(maximumError, 0, Number.MAX_VALUE)
    ) {
      return fail("INVALID_PACKET", `WILL v1 OPC packed loss item ${index}이 올바르지 않습니다.`);
    }
    let message: string;
    try {
      message = textDecoder.decode(
        packet.subarray(
          layout.lossTextOffset + messageOffset,
          layout.lossTextOffset + messageOffset + messageLength,
        ),
      );
    } catch {
      return fail("INVALID_PACKET", "WILL v1 OPC packed loss message UTF-8이 올바르지 않습니다.");
    }
    if (message.length < 1 || message.length > 2_048) {
      return fail("INVALID_PACKET", "WILL v1 OPC packed loss message 길이가 올바르지 않습니다.");
    }
    expectedTextOffset += messageLength;
  }
  if (expectedTextOffset !== layout.lossTextBytes) {
    return fail("INVALID_PACKET", "WILL v1 OPC packed loss text tail이 올바르지 않습니다.");
  }
}

function decodeMetadata(
  packet: Uint8Array,
  view: DataView,
  layout: PacketLayout,
): readonly (string | undefined)[] {
  const values: (string | undefined)[] = [];
  let cursor = layout.metadataOffset + 16;
  for (let index = 0; index < 4; index += 1) {
    const byteLength = view.getUint32(layout.metadataOffset + index * 4, true);
    if (byteLength === 0xffff_ffff) {
      values.push(undefined);
      continue;
    }
    values.push(textDecoder.decode(packet.subarray(cursor, cursor + byteLength)));
    cursor += byteLength;
  }
  return values;
}

function decodePaths(
  view: DataView,
  layout: PacketLayout,
  output: boolean,
): readonly (StudioWillV1PathInput | StudioWillV1Path)[] {
  const paths: (StudioWillV1PathInput | StudioWillV1Path)[] = [];
  for (let index = 0; index < layout.pathCount; index += 1) {
    const offset = layout.pathTableOffset + index * PATH_RECORD_BYTES;
    const pointStart = view.getUint32(offset, true);
    const pointCount = view.getUint32(offset + 4, true);
    const widthStart = view.getUint32(offset + 8, true);
    const widthCount = view.getUint32(offset + 12, true);
    const flags = view.getUint8(offset + 21);
    const points = Array.from({ length: pointCount }, (_, pointIndex) => {
      const pointOffset = layout.pointsOffset + (pointStart + pointIndex) * 16;
      return {
        x: view.getFloat64(pointOffset, true),
        y: view.getFloat64(pointOffset + 8, true),
      };
    });
    const strokeWidths = Array.from({ length: widthCount }, (_, widthIndex) =>
      view.getFloat64(layout.widthsOffset + (widthStart + widthIndex) * 8, true)
    );
    const common = {
      points,
      strokeWidths,
      strokeColor: {
        r: view.getUint8(offset + 16),
        g: view.getUint8(offset + 17),
        b: view.getUint8(offset + 18),
        a: view.getUint8(offset + 19),
      },
    };
    if (output) {
      paths.push({
        ...common,
        startParameter: view.getFloat64(offset + 24, true),
        endParameter: view.getFloat64(offset + 32, true),
        decimalPrecision: view.getUint8(offset + 20),
        segmentCount: view.getUint32(offset + 40, true),
      });
    } else {
      paths.push({
        ...common,
        ...((flags & 1) !== 0
          ? { startParameter: view.getFloat64(offset + 24, true) }
          : {}),
        ...((flags & 2) !== 0
          ? { endParameter: view.getFloat64(offset + 32, true) }
          : {}),
        ...((flags & 4) !== 0
          ? { decimalPrecision: view.getUint8(offset + 20) }
          : {}),
      });
    }
  }
  return paths;
}

function decodeLoss(
  packet: Uint8Array,
  view: DataView,
  layout: PacketLayout,
): StudioWillV1LossReport {
  const items: StudioWillV1LossItem[] = [];
  for (let index = 0; index < layout.lossCount; index += 1) {
    const offset = layout.lossTableOffset + index * LOSS_RECORD_BYTES;
    const messageOffset = view.getUint32(offset + 12, true);
    const messageLength = view.getUint32(offset + 16, true);
    items.push({
      code: LOSS_CODES[view.getUint8(offset) - 1]!,
      pathIndex: view.getUint32(offset + 4, true),
      changedValues: view.getUint32(offset + 8, true),
      maximumAbsoluteError: view.getFloat64(offset + 24, true),
      message: textDecoder.decode(
        packet.subarray(
          layout.lossTextOffset + messageOffset,
          layout.lossTextOffset + messageOffset + messageLength,
        ),
      ),
    });
  }
  return {
    status: layout.flags === 1 ? "declared" : "exact",
    quantization: "truncate-toward-zero",
    items,
  };
}

export function inspectStudioWillV1OpcPacked(
  value: unknown,
  expectedKind: StudioWillV1OpcPackedKind,
  options: StudioWillV1OpcPackedOptions = {},
): StudioWillV1OpcPackedSummary {
  const { layout } = readLayout(value, expectedKind, options);
  return {
    byteLength: layout.byteLength,
    kind: kindName(layout.kind),
    lossCount: layout.lossCount,
    pathCount: layout.pathCount,
    totalPoints: layout.totalPoints,
    totalStrokeWidths: layout.totalWidths,
  };
}

export function isStudioWillV1OpcPacked(
  value: unknown,
  expectedKind: StudioWillV1OpcPackedKind,
  options: StudioWillV1OpcPackedOptions = {},
): value is Uint8Array {
  try {
    inspectStudioWillV1OpcPacked(value, expectedKind, options);
    return true;
  } catch {
    return false;
  }
}

export function packStudioWillV1OpcExportInput(
  input: StudioWillV1OpcExportInput,
  options: StudioWillV1OpcPackedOptions = {},
): Uint8Array {
  return packModel(
    {
      kind: PacketKindCode.ExportInput,
      width: input.width,
      height: input.height,
      metadata: [
        input.title,
        input.createdAt,
        input.application,
        input.applicationVersion,
      ],
      paths: input.paths,
    },
    options,
  );
}

export function unpackStudioWillV1OpcExportInput(
  packet: Uint8Array,
  options: StudioWillV1OpcPackedOptions = {},
): StudioWillV1OpcExportInput {
  const parsed = readLayout(packet, "export-input", options);
  const metadata = decodeMetadata(parsed.packet, parsed.view, parsed.layout);
  return {
    width: parsed.layout.width,
    height: parsed.layout.height,
    paths: decodePaths(parsed.view, parsed.layout, false) as readonly StudioWillV1PathInput[],
    ...(metadata[0] === undefined ? {} : { title: metadata[0] }),
    ...(metadata[1] === undefined ? {} : { createdAt: metadata[1] }),
    ...(metadata[2] === undefined ? {} : { application: metadata[2] }),
    ...(metadata[3] === undefined ? {} : { applicationVersion: metadata[3] }),
  };
}

export function packStudioWillV1OpcBuildResult(
  result: StudioWillV1OpcBuildResult,
  options: StudioWillV1OpcPackedOptions = {},
): Uint8Array {
  return packModel(
    {
      kind: PacketKindCode.BuildResult,
      width: 0,
      height: 0,
      metadata: [undefined, undefined, undefined, undefined],
      paths: result.paths,
      loss: result.loss,
    },
    options,
  );
}

export function unpackStudioWillV1OpcBuildResult(
  archive: Uint8Array,
  packet: Uint8Array,
  options: StudioWillV1OpcPackedOptions = {},
): StudioWillV1OpcBuildResult {
  const parsed = readLayout(packet, "build-result", options);
  return {
    bytes: archive,
    paths: decodePaths(parsed.view, parsed.layout, true) as readonly StudioWillV1Path[],
    loss: decodeLoss(parsed.packet, parsed.view, parsed.layout),
    assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
  };
}

export function packStudioWillV1OpcImportResult(
  result: StudioWillV1OpcImportResult,
  options: StudioWillV1OpcPackedOptions = {},
): Uint8Array {
  return packModel(
    {
      kind: PacketKindCode.ImportResult,
      width: result.width,
      height: result.height,
      metadata: [
        result.title,
        result.createdAt,
        result.application,
        result.applicationVersion,
      ],
      paths: result.paths,
    },
    options,
  );
}

export function unpackStudioWillV1OpcImportResult(
  packet: Uint8Array,
  options: StudioWillV1OpcPackedOptions = {},
): StudioWillV1OpcImportResult {
  return unpackStudioWillV1OpcImportResultWithMetrics(packet, options).result;
}

export function unpackStudioWillV1OpcImportResultWithMetrics(
  packet: Uint8Array,
  options: StudioWillV1OpcPackedOptions = {},
): StudioWillV1OpcImportWithMetrics {
  const limits = resolveLimits(options);
  const parsed = readLayout(packet, "import-result", options);
  const metadata = decodeMetadata(parsed.packet, parsed.view, parsed.layout);
  const paths = decodePaths(
    parsed.view,
    parsed.layout,
    true,
  ) as readonly StudioWillV1Path[];
  const result: StudioWillV1OpcImportResult = {
    width: parsed.layout.width,
    height: parsed.layout.height,
    title: metadata[0]!,
    createdAt: metadata[1]!,
    application: metadata[2]!,
    applicationVersion: metadata[3]!,
    paths,
    assurance: STUDIO_WILL_V1_OPC_ASSURANCE,
  };
  return Object.freeze({
    result,
    metrics: Object.freeze({
      materializedPathObjects: paths.length,
      materializedPointObjects: parsed.layout.totalPoints,
      packedPointCount: parsed.layout.totalPoints,
      pointObjectBudget: limits.maxTotalPoints,
    }),
  });
}
