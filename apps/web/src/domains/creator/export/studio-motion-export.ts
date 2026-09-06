/**
 * Studio Motion Export — 효과툰(모션툰)을 WebM 영상으로 내보내는 엔진(코미포 무빙툰 내보내기급).
 *
 * WebtoonFxPlayer(인앱 리더)의 연출 — 컷 리빌·강조·분위기 파티클·BGM — 을 오프스크린
 * 캔버스에 타임라인 리플레이하면서 canvas.captureStream() + MediaRecorder로 실시간
 * 인코딩한다. 작업 전에 지원되는 WebM MIME 하나를 확정하며 녹화 실패 뒤 다른 코덱으로
 * 재실행하지 않는다. BGM은 Web Audio MediaStreamDestination으로 같은 스트림에 믹스.
 *
 * 구조는 두 층으로 나뉜다.
 * 1) 순수 타임라인 플래너(planMotionExport·frameSpecAt·포즈 보간) — DOM 무의존, 단위 테스트 대상.
 *    studio-motion-fx의 프리셋(revealHiddenStyle·emphasisAnimation·cutFx)을 단일 진실로 재사용해
 *    리더와 영상의 연출이 항상 일치한다.
 * 2) 브라우저 레코더 오케스트레이터(startMotionExport) — 캔버스/레코더/오디오 생성을 전부
 *    deps 주입형으로 받아 테스트에서 가짜로 대체 가능. 진행률 콜백 + 취소 지원.
 *
 * 주의: MediaRecorder+captureStream은 실시간 녹화라 내보내기에 영상 길이만큼 시간이 걸린다.
 */

import { buildProgression, findBgmMood, noteToFreq, type BgmMood } from "../studio-bgm";
import {
  buildAmbientParticles,
  cutFx,
  emphasisAnimation,
  findAmbientPreset,
  revealHiddenStyle,
  stepAmbientParticle,
  type AmbientParticle,
  type AmbientPreset,
  type WorkFxSettings,
} from "../studio-motion-fx";

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ── 내보내기 옵션 ────────────────────────────────────────────────────

export interface MotionExportOptions {
  width: number; // 출력 해상도(px)
  height: number;
  fps: number; // 캡처 프레임레이트
  revealSec: number; // 컷 리빌(등장 전환) 길이 — 리더의 760ms transition 감각에 맞춤
  holdSec: number; // 리빌 완료 후 읽기 정지 시간
  tailSec: number; // 마지막 컷 뒤 여운(BGM 페이드아웃 여유)
  maxDurationSec: number; // 총 길이 상한 — 넘으면 타임라인 전체를 균등 축소
}

export const DEFAULT_MOTION_EXPORT_OPTIONS: MotionExportOptions = {
  width: 720,
  height: 1280,
  fps: 30,
  revealSec: 0.76,
  holdSec: 2.4,
  tailSec: 1.2,
  maxDurationSec: 180,
};

/** 옵션을 안전 범위로 정규화 — 잘못된 값이 플랜을 폭주시키지 않게. */
export function normalizeMotionExportOptions(options?: Partial<MotionExportOptions>): MotionExportOptions {
  const o = { ...DEFAULT_MOTION_EXPORT_OPTIONS, ...options };
  return {
    width: Math.round(clamp(o.width, 16, 4096)),
    height: Math.round(clamp(o.height, 16, 4096)),
    fps: Math.round(clamp(o.fps, 5, 60)),
    revealSec: clamp(o.revealSec, 0, 5),
    holdSec: clamp(o.holdSec, 0.3, 30),
    tailSec: clamp(o.tailSec, 0, 10),
    maxDurationSec: clamp(o.maxDurationSec, 5, 1800),
  };
}

// 패널 UI용 해상도 프리셋 — 세로 웹툰 감상 비율 위주.
export const MOTION_RESOLUTION_PRESETS = [
  { id: "sd", label: "세로 720×1280 (권장)", width: 720, height: 1280 },
  { id: "hd", label: "세로 1080×1920 (고화질)", width: 1080, height: 1920 },
  { id: "square", label: "정방형 1080×1080 (SNS)", width: 1080, height: 1080 },
] as const;

// 패널 UI용 컷 읽기 시간(hold) 프리셋 — 영상 길이를 결정한다.
export const MOTION_HOLD_PRESETS = [
  { id: "fast", label: "빠르게 — 컷당 약 1.6초", holdSec: 1.6 },
  { id: "normal", label: "보통 — 컷당 약 2.4초", holdSec: 2.4 },
  { id: "slow", label: "여유롭게 — 컷당 약 3.6초", holdSec: 3.6 },
] as const;

// ── 순수 타임라인 플래너 ─────────────────────────────────────────────

