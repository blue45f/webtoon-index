/**
 * Lock-free single-producer/single-consumer pointer transport.
 *
 * The descriptor is structured-clone safe. SharedArrayBuffer is shared through a
 * normal `postMessage({ descriptor })` payload and MUST NOT be placed in a
 * transfer list: SharedArrayBuffer is shareable, not transferable.
 *
 * Atomics.load/store are sequentially consistent in JavaScript, which is
 * stronger than the acquire/release ordering required here. The producer writes
 * all Float64 fields before publishing WRITE_COUNTER. The consumer acquires that
 * counter before reading a slot and publishes READ_COUNTER only after its
 * visitor returns.
 */

export const STUDIO_SHARED_POINTER_RING_TRANSPORT_CONTRACT =
  "structured-clone the descriptor; never include its SharedArrayBuffer in a transfer list";

/**
 * V2 appends Pointer Events sensor channels after the original twelve-field prefix. Keeping the
 * prefix stable lets an older positional visitor ignore the extension, while the descriptor and
 * aligned header reject a V1-sized buffer instead of decoding it with the wrong stride.
 */
export const STUDIO_SHARED_POINTER_RING_VERSION = 2;
export const STUDIO_SHARED_POINTER_RING_HEADER_BYTES = 64;
export const STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S = 17;
export const STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES =
  STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S * Float64Array.BYTES_PER_ELEMENT;
export const STUDIO_SHARED_POINTER_RING_MIN_CAPACITY = 2;
export const STUDIO_SHARED_POINTER_RING_MAX_CAPACITY = 1 << 20;

const HEADER_I32_LENGTH =
  STUDIO_SHARED_POINTER_RING_HEADER_BYTES / Int32Array.BYTES_PER_ELEMENT;
const HEADER_MAGIC = 0x5453_5052; // "TSPR"

const enum HeaderIndex {
  Magic = 0,
  Version = 1,
  Capacity = 2,
  SampleFloat64s = 3,
  WriteCounter = 4,
  ReadCounter = 5,
  DroppedCount = 6,
  Closed = 7,
  WakeSequence = 8,
  HighWaterMark = 9,
  ProducerClaim = 10,
  ConsumerClaim = 11,
  InvalidSampleCount = 12,
  CorruptStateCount = 13,
  Reserved0 = 14,
  Reserved1 = 15,
}

const enum SampleField {
  X = 0,
  Y = 1,
  Pressure = 2,
  TiltX = 3,
  TiltY = 4,
  Twist = 5,
  Time = 6,
  PointerId = 7,
  Sequence = 8,
  Role = 9,
  Channel = 10,
  Flags = 11,
  TangentialPressure = 12,
  AltitudeAngle = 13,
  AzimuthAngle = 14,
  ContactWidth = 15,
  ContactHeight = 16,
}

export const STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE = 0;
export const STUDIO_POINTER_SAMPLE_ROLE_PREDICTED = 1;
export type StudioPointerSampleRole =
  | typeof STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE
  | typeof STUDIO_POINTER_SAMPLE_ROLE_PREDICTED;

export const STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS = Object.freeze({
  tangentialPressure: 0,
  altitudeAngle: Math.PI / 2,
  azimuthAngle: 0,
  contactWidth: 1,
  contactHeight: 1,
} as const);

export const STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS = Object.freeze({
  maxContactDimension: 65_536,
  maxSourceTimeMilliseconds: Number.MAX_SAFE_INTEGER,
} as const);

export interface StudioSharedPointerSample {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly time: number;
  readonly pointerId: number;
  readonly sequence: number;
  readonly role: StudioPointerSampleRole;
  readonly channel: number;
  readonly flags: number;
  /**
   * Optional for source compatibility with the V1 producer API. V2 storage always materializes
   * normalized Pointer Events defaults when an older caller omits these channels.
   */
  readonly tangentialPressure?: number;
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
  readonly contactWidth?: number;
  readonly contactHeight?: number;
}

/**
 * Positional visitor avoids allocating a sample object in the consumer hot path.
 * `drainToArray` is available when convenience is more important than churn.
 */
export type StudioSharedPointerSampleVisitor = (
  x: number,
  y: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  twist: number,
  time: number,
  pointerId: number,
  sequence: number,
  role: StudioPointerSampleRole,
  channel: number,
  flags: number,
  tangentialPressure: number,
  altitudeAngle: number,
  azimuthAngle: number,
  contactWidth: number,
  contactHeight: number,
) => void;

