import { readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// 2026-08-21 intentional change: the model import/delete handlers moved into
// studio-bg3d-editor-model-import-actions.ts (editor split); their markers resolve there.
import { readStudioBg3dEditorSource } from "./read-studio-bg3d-editor-source";

const sourceFiles = [
  {
    file: ts.createSourceFile(
      "studio-bg3d-editor-combined.tsx",
      readStudioBg3dEditorSource(),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
    text: readStudioBg3dEditorSource(),
  },
  ...[
    "./studio-bg3d-editor-model-import-actions.ts",
    "./StudioBg3dShapesPanel.tsx",
    "./StudioBg3dViewPanelContent.tsx",
    "./StudioBg3dLtPanel.tsx",
  ].map((fileName) => {
    const fileUrl = new URL(fileName, import.meta.url);
    const text = readFileSync(fileUrl, "utf8");
    return {
      file: ts.createSourceFile(
        fileUrl.pathname,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
      text,
    };
  }),
];
const source = sourceFiles.map(({ text }) => text).join("\n");

function functionSource(name: string): string {
  for (const { file } of sourceFiles) {
    let match: ts.FunctionDeclaration | null = null;
    function visit(node: ts.Node): void {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
        match = node;
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    if (match) return (match as ts.FunctionDeclaration).getText(file);
  }
  throw new Error(`Missing function ${name}`);
}

function expectInOrder(haystack: string, needles: readonly string[]): void {
  let cursor = -1;
  for (const needle of needles) {
    const index = haystack.indexOf(needle, cursor + 1);
    expect(index, `Expected ${JSON.stringify(needle)} after ${cursor}`).toBeGreaterThan(cursor);
    cursor = index;
  }
}

describe("Studio BG3D imported-model thumbnail integration boundary", () => {
  it("keeps capture and isolated Three thumbnail runtimes behind the post-import lazy boundary", () => {
    const loader = functionSource("loadStudioBg3dModelThumbnailRuntime");
    const capture = functionSource("startModelThumbnailCaptureBatch");

    expect(source).toContain("StudioBg3dModelThumbnailCaptureController");
    expect(source).toContain('"./studio-bg3d-model-thumbnail-capture"');
    expect(source).toContain("StudioBg3dModelThumbnailThreeCaptureHandle");
    expect(source).toContain('"./studio-bg3d-model-thumbnail-three-capture"');
    expect(loader).toContain('import("./studio-bg3d-model-thumbnail-capture")');
    expect(loader).toContain('import("./studio-bg3d-model-thumbnail-three-capture")');
    expect(loader).toContain("Promise.all([");
    expect(loader).toContain("studioBg3dModelThumbnailRuntimePromise = null");
    expectInOrder(capture, [
      "await loadStudioBg3dModelThumbnailRuntime()",
      "if (!isCurrent()) return",
      "getModelThumbnailCaptureController(",
      "for (const record of records)",
    ]);
  });

  it("loads the model conversion runtime only after a user selects files and fences the await", () => {
    const upload = functionSource("handleUploadModelFiles");

    expect(source).toContain(
      'import type { StudioBg3dImportProgress } from "./studio-bg3d-model-import";',
    );
    expect(source).not.toContain("import {\n  convertStudioBg3dModelFilesToGlb,");
    expectInOrder(upload, [
      'modelImportRuntime = await import("./studio-bg3d-model-import")',
      "if (!isModalAssetSessionCurrent(session))",
      "if (importController.signal.aborted)",
      "modelImportRuntime.convertStudioBg3dModelFilesToGlb(files,",
    ]);
    expect(upload).toContain(
      "importFailure instanceof modelImportRuntime.StudioBg3dModelImportError",
    );
  });

  it("commits import and scene placement before starting best-effort thumbnail work", () => {
    const upload = functionSource("handleUploadModelFiles");

    expectInOrder(upload, [
      "await importVerifiedBg3dModelsAtomically",
      "await studioBg3dModalOperationCoordinator.runSceneMutation(",
      "uploadCommitted = true",
      "thumbnailCandidates = saved",
      "} finally {",
      "if (!uploadCommitted) cleanupUncommittedUploadCache()",
      "setIsUploadingModel(false)",
      "if (uploadCommitted && thumbnailCandidates.length > 0)",
      "startModelThumbnailCaptureBatch(thumbnailCandidates, session)",
    ]);
    expect(upload.indexOf("startModelThumbnailCaptureBatch")).toBeGreaterThan(
      upload.lastIndexOf("} catch (importFailure)"),
    );
  });

  it("passes only the cache-owned root into an isolated handle and always disposes it", () => {
    const capture = functionSource("startModelThumbnailCaptureBatch");

    expect(capture).toContain("const cachedEntry = modelRootCacheRef.current.get(record.id)");
    expect(capture).toContain("cachedRoot: cachedEntry.root");
    expect(capture).toContain("await thumbnailCaptureController.captureAndStore({");
    expect(capture).toContain("storageModelId: record.id");
    expect(capture).toContain("signal: batchController.signal");
    expect(capture).toContain("} finally {");
    expect(capture).toContain("modelThumbnailGpuLeaseRef.current?.release()");
    expect(capture).toContain("captureHandle?.dispose()");
    expect(capture).not.toContain("cachedEntry.root.parent");
    expect(capture.match(/listBg3dModelLibraryEntries\(\)/gu)).toHaveLength(1);
  });

  it("serializes models through one controller and leaves a placeholder when the GPU lease is busy", () => {
    const capture = functionSource("startModelThumbnailCaptureBatch");

    expectInOrder(capture, [
      "for (const record of records)",
      "if (captureInFlightRef.current) continue",
      "captureHandle = await thumbnailRuntime.createThreeCapture({",
      "const lease = acquireModelThumbnailGpuLease()",
      "if (!lease)",
      "return await isolatedAdapter.capture(request)",
      "lease.release()",
      "await thumbnailCaptureController.captureAndStore({",
    ]);
    expect(source.match(/new CaptureController\(\{/gu)).toHaveLength(1);
    expect(source).toContain("dependencies: { encode: encodeStudioBg3dModelThumbnailPng }");
    expect(capture).toContain("Thumbnail generation is best-effort");
  });

  it("uses an owner-checked synchronous lease without weakening the existing close guard", () => {
    const acquire = functionSource("acquireModelThumbnailGpuLease");
    const close = functionSource("requestUserClose");

    expectInOrder(acquire, [
      "if (captureInFlightRef.current) return null",
      "modelThumbnailGpuLeaseRef.current = lease",
      "captureInFlightRef.current = true",
    ]);
    expect(acquire).toContain("if (modelThumbnailGpuLeaseRef.current === lease)");
    expect(acquire).toContain("captureInFlightRef.current = false");
    expect(close).toContain("invalidateModelThumbnailCaptures()");
    expect(close).toContain("void thumbnailLease.released.then");
    expect(close).toContain("if (captureInFlightRef.current) return;");
  });

  it("invalidates thumbnail generations on new import, delete, modal close, and unmount", () => {
    const upload = functionSource("handleUploadModelFiles");
    const remove = functionSource("handleDeleteModelFromLibrary");

    expectInOrder(upload, [
      "invalidateModelThumbnailCaptures()",
      "modelImportAbortRef.current?.abort()",
    ]);
    expectInOrder(remove, [
      "const thumbnailLeaseReleased = invalidateModelThumbnailCaptures()",
      "if (thumbnailLeaseReleased) await thumbnailLeaseReleased",
      "if (!isModalAssetSessionCurrent(session) || captureInFlightRef.current) return",
      "preflightAndDeleteStudioBg3dPersistedModel({",
    ]);
    expect(source).toContain("modelThumbnailCaptureControllerRef.current?.invalidate()");
    expect(source).toContain("modelThumbnailCaptureControllerRef.current?.dispose()");
    expect(source).toContain("modelThumbnailCaptureControllerRef.current = null");
    expect(source).toContain("function getModelThumbnailCaptureController(");
    expect(source).toContain("thumbnailLease?.release()");
    expect((source.match(/modelThumbnailCaptureAbortRef\.current\?\.abort\(\)/gu) ?? []).length)
      .toBeGreaterThanOrEqual(2);
    expect(source).toContain("return () => {\n      invalidateModelThumbnailCaptures();");
  });
});
