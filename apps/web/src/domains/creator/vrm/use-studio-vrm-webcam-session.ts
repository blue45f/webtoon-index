/**
 * Studio VRM 웹캠 트래킹 세션 — getUserMedia + MediaPipe rVFC 루프 + 캘리브레이션.
 * `StudioVrmPoser.tsx`에서 그대로 옮겨온 effect 묶음이다(동작 동일). 호출부는 컨텍스트
 * 객체 하나만 넘기고, 내부에서 원래 지역 이름으로 구조 분해해 본문을 손대지 않는다.
 */
import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";

import { BlinkStabilizer } from "./studio-vrm-blink-stabilizer";
import { avatarSideForHand, solveHandToFingerBones } from "./studio-vrm-hand-solver";
import {
  applyCalibration,
  CalibrationSampler,
  type TrackingCalibration,
} from "./studio-vrm-tracking-calibration";
import { AdaptiveQualityController } from "./studio-vrm-tracking-quality";
import {
  initFaceLandmarker,
  disposeFaceLandmarker,
  initPoseLandmarker,
  disposePoseLandmarker,
  initHandLandmarker,
  disposeHandLandmarker,
  processTrackingResult,
  processPoseResult,
  convertChannelsToVrmData,
  createChannelSmoother,
  warmupLandmarkers,
  NEUTRAL_CHANNELS,
  type TrackingOptions,
  type TrackingChannels,
  type VrmTrackingData,
} from "./studio-vrm-webcam-tracking";