/**
 * Contains only structured-clone-compatible primitives plus SharedArrayBuffer.
 * It intentionally contains no class instances, functions, TypedArrays or DOM
 * objects.
 */
export interface StudioSharedPointerRingDescriptor {
  readonly kind: "toonspectrum-studio-pointer-spsc";
  readonly version: typeof STUDIO_SHARED_POINTER_RING_VERSION;
  readonly buffer: SharedArrayBuffer;
  readonly byteLength: number;
  readonly headerBytes: typeof STUDIO_SHARED_POINTER_RING_HEADER_BYTES;
  readonly capacity: number;
  readonly sampleFloat64s: typeof STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S;
  readonly sampleBytes: typeof STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES;
}

export interface StudioSharedPointerRingEnvironment {
  readonly crossOriginIsolated?: boolean;
  readonly SharedArrayBuffer?: SharedArrayBufferConstructor | null;
  readonly Atomics?: typeof Atomics | null;
}

export type StudioSharedPointerRingCapabilityFailureReason =
  | "cross-origin-isolation-required"
  | "shared-array-buffer-unavailable"
  | "atomics-unavailable";

export interface StudioSharedPointerRingCapability {
  readonly supported: boolean;
  readonly crossOriginIsolated: boolean;
  readonly sharedArrayBufferAvailable: boolean;
  readonly atomicsAvailable: boolean;
  readonly failureReason: StudioSharedPointerRingCapabilityFailureReason | null;
}

function resolveEnvironment(
  override: StudioSharedPointerRingEnvironment | undefined,
): Required<StudioSharedPointerRingEnvironment> {
  const globals = globalThis as typeof globalThis & {
    crossOriginIsolated?: boolean;
    SharedArrayBuffer?: SharedArrayBufferConstructor;
    Atomics?: typeof Atomics;
  };
  return {
    crossOriginIsolated:
      override?.crossOriginIsolated
      ?? globals.crossOriginIsolated
      ?? false,
    SharedArrayBuffer:
      override && "SharedArrayBuffer" in override
        ? override.SharedArrayBuffer ?? null
        : globals.SharedArrayBuffer ?? null,
    Atomics:
      override && "Atomics" in override
        ? override.Atomics ?? null
        : globals.Atomics ?? null,
  };
}

export function checkStudioSharedPointerRingCapability(
  environment?: StudioSharedPointerRingEnvironment,
): StudioSharedPointerRingCapability {
  const resolved = resolveEnvironment(environment);
  const sharedArrayBufferAvailable =
    typeof resolved.SharedArrayBuffer === "function";
  const atomicsAvailable =
    typeof resolved.Atomics === "object"
    && resolved.Atomics !== null
    && typeof resolved.Atomics.load === "function"
    && typeof resolved.Atomics.store === "function"
    && typeof resolved.Atomics.notify === "function";
  const failureReason =
    !resolved.crossOriginIsolated
      ? "cross-origin-isolation-required"
      : !sharedArrayBufferAvailable
        ? "shared-array-buffer-unavailable"
        : !atomicsAvailable
          ? "atomics-unavailable"
          : null;
  return Object.freeze({
    supported: failureReason === null,
    crossOriginIsolated: resolved.crossOriginIsolated,
    sharedArrayBufferAvailable,
    atomicsAvailable,
    failureReason,
  });
}

export type StudioSharedPointerRingCreationFailureReason =
  | StudioSharedPointerRingCapabilityFailureReason
  | "invalid-capacity"
  | "allocation-failed"
  | "producer-attach-failed";

export type StudioSharedPointerRingCreationResult =
  | {
      readonly ok: true;
      readonly descriptor: StudioSharedPointerRingDescriptor;
      readonly producer: StudioSharedPointerRingProducer;
      readonly capability: StudioSharedPointerRingCapability;
    }
  | {
      readonly ok: false;
      readonly reason: StudioSharedPointerRingCreationFailureReason;
      readonly capability: StudioSharedPointerRingCapability;
      readonly cause?: unknown;
    };

export interface StudioSharedPointerRingCreationOptions {
  readonly capacity: number;
  readonly environment?: StudioSharedPointerRingEnvironment;
}

