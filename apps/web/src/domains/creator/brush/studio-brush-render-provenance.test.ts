import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS,
  buildStudioBrushRenderProvenance,
  createStudioBrushRenderProvenanceCrdtSidecar,
  encodeStudioBrushRenderProvenanceCanonical,
  hashStudioBrushRenderProvenance,
  importStudioBrushRenderProvenance,
  parseStudioBrushRenderProvenance,
  parseStudioBrushRenderProvenanceCrdtSidecar,
  serializeStudioBrushRenderProvenanceCanonical,
  serializeStudioBrushRenderProvenanceCrdtSidecarCanonical,
  verifyStudioBrushRenderProvenanceBindings,
  type StudioBrushRenderProvenanceBuildInput,
} from "./studio-brush-render-provenance";

function hash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
}

function source(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    kind: "r8-texture-v1",
    asset: {
      assetId: "paper.provenance.v1",
      encodedSha256: hash("1"),
      decodedSha256: hash("2"),
      byteLength: 4_096,
      mediaType: "image/png",
      width: 64,
      height: 32,
      channel: "luminance",
      encoding: "r8-unorm",
      ...overrides,
    },
  };
}

function channel(base: number, minimum: number, maximum: number) {
  return { base, min: minimum, max: maximum, mappings: [] };
}

function dynamics(revision = 4) {
  return {
    kind: "studio-professional-brush-dynamics",
    version: 1,
    planId: "brush.ink.production",
    revision,
    seed: 0x1234_5678,
    units: {
      size: "document-css-px",
      opacity: "unit-interval",
      flow: "unit-interval",
      spacing: "document-css-px",
      angle: "radians",
      roundness: "unit-interval",
      scatter: "document-css-px",
      textureDepth: "unit-interval",
    },
    clock: { timeUnit: "milliseconds", tickMilliseconds: 1 },
    budgets: {
      maxSamples: 1_024,
      maxEvents: 4_096,
      maxMappings: 0,
      maxCurvePoints: 2,
      maxStationaryEventsPerGap: 32,
    },
    velocity: {
      normalizationPixelsPerMillisecond: 1,
      smoothingTimeMilliseconds: 8,
      initialPixelsPerMillisecond: 0,
      maximumPixelsPerMillisecond: 128,
    },
    taper: {
      start: { mode: "stroke-percentage", value: 0.1 },
      end: { mode: "stroke-percentage", value: 0.15 },
      minimumSizeRatio: 0.05,
      minimumOpacityRatio: 0.1,
      speedInfluence: 0.25,
    },
    stationary: {
      mode: "continuous",
      intervalTicks: 8,
      movementEpsilonPixels: 0.1,
    },
    channels: {
      size: channel(24, 0.01, 8_192),
      opacity: channel(1, 0, 1),
      flow: channel(0.8, 0, 1),
      spacing: channel(4, 0.05, 4_096),
      angle: channel(0, -Math.PI * 2, Math.PI * 2),
      roundness: channel(1, 0.01, 1),
      scatter: channel(0, 0, 8_192),
      textureDepth: channel(0.72, 0, 1),
    },
  };
}

function sampling(
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    space: "stroke-fixed",
    scale: 18.5,
    amount: 0.72,
    contrast: 0.4,
    grainSeed: 0x1020_3040,
    strokeSeed: 0xa0b0_c0d0,
    originX: 999_999.91,
    originY: -999_999.73,
    ...overrides,
  };
}

function input(
  overrides: Partial<StudioBrushRenderProvenanceBuildInput> = {},
): StudioBrushRenderProvenanceBuildInput {
  return {
    source: source(),
    sampling: sampling(),
    dynamics: dynamics(),
    ...overrides,
  };
}

function ready(
  candidate: unknown = input(),
) {
  const result = buildStudioBrushRenderProvenance(candidate);
  if (result.status !== "ready") {
    throw new Error(`${result.reason} ${result.path}`);
  }
  return result.provenance;
}

