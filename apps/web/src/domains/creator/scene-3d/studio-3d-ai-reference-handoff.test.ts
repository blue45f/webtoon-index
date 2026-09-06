import { describe, expect, expectTypeOf, it } from "vitest";

import {
  STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS,
  STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_MAX_DATA_URL_CODE_UNITS,
  STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_VERSION,
  createStudioBg3dAiMethodReferenceCapture,
  type CreateStudioBg3dAiMethodReferenceCaptureInput,
  type StudioBg3dAiMethodReferenceCapture,
} from "./studio-3d-ai-reference-handoff";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+3n0AAAAASUVORK5CYII=";
const SCENE_DIGEST = `sha256:${"a".repeat(64)}` as const;

function captureIdentity() {
  return {
    backend: "three-webgl",
    engineId: "three",
    engineVersion: "184",
    implementationRevision: "studio-three-webgl-capture-adapter-v1",
    graphicsApi: "webgl2" as const,
    profileId: "studio-rgba8-straight-srgb-topdown-depth-f32-v1",
  };
}

function pngHeaderDataUrl(
  width: number,
  height: number,
  decodedByteLength = 24,
): string {
  if (decodedByteLength < 24) throw new RangeError("test PNG header requires 24 bytes");
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    header,
  );
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);

  const remainingBytes = decodedByteLength - header.byteLength;
  const fullGroups = Math.floor(remainingBytes / 3);
  const remainder = remainingBytes % 3;
  const tail = remainder === 1 ? "AA==" : remainder === 2 ? "AAA=" : "";
  return (
    PNG_DATA_URL_PREFIX
    + header.toString("base64")
    + "AAAA".repeat(fullGroups)
    + tail
  );
}

function validInput(
  overrides: Partial<CreateStudioBg3dAiMethodReferenceCaptureInput> = {},
): CreateStudioBg3dAiMethodReferenceCaptureInput {
  return {
    dataUrl: PNG_1X1,
    width: 1,
    height: 1,
    captureIdentity: captureIdentity(),
    ...overrides,
  };
}

describe("Studio background-3D AI Method-reference handoff", () => {
  it("creates a renderer-neutral version-1 Method reference and freezes owned metadata", () => {
    const identity = captureIdentity();
    const capture = createStudioBg3dAiMethodReferenceCapture({
      ...validInput(),
      captureIdentity: identity,
      sceneDigest: SCENE_DIGEST,
      shotId: "shot-1",
    });

    expect(capture).toEqual({
      version: STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_VERSION,
      sourceKind: "bg3d",
      dataUrl: PNG_1X1,
      width: 1,
      height: 1,
      captureIdentity: identity,
      sceneDigest: SCENE_DIGEST,
      shotId: "shot-1",
      suggestedRole: "method",
    });
    expect(Object.isFrozen(capture)).toBe(true);
    expect(Object.isFrozen(capture.captureIdentity)).toBe(true);
    expect(capture.captureIdentity).not.toBe(identity);
    identity.engineVersion = "mutated-after-handoff";
    expect(capture.captureIdentity.engineVersion).toBe("184");
    expectTypeOf(capture).toMatchTypeOf<
      Readonly<StudioBg3dAiMethodReferenceCapture>
    >();
  });

  it("accepts omitted scene/shot provenance and the inclusive dimension boundary", () => {
    const maximumAxis =
      STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumAxisPixels;
    const capture = createStudioBg3dAiMethodReferenceCapture(
      validInput({
        dataUrl: pngHeaderDataUrl(maximumAxis, maximumAxis),
        width: maximumAxis,
        height: maximumAxis,
      }),
    );

    expect(capture).not.toHaveProperty("sceneDigest");
    expect(capture).not.toHaveProperty("shotId");
    expect(capture.width).toBe(maximumAxis);
    expect(capture.height).toBe(maximumAxis);
  });

  it.each([
    ["a fragment", `${PNG_1X1}#scene-metadata`],
    [
      "a non-canonical header",
      PNG_1X1.replace(
        PNG_DATA_URL_PREFIX,
        "data:image/png;charset=utf-8;base64,",
      ),
    ],
    ["a non-base64 payload", `${PNG_DATA_URL_PREFIX}%%%=`],
    [
      "a spoofed signature",
      `${PNG_DATA_URL_PREFIX}${Buffer.alloc(24).toString("base64")}`,
    ],
  ])("rejects a PNG data URL with %s", (_label, dataUrl) => {
    expect(() =>
      createStudioBg3dAiMethodReferenceCapture(validInput({ dataUrl })),
    ).toThrow(TypeError);
  });

  it("rejects a PNG whose IHDR dimensions differ from the DTO", () => {
    expect(() =>
      createStudioBg3dAiMethodReferenceCapture(
        validInput({
          dataUrl: pngHeaderDataUrl(2, 1),
          width: 1,
          height: 1,
        }),
      ),
    ).toThrow(/IHDR dimensions/u);
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 1.5],
    [
      "over the axis limit",
      STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumAxisPixels + 1,
    ],
  ])("rejects a %s dimension", (_label, width) => {
    expect(() =>
      createStudioBg3dAiMethodReferenceCapture(
        validInput({
          dataUrl: pngHeaderDataUrl(Math.max(1, Math.ceil(width)), 1),
          width,
        }),
      ),
    ).toThrow();
  });

  it("rejects one decoded PNG byte over the AI reference budget before decoding the body", () => {
    const maximumBytes =
      STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_LIMITS.maximumDecodedPngBytes;
    const dataUrl = pngHeaderDataUrl(1, 1, maximumBytes + 1);

    expect(dataUrl.length).toBeGreaterThan(
      STUDIO_BG3D_AI_METHOD_REFERENCE_CAPTURE_MAX_DATA_URL_CODE_UNITS,
    );
    expect(() =>
      createStudioBg3dAiMethodReferenceCapture(validInput({ dataUrl })),
    ).toThrow(RangeError);
  });

  it.each([
    ["non-canonical scene digest", { sceneDigest: "a".repeat(64) }],
    ["invalid shot id", { shotId: "shot id" }],
    [
      "invalid graphics API",
      {
        captureIdentity: {
          ...captureIdentity(),
          graphicsApi: "webgl1",
        },
      },
    ],
    [
      "unknown capture identity property",
      {
        captureIdentity: {
          ...captureIdentity(),
          renderer: "private-three-instance",
        },
      },
    ],
    ["unknown root property", { renderer: {} }],
  ])("rejects %s", (_label, patch) => {
    expect(() =>
      createStudioBg3dAiMethodReferenceCapture({
        ...validInput(),
        ...patch,
      } as unknown as CreateStudioBg3dAiMethodReferenceCaptureInput),
    ).toThrow(TypeError);
  });

  it("rejects accessor-bearing input without invoking the getter", () => {
    let getterCalls = 0;
    const hostile = {
      width: 1,
      height: 1,
      captureIdentity: captureIdentity(),
    } as Record<string, unknown>;
    Object.defineProperty(hostile, "dataUrl", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return PNG_1X1;
      },
    });

    expect(() =>
      createStudioBg3dAiMethodReferenceCapture(
        hostile as unknown as CreateStudioBg3dAiMethodReferenceCaptureInput,
      ),
    ).toThrow(TypeError);
    expect(getterCalls).toBe(0);
  });
});
