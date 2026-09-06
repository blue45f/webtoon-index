// @ts-expect-error -- jsdom is a test-only runtime fixture and does not bundle TypeScript types.
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STUDIO_INKML_PROFILE,
  encodeStudioInkMl,
} from "./studio-inkml-codec";
import {
  STUDIO_INKML_CONFORMANCE_CAPABILITIES,
  STUDIO_INKML_CONFORMANCE_MANIFEST,
  STUDIO_INKML_CONFORMANCE_PROFILE_ID,
  STUDIO_INKML_CONFORMANCE_PROFILE_VERSION,
  STUDIO_INKML_ROUND_TRIP_TOLERANCE,
  negotiateStudioInkMlConformance,
  validateStudioInkMlConformance,
} from "./studio-inkml-conformance";

const originalDomParser = globalThis.DOMParser;

beforeEach(() => {
  const window = new JSDOM("").window;
  Object.defineProperty(globalThis, "DOMParser", {
    configurable: true,
    value: window.DOMParser,
  });
});

afterEach(() => {
  if (originalDomParser) {
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: originalDomParser,
    });
  } else {
    Reflect.deleteProperty(globalThis, "DOMParser");
  }
});

function request(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: STUDIO_INKML_CONFORMANCE_PROFILE_ID,
    version: STUDIO_INKML_CONFORMANCE_PROFILE_VERSION,
    acceptedDocumentProfiles: [STUDIO_INKML_PROFILE, "inkml-basic"],
    requiredCapabilities: [],
    ...overrides,
  };
}

