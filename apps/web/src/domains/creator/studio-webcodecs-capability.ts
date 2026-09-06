/**
 * Studio WebCodecs — 코덱 탐지(capability probing)와 exact 파이프라인 계약.
 *
 * WebCodecs `VideoEncoder.isConfigSupported()`는 "이 설정을 실제로 인코딩할 수 있는가"를
 * 브라우저에 직접 물어보는 유일한 정직한 수단이다(MediaRecorder.isTypeSupported의 MIME 문자열
 * 추측보다 훨씬 정확하다 — 해상도·fps·하드웨어 가속 여부까지 함께 판정된다).
 *
 * 이 모듈이 지키는 계약 두 가지:
 *  1) **선택 고정.** 실행 전에 고른 WebCodecs/MediaRecorder/GIF/APNG 하나만 capability 검사한다.
 *     선택한 provider가 없으면 unavailable을 돌려주며 다른 파이프라인으로 자동 전환하지 않는다.
 *  2) **속도 우선 순위는 의도적으로 VP9 > AV1이다.** AV1은 화질/용량은 최고지만 브라우저 인코더가
 *     대부분 소프트웨어(libaom/SVT-AV1)라 실시간보다 느린 경우가 많다 — "내보내기를 극적으로
 *     빠르게"라는 목표와 정면 충돌한다. 그래서 (a) 하드웨어 가속 가능한 코덱을 먼저 찾고,
 *     (b) 전부 소프트웨어라면 VP9 → VP8 → AV1 순으로 고른다.
 *
 * 순수 부분(코덱 문자열 산출·비트레이트 권장·exact 선택)은 전부 DOM 무의존이고, 브라우저 접촉은
 * `StudioVideoEncoderProbe` 주입 심(seam) 하나로 격리돼 node 테스트에서 가짜로 대체된다.
 */

import type { WebmVideoCodecId } from "./studio-webcodecs-webm";

export type StudioWebCodecsCodecId = "av1" | "vp8" | "vp9";

export interface StudioWebCodecsCodecCandidate {
  id: StudioWebCodecsCodecId;
  label: string;
  webmCodecId: WebmVideoCodecId;
  /** 해상도·fps에 맞는 RFC 6381 계열 코덱 문자열. */
  codecString(width: number, height: number, fps: number): string;
  /** 같은 비트레이트에서의 상대 효율(1.0 = VP8 기준) — 낮을수록 적은 비트로 같은 화질. */
  bitrateFactor: number;
  /** 하드웨어 인코더가 없을 때의 실용 순위(작을수록 먼저) — 소프트웨어 속도 기준. */
  softwareRank: number;
  /** 하드웨어 인코더가 있을 때의 선호 순위(작을수록 먼저) — 화질/보급률 기준. */
  hardwareRank: number;
}

// ── 코덱 문자열(레벨 계산 포함) ────────────────────────────────────────────

interface LevelRow {
  level: number;
  maxLumaPictureSize: number;
  maxLumaSampleRate: number;
}

// VP9 레벨(스펙 표 A.1) — 필요한 구간만. 두 자리 표기(10 = level 1.0).
const VP9_LEVELS: readonly LevelRow[] = [
  { level: 10, maxLumaPictureSize: 36_864, maxLumaSampleRate: 829_440 },
  { level: 11, maxLumaPictureSize: 73_728, maxLumaSampleRate: 2_764_800 },
  { level: 20, maxLumaPictureSize: 122_880, maxLumaSampleRate: 4_608_000 },
  { level: 21, maxLumaPictureSize: 245_760, maxLumaSampleRate: 9_216_000 },
  { level: 30, maxLumaPictureSize: 552_960, maxLumaSampleRate: 20_736_000 },
  { level: 31, maxLumaPictureSize: 983_040, maxLumaSampleRate: 36_864_000 },
  { level: 40, maxLumaPictureSize: 2_228_224, maxLumaSampleRate: 83_558_400 },
  { level: 41, maxLumaPictureSize: 2_228_224, maxLumaSampleRate: 160_432_128 },
  { level: 50, maxLumaPictureSize: 8_912_896, maxLumaSampleRate: 311_951_360 },
  { level: 51, maxLumaPictureSize: 8_912_896, maxLumaSampleRate: 588_251_136 },
  { level: 52, maxLumaPictureSize: 8_912_896, maxLumaSampleRate: 1_176_502_272 },
  { level: 60, maxLumaPictureSize: 35_651_584, maxLumaSampleRate: 1_176_502_272 },
  { level: 61, maxLumaPictureSize: 35_651_584, maxLumaSampleRate: 2_353_004_544 },
  { level: 62, maxLumaPictureSize: 35_651_584, maxLumaSampleRate: 4_706_009_088 },
];

