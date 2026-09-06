import { CheckCircle2, TriangleAlert, WandSparkles } from "lucide-react";
import { useId, useMemo } from "react";

import { useStudioBg3dProSuiteRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import { evaluateStudioBg3dProductionPassReadiness } from "./studio-bg3d-production-pass-readiness";

export function StudioBg3dProductionPassPreflightPanel() {
  const runtime = useStudioBg3dProSuiteRuntime();
  const titleId = useId();
  const batch = runtime?.productionBatch;
  const readiness = useMemo(
    () => batch?.look
      ? evaluateStudioBg3dProductionPassReadiness(batch.selectedPasses, batch.look)
      : null,
    [batch],
  );

  if (!runtime || !batch || !readiness || readiness.issues.length === 0) return null;

  const resolveSafePasses = () => {
    if (readiness.readyPasses.length > 0) return readiness.readyPasses;
    const safeFallback = batch.availablePasses.find(
      (pass) => pass === "beauty" || pass === "depth",
    ) ?? batch.availablePasses[0];
    return safeFallback ? [safeFallback] : [];
  };

  const keepReadyPasses = () => {
    if (runtime.disabled || batch.isRendering) return;
    batch.setSelectedPasses(resolveSafePasses());
  };

  return (
    <section
      className="mx-3 mt-3 rounded-2xl border border-warn/45 bg-warn/8 p-3"
      aria-labelledby={titleId}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-warn/40 bg-warn/10 text-warn">
          <TriangleAlert className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="text-[0.66rem] font-bold text-warn"
          >
            출력 전 LT 패스 확인
          </h3>
          <p className="mt-1 text-[0.56rem] leading-relaxed text-fg-3">
            선택한 패스 중 현재 SceneDocument의 선·톤 설정으로 생성되지 않는 항목이 있습니다.
            누락된 파일을 정상 출력으로 오인하지 않도록 배치를 잠갔습니다.
          </p>
        </div>
      </div>

      <ul className="mt-2 grid gap-1.5" aria-label="생성되지 않는 선택 패스">
        {readiness.issues.map((issue) => (
          <li
            key={issue.pass}
            className="rounded-lg border border-warn/35 bg-card/75 px-2.5 py-2 text-[0.56rem] leading-relaxed text-fg-3"
          >
            <strong className="text-fg-2">{batch.passLabels[issue.pass]}</strong>
            <span className="ml-1">{issue.reason}</span>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 text-[0.52rem] leading-relaxed text-fg-3">
          선·톤을 유지하려면 LT 설정을 조정하고, 현재 룩 그대로 출력하려면 유효 패스만 유지하세요.
        </p>
        <button
          type="button"
          disabled={
            runtime.disabled ||
            batch.isRendering ||
            batch.availablePasses.length === 0
          }
          onClick={keepReadyPasses}
          className="flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-warn/45 bg-card px-3 text-[0.58rem] font-bold text-warn hover:bg-warn/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-warn disabled:cursor-not-allowed disabled:opacity-45"
        >
          {readiness.readyPasses.length > 0 ? (
            <CheckCircle2 className="size-3.5" aria-hidden />
          ) : (
            <WandSparkles className="size-3.5" aria-hidden />
          )}
          {readiness.readyPasses.length > 0
            ? `유효 ${readiness.readyPasses.length}개 패스만 유지`
            : "안전 패스로 전환"}
        </button>
      </div>
    </section>
  );
}
