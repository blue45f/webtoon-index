/**
 * Studio WebCodecs — 애니메이션 이미지(GIF/APNG/WebP/AVIF)를 **편집 가능한 프레임**으로 가져오기.
 *
 * 지금까지 스튜디오는 애니메이션 GIF를 디코딩하지 않았다(studio-gif-element 헤더 참고): `<img>`가
 * 알아서 재생해주니 "이건 애니메이션이다"라는 판정만 하고 원본 바이트를 통째로 보관했다. 그래서
 * 업로드한 GIF는 **재생만 되고 편집은 불가능한 블랙박스**였다 — 프레임 하나를 지우거나, 순서를
 * 바꾸거나, 위에 선을 덧그릴 수 없었다.
 *
 * `ImageDecoder`는 그 벽을 없앤다. 브라우저의 네이티브 디코더(우리가 LZW 디코더를 새로 쓸 필요
 * 없음)로 프레임별 VideoFrame과 정확한 표시 시간(µs)을 얻어, 프레임 애니메이션 셀 목록으로
 * 그대로 흡수할 수 있다.
 *
 * 이 파일의 계약:
 *  · 프레임 **플랜 계산은 순수**다 — 프레임 수·표시 시간·최대 프레임 예산만으로 결정된다.
 *  · 디코더 접촉은 `AnimatedImageDecodeDeps` 주입 심 하나 — node 테스트에서 가짜 디코더로 대체.
 *  · ImageDecoder가 없으면 `isAnimatedImageDecodeSupported()`가 false → 호출부는 기존 동작
 *    (원본 바이트를 <img>로 재생)을 그대로 유지한다. 하드 실패 없음.
 */

/** ImageDecoder가 애니메이션으로 다룰 수 있는 MIME(브라우저별 실제 지원은 런타임 판정). */
export const ANIMATED_IMAGE_DECODE_MIME = [
  "image/apng",
  "image/avif",
  "image/gif",
  "image/png",
  "image/webp",
] as const;

/** 한 번에 가져올 프레임 수 상한 — 100프레임짜리 GIF가 편집 문서를 폭파시키지 않게. */
export const DEFAULT_MAX_IMPORT_FRAMES = 120;
/** 표시 시간이 0/미상인 프레임의 기본값(ms) — GIF delay=0을 브라우저가 해석하는 관행값. */
export const DEFAULT_IMPORT_FRAME_DURATION_MS = 100;
/** 프레임 애니메이션 편집기가 받아들이는 fps 상한(studio-frame-animation-timing과 동일). */
const MAX_SUGGESTED_FPS = 30;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** ImageDecoder 경로를 쓸 수 있는지. */
export function isAnimatedImageDecodeSupported(): boolean {
  return typeof ImageDecoder !== "undefined";
}

/** 이 MIME을 애니메이션 프레임으로 열어볼 가치가 있는지(정적 이미지도 1프레임으로 열린다). */
export function isAnimatedImageDecodeMime(mime: string): boolean {
  return (ANIMATED_IMAGE_DECODE_MIME as readonly string[]).includes(mime.trim().toLowerCase());
}

// ── 순수 플랜 모델 ────────────────────────────────────────────────────────

/**
 * count개 중 최대 maxCount개를 균등 간격으로 고른다(항상 첫/마지막 포함, 반올림 충돌은 dedupe).
 * studio-timelapse의 thinTimelapseSteps와 같은 규칙 — "긴 소스를 편집 가능한 크기로 줄인다"는
 * 문제가 같기 때문에 같은 규칙을 쓴다(사용자가 두 기능에서 같은 감각을 얻는다).
 */
export function selectEvenlySpacedIndices(count: number, maxCount: number): number[] {
  const total = Math.max(0, Math.floor(count));
  const cap = Math.max(1, Math.floor(maxCount));
  if (total === 0) return [];
  if (total <= cap) return Array.from({ length: total }, (_, index) => index);
  if (cap === 1) return [0];
  const result: number[] = [];
  const last = total - 1;
  for (let k = 0; k < cap; k += 1) {
    const index = Math.round((k * last) / (cap - 1));
    if (result.length === 0 || result[result.length - 1] !== index) result.push(index);
  }
  return result;
}

export interface AnimatedImageFramePlanEntry {
  /** 원본 애니메이션에서의 프레임 번호. */
  sourceIndex: number;
  /**
   * 편집기에 넣을 노출 시간(ms). 솎아낸 프레임이 있으면 그 프레임들의 시간을 흡수해
   * **총 재생 시간이 원본과 같게** 유지한다.
   */
  durationMs: number;
}

