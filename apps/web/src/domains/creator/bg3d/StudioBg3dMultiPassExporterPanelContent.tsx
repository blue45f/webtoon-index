import {
  CheckSquare,
  Cpu,
  Download,
  Layers,
  Sparkles,
  Square,
  TriangleAlert,
} from "lucide-react";
import React, { useMemo, useState } from "react";

import {
  MULTIPASS_CONFIG_KEY_BY_KIND,
  WEBTOON_RENDER_PASSES,
  applyMultiPassExportPreset,
  planMultiPassExport,
  type MultiPassBooleanConfigKey,
  type MultiPassExportConfig,
  type MultiPassExportPreset,
} from "../scene-3d/studio-3d-webtoon-multipass-exporter";

const PRESET_LABELS: Readonly<Record<MultiPassExportPreset, string>> = Object.freeze({
  manuscript: "원고 기본",
  "ai-control": "AI 제어맵",
  compositing: "합성/VFX",
  complete: "전체 패스",
});

const ROLE_LABELS = Object.freeze({
  manuscript: "원고",
  mask: "선택/제어",
  relight: "재조명",
  motion: "모션",
} as const);

type ActiveMultiPassPreset = MultiPassExportPreset | "custom";

export interface StudioBg3dMultiPassExporterPanelProps {
  readonly disabled?: boolean;
  readonly onStartMultiPassExport?: (config: MultiPassExportConfig) => void;
}

