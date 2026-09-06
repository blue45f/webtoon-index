/**
 * StudioAiAssistHub — tabbed AI assist shell (PicsArt/Canva-class).
 * Connection status · production director · tool tabs · prompt presets · recent chips · tool slot.
 *
 * Layout contract: parent must give a bounded height (flex + min-h-0). This hub is
 * column-flex with a scrollable tool body so generate actions stay reachable.
 */
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  ImageIcon,
  MessageCircle,
  Palette,
  ShieldCheck,
  Settings2,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useId, useRef } from "react";

import { STUDIO_EASE, STUDIO_FOCUS_RING } from "../studio-panel-ui";

import {
  presetsForAssistTool,
  recentPromptsForTool,
  STUDIO_AI_ASSIST_TOOLS,
  type StudioAiAssistToolId,
  type StudioAiRecentPromptsState,
} from "./studio-ai-assist-ux";
import { planStudioAiExecutionPreflight } from "./studio-ai-execution-preflight";
import { StudioAiProductionLaunchpad } from "./StudioAiProductionLaunchpad";

import type { KeyboardEvent as ReactKeyboardEvent, ReactElement, ReactNode } from "react";

import { cn } from "@/shared/lib/utils";

const TOOL_ICONS: Record<StudioAiAssistToolId, LucideIcon> = {
  background: ImageIcon,
  character: UserRound,
  composition: Clapperboard,
  dialogue: MessageCircle,
  palette: Palette,
};

export interface StudioAiAssistHubProps {
  activeTool: StudioAiAssistToolId;
  onToolChange: (tool: StudioAiAssistToolId) => void;
  /** Image BYOK ready */
  imageConfigured: boolean;
  /** Text AI ready (server or BYOK) */
  textConfigured: boolean;
  connectionLabel: string;
  connectionOk: boolean;
  onOpenSettings: () => void;
  onPreloadSettings?: () => void;
  /** Optional provider selector (server AI) */
  providerSlot?: ReactNode;
  recentState: StudioAiRecentPromptsState;
  onApplyPresetPrompt: (tool: StudioAiAssistToolId, prompt: string) => void;
  /** Opens the episode-level script → continuity → batch → QA workflow. */
  onOpenEpisodeProduction?: () => void;
  onPreloadEpisodeProduction?: () => void;
  onOpenScenario?: () => void;
  scenarioDisabled?: boolean;
  scenarioDisabledReason?: string;
  onOpenSuperSuite?: () => void;
  onPreloadSuperSuite?: () => void;
  toolPanel: ReactNode;
  className?: string;
}

