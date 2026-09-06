import { Suspense } from "react";

import { CANVAS_W } from "./studio-assets";
import { StudioProceduralArtisticBrushController } from "./studio-page-lazy-ui";

import type { ReactElement } from "react";

const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_ENGINE_EPOCH = 1;
const STUDIO_PROCEDURAL_ARTISTIC_BRUSH_MAX_REQUEST_SEQUENCE =
  Number.MAX_SAFE_INTEGER;
let studioProceduralArtisticBrushRequestSequence = 0;

function nextStudioProceduralArtisticBrushRequestSequence(): number {
  if (
    studioProceduralArtisticBrushRequestSequence
    >= STUDIO_PROCEDURAL_ARTISTIC_BRUSH_MAX_REQUEST_SEQUENCE
  ) {
    throw new Error(
      "절차적 브러시 요청 순번 한도에 도달했습니다. 편집기를 다시 열어 주세요.",
    );
  }
  studioProceduralArtisticBrushRequestSequence += 1;
  return studioProceduralArtisticBrushRequestSequence;
}

export interface StudioProceduralArtisticBrushInspectorSectionProps {
  readonly currentColor: string;
  readonly canvasHeight: number;
  readonly pageId: string;
  readonly masterEditMode: boolean;
  readonly disabled: boolean;
  readonly disabledReason: string | null;
  readonly onInsert: (
    src: string,
    width: number,
    height: number,
    name: string,
    targetPageId: string,
    targetMasterEditMode: boolean,
  ) => boolean;
}

export function StudioProceduralArtisticBrushInspectorSection({
  currentColor,
  canvasHeight,
  pageId,
  masterEditMode,
  disabled,
  disabledReason,
  onInsert,
}: StudioProceduralArtisticBrushInspectorSectionProps): ReactElement {
  return (
    <Suspense
      fallback={
        <div
          className="h-14 animate-pulse rounded-xl bg-raised/35 motion-reduce:animate-none"
          aria-hidden
        />
      }
    >
      <StudioProceduralArtisticBrushController
        currentColor={currentColor}
        disabled={disabled}
        reason={disabledReason}
        probe={async (signal) => {
          const {
            probeStudioProceduralArtisticBrushProduct,
          } = await import("./studio-procedural-artistic-brush-product");
          return probeStudioProceduralArtisticBrushProduct(signal);
        }}
        generate={async (settings, signal) => {
          const targetPageId = pageId;
          const targetMasterEditMode = masterEditMode;
          const {
            generateStudioProceduralArtisticBrushProduct,
          } = await import("./studio-procedural-artistic-brush-product");
          const result =
            await generateStudioProceduralArtisticBrushProduct(
              settings,
              {
                width: Math.max(32, Math.min(CANVAS_W, 1_024)),
                height: Math.max(
                  32,
                  Math.min(Math.floor(canvasHeight), 1_024),
                ),
                requestSequence:
                  nextStudioProceduralArtisticBrushRequestSequence(),
                engineEpoch:
                  STUDIO_PROCEDURAL_ARTISTIC_BRUSH_ENGINE_EPOCH,
                signal,
              },
            );
          if (
            !onInsert(
              result.src,
              result.width,
              result.height,
              result.name,
              targetPageId,
              targetMasterEditMode,
            )
          ) {
            throw new Error(
              "절차적 질감 레이어를 현재 문서에 추가하지 못했습니다.",
            );
          }
          return { message: result.message };
        }}
      />
    </Suspense>
  );
}
