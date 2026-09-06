/**
 * Studio Micro Motion Timeline & Living Stroke Engine — 선택한 컷·레이어·스트로크에
 * 국소적 시간축 애니메이션(어니언 스킨, 루프, 키프레임, 라인 보일링, 펄스)을 적용하고
 * 광과민성·Reduced Motion을 검증하는 코어.
 *
 * 마스터플랜 14.1 (Micro Motion Timeline), 14.2 (Living Stroke Modifier) & 41개 경쟁제품 기능 갭:
 * - Scoped Micro Motion 타임라인 (FPS, 키프레임, Onion Skinning, Loop / Ping-pong)
 * - Living Stroke 수정자 (Position Jitter, Width Pulse, Texture Phase, 2/3/6fps Line Boil, Afterimage Trail)
 * - 광과민성(3Hz 이상 깜빡임 검출) 및 Reduced Motion 대체 규격 검증
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_MICRO_MOTION_VERSION = 1 as const;

export const STUDIO_MICRO_MOTION_LIMITS = Object.freeze({
  maxFrames: 240,
  maxKeyframesPerTarget: 64,
  maxFps: 60,
  minFps: 1,
  maxDiagnostics: 256,
});

export const PLAYBACK_MODES = ["loop", "ping-pong", "once"] as const;
export type PlaybackMode = (typeof PLAYBACK_MODES)[number];

export interface MotionKeyframe {
  readonly frameIndex: number;
  readonly opacity?: number; // 0..1
  readonly translateX?: number; // px
  readonly translateY?: number; // px
  readonly scale?: number; // >0
  readonly rotationDeg?: number;
  readonly effectIntensity?: number; // 0..1
}

export interface OnionSkinConfig {
  readonly enabled: boolean;
  readonly prevFramesCount: number; // 1..5
  readonly nextFramesCount: number; // 1..5
  readonly opacity: number; // 0..1
}

export interface MotionTargetTrack {
  readonly targetId: string;
  readonly targetKind: "panel" | "layer" | "stroke";
  readonly keyframes: readonly MotionKeyframe[];
}

export interface StudioMicroMotionTimeline {
  readonly version: typeof STUDIO_MICRO_MOTION_VERSION;
  readonly id: string;
  readonly panelId: string;
  readonly totalFrames: number;
  readonly fps: number;
  readonly playbackMode: PlaybackMode;
  readonly onionSkin: OnionSkinConfig;
  readonly tracks: readonly MotionTargetTrack[];
}

export type LivingStrokeKind =
  | "line-boil"
  | "position-jitter"
  | "width-pulse"
  | "texture-phase"
  | "afterimage-trail";

export interface LivingStrokeModifier {
  readonly kind: LivingStrokeKind;
  readonly boilFps?: 2 | 3 | 6; // Boil animation speed
  readonly amplitude: number; // px or ratio
  readonly frequencyHz: number;
  readonly seed?: number;
}

export interface StrokePoint2D {
  readonly x: number;
  readonly y: number;
  readonly pressure?: number;
  readonly width?: number;
}

export interface MotionSafetyDiagnostic {
  readonly code: "PHOTOSENSITIVITY_FLASH_RISK" | "HIGH_SPEED_JITTER";
  readonly targetId: string;
  readonly message: string;
  readonly severity: "error" | "warning";
}

export function createMicroMotionTimeline(params: {
  id: string;
  panelId: string;
  totalFrames?: number;
  fps?: number;
  playbackMode?: PlaybackMode;
  onionSkin?: Partial<OnionSkinConfig>;
  tracks?: readonly MotionTargetTrack[];
}): StudioMicroMotionTimeline {
  return Object.freeze({
    version: STUDIO_MICRO_MOTION_VERSION,
    id: params.id.trim(),
    panelId: params.panelId.trim(),
    totalFrames: Math.min(
      STUDIO_MICRO_MOTION_LIMITS.maxFrames,
      Math.max(2, params.totalFrames ?? 24),
    ),
    fps: Math.min(
      STUDIO_MICRO_MOTION_LIMITS.maxFps,
      Math.max(STUDIO_MICRO_MOTION_LIMITS.minFps, params.fps ?? 12),
    ),
    playbackMode: params.playbackMode ?? "loop",
    onionSkin: Object.freeze({
      enabled: params.onionSkin?.enabled ?? false,
      prevFramesCount: params.onionSkin?.prevFramesCount ?? 2,
      nextFramesCount: params.onionSkin?.nextFramesCount ?? 0,
      opacity: params.onionSkin?.opacity ?? 0.3,
    }),
    tracks: Object.freeze([...(params.tracks ?? [])]),
  });
}

export function addKeyframeToTrack(
  timeline: StudioMicroMotionTimeline,
  targetId: string,
  targetKind: "panel" | "layer" | "stroke",
  keyframe: MotionKeyframe,
): StudioMicroMotionTimeline {
  let found = false;
  const nextTracks = timeline.tracks.map((track) => {
    if (track.targetId !== targetId) return track;
    found = true;
    const filtered = track.keyframes.filter((k) => k.frameIndex !== keyframe.frameIndex);
    const updated = [...filtered, keyframe].sort((a, b) => a.frameIndex - b.frameIndex);
    return Object.freeze({ ...track, keyframes: Object.freeze(updated) });
  });

  if (!found) {
    const newTrack: MotionTargetTrack = Object.freeze({
      targetId,
      targetKind,
      keyframes: Object.freeze([keyframe]),
    });
    nextTracks.push(newTrack);
  }

  return { ...timeline, tracks: Object.freeze(nextTracks) };
}

/**
 * 특정 시점(timeMs)에서 대상의 보간된 모션 프로퍼티를 계산한다.
 */
