import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  EBML_ID,
  WEBM_DEFAULT_TIMESTAMP_SCALE_NS,
  WEBM_SEEK_HEAD_BYTES,
  WEBM_VIDEO_TRACK_NUMBER,
  ebmlFloat64Bytes,
  ebmlIdBytes,
  ebmlUintBytes,
  encodeVint,
  muxWebm,
  planWebmClusters,
  simpleBlockBytes,
  ticksFromMicroseconds,
  vintLength,
  webmMimeType,
  type WebmFrameInput,
} from "./studio-webcodecs-webm";

// ── 테스트용 최소 EBML 리더(muxer와 독립 구현 — 서로의 버그를 가려주지 않게) ──

interface ParsedElement {
  id: number;
  start: number; // 요소(ID 첫 바이트) 시작
  dataStart: number;
  size: number;
  end: number;
}

function readId(bytes: Uint8Array, pos: number): { id: number; length: number } {
  const first = bytes[pos]!;
  const length = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : 4;
  let id = 0;
  for (let i = 0; i < length; i += 1) id = id * 256 + bytes[pos + i]!;
  return { id, length };
}

function readVint(bytes: Uint8Array, pos: number): { value: number; length: number } {
  const first = bytes[pos]!;
  let length = 1;
  while (length <= 8 && (first & (1 << (8 - length))) === 0) length += 1;
  let value = first & ((1 << (8 - length)) - 1);
  for (let i = 1; i < length; i += 1) value = value * 256 + bytes[pos + i]!;
  return { value, length };
}

function parseChildren(bytes: Uint8Array, start: number, end: number): ParsedElement[] {
  const out: ParsedElement[] = [];
  let pos = start;
  while (pos < end) {
    const id = readId(bytes, pos);
    const size = readVint(bytes, pos + id.length);
    const dataStart = pos + id.length + size.length;
    out.push({ id: id.id, start: pos, dataStart, size: size.value, end: dataStart + size.value });
    pos = dataStart + size.value;
  }
  return out;
}

function childData(bytes: Uint8Array, element: ParsedElement): Uint8Array {
  return bytes.subarray(element.dataStart, element.end);
}

function uintOf(bytes: Uint8Array, element: ParsedElement): number {
  let value = 0;
  for (const byte of childData(bytes, element)) value = value * 256 + byte;
  return value;
}

function stringOf(bytes: Uint8Array, element: ParsedElement): string {
  return new TextDecoder().decode(childData(bytes, element));
}

function find(children: ParsedElement[], id: number): ParsedElement {
  const found = children.find((child) => child.id === id);
  if (!found) throw new Error(`요소를 찾지 못함: 0x${id.toString(16)}`);
  return found;
}

function frame(timestampUs: number, keyFrame: boolean, byte = 0xaa): WebmFrameInput {
  return { data: new Uint8Array([byte, byte ^ 0xff]), timestampUs, durationUs: 33_333, keyFrame };
}

const TRACK = { codecId: "V_VP9", width: 720, height: 1280 } as const;

// ── EBML 원시 인코딩 ────────────────────────────────────────────────────

