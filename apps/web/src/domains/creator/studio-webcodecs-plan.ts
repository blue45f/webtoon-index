/**
 * Studio WebCodecs — 내보내기 계획 해석기(경로 선택 + 타임라인 + 인코더 설정을 한 번에).
 *
 * 세 패널(모션툰·프레임 애니메이션·타임랩스)이 각자 코덱 탐지·타임라인 계산·선택 검증을 다시
 * 짜지 않도록, "무엇을 몇 fps로 내보낼 것인가"만 넘기면 실행 직전 상태를 통째로 돌려준다.
 *
 * 반환값 하나로 UI가 필요한 걸 전부 알 수 있다:
 *  · decision.pipeline — 어떤 엔진을 돌릴지(WebCodecs / 기존 MediaRecorder / GIF·APNG)
 *  · decision.reason — 사용자에게 그대로 보여줄 한국어 안내
 *  · webCodecs — WebCodecs 경로일 때 startWebCodecsVideoExport에 그대로 넘길 인자
 *  · estimated* — 진행률·예상 용량 표시용 수치
 *
 * probe(브라우저 접촉)만 주입형이고 나머지는 전부 순수 계산이다.
 */

import {
  buildVideoEncoderConfig,
  selectExportPipeline,
  selectStudioVideoCodec,
  STUDIO_WEBCODECS_CODECS,
  type StudioExportPipelineDecision,
  type StudioExportPipelineId,
  type StudioVideoEncoderProbe,
} from "./studio-webcodecs-capability";
import {
  normalizeExportFps,
  planConstantRateTimeline,
  planResampledTimeline,
  planVariableRateTimeline,
  timelineDurationSec,
  type StudioVideoTimeline,
} from "./studio-webcodecs-timeline";

import type { WebmVideoCodecId } from "./studio-webcodecs-webm";

/**
 * 프레임 시간 모델.
 * · "cfr" — fps 그리드에 맞춘 고정 프레임레이트(모션툰·타임랩스처럼 매 프레임 새로 렌더하는 경로).
 * · "vfr" — 프레임별 노출 시간 보존(셀 애니메이션). 인코딩할 프레임 수가 훨씬 적다.
 * · "auto" — 노출 시간이 균일하지 않으면 vfr, 균일하면 cfr.
 */
export type StudioVideoTimingMode = "auto" | "cfr" | "vfr";

export interface StudioVideoExportPlanRequest {
  width: number;
  height: number;
  fps: number;
  /** 소스 프레임별 노출 시간(ms). 없으면 frameCount 기반 CFR. */
  durationsMs?: readonly number[];
  /** durationsMs가 없을 때의 프레임 수. */
  frameCount?: number;
  loopCount?: number;
  mode?: StudioVideoTimingMode;
  keyFrameIntervalSec?: number;
  bitrate?: number;
  /** 실행 전에 명시적으로 고른 provider. capability 실패 뒤에는 바뀌지 않는다. */
  selectedPipeline: StudioExportPipelineId;
  /** 기존 경로 지원 여부 — 호출부가 isMotionExportSupported() 등으로 채운다. */
  mediaRecorderSupported: boolean;
  pureEncoderSupported: boolean;
  disableWebCodecs?: boolean;
}

export interface StudioWebCodecsRunSpec {
  timeline: StudioVideoTimeline;
  config: VideoEncoderConfig;
  webmCodecId: WebmVideoCodecId;
  codecString: string;
}

export interface StudioVideoExportPlan {
  decision: StudioExportPipelineDecision;
  /** WebCodecs 경로일 때만 채워진다 — startWebCodecsVideoExport에 그대로 넘긴다. */
  webCodecs: StudioWebCodecsRunSpec | null;
  timingMode: "cfr" | "vfr";
  estimatedDurationSec: number;
  estimatedFrameCount: number;
}

