import { describe, expect, it } from "vitest";

import {
  STUDIO_NAMED_STATE_VERSION,
  compareStudioNamedStates,
  createEmptyStudioNamedStateDocument,
  normalizeStudioNamedStateDocument,
  parseStudioNamedStateDocument,
  planStudioNamedStateApplication,
  resolveStudioNamedState,
  serializeStudioNamedStateDocument,
} from "./studio-named-states";

function document() {
  return {
    version: STUDIO_NAMED_STATE_VERSION,
    revision: 7,
    activeStateId: "night-ja",
    states: [
      {
        id: "night-ja",
        name: "야간 일본어",
        revision: 4,
        baseStateId: "night",
        patch: {
          tokenModes: { locale: "ja" },
          variants: {
            "character.hero": { expression: "focused" },
          },
          textDataSetId: "dialogue.ja",
          outputRecipeId: "publish.mobile-ja",
        },
      },
      {
        id: "night",
        name: "야간",
        revision: 3,
        baseStateId: "base",
        patch: {
          tokenModes: { time: "night" },
          effectParameters: {
            "panel.1": { rimLight: 0.8, lut: "night-blue" },
          },
          shotParameters: {
            "shot.1": { exposure: -0.5 },
          },
        },
      },
      {
        id: "base",
        name: "기본",
        revision: 2,
        patch: {
          visibility: {
            "draft.notes": false,
            "panel.1": true,
          },
          tokenModes: {
            locale: "ko",
            platform: "mobile",
            time: "day",
          },
          variants: {
            "character.hero": {
              costume: "school",
              expression: "neutral",
            },
          },
          textDataSetId: "dialogue.ko",
        },
      },
    ],
  };
}

describe("Studio named states", () => {
  it("resolves sparse independent axes and local overrides in deterministic base order", () => {
    const resolved = resolveStudioNamedState(document(), "night-ja");

    expect(resolved.inheritanceChain).toEqual(["base", "night", "night-ja"]);
    expect(resolved.tokenModes).toEqual({
      locale: "ja",
      platform: "mobile",
      time: "night",
    });
    expect(resolved.variants["character.hero"]).toEqual({
      costume: "school",
      expression: "focused",
    });
    expect(resolved.effectParameters["panel.1"]).toEqual({
      lut: "night-blue",
      rimLight: 0.8,
    });
    expect(resolved.textDataSetId).toBe("dialogue.ja");
    expect(resolved.outputRecipeId).toBe("publish.mobile-ja");
  });

  it("uses null as an explicit sparse reset without cloning a full document", () => {
    const source = document();
    source.states.push({
      id: "clean",
      name: "정리",
      revision: 1,
      baseStateId: "night-ja",
      patch: {
        visibility: { "draft.notes": null },
        tokenModes: { time: null },
        variants: { "character.hero": { expression: null } },
        effectParameters: { "panel.1": null },
        shotParameters: { "shot.1": { exposure: null } },
        textDataSetId: null,
        outputRecipeId: null,
      },
    } as unknown as (typeof source.states)[number]);

    const resolved = resolveStudioNamedState(source, "clean");
    expect(resolved.visibility).toEqual({ "panel.1": true });
    expect(resolved.tokenModes).toEqual({ locale: "ja", platform: "mobile" });
    expect(resolved.variants["character.hero"]).toEqual({ costume: "school" });
    expect(resolved.effectParameters).toEqual({});
    expect(resolved.shotParameters).toEqual({});
    expect(resolved.textDataSetId).toBeNull();
    expect(resolved.outputRecipeId).toBeNull();
  });

  it("produces bounded semantic diffs and fail-closed application plans", () => {
    const base = resolveStudioNamedState(document(), "base");
    const target = resolveStudioNamedState(document(), "night-ja");
    const diff = compareStudioNamedStates(base, target);

    expect(diff.map(({ kind, ownerId, property }) => [kind, ownerId, property])).toEqual([
      ["token-mode", null, "locale"],
      ["token-mode", null, "time"],
      ["variant", "character.hero", "expression"],
      ["effect", "panel.1", "lut"],
      ["effect", "panel.1", "rimLight"],
      ["shot", "shot.1", "exposure"],
      ["text-data", null, "textDataSetId"],
      ["output-recipe", null, "outputRecipeId"],
    ]);

    const plan = planStudioNamedStateApplication({
      current: base,
      target,
      availability: {
        nodeIds: new Set(["character.hero"]),
        tokenAxisIds: new Set(["locale", "platform"]),
        textDataSetIds: new Set(["dialogue.ja"]),
        outputRecipeIds: new Set(),
      },
    });
    expect(plan.canApply).toBe(false);
    expect(plan.skipped.map(({ reason }) => reason)).toEqual([
      "missing-token-axis",
      "missing-node",
      "missing-node",
      "missing-node",
      "missing-output-recipe",
    ]);
  });

  it("canonicalizes ordering and round-trips only exact canonical JSON", () => {
    const serialized = serializeStudioNamedStateDocument(document());
    expect(serialized).not.toBeNull();
    expect(parseStudioNamedStateDocument(serialized!)).toEqual(
      normalizeStudioNamedStateDocument(document()),
    );
    expect(parseStudioNamedStateDocument(` ${serialized}`)).toBeNull();
    expect(createEmptyStudioNamedStateDocument()).toEqual({
      version: 1,
      revision: 0,
      activeStateId: null,
      states: [],
    });
  });

  it.each([
    {
      label: "dangling base",
      mutate: (source: ReturnType<typeof document>) => {
        source.states[0]!.baseStateId = "missing";
      },
    },
    {
      label: "cycle",
      mutate: (source: ReturnType<typeof document>) => {
        source.states[2]!.baseStateId = "night-ja";
      },
    },
    {
      label: "unknown active state",
      mutate: (source: ReturnType<typeof document>) => {
        source.activeStateId = "missing";
      },
    },
  ])("rejects $label documents without partial recovery", ({ mutate }) => {
    const source = document();
    mutate(source);
    expect(serializeStudioNamedStateDocument(source)).toBeNull();
  });

  it("rejects accessors, unsafe IDs, non-finite parameters, and unknown fields", () => {
    const accessor = document();
    Object.defineProperty(accessor.states[0]!.patch, "visibility", {
      enumerable: true,
      get: () => ({ "panel.1": true }),
    });
    expect(serializeStudioNamedStateDocument(accessor)).toBeNull();

    const unsafe = document();
    unsafe.states[0]!.patch.variants = {
      constructor: { expression: "angry" },
    } as unknown as (typeof unsafe.states)[number]["patch"]["variants"];
    expect(serializeStudioNamedStateDocument(unsafe)).toBeNull();

    const nonFinite = document();
    nonFinite.states[1]!.patch.effectParameters = {
      "panel.1": { exposure: Number.POSITIVE_INFINITY },
    } as unknown as (typeof nonFinite.states)[number]["patch"]["effectParameters"];
    expect(serializeStudioNamedStateDocument(nonFinite)).toBeNull();

    const unknown = document() as ReturnType<typeof document> & { extra?: boolean };
    unknown.extra = true;
    expect(serializeStudioNamedStateDocument(unknown)).toBeNull();
  });
});
