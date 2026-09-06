/**
 * 저장 경로 ↔ OPFS 복구 런타임 배선 + 저장 실패 고지.
 *
 * 감사(ux-audit-v5 §2.10/§2.11):
 *  - 메인 문서 자동저장 실패는 `console.error("Auto-save failed:", cause)` 뿐 — 무음.
 *  - OPFS 쿼터 감지 메시지가 UI 에 닿지 않는다 — 무음.
 *  - `studio-opfs-recovery-runtime.ts` 는 importer 0. 특히 `cleanupQuota` 가 한 번도
 *    돌지 않는다.
 *
 * 이 모듈이 그 셋을 잇는다. 저장 실패가 보고되면
 *  1. 원인을 분류(쿼터 압박 / 그 외 실패)하고
 *  2. 사용자에게 도달하는 신호를 상태 스토어에 남기고
 *  3. 쿼터 압박이면 복구 런타임의 `cleanupQuota()` 를 실제로 돌려 공간을 회수하고
 *     결과(회수 바이트)를 다시 고지하며
 *  4. 회수해도 여전히 압박이면 Safe Mode(storage-pressure)로 들어간다.
 *
 * 정상 경로 무변경 규율: 저장 성공 경로는 이 모듈을 거치지 않는다(`noteStudioSaveSucceeded`
 * 는 신호를 내리기만 한다). 복구 런타임은 **첫 실패 때** 처음 만들어진다 — 설치만으로
 * OPFS 저널이 생기지 않는다.
 */

import { studioAutosaveDocumentBusy } from "./studio-autosave-opfs-session";
import { createStudioOpfsRecoveryRuntime } from "./studio-opfs-recovery-runtime";
import {
  clearStudioReliabilityChannel,
  enterStudioSafeMode,
  reportStudioReliabilitySignal,
  resolveStudioSafeModeReason,
} from "./studio-reliability-status-store";

import type { StudioOpfsRecoveryRuntime } from "./studio-opfs-recovery-runtime";

/** OPFS/스토리지 계열이 공통으로 쓰는 쿼터 오류 이름들. */
const QUOTA_ERROR_NAMES = new Set([
  "QuotaExceededError",
  "NS_ERROR_FILE_NO_DEVICE_SPACE",
]);

function causeName(cause: unknown): string {
  if (typeof cause === "object" && cause !== null && "name" in cause) {
    const name = (cause as { name?: unknown }).name;
    if (typeof name === "string") return name;
  }
  return "";
}

function causeMessage(cause: unknown): string {
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    const nested = cause.errors
      .map((error) => causeMessage(error))
      .filter((message) => message && message !== "알 수 없는 오류");
    if (nested.length > 0) return nested.join(" · ");
  }
  if (cause instanceof Error && cause.message.length > 0) {
    if (cause.message === "All promises were rejected" && "errors" in cause) {
      return causeMessage(new AggregateError(
        (cause as AggregateError).errors ?? [],
        cause.message,
      ));
    }
    return cause.message;
  }
  if (typeof cause === "string" && cause.length > 0) return cause;
  return "알 수 없는 오류";
}

/** 쿼터 압박 판정 — 이름 우선, 코드/메시지는 보조. */
export function isStudioStorageQuotaPressure(cause: unknown): boolean {
  if (QUOTA_ERROR_NAMES.has(causeName(cause))) return true;
  if (typeof cause === "object" && cause !== null && "code" in cause) {
    const code = (cause as { code?: unknown }).code;
    // DOMException.QUOTA_EXCEEDED_ERR(22) / Firefox 의 NS_ERROR_DOM_QUOTA_REACHED(1014).
    if (code === 22 || code === 1014 || code === "QUOTA_EXCEEDED") return true;
  }
  const message = causeMessage(cause);
  return message.includes("quota") || message.includes("Quota") || message.includes("저장 공간");
}

/* ------------------------------------------------------------------ */
/* OPFS 복구 런타임 배선                                                */
/* ------------------------------------------------------------------ */

export interface StudioStorageRecoveryWiringOptions {
  /**
   * 복구 런타임 팩토리. 기본은 OPFS 저널 백엔드 결정을 실제 브라우저 능력으로
   * 프로브하는 `createStudioOpfsRecoveryRuntime`. 테스트는 가짜 런타임을 주입한다.
   */
  readonly createRuntime?: () => Promise<StudioOpfsRecoveryRuntime | null>;
  /** `pagehide` 긴급 플러시를 설치할 대상. 기본은 globalThis(window). */
  readonly pageHideTarget?: {
    addEventListener(type: "pagehide", listener: (event: Event) => void): void;
    removeEventListener(type: "pagehide", listener: (event: Event) => void): void;
  } | null;
  readonly now?: () => number;
}

