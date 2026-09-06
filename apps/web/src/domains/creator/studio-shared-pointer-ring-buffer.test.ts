import { describe, expect, it } from "vitest";

import {
  attachStudioSharedPointerRingConsumer,
  attachStudioSharedPointerRingProducer,
  checkStudioSharedPointerRingCapability,
  createStudioSharedPointerRingBuffer,
  STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE,
  STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
  STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
  STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
  STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
  STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS,
  STUDIO_SHARED_POINTER_RING_TRANSPORT_CONTRACT,
  STUDIO_SHARED_POINTER_RING_VERSION,
  type StudioSharedPointerRingDescriptor,
  type StudioSharedPointerRingEnvironment,
  type StudioSharedPointerSample,
  type StudioPointerSampleRole,
} from "./studio-shared-pointer-ring-buffer";

const ISOLATED_ENVIRONMENT: StudioSharedPointerRingEnvironment = {
  crossOriginIsolated: true,
  SharedArrayBuffer,
  Atomics,
};

function createRing(capacity: number) {
  const created = createStudioSharedPointerRingBuffer({
    capacity,
    environment: ISOLATED_ENVIRONMENT,
  });
  if (!created.ok) {
    throw new Error(`Shared pointer ring unavailable: ${created.reason}`);
  }
  const attached = attachStudioSharedPointerRingConsumer(
    structuredClone(created.descriptor),
  );
  if (!attached.ok) {
    throw new Error(`Shared pointer consumer unavailable: ${attached.reason}`);
  }
  return {
    descriptor: created.descriptor,
    producer: created.producer,
    consumer: attached.consumer,
  };
}

function sample(
  sequence: number,
  role: StudioPointerSampleRole =
    sequence % 2 === 0
      ? STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE
      : STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
): StudioSharedPointerSample {
  return {
    x: sequence + 0.25,
    y: sequence * -2.5,
    pressure: (sequence % 11) / 10,
    tiltX: (sequence % 181) - 90,
    tiltY: 90 - (sequence % 181),
    twist: sequence % 360,
    time: 1_000 + sequence / 120,
    pointerId: 7,
    sequence,
    role,
    channel: sequence % 4,
    flags: sequence % 8,
    tangentialPressure: ((sequence % 21) - 10) / 10,
    altitudeAngle: (sequence % 91) / 90 * (Math.PI / 2),
    azimuthAngle: (sequence % 360) / 360 * (Math.PI * 2),
    contactWidth: 1 + sequence % 8,
    contactHeight: 1 + sequence % 6,
  };
}

