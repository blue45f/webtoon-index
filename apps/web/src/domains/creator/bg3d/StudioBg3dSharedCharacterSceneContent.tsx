import { lazy, Suspense } from "react";

import { registerStudioBg3dCaptureExcludedObject } from "./studio-bg3d-capture-exclusion";

import type { StudioBg3dSharedCharacterGroundingResult } from "./studio-bg3d-shared-character-grounding";
import type {
  StudioShared3dCharacterRuntimeStatus,
  StudioShared3dCharacterSource,
} from "../studio-shared-3d-scene-bridge";

const LazyStudioBg3dSharedVrmCharacter = lazy(
  () => import("./StudioBg3dSharedVrmCharacter"),
);
const LazyStudioBg3dSharedCharacterContactShadow = lazy(
  () => import("./StudioBg3dSharedCharacterContactShadow"),
);

export function StudioBg3dSharedCharacterSceneContent({
  characters,
  includeInCapture,
  groundingResults,
  onGrounding,
  onSelect,
  onStatus,
  selectedElementId,
  surfaceRevision,
}: {
  characters: readonly StudioShared3dCharacterSource[];
  includeInCapture: boolean;
  groundingResults: Readonly<Record<string, StudioBg3dSharedCharacterGroundingResult>>;
  onGrounding: (
    runtimeKey: string,
    result: StudioBg3dSharedCharacterGroundingResult | null,
  ) => void;
  onSelect: (elementId: string) => void;
  onStatus: (runtimeKey: string, status: StudioShared3dCharacterRuntimeStatus) => void;
  selectedElementId: string | null;
  surfaceRevision: string;
}) {
  return characters.map((source) => (
    <Suspense key={source.modelRuntimeKey} fallback={null}>
      <group
        ref={!includeInCapture || source.compatibility.previewOmissions.length > 0
          ? registerStudioBg3dCaptureExcludedObject
          : undefined}
      >
        <LazyStudioBg3dSharedCharacterContactShadow
          source={source}
          grounding={groundingResults[source.runtimeKey]}
        />
        <LazyStudioBg3dSharedVrmCharacter
          source={source}
          surfaceRevision={surfaceRevision}
          selected={source.elementId === selectedElementId}
          onSelect={onSelect}
          onStatus={onStatus}
          onGrounding={onGrounding}
        />
      </group>
    </Suspense>
  ));
}
