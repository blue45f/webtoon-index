import { Activity, ChevronDown, Shuffle, Sparkles, Waves } from "lucide-react";

import {
  findStudioBrushDynamicsMapping,
  removeStudioBrushDynamicsMapping,
  updateStudioBrushDynamicsColorDynamics,
  updateStudioBrushDynamicsGrain,
  updateStudioBrushDynamicsJitter,
  updateStudioBrushDynamicsMapping,
  updateStudioBrushDynamicsTaper,
  type StudioBrushDynamicsPropertyKey,
} from "./studio-brush-dynamics-editor";

import type {
  NormalizedStudioBrushDynamicsMapping,
  NormalizedStudioBrushDynamicsSettings,
  StudioBrushDynamicsMappingSettings,
  StudioBrushDynamicsSource,
} from "./studio-brush-dynamics";

import { cn } from "@/shared/lib/utils";

interface StudioBrushDynamicsControlsProps {
  settings: NormalizedStudioBrushDynamicsSettings;
  onSettingsChange: (settings: NormalizedStudioBrushDynamicsSettings) => void;
}

type StudioBrushDynamicsUiSource = StudioBrushDynamicsSource | "random";

const OUTPUTS: readonly {
  id: StudioBrushDynamicsPropertyKey;
  label: string;
  description: string;
}[] = [
  { id: "width", label: "굵기", description: "획과 펜촉의 지름" },
  { id: "opacity", label: "불투명도", description: "도장 하나의 최대 농도" },
  { id: "flow", label: "유량", description: "겹쳐 쌓이는 색의 양" },
  { id: "spacing", label: "간격", description: "연속 도장 사이의 거리" },
  { id: "scatter", label: "산포", description: "진행 경로 주변의 퍼짐" },
  { id: "angle", label: "각도", description: "타원형 펜촉이 향하는 방향" },
  { id: "roundness", label: "원형도", description: "펜촉의 납작한 정도" },
] as const;

const SOURCES: readonly {
  id: StudioBrushDynamicsUiSource;
  label: string;
  hint: string;
}[] = [
  { id: "pressure", label: "필압", hint: "펜을 누르는 힘" },
  { id: "tangential-pressure", label: "배럴 압력", hint: "지원 펜의 옆면 압력" },
  { id: "speed", label: "속도", hint: "화면 위 이동 속도" },
  { id: "tilt-magnitude", label: "기울기", hint: "펜을 눕힌 정도" },
  { id: "tilt-azimuth", label: "기울기 방향", hint: "펜을 눕힌 방향" },
  { id: "twist", label: "펜 회전", hint: "지원 펜의 배럴 회전" },
  { id: "direction", label: "획 방향", hint: "현재 획이 진행하는 방향" },
  { id: "random", label: "랜덤", hint: "획마다 재현되는 결정론적 변화" },
] as const;

function isRandomSource(
  source: StudioBrushDynamicsUiSource
): source is "random" {
  return source === "random";
}

function defaultMapping(
  property: StudioBrushDynamicsPropertyKey,
  source: StudioBrushDynamicsSource
): StudioBrushDynamicsMappingSettings {
  if (property === "angle") {
    if (source === "direction" || source === "twist" || source === "tilt-azimuth") {
      return { source, mode: "add", from: 0, to: 360, amount: 1, curve: 1 };
    }
    return { source, mode: "add", from: -20, to: 20, amount: 1, curve: 1 };
  }
  if (property === "roundness" && (source === "tilt" || source === "tilt-magnitude")) {
    return { source, mode: "multiply", from: 1, to: 0.35, amount: 1, curve: 1 };
  }
  if (source === "pressure") {
    return { source, mode: "multiply", from: 0.3, to: 1.7, amount: 1, curve: 1 };
  }
  if (source === "speed") {
    return { source, mode: "multiply", from: 0.8, to: 1.4, amount: 1, curve: 1 };
  }
  if (source === "tilt" || source === "tilt-magnitude") {
    return { source, mode: "multiply", from: 1, to: 0.6, amount: 1, curve: 1 };
  }
  return { source, mode: "multiply", from: 0.85, to: 1.15, amount: 1, curve: 1 };
}

