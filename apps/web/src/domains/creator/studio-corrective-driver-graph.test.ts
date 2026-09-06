import { describe, expect, it } from "vitest";

import {
  bakeStudioCorrectiveDriverGraph,
  compileStudioCorrectiveDriverGraph,
  evaluateStudioCorrectiveDriverGraph,
  previewStudioCorrectiveDriver,
  type StudioCorrectiveChannel,
  type StudioCorrectiveCorrection,
  type StudioCorrectiveDriver,
  type StudioCorrectiveDriverGraph,
} from "./studio-corrective-driver-graph";

type MutableGraph = Omit<
  StudioCorrectiveDriverGraph,
  "drivers" | "channels" | "corrections"
> & {
  drivers: StudioCorrectiveDriver[];
  channels: StudioCorrectiveChannel[];
  corrections: StudioCorrectiveCorrection[];
};

function graph(
  policy:
    | "additive"
    | "maximum-magnitude"
    | "priority-override"
    | "normalized-blend" = "additive",
): MutableGraph {
  return {
    kind: "studio-corrective-driver-graph",
    version: 1,
    graphId: "hero-face-rig",
    revision: 4,
    drivers: [
      {
        id: "head-turn",
        sourceKind: "bone-rotation",
        subjectId: "head",
        component: "y",
        unit: "degrees",
        inputMin: -90,
        inputMax: 90,
      },
      {
        id: "smile",
        sourceKind: "morph-weight",
        subjectId: "smile",
        component: "scalar",
        unit: "normalized",
        inputMin: 0,
        inputMax: 1,
      },
    ],
    channels: [
      {
        id: "cheek-corrective",
        kind: "mesh-corrective-weight",
        subjectId: "cheek-turn",
        component: "scalar",
        baseValue: 0,
        minimum: -1,
        maximum: 1,
        conflictPolicy: policy,
      },
    ],
    corrections: [
      {
        id: "turn-cheek",
        priority: 1,
        combine: "multiply",
        terms: [
          {
            driverId: "head-turn",
            curve: [
              { input: -90, output: 0 },
              { input: 0, output: 0 },
              { input: 90, output: 1 },
            ],
          },
        ],
        outputs: [
          {
            channelId: "cheek-corrective",
            curve: [
              { input: 0, output: 0 },
              { input: 0.5, output: 0.3 },
              { input: 1, output: 0.8 },
            ],
          },
        ],
      },
      {
        id: "turn-smile-cheek",
        priority: 8,
        combine: "minimum",
        terms: [
          {
            driverId: "head-turn",
            curve: [
              { input: 0, output: 0 },
              { input: 90, output: 1 },
            ],
          },
          {
            driverId: "smile",
            curve: [
              { input: 0, output: 0 },
              { input: 1, output: 1 },
            ],
          },
        ],
        outputs: [
          {
            channelId: "cheek-corrective",
            curve: [
              { input: 0, output: 0 },
              { input: 1, output: -0.4 },
            ],
          },
        ],
      },
    ],
  };
}