export type StudioSharedPointerRingAttachFailureReason =
  | "shared-array-buffer-unavailable"
  | "invalid-descriptor"
  | "byte-length-mismatch"
  | "header-mismatch"
  | "corrupt-counters"
  | "producer-already-attached"
  | "consumer-already-attached";

export type StudioSharedPointerProducerAttachResult =
  | {
      readonly ok: true;
      readonly producer: StudioSharedPointerRingProducer;
    }
  | {
      readonly ok: false;
      readonly reason: StudioSharedPointerRingAttachFailureReason;
    };

export type StudioSharedPointerConsumerAttachResult =
  | {
      readonly ok: true;
      readonly consumer: StudioSharedPointerRingConsumer;
    }
  | {
      readonly ok: false;
      readonly reason: StudioSharedPointerRingAttachFailureReason;
    };

interface StudioAttachedPointerRing {
  readonly descriptor: StudioSharedPointerRingDescriptor;
  readonly header: Int32Array;
  readonly samples: Float64Array;
  readonly capacityMask: number;
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function isValidCapacity(value: number): boolean {
  return (
    Number.isSafeInteger(value)
    && value >= STUDIO_SHARED_POINTER_RING_MIN_CAPACITY
    && value <= STUDIO_SHARED_POINTER_RING_MAX_CAPACITY
    && isPowerOfTwo(value)
  );
}

function byteLengthForCapacity(capacity: number): number {
  return (
    STUDIO_SHARED_POINTER_RING_HEADER_BYTES
    + capacity * STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES
  );
}

function unsignedCounter(value: number): number {
  return value >>> 0;
}

/** Wrap-safe while the producer never gets more than capacity ahead. */
function counterDistance(newer: number, older: number): number {
  return (newer - older) >>> 0;
}

function isSharedArrayBufferValue(
  value: unknown,
): value is SharedArrayBuffer {
  const constructor = (
    globalThis as typeof globalThis & {
      SharedArrayBuffer?: SharedArrayBufferConstructor;
    }
  ).SharedArrayBuffer;
  return (
    typeof constructor === "function"
    && value instanceof constructor
  );
}

function attachCommon(
  descriptor: unknown,
): StudioAttachedPointerRing | StudioSharedPointerRingAttachFailureReason {
  if (typeof SharedArrayBuffer !== "function") {
    return "shared-array-buffer-unavailable";
  }
  if (typeof descriptor !== "object" || descriptor === null) {
    return "invalid-descriptor";
  }
  const candidate = descriptor as Partial<StudioSharedPointerRingDescriptor>;
  if (
    candidate.kind !== "toonspectrum-studio-pointer-spsc"
    || candidate.version !== STUDIO_SHARED_POINTER_RING_VERSION
    || candidate.headerBytes !== STUDIO_SHARED_POINTER_RING_HEADER_BYTES
    || candidate.sampleFloat64s
      !== STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S
    || candidate.sampleBytes !== STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES
    || !isValidCapacity(candidate.capacity ?? Number.NaN)
    || !Number.isSafeInteger(candidate.byteLength)
  ) {
    return "invalid-descriptor";
  }
  if (!isSharedArrayBufferValue(candidate.buffer)) {
    return "invalid-descriptor";
  }

  const capacity = candidate.capacity as number;
  const expectedByteLength = byteLengthForCapacity(capacity);
  if (
    candidate.byteLength !== expectedByteLength
    || candidate.buffer.byteLength !== expectedByteLength
  ) {
    return "byte-length-mismatch";
  }

  let header: Int32Array;
  let samples: Float64Array;
  try {
    header = new Int32Array(
      candidate.buffer,
      0,
      HEADER_I32_LENGTH,
    );
    samples = new Float64Array(
      candidate.buffer,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
      capacity * STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
    );
  } catch {
    return "invalid-descriptor";
  }
  if (
    unsignedCounter(Atomics.load(header, HeaderIndex.Magic)) !== HEADER_MAGIC
    || Atomics.load(header, HeaderIndex.Version)
      !== STUDIO_SHARED_POINTER_RING_VERSION
    || Atomics.load(header, HeaderIndex.Capacity) !== capacity
    || Atomics.load(header, HeaderIndex.SampleFloat64s)
      !== STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S
    || Atomics.load(header, HeaderIndex.Reserved0) !== 0
    || Atomics.load(header, HeaderIndex.Reserved1) !== 0
  ) {
    return "header-mismatch";
  }
  const writeCounter = unsignedCounter(
    Atomics.load(header, HeaderIndex.WriteCounter),
  );
  const readCounter = unsignedCounter(
    Atomics.load(header, HeaderIndex.ReadCounter),
  );
  const closed = Atomics.load(header, HeaderIndex.Closed);
  const highWaterMark = unsignedCounter(
    Atomics.load(header, HeaderIndex.HighWaterMark),
  );
  const producerClaim = Atomics.load(
    header,
    HeaderIndex.ProducerClaim,
  );
  const consumerClaim = Atomics.load(
    header,
    HeaderIndex.ConsumerClaim,
  );
  if (
    counterDistance(writeCounter, readCounter) > capacity
    || (closed !== 0 && closed !== 1)
    || highWaterMark > capacity
    || (producerClaim !== 0 && producerClaim !== 1)
    || (consumerClaim !== 0 && consumerClaim !== 1)
  ) {
    return "corrupt-counters";
  }

  return {
    descriptor: candidate as StudioSharedPointerRingDescriptor,
    header,
    samples,
    capacityMask: capacity - 1,
  };
}

function updateHighWaterMark(header: Int32Array, value: number): void {
  let previous = unsignedCounter(
    Atomics.load(header, HeaderIndex.HighWaterMark),
  );
  while (value > previous) {
    const exchanged = unsignedCounter(
      Atomics.compareExchange(
        header,
        HeaderIndex.HighWaterMark,
        previous | 0,
        value | 0,
      ),
    );
    if (exchanged === previous) return;
    previous = exchanged;
  }
}

function incrementUnsigned(header: Int32Array, index: HeaderIndex): void {
  Atomics.add(header, index, 1);
}

function isUint32(value: number): boolean {
  return (
    Number.isSafeInteger(value)
    && value >= 0
    && value <= 0xffff_ffff
  );
}

function isValidPackedSample(
  x: number,
  y: number,
  pressure: number,
  tiltX: number,
  tiltY: number,
  twist: number,
  time: number,
  pointerId: number,
  sequence: number,
  role: number,
  channel: number,
  flags: number,
  tangentialPressure: number,
  altitudeAngle: number,
  azimuthAngle: number,
  contactWidth: number,
  contactHeight: number,
): role is StudioPointerSampleRole {
  return (
    Number.isFinite(x)
    && Number.isFinite(y)
    && Number.isFinite(pressure)
    && pressure >= 0
    && pressure <= 1
    && Number.isFinite(tiltX)
    && tiltX >= -90
    && tiltX <= 90
    && Number.isFinite(tiltY)
    && tiltY >= -90
    && tiltY <= 90
    && Number.isFinite(twist)
    && twist >= 0
    && twist < 360
    && Number.isFinite(time)
    && time >= 0
    && time <= STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS.maxSourceTimeMilliseconds
    && Number.isSafeInteger(pointerId)
    && pointerId >= 0
    && Number.isSafeInteger(sequence)
    && sequence >= 0
    && (
      role === STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE
      || role === STUDIO_POINTER_SAMPLE_ROLE_PREDICTED
    )
    && isUint32(channel)
    && isUint32(flags)
    && Number.isFinite(tangentialPressure)
    && tangentialPressure >= -1
    && tangentialPressure <= 1
    && Number.isFinite(altitudeAngle)
    && altitudeAngle >= 0
    && altitudeAngle <= Math.PI / 2
    && Number.isFinite(azimuthAngle)
    && azimuthAngle >= 0
    && azimuthAngle < Math.PI * 2
    && Number.isFinite(contactWidth)
    && contactWidth >= 0
    && contactWidth
      <= STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS.maxContactDimension
    && Number.isFinite(contactHeight)
    && contactHeight >= 0
    && contactHeight
      <= STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS.maxContactDimension
  );
}

export type StudioSharedPointerWriteResult =
  | "written"
  | "full"
  | "closed"
  | "invalid-sample"
  | "corrupt-state";

export interface StudioSharedPointerRingDiagnostics {
  readonly capacity: number;
  readonly available: number;
  readonly free: number;
  readonly dropped: number;
  readonly invalidSamples: number;
  readonly corruptStates: number;
  readonly highWaterMark: number;
  readonly wakeSequence: number;
  readonly closed: boolean;
  readonly writeCounter: number;
  readonly readCounter: number;
}

function readDiagnostics(
  ring: StudioAttachedPointerRing,
): StudioSharedPointerRingDiagnostics {
  const writeCounter = unsignedCounter(
    Atomics.load(ring.header, HeaderIndex.WriteCounter),
  );
  const readCounter = unsignedCounter(
    Atomics.load(ring.header, HeaderIndex.ReadCounter),
  );
  const rawAvailable = counterDistance(writeCounter, readCounter);
  const available =
    rawAvailable <= ring.descriptor.capacity ? rawAvailable : 0;
  return Object.freeze({
    capacity: ring.descriptor.capacity,
    available,
    free: ring.descriptor.capacity - available,
    dropped: unsignedCounter(
      Atomics.load(ring.header, HeaderIndex.DroppedCount),
    ),
    invalidSamples: unsignedCounter(
      Atomics.load(ring.header, HeaderIndex.InvalidSampleCount),
    ),
    corruptStates: unsignedCounter(
      Atomics.load(ring.header, HeaderIndex.CorruptStateCount),
    ),
    highWaterMark: unsignedCounter(
      Atomics.load(ring.header, HeaderIndex.HighWaterMark),
    ),
    wakeSequence: unsignedCounter(
      Atomics.load(ring.header, HeaderIndex.WakeSequence),
    ),
    closed: Atomics.load(ring.header, HeaderIndex.Closed) === 1,
    writeCounter,
    readCounter,
  });
}

export class StudioSharedPointerRingProducer {
  public readonly descriptor: StudioSharedPointerRingDescriptor;

