import { describe, expect, it } from "vitest";

import {
  selectSharedPoseAssets,
  shouldLoadSharedPoseLibrary,
} from "./studio-vrm-shared-pose-library";

import type { SharedAssetCatalogItem } from "../../../infrastructure/creator-client";

function asset(overrides: Partial<SharedAssetCatalogItem>): SharedAssetCatalogItem {
  return {
    id: "asset-1",
    name: "asset",
    previewDataUrl: "data:image/png;base64,AA==",
    previewWidth: 1,
    previewHeight: 1,
    previewAvailable: true,
    width: 1,
    height: 1,
    license: "toonspectrum-standard",
    licenseLabel: "toonspectrum",
    licenseUrl: null,
    attributionRequired: false,
    commercialUse: true,
    attributionText: "",
    containsAi: false,
    moderationStatus: "published",
    reportCount: 0,
    downloads: 0,
    kind: "image",
    author: { id: "author-1", name: "Author", avatar: "" },
    isOwner: false,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("shared VRM pose library", () => {
  it("does not contact the optional API merely because the 3D character editor opened", () => {
    expect(shouldLoadSharedPoseLibrary({
      editorOpen: true,
      posePanelActive: false,
      libraryExpanded: false,
    })).toBe(false);
    expect(shouldLoadSharedPoseLibrary({
      editorOpen: true,
      posePanelActive: true,
      libraryExpanded: false,
    })).toBe(false);
  });

  it("loads only while the visible pose library is expanded", () => {
    expect(shouldLoadSharedPoseLibrary({
      editorOpen: true,
      posePanelActive: true,
      libraryExpanded: true,
    })).toBe(true);
    expect(shouldLoadSharedPoseLibrary({
      editorOpen: false,
      posePanelActive: true,
      libraryExpanded: true,
    })).toBe(false);
  });

  it("accepts typed poses and legacy name-prefixed poses", () => {
    const typed = asset({ id: "typed", kind: "vrm_pose" });
    const legacy = asset({ id: "legacy", name: "[3D_POSE] 레거시" });
    const image = asset({ id: "image", name: "배경" });

    expect(selectSharedPoseAssets([typed, legacy, image]).map(({ id }) => id)).toEqual([
      "typed",
      "legacy",
    ]);
  });
});
