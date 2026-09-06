import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const editorSource = readStudioBg3dEditorSource();
const encoderSource = readFileSync(
  new URL("./studio-bg3d-lt-layer-encoder.ts", import.meta.url),
  "utf8",
);

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = editorSource.indexOf(startMarker);
  const end = editorSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return editorSource.slice(start, end);
}

describe("Studio BG3D interactive LT Worker boundary", () => {
  it("snapshots capture settings and runs LT detection in the existing bounded Worker", () => {
    const insert = sourceBetween(
      "async function handleInsert()",
      "// 선택된 것이 도형(primitives)인지",
    );
    const snapshot = insert.indexOf("const ltSettingsSnapshot: StudioBg3dLtRenderSettings");
    const capture = insert.indexOf("const captured = await captureStudioBg3dRaster(");
    const worker = insert.indexOf("await renderStudioBg3dLtLayersInWorker(");
    const encode = insert.indexOf("const encoded = encodeStudioBg3dLtLayers(rendered.layers)");
    const publish = insert.indexOf("const accepted = await onInsert({");

    expect(editorSource).toContain('from "./studio-bg3d-lt-render-worker-client"');
    expect(snapshot).toBeGreaterThanOrEqual(0);
    expect(capture).toBeGreaterThan(snapshot);
    expect(worker).toBeGreaterThan(capture);
    expect(encode).toBeGreaterThan(worker);
    expect(publish).toBeGreaterThan(encode);
    expect(insert).toContain("line: Object.freeze({ ...adapted.document.output.line })");
    expect(insert).toContain("tone: Object.freeze({ ...adapted.document.output.tone })");
    expect(insert).toContain("signal: insertController.signal");
    expect(insert).toContain("timeoutMs: STUDIO_BG3D_LT_INSERT_WORKER_TIMEOUT_MS");
  });

  it("fails closed when the selected LT Worker is unavailable", () => {
    const insert = sourceBetween(
      "async function handleInsert()",
      "// 선택된 것이 도형(primitives)인지",
    );

    expect(editorSource).not.toContain("STUDIO_BG3D_LT_INSERT_SYNC_FALLBACK_MAX_PIXELS");
    expect(insert).not.toContain('workerFailure.code === "worker-unavailable"');
    expect(insert).not.toContain("renderStudioBg3dLtLayers(ltRenderInput, ltSettingsSnapshot)");
    expect(insert.match(/renderStudioBg3dLtLayersInWorker\(/gu)).toHaveLength(1);
    expect(insert).toContain('insertFailure.code === "timeout"');
    expect(insert).toContain("LT 처리 작업을 안전하게 완료하지 못했습니다.");
  });

  it("fences close, unmount, scene replacement, adapter replacement, and stale completions", () => {
    const insert = sourceBetween(
      "async function handleInsert()",
      "// 선택된 것이 도형(primitives)인지",
    );
    const sessionLifecycle = sourceBetween(
      "useLayoutEffect(() => {\n    if (!open) return;\n    const session =",
      "useLayoutEffect(() => {\n    const previous = shotBatchRecoveryScopeRef.current",
    );
    const invalidation = sourceBetween(
      "function invalidateModalAssetSession(): void",
      "const handleViewportReady",
    );
    const capture = insert.indexOf("const captured = await captureStudioBg3dRaster(");
    const worker = insert.indexOf("await renderStudioBg3dLtLayersInWorker(");
    const encode = insert.indexOf("const encoded = encodeStudioBg3dLtLayers(rendered.layers)");
    const publish = insert.indexOf("const accepted = await onInsert({");
    const adapterFence = "if (!isInsertCurrent() || captureAdapterIsStale()) return;";
    const afterCaptureFence = insert.indexOf(adapterFence, capture);
    const afterWorkerFence = insert.indexOf(adapterFence, worker);
    const afterEncodeFence = insert.indexOf(adapterFence, encode);

    expect(insert).toContain("const insertController = new AbortController()");
    expect(insert).toContain("const insertSceneEpoch = ltInsertSceneEpochRef.current");
    expect(insert).toContain("ltInsertAbortRef.current === insertController");
    expect(insert).toContain("ltInsertSceneEpochRef.current === insertSceneEpoch");
    expect(insert).toContain("isModalAssetSessionCurrent(session)");
    expect(insert).toContain(
      "const captureAdapterIsStale = () => captureRef.current.adapter !== captureAdapter;",
    );
    expect(insert.match(/captureAdapterIsStale\(\)/gu)?.length ?? 0)
      .toBeGreaterThanOrEqual(7);
    expect(afterCaptureFence).toBeGreaterThan(capture);
    expect(afterCaptureFence).toBeLessThan(worker);
    expect(afterWorkerFence).toBeGreaterThan(worker);
    expect(afterWorkerFence).toBeLessThan(encode);
    expect(afterEncodeFence).toBeGreaterThan(encode);
    expect(afterEncodeFence).toBeLessThan(publish);
    expect(insert).toContain("const ownsCurrentInsert =");
    expect(insert).toContain("modalAssetSessionRef.current === session");
    expect(insert).toContain("if (ownsCurrentInsert && componentActiveRef.current)");
    expect(sessionLifecycle).toContain("ltInsertAbortRef.current?.abort()");
    expect(sessionLifecycle).toContain("[customModels, primitives, sceneBaseDocument]");
    expect(sessionLifecycle).toContain("if (open) return;");
    expect(sessionLifecycle).toContain("captureInFlightRef.current = false;");
    expect(sessionLifecycle).toContain("setCaptureBackgroundSnapshot(null)");
    expect(sessionLifecycle).toContain("setIsCapturing(false)");
    expect(sessionLifecycle).toContain("setLineArtPreview(restoreLineArtPreview)");
    expect(invalidation).toContain("ltInsertAbortRef.current?.abort()");
    expect(insert).toContain("장면·선택 또는 출력 설정이 변경되어 LT 변환을 취소했습니다.");
  });

  it("keeps optional Magic Layer capture in the same frame and the same atomic insert", () => {
    const insert = sourceBetween(
      "async function handleInsert()",
      "// 선택된 것이 도형(primitives)인지",
    );
    const resolveSelection = insert.indexOf("resolveStudioBg3dMagicSelection({");
    const captureFrameCamera = insert.indexOf(
      "const captureFrameCameraSettings =",
    );
    const ltWorker = insert.indexOf("await renderStudioBg3dLtLayersInWorker(");
    const objectIds = insert.indexOf("await captureStudioBg3dMagicObjectIds({");
    const buildMask = insert.indexOf("buildStudioBg3dMagicFilterMask({");
    const encodeMask = insert.indexOf(
      "await encodeStudioBg3dMagicMaskPngDataUrl({",
    );
    const encodeLt = insert.indexOf("const encoded = encodeStudioBg3dLtLayers(rendered.layers)");
    const publish = insert.indexOf("const accepted = await onInsert({");

    expect(resolveSelection).toBeGreaterThanOrEqual(0);
    expect(captureFrameCamera).toBeGreaterThan(resolveSelection);
    expect(ltWorker).toBeGreaterThan(captureFrameCamera);
    expect(objectIds).toBeGreaterThan(ltWorker);
    expect(buildMask).toBeGreaterThan(objectIds);
    expect(encodeMask).toBeGreaterThan(buildMask);
    expect(encodeLt).toBeGreaterThan(encodeMask);
    expect(publish).toBeGreaterThan(encodeLt);
    expect(insert).toContain("const magicSelectionEpoch = ltMagicSelectionEpochRef.current");
    expect(insert).toContain(
      "ltMagicSelectionEpochRef.current === magicSelectionEpoch",
    );
    expect(insert).toContain(
      "selectedIdsRef.current.has(magicSelectionSnapshot.selectedId)",
    );
    expect(insert).toContain("camera: captureFrameCameraSettings");
    expect(insert).toContain("width: rendered.width");
    expect(insert).toContain("height: rendered.height");
    expect(insert).toContain(
      "createRuntime: ({ backend, canvas, capabilities, settings }) =>",
    );
    expect(insert).toContain(
      "capabilities !== STUDIO_BG3D_MAGIC_OBJECT_ID_RUNTIME_CAPABILITIES",
    );
    expect(insert).toContain("capabilities,");
    expect(insert).toContain("bg3dScene: adapted.document");
    expect(insert).toContain("...(magicFilterMask ? { magicFilterMask } : {})");
    expect(insert).toContain(
      'layer.role === "color" || layer.role === "tone"',
    );
    expect(insert).toContain(
      "operation,",
    );
    expect(editorSource).toContain('operation = "insert"');
    expect(editorSource).not.toContain(
      'operation: initialScene || initialDataUrl ? "update" : "insert"',
    );
  });

  it("keeps PNG data-URL encoding as an explicit main-thread compatibility boundary", () => {
    expect(editorSource).toContain(
      'encodeStudioBg3dLtLayers } from "./studio-bg3d-lt-layer-encoder"',
    );
    expect(editorSource).toContain(
      "const encoded = encodeStudioBg3dLtLayers(rendered.layers)",
    );
    expect(editorSource).not.toContain("function encodeStudioBg3dLtLayers(");
    expect(encoderSource).toContain("intentionally remains on the main thread");
    expect(encoderSource).toContain('document.createElement("canvas")');
    expect(encoderSource).toContain('canvas.toDataURL("image/png")');
    expect(encoderSource).not.toContain("TODO");
  });
});
