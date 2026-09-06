// 웹캠 얼굴 추적 → VRM 캐릭터 제어 모듈.
// MediaPipe FaceLandmarker로 얼굴 블렌드셰이프 + 변환 행렬을 추출하고,
// EMA 스무딩을 거쳐 VRM 뼈 회전(head/neck) + 표정(blink/mouth/brow/gaze)으로 매핑한다.
//
// 설계 원칙:
//  - FaceLandmarker 인스턴스는 lazy 싱글턴으로 관리(초기화 비용 1회).
//  - Pure 함수(processTrackingResult, smoothRawChannels, convertChannelsToVrmData)는
//    MediaPipe 의존 없이 단위 테스트 가능하다.
//  - TrackingChannels는 "카메라 좌표계"(미러 전)이고,
//    convertChannelsToVrmData에서 mirrorMode·gazeLock·sensitivity를 반영한다.

import {
  resolveStudioMediaPipeVisionWasmFileset,
  type StudioMediaPipeVisionDelegate,
} from "../studio-mediapipe-vision-assets";
import {
  loadStudioMediaPipeVisionModule,
  runStudioMediaPipeVisionTaskCreation,
} from "../studio-mediapipe-vision-init-arbiter";

import { resolveStudioVrmExpressionConflicts } from "./studio-vrm-expression-conflict";
import { TrackingChannelFilterBank } from "./studio-vrm-one-euro";
import { solvePoseToVrmBones } from "./studio-vrm-pose-solver";

import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  HandLandmarker,
  PoseLandmarker,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";


/* ── Public Types ─────────────────────────────────────────────────────── */

/** 카메라에서 추출한 원시(raw) 얼굴 채널. 모든 값은 카메라 좌표계 기준. */
export interface TrackingChannels {
  /** 끄덕임 상하 (radians) */
  headPitch: number;
  /** 좌우 회전 (radians) */
  headYaw: number;
  /** 좌우 기울임 (radians) */
  headRoll: number;
  /** 왼눈 깜빡임 0-1 */
  blinkLeft: number;
  /** 오른눈 깜빡임 0-1 */
  blinkRight: number;
  /** 시선 X -1(왼)~1(오) */
  gazeX: number;
  /** 시선 Y -1(아래)~1(위) */
  gazeY: number;
  /** 입 벌림 0-1 */
  mouthOpen: number;
  /** 미소 0-1 */
  mouthSmile: number;
  /** 눈썹 안쪽 올림 0-1 */
  browInnerUp: number;
  /** 왼쪽 눈썹 바깥 올림 0-1 */
  browOuterUpLeft: number;
  /** 오른쪽 눈썹 바깥 올림 0-1 */
  browOuterUpRight: number;
  /** 눈썹 내림(찡그림) 0-1 — angry */
  browDown: number;
  /** 입꼬리 내림 0-1 — sad/angry */
  mouthFrown: number;
  /** 눈 크게 뜸 0-1 — surprised */
  eyeWide: number;
}

/** 트래킹 후처리 옵션. */
export interface TrackingOptions {
  /** true이면 시선을 정면 고정(캐릭터가 관객을 바라봄). */
  gazeLock: boolean;
  /** true이면 좌우를 거울 반전(셀프카메라 모드). */
  mirrorMode: boolean;
  /** 채널 감도 배율(0.5=둔감, 2=예민). */
  sensitivity: number;
  /** 스무딩 필터 값 (0.05=매우 부드러움, 1=즉각 반영) */
  smoothing: number;
  /** true이면 손가락 추적(HandLandmarker) 사용. */
  fingerTracking: boolean;
  /**
   * 표정 충돌 해소(studio-vrm-expression-conflict) 사용 여부. 기본 true.
   *
   * 끄면 채널에서 유도한 원본 가중치가 그대로 나간다 — 여러 감정이 동시에 켜지고 입 계열
   * 합계가 1 을 크게 넘길 수 있다. 유도식 자체를 검증할 때만 끈다.
   */
  resolveExpressionConflicts?: boolean;
  /**
   * 현재 모델이 실제로 가진 표정 이름. 충돌 해소가 이 목록 밖의 표정을 지배 표정으로
   * 뽑아 지원되는 표정만 깎는 일을 막는다(모델에 없는 이름은 적용 단계에서 버려진다).
   */
  availableExpressions?: readonly string[];
}

/** VRM 캐릭터에 적용할 뼈 회전 + 표정 가중치. */
export interface VrmTrackingData {
  /** VRM 뼈 이름 → [pitch, yaw, roll] Euler radians. */
  bones: Record<string, readonly [number, number, number]>;
  /** VRM 표정 이름 → 0-1 가중치. */
  expressions: Record<string, number>;
  /** 손가락 본 이름 → Euler radians (손가락 추적 시). */
  fingers?: Record<string, readonly [number, number, number]>;
  /**
   * VRM lookAt 직접 구동용(단위: 도(degree), mirror 반영 완료).
   * vrm.lookAt 이 없는 모델은 look* 표정 폴백을 사용한다.
   */
  lookAt?: { yawDeg: number; pitchDeg: number };
}

export interface StudioVrmMediaPipeLandmarkerInitOptions {
  /** Fixed before task creation. Omission selects the product-default GPU provider. */
  readonly delegate?: StudioMediaPipeVisionDelegate;
}

/* ── Constants ────────────────────────────────────────────────────────── */

/** 기본 트래킹 옵션. */
export const DEFAULT_TRACKING_OPTIONS: Readonly<TrackingOptions> = {
  gazeLock: false,
  mirrorMode: true,
  sensitivity: 1,
  smoothing: 0.35,
  fingerTracking: true,
  resolveExpressionConflicts: true,
};

