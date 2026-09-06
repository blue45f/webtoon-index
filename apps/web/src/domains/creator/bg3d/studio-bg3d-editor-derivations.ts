/**
 * Pure module-scope helpers, formatters, and lazily-loaded runtime accessors extracted from
 * `StudioBackground3D.tsx`. Nothing here reads component state — every entry is either a pure
 * function of its arguments or a module-level lazy loader that the editor and its extracted
 * action modules share.
 */

import * as THREE from "three";

import {
  cloneBgCustomModelInstances,
  type BgCustomModelInstance,
} from "../studio-background-3d-model";
import {
  clonePrimitives,
  type BgPrimitive,
} from "../studio-background-3d-primitives";

import {
  resolveStudioBg3dDeviceQuality,
  type StudioBg3dDeviceSignals,
  type StudioBg3dResolvedDeviceQuality,
} from "./studio-bg3d-device-quality";
import {
  STUDIO_BG3D_LT_BUILT_IN_PRESETS,
  STUDIO_BG3D_LT_PRESET_MAX_COUNT,
  type StudioBg3dLtPreset,
  type StudioBg3dLtPresetPayload,
} from "./studio-bg3d-lt-presets";
import {
  migrateStudioBg3dSceneDocument,
  parseStudioBg3dSceneDocument,
  serializeStudioBg3dSceneDocument,
  type StudioBg3dCameraSettings,
  type StudioBg3dLineOutputSettings,
  type StudioBg3dQuaternion,
  type StudioBg3dSceneDocument,
  type StudioBg3dToneOutputSettings,
} from "./studio-bg3d-scene-document";

import type { StudioBg3dLtUserPresetMutationFailureReason } from "./studio-bg3d-lt-preset-library";
import type { StudioBg3dPhysicsPhase } from "./studio-bg3d-physics-ui";
import type { CSSProperties } from "react";

export const SHARED_CHARACTER_CAPTURE_AUTHORITY_ERROR_MESSAGE =
  "연결된 3D 캐릭터의 모델·의상·소품이 같은 캡처 프레임에서 완전히 준비됐는지 확인할 수 없어 출력을 중단했어요. 준비 표시를 확인한 뒤 다시 시도해 주세요.";

