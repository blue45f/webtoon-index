import {
  Check,
  Eye,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ChangeEvent } from "react";

import { createAvatarForgeState, type AvatarForgeState } from "./studio-vrm-avatar-forge";
import {
  analyzeStudioVrmAvatarReferenceImage,
  supportsStudioVrmAvatarReferenceRecommendations,
  type StudioVrmAvatarReferenceAnalyzeOptions,
  type StudioVrmAvatarReferenceProgress,
} from "./studio-vrm-avatar-reference-inference";
import {
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION,
  STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256,
  StudioVrmAvatarReferenceError,
  admitStudioVrmAvatarReferenceCatalogue,
  findStudioVrmAvatarReferencePreset,
  isStudioVrmAvatarReferenceRecommendationReceipt,
  type StudioVrmAvatarReferenceCatalogue,
  type StudioVrmAvatarReferenceRecommendationReceipt,
} from "./studio-vrm-avatar-reference-recommendation";
import {
  describeStudioVrmAvatarForgeState,
  StudioVrmAvatarForgePreview,
} from "./StudioVrmAvatarForgePreview";

/**
 * THESIS: A reference photo narrows the preset shelf but never edits the avatar by itself.
 * OWN-WORLD: Inherit Avatar Forge's warm-ink panel, persimmon action, hairline dividers and compact controls.
 * STORY: Upload locally, inspect three traceable MediaPipe matches, preview one, then explicitly apply it.
 * FIRST VIEWPORT: Privacy/engine authority leads; one upload action precedes a quiet ranked ledger.
 * FORM: Operate-mode extension inside the established Avatar Forge world; no competitor UI or assets.
 */

export interface StudioVrmAvatarReferenceSelection {
  readonly presetId: string;
  readonly state: AvatarForgeState;
  readonly receipt: StudioVrmAvatarReferenceRecommendationReceipt;
}

export interface StudioVrmAvatarReferenceRecommendationsPanelProps {
  readonly catalogue?: StudioVrmAvatarReferenceCatalogue | null;
  readonly catalogueStatus?: "idle" | "loading" | "ready" | "unavailable";
  readonly catalogueUnavailableReason?: string;
  readonly disabled?: boolean;
  readonly previewingPresetId?: string | null;
  readonly runtimeSupported?: boolean;
  readonly onPreview: (selection: StudioVrmAvatarReferenceSelection) => void;
  readonly onPreviewClear?: () => void;
  readonly onApply: (selection: StudioVrmAvatarReferenceSelection) => void;
  readonly onCatalogueRetry?: () => void;
  /** Host/test seam. Product code uses the bounded preprocessing + dedicated embedder Workers. */
  readonly analyzeImage?: (
    file: File,
    catalogue: StudioVrmAvatarReferenceCatalogue,
    options?: StudioVrmAvatarReferenceAnalyzeOptions,
  ) => Promise<StudioVrmAvatarReferenceRecommendationReceipt>;
}

function safeCatalogue(
  catalogue: StudioVrmAvatarReferenceCatalogue | null | undefined,
): StudioVrmAvatarReferenceCatalogue | null {
  if (!catalogue) return null;
  try {
    return admitStudioVrmAvatarReferenceCatalogue(catalogue);
  } catch {
    return null;
  }
}

function progressLabel(progress: StudioVrmAvatarReferenceProgress | null): string {
  if (!progress) return "이미지 준비 중";
  if (progress.stage === "admission" || progress.stage === "reading") return "파일 확인 중";
  if (
    progress.stage === "inspecting"
    || progress.stage === "decoding"
    || progress.stage === "transforming"
  ) return "안전한 크기로 전처리 중";
  if (progress.stage === "model") return "검증된 MediaPipe 모델 준비 중";
  if (progress.stage === "embedding") return "이미지 특징 추출 중";
  if (progress.stage === "ranking") return "프리셋 유사도 비교 중";
  return "추천 준비 완료";
}

function selectionFor(
  presetId: string,
  receipt: StudioVrmAvatarReferenceRecommendationReceipt,
): StudioVrmAvatarReferenceSelection | null {
  if (!findStudioVrmAvatarReferencePreset(presetId)) return null;
  return Object.freeze({
    presetId,
    state: createAvatarForgeState(presetId),
    receipt,
  });
}

