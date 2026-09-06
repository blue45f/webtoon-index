/**
 * Studio WebCodecs — 하드웨어 가속 영상 내보내기 오케스트레이터.
 *
 * 기존 경로(MediaRecorder + canvas.captureStream)의 두 가지 근본 문제를 없앤다.
 *  · 속도: 실시간 녹화라 60초 영상이면 내보내기도 60초 걸렸다. 여기서는 프레임을 만드는 즉시
 *    VideoEncoder에 밀어 넣으므로 GPU/CPU가 허용하는 최고 속도로 진행된다(디코드 대기 없음).
 *  · 결정성: rAF 벽시계에 물려 있어 느린 기기에서 프레임이 드롭됐다. 여기서는 타임스탬프가
 *    studio-webcodecs-timeline의 순수 계산값이라 같은 문서면 같은 프레임 수·같은 시간축이 나온다.
 *
 * 브라우저 접촉은 전부 `WebCodecsVideoExportDeps` 주입 심으로 격리했다 — node에는 VideoEncoder도
 * VideoFrame도 없지만, 이 파일의 흐름(백프레셔·키프레임 지정·취소·chunk 수집·muxing)은 가짜
 * 인코더로 전부 검증된다. 컨테이너 조립은 studio-webcodecs-webm의 순수 muxer가 담당한다.
 */

import { muxWebm, webmMimeType, type WebmVideoCodecId } from "../studio-webcodecs-webm";

import type { StudioVideoTimeline, StudioVideoTimelineFrame } from "../studio-webcodecs-timeline";

// ── 주입 심(WebCodecs 최소 서브셋) ────────────────────────────────────────

export interface EncodedVideoChunkLike {
  readonly type: "delta" | "key";
  readonly timestamp: number; // µs
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: AllowSharedBufferSource): void;
}

/** VideoEncoder output 콜백의 2번째 인자 중 우리가 쓰는 부분(AV1/VP9 CodecPrivate). */
export interface EncodedVideoChunkMetadataLike {
  decoderConfig?: { description?: AllowSharedBufferSource | null } | null;
}

export interface VideoFrameLike {
  close(): void;
}

export interface VideoEncoderLike {
  readonly encodeQueueSize: number;
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrameLike, options?: { keyFrame?: boolean }): void;
  flush(): Promise<void>;
  close(): void;
}

export interface WebCodecsVideoExportDeps {
  createEncoder(handlers: {
    output(chunk: EncodedVideoChunkLike, metadata?: EncodedVideoChunkMetadataLike): void;
    error(error: unknown): void;
  }): VideoEncoderLike;
  /**
   * 타임라인 프레임 1장을 그려 VideoFrame으로 만든다. 실구현은 캔버스에 sourceIndex 프레임을
   * 렌더한 뒤 `new VideoFrame(canvas, { timestamp, duration })`을 돌려준다.
   * 반드시 timestamp/duration을 프레임 스펙 그대로 써야 컨테이너 시간축이 어긋나지 않는다.
   */
  createFrame(frame: StudioVideoTimelineFrame): Promise<VideoFrameLike> | VideoFrameLike;
  /** 인코더 큐가 찼을 때 이벤트 루프에 양보한다(UI 프리즈 방지 + 큐 소진 대기). */
  yieldToUi(): Promise<void>;
}

export function createDefaultWebCodecsYield(): () => Promise<void> {
  return () => new Promise<void>((resolve) => setTimeout(resolve, 0));
}

// ── 취소 규약 ─────────────────────────────────────────────────────────────

export class WebCodecsExportCancelledError extends Error {
  constructor() {
    super("영상 내보내기를 취소했어요.");
    this.name = "WebCodecsExportCancelledError";
  }
}

export function isWebCodecsExportCancelled(error: unknown): boolean {
  return error instanceof WebCodecsExportCancelledError;
}

// ── 요청/결과 ─────────────────────────────────────────────────────────────

export interface WebCodecsVideoExportProgress {
  phase: "encode" | "finalize" | "flush";
  /** 인코더에 투입 완료한 프레임 수. */
  encodedFrames: number;
  totalFrames: number;
  ratio: number; // 0..1
}

export interface WebCodecsVideoExportRequest {
  timeline: StudioVideoTimeline;
  config: VideoEncoderConfig;
  webmCodecId: WebmVideoCodecId;
  /** 코덱 문자열(파일 MIME 힌트) — 보통 config.codec와 같다. */
  codecString?: string;
  /** 인코더 큐 상한 — 넘으면 yieldToUi로 소진을 기다린다(메모리 상한 역할). */
  maxQueueSize?: number;
  onProgress?: (progress: WebCodecsVideoExportProgress) => void;
  deps: WebCodecsVideoExportDeps;
}

export interface WebCodecsVideoExportResult {
  bytes: Uint8Array;
  mimeType: string;
  durationSec: number;
  frameCount: number;
  keyFrameCount: number;
  clusterCount: number;
  codecString: string;
}

export interface WebCodecsVideoExportHandle {
  done: Promise<WebCodecsVideoExportResult>;
  cancel(): void;
}

interface RunState {
  cancelled: boolean;
}

const DEFAULT_MAX_QUEUE_SIZE = 8;

