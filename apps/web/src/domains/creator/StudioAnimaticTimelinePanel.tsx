import {
  AlertTriangle,
  Captions,
  Check,
  Download,
  FileUp,
  Gauge,
  MessageSquareText,
  Pause,
  Play,
  RefreshCcw,
  Repeat2,
  Trash2,
  VolumeX,
  X,
  ZoomIn,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createStudioAnimaticSqlitePersistence,
  type StudioAnimaticPersistencePort,
} from "./studio-animatic-sqlite-persistence";
import {
  addStudioAnimaticCue,
  createStudioAnimaticFromPages,
  exportStudioAnimaticDocument,
  importStudioAnimaticDocument,
  loadStudioAnimaticDocument,
  patchStudioAnimaticCue,
  planStudioAnimaticPreview,
  removeStudioAnimaticCue,
  sampleStudioAnimaticPreview,
  saveStudioAnimaticDocument,
  setStudioAnimaticCameraEndpoint,
  setStudioAnimaticFps,
  setStudioAnimaticLoop,
  setStudioAnimaticPreviewMode,
  setStudioAnimaticSegmentTiming,
  STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT,
  STUDIO_ANIMATIC_MAX_IMPORT_BYTES,
  studioAnimaticStorageKey,
  validateStudioAnimaticDocument,
  type StudioAnimaticCueKind,
  type StudioAnimaticDocument,
  type StudioAnimaticLoadResult,
  type StudioAnimaticPageLike,
  type StudioAnimaticPreviewSample,
  type StudioAnimaticSegment,
  type StudioAnimaticStorage,
  type StudioAnimaticTransitionKind,
} from "./studio-animatic-timeline";

import { cx } from "@/shared/lib/cx";

export interface StudioAnimaticTimelinePanelProps {
  readonly workScope: string;
  readonly pages: readonly StudioAnimaticPageLike[];
  readonly initialDocument?: StudioAnimaticDocument;
  /** Explicit synchronous compatibility/test seam. Product `undefined` never reads localStorage. */
  readonly storage?: StudioAnimaticStorage | null;
  /** Product default is shared V12 SQLite/OPFS; `null` deliberately selects current-tab memory. */
  readonly persistence?: StudioAnimaticPersistencePort | null;
  readonly reducedMotion?: boolean;
  readonly onDocumentChange?: (document: StudioAnimaticDocument) => void;
  readonly onPreviewSample?: (sample: StudioAnimaticPreviewSample) => void;
  readonly renderPreview?: (
    sample: StudioAnimaticPreviewSample,
    segment: StudioAnimaticSegment
  ) => ReactNode;
  readonly onClose?: () => void;
  readonly className?: string;
}

interface StudioAnimaticPanelState {
  readonly document: StudioAnimaticDocument | null;
  readonly storageStatus: StudioAnimaticLoadResult["status"];
  readonly storageError?: string;
  readonly documentError?: string;
}

interface StudioAnimaticNotice {
  readonly tone: "good" | "warn" | "bad";
  readonly message: string;
}

const FPS_OPTIONS = [6, 12, 24, 30] as const;

const TRANSITION_OPTIONS: readonly {
  readonly value: StudioAnimaticTransitionKind;
  readonly label: string;
}[] = [
  { value: "cut", label: "컷 — 즉시 전환" },
  { value: "fade", label: "페이드" },
  { value: "pan", label: "팬 이동" },
];

const fieldClass =
  "min-h-11 w-full rounded-xl border border-line bg-panel px-2.5 text-[0.7rem] text-fg outline-none transition-colors focus:border-accent disabled:cursor-not-allowed disabled:opacity-45";

function initializePanelState(input: {
  readonly storage: StudioAnimaticStorage | null;
  readonly workScope: string;
  readonly pages: readonly StudioAnimaticPageLike[];
  readonly initialDocument?: StudioAnimaticDocument;
}): StudioAnimaticPanelState {
  if (input.initialDocument) {
    const validated = validateStudioAnimaticDocument(input.initialDocument);
    if (!validated.ok) {
      return {
        document: null,
        storageStatus: "empty",
        documentError: validated.error,
      };
    }
    if (
      studioAnimaticStorageKey(validated.document.workScope)
      !== studioAnimaticStorageKey(input.workScope)
    ) {
      return {
        document: null,
        storageStatus: "empty",
        documentError: "초기 애니매틱이 다른 작품 범위에 속합니다.",
      };
    }
    return { document: validated.document, storageStatus: "empty" };
  }

  const loaded = loadStudioAnimaticDocument(input.storage, input.workScope);
  if (loaded.document) {
    return {
      document: loaded.document,
      storageStatus: loaded.status,
      storageError: loaded.error,
    };
  }
  const created = createStudioAnimaticFromPages(input.pages, {
    workScope: input.workScope,
  });
  return {
    document: created.ok ? created.document : null,
    storageStatus: loaded.status,
    storageError: loaded.error,
    documentError: created.ok ? undefined : created.error,
  };
}

