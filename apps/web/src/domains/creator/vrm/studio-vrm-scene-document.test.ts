import { describe, expect, it } from "vitest";

import { createAvatarForgeState } from "./studio-vrm-avatar-forge";
import { buildVrmPoseDataUrlMetadata } from "./studio-vrm-poser-utils";
import { STUDIO_VRM_RIG_PROFILE_PURPOSE } from "./studio-vrm-rig-profile";
import {
  DEFAULT_STUDIO_VRM_SCENE_DOCUMENT,
  DEFAULT_STUDIO_VRM_LIGHTING_TONE,
  STUDIO_VRM_LIGHTING_TONES,
  STUDIO_VRM_SCENE_DOCUMENT_KIND,
  STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES,
  STUDIO_VRM_SCENE_DOCUMENT_VERSION,
  STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION,
  STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES,
  STUDIO_VRM_SURFACE_PAINT_TEXTURE_MAX_BYTES,
  STUDIO_VRM_SURFACE_PAINT_TOTAL_MAX_BYTES,
  StudioVrmSceneDocumentBudgetError,
  areStudioVrmSceneDocumentsEqual,
  createDefaultStudioVrmSceneDocument,
  migrateStudioVrmLegacyMetadata,
  migrateStudioVrmSceneDocument,
  normalizeStudioVrmSceneDocument,
  parseStudioVrmLegacyFragment,
  parseStudioVrmSceneDocument,
  serializeStudioVrmSceneDocument,
  studioVrmSceneHasContent,
  type StudioVrmSceneDocument,
} from "./studio-vrm-scene-document";

function mutableDefault(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(createDefaultStudioVrmSceneDocument())) as Record<string, unknown>;
}

function expectVrmSceneBudgetError(
  operation: () => unknown,
  code: StudioVrmSceneDocumentBudgetError["code"],
): void {
  try {
    operation();
  } catch (cause) {
    expect(cause).toBeInstanceOf(StudioVrmSceneDocumentBudgetError);
    expect((cause as StudioVrmSceneDocumentBudgetError).code).toBe(code);
    return;
  }
  throw new Error(`Expected Studio VRM scene budget error: ${code}.`);
}

function canonicalScene(overrides: Partial<StudioVrmSceneDocument>): StudioVrmSceneDocument {
  return normalizeStudioVrmSceneDocument({
    ...mutableDefault(),
    ...overrides,
  });
}

function canonicalVersionOne(
  scene: StudioVrmSceneDocument = createDefaultStudioVrmSceneDocument(),
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(scene)) as Record<string, unknown> & {
    pose: Record<string, unknown>;
    rig: unknown;
    lightingTone: unknown;
    surfacePaint: unknown;
  };
  const {
    translations: _translations,
    ikConstraints: _ikConstraints,
    ...legacyPose
  } = cloned.pose;
  const {
    rig: _rig,
    lightingTone: _lightingTone,
    surfacePaint: _surfacePaint,
    ...versionOne
  } = cloned;
  return { ...versionOne, version: 1, pose: legacyPose };
}

function canonicalVersionTwo(
  scene: StudioVrmSceneDocument = createDefaultStudioVrmSceneDocument(),
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(scene)) as Record<string, unknown> & {
    pose: Record<string, unknown>;
    lightingTone: unknown;
    surfacePaint: unknown;
  };
  const {
    translations: _translations,
    ikConstraints: _ikConstraints,
    ...versionTwoPose
  } = cloned.pose;
  const {
    lightingTone: _lightingTone,
    surfacePaint: _surfacePaint,
    ...versionTwo
  } = cloned;
  return { ...versionTwo, version: 2, pose: versionTwoPose };
}

function canonicalVersionThree(
  scene: StudioVrmSceneDocument = createDefaultStudioVrmSceneDocument(),
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(scene)) as Record<string, unknown> & {
    pose: Record<string, unknown>;
    lightingTone: unknown;
    surfacePaint: unknown;
  };
  const { ikConstraints: _ikConstraints, ...versionThreePose } = cloned.pose;
  const {
    lightingTone: _lightingTone,
    surfacePaint: _surfacePaint,
    ...versionThree
  } = cloned;
  return { ...versionThree, version: 3, pose: versionThreePose };
}

function canonicalVersionFour(
  scene: StudioVrmSceneDocument = createDefaultStudioVrmSceneDocument(),
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(scene)) as Record<string, unknown> & {
    lightingTone: unknown;
    surfacePaint: unknown;
  };
  const {
    lightingTone: _lightingTone,
    surfacePaint: _surfacePaint,
    ...versionFour
  } = cloned;
  return { ...versionFour, version: 4 };
}

function canonicalVersionFive(
  scene: StudioVrmSceneDocument = createDefaultStudioVrmSceneDocument(),
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(scene)) as Record<string, unknown> & {
    lightingTone: unknown;
  };
  const { lightingTone: _lightingTone, ...preLightingTone } = cloned;
  return { ...preLightingTone, version: 5 };
}

