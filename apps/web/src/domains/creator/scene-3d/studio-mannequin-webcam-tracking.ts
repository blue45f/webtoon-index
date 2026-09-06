/**
 * Studio 3D 데생 인형 전용 실시간 웹캠 동적 동작 추적(Webcam Motion Tracking) 모듈.
 *
 * MediaPipe Vision PoseLandmarker (VIDEO 모드)를 구동하여 웹캠 비디오 프레임에서
 * 신체 33개 관절 랜드마크를 실시간 감지하고, 스무딩 필터(EMA/OneEuro)를 거쳐
 * 3D 데생 인형(StudioMannequinJointId) 관절 회전(Euler radians)으로 전사한다.
 */

import {
  resolveStudioMediaPipeVisionWasmFileset,
  type StudioMediaPipeVisionDelegate,
  type StudioMediaPipeVisionWasmSelection,
} from "../studio-mediapipe-vision-assets";
import {
  loadStudioMediaPipeVisionModule,
  runStudioMediaPipeVisionTaskCreation,
} from "../studio-mediapipe-vision-init-arbiter";
import { solvePoseToVrmBones, type PoseLandmark } from "../vrm/studio-vrm-pose-solver";

import type { StudioMannequinJointId } from "./studio-mannequin-model";

export type { PoseLandmark };

export interface StudioMannequinTrackingOptions {
  /** 좌우 반전(거울 모드). 기본값 true. */
  readonly mirrorMode?: boolean;
  /** 깊이(Z축) 노이즈 감쇠 (0.1~1.0). 기본값 0.85. */
  readonly zDamp?: number;
  /** 스무딩 계수 (0.05=매우 부드러움, 1.0=즉각 반응). 기본값 0.35. */
  readonly smoothing?: number;
  /** 가시성 미만 절단 기준. 기본값 0.2. */
  readonly minVisibility?: number;
}

export const DEFAULT_MANNEQUIN_TRACKING_OPTIONS: Readonly<StudioMannequinTrackingOptions> = {
  mirrorMode: true,
  zDamp: 0.85,
  smoothing: 0.35,
  minVisibility: 0.2,
};

/**
 * MediaPipe pose model is fetched explicitly so model download failures can be distinguished from
 * same-origin Wasm loader failures. The host is allowed by the production CSP and the response is
 * passed to MediaPipe as `modelAssetBuffer` (the task does not perform a second opaque fetch).
 */
export const STUDIO_MANNEQUIN_POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

const STUDIO_MANNEQUIN_POSE_MODEL_TIMEOUT_MS = 20_000;
export const STUDIO_MANNEQUIN_CAMERA_REQUEST_TIMEOUT_MS = 30_000;

export interface StudioMannequinPoseDetection {
  readonly landmarks?: readonly (readonly PoseLandmark[])[];
  readonly close?: () => void;
}

/** Minimal runtime boundary used by the panel and by lifecycle tests. */
export interface StudioMannequinPoseLandmarker {
  detectForVideo(video: HTMLVideoElement, timestamp: number): StudioMannequinPoseDetection;
  close(): void;
}

export type StudioMannequinPoseLandmarkerFactory = (
  signal?: AbortSignal,
  delegate?: StudioMediaPipeVisionDelegate,
) => Promise<StudioMannequinPoseLandmarker>;

export interface StudioMannequinPoseLandmarkerInitOptions {
  readonly signal?: AbortSignal;
  /** Fixed before model/task work. Omission selects the product-default GPU provider. */
  readonly delegate?: StudioMediaPipeVisionDelegate;
  /** Test/host injection. Production callers should leave this unset. */
  readonly factory?: StudioMannequinPoseLandmarkerFactory;
}

export interface StudioMannequinCameraRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export type StudioMannequinWebcamErrorStage = "camera" | "engine" | "tracking";

function createNamedError(name: string, message: string, cause?: unknown): Error {
  const error = new Error(message);
  error.name = name;
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

function createDisposedError(): Error {
  return createNamedError(
    "AbortError",
    "Studio mannequin pose landmarker initialization was cancelled.",
  );
}

function safelyClosePoseLandmarker(landmarker: StudioMannequinPoseLandmarker): void {
  try {
    landmarker.close();
  } catch {
    // Cleanup is best-effort. A MediaPipe close failure must never leave the camera stream running.
  }
}

export function stopStudioMannequinMediaStream(stream: MediaStream): void {
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // One faulty track must not prevent the remaining camera tracks from stopping.
      }
    });
  } catch {
    // A partially constructed browser stream can fail while enumerating tracks.
  }
}

function readErrorName(cause: unknown): string {
  if (!cause || typeof cause !== "object" || !("name" in cause)) return "";
  return String((cause as { name?: unknown }).name ?? "");
}