/** 얼굴 미검출 시 복귀 기준이 되는 중립 채널(전부 0). */
export const NEUTRAL_CHANNELS: Readonly<TrackingChannels> = {
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  blinkLeft: 0,
  blinkRight: 0,
  gazeX: 0,
  gazeY: 0,
  mouthOpen: 0,
  mouthSmile: 0,
  browInnerUp: 0,
  browOuterUpLeft: 0,
  browOuterUpRight: 0,
  browDown: 0,
  mouthFrown: 0,
  eyeWide: 0,
};

/** 블렌드셰이프 이름 인덱스 빌드용. */
const BS = {
  eyeBlinkLeft: "eyeBlinkLeft",
  eyeBlinkRight: "eyeBlinkRight",
  jawOpen: "jawOpen",
  mouthSmileLeft: "mouthSmileLeft",
  mouthSmileRight: "mouthSmileRight",
  browInnerUp: "browInnerUp",
  browOuterUpLeft: "browOuterUpLeft",
  browOuterUpRight: "browOuterUpRight",
  eyeLookInLeft: "eyeLookInLeft",
  eyeLookOutLeft: "eyeLookOutLeft",
  eyeLookInRight: "eyeLookInRight",
  eyeLookOutRight: "eyeLookOutRight",
  eyeLookUpLeft: "eyeLookUpLeft",
  eyeLookDownLeft: "eyeLookDownLeft",
  eyeLookUpRight: "eyeLookUpRight",
  eyeLookDownRight: "eyeLookDownRight",
  // 감정 표현용(angry/sad/surprised).
  browDownLeft: "browDownLeft",
  browDownRight: "browDownRight",
  mouthFrownLeft: "mouthFrownLeft",
  mouthFrownRight: "mouthFrownRight",
  eyeWideLeft: "eyeWideLeft",
  eyeWideRight: "eyeWideRight",
} as const;

/* ── Singleton FaceLandmarker ─────────────────────────────────────────── */

let cachedLandmarker: FaceLandmarker | null = null;
let cachedFaceLandmarkerDelegate: StudioMediaPipeVisionDelegate | null = null;
let initPromise: Promise<FaceLandmarker> | null = null;
let initPromiseGeneration: number | null = null;
let initPromiseDelegate: StudioMediaPipeVisionDelegate | null = null;
let faceLandmarkerGeneration = 0;

function liveLandmarkerDisposedError(kind: "face" | "hand" | "pose"): Error {
  const error = new Error(`Live ${kind} landmarker initialization was disposed.`);
  error.name = "AbortError";
  return error;
}

function landmarkerDelegateIdentityError(
  kind: "face" | "hand" | "pose" | "photo-hand" | "photo-pose",
): Error {
  const error = new Error(
    `The ${kind} MediaPipe singleton is already owned by another delegate.`,
  );
  error.name = "StudioVrmMediaPipeDelegateIdentityError";
  return error;
}

function safelyCloseLiveLandmarker(landmarker: { close(): void }): void {
  try {
    landmarker.close();
  } catch {
    // A stale task must never reclaim cache ownership even when MediaPipe cleanup fails.
  }
}

/**
 * MediaPipe FaceLandmarker를 lazy 초기화(싱글턴).
 * 두 번째 호출부터는 캐시된 인스턴스를 즉시 반환한다.
 */
export async function initFaceLandmarker(
  options: StudioVrmMediaPipeLandmarkerInitOptions = {},
): Promise<FaceLandmarker> {
  const delegate = options.delegate ?? "GPU";
  if (cachedLandmarker) {
    if (cachedFaceLandmarkerDelegate !== delegate) {
      throw landmarkerDelegateIdentityError("face");
    }
    return cachedLandmarker;
  }
  if (initPromise) {
    if (initPromiseGeneration === faceLandmarkerGeneration) {
      if (initPromiseDelegate !== delegate) {
        throw landmarkerDelegateIdentityError("face");
      }
      return initPromise;
    }
    try {
      await initPromise;
    } catch {
      // The disposed generation is expected to fail closed after its factory settles.
    }
    if (cachedLandmarker) {
      if (cachedFaceLandmarkerDelegate !== delegate) {
        throw landmarkerDelegateIdentityError("face");
      }
      return cachedLandmarker;
    }
    return initFaceLandmarker(options);
  }

  const generation = faceLandmarkerGeneration;
  const pending = (async () => {
    // Dynamic import — 번들 초기 로드를 줄이기 위해 런타임에만 불러온다.
    const { FilesetResolver, FaceLandmarker: FLM } =
      await loadStudioMediaPipeVisionModule();

    const { fileset: vision } = await resolveStudioMediaPipeVisionWasmFileset({
      isSimdSupported: () => FilesetResolver.isSimdSupported(false),
    });
    if (generation !== faceLandmarkerGeneration) throw liveLandmarkerDisposedError("face");

    // 신뢰도 0.5→0.6: 저품질 프레임의 랜드마크 튐 컷.
    // 0.7 이상은 재탐지 빈발로 fps 출렁임을 유발하므로 금지.
    const faceOptions = {
      runningMode: "VIDEO",
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      numFaces: 1,
      minFacePresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    } as const;
    const landmarker = await runStudioMediaPipeVisionTaskCreation({
      owner: "vrm-video-face",
      create: () => FLM.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate,
        },
        ...faceOptions,
      }),
    });

    if (generation !== faceLandmarkerGeneration) {
      safelyCloseLiveLandmarker(landmarker);
      throw liveLandmarkerDisposedError("face");
    }
    cachedLandmarker = landmarker;
    cachedFaceLandmarkerDelegate = delegate;
    return landmarker;
  })();
  initPromise = pending;
  initPromiseGeneration = generation;
  initPromiseDelegate = delegate;

  try {
    return await pending;
  } finally {
    if (initPromise === pending) {
      initPromise = null;
      initPromiseGeneration = null;
      initPromiseDelegate = null;
    }
  }
}