let wiring: StudioStorageRecoveryWiringOptions = {};
let runtimePromise: Promise<StudioOpfsRecoveryRuntime | null> | null = null;
let detachPageHide: (() => void) | null = null;

/** 기본 팩토리 — 브라우저 능력을 프로브해 OPFS 저널 런타임을 만든다. */
async function defaultCreateRuntime(): Promise<StudioOpfsRecoveryRuntime | null> {
  const [{ selectStudioOpfsFileSystem }, journalModule] = await Promise.all([
    import("./studio-opfs-filesystem"),
    import("./studio-opfs-recovery-journal"),
  ]);
  const scope = globalThis as {
    navigator?: {
      storage?: { estimate?: () => Promise<StorageEstimate> };
      locks?: {
        request<T>(
          name: string,
          options: { readonly mode: "exclusive"; readonly signal?: AbortSignal },
          callback: () => Promise<T>,
        ): Promise<T>;
      };
    };
  };
  const lockManager = scope.navigator?.locks ?? null;
  if (!lockManager || typeof lockManager.request !== "function") return null;
  const selection = await selectStudioOpfsFileSystem(
    globalThis as Parameters<typeof selectStudioOpfsFileSystem>[0],
    { rootName: "studio-recovery" },
  );
  if (selection.kind !== "opfs") return null;
  const estimate = scope.navigator?.storage?.estimate;
  const journal = journalModule.createStudioOpfsRecoveryJournal({
    identity: {
      documentId: "studio-active-document",
      documentVersion: 1,
      engineVersion: "studio-recovery-v1",
    },
    adapter: journalModule.createStudioOpfsRecoveryJournalAdapter({
      fileSystem: selection.fs,
      lockManager,
      quotaEstimator: estimate ? { estimate: () => estimate.call(scope.navigator!.storage) } : null,
    }),
  });
  return createStudioOpfsRecoveryRuntime({
    probeCapabilities: () => ({
      fileSystemKind: "opfs",
      originLockAvailable: true,
    }),
    createOpfsJournal: () => journal,
  });
}

/**
 * 배선 구성 주입(테스트·부트스트랩). 이미 만들어진 런타임은 버려진다.
 */
export function configureStudioStorageRecovery(
  options: StudioStorageRecoveryWiringOptions,
): void {
  wiring = options;
  runtimePromise = null;
  detachPageHide?.();
  detachPageHide = null;
}

function now(): number {
  return (wiring.now ?? Date.now)();
}

function resolvePageHideTarget(): StudioStorageRecoveryWiringOptions["pageHideTarget"] {
  if (wiring.pageHideTarget !== undefined) return wiring.pageHideTarget;
  const scope = globalThis as {
    addEventListener?: unknown;
    removeEventListener?: unknown;
  };
  return typeof scope.addEventListener === "function"
    ? (globalThis as unknown as NonNullable<
        StudioStorageRecoveryWiringOptions["pageHideTarget"]
      >)
    : null;
}

/**
 * 복구 런타임 확보(최초 1회 생성). 만들지 못하면 null 이며, 그 사실도 사용자에게
 * 고지된다 — 내구 복구가 없다는 것은 조용히 넘어갈 사실이 아니다.
 */
export async function ensureStudioStorageRecoveryRuntime(): Promise<StudioOpfsRecoveryRuntime | null> {
  runtimePromise ??= (wiring.createRuntime ?? defaultCreateRuntime)()
    .then((runtime) => {
      if (!runtime) return null;
      const target = resolvePageHideTarget();
      if (target) {
        // 탭 종료 시 미기록 복구 항목을 마지막으로 밀어낸다(§2.10 "탭 종료" 경로).
        detachPageHide = runtime.installPageHideFlush(target, (error: unknown) => {
          reportStudioReliabilitySignal({
            channel: "storage",
            level: "failed",
            title: "탭을 닫는 동안 복구 기록을 마무리하지 못했습니다",
            detail: causeMessage(error),
            at: now(),
          });
        });
      }
      return runtime;
    })
    .catch((cause: unknown) => {
      reportStudioReliabilitySignal({
        channel: "storage",
        level: "degraded",
        title: "내구 복구 저장소를 열지 못했습니다",
        detail: `${causeMessage(cause)} — 현재 작업은 이 탭 메모리에만 남아 있습니다.`,
        at: now(),
      });
      return null;
    });
  return runtimePromise;
}