/* ── 헬퍼: 라디안 ↔ 도(deg) 변환. 상태 자체는 항상 라디안(BgPrimitive 계약)으로 두고
   숫자 패널 경계에서만 변환한다 — three.js 회전 API와의 단위 불일치를 막기 위함. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

const DEFAULT_CAMERA_POSITION: [number, number, number] = [4, 3, 6];
export const DEFAULT_CAMERA_TARGET: [number, number, number] = [0, 0.6, 0];

export const CAMERA_PRESETS: Record<string, { label: string; position: [number, number, number]; target: [number, number, number] }> = {
  default: { label: "기본", position: DEFAULT_CAMERA_POSITION, target: DEFAULT_CAMERA_TARGET },
  front: { label: "정면", position: [0, 1.6, 9], target: [0, 0.9, 0] },
  top: { label: "위에서", position: [0, 10, 0.001], target: [0, 0, 0] },
  side: { label: "측면", position: [9, 1.6, 0], target: [0, 0.9, 0] },
};

export function formatBg3dSunTime(hours: number): string {
  const safe = Number.isFinite(hours) ? ((hours % 24) + 24) % 24 : 12;
  let wholeHours = Math.floor(safe);
  let minutes = Math.round((safe - wholeHours) * 60);
  if (minutes === 60) {
    wholeHours = (wholeHours + 1) % 24;
    minutes = 0;
  }
  return `${String(wholeHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function waitForStudioBg3dPaintFrame(): Promise<void> {
  return new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
}

export async function acquireStudioBg3dCaptureAdapterAfterViewTransition(
  ...args: Parameters<StudioBg3dThreeWebglCaptureRuntime["acquireStudioBg3dCaptureAdapterAfterViewTransition"]>
) {
  const runtime = await loadStudioBg3dThreeWebglCaptureRuntime();
  return runtime.acquireStudioBg3dCaptureAdapterAfterViewTransition(...args);
}

export async function captureStudioBg3dRaster(
  ...args: Parameters<StudioBg3dThreeWebglCaptureRuntime["captureStudioBg3dRaster"]>
) {
  const runtime = await loadStudioBg3dThreeWebglCaptureRuntime();
  return runtime.captureStudioBg3dRaster(...args);
}

export async function getStudioBg3dCaptureSourceSize(
  ...args: Parameters<StudioBg3dThreeWebglCaptureRuntime["getStudioBg3dCaptureSourceSize"]>
) {
  const runtime = await loadStudioBg3dThreeWebglCaptureRuntime();
  return runtime.getStudioBg3dCaptureSourceSize(...args);
}

type StudioBg3dThreeWebglCaptureRuntime = Pick<
  typeof import("./studio-bg3d-three-webgl-capture"),
  | "acquireStudioBg3dCaptureAdapterAfterViewTransition"
  | "captureStudioBg3dRaster"
  | "createStudioBg3dThreeWebglCaptureAdapter"
  | "getStudioBg3dCaptureSourceSize"
>;

let studioBg3dThreeWebglCaptureRuntimePromise:
  Promise<StudioBg3dThreeWebglCaptureRuntime> | null = null;

export function loadStudioBg3dThreeWebglCaptureRuntime(): Promise<StudioBg3dThreeWebglCaptureRuntime> {
  const existing = studioBg3dThreeWebglCaptureRuntimePromise;
  if (existing) return existing;
  const pending = import("./studio-bg3d-three-webgl-capture").then((module) => Object.freeze({
    acquireStudioBg3dCaptureAdapterAfterViewTransition:
      module.acquireStudioBg3dCaptureAdapterAfterViewTransition,
    captureStudioBg3dRaster: module.captureStudioBg3dRaster,
    createStudioBg3dThreeWebglCaptureAdapter:
      module.createStudioBg3dThreeWebglCaptureAdapter,
    getStudioBg3dCaptureSourceSize: module.getStudioBg3dCaptureSourceSize,
  }));
  studioBg3dThreeWebglCaptureRuntimePromise = pending;
  void pending.catch(() => {
    if (studioBg3dThreeWebglCaptureRuntimePromise === pending) {
      studioBg3dThreeWebglCaptureRuntimePromise = null;
    }
  });
  return pending;
}

export interface StudioBg3dHistorySnapshot {
  readonly primitives: BgPrimitive[];
  readonly customModels: BgCustomModelInstance[];
  readonly document: StudioBg3dSceneDocument;
}

export function describeStudioBg3dPhysicsStatus(
  phase: StudioBg3dPhysicsPhase,
  errorMessage: string | null,
): string {
  switch (phase) {
    case "idle":
      return "물리 미리보기를 시작할 준비가 되었습니다.";
    case "loading":
      return "물리 미리보기 계산을 시작했습니다.";
    case "running":
      return "물리 미리보기 재생을 시작했습니다.";
    case "paused":
      return "물리 미리보기를 일시정지했습니다.";
    case "complete":
      return "물리 미리보기 재생이 완료되었습니다. 다시 재생하거나 현재 자세를 적용할 수 있습니다.";
    case "baking":
      return "현재 물리 자세를 장면에 적용하고 있습니다.";
    case "error":
      return errorMessage ?? "물리 미리보기를 계속할 수 없습니다.";
  }
}

export function createStudioBg3dHistorySnapshot(input: {
  readonly primitives: readonly BgPrimitive[];
  readonly customModels: readonly BgCustomModelInstance[];
  readonly document: StudioBg3dSceneDocument;
}): StudioBg3dHistorySnapshot {
  return {
    primitives: clonePrimitives([...input.primitives]),
    customModels: cloneBgCustomModelInstances([...input.customModels]),
    document: input.document,
  };
}

let fallbackLtUserPresetIdSequence = 0;

function fallbackLtUserPresetToken(): string {
  fallbackLtUserPresetIdSequence += 1;
  const randomWords = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0x1_0000_0000).toString(16).padStart(8, "0")
  ).join("");
  return `fallback-${randomWords}-${fallbackLtUserPresetIdSequence.toString(36)}`;
}

/** Generates a collision-checked stable id via Web Crypto or random words plus a sequence. */
export function generateLtUserPresetId(payload: StudioBg3dLtPresetPayload): string | null {
  const occupied = new Set([
    ...STUDIO_BG3D_LT_BUILT_IN_PRESETS.map((preset) => preset.id),
    ...payload.presets.map((preset) => preset.id),
  ]);
  for (let attempt = 0; attempt < 128; attempt += 1) {
    let token: string | null = null;
    try {
      const cryptoApi = globalThis.crypto;
      if (typeof cryptoApi?.randomUUID === "function") {
        token = cryptoApi.randomUUID();
      } else if (typeof cryptoApi?.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      }
    } catch {
      token = null;
    }
    const id = `user.${token ?? fallbackLtUserPresetToken()}`;
    if (id.length <= 80 && !occupied.has(id)) return id;
  }
  return null;
}

