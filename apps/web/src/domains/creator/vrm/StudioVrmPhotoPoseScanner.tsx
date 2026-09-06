import { Check, FlipHorizontal2, ImageUp, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";

import {
  StudioVrmPhotoPoseError,
  type StudioVrmPhotoPoseConfidenceSummary,
  type StudioVrmPhotoPoseLandmark,
  type StudioVrmPhotoPoseRotation,
} from "./studio-vrm-photo-pose";
import {
  inferStudioVrmPhotoPoseFromImage,
  waitForStudioVrmPhotoPosePhase,
} from "./studio-vrm-photo-pose-inference";
import {
  StudioVrmPhotoPosePreprocessor,
  type StudioVrmPhotoPosePreprocessJob,
  type StudioVrmPhotoPoseProgressStage,
} from "./studio-vrm-photo-pose-worker-client";
import {
  disposePhotoHandLandmarker,
  disposePhotoPoseLandmarker,
  initPhotoHandLandmarker,
  initPhotoPoseLandmarker,
} from "./studio-vrm-webcam-tracking";

import type {
  StudioVrmPhotoHandDetection,
  StudioVrmPhotoHandInferenceResult,
  StudioVrmPhotoHandSide,
  StudioVrmPhotoHandWarningCode,
} from "./studio-vrm-photo-hand";
import type { BoneEulerMap } from "./studio-vrm-pose-solver";

/**
 * An image the surrounding surface already asked the creator for. Handing it over means the same
 * photo is not picked twice — `token` is what re-triggers a scan, so re-handing the same File
 * object with a new token rescans, and a re-render alone never does.
 */
export interface StudioVrmPhotoPoseHandoff {
  readonly file: File;
  readonly token: number;
}

export interface StudioVrmPhotoPoseScannerProps {
  readonly disabled?: boolean;
  /** Mannequin scans do not need the optional hand model or finger controls. */
  readonly includeHandDetection?: boolean;
  /** Defaults to `low` for backwards-compatible VRM review/apply behavior. */
  readonly minimumApplyQuality?: StudioVrmPhotoPoseConfidenceSummary["quality"];
  readonly handoff?: StudioVrmPhotoPoseHandoff | null;
  readonly onApply: (payload: StudioVrmPhotoPoseApplyPayload) => boolean;
}

export interface StudioVrmPhotoPoseApplyPayload {
  readonly sourceName: string;
  readonly bones: BoneEulerMap;
  readonly landmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly worldLandmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly confidence: StudioVrmPhotoPoseConfidenceSummary;
  readonly fingerEdits: StudioVrmPhotoHandInferenceResult["fingerEdits"];
  readonly detectedHandSides: readonly StudioVrmPhotoHandSide[];
}

interface PhotoPoseCandidate {
  readonly sourceName: string;
  readonly bones: BoneEulerMap;
  readonly landmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly worldLandmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly confidence: StudioVrmPhotoPoseConfidenceSummary;
  readonly hands: StudioVrmPhotoHandInferenceResult;
}

const SKELETON_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
] as const;

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
] as const;

const PROGRESS_LABELS: Readonly<Record<StudioVrmPhotoPoseProgressStage | "inference", string>> = {
  admission: "파일 확인",
  reading: "사진 읽기",
  inspecting: "형식 검사",
  decoding: "Worker 디코드",
  transforming: "회전·리사이즈",
  ready: "전처리 완료",
  inference: "로컬 포즈 인식",
};

const HAND_WARNING_LABELS: Readonly<Record<StudioVrmPhotoHandWarningCode, string>> = {
  "ambiguous-side": "같은 쪽 손이 겹쳐 보여 해당 손가락은 적용하지 않습니다.",
  "inference-failed": "손가락 인식을 완료하지 못해 전신 포즈만 준비했습니다.",
  "low-confidence": "손 인식 신뢰도가 낮아 해당 손가락은 적용하지 않습니다.",
  "model-unavailable": "손 인식 모델을 준비하지 못해 전신 포즈만 준비했습니다.",
  protocol: "손 인식 결과를 안전하게 확인하지 못해 전신 포즈만 준비했습니다.",
};

