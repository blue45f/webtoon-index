import { describe, expect, it } from "vitest";

import {
  encodeStudioLiveInkSamples,
  hashStudioLiveInkPayloads,
} from "./studio-live-ink-codec";
import {
  createStudioLiveInkWireMessage,
  isStudioLiveInkWireCandidate,
  parseStudioLiveInkMessage,
  parseStudioLiveInkWireMessage,
  STUDIO_LIVE_INK_MAX_ACTIVE_STROKES,
  STUDIO_LIVE_INK_MAX_SAMPLES_PER_CHUNK,
  STUDIO_LIVE_INK_MAX_SAMPLES_PER_PREDICTION,
  STUDIO_LIVE_INK_PROTOCOL_VERSION,
  STUDIO_LIVE_INK_SAMPLE_SCHEMA,
  STUDIO_LIVE_INK_WIRE,
  STUDIO_LIVE_INK_WIRE_VERSION,
  StudioLiveInkProtocolError,
  StudioLiveInkStrokeTracker,
  type StudioLiveInkBegin,
  type StudioLiveInkChunk,
  type StudioLiveInkEnd,
  type StudioLiveInkMessage,
  type StudioLiveInkPrediction,
} from "./studio-live-ink-protocol";

function payloadOf(count: number): ArrayBuffer {
  return encodeStudioLiveInkSamples(
    Array.from({ length: count }, (_, index) => ({
      x: index * 4,
      y: index * 2,
      pressure: 0.5,
      timeDeltaMs: 8,
    }))
  );
}

function begin(overrides: Partial<StudioLiveInkBegin> = {}): StudioLiveInkBegin {
  return {
    kind: "ink:begin",
    protocolVersion: STUDIO_LIVE_INK_PROTOCOL_VERSION,
    strokeId: "stroke-1",
    pageId: "page-1",
    layerId: "layer-1",
    coordinateSpaceId: "space-a4",
    coordinateSpaceRevision: 3,
    provider: {
      providerId: "vello-hybrid",
      providerVersion: "1.4.0",
      buildHash: "9f2c11ab",
    },
    brushPresetId: "brush-gpen",
    brushContractHash: "c0ffee42",
    seed: 1_234_567,
    mode: "pen",
    blendMode: "multiply",
    color: "#112233",
    width: 12.5,
    opacity: 0.85,
    sampleSchema: STUDIO_LIVE_INK_SAMPLE_SCHEMA,
    startedAt: 1_000_000,
    ...overrides,
  };
}

function chunk(overrides: Partial<StudioLiveInkChunk> = {}): StudioLiveInkChunk {
  const sampleCount = overrides.sampleCount ?? 4;
  return {
    kind: "ink:chunk",
    strokeId: "stroke-1",
    chunkSequence: 1,
    firstSampleIndex: 0,
    sampleCount,
    payload: payloadOf(sampleCount),
    ...overrides,
  };
}

function prediction(
  overrides: Partial<StudioLiveInkPrediction> = {}
): StudioLiveInkPrediction {
  const sampleCount = overrides.sampleCount ?? 3;
  return {
    kind: "ink:prediction",
    strokeId: "stroke-1",
    predictionSequence: 1,
    replacesFromSampleIndex: 0,
    expiresAt: 1_000_200,
    sampleCount,
    payload: payloadOf(sampleCount),
    ...overrides,
  };
}

function end(overrides: Partial<StudioLiveInkEnd> = {}): StudioLiveInkEnd {
  return {
    kind: "ink:end",
    strokeId: "stroke-1",
    lastChunkSequence: 1,
    totalActualSamples: 4,
    sampleHash: hashStudioLiveInkPayloads([payloadOf(4)]),
    crdtStrokeId: "crdt-stroke-1",
    ...overrides,
  };
}

