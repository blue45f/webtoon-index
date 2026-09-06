import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  createStudioVrmLinkedAppearanceProjectionPlan,
  type StudioVrmLinkedAppearanceProjectionPlan,
} from "./studio-vrm-linked-appearance-projection-plan";
import { snapshotStudioVrmLinkedAppearanceReadiness } from "./studio-vrm-linked-appearance-readiness";
import { createStudioVrmLinkedAppearanceReadinessPlan } from "./studio-vrm-linked-appearance-readiness-plan";
import { createPropInstance, serializeVrmProps } from "./studio-vrm-props";
import {
  createStudioVrmSceneDocument,
  type StudioVrmCanonicalData,
  type StudioVrmSceneDocument,
} from "./studio-vrm-scene-document";
import { createWardrobeEquip, serializeWardrobe } from "./studio-vrm-wardrobe";

const IDENTITY = Object.freeze({
  runtimeKey: "character-a:runtime-7",
  placementHash: "sha256:placement-a",
  generation: 7,
});

function sceneWithAppearance(input: {
  wardrobe?: StudioVrmCanonicalData;
  props?: StudioVrmCanonicalData;
} = {}): StudioVrmSceneDocument {
  const scene = createStudioVrmSceneDocument();
  return {
    ...scene,
    appearance: {
      ...scene.appearance,
      wardrobe: input.wardrobe ?? null,
    },
    props: input.props ?? null,
  };
}

function supportedPlan(): StudioVrmLinkedAppearanceProjectionPlan {
  const wardrobe = serializeWardrobe({
    outer: createWardrobeEquip("blazer")!,
    shoes: createWardrobeEquip("boots")!,
  })!;
  const props = serializeVrmProps([
    createPropInstance("mug", "z-mug")!,
    createPropInstance("book", "a-book")!,
  ])!;
  const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
    wardrobe: wardrobe as unknown as StudioVrmCanonicalData,
    props: props as unknown as StudioVrmCanonicalData,
  }));
  if (plan.wardrobe.status !== "supported" || plan.handProps.status !== "supported") {
    throw new Error("expected supported linked appearance fixture");
  }
  return plan;
}

function unsupportedPlan(input: {
  wardrobe: boolean;
  handProps: boolean;
}): StudioVrmLinkedAppearanceProjectionPlan {
  const mug = createPropInstance("mug", "mixed-mug")!;
  const supportedWardrobe = serializeWardrobe({ top: createWardrobeEquip("shirt")! })!;
  const supportedProps = serializeVrmProps([mug]);
  return createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
    wardrobe: input.wardrobe
      ? { version: 999, slots: {} } as unknown as StudioVrmCanonicalData
      : supportedWardrobe as unknown as StudioVrmCanonicalData,
    props: input.handProps
      ? {
          version: 2,
          items: [{ ...mug, propId: "future-prop" }],
        } as unknown as StudioVrmCanonicalData
      : supportedProps as unknown as StudioVrmCanonicalData,
  }));
}

function mutablePlan(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(supportedPlan())) as Record<string, unknown>;
}

function expectInvalidPlan(candidate: unknown): void {
  const result = createStudioVrmLinkedAppearanceReadinessPlan(
    candidate as StudioVrmLinkedAppearanceProjectionPlan,
    IDENTITY,
  );
  expect(result).toEqual({
    ok: false,
    state: null,
    reasons: [{
      feature: "wardrobe",
      code: "malformed-document",
      path: "projection-plan",
    }],
  });
  expect(Object.isFrozen(result)).toBe(true);
  if (result.ok) throw new Error("malformed projection plan exposed readiness state");
  expect(result.state).toBeNull();
  expect(Object.isFrozen(result.reasons)).toBe(true);
  expect(Object.isFrozen(result.reasons[0])).toBe(true);
}