/** Cancellation is intentionally silent in the panel; it is caused by stop/close/unmount. */
export function isStudioMannequinWebcamAbortError(cause: unknown): boolean {
  return readErrorName(cause) === "AbortError";
}

/**
 * Converts browser/MediaPipe failures into short, actionable Korean guidance without leaking raw
 * URLs or implementation details into the interface. The original error is still logged by the
 * panel for diagnostics.
 */
export function getStudioMannequinWebcamErrorMessage(
  stage: StudioMannequinWebcamErrorStage,
  cause: unknown,
): string {
  const name = readErrorName(cause);

  if (stage === "camera") {
    if (name === "StudioMannequinInsecureContextError") {
      return "웹캠은 보안 연결(HTTPS) 또는 localhost에서만 사용할 수 있습니다.";
    }
    if (name === "StudioMannequinCameraUnavailableError") {
      return "이 브라우저에서는 웹캠을 사용할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.";
    }
    if (name === "StudioMannequinCameraPermissionTimeoutError") {
      return "동작 인식 엔진은 준비됐지만 카메라 권한 응답이 없습니다. 주소창의 카메라 권한을 확인한 뒤 다시 시도해 주세요.";
    }
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
      return "카메라 권한이 차단되었습니다. 브라우저 주소창의 카메라 권한을 허용한 뒤 다시 시도해 주세요.";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "사용할 수 있는 카메라를 찾지 못했습니다. 카메라 연결 상태를 확인해 주세요.";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "다른 앱이 카메라를 사용 중입니다. 해당 앱을 닫고 다시 시도해 주세요.";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "현재 카메라가 요청한 촬영 설정을 지원하지 않습니다. 다른 카메라로 다시 시도해 주세요.";
    }
    return "웹캠을 시작하지 못했습니다. 카메라 연결과 브라우저 권한을 확인해 주세요.";
  }

  if (stage === "tracking") {
    return "영상에서 동작을 분석하는 중 오류가 발생했습니다. 웹캠을 다시 시작해 주세요.";
  }

  if (name === "StudioMannequinPoseModelTimeoutError") {
    return "동작 인식 모델을 불러오는 데 시간이 오래 걸렸습니다. 네트워크를 확인하고 다시 시도해 주세요.";
  }
  if (name === "StudioMannequinPoseModelLoadError") {
    return "동작 인식 모델을 불러오지 못했습니다. 네트워크 연결을 확인하고 다시 시도해 주세요.";
  }
  if (name === "StudioMannequinVisionWasmLoadError") {
    return "브라우저가 동작 인식 엔진 파일을 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.";
  }
  if (name === "StudioMannequinPoseEngineCreationError") {
    return "선택한 동작 인식 엔진을 준비하지 못했습니다. 다른 탭을 닫고 페이지를 새로고침한 뒤 다시 시도해 주세요.";
  }
  return "실시간 동작 인식 엔진을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/**
 * Bounds the browser permission wait and releases a stream that arrives after timeout/cancel.
 * `getUserMedia()` itself has no AbortSignal, so the late-result cleanup is required to avoid
 * leaving a camera indicator or hardware device active after the panel has already stopped.
 */
export async function requestStudioMannequinCameraStream(
  requestStream: () => Promise<MediaStream>,
  options: StudioMannequinCameraRequestOptions = {},
): Promise<MediaStream> {
  if (options.signal?.aborted) throw createDisposedError();

  const requestedTimeoutMs = options.timeoutMs ?? STUDIO_MANNEQUIN_CAMERA_REQUEST_TIMEOUT_MS;
  const timeoutMs = Number.isFinite(requestedTimeoutMs)
    ? Math.max(1, requestedTimeoutMs)
    : STUDIO_MANNEQUIN_CAMERA_REQUEST_TIMEOUT_MS;
  let accepted = false;
  let settled = false;
  let resolvedStream: MediaStream | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let handleAbort: (() => void) | null = null;

  const streamPromise = Promise.resolve().then(requestStream);

  void streamPromise.then(
    (stream) => {
      resolvedStream = stream;
      if (settled && !accepted) stopStudioMannequinMediaStream(stream);
    },
    () => undefined,
  );

  const guardPromise = new Promise<never>((_resolve, reject) => {
    handleAbort = () => reject(createDisposedError());
    options.signal?.addEventListener("abort", handleAbort, { once: true });
    timeoutId = globalThis.setTimeout(() => {
      reject(
        createNamedError(
          "StudioMannequinCameraPermissionTimeoutError",
          "Timed out while waiting for the browser camera permission response.",
        ),
      );
    }, timeoutMs);
  });

  try {
    const stream = await Promise.race([streamPromise, guardPromise]);
    resolvedStream = stream;
    if (options.signal?.aborted) {
      stopStudioMannequinMediaStream(stream);
      resolvedStream = null;
      throw createDisposedError();
    }
    accepted = true;
    return stream;
  } finally {
    settled = true;
    if (!accepted && resolvedStream) stopStudioMannequinMediaStream(resolvedStream);
    if (timeoutId !== null) globalThis.clearTimeout(timeoutId);
    if (handleAbort) options.signal?.removeEventListener("abort", handleAbort);
  }
}

