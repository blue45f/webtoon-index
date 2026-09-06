import { solvePoseToVrmBones, type BoneEulerMap, type PoseLandmark } from "./studio-vrm-pose-solver";

export const STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION = 1 as const;

export const STUDIO_VRM_PHOTO_POSE_LIMITS = {
  maxFileBytes: 16 * 1024 * 1024,
  maxSourceDimension: 12_000,
  maxSourcePixels: 40 * 1024 * 1024,
  maxOutputDimension: 2_048,
  maxOutputPixels: 4 * 1024 * 1024,
  landmarkCount: 33,
} as const;

export const STUDIO_VRM_PHOTO_POSE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type StudioVrmPhotoPoseMimeType = typeof STUDIO_VRM_PHOTO_POSE_MIME_TYPES[number];
export type StudioVrmPhotoPoseRotation = 0 | 90 | 180 | 270;
export type StudioVrmPhotoPoseExifMode = "apply" | "ignore";

export type StudioVrmPhotoPoseErrorCode =
  | "aborted"
  | "decode-failed"
  | "disposed"
  | "empty-file"
  | "file-too-large"
  | "image-dimensions"
  | "inference-failed"
  | "invalid-options"
  | "mime-mismatch"
  | "no-pose"
  | "protocol"
  | "stale-generation"
  | "timeout"
  | "unsupported-browser"
  | "unsupported-type"
  | "worker-failed";

const ERROR_MESSAGES: Readonly<Record<StudioVrmPhotoPoseErrorCode, string>> = {
  aborted: "사진 포즈 인식을 취소했습니다.",
  "decode-failed": "사진을 해석하지 못했습니다. 손상되지 않은 JPG, PNG 또는 WebP 파일을 선택해 주세요.",
  disposed: "종료된 사진 포즈 스캐너는 다시 사용할 수 없습니다.",
  "empty-file": "비어 있는 사진은 포즈로 인식할 수 없습니다.",
  "file-too-large": "사진은 16MB 이하여야 합니다.",
  "image-dimensions": "사진 크기가 안전 범위를 벗어났습니다. 한 변 12,000px, 총 4,000만 픽셀 이하로 줄여 주세요.",
  "inference-failed": "사진에서 포즈를 분석하지 못했습니다.",
  "invalid-options": "사진 회전 또는 반전 설정이 올바르지 않습니다.",
  "mime-mismatch": "파일 내용과 확장자 또는 MIME 형식이 일치하지 않습니다.",
  "no-pose": "사진에서 충분히 선명한 한 사람의 전신 포즈를 찾지 못했습니다.",
  protocol: "사진 포즈 처리 결과를 안전하게 확인하지 못했습니다.",
  "stale-generation": "더 최근에 선택한 사진이 있어 이전 포즈 결과를 적용하지 않았습니다.",
  timeout: "사진 포즈 처리 시간이 초과되었습니다. 더 작은 사진으로 다시 시도해 주세요.",
  "unsupported-browser": "이 브라우저는 안전한 사진 포즈 전처리를 지원하지 않습니다.",
  "unsupported-type": "JPG, PNG 또는 WebP 사진만 포즈로 인식할 수 있습니다.",
  "worker-failed": "사진 전처리 Worker를 실행하지 못했습니다.",
};

export class StudioVrmPhotoPoseError extends Error {
  constructor(
    readonly code: StudioVrmPhotoPoseErrorCode,
    options?: ErrorOptions,
  ) {
    super(ERROR_MESSAGES[code], options);
    this.name = "StudioVrmPhotoPoseError";
  }
}

export interface StudioVrmPhotoPoseFileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

export interface StudioVrmPhotoPoseFileAdmission {
  readonly fileName: string;
  readonly mimeType: StudioVrmPhotoPoseMimeType;
  readonly byteSize: number;
}

export interface StudioVrmPhotoPoseInputOptions {
  readonly exifMode?: StudioVrmPhotoPoseExifMode;
  readonly rotation?: number;
  readonly mirrorHorizontal?: boolean;
  readonly maxOutputDimension?: number;
  readonly maxOutputPixels?: number;
}

export interface NormalizedStudioVrmPhotoPoseOptions {
  readonly exifMode: StudioVrmPhotoPoseExifMode;
  readonly rotation: StudioVrmPhotoPoseRotation;
  readonly mirrorHorizontal: boolean;
  readonly maxOutputDimension: number;
  readonly maxOutputPixels: number;
}

