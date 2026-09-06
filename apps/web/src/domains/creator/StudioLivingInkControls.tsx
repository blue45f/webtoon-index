import { Droplets, Eraser, LockKeyhole, Paintbrush, Power, Waves } from "lucide-react";

import { STUDIO_WASH_INK_PRODUCT_LABEL_KO } from "./brush/studio-brush-behavior-ui";
import {
  livingInkMaterialPatchForPaper,
  matchPaperKindFromLivingInkMaterial,
  STUDIO_PAPER_SURFACE_CATALOG,
} from "./brush/studio-paper-surface-catalog";
import { DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS } from "./studio-living-ink-gpu-protocol";
import { STUDIO_EASE, STUDIO_FOCUS_RING } from "./studio-panel-ui";
import { studioToolHintFromLabel } from "./studio-tool-hints";
import { StudioToolHintTarget } from "./StudioToolHint";

import type { StudioLivingInkMaterialControls } from "./studio-living-ink-gpu-protocol";
import type {
  StudioLivingInkStrokeMode,
  StudioLivingInkStudioState,
} from "./studio-living-ink-studio-coordinator";

import { cn } from "@/shared/lib/utils";

const WASH = STUDIO_WASH_INK_PRODUCT_LABEL_KO;

export interface StudioLivingInkControlsProps {
  readonly supported: boolean;
  readonly physicalModeEnabled: boolean;
  readonly onPhysicalModeEnabledChange: (enabled: boolean) => void;
  readonly state: StudioLivingInkStudioState;
  readonly mode: StudioLivingInkStrokeMode;
  readonly onModeChange: (mode: StudioLivingInkStrokeMode) => void;
  readonly scope: "all" | "selection";
  readonly onScopeChange: (scope: "all" | "selection") => void;
  readonly selectionAvailable: boolean;
  readonly busy: boolean;
  readonly fixAvailable: boolean;
  readonly fixUnavailableReason?: string;
  readonly onFix: () => void;
  readonly onClear: () => void;
  readonly material: StudioLivingInkMaterialControls;
  readonly materialLocked: boolean;
  readonly materialLockedReason?: string;
  readonly onMaterialChange: (patch: Partial<StudioLivingInkMaterialControls>) => void;
}

const buttonClass = cn(
  "grid size-8 shrink-0 place-items-center rounded-lg border pointer-coarse:size-11",
  STUDIO_EASE,
  STUDIO_FOCUS_RING,
);

function stateLabel(state: StudioLivingInkStudioState): string {
  if (state === "ready") return "번짐 준비됨";
  if (state === "loading") return "번짐 상태 복원 중";
  if (state === "failed") return "번짐 복원 실패 · 일반 수채로 안전 전환";
  return "이 기기에서는 일반 수채로 안전 전환";
}