  private readonly ring: StudioAttachedPointerRing;

  public constructor(ring: StudioAttachedPointerRing) {
    this.ring = ring;
    this.descriptor = ring.descriptor;
  }

  public write(sample: StudioSharedPointerSample): StudioSharedPointerWriteResult {
    if (typeof sample !== "object" || sample === null) {
      incrementUnsigned(this.ring.header, HeaderIndex.InvalidSampleCount);
      return "invalid-sample";
    }
    return this.writePacked(
      sample.x,
      sample.y,
      sample.pressure,
      sample.tiltX,
      sample.tiltY,
      sample.twist,
      sample.time,
      sample.pointerId,
      sample.sequence,
      sample.role,
      sample.channel,
      sample.flags,
      sample.tangentialPressure
        ?? STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.tangentialPressure,
      sample.altitudeAngle
        ?? STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.altitudeAngle,
      sample.azimuthAngle
        ?? STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.azimuthAngle,
      sample.contactWidth
        ?? STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.contactWidth,
      sample.contactHeight
        ?? STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.contactHeight,
    );
  }

  /**
   * Allocation-free producer entry point. The write counter is published only
   * after the complete V2 Float64 record has been stored.
   *
   * Extended channels are trailing optional arguments so legacy V1 callers remain source
   * compatible. A V2 descriptor and stride still prevent binary layout confusion.
   */
  public writePacked(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    twist: number,
    time: number,
    pointerId: number,
    sequence: number,
    role: StudioPointerSampleRole,
    channel: number,
    flags: number,
    tangentialPressure: number =
      STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.tangentialPressure,
    altitudeAngle: number = STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.altitudeAngle,
    azimuthAngle: number = STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.azimuthAngle,
    contactWidth: number = STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.contactWidth,
    contactHeight: number = STUDIO_SHARED_POINTER_RING_SENSOR_DEFAULTS.contactHeight,
  ): StudioSharedPointerWriteResult {
    const { header, samples, descriptor, capacityMask } = this.ring;
    if (
      !isValidPackedSample(
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        twist,
        time,
        pointerId,
        sequence,
        role,
        channel,
        flags,
        tangentialPressure,
        altitudeAngle,
        azimuthAngle,
        contactWidth,
        contactHeight,
      )
    ) {
      incrementUnsigned(header, HeaderIndex.InvalidSampleCount);
      return "invalid-sample";
    }
    if (Atomics.load(header, HeaderIndex.Closed) !== 0) {
      return "closed";
    }

    const writeCounter = unsignedCounter(
      Atomics.load(header, HeaderIndex.WriteCounter),
    );
    const readCounter = unsignedCounter(
      Atomics.load(header, HeaderIndex.ReadCounter),
    );
    const available = counterDistance(writeCounter, readCounter);
    if (available > descriptor.capacity) {
      incrementUnsigned(header, HeaderIndex.CorruptStateCount);
      return "corrupt-state";
    }
    if (available === descriptor.capacity) {
      incrementUnsigned(header, HeaderIndex.DroppedCount);
      return "full";
    }

    const slot = writeCounter & capacityMask;
    const offset = slot * STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S;
    samples[offset + SampleField.X] = x;
    samples[offset + SampleField.Y] = y;
    samples[offset + SampleField.Pressure] = pressure;
    samples[offset + SampleField.TiltX] = tiltX;
    samples[offset + SampleField.TiltY] = tiltY;
    samples[offset + SampleField.Twist] = twist;
    samples[offset + SampleField.Time] = time;
    samples[offset + SampleField.PointerId] = pointerId;
    samples[offset + SampleField.Sequence] = sequence;
    samples[offset + SampleField.Role] = role;
    samples[offset + SampleField.Channel] = channel;
    samples[offset + SampleField.Flags] = flags;
    samples[offset + SampleField.TangentialPressure] = tangentialPressure;
    samples[offset + SampleField.AltitudeAngle] = altitudeAngle;
    samples[offset + SampleField.AzimuthAngle] = azimuthAngle;
    samples[offset + SampleField.ContactWidth] = contactWidth;
    samples[offset + SampleField.ContactHeight] = contactHeight;

    const nextWriteCounter = (writeCounter + 1) >>> 0;
    Atomics.store(
      header,
      HeaderIndex.WriteCounter,
      nextWriteCounter | 0,
    );
    updateHighWaterMark(header, available + 1);
    incrementUnsigned(header, HeaderIndex.WakeSequence);
    Atomics.notify(header, HeaderIndex.WakeSequence, 1);
    return "written";
  }

