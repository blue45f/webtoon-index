import { describe, expect, it } from "vitest";

import {
  createStudioLayerLiftCompositionReceipt,
  isTrustedStudioLayerLiftCompositionReceipt,
  parseStudioLayerLiftCompositionReceipt,
  StudioLayerLiftCompositionReceiptError,
} from "./studio-layer-lift-composition-receipt";

import type {
  StudioLayerLiftCompositionReceipt,
  StudioLayerLiftCompositionReceiptInput,
} from "./studio-layer-lift-composition-receipt";

const digest = (character: string): `sha256:${string}` =>
  `sha256:${character.repeat(64)}`;

function input(): StudioLayerLiftCompositionReceiptInput {
  return {
    requestId: "lift-request-1",
    sourceSha256: digest("1"),
    providerReceiptSha256: digest("2"),
    providerLayers: [
      {
        layerId: "sky",
        role: "background",
        order: 0,
        rgba: { sha256: digest("3") },
        mask: { sha256: digest("4") },
      },
      {
        layerId: "hero",
        role: "character",
        order: 1,
        rgba: { sha256: digest("5") },
        mask: { sha256: digest("6") },
      },
      {
        layerId: "dialogue",
        role: "speech-bubble",
        order: 2,
        rgba: { sha256: digest("7") },
        mask: { sha256: digest("8") },
      },
    ],
    compositor: {
      id: "toonspectrum.layer-lift-compositor",
      version: "1.0.0",
    },
    background: {
      outputId: "lift-background-1",
      artifactSha256: digest("9"),
      contributorLayerIds: ["sky"],
    },
    foreground: {
      outputId: "lift-foreground-1",
      artifactSha256: digest("a"),
      contributorLayerIds: ["hero", "dialogue"],
    },
  };
}

function mutableClone(
  receipt: StudioLayerLiftCompositionReceipt,
): Record<string, any> {
  return structuredClone(receipt) as Record<string, any>;
}

