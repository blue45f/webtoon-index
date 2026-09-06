/**
 * Explicit, fail-closed engine admission for the Studio 3D background editor.
 *
 * The editor ships independent Three/WebGPU and Three/WebGL2 renderers. This module never changes
 * the artist's selection: capability, feature, topology, or runtime failures keep that backend
 * selected and make it unavailable. A WebGL2 renderer can therefore mount only after an explicit
 * WebGL2 choice, never as a hidden fallback for WebGPU.
 */

import {
  planStudioBg3dRuntimeTopology,
  type StudioBg3dRuntimeCapability,
  type StudioBg3dRuntimeId,
} from "./studio-bg3d-runtime-topology";

import type { StudioBg3dDeviceProfile } from "./studio-bg3d-device-quality";
import type { StudioBg3dInAppBrowserProfile } from "./studio-bg3d-inapp-browser";
import type { StudioBg3dWebGpuProbeResult } from "./studio-bg3d-webgpu-capability";

export type StudioBg3dEngineBackend = "webgl2" | "webgpu";
export type StudioBg3dEnginePreference = StudioBg3dEngineBackend;
export type StudioBg3dEngineStatus = "available" | "unavailable" | "failed";

export type StudioBg3dEngineSelectionReason =
  | "user-webgpu-override"
  | "user-webgl2-override"
  | "webgpu-runtime-unavailable"
  | "webgpu-runtime-failed"
  | "webgpu-probe-unsupported"
  | "webgpu-compute-unavailable"
  | "inapp-browser-blocked"
  | "inapp-browser-opt-in-required"
  | "save-data-enabled"
  | "low-device-memory"
  | "runtime-capability-unavailable"
  | "webgl-only-webxr"
  | "webgl-only-vrm-character";

/** Advisory threshold only. Low memory never changes an explicit engine choice. */
export const STUDIO_BG3D_WEBGPU_MIN_DEVICE_MEMORY_GB = 4;

/**
 * Features the WebGPU renderer cannot serve with product parity today.
 *
 * These observations do not force WebGL2. If WebGPU is selected, the plan becomes unavailable and
 * the artist is told to choose WebGL2 manually. Latching avoids repeatedly changing availability
 * while a feature is entered and left during the same editor session.
 */
export interface StudioBg3dEngineWebglOnlyFeatures {
  readonly webxr: boolean;
  readonly vrmCharacters: boolean;
}

export const EMPTY_STUDIO_BG3D_ENGINE_WEBGL_ONLY_FEATURES: StudioBg3dEngineWebglOnlyFeatures =
  Object.freeze({ webxr: false, vrmCharacters: false });

export function latchStudioBg3dWebglOnlyFeatures(
  current: StudioBg3dEngineWebglOnlyFeatures,
  observed: Partial<StudioBg3dEngineWebglOnlyFeatures>,
): StudioBg3dEngineWebglOnlyFeatures {
  const next = {
    webxr: current.webxr || observed.webxr === true,
    vrmCharacters: current.vrmCharacters || observed.vrmCharacters === true,
  };
  return next.webxr === current.webxr && next.vrmCharacters === current.vrmCharacters
    ? current
    : Object.freeze(next);
}

export interface StudioBg3dEngineSelectionRequest {
  readonly preference: StudioBg3dEnginePreference;
  readonly probe: StudioBg3dWebGpuProbeResult;
  readonly inApp: StudioBg3dInAppBrowserProfile;
  readonly deviceProfile: StudioBg3dDeviceProfile;
  /** True when the build actually emits the lazily loaded WebGPU renderer chunk. */
  readonly webgpuRuntimeAvailable: boolean;
  readonly saveData?: boolean;
  readonly deviceMemoryGb?: number;
  /** True after initialization or device loss fails the current explicit WebGPU selection. */
  readonly webgpuRuntimeFailed?: boolean;
  readonly webglOnlyFeatures?: StudioBg3dEngineWebglOnlyFeatures;
}

export interface StudioBg3dEngineSelectionPlan {
  /** The artist's normalized explicit selection. This never changes as a recovery action. */
  readonly backend: StudioBg3dEngineBackend;
  readonly runtimeId: StudioBg3dRuntimeId;
  /** Whether the selected backend may currently own the interactive canvas. */
  readonly status: StudioBg3dEngineStatus;
  readonly reason: StudioBg3dEngineSelectionReason;
  /** Korean, user-facing explanation for the engine status surface. */
  readonly notice: string;
  /** Secondary observations worth surfacing in diagnostics; never another renderer candidate. */
  readonly diagnostics: readonly StudioBg3dEngineSelectionReason[];
}

const BACKEND_RUNTIME_IDS: Readonly<Record<StudioBg3dEngineBackend, StudioBg3dRuntimeId>> =
  Object.freeze({
    webgl2: "three-webgl",
    webgpu: "three-webgpu",
  });