export interface MotionCutSegment {
  index: number; // 컷(페이지) 인덱스
  startSec: number; // 컷 등장 시작 시점
  revealEndSec: number; // 리빌 전환 완료 시점(= start면 리빌 없음)
  emphasisEndSec: number; // 강조 1회 재생 종료 시점(= revealEnd면 강조 없음)
  endSec: number; // 컷 종료(다음 컷 시작)
  reveal: string; // 실효 리빌 id(cutFx 상속 반영)
  emphasis: string; // 실효 강조 id
}

export interface MotionExportPlan {
  width: number;
  height: number;
  fps: number;
  durationSec: number; // 총 길이(tail 포함)
  frameCount: number; // ceil(durationSec × fps)
  cuts: MotionCutSegment[];
  ambient: string; // AmbientId
  bgm: { mood: string; url: string; volume: number };
}

/**
 * 컷 목록 + fx 설정 → 프레임 시퀀스 스펙(총 길이·컷 등장 시점 포함). 순수·결정적.
 * 컷별 세그먼트 = 리빌 전환 → (강조 1회) → 읽기 정지. 총 길이가 maxDurationSec을 넘으면
 * 모든 경계를 같은 비율로 축소해 연출 비율을 보존한 채 상한을 지킨다.
 */
export function planMotionExport(
  pageCount: number,
  fx: WorkFxSettings,
  options?: Partial<MotionExportOptions>
): MotionExportPlan {
  const o = normalizeMotionExportOptions(options);
  const cuts: MotionCutSegment[] = [];
  let cursor = 0;
  for (let i = 0; i < pageCount; i++) {
    const eff = cutFx(fx, i);
    const revealDur = eff.reveal === "none" ? 0 : o.revealSec;
    const emphasisDur = (emphasisAnimation(eff.emphasis)?.options.duration ?? 0) / 1000;
    const startSec = cursor;
    const revealEndSec = startSec + revealDur;
    const emphasisEndSec = revealEndSec + emphasisDur;
    // 읽기 정지는 강조 재생 시간을 최소한으로 보장한다(강조가 잘리지 않게).
    const endSec = revealEndSec + Math.max(o.holdSec, emphasisDur);
    cuts.push({ index: i, startSec, revealEndSec, emphasisEndSec, endSec, reveal: eff.reveal, emphasis: eff.emphasis });
    cursor = endSec;
  }
  let durationSec = pageCount > 0 ? cursor + o.tailSec : 0;
  if (durationSec > o.maxDurationSec) {
    const k = o.maxDurationSec / durationSec;
    for (const c of cuts) {
      c.startSec *= k;
      c.revealEndSec *= k;
      c.emphasisEndSec *= k;
      c.endSec *= k;
    }
    durationSec = o.maxDurationSec;
  }
  return {
    width: o.width,
    height: o.height,
    fps: o.fps,
    durationSec,
    frameCount: durationSec > 0 ? Math.ceil(durationSec * o.fps) : 0,
    cuts,
    ambient: fx.ambient,
    bgm: { mood: fx.bgmMood, url: fx.bgmUrl, volume: fx.bgmVolume },
  };
}

export interface MotionFrameSpec {
  timeSec: number;
  cutIndex: number; // 현재 표시 중인 컷
  reveal: string;
  emphasis: string;
  revealProgress: number; // 0..1 (1 = 완전 표시)
  emphasisProgress: number | null; // 강조 재생 중이면 0..1, 아니면 null
}

/** 플랜의 시각 t에서 그려야 할 프레임 스펙. 순수. 빈 플랜이면 null. */
export function frameSpecAt(plan: MotionExportPlan, timeSec: number): MotionFrameSpec | null {
  if (plan.cuts.length === 0) return null;
  const t = clamp(timeSec, 0, plan.durationSec);
  let cut = plan.cuts[plan.cuts.length - 1]; // tail 구간은 마지막 컷을 유지
  for (const c of plan.cuts) {
    if (t < c.endSec) {
      cut = c;
      break;
    }
  }
  const revealSpan = cut.revealEndSec - cut.startSec;
  const revealProgress = revealSpan > 0 ? clamp01((t - cut.startSec) / revealSpan) : 1;
  const emphasisSpan = cut.emphasisEndSec - cut.revealEndSec;
  const inEmphasis = emphasisSpan > 0 && t >= cut.revealEndSec && t < cut.emphasisEndSec;
  return {
    timeSec: t,
    cutIndex: cut.index,
    reveal: cut.reveal,
    emphasis: cut.emphasis,
    revealProgress,
    emphasisProgress: inEmphasis ? clamp01((t - cut.revealEndSec) / emphasisSpan) : null,
  };
}

// ── 포즈 보간(리빌/강조 CSS 프리셋 → 캔버스 수치 변환) ───────────────

export interface MotionPose {
  opacity: number;
  translateX: number; // px — 리더 기준 폭 720 좌표계(렌더 시 출력 폭에 비례 변환)
  translateY: number;
  scale: number;
  rotateDeg: number;
  blurPx: number;
  brightness: number;
}

