/**
 * Studio Shot Take Manager — 웹툰 컷/3D 샷에 영화적 Take(A/B/C) 개념을 적용하여
 * 카메라·포즈·표정·조명·대사 후보를 관리하고 감독 승인 및 합성(Take Blending)을 수행하는 코어.
 *
 * 마스터플랜 13.3 (Shot Take Manager) & 41개 경쟁제품 기능 갭 전수 비교:
 * - 샷별 다중 Take (Take A/B/C/D) 등록 및 상태 관리 (selected, alternate, hold, discarded)
 * - 카메라(화각/앵글), 포즈/표정, 조명 프리셋, 대사/말풍선, 2D 오버레이 후보군 분기
 * - 요소별 합성(Take Blending): 예) Take A 카메라 + Take B 조명 + Take C 표정 조합
 * - 영웅 테이크(Hero Take) 선택 및 승인 잠금(Approved Lock)
 * - 순수 함수, 불변성, 결정론, DOM/React 무관
 */

import type {
  StudioSceneLightingPreset,
  StudioSceneShotCameraAngle,
} from "./studio-scene-recipe";

export const STUDIO_SHOT_TAKE_MANAGER_VERSION = 1 as const;

export const STUDIO_SHOT_TAKE_LIMITS = Object.freeze({
  maxTakesPerShot: 32,
  maxIdLength: 128,
  maxLabelLength: 160,
  maxNoteLength: 512,
  maxDiagnostics: 256,
});

export const TAKE_EVALUATION_STATUSES = [
  "selected",
  "alternate",
  "hold",
  "discarded",
] as const;
export type TakeEvaluationStatus = (typeof TAKE_EVALUATION_STATUSES)[number];

export interface ShotTakeCameraConfig {
  readonly angle: StudioSceneShotCameraAngle;
  readonly zoom: number; // 0.25..4.0
  readonly fovDeg?: number; // 15..120
  readonly positionOffset?: readonly [number, number, number];
}

export interface ShotTakePoseExpressionConfig {
  readonly poseRef?: string;
  readonly expressionRef?: string;
  readonly customGaze?: readonly [number, number, number];
}

export interface ShotTakeLightingConfig {
  readonly preset: StudioSceneLightingPreset;
  readonly intensity: number; // 0..2
  readonly shadowSoftness?: number; // 0..1
}

export interface ShotTakeDialogueConfig {
  readonly text: string;
  readonly speakerId?: string;
  readonly balloonShape?: string;
}

export interface ShotTake {
  readonly id: string;
  readonly shotId: string;
  readonly takeLabel: string; // e.g. "Take A", "Take B - Low Angle Dramatic"
  readonly evaluation: TakeEvaluationStatus;
  readonly camera: ShotTakeCameraConfig;
  readonly poseExpression?: ShotTakePoseExpressionConfig;
  readonly lighting?: ShotTakeLightingConfig;
  readonly dialogue?: ShotTakeDialogueConfig;
  readonly artOverlayRef?: string;
  readonly directorNote?: string;
  readonly isApprovedLock?: boolean;
  readonly createdAtMs: number;
}

export interface ShotTakeCollection {
  readonly version: typeof STUDIO_SHOT_TAKE_MANAGER_VERSION;
  readonly shotId: string;
  readonly activeHeroTakeId?: string;
  readonly takes: readonly ShotTake[];
}

export function createShotTakeCollection(params: {
  shotId: string;
  takes?: readonly ShotTake[];
  activeHeroTakeId?: string;
}): ShotTakeCollection {
  return Object.freeze({
    version: STUDIO_SHOT_TAKE_MANAGER_VERSION,
    shotId: params.shotId.trim(),
    activeHeroTakeId: params.activeHeroTakeId?.trim(),
    takes: Object.freeze([...(params.takes ?? [])]),
  });
}

