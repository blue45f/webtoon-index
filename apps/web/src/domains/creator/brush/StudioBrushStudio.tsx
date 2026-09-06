import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Gauge,
  ImagePlus,
  LoaderCircle,
  RotateCcw,
  Layers,
  RotateCw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Stamp,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { MarketplaceBrushStudioBridge } from "../MarketplaceBrushStudioBridge";
import { BRUSH_PRESETS } from "../studio-brush";
import {
  STUDIO_FOCUS_RING,
  StudioContextPill,
  StudioSectionHeader,
} from "../studio-panel-ui";

import {
  createStudioBuiltInBrushDefaultRestoreProfile,
  createStudioSavedBrushDefaultRestoreProfile,
  planStudioBrushDefaultRestore,
  resolveStudioCoreBrushDefaultRestoreProfile,
  type StudioBrushDefaultRestoreDirection,
  type StudioBrushDefaultRestoreTransaction,
} from "./studio-brush-default-restore";
import {
  STUDIO_BRUSH_DYNAMICS_PRESETS,
  normalizeStudioBrushDynamicsSettings,
  planStudioDynamicBrush,
  resolveStudioBrushDynamicsSelectionPresetId,
  studioBrushDynamicsPresetSettings,
  studioBrushDynamicsSettingsForBrushId,
  type NormalizedStudioBrushDynamicsSettings,
  type StudioBrushDynamicsPresetId,
} from "./studio-brush-dynamics";
import {
  findStudioBrushDynamicsMapping,
  removeStudioBrushDynamicsMapping,
  studioBrushDynamicsActiveMappingCount,
  studioBrushDynamicsPresetMatch,
  updateStudioBrushDynamicsJitter,
  updateStudioBrushDynamicsMapping,
  updateStudioBrushDynamicsPropertyBase,
  updateStudioBrushDynamicsRatio,
  updateStudioBrushDynamicsTaper,
  updateStudioBrushDynamicsTip,
} from "./studio-brush-dynamics-editor";
import {
  resolveNormalizedStudioBrushDabColor,
  resolveNormalizedStudioBrushGrainAlphaMultiplier,
  studioBrushGrainIsActive,
} from "./studio-brush-material-dynamics";
import { materializeStudioBrushCatalogSelection } from "./studio-brush-selection";
import {
  STUDIO_BRUSH_DUAL_BRUSH_BLEND_MODES,
  STUDIO_BRUSH_DUAL_BRUSH_SIZE_RATIO_LIMITS,
  composeStudioBrushDualTipAlphaMap,
  normalizeStudioBrushDualBrushSettings,
  planNormalizedStudioBrushTipComposition,
  studioBrushDualTipUsesSolidEllipse,
  type StudioBrushDualBrushBlendMode,
  type StudioBrushDualBrushSettings,
} from "./studio-brush-tip-composition";
import {
  importStudioBrushTipPng,
  studioBrushTipImportErrorMessage,
  type ImportedStudioBrushTip,
} from "./studio-brush-tip-import";
import {
  buildStudioBrushTipAlphaMap,
  planStudioBrushTipStampWorldSamples,
  STUDIO_BRUSH_TIP_SHAPE_IDS,
  studioBrushTipUsesSolidEllipse,
  type NormalizedStudioBrushTipSettings,
  type StudioBrushTipSettings,
  type StudioBrushTipShapeId,
} from "./studio-brush-tip-stamp";
import {
  StudioBrushColorDynamicsControls,
  StudioBrushDynamicsInputMatrix,
  StudioBrushGrainControls,
  StudioBrushTaperAdvancedControls,
} from "./StudioBrushDynamicsControls";
import {
  StudioBrushComposerIntro,
  StudioBrushEngineStackPanel,
  StudioBrushSaveAsCustomControls,
  StudioBrushTraitImportControls,
  StudioBrushWatercolorProgramControls,
} from "./StudioBrushEngineMixer";
import { StudioBrushEngineProgramControls } from "./StudioBrushEngineProgramControls";
import { StudioBrushInputControls } from "./StudioBrushInputControls";

import type { StudioBrushEngineProgramSet } from "./studio-brush-engine-program-set";
import type {
  StudioBrushSnapshot,
  StudioSavedBrush,
} from "./studio-brush-library";


import { cn } from "@/shared/lib/utils";

type BrushStudioCategory =
  | "presets"
  | "engines"
  | "response"
  | "stamp"
  | "tip"
  | "input";

/**
 * Preset selection resolves through the same brush-id variant seam the toolbar uses: the
 * canonical causal preset ids (`ink-particle`/`dry-media`) mint the causal stamp-grid v2 pin
 * there, so the panel authors byte-identical snapshots to toolbar selection instead of unpinned
 * copies of the raw preset table. Preset ids without a variant fall back to the table unchanged.
 */
function studioBrushDynamicsPresetSelectionSettings(
  id: StudioBrushDynamicsPresetId,
): NormalizedStudioBrushDynamicsSettings {
  return studioBrushDynamicsSettingsForBrushId(id) ?? studioBrushDynamicsPresetSettings(id);
}

type BrushDefaultRestoreSession =
  | Readonly<{
      status: "confirm";
      transaction: StudioBrushDefaultRestoreTransaction;
    }>
  | Readonly<{
      status: "applied";
      transaction: StudioBrushDefaultRestoreTransaction;
    }>
  | Readonly<{
      status: "unchanged" | "unavailable";
      message: string;
    }>;

const CATEGORY_ITEMS: readonly {
  id: BrushStudioCategory;
  label: string;
  description: string;
  Icon: typeof Sparkles;
}[] = [
  { id: "presets", label: "빠른 설정", description: "용도별 시작점", Icon: Sparkles },
  { id: "tip", label: "펜촉", description: "형상·각도·원형도", Icon: CircleDot },
  { id: "response", label: "동적 반응", description: "필압·속도·도포량", Icon: Activity },
  { id: "stamp", label: "도장", description: "간격·산포·노이즈", Icon: Stamp },
  { id: "engines", label: "엔진 조합", description: "패스·레이어를 직접 제어", Icon: Layers },
  { id: "input", label: "입력", description: "도구 간 필압 보정", Icon: Gauge },
] as const;

export interface StudioBrushStudioProps {
  brushId: string;
  strokeWidth: number;
  color: string;
  currentSnapshot: StudioBrushSnapshot;
  savedBrushBaseline?: StudioSavedBrush | null;
  settings: NormalizedStudioBrushDynamicsSettings;
  onSettingsChange: (settings: NormalizedStudioBrushDynamicsSettings) => void;
  onSelectDynamicsPreset: (
    id: StudioBrushDynamicsPresetId,
    settings: NormalizedStudioBrushDynamicsSettings
  ) => void;
  useVelocityPressure: boolean;
  onUseVelocityPressureChange: (value: boolean) => void;
  velocitySensitivity: number;
  onVelocitySensitivityChange: (value: number) => void;
  pressureCurve: number;
  onPressureCurveChange: (value: number) => void;
  pressureMinSize?: number;
  onPressureMinSizeChange?: (value: number) => void;
  tiltEnabled: boolean;
  onTiltEnabledChange: (value: boolean) => void;
  tipAngle: number;
  onTipAngleChange: (value: number) => void;
  tipRoundness: number;
  onTipRoundnessChange: (value: number) => void;
  onRestoreDefaults: (
    transaction: StudioBrushDefaultRestoreTransaction,
    direction: StudioBrushDefaultRestoreDirection,
  ) => void;
  /** 엔진 조합 변경. 없으면 조합 탭은 읽기 전용으로 동작한다. */
  onEngineProgramsChange?: (next: StudioBrushEngineProgramSet | null) => void;
  onBeforeOpen?: () => void;
  density?: "compact" | "touch";
}