function mappingRange(
  property: StudioBrushDynamicsPropertyKey,
  mapping: NormalizedStudioBrushDynamicsMapping
): { min: number; max: number; step: number } {
  if (mapping.mode === "multiply") return { min: 0, max: 4, step: 0.05 };
  if (property === "angle") return { min: -360, max: 360, step: 5 };
  if (property === "opacity" || property === "flow" || property === "roundness") {
    return { min: -1, max: 1, step: 0.02 };
  }
  return { min: -200, max: 200, step: 1 };
}

function formatMappingValue(
  property: StudioBrushDynamicsPropertyKey,
  mapping: NormalizedStudioBrushDynamicsMapping,
  value: number
): string {
  if (mapping.mode === "multiply") return `${Math.round(value * 100)}%`;
  if (property === "angle") return `${Math.round(value)}°`;
  return `${Math.round(value * 100) / 100}`;
}

function inputIsActive(
  settings: NormalizedStudioBrushDynamicsSettings,
  property: StudioBrushDynamicsPropertyKey,
  source: StudioBrushDynamicsUiSource
): boolean {
  return isRandomSource(source)
    ? settings[property].jitter !== null
    : findStudioBrushDynamicsMapping(settings, property, source) !== null;
}

interface CompactRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

function CompactRange({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: CompactRangeProps) {
  return (
    <label className="block rounded-lg border border-line bg-card/55 px-2.5 py-2">
      <span className="flex items-center justify-between gap-2 text-[0.68rem] font-semibold text-fg-2">
        <span>{label}</span>
        <span className="tabular-nums text-fg">{display}</span>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="mt-1 h-8 w-full cursor-pointer accent-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      />
    </label>
  );
}

function SourceControl({
  settings,
  property,
  propertyLabel,
  source,
  sourceLabel,
  sourceHint,
  onSettingsChange,
}: StudioBrushDynamicsControlsProps & {
  property: StudioBrushDynamicsPropertyKey;
  propertyLabel: string;
  source: StudioBrushDynamicsUiSource;
  sourceLabel: string;
  sourceHint: string;
}) {
  const random = isRandomSource(source);
  const mapping = random
    ? null
    : findStudioBrushDynamicsMapping(settings, property, source);
  const jitter = random ? settings[property].jitter : null;
  const active = random ? jitter !== null : mapping !== null;
  const controlLabel = `${propertyLabel} · ${sourceLabel} 입력`;

  function toggle() {
    if (random) {
      onSettingsChange(updateStudioBrushDynamicsJitter(
        settings,
        property,
        active ? 0 : property === "angle" ? 12 : 0.12,
        property === "angle" ? "add" : "multiply"
      ));
      return;
    }
    onSettingsChange(
      active
        ? removeStudioBrushDynamicsMapping(settings, property, source)
        : updateStudioBrushDynamicsMapping(
            settings,
            property,
            source,
            {},
            defaultMapping(property, source)
          )
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-2 transition-colors",
        active ? "border-accent/45 bg-accent-soft/20" : "border-line bg-card/35"
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${controlLabel} ${active ? "끄기" : "켜기"}`}
        onClick={toggle}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span className="min-w-0">
          <span className="block text-[0.7rem] font-bold text-fg-2">{sourceLabel}</span>
          <span className="block truncate text-[0.61rem] text-fg-3">{sourceHint}</span>
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
            active ? "border-accent bg-accent" : "border-line-strong bg-raised"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-3.5 rounded-full bg-fg transition-transform",
              active ? "translate-x-[17px] bg-on-accent" : "translate-x-0.5"
            )}
          />
        </span>
      </button>

      {active && random && jitter ? (
        <CompactRange
          label={`${controlLabel} 변화량`}
          value={jitter.amount}
          min={0}
          max={property === "angle" ? 180 : 1}
          step={property === "angle" ? 1 : 0.01}
          display={property === "angle"
            ? `${Math.round(jitter.amount)}°`
            : `${Math.round(jitter.amount * 100)}%`}
          onChange={(amount) => onSettingsChange(updateStudioBrushDynamicsJitter(
            settings,
            property,
            amount,
            property === "angle" ? "add" : "multiply"
          ))}
        />
      ) : null}

      {active && !random && mapping ? (
        <details className="group mt-1 rounded-lg border border-line/70 bg-canvas/35">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-2.5 text-[0.66rem] font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
            <span>세부 반응</span>
            <span className="flex items-center gap-1 tabular-nums text-fg-3">
              {formatMappingValue(property, mapping, mapping.from)}
              <span aria-hidden>→</span>
              {formatMappingValue(property, mapping, mapping.to)}
              <ChevronDown
                size={13}
                className="transition-transform group-open:rotate-180"
                aria-hidden
              />
            </span>
          </summary>
          <div className="grid gap-1.5 border-t border-line/70 p-2 sm:grid-cols-2">
            <CompactRange
              label={`${controlLabel} 시작값`}
              value={mapping.from}
              {...mappingRange(property, mapping)}
              display={formatMappingValue(property, mapping, mapping.from)}
              onChange={(from) => onSettingsChange(updateStudioBrushDynamicsMapping(
                settings,
                property,
                source,
                { from },
                defaultMapping(property, source)
              ))}
            />
            <CompactRange
              label={`${controlLabel} 끝값`}
              value={mapping.to}
              {...mappingRange(property, mapping)}
              display={formatMappingValue(property, mapping, mapping.to)}
              onChange={(to) => onSettingsChange(updateStudioBrushDynamicsMapping(
                settings,
                property,
                source,
                { to },
                defaultMapping(property, source)
              ))}
            />
            <CompactRange
              label={`${controlLabel} 영향도`}
              value={mapping.amount}
              min={0}
              max={1}
              step={0.01}
              display={`${Math.round(mapping.amount * 100)}%`}
              onChange={(amount) => onSettingsChange(updateStudioBrushDynamicsMapping(
                settings,
                property,
                source,
                { amount },
                defaultMapping(property, source)
              ))}
            />
            <CompactRange
              label={`${controlLabel} 반응 곡선`}
              value={mapping.curve}
              min={0.05}
              max={4}
              step={0.05}
              display={`${mapping.curve.toFixed(2)}×`}
              onChange={(curve) => onSettingsChange(updateStudioBrushDynamicsMapping(
                settings,
                property,
                source,
                { curve },
                defaultMapping(property, source)
              ))}
            />
            <button
              type="button"
              role="switch"
              aria-checked={mapping.invert}
              aria-label={`${controlLabel} 방향 반전`}
              onClick={() => onSettingsChange(updateStudioBrushDynamicsMapping(
                settings,
                property,
                source,
                { invert: !mapping.invert },
                defaultMapping(property, source)
              ))}
              className={cn(
                "flex min-h-11 items-center justify-between rounded-lg border px-2.5 text-[0.68rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:col-span-2",
                mapping.invert
                  ? "border-accent/45 bg-accent-soft/30 text-fg"
                  : "border-line bg-card/55 text-fg-2"
              )}
            >
              입력 방향 반전
              <span className="text-[0.61rem] font-normal text-fg-3">
                {mapping.invert ? "높은 입력 → 시작값" : "높은 입력 → 끝값"}
              </span>
            </button>
          </div>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Per-output sensor routing for the brush engine. It deliberately stays collapsed by output so
 * the common path remains short while every persisted mapping is reachable without a hidden menu.
 */
export function StudioBrushDynamicsInputMatrix({
  settings,
  onSettingsChange,
}: StudioBrushDynamicsControlsProps) {
  return (
    <details className="group rounded-xl border border-line bg-card/45">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2.5 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <Activity size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-bold text-fg">입력원별 반응</span>
          <span className="block text-[0.65rem] leading-relaxed text-fg-3">
            굵기·농도·간격마다 필압, 속도, 기울기, 랜덤을 따로 연결
          </span>
        </span>
        <ChevronDown
          size={16}
          className="shrink-0 text-fg-3 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-2 border-t border-line p-2.5">
        <p className="rounded-lg bg-canvas/45 px-2.5 py-2 text-[0.63rem] leading-relaxed text-fg-3">
          켠 입력은 위에서 아래 순서로 누적됩니다. 랜덤은 같은 획을 다시 열거나 협업으로
          재생해도 동일하게 복원됩니다.
        </p>
        {OUTPUTS.map((output) => {
          const activeSources = SOURCES.filter((source) => (
            inputIsActive(settings, output.id, source.id)
          ));
          return (
            <details
              key={output.id}
              className="group/output rounded-xl border border-line bg-canvas/35"
            >
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.72rem] font-bold text-fg-2">{output.label}</span>
                  <span className="block truncate text-[0.61rem] text-fg-3">{output.description}</span>
                </span>
                <span className="max-w-[48%] truncate rounded-full border border-line bg-card px-2 py-0.5 text-[0.6rem] text-fg-3">
                  {activeSources.length > 0
                    ? activeSources.map((source) => source.label).join(" · ")
                    : "고정값"}
                </span>
                <ChevronDown
                  size={14}
                  className="shrink-0 text-fg-3 transition-transform group-open/output:rotate-180"
                  aria-hidden
                />
              </summary>
              <div className="grid gap-1.5 border-t border-line p-2 sm:grid-cols-2">
                {SOURCES.map((source) => (
                  <SourceControl
                    key={source.id}
                    settings={settings}
                    property={output.id}
                    propertyLabel={output.label}
                    source={source.id}
                    sourceLabel={source.label}
                    sourceHint={source.hint}
                    onSettingsChange={onSettingsChange}
                  />
                ))}
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}

export function StudioBrushTaperAdvancedControls({
  settings,
  onSettingsChange,
}: StudioBrushDynamicsControlsProps) {
  return (
    <details className="group rounded-xl border border-line bg-card/45">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <Waves size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.72rem] font-bold text-fg-2">테이퍼 세부 조정</span>
          <span className="block text-[0.61rem] text-fg-3">끝 농도와 가늘어지는 곡선</span>
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-fg-3 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="grid gap-1.5 border-t border-line p-2 sm:grid-cols-2">
        <CompactRange
          label="테이퍼 끝 최소 불투명도"
          value={settings.taper.minOpacityRatio}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(settings.taper.minOpacityRatio * 100)}%`}
          onChange={(minOpacityRatio) => onSettingsChange(
            updateStudioBrushDynamicsTaper(settings, { minOpacityRatio })
          )}
        />
        <CompactRange
          label="테이퍼 반응 곡선"
          value={settings.taper.curve}
          min={0.05}
          max={4}
          step={0.05}
          display={`${settings.taper.curve.toFixed(2)}×`}
          onChange={(curve) => onSettingsChange(
            updateStudioBrushDynamicsTaper(settings, { curve })
          )}
        />
      </div>
    </details>
  );
}

export function StudioBrushGrainControls({
  settings,
  onSettingsChange,
}: StudioBrushDynamicsControlsProps) {
  const grainActive = settings.grain.amount > 0;
  return (
    <details className="group rounded-xl border border-line bg-card/45">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <Shuffle size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.72rem] font-bold text-fg-2">표면 그레인</span>
          <span className="block text-[0.61rem] text-fg-3">
            캔버스나 획에 고정되는 재현 가능한 질감
          </span>
        </span>
        <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-[0.6rem] tabular-nums text-fg-3">
          {grainActive ? `${Math.round(settings.grain.amount * 100)}%` : "꺼짐"}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-fg-3 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="space-y-1.5 border-t border-line p-2">
        <div
          role="radiogroup"
          aria-label="그레인 고정 기준"
          className="grid grid-cols-2 gap-1.5"
        >
          {([
            ["canvas-fixed", "캔버스 고정", "문서 좌표에 질감 고정"],
            ["stroke-fixed", "획 고정", "획 시작점을 따라 질감 이동"],
          ] as const).map(([space, label, hint]) => (
            <button
              key={space}
              type="button"
              role="radio"
              aria-checked={settings.grain.space === space}
              onClick={() => onSettingsChange(
                updateStudioBrushDynamicsGrain(settings, { space })
              )}
              className={cn(
                "min-h-12 rounded-lg border px-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                settings.grain.space === space
                  ? "border-accent/50 bg-accent-soft/30 text-fg"
                  : "border-line bg-card/55 text-fg-2"
              )}
            >
              <span className="block text-[0.68rem] font-bold">{label}</span>
              <span className="block text-[0.6rem] text-fg-3">{hint}</span>
            </button>
          ))}
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          <CompactRange
            label="그레인 강도"
            value={settings.grain.amount}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(settings.grain.amount * 100)}%`}
            onChange={(amount) => onSettingsChange(
              updateStudioBrushDynamicsGrain(settings, { amount })
            )}
          />
          <CompactRange
            label="그레인 크기"
            value={settings.grain.scale}
            min={0.25}
            max={512}
            step={0.25}
            display={`${Math.round(settings.grain.scale * 100) / 100}px`}
            onChange={(scale) => onSettingsChange(
              updateStudioBrushDynamicsGrain(settings, { scale })
            )}
          />
          <CompactRange
            label="그레인 대비"
            value={settings.grain.contrast}
            min={0}
            max={1}
            step={0.01}
            display={`${Math.round(settings.grain.contrast * 100)}%`}
            onChange={(contrast) => onSettingsChange(
              updateStudioBrushDynamicsGrain(settings, { contrast })
            )}
          />
        </div>
      </div>
    </details>
  );
}

export function StudioBrushColorDynamicsControls({
  settings,
  onSettingsChange,
}: StudioBrushDynamicsControlsProps) {
  const colorDynamics = settings.colorDynamics;
  const isJitterActive =
    colorDynamics.hueJitter > 0 ||
    colorDynamics.saturationJitter > 0 ||
    colorDynamics.valueJitter > 0 ||
    colorDynamics.foregroundBackgroundJitter > 0;

  return (
    <details
      className="group rounded-xl border border-line bg-card/45"
      data-testid="studio-brush-color-dynamics-controls"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <Sparkles size={15} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[0.72rem] font-bold text-fg-2">
            색상 변화 및 지터 (Color Jitter)
          </span>
          <span className="block text-[0.61rem] text-fg-3">
            CSP 1.10.5 펜촉/획 단위 색조·채도·명도 무작위 변화
          </span>
        </span>
        <span className="rounded-full border border-line bg-raised px-2 py-0.5 text-[0.6rem] tabular-nums text-fg-3">
          {isJitterActive ? "활성" : "꺼짐"}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 text-fg-3 transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="grid gap-1.5 border-t border-line p-2 sm:grid-cols-2">
        <CompactRange
          label="색조 지터 (Hue Jitter)"
          value={colorDynamics.hueJitter}
          min={0}
          max={180}
          step={1}
          display={`${Math.round(colorDynamics.hueJitter)}°`}
          onChange={(hueJitter) =>
            onSettingsChange(
              updateStudioBrushDynamicsColorDynamics(settings, { hueJitter }),
            )
          }
        />
        <CompactRange
          label="채도 지터 (Saturation Jitter)"
          value={colorDynamics.saturationJitter}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(colorDynamics.saturationJitter * 100)}%`}
          onChange={(saturationJitter) =>
            onSettingsChange(
              updateStudioBrushDynamicsColorDynamics(settings, {
                saturationJitter,
              }),
            )
          }
        />
        <CompactRange
          label="명도 지터 (Value Jitter)"
          value={colorDynamics.valueJitter}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(colorDynamics.valueJitter * 100)}%`}
          onChange={(valueJitter) =>
            onSettingsChange(
              updateStudioBrushDynamicsColorDynamics(settings, { valueJitter }),
            )
          }
        />
        <CompactRange
          label="전경/배경색 혼합 지터"
          value={colorDynamics.foregroundBackgroundJitter}
          min={0}
          max={1}
          step={0.01}
          display={`${Math.round(colorDynamics.foregroundBackgroundJitter * 100)}%`}
          onChange={(foregroundBackgroundJitter) =>
            onSettingsChange(
              updateStudioBrushDynamicsColorDynamics(settings, {
                foregroundBackgroundJitter,
              }),
            )
          }
        />
      </div>
    </details>
  );
}