describe("studio-vrm-scene-document", () => {
  it("round-trips exact lighting tones and strictly promotes pre-tone v5 to morning", () => {
    expect(createDefaultStudioVrmSceneDocument().lightingTone)
      .toBe(DEFAULT_STUDIO_VRM_LIGHTING_TONE);

    for (const lightingTone of STUDIO_VRM_LIGHTING_TONES) {
      const scene = canonicalScene({ lightingTone });
      const serialized = serializeStudioVrmSceneDocument(scene);
      expect(serialized).not.toBeNull();
      expect(parseStudioVrmSceneDocument(serialized!)?.lightingTone).toBe(lightingTone);
    }

    const versionFive = canonicalVersionFive(canonicalScene({ lightingTone: "night" }));
    const migrated = parseStudioVrmSceneDocument(JSON.stringify(versionFive));
    expect(migrated).toMatchObject({
      version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
      lightingTone: DEFAULT_STUDIO_VRM_LIGHTING_TONE,
    });
    expect(migrateStudioVrmSceneDocument(versionFive)).toEqual(migrated);
    expect(serializeStudioVrmSceneDocument(versionFive)).toBeNull();

    const missingCurrentTone = mutableDefault();
    delete missingCurrentTone.lightingTone;
    expect(parseStudioVrmSceneDocument(JSON.stringify(missingCurrentTone))).toBeNull();
    expect(serializeStudioVrmSceneDocument(missingCurrentTone)).toBeNull();

    for (const lightingTone of ["day", "Morning", "", null, 1]) {
      const malformed = { ...mutableDefault(), lightingTone };
      expect(parseStudioVrmSceneDocument(JSON.stringify(malformed))).toBeNull();
      expect(serializeStudioVrmSceneDocument(malformed)).toBeNull();
      expect(normalizeStudioVrmSceneDocument(malformed).lightingTone)
        .toBe(DEFAULT_STUDIO_VRM_LIGHTING_TONE);
    }
  });

  it("preserves canonical Avatar Forge v4 proportions inside the existing scene envelope", () => {
    const avatarForge = createAvatarForgeState("wave-diva");
    avatarForge.proportions = {
      ...avatarForge.proportions,
      presetId: "webtoon-7",
      overallHeight: 1.08,
      armLength: 1.12,
      torsoLength: 0.94,
    };
    const scene = canonicalScene({
      appearance: {
        ...createDefaultStudioVrmSceneDocument().appearance,
        avatarForge,
      },
    });
    const serialized = serializeStudioVrmSceneDocument(scene);

    expect(scene.version).toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(serialized).not.toBeNull();
    expect(parseStudioVrmSceneDocument(serialized!)?.appearance.avatarForge).toEqual(
      avatarForge,
    );
  });

  it("round-trips a canonical attachment scene without camera or rotation drift", () => {
    const hash = `sha256:${"a1".repeat(32)}`;
    const scene = canonicalScene({
      model: {
        source: "attachment",
        hash,
        byteSize: 8_456_123,
        mime: "model/vrm",
        name: "주인공 모델",
      },
      pose: {
        bones: {
          hips: { rotation: [0.125, -0.25, 0.375] },
          head: { rotation: [-1.125, 0.75, 1.5] },
        },
        yOffset: -0.125,
        translations: {
          version: 1,
          root: [0.4, 0, -0.25],
          hips: [0.08, -0.04, 0.03],
          spine: [-0.03, 0.09, 0.05],
        },
        bodyRotationY: 1.234567890123,
        fingerOverrides: {
          leftIndexProximal: [0.1, 0.2, -0.3],
          rightThumbDistal: [-0.4, 0.5, 0.6],
        },
        ikConstraints: [
          {
            effector: "leftHand",
            enabled: true,
            locked: true,
            target: [-0.45, 1.25, 0.2],
            pole: [-0.8, 1.15, 0.35],
          },
          {
            effector: "rightFoot",
            enabled: false,
            locked: false,
            target: [0.2, 0, -0.1],
            pole: null,
          },
        ],
      },
      expressions: { blinkLeft: 0.25, happy: 0.8 },
      camera: {
        projection: "perspective",
        position: [1.25, 2.5, 3.75],
        target: [0.125, 1.375, -0.25],
        up: [0, 1, 0],
        fovDegrees: 31.75,
        near: 0.025,
        far: 543.21,
      },
      appearance: {
        bodyScale: { height: 1.2, width: 0.91 },
        customColors: { hair: "#abcdef", tops: "#12345678" },
        materialFx: {
          shadeColor: "#123",
          outlineColor: "#010203",
          rimColor: "#abcdef",
          rimIntensity: 0.4,
          emissiveColor: null,
          emissiveIntensity: 0.2,
        },
        mannequin: true,
        avatarForge: { face: { jaw: 0.2 }, tags: ["hero", "adult"] },
        costume: { preset: "school" },
        wardrobe: { items: [{ id: "coat-1", visible: true }] },
      },
      rig: {
        version: 1,
        jointProfile: {
          version: 1,
          purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
          id: "limited",
        },
        fullBodyIk: true,
        footPlant: true,
        floorHeight: -0.125,
      },
      props: { items: [{ id: "prop-1", scale: [1, 1, 1] }] },
      sceneProps: { items: [{ id: "cat-1", parent: "world" }] },
      lighting: { intensity: 1.75, colorTemp: 0.35, directionDeg: -72.5 },
      physics: {
        version: 1,
        stiffnessScale: 1.25,
        gravityScale: 0.8,
        windDirectionDeg: 123,
        windStrength: 0.45,
      },
      env: "room",
      render: {
        width: 2048,
        height: 1536,
        transparentBackground: false,
        backgroundColor: "#fafafa",
      },
      surfacePaint: {
        version: 1,
        textures: [
          {
            bindingKey: "hero-face-base-color",
            materialLocator: "gltf-material:3",
            textureSlot: "baseColor",
            hash: `sha256:${"bc".repeat(32)}`,
            mime: "image/png",
            byteSize: 1_234_567,
            width: 2048,
            height: 2048,
          },
          {
            bindingKey: "hero-coat-base-color",
            materialLocator: "scene-path:Avatar/Coat/Material-0",
            textureSlot: "baseColor",
            hash: `sha256:${"cd".repeat(32)}`,
            mime: "image/png",
            byteSize: 765_432,
            width: 1024,
            height: 2048,
          },
        ],
      },
    });

    const serialized = serializeStudioVrmSceneDocument(scene);
    const parsed = parseStudioVrmSceneDocument(serialized ?? "");

    expect(serialized).not.toBeNull();
    expect(parsed).toEqual(scene);
    expect(parsed?.model).toEqual({
      source: "attachment",
      hash,
      byteSize: 8_456_123,
      mime: "model/vrm",
      name: "주인공 모델",
    });
    expect(parsed?.camera).toEqual(scene.camera);
    expect(parsed?.camera.position).toEqual([1.25, 2.5, 3.75]);
    expect(parsed?.pose.bodyRotationY).toBe(1.234567890123);
    expect(parsed?.pose.translations).toEqual(scene.pose.translations);
    expect(parsed?.surfacePaint).toEqual(scene.surfacePaint);
    expect(serializeStudioVrmSceneDocument(parsed)).toBe(serialized);
  });

  it("returns detached, deeply frozen defaults and canonicalizes rotations", () => {
    const first = createDefaultStudioVrmSceneDocument();
    const second = createDefaultStudioVrmSceneDocument();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.camera.position)).toBe(true);

    const normalized = normalizeStudioVrmSceneDocument({
      ...mutableDefault(),
      pose: {
        bones: {
          head: { rotation: [Math.PI * 4 + 0.5, -Math.PI * 4 - 0.25, -0] },
          unknownBone: { rotation: [1, 2, 3] },
          leftUpperArm: { direction: { sideX: 0.5, y: -1 } },
        },
        yOffset: 0,
        bodyRotationY: Math.PI * 2 + 0.75,
        fingerOverrides: {
          leftIndexProximal: [Math.PI * 2 + 0.2, 0, 0],
          head: [1, 2, 3],
        },
      },
    });

    expect(normalized.pose.bones).toEqual({ head: { rotation: [0.5, -0.25, 0] } });
    expect(normalized.pose.bodyRotationY).toBeCloseTo(0.75, 12);
    expect(normalized.pose.fingerOverrides).toEqual({
      leftIndexProximal: [expect.closeTo(0.2, 12), 0, 0],
    });
  });

  it("rejects unsafe model references, attachment-local ids, and malformed hashes", () => {
    const bundled = mutableDefault();
    bundled.model = { source: "bundled", id: "blob:local-key", name: "unsafe" };
    expect(parseStudioVrmSceneDocument(JSON.stringify(bundled))).toBeNull();
    expect(serializeStudioVrmSceneDocument(bundled)).toBeNull();

    const attachmentWithLocalId = mutableDefault();
    attachmentWithLocalId.model = {
      source: "attachment",
      id: "indexed-db-row-7",
      hash: `sha256:${"ab".repeat(32)}`,
      byteSize: 10,
      mime: "model/vrm",
      name: "모델",
    };
    expect(parseStudioVrmSceneDocument(JSON.stringify(attachmentWithLocalId))).toBeNull();

    const uppercaseHash = mutableDefault();
    uppercaseHash.model = {
      source: "attachment",
      hash: `sha256:${"AB".repeat(32)}`,
      byteSize: 10,
      mime: "model/gltf-binary",
      name: "모델",
    };
    expect(parseStudioVrmSceneDocument(JSON.stringify(uppercaseHash))).toBeNull();
  });

  it("rejects unsafe URLs, binary values, sparse arrays, NaN, and future versions", () => {
    const unsafeUrl = mutableDefault();
    unsafeUrl.props = { runtimeUrl: "blob:hostile" };
    expect(parseStudioVrmSceneDocument(JSON.stringify(unsafeUrl))).toBeNull();

    const avatarForgeCurl = canonicalScene({
      appearance: {
        ...createDefaultStudioVrmSceneDocument().appearance,
        avatarForge: { hair: { style: "bob", curl: 0.48 } },
      },
    });
    expect(avatarForgeCurl.appearance.avatarForge).toEqual({
      hair: { curl: 0.48, style: "bob" },
    });
    const serializedAvatarForgeCurl = serializeStudioVrmSceneDocument(avatarForgeCurl);
    expect(serializedAvatarForgeCurl).not.toBeNull();
    expect(parseStudioVrmSceneDocument(
      serializedAvatarForgeCurl!,
    )?.appearance.avatarForge).toEqual({
      hair: { curl: 0.48, style: "bob" },
    });

    const unsafeCurlValue = mutableDefault();
    unsafeCurlValue.props = { curl: "https://hostile.example/model" };
    expect(serializeStudioVrmSceneDocument(unsafeCurlValue)).toBeNull();

    const dataUrl = mutableDefault();
    dataUrl.sceneProps = { texture: "data:image/png;base64,AAAA" };
    expect(serializeStudioVrmSceneDocument(dataUrl)).toBeNull();

    const binary = mutableDefault();
    binary.props = { bytes: new Uint8Array([1, 2, 3]) };
    expect(serializeStudioVrmSceneDocument(binary)).toBeNull();

    const sparse = mutableDefault();
    const items = new Array(2) as unknown[];
    items[1] = "only-one";
    sparse.props = { items };
    expect(serializeStudioVrmSceneDocument(sparse)).toBeNull();

    const nan = mutableDefault();
    nan.lighting = { intensity: Number.NaN, colorTemp: 0.5, directionDeg: 0 };
    expect(serializeStudioVrmSceneDocument(nan)).toBeNull();

    const future = mutableDefault();
    future.version = STUDIO_VRM_SCENE_DOCUMENT_VERSION + 1;
    expect(parseStudioVrmSceneDocument(JSON.stringify(future))).toBeNull();
    expect(migrateStudioVrmSceneDocument(future)).toBeNull();
  });

  it("losslessly promotes strict v1/v2/v3/v4/v5 scenes to v6 with neutral additions", () => {
    const current = canonicalScene({
      pose: {
        bones: {
          leftUpperArm: { rotation: [0.25, -0.5, 0.75] },
          rightUpperArm: { rotation: [0.25, 0.5, -0.75] },
        },
        yOffset: 0.14,
        translations: {
          version: 1,
          root: [0, 0, 0],
          hips: [0, 0, 0],
          spine: [0, 0, 0],
        },
        bodyRotationY: -0.4,
        fingerOverrides: {
          leftIndexProximal: [0.1, 0.2, -0.3],
          rightIndexProximal: [0.1, -0.2, 0.3],
        },
        ikConstraints: [],
      },
      camera: {
        projection: "perspective",
        position: [-1.25, 2.1, 4.25],
        target: [0.2, 1.3, -0.1],
        up: [0, 1, 0],
        fovDegrees: 37,
        near: 0.05,
        far: 250,
      },
      props: { items: [{ id: "mirror-safe-prop", side: "left" }] },
    });
    const versionOne = canonicalVersionOne(current);
    const versionTwo = canonicalVersionTwo(current);
    const versionThree = canonicalVersionThree(current);
    const versionFour = canonicalVersionFour(current);
    const versionFive = canonicalVersionFive(current);

    const parsed = parseStudioVrmSceneDocument(JSON.stringify(versionOne));
    const migrated = migrateStudioVrmSceneDocument(versionOne);
    const migratedVersionTwo = parseStudioVrmSceneDocument(JSON.stringify(versionTwo));
    const migratedVersionThree = parseStudioVrmSceneDocument(JSON.stringify(versionThree));
    const migratedVersionFour = parseStudioVrmSceneDocument(JSON.stringify(versionFour));
    const migratedVersionFive = parseStudioVrmSceneDocument(JSON.stringify(versionFive));

    expect(parsed).toEqual(migrated);
    expect(migratedVersionTwo).toEqual(parsed);
    expect(migratedVersionThree).toEqual(parsed);
    expect(migratedVersionFour).toEqual(parsed);
    expect(migratedVersionFive).toEqual(parsed);
    expect(parsed).toMatchObject({
      kind: STUDIO_VRM_SCENE_DOCUMENT_KIND,
      version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
      pose: current.pose,
      camera: current.camera,
      props: current.props,
      rig: {
        version: 1,
        jointProfile: {
          version: 1,
          purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
          id: "neutral",
        },
        fullBodyIk: false,
        footPlant: false,
        floorHeight: 0,
      },
      surfacePaint: { version: 1, textures: [] },
      lightingTone: DEFAULT_STUDIO_VRM_LIGHTING_TONE,
    });
    expect(parsed?.pose.bones.leftUpperArm).toEqual(current.pose.bones.leftUpperArm);
    expect(parsed?.pose.bones.rightUpperArm).toEqual(current.pose.bones.rightUpperArm);
    expect(parsed?.pose.fingerOverrides).toEqual(current.pose.fingerOverrides);
    expect(serializeStudioVrmSceneDocument(parsed)).not.toBeNull();
  });

  it("requires canonical unique bounded persistent IK constraints in v4", () => {
    const current = canonicalScene({
      pose: {
        ...createDefaultStudioVrmSceneDocument().pose,
        ikConstraints: [
          {
            effector: "leftHand",
            enabled: true,
            locked: true,
            target: [-0.5, 1.25, 0.125],
            pole: [-0.8, 1.1, 0.35],
          },
          {
            effector: "rightFoot",
            enabled: true,
            locked: false,
            target: [0.25, 0, -0.15],
            pole: null,
          },
        ],
      },
    });
    const serialized = serializeStudioVrmSceneDocument(current);
    expect(serialized).not.toBeNull();
    expect(parseStudioVrmSceneDocument(serialized!)).toEqual(current);

    const missing = mutableDefault();
    delete (missing.pose as Record<string, unknown>).ikConstraints;
    expect(serializeStudioVrmSceneDocument(missing)).toBeNull();

    const malformed = (constraints: unknown) => ({
      ...mutableDefault(),
      pose: {
        ...(mutableDefault().pose as Record<string, unknown>),
        ikConstraints: constraints,
      },
    });
    expect(serializeStudioVrmSceneDocument(malformed([
      current.pose.ikConstraints[0],
      current.pose.ikConstraints[0],
    ]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(malformed([
      ...current.pose.ikConstraints,
      { effector: "leftFoot", enabled: true, locked: true, target: [0, 0, 0], pole: null },
      { effector: "rightHand", enabled: true, locked: true, target: [0, 0, 0], pole: null },
      { effector: "head", enabled: true, locked: true, target: [0, 0, 0], pole: null },
    ]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(malformed([
      { effector: "leftHand", enabled: true, locked: true, target: [10_001, 0, 0], pole: null },
    ]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(malformed([
      { effector: "leftHand", enabled: true, locked: true, target: [0, Number.NaN, 0], pole: null },
    ]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(malformed([
      { effector: "leftHand", enabled: true, locked: true, target: [0, 0, 0], pole: null, future: true },
    ]))).toBeNull();
  });

  it("preserves authored v4 IK data while promoting through the v5 surface-paint schema", () => {
    const current = canonicalScene({
      pose: {
        ...createDefaultStudioVrmSceneDocument().pose,
        ikConstraints: [{
          effector: "rightHand",
          enabled: true,
          locked: true,
          target: [0.42, 1.31, -0.18],
          pole: [0.75, 1.12, 0.24],
        }],
      },
    });
    const versionFour = canonicalVersionFour(current);
    const migrated = parseStudioVrmSceneDocument(JSON.stringify(versionFour));

    expect(migrated).not.toBeNull();
    expect(migrated?.version).toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(migrated?.pose).toEqual(current.pose);
    expect(migrated?.surfacePaint).toEqual({ version: 1, textures: [] });
    expect(serializeStudioVrmSceneDocument(migrated)).not.toBeNull();
  });

  it("canonicalizes deterministic PNG bindings while allowing shared content hashes", () => {
    const sharedHash = `sha256:${"31".repeat(32)}`;
    const face = {
      bindingKey: "face-base-color",
      materialLocator: "gltf-material:1",
      textureSlot: "baseColor",
      hash: sharedHash,
      mime: "image/png",
      byteSize: 60_000_000,
      width: 1024,
      height: 1024,
    } as const;
    const eye = {
      ...face,
      bindingKey: "eye-base-color",
      materialLocator: "scene-path:Avatar/Face/Eye-Material",
    };
    const raw = {
      ...mutableDefault(),
      surfacePaint: {
        version: 1,
        textures: [eye, face, { ...face }],
      },
    };

    const normalized = normalizeStudioVrmSceneDocument(raw);
    expect(normalized.surfacePaint).toEqual({
      version: 1,
      textures: [face, eye],
    });
    expect(Object.isFrozen(normalized.surfacePaint.textures)).toBe(true);
    expect(serializeStudioVrmSceneDocument(raw)).toBeNull();

    const serialized = serializeStudioVrmSceneDocument(normalized);
    expect(serialized).not.toBeNull();
    expect(parseStudioVrmSceneDocument(serialized!)).toEqual(normalized);
    expect(serializeStudioVrmSceneDocument(parseStudioVrmSceneDocument(serialized!)))
      .toBe(serialized);
  });

  it("fails closed on conflicting surface bindings and inconsistent shared asset declarations", () => {
    const first = {
      bindingKey: "body-base-color",
      materialLocator: "gltf-material:0",
      textureSlot: "baseColor",
      hash: `sha256:${"41".repeat(32)}`,
      mime: "image/png",
      byteSize: 256_000,
      width: 512,
      height: 512,
    } as const;
    const conflictingBinding = {
      ...first,
      bindingKey: "body-repaint",
      hash: `sha256:${"42".repeat(32)}`,
    };
    const bindingConflict = {
      ...mutableDefault(),
      surfacePaint: { version: 1, textures: [first, conflictingBinding] },
    };
    expect(normalizeStudioVrmSceneDocument(bindingConflict).surfacePaint.textures).toEqual([]);
    expect(serializeStudioVrmSceneDocument(bindingConflict)).toBeNull();
    expect(parseStudioVrmSceneDocument(JSON.stringify(bindingConflict))).toBeNull();

    const inconsistentSharedHash = {
      ...mutableDefault(),
      surfacePaint: {
        version: 1,
        textures: [
          first,
          {
            ...first,
            bindingKey: "coat-base-color",
            materialLocator: "gltf-material:2",
            width: 1024,
          },
        ],
      },
    };
    expect(normalizeStudioVrmSceneDocument(inconsistentSharedHash).surfacePaint.textures).toEqual([]);
    expect(serializeStudioVrmSceneDocument(inconsistentSharedHash)).toBeNull();
  });

  it("rejects unknown surface-paint keys, unsafe locators, non-PNG references, and raw payloads", () => {
    const valid = {
      bindingKey: "face-paint",
      materialLocator: "scene-path:Avatar/Head/Face-Material",
      textureSlot: "baseColor",
      hash: `sha256:${"51".repeat(32)}`,
      mime: "image/png",
      byteSize: 12_345,
      width: 256,
      height: 512,
    } as const;
    const withTextures = (textures: readonly unknown[]) => ({
      ...mutableDefault(),
      surfacePaint: { version: 1, textures },
    });

    const unknownBlockKey = withTextures([valid]);
    (unknownBlockKey.surfacePaint as Record<string, unknown>).future = true;
    expect(serializeStudioVrmSceneDocument(unknownBlockKey)).toBeNull();
    expect(serializeStudioVrmSceneDocument({
      ...mutableDefault(),
      surfacePaint: { version: 2, textures: [valid] },
    })).toBeNull();
    expect(serializeStudioVrmSceneDocument({
      ...mutableDefault(),
      surfacePaint: { version: 1 },
    })).toBeNull();

    expect(serializeStudioVrmSceneDocument(withTextures([{ ...valid, future: true }]))).toBeNull();
    const { bindingKey: _bindingKey, ...missingBindingKey } = valid;
    expect(serializeStudioVrmSceneDocument(withTextures([missingBindingKey]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      rawPixels: [0, 0, 0, 255],
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      materialLocator: "https://assets.example/material",
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      materialLocator: "scene-path:Avatar/../Secret",
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      bindingKey: "blob:runtime-object",
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      textureSlot: "data:image/png",
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      hash: `sha256:${"AB".repeat(32)}`,
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      hash: "data:image/png;base64,AAAA",
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      mime: "image/jpeg",
    }]))).toBeNull();
    expect(serializeStudioVrmSceneDocument(withTextures([{
      ...valid,
      bytes: new Uint8Array([137, 80, 78, 71]),
    }]))).toBeNull();

    expect(serializeStudioVrmSceneDocument(withTextures([valid]))).not.toBeNull();
  });

  it("enforces surface-paint record, archive-byte, dimension, and decoded-pixel budgets", () => {
    const texture = (index: number, overrides: Record<string, unknown> = {}) => ({
      bindingKey: `binding-${index}`,
      materialLocator: `gltf-material:${index}`,
      textureSlot: "baseColor",
      hash: `sha256:${index.toString(16).padStart(64, "0")}`,
      mime: "image/png",
      byteSize: 1,
      width: 1,
      height: 1,
      ...overrides,
    });
    const excessiveCount = {
      ...mutableDefault(),
      surfacePaint: {
        version: 1,
        textures: Array.from(
          { length: STUDIO_VRM_SURFACE_PAINT_MAX_TEXTURES + 1 },
          (_, index) => texture(index + 1),
        ),
      },
    };
    const sixtyFive = {
      ...mutableDefault(),
      surfacePaint: {
        version: 1,
        textures: Array.from({ length: 65 }, (_, index) => texture(index + 1)),
      },
    };
    const normalizedSixtyFive = normalizeStudioVrmSceneDocument(sixtyFive);
    expect(normalizedSixtyFive.surfacePaint.textures).toHaveLength(65);
    expect(serializeStudioVrmSceneDocument(normalizedSixtyFive)).not.toBeNull();
    expectVrmSceneBudgetError(
      () => normalizeStudioVrmSceneDocument(excessiveCount),
      "surface-paint-count-budget-exceeded",
    );
    expect(serializeStudioVrmSceneDocument(excessiveCount)).toBeNull();

    const excessiveBytes = {
      ...mutableDefault(),
      surfacePaint: {
        version: 1,
        textures: [
          texture(201, { byteSize: 50_000_000 }),
          texture(202, {
            byteSize: STUDIO_VRM_SURFACE_PAINT_TOTAL_MAX_BYTES - 50_000_000 + 1,
          }),
        ],
      },
    };
    expectVrmSceneBudgetError(
      () => normalizeStudioVrmSceneDocument(excessiveBytes),
      "surface-paint-byte-budget-exceeded",
    );
    expect(serializeStudioVrmSceneDocument(excessiveBytes)).toBeNull();

    const excessivePixels = {
      ...mutableDefault(),
      surfacePaint: {
        version: 1,
        textures: [301, 302, 303].map((index) => texture(index, {
          width: STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION,
          height: STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION,
        })),
      },
    };
    expectVrmSceneBudgetError(
      () => normalizeStudioVrmSceneDocument(excessivePixels),
      "surface-paint-decoded-pixel-budget-exceeded",
    );
    expect(serializeStudioVrmSceneDocument(excessivePixels)).toBeNull();

    const invalidPerTexture = [
      texture(401, { byteSize: STUDIO_VRM_SURFACE_PAINT_TEXTURE_MAX_BYTES + 1 }),
      texture(402, { width: STUDIO_VRM_SURFACE_PAINT_MAX_DIMENSION + 1 }),
      texture(403, { height: 0 }),
      texture(404, { byteSize: 1.5 }),
      texture(405, { textureSlot: "normal" }),
    ];
    for (const invalid of invalidPerTexture) {
      const scene = {
        ...mutableDefault(),
        surfacePaint: { version: 1, textures: [invalid] },
      };
      expect(normalizeStudioVrmSceneDocument(scene).surfacePaint.textures).toEqual([]);
      expect(serializeStudioVrmSceneDocument(scene)).toBeNull();
    }
  });

  it("keeps authored v2 rig data while adding only the canonical zero translation block", () => {
    const current = canonicalScene({
      rig: {
        version: 1,
        jointProfile: {
          version: 1,
          purpose: STUDIO_VRM_RIG_PROFILE_PURPOSE,
          id: "flexible",
        },
        fullBodyIk: true,
        footPlant: true,
        floorHeight: -0.2,
      },
    });
    const versionTwo = canonicalVersionTwo(current);
    const source = JSON.stringify(versionTwo);
    expect(new TextEncoder().encode(source).byteLength)
      .toBeLessThanOrEqual(STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES);
    const migrated = parseStudioVrmSceneDocument(source);
    expect(migrated?.version).toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(migrated?.rig).toEqual(current.rig);
    expect(migrated?.pose.translations).toEqual({
      version: 1,
      root: [0, 0, 0],
      hips: [0, 0, 0],
      spine: [0, 0, 0],
    });
  });

  it("rejects unknown v1/v2/v3/v4/v5 root, translation, rig, or surface keys", () => {
    const current = mutableDefault();
    expect(parseStudioVrmSceneDocument(JSON.stringify({ ...current, futureRoot: true }))).toBeNull();
    expect(serializeStudioVrmSceneDocument({ ...current, futureRoot: true })).toBeNull();
    expect(parseStudioVrmSceneDocument(JSON.stringify({
      ...current,
      rig: { ...(current.rig as Record<string, unknown>), diagnosis: "none" },
    }))).toBeNull();

    const versionOne = canonicalVersionOne();
    const versionTwo = canonicalVersionTwo();
    const versionFour = canonicalVersionFour();
    const versionFive = canonicalVersionFive();
    expect(parseStudioVrmSceneDocument(JSON.stringify({ ...versionOne, rig: {} }))).toBeNull();
    expect(migrateStudioVrmSceneDocument({ ...versionOne, unknown: true })).toBeNull();
    expect(migrateStudioVrmSceneDocument({ ...versionTwo, unknown: true })).toBeNull();
    expect(migrateStudioVrmSceneDocument({ ...versionFour, unknown: true })).toBeNull();
    expect(migrateStudioVrmSceneDocument({ ...versionFive, unknown: true })).toBeNull();
    expect(migrateStudioVrmSceneDocument({
      ...versionFive,
      lightingTone: "morning",
    })).toBeNull();
    expect(migrateStudioVrmSceneDocument({
      ...versionFour,
      surfacePaint: { version: 1, textures: [] },
    })).toBeNull();
    const pose = current.pose as Record<string, unknown>;
    expect(serializeStudioVrmSceneDocument({
      ...current,
      pose: {
        ...pose,
        translations: {
          ...(pose.translations as Record<string, unknown>),
          future: true,
        },
      },
    })).toBeNull();
  });

  it("keeps near-ceiling v1 content through promotion while rejecting oversized documents", () => {
    const noteEntries = Array.from({ length: 126 }, (_, index) => [
        `note-${String(index).padStart(3, "0")}`,
        "x".repeat(1_000),
      ] as const);
    let notes = Object.fromEntries(noteEntries);
    let versionOne = canonicalVersionOne(canonicalScene({ props: notes }));
    let serializedV1 = JSON.stringify(versionOne);
    let remaining = STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES - 256
      - new TextEncoder().encode(serializedV1).byteLength;
    for (let index = 0; remaining > 0 && index < noteEntries.length; index += 1) {
      const extra = Math.min(24, remaining);
      noteEntries[index] = [noteEntries[index][0], `${noteEntries[index][1]}${"x".repeat(extra)}`];
      remaining -= extra;
    }
    notes = Object.fromEntries(noteEntries);
    versionOne = canonicalVersionOne(canonicalScene({ props: notes }));
    serializedV1 = JSON.stringify(versionOne);
    expect(new TextEncoder().encode(serializedV1).byteLength).toBeGreaterThan(
      STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES - 512,
    );

    const migrated = parseStudioVrmSceneDocument(serializedV1);
    const serializedV2 = serializeStudioVrmSceneDocument(migrated);
    expect(migrated?.props).toEqual(notes);
    expect(serializedV2).not.toBeNull();

    const oversized = `${serializedV2}${" ".repeat(STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES)}`;
    expect(parseStudioVrmSceneDocument(oversized)).toBeNull();

    const compactVersionOne = JSON.stringify(canonicalVersionOne());
    const compactVersionOneBytes = new TextEncoder().encode(compactVersionOne).byteLength;
    const paddedVersionOne = `${compactVersionOne}${" ".repeat(
      STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES - compactVersionOneBytes + 1,
    )}`;
    expect(new TextEncoder().encode(paddedVersionOne).byteLength)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_V1_MAX_BYTES + 1);
    expect(parseStudioVrmSceneDocument(paddedVersionOne)).toBeNull();
    expect(migrateStudioVrmSceneDocument(paddedVersionOne)).toBeNull();
  });

  it("honors historical v2/v3/v4/v5 byte ceilings while reserving v6 migration headroom", () => {
    const compactVersionTwo = JSON.stringify(canonicalVersionTwo());
    const compactBytes = new TextEncoder().encode(compactVersionTwo).byteLength;
    const atCeiling = `${compactVersionTwo}${" ".repeat(
      STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES - compactBytes,
    )}`;
    expect(new TextEncoder().encode(atCeiling).byteLength)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_V2_MAX_BYTES);
    expect(parseStudioVrmSceneDocument(atCeiling)?.version)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(parseStudioVrmSceneDocument(`${atCeiling} `)).toBeNull();

    const compactVersionThree = JSON.stringify(canonicalVersionThree());
    const compactVersionThreeBytes = new TextEncoder().encode(compactVersionThree).byteLength;
    const versionThreeAtCeiling = `${compactVersionThree}${" ".repeat(
      STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES - compactVersionThreeBytes,
    )}`;
    expect(new TextEncoder().encode(versionThreeAtCeiling).byteLength)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_V3_MAX_BYTES);
    expect(parseStudioVrmSceneDocument(versionThreeAtCeiling)?.version)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(parseStudioVrmSceneDocument(`${versionThreeAtCeiling} `)).toBeNull();

    const compactVersionFour = JSON.stringify(canonicalVersionFour());
    const compactVersionFourBytes = new TextEncoder().encode(compactVersionFour).byteLength;
    const versionFourAtCeiling = `${compactVersionFour}${" ".repeat(
      STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES - compactVersionFourBytes,
    )}`;
    expect(new TextEncoder().encode(versionFourAtCeiling).byteLength)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_V4_MAX_BYTES);
    expect(parseStudioVrmSceneDocument(versionFourAtCeiling)?.version)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_VERSION);
    expect(parseStudioVrmSceneDocument(`${versionFourAtCeiling} `)).toBeNull();

    const compactVersionFive = JSON.stringify(canonicalVersionFive());
    const compactVersionFiveBytes = new TextEncoder().encode(compactVersionFive).byteLength;
    const versionFiveAtCeiling = `${compactVersionFive}${" ".repeat(
      STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES - compactVersionFiveBytes,
    )}`;
    expect(new TextEncoder().encode(versionFiveAtCeiling).byteLength)
      .toBe(STUDIO_VRM_SCENE_DOCUMENT_V5_MAX_BYTES);
    expect(parseStudioVrmSceneDocument(versionFiveAtCeiling)).toMatchObject({
      version: STUDIO_VRM_SCENE_DOCUMENT_VERSION,
      lightingTone: DEFAULT_STUDIO_VRM_LIGHTING_TONE,
    });
    expect(parseStudioVrmSceneDocument(`${versionFiveAtCeiling} `)).toBeNull();
  });

  it("never invokes accessors while parsing, serializing, or normalizing", () => {
    let reads = 0;
    const hostile = mutableDefault();
    Object.defineProperty(hostile, "model", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("getter must not execute");
      },
    });

    expect(serializeStudioVrmSceneDocument(hostile)).toBeNull();
    expect(normalizeStudioVrmSceneDocument(hostile)).toEqual(DEFAULT_STUDIO_VRM_SCENE_DOCUMENT);
    expect(migrateStudioVrmSceneDocument(hostile)).toBeNull();
    expect(reads).toBe(0);
  });

  it("rejects current documents over the versioned UTF-8 ceiling", () => {
    const oversized = JSON.stringify({
      ...mutableDefault(),
      props: { note: "가".repeat(STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES) },
    });
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(
      STUDIO_VRM_SCENE_DOCUMENT_MAX_BYTES
    );
    expect(parseStudioVrmSceneDocument(oversized)).toBeNull();
  });

  it("migrates explicit and pre-tool legacy bundled fragments while stripping the PNG fragment", () => {
    const metadata = {
      tool: "vrm-poser",
      modelId: "avatar-a",
      modelName: "untrusted display name",
      yOffset: -0.2,
      bodyRotationY: 0.65,
      bones: {
        head: { rotation: [0.1, 0.2, 0.3] },
        leftUpperArm: { direction: { sideX: 0.3, y: -0.9 } },
      },
      fingerOverrides: { leftIndexDistal: [0.4, 0.5, 0.6] },
      expressionWeights: { happy: 0.75 },
      customColors: { hair: "#ABCDEF" },
      bodyScale: { height: 1.1, width: 0.9 },
      lighting: { intensity: 1.2, colorTemp: 0.4, directionDeg: 30 },
      lightingTone: "night",
      physics: {
        version: 1,
        stiffnessScale: 1.2,
        gravityScale: 0.8,
        windDirectionDeg: 10,
        windStrength: 0.25,
      },
      env: "floor",
      vrmProps: { items: [{ id: "hat" }] },
    };
    const registry = [{ id: "avatar-a", name: "하린" }];
    const rasterSrc = "data:image/png;base64,iVBORw0KGgo=";
    const fragment = `${rasterSrc}#${encodeURIComponent(JSON.stringify(metadata))}`;
    const migrated = parseStudioVrmLegacyFragment(fragment, { bundledModels: registry });

    expect(migrated).toMatchObject({
      status: "resolved",
      rasterSrc,
      document: {
        kind: STUDIO_VRM_SCENE_DOCUMENT_KIND,
        model: { source: "bundled", id: "avatar-a", name: "하린" },
        pose: { yOffset: -0.2, bodyRotationY: 0.65 },
        expressions: { happy: 0.75 },
        lightingTone: "night",
        env: "floor",
      },
    });
    if (migrated?.status !== "resolved") throw new Error("Expected resolved migration");
    expect(migrated.document.pose.bones).toEqual({ head: { rotation: [0.1, 0.2, 0.3] } });
    expect(migrated.document.appearance.customColors).toEqual({ hair: "#abcdef" });
    expect(serializeStudioVrmSceneDocument(migrated.document)).not.toBeNull();

    const { tool: _tool, ...prehistory } = metadata;
    expect(migrateStudioVrmSceneDocument(prehistory, { bundledModels: registry })).toMatchObject({
      model: { id: "avatar-a", name: "하린" },
      pose: { bodyRotationY: 0.65 },
    });
  });

  it("strictly migrates full-state v2/v3 fragments without losing translations or pins", () => {
    const metadata = buildVrmPoseDataUrlMetadata({
      modelId: "avatar-a",
      bones: { head: { rotation: [0.1, -0.2, 0.3] } },
      yOffset: 0.15,
      poseTranslations: {
        version: 1,
        root: [0.4, 0, -0.2],
        hips: [0.1, -0.05, 0.03],
        spine: [-0.08, 0.12, 0.04],
      },
      bodyRotation: 0.45,
      ikConstraints: [{
        effector: "leftHand",
        enabled: true,
        locked: true,
        target: [-0.4, 1.2, 0.15],
        pole: [-0.7, 1.05, 0.3],
      }],
      expressionWeights: { happy: 0.7 },
      lightingTone: "studio",
      props: { version: 1, items: [] },
    }, "하린");
    const decodedMetadata = JSON.parse(JSON.stringify(metadata)) as typeof metadata;
    const registry = [{ id: "avatar-a", name: "하린" }];
    const rasterSrc = "data:image/png;base64,iVBORw0KGgo=";
    const source = `${rasterSrc}#${encodeURIComponent(JSON.stringify(decodedMetadata))}`;
    const migrated = parseStudioVrmLegacyFragment(source, { bundledModels: registry });

    expect(migrated).toMatchObject({
      status: "resolved",
      rasterSrc,
      document: {
        model: { source: "bundled", id: "avatar-a", name: "하린" },
        pose: {
          bones: { head: { rotation: [0.1, -0.2, 0.3] } },
          yOffset: 0.15,
          translations: decodedMetadata.poseTranslations,
          ikConstraints: decodedMetadata.ikConstraints,
          bodyRotationY: 0.45,
        },
        expressions: { happy: 0.7 },
        lightingTone: "studio",
        props: { version: 1, items: [] },
      },
    });

    expect(migrateStudioVrmLegacyMetadata({
      ...decodedMetadata,
      poseTranslations: { ...decodedMetadata.poseTranslations, root: [0, 0.1, 0] },
    }, { bundledModels: registry })).toBeNull();
    expect(migrateStudioVrmLegacyMetadata({
      ...decodedMetadata,
      runtimeUrl: "blob:hostile",
    }, { bundledModels: registry })).toBeNull();
    expect(migrateStudioVrmLegacyMetadata({
      ...decodedMetadata,
      lightingTone: "day",
    }, { bundledModels: registry })).toBeNull();
    const { lightingTone: _lightingTone, ...preToneMetadata } = decodedMetadata;
    expect(migrateStudioVrmLegacyMetadata(
      preToneMetadata,
      { bundledModels: registry },
    )).toMatchObject({
      status: "resolved",
      document: { lightingTone: DEFAULT_STUDIO_VRM_LIGHTING_TONE },
    });
    const { ikConstraints: _ikConstraints, ...historicalVersionTwo } = decodedMetadata;
    expect(migrateStudioVrmLegacyMetadata({
      ...historicalVersionTwo,
      version: 2,
    }, { bundledModels: registry })).toMatchObject({
      status: "resolved",
      document: { pose: { ikConstraints: [] } },
    });
    const { ikConstraints: _missingConstraints, ...missingCurrentConstraints } = decodedMetadata;
    expect(migrateStudioVrmLegacyMetadata(
      missingCurrentConstraints,
      { bundledModels: registry },
    )).toBeNull();
    expect(migrateStudioVrmLegacyMetadata({
      ...decodedMetadata,
      ikConstraints: [decodedMetadata.ikConstraints[0], decodedMetadata.ikConstraints[0]],
    }, { bundledModels: registry })).toBeNull();
    expect(migrateStudioVrmLegacyMetadata({
      ...decodedMetadata,
      modelId: "local-upload-model",
    }, { bundledModels: registry })).toMatchObject({
      status: "unresolved-model",
      modelId: "local-upload-model",
    });
  });

  it("reports arbitrary legacy local ids as unresolved instead of persisting them", () => {
    const metadata = {
      tool: "vrm-poser",
      modelId: "vrm-1712345678-local-row",
      modelName: "내 업로드",
      bones: {},
      yOffset: 0,
    };
    expect(migrateStudioVrmSceneDocument(metadata)).toBeNull();
    expect(migrateStudioVrmLegacyMetadata(metadata)).toEqual({
      status: "unresolved-model",
      modelId: "vrm-1712345678-local-row",
      modelName: "내 업로드",
    });

    const rasterSrc = "data:image/png;base64,AAAA";
    expect(parseStudioVrmLegacyFragment(
      `${rasterSrc}#${encodeURIComponent(JSON.stringify(metadata))}`
    )).toEqual({
      status: "unresolved-model",
      rasterSrc,
      modelId: "vrm-1712345678-local-row",
      modelName: "내 업로드",
    });
  });

  it("rejects legacy metadata with foreign tools or smuggled references", () => {
    expect(migrateStudioVrmSceneDocument({
      tool: "bg3d",
      modelId: "sample-vrm",
      bones: {},
    })).toBeNull();
    expect(migrateStudioVrmSceneDocument({
      tool: "vrm-poser",
      modelId: "sample-vrm",
      bones: {},
      runtimeUrl: "blob:hostile",
    })).toBeNull();
    expect(parseStudioVrmLegacyFragment(
      `data:image/jpeg;base64,AAAA#${encodeURIComponent(JSON.stringify({
        modelId: "sample-vrm",
      }))}`
    )).toBeNull();
  });

  it("provides canonical equality and non-default content helpers", () => {
    const first = createDefaultStudioVrmSceneDocument();
    const second = parseStudioVrmSceneDocument(JSON.stringify(first));
    expect(areStudioVrmSceneDocumentsEqual(first, second)).toBe(true);
    expect(studioVrmSceneHasContent(first)).toBe(false);

    const changed = canonicalScene({ expressions: { happy: 1 } });
    expect(studioVrmSceneHasContent(changed)).toBe(true);
    expect(areStudioVrmSceneDocumentsEqual(first, changed)).toBe(false);
    expect(areStudioVrmSceneDocumentsEqual(first, { ...first, extra: true })).toBe(false);

    const versionOneDefault = canonicalVersionOne(first);
    const versionOneChanged = canonicalVersionOne(changed);
    expect(areStudioVrmSceneDocumentsEqual(versionOneDefault, first)).toBe(true);
    expect(studioVrmSceneHasContent(versionOneDefault)).toBe(false);
    expect(studioVrmSceneHasContent(versionOneChanged)).toBe(true);
  });
});
