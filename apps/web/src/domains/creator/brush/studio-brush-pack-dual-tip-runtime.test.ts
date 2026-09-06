import { describe, expect, it } from "vitest";

import { STUDIO_DUAL_TIP_CONTRACT_VERSION } from "../studio-dual-brush-tip-engine";

import { serializeStudioBrushDynamicsSettingsCanonical } from "./studio-brush-dynamics";
import {
  materializeStudioBrushPackSelection,
  materializeStudioBrushPackSelectionWithDualTip,
  normalizeStudioBrushPackDualTipDescriptor,
  renderStudioBrushPackDualTipIfConfigured,
  serializeStudioBrushPackDualTipDescriptorCanonical,
  studioBrushPackRuntimeSignature,
  studioBrushPackRuntimeSignatureWithDualTip,
  type StudioBrushPackDualTipDescriptor,
  type StudioBrushPackDualTipRenderInput,
  type StudioBrushPackSelection,
} from "./studio-brush-pack-runtime";

const CATALOG_ID = "g-pen-flex";

function legacySelection(): StudioBrushPackSelection {
  const selection = materializeStudioBrushPackSelection(CATALOG_ID);
  if (!selection) throw new Error("missing brush pack fixture");
  return selection;
}

function renderInput(
  overrides: Partial<StudioBrushPackDualTipRenderInput> = {}
): StudioBrushPackDualTipRenderInput {
  return {
    samples: [
      { x: 4.5, y: 16.5, pressure: 0.25, velocity: 120 },
      { x: 28.5, y: 16.5, pressure: 0.85, tiltX: 0.4, tiltY: 0.2, velocity: 640 },
    ],
    diameter: 10,
    spacingRatio: 0.3,
    seed: 0x7a31_9c2d,
    opacity: 0.8,
    linearColor: [0.7, 0.35, 0.15],
    output: { width: 33, height: 33 },
    ...overrides,
  };
}

const configuredDescriptor: StudioBrushPackDualTipDescriptor = {
  contractVersion: STUDIO_DUAL_TIP_CONTRACT_VERSION,
  secondaryTip: {
    shape: "star",
    softness: 0.18,
  },
  combineMode: "max",
  primaryTransform: {
    rotationDegrees: 8,
    scaleX: 1.1,
    scaleY: 0.92,
  },
  secondaryTransform: {
    rotationDegrees: -22,
    scaleX: 0.72,
    scaleY: 1.18,
    offsetX: 0.16,
    offsetY: -0.12,
  },
  dynamics: {
    pressureSizeGain: 0.7,
    pressureOpacityGain: 0.6,
    tiltStretchGain: 0.8,
    tiltRotationGain: 0.3,
    velocitySizeGain: 0.15,
    velocityOpacityGain: 0.2,
    referenceVelocity: 1_200,
  },
  jitter: {
    position: 0.08,
    rotationDegrees: 14,
    scale: 0.12,
    opacity: 0.1,
  },
};

describe("brush-pack dual-tip adapter — single-tip compatibility", () => {
  it("keeps legacy selection JSON and runtime signatures unchanged when no descriptor exists", () => {
    const selection = legacySelection();
    const replay = materializeStudioBrushPackSelection(CATALOG_ID);
    const expectedLegacySignature = [
      selection.runtimeBrushId,
      serializeStudioBrushDynamicsSettingsCanonical(selection.brushDynamics),
    ].join(":");

    expect(selection.dualTip).toBeUndefined();
    expect(replay).toEqual(selection);
    expect(JSON.stringify(replay)).toBe(JSON.stringify(selection));
    expect(studioBrushPackRuntimeSignature(CATALOG_ID)).toBe(expectedLegacySignature);
  });

  it("returns the pass-through sentinel before reading any legacy renderer state", () => {
    const poisonedLegacySelection = Object.defineProperty(
      {},
      "brushDynamics",
      {
        enumerable: true,
        get: () => {
          throw new Error("single-tip fast path must not be inspected");
        },
      }
    ) as StudioBrushPackSelection;

    expect(renderStudioBrushPackDualTipIfConfigured(
      poisonedLegacySelection,
      null as unknown as StudioBrushPackDualTipRenderInput
    )).toBeNull();
  });
});

describe("brush-pack dual-tip adapter — canonical optional descriptor", () => {
  it("applies finite defaults without enabling the descriptor when it is absent", () => {
    const fallbackTip = legacySelection().brushDynamics.tip;

    expect(normalizeStudioBrushPackDualTipDescriptor(undefined, fallbackTip)).toBeNull();
    expect(normalizeStudioBrushPackDualTipDescriptor({}, fallbackTip)).toEqual({
      contractVersion: STUDIO_DUAL_TIP_CONTRACT_VERSION,
      secondaryTip: fallbackTip,
      combineMode: "multiply",
      primaryTransform: {
        rotationDegrees: 0,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      },
      secondaryTransform: {
        rotationDegrees: 0,
        scaleX: 1,
        scaleY: 1,
        offsetX: 0,
        offsetY: 0,
      },
      dynamics: {
        pressureSizeGain: 0,
        pressureOpacityGain: 0,
        tiltStretchGain: 0,
        tiltRotationGain: 0,
        velocitySizeGain: 0,
        velocityOpacityGain: 0,
        referenceVelocity: 1_000,
      },
      jitter: {
        position: 0,
        rotationDegrees: 0,
        scale: 0,
        opacity: 0,
      },
    });
  });

  it("round-trips one normalized descriptor through selection, canonical JSON and signature", () => {
    const normalized = normalizeStudioBrushPackDualTipDescriptor(configuredDescriptor);
    const canonical = serializeStudioBrushPackDualTipDescriptorCanonical(configuredDescriptor);
    const selection = materializeStudioBrushPackSelectionWithDualTip(
      CATALOG_ID,
      configuredDescriptor
    );
    const replay = materializeStudioBrushPackSelectionWithDualTip(
      CATALOG_ID,
      JSON.parse(canonical!)
    );
    const legacySignature = studioBrushPackRuntimeSignature(CATALOG_ID);
    const firstSignature = studioBrushPackRuntimeSignatureWithDualTip(
      CATALOG_ID,
      configuredDescriptor
    );
    const replaySignature = studioBrushPackRuntimeSignatureWithDualTip(
      CATALOG_ID,
      JSON.parse(canonical!)
    );

    expect(normalized).not.toBeNull();
    expect(canonical).toBe(JSON.stringify(normalized));
    expect(selection?.dualTip).toEqual(normalized);
    expect(replay).toEqual(selection);
    expect(firstSignature).toBe(replaySignature);
    expect(firstSignature).not.toBe(legacySignature);
    expect(structuredClone(selection)).toEqual(selection);
  });
});