/** 캐시된 FaceLandmarker를 해제(메모리 반환). */
export function disposeFaceLandmarker(): void {
  faceLandmarkerGeneration += 1;
  const active = cachedLandmarker;
  cachedLandmarker = null;
  cachedFaceLandmarkerDelegate = null;
  if (active) safelyCloseLiveLandmarker(active);
}

let cachedPoseLandmarker: PoseLandmarker | null = null;
let cachedPoseLandmarkerDelegate: StudioMediaPipeVisionDelegate | null = null;
let initPosePromise: Promise<PoseLandmarker> | null = null;
let initPosePromiseGeneration: number | null = null;
let initPosePromiseDelegate: StudioMediaPipeVisionDelegate | null = null;
let livePoseLandmarkerGeneration = 0;

/**
 * MediaPipe PoseLandmarker를 lazy 초기화(싱글턴).
 */
export async function initPoseLandmarker(
  options: StudioVrmMediaPipeLandmarkerInitOptions = {},
): Promise<PoseLandmarker> {
  const delegate = options.delegate ?? "GPU";
  if (cachedPoseLandmarker) {
    if (cachedPoseLandmarkerDelegate !== delegate) {
      throw landmarkerDelegateIdentityError("pose");
    }
    return cachedPoseLandmarker;
  }
  if (initPosePromise) {
    if (initPosePromiseGeneration === livePoseLandmarkerGeneration) {
      if (initPosePromiseDelegate !== delegate) {
        throw landmarkerDelegateIdentityError("pose");
      }
      return initPosePromise;
    }
    try {
      await initPosePromise;
    } catch {
      // A disposed generation cannot be cancelled inside MediaPipe; wait for its settlement.
    }
    if (cachedPoseLandmarker) {
      if (cachedPoseLandmarkerDelegate !== delegate) {
        throw landmarkerDelegateIdentityError("pose");
      }
      return cachedPoseLandmarker;
    }
    return initPoseLandmarker(options);
  }

  const generation = livePoseLandmarkerGeneration;
  const pending = (async () => {
    const { FilesetResolver, PoseLandmarker: PLM } =
      await loadStudioMediaPipeVisionModule();
    const { fileset: vision } = await resolveStudioMediaPipeVisionWasmFileset({
      isSimdSupported: () => FilesetResolver.isSimdSupported(false),
    });
    if (generation !== livePoseLandmarkerGeneration) throw liveLandmarkerDisposedError("pose");

    const landmarker = await runStudioMediaPipeVisionTaskCreation({
      owner: "vrm-video-pose",
      create: () => PLM.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
          delegate,
        },
        runningMode: "VIDEO",
        outputSegmentationMasks: false,
      }),
    });

    if (generation !== livePoseLandmarkerGeneration) {
      safelyCloseLiveLandmarker(landmarker);
      throw liveLandmarkerDisposedError("pose");
    }
    cachedPoseLandmarker = landmarker;
    cachedPoseLandmarkerDelegate = delegate;
    return landmarker;
  })();
  initPosePromise = pending;
  initPosePromiseGeneration = generation;
  initPosePromiseDelegate = delegate;

  try {
    return await pending;
  } finally {
    if (initPosePromise === pending) {
      initPosePromise = null;
      initPosePromiseGeneration = null;
      initPosePromiseDelegate = null;
    }
  }
}

/** 캐시된 PoseLandmarker를 해제(메모리 반환). */
export function disposePoseLandmarker(): void {
  livePoseLandmarkerGeneration += 1;
  const active = cachedPoseLandmarker;
  cachedPoseLandmarker = null;
  cachedPoseLandmarkerDelegate = null;
  if (active) safelyCloseLiveLandmarker(active);
}

let cachedPhotoPoseLandmarker: PoseLandmarker | null = null;
let cachedPhotoPoseLandmarkerDelegate: StudioMediaPipeVisionDelegate | null = null;
let initPhotoPosePromise: Promise<PoseLandmarker> | null = null;
let initPhotoPosePromiseDelegate: StudioMediaPipeVisionDelegate | null = null;
let photoPoseLandmarkerGeneration = 0;

export type PhotoPoseLandmarkerFactory = (
  delegate?: StudioMediaPipeVisionDelegate,
) => Promise<PoseLandmarker>;

async function createPhotoPoseLandmarker(
  delegate: StudioMediaPipeVisionDelegate = "GPU",
): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker: PLM } =
    await loadStudioMediaPipeVisionModule();
  const { fileset: vision } = await resolveStudioMediaPipeVisionWasmFileset({
    isSimdSupported: () => FilesetResolver.isSimdSupported(false),
  });
  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
  const options = {
    runningMode: "IMAGE",
    outputSegmentationMasks: false,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
  } as const;
  return runStudioMediaPipeVisionTaskCreation({
    owner: "vrm-photo-pose",
    create: () => PLM.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      ...options,
    }),
  });
}

function photoPoseLandmarkerDisposedError(): Error {
  const error = new Error("Photo pose landmarker initialization was disposed.");
  error.name = "AbortError";
  return error;
}

