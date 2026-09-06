import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { composeStudioLayerLiftBeta } from "./studio-layer-lift-compositor";
import {
  createStudioLayerLiftLocalForegroundProvider,
  type StudioLayerLiftLocalForegroundProvider,
} from "./studio-layer-lift-local-provider";
import {
  StudioLayerLiftOperationRegistry,
  type StudioLayerLiftOperationCurrentState,
} from "./studio-layer-lift-operation-context";
import { fingerprintStudioLayerLiftSource } from "./studio-layer-lift-plan";
import {
  analyzeStudioLayerLiftWorkflow,
  finalizeStudioLayerLiftWorkflow,
  type AnalyzeStudioLayerLiftWorkflowInput,
  type StudioLayerLiftWorkflowCompositor,
} from "./studio-layer-lift-workflow";

import type { StudioEditorMutationTicket } from "../studio-editor-scope";
import type { El } from "../studio-element-model";
import type {
  StudioLayerLiftSourceSnapshotSuccess,
} from "./studio-layer-lift-source-snapshot";

const PNG_4X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function image(
  overrides: Partial<Extract<El, { type: "image" }>> = {},
): Extract<El, { type: "image" }> {
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
    ...overrides,
  };
}

const SOURCE_BYTES = Uint8Array.from([
  10, 20, 30, 255,
  40, 50, 60, 255,
  70, 80, 90, 255,
  100, 110, 120, 255,
]);

function sourceFingerprint(elements: readonly El[]): string {
  const value = fingerprintStudioLayerLiftSource({
    elements,
    groups: [],
    sourceId: "source",
  });
  if (!value) throw new Error("fixture source must be fingerprintable");
  return value;
}