describe("brush-pack dual-tip adapter — CPU oracle bridge", () => {
  it("materializes both pack tips and produces a deterministic CPU-authoritative artifact", () => {
    const selection = materializeStudioBrushPackSelectionWithDualTip(
      CATALOG_ID,
      configuredDescriptor
    )!;
    const first = renderStudioBrushPackDualTipIfConfigured(selection, renderInput());
    const replay = renderStudioBrushPackDualTipIfConfigured(selection, renderInput());

    expect(first).toEqual(replay);
    expect(first?.ok).toBe(true);
    if (!first || !first.ok) throw new Error("dual-tip fixture did not render");
    expect(first.artifact.stampCount).toBeGreaterThan(1);
    expect(first.artifact.commands.count).toBe(first.artifact.stampCount);
    expect(first.artifact.receipt).toMatchObject({
      provenance: "clean-room-public-behavior",
      authority: "cpu-f32-oracle",
      packedCommandContract: "gpu-wasm-ready-f32-v1",
    });
    expect(first.artifact.premultipliedLinearRgba.some(
      (value, index) => index % 4 === 3 && value > 0
    )).toBe(true);
  });

  it("forwards oracle work-budget overflow without a partial artifact", () => {
    const selection = materializeStudioBrushPackSelectionWithDualTip(
      CATALOG_ID,
      {
        secondaryTip: { shape: "hard", softness: 0 },
        combineMode: "max",
      }
    )!;
    const result = renderStudioBrushPackDualTipIfConfigured(selection, renderInput({
      samples: [{ x: 64, y: 64, pressure: 0.5 }],
      diameter: 64,
      output: { width: 128, height: 128 },
      workBudget: 10,
    }));

    expect(result).toEqual({
      ok: false,
      error: {
        code: "budget-exceeded",
        stage: "planning",
      },
    });
  });

  it.each([
    ["zero seed", { seed: 0 }],
    ["non-finite sample", { samples: [{ x: Number.NaN, y: 4 }] }],
    ["zero output", { output: { width: 0, height: 16 } }],
    ["non-finite diameter", { diameter: Number.NaN }],
  ] as const)("fails closed for malformed oracle input: %s", (_label, overrides) => {
    const selection = materializeStudioBrushPackSelectionWithDualTip(
      CATALOG_ID,
      configuredDescriptor
    )!;
    const result = renderStudioBrushPackDualTipIfConfigured(
      selection,
      renderInput(overrides as unknown as Partial<StudioBrushPackDualTipRenderInput>)
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        stage: "validation",
      },
    });
  });
});

describe("brush-pack dual-tip adapter — malformed descriptor boundary", () => {
  it.each([
    ["non-object", "dual"],
    ["unsupported contract", { contractVersion: 2 }],
    ["unknown combine mode", { combineMode: "__proto__" }],
    ["collapsed secondary scale", { secondaryTransform: { scaleX: 0 } }],
    ["primary offset", { primaryTransform: { offsetX: 0.1 } }],
    ["non-finite dynamics", { dynamics: { velocitySizeGain: Number.NaN } }],
    ["out-of-range dynamics", { dynamics: { pressureSizeGain: 2 } }],
    ["negative jitter", { jitter: { position: -0.1 } }],
    ["unknown tip shape", { secondaryTip: { shape: "vendor-tip" } }],
    ["invalid custom alpha", {
      secondaryTip: {
        shape: "hard",
        alphaMapSize: 8,
        alphaMapBase64: "not-base64",
      },
    }],
  ] as const)("rejects %s without silently activating defaults", (_label, malformed) => {
    expect(normalizeStudioBrushPackDualTipDescriptor(malformed)).toBeNull();
    expect(serializeStudioBrushPackDualTipDescriptorCanonical(malformed)).toBeNull();
    expect(materializeStudioBrushPackSelectionWithDualTip(CATALOG_ID, malformed)).toBeNull();
  });

  it("rejects a forged malformed descriptor at the invocation boundary", () => {
    const selection = {
      ...legacySelection(),
      dualTip: {
        contractVersion: STUDIO_DUAL_TIP_CONTRACT_VERSION,
        combineMode: "max",
        secondaryTransform: { scaleX: Number.NaN },
      },
    } as unknown as StudioBrushPackSelection;

    expect(renderStudioBrushPackDualTipIfConfigured(selection, renderInput())).toEqual({
      ok: false,
      error: {
        code: "invalid-request",
        stage: "validation",
      },
    });
  });
});
