/**
 * Studio WebCodecs — 결정적 프레임 타임라인(순수 수학).
 *
 * 기존 영상 내보내기(studio-motion-export·studio-frame-animation-export·studio-timelapse)는
 * `requestAnimationFrame` + `performance.now()` 벽시계 루프로 캔버스를 그리고 MediaRecorder가
 * 실시간으로 삼켰다. 그래서 (a) 내보내기에 영상 길이만큼 시간이 걸리고, (b) 느린 기기에서는
 * 프레임이 드롭돼 **같은 문서인데 매번 다른 파일**이 나왔다.
 *
 * 이 모듈은 그 루프를 대체한다: "프레임 목록 + fps"만으로 각 출력 프레임의 표시 시각(µs)·길이·
 * 키프레임 여부를 미리 전부 계산한다. 인코딩 속도가 실시간보다 빠르든 느리든 결과 바이트는
 * 동일하다(벽시계 미사용 — 이 파일에는 Date/performance/Math.random이 없다).
 */

export const MIN_EXPORT_FPS = 1;
export const MAX_EXPORT_FPS = 120;
export const DEFAULT_EXPORT_FPS = 30;
/** 키프레임 간격 기본값(초) — 탐색성과 용량의 절충(2초는 웹 배포 영상의 관행값). */
export const DEFAULT_KEY_FRAME_INTERVAL_SEC = 2;
const MICROSECONDS_PER_SECOND = 1_000_000;

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

/** fps를 안전 범위의 정수로 — 잘못된 값이 타임라인을 폭주시키지 않게. */
export function normalizeExportFps(fps: number | undefined): number {
  if (fps === undefined || !Number.isFinite(fps)) return DEFAULT_EXPORT_FPS;
  return Math.round(clamp(fps, MIN_EXPORT_FPS, MAX_EXPORT_FPS));
}

/** 키프레임 간격(초) → 프레임 수. 최소 1(모든 프레임 키프레임). */
export function keyFrameIntervalFrames(fps: number, intervalSec = DEFAULT_KEY_FRAME_INTERVAL_SEC): number {
  const normalizedFps = normalizeExportFps(fps);
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) return 1;
  return Math.max(1, Math.round(normalizedFps * intervalSec));
}

/** 프레임 순번 → 표시 시각(µs). 균등 그리드에서 반올림 규칙을 한 곳에 고정한다. */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * MICROSECONDS_PER_SECOND) / normalizeExportFps(fps));
}

export interface StudioVideoTimelineFrame {
  /** 출력 프레임 순번(0부터). */
  index: number;
  /** 이 출력 프레임이 그려야 할 소스 프레임(셀/컷) 인덱스. */
  sourceIndex: number;
  /** 표시 시각(µs) — VideoFrame.timestamp에 그대로 넣는다. */
  timestampUs: number;
  /** 표시 길이(µs) — VideoFrame.duration. */
  durationUs: number;
  /** true면 encode(frame, { keyFrame: true }). */
  keyFrame: boolean;
}

export interface StudioVideoTimeline {
  fps: number;
  frames: StudioVideoTimelineFrame[];
  /** 총 길이(µs) = 마지막 프레임 시각 + 길이. */
  durationUs: number;
  keyFrameIntervalFrames: number;
  /** CFR 출력에서 컨테이너에 적을 프레임 기본 길이(ns). */
  defaultFrameDurationNs: number;
}

function buildTimeline(
  entries: readonly { sourceIndex: number; timestampUs: number; durationUs: number }[],
  fps: number,
  intervalFrames: number
): StudioVideoTimeline {
  const frames: StudioVideoTimelineFrame[] = entries.map((entry, index) => ({
    index,
    sourceIndex: entry.sourceIndex,
    timestampUs: entry.timestampUs,
    durationUs: entry.durationUs,
    keyFrame: index % intervalFrames === 0,
  }));
  const last = frames[frames.length - 1];
  return {
    fps,
    frames,
    durationUs: last ? last.timestampUs + last.durationUs : 0,
    keyFrameIntervalFrames: intervalFrames,
    defaultFrameDurationNs: Math.round((1000 * MICROSECONDS_PER_SECOND) / fps),
  };
}

export interface ConstantRateTimelineRequest {
  /** 출력 프레임 수(= 소스 프레임 수). */
  frameCount: number;
  fps: number;
  keyFrameIntervalSec?: number;
}

/**
 * 소스 프레임 1장 = 출력 프레임 1장인 고정 프레임레이트(CFR) 타임라인.
 * 모션툰/타임랩스처럼 캔버스를 fps 그리드에 맞춰 렌더하는 경로가 쓴다.
 */
export function planConstantRateTimeline(request: ConstantRateTimelineRequest): StudioVideoTimeline {
  const fps = normalizeExportFps(request.fps);
  const count = Math.max(0, Math.floor(request.frameCount));
  const intervalFrames = keyFrameIntervalFrames(fps, request.keyFrameIntervalSec);
  const entries: { sourceIndex: number; timestampUs: number; durationUs: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const timestampUs = frameTimestampUs(index, fps);
    const nextUs = frameTimestampUs(index + 1, fps);
    entries.push({ sourceIndex: index, timestampUs, durationUs: nextUs - timestampUs });
  }
  return buildTimeline(entries, fps, intervalFrames);
}