  public close(): boolean {
    const didClose =
      Atomics.compareExchange(
        this.ring.header,
        HeaderIndex.Closed,
        0,
        1,
      ) === 0;
    if (didClose) {
      incrementUnsigned(this.ring.header, HeaderIndex.WakeSequence);
      Atomics.notify(
        this.ring.header,
        HeaderIndex.WakeSequence,
        Number.POSITIVE_INFINITY,
      );
    }
    return didClose;
  }

  public diagnostics(): StudioSharedPointerRingDiagnostics {
    return readDiagnostics(this.ring);
  }
}

export type StudioSharedPointerReadResult =
  | "read"
  | "empty"
  | "closed"
  | "visitor-threw"
  | "corrupt-state";

export interface StudioSharedPointerDrainResult {
  readonly read: number;
  readonly state: Exclude<StudioSharedPointerReadResult, "read"> | "ready";
}

export type StudioSharedPointerWaitResult =
  | "ready"
  | "closed"
  | "timed-out"
  | "not-equal"
  | "wait-unsupported"
  | "corrupt-state";

export class StudioSharedPointerRingConsumer {
  public readonly descriptor: StudioSharedPointerRingDescriptor;

  private readonly ring: StudioAttachedPointerRing;

  public constructor(ring: StudioAttachedPointerRing) {
    this.ring = ring;
    this.descriptor = ring.descriptor;
  }