describe("parseStudioLiveInkMessage", () => {
  it("accepts each well-formed lifecycle message", () => {
    expect(parseStudioLiveInkMessage(begin())).toEqual(begin());
    const validChunk = chunk();
    expect(parseStudioLiveInkMessage(validChunk)).toBe(validChunk);
    expect(parseStudioLiveInkMessage(prediction())).not.toBeNull();
    expect(parseStudioLiveInkMessage(end())).toEqual(end());
    expect(
      parseStudioLiveInkMessage({ kind: "ink:cancel", strokeId: "stroke-1", reason: "user" })
    ).not.toBeNull();
  });

  it("rejects a begin outside the V2 contract", () => {
    expect(parseStudioLiveInkMessage(begin({ protocolVersion: 1 as never }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ sampleSchema: "ink-v1" as never }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ strokeId: " padded " }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ strokeId: "s".repeat(161) }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ seed: -1 }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ seed: 2 ** 32 }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ opacity: 1.2 }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ width: 0 }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ blendMode: "plasma" as never }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ color: "url(evil)" }))).toBeNull();
    expect(parseStudioLiveInkMessage(begin({ mode: "marker" as never }))).toBeNull();
    expect(
      parseStudioLiveInkMessage(
        begin({ provider: { providerId: "p", providerVersion: "1", buildHash: "" } })
      )
    ).toBeNull();
    expect(
      parseStudioLiveInkMessage({ ...begin(), extra: true } as unknown)
    ).toBeNull();
  });

  it("rejects chunk payloads that disagree with their declared shape", () => {
    expect(parseStudioLiveInkMessage(chunk({ sampleCount: 0 }))).toBeNull();
    expect(
      parseStudioLiveInkMessage(
        chunk({ sampleCount: STUDIO_LIVE_INK_MAX_SAMPLES_PER_CHUNK + 1 })
      )
    ).toBeNull();
    // Declared count differs from the binary header count.
    expect(parseStudioLiveInkMessage(chunk({ payload: payloadOf(5) }))).toBeNull();
    expect(parseStudioLiveInkMessage(chunk({ payload: new ArrayBuffer(3) }))).toBeNull();
    expect(
      parseStudioLiveInkMessage(chunk({ payload: "AAAA" as unknown as ArrayBuffer }))
    ).toBeNull();
    expect(parseStudioLiveInkMessage(chunk({ chunkSequence: 0 }))).toBeNull();
    expect(parseStudioLiveInkMessage(chunk({ firstSampleIndex: -1 }))).toBeNull();
    expect(parseStudioLiveInkMessage(chunk({ firstSampleIndex: 99_998, sampleCount: 4 }))).toBeNull();
  });

  it("rejects malformed predictions and ends", () => {
    expect(parseStudioLiveInkMessage(prediction({ predictionSequence: 0 }))).toBeNull();
    expect(parseStudioLiveInkMessage(prediction({ expiresAt: -5 }))).toBeNull();
    expect(
      parseStudioLiveInkMessage(
        prediction({ sampleCount: STUDIO_LIVE_INK_MAX_SAMPLES_PER_PREDICTION + 1 })
      )
    ).toBeNull();
    expect(parseStudioLiveInkMessage(end({ sampleHash: "sha1:abcd" }))).toBeNull();
    expect(parseStudioLiveInkMessage(end({ totalActualSamples: 100_001 }))).toBeNull();
    expect(
      parseStudioLiveInkMessage({ kind: "ink:cancel", strokeId: "s", reason: "meteor" })
    ).toBeNull();
    expect(parseStudioLiveInkMessage({ kind: "ink:noop" })).toBeNull();
    expect(parseStudioLiveInkMessage(null)).toBeNull();
  });
});

describe("studio-live-ink wire frames", () => {
  const wireInput = {
    workId: "work-1",
    senderSessionId: "session-alice",
    sentAt: 1_000_000,
  };

  it("creates, routes and re-parses a frame deterministically", () => {
    const wire = createStudioLiveInkWireMessage({ ...wireInput, message: begin() });
    expect(wire.wire).toBe(STUDIO_LIVE_INK_WIRE);
    expect(wire.wireVersion).toBe(STUDIO_LIVE_INK_WIRE_VERSION);
    expect(isStudioLiveInkWireCandidate(wire)).toBe(true);
    expect(isStudioLiveInkWireCandidate({ kind: "cursor:update" })).toBe(false);
    expect(
      parseStudioLiveInkWireMessage(wire, { expectedWorkId: "work-1", now: 1_000_000 })
    ).toEqual(wire);
  });

  it("throws loud on authoring bugs instead of sending a broken frame", () => {
    expect(() =>
      createStudioLiveInkWireMessage({
        ...wireInput,
        message: begin({ opacity: 2 }),
      })
    ).toThrow(StudioLiveInkProtocolError);
    expect(() =>
      createStudioLiveInkWireMessage({ ...wireInput, workId: " bad ", message: begin() })
    ).toThrow(StudioLiveInkProtocolError);
  });

  it("drops cross-work, self-echoed, stale and future frames", () => {
    const wire = createStudioLiveInkWireMessage({ ...wireInput, message: begin() });
    expect(
      parseStudioLiveInkWireMessage(wire, { expectedWorkId: "work-2", now: 1_000_000 })
    ).toBeNull();
    expect(
      parseStudioLiveInkWireMessage(wire, {
        expectedWorkId: "work-1",
        selfSessionId: "session-alice",
        now: 1_000_000,
      })
    ).toBeNull();
    expect(
      parseStudioLiveInkWireMessage(wire, { expectedWorkId: "work-1", now: 1_031_000 })
    ).toBeNull();
    expect(
      parseStudioLiveInkWireMessage(wire, { expectedWorkId: "work-1", now: 990_000 })
    ).toBeNull();
    expect(
      parseStudioLiveInkWireMessage(
        { ...wire, message: chunk({ chunkSequence: 0 }) },
        { expectedWorkId: "work-1", now: 1_000_000 }
      )
    ).toBeNull();
    expect(
      parseStudioLiveInkWireMessage(
        { ...wire, extra: 1 } as unknown,
        { expectedWorkId: "work-1", now: 1_000_000 }
      )
    ).toBeNull();
  });
});

