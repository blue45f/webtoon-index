/* Extracted from StudioBackground3D. Closures keep original identifiers via an `any` host bag. */
// @ts-nocheck
"use no memo";
// React Compiler 옵트아웃: 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는 추출 패턴이라,
// 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가 영구 동결된다
// (탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import * as R from "./studio-bg3d-editor-runtime-bindings";
import { useStudioBg3dEditorState } from "./useStudioBg3dEditorState";
import { bindStudioBg3dEditorViewModel } from "./studio-bg3d-editor-view-model";
import { bindStudioBg3dEditorSelectionViewModel } from "./studio-bg3d-editor-selection-view-model";
import { bindStudioBg3dEditorLayoutViewModel } from "./studio-bg3d-editor-layout-view-model";
import { attachStudioBg3dEditorHosts } from "./studio-bg3d-editor-attach-hosts";
import { bindStudioBg3dEditorSceneGraph } from "./StudioBg3dEditorSceneGraph";
import { useStudioBg3dEditorEffects } from "./useStudioBg3dEditorEffects";
import { useStudioBg3dEditorRestoreEffects } from "./useStudioBg3dEditorRestoreEffects";

export function useStudioBg3dEditor(props) {
  const { createStudioBg3dModelImportActions } = R;
  const h = useStudioBg3dEditorState(props);
  bindStudioBg3dEditorViewModel(h);
  bindStudioBg3dEditorSelectionViewModel(h);
  bindStudioBg3dEditorLayoutViewModel(h);
  attachStudioBg3dEditorHosts(h);
  const actions = createStudioBg3dModelImportActions({
    attachmentByStorageModelIdRef: h.attachmentByStorageModelIdRef,
    canAdmitSceneNodes: h.canAdmitSceneNodes,
    cancelCustomModelPlacement: h.cancelCustomModelPlacement,
    captureInFlightRef: h.captureInFlightRef,
    commitSceneEntityRemoval: h.commitSceneEntityRemoval,
    destructiveMutationGuardRef: h.destructiveMutationGuardRef,
    deviceQuality: h.deviceQuality,
    genericModelClassifications: h.genericModelClassifications,
    invalidateModelThumbnailCaptures: h.invalidateModelThumbnailCaptures,
    isModalAssetSessionCurrent: h.isModalAssetSessionCurrent,
    isRestoringScene: h.isRestoringScene,
    modalAssetSessionRef: h.modalAssetSessionRef,
    modelImportAbortRef: h.modelImportAbortRef,
    modelLoadPendingRef: h.modelLoadPendingRef,
    modelRenderer: h.modelRenderer,
    modelRootCacheRef: h.modelRootCacheRef,
    physicsRuntimeSourceRef: h.physicsRuntimeSourceRef,
    placementSessionRef: h.placementSessionRef,
    sceneBaseDocument: h.sceneBaseDocument,
    sceneRestoreAbortRef: h.sceneRestoreAbortRef,
    setCustomModels: h.setCustomModels,
    setDeletingModelId: h.setDeletingModelId,
    setError: h.setError,
    setGenericModelClassifications: h.setGenericModelClassifications,
    setGenericModelSourceFormats: h.setGenericModelSourceFormats,
    setIsUploadingModel: h.setIsUploadingModel,
    setModelImportProgress: h.setModelImportProgress,
    setModelLibrary: h.setModelLibrary,
    setModelLibraryStatus: h.setModelLibraryStatus,
    setRefTick: h.setRefTick,
    setSelectedIds: h.setSelectedIds,
    startModelThumbnailCaptureBatch: h.startModelThumbnailCaptureBatch,
    storageModelIdByAttachmentIdRef: h.storageModelIdByAttachmentIdRef,
  });
  h.handleDeleteModelFromLibrary = actions.handleDeleteModelFromLibrary;
  h.handleUploadModelFiles = actions.handleUploadModelFiles;
  bindStudioBg3dEditorSceneGraph(h);
  useStudioBg3dEditorEffects(h);
  useStudioBg3dEditorRestoreEffects(h);
  return h;
}
