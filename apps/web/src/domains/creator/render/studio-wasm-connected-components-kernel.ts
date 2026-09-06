import {
  createStudioWasmMemoryRuntime,
  STUDIO_WASM64_DEFAULT_WINDOW_BYTES,
  STUDIO_WASM_PAGE_BYTES,
  type StudioWasmAddressType,
  type StudioWasmByteViewFailureReason,
  type StudioWasmMemoryGrowFailureReason,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

/**
 * One bounded resident mask window. Documents larger than this are expected to
 * feed independent OPFS/tile windows while keeping their logical offsets as
 * bigint. A single giant TypedArray is deliberately not created.
 */
export const STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES =
  STUDIO_WASM64_DEFAULT_WINDOW_BYTES;

/** The result record occupies bytes 0..35 and the copied mask starts at 64. */
export const STUDIO_WASM_COMPONENT_SCAN_RESULT_BYTES = 36;
export const STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET = BigInt(64);
export const STUDIO_WASM_COMPONENT_SCAN_MAX_INPUT_BYTES =
  STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES
  - Number(STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET);

const MAX_U32 = 0xffff_ffff;
const WASM_MAGIC_AND_VERSION = [
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
] as const;
const WASM_I32 = 0x7f;
const WASM_I64 = 0x7e;

export interface StudioBinaryMaskBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxXExclusive: number;
  readonly maxYExclusive: number;
  readonly width: number;
  readonly height: number;
}

/**
 * This is a connected-component pre-pass rather than a complete label image.
 * Horizontal run count provides an upper bound for component seeds, while the
 * foreground count and bounds let callers size/skip later union-find work.
 */
export interface StudioBinaryMaskScan {
  readonly foregroundPixelCount: bigint;
  readonly rowRunCount: bigint;
  readonly bounds: StudioBinaryMaskBounds | null;
}

export interface StudioBinaryMaskScanInput {
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Row bytes, including optional padding. Defaults to width. */
  readonly stride?: number;
}

interface StudioValidatedMaskDimensions {
  readonly width: number;
  readonly height: number;
  readonly stride: number;
  readonly spanBytes: number;
  readonly pixelCount: bigint;
}

export type StudioBinaryMaskValidationFailureReason =
  | "invalid-mask"
  | "invalid-dimensions"
  | "dimension-overflow"
  | "input-too-short"
  | "resident-window-exceeded";

export type StudioBinaryMaskJsScanResult =
  | {
      readonly ok: true;
      readonly backend: "js";
      readonly scan: StudioBinaryMaskScan;
      readonly spanBytes: number;
    }
  | {
      readonly ok: false;
      readonly reason: StudioBinaryMaskValidationFailureReason;
    };

function validateDimensions(
  width: number,
  height: number,
  stride: number | undefined,
): StudioValidatedMaskDimensions | StudioBinaryMaskValidationFailureReason {
  const resolvedStride = stride ?? width;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || !Number.isSafeInteger(resolvedStride)
    || width <= 0
    || height <= 0
    || resolvedStride < width
    || width > MAX_U32
    || height > MAX_U32
    || resolvedStride > MAX_U32
  ) {
    return "invalid-dimensions";
  }

  const widthI64 = BigInt(width);
  const heightI64 = BigInt(height);
  const strideI64 = BigInt(resolvedStride);
  const spanBytesI64 =
    (heightI64 - BigInt(1)) * strideI64 + widthI64;
  const pixelCount = widthI64 * heightI64;
  if (
    spanBytesI64 > BigInt(Number.MAX_SAFE_INTEGER)
    || pixelCount > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return "dimension-overflow";
  }
  if (spanBytesI64 > BigInt(STUDIO_WASM_COMPONENT_SCAN_MAX_INPUT_BYTES)) {
    return "resident-window-exceeded";
  }

  return {
    width,
    height,
    stride: resolvedStride,
    spanBytes: Number(spanBytesI64),
    pixelCount,
  };
}

