/**
 * Versioned line-and-tone (LT) presets for the engine-neutral Studio 3D scene document.
 *
 * This module deliberately delegates line/tone value validation to the canonical scene
 * serializer. That keeps preset persistence from drifting away from the renderer's actual scene
 * contract. Presets never own camera, lighting, model, node, quality, or budget state.
 */

import {
  DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
} from "./studio-bg3d-scene-document";

import type {
  StudioBg3dLineOutputSettings,
  StudioBg3dOutputSettings,
  StudioBg3dSceneDocument,
  StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";

export const STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND =
  "toonspectrum.bg3d-lt-presets" as const;
export const STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION = 1 as const;
export const STUDIO_BG3D_LT_PRESET_VERSION = 1 as const;
export const STUDIO_BG3D_LT_PRESET_MAX_COUNT = 32;
export const STUDIO_BG3D_LT_PRESET_MAX_BYTES = 64 * 1024;
export const STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH = 60;
export const STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH = 240;

export interface StudioBg3dLtPreset {
  readonly id: string;
  readonly version: typeof STUDIO_BG3D_LT_PRESET_VERSION;
  readonly name: string;
  readonly description: string;
  readonly line: StudioBg3dLineOutputSettings;
  readonly tone: StudioBg3dToneOutputSettings;
}

export interface StudioBg3dLtPresetPayload {
  readonly kind: typeof STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND;
  readonly version: typeof STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION;
  /** User presets only. Built-in ids are reserved and cannot be shadowed. */
  readonly presets: readonly StudioBg3dLtPreset[];
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,79}$/u;
const FORBIDDEN_KEY_SET = new Set(["__proto__", "constructor", "prototype"]);
const FORBIDDEN_ID_SET = new Set(["__proto__", "constructor", "prototype"]);
const UTF8_ENCODER = new TextEncoder();
const MAX_DECODE_DEPTH = 8;
const MAX_DECODE_NODES = 2_048;
const INVALID_JSON_VALUE = Symbol("invalid-json-value");

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { readonly [key: string]: JsonValue };

interface DecodeState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
}

function utf8ByteLength(value: string): number {
  return UTF8_ENCODER.encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Copies JSON-compatible input without invoking accessors. This prevents serializers from silently
 * dropping unsupported values and makes object input follow the same rules as parsed JSON text.
 */
function copySafeJsonValue(
  value: unknown,
  state: DecodeState,
  depth = 0
): JsonValue | typeof INVALID_JSON_VALUE {
  state.nodes += 1;
  if (state.nodes > MAX_DECODE_NODES || depth > MAX_DECODE_DEPTH) return INVALID_JSON_VALUE;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  if (typeof value !== "object") return INVALID_JSON_VALUE;

  if (state.ancestors.has(value)) return INVALID_JSON_VALUE;
  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || value.length > MAX_DECODE_NODES) {
        return INVALID_JSON_VALUE;
      }
      const keys = Reflect.ownKeys(value);
      if (
        keys.some(
          (key) =>
            typeof key !== "string" ||
            (key !== "length" &&
              (!/^(?:0|[1-9]\d*)$/u.test(key) ||
                !Number.isSafeInteger(Number(key)) ||
                Number(key) >= value.length))
        )
      ) {
        return INVALID_JSON_VALUE;
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
          return INVALID_JSON_VALUE;
        }
        const copied = copySafeJsonValue(descriptor.value, state, depth + 1);
        if (copied === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
        result.push(copied);
      }
      return result;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID_JSON_VALUE;
    const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || FORBIDDEN_KEY_SET.has(key)) return INVALID_JSON_VALUE;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
        return INVALID_JSON_VALUE;
      }
      const copied = copySafeJsonValue(descriptor.value, state, depth + 1);
      if (copied === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
      result[key] = copied;
    }
    return result;
  } catch {
    return INVALID_JSON_VALUE;
  } finally {
    state.ancestors.delete(value);
  }
}

function decodeBoundedJson(raw: unknown): unknown | null {
  let decoded: unknown = raw;
  try {
    if (typeof raw === "string") {
      if (utf8ByteLength(raw) > STUDIO_BG3D_LT_PRESET_MAX_BYTES) return null;
      decoded = JSON.parse(raw) as unknown;
    }
    const copied = copySafeJsonValue(decoded, {
      nodes: 0,
      ancestors: new WeakSet<object>(),
    });
    if (copied === INVALID_JSON_VALUE) return null;
    const serialized = JSON.stringify(copied);
    if (utf8ByteLength(serialized) > STUDIO_BG3D_LT_PRESET_MAX_BYTES) return null;
    return JSON.parse(serialized) as unknown;
  } catch {
    return null;
  }
}

function containsUnsafeTextCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function canonicalText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string" || containsUnsafeTextCharacter(value)) return null;
  const normalized = value.normalize("NFKC").trim().replace(/\s+/gu, " ");
  if (
    normalized !== value ||
    normalized.length === 0 ||
    Array.from(normalized).length > maximumLength
  ) {
    return null;
  }
  return normalized;
}

function canonicalId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !ID_PATTERN.test(value) ||
    FORBIDDEN_ID_SET.has(value.toLowerCase())
  ) {
    return null;
  }
  return value;
}

/**
 * Uses the scene document's strict persistence boundary as the single source of truth for LT
 * settings. Unknown/missing fields, non-finite values, range overflow, non-canonical colors, and
 * future enum values therefore fail exactly as they do for a persisted 3D scene.
 */
function canonicalLineAndTone(
  line: unknown,
  tone: unknown
): Pick<StudioBg3dLtPreset, "line" | "tone"> | null {
  const output: StudioBg3dOutputSettings = {
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT.output,
    line: line as StudioBg3dLineOutputSettings,
    tone: tone as StudioBg3dToneOutputSettings,
  };
  const candidate: StudioBg3dSceneDocument = {
    ...DEFAULT_STUDIO_BG3D_SCENE_DOCUMENT,
    output,
  };
  const serialized = serializeStudioBg3dSceneDocument(candidate);
  if (!serialized) return null;
  const parsed = parseStudioBg3dSceneDocument(serialized);
  if (!parsed) return null;
  return { line: parsed.output.line, tone: parsed.output.tone };
}

function canonicalPreset(raw: unknown): StudioBg3dLtPreset | null {
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, ["id", "version", "name", "description", "line", "tone"]) ||
    raw.version !== STUDIO_BG3D_LT_PRESET_VERSION
  ) {
    return null;
  }
  const id = canonicalId(raw.id);
  const name = canonicalText(raw.name, STUDIO_BG3D_LT_PRESET_MAX_NAME_LENGTH);
  const description = canonicalText(
    raw.description,
    STUDIO_BG3D_LT_PRESET_MAX_DESCRIPTION_LENGTH
  );
  const output = canonicalLineAndTone(raw.line, raw.tone);
  if (!id || !name || !description || !output) return null;
  return deepFreeze({
    id,
    version: STUDIO_BG3D_LT_PRESET_VERSION,
    name,
    description,
    line: output.line,
    tone: output.tone,
  });
}