export const STUDIO_BG3D_ENGINE_SELECTION_NOTICES:
  Readonly<Record<StudioBg3dEngineSelectionReason, string>> = Object.freeze({
  "user-webgpu-override": "직접 선택한 WebGPU 엔진으로 실행 중입니다.",
  "user-webgl2-override": "직접 선택한 WebGL2 엔진으로 실행 중입니다.",
  "webgpu-runtime-unavailable":
    "이 빌드에서는 WebGPU를 사용할 수 없습니다. WebGL2를 쓰려면 직접 선택해 주세요.",
  "webgpu-runtime-failed":
    "WebGPU 엔진을 시작하지 못했습니다. 다시 선택하거나 WebGL2를 직접 선택해 주세요.",
  "webgpu-probe-unsupported":
    "WebGPU 지원 여부를 확인하지 못했습니다. 편집기를 다시 열거나 WebGL2를 직접 선택해 주세요.",
  "webgpu-compute-unavailable":
    "필요한 WebGPU 기능을 사용할 수 없습니다. WebGL2를 직접 선택해 주세요.",
  "inapp-browser-blocked":
    "이 인앱 브라우저에서는 WebGPU를 사용할 수 없습니다. WebGL2를 직접 선택해 주세요.",
  "inapp-browser-opt-in-required": "인앱 브라우저의 WebGPU 안정성이 제한될 수 있습니다.",
  "save-data-enabled": "데이터 절약 모드에서는 WebGPU 시작 비용이 커질 수 있습니다.",
  "low-device-memory": "기기 메모리가 적어 WebGPU 성능이 제한될 수 있습니다.",
  "runtime-capability-unavailable":
    "선택한 엔진에 필수 기능이 없습니다. 다른 엔진을 직접 선택해 주세요.",
  "webgl-only-webxr":
    "WebXR은 WebGPU에서 열 수 없습니다. WebGL2를 직접 선택해 주세요.",
  "webgl-only-vrm-character":
    "3D 캐릭터 색을 유지하려면 WebGL2 엔진을 직접 선택해 주세요.",
});

/** A timed-out/cancelled probe is not proof that this browser does not implement WebGPU. */
function describeProbeFailure(probe: StudioBg3dWebGpuProbeResult | undefined): string {
  switch (probe?.reason) {
    case "insecure-context":
      return "WebGPU는 보안 연결(HTTPS)에서만 사용할 수 있습니다. 보안 연결로 다시 열어 주세요.";
    case "api-unavailable":
      return "이 브라우저에서 WebGPU API를 사용할 수 없습니다. WebGL2를 직접 선택해 주세요.";
    case "adapter-unavailable":
      return "사용 가능한 WebGPU 어댑터를 찾지 못했습니다. 브라우저의 그래픽 가속 설정을 확인해 주세요.";
    case "insufficient-limits":
      return "WebGPU 어댑터의 메모리 한도가 부족합니다. WebGL2를 직접 선택해 주세요.";
    case "timeout":
      return "WebGPU 응답 확인이 지연됐습니다. 미지원으로 확정된 것은 아니며, 편집기를 다시 열어 확인해 주세요.";
    case "aborted":
      return "WebGPU 지원 확인이 중단됐습니다. 편집기를 다시 열어 확인해 주세요.";
    default:
      return STUDIO_BG3D_ENGINE_SELECTION_NOTICES["webgpu-probe-unsupported"];
  }
}

export const STUDIO_BG3D_ENGINE_PREFERENCES: readonly StudioBg3dEnginePreference[] = Object.freeze([
  "webgpu",
  "webgl2",
]);

export const STUDIO_BG3D_ENGINE_PREFERENCE_LABELS: Readonly<
  Record<StudioBg3dEnginePreference, string>
> = Object.freeze({
  webgpu: "WebGPU",
  webgl2: "WebGL2",
});

/** Legacy `auto` and unknown persisted values migrate to the explicit WebGPU choice. */
export function normalizeStudioBg3dEnginePreference(value: unknown): StudioBg3dEnginePreference {
  return STUDIO_BG3D_ENGINE_PREFERENCES.includes(value as StudioBg3dEnginePreference)
    ? (value as StudioBg3dEnginePreference)
    : "webgpu";
}

function plan(
  backend: StudioBg3dEngineBackend,
  reason: StudioBg3dEngineSelectionReason,
  status: StudioBg3dEngineStatus,
  diagnostics: readonly StudioBg3dEngineSelectionReason[],
  notice = STUDIO_BG3D_ENGINE_SELECTION_NOTICES[reason],
): StudioBg3dEngineSelectionPlan {
  return Object.freeze({
    backend,
    runtimeId: BACKEND_RUNTIME_IDS[backend],
    status,
    reason,
    notice,
    diagnostics: Object.freeze([...new Set(diagnostics)]),
  });
}