/** 노출 시간이 사실상 균일한가(±1ms) — auto 모드의 판정 기준. 순수. */
export function hasUniformFrameDurations(durationsMs: readonly number[]): boolean {
  if (durationsMs.length <= 1) return true;
  const first = durationsMs[0]!;
  return durationsMs.every((duration) => Math.abs(duration - first) <= 1);
}

/** 요청에서 실제 사용할 시간 모델을 확정한다. 순수. */
export function resolveTimingMode(request: StudioVideoExportPlanRequest): "cfr" | "vfr" {
  const durations = request.durationsMs;
  if (!durations || durations.length === 0) return "cfr";
  const mode = request.mode ?? "auto";
  if (mode === "cfr") return "cfr";
  if (mode === "vfr") return "vfr";
  return hasUniformFrameDurations(durations) ? "cfr" : "vfr";
}

/** 요청 → 타임라인(순수). 코덱 탐지 없이 프레임 수·길이만 먼저 알고 싶을 때도 쓴다. */
export function planStudioVideoTimeline(request: StudioVideoExportPlanRequest): StudioVideoTimeline {
  const fps = normalizeExportFps(request.fps);
  const timing = resolveTimingMode(request);
  const durations = request.durationsMs;
  if (durations && durations.length > 0) {
    if (timing === "vfr") {
      return planVariableRateTimeline({
        durationsMs: durations,
        loopCount: request.loopCount,
        keyFrameIntervalSec: request.keyFrameIntervalSec,
        nominalFps: fps,
      });
    }
    return planResampledTimeline({
      durationsMs: durations,
      fps,
      loopCount: request.loopCount,
      keyFrameIntervalSec: request.keyFrameIntervalSec,
    });
  }
  return planConstantRateTimeline({
    frameCount: Math.max(0, Math.round(request.frameCount ?? 0)) * Math.max(1, Math.round(request.loopCount ?? 1)),
    fps,
    keyFrameIntervalSec: request.keyFrameIntervalSec,
  });
}

/**
 * 실행 직전 계획을 확정한다. 선택한 provider가 없으면 unavailable 결정을 돌려주고 다른 provider로
 * 자동 전환하지 않는다.
 */
export async function resolveStudioVideoExportPlan(
  request: StudioVideoExportPlanRequest,
  probe: StudioVideoEncoderProbe | null
): Promise<StudioVideoExportPlan> {
  const timeline = planStudioVideoTimeline(request);
  const timingMode = resolveTimingMode(request);
  const fps = normalizeExportFps(request.fps);
  const codec =
    request.selectedPipeline !== "webcodecs-webm" || request.disableWebCodecs === true
      ? null
      : await selectStudioVideoCodec(
          { width: request.width, height: request.height, fps, bitrate: request.bitrate },
          probe
        );
  const decision = selectExportPipeline({
    selectedPipeline: request.selectedPipeline,
    webCodecsCodec: codec,
    mediaRecorderSupported: request.mediaRecorderSupported,
    pureEncoderSupported: request.pureEncoderSupported,
    disableWebCodecs: request.disableWebCodecs,
  });

  let webCodecs: StudioWebCodecsRunSpec | null = null;
  if (decision.pipeline === "webcodecs-webm" && codec && timeline.frames.length > 0) {
    const candidate = STUDIO_WEBCODECS_CODECS.find((entry) => entry.id === codec.id)!;
    const config = buildVideoEncoderConfig(
      candidate,
      { width: request.width, height: request.height, fps, bitrate: codec.bitrate },
      codec.hardwarePreferenceAccepted ? "prefer-hardware" : "no-preference"
    );
    webCodecs = {
      timeline,
      config,
      webmCodecId: codec.webmCodecId,
      codecString: config.codec,
    };
  }

  return {
    decision,
    webCodecs,
    timingMode,
    estimatedDurationSec: timelineDurationSec(timeline),
    estimatedFrameCount: timeline.frames.length,
  };
}
