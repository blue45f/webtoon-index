import {
  BrainCircuit,
  Check,
  ClipboardCheck,
  Layers,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import {
  detectStudioBg3dProductionIntent,
  planStudioBg3dProductionIntent,
  STUDIO_BG3D_PRODUCTION_INTENTS,
  type StudioBg3dProductionIntentId,
  type StudioBg3dProductionIntentState,
} from "./studio-bg3d-production-intents";

interface PreviousProductionIntentState extends StudioBg3dProductionIntentState {
  readonly selectedShotIds: readonly string[];
}

function IntentIcon({ id }: { readonly id: StudioBg3dProductionIntentId }) {
  switch (id) {
    case "review":
      return <ClipboardCheck className="size-3.5" aria-hidden />;
    case "manuscript":
      return <Layers className="size-3.5" aria-hidden />;
    case "composite":
      return <Sparkles className="size-3.5" aria-hidden />;
    case "ai-reference":
      return <BrainCircuit className="size-3.5" aria-hidden />;
  }
}

export function StudioBg3dProductionIntentPanel() {
  const runtime = useStudioBg3dProSuiteRuntime();
  const titleId = useId();
  const [appliedMessage, setAppliedMessage] = useState<string | null>(null);
  const [previousState, setPreviousState] = useState<PreviousProductionIntentState | null>(null);
  const batch = runtime?.productionBatch;
  const scene = runtime?.sceneSummary;

  const activeIntent = useMemo(() => {
    if (!batch || !scene) return null;
    return detectStudioBg3dProductionIntent({
      availablePasses: batch.availablePasses,
      selectedPasses: batch.selectedPasses,
      look: batch.look,
      includeLayeredPsd: batch.includeLayeredPsd,
      includeContactSheet: batch.includeContactSheet,
      lineArtPreview: scene.lineArtPreview,
      transparentBackground: scene.transparentBackground,
    });
  }, [batch, scene]);

  if (!runtime || !batch || !scene) return null;

  const snapshotCurrentState = (): PreviousProductionIntentState => Object.freeze({
    availablePasses: [...batch.availablePasses],
    selectedPasses: [...batch.selectedPasses],
    look: batch.look,
    selectedShotIds: [...batch.selectedShotIds],
    includeLayeredPsd: batch.includeLayeredPsd,
    includeContactSheet: batch.includeContactSheet,
    lineArtPreview: scene.lineArtPreview,
    transparentBackground: scene.transparentBackground,
  });

  const applyIntent = (intentId: StudioBg3dProductionIntentId) => {
    if (runtime.disabled || batch.isRendering) return;
    const plan = planStudioBg3dProductionIntent(
      batch.availablePasses,
      intentId,
      batch.look,
    );
    setPreviousState(snapshotCurrentState());

    if (runtime.productionShots.length > 0) batch.selectAllShots();
    batch.setSelectedPasses(plan.selectedPasses);
    batch.setIncludeLayeredPsd(plan.definition.includeLayeredPsd);
    batch.setIncludeContactSheet(plan.definition.includeContactSheet);
    runtime.onSetLineArtPreview?.(plan.definition.lineArtPreview);
    runtime.onSetTransparentBackground?.(plan.definition.transparentBackground);
    setAppliedMessage(
      `${plan.definition.label} 프리셋을 적용했습니다. 출력 전 컷과 패키지 계획을 확인하세요.`,
    );
  };

  const restorePreviousState = () => {
    if (!previousState || runtime.disabled || batch.isRendering) return;
    batch.clearShotSelection();
    for (const shotId of previousState.selectedShotIds) {
      batch.setShotSelected(shotId, true);
    }
    batch.setSelectedPasses(previousState.selectedPasses);
    batch.setIncludeLayeredPsd(previousState.includeLayeredPsd);
    batch.setIncludeContactSheet(previousState.includeContactSheet);
    runtime.onSetLineArtPreview?.(previousState.lineArtPreview);
    runtime.onSetTransparentBackground?.(previousState.transparentBackground);
    setPreviousState(null);
    setAppliedMessage("이전 제작 설정을 복원했습니다.");
  };

  return (
    <section
      className="mx-3 mt-3 rounded-2xl border border-line bg-card/75 p-3 shadow-sm"
      aria-labelledby={titleId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3
            id={titleId}
            className="flex items-center gap-1.5 text-[0.7rem] font-bold text-fg"
          >
            <Sparkles className="size-3.5 text-accent" aria-hidden />
            전체 제작 프리셋
          </h3>
          <p className="mt-1 text-[0.57rem] leading-relaxed text-fg-3">
            컷 선택·현재 LT에 맞는 패스·PSD·콘택트 시트·선화·배경 알파를 작업 목적에 맞춰 함께 설정합니다.
          </p>
        </div>
        <span className="rounded-full border border-good/40 bg-good/10 px-2 py-1 text-[0.52rem] font-bold text-good">
          자동 출력 안 함
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-1.5" role="group" aria-label="3D 전체 제작 프리셋">
        {STUDIO_BG3D_PRODUCTION_INTENTS.map((intent) => {
          const selected = activeIntent === intent.id;
          return (
            <button
              key={intent.id}
              type="button"
              disabled={runtime.disabled || batch.isRendering}
              aria-pressed={selected}
              title={intent.description}
              onClick={() => applyIntent(intent.id)}
              className={`flex min-h-12 items-start gap-2 rounded-xl border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45 ${
                selected
                  ? "border-accent/55 bg-accent-soft text-accent"
                  : "border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg"
              }`}
            >
              <span className="mt-0.5 shrink-0">
                {selected ? <Check className="size-3.5" aria-hidden /> : <IntentIcon id={intent.id} />}
              </span>
              <span className="min-w-0">
                <span className="block text-[0.6rem] font-bold">{intent.label}</span>
                <span className="mt-0.5 line-clamp-2 block text-[0.51rem] font-normal leading-relaxed text-fg-3">
                  {intent.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {appliedMessage ? (
            <p className="text-[0.54rem] leading-relaxed text-good" role="status" aria-live="polite">
              {appliedMessage}
            </p>
          ) : runtime.productionShots.length === 0 ? (
            <p className="text-[0.54rem] leading-relaxed text-warn">
              프리셋 설정은 미리 적용됩니다. 현재 장면을 컷으로 저장하면 배치 선택 단계가 이어집니다.
            </p>
          ) : null}
        </div>
        {previousState ? (
          <button
            type="button"
            disabled={runtime.disabled || batch.isRendering}
            onClick={restorePreviousState}
            className="flex min-h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-line bg-panel px-2.5 text-[0.56rem] font-bold text-fg-2 hover:bg-raised hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Undo2 className="size-3" aria-hidden />
            이전 설정 복원
          </button>
        ) : null}
      </div>
    </section>
  );
}