async function resolveLocalVisionWasmFileset(
  isSimdSupported: () => Promise<boolean>,
): Promise<StudioMediaPipeVisionWasmSelection> {
  try {
    return await resolveStudioMediaPipeVisionWasmFileset({ isSimdSupported });
  } catch (cause) {
    throw createNamedError(
      "StudioMannequinVisionWasmLoadError",
      "Failed to resolve the local MediaPipe Vision Wasm fileset.",
      cause,
    );
  }
}

async function fetchPoseModelBuffer(signal?: AbortSignal): Promise<Uint8Array> {
  const requestController = new AbortController();
  let timedOut = false;
  const handleParentAbort = () => requestController.abort(signal?.reason);
  if (signal?.aborted) handleParentAbort();
  else signal?.addEventListener("abort", handleParentAbort, { once: true });

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, STUDIO_MANNEQUIN_POSE_MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(STUDIO_MANNEQUIN_POSE_MODEL_URL, {
      cache: "force-cache",
      signal: requestController.signal,
    });
    if (!response.ok) {
      throw new Error(`Pose model request returned HTTP ${response.status}.`);
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    if (signal?.aborted) throw createDisposedError();
    if (timedOut) {
      throw createNamedError(
        "StudioMannequinPoseModelTimeoutError",
        "Timed out while downloading the mannequin pose model.",
        cause,
      );
    }
    throw createNamedError(
      "StudioMannequinPoseModelLoadError",
      "Failed to download the mannequin pose model.",
      cause,
    );
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleParentAbort);
  }
}

async function createStudioMannequinPoseLandmarker(
  signal?: AbortSignal,
  delegate: StudioMediaPipeVisionDelegate = "GPU",
): Promise<StudioMannequinPoseLandmarker> {
  if (signal?.aborted) throw createDisposedError();

  const { FilesetResolver, PoseLandmarker } = await loadStudioMediaPipeVisionModule();
  const [visionSelection, modelAssetBuffer] = await Promise.all([
    resolveLocalVisionWasmFileset(() => FilesetResolver.isSimdSupported(false)),
    fetchPoseModelBuffer(signal),
  ]);
  if (signal?.aborted) throw createDisposedError();

  const poseOptions = {
    runningMode: "VIDEO",
    outputSegmentationMasks: false,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  } as const;

  try {
    return await runStudioMediaPipeVisionTaskCreation({
      owner: "mannequin-video-pose",
      signal,
      create: () => PoseLandmarker.createFromOptions(visionSelection.fileset, {
        baseOptions: { modelAssetBuffer: modelAssetBuffer.slice(), delegate },
        ...poseOptions,
      }),
    });
  } catch (cause) {
    if (signal?.aborted) throw createDisposedError();
    throw createNamedError(
      "StudioMannequinPoseEngineCreationError",
      `Failed to create the selected ${delegate} mannequin PoseLandmarker.`,
      cause,
    );
  }
}

let cachedPoseLandmarker: StudioMannequinPoseLandmarker | null = null;
let cachedPoseLandmarkerDelegate: StudioMediaPipeVisionDelegate | null = null;
let initPoseLandmarkerPromise: Promise<StudioMannequinPoseLandmarker> | null = null;
let initPoseLandmarkerPromiseGeneration: number | null = null;
let initPoseLandmarkerPromiseDelegate: StudioMediaPipeVisionDelegate | null = null;
let poseLandmarkerGeneration = 0;

function mannequinDelegateIdentityError(): Error {
  return createNamedError(
    "StudioMannequinDelegateIdentityError",
    "The mannequin MediaPipe singleton is already owned by another delegate.",
  );
}

/**
 * Dedicated VIDEO-mode singleton for the mannequin. It deliberately does not share the VRM poser
 * singleton: stopping either surface must never close the other surface's active MediaPipe task.
 */