/**
 * A separate IMAGE-mode task for still-photo scans. The live VIDEO singleton cannot safely switch
 * running modes while a webcam frame loop owns it, so the two workloads deliberately keep
 * independent MediaPipe task instances.
 */
export function initPhotoPoseLandmarker(
  options?: StudioVrmMediaPipeLandmarkerInitOptions,
): Promise<PoseLandmarker>;
export function initPhotoPoseLandmarker(
  factory: PhotoPoseLandmarkerFactory,
  options?: StudioVrmMediaPipeLandmarkerInitOptions,
): Promise<PoseLandmarker>;
export function initPhotoPoseLandmarker(
  factoryOrOptions: PhotoPoseLandmarkerFactory | StudioVrmMediaPipeLandmarkerInitOptions = {},
  maybeOptions: StudioVrmMediaPipeLandmarkerInitOptions = {},
): Promise<PoseLandmarker> {
  const factory = typeof factoryOrOptions === "function"
    ? factoryOrOptions
    : createPhotoPoseLandmarker;
  const options = typeof factoryOrOptions === "function"
    ? maybeOptions
    : factoryOrOptions;
  const delegate = options.delegate ?? "GPU";
  if (cachedPhotoPoseLandmarker) {
    if (cachedPhotoPoseLandmarkerDelegate !== delegate) {
      return Promise.reject(landmarkerDelegateIdentityError("photo-pose"));
    }
    return Promise.resolve(cachedPhotoPoseLandmarker);
  }
  if (initPhotoPosePromise) {
    if (initPhotoPosePromiseDelegate !== delegate) {
      return Promise.reject(landmarkerDelegateIdentityError("photo-pose"));
    }
    return initPhotoPosePromise;
  }

  const generation = photoPoseLandmarkerGeneration;
  const pending: Promise<PoseLandmarker> = Promise.resolve()
    .then(() => factory(delegate))
    .then(
      (landmarker) => {
        if (
          generation !== photoPoseLandmarkerGeneration
          || initPhotoPosePromise !== pending
        ) {
          try {
            landmarker.close();
          } catch {
            // A disposed initialization must never resurrect its cache, even if close fails.
          }
          throw photoPoseLandmarkerDisposedError();
        }
        cachedPhotoPoseLandmarker = landmarker;
        cachedPhotoPoseLandmarkerDelegate = delegate;
        initPhotoPosePromise = null;
        initPhotoPosePromiseDelegate = null;
        return landmarker;
      },
      (error: unknown) => {
        if (initPhotoPosePromise === pending) {
          initPhotoPosePromise = null;
          initPhotoPosePromiseDelegate = null;
        }
        throw error;
      },
    );
  initPhotoPosePromise = pending;
  initPhotoPosePromiseDelegate = delegate;
  return pending;
}

export function disposePhotoPoseLandmarker(): void {
  photoPoseLandmarkerGeneration += 1;
  const active = cachedPhotoPoseLandmarker;
  cachedPhotoPoseLandmarker = null;
  cachedPhotoPoseLandmarkerDelegate = null;
  initPhotoPosePromise = null;
  initPhotoPosePromiseDelegate = null;
  try {
    active?.close();
  } catch {
    // Disposal is best-effort and must not break the scanner unmount path.
  }
}

let cachedPhotoHandLandmarker: HandLandmarker | null = null;
let cachedPhotoHandLandmarkerDelegate: StudioMediaPipeVisionDelegate | null = null;
let initPhotoHandPromise: Promise<HandLandmarker> | null = null;
let initPhotoHandPromiseDelegate: StudioMediaPipeVisionDelegate | null = null;
let photoHandLandmarkerGeneration = 0;

export type PhotoHandLandmarkerFactory = (
  delegate?: StudioMediaPipeVisionDelegate,
) => Promise<HandLandmarker>;

async function createPhotoHandLandmarker(
  delegate: StudioMediaPipeVisionDelegate = "GPU",
): Promise<HandLandmarker> {
  const { FilesetResolver, HandLandmarker: HLM } =
    await loadStudioMediaPipeVisionModule();
  const { fileset: vision } = await resolveStudioMediaPipeVisionWasmFileset({
    isSimdSupported: () => FilesetResolver.isSimdSupported(false),
  });
  const modelAssetPath =
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
  const options = {
    runningMode: "IMAGE",
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  } as const;
  return runStudioMediaPipeVisionTaskCreation({
    owner: "vrm-photo-hand",
    create: () => HLM.createFromOptions(vision, {
      baseOptions: { modelAssetPath, delegate },
      ...options,
    }),
  });
}

function photoHandLandmarkerDisposedError(): Error {
  const error = new Error("Photo hand landmarker initialization was disposed.");
  error.name = "AbortError";
  return error;
}

/**
 * Still photos own a dedicated IMAGE-mode task. Reusing the live VIDEO singleton would let a
 * photo scan change task mode while the webcam frame loop is still reading it.
 */