function compiled(
  policy?:
    | "additive"
    | "maximum-magnitude"
    | "priority-override"
    | "normalized-blend",
) {
  const result = compileStudioCorrectiveDriverGraph(graph(policy));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe("studio corrective driver graph", () => {
  it("compiles to detached immutable plain data with a stable digest", () => {
    const source = graph();
    const first = compileStudioCorrectiveDriverGraph(source);
    const second = compileStudioCorrectiveDriverGraph(graph());
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.graphSha256).toBe(second.value.graphSha256);
    source.drivers[0] = { ...source.drivers[0], subjectId: "mutated" };
    expect(first.value.graph.drivers[0].subjectId).toBe("head");
    expect(Object.isFrozen(first.value.graph.corrections[0].terms)).toBe(true);
  });

  it("evaluates nonlinear and multi-driver correctives deterministically", () => {
    const result = evaluateStudioCorrectiveDriverGraph(
      compiled(),
      { "head-turn": 45, smile: 0.25 },
    );
    // turn-cheek = .3; turn-smile-cheek activation=.25 => -.1
    expect(result.activations).toEqual({
      "turn-cheek": 0.5,
      "turn-smile-cheek": 0.25,
    });
    expect(result.channels["cheek-corrective"]).toBeCloseTo(0.2, 6);
    expect(result.contributions["cheek-corrective"]).toHaveLength(2);
  });

  it.each([
    ["maximum-magnitude", 0.3],
    ["priority-override", -0.1],
    // (.3*.5 + -.1*.25) / .75
    ["normalized-blend", 1 / 6],
  ] as const)("resolves %s conflicts predictably", (policy, expected) => {
    const result = evaluateStudioCorrectiveDriverGraph(
      compiled(policy),
      { "head-turn": 45, smile: 0.25 },
    );
    expect(result.channels["cheek-corrective"]).toBeCloseTo(expected, 6);
  });

  it("clamps base overrides and final output to the channel domain", () => {
    const result = evaluateStudioCorrectiveDriverGraph(
      compiled(),
      { "head-turn": 90, smile: 0 },
      { "cheek-corrective": 99 },
    );
    expect(result.channels["cheek-corrective"]).toBe(1);
  });

  it("builds onion-style previews without mutating the current drivers", () => {
    const drivers = { "head-turn": 30, smile: 0 };
    const frames = previewStudioCorrectiveDriver(
      compiled(),
      drivers,
      "head-turn",
      [-30, 0, 30],
    );
    expect(frames.map((frame) => frame.driverValue)).toEqual([0, 30, 60]);
    expect(frames[0].evaluation.channels["cheek-corrective"]).toBe(0);
    expect(frames[2].evaluation.channels["cheek-corrective"]).toBeGreaterThan(
      frames[1].evaluation.channels["cheek-corrective"],
    );
    expect(drivers["head-turn"]).toBe(30);
  });

  it("bakes channel-major contracts to deterministic Float32 payloads", () => {
    const rig = compiled();
    const samples = [
      { sampleId: "frame-0", drivers: { "head-turn": 0, smile: 0 } },
      { sampleId: "frame-1", drivers: { "head-turn": 90, smile: 0 } },
    ];
    const first = bakeStudioCorrectiveDriverGraph(rig, samples);
    const second = bakeStudioCorrectiveDriverGraph(rig, samples);
    expect(first.values[0]).toBe(0);
    expect(first.values[1]).toBeCloseTo(0.8, 6);
    expect(first.valuesSha256).toBe(second.valuesSha256);
    expect(first.graphSha256).toBe(rig.graphSha256);
    expect(first.sampleIds).toEqual(["frame-0", "frame-1"]);
  });

  it("fails closed on missing references, duplicate ids and malformed curves", () => {
    const missing = graph();
    missing.corrections[0] = {
      ...missing.corrections[0],
      terms: [
        {
          driverId: "missing",
          curve: [
            { input: 0, output: 0 },
            { input: 1, output: 1 },
          ],
        },
      ],
    };
    expect(compileStudioCorrectiveDriverGraph(missing)).toMatchObject({
      ok: false,
      code: "missing-reference",
    });

    const duplicate = graph();
    duplicate.channels[0] = {
      ...duplicate.channels[0],
      id: duplicate.drivers[0].id,
    };
    duplicate.corrections = duplicate.corrections.map((correction) => ({
      ...correction,
      outputs: correction.outputs.map((output) => ({
        ...output,
        channelId: duplicate.drivers[0].id,
      })),
    }));
    // Driver and channel namespaces are deliberately independent.
    expect(compileStudioCorrectiveDriverGraph(duplicate).ok).toBe(true);
    duplicate.drivers[1] = {
      ...duplicate.drivers[1],
      id: duplicate.drivers[0].id,
    };
    expect(compileStudioCorrectiveDriverGraph(duplicate)).toMatchObject({
      ok: false,
      code: "duplicate-id",
    });

    const malformed = graph();
    malformed.corrections[0] = {
      ...malformed.corrections[0],
      outputs: [
        {
          channelId: "cheek-corrective",
          curve: [
            { input: 0.5, output: 0 },
            { input: 1, output: 1 },
          ],
        },
      ],
    };
    expect(compileStudioCorrectiveDriverGraph(malformed)).toMatchObject({
      ok: false,
      code: "invalid-graph",
    });
  });

  it("rejects invalid preview and bake requests at the public boundary", () => {
    const rig = compiled();
    expect(() =>
      previewStudioCorrectiveDriver(rig, {}, "missing", [0]),
    ).toThrow(/unknown corrective driver/);
    expect(() =>
      bakeStudioCorrectiveDriverGraph(rig, [
        { sampleId: "same", drivers: {} },
        { sampleId: "same", drivers: {} },
      ]),
    ).toThrow(/unique/);
    expect(() =>
      bakeStudioCorrectiveDriverGraph(rig, [
        { sampleId: "bad", drivers: { "head-turn": Number.NaN } },
      ]),
    ).toThrow(/invalid/);
  });
});