interface RangeRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  hint?: string;
}

function RangeRow({ label, value, min, max, step, display, onChange, hint }: RangeRowProps) {
  return (
    <label className="block min-h-14 rounded-xl border border-line bg-card/55 px-3 py-2.5 transition-colors duration-150 hover:border-line-strong hover:bg-card/80">
      <span className="flex items-center justify-between gap-3 text-xs font-semibold text-fg-2">
        <span>{label}</span>
        <span className="rounded-md bg-raised px-1.5 py-0.5 tabular-nums text-[0.7rem] text-fg">{display}</span>
      </span>
      {hint ? <span className="mt-0.5 block text-[0.65rem] leading-relaxed text-fg-3">{hint}</span> : null}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className={cn("mt-1.5 h-8 w-full cursor-pointer accent-accent", STUDIO_FOCUS_RING)}
        aria-label={label}
      />
    </label>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-line bg-card/55 px-3 py-2.5 text-left transition-colors duration-150 hover:border-line-strong hover:bg-raised",
        STUDIO_FOCUS_RING
      )}
    >
      <span>
        <span className="block text-xs font-semibold text-fg-2">{label}</span>
        <span className="block text-[0.65rem] leading-relaxed text-fg-3">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors duration-150",
          checked ? "border-accent bg-accent" : "border-line-strong bg-raised"
        )}
      >
        <span
          className={cn(
            "size-4 rounded-full bg-on-accent shadow-sm transition-transform duration-150",
            checked ? "translate-x-5 bg-on-accent" : "bg-fg"
          )}
        />
      </span>
    </button>
  );
}

export function StudioBrushDynamicsPreview({
  settings,
  strokeWidth,
  color,
}: Pick<StudioBrushStudioProps, "settings" | "strokeWidth" | "color">) {
  const plan = planStudioDynamicBrush({
    points: [16, 62, 52, 35, 91, 77, 133, 27, 177, 64, 224, 42, 272, 67],
    pressures: [0.12, 0.3, 0.9, 0.55, 1, 0.42, 0.2],
    speeds: [0.15, 0.22, 0.4, 0.8, 1.2, 0.55, 0.2],
    tiltXs: [0, 8, 25, 42, 55, 24, 0],
    tiltYs: [0, 3, 14, 28, 18, 6, 0],
    twists: [0, 30, 75, 130, 210, 300, 355],
    baseWidth: Math.max(3, Math.min(28, strokeWidth)),
    baseOpacity: settings.opacity.base,
    settings,
    maxDabs: 256,
  });
  return (
    <div className="rounded-xl border border-line bg-card/55 p-2.5 shadow-[inset_0_1px_0_oklch(0.95_0.01_85/0.04)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[0.7rem] font-semibold text-fg-2">실제 엔진 미리보기</span>
        <StudioContextPill tone="neutral">필압 · 속도 · 기울기 · 회전</StudioContextPill>
      </div>
      <svg
        viewBox="0 0 288 96"
        className="h-24 w-full rounded-lg border border-line/60 bg-canvas"
        aria-hidden="true"
      >
        {(() => {
          const normalized = plan.settings;
          const grainActive = studioBrushGrainIsActive(normalized.grain);
          const tips = [normalized.tip, ...normalized.tipLayers.map((layer) => layer.tip)];
          // The primary tip is dual-brush aware: an active secondary texture forces the
          // alpha-map stamp path and swaps in the composed (once-per-settings) map.
          const ellipseTips = tips.map((tip, tipIndex) => (
            !grainActive && (tipIndex === 0
              ? studioBrushDualTipUsesSolidEllipse(tip, normalized.dualBrush)
              : studioBrushTipUsesSolidEllipse(tip))
          ));
          const alphaMaps = tips.map((tip, tipIndex) => (
            ellipseTips[tipIndex]
              ? null
              : tipIndex === 0
                ? composeStudioBrushDualTipAlphaMap(tip, normalized.dualBrush)
                : buildStudioBrushTipAlphaMap(tip)
          ));
          const strokeOriginX = plan.dabs[0]?.sourceX ?? plan.dabs[0]?.x ?? 0;
          const strokeOriginY = plan.dabs[0]?.sourceY ?? plan.dabs[0]?.y ?? 0;
          const grainAt = (x: number, y: number) => (
            resolveNormalizedStudioBrushGrainAlphaMultiplier({
              x,
              y,
              strokeOriginX,
              strokeOriginY,
              strokeSeed: normalized.seed,
            }, normalized.grain)
          );
          return plan.dabs.flatMap((dab) => {
            const dabColor = resolveNormalizedStudioBrushDabColor(
              color,
              dab.index,
              normalized.seed,
              normalized.colorDynamics
            );
            return planNormalizedStudioBrushTipComposition(
              dab,
              normalized.tip,
              normalized.tipLayers
            ).flatMap((composedTip) => {
              const composedDab = composedTip.dab;
              const tipIndex = composedTip.role === "primary" ? 0 : composedTip.layerIndex + 1;
              const baseOpacity = Math.min(1, Math.max(0.02, composedDab.opacity * composedDab.flow));
              const alphaMap = alphaMaps[tipIndex] ?? null;
              if (ellipseTips[tipIndex] || !alphaMap) {
                const radius = Math.max(0.25, composedDab.size / 2);
                return [(
                  <ellipse
                    key={`${dab.index}-${tipIndex}`}
                    cx={composedDab.x}
                    cy={composedDab.y}
                    rx={radius}
                    ry={radius * composedDab.roundness}
                    fill={dabColor}
                    opacity={Math.min(1, baseOpacity * grainAt(composedDab.x, composedDab.y))}
                    transform={`rotate(${composedDab.angle} ${composedDab.x} ${composedDab.y})`}
                  />
                )];
              }
              return planStudioBrushTipStampWorldSamples(
                composedDab,
                composedTip.tip,
                { alphaMap, grid: 5 }
              ).map((sample, sampleIndex) => (
                <circle
                  key={`${dab.index}-${tipIndex}-${sampleIndex}`}
                  cx={sample.x}
                  cy={sample.y}
                  r={sample.radius}
                  fill={dabColor}
                  opacity={Math.min(
                    1,
                    Math.max(0.001, baseOpacity * sample.alpha * grainAt(sample.x, sample.y))
                  )}
                />
              ));
            });
          });
        })()}
      </svg>
      <p className="mt-1.5 text-[0.62rem] leading-relaxed text-fg-3">
        필압·테이퍼·색상·고정 그레인·멀티 팁·듀얼 브러시가 실제 엔진 도장 경로에 반영됩니다.
        {plan.capped ? " 미리보기 도장 수는 256개로 제한했습니다." : ""}
      </p>
    </div>
  );
}