export interface StudioVrmPhotoPoseImageInspection {
  readonly mimeType: StudioVrmPhotoPoseMimeType;
  readonly width: number;
  readonly height: number;
  readonly pixelCount: number;
  /** JPEG EXIF orientation. PNG/WebP and JPEG files without the tag use 1. */
  readonly exifOrientation: number;
}

export interface StudioVrmPhotoPoseTransformMatrix {
  readonly a: -1 | 0 | 1;
  readonly b: -1 | 0 | 1;
  readonly c: -1 | 0 | 1;
  readonly d: -1 | 0 | 1;
}

export interface StudioVrmPhotoPoseOutputPlan {
  readonly matrix: StudioVrmPhotoPoseTransformMatrix;
  readonly orientedWidth: number;
  readonly orientedHeight: number;
  readonly outputWidth: number;
  readonly outputHeight: number;
  readonly scale: number;
  readonly appliedExifOrientation: number;
}

export interface StudioVrmPhotoPoseLandmark extends PoseLandmark {
  presence?: number;
}

export interface StudioVrmPhotoPoseJointConfidence {
  readonly leftShoulder: number;
  readonly rightShoulder: number;
  readonly leftElbow: number;
  readonly rightElbow: number;
  readonly leftWrist: number;
  readonly rightWrist: number;
  readonly leftHip: number;
  readonly rightHip: number;
  readonly leftKnee: number;
  readonly rightKnee: number;
  readonly leftAnkle: number;
  readonly rightAnkle: number;
}

export interface StudioVrmPhotoPoseConfidenceSummary {
  readonly overall: number;
  readonly coverage: number;
  readonly quality: "low" | "medium" | "high";
  readonly groups: {
    readonly torso: number;
    readonly leftArm: number;
    readonly rightArm: number;
    readonly leftLeg: number;
    readonly rightLeg: number;
  };
  readonly joints: StudioVrmPhotoPoseJointConfidence;
  readonly lowConfidenceGroups: readonly (keyof StudioVrmPhotoPoseConfidenceSummary["groups"])[];
}

export interface StudioVrmPhotoPoseInferenceResult {
  readonly version: typeof STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION;
  readonly generationId: number;
  readonly normalizedLandmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly worldLandmarks: readonly StudioVrmPhotoPoseLandmark[];
  readonly bones: BoneEulerMap;
  readonly confidence: StudioVrmPhotoPoseConfidenceSummary;
}

const MIME_TYPE_SET = new Set<string>(STUDIO_VRM_PHOTO_POSE_MIME_TYPES);
const EXTENSION_MIME: Readonly<Record<string, StudioVrmPhotoPoseMimeType>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum;
}

function mimeForFileName(name: string): StudioVrmPhotoPoseMimeType | null {
  const match = /\.([a-z0-9]+)$/iu.exec(name.trim());
  return match ? EXTENSION_MIME[match[1]!.toLowerCase()] ?? null : null;
}

export function admitStudioVrmPhotoPoseFile(
  file: StudioVrmPhotoPoseFileLike,
): StudioVrmPhotoPoseFileAdmission {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new StudioVrmPhotoPoseError("empty-file");
  }
  if (file.size > STUDIO_VRM_PHOTO_POSE_LIMITS.maxFileBytes) {
    throw new StudioVrmPhotoPoseError("file-too-large");
  }
  const extensionMime = mimeForFileName(file.name);
  const claimedMime = file.type.trim().toLowerCase();
  if (claimedMime && !MIME_TYPE_SET.has(claimedMime)) {
    throw new StudioVrmPhotoPoseError("unsupported-type");
  }
  if (!extensionMime && !claimedMime) {
    throw new StudioVrmPhotoPoseError("unsupported-type");
  }
  if (extensionMime && claimedMime && extensionMime !== claimedMime) {
    throw new StudioVrmPhotoPoseError("mime-mismatch");
  }
  const mimeType = (claimedMime || extensionMime) as StudioVrmPhotoPoseMimeType;
  return { fileName: file.name, mimeType, byteSize: file.size };
}

function normalizedRotation(value: number | undefined): StudioVrmPhotoPoseRotation {
  const rotation = value ?? 0;
  if (!Number.isFinite(rotation) || !Number.isInteger(rotation) || rotation % 90 !== 0) {
    throw new StudioVrmPhotoPoseError("invalid-options");
  }
  return ((rotation % 360) + 360) % 360 as StudioVrmPhotoPoseRotation;
}

