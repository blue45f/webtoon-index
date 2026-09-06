import { describe, expect, it } from "vitest";

import {
  decodeStudioLiveInkSamples,
  encodeStudioLiveInkSamples,
  hashStudioLiveInkPayloads,
  STUDIO_LIVE_INK_CHANNEL_MASK_ALL,
  STUDIO_LIVE_INK_CHANNELS,
  STUDIO_LIVE_INK_CODEC_FORMAT_VERSION,
  STUDIO_LIVE_INK_CODEC_HEADER_BYTES,
  STUDIO_LIVE_INK_QUANTIZATION,
  StudioLiveInkCodecError,
  studioLiveInkChannelMaskForSample,
  studioLiveInkSampleStride,
  type StudioLiveInkSample,
} from "./studio-live-ink-codec";

function fullSample(index: number): StudioLiveInkSample {
  return {
    x: 128.5 + index,
    y: -64.25 + index,
    pressure: 0.62,
    tiltX: -33.51,
    tiltY: 12.07,
    twist: 271.33,
    tangentialPressure: -0.4321,
    altitude: 47.9,
    azimuth: 359.99,
    contactW: 3.125,
    contactH: 2.5,
    timeDeltaMs: 8,
    flags: 0b101,
  };
}

describe("studio-live-ink-codec", () => {
  it("round-trips every channel exactly within its quantization step", () => {
    const samples = [fullSample(0), fullSample(1), fullSample(2)];
    const encoded = encodeStudioLiveInkSamples(samples);
    const decoded = decodeStudioLiveInkSamples(encoded);

    expect(decoded.channelMask).toBe(STUDIO_LIVE_INK_CHANNEL_MASK_ALL);
    expect(decoded.samples).toHaveLength(samples.length);
    const { angleScale, pressureSteps, tangentialScale, contactScale } =
      STUDIO_LIVE_INK_QUANTIZATION;
    decoded.samples.forEach((decodedSample, index) => {
      const original = samples[index]!;
      expect(decodedSample.x).toBe(Math.fround(original.x));
      expect(decodedSample.y).toBe(Math.fround(original.y));
      expect(Math.abs(decodedSample.pressure! - original.pressure!)).toBeLessThanOrEqual(
        0.5 / pressureSteps
      );
      expect(Math.abs(decodedSample.tiltX! - original.tiltX!)).toBeLessThanOrEqual(
        0.5 / angleScale
      );
      expect(Math.abs(decodedSample.tiltY! - original.tiltY!)).toBeLessThanOrEqual(
        0.5 / angleScale
      );
      expect(Math.abs(decodedSample.twist! - original.twist!)).toBeLessThanOrEqual(
        0.5 / angleScale
      );
      expect(
        Math.abs(decodedSample.tangentialPressure! - original.tangentialPressure!)
      ).toBeLessThanOrEqual(0.5 / tangentialScale);
      expect(Math.abs(decodedSample.altitude! - original.altitude!)).toBeLessThanOrEqual(
        0.5 / angleScale
      );
      expect(Math.abs(decodedSample.azimuth! - original.azimuth!)).toBeLessThanOrEqual(
        0.5 / angleScale
      );
      expect(Math.abs(decodedSample.contactW! - original.contactW!)).toBeLessThanOrEqual(
        0.5 / contactScale
      );
      expect(Math.abs(decodedSample.contactH! - original.contactH!)).toBeLessThanOrEqual(
        0.5 / contactScale
      );
      expect(decodedSample.timeDeltaMs).toBe(original.timeDeltaMs);
      expect(decodedSample.flags).toBe(original.flags);
    });
  });

  it("is deterministic: re-encoding a decoded batch reproduces identical bytes", () => {
    const samples = [fullSample(0), fullSample(7)];
    const first = encodeStudioLiveInkSamples(samples);
    const second = encodeStudioLiveInkSamples(samples);
    const reencoded = encodeStudioLiveInkSamples(decodeStudioLiveInkSamples(first).samples);

    expect(new Uint8Array(second)).toEqual(new Uint8Array(first));
    expect(new Uint8Array(reencoded)).toEqual(new Uint8Array(first));
  });

  it("packs only the channels named by the feature bitmask", () => {
    const minimal: StudioLiveInkSample[] = [
      { x: 1, y: 2, pressure: 0.25, timeDeltaMs: 4 },
      { x: 3, y: 4, pressure: 1, timeDeltaMs: 0 },
    ];
    const mask =
      STUDIO_LIVE_INK_CHANNELS.pressure | STUDIO_LIVE_INK_CHANNELS.timeDelta;
    const encoded = encodeStudioLiveInkSamples(minimal);
    const decoded = decodeStudioLiveInkSamples(encoded);

    expect(studioLiveInkChannelMaskForSample(minimal[0]!)).toBe(mask);
    expect(studioLiveInkSampleStride(mask)).toBe(12);
    expect(encoded.byteLength).toBe(STUDIO_LIVE_INK_CODEC_HEADER_BYTES + 12 * minimal.length);
    expect(decoded.channelMask).toBe(mask);
    expect(decoded.samples[0]).toMatchObject({ x: 1, y: 2, timeDeltaMs: 4 });
    expect(decoded.samples[0]!.pressure).toBeCloseTo(0.25, 4);
    expect(decoded.samples[1]!.tiltX).toBeUndefined();
    expect(decoded.samples[1]!.flags).toBeUndefined();
  });

  it("supports the position-only mask for providers without stylus telemetry", () => {
    const encoded = encodeStudioLiveInkSamples([{ x: -12.5, y: 900 }]);
    const decoded = decodeStudioLiveInkSamples(encoded);
    expect(decoded.channelMask).toBe(0);
    expect(encoded.byteLength).toBe(STUDIO_LIVE_INK_CODEC_HEADER_BYTES + 8);
    expect(decoded.samples).toEqual([{ x: -12.5, y: 900 }]);
  });

  it("fails closed on out-of-range or non-finite encoder input", () => {
    expect(() => encodeStudioLiveInkSamples([{ x: Number.NaN, y: 0 }])).toThrow(
      StudioLiveInkCodecError
    );
    expect(() => encodeStudioLiveInkSamples([{ x: 0, y: Number.POSITIVE_INFINITY }])).toThrow(
      StudioLiveInkCodecError
    );
    expect(() => encodeStudioLiveInkSamples([{ x: 0, y: 0, pressure: 1.01 }])).toThrow(
      StudioLiveInkCodecError
    );
    expect(() => encodeStudioLiveInkSamples([{ x: 0, y: 0, pressure: -0.01 }])).toThrow(
      StudioLiveInkCodecError
    );
    expect(() =>
      encodeStudioLiveInkSamples([{ x: 0, y: 0, tiltX: 90.5, tiltY: 0 }])
    ).toThrow(StudioLiveInkCodecError);
    expect(() => encodeStudioLiveInkSamples([{ x: 0, y: 0, twist: 359.5 }])).toThrow(
      StudioLiveInkCodecError
    );
    expect(() => encodeStudioLiveInkSamples([{ x: 0, y: 0, timeDeltaMs: -1 }])).toThrow(
      StudioLiveInkCodecError
    );
    expect(() => encodeStudioLiveInkSamples([{ x: 0, y: 0, flags: 0x1_0000 }])).toThrow(
      StudioLiveInkCodecError
    );
  });

  it("rejects a mixed batch whose samples disagree with the bitmask", () => {
    expect(() =>
      encodeStudioLiveInkSamples([
        { x: 0, y: 0, pressure: 0.5 },
        { x: 1, y: 1 },
      ])
    ).toThrow(StudioLiveInkCodecError);
    expect(() =>
      encodeStudioLiveInkSamples([{ x: 0, y: 0 }], STUDIO_LIVE_INK_CHANNELS.pressure)
    ).toThrow(StudioLiveInkCodecError);
    expect(() =>
      encodeStudioLiveInkSamples([{ x: 0, y: 0, tiltX: 10 }])
    ).toThrow(StudioLiveInkCodecError);
  });

  it("rejects malformed buffers instead of partially decoding them", () => {
    const valid = encodeStudioLiveInkSamples([{ x: 1, y: 2, pressure: 0.5 }]);

    const truncated = valid.slice(0, valid.byteLength - 1);
    expect(() => decodeStudioLiveInkSamples(truncated)).toThrow(StudioLiveInkCodecError);

    const wrongVersion = valid.slice(0);
    new DataView(wrongVersion).setUint16(0, STUDIO_LIVE_INK_CODEC_FORMAT_VERSION + 1, true);
    expect(() => decodeStudioLiveInkSamples(wrongVersion)).toThrow(StudioLiveInkCodecError);

    const unknownChannel = valid.slice(0);
    new DataView(unknownChannel).setUint16(2, 1 << 15, true);
    expect(() => decodeStudioLiveInkSamples(unknownChannel)).toThrow(StudioLiveInkCodecError);

    const countMismatch = valid.slice(0);
    new DataView(countMismatch).setUint32(4, 2, true);
    expect(() => decodeStudioLiveInkSamples(countMismatch)).toThrow(StudioLiveInkCodecError);
  });

  it("rejects decoded values outside the protocol ranges", () => {
    const tilted = encodeStudioLiveInkSamples([{ x: 0, y: 0, tiltX: 45, tiltY: -45 }]);
    // Corrupt tiltX beyond +90.00° (raw 9001) directly in the byte stream.
    new DataView(tilted).setInt16(STUDIO_LIVE_INK_CODEC_HEADER_BYTES + 8, 9_001, true);
    expect(() => decodeStudioLiveInkSamples(tilted)).toThrow(StudioLiveInkCodecError);

    const twisted = encodeStudioLiveInkSamples([{ x: 0, y: 0, twist: 10 }]);
    new DataView(twisted).setUint16(STUDIO_LIVE_INK_CODEC_HEADER_BYTES + 8, 35_901, true);
    expect(() => decodeStudioLiveInkSamples(twisted)).toThrow(StudioLiveInkCodecError);

    const nonFinite = encodeStudioLiveInkSamples([{ x: 0, y: 0 }]);
    new DataView(nonFinite).setFloat32(STUDIO_LIVE_INK_CODEC_HEADER_BYTES, Number.NaN, true);
    expect(() => decodeStudioLiveInkSamples(nonFinite)).toThrow(StudioLiveInkCodecError);
  });

  it("digests chunk payloads deterministically for the ink:end sample hash", () => {
    const first = encodeStudioLiveInkSamples([{ x: 1, y: 2, pressure: 0.5 }]);
    const second = encodeStudioLiveInkSamples([{ x: 3, y: 4, pressure: 0.75 }]);

    const digest = hashStudioLiveInkPayloads([first, second]);
    expect(digest).toMatch(/^fnv1a32:[0-9a-f]{8}$/u);
    expect(hashStudioLiveInkPayloads([first, second])).toBe(digest);
    expect(hashStudioLiveInkPayloads([second, first])).not.toBe(digest);
    expect(hashStudioLiveInkPayloads([])).toBe("fnv1a32:811c9dc5");
  });
});