describe("linked VRM appearance readiness plan adapter", () => {
  it("maps exact expectations through the coordinator in canonical order", () => {
    const plan = supportedPlan();
    const result = createStudioVrmLinkedAppearanceReadinessPlan(plan, IDENTITY);
    if (!result.ok) throw new Error("expected readiness state");

    expect(result.state.identity).toEqual({
      runtimeKey: IDENTITY.runtimeKey,
      placementHash: IDENTITY.placementHash,
      projectionSignature: plan.signature,
      generation: IDENTITY.generation,
    });
    expect(result.state.expectedWardrobe).toEqual([
      { slot: "outer", itemId: "blazer" },
      { slot: "shoes", itemId: "boots" },
    ]);
    expect(result.state.expectedProps).toEqual([
      { uid: "a-book", propId: "book" },
      { uid: "z-mug", propId: "mug" },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.state)).toBe(true);
    expect(Object.isFrozen(result.state.identity)).toBe(true);
    expect(Object.isFrozen(result.state.expectedWardrobe[0])).toBe(true);
  });

  it("keeps an empty appearance loading until runtime commit receipts arrive", () => {
    const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance());
    const result = createStudioVrmLinkedAppearanceReadinessPlan(plan, IDENTITY);
    if (!result.ok) throw new Error("expected empty readiness state");

    expect(snapshotStudioVrmLinkedAppearanceReadiness(result.state)).toMatchObject({
      status: "loading",
      attachmentsComplete: true,
      expected: { wardrobe: [], props: [] },
      commitFrame: null,
      postCommitFrame: null,
    });
  });

  it.each([
    ["unsupported wardrobe", { wardrobe: true, handProps: false }],
    ["unsupported hand props", { wardrobe: false, handProps: true }],
    ["both unsupported branches", { wardrobe: true, handProps: true }],
  ] as const)("fails closed without a partial state for %s", (_label, branches) => {
    const plan = unsupportedPlan(branches);
    const expectedReasons = [
      ...(plan.wardrobe.status === "unsupported" ? plan.wardrobe.reasons : []),
      ...(plan.handProps.status === "unsupported" ? plan.handProps.reasons : []),
    ];
    const result = createStudioVrmLinkedAppearanceReadinessPlan(plan, IDENTITY);

    expect(result).toEqual({ ok: false, state: null, reasons: expectedReasons });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) throw new Error("expected unsupported result");
    expect(result.state).toBeNull();
    expect(Object.isFrozen(result.reasons)).toBe(true);
    for (const reason of result.reasons) expect(Object.isFrozen(reason)).toBe(true);
  });

  it("does not mutate input and defensively freezes copied projection reasons", () => {
    const source = unsupportedPlan({ wardrobe: true, handProps: true });
    const mutablePlan = JSON.parse(JSON.stringify(source)) as StudioVrmLinkedAppearanceProjectionPlan;
    const before = JSON.stringify(mutablePlan);
    const sourceReason = mutablePlan.wardrobe.status === "unsupported"
      ? mutablePlan.wardrobe.reasons[0]
      : null;
    const result = createStudioVrmLinkedAppearanceReadinessPlan(mutablePlan, IDENTITY);

    expect(JSON.stringify(mutablePlan)).toBe(before);
    if (result.ok) throw new Error("expected unsupported result");
    expect(result.reasons[0]).not.toBe(sourceReason);
    expect(Object.isFrozen(result.reasons[0])).toBe(true);
  });

  it("rejects an unknown branch status without exposing expectations", () => {
    const plan = mutablePlan();
    plan.wardrobe = { status: "future-supported", slots: [] };
    expectInvalidPlan(plan);
  });

  it.each([
    ["wardrobe slot", (plan: Record<string, unknown>) => {
      const wardrobe = plan.wardrobe as { slots: unknown[] };
      wardrobe.slots.pop();
    }],
    ["hand prop", (plan: Record<string, unknown>) => {
      const handProps = plan.handProps as { props: unknown[] };
      handProps.props.pop();
    }],
  ] as const)("rejects a missing supported %s under a stale signature", (_label, mutate) => {
    const plan = mutablePlan();
    mutate(plan);
    expectInvalidPlan(plan);
  });

  it.each([
    ["wardrobe itemId", (plan: Record<string, unknown>) => {
      const wardrobe = plan.wardrobe as { slots: Array<{ itemId: string }> };
      wardrobe.slots[0]!.itemId = "coat";
    }],
    ["projected propId", (plan: Record<string, unknown>) => {
      const handProps = plan.handProps as { props: Array<{ propId: string }> };
      handProps.props[0]!.propId = "book";
    }],
    ["projected prop uid", (plan: Record<string, unknown>) => {
      const handProps = plan.handProps as { props: Array<{ uid: string }> };
      handProps.props[0]!.uid = "forged-uid";
    }],
  ] as const)("rejects a changed %s without exposing a reduced state", (_label, mutate) => {
    const plan = mutablePlan();
    mutate(plan);
    expectInvalidPlan(plan);
  });

  it("rejects a forged projection signature", () => {
    const plan = mutablePlan();
    plan.signature = `sha256:${"f".repeat(64)}`;
    expectInvalidPlan(plan);
  });

  it.each([
    ["kind", (plan: Record<string, unknown>) => { plan.kind = "future-plan"; }],
    ["version", (plan: Record<string, unknown>) => { plan.version = 2; }],
    ["root extra field", (plan: Record<string, unknown>) => { plan.futureField = true; }],
    ["branch extra field", (plan: Record<string, unknown>) => {
      (plan.wardrobe as Record<string, unknown>).futureField = true;
    }],
  ] as const)("rejects a wrong or non-canonical %s", (_label, mutate) => {
    const plan = mutablePlan();
    mutate(plan);
    expectInvalidPlan(plan);
  });

  it("delegates identity and generation validation to the readiness coordinator", () => {
    const plan = unsupportedPlan({ wardrobe: true, handProps: false });
    expect(() => createStudioVrmLinkedAppearanceReadinessPlan(plan, {
      ...IDENTITY,
      generation: 0,
    })).toThrow(/positive safe-integer generation/u);
    expect(() => createStudioVrmLinkedAppearanceReadinessPlan(plan, {
      ...IDENTITY,
      runtimeKey: "",
    })).toThrow(/requires non-empty/u);
  });

  it("stays independent from React, Three, R3F, the scene bridge, and the Poser", () => {
    const source = readFileSync(
      new URL("./studio-vrm-linked-appearance-readiness-plan.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(
      /["'](?:react(?:-dom)?|three(?:\/[^"']+)?|@react-three\/[^"']+|\.\/studio-shared-3d-scene-bridge|\.\/StudioVrmPoser)["']/u,
    );
  });
});
