import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const panel = readFileSync(new URL("./StudioVrmAvatarForgePanel.tsx", import.meta.url), "utf8");
const preview = readFileSync(new URL("./StudioVrmAvatarForgePreview.tsx", import.meta.url), "utf8");
const range = readFileSync(new URL("./StudioVrmForgeRangeControl.tsx", import.meta.url), "utf8");
const pose = readFileSync(new URL("./StudioVrmPhotoPoseScanner.tsx", import.meta.url), "utf8");
const reference = readFileSync(
  new URL("./StudioVrmAvatarReferenceRecommendationsPanel.tsx", import.meta.url),
  "utf8",
);
const renderer = readFileSync(new URL("./StudioVrmAvatarForge.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("./StudioVrmPoserDialog.tsx", import.meta.url), "utf8");

describe("Shaper-inspired character workshop product boundary", () => {
  it("uses visual recipe previews and precise controls instead of emoji-only selection", () => {
    expect(panel).toContain("StudioVrmAvatarForgePreview");
    expect(panel).toContain("StudioVrmForgeRangeControl");
    expect(panel).toContain("아바타 스타일 검색");
    expect(panel).toContain("FACE_SHAPE_PRESETS");
    expect(panel).toContain("HAIR_COLOR_PRESETS");
    expect(range).toContain("정확한 값");
    expect(preview).toContain('data-forge-preview="true"');
    expect(preview).toContain("HairBack");
    expect(preview).toContain("Bangs");
  });

  it("keeps AI and pose review creator-facing and reversible", () => {
    expect(reference).toContain("StudioVrmAvatarForgePreview");
    expect(reference).toContain("% 유사");
    expect(reference).toContain("분석 기술 정보");
    expect(reference).not.toContain("cosine {");
    expect(pose).toContain("filterPhotoPoseBones");
    expect(pose).toContain("사진 포즈 적용 범위");
    expect(pose).toContain("<image href={imageUrl}");
    expect(pose).toContain("replacePreviewUrl(null)");
  });

  it("adds a merged authored toon silhouette without mutating source hair geometry", () => {
    expect(renderer).toContain("new THREE.MeshToonMaterial");
    expect(renderer).toContain("new THREE.MeshBasicMaterial");
    expect(renderer).toContain("THREE.BackSide");
    expect(renderer).toContain("createExpandedOutlineGeometry");
    expect(renderer).toContain("normal.getX(index) * thickness");
    expect(renderer).toContain("ToonSpectrumAvatarForgeHair_AuthoredMerged");
    expect(renderer).toContain("mergeStudioVrmAuthoredHairGeometry(");
    expect(dialog).toContain("max-w-[1480px]");
    expect(dialog).toContain("_460px");
  });
});
