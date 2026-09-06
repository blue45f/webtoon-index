/**
 * studio-3d-camera-cinematic-director.ts
 *
 * Webtoon Cinematography Director & Camera Cut System.
 * Supports webtoon cut bookmarks, exact live-camera capture, animated shot switching,
 * transition easing, bounded shot-deck playback, and multi-frequency camera shake effects.
 */

export type WebtoonShotAngleKind =
  | "birds-eye-topdown"
  | "high-angle-drama"
  | "eye-level-dialogue"
  | "low-angle-heroic"
  | "dutch-tilt-tension"
  | "extreme-close-up-gaze"
  | "over-the-shoulder"
  | "wide-establishing";

export type CameraShakePreset =
  | "none"
  | "handheld-subtle"
  | "earthquake-rumble"
  | "explosive-shockwave"
  | "heartbeat-throb"
  | "running-footstep";

export type WebtoonShotTransitionEasing =
  | "linear"
  | "ease-in-out"
  | "spring-punch"
  | "whip-pan";

export type WebtoonPanelAspect = "9:16" | "4:5" | "1:1" | "16:9" | "21:9";

export interface WebtoonShotBookmark {
  readonly id: string;
  readonly name: string;
  readonly episodePanelIndex: number;
  readonly angleKind: WebtoonShotAngleKind;
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number; // Field of View in degrees
  readonly dutchRollDegrees: number; // Dutch tilt angle
  readonly transitionSeconds: number;
  readonly easing: WebtoonShotTransitionEasing;
  /** Hold time after the camera arrives; old bookmarks may omit it. */
  readonly holdSeconds?: number;
  /** Editorial frame metadata; old bookmarks may omit it. */
  readonly panelAspect?: WebtoonPanelAspect;
  readonly safeFramePercent?: number;
}

export interface CreateShotBookmarkOptions {
  readonly transitionSeconds?: number;
  readonly easing?: WebtoonShotTransitionEasing;
  readonly holdSeconds?: number;
  readonly panelAspect?: WebtoonPanelAspect;
  readonly safeFramePercent?: number;
}

export interface WebtoonCameraSnapshot {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fovDegrees: number;
  readonly up?: readonly [number, number, number];
}

export interface WebtoonCameraFrame {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
  readonly dutchRollDegrees: number;
}

export interface WebtoonShotPlaybackStep {
  readonly shotId: string;
  readonly shotIndex: number;
  readonly transitionStartSeconds: number;
  readonly arrivalSeconds: number;
  readonly holdEndSeconds: number;
}

export interface WebtoonShotPlaybackPlan {
  readonly totalSeconds: number;
  readonly steps: readonly WebtoonShotPlaybackStep[];
}

export interface CameraShakeConfig {
  readonly preset: CameraShakePreset;
  readonly intensity: number; // 0.0 to 2.0
  readonly frequency: number; // Hz (e.g. 5 to 30)
  readonly decayRate: number; // 0.0 to 1.0 per second
}

export interface CameraShakeOffset {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  readonly rollDegrees: number;
}