export function initPhotoHandLandmarker(
  options?: StudioVrmMediaPipeLandmarkerInitOptions,
): Promise<HandLandmarker>;
export function initPhotoHandLandmarker(
  factory: PhotoHandLandmarkerFactory,
  options?: StudioVrmMediaPipeLandmarkerInitOptions,
): Promise<HandLandmarker>;
export function initPhotoHandLandmarker(
  factoryOrOptions: PhotoHandLandmarkerFactory | StudioVrmMediaPipeLandmarkerInitOptions = {},
  maybeOptions: StudioVrmMediaPipeLandmarkerInitOptions = {},
): Promise<HandLandmarker> {
  const factory = typeof factoryOrOptions === "function"
    ? factoryOrOptions
    : createPhotoHandLandmarker;
  const options = typeof factoryOrOptions === "function"
    ? maybeOptions
    : factoryOrOptions;
  const delegate = options.delegate ?? "GPU";
  if (cachedPhotoHandLandmarker) {
    if (cachedPhotoHandLandmarkerDelegate !== delegate) {
      return Promise.reject(landmarkerDelegateIdentityError("photo-hand"));
    }
    return Promise.resolve(cachedPhotoHandLandmarker);
  }
  if (initPhotoHandPromise) {
    if (initPhotoHandPromiseDelegate !== delegate) {
      return Promise.reject(landmarkerDelegateIdentityError("photo-hand"));
    }
    return initPhotoHandPromise;
  }

  const generation = photoHandLandmarkerGeneration;
  const pending: Promise<HandLandmarker> = Promise.resolve()
    .then(() => factory(delegate))
    .then(
      (landmarker) => {
        if (
          generation !== photoHandLandmarkerGeneration
          || initPhotoHandPromise !== pending
        ) {
          try {
            landmarker.close();
          } catch {
            // A stale initialization cannot reclaim cache ownership even when close fails.
          }
          throw photoHandLandmarkerDisposedError();
        }
        cachedPhotoHandLandmarker = landmarker;
        cachedPhotoHandLandmarkerDelegate = delegate;
        initPhotoHandPromise = null;
        initPhotoHandPromiseDelegate = null;
        return landmarker;
      },
      (error: unknown) => {
        if (initPhotoHandPromise === pending) {
          initPhotoHandPromise = null;
          initPhotoHandPromiseDelegate = null;
        }
        throw error;
      },
    );
  initPhotoHandPromise = pending;
  initPhotoHandPromiseDelegate = delegate;
  return pending;
}

export function disposePhotoHandLandmarker(): void {
  photoHandLandmarkerGeneration += 1;
  const active = cachedPhotoHandLandmarker;
  cachedPhotoHandLandmarker = null;
  cachedPhotoHandLandmarkerDelegate = null;
  initPhotoHandPromise = null;
  initPhotoHandPromiseDelegate = null;
  try {
    active?.close();
  } catch {
    // Scanner unmount/disposal is best-effort and must remain idempotent.
  }
}

let cachedHandLandmarker: HandLandmarker | null = null;
let cachedHandLandmarkerDelegate: StudioMediaPipeVisionDelegate | null = null;
let initHandPromise: Promise<HandLandmarker> | null = null;
let initHandPromiseGeneration: number | null = null;
let initHandPromiseDelegate: StudioMediaPipeVisionDelegate | null = null;
let liveHandLandmarkerGeneration = 0;

/** MediaPipe HandLandmarker를 lazy 초기화(싱글턴, 양손). */
export async function initHandLandmarker(
  options: StudioVrmMediaPipeLandmarkerInitOptions = {},
): Promise<HandLandmarker> {
  const delegate = options.delegate ?? "GPU";
  if (cachedHandLandmarker) {
    if (cachedHandLandmarkerDelegate !== delegate) {
      throw landmarkerDelegateIdentityError("hand");
    }
    return cachedHandLandmarker;
  }
  if (initHandPromise) {
    if (initHandPromiseGeneration === liveHandLandmarkerGeneration) {
      if (initHandPromiseDelegate !== delegate) {
        throw landmarkerDelegateIdentityError("hand");
      }
      return initHandPromise;
    }
    try {
      await initHandPromise;
    } catch {
      // The stale task keeps global init authority until MediaPipe settles it.
    }
    if (cachedHandLandmarker) {
      if (cachedHandLandmarkerDelegate !== delegate) {
        throw landmarkerDelegateIdentityError("hand");
      }
      return cachedHandLandmarker;
    }
    return initHandLandmarker(options);
  }

  const generation = liveHandLandmarkerGeneration;
  const pending = (async () => {
    const { FilesetResolver, HandLandmarker: HLM } =
      await loadStudioMediaPipeVisionModule();
    const { fileset: vision } = await resolveStudioMediaPipeVisionWasmFileset({
      isSimdSupported: () => FilesetResolver.isSimdSupported(false),
    });
    if (generation !== liveHandLandmarkerGeneration) throw liveLandmarkerDisposedError("hand");
    const model =
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

    const landmarker = await runStudioMediaPipeVisionTaskCreation({
      owner: "vrm-video-hand",
      create: () => HLM.createFromOptions(vision, {
        baseOptions: { modelAssetPath: model, delegate },
        runningMode: "VIDEO",
        numHands: 2,
      }),
    });

    if (generation !== liveHandLandmarkerGeneration) {
      safelyCloseLiveLandmarker(landmarker);
      throw liveLandmarkerDisposedError("hand");
    }
    cachedHandLandmarker = landmarker;
    cachedHandLandmarkerDelegate = delegate;
    return landmarker;
  })();
  initHandPromise = pending;
  initHandPromiseGeneration = generation;
  initHandPromiseDelegate = delegate;

  try {
    return await pending;
  } finally {
    if (initHandPromise === pending) {
      initHandPromise = null;
      initHandPromiseGeneration = null;
      initHandPromiseDelegate = null;
    }
  }
}

/** 캐시된 HandLandmarker를 해제(메모리 반환). */
export function disposeHandLandmarker(): void {
  liveHandLandmarkerGeneration += 1;
  const active = cachedHandLandmarker;
  cachedHandLandmarker = null;
  cachedHandLandmarkerDelegate = null;
  if (active) safelyCloseLiveLandmarker(active);
}

