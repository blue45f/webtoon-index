import { Suspense, type ReactElement } from "react";

import { StudioHokusaiNaturalMediaInspectorSection } from "./studio-page-lazy-ui";

import type { StudioHokusaiNaturalMediaProductResult } from "./render/studio-hokusai-natural-media-product";
import type { El } from "./studio-element-model";

export type StudioHokusaiNaturalMediaReplaceHandler = (
  result: StudioHokusaiNaturalMediaProductResult,
  targetPageId: string,
  targetMasterEditMode: boolean,
) => boolean;

interface StudioHokusaiNaturalMediaInspectorMountProps {
  readonly visible: boolean;
  readonly selected: El | null;
  readonly currentColor: string;
  readonly documentWidth: number;
  readonly documentHeight: number;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly locks: Readonly<{
    collaboration: boolean;
    surfaceReview: boolean;
    selectedContent: boolean;
  }>;
  readonly onRequestSelectStroke?: () => void;
  readonly onReplace: StudioHokusaiNaturalMediaReplaceHandler;
}

function disabledReason(
  locks: StudioHokusaiNaturalMediaInspectorMountProps["locks"],
): string | null {
  if (locks.collaboration) {
    return "협업 문서 잠금을 해제한 뒤 자연매체로 변환할 수 있어요.";
  }
  if (locks.surfaceReview) {
    return "표면 리뷰를 마친 뒤 자연매체로 변환할 수 있어요.";
  }
  if (locks.selectedContent) {
    return "선택 레이어 잠금을 해제한 뒤 자연매체로 변환할 수 있어요.";
  }
  return null;
}

/** Keeps optional natural-media loading and lock messaging outside the already-large inspector. */
export function StudioHokusaiNaturalMediaInspectorMount({
  visible,
  selected,
  currentColor,
  documentWidth,
  documentHeight,
  pageId,
  masterEditMode,
  locks,
  onRequestSelectStroke,
  onReplace,
}: StudioHokusaiNaturalMediaInspectorMountProps): ReactElement | null {
  if (!visible) return null;
  const reason = disabledReason(locks);
  return (
    <Suspense
      fallback={(
        <div
          className="h-14 animate-pulse rounded-xl bg-raised/35 motion-reduce:animate-none"
          aria-hidden
        />
      )}
    >
      <StudioHokusaiNaturalMediaInspectorSection
        selected={selected}
        currentColor={currentColor}
        documentWidth={documentWidth}
        documentHeight={documentHeight}
        pageId={pageId}
        masterEditMode={masterEditMode}
        disabled={reason !== null}
        disabledReason={reason}
        onRequestSelectStroke={onRequestSelectStroke}
        onReplace={onReplace}
      />
    </Suspense>
  );
}