export function normalizeStudioVrmPhotoPoseOptions(
  options: StudioVrmPhotoPoseInputOptions = {},
): NormalizedStudioVrmPhotoPoseOptions {
  const exifMode = options.exifMode ?? "apply";
  if (exifMode !== "apply" && exifMode !== "ignore") {
    throw new StudioVrmPhotoPoseError("invalid-options");
  }
  if (options.mirrorHorizontal !== undefined && typeof options.mirrorHorizontal !== "boolean") {
    throw new StudioVrmPhotoPoseError("invalid-options");
  }
  const maxOutputDimension = options.maxOutputDimension ?? STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputDimension;
  const maxOutputPixels = options.maxOutputPixels ?? STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputPixels;
  if (
    !finiteInteger(maxOutputDimension, 256, STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputDimension)
    || !finiteInteger(maxOutputPixels, 256 * 256, STUDIO_VRM_PHOTO_POSE_LIMITS.maxOutputPixels)
  ) {
    throw new StudioVrmPhotoPoseError("invalid-options");
  }
  return {
    exifMode,
    rotation: normalizedRotation(options.rotation),
    mirrorHorizontal: options.mirrorHorizontal ?? false,
    maxOutputDimension,
    maxOutputPixels,
  };
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) return "";
  let result = "";
  for (let index = 0; index < length; index++) result += String.fromCharCode(bytes[offset + index]!);
  return result;
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function hasJpegSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 16 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
}

export function detectStudioVrmPhotoPoseMimeType(bytes: Uint8Array): StudioVrmPhotoPoseMimeType {
  if (hasJpegSignature(bytes)) return "image/jpeg";
  if (hasPngSignature(bytes)) return "image/png";
  if (hasWebpSignature(bytes)) return "image/webp";
  throw new StudioVrmPhotoPoseError("unsupported-type");
}

function validateDimensions(width: number, height: number): void {
  const pixels = width * height;
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 1
    || height < 1
    || width > STUDIO_VRM_PHOTO_POSE_LIMITS.maxSourceDimension
    || height > STUDIO_VRM_PHOTO_POSE_LIMITS.maxSourceDimension
    || !Number.isSafeInteger(pixels)
    || pixels > STUDIO_VRM_PHOTO_POSE_LIMITS.maxSourcePixels
  ) {
    throw new StudioVrmPhotoPoseError("image-dimensions");
  }
}

function parsePngDimensions(bytes: Uint8Array): readonly [number, number] {
  if (bytes.byteLength < 24 || ascii(bytes, 12, 4) !== "IHDR") {
    throw new StudioVrmPhotoPoseError("decode-failed");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(16, false), view.getUint32(20, false)];
}

function readTiffUint16(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 2 > view.byteLength) return null;
  return view.getUint16(offset, littleEndian);
}

function readTiffUint32(view: DataView, offset: number, littleEndian: boolean): number | null {
  if (offset < 0 || offset + 4 > view.byteLength) return null;
  return view.getUint32(offset, littleEndian);
}

function parseJpegExifOrientation(bytes: Uint8Array, payloadOffset: number, payloadLength: number): number {
  if (payloadLength < 14 || ascii(bytes, payloadOffset, 6) !== "Exif\0\0") return 1;
  const tiffOffset = payloadOffset + 6;
  const tiffLength = payloadLength - 6;
  const view = new DataView(bytes.buffer, bytes.byteOffset + tiffOffset, tiffLength);
  const byteOrder = ascii(bytes, tiffOffset, 2);
  if (byteOrder !== "II" && byteOrder !== "MM") return 1;
  const littleEndian = byteOrder === "II";
  if (readTiffUint16(view, 2, littleEndian) !== 42) return 1;
  const firstIfdOffset = readTiffUint32(view, 4, littleEndian);
  if (firstIfdOffset === null) return 1;
  const count = readTiffUint16(view, firstIfdOffset, littleEndian);
  if (count === null || count > 1_024) return 1;
  for (let index = 0; index < count; index++) {
    const entryOffset = firstIfdOffset + 2 + index * 12;
    const tag = readTiffUint16(view, entryOffset, littleEndian);
    if (tag !== 0x0112) continue;
    const type = readTiffUint16(view, entryOffset + 2, littleEndian);
    const valueCount = readTiffUint32(view, entryOffset + 4, littleEndian);
    const orientation = readTiffUint16(view, entryOffset + 8, littleEndian);
    return type === 3 && valueCount === 1 && orientation !== null && orientation >= 1 && orientation <= 8
      ? orientation
      : 1;
  }
  return 1;
}