  /**
   * Allocation-free consumer entry point. If the visitor throws, the read
   * counter is intentionally not advanced so the authoritative sample is not
   * silently lost.
   */
  public readOne(
    visitor: StudioSharedPointerSampleVisitor,
  ): StudioSharedPointerReadResult {
    if (typeof visitor !== "function") return "visitor-threw";
    const { header, samples, descriptor, capacityMask } = this.ring;
    const readCounter = unsignedCounter(
      Atomics.load(header, HeaderIndex.ReadCounter),
    );
    const writeCounter = unsignedCounter(
      Atomics.load(header, HeaderIndex.WriteCounter),
    );
    const available = counterDistance(writeCounter, readCounter);
    if (available > descriptor.capacity) {
      incrementUnsigned(header, HeaderIndex.CorruptStateCount);
      return "corrupt-state";
    }
    if (available === 0) {
      return Atomics.load(header, HeaderIndex.Closed) === 1
        ? "closed"
        : "empty";
    }

    const slot = readCounter & capacityMask;
    const offset = slot * STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S;
    const x = samples[offset + SampleField.X] as number;
    const y = samples[offset + SampleField.Y] as number;
    const pressure = samples[offset + SampleField.Pressure] as number;
    const tiltX = samples[offset + SampleField.TiltX] as number;
    const tiltY = samples[offset + SampleField.TiltY] as number;
    const twist = samples[offset + SampleField.Twist] as number;
    const time = samples[offset + SampleField.Time] as number;
    const pointerId = samples[offset + SampleField.PointerId] as number;
    const sequence = samples[offset + SampleField.Sequence] as number;
    const role = samples[offset + SampleField.Role] as number;
    const channel = samples[offset + SampleField.Channel] as number;
    const flags = samples[offset + SampleField.Flags] as number;
    const tangentialPressure =
      samples[offset + SampleField.TangentialPressure] as number;
    const altitudeAngle = samples[offset + SampleField.AltitudeAngle] as number;
    const azimuthAngle = samples[offset + SampleField.AzimuthAngle] as number;
    const contactWidth = samples[offset + SampleField.ContactWidth] as number;
    const contactHeight = samples[offset + SampleField.ContactHeight] as number;
    if (
      !isValidPackedSample(
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        twist,
        time,
        pointerId,
        sequence,
        role,
        channel,
        flags,
        tangentialPressure,
        altitudeAngle,
        azimuthAngle,
        contactWidth,
        contactHeight,
      )
    ) {
      incrementUnsigned(header, HeaderIndex.CorruptStateCount);
      return "corrupt-state";
    }
    try {
      visitor(
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        twist,
        time,
        pointerId,
        sequence,
        role,
        channel,
        flags,
        tangentialPressure,
        altitudeAngle,
        azimuthAngle,
        contactWidth,
        contactHeight,
      );
    } catch {
      return "visitor-threw";
    }
    Atomics.store(
      header,
      HeaderIndex.ReadCounter,
      ((readCounter + 1) >>> 0) | 0,
    );
    return "read";
  }