export const MOTION_POSE_IDENTITY: MotionPose = {
  opacity: 1,
  translateX: 0,
  translateY: 0,
  scale: 1,
  rotateDeg: 0,
  blurPx: 0,
  brightness: 1,
};

export function easeOutCubic(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

const TRANSFORM_FN_RE = /(translateX|translateY|scale|rotate)\(\s*(-?\d*\.?\d+)(?:px|deg)?\s*\)/g;
const FILTER_FN_RE = /(blur|brightness)\(\s*(-?\d*\.?\d+)(?:px)?\s*\)/g;

// CSS transform 문자열("rotate(-4deg) scale(0.94)" 등)을 수치 포즈로 파싱. 순수.
function parseTransformInto(pose: MotionPose, value: string): void {
  if (!value || value === "none") return;
  for (const m of value.matchAll(TRANSFORM_FN_RE)) {
    const n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    if (m[1] === "translateX") pose.translateX = n;
    else if (m[1] === "translateY") pose.translateY = n;
    else if (m[1] === "scale") pose.scale = n;
    else pose.rotateDeg = n;
  }
}

// CSS filter 문자열("blur(10px)"·"brightness(1.9)")을 수치 포즈로 파싱. 순수.
function parseFilterInto(pose: MotionPose, value: string): void {
  if (!value || value === "none") return;
  for (const m of value.matchAll(FILTER_FN_RE)) {
    const n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    if (m[1] === "blur") pose.blurPx = n;
    else pose.brightness = n;
  }
}

function lerpPose(from: MotionPose, to: MotionPose, t: number): MotionPose {
  return {
    opacity: lerp(from.opacity, to.opacity, t),
    translateX: lerp(from.translateX, to.translateX, t),
    translateY: lerp(from.translateY, to.translateY, t),
    scale: lerp(from.scale, to.scale, t),
    rotateDeg: lerp(from.rotateDeg, to.rotateDeg, t),
    blurPx: lerp(from.blurPx, to.blurPx, t),
    brightness: lerp(from.brightness, to.brightness, t),
  };
}

/** 두 포즈 합성(리빌 × 강조) — 불투명도/배율/밝기는 곱, 이동/회전/블러는 합. */
export function combineMotionPose(a: MotionPose, b: MotionPose): MotionPose {
  return {
    opacity: a.opacity * b.opacity,
    translateX: a.translateX + b.translateX,
    translateY: a.translateY + b.translateY,
    scale: a.scale * b.scale,
    rotateDeg: a.rotateDeg + b.rotateDeg,
    blurPx: a.blurPx + b.blurPx,
    brightness: a.brightness * b.brightness,
  };
}

/**
 * 리빌 진행도(0..1)에 따른 컷 포즈 — revealHiddenStyle(숨김 상태)을 파싱해 identity로
 * easeOutCubic 보간한다(리더의 cubic-bezier(.2,.7,.2,1) 감각 근사). 순수.
 */
export function revealPoseAt(revealId: string, progress: number): MotionPose {
  const hidden = revealHiddenStyle(revealId);
  const from: MotionPose = { ...MOTION_POSE_IDENTITY, opacity: hidden.opacity };
  parseTransformInto(from, hidden.transform);
  parseFilterInto(from, hidden.filter);
  return lerpPose(from, MOTION_POSE_IDENTITY, easeOutCubic(progress));
}

function poseFromKeyframe(kf: Keyframe): MotionPose {
  const pose = { ...MOTION_POSE_IDENTITY };
  const transform = kf["transform"];
  const filter = kf["filter"];
  if (typeof transform === "string") parseTransformInto(pose, transform);
  if (typeof filter === "string") parseFilterInto(pose, filter);
  return pose;
}

/**
 * 강조 진행도(0..1)에 따른 포즈 — emphasisAnimation의 Web Animations 키프레임을 파싱해
 * offset 구간 사이를 선형 보간한다(offset 미지정 시 균등 분배). 순수.
 */
export function emphasisPoseAt(emphasisId: string, progress: number): MotionPose {
  const anim = emphasisAnimation(emphasisId);
  if (!anim || anim.keyframes.length === 0) return { ...MOTION_POSE_IDENTITY };
  const n = anim.keyframes.length;
  const frames = anim.keyframes.map((kf, i) => ({
    offset: typeof kf.offset === "number" ? clamp01(kf.offset) : n === 1 ? 1 : i / (n - 1),
    pose: poseFromKeyframe(kf),
  }));
  const t = clamp01(progress);
  if (t <= frames[0].offset) return frames[0].pose;
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t <= b.offset) {
      const span = b.offset - a.offset;
      return span > 0 ? lerpPose(a.pose, b.pose, (t - a.offset) / span) : b.pose;
    }
  }
  return frames[frames.length - 1].pose;
}