/**
 * 비디오 준비 직후 1회 호출 — 첫 실제 프레임에서 발생하는 셰이더 컴파일/
 * 그래프 빌드 지연(수백 ms 스톨)을 트래킹 시작 전에 흡수한다.
 * 초기화된 랜드마커에 detectForVideo 를 1회씩 호출하고 결과는 버린다.
 */
export function warmupLandmarkers(video: HTMLVideoElement, timestamp: number): void {
  try {
    cachedLandmarker?.detectForVideo(video, timestamp);
  } catch (err) {
    console.warn("FaceLandmarker warmup failed (무시):", err);
  }
  try {
    cachedPoseLandmarker?.detectForVideo(video, timestamp);
  } catch (err) {
    console.warn("PoseLandmarker warmup failed (무시):", err);
  }
  try {
    cachedHandLandmarker?.detectForVideo(video, timestamp);
  } catch (err) {
    console.warn("HandLandmarker warmup failed (무시):", err);
  }
}

/* ── Blendshape extraction helpers ────────────────────────────────────── */

type BlendshapeMap = Map<string, number>;

/**
 * FaceLandmarkerResult.faceBlendshapes[0].categories → Map<이름, 점수>로 변환.
 * 없으면 null 반환.
 */
function buildBlendshapeMap(
  result: FaceLandmarkerResult,
): BlendshapeMap | null {
  const shapes = result.faceBlendshapes;
  if (!shapes || shapes.length === 0) return null;

  const categories = shapes[0].categories;
  if (!categories || categories.length === 0) return null;

  const map: BlendshapeMap = new Map();
  for (const cat of categories) {
    map.set(cat.categoryName, cat.score);
  }
  return map;
}

function bs(map: BlendshapeMap, name: string): number {
  return map.get(name) ?? 0;
}

/* ── Head rotation from 4×4 transformation matrix ─────────────────────── */

/**
 * 4×4 열-우선(column-major) 또는 행-우선(row-major) 변환 행렬에서
 * Euler 각(pitch, yaw, roll)을 추출한다.
 *
 * MediaPipe FacialTransformationMatrix는 행-우선 4×4 flat array로 주어지며,
 * 회전 부분(상위 3×3)의 row-major 레이아웃:
 *   m[0] m[1] m[2]   R00 R01 R02
 *   m[4] m[5] m[6]   R10 R11 R12
 *   m[8] m[9] m[10]  R20 R21 R22
 *
 * Euler 분해(XYZ intrinsic = ZYX extrinsic):
 *   pitch = atan2(-R21, R22) = atan2(-m[9], m[10])
 *   yaw   = asin(R20)       = asin(m[8])
 *   roll  = atan2(-R10, R00) = atan2(-m[4], m[0])
 */
function eulerFromMatrix(m: ArrayLike<number>): readonly [number, number, number] {
  // Clamp asin argument to [-1, 1] for numerical safety
  const sinYaw = Math.max(-1, Math.min(1, m[8]));
  const yaw = Math.asin(sinYaw);

  const cosYaw = Math.cos(yaw);

  let pitch: number;
  let roll: number;

  if (Math.abs(cosYaw) > 1e-6) {
    pitch = Math.atan2(-m[9], m[10]);
    roll = Math.atan2(-m[4], m[0]);
  } else {
    // Gimbal lock 근처 — yaw ≈ ±90°
    pitch = Math.atan2(m[6], m[5]);
    roll = 0;
  }

  return [pitch, yaw, roll] as const;
}

/* ── processTrackingResult ────────────────────────────────────────────── */

/**
 * FaceLandmarkerResult에서 TrackingChannels를 추출한다.
 * 얼굴이 감지되지 않으면 null.
 */
export function processTrackingResult(
  result: FaceLandmarkerResult,
): TrackingChannels | null {
  const bsMap = buildBlendshapeMap(result);
  if (!bsMap) return null;

  // — Head rotation from transformation matrix —
  let headPitch = 0;
  let headYaw = 0;
  let headRoll = 0;

  const matrices = result.facialTransformationMatrixes;
  if (matrices && matrices.length > 0) {
    const matrixData = matrices[0].data;
    if (matrixData && matrixData.length >= 12) {
      [headPitch, headYaw, headRoll] = eulerFromMatrix(matrixData);
    }
  }

  // — Eye blink —
  const blinkLeft = bs(bsMap, BS.eyeBlinkLeft);
  const blinkRight = bs(bsMap, BS.eyeBlinkRight);

  // — Mouth —
  const mouthOpen = bs(bsMap, BS.jawOpen);
  const smileL = bs(bsMap, BS.mouthSmileLeft);
  const smileR = bs(bsMap, BS.mouthSmileRight);
  const mouthSmile = (smileL + smileR) * 0.5;

  // — Brow —
  const browInnerUp = bs(bsMap, BS.browInnerUp);
  const browOuterUpLeft = bs(bsMap, BS.browOuterUpLeft);
  const browOuterUpRight = bs(bsMap, BS.browOuterUpRight);

  // — Emotion blendshapes (양쪽 평균) —
  const browDown = (bs(bsMap, BS.browDownLeft) + bs(bsMap, BS.browDownRight)) * 0.5;
  const mouthFrown = (bs(bsMap, BS.mouthFrownLeft) + bs(bsMap, BS.mouthFrownRight)) * 0.5;
  const eyeWide = (bs(bsMap, BS.eyeWideLeft) + bs(bsMap, BS.eyeWideRight)) * 0.5;

  // — Gaze —
  // gazeX: positive = looking right from camera's perspective
  // eyeLookInLeft = left eye looking inward (toward nose) = looking right
  // eyeLookOutLeft = left eye looking outward = looking left
  // Average both eyes for stability.
  const lookInL = bs(bsMap, BS.eyeLookInLeft);
  const lookOutL = bs(bsMap, BS.eyeLookOutLeft);
  const lookInR = bs(bsMap, BS.eyeLookInRight);
  const lookOutR = bs(bsMap, BS.eyeLookOutRight);
  // In = toward nose, Out = away from nose
  // Left eye: In → right, Out → left  |  Right eye: In → left, Out → right
  const gazeXLeft = lookInL - lookOutL;    // positive = looking right
  const gazeXRight = lookOutR - lookInR;   // positive = looking right
  const gazeX = clamp01Signed((gazeXLeft + gazeXRight) * 0.5);

  const lookUpL = bs(bsMap, BS.eyeLookUpLeft);
  const lookDownL = bs(bsMap, BS.eyeLookDownLeft);
  const lookUpR = bs(bsMap, BS.eyeLookUpRight);
  const lookDownR = bs(bsMap, BS.eyeLookDownRight);
  const gazeYLeft = lookUpL - lookDownL;   // positive = looking up
  const gazeYRight = lookUpR - lookDownR;  // positive = looking up
  const gazeY = clamp01Signed((gazeYLeft + gazeYRight) * 0.5);

  return {
    headPitch,
    headYaw,
    headRoll,
    blinkLeft,
    blinkRight,
    gazeX,
    gazeY,
    mouthOpen,
    mouthSmile,
    browInnerUp,
    browOuterUpLeft,
    browOuterUpRight,
    browDown,
    mouthFrown,
    eyeWide,
  };
}

