import { describe, expect, it } from "vitest";

import {
  createLayerGroup,
  hasContiguousLayerGroups,
  type LayerGroup,
} from "../studio-layers";

import {
  fingerprintStudioLayerLiftSource,
  isStudioLayerLiftSourceCurrent,
  planStudioLayerLift,
  STUDIO_LAYER_LIFT_DEFAULT_GROUP_NAME,
  STUDIO_LAYER_LIFT_MEMBER_NAMES,
  STUDIO_LAYER_LIFT_OUTPUT_BASIS,
  STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
  type PlanStudioLayerLiftInput,
  type StudioLayerLiftPlanErrorCode,
  type StudioLayerLiftPlanResult,
} from "./studio-layer-lift-plan";

import type { El } from "../studio-element-model";

const SOURCE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAGklEQVR42mMQ0bBxCEipaOhZsOXAiTsf/gMANLgImNAdwO0AAAAASUVORK5CYII=";
const BACKGROUND_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAFElEQVR42mNggIKeBVsOnLjz4T8AGVwGNJa9xxsAAAAASUVORK5CYII=";
const FOREGROUND_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAYAAAD5PA/NAAAAE0lEQVR42mMQ0bBxCEipaGCAAgAbbQJlJs9SqgAAAABJRU5ErkJggg==";

const SOURCE = Object.freeze({
  id: "source",
  type: "image",
  name: "Imported panel",
  src: SOURCE_PNG,
  x: -42.5,
  y: 87.25,
  width: 640,
  height: 960,
  rotation: 17,
  flipped: true,
  flippedY: true,
  skewX: 4,
  skewY: -3,
  opacity: 0.72,
  blur: 2.5,
  brightness: 0.12,
  contrast: -0.2,
  grayscale: true,
  sepia: true,
  saturation: 0.4,
  hue: -35,
  temperature: 22,
  sharpen: 0.65,
  pixelate: 3,
  invert: true,
  levelsBlack: 12,
  levelsWhite: 238,
  levelsGamma: 1.15,
  levelsOutBlack: 3,
  levelsOutWhite: 249,
  shadowColor: "#123456",
  shadowBlur: 9,
  shadowOffsetX: 4,
  shadowOffsetY: -2,
  shadowOpacity: 0.35,
  cornerRadius: 18,
  filterMaskSrc: "data:image/png;base64,TUFTSw==",
  filterMaskEnabled: true,
  maskSrc: "data:image/png;base64,TEFZRVI=",
  maskEnabled: true,
  blendMode: "multiply",
  lockAspect: true,
  noClip: true,
  alphaLocked: true,
} satisfies El);

function text(id: string, groupId?: string): El {
  return {
    id,
    type: "text",
    text: id,
    x: 0,
    y: 0,
    width: 100,
    fontSize: 20,
    fill: "#111111",
    rotation: 0,
    ...(groupId === undefined ? {} : { groupId }),
  };
}

function input(
  overrides: Partial<PlanStudioLayerLiftInput> = {},
): PlanStudioLayerLiftInput {
  return {
    elements: [SOURCE],
    groups: [],
    sourceId: SOURCE.id,
    groupId: "lift-group",
    backgroundId: "lift-background",
    foregroundId: "lift-foreground",
    outputBasis: STUDIO_LAYER_LIFT_OUTPUT_BASIS,
    persistenceScope: STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
    backgroundPngDataUrl: BACKGROUND_PNG,
    foregroundPngDataUrl: FOREGROUND_PNG,
    ...overrides,
  };
}