function DynamicsRequiredNotice({
  children,
  onRequestCompatibleBrush,
}: {
  children?: ReactNode;
  onRequestCompatibleBrush: () => void;
}) {
  return (
    <div
      className="rounded-xl border border-accent/35 bg-accent-soft/30 p-4 text-xs leading-relaxed text-fg-2 shadow-[inset_0_0_0_1px_oklch(0.72_0.185_42/0.08)]"
      role="status"
      aria-live="polite"
    >
      <p className="font-semibold text-fg">입자 브러시를 먼저 선택하세요</p>
      <p className="mt-1 text-fg-3 text-pretty">
        빠른 설정에서 잉크 입자, 에어브러시, 드라이 미디어 중 하나를 고르면 이 설정이 실제 획에 적용됩니다.
      </p>
      <button
        type="button"
        onClick={onRequestCompatibleBrush}
        className={cn(
          "mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-accent/45 bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-2",
          STUDIO_FOCUS_RING,
        )}
        aria-label="호환 브러시 선택하기"
      >
        호환 브러시 선택하기
      </button>
      {children}
    </div>
  );
}

const TIP_SHAPE_LABELS: Record<StudioBrushTipShapeId, string> = {
  round: "원형",
  soft: "소프트",
  hard: "하드",
  flake: "플레이크",
  grain: "그레인",
  bristle: "강모",
  sponge: "스펀지",
  sumi: "수묵",
  halftone: "망점",
  star: "스타",
};

function TipShapeGlyph({ shape, active }: { shape: StudioBrushTipShapeId; active: boolean }) {
  const stroke = active ? "currentColor" : "oklch(0.57 0.012 76)";
  const fill = active ? "oklch(0.72 0.185 42 / 0.35)" : "oklch(0.245 0.011 64)";
  return (
    <svg viewBox="0 0 28 18" className="h-4 w-7 text-accent" aria-hidden>
      {shape === "round" || shape === "soft" ? (
        <ellipse cx="14" cy="9" rx={shape === "soft" ? 10 : 7} ry={shape === "soft" ? 7 : 7} fill={fill} stroke={stroke} strokeWidth="1" />
      ) : null}
      {shape === "hard" ? (
        <ellipse cx="14" cy="9" rx="8" ry="8" fill={fill} stroke={stroke} strokeWidth="1.4" />
      ) : null}
      {shape === "flake" ? (
        <path d="M14 2 L22 9 L14 16 L6 9 Z" fill={fill} stroke={stroke} strokeWidth="1" />
      ) : null}
      {shape === "grain" ? (
        <>
          <circle cx="9" cy="7" r="2.2" fill={fill} stroke={stroke} strokeWidth="0.8" />
          <circle cx="15" cy="11" r="2.6" fill={fill} stroke={stroke} strokeWidth="0.8" />
          <circle cx="20" cy="6.5" r="1.8" fill={fill} stroke={stroke} strokeWidth="0.8" />
        </>
      ) : null}
      {shape === "bristle" ? (
        <g fill="none" stroke={stroke} strokeLinecap="round">
          <path d="M6 5.5 C10 7 10 12 14 13.5" strokeWidth="1.5" />
          <path d="M10 4 C13 7 14 10 17 14" strokeWidth="1.1" />
          <path d="M14 3.5 C16 7 18 10 21.5 12.5" strokeWidth="1.4" />
        </g>
      ) : null}
      {shape === "sponge" ? (
        <>
          <circle cx="9" cy="6" r="3" fill={fill} stroke={stroke} strokeWidth="0.7" />
          <circle cx="15" cy="10" r="4" fill={fill} stroke={stroke} strokeWidth="0.7" />
          <circle cx="21" cy="6.5" r="2.6" fill={fill} stroke={stroke} strokeWidth="0.7" />
          <circle cx="21" cy="13" r="2" fill={fill} stroke={stroke} strokeWidth="0.7" />
        </>
      ) : null}
      {shape === "sumi" ? (
        <path
          d="M5.5 10.5 C7 5 11 2.8 15.5 4 C21 5.3 23.5 10.4 20.2 14 C17.5 16.4 9.4 15.3 5.5 10.5 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="0.9"
        />
      ) : null}
      {shape === "halftone" ? (
        <g fill={stroke}>
          {[8, 14, 20].flatMap((x) => [5, 10, 15].map((y) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r={y === 10 ? 1.45 : 1.1} />
          )))}
        </g>
      ) : null}
      {shape === "star" ? (
        <path
          d="M14 2.5 L16.2 7.4 L21.5 7.8 L17.4 11.2 L18.6 16.3 L14 13.7 L9.4 16.3 L10.6 11.2 L6.5 7.8 L11.8 7.4 Z"
          fill={fill}
          stroke={stroke}
          strokeWidth="0.9"
        />
      ) : null}
    </svg>
  );
}

export interface StudioBrushTipImportControlsProps {
  tip: NormalizedStudioBrushTipSettings;
  onTipChange: (patch: Partial<StudioBrushTipSettings>) => void;
  onImportingChange?: (importing: boolean) => void;
}

function importedTipSourceLabel(source: ImportedStudioBrushTip["source"]): string {
  if (source === "alpha") return "투명 알파";
  if (source === "grayscale-dark") return "검은 촉 자동 인식";
  return "흰 촉 자동 인식";
}

export function StudioBrushTipImportControls({
  tip,
  onTipChange,
  onImportingChange,
}: StudioBrushTipImportControlsProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestIdRef = useRef(0);
  const descriptionId = useId();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedStudioBrushTip & { name: string } | null>(null);
  const customActive = Boolean(tip.alphaMapBase64);
  const activeImported = imported?.alphaMapBase64 === tip.alphaMapBase64 ? imported : null;
  const tipRevision = `${tip.shape}:${tip.softness}:${tip.alphaMapSize}:${tip.alphaMapBase64 ?? ""}`;
  const tipRevisionRef = useRef(tipRevision);

  useEffect(() => () => {
    requestIdRef.current++;
  }, []);

  useLayoutEffect(() => {
    if (tipRevisionRef.current === tipRevision) return;
    tipRevisionRef.current = tipRevision;
    // Undo, preset restore, or another tip control wins before paint over an older async PNG
    // decode. A passive effect left a commit-to-effect microtask window where stale import data
    // could replace the newer tip.
    if (!importing) return;
    requestIdRef.current++;
    setImporting(false);
    onImportingChange?.(false);
  }, [importing, onImportingChange, tipRevision]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const requestId = requestIdRef.current + 1;
    const requestTipRevision = tipRevision;
    requestIdRef.current = requestId;
    setImporting(true);
    onImportingChange?.(true);
    setError(null);
    try {
      const result = await importStudioBrushTipPng(file);
      if (
        requestIdRef.current !== requestId
        || tipRevisionRef.current !== requestTipRevision
      ) return;
      onTipChange({
        alphaMapBase64: result.alphaMapBase64,
        alphaMapSize: result.alphaMapSize,
      });
      setImported({ ...result, name: file.name });
    } catch (reason) {
      if (
        requestIdRef.current !== requestId
        || tipRevisionRef.current !== requestTipRevision
      ) return;
      setError(studioBrushTipImportErrorMessage(reason));
    } finally {
      if (requestIdRef.current === requestId) {
        setImporting(false);
        onImportingChange?.(false);
      }
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card/45 p-3">
      <div className="flex items-start gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/15">
          <ImagePlus size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-fg">내 PNG 펜촉</p>
          <p id={descriptionId} className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3 text-pretty">
            4MB·4,096px 이하 PNG를 최대 64×64 알파로 안전하게 축소합니다. 투명 배경과 흑백 마스크를 모두 자동 인식합니다.
          </p>
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,image/png"
        aria-label="PNG 펜촉 파일 선택"
        aria-describedby={descriptionId}
        onChange={(event) => void handleFileChange(event)}
        className="sr-only"
      />

      {customActive ? (
        <div className="mt-2.5 flex min-h-[52px] items-center gap-2 rounded-lg border border-good/30 bg-good/10 px-2.5 py-1.5">
          <CheckCircle2 size={16} className="shrink-0 text-good" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.7rem] font-semibold text-fg">
              {activeImported?.name ?? "문서에 포함된 사용자 PNG"}
            </p>
            <p className="truncate text-[0.62rem] text-fg-3">
              {tip.alphaMapSize}×{tip.alphaMapSize} 알파
              {activeImported ? ` · ${importedTipSourceLabel(activeImported.source)}` : " · 획과 함께 저장됨"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              requestIdRef.current++;
              setImporting(false);
              onImportingChange?.(false);
              setImported(null);
              setError(null);
              onTipChange({ alphaMapBase64: null });
            }}
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-lg text-fg-3 transition-colors hover:bg-raised hover:text-fg",
              STUDIO_FOCUS_RING
            )}
            aria-label="사용자 PNG 펜촉 제거"
            title="사용자 PNG 제거"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-2.5 flex min-h-[44px] items-center gap-2 rounded-lg border border-bad/35 bg-bad/10 pl-2.5 text-[0.65rem] leading-relaxed text-bad">
          <span className="min-w-0 flex-1 py-2">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className={cn("grid size-11 shrink-0 place-items-center rounded-lg hover:bg-bad/10", STUDIO_FOCUS_RING)}
            aria-label="펜촉 가져오기 오류 닫기"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : null}

      <button
        type="button"
        disabled={importing}
        aria-busy={importing}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-line-strong bg-raised px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-accent/45 hover:bg-card disabled:cursor-wait disabled:opacity-65",
          STUDIO_FOCUS_RING
        )}
      >
        {importing ? (
          <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden />
        ) : (
          <ImagePlus size={16} className="text-accent" aria-hidden />
        )}
        {importing ? "펜촉 변환 중…" : customActive ? "다른 PNG로 교체" : "PNG 펜촉 가져오기"}
      </button>
    </div>
  );
}

