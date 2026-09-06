// @ts-expect-error -- jsdom is a test-only runtime fixture and does not bundle TypeScript types.
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STUDIO_INKML_MEDIA_TYPE,
  STUDIO_INKML_PROFILE,
  StudioInkMlCodecError,
  decodeStudioInkMl,
  encodeStudioInkMl,
  studioDrawElementToInkMlTrace,
} from "./studio-inkml-codec";

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

describe("Studio InkML codec", () => {
  it("deterministically round-trips pressure, orientation, speed and barrel pressure", () => {
    const trace = studioDrawElementToInkMlTrace({
      id: "ink-1",
      type: "draw",
      kind: "freehand",
      mode: "pen",
      points: [1.25, 2.5, 30, 40],
      pressures: [0.25, 0.8],
      tiltXs: [12, 34],
      tiltYs: [-21, -43],
      twists: [45, 270],
      speeds: [0, 2.75],
      tangentialPressures: [-0.2, 0.6],
      stroke: "#123456",
      strokeWidth: 9,
    });
    const first = encodeStudioInkMl([trace]);
    const second = encodeStudioInkMl([{ ...trace }]);

    expect(first).toBe(second);
    expect(first.startsWith("<?xml version=\"1.0\"")).toBe(true);
    expect(first).toContain(STUDIO_INKML_PROFILE);
    expect(first).toContain("1.25 2.5 0.25 12 -21 315 ");
    expect(STUDIO_INKML_MEDIA_TYPE).toBe("application/inkml+xml");
    const decoded = decodeStudioInkMl(first);
    expect(decoded).toEqual({
      profile: STUDIO_INKML_PROFILE,
      traces: [{
        id: "ink-1",
        points: [1.25, 2.5, 30, 40],
        pressures: [0.25, 0.8],
        tiltXs: [12, 34],
        tiltYs: [-21, -43],
        twists: [45, 270],
        speeds: [0, 2.75],
        tangentialPressures: [-0.2, 0.6],
      }],
      ignoredChannels: [],
    });
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.traces[0]?.points)).toBe(true);
  });

  it("imports the standard minimal X/Y trace format without a commercial codec", () => {
    const decoded = decodeStudioInkMl(
      "<?xml version=\"1.1\"?><ink xmlns=\"http://www.w3.org/2003/InkML\"><trace xml:id=\"basic\">1 2,3.5 4.5</trace></ink>",
    );

    expect(decoded).toMatchObject({
      profile: "inkml-basic",
      traces: [{
        id: "basic",
        points: [1, 2, 3.5, 4.5],
        pressures: [0.5, 0.5],
      }],
    });
  });

  it("reports unknown numeric channels while preserving supported ones", () => {
    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"LIGHT\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1 2 99</trace></ink>",
    );
    expect(decoded.ignoredChannels).toEqual(["LIGHT"]);
    expect(decoded.traces[0]?.points).toEqual([1, 2]);
  });

  it.each([
    [
      "DTD",
      "<!DOCTYPE ink [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2</trace></ink>",
      "unsupported-channel-encoding",
    ],
    [
      "future profile",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><annotation type=\"application/vnd.toonspectrum.inkml-profile\">toonspectrum-inkml-v2</annotation><trace>1 2</trace></ink>",
      "unsupported-profile",
    ],
    [
      "relative compression",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2,'3 4</trace></ink>",
      "unsupported-channel-encoding",
    ],
    [
      "processing instruction",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><?xml-stylesheet href=\"https://attacker.invalid/a.xsl\"?><trace>1 2</trace></ink>",
      "unsupported-channel-encoding",
    ],
    [
      "empty declared profile",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><annotation type=\"application/vnd.toonspectrum.inkml-profile\"> </annotation><trace>1 2</trace></ink>",
      "unsupported-profile",
    ],
  ] as const)("fails closed for %s", (_, source, code) => {
    expect(() => decodeStudioInkMl(source)).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({ code }),
    );
  });

  it("enforces byte, stroke and sample budgets before returning a document", () => {
    expect(() => encodeStudioInkMl([
      { id: "one", points: [0, 0] },
      { id: "two", points: [1, 1] },
    ], { maxStrokes: 1 })).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2,3 4</trace></ink>",
      { maxSamples: 1 },
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2</trace></ink>",
      { maxBytes: 16 },
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
    expect(() => encodeStudioInkMl(
      [{ id: "bounded", points: [0, 0] }],
      { maxBytes: 256 },
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
  });

  it("rejects deeply nested XML before invoking the DOM parser", () => {
    const nested = "<g>".repeat(257) + "</g>".repeat(257);
    const source =
      `<ink xmlns="http://www.w3.org/2003/InkML">${nested}<trace>1 2</trace></ink>`;

    expect(() => decodeStudioInkMl(source)).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
  });

  it.each([
    { maxBytes: 0 },
    { maxBytes: -1 },
    { maxStrokes: Number.NaN },
    { maxSamples: 1.5 },
    { maxSamplesPerStroke: 200_001 },
  ])("fails closed for invalid caller budgets: %o", (options) => {
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace>1 2</trace></ink>",
      options,
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
  });

  it("rejects unresolved contexts, unsupported units and JavaScript-only numeric syntax", () => {
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><trace contextRef=\"#missing\">1 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-channel-encoding",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" units=\"mm\"/><channel name=\"Y\" units=\"mm\"/></traceFormat></definitions><trace>1 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-channel-encoding",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><trace>0x10 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-channel-encoding",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" type=\"decimal\"/><channel name=\"Y\" type=\"decimal\"/></traceFormat></definitions><trace>1e2 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-channel-encoding",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" type=\"decimal\" min=\"0x0\" max=\"0x64\"/><channel name=\"Y\"/></traceFormat></definitions><trace>1 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-channel-encoding",
      }),
    );
  });

  it("accepts exponent notation only for double channels", () => {
    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" type=\"double\"/><channel name=\"Y\" type=\"decimal\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1e2 2</trace></ink>",
    );
    expect(decoded.traces[0]?.points).toEqual([100, 2]);
  });

  it("uses the standard X/Y default when a definitions format is not referenced", () => {
    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"F\" units=\"%\" min=\"0\" max=\"1\"/></traceFormat></definitions><trace>1 2</trace></ink>",
    );
    expect(decoded.traces[0]).toMatchObject({
      points: [1, 2],
      pressures: [0.5],
    });
  });

  it("rejects unsupported streaming formats and inherited trace-group contexts", () => {
    for (const source of [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><traceFormat><channel name=\"Y\"/><channel name=\"X\"/></traceFormat><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat><context xml:id=\"c\" traceFormatRef=\"#f\"/></definitions><traceGroup contextRef=\"#c\"><trace>1 2</trace></traceGroup></ink>",
    ]) {
      expect(() => decodeStudioInkMl(source)).toThrow(
        expect.objectContaining<Partial<StudioInkMlCodecError>>({
          code: "unsupported-channel-encoding",
        }),
      );
    }
  });

  it("uses W3C fractional percent semantics for pressure", () => {
    const encoded = encodeStudioInkMl([{
      id: "quarter-pressure",
      points: [1, 2],
      pressures: [0.25],
    }]);
    expect(encoded).toContain(
      "<channel name=\"F\" type=\"decimal\" min=\"0\" max=\"1\" units=\"%\"/>",
    );
    expect(encoded).toContain(">1 2 0.25 ");

    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"F\" units=\"%\" min=\"0\" max=\"1\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1 2 0.25</trace></ink>",
    );
    expect(decoded.traces[0]?.pressures).toEqual([0.25]);

    const defaultUnit = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"F\" min=\"0\" max=\"100\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1 2 0.5</trace></ink>",
    );
    expect(defaultUnit.traces[0]?.pressures).toEqual([0.5]);
  });

  it("requires globally unique valid xml:id values and complete context references", () => {
    for (const source of [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"same\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"same\" traceFormatRef=\"#same\"/><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"bad id\" traceFormatRef=\"#f\"/><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\"/><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"https://example.invalid/f\"/><trace>1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#anonymous-format-0\"/><trace contextRef=\"#c\">1 2</trace></ink>",
    ]) {
      expect(() => decodeStudioInkMl(source)).toThrow(StudioInkMlCodecError);
    }
  });

  it("requires explicit normalization bounds for device-unit pressure", () => {
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"F\" units=\"dev\"/></traceFormat></definitions><trace>1 2 0.5</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-channel-encoding",
      }),
    );

    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"F\" units=\"dev\" min=\"0\" max=\"1024\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1 2 512</trace></ink>",
    );
    expect(decoded.traces[0]?.pressures).toEqual([0.5]);
  });

  it("requires units and normalizes ToonSpectrum speed and barrel-pressure channels", () => {
    for (const source of [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"TS.S\"/></traceFormat></definitions><trace>1 2 3</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"TS.TP\" units=\"dev\"/></traceFormat></definitions><trace>1 2 0.5</trace></ink>",
    ]) {
      expect(() => decodeStudioInkMl(source)).toThrow(
        expect.objectContaining<Partial<StudioInkMlCodecError>>({
          code: "unsupported-channel-encoding",
        }),
      );
    }

    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/><channel name=\"TS.S\" units=\"px/ms\"/><channel name=\"TS.TP\" units=\"dev\" min=\"0\" max=\"1024\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1 2 3 512</trace></ink>",
    );
    expect(decoded.traces[0]).toMatchObject({
      speeds: [3],
      tangentialPressures: [0],
    });
  });

  it("rejects foreign markup inside the declared ToonSpectrum profile", () => {
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><annotation type=\"application/vnd.toonspectrum.inkml-profile\"><foreign xmlns=\"urn:foreign\">toonspectrum-inkml-v1</foreign></annotation><trace>1 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-profile",
      }),
    );
  });

  it("does not promote a profile annotation without the exact v1 format and context", () => {
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><annotation type=\"application/vnd.toonspectrum.inkml-profile\">toonspectrum-inkml-v1</annotation><trace>1 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "unsupported-profile",
      }),
    );
  });

  it("rejects unsupported context semantics instead of silently ignoring transforms", () => {
    for (const context of [
      "<context xml:id=\"c\" traceFormatRef=\"#f\" contextRef=\"#missing\"/>",
      "<context xml:id=\"c\" traceFormatRef=\"#f\" canvasTransformRef=\"#missing-transform\"/>",
      "<context xml:id=\"c\" traceFormatRef=\"#f\"><brush/></context>",
    ]) {
      expect(() => decodeStudioInkMl(
        `<ink xmlns="http://www.w3.org/2003/InkML"><definitions><traceFormat xml:id="f"><channel name="X"/><channel name="Y"/></traceFormat></definitions>${context}<trace contextRef="#c">1 2</trace></ink>`,
      )).toThrow(
        expect.objectContaining<Partial<StudioInkMlCodecError>>({
          code: "unsupported-channel-encoding",
        }),
      );
    }
  });

  it("rejects trace, context and format placement outside the bounded archival layout", () => {
    for (const source of [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><trace>1 2</trace></definitions></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><foreign xmlns=\"urn:foreign\"><trace xmlns=\"http://www.w3.org/2003/InkML\">1 2</trace></foreign></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><foreign xmlns=\"urn:foreign\"><context xmlns=\"http://www.w3.org/2003/InkML\" xml:id=\"c\" traceFormatRef=\"#f\"/></foreign><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><trace contextRef=\"#c\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><foreign xmlns=\"urn:foreign\"><definitions xmlns=\"http://www.w3.org/2003/InkML\"><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions></foreign><trace>1 2</trace></ink>",
    ]) {
      expect(() => decodeStudioInkMl(source)).toThrow(
        expect.objectContaining<Partial<StudioInkMlCodecError>>({
          code: "unsupported-channel-encoding",
        }),
      );
    }
  });

  it("caps traceFormat channels before allocating the full parsed channel list", () => {
    const channels = Array.from(
      { length: 65 },
      (_, index) => `<channel name="C${index}"/>`,
    ).join("");
    Object.defineProperty(globalThis, "DOMParser", {
      configurable: true,
      value: class ForbiddenDomParser {
        constructor() {
          throw new Error("DOMParser must not run after the lexical channel cap.");
        }
      },
    });
    expect(() => decodeStudioInkMl(
      `<ink xmlns="http://www.w3.org/2003/InkML"><definitions><traceFormat xml:id="f">${channels}</traceFormat></definitions><trace>1 2</trace></ink>`,
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "limit-exceeded",
      }),
    );
  });

  it("converts supported radian orientation channels explicitly", () => {
    const decoded = decodeStudioInkMl(
      `<ink xmlns="http://www.w3.org/2003/InkML"><definitions><traceFormat xml:id="f"><channel name="X" units="px"/><channel name="Y" units="px"/><channel name="OTx" units="rad"/><channel name="OR" units="rad"/></traceFormat></definitions><context xml:id="c" traceFormatRef="#f"/><trace contextRef="#c">1 2 ${Math.PI / 2} ${Math.PI}</trace></ink>`,
    );
    expect(decoded.traces[0]).toMatchObject({
      tiltXs: [90],
      twists: [180],
    });
  });

  it("converts W3C counter-clockwise OR to Pointer Events clockwise twist", () => {
    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" units=\"px\"/><channel name=\"Y\" units=\"px\"/><channel name=\"OR\" units=\"deg\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">1 2 45</trace></ink>",
    );
    expect(decoded.traces[0]?.twists).toEqual([315]);
  });

  it("round-trips fractional Pointer Events twist without violating the OR bound", () => {
    const encodedLow = encodeStudioInkMl([{
      id: "fractional-twist",
      points: [1, 2],
      twists: [0.1],
    }]);
    expect(encodedLow).toContain(
      "<channel name=\"OR\" type=\"decimal\" min=\"0\" max=\"360\" units=\"deg\"/>",
    );
    expect(encodedLow).toContain(" 359.9 ");
    expect(decodeStudioInkMl(encodedLow).traces[0]?.twists[0]).toBeCloseTo(0.1, 6);

    const encodedHigh = encodeStudioInkMl([{
      id: "fractional-twist-high",
      points: [1, 2],
      twists: [359.9],
    }]);
    expect(encodedHigh).toContain(" 0.1 ");
    expect(decodeStudioInkMl(encodedHigh).traces[0]?.twists[0]).toBeCloseTo(359.9, 6);
    expect(() => encodeStudioInkMl([{
      id: "invalid-full-turn",
      points: [1, 2],
      twists: [360],
    }])).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "invalid-document",
      }),
    );
  });

  it("rejects non-whitespace text inside exact profile structure elements", () => {
    const encoded = encodeStudioInkMl([{
      id: "strict-text",
      points: [1, 2],
    }]);
    for (const mutated of [
      encoded.replace("<definitions>", "<definitions>junk"),
      encoded.replace(
        "<traceFormat xml:id=\"toonspectrum-trace-format-v1\">",
        "<traceFormat xml:id=\"toonspectrum-trace-format-v1\">junk",
      ),
      encoded.replace(
        "<channel name=\"X\" type=\"decimal\" units=\"px\"/>",
        "<channel name=\"X\" type=\"decimal\" units=\"px\">junk</channel>",
      ),
    ]) {
      expect(() => decodeStudioInkMl(mutated)).toThrow(
        expect.objectContaining<Partial<StudioInkMlCodecError>>({
          code: "unsupported-profile",
        }),
      );
    }
  });

  it("requires every provided export channel to align with the point count", () => {
    expect(() => encodeStudioInkMl([{
      id: "unaligned",
      points: [0, 0, 1, 1],
      pressures: [0.5],
    }])).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "invalid-document",
      }),
    );
  });

  it("does not silently export non-freehand shapes as digital ink", () => {
    expect(() => studioDrawElementToInkMlTrace({
      id: "shape-1",
      type: "draw",
      kind: "ellipse",
      mode: "pen",
      points: [0, 0, 10, 10],
      stroke: "#000000",
      strokeWidth: 1,
    })).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "invalid-document",
      }),
    );
  });

  it("rejects unsupported trace semantics instead of silently drawing them", () => {
    for (const source of [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace type=\"penUp\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace type=\"indeterminate\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace type=\"script\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace continuation=\"begin\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace priorRef=\"#previous\">1 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace brushRef=\"#brush\">1 2</trace></ink>",
    ]) {
      expect(() => decodeStudioInkMl(source)).toThrow(
        expect.objectContaining<Partial<StudioInkMlCodecError>>({
          code: "unsupported-channel-encoding",
        }),
      );
    }
  });

  it("enforces channel bounds and rejects unsupported orientation or mappings", () => {
    for (const source of [
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" max=\"10\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">999 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" orientation=\"-ve\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">5 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" respectTo=\"#origin\"/><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">5 2</trace></ink>",
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"><mapping/></channel><channel name=\"Y\"/></traceFormat></definitions><context xml:id=\"c\" traceFormatRef=\"#f\"/><trace contextRef=\"#c\">5 2</trace></ink>",
    ]) {
      expect(() => decodeStudioInkMl(source)).toThrow(StudioInkMlCodecError);
    }
  });

  it("accepts explicit penDown traces in the bounded profile", () => {
    const decoded = decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace type=\"penDown\">1 2</trace></ink>",
    );
    expect(decoded.traces[0]?.points).toEqual([1, 2]);
  });

  it("rejects duplicate trace and channel identifiers instead of accepting ambiguous ink", () => {
    expect(() => encodeStudioInkMl([
      { id: "same", points: [0, 0] },
      { id: "same", points: [1, 1] },
    ])).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "invalid-document",
      }),
    );
    expect(() => decodeStudioInkMl(
      "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\"/><channel name=\"X\"/><channel name=\"Y\"/></traceFormat></definitions><trace>1 1 2</trace></ink>",
    )).toThrow(
      expect.objectContaining<Partial<StudioInkMlCodecError>>({
        code: "invalid-document",
      }),
    );
  });

  it.each([
    "<ink xmlns=\"http://www.w3.org/2003/InkML\"><definitions><traceFormat xml:id=\"f\"><channel name=\"X\" min=\"NaN\"/><channel name=\"Y\"/></traceFormat></definitions><trace>1 2</trace></ink>",
    "<ink xmlns=\"http://www.w3.org/2003/InkML\"><trace><annotation>nested</annotation>1 2</trace></ink>",
  ])("rejects malformed channel bounds or nested trace markup", (source) => {
    expect(() => decodeStudioInkMl(source)).toThrow(StudioInkMlCodecError);
  });
});
