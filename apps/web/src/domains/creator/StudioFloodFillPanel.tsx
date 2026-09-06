import {
  ChevronDown,
  CircleStop,
  Info,
  Layers3,
  Loader2,
  PaintBucket,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TriangleAlert,
} from "lucide-react";
import { useId } from "react";

import {
  STUDIO_ADVANCED_FILL_LIMITS,
  STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_DESCRIPTIONS,
  STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_LABELS,
  STUDIO_ADVANCED_FILL_REFERENCE_SCOPES,
  STUDIO_ADVANCED_FILL_SETTING_LABELS,
  type StudioAdvancedFillSettingKey,
  type StudioAdvancedFillSettings,
} from "./studio-advanced-fill-settings";

import type { AdvancedFillDiagnostics } from "./studio-advanced-fill";

import { cx } from "@/shared/lib/cx";

export interface StudioFloodFillPanelProps {
  active: boolean;
  busy: boolean;
  fillColor: string;
  settings: StudioAdvancedFillSettings;
  referenceLayerCount: number;
  visibleRasterCount: number;
  selectedIsReference: boolean;
  canToggleSelectedReference?: boolean;
  targetUnsupportedReason?: string | null;
  statusMessage?: string | null;
  diagnostics?: AdvancedFillDiagnostics | null;
  onToggleActive: () => void;
  onFillColorChange: (color: string) => void;
  onSettingsChange: (settings: StudioAdvancedFillSettings) => void;
  onToggleSelectedReference: () => void;
  onResetSettings: () => void;
}

const DIAGNOSTIC_STATUS_LABELS: Readonly<Record<AdvancedFillDiagnostics["status"], string>> = {
  applied: "채우기 적용",
  noop: "변경 없음",
  empty: "채울 영역 없음",
  "leak-guarded": "누수 보호 작동",
  aborted: "채우기 취소",
};

const controlFocusClass =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

function safeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return "0%";
  const normalized = Math.min(1, Math.max(0, value));
  return `${Math.round(normalized * 1_000) / 10}%`;
}

function formatPixelCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return Math.floor(value).toLocaleString("ko-KR");
}