const BUILT_IN_PRESET_INPUTS = [
  {
    id: "storyboard-background",
    version: 1,
    name: "배경 콘티",
    description: "형태와 원근을 빠르게 읽는 콘티용 굵은 외곽선과 옅은 명암입니다.",
    line: {
      enabled: true,
      layerType: "raster",
      color: "#1f2937",
      widthPx: 2.4,
      strength: 0.55,
      accuracy: 0.45,
      scaleAwareAccuracy: true,
      exteriorOutlineStrength: 1.25,
      depthEnabled: false,
      depthStrength: 0.35,
      depthOutlineOnly: true,
      smoothing: 0.2,
      textureLineEnabled: false,
      textureLineStrength: 0,
      creaseAngleDegrees: 35,
      hiddenLineRemoval: true,
    },
    tone: {
      mode: "flat",
      type: "grayscale",
      pattern: "dot",
      levels: 3,
      opacity: 0.35,
      frequency: 48,
      angleDegrees: 45,
    },
  },
  {
    id: "clean-architecture-lineart",
    version: 1,
    name: "깔끔한 건축 선화",
    description: "직선 구조와 모서리를 또렷하게 살리는 정밀 래스터 선화 설정입니다.",
    line: {
      enabled: true,
      layerType: "raster",
      color: "#000000",
      widthPx: 0.8,
      strength: 0.95,
      accuracy: 0.98,
      scaleAwareAccuracy: true,
      exteriorOutlineStrength: 1.2,
      depthEnabled: true,
      depthStrength: 0.4,
      depthOutlineOnly: true,
      smoothing: 0.75,
      textureLineEnabled: true,
      textureLineStrength: 0.35,
      creaseAngleDegrees: 15,
      hiddenLineRemoval: true,
    },
    tone: {
      mode: "none",
      type: "grayscale",
      pattern: "dot",
      levels: 4,
      opacity: 1,
      frequency: 60,
      angleDegrees: 45,
    },
  },
  {
    id: "monochrome-manga",
    version: 1,
    name: "흑백 만화",
    description: "강한 윤곽과 도트 스크린톤으로 인쇄 만화풍 명암을 만드는 설정입니다.",
    line: {
      enabled: true,
      layerType: "raster",
      color: "#000000",
      widthPx: 1.1,
      strength: 1,
      accuracy: 0.9,
      scaleAwareAccuracy: true,
      exteriorOutlineStrength: 1.25,
      depthEnabled: true,
      depthStrength: 0.65,
      depthOutlineOnly: false,
      smoothing: 0.55,
      textureLineEnabled: true,
      textureLineStrength: 0.7,
      creaseAngleDegrees: 22,
      hiddenLineRemoval: true,
    },
    tone: {
      mode: "screentone",
      type: "pattern",
      pattern: "dot",
      levels: 4,
      opacity: 0.9,
      frequency: 70,
      angleDegrees: 45,
    },
  },
  {
    id: "rough-pen",
    version: 1,
    name: "거친 펜",
    description: "재질선과 낮은 스무딩을 살려 손으로 그린 듯한 배경 펜선을 만듭니다.",
    line: {
      enabled: true,
      layerType: "raster",
      color: "#111111",
      widthPx: 1.8,
      strength: 0.85,
      accuracy: 0.65,
      scaleAwareAccuracy: true,
      exteriorOutlineStrength: 1.4,
      depthEnabled: true,
      depthStrength: 0.35,
      depthOutlineOnly: false,
      smoothing: 0.1,
      textureLineEnabled: true,
      textureLineStrength: 1,
      creaseAngleDegrees: 28,
      hiddenLineRemoval: true,
    },
    tone: {
      mode: "flat",
      type: "grayscale",
      pattern: "noise",
      levels: 3,
      opacity: 0.65,
      frequency: 36,
      angleDegrees: 0,
    },
  },
  {
    id: "color-webtoon-underdrawing",
    version: 1,
    name: "컬러 웹툰 배경",
    description: "3D 재질색과 조명을 보존하고 얇은 청회색 선을 더하는 컬러 배경 설정입니다.",
    line: {
      enabled: true,
      layerType: "raster",
      color: "#334155",
      widthPx: 0.75,
      strength: 0.55,
      accuracy: 0.8,
      scaleAwareAccuracy: true,
      exteriorOutlineStrength: 0.75,
      depthEnabled: true,
      depthStrength: 0.2,
      depthOutlineOnly: true,
      smoothing: 0.7,
      textureLineEnabled: true,
      textureLineStrength: 0.25,
      creaseAngleDegrees: 24,
      hiddenLineRemoval: true,
    },
    tone: {
      mode: "flat",
      type: "color",
      pattern: "dot",
      levels: 4,
      opacity: 1,
      frequency: 60,
      angleDegrees: 45,
    },
  },
] as const;

function createBuiltInPresets(): readonly StudioBg3dLtPreset[] {
  const presets = BUILT_IN_PRESET_INPUTS.map(canonicalPreset);
  if (presets.some((preset) => preset === null)) {
    throw new Error("Invalid internal Studio BG3D LT preset.");
  }
  const validPresets = presets as StudioBg3dLtPreset[];
  if (new Set(validPresets.map((preset) => preset.id)).size !== validPresets.length) {
    throw new Error("Duplicate internal Studio BG3D LT preset id.");
  }
  return deepFreeze(validPresets);
}

export const STUDIO_BG3D_LT_BUILT_IN_PRESETS = createBuiltInPresets();

const BUILT_IN_PRESET_BY_ID = new Map(
  STUDIO_BG3D_LT_BUILT_IN_PRESETS.map((preset) => [preset.id, preset] as const)
);
const BUILT_IN_PRESET_ID_SET = new Set(BUILT_IN_PRESET_BY_ID.keys());

