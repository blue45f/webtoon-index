/**
 * Studio WebCodecs — WebM(Matroska) 컨테이너 muxer(순수 바이트 조립).
 *
 * VideoEncoder가 뱉는 EncodedVideoChunk 바이트를 재생 가능한 .webm 파일로 감싼다. DOM·WebCodecs·
 * 시계에 **전혀** 의존하지 않는 순수 함수라 node(vitest)에서 바이트 단위로 검증할 수 있고, 같은
 * 입력이면 항상 같은 파일을 만든다(결정적 — Date.now/Math.random 없음, WritingApp도 고정 문자열).
 *
 * ── 왜 MP4가 아니라 WebM인가 ────────────────────────────────────────────────
 * 1) 기존 내보내기 산출물이 이미 `video/webm`(작업 전 확정한 MediaRecorder 코덱)이다. 컨테이너를 유지하면
 *    파일명 규칙(`-motion.webm`)·패널 안내·상호운용 카탈로그(studio-interchange-capabilities의
 *    webm 엔트리)를 하나도 안 건드리고 인코더만 갈아끼울 수 있다.
 * 2) EBML은 "ID + 가변길이 크기 + 페이로드"의 단순 재귀 구조라 minimal writer가 수백 줄이면 끝난다.
 *    MP4/ISOBMFF는 moov/trak/mdia/minf/stbl(stts·stsc·stsz·stco·stss) 테이블 전체와 코덱별
 *    extradata 박스(avcC/av1C/vpcC)를 정확히 써야 하고, 샘플 오프셋 패치까지 필요하다.
 * 3) WebM은 VP8·VP9·AV1을 모두 담을 수 있다. 인코더는 브라우저 WebCodecs 런타임이 제공하며,
 *    기술 지원 여부와 구현 배포 상태는 studio-codec-legal-profile에서 별도로 검증한다. 이는
 *    로열티·특허·상표·라이선스 판단이나 공식 인증을 의미하지 않는다. H.264는 컨테이너 규약상
 *    WebM에 넣을 수 없다 → H.264를 쓰려면 MP4 box writer가 전제다
 *    (§알려진 한계: Safari처럼 H.264만 인코딩 가능한 런타임은 WebCodecs 경로를 못 타고
 *     studio-webcodecs-capability의 폴백 계약에 따라 기존 MediaRecorder/GIF 경로로 내려간다).
 *
 * ── 출력 구조(Matroska/WebM v2) ─────────────────────────────────────────────
 *   EBML 헤더(DocType="webm", DocTypeVersion=2 — SimpleBlock 요구 버전)
 *   Segment
 *     SeekHead   → Info·Tracks·Cues 위치(Segment 데이터 시작 기준 오프셋)
 *     Info       → TimestampScale·MuxingApp·WritingApp·Duration
 *     Tracks     → TrackEntry 1개(비디오)
 *     Cluster*   → SimpleBlock 나열(키프레임마다 새 Cluster)
 *     Cues       → Cluster별 CuePoint(탐색용)
 * SeekPosition을 고정 8바이트 uint으로 쓰기 때문에 SeekHead 크기가 입력과 무관하게 상수(68B)다
 * → 오프셋을 한 번에 확정할 수 있어 2-pass 반복 수렴이 필요 없다.
 */

import {
  studioWebmCodecLegalProfile,
  type StudioWebmCodecId,
} from "./studio-codec-legal-profile";

// ── EBML 요소 ID(마커 비트 포함 정식 바이트열) ────────────────────────────

export const EBML_ID = {
  ebml: 0x1a45dfa3,
  ebmlVersion: 0x4286,
  ebmlReadVersion: 0x42f7,
  ebmlMaxIdLength: 0x42f2,
  ebmlMaxSizeLength: 0x42f3,
  docType: 0x4282,
  docTypeVersion: 0x4287,
  docTypeReadVersion: 0x4285,

  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,

  info: 0x1549a966,
  timestampScale: 0x2ad7b1,
  muxingApp: 0x4d80,
  writingApp: 0x5741,
  duration: 0x4489,

  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackUid: 0x73c5,
  trackType: 0x83,
  flagLacing: 0x9c,
  codecId: 0x86,
  codecPrivate: 0x63a2,
  defaultDuration: 0x23e383,
  video: 0xe0,
  pixelWidth: 0xb0,
  pixelHeight: 0xba,

  cluster: 0x1f43b675,
  timestamp: 0xe7,
  simpleBlock: 0xa3,

  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cueClusterPosition: 0xf1,
} as const;

