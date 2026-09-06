import { describe, expect, it } from "vitest";

import inferenceSource from "./studio-vrm-avatar-reference-inference.ts?raw";
import recommendationSource from "./studio-vrm-avatar-reference-recommendation.ts?raw";
import workerSource from "./studio-vrm-avatar-reference.worker.ts?raw";
import panelSource from "./StudioVrmAvatarReferenceRecommendationsPanel.tsx?raw";

describe("Avatar Forge reference recommendation clean-room boundary", () => {
  it("uses only the installed official MediaPipe ImageEmbedder and its cosine authority", () => {
    expect(workerSource).toContain("ImageEmbedder.createFromOptions");
    expect(workerSource).toContain("ImageEmbedder.cosineSimilarity");
    expect(workerSource).toContain('owner: "vrm-avatar-reference-image"');
    expect(workerSource).toContain('runningMode: "IMAGE"');
    expect(workerSource).toContain('delegate: "CPU"');
    expect(recommendationSource).not.toMatch(/\b(?:face|skin|hairColor|dominantColor|pixelAverage)\b/iu);
  });

  it("pins and verifies the official model bytes before Task creation", () => {
    expect(recommendationSource).toContain("STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH = 4_117_670");
    expect(recommendationSource).toContain(
      "bbbb4c51a55a53905af1daec995ca1aae355046f8839bb8c9f5ce9271394bc40",
    );
    expect(workerSource).toContain("createSha256Portable");
    expect(workerSource).toContain("sha256HexPortable");
    expect(workerSource).toContain("STUDIO_VRM_AVATAR_REFERENCE_MODEL_FETCH_TIMEOUT_MS");
    expect(workerSource.indexOf("hasher.finalizeHex()"))
      .toBeLessThan(workerSource.indexOf("ImageEmbedder.createFromOptions"));
    expect(workerSource.indexOf("bytes.byteLength !== STUDIO_VRM_AVATAR_REFERENCE_MODEL_BYTE_LENGTH"))
      .toBeLessThan(workerSource.indexOf("ImageEmbedder.createFromOptions"));
    expect(workerSource).toContain("modelAssetBuffer");
    expect(workerSource).not.toContain("modelAssetPath");
  });

  it("keeps sync embedding in a dedicated Worker and preprocesses through the existing bounded Worker", () => {
    expect(inferenceSource).toContain(
      'new Worker(new URL("./studio-vrm-avatar-reference.worker.ts", import.meta.url)',
    );
    expect(inferenceSource).toContain('type: "module"');
    expect(inferenceSource).toContain("official module WASM loader");
    expect(inferenceSource).toContain("new StudioVrmPhotoPosePreprocessor()");
    expect(inferenceSource).toContain("maxOutputDimension: STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputDimension");
    expect(inferenceSource).toContain("maxOutputPixels: STUDIO_VRM_AVATAR_REFERENCE_LIMITS.maxOutputPixels");
    expect(workerSource).toContain("embedder.embed(request.bitmap)");
    expect(panelSource).not.toContain("embed(");
    expect(panelSource).not.toContain("createImageBitmap");
  });

  it("locks inference egress before loading MediaPipe and uses only official module assets", () => {
    expect(workerSource).toContain(
      '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url',
    );
    expect(workerSource).toContain(
      '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url',
    );
    expect(workerSource).not.toContain("resolveStudioMediaPipeVisionWasmFileset");
    expect(workerSource).toContain("installStudioVrmAvatarReferenceEgressPolicy");
    expect(workerSource.indexOf("installStudioVrmAvatarReferenceEgressPolicy();"))
      .toBeLessThan(workerSource.indexOf("loadStudioMediaPipeVisionModule()"));
    expect(workerSource).toContain("allowedFetchUrls");
    expect(workerSource).toContain("STUDIO_VRM_AVATAR_REFERENCE_MODEL_URL");
    expect(workerSource).toContain("response.redirected");
    expect(workerSource).toContain('requestMethod(input, init) !== "GET"');
    expect(workerSource).toContain("Never forward caller-controlled headers");
    expect(workerSource).toContain("propertyOwner");
    expect(workerSource).toContain("WorkerGlobalScope.prototype.fetch/importScripts");
    expect(workerSource).toContain('credentials: "omit"');
    expect(workerSource).toContain('redirect: "error"');
    expect(workerSource).toContain('referrerPolicy: "no-referrer"');
    expect(workerSource).not.toContain("nativeFetch(input, init)");
    for (const blockedGlobal of [
      "EventSource",
      "FontFace",
      "CacheStorage",
      "SharedWorker",
      "WebSocket",
      "WebTransport",
      "Worker",
      "XMLHttpRequest",
      "importScripts",
      "sendBeacon",
      "fonts",
    ]) {
      expect(workerSource).toContain(blockedGlobal);
    }
  });

  it("keeps reference bytes ephemeral and requires explicit preview/apply callbacks", () => {
    expect(panelSource).toContain("onPreview");
    expect(panelSource).toContain("onApply");
    expect(panelSource).toContain("추천은 자동 적용되지 않습니다");
    expect(panelSource).not.toMatch(/localStorage|indexedDB|showSaveFilePicker|FileSystem|fetch\(/u);
    expect(inferenceSource).not.toMatch(/localStorage|indexedDB|showSaveFilePicker|FileSystem/u);
    expect(workerSource).not.toMatch(/localStorage|indexedDB|showSaveFilePicker|FileSystem/u);
  });

  it("does not couple this seam to shared Studio/VRM editor surfaces", () => {
    const combined = [recommendationSource, workerSource, inferenceSource, panelSource].join("\n");
    expect(combined).not.toMatch(/StudioPage|StudioBackground3D|StudioVrmPoser|StudioVrmBroadcast|StudioMannequin/u);
  });
});