function collectWebGpuBlocks(
  request: StudioBg3dEngineSelectionRequest,
): readonly StudioBg3dEngineSelectionReason[] {
  const blocks: StudioBg3dEngineSelectionReason[] = [];
  if (request.webgpuRuntimeFailed === true) blocks.push("webgpu-runtime-failed");
  if (!request.webgpuRuntimeAvailable) blocks.push("webgpu-runtime-unavailable");
  if (!request.probe?.supported) blocks.push("webgpu-probe-unsupported");
  else if (!request.probe.computeSupported) blocks.push("webgpu-compute-unavailable");
  if (request.inApp?.gpuTrust === "blocked") blocks.push("inapp-browser-blocked");
  if (request.webglOnlyFeatures?.webxr === true) blocks.push("webgl-only-webxr");
  if (request.webglOnlyFeatures?.vrmCharacters === true) {
    blocks.push("webgl-only-vrm-character");
  }
  return blocks;
}

function collectAdvisories(
  request: StudioBg3dEngineSelectionRequest,
): readonly StudioBg3dEngineSelectionReason[] {
  const advisories: StudioBg3dEngineSelectionReason[] = [];
  if (request.inApp?.gpuTrust === "opt-in") advisories.push("inapp-browser-opt-in-required");
  if (request.saveData === true) advisories.push("save-data-enabled");
  const memory = request.deviceMemoryGb;
  if (
    request.deviceProfile === "mobile" &&
    Number.isFinite(memory) &&
    (memory ?? 0) < STUDIO_BG3D_WEBGPU_MIN_DEVICE_MEMORY_GB
  ) {
    advisories.push("low-device-memory");
  }
  return advisories;
}

/** Resolves an explicit selection without ever substituting another backend. */
export function selectStudioBg3dEngine(
  request: StudioBg3dEngineSelectionRequest,
): StudioBg3dEngineSelectionPlan {
  if (!request || typeof request !== "object") {
    return plan("webgpu", "webgpu-probe-unsupported", "unavailable", [
      "webgpu-probe-unsupported",
    ]);
  }
  const preference = normalizeStudioBg3dEnginePreference(request.preference);
  const hardBlocks = collectWebGpuBlocks(request);
  const advisories = collectAdvisories(request);

  if (preference === "webgl2") {
    return plan("webgl2", "user-webgl2-override", "available", [
      ...hardBlocks,
      ...advisories,
    ]);
  }
  if (hardBlocks.length > 0) {
    const reason = hardBlocks[0]!;
    return plan(
      "webgpu",
      reason,
      hardBlocks.includes("webgpu-runtime-failed") ? "failed" : "unavailable",
      [...hardBlocks, ...advisories],
      reason === "webgpu-probe-unsupported" ? describeProbeFailure(request.probe) : undefined,
    );
  }
  return plan("webgpu", "user-webgpu-override", "available", advisories);
}

/** Capabilities required before an interactive editor canvas may mount. */
export const STUDIO_BG3D_EDITOR_REQUIRED_CAPABILITIES: readonly StudioBg3dRuntimeCapability[] =
  Object.freeze(["interactive-editing", "capture-rgba-depth"]);

/** Headroom for the largest single production runtime (`three-webgpu`, 210,000 gzip bytes). */
export const STUDIO_BG3D_EDITOR_ACTIVATION_BUDGET_GZIP_BYTES = 260_000;

const PRODUCTION_RUNTIME_IDS: readonly StudioBg3dRuntimeId[] = Object.freeze([
  "three-webgl",
  "three-webgpu",
]);

/** Confirms the selected runtime against topology without accepting a different primary runtime. */
export function resolveStudioBg3dEngineRuntime(
  request: StudioBg3dEngineSelectionRequest,
): StudioBg3dEngineSelectionPlan {
  const selected = selectStudioBg3dEngine(request);
  if (selected.status !== "available") return selected;

  const topology = planStudioBg3dRuntimeTopology({
    availableRuntimeIds: PRODUCTION_RUNTIME_IDS,
    primaryCapabilities: STUDIO_BG3D_EDITOR_REQUIRED_CAPABILITIES,
    allowLabRuntimes: false,
    webgpuSupported: request.probe?.supported === true,
    maximumActivationGzipBytes: STUDIO_BG3D_EDITOR_ACTIVATION_BUDGET_GZIP_BYTES,
    preferredPrimaryRuntimeId: selected.runtimeId,
  });
  if (topology.ok && topology.primaryRuntimeId === selected.runtimeId) return selected;

  return plan(selected.backend, "runtime-capability-unavailable", "unavailable", [
    ...selected.diagnostics,
    "runtime-capability-unavailable",
  ]);
}
