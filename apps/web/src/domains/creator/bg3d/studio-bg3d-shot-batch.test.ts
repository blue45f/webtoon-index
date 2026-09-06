import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
  STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
} from "./studio-bg3d-capture-adapter";
import { createStudioBg3dCaptureBackgroundSnapshot } from "./studio-bg3d-capture-background";
import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";
import {
  STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1,
  STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1,
  buildStudioBg3dShotBatchArchive as buildStudioBg3dShotBatchArchiveWithBackend,
  createStudioBg3dShotBatchPublicRenderPlan,
  isStudioBg3dShotBatchManifestContext,
  projectStudioBg3dShotBatchPlanForPublicArchive,
} from "./studio-bg3d-shot-batch";
import {
  STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
  STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
  STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
  createStudioBg3dShotBatchPlan,
  type StudioBg3dShotBatchPlan,
} from "./studio-bg3d-shot-batch-plan";
import { buildStudioBg3dShotLayeredPsd } from "./studio-bg3d-shot-psd";

function buildStudioBg3dShotBatchArchive(
  images: Parameters<typeof buildStudioBg3dShotBatchArchiveWithBackend>[0],
  options: NonNullable<Parameters<typeof buildStudioBg3dShotBatchArchiveWithBackend>[1]> = {},
): ReturnType<typeof buildStudioBg3dShotBatchArchiveWithBackend> {
  return buildStudioBg3dShotBatchArchiveWithBackend(images, {
    crc32ExecutionMode: "direct-headless",
    ...options,
  });
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function joinBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ (PNG_CRC_TABLE[(crc ^ byte) & 0xff] ?? 0);
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(Uint8Array.from(type, (value) => value.charCodeAt(0)), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, pngCrc(chunk.subarray(4, 8 + data.byteLength)), false);
  return chunk;
}

function adler32(bytes: Uint8Array): number {
  let first = 1;
  let second = 0;
  for (const byte of bytes) {
    first = (first + byte) % 65_521;
    second = (second + first) % 65_521;
  }
  return ((second << 16) | first) >>> 0;
}

function zlibStored(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const blockCount = Math.ceil(bytes.byteLength / 65_535);
  const output = new Uint8Array(2 + blockCount * 5 + bytes.byteLength + 4);
  const view = new DataView(output.buffer);
  output.set([0x78, 0x01]);
  let sourceOffset = 0;
  let outputOffset = 2;
  while (sourceOffset < bytes.byteLength) {
    const length = Math.min(65_535, bytes.byteLength - sourceOffset);
    output[outputOffset] = sourceOffset + length === bytes.byteLength ? 1 : 0;
    outputOffset += 1;
    view.setUint16(outputOffset, length, true);
    view.setUint16(outputOffset + 2, length ^ 0xffff, true);
    outputOffset += 4;
    output.set(bytes.subarray(sourceOffset, sourceOffset + length), outputOffset);
    sourceOffset += length;
    outputOffset += length;
  }
  view.setUint32(outputOffset, adler32(bytes), false);
  return output;
}

const pngFiles = new Map<string, ArrayBuffer>();

function pngHeader(width: number, height: number, colorType: 2 | 6 = 6): ArrayBuffer {
  const key = `${width}x${height}:${colorType}`;
  const cached = pngFiles.get(key);
  if (cached) return cached;
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr.set([8, colorType, 0, 0, 0], 8);
  const rowBytes = width * (colorType === 2 ? 3 : 4) + 1;
  const scanlines = new Uint8Array(rowBytes * height);
  const result = joinBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStored(scanlines)),
    pngChunk("IEND", new Uint8Array()),
  ]).buffer;
  pngFiles.set(key, result);
  return result;
}

const psdFiles = new Map<string, Blob>();

function psdHeader(width: number, height: number): Blob {
  const key = `${width}x${height}`;
  const cached = psdFiles.get(key);
  if (cached) return cached;
  const psd = buildStudioBg3dShotLayeredPsd([{
    role: "color",
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
  }]);
  psdFiles.set(key, psd);
  return psd;
}

