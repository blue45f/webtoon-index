import {
  createStudioWasmMemoryRuntime,
  STUDIO_WASM_PAGE_BYTES,
  type StudioWasmAddressType,
  type StudioWasmByteViewFailureReason,
  type StudioWasmMemoryGrowFailureReason,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

/**
 * Morphology is deliberately bounded to one 64 MiB resident working set. Large
 * documents must feed tile windows (including a one-pixel halo) instead of
 * materialising a whole mask in linear memory.
 */
export const STUDIO_WASM_MASK_MORPHOLOGY_WORKING_SET_BYTES =
  64 * 1024 * 1024;

const MASK_BUFFER_ALIGNMENT_BYTES = 64;

/**
 * Source and destination coexist in the resident working set. Subtracting one
 * alignment interval before halving makes every aligned destination address fit.
 */
export const STUDIO_WASM_MASK_MORPHOLOGY_MAX_INPUT_BYTES = Math.floor(
  (STUDIO_WASM_MASK_MORPHOLOGY_WORKING_SET_BYTES
    - (MASK_BUFFER_ALIGNMENT_BYTES - 1))
    / 2,
);

export const STUDIO_WASM_MASK_MORPHOLOGY_DEFAULT_MINIMUM_INPUT_BYTES =
  16 * 1024;

const WASM_MAGIC_AND_VERSION = [
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
] as const;
const WASM_I32 = 0x7f;
const WASM_I64 = 0x7e;

export type StudioMaskMorphologyOperation = "dilate" | "erode";
export type StudioMaskByteArray = Uint8Array | Uint8ClampedArray;

export type StudioWasmMaskMorphologyBackend =
  | "wasm-memory64"
  | "wasm-memory32"
  | "js";

export type StudioWasmMaskMorphologyValidationFailureReason =
  | "invalid-mask"
  | "invalid-dimensions"
  | "invalid-operation"
  | "mask-size-mismatch"
  | "input-budget-exceeded";

export type StudioWasmMaskMorphologyRunFailureReason =
  | StudioWasmMaskMorphologyValidationFailureReason
  | "backend-mismatch"
  | "memory-grow-failed"
  | "view-creation-failed"
  | "view-generation-mismatch"
  | "kernel-run-failed";

export type StudioWasmMaskMorphologyRunResult =
  | {
      readonly ok: true;
      readonly pixels: Uint8Array;
      readonly backend: Exclude<StudioWasmMaskMorphologyBackend, "js">;
      readonly generation: number;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmMaskMorphologyRunFailureReason;
      readonly growReason?: StudioWasmMemoryGrowFailureReason;
      readonly viewReason?: StudioWasmByteViewFailureReason;
      readonly cause?: unknown;
    };

export type StudioMaskMorphologyExecutionResult =
  | {
      readonly ok: true;
      readonly pixels: Uint8Array;
      readonly backend: StudioWasmMaskMorphologyBackend;
    }
  | {
      readonly ok: false;
      readonly reason:
        | StudioWasmMaskMorphologyValidationFailureReason
        | StudioWasmMaskMorphologyKernelCreationFailureReason
        | StudioWasmMaskMorphologyRunFailureReason;
      readonly cause?: unknown;
    };

interface ValidatedMaskDimensions {
  readonly width: number;
  readonly height: number;
  readonly byteLength: number;
}

function validateMaskDimensions(
  mask: StudioMaskByteArray,
  width: number,
  height: number,
): ValidatedMaskDimensions | StudioWasmMaskMorphologyValidationFailureReason {
  if (
    !(mask instanceof Uint8Array)
    && !(mask instanceof Uint8ClampedArray)
  ) {
    return "invalid-mask";
  }
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width <= 0
    || height <= 0
  ) {
    return "invalid-dimensions";
  }

  const area = BigInt(width) * BigInt(height);
  if (area !== BigInt(mask.byteLength)) return "mask-size-mismatch";
  if (area > BigInt(STUDIO_WASM_MASK_MORPHOLOGY_MAX_INPUT_BYTES)) {
    return "input-budget-exceeded";
  }
  return { width, height, byteLength: mask.byteLength };
}