/** WebM이 담을 수 있는 비디오 코덱 ID(Matroska codec mapping). */
export type WebmVideoCodecId = StudioWebmCodecId;

/** 트랙 번호는 1로 고정한다(비디오 단일 트랙 muxer). */
export const WEBM_VIDEO_TRACK_NUMBER = 1;
/** TrackUID도 고정 — 무작위 UID는 출력의 결정성을 깬다. */
export const WEBM_VIDEO_TRACK_UID = 1;
/** 기본 TimestampScale(ns) — 1ms 눈금. Cluster/Block 타임스탬프가 전부 ms 단위가 된다. */
export const WEBM_DEFAULT_TIMESTAMP_SCALE_NS = 1_000_000;
/** SimpleBlock의 상대 타임스탬프는 부호 있는 16비트라 한 Cluster가 덮을 수 있는 눈금 상한이 있다. */
export const WEBM_MAX_BLOCK_RELATIVE_TICKS = 32_767;
/** Cluster 하나가 덮는 기본 최대 길이(ms) — 탐색 입도와 오버헤드의 절충. */
export const WEBM_DEFAULT_MAX_CLUSTER_MS = 5_000;
/** MuxingApp/WritingApp 문자열 — 결정성을 위해 버전 문자열을 박지 않는다. */
export const WEBM_WRITING_APP = "ToonSpectrum Studio";

const SEEK_POSITION_BYTES = 8; // 고정 폭 → SeekHead 크기 상수화
const TRACK_TYPE_VIDEO = 1;

// ── EBML 기본 인코딩(전부 순수) ───────────────────────────────────────────

/** 요소 ID를 정식 바이트열로 — ID는 이미 마커 비트를 포함하므로 크기만 보고 자른다. */
export function ebmlIdBytes(id: number): Uint8Array {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`잘못된 EBML ID: ${id}`);
  const length = id > 0xff_ff_ff ? 4 : id > 0xff_ff ? 3 : id > 0xff ? 2 : 1;
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = (id >>> ((length - 1 - i) * 8)) & 0xff;
  }
  return bytes;
}

/** 가변길이 정수(vint)에 필요한 최소 바이트 수. 값이 전부 1인 표현은 "크기 미상"이라 못 쓴다. */
export function vintLength(value: number): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`잘못된 vint 값: ${value}`);
  for (let length = 1; length <= 7; length += 1) {
    if (value < 2 ** (7 * length) - 1) return length;
  }
  throw new Error(`vint로 표현할 수 없는 값: ${value}`);
}

/** vint 인코딩 — length를 주면 그 폭으로 강제(선행 0 허용, EBML 규격상 합법). */
export function encodeVint(value: number, length = vintLength(value)): Uint8Array {
  const bytes = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  bytes[0]! |= 1 << (8 - length);
  return bytes;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** ID + 크기(vint) + 페이로드. */
export function ebmlElement(id: number, payload: Uint8Array): Uint8Array {
  const idBytes = ebmlIdBytes(id);
  const sizeBytes = encodeVint(payload.length);
  return concatBytes([idBytes, sizeBytes, payload]);
}

/** 부호 없는 정수 페이로드(빅엔디언, 최소 1바이트). fixedLength로 폭을 고정할 수 있다. */
export function ebmlUintBytes(value: number, fixedLength?: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error(`잘못된 EBML uint: ${value}`);
  let minLength = 1;
  let probe = value;
  while (probe > 0xff) {
    probe = Math.floor(probe / 256);
    minLength += 1;
  }
  const length = Math.max(minLength, fixedLength ?? 1);
  const bytes = new Uint8Array(length);
  let rest = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return bytes;
}

function ebmlUint(id: number, value: number, fixedLength?: number): Uint8Array {
  return ebmlElement(id, ebmlUintBytes(value, fixedLength));
}

/** 64비트 IEEE754 실수 페이로드 — Duration 전용. */
export function ebmlFloat64Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value, false);
  return bytes;
}

function ebmlFloat64(id: number, value: number): Uint8Array {
  return ebmlElement(id, ebmlFloat64Bytes(value));
}

