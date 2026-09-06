import { calculateStudioCrc32 } from "../studio-crc32";
import { STUDIO_CRC32_WORKER_MAX_BYTES } from "../studio-crc32-worker-protocol";
import {
  createStudioWasmMemoryRuntime,
  STUDIO_WASM_PAGE_BYTES,
  type StudioWasmAddressType,
  type StudioWasmByteViewFailureReason,
  type StudioWasmMemoryGrowFailureReason,
  StudioWasmLinearMemoryRuntime,
} from "../studio-wasm64-memory-governor";

/** Small payloads remain in the already-hot JS table loop to avoid copy/call overhead. */
export const STUDIO_WASM_CRC32_MINIMUM_INPUT_BYTES = 1024 * 1024;

/** The first KiB of the dedicated linear memory stores the reflected CRC table. */
export const STUDIO_WASM_CRC32_INPUT_OFFSET = BigInt(256 * 4);

const WASM_MAGIC_AND_VERSION = [
  0x00, 0x61, 0x73, 0x6d,
  0x01, 0x00, 0x00, 0x00,
] as const;
const WASM_I32 = 0x7f;
const WASM_I64 = 0x7e;
const CRC32_POLYNOMIAL = 0xedb8_8320;

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

function createCrc32TableBytes(): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value =
        (value & 1) === 1
          ? CRC32_POLYNOMIAL ^ (value >>> 1)
          : value >>> 1;
    }
    const unsigned = value >>> 0;
    bytes.push(
      unsigned & 0xff,
      (unsigned >>> 8) & 0xff,
      (unsigned >>> 16) & 0xff,
      (unsigned >>> 24) & 0xff,
    );
  }
  return bytes;
}

function createCrc32FunctionBody(
  addressType: StudioWasmAddressType,
): number[] {
  const isMemory64 = addressType === "i64";
  const addressEqz = isMemory64 ? 0x50 : 0x45;
  const addressConst = isMemory64 ? 0x42 : 0x41;
  const addressAdd = isMemory64 ? 0x7c : 0x6a;
  const addressSubtract = isMemory64 ? 0x7d : 0x6b;
  const tableAddress = isMemory64
    ? [
        0xad, // i64.extend_i32_u
        0x42, ...encodeSignedLeb32(2), // i64.const 2
        0x86, // i64.shl
      ]
    : [
        0x41, ...encodeSignedLeb32(2), // i32.const 2
        0x74, // i32.shl
      ];

  const instructions = [
    0x41, ...encodeSignedLeb32(-1), // i32.const -1
    0x21, 0x02, // local.set crc
    0x02, 0x40, // block
    0x03, 0x40, // loop
    0x20, 0x01, // local.get length
    addressEqz,
    0x0d, 0x01, // br_if block

    0x20, 0x02, // local.get crc
    0x41, ...encodeSignedLeb32(8),
    0x76, // i32.shr_u

    0x20, 0x02, // local.get crc
    0x20, 0x00, // local.get pointer
    0x2d, 0x00, 0x00, // i32.load8_u align=1 offset=0
    0x73, // i32.xor
    0x41, ...encodeSignedLeb32(0xff),
    0x71, // i32.and
    ...tableAddress,
    0x28, 0x02, 0x00, // i32.load align=4 offset=0
    0x73, // i32.xor
    0x21, 0x02, // local.set crc

    0x20, 0x00, // local.get pointer
    addressConst, ...encodeSignedLeb32(1),
    addressAdd,
    0x21, 0x00, // local.set pointer
    0x20, 0x01, // local.get length
    addressConst, ...encodeSignedLeb32(1),
    addressSubtract,
    0x21, 0x01, // local.set length
    0x0c, 0x00, // br loop
    0x0b, // end loop
    0x0b, // end block
    0x20, 0x02, // local.get crc
    0x41, ...encodeSignedLeb32(-1),
    0x73, // i32.xor
    0x0b, // end function
  ];

  const localDeclarations = [
    0x01, // one local group
    0x01, WASM_I32, // one i32 crc local
  ];
  const body = [...localDeclarations, ...instructions];
  return [...encodeUnsignedLeb(body.length), ...body];
}

/**
 * Builds the same table-driven CRC32 kernel for i32- and i64-addressed memory.
 * No WAT compiler, bundler plug-in, or external binary artifact is required.
 */