  public drain(
    visitor: StudioSharedPointerSampleVisitor,
    maximumSamples = this.descriptor.capacity,
  ): StudioSharedPointerDrainResult {
    if (
      typeof visitor !== "function"
      || !Number.isSafeInteger(maximumSamples)
      || maximumSamples < 0
      || maximumSamples > this.descriptor.capacity
    ) {
      return { read: 0, state: "visitor-threw" };
    }
    let read = 0;
    while (read < maximumSamples) {
      const result = this.readOne(visitor);
      if (result !== "read") return { read, state: result };
      read += 1;
    }
    const diagnostics = this.diagnostics();
    if (diagnostics.available > 0) return { read, state: "ready" };
    return {
      read,
      state: diagnostics.closed ? "closed" : "empty",
    };
  }

  /** Convenient allocating API for diagnostics, tools and tests. */
  public drainToArray(
    maximumSamples = this.descriptor.capacity,
  ): readonly StudioSharedPointerSample[] {
    const samples: StudioSharedPointerSample[] = [];
    this.drain(
      (
        x,
        y,
        pressure,
        tiltX,
        tiltY,
        twist,
        time,
        pointerId,
        sequence,
        role,
        channel,
        flags,
        tangentialPressure,
        altitudeAngle,
        azimuthAngle,
        contactWidth,
        contactHeight,
      ) => {
        samples.push({
          x,
          y,
          pressure,
          tiltX,
          tiltY,
          twist,
          time,
          pointerId,
          sequence,
          role,
          channel,
          flags,
          tangentialPressure,
          altitudeAngle,
          azimuthAngle,
          contactWidth,
          contactHeight,
        });
      },
      maximumSamples,
    );
    return samples;
  }