function ebmlString(id: number, value: string): Uint8Array {
  return ebmlElement(id, new TextEncoder().encode(value));
}

// ── muxer 입력 ────────────────────────────────────────────────────────────

export interface WebmVideoTrackSpec {
  codecId: WebmVideoCodecId;
  width: number;
  height: number;
  /**
   * 코덱 초기화 데이터(CodecPrivate). AV1은 AV1CodecConfigurationRecord가 사실상 필수라
   * VideoEncoder output metadata의 `decoderConfig.description`을 그대로 넘긴다. VP8/VP9는 없어도 된다.
   */
  codecPrivate?: Uint8Array | null;
  /** 프레임 1장 기본 길이(ns) — CFR 출력에서 플레이어의 프레임레이트 추정을 돕는다. */
  defaultDurationNs?: number | null;
}

export interface WebmFrameInput {
  data: Uint8Array;
  /** 표시 시각(µs) — 0 이상, 비감소. */
  timestampUs: number;
  /** 표시 길이(µs) — 마지막 프레임의 Duration 계산에만 쓴다. */
  durationUs?: number;
  keyFrame: boolean;
}

export interface WebmMuxOptions {
  track: WebmVideoTrackSpec;
  frames: readonly WebmFrameInput[];
  timestampScaleNs?: number;
  maxClusterMs?: number;
  writingApp?: string;
}

export interface WebmMuxResult {
  bytes: Uint8Array;
  /** Cluster 개수 — 탐색 입도 점검/테스트용. */
  clusterCount: number;
  /** Duration 요소에 기록된 값(TimestampScale 눈금). */
  durationTicks: number;
}

// ── 내부 조립 ─────────────────────────────────────────────────────────────

function ebmlHeaderBytes(): Uint8Array {
  return ebmlElement(
    EBML_ID.ebml,
    concatBytes([
      ebmlUint(EBML_ID.ebmlVersion, 1),
      ebmlUint(EBML_ID.ebmlReadVersion, 1),
      ebmlUint(EBML_ID.ebmlMaxIdLength, 4),
      ebmlUint(EBML_ID.ebmlMaxSizeLength, 8),
      ebmlString(EBML_ID.docType, "webm"),
      ebmlUint(EBML_ID.docTypeVersion, 2),
      ebmlUint(EBML_ID.docTypeReadVersion, 2),
    ])
  );
}

function infoBytes(timestampScaleNs: number, durationTicks: number, writingApp: string): Uint8Array {
  return ebmlElement(
    EBML_ID.info,
    concatBytes([
      ebmlUint(EBML_ID.timestampScale, timestampScaleNs),
      ebmlString(EBML_ID.muxingApp, writingApp),
      ebmlString(EBML_ID.writingApp, writingApp),
      ebmlFloat64(EBML_ID.duration, durationTicks),
    ])
  );
}

function tracksBytes(track: WebmVideoTrackSpec): Uint8Array {
  const parts: Uint8Array[] = [
    ebmlUint(EBML_ID.trackNumber, WEBM_VIDEO_TRACK_NUMBER),
    ebmlUint(EBML_ID.trackUid, WEBM_VIDEO_TRACK_UID),
    ebmlUint(EBML_ID.trackType, TRACK_TYPE_VIDEO),
    ebmlUint(EBML_ID.flagLacing, 0),
    ebmlString(EBML_ID.codecId, track.codecId),
  ];
  if (track.codecPrivate && track.codecPrivate.length > 0) {
    parts.push(ebmlElement(EBML_ID.codecPrivate, track.codecPrivate));
  }
  if (track.defaultDurationNs && track.defaultDurationNs > 0) {
    parts.push(ebmlUint(EBML_ID.defaultDuration, Math.round(track.defaultDurationNs)));
  }
  parts.push(
    ebmlElement(
      EBML_ID.video,
      concatBytes([
        ebmlUint(EBML_ID.pixelWidth, Math.max(1, Math.round(track.width))),
        ebmlUint(EBML_ID.pixelHeight, Math.max(1, Math.round(track.height))),
      ])
    )
  );
  return ebmlElement(EBML_ID.tracks, ebmlElement(EBML_ID.trackEntry, concatBytes(parts)));
}

