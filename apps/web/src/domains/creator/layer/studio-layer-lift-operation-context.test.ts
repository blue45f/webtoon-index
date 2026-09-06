import { describe, expect, it, vi } from "vitest";

import { sha256HexPortable } from "../studio-sha256";

import { admitStudioLayerLiftArtifactPair } from "./studio-layer-lift-artifact";
import { createStudioLayerLiftCompositionReceipt } from "./studio-layer-lift-composition-receipt";
import {
  calculateStudioSceneLayerLiftProviderReceiptSha256,
  parseStudioSceneLayerLiftResult,
} from "./studio-layer-lift-contract";
import {
  StudioLayerLiftOperationRegistry,
  doesStudioLayerLiftArtifactReceiptMatchOperation,
  doesStudioSceneLayerLiftResultMatchOperation,
  type BeginStudioLayerLiftOperationInput,
  type StudioLayerLiftOperationCurrentState,
} from "./studio-layer-lift-operation-context";
import { fingerprintStudioLayerLiftSource } from "./studio-layer-lift-plan";

import type { El } from "../studio-element-model";
import type {
  StudioLayerLiftArtifactPairReceipt,
  StudioLayerLiftTrustedArtifactPair,
} from "./studio-layer-lift-artifact";
import type {
  StudioSceneLayerLiftFailure,
  StudioSceneLayerLiftSuccess,
} from "./studio-layer-lift-contract";

const SOURCE_SHA = `sha256:${"a".repeat(64)}` as const;
const BACKGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";
const FOREGROUND_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function image(overrides: Partial<Extract<El, { type: "image" }>> = {}): Extract<El, { type: "image" }> {
  return {
    id: "source",
    type: "image",
    name: "Source",
    src: "data:image/png;base64,iVBORw0KGgo=",
    x: 1,
    y: 2,
    width: 4,
    height: 1,
    rotation: 0,
    ...overrides,
  };
}

function beginInput(sourceElement: El = image()): BeginStudioLayerLiftOperationInput {
  const sourceFingerprint = fingerprintStudioLayerLiftSource({
    elements: [sourceElement],
    groups: [],
    sourceId: sourceElement.id,
  });
  if (!sourceFingerprint) throw new Error("fixture source must be fingerprintable");
  return {
    mutationTicket: {
      authScopeKey: "user-1",
      workId: null,
      accessGeneration: 2,
      documentGeneration: 5,
    },
    pageId: "page-1",
    masterEditMode: false,
    selectedIds: ["source"],
    source: {
      requestId: "request-1",
      sourceId: "source",
      sourceFingerprint,
      sourceSha256: SOURCE_SHA,
      width: 4,
      height: 1,
      backgroundOutputId: "background-1",
      foregroundOutputId: "foreground-1",
    },
  };
}

function current(
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
    elements: [image()],
    groups: [],
    ...overrides,
  };
}

function receipt(): StudioLayerLiftArtifactPairReceipt {
  return {
    kind: "toonspectrum.scene-layer-lift/png-artifact-pair",
    version: 1,
    requestId: "request-1",
    sourceId: "source",
    sourceWidth: 4,
    sourceHeight: 1,
    background: {
      outputId: "background-1",
      width: 4,
      height: 1,
      pixelCount: 4,
      byteLength: 100,
      decodedByteLength: 16,
      sha256: `sha256:${"b".repeat(64)}`,
    },
    foreground: {
      outputId: "foreground-1",
      width: 4,
      height: 1,
      pixelCount: 4,
      byteLength: 100,
      decodedByteLength: 16,
      sha256: `sha256:${"c".repeat(64)}`,
    },
    aggregatePixelCount: 8,
    aggregateByteLength: 200,
    aggregateDecodedByteLength: 32,
    receiptSha256: `sha256:${"d".repeat(64)}`,
  };
}