export async function initStudioMannequinPoseLandmarker(
  options: StudioMannequinPoseLandmarkerInitOptions = {},
): Promise<StudioMannequinPoseLandmarker> {
  if (options.signal?.aborted) throw createDisposedError();
  const delegate = options.delegate ?? "GPU";
  if (cachedPoseLandmarker) {
    if (cachedPoseLandmarkerDelegate !== delegate) {
      throw mannequinDelegateIdentityError();
    }
    return cachedPoseLandmarker;
  }
  if (initPoseLandmarkerPromise) {
    if (initPoseLandmarkerPromiseGeneration === poseLandmarkerGeneration) {
      if (initPoseLandmarkerPromiseDelegate !== delegate) {
        throw mannequinDelegateIdentityError();
      }
      return initPoseLandmarkerPromise;
    }
    // dispose 직후 재시도가 이전 MediaPipe ModuleFactory 초기화와 겹치면 전역 WASM
    // loader 상태가 경쟁한다. 이전 세대가 정리될 때까지 직렬화한 뒤 새 factory를 시작한다.
    try {
      await initPoseLandmarkerPromise;
    } catch {
      // Stale generation is expected to reject with AbortError.
    }
    if (options.signal?.aborted) throw createDisposedError();
    if (cachedPoseLandmarker) {
      if (cachedPoseLandmarkerDelegate !== delegate) {
        throw mannequinDelegateIdentityError();
      }
      return cachedPoseLandmarker;
    }
    return initStudioMannequinPoseLandmarker(options);
  }

  const generation = poseLandmarkerGeneration;
  const factory = options.factory ?? createStudioMannequinPoseLandmarker;
  const pending = (async () => {
    const landmarker = await factory(options.signal, delegate);
    if (generation !== poseLandmarkerGeneration || options.signal?.aborted) {
      safelyClosePoseLandmarker(landmarker);
      throw createDisposedError();
    }
    cachedPoseLandmarker = landmarker;
    cachedPoseLandmarkerDelegate = delegate;
    return landmarker;
  })();
  initPoseLandmarkerPromise = pending;
  initPoseLandmarkerPromiseGeneration = generation;
  initPoseLandmarkerPromiseDelegate = delegate;

  try {
    return await pending;
  } finally {
    if (initPoseLandmarkerPromise === pending) {
      initPoseLandmarkerPromise = null;
      initPoseLandmarkerPromiseGeneration = null;
      initPoseLandmarkerPromiseDelegate = null;
    }
  }
}

/** Cancels stale initialization and releases only the mannequin-owned VIDEO task. */
export function disposeStudioMannequinPoseLandmarker(): void {
  poseLandmarkerGeneration += 1;
  const landmarker = cachedPoseLandmarker;
  cachedPoseLandmarker = null;
  cachedPoseLandmarkerDelegate = null;
  // 진행 중 factory는 실제 취소할 수 없으므로 promise 권위를 유지한다. 다음 retry는 위
  // init 경로에서 settlement까지 기다려 global MediaPipe 초기화를 절대 중첩하지 않는다.
  if (landmarker) safelyClosePoseLandmarker(landmarker);
}

export type MannequinJointRotations = Record<StudioMannequinJointId, readonly [number, number, number]>;

/**
 * MediaPipe Pose 랜드마크 배열을 3D 데생 인형 관절 회전 맵으로 연산한다.
 */
export function solvePoseToMannequinJoints(
  landmarks: readonly PoseLandmark[],
  options: StudioMannequinTrackingOptions = DEFAULT_MANNEQUIN_TRACKING_OPTIONS,
): Partial<MannequinJointRotations> {
  const bones = solvePoseToVrmBones(landmarks as PoseLandmark[], {
    mirror: options.mirrorMode ?? true,
    zDamp: options.zDamp ?? 0.85,
    minVisibility: options.minVisibility ?? 0.2,
  });

  const result: Partial<MannequinJointRotations> = {};
  for (const [boneName, rotation] of Object.entries(bones)) {
    result[boneName as StudioMannequinJointId] = rotation;
  }

  return result;
}

/**
 * 연속된 관절 회전값에 지수 이동 평균(EMA) 스무딩을 적용한다.
 */
export function smoothMannequinJointRotations(
  previous: Partial<MannequinJointRotations>,
  current: Partial<MannequinJointRotations>,
  smoothing: number = 0.35,
): Partial<MannequinJointRotations> {
  const factor = Math.max(0.05, Math.min(1.0, smoothing));
  const result: Partial<MannequinJointRotations> = { ...previous };

  for (const [jointIdStr, currentRot] of Object.entries(current)) {
    const jointId = jointIdStr as StudioMannequinJointId;
    const prevRot = previous[jointId];
    if (!prevRot || !currentRot) {
      result[jointId] = currentRot;
      continue;
    }

    result[jointId] = [
      prevRot[0] + (currentRot[0] - prevRot[0]) * factor,
      prevRot[1] + (currentRot[1] - prevRot[1]) * factor,
      prevRot[2] + (currentRot[2] - prevRot[2]) * factor,
    ];
  }

  return result;
}
