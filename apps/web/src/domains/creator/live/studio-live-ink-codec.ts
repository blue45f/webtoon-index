/**
 * Binary sample codec for the Live Ink Protocol V2 point channel.
 *
 * One encoded buffer is a little-endian header followed by densely packed samples:
 *
 *   header  u16 formatVersion (=2), u16 channelMask, u32 sampleCount
 *   sample  x:f32, y:f32
 *           [pressure:u16] [tiltX:i16 tiltY:i16] [twist:u16] [tangentialPressure:i16]
 *           [altitude:u16] [azimuth:u16] [contactW:u16 contactH:u16] [timeDeltaMs:u16] [flags:u16]
 *
 * Optional channels appear only when their feature bit is set, always in the canonical order
 * above, so providers pay bytes only for the channels their hardware actually reports. Encoding
 * is deterministic: the same samples and mask always produce identical bytes, and decode restores
 * every value exactly within the documented quantization step. Every violation fails closed with
 * `StudioLiveInkCodecError` — the codec never clamps, never guesses and never partially decodes.
 */

export const STUDIO_LIVE_INK_CODEC_FORMAT_VERSION = 2 as const;
export const STUDIO_LIVE_INK_CODEC_HEADER_BYTES = 8;
/** Hard allocation bound for one buffer; protocol-level chunk caps are far stricter. */
export const STUDIO_LIVE_INK_CODEC_MAX_SAMPLES = 65_536;

/** Feature bitmask bits. `tilt` and `contact` cover their natural hardware pairs. */
export const STUDIO_LIVE_INK_CHANNELS = Object.freeze({
  pressure: 1 << 0,
  tilt: 1 << 1,
  twist: 1 << 2,
  tangentialPressure: 1 << 3,
  altitude: 1 << 4,
  azimuth: 1 << 5,
  contact: 1 << 6,
  timeDelta: 1 << 7,
  flags: 1 << 8,
} as const);

export type StudioLiveInkChannelName = keyof typeof STUDIO_LIVE_INK_CHANNELS;

export const STUDIO_LIVE_INK_CHANNEL_MASK_ALL = Object.values(
  STUDIO_LIVE_INK_CHANNELS
).reduce((mask, bit) => mask | bit, 0);

export const STUDIO_LIVE_INK_QUANTIZATION = Object.freeze({
  /** pressure/tangential quantize onto the full unsigned/signed 16-bit ranges. */
  pressureSteps: 65_535,
  tangentialScale: 10_000,
  /** Degrees are stored in hundredths (0.01° resolution). */
  angleScale: 100,
  /** Contact sizes are stored in eighths of a unit (0.125 resolution). */
  contactScale: 8,
} as const);

export const STUDIO_LIVE_INK_SAMPLE_LIMITS = Object.freeze({
  coordinateMagnitude: 10_000_000,
  tiltDegrees: 90,
  twistMaxDegrees: 359,
  altitudeMaxDegrees: 90,
  azimuthMaxDegrees: 360,
  contactMax: 8_191,
  timeDeltaMaxMs: 65_535,
  flagsMax: 0xffff,
} as const);

/**
 * One decoded stylus sample. Optional fields must be present exactly when the buffer's channel
 * mask includes their bit; a mixed batch is rejected instead of silently zero-filled.
 */
export interface StudioLiveInkSample {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly tiltX?: number;
  readonly tiltY?: number;
  readonly twist?: number;
  readonly tangentialPressure?: number;
  readonly altitude?: number;
  readonly azimuth?: number;
  readonly contactW?: number;
  readonly contactH?: number;
  readonly timeDeltaMs?: number;
  readonly flags?: number;
}

export interface StudioLiveInkDecodedSamples {
  readonly channelMask: number;
  readonly samples: StudioLiveInkSample[];
}

export class StudioLiveInkCodecError extends Error {
  constructor(message = "유효하지 않은 실시간 잉크 샘플 데이터입니다.") {
    super(message);
    this.name = "StudioLiveInkCodecError";
  }
}