export function sampleTrackPropertiesAtTime(
  timeline: StudioMicroMotionTimeline,
  targetId: string,
  timeMs: number,
): Required<MotionKeyframe> {
  const track = timeline.tracks.find((t) => t.targetId === targetId);
  const fallback: Required<MotionKeyframe> = {
    frameIndex: 0,
    opacity: 1,
    translateX: 0,
    translateY: 0,
    scale: 1,
    rotationDeg: 0,
    effectIntensity: 0,
  };

  if (!track || track.keyframes.length === 0) return fallback;

  const durationSec = timeline.totalFrames / timeline.fps;
  const timeSec = (timeMs / 1000) % durationSec;
  const currentFrame = (timeSec * timeline.fps) % timeline.totalFrames;

  // Keyframes interpolation
  const sorted = track.keyframes;
  if (sorted.length === 1 || currentFrame <= sorted[0].frameIndex) {
    const k = sorted[0];
    return {
      frameIndex: k.frameIndex,
      opacity: k.opacity ?? 1,
      translateX: k.translateX ?? 0,
      translateY: k.translateY ?? 0,
      scale: k.scale ?? 1,
      rotationDeg: k.rotationDeg ?? 0,
      effectIntensity: k.effectIntensity ?? 0,
    };
  }

  let prev = sorted[0];
  let next = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i].frameIndex <= currentFrame && sorted[i + 1].frameIndex >= currentFrame) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const span = next.frameIndex - prev.frameIndex;
  const alpha = span > 0 ? (currentFrame - prev.frameIndex) / span : 0;

  const lerp = (a: number, b: number) => a + (b - a) * alpha;

  return {
    frameIndex: Math.floor(currentFrame),
    opacity: lerp(prev.opacity ?? 1, next.opacity ?? 1),
    translateX: lerp(prev.translateX ?? 0, next.translateX ?? 0),
    translateY: lerp(prev.translateY ?? 0, next.translateY ?? 0),
    scale: lerp(prev.scale ?? 1, next.scale ?? 1),
    rotationDeg: lerp(prev.rotationDeg ?? 0, next.rotationDeg ?? 0),
    effectIntensity: lerp(prev.effectIntensity ?? 0, next.effectIntensity ?? 0),
  };
}