export function addShotTake(
  collection: ShotTakeCollection,
  take: ShotTake,
): ShotTakeCollection {
  if (collection.takes.some((t) => t.id === take.id)) {
    throw new Error(`Take ${take.id} already exists`);
  }
  const isFirst = collection.takes.length === 0;
  const isSelected = take.evaluation === "selected" || isFirst;

  const nextTakes = [...collection.takes, take].map((t) => {
    if (isSelected && t.id !== take.id && t.evaluation === "selected") {
      return { ...t, evaluation: "alternate" as const };
    }
    return t;
  });

  return {
    ...collection,
    activeHeroTakeId: isSelected ? take.id : collection.activeHeroTakeId,
    takes: Object.freeze(nextTakes),
  };
}

export function selectHeroTake(
  collection: ShotTakeCollection,
  takeId: string,
  directorNote?: string,
): ShotTakeCollection {
  const target = collection.takes.find((t) => t.id === takeId);
  if (!target) {
    throw new Error(`Take ${takeId} not found`);
  }

  const nextTakes = collection.takes.map((t) => {
    if (t.id === takeId) {
      return Object.freeze({
        ...t,
        evaluation: "selected" as const,
        directorNote: directorNote?.trim() ?? t.directorNote,
      });
    }
    if (t.evaluation === "selected") {
      return Object.freeze({
        ...t,
        evaluation: "alternate" as const,
      });
    }
    return t;
  });

  return {
    ...collection,
    activeHeroTakeId: takeId,
    takes: Object.freeze(nextTakes),
  };
}

export function lockApprovedTake(
  collection: ShotTakeCollection,
  takeId: string,
): ShotTakeCollection {
  const index = collection.takes.findIndex((t) => t.id === takeId);
  if (index === -1) {
    throw new Error(`Take ${takeId} not found`);
  }
  const updated: ShotTake = {
    ...collection.takes[index],
    evaluation: "selected",
    isApprovedLock: true,
  };
  const nextTakes = [...collection.takes];
  nextTakes[index] = Object.freeze(updated);

  return {
    ...collection,
    activeHeroTakeId: takeId,
    takes: Object.freeze(nextTakes),
  };
}

/**
 * 여러 Take의 요소를 합성하여 새로운 하이브리드 Take를 생성한다.
 */
export function blendCompositeTake(
  collection: ShotTakeCollection,
  params: {
    newTakeId: string;
    newTakeLabel: string;
    cameraFromTakeId: string;
    poseFromTakeId?: string;
    lightingFromTakeId?: string;
    dialogueFromTakeId?: string;
    artOverlayFromTakeId?: string;
    directorNote?: string;
    nowMs: number;
  },
): ShotTakeCollection {
  const camTake = collection.takes.find((t) => t.id === params.cameraFromTakeId);
  if (!camTake) throw new Error(`Camera take ${params.cameraFromTakeId} not found`);

  const poseTake = params.poseFromTakeId
    ? collection.takes.find((t) => t.id === params.poseFromTakeId)
    : camTake;
  const lightTake = params.lightingFromTakeId
    ? collection.takes.find((t) => t.id === params.lightingFromTakeId)
    : camTake;
  const dialTake = params.dialogueFromTakeId
    ? collection.takes.find((t) => t.id === params.dialogueFromTakeId)
    : camTake;
  const artTake = params.artOverlayFromTakeId
    ? collection.takes.find((t) => t.id === params.artOverlayFromTakeId)
    : camTake;

  const blendedTake: ShotTake = Object.freeze({
    id: params.newTakeId.trim(),
    shotId: collection.shotId,
    takeLabel: params.newTakeLabel.trim(),
    evaluation: "selected",
    camera: camTake.camera,
    poseExpression: poseTake?.poseExpression,
    lighting: lightTake?.lighting,
    dialogue: dialTake?.dialogue,
    artOverlayRef: artTake?.artOverlayRef,
    directorNote: params.directorNote?.trim() ?? "합성(Blended) Take",
    createdAtMs: params.nowMs,
  });

  return addShotTake(collection, blendedTake);
}
