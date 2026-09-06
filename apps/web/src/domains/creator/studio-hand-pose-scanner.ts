/**
 * Studio 손동작 전용 핸드 스캐너 & 핸드 포저(Hand Pose Scanner) 모듈.
 *
 * 카메라 비디오 프레임/사진의 MediaPipe Hand 랜드마크(21개 랜드마크)를 파싱하여
 * 5개 손가락(엄지, 검지, 중지, 약지, 소지)의 마디별(MCP, PIP, DIP) 굴곡/펴짐 각도를 정교하게 복원한다.
 * 또한 웹툰 작가가 자주 사용하는 손 포즈 프리셋(주먹, 가위바위보, 펜 잡기, 손가락 하트 등)을 지원한다.
 */

export interface StudioHandLandmark {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type StudioFingerName = "thumb" | "index" | "middle" | "ring" | "little";

export interface StudioFingerRotationSpec {
  /** 굴곡(Flexion/Extension) 0~1 (0=펴짐, 1=완전 굽힘). */
  readonly flex: number;
  /** 벌림(Abduction/Adduction) -1~1 (-1=오므림, 1=벌림). */
  readonly spread: number;
}

export type StudioHandPoseData = Record<StudioFingerName, StudioFingerRotationSpec>;

export interface StudioHandPreset {
  readonly id: string;
  readonly label: string;
  readonly pose: StudioHandPoseData;
}

/** 손 포즈 표준 프리셋 라이브러리. */
export const STUDIO_HAND_PRESETS: readonly StudioHandPreset[] = [
  {
    id: "open_palm",
    label: "펴진 손바닥",
    pose: {
      thumb: { flex: 0.1, spread: 0.5 },
      index: { flex: 0.0, spread: 0.2 },
      middle: { flex: 0.0, spread: 0.0 },
      ring: { flex: 0.0, spread: -0.1 },
      little: { flex: 0.0, spread: -0.3 },
    },
  },
  {
    id: "fist",
    label: "주먹 쥐기",
    pose: {
      thumb: { flex: 0.9, spread: -0.5 },
      index: { flex: 0.95, spread: 0.0 },
      middle: { flex: 0.95, spread: 0.0 },
      ring: { flex: 0.95, spread: 0.0 },
      little: { flex: 0.95, spread: 0.0 },
    },
  },
  {
    id: "peace",
    label: "V 사인(브이)",
    pose: {
      thumb: { flex: 0.8, spread: -0.3 },
      index: { flex: 0.0, spread: 0.4 },
      middle: { flex: 0.0, spread: -0.4 },
      ring: { flex: 0.9, spread: 0.0 },
      little: { flex: 0.9, spread: 0.0 },
    },
  },
  {
    id: "finger_heart",
    label: "손가락 하트",
    pose: {
      thumb: { flex: 0.4, spread: 0.6 },
      index: { flex: 0.5, spread: 0.2 },
      middle: { flex: 0.85, spread: 0.0 },
      ring: { flex: 0.85, spread: 0.0 },
      little: { flex: 0.85, spread: 0.0 },
    },
  },
  {
    id: "pointing",
    label: "지목(가리키기)",
    pose: {
      thumb: { flex: 0.7, spread: -0.2 },
      index: { flex: 0.0, spread: 0.0 },
      middle: { flex: 0.9, spread: 0.0 },
      ring: { flex: 0.9, spread: 0.0 },
      little: { flex: 0.9, spread: 0.0 },
    },
  },
  {
    id: "pencil_grip",
    label: "펜/붓 잡기",
    pose: {
      thumb: { flex: 0.45, spread: 0.3 },
      index: { flex: 0.4, spread: 0.1 },
      middle: { flex: 0.6, spread: 0.0 },
      ring: { flex: 0.8, spread: 0.0 },
      little: { flex: 0.8, spread: 0.0 },
    },
  },
];

/**
 * 21개 MediaPipe Hand 랜드마크에서 손가락 굴곡/벌림 스펙을 연산한다.
 */
export function solveHandLandmarksToPose(
  landmarks: readonly StudioHandLandmark[],
): StudioHandPoseData {
  if (landmarks.length < 21) {
    return STUDIO_HAND_PRESETS[0]!.pose;
  }

  const wrist = landmarks[0]!;

  const getFingerSpec = (
    mcpIdx: number,
    pipIdx: number,
    tipIdx: number,
  ): StudioFingerRotationSpec => {
    const mcp = landmarks[mcpIdx]!;
    const pip = landmarks[pipIdx]!;
    const tip = landmarks[tipIdx]!;

    const dMcpPip = Math.sqrt((pip.x - mcp.x) ** 2 + (pip.y - mcp.y) ** 2 + (pip.z - mcp.z) ** 2);
    const dMcpTip = Math.sqrt((tip.x - mcp.x) ** 2 + (tip.y - mcp.y) ** 2 + (tip.z - mcp.z) ** 2);
    const dWristTip = Math.sqrt((tip.x - wrist.x) ** 2 + (tip.y - wrist.y) ** 2 + (tip.z - wrist.z) ** 2);

    const ratio = dMcpPip > 1e-4 ? dMcpTip / (dMcpPip * 2) : 1;
    const flex = Math.max(0, Math.min(1, 1 - ratio));
    const spread = Math.max(-1, Math.min(1, (tip.x - wrist.x) / (dWristTip || 1)));

    return { flex, spread };
  };

  return {
    thumb: getFingerSpec(1, 2, 4),
    index: getFingerSpec(5, 6, 8),
    middle: getFingerSpec(9, 10, 12),
    ring: getFingerSpec(13, 14, 16),
    little: getFingerSpec(17, 18, 20),
  };
}
