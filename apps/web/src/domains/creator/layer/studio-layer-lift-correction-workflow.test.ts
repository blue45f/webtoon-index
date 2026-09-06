import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { composeStudioLayerLiftBeta } from "./studio-layer-lift-compositor";
import {
  applyStudioLayerLiftCorrectionWorkflow,
  type ApplyStudioLayerLiftCorrectionWorkflowInput,
} from "./studio-layer-lift-correction-workflow";
import {
  createStudioLayerLiftLocalForegroundProvider,
} from "./studio-layer-lift-local-provider";
import {
  StudioLayerLiftOperationRegistry,
  type StudioLayerLiftOperationCurrentState,
} from "./studio-layer-lift-operation-context";
import { fingerprintStudioLayerLiftSource } from "./studio-layer-lift-plan";
import {
  analyzeStudioLayerLiftWorkflow,
  type StudioLayerLiftWorkflowCompositor,
  type StudioLayerLiftWorkflowSession,
} from "./studio-layer-lift-workflow";

import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { El } from "../studio-element-model";
import type {
  StudioLayerLiftSourceSnapshotSuccess,
} from "./studio-layer-lift-source-snapshot";

const PNG_4X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";

const SOURCE_BYTES = Uint8Array.from([
  10, 20, 30, 255,
  40, 50, 60, 255,
  70, 80, 90, 255,
  100, 110, 120, 255,
]);

const MUTATION_TICKET: StudioEditorMutationTicket = {
  authScopeKey: "user-1",
  workId: null,
  accessGeneration: 2,
  documentGeneration: 5,
};

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function image(): Extract<El, { type: "image" }> {
  return {
    id: "source",
    type: "image",
    name: "Source",
    src: `data:image/png;base64,${PNG_4X1_BASE64}`,
    x: 12,
    y: 24,
    width: 4,
    height: 1,
    rotation: 0,
  };
}

function current(elements: readonly El[]): StudioLayerLiftOperationCurrentState {
  return {
    mutationState: {
      authScopeKey: "user-1",
      workId: null,
      accessGeneration: 2,
      documentGeneration: 5,
      mounted: true,
      aborted: false,
      locked: false,
    },
    pageId: "page-1",
    masterEditMode: false,
    selectedIds: ["source"],
    elements,
    groups: [],
  };
}

function snapshot(elements: readonly El[]): StudioLayerLiftSourceSnapshotSuccess {
  const sourceFingerprint = fingerprintStudioLayerLiftSource({
    elements,
    groups: [],
    sourceId: "source",
  });
  if (!sourceFingerprint) throw new Error("invalid fixture");
  const bytes = new Uint8Array(SOURCE_BYTES);
  return Object.freeze({
    ok: true,
    source: Object.freeze({
      sourceId: "source",
      sourceName: "source.png",
      mimeType: "image/png",
      width: 4,
      height: 1,
      pixelCount: 4,
      pixelFormat: "rgba8-srgb-straight",
      channels: 4,
      byteLength: bytes.byteLength,
      sha256: `sha256:${sha256HexPortable(bytes)}`,
      bytes,
    }),
    sourceFingerprint,
    placement: Object.freeze({
      x: 12,
      y: 24,
      width: 4,
      height: 1,
      rotation: 0,
      flipped: false,
      flippedY: false,
      skewX: 0,
      skewY: 0,
    }),
    filterExecution: "none",
  });
}

function compositor(): StudioLayerLiftWorkflowCompositor {
  return {
    run: (input, options) => composeStudioLayerLiftBeta(input, {
      signal: options?.signal,
      encodePng: async () => decodeBase64(PNG_4X1_BASE64),
      decodePngDimensions: async () => ({ width: 4, height: 1 }),
    }),
  };
}

async function makeSession(): Promise<StudioLayerLiftWorkflowSession> {
  const elements = [image()];
  const analyzed = await analyzeStudioLayerLiftWorkflow({
    registry: new StudioLayerLiftOperationRegistry(),
    mutationTicket: MUTATION_TICKET,
    pageId: "page-1",
    masterEditMode: false,
    availability: {
      elements,
      groups: [],
      selectedIds: ["source"],
    },
    readCurrent: () => current(elements),
    requestId: "request-1",
    backgroundOutputId: "background-1",
    foregroundOutputId: "foreground-1",
    provider: createStudioLayerLiftLocalForegroundProvider({
      loadInference: async () => ({
        model: {
          providerId: "fixture-segmenter",
          providerVersion: "1.0.0",
          modelId: "fixture-person",
          modelVersion: "1",
          executionRoute: "fixture-cpu",
        },
        infer: async () => ({
          width: 4,
          height: 1,
          confidence: Float32Array.from([0, 1, 1, 0]),
        }),
      }),
      now: () => 1,
    }),
    compositor: compositor(),
    createSnapshot: async () => snapshot(elements),
  });
  if (!analyzed.ok) throw new Error(analyzed.message);
  return analyzed.session;
}

