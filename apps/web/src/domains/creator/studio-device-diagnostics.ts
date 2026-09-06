/**
 * §15.3 Help ▸ Device/Browser Diagnosis — 실측 전용 진단 조립기.
 *
 * 설계 규칙은 하나다. **측정하지 않은 값은 값이 아니다.** 모든 항목은
 * `measured: boolean` 을 들고 다니고, 측정에 실패했거나 아직 프로브를 돌리지
 * 않았으면 값 대신 그 사실을 적는다. "지원함/지원 안 함"으로 뭉뚱그리지 않고
 * "확인 못 함"을 따로 둔다 — 브라우저가 값을 숨기는 경우(디바이스 메모리,
 * 스토리지 쿼터)가 실제로 흔하기 때문이다.
 *
 * 이 모듈은 **순수 조립기**다. 프로브를 직접 호출하지 않고, 호출자가 모아 온
 * 결과를 받아 표시용 그룹으로 만든다. 그래야 프로브 없이도 표 구조를 테스트할 수
 * 있고, 패널이 어떤 프로브를 언제 돌릴지(비싼 wasm 을 사용자 동의 없이 받지 않는
 * 것 포함)를 패널이 결정할 수 있다.
 */

import { STUDIO_CAPABILITY_TIER_LABELS } from "./studio-capability-messages";
import { describeStudioSafeModeReason } from "./studio-reliability-status-store";

import type { StudioGpuFabricCapabilities } from "./render/studio-gpu-fabric";
import type { StudioGpuBackend } from "./render/studio-webgpu-frame-contract";
import type { StudioCapabilityClassification } from "./studio-capability-tier";
import type { StudioSqliteSupportProbe } from "./studio-local-database";
import type { StudioOpfsQuotaEstimate } from "./studio-opfs-asset-store";
import type { StudioReliabilityStatusSnapshot } from "./studio-reliability-status-store";

/* ------------------------------------------------------------------ types */

export interface StudioDiagnosticsField {
  readonly id: string;
  readonly label: string;
  /** 측정된 값. `measured` 가 false 면 이 문자열은 **왜 못 쟀는지**를 말한다. */
  readonly value: string;
  readonly measured: boolean;
  readonly detail?: string;
}

export interface StudioDiagnosticsGroup {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly StudioDiagnosticsField[];
}

export interface StudioDiagnosticsReport {
  /** 조립 시각(ms). 리포트가 언제 찍힌 스냅샷인지 밝힌다. */
  readonly collectedAt: number;
  readonly groups: readonly StudioDiagnosticsGroup[];
  readonly measuredCount: number;
  readonly unmeasuredCount: number;
}

export interface StudioDiagnosticsBrowserInput {
  readonly name: string;
  readonly version: string;
  readonly os: string;
  readonly isSupported: boolean;
  readonly isLegacy: boolean;
  readonly missingFeatures: readonly string[];
}

/**
 * `probeWebGpu()` 결과. 어댑터 신원(vendor/driver)을 주는 유일한 경로지만 4MB 대
 * wasm 을 받으므로 사용자가 명시적으로 눌렀을 때만 채워진다.
 */
export interface StudioDiagnosticsAdapterInput {
  readonly supported: boolean;
  readonly name?: string;
  readonly backend?: string;
  readonly deviceType?: string;
  readonly driver?: string;
  readonly driverInfo?: string;
  readonly reason?: string;
}

export interface StudioDiagnosticsInput {
  readonly collectedAt: number;
  readonly browser: StudioDiagnosticsBrowserInput | null;
  /** `probeStudioCapabilitySnapshot()` → `classifyStudioCapabilityTier()` 결과. */
  readonly capability: StudioCapabilityClassification | null;
  /** 실제 `GPUDevice` 를 잡은 세션에서만 채워진다. */
  readonly gpuFabric: StudioGpuFabricCapabilities | null;
  readonly adapter: StudioDiagnosticsAdapterInput | null;
  readonly sqlite: StudioSqliteSupportProbe | null;
  readonly storage: StudioOpfsQuotaEstimate | null;
  readonly reliability: StudioReliabilityStatusSnapshot;
  readonly renderBackend: StudioGpuBackend | null;
  readonly appVersion: string;
  /** 하드웨어 동시성 등 `capability` 가 담지 않는 페이지 컨텍스트. */
  readonly secureContext: boolean | null;
}

