import {
  parseStudioLinked3dRenderDocument,
  validateStudioLinked3dRenderDocumentAgainstPage,
  validateStudioLinked3dReservedPageState,
} from "./studio-linked-3d-render-document";
import { migrateStudioShared3dStageCollectionDocument } from "./studio-shared-3d-stage-collection";

import type { El } from "./studio-element-model";
import type { PageState } from "./studio-page-state";

export interface NormalizeStudioLinked3dSaveProjectionInput {
  readonly pagesList: readonly PageState[];
  readonly master?: { readonly elements: readonly El[] };
}

/**
 * Canonicalizes and cross-validates linked 3D references before a project crosses a persistence
 * boundary. The result remains the caller's original page array when no normalization is needed.
 */
export function normalizeStudioLinked3dSaveProjection({
  pagesList,
  master,
}: NormalizeStudioLinked3dSaveProjectionInput): PageState[] {
  if (master) {
    const reservedMasterState = validateStudioLinked3dReservedPageState({
      value: undefined,
      elements: master.elements,
    });
    if (!reservedMasterState.ok) {
      throw new Error("문서 마스터의 연결형 3D reserved 상태를 저장할 수 없어요.");
    }
  }

  let pagesChanged = false;
  const normalizedPages = pagesList.map((page) => {
    const shared3dStage = page.shared3dStage === undefined
      ? undefined
      : migrateStudioShared3dStageCollectionDocument(page.shared3dStage);
    if (page.shared3dStage !== undefined && !shared3dStage) {
      throw new Error("페이지 공유 3D 장면 연결이 손상되어 저장하지 않았어요.");
    }
    const linked3dRender = page.linked3dRender === undefined
      ? undefined
      : parseStudioLinked3dRenderDocument(page.linked3dRender);
    if (page.linked3dRender !== undefined && !linked3dRender) {
      throw new Error("페이지 연결형 3D 렌더 인덱스가 손상되어 저장하지 않았어요.");
    }
    const reservedState = validateStudioLinked3dReservedPageState({
      value: linked3dRender,
      elements: page.elements,
    });
    if (!reservedState.ok) {
      throw new Error(`페이지 연결형 3D reserved 상태가 달라 저장하지 않았어요: ${reservedState.message}`);
    }
    if (linked3dRender) {
      const validation = validateStudioLinked3dRenderDocumentAgainstPage({
        value: linked3dRender,
        elements: page.elements,
        shared3dStage: shared3dStage ?? undefined,
      });
      if (!validation.ok) {
        throw new Error(`페이지 연결형 3D 렌더 권위가 달라 저장하지 않았어요: ${validation.message}`);
      }
    }
    if (shared3dStage === undefined && linked3dRender === undefined) return page;
    pagesChanged = true;
    return {
      ...page,
      ...(shared3dStage ? { shared3dStage } : {}),
      ...(linked3dRender ? { linked3dRender } : {}),
    };
  });

  return pagesChanged ? normalizedPages : pagesList as PageState[];
}