function image(id: string, name = "컷 1") {
  return {
    shotId: id,
    shotName: name,
    width: 320,
    height: 180,
    png: new Blob([pngHeader(320, 180)], { type: "image/png" }),
  };
}

function plannedImage(
  id: string,
  name: string,
  pass: "beauty" | "depth",
) {
  return {
    shotId: id,
    shotName: name,
    width: 640,
    height: 360,
    pass,
    requestedHeight: 360,
    wasReduced: false,
    png: new Blob([pngHeader(640, 360)], { type: "image/png" }),
  } as const;
}

async function privatePlanV2(options: {
  readonly layeredPsd?: boolean;
  readonly contactSheet?: boolean;
} = {}): Promise<{ readonly plan: StudioBg3dShotBatchPlan; readonly sourceRevision: string }> {
  const passes = ["beauty", "depth"] as const;
  const sourceShots = [
    { id: "shot-a", name: "첫 컷" },
    { id: "shot-b", name: "둘째 컷" },
  ] as const;
  const sourceRevision = serializeStudioBg3dSceneDocument({
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    shots: sourceShots.map((shot) => ({
      ...shot,
      output: {
        exportHeight: 360,
        transparentBackground: true,
        line: { depthEnabled: true },
      },
    })),
  });
  if (!sourceRevision) throw new Error("canonical private Plan source unavailable");
  const background = createStudioBg3dCaptureBackgroundSnapshot({
    background: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.background,
    transparent: true,
  });
  const result = await createStudioBg3dShotBatchPlan(sourceShots, {
    sourceRevision,
    scope: {
      durability: "durable",
      authUserId: "private-user-7",
      workId: "private-work-8",
      pageId: "private-page-9",
      elementId: "private-element-10",
    },
    capture: {
      owner: {
        backend: "three-webgl",
        engineId: "three",
        engineRevision: "184",
        implementationRevision: STUDIO_BG3D_THREE_WEBGL_CAPTURE_IMPLEMENTATION_V1,
        graphicsApi: "webgl2",
        profileId: STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1,
        sourceWidth: 640,
        sourceHeight: 360,
        maxPixels: 8_388_608,
        maxEdge: 4_096,
        deviceProfile: "desktop",
        textureScale: 1,
        lodBias: 0,
        ltPipelineId: STUDIO_BG3D_SHOT_BATCH_LT_PIPELINE_V1,
        pngEncodingId: STUDIO_BG3D_SHOT_BATCH_PNG_ENCODING_V1,
        psdEncodingId: STUDIO_BG3D_SHOT_BATCH_PSD_ENCODING_V1,
      },
      shots: sourceShots.map((shot) => ({
        shotId: shot.id,
        width: 640,
        height: 360,
        requestedHeight: 360,
        wasReduced: false,
        includeDepth: true,
        shadows: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.quality.desktop.shadows,
        shadowMapSize: DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.quality.desktop.shadows
          ? DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.quality.desktop.shadowMapSize
          : 0,
        background: {
          color: background.clearColor,
          alpha: 0,
        },
      })),
    },
    passes,
    exportHeight: 360,
    layeredPsd: options.layeredPsd ?? false,
    contactSheet: options.contactSheet ?? false,
  });
  if (!result.ok) throw new Error(`private Plan fixture failed: ${result.code}`);
  return { plan: result.plan, sourceRevision };
}