/* ── Smoothing ────────────────────────────────────────────────────────── */

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * 이전 채널 → 다음 채널을 EMA(지수이동평균)로 보간한다.
 * prev가 null이면(첫 프레임) next를 그대로 반환한다.
 *
 * @param alpha 0 < alpha ≤ 1. 작을수록 부드럽고 지연이 크며, 1이면 즉시 반영.
 * @deprecated 고정 α EMA 는 프레임레이트 종속 — 신규 코드는 createChannelSmoother()
 *   (One-Euro 필터뱅크, 시간 기반 컷오프)를 사용할 것.
 */
export function smoothRawChannels(
  prev: TrackingChannels | null,
  next: TrackingChannels,
  alpha: number,
): TrackingChannels {
  if (!prev) return { ...next };

  const a = Math.max(0, Math.min(1, alpha));

  return {
    headPitch: lerp(prev.headPitch, next.headPitch, a),
    headYaw: lerp(prev.headYaw, next.headYaw, a),
    headRoll: lerp(prev.headRoll, next.headRoll, a),
    blinkLeft: lerp(prev.blinkLeft, next.blinkLeft, a),
    blinkRight: lerp(prev.blinkRight, next.blinkRight, a),
    gazeX: lerp(prev.gazeX, next.gazeX, a),
    gazeY: lerp(prev.gazeY, next.gazeY, a),
    mouthOpen: lerp(prev.mouthOpen, next.mouthOpen, a),
    mouthSmile: lerp(prev.mouthSmile, next.mouthSmile, a),
    browInnerUp: lerp(prev.browInnerUp, next.browInnerUp, a),
    browOuterUpLeft: lerp(prev.browOuterUpLeft, next.browOuterUpLeft, a),
    browOuterUpRight: lerp(prev.browOuterUpRight, next.browOuterUpRight, a),
    browDown: lerp(prev.browDown, next.browDown, a),
    mouthFrown: lerp(prev.mouthFrown, next.mouthFrown, a),
    eyeWide: lerp(prev.eyeWide, next.eyeWide, a),
  };
}

/** 프레임 간 상태를 보관하는 채널 스무더 인터페이스. */
export interface ChannelSmoother {
  /**
   * @param tSec 초 단위 실제 시간(performance.now()/1000) — 프레임 인덱스 금지
   *   (가변 fps 에서 컷오프가 왜곡된다).
   * @param smoothing 사용자 슬라이더 값(0.05~1, 기존 TrackingOptions.smoothing 재사용).
   */
  smooth(channels: TrackingChannels, tSec: number, smoothing: number): TrackingChannels;
  reset(): void;
}

/**
 * One-Euro 필터뱅크 기반 채널 스무더 팩토리.
 * useRef 에 보관하고 세션 시작/캘리브레이션 완료 시 reset 한다.
 */
export function createChannelSmoother(): ChannelSmoother {
  const bank = new TrackingChannelFilterBank();
  return {
    smooth: (channels, tSec, smoothing) => bank.filter(channels, tSec, smoothing),
    reset: () => bank.reset(),
  };
}

