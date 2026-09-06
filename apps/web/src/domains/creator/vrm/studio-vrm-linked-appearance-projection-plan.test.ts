import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_LINKED_APPEARANCE_MAX_HAND_PROPS,
  createStudioVrmLinkedAppearanceProjectionPlan,
  inspectStudioVrmWardrobeForLinkedProjection,
} from "./studio-vrm-linked-appearance-projection-plan";
import {
  createPropInstance,
  serializeVrmProps,
} from "./studio-vrm-props";
import {
  createStudioVrmSceneDocument,
  type StudioVrmCanonicalData,
  type StudioVrmSceneDocument,
} from "./studio-vrm-scene-document";
import {
  createWardrobeEquip,
  serializeWardrobe,
} from "./studio-vrm-wardrobe";

function sceneWithAppearance(input: {
  wardrobe?: StudioVrmCanonicalData;
  props?: StudioVrmCanonicalData;
}): StudioVrmSceneDocument {
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

describe("linked VRM appearance projection plan", () => {
  it("normalizes a valid v2 wardrobe into ordered exact runtime requirements", () => {
    const wardrobe = serializeWardrobe({
      outer: { ...createWardrobeEquip("blazer")!, color: "#123456", fit: 1.12 },
      shoes: createWardrobeEquip("boots")!,
    }, { autoHideOriginal: false })!;
    const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      wardrobe: wardrobe as unknown as StudioVrmCanonicalData,
    }));

    expect(plan.wardrobe).toMatchObject({
      status: "supported",
      sourceVersion: 2,
      autoHideOriginal: false,
      slots: [
        {
          slot: "outer",
          itemId: "blazer",
          color: "#123456",
          fit: 1.12,
          fitMode: "auto",
          fabricId: "wool",
          geometrySource: "skinned-procedural-v1",
        },
        {
          slot: "shoes",
          itemId: "boots",
          geometrySource: "rigid-procedural",
        },
      ],
    });
    expect(plan.signature).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("uses the Poser legacy defaults and fit clamping deterministically", () => {
    const legacy = {
      top: { itemId: "shirt", color: "#ABCDEF", fit: 99 },
    } as unknown as StudioVrmCanonicalData;
    const first = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      wardrobe: legacy,
    }));
    const second = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      wardrobe: legacy,
    }));

    expect(first.wardrobe).toMatchObject({
      status: "supported",
      sourceVersion: "legacy",
      slots: [{
        slot: "top",
        itemId: "shirt",
        color: "#abcdef",
        fit: 1.4,
        fitMode: "auto",
        fabricId: "cotton",
      }],
    });
    expect(second).toEqual(first);
    expect(second.signature).toBe(first.signature);
  });

  it.each([
    [
      "future version",
      { version: 999, slots: { top: { itemId: "shirt" } } },
      "unsupported-version",
    ],
    [
      "unknown item",
      { version: 2, slots: { top: { itemId: "future-shirt" } } },
      "unknown-item",
    ],
    [
      "slot mismatch",
      { version: 2, slots: { top: { itemId: "blazer" } } },
      "unknown-item",
    ],
    [
      "unknown future field",
      { version: 2, slots: { top: { itemId: "shirt", simulation: true } } },
      "partial-document",
    ],
    [
      "invalid option",
      { version: 2, slots: {}, options: { autoHideOriginal: "sometimes" } },
      "malformed-document",
    ],
    [
      "V2 envelope without slots",
      { version: 2 },
      "partial-document",
    ],
    [
      "V2 envelope using a legacy direct slot",
      { version: 2, top: { itemId: "shirt" } },
      "partial-document",
    ],
    [
      "explicit null slot",
      { version: 2, slots: { top: null } },
      "malformed-document",
    ],
  ])("fails closed for a %s wardrobe document", (_label, wardrobe, code) => {
    const inspection = inspectStudioVrmWardrobeForLinkedProjection(wardrobe);
    expect(inspection).toMatchObject({
      status: "unsupported",
      reasons: [expect.objectContaining({ feature: "wardrobe", code })],
    });
  });

  it("canonicalizes multiple future wardrobe fields independently from insertion order", () => {
    const left = {
      version: 2,
      slots: { top: { itemId: "shirt", zFuture: true, aFuture: true } },
    } as unknown as StudioVrmCanonicalData;
    const right = {
      version: 2,
      slots: { top: { itemId: "shirt", aFuture: true, zFuture: true } },
    } as unknown as StudioVrmCanonicalData;
    const leftPlan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      wardrobe: left,
    }));
    const rightPlan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      wardrobe: right,
    }));

    expect(leftPlan.wardrobe).toEqual(rightPlan.wardrobe);
    expect(leftPlan.wardrobe).toMatchObject({
      status: "unsupported",
      reasons: [
        { code: "partial-document", path: "appearance.wardrobe.slots.top.aFuture" },
        { code: "partial-document", path: "appearance.wardrobe.slots.top.zFuture" },
      ],
    });
    expect(leftPlan.signature).toBe(rightPlan.signature);
  });

  it("projects a known hand prop with exact auto-grip and secondary-hand requirements", () => {
    const book = createPropInstance("book", "book-shared")!;
    book.rig = {
      ...book.rig!,
      gripFit: 1.15,
      secondary: {
        enabled: true,
        anchorId: "secondary",
        bone: "rightHand",
        influence: 0.65,
      },
    };
    const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: serializeVrmProps([book]) as unknown as StudioVrmCanonicalData,
    }));

    expect(plan.handProps).toMatchObject({
      status: "supported",
      sourceVersion: 2,
      props: [{
        uid: "book-shared",
        propId: "book",
        bone: "leftHand",
        attachmentMode: "smart-rig-v2",
        primaryAnchorId: "primary",
        autoScale: true,
        autoGripHand: "leftHand",
        gripFit: 1.15,
        secondaryHand: {
          bone: "rightHand",
          anchorId: "secondary",
          influence: 0.65,
        },
      }],
    });
  });

  it("gives known older V2 prop fields the same deterministic signature as their explicit migration", () => {
    const legacyBook = createPropInstance("book", "legacy-book")!;
    legacyBook.rig = {
      ...legacyBook.rig!,
      secondary: {
        enabled: true,
        anchorId: "secondary",
        bone: "rightHand",
        influence: 0.65,
      },
    };
    const rawLegacyRig = { ...legacyBook.rig } as Record<string, unknown>;
    delete rawLegacyRig.gripFit;
    const rawSecondary = { ...(rawLegacyRig.secondary as Record<string, unknown>) };
    delete rawSecondary.influence;
    rawLegacyRig.secondary = rawSecondary;
    const migrated = {
      ...legacyBook,
      rig: rawLegacyRig,
    } as unknown as StudioVrmCanonicalData;
    const explicit = serializeVrmProps([legacyBook]) as unknown as StudioVrmCanonicalData;

    const legacyPlan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: { version: 2, items: [migrated] } as unknown as StudioVrmCanonicalData,
    }));
    const explicitPlan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: explicit,
    }));

    expect(legacyPlan.handProps).toMatchObject({
      status: "supported",
      props: [{ gripFit: 1, secondaryHand: { influence: 0.65 } }],
    });
    expect(legacyPlan.signature).toBe(explicitPlan.signature);
  });

  it("rejects unknown, duplicated, malformed and non-hand props without partial projection", () => {
    const mug = createPropInstance("mug", "same")!;
    const cap = createPropInstance("cap", "cap-1")!;
    const cases: readonly [StudioVrmCanonicalData, string, string][] = [
      [
        { version: 2, items: [{ ...mug, propId: "future-prop" }] } as unknown as StudioVrmCanonicalData,
        "unknown-prop",
        "props.items[0].propId",
      ],
      [
        { version: 2, items: [mug, { ...mug }] } as unknown as StudioVrmCanonicalData,
        "duplicate-identity",
        "props.items[1].uid",
      ],
      [
        { version: 2, items: [{ ...mug, rig: { ...mug.rig, version: 999 } }] } as unknown as StudioVrmCanonicalData,
        "unsupported-rig",
        "props.items[0].rig.version",
      ],
      [
        serializeVrmProps([mug, cap]) as unknown as StudioVrmCanonicalData,
        "unsupported-prop-category",
        "props.items[1]",
      ],
      [
        { version: 2, items: [mug], futureRuntime: true } as unknown as StudioVrmCanonicalData,
        "partial-document",
        "props.futureRuntime",
      ],
      [
        {
          version: 2,
          items: [{ ...mug, futureSocket: "tail" }],
        } as unknown as StudioVrmCanonicalData,
        "partial-document",
        "props.items[0].futureSocket",
      ],
    ];

    for (const [props, code, path] of cases) {
      const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({ props }));
      expect(plan.handProps).toMatchObject({
        status: "unsupported",
        reasons: expect.arrayContaining([expect.objectContaining({ code, path })]),
      });
    }
  });

  it("prefixes future prop document versions with the canonical scene path", () => {
    const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: { version: 999, items: [] },
    }));
    expect(plan.handProps).toMatchObject({
      status: "unsupported",
      reasons: [{ code: "unsupported-version", path: "props.version" }],
    });
  });

  it("enforces the explicit per-character hand-prop GPU budget", () => {
    const items = Array.from(
      { length: STUDIO_VRM_LINKED_APPEARANCE_MAX_HAND_PROPS + 1 },
      (_, index) => createPropInstance("mug", `mug-${index}`)!,
    );
    const plan = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: serializeVrmProps(items) as unknown as StudioVrmCanonicalData,
    }));

    expect(plan.handProps).toMatchObject({
      status: "unsupported",
      reasons: [{ code: "resource-budget-exceeded", path: "props.items" }],
    });
  });

  it("does not mutate input or consult time/randomness while planning", () => {
    const props = serializeVrmProps([createPropInstance("mug", "pure-mug")!])!;
    const wardrobe = serializeWardrobe({ top: createWardrobeEquip("shirt")! })!;
    const scene = sceneWithAppearance({
      props: props as unknown as StudioVrmCanonicalData,
      wardrobe: wardrobe as unknown as StudioVrmCanonicalData,
    });
    const before = JSON.stringify(scene);
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("projection must not use random");
    });
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("projection must not use time");
    });

    try {
      const first = createStudioVrmLinkedAppearanceProjectionPlan(scene);
      const second = createStudioVrmLinkedAppearanceProjectionPlan(scene);
      expect(second.signature).toBe(first.signature);
      expect(JSON.stringify(scene)).toBe(before);
    } finally {
      random.mockRestore();
      now.mockRestore();
    }
  });

  it("returns a deeply frozen plan and changes its signature for visual state changes", () => {
    const relaxed = createPropInstance("mug", "frozen-mug")!;
    const tight = {
      ...relaxed,
      rig: { ...relaxed.rig!, gripFit: 1.2 },
    };
    const first = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: serializeVrmProps([relaxed]) as unknown as StudioVrmCanonicalData,
    }));
    const second = createStudioVrmLinkedAppearanceProjectionPlan(sceneWithAppearance({
      props: serializeVrmProps([tight]) as unknown as StudioVrmCanonicalData,
    }));

    expect(first.signature).not.toBe(second.signature);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.handProps)).toBe(true);
    if (first.handProps.status !== "supported") throw new Error("expected supported props");
    expect(Object.isFrozen(first.handProps.props)).toBe(true);
    expect(Object.isFrozen(first.handProps.props[0]?.instance)).toBe(true);
    expect(Object.isFrozen(first.handProps.props[0]?.instance.position)).toBe(true);
  });
});