export interface AnimatedImageFramePlan {
  frames: AnimatedImageFramePlanEntry[];
  /** 플랜 총 길이(ms) — 원본 총 길이와 같아야 한다(솎아내기 손실 없음). */
  totalDurationMs: number;
  /** 원본 프레임 수. */
  sourceFrameCount: number;
  /** 예산 때문에 버린 프레임 수. */
  droppedFrameCount: number;
  loopForever: boolean;
  /** loopForever가 false일 때의 반복 횟수(1 이상). */
  loopCount: number;
  /** 편집기 기본 fps 제안값 — 평균 노출 시간의 역수(1..30). */
  suggestedFps: number;
}

export interface AnimatedImageFramePlanRequest {
  /** 프레임별 표시 시간(µs). null/0은 기본값으로 대체한다. */
  frameDurationsUs: readonly (number | null | undefined)[];
  /** ImageDecoder track.repetitionCount — Infinity면 무한 반복. */
  repetitionCount?: number;
  maxFrames?: number;
  defaultFrameDurationMs?: number;
}

/**
 * 디코딩된 프레임 시간표 → 편집 가능한 프레임 플랜. 순수·결정적.
 * 솎아내기가 일어나도 남은 프레임이 버려진 프레임의 시간을 흡수하므로 총 길이가 보존된다.
 */
export function planAnimatedImageImport(
  request: AnimatedImageFramePlanRequest
): AnimatedImageFramePlan {
  const defaultMs = Math.max(1, request.defaultFrameDurationMs ?? DEFAULT_IMPORT_FRAME_DURATION_MS);
  const durationsMs = request.frameDurationsUs.map((durationUs) => {
    if (durationUs === null || durationUs === undefined || !Number.isFinite(durationUs) || durationUs <= 0) {
      return defaultMs;
    }
    return Math.max(1, Math.round(durationUs / 1000));
  });
  const sourceFrameCount = durationsMs.length;
  const kept = selectEvenlySpacedIndices(sourceFrameCount, request.maxFrames ?? DEFAULT_MAX_IMPORT_FRAMES);

  const frames: AnimatedImageFramePlanEntry[] = kept.map((sourceIndex, position) => {
    const end = position + 1 < kept.length ? kept[position + 1]! : sourceFrameCount;
    let durationMs = 0;
    for (let i = sourceIndex; i < end; i += 1) durationMs += durationsMs[i]!;
    return { sourceIndex, durationMs: Math.max(1, durationMs) };
  });

  const totalDurationMs = frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  const repetitionCount = request.repetitionCount;
  const loopForever = repetitionCount === undefined || !Number.isFinite(repetitionCount);
  const averageMs = frames.length > 0 ? totalDurationMs / frames.length : defaultMs;
  return {
    frames,
    totalDurationMs,
    sourceFrameCount,
    droppedFrameCount: sourceFrameCount - frames.length,
    loopForever,
    loopCount: loopForever ? 1 : Math.max(1, Math.round(repetitionCount)),
    suggestedFps: Math.round(clamp(1000 / Math.max(1, averageMs), 1, MAX_SUGGESTED_FPS)),
  };
}

// ── 디코더 오케스트레이터(주입 심) ────────────────────────────────────────

export interface DecodedImageFrameLike {
  readonly duration: number | null; // µs
  readonly timestamp: number; // µs
  readonly displayWidth: number;
  readonly displayHeight: number;
  close(): void;
}

export interface ImageDecoderTrackLike {
  readonly frameCount: number;
  readonly animated: boolean;
  readonly repetitionCount: number;
}

export interface ImageDecoderLike {
  readonly tracks: {
    readonly ready: Promise<void>;
    readonly selectedTrack: ImageDecoderTrackLike | null;
  };
  decode(options: { frameIndex: number }): Promise<{ image: DecodedImageFrameLike; complete: boolean }>;
  close(): void;
}

export interface AnimatedImageDecodeDeps<TFrame> {
  createDecoder(request: { data: Uint8Array; type: string }): ImageDecoderLike;
  /**
   * 디코딩된 프레임을 스튜디오가 보관할 형태로 바꾼다(실구현: OffscreenCanvas에 그려 PNG data URL).
   * 반드시 이 호출이 끝난 뒤 원본 프레임은 close된다 — 참조를 붙들면 안 된다.
   */
  materialize(image: DecodedImageFrameLike, planIndex: number): Promise<TFrame> | TFrame;
  yieldToUi(): Promise<void>;
}