export function ltUserPresetFailureMessage(
  reason: StudioBg3dLtUserPresetMutationFailureReason
): string {
  switch (reason) {
    case "built-in-id":
      return "기본 프리셋과 같은 ID는 사용할 수 없습니다.";
    case "duplicate-id":
      return "같은 사용자 프리셋 ID가 이미 있습니다.";
    case "max-count":
      return `사용자 프리셋은 최대 ${STUDIO_BG3D_LT_PRESET_MAX_COUNT}개까지 저장할 수 있습니다.`;
    case "not-found":
      return "선택한 사용자 프리셋을 찾을 수 없습니다. 목록을 다시 열어 주세요.";
    case "invalid-name":
      return "이름은 앞뒤 공백이나 제어 문자 없이 입력해 주세요.";
    case "invalid-payload":
      return "프리셋 라이브러리 상태가 올바르지 않아 저장하지 않았습니다.";
    case "invalid-preset":
      return "이름·설명과 현재 LT 설정을 확인해 주세요.";
    case "serialization-failed":
      return "프리셋을 안전한 저장 형식으로 만들지 못했습니다.";
  }
}

export function studioBg3dMagicCaptureCompatibilityMessage(
  document: StudioBg3dSceneDocument,
): string | null {
  const lensShift = document.camera.lensShift;
  if (document.camera.projection === "orthographic") {
    return "첫 단계의 매직 마스크는 원근 카메라에서만 지원해요.";
  }
  if (lensShift && (lensShift[0] !== 0 || lensShift[1] !== 0)) {
    return "렌즈 시프트를 0으로 되돌린 뒤 매직 마스크를 다시 만들어 주세요.";
  }
  if (
    document.background.mode === "sky-preset" &&
    document.background.skyPresetId !== "blank"
  ) {
    return "첫 단계에서는 단색·투명·빈 하늘 배경에서만 매직 마스크를 만들 수 있어요.";
  }
  if (document.output.tone.mode === "none" || document.output.tone.opacity <= 0) {
    return "매직 마스크를 붙일 컬러 또는 톤 베이스 출력을 먼저 켜 주세요.";
  }
  return null;
}

export function ltOutputFingerprint(
  line: StudioBg3dLineOutputSettings,
  tone: StudioBg3dToneOutputSettings
): string {
  return JSON.stringify([line, tone]);
}

export function matchingLtPreset(
  line: StudioBg3dLineOutputSettings,
  tone: StudioBg3dToneOutputSettings,
  userPayload: StudioBg3dLtPresetPayload,
  preferredId: string | null
): StudioBg3dLtPreset | null {
  const fingerprint = ltOutputFingerprint(line, tone);
  const matches = (preset: StudioBg3dLtPreset) =>
    ltOutputFingerprint(preset.line, preset.tone) === fingerprint;
  if (preferredId) {
    const preferred = STUDIO_BG3D_LT_BUILT_IN_PRESETS.find((preset) => preset.id === preferredId)
      ?? userPayload.presets.find((preset) => preset.id === preferredId);
    if (preferred && matches(preferred)) return preferred;
  }
  return STUDIO_BG3D_LT_BUILT_IN_PRESETS.find(matches)
    ?? userPayload.presets.find(matches)
    ?? null;
}