function validateMaskInput(
  input: StudioBinaryMaskScanInput,
): StudioValidatedMaskDimensions | StudioBinaryMaskValidationFailureReason {
  if (!(input.mask instanceof Uint8Array)) return "invalid-mask";
  const dimensions = validateDimensions(
    input.width,
    input.height,
    input.stride,
  );
  if (typeof dimensions === "string") return dimensions;
  if (input.mask.byteLength < dimensions.spanBytes) return "input-too-short";
  return dimensions;
}

/** Byte-exact non-zero foreground reference used by every fallback path. */
export function scanStudioBinaryMaskJs(
  input: StudioBinaryMaskScanInput,
): StudioBinaryMaskJsScanResult {
  const dimensions = validateMaskInput(input);
  if (typeof dimensions === "string") {
    return { ok: false, reason: dimensions };
  }

  let foregroundPixelCount = BigInt(0);
  let rowRunCount = BigInt(0);
  let minX = dimensions.width;
  let minY = dimensions.height;
  let maxXExclusive = 0;
  let maxYExclusive = 0;

  for (let y = 0; y < dimensions.height; y += 1) {
    const rowOffset = y * dimensions.stride;
    let insideRun = false;
    for (let x = 0; x < dimensions.width; x += 1) {
      const foreground = input.mask[rowOffset + x] !== 0;
      if (!foreground) {
        insideRun = false;
        continue;
      }

      foregroundPixelCount += BigInt(1);
      if (!insideRun) {
        rowRunCount += BigInt(1);
        insideRun = true;
      }
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + 1 > maxXExclusive) maxXExclusive = x + 1;
      if (y + 1 > maxYExclusive) maxYExclusive = y + 1;
    }
  }

  const bounds =
    foregroundPixelCount === BigInt(0)
      ? null
      : {
          minX,
          minY,
          maxXExclusive,
          maxYExclusive,
          width: maxXExclusive - minX,
          height: maxYExclusive - minY,
        };
  return {
    ok: true,
    backend: "js",
    scan: {
      foregroundPixelCount,
      rowRunCount,
      bounds,
    },
    spanBytes: dimensions.spanBytes,
  };
}

function encodeUnsignedLeb(value: number | bigint): number[] {
  let remaining = typeof value === "bigint" ? value : BigInt(value);
  if (remaining < BigInt(0)) {
    throw new RangeError("Unsigned LEB128 cannot encode a negative value");
  }
  const bytes: number[] = [];
  do {
    let byte = Number(remaining & BigInt(0x7f));
    remaining >>= BigInt(7);
    if (remaining !== BigInt(0)) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== BigInt(0));
  return bytes;
}

function encodeSignedLeb32(value: number): number[] {
  let remaining = BigInt.asIntN(32, BigInt(value));
  const bytes: number[] = [];
  let complete = false;
  while (!complete) {
    let byte = Number(remaining & BigInt(0x7f));
    remaining >>= BigInt(7);
    const signBitSet = (byte & 0x40) !== 0;
    complete =
      (remaining === BigInt(0) && !signBitSet)
      || (remaining === -BigInt(1) && signBitSet);
    if (!complete) byte |= 0x80;
    bytes.push(byte);
  }
  return bytes;
}

function encodeAsciiName(value: string): number[] {
  const bytes = [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? -1;
    if (codePoint < 0 || codePoint > 0x7f) {
      throw new TypeError("WebAssembly builder names must be ASCII");
    }
    return codePoint;
  });
  return [...encodeUnsignedLeb(bytes.length), ...bytes];
}

function encodeSection(id: number, payload: readonly number[]): number[] {
  return [id, ...encodeUnsignedLeb(payload.length), ...payload];
}