const LOW_CONFIDENCE_LABELS: Readonly<Record<string, string>> = {
  torso: "몸통",
  leftArm: "왼팔",
  rightArm: "오른팔",
  leftLeg: "왼다리",
  rightLeg: "오른다리",
};

const STUDIO_VRM_PHOTO_POSE_SCAN_TIMEOUT_MS = 45_000;
const STUDIO_VRM_PHOTO_HAND_INIT_BUDGET_MS = 8_000;

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value * 100));
}

function confidenceLabel(summary: StudioVrmPhotoPoseConfidenceSummary): string {
  if (summary.quality === "high") return "높음";
  if (summary.quality === "medium") return "보통";
  return "낮음";
}

const PHOTO_POSE_QUALITY_RANK: Readonly<
  Record<StudioVrmPhotoPoseConfidenceSummary["quality"], number>
> = Object.freeze({ low: 0, medium: 1, high: 2 });

type StudioVrmPhotoPoseApplyScope = "full" | "upper" | "arms";

const PHOTO_POSE_APPLY_SCOPES: ReadonlyArray<{
  readonly id: StudioVrmPhotoPoseApplyScope;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: "full", label: "전신", hint: "몸통·팔·다리·손을 모두 적용" },
  { id: "upper", label: "상체", hint: "몸통·머리·팔·손만 적용" },
  { id: "arms", label: "팔·손", hint: "현재 하체를 유지하고 팔과 손만 적용" },
] as const;

function filterPhotoPoseBones(
  bones: BoneEulerMap,
  scope: StudioVrmPhotoPoseApplyScope,
): BoneEulerMap {
  if (scope === "full") return bones;
  const upperPattern = /head|neck|spine|chest|shoulder|arm|hand/i;
  const armPattern = /shoulder|arm|hand/i;
  const pattern = scope === "upper" ? upperPattern : armPattern;
  return Object.fromEntries(
    Object.entries(bones).filter(([bone]) => pattern.test(bone)),
  ) as BoneEulerMap;
}

function doesStudioVrmPhotoPoseConfidenceMeetMinimum(
  confidence: StudioVrmPhotoPoseConfidenceSummary,
  minimumQuality: StudioVrmPhotoPoseConfidenceSummary["quality"],
): boolean {
  return PHOTO_POSE_QUALITY_RANK[confidence.quality] >= PHOTO_POSE_QUALITY_RANK[minimumQuality];
}

function waitForOptionalPhotoHandDetector(
  phase: PromiseLike<Awaited<ReturnType<typeof initPhotoHandLandmarker>>>,
  signal: AbortSignal,
): Promise<Awaited<ReturnType<typeof initPhotoHandLandmarker>> | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (detector: Awaited<ReturnType<typeof initPhotoHandLandmarker>> | null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
      resolve(detector);
    };
    const handleAbort = () => finish(null);
    const timeout = globalThis.setTimeout(
      () => finish(null),
      STUDIO_VRM_PHOTO_HAND_INIT_BUDGET_MS,
    );
    signal.addEventListener("abort", handleAbort, { once: true });
    if (signal.aborted) {
      finish(null);
      return;
    }
    void Promise.resolve(phase).then(
      (detector) => finish(signal.aborted ? null : detector),
      () => finish(null),
    );
  });
}

function handStatusLabel(hands: StudioVrmPhotoHandInferenceResult): string {
  if (hands.status === "unavailable") return "손가락 인식 제외";
  if (hands.detectedSides.length === 0) return "손 미검출 · 기존 손 유지";
  const sides = hands.detectedSides.map((side) => side === "left" ? "왼손" : "오른손");
  return `${sides.join(" · ")} 인식`;
}