function snapshot(elements: readonly El[]): StudioLayerLiftSourceSnapshotSuccess {
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
    sourceFingerprint: sourceFingerprint(elements),
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

function provider(): StudioLayerLiftLocalForegroundProvider {
  return createStudioLayerLiftLocalForegroundProvider({
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

const MUTATION_TICKET: StudioEditorMutationTicket = {
  authScopeKey: "user-1",
  workId: null,
  accessGeneration: 2,
  documentGeneration: 5,
};

function current(
  elements: readonly El[],
  overrides: Partial<StudioLayerLiftOperationCurrentState> = {},
): StudioLayerLiftOperationCurrentState {
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
    ...overrides,
  };
}

function analyzeInput(
  registry: StudioLayerLiftOperationRegistry,
  elements: readonly El[],
  overrides: Partial<AnalyzeStudioLayerLiftWorkflowInput> = {},
): AnalyzeStudioLayerLiftWorkflowInput {
  return {
    registry,
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
    provider: provider(),
    compositor: compositor(),
    createSnapshot: async () => snapshot(elements),
    ...overrides,
  };
}

describe("Studio Layer Lift local workflow", () => {
  it("runs snapshot → provider → compositor, then admits and returns one atomic plan", async () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const elements = [image()];
    const originalElements = elements;
    const originalSource = elements[0];

    const analyzed = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(registry, elements),
    );

    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) throw new Error(analyzed.message);
    expect(analyzed.session).toMatchObject({
      ticket: {
        persistenceScope: "local-unsaved",
        source: {
          backgroundOutputId: "background-1",
          foregroundOutputId: "foreground-1",
        },
      },
      request: {
        requestedRoles: ["background", "character"],
      },
      preview: {
        width: 4,
        height: 1,
        confidenceBand: "high",
        backgroundRepair: {
          mode: "bounded-tile-fill-beta",
        },
      },
    });
    expect([...analyzed.session.preview.sourceRgba]).toEqual([
      ...SOURCE_BYTES,
    ]);
    expect([...analyzed.session.preview.maskAlpha]).toEqual([0, 255, 255, 0]);
    expect(elements).toBe(originalElements);
    expect(elements[0]).toBe(originalSource);

    const finalized = await finalizeStudioLayerLiftWorkflow({
      registry,
      session: analyzed.session,
      readCurrent: () => current(elements),
      groupId: "group-1",
    });

    expect(finalized.ok).toBe(true);
    if (!finalized.ok) throw new Error(finalized.message);
    expect(finalized.plan).toMatchObject({
      ok: true,
      selectedId: "foreground-1",
      nextElements: [
        { id: "source", hidden: true, locked: true, groupId: "group-1" },
        { id: "background-1", groupId: "group-1" },
        { id: "foreground-1", groupId: "group-1" },
      ],
    });
    expect(finalized.planInput.backgroundPngDataUrl)
      .toBe(`data:image/png;base64,${PNG_4X1_BASE64}`);
    expect(finalized.planInput.foregroundPngDataUrl)
      .toBe(`data:image/png;base64,${PNG_4X1_BASE64}`);
    expect(registry.activeTicket).toBeNull();
    expect(elements).toBe(originalElements);
    expect(elements[0]).toBe(originalSource);
  });

  it("fails stale after provider completion without invoking the compositor", async () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const elements = [image()];
    const run = vi.fn(compositor().run);
    let reads = 0;

    const result = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(registry, elements, {
        compositor: { run },
        readCurrent: () => {
          reads += 1;
          return current(elements, reads >= 2 ? { selectedIds: [] } : {});
        },
      }),
    );

    expect(result).toMatchObject({
      ok: false,
      code: "stale",
      staleReason: "stale-selection",
    });
    expect(run).not.toHaveBeenCalled();
    expect(registry.activeTicket).toBeNull();
    expect(elements).toEqual([image()]);
  });

  it("propagates an in-flight abort and never runs composition or planning", async () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const elements = [image()];
    const controller = new AbortController();
    const run = vi.fn(compositor().run);
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const pendingProvider = {
      analyze: vi.fn((
        _request: unknown,
        options?: { readonly signal?: AbortSignal },
      ) => {
        markStarted?.();
        return new Promise<never>((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        });
      }),
    };

    const promise = analyzeStudioLayerLiftWorkflow(
      analyzeInput(registry, elements, {
        provider: pendingProvider,
        compositor: { run },
        signal: controller.signal,
      }),
    );
    await started;
    controller.abort();
    const result = await promise;

    expect(result).toMatchObject({ ok: false, code: "aborted" });
    expect(run).not.toHaveBeenCalled();
    expect(registry.activeTicket).toBeNull();
    expect(elements).toEqual([image()]);
  });

  it("reports provider timeout and compositor failure as distinct closed outcomes", async () => {
    const elements = [image()];
    const timeoutRegistry = new StudioLayerLiftOperationRegistry();
    const timeout = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(timeoutRegistry, elements, {
        provider: {
          analyze: async () => {
            throw Object.assign(new Error("slow"), {
              name: "TimeoutError",
              code: "timeout",
            });
          },
        },
      }),
    );
    expect(timeout).toMatchObject({
      ok: false,
      phase: "provider",
      code: "timeout",
    });
    expect(timeoutRegistry.activeTicket).toBeNull();

    const composeRegistry = new StudioLayerLiftOperationRegistry();
    const failed = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(composeRegistry, elements, {
        compositor: {
          run: async () => {
            throw new Error("encoder unavailable");
          },
        },
      }),
    );
    expect(failed).toMatchObject({
      ok: false,
      phase: "compositor",
      code: "compositor-failed",
    });
    expect(composeRegistry.activeTicket).toBeNull();
    expect(elements).toEqual([image()]);
  });

  it("blocks saved work before snapshot/provider and returns plan failures as document no-ops", async () => {
    const elements = [image()];
    const createSnapshot = vi.fn(async () => snapshot(elements));
    const analyze = vi.fn(provider().analyze);
    const run = vi.fn(compositor().run);
    const saved = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(new StudioLayerLiftOperationRegistry(), elements, {
        mutationTicket: { ...MUTATION_TICKET, workId: "work-1" },
        createSnapshot,
        provider: { analyze },
        compositor: { run },
      }),
    );
    expect(saved).toMatchObject({
      ok: false,
      code: "saved-work-unsupported",
    });
    expect(createSnapshot).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();

    const registry = new StudioLayerLiftOperationRegistry();
    const analyzed = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(registry, elements),
    );
    if (!analyzed.ok) throw new Error(analyzed.message);
    const rejectedPlan = await finalizeStudioLayerLiftWorkflow({
      registry,
      session: analyzed.session,
      readCurrent: () => current(elements),
      groupId: "source",
    });
    expect(rejectedPlan).toMatchObject({
      ok: false,
      code: "plan-rejected",
      detail: "duplicate-id",
    });
    if (rejectedPlan.ok) throw new Error("plan should be rejected");
    expect(rejectedPlan.plan?.nextElements).toBe(elements);
    expect(rejectedPlan.plan?.nextGroups).toBe(
      rejectedPlan.planInput?.groups,
    );
    expect(elements).toEqual([image()]);
  });

  it("rejects final admission after a selection change without constructing a plan", async () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const elements = [image()];
    const analyzed = await analyzeStudioLayerLiftWorkflow(
      analyzeInput(registry, elements),
    );
    if (!analyzed.ok) throw new Error(analyzed.message);

    const finalized = await finalizeStudioLayerLiftWorkflow({
      registry,
      session: analyzed.session,
      readCurrent: () => current(elements, { selectedIds: [] }),
      groupId: "group-1",
    });

    expect(finalized).toMatchObject({
      ok: false,
      code: "admission-failed",
      detail: "stale-selection",
    });
    expect("plan" in finalized).toBe(false);
    expect(elements).toEqual([image()]);
  });
});
