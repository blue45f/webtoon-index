"use no memo";
// React Compiler 옵트아웃: 이 파일들은 가변 호스트 백(h) 을 렌더마다 재대입해 공유하는
// 추출 패턴이라, 컴파일러가 h 참조 동일성만 보고 JSX/계산을 캐시하면 첫 렌더에서 UI 가
// 영구 동결된다(탭 전환 등 커밋된 상태 변경이 화면에 반영되지 않음).
import { lazy } from "react";
import { createPortal } from "react-dom";

import { StudioBg3dEditorModal } from "./StudioBg3dEditorModal";
import { useStudioBg3dEditor } from "./useStudioBg3dEditor";

import type { StudioBackground3DProps } from "./StudioBackground3DTypes";

export type {
  StudioBackground3DInsertResult,
  StudioBackground3DLtLayer,
} from "../scene-3d/studio-3d-insert-contract";

export type {
  BgPanelTab,
  CaptureState,
  LtEditorSection,
  LtUserPresetLibraryStatus,
  LtUserPresetNotice,
  ModelThumbnailGpuLease,
  StudioBackground3DProps,
  StudioBg3dBabylonSpecialistEntry,
  StudioBg3dModelThumbnailRuntime,
  StudioBg3dPhysicsSession,
  TransformModeId,
  TransformSpace,
  ViewEditorSection,
} from "./StudioBackground3DTypes";

const LazyStudioBg3dAssetLibraryPanel = lazy(() =>
  import("./StudioBg3dAssetLibraryPanelWithPresets").then(({ StudioBg3dAssetLibraryPanelWithPresets }) => ({
    default: StudioBg3dAssetLibraryPanelWithPresets,
  }))
);

export function StudioBackground3D(props: StudioBackground3DProps) {
  const h = useStudioBg3dEditor(props);
  if (!h) return null;
  h.LazyStudioBg3dAssetLibraryPanel = LazyStudioBg3dAssetLibraryPanel;
  if (typeof document === "undefined") return null;
  const modal = <StudioBg3dEditorModal h={h} />;
  return createPortal(modal, document.body);
}
