import {
  buildStudioCharacterBiblePromptContext,
  type StudioCharacterBible,
} from "../studio-character-bible";
import { scenarioAspectToImageSize } from "../studio-page-editor-runtime-contracts";

import {
  generateBackgroundImage,
  generateConsistentCharacterImage,
  generateImageWithRoleReferences,
  isStudioAiConfigured,
  STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS,
  type StudioAiResolvedImageReference,
  type StudioAiResult,
  type StudioAiSettings,
  type StudioTextAiProvenance,
} from "./studio-ai-client";
import { captureStudioAiGeneratedAssetProvenance } from "./studio-ai-generated-asset-model";
import {
  parseStudioAiRequestedSize,
  studioImageAiProviderContext,
  type SettleStudioAiOperationOptions,
  type StudioAiObservableResult,
  type StudioAiPendingOperationInput,
} from "./studio-ai-provenance-recorder";

import type { StudioAiImageReferenceResolution } from "./studio-ai-image-reference-resolution";
import type { StudioAiImageReferenceDocument } from "./studio-ai-image-reference-roles";
import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { ScenarioPreviewItem } from "../studio-scenario-layout";
import type { Dispatch, SetStateAction } from "react";

/** StudioPage's scenario preview state — the reviewed scenes the image executors fill in. */
export interface StudioScenarioImageGenerationSnapshot {
  items: ScenarioPreviewItem[];
  nextCanvasH: number;
  characterDescription: string;
  textAiProvenance: StudioTextAiProvenance;
}

/**
 * Everything the scenario image executors read from the editor. Values are captured per render
 * (the factory is invoked in the component body), refs stay refs — reads inside the async loops
 * intentionally observe the same objects StudioPage mutates.
 */
export interface StudioScenarioImageGenerationContext {
  readonly collaborationAccessRef: { readonly current: { readonly locked: boolean } };
  readonly scenarioAbortControllerRef: { readonly current: AbortController | null };
  readonly scenarioCancelRef: { current: boolean };
  readonly scenarioResult: StudioScenarioImageGenerationSnapshot | null;
  readonly scenarioBusy: boolean;
  readonly scenarioRegeneratingIndex: number | null;
  readonly aiSettings: StudioAiSettings;
  readonly scenarioImageReferenceDocument: StudioAiImageReferenceDocument;
  readonly scenarioImageReferenceResolution: StudioAiImageReferenceResolution;
  readonly assetsLoaded: boolean;
  readonly assetsLoading: boolean;
  readonly characterBible: StudioCharacterBible;
  readonly activePage: { readonly id: string };
  readonly captureStudioMutationTicket: () => StudioEditorMutationTicket;
  readonly canApplyStudioMutation: (ticket: StudioEditorMutationTicket) => boolean;
  readonly beginScenarioRequest: () => AbortController;
  readonly finishScenarioRequest: (controller: AbortController) => void;
  readonly beginTrackedStudioAiOperation: (
    scope: string,
    input: Omit<StudioAiPendingOperationInput, "id">
  ) => string;
  readonly settleTrackedStudioAiOperation: (
    operationId: string,
    result: StudioAiObservableResult,
    options?: SettleStudioAiOperationOptions
  ) => void;
  readonly setScenarioBusy: (busy: boolean) => void;
  readonly setScenarioError: (error: string | null) => void;
  readonly setScenarioStageLabel: (label: string | null) => void;
  readonly setScenarioProgress: (
    progress: { done: number; total: number } | null
  ) => void;
  readonly setScenarioResult: Dispatch<
    SetStateAction<StudioScenarioImageGenerationSnapshot | null>
  >;
  readonly setScenarioRegeneratingIndex: (index: number | null) => void;
}

export interface StudioScenarioImageGenerationExecutors {
  readonly executeGenerateScenarioImages: () => Promise<void>;
  readonly executeRegenerateScenarioImage: (index: number) => Promise<void>;
}

/**
 * Scenario image generation executors extracted from StudioPage. Behavior-identical move:
 * the bodies below are verbatim, with dependencies received through {@link ctx} instead of
 * component closure. Mutation tickets are still captured before the first await and
 * revalidated before every state application.
 */