// AV1 seq_level_idx(스펙 표 A.1) — 2.0(idx 0)부터 5.3(idx 15)까지.
const AV1_LEVELS: readonly LevelRow[] = [
  { level: 0, maxLumaPictureSize: 147_456, maxLumaSampleRate: 4_423_680 },
  { level: 1, maxLumaPictureSize: 278_784, maxLumaSampleRate: 8_363_520 },
  { level: 4, maxLumaPictureSize: 665_856, maxLumaSampleRate: 19_975_680 },
  { level: 5, maxLumaPictureSize: 1_065_024, maxLumaSampleRate: 31_950_720 },
  { level: 8, maxLumaPictureSize: 2_359_296, maxLumaSampleRate: 70_778_880 },
  { level: 9, maxLumaPictureSize: 2_359_296, maxLumaSampleRate: 141_557_760 },
  { level: 12, maxLumaPictureSize: 8_912_896, maxLumaSampleRate: 267_386_880 },
  { level: 13, maxLumaPictureSize: 8_912_896, maxLumaSampleRate: 534_773_760 },
  { level: 14, maxLumaPictureSize: 8_912_896, maxLumaSampleRate: 1_069_547_520 },
];

function pickLevel(rows: readonly LevelRow[], width: number, height: number, fps: number): number {
  const pictureSize = Math.max(1, Math.round(width)) * Math.max(1, Math.round(height));
  const sampleRate = pictureSize * Math.max(1, fps);
  for (const row of rows) {
    if (pictureSize <= row.maxLumaPictureSize && sampleRate <= row.maxLumaSampleRate) return row.level;
  }
  return rows[rows.length - 1]!.level;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** VP9 코덱 문자열 — `vp09.<profile>.<level>.<bitDepth>` (프로필 0 = 8bit 4:2:0). */
export function vp9CodecString(width: number, height: number, fps: number): string {
  return `vp09.00.${pad2(pickLevel(VP9_LEVELS, width, height, fps))}.08`;
}

/** AV1 코덱 문자열 — `av01.<profile>.<levelIdx><tier>.<bitDepth>` (Main profile, Main tier). */
export function av1CodecString(width: number, height: number, fps: number): string {
  return `av01.0.${pad2(pickLevel(AV1_LEVELS, width, height, fps))}M.08`;
}

export const STUDIO_WEBCODECS_CODECS: readonly StudioWebCodecsCodecCandidate[] = [
  {
    id: "vp9",
    label: "VP9",
    webmCodecId: "V_VP9",
    codecString: vp9CodecString,
    bitrateFactor: 0.7,
    softwareRank: 0,
    hardwareRank: 1,
  },
  {
    id: "av1",
    label: "AV1",
    webmCodecId: "V_AV1",
    codecString: av1CodecString,
    bitrateFactor: 0.55,
    softwareRank: 2,
    hardwareRank: 0,
  },
  {
    id: "vp8",
    label: "VP8",
    webmCodecId: "V_VP8",
    codecString: () => "vp8",
    bitrateFactor: 1,
    softwareRank: 1,
    hardwareRank: 2,
  },
];

// ── 비트레이트 권장 ────────────────────────────────────────────────────────

/** 기존 MediaRecorder 경로(recommendVideoBitsPerSecond)와 같은 픽셀레이트 기준·클램프. */
const BITS_PER_PIXEL = 0.12;
const MIN_BITRATE = 2_500_000;
const MAX_BITRATE = 16_000_000;

/**
 * 해상도·fps·코덱 효율로 권장 비트레이트(bps)를 구한다. 기존 WebM 경로와 같은 0.12bpp 기준선에
 * 코덱별 효율 계수를 곱해, 같은 체감 화질을 더 적은 용량으로 담는다. 순수.
 */
export function recommendWebCodecsBitrate(
  width: number,
  height: number,
  fps: number,
  codecId: StudioWebCodecsCodecId
): number {
  const candidate = STUDIO_WEBCODECS_CODECS.find((c) => c.id === codecId);
  const factor = candidate?.bitrateFactor ?? 1;
  const raw = width * height * fps * BITS_PER_PIXEL * factor;
  return Math.round(Math.min(MAX_BITRATE, Math.max(MIN_BITRATE, raw)));
}

// ── 탐지(주입형 심) ────────────────────────────────────────────────────────

export interface StudioVideoEncoderProbe {
  isConfigSupported(config: VideoEncoderConfig): Promise<{ supported?: boolean }>;
}

/** 실브라우저 기본 프로브 — WebCodecs가 없으면 null(선택 provider를 unavailable 처리한다). */
export function defaultVideoEncoderProbe(): StudioVideoEncoderProbe | null {
  if (typeof VideoEncoder === "undefined" || typeof VideoEncoder.isConfigSupported !== "function") {
    return null;
  }
  return { isConfigSupported: (config) => VideoEncoder.isConfigSupported(config) };
}

/** 인코딩 경로 전체(VideoEncoder + VideoFrame + EncodedVideoChunk)가 있는지. */
export function isWebCodecsVideoExportSupported(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof EncodedVideoChunk !== "undefined"
  );
}

