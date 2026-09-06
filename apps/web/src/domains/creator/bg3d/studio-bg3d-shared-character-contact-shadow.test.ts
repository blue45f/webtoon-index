import { describe, expect, it } from "vitest";

import {
  createStudioShared3dSceneSession,
  type StudioShared3dCharacterSource,
} from "../studio-shared-3d-scene-bridge";
import {
  createStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
} from "../vrm/studio-vrm-scene-document";

import {
  STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS,
  planStudioBg3dSharedCharacterContactShadows,
  type StudioBg3dSharedCharacterContactShadowQuaternion,
  type StudioBg3dSharedCharacterContactShadowVec3,
} from "./studio-bg3d-shared-character-contact-shadow";
import {
  resolveStudioBg3dSharedCharacterGrounding,
  type StudioBg3dSharedCharacterGroundingResult,
} from "./studio-bg3d-shared-character-grounding";

const STALE_PLACEMENT_HASH = `sha256:${"f".repeat(64)}` as const;

function character({
  elementId = "hero",
  position = [0, 0, 0],
  rotationY = 0,
  width = 1,
}: {
  readonly elementId?: string;
  readonly position?: readonly [number, number, number];
  readonly rotationY?: number;
  readonly width?: number;
} = {}): StudioShared3dCharacterSource {
  const base = createStudioVrmSceneDocument();
  const scene = normalizeStudioVrmSceneDocument({
    ...base,
    appearance: {
      ...base.appearance,
      bodyScale: { ...base.appearance.bodyScale, width },
    },
  });
  const source = createStudioShared3dSceneSession([{
    elementId,
    stageId: "stage-a",
    stageTransform: { position, rotationY },
    scene,
  }]).characters[0];
  if (!source) throw new Error("test character was not admitted");
  return source;
}

function grounding(
  source: StudioShared3dCharacterSource,
  {
    surfacePoint = [0, 0, 0],
    surfaceNormal = [0, 1, 0],
    gapY = 0,
    placementHash = source.placementHash,
  }: {
    readonly surfacePoint?: readonly [number, number, number];
    readonly surfaceNormal?: readonly [number, number, number];
    readonly gapY?: number;
    readonly placementHash?: `sha256:${string}`;
  } = {},
): StudioBg3dSharedCharacterGroundingResult {
  return resolveStudioBg3dSharedCharacterGrounding({
    identity: {
      stageId: source.stageId,
      elementId: source.elementId,
      modelRuntimeKey: source.modelRuntimeKey,
      placementHash,
    },
    placementY: source.stageTransform.position[1],
    anchors: [{
      kind: "left-foot",
      point: [surfacePoint[0], surfacePoint[1] + gapY, surfacePoint[2]],
    }],
    surfaceHit: {
      source: "stage-plane",
      point: surfacePoint,
      normal: surfaceNormal,
    },
  });
}

function plans(
  characters: readonly StudioShared3dCharacterSource[],
  groundingResults: Readonly<Record<string, StudioBg3dSharedCharacterGroundingResult>>,
  options: {
    readonly capturableElementIds?: readonly string[];
    readonly includeInCapture?: boolean;
  } = {},
) {
  return planStudioBg3dSharedCharacterContactShadows({
    characters,
    groundingResults,
    capturableElementIds: options.capturableElementIds
      ?? characters.map(({ elementId }) => elementId),
    includeInCapture: options.includeInCapture ?? true,
  });
}

function replaceSurface(
  result: StudioBg3dSharedCharacterGroundingResult,
  surface: {
    readonly point?: readonly [number, number, number];
    readonly normal?: readonly [number, number, number];
  },
): StudioBg3dSharedCharacterGroundingResult {
  if (!result.ok) throw new Error("test requires a successful receipt");
  return {
    ok: true,
    receipt: {
      ...result.receipt,
      surface: {
        ...result.receipt.surface,
        ...(surface.point ? { point: surface.point } : {}),
        ...(surface.normal ? { normal: surface.normal } : {}),
      },
    },
  };
}

function rotateByQuaternion(
  vector: StudioBg3dSharedCharacterContactShadowVec3,
  quaternion: StudioBg3dSharedCharacterContactShadowQuaternion,
): StudioBg3dSharedCharacterContactShadowVec3 {
  const [qx, qy, qz, qw] = quaternion;
  const [x, y, z] = vector;
  const uv: StudioBg3dSharedCharacterContactShadowVec3 = [
    qy * z - qz * y,
    qz * x - qx * z,
    qx * y - qy * x,
  ];
  const uuv: StudioBg3dSharedCharacterContactShadowVec3 = [
    qy * uv[2] - qz * uv[1],
    qz * uv[0] - qx * uv[2],
    qx * uv[1] - qy * uv[0],
  ];
  return [
    x + 2 * (qw * uv[0] + uuv[0]),
    y + 2 * (qw * uv[1] + uuv[1]),
    z + 2 * (qw * uv[2] + uuv[2]),
  ];
}