function createMaskScanFunctionBody(
  addressType: StudioWasmAddressType,
): number[] {
  const isMemory64 = addressType === "i64";
  const addressValueType = isMemory64 ? WASM_I64 : WASM_I32;
  const addressConst = isMemory64 ? 0x42 : 0x41;
  const addressAdd = isMemory64 ? 0x7c : 0x6a;
  const addressMultiply = isMemory64 ? 0x7e : 0x6c;
  const addressLessThanUnsigned = isMemory64 ? 0x54 : 0x49;
  const addressGreaterThanUnsigned = isMemory64 ? 0x56 : 0x4b;
  const addressGreaterThanOrEqualUnsigned = isMemory64 ? 0x5a : 0x4f;
  const addressToI32 = isMemory64 ? [0xa7] : [];
  const addressConstant = (value: number) => [
    addressConst,
    ...encodeSignedLeb32(value),
  ];

  // Parameters 0..4: input, width, height, stride, result pointer.
  // Locals 5..16: y, x, row base, foreground, runs, in-run,
  // minX, minY, maxX, maxY, found, pixel.
  const localDeclarations = [
    0x05,
    0x03, addressValueType,
    0x02, WASM_I64,
    0x01, WASM_I32,
    0x04, addressValueType,
    0x02, WASM_I32,
  ];
  const instructions = [
    // minX = width; minY = height. Other locals start at zero.
    0x20, 0x01, 0x21, 0x0b,
    0x20, 0x02, 0x21, 0x0c,

    0x02, 0x40, // block outer-exit
    0x03, 0x40, // loop rows
    0x20, 0x05,
    0x20, 0x02,
    addressGreaterThanOrEqualUnsigned,
    0x0d, 0x01, // br_if outer-exit

    // rowBase = input + y * stride
    0x20, 0x00,
    0x20, 0x05,
    0x20, 0x03,
    addressMultiply,
    addressAdd,
    0x21, 0x07,
    ...addressConstant(0),
    0x21, 0x06, // x = 0
    0x41, 0x00,
    0x21, 0x0a, // inRun = 0

    0x02, 0x40, // block row-exit
    0x03, 0x40, // loop columns
    0x20, 0x06,
    0x20, 0x01,
    addressGreaterThanOrEqualUnsigned,
    0x0d, 0x01, // br_if row-exit

    0x20, 0x07,
    0x20, 0x06,
    addressAdd,
    0x2d, 0x00, 0x00, // i32.load8_u
    0x21, 0x10, // pixel
    0x20, 0x10,
    0x45, // i32.eqz
    0x04, 0x40, // if background
    0x41, 0x00,
    0x21, 0x0a, // inRun = 0
    0x05, // else foreground
    0x20, 0x08,
    0x42, 0x01,
    0x7c,
    0x21, 0x08, // foreground += 1

    0x20, 0x0a,
    0x45,
    0x04, 0x40, // if !inRun
    0x20, 0x09,
    0x42, 0x01,
    0x7c,
    0x21, 0x09, // runs += 1
    0x41, 0x01,
    0x21, 0x0a,
    0x0b,

    0x41, 0x01,
    0x21, 0x0f, // found = 1
    0x20, 0x06,
    0x20, 0x0b,
    addressLessThanUnsigned,
    0x04, 0x40,
    0x20, 0x06,
    0x21, 0x0b,
    0x0b,
    0x20, 0x05,
    0x20, 0x0c,
    addressLessThanUnsigned,
    0x04, 0x40,
    0x20, 0x05,
    0x21, 0x0c,
    0x0b,

    0x20, 0x06,
    ...addressConstant(1),
    addressAdd,
    0x20, 0x0d,
    addressGreaterThanUnsigned,
    0x04, 0x40,
    0x20, 0x06,
    ...addressConstant(1),
    addressAdd,
    0x21, 0x0d,
    0x0b,
    0x20, 0x05,
    ...addressConstant(1),
    addressAdd,
    0x20, 0x0e,
    addressGreaterThanUnsigned,
    0x04, 0x40,
    0x20, 0x05,
    ...addressConstant(1),
    addressAdd,
    0x21, 0x0e,
    0x0b,
    0x0b, // end foreground/background

    0x20, 0x06,
    ...addressConstant(1),
    addressAdd,
    0x21, 0x06,
    0x0c, 0x00, // continue columns
    0x0b,
    0x0b,

    0x20, 0x05,
    ...addressConstant(1),
    addressAdd,
    0x21, 0x05,
    0x0c, 0x00, // continue rows
    0x0b,
    0x0b,

    // Result record: u64 foreground, u64 runs, u32 min/max, u32 found.
    0x20, 0x04,
    0x20, 0x08,
    0x37, 0x03, 0x00,
    0x20, 0x04,
    0x20, 0x09,
    0x37, 0x03, 0x08,
    0x20, 0x04,
    0x20, 0x0b,
    ...addressToI32,
    0x36, 0x02, 0x10,
    0x20, 0x04,
    0x20, 0x0c,
    ...addressToI32,
    0x36, 0x02, 0x14,
    0x20, 0x04,
    0x20, 0x0d,
    ...addressToI32,
    0x36, 0x02, 0x18,
    0x20, 0x04,
    0x20, 0x0e,
    ...addressToI32,
    0x36, 0x02, 0x1c,
    0x20, 0x04,
    0x20, 0x0f,
    0x36, 0x02, 0x20,
    0x41, 0x00, // status = success
    0x0b,
  ];
  const body = [...localDeclarations, ...instructions];
  return [...encodeUnsignedLeb(body.length), ...body];
}