describe("Studio InkML conformance", () => {
  it("publishes explicit channel, context, brush, traceGroup and provider boundaries", () => {
    expect(STUDIO_INKML_CONFORMANCE_MANIFEST.channels.map(({ name }) => name))
      .toEqual(["X", "Y", "F", "OTx", "OTy", "OR", "TS.S", "TS.TP"]);
    expect(STUDIO_INKML_CONFORMANCE_MANIFEST.context).toMatchObject({
      explicitTraceFormatReference: "supported",
      inheritance: "rejected",
      canvasTransform: "rejected",
    });
    expect(STUDIO_INKML_CONFORMANCE_MANIFEST.brush).toEqual({
      definitions: "rejected",
      brushReference: "rejected",
      vendorPayload: "provider-adapter-only",
    });
    expect(STUDIO_INKML_CONFORMANCE_MANIFEST.traceGroup).toEqual({
      elements: "rejected",
      inheritedContext: "rejected",
    });
    expect(
      STUDIO_INKML_CONFORMANCE_MANIFEST.providerBoundary
        .officialVendorCompatibility,
    ).toBe("not-claimed");
    expect(STUDIO_INKML_CONFORMANCE_CAPABILITIES).toContain(
      "provider:vendor-adapter-boundary-v1",
    );
  });

  it("issues the same deterministic receipt for the same exact v1 document", async () => {
    const source = encodeStudioInkMl([{
      id: "trace-deterministic",
      points: [1.123456789, 2.987654321, 10, 20],
      pressures: [0.1256789, 0.8754321],
      tiltXs: [12.25, -34.75],
      tiltYs: [-10.5, 45.125],
      twists: [0.1, 359.9],
      speeds: [0, 2.7654321],
      tangentialPressures: [-0.2, 0.6],
    }]);

    const first = await validateStudioInkMlConformance(source);
    const second = await validateStudioInkMlConformance(source);

    expect(first).toEqual(second);
    expect(first.receipt.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.source.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first.result.normalizedDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(first).toMatchObject({
      profile: {
        input: STUDIO_INKML_PROFILE,
        normalized: STUDIO_INKML_PROFILE,
      },
      result: {
        conformance: "passed",
        normalization: "stable",
        traceCount: 1,
        sampleCount: 2,
        ignoredChannels: [],
      },
      error: null,
    });
    expect(first.result.maximumAbsoluteError?.position)
      .toBeLessThanOrEqual(STUDIO_INKML_ROUND_TRIP_TOLERANCE.position);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.result)).toBe(true);
  });

  it("normalizes the bounded W3C basic profile and records ignored channels", async () => {
    const source =
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"LIGHT\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace xml:id=\"basic\" contextRef=\"#c\">1.123456789 2.987654321 99</trace></ink>";
    const receipt = await validateStudioInkMlConformance(source);

    expect(receipt).toMatchObject({
      profile: {
        input: "inkml-basic",
        normalized: STUDIO_INKML_PROFILE,
      },
      result: {
        conformance: "passed",
        normalization: "stable",
        traceCount: 1,
        sampleCount: 1,
        ignoredChannels: ["LIGHT"],
      },
      security: {
        xml: { outcome: "passed" },
        budget: { outcome: "within-budget" },
      },
      error: null,
    });
    expect(receipt.result.maximumAbsoluteError?.position).toBeGreaterThan(0);
    expect(receipt.limitations.join(" ")).toContain(
      "not Wacom WILL/UIM compatibility",
    );
  });

  it("negotiates a canonical capability order and fails closed for future requests", () => {
    const accepted = negotiateStudioInkMlConformance(request({
      acceptedDocumentProfiles: ["inkml-basic", STUDIO_INKML_PROFILE],
      requiredCapabilities: [
        "trace-group:unsupported-fail-closed-v1",
        "channel:position-v1",
      ],
    }));
    expect(accepted).toMatchObject({
      status: "accepted",
      request: {
        acceptedDocumentProfiles: [STUDIO_INKML_PROFILE, "inkml-basic"],
        requiredCapabilities: [
          "channel:position-v1",
          "trace-group:unsupported-fail-closed-v1",
        ],
      },
    });

    expect(negotiateStudioInkMlConformance(request({
      version: STUDIO_INKML_CONFORMANCE_PROFILE_VERSION + 1,
    }))).toMatchObject({
      status: "rejected",
      error: { code: "UNKNOWN_FUTURE_PROFILE_VERSION" },
    });
    expect(negotiateStudioInkMlConformance(request({
      requiredCapabilities: ["channel:neural-pressure-v9"],
    }))).toMatchObject({
      status: "rejected",
      error: { code: "UNSUPPORTED_CAPABILITY" },
    });
  });

  it("rejects unknown fields, duplicate capabilities and unknown profiles", () => {
    expect(negotiateStudioInkMlConformance({
      ...request(),
      vendorCertification: "wacom",
    })).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_CONFORMANCE_REQUEST" },
    });
    expect(negotiateStudioInkMlConformance(request({
      requiredCapabilities: [
        "channel:position-v1",
        "channel:position-v1",
      ],
    }))).toMatchObject({
      status: "rejected",
      error: { code: "INVALID_CONFORMANCE_REQUEST" },
    });
    expect(negotiateStudioInkMlConformance(request({
      acceptedDocumentProfiles: ["toonspectrum-inkml-v2"],
    }))).toMatchObject({
      status: "rejected",
      error: { code: "UNSUPPORTED_PROFILE" },
    });
  });

  it("rejects a negotiation request before attempting XML decoding", async () => {
    const receipt = await validateStudioInkMlConformance(
      "<not-even-inkml/>",
      {
        request: request({
          requiredCapabilities: ["future:vendor-brush-v99"],
        }),
      },
    );

    expect(receipt.error).toEqual({
      code: "UNSUPPORTED_CAPABILITY",
      phase: "negotiation",
    });
    expect(receipt.security.xml.outcome).toBe("not-evaluated");
    expect(receipt.security.budget.outcome).toBe("not-evaluated");
  });

  it("honors the caller's accepted document profiles", async () => {
    const receipt = await validateStudioInkMlConformance(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2</trace></ink>",
      {
        request: request({
          acceptedDocumentProfiles: [STUDIO_INKML_PROFILE],
        }),
      },
    );

    expect(receipt.profile.input).toBe("inkml-basic");
    expect(receipt.result.conformance).toBe("rejected");
    expect(receipt.error).toEqual({
      code: "UNSUPPORTED_DOCUMENT_PROFILE",
      phase: "negotiation",
    });
  });

  it("reports XML security and resource-budget rejections deterministically", async () => {
    const unsafe =
      "<!DOCTYPE ink [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>&xxe;</trace></ink>";
    const firstUnsafe = await validateStudioInkMlConformance(unsafe);
    const secondUnsafe = await validateStudioInkMlConformance(unsafe);
    expect(firstUnsafe).toEqual(secondUnsafe);
    expect(firstUnsafe.error).toEqual({
      code: "unsupported-channel-encoding",
      phase: "decode",
    });
    expect(firstUnsafe.security.xml.outcome).toBe("rejected");

    const overBudget = await validateStudioInkMlConformance(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2,3 4</trace></ink>",
      { maxSamples: 1 },
    );
    expect(overBudget.error).toEqual({
      code: "limit-exceeded",
      phase: "decode",
    });
    expect(overBudget.security.budget.outcome).toBe("budget-exceeded");
    expect(overBudget.security.budget.limits.maxSamples).toBe(1);
  });

  it("fails closed for brush references, trace groups and future declared profiles", async () => {
    const cases = [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><brush xml:id=\"unused\"/><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><brush xml:id=\"b\"/><trace brushRef=\"#b\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><traceGroup><trace>1 2</trace></traceGroup></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><annotation type=\"application/vnd.toonspectrum.inkml-profile\">toonspectrum-inkml-v2</annotation><trace>1 2</trace></ink>",
    ];
    for (const source of cases) {
      const receipt = await validateStudioInkMlConformance(source);
      expect(receipt.result.conformance).toBe("rejected");
      expect(receipt.error?.phase).toBe("decode");
      expect(receipt.receipt.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
  });
});