function expectVecClose(
  actual: readonly number[],
  expected: readonly number[],
  precision = 10,
): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, precision));
}

describe("Studio BG3D shared-character contact-shadow planner", () => {
  it("creates frozen core and clamped broad patches on a horizontal support plane", () => {
    const source = character({ position: [1, 0, 2] });
    const result = grounding(source, { surfacePoint: [0, 0, 2] });
    const resultPlans = plans([source], { [source.runtimeKey]: result });

    expect(resultPlans).toHaveLength(1);
    const plan = resultPlans[0]!;
    expect(plan.key).toBe(
      `shared-character-contact-shadow:${source.runtimeKey}:${source.placementHash}`,
    );
    expect(plan).toMatchObject({
      elementId: "hero",
      runtimeKey: source.runtimeKey,
      placementHash: source.placementHash,
      surfaceSource: "stage-plane",
      surfaceTargetEntityId: null,
      normal: [0, 1, 0],
      lobes: [
        { kind: "core", radii: [0.24, 0.14], opacity: 0.34 },
        { kind: "broad", radii: [0.62, 0.34], opacity: 0.14 },
      ],
    });
    expectVecClose(plan.lobes[0].center, [0, 0.003, 2]);
    expectVecClose(plan.lobes[1].center, [0.3, 0.0025, 2]);
    expectVecClose(rotateByQuaternion([0, 0, 1], plan.quaternion), [0, 1, 0]);
    expectVecClose(rotateByQuaternion([1, 0, 0], plan.quaternion), [1, 0, 0]);

    expect(Object.isFrozen(resultPlans)).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.normal)).toBe(true);
    expect(Object.isFrozen(plan.quaternion)).toBe(true);
    expect(Object.isFrozen(plan.lobes)).toBe(true);
    for (const lobe of plan.lobes) {
      expect(Object.isFrozen(lobe)).toBe(true);
      expect(Object.isFrozen(lobe.center)).toBe(true);
      expect(Object.isFrozen(lobe.radii)).toBe(true);
      expect([...lobe.center, ...lobe.radii, lobe.opacity].every(Number.isFinite)).toBe(true);
    }
  });

  it("projects onto a sloped plane, keeps the broad centre travel bounded, and aligns +Z", () => {
    const source = character({ position: [0, 0.5, -0.5] });
    const rawNormal = [0, 1, 1] as const;
    const result = grounding(source, { surfaceNormal: rawNormal });
    const plan = plans([source], { [source.runtimeKey]: result })[0]!;
    const normal = [0, Math.SQRT1_2, Math.SQRT1_2] as const;

    expectVecClose(plan.normal, normal);
    expectVecClose(rotateByQuaternion([0, 0, 1], plan.quaternion), normal);
    expectVecClose(rotateByQuaternion([1, 0, 0], plan.quaternion), [1, 0, 0]);
    const broad = plan.lobes[1].center;
    const broadOffset = broad[0] * normal[0] + broad[1] * normal[1]
      + broad[2] * normal[2];
    expect(broadOffset).toBeCloseTo(0.0025, 10);
    const broadBase = [
      broad[0] - normal[0] * broadOffset,
      broad[1] - normal[1] * broadOffset,
      broad[2] - normal[2] * broadOffset,
    ];
    expect(Math.hypot(...broadBase)).toBeCloseTo(
      STUDIO_BG3D_SHARED_CHARACTER_CONTACT_SHADOW_LIMITS
        .maximumBroadCenterTravelWidthFactor,
      10,
    );
  });

  it("uses projected character right as local +X after yaw", () => {
    const source = character({ rotationY: Math.PI / 2 });
    const plan = plans([source], { [source.runtimeKey]: grounding(source) })[0]!;

    expectVecClose(rotateByQuaternion([1, 0, 0], plan.quaternion), [0, 0, -1]);
    expectVecClose(rotateByQuaternion([0, 0, 1], plan.quaternion), [0, 1, 0]);
  });

  it("rejects stale runtime and exact-identity mismatches", () => {
    const source = character();
    const exact = grounding(source);
    const stalePlacement = grounding(source, { placementHash: STALE_PLACEMENT_HASH });
    if (!exact.ok) throw new Error("test requires a successful receipt");
    const staleModel: StudioBg3dSharedCharacterGroundingResult = {
      ok: true,
      receipt: {
        ...exact.receipt,
        identity: { ...exact.receipt.identity, modelRuntimeKey: "stale-model" },
      },
    };
    const staleStage: StudioBg3dSharedCharacterGroundingResult = {
      ok: true,
      receipt: {
        ...exact.receipt,
        identity: { ...exact.receipt.identity, stageId: "stale-stage" },
      },
    };

    expect(plans([source], { "old-runtime": exact })).toEqual([]);
    expect(plans([source], { [source.runtimeKey]: stalePlacement })).toEqual([]);
    expect(plans([source], { [source.runtimeKey]: staleModel })).toEqual([]);
    expect(plans([source], { [source.runtimeKey]: staleStage })).toEqual([]);
  });

  it("rejects floating, penetrating, and failed grounding results", () => {
    const source = character();
    const failure = Object.freeze({
      ok: false as const,
      code: "invalid-input" as const,
    });

    expect(plans([source], { [source.runtimeKey]: grounding(source, { gapY: 0.1 }) }))
      .toEqual([]);
    expect(plans([source], { [source.runtimeKey]: grounding(source, { gapY: -0.1 }) }))
      .toEqual([]);
    expect(plans([source], { [source.runtimeKey]: failure })).toEqual([]);
  });

  it("fails closed when capture is disabled or the exact element is not capturable", () => {
    const source = character();
    const result = { [source.runtimeKey]: grounding(source) };

    expect(plans([source], result, { includeInCapture: false })).toEqual([]);
    expect(plans([source], result, { capturableElementIds: [] })).toEqual([]);
    expect(plans([source], result, { capturableElementIds: ["other"] })).toEqual([]);
  });

  it("rejects non-finite and unsupported support geometry without throwing", () => {
    const source = character();
    const exact = grounding(source);
    const invalidSurfaces = [
      replaceSurface(exact, { point: [Number.NaN, 0, 0] }),
      replaceSurface(exact, { normal: [0, 0, 0] }),
      replaceSurface(exact, { normal: [1, 0.2, 0] }),
    ];
    for (const result of invalidSurfaces) {
      expect(plans([source], { [source.runtimeKey]: result })).toEqual([]);
    }

    const invalidPosition = {
      ...source,
      stageTransform: {
        ...source.stageTransform,
        position: [Number.POSITIVE_INFINITY, 0, 0] as const,
      },
    };
    const invalidYaw = {
      ...source,
      stageTransform: { ...source.stageTransform, rotationY: Number.NaN },
    };
    const zeroWidth = {
      ...source,
      scene: {
        ...source.scene,
        appearance: {
          ...source.scene.appearance,
          bodyScale: { ...source.scene.appearance.bodyScale, width: 0 },
        },
      },
    };
    for (const invalid of [invalidPosition, invalidYaw, zeroWidth]) {
      expect(plans([invalid], { [invalid.runtimeKey]: exact })).toEqual([]);
    }
  });

  it("clamps radii and opacity from finite out-of-contract width scales", () => {
    const source = character();
    const exact = grounding(source);
    const withWidth = (width: number): StudioShared3dCharacterSource => ({
      ...source,
      scene: {
        ...source.scene,
        appearance: {
          ...source.scene.appearance,
          bodyScale: { ...source.scene.appearance.bodyScale, width },
        },
      },
    });
    const narrow = withWidth(0.1);
    const wide = withWidth(8);
    const narrowPlan = plans([narrow], { [source.runtimeKey]: exact })[0]!;
    const widePlan = plans([wide], { [source.runtimeKey]: exact })[0]!;

    expectVecClose(narrowPlan.lobes[0].radii, [0.12, 0.07]);
    expect(narrowPlan.lobes[0].opacity).toBeCloseTo(0.34 * Math.sqrt(0.5), 10);
    expectVecClose(widePlan.lobes[1].radii, [0.992, 0.544]);
    expect(widePlan.lobes[0].opacity).toBe(0.43);
    expect(widePlan.lobes[1].opacity).toBeLessThan(widePlan.lobes[0].opacity);
  });

  it("retains deterministic source order for multiple exact characters", () => {
    const beta = character({ elementId: "beta", position: [1, 0, 0] });
    const alpha = character({ elementId: "alpha", position: [-1, 0, 0] });
    const groundings = {
      [alpha.runtimeKey]: grounding(alpha, { surfacePoint: [-1, 0, 0] }),
      [beta.runtimeKey]: grounding(beta, { surfacePoint: [1, 0, 0] }),
    };
    const inputOptions = { capturableElementIds: ["alpha", "beta"] } as const;
    const first = plans([beta, alpha], groundings, inputOptions);
    const second = plans([beta, alpha], groundings, inputOptions);

    expect(first.map(({ elementId }) => elementId)).toEqual(["beta", "alpha"]);
    expect(first.map(({ key }) => key)).toEqual(second.map(({ key }) => key));
    expect(first).toEqual(second);
    expect(new Set(first.map(({ key }) => key).values()).size).toBe(2);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