function hasChannel(mask: number, channel: StudioLiveInkChannelName): boolean {
  return (mask & STUDIO_LIVE_INK_CHANNELS[channel]) !== 0;
}

/** Fixed per-sample byte stride for a channel mask. */
export function studioLiveInkSampleStride(channelMask: number): number {
  assertChannelMask(channelMask);
  let stride = 8; // x:f32 + y:f32
  if (hasChannel(channelMask, "pressure")) stride += 2;
  if (hasChannel(channelMask, "tilt")) stride += 4;
  if (hasChannel(channelMask, "twist")) stride += 2;
  if (hasChannel(channelMask, "tangentialPressure")) stride += 2;
  if (hasChannel(channelMask, "altitude")) stride += 2;
  if (hasChannel(channelMask, "azimuth")) stride += 2;
  if (hasChannel(channelMask, "contact")) stride += 4;
  if (hasChannel(channelMask, "timeDelta")) stride += 2;
  if (hasChannel(channelMask, "flags")) stride += 2;
  return stride;
}

function assertChannelMask(channelMask: number): void {
  if (
    !Number.isInteger(channelMask) ||
    channelMask < 0 ||
    (channelMask & ~STUDIO_LIVE_INK_CHANNEL_MASK_ALL) !== 0
  ) {
    throw new StudioLiveInkCodecError("알 수 없는 잉크 샘플 채널 비트마스크입니다.");
  }
}

/** Derives the exact feature bitmask one sample carries. */
export function studioLiveInkChannelMaskForSample(sample: StudioLiveInkSample): number {
  let mask = 0;
  if (sample.pressure !== undefined) mask |= STUDIO_LIVE_INK_CHANNELS.pressure;
  if (sample.tiltX !== undefined || sample.tiltY !== undefined) {
    mask |= STUDIO_LIVE_INK_CHANNELS.tilt;
  }
  if (sample.twist !== undefined) mask |= STUDIO_LIVE_INK_CHANNELS.twist;
  if (sample.tangentialPressure !== undefined) {
    mask |= STUDIO_LIVE_INK_CHANNELS.tangentialPressure;
  }
  if (sample.altitude !== undefined) mask |= STUDIO_LIVE_INK_CHANNELS.altitude;
  if (sample.azimuth !== undefined) mask |= STUDIO_LIVE_INK_CHANNELS.azimuth;
  if (sample.contactW !== undefined || sample.contactH !== undefined) {
    mask |= STUDIO_LIVE_INK_CHANNELS.contact;
  }
  if (sample.timeDeltaMs !== undefined) mask |= STUDIO_LIVE_INK_CHANNELS.timeDelta;
  if (sample.flags !== undefined) mask |= STUDIO_LIVE_INK_CHANNELS.flags;
  return mask;
}

function isFiniteRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function quantizeUnsigned(
  value: unknown,
  minimum: number,
  maximum: number,
  scale: number,
  label: string
): number {
  if (!isFiniteRange(value, minimum, maximum)) {
    throw new StudioLiveInkCodecError(`잉크 샘플의 ${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return Math.round(value * scale);
}

function encodeSample(
  view: DataView,
  offset: number,
  sample: StudioLiveInkSample,
  channelMask: number
): number {
  const limits = STUDIO_LIVE_INK_SAMPLE_LIMITS;
  const quant = STUDIO_LIVE_INK_QUANTIZATION;
  if (studioLiveInkChannelMaskForSample(sample) !== channelMask) {
    throw new StudioLiveInkCodecError(
      "잉크 샘플 배치의 채널 구성이 비트마스크와 일치하지 않습니다."
    );
  }
  if (
    !isFiniteRange(sample.x, -limits.coordinateMagnitude, limits.coordinateMagnitude) ||
    !isFiniteRange(sample.y, -limits.coordinateMagnitude, limits.coordinateMagnitude)
  ) {
    throw new StudioLiveInkCodecError("잉크 샘플 좌표가 유한한 범위를 벗어났습니다.");
  }
  view.setFloat32(offset, Math.fround(sample.x), true);
  view.setFloat32(offset + 4, Math.fround(sample.y), true);
  let cursor = offset + 8;
  if (hasChannel(channelMask, "pressure")) {
    view.setUint16(
      cursor,
      quantizeUnsigned(sample.pressure, 0, 1, quant.pressureSteps, "필압"),
      true
    );
    cursor += 2;
  }
  if (hasChannel(channelMask, "tilt")) {
    if (sample.tiltX === undefined || sample.tiltY === undefined) {
      throw new StudioLiveInkCodecError("잉크 샘플의 기울기 채널은 항상 X/Y 쌍이어야 합니다.");
    }
    view.setInt16(
      cursor,
      quantizeUnsigned(sample.tiltX, -limits.tiltDegrees, limits.tiltDegrees, quant.angleScale, "기울기 X"),
      true
    );
    view.setInt16(
      cursor + 2,
      quantizeUnsigned(sample.tiltY, -limits.tiltDegrees, limits.tiltDegrees, quant.angleScale, "기울기 Y"),
      true
    );
    cursor += 4;
  }
  if (hasChannel(channelMask, "twist")) {
    view.setUint16(
      cursor,
      quantizeUnsigned(sample.twist, 0, limits.twistMaxDegrees, quant.angleScale, "회전"),
      true
    );
    cursor += 2;
  }
  if (hasChannel(channelMask, "tangentialPressure")) {
    view.setInt16(
      cursor,
      quantizeUnsigned(sample.tangentialPressure, -1, 1, quant.tangentialScale, "접선 필압"),
      true
    );
    cursor += 2;
  }
  if (hasChannel(channelMask, "altitude")) {
    view.setUint16(
      cursor,
      quantizeUnsigned(sample.altitude, 0, limits.altitudeMaxDegrees, quant.angleScale, "고도각"),
      true
    );
    cursor += 2;
  }
  if (hasChannel(channelMask, "azimuth")) {
    view.setUint16(
      cursor,
      quantizeUnsigned(sample.azimuth, 0, limits.azimuthMaxDegrees, quant.angleScale, "방위각"),
      true
    );
    cursor += 2;
  }
  if (hasChannel(channelMask, "contact")) {
    if (sample.contactW === undefined || sample.contactH === undefined) {
      throw new StudioLiveInkCodecError("잉크 샘플의 접촉 채널은 항상 W/H 쌍이어야 합니다.");
    }
    view.setUint16(
      cursor,
      quantizeUnsigned(sample.contactW, 0, limits.contactMax, quant.contactScale, "접촉 너비"),
      true
    );
    view.setUint16(
      cursor + 2,
      quantizeUnsigned(sample.contactH, 0, limits.contactMax, quant.contactScale, "접촉 높이"),
      true
    );
    cursor += 4;
  }
  if (hasChannel(channelMask, "timeDelta")) {
    if (!isFiniteRange(sample.timeDeltaMs, 0, limits.timeDeltaMaxMs)) {
      throw new StudioLiveInkCodecError("잉크 샘플의 시간 간격이 허용 범위를 벗어났습니다.");
    }
    view.setUint16(cursor, Math.round(sample.timeDeltaMs), true);
    cursor += 2;
  }
  if (hasChannel(channelMask, "flags")) {
    if (
      typeof sample.flags !== "number" ||
      !Number.isInteger(sample.flags) ||
      sample.flags < 0 ||
      sample.flags > limits.flagsMax
    ) {
      throw new StudioLiveInkCodecError("잉크 샘플 플래그가 16비트 범위를 벗어났습니다.");
    }
    view.setUint16(cursor, sample.flags, true);
    cursor += 2;
  }
  return cursor;
}

/**
 * Encodes one homogeneous batch of samples. When `channelMask` is omitted it is derived from the
 * first sample; every sample must then carry exactly that channel set.
 */
export function encodeStudioLiveInkSamples(
  samples: readonly StudioLiveInkSample[],
  channelMask?: number
): ArrayBuffer {
  const mask = channelMask ?? (samples.length > 0 ? studioLiveInkChannelMaskForSample(samples[0]!) : 0);
  assertChannelMask(mask);
  if (samples.length > STUDIO_LIVE_INK_CODEC_MAX_SAMPLES) {
    throw new StudioLiveInkCodecError("잉크 샘플 개수가 인코딩 한도를 초과했습니다.");
  }
  const stride = studioLiveInkSampleStride(mask);
  const buffer = new ArrayBuffer(STUDIO_LIVE_INK_CODEC_HEADER_BYTES + stride * samples.length);
  const view = new DataView(buffer);
  view.setUint16(0, STUDIO_LIVE_INK_CODEC_FORMAT_VERSION, true);
  view.setUint16(2, mask, true);
  view.setUint32(4, samples.length, true);
  let offset = STUDIO_LIVE_INK_CODEC_HEADER_BYTES;
  for (const sample of samples) {
    offset = encodeSample(view, offset, sample, mask);
  }
  return buffer;
}

function decodeQuantized(
  raw: number,
  maximumRaw: number,
  scale: number,
  label: string
): number {
  if (raw > maximumRaw) {
    throw new StudioLiveInkCodecError(`잉크 샘플의 ${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return raw / scale;
}

function decodeQuantizedSigned(
  raw: number,
  magnitudeRaw: number,
  scale: number,
  label: string
): number {
  if (raw < -magnitudeRaw || raw > magnitudeRaw) {
    throw new StudioLiveInkCodecError(`잉크 샘플의 ${label} 값이 허용 범위를 벗어났습니다.`);
  }
  return raw / scale;
}

/**
 * Strictly decodes one buffer produced by `encodeStudioLiveInkSamples`. Every out-of-range byte
 * pattern (non-finite coordinates, tilt beyond ±90°, twist beyond 359°, oversized contact) is
 * rejected, so a successful decode already satisfies the protocol's per-sample value contract.
 */
export function decodeStudioLiveInkSamples(buffer: ArrayBuffer): StudioLiveInkDecodedSamples {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < STUDIO_LIVE_INK_CODEC_HEADER_BYTES) {
    throw new StudioLiveInkCodecError("잉크 샘플 버퍼 헤더가 손상되었습니다.");
  }
  const view = new DataView(buffer);
  if (view.getUint16(0, true) !== STUDIO_LIVE_INK_CODEC_FORMAT_VERSION) {
    throw new StudioLiveInkCodecError("지원하지 않는 잉크 샘플 포맷 버전입니다.");
  }
  const channelMask = view.getUint16(2, true);
  assertChannelMask(channelMask);
  const sampleCount = view.getUint32(4, true);
  if (sampleCount > STUDIO_LIVE_INK_CODEC_MAX_SAMPLES) {
    throw new StudioLiveInkCodecError("잉크 샘플 개수가 디코딩 한도를 초과했습니다.");
  }
  const stride = studioLiveInkSampleStride(channelMask);
  if (buffer.byteLength !== STUDIO_LIVE_INK_CODEC_HEADER_BYTES + stride * sampleCount) {
    throw new StudioLiveInkCodecError("잉크 샘플 버퍼 길이가 헤더와 일치하지 않습니다.");
  }
  const limits = STUDIO_LIVE_INK_SAMPLE_LIMITS;
  const quant = STUDIO_LIVE_INK_QUANTIZATION;
  const samples: StudioLiveInkSample[] = [];
  let offset = STUDIO_LIVE_INK_CODEC_HEADER_BYTES;
  for (let index = 0; index < sampleCount; index += 1) {
    const x = view.getFloat32(offset, true);
    const y = view.getFloat32(offset + 4, true);
    if (
      !isFiniteRange(x, -limits.coordinateMagnitude, limits.coordinateMagnitude) ||
      !isFiniteRange(y, -limits.coordinateMagnitude, limits.coordinateMagnitude)
    ) {
      throw new StudioLiveInkCodecError("잉크 샘플 좌표가 유한한 범위를 벗어났습니다.");
    }
    let cursor = offset + 8;
    const sample: {
      x: number;
      y: number;
      pressure?: number;
      tiltX?: number;
      tiltY?: number;
      twist?: number;
      tangentialPressure?: number;
      altitude?: number;
      azimuth?: number;
      contactW?: number;
      contactH?: number;
      timeDeltaMs?: number;
      flags?: number;
    } = { x, y };
    if (hasChannel(channelMask, "pressure")) {
      sample.pressure = view.getUint16(cursor, true) / quant.pressureSteps;
      cursor += 2;
    }
    if (hasChannel(channelMask, "tilt")) {
      sample.tiltX = decodeQuantizedSigned(
        view.getInt16(cursor, true),
        limits.tiltDegrees * quant.angleScale,
        quant.angleScale,
        "기울기 X"
      );
      sample.tiltY = decodeQuantizedSigned(
        view.getInt16(cursor + 2, true),
        limits.tiltDegrees * quant.angleScale,
        quant.angleScale,
        "기울기 Y"
      );
      cursor += 4;
    }
    if (hasChannel(channelMask, "twist")) {
      sample.twist = decodeQuantized(
        view.getUint16(cursor, true),
        limits.twistMaxDegrees * quant.angleScale,
        quant.angleScale,
        "회전"
      );
      cursor += 2;
    }
    if (hasChannel(channelMask, "tangentialPressure")) {
      sample.tangentialPressure = decodeQuantizedSigned(
        view.getInt16(cursor, true),
        quant.tangentialScale,
        quant.tangentialScale,
        "접선 필압"
      );
      cursor += 2;
    }
    if (hasChannel(channelMask, "altitude")) {
      sample.altitude = decodeQuantized(
        view.getUint16(cursor, true),
        limits.altitudeMaxDegrees * quant.angleScale,
        quant.angleScale,
        "고도각"
      );
      cursor += 2;
    }
    if (hasChannel(channelMask, "azimuth")) {
      sample.azimuth = decodeQuantized(
        view.getUint16(cursor, true),
        limits.azimuthMaxDegrees * quant.angleScale,
        quant.angleScale,
        "방위각"
      );
      cursor += 2;
    }
    if (hasChannel(channelMask, "contact")) {
      sample.contactW = decodeQuantized(
        view.getUint16(cursor, true),
        limits.contactMax * quant.contactScale,
        quant.contactScale,
        "접촉 너비"
      );
      sample.contactH = decodeQuantized(
        view.getUint16(cursor + 2, true),
        limits.contactMax * quant.contactScale,
        quant.contactScale,
        "접촉 높이"
      );
      cursor += 4;
    }
    if (hasChannel(channelMask, "timeDelta")) {
      sample.timeDeltaMs = view.getUint16(cursor, true);
      cursor += 2;
    }
    if (hasChannel(channelMask, "flags")) {
      sample.flags = view.getUint16(cursor, true);
    }
    samples.push(sample);
    offset += stride;
  }
  return { channelMask, samples };
}

/**
 * Deterministic FNV-1a 32-bit digest over the concatenated chunk payload bytes. `ink:end` carries
 * this hash so receivers can verify the reassembled actual-sample stream without re-decoding.
 */
export function hashStudioLiveInkPayloads(payloads: readonly ArrayBuffer[]): string {
  let hash = 0x811c_9dc5;
  for (const payload of payloads) {
    const bytes = new Uint8Array(payload);
    for (let index = 0; index < bytes.length; index += 1) {
      hash ^= bytes[index]!;
      hash = Math.imul(hash, 0x0100_0193);
    }
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
