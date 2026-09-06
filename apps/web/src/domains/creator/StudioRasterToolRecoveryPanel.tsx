import {
  Circle,
  CheckCircle2,
  ChevronRight,
  ImagePlus,
  Lasso,
  Layers3,
  Loader2,
  Paintbrush,
  Pentagon,
  Pipette,
  Square,
  WandSparkles,
} from "lucide-react";
import { useId, type ReactElement } from "react";

// Vocabulary only. `studio-filter-menu` re-exports the same labels/kinds, but it also owns the
// draft engine and therefore statically pulls the whole filter pack (blur/curves/auto-adjust/
// color-to-alpha kernels). This panel renders a <select> of names, so it reads them from the
// dependency-free registry that is already part of the eager Studio graph.
import {
  STUDIO_FILTER_ALL_KINDS,
  STUDIO_FILTER_ALL_LABELS,
} from "./filter/studio-filter-pack-registry";
import { preloadStudioRasterRetouchRuntime } from "./render/studio-raster-retouch-preload";
import {
  resolveStudioInspectorRasterToolPolicy,
  type StudioInspectorRasterToolPolicy,
} from "./studio-inspector-raster-tool-policy";
import { STUDIO_EASE, STUDIO_FOCUS_RING, StudioContextPill } from "./studio-panel-ui";

import type { StudioFilterKind } from "./filter/studio-filter-menu";
import type {
  StudioRasterRecoveryAction,
  StudioRasterToolAvailability,
} from "./render/studio-raster-tool-availability";

import { buttonClass } from "@/shared/components/ui/button-utils";
import { cn } from "@/shared/lib/utils";

export type StudioRasterRecoveryRequest = Readonly<{
  toolId: StudioRasterToolAvailability["tool"]["id"];
  action: StudioRasterRecoveryAction;
}>;

export interface StudioRasterToolRecoveryPanelProps {
  entries: readonly StudioRasterToolAvailability[];
  busy?: boolean;
  onRecover: (request: StudioRasterRecoveryRequest) => void;
}

function gateLabel(entry: StudioRasterToolAvailability): string {
  return resolveStudioInspectorRasterToolPolicy(entry).statusLabel;
}

function gateTone(
  entry: StudioRasterToolAvailability,
): "neutral" | "accent" | "good" | "warn" {
  const policy = resolveStudioInspectorRasterToolPolicy(entry);
  if (policy.state === "ready") return "good";
  if (policy.selectable) return "accent";
  return entry.entry.action ? "warn" : "neutral";
}

function recoveryButtonLabel(
  entry: StudioRasterToolAvailability,
  policy: StudioInspectorRasterToolPolicy,
): string {
  if (policy.state === "prepare-page-composite") {
    return policy.actionLabel;
  }
  return entry.entry.action?.label ?? policy.actionLabel;
}

function prewarmStudioRasterRecoveryIntent(
  request: StudioRasterRecoveryRequest,
): void {
  if (request.action.id !== "create-editable-raster-copy") return;
  switch (request.toolId) {
    case "smudge":
    case "dodge-burn":
    case "wet-mix":
    case "heal":
    case "crop":
    case "pixel-transform":
    case "puppet-warp":
      void preloadStudioRasterRetouchRuntime().catch(() => undefined);
      return;
    case "liquify":
      void preloadStudioRasterRetouchRuntime({ liquify: true }).catch(() => undefined);
      return;
    default:
      return;
  }
}

/**
 * 픽셀 도구의 숨은 전제조건을 한곳에서 보여 주고, 가능한 복구는 같은 자리에서 실행한다.
 * 원본을 파괴하는 자동 변환은 하지 않으며 canonical availability의 문구와 액션만 표시한다.
 */