/** 프레임 스펙 → 최종 합성 포즈(리빌 × 강조). 순수. */
export function motionFramePose(frame: MotionFrameSpec): MotionPose {
  const reveal = revealPoseAt(frame.reveal, frame.revealProgress);
  if (frame.emphasisProgress == null) return reveal;
  return combineMotionPose(reveal, emphasisPoseAt(frame.emphasis, frame.emphasisProgress));
}

// ── 인코딩 스펙(MIME/비트레이트/파일명) ──────────────────────────────

// 작업 전 capability preflight 순서. 인코딩을 시도하는 목록이 아니며 선택 뒤에는 바뀌지 않는다.
export const MOTION_VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
] as const;

export type MotionVideoMime = (typeof MOTION_VIDEO_MIME_CANDIDATES)[number];

export class MotionExportCodecUnavailableError extends Error {
  readonly selectedMime: string;
  readonly recorderMime: string;
  readonly reason: "codec-identity" | "container-magic";

  constructor(input: {
    selectedMime: string;
    recorderMime: string;
    reason: "codec-identity" | "container-magic";
  }) {
    super(
      input.reason === "codec-identity"
        ? "선택한 WebM 코덱과 MediaRecorder의 실제 코덱 영수증이 일치하지 않아 저장하지 않았어요."
        : "MediaRecorder 결과가 유효한 WebM 컨테이너가 아니어서 저장하지 않았어요.",
    );
    this.name = "MotionExportCodecUnavailableError";
    this.selectedMime = input.selectedMime;
    this.recorderMime = input.recorderMime;
    this.reason = input.reason;
  }
}

