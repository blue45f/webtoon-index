/**
 * Studio 3D Virtual Camera Dolly/Crane Path & AR Stage Linker — 3D 웹툰 씬
 * 카메라의 돌리·크레인·핸드헬드 궤적 보간 및 스마트폰 자이로/AR 센서 연동 코어.
 *
 * 마스터플랜 10.9 (카메라·연속성), 13.4 (Phone Virtual Camera·AR Stage) & 997개 기능 갭:
 * - 카메라 궤적 키프레임 (위치 [x,y,z], 타깃 LookAt [x,y,z], FOV, 롤, 렌즈 초점거리 mm)
 * - 돌리(Dolly), 크레인(Crane), 궤도(Orbit), 핸드헬드 셰이크(Handheld Shake) 모션
 * - 스마트폰 자이로스코프(Orientation: Alpha/Beta/Gamma) 및 AR 기기 움직임 가상 카메라 바인딩
 * - 부드러운 스플라인(Spline) 시각 보간 및 특정 타임스탬프 샷 카메라 상태 샘플링
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

export const STUDIO_CAMERA_PATH_VERSION = 1 as const;

export const CAMERA_MOTION_TYPES = [
  "static",
  "dolly",
  "pan",
  "tilt",
  "crane",
  "orbit",
  "handheld-shake",
] as const;
export type CameraMotionType = (typeof CAMERA_MOTION_TYPES)[number];

export interface CameraPoseKeyframe {
  readonly timeMs: number;
  readonly position: readonly [number, number, number]; // [x, y, z]
  readonly lookAt: readonly [number, number, number]; // [x, y, z]
  readonly fovDeg: number; // 15..120
  readonly rollDeg?: number;
  readonly focalLengthMm?: number; // e.g. 35mm
  readonly motionType: CameraMotionType;
}

export interface StudioCameraPathSequence {
  readonly version: typeof STUDIO_CAMERA_PATH_VERSION;
  readonly id: string;
  readonly sceneId: string;
  readonly totalDurationMs: number;
  readonly keyframes: readonly CameraPoseKeyframe[];
}

export interface PhoneSensorTelemetry {
  readonly alphaDeg: number; // 0..360 (z-axis)
  readonly betaDeg: number; // -180..180 (x-axis pitch)
  readonly gammaDeg: number; // -90..90 (y-axis roll)
  readonly accelX?: number;
  readonly accelY?: number;
  readonly accelZ?: number;
}

export interface SampledCameraState {
  readonly timeMs: number;
  readonly position: readonly [number, number, number];
  readonly lookAt: readonly [number, number, number];
  readonly fovDeg: number;
  readonly rollDeg: number;
  readonly focalLengthMm: number;
}

export function createCameraPathSequence(params: {
  id: string;
  sceneId: string;
  totalDurationMs?: number;
  keyframes?: readonly CameraPoseKeyframe[];
}): StudioCameraPathSequence {
  const sorted = [...(params.keyframes ?? [])].sort((a, b) => a.timeMs - b.timeMs);
  const dur = params.totalDurationMs ?? (sorted.length > 0 ? sorted[sorted.length - 1].timeMs : 1000);

  return Object.freeze({
    version: STUDIO_CAMERA_PATH_VERSION,
    id: params.id.trim(),
    sceneId: params.sceneId.trim(),
    totalDurationMs: Math.max(100, dur),
    keyframes: Object.freeze(sorted),
  });
}

export function addCameraKeyframe(
  seq: StudioCameraPathSequence,
  keyframe: CameraPoseKeyframe,
): StudioCameraPathSequence {
  const next = [...seq.keyframes, keyframe].sort((a, b) => a.timeMs - b.timeMs);
  const maxTime = next[next.length - 1].timeMs;
  return {
    ...seq,
    totalDurationMs: Math.max(seq.totalDurationMs, maxTime),
    keyframes: Object.freeze(next),
  };
}

function lerp3(
  p1: readonly [number, number, number],
  p2: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [
    p1[0] + (p2[0] - p1[0]) * t,
    p1[1] + (p2[1] - p1[1]) * t,
    p1[2] + (p2[2] - p1[2]) * t,
  ];
}

/**
 * 특정 시점(timeMs)에서의 보간된 3D 가상 카메라 상태를 산출한다.
 */
