import { describe, expect, it } from "vitest";

import {
  applyStudioComponentOperationPlan,
  createStudioComponentDocument,
  findStudioComponentUsages,
  hashStudioComponentDocument,
  planStudioComponentMakeUnique,
  planStudioComponentSourceUpdate,
  resolveStudioComponentInstance,
  serializeStudioComponentDocument,
  STUDIO_COMPONENT_LIMITS,
  StudioComponentError,
  type StudioComponentDefinitionRevision,
  type StudioComponentDocument,
  type StudioComponentInstance,
} from "./studio-component-instance-core";

function definition(
  id: string,
  revision: number,
  input: Partial<StudioComponentDefinitionRevision> = {},
): StudioComponentDefinitionRevision {
  return {
    id,
    name: id,
    kind: "character",
    schemaVersion: 1,
    revision,
    payload: {
      node: {
        appearance: {
          accent: "#222222",
          costume: "school",
          expression: "neutral",
          tone: "base",
        },
        dialogue: "기본 대사",
        position: { x: 0, y: 0 },
        removable: true,
      },
    },
    slots: [],
    properties: [],
    variantAxes: [],
    ...input,
  };
}

function instance(
  id: string,
  componentId: string,
  input: Partial<StudioComponentInstance> = {},
): StudioComponentInstance {
  return {
    id,
    componentId,
    sourceRevision: 1,
    updatePolicy: "review",
    variantSelection: {},
    slotBindings: {},
    propertyValues: {},
    localOverrides: [],
    ...input,
  };
}

function documentWith(
  definitions: readonly StudioComponentDefinitionRevision[],
  instances: readonly StudioComponentInstance[] = [],
): StudioComponentDocument {
  return createStudioComponentDocument({
    version: 1,
    definitions,
    instances,
  });
}

function expectComponentError(
  action: () => unknown,
  code: StudioComponentError["code"],
): StudioComponentError {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(StudioComponentError);
    expect((error as StudioComponentError).code).toBe(code);
    return error as StudioComponentError;
  }
}

function reusableCharacterDefinition(
  id = "character.seoyun",
  revision = 1,
): StudioComponentDefinitionRevision {
  return definition(id, revision, {
    name: "서윤",
    basedOn: { componentId: "character.base", revision: 1 },
    payload: {
      node: {
        appearance: { accent: "#3366ff" },
        name: "서윤",
      },
    },
    slots: [
      {
        id: "dialogue",
        label: "대사",
        path: "/node/dialogue",
        domain: "content",
        required: true,
        defaultValue: "기본 대사",
      },
    ],
    properties: [
      {
        id: "accent",
        label: "강조색",
        path: "/node/appearance/accent",
        domain: "style",
        type: "color",
        defaultValue: "#3366ff",
      },
    ],
    variantAxes: [
      {
        id: "expression",
        label: "표정",
        priority: 20,
        defaultOptionId: "neutral",
        options: [
          {
            id: "smile",
            label: "미소",
            patches: [
              {
                id: "expression-smile",
                domain: "content",
                op: "set",
                path: "/node/appearance/expression",
                value: "smile",
              },
              {
                id: "expression-tone",
                domain: "style",
                op: "set",
                path: "/node/appearance/tone",
                value: "expression-wins",
              },
            ],
          },
          { id: "neutral", label: "중립", patches: [] },
        ],
      },
      {
        id: "costume",
        label: "의상",
        priority: 10,
        defaultOptionId: "school",
        options: [
          { id: "school", label: "교복", patches: [] },
          {
            id: "winter",
            label: "겨울",
            patches: [
              {
                id: "costume-winter",
                domain: "content",
                op: "set",
                path: "/node/appearance/costume",
                value: "winter",
              },
              {
                id: "costume-tone",
                domain: "style",
                op: "set",
                path: "/node/appearance/tone",
                value: "costume-first",
              },
            ],
          },
        ],
      },
    ],
  });
}