export function StudioLivingInkControls({
  supported,
  physicalModeEnabled,
  onPhysicalModeEnabledChange,
  state,
  mode,
  onModeChange,
  scope,
  onScopeChange,
  selectionAvailable,
  busy,
  fixAvailable,
  fixUnavailableReason = "정착층 저장·재열기 패리티 검증이 끝날 때까지 안전하게 비활성화됩니다.",
  onFix,
  onClear,
  material,
  materialLocked,
  materialLockedReason = "이미 그려 둔 번짐 레이어의 재질을 바꾸면 과거 획 결과도 달라집니다. 레이어를 지운 뒤 새 재질로 시작해 주세요.",
  onMaterialChange,
}: StudioLivingInkControlsProps) {
  if (!supported) return null;
  const ready = state === "ready" && !busy;
  const physicalBrushReady = ready && physicalModeEnabled;
  const selectionScopeDisabled = !selectionAvailable;
  return (
    <div
      data-studio-living-ink-controls="true"
      data-studio-living-ink-state={state}
      data-studio-living-ink-physical-mode={physicalModeEnabled ? "enabled" : "disabled"}
      data-studio-brush-behavior="wash"
      className="flex shrink-0 items-center gap-1 rounded-xl border border-line/70 bg-card/70 px-1 py-0.5"
    >
      <span className="hidden select-none px-1 text-[0.55rem] font-bold tracking-tight text-fg-3 sm:inline">
        {WASH}
      </span>
      <StudioToolHintTarget
        hint={studioToolHintFromLabel(
          `${WASH} 물리 모드`,
          physicalModeEnabled
            ? "전체 물·안료 시뮬레이션을 사용합니다. 끄면 각 획이 다른 브러시처럼 독립된 빠른 레이어로 저장됩니다."
            : "기본값은 빠른 독립 획입니다. 물·안료가 이전 획과 계속 섞이는 전용 표면이 필요할 때만 물리 모드를 켜세요.",
          undefined,
          "ink",
        )}
      >
        <button
          type="button"
          data-studio-living-ink-physical-toggle="true"
          disabled={busy}
          aria-pressed={physicalModeEnabled}
          aria-label={`${WASH} 물리 모드`}
          onClick={() => onPhysicalModeEnabledChange(!physicalModeEnabled)}
          className={cn(
            buttonClass,
            physicalModeEnabled
              ? "border-accent/60 bg-accent-soft text-accent"
              : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
            busy && "cursor-not-allowed opacity-45",
          )}
        >
          <Power size={14} aria-hidden />
        </button>
      </StudioToolHintTarget>
      <div
        role="group"
        aria-label={`${WASH} 도구`}
        className="flex items-center rounded-lg bg-canvas/70 p-0.5"
      >
        {([
          ["ink", "안료", Paintbrush],
          ["water", "물", Waves],
        ] as const).map(([id, label, Icon]) => (
          <StudioToolHintTarget
            key={id}
            hint={studioToolHintFromLabel(
              `${WASH} · ${label}`,
              id === "ink"
                ? "수채·수묵 브러시로 안료와 물을 함께 놓습니다. 펜(애플 펜슬)이 곧 안료이고, 배럴 버튼을 누르는 동안만 물로 바뀌어요. 필압·속도가 번짐에 반영됩니다."
                : "이미 올린 안료에 물과 흐름만 더해 다시 번지게 합니다. 펜을 한 번 쓴 뒤 손가락으로 그리면 이 물 브러시로 자동 전환돼요. 마른 픽셀을 흐리게 지우는 지우개와는 달라요.",
              undefined,
              "ink",
            )}
          >
            <button
              type="button"
              disabled={!physicalBrushReady}
              aria-pressed={mode === id}
              aria-label={`${WASH} ${label}`}
              onClick={() => onModeChange(id)}
              className={cn(
                buttonClass,
                mode === id
                  ? "border-accent/60 bg-accent-soft text-accent"
                  : "border-transparent text-fg-3 hover:bg-raised hover:text-fg",
                !physicalBrushReady && "cursor-not-allowed opacity-45",
              )}
            >
              <Icon size={15} aria-hidden />
            </button>
          </StudioToolHintTarget>
        ))}
      </div>

      <StudioToolHintTarget
        hint={studioToolHintFromLabel(
          `${WASH} 처리 범위`,
          selectionAvailable
            ? "전체 번짐 레이어 또는 현재 픽셀 선택만 정착·지우기 대상으로 고정합니다. 실행 순간 선택 마스크가 복사돼요."
            : "현재 번짐 레이어에 픽셀 선택이 없어 전체 범위만 사용할 수 있습니다.",
        )}
      >
        <label className="sr-only" htmlFor="studio-living-ink-scope">{WASH} 처리 범위</label>
        <select
          id="studio-living-ink-scope"
          aria-label={`${WASH} 처리 범위`}
          value={selectionScopeDisabled ? "all" : scope}
          disabled={!ready}
          onChange={(event) => onScopeChange(event.target.value === "selection" ? "selection" : "all")}
          className={cn(
            "h-8 rounded-lg border border-line bg-card px-1.5 text-[0.62rem] font-bold text-fg pointer-coarse:h-11",
            STUDIO_FOCUS_RING,
          )}
        >
          <option value="all">전체</option>
          <option value="selection" disabled={selectionScopeDisabled}>선택</option>
        </select>
      </StudioToolHintTarget>

      <StudioToolHintTarget
        disabled={!ready || !fixAvailable}
        unavailableReason={!fixAvailable ? fixUnavailableReason : undefined}
        hint={studioToolHintFromLabel(
          `${WASH} 정착`,
          "아직 움직이는 안료를 종이에 고정해, 이후 물 도구로 다시 움직이지 않게 합니다.",
          undefined,
          "layer-lock",
          "lock",
        )}
      >
        <button
          type="button"
          data-studio-living-ink-fix="true"
          disabled={!ready || !fixAvailable}
          aria-label={`${WASH} 정착`}
          onClick={onFix}
          className={cn(
            buttonClass,
            "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <LockKeyhole size={14} aria-hidden />
        </button>
      </StudioToolHintTarget>

      <StudioToolHintTarget
        disabled={!ready}
        hint={studioToolHintFromLabel(
          `${WASH} 지우기`,
          scope === "selection"
            ? "선택 마스크 영역의 물·이동 안료·정착 안료를 지웁니다. 실행 취소는 한 단계입니다."
            : "현재 번짐 레이어 전체를 지웁니다. 확인 뒤 실행되며 실행 취소는 한 단계입니다.",
          undefined,
          "erase",
        )}
      >
        <button
          type="button"
          data-studio-living-ink-clear="true"
          disabled={!ready}
          aria-label={`${WASH} 지우기`}
          onClick={onClear}
          className={cn(
            buttonClass,
            "border-line bg-card text-fg-3 hover:border-danger/55 hover:bg-danger/10 hover:text-danger disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <Eraser size={14} aria-hidden />
        </button>
      </StudioToolHintTarget>

      <details className="group relative">
        <summary
          aria-label={`${WASH} 재질 설정`}
          className={cn(
            "grid size-8 cursor-pointer list-none place-items-center rounded-lg border border-line bg-card text-fg-3 hover:bg-raised hover:text-fg pointer-coarse:size-11",
            STUDIO_FOCUS_RING,
          )}
        >
          <Droplets size={14} aria-hidden />
        </summary>
        <div className="absolute bottom-[calc(100%+0.55rem)] right-0 z-[80] w-64 rounded-xl border border-line bg-panel/98 p-3 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <strong className="text-xs text-fg">물·종이 재질</strong>
            <span role="status" className="text-[0.58rem] text-fg-3">{stateLabel(state)}</span>
          </div>
          {materialLocked ? (
            <p className="mb-2 rounded-lg border border-amber-400/25 bg-amber-400/8 px-2 py-1.5 text-[0.58rem] leading-relaxed text-amber-100">
              {materialLockedReason}
            </p>
          ) : null}

          <div className="mb-2.5">
            <span className="mb-1 block text-[0.62rem] font-bold text-fg-2">종이 질감</span>
            <p className="mb-1 text-[0.52rem] leading-snug text-fg-3">
              문서 종이와 같은 카탈로그입니다. 수채 중목·한지·목탄지 등이 실제 결 높이와 맞춰집니다.
            </p>
            <div className="grid grid-cols-4 gap-1">
              {STUDIO_PAPER_SURFACE_CATALOG.map((entry) => {
                const isActive = matchPaperKindFromLivingInkMaterial(material) === entry.id
                  && Math.abs(material.paperFiber - entry.livingInk.paperFiber) < 0.08
                  && Math.abs(material.paperTooth - entry.livingInk.paperTooth) < 0.08;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    disabled={busy || materialLocked}
                    title={entry.description}
                    aria-label={entry.label}
                    aria-pressed={isActive}
                    onClick={() =>
                      onMaterialChange(livingInkMaterialPatchForPaper(entry.id))
                    }
                    className={cn(
                      "h-6 rounded border px-1 text-[0.55rem] font-medium transition-colors",
                      isActive
                        ? "border-accent bg-accent/15 text-accent font-bold"
                        : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg",
                    )}
                  >
                    {entry.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {([
            ["flow", "안료 흐름"],
            ["bleed", "번짐"],
            ["dryRate", "건조 속도"],
            ["chromaticSeparation", "색상 분리"],
            ["brushPigmentLoad", "브러시 안료"],
            ["capillaryCreep", "모세관 확산"],
            ["vorticity", "소용돌이"],
            ["dryingEdgeDeposition", "테두리 응집"],
            ["edgeDarkening", "가장자리 암화"],
            ["wetSheen", "젖은 광택"],
            ["beerLambertDensity", "광학 밀도"],
            ["paperFiber", "종이 섬유"],
            ["paperTooth", "종이 요철"],
            ["granulation", "과립"],
          ] as const).map(([key, label]) => (
            <label key={key} className="mb-2 grid grid-cols-[4.7rem_1fr_2rem] items-center gap-2 text-[0.62rem] text-fg-2">
              <span>{label}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={material[key]}
                disabled={busy || materialLocked}
                onChange={(event) => onMaterialChange({ [key]: Number(event.target.value) })}
                className="studio-range min-w-0"
                aria-label={`${WASH} ${label}`}
              />
              <span className="tabular-nums text-right text-fg-3">{Math.round(material[key] * 100)}</span>
            </label>
          ))}
          <button
            type="button"
            className={cn(
              "mt-1 h-8 w-full rounded-lg border border-line bg-card text-[0.62rem] font-bold text-fg-2 hover:bg-raised hover:text-fg",
              STUDIO_FOCUS_RING,
            )}
            onClick={() => onMaterialChange(DEFAULT_STUDIO_LIVING_INK_MATERIAL_CONTROLS)}
            disabled={busy || materialLocked}
          >
            재질 기본값 복원
          </button>
        </div>
      </details>
    </div>
  );
}