export function StudioVrmAvatarReferenceRecommendationsPanel({
  catalogue: catalogueInput = null,
  catalogueStatus: catalogueStatusInput,
  catalogueUnavailableReason,
  disabled = false,
  previewingPresetId = null,
  runtimeSupported = supportsStudioVrmAvatarReferenceRecommendations(),
  onPreview,
  onPreviewClear,
  onApply,
  onCatalogueRetry,
  analyzeImage = analyzeStudioVrmAvatarReferenceImage,
}: StudioVrmAvatarReferenceRecommendationsPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mediaPipeConsentDescriptionId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);
  const generationRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [mediaPipeConsentGranted, setMediaPipeConsentGranted] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<StudioVrmAvatarReferenceProgress | null>(null);
  const [receipt, setReceipt] = useState<StudioVrmAvatarReferenceRecommendationReceipt | null>(null);
  const catalogue = safeCatalogue(catalogueInput);
  const catalogueStatus = catalogueStatusInput ?? (catalogue ? "ready" : "unavailable");
  const effectiveCatalogueStatus = catalogueStatus === "ready" && !catalogue
    ? "unavailable"
    : catalogueStatus;
  const available = effectiveCatalogueStatus === "ready" && Boolean(catalogue) && runtimeSupported;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  useEffect(() => {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setProgress(null);
    setReceipt(null);
    setError("");
    setFileName("");
    setMediaPipeConsentGranted(false);
  }, [catalogueInput]);

  function clearAnalysisState(): void {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setProgress(null);
    setReceipt(null);
    setError("");
    setFileName("");
    onPreviewClear?.();
  }

  function handleMediaPipeConsentChanged(event: ChangeEvent<HTMLInputElement>): void {
    const granted = event.target.checked;
    setMediaPipeConsentGranted(granted);
    if (!granted) clearAnalysisState();
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (
      !file
      || disabled
      || !available
      || !catalogue
      || !mediaPipeConsentGranted
    ) return;

    onPreviewClear?.();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    generationRef.current += 1;
    const generation = generationRef.current;
    setBusy(true);
    setFileName(file.name);
    setError("");
    setProgress(null);
    setReceipt(null);
    try {
      const nextReceipt = await analyzeImage(file, catalogue, {
        signal: controller.signal,
        topK: 3,
        onProgress: (next) => {
          if (
            !aliveRef.current
            || controller.signal.aborted
            || abortRef.current !== controller
            || generationRef.current !== generation
          ) return;
          setProgress(next);
        },
      });
      if (
        !aliveRef.current
        || controller.signal.aborted
        || abortRef.current !== controller
        || generationRef.current !== generation
      ) return;
      if (
        !isStudioVrmAvatarReferenceRecommendationReceipt(nextReceipt)
        || nextReceipt.catalogueRevision !== catalogue.catalogueRevision
        || nextReceipt.modelId !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_ID
        || nextReceipt.modelRevision !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_REVISION
        || nextReceipt.modelSha256 !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_SHA256
      ) throw new StudioVrmAvatarReferenceError("protocol");
      setReceipt(nextReceipt);
      setProgress({ generationId: generation, stage: "ready", progress: 1 });
    } catch (cause) {
      if (
        !aliveRef.current
        || controller.signal.aborted
        || abortRef.current !== controller
        || generationRef.current !== generation
      ) return;
      const failure = cause instanceof StudioVrmAvatarReferenceError
        ? cause
        : new StudioVrmAvatarReferenceError("inference-failed", { cause });
      setError(failure.message);
    } finally {
      if (
        aliveRef.current
        && abortRef.current === controller
        && generationRef.current === generation
      ) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  }

  function emitSelection(
    presetId: string,
    action: (selection: StudioVrmAvatarReferenceSelection) => void,
  ) {
    if (!receipt || disabled || busy) return;
    const selection = selectionFor(presetId, receipt);
    if (selection) action(selection);
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-card">
      <div className="border-b border-line/70 px-3.5 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-extrabold text-fg">
              <ScanSearch size={15} className="text-accent" aria-hidden />
              참고 이미지로 스타일 찾기
            </h3>
            <p className="mt-1 max-w-[34rem] text-[0.68rem] leading-relaxed text-fg-3">
              이미지 전체 특징과 프리셋 기준을 비교해 가까운 시작점을 제안합니다. 추천은 자동 적용되지 않습니다.
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-1 text-[0.58rem] font-bold text-fg-3">
            MediaPipe
          </span>
        </div>

        <div className="mt-3 flex items-start gap-2 rounded-xl bg-panel/70 p-2.5 text-[0.62rem] leading-relaxed text-fg-3">
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-good" aria-hidden />
          <p>
            JPG·PNG·WebP를 메모리의 전용 Worker에서만 분석합니다. 원본 이미지와 픽셀은 프로젝트·브라우저 저장소·서버에 남기지 않습니다.
          </p>
        </div>
      </div>

      <div className="p-3.5">
        {effectiveCatalogueStatus === "idle" || effectiveCatalogueStatus === "loading" ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-start gap-2 rounded-xl border border-line bg-panel/55 p-3 text-[0.65rem] leading-relaxed text-fg-2"
          >
            <LoaderCircle
              size={15}
              className="mt-0.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
              aria-hidden
            />
            <div>
              <p className="font-bold text-fg">검증된 추천 기준을 불러오는 중</p>
              <p className="mt-1 text-fg-3">Forge를 사용할 때만 작은 기준 파일을 확인합니다.</p>
            </div>
          </div>
        ) : effectiveCatalogueStatus === "unavailable" || !catalogue ? (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-line bg-panel/55 p-3 text-[0.65rem] leading-relaxed text-fg-2">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <div className="min-w-0 flex-1">
              <p>
                {catalogueUnavailableReason
                  ?? "검증된 프리셋 추천 기준을 사용할 수 없습니다. 스타일 탭에서 프리셋을 직접 선택해 주세요."}
              </p>
              {onCatalogueRetry ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={onCatalogueRetry}
                  className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[0.64rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
                >
                  <RotateCcw size={13} aria-hidden />
                  추천 기준 다시 불러오기
                </button>
              ) : null}
            </div>
          </div>
        ) : !runtimeSupported ? (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-line bg-panel/55 p-3 text-[0.65rem] leading-relaxed text-fg-2">
            <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
            <p>이 브라우저는 전용 이미지 Worker와 OffscreenCanvas 전처리를 지원하지 않습니다.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-line bg-panel/55 p-3">
              <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-[0.65rem] font-bold leading-relaxed text-fg-2">
                <input
                  type="checkbox"
                  checked={mediaPipeConsentGranted}
                  disabled={disabled}
                  onChange={handleMediaPipeConsentChanged}
                  aria-describedby={mediaPipeConsentDescriptionId}
                  className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
                />
                <span>MediaPipe 분석과 아래 메타데이터 처리 가능성을 확인하고 동의합니다.</span>
              </label>
              <p
                id={mediaPipeConsentDescriptionId}
                className="mt-1.5 text-[0.6rem] leading-relaxed text-fg-3"
              >
                이미지 픽셀은 이 기기의 메모리 Worker에서 처리되고 업로드되지 않습니다. Google
                MediaPipe API는 앱 식별자, 처리 매체의 일반적 특성, 추론·세션 수, 호스트 환경 같은
                이용·성능 메타데이터를 처리할 수 있습니다. 동의하지 않아도 프리셋을 직접 선택할 수
                있습니다.{" "}
                <a
                  href="https://developers.google.com/edge/mediapipe/legal/tos"
                  target="_blank"
                  rel="noreferrer"
                  className="font-bold text-accent underline underline-offset-2"
                >
                  MediaPipe API 약관
                </a>
              </p>
            </div>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={disabled || busy || !mediaPipeConsentGranted}
              onChange={handleFileSelected}
              aria-label="아바타 스타일 참고 이미지 선택"
            />
            <button
              type="button"
              disabled={disabled || busy || !mediaPipeConsentGranted}
              onClick={() => inputRef.current?.click()}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 text-[0.7rem] font-extrabold text-on-accent transition-colors hover:bg-accent-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
            >
              <ImagePlus size={16} aria-hidden />
              {busy ? "이미지 비교 중" : receipt ? "다른 이미지 비교" : "참고 이미지 선택"}
            </button>

            {busy ? (
              <div role="status" aria-live="polite" className="mt-3">
                <div className="flex items-center justify-between gap-2 text-[0.62rem] text-fg-3">
                  <span>{progressLabel(progress)}</span>
                  <span className="tabular-nums">{Math.round((progress?.progress ?? 0) * 100)}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${Math.round((progress?.progress ?? 0) * 100)}%` }}
                  />
                </div>
                {fileName ? <p className="mt-1.5 truncate text-[0.58rem] text-fg-3">{fileName}</p> : null}
              </div>
            ) : null}

            {error ? (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 p-3 text-[0.64rem] leading-relaxed text-fg-2">
                <TriangleAlert size={15} className="mt-0.5 shrink-0 text-bad" aria-hidden />
                <p>{error}</p>
              </div>
            ) : null}

            {receipt ? (
              <div className="mt-3" aria-label="추천 아바타 프리셋">
                {previewingPresetId && onPreviewClear ? (
                  <div
                    role="status"
                    className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-accent/35 bg-accent-soft p-2.5"
                  >
                    <p className="text-[0.62rem] leading-relaxed text-fg-2">
                      추천 스타일을 임시로 보고 있습니다. 아직 프로젝트와 되돌리기 기록에는 반영되지 않았습니다.
                    </p>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={onPreviewClear}
                      className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg border border-line bg-card px-2.5 text-[0.62rem] font-bold text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                    >
                      <RotateCcw size={13} aria-hidden />
                      원래대로
                    </button>
                  </div>
                ) : null}
                <div className="flex items-end justify-between gap-3 border-b border-line/70 pb-2">
                  <div>
                    <p className="text-[0.68rem] font-extrabold text-fg">가까운 프리셋</p>
                    <p className="mt-0.5 text-[0.58rem] text-fg-3">전체 이미지 특징 기준 · 인물 식별 용도 아님</p>
                  </div>
                  <span className="text-[0.58rem] tabular-nums text-fg-3">
                    기준 {receipt.cataloguePresetIds.length}개
                  </span>
                </div>
                <ol className="divide-y divide-line/60">
                  {receipt.recommendations.map((recommendation) => {
                    const preset = findStudioVrmAvatarReferencePreset(recommendation.presetId);
                    if (!preset) return null;
                    const previewState = createAvatarForgeState(recommendation.presetId);
                    const visual = describeStudioVrmAvatarForgeState(previewState);
                    return (
                      <li key={recommendation.presetId} className="py-2.5">
                        <div className="flex items-start gap-2.5">
                          <span className="block h-24 w-20 shrink-0 overflow-hidden rounded-xl border border-line bg-panel/70 px-1">
                            <StudioVrmAvatarForgePreview
                              state={previewState}
                              variant="compact"
                              showBody
                              label={`${preset.label} 추천 미리보기`}
                            />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate text-[0.68rem] font-extrabold text-fg">
                                {recommendation.rank}. {preset.label}
                              </p>
                              <span className="shrink-0 rounded-full border border-line bg-panel px-2 py-0.5 text-[0.58rem] font-bold tabular-nums text-fg-3">
                                {Math.round(recommendation.similarity * 100)}% 유사
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-[0.6rem] leading-relaxed text-fg-3">{preset.hint}</p>
                            <div className="mt-1.5 flex flex-wrap gap-1">
                              {[visual.face, visual.hair, visual.body].map((label) => (
                                <span key={label} className="rounded-full border border-line bg-panel px-1.5 py-0.5 text-[0.55rem] font-semibold text-fg-3">
                                  {label}
                                </span>
                              ))}
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-1.5">
                              <button
                                type="button"
                                disabled={disabled || busy}
                                onClick={() => emitSelection(recommendation.presetId, onPreview)}
                                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel text-[0.64rem] font-bold text-fg-2 transition-colors hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                                aria-label={`${preset.label} 프리셋 미리 보기`}
                              >
                                <Eye size={14} aria-hidden />
                                미리 보기
                              </button>
                              <button
                                type="button"
                                disabled={disabled || busy}
                                onClick={() => emitSelection(recommendation.presetId, onApply)}
                                className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-accent/45 bg-accent-soft text-[0.64rem] font-extrabold text-accent transition-colors hover:bg-accent hover:text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                                aria-label={`${preset.label} 프리셋 적용`}
                              >
                                <Check size={14} aria-hidden />
                                적용
                              </button>
                            </div>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                <details className="border-t border-line/70 pt-2 text-[0.56rem] leading-relaxed text-fg-3">
                  <summary className="min-h-8 cursor-pointer font-semibold text-fg-3">분석 기술 정보</summary>
                  <p className="mt-1 break-all">
                    {receipt.modelId} r{receipt.modelRevision} · model sha256 {receipt.modelSha256.slice(0, 12)}… · catalogue {receipt.catalogueRevision}
                  </p>
                </details>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
