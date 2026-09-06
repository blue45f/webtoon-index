import {
  Archive,
  CheckSquare,
  Cpu,
  Download,
  Layers,
  Loader2,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";

import { studioBg3dClassNames as cx } from "./studio-bg3d-editor-ui";
import {
  STUDIO_BG3D_DEFERRED_ARTIFACT_PASSES,
  STUDIO_BG3D_PRODUCTION_BATCH_PRESETS,
  detectStudioBg3dProductionBatchPreset,
  planStudioBg3dProductionBatchSummary,
  resolveStudioBg3dProductionBatchPreset,
  type StudioBg3dProductionBatchPreset,
} from "./studio-bg3d-production-multipass";

import type { StudioBg3dProductionBatchRuntime } from "./studio-bg3d-pro-suite-runtime-context";
import type { StudioBg3dShot } from "./studio-bg3d-scene-document";

const PRESET_LABELS: Readonly<Record<StudioBg3dProductionBatchPreset, string>> = Object.freeze({
  review: "검수",
  manuscript: "원고",
  "ai-reference": "AI 참조",
  all: "전체",
});

const PROGRESS_STAGE_LABELS = Object.freeze({
  render: "렌더",
  contact: "콘택트",
  archive: "패키지",
} as const);

export interface StudioBg3dProductionMultiPassExporterPanelProps {
  readonly disabled?: boolean;
  readonly shots: readonly StudioBg3dShot[];
  readonly batch: StudioBg3dProductionBatchRuntime;
}

function resolveStartDisabledReason(
  disabled: boolean,
  batch: StudioBg3dProductionBatchRuntime,
): string | null {
  if (disabled || batch.isRendering) return "다른 3D 캡처 또는 장면 작업이 진행 중입니다.";
  if (!batch.recoveryReady) return "현재 문서의 복구 권한을 준비하지 못했습니다.";
  if (batch.blockedReason) return batch.blockedReason;
  if (batch.selectedShotIds.length === 0) return "배치 출력할 컷을 하나 이상 선택하세요.";
  if (batch.selectedPasses.length === 0) return "PNG 렌더 패스를 하나 이상 선택하세요.";
  return null;
}

export function StudioBg3dProductionMultiPassExporterPanel({
  disabled = false,
  shots,
  batch,
}: StudioBg3dProductionMultiPassExporterPanelProps) {
  const activePreset = useMemo(
    () => detectStudioBg3dProductionBatchPreset(
      batch.availablePasses,
      batch.selectedPasses,
    ),
    [batch.availablePasses, batch.selectedPasses],
  );
  const packageSummary = useMemo(
    () => planStudioBg3dProductionBatchSummary({
      selectedShotCount: batch.selectedShotIds.length,
      selectedPassCount: batch.selectedPasses.length,
      includeLayeredPsd: batch.includeLayeredPsd,
      includeContactSheet: batch.includeContactSheet,
    }),
    [
      batch.includeContactSheet,
      batch.includeLayeredPsd,
      batch.selectedPasses.length,
      batch.selectedShotIds.length,
    ],
  );
  const selectedShotIds = useMemo(
    () => new Set(batch.selectedShotIds),
    [batch.selectedShotIds],
  );
  const selectedPasses = useMemo(
    () => new Set(batch.selectedPasses),
    [batch.selectedPasses],
  );
  const startDisabledReason = resolveStartDisabledReason(disabled, batch);
  const interactionLocked = disabled || batch.isRendering;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-2">
        <div>
          <div className="flex items-center gap-1.5 font-bold text-fg">
            <Layers className="size-4 text-accent" aria-hidden />
            <span>프로덕션 컷 멀티패스</span>
          </div>
          <p className="mt-1 text-[0.62rem] leading-relaxed text-fg-3">
            저장된 실제 컷을 기존 복구 저장소·LT Worker·PSD·ZIP 검증 파이프라인으로 출력합니다.
          </p>
        </div>
        <span className="rounded-full border border-good/40 bg-good/10 px-2 py-1 text-[0.56rem] font-bold text-good">
          장면 연동
        </span>
      </header>

      <section className="grid gap-2 rounded-xl border border-line bg-card/70 p-2.5" aria-label="프로덕션 멀티패스 프리셋">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.66rem] font-bold text-fg-2">작업 목적 프리셋</span>
          {activePreset === "custom" ? (
            <span className="rounded bg-raised px-1.5 py-0.5 text-[0.54rem] font-semibold text-fg-3">
              사용자 설정
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {STUDIO_BG3D_PRODUCTION_BATCH_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={interactionLocked}
              onClick={() => batch.setSelectedPasses(
                resolveStudioBg3dProductionBatchPreset(batch.availablePasses, preset),
              )}
              className={cx(
                "min-h-9 rounded-lg border px-1.5 text-[0.6rem] font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-45",
                activePreset === preset
                  ? "border-accent bg-accent text-on-accent"
                  : "border-line bg-panel text-fg-3 hover:bg-raised hover:text-fg",
              )}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-2 rounded-xl border border-line bg-card/70 p-2.5" aria-label="배치 출력 컷 선택">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.66rem] font-bold text-fg-2">
            배치 컷 {batch.selectedShotIds.length}/{shots.length}
          </span>
          <span className="flex gap-1">
            <button
              type="button"
              disabled={interactionLocked || shots.length === 0}
              onClick={batch.selectAllShots}
              className="min-h-9 rounded-md border border-line bg-panel px-2 text-[0.58rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-40"
            >
              전체
            </button>
            <button
              type="button"
              disabled={interactionLocked || shots.length === 0}
              onClick={batch.clearShotSelection}
              className="min-h-9 rounded-md border border-line bg-panel px-2 text-[0.58rem] font-semibold text-fg-3 hover:bg-raised hover:text-fg disabled:opacity-40"
            >
              해제
            </button>
          </span>
        </div>
        {shots.length > 0 ? (
          <ul className="grid max-h-40 gap-1 overflow-y-auto overscroll-contain pr-1" aria-label="멀티패스 배치 컷">
            {shots.map((shot, index) => {
              const checked = selectedShotIds.has(shot.id);
              return (
                <li key={shot.id}>
                  <label className={cx(
                    "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 transition-colors",
                    checked
                      ? "border-accent/55 bg-accent-soft text-fg"
                      : "border-line bg-panel text-fg-3 hover:bg-raised hover:text-fg",
                    interactionLocked && "cursor-not-allowed opacity-45",
                  )}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={interactionLocked}
                      onChange={(event) => batch.setShotSelected(shot.id, event.target.checked)}
                      className="size-3.5 accent-accent"
                    />
                    <span className="w-5 shrink-0 text-right font-mono text-[0.56rem] text-fg-3">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[0.62rem] font-semibold">
                      {shot.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed border-line px-3 py-3 text-center text-[0.62rem] text-fg-3">
            카메라 탭에서 현재 장면을 컷으로 먼저 기록하세요.
          </p>
        )}
      </section>

      <section className="grid gap-2 rounded-xl border border-line bg-card/70 p-2.5" aria-label="프로덕션 PNG 패스">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[0.66rem] font-bold text-fg-2">
            실제 PNG 패스 {batch.selectedPasses.length}/{batch.availablePasses.length}
          </span>
          <span className="text-[0.54rem] text-fg-3">검증된 배치 경로</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {batch.availablePasses.map((pass) => {
            const checked = selectedPasses.has(pass);
            return (
              <label
                key={pass}
                className={cx(
                  "flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-2 text-[0.6rem] font-semibold transition-colors",
                  checked
                    ? "border-accent/55 bg-accent-soft text-accent"
                    : "border-line bg-panel text-fg-3 hover:bg-raised hover:text-fg",
                  interactionLocked && "cursor-not-allowed opacity-45",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={interactionLocked}
                  onChange={(event) => batch.setPassSelected(pass, event.target.checked)}
                  className="sr-only"
                />
                {checked ? (
                  <CheckSquare className="size-3.5 shrink-0" aria-hidden />
                ) : (
                  <Square className="size-3.5 shrink-0" aria-hidden />
                )}
                <span>{batch.passLabels[pass]}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="grid gap-2 rounded-xl border border-line bg-card/70 p-2.5" aria-label="멀티패스 출력 옵션">
        <label className="flex min-h-10 items-center justify-between gap-2 text-[0.62rem] font-semibold text-fg-2">
          최대 출력 높이
          <select
            value={String(batch.exportHeight)}
            disabled={interactionLocked}
            onChange={(event) => batch.setExportHeight(
              event.target.value === "per-shot" ? "per-shot" : Number(event.target.value),
            )}
            className="min-h-9 rounded-lg border border-line bg-panel px-2 text-[0.6rem] text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-45"
          >
            <option value="per-shot">컷별 저장 최대값</option>
            {batch.exportHeightOptions.map((height) => (
              <option key={height} value={height}>{height.toLocaleString()} px 최대</option>
            ))}
          </select>
        </label>
        <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-[0.6rem] text-fg-2">
          <input
            type="checkbox"
            checked={batch.includeLayeredPsd}
            disabled={interactionLocked}
            onChange={(event) => batch.setIncludeLayeredPsd(event.target.checked)}
            className="mt-0.5 size-3.5 accent-accent"
          />
          <span>
            컷별 레이어 PSD
            <span className="mt-0.5 block font-normal leading-relaxed text-fg-3">
              예산 초과 시 PNG는 유지하고 manifest에 PSD fallback을 기록합니다.
            </span>
          </span>
        </label>
        <label className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-line bg-panel px-2.5 py-2 text-[0.6rem] text-fg-2">
          <input
            type="checkbox"
            checked={batch.includeContactSheet}
            disabled={interactionLocked}
            onChange={(event) => batch.setIncludeContactSheet(event.target.checked)}
            className="mt-0.5 size-3.5 accent-accent"
          />
          <span>
            컷 검수 콘택트 시트
            <span className="mt-0.5 block font-normal leading-relaxed text-fg-3">
              대표 이미지를 12컷씩 묶어 순서·연속성을 빠르게 확인합니다.
            </span>
          </span>
        </label>
      </section>

      <section className="grid gap-1.5 rounded-xl border border-line bg-panel/65 p-2.5" aria-label="멀티패스 패키지 계획">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[0.64rem] font-bold text-fg-2">
            <Cpu className="size-3.5 text-accent" aria-hidden />
            패키지 계획
          </span>
          <span className="font-mono text-[0.56rem] text-fg-3">
            {packageSummary.totalArtifactCount}개 파일/manifest
          </span>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[0.57rem] text-fg-3">
          <dt>PNG</dt>
          <dd className="text-right tabular-nums text-fg-2">{packageSummary.pngCount}</dd>
          <dt>PSD</dt>
          <dd className="text-right tabular-nums text-fg-2">{packageSummary.psdCount}</dd>
          <dt>콘택트 시트</dt>
          <dd className="text-right tabular-nums text-fg-2">{packageSummary.contactSheetCount}</dd>
        </dl>
        {packageSummary.warnings.map((warning) => (
          <p key={warning} className="flex gap-1 text-[0.56rem] leading-relaxed text-warn">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            {warning}
          </p>
        ))}
      </section>

      {batch.progress ? (
        <section className="rounded-xl border border-line bg-panel px-2.5 py-2" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-[0.62rem] text-fg-3">
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
                width: `${Math.round(
                  (batch.progress.completed / Math.max(1, batch.progress.total)) * 100,
                )}%`,
              }}
            />
          </div>
        </section>
      ) : null}

      {batch.recoverySummary ? (
        <section className="rounded-xl border border-accent/35 bg-accent-soft px-2.5 py-2 text-[0.58rem] leading-relaxed text-accent">
          <div className="flex items-start gap-1.5">
            <Archive className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <p>
              완료 {batch.recoverySummary.completedShots}/{batch.recoverySummary.totalShots}컷 ·
              {batch.recoverySummary.mode === "durable" ? " 복구 저장소" : " 현재 탭 메모리"}
              {batch.recoverySummary.downloadRequested ? " · 다운로드 이력 보존" : ""}
              {batch.recoverySummary.degradedReason
                ? ` · ${batch.recoverySummary.degradedReason}`
                : ""}
            </p>
          </div>
        </section>
      ) : null}

      {startDisabledReason ? (
        <p className="flex gap-1.5 rounded-xl border border-warn/40 bg-warn/10 px-2.5 py-2 text-[0.58rem] leading-relaxed text-warn" role="status">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {startDisabledReason}
        </p>
      ) : null}

      <button
        type="button"
        disabled={startDisabledReason !== null}
        onClick={() => void batch.startExport()}
        className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 py-2 text-[0.68rem] font-bold text-on-accent shadow-sm transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-45"
      >
        {batch.isRendering ? (
          <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <Download className="size-3.5" aria-hidden />
        )}
        선택 {batch.selectedShotIds.length}컷 · {batch.selectedPasses.length}패스
        {batch.includeLayeredPsd ? " + PSD" : ""}
        {batch.includeContactSheet ? " + 콘택트" : ""} ZIP
      </button>

      <details className="rounded-xl border border-line bg-card/60 p-2.5">
        <summary className="cursor-pointer text-[0.62rem] font-bold text-fg-2">
          Capture v2 고급 패스 연결 현황
        </summary>
        <p className="mt-2 text-[0.56rem] leading-relaxed text-fg-3">
          아래 데이터는 캡처 계약에는 존재하지만, 복구·manifest·PNG/PSD 무결성 검증까지 끝난 뒤에만
          프로덕션 선택 항목으로 승격합니다.
        </p>
        <ul className="mt-2 grid gap-1.5">
          {STUDIO_BG3D_DEFERRED_ARTIFACT_PASSES.map((pass) => (
            <li key={pass.kind} className="rounded-lg border border-line bg-panel px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[0.58rem] font-bold text-fg-2">{pass.label}</span>
                <span className="rounded bg-cool/10 px-1.5 py-0.5 font-mono text-[0.48rem] text-cool">
                  {pass.profile}
                </span>
              </div>
              <p className="mt-0.5 text-[0.52rem] text-fg-3">{pass.purpose}</p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