describe("StudioLiveInkStrokeTracker", () => {
  function accept(tracker: StudioLiveInkStrokeTracker, message: StudioLiveInkMessage): boolean {
    return tracker.accept(message);
  }

  it("enforces the begin → chunk(+1, contiguous) → end lifecycle", () => {
    const tracker = new StudioLiveInkStrokeTracker();
    expect(accept(tracker, chunk())).toBe(false);
    expect(accept(tracker, begin())).toBe(true);
    expect(accept(tracker, begin())).toBe(false);
    expect(accept(tracker, chunk({ chunkSequence: 2 }))).toBe(false);
    expect(accept(tracker, chunk())).toBe(true);
    // Replays and sample-index gaps both fail closed.
    expect(accept(tracker, chunk())).toBe(false);
    expect(accept(tracker, chunk({ chunkSequence: 2, firstSampleIndex: 3 }))).toBe(false);
    expect(accept(tracker, chunk({ chunkSequence: 2, firstSampleIndex: 4 }))).toBe(true);
    expect(accept(tracker, end({ lastChunkSequence: 1, totalActualSamples: 4 }))).toBe(false);
    expect(accept(tracker, end({ lastChunkSequence: 2, totalActualSamples: 9 }))).toBe(false);
    expect(accept(tracker, end({ lastChunkSequence: 2, totalActualSamples: 8 }))).toBe(true);
    // A settled stroke id can never be reused.
    expect(accept(tracker, begin())).toBe(false);
    expect(accept(tracker, chunk({ chunkSequence: 3, firstSampleIndex: 8 }))).toBe(false);
  });

  it("lets predictions skip sequences but never rewind or outrun actuals", () => {
    const tracker = new StudioLiveInkStrokeTracker();
    expect(accept(tracker, begin())).toBe(true);
    expect(accept(tracker, chunk())).toBe(true);
    expect(accept(tracker, prediction({ predictionSequence: 2 }))).toBe(true);
    expect(accept(tracker, prediction({ predictionSequence: 2 }))).toBe(false);
    expect(accept(tracker, prediction({ predictionSequence: 1 }))).toBe(false);
    // Gaps are legal — droppable predictions may simply never arrive.
    expect(accept(tracker, prediction({ predictionSequence: 9, replacesFromSampleIndex: 4 }))).toBe(
      true
    );
    expect(
      accept(tracker, prediction({ predictionSequence: 10, replacesFromSampleIndex: 5 }))
    ).toBe(false);
  });

  it("caps concurrent strokes and releases them through cancel", () => {
    const tracker = new StudioLiveInkStrokeTracker();
    for (let index = 0; index < STUDIO_LIVE_INK_MAX_ACTIVE_STROKES; index += 1) {
      expect(accept(tracker, begin({ strokeId: `stroke-${index}` }))).toBe(true);
    }
    expect(accept(tracker, begin({ strokeId: "stroke-overflow" }))).toBe(false);
    expect(tracker.activeStrokeCount).toBe(STUDIO_LIVE_INK_MAX_ACTIVE_STROKES);
    expect(accept(tracker, { kind: "ink:cancel", strokeId: "stroke-0", reason: "user" })).toBe(
      true
    );
    expect(accept(tracker, { kind: "ink:cancel", strokeId: "stroke-0", reason: "user" })).toBe(
      false
    );
    expect(accept(tracker, begin({ strokeId: "stroke-after-cancel" }))).toBe(true);
    expect(accept(tracker, { kind: "ink:cancel", strokeId: "stroke-unknown", reason: "user" })).toBe(
      false
    );
  });
});