describe("studio component / instance core", () => {
  it("resolves inheritance, independent variant axes, properties, slots, and local overrides deterministically", () => {
    const document = documentWith(
      [
        reusableCharacterDefinition(),
        definition("character.base", 1),
      ],
      [
        instance("instance.hero", "character.seoyun", {
          variantSelection: { expression: "smile", costume: "winter" },
          propertyValues: { accent: "#ff3366" },
          slotBindings: { dialogue: "지금 가자!" },
          localOverrides: [
            {
              id: "remove-debug",
              domain: "metadata",
              op: "remove",
              path: "/node/removable",
            },
            {
              id: "move-x",
              domain: "structure",
              op: "set",
              path: "/node/position/x",
              value: 42,
            },
          ],
        }),
      ],
    );

    const resolved = resolveStudioComponentInstance(document, "instance.hero");
    expect(resolved.sourceChain).toEqual([
      "character.base@1",
      "character.seoyun@1",
    ]);
    expect(resolved.variantSelection).toEqual({
      costume: "winter",
      expression: "smile",
    });
    expect(resolved.payload).toEqual({
      node: {
        appearance: {
          accent: "#ff3366",
          costume: "winter",
          expression: "smile",
          tone: "expression-wins",
        },
        dialogue: "지금 가자!",
        name: "서윤",
        position: { x: 42, y: 0 },
      },
    });
    expect(resolved.appliedPatchIds).toEqual([
      "character.seoyun@1:costume:winter:costume-winter",
      "character.seoyun@1:costume:winter:costume-tone",
      "character.seoyun@1:expression:smile:expression-smile",
      "character.seoyun@1:expression:smile:expression-tone",
      "property:accent",
      "slot:dialogue",
      "local:remove-debug",
      "local:move-x",
    ]);
    expect(resolved.localOverrideIds).toEqual(["remove-debug", "move-x"]);
    expect(Object.isFrozen(resolved.payload)).toBe(true);
    expect(Object.isFrozen(resolved.payload.node)).toBe(true);
  });

  it("canonicalizes declaration order, map order, patch order, negative zero, and hashes identically", () => {
    const base = definition("character.base", 1);
    const character = reusableCharacterDefinition();
    const first = documentWith(
      [character, base],
      [
        instance("instance.b", "character.seoyun", {
          variantSelection: { expression: "smile", costume: "winter" },
          localOverrides: [
            {
              id: "z",
              domain: "structure",
              op: "set",
              path: "/node/position/y",
              value: -0,
            },
            {
              id: "a",
              domain: "structure",
              op: "set",
              path: "/node/position/x",
              value: 3,
            },
          ],
        }),
        instance("instance.a", "character.seoyun"),
      ],
    );
    const second = documentWith(
      [base, {
        ...character,
        payload: { node: { name: "서윤", appearance: { accent: "#3366ff" } } },
        variantAxes: [...character.variantAxes].reverse().map((axis) => ({
          ...axis,
          options: [...axis.options].reverse(),
        })),
      }],
      [
        instance("instance.a", "character.seoyun"),
        instance("instance.b", "character.seoyun", {
          variantSelection: { costume: "winter", expression: "smile" },
          localOverrides: [
            {
              id: "a",
              domain: "structure",
              op: "set",
              path: "/node/position/x",
              value: 3,
            },
            {
              id: "z",
              domain: "structure",
              op: "set",
              path: "/node/position/y",
              value: 0,
            },
          ],
        }),
      ],
    );

    expect(serializeStudioComponentDocument(first)).toBe(
      serializeStudioComponentDocument(second),
    );
    expect(hashStudioComponentDocument(first)).toBe(hashStudioComponentDocument(second));
    expect(serializeStudioComponentDocument(first)).not.toContain("-0");
    expect(first.definitions.map((entry) => `${entry.id}@${entry.revision}`)).toEqual([
      "character.base@1",
      "character.seoyun@1",
    ]);
    expect(first.instances.map((entry) => entry.id)).toEqual([
      "instance.a",
      "instance.b",
    ]);
  });

  it("implements auto, review, and pinned revision policies without losing accepted revision audit data", () => {
    const definitions = [
      definition("bubble.speech", 1, {
        payload: { node: { style: { fill: "#ffffff" } } },
      }),
      definition("bubble.speech", 2, {
        payload: { node: { style: { fill: "#fff7df" } } },
      }),
    ];
    const document = documentWith(definitions, [
      instance("instance.auto", "bubble.speech", { updatePolicy: "auto" }),
      instance("instance.pinned", "bubble.speech", { updatePolicy: "pinned" }),
      instance("instance.review", "bubble.speech", { updatePolicy: "review" }),
    ]);

    const auto = resolveStudioComponentInstance(document, "instance.auto");
    const pinned = resolveStudioComponentInstance(document, "instance.pinned");
    const review = resolveStudioComponentInstance(document, "instance.review");
    expect(auto).toMatchObject({
      acceptedRevision: 1,
      effectiveRevision: 2,
      latestRevision: 2,
      updateAvailable: false,
    });
    expect(auto.payload).toEqual({ node: { style: { fill: "#fff7df" } } });
    expect(pinned).toMatchObject({ effectiveRevision: 1, updateAvailable: true });
    expect(review).toMatchObject({ effectiveRevision: 1, updateAvailable: true });
    expect(pinned.payload).toEqual({ node: { style: { fill: "#ffffff" } } });
  });

  it("searches direct and inherited usages with stable version information at 1,000-instance scale", () => {
    const instances = Array.from({ length: 1_000 }, (_, index) =>
      instance(`instance.${String(index).padStart(4, "0")}`, "character.seoyun", {
        localOverrides: [{
          id: `move-${index}`,
          domain: "structure",
          op: "set",
          path: "/node/position/x",
          value: index,
        }],
      }));
    const document = documentWith(
      [definition("character.base", 1), reusableCharacterDefinition()],
      instances,
    );

    const baseUsages = findStudioComponentUsages(document, "character.base", 1);
    expect(baseUsages).toHaveLength(1_000);
    expect(baseUsages[0]).toMatchObject({
      instanceId: "instance.0000",
      componentId: "character.seoyun",
      direct: false,
      effectiveRevision: 1,
    });
    expect(baseUsages.at(-1)?.instanceId).toBe("instance.0999");
  });

  it("fails closed for inheritance cycles, dangling bases, and depth exhaustion", () => {
    expectComponentError(
      () => documentWith([
        definition("a", 1, { basedOn: { componentId: "b", revision: 1 } }),
        definition("b", 1, { basedOn: { componentId: "a", revision: 1 } }),
      ]),
      "INHERITANCE_CYCLE",
    );
    expectComponentError(
      () => documentWith([
        definition("a", 1, { basedOn: { componentId: "missing", revision: 1 } }),
      ]),
      "DANGLING_BASE",
    );
    const deep = Array.from(
      { length: STUDIO_COMPONENT_LIMITS.maxInheritanceDepth + 1 },
      (_, index) => definition(`chain.${index}`, 1, {
        ...(index === STUDIO_COMPONENT_LIMITS.maxInheritanceDepth
          ? {}
          : { basedOn: { componentId: `chain.${index + 1}`, revision: 1 } }),
      }),
    );
    expectComponentError(() => documentWith(deep), "INHERITANCE_TOO_DEEP");
  });

  it("rejects malformed JSON, unknown fields, unsafe pointers, duplicate writes, and exhausted work budgets", () => {
    const cyclic: { node?: unknown } = {};
    cyclic.node = cyclic;
    expectComponentError(
      () => documentWith([definition("bad.cycle", 1, {
        payload: cyclic as never,
      })]),
      "INVALID_DOCUMENT",
    );
    expectComponentError(
      () => createStudioComponentDocument({
        version: 1,
        definitions: [{
          ...definition("bad.field", 1),
          surprise: true,
        }],
        instances: [],
      }),
      "INVALID_DOCUMENT",
    );
    expectComponentError(
      () => documentWith([definition("bad.pointer", 1, {
        variantAxes: [{
          id: "axis",
          label: "축",
          priority: 0,
          defaultOptionId: "bad",
          options: [{
            id: "bad",
            label: "나쁨",
            patches: [{
              id: "unsafe",
              domain: "metadata",
              op: "set",
              path: "/__proto__/polluted",
              value: true,
            }],
          }],
        }],
      })]),
      "INVALID_PATCH",
    );
    expectComponentError(
      () => documentWith([definition("bad.duplicate", 1, {
        variantAxes: [{
          id: "axis",
          label: "축",
          priority: 0,
          defaultOptionId: "bad",
          options: [{
            id: "bad",
            label: "나쁨",
            patches: [
              {
                id: "one",
                domain: "style",
                op: "set",
                path: "/node/dialogue",
                value: "1",
              },
              {
                id: "two",
                domain: "content",
                op: "set",
                path: "/node/dialogue",
                value: "2",
              },
            ],
          }],
        }],
      })]),
      "INVALID_PATCH",
    );

    const budgeted = documentWith([
      definition("budgeted", 1, {
        variantAxes: [{
          id: "axis",
          label: "축",
          priority: 0,
          defaultOptionId: "active",
          options: [{
            id: "active",
            label: "활성",
            patches: [
              {
                id: "one",
                domain: "style",
                op: "set",
                path: "/node/appearance/accent",
                value: "#ffffff",
              },
              {
                id: "two",
                domain: "content",
                op: "set",
                path: "/node/dialogue",
                value: "변경",
              },
            ],
          }],
        }],
      }),
    ], [instance("budget.instance", "budgeted")]);
    expectComponentError(
      () => resolveStudioComponentInstance(budgeted, "budget.instance", {
        maxPatchOperations: 1,
      }),
      "LIMIT_EXCEEDED",
    );
  });

  it("fails closed for invalid variants, required bindings, property types, and missing patch targets", () => {
    const strictDefinition = definition("strict", 1, {
      slots: [{
        id: "image",
        label: "이미지",
        path: "/node/image",
        domain: "content",
        required: true,
      }],
      properties: [{
        id: "opacity",
        label: "불투명도",
        path: "/node/opacity",
        domain: "style",
        type: "number",
      }],
      variantAxes: [{
        id: "state",
        label: "상태",
        priority: 0,
        defaultOptionId: "normal",
        options: [{ id: "normal", label: "보통", patches: [] }],
      }],
    });
    expectComponentError(
      () => resolveStudioComponentInstance(
        documentWith([strictDefinition], [
          instance("missing.slot", "strict", {
            propertyValues: { opacity: 0.5 },
          }),
        ]),
        "missing.slot",
      ),
      "INVALID_BINDING",
    );
    expectComponentError(
      () => resolveStudioComponentInstance(
        documentWith([strictDefinition], [
          instance("bad.variant", "strict", {
            variantSelection: { state: "missing" },
            slotBindings: { image: "asset://hero" },
          }),
        ]),
        "bad.variant",
      ),
      "INVALID_VARIANT",
    );
    expectComponentError(
      () => resolveStudioComponentInstance(
        documentWith([strictDefinition], [
          instance("bad.property", "strict", {
            propertyValues: { opacity: "opaque" },
            slotBindings: { image: "asset://hero" },
          }),
        ]),
        "bad.property",
      ),
      "INVALID_PROPERTY",
    );
    expectComponentError(
      () => resolveStudioComponentInstance(
        documentWith([definition("bad.target", 1)], [
          instance("bad.target.instance", "bad.target", {
            localOverrides: [{
              id: "missing-parent",
              domain: "content",
              op: "set",
              path: "/missing/child",
              value: true,
            }],
          }),
        ]),
        "bad.target.instance",
      ),
      "PATCH_TARGET_MISSING",
    );
  });

  it("plans source updates with semantic diffs, preserves local overrides, and supports stale-safe undo", () => {
    const definitions = [
      definition("card", 1, {
        payload: {
          node: {
            position: { x: 0, y: 0 },
            style: { fill: "#ffffff", stroke: "#111111" },
          },
        },
      }),
      definition("card", 2, {
        payload: {
          node: {
            position: { x: 0, y: 0 },
            style: { fill: "#ffe7ad", stroke: "#111111" },
          },
        },
      }),
    ];
    const original = documentWith(definitions, [
      instance("card.instance", "card", {
        localOverrides: [{
          id: "keep-position",
          domain: "structure",
          op: "set",
          path: "/node/position/x",
          value: 72,
        }],
      }),
    ]);

    const plan = planStudioComponentSourceUpdate(original, "card.instance", 2);
    expect(plan.kind).toBe("studio-component-source-update");
    expect(plan.changedPaths).toEqual(["/node/style/fill"]);
    expect(plan.preservedLocalOverrideIds).toEqual(["keep-position"]);
    expect(plan).toEqual(planStudioComponentSourceUpdate(original, "card.instance", 2));

    const updated = applyStudioComponentOperationPlan(original, plan, "forward");
    expect(resolveStudioComponentInstance(updated, "card.instance")).toMatchObject({
      acceptedRevision: 2,
      effectiveRevision: 2,
      payload: {
        node: {
          position: { x: 72, y: 0 },
          style: { fill: "#ffe7ad", stroke: "#111111" },
        },
      },
    });
    const undone = applyStudioComponentOperationPlan(updated, plan, "inverse");
    expect(serializeStudioComponentDocument(undone)).toBe(
      serializeStudioComponentDocument(original),
    );
    expectComponentError(
      () => applyStudioComponentOperationPlan(updated, plan, "forward"),
      "STALE_OPERATION",
    );
  });

  it("makes an instance unique by baking its exact resolved result and reverses atomically", () => {
    const original = documentWith(
      [definition("character.base", 1), reusableCharacterDefinition()],
      [
        instance("instance.hero", "character.seoyun", {
          variantSelection: { expression: "smile", costume: "winter" },
          propertyValues: { accent: "#ff4d7d" },
          slotBindings: { dialogue: "유일한 장면" },
          localOverrides: [{
            id: "hero-offset",
            domain: "structure",
            op: "set",
            path: "/node/position/x",
            value: 120,
          }],
        }),
      ],
    );
    const before = resolveStudioComponentInstance(original, "instance.hero");
    const plan = planStudioComponentMakeUnique(
      original,
      "instance.hero",
      "unique.hero.episode-12",
      "12화 서윤",
    );
    expect(plan.kind).toBe("studio-component-make-unique");
    expect(plan.preservedLocalOverrideIds).toEqual(["hero-offset"]);

    const unique = applyStudioComponentOperationPlan(original, plan, "forward");
    const uniqueInstance = unique.instances.find((entry) => entry.id === "instance.hero");
    expect(uniqueInstance).toMatchObject({
      componentId: "unique.hero.episode-12",
      sourceRevision: 1,
      updatePolicy: "pinned",
      localOverrides: [],
    });
    const after = resolveStudioComponentInstance(unique, "instance.hero");
    expect(after.payloadFingerprint).toBe(before.payloadFingerprint);
    expect(after.payload).toEqual(before.payload);
    expect(findStudioComponentUsages(unique, "unique.hero.episode-12")).toHaveLength(1);

    const undone = applyStudioComponentOperationPlan(unique, plan, "inverse");
    expect(serializeStudioComponentDocument(undone)).toBe(
      serializeStudioComponentDocument(original),
    );
    expect(undone.definitions.some((entry) => entry.id === "unique.hero.episode-12")).toBe(false);
  });
});