/**
 * SimpleBlock = 트랙번호(vint) + 상대 타임스탬프(int16 BE) + 플래그(1B) + 프레임 바이트.
 * 플래그 최상위 비트(0x80)가 키프레임이다. lacing은 쓰지 않는다(0).
 */
export function simpleBlockBytes(
  trackNumber: number,
  relativeTicks: number,
  keyFrame: boolean,
  data: Uint8Array
): Uint8Array {
  if (relativeTicks < -32_768 || relativeTicks > WEBM_MAX_BLOCK_RELATIVE_TICKS) {
    throw new Error(`SimpleBlock 상대 타임스탬프 범위를 벗어났어요: ${relativeTicks}`);
  }
  const header = new Uint8Array(3);
  new DataView(header.buffer).setInt16(0, relativeTicks, false);
  header[2] = keyFrame ? 0x80 : 0x00;
  return ebmlElement(
    EBML_ID.simpleBlock,
    concatBytes([encodeVint(trackNumber), header, data])
  );
}

interface ClusterPlanEntry {
  startTicks: number;
  frames: { relativeTicks: number; keyFrame: boolean; data: Uint8Array }[];
}

/**
 * 프레임 목록을 Cluster로 나눈다 — 키프레임마다 새 Cluster를 열고, int16 상대 타임스탬프 범위나
 * maxClusterMs를 넘기 직전에도 강제로 끊는다. 순수(입력만으로 결정).
 */
export function planWebmClusters(
  frameTicks: readonly { ticks: number; keyFrame: boolean; data: Uint8Array }[],
  maxClusterTicks: number
): ClusterPlanEntry[] {
  const clusters: ClusterPlanEntry[] = [];
  let current: ClusterPlanEntry | null = null;
  for (const frame of frameTicks) {
    const relative = current ? frame.ticks - current.startTicks : 0;
    const overflow =
      current !== null &&
      (relative > Math.min(maxClusterTicks, WEBM_MAX_BLOCK_RELATIVE_TICKS) ||
        (frame.keyFrame && current.frames.length > 0));
    if (current === null || overflow) {
      current = { startTicks: frame.ticks, frames: [] };
      clusters.push(current);
    }
    current.frames.push({
      relativeTicks: frame.ticks - current.startTicks,
      keyFrame: frame.keyFrame,
      data: frame.data,
    });
  }
  return clusters;
}

function clusterBytes(cluster: ClusterPlanEntry): Uint8Array {
  const parts: Uint8Array[] = [ebmlUint(EBML_ID.timestamp, cluster.startTicks)];
  for (const frame of cluster.frames) {
    parts.push(
      simpleBlockBytes(WEBM_VIDEO_TRACK_NUMBER, frame.relativeTicks, frame.keyFrame, frame.data)
    );
  }
  return ebmlElement(EBML_ID.cluster, concatBytes(parts));
}

function cuesBytes(cuePoints: readonly { timeTicks: number; clusterPosition: number }[]): Uint8Array {
  const points = cuePoints.map((point) =>
    ebmlElement(
      EBML_ID.cuePoint,
      concatBytes([
        ebmlUint(EBML_ID.cueTime, point.timeTicks),
        ebmlElement(
          EBML_ID.cueTrackPositions,
          concatBytes([
            ebmlUint(EBML_ID.cueTrack, WEBM_VIDEO_TRACK_NUMBER),
            ebmlUint(EBML_ID.cueClusterPosition, point.clusterPosition),
          ])
        ),
      ])
    )
  );
  return ebmlElement(EBML_ID.cues, concatBytes(points));
}

function seekEntryBytes(targetId: number, position: number): Uint8Array {
  return ebmlElement(
    EBML_ID.seek,
    concatBytes([
      ebmlElement(EBML_ID.seekId, ebmlIdBytes(targetId)),
      ebmlElement(EBML_ID.seekPosition, ebmlUintBytes(position, SEEK_POSITION_BYTES)),
    ])
  );
}

function seekHeadBytes(infoPos: number, tracksPos: number, cuesPos: number): Uint8Array {
  return ebmlElement(
    EBML_ID.seekHead,
    concatBytes([
      seekEntryBytes(EBML_ID.info, infoPos),
      seekEntryBytes(EBML_ID.tracks, tracksPos),
      seekEntryBytes(EBML_ID.cues, cuesPos),
    ])
  );
}