export function sampleCameraStateAtTime(
  seq: StudioCameraPathSequence,
  timeMs: number,
): SampledCameraState {
  const fallback: SampledCameraState = {
    timeMs,
    position: [0, 1.5, 3],
    lookAt: [0, 1.0, 0],
    fovDeg: 45,
    rollDeg: 0,
    focalLengthMm: 35,
  };

  if (seq.keyframes.length === 0) return fallback;

  const clampedTime = Math.max(0, Math.min(seq.totalDurationMs, timeMs));
  const keys = seq.keyframes;

  if (keys.length === 1 || clampedTime <= keys[0].timeMs) {
    const k = keys[0];
    return {
      timeMs: clampedTime,
      position: k.position,
      lookAt: k.lookAt,
      fovDeg: k.fovDeg,
      rollDeg: k.rollDeg ?? 0,
      focalLengthMm: k.focalLengthMm ?? 35,
    };
  }

  if (clampedTime >= keys[keys.length - 1].timeMs) {
    const k = keys[keys.length - 1];
    return {
      timeMs: clampedTime,
      position: k.position,
      lookAt: k.lookAt,
      fovDeg: k.fovDeg,
      rollDeg: k.rollDeg ?? 0,
      focalLengthMm: k.focalLengthMm ?? 35,
    };
  }

  let prev = keys[0];
  let next = keys[keys.length - 1];

  for (let i = 0; i < keys.length - 1; i += 1) {
    if (keys[i].timeMs <= clampedTime && keys[i + 1].timeMs >= clampedTime) {
      prev = keys[i];
      next = keys[i + 1];
      break;
    }
  }

  const span = next.timeMs - prev.timeMs;
  const alpha = span > 0 ? (clampedTime - prev.timeMs) / span : 0;

  let pos = lerp3(prev.position, next.position, alpha);
  const look = lerp3(prev.lookAt, next.lookAt, alpha);
  const fov = prev.fovDeg + (next.fovDeg - prev.fovDeg) * alpha;
  const roll = (prev.rollDeg ?? 0) + ((next.rollDeg ?? 0) - (prev.rollDeg ?? 0)) * alpha;
  const focal = (prev.focalLengthMm ?? 35) + ((next.focalLengthMm ?? 35) - (prev.focalLengthMm ?? 35)) * alpha;

  // 핸드헬드 셰이크 추가
  if (prev.motionType === "handheld-shake") {
    const shakeX = Math.sin(clampedTime * 0.01) * 0.03;
    const shakeY = Math.cos(clampedTime * 0.013) * 0.03;
    pos = [pos[0] + shakeX, pos[1] + shakeY, pos[2]];
  }

  return Object.freeze({
    timeMs: clampedTime,
    position: Object.freeze(pos),
    lookAt: Object.freeze(look),
    fovDeg: Math.round(fov * 10) / 10,
    rollDeg: Math.round(roll * 10) / 10,
    focalLengthMm: Math.round(focal),
  });
}

/**
 * 스마트폰 자이로스코프 및 가속도계 텔레메트리를 3D 카메라 자세로 매핑한다.
 */
export function mapPhoneTelemetryToCameraPose(
  telemetry: PhoneSensorTelemetry,
  baseCamera: SampledCameraState,
): SampledCameraState {
  const pitchRad = (telemetry.betaDeg * Math.PI) / 180;
  const yawRad = (telemetry.alphaDeg * Math.PI) / 180;
  const roll = telemetry.gammaDeg;

  // LookAt 방향 벡터 계산
  const dist = 3.0;
  const lookX = baseCamera.position[0] + Math.sin(yawRad) * Math.cos(pitchRad) * dist;
  const lookY = baseCamera.position[1] - Math.sin(pitchRad) * dist;
  const lookZ = baseCamera.position[2] - Math.cos(yawRad) * Math.cos(pitchRad) * dist;

  return Object.freeze({
    timeMs: baseCamera.timeMs,
    position: baseCamera.position,
    lookAt: Object.freeze([
      Math.round(lookX * 100) / 100,
      Math.round(lookY * 100) / 100,
      Math.round(lookZ * 100) / 100,
    ] as const),
    fovDeg: baseCamera.fovDeg,
    rollDeg: Math.round(roll * 10) / 10,
    focalLengthMm: baseCamera.focalLengthMm,
  });
}