function correctionInput(
  session: StudioLayerLiftWorkflowSession,
  overrides: Partial<ApplyStudioLayerLiftCorrectionWorkflowInput> = {},
): ApplyStudioLayerLiftCorrectionWorkflowInput {
  return {
    session,
    stroke: {
      mode: "include",
      radius: 0.5,
      points: [{ x: 0.5, y: 0.5 }],
    },
    compositor: compositor(),
    ...overrides,
  };
}

describe("Studio Layer Lift correction workflow", () => {
  it("re-admits a changed UI mask and recomposes with the same operation authority", async () => {
    const session = await makeSession();
    const originalMask = [...session.preview.maskAlpha];
    const originalProviderMask = [
      ...session.providerResult.layers[0]!.mask.bytes,
    ];
    const run = vi.fn(compositor().run);

    const result = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, {
        compositor: { run },
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.recomposed).toBe(true);
    expect(result.changedPixelCount).toBe(1);
    expect(result.session).not.toBe(session);
    expect(result.preview).not.toBe(session.preview);
    expect(result.session.ticket).toBe(session.ticket);
    expect(result.session.ticket.source).toMatchObject({
      sourceId: "source",
      backgroundOutputId: "background-1",
      foregroundOutputId: "foreground-1",
    });
    expect(result.preview.maskAlpha).toEqual(Uint8Array.from([255, 255, 255, 0]));
    expect(result.session.providerResult.receipt.receiptSha256)
      .not.toBe(session.providerResult.receipt.receiptSha256);
    expect(result.session.compositionReceipt.providerReceiptSha256)
      .toBe(result.session.providerResult.receipt.receiptSha256);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "request-1",
        sourceId: "source",
        backgroundOutputId: "background-1",
        foregroundOutputId: "foreground-1",
      }),
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      }),
    );
    expect([...session.preview.maskAlpha]).toEqual(originalMask);
    expect([...session.providerResult.layers[0]!.mask.bytes])
      .toEqual(originalProviderMask);
  });

  it("returns an explicit no-op and never invokes the compositor", async () => {
    const session = await makeSession();
    const run = vi.fn(compositor().run);

    const result = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, {
        stroke: {
          mode: "include",
          radius: 0.5,
          points: [{ x: 1.5, y: 0.5 }],
        },
        compositor: { run },
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      recomposed: false,
      changedPixelCount: 0,
      session,
      preview: session.preview,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed on invalid strokes without changing the current mask", async () => {
    const session = await makeSession();
    const originalMask = [...session.preview.maskAlpha];
    const result = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, {
        stroke: {
          mode: "include",
          radius: 0,
          points: [{ x: 0, y: 0 }],
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "invalid-stroke",
    });
    expect([...session.preview.maskAlpha]).toEqual(originalMask);
  });

  it("rejects a correction that removes the complete foreground", async () => {
    const session = await makeSession();
    const result = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, {
        stroke: {
          mode: "exclude",
          radius: 10,
          points: [{ x: 2, y: 0.5 }],
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "empty-foreground",
      message: "보정 결과에 남은 전경이 없어 적용하지 않았습니다.",
    });
  });

  it("rejects a detached or stale UI mask before recomposition", async () => {
    const session = await makeSession();
    const staleSession = {
      ...session,
      preview: {
        ...session.preview,
        maskAlpha: Uint8Array.from([0, 0, 0, 0]),
      },
    } as StudioLayerLiftWorkflowSession;
    const run = vi.fn(compositor().run);

    const result = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(staleSession, {
        compositor: { run },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "stale-provenance",
      detail: "preview-mask-authority-mismatch",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects an untrusted compositor result even when its shape looks plausible", async () => {
    const session = await makeSession();
    const result = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, {
        compositor: {
          run: async () => ({
            requestId: "request-1",
            sourceId: "source",
            width: 4,
            height: 1,
          }),
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "stale-provenance",
      detail: "corrected-composition-authority-mismatch",
    });
  });

  it("honours pre-abort and timeout without consuming the operation ticket", async () => {
    const session = await makeSession();
    const aborted = new AbortController();
    aborted.abort();
    const preAborted = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, { signal: aborted.signal }),
    );
    expect(preAborted).toMatchObject({ ok: false, code: "aborted" });

    const pending = await applyStudioLayerLiftCorrectionWorkflow(
      correctionInput(session, {
        timeoutMs: 1,
        compositor: {
          run: (_input, options) => new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            }, { once: true });
          }),
        },
      }),
    );
    expect(pending).toMatchObject({ ok: false, code: "timeout" });
    expect(session.ticket.signal.aborted).toBe(false);
  });
});