/* -------------------------------------------------------------- formatting */

const UNMEASURED = "확인 못 함";

function field(
  id: string,
  label: string,
  value: string | null | undefined,
  detail?: string,
): StudioDiagnosticsField {
  const measured = typeof value === "string" && value.length > 0;
  return {
    id,
    label,
    value: measured ? value : UNMEASURED,
    measured,
    ...(detail === undefined ? {} : { detail }),
  };
}

function unmeasured(
  id: string,
  label: string,
  reason: string,
): StudioDiagnosticsField {
  return { id, label, value: reason, measured: false };
}

export function formatStudioDiagnosticsBytes(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

function yesNo(value: boolean): string {
  return value ? "예" : "아니오";
}

/* --------------------------------------------------------------- assembly */

function browserGroup(input: StudioDiagnosticsInput): StudioDiagnosticsGroup {
  const browser = input.browser;
  return {
    id: "browser",
    label: "브라우저 · 페이지",
    fields: [
      browser
        ? field("browser.name", "브라우저", `${browser.name} ${browser.version}`)
        : unmeasured("browser.name", "브라우저", "브라우저 점검을 아직 돌리지 않았습니다."),
      browser
        ? field("browser.os", "운영체제", browser.os)
        : unmeasured("browser.os", "운영체제", "브라우저 점검을 아직 돌리지 않았습니다."),
      browser
        ? field(
            "browser.support",
            "지원 판정",
            browser.isSupported
              ? browser.isLegacy
                ? "지원(구버전 — 업데이트 권장)"
                : "지원"
              : "미지원",
            browser.missingFeatures.length > 0
              ? `없는 기능: ${browser.missingFeatures.join(", ")}`
              : undefined,
          )
        : unmeasured("browser.support", "지원 판정", "브라우저 점검을 아직 돌리지 않았습니다."),
      input.secureContext === null
        ? unmeasured("browser.secure-context", "보안 컨텍스트", "페이지 컨텍스트를 읽지 못했습니다.")
        : field("browser.secure-context", "보안 컨텍스트", yesNo(input.secureContext)),
      field(
        "app.version",
        "앱 빌드 모드",
        input.appVersion,
        "빌드 파이프라인이 버전 식별자를 주입하지 않아 모드만 보고합니다.",
      ),
    ],
  };
}

function gpuGroup(input: StudioDiagnosticsInput): StudioDiagnosticsGroup {
  const capability = input.capability;
  const snapshot = capability?.snapshot ?? null;
  const fabric = input.gpuFabric;
  const adapter = input.adapter;

  const fields: StudioDiagnosticsField[] = [];

  if (!capability || !snapshot) {
    fields.push(
      unmeasured("gpu.webgpu", "WebGPU 지원", "능력 프로브를 아직 돌리지 않았습니다."),
    );
  } else {
    fields.push(
      field(
        "gpu.webgpu",
        "WebGPU 지원",
        snapshot.webgpuAvailable ? "navigator.gpu 있음" : "navigator.gpu 없음",
        capability.snapshot.probeFailure === null
          ? undefined
          : `프로브 결과: ${capability.snapshot.probeFailure}`,
      ),
      field(
        "gpu.adapter",
        "어댑터 확보",
        snapshot.adapterAvailable ? "성공" : "실패",
      ),
      field(
        "gpu.tier",
        "능력 티어",
        `${STUDIO_CAPABILITY_TIER_LABELS[capability.tier]} (${capability.code})`,
        capability.deciding
          ? `결정 신호: ${capability.deciding.signal} · 측정 ${
              capability.deciding.measured ?? "미확인"
            } / 요구 ${capability.deciding.required}`
          : undefined,
      ),
      snapshot.limits.maxTextureDimension2D === undefined
        ? unmeasured(
            "gpu.max-texture",
            "최대 2D 텍스처",
            snapshot.adapterAvailable
              ? "어댑터가 한계값을 노출하지 않았습니다."
              : "어댑터를 얻지 못해 한계값을 읽지 못했습니다.",
          )
        : field(
            "gpu.max-texture",
            "최대 2D 텍스처",
            `${snapshot.limits.maxTextureDimension2D} px`,
          ),
      field(
        "gpu.features",
        "확인한 기능",
        snapshot.features.length > 0 ? snapshot.features.join(", ") : "없음",
        `timestamp-query ${yesNo(capability.supportsTimestampQuery)} · float32-filterable ${yesNo(
          capability.supportsFloat32Filterable,
        )} · shader-f16 ${yesNo(capability.supportsShaderF16)}`,
      ),
      field("gpu.cross-origin-isolated", "crossOriginIsolated", yesNo(snapshot.crossOriginIsolated)),
      field(
        "gpu.shared-array-buffer",
        "SharedArrayBuffer",
        yesNo(snapshot.sharedArrayBufferAvailable),
      ),
      snapshot.hardwareConcurrency === null
        ? unmeasured("gpu.cores", "논리 코어", "브라우저가 값을 노출하지 않았습니다.")
        : field("gpu.cores", "논리 코어", `${snapshot.hardwareConcurrency}개`),
      snapshot.deviceMemoryGb === null
        ? unmeasured("gpu.device-memory", "기기 메모리", "브라우저가 값을 노출하지 않았습니다.")
        : field("gpu.device-memory", "기기 메모리", `${snapshot.deviceMemoryGb} GB`),
    );
  }

  fields.push(
    input.renderBackend === null
      ? unmeasured(
          "gpu.render-backend",
          "현재 래스터 백엔드",
          "이 세션에서 아직 백엔드 전환 보고가 없었습니다.",
        )
      : field("gpu.render-backend", "현재 래스터 백엔드", input.renderBackend),
    fabric === null
      ? unmeasured(
          "gpu.device",
          "GPU 디바이스",
          "이 세션에서 GPUDevice 를 잡은 적이 없어 디바이스 한계를 잴 수 없습니다.",
        )
      : field(
          "gpu.device",
          "GPU 디바이스",
          `epoch ${fabric.deviceEpoch} · 최대 텍스처 ${fabric.maxTextureDimension2D}px`,
          `timestamp-query ${yesNo(fabric.timestampQuery)} · 최대 버퍼 ${
            formatStudioDiagnosticsBytes(fabric.maxBufferSize) ?? "?"
          }`,
        ),
    adapter === null
      ? unmeasured(
          "gpu.adapter-identity",
          "어댑터 신원",
          "조회하지 않았습니다(4MB 대 WebGPU 프로브 모듈을 내려받아야 합니다).",
        )
      : adapter.supported
        ? field(
            "gpu.adapter-identity",
            "어댑터 신원",
            [adapter.name, adapter.backend, adapter.deviceType]
              .filter((part): part is string => Boolean(part))
              .join(" · "),
            [adapter.driver, adapter.driverInfo]
              .filter((part): part is string => Boolean(part && part.length > 0))
              .join(" · ") || undefined,
          )
        : field(
            "gpu.adapter-identity",
            "어댑터 신원",
            `조회 실패: ${adapter.reason ?? "이유 없음"}`,
          ),
  );

  return { id: "gpu", label: "GPU · 렌더링", fields };
}

function storageGroup(input: StudioDiagnosticsInput): StudioDiagnosticsGroup {
  const sqlite = input.sqlite;
  const storage = input.storage;
  return {
    id: "storage",
    label: "저장소",
    fields: [
      sqlite === null
        ? unmeasured("storage.sqlite", "SQLite(wasm)", "프로브를 아직 돌리지 않았습니다.")
        : field(
            "storage.sqlite",
            "SQLite(wasm)",
            sqlite.wasm ? "사용 가능" : "사용 불가",
            sqlite.reason,
          ),
      sqlite === null
        ? unmeasured("storage.opfs", "OPFS 동기 접근", "프로브를 아직 돌리지 않았습니다.")
        : field("storage.opfs", "OPFS 동기 접근", sqlite.opfs ? "사용 가능" : "사용 불가"),
      storage === null
        ? unmeasured("storage.usage", "저장소 사용량", "쿼터 추정을 아직 돌리지 않았습니다.")
        : storage.usage === null
          ? unmeasured(
              "storage.usage",
              "저장소 사용량",
              "브라우저가 사용량을 노출하지 않았습니다.",
            )
          : field(
              "storage.usage",
              "저장소 사용량",
              `${formatStudioDiagnosticsBytes(storage.usage) ?? "?"} / ${
                formatStudioDiagnosticsBytes(storage.quota) ?? "?"
              }`,
              storage.usedRatio === null
                ? undefined
                : `사용률 ${(storage.usedRatio * 100).toFixed(1)}% · 판정 ${storage.level}`,
            ),
      storage === null || storage.message === null
        ? field("storage.pressure", "쿼터 경고", "없음")
        : field("storage.pressure", "쿼터 경고", storage.message),
    ],
  };
}

function reliabilityGroup(input: StudioDiagnosticsInput): StudioDiagnosticsGroup {
  const { gpu, save, storage, safeMode } = input.reliability;
  const signal = (
    id: string,
    label: string,
    value: (typeof input.reliability)["gpu"],
  ): StudioDiagnosticsField =>
    value === null
      ? field(`reliability.${id}`, label, "이상 없음")
      : field(`reliability.${id}`, label, `${value.level} · ${value.title}`, value.detail);

  return {
    id: "reliability",
    label: "신뢰성 채널 · 안전 모드",
    fields: [
      signal("save", "저장", save),
      signal("gpu", "GPU", gpu),
      signal("storage", "저장소", storage),
      field(
        "reliability.safe-mode",
        "안전 모드",
        safeMode.active
          ? `켜짐 — ${safeMode.reasons.map(describeStudioSafeModeReason).join(" · ")}`
          : "꺼짐",
        safeMode.active
          ? `GPU 레인 차단 ${yesNo(safeMode.quality.gpuLanesDisabled)} · 리빙 잉크 중단 ${yesNo(
              safeMode.quality.livingInkSuspended,
            )}`
          : undefined,
      ),
    ],
  };
}

export function buildStudioDiagnosticsReport(
  input: StudioDiagnosticsInput,
): StudioDiagnosticsReport {
  const groups = [
    browserGroup(input),
    gpuGroup(input),
    storageGroup(input),
    reliabilityGroup(input),
  ];
  let measuredCount = 0;
  let unmeasuredCount = 0;
  for (const group of groups) {
    for (const entry of group.fields) {
      if (entry.measured) measuredCount += 1;
      else unmeasuredCount += 1;
    }
  }
  return { collectedAt: input.collectedAt, groups, measuredCount, unmeasuredCount };
}

/** 사람이 읽고 붙여 넣을 수 있는 평문. 버그 리포트 패키지도 이 형식을 쓴다. */
export function formatStudioDiagnosticsText(report: StudioDiagnosticsReport): string {
  const lines: string[] = [];
  for (const group of report.groups) {
    lines.push(`## ${group.label}`);
    for (const entry of group.fields) {
      const marker = entry.measured ? "" : " (미측정)";
      lines.push(`- ${entry.label}: ${entry.value}${marker}`);
      if (entry.detail) lines.push(`  - ${entry.detail}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