function formatSignedPixels(value: number): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}px`;
}

function ToggleSetting({
  checked,
  disabled,
  label,
  description,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cx(
        "grid min-h-11 min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-left",
        "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span className="min-w-0">
        <span className="block text-xs font-semibold text-fg-2">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-fg-3">
            {description}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className={cx(
          "size-5 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed",
          controlFocusClass
        )}
      />
    </label>
  );
}

/**
 * 메인 캔버스용 고급 채우기 설정 패널.
 *
 * 실제 픽셀 계산과 히스토리 커밋은 StudioPage가 담당하고, 이 컴포넌트는 도구 상태·설정·진단을
 * 접근 가능한 제어로만 표현한다. 따라서 별도 미리보기 캔버스나 독립 이미지 상태를 만들지 않는다.
 */
export function StudioFloodFillPanel({
  active,
  busy,
  fillColor,
  settings,
  referenceLayerCount,
  visibleRasterCount,
  selectedIsReference,
  canToggleSelectedReference = true,
  targetUnsupportedReason = null,
  statusMessage = null,
  diagnostics = null,
  onToggleActive,
  onFillColorChange,
  onSettingsChange,
  onToggleSelectedReference,
  onResetSettings,
}: StudioFloodFillPanelProps) {
  const titleId = useId();
  const toolHelpId = useId();
  const unsupportedId = useId();
  const scopeId = useId();
  const scopeHelpId = useId();
  const toleranceId = useId();
  const expansionId = useId();
  const closeGapId = useId();
  const leakRatioId = useId();

  const safeReferenceLayerCount = safeCount(referenceLayerCount);
  const safeVisibleRasterCount = safeCount(visibleRasterCount);
  const selectedScopeUnavailable =
    (settings.referenceScope === "reference" && safeReferenceLayerCount === 0) ||
    (settings.referenceScope === "all-visible" && safeVisibleRasterCount === 0);
  const hasAccumulatedPreview = statusMessage?.startsWith("누적 미리보기") ?? false;
  const cannotArm = Boolean(targetUnsupportedReason);
  // A missing reference is precisely when the artist needs this control. Keep designation available
  // even when the fill tool itself cannot arm; the panel is rendered only for an image selection.
  const referenceToggleDisabled = busy;

  function updateSetting<Key extends StudioAdvancedFillSettingKey>(
    key: Key,
    value: StudioAdvancedFillSettings[Key]
  ) {
    onSettingsChange({ ...settings, [key]: value });
  }

  const primaryDescriptionIds = [toolHelpId];
  if (targetUnsupportedReason) primaryDescriptionIds.push(unsupportedId);

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      className="w-full min-w-0 overflow-hidden rounded-xl border border-line bg-panel/60"
    >
      <header className="border-b border-line px-3 py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
              <PaintBucket size={16} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 id={titleId} className="text-sm font-bold text-fg">
                고급 채우기
              </h3>
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
                메인 캔버스에서 선화 안쪽을 바로 채웁니다.
              </p>
            </div>
          </div>
          <span
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-full border border-good/30 bg-good/10 px-2 text-[0.64rem] font-semibold text-good"
            title="이미지와 설정은 서버로 전송되지 않습니다."
          >
            <ShieldCheck size={12} aria-hidden="true" />
            브라우저 로컬
          </span>
        </div>
      </header>

      <div className="space-y-3 p-3">
        <div>
          <button
            type="button"
            aria-pressed={active}
            aria-describedby={primaryDescriptionIds.join(" ")}
            onClick={onToggleActive}
            disabled={!active && (busy || cannotArm)}
            className={cx(
              "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold transition-colors",
              controlFocusClass,
              active
                ? "border border-accent/45 bg-accent-soft text-accent hover:bg-accent-soft/70"
                : "border border-accent bg-accent text-on-accent hover:bg-accent-2",
              "disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-fg-3 disabled:opacity-60"
            )}
          >
            {busy ? (
              <Loader2
                size={16}
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : active ? (
              <CircleStop size={16} aria-hidden="true" />
            ) : (
              <PaintBucket size={16} aria-hidden="true" />
            )}
            {busy
              ? active
                ? "계산 취소"
                : "계산 중…"
              : active
                ? "채우기 도구 종료"
                : "캔버스에서 채우기"}
          </button>
          <p id={toolHelpId} className="mt-1.5 text-center text-[0.67rem] leading-relaxed text-fg-3">
            {busy
              ? active
                ? "진행 중에도 이 버튼으로 계산과 채우기 도구를 종료할 수 있습니다."
                : "이전 계산이 끝나면 채우기 도구를 다시 켤 수 있습니다."
              : active
                ? "캔버스를 탭하면 현재 설정으로 채웁니다."
                : "도구를 켠 다음 채울 영역을 캔버스에서 탭하세요."}
          </p>
        </div>

        {targetUnsupportedReason ? (
          <p
            id={unsupportedId}
            role="alert"
            className="flex min-h-11 min-w-0 items-start gap-2 rounded-lg border border-warn/35 bg-warn/10 px-3 py-2 text-[0.68rem] leading-relaxed text-warn"
          >
            <TriangleAlert size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{targetUnsupportedReason}</span>
          </p>
        ) : null}

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_4rem] items-end gap-2">
          <div className="min-w-0 pb-1">
            <label htmlFor={`${scopeId}-color`} className="block text-xs font-semibold text-fg-2">
              채우기 색상
            </label>
            <span className="mt-1 block truncate font-mono text-[0.68rem] tabular-nums text-fg-3">
              {fillColor.toUpperCase()}
            </span>
          </div>
          <input
            id={`${scopeId}-color`}
            type="color"
            aria-label="채우기 색상 선택"
            value={fillColor}
            disabled={busy}
            onChange={(event) => onFillColorChange(event.currentTarget.value)}
            className={cx(
              "h-11 w-16 cursor-pointer rounded-lg border border-line bg-card p-1 transition-colors hover:border-line-strong",
              "disabled:cursor-not-allowed disabled:opacity-50",
              controlFocusClass
            )}
          />
        </div>

        <div className="min-w-0">
          <label htmlFor={scopeId} className="mb-1.5 block text-xs font-semibold text-fg-2">
            {STUDIO_ADVANCED_FILL_SETTING_LABELS.referenceScope}
          </label>
          <div className="relative min-w-0">
            <Layers3
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3"
              aria-hidden="true"
            />
            <select
              id={scopeId}
              aria-describedby={scopeHelpId}
              aria-invalid={selectedScopeUnavailable || undefined}
              value={settings.referenceScope}
              disabled={busy}
              onChange={(event) =>
                updateSetting(
                  "referenceScope",
                  event.currentTarget.value as StudioAdvancedFillSettings["referenceScope"]
                )
              }
              className={cx(
                "min-h-11 w-full min-w-0 truncate rounded-lg border border-line bg-card py-2 pl-9 pr-8 text-xs font-semibold text-fg outline-none transition-colors",
                "hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-50",
                selectedScopeUnavailable && "border-warn/50",
                controlFocusClass
              )}
            >
              {STUDIO_ADVANCED_FILL_REFERENCE_SCOPES.map((scope) => {
                const layerCount =
                  scope === "reference"
                    ? safeReferenceLayerCount
                    : scope === "all-visible"
                      ? safeVisibleRasterCount
                      : null;
                const unavailable = layerCount === 0;
                return (
                  <option key={scope} value={scope} disabled={unavailable}>
                    {STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_LABELS[scope]}
                    {layerCount === null ? "" : ` · ${layerCount}`}
                  </option>
                );
              })}
            </select>
          </div>
          <p
            id={scopeHelpId}
            className={cx(
              "mt-1.5 text-[0.67rem] leading-relaxed",
              selectedScopeUnavailable ? "text-warn" : "text-fg-3"
            )}
          >
            {selectedScopeUnavailable
              ? "선택한 참조 범위에 사용할 수 있는 레이어가 없습니다."
              : STUDIO_ADVANCED_FILL_REFERENCE_SCOPE_DESCRIPTIONS[settings.referenceScope]}
          </p>
        </div>

        <fieldset disabled={busy} className="min-w-0 border-y border-line/70 py-3">
          <legend className="sr-only">기본 채우기 설정</legend>
          <div className="space-y-1">
            <div className="block min-w-0">
              <span className="flex min-w-0 items-center justify-between gap-3 text-xs">
                <span
                  id={`${toleranceId}-label`}
                  className="truncate font-semibold text-fg-2"
                >
                  {STUDIO_ADVANCED_FILL_SETTING_LABELS.tolerance}
                </span>
                <output
                  htmlFor={toleranceId}
                  className="shrink-0 font-mono font-semibold tabular-nums text-fg"
                >
                  {settings.tolerance}
                </output>
              </span>
              <input
                id={toleranceId}
                type="range"
                aria-labelledby={`${toleranceId}-label`}
                min={STUDIO_ADVANCED_FILL_LIMITS.tolerance.min}
                max={STUDIO_ADVANCED_FILL_LIMITS.tolerance.max}
                step={STUDIO_ADVANCED_FILL_LIMITS.tolerance.step}
                value={settings.tolerance}
                onChange={(event) => updateSetting("tolerance", Number(event.currentTarget.value))}
                className={cx(
                  "h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50",
                  controlFocusClass
                )}
              />
            </div>

            <div className="block min-w-0">
              <span className="flex min-w-0 items-center justify-between gap-3 text-xs">
                <span
                  id={`${expansionId}-label`}
                  className="truncate font-semibold text-fg-2"
                >
                  {STUDIO_ADVANCED_FILL_SETTING_LABELS.expansionPx}
                </span>
                <output
                  htmlFor={expansionId}
                  className="shrink-0 font-mono font-semibold tabular-nums text-fg"
                >
                  {formatSignedPixels(settings.expansionPx)}
                </output>
              </span>
              <input
                id={expansionId}
                type="range"
                aria-labelledby={`${expansionId}-label`}
                min={STUDIO_ADVANCED_FILL_LIMITS.expansionPx.min}
                max={STUDIO_ADVANCED_FILL_LIMITS.expansionPx.max}
                step={STUDIO_ADVANCED_FILL_LIMITS.expansionPx.step}
                value={settings.expansionPx}
                onChange={(event) =>
                  updateSetting("expansionPx", Number(event.currentTarget.value))
                }
                className={cx(
                  "h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50",
                  controlFocusClass
                )}
              />
            </div>

            <div className="block min-w-0">
              <span className="flex min-w-0 items-center justify-between gap-3 text-xs">
                <span
                  id={`${closeGapId}-label`}
                  className="truncate font-semibold text-fg-2"
                >
                  {STUDIO_ADVANCED_FILL_SETTING_LABELS.closeGapPx}
                </span>
                <output
                  htmlFor={closeGapId}
                  className="shrink-0 font-mono font-semibold tabular-nums text-fg"
                >
                  {settings.closeGapPx}px
                </output>
              </span>
              <input
                id={closeGapId}
                type="range"
                aria-labelledby={`${closeGapId}-label`}
                min={STUDIO_ADVANCED_FILL_LIMITS.closeGapPx.min}
                max={STUDIO_ADVANCED_FILL_LIMITS.closeGapPx.max}
                step={STUDIO_ADVANCED_FILL_LIMITS.closeGapPx.step}
                value={settings.closeGapPx}
                onChange={(event) => updateSetting("closeGapPx", Number(event.currentTarget.value))}
                className={cx(
                  "h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-50",
                  controlFocusClass
                )}
              />
            </div>
          </div>
        </fieldset>

        <details className="group/fill-advanced min-w-0 border-b border-line/70">
          <summary
            className={cx(
              "flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-semibold text-fg-2 marker:content-none",
              "hover:text-fg",
              controlFocusClass
            )}
          >
            <SlidersHorizontal size={15} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">고급 설정</span>
            <ChevronDown
              size={15}
              className="shrink-0 transition-transform duration-200 group-open/fill-advanced:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <fieldset disabled={busy} className="min-w-0 pb-3">
            <legend className="sr-only">고급 채우기 설정</legend>
            <div className="divide-y divide-line/50">
              <ToggleSetting
                checked={settings.contiguous}
                disabled={busy}
                label={STUDIO_ADVANCED_FILL_SETTING_LABELS.contiguous}
                description="시드와 이어진 영역만 채웁니다."
                onChange={(checked) => updateSetting("contiguous", checked)}
              />
              <ToggleSetting
                checked={settings.antiAlias}
                disabled={busy}
                label={STUDIO_ADVANCED_FILL_SETTING_LABELS.antiAlias}
                description="채운 영역의 외곽 픽셀을 부드럽게 정리합니다."
                onChange={(checked) => updateSetting("antiAlias", checked)}
              />
              <ToggleSetting
                checked={settings.continuousFill}
                disabled={busy}
                label={STUDIO_ADVANCED_FILL_SETTING_LABELS.continuousFill}
                description="한 번 채운 뒤에도 도구를 켜 둡니다."
                onChange={(checked) => updateSetting("continuousFill", checked)}
              />
              <ToggleSetting
                checked={settings.leakGuard}
                disabled={busy}
                label={STUDIO_ADVANCED_FILL_SETTING_LABELS.leakGuard}
                description="예상보다 넓게 번진 결과는 적용 전에 차단합니다."
                onChange={(checked) => updateSetting("leakGuard", checked)}
              />
              <div
                className={cx("block min-w-0 py-2", !settings.leakGuard && "opacity-50")}
              >
                <span className="flex min-w-0 items-center justify-between gap-3 text-xs">
                  <span
                    id={`${leakRatioId}-label`}
                    className="truncate font-semibold text-fg-2"
                  >
                    {STUDIO_ADVANCED_FILL_SETTING_LABELS.leakGuardMaxFillRatio}
                  </span>
                  <output
                    htmlFor={leakRatioId}
                    className="shrink-0 font-mono font-semibold tabular-nums text-fg"
                  >
                    {formatPercent(settings.leakGuardMaxFillRatio)}
                  </output>
                </span>
                <input
                  id={leakRatioId}
                  type="range"
                  aria-labelledby={`${leakRatioId}-label`}
                  min={STUDIO_ADVANCED_FILL_LIMITS.leakGuardMaxFillRatio.min}
                  max={STUDIO_ADVANCED_FILL_LIMITS.leakGuardMaxFillRatio.max}
                  step={STUDIO_ADVANCED_FILL_LIMITS.leakGuardMaxFillRatio.step}
                  value={settings.leakGuardMaxFillRatio}
                  disabled={busy || !settings.leakGuard}
                  onChange={(event) =>
                    updateSetting("leakGuardMaxFillRatio", Number(event.currentTarget.value))
                  }
                  className={cx(
                    "h-11 w-full cursor-pointer accent-accent disabled:cursor-not-allowed",
                    controlFocusClass
                  )}
                />
              </div>
              <ToggleSetting
                checked={settings.treatCanvasEdgeAsBoundary}
                disabled={busy}
                label={STUDIO_ADVANCED_FILL_SETTING_LABELS.treatCanvasEdgeAsBoundary}
                description="열린 선이 캔버스 밖으로 새는 것을 줄입니다."
                onChange={(checked) => updateSetting("treatCanvasEdgeAsBoundary", checked)}
              />
            </div>
            <button
              type="button"
              onClick={onResetSettings}
              disabled={busy}
              className={cx(
                "mt-2 inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors",
                "hover:border-line-strong hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-50",
                controlFocusClass
              )}
            >
              <RotateCcw size={14} aria-hidden="true" />
              고급 채우기 설정 초기화
            </button>
          </fieldset>
        </details>

        {canToggleSelectedReference ? (
          <button
            type="button"
            aria-pressed={selectedIsReference}
            aria-describedby={targetUnsupportedReason ? unsupportedId : undefined}
            onClick={onToggleSelectedReference}
            disabled={referenceToggleDisabled}
            className={cx(
              "inline-flex min-h-11 w-full min-w-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold transition-colors",
              selectedIsReference
                ? "border-cool/40 bg-cool/10 text-cool hover:bg-cool/15"
                : "border-line bg-card text-fg-2 hover:border-line-strong hover:bg-raised hover:text-fg",
              "disabled:cursor-not-allowed disabled:opacity-50",
              controlFocusClass
            )}
          >
            <Target size={15} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">
              {selectedIsReference ? "선택 레이어 참조 해제" : "선택 레이어를 참조로 설정"}
            </span>
            <span className="shrink-0 font-mono text-[0.65rem] tabular-nums opacity-75">
              {safeReferenceLayerCount}
            </span>
          </button>
        ) : null}

        <p className="flex min-w-0 items-start gap-2 border-y border-line/60 py-2.5 text-[0.67rem] leading-relaxed text-fg-3">
          <Info size={14} className="mt-0.5 shrink-0 text-cool" aria-hidden="true" />
          <span className="min-w-0 break-words">
            ‘표시 래스터’는 보이는 래스터 원본만 합성하고 편집 대상은 제외합니다. 필터·마스크·기울임
            변형·혼합 모드·아래 레이어 클리핑·페이지 색보정은 아직 참조 이미지에 굽지 않습니다.
          </span>
        </p>

        {statusMessage || diagnostics || busy ? (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={cx(
              "min-w-0 rounded-lg border px-3 py-2 text-[0.68rem] leading-relaxed",
              busy
                ? "border-line bg-card text-fg-2"
                : diagnostics?.status === "applied"
                ? "border-good/30 bg-good/10 text-good"
                : diagnostics?.status === "leak-guarded"
                  ? "border-warn/35 bg-warn/10 text-warn"
                  : "border-line bg-card text-fg-2"
            )}
          >
            <div className="flex min-w-0 items-start gap-2">
              {busy ? (
                <Loader2
                  size={14}
                  className="mt-0.5 shrink-0 animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : diagnostics?.status === "leak-guarded" ? (
                <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <PaintBucket size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span className="min-w-0 break-words">
                {statusMessage ??
                  (busy
                    ? "영역을 계산하고 있어요."
                    : diagnostics
                      ? DIAGNOSTIC_STATUS_LABELS[diagnostics.status]
                      : null)}
              </span>
            </div>
            {diagnostics ? (
              <dl className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 border-t border-current/15 pt-2 font-mono text-[0.64rem] tabular-nums">
                <div className="flex gap-1">
                  <dt className="font-sans opacity-75">{hasAccumulatedPreview ? "이번 적용" : "적용"}</dt>
                  <dd>{formatPixelCount(diagnostics.paintedPixelCount)}px</dd>
                </div>
                <div className="flex gap-1">
                  <dt className="font-sans opacity-75">
                    {diagnostics.leakGuard.triggered ? "검사 면적" : "최종 면적"}
                  </dt>
                  <dd>
                    {formatPercent(
                      diagnostics.leakGuard.triggered
                        ? diagnostics.matched.areaRatio
                        : diagnostics.final.areaRatio
                    )}
                  </dd>
                </div>
                <div className="flex gap-1">
                  <dt className="font-sans opacity-75">참조</dt>
                  <dd>{diagnostics.referenceSource === "reference-image" ? "합성" : "대상"}</dd>
                </div>
                {diagnostics.final.touchesCanvasEdge ? (
                  <div className="flex gap-1">
                    <dt className="font-sans opacity-75">경계</dt>
                    <dd>캔버스 접촉</dd>
                  </div>
                ) : null}
              </dl>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