function normalizeMotionVideoMime(mime: string): MotionVideoMime | null {
  const match = mime.trim().match(
    /^video\/webm\s*;\s*codecs\s*=\s*["']?\s*(vp8|vp9)\s*,\s*opus\s*["']?\s*$/i,
  );
  if (!match) return null;
  return match[1]?.toLowerCase() === "vp9"
    ? "video/webm;codecs=vp9,opus"
    : "video/webm;codecs=vp8,opus";
}

/** 선택 codec identity와 EBML/WebM magic이 모두 맞는 경우에만 최종 Blob을 만든다. */
export async function materializeExactMotionWebm(
  chunks: readonly Blob[],
  selectedMime: string,
  recorderMime: string,
): Promise<Readonly<{ blob: Blob; mimeType: MotionVideoMime }>> {
  const selected = normalizeMotionVideoMime(selectedMime);
  const actual = normalizeMotionVideoMime(recorderMime);
  if (!selected || actual !== selected) {
    throw new MotionExportCodecUnavailableError({
      selectedMime,
      recorderMime,
      reason: "codec-identity",
    });
  }
  const blob = new Blob([...chunks], { type: actual });
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (
    header.byteLength < 4
    || header[0] !== 0x1a
    || header[1] !== 0x45
    || header[2] !== 0xdf
    || header[3] !== 0xa3
  ) {
    throw new MotionExportCodecUnavailableError({
      selectedMime,
      recorderMime,
      reason: "container-magic",
    });
  }
  return Object.freeze({ blob, mimeType: actual });
}

/** 인코딩 전에 첫 지원 MIME 하나를 확정한다. 선택된 recorder 실패 시 이 함수를 재호출하지 않는다. */
export function pickMotionVideoMime(isSupported: (mime: string) => boolean): string | null {
  for (const mime of MOTION_VIDEO_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return null;
}

/** 해상도·fps 기반 권장 비트레이트(bps) — 픽셀레이트 0.12bpp, 2.5M~16M 클램프. 순수. */
export function recommendVideoBitsPerSecond(width: number, height: number, fps: number): number {
  return Math.round(clamp(width * height * fps * 0.12, 2_500_000, 16_000_000));
}

/** 내보내기 파일명 — 기존 이미지 내보내기 규칙(`<제목>-strip` 등)과 나란한 `-motion.webm`. */
export function motionExportFileName(title: string): string {
  return `${title.trim() || "toonspectrum-motion"}-motion.webm`;
}

// ── BGM 신스 스케줄러(주입형 오디오 그래프) ──────────────────────────
// studio-bgm의 createBgmPlayer는 출력이 ctx.destination에 고정돼 녹화 스트림으로 라우팅할 수
// 없다(수정 금지). 대신 같은 파일의 순수 음악 엔진(BGM_MOODS·buildProgression·noteToFreq)을
// 재사용해 동일한 패드 사운드를 MediaStreamDestination 쪽 그래프에 직접 스케줄한다.
// 녹화는 총 길이를 미리 알므로 lookahead 타이머 없이 전 구간을 한 번에 예약한다.

export interface MotionSynthParam {
  value: number;
  setValueAtTime(value: number, startTime: number): unknown;
  exponentialRampToValueAtTime(value: number, endTime: number): unknown;
  linearRampToValueAtTime(value: number, endTime: number): unknown;
}

export interface MotionSynthNode {
  connect(node: MotionSynthNode): unknown;
}

export interface MotionSynthOscillator extends MotionSynthNode {
  type: string;
  frequency: MotionSynthParam;
  start(when: number): void;
  stop(when: number): void;
}

export interface MotionSynthGain extends MotionSynthNode {
  gain: MotionSynthParam;
}

export interface MotionSynthFilter extends MotionSynthNode {
  type: string;
  frequency: MotionSynthParam;
}

export interface MotionSynthContext {
  currentTime: number;
  createGain(): MotionSynthGain;
  createOscillator(): MotionSynthOscillator;
  createBiquadFilter(): MotionSynthFilter;
}

/**
 * 무드 BGM을 durationSec 동안 dest로 스케줄한다(마스터 게인 + 로우패스 + 코드 패드,
 * studio-bgm 프로시저럴 플레이어와 동일 음색). 끝 0.8초는 마스터 페이드아웃.
 */
export function scheduleMotionBgm(
  ctx: MotionSynthContext,
  dest: MotionSynthNode,
  mood: BgmMood,
  volume: number,
  durationSec: number
): void {
  if (durationSec <= 0) return;
  const master = ctx.createGain();
  master.gain.value = clamp01(volume) * 0.22; // 패드는 낮게 — 배경에 묻히게(리더와 동일 레벨)
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1400;
  master.connect(lp);
  lp.connect(dest);

  const progression = buildProgression(mood, 4);
  const secPerBeat = 60 / mood.tempo;
  const t0 = ctx.currentTime + 0.05;
  const endAt = t0 + durationSec;
  let when = t0;
  let stepIndex = 0;
  while (when < endAt) {
    const step = progression[stepIndex % progression.length];
    const dur = step.beats * secPerBeat;
    const noteEnd = Math.min(when + dur, endAt);
    for (const st of step.semitones) {
      const osc = ctx.createOscillator();
      osc.type = mood.waveform;
      osc.frequency.value = noteToFreq(mood.rootFreq, st);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, when);
      env.gain.exponentialRampToValueAtTime(0.9, when + Math.min(0.6, dur * 0.3));
      env.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      osc.connect(env);
      env.connect(master);
      osc.start(when);
      osc.stop(noteEnd + 0.05);
    }
    when += dur;
    stepIndex += 1;
  }
  // 마지막 0.8초 마스터 페이드아웃 — 영상 끝에서 뚝 끊기지 않게.
  const fadeStart = Math.max(t0, endAt - 0.8);
  master.gain.setValueAtTime(master.gain.value, fadeStart);
  master.gain.linearRampToValueAtTime(0.0001, endAt);
}

// ── 프레임 렌더러(캔버스 2D) ─────────────────────────────────────────

export interface MotionCutImage {
  source: CanvasImageSource;
  width: number; // 원본 픽셀 크기(contain 배치 계산용)
  height: number;
}

export interface MotionFrameDrawInput {
  plan: MotionExportPlan;
  frame: MotionFrameSpec;
  image: MotionCutImage | undefined;
  particles: AmbientParticle[];
  ambientPreset: AmbientPreset | undefined;
  background: string;
  timeSec: number;
}

// WebtoonFxPlayer.drawParticle과 동일 모양(비공개라 임포트 불가) — 리더와 같은 룩 유지.
function drawMotionParticle(
  ctx: CanvasRenderingContext2D,
  p: AmbientParticle,
  preset: AmbientPreset,
  t: number
): void {
  const alpha = preset.twinkle ? 0.4 + 0.6 * Math.abs(Math.sin(p.phase + t * 2)) : 1;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = preset.color;
  ctx.strokeStyle = preset.color;
  switch (preset.shape) {
    case "line":
      ctx.lineWidth = Math.max(1, p.size * 0.18);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.size * 0.18, p.y + p.size);
      ctx.stroke();
      break;
    case "petal":
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    case "spark":
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "blob":
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      break;
    default: // dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
  }
}

/**
 * 한 프레임을 캔버스에 그린다 — 배경 → 컷 이미지(contain + 포즈 변환) → 분위기 파티클.
 * 포즈의 px 오프셋은 리더 기준 폭 720 좌표계라 출력 폭에 비례 변환한다.
 */