function success(
  result: StudioLayerLiftPlanResult,
): Extract<StudioLayerLiftPlanResult, { ok: true }> {
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function expectFailure(
  result: StudioLayerLiftPlanResult,
  code: StudioLayerLiftPlanErrorCode,
  elements: readonly El[],
  groups: readonly LayerGroup[],
): void {
  expect(result).toMatchObject({ ok: false, code });
  if (result.ok) throw new Error(`expected ${code}`);
  expect(result.nextElements).toBe(elements);
  expect(result.nextGroups).toBe(groups);
}

describe("studio layer lift document plan", () => {
  it("replaces the source at the same z-position in BACK → FRONT member order", () => {
    const behind = text("behind");
    const inFront = text("in-front");
    const elements = [behind, SOURCE, inFront];
    const result = success(planStudioLayerLift(input({ elements, confidence: 0.91 })));

    expect(result.nextElements.map((element) => element.id)).toEqual([
      "behind",
      "source",
      "lift-background",
      "lift-foreground",
      "in-front",
    ]);
    expect(result.nextElements[0]).toBe(behind);
    expect(result.nextElements[4]).toBe(inFront);
    expect(result.selectedId).toBe("lift-foreground");
    expect(result.diagnostics).toEqual({
      sourceIndex: 1,
      confidence: 0.91,
      memberOrder: ["original", "background", "foreground"],
      outputByteLengths: { background: 77, foreground: 76 },
    });
  });

  it("retains the source ID in the backup and keeps generated layers free of duplicated effects", () => {
    const result = success(planStudioLayerLift(input()));
    const [original, background, foreground] = result.nextElements;

    expect(original).toEqual({
      ...SOURCE,
      name: STUDIO_LAYER_LIFT_MEMBER_NAMES.original,
      groupId: "lift-group",
      hidden: true,
      locked: true,
    });
    expect(background).toEqual({
      id: "lift-background",
      type: "image",
      name: STUDIO_LAYER_LIFT_MEMBER_NAMES.background,
      src: BACKGROUND_PNG,
      x: SOURCE.x,
      y: SOURCE.y,
      width: SOURCE.width,
      height: SOURCE.height,
      rotation: SOURCE.rotation,
      flipped: SOURCE.flipped,
      flippedY: SOURCE.flippedY,
      skewX: SOURCE.skewX,
      skewY: SOURCE.skewY,
      lockAspect: SOURCE.lockAspect,
      noClip: SOURCE.noClip,
      groupId: "lift-group",
      hidden: false,
      locked: false,
    });
    expect(foreground).toEqual({
      id: "lift-foreground",
      type: "image",
      name: STUDIO_LAYER_LIFT_MEMBER_NAMES.foreground,
      src: FOREGROUND_PNG,
      x: SOURCE.x,
      y: SOURCE.y,
      width: SOURCE.width,
      height: SOURCE.height,
      rotation: SOURCE.rotation,
      flipped: SOURCE.flipped,
      flippedY: SOURCE.flippedY,
      skewX: SOURCE.skewX,
      skewY: SOURCE.skewY,
      lockAspect: SOURCE.lockAspect,
      noClip: SOURCE.noClip,
      groupId: "lift-group",
      hidden: false,
      locked: false,
    });
    expect(original).not.toBe(SOURCE);
    expect(background).not.toBe(SOURCE);
    expect(foreground).not.toBe(SOURCE);

    for (const layer of [background, foreground]) {
      expect(layer).toMatchObject({
        x: SOURCE.x,
        y: SOURCE.y,
        width: SOURCE.width,
        height: SOURCE.height,
        rotation: SOURCE.rotation,
        flipped: SOURCE.flipped,
        flippedY: SOURCE.flippedY,
        skewX: SOURCE.skewX,
        skewY: SOURCE.skewY,
      });
      expect(layer).not.toHaveProperty("opacity");
      expect(layer).not.toHaveProperty("blur");
      expect(layer).not.toHaveProperty("filterMaskSrc");
      expect(layer).not.toHaveProperty("maskSrc");
      expect(layer).not.toHaveProperty("blendMode");
      expect(layer).not.toHaveProperty("clipBelow");
      expect(layer).not.toHaveProperty("alphaLocked");
    }
    expect(original).toMatchObject({ src: SOURCE_PNG, hidden: true, locked: true });
    expect(background).toMatchObject({ src: BACKGROUND_PNG, hidden: false, locked: false });
    expect(foreground).toMatchObject({ src: FOREGROUND_PNG, hidden: false, locked: false });
  });

  it("creates one Korean-named contiguous group and leaves no duplicate IDs", () => {
    const result = success(planStudioLayerLift(input()));

    expect(result.newGroup).toEqual(
      createLayerGroup("lift-group", STUDIO_LAYER_LIFT_DEFAULT_GROUP_NAME),
    );
    expect(result.nextGroups).toEqual([result.newGroup]);
    expect(result.nextElements.map((element) => element.name)).toEqual([
      "원본 백업",
      "분리 배경",
      "분리 전경",
    ]);
    expect(result.nextElements.every((element) => element.groupId === "lift-group")).toBe(true);
    expect(hasContiguousLayerGroups(result.nextElements)).toBe(true);

    const allIds = [
      ...result.nextElements.map((element) => element.id),
      ...result.nextGroups.map((group) => group.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it("preserves surrounding z-order, valid group runs and unrelated object references", () => {
    const backA = text("back-a", "back-group");
    const backB = text("back-b", "back-group");
    const looseBack = text("loose-back");
    const looseFront = text("loose-front");
    const frontA = text("front-a", "front-group");
    const frontB = text("front-b", "front-group");
    const backGroup = createLayerGroup("back-group", "배경 묶음");
    const frontGroup = createLayerGroup("front-group", "전경 묶음");
    const elements = [backA, backB, looseBack, SOURCE, looseFront, frontA, frontB];
    const groups = [backGroup, frontGroup];

    const result = success(planStudioLayerLift(input({
      elements,
      groups,
      groupName: "인물 컷 분리",
    })));

    expect(result.nextElements.map((element) => element.id)).toEqual([
      "back-a",
      "back-b",
      "loose-back",
      "source",
      "lift-background",
      "lift-foreground",
      "loose-front",
      "front-a",
      "front-b",
    ]);
    expect(result.nextElements[0]).toBe(backA);
    expect(result.nextElements[1]).toBe(backB);
    expect(result.nextElements[2]).toBe(looseBack);
    expect(result.nextElements[6]).toBe(looseFront);
    expect(result.nextElements[7]).toBe(frontA);
    expect(result.nextElements[8]).toBe(frontB);
    expect(result.nextGroups[0]).toBe(backGroup);
    expect(result.nextGroups[1]).toBe(frontGroup);
    expect(result.nextGroups[2]).toEqual(createLayerGroup("lift-group", "인물 컷 분리"));
    expect(hasContiguousLayerGroups(result.nextElements)).toBe(true);
  });

  it("does not mutate frozen input arrays, elements or groups", () => {
    const behind = Object.freeze(text("behind"));
    const ahead = Object.freeze(text("ahead"));
    const existingGroup = Object.freeze(createLayerGroup("empty-group", "빈 그룹"));
    const elements = Object.freeze([behind, SOURCE, ahead]);
    const groups = Object.freeze([existingGroup]);
    const beforeElements = structuredClone(elements);
    const beforeGroups = structuredClone(groups);

    const result = success(planStudioLayerLift(input({ elements, groups })));

    expect(elements).toEqual(beforeElements);
    expect(groups).toEqual(beforeGroups);
    expect(result.nextElements).not.toBe(elements);
    expect(result.nextGroups).not.toBe(groups);
    expect(result.nextElements[0]).toBe(behind);
    expect(result.nextElements[4]).toBe(ahead);
    expect(result.nextGroups[0]).toBe(existingGroup);
  });

  it.each([
    ["source-missing", { sourceId: "missing" }],
    ["source-not-image", { elements: [text("source")] }],
    ["source-already-grouped", { elements: [{ ...SOURCE, groupId: "old-group" }] }],
    ["source-hidden", { elements: [{ ...SOURCE, hidden: true }] }],
    ["source-locked", { elements: [{ ...SOURCE, locked: true }] }],
    ["source-not-static", { elements: [{ ...SOURCE, frames: [] }] }],
    ["source-not-static", { elements: [{ ...SOURCE, frameFps: 12 }] }],
    ["source-not-static", { elements: [{ ...SOURCE, isAnimatedGif: true }] }],
    [
      "source-not-static",
      { elements: [{ ...SOURCE, bg3dScene: { version: 1 } } as unknown as El] },
    ],
    [
      "source-not-static",
      { elements: [{ ...SOURCE, vrmScene: { version: 1 } } as unknown as El] },
    ],
    [
      "source-not-static",
      { elements: [{ ...SOURCE, bg3dLtBundleId: "bundle-1" }] },
    ],
    [
      "source-not-static",
      { elements: [{ ...SOURCE, bg3dLtRole: "tone" }] },
    ],
    [
      "source-not-static",
      { elements: [{ ...SOURCE, src: "data:image/gif;base64,R0lGODlh" }] },
    ],
  ] as const)("fails the first-slice source precondition %s as a reference-preserving no-op", (
    code,
    overrides,
  ) => {
    const request = input(overrides as Partial<PlanStudioLayerLiftInput>);
    expectFailure(
      planStudioLayerLift(request),
      code,
      request.elements,
      request.groups,
    );
  });

  it.each([
    { backgroundId: "lift-foreground" },
    { foregroundId: "source" },
    { groupId: "existing-group" },
    { backgroundId: "" },
  ])("rejects duplicate, colliding or invalid allocated IDs: %j", (overrides) => {
    const existingGroup = createLayerGroup("existing-group", "기존");
    const request = input({ groups: [existingGroup], ...overrides });
    const expectedCode = overrides.backgroundId === "" ? "invalid-id" : "duplicate-id";
    expectFailure(
      planStudioLayerLift(request),
      expectedCode,
      request.elements,
      request.groups,
    );
  });

  it("requires flattened artifacts and refuses to alter clipping relationships", () => {
    const invalidBasis = input({
      outputBasis: "source-pixels" as typeof STUDIO_LAYER_LIFT_OUTPUT_BASIS,
    });
    expectFailure(
      planStudioLayerLift(invalidBasis),
      "invalid-output-basis",
      invalidBasis.elements,
      invalidBasis.groups,
    );
    const invalidPersistence = input({
      persistenceScope: "saved-collaboration" as typeof STUDIO_LAYER_LIFT_PERSISTENCE_SCOPE,
    });
    expectFailure(
      planStudioLayerLift(invalidPersistence),
      "invalid-persistence-scope",
      invalidPersistence.elements,
      invalidPersistence.groups,
    );

    for (const elements of [
      [{ ...SOURCE, clipBelow: true }],
      [SOURCE, { ...text("clipped-front"), clipBelow: true }],
    ]) {
      const request = input({ elements });
      expectFailure(
        planStudioLayerLift(request),
        "source-clipping-dependent",
        request.elements,
        request.groups,
      );
    }
  });

  it("shares CRDT control-character and reserved group ID safety", () => {
    for (const overrides of [
      { groupId: "page-root" },
      { groupId: "group\u0085id" },
      { backgroundId: "background\u009fid" },
    ]) {
      const request = input(overrides);
      expectFailure(
        planStudioLayerLift(request),
        "invalid-id",
        request.elements,
        request.groups,
      );
    }
  });

  it("rejects duplicate current document IDs and dangling membership capture", () => {
    const duplicated = [SOURCE, text("source")];
    const duplicateRequest = input({ elements: duplicated });
    expectFailure(
      planStudioLayerLift(duplicateRequest),
      "duplicate-id",
      duplicated,
      duplicateRequest.groups,
    );

    const dangling = [SOURCE, text("other", "lift-group")];
    const danglingRequest = input({ elements: dangling });
    expectFailure(
      planStudioLayerLift(danglingRequest),
      "duplicate-id",
      dangling,
      danglingRequest.groups,
    );
  });

  it.each([
    ["data:image/jpeg;base64,AAAA", FOREGROUND_PNG],
    ["data:image/png;base64,", FOREGROUND_PNG],
    ["data:image/png;base64,%%%", FOREGROUND_PNG],
    [BACKGROUND_PNG, "https://example.test/foreground.png"],
  ])("rejects invalid generated PNG outputs without changing the document", (
    backgroundPngDataUrl,
    foregroundPngDataUrl,
  ) => {
    const request = input({ backgroundPngDataUrl, foregroundPngDataUrl });
    expectFailure(
      planStudioLayerLift(request),
      "invalid-output",
      request.elements,
      request.groups,
    );
  });

  it("rejects an already non-contiguous document instead of repairing it incidentally", () => {
    const group = createLayerGroup("broken-group", "깨진 그룹");
    const elements = [
      text("back-member", group.id),
      SOURCE,
      text("front-member", group.id),
    ];
    const request = input({ elements, groups: [group] });

    expect(hasContiguousLayerGroups(elements)).toBe(false);
    expectFailure(
      planStudioLayerLift(request),
      "noncontiguous-groups",
      elements,
      request.groups,
    );
  });

  it("validates optional group metadata without normalizing hostile values", () => {
    for (const overrides of [
      { groupName: " " },
      { confidence: -0.01 },
      { confidence: 1.01 },
      { confidence: Number.NaN },
    ]) {
      const request = input(overrides);
      const expected = "groupName" in overrides
        ? "invalid-group-name"
        : "invalid-confidence";
      expectFailure(
        planStudioLayerLift(request),
        expected,
        request.elements,
        request.groups,
      );
    }
  });
});

describe("studio layer lift source fingerprint", () => {
  it("is deterministic across object key insertion order and exposes a stable version", () => {
    const reorderedSource = Object.fromEntries(
      Object.entries(SOURCE).toReversed(),
    ) as unknown as El;
    const first = fingerprintStudioLayerLiftSource({
      elements: [SOURCE],
      groups: [],
      sourceId: SOURCE.id,
    });
    const second = fingerprintStudioLayerLiftSource({
      elements: [reorderedSource],
      groups: [],
      sourceId: SOURCE.id,
    });

    expect(first).toMatch(/^studio-layer-lift-source-v1:[0-9a-f]{16}$/u);
    expect(second).toBe(first);
  });

  it("accepts the exact current source and rejects content, state and z-order staleness", () => {
    const behind = text("behind");
    const current = {
      elements: [behind, SOURCE],
      groups: [],
      sourceId: SOURCE.id,
    };
    const fingerprint = fingerprintStudioLayerLiftSource(current);
    expect(fingerprint).not.toBeNull();
    expect(isStudioLayerLiftSourceCurrent(fingerprint!, current)).toBe(true);

    expect(isStudioLayerLiftSourceCurrent(fingerprint!, {
      ...current,
      elements: [behind, { ...SOURCE, brightness: 0.13 }],
    })).toBe(false);
    expect(isStudioLayerLiftSourceCurrent(fingerprint!, {
      ...current,
      elements: [SOURCE, behind],
    })).toBe(false);
    expect(isStudioLayerLiftSourceCurrent(fingerprint!, {
      ...current,
      elements: [behind, { ...SOURCE, hidden: true }],
    })).toBe(false);
    expect(isStudioLayerLiftSourceCurrent("not-a-layer-lift-fingerprint", current)).toBe(false);
  });

  it("keeps the fingerprint source-scoped when unrelated content changes in place", () => {
    const before = {
      elements: [text("unrelated"), SOURCE],
      groups: [],
      sourceId: SOURCE.id,
    };
    const fingerprint = fingerprintStudioLayerLiftSource(before);
    const after = {
      ...before,
      elements: [{ ...text("unrelated"), text: "changed" }, SOURCE],
    };

    expect(fingerprint).not.toBeNull();
    expect(isStudioLayerLiftSourceCurrent(fingerprint!, after)).toBe(true);
  });
});