export interface VariableRateTimelineRequest {
  /** 소스 프레임별 노출 시간(ms) — studio-frame-animation-timing의 frameDurationsMs 산출값. */
  durationsMs: readonly number[];
  loopCount?: number;
  keyFrameIntervalSec?: number;
  /** 컨테이너 메타데이터용 명목 fps(타임스탬프에는 영향 없음). */
  nominalFps?: number;
}

/** 프레임 노출 시간 합(ms). 음수/비유한 값은 0으로 취급. */
export function totalDurationMs(durationsMs: readonly number[]): number {
  let total = 0;
  for (const duration of durationsMs) {
    total += Number.isFinite(duration) && duration > 0 ? duration : 0;
  }
  return total;
}

function frameDurationUs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 1000; // 최소 1ms — 0길이 프레임 금지
  return Math.max(1000, Math.round(durationMs * 1000));
}

/**
 * 가변 프레임레이트(VFR) 타임라인 — 프레임별 노출 시간을 그대로 보존한다.
 * 셀 애니메이션처럼 "100ms 정지 + 40ms 전환"이 섞인 소스에서 CFR 리샘플보다 프레임 수가 훨씬
 * 적어 인코딩이 빠르고 용량도 작다. WebCodecs·WebM 모두 VFR을 정식 지원한다.
 */
export function planVariableRateTimeline(request: VariableRateTimelineRequest): StudioVideoTimeline {
  const loopCount = Math.max(1, Math.round(request.loopCount ?? 1));
  const fps = normalizeExportFps(request.nominalFps ?? DEFAULT_EXPORT_FPS);
  const intervalFrames = keyFrameIntervalFrames(fps, request.keyFrameIntervalSec);
  const entries: { sourceIndex: number; timestampUs: number; durationUs: number }[] = [];
  let cursorUs = 0;
  for (let loop = 0; loop < loopCount; loop += 1) {
    for (let index = 0; index < request.durationsMs.length; index += 1) {
      const durationUs = frameDurationUs(request.durationsMs[index]!);
      entries.push({ sourceIndex: index, timestampUs: cursorUs, durationUs });
      cursorUs += durationUs;
    }
  }
  return buildTimeline(entries, fps, intervalFrames);
}

/**
 * 노출 시간 배열에서 경과 시간(ms)에 해당하는 소스 프레임 인덱스를 찾는다(루프 없음, 순수).
 * studio-frame-animation-timing의 frameIndexAtElapsed와 같은 규칙(누적 합 < time)이지만,
 * 이 모듈은 항상-온 번들 그래프에 얽히지 않도록 의존을 만들지 않고 자체 구현을 유지한다.
 */
export function sourceFrameIndexAt(durationsMs: readonly number[], timeMs: number): number {
  if (durationsMs.length === 0) return 0;
  const total = totalDurationMs(durationsMs);
  if (total <= 0) return 0;
  const time = clamp(timeMs, 0, total);
  let accumulated = 0;
  for (let index = 0; index < durationsMs.length; index += 1) {
    const duration = durationsMs[index]!;
    accumulated += Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (time < accumulated) return index;
  }
  return durationsMs.length - 1;
}

export interface ResampledTimelineRequest {
  durationsMs: readonly number[];
  fps: number;
  loopCount?: number;
  keyFrameIntervalSec?: number;
}

/**
 * 가변 노출 소스를 고정 fps 그리드로 리샘플한다 — 기존 rAF 루프가 "우연히" 하던 일을 결정적으로
 * 재현한 것. VFR을 못 받아들이는 소비처(SNS 업로더 등)를 위한 경로다. 출력 프레임 k의 시각은
 * `round(k×1e6/fps)`이고, 그릴 소스 프레임은 루프 내 위치로 찾는다.
 */
export function planResampledTimeline(request: ResampledTimelineRequest): StudioVideoTimeline {
  const fps = normalizeExportFps(request.fps);
  const loopCount = Math.max(1, Math.round(request.loopCount ?? 1));
  const intervalFrames = keyFrameIntervalFrames(fps, request.keyFrameIntervalSec);
  const loopMs = totalDurationMs(request.durationsMs);
  const totalMs = loopMs * loopCount;
  const frameCount = loopMs > 0 ? Math.max(1, Math.round((totalMs * fps) / 1000)) : 0;
  const entries: { sourceIndex: number; timestampUs: number; durationUs: number }[] = [];
  for (let index = 0; index < frameCount; index += 1) {
    const timestampUs = frameTimestampUs(index, fps);
    const nextUs = frameTimestampUs(index + 1, fps);
    const timeMs = (index * 1000) / fps;
    entries.push({
      sourceIndex: sourceFrameIndexAt(request.durationsMs, loopMs > 0 ? timeMs % loopMs : 0),
      timestampUs,
      durationUs: nextUs - timestampUs,
    });
  }
  return buildTimeline(entries, fps, intervalFrames);
}

/** 타임라인 총 길이(초) — 진행률·파일 메타 표시용. */
export function timelineDurationSec(timeline: StudioVideoTimeline): number {
  return timeline.durationUs / MICROSECONDS_PER_SECOND;
}