import type { StudioVrmTrackingCalibrationRepository } from "./studio-vrm-tracking-calibration-sqlite-repository";
import type { FaceLandmarker, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";

/** `useRef` 결과를 그대로 받되 React 타입 버전에 묶이지 않는 구조적 별칭. */
type MutableRef<T> = { current: T };

export type StudioVrmWebcamSessionContext = {
  blinkStabilizerRef: MutableRef<BlinkStabilizer>;
  calibrating: boolean;
  calibrationCountdown: number;
  calibrationPersistenceGenerationRef: MutableRef<number>;
  calibrationPersistenceMountedRef: MutableRef<boolean>;
  calibrationRef: MutableRef<TrackingCalibration | null>;
  calibrationSamplerRef: MutableRef<CalibrationSampler | null>;
  channelSmootherRef: MutableRef<ReturnType<typeof createChannelSmoother>>;
  faceLostFramesRef: MutableRef<number>;
  faceLostLongRef: MutableRef<boolean>;
  frameIndexRef: MutableRef<number>;
  handLandmarkerRef: MutableRef<HandLandmarker | null>;
  landmarkerRef: MutableRef<FaceLandmarker | null>;
  lastChannelsRef: MutableRef<TrackingChannels | null>;
  lastFingersRef: MutableRef<Record<string, readonly [number, number, number]> | null>;
  lastPoseBonesRef: MutableRef<Record<string, readonly [number, number, number]>>;
  poseLandmarkerRef: MutableRef<PoseLandmarker | null>;
  qualityRef: MutableRef<AdaptiveQualityController | null>;
  setBrowserPermissionState: Dispatch<
    SetStateAction<"granted" | "denied" | "prompt" | "unsupported">
  >;
  setCalibrated: Dispatch<SetStateAction<boolean>>;
  setCalibrating: Dispatch<SetStateAction<boolean>>;
  setCalibrationCountdown: Dispatch<SetStateAction<number>>;
  setCalibrationPersistenceMessage: Dispatch<SetStateAction<string>>;
  setCalibrationPersistenceStatus: Dispatch<
    SetStateAction<"loading" | "sqlite" | "saving" | "memory" | "read-error">
  >;
  setCalibrationProgress: Dispatch<SetStateAction<number>>;
  setFaceDetected: Dispatch<SetStateAction<boolean>>;
  setFaceLostLong: Dispatch<SetStateAction<boolean>>;
  setWebcamActive: Dispatch<SetStateAction<boolean>>;
  setWebcamError: Dispatch<SetStateAction<string | null>>;
  setWebcamErrorStage: Dispatch<SetStateAction<"camera" | "engine" | null>>;
  setWebcamLoading: Dispatch<SetStateAction<boolean>>;
  streamRef: MutableRef<MediaStream | null>;
  trackingCalibrationRepository: StudioVrmTrackingCalibrationRepository;
  trackingDataRef: MutableRef<VrmTrackingData | null>;
  trackingOptions: TrackingOptions;
  videoRef: MutableRef<HTMLVideoElement | null>;
  webcamActive: boolean;
  webcamActiveRef: MutableRef<boolean>;
};

// 얼굴 로스트: 이 프레임 수까지는 마지막 채널을 홀드(~0.3s, 순간 드랍 마스킹),
// 이후 중립 채널로 감쇠 복귀한다(One-Euro 필터가 전환을 스무딩 — 제로 스냅 없음).
const FACE_HOLD_FRAMES = 10;
// 얼굴 미검출이 이 프레임 수(~5초@30fps)를 넘으면 프리뷰에 힌트 배지를 띄운다.
const FACE_LOST_HINT_FRAMES = 150;

function parseCameraError(error: unknown): string {
  let errMsg = "카메라 권한 접근에 실패했습니다.";
  if (error instanceof Error) {
    const name = error.name;
    const msg = error.message;

    // Compute recommended access URL dynamically
    const getRecommendedUrl = () => {
      if (typeof window === "undefined") return "https://www.toonstudio.cloud/studio";
      const { protocol, hostname, origin, pathname } = window.location;
      const isLocal = hostname === "localhost" || hostname === "127.0.0.1";
      if (protocol === "https:" || isLocal) {
        // Use current URL (preserve path like /studio)
        return `${origin}${pathname}`;
      }
      // Suggest production HTTPS URL
      return "https://www.toonstudio.cloud/studio";
    };
    const recommended = getRecommendedUrl();
    const isSecure = typeof window !== "undefined" && (window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

    if (!isSecure) {
      return "보안 접속(HTTPS 또는 localhost) 환경이 아니기 때문에 브라우저가 카메라 권한 팝업을 띄우지 않고 요청을 원천 차단했습니다.\n\n" +
        "[해결 방법]\n" +
        `1. 현재 비보안 주소로 접속 중입니다. 브라우저 보안 규정상 웹캠은 HTTPS 또는 localhost에서만 허용됩니다.\n` +
        `2. 로컬 개발 시: 주소창에 'http://localhost:5173' (또는 현재 Vite 포트)을 직접 입력해 접속하세요.\n` +
        `3. 운영/배포 환경에서는 반드시 HTTPS 주소(${recommended})로 접속하세요. (Vercel 등은 자동으로 HTTPS를 강제합니다.)\n` +
        `4. 외부 IP(예: http://192.168.x.x:xxxx)로 직접 접속 중이라면, 도메인 또는 localhost를 사용하거나 ngrok/cloudflare tunnel 같은 HTTPS 터널을 이용하세요.`;
    }

    if (name === "NotAllowedError" || msg.includes("Permission denied") || msg.includes("denied")) {
      errMsg = "카메라 사용 권한이 거부되었거나 즉시 차단되었습니다. (브라우저가 동의 팝업을 띄우지 않는 상태)\n\n" +
        "[원인 및 해결 방법]\n" +
        "1. 브라우저 주소창 왼쪽 '자물쇠' 아이콘 클릭 → '카메라'가 '허용'인지 확인 (이 사이트 origin에서 별도로 설정해야 함: localhost vs https://www.toonstudio.cloud 별개).\n" +
        "2. macOS: 시스템 설정 → 개인정보 보호 및 보안 → 카메라 에서 사용 중인 브라우저 스위치를 **켜기**. (브라우저 권한과 별도의 시스템 권한임)\n" +
        "3. 위 설정 변경 후: 브라우저 **완전 종료 → 재실행 → F5** 후 다시 '트래킹 시작' 클릭.\n" +
        `4. 여전히 안 되면 '${recommended}' 로 직접 접속했는지, 다른 앱이 카메라 점유 중인지 확인.`;
    } else if (name === "TypeError" && (msg.includes("undefined") || msg.includes("Insecure Context") || msg.includes("getUserMedia"))) {
      errMsg = "보안 접속 환경(HTTPS 또는 localhost)이 아니어서 브라우저가 카메라 접근 요청을 원천 차단했습니다.\n\n" +
        "[해결 방법]\n" +
        `현재 주소가 비보안(HTTP IP 등)입니다. 로컬 개발은 'http://localhost:5173' (또는 dev server), 운영 환경은 HTTPS 주소(${recommended})로 직접 접속해 주세요.`;
    } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      errMsg = "연결된 카메라(웹캠) 장치를 찾을 수 없습니다. 카메라가 컴퓨터에 올바르게 연결되어 있고 전원이 켜져 있는지 확인해 주세요.";
    } else if (name === "NotReadableError" || name === "TrackStartError") {
      errMsg = "카메라 장치를 사용할 수 없습니다. 이미 다른 앱(Zoom, Discord, FaceTime, Skype, 또는 다른 브라우저 탭)에서 카메라를 사용 중일 가능성이 높습니다. 카메라를 점유 중인 다른 프로그램을 완전히 종료하고 다시 시도해 주세요.";
    } else if (name === "SecurityError") {
      errMsg = `보안 정책(Feature Policy 또는 Sandbox) 제한이나 비보안 컨텍스트 문제로 인해 카메라에 접근할 수 없습니다. '${recommended}' 주소로 직접 접속했는지 확인해 주세요.`;
    } else {
      errMsg = `카메라 접근 오류 (${name}): ${msg}\n\n브라우저 주소창의 자물쇠 설정과 macOS 시스템 보안 설정에서 카메라 권한이 켜져 있는지 다시 한번 확인해 주세요.`;
    }
  }
  return errMsg;
}

export function useStudioVrmWebcamSession({
  blinkStabilizerRef,
  calibrating,
  calibrationCountdown,
  calibrationPersistenceGenerationRef,
  calibrationPersistenceMountedRef,
  calibrationRef,
  calibrationSamplerRef,
  channelSmootherRef,
  faceLostFramesRef,
  faceLostLongRef,
  frameIndexRef,
  handLandmarkerRef,
  landmarkerRef,
  lastChannelsRef,
  lastFingersRef,
  lastPoseBonesRef,
  poseLandmarkerRef,
  qualityRef,
  setBrowserPermissionState,
  setCalibrated,
  setCalibrating,
  setCalibrationCountdown,
  setCalibrationPersistenceMessage,
  setCalibrationPersistenceStatus,
  setCalibrationProgress,
  setFaceDetected,
  setFaceLostLong,
  setWebcamActive,
  setWebcamError,
  setWebcamErrorStage,
  setWebcamLoading,
  streamRef,
  trackingCalibrationRepository,
  trackingDataRef,
  trackingOptions,
  videoRef,
  webcamActive,
  webcamActiveRef,
}: StudioVrmWebcamSessionContext): void {
  // 아래 의존성 중 setter/ref 는 useState·useRef 산출물이라 참조가 고정이다 —
  // 배열에 넣어도 원본(StudioVrmPoser.tsx) 과 재실행 시점이 동일하다.
  // Synchronize options to a ref for the frame loop
  const trackingOptionsRef = useRef(trackingOptions);
  useEffect(() => {
    trackingOptionsRef.current = trackingOptions;
  }, [trackingOptions]);

  // 탭 숨김 → 카메라 완전 해제(LED 소등 = 프라이버시) + 루프 정지, 복귀 시 재시작.
  // 기존 웹캠 effect 가 webcamActive=false 에서 track.stop 을 이미 수행하므로 토글을 재사용한다
  // (권한은 granted 상태라 재시작 시 프롬프트 없음, 모델은 싱글턴 캐시라 재-init 비용 없음).
  useEffect(() => {
    const wasActive = { current: false };
    const onVisibilityChange = () => {
      if (document.hidden) {
        wasActive.current = webcamActiveRef.current;
        if (wasActive.current) setWebcamActive(false);
      } else if (wasActive.current) {
        wasActive.current = false;
        setWebcamActive(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [setWebcamActive, webcamActiveRef]);

  // 캘리브레이션 카운트다운(3·2·1) → 종료 시 샘플러 가동(완료 감지는 트래킹 루프에서).
  useEffect(() => {
    if (!calibrating) return;
    if (calibrationCountdown > 0) {
      const timer = setTimeout(() => setCalibrationCountdown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    setCalibrationProgress(0);
    calibrationSamplerRef.current = new CalibrationSampler();
  }, [
    calibrating,
    calibrationCountdown,
    calibrationSamplerRef,
    setCalibrationCountdown,
    setCalibrationProgress,
  ]);

  // Webcam live tracking loop
  useEffect(() => {
    if (!webcamActive) {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
      // 트래킹 세션 상태 초기화 — 재시작 시 stale 필터/홀드 값 방지.
      channelSmootherRef.current.reset();
      blinkStabilizerRef.current.reset();
      qualityRef.current = null;
      calibrationSamplerRef.current = null;
      faceLostFramesRef.current = 0;
      faceLostLongRef.current = false;
      lastChannelsRef.current = null;
      lastPoseBonesRef.current = {};
      lastFingersRef.current = null;
      frameIndexRef.current = 0;
      trackingDataRef.current = null;
      setFaceDetected(false);
      setFaceLostLong(false);
      setCalibrating(false);
      return;
    }

    let active = true;
    let lastVideoTime = -1;
    let requestId: number;
    let videoFrameCallbackId: number | null = null;
    // rVFC 를 등록한 비디오 엘리먼트 — cleanup 에서 ref 재조회 대신 이 변수를 사용.
    let schedulingVideo: HTMLVideoElement | null = null;

    const startCamera = async () => {
      setWebcamLoading(true);
      setWebcamError(null);
      setWebcamErrorStage(null);
      let failureStage: "camera" | "engine" = "engine";
      try {
        // MediaPipe must settle before asking for a privacy-sensitive camera grant. If engine
        // initialization fails, the browser never lights the camera or leaves a stream to clean up.
        let landmarker;
        let poseLandmarker;
        try {
          [landmarker, poseLandmarker] = await Promise.all([
            initFaceLandmarker(),
            initPoseLandmarker(),
          ]);
        } catch (modelErr) {
          console.error("Tracking AI models initialization failed:", modelErr);
          throw new Error(
            "얼굴 및 전신 동작 인식 엔진을 준비하지 못했습니다. 네트워크를 확인한 뒤 다시 시도하고, 계속되면 페이지를 새로고침해 주세요.",
            { cause: modelErr },
          );
        }
        if (!active) return;

        failureStage = "camera";
        let stream: MediaStream;
        try {
          if (typeof navigator === "undefined" || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new TypeError("navigator.mediaDevices is undefined (Insecure Context or unsupported browser)");
          }

          // Always attempt getUserMedia on explicit user click (best chance for prompt).
          // The separate permission state effect + banner handles showing "already denied" warning.
          // This makes it more robust when Permissions API state lags behind actual grants (common on macOS).
          // Optional: enumerate first to help diagnose (labels empty = no permission yet or system block)
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            if (videoDevices.length === 0) {
              console.warn('No videoinput devices found via enumerateDevices()');
            } else if (videoDevices.some(d => !d.label)) {
              console.warn('Video devices found but labels empty (permission not yet fully granted or system level block)');
            }
          } catch { /* ignore */ }

          // 모델 내부 입력이 192~256px 라 640 초과는 낭비, 320×240 은 iris 정밀도 손실
          // — 640×480 이 스윗스팟. exact 는 OverconstrainedError 위험이 있어 ideal 만 사용.
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 },
              frameRate: { ideal: 30, max: 30 },
              facingMode: "user",
            },
            audio: false,
          });
        } catch (cameraErr) {
          console.error("Webcam access failed:", cameraErr);
          // Force update permission state on NotAllowed so banner shows even if Permissions API was "prompt"
          if (cameraErr instanceof Error && (cameraErr.name === "NotAllowedError" || /denied|Permission denied/i.test(cameraErr.message))) {
            setBrowserPermissionState("denied");
          }
          throw new Error(parseCameraError(cameraErr), { cause: cameraErr });
        }

        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          try {
            await video.play();
          } catch (e) {
            console.error("Video play failed:", e);
          }
        }

        if (!active) return;
        landmarkerRef.current = landmarker;
        poseLandmarkerRef.current = poseLandmarker;

        // 손가락 추적(옵션) — 별도 lazy 초기화. 실패해도 전신 추적은 유지.
        if (trackingOptionsRef.current.fingerTracking) {
          initHandLandmarker()
            .then((hand) => {
              if (active) handLandmarkerRef.current = hand;
            })
            .catch((handErr) => console.warn("HandLandmarker init failed (손가락 추적 비활성):", handErr));
        }

        // 적응형 품질 초기 티어 — 저사양 하드웨어 판정은 여기(호출부)서 주입해
        // 컨트롤러 모듈은 navigator 무의존 순수 모듈로 유지한다.
        const lowEnd =
          (navigator.hardwareConcurrency ?? 8) <= 4 ||
          ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
        qualityRef.current = new AdaptiveQualityController(lowEnd ? "reduced" : "full");

        // 첫 실제 프레임의 셰이더 컴파일/그래프 빌드 스톨을 트래킹 시작 전에 흡수.
        if (videoRef.current && videoRef.current.readyState >= 2) {
          warmupLandmarkers(videoRef.current, performance.now());
        }

        setWebcamLoading(false);

        const loop = () => {
          if (!active) return;
          const currentVideo = videoRef.current;
          const currentLandmarker = landmarkerRef.current;
          const currentPoseLandmarker = poseLandmarkerRef.current;
          if (currentVideo && currentLandmarker && currentPoseLandmarker && currentVideo.readyState >= 2) {
            // detectForVideo 타임스탬프는 단조 증가 필수 — 추론 시간 측정 시작점 겸용.
            const timestamp = performance.now();
            // rVFC 경로는 프레임당 1회 호출이지만 rAF 폴백을 위해 currentTime 가드 유지(무해).
            if (currentVideo.currentTime !== lastVideoTime) {
              lastVideoTime = currentVideo.currentTime;
              const frameIndex = frameIndexRef.current++;
              const quality = qualityRef.current;
              const options = trackingOptionsRef.current;

              const result = currentLandmarker.detectForVideo(currentVideo, timestamp);
              const rawChannels = processTrackingResult(result);

              // 적응형 품질: pose 는 티어에 따라 격프레임 스킵(스킵 프레임은 직전 결과 재사용
              // — 본 스무더가 보간을 겸한다).
              if (!quality || quality.shouldRunPose(frameIndex)) {
                const poseResult = currentPoseLandmarker.detectForVideo(currentVideo, timestamp);
                lastPoseBonesRef.current = processPoseResult(poseResult, options.mirrorMode);
              }
              const poseBones = lastPoseBonesRef.current;

              setFaceDetected(!!rawChannels);

              // 얼굴 로스트: 짧은 드랍은 마지막 채널 홀드, 길어지면 중립으로 감쇠 복귀.
              if (rawChannels) {
                faceLostFramesRef.current = 0;
                lastChannelsRef.current = rawChannels;
                if (faceLostLongRef.current) {
                  faceLostLongRef.current = false;
                  setFaceLostLong(false);
                }
              } else {
                faceLostFramesRef.current += 1;
                if (!faceLostLongRef.current && faceLostFramesRef.current > FACE_LOST_HINT_FRAMES) {
                  faceLostLongRef.current = true;
                  setFaceLostLong(true);
                }
              }
              const held =
                (faceLostFramesRef.current <= FACE_HOLD_FRAMES ? lastChannelsRef.current : null) ??
                NEUTRAL_CHANNELS;

              // 캘리브레이션 샘플링 — 반드시 보정 "이전" raw 값으로, 얼굴 검출 프레임만 수집.
              const sampler = calibrationSamplerRef.current;
              if (sampler && rawChannels) {
                sampler.add(rawChannels);
                setCalibrationProgress(sampler.progress);
                if (sampler.done) {
                  calibrationSamplerRef.current = null;
                  const cal = sampler.build();
                  if (cal) {
                    calibrationRef.current = cal;
                    const generation = ++calibrationPersistenceGenerationRef.current;
                    setCalibrationPersistenceStatus("saving");
                    setCalibrationPersistenceMessage("");
                    void trackingCalibrationRepository.save(cal).then(() => {
                      if (
                        !calibrationPersistenceMountedRef.current
                        || calibrationPersistenceGenerationRef.current !== generation
                      ) return;
                      setCalibrationPersistenceStatus("sqlite");
                    }).catch((caughtError: unknown) => {
                      if (
                        !calibrationPersistenceMountedRef.current
                        || calibrationPersistenceGenerationRef.current !== generation
                      ) return;
                      setCalibrationPersistenceStatus("memory");
                      setCalibrationPersistenceMessage(
                        `캘리브레이션은 현재 탭에만 적용됩니다. SQLite/OPFS 저장 실패: ${
                          caughtError instanceof Error ? caughtError.message : String(caughtError)
                        }`,
                      );
                    });
                    channelSmootherRef.current.reset();
                  }
                  setCalibrated(!!cal);
                  setCalibrating(false);
                }
              }

              // 적용 순서: raw → 캘리브레이션 → One-Euro → 블링크 안정화 → VRM 변환.
              const calibratedChannels = applyCalibration(held, calibrationRef.current);
              const smoothed = channelSmootherRef.current.smooth(
                calibratedChannels,
                timestamp / 1000, // 초 단위 실제 시간 — 프레임 인덱스 금지(가변 fps 왜곡).
                options.smoothing
              );
              // blink 좌우는 카메라 좌표계 그대로 — 미러 스왑은 convertChannelsToVrmData
              // 한 곳에서만 수행한다(이중 반전 금지).
              const blink = blinkStabilizerRef.current.process(
                smoothed.blinkLeft,
                smoothed.blinkRight,
                smoothed.headYaw
              );
              const vrmData = convertChannelsToVrmData(
                { ...smoothed, blinkLeft: blink.left, blinkRight: blink.right },
                options
              );
              vrmData.bones = { ...vrmData.bones, ...poseBones };

              // 손가락 추적: 티어에 따라 격프레임/비활성(스킵 프레임은 직전 결과 재사용).
              const handLm = handLandmarkerRef.current;
              if (handLm) {
                if (!quality || quality.shouldRunHands(frameIndex, options.fingerTracking)) {
                  const handResult = handLm.detectForVideo(currentVideo, timestamp);
                  const fingers: Record<string, readonly [number, number, number]> = {};
                  const hands = handResult?.landmarks ?? [];
                  const handed = handResult?.handednesses ?? [];
                  for (let i = 0; i < hands.length; i++) {
                    const label = handed[i]?.[0]?.categoryName ?? "Right";
                    const side = avatarSideForHand(label, options.mirrorMode);
                    Object.assign(fingers, solveHandToFingerBones(hands[i], side));
                  }
                  lastFingersRef.current = fingers;
                }
                if (lastFingersRef.current) vrmData.fingers = lastFingersRef.current;
              }

              trackingDataRef.current = vrmData;
              qualityRef.current?.recordFrame(performance.now() - timestamp, performance.now());
            }
          }
          scheduleNext();
        };
        // 30fps 웹캠에서 rAF(60Hz) 대비 호출 절반 — 새 비디오 프레임에만 깨어난다.
        const scheduleNext = () => {
          const video = videoRef.current;
          if (video && "requestVideoFrameCallback" in video) {
            schedulingVideo = video;
            videoFrameCallbackId = video.requestVideoFrameCallback(() => loop());
          } else {
            requestId = requestAnimationFrame(loop);
          }
        };
        scheduleNext();
      } catch (err) {
        console.error("Webcam start failed:", err);
        const errMsg = err instanceof Error ? err.message : "카메라 권한 접근에 실패했거나 트래킹 로드 오류가 발생했습니다.";
        setWebcamErrorStage(failureStage);
        setWebcamError(errMsg);
        setWebcamActive(false);
        setWebcamLoading(false);
      }
    };

    startCamera();

    return () => {
      active = false;
      setWebcamLoading(false);
      if (requestId) cancelAnimationFrame(requestId);
      if (videoFrameCallbackId !== null && schedulingVideo && "cancelVideoFrameCallback" in schedulingVideo) {
        schedulingVideo.cancelVideoFrameCallback(videoFrameCallbackId);
      }
      // 핸드 랜드마커 참조 해제 — 재시작 시 옵션에 따라 다시 설정.
      handLandmarkerRef.current = null;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [
    blinkStabilizerRef,
    calibrationPersistenceGenerationRef,
    calibrationPersistenceMountedRef,
    calibrationRef,
    calibrationSamplerRef,
    channelSmootherRef,
    faceLostFramesRef,
    faceLostLongRef,
    frameIndexRef,
    handLandmarkerRef,
    landmarkerRef,
    lastChannelsRef,
    lastFingersRef,
    lastPoseBonesRef,
    poseLandmarkerRef,
    qualityRef,
    setBrowserPermissionState,
    setCalibrated,
    setCalibrating,
    setCalibrationPersistenceMessage,
    setCalibrationPersistenceStatus,
    setCalibrationProgress,
    setFaceDetected,
    setFaceLostLong,
    setWebcamActive,
    setWebcamError,
    setWebcamErrorStage,
    setWebcamLoading,
    streamRef,
    trackingCalibrationRepository,
    trackingDataRef,
    videoRef,
    webcamActive,
  ]);

  useEffect(() => {
    return () => {
      disposeFaceLandmarker();
      disposePoseLandmarker();
      disposeHandLandmarker();
    };
  }, []);
}
