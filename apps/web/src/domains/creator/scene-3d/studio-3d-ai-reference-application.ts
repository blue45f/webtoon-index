import {
  STUDIO_AI_IMAGE_REFERENCE_LIMITS,
  hydrateStudioAiImageReferenceDocument,
  type StudioAiImageReferenceDocument,
} from "../ai/studio-ai-image-reference-roles";

import type { StudioBg3dAiMethodReferenceCapture } from "./studio-3d-ai-reference-handoff";
import type { StudioAssetWithContentHash } from "../studio-asset-library";

export const STUDIO_BG3D_AI_METHOD_REFERENCE_ID =
  "bg3d-current-shot-method" as const;

export type StudioBg3dAiMethodReferenceApplication =
  | {
      readonly ok: true;
      readonly action: "added" | "replaced";
      readonly document: StudioAiImageReferenceDocument;
    }
  | {
      readonly ok: false;
      readonly reason: "method-reference-limit";
    };

/**
 * Installs exactly one replaceable “current 3D shot” reference without disturbing manually
 * curated Method references. A full Method channel fails visibly instead of silently evicting a
 * user's reference.
 */
export function applyStudioBg3dAiMethodReference(
  document: StudioAiImageReferenceDocument,
  asset: StudioAssetWithContentHash,
  capture: StudioBg3dAiMethodReferenceCapture,
): StudioBg3dAiMethodReferenceApplication {
  const canonical = hydrateStudioAiImageReferenceDocument(document);
  const existing = canonical.references.find(
    (reference) => reference.id === STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
  );
  const referencesWithoutCurrentShot = canonical.references.filter(
    (reference) => reference.id !== STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
  );
  if (
    !existing &&
    referencesWithoutCurrentShot.filter(({ role }) => role === "method").length >=
      STUDIO_AI_IMAGE_REFERENCE_LIMITS.maxReferencesPerRole
  ) {
    return Object.freeze({
      ok: false,
      reason: "method-reference-limit",
    });
  }

  const nextDocument = hydrateStudioAiImageReferenceDocument({
    version: canonical.version,
    references: [
      ...referencesWithoutCurrentShot,
      {
        id: STUDIO_BG3D_AI_METHOD_REFERENCE_ID,
        role: capture.suggestedRole,
        asset: {
          assetId: asset.id,
          sha256: asset.contentHash,
        },
        label: capture.shotId ? "현재 3D 저장 컷 구도" : "현재 3D 샷 구도",
        guidance:
          "카메라 각도, 프레이밍, 원근, 피사체 방향과 공간 배치만 참고하고 원본의 정체성·화풍·문자는 복제하지 마세요.",
      },
    ],
  });
  const installed = nextDocument.references.some(
    (reference) =>
      reference.id === STUDIO_BG3D_AI_METHOD_REFERENCE_ID &&
      reference.role === "method" &&
      reference.asset.assetId === asset.id &&
      reference.asset.sha256 === asset.contentHash,
  );
  if (!installed) {
    return Object.freeze({
      ok: false,
      reason: "method-reference-limit",
    });
  }
  return Object.freeze({
    ok: true,
    action: existing ? "replaced" : "added",
    document: nextDocument,
  });
}