describe("Studio brush render provenance", () => {
  it("builds deterministic metadata-only R8, sampling/phase, and dynamics identity", () => {
    const first = ready();
    const second = ready();
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      kind: "studio-brush-render-provenance",
      version: 1,
      rendererContract: "durable-r8-repeat-bilinear-v1",
      asset: {
        assetId: "paper.provenance.v1",
        encodedSha256: hash("1"),
        decodedSha256: hash("2"),
        width: 64,
        height: 32,
        channel: "luminance",
        encoding: "r8-unorm",
      },
      sampling: {
        filter: "bilinear",
        edgeMode: "repeat",
        space: "stroke-fixed",
        scale: 18.5,
        amount: 0.72,
        contrast: 0.4,
        contrastTransfer: "midpoint-gain-4x",
        origin: { x: 999_999.91, y: -999_999.73 },
        phase: {
          algorithm: "xor-mix-u32-v1",
          grainSeed: 0x1020_3040,
          strokeSeed: 0xa0b0_c0d0,
        },
      },
      dynamics: {
        kind: "studio-professional-brush-dynamics-digest",
        version: 1,
        planId: "brush.ink.production",
        revision: 4,
      },
    });
    expect(first.sampling.phase.x).toBeGreaterThanOrEqual(0);
    expect(first.sampling.phase.x).toBeLessThan(1);
    expect(first.sampling.phase.y).toBeGreaterThanOrEqual(0);
    expect(first.sampling.phase.y).toBeLessThan(1);
    expect(first.dynamics.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const canonical = serializeStudioBrushRenderProvenanceCanonical(first);
    expect(canonical).not.toBeNull();
    expect(canonical!.length).toBeLessThan(
      STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCanonicalBytes,
    );
    expect(canonical).not.toContain('"bytes"');
    expect(canonical).not.toContain('"payload"');
    expect(canonical).not.toContain('"url"');
    expect(canonical).not.toContain('"channels"');
    expect(hashStudioBrushRenderProvenance(first)).toBe(
      hashStudioBrushRenderProvenance(second),
    );
    expect(parseStudioBrushRenderProvenance(JSON.parse(canonical!))).toEqual({
      status: "ready",
      provenance: first,
    });
  });

  it("fails closed for unknown/missing/payload/accessor data and a phase mismatch", () => {
    expect(buildStudioBrushRenderProvenance({
      ...input(),
      payload: new Uint8Array([1, 2, 3]),
    })).toEqual({
      status: "rejected",
      reason: "unknown-field",
      path: "$.payload",
    });
    const missingSampling = sampling() as Record<string, unknown>;
    delete missingSampling.amount;
    expect(buildStudioBrushRenderProvenance(input({
      sampling: missingSampling,
    }))).toEqual({
      status: "rejected",
      reason: "missing-field",
      path: "$.sampling.amount",
    });

    const poisoned = input() as unknown as Record<string, unknown>;
    const getter = vi.fn();
    Object.defineProperty(poisoned, "source", {
      enumerable: true,
      get: getter,
    });
    expect(buildStudioBrushRenderProvenance(poisoned)).toEqual({
      status: "rejected",
      reason: "not-plain-data",
      path: "$.source",
    });
    expect(getter).not.toHaveBeenCalled();

    const mismatched = JSON.parse(
      serializeStudioBrushRenderProvenanceCanonical(ready())!,
    ) as Record<string, Record<string, Record<string, unknown>>>;
    mismatched.sampling!.phase!.x = 0.123;
    expect(parseStudioBrushRenderProvenance(mismatched)).toEqual({
      status: "rejected",
      reason: "phase-mismatch",
      path: "$.sampling.phase",
    });
  });

  it("verifies live asset, sampling, and dynamics bindings independently", () => {
    const provenance = ready();
    const verified = verifyStudioBrushRenderProvenanceBindings(
      provenance,
      input(),
    );
    expect(verified.status).toBe("verified");
    if (verified.status !== "verified") return;
    expect(verified.sha256).toBe(hashStudioBrushRenderProvenance(provenance));

    for (const assetOverride of [
      { assetId: "paper.provenance.other" },
      { encodedSha256: hash("3") },
      { decodedSha256: hash("3") },
      { byteLength: 4_097 },
      { width: 65 },
      { height: 33 },
      { channel: "alpha" },
    ] as const) {
      expect(verifyStudioBrushRenderProvenanceBindings(
        provenance,
        input({ source: source(assetOverride) }),
      )).toEqual({
        status: "rejected",
        reason: "source-mismatch",
        path: "$.asset",
      });
    }
    expect(verifyStudioBrushRenderProvenanceBindings(
      provenance,
      input({ sampling: sampling({ scale: 19 }) }),
    )).toEqual({
      status: "rejected",
      reason: "sampling-mismatch",
      path: "$.sampling",
    });
    expect(verifyStudioBrushRenderProvenanceBindings(
      provenance,
      input({ dynamics: dynamics(5) }),
    )).toEqual({
      status: "rejected",
      reason: "dynamics-mismatch",
      path: "$.dynamics",
    });
  });

  it("makes legacy import explicit and requires canonical current-version JSON", () => {
    expect(importStudioBrushRenderProvenance(undefined)).toEqual({
      status: "legacy",
      reason: "missing-provenance",
    });
    expect(importStudioBrushRenderProvenance({
      r8AssetId: "old-paper",
    })).toEqual({
      status: "legacy",
      reason: "unversioned-provenance",
    });
    expect(importStudioBrushRenderProvenance({
      kind: "studio-brush-render-provenance",
    })).toEqual({
      status: "rejected",
      reason: "missing-field",
      path: "$.version",
    });
    const poisonedCurrent = { version: 1 } as Record<string, unknown>;
    Object.defineProperty(poisonedCurrent, "kind", {
      enumerable: true,
      get: () => "studio-brush-render-provenance",
    });
    expect(importStudioBrushRenderProvenance(poisonedCurrent)).toEqual({
      status: "rejected",
      reason: "not-plain-data",
      path: "$",
    });
    expect(importStudioBrushRenderProvenance({
      ...ready(),
      version: 2,
    })).toEqual({
      status: "rejected",
      reason: "unsupported-version",
      path: "$.version",
    });

    const canonical = serializeStudioBrushRenderProvenanceCanonical(ready())!;
    expect(importStudioBrushRenderProvenance(canonical).status).toBe("ready");
    const parsed = JSON.parse(canonical) as Record<string, unknown>;
    const reordered = JSON.stringify({
      version: parsed.version,
      kind: parsed.kind,
      rendererContract: parsed.rendererContract,
      asset: parsed.asset,
      sampling: parsed.sampling,
      dynamics: parsed.dynamics,
    });
    expect(importStudioBrushRenderProvenance(reordered)).toEqual({
      status: "rejected",
      reason: "non-canonical-json",
      path: "$",
    });
    expect(importStudioBrushRenderProvenance("{")).toEqual({
      status: "rejected",
      reason: "invalid-json",
      path: "$",
    });
  });

  it("returns independently owned canonical bytes that can be cloned and zeroized", () => {
    const owned = encodeStudioBrushRenderProvenanceCanonical(ready());
    expect(owned).not.toBeNull();
    expect(owned!.bytes).toBeInstanceOf(Uint8Array);
    expect(owned!.byteLength).toBe(owned!.bytes.byteLength);
    expect(
      typeof SharedArrayBuffer !== "undefined"
        && owned!.bytes.buffer instanceof SharedArrayBuffer,
    ).toBe(false);
    const clone = owned!.clone();
    expect(clone).not.toBeNull();
    expect(clone!.bytes).not.toBe(owned!.bytes);
    expect(clone!.bytes).toEqual(owned!.bytes);

    owned!.bytes[0] = 0xff;
    expect(clone!.bytes[0]).not.toBe(0xff);
    owned!.zeroize();
    owned!.zeroize();
    expect(owned!.isZeroized()).toBe(true);
    expect([...owned!.bytes].every((value) => value === 0)).toBe(true);
    expect(owned!.clone()).toBeNull();
    expect(clone!.isZeroized()).toBe(false);
    clone!.zeroize();
  });

  it("round-trips a bounded operation-bound CRDT sidecar and rejects tampering", () => {
    const created = createStudioBrushRenderProvenanceCrdtSidecar(
      "op:actor-7:000042",
      ready(),
    );
    expect(created.status).toBe("ready");
    if (created.status !== "ready") return;
    const canonical = serializeStudioBrushRenderProvenanceCrdtSidecarCanonical(
      created.sidecar,
    );
    expect(canonical).not.toBeNull();
    expect(new TextEncoder().encode(canonical!).byteLength).toBeLessThan(
      STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxCrdtSidecarBytes,
    );
    expect(parseStudioBrushRenderProvenanceCrdtSidecar(
      JSON.parse(canonical!),
    )).toEqual(created);

    expect(createStudioBrushRenderProvenanceCrdtSidecar(
      "x".repeat(STUDIO_BRUSH_RENDER_PROVENANCE_LIMITS.maxOperationIdLength + 1),
      ready(),
    )).toEqual({
      status: "rejected",
      reason: "invalid-field",
      path: "$.operationId",
    });
    expect(parseStudioBrushRenderProvenanceCrdtSidecar({
      ...created.sidecar,
      provenanceSha256: hash("f"),
    })).toEqual({
      status: "rejected",
      reason: "hash-mismatch",
      path: "$.provenanceSha256",
    });
    expect(parseStudioBrushRenderProvenanceCrdtSidecar({
      ...created.sidecar,
      bytes: new Uint8Array([1]),
    })).toEqual({
      status: "rejected",
      reason: "unknown-field",
      path: "$.bytes",
    });
  });
});