export function drawMotionFrame(ctx: CanvasRenderingContext2D, input: MotionFrameDrawInput): void {
  const { plan, frame, image } = input;
  ctx.globalAlpha = 1;
  ctx.fillStyle = input.background;
  ctx.fillRect(0, 0, plan.width, plan.height);

  if (image) {
    const pose = motionFramePose(frame);
    const iw = Math.max(1, image.width);
    const ih = Math.max(1, image.height);
    const fit = Math.min(plan.width / iw, plan.height / ih);
    const dw = iw * fit;
    const dh = ih * fit;
    const k = plan.width / 720; // 리더 좌표계 → 출력 해상도 비례 계수
    ctx.save();
    ctx.translate(plan.width / 2 + pose.translateX * k, plan.height / 2 + pose.translateY * k);
    if (pose.rotateDeg !== 0) ctx.rotate((pose.rotateDeg * Math.PI) / 180);
    if (pose.scale !== 1) ctx.scale(pose.scale, pose.scale);
    ctx.globalAlpha = clamp01(pose.opacity);
    const filters: string[] = [];
    if (pose.blurPx > 0.01) filters.push(`blur(${(pose.blurPx * k).toFixed(2)}px)`);
    if (Math.abs(pose.brightness - 1) > 0.001) filters.push(`brightness(${pose.brightness.toFixed(3)})`);
    if (filters.length > 0) ctx.filter = filters.join(" ");
    ctx.drawImage(image.source, -dw / 2, -dh / 2, dw, dh);
    if (filters.length > 0) ctx.filter = "none";
    ctx.restore();
  }

  const preset = input.ambientPreset;
  if (preset && preset.id !== "none" && input.particles.length > 0) {
    for (const p of input.particles) drawMotionParticle(ctx, p, preset, input.timeSec);
    ctx.globalAlpha = 1;
  }
}

// ── 컷 이미지 로딩(브라우저) ─────────────────────────────────────────

function defaultLoadCutImage(url: string): Promise<MotionCutImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // CORS 허용 시 origin-clean 유지(캔버스 오염 → captureStream 실패 방지), 거부 시 여기서 실패.
    img.crossOrigin = "anonymous";
    img.onload = () =>
      resolve({ source: img, width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error("컷 이미지를 불러오지 못했어요. 잠시 후 다시 시도해주세요."));
    img.src = url;
  });
}

/** 페이지 URL들을 컷 이미지로 병렬 로드(순서 보존). loadOne 주입으로 테스트 가능. */
export function loadMotionCutImages(
  urls: string[],
  loadOne: (url: string) => Promise<MotionCutImage> = defaultLoadCutImage
): Promise<MotionCutImage[]> {
  return Promise.all(urls.map((url) => loadOne(url)));
}

// ── 레코더 오케스트레이터(주입형 DOM 어댑터) ─────────────────────────

export interface MotionTrackLike {
  stop(): void;
}

export interface MotionStreamLike {
  addTrack(track: MotionTrackLike): void;
  getTracks(): MotionTrackLike[];
}

export interface MotionCanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
  captureStream(frameRate: number): MotionStreamLike;
}