export interface StudioCodecProbeRequest {
  width: number;
  height: number;
  fps: number;
  /** 지정하면 그 비트레이트로 탐지(미지정 시 권장값). */
  bitrate?: number;
  /** 탐지 대상 코덱 제한(테스트/설정용). */
  codecIds?: readonly StudioWebCodecsCodecId[];
}

export interface StudioCodecProbeResult {
  id: StudioWebCodecsCodecId;
  label: string;
  codecString: string;
  webmCodecId: WebmVideoCodecId;
  bitrate: number;
  /** 실제 하드웨어 사용 영수증이 아니라 prefer-hardware 설정이 capability probe에서 수락됐는가. */
  hardwarePreferenceAccepted: boolean;
}

function candidatesFor(request: StudioCodecProbeRequest): StudioWebCodecsCodecCandidate[] {
  const allow = request.codecIds;
  return STUDIO_WEBCODECS_CODECS.filter((c) => !allow || allow.includes(c.id));
}

/** 코덱 후보 하나의 VideoEncoderConfig를 만든다(순수). */
export function buildVideoEncoderConfig(
  candidate: StudioWebCodecsCodecCandidate,
  request: StudioCodecProbeRequest,
  hardwareAcceleration: HardwareAcceleration = "no-preference"
): VideoEncoderConfig {
  const width = Math.max(2, Math.round(request.width));
  const height = Math.max(2, Math.round(request.height));
  const fps = Math.max(1, Math.round(request.fps));
  return {
    codec: candidate.codecString(width, height, fps),
    width,
    height,
    framerate: fps,
    bitrate: request.bitrate ?? recommendWebCodecsBitrate(width, height, fps, candidate.id),
    bitrateMode: "variable",
    hardwareAcceleration,
    // 파일 내보내기는 지연보다 화질이 중요하다(실시간 스트리밍이 아니다).
    latencyMode: "quality",
    // 웹툰 원고는 선화·말풍선 텍스트가 지배적이라 디테일 보존 힌트가 링잉을 줄인다.
    contentHint: "detail",
  };
}

async function probeOne(
  candidate: StudioWebCodecsCodecCandidate,
  request: StudioCodecProbeRequest,
  probe: StudioVideoEncoderProbe,
  hardwareAcceleration: HardwareAcceleration
): Promise<StudioCodecProbeResult | null> {
  const config = buildVideoEncoderConfig(candidate, request, hardwareAcceleration);
  try {
    const support = await probe.isConfigSupported(config);
    if (support?.supported !== true) return null;
  } catch {
    return null; // 미지원 코덱 문자열에 throw하는 구현이 있어 예외도 "미지원"으로 취급한다.
  }
  return {
    id: candidate.id,
    label: candidate.label,
    codecString: config.codec,
    webmCodecId: candidate.webmCodecId,
    bitrate: config.bitrate ?? 0,
    hardwarePreferenceAccepted: hardwareAcceleration === "prefer-hardware",
  };
}

/** 모든 후보를 하드웨어/소프트웨어 두 패스로 탐지한 결과(순위 정렬 전 원본). */
export async function probeStudioVideoCodecs(
  request: StudioCodecProbeRequest,
  probe: StudioVideoEncoderProbe
): Promise<StudioCodecProbeResult[]> {
  const candidates = candidatesFor(request);
  const results: StudioCodecProbeResult[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.hardwareRank - b.hardwareRank)) {
    const hardware = await probeOne(candidate, request, probe, "prefer-hardware");
    if (hardware) results.push(hardware);
  }
  for (const candidate of [...candidates].sort((a, b) => a.softwareRank - b.softwareRank)) {
    if (results.some((r) => r.id === candidate.id)) continue;
    const software = await probeOne(candidate, request, probe, "no-preference");
    if (software) results.push(software);
  }
  return results;
}