function parseJpeg(bytes: Uint8Array): { width: number; height: number; exifOrientation: number } {
  let offset = 2;
  let width = 0;
  let height = 0;
  let exifOrientation = 1;
  while (offset + 1 < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.byteLength) throw new StudioVrmPhotoPoseError("decode-failed");
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) {
      throw new StudioVrmPhotoPoseError("decode-failed");
    }
    const payloadOffset = offset + 2;
    const payloadLength = segmentLength - 2;
    if (marker === 0xe1 && exifOrientation === 1) {
      exifOrientation = parseJpegExifOrientation(bytes, payloadOffset, payloadLength);
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (payloadLength < 6) throw new StudioVrmPhotoPoseError("decode-failed");
      height = (bytes[payloadOffset + 1]! << 8) | bytes[payloadOffset + 2]!;
      width = (bytes[payloadOffset + 3]! << 8) | bytes[payloadOffset + 4]!;
    }
    offset += segmentLength;
  }
  if (width < 1 || height < 1) throw new StudioVrmPhotoPoseError("decode-failed");
  return { width, height, exifOrientation };
}

function littleUint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function parseWebpDimensions(bytes: Uint8Array): readonly [number, number] {
  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const chunkType = ascii(bytes, offset, 4);
    const chunkSize = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    const payload = offset + 8;
    if (chunkSize > bytes.byteLength - payload) throw new StudioVrmPhotoPoseError("decode-failed");
    if (chunkType === "VP8X" && chunkSize >= 10) {
      return [littleUint24(bytes, payload + 4) + 1, littleUint24(bytes, payload + 7) + 1];
    }
    if (
      chunkType === "VP8 "
      && chunkSize >= 10
      && bytes[payload + 3] === 0x9d
      && bytes[payload + 4] === 0x01
      && bytes[payload + 5] === 0x2a
    ) {
      return [
        ((bytes[payload + 7]! << 8) | bytes[payload + 6]!) & 0x3fff,
        ((bytes[payload + 9]! << 8) | bytes[payload + 8]!) & 0x3fff,
      ];
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && bytes[payload] === 0x2f) {
      const b0 = bytes[payload + 1]!;
      const b1 = bytes[payload + 2]!;
      const b2 = bytes[payload + 3]!;
      const b3 = bytes[payload + 4]!;
      return [1 + b0 + ((b1 & 0x3f) << 8), 1 + (b1 >> 6) + (b2 << 2) + ((b3 & 0x0f) << 10)];
    }
    offset = payload + chunkSize + (chunkSize & 1);
  }
  throw new StudioVrmPhotoPoseError("decode-failed");
}

/** Checks the encoded signature and dimensions before any browser image decoder sees the bytes. */
export function inspectStudioVrmPhotoPoseImage(
  bytes: Uint8Array,
  claimedMimeType: StudioVrmPhotoPoseMimeType,
): StudioVrmPhotoPoseImageInspection {
  if (bytes.byteLength === 0) throw new StudioVrmPhotoPoseError("empty-file");
  if (bytes.byteLength > STUDIO_VRM_PHOTO_POSE_LIMITS.maxFileBytes) {
    throw new StudioVrmPhotoPoseError("file-too-large");
  }
  const mimeType = detectStudioVrmPhotoPoseMimeType(bytes);
  if (mimeType !== claimedMimeType) throw new StudioVrmPhotoPoseError("mime-mismatch");
  let width: number;
  let height: number;
  let exifOrientation = 1;
  if (mimeType === "image/png") {
    [width, height] = parsePngDimensions(bytes);
  } else if (mimeType === "image/webp") {
    [width, height] = parseWebpDimensions(bytes);
  } else {
    ({ width, height, exifOrientation } = parseJpeg(bytes));
  }
  validateDimensions(width, height);
  return { mimeType, width, height, pixelCount: width * height, exifOrientation };
}

const IDENTITY_MATRIX: StudioVrmPhotoPoseTransformMatrix = { a: 1, b: 0, c: 0, d: 1 };