describe("SharedArrayBuffer pointer ring capability and descriptor", () => {
  it("requires cross-origin isolation, SharedArrayBuffer, and Atomics", () => {
    expect(
      checkStudioSharedPointerRingCapability({
        ...ISOLATED_ENVIRONMENT,
        crossOriginIsolated: false,
      }),
    ).toMatchObject({
      supported: false,
      failureReason: "cross-origin-isolation-required",
    });
    expect(
      checkStudioSharedPointerRingCapability({
        ...ISOLATED_ENVIRONMENT,
        SharedArrayBuffer: null,
      }),
    ).toMatchObject({
      supported: false,
      failureReason: "shared-array-buffer-unavailable",
    });
    expect(
      checkStudioSharedPointerRingCapability({
        ...ISOLATED_ENVIRONMENT,
        Atomics: null,
      }),
    ).toMatchObject({
      supported: false,
      failureReason: "atomics-unavailable",
    });
    expect(
      checkStudioSharedPointerRingCapability(ISOLATED_ENVIRONMENT),
    ).toMatchObject({
      supported: true,
      failureReason: null,
    });
  });

  it("requires a bounded power-of-two capacity", () => {
    expect(
      createStudioSharedPointerRingBuffer({
        capacity: 3,
        environment: ISOLATED_ENVIRONMENT,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-capacity" });
    expect(
      createStudioSharedPointerRingBuffer({
        capacity: 0,
        environment: ISOLATED_ENVIRONMENT,
      }),
    ).toMatchObject({ ok: false, reason: "invalid-capacity" });
  });

  it("produces a clone-safe descriptor whose buffer remains shared", () => {
    const created = createStudioSharedPointerRingBuffer({
      capacity: 8,
      environment: ISOLATED_ENVIRONMENT,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const cloned = structuredClone(created.descriptor);
    expect(cloned).toMatchObject({
      kind: "toonspectrum-studio-pointer-spsc",
      version: STUDIO_SHARED_POINTER_RING_VERSION,
      capacity: 8,
      headerBytes: STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
      sampleFloat64s: STUDIO_SHARED_POINTER_RING_SAMPLE_FLOAT64S,
      sampleBytes: STUDIO_SHARED_POINTER_RING_SAMPLE_BYTES,
    });
    expect(cloned.buffer).toBeInstanceOf(SharedArrayBuffer);
    expect(cloned.buffer.byteLength).toBe(created.descriptor.byteLength);
    expect(STUDIO_SHARED_POINTER_RING_TRANSPORT_CONTRACT).toContain(
      "never include",
    );

    const consumer = attachStudioSharedPointerRingConsumer(cloned);
    expect(consumer.ok).toBe(true);
    expect(created.producer.write(sample(1))).toBe("written");
    if (!consumer.ok) return;
    expect(consumer.consumer.drainToArray()).toEqual([sample(1)]);
  });

  it("enforces one producer and one consumer attachment", () => {
    const { descriptor } = createRing(8);
    expect(
      attachStudioSharedPointerRingProducer(descriptor),
    ).toEqual({ ok: false, reason: "producer-already-attached" });
    expect(
      attachStudioSharedPointerRingConsumer(descriptor),
    ).toEqual({ ok: false, reason: "consumer-already-attached" });
  });

  it("rejects a V1 descriptor instead of decoding it with the V2 stride", () => {
    const created = createStudioSharedPointerRingBuffer({
      capacity: 8,
      environment: ISOLATED_ENVIRONMENT,
    });
    if (!created.ok) throw new Error(created.reason);

    expect(attachStudioSharedPointerRingConsumer({
      ...created.descriptor,
      version: 1,
    })).toEqual({ ok: false, reason: "invalid-descriptor" });
  });
});

describe("SharedArrayBuffer pointer ring ordering", () => {
  it("round-trips extended sensor channels while preserving the V1 positional prefix", () => {
    const { producer, consumer } = createRing(4);
    const current = sample(17, STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE);
    expect(producer.write(current)).toBe("written");

    const prefix: number[] = [];
    const extension: number[] = [];
    expect(consumer.readOne((
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
      prefix.push(
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
      );
      extension.push(
        tangentialPressure,
        altitudeAngle,
        azimuthAngle,
        contactWidth,
        contactHeight,
      );
    })).toBe("read");
    expect(prefix).toEqual([
      current.x,
      current.y,
      current.pressure,
      current.tiltX,
      current.tiltY,
      current.twist,
      current.time,
      current.pointerId,
      current.sequence,
      current.role,
      current.channel,
      current.flags,
    ]);
    expect(extension).toEqual([
      current.tangentialPressure,
      current.altitudeAngle,
      current.azimuthAngle,
      current.contactWidth,
      current.contactHeight,
    ]);
  });

  it("materializes neutral sensor defaults for a source-compatible V1 caller", () => {
    const { producer, consumer } = createRing(4);
    const legacy = sample(4);
    const {
      altitudeAngle: _altitudeAngle,
      azimuthAngle: _azimuthAngle,
      contactHeight: _contactHeight,
      contactWidth: _contactWidth,
      tangentialPressure: _tangentialPressure,
      ...v1
    } = legacy;

    expect(producer.write(v1)).toBe("written");
    expect(consumer.drainToArray()).toEqual([{
      ...v1,
      tangentialPressure: 0,
      altitudeAngle: Math.PI / 2,
      azimuthAngle: 0,
      contactWidth: 1,
      contactHeight: 1,
    }]);
  });

  it("preserves a 120 Hz authoritative/predicted burst without object reads", () => {
    const { producer, consumer } = createRing(256);
    for (let sequence = 0; sequence < 120; sequence += 1) {
      const current = sample(sequence);
      expect(
        producer.writePacked(
          current.x,
          current.y,
          current.pressure,
          current.tiltX,
          current.tiltY,
          current.twist,
          current.time,
          current.pointerId,
          current.sequence,
          current.role,
          current.channel,
          current.flags,
          current.tangentialPressure,
          current.altitudeAngle,
          current.azimuthAngle,
          current.contactWidth,
          current.contactHeight,
        ),
      ).toBe("written");
    }

    const sequences: number[] = [];
    const roles: number[] = [];
    const coordinates: number[] = [];
    const drained = consumer.drain(
      (
        x,
        y,
        _pressure,
        _tiltX,
        _tiltY,
        _twist,
        _time,
        _pointerId,
        sequence,
        role,
      ) => {
        sequences.push(sequence);
        roles.push(role);
        coordinates.push(x, y);
      },
      120,
    );
    expect(drained).toEqual({ read: 120, state: "empty" });
    expect(sequences).toEqual(
      Array.from({ length: 120 }, (_, index) => index),
    );
    expect(roles).toEqual(
      Array.from(
        { length: 120 },
        (_, index) =>
          index % 2 === 0
            ? STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE
            : STUDIO_POINTER_SAMPLE_ROLE_PREDICTED,
      ),
    );
    expect(coordinates.slice(0, 4)).toEqual([
      sample(0).x,
      sample(0).y,
      sample(1).x,
      sample(1).y,
    ]);
    expect(producer.diagnostics()).toMatchObject({
      available: 0,
      dropped: 0,
      highWaterMark: 120,
      writeCounter: 120,
      readCounter: 120,
    });
  });

  it("wraps physical slots while preserving logical sequence order", () => {
    const { producer, consumer } = createRing(4);
    for (let sequence = 0; sequence < 4; sequence += 1) {
      expect(producer.write(sample(sequence))).toBe("written");
    }
    const firstTwo = consumer.drainToArray(2);
    expect(firstTwo.map((entry) => entry.sequence)).toEqual([0, 1]);

    expect(producer.write(sample(4))).toBe("written");
    expect(producer.write(sample(5))).toBe("written");
    expect(
      consumer.drainToArray().map((entry) => entry.sequence),
    ).toEqual([2, 3, 4, 5]);
    expect(producer.diagnostics()).toMatchObject({
      available: 0,
      writeCounter: 6,
      readCounter: 6,
    });
  });

  it("keeps wrap-safe ordering across the unsigned 32-bit counter boundary", () => {
    const { descriptor, producer, consumer } = createRing(4);
    const header = new Int32Array(
      descriptor.buffer,
      0,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES
        / Int32Array.BYTES_PER_ELEMENT,
    );
    // Empty ring with both monotonic counters immediately before u32 wrap.
    Atomics.store(header, 4, 0xffff_fffe | 0);
    Atomics.store(header, 5, 0xffff_fffe | 0);

    expect(producer.write(sample(10))).toBe("written");
    expect(producer.write(sample(11))).toBe("written");
    expect(producer.write(sample(12))).toBe("written");
    expect(
      consumer.drainToArray().map((entry) => entry.sequence),
    ).toEqual([10, 11, 12]);
    expect(producer.diagnostics()).toMatchObject({
      available: 0,
      writeCounter: 1,
      readCounter: 1,
    });
  });

  it("does not advance the authoritative read counter when a visitor throws", () => {
    const { producer, consumer } = createRing(4);
    expect(
      producer.write(
        sample(1, STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE),
      ),
    ).toBe("written");
    expect(
      consumer.readOne(() => {
        throw new Error("render epoch unavailable");
      }),
    ).toBe("visitor-threw");
    expect(consumer.diagnostics().available).toBe(1);
    expect(consumer.drainToArray()).toEqual([
      sample(1, STUDIO_POINTER_SAMPLE_ROLE_AUTHORITATIVE),
    ]);
  });
});

describe("SharedArrayBuffer pointer ring overload and shutdown", () => {
  it("drops only new samples when full and reports overflow diagnostics", () => {
    const { producer, consumer } = createRing(4);
    for (let sequence = 0; sequence < 4; sequence += 1) {
      expect(producer.write(sample(sequence))).toBe("written");
    }
    expect(producer.write(sample(4))).toBe("full");
    expect(producer.write(sample(5))).toBe("full");
    expect(producer.diagnostics()).toMatchObject({
      available: 4,
      free: 0,
      dropped: 2,
      highWaterMark: 4,
    });
    expect(
      consumer.drainToArray().map((entry) => entry.sequence),
    ).toEqual([0, 1, 2, 3]);
  });

  it("rejects malformed samples without publishing a partial slot", () => {
    const { producer, consumer } = createRing(4);
    expect(
      producer.write({
        ...sample(1),
        pressure: Number.NaN,
      }),
    ).toBe("invalid-sample");
    expect(
      producer.write({
        ...sample(2),
        role: 9,
      } as unknown as StudioSharedPointerSample),
    ).toBe("invalid-sample");
    expect(
      producer.write({
        ...sample(3),
        tangentialPressure: 1.1,
      }),
    ).toBe("invalid-sample");
    expect(
      producer.write({
        ...sample(4),
        altitudeAngle: Math.PI,
      }),
    ).toBe("invalid-sample");
    expect(
      producer.write({
        ...sample(5),
        contactWidth:
          STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS.maxContactDimension + 1,
      }),
    ).toBe("invalid-sample");
    expect(
      producer.write({
        ...sample(6),
        time:
          STUDIO_SHARED_POINTER_RING_SENSOR_LIMITS.maxSourceTimeMilliseconds + 1,
      }),
    ).toBe("invalid-sample");
    expect(producer.diagnostics()).toMatchObject({
      available: 0,
      invalidSamples: 6,
    });
    expect(consumer.readOne(() => undefined)).toBe("empty");
  });

  it("publishes close, wakes waiters, and permits the final drain", () => {
    const { producer, consumer } = createRing(4);
    expect(producer.write(sample(1))).toBe("written");
    const wakeBeforeClose = producer.diagnostics().wakeSequence;
    expect(producer.close()).toBe(true);
    expect(producer.close()).toBe(false);
    expect(producer.write(sample(2))).toBe("closed");
    expect(producer.diagnostics()).toMatchObject({
      closed: true,
      wakeSequence: wakeBeforeClose + 1,
    });

    expect(consumer.drainToArray()).toEqual([sample(1)]);
    expect(consumer.readOne(() => undefined)).toBe("closed");
    expect(consumer.waitForData(0)).toBe("closed");
  });

  it("returns immediately for ready data and times out safely when open", () => {
    const { producer, consumer } = createRing(4);
    expect(consumer.waitForData(0)).toBe("timed-out");
    expect(producer.write(sample(1))).toBe("written");
    expect(consumer.waitForData(0)).toBe("ready");
  });
});

describe("SharedArrayBuffer pointer ring malformed descriptor rejection", () => {
  function createDescriptor(): StudioSharedPointerRingDescriptor {
    const created = createStudioSharedPointerRingBuffer({
      capacity: 8,
      environment: ISOLATED_ENVIRONMENT,
    });
    if (!created.ok) throw new Error(created.reason);
    return created.descriptor;
  }

  it("rejects non-descriptors and incompatible metadata", () => {
    expect(
      attachStudioSharedPointerRingConsumer(null),
    ).toEqual({ ok: false, reason: "invalid-descriptor" });
    const descriptor = createDescriptor();
    expect(
      attachStudioSharedPointerRingConsumer({
        ...descriptor,
        capacity: 3,
      }),
    ).toEqual({ ok: false, reason: "invalid-descriptor" });
    expect(
      attachStudioSharedPointerRingConsumer({
        ...descriptor,
        byteLength: descriptor.byteLength + 8,
      }),
    ).toEqual({ ok: false, reason: "byte-length-mismatch" });
    expect(
      attachStudioSharedPointerRingConsumer({
        ...descriptor,
        buffer: new ArrayBuffer(descriptor.byteLength),
      }),
    ).toEqual({ ok: false, reason: "invalid-descriptor" });
  });

  it("rejects a corrupted aligned header", () => {
    const descriptor = createDescriptor();
    const header = new Int32Array(
      descriptor.buffer,
      0,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES
        / Int32Array.BYTES_PER_ELEMENT,
    );
    Atomics.store(header, 0, 0);
    expect(
      attachStudioSharedPointerRingConsumer(descriptor),
    ).toEqual({ ok: false, reason: "header-mismatch" });
  });

  it("rejects counters whose wrap-safe distance exceeds capacity", () => {
    const descriptor = createDescriptor();
    const header = new Int32Array(
      descriptor.buffer,
      0,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES
        / Int32Array.BYTES_PER_ELEMENT,
    );
    // Header contract: write counter index 4, read counter index 5.
    Atomics.store(header, 4, 17);
    Atomics.store(header, 5, 0);
    expect(
      attachStudioSharedPointerRingConsumer(descriptor),
    ).toEqual({ ok: false, reason: "corrupt-counters" });
  });

  it("rejects impossible high-water and attachment claim metadata", () => {
    const descriptor = createDescriptor();
    const header = new Int32Array(
      descriptor.buffer,
      0,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES
        / Int32Array.BYTES_PER_ELEMENT,
    );
    // Header contract: high-water index 9 cannot exceed capacity.
    Atomics.store(header, 9, descriptor.capacity + 1);
    expect(
      attachStudioSharedPointerRingConsumer(descriptor),
    ).toEqual({ ok: false, reason: "corrupt-counters" });
  });

  it("fails closed when a published sample payload is externally corrupted", () => {
    const { descriptor, producer, consumer } = createRing(4);
    expect(producer.write(sample(1))).toBe("written");
    const payload = new Float64Array(
      descriptor.buffer,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
    );
    // Role is Float64 field 9 in the first physical sample.
    payload[9] = 99;
    expect(consumer.readOne(() => undefined)).toBe("corrupt-state");
    expect(consumer.diagnostics()).toMatchObject({
      available: 1,
      corruptStates: 1,
    });
  });

  it("fails closed when an appended V2 sensor field is externally corrupted", () => {
    const { descriptor, producer, consumer } = createRing(4);
    expect(producer.write(sample(1))).toBe("written");
    const payload = new Float64Array(
      descriptor.buffer,
      STUDIO_SHARED_POINTER_RING_HEADER_BYTES,
    );
    // Altitude is appended Float64 field 13 in the V2 record.
    payload[13] = Math.PI;
    expect(consumer.readOne(() => undefined)).toBe("corrupt-state");
    expect(consumer.diagnostics()).toMatchObject({
      available: 1,
      corruptStates: 1,
    });
  });
});