/**
 * 최종 코덱 선택 — prefer-hardware 설정이 수락된 후보를 먼저 정렬하고, 없으면 no-preference
 * 후보를 softwareRank로 정렬한다. 이 결과는 실제 하드웨어 가속 영수증을 뜻하지 않는다.
 */
export async function selectStudioVideoCodec(
  request: StudioCodecProbeRequest,
  probe: StudioVideoEncoderProbe | null
): Promise<StudioCodecProbeResult | null> {
  if (!probe) return null;
  const results = await probeStudioVideoCodecs(request, probe);
  if (results.length === 0) return null;
  const rankOf = (result: StudioCodecProbeResult): number => {
    const candidate = STUDIO_WEBCODECS_CODECS.find((c) => c.id === result.id)!;
    return result.hardwarePreferenceAccepted ? candidate.hardwareRank : candidate.softwareRank;
  };
  const preferred = results.filter((r) => r.hardwarePreferenceAccepted);
  const pool = preferred.length > 0 ? preferred : results;
  return [...pool].sort((a, b) => rankOf(a) - rankOf(b))[0]!;
}

// ── 실행 전 exact 파이프라인 계약 ───────────────────────────────────────────

export type StudioExportPipelineId = "apng" | "gif" | "mediarecorder-webm" | "webcodecs-webm";

export interface StudioExportPipelineInput {
  /** 사용자가/호출자가 실행 전에 고른 단 하나의 파이프라인. */
  selectedPipeline: StudioExportPipelineId;
  /** selectStudioVideoCodec 결과(없으면 null). */
  webCodecsCodec: StudioCodecProbeResult | null;
  /** 기존 MediaRecorder 경로 지원 여부(isMotionExportSupported()). */
  mediaRecorderSupported: boolean;
  /** 순수 TS GIF/APNG 인코더 경로 지원 여부(isFrameAnimMediaExportSupported()). */
  pureEncoderSupported: boolean;
  /** true면 WebCodecs가 가능해도 쓰지 않는다(사용자 설정·A/B 대조용 킬스위치). */
  disableWebCodecs?: boolean;
}

export interface StudioExportPipelineDecision {
  pipeline: StudioExportPipelineId;
  codec: StudioCodecProbeResult | null;
  /** 실제로 내보내기가 가능한가 — false면 어떤 경로도 없다(UI가 안내를 띄운다). */
  available: boolean;
  /** UI에 그대로 노출 가능한 한국어 사유. */
  reason: string;
}

/**
 * 선택된 파이프라인 하나의 capability만 판정한다. unavailable이어도 다른 provider를 고르지 않는다.
 */
export function selectExportPipeline(input: StudioExportPipelineInput): StudioExportPipelineDecision {
  if (input.selectedPipeline === "webcodecs-webm") {
    const codec = input.webCodecsCodec;
    if (input.disableWebCodecs || !codec) {
      return {
        pipeline: "webcodecs-webm",
        codec: null,
        available: false,
        reason: input.disableWebCodecs
          ? "선택한 WebCodecs 파이프라인이 설정에서 비활성화되어 있어요. 다른 형식으로 전환하지 않았어요."
          : "선택한 WebCodecs 파이프라인에 사용 가능한 코덱이 없어요. 다른 형식으로 전환하지 않았어요.",
      };
    }
    return {
      pipeline: "webcodecs-webm",
      codec,
      available: true,
      reason: codec.hardwarePreferenceAccepted
        ? `${codec.label} prefer-hardware 설정이 수락된 WebCodecs 인코더로 내보내요.`
        : `${codec.label} no-preference WebCodecs 인코더로 내보내요.`,
    };
  }
  if (input.selectedPipeline === "mediarecorder-webm") {
    return {
      pipeline: "mediarecorder-webm",
      codec: null,
      available: input.mediaRecorderSupported,
      reason: input.mediaRecorderSupported
        ? "선택한 MediaRecorder WebM 파이프라인으로 내보내요."
        : "선택한 MediaRecorder WebM 파이프라인을 사용할 수 없어요. 다른 형식으로 전환하지 않았어요.",
    };
  }
  const format = input.selectedPipeline;
  return {
    pipeline: format,
    codec: null,
    available: input.pureEncoderSupported,
    reason: input.pureEncoderSupported
      ? `선택한 ${format.toUpperCase()} 인코더로 내보내요.`
      : `선택한 ${format.toUpperCase()} 인코더를 사용할 수 없어요. 다른 형식으로 전환하지 않았어요.`,
  };
}