describe("Scene Layer Lift composition provenance receipt", () => {
  it("creates and parses the exact canonical receipt", () => {
    const created = createStudioLayerLiftCompositionReceipt(input());
    expect(created).toEqual({
      kind: "toonspectrum.scene-layer-lift/composition-receipt",
      version: 1,
      ...input(),
      receiptSha256:
        "sha256:88ced95ac2d515b98b868be9f43a5db11293a08440e0c1dc941ea35de2e58be4",
    });
    expect(isTrustedStudioLayerLiftCompositionReceipt(created)).toBe(true);

    const transported = structuredClone(created);
    expect(isTrustedStudioLayerLiftCompositionReceipt(transported)).toBe(false);
    const parsed = parseStudioLayerLiftCompositionReceipt(transported);
    expect(parsed).toEqual({ ok: true, value: created });
    if (!parsed.ok) throw new Error("Expected a valid composition receipt.");
    expect(parsed.value).not.toBe(created);
    expect(parsed.value).not.toBe(transported);
    expect(isTrustedStudioLayerLiftCompositionReceipt(parsed.value)).toBe(true);
    expect(isTrustedStudioLayerLiftCompositionReceipt(transported)).toBe(false);
  });

  it.each([
    ["request ID", (value: Record<string, any>) => { value.requestId = "other"; }],
    ["source SHA", (value: Record<string, any>) => { value.sourceSha256 = digest("b"); }],
    ["provider receipt SHA", (value: Record<string, any>) => {
      value.providerReceiptSha256 = digest("b");
    }],
    ["provider layer ID", (value: Record<string, any>) => {
      value.providerLayers[0].layerId = "other-layer";
    }],
    ["provider layer role", (value: Record<string, any>) => {
      value.providerLayers[0].role = "effect";
    }],
    ["provider layer order", (value: Record<string, any>) => {
      value.providerLayers[0].order = 1;
    }],
    ["provider RGBA SHA", (value: Record<string, any>) => {
      value.providerLayers[0].rgba.sha256 = digest("b");
    }],
    ["provider mask SHA", (value: Record<string, any>) => {
      value.providerLayers[0].mask.sha256 = digest("b");
    }],
    ["compositor ID", (value: Record<string, any>) => {
      value.compositor.id = "other-compositor";
    }],
    ["compositor version", (value: Record<string, any>) => {
      value.compositor.version = "2.0.0";
    }],
    ["background output ID", (value: Record<string, any>) => {
      value.background.outputId = "other-background";
    }],
    ["background artifact SHA", (value: Record<string, any>) => {
      value.background.artifactSha256 = digest("b");
    }],
    ["background contributor", (value: Record<string, any>) => {
      value.background.contributorLayerIds = ["hero"];
      value.foreground.contributorLayerIds = ["sky", "dialogue"];
    }],
    ["foreground output ID", (value: Record<string, any>) => {
      value.foreground.outputId = "other-foreground";
    }],
    ["foreground artifact SHA", (value: Record<string, any>) => {
      value.foreground.artifactSha256 = digest("b");
    }],
    ["foreground contributor", (value: Record<string, any>) => {
      value.foreground.contributorLayerIds = ["dialogue", "hero"];
    }],
  ])("rejects tampered %s binding", (_label, mutate) => {
    const value = mutableClone(createStudioLayerLiftCompositionReceipt(input()));
    mutate(value);
    expect(parseStudioLayerLiftCompositionReceipt(value).ok).toBe(false);
  });

  it("rejects mixed, duplicate, missing and unknown contributor layers", () => {
    const mixed = input();
    expect(() =>
      createStudioLayerLiftCompositionReceipt({
        ...mixed,
        background: {
          ...mixed.background,
          contributorLayerIds: ["hero", "sky"],
        },
        foreground: {
          ...mixed.foreground,
          contributorLayerIds: ["dialogue"],
        },
      }),
    ).toThrowError(StudioLayerLiftCompositionReceiptError);

    const duplicate = input();
    expect(() =>
      createStudioLayerLiftCompositionReceipt({
        ...duplicate,
        background: {
          ...duplicate.background,
          contributorLayerIds: ["sky", "hero"],
        },
        foreground: {
          ...duplicate.foreground,
          contributorLayerIds: ["hero", "dialogue"],
        },
      }),
    ).toThrowError(StudioLayerLiftCompositionReceiptError);

    const missing = input();
    expect(() =>
      createStudioLayerLiftCompositionReceipt({
        ...missing,
        foreground: {
          ...missing.foreground,
          contributorLayerIds: ["hero"],
        },
      }),
    ).toThrowError(StudioLayerLiftCompositionReceiptError);

    const unknown = input();
    expect(() =>
      createStudioLayerLiftCompositionReceipt({
        ...unknown,
        foreground: {
          ...unknown.foreground,
          contributorLayerIds: ["hero", "unknown"],
        },
      }),
    ).toThrowError(StudioLayerLiftCompositionReceiptError);
  });

  it("rejects duplicate provider layer IDs and non-dense provider order", () => {
    const duplicate = input();
    expect(() =>
      createStudioLayerLiftCompositionReceipt({
        ...duplicate,
        providerLayers: [
          duplicate.providerLayers[0],
          {
            ...duplicate.providerLayers[1],
            layerId: duplicate.providerLayers[0].layerId,
          },
          duplicate.providerLayers[2],
        ],
      }),
    ).toThrowError(StudioLayerLiftCompositionReceiptError);

    const nonDense = input();
    expect(() =>
      createStudioLayerLiftCompositionReceipt({
        ...nonDense,
        providerLayers: [
          nonDense.providerLayers[0],
          { ...nonDense.providerLayers[1], order: 3 },
          nonDense.providerLayers[2],
        ],
      }),
    ).toThrowError(StudioLayerLiftCompositionReceiptError);
  });

  it("rejects unknown fields and accessors without invoking them", () => {
    const unknown = mutableClone(
      createStudioLayerLiftCompositionReceipt(input()),
    );
    unknown.extra = true;
    expect(parseStudioLayerLiftCompositionReceipt(unknown)).toMatchObject({
      ok: false,
      reason: "invalid-shape",
    });

    const accessor = mutableClone(
      createStudioLayerLiftCompositionReceipt(input()),
    );
    let getterCalls = 0;
    Object.defineProperty(accessor.providerLayers[0].rgba, "sha256", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return digest("3");
      },
    });
    expect(parseStudioLayerLiftCompositionReceipt(accessor)).toMatchObject({
      ok: false,
      reason: "invalid-shape",
    });
    expect(getterCalls).toBe(0);
  });

  it("deep-freezes every product-owned nested value", () => {
    const receipt = createStudioLayerLiftCompositionReceipt(input());
    const values = [
      receipt,
      receipt.providerLayers,
      ...receipt.providerLayers,
      ...receipt.providerLayers.flatMap((layer) => [layer.rgba, layer.mask]),
      receipt.compositor,
      receipt.background,
      receipt.background.contributorLayerIds,
      receipt.foreground,
      receipt.foreground.contributorLayerIds,
    ];
    expect(values.every(Object.isFrozen)).toBe(true);
  });

  it("does not trust an arbitrary structural forgery", () => {
    const receipt = createStudioLayerLiftCompositionReceipt(input());
    const forged = mutableClone(receipt);

    expect(forged).toEqual(receipt);
    expect(isTrustedStudioLayerLiftCompositionReceipt(forged)).toBe(false);
    expect(
      isTrustedStudioLayerLiftCompositionReceipt({
        ...forged,
        receiptSha256: receipt.receiptSha256,
      }),
    ).toBe(false);
  });
});