const DUAL_BRUSH_BLEND_MODE_LABELS: Record<StudioBrushDualBrushBlendMode, string> = {
  multiply: "곱하기",
  screen: "스크린",
};

const DUAL_BRUSH_BLEND_MODE_HINTS: Record<StudioBrushDualBrushBlendMode, string> = {
  multiply: "2차 팁의 어두운 부분이 1차 팁을 깎아 질감을 만듭니다",
  screen: "2차 팁의 밝은 부분이 1차 팁 커버리지를 밝게 넓힙니다",
};

export interface StudioBrushDualBrushControlsProps {
  settings: NormalizedStudioBrushDynamicsSettings;
  onSettingsChange: (settings: NormalizedStudioBrushDynamicsSettings) => void;
}

/**
 * 듀얼 브러시 — 2차 팁 텍스처가 1차 팁 알파를 합성(도장 텍스처 구성) 시점에 변조합니다.
 * 간격·산포·지터는 1차 브러시 설정을 그대로 따르므로 도장(dab) 단가는 변하지 않습니다.
 */
export function StudioBrushDualBrushControls({
  settings,
  onSettingsChange,
}: StudioBrushDualBrushControlsProps) {
  // Identity dual settings are omitted from normalized snapshots; editing starts from identity.
  const dualBrush = settings.dualBrush ?? normalizeStudioBrushDualBrushSettings();
  const update = (patch: Partial<StudioBrushDualBrushSettings>) => {
    onSettingsChange(normalizeStudioBrushDynamicsSettings({
      ...settings,
      dualBrush: { ...dualBrush, ...patch },
    }));
  };
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-semibold text-fg-2">듀얼 브러시</span>
        <span className="text-[0.62rem] text-fg-3">간격·산포는 1차 브러시를 따릅니다</span>
      </div>
      <ToggleRow
        label="듀얼 브러시 사용"
        description="2차 팁 텍스처가 1차 팁을 도장 텍스처 합성 시점에 변조합니다"
        checked={dualBrush.enabled}
        onChange={(enabled) => update({ enabled })}
      />
      {dualBrush.enabled ? (
        <>
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[0.68rem] font-semibold text-fg-2">2차 팁</span>
              <span className="text-[0.62rem] text-fg-3">선택하면 2차 사용자 PNG가 해제됩니다</span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {STUDIO_BRUSH_TIP_SHAPE_IDS.map((shapeId) => {
                const active = dualBrush.tip.shape === shapeId && !dualBrush.tip.alphaMapBase64;
                return (
                  <button
                    key={shapeId}
                    type="button"
                    aria-pressed={active}
                    aria-label={`2차 팁 ${TIP_SHAPE_LABELS[shapeId]}`}
                    onClick={() => update({
                      tip: { ...dualBrush.tip, shape: shapeId, alphaMapBase64: null },
                    })}
                    className={cn(
                      "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[0.68rem] font-semibold transition-colors duration-150",
                      STUDIO_FOCUS_RING,
                      active
                        ? "border-accent bg-accent-soft/55 text-fg ring-1 ring-accent/20"
                        : "border-line bg-card/55 text-fg-2 hover:border-accent/45 hover:bg-raised"
                    )}
                  >
                    <TipShapeGlyph shape={shapeId} active={active} />
                    {TIP_SHAPE_LABELS[shapeId]}
                  </button>
                );
              })}
            </div>
          </div>
          <div role="radiogroup" aria-label="듀얼 브러시 합성 모드" className="grid grid-cols-2 gap-1.5">
            {STUDIO_BRUSH_DUAL_BRUSH_BLEND_MODES.map((blendMode) => {
              const active = dualBrush.blendMode === blendMode;
              return (
                <button
                  key={blendMode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => update({ blendMode })}
                  className={cn(
                    "min-h-[44px] rounded-xl border px-3 py-2 text-left transition-colors duration-150",
                    STUDIO_FOCUS_RING,
                    active
                      ? "border-accent bg-accent-soft/55 text-fg ring-1 ring-accent/20"
                      : "border-line bg-card/55 text-fg-2 hover:border-accent/45 hover:bg-raised"
                  )}
                >
                  <span className="block text-xs font-semibold">
                    {DUAL_BRUSH_BLEND_MODE_LABELS[blendMode]}
                  </span>
                  <span className="mt-0.5 block text-[0.62rem] leading-relaxed text-fg-3">
                    {DUAL_BRUSH_BLEND_MODE_HINTS[blendMode]}
                  </span>
                </button>
              );
            })}
          </div>
          <RangeRow
            label="2차 팁 크기 비율"
            value={dualBrush.sizeRatio}
            min={STUDIO_BRUSH_DUAL_BRUSH_SIZE_RATIO_LIMITS.min}
            max={STUDIO_BRUSH_DUAL_BRUSH_SIZE_RATIO_LIMITS.max}
            step={0.05}
            display={`${Math.round(dualBrush.sizeRatio * 100)}%`}
            hint="1차 팁 지름 대비 2차 팁 지름"
            onChange={(sizeRatio) => update({ sizeRatio })}
          />
          <StudioBrushTipImportControls
            tip={dualBrush.tip}
            onTipChange={(patch) => update({ tip: { ...dualBrush.tip, ...patch } })}
          />
        </>
      ) : null}
    </div>
  );
}

