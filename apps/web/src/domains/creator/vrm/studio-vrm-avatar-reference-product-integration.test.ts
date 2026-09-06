import { describe, expect, it } from "vitest";

import catalogueRuntimeSource from "./studio-vrm-avatar-reference-catalogue-runtime.ts?raw";
import productSource from "./studio-vrm-avatar-reference-product.ts?raw";
import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";
import panelSource from "./StudioVrmAvatarReferenceRecommendationsPanel.tsx?raw";
import hookSource from "./useStudioVrmAvatarReferenceCatalogue.ts?raw";

const poserSource = readStudioVrmPoserImplementationSource();

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe("Avatar reference recommendation product wiring", () => {
  it("lazy-loads the verified catalogue only on the real Avatar Forge screen", () => {
    const forgePanel = section(
      poserSource,
      '<section\n                id="vrm-character-section-forge"',
      "<StudioVrmTexturePaintPanel",
    );
    expect(forgePanel).toContain("<StudioVrmAvatarReferenceRecommendationsPanel");
    expect(forgePanel).toContain("? avatarForgeReferenceCatalogue.catalogue");
    expect(forgePanel).toContain("? avatarForgeReferenceCatalogue.status");
    expect(forgePanel).toContain("onCatalogueRetry={avatarForgeReferenceCatalogue.retry}");
    expect(forgePanel).toContain("avatarForgeReferenceInteractionBlocked()");
    expect(poserSource).toContain(
      'open && activePanelTab === "character" && activeCharacterSection === "forge"',
    );
    expect(poserSource).toContain("active: avatarForgeReferenceSurfaceActive");
    expect(forgePanel).toContain("avatarForgeReferenceSurfaceActive");
    expect(hookSource).toContain("loadStudioVrmAvatarReferenceCatalogue");
    expect(hookSource).toContain("controller.abort()");
    expect(catalogueRuntimeSource).toContain('cache: "no-cache"');
    expect(catalogueRuntimeSource).toContain('mode: "same-origin"');
    expect(panelSource).toContain("추천 기준 다시 불러오기");
    expect(panelSource).toContain("mediaPipeConsentGranted");
    expect(panelSource).toContain("이용·성능 메타데이터를 처리할 수 있습니다");
    expect(panelSource).toContain("MediaPipe API 약관");
  });

  it("keeps preview ephemeral, reversible, and outside full-state persistence", () => {
    expect(poserSource).toContain(
      "state={avatarForgeReferencePreviewActive?.state ?? avatarForgeState}",
    );
    expect(poserSource).toContain('&& !broadcastPreviewActive\n      ? avatarForgeReferencePreview');
    expect(poserSource).toContain("avatarForgeReferencePreview.catalogueRevision");
    expect(poserSource).toContain("avatarForgeReferenceCatalogue.catalogueRevision");
    expect(poserSource).toContain("if (avatarForgeReferencePreviewActive) return false");
    expect(poserSource).toContain("onPreviewClear={() => setAvatarForgeReferencePreview(null)}");
    expect(panelSource).toContain("아직 프로젝트와 되돌리기 기록에는 반영되지 않았습니다");
    expect(productSource).not.toMatch(/localStorage|indexedDB|sessionStorage|FileSystem/u);
  });

  it("commits one receipt-checked appearance apply as one explicit full-state Undo command", () => {
    const apply = section(
      poserSource,
      "function handleAvatarForgeReferenceApply(",
      "function handleAvatarForgeChange(",
    );
    expect(apply.match(/commitStudioVrmFullStateHistoryTransaction\(/gu)).toHaveLength(1);
    expect(apply).toContain("const before = captureFullState()");
    expect(apply).toContain("avatarForge: serializeAvatarForgeState(nextState)");
    expect(apply).toContain("setAvatarForgeState(nextState)");
    expect(apply).toContain("setAvatarForgeReferencePreview(null)");
    expect(productSource).toContain("isStudioVrmAvatarReferenceRecommendationReceipt");
    expect(productSource).toContain("body: current.body");
    expect(productSource).toContain("proportions: current.proportions");
  });

  it("pins catalogue generation to the tracked VRM and every canonical preset state", () => {
    expect(productSource).toContain('sourceUrl: "/vrm/TS_Minseo_Campus.vrm"');
    expect(productSource).toContain("sourceByteLength: 1_325_288");
    expect(productSource).toContain(
      "903601a5ffa71383188a3885509653283fb842e9a3f0025dca222b1c9b78ebea",
    );
    expect(productSource).toContain("studioVrmAvatarReferencePresetStateSha256");
    expect(productSource).toContain("referenceImageSha256");
    expect(productSource).toContain("candidate.renders.length !== PRESET_IDS.length");
  });
});