export function StudioRasterToolRecoveryPanel({
  entries,
  busy = false,
  onRecover,
}: StudioRasterToolRecoveryPanelProps): ReactElement | null {
  if (entries.length === 0) return null;
  const firstRecovery = entries[0]?.entry.action ?? null;
  const sharedRecovery =
    entries.length > 1 &&
    firstRecovery !== null &&
    entries.every(
      (entry) =>
        !entry.entry.enabled &&
        entry.entry.action?.id === firstRecovery.id,
    )
      ? firstRecovery
      : null;

  return (
    <section
      aria-label="픽셀 편집 준비"
      aria-busy={busy}
      data-studio-raster-tool-recovery="true"
      className="overflow-hidden rounded-xl border border-line bg-card/50"
    >
      <header className="flex items-start gap-2 border-b border-line/60 px-3 py-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          {busy ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : (
            <Layers3 className="size-3.5" aria-hidden />
          )}
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold tracking-tight text-fg">
            픽셀 편집 대상
          </span>
          <span
            role="status"
            aria-live="polite"
            className="mt-0.5 block text-[0.68rem] leading-relaxed text-fg-3"
          >
            {busy
              ? "편집용 래스터 복사본을 준비 중입니다. Esc를 누르면 준비를 취소할 수 있습니다."
              : "원본 레이어를 유지하면서 필요한 대상만 안전하게 준비합니다."}
          </span>
        </span>
      </header>

      <div className="divide-y divide-line/50">
        {entries.map((entry) => {
          const recovery = entry.entry.action;
          const policy = resolveStudioInspectorRasterToolPolicy(entry);
          const showRecovery =
            recovery !== null &&
            (!entry.entry.enabled || policy.state === "prepare-page-composite") &&
            sharedRecovery === null;
          const reasonId = `studio-raster-${entry.tool.id}-reason`;
          return (
            <div
              key={entry.tool.id}
              data-studio-raster-tool={entry.tool.id}
              className="space-y-2 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="inline-flex min-w-0 items-center gap-1.5 text-[0.72rem] font-semibold text-fg-2">
                  {entry.entry.enabled ? (
                    <CheckCircle2 className="size-3.5 shrink-0 text-good" aria-hidden />
                  ) : (
                    <ImagePlus className="size-3.5 shrink-0 text-fg-3" aria-hidden />
                  )}
                  <span className="truncate">{entry.tool.label}</span>
                </span>
                <StudioContextPill tone={gateTone(entry)}>{gateLabel(entry)}</StudioContextPill>
              </div>

              {entry.entry.reason ? (
                <p
                  id={reasonId}
                  role={entry.entry.enabled ? "status" : undefined}
                  className="text-[0.68rem] leading-relaxed text-fg-3"
                >
                  {entry.entry.reason}
                </p>
              ) : null}

              {showRecovery ? (
                <button
                  type="button"
                  disabled={busy}
                  aria-describedby={entry.entry.reason ? reasonId : undefined}
                  title={policy.unavailableReason ?? undefined}
                  onPointerEnter={() =>
                    prewarmStudioRasterRecoveryIntent({
                      toolId: entry.tool.id,
                      action: recovery,
                    })
                  }
                  onPointerDown={() =>
                    prewarmStudioRasterRecoveryIntent({
                      toolId: entry.tool.id,
                      action: recovery,
                    })
                  }
                  onFocus={() =>
                    prewarmStudioRasterRecoveryIntent({
                      toolId: entry.tool.id,
                      action: recovery,
                    })
                  }
                  onClick={() => onRecover({ toolId: entry.tool.id, action: recovery })}
                  className={buttonClass({
                    size: "sm",
                    variant: recovery.safety === "non-destructive-copy" ? "solid" : "quiet",
                    className: "min-h-10 w-full justify-between gap-2 pointer-coarse:min-h-11",
                  })}
                >
                  <span>{recoveryButtonLabel(entry, policy)}</span>
                  <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {sharedRecovery ? (
        <footer className="border-t border-line/60 p-2.5">
          <button
            type="button"
            disabled={busy}
            onPointerEnter={() =>
              prewarmStudioRasterRecoveryIntent({
                toolId: entries[0]!.tool.id,
                action: sharedRecovery,
              })
            }
            onPointerDown={() =>
              prewarmStudioRasterRecoveryIntent({
                toolId: entries[0]!.tool.id,
                action: sharedRecovery,
              })
            }
            onFocus={() =>
              prewarmStudioRasterRecoveryIntent({
                toolId: entries[0]!.tool.id,
                action: sharedRecovery,
              })
            }
            onClick={() =>
              onRecover({
                toolId: entries[0]!.tool.id,
                action: sharedRecovery,
              })
            }
            className={buttonClass({
              size: "sm",
              variant:
                sharedRecovery.safety === "non-destructive-copy"
                  ? "solid"
                  : "quiet",
              className:
                "min-h-10 w-full justify-between gap-2 pointer-coarse:min-h-11",
            })}
          >
            <span>
              {entries.length}개 도구용 ·{" "}
              {resolveStudioInspectorRasterToolPolicy(entries[0]!).state ===
              "prepare-page-composite"
                ? "페이지 합성본 준비 후 실행"
                : sharedRecovery.label}
            </span>
            <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          </button>
        </footer>
      ) : null}
    </section>
  );
}

const STUDIO_INSPECTOR_PIXEL_SELECTION_TOOL_IDS = [
  "rect",
  "ellipse",
  "circle",
  "lasso",
  "poly-lasso",
  "brush",
  "wand",
  "color-range",
] as const;

export type StudioInspectorPixelSelectionToolId =
  (typeof STUDIO_INSPECTOR_PIXEL_SELECTION_TOOL_IDS)[number];

const STUDIO_INSPECTOR_PIXEL_SELECTION_TOOLS: Readonly<
  Record<
    StudioInspectorPixelSelectionToolId,
    Readonly<{
      label: string;
      shortDescription: string;
      icon: typeof Square;
      iconClassName?: string;
    }>
  >
> = {
  rect: {
    label: "사각 선택",
    shortDescription: "드래그한 사각 영역",
    icon: Square,
  },
  ellipse: {
    label: "타원 선택",
    shortDescription: "드래그한 타원 영역",
    icon: Circle,
    iconClassName: "scale-x-125",
  },
  circle: {
    label: "원형 선택",
    shortDescription: "가로·세로가 같은 정원",
    icon: Circle,
  },
  lasso: {
    label: "자유 올가미",
    shortDescription: "손으로 그린 자유 영역",
    icon: Lasso,
  },
  "poly-lasso": {
    label: "다각형 올가미",
    shortDescription: "꼭짓점을 잇는 다각형",
    icon: Pentagon,
  },
  brush: {
    label: "선택 브러시",
    shortDescription: "붓으로 칠한 선택 영역",
    icon: Paintbrush,
  },
  wand: {
    label: "마술봉",
    shortDescription: "이어진 비슷한 색 영역",
    icon: WandSparkles,
  },
  "color-range": {
    label: "색상 범위",
    shortDescription: "추출한 색과 비슷한 영역",
    icon: Pipette,
  },
};

export interface StudioInspectorPixelSelectionLauncherProps {
  availability: StudioRasterToolAvailability;
  activeTool: StudioInspectorPixelSelectionToolId | null;
  busy?: boolean;
  heading?: string;
  toolIds?: readonly StudioInspectorPixelSelectionToolId[];
  onPickTool: (tool: StudioInspectorPixelSelectionToolId) => void;
  onRecover: (request: StudioRasterRecoveryRequest) => void;
}

/**
 * Inspector의 픽셀 선택 도구 팔레트. 도구 선택과 대상 준비를 분리하여, 정확하게 합성할
 * 수 있는 벡터-only 페이지에서는 버튼을 죽이지 않고 같은 클릭으로 합성본 준비까지 잇는다.
 * 진짜 차단 상태는 `aria-disabled`로 포커스 가능한 채 유지해 정확한 사유를 읽을 수 있다.
 */
export function StudioInspectorPixelSelectionLauncher({
  availability,
  activeTool,
  busy = false,
  heading = "선택 도구",
  toolIds = STUDIO_INSPECTOR_PIXEL_SELECTION_TOOL_IDS,
  onPickTool,
  onRecover,
}: StudioInspectorPixelSelectionLauncherProps): ReactElement {
  const descriptionId = useId();
  const titleId = `${descriptionId}-title`;
  const policy = resolveStudioInspectorRasterToolPolicy(availability);
  const recovery = availability.entry.action;
  const statusDescription = busy && policy.selectable
    ? "페이지 합성본을 준비 중입니다. 다른 선택 도구를 누르면 마지막에 고른 도구로 이어서 실행합니다."
    : policy.description;

  return (
    <section
      aria-labelledby={titleId}
      aria-busy={busy}
      data-studio-inspector-selection-launcher="true"
      data-studio-raster-entry-state={policy.state}
      className="space-y-2.5 rounded-xl border border-line bg-card/50 p-2.5"
    >
      <header className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span
            id={titleId}
            className="flex items-center gap-1.5 text-xs font-semibold tracking-tight text-fg"
          >
            {busy ? (
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Square className="size-3.5 shrink-0 text-accent" aria-hidden />
            )}
            {heading}
          </span>
          <span
            id={descriptionId}
            role="status"
            aria-live="polite"
            className="mt-0.5 block text-[0.68rem] leading-relaxed text-fg-3"
          >
            {statusDescription}
          </span>
        </span>
        <StudioContextPill
          tone={
            policy.state === "ready"
              ? "good"
              : policy.selectable
                ? "accent"
                : availability.entry.action
                  ? "warn"
                  : "neutral"
          }
        >
          {policy.statusLabel}
        </StudioContextPill>
      </header>

      <div
        role="toolbar"
        aria-label="픽셀 선택 도구"
        aria-describedby={descriptionId}
        className="grid grid-cols-2 gap-1.5"
      >
        {toolIds.map((toolId) => {
          const tool = STUDIO_INSPECTOR_PIXEL_SELECTION_TOOLS[toolId];
          const Icon = tool.icon;
          const active = activeTool === toolId;
          const buttonTitle = policy.selectable
            ? `${tool.label} · ${policy.actionLabel}`
            : policy.unavailableReason ?? policy.description;
          return (
            <button
              key={toolId}
              type="button"
              aria-label={tool.label}
              aria-pressed={active}
              aria-disabled={!policy.selectable}
              aria-describedby={descriptionId}
              title={buttonTitle}
              onClick={() => {
                if (!policy.selectable) return;
                onPickTool(toolId);
              }}
              className={cn(
                "group min-h-11 rounded-lg border px-2.5 py-2 text-left pointer-coarse:min-h-11",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent-soft text-accent shadow-sm"
                  : policy.selectable
                    ? "border-line bg-canvas/60 text-fg-2 hover:border-line-strong hover:bg-raised"
                    : "cursor-not-allowed border-line/70 bg-canvas/35 text-fg-3 opacity-65",
              )}
            >
              <span className="flex items-center gap-1.5 text-[0.7rem] font-semibold">
                <Icon
                  className={cn("size-3.5 shrink-0", tool.iconClassName)}
                  aria-hidden
                />
                <span className="truncate">{tool.label}</span>
              </span>
              <span className="mt-0.5 block truncate pl-5 text-[0.58rem] font-medium text-fg-3">
                {active ? "선택됨" : tool.shortDescription}
              </span>
            </button>
          );
        })}
      </div>

      <p className="rounded-lg border border-line/70 bg-canvas/45 px-2.5 py-2 text-[0.68rem] leading-relaxed text-fg-3">
        <span className="font-semibold text-fg-2">{policy.actionLabel}</span>
        {policy.selectable && policy.state !== "ready"
          ? " · 원본 레이어는 그대로 보존됩니다."
          : null}
      </p>

      {!policy.selectable && recovery ? (
        <button
          type="button"
          aria-describedby={descriptionId}
          onClick={() =>
            onRecover({
              toolId: availability.tool.id,
              action: recovery,
            })
          }
          className={buttonClass({
            size: "sm",
            variant:
              recovery.safety === "non-destructive-copy"
                ? "solid"
                : "quiet",
            className:
              "min-h-10 w-full justify-between gap-2 pointer-coarse:min-h-11",
          })}
        >
          <span>{recovery.label}</span>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}

export interface StudioInspectorFilterLauncherProps {
  availability: StudioRasterToolAvailability;
  busy?: boolean;
  onRecover: (request: StudioRasterRecoveryRequest) => void;
  onSelect: (kind: StudioFilterKind) => void;
}

/**
 * 이미지가 선택되지 않아도 페이지 합성본으로 필터를 시작할 수 있는 Inspector 진입점.
 * native select는 긴 필터 목록과 모바일 키보드/스크린리더를 동시에 안정적으로 지원한다.
 */
export function StudioInspectorFilterLauncher({
  availability,
  busy = false,
  onRecover,
  onSelect,
}: StudioInspectorFilterLauncherProps): ReactElement {
  const descriptionId = useId();
  const gate = availability.entry;
  const policy = resolveStudioInspectorRasterToolPolicy(availability);
  const disabled = busy || !policy.selectable;
  const recovery = gate.action;
  const targetLabel = policy.targetLabel;

  return (
    <section
      aria-labelledby={`${descriptionId}-title`}
      data-studio-inspector-filter-launcher="true"
      className="space-y-2.5 rounded-xl border border-line bg-card/50 p-2.5"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={`${descriptionId}-title`}
            className="flex items-center gap-1.5 text-xs font-semibold tracking-tight text-fg"
          >
            <WandSparkles className="size-3.5 text-accent" aria-hidden />
            필터 갤러리
          </h3>
          <p id={descriptionId} className="mt-0.5 text-[0.68rem] leading-relaxed text-fg-3">
            {busy
              ? "원본을 보존한 필터 미리보기를 준비하고 있습니다."
              : policy.description}
          </p>
        </div>
        <StudioContextPill
          tone={
            policy.state === "ready"
              ? "good"
              : policy.selectable
                ? "accent"
                : recovery
                  ? "warn"
                  : "neutral"
          }
        >
          {policy.statusLabel}
        </StudioContextPill>
      </header>

      <label
        title={policy.selectable ? policy.actionLabel : policy.unavailableReason ?? undefined}
        className={cn(
          "flex min-h-10 items-center gap-2 rounded-lg border border-line bg-canvas/65 px-2.5",
          STUDIO_EASE,
          "focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/30 pointer-coarse:min-h-11",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-line-strong hover:bg-raised/70",
        )}
      >
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" aria-hidden />
        ) : (
          <WandSparkles className="size-4 shrink-0 text-accent" aria-hidden />
        )}
        <select
          aria-describedby={descriptionId}
          aria-label={`${targetLabel} 필터 선택`}
          defaultValue=""
          disabled={disabled}
          onChange={(event) => {
            const kind = event.currentTarget.value as StudioFilterKind;
            if (!kind) return;
            onSelect(kind);
            event.currentTarget.value = "";
          }}
          className={cn(
            "min-w-0 flex-1 cursor-pointer appearance-none bg-transparent text-xs font-semibold text-fg outline-none",
            disabled && "cursor-not-allowed",
          )}
        >
          <option value="" disabled>
            {busy ? "미리보기 준비 중…" : "필터 선택…"}
          </option>
          {STUDIO_FILTER_ALL_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {STUDIO_FILTER_ALL_LABELS[kind]}
            </option>
          ))}
        </select>
        <ChevronRight className="size-3.5 shrink-0 rotate-90 text-fg-3" aria-hidden />
      </label>

      {gate.reason ? (
        <p
          role="status"
          className="rounded-lg border border-line/70 bg-canvas/45 px-2.5 py-2 text-[0.68rem] leading-relaxed text-fg-3"
        >
          {gate.reason}
        </p>
      ) : null}

      {!policy.selectable && recovery ? (
        <button
          type="button"
          disabled={busy}
          aria-describedby={descriptionId}
          title={policy.unavailableReason ?? undefined}
          onClick={() => onRecover({ toolId: availability.tool.id, action: recovery })}
          className={cn(
            buttonClass({
              size: "sm",
              variant: recovery.safety === "non-destructive-copy" ? "solid" : "quiet",
              className: "min-h-10 w-full justify-between gap-2 pointer-coarse:min-h-11",
            }),
            STUDIO_FOCUS_RING,
          )}
        >
          <span>{recoveryButtonLabel(availability, policy)}</span>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        </button>
      ) : null}
    </section>
  );
}
