
import { describe, expect, it } from "vitest";

import { readStudioVrmPoserImplementationSource } from "./studio-vrm-poser-implementation-source";

const poserSource = readStudioVrmPoserImplementationSource();

function requiredIndex(source: string, token: string, from = 0): number {
  const index = source.indexOf(token, from);
  if (index < 0) {
    throw new Error(`Expected source token was not found: ${token}`);
  }
  return index;
}

function sourceBetween(
  source: string,
  startToken: string,
  endToken: string,
): string {
  const start = requiredIndex(source, startToken);
  const end = requiredIndex(source, endToken, start + startToken.length);
  return source.slice(start, end);
}

describe("Studio VRM wardrobe capture boundary", () => {
  it("rejects changed wardrobe authority after awaited persistence before scene, pixels, or insert commit", () => {
    const authoredIdentity = sourceBetween(
      poserSource,
      "const wardrobeAuthoredIdentity = JSON.stringify(",
      "const wardrobeInteractionLocked =",
    );
    expect(authoredIdentity).toContain("serializeWardrobe(wardrobeState");
    expect(authoredIdentity).toContain("autoHideOriginal: wardrobeAutoHide");

    const evaluationEffect = sourceBetween(
      poserSource,
      "useLayoutEffect(() => {\n    garmentEvaluationGenerationRef.current += 1;",
      "useLayoutEffect(() => {\n    const previous = dynamicPoseStateRef.current;",
    );
    expect(evaluationEffect).toContain(
      "wardrobeAuthoredIdentityRef.current = wardrobeAuthoredIdentity;",
    );
    expect(evaluationEffect).toContain("wardrobeAuthoredIdentity,");

    const insertHandler = sourceBetween(
      poserSource,
      "function handleInsert()",
      "if (!open) return null;",
    );
    const wardrobeSnapshot = requiredIndex(
      insertHandler,
      "const captureWardrobeAuthoredIdentity = wardrobeAuthoredIdentityRef.current;",
    );
    const evaluationGenerationSnapshot = requiredIndex(
      insertHandler,
      "const captureGarmentEvaluationGeneration = garmentEvaluationGenerationRef.current;",
      wardrobeSnapshot,
    );
    const evaluationReceiptSnapshot = requiredIndex(
      insertHandler,
      "const captureGarmentEvaluationReceipt = garmentEvaluationReceiptRef.current;",
      evaluationGenerationSnapshot,
    );
    const authorityStart = requiredIndex(
      insertHandler,
      "const wardrobeCaptureAuthorityIsCurrent = (): boolean => (",
      evaluationReceiptSnapshot,
    );
    const preconditionsStart = requiredIndex(
      insertHandler,
      "const capturePreconditionsAreCurrent = (): boolean => (",
      authorityStart,
    );
    const authorityGate = insertHandler.slice(authorityStart, preconditionsStart);
    const preconditionsEnd = requiredIndex(
      insertHandler,
      "const reportWardrobeCaptureAuthorityMismatch =",
      preconditionsStart,
    );
    const preconditions = insertHandler.slice(preconditionsStart, preconditionsEnd);
    const persist = requiredIndex(
      insertHandler,
      "persistStudioVrmTexturePaintRuntime(",
      preconditionsEnd,
    );
    const postPersistenceRevalidation = requiredIndex(
      insertHandler,
      "!capturePreconditionsAreCurrent()",
      persist,
    );
    const sceneDocument = requiredIndex(
      insertHandler,
      "const sceneDocument = createCurrentSceneDocument(",
      postPersistenceRevalidation,
    );
    const rgbaCapture = requiredIndex(
      insertHandler,
      "captureStudioVrmRgba(",
      sceneDocument,
    );
    const pngEncoding = requiredIndex(
      insertHandler,
      "const baseDataUrl = await encodeStudioVrmCapturePngDataUrl(",
      rgbaCapture,
    );
    const postPngRevalidation = requiredIndex(
      insertHandler,
      "!capturePreconditionsAreCurrent()",
      pngEncoding,
    );
    const insertCommit = requiredIndex(
      insertHandler,
      "const accepted = await onInsert(",
      postPngRevalidation,
    );

    expect(authorityGate).toContain(
      "wardrobeAuthoredIdentityRef.current === captureWardrobeAuthoredIdentity",
    );
    expect(authorityGate).toContain(
      "garmentEvaluationGenerationRef.current === captureGarmentEvaluationGeneration",
    );
    expect(authorityGate).toContain(
      "garmentEvaluationReceiptRef.current === captureGarmentEvaluationReceipt",
    );
    expect(authorityGate).toContain(
      "captureGarmentEvaluationReceipt.generation === captureGarmentEvaluationGeneration",
    );
    expect(preconditions).toContain("wardrobeCaptureAuthorityIsCurrent()");
    expect(evaluationReceiptSnapshot).toBeLessThan(persist);
    expect(persist).toBeLessThan(postPersistenceRevalidation);
    expect(postPersistenceRevalidation).toBeLessThan(sceneDocument);
    expect(sceneDocument).toBeLessThan(rgbaCapture);
    expect(rgbaCapture).toBeLessThan(pngEncoding);
    expect(pngEncoding).toBeLessThan(postPngRevalidation);
    expect(postPngRevalidation).toBeLessThan(insertCommit);
  });

  it("locks every authored wardrobe handler and control for the complete capture lifecycle", () => {
    const handlerRanges = [
      ["function equipWardrobeItem(", "function updateWardrobeEquip("],
      ["function updateWardrobeEquip(", "function handleWardrobeSurfaceReceipt("],
      ["function equipWardrobeSetById(", "function clearWardrobe("],
      ["function clearWardrobe(", "function applyWardrobeFitSuggestions("],
      ["function applyWardrobeFitSuggestions(", "function toggleWardrobeAutoHide("],
      ["function toggleWardrobeAutoHide(", "/* ── 물리(스프링본) 핸들러"],
    ] as const;
    for (const [start, end] of handlerRanges) {
      expect(sourceBetween(poserSource, start, end)).toContain(
        "wardrobeMutationBlockedRef.current || isCapturing",
      );
    }

    const wardrobePanel = sourceBetween(
      poserSource,
      'id="vrm-character-section-wardrobe"',
      'id="vrm-character-section-appearance"',
    );
    const buttonCount = wardrobePanel.match(/type="button"/gu)?.length ?? 0;
    const inputCount = wardrobePanel.match(/<input\b/gu)?.length ?? 0;
    const selectCount = wardrobePanel.match(/<select\b/gu)?.length ?? 0;
    const disabledByCaptureCount = wardrobePanel.match(
      /disabled=\{[^}]*wardrobeInteractionLocked[^}]*\}/gu,
    )?.length ?? 0;

    expect(buttonCount).toBe(7);
    expect(inputCount).toBe(2);
    expect(selectCount).toBe(1);
    expect(disabledByCaptureCount).toBe(buttonCount + inputCount + selectCount);
    expect(wardrobePanel).toContain("aria-busy={wardrobeInteractionLocked || undefined}");
    expect(wardrobePanel).toContain("onClick={toggleWardrobeAutoHide}");

    const cancelCapture = sourceBetween(
      poserSource,
      "const cancelPendingInsertCapture =",
      "const cancelPendingPoseShare =",
    );
    expect(cancelCapture).toContain("wardrobeMutationBlockedRef.current = false;");

    const insertHandler = sourceBetween(
      poserSource,
      "function handleInsert()",
      "if (!open) return null;",
    );
    const lock = requiredIndex(
      insertHandler,
      "wardrobeMutationBlockedRef.current = true;",
    );
    const persist = requiredIndex(
      insertHandler,
      "persistStudioVrmTexturePaintRuntime(",
      lock,
    );
    const release = sourceBetween(
      insertHandler,
      "const releaseCaptureMutationLocks =",
      "texturePaintMutationBlockedRef.current = true;",
    );
    expect(lock).toBeLessThan(persist);
    expect(release).toContain("texturePaintMutationBlockedRef.current = false;");
    expect(release).toContain("wardrobeMutationBlockedRef.current = false;");
    expect(insertHandler).toContain("releaseCaptureMutationLocks();");
  });
});