/**
 * Builds the same scan primitive for i32- and i64-addressed imported memory.
 * The Memory64 variant exposes a genuine i64 pointer/dimension ABI.
 */
export function buildStudioWasmConnectedComponentsModule(
  addressType: StudioWasmAddressType,
): Uint8Array<ArrayBuffer> {
  const addressValueType = addressType === "i64" ? WASM_I64 : WASM_I32;
  const typeSection = encodeSection(1, [
    0x01,
    0x60,
    0x05,
    addressValueType,
    addressValueType,
    addressValueType,
    addressValueType,
    addressValueType,
    0x01,
    WASM_I32,
  ]);
  const importSection = encodeSection(2, [
    0x01,
    ...encodeAsciiName("env"),
    ...encodeAsciiName("memory"),
    0x02,
    addressType === "i64" ? 0x04 : 0x00,
    ...encodeUnsignedLeb(BigInt(1)),
  ]);
  const functionSection = encodeSection(3, [0x01, 0x00]);
  const exportSection = encodeSection(7, [
    0x01,
    ...encodeAsciiName("scan"),
    0x00,
    0x00,
  ]);
  const codeSection = encodeSection(10, [
    0x01,
    ...createMaskScanFunctionBody(addressType),
  ]);
  return new Uint8Array([
    ...WASM_MAGIC_AND_VERSION,
    ...typeSection,
    ...importSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
  ]);
}

type StudioWasmMaskScanExport = (
  inputPointer: number | bigint,
  width: number | bigint,
  height: number | bigint,
  stride: number | bigint,
  resultPointer: number | bigint,
) => number;

export type StudioWasmConnectedComponentsKernelCreationFailureReason =
  | "webassembly-unavailable"
  | "module-validation-failed"
  | "module-instantiation-failed"
  | "scan-export-missing";

export type StudioWasmConnectedComponentsKernelCreationResult =
  | {
      readonly ok: true;
      readonly kernel: StudioWasmConnectedComponentsKernel;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmConnectedComponentsKernelCreationFailureReason;
      readonly cause?: unknown;
    };

export type StudioWasmConnectedComponentsRunFailureReason =
  | StudioBinaryMaskValidationFailureReason
  | "invalid-resident-offset"
  | "output-overlaps-input"
  | "range-outside-resident-memory"
  | "stale-generation"
  | "memory-grow-failed"
  | "view-creation-failed"
  | "kernel-run-failed"
  | "malformed-kernel-output";

export type StudioWasmConnectedComponentsRunResult =
  | {
      readonly ok: true;
      readonly backend: "wasm64" | "wasm32";
      readonly scan: StudioBinaryMaskScan;
      readonly spanBytes: number;
      readonly generation: number;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmConnectedComponentsRunFailureReason;
      readonly growReason?: StudioWasmMemoryGrowFailureReason;
      readonly viewReason?: StudioWasmByteViewFailureReason;
      readonly cause?: unknown;
    };