function exifMatrix(orientation: number): StudioVrmPhotoPoseTransformMatrix {
  const matrices: readonly StudioVrmPhotoPoseTransformMatrix[] = [
    IDENTITY_MATRIX,
    { a: -1, b: 0, c: 0, d: 1 },
    { a: -1, b: 0, c: 0, d: -1 },
    { a: 1, b: 0, c: 0, d: -1 },
    { a: 0, b: 1, c: 1, d: 0 },
    { a: 0, b: 1, c: -1, d: 0 },
    { a: 0, b: -1, c: -1, d: 0 },
    { a: 0, b: -1, c: 1, d: 0 },
  ];
  return matrices[orientation - 1] ?? IDENTITY_MATRIX;
}

function rotationMatrix(rotation: StudioVrmPhotoPoseRotation): StudioVrmPhotoPoseTransformMatrix {
  if (rotation === 90) return { a: 0, b: 1, c: -1, d: 0 };
  if (rotation === 180) return { a: -1, b: 0, c: 0, d: -1 };
  if (rotation === 270) return { a: 0, b: -1, c: 1, d: 0 };
  return IDENTITY_MATRIX;
}

function multiplyMatrix(
  left: StudioVrmPhotoPoseTransformMatrix,
  right: StudioVrmPhotoPoseTransformMatrix,
): StudioVrmPhotoPoseTransformMatrix {
  return {
    a: (left.a * right.a + left.c * right.b) as -1 | 0 | 1,
    b: (left.b * right.a + left.d * right.b) as -1 | 0 | 1,
    c: (left.a * right.c + left.c * right.d) as -1 | 0 | 1,
    d: (left.b * right.c + left.d * right.d) as -1 | 0 | 1,
  };
}

export function createStudioVrmPhotoPoseOutputPlan(
  inspection: StudioVrmPhotoPoseImageInspection,
  options: NormalizedStudioVrmPhotoPoseOptions,
): StudioVrmPhotoPoseOutputPlan {
  const appliedExifOrientation = options.exifMode === "apply" ? inspection.exifOrientation : 1;
  let matrix = multiplyMatrix(rotationMatrix(options.rotation), exifMatrix(appliedExifOrientation));
  if (options.mirrorHorizontal) {
    matrix = multiplyMatrix({ a: -1, b: 0, c: 0, d: 1 }, matrix);
  }
  const orientedWidth = Math.abs(matrix.a) * inspection.width + Math.abs(matrix.c) * inspection.height;
  const orientedHeight = Math.abs(matrix.b) * inspection.width + Math.abs(matrix.d) * inspection.height;
  const scale = Math.min(
    1,
    options.maxOutputDimension / Math.max(orientedWidth, orientedHeight),
    Math.sqrt(options.maxOutputPixels / (orientedWidth * orientedHeight)),
  );
  const outputWidth = Math.max(1, Math.round(orientedWidth * scale));
  const outputHeight = Math.max(1, Math.round(orientedHeight * scale));
  return {
    matrix,
    orientedWidth,
    orientedHeight,
    outputWidth,
    outputHeight,
    scale,
    appliedExifOrientation,
  };
}

function finiteLandmark(value: unknown, normalized: boolean): StudioVrmPhotoPoseLandmark | null {
  if (!isRecord(value)) return null;
  const maximum = normalized ? 100 : 10_000;
  const coordinates = [value.x, value.y, value.z];
  if (coordinates.some((entry) => typeof entry !== "number" || !Number.isFinite(entry) || Math.abs(entry) > maximum)) {
    return null;
  }
  for (const field of ["visibility", "presence"] as const) {
    const confidence = value[field];
    if (confidence !== undefined && (
      typeof confidence !== "number"
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1
    )) return null;
  }
  return {
    x: value.x as number,
    y: value.y as number,
    z: value.z as number,
    ...(typeof value.visibility === "number" ? { visibility: value.visibility } : {}),
    ...(typeof value.presence === "number" ? { presence: value.presence } : {}),
  };
}

function validatedLandmarkArray(value: unknown, normalized: boolean): StudioVrmPhotoPoseLandmark[] | null {
  if (!Array.isArray(value) || value.length !== STUDIO_VRM_PHOTO_POSE_LIMITS.landmarkCount) return null;
  const landmarks: StudioVrmPhotoPoseLandmark[] = [];
  for (const entry of value) {
    const landmark = finiteLandmark(entry, normalized);
    if (!landmark) return null;
    landmarks.push(landmark);
  }
  return landmarks;
}

function confidenceFor(landmark: StudioVrmPhotoPoseLandmark): number {
  const visibility = landmark.visibility;
  const presence = landmark.presence;
  if (visibility === undefined && presence === undefined) return 0;
  if (visibility === undefined) return presence!;
  if (presence === undefined) return visibility;
  return Math.min(visibility, presence);
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);
}

