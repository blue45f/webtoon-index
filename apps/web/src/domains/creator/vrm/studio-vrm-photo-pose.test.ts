import { describe, expect, it } from "vitest";

import {
  STUDIO_VRM_PHOTO_POSE_LIMITS,
  StudioVrmPhotoPoseError,
  admitStudioVrmPhotoPoseFile,
  createStudioVrmPhotoPoseInferenceResult,
  createStudioVrmPhotoPoseOutputPlan,
  inspectStudioVrmPhotoPoseImage,
  normalizeStudioVrmPhotoPoseOptions,
  summarizeStudioVrmPhotoPoseConfidence,
  type StudioVrmPhotoPoseLandmark,
} from "./studio-vrm-photo-pose";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function jpegHeader(width: number, height: number, orientation: number): Uint8Array {
  const exifPayload = new Uint8Array(32);
  exifPayload.set([69, 120, 105, 102, 0, 0], 0); // Exif\0\0
  exifPayload.set([73, 73, 42, 0, 8, 0, 0, 0], 6); // little-endian TIFF + IFD0 offset
  exifPayload.set([1, 0], 14); // one IFD entry
  exifPayload.set([0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0], 16);
  const bytes = new Uint8Array(2 + 4 + exifPayload.length + 2 + 8 + 2);
  let offset = 0;
  bytes.set([0xff, 0xd8], offset);
  offset += 2;
  bytes.set([0xff, 0xe1, 0, exifPayload.length + 2], offset);
  offset += 4;
  bytes.set(exifPayload, offset);
  offset += exifPayload.length;
  bytes.set([0xff, 0xc0, 0, 8, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1], offset);
  offset += 10;
  bytes.set([0xff, 0xd9], offset);
  return bytes;
}

function webpVp8xHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([82, 73, 70, 70], 0); // RIFF
  new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
  bytes.set([87, 69, 66, 80, 86, 80, 56, 88], 8); // WEBPVP8X
  new DataView(bytes.buffer).setUint32(16, 10, true);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes.set([
    0, 0, 0, 0,
    widthMinusOne & 0xff,
    (widthMinusOne >> 8) & 0xff,
    (widthMinusOne >> 16) & 0xff,
    heightMinusOne & 0xff,
    (heightMinusOne >> 8) & 0xff,
    (heightMinusOne >> 16) & 0xff,
  ], 20);
  return bytes;
}

function landmarks(confidence = 0.8): StudioVrmPhotoPoseLandmark[] {
  const values = Array.from({ length: 33 }, (_, index) => ({
    x: index * 0.001,
    y: index * 0.002,
    z: index * -0.001,
    visibility: confidence,
    presence: confidence,
  }));
  Object.assign(values[11]!, { x: -0.3, y: -0.5, z: 0 });
  Object.assign(values[13]!, { x: -0.5, y: -0.2, z: 0 });
  Object.assign(values[15]!, { x: -0.7, y: 0.1, z: 0 });
  Object.assign(values[12]!, { x: 0.3, y: -0.5, z: 0 });
  Object.assign(values[14]!, { x: 0.5, y: -0.2, z: 0 });
  Object.assign(values[16]!, { x: 0.7, y: 0.1, z: 0 });
  Object.assign(values[23]!, { x: -0.2, y: 0.1, z: 0 });
  Object.assign(values[25]!, { x: -0.2, y: 0.5, z: 0 });
  Object.assign(values[27]!, { x: -0.2, y: 0.9, z: 0 });
  Object.assign(values[29]!, { x: -0.2, y: 0.9, z: -0.2 });
  Object.assign(values[24]!, { x: 0.2, y: 0.1, z: 0 });
  Object.assign(values[26]!, { x: 0.2, y: 0.5, z: 0 });
  Object.assign(values[28]!, { x: 0.2, y: 0.9, z: 0 });
  Object.assign(values[30]!, { x: 0.2, y: 0.9, z: -0.2 });
  return values;
}

describe("studio VRM photo-pose file admission", () => {
  it("accepts only bounded JPEG, PNG, and WebP files and normalizes extension-only MIME", () => {
    expect(admitStudioVrmPhotoPoseFile({ name: "pose.JPG", size: 20, type: "" })).toEqual({
      fileName: "pose.JPG",
      mimeType: "image/jpeg",
      byteSize: 20,
    });
    expect(() => admitStudioVrmPhotoPoseFile({ name: "pose.gif", size: 20, type: "image/gif" }))
      .toThrowError(StudioVrmPhotoPoseError);
    expect(() => admitStudioVrmPhotoPoseFile({ name: "pose.png", size: 20, type: "image/jpeg" }))
      .toThrowError(expect.objectContaining({ code: "mime-mismatch" }));
    expect(() => admitStudioVrmPhotoPoseFile({ name: "pose.webp", size: 0, type: "image/webp" }))
      .toThrowError(expect.objectContaining({ code: "empty-file" }));
    expect(() => admitStudioVrmPhotoPoseFile({
      name: "pose.webp",
      size: STUDIO_VRM_PHOTO_POSE_LIMITS.maxFileBytes + 1,
      type: "image/webp",
    })).toThrowError(expect.objectContaining({ code: "file-too-large" }));
  });

  it("canonicalizes quarter turns and fail-closes arbitrary rotation and oversized output budgets", () => {
    expect(normalizeStudioVrmPhotoPoseOptions({ rotation: -90, mirrorHorizontal: true })).toMatchObject({
      exifMode: "apply",
      rotation: 270,
      mirrorHorizontal: true,
    });
    expect(normalizeStudioVrmPhotoPoseOptions({ rotation: 450 }).rotation).toBe(90);
    expect(() => normalizeStudioVrmPhotoPoseOptions({ rotation: 45 }))
      .toThrowError(expect.objectContaining({ code: "invalid-options" }));
    expect(() => normalizeStudioVrmPhotoPoseOptions({ maxOutputPixels: Number.MAX_SAFE_INTEGER }))
      .toThrowError(expect.objectContaining({ code: "invalid-options" }));
  });
});