function isMorphologyOperation(
  operation: unknown,
): operation is StudioMaskMorphologyOperation {
  return operation === "dilate" || operation === "erode";
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

function createMorphologyFunctionBody(
  addressType: StudioWasmAddressType,
  operation: StudioMaskMorphologyOperation,
): number[] {
  const isMemory64 = addressType === "i64";
  const addressConst = isMemory64 ? 0x42 : 0x41;
  const addressAdd = isMemory64 ? 0x7c : 0x6a;
  const addressSubtract = isMemory64 ? 0x7d : 0x6b;
  const addressMultiply = isMemory64 ? 0x7e : 0x6c;
  const addressLessThanUnsigned = isMemory64 ? 0x54 : 0x49;
  const addressGreaterThanOrEqualUnsigned = isMemory64 ? 0x5a : 0x4f;
  const addressEqual = isMemory64 ? 0x51 : 0x46;
  const pixelComparison = operation === "dilate" ? 0x4b : 0x49;

  const addressConstant = (value: number): number[] => [
    addressConst,
    ...encodeSignedLeb32(value),
  ];
  const localGet = (index: number): number[] => [0x20, ...encodeUnsignedLeb(index)];
  const localSet = (index: number): number[] => [0x21, ...encodeUnsignedLeb(index)];

  // Parameters: src, dst, length, width, height. Locals: index, y, x, best, candidate.
  const INDEX_LOCAL = 5;
  const Y_LOCAL = 6;
  const X_LOCAL = 7;
  const BEST_LOCAL = 8;
  const CANDIDATE_LOCAL = 9;

  const neighborAddress = (
    rowDelta: -1 | 0 | 1,
    columnDelta: -1 | 0 | 1,
  ): number[] => {
    const relativeIndex = [...localGet(INDEX_LOCAL)];
    if (rowDelta < 0) {
      relativeIndex.push(...localGet(3), addressSubtract);
    } else if (rowDelta > 0) {
      relativeIndex.push(...localGet(3), addressAdd);
    }
    if (columnDelta < 0) {
      relativeIndex.push(...addressConstant(1), addressSubtract);
    } else if (columnDelta > 0) {
      relativeIndex.push(...addressConstant(1), addressAdd);
    }
    return [
      ...localGet(0),
      ...relativeIndex,
      addressAdd,
    ];
  };

  const loadNeighbor = (
    rowDelta: -1 | 0 | 1,
    columnDelta: -1 | 0 | 1,
  ): number[] => [
    ...neighborAddress(rowDelta, columnDelta),
    0x2d, 0x00, 0x00, // i32.load8_u align=1 offset=0
  ];

  const updateBest = (
    rowDelta: -1 | 0 | 1,
    columnDelta: -1 | 0 | 1,
  ): number[] => [
    ...loadNeighbor(rowDelta, columnDelta),
    ...localSet(CANDIDATE_LOCAL),
    ...localGet(CANDIDATE_LOCAL),
    ...localGet(BEST_LOCAL),
    ...localGet(CANDIDATE_LOCAL),
    ...localGet(BEST_LOCAL),
    pixelComparison,
    0x1b, // select(candidate, best, comparison)
    ...localSet(BEST_LOCAL),
  ];

  const returnSuccess = [
    0x41, 0x01, // i32.const 1
    0x0f, // return
  ];
  const instructions = [
    // Fail closed if length != width * height.
    ...localGet(2),
    ...localGet(3),
    ...localGet(4),
    addressMultiply,
    addressEqual,
    0x45, // i32.eqz
    0x04, 0x40, // if
    0x41, 0x00, // i32.const 0
    0x0f, // return
    0x0b, // end

    // Width/height below three have no interior; the JS edge pass owns all pixels.
    ...localGet(3),
    ...addressConstant(3),
    addressLessThanUnsigned,
    0x04, 0x40,
    ...returnSuccess,
    0x0b,
    ...localGet(4),
    ...addressConstant(3),
    addressLessThanUnsigned,
    0x04, 0x40,
    ...returnSuccess,
    0x0b,

    ...addressConstant(1),
    ...localSet(Y_LOCAL),
    0x02, 0x40, // block outer_done
    0x03, 0x40, // loop outer
    ...localGet(Y_LOCAL),
    ...localGet(4),
    ...addressConstant(1),
    addressSubtract,
    addressGreaterThanOrEqualUnsigned,
    0x0d, 0x01, // br_if outer_done

    ...addressConstant(1),
    ...localSet(X_LOCAL),
    0x02, 0x40, // block inner_done
    0x03, 0x40, // loop inner
    ...localGet(X_LOCAL),
    ...localGet(3),
    ...addressConstant(1),
    addressSubtract,
    addressGreaterThanOrEqualUnsigned,
    0x0d, 0x01, // br_if inner_done

    ...localGet(Y_LOCAL),
    ...localGet(3),
    addressMultiply,
    ...localGet(X_LOCAL),
    addressAdd,
    ...localSet(INDEX_LOCAL),

    ...loadNeighbor(-1, -1),
    ...localSet(BEST_LOCAL),
    ...updateBest(-1, 0),
    ...updateBest(-1, 1),
    ...updateBest(0, -1),
    ...updateBest(0, 0),
    ...updateBest(0, 1),
    ...updateBest(1, -1),
    ...updateBest(1, 0),
    ...updateBest(1, 1),

    ...localGet(1),
    ...localGet(INDEX_LOCAL),
    addressAdd,
    ...localGet(BEST_LOCAL),
    0x3a, 0x00, 0x00, // i32.store8 align=1 offset=0

    ...localGet(X_LOCAL),
    ...addressConstant(1),
    addressAdd,
    ...localSet(X_LOCAL),
    0x0c, 0x00, // br inner
    0x0b, // end inner
    0x0b, // end inner_done

    ...localGet(Y_LOCAL),
    ...addressConstant(1),
    addressAdd,
    ...localSet(Y_LOCAL),
    0x0c, 0x00, // br outer
    0x0b, // end outer
    0x0b, // end outer_done

    0x41, 0x01, // i32.const 1
    0x0b, // end function
  ];

  const localDeclarations = [
    0x02, // two local groups
    0x03, isMemory64 ? WASM_I64 : WASM_I32,
    0x02, WASM_I32,
  ];
  const body = [...localDeclarations, ...instructions];
  return [...encodeUnsignedLeb(body.length), ...body];
}

/**
 * Builds two byte-oriented kernels with the ABI:
 * `(src, dst, length, width, height) -> success`.
 *
 * In the Memory64 variant every address/dimension parameter is i64, ensuring no
 * accidental i32 truncation in the computation path.
 */
export function buildStudioWasmMaskMorphologyModule(
  addressType: StudioWasmAddressType,
): Uint8Array<ArrayBuffer> {
  const wasmAddressType = addressType === "i64" ? WASM_I64 : WASM_I32;
  const typeSection = encodeSection(1, [
    0x01,
    0x60,
    0x05,
    wasmAddressType,
    wasmAddressType,
    wasmAddressType,
    wasmAddressType,
    wasmAddressType,
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
  const functionSection = encodeSection(3, [
    0x02,
    0x00,
    0x00,
  ]);
  const exportSection = encodeSection(7, [
    0x02,
    ...encodeAsciiName("dilate3x3"),
    0x00,
    0x00,
    ...encodeAsciiName("erode3x3"),
    0x00,
    0x01,
  ]);
  const codeSection = encodeSection(10, [
    0x02,
    ...createMorphologyFunctionBody(addressType, "dilate"),
    ...createMorphologyFunctionBody(addressType, "erode"),
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

function resolvePixel(
  operation: StudioMaskMorphologyOperation,
  current: number,
  candidate: number,
): number {
  return operation === "dilate"
    ? Math.max(current, candidate)
    : Math.min(current, candidate);
}

function calculateReferencePixel(
  mask: StudioMaskByteArray,
  width: number,
  height: number,
  x: number,
  y: number,
  operation: StudioMaskMorphologyOperation,
): number {
  let best = operation === "dilate" ? 0 : 255;
  const top = Math.max(0, y - 1);
  const bottom = Math.min(height - 1, y + 1);
  const left = Math.max(0, x - 1);
  const right = Math.min(width - 1, x + 1);
  for (let neighborY = top; neighborY <= bottom; neighborY += 1) {
    const row = neighborY * width;
    for (let neighborX = left; neighborX <= right; neighborX += 1) {
      best = resolvePixel(
        operation,
        best,
        mask[row + neighborX] ?? best,
      );
    }
  }
  return best;
}

/** Byte-exact in-bounds 3×3 morphology provider for explicitly selected reference/QA runs. */
export function applyStudioMaskMorphology3x3Reference(
  mask: StudioMaskByteArray,
  width: number,
  height: number,
  operation: StudioMaskMorphologyOperation,
): Uint8Array {
  const validated = validateMaskDimensions(mask, width, height);
  if (typeof validated === "string") {
    throw new RangeError(validated);
  }
  if (!isMorphologyOperation(operation)) {
    throw new RangeError("invalid-operation");
  }
  const output = new Uint8Array(validated.byteLength);
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      output[row + x] = calculateReferencePixel(
        mask,
        width,
        height,
        x,
        y,
        operation,
      );
    }
  }
  return output;
}

function applyMorphologyEdges(
  source: StudioMaskByteArray,
  output: Uint8Array,
  width: number,
  height: number,
  operation: StudioMaskMorphologyOperation,
): void {
  for (let x = 0; x < width; x += 1) {
    output[x] = calculateReferencePixel(
      source,
      width,
      height,
      x,
      0,
      operation,
    );
    if (height > 1) {
      const bottomIndex = (height - 1) * width + x;
      output[bottomIndex] = calculateReferencePixel(
        source,
        width,
        height,
        x,
        height - 1,
        operation,
      );
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    output[row] = calculateReferencePixel(
      source,
      width,
      height,
      0,
      y,
      operation,
    );
    if (width > 1) {
      output[row + width - 1] = calculateReferencePixel(
        source,
        width,
        height,
        width - 1,
        y,
        operation,
      );
    }
  }
}

function alignUp(value: bigint, alignment: bigint): bigint {
  const remainder = value % alignment;
  return remainder === BigInt(0)
    ? value
    : value + alignment - remainder;
}

type StudioWasmMorphologyExport = (
  source: number | bigint,
  destination: number | bigint,
  byteLength: number | bigint,
  width: number | bigint,
  height: number | bigint,
) => number;

export type StudioWasmMaskMorphologyKernelCreationFailureReason =
  | "webassembly-unavailable"
  | "module-validation-failed"
  | "module-instantiation-failed"
  | "kernel-export-missing"
  | "memory-runtime-unavailable";

export type StudioWasmMaskMorphologyKernelCreationResult =
  | {
      readonly ok: true;
      readonly kernel: StudioWasmMaskMorphologyKernel;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmMaskMorphologyKernelCreationFailureReason;
      readonly cause?: unknown;
    };

export interface StudioWasmMaskMorphologyKernelLike {
  readonly addressType: StudioWasmAddressType;
  process(
    mask: StudioMaskByteArray,
    width: number,
    height: number,
    operation: StudioMaskMorphologyOperation,
  ): StudioWasmMaskMorphologyRunResult;
}

export type StudioWasmMaskMorphologyKernelFactoryResult =
  | {
      readonly ok: true;
      readonly kernel: StudioWasmMaskMorphologyKernelLike;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmMaskMorphologyKernelCreationFailureReason;
      readonly cause?: unknown;
    };

export class StudioWasmMaskMorphologyKernel
implements StudioWasmMaskMorphologyKernelLike {
  public readonly runtime: StudioWasmLinearMemoryRuntime;

  private readonly dilateExport: StudioWasmMorphologyExport;
  private readonly erodeExport: StudioWasmMorphologyExport;

  public constructor(input: {
    readonly runtime: StudioWasmLinearMemoryRuntime;
    readonly dilateExport: StudioWasmMorphologyExport;
    readonly erodeExport: StudioWasmMorphologyExport;
  }) {
    this.runtime = input.runtime;
    this.dilateExport = input.dilateExport;
    this.erodeExport = input.erodeExport;
  }

  public get addressType(): StudioWasmAddressType {
    return this.runtime.addressType;
  }

  public process(
    mask: StudioMaskByteArray,
    width: number,
    height: number,
    operation: StudioMaskMorphologyOperation,
  ): StudioWasmMaskMorphologyRunResult {
    const validated = validateMaskDimensions(mask, width, height);
    if (typeof validated === "string") {
      return { ok: false, reason: validated };
    }
    if (!isMorphologyOperation(operation)) {
      return { ok: false, reason: "invalid-operation" };
    }

    const byteLengthI64 = BigInt(validated.byteLength);
    const sourceAddress = BigInt(0);
    const destinationAddress = alignUp(
      byteLengthI64,
      BigInt(MASK_BUFFER_ALIGNMENT_BYTES),
    );
    const requiredByteLength = destinationAddress + byteLengthI64;
    if (
      requiredByteLength
      > BigInt(STUDIO_WASM_MASK_MORPHOLOGY_WORKING_SET_BYTES)
    ) {
      return { ok: false, reason: "input-budget-exceeded" };
    }

    const grow = this.runtime.growToFit(requiredByteLength);
    if (!grow.ok) {
      return {
        ok: false,
        reason: "memory-grow-failed",
        growReason: grow.reason,
      };
    }

    const sourceView = this.runtime.createByteView(
      sourceAddress,
      validated.byteLength,
    );
    const destinationView = this.runtime.createByteView(
      destinationAddress,
      validated.byteLength,
    );
    if (!sourceView.ok) {
      return {
        ok: false,
        reason: "view-creation-failed",
        viewReason: sourceView.reason,
      };
    }
    if (!destinationView.ok) {
      return {
        ok: false,
        reason: "view-creation-failed",
        viewReason: destinationView.reason,
      };
    }
    if (sourceView.generation !== destinationView.generation) {
      return { ok: false, reason: "view-generation-mismatch" };
    }

    sourceView.view.set(mask);
    // The kernel owns interior pixels. Seeding the destination keeps the result
    // deterministic before the O(width + height) JS boundary pass.
    destinationView.view.set(mask);

    const selectedExport =
      operation === "dilate" ? this.dilateExport : this.erodeExport;
    let succeeded: number;
    try {
      succeeded =
        this.runtime.addressType === "i64"
          ? selectedExport(
              sourceAddress,
              destinationAddress,
              byteLengthI64,
              BigInt(width),
              BigInt(height),
            )
          : selectedExport(
              Number(sourceAddress),
              Number(destinationAddress),
              validated.byteLength,
              width,
              height,
            );
    } catch (cause) {
      return { ok: false, reason: "kernel-run-failed", cause };
    }
    if (succeeded !== 1) {
      return { ok: false, reason: "kernel-run-failed" };
    }

    // Always reacquire after the call. Future kernels may legitimately grow their
    // imported memory; no pre-call TypedArray is allowed to escape this method.
    const freshOutput = this.runtime.createByteView(
      destinationAddress,
      validated.byteLength,
    );
    if (!freshOutput.ok) {
      return {
        ok: false,
        reason: "view-creation-failed",
        viewReason: freshOutput.reason,
      };
    }
    applyMorphologyEdges(
      mask,
      freshOutput.view,
      width,
      height,
      operation,
    );
    return {
      ok: true,
      pixels: Uint8Array.from(freshOutput.view),
      backend:
        this.runtime.addressType === "i64"
          ? "wasm-memory64"
          : "wasm-memory32",
      generation: freshOutput.generation,
    };
  }
}

export function createStudioWasmMaskMorphologyKernel(
  runtime: StudioWasmLinearMemoryRuntime,
): StudioWasmMaskMorphologyKernelCreationResult {
  if (typeof WebAssembly !== "object") {
    return { ok: false, reason: "webassembly-unavailable" };
  }
  const bytes = buildStudioWasmMaskMorphologyModule(runtime.addressType);
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
  const dilateExport = instance.exports.dilate3x3;
  const erodeExport = instance.exports.erode3x3;
  if (
    typeof dilateExport !== "function"
    || typeof erodeExport !== "function"
  ) {
    return { ok: false, reason: "kernel-export-missing" };
  }
  return {
    ok: true,
    kernel: new StudioWasmMaskMorphologyKernel({
      runtime,
      dilateExport: dilateExport as StudioWasmMorphologyExport,
      erodeExport: erodeExport as StudioWasmMorphologyExport,
    }),
  };
}

function createDefaultKernel(
  addressType: StudioWasmAddressType,
): StudioWasmMaskMorphologyKernelCreationResult {
  const maximumPages =
    BigInt(STUDIO_WASM_MASK_MORPHOLOGY_WORKING_SET_BYTES)
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
          : "memory-runtime-unavailable",
    };
  }
  return createStudioWasmMaskMorphologyKernel(runtime.runtime);
}

export interface StudioPersistentMaskMorphologyExecutor {
  process(
    mask: StudioMaskByteArray,
    width: number,
    height: number,
    operation: StudioMaskMorphologyOperation,
  ): StudioMaskMorphologyExecutionResult;
}

export interface StudioPersistentMaskMorphologyExecutorOptions {
  /** One backend is selected before this executor accepts its first operation. */
  readonly backend: StudioWasmMaskMorphologyBackend;
  /** Test seam for the selected Wasm backend; it is never used to try another backend. */
  readonly createKernel?: () => StudioWasmMaskMorphologyKernelFactoryResult;
}

export function createStudioPersistentMaskMorphologyExecutor(
  options: StudioPersistentMaskMorphologyExecutorOptions,
): StudioPersistentMaskMorphologyExecutor {
  const backend = options.backend;
  if (
    backend !== "js"
    && backend !== "wasm-memory32"
    && backend !== "wasm-memory64"
  ) {
    throw new TypeError("A supported morphology backend must be selected explicitly");
  }
  const addressType: StudioWasmAddressType | null = backend === "wasm-memory32"
    ? "i32"
    : backend === "wasm-memory64"
      ? "i64"
      : null;
  const kernelFactory = options.createKernel
    ?? (addressType ? () => createDefaultKernel(addressType) : undefined);
  let activeKernel: StudioWasmMaskMorphologyKernelLike | undefined;
  let terminalFailure: {
    readonly reason:
      | StudioWasmMaskMorphologyKernelCreationFailureReason
      | StudioWasmMaskMorphologyRunFailureReason;
    readonly cause?: unknown;
  } | null = null;

  return Object.freeze({
    process(
      mask: StudioMaskByteArray,
      width: number,
      height: number,
      operation: StudioMaskMorphologyOperation,
    ): StudioMaskMorphologyExecutionResult {
      const validated = validateMaskDimensions(mask, width, height);
      if (typeof validated === "string") {
        return { ok: false, reason: validated };
      }
      if (!isMorphologyOperation(operation)) {
        return { ok: false, reason: "invalid-operation" };
      }

      if (backend === "js") {
        return {
          ok: true,
          pixels: applyStudioMaskMorphology3x3Reference(
            mask,
            width,
            height,
            operation,
          ),
          backend,
        };
      }
      if (terminalFailure) return { ok: false, ...terminalFailure };
      if (!activeKernel) {
        let created: StudioWasmMaskMorphologyKernelFactoryResult;
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
        if (created.kernel.addressType !== addressType) {
          terminalFailure = { reason: "backend-mismatch" };
          return { ok: false, ...terminalFailure };
        }
        activeKernel = created.kernel;
      }
      const wasmResult = activeKernel.process(
        mask,
        width,
        height,
        operation,
      );
      if (!wasmResult.ok) {
        activeKernel = undefined;
        terminalFailure = {
          reason: wasmResult.reason,
          ...(wasmResult.cause === undefined ? {} : { cause: wasmResult.cause }),
        };
        return { ok: false, ...terminalFailure };
      }
      if (wasmResult.backend !== backend) {
        activeKernel = undefined;
        terminalFailure = { reason: "backend-mismatch" };
        return { ok: false, ...terminalFailure };
      }
      return {
        ok: true,
        pixels: wasmResult.pixels,
        backend: wasmResult.backend,
      };
    },
  });
}