describe("Studio BG3D shot batch archive", () => {
  it("writes deterministic numbered PNG paths and a bounded manifest", async () => {
    const onProgress = vi.fn();
    const blob = await buildStudioBg3dShotBatchArchive([
      image("shot-a", "첫 컷"),
      image("shot-b", "둘째 컷"),
    ], { onProgress });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const text = new TextDecoder().decode(bytes);

    expect(blob.type).toBe("application/zip");
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    expect(text).toContain("manifest.json");
    expect(text).toContain("shots/001.png");
    expect(text).toContain("shots/002.png");
    expect(text).toContain("toonspectrum-bg3d-shot-batch");
    expect(text).toContain('"output": "beauty"');
    expect(text).toContain("첫 컷");
    expect(onProgress).toHaveBeenLastCalledWith({ completedFiles: 3, totalFiles: 3 });
  });

  it("accepts canonical code-point-bounded emoji and ZWJ shot names", async () => {
    const astralName = "😀".repeat(80);
    await expect(buildStudioBg3dShotBatchArchive([image("shot-emoji", astralName)]))
      .resolves.toBeInstanceOf(Blob);
    await expect(buildStudioBg3dShotBatchArchive([image("shot-family", "가족 👨‍👩‍👧‍👦")]))
      .resolves.toBeInstanceOf(Blob);
  });

  it("writes a v2 multi-pass manifest with one directory per shot and explicit skipped artifacts", async () => {
    const blob = await buildStudioBg3dShotBatchArchive([
      { ...image("shot-a", "첫 컷"), pass: "beauty", requestedHeight: 1_440, wasReduced: true },
      { ...image("shot-a", "첫 컷"), pass: "main-line", requestedHeight: 1_440, wasReduced: true },
      { ...image("shot-b", "둘째 컷"), pass: "depth", requestedHeight: 1_440, wasReduced: true },
    ], {
      manifest: {
        resumeKey: "bg3d-batch-deadbeef",
        shots: [
          { id: "shot-a", name: "첫 컷" },
          { id: "shot-b", name: "둘째 컷" },
        ],
        requestedPasses: ["beauty", "main-line", "depth", "tone"],
        resolution: { mode: "maximum-height", height: 1_440 },
        skippedArtifacts: [
          { shotId: "shot-a", shotName: "첫 컷", pass: "depth", reason: "unavailable" },
          { shotId: "shot-a", shotName: "첫 컷", pass: "tone", reason: "disabled" },
          { shotId: "shot-b", shotName: "둘째 컷", pass: "beauty", reason: "disabled" },
          { shotId: "shot-b", shotName: "둘째 컷", pass: "main-line", reason: "disabled" },
          { shotId: "shot-b", shotName: "둘째 컷", pass: "tone", reason: "disabled" },
        ],
      },
    });
    const text = new TextDecoder().decode(await blob.arrayBuffer());

    expect(text).toContain('"version": 2');
    expect(text).toContain('"resumeKey": "bg3d-batch-deadbeef"');
    expect(text).toContain("shots/001/beauty.png");
    expect(text).toContain("shots/001/main-line.png");
    expect(text).toContain("shots/002/depth.png");
    expect(text).toContain('"status": "skipped"');
    expect(text).toContain('"reason": "disabled"');
    expect(text).toContain('"encoding": "normalized-device-depth-u8"');
    expect(text).toContain('"nearIs": "black"');
    expect(text).toContain('"mode": "maximum-height"');
    expect(text).toContain('"height": 1440');
  });

  it("writes a sanitized v3 public render plan without private Plan v2 recovery identity", async () => {
    const { plan: privatePlan, sourceRevision } = await privatePlanV2({
      layeredPsd: true,
      contactSheet: true,
    });
    const publicRenderPlan = await projectStudioBg3dShotBatchPlanForPublicArchive(privatePlan, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision,
    });
    const blob = await buildStudioBg3dShotBatchArchive([
      plannedImage("shot-b", "둘째 컷", "depth"),
      plannedImage("shot-a", "첫 컷", "depth"),
      plannedImage("shot-b", "둘째 컷", "beauty"),
      plannedImage("shot-a", "첫 컷", "beauty"),
    ], {
      manifest: {
        publicRenderPlan,
        psdFallbacks: [
          { shotId: "shot-b", shotName: "둘째 컷", reason: "budget" },
          { shotId: "shot-a", shotName: "첫 컷", reason: "unavailable" },
        ],
        contactSheetFallback: "worker-failed",
      },
    });
    const text = new TextDecoder().decode(await blob.arrayBuffer());

    expect(text).toContain('"version": 3');
    expect(text).toContain('"publicRenderPlan"');
    expect(text).toContain(`"sourceDigest": "${privatePlan.sourceDigest}"`);
    expect(text).toContain(`"renderDigest": "${privatePlan.planDigest}"`);
    expect(text).toContain('"engineId": "three"');
    expect(text).toContain('"engineRevision": "184"');
    expect(text).toContain('"adapterImplementationRevision": "studio-three-webgl-capture-adapter-v1"');
    expect(text).toContain('"graphicsApi": "webgl2"');
    expect(text).toContain('"backend": "three-webgl"');
    expect(text).toContain(`"profileId": "${STUDIO_BG3D_CAPTURE_PROFILE_RGBA8_DEPTH_V1}"`);
    expect(text).toContain(`"depthEncodingId": "${STUDIO_BG3D_SHOT_BATCH_DEPTH_ENCODING_V1}"`);
    expect(text).toContain('"psdProfileId": "psd-rgba8-layered-v1"');
    expect(text).toContain(
      `"contactSheetProfileId": "${STUDIO_BG3D_SHOT_BATCH_CONTACT_SHEET_PROFILE_V1}"`,
    );
    expect(text).toContain(`"archiveProfileId": "${STUDIO_BG3D_SHOT_BATCH_ARCHIVE_PROFILE_V1}"`);
    expect(text).toContain('"requestedHeight": 360');
    expect(text).toContain('"includeDepth": true');
    expect(text).toContain('"background"');
    expect(text).toContain('"layeredPsd": true');
    expect(text).toContain('"contactSheet": true');
    expect(text).toContain('"contactSheetFallback": "worker-failed"');
    expect(text.indexOf('"reason": "unavailable"'))
      .toBeLessThan(text.indexOf('"reason": "budget"'));
    expect(text.indexOf("shots/001/beauty.png"))
      .toBeLessThan(text.indexOf("shots/001/depth.png"));
    expect(text.indexOf("shots/001/depth.png"))
      .toBeLessThan(text.indexOf("shots/002/beauty.png"));

    for (const privateField of [
      '"scope"',
      '"scopeDigest"',
      '"recoveryDigest"',
      '"resumeKey"',
      '"authUserId"',
      '"workId"',
      '"pageId"',
      '"elementId"',
      '"key":',
    ]) {
      expect(text).not.toContain(privateField);
    }
    for (const privateValue of [
      privatePlan.scope.authUserId,
      privatePlan.scope.workId,
      privatePlan.scope.pageId,
      privatePlan.scope.elementId,
      privatePlan.scopeDigest,
      privatePlan.recoveryDigest,
      privatePlan.resumeKey,
      "PRIVATE_CANONICAL_SCENE_REVISION",
    ]) {
      expect(text).not.toContain(privateValue);
    }
    expect(Object.isFrozen(publicRenderPlan)).toBe(true);
    expect(Object.isFrozen(publicRenderPlan.shots[0]?.capture.background)).toBe(true);
  });

  it("canonicalizes the public builder but requires an exact canonical worker/archive schema", async () => {
    const { plan, sourceRevision } = await privatePlanV2();
    const projected = await projectStudioBg3dShotBatchPlanForPublicArchive(plan, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision,
    });
    const unordered = {
      ...projected,
      passes: [...projected.passes].reverse(),
      shots: [...projected.shots].reverse().map((shot) => ({
        ...shot,
        files: [...shot.files].reverse(),
      })),
    };
    const canonical = createStudioBg3dShotBatchPublicRenderPlan(unordered);
    expect(canonical.passes).toEqual(["beauty", "depth"]);
    expect(canonical.shots.map((shot) => shot.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(canonical.shots[0]?.files.map((file) => file.pass)).toEqual(["beauty", "depth"]);
    expect(isStudioBg3dShotBatchManifestContext({ publicRenderPlan: unordered })).toBe(false);
    expect(isStudioBg3dShotBatchManifestContext({ publicRenderPlan: canonical })).toBe(true);
    expect(isStudioBg3dShotBatchManifestContext({
      publicRenderPlan: { ...canonical, scopeDigest: "b".repeat(64) },
    })).toBe(false);
    expect(isStudioBg3dShotBatchManifestContext({
      publicRenderPlan: canonical,
      resumeKey: "bg3d-batch-deadbeef",
    })).toBe(false);
  });

  it("defensively snapshots public manifest metadata before the first Blob await", async () => {
    const { plan, sourceRevision } = await privatePlanV2();
    const projected = await projectStudioBg3dShotBatchPlanForPublicArchive(plan, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision,
    });
    const mutable = JSON.parse(JSON.stringify(projected)) as typeof projected;
    const archivePromise = buildStudioBg3dShotBatchArchive([
      plannedImage("shot-a", "첫 컷", "beauty"),
      plannedImage("shot-a", "첫 컷", "depth"),
      plannedImage("shot-b", "둘째 컷", "beauty"),
      plannedImage("shot-b", "둘째 컷", "depth"),
    ], { manifest: { publicRenderPlan: mutable } });
    (mutable.implementation as { appProfileId: string }).appProfileId = "private-late-work-id";
    (mutable.shots[0] as { shotName: string }).shotName = "늦게 바꾼 비공개 컷";

    const text = new TextDecoder().decode(await (await archivePromise).arrayBuffer());
    expect(text).toContain(STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1);
    expect(text).toContain("첫 컷");
    expect(text).not.toContain("private-late-work-id");
    expect(text).not.toContain("늦게 바꾼 비공개 컷");
  });

  it("rejects forged Plan digests and a source revision that does not own sourceDigest", async () => {
    const { plan, sourceRevision } = await privatePlanV2();
    const forged = { ...plan, planDigest: "c".repeat(64) };
    await expect(projectStudioBg3dShotBatchPlanForPublicArchive(forged, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision,
    })).rejects.toThrow("digest");

    const other = await privatePlanV2({ contactSheet: true });
    await expect(projectStudioBg3dShotBatchPlanForPublicArchive(plan, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision: other.sourceRevision.replace("첫 컷", "다른 컷"),
    })).rejects.toThrow("digest");
  });

  it("rehashes the public render identity at the final archive boundary", async () => {
    const { plan, sourceRevision } = await privatePlanV2();
    const projected = await projectStudioBg3dShotBatchPlanForPublicArchive(plan, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision,
    });
    const forged = { ...projected, renderDigest: "e".repeat(64) };
    expect(isStudioBg3dShotBatchManifestContext({ publicRenderPlan: forged })).toBe(true);

    await expect(buildStudioBg3dShotBatchArchive([
      plannedImage("shot-a", "첫 컷", "beauty"),
      plannedImage("shot-a", "첫 컷", "depth"),
      plannedImage("shot-b", "둘째 컷", "beauty"),
      plannedImage("shot-b", "둘째 컷", "depth"),
    ], { manifest: { publicRenderPlan: forged } })).rejects.toThrow("render digest");
  });

  it("pins public-only implementation and artifact profiles to manifest v3 semantics", async () => {
    const { plan, sourceRevision } = await privatePlanV2();
    const projected = await projectStudioBg3dShotBatchPlanForPublicArchive(plan, {
      appProfileId: STUDIO_BG3D_SHOT_BATCH_APP_IMPLEMENTATION_PROFILE_V1,
      sourceRevision,
    });
    const changedProfiles = [
      {
        ...projected,
        implementation: { ...projected.implementation, appProfileId: "different-app-v1" },
      },
      {
        ...projected,
        captureProfile: { ...projected.captureProfile, depthEncodingId: "different-depth-v1" },
      },
      {
        ...projected,
        artifactProfiles: {
          ...projected.artifactProfiles,
          contactSheetProfileId: "different-contact-v1",
        },
      },
      {
        ...projected,
        artifactProfiles: {
          ...projected.artifactProfiles,
          archiveProfileId: "different-archive-v1",
        },
      },
    ];

    for (const candidate of changedProfiles) {
      expect(() => createStudioBg3dShotBatchPublicRenderPlan(candidate)).toThrow();
      expect(isStudioBg3dShotBatchManifestContext({ publicRenderPlan: candidate })).toBe(false);
    }
  });

  it("records requested and actual height when a device budget reduces a v2 artifact", async () => {
    const blob = await buildStudioBg3dShotBatchArchive([{
      ...image("shot-a", "첫 컷"),
      pass: "beauty",
      width: 1_920,
      height: 1_080,
      requestedHeight: 2_160,
      wasReduced: true,
      png: new Blob([pngHeader(1_920, 1_080)], { type: "image/png" }),
    }], {
      crc32ExecutionMode: "direct-headless",
      manifest: {
        shots: [{ id: "shot-a", name: "첫 컷" }],
        requestedPasses: ["beauty"],
        resolution: { mode: "maximum-height", height: 2_160 },
      },
    });
    const text = new TextDecoder().decode(await blob.arrayBuffer());
    expect(text).toContain('"requestedHeight": 2160');
    expect(text).toContain('"wasReduced": true');
  });

  it("packages a bounded layered PSD beside PNG passes and records PSD fallback truthfully", async () => {
    const blob = await buildStudioBg3dShotBatchArchive([
      { ...image("shot-a", "첫 컷"), pass: "lt-composite" },
      { ...image("shot-b", "둘째 컷"), pass: "lt-composite" },
    ], {
      layeredPsds: [{
        shotId: "shot-a",
        shotName: "첫 컷",
        width: 320,
        height: 180,
        psd: new Blob([psdHeader(320, 180)], { type: "image/vnd.adobe.photoshop" }),
      }],
      manifest: {
        shots: [
          { id: "shot-a", name: "첫 컷" },
          { id: "shot-b", name: "둘째 컷" },
        ],
        requestedPasses: ["lt-composite"],
        layeredPsdRequested: true,
        psdFallbacks: [{
          shotId: "shot-b",
          shotName: "둘째 컷",
          reason: "budget",
        }],
      },
    });
    const text = new TextDecoder().decode(await blob.arrayBuffer());

    expect(text).toContain("shots/001/layers.psd");
    expect(text).toContain('"kind": "layered-psd"');
    expect(text).toContain('"encoding": "psd-v1-rle-rgba8"');
    expect(text).toContain('"reason": "budget"');
  });

  it("packages ordered contact sheets and records a truthful global fallback", async () => {
    const contactPng = new Blob([pngHeader(2_144, 1_064, 2)], { type: "image/png" });
    const blob = await buildStudioBg3dShotBatchArchive([
      { ...image("shot-a", "첫 컷"), pass: "lt-composite" },
      { ...image("shot-b", "둘째 컷"), pass: "lt-composite" },
    ], {
      crc32ExecutionMode: "direct-headless",
      contactSheets: [{
        sheetNumber: 1,
        fileName: "contact-sheet-001.png",
        width: 2_144,
        height: 1_064,
        shotIds: ["shot-a", "shot-b"],
        png: contactPng,
      }],
      manifest: {
        shots: [
          { id: "shot-a", name: "첫 컷" },
          { id: "shot-b", name: "둘째 컷" },
        ],
        requestedPasses: ["lt-composite"],
        contactSheetRequested: true,
      },
    });
    const text = new TextDecoder().decode(await blob.arrayBuffer());

    expect(text).toContain("contact/contact-sheet-001.png");
    expect(text).toContain('"kind": "contact-sheet"');
    expect(text).toContain('"encoding": "srgb-opaque-rgb8"');
    expect(text).toContain('"shotIds"');
    expect(text).toContain('"contactSheetFallback": null');

    const fallbackBlob = await buildStudioBg3dShotBatchArchive([
      { ...image("shot-a", "첫 컷"), pass: "beauty" },
    ], {
      manifest: {
        shots: [{ id: "shot-a", name: "첫 컷" }],
        requestedPasses: ["beauty"],
        contactSheetRequested: true,
        contactSheetFallback: "unavailable",
      },
    });
    expect(new TextDecoder().decode(await fallbackBlob.arrayBuffer()))
      .toContain('"contactSheetFallback": "unavailable"');
  });

  it("runs full PNG integrity for final contact-sheet packaging", async () => {
    const corrupted = new Uint8Array(pngHeader(320, 180, 2).slice(0));
    corrupted[29] = (corrupted[29] ?? 0) ^ 1;
    await expect(buildStudioBg3dShotBatchArchive([image("shot-a", "첫 컷")], {
      manifest: {
        shots: [{ id: "shot-a", name: "첫 컷" }],
        contactSheetRequested: true,
      },
      contactSheets: [{
        sheetNumber: 1,
        fileName: "contact-sheet-001.png",
        width: 320,
        height: 180,
        shotIds: ["shot-a"],
        png: new Blob([corrupted], { type: "image/png" }),
      }],
    })).rejects.toThrow(/CRC/iu);
  });

  it("rejects duplicate ids, unsafe names, MIME mismatches, and forged PNG bytes", async () => {
    await expect(buildStudioBg3dShotBatchArchive([
      image("shot-a"), image("shot-a"),
    ])).rejects.toThrow(/중복/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "beauty" },
      { ...image("shot-a"), pass: "beauty" },
    ])).rejects.toThrow(/중복/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      image("shot-a", "https://unsafe.invalid"),
    ])).rejects.toThrow(/안전한 형식/iu);
    await expect(buildStudioBg3dShotBatchArchive([{
      ...image("shot-a"),
      png: new Blob([pngHeader(320, 180)], { type: "image/jpeg" }),
    }])).rejects.toThrow(/안전한 형식/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "beauty" },
      { ...image("shot-a"), pass: "depth", width: 321 },
    ])).rejects.toThrow(/해상도/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "beauty" },
    ], {
      manifest: {
        shots: [{ id: "shot-a", name: "컷 1" }],
        requestedPasses: ["beauty", "depth"],
      },
    })).rejects.toThrow(/완료 또는 생략/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "depth" },
    ], {
      manifest: {
        shots: [{ id: "shot-a", name: "컷 1" }],
        requestedPasses: ["beauty"],
      },
    })).rejects.toThrow(/요청 패스/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "beauty" },
    ], {
      layeredPsds: [{
        shotId: "shot-a",
        shotName: "컷 1",
        width: 321,
        height: 180,
        psd: new Blob([psdHeader(321, 180)], { type: "image/vnd.adobe.photoshop" }),
      }],
    })).rejects.toThrow(/PSD와 PNG pass 해상도/iu);
    await expect(buildStudioBg3dShotBatchArchive([{
      ...image("shot-a"),
      png: new Blob([new Uint8Array(24)], { type: "image/png" }),
    }])).rejects.toThrow(/signature|IHDR/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "beauty" },
    ], {
      manifest: {
        resumeKey: "unsafe",
      },
    })).rejects.toThrow(/resume key/iu);
    await expect(buildStudioBg3dShotBatchArchive([
      { ...image("shot-a"), pass: "beauty" },
    ], {
      layeredPsds: [{
        shotId: "shot-a",
        shotName: "컷 1",
        width: 320,
        height: 180,
        psd: new Blob([new Uint8Array(26)], { type: "image/vnd.adobe.photoshop" }),
      }],
    })).rejects.toThrow(/signature/iu);
    await expect(buildStudioBg3dShotBatchArchive([{
      ...image("shot-a"),
      pass: "beauty",
      requestedHeight: 1_080,
      wasReduced: false,
    }])).rejects.toThrow(/안전한 형식/iu);
  });

  it("honors cancellation before allocating the archive", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildStudioBg3dShotBatchArchive(
      [image("shot-a")],
      { signal: controller.signal },
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