/** 테스트 격리용 — 런타임과 pagehide 설치를 내린다. */
export function resetStudioStorageRecoveryRuntime(): void {
  detachPageHide?.();
  detachPageHide = null;
  runtimePromise = null;
  wiring = {};
}

/* ------------------------------------------------------------------ */
/* 저장 실패 고지                                                       */
/* ------------------------------------------------------------------ */

/**
 * 저장이 성공했다 — 남아 있던 실패 신호를 내린다.
 *
 * **내구 저장소로 성공했을 때만** 신호를 내린다. V12 제품 경로는 브라우저 KV 저장을
 * 성공으로 호출할 수 없으며, OPFS/SQLite receipt만 이 진입점에 전달한다.
 */
export function noteStudioSaveSucceeded(
  authority: "opfs-journal" | "sqlite-fallback" = "opfs-journal",
): void {
  void authority;
  clearStudioReliabilityChannel("save");
}

/**
 * 자동저장이 완전히 실패했을 때의 단일 진입점.
 * StudioPage 의 `console.error("Auto-save failed:", cause)` 옆에 이 한 줄이 붙어
 * 무음을 깬다. 쿼터 압박이면 복구 런타임의 `cleanupQuota()` 까지 이어진다.
 */
export function reportStudioAutosaveFailure(cause: unknown): Promise<void> {
  if (studioAutosaveDocumentBusy(cause)) return Promise.resolve();
  const quota = isStudioStorageQuotaPressure(cause);
  reportStudioReliabilitySignal({
    channel: "save",
    level: "failed",
    title: quota
      ? "저장 공간이 부족해 임시저장에 실패했습니다"
      : "임시저장에 실패했습니다",
    detail: quota
      ? "공간을 회수하는 중입니다. 지금 작업을 파일로 내보내 두는 것이 안전해요."
      : `${causeMessage(cause)} — 작업을 파일로 내보내 두는 것이 안전해요.`,
    at: now(),
  });
  if (!quota) return Promise.resolve();
  enterStudioSafeMode("storage-pressure", now());
  return reclaimStudioStorage();
}

/**
 * OPFS와 SQLite 저장 권위를 모두 사용할 수 없을 때. 현재 탭의 메모리 작업은 유지되지만
 * 내구 저장 성공은 아니므로 그 사실이 사용자에게 도달해야 한다.
 */
export function reportStudioSaveAuthorityDegraded(cause: unknown): void {
  if (studioAutosaveDocumentBusy(cause)) return;
  reportStudioReliabilitySignal({
    channel: "save",
    level: "degraded",
    title: "내구 임시저장 경로를 사용할 수 없습니다",
    detail: `${causeMessage(cause)} — 현재 작업은 이 탭 메모리에만 남아 있어요. 파일로 내보내 두는 것이 안전합니다.`,
    at: now(),
  });
}

/**
 * 복구 저널에서 회수 가능한 공간을 실제로 비운다(`cleanupQuota` 배선 지점).
 * 결과는 언제나 사용자에게 고지된다 — 회수 성공도, 회수 실패도.
 */
export async function reclaimStudioStorage(): Promise<void> {
  const runtime = await ensureStudioStorageRecoveryRuntime();
  if (!runtime) {
    reportStudioReliabilitySignal({
      channel: "storage",
      level: "failed",
      title: "저장 공간을 회수할 수 없습니다",
      detail: "브라우저 저장소 설정에서 공간을 직접 확보해 주세요.",
      at: now(),
    });
    return;
  }
  try {
    const result = await runtime.cleanupQuota();
    if (result.freedBytes > 0) {
      reportStudioReliabilitySignal({
        channel: "storage",
        level: "ok",
        title: `복구 기록을 정리해 ${formatBytes(result.freedBytes)}를 회수했습니다`,
        detail: `정리한 항목 ${result.removedPaths.length}개`,
        at: now(),
      });
      resolveStudioSafeModeReason("storage-pressure");
      return;
    }
    reportStudioReliabilitySignal({
      channel: "storage",
      level: "failed",
      title: "회수할 수 있는 복구 기록이 없습니다",
      detail: "브라우저 저장소 설정에서 공간을 직접 확보해 주세요.",
      at: now(),
    });
  } catch (cause: unknown) {
    reportStudioReliabilitySignal({
      channel: "storage",
      level: "failed",
      title: "저장 공간 회수에 실패했습니다",
      detail: causeMessage(cause),
      at: now(),
    });
  }
}

function formatBytes(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}MB`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}KB`;
  return `${Math.max(0, Math.round(value))}B`;
}
