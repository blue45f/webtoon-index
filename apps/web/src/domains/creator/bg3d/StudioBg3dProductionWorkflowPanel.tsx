import {
  BrainCircuit,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Download,
  Eye,
  EyeOff,
  Layers,
  Loader2,
  Palette,
  Save,
  TriangleAlert,
  User,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import { resolveStudioBg3dProductionBatchPreset } from "./studio-bg3d-production-multipass";
import { resolveStudioBg3dProductionBatchPresetForLook } from "./studio-bg3d-production-pass-readiness";
import {
  planStudioBg3dProductionWorkflow,
  type StudioBg3dProductionWorkflowActionKind,
  type StudioBg3dProductionWorkflowStageId,
  type StudioBg3dProductionWorkflowStageStatus,
} from "./studio-bg3d-production-workflow";

export interface StudioBg3dProductionWorkflowPanelProps {
  readonly variant?: "director" | "export";
  readonly defaultExpanded?: boolean;
}

const PROGRESS_STAGE_LABELS = Object.freeze({
  render: "렌더",
  contact: "콘택트 시트",
  archive: "패키지",
} as const);

function stageTone(status: StudioBg3dProductionWorkflowStageStatus): string {
  switch (status) {
    case "ready":
      return "border-good/45 bg-good/8 text-good";
    case "working":
      return "border-accent/45 bg-accent-soft text-accent";
    case "attention":
      return "border-warn/45 bg-warn/8 text-warn";
    case "blocked":
      return "border-bad/45 bg-bad/8 text-bad";
    case "optional":
      return "border-line bg-panel/65 text-fg-3";
  }
}

function stageStatusLabel(status: StudioBg3dProductionWorkflowStageStatus): string {
  switch (status) {
    case "ready":
      return "준비됨";
    case "working":
      return "진행 중";
    case "attention":
      return "확인 필요";
    case "blocked":
      return "막힘";
    case "optional":
      return "선택";
  }
}

function StageIcon({ id }: { readonly id: StudioBg3dProductionWorkflowStageId }) {
  switch (id) {
    case "scene":
      return <Layers className="size-3.5" aria-hidden />;
    case "subject":
      return <User className="size-3.5" aria-hidden />;
    case "shot":
      return <Camera className="size-3.5" aria-hidden />;
    case "look":
      return <Palette className="size-3.5" aria-hidden />;
    case "output":
      return <Download className="size-3.5" aria-hidden />;
  }
}

function actionUnavailable(
  kind: StudioBg3dProductionWorkflowActionKind,
  runtime: NonNullable<ReturnType<typeof useStudioBg3dProSuiteRuntime>>,
): boolean {
  const batch = runtime.productionBatch;
  switch (kind) {
    case "capture-shot":
      return false;
    case "select-all-shots":
    case "apply-manuscript-preset":
    case "start-export":
      return batch === undefined;
    case "enable-line-preview":
      return runtime.onSetLineArtPreview === undefined;
    case "none":
      return true;
  }
}

export function StudioBg3dProductionWorkflowPanel({
  variant = "director",
  defaultExpanded = variant === "director",
}: StudioBg3dProductionWorkflowPanelProps) {
  const runtime = useStudioBg3dProSuiteRuntime();
  const titleId = useId();
  const bodyId = useId();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [localBusy, setLocalBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const plan = useMemo(() => {
    if (!runtime) return null;
    const batch = runtime.productionBatch;
    return planStudioBg3dProductionWorkflow({
      sceneSummary: runtime.sceneSummary,
      shotCount: runtime.productionShots.length,
      ...(batch
        ? {
            batch: {
              selectedShotCount: batch.selectedShotIds.length,
              availablePassCount: batch.availablePasses.length,
              selectedPassCount: batch.selectedPasses.length,
              recoveryReady: batch.recoveryReady,
              blockedReason: batch.blockedReason,
              isRendering: batch.isRendering,
            },
          }
        : {}),
      canToggleLineArtPreview: runtime.onSetLineArtPreview !== undefined,
    });
  }, [runtime]);

  if (!runtime || !plan || !runtime.sceneSummary) return null;

  const batch = runtime.productionBatch;
  const scene = runtime.sceneSummary;
  const activeStageId =
    plan.stages.find(
      (stage) => stage.status === "blocked" || stage.status === "attention" || stage.status === "working",
    )?.id ?? "output";
  const primaryDisabled =
    runtime.disabled ||
    localBusy ||
    actionUnavailable(plan.nextAction.kind, runtime);
  const suppressDuplicateExportAction =
    variant === "export" && plan.nextAction.kind === "start-export";

  const runAction = async (kind: StudioBg3dProductionWorkflowActionKind) => {
    if (runtime.disabled || localBusy) return;
    setActionError(null);

    try {
      switch (kind) {
        case "capture-shot":
          runtime.onCaptureCurrentShot();
          return;
        case "select-all-shots":
          batch?.selectAllShots();
          return;
        case "apply-manuscript-preset":
          if (!batch) return;
          batch.setSelectedPasses(
            batch.look
              ? resolveStudioBg3dProductionBatchPresetForLook(
                  batch.availablePasses,
                  "manuscript",
                  batch.look,
                )
              : resolveStudioBg3dProductionBatchPreset(
                  batch.availablePasses,
                  "manuscript",
                ),
          );
          return;
        case "enable-line-preview":
          runtime.onSetLineArtPreview?.(true);
          return;
        case "start-export":
          if (!batch) return;
          setLocalBusy(true);
          await batch.startExport();
          return;
        case "none":
          return;
      }
    } catch (error) {
      setActionError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "3D 제작 작업을 완료하지 못했습니다. 장면 상태를 확인한 뒤 다시 시도하세요.",
      );
    } finally {
      setLocalBusy(false);
    }
  };

  const runPrimaryAction = () => {
    void runAction(plan.nextAction.kind);
  };

  return (
    <section
      aria-labelledby={titleId}
      className={`mx-3 mt-3 overflow-hidden rounded-2xl border shadow-sm ${
        plan.blockingReason
          ? "border-bad/35 bg-bad/5"
          : "border-accent/30 bg-card/80"
      }`}
      data-testid={`studio-bg3d-production-workflow-${variant}`}
    >
      <header className="flex items-start gap-2.5 p-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/35 bg-accent-soft text-accent">
          <Clapperboard className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id={titleId} className="text-[0.74rem] font-bold text-fg">
              3D 제작 흐름
            </h3>
            <span className="rounded-full border border-line bg-panel px-1.5 py-0.5 text-[0.54rem] font-semibold text-fg-3">
              실제 장면 연동
            </span>
            <span className="rounded-full border border-accent/30 bg-accent-soft px-1.5 py-0.5 text-[0.54rem] font-bold text-accent">
              준비도 {plan.progressPercent}%
            </span>
          </div>
          <p className="mt-1 text-[0.6rem] leading-relaxed text-fg-3">
            장면 → 캐릭터·포즈 → 카메라·컷 → 룩·선화 → 출력·2D 전달을 같은 문서 상태로 연결합니다.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={expanded ? "3D 제작 흐름 접기" : "3D 제작 흐름 펼치기"}
          onClick={() => setExpanded((current) => !current)}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-panel text-fg-3 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          {expanded ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </button>
      </header>

      <div className="px-3 pb-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div
            className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none"
            style={{ width: `${plan.progressPercent}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[0.6rem] leading-relaxed text-fg-2">
            <strong className="text-fg">다음 작업 · {plan.nextAction.label}</strong>
            <span className="ml-1 text-fg-3">{plan.nextAction.description}</span>
          </p>
          {suppressDuplicateExportAction ? (
            <span className="rounded-lg border border-good/40 bg-good/10 px-2 py-1.5 text-[0.58rem] font-bold text-good">
              출력 준비 완료 · 아래에서 패키지 확인
            </span>
          ) : (
            <button
              type="button"
              disabled={primaryDisabled}
              aria-busy={localBusy || batch?.isRendering || false}
              onClick={runPrimaryAction}
              className="flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 text-[0.62rem] font-bold text-on-accent shadow-sm hover:brightness-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {localBusy || batch?.isRendering ? (
                <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              ) : plan.nextAction.kind === "capture-shot" ? (
                <Save className="size-3.5" aria-hidden />
              ) : plan.nextAction.kind === "start-export" ? (
                <Download className="size-3.5" aria-hidden />
              ) : (
                <CheckCircle2 className="size-3.5" aria-hidden />
              )}
              {plan.nextAction.label}
            </button>
          )}
        </div>
      </div>

      {expanded ? (
        <div id={bodyId} className="border-t border-line/70 p-3">
          <ol className="grid grid-cols-1 gap-1.5 min-[390px]:grid-cols-5" aria-label="3D 제작 단계">
            {plan.stages.map((stage, index) => (
              <li
                key={stage.id}
                aria-current={stage.id === activeStageId ? "step" : undefined}
                className={`min-w-0 rounded-xl border p-2 ${stageTone(stage.status)}`}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="flex min-w-0 items-center gap-1 font-bold">
                    <StageIcon id={stage.id} />
                    <span className="truncate text-[0.58rem]">{index + 1}. {stage.label}</span>
                  </span>
                  <span className="shrink-0 text-[0.5rem] font-semibold">
                    {stageStatusLabel(stage.status)}
                  </span>
                </div>
                <p className="mt-1 truncate text-[0.56rem] font-bold">{stage.summary}</p>
                <p className="mt-0.5 line-clamp-2 text-[0.51rem] leading-relaxed opacity-85">
                  {stage.detail}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-3 grid gap-2 min-[420px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-xl border border-line bg-panel/65 p-2.5" aria-label="제작 빠른 작업">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.62rem] font-bold text-fg-2">빠른 작업</span>
                <span className="text-[0.52rem] text-fg-3">
                  {runtime.productionShots.length}컷 · {batch?.selectedPasses.length ?? 0}패스
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  disabled={runtime.disabled}
                  onClick={() => void runAction("capture-shot")}
                  className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.57rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"
                >
                  <Save className="size-3" aria-hidden />
                  현재 컷 저장
                </button>
                <button
                  type="button"
                  disabled={
                    runtime.disabled ||
                    !batch ||
                    runtime.productionShots.length === 0 ||
                    batch.selectedShotIds.length === runtime.productionShots.length
                  }
                  onClick={() => void runAction("select-all-shots")}
                  className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.57rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"
                >
                  <Layers className="size-3" aria-hidden />
                  전체 컷 선택
                </button>
                <button
                  type="button"
                  disabled={runtime.disabled || !batch || batch.availablePasses.length === 0}
                  onClick={() => void runAction("apply-manuscript-preset")}
                  className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-line bg-card px-2 text-[0.57rem] font-semibold text-fg-2 hover:bg-raised hover:text-fg disabled:opacity-40"
                >
                  <CheckCircle2 className="size-3" aria-hidden />
                  원고 패스
                </button>
                <button
                  type="button"
                  disabled={
                    runtime.disabled ||
                    runtime.aiReferenceBusy ||
                    runtime.aiReferenceDisabled ||
                    !runtime.onUseCurrentFrameAsAiReference
                  }
                  aria-busy={runtime.aiReferenceBusy}
                  onClick={runtime.onUseCurrentFrameAsAiReference}
                  className="flex min-h-10 items-center justify-center gap-1 rounded-lg border border-cool/40 bg-cool/10 px-2 text-[0.57rem] font-semibold text-cool hover:bg-cool/15 disabled:opacity-40"
                >
                  {runtime.aiReferenceBusy ? (
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                  ) : (
                    <BrainCircuit className="size-3" aria-hidden />
                  )}
                  현재 컷 AI 참조 준비
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-line bg-panel/65 p-2.5" aria-label="룩과 전달 설정">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.62rem] font-bold text-fg-2">룩·전달 연계</span>
                <span className="text-[0.52rem] text-fg-3">
                  선택 {scene.selectedNodeCount}/{scene.nodeCount}
                </span>
              </div>
              <div className="mt-2 grid gap-1.5">
                <label className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 text-[0.57rem] font-semibold text-fg-2">
                  <span className="flex items-center gap-1.5">
                    {scene.lineArtPreview ? (
                      <Eye className="size-3 text-accent" aria-hidden />
                    ) : (
                      <EyeOff className="size-3 text-fg-3" aria-hidden />
                    )}
                    선화 미리보기
                  </span>
                  <input
                    type="checkbox"
                    checked={scene.lineArtPreview}
                    disabled={runtime.disabled || !runtime.onSetLineArtPreview}
                    onChange={(event) => runtime.onSetLineArtPreview?.(event.target.checked)}
                    className="size-3.5 accent-accent"
                  />
                </label>
                <label className="flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-lg border border-line bg-card px-2.5 text-[0.57rem] font-semibold text-fg-2">
                  <span className="flex items-center gap-1.5">
                    <Palette className="size-3 text-accent" aria-hidden />
                    2D 합성용 투명 배경
                  </span>
                  <input
                    type="checkbox"
                    checked={scene.transparentBackground}
                    disabled={runtime.disabled || !runtime.onSetTransparentBackground}
                    onChange={(event) => runtime.onSetTransparentBackground?.(event.target.checked)}
                    className="size-3.5 accent-accent"
                  />
                </label>
              </div>
            </section>
          </div>

          {batch?.progress ? (
            <section
              className="mt-2 rounded-xl border border-accent/35 bg-accent-soft p-2.5"
              role="status"
              aria-live="polite"
            >
              <div className="flex items-center justify-between gap-2 text-[0.58rem] font-semibold text-accent">
                <span className="min-w-0 truncate">
                  {PROGRESS_STAGE_LABELS[batch.progress.stage]} · {batch.progress.label}
                </span>
                <span className="shrink-0 tabular-nums">
                  {batch.progress.completed}/{batch.progress.total}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised">
                <div
                  className="h-full rounded-full bg-accent transition-[width] motion-reduce:transition-none"
                  style={{
                    width: `${batch.progress.total > 0
                      ? Math.min(100, Math.max(0, (batch.progress.completed / batch.progress.total) * 100))
                      : 0}%`,
                  }}
                />
              </div>
            </section>
          ) : null}

          {batch?.recoverySummary ? (
            <p className="mt-2 text-[0.54rem] leading-relaxed text-fg-3" role="status">
              최근 복구 상태 · {batch.recoverySummary.completedShots}/{batch.recoverySummary.totalShots}컷 ·
              {batch.recoverySummary.mode === "durable" ? " 영구 복구" : " 메모리 복구"}
              {batch.recoverySummary.degradedReason
                ? ` · ${batch.recoverySummary.degradedReason}`
                : ""}
            </p>
          ) : null}

          {plan.blockingReason || actionError ? (
            <p
              className="mt-2 flex items-start gap-1 rounded-lg border border-bad/35 bg-bad/8 px-2.5 py-2 text-[0.56rem] leading-relaxed text-bad"
              role="alert"
            >
              <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
              {actionError ?? plan.blockingReason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