describe("EBML 기본 인코딩", () => {
  it("vint 폭은 '전부 1' 표현(크기 미상)을 피해 정해진다", () => {
    expect(vintLength(0)).toBe(1);
    expect(vintLength(126)).toBe(1);
    expect(vintLength(127)).toBe(2); // 0x7F = 1바이트 vint의 예약값
    expect(vintLength(16_382)).toBe(2);
    expect(vintLength(16_383)).toBe(3);
  });

  it("vint 바이트열이 스펙과 정확히 일치한다", () => {
    expect(Array.from(encodeVint(0))).toEqual([0x80]);
    expect(Array.from(encodeVint(1))).toEqual([0x81]);
    expect(Array.from(encodeVint(126))).toEqual([0xfe]);
    expect(Array.from(encodeVint(127))).toEqual([0x40, 0x7f]);
    expect(Array.from(encodeVint(16_382))).toEqual([0x7f, 0xfe]);
    // 폭 강제(선행 0 허용) — SeekPosition 고정폭에 쓰인다.
    expect(Array.from(encodeVint(1, 4))).toEqual([0x10, 0x00, 0x00, 0x01]);
  });

  it("요소 ID는 마커 비트가 포함된 정식 바이트열 그대로 나온다", () => {
    expect(Array.from(ebmlIdBytes(EBML_ID.simpleBlock))).toEqual([0xa3]);
    expect(Array.from(ebmlIdBytes(EBML_ID.ebmlVersion))).toEqual([0x42, 0x86]);
    expect(Array.from(ebmlIdBytes(EBML_ID.timestampScale))).toEqual([0x2a, 0xd7, 0xb1]);
    expect(Array.from(ebmlIdBytes(EBML_ID.ebml))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(Array.from(ebmlIdBytes(EBML_ID.segment))).toEqual([0x18, 0x53, 0x80, 0x67]);
  });

  it("uint 페이로드는 최소 폭이지만 fixedLength로 고정할 수 있다", () => {
    expect(Array.from(ebmlUintBytes(0))).toEqual([0x00]);
    expect(Array.from(ebmlUintBytes(255))).toEqual([0xff]);
    expect(Array.from(ebmlUintBytes(256))).toEqual([0x01, 0x00]);
    expect(Array.from(ebmlUintBytes(1_000_000))).toEqual([0x0f, 0x42, 0x40]);
    expect(Array.from(ebmlUintBytes(5, 8))).toEqual([0, 0, 0, 0, 0, 0, 0, 5]);
  });

  it("Duration은 8바이트 빅엔디언 IEEE754로 기록된다", () => {
    expect(Array.from(ebmlFloat64Bytes(1))).toEqual([0x3f, 0xf0, 0, 0, 0, 0, 0, 0]);
  });

  it("µs → 눈금 변환이 TimestampScale을 정확히 반영한다", () => {
    expect(ticksFromMicroseconds(33_333, WEBM_DEFAULT_TIMESTAMP_SCALE_NS)).toBe(33);
    expect(ticksFromMicroseconds(33_667, WEBM_DEFAULT_TIMESTAMP_SCALE_NS)).toBe(34);
    expect(ticksFromMicroseconds(1_000_000, WEBM_DEFAULT_TIMESTAMP_SCALE_NS)).toBe(1000);
  });
});

// ── SimpleBlock 바이트 레이아웃 ─────────────────────────────────────────

describe("SimpleBlock 레이아웃", () => {
  it("트랙 vint + int16 상대 타임스탬프 + 플래그 + 프레임 순서로 정확히 쓴다", () => {
    const bytes = simpleBlockBytes(1, 33, true, new Uint8Array([0x01, 0x02, 0x03]));
    expect(Array.from(bytes)).toEqual([
      0xa3, // SimpleBlock ID
      0x87, // 크기 7
      0x81, // 트랙 번호 1(vint)
      0x00,
      0x21, // 상대 타임스탬프 33(int16 BE)
      0x80, // 키프레임 플래그
      0x01,
      0x02,
      0x03,
    ]);
  });

  it("델타 프레임은 플래그 0이고 음수 상대 타임스탬프도 int16으로 담긴다", () => {
    const bytes = simpleBlockBytes(1, -2, false, new Uint8Array([0x09]));
    expect(bytes[5]).toBe(0x00);
    expect(Array.from(bytes.subarray(3, 5))).toEqual([0xff, 0xfe]);
  });

  it("int16 범위를 넘는 상대 타임스탬프는 조용히 잘리지 않고 거부한다", () => {
    expect(() => simpleBlockBytes(1, 32_768, false, new Uint8Array([0]))).toThrow(/범위/);
  });
});

// ── 파일 구조 ───────────────────────────────────────────────────────────

describe("muxWebm 파일 구조", () => {
  const frames: WebmFrameInput[] = [
    frame(0, true, 0x11),
    frame(33_333, false, 0x22),
    frame(66_667, false, 0x33),
  ];

  it("EBML 헤더 36바이트가 WebM DocType v2로 바이트 단위 일치한다", () => {
    const { bytes } = muxWebm({ track: TRACK, frames });
    expect(Array.from(bytes.subarray(0, 36))).toEqual([
      0x1a, 0x45, 0xdf, 0xa3, 0x9f, // EBML, 크기 31
      0x42, 0x86, 0x81, 0x01, // EBMLVersion 1
      0x42, 0xf7, 0x81, 0x01, // EBMLReadVersion 1
      0x42, 0xf2, 0x81, 0x04, // EBMLMaxIDLength 4
      0x42, 0xf3, 0x81, 0x08, // EBMLMaxSizeLength 8
      0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, // DocType "webm"
      0x42, 0x87, 0x81, 0x02, // DocTypeVersion 2
      0x42, 0x85, 0x81, 0x02, // DocTypeReadVersion 2
    ]);
    // 헤더 바로 뒤가 Segment.
    expect(Array.from(bytes.subarray(36, 40))).toEqual([0x18, 0x53, 0x80, 0x67]);
  });

  it("Segment가 선언한 크기가 실제 페이로드 길이와 정확히 같다", () => {
    const { bytes } = muxWebm({ track: TRACK, frames });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    expect(segment!.id).toBe(EBML_ID.segment);
    expect(segment!.end).toBe(bytes.length);
    expect(segment!.size).toBe(bytes.length - segment!.dataStart);
  });

  it("Segment 자식 순서가 SeekHead → Info → Tracks → Cluster… → Cues 다", () => {
    const { bytes } = muxWebm({ track: TRACK, frames });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    expect(children.map((child) => child.id)).toEqual([
      EBML_ID.seekHead,
      EBML_ID.info,
      EBML_ID.tracks,
      EBML_ID.cluster,
      EBML_ID.cues,
    ]);
  });

  it("SeekHead는 고정폭 위치 덕에 68바이트 상수이고 Info/Tracks/Cues를 정확히 가리킨다", () => {
    const { bytes } = muxWebm({ track: TRACK, frames });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    const seekHead = find(children, EBML_ID.seekHead);
    expect(seekHead.end - seekHead.start).toBe(WEBM_SEEK_HEAD_BYTES);
    expect(WEBM_SEEK_HEAD_BYTES).toBe(68);

    const seeks = parseChildren(bytes, seekHead.dataStart, seekHead.end);
    expect(seeks).toHaveLength(3);
    const targets = [EBML_ID.info, EBML_ID.tracks, EBML_ID.cues];
    seeks.forEach((seek, index) => {
      const parts = parseChildren(bytes, seek.dataStart, seek.end);
      const seekId = childData(bytes, find(parts, EBML_ID.seekId));
      expect(Array.from(seekId)).toEqual(Array.from(ebmlIdBytes(targets[index]!)));
      const position = uintOf(bytes, find(parts, EBML_ID.seekPosition));
      // 위치는 Segment 데이터 시작 기준 — 그 자리에 실제로 해당 요소가 있어야 한다.
      const at = segment!.dataStart + position;
      expect(Array.from(bytes.subarray(at, at + 4))).toEqual(Array.from(ebmlIdBytes(targets[index]!)));
    });
  });

  it("Info의 TimestampScale·Duration이 마지막 프레임 종료 시각과 맞는다", () => {
    const { bytes, durationTicks } = muxWebm({ track: TRACK, frames });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    const info = parseChildren(bytes, find(children, EBML_ID.info).dataStart, find(children, EBML_ID.info).end);
    expect(uintOf(bytes, find(info, EBML_ID.timestampScale))).toBe(1_000_000);
    expect(stringOf(bytes, find(info, EBML_ID.writingApp))).toBe("ToonSpectrum Studio");
    const duration = childData(bytes, find(info, EBML_ID.duration));
    expect(duration).toHaveLength(8);
    const view = new DataView(duration.buffer, duration.byteOffset, duration.byteLength);
    expect(view.getFloat64(0, false)).toBe(durationTicks);
    expect(durationTicks).toBe(100); // 66.667ms + 33.333ms = 100ms
  });

  it("Tracks가 코덱·해상도·CodecPrivate을 담는다", () => {
    const codecPrivate = new Uint8Array([0x81, 0x05, 0x0c, 0x00]);
    const { bytes } = muxWebm({
      track: { codecId: "V_AV1", width: 1080, height: 1920, codecPrivate },
      frames,
    });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    const tracks = find(children, EBML_ID.tracks);
    const entry = parseChildren(bytes, tracks.dataStart, tracks.end)[0]!;
    const fields = parseChildren(bytes, entry.dataStart, entry.end);
    expect(uintOf(bytes, find(fields, EBML_ID.trackNumber))).toBe(WEBM_VIDEO_TRACK_NUMBER);
    expect(uintOf(bytes, find(fields, EBML_ID.trackType))).toBe(1);
    expect(stringOf(bytes, find(fields, EBML_ID.codecId))).toBe("V_AV1");
    expect(Array.from(childData(bytes, find(fields, EBML_ID.codecPrivate)))).toEqual(
      Array.from(codecPrivate)
    );
    const video = find(fields, EBML_ID.video);
    const videoFields = parseChildren(bytes, video.dataStart, video.end);
    expect(uintOf(bytes, find(videoFields, EBML_ID.pixelWidth))).toBe(1080);
    expect(uintOf(bytes, find(videoFields, EBML_ID.pixelHeight))).toBe(1920);
  });

  it("CodecPrivate이 없으면 요소 자체를 쓰지 않는다", () => {
    const { bytes } = muxWebm({ track: TRACK, frames });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    const tracks = find(children, EBML_ID.tracks);
    const entry = parseChildren(bytes, tracks.dataStart, tracks.end)[0]!;
    const fields = parseChildren(bytes, entry.dataStart, entry.end);
    expect(fields.some((field) => field.id === EBML_ID.codecPrivate)).toBe(false);
  });
});

// ── Cluster 분할 & Cues ────────────────────────────────────────────────

describe("Cluster 분할", () => {
  it("키프레임마다 새 Cluster를 열고 상대 타임스탬프는 Cluster 기준이 된다", () => {
    const clusters = planWebmClusters(
      [
        { ticks: 0, keyFrame: true, data: new Uint8Array([1]) },
        { ticks: 33, keyFrame: false, data: new Uint8Array([2]) },
        { ticks: 67, keyFrame: true, data: new Uint8Array([3]) },
        { ticks: 100, keyFrame: false, data: new Uint8Array([4]) },
      ],
      5000
    );
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.startTicks).toBe(0);
    expect(clusters[0]!.frames.map((f) => f.relativeTicks)).toEqual([0, 33]);
    expect(clusters[1]!.startTicks).toBe(67);
    expect(clusters[1]!.frames.map((f) => f.relativeTicks)).toEqual([0, 33]);
  });

  it("키프레임이 없어도 최대 Cluster 길이를 넘으면 끊는다(int16 오버플로 방지)", () => {
    const entries = Array.from({ length: 5 }, (_, index) => ({
      ticks: index * 1000,
      keyFrame: index === 0,
      data: new Uint8Array([index]),
    }));
    const clusters = planWebmClusters(entries, 2000);
    expect(clusters.map((cluster) => cluster.startTicks)).toEqual([0, 3000]);
    expect(clusters[0]!.frames.map((f) => f.relativeTicks)).toEqual([0, 1000, 2000]);
  });

  it("Cues의 CueClusterPosition이 실제 Cluster 요소 시작을 가리킨다", () => {
    const frames: WebmFrameInput[] = [
      frame(0, true),
      frame(33_333, false),
      frame(66_667, true),
      frame(100_000, false),
    ];
    const { bytes, clusterCount } = muxWebm({ track: TRACK, frames });
    expect(clusterCount).toBe(2);
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    const clusters = children.filter((child) => child.id === EBML_ID.cluster);
    const cues = find(children, EBML_ID.cues);
    const points = parseChildren(bytes, cues.dataStart, cues.end);
    expect(points).toHaveLength(2);
    points.forEach((point, index) => {
      const parts = parseChildren(bytes, point.dataStart, point.end);
      const cueTime = uintOf(bytes, find(parts, EBML_ID.cueTime));
      const positions = find(parts, EBML_ID.cueTrackPositions);
      const positionFields = parseChildren(bytes, positions.dataStart, positions.end);
      expect(uintOf(bytes, find(positionFields, EBML_ID.cueTrack))).toBe(WEBM_VIDEO_TRACK_NUMBER);
      const clusterPosition = uintOf(bytes, find(positionFields, EBML_ID.cueClusterPosition));
      expect(segment!.dataStart + clusterPosition).toBe(clusters[index]!.start);
      const clusterFields = parseChildren(bytes, clusters[index]!.dataStart, clusters[index]!.end);
      expect(uintOf(bytes, find(clusterFields, EBML_ID.timestamp))).toBe(cueTime);
    });
    expect(webmMimeType("vp09.00.31.08")).toBe('video/webm; codecs="vp09.00.31.08"');
  });

  it("프레임 바이트가 손실 없이 SimpleBlock에 실린다", () => {
    const frames: WebmFrameInput[] = [
      { data: new Uint8Array([1, 2, 3, 4]), timestampUs: 0, durationUs: 1000, keyFrame: true },
      { data: new Uint8Array([9, 8]), timestampUs: 1000, durationUs: 1000, keyFrame: false },
    ];
    const { bytes } = muxWebm({ track: TRACK, frames });
    const [segment] = parseChildren(bytes, 36, bytes.length);
    const children = parseChildren(bytes, segment!.dataStart, segment!.end);
    const cluster = find(children, EBML_ID.cluster);
    const blocks = parseChildren(bytes, cluster.dataStart, cluster.end).filter(
      (child) => child.id === EBML_ID.simpleBlock
    );
    expect(blocks).toHaveLength(2);
    // 트랙 vint(1) + 상대 타임스탬프(2) + 플래그(1) 이후가 프레임 바이트다.
    expect(Array.from(childData(bytes, blocks[0]!).subarray(4))).toEqual([1, 2, 3, 4]);
    expect(Array.from(childData(bytes, blocks[1]!).subarray(4))).toEqual([9, 8]);
  });
});

