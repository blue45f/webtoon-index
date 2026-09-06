import { describe, expect, it } from "vitest";

import { buildStudioPackageArchiveBlob } from "../studio-package-archive";

import {
  STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND,
  STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION,
  createStudioBg3dShotBatchPublicRenderPlan,
} from "./studio-bg3d-shot-batch";
import { verifyStudioBg3dShotBatchArchiveBlob } from "./studio-bg3d-shot-batch-archive-verifier";
import { computeStudioBg3dShotBatchRenderDigest } from "./studio-bg3d-shot-batch-plan";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

async function archiveWithManifest(manifest: unknown, path = "shots/001.png"): Promise<Blob> {
  return buildStudioPackageArchiveBlob([
    { path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
    { path, data: PNG },
  ], {
    mimeType: "application/zip",
    crc32ExecutionMode: "direct-headless",
  });
}

function legacyManifest() {
  return {
    kind: "toonspectrum-bg3d-shot-batch",
    version: 1,
    files: [{
      shotId: "shot-a",
      name: "첫 컷",
      path: "shots/001.png",
      width: 320,
      height: 180,
      output: "beauty",
    }],
  };
}

function forgedPublicPlan() {
  return createStudioBg3dShotBatchPublicRenderPlan({
    kind: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_KIND,
    version: STUDIO_BG3D_SHOT_BATCH_PUBLIC_RENDER_PLAN_VERSION,
    sourceDigest: "a".repeat(64),
    renderDigest: "b".repeat(64),
    implementation: {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      engineId: "three",
      engineRevision: "184",
      adapterImplementationRevision: "studio-three-webgl-capture-adapter-v1",
      graphicsApi: "webgl2",
      backend: "three-webgl",
    },
    captureProfile: {
      profileId: "studio-rgba8-straight-srgb-topdown-depth-f32-v1",
      ltPipelineId: "studio-lt-color-tone-line-depth-v1",
      pngEncodingId: "png-srgb-straight-alpha-v1",
      depthEncodingId: STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1,
      sourceWidth: 640,
      sourceHeight: 360,
      maxPixels: 8_388_608,
      maxEdge: 4_096,
      deviceProfile: "desktop",
      textureScale: 1,
      lodBias: 0,
    },
    artifactProfiles: {
      psdProfileId: STUDIO_BG3D_SHOT_BATCH_PSD_PROFILE_V1,
      contactSheetProfileId: STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1,
      archiveProfileId: STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1,
    },
    passes: ["beauty"],
    exportHeight: 360,
    artifactRequests: { layeredPsd: false, contactSheet: false },
    shots: [{
      shotId: "shot-a",
      shotName: "첫 컷",
      shotIndex: 1,
      capture: {
        width: 640,
        height: 360,
        requestedHeight: 360,
        wasReduced: false,
        includeDepth: false,
        shadows: false,
        shadowMapSize: 0,
        background: { color: "#ffffff", alpha: 0 },
      },
      files: [{
        shotId: "shot-a",
        shotName: "첫 컷",
        shotIndex: 1,
        pass: "beauty",
        path: "shots/001/beauty.png",
      }],
    }],
  });
}

async function validPublicPlan(options: { readonly contactSheet?: boolean } = {}) {
  const draft = createStudioBg3dShotBatchPublicRenderPlan({
    ...forgedPublicPlan(),
    artifactRequests: {
      layeredPsd: false,
      contactSheet: options.contactSheet ?? false,
    },
  });
  const renderDigest = await computeStudioBg3dShotBatchRenderDigest({
    sourceDigest: draft.sourceDigest,
    captureOwner: {
      backend: draft.implementation.backend,
      engineId: draft.implementation.engineId,
      engineRevision: draft.implementation.engineRevision,
      implementationRevision: draft.implementation.adapterImplementationRevision,
      graphicsApi: draft.implementation.graphicsApi,
      profileId: draft.captureProfile.profileId,
      sourceWidth: draft.captureProfile.sourceWidth,
      sourceHeight: draft.captureProfile.sourceHeight,
      maxPixels: draft.captureProfile.maxPixels,
      maxEdge: draft.captureProfile.maxEdge,
      deviceProfile: draft.captureProfile.deviceProfile,
      textureScale: draft.captureProfile.textureScale,
      lodBias: draft.captureProfile.lodBias,
      ltPipelineId: draft.captureProfile.ltPipelineId,
      pngEncodingId: draft.captureProfile.pngEncodingId,
      psdEncodingId: draft.artifactProfiles.psdProfileId,
    },
    shots: draft.shots.map((shot) => ({
      ...shot,
      files: shot.files.map((file) => ({ ...file, key: `${file.shotId}:${file.pass}` })),
    })),
    passes: draft.passes,
    exportHeight: draft.exportHeight,
    includeLayeredPsd: draft.artifactRequests.layeredPsd,
    includeContactSheet: draft.artifactRequests.contactSheet,
  });
  expect(renderDigest).not.toBeNull();
  return createStudioBg3dShotBatchPublicRenderPlan({ ...draft, renderDigest: renderDigest! });
}

function publicManifest(plan: ReturnType<typeof forgedPublicPlan>) {
  return {
    kind: "toonspectrum-bg3d-shot-batch",
    version: 3,
    publicRenderPlan: plan,
    producedPasses: ["beauty"],
    artifacts: [{
      shotId: "shot-a",
      name: "첫 컷",
      path: "shots/001/beauty.png",
      width: 640,
      height: 360,
      pass: "beauty",
      status: "completed",
      encoding: "srgb-straight-alpha-rgba8",
      requestedHeight: 360,
      wasReduced: false,
    }],
    psdFallbacks: [],
    contactSheetFallback: null,
  };
}

describe("Studio BG3D shot batch archive response verifier", () => {
  it("accepts the canonical bounded ZIP32 subset emitted by Studio", async () => {
    const archive = await archiveWithManifest(legacyManifest());
    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive)).resolves.toBe(true);
  });

  it("rejects a local-header prefix without EOCD and central directory", async () => {
    const forged = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x6a, 0x75, 0x6e, 0x6b])], {
      type: "application/zip",
    });
    await expect(verifyStudioBg3dShotBatchArchiveBlob(forged)).resolves.toBe(false);
  });

  it("streams every entry and rejects CRC corruption", async () => {
    const archive = await archiveWithManifest(legacyManifest());
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const marker = bytes.findIndex((byte, index) =>
      index > 30 && byte === PNG[0] && bytes[index + 1] === PNG[1]);
    expect(marker).toBeGreaterThan(0);
    bytes[marker] ^= 0xff;
    const corrupt = new Blob([bytes], { type: "application/zip" });
    await expect(verifyStudioBg3dShotBatchArchiveBlob(corrupt)).resolves.toBe(false);
  });

  it("rejects a structurally valid public plan whose render digest does not own its fields", async () => {
    const plan = forgedPublicPlan();
    const manifest = publicManifest(plan);
    const archive = await archiveWithManifest(manifest, "shots/001/beauty.png");
    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive)).resolves.toBe(false);
  });

  it("rejects raw source revision or recovery-scope fields while allowing public revision identities", async () => {
    const plan = await validPublicPlan();
    const manifest = {
      ...publicManifest(plan),
      publicRenderPlan: {
        ...plan,
        sourceRevision: "private canonical scene bytes",
      },
    };
    const archive = await archiveWithManifest(manifest, "shots/001/beauty.png");
    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive)).resolves.toBe(false);
    expect(plan.implementation.engineRevision).toBe("184");
    expect(plan.sourceDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("accepts a canonical v3 manifest only when its digest and requested inventory agree", async () => {
    const plan = await validPublicPlan();
    const manifest = publicManifest(plan);
    const archive = await archiveWithManifest(manifest, "shots/001/beauty.png");
    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive, {
      expected: {
        images: [{
          shotId: "shot-a",
          shotName: "첫 컷",
          width: 640,
          height: 360,
          pass: "beauty",
          requestedHeight: 360,
          wasReduced: false,
          png: new Blob([PNG], { type: "image/png" }),
        }],
        manifest: { publicRenderPlan: plan },
      },
    })).resolves.toBe(true);

    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive, {
      expected: {
        images: [{
          shotId: "shot-a",
          shotName: "첫 컷",
          width: 640,
          height: 360,
          pass: "tone",
          requestedHeight: 360,
          wasReduced: false,
          png: new Blob([PNG], { type: "image/png" }),
        }],
        manifest: { publicRenderPlan: plan },
      },
    })).resolves.toBe(false);
  });

  it("accepts the requested contact-sheet entry and exact caller inventory in v3", async () => {
    const plan = await validPublicPlan({ contactSheet: true });
    const contactSheet = {
      sheetNumber: 1,
      fileName: "contact-sheet-001.png",
      width: 640,
      height: 360,
      shotIds: ["shot-a"],
      png: new Blob([PNG], { type: "image/png" }),
    };
    const manifest = {
      ...publicManifest(plan),
      artifacts: [
        ...publicManifest(plan).artifacts,
        {
          kind: "contact-sheet",
          path: "contact/contact-sheet-001.png",
          sheetNumber: 1,
          width: 640,
          height: 360,
          shotIds: ["shot-a"],
          status: "completed",
          encoding: "srgb-opaque-rgb8",
        },
      ],
    };
    const archive = await buildStudioPackageArchiveBlob([
      { path: "manifest.json", data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      { path: "shots/001/beauty.png", data: PNG },
      { path: "contact/contact-sheet-001.png", data: PNG },
    ], {
      mimeType: "application/zip",
      crc32ExecutionMode: "direct-headless",
    });

    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive, {
      expected: {
        images: [{
          shotId: "shot-a",
          shotName: "첫 컷",
          width: 640,
          height: 360,
          pass: "beauty",
          requestedHeight: 360,
          wasReduced: false,
          png: new Blob([PNG], { type: "image/png" }),
        }],
        contactSheets: [contactSheet],
        manifest: { publicRenderPlan: plan },
      },
    })).resolves.toBe(true);
  });

  it("propagates caller cancellation instead of continuing entry CRC work", async () => {
    const archive = await archiveWithManifest(legacyManifest());
    const controller = new AbortController();
    controller.abort();
    await expect(verifyStudioBg3dShotBatchArchiveBlob(archive, {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });
});