/* ── Convert channels → VRM data ──────────────────────────────────────── */

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function clamp01Signed(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

// VRMLookAt.yaw/pitch 는 "도(degree)" 단위다(라디안 아님!) — 시선 가동 범위 상한.
export const GAZE_YAW_MAX_DEG = 20;
export const GAZE_PITCH_MAX_DEG = 12;

/**
 * TrackingChannels를 VRM 뼈 회전 + 표정 가중치로 변환한다.
 *
 * 뼈(bones):
 *   - "head"  → [pitch, yaw, roll]   (sensitivity 반영)
 *   - "neck"  → head 회전의 30% 분담 (자연스러운 목 연동)
 *
 * 표정(expressions): VRM 1.0 표준 이름
 *   - blinkLeft, blinkRight, aa(입 벌림), happy(미소),
 *     lookUp/lookDown/lookLeft/lookRight(시선),
 *     browInnerUp, browOuterUpLeft, browOuterUpRight
 *
 * options.gazeLock → 시선 채널을 0으로 고정.
 * options.mirrorMode → yaw, roll, gazeX, 좌우 눈 채널을 반전.
 */
export function convertChannelsToVrmData(
  channels: TrackingChannels,
  options: TrackingOptions,
): VrmTrackingData {
  const { gazeLock, mirrorMode, sensitivity } = options;
  const s = Math.max(0, sensitivity);

  // — Mirror handling —
  const mirrorSign = mirrorMode ? -1 : 1;

  const pitch = channels.headPitch * s;
  const yaw = channels.headYaw * s * mirrorSign;
  const roll = channels.headRoll * s * mirrorSign;

  // Neck takes 30% of the head rotation for a natural look
  const NECK_SHARE = 0.3;
  const HEAD_SHARE = 1 - NECK_SHARE;

  // 본은 three.js 기본 XYZ Euler 로 적용된다: rot[0]=X(끄덕임/pitch), rot[1]=Y(yaw), rot[2]=Z(roll).
  // eulerFromMatrix 는 항공식(ZYX) 분해라 두 규약은 작은 머리 각도에서만 근사 일치한다(실사용 OK).
  // 미러(거울) 규약은 [pitch, -yaw, -roll] = [x,-y,-z] 로, 바디 솔버·수동 포즈 미러와 동일하다.
  const bones: Record<string, readonly [number, number, number]> = {
    head: [pitch * HEAD_SHARE, yaw * HEAD_SHARE, roll * HEAD_SHARE] as const,
    neck: [pitch * NECK_SHARE, yaw * NECK_SHARE, roll * NECK_SHARE] as const,
  };

  // — Blinks (mirror swaps left/right) —
  const blinkL = mirrorMode ? channels.blinkRight : channels.blinkLeft;
  const blinkR = mirrorMode ? channels.blinkLeft : channels.blinkRight;

  // — Gaze —
  let gazeX = gazeLock ? 0 : channels.gazeX * s * mirrorSign;
  let gazeY = gazeLock ? 0 : channels.gazeY * s;
  gazeX = clamp01Signed(gazeX);
  gazeY = clamp01Signed(gazeY);

  // VRM uses lookLeft/lookRight/lookUp/lookDown (all 0-1)
  // — lookAt 이 없는 모델의 폴백으로 유지한다(적용 우선순위는 VrmActor 가 결정).
  const lookLeft = clamp01(gazeX < 0 ? -gazeX : 0);
  const lookRight = clamp01(gazeX > 0 ? gazeX : 0);
  const lookUp = clamp01(gazeY > 0 ? gazeY : 0);
  const lookDown = clamp01(gazeY < 0 ? -gazeY : 0);

  // VRM lookAt 직접 구동용 — gazeX/gazeY 는 이미 mirror·gazeLock 반영된 값.
  const lookAt = {
    yawDeg: gazeX * GAZE_YAW_MAX_DEG,
    pitchDeg: gazeY * GAZE_PITCH_MAX_DEG,
  };

  // — Brows (mirror swaps outer left/right) —
  const browOuterL = mirrorMode
    ? channels.browOuterUpRight
    : channels.browOuterUpLeft;
  const browOuterR = mirrorMode
    ? channels.browOuterUpLeft
    : channels.browOuterUpRight;

  // — Mouth —
  const mouthOpen = clamp01(channels.mouthOpen * s);
  const mouthSmile = clamp01(channels.mouthSmile * s);

  const expressions: Record<string, number> = {
    blinkLeft: clamp01(blinkL),
    blinkRight: clamp01(blinkR),
    aa: mouthOpen,
    happy: mouthSmile,
    lookUp,
    lookDown,
    lookLeft,
    lookRight,
    browInnerUp: clamp01(channels.browInnerUp * s),
    browOuterUpLeft: clamp01(browOuterL * s),
    browOuterUpRight: clamp01(browOuterR * s),
    // VRM 1.0 표준 감정 표현 — 눈 크게 뜸/눈썹 찡그림/입꼬리 내림에서 유도.
    surprised: clamp01((channels.eyeWide * 0.85 + channels.browInnerUp * 0.25) * s),
    angry: clamp01(channels.browDown * 0.95 * s),
    sad: clamp01((channels.mouthFrown * 0.7 + channels.browInnerUp * 0.3) * s),
  };

  // 감정·입 표정은 서로 겹치는 모프를 건드린다. 유도식은 채널마다 독립이므로 여기서 한 번
  // 조정하지 않으면 한 프레임에 여러 감정이 함께 켜져 얼굴이 상쇄·왜곡된다.
  const resolved =
    options.resolveExpressionConflicts === false
      ? expressions
      : resolveStudioVrmExpressionConflicts(expressions, {
          available: options.availableExpressions,
        }).weights;

  return { bones, expressions: resolved, lookAt };
}

/**
 * PoseLandmarkerResult에서 팔/다리/발의 **부모상대** 본 회전(Euler)을 추출한다.
 * 실제 계산은 studio-vrm-pose-solver 에 위임한다(부모상대 회전으로 팔꿈치/무릎 이중회전
 * 버그 수정 + 단일 카메라 z 감쇠 + 가시성 게이팅). 호출부 계약(본 이름→[x,y,z])은 동일.
 */
export function processPoseResult(
  result: PoseLandmarkerResult,
  mirrorMode = true
): Record<string, readonly [number, number, number]> {
  const landmarks = result?.worldLandmarks?.[0];
  return solvePoseToVrmBones(landmarks, { mirror: mirrorMode });
}
