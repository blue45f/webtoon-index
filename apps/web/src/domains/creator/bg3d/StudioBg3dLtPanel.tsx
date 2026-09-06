import { StudioThreeDToggleIndicator } from "../StudioThreeDToggle";

import {
  STUDIO_BG3D_CONTROL_BUTTON as CONTROL_BUTTON,
  roundStudioBg3dNumber as round,
  studioBg3dClassNames as cx,
} from "./studio-bg3d-editor-ui";

import type {
  StudioBg3dLtPreset,
  StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";
import type {
  StudioBg3dLineOutputSettings,
  StudioBg3dSceneDocument,
  StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";
import type { CSSProperties } from "react";

type LtUserPresetLibraryStatus = "idle" | "ready" | "saving" | "memory-only";
type LtUserPresetNotice = Readonly<{
  tone: "info" | "success" | "error";
  message: string;
  presetId?: string;
}>;
type LtEditorSection = "line" | "tone";

interface StudioBg3dLtPanelContext {
  readonly ScanLine: typeof import("lucide-react").ScanLine;
  readonly WandSparkles: typeof import("lucide-react").WandSparkles;
  readonly magicLayerEnabled: boolean;
  readonly setMagicLayerEnabled: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly magicLayerUnavailableReason: string | null;
  readonly magicLayerSelectionName: string | null;
  readonly magicLayerBusy: boolean;
  readonly appliedLtPresetId: string;
  readonly applyLtPreset: (presetId: string) => void;
  readonly STUDIO_BG3D_LT_BUILT_IN_PRESETS: readonly StudioBg3dLtPreset[];
  readonly ltUserPresetPayload: StudioBg3dLtPresetPayload;
  readonly appliedLtPreset: StudioBg3dLtPreset | null;
  readonly Save: typeof import("lucide-react").Save;
  readonly STUDIO_BG3D_LT_PRESET_MAX_COUNT: number;
  readonly ltUserPresetLibraryStatus: LtUserPresetLibraryStatus;
  readonly ChevronDown: typeof import("lucide-react").ChevronDown;
  readonly managedLtUserPreset: StudioBg3dLtPreset | null;
  readonly STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH: number;
  readonly ltUserPresetName: string;
  readonly setLtUserPresetName: import("react").Dispatch<import("react").SetStateAction<string>>;
  readonly setLtDeleteConfirmId: import("react").Dispatch<import("react").SetStateAction<string | null>>;
  readonly STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH: number;
  readonly ltUserPresetDescription: string;
  readonly setLtUserPresetDescription: import("react").Dispatch<import("react").SetStateAction<string>>;
  readonly updateManagedLtUserPreset: () => void;
  readonly renameManagedLtUserPreset: () => void;
  readonly PencilLine: typeof import("lucide-react").PencilLine;
  readonly ltDeleteConfirmId: string | null;
  readonly deleteManagedLtUserPreset: () => void;
  readonly Trash2: typeof import("lucide-react").Trash2;
  readonly saveCurrentLtAsUserPreset: () => void;
  readonly ltUserPresetNotice: LtUserPresetNotice | null;
  readonly ltCaptureSizePreview: import("./studio-bg3d-lt-capture-size").StudioBg3dLtCaptureSize | null;
  readonly sceneBaseDocument: StudioBg3dSceneDocument;
  readonly updateLtExportHeight: (exportHeight: number) => void;
  readonly LT_EXPORT_HEIGHTS: readonly [640, 1080, 1440, 2160, 4096];
  readonly ltExportAspectRatio: number | null;
  readonly ltCaptureAspectPresetId: string;
  readonly ltCaptureAspectPresets: readonly import( "./studio-bg3d-capture-frame-geometry").StudioBg3dCaptureAspectPreset[];
  readonly updateLtExportAspectRatio: (exportAspectRatio: number | null) => void;
  readonly ltLineSettings: StudioBg3dLineOutputSettings;
  readonly LT_TONE_MODE_LABELS: Record<import( "./studio-bg3d-scene-document").StudioBg3dToneMode, string>;
  readonly ltToneSettings: StudioBg3dToneOutputSettings;
  readonly LT_TONE_TYPE_LABELS: Record<import( "./studio-bg3d-scene-document").StudioBg3dToneOutputType, string>;
  readonly lineArtPreview: boolean;
  readonly setLineArtPreview: import("react").Dispatch<import("react").SetStateAction<boolean>>;
  readonly ltTonePreviewStyle: (tone: StudioBg3dToneOutputSettings) => CSSProperties;
  readonly ltEditorSection: LtEditorSection;
  readonly setLtEditorSection: import("react").Dispatch<import("react").SetStateAction<LtEditorSection>>;
  readonly LtToggleRow: typeof import("./studio-bg3d-control-fields").LtToggleRow;
  readonly updateLtLineSettings: (patch: Partial<StudioBg3dLineOutputSettings>) => void;
  readonly LtRangeControl: typeof import("./studio-bg3d-control-fields").LtRangeControl;
  readonly updateLtToneSettings: (patch: Partial<StudioBg3dToneOutputSettings>) => void;
  readonly LT_TONE_PATTERN_LABELS: Record<import( "./studio-bg3d-scene-document").StudioBg3dTonePattern, string>;
}

interface StudioBg3dMagicLayerControlProps {
  readonly WandSparkles: typeof import("lucide-react").WandSparkles;
  readonly enabled: boolean;
  readonly unavailableReason: string | null;
  readonly selectionName: string | null;
  readonly busy: boolean;
  readonly onToggle: () => void;
}

export function StudioBg3dMagicLayerControl({
  WandSparkles,
  enabled,
  unavailableReason,
  selectionName,
  busy,
  onToggle,
}: StudioBg3dMagicLayerControlProps) {
  const unavailable = unavailableReason !== null;
  const disabled = busy || (!enabled && unavailable);
  const visualState = busy
    ? "busy"
    : enabled
      ? unavailable
        ? "needs-attention"
        : "enabled"
      : unavailable
        ? "unavailable"
        : "available";
  const status = busy
    ? "3D 배경을 처리하는 동안에는 이 설정을 바꿀 수 없어요. 작업이 끝나면 다시 변경할 수 있습니다."
    : unavailableReason
      ? enabled
        ? `${unavailableReason} 이 옵션을 끄거나 선택을 바로잡아 주세요.`
        : unavailableReason
      : enabled
        ? `“${selectionName ?? "선택 객체"}”를 동일 프레임에서 정밀 분리합니다.`
        : "한 객체에만 색보정·블러·톤 효과를 걸고 싶을 때 켜세요.";

  return (
    <div
      data-state={visualState}
      className={cx(
        "mt-3 rounded-xl border p-3 transition-colors motion-reduce:transition-none",
        enabled
          ? "border-accent/45 bg-accent-soft"
          : unavailable || busy
            ? "border-line bg-card/55"
            : "border-accent/25 bg-accent/5",
      )}
    >
      <button
        id="bg3d-magic-layer"
        type="button"
        role="switch"
        aria-busy={busy}
        aria-checked={enabled}
        aria-labelledby="bg3d-magic-layer-label"
        aria-describedby="bg3d-magic-layer-description bg3d-magic-layer-status"
        disabled={disabled}
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed"
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span
            id="bg3d-magic-layer-label"
            className={cx(
              "flex items-center gap-1.5 text-xs font-bold",
              enabled || (!unavailable && !busy) ? "text-fg" : "text-fg-2",
            )}
          >
            <WandSparkles
              size={14}
              className={cx(
                "shrink-0",
                enabled || (!unavailable && !busy) ? "text-accent" : "text-fg-3",
              )}
              aria-hidden
            />
            선택 객체 매직 마스크
          </span>
          <span
            id="bg3d-magic-layer-description"
            className="mt-0.5 block text-xs leading-relaxed text-fg-3"
          >
            컬러 레이어에 편집 가능한 필터 범위를 함께 만듭니다.
          </span>
        </span>
        <StudioThreeDToggleIndicator checked={enabled} />
      </button>
      <p
        id="bg3d-magic-layer-status"
        aria-live="polite"
        aria-atomic="true"
        className={cx(
          "mt-1.5 text-xs leading-relaxed",
          enabled && unavailable ? "text-warn" : "text-fg-2",
        )}
      >
        {status}
      </p>
    </div>
  );
}

export interface StudioBg3dLtPanelProps {
  readonly hidden: boolean;
  readonly context: StudioBg3dLtPanelContext;
}

export function StudioBg3dLtPanel({
  hidden,
  context,
}: StudioBg3dLtPanelProps) {
  const {
    ScanLine,
    WandSparkles,
    magicLayerEnabled,
    setMagicLayerEnabled,
    magicLayerUnavailableReason,
    magicLayerSelectionName,
    magicLayerBusy,
    appliedLtPresetId,
    applyLtPreset,
    STUDIO_BG3D_LT_BUILT_IN_PRESETS,
    ltUserPresetPayload,
    appliedLtPreset,
    Save,
    STUDIO_BG3D_LT_PRESET_MAX_COUNT,
    ltUserPresetLibraryStatus,
    ChevronDown,
    managedLtUserPreset,
    STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH,
    ltUserPresetName,
    setLtUserPresetName,
    setLtDeleteConfirmId,
    STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH,
    ltUserPresetDescription,
    setLtUserPresetDescription,
    updateManagedLtUserPreset,
    renameManagedLtUserPreset,
    PencilLine,
    ltDeleteConfirmId,
    deleteManagedLtUserPreset,
    Trash2,
    saveCurrentLtAsUserPreset,
    ltUserPresetNotice,
    ltCaptureSizePreview,
    sceneBaseDocument,
    updateLtExportHeight,
    LT_EXPORT_HEIGHTS,
    ltExportAspectRatio,
    ltCaptureAspectPresetId,
    ltCaptureAspectPresets,
    updateLtExportAspectRatio,
    ltLineSettings,
    LT_TONE_MODE_LABELS,
    ltToneSettings,
    LT_TONE_TYPE_LABELS,
    lineArtPreview,
    setLineArtPreview,
    ltTonePreviewStyle,
    ltEditorSection,
    setLtEditorSection,
    LtToggleRow,
    updateLtLineSettings,
    LtRangeControl,
    updateLtToneSettings,
    LT_TONE_PATTERN_LABELS,
  } = context;

  return (
<section hidden={hidden}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold text-fg">
                    <ScanLine size={15} className="text-accent" aria-hidden />
                    렌더/LT 변환
                  </h3>
                  <span className="rounded-full border border-line bg-card px-2 py-1 text-[0.64rem] font-semibold text-fg-3">
                    장면 설정 v1
                  </span>
                </div>
                <p className="mt-1.5 text-[0.68rem] leading-relaxed text-fg-3">
                  3D 배경의 컬러·선화·톤 출력 의도를 저장합니다. 프리셋 적용 뒤 필요한 값만 조정하세요.
                </p>

                <StudioBg3dMagicLayerControl
                  WandSparkles={WandSparkles}
                  enabled={magicLayerEnabled}
                  unavailableReason={magicLayerUnavailableReason}
                  selectionName={magicLayerSelectionName}
                  busy={magicLayerBusy}
                  onToggle={() => setMagicLayerEnabled((enabled) => !enabled)}
                />

                <label htmlFor="bg3d-lt-preset" className="mt-3 block text-xs font-semibold text-fg-2">
                  변환 프리셋
                  <select
                    id="bg3d-lt-preset"
                    value={appliedLtPresetId}
                    className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-card px-3 text-xs font-semibold text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                    onChange={(event) => {
                      if (event.target.value !== "custom") applyLtPreset(event.target.value);
                    }}
                  >
                    <option value="custom" disabled>
                      사용자 설정
                    </option>
                    <optgroup label="기본 프리셋">
                      {STUDIO_BG3D_LT_BUILT_IN_PRESETS.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </optgroup>
                    {ltUserPresetPayload.presets.length > 0 ? (
                      <optgroup label={`내 프리셋 · ${ltUserPresetPayload.presets.length}개`}>
                        {ltUserPresetPayload.presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                  </select>
                </label>
                <p className="mt-2 min-h-8 text-[0.68rem] leading-relaxed text-fg-3">
                  {appliedLtPreset?.description ?? "프리셋을 기준으로 값을 직접 조정한 사용자 설정입니다."}
                </p>
                <p aria-live="polite" aria-atomic="true" className="sr-only">
                  {appliedLtPreset ? `${appliedLtPreset.name} 프리셋 적용됨` : "LT 사용자 설정 적용됨"}
                </p>

                <details className="group mt-3 rounded-xl border border-line bg-card/45">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-bold text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    <span className="flex items-center gap-1.5">
                      <Save size={14} className="text-accent" aria-hidden />
                      내 프리셋
                    </span>
                    <span className="flex items-center gap-1 text-[0.64rem] font-normal text-fg-3">
                      {ltUserPresetPayload.presets.length}/{STUDIO_BG3D_LT_PRESET_MAX_COUNT}
                      {ltUserPresetLibraryStatus === "idle" ? " · SQLite 불러오는 중" : ""}
                      {ltUserPresetLibraryStatus === "saving" ? " · SQLite 저장 중" : ""}
                      {ltUserPresetLibraryStatus === "memory-only" ? " · 현재 탭 메모리 임시" : ""}
                      <ChevronDown className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" size={13} aria-hidden />
                    </span>
                  </summary>
                  <div className="border-t border-line/70 px-3 py-3">
                    <p className="text-[0.68rem] leading-relaxed text-fg-3">
                      {managedLtUserPreset
                        ? `“${managedLtUserPreset.name}”을 관리 중입니다. 현재 LT 값을 덮어쓰거나 이름만 바꿀 수 있어요.`
                        : "현재 선화·톤 값을 새 사용자 프리셋으로 저장합니다."}
                    </p>
                    <label htmlFor="bg3d-lt-user-preset-name" className="mt-3 block text-xs font-semibold text-fg-2">
                      이름
                      <input
                        id="bg3d-lt-user-preset-name"
                        type="text"
                        required
                        maxLength={STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH}
                        value={ltUserPresetName}
                        className="mt-1.5 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-xs text-fg placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                        placeholder="예: 야간 골목 선화"
                        onChange={(event) => {
                          setLtUserPresetName(event.target.value);
                          setLtDeleteConfirmId(null);
                        }}
                      />
                    </label>
                    <label htmlFor="bg3d-lt-user-preset-description" className="mt-3 block text-xs font-semibold text-fg-2">
                      설명
                      <textarea
                        id="bg3d-lt-user-preset-description"
                        required
                        rows={2}
                        maxLength={STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH}
                        value={ltUserPresetDescription}
                        className="mt-1.5 min-h-20 w-full resize-y rounded-lg border border-line bg-panel px-3 py-2.5 text-xs leading-relaxed text-fg placeholder:text-fg-3 focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        placeholder="어떤 장면과 작업 단계에 쓰는 설정인지 기록하세요."
                        onChange={(event) => {
                          setLtUserPresetDescription(event.target.value);
                          setLtDeleteConfirmId(null);
                        }}
                      />
                    </label>
                    <div className="mt-1 flex justify-end gap-3 text-[0.62rem] tabular-nums text-fg-3">
                      <span>이름 {Array.from(ltUserPresetName).length}/{STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH}</span>
                      <span>설명 {Array.from(ltUserPresetDescription).length}/{STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH}</span>
                    </div>

                    {managedLtUserPreset ? (
                      <div className="mt-3 space-y-2">
                        <button
                          type="button"
                          className={cx(CONTROL_BUTTON, "w-full border-accent/55 bg-accent text-on-accent hover:bg-accent/90")}
                          disabled={ltUserPresetLibraryStatus === "idle"}
                          onClick={updateManagedLtUserPreset}
                        >
                          <Save size={14} aria-hidden />
                          현재 설정으로 업데이트
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            className={cx(CONTROL_BUTTON, "border-line bg-panel text-fg-2 hover:bg-raised hover:text-fg")}
                            disabled={ltUserPresetLibraryStatus === "idle"}
                            onClick={renameManagedLtUserPreset}
                          >
                            <PencilLine size={14} aria-hidden />
                            이름만 변경
                          </button>
                          <button
                            type="button"
                            className={cx(
                              CONTROL_BUTTON,
                              ltDeleteConfirmId === managedLtUserPreset.id
                                ? "border-bad/60 bg-[oklch(0.66_0.20_25/0.12)] text-bad"
                                : "border-line bg-panel text-fg-3 hover:bg-raised hover:text-bad"
                            )}
                            disabled={ltUserPresetLibraryStatus === "idle"}
                            onClick={deleteManagedLtUserPreset}
                          >
                            <Trash2 size={14} aria-hidden />
                            {ltDeleteConfirmId === managedLtUserPreset.id ? "삭제 확인" : "삭제"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={cx(CONTROL_BUTTON, "mt-3 w-full border-accent/55 bg-accent text-on-accent hover:bg-accent/90")}
                        disabled={
                          ltUserPresetLibraryStatus === "idle" ||
                          ltUserPresetPayload.presets.length >= STUDIO_BG3D_LT_PRESET_MAX_COUNT
                        }
                        onClick={saveCurrentLtAsUserPreset}
                      >
                        <Save size={14} aria-hidden />
                        현재 설정을 새 프리셋으로 저장
                      </button>
                    )}
                  </div>
                </details>

                {ltUserPresetNotice ? (
                  <p
                    aria-live="polite"
                    aria-atomic="true"
                    className={cx(
                      "mt-2 rounded-lg border px-3 py-2 text-[0.68rem] leading-relaxed",
                      ltUserPresetNotice.tone === "success" && "border-good/35 bg-[oklch(0.80_0.15_150/0.08)] text-good",
                      ltUserPresetNotice.tone === "error" && "border-bad/35 bg-[oklch(0.66_0.20_25/0.08)] text-bad",
                      ltUserPresetNotice.tone === "info" && "border-line bg-card/55 text-fg-2"
                    )}
                  >
                    {ltUserPresetNotice.message}
                  </p>
                ) : null}

                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line bg-card/55 px-3 py-2">
                  <div className="min-w-0">
                    <label htmlFor="bg3d-lt-export-height" className="block text-xs font-bold text-fg">
                      출력 해상도
                    </label>
                    <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3" aria-live="polite">
                      {ltCaptureSizePreview
                        ? `${ltCaptureSizePreview.width.toLocaleString()}×${ltCaptureSizePreview.height.toLocaleString()} px${ltCaptureSizePreview.wasReduced ? " · 기기 안전 한도 적용" : ""}`
                        : "현재 기기에서 안전한 출력 크기를 계산할 수 없습니다."}
                    </p>
                  </div>
                  <select
                    id="bg3d-lt-export-height"
                    aria-label="LT 출력 높이"
                    className="min-h-11 rounded-lg border border-line bg-panel px-2.5 text-xs font-semibold text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                    value={sceneBaseDocument.output.exportHeight}
                    onChange={(event) => updateLtExportHeight(Number(event.target.value))}
                  >
                    {!LT_EXPORT_HEIGHTS.includes(sceneBaseDocument.output.exportHeight as (typeof LT_EXPORT_HEIGHTS)[number]) ? (
                      <option value={sceneBaseDocument.output.exportHeight}>
                        {sceneBaseDocument.output.exportHeight.toLocaleString()} px
                      </option>
                    ) : null}
                    {LT_EXPORT_HEIGHTS.map((height) => (
                      <option key={height} value={height}>{height.toLocaleString()} px</option>
                    ))}
                  </select>
                </div>

                <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-line bg-card/55 px-3 py-2">
                  <div className="min-w-0">
                    <label htmlFor="bg3d-lt-export-aspect" className="block text-xs font-bold text-fg">
                      출력 비율
                    </label>
                    <p className="mt-0.5 text-[0.64rem] leading-relaxed text-fg-3" aria-live="polite">
                      {ltExportAspectRatio === null
                        ? "자동 — 3D 창 크기에 따라 삽입 구도가 달라집니다. 비율을 고정하세요."
                        : "고정 — 뷰포트의 점선 안쪽만 삽입됩니다."}
                    </p>
                  </div>
                  <select
                    id="bg3d-lt-export-aspect"
                    aria-label="LT 출력 비율"
                    className="min-h-11 rounded-lg border border-line bg-panel px-2.5 text-xs font-semibold text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                    value={ltCaptureAspectPresetId}
                    onChange={(event) => {
                      const preset = ltCaptureAspectPresets.find(
                        (candidate) => candidate.id === event.target.value,
                      );
                      if (!preset) return;
                      updateLtExportAspectRatio(preset.ratio);
                    }}
                  >
                    {ltCaptureAspectPresetId === "custom" ? (
                      <option value="custom">
                        {(ltExportAspectRatio ?? 1).toFixed(2)} : 1
                      </option>
                    ) : null}
                    {ltCaptureAspectPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>{preset.label}</option>
                    ))}
                  </select>
                </div>

                <div
                  role="group"
                  className="mt-3 rounded-xl border border-line bg-card/55 p-3"
                  aria-label={`LT 출력 의도: ${ltLineSettings.enabled ? `${ltLineSettings.widthPx}픽셀 선화` : "선화 없음"}, ${LT_TONE_MODE_LABELS[ltToneSettings.mode]}, ${LT_TONE_TYPE_LABELS[ltToneSettings.type]}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-fg">출력 의도 미리보기</span>
                    <button
                      type="button"
                      aria-pressed={lineArtPreview}
                      className={cx(
                        "min-h-11 rounded-lg border px-2.5 text-[0.68rem] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9",
                        lineArtPreview
                          ? "border-accent/60 bg-accent-soft text-accent"
                          : "border-line bg-panel text-fg-3 hover:bg-raised hover:text-fg"
                      )}
                      onClick={() => setLineArtPreview((visible) => !visible)}
                    >
                      캔버스 선화 {lineArtPreview ? "켜짐" : "꺼짐"}
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2" aria-hidden>
                    <div className="relative h-12 overflow-hidden rounded-lg border border-line/80 bg-panel">
                      {ltLineSettings.enabled ? (
                        <>
                          <span
                            className="absolute inset-x-3 top-[38%] rounded-full"
                            style={{
                              backgroundColor: ltLineSettings.color,
                              height: `${Math.max(1, Math.min(8, ltLineSettings.widthPx * 1.6))}px`,
                              opacity: ltLineSettings.strength,
                            }}
                          />
                          {ltLineSettings.textureLineEnabled ? (
                            <span
                              className="absolute inset-x-5 top-[66%] border-t border-dashed"
                              style={{
                                borderColor: ltLineSettings.color,
                                opacity: ltLineSettings.textureLineStrength,
                              }}
                            />
                          ) : null}
                        </>
                      ) : (
                        <span className="absolute inset-0 grid place-items-center text-[0.64rem] text-fg-3">선화 꺼짐</span>
                      )}
                    </div>
                    <div className="relative h-12 overflow-hidden rounded-lg border border-line/80" style={ltTonePreviewStyle(ltToneSettings)}>
                      {ltToneSettings.mode === "none" ? (
                        <span className="absolute inset-0 grid place-items-center text-[0.64rem] text-fg-3">선화만</span>
                      ) : null}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 text-[0.64rem] leading-relaxed text-fg-3">
                    <div>
                      <dt className="sr-only">선화 설정</dt>
                      <dd>
                        선 {ltLineSettings.enabled ? `${round(ltLineSettings.widthPx, 2)}px · ${Math.round(ltLineSettings.strength * 100)}%` : "없음"}
                      </dd>
                    </div>
                    <div>
                      <dt className="sr-only">컬러·톤 설정</dt>
                      <dd>
                        {LT_TONE_MODE_LABELS[ltToneSettings.mode]}
                        {ltToneSettings.mode !== "none" ? ` · ${LT_TONE_TYPE_LABELS[ltToneSettings.type]}` : ""}
                      </dd>
                    </div>
                  </dl>
                </div>

                <p className="mt-2 text-[0.66rem] leading-relaxed text-fg-3">
                  결과는 컬러/톤·재질선·주선을 편집 가능한 별도 래스터 PNG 레이어로 묶어 추가합니다. 실제
                  벡터 경로 추출은 아직 지원하지 않으므로 벡터로 표시하거나 내보내지 않습니다.
                </p>

                <div role="group" aria-label="LT 세부 설정" className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-card p-1">
                  {(["line", "tone"] as const).map((section) => {
                    const active = ltEditorSection === section;
                    return (
                      <button
                        key={section}
                        type="button"
                        aria-pressed={active}
                        className={cx(
                          "min-h-11 rounded-lg border px-3 text-xs font-bold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9",
                          active
                            ? "border-accent/55 bg-accent-soft text-accent"
                            : "border-transparent text-fg-3 hover:bg-raised hover:text-fg"
                        )}
                        onClick={() => setLtEditorSection(section)}
                      >
                        {section === "line" ? "선화" : "컬러·톤"}
                      </button>
                    );
                  })}
                </div>

                <div hidden={ltEditorSection !== "line"} className="mt-3">
                  <LtToggleRow
                    checked={ltLineSettings.enabled}
                    label="선화 출력"
                    onChange={(enabled) => {
                      updateLtLineSettings({ enabled });
                      setLineArtPreview(enabled);
                    }}
                  />
                  <div className="flex min-h-11 items-center justify-between gap-3 border-b border-line/70 py-2 text-xs">
                    <span className="font-semibold text-fg-2">레이어 의도</span>
                    <span className="text-right text-[0.68rem] text-fg-3">
                      {ltLineSettings.layerType === "vector" ? "벡터 요청 · 래스터 변환" : "래스터 PNG"}
                    </span>
                  </div>
                  <label htmlFor="bg3d-lt-line-color" className={cx(
                    "flex min-h-11 items-center justify-between gap-3 border-b border-line/70 py-1.5 text-xs",
                    !ltLineSettings.enabled && "opacity-45"
                  )}>
                    <span className="font-semibold text-fg-2">선 색상</span>
                    <span className="ml-auto font-mono text-[0.68rem] uppercase text-fg-3">{ltLineSettings.color}</span>
                    <input
                      id="bg3d-lt-line-color"
                      type="color"
                      aria-label="LT 선 색상"
                      className="size-11 cursor-pointer rounded-lg border border-line bg-card p-1 disabled:cursor-not-allowed sm:size-9"
                      disabled={!ltLineSettings.enabled}
                      value={ltLineSettings.color}
                      onChange={(event) => updateLtLineSettings({ color: event.target.value })}
                    />
                  </label>
                  <LtRangeControl
                    id="bg3d-lt-line-width"
                    label="선 굵기"
                    min={0.25}
                    max={8}
                    step={0.05}
                    value={ltLineSettings.widthPx}
                    valueText={`${round(ltLineSettings.widthPx, 2)} px`}
                    disabled={!ltLineSettings.enabled}
                    onChange={(widthPx) => updateLtLineSettings({ widthPx })}
                  />
                  <LtRangeControl
                    id="bg3d-lt-line-strength"
                    label="선 강도"
                    min={0}
                    max={1}
                    step={0.01}
                    value={ltLineSettings.strength}
                    valueText={`${Math.round(ltLineSettings.strength * 100)}%`}
                    disabled={!ltLineSettings.enabled}
                    onChange={(strength) => updateLtLineSettings({ strength })}
                  />

                  <details className="group border-b border-line/70">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-xs font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                      정밀 선 검출
                      <span className="flex items-center gap-1 text-[0.64rem] font-normal text-fg-3">
                        모서리 · 깊이 · 질감
                        <ChevronDown className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" size={13} aria-hidden />
                      </span>
                    </summary>
                    <div className="border-t border-line/60 pl-2">
                      <LtRangeControl
                        id="bg3d-lt-line-accuracy"
                        label="검출 정밀도"
                        min={0}
                        max={1}
                        step={0.01}
                        value={ltLineSettings.accuracy}
                        valueText={`${Math.round(ltLineSettings.accuracy * 100)}%`}
                        disabled={!ltLineSettings.enabled}
                        onChange={(accuracy) => updateLtLineSettings({ accuracy })}
                      />
                      <LtRangeControl
                        id="bg3d-lt-line-exterior"
                        label="외곽선 강조"
                        min={0}
                        max={2}
                        step={0.05}
                        value={ltLineSettings.exteriorOutlineStrength}
                        valueText={`${round(ltLineSettings.exteriorOutlineStrength, 2)}×`}
                        disabled={!ltLineSettings.enabled}
                        onChange={(exteriorOutlineStrength) => updateLtLineSettings({ exteriorOutlineStrength })}
                      />
                      <LtRangeControl
                        id="bg3d-lt-line-smoothing"
                        label="선 다듬기"
                        min={0}
                        max={1}
                        step={0.01}
                        value={ltLineSettings.smoothing}
                        valueText={`${Math.round(ltLineSettings.smoothing * 100)}%`}
                        disabled={!ltLineSettings.enabled}
                        onChange={(smoothing) => updateLtLineSettings({ smoothing })}
                      />
                      <LtRangeControl
                        id="bg3d-lt-line-crease"
                        label="모서리 각도"
                        min={0}
                        max={180}
                        step={1}
                        value={ltLineSettings.creaseAngleDegrees}
                        valueText={`${Math.round(ltLineSettings.creaseAngleDegrees)}°`}
                        disabled={!ltLineSettings.enabled}
                        onChange={(creaseAngleDegrees) => updateLtLineSettings({ creaseAngleDegrees })}
                      />
                      <LtToggleRow
                        checked={ltLineSettings.scaleAwareAccuracy}
                        label="화면 크기 보정"
                        disabled={!ltLineSettings.enabled}
                        onChange={(scaleAwareAccuracy) => updateLtLineSettings({ scaleAwareAccuracy })}
                      />
                      <LtToggleRow
                        checked={ltLineSettings.hiddenLineRemoval}
                        label="가려진 선 제거"
                        disabled={!ltLineSettings.enabled}
                        onChange={(hiddenLineRemoval) => updateLtLineSettings({ hiddenLineRemoval })}
                      />
                      <LtToggleRow
                        checked={ltLineSettings.depthEnabled}
                        label="깊이선 검출"
                        disabled={!ltLineSettings.enabled}
                        onChange={(depthEnabled) => updateLtLineSettings({ depthEnabled })}
                      />
                      {ltLineSettings.depthEnabled ? (
                        <>
                          <LtRangeControl
                            id="bg3d-lt-line-depth"
                            label="깊이선 강도"
                            min={0}
                            max={1}
                            step={0.01}
                            value={ltLineSettings.depthStrength}
                            valueText={`${Math.round(ltLineSettings.depthStrength * 100)}%`}
                            disabled={!ltLineSettings.enabled}
                            onChange={(depthStrength) => updateLtLineSettings({ depthStrength })}
                          />
                          <LtToggleRow
                            checked={ltLineSettings.depthOutlineOnly}
                            label="깊이 외곽선만"
                            disabled={!ltLineSettings.enabled}
                            onChange={(depthOutlineOnly) => updateLtLineSettings({ depthOutlineOnly })}
                          />
                        </>
                      ) : null}
                      <LtToggleRow
                        checked={ltLineSettings.textureLineEnabled}
                        label="재질선 검출"
                        disabled={!ltLineSettings.enabled}
                        onChange={(textureLineEnabled) => updateLtLineSettings({ textureLineEnabled })}
                      />
                      {ltLineSettings.textureLineEnabled ? (
                        <LtRangeControl
                          id="bg3d-lt-line-texture"
                          label="재질선 강도"
                          min={0}
                          max={1}
                          step={0.01}
                          value={ltLineSettings.textureLineStrength}
                          valueText={`${Math.round(ltLineSettings.textureLineStrength * 100)}%`}
                          disabled={!ltLineSettings.enabled}
                          onChange={(textureLineStrength) => updateLtLineSettings({ textureLineStrength })}
                        />
                      ) : null}
                    </div>
                  </details>
                </div>

                <div hidden={ltEditorSection !== "tone"} className="mt-3">
                  <label htmlFor="bg3d-lt-tone-mode" className="flex min-h-11 items-center justify-between gap-3 border-b border-line/70 py-1.5 text-xs font-semibold text-fg-2">
                    베이스 방식
                    <select
                      id="bg3d-lt-tone-mode"
                      value={ltToneSettings.mode}
                      className="min-h-11 min-w-36 rounded-lg border border-line bg-card px-2.5 text-xs text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                      onChange={(event) => {
                        const mode = event.target.value as StudioBg3dToneOutputSettings["mode"];
                        updateLtToneSettings({
                          mode,
                          ...(mode === "screentone" ? { type: "pattern" as const } : {}),
                        });
                      }}
                    >
                      {Object.entries(LT_TONE_MODE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>

                  {ltToneSettings.mode === "none" ? (
                    <p className="py-4 text-center text-[0.68rem] leading-relaxed text-fg-3">
                      베이스가 꺼져 선만 출력됩니다. 위에서 원본 렌더·셀 명암·스크린톤을 선택하면 채움
                      레이어 설정이 열립니다.
                    </p>
                  ) : (
                    <>
                      <label htmlFor="bg3d-lt-tone-type" className="flex min-h-11 items-center justify-between gap-3 border-b border-line/70 py-1.5 text-xs font-semibold text-fg-2">
                        출력 유형
                        <select
                          id="bg3d-lt-tone-type"
                          value={ltToneSettings.type}
                          className="min-h-11 min-w-36 rounded-lg border border-line bg-card px-2.5 text-xs text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                          onChange={(event) => updateLtToneSettings({ type: event.target.value as StudioBg3dToneOutputSettings["type"] })}
                        >
                          {Object.entries(LT_TONE_TYPE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                      {ltToneSettings.type === "pattern" || ltToneSettings.mode === "screentone" ? (
                        <label htmlFor="bg3d-lt-tone-pattern" className="flex min-h-11 items-center justify-between gap-3 border-b border-line/70 py-1.5 text-xs font-semibold text-fg-2">
                          패턴
                          <select
                            id="bg3d-lt-tone-pattern"
                            value={ltToneSettings.pattern}
                            className="min-h-11 min-w-36 rounded-lg border border-line bg-card px-2.5 text-xs text-fg focus-visible:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-9"
                            onChange={(event) => updateLtToneSettings({ pattern: event.target.value as StudioBg3dToneOutputSettings["pattern"] })}
                          >
                            {Object.entries(LT_TONE_PATTERN_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      <LtRangeControl
                        id="bg3d-lt-tone-levels"
                        label="명암 단계"
                        min={2}
                        max={8}
                        step={1}
                        value={ltToneSettings.levels}
                        valueText={`${ltToneSettings.levels}단계`}
                        onChange={(levels) => updateLtToneSettings({ levels })}
                      />
                      <LtRangeControl
                        id="bg3d-lt-tone-opacity"
                        label="베이스 농도"
                        min={0}
                        max={1}
                        step={0.01}
                        value={ltToneSettings.opacity}
                        valueText={`${Math.round(ltToneSettings.opacity * 100)}%`}
                        onChange={(opacity) => updateLtToneSettings({ opacity })}
                      />
                      <details className="group border-b border-line/70">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 py-2 text-xs font-semibold text-fg-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                          스크린 정밀 설정
                          <span className="flex items-center gap-1 text-[0.64rem] font-normal text-fg-3">
                            선수 · 각도
                            <ChevronDown className="transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none" size={13} aria-hidden />
                          </span>
                        </summary>
                        <div className="border-t border-line/60 pl-2">
                          <LtRangeControl
                            id="bg3d-lt-tone-frequency"
                            label="패턴 선수"
                            min={1}
                            max={200}
                            step={1}
                            value={ltToneSettings.frequency}
                            valueText={`${Math.round(ltToneSettings.frequency)} LPI`}
                            onChange={(frequency) => updateLtToneSettings({ frequency })}
                          />
                          <LtRangeControl
                            id="bg3d-lt-tone-angle"
                            label="패턴 각도"
                            min={-180}
                            max={180}
                            step={1}
                            value={ltToneSettings.angleDegrees}
                            valueText={`${Math.round(ltToneSettings.angleDegrees)}°`}
                            onChange={(angleDegrees) => updateLtToneSettings({ angleDegrees })}
                          />
                        </div>
                      </details>
                    </>
                  )}
                </div>
              </section>
  );
}