  /**
   * Worker-only blocking wait. Browsers reject Atomics.wait on the main thread;
   * that case returns `wait-unsupported` instead of throwing.
   */
  public waitForData(timeoutMilliseconds = Number.POSITIVE_INFINITY):
    StudioSharedPointerWaitResult {
    if (
      timeoutMilliseconds !== Number.POSITIVE_INFINITY
      && (
        !Number.isFinite(timeoutMilliseconds)
        || timeoutMilliseconds < 0
      )
    ) {
      return "wait-unsupported";
    }
    const before = this.diagnostics();
    if (before.available > 0) return "ready";
    if (before.corruptStates > 0) return "corrupt-state";
    if (before.closed) return "closed";

    const expected = Atomics.load(
      this.ring.header,
      HeaderIndex.WakeSequence,
    );
    let waitResult: "ok" | "not-equal" | "timed-out";
    try {
      waitResult = Atomics.wait(
        this.ring.header,
        HeaderIndex.WakeSequence,
        expected,
        timeoutMilliseconds,
      );
    } catch {
      return "wait-unsupported";
    }
    const after = this.diagnostics();
    if (after.available > 0) return "ready";
    if (after.corruptStates > 0) return "corrupt-state";
    if (after.closed) return "closed";
    return waitResult === "ok" ? "not-equal" : waitResult;
  }

  public diagnostics(): StudioSharedPointerRingDiagnostics {
    return readDiagnostics(this.ring);
  }
}

export function attachStudioSharedPointerRingProducer(
  descriptor: unknown,
): StudioSharedPointerProducerAttachResult {
  const ring = attachCommon(descriptor);
  if (typeof ring === "string") return { ok: false, reason: ring };
  if (
    Atomics.compareExchange(
      ring.header,
      HeaderIndex.ProducerClaim,
      0,
      1,
    ) !== 0
  ) {
    return { ok: false, reason: "producer-already-attached" };
  }
  return {
    ok: true,
    producer: new StudioSharedPointerRingProducer(ring),
  };
}

export function attachStudioSharedPointerRingConsumer(
  descriptor: unknown,
): StudioSharedPointerConsumerAttachResult {
  const ring = attachCommon(descriptor);
  if (typeof ring === "string") return { ok: false, reason: ring };
  if (
    Atomics.compareExchange(
      ring.header,
      HeaderIndex.ConsumerClaim,
      0,
      1,
    ) !== 0
  ) {
    return { ok: false, reason: "consumer-already-attached" };
  }
  return {
    ok: true,
    consumer: new StudioSharedPointerRingConsumer(ring),
  };
}

export function createStudioSharedPointerRingBuffer(
  options: StudioSharedPointerRingCreationOptions,
): StudioSharedPointerRingCreationResult {
  const capability = checkStudioSharedPointerRingCapability(
    options.environment,
  );
  if (!capability.supported) {
    return {
      ok: false,
      reason: capability.failureReason
        ?? "shared-array-buffer-unavailable",
      capability,
    };
  }
  if (!isValidCapacity(options.capacity)) {
    return { ok: false, reason: "invalid-capacity", capability };
  }

  const environment = resolveEnvironment(options.environment);
  let buffer: SharedArrayBuffer;
  try {
    const SharedBuffer = environment.SharedArrayBuffer;
    if (!SharedBuffer) {
      return {
        ok: false,
        reason: "shared-array-buffer-unavailable",
        capability,
      };
    }
    buffer = new SharedBuffer(byteLengthForCapacity(options.capacity));
  } catch (cause) {
    return { ok: false, reason: "allocation-failed", capability, cause };
  }

  const header = new Int32Array(buffer, 0, HEADER_I32_LENGTH);
  header.fill(0);
  Atomics.store(header, HeaderIndex.Magic, HEADER_MAGIC | 0);
  Atomics.store(
    header,
    HeaderIndex.Version,
    STUDIO_SHARED_POINTER_RING_VERSION,
  );
  Atomics.store(header, HeaderIndex.Capacity, options.capacity);
  Atomics.store(
    header,
    HeaderIndex.SampleFloat64s,
    STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
  );

  const descriptor: StudioSharedPointerRingDescriptor = Object.freeze({
    kind: "toonspectrum-studio-pointer-spsc",
    version: STUDIO_SHARED_POINTER_RING_VERSION,
    buffer,
    byteLength: buffer.byteLength,
    headerBytes: STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
    capacity: options.capacity,
    sampleFloat64s: STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
    sampleBytes: STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
  });
  const attached = attachStudioSharedPointerRingProducer(descriptor);
  if (!attached.ok) {
    return {
      ok: false,
      reason: "producer-attach-failed",
      capability,
    };
  }
  return {
    ok: true,
    descriptor,
    producer: attached.producer,
    capability,
  };
}