export function createStudioScenarioImageGenerationExecutors(
  ctx: StudioScenarioImageGenerationContext,
): StudioScenarioImageGenerationExecutors {
  const {
    collaborationAccessRef,
    scenarioAbortControllerRef,
    scenarioCancelRef,
    scenarioResult,
    scenarioBusy,
    scenarioRegeneratingIndex,
    aiSettings,
    scenarioImageReferenceDocument,
    scenarioImageReferenceResolution,
    assetsLoaded,
    assetsLoading,
    characterBible,
    activePage,
    captureStudioMutationTicket,
    canApplyStudioMutation,
    beginScenarioRequest,
    finishScenarioRequest,
    beginTrackedStudioAiOperation,
    settleTrackedStudioAiOperation,
    setScenarioBusy,
    setScenarioError,
    setScenarioStageLabel,
    setScenarioProgress,
    setScenarioResult,
    setScenarioRegeneratingIndex,
  } = ctx;

  function scenarioRoleReferencesForRequest(
    previewCharacterDataUrl: string | null
  ): readonly StudioAiResolvedImageReference[] {
    if (scenarioImageReferenceResolution.references.length === 0) return [];
    if (
      scenarioImageReferenceResolution.hasCharacterReference
      || !previewCharacterDataUrl
    ) {
      return scenarioImageReferenceResolution.references;
    }
    return [
      {
        referenceId: "scenario-preview-character-reference",
        role: "character",
        dataUrl: previewCharacterDataUrl,
        label: "앞 장면 캐릭터 연속성",
        guidance: "앞 장면의 인물 정체성만 유지합니다.",
      },
      ...scenarioImageReferenceResolution.references,
    ];
  }

  async function executeGenerateScenarioImages() {
    if (collaborationAccessRef.current.locked) return;
    if (scenarioAbortControllerRef.current) return;
    const mutationTicket = captureStudioMutationTicket();
    const snapshot = scenarioResult;
    if (!snapshot || scenarioBusy || scenarioRegeneratingIndex !== null || !isStudioAiConfigured(aiSettings)) return;
    if (
      scenarioImageReferenceDocument.references.length > 0
      && (!assetsLoaded || assetsLoading)
    ) {
      setScenarioError("AI 참조 에셋을 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.");
      return;
    }
    if (
      scenarioImageReferenceDocument.references.length
      > STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxImages
    ) {
      setScenarioError(
        `AI 이미지 참조는 최대 ${STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxImages}개까지 사용할 수 있어요. 참조 팩에서 일부를 제거해 주세요.`
      );
      return;
    }
    if (scenarioImageReferenceResolution.missing.length > 0) {
      setScenarioError(
        `연결된 AI 참조 에셋 ${scenarioImageReferenceResolution.missing.length}개를 찾을 수 없어요. 참조 팩에서 제거하거나 에셋을 다시 추가해 주세요.`
      );
      return;
    }
    const targetIndexes = snapshot.items.flatMap((item, index) => (item.imageDataUrl ? [] : [index]));
    if (targetIndexes.length === 0) return;

    scenarioCancelRef.current = false;
    const controller = beginScenarioRequest();
    setScenarioBusy(true);
    setScenarioError(null);
    setScenarioStageLabel("검토한 장면 이미지 생성 중…");
    setScenarioProgress({ done: 0, total: targetIndexes.length });
    let referenceImageDataUrl = snapshot.items.find((item) => item.imageDataUrl)?.imageDataUrl ?? null;
    const characterContext = buildStudioCharacterBiblePromptContext(characterBible, 4_000);

    try {
      for (let taskIndex = 0; taskIndex < targetIndexes.length; taskIndex++) {
        if (scenarioCancelRef.current || controller.signal.aborted) break;
        const index = targetIndexes[taskIndex];
        const panel = snapshot.items[index];
        let imageResult: StudioAiResult<{ dataUrl: string }>;
        const reviewedImagePrompt = [
          characterContext ? `[캐릭터 바이블 — [고정] 설정 유지]\n${characterContext}` : "",
          panel.imagePrompt,
        ]
          .filter((value) => value.trim().length > 0)
          .join("\n\n");
        const provider = studioImageAiProviderContext(aiSettings);
        const requestProvenance = captureStudioAiGeneratedAssetProvenance(provider, "generated");
        const roleReferences = scenarioRoleReferencesForRequest(referenceImageDataUrl);
        const usesRoleReferences = roleReferences.length > 0;
        const usesPreviewReference = Boolean(referenceImageDataUrl);
        const hasCharacterAnchor =
          scenarioImageReferenceResolution.hasCharacterReference || usesPreviewReference;
        const usesReference = usesRoleReferences || usesPreviewReference;
        const requestPrompt = hasCharacterAnchor
          ? reviewedImagePrompt
          : [snapshot.characterDescription, reviewedImagePrompt]
              .filter((value) => value.trim().length > 0)
              .join(", ");
        const trackedReferenceAssetIds = [
          ...scenarioImageReferenceResolution.trackingAssetIds,
          ...(!scenarioImageReferenceResolution.hasCharacterReference && usesPreviewReference
            ? ["scenario-preview-character-reference"]
            : []),
        ];
        const operationId = beginTrackedStudioAiOperation("scenario-image", {
          kind: "image",
          task: usesReference
            ? hasCharacterAnchor
              ? "character-image"
              : "image-edit"
            : "background-image",
          provider: provider.provider,
          model: provider.model,
          transport: provider.transport,
          promptVersion: 1,
          prompt: requestPrompt,
          target: { pageId: activePage.id },
          ...(usesReference
            ? {
                references: trackedReferenceAssetIds.map((assetId) => ({ assetId })),
              }
            : {
                requestedSize: parseStudioAiRequestedSize(scenarioAspectToImageSize(panel.aspect)),
                references: [],
              }),
        });
        if (usesRoleReferences) {
          imageResult = await generateImageWithRoleReferences(
            aiSettings,
            roleReferences,
            requestPrompt,
            { signal: controller.signal }
          );
        } else if (referenceImageDataUrl) {
          imageResult = await generateConsistentCharacterImage(
            aiSettings,
            referenceImageDataUrl,
            reviewedImagePrompt,
            { signal: controller.signal }
          );
        } else {
          imageResult = await generateBackgroundImage(
            aiSettings,
            requestPrompt,
            { size: scenarioAspectToImageSize(panel.aspect), signal: controller.signal }
          );
        }
        if (!canApplyStudioMutation(mutationTicket)) break;
        settleTrackedStudioAiOperation(operationId, imageResult, {
          aborted: !imageResult.ok && controller.signal.aborted,
          target: { pageId: activePage.id },
        });
        if (controller.signal.aborted) break;

        if (imageResult.ok) {
          const dataUrl = imageResult.data.dataUrl;
          referenceImageDataUrl ??= dataUrl;
          setScenarioResult((previous) =>
            previous
              ? {
                  ...previous,
                  items: previous.items.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, imageDataUrl: dataUrl, imageError: undefined, imageProvenance: requestProvenance }
                      : item
                  ),
                }
              : previous
          );
        } else {
          setScenarioResult((previous) =>
            previous
              ? {
                  ...previous,
                  items: previous.items.map((item, itemIndex) =>
                    itemIndex === index
                      ? { ...item, imageDataUrl: undefined, imageError: imageResult.error, imageProvenance: undefined }
                      : item
                  ),
                }
              : previous
          );
        }
        setScenarioProgress({ done: taskIndex + 1, total: targetIndexes.length });
      }
    } finally {
      setScenarioBusy(false);
      setScenarioStageLabel(null);
      finishScenarioRequest(controller);
    }
  }

  async function executeRegenerateScenarioImage(index: number) {
    if (collaborationAccessRef.current.locked) return;
    if (scenarioAbortControllerRef.current) return;
    const mutationTicket = captureStudioMutationTicket();
    const snapshot = scenarioResult;
    const panel = snapshot?.items[index];
    if (!snapshot || !panel || scenarioBusy || scenarioRegeneratingIndex !== null || !isStudioAiConfigured(aiSettings)) {
      return;
    }
    if (
      scenarioImageReferenceDocument.references.length > 0
      && (!assetsLoaded || assetsLoading)
    ) {
      setScenarioError("AI 참조 에셋을 불러오는 중이에요. 잠시 뒤 다시 시도해 주세요.");
      return;
    }
    if (
      scenarioImageReferenceDocument.references.length
      > STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxImages
    ) {
      setScenarioError(
        `AI 이미지 참조는 최대 ${STUDIO_AI_ROLE_REFERENCE_REQUEST_LIMITS.maxImages}개까지 사용할 수 있어요. 참조 팩에서 일부를 제거해 주세요.`
      );
      return;
    }
    if (scenarioImageReferenceResolution.missing.length > 0) {
      setScenarioError(
        `연결된 AI 참조 에셋 ${scenarioImageReferenceResolution.missing.length}개를 찾을 수 없어요. 참조 팩에서 제거하거나 에셋을 다시 추가해 주세요.`
      );
      return;
    }
    const controller = beginScenarioRequest();
    setScenarioRegeneratingIndex(index);
    setScenarioError(null);
    setScenarioResult((previous) =>
      previous
        ? {
            ...previous,
            items: previous.items.map((item, itemIndex) =>
              itemIndex === index ? { ...item, imageError: undefined } : item
            ),
          }
        : previous
    );
    const referenceImageDataUrl =
      snapshot.items.find((item, itemIndex) => itemIndex !== index && item.imageDataUrl)?.imageDataUrl ?? null;
    const characterContext = buildStudioCharacterBiblePromptContext(characterBible, 4_000);
    const reviewedImagePrompt = [
      characterContext ? `[캐릭터 바이블 — [고정] 설정 유지]\n${characterContext}` : "",
      panel.imagePrompt,
    ]
      .filter((value) => value.trim().length > 0)
      .join("\n\n");
    const provider = studioImageAiProviderContext(aiSettings);
    const requestProvenance = captureStudioAiGeneratedAssetProvenance(provider, "generated");
    const roleReferences = scenarioRoleReferencesForRequest(referenceImageDataUrl);
    const usesRoleReferences = roleReferences.length > 0;
    const usesPreviewReference = Boolean(referenceImageDataUrl);
    const hasCharacterAnchor =
      scenarioImageReferenceResolution.hasCharacterReference || usesPreviewReference;
    const usesReference = usesRoleReferences || usesPreviewReference;
    const requestPrompt = hasCharacterAnchor
      ? reviewedImagePrompt
      : [snapshot.characterDescription, reviewedImagePrompt]
          .filter((value) => value.trim().length > 0)
          .join(", ");
    const trackedReferenceAssetIds = [
      ...scenarioImageReferenceResolution.trackingAssetIds,
      ...(!scenarioImageReferenceResolution.hasCharacterReference && usesPreviewReference
        ? ["scenario-preview-character-reference"]
        : []),
    ];
    const operationId = beginTrackedStudioAiOperation("scenario-image", {
      kind: "image",
      task: usesReference
        ? hasCharacterAnchor
          ? "character-image"
          : "image-edit"
        : "background-image",
      provider: provider.provider,
      model: provider.model,
      transport: provider.transport,
      promptVersion: 1,
      prompt: requestPrompt,
      target: { pageId: activePage.id },
      ...(usesReference
        ? {
            references: trackedReferenceAssetIds.map((assetId) => ({ assetId })),
          }
        : {
            requestedSize: parseStudioAiRequestedSize(scenarioAspectToImageSize(panel.aspect)),
            references: [],
          }),
    });
    try {
      const imageResult = usesRoleReferences
        ? await generateImageWithRoleReferences(aiSettings, roleReferences, requestPrompt, {
            signal: controller.signal,
          })
        : referenceImageDataUrl
          ? await generateConsistentCharacterImage(aiSettings, referenceImageDataUrl, reviewedImagePrompt, {
              signal: controller.signal,
            })
          : await generateBackgroundImage(
              aiSettings,
              requestPrompt,
              { size: scenarioAspectToImageSize(panel.aspect), signal: controller.signal }
            );
      if (!canApplyStudioMutation(mutationTicket)) return;
      settleTrackedStudioAiOperation(operationId, imageResult, {
        aborted: !imageResult.ok && controller.signal.aborted,
        target: { pageId: activePage.id },
      });
      if (controller.signal.aborted) return;
      setScenarioResult((previous) =>
        previous
          ? {
              ...previous,
              items: previous.items.map((item, itemIndex) =>
                itemIndex === index
                  ? imageResult.ok
                    ? {
                        ...item,
                        imageDataUrl: imageResult.data.dataUrl,
                        imageError: undefined,
                        imageProvenance: requestProvenance,
                      }
                    : { ...item, imageDataUrl: undefined, imageError: imageResult.error, imageProvenance: undefined }
                  : item
              ),
            }
          : previous
      );
    } finally {
      setScenarioRegeneratingIndex(null);
      finishScenarioRequest(controller);
    }
  }

  return { executeGenerateScenarioImages, executeRegenerateScenarioImage };
}