async function trustedArtifacts(
  outputIds: Readonly<{
    readonly background: string;
    readonly foreground: string;
  }> = {
    background: "background-1",
    foreground: "foreground-1",
  },
): Promise<StudioLayerLiftTrustedArtifactPair> {
  return admitStudioLayerLiftArtifactPair({
    requestId: "request-1",
    sourceId: "source",
    sourceWidth: 4,
    sourceHeight: 1,
    background: {
      outputId: outputIds.background,
      bytes: Uint8Array.from(decodeBase64(BACKGROUND_PNG_BASE64)).buffer,
    },
    foreground: {
      outputId: outputIds.foreground,
      bytes: Uint8Array.from(decodeBase64(FOREGROUND_PNG_BASE64)).buffer,
    },
  }, {
    decodePngDimensions: async () => ({ width: 4, height: 1 }),
  });
}

function providerSuccess(): StudioSceneLayerLiftSuccess {
  const rgbaBytes = Uint8Array.from([
    10, 20, 30, 255,
    40, 50, 60, 255,
    70, 80, 90, 255,
    100, 110, 120, 255,
  ]);
  const maskBytes = Uint8Array.from([255, 255, 255, 255]);
  const providerReceipt = {
    kind: "toonspectrum.scene-layer-lift/local-provider-receipt" as const,
    version: 1 as const,
    providerId: "fixture-provider",
    providerVersion: "1",
    execution: "local-device" as const,
    networkUsed: false as const,
    requestId: "request-1",
    sourceSha256: SOURCE_SHA,
    inputByteLength: 16,
    outputByteLength: 20,
    maskByteLength: 4,
    layerCount: 1,
    durationMilliseconds: 1,
    outcome: "success" as const,
  };
  const parsed = parseStudioSceneLayerLiftResult({
    kind: "toonspectrum.scene-layer-lift/result",
    version: 1,
    requestId: "request-1",
    status: "success",
    source: {
      sourceId: "source",
      width: 4,
      height: 1,
      pixelCount: 4,
      byteLength: 16,
      sha256: SOURCE_SHA,
    },
    layers: [{
      layerId: "layer-foreground",
      role: "foreground",
      order: 0,
      label: "전경",
      confidence: {
        score: 1,
        band: "high",
      },
      rgba: {
        width: 4,
        height: 1,
        pixelCount: 4,
        encoding: "rgba8-srgb-straight",
        channels: 4,
        byteLength: rgbaBytes.byteLength,
        sha256: `sha256:${sha256HexPortable(rgbaBytes)}`,
        bytes: rgbaBytes,
      },
      mask: {
        width: 4,
        height: 1,
        pixelCount: 4,
        encoding: "alpha8",
        channels: 1,
        byteLength: maskBytes.byteLength,
        sha256: `sha256:${sha256HexPortable(maskBytes)}`,
        bytes: maskBytes,
      },
    }],
    confidence: {
      score: 1,
      band: "high",
    },
    diagnostics: [],
    receipt: {
      ...providerReceipt,
      receiptSha256:
        calculateStudioSceneLayerLiftProviderReceiptSha256(providerReceipt),
    },
  });
  if (!parsed.ok || parsed.value.status !== "success") {
    throw new Error("fixture provider result must be a trusted success");
  }
  return parsed.value;
}

function providerFailure(): StudioSceneLayerLiftFailure {
  return {
    ...providerSuccess(),
    status: "failure",
    code: "provider-failed",
    retryable: true,
    receipt: {
      ...providerSuccess().receipt,
      outcome: "failure",
      outputByteLength: 0,
      maskByteLength: 0,
      layerCount: 0,
    },
  };
}

function compositionReceipt(
  providerResult: StudioSceneLayerLiftSuccess,
  artifacts: StudioLayerLiftTrustedArtifactPair,
) {
  return createStudioLayerLiftCompositionReceipt({
    requestId: providerResult.requestId,
    sourceSha256: providerResult.source.sha256,
    providerReceiptSha256: providerResult.receipt.receiptSha256,
    providerLayers: providerResult.layers.map((layer) => ({
      layerId: layer.layerId,
      role: layer.role,
      order: layer.order,
      rgba: { sha256: layer.rgba.sha256 },
      mask: { sha256: layer.mask.sha256 },
    })),
    compositor: {
      id: "toonspectrum-layer-lift-compositor",
      version: "1.0.0",
    },
    background: {
      outputId: artifacts.background.outputId,
      artifactSha256: artifacts.background.sha256,
      contributorLayerIds: [],
    },
    foreground: {
      outputId: artifacts.foreground.outputId,
      artifactSha256: artifacts.foreground.sha256,
      contributorLayerIds: providerResult.layers.map((layer) => layer.layerId),
    },
  });
}