export const WEBTOON_SHOT_ANGLE_PRESETS: readonly {
  readonly kind: WebtoonShotAngleKind;
  readonly label: string;
  readonly description: string;
  readonly defaultFov: number;
  readonly defaultDutchRoll: number;
  readonly relativeOffset: readonly [number, number, number];
}[] = [
  {
    kind: "birds-eye-topdown",
    label: "조감도 (Bird's Eye Topdown)",
    description: "전체 전장 및 맵 전체를 위에서 수직으로 내려다보는 연출",
    defaultFov: 45,
    defaultDutchRoll: 0,
    relativeOffset: [0, 8.0, 0.1],
  },
  {
    kind: "high-angle-drama",
    label: "하이 앵글 부감 (High Angle)",
    description: "캐릭터를 위에서 내려다보며 심리적 위축이나 고립감을 극대화",
    defaultFov: 38,
    defaultDutchRoll: 0,
    relativeOffset: [0, 3.5, 4.0],
  },
  {
    kind: "eye-level-dialogue",
    label: "아이레벨 대화샷 (Eye Level)",
    description: "인물의 눈높이에 맞춘 자연스러운 일상 대화 및 감정 교류",
    defaultFov: 50,
    defaultDutchRoll: 0,
    relativeOffset: [0, 1.5, 3.0],
  },
  {
    kind: "low-angle-heroic",
    label: "로우 앵글 앙각 (Heroic Low Angle)",
    description: "아래에서 올려다보며 압도적인 위압감과 주인공의 승리감을 강조",
    defaultFov: 28,
    defaultDutchRoll: 0,
    relativeOffset: [0, 0.3, 2.5],
  },
  {
    kind: "dutch-tilt-tension",
    label: "더치 앵글 사각 (Dutch Tilt Tension)",
    description: "카메라를 15~25도 기울여 광기, 공포, 극도의 불안 긴장감 조성",
    defaultFov: 35,
    defaultDutchRoll: 20,
    relativeOffset: [0.8, 1.2, 2.8],
  },
  {
    kind: "extreme-close-up-gaze",
    label: "익스트림 클로즈업 (Extreme Close-Up)",
    description: "눈동자, 입술, 손끝 등 결정적 디테일을 강렬하게 포커싱",
    defaultFov: 24,
    defaultDutchRoll: 0,
    relativeOffset: [0, 1.55, 1.1],
  },
  {
    kind: "over-the-shoulder",
    label: "어깨 너머 샷 (Over the Shoulder)",
    description: "상대방의 어깨 뒤에서 대치하는 구도로 몰입감 넘치는 대화 연출",
    defaultFov: 42,
    defaultDutchRoll: 0,
    relativeOffset: [0.4, 1.6, 2.2],
  },
  {
    kind: "wide-establishing",
    label: "와이드 배경 제시 (Wide Establishing)",
    description: "화려한 성, 도시, 숲 전체의 웅장한 전경을 한눈에 담는 샷",
    defaultFov: 65,
    defaultDutchRoll: 0,
    relativeOffset: [0, 4.0, 12.0],
  },
];