function roundConfidence(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

export function summarizeStudioVrmPhotoPoseConfidence(
  landmarks: readonly StudioVrmPhotoPoseLandmark[],
): StudioVrmPhotoPoseConfidenceSummary {
  if (landmarks.length !== STUDIO_VRM_PHOTO_POSE_LIMITS.landmarkCount) {
    throw new StudioVrmPhotoPoseError("protocol");
  }
  const score = (index: number) => roundConfidence(confidenceFor(landmarks[index]!));
  const joints: StudioVrmPhotoPoseJointConfidence = {
    leftShoulder: score(11),
    rightShoulder: score(12),
    leftElbow: score(13),
    rightElbow: score(14),
    leftWrist: score(15),
    rightWrist: score(16),
    leftHip: score(23),
    rightHip: score(24),
    leftKnee: score(25),
    rightKnee: score(26),
    leftAnkle: score(27),
    rightAnkle: score(28),
  };
  const groups = {
    torso: roundConfidence(average([joints.leftShoulder, joints.rightShoulder, joints.leftHip, joints.rightHip])),
    leftArm: roundConfidence(average([joints.leftShoulder, joints.leftElbow, joints.leftWrist])),
    rightArm: roundConfidence(average([joints.rightShoulder, joints.rightElbow, joints.rightWrist])),
    leftLeg: roundConfidence(average([joints.leftHip, joints.leftKnee, joints.leftAnkle])),
    rightLeg: roundConfidence(average([joints.rightHip, joints.rightKnee, joints.rightAnkle])),
  };
  const jointValues = Object.values(joints);
  const overall = roundConfidence(average(jointValues));
  const coverage = roundConfidence(jointValues.filter((value) => value >= 0.5).length / jointValues.length);
  const lowConfidenceGroups = (Object.keys(groups) as (keyof typeof groups)[])
    .filter((group) => groups[group] < 0.5);
  const quality = overall >= 0.75 && coverage >= 0.85
    ? "high"
    : overall >= 0.5 && coverage >= 0.6
      ? "medium"
      : "low";
  return { overall, coverage, quality, groups, joints, lowConfidenceGroups };
}

/**
 * Validates and copies the MediaPipe boundary result before solving it into VRM-local rotations.
 * A photo scan is intentionally single-person; ambiguous multi-person payloads fail closed.
 */
export function createStudioVrmPhotoPoseInferenceResult(
  generationId: number,
  rawResult: unknown,
  options: { readonly mirror?: boolean; readonly minimumVisibility?: number } = {},
): StudioVrmPhotoPoseInferenceResult {
  if (!Number.isSafeInteger(generationId) || generationId < 1 || !isRecord(rawResult)) {
    throw new StudioVrmPhotoPoseError("protocol");
  }
  if (!Array.isArray(rawResult.landmarks) || !Array.isArray(rawResult.worldLandmarks)) {
    throw new StudioVrmPhotoPoseError("protocol");
  }
  if (rawResult.landmarks.length === 0 && rawResult.worldLandmarks.length === 0) {
    throw new StudioVrmPhotoPoseError("no-pose");
  }
  if (rawResult.landmarks.length !== 1 || rawResult.worldLandmarks.length !== 1) {
    throw new StudioVrmPhotoPoseError("protocol");
  }
  const normalizedLandmarks = validatedLandmarkArray(rawResult.landmarks[0], true);
  const worldLandmarks = validatedLandmarkArray(rawResult.worldLandmarks[0], false);
  if (!normalizedLandmarks || !worldLandmarks) throw new StudioVrmPhotoPoseError("protocol");
  const minimumVisibility = options.minimumVisibility ?? 0.35;
  if (!Number.isFinite(minimumVisibility) || minimumVisibility < 0 || minimumVisibility > 1) {
    throw new StudioVrmPhotoPoseError("invalid-options");
  }
  const confidence = summarizeStudioVrmPhotoPoseConfidence(normalizedLandmarks);
  const bones = solvePoseToVrmBones(worldLandmarks, {
    mirror: options.mirror ?? false,
    minVisibility: minimumVisibility,
  });
  return {
    version: STUDIO_VRM_PHOTO_POSE_PROTOCOL_VERSION,
    generationId,
    normalizedLandmarks,
    worldLandmarks,
    bones,
    confidence,
  };
}
