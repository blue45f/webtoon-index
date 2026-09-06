import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

function poserSource(): string {
  return readStudioVrmPoserImplementationSource();
}

describe("VRM durable creative product authority", () => {
  it("routes custom poses and saved full states to separate shared V12 SQLite namespaces", () => {
    const poser = poserSource();
    const repository = source("./studio-vrm-creative-sqlite-repository.ts");

    expect(poser).toContain("createStudioVrmCreativeSqliteRepository");
    expect(poser).toContain("creativeRepository.loadCustomPoses()");
    expect(poser).toContain("creativeRepository.loadFullStates()");
    expect(poser).toContain("creativeRepository.saveCustomPoses(next)");
    expect(poser).toContain("creativeRepository.saveFullStates(next)");
    expect(poser).toContain("handleDeleteFullLocal");
    expect(poser).not.toContain('"studio_custom_poses"');
    expect(poser).not.toContain('"studio_vrm_full_states"');

    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).toContain('"studio-vrm-custom-poses-v12"');
    expect(repository).toContain('"studio-vrm-full-poser-states-v12"');
    expect(repository).not.toContain("localStorage");
    expect(repository).not.toContain("indexedDB");
  });

  it("keeps product pose materials on SQLite while retaining storage only as an explicit seam", () => {
    const panel = source("./StudioVrmPoseMaterialPanel.tsx");
    const repository = source("./studio-vrm-pose-material-sqlite-repository.ts");
    const legacy = source("../studio-pose-material-library.ts");

    expect(panel).toContain("createStudioVrmPoseMaterialSqliteRepository");
    expect(panel).toContain("repository.load()");
    expect(panel).toContain("repository.save(optimisticPayload)");
    expect(panel).not.toContain("window.localStorage");
    expect(repository).toContain('"studio-vrm-pose-materials-v12"');
    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).not.toContain("localStorage");
    expect(legacy).toContain("StudioPoseMaterialStorage");
    expect(panel).toContain("Explicit legacy import/test seam");
  });

  it("fences hydration, serializes mutations, and labels durable write failures as memory-only", () => {
    const poser = poserSource();
    const panel = source("./StudioVrmPoseMaterialPanel.tsx");

    expect(poser).toContain("vrmCreativeMutationTailRef");
    expect(poser).toContain("vrmCreativeMutationGenerationRef");
    expect(poser).toContain("vrmCreativeMountedRef");
    expect(poser).toContain("현재 탭 메모리 임시 · 새로고침 시 사라짐");
    expect(poser).toContain("parseStudioVrmCustomPoseImport");
    expect(poser).not.toContain(".filter((p) => p && typeof p");
    expect(poser).not.toContain(".slice(0, STUDIO_VRM_FULL_STATE_MAX_NAME_LENGTH)");
    expect(panel).toContain("mutationTailRef");
    expect(panel).toContain("mutationGenerationRef");
    expect(panel).toContain("mountedRef");
    expect(panel).toContain("현재 탭 메모리 임시 · 새로고침 시 사라짐");
  });

  it("keeps clipboard, consent, and recents out of creative SQLite", () => {
    const poser = poserSource();
    const repository = source("./studio-vrm-creative-sqlite-repository.ts");

    expect(poser).toContain('"studio_pose_clipboard"');
    expect(poser).toContain('"studio_vrm_full_clip"');
    expect(poser).toContain('"studio_webcam_consent"');
    expect(poser).toContain("saveStudioVrmRecentPoses");
    expect(repository).not.toContain("clipboard");
    expect(repository).not.toContain("webcam");
    expect(repository).not.toContain("calibration");
    expect(repository).not.toContain("recent");
  });

  it("routes precision-sensitive tracking calibration to its own SQLite namespace", () => {
    const poser = poserSource();
    // 2026-08-21 의도적 변경: 캘리브레이션 저장(save)은 웹캠 트래킹 루프와 함께
    // use-studio-vrm-webcam-session.ts로 분리됐다. load/clear 는 포저에 그대로 남는다.
    const webcamSession = source("./use-studio-vrm-webcam-session.ts");
    const repository = source("./studio-vrm-tracking-calibration-sqlite-repository.ts");

    expect(poser).toContain("createStudioVrmTrackingCalibrationSqliteRepository");
    expect(poser).toContain("trackingCalibrationRepository.load()");
    expect(webcamSession).toContain("trackingCalibrationRepository.save(cal)");
    expect(poser).toContain("trackingCalibrationRepository.clear()");
    expect(poser).not.toContain("CALIBRATION_STORAGE_KEY");
    expect(webcamSession).not.toContain("CALIBRATION_STORAGE_KEY");
    expect(repository).toContain('"studio-vrm-tracking-calibration-v12"');
    expect(repository).toContain("acquireStudioLocalDatabase");
    expect(repository).not.toContain("localStorage");
    expect(repository).not.toContain("indexedDB");
  });
});
