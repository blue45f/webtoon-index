/**
 * Studio 하드웨어 등급 probe — 브라우저에서 순수 스냅샷을 만드는 얇은 어댑터.
 *
 * 이 파일도 브라우저 이름·User-Agent 를 읽지 않는다. 하는 일은 "어댑터에게 물어본 숫자를
 * 그대로 받아 적는 것" 뿐이고, 판정은 전부 studio-capability-tier / -budgets 의 순수 함수가 한다.
 *
 * 방어 규율
 * - `navigator.gpu` 가 없거나 접근이 막혀 있어도 절대 throw 하지 않는다(스냅샷으로 사유를 담는다).
 * - `requestAdapter()` 는 드라이버 초기화 때문에 매달릴 수 있어 타임아웃/abort 를 건다.
 * - `GPUSupportedLimits` 는 프로토타입 getter 라 열거되지 않는다 — 이름을 하나씩 읽는다.
 * - `GPUSupportedFeatures` 는 setlike 지만 iterable 이 없는 구현도 있어 `has()` 폴백을 둔다.
 * - navigator 유사 객체를 인자로 주입받으므로 테스트에서 전역 오염 없이 가짜를 넣을 수 있다.
 */

import {
  STUDIO_CAPABILITY_LIMIT_NAMES,
  normalizeStudioCapabilitySnapshot,
  type StudioCapabilityAdapterLimits,
  type StudioCapabilityProbeFailure,
  type StudioCapabilitySnapshot,
} from "./studio-capability-tier";

/** 등급/예산 판정에 실제로 쓰이는 WebGPU 기능. iterable 이 없는 구현에서 `has()` 로 되묻는다. */
export const STUDIO_CAPABILITY_PROBED_FEATURES = [
  "timestamp-query",
  "float32-filterable",
  "shader-f16",
] as const;

export const STUDIO_CAPABILITY_PROBE_DEFAULT_TIMEOUT_MS = 3_000;
export const STUDIO_CAPABILITY_PROBE_MIN_TIMEOUT_MS = 250;
export const STUDIO_CAPABILITY_PROBE_MAX_TIMEOUT_MS = 10_000;

export type StudioCapabilityPowerPreference = "low-power" | "high-performance";

export interface StudioCapabilityAdapterLike {
  readonly features?: unknown;
  readonly limits?: unknown;
}

export interface StudioCapabilityGpuLike {
  requestAdapter(options?: {
    readonly powerPreference?: StudioCapabilityPowerPreference;
  }): Promise<StudioCapabilityAdapterLike | null | undefined>;
}

export interface StudioCapabilityNavigatorLike {
  readonly gpu?: StudioCapabilityGpuLike | null;
  readonly hardwareConcurrency?: number;
  /** Device Memory API 힌트(GB). 노출하지 않는 브라우저가 많아 없으면 그냥 모른 채로 둔다. */
  readonly deviceMemory?: number;
}

export interface StudioCapabilityProbeInput {
  readonly navigator?: StudioCapabilityNavigatorLike | null;
  readonly crossOriginIsolated?: boolean;
  readonly sharedArrayBufferAvailable?: boolean;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly powerPreference?: StudioCapabilityPowerPreference;
}