export function buildStudioWasmCrc32Module(
  addressType: StudioWasmAddressType,
): Uint8Array<ArrayBuffer> {
  const wasmAddressType = addressType === "i64" ? WASM_I64 : WASM_I32;
  const typeSection = encodeSection(1, [
    0x01, // one type
    0x60, // function
    0x02, wasmAddressType, wasmAddressType,
    0x01, WASM_I32,
  ]);
  const importSection = encodeSection(2, [
    0x01,
    ...encodeAsciiName("env"),
    ...encodeAsciiName("memory"),
    0x02, // memory import
    addressType === "i64" ? 0x04 : 0x00, // memory64/no max or memory32/no max
    ...encodeUnsignedLeb(BigInt(1)),
  ]);
  const functionSection = encodeSection(3, [
    0x01,
    0x00, // type index zero
  ]);
  const exportSection = encodeSection(7, [
    0x01,
    ...encodeAsciiName("crc32"),
    0x00, // function export
    0x00,
  ]);
  const codeSection = encodeSection(10, [
    0x01,
    ...createCrc32FunctionBody(addressType),
  ]);
  const tableBytes = createCrc32TableBytes();
  const offsetExpression =
    addressType === "i64"
      ? [0x42, 0x00, 0x0b] // i64.const 0; end
      : [0x41, 0x00, 0x0b]; // i32.const 0; end
  const dataSection = encodeSection(11, [
    0x01,
    0x00, // active segment for memory zero
    ...offsetExpression,
    ...encodeUnsignedLeb(tableBytes.length),
    ...tableBytes,
  ]);

  return new Uint8Array([
    ...WASM_MAGIC_AND_VERSION,
    ...typeSection,
    ...importSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
    ...dataSection,
  ]);
}

type StudioWasmCrc32Export = (
  pointer: number | bigint,
  byteLength: number | bigint,
) => number;

export type StudioWasmCrc32KernelCreationFailureReason =
  | "webassembly-unavailable"
  | "module-validation-failed"
  | "module-instantiation-failed"
  | "crc32-export-missing";

export type StudioWasmCrc32KernelCreationResult =
  | {
      readonly ok: true;
      readonly kernel: StudioWasmCrc32Kernel;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmCrc32KernelCreationFailureReason;
      readonly cause?: unknown;
    };

export type StudioWasmCrc32RunFailureReason =
  | "invalid-range"
  | "input-budget-exceeded"
  | "memory-grow-failed"
  | "view-creation-failed"
  | "kernel-run-failed";

export type StudioWasmCrc32RunResult =
  | {
      readonly ok: true;
      readonly crc32: number;
      readonly generation: number;
    }
  | {
      readonly ok: false;
      readonly reason: StudioWasmCrc32RunFailureReason;
      readonly growReason?: StudioWasmMemoryGrowFailureReason;
      readonly viewReason?: StudioWasmByteViewFailureReason;
      readonly cause?: unknown;
    };

export interface StudioWasmCrc32KernelLike {
  copyAndCalculate(bytes: Uint8Array): StudioWasmCrc32RunResult;
}

function toNonNegativeSafeBigInt(value: number | bigint): bigint | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return BigInt(value);
  }
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return value;
}

export class StudioWasmCrc32Kernel implements StudioWasmCrc32KernelLike {
  public readonly runtime: StudioWasmLinearMemoryRuntime;

  private readonly crc32Export: StudioWasmCrc32Export;

  public constructor(input: {
    readonly runtime: StudioWasmLinearMemoryRuntime;
    readonly crc32Export: StudioWasmCrc32Export;
  }) {
    this.runtime = input.runtime;
    this.crc32Export = input.crc32Export;
  }

  public calculateResident(
    residentByteOffset: number | bigint,
    byteLength: number | bigint,
  ): StudioWasmCrc32RunResult {
    const offset = toNonNegativeSafeBigInt(residentByteOffset);
    const length = toNonNegativeSafeBigInt(byteLength);
    if (
      offset === null
      || length === null
      || offset < STUDIO_WASM_CRC32_INPUT_OFFSET
      || offset + length > this.runtime.currentByteLength
    ) {
      return { ok: false, reason: "invalid-range" };
    }

    try {
      const result =
        this.runtime.addressType === "i64"
          ? this.crc32Export(offset, length)
          : this.crc32Export(Number(offset), Number(length));
      if (!Number.isInteger(result)) {
        return { ok: false, reason: "kernel-run-failed" };
      }
      return {
        ok: true,
        crc32: result >>> 0,
        generation: this.runtime.generation,
      };
    } catch (cause) {
      return { ok: false, reason: "kernel-run-failed", cause };
    }
  }

  public copyAndCalculate(
    bytes: Uint8Array,
  ): StudioWasmCrc32RunResult {
    if (!(bytes instanceof Uint8Array)) {
      return { ok: false, reason: "invalid-range" };
    }
    if (bytes.byteLength > STUDIO_CRC32_WORKER_MAX_BYTES) {
      return { ok: false, reason: "input-budget-exceeded" };
    }

    const requiredBytes =
      STUDIO_WASM_CRC32_INPUT_OFFSET + BigInt(bytes.byteLength);
    const grow = this.runtime.growToFit(requiredBytes);
    if (!grow.ok) {
      return {
        ok: false,
        reason: "memory-grow-failed",
        growReason: grow.reason,
      };
    }
    const freshView = this.runtime.createByteView(
      STUDIO_WASM_CRC32_INPUT_OFFSET,
      bytes.byteLength,
    );
    if (!freshView.ok) {
      return {
        ok: false,
        reason: "view-creation-failed",
        viewReason: freshView.reason,
      };
    }
    freshView.view.set(bytes);
    return this.calculateResident(
      STUDIO_WASM_CRC32_INPUT_OFFSET,
      bytes.byteLength,
    );
  }
}