export function ltTonePreviewStyle(tone: StudioBg3dToneOutputSettings): CSSProperties {
  if (tone.mode === "none") {
    return { backgroundColor: "var(--color-card)", opacity: 0.45 };
  }

  const spacing = Math.max(4, Math.min(18, Math.round(360 / tone.frequency)));
  const angle = `${tone.angleDegrees}deg`;
  const base: CSSProperties = {
    backgroundColor: "var(--color-card)",
    color: "var(--color-fg-2)",
    opacity: tone.opacity,
  };
  if (tone.type === "color") {
    return {
      ...base,
      backgroundColor: "var(--color-card)",
      backgroundImage:
        "linear-gradient(135deg, var(--color-accent-soft), var(--color-cool))",
    };
  }
  if (tone.type === "grayscale" && tone.mode !== "screentone") {
    const stop = Math.round(100 / Math.max(2, tone.levels));
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(${angle}, currentColor 0 ${stop}%, transparent ${stop}% ${stop * 2}%)`,
    };
  }
  if (tone.pattern === "line") {
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(${angle}, currentColor 0 1px, transparent 1px ${spacing}px)`,
    };
  }
  if (tone.pattern === "crosshatch") {
    return {
      ...base,
      backgroundImage: `repeating-linear-gradient(${angle}, currentColor 0 1px, transparent 1px ${spacing}px), repeating-linear-gradient(${tone.angleDegrees + 90}deg, currentColor 0 1px, transparent 1px ${spacing}px)`,
    };
  }
  if (tone.pattern === "noise") {
    return {
      ...base,
      backgroundImage: "radial-gradient(circle at 25% 30%, currentColor 0 1px, transparent 1.5px), radial-gradient(circle at 70% 68%, currentColor 0 1px, transparent 1.5px)",
      backgroundSize: `${spacing}px ${spacing}px, ${spacing + 3}px ${spacing + 3}px`,
    };
  }
  return {
    ...base,
    backgroundImage: "radial-gradient(circle, currentColor 0 1px, transparent 1.5px)",
    backgroundSize: `${spacing}px ${spacing}px`,
  };
}

export type BrowserNavigatorCapabilities = Navigator & {
  readonly connection?: {
    readonly saveData?: boolean;
    addEventListener?: (type: "change", listener: () => void) => void;
    removeEventListener?: (type: "change", listener: () => void) => void;
  };
  readonly deviceMemory?: number;
};

export function canonicalSceneDocument(raw: StudioBg3dSceneDocument | undefined): StudioBg3dSceneDocument | null {
  if (!raw) return null;
  const migrated = migrateStudioBg3dSceneDocument(raw);
  const serialized = serializeStudioBg3dSceneDocument(migrated);
  return serialized ? parseStudioBg3dSceneDocument(serialized) : null;
}

export function studioBg3dHistoryDocumentAtView(
  document: StudioBg3dSceneDocument,
  camera: StudioBg3dCameraSettings,
): StudioBg3dSceneDocument {
  return canonicalSceneDocument({ ...document, camera }) ?? document;
}

export function createStudioBg3dShotId(
  shots: StudioBg3dSceneDocument["shots"],
  now = Date.now(),
): string {
  const existingIds = new Set(shots?.map((shot) => shot.id) ?? []);
  const stamp = Math.max(0, Math.floor(now)).toString(36);
  let ordinal = (shots?.length ?? 0) + 1;
  let candidate = `shot-${stamp}-${ordinal.toString(36)}`;
  while (existingIds.has(candidate)) {
    ordinal += 1;
    candidate = `shot-${stamp}-${ordinal.toString(36)}`;
  }
  return candidate;
}

export function collectDeviceSignals(host?: HTMLElement | null): StudioBg3dDeviceSignals {
  if (typeof window === "undefined" || typeof navigator === "undefined") return {};
  const browserNavigator = navigator as BrowserNavigatorCapabilities;
  const rect = host?.getBoundingClientRect();
  let pointer: StudioBg3dDeviceSignals["pointer"] = "none";
  if (typeof window.matchMedia === "function") {
    if (window.matchMedia("(pointer: coarse)").matches) pointer = "coarse";
    else if (window.matchMedia("(pointer: fine)").matches) pointer = "fine";
  }
  return {
    cssWidth: rect && rect.width >= 1 ? rect.width : window.innerWidth,
    cssHeight: rect && rect.height >= 1 ? rect.height : window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    pointer,
    saveData: browserNavigator.connection?.saveData,
    deviceMemoryGb: browserNavigator.deviceMemory,
    hardwareConcurrency: browserNavigator.hardwareConcurrency,
  };
}

export function resolveDeviceQuality(
  document: StudioBg3dSceneDocument,
  host: HTMLElement | null,
  mode: "edit" | "capture" = "edit"
): StudioBg3dResolvedDeviceQuality {
  return resolveStudioBg3dDeviceQuality({
    document,
    mode,
    signals: collectDeviceSignals(host),
  });
}

export function quaternionToEulerDegrees(rotation: StudioBg3dQuaternion): [number, number, number] {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(...rotation),
    "XYZ",
  );
  return [radToDeg(euler.x), radToDeg(euler.y), radToDeg(euler.z)];
}
export function eulerDegreesToQuaternion(rotation: readonly [number, number, number]): StudioBg3dQuaternion {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    degToRad(rotation[0]),
    degToRad(rotation[1]),
    degToRad(rotation[2]),
    "XYZ",
  )).normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
}