/**
 * 내보내기를 시작한다. 반환 핸들의 done을 await — 취소 시 WebCodecsExportCancelledError로
 * reject된다(isWebCodecsExportCancelled로 판별). 통합 어댑터가 이를 기존 MotionExport 취소
 * 규약(MotionExportCancelledError)으로 감싸면 패널 UI는 그대로 재사용된다.
 */
export function startWebCodecsVideoExport(
  request: WebCodecsVideoExportRequest
): WebCodecsVideoExportHandle {
  const state: RunState = { cancelled: false };
  return {
    done: runWebCodecsVideoExport(request, state),
    cancel() {
      state.cancelled = true; // 다음 프레임 경계에서 폴링해 중단한다
    },
  };
}

async function runWebCodecsVideoExport(
  request: WebCodecsVideoExportRequest,
  state: RunState
): Promise<WebCodecsVideoExportResult> {
  const { timeline, deps } = request;
  const total = timeline.frames.length;
  if (total === 0) throw new Error("내보낼 프레임이 없어요.");
  if (!timeline.frames[0]!.keyFrame) throw new Error("타임라인 첫 프레임이 키프레임이 아니에요.");

  const maxQueueSize = Math.max(1, Math.round(request.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE));
  const chunks: { data: Uint8Array; timestampUs: number; durationUs: number; keyFrame: boolean }[] = [];
  let codecPrivate: Uint8Array | null = null;
  let encoderError: unknown = null;

  const encoder = deps.createEncoder({
    output(chunk, metadata) {
      const description = metadata?.decoderConfig?.description;
      if (description && !codecPrivate) codecPrivate = toBytes(description);
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        data,
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? 0,
        keyFrame: chunk.type === "key",
      });
    },
    error(error) {
      encoderError = error;
    },
  });

  const throwIfBroken = (): void => {
    if (state.cancelled) throw new WebCodecsExportCancelledError();
    if (encoderError) throw new Error("영상 인코딩 중 오류가 발생했어요. 다시 시도해주세요.");
  };

  try {
    encoder.configure(request.config);
    for (let index = 0; index < total; index += 1) {
      throwIfBroken();
      // 백프레셔 — 큐가 상한을 넘으면 소진될 때까지 양보한다(무한 대기 방지를 위해 오류도 폴링).
      let guard = 0;
      while (encoder.encodeQueueSize >= maxQueueSize && !state.cancelled && !encoderError) {
        await deps.yieldToUi();
        guard += 1;
        if (guard > 100_000) throw new Error("인코더 큐가 소진되지 않아요. 다시 시도해주세요.");
      }
      throwIfBroken();

      const spec = timeline.frames[index]!;
      const frame = await deps.createFrame(spec);
      try {
        encoder.encode(frame, { keyFrame: spec.keyFrame });
      } finally {
        frame.close(); // VideoFrame은 GC를 기다리면 안 된다 — 즉시 반납
      }
      request.onProgress?.({
        phase: "encode",
        encodedFrames: index + 1,
        totalFrames: total,
        ratio: (index + 1) / (total + 1), // flush 몫 1프레임을 남겨둔다
      });
    }

    throwIfBroken();
    request.onProgress?.({ phase: "flush", encodedFrames: total, totalFrames: total, ratio: 1 });
    await encoder.flush();
    throwIfBroken();
    if (chunks.length === 0) throw new Error("인코딩된 영상 데이터가 없어요. 다시 시도해주세요.");

    request.onProgress?.({ phase: "finalize", encodedFrames: total, totalFrames: total, ratio: 1 });
    const muxed = muxWebm({
      track: {
        codecId: request.webmCodecId,
        width: request.config.width,
        height: request.config.height,
        codecPrivate,
        defaultDurationNs: timeline.defaultFrameDurationNs,
      },
      frames: chunks.map((chunk) => ({
        data: chunk.data,
        timestampUs: chunk.timestampUs,
        durationUs: chunk.durationUs,
        keyFrame: chunk.keyFrame,
      })),
    });
    const codecString = request.codecString ?? request.config.codec;
    return {
      bytes: muxed.bytes,
      mimeType: webmMimeType(codecString),
      durationSec: timeline.durationUs / 1_000_000,
      frameCount: chunks.length,
      keyFrameCount: chunks.filter((chunk) => chunk.keyFrame).length,
      clusterCount: muxed.clusterCount,
      codecString,
    };
  } finally {
    try {
      encoder.close();
    } catch {
      // 이미 닫힌 인코더 — 무시
    }
  }
}

function toBytes(source: AllowSharedBufferSource): Uint8Array {
  if (source instanceof Uint8Array) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }
  return new Uint8Array(source.slice(0));
}

/** 결과 바이트를 다운로드 가능한 Blob으로 — 브라우저 통합 지점에서만 쓴다. */
export function createWebCodecsVideoBlob(result: WebCodecsVideoExportResult): Blob {
  return new Blob([result.bytes as unknown as BlobPart], { type: result.mimeType });
}

/** 파일명 규칙 — 기존 `<제목>-motion.webm` 계열과 나란하게 유지한다. */
export function webCodecsVideoFileName(title: string, suffix: string): string {
  return `${title.trim() || "toonspectrum"}-${suffix}.webm`;
}
