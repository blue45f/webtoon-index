import type {
  StudioBg3dCameraSettings,
  StudioBg3dShot,
  StudioBg3dVec3,
} from "./studio-bg3d-scene-document";

export type StudioBg3dShotContinuitySeverity = "info" | "warning" | "critical";

export type StudioBg3dShotContinuityIssueCode =
  | "duplicate-framing"
  | "projection-cut"
  | "reverse-axis-cut"
  | "large-angle-cut"
  | "focal-jump"
  | "camera-jump"
  | "target-jump"
  | "roll-jump"
  | "near-clip-risk";

export interface StudioBg3dShotContinuityIssue {
  readonly code: StudioBg3dShotContinuityIssueCode;
  readonly severity: StudioBg3dShotContinuitySeverity;
  readonly label: string;
  readonly recommendation: string;
}

export interface StudioBg3dShotContinuityTransition {
  readonly fromShotId: string;
  readonly fromShotName: string;
  readonly toShotId: string;
  readonly toShotName: string;
  readonly cameraDistance: number;
  readonly targetDistance: number;
  readonly viewAngleDegrees: number;
  readonly fovDeltaDegrees: number;
  readonly upVectorDeltaDegrees: number;
  readonly score: number;
  readonly issues: readonly StudioBg3dShotContinuityIssue[];
}

export interface StudioBg3dShotContinuityReport {
  readonly shotCount: number;
  readonly transitionCount: number;
  readonly score: number;
  readonly criticalCount: number;
  readonly warningCount: number;
  readonly infoCount: number;
  readonly transitions: readonly StudioBg3dShotContinuityTransition[];
}

const DEFAULT_UP: StudioBg3dVec3 = [0, 1, 0];
const EPSILON = 1e-6;