function HandSkeleton({ detection }: { readonly detection: StudioVrmPhotoHandDetection }) {
  const tone = detection.side === "left" ? "text-accent" : "text-warning";
  return (
    <g className={tone}>
      {HAND_CONNECTIONS.map(([fromIndex, toIndex]) => {
        const from = detection.normalizedLandmarks[fromIndex];
        const to = detection.normalizedLandmarks[toIndex];
        if (!from || !to) return null;
        return (
          <line
            key={`${detection.side}-${fromIndex}-${toIndex}`}
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.15"
            x1={clampPercent(from.x)}
            x2={clampPercent(to.x)}
            y1={clampPercent(from.y)}
            y2={clampPercent(to.y)}
          />
        );
      })}
      {detection.normalizedLandmarks.map((landmark, index) => (
        <circle
          key={`${detection.side}-${index}`}
          cx={clampPercent(landmark.x)}
          cy={clampPercent(landmark.y)}
          fill="currentColor"
          r="1.15"
        />
      ))}
    </g>
  );
}

function SkeletonPreview({
  landmarks,
  hands,
  imageUrl,
}: {
  readonly landmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly hands: StudioVrmPhotoHandInferenceResult;
  readonly imageUrl: string;
}) {
  return (
    <svg
      aria-label="인식한 사진 포즈 골격 미리보기"
      className="h-32 w-full rounded-lg border border-line bg-[linear-gradient(180deg,oklch(0.22_0.02_250/0.75),oklch(0.12_0.015_250/0.9))]"
      role="img"
      viewBox="0 0 100 100"
    >
      {imageUrl ? (
        <>
          <image href={imageUrl} width="100" height="100" preserveAspectRatio="xMidYMid slice" />
          <rect width="100" height="100" fill="oklch(0.08 0.01 250 / 0.28)" />
        </>
      ) : null}
      {SKELETON_CONNECTIONS.map(([fromIndex, toIndex]) => {
        const from = landmarks[fromIndex];
        const to = landmarks[toIndex];
        if (!from || !to) return null;
        const opacity = Math.max(0.2, Math.min(from.visibility ?? 1, to.visibility ?? 1));
        return (
          <line
            key={`${fromIndex}-${toIndex}`}
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
            style={{ opacity }}
            x1={clampPercent(from.x)}
            x2={clampPercent(to.x)}
            y1={clampPercent(from.y)}
            y2={clampPercent(to.y)}
          />
        );
      })}
      {landmarks.map((landmark, index) => {
        if (![11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28].includes(index)) return null;
        return (
          <circle
            key={index}
            cx={clampPercent(landmark.x)}
            cy={clampPercent(landmark.y)}
            fill="currentColor"
            r="2.1"
            style={{ opacity: Math.max(0.25, landmark.visibility ?? 1) }}
          />
        );
      })}
      {hands.detections.map((detection) => (
        <HandSkeleton key={detection.side} detection={detection} />
      ))}
    </svg>
  );
}