export function StudioBrushStudio({
  brushId,
  strokeWidth,
  color,
  currentSnapshot,
  savedBrushBaseline = null,
  settings,
  onSettingsChange,
  onSelectDynamicsPreset,
  useVelocityPressure,
  onUseVelocityPressureChange,
  velocitySensitivity,
  onVelocitySensitivityChange,
  pressureCurve,
  onPressureCurveChange,
  pressureMinSize = 0,
  onPressureMinSizeChange,
  tiltEnabled,
  onTiltEnabledChange,
  tipAngle,
  onTipAngleChange,
  tipRoundness,
  onTipRoundnessChange,
  onRestoreDefaults,
  onEngineProgramsChange,
  onBeforeOpen,
  density = "compact",
}: StudioBrushStudioProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<BrushStudioCategory>("presets");
  const [tipImporting, setTipImporting] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreSession, setRestoreSession] = useState<BrushDefaultRestoreSession | null>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreRequestRef = useRef(0);
  const titleId = useId();
  const descriptionId = useId();
  const tabIdBase = useId();
  const tabPanelId = useId();
  const dynamicsPresetId = resolveStudioBrushDynamicsSelectionPresetId(brushId, settings);
  const dynamicsActive = dynamicsPresetId !== null;
  const matchedPreset = dynamicsActive ? studioBrushDynamicsPresetMatch(settings) : null;
  const mappingCount = studioBrushDynamicsActiveMappingCount(settings);
  const brushLabel = BRUSH_PRESETS.find((preset) => preset.id === brushId)?.name ?? "브러시";
  const touch = density === "touch";

  function closeStudio() {
    restoreRequestRef.current += 1;
    setTipImporting(false);
    setRestoreLoading(false);
    setRestoreSession(null);
    setOpen(false);
    globalThis.requestAnimationFrame?.(() => launcherRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (category !== "tip" && tipImporting) setTipImporting(false);
  }, [category, tipImporting]);

  useEffect(() => {
    restoreRequestRef.current += 1;
    setRestoreLoading(false);
    setRestoreSession(null);
  }, [
    brushId,
    currentSnapshot.sourcePresetId,
    savedBrushBaseline?.id,
  ]);

  function handleCategoryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const tabs = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']") ?? []
    );
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = CATEGORY_ITEMS[nextIndex];
    if (!next) return;
    setCategory(next.id);
    tabs[nextIndex]?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById("root");
    const previousRootInert = appRoot?.hasAttribute("inert") ?? false;
    document.body.style.overflow = "hidden";
    appRoot?.setAttribute("inert", "");
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeStudio();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
        )
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (appRoot && !previousRootInert) appRoot.removeAttribute("inert");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function resolveDefaultRestoreProfile() {
    if (
      savedBrushBaseline
      && savedBrushBaseline.brushId === currentSnapshot.brushId
    ) {
      return createStudioSavedBrushDefaultRestoreProfile(savedBrushBaseline);
    }
    const sourcePresetId = currentSnapshot.sourcePresetId;
    if (sourcePresetId) {
      const selection = await materializeStudioBrushCatalogSelection(sourcePresetId);
      return selection
        ? createStudioBuiltInBrushDefaultRestoreProfile(selection)
        : null;
    }
    return resolveStudioCoreBrushDefaultRestoreProfile(currentSnapshot.brushId);
  }

  async function requestDefaultRestore() {
    if (restoreLoading) return;
    const requestId = restoreRequestRef.current + 1;
    restoreRequestRef.current = requestId;
    setRestoreLoading(true);
    setRestoreSession(null);
    try {
      const profile = await resolveDefaultRestoreProfile();
      if (restoreRequestRef.current !== requestId) return;
      if (!profile) {
        setRestoreSession({
          status: "unavailable",
          message: currentSnapshot.sourcePresetId
            ? "가져온 브러시는 저장된 브러시 라이브러리에서 다시 적용해 원본 설정으로 돌아갈 수 있습니다."
            : "이 브러시의 검증된 기본 프로필을 찾지 못했습니다.",
        });
        return;
      }
      const transaction = planStudioBrushDefaultRestore(currentSnapshot, profile);
      setRestoreSession(
        transaction.changes.length === 0
          ? { status: "unchanged", message: transaction.summary }
          : { status: "confirm", transaction },
      );
    } catch {
      if (restoreRequestRef.current !== requestId) return;
      setRestoreSession({
        status: "unavailable",
        message: "기본 프로필을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      });
    } finally {
      if (restoreRequestRef.current === requestId) setRestoreLoading(false);
    }
  }

  function confirmDefaultRestore(transaction: StudioBrushDefaultRestoreTransaction) {
    const latest = planStudioBrushDefaultRestore(currentSnapshot, transaction.profile);
    if (latest.changes.length === 0) {
      setRestoreSession({ status: "unchanged", message: latest.summary });
      return;
    }
    onRestoreDefaults(latest, "redo");
    setRestoreSession({ status: "applied", transaction: latest });
  }

  function undoDefaultRestore(transaction: StudioBrushDefaultRestoreTransaction) {
    onRestoreDefaults(transaction, "undo");
    setRestoreSession(null);
  }

  function onRequestCompatibleBrush(): void {
    onSelectDynamicsPreset(
      "ink-particle",
      studioBrushDynamicsPresetSelectionSettings("ink-particle"),
    );
    setCategory("presets");
  }

  const launcherSummary = dynamicsActive
    ? `${matchedPreset ? STUDIO_BRUSH_DYNAMICS_PRESETS.find((preset) => preset.id === matchedPreset)?.name : "사용자 지정"} · ${mappingCount}개 연결`
    : brushId === "calligraphy"
      ? `촉 ${Math.round(tipAngle)}° · 원형도 ${Math.round(tipRoundness * 100)}%`
      : "필압·속도 입력과 입자 브러시";

  const pressureWidth = findStudioBrushDynamicsMapping(settings, "width", "pressure");
  const pressureOpacity = findStudioBrushDynamicsMapping(settings, "opacity", "pressure");
  const directionAngle = findStudioBrushDynamicsMapping(settings, "angle", "direction");
  const twistAngle = findStudioBrushDynamicsMapping(settings, "angle", "twist");
  const tiltRoundness = findStudioBrushDynamicsMapping(settings, "roundness", "tilt-magnitude");

  const content = category === "presets" ? (
    <div className="space-y-3">
      <StudioSectionHeader
        title="빠른 설정"
        description="실제 필압·속도·기울기·회전 입력을 조합한 상용 수준 시작점입니다."
      />
      <div className="grid gap-2 md:grid-cols-3">
        {STUDIO_BRUSH_DYNAMICS_PRESETS.map((preset) => {
          const active = dynamicsActive && matchedPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectDynamicsPreset(preset.id, studioBrushDynamicsPresetSelectionSettings(preset.id))}
              className={cn(
                "min-h-24 rounded-xl border p-3 text-left transition-colors duration-150",
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent-soft/55 text-fg ring-1 ring-accent/20"
                  : "border-line bg-card/55 text-fg-2 hover:border-accent/45 hover:bg-raised"
              )}
            >
              <span className="flex items-center justify-between gap-2 text-xs font-bold">
                {preset.name}
                {active ? (
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[0.6rem] font-semibold text-on-accent">
                    사용 중
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 block text-[0.65rem] font-normal leading-relaxed text-fg-3 text-pretty">
                {preset.description}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-line bg-card/45 px-3 py-2.5 text-[0.68rem] leading-relaxed text-fg-3 text-pretty">
        프리셋을 조정하면 자동으로 사용자 지정 상태가 됩니다. 원본 프리셋은 언제든 다시 선택할 수 있습니다.
      </div>
    </div>
  ) : category === "response" ? (
    dynamicsActive ? (
      <div className="space-y-2.5">
        <StudioSectionHeader
          title="압력 반응과 도포량"
          description="전체 입력 보정 뒤에 각 출력 속성의 반응 범위를 적용합니다."
        />
        <RangeRow
          label="가벼운 필압의 굵기"
          value={pressureWidth?.from ?? 0.3}
          min={0.05}
          max={1}
          step={0.05}
          display={`${Math.round((pressureWidth?.from ?? 0.3) * 100)}%`}
          onChange={(from) => onSettingsChange(updateStudioBrushDynamicsMapping(
            settings,
            "width",
            "pressure",
            { from },
            { source: "pressure", from: 0.3, to: 1.7 }
          ))}
        />
        <RangeRow
          label="강한 필압의 굵기"
          value={pressureWidth?.to ?? 1.7}
          min={0.5}
          max={2.4}
          step={0.05}
          display={`${Math.round((pressureWidth?.to ?? 1.7) * 100)}%`}
          onChange={(to) => onSettingsChange(updateStudioBrushDynamicsMapping(
            settings,
            "width",
            "pressure",
            { to },
            { source: "pressure", from: 0.3, to: 1.7 }
          ))}
        />
        <RangeRow
          label="가벼운 필압의 불투명도"
          value={pressureOpacity?.from ?? 0.5}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round((pressureOpacity?.from ?? 0.5) * 100)}%`}
          onChange={(from) => onSettingsChange(updateStudioBrushDynamicsMapping(
            settings,
            "opacity",
            "pressure",
            { from },
            { source: "pressure", from: 0.5, to: 1 }
          ))}
        />
        <RangeRow
          label="유량"
          value={settings.flow.base}
          min={0.04}
          max={1}
          step={0.02}
          display={`${Math.round(settings.flow.base * 100)}%`}
          hint="한 도장마다 쌓이는 색의 양이며, 획 투명도와 함께 최종 농도를 결정합니다."
          onChange={(base) => onSettingsChange(updateStudioBrushDynamicsPropertyBase(settings, "flow", base))}
        />
        <StudioBrushDynamicsInputMatrix
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
      </div>
    ) : <DynamicsRequiredNotice onRequestCompatibleBrush={onRequestCompatibleBrush} />
  ) : category === "stamp" ? (
    dynamicsActive ? (
      <div className="space-y-2.5">
        <StudioSectionHeader
          title="도장 간격과 산포"
          description="줌이 아니라 실제 촉 지름에 비례해 일관된 질감을 유지합니다."
        />
        <RangeRow
          label="도장 간격"
          value={settings.spacingRatio ?? 0.34}
          min={0.02}
          max={1}
          step={0.01}
          display={`${Math.round((settings.spacingRatio ?? 0.34) * 100)}%`}
          hint="촉 지름 대비 이동 거리"
          onChange={(ratio) => onSettingsChange(updateStudioBrushDynamicsRatio(settings, "spacing", ratio))}
        />
        <RangeRow
          label="산포 반경"
          value={settings.scatterRatio ?? 0}
          min={0}
          max={1.2}
          step={0.01}
          display={`${Math.round((settings.scatterRatio ?? 0) * 100)}%`}
          hint="진행 경로 주변으로 퍼지는 결정론적 입자 반경"
          onChange={(ratio) => onSettingsChange(updateStudioBrushDynamicsRatio(settings, "scatter", ratio))}
        />
        <RangeRow
          label="촉 크기 무작위"
          value={settings.width.jitter?.mode === "multiply" ? settings.width.jitter.amount : 0}
          min={0}
          max={0.75}
          step={0.01}
          display={`${Math.round((settings.width.jitter?.mode === "multiply" ? settings.width.jitter.amount : 0) * 100)}%`}
          hint="같은 획은 다시 열어도 똑같이 재현됩니다."
          onChange={(amount) => onSettingsChange(updateStudioBrushDynamicsJitter(settings, "width", amount))}
        />
        <ToggleRow
          label="시작·끝 테이퍼"
          description="획의 양 끝을 펜촉처럼 가늘게 만듭니다"
          checked={settings.taper.enabled}
          onChange={(enabled) => onSettingsChange(updateStudioBrushDynamicsTaper(settings, { enabled }))}
        />
        <RangeRow
          label="시작 테이퍼 길이"
          value={settings.taper.startLength}
          min={0}
          max={0.45}
          step={0.01}
          display={`${Math.round(settings.taper.startLength * 100)}%`}
          hint="획 전체 길이 대비 시작 구간"
          onChange={(startLength) => onSettingsChange(updateStudioBrushDynamicsTaper(settings, { startLength }))}
        />
        <RangeRow
          label="끝 테이퍼 길이"
          value={settings.taper.endLength}
          min={0}
          max={0.45}
          step={0.01}
          display={`${Math.round(settings.taper.endLength * 100)}%`}
          hint="획 전체 길이 대비 끝 구간"
          onChange={(endLength) => onSettingsChange(updateStudioBrushDynamicsTaper(settings, { endLength }))}
        />
        <RangeRow
          label="끝 최소 굵기"
          value={settings.taper.minSizeRatio}
          min={0.05}
          max={1}
          step={0.01}
          display={`${Math.round(settings.taper.minSizeRatio * 100)}%`}
          onChange={(minSizeRatio) => onSettingsChange(updateStudioBrushDynamicsTaper(settings, { minSizeRatio }))}
        />
        <StudioBrushTaperAdvancedControls
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
      </div>
    ) : <DynamicsRequiredNotice onRequestCompatibleBrush={onRequestCompatibleBrush} />
  ) : category === "tip" ? (
    dynamicsActive ? (
      <div className="space-y-2.5">
        <StudioSectionHeader
          title="펜촉 텍스처"
          description="내 PNG 또는 정교한 기본 촉을 간격·산포 도장 경로에 찍습니다. 원형도가 낮을수록 각도 변화가 선명합니다."
        />
        <StudioBrushTipImportControls
          tip={settings.tip}
          onTipChange={(patch) => onSettingsChange(updateStudioBrushDynamicsTip(settings, patch))}
          onImportingChange={setTipImporting}
        />
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[0.68rem] font-semibold text-fg-2">기본 펜촉</span>
            <span className="text-[0.62rem] text-fg-3">선택하면 사용자 PNG가 해제됩니다</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
          {STUDIO_BRUSH_TIP_SHAPE_IDS.map((shapeId) => {
            const active = settings.tip.shape === shapeId && !settings.tip.alphaMapBase64;
            return (
              <button
                key={shapeId}
                type="button"
                disabled={tipImporting}
                aria-pressed={active}
                onClick={() => onSettingsChange(updateStudioBrushDynamicsTip(settings, {
                  shape: shapeId,
                  alphaMapBase64: null,
                }))}
                className={cn(
                  "flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-[0.68rem] font-semibold transition-colors duration-150",
                  STUDIO_FOCUS_RING,
                  active
                    ? "border-accent bg-accent-soft/55 text-fg ring-1 ring-accent/20"
                    : "border-line bg-card/55 text-fg-2 hover:border-accent/45 hover:bg-raised",
                  "disabled:cursor-wait disabled:opacity-45"
                )}
              >
                <TipShapeGlyph shape={shapeId} active={active} />
                {TIP_SHAPE_LABELS[shapeId]}
              </button>
            );
          })}
          </div>
        </div>
        <RangeRow
          label="팁 가장자리"
          value={settings.tip.softness}
          min={0}
          max={1}
          step={0.02}
          display={`${Math.round(settings.tip.softness * 100)}%`}
          hint="PNG 알파 가장자리 부드러움"
          onChange={(softness) => onSettingsChange(updateStudioBrushDynamicsTip(settings, { softness }))}
        />
        <RangeRow
          label="기본 촉 각도"
          value={settings.angle.base}
          min={-180}
          max={180}
          step={5}
          display={`${Math.round(settings.angle.base)}°`}
          onChange={(base) => onSettingsChange(updateStudioBrushDynamicsPropertyBase(settings, "angle", base))}
        />
        <RangeRow
          label="촉 원형도"
          value={settings.roundness.base}
          min={0.08}
          max={1}
          step={0.02}
          display={`${Math.round(settings.roundness.base * 100)}%`}
          onChange={(base) => onSettingsChange(updateStudioBrushDynamicsPropertyBase(settings, "roundness", base))}
        />
        <ToggleRow
          label="획 방향 추종"
          description="이동 방향에 맞춰 타원형 촉을 회전"
          checked={directionAngle !== null}
          onChange={(checked) => onSettingsChange(checked
            ? updateStudioBrushDynamicsMapping(
                settings,
                "angle",
                "direction",
                {},
                { source: "direction", mode: "add", from: 0, to: 360 }
              )
            : removeStudioBrushDynamicsMapping(settings, "angle", "direction"))}
        />
        <ToggleRow
          label="스타일러스 회전"
          description="지원 펜의 barrel roll·twist를 촉 각도에 반영"
          checked={twistAngle !== null}
          onChange={(checked) => onSettingsChange(checked
            ? updateStudioBrushDynamicsMapping(
                settings,
                "angle",
                "twist",
                {},
                { source: "twist", mode: "add", from: 0, to: 360 }
              )
            : removeStudioBrushDynamicsMapping(settings, "angle", "twist"))}
        />
        <ToggleRow
          label="기울기 원형도"
          description="펜을 눕힐수록 촉이 납작해지는 반응"
          checked={tiltRoundness !== null}
          onChange={(checked) => onSettingsChange(checked
            ? updateStudioBrushDynamicsMapping(
                settings,
                "roundness",
                "tilt-magnitude",
                {},
                { source: "tilt-magnitude", from: 1, to: 0.35 }
              )
            : removeStudioBrushDynamicsMapping(settings, "roundness", "tilt-magnitude"))}
        />
        <StudioBrushGrainControls
          settings={settings}
          onSettingsChange={onSettingsChange}
        />
        <StudioBrushDualBrushControls settings={settings} onSettingsChange={onSettingsChange} />
        <StudioBrushColorDynamicsControls settings={settings} onSettingsChange={onSettingsChange} />
      </div>
    ) : brushId === "calligraphy" ? (
      <div className="space-y-2.5">
        <div>
          <h3 className="text-sm font-bold text-fg">캘리그래피 펜촉</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-3">기존 캘리그래피 획의 전용 촉 설정입니다.</p>
        </div>
        <ToggleRow
          label="스타일러스 기울기"
          description="Apple Pencil·Wacom의 tilt와 twist를 획에 저장"
          checked={tiltEnabled}
          onChange={onTiltEnabledChange}
        />
        <RangeRow
          label="기본 촉 각도"
          value={tipAngle}
          min={-180}
          max={180}
          step={5}
          display={`${Math.round(tipAngle)}°`}
          onChange={onTipAngleChange}
        />
        <RangeRow
          label="촉 원형도"
          value={tipRoundness}
          min={0.08}
          max={1}
          step={0.02}
          display={`${Math.round(tipRoundness * 100)}%`}
          onChange={onTipRoundnessChange}
        />
      </div>
    ) : <DynamicsRequiredNotice onRequestCompatibleBrush={onRequestCompatibleBrush} />
  ) : category === "engines" ? (
    <div className="space-y-3">
      <StudioBrushComposerIntro />
      <StudioBrushEngineStackPanel
        brushId={brushId}
        settings={settings}
        enginePrograms={currentSnapshot.enginePrograms ?? null}
      />
      <StudioBrushEngineProgramControls
        brushId={brushId}
        programSet={currentSnapshot.enginePrograms ?? null}
        onChange={onEngineProgramsChange ?? (() => undefined)}
      />
      <StudioBrushWatercolorProgramControls
        brushId={brushId}
        programSet={currentSnapshot.enginePrograms ?? null}
        onChange={onEngineProgramsChange}
      />
      <StudioBrushTraitImportControls settings={settings} onSettingsChange={onSettingsChange} />
      <StudioBrushSaveAsCustomControls
        snapshot={currentSnapshot}
        baseBrushName={brushLabel}
      />
    </div>
  ) : (
    <div>
      <StudioSectionHeader
        title="전역 입력 보정"
        description="장치 입력을 먼저 보정한 뒤, 브러시별 크기·불투명도·도장 반응을 적용합니다."
      />
      <StudioBrushInputControls
        density="touch"
        useVelocityPressure={useVelocityPressure}
        onUseVelocityPressureChange={onUseVelocityPressureChange}
        velocitySensitivity={velocitySensitivity}
        onVelocitySensitivityChange={onVelocitySensitivityChange}
        pressureCurve={pressureCurve}
        onPressureCurveChange={onPressureCurveChange}
        pressureMinSize={pressureMinSize}
        onPressureMinSizeChange={onPressureMinSizeChange ?? (() => undefined)}
      />
      <div className="mt-3 grid grid-cols-2 gap-2 text-[0.66rem] text-fg-3 sm:grid-cols-4">
        {["필압", "속도", "기울기", "회전"].map((sensor) => (
          <span
            key={sensor}
            className="flex min-h-11 items-center justify-center rounded-lg border border-line bg-card/45 px-2 text-center font-medium"
          >
            {sensor} 입력 준비
          </span>
        ))}
      </div>
      <p className="mt-2 text-[0.62rem] leading-relaxed text-fg-3 text-pretty">
        센서 지원은 브라우저와 펜 모델에 따라 다릅니다. 지원되지 않는 입력도 다른 기기에서 쓸 브러시 설정으로 저장할 수 있습니다.
      </p>
    </div>
  );

  const restoreAction = (
    <div
      aria-live="polite"
      className="shrink-0 border-b border-line bg-card/35 px-3 py-2 sm:px-4"
    >
      {restoreSession?.status === "confirm" ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg">
              {restoreSession.transaction.profile.sourceName} 기본값으로 복원할까요?
            </p>
            <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
              {restoreSession.transaction.summary} · 현재 색상과 브러시 선택은 유지됩니다.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              type="button"
              onClick={() => setRestoreSession(null)}
              className={cn(
                "min-h-11 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised",
                STUDIO_FOCUS_RING,
              )}
            >
              취소
            </button>
            <button
              type="button"
              onClick={() => confirmDefaultRestore(restoreSession.transaction)}
              className={cn(
                "min-h-11 rounded-xl border border-accent bg-accent px-3 text-xs font-bold text-on-accent transition-colors hover:bg-accent-2",
                STUDIO_FOCUS_RING,
              )}
            >
              {restoreSession.transaction.changes.length}개 설정 복원
            </button>
          </div>
        </div>
      ) : restoreSession?.status === "applied" ? (
        <div className="flex min-h-11 items-center gap-3">
          <CheckCircle2 size={17} className="shrink-0 text-good" aria-hidden />
          <p className="min-w-0 flex-1 text-xs text-fg-2">
            {restoreSession.transaction.changes.length}개 설정을 복원했습니다.
          </p>
          <button
            type="button"
            onClick={() => undoDefaultRestore(restoreSession.transaction)}
            className={cn(
              "flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised",
              STUDIO_FOCUS_RING,
            )}
          >
            <Undo2 size={14} aria-hidden />
            되돌리기
          </button>
        </div>
      ) : restoreSession ? (
        <div
          role="status"
          data-studio-brush-default-restore-status={restoreSession.status}
          className="flex min-h-11 items-center gap-3"
        >
          <CheckCircle2
            size={17}
            className={cn(
              "shrink-0",
              restoreSession.status === "unchanged" ? "text-good" : "text-warn",
            )}
            aria-hidden
          />
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-fg-2">
            {restoreSession.message}
          </p>
          {restoreSession.status === "unavailable" ? (
            <button
              type="button"
              onClick={() => void requestDefaultRestore()}
              className={cn(
                "min-h-11 shrink-0 rounded-xl border border-line bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:bg-raised",
                STUDIO_FOCUS_RING,
              )}
            >
              다시 시도
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-fg-2">선택 브러시 전체 설정</p>
            <p className="mt-0.5 text-[0.65rem] leading-relaxed text-fg-3">
              굵기·불투명도·필압·보정·촉을 함께 복원하며 현재 색상은 유지합니다.
            </p>
          </div>
          <button
            type="button"
            disabled={restoreLoading}
            onClick={() => void requestDefaultRestore()}
            className={cn(
              "flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-line-strong bg-card px-3 text-xs font-semibold text-fg-2 transition-colors hover:border-accent/55 hover:bg-raised disabled:cursor-wait disabled:opacity-55",
              STUDIO_FOCUS_RING,
            )}
          >
            {restoreLoading ? (
              <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" aria-hidden />
            ) : (
              <RotateCcw size={15} aria-hidden />
            )}
            {restoreLoading ? "기본값 불러오는 중" : "이 브러시 기본값 복원"}
          </button>
        </div>
      )}
    </div>
  );

  const modal = open ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-studio-brush-studio-dialog="true"
      data-no-fx
      className="fixed inset-0 isolate z-[180] flex items-end justify-center overflow-hidden overscroll-none bg-[oklch(0.08_0.01_70/0.78)] p-0 pb-[env(safe-area-inset-bottom)] text-fg sm:items-center sm:p-4"
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={closeStudio}
        className="absolute inset-0 z-0 cursor-default"
      />
      <div
        ref={dialogRef}
        className="relative z-10 flex h-[calc(100dvh-env(safe-area-inset-bottom))] max-h-full w-full flex-col overflow-hidden overscroll-contain rounded-t-2xl border border-line bg-panel shadow-2xl sm:h-[min(44rem,calc(100dvh-2rem))] sm:max-w-[min(74rem,calc(100vw-1.5rem))] sm:rounded-2xl"
      >
        <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-line px-3 sm:px-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <SlidersHorizontal size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-bold text-fg">브러시 스튜디오</h2>
            <p id={descriptionId} className="truncate text-[0.65rem] text-fg-3">
              {brushLabel} · {dynamicsActive ? `${mappingCount}개 입력 연결` : "전역 입력과 입자 브러시 설정"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCategory("engines")}
            aria-label="커스텀 브러시로 저장"
            title="커스텀 브러시로 저장"
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
              category === "engines" && "border-accent/55 text-accent",
            )}
          >
            <Save size={17} aria-hidden />
          </button>
          <button
            ref={closeRef}
            type="button"
            onClick={closeStudio}
            aria-label="브러시 스튜디오 닫기"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-card text-fg-2 hover:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        {restoreAction}

        <div className="shrink-0 border-b border-line p-2 sm:hidden">
          <StudioBrushDynamicsPreview settings={settings} strokeWidth={strokeWidth} color={color} />
        </div>

        <div className="flex min-h-0 flex-1 flex-col sm:grid sm:grid-cols-[10rem_minmax(0,1fr)_14rem]">
          <div
            role="tablist"
            aria-label="브러시 스튜디오 설정 분류"
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 [scrollbar-width:none] sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r sm:p-3"
          >
            {CATEGORY_ITEMS.map(({ id, label, description, Icon }) => {
              const active = category === id;
              return (
                <button
                  key={id}
                  id={`${tabIdBase}-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls={tabPanelId}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setCategory(id)}
                  onKeyDown={handleCategoryKeyDown}
                  className={cn(
                    "flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent sm:w-full",
                    active ? "bg-accent-soft text-fg" : "text-fg-2 hover:bg-raised"
                  )}
                >
                  <Icon size={15} className={active ? "text-accent" : "text-fg-3"} aria-hidden />
                  <span>
                    <span className="block whitespace-nowrap text-xs font-semibold">{label}</span>
                    <span className="hidden text-[0.62rem] text-fg-3 sm:block">{description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <section
            id={tabPanelId}
            role="tabpanel"
            aria-labelledby={`${tabIdBase}-${category}`}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-5 sm:py-4"
          >
            {content}
          </section>

          <aside className="hidden border-l border-line p-3 sm:block">
            <div className="sticky top-3 space-y-3">
              <StudioBrushDynamicsPreview settings={settings} strokeWidth={strokeWidth} color={color} />
              <div className="rounded-xl border border-line bg-card/45 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-fg-2">
                  <RotateCw size={14} className="text-accent" aria-hidden /> 재현 가능한 획
                </div>
                <p className="mt-1 text-[0.64rem] leading-relaxed text-fg-3">
                  산포와 무작위 질감은 획 ID로 고정되어 다시 열기, SVG 내보내기, 협업 재생에서도 같은 모양을 유지합니다.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        ref={launcherRef}
        type="button"
        onClick={() => {
          onBeforeOpen?.();
          setOpen(true);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border border-line bg-card/55 text-left transition-colors duration-150 hover:border-accent/45 hover:bg-raised",
          STUDIO_FOCUS_RING,
          touch ? "min-h-14 px-3 py-2" : "min-h-[44px] px-2.5 py-1.5"
        )}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/15">
          <SlidersHorizontal size={16} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-fg-2">브러시 스튜디오</span>
          <span className="block truncate text-[0.65rem] text-fg-3">{launcherSummary}</span>
        </span>
        <ChevronRight size={16} className="shrink-0 text-fg-3" aria-hidden />
      </button>
      {typeof document === "undefined" || !modal ? modal : createPortal(modal, document.body)}
      {/* brush-studio-marketplace-shortcut */}
      <MarketplaceBrushStudioBridge snapshot={currentSnapshot} visible={open} />
    </>
  );
}