export class AnimatedImageDecodeCancelledError extends Error {
  constructor() {
    super("이미지 프레임 가져오기를 취소했어요.");
    this.name = "AnimatedImageDecodeCancelledError";
  }
}

export function isAnimatedImageDecodeCancelled(error: unknown): boolean {
  return error instanceof AnimatedImageDecodeCancelledError;
}

export interface AnimatedImageDecodeProgress {
  phase: "decode" | "plan";
  decodedFrames: number;
  totalFrames: number;
  ratio: number; // 0..1
}

export interface AnimatedImageDecodeRequest<TFrame> {
  data: Uint8Array;
  mimeType: string;
  maxFrames?: number;
  defaultFrameDurationMs?: number;
  onProgress?: (progress: AnimatedImageDecodeProgress) => void;
  deps: AnimatedImageDecodeDeps<TFrame>;
}

export interface AnimatedImageDecodeResult<TFrame> {
  plan: AnimatedImageFramePlan;
  /** plan.frames와 같은 순서·길이. */
  frames: TFrame[];
  width: number;
  height: number;
  animated: boolean;
}

export interface AnimatedImageDecodeHandle<TFrame> {
  done: Promise<AnimatedImageDecodeResult<TFrame>>;
  cancel(): void;
}

interface DecodeState {
  cancelled: boolean;
}

export function startAnimatedImageDecode<TFrame>(
  request: AnimatedImageDecodeRequest<TFrame>
): AnimatedImageDecodeHandle<TFrame> {
  const state: DecodeState = { cancelled: false };
  return {
    done: runAnimatedImageDecode(request, state),
    cancel() {
      state.cancelled = true;
    },
  };
}

/**
 * 프레임을 순서대로 디코딩하면서, 유지하기로 한 프레임만 materialize한다.
 *
 * 왜 전 프레임을 디코딩하는가: 표시 시간(duration)은 디코딩해야 알 수 있고, 그걸 모르면 솎아낸
 * 프레임의 시간을 흡수해 총 길이를 보존할 수 없다. 디코딩 자체는 브라우저 네이티브(대부분 GPU
 * 또는 최적화된 SIMD 경로)라 싸고, 진짜 비싼 쪽은 캔버스 래스터화/직렬화라 그것만 아낀다.
 */
async function runAnimatedImageDecode<TFrame>(
  request: AnimatedImageDecodeRequest<TFrame>,
  state: DecodeState
): Promise<AnimatedImageDecodeResult<TFrame>> {
  const { deps } = request;
  const decoder = deps.createDecoder({ data: request.data, type: request.mimeType });
  const throwIfCancelled = (): void => {
    if (state.cancelled) throw new AnimatedImageDecodeCancelledError();
  };
  try {
    await decoder.tracks.ready;
    throwIfCancelled();
    const track = decoder.tracks.selectedTrack;
    if (!track || track.frameCount <= 0) {
      throw new Error("이미지에서 프레임을 찾지 못했어요. 다른 파일을 시도해주세요.");
    }
    const keptIndices = new Set(
      selectEvenlySpacedIndices(track.frameCount, request.maxFrames ?? DEFAULT_MAX_IMPORT_FRAMES)
    );
    const durationsUs: (number | null)[] = [];
    const materialized: TFrame[] = [];
    let width = 0;
    let height = 0;

    for (let index = 0; index < track.frameCount; index += 1) {
      throwIfCancelled();
      const { image } = await decoder.decode({ frameIndex: index });
      try {
        durationsUs.push(image.duration);
        if (index === 0) {
          width = image.displayWidth;
          height = image.displayHeight;
        }
        if (keptIndices.has(index)) {
          materialized.push(await deps.materialize(image, materialized.length));
        }
      } finally {
        image.close(); // VideoFrame 누수 방지 — 디코더 프레임은 즉시 반납한다
      }
      request.onProgress?.({
        phase: "decode",
        decodedFrames: index + 1,
        totalFrames: track.frameCount,
        ratio: (index + 1) / track.frameCount,
      });
      await deps.yieldToUi();
    }

    throwIfCancelled();
    request.onProgress?.({
      phase: "plan",
      decodedFrames: track.frameCount,
      totalFrames: track.frameCount,
      ratio: 1,
    });
    const plan = planAnimatedImageImport({
      frameDurationsUs: durationsUs,
      repetitionCount: track.repetitionCount,
      maxFrames: request.maxFrames,
      defaultFrameDurationMs: request.defaultFrameDurationMs,
    });
    return { plan, frames: materialized, width, height, animated: track.animated };
  } finally {
    try {
      decoder.close();
    } catch {
      // 이미 닫힌 디코더 — 무시
    }
  }
}