function parseKernelOutput(
  view: Uint8Array,
  dimensions: StudioValidatedMaskDimensions,
): StudioBinaryMaskScan | null {
  let output: DataView;
  try {
    output = new DataView(
      view.buffer,
      view.byteOffset,
      STUDIO_WASM_COMPONENT_SCAN_RESULT_BYTES,
    );
  } catch {
    return null;
  }
  const foregroundPixelCount = output.getBigUint64(0, true);
  const rowRunCount = output.getBigUint64(8, true);
  const found = output.getUint32(32, true);
  if (
    found > 1
    || foregroundPixelCount > dimensions.pixelCount
    || rowRunCount > foregroundPixelCount
    || (foregroundPixelCount === BigInt(0)) !== (found === 0)
  ) {
    return null;
  }
  if (found === 0) {
    return {
      foregroundPixelCount,
      rowRunCount,
      bounds: null,
    };
  }

  const minX = output.getUint32(16, true);
  const minY = output.getUint32(20, true);
  const maxXExclusive = output.getUint32(24, true);
  const maxYExclusive = output.getUint32(28, true);
  if (
    minX >= maxXExclusive
    || minY >= maxYExclusive
    || maxXExclusive > dimensions.width
    || maxYExclusive > dimensions.height
  ) {
    return null;
  }
  return {
    foregroundPixelCount,
    rowRunCount,
    bounds: {
      minX,
      minY,
      maxXExclusive,
      maxYExclusive,
      width: maxXExclusive - minX,
      height: maxYExclusive - minY,
    },
  };
}

export interface StudioWasmResidentMaskScanRequest {
  readonly residentByteOffset: bigint;
  readonly width: number;
  readonly height: number;
  readonly stride?: number;
  /**
   * Required token obtained after the caller materialized the resident window.
   * A grow or external imported-memory mutation invalidates the request.
   */
  readonly expectedGeneration: number;
}

export class StudioWasmConnectedComponentsKernel {
  public readonly runtime: StudioWasmLinearMemoryRuntime;

  private readonly scanExport: StudioWasmMaskScanExport;

  public constructor(input: {
    readonly runtime: StudioWasmLinearMemoryRuntime;
    readonly scanExport: StudioWasmMaskScanExport;
  }) {
    this.runtime = input.runtime;
    this.scanExport = input.scanExport;
  }

  public scanResident(
    request: StudioWasmResidentMaskScanRequest,
  ): StudioWasmConnectedComponentsRunResult {
    const dimensions = validateDimensions(
      request.width,
      request.height,
      request.stride,
    );
    if (typeof dimensions === "string") {
      return { ok: false, reason: dimensions };
    }
    if (
      request.residentByteOffset < BigInt(0)
      || request.residentByteOffset > BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return { ok: false, reason: "invalid-resident-offset" };
    }
    const residentEnd =
      request.residentByteOffset + BigInt(dimensions.spanBytes);
    if (
      request.residentByteOffset < STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET
      && residentEnd > BigInt(0)
    ) {
      return { ok: false, reason: "output-overlaps-input" };
    }
    if (
      residentEnd > BigInt(STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES)
    ) {
      return { ok: false, reason: "resident-window-exceeded" };
    }

    const generationBefore = this.runtime.generation;
    if (
      !Number.isSafeInteger(request.expectedGeneration)
      || request.expectedGeneration !== generationBefore
    ) {
      return { ok: false, reason: "stale-generation" };
    }
    if (residentEnd > this.runtime.currentByteLength) {
      return { ok: false, reason: "range-outside-resident-memory" };
    }
    if (this.runtime.generation !== generationBefore) {
      return { ok: false, reason: "stale-generation" };
    }

    const outputView = this.runtime.createByteView(
      BigInt(0),
      STUDIO_WASM_COMPONENT_SCAN_RESULT_BYTES,
    );
    if (!outputView.ok) {
      return {
        ok: false,
        reason: "view-creation-failed",
        viewReason: outputView.reason,
      };
    }
    if (
      outputView.generation !== generationBefore
      || this.runtime.generation !== generationBefore
    ) {
      return { ok: false, reason: "stale-generation" };
    }
    outputView.view.fill(0);

    const addressType = this.runtime.addressType;
    const address = (value: bigint): number | bigint =>
      addressType === "i64" ? value : Number(value);
    let status: number;
    try {
      status = this.scanExport(
        address(request.residentByteOffset),
        address(BigInt(dimensions.width)),
        address(BigInt(dimensions.height)),
        address(BigInt(dimensions.stride)),
        address(BigInt(0)),
      );
    } catch (cause) {
      return { ok: false, reason: "kernel-run-failed", cause };
    }
    if (status !== 0) {
      return { ok: false, reason: "kernel-run-failed" };
    }
    if (this.runtime.generation !== generationBefore) {
      return { ok: false, reason: "stale-generation" };
    }

    const scan = parseKernelOutput(outputView.view, dimensions);
    if (!scan) {
      return { ok: false, reason: "malformed-kernel-output" };
    }
    return {
      ok: true,
      backend: addressType === "i64" ? "wasm64" : "wasm32",
      scan,
      spanBytes: dimensions.spanBytes,
      generation: generationBefore,
    };
  }