function canonicalPayload(raw: unknown): StudioBg3dLtPresetPayload | null {
  if (
    !isRecord(raw) ||
    !hasExactKeys(raw, ["kind", "version", "presets"]) ||
    raw.kind !== STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND ||
    raw.version !== STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION ||
    !Array.isArray(raw.presets) ||
    raw.presets.length > STUDIO_BG3D_LT_PRESET_MAX_COUNT
  ) {
    return null;
  }
  const presets: StudioBg3dLtPreset[] = [];
  const ids = new Set<string>();
  for (const rawPreset of raw.presets) {
    const preset = canonicalPreset(rawPreset);
    if (!preset || ids.has(preset.id) || BUILT_IN_PRESET_ID_SET.has(preset.id)) return null;
    ids.add(preset.id);
    presets.push(preset);
  }
  presets.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return deepFreeze({
    kind: STUDIO_BG3D_LT_PRESET_PAYLOAD_KIND,
    version: STUDIO_BG3D_LT_PRESET_PAYLOAD_VERSION,
    presets,
  });
}

/**
 * Parses canonical JSON written by {@link serializeStudioBg3dLtPresetPayload}. Preset order must
 * already be canonical; malformed, oversized, future-version, or lossy inputs fail closed.
 */
export function parseStudioBg3dLtPresetPayload(raw: string): StudioBg3dLtPresetPayload | null {
  const decoded = decodeBoundedJson(raw);
  if (!isRecord(decoded) || !Array.isArray(decoded.presets)) return null;
  const originalIds = decoded.presets.map((preset) =>
    isRecord(preset) && typeof preset.id === "string" ? preset.id : null
  );
  const payload = canonicalPayload(decoded);
  if (!payload || originalIds.some((id, index) => id !== payload.presets[index]?.id)) return null;
  return payload;
}

/**
 * Produces deterministic UTF-8-bounded JSON. Valid user presets are sorted by id; all other
 * normalization is forbidden, so invalid fields are rejected instead of clamped or discarded.
 */
export function serializeStudioBg3dLtPresetPayload(raw: unknown): string | null {
  const payload = canonicalPayload(decodeBoundedJson(raw));
  if (!payload) return null;
  try {
    const serialized = JSON.stringify(payload);
    return utf8ByteLength(serialized) <= STUDIO_BG3D_LT_PRESET_MAX_BYTES
      ? serialized
      : null;
  } catch {
    return null;
  }
}

/** Returns an immutable built-in or validated user preset without allowing built-in shadowing. */
export function getStudioBg3dLtPreset(
  id: string,
  userPayload?: StudioBg3dLtPresetPayload | null
): StudioBg3dLtPreset | null {
  const canonicalPresetId = canonicalId(id);
  if (!canonicalPresetId) return null;
  const builtIn = BUILT_IN_PRESET_BY_ID.get(canonicalPresetId);
  if (builtIn) return builtIn;
  if (!userPayload) return null;
  const payload = canonicalPayload(decodeBoundedJson(userPayload));
  return payload?.presets.find((preset) => preset.id === canonicalPresetId) ?? null;
}

/**
 * Applies only `output.line` and `output.tone` to an already-canonical scene. The returned scene is
 * independently strict-parsed and deeply frozen. No attachment, node, camera, lighting, render,
 * background, quality, budget, transparency, or export-size state can be introduced by a preset.
 */
export function applyStudioBg3dLtPreset(
  scene: StudioBg3dSceneDocument,
  presetOrId: StudioBg3dLtPreset | string,
  userPayload?: StudioBg3dLtPresetPayload | null
): StudioBg3dSceneDocument | null {
  const serializedScene = serializeStudioBg3dSceneDocument(scene);
  if (!serializedScene) return null;
  const canonicalScene = parseStudioBg3dSceneDocument(serializedScene);
  if (!canonicalScene) return null;

  const preset =
    typeof presetOrId === "string"
      ? getStudioBg3dLtPreset(presetOrId, userPayload)
      : canonicalPreset(decodeBoundedJson(presetOrId));
  if (!preset) return null;

  const output: StudioBg3dOutputSettings = {
    ...canonicalScene.output,
    line: preset.line,
    tone: preset.tone,
  };
  const candidate: StudioBg3dSceneDocument = {
    ...canonicalScene,
    output,
  };
  const serializedCandidate = serializeStudioBg3dSceneDocument(candidate);
  return serializedCandidate ? parseStudioBg3dSceneDocument(serializedCandidate) : null;
}