function finiteInRange(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeVec3(
  value: readonly [number, number, number],
): readonly [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-8) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function subtract(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function cross(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): readonly [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function dot(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function estimateDutchRollDegrees(snapshot: WebtoonCameraSnapshot): number {
  if (!snapshot.up) return 0;
  const forward = normalizeVec3(subtract(snapshot.target, snapshot.position));
  const worldUp: readonly [number, number, number] = [0, 1, 0];
  const rightRaw = cross(forward, worldUp);
  if (Math.hypot(rightRaw[0], rightRaw[1], rightRaw[2]) <= 1e-5) return 0;
  const right = normalizeVec3(rightRaw);
  const referenceUp = normalizeVec3(cross(right, forward));
  const actualUp = normalizeVec3(snapshot.up);
  return (Math.atan2(dot(actualUp, right), dot(actualUp, referenceUp)) * 180) / Math.PI;
}

function normalizeDegrees(value: number): number {
  let normalized = value % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function lerpVec3(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  progress: number,
): readonly [number, number, number] {
  return [
    lerp(from[0], to[0], progress),
    lerp(from[1], to[1], progress),
    lerp(from[2], to[2], progress),
  ];
}

export function evaluateWebtoonShotEasing(
  easing: WebtoonShotTransitionEasing,
  rawProgress: number,
): number {
  const progress = Math.max(0, Math.min(1, rawProgress));
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  switch (easing) {
    case "linear":
      return progress;
    case "ease-in-out":
      return progress * progress * (3 - 2 * progress);
    case "spring-punch": {
      const settle = 1 - Math.exp(-7 * progress);
      const punch = Math.sin(progress * Math.PI * 2.5) * (1 - progress) * 0.08;
      return Math.max(0, Math.min(1, settle + punch));
    }
    case "whip-pan":
      return progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - ((-2 * progress + 2) ** 3) / 2;
  }
}

/**
 * Generates procedural camera shake offset at time `timeSeconds`.
 */
export function calculateCameraShake(
  config: CameraShakeConfig,
  timeSeconds: number,
): CameraShakeOffset {
  if (config.preset === "none" || config.intensity <= 0.001) {
    return { offsetX: 0, offsetY: 0, offsetZ: 0, rollDegrees: 0 };
  }

  const freq = config.frequency;
  const amp = config.intensity;

  let rawX = 0;
  let rawY = 0;
  let rawZ = 0;
  let rawRoll = 0;

  switch (config.preset) {
    case "handheld-subtle": {
      rawX = Math.sin(timeSeconds * freq * 0.7) * 0.015 * amp;
      rawY = Math.cos(timeSeconds * freq * 0.9) * 0.012 * amp;
      rawRoll = Math.sin(timeSeconds * freq * 0.5) * 0.3 * amp;
      break;
    }

    case "earthquake-rumble": {
      rawX = (Math.sin(timeSeconds * freq * 1.3) + Math.cos(timeSeconds * freq * 2.7) * 0.5) * 0.06 * amp;
      rawY = (Math.sin(timeSeconds * freq * 1.9) + Math.sin(timeSeconds * freq * 3.1) * 0.4) * 0.08 * amp;
      rawZ = Math.cos(timeSeconds * freq * 2.1) * 0.04 * amp;
      rawRoll = Math.sin(timeSeconds * freq * 1.5) * 1.2 * amp;
      break;
    }

    case "explosive-shockwave": {
      const decay = Math.exp(-config.decayRate * Math.max(0, timeSeconds));
      rawX = Math.sin(timeSeconds * freq * 3.0) * 0.15 * amp * decay;
      rawY = Math.cos(timeSeconds * freq * 3.4) * 0.20 * amp * decay;
      rawZ = Math.sin(timeSeconds * freq * 2.5) * 0.12 * amp * decay;
      rawRoll = Math.sin(timeSeconds * freq * 2.0) * 3.5 * amp * decay;
      break;
    }

    case "heartbeat-throb": {
      const phase = (timeSeconds * (freq / 10)) % 1.0;
      const pulse = phase < 0.2 ? Math.sin((phase / 0.2) * Math.PI) : 0;
      rawZ = -pulse * 0.08 * amp;
      rawY = pulse * 0.02 * amp;
      rawRoll = pulse * 0.4 * amp;
      break;
    }

    case "running-footstep": {
      const stride = timeSeconds * freq;
      rawY = Math.abs(Math.sin(stride)) * 0.05 * amp;
      rawX = Math.sin(stride * 0.5) * 0.03 * amp;
      rawRoll = Math.sin(stride * 0.5) * 0.8 * amp;
      break;
    }
  }

  return {
    offsetX: rawX,
    offsetY: rawY,
    offsetZ: rawZ,
    rollDegrees: rawRoll,
  };
}

/** Creates a new preset-relative Webtoon Shot Bookmark. */
export function createShotBookmark(
  id: string,
  name: string,
  episodePanelIndex: number,
  angleKind: WebtoonShotAngleKind,
  targetPosition: readonly [number, number, number] = [0, 1.0, 0],
  options: CreateShotBookmarkOptions = {},
): WebtoonShotBookmark {
  const preset = WEBTOON_SHOT_ANGLE_PRESETS.find((entry) => entry.kind === angleKind) ??
    WEBTOON_SHOT_ANGLE_PRESETS[2]!;
  const camPos: [number, number, number] = [
    targetPosition[0] + preset.relativeOffset[0],
    targetPosition[1] + preset.relativeOffset[1],
    targetPosition[2] + preset.relativeOffset[2],
  ];

  const target: readonly [number, number, number] = [
    targetPosition[0], targetPosition[1], targetPosition[2],
  ];
  return Object.freeze({
    id,
    name,
    episodePanelIndex: Math.max(1, Math.trunc(episodePanelIndex)),
    angleKind,
    position: camPos,
    target,
    fov: preset.defaultFov,
    dutchRollDegrees: preset.defaultDutchRoll,
    transitionSeconds: finiteInRange(options.transitionSeconds, 0, 8, 0.8),
    easing: options.easing ?? "ease-in-out",
    holdSeconds: finiteInRange(options.holdSeconds, 0.1, 20, 1.2),
    panelAspect: options.panelAspect ?? "9:16",
    safeFramePercent: finiteInRange(options.safeFramePercent, 50, 100, 90),
  });
}

/** Captures the exact live camera instead of approximating it from a preset offset. */
export function createShotBookmarkFromCamera(
  id: string,
  name: string,
  episodePanelIndex: number,
  angleKind: WebtoonShotAngleKind,
  snapshot: WebtoonCameraSnapshot,
  options: CreateShotBookmarkOptions = {},
): WebtoonShotBookmark {
  const position: readonly [number, number, number] = [
    snapshot.position[0], snapshot.position[1], snapshot.position[2],
  ];
  const target: readonly [number, number, number] = [
    snapshot.target[0], snapshot.target[1], snapshot.target[2],
  ];
  return Object.freeze({
    id,
    name,
    episodePanelIndex: Math.max(1, Math.trunc(episodePanelIndex)),
    angleKind,
    position,
    target,
    fov: finiteInRange(snapshot.fovDegrees, 1, 179, 45),
    dutchRollDegrees: finiteInRange(estimateDutchRollDegrees(snapshot), -180, 180, 0),
    transitionSeconds: finiteInRange(options.transitionSeconds, 0, 8, 0.8),
    easing: options.easing ?? "ease-in-out",
    holdSeconds: finiteInRange(options.holdSeconds, 0.1, 20, 1.2),
    panelAspect: options.panelAspect ?? "9:16",
    safeFramePercent: finiteInRange(options.safeFramePercent, 50, 100, 90),
  });
}

/** Samples an animated switch from one saved camera to the next. */
export function interpolateShotBookmark(
  from: WebtoonShotBookmark,
  to: WebtoonShotBookmark,
  rawProgress: number,
): WebtoonCameraFrame {
  const progress = evaluateWebtoonShotEasing(to.easing, rawProgress);
  const rollDelta = normalizeDegrees(to.dutchRollDegrees - from.dutchRollDegrees);
  return Object.freeze({
    position: lerpVec3(from.position, to.position, progress),
    target: lerpVec3(from.target, to.target, progress),
    fov: lerp(from.fov, to.fov, progress),
    dutchRollDegrees: normalizeDegrees(from.dutchRollDegrees + rollDelta * progress),
  });
}

/** Builds a deterministic timeline for camera-switch and hold playback. */
export function createShotDeckPlaybackPlan(
  bookmarks: readonly WebtoonShotBookmark[],
): WebtoonShotPlaybackPlan {
  const steps: WebtoonShotPlaybackStep[] = [];
  let cursor = 0;
  for (let index = 0; index < bookmarks.length; index += 1) {
    const bookmark = bookmarks[index];
    if (!bookmark) continue;
    const transitionSeconds = index === 0
      ? 0
      : finiteInRange(bookmark.transitionSeconds, 0, 8, 0.8);
    const holdSeconds = finiteInRange(bookmark.holdSeconds, 0.1, 20, 1.2);
    const arrivalSeconds = cursor + transitionSeconds;
    const holdEndSeconds = arrivalSeconds + holdSeconds;
    steps.push(Object.freeze({
      shotId: bookmark.id,
      shotIndex: index,
      transitionStartSeconds: cursor,
      arrivalSeconds,
      holdEndSeconds,
    }));
    cursor = holdEndSeconds;
  }
  return Object.freeze({ totalSeconds: cursor, steps: Object.freeze(steps) });
}