/** 권한 정책·샌드박스에서 getter 자체가 던질 수 있는 전역 읽기를 감싼다. */
function safely<Value>(read: () => Value, fallback: Value): Value {
  try {
    return read();
  } catch {
    return fallback;
  }
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function readAdapterLimits(source: unknown): StudioCapabilityAdapterLimits {
  if (!source || typeof source !== "object") return {};
  const limits: { -readonly [Name in keyof StudioCapabilityAdapterLimits]: number } = {};
  for (const name of STUDIO_CAPABILITY_LIMIT_NAMES) {
    let raw: unknown;
    try {
      raw = (source as Record<string, unknown>)[name];
    } catch {
      // 일부 구현은 미지원 한도 getter 에서 던진다 — 그 한도만 "확인 불가"로 남긴다.
      continue;
    }
    const value = readNumber(raw);
    if (value !== null) limits[name] = value;
  }
  return limits;
}

function readAdapterFeatures(source: unknown): readonly string[] {
  if (!source || typeof source !== "object") return [];
  try {
    const iterator = (source as { [Symbol.iterator]?: unknown })[Symbol.iterator];
    if (typeof iterator === "function") {
      const collected: string[] = [];
      for (const feature of source as Iterable<unknown>) {
        if (typeof feature === "string" && feature.length > 0) collected.push(feature);
      }
      return collected;
    }
  } catch {
    // iterable 처럼 보였지만 순회에서 던지는 구현 — has() 폴백으로 내려간다.
  }
  const has = (source as { has?: unknown }).has;
  if (typeof has !== "function") return [];
  const supported: string[] = [];
  for (const name of STUDIO_CAPABILITY_PROBED_FEATURES) {
    try {
      if ((has as (feature: string) => unknown).call(source, name) === true) supported.push(name);
    } catch {
      // 알 수 없는 이름에 던지는 구현 — 그 기능은 없는 것으로 본다.
    }
  }
  return supported;
}

function clampTimeout(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return STUDIO_CAPABILITY_PROBE_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(
    STUDIO_CAPABILITY_PROBE_MAX_TIMEOUT_MS,
    Math.max(STUDIO_CAPABILITY_PROBE_MIN_TIMEOUT_MS, Math.floor(value)),
  );
}

function hostSignals(input: StudioCapabilityProbeInput) {
  const nav = input.navigator ?? null;
  return {
    crossOriginIsolated: input.crossOriginIsolated === true,
    sharedArrayBufferAvailable: input.sharedArrayBufferAvailable === true,
    hardwareConcurrency: readNumber(nav?.hardwareConcurrency),
    deviceMemoryGb: readNumber(nav?.deviceMemory),
  };
}

function failedSnapshot(
  input: StudioCapabilityProbeInput,
  webgpuAvailable: boolean,
  probeFailure: StudioCapabilityProbeFailure,
): StudioCapabilitySnapshot {
  return normalizeStudioCapabilitySnapshot({
    webgpuAvailable,
    adapterAvailable: false,
    probeFailure,
    ...hostSignals(input),
  });
}

/**
 * `navigator.gpu.requestAdapter()` 로 순수 스냅샷 하나를 만든다. 어떤 실패 경로에서도 던지지
 * 않고, 실패 사유(`probeFailure`)만 스냅샷에 남긴다 — 호출부는 항상 같은 타입을 받는다.
 */
export async function probeStudioCapabilitySnapshot(
  input: StudioCapabilityProbeInput = {},
): Promise<StudioCapabilitySnapshot> {
  if (input.signal?.aborted) return failedSnapshot(input, true, "adapter-request-aborted");

  // 권한 정책으로 접근 자체가 막힌 문서는 API 없음과 동일하게 처리한다.
  const gpu = safely<StudioCapabilityGpuLike | null>(() => input.navigator?.gpu ?? null, null);
  if (!gpu || typeof gpu.requestAdapter !== "function") {
    return failedSnapshot(input, false, "webgpu-api-unavailable");
  }

  const timeoutMs = clampTimeout(input.timeoutMs);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;
  const timeoutRace = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const abortRace = new Promise<"aborted">((resolve) => {
    if (!input.signal) return;
    abortListener = () => resolve("aborted");
    input.signal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    const outcome = await Promise.race([
      Promise.resolve(gpu.requestAdapter({ powerPreference: input.powerPreference })),
      timeoutRace,
      abortRace,
    ]);
    if (outcome === "timeout") return failedSnapshot(input, true, "adapter-request-timeout");
    if (outcome === "aborted") return failedSnapshot(input, true, "adapter-request-aborted");
    if (!outcome || typeof outcome !== "object") {
      return failedSnapshot(input, true, "adapter-unavailable");
    }
    return normalizeStudioCapabilitySnapshot({
      webgpuAvailable: true,
      adapterAvailable: true,
      limits: readAdapterLimits(outcome.limits),
      features: readAdapterFeatures(outcome.features),
      probeFailure: null,
      ...hostSignals(input),
    });
  } catch {
    return failedSnapshot(
      input,
      true,
      input.signal?.aborted ? "adapter-request-aborted" : "adapter-request-failed",
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (abortListener && input.signal) input.signal.removeEventListener("abort", abortListener);
  }
}

interface StudioCapabilityGlobalsLike {
  readonly navigator?: StudioCapabilityNavigatorLike;
  readonly crossOriginIsolated?: boolean;
  readonly SharedArrayBuffer?: unknown;
}

/**
 * 전역에서 probe 입력을 모은다. 전역 접근은 여기 한 곳에만 있고 전부 방어된다 —
 * 워커·서버 렌더·제한된 웹뷰에서도 던지지 않고 "없음"으로 수렴한다.
 */
export function studioCapabilityProbeInputFromGlobals(
  globals: StudioCapabilityGlobalsLike = globalThis as StudioCapabilityGlobalsLike,
): StudioCapabilityProbeInput {
  const navigatorLike = safely<StudioCapabilityNavigatorLike | null>(
    () => globals.navigator ?? null,
    null,
  );
  const crossOriginIsolated = safely(() => globals.crossOriginIsolated === true, false);
  const sharedArrayBufferAvailable = safely(
    () => typeof globals.SharedArrayBuffer === "function",
    false,
  );
  return {
    navigator: navigatorLike,
    crossOriginIsolated,
    // 교차 출처 격리가 아니면 생성자만 있고 공유 메모리는 못 쓴다 — 둘 다 참일 때만 사용 가능.
    sharedArrayBufferAvailable: sharedArrayBufferAvailable && crossOriginIsolated,
    powerPreference: "high-performance",
  };
}