  public copyAndScan(
    input: StudioBinaryMaskScanInput,
  ): StudioWasmConnectedComponentsRunResult {
    const dimensions = validateMaskInput(input);
    if (typeof dimensions === "string") {
      return { ok: false, reason: dimensions };
    }
    const requiredByteLength =
      STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET
      + BigInt(dimensions.spanBytes);
    if (
      requiredByteLength
      > BigInt(STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES)
    ) {
      return { ok: false, reason: "resident-window-exceeded" };
    }

    const grow = this.runtime.growToFit(requiredByteLength);
    if (!grow.ok) {
      return {
        ok: false,
        reason: "memory-grow-failed",
        growReason: grow.reason,
      };
    }
    const generation = this.runtime.generation;
    const inputView = this.runtime.createByteView(
      STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET,
      dimensions.spanBytes,
    );
    if (!inputView.ok) {
      return {
        ok: false,
        reason: "view-creation-failed",
        viewReason: inputView.reason,
      };
    }
    if (
      inputView.generation !== generation
      || this.runtime.generation !== generation
    ) {
      return { ok: false, reason: "stale-generation" };
    }
    inputView.view.set(input.mask.subarray(0, dimensions.spanBytes));
    return this.scanResident({
      residentByteOffset: STUDIO_WASM_COMPONENT_SCAN_INPUT_OFFSET,
      width: dimensions.width,
      height: dimensions.height,
      stride: dimensions.stride,
      expectedGeneration: generation,
    });
  }
}

/** Instantiates the matching scan module against the runtime's imported memory. */
export function createStudioWasmConnectedComponentsKernel(
  runtime: StudioWasmLinearMemoryRuntime,
): StudioWasmConnectedComponentsKernelCreationResult {
  if (typeof WebAssembly !== "object") {
    return { ok: false, reason: "webassembly-unavailable" };
  }
  const bytes = buildStudioWasmConnectedComponentsModule(
    runtime.addressType,
  );
  try {
    if (!WebAssembly.validate(bytes)) {
      return { ok: false, reason: "module-validation-failed" };
    }
  } catch (cause) {
    return { ok: false, reason: "module-validation-failed", cause };
  }

  let instance: WebAssembly.Instance;
  try {
    const module = new WebAssembly.Module(bytes);
    instance = new WebAssembly.Instance(module, {
      env: { memory: runtime.memory },
    });
  } catch (cause) {
    return { ok: false, reason: "module-instantiation-failed", cause };
  }
  const scanExport = instance.exports.scan;
  if (typeof scanExport !== "function") {
    return { ok: false, reason: "scan-export-missing" };
  }
  return {
    ok: true,
    kernel: new StudioWasmConnectedComponentsKernel({
      runtime,
      scanExport: scanExport as StudioWasmMaskScanExport,
    }),
  };
}

export interface StudioPersistentBinaryMaskScanner {
  scan(input: StudioBinaryMaskScanInput): StudioPersistentBinaryMaskScanResult;
}

export interface StudioPersistentBinaryMaskScannerOptions {
  /** One backend is selected before this scanner accepts its first input. */
  readonly backend: "js" | "wasm32" | "wasm64";
  /** Test seam for the selected Wasm backend; it never authorizes another backend. */
  readonly createKernel?: () => StudioWasmConnectedComponentsKernelCreationResult;
}

