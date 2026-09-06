import {
  Clapperboard,
  Images,
  Settings2,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { Suspense } from "react";

import { StudioMenuPopoverHeader, StudioMenuSubtabs } from "../studio-chrome-ui";
import {
  StudioAiAssistHub,
  StudioAiBackgroundPanel,
  StudioAiCharacterConsistencyPanel,
  StudioAiCompositionPanel,
  StudioDialogueSuggestPanel,
  StudioIntegrationsSettingsPanel,
  StudioPaletteSuggestPanel,
  StudioStockImagePanel,
  preloadStudioIntegrationsSettingsPanel,
  preloadStudioStockImagePanel,
} from "../studio-page-lazy-ui";
import { StudioPanelLoading } from "../StudioLazySurfaceFallback";

import { pushStudioAiRecentPrompt } from "./studio-ai-assist-ux";
import { isStudioAiConfigured } from "./studio-ai-client";
import { requestStudioAiEpisodeProductionOpen } from "./studio-ai-episode-production-intent";
import { preloadStudioAiEpisodeProductionModal } from "./studio-ai-episode-production-loader";
import { requestStudioAiSuperSuiteOpen } from "./studio-ai-super-suite-intent";
import { preloadStudioAiSuperSuiteModal } from "./studio-ai-super-suite-loader";
import { StudioAiEpisodeProductionGateway } from "./StudioAiEpisodeProductionGateway";
import { StudioAiSuperSuiteGateway } from "./StudioAiSuperSuiteGateway";

import type { StudioMenu } from "../studio-editor-tool-model";
import type { StudioServerAiProviderPreference } from "../studio-server-ai-client";
import type { StudioToolBeltContentProps } from "../StudioToolBeltContent";

import { useT } from "@/shared/lib/i18n";



export interface StudioAiToolPopoverBodyProps {
  readonly toolBelt: StudioToolBeltContentProps;
}

export function StudioAiToolPopoverBody({
  toolBelt,
}: StudioAiToolPopoverBodyProps) {
  const t = useT();
  const lt = (fallback: string, key: string) => {
    const translated = t(key);
    return translated === key ? fallback : translated;
  };

  const {
    activePage,
    activeServerAiProviderLabel,
    aiAssistTool,
    aiBgBusy,
    aiBgError,
    aiBgPrompt,
    aiBgSize,
    aiCharacterBusy,
    aiCharacterError,
    aiCharacterPrompt,
    aiCompositionDraft,
    aiDialogueSuggestBusy,
    aiDialogueSuggestCandidates,
    aiDialogueSuggestError,
    aiDialogueSuggestIncludeContext,
    aiDialogueSuggestSituation,
    aiPaletteSuggestBusy,
    aiPaletteSuggestError,
    aiPaletteSuggestion,
    aiPaletteSuggestMood,
    aiPaletteSuggestSavedMsg,
    aiRecentPrompts,
    aiSettings,
    configuredServerAiProviders,
    masterEditMode,
    menu,
    selected,
    serverAiProvider,
    serverAiStatus,
    setAiAssistTool,
    setAiBgPrompt,
    setAiBgSize,
    setAiCharacterPrompt,
    setAiCompositionDraft,
    setAiDialogueSuggestIncludeContext,
    setAiDialogueSuggestSituation,
    setAiPaletteSuggestMood,
    setAiRecentPrompts,
    setMenu,
    setScenarioOpen,
    setTool,
    textAiConfigured,
    textAiTransport,
  } = toolBelt;
  const {
    addDialogueSuggestionToScript,
    announceDrawingShortcut,
    applyAiAssistPresetPrompt,
    beginTrackedStudioAiOperation,
    disarmAllPixelTools,
    executeSuggestColorPalette,
    executeSuggestDialogueLines,
    insertAiCompositionNote,
    insertDialogueSuggestionToSelected,
    insertStockImage,
    onGenerateAiBackground,
    onGenerateAiCharacter,
    pendingTextAiProviderContext,
    saveSuggestedPaletteToLibrary,
    settleTrackedTextAiOperation,
    updateAiSettings,
    updateServerAiProvider,
  } = toolBelt.stableHandlers;

  const applyEpisodeBatchPrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setAiAssistTool("composition");
    setAiCompositionDraft(trimmed);
    setAiRecentPrompts(
      pushStudioAiRecentPrompt(globalThis.sessionStorage, "composition", trimmed)
    );
    setMenu("aiAssist");
    announceDrawingShortcut(
      "회차 프로덕션의 첫 배치 프롬프트를 구도 제안 도구에 적용했어요."
    );
  };

  const applySuperSuitePrompt = (prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    const target = aiAssistTool === "character" ? "character" : "background";
    if (target === "character") setAiCharacterPrompt(trimmed);
    else setAiBgPrompt(trimmed);
    setAiAssistTool(target);
    setAiRecentPrompts(
      pushStudioAiRecentPrompt(globalThis.sessionStorage, target, trimmed)
    );
    setMenu("aiAssist");
    announceDrawingShortcut(
      target === "character"
        ? "슈퍼 스위트 프롬프트를 캐릭터 생성 도구에 적용했어요."
        : "슈퍼 스위트 프롬프트를 배경 생성 도구에 적용했어요."
    );
  };

  return (
    <>
      <StudioMenuPopoverHeader
        icon={WandSparkles}
        title={lt("AI 연동", "studio.aiToolPopover.title")}
        description={lt(
          "회차 제작·초안·스톡·시나리오를 연결하고, 키 설정은 연동 탭에서 관리합니다.",
          "studio.aiToolPopover.description"
        )}
        className="shrink-0"
      />
      <StudioMenuSubtabs
        aria-label={lt("AI 메뉴 구역", "studio.aiToolPopover.menuAria")}
        className="shrink-0"
        activeId={
          menu === "aiAssist" || menu === "stockImage" || menu === "integrations"
            ? menu
            : "aiAssist"
        }
        onSelect={(id) => {
          if (id === "scenario") {
            if (masterEditMode) return;
            setScenarioOpen(true);
            setMenu(null);
            return;
          }
          if (id === "stockImage") preloadStudioStockImagePanel();
          if (id === "integrations") preloadStudioIntegrationsSettingsPanel();
          setMenu(id as StudioMenu);
        }}
        items={[
          {
            id: "aiAssist",
            label: lt("어시스트", "studio.aiToolPopover.tabAssist"),
            icon: Sparkles,
            title: lt("회차 제작·배경·캐릭터·구도 제안", "studio.aiToolPopover.tabAssistTitle"),
          },
          {
            id: "scenario",
            label: lt("시나리오", "studio.aiToolPopover.tabScenario"),
            icon: Clapperboard,
            disabled: masterEditMode,
            title: masterEditMode
              ? lt("마스터 편집 중에는 사용할 수 없어요", "studio.aiToolPopover.tabScenarioDisabled")
              : lt("시나리오 설계", "studio.aiToolPopover.tabScenarioTitle"),
          },
          {
            id: "stockImage",
            label: lt("스톡", "studio.aiToolPopover.tabStock"),
            icon: Images,
            title: lt("Unsplash 무료 사진", "studio.aiToolPopover.tabStockTitle"),
          },
          {
            id: "integrations",
            label: lt("설정", "studio.aiToolPopover.tabIntegrations"),
            icon: Settings2,
            title: lt("API 키·연동 설정", "studio.aiToolPopover.tabIntegrationsTitle"),
          },
        ]}
      />
      {menu === "aiAssist" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <Suspense
            fallback={
              <StudioPanelLoading label={lt("AI 어시스트 패널을 여는 중...", "studio.aiToolPopover.panelLoadingAssist")} />
            }
          >
            <StudioAiAssistHub
              className="min-h-0 flex-1"
              activeTool={aiAssistTool}
              onToolChange={setAiAssistTool}
              imageConfigured={isStudioAiConfigured(aiSettings)}
              textConfigured={textAiConfigured}
              connectionOk={textAiConfigured || isStudioAiConfigured(aiSettings)}
              connectionLabel={
                textAiConfigured
                  ? textAiTransport.mode === "server"
                    ? lt(
                        `${activeServerAiProviderLabel} 연결됨`,
                        "studio.aiToolPopover.serverProviderConnected"
                      ).replace("{provider}", activeServerAiProviderLabel)
                    : lt("내 API 연결됨", "studio.aiToolPopover.internalProviderConnected")
                  : isStudioAiConfigured(aiSettings)
                    ? lt("이미지 API 연결됨", "studio.aiToolPopover.imageApiConnected")
                    : serverAiStatus?.configured
                      ? lt("로그인 또는 API 키 필요", "studio.aiToolPopover.serverLoginHint")
                      : lt("API 키 등록 필요", "studio.aiToolPopover.apiKeyNeed")
              }
              onOpenSettings={() => {
                preloadStudioIntegrationsSettingsPanel();
                setMenu("integrations");
              }}
              onPreloadSettings={preloadStudioIntegrationsSettingsPanel}
              onOpenEpisodeProduction={() => requestStudioAiEpisodeProductionOpen()}
              onPreloadEpisodeProduction={preloadStudioAiEpisodeProductionModal}
              onPreloadSuperSuite={preloadStudioAiSuperSuiteModal}
              recentState={aiRecentPrompts}
              onApplyPresetPrompt={applyAiAssistPresetPrompt}
              onOpenScenario={() => {
                if (masterEditMode) return;
                setScenarioOpen(true);
                setMenu(null);
              }}
              scenarioDisabled={masterEditMode}
              scenarioDisabledReason="마스터 편집 중에는 시나리오 제작을 사용할 수 없어요."
              onOpenSuperSuite={() => {
                requestStudioAiSuperSuiteOpen();
              }}
              providerSlot={
                textAiTransport.mode === "server" && configuredServerAiProviders.length > 0 ? (
                  <div className="rounded-xl border border-line bg-card/35 p-2.5">
                    <label className="flex items-center justify-between gap-2 text-xs font-semibold text-fg-2">
                      <span>{lt("텍스트 AI 제공자", "studio.aiToolPopover.textAiProvider")}</span>
                      <select
                        value={serverAiProvider}
                        onChange={(event) =>
                          updateServerAiProvider(event.target.value as StudioServerAiProviderPreference)
                        }
                        className="min-h-11 min-w-0 rounded-lg border border-line bg-panel px-2 text-xs text-fg outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                        aria-label={lt("서버 텍스트 AI 제공자", "studio.aiToolPopover.serverTextAiProviderAria")}
                      >
                        <option value="auto">{lt("자동 전환", "studio.aiToolPopover.serverProviderAuto")}</option>
                        {(serverAiStatus?.providers.length
                          ? serverAiStatus.providers
                          : [
                              { id: "zai" as const, label: "Z.ai", configured: false, model: "" },
                              { id: "deepseek" as const, label: "DeepSeek", configured: false, model: "" },
                              { id: "openrouter" as const, label: "OpenRouter", configured: false, model: "" },
                            ]
                        ).map((provider) => (
                          <option key={provider.id} value={provider.id} disabled={!provider.configured}>
                            {provider.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="mt-1.5 text-[0.65rem] leading-relaxed text-fg-3">
                      {lt(
                        "잔액·패키지 한도 소진 시 다른 제공자로 전환합니다. 일반 오류는 이중 과금을 막기 위해 자동 재전송하지 않아요.",
                        "studio.aiToolPopover.serverFallbackMessage"
                      )}
                    </p>
                  </div>
                ) : null
              }
              toolPanel={
                <>
                  {aiAssistTool === "background" ? (
                    <StudioAiBackgroundPanel
                      configured={isStudioAiConfigured(aiSettings)}
                      prompt={aiBgPrompt}
                      onPromptChange={setAiBgPrompt}
                      size={aiBgSize}
                      onSizeChange={setAiBgSize}
                      busy={aiBgBusy}
                      error={aiBgError}
                      onGenerate={onGenerateAiBackground}
                    />
                  ) : null}
                  {aiAssistTool === "character" ? (
                    <StudioAiCharacterConsistencyPanel
                      configured={isStudioAiConfigured(aiSettings)}
                      hasReference={selected?.type === "image"}
                      referenceThumbnail={selected?.type === "image" ? selected.src : null}
                      prompt={aiCharacterPrompt}
                      onPromptChange={setAiCharacterPrompt}
                      busy={aiCharacterBusy}
                      error={aiCharacterError}
                      onRequestSelectReference={() => {
                        disarmAllPixelTools();
                        setTool("select");
                        announceDrawingShortcut(
                          "기준 캐릭터 이미지를 선택하세요 · Esc로 취소",
                        );
                      }}
                      onGenerate={() => {
                        const prompt = aiCharacterPrompt.trim();
                        if (prompt) {
                          setAiRecentPrompts(
                            pushStudioAiRecentPrompt(globalThis.sessionStorage, "character", prompt)
                          );
                        }
                        onGenerateAiCharacter();
                      }}
                    />
                  ) : null}
                  {aiAssistTool === "composition" ? (
                    <StudioAiCompositionPanel
                      settings={aiSettings}
                      transport={textAiTransport}
                      configured={textAiConfigured}
                      sceneText={aiCompositionDraft}
                      onSceneTextChange={setAiCompositionDraft}
                      onInsertAsNote={insertAiCompositionNote}
                      onOperationStart={(prompt) => {
                        setAiRecentPrompts(
                          pushStudioAiRecentPrompt(globalThis.sessionStorage, "composition", prompt)
                        );
                        const provider = pendingTextAiProviderContext();
                        return beginTrackedStudioAiOperation("composition", {
                          kind: "text",
                          task: "composition",
                          provider: provider.provider,
                          model: provider.model,
                          transport: provider.transport,
                          promptVersion: 1,
                          prompt,
                          target: { pageId: activePage.id },
                          references: [],
                        });
                      }}
                      onOperationSettled={({ operationId, result, textProvenance }) => {
                        settleTrackedTextAiOperation(operationId, result, textProvenance);
                      }}
                    />
                  ) : null}
                  {aiAssistTool === "dialogue" ? (
                    <StudioDialogueSuggestPanel
                      configured={textAiConfigured}
                      situationText={aiDialogueSuggestSituation}
                      onSituationTextChange={setAiDialogueSuggestSituation}
                      hasContext={activePage.elements.some(
                        (el) => (el.type === "bubble" || el.type === "text") && el.text.trim().length > 0
                      )}
                      includeContext={aiDialogueSuggestIncludeContext}
                      onIncludeContextChange={setAiDialogueSuggestIncludeContext}
                      busy={aiDialogueSuggestBusy}
                      error={aiDialogueSuggestError}
                      candidates={aiDialogueSuggestCandidates}
                      onGenerate={() => {
                        const prompt = aiDialogueSuggestSituation.trim();
                        if (prompt) {
                          setAiRecentPrompts(
                            pushStudioAiRecentPrompt(globalThis.sessionStorage, "dialogue", prompt)
                          );
                        }
                        void executeSuggestDialogueLines();
                      }}
                      canInsertToSelected={
                        !!selected && (selected.type === "bubble" || selected.type === "text")
                      }
                      onAddToScript={addDialogueSuggestionToScript}
                      onInsertToSelected={insertDialogueSuggestionToSelected}
                    />
                  ) : null}
                  {aiAssistTool === "palette" ? (
                    <StudioPaletteSuggestPanel
                      configured={textAiConfigured}
                      moodText={aiPaletteSuggestMood}
                      onMoodTextChange={setAiPaletteSuggestMood}
                      busy={aiPaletteSuggestBusy}
                      error={aiPaletteSuggestError}
                      suggestion={aiPaletteSuggestion}
                      savedMessage={aiPaletteSuggestSavedMsg}
                      onGenerate={() => {
                        const prompt = aiPaletteSuggestMood.trim();
                        if (prompt) {
                          setAiRecentPrompts(
                            pushStudioAiRecentPrompt(globalThis.sessionStorage, "palette", prompt)
                          );
                        }
                        void executeSuggestColorPalette();
                      }}
                      onSaveToLibrary={saveSuggestedPaletteToLibrary}
                    />
                  ) : null}
                </>
              }
            />
          </Suspense>
        </div>
      )}
      {menu === "stockImage" && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Suspense
            fallback={
              <StudioPanelLoading label={lt("스톡 사진 패널을 여는 중...", "studio.aiToolPopover.panelLoadingStock")} />
            }
          >
            <StudioStockImagePanel
              onInsert={insertStockImage}
              onOpenSettings={() => {
                preloadStudioIntegrationsSettingsPanel();
                setMenu("integrations");
              }}
            />
          </Suspense>
        </div>
      )}
      {menu === "integrations" && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Suspense
            fallback={
              <StudioPanelLoading
                label={lt("연동 설정 패널을 여는 중...", "studio.aiToolPopover.panelLoadingIntegrations")}
              />
            }
          >
            <StudioIntegrationsSettingsPanel aiSettings={aiSettings} onAiSettingsChange={updateAiSettings} />
          </Suspense>
        </div>
      )}

      <StudioAiEpisodeProductionGateway onApplyPrompt={applyEpisodeBatchPrompt} />

      <StudioAiSuperSuiteGateway onApplyPrompt={applySuperSuitePrompt} />
    </>
  );
}