/**
 * Living Stroke 수정자를 원본 2D 스트로크 포인트에 적용하여 살아 움직이는 선화를 생성한다.
 */
export function applyLivingStrokeModifier(
  points: readonly StrokePoint2D[],
  modifier: LivingStrokeModifier,
  timeMs: number,
): readonly StrokePoint2D[] {
  if (points.length === 0) return points;

  const seed = modifier.seed ?? 1337;
  const phase = (timeMs / 1000) * modifier.frequencyHz * Math.PI * 2;

  // Line boil: 고정 FPS 프레임 인덱스에 따라 결정론적 지터 생성
  if (modifier.kind === "line-boil") {
    const boilFps = modifier.boilFps ?? 3;
    const boilStep = Math.floor((timeMs / 1000) * boilFps);

    return Object.freeze(
      points.map((pt, idx) => {
        const hash = Math.sin(idx * 9301 + boilStep * 49297 + seed) * 233280;
        const jitterX = (hash - Math.floor(hash) - 0.5) * 2 * modifier.amplitude;
        const hash2 = Math.sin(idx * 7919 + boilStep * 31337 + seed) * 233280;
        const jitterY = (hash2 - Math.floor(hash2) - 0.5) * 2 * modifier.amplitude;

        return Object.freeze({
          ...pt,
          x: pt.x + jitterX,
          y: pt.y + jitterY,
          width: pt.width !== undefined ? pt.width * (1 + (hash - Math.floor(hash) - 0.5) * 0.15) : undefined,
        });
      }),
    );
  }

  if (modifier.kind === "width-pulse") {
    return Object.freeze(
      points.map((pt, idx) => {
        const spatial = idx * 0.2;
        const pulse = 1 + Math.sin(phase + spatial) * modifier.amplitude;
        return Object.freeze({
          ...pt,
          width: pt.width !== undefined ? pt.width * pulse : undefined,
        });
      }),
    );
  }

  // General position jitter
  return Object.freeze(
    points.map((pt, idx) => {
      const offsetX = Math.sin(phase + idx * 0.5) * modifier.amplitude;
      const offsetY = Math.cos(phase + idx * 0.5) * modifier.amplitude;
      return Object.freeze({
        ...pt,
        x: pt.x + offsetX,
        y: pt.y + offsetY,
      });
    }),
  );
}

/**
 * 3Hz 이상의 광과민성 발작 위험(급격한 밝기/불투명도 플래시)을 검사한다.
 */
export function validatePhotosensitivitySafety(
  timeline: StudioMicroMotionTimeline,
): readonly MotionSafetyDiagnostic[] {
  const diagnostics: MotionSafetyDiagnostic[] = [];

  for (const track of timeline.tracks) {
    if (track.keyframes.length < 4) continue;

    // 키프레임 간 불투명도 변화 빈도 분석
    let flashCount = 0;
    for (let i = 0; i < track.keyframes.length - 1; i += 1) {
      const op1 = track.keyframes[i].opacity ?? 1;
      const op2 = track.keyframes[i + 1].opacity ?? 1;
      if (Math.abs(op1 - op2) > 0.6) {
        flashCount += 1;
      }
    }

    const durationSec = timeline.totalFrames / timeline.fps;
    const flashesPerSec = flashCount / durationSec;

    if (flashesPerSec >= 3) {
      diagnostics.push({
        code: "PHOTOSENSITIVITY_FLASH_RISK",
        targetId: track.targetId,
        message: `트랙 ${track.targetId}의 플래시 빈도(${flashesPerSec.toFixed(1)}Hz)가 안전 기준(3Hz 미만)을 초과합니다.`,
        severity: "error",
      });
    }
  }

  return Object.freeze(diagnostics);
}