export function StudioAiAssistHub({
  activeTool,
  onToolChange,
  imageConfigured,
  textConfigured,
  connectionLabel,
  connectionOk,
  onOpenSettings,
  onPreloadSettings,
  providerSlot,
  recentState,
  onApplyPresetPrompt,
  onOpenEpisodeProduction,
  onPreloadEpisodeProduction,
  onOpenScenario,
  scenarioDisabled,
  scenarioDisabledReason,
  onOpenSuperSuite,
  onPreloadSuperSuite,
  toolPanel,
  className,
}: StudioAiAssistHubProps): ReactElement {
  const toolPanelRef = useRef<HTMLDivElement>(null);
  const preflightDetailsId = useId();
  const rawTabsId = useId();
  const tabsId = `studio-ai-assist-${rawTabsId.replace(/:/gu, "")}`;
  const toolMeta = STUDIO_AI_ASSIST_TOOLS.find((t) => t.id === activeTool) ?? STUDIO_AI_ASSIST_TOOLS[0]!;
  const presets = presetsForAssistTool(activeTool);
  const recents = recentPromptsForTool(recentState, activeTool, 3);
  const executionPreflight = planStudioAiExecutionPreflight({
    activeTool,
    imageConfigured,
    textConfigured,
    connectionLabel,
    connectionOk,
  });

  const applyPromptAndRevealToolPanel = (prompt: string) => {
    onApplyPresetPrompt(activeTool, prompt);
    globalThis.requestAnimationFrame(() => {
      toolPanelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  };

  const toolTabId = (tool: StudioAiAssistToolId) => `${tabsId}-tab-${tool}`;
  const toolPanelId = (tool: StudioAiAssistToolId) => `${tabsId}-panel-${tool}`;
  const handleToolTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    tool: StudioAiAssistToolId
  ) => {
    const index = STUDIO_AI_ASSIST_TOOLS.findIndex((item) => item.id === tool);
    if (index < 0) return;
    let nextIndex: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % STUDIO_AI_ASSIST_TOOLS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex =
        (index - 1 + STUDIO_AI_ASSIST_TOOLS.length) %
        STUDIO_AI_ASSIST_TOOLS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = STUDIO_AI_ASSIST_TOOLS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTool = STUDIO_AI_ASSIST_TOOLS[nextIndex]?.id;
    if (!nextTool) return;
    onToolChange(nextTool);
    globalThis.requestAnimationFrame(() => {
      document.getElementById(toolTabId(nextTool))?.focus();
    });
  };

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-2", className)}
      data-studio-ai-assist-hub="true"
    >
      {/* Connection strip — always visible */}
      <button
        type="button"
        onClick={onOpenSettings}
        onMouseEnter={onPreloadSettings}
        onFocus={onPreloadSettings}
        className={cn(
          "flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
          STUDIO_EASE,
          STUDIO_FOCUS_RING,
          connectionOk
            ? "border-good/35 bg-good/10 hover:bg-good/15"
            : "border-line bg-panel/50 hover:bg-raised"
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-fg">
          <Settings2 size={14} className="shrink-0 text-accent" aria-hidden />
          AI 어시스트 설정
        </span>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-[0.65rem] font-medium",
            connectionOk ? "text-good" : "text-fg-3"
          )}
        >
          {connectionOk ? <CheckCircle2 size={12} aria-hidden /> : null}
          <span className="max-w-[9rem] truncate">{connectionLabel}</span>
          <ChevronRight size={12} aria-hidden />
        </span>
      </button>

      {onOpenEpisodeProduction ? (
        <button
          type="button"
          onClick={onOpenEpisodeProduction}
          onMouseEnter={onPreloadEpisodeProduction}
          onFocus={onPreloadEpisodeProduction}
          onPointerDown={onPreloadEpisodeProduction}
          data-studio-ai-episode-production-launcher="true"
          className={cn(
            "flex min-h-16 shrink-0 items-center justify-between gap-3 rounded-xl border border-accent/45 bg-accent/10 px-3 py-2.5 text-left hover:bg-accent/15",
            STUDIO_EASE,
            STUDIO_FOCUS_RING
          )}
        >
          <span className="flex min-w-0 items-start gap-2">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent">
              <Clapperboard size={15} aria-hidden />
            </span>
            <span className="min-w-0">
              <strong className="block text-xs font-black text-fg">회차 AI 프로덕션</strong>
              <span className="mt-0.5 block text-[0.61rem] leading-relaxed text-fg-3">
                대본 → 연속성 잠금 → 생성 묶음 → 품질 QA
              </span>
            </span>
          </span>
          <ChevronRight size={15} className="shrink-0 text-accent" aria-hidden />
        </button>
      ) : null}

      <StudioAiProductionLaunchpad
        imageConfigured={imageConfigured}
        textConfigured={textConfigured}
        onOpenScenario={onOpenScenario}
        onOpenSuperSuite={onOpenSuperSuite}
        onPreloadSuperSuite={onPreloadSuperSuite}
        scenarioDisabled={scenarioDisabled}
        scenarioDisabledReason={scenarioDisabledReason}
      />

      {providerSlot ? <div className="shrink-0">{providerSlot}</div> : null}

      {/* Tool tabs — sticky within hub scroll is not needed; kept fixed above body */}
      <div
        className="flex shrink-0 gap-1 overflow-x-auto pb-0.5 [scrollbar-width:thin]"
        role="tablist"
        aria-label="AI 어시스트 도구"
        aria-orientation="horizontal"
      >
        {STUDIO_AI_ASSIST_TOOLS.map((tool) => {
          const Icon = TOOL_ICONS[tool.id];
          const active = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              role="tab"
              id={toolTabId(tool.id)}
              aria-controls={toolPanelId(tool.id)}
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={tool.title}
              onClick={() => onToolChange(tool.id)}
              onKeyDown={(event) => handleToolTabKeyDown(event, tool.id)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-[0.64rem] font-bold",
                STUDIO_EASE,
                STUDIO_FOCUS_RING,
                active
                  ? "border-accent bg-accent text-on-accent shadow-sm"
                  : "border-line bg-card text-fg-3 hover:bg-raised hover:text-fg"
              )}
            >
              <Icon size={12} aria-hidden />
              {tool.shortLabel}
            </button>
          );
        })}
      </div>

      <p className="shrink-0 text-[0.62rem] leading-snug text-fg-3">
        <span className="font-semibold text-fg-2">{toolMeta.label}</span>
        {" · "}
        {toolMeta.title}
        <span className="mt-0.5 block text-fg-3/90">예시 칩을 누르거나 직접 입력 · ⌘/Ctrl+Enter</span>
      </p>

      {/* Local-only disclosure: this describes execution but never calls a model. */}
      <details
        className={cn(
          "group shrink-0 overflow-hidden rounded-xl border",
          executionPreflight.available
            ? "border-line bg-card/75"
            : "border-warn/40 bg-warn/10"
        )}
        data-studio-ai-execution-preflight="true"
        data-execution-ready={executionPreflight.available ? "true" : "false"}
      >
        <summary
          className={cn(
            "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-left",
            "[&::-webkit-details-marker]:hidden",
            STUDIO_FOCUS_RING
          )}
          aria-controls={preflightDetailsId}
        >
          {executionPreflight.available ? (
            <ShieldCheck size={15} className="shrink-0 text-good" aria-hidden />
          ) : (
            <TriangleAlert size={15} className="shrink-0 text-warn" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[0.68rem] font-bold text-fg">실행 전 확인</span>
            <span className="block truncate text-[0.58rem] text-fg-3">
              {executionPreflight.processingRoute}
            </span>
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-0.5 text-[0.56rem] font-bold",
              executionPreflight.available
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-warn/35 bg-warn/10 text-warn"
            )}
          >
            {executionPreflight.available
              ? executionPreflight.costCategory
              : "실행 불가"}
          </span>
          <ChevronDown
            size={14}
            className="shrink-0 text-fg-3 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
        </summary>

        {!executionPreflight.available && executionPreflight.unavailableReason ? (
          <p
            className="mx-3 mb-2 rounded-lg border border-warn/25 bg-warn/10 px-2.5 py-2 text-[0.61rem] leading-relaxed text-fg-2"
            role="alert"
          >
            {executionPreflight.unavailableReason}
          </p>
        ) : null}

        <dl
          id={preflightDetailsId}
          className="grid max-h-56 grid-cols-[5.25rem_minmax(0,1fr)] gap-x-2 gap-y-1.5 overflow-y-auto border-t border-line/70 px-3 py-2.5 text-[0.59rem] leading-relaxed"
          data-studio-ai-execution-preflight-details="true"
        >
          <dt className="font-semibold text-fg-3">처리 경로</dt>
          <dd className="min-w-0 text-fg-2">{executionPreflight.processingRoute}</dd>

          <dt className="font-semibold text-fg-3">외부 전송</dt>
          <dd className="min-w-0 text-fg-2">
            {executionPreflight.externalTransfer ? "있음 · " : "없음 · "}
            {executionPreflight.externalTransferLabel}
          </dd>

          <dt className="font-semibold text-fg-3">비용 범주</dt>
          <dd className="min-w-0 font-semibold text-fg-2">
            {executionPreflight.costCategory}
          </dd>

          <dt className="font-semibold text-fg-3">예상 시간</dt>
          <dd className="min-w-0 text-fg-2">
            {executionPreflight.estimatedTimeCategory}
            {" · "}
            {executionPreflight.estimatedTimeLabel}
          </dd>

          <dt className="font-semibold text-fg-3">출력 수</dt>
          <dd className="min-w-0 text-fg-2">{executionPreflight.outputCountLabel}</dd>

          <dt className="font-semibold text-fg-3">실패 정책</dt>
          <dd className="min-w-0 text-fg-2">
            {executionPreflight.fallbackRetryPolicy}
          </dd>

          <dt className="flex items-start gap-1 font-semibold text-fg-3">
            <ShieldCheck size={11} className="mt-0.5 shrink-0 text-good" aria-hidden />
            원본 보호
          </dt>
          <dd className="min-w-0 text-fg-2">
            {executionPreflight.sourceNonDestructivePolicy}
          </dd>
        </dl>
      </details>

      {/* Scrollable body: presets + recent + active tool form */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pr-0.5">
        {presets.length > 0 ? (
          <div className="shrink-0">
            <p className="mb-1 text-[0.62rem] font-semibold text-fg-2">빠른 예시</p>
            <div className="flex flex-wrap gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.prompt}
                  onClick={() => applyPromptAndRevealToolPanel(preset.prompt)}
                  className={cn(
                    "min-h-11 rounded-full border border-line bg-card px-2.5 py-1 text-[0.62rem] font-semibold text-fg-2",
                    STUDIO_EASE,
                    STUDIO_FOCUS_RING,
                    "hover:border-accent/45 hover:bg-raised hover:text-fg"
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {recents.length > 0 ? (
          <div className="shrink-0">
            <p className="mb-1 text-[0.62rem] font-semibold text-fg-2">최근 프롬프트</p>
            <div className="flex flex-col gap-0.5">
              {recents.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  title={prompt}
                  onClick={() => applyPromptAndRevealToolPanel(prompt)}
                  className={cn(
                    "min-h-11 truncate rounded-lg border border-line/70 bg-canvas/40 px-2 py-1.5 text-left text-[0.6rem] text-fg-3",
                    STUDIO_FOCUS_RING,
                    "hover:border-accent/40 hover:bg-raised hover:text-fg-2"
                  )}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {/* Active tool panel — primary interactive surface */}
        <div
          ref={toolPanelRef}
          className="min-h-[8rem] shrink-0 pb-1"
          role="tabpanel"
          id={toolPanelId(activeTool)}
          aria-labelledby={toolTabId(activeTool)}
          tabIndex={0}
          data-studio-ai-assist-tool-panel="true"
        >
          {toolPanel}
        </div>
      </div>
    </div>
  );
}