export interface MotionRecorderLike {
  /** MediaRecorder가 실제로 확정한 MIME/codec 영수증. */
  readonly mimeType?: string;
  start(timesliceMs?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

/** 녹화 스트림에 섞일 BGM 오디오 어댑터 — createAudio가 준비하고 start()에서 재생 예약. */
export interface MotionAudioLike {
  tracks: MotionTrackLike[]; // MediaStreamDestination의 오디오 트랙들
  start(): void; // 녹화 시작 직전 호출(컨텍스트 resume + 스케줄)
  dispose(): void;
}

export interface MotionExportDeps {
  createCanvas(width: number, height: number): MotionCanvasLike;
  createRecorder(
    stream: MotionStreamLike,
    options: { mimeType: string; videoBitsPerSecond: number }
  ): MotionRecorderLike;
  isMimeSupported(mime: string): boolean;
  createAudio(bgm: MotionExportPlan["bgm"], durationSec: number): Promise<MotionAudioLike | null>;
  requestFrame(cb: () => void): number;
  cancelFrame(handle: number): void;
  now(): number; // ms
}

// 실브라우저 기본 어댑터 — 테스트에서는 이 전부를 가짜로 대체한다.
export function createDefaultMotionExportDeps(): MotionExportDeps {
  return {
    createCanvas(width, height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
    createRecorder(stream, options) {
      return new MediaRecorder(stream as MediaStream, options) as unknown as MotionRecorderLike;
    },
    isMimeSupported(mime) {
      return typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
        ? MediaRecorder.isTypeSupported(mime)
        : false;
    },
    createAudio: createDefaultMotionAudio,
    requestFrame(cb) {
      return requestAnimationFrame(() => cb());
    },
    cancelFrame(handle) {
      cancelAnimationFrame(handle);
    },
    now() {
      return typeof performance !== "undefined" ? performance.now() : Date.now();
    },
  };
}

type AudioCtor = typeof AudioContext;

// 기본 오디오 어댑터 — 무드 신스(프로시저럴) 또는 커스텀 URL(fetch+decode)을
// MediaStreamDestination으로 라우팅한다. 실패는 throw — 호출부가 "무음으로 계속"을 결정.
async function createDefaultMotionAudio(
  bgm: MotionExportPlan["bgm"],
  durationSec: number
): Promise<MotionAudioLike | null> {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  const ctx = new Ctor();
  const dispose = () => {
    void ctx.close().catch(() => {});
  };
  try {
    const dest = ctx.createMediaStreamDestination();
    if (bgm.url) {
      const res = await fetch(bgm.url);
      if (!res.ok) throw new Error(`BGM 오디오 응답 오류 (${res.status})`);
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = clamp01(bgm.volume);
      src.connect(gain);
      gain.connect(dest);
      return {
        tracks: dest.stream.getAudioTracks(),
        start() {
          void ctx.resume().catch(() => {});
          const t0 = ctx.currentTime + 0.05;
          const endAt = t0 + durationSec;
          const fadeStart = Math.max(t0, endAt - 0.8);
          gain.gain.setValueAtTime(clamp01(bgm.volume), fadeStart);
          gain.gain.linearRampToValueAtTime(0.0001, endAt);
          src.start(t0);
          src.stop(endAt + 0.1);
        },
        dispose,
      };
    }
    const mood = findBgmMood(bgm.mood);
    if (!mood) {
      dispose();
      return null;
    }
    return {
      tracks: dest.stream.getAudioTracks(),
      start() {
        void ctx.resume().catch(() => {});
        scheduleMotionBgm(ctx, dest, mood, bgm.volume, durationSec);
      },
      dispose,
    };
  } catch (err) {
    dispose();
    throw err;
  }
}

// ── 내보내기 실행(진행률 + 취소) ─────────────────────────────────────

export type MotionExportAudio = "mixed" | "none" | "failed";

export interface MotionExportProgress {
  phase: "record" | "finalize";
  ratio: number; // 0..1
  timeSec: number;
  durationSec: number;
}

export interface MotionExportResult {
  blob: Blob;
  mimeType: string;
  durationSec: number;
  audio: MotionExportAudio; // mixed=BGM 믹스됨 · none=무음(설정/음소거) · failed=믹스 실패(무음 진행)
}

export interface MotionExportRequest {
  plan: MotionExportPlan;
  images: MotionCutImage[]; // 컷 인덱스 순서와 동일
  muted?: boolean;
  background?: string; // 레터박스 배경색(기본 짙은 회흑)
  onProgress?: (progress: MotionExportProgress) => void;
  deps?: Partial<MotionExportDeps>;
}

export interface MotionExportHandle {
  done: Promise<MotionExportResult>;
  cancel(): void;
}

export class MotionExportCancelledError extends Error {
  constructor() {
    super("모션툰 내보내기를 취소했어요.");
    this.name = "MotionExportCancelledError";
  }
}

export function isMotionExportCancelled(err: unknown): boolean {
  return err instanceof MotionExportCancelledError;
}

/** 브라우저가 모션툰 영상 내보내기를 지원하는지(캔버스 캡처 + WebM MediaRecorder). */
export function isMotionExportSupported(): boolean {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") return false;
  if (typeof HTMLCanvasElement === "undefined" || !("captureStream" in HTMLCanvasElement.prototype)) {
    return false;
  }
  return (
    pickMotionVideoMime((mime) =>
      typeof MediaRecorder.isTypeSupported === "function" ? MediaRecorder.isTypeSupported(mime) : false
    ) != null
  );
}

interface MotionRunState {
  cancelled: boolean;
  interrupt: (() => void) | null;
}

/**
 * 플랜을 실시간 리플레이하며 WebM으로 녹화한다. 반환 핸들의 done을 await — 취소 시
 * MotionExportCancelledError로 reject된다(isMotionExportCancelled로 판별).
 */
export function startMotionExport(request: MotionExportRequest): MotionExportHandle {
  const deps: MotionExportDeps = { ...createDefaultMotionExportDeps(), ...request.deps };
  const state: MotionRunState = { cancelled: false, interrupt: null };
  return {
    done: runMotionExport(request, deps, state),
    cancel() {
      if (state.cancelled) return;
      state.cancelled = true;
      state.interrupt?.();
    },
  };
}

async function runMotionExport(
  request: MotionExportRequest,
  deps: MotionExportDeps,
  state: MotionRunState
): Promise<MotionExportResult> {
  const { plan } = request;
  if (plan.cuts.length === 0 || plan.durationSec <= 0) throw new Error("내보낼 컷(페이지)이 없어요.");
  if (request.images.length < plan.cuts.length) {
    throw new Error("컷 이미지 수가 플랜과 맞지 않아요. 다시 시도해주세요.");
  }
  const mimeType = pickMotionVideoMime(deps.isMimeSupported);
  if (!mimeType) throw new Error("이 브라우저는 WebM 영상 인코딩을 지원하지 않아요.");

  const canvas = deps.createCanvas(plan.width, plan.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스 컨텍스트를 만들지 못했어요.");

  const ambientPreset = findAmbientPreset(plan.ambient);
  // 리더(AmbientCanvas)와 같은 시드 — 영상과 인앱 감상의 입자 배치가 일치한다.
  let particles =
    ambientPreset && ambientPreset.id !== "none"
      ? buildAmbientParticles(ambientPreset, plan.width, plan.height, 12345)
      : [];
  const background = request.background ?? "#101014";

  const draw = (timeSec: number) => {
    const frame = frameSpecAt(plan, timeSec);
    if (!frame) return;
    drawMotionFrame(ctx, {
      plan,
      frame,
      image: request.images[frame.cutIndex],
      particles,
      ambientPreset,
      background,
      timeSec,
    });
  };
  draw(0); // captureStream 전에 첫 프레임을 채워 검은 첫 컷을 방지

  const stream = canvas.captureStream(plan.fps);

  let audio: MotionAudioLike | null = null;
  let audioState: MotionExportAudio = "none";
  if (!request.muted && (plan.bgm.mood !== "" || plan.bgm.url !== "")) {
    try {
      audio = await deps.createAudio(plan.bgm, plan.durationSec);
      if (audio && audio.tracks.length > 0) {
        for (const track of audio.tracks) stream.addTrack(track);
        audioState = "mixed";
      } else {
        audio?.dispose();
        audio = null;
        audioState = "failed";
      }
    } catch {
      audio = null;
      audioState = "failed"; // BGM 실패는 치명적이지 않다 — 무음으로 계속
    }
  }

  const chunks: Blob[] = [];
  let recorderError: unknown = null;
  const recorder = deps.createRecorder(stream, {
    mimeType,
    videoBitsPerSecond: recommendVideoBitsPerSecond(plan.width, plan.height, plan.fps),
  });
  let settleStopped: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    settleStopped = resolve;
  });
  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => settleStopped();
  recorder.onerror = (event) => {
    recorderError = event ?? new Error("recorder error");
    settleStopped();
  };

  let pendingFrame: number | null = null;
  const cleanup = () => {
    if (pendingFrame != null) {
      deps.cancelFrame(pendingFrame);
      pendingFrame = null;
    }
    try {
      recorder.stop();
    } catch {
      // 이미 정지된 레코더 — 무시
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // 이미 종료된 트랙 — 무시
      }
    }
    audio?.dispose();
  };

  try {
    if (state.cancelled) throw new MotionExportCancelledError();
    audio?.start();
    recorder.start(500); // 500ms 조각으로 청크 수집(장시간 녹화 메모리 분산)

    // 실시간 프레임 루프 — 벽시계 기준 t로 프레임 스펙을 평가·렌더한다.
    await new Promise<void>((resolve, reject) => {
      const t0 = deps.now();
      let last = t0;
      state.interrupt = () => {
        if (pendingFrame != null) {
          deps.cancelFrame(pendingFrame);
          pendingFrame = null;
        }
        reject(new MotionExportCancelledError());
      };
      const tick = () => {
        pendingFrame = null;
        if (state.cancelled) {
          reject(new MotionExportCancelledError());
          return;
        }
        const nowMs = deps.now();
        const elapsedSec = (nowMs - t0) / 1000;
        const timeSec = Math.min(elapsedSec, plan.durationSec);
        const dt = Math.min(0.1, Math.max(0, (nowMs - last) / 1000));
        last = nowMs;
        if (particles.length > 0) {
          particles = particles.map((p) => stepAmbientParticle(p, plan.width, plan.height, dt));
        }
        draw(timeSec);
        request.onProgress?.({
          phase: "record",
          ratio: clamp01(timeSec / plan.durationSec),
          timeSec,
          durationSec: plan.durationSec,
        });
        if (elapsedSec >= plan.durationSec) {
          resolve();
          return;
        }
        pendingFrame = deps.requestFrame(tick);
      };
      tick();
    });

    // 마무리 — 레코더 정지 후 청크 병합. 취소가 오면 정지 대기를 즉시 깨운다.
    state.interrupt = () => settleStopped();
    request.onProgress?.({
      phase: "finalize",
      ratio: 1,
      timeSec: plan.durationSec,
      durationSec: plan.durationSec,
    });
    try {
      recorder.stop();
    } catch {
      // 이미 멈춘 레코더 — 무시
    }
    await stopped;
    if (state.cancelled) throw new MotionExportCancelledError();
    if (recorderError) throw new Error("영상 인코딩 중 오류가 발생했어요. 다시 시도해주세요.");
    if (chunks.length === 0) throw new Error("녹화된 영상 데이터가 없어요. 다시 시도해주세요.");
    const encoded = await materializeExactMotionWebm(chunks, mimeType, recorder.mimeType ?? "");
    return {
      blob: encoded.blob,
      mimeType: encoded.mimeType,
      durationSec: plan.durationSec,
      audio: audioState,
    };
  } finally {
    state.interrupt = null;
    cleanup();
  }
}