async function finalFixture() {
  const registry = new StudioLayerLiftOperationRegistry();
  const ticket = registry.begin(beginInput());
  const providerResult = providerSuccess();
  const artifacts = await trustedArtifacts();
  return {
    registry,
    ticket,
    providerResult,
    artifacts,
    compositionReceipt: compositionReceipt(providerResult, artifacts),
  };
}

describe("StudioLayerLiftOperationRegistry", () => {
  it("derives local/saved persistence from the real mutation-ticket work scope", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const local = registry.begin(beginInput());
    expect(local.persistenceScope).toBe("local-unsaved");

    const savedInput = beginInput();
    const saved = registry.begin({
      ...savedInput,
      mutationTicket: { ...savedInput.mutationTicket, workId: "work-1" },
      source: { ...savedInput.source, requestId: "request-saved-1" },
    });
    expect(local.signal.aborted).toBe(true);
    expect(saved.persistenceScope).toBe("saved-work");
    expect(saved.operationEpoch).toBe(local.operationEpoch + 1);
  });

  it("admits only the exact owned document/page/surface/selection/source snapshot", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const ticket = registry.begin(beginInput());

    expect(registry.checkCurrent(ticket, current())).toEqual({ ok: true });
    expect(registry.checkCurrent(ticket, current({
      pageId: "page-2",
    }))).toEqual({ ok: false, reason: "stale-page" });
    expect(registry.checkCurrent(ticket, current({
      masterEditMode: true,
    }))).toEqual({ ok: false, reason: "stale-edit-surface" });
    expect(registry.checkCurrent(ticket, current({
      selectedIds: [],
    }))).toEqual({ ok: false, reason: "stale-selection" });
    expect(registry.checkCurrent(ticket, current({
      elements: [image({ x: 99 })],
    }))).toEqual({ ok: false, reason: "stale-source" });
    expect(registry.checkCurrent(ticket, current({
      mutationState: {
        ...current().mutationState,
        documentGeneration: 6,
      },
    }))).toEqual({ ok: false, reason: "stale-document" });
  });

  it("uses ticket identity, aborts superseded work, and remains reusable after finish", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const first = registry.begin(beginInput());
    const abortListener = vi.fn();
    first.signal.addEventListener("abort", abortListener);
    const second = registry.begin({
      ...beginInput(),
      source: { ...beginInput().source, requestId: "request-2" },
    });

    expect(abortListener).toHaveBeenCalledTimes(1);
    expect(first.signal.aborted).toBe(true);
    expect(registry.checkCurrent(first, current())).toEqual({
      ok: false,
      reason: "foreign-ticket",
    });
    expect(registry.checkCurrent(second, current())).toEqual({ ok: true });
    expect(registry.finish(second)).toBe(true);
    expect(registry.finish(second)).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(registry.checkCurrent(second, current())).toEqual({
      ok: false,
      reason: "foreign-ticket",
    });
  });

  it("rejects malformed authority and an inexact launch selection", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const valid = beginInput();
    expect(() => registry.begin({
      ...valid,
      selectedIds: ["source", "other"],
    })).toThrow(TypeError);
    expect(() => registry.begin({
      ...valid,
      source: { ...valid.source, sourceSha256: "sha256:bad" as never },
    })).toThrow(TypeError);
  });

  it("rejects request ID reuse without aborting the still-current operation", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const ticket = registry.begin(beginInput());
    const abortListener = vi.fn();
    ticket.signal.addEventListener("abort", abortListener);

    expect(() => registry.begin(beginInput())).toThrow(
      "Scene Layer Lift request IDs cannot be reused",
    );
    expect(registry.activeTicket).toBe(ticket);
    expect(ticket.signal.aborted).toBe(false);
    expect(abortListener).not.toHaveBeenCalled();
  });

  it("admits and consumes one exact current provider/composition/artifact authority", async () => {
    const {
      registry,
      ticket,
      providerResult,
      artifacts,
      compositionReceipt: composition,
    } = await finalFixture();

    const admitted = await registry.admitFinal({
      ticket,
      readCurrent: () => current(),
      providerResult,
      artifacts,
      compositionReceipt: composition,
    });

    expect(admitted).toMatchObject({
      ok: true,
      binding: {
        operationEpoch: ticket.operationEpoch,
        pageId: "page-1",
        masterEditMode: false,
        persistenceScope: "local-unsaved",
        mutationTicket: ticket.mutationTicket,
        requestId: "request-1",
        sourceId: "source",
        sourceFingerprint: ticket.source.sourceFingerprint,
        sourceSha256: SOURCE_SHA,
        providerReceiptSha256: providerResult.receipt.receiptSha256,
        compositionReceiptSha256: composition.receiptSha256,
        artifactReceiptSha256: artifacts.receipt.receiptSha256,
        background: {
          outputId: "background-1",
          sha256: artifacts.background.sha256,
        },
        foreground: {
          outputId: "foreground-1",
          sha256: artifacts.foreground.sha256,
        },
      },
    });
    expect(Object.isFrozen(admitted)).toBe(true);
    if (!admitted.ok) throw new Error("fixture admission must succeed");
    expect(admitted.artifacts).not.toBe(artifacts);
    expect(admitted.artifacts.background.bytes).not.toBe(
      artifacts.background.bytes,
    );
    expect(Object.isFrozen(admitted.binding)).toBe(true);
    expect(Object.isFrozen(admitted.binding.background)).toBe(true);
    expect(Object.isFrozen(admitted.binding.foreground)).toBe(true);
    expect(registry.activeTicket).toBeNull();
    await expect(registry.admitFinal({
      ticket,
      readCurrent: () => current(),
      providerResult,
      artifacts,
      compositionReceipt: composition,
    })).resolves.toEqual({ ok: false, reason: "foreign-ticket" });
  });

  it("leases one final admission per ticket while asynchronous verification is in flight", async () => {
    const {
      registry,
      ticket,
      providerResult,
      artifacts,
      compositionReceipt: composition,
    } = await finalFixture();
    const input = {
      ticket,
      readCurrent: () => current(),
      providerResult,
      artifacts,
      compositionReceipt: composition,
    };

    const first = registry.admitFinal(input);
    const concurrent = registry.admitFinal(input);

    await expect(concurrent).resolves.toEqual({
      ok: false,
      reason: "admission-in-progress",
    });
    await expect(first).resolves.toMatchObject({ ok: true });
    expect(registry.activeTicket).toBeNull();
  });

  it("fails closed for stale, failed, forged, mixed, or byte-mutated final inputs", async () => {
    const stale = await finalFixture();
    await expect(stale.registry.admitFinal({
      ticket: stale.ticket,
      readCurrent: () => current({ pageId: "page-2" }),
      providerResult: stale.providerResult,
      artifacts: stale.artifacts,
      compositionReceipt: stale.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "stale-page" });

    await expect(stale.registry.admitFinal({
      ticket: stale.ticket,
      readCurrent: () => current(),
      providerResult: providerFailure(),
      artifacts: stale.artifacts,
      compositionReceipt: stale.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "provider-failed" });

    await expect(stale.registry.admitFinal({
      ticket: stale.ticket,
      readCurrent: () => current(),
      providerResult: {
        ...stale.providerResult,
      },
      artifacts: stale.artifacts,
      compositionReceipt: stale.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "provider-mismatch" });

    await expect(stale.registry.admitFinal({
      ticket: stale.ticket,
      readCurrent: () => current(),
      providerResult: stale.providerResult,
      artifacts: {
        ...stale.artifacts,
      },
      compositionReceipt: stale.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "artifact-mismatch" });

    await expect(stale.registry.admitFinal({
      ticket: stale.ticket,
      readCurrent: () => current(),
      providerResult: stale.providerResult,
      artifacts: stale.artifacts,
      compositionReceipt: {
        ...stale.compositionReceipt,
      },
    })).resolves.toEqual({ ok: false, reason: "composition-mismatch" });

    const mixed = await finalFixture();
    const foreignArtifacts = await trustedArtifacts({
      background: "background-foreign",
      foreground: "foreground-foreign",
    });
    await expect(mixed.registry.admitFinal({
      ticket: mixed.ticket,
      readCurrent: () => current(),
      providerResult: mixed.providerResult,
      artifacts: foreignArtifacts,
      compositionReceipt: compositionReceipt(
        mixed.providerResult,
        foreignArtifacts,
      ),
    })).resolves.toEqual({ ok: false, reason: "artifact-mismatch" });

    const changedDuringVerification = await finalFixture();
    let currentReads = 0;
    await expect(changedDuringVerification.registry.admitFinal({
      ticket: changedDuringVerification.ticket,
      readCurrent: () => {
        currentReads += 1;
        return currentReads === 1
          ? current()
          : current({ pageId: "page-2" });
      },
      providerResult: changedDuringVerification.providerResult,
      artifacts: changedDuringVerification.artifacts,
      compositionReceipt: changedDuringVerification.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "stale-page" });
    expect(currentReads).toBe(2);
    expect(changedDuringVerification.registry.activeTicket)
      .toBe(changedDuringVerification.ticket);

    const mutated = await finalFixture();
    new Uint8Array(mutated.artifacts.foreground.bytes)[32] ^= 0x01;
    await expect(mutated.registry.admitFinal({
      ticket: mutated.ticket,
      readCurrent: () => current(),
      providerResult: mutated.providerResult,
      artifacts: mutated.artifacts,
      compositionReceipt: mutated.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "artifact-mismatch" });

    const mutatedProviderPlane = await finalFixture();
    mutatedProviderPlane.providerResult.layers[0]!.rgba.bytes[0] ^= 0x01;
    await expect(mutatedProviderPlane.registry.admitFinal({
      ticket: mutatedProviderPlane.ticket,
      readCurrent: () => current(),
      providerResult: mutatedProviderPlane.providerResult,
      artifacts: mutatedProviderPlane.artifacts,
      compositionReceipt: mutatedProviderPlane.compositionReceipt,
    })).resolves.toEqual({ ok: false, reason: "provider-mismatch" });
    expect(mutatedProviderPlane.registry.activeTicket)
      .toBe(mutatedProviderPlane.ticket);
  });
});

describe("doesStudioLayerLiftArtifactReceiptMatchOperation", () => {
  it("binds the trusted pair to the exact request, source, dimensions and output IDs", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const ticket = registry.begin(beginInput());
    const exact = receipt();

    expect(doesStudioLayerLiftArtifactReceiptMatchOperation(ticket, exact)).toBe(true);
    expect(doesStudioLayerLiftArtifactReceiptMatchOperation(ticket, {
      ...exact,
      requestId: "request-2",
    })).toBe(false);
    expect(doesStudioLayerLiftArtifactReceiptMatchOperation(ticket, {
      ...exact,
      foreground: { ...exact.foreground, outputId: "foreign-output" },
    })).toBe(false);
  });
});

describe("doesStudioSceneLayerLiftResultMatchOperation", () => {
  it("requires the provider envelope and provider receipt to name the exact normalized source", () => {
    const registry = new StudioLayerLiftOperationRegistry();
    const ticket = registry.begin(beginInput());
    const result = providerSuccess();

    expect(doesStudioSceneLayerLiftResultMatchOperation(ticket, result)).toBe(true);
    expect(doesStudioSceneLayerLiftResultMatchOperation(ticket, {
      ...result,
      receipt: {
        ...result.receipt,
        sourceSha256: `sha256:${"f".repeat(64)}`,
      },
    })).toBe(false);
  });
});
