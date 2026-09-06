import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { STUDIO_VRM_POSER_IMPLEMENTATION_FILES } from "./studio-vrm-poser-implementation-source";

const POSER_PATHS = STUDIO_VRM_POSER_IMPLEMENTATION_FILES.map((file) =>
  fileURLToPath(new URL(file, import.meta.url)),
);
const MODEL_LOADING_PATH = fileURLToPath(
  new URL("./use-studio-vrm-model-loading.ts", import.meta.url),
);
const PREVIEW_PATH = fileURLToPath(
  new URL("./StudioVrmBroadcastPreview.tsx", import.meta.url),
);
const PLANNER_PATH = fileURLToPath(
  new URL("./studio-vrm-broadcast-preview.ts", import.meta.url),
);

async function readPoser(): Promise<string> {
  const parts = await Promise.all([
    readFile(fileURLToPath(new URL("./StudioVrmPoserTypes.ts", import.meta.url)), "utf8"),
    ...POSER_PATHS.map((path) => readFile(path, "utf8")),
  ]);
  return parts.join("\n");
}

describe("Studio VRM broadcast preview product boundary", () => {
  it("reuses the single poser Canvas and contains no recorder, stream, or renderer substitute", async () => {
    const [poser, preview] = await Promise.all([
      readPoser(),
      readFile(PREVIEW_PATH, "utf8"),
    ]);

    expect(poser.match(/<Canvas\b/gu)).toHaveLength(1);
    expect(poser).toContain("<StudioVrmBroadcastPreviewBridge");
    expect(poser).toContain("environmentRef={envRootRef}");
    expect(poser).toContain("groundRef={groundShadowRef}");
    expect(preview).toContain("useThree((state) => state.gl)");
    expect(`${poser}\n${preview}`).not.toMatch(
      /new\s+THREE\.WebGLRenderer|MediaRecorder|getDisplayMedia|captureStream|obs-websocket|@babylonjs/iu,
    );
  });

  it("makes editor chrome inert and unreachable while preserving explicit button and Escape exits", async () => {
    const [poser, preview] = await Promise.all([
      readPoser(),
      readFile(PREVIEW_PATH, "utf8"),
    ]);

    expect(poser).toContain("inert={broadcastPreviewActive ? true : undefined}");
    expect(poser).toContain("hidden={broadcastPreviewActive}");
    expect(poser).toContain("if (broadcastPreviewActive) {");
    expect(poser).toContain("requestBroadcastPreviewExit();");
    expect(poser).toContain("broadcastExitButtonRef.current?.focus");
    expect(preview).toContain('aria-label="방송 미리보기 종료"');
    expect(preview).toContain('aria-keyshortcuts="Escape"');
  });

  it("fails closed across upload, save, capture, paint, pose, and tracking transaction families", async () => {
    const poser = await readPoser();
    const blockerStart = poser.indexOf("function currentBroadcastPreviewBlockers()");
    const blockerEnd = poser.indexOf(
      "const broadcastPreviewAvailability",
      blockerStart,
    );
    const blockerSource = poser.slice(blockerStart, blockerEnd);

    expect(blockerStart).toBeGreaterThan(-1);
    expect(blockerEnd).toBeGreaterThan(blockerStart);
    expect(poser).toContain('blockers.push("asset-mutation")');
    expect(poser).toContain('blockers.push("capture")');
    expect(poser).toContain('blockers.push("creative-persistence")');
    expect(poser).toContain('blockers.push("texture-paint")');
    expect(poser).toContain('blockers.push("pose-transaction")');
    expect(blockerSource).toContain(
      'if (webcamActive || webcamLoading || calibrating) blockers.push("tracking-transition")',
    );
    expect(poser).toContain("if (broadcastPreviewActive || isCapturing");
    expect(poser).toContain("if (broadcastPreviewActive || vrmCreativeReadOnly) return;");
    // 2026-08-21 의도적 변경: handleFileChange 가 use-studio-vrm-model-loading.ts 로 분리됐다.
    const modelLoading = await readFile(MODEL_LOADING_PATH, "utf8");
    expect(modelLoading).toContain("if (broadcastPreviewActive) {\n      event.currentTarget.value");
    expect(poser).toContain("|| status !== \"ready\"\n      || broadcastPreviewActive");
  });

  it("rejects an active tracking session without stopping or restarting the user's camera", async () => {
    const poser = await readPoser();
    const startHandlerStart = poser.indexOf("function handleBroadcastPreviewStart()");
    const startHandlerEnd = poser.indexOf(
      "function handleBroadcastPreviewRuntimeError",
      startHandlerStart,
    );
    const startHandlerSource = poser.slice(startHandlerStart, startHandlerEnd);

    expect(startHandlerStart).toBeGreaterThan(-1);
    expect(startHandlerEnd).toBeGreaterThan(startHandlerStart);
    expect(startHandlerSource).toContain("blockers: currentBroadcastPreviewBlockers()");
    expect(startHandlerSource).not.toContain("setWebcamActive(");
    expect(startHandlerSource).not.toContain("getTracks(");
    expect(startHandlerSource).not.toContain("track.stop(");
  });

  it("restores exact camera and mutation locks and keeps the preview out of canonical state", async () => {
    const poser = await readPoser();

    expect(poser).toContain("function restoreStudioVrmBroadcastImperativeState");
    expect(poser).toContain("cameraLease.restoreCamera(cameraLease.settings)");
    expect(poser).toContain("broadcastCameraLeaseRef.current = Object.freeze");
    expect(poser.match(/restoreStudioVrmBroadcastImperativeState\(\{/gu)).toHaveLength(2);
    expect(poser).toContain("broadcastMutationLockSnapshotRef.current = Object.freeze");
    expect(poser).toContain("texturePaintMutationBlockedRef.current = mutationSnapshot.texturePaint");
    expect(poser).toContain("wardrobeMutationBlockedRef.current = mutationSnapshot.wardrobe");
    expect(poser).toContain("useLayoutEffect(() => {\n    return () => {");
    expect(poser).not.toMatch(/render:\s*\{[\s\S]{0,300}broadcast/iu);
    const canonicalSceneStart = poser.indexOf("const normalized = normalizeStudioVrmSceneDocument({");
    const canonicalSceneEnd = poser.indexOf(
      "const serialized = serializeStudioVrmSceneDocument(normalized);",
      canonicalSceneStart,
    );
    expect(canonicalSceneStart).toBeGreaterThan(-1);
    expect(canonicalSceneEnd).toBeGreaterThan(canonicalSceneStart);
    expect(poser.slice(canonicalSceneStart, canonicalSceneEnd)).not.toMatch(/broadcast/iu);
  });

  it("leases the chroma renderer pre-paint and restores the editor DPR policy on exit", async () => {
    const [poser, preview] = await Promise.all([
      readPoser(),
      readFile(PREVIEW_PATH, "utf8"),
    ]);

    expect(preview).toContain("useLayoutEffect(() => {");
    expect(preview).not.toContain("useEffect(() => {");
    expect(preview).toContain("result.lease.release()");
    expect(poser).toContain("ref={broadcastViewportHostRef}");
    expect(poser).toContain("const observer = new ResizeObserver");
    expect(poser).toContain("entry.contentRect.width");
    expect(poser).toContain("requestedDpr: window.devicePixelRatio");
    expect(poser).toContain(
      "dpr={broadcastPreviewActive ? broadcastCanvasDpr : [1, 2]}",
    );
    const preflightIndex = poser.indexOf("const framebufferPreflight = planStudioVrmBroadcastFramebuffer");
    const dprPublishIndex = poser.indexOf(
      "setBroadcastCanvasDpr(framebufferPreflight.receipt.dpr)",
      preflightIndex,
    );
    const activePublishIndex = poser.indexOf(
      "setBroadcastPreviewReceipt(plan.receipt)",
      preflightIndex,
    );
    expect(preflightIndex).toBeGreaterThan(-1);
    expect(poser.slice(preflightIndex, dprPublishIndex)).toContain("if (!framebufferPreflight.ok)");
    expect(dprPublishIndex).toBeGreaterThan(preflightIndex);
    expect(activePublishIndex).toBeGreaterThan(dprPublishIndex);
  });

  it("admits the actual broadcast framebuffer with a conservative 64 MiB bound", async () => {
    const planner = await readFile(PLANNER_PATH, "utf8");

    expect(planner).toContain(
      "STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES = 64 * 1024 * 1024",
    );
    expect(planner).toContain(
      "STUDIO_VRM_BROADCAST_FRAMEBUFFER_ESTIMATED_BYTES_PER_PIXEL = 48",
    );
    expect(planner).toContain("input.cssWidth < STUDIO_VRM_BROADCAST_FRAMEBUFFER_MIN_CSS_EDGE");
    expect(planner).toContain("input.cssWidth > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_CSS_EDGE");
    expect(planner).toContain("Number.isSafeInteger(estimatedBytes)");
    expect(planner).toContain("estimatedBytes > STUDIO_VRM_BROADCAST_FRAMEBUFFER_MAX_BYTES");
    expect(planner).not.toMatch(/dpr\s*:\s*1(?:\D|$)/u);
  });
});