/** Instantiates the matching module against the runtime's actual imported memory. */
export function createStudioWasmCrc32Kernel(
  runtime: StudioWasmLinearMemoryRuntime,
): StudioWasmCrc32KernelCreationResult {
  if (typeof WebAssembly !== "object") {
    return { ok: false, reason: "webassembly-unavailable" };
  }
  const bytes = buildStudioWasmCrc32Module(runtime.addressType);
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
  const crc32Export = instance.exports.crc32;
  if (typeof crc32Export !== "function") {
    return { ok: false, reason: "crc32-export-missing" };
  }
  return {
    ok: true,
    kernel: new StudioWasmCrc32Kernel({
      runtime,
      crc32Export: crc32Export as StudioWasmCrc32Export,
    }),
  };
}

export interface StudioPersistentCrc32Executor {
  calculate(bytes: Uint8Array): number;
}

export interface StudioPersistentCrc32ExecutorOptions {
  readonly minimumWasmBytes?: number;
  readonly createKernel?: () => StudioWasmCrc32KernelCreationResult;
}

export type StudioPersistentCrc32UnavailableStage = "initialization" | "run";

/**
 * Terminal failure for the preselected Memory64 CRC provider. The Worker may report this failure
 * to its caller, but it must not recompute the same bytes with the JavaScript reference kernel.
 */
export class StudioPersistentCrc32UnavailableError extends Error {
  readonly stage: StudioPersistentCrc32UnavailableStage;
  readonly reason:
    | StudioWasmCrc32KernelCreationFailureReason
    | StudioWasmCrc32RunFailureReason;
  override readonly cause?: unknown;

  constructor(input: {
    readonly stage: StudioPersistentCrc32UnavailableStage;
    readonly reason:
      | StudioWasmCrc32KernelCreationFailureReason
      | StudioWasmCrc32RunFailureReason;
    readonly cause?: unknown;
  }) {
    super(`Selected Memory64 CRC32 provider is unavailable (${input.stage}:${input.reason}).`);
    this.name = "StudioPersistentCrc32UnavailableError";
    this.stage = input.stage;
    this.reason = input.reason;
    this.cause = input.cause;
  }
}

function createDefaultMemory64Kernel(): StudioWasmCrc32KernelCreationResult {
  const requiredBytes =
    STUDIO_WASM_CRC32_INPUT_OFFSET
    + BigInt(STUDIO_CRC32_WORKER_MAX_BYTES);
  const maximumPages =
    (requiredBytes + STUDIO_WASM_PAGE_BYTES - BigInt(1))
    / STUDIO_WASM_PAGE_BYTES;
  const runtime = createStudioWasmMemoryRuntime({
    selectedMode: "i64",
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
  return createStudioWasmCrc32Kernel(runtime.runtime);
}

/**
 * Persistent, lazy executor used by the CRC Worker. Input size selects the provider before any
 * work begins: small inputs use the JS reference, while large inputs use Memory64 WASM. A large
 * operation's unsupported/init/run failure is terminal and never re-executes those bytes in JS.
 */
export function createStudioPersistentCrc32Executor(
  options: StudioPersistentCrc32ExecutorOptions = {},
): StudioPersistentCrc32Executor {
  const minimumWasmBytes =
    options.minimumWasmBytes ?? STUDIO_WASM_CRC32_MINIMUM_INPUT_BYTES;
  if (
    !Number.isSafeInteger(minimumWasmBytes)
    || minimumWasmBytes < 0
    || minimumWasmBytes > STUDIO_CRC32_WORKER_MAX_BYTES
  ) {
    throw new RangeError("minimumWasmBytes is outside the CRC32 protocol budget");
  }
  const kernelFactory = options.createKernel ?? createDefaultMemory64Kernel;
  let kernel: StudioWasmCrc32KernelLike | undefined;
  let unavailable: StudioPersistentCrc32UnavailableError | null = null;

  return Object.freeze({
    calculate(bytes: Uint8Array): number {
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError("CRC32 input must be Uint8Array");
      }
      if (bytes.byteLength > STUDIO_CRC32_WORKER_MAX_BYTES) {
        throw new RangeError("CRC32 input exceeds the Worker protocol budget");
      }
      if (bytes.byteLength < minimumWasmBytes) {
        return calculateStudioCrc32(bytes);
      }

      if (unavailable) throw unavailable;
      if (kernel === undefined) {
        const created = kernelFactory();
        if (!created.ok) {
          unavailable = new StudioPersistentCrc32UnavailableError({
            stage: "initialization",
            reason: created.reason,
            cause: created.cause,
          });
          throw unavailable;
        }
        kernel = created.kernel;
      }
      const result = kernel.copyAndCalculate(bytes);
      if (result.ok) return result.crc32;
      unavailable = new StudioPersistentCrc32UnavailableError({
        stage: "run",
        reason: result.reason,
        cause: result.cause,
      });
      kernel = undefined;
      throw unavailable;
    },
  });
}