// ── 방어 & 결정성 ───────────────────────────────────────────────────────

describe("muxWebm 방어 규칙", () => {
  it("프레임이 없거나 첫 프레임이 델타면 거부한다", () => {
    expect(() => muxWebm({ track: TRACK, frames: [] })).toThrow(/프레임이 없어요/);
    expect(() => muxWebm({ track: TRACK, frames: [frame(0, false)] })).toThrow(/키프레임/);
  });

  it("검증된 capability/distribution 프로파일이 없는 코덱은 바이트를 쓰기 전에 거부한다", () => {
    expect(() =>
      muxWebm({
        track: { ...TRACK, codecId: "V_H264" as typeof TRACK.codecId },
        frames: [frame(0, true)],
      })
    ).toThrowError(
      expect.objectContaining({
        code: "UNSUPPORTED_WEBM_CODEC_PROFILE",
        path: "/codecId",
      })
    );
  });

  it("타임스탬프가 역행하면 거부한다(시간축이 조용히 깨지는 것보다 낫다)", () => {
    expect(() =>
      muxWebm({ track: TRACK, frames: [frame(1000, true), frame(500, false)] })
    ).toThrow(/오름차순/);
  });

  it("같은 입력이면 항상 같은 바이트가 나온다(벽시계·난수 없음)", () => {
    const frames = [frame(0, true), frame(33_333, false)];
    const first = muxWebm({ track: TRACK, frames });
    const second = muxWebm({ track: TRACK, frames });
    expect(Array.from(first.bytes)).toEqual(Array.from(second.bytes));
  });

  it("소스(주석 제외)에 벽시계·난수 호출이 없다", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "studio-webcodecs-webm.ts"), "utf-8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/Date\.now|performance\.now|Math\.random|new Date\(/);
  });

  it("기술 지원을 로열티 또는 공식 인증으로 단정하지 않는다", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "studio-webcodecs-webm.ts"), "utf-8");
    expect(source).not.toContain("WebCodecs가 로열티 없이 노출");
    expect(source).toContain("공식 인증을 의미하지 않는다");
  });
});