describe("studio VRM photo-pose encoded image inspection", () => {
  it("reads dimensions and JPEG EXIF orientation without invoking a browser decoder", () => {
    expect(inspectStudioVrmPhotoPoseImage(pngHeader(640, 480), "image/png")).toMatchObject({
      width: 640,
      height: 480,
      exifOrientation: 1,
    });
    expect(inspectStudioVrmPhotoPoseImage(jpegHeader(400, 300, 6), "image/jpeg")).toMatchObject({
      width: 400,
      height: 300,
      exifOrientation: 6,
    });
    expect(inspectStudioVrmPhotoPoseImage(webpVp8xHeader(1_920, 1_080), "image/webp")).toMatchObject({
      width: 1_920,
      height: 1_080,
      exifOrientation: 1,
    });
  });

  it("rejects signature/MIME disagreement, malformed containers, and pixel bombs before decode", () => {
    expect(() => inspectStudioVrmPhotoPoseImage(pngHeader(100, 100), "image/jpeg"))
      .toThrowError(expect.objectContaining({ code: "mime-mismatch" }));
    expect(() => inspectStudioVrmPhotoPoseImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg"))
      .toThrowError(expect.objectContaining({ code: "decode-failed" }));
    expect(() => inspectStudioVrmPhotoPoseImage(pngHeader(10_000, 10_000), "image/png"))
      .toThrowError(expect.objectContaining({ code: "image-dimensions" }));
  });

  it("combines EXIF, user rotation, and horizontal mirror into a bounded output plan", () => {
    const inspection = inspectStudioVrmPhotoPoseImage(jpegHeader(4_000, 3_000, 6), "image/jpeg");
    const exifPlan = createStudioVrmPhotoPoseOutputPlan(
      inspection,
      normalizeStudioVrmPhotoPoseOptions({ maxOutputDimension: 1_024, maxOutputPixels: 1_024 * 1_024 }),
    );
    expect(exifPlan).toMatchObject({
      orientedWidth: 3_000,
      orientedHeight: 4_000,
      outputWidth: 768,
      outputHeight: 1_024,
      appliedExifOrientation: 6,
    });
    const ignoredAndRotated = createStudioVrmPhotoPoseOutputPlan(
      inspection,
      normalizeStudioVrmPhotoPoseOptions({ exifMode: "ignore", rotation: 90, mirrorHorizontal: true }),
    );
    expect(ignoredAndRotated.orientedWidth).toBe(3_000);
    expect(ignoredAndRotated.orientedHeight).toBe(4_000);
    expect(ignoredAndRotated.appliedExifOrientation).toBe(1);
    expect(ignoredAndRotated.matrix).toEqual({ a: 0, b: 1, c: 1, d: 0 });
  });
});

describe("studio VRM photo-pose MediaPipe result contract", () => {
  it("copies one 33-joint pose, solves VRM bones, and summarizes joint confidence", () => {
    const normalized = landmarks(0.8);
    const world = landmarks(0.8);
    const result = createStudioVrmPhotoPoseInferenceResult(7, {
      landmarks: [normalized],
      worldLandmarks: [world],
    });
    expect(result.generationId).toBe(7);
    expect(result.normalizedLandmarks).not.toBe(normalized);
    expect(result.worldLandmarks).not.toBe(world);
    expect(result.confidence).toMatchObject({ overall: 0.8, coverage: 1, quality: "high" });
    expect(result.confidence.groups.leftArm).toBe(0.8);
    expect(result.bones.leftUpperArm).toBeDefined();
    expect(result.bones.rightUpperLeg).toBeDefined();
  });

  it("reports low-confidence body regions without silently promoting missing confidence", () => {
    const values = landmarks(0.9);
    values[13]!.visibility = 0.1;
    values[15]!.presence = 0.1;
    const summary = summarizeStudioVrmPhotoPoseConfidence(values);
    expect(summary.groups.leftArm).toBeLessThan(0.5);
    expect(summary.lowConfidenceGroups).toContain("leftArm");
    const missing = landmarks(0.9);
    delete missing[11]!.visibility;
    delete missing[11]!.presence;
    expect(summarizeStudioVrmPhotoPoseConfidence(missing).joints.leftShoulder).toBe(0);
  });

  it("distinguishes no-pose from malformed or ambiguous MediaPipe payloads", () => {
    expect(() => createStudioVrmPhotoPoseInferenceResult(1, { landmarks: [], worldLandmarks: [] }))
      .toThrowError(expect.objectContaining({ code: "no-pose" }));
    expect(() => createStudioVrmPhotoPoseInferenceResult(1, {
      landmarks: [landmarks(), landmarks()],
      worldLandmarks: [landmarks(), landmarks()],
    })).toThrowError(expect.objectContaining({ code: "protocol" }));
    const invalid = landmarks();
    invalid[3]!.x = Number.NaN;
    expect(() => createStudioVrmPhotoPoseInferenceResult(1, {
      landmarks: [invalid],
      worldLandmarks: [landmarks()],
    })).toThrowError(expect.objectContaining({ code: "protocol" }));
  });
});