/**
 * SeekHead 전체 크기(B) — SeekPosition을 8바이트 고정 폭으로 쓰기 때문에 내용과 무관한 상수다.
 * 이 상수 덕분에 Info/Tracks/Cues 오프셋을 한 번에 확정할 수 있다(반복 수렴 불필요).
 */
export const WEBM_SEEK_HEAD_BYTES = seekHeadBytes(0, 0, 0).length;

// ── 공개 API ──────────────────────────────────────────────────────────────

/** µs 타임스탬프 → TimestampScale 눈금. 순수·결정적(반올림 규칙 고정). */
export function ticksFromMicroseconds(timestampUs: number, timestampScaleNs: number): number {
  return Math.round((timestampUs * 1000) / timestampScaleNs);
}

/**
 * 인코딩된 프레임들을 하나의 .webm 바이트열로 묶는다. 프레임은 타임스탬프 오름차순이어야 하고,
 * 첫 프레임은 반드시 키프레임이어야 한다(그렇지 않으면 첫 Cluster가 디코딩 불가).
 */
export function muxWebm(options: WebmMuxOptions): WebmMuxResult {
  const { track, frames } = options;
  // TypeScript types do not protect persisted/plugin/worker data at runtime. Resolve the explicit
  // technical/distribution profile before writing any bytes, and fail closed for unknown codecs.
  studioWebmCodecLegalProfile(track.codecId);
  if (frames.length === 0) throw new Error("WebM으로 묶을 프레임이 없어요.");
  if (!frames[0]!.keyFrame) throw new Error("첫 프레임은 키프레임이어야 해요.");
  const timestampScaleNs = Math.max(1, Math.round(options.timestampScaleNs ?? WEBM_DEFAULT_TIMESTAMP_SCALE_NS));
  const maxClusterTicks = Math.max(
    1,
    ticksFromMicroseconds((options.maxClusterMs ?? WEBM_DEFAULT_MAX_CLUSTER_MS) * 1000, timestampScaleNs)
  );
  const writingApp = options.writingApp ?? WEBM_WRITING_APP;

  const ticked = frames.map((frame, index) => {
    if (frame.timestampUs < 0) throw new Error("음수 타임스탬프는 담을 수 없어요.");
    if (index > 0 && frame.timestampUs < frames[index - 1]!.timestampUs) {
      throw new Error("프레임 타임스탬프가 오름차순이 아니에요.");
    }
    return {
      ticks: ticksFromMicroseconds(frame.timestampUs, timestampScaleNs),
      keyFrame: frame.keyFrame,
      data: frame.data,
    };
  });

  const lastFrame = frames[frames.length - 1]!;
  const durationTicks = ticksFromMicroseconds(
    lastFrame.timestampUs + Math.max(0, lastFrame.durationUs ?? 0),
    timestampScaleNs
  );

  const clusters = planWebmClusters(ticked, maxClusterTicks);
  const clusterChunks = clusters.map((cluster) => clusterBytes(cluster));

  const info = infoBytes(timestampScaleNs, durationTicks, writingApp);
  const tracks = tracksBytes(track);

  // Segment 데이터 시작(=SeekHead 첫 바이트) 기준 오프셋.
  const infoPos = WEBM_SEEK_HEAD_BYTES;
  const tracksPos = infoPos + info.length;
  const clustersPos = tracksPos + tracks.length;
  const cuePoints: { timeTicks: number; clusterPosition: number }[] = [];
  let cursor = clustersPos;
  clusters.forEach((cluster, index) => {
    cuePoints.push({ timeTicks: cluster.startTicks, clusterPosition: cursor });
    cursor += clusterChunks[index]!.length;
  });
  const cues = cuesBytes(cuePoints);
  const seekHead = seekHeadBytes(infoPos, tracksPos, cursor);

  const segmentPayload = concatBytes([seekHead, info, tracks, ...clusterChunks, cues]);
  const bytes = concatBytes([ebmlHeaderBytes(), ebmlElement(EBML_ID.segment, segmentPayload)]);
  return { bytes, clusterCount: clusters.length, durationTicks };
}

/** 파일 저장/다운로드용 MIME — 코덱 문자열을 포함하면 플레이어 힌트가 정확해진다. */
export function webmMimeType(codecString?: string): string {
  return codecString ? `video/webm; codecs="${codecString}"` : "video/webm";
}