function copyVec3(value: StudioBg3dVec3): StudioBg3dVec3 {
  return [value[0], value[1], value[2]];
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function subtract(
  left: StudioBg3dVec3,
  right: StudioBg3dVec3,
): StudioBg3dVec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function magnitude(value: StudioBg3dVec3): number {
  return Math.hypot(value[0], value[1], value[2]);
}

function distance(left: StudioBg3dVec3, right: StudioBg3dVec3): number {
  return magnitude(subtract(left, right));
}

function normalize(value: StudioBg3dVec3): StudioBg3dVec3 {
  const length = magnitude(value);
  if (length <= EPSILON) return [0, 0, -1];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function dot(left: StudioBg3dVec3, right: StudioBg3dVec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function angleDegrees(left: StudioBg3dVec3, right: StudioBg3dVec3): number {
  const bounded = Math.max(-1, Math.min(1, dot(normalize(left), normalize(right))));
  return (Math.acos(bounded) * 180) / Math.PI;
}

function round(value: number, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function issue(
  code: StudioBg3dShotContinuityIssueCode,
  severity: StudioBg3dShotContinuitySeverity,
  label: string,
  recommendation: string,
): StudioBg3dShotContinuityIssue {
  return Object.freeze({ code, severity, label, recommendation });
}

/** Resolves one storyboard shot without mutating the canonical scene camera. */
export function resolveStudioBg3dShotContinuityCamera(
  baseCamera: StudioBg3dCameraSettings,
  shot: StudioBg3dShot,
): StudioBg3dCameraSettings {
  const override = shot.camera;
  const projection = override?.projection ?? baseCamera.projection;
  const zoom = finiteOr(override?.zoom, finiteOr(baseCamera.zoom, 1));
  const nearClip = finiteOr(override?.nearClip, finiteOr(baseCamera.nearClip, 0.01));
  const lensShift = override?.lensShift ?? baseCamera.lensShift;
  const up = override?.up ?? baseCamera.up ?? DEFAULT_UP;

  return Object.freeze({
    position: copyVec3(override?.position ?? baseCamera.position),
    target: copyVec3(override?.target ?? baseCamera.target),
    fovDegrees: finiteOr(override?.fovDegrees, baseCamera.fovDegrees),
    ...(projection ? { projection } : {}),
    ...(Number.isFinite(zoom) ? { zoom } : {}),
    ...(lensShift ? { lensShift: [lensShift[0], lensShift[1]] as const } : {}),
    ...(Number.isFinite(nearClip) ? { nearClip } : {}),
    up: copyVec3(up),
  });
}

function scorePenalty(severity: StudioBg3dShotContinuitySeverity): number {
  if (severity === "critical") return 22;
  if (severity === "warning") return 10;
  return 3;
}

function analyzeTransition(
  baseCamera: StudioBg3dCameraSettings,
  fromShot: StudioBg3dShot,
  toShot: StudioBg3dShot,
): StudioBg3dShotContinuityTransition {
  const from = resolveStudioBg3dShotContinuityCamera(baseCamera, fromShot);
  const to = resolveStudioBg3dShotContinuityCamera(baseCamera, toShot);
  const fromView = subtract(from.target, from.position);
  const toView = subtract(to.target, to.position);
  const fromSubjectDistance = Math.max(EPSILON, magnitude(fromView));
  const toSubjectDistance = Math.max(EPSILON, magnitude(toView));
  const averageSubjectDistance = (fromSubjectDistance + toSubjectDistance) / 2;
  const cameraDistance = distance(from.position, to.position);
  const targetDistance = distance(from.target, to.target);
  const viewAngleDegrees = angleDegrees(fromView, toView);
  const fovDeltaDegrees = Math.abs(from.fovDegrees - to.fovDegrees);
  const upVectorDeltaDegrees = angleDegrees(from.up ?? DEFAULT_UP, to.up ?? DEFAULT_UP);
  const cameraJumpRatio = cameraDistance / averageSubjectDistance;
  const targetJumpRatio = targetDistance / averageSubjectDistance;
  const issues: StudioBg3dShotContinuityIssue[] = [];

  if ((from.projection ?? "perspective") !== (to.projection ?? "perspective")) {
    issues.push(issue(
      "projection-cut",
      "critical",
      "원근/평행 투영이 컷 사이에서 바뀝니다.",
      "의도한 도식 컷이 아니라면 같은 투영을 유지하거나 전환 컷을 추가하세요.",
    ));
  }

  if (viewAngleDegrees >= 150) {
    issues.push(issue(
      "reverse-axis-cut",
      "critical",
      `시선축이 ${Math.round(viewAngleDegrees)}° 뒤집힙니다.`,
      "중립 와이드샷이나 축 이동용 인서트 컷을 사이에 넣어 180도 축 혼란을 줄이세요.",
    ));
  } else if (viewAngleDegrees >= 90) {
    issues.push(issue(
      "large-angle-cut",
      "warning",
      `카메라 방향이 ${Math.round(viewAngleDegrees)}° 크게 바뀝니다.`,
      "시선 방향과 화면 좌우 관계가 유지되는지 컷 스트립에서 확인하세요.",
    ));
  }

  if (fovDeltaDegrees >= 35) {
    issues.push(issue(
      "focal-jump",
      "critical",
      `화각이 ${Math.round(fovDeltaDegrees)}° 급변합니다.`,
      "중간 화각 샷을 추가하거나 같은 카메라 거리에서 단계적으로 렌즈를 바꾸세요.",
    ));
  } else if (fovDeltaDegrees >= 18) {
    issues.push(issue(
      "focal-jump",
      "warning",
      `화각이 ${Math.round(fovDeltaDegrees)}° 변합니다.`,
      "원근 압축과 얼굴 비율 변화가 의도한 연출인지 확인하세요.",
    ));
  }

  if (cameraJumpRatio >= 6) {
    issues.push(issue(
      "camera-jump",
      "critical",
      "피사체 거리 대비 카메라 이동이 매우 큽니다.",
      "장소 전환이 아니라면 establishing shot 또는 이동 연결 컷을 추가하세요.",
    ));
  } else if (cameraJumpRatio >= 2.5) {
    issues.push(issue(
      "camera-jump",
      "warning",
      "피사체 거리 대비 카메라 위치가 크게 바뀝니다.",
      "배경 랜드마크와 인물 화면 방향이 이어지는지 확인하세요.",
    ));
  }

  if (targetJumpRatio >= 2) {
    issues.push(issue(
      "target-jump",
      "warning",
      "주 시선 대상이 장면 규모 이상으로 이동합니다.",
      "새 대상의 위치를 알려주는 리액션·인서트 컷을 먼저 배치하세요.",
    ));
  }

  if (upVectorDeltaDegrees >= 28) {
    issues.push(issue(
      "roll-jump",
      "warning",
      `화면 수직축이 ${Math.round(upVectorDeltaDegrees)}° 변합니다.`,
      "더치 롤이 의도된 긴장 연출인지 확인하고, 일반 대화 컷에서는 기울기를 완화하세요.",
    ));
  }

  const toNearClip = finiteOr(to.nearClip, 0.01);
  if (toNearClip >= toSubjectDistance * 0.25) {
    issues.push(issue(
      "near-clip-risk",
      "warning",
      "다음 컷의 근거리 클리핑 면이 피사체에 너무 가깝습니다.",
      "손·얼굴 클로즈업에서 메쉬가 잘리지 않도록 near clip을 낮추세요.",
    ));
  }

  if (
    cameraDistance <= 0.005 &&
    targetDistance <= 0.005 &&
    fovDeltaDegrees <= 0.25 &&
    upVectorDeltaDegrees <= 0.25 &&
    (from.projection ?? "perspective") === (to.projection ?? "perspective")
  ) {
    issues.push(issue(
      "duplicate-framing",
      "info",
      "앞뒤 컷의 구도가 사실상 같습니다.",
      "대사 리듬을 위한 반복이 아니라면 표정·렌즈·카메라 높이 중 하나를 변화시키세요.",
    ));
  }

  const transitionScore = Math.max(
    0,
    100 - issues.reduce((total, current) => total + scorePenalty(current.severity), 0),
  );

  return Object.freeze({
    fromShotId: fromShot.id,
    fromShotName: fromShot.name,
    toShotId: toShot.id,
    toShotName: toShot.name,
    cameraDistance: round(cameraDistance),
    targetDistance: round(targetDistance),
    viewAngleDegrees: round(viewAngleDegrees, 1),
    fovDeltaDegrees: round(fovDeltaDegrees, 1),
    upVectorDeltaDegrees: round(upVectorDeltaDegrees, 1),
    score: transitionScore,
    issues: Object.freeze(issues),
  });
}

/**
 * Reviews ordered storyboard shots for disruptive camera cuts. This is an editorial aid rather than
 * a rule engine: every warning remains dismissible by the artist's intent.
 */
export function analyzeStudioBg3dShotContinuity(
  baseCamera: StudioBg3dCameraSettings,
  shots: readonly StudioBg3dShot[],
): StudioBg3dShotContinuityReport {
  const transitions: StudioBg3dShotContinuityTransition[] = [];
  for (let index = 1; index < shots.length; index += 1) {
    const previous = shots[index - 1];
    const current = shots[index];
    if (!previous || !current) continue;
    transitions.push(analyzeTransition(baseCamera, previous, current));
  }

  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  for (const transition of transitions) {
    for (const currentIssue of transition.issues) {
      if (currentIssue.severity === "critical") criticalCount += 1;
      else if (currentIssue.severity === "warning") warningCount += 1;
      else infoCount += 1;
    }
  }

  const score = transitions.length === 0
    ? 100
    : Math.round(
      transitions.reduce((total, transition) => total + transition.score, 0) /
        transitions.length,
    );

  return Object.freeze({
    shotCount: shots.length,
    transitionCount: transitions.length,
    score,
    criticalCount,
    warningCount,
    infoCount,
    transitions: Object.freeze(transitions),
  });
}

export function formatStudioBg3dShotContinuitySummary(
  report: StudioBg3dShotContinuityReport,
): string {
  if (report.transitionCount === 0) return "비교할 연속 컷이 없습니다.";
  if (report.criticalCount > 0) {
    return `연속성 ${report.score}점 · 치명 ${report.criticalCount} · 주의 ${report.warningCount}`;
  }
  if (report.warningCount > 0) {
    return `연속성 ${report.score}점 · 주의 ${report.warningCount}`;
  }
  return `연속성 ${report.score}점 · 큰 단절 없음`;
}