export function StudioVrmPhotoPoseScanner({
  disabled = false,
  includeHandDetection = true,
  minimumApplyQuality = "low",
  handoff = null,
  onApply,
}: StudioVrmPhotoPoseScannerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const preprocessorRef = useRef<StudioVrmPhotoPosePreprocessor | null>(null);
  const jobRef = useRef<StudioVrmPhotoPosePreprocessJob | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const [rotation, setRotation] = useState<StudioVrmPhotoPoseRotation>(0);
  const [mirrorHorizontal, setMirrorHorizontal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState<StudioVrmPhotoPoseProgressStage | "inference">("admission");
  const [error, setError] = useState("");
  const [candidate, setCandidate] = useState<PhotoPoseCandidate | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [applyScope, setApplyScope] = useState<StudioVrmPhotoPoseApplyScope>("full");
  const [includeFingerEdits, setIncludeFingerEdits] = useState(true);

  const replacePreviewUrl = (file: File | null) => {
    if (previewUrlRef.current && typeof URL.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    const next = file && typeof URL.createObjectURL === "function"
      ? URL.createObjectURL(file)
      : "";
    previewUrlRef.current = next || null;
    setPreviewUrl(next);
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      scanAbortRef.current?.abort();
      scanAbortRef.current = null;
      jobRef.current?.cancel();
      jobRef.current = null;
      preprocessorRef.current?.dispose();
      preprocessorRef.current = null;
      if (previewUrlRef.current && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(previewUrlRef.current);
      }
      previewUrlRef.current = null;
      disposePhotoHandLandmarker();
      disposePhotoPoseLandmarker();
    };
  }, []);

  // 넘겨받은 사진을 스캔한다. 스캔 함수는 매 렌더 새로 만들어지므로 ref로 최신본만 들고 있고,
  // 실제 트리거는 토큰이다 — 같은 File을 다시 넘기려면 토큰을 올리면 되고, 리렌더만으로는
  // 사용자가 이미 본 결과를 지우고 다시 읽는 일이 없다.
  const scanRef = useRef<(file: File) => void>(() => {});
  useEffect(() => {
    scanRef.current = (file: File) => {
      void scanPhotoFile(file);
    };
  });

  const handledHandoffRef = useRef<number | null>(null);
  useEffect(() => {
    if (!handoff || disabled) return;
    if (handledHandoffRef.current === handoff.token) return;
    handledHandoffRef.current = handoff.token;
    scanRef.current(handoff.file);
  }, [handoff, disabled]);

  function handlePhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void scanPhotoFile(file);
  }

  async function scanPhotoFile(file: File) {
    if (disabled) return;

    replacePreviewUrl(file);
    setBusy(true);
    setCandidate(null);
    setIncludeFingerEdits(true);
    setError("");
    setProgress(0);
    setProgressStage("admission");
    scanAbortRef.current?.abort();
    const scanController = new AbortController();
    scanAbortRef.current = scanController;
    let timedOut = false;
    const timeout = globalThis.setTimeout(() => {
      timedOut = true;
      scanController.abort();
    }, STUDIO_VRM_PHOTO_POSE_SCAN_TIMEOUT_MS);
    let bitmap: ImageBitmap | null = null;
    let generationId: number;
    try {
      const preprocessor = preprocessorRef.current ?? new StudioVrmPhotoPosePreprocessor();
      preprocessorRef.current = preprocessor;
      const job = preprocessor.start(
        file,
        { exifMode: "apply", rotation, mirrorHorizontal },
        {
          signal: scanController.signal,
          onProgress: (next) => {
            if (
              !aliveRef.current ||
              scanController.signal.aborted ||
              scanAbortRef.current !== scanController ||
              next.generationId !== preprocessor.currentGenerationId
            ) return;
            setProgress(next.progress);
            setProgressStage(next.stage);
          },
        },
      );
      jobRef.current = job;
      generationId = job.generationId;
      const preprocessed = await job.result;
      bitmap = preprocessed.bitmap;
      if (
        !aliveRef.current ||
        scanController.signal.aborted ||
        scanAbortRef.current !== scanController ||
        generationId !== preprocessor.currentGenerationId
      ) {
        throw new StudioVrmPhotoPoseError("stale-generation");
      }

      setProgress(0.94);
      setProgressStage("inference");
      const handPhase = includeHandDetection
        ? waitForOptionalPhotoHandDetector(
            initPhotoHandLandmarker(),
            scanController.signal,
          )
        : Promise.resolve(null);
      const landmarker = await waitForStudioVrmPhotoPosePhase(
        initPhotoPoseLandmarker(),
        scanController.signal,
      );
      const handDetector = await handPhase;
      if (scanController.signal.aborted) throw new StudioVrmPhotoPoseError("aborted");
      if (
        !aliveRef.current ||
        scanAbortRef.current !== scanController ||
        generationId !== preprocessor.currentGenerationId
      ) {
        throw new StudioVrmPhotoPoseError("stale-generation");
      }
      await waitForStudioVrmPhotoPosePhase(
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
        scanController.signal,
      );
      // Ownership of the transferred bitmap moves into the inference boundary, which closes it in
      // every success/error path after copying numeric landmarks.
      bitmap = null;
      const scan = inferStudioVrmPhotoPoseFromImage(preprocessed, landmarker, {
        expectedGenerationId: generationId,
        isGenerationCurrent: (candidateGenerationId) =>
          aliveRef.current &&
          scanAbortRef.current === scanController &&
          candidateGenerationId === preprocessor.currentGenerationId,
        signal: scanController.signal,
        mirrorPose: false,
        minimumVisibility: 0.35,
        handDetector,
        minimumHandednessConfidence: 0.5,
      });
      const inference = scan.inference;
      if (
        !aliveRef.current ||
        scanController.signal.aborted ||
        scanAbortRef.current !== scanController ||
        generationId !== preprocessor.currentGenerationId
      ) {
        throw new StudioVrmPhotoPoseError("stale-generation");
      }
      setCandidate({
        sourceName: file.name,
        bones: inference.bones,
        landmarks: inference.normalizedLandmarks,
        worldLandmarks: inference.worldLandmarks,
        confidence: inference.confidence,
        hands: scan.hands,
      });
      setProgress(1);
    } catch (caughtError: unknown) {
      if (!aliveRef.current) return;
      const displayedError = timedOut
        ? new StudioVrmPhotoPoseError("timeout")
        : caughtError;
      setError(
        displayedError instanceof Error
          ? displayedError.message
          : "사진 포즈를 인식하지 못했습니다.",
      );
    } finally {
      globalThis.clearTimeout(timeout);
      bitmap?.close();
      if (aliveRef.current && scanAbortRef.current === scanController) {
        setBusy(false);
        jobRef.current = null;
        scanAbortRef.current = null;
      }
    }
  }

  function cancelScan() {
    scanAbortRef.current?.abort();
    jobRef.current?.cancel();
  }

  const candidateMeetsMinimum = candidate
    ? doesStudioVrmPhotoPoseConfidenceMeetMinimum(candidate.confidence, minimumApplyQuality)
    : true;

  return (
    <section className="mb-3 rounded-xl border border-line bg-card/45 p-3" aria-label="사진 포즈 스캐너">
      <input
        ref={inputRef}
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        disabled={disabled || busy}
        onChange={handlePhotoSelected}
        type="file"
      />
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-bold text-fg">
            <ImageUp size={13} className="text-accent" aria-hidden /> 사진 포즈 스캔
          </h4>
          <p className="mt-1 text-[0.65rem] leading-relaxed text-fg-3">
            사진은 서버로 보내지 않고, Worker 전처리 후 브라우저 안에서 한 사람의 전신 포즈
            {includeHandDetection ? "와 보이는 손가락을" : "를"} 분석합니다.
          </p>
        </div>
        {busy ? (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line px-3 py-1 text-[0.66rem] font-bold text-fg-2 hover:bg-raised"
            onClick={cancelScan}
          >
            <X size={11} aria-hidden /> 취소
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-accent/50 bg-accent-soft px-3 py-1 text-[0.66rem] font-bold text-accent hover:bg-accent-soft/80 disabled:opacity-45"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <ImageUp size={11} aria-hidden /> 사진 선택
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-[0.65rem] font-semibold text-fg-2">
          <span className="mb-1 flex items-center gap-1"><RotateCcw size={10} aria-hidden /> 회전</span>
          <select
            aria-label="사진 회전"
            className="h-11 w-full rounded-md border border-line bg-panel px-2 text-[0.68rem] text-fg"
            disabled={busy || disabled}
            value={rotation}
            onChange={(event) => setRotation(Number(event.target.value) as StudioVrmPhotoPoseRotation)}
          >
            <option value={0}>자동 방향</option>
            <option value={90}>오른쪽 90°</option>
            <option value={180}>180°</option>
            <option value={270}>왼쪽 90°</option>
          </select>
        </label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-line bg-panel px-2 py-1.5 text-[0.66rem] font-semibold text-fg-2">
          <input
            type="checkbox"
            checked={mirrorHorizontal}
            disabled={busy || disabled}
            onChange={(event) => setMirrorHorizontal(event.target.checked)}
            className="size-3.5 accent-accent"
          />
          <span className="inline-flex items-center gap-1"><FlipHorizontal2 size={10} aria-hidden /> 좌우 반전</span>
        </label>
      </div>

      {busy ? (
        <div className="mt-3" role="status" aria-live="polite">
          <div className="flex items-center justify-between text-[0.65rem] text-fg-3">
            <span className="inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" aria-hidden /> {PROGRESS_LABELS[progressStage]}</span>
            <span className="numeral">{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 rounded-md border border-danger/30 bg-danger-soft p-2 text-[0.66rem] text-danger">{error}</p> : null}

      {candidate ? (
        <div className="mt-3 grid gap-2">
          <SkeletonPreview landmarks={candidate.landmarks} hands={candidate.hands} imageUrl={previewUrl} />
          <div className="flex items-center justify-between gap-2 text-[0.66rem] text-fg-2">
            <span className="min-w-0 truncate" title={candidate.sourceName}>{candidate.sourceName}</span>
            <span className="shrink-0 font-bold">
              신뢰도 {confidenceLabel(candidate.confidence)} · {Math.round(candidate.confidence.overall * 100)}%
            </span>
          </div>
          {candidate.confidence.lowConfidenceGroups.length > 0 ? (
            <p className="text-[0.64rem] leading-relaxed text-warning">
              확인 권장: {candidate.confidence.lowConfidenceGroups.map((group) => LOW_CONFIDENCE_LABELS[group] ?? group).join(", ")}
            </p>
          ) : null}
          {!candidateMeetsMinimum ? (
            <p role="alert" className="text-[0.64rem] leading-relaxed text-danger">
              신뢰도가 적용 기준보다 낮습니다. 사람이 더 크게 보이고 팔·다리가 선명한 사진을 다시 선택해 주세요.
            </p>
          ) : null}
          {includeHandDetection ? (
            <p className="text-[0.64rem] font-semibold text-fg-2" aria-live="polite">
              {handStatusLabel(candidate.hands)}
            </p>
          ) : null}
          {includeHandDetection ? candidate.hands.warnings.map((warning) => (
            <p key={warning} className="text-[0.64rem] leading-relaxed text-warning">
              {HAND_WARNING_LABELS[warning]}
            </p>
          )) : null}
          {includeHandDetection && candidate.hands.detectedSides.length > 0 ? (
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-3 text-[0.66rem] font-semibold text-fg-2">
              <input
                type="checkbox"
                checked={includeFingerEdits}
                onChange={(event) => setIncludeFingerEdits(event.target.checked)}
                className="size-4 accent-accent"
              />
              인식한 손가락도 함께 적용
            </label>
          ) : null}
          <fieldset className="rounded-lg border border-line bg-panel/60 p-2">
            <legend className="px-1 text-[0.62rem] font-bold text-fg-2">적용 범위</legend>
            <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="사진 포즈 적용 범위">
              {PHOTO_POSE_APPLY_SCOPES.map((scope) => (
                <button
                  key={scope.id}
                  type="button"
                  role="radio"
                  aria-checked={applyScope === scope.id}
                  title={scope.hint}
                  className={`min-h-10 rounded-lg border px-1 text-[0.6rem] font-bold transition-colors ${
                    applyScope === scope.id
                      ? "border-accent/60 bg-accent-soft text-accent"
                      : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
                  }`}
                  onClick={() => setApplyScope(scope.id)}
                >
                  {scope.label}
                </button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line bg-card px-2 py-1.5 text-[0.68rem] font-bold text-fg-2 hover:bg-raised"
              onClick={() => {
                setCandidate(null);
                replacePreviewUrl(null);
              }}
            >
              다시 선택
            </button>
            <button
              type="button"
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border border-accent/60 bg-accent px-2 py-1.5 text-[0.68rem] font-bold text-on-accent hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-45"
              disabled={disabled || !candidateMeetsMinimum}
              onClick={() => {
                if (disabled || !candidateMeetsMinimum) return;
                const applied = onApply({
                  sourceName: candidate.sourceName,
                  bones: filterPhotoPoseBones(candidate.bones, applyScope),
                  landmarks: candidate.landmarks,
                  worldLandmarks: candidate.worldLandmarks,
                  confidence: candidate.confidence,
                  fingerEdits: includeHandDetection && includeFingerEdits
                    ? candidate.hands.fingerEdits
                    : {},
                  detectedHandSides: includeHandDetection && includeFingerEdits
                    ? candidate.hands.detectedSides
                    : [],
                });
                if (applied) setCandidate(null);
                if (applied) replacePreviewUrl(null);
              }}
            >
              <Check size={11} aria-hidden /> 포즈 적용
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