export function StudioBg3dMultiPassExporterPanel({
  disabled = false,
  onStartMultiPassExport,
}: StudioBg3dMultiPassExporterPanelProps): React.JSX.Element {
  const [config, setConfig] = useState<MultiPassExportConfig>({
    resolutionWidth: 1920,
    resolutionHeight: 1080,
    transparentBackground: true,
    includeLineArt: true,
    includeFlatColor: true,
    includeShadow: true,
    includeHighlight: true,
    includeDepthMap: false,
    includeObjectIdMask: true,
    includeNormalMap: false,
    includeMaterialIdMask: false,
    includeAmbientOcclusion: false,
    includeEmission: false,
    includeVelocity: false,
    format: "png-zip",
  });
  const [activePreset, setActivePreset] = useState<ActiveMultiPassPreset>("manuscript");
  const planned = useMemo(() => planMultiPassExport(config), [config]);

  const togglePass = (key: MultiPassBooleanConfigKey) => {
    setActivePreset("custom");
    setConfig((current) => ({ ...current, [key]: !current[key] }));
  };

  const applyPreset = (preset: MultiPassExportPreset) => {
    setActivePreset(preset);
    setConfig((current) => applyMultiPassExportPreset(current, preset));
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs text-fg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex items-center gap-1.5 font-bold text-fg">
          <Layers className="size-4 text-accent" />
          <span>멀티패스 레이어 자동 분리 내보내기</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-accent/15 px-1.5 py-0.5 font-mono text-[0.62rem] font-semibold text-accent">
            {planned.totalPasses}개 패스
          </span>
          <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[0.58rem] text-fg-3">
            {planned.captureProfile.toUpperCase()}
          </span>
        </div>
      </div>

      <section className="grid gap-2 rounded-lg border border-line bg-card p-2.5" aria-label="멀티패스 빠른 프리셋">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-[0.68rem] font-bold text-fg-2">
            <Sparkles className="size-3.5 text-accent" />
            작업 목적 프리셋
          </span>
          {activePreset === "custom" ? (
            <span className="rounded bg-raised px-1.5 py-0.5 text-[0.55rem] font-semibold text-fg-3">
              사용자 설정
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-4 gap-1">
          {(Object.keys(PRESET_LABELS) as MultiPassExportPreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={disabled}
              onClick={() => applyPreset(preset)}
              className={`min-h-8 rounded border px-1.5 text-[0.6rem] font-bold transition-colors disabled:opacity-45 ${
                activePreset === preset
                  ? "border-accent bg-accent text-accent-fg"
                  : "border-line bg-raised text-fg-2 hover:text-fg"
              }`}
            >
              {PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-1.5" aria-label="추출할 웹툰 렌더 패스 선택">
        <span className="text-[0.68rem] font-medium text-fg-3">추출할 웹툰 렌더 패스 선택</span>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {WEBTOON_RENDER_PASSES.map((pass) => {
            const configKey = MULTIPASS_CONFIG_KEY_BY_KIND[pass.kind];
            const isChecked = Boolean(config[configKey]);
            return (
              <button
                key={pass.kind}
                type="button"
                disabled={disabled}
                aria-pressed={isChecked}
                onClick={() => togglePass(configKey)}
                className={`flex min-h-16 items-start gap-2 rounded-lg border p-2 text-left transition-all disabled:opacity-45 ${
                  isChecked
                    ? "border-accent/80 bg-accent/5 text-fg"
                    : "border-line bg-card text-fg-3 opacity-65 hover:opacity-100"
                }`}
              >
                {isChecked ? (
                  <CheckSquare className="mt-0.5 size-4 shrink-0 text-accent" />
                ) : (
                  <Square className="mt-0.5 size-4 shrink-0 text-fg-3" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1">
                    <strong className="text-[0.68rem]">{pass.layerName}</strong>
                    <span className="rounded bg-raised px-1 py-0.5 font-mono text-[0.5rem] text-fg-2">
                      {pass.blendMode.toUpperCase()}
                    </span>
                    <span className={`rounded px-1 py-0.5 font-mono text-[0.5rem] ${
                      pass.source === "artifact-v2"
                        ? "bg-cool/10 text-cool"
                        : "bg-accent/10 text-accent"
                    }`}>
                      {pass.source === "artifact-v2" ? "ARTIFACT V2" : "LT"}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[0.57rem] leading-relaxed text-fg-3">
                    {pass.description}
                  </span>
                  <span className="mt-1 flex gap-2 font-mono text-[0.5rem] text-fg-3">
                    <span>{pass.pixelFormat}</span>
                    <span>{pass.bytesPerPixel}B/px</span>
                    <span>{ROLE_LABELS[pass.productionRole]}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-2 rounded-lg border border-line bg-card p-2.5" aria-label="멀티패스 내보내기 규격">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[0.68rem] font-semibold text-fg-2">해상도</span>
          <div className="flex flex-wrap gap-1">
            {[
              { label: "세로 원고", width: 1440, height: 2560 },
              { label: "FHD", width: 1920, height: 1080 },
              { label: "4K", width: 3840, height: 2160 },
            ].map((resolution) => (
              <button
                key={resolution.label}
                type="button"
                disabled={disabled}
                onClick={() => setConfig((current) => ({
                  ...current,
                  resolutionWidth: resolution.width,
                  resolutionHeight: resolution.height,
                }))}
                className={`min-h-7 rounded px-1.5 text-[0.58rem] font-bold disabled:opacity-45 ${
                  config.resolutionWidth === resolution.width && config.resolutionHeight === resolution.height
                    ? "bg-accent text-accent-fg"
                    : "border border-line bg-raised text-fg-2 hover:text-fg"
                }`}
              >
                {resolution.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[0.58rem] font-semibold text-fg-3">
            너비 px
            <input
              type="number"
              min="1"
              max="16384"
              value={config.resolutionWidth}
              disabled={disabled}
              onChange={(event) => setConfig((current) => ({
                ...current,
                resolutionWidth: Number(event.target.value),
              }))}
              className="mt-1 min-h-8 w-full rounded border border-line bg-raised px-2 text-fg"
            />
          </label>
          <label className="text-[0.58rem] font-semibold text-fg-3">
            높이 px
            <input
              type="number"
              min="1"
              max="16384"
              value={config.resolutionHeight}
              disabled={disabled}
              onChange={(event) => setConfig((current) => ({
                ...current,
                resolutionHeight: Number(event.target.value),
              }))}
              className="mt-1 min-h-8 w-full rounded border border-line bg-raised px-2 text-fg"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2">
          <label className="flex min-h-8 items-center gap-2 text-[0.62rem] font-semibold text-fg-2">
            <input
              type="checkbox"
              checked={config.transparentBackground}
              disabled={disabled}
              onChange={(event) => setConfig((current) => ({
                ...current,
                transparentBackground: event.target.checked,
              }))}
              className="size-3.5 accent-accent"
            />
            투명 배경
          </label>
          <div className="flex gap-1">
            {(["png-zip", "psd", "clip-studio-layers"] as const).map((format) => (
              <button
                key={format}
                type="button"
                disabled={disabled}
                onClick={() => setConfig((current) => ({ ...current, format }))}
                className={`min-h-7 rounded px-1.5 font-mono text-[0.58rem] uppercase disabled:opacity-45 ${
                  config.format === format
                    ? "bg-accent font-bold text-accent-fg"
                    : "border border-line bg-raised text-fg-2 hover:text-fg"
                }`}
              >
                {format === "png-zip" ? "ZIP(PNG)" : format === "psd" ? "PSD" : "CLIP"}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-1 rounded-lg border border-line bg-raised/60 p-2.5" aria-label="멀티패스 예산">
        <div className="flex items-center justify-between gap-2 text-[0.62rem]">
          <span className="flex items-center gap-1 font-semibold text-fg-2">
            <Cpu className="size-3.5 text-accent" />
            실행 계획
          </span>
          <span className="font-mono text-fg-3">
            {planned.recommendedExecution === "worker" ? "Worker 순차 렌더" : "즉시 렌더 가능"}
          </span>
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[0.58rem] text-fg-3">
          <dt>예상 다운로드</dt>
          <dd className="numeral text-right text-fg-2">~{planned.estimatedFileSizeMb}MB</dd>
          <dt>예상 작업 메모리</dt>
          <dd className="numeral text-right text-fg-2">~{planned.estimatedWorkingSetMb}MB</dd>
          <dt>출력 규격</dt>
          <dd className="numeral text-right text-fg-2">{planned.exportResolution[0]} × {planned.exportResolution[1]}</dd>
        </dl>
        {planned.warnings.map((warning) => (
          <p key={warning} className="flex gap-1 text-[0.56rem] leading-relaxed text-warn" role="status">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" />
            {warning}
          </p>
        ))}
      </section>

      <button
        type="button"
        disabled={disabled || planned.totalPasses === 0}
        onClick={() => onStartMultiPassExport?.(config)}
        className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-accent py-2 text-[0.68rem] font-bold text-accent-fg shadow-sm transition-all hover:bg-accent/90 disabled:opacity-45"
      >
        <Download className="size-3.5" />
        <span>레이어별 패스 렌더링 & 다운로드 시작</span>
      </button>
    </div>
  );
}