export type StudioPersistentBinaryMaskScanResult =
  | StudioBinaryMaskJsScanResult
  | {
      readonly ok: true;
      readonly backend: "wasm64" | "wasm32";
      readonly scan: StudioBinaryMaskScan;
      readonly spanBytes: number;
      readonly generation: number;
    }
  | {
      readonly ok: false;
      readonly reason:
        | StudioWasmConnectedComponentsKernelCreationFailureReason
        | StudioWasmConnectedComponentsRunFailureReason;
      readonly cause?: unknown;
    };

function createDefaultMaskScanner(
  addressType: StudioWasmAddressType,
): StudioWasmConnectedComponentsKernelCreationResult {
  const maximumPages =
    BigInt(STUDIO_WASM_COMPONENT_SCAN_WINDOW_BYTES)
    / STUDIO_WASM_PAGE_BYTES;
  const runtime = createStudioWasmMemoryRuntime({
    selectedMode: addressType,
    initialPages: BigInt(1),
    maximumPages,
  });
  if (!runtime.ok) {
    return {
      ok: false,
      reason:
        runtime.reason === "webassembly-unavailable"
          ? "webassembly-unavailable"
          : "module-instantiation-failed",
    };
  }
  return createStudioWasmConnectedComponentsKernel(runtime.runtime);
}

/**
 * Persistent, lazy, exact-backend scanner for one Worker epoch. Unsupported or
 * failed Wasm remains terminal for the selected backend; no JS/other-Wasm retry occurs.
 */
export function createStudioPersistentBinaryMaskScanner(
  options: StudioPersistentBinaryMaskScannerOptions,
): StudioPersistentBinaryMaskScanner {
  if (
    options.backend !== "js"
    && options.backend !== "wasm32"
    && options.backend !== "wasm64"
  ) {
    throw new TypeError("A supported connected-components backend must be selected explicitly");
  }
  const addressType: StudioWasmAddressType | null = options.backend === "wasm32"
    ? "i32"
    : options.backend === "wasm64"
      ? "i64"
      : null;
  const kernelFactory = options.createKernel
    ?? (addressType ? () => createDefaultMaskScanner(addressType) : undefined);
  let kernel: StudioWasmConnectedComponentsKernel | undefined;
  let terminalFailure: {
    readonly reason:
      | StudioWasmConnectedComponentsKernelCreationFailureReason
      | StudioWasmConnectedComponentsRunFailureReason;
    readonly cause?: unknown;
  } | null = null;

  return Object.freeze({
    scan(
      input: StudioBinaryMaskScanInput,
    ): StudioPersistentBinaryMaskScanResult {
      const dimensions = validateMaskInput(input);
      if (typeof dimensions === "string") {
        return { ok: false, reason: dimensions };
      }
      if (options.backend === "js") {
        return scanStudioBinaryMaskJs(input);
      }
      if (terminalFailure) return { ok: false, ...terminalFailure };
      if (!kernel) {
        let created: StudioWasmConnectedComponentsKernelCreationResult;
        try {
          created = kernelFactory!();
        } catch (cause) {
          terminalFailure = { reason: "kernel-run-failed", cause };
          return { ok: false, ...terminalFailure };
        }
        if (!created.ok) {
          terminalFailure = {
            reason: created.reason,
            ...(created.cause === undefined ? {} : { cause: created.cause }),
          };
          return { ok: false, ...terminalFailure };
        }
        if (created.kernel.runtime.addressType !== addressType) {
          terminalFailure = { reason: "kernel-run-failed" };
          return { ok: false, ...terminalFailure };
        }
        kernel = created.kernel;
      }
      const result = kernel.copyAndScan(input);
      if (!result.ok) {
        kernel = undefined;
        terminalFailure = {
          reason: result.reason,
          ...(result.cause === undefined ? {} : { cause: result.cause }),
        };
        return { ok: false, ...terminalFailure };
      }
      if (result.backend !== options.backend) {
        kernel = undefined;
        terminalFailure = { reason: "kernel-run-failed" };
        return { ok: false, ...terminalFailure };
      }
      return result;
    },
  });
}