function useReducedMotionOverride(override: boolean | undefined): boolean {
  const [mediaReduced, setMediaReduced] = useState(false);
  useEffect(() => {
    if (override !== undefined || typeof matchMedia !== "function") return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMediaReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [override]);
  return override ?? mediaReduced;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, durationMs) / 1_000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return minutes > 0
    ? `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`
    : `${seconds.toFixed(1)}초`;
}

function timelineCardWidth(durationMs: number): number {
  return Math.round(Math.min(240, Math.max(112, durationMs / 14)));
}

function previewOpacity(sample: StudioAnimaticPreviewSample): number {
  return sample.transitionKind === "fade" ? sample.transitionProgress : 1;
}

function previewTransitionPan(sample: StudioAnimaticPreviewSample): number {
  return sample.transitionKind === "pan"
    ? (1 - sample.transitionProgress) * 12
    : 0;
}

export function StudioAnimaticTimelinePanel({
  workScope,
  pages,
  initialDocument,
  storage,
  persistence,
  reducedMotion,
  onDocumentChange,
  onPreviewSample,
  renderPreview,
  onClose,
  className,
}: StudioAnimaticTimelinePanelProps) {
  const importInputId = useId();
  const effectiveReducedMotion = useReducedMotionOverride(reducedMotion);
  const [storageTarget] = useState<StudioAnimaticStorage | null>(() =>
    storage === undefined ? null : storage
  );
  const [persistenceTarget] = useState<StudioAnimaticPersistencePort | null>(() =>
    storage !== undefined
      ? null
      : persistence === undefined
        ? createStudioAnimaticSqlitePersistence()
        : persistence
  );
  const [panelState, setPanelState] = useState<StudioAnimaticPanelState>(() =>
    initializePanelState({
      storage: storageTarget,
      workScope,
      pages,
      initialDocument,
    })
  );
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    () => panelState.document?.segments[0]?.id ?? null
  );
  const [playheadMs, setPlayheadMs] = useState(0);
  const playheadRef = useRef(playheadMs);
  playheadRef.current = playheadMs;
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<StudioAnimaticNotice | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [persistenceBusy, setPersistenceBusy] = useState(false);
  const persistenceGenerationRef = useRef(0);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!persistenceTarget || initialDocument) return;
    let active = true;
    const generation = ++persistenceGenerationRef.current;
    setPersistenceBusy(true);
    void persistenceTarget.load(workScope).catch((error: unknown) => ({
      document: null,
      status: "unavailable" as const,
      error: `SQLite 애니매틱 읽기를 완료하지 못했습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })).then((loaded) => {
      if (!active || generation !== persistenceGenerationRef.current) return;
      if (loaded.document) {
        setPanelState({
          document: loaded.document,
          storageStatus: loaded.status,
          storageError: loaded.error,
        });
        setSelectedSegmentId(loaded.document.segments[0]?.id ?? null);
      } else {
        setPanelState((current) => ({
          ...current,
          storageStatus: loaded.status,
          storageError: loaded.error,
        }));
      }
      setPersistenceBusy(false);
    });
    return () => {
      active = false;
      if (generation === persistenceGenerationRef.current) {
        persistenceGenerationRef.current += 1;
      }
    };
  }, [initialDocument, persistenceTarget, workScope]);

  const animatic = panelState.document;
  const planned = animatic
    ? planStudioAnimaticPreview(animatic, effectiveReducedMotion)
    : null;
  const plan = planned?.ok ? planned.plan : null;
  const selectedSegment =
    animatic?.segments.find((segment) => segment.id === selectedSegmentId)
    ?? animatic?.segments[0]
    ?? null;
  const safePlayheadMs = plan
    ? Math.min(
        playheadMs,
        Math.max(0, plan.totalDurationMs - 1_000 / plan.fps)
      )
    : 0;
  const sample =
    animatic && plan
      ? sampleStudioAnimaticPreview(
          animatic,
          plan,
          safePlayheadMs,
          effectiveReducedMotion
        )
      : null;
  const activeSegment =
    sample && animatic ? animatic.segments[sample.segmentIndex] ?? null : null;
  const playbackDurationMs = plan?.totalDurationMs ?? 0;
  const playbackFps = plan?.fps ?? 1;
  const playbackLoop = animatic?.loop ?? false;

  useEffect(() => {
    if (!effectiveReducedMotion) return;
    setPlaying(false);
  }, [effectiveReducedMotion]);

  useEffect(() => {
    if (!sample) return;
    onPreviewSample?.(sample);
  }, [onPreviewSample, sample]);

  useEffect(() => {
    if (
      !playing
      || playbackDurationMs <= 0
      || effectiveReducedMotion
      || typeof globalThis.requestAnimationFrame !== "function"
    ) {
      return;
    }
    const originWall =
      typeof performance === "undefined" ? 0 : performance.now();
    const originTimeline = playheadRef.current;
    let animationFrame = 0;
    const tick = (now: number) => {
      const elapsed = originTimeline + Math.max(0, now - originWall);
      if (elapsed >= playbackDurationMs) {
        if (playbackLoop) {
          setPlayheadMs(elapsed % playbackDurationMs);
        } else {
          setPlayheadMs(
            Math.max(0, playbackDurationMs - 1_000 / playbackFps)
          );
          setPlaying(false);
          return;
        }
      } else {
        setPlayheadMs(elapsed);
      }
      animationFrame = globalThis.requestAnimationFrame(tick);
    };
    animationFrame = globalThis.requestAnimationFrame(tick);
    return () => globalThis.cancelAnimationFrame?.(animationFrame);
  }, [
    effectiveReducedMotion,
    playbackDurationMs,
    playbackFps,
    playbackLoop,
    playing,
  ]);

  function commitDocument(
    document: StudioAnimaticDocument,
    successMessage: string
  ): void {
    if (persistenceTarget) {
      const generation = ++persistenceGenerationRef.current;
      setPanelState({ document, storageStatus: "ok" });
      onDocumentChange?.(document);
      setPersistenceBusy(true);
      setNotice({ tone: "good", message: `${successMessage} 로컬 SQL에 저장 중…` });
      const write = persistenceQueueRef.current.then(async () => {
        try {
          return await persistenceTarget.save(document);
        } catch (error) {
          return {
            ok: false,
            error: `SQLite 애니매틱 저장을 완료하지 못했습니다: ${
              error instanceof Error ? error.message : String(error)
            }`,
          };
        }
      });
      persistenceQueueRef.current = write.then(() => undefined, () => undefined);
      void write.then((saved) => {
        if (generation !== persistenceGenerationRef.current) return;
        setPersistenceBusy(false);
        setPanelState({
          document,
          storageStatus: saved.ok ? "ok" : "unavailable",
          storageError: saved.error,
        });
        setNotice({
          tone: saved.ok ? "good" : "warn",
          message: saved.ok
            ? successMessage
            : `${successMessage} ${saved.error ?? "현재 탭에서만 유지됩니다."}`,
        });
      });
      return;
    }
    const saved = saveStudioAnimaticDocument(storageTarget, document);
    setPanelState({
      document,
      storageStatus: saved.ok ? "ok" : "unavailable",
      storageError: saved.error,
    });
    onDocumentChange?.(document);
    setNotice({
      tone: saved.ok ? "good" : "warn",
      message: saved.ok
        ? successMessage
        : `${successMessage} ${saved.error ?? "현재 탭에서만 유지됩니다."}`,
    });
  }

  function updateDocument(
    updater: (document: StudioAnimaticDocument) => StudioAnimaticDocument,
    successMessage: string
  ): void {
    if (!animatic) return;
    const next = updater(animatic);
    if (next === animatic) {
      setNotice({
        tone: "warn",
        message: "길이·프레임·항목 예산을 넘는 변경은 적용하지 않았습니다.",
      });
      return;
    }
    commitDocument(next, successMessage);
  }

  function resetFromPages(): void {
    const created = createStudioAnimaticFromPages(pages, { workScope });
    if (!created.ok) {
      setNotice({ tone: "bad", message: created.error });
      return;
    }
    setSelectedSegmentId(created.document.segments[0]?.id ?? null);
    setPlayheadMs(0);
    setPlaying(false);
    commitDocument(
      created.document,
      "현재 페이지·컷 순서로 애니매틱을 다시 구성했습니다."
    );
  }

  function scrub(nextMs: number): void {
    setPlaying(false);
    setPlayheadMs(
      plan ? Math.min(plan.totalDurationMs, Math.max(0, nextMs)) : 0
    );
  }

  function selectAndScrub(segmentId: string): void {
    setSelectedSegmentId(segmentId);
    const segmentPlan = plan?.segments.find(
      (segment) => segment.segmentId === segmentId
    );
    if (segmentPlan) scrub(segmentPlan.startMs);
  }

  async function importFile(file: File): Promise<void> {
    if (file.size > STUDIO_ANIMATIC_MAX_IMPORT_BYTES) {
      setNotice({
        tone: "bad",
        message: `가져오기 파일은 ${(STUDIO_ANIMATIC_MAX_IMPORT_BYTES / 1_000).toFixed(0)}KB 이하여야 합니다.`,
      });
      return;
    }
    setImportBusy(true);
    try {
      const imported = importStudioAnimaticDocument(await file.text());
      if (!imported.ok) {
        setNotice({ tone: "bad", message: imported.error });
        return;
      }
      if (
        studioAnimaticStorageKey(imported.document.workScope)
        !== studioAnimaticStorageKey(workScope)
      ) {
        setNotice({
          tone: "bad",
          message: "다른 작품 범위의 애니매틱은 이 타임라인에 가져올 수 없습니다.",
        });
        return;
      }
      setSelectedSegmentId(imported.document.segments[0]?.id ?? null);
      setPlayheadMs(0);
      setPlaying(false);
      commitDocument(imported.document, "애니매틱 JSON을 가져왔습니다.");
    } catch {
      setNotice({ tone: "bad", message: "애니매틱 파일을 읽지 못했습니다." });
    } finally {
      setImportBusy(false);
    }
  }

  function downloadExport(): void {
    if (!animatic) return;
    const exported = exportStudioAnimaticDocument(animatic);
    if (!exported.ok) {
      setNotice({ tone: "bad", message: exported.error });
      return;
    }
    if (
      typeof URL.createObjectURL !== "function"
      || typeof document === "undefined"
    ) {
      setNotice({
        tone: "warn",
        message: "이 브라우저에서는 JSON 다운로드를 시작할 수 없습니다.",
      });
      return;
    }
    const url = URL.createObjectURL(
      new Blob([exported.json], { type: "application/json" })
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "toonspectrum-animatic-v1.json";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice({
      tone: "good",
      message: `${(exported.bytes / 1_000).toFixed(1)}KB 애니매틱 JSON을 내보냈습니다.`,
    });
  }

  const storageUnavailable = panelState.storageStatus === "unavailable"
    || (storageTarget === null && persistenceTarget === null);

  return (
    <section
      aria-label="웹툰 애니매틱 타임라인"
      data-studio-animatic="local-only"
      data-studio-animatic-authority={
        persistenceTarget ? "sqlite" : storageTarget ? "sync-adapter" : "memory"
      }
      aria-busy={importBusy || persistenceBusy}
      className={cx(
        "flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-panel/95 shadow-xl backdrop-blur",
        className
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-line/70 px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-fg">
            <Play size={15} className="text-accent" aria-hidden />
            웹툰 애니매틱
          </h2>
          <p className="mt-0.5 text-[0.63rem] leading-relaxed text-fg-3">
            페이지·컷의 무음 타이밍과 카메라 동선을 브라우저에서 검수합니다.
          </p>
        </div>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="웹툰 애니매틱 닫기"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line text-fg-2 transition-colors hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={15} aria-hidden />
          </button>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <div
          className={cx(
            "rounded-xl border px-2.5 py-2 text-[0.65rem] leading-relaxed",
            storageUnavailable
              ? "border-warn/35 bg-warn/10 text-warn"
              : panelState.storageStatus === "invalid"
                ? "border-bad/35 bg-bad/10 text-bad"
                : "border-line bg-card/60 text-fg-3"
          )}
        >
          <p className="flex items-center gap-1 font-semibold">
            <VolumeX size={12} aria-hidden />
            {storageUnavailable
              ? "현재 탭의 무음 미리보기"
              : persistenceTarget
                ? "로컬 SQL 무음 미리보기"
                : "브라우저 로컬 무음 미리보기"}
          </p>
          <p className="mt-0.5">
            음성통화·서버 스트리밍·AI 요청 없이 타이밍 메타데이터만
            처리합니다. 서버·팀원·다른 기기에는 자동 동기화하지 않습니다.
          </p>
          {panelState.storageError ? (
            <p className="mt-1">{panelState.storageError}</p>
          ) : null}
        </div>

        {effectiveReducedMotion ? (
          <p
            role="status"
            className="flex items-start gap-1.5 rounded-xl border border-warn/35 bg-warn/10 px-2.5 py-2 text-[0.65rem] leading-relaxed text-warn"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            시스템의 동작 줄이기 설정을 따라 자동 재생·전환·카메라 보간을
            끕니다. 타임라인을 직접 스크럽해 컷별 정지 화면을 확인하세요.
          </p>
        ) : null}

        {panelState.documentError ? (
          <p
            role="alert"
            className="rounded-xl border border-bad/35 bg-bad/10 px-2.5 py-2 text-[0.67rem] leading-relaxed text-bad"
          >
            {panelState.documentError}
          </p>
        ) : null}

        {animatic && plan ? (
          <>
            <section
              aria-label="애니매틱 미리보기"
              data-studio-animatic-preview={animatic.previewMode}
              data-reduced-motion={
                effectiveReducedMotion ? "true" : "false"
              }
              className="overflow-hidden rounded-2xl border border-line bg-canvas"
            >
              <div className="relative aspect-[9/16] max-h-72 min-h-48 overflow-hidden bg-card">
                {sample && activeSegment ? (
                  <div
                    className="absolute inset-0 grid place-items-center p-5"
                    style={{
                      opacity: previewOpacity(sample),
                      transform: `translate(${sample.camera.panXPercent + previewTransitionPan(sample)}%, ${sample.camera.panYPercent}%) scale(${sample.camera.zoom})`,
                      transformOrigin: "center",
                    }}
                  >
                    {renderPreview ? (
                      renderPreview(sample, activeSegment)
                    ) : (
                      <div className="grid h-full w-full place-items-center rounded-xl border border-line bg-panel/80 p-5 text-center shadow-inner">
                        <div>
                          <p className="text-xs font-bold text-fg">
                            {activeSegment.label}
                          </p>
                          <p className="mt-1 text-[0.65rem] text-fg-3">
                            {activeSegment.cutId
                              ? `컷 ${activeSegment.cutId}`
                              : "페이지 전체"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid h-full place-items-center text-xs text-fg-3">
                    미리 볼 페이지·컷이 없습니다.
                  </div>
                )}
                {sample ? (
                  <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-between gap-1 rounded-lg bg-panel/85 px-2 py-1 text-[0.6rem] tabular-nums text-fg-2 backdrop-blur">
                    <span>
                      {sample.transitionKind} · 줌{" "}
                      {sample.camera.zoom.toFixed(2)}×
                    </span>
                    <span>스크롤 Y {Math.round(sample.scrollY)}px</span>
                  </div>
                ) : null}
              </div>
            </section>

            <section
              aria-label="애니매틱 재생 제어"
              className="space-y-2 rounded-xl border border-line bg-card/45 p-2.5"
            >
              <div className="grid grid-cols-[2.75rem_2.75rem_1fr] items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPlaying((value) => !value)}
                  disabled={
                    effectiveReducedMotion || plan.totalDurationMs <= 0
                  }
                  aria-label={playing ? "애니매틱 일시 정지" : "애니매틱 재생"}
                  className="grid size-11 place-items-center rounded-xl bg-accent text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {playing ? (
                    <Pause size={15} aria-hidden />
                  ) : (
                    <Play size={15} aria-hidden />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateDocument(
                      (current) =>
                        setStudioAnimaticLoop(current, !current.loop),
                      animatic.loop
                        ? "반복 재생을 껐습니다."
                        : "반복 재생을 켰습니다."
                    )
                  }
                  aria-label="애니매틱 반복 재생"
                  aria-pressed={animatic.loop}
                  className={cx(
                    "grid size-11 place-items-center rounded-xl border transition-colors",
                    animatic.loop
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel text-fg-2 hover:bg-raised"
                  )}
                >
                  <Repeat2 size={15} aria-hidden />
                </button>
                <div className="min-w-0">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0, plan.totalDurationMs)}
                    step={Math.max(1, Math.round(1_000 / plan.fps))}
                    value={safePlayheadMs}
                    onChange={(event) => scrub(Number(event.target.value))}
                    aria-label="애니매틱 재생헤드"
                    className="h-11 w-full cursor-ew-resize accent-accent"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[0.63rem] tabular-nums text-fg-3">
                <span>
                  {formatDuration(safePlayheadMs)} /{" "}
                  {formatDuration(plan.totalDurationMs)}
                </span>
                <span>
                  {plan.frameCount.toLocaleString("ko-KR")}프레임 ·{" "}
                  {plan.fps}fps
                </span>
              </div>
            </section>

            <section aria-label="모바일 가로 스크롤 애니매틱 타임라인">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-[0.68rem] font-semibold text-fg">
                  페이지·컷 타임라인
                </p>
                <span className="text-[0.6rem] text-fg-4">
                  좌우로 밀어 탐색
                </span>
              </div>
              <div
                data-studio-animatic-horizontal-timeline="true"
                className="touch-pan-x snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-xl border border-line bg-card/45 p-2"
              >
                <div className="flex min-w-max gap-2">
                  {animatic.segments.map((segment, index) => {
                    const segmentPlan = plan.segments[index];
                    const active = sample?.segmentId === segment.id;
                    const selected = selectedSegment?.id === segment.id;
                    const durationMs =
                      segment.holdMs + segment.transition.durationMs;
                    return (
                      <button
                        key={segment.id}
                        type="button"
                        onClick={() => selectAndScrub(segment.id)}
                        aria-pressed={selected}
                        aria-label={`${segment.label} 선택하고 스크럽`}
                        className={cx(
                          "relative min-h-[5.5rem] shrink-0 snap-start overflow-hidden rounded-xl border p-2 text-left transition-colors",
                          selected
                            ? "border-accent bg-accent-soft"
                            : active
                              ? "border-good/40 bg-good/10"
                              : "border-line bg-panel hover:bg-raised"
                        )}
                        style={{ width: timelineCardWidth(durationMs) }}
                      >
                        <span className="block truncate text-[0.68rem] font-semibold text-fg">
                          {segment.label}
                        </span>
                        <span className="mt-1 block text-[0.6rem] tabular-nums text-fg-3">
                          {formatDuration(durationMs)} ·{" "}
                          {segment.transition.kind}
                        </span>
                        <span className="mt-1 block text-[0.58rem] text-fg-4">
                          cue {segment.cues.length}개 ·{" "}
                          {segmentPlan
                            ? `${segmentPlan.startFrame + 1}–${segmentPlan.endFrame + 1}f`
                            : "예산 초과"}
                        </span>
                        {segment.cues.map((cue) => (
                          <span
                            key={cue.id}
                            aria-hidden
                            className={cx(
                              "absolute bottom-0 h-1.5 w-1 rounded-t",
                              cue.kind === "dialogue"
                                ? "bg-accent"
                                : "bg-warn"
                            )}
                            style={{
                              left: `${Math.min(
                                100,
                                Math.max(0, (cue.offsetMs / durationMs) * 100)
                              )}%`,
                            }}
                          />
                        ))}
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

            <section
              aria-label="애니매틱 전체 설정"
              className="grid gap-2 rounded-xl border border-line bg-card/45 p-2.5 sm:grid-cols-2"
            >
              <label className="space-y-1 text-[0.66rem] font-medium text-fg-3">
                미리보기 FPS
                <select
                  value={animatic.fps}
                  onChange={(event) =>
                    updateDocument(
                      (current) =>
                        setStudioAnimaticFps(
                          current,
                          Number(event.target.value)
                        ),
                      "미리보기 FPS를 변경했습니다."
                    )
                  }
                  className={fieldClass}
                >
                  {!FPS_OPTIONS.includes(
                    animatic.fps as (typeof FPS_OPTIONS)[number]
                  ) ? (
                    <option value={animatic.fps}>{animatic.fps}fps</option>
                  ) : null}
                  {FPS_OPTIONS.map((fps) => (
                    <option key={fps} value={fps}>
                      {fps}fps
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-[0.66rem] font-medium text-fg-3">
                미리보기 방식
                <select
                  value={animatic.previewMode}
                  onChange={(event) =>
                    updateDocument(
                      (current) =>
                        setStudioAnimaticPreviewMode(
                          current,
                          event.target.value as "cuts" | "vertical-scroll"
                        ),
                      "미리보기 방식을 변경했습니다."
                    )
                  }
                  className={fieldClass}
                >
                  <option value="cuts">컷 전환</option>
                  <option value="vertical-scroll">세로 스크롤</option>
                </select>
              </label>
              <div className="rounded-xl border border-line bg-panel px-2.5 py-2 text-[0.63rem] leading-relaxed text-fg-3 sm:col-span-2">
                <p className="flex items-center gap-1 font-semibold text-fg-2">
                  <Gauge size={12} aria-hidden />
                  예산
                </p>
                <p className="mt-0.5">
                  남은 길이 {formatDuration(plan.remainingDurationMs)} · 남은
                  프레임 {plan.remainingFrames.toLocaleString("ko-KR")}개
                </p>
              </div>
            </section>

            {selectedSegment ? (
              <section
                aria-label="선택한 애니매틱 컷 설정"
                className="space-y-3 rounded-xl border border-line bg-card/45 p-2.5"
              >
                <div>
                  <p className="truncate text-[0.72rem] font-bold text-fg">
                    {selectedSegment.label}
                  </p>
                  <p className="mt-0.5 text-[0.6rem] text-fg-4">
                    {selectedSegment.pageId}
                    {selectedSegment.cutId
                      ? ` · ${selectedSegment.cutId}`
                      : " · 페이지 전체"}
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1 text-[0.66rem] font-medium text-fg-3">
                    Hold (ms)
                    <input
                      type="number"
                      min={250}
                      max={30_000}
                      step={50}
                      value={selectedSegment.holdMs}
                      aria-label="선택 컷 hold 밀리초"
                      onChange={(event) =>
                        updateDocument(
                          (current) =>
                            setStudioAnimaticSegmentTiming(
                              current,
                              selectedSegment.id,
                              { holdMs: Number(event.target.value) }
                            ),
                          "컷 hold 시간을 변경했습니다."
                        )
                      }
                      className={fieldClass}
                    />
                  </label>
                  <label className="space-y-1 text-[0.66rem] font-medium text-fg-3">
                    전환
                    <select
                      value={selectedSegment.transition.kind}
                      aria-label="선택 컷 전환"
                      onChange={(event) =>
                        updateDocument(
                          (current) =>
                            setStudioAnimaticSegmentTiming(
                              current,
                              selectedSegment.id,
                              {
                                transitionKind: event.target
                                  .value as StudioAnimaticTransitionKind,
                              }
                            ),
                          "컷 전환을 변경했습니다."
                        )
                      }
                      className={fieldClass}
                    >
                      {TRANSITION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[0.66rem] font-medium text-fg-3">
                    전환 길이 (ms)
                    <input
                      type="number"
                      min={100}
                      max={5_000}
                      step={50}
                      value={selectedSegment.transition.durationMs}
                      disabled={selectedSegment.transition.kind === "cut"}
                      aria-label="선택 컷 전환 밀리초"
                      onChange={(event) =>
                        updateDocument(
                          (current) =>
                            setStudioAnimaticSegmentTiming(
                              current,
                              selectedSegment.id,
                              {
                                transitionDurationMs: Number(
                                  event.target.value
                                ),
                              }
                            ),
                          "컷 전환 길이를 변경했습니다."
                        )
                      }
                      className={fieldClass}
                    />
                  </label>
                </div>

                <div className="space-y-2 border-t border-line/60 pt-3">
                  <p className="flex items-center gap-1 text-[0.68rem] font-semibold text-fg">
                    <ZoomIn size={12} aria-hidden />
                    카메라 시작·끝 키프레임
                  </p>
                  {(["start", "end"] as const).map((endpoint) => {
                    const keyframe =
                      endpoint === "start"
                        ? selectedSegment.cameraKeyframes[0]
                        : selectedSegment.cameraKeyframes.at(-1);
                    if (!keyframe) return null;
                    return (
                      <fieldset
                        key={endpoint}
                        className="grid gap-2 rounded-xl border border-line bg-panel/65 p-2 sm:grid-cols-3"
                      >
                        <legend className="px-1 text-[0.62rem] font-semibold text-fg-3">
                          {endpoint === "start" ? "시작" : "끝"}
                        </legend>
                        {(
                          [
                            ["panXPercent", "Pan X (%)", -100, 100, 1],
                            ["panYPercent", "Pan Y (%)", -100, 100, 1],
                            ["zoom", "Zoom (×)", 0.25, 4, 0.05],
                          ] as const
                        ).map(([field, label, min, max, step]) => (
                          <label
                            key={field}
                            className="space-y-1 text-[0.62rem] text-fg-3"
                          >
                            {label}
                            <input
                              type="number"
                              min={min}
                              max={max}
                              step={step}
                              value={keyframe[field]}
                              aria-label={`${endpoint === "start" ? "시작" : "끝"} 카메라 ${label}`}
                              onChange={(event) =>
                                updateDocument(
                                  (current) =>
                                    setStudioAnimaticCameraEndpoint(
                                      current,
                                      selectedSegment.id,
                                      endpoint,
                                      {
                                        [field]: Number(event.target.value),
                                      }
                                    ),
                                  "카메라 키프레임을 변경했습니다."
                                )
                              }
                              className={fieldClass}
                            />
                          </label>
                        ))}
                      </fieldset>
                    );
                  })}
                </div>

                <div className="space-y-2 border-t border-line/60 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-1 text-[0.68rem] font-semibold text-fg">
                      <Captions size={12} aria-hidden />
                      대사·효과음 cue ({selectedSegment.cues.length}/
                      {STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT})
                    </p>
                    <div className="flex gap-1.5">
                      {(
                        [
                          ["dialogue", "대사 cue 추가"],
                          ["sfx", "효과음 cue 추가"],
                        ] as const
                      ).map(([kind, label]) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() =>
                            updateDocument(
                              (current) =>
                                addStudioAnimaticCue(
                                  current,
                                  selectedSegment.id,
                                  kind
                                ),
                              `${label} 완료.`
                            )
                          }
                          disabled={
                            selectedSegment.cues.length
                            >= STUDIO_ANIMATIC_MAX_CUES_PER_SEGMENT
                          }
                          className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-panel px-2.5 text-[0.65rem] font-medium text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {kind === "dialogue" ? (
                            <MessageSquareText size={12} aria-hidden />
                          ) : (
                            <VolumeX size={12} aria-hidden />
                          )}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {selectedSegment.cues.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-2.5 py-3 text-center text-[0.64rem] text-fg-4">
                      cue는 소리를 재생하지 않고 타이밍 메타데이터만 표시합니다.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selectedSegment.cues.map((cue) => (
                        <li
                          key={cue.id}
                          className="grid gap-2 rounded-xl border border-line bg-panel/65 p-2 sm:grid-cols-[7rem_7rem_1fr_2.75rem]"
                        >
                          <select
                            value={cue.kind}
                            aria-label={`${cue.id} cue 종류`}
                            onChange={(event) =>
                              updateDocument(
                                (current) =>
                                  patchStudioAnimaticCue(
                                    current,
                                    selectedSegment.id,
                                    cue.id,
                                    {
                                      kind: event.target
                                        .value as StudioAnimaticCueKind,
                                    }
                                  ),
                                "cue 종류를 변경했습니다."
                              )
                            }
                            className={fieldClass}
                          >
                            <option value="dialogue">대사</option>
                            <option value="sfx">효과음</option>
                          </select>
                          <input
                            type="number"
                            min={0}
                            max={
                              selectedSegment.holdMs
                              + selectedSegment.transition.durationMs
                            }
                            step={50}
                            value={cue.offsetMs}
                            aria-label={`${cue.id} cue 밀리초`}
                            onChange={(event) =>
                              updateDocument(
                                (current) =>
                                  patchStudioAnimaticCue(
                                    current,
                                    selectedSegment.id,
                                    cue.id,
                                    { offsetMs: Number(event.target.value) }
                                  ),
                                "cue 타이밍을 변경했습니다."
                              )
                            }
                            className={fieldClass}
                          />
                          <input
                            type="text"
                            value={cue.text}
                            aria-label={`${cue.id} cue 내용`}
                            onChange={(event) =>
                              updateDocument(
                                (current) =>
                                  patchStudioAnimaticCue(
                                    current,
                                    selectedSegment.id,
                                    cue.id,
                                    { text: event.target.value }
                                  ),
                                "cue 내용을 변경했습니다."
                              )
                            }
                            className={fieldClass}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateDocument(
                                (current) =>
                                  removeStudioAnimaticCue(
                                    current,
                                    selectedSegment.id,
                                    cue.id
                                  ),
                                "cue를 삭제했습니다."
                              )
                            }
                            aria-label={`${cue.id} cue 삭제`}
                            className="grid size-11 place-items-center rounded-xl border border-bad/30 bg-bad/5 text-bad transition-colors hover:bg-bad/10"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                          {cue.kind === "dialogue" ? (
                            <input
                              type="text"
                              value={cue.speaker ?? ""}
                              placeholder="화자 (선택)"
                              aria-label={`${cue.id} cue 화자`}
                              onChange={(event) =>
                                updateDocument(
                                  (current) =>
                                    patchStudioAnimaticCue(
                                      current,
                                      selectedSegment.id,
                                      cue.id,
                                      { speaker: event.target.value }
                                    ),
                                  "대사 cue 화자를 변경했습니다."
                                )
                              }
                              className={cx(fieldClass, "sm:col-span-3")}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {notice ? (
          <p
            role={notice.tone === "bad" ? "alert" : "status"}
            className={cx(
              "rounded-xl border px-2.5 py-2 text-[0.65rem] leading-relaxed",
              notice.tone === "good"
                ? "border-good/35 bg-good/10 text-good"
                : notice.tone === "bad"
                  ? "border-bad/35 bg-bad/10 text-bad"
                  : "border-warn/35 bg-warn/10 text-warn"
            )}
          >
            {notice.message}
          </p>
        ) : null}
      </div>

      <footer className="border-t border-line/70 bg-card/40 px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={resetFromPages}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-panel px-2.5 text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised"
          >
            <RefreshCcw size={12} aria-hidden />
            페이지·컷 다시 불러오기
          </button>
          <div className="flex flex-wrap gap-1.5">
            <input
              id={importInputId}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void importFile(file);
              }}
            />
            <label
              htmlFor={importInputId}
              aria-disabled={importBusy}
              className={cx(
                "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-xl border border-line bg-panel px-2.5 text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised",
                importBusy && "pointer-events-none opacity-50"
              )}
            >
              <FileUp size={12} aria-hidden />
              {importBusy ? "가져오는 중…" : "JSON 가져오기"}
            </label>
            <button
              type="button"
              onClick={downloadExport}
              disabled={!animatic}
              className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-panel px-2.5 text-[0.66rem] font-medium text-fg-2 transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Download size={12} aria-hidden />
              JSON 내보내기
            </button>
          </div>
        </div>
        <p className="mt-1.5 flex items-center gap-1 text-[0.58rem] leading-relaxed text-fg-4">
          <Check size={10} aria-hidden />
          편집 결정과 cue만 저장하며 이미지·음성·영상 데이터는 복제하지 않습니다.
        </p>
      </footer>
    </section>
  );
}
