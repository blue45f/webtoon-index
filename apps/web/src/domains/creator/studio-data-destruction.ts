/**
 * V11.1 §12.5 — 기존 Studio 내부 창작 데이터 파괴 초기화.
 *
 * Migration 없이 폐기한다: 프로젝트·레이어·저널·스냅샷·캐시·사용자 프리셋·
 * 워크스페이스 설정·협업 상태·legacy asset index. 플랫폼 데이터(계정·인증·
 * 결제·조직)는 이 모듈의 대상이 아니며 어떤 경로로도 건드리지 않는다.
 *
 * 실행은 환경 오인을 막기 위해 3중 명시 플래그를 요구한다(§12.5). 이 게이트는
 * migration 우회 안전장치가 아니라 "지금, 이 배포본을, 인플레이스로 교체한다"
 * 는 운영자 확인이다.
 */

export const STUDIO_DATA_RESET_CONFIRMATION_PHRASE =
  "REPLACE_CURRENT_TOONSTUDIO_IN_PLACE_V12";

/**
 * Studio 내부 데이터 인벤토리. 문자열 리터럴은 각 저장 모듈의 소스와
 * studio-data-destruction.test.ts 의 소스 대조 계약으로 고정된다(모듈 수정
 * 없이 드리프트를 CI에서 잡는다).
 */
export const STUDIO_OPFS_ROOTS: readonly string[] = Object.freeze([
  // studio-autosave-opfs-session.ts AUTOSAVE_ROOT_NAME
  "toonspectrum-studio-autosave-v3",
  // studio-engine-tile-storage-opfs-v2-backend.ts product root
  "toonspectrum-studio-engine-storage-v2",
  // StudioPage.tsx hybrid DCC recovery-journal rootName
  "toonspectrum-hybrid-dcc-v1",
  // studio-hybrid-dcc-workspace-persistence.ts STUDIO_HYBRID_DCC_WORKSPACE_PERSISTENCE_ROOT
  "dcc-workspaces",
  // packages/studio-project-model OpfsJournalStore root (+ pre-V11.1 name)
  "toonspectrum-studio-projects",
  "toonstudio-v11",
  // studio-local-database.ts STUDIO_SQLITE_OPFS_DIRECTORY (opfs-sahpool VFS root)
  "toonspectrum-studio-sqlite",
  // studio-local-database.ts STUDIO_SQLITE_OPFS_RECOVERY_DIRECTORY (locked-SAH fallback)
  "toonspectrum-studio-sqlite-r1",
  // studio-opfs-filesystem.ts default + asset/BG3D shot SHA-256 CAS
  "toonspectrum-studio-assets",
  // studio-opfs-sync-access-store.ts large-document binary authority
  "toonspectrum-studio-large-documents",
  // studio-pages-history-durable-runtime.ts history recovery snapshots
  "toonspectrum-studio-history-recovery",
  // studio-vrm-asset-sqlite-opfs-repository.ts model/texture SHA-256 CAS
  "toonspectrum-studio-vrm-assets-v12",
  // studio-bg3d-libraries-sqlite-opfs-authority.ts model/thumbnail SHA-256 CAS
  "toonspectrum-studio-bg3d-libraries-v12",
  // studio-storage-recovery-runtime.ts quota/save-failure recovery journal
  "studio-recovery",
]);

export const STUDIO_INDEXED_DB_DATABASES: readonly string[] = Object.freeze([
  "toonspectrum-studio-vrm-library",
  "toonspectrum-studio-crdt-outbox",
  "toonspectrum-studio-checkpoints",
  "toonspectrum-studio-crdt-recovery-vault",
  "toonspectrum-studio-bg3d-model-library",
  "toonspectrum-studio-bg3d-template-library",
  "toonspectrum-studio-asset-library",
  "toonspectrum-studio-scene-snapshot-library",
  "toonspectrum-studio-production-bible",
  "toonspectrum-studio-bg3d-asset-metadata",
  "toonspectrum-studio-bg3d-shot-batch-recovery",
  "toonspectrum-studio-vrm-texture-paint-library",
]);

export const STUDIO_LOCAL_STORAGE_PREFIXES: readonly string[] = Object.freeze([
  // V12 fallback, Studio preferences, libraries, and legacy creative state.
  // This deliberately excludes account/auth/billing keys, which do not use this prefix.
  "toonspectrum-studio-",
  // studio-workspaces.ts / studio-autosave.ts / VRM poser 등 이전 Studio 창작 상태.
  "toonspectrum:studio:",
  "toonspectrum-studio-autosave",
  "studio:",
  "studio_",
]);

/**
 * Studio creative keys that deliberately use a dotted namespace and therefore
 * do not match the hyphen/colon prefixes above. Keep these exact: a broad
 * `toonspectrum.studio` prefix could erase account/platform data that is outside
 * the destructive cutover boundary.
 */
export const STUDIO_LOCAL_STORAGE_EXACT_KEYS: readonly string[] = Object.freeze([
  "toonspectrum.studio-marketplace-library.v1",
  "toonspectrum.studio-creator-filter-presets.v1",
  "toonspectrum.studio-filter-library.v12.fallback",
  "toonspectrum.studio.bg3d.lt-presets.v1",
  "toonspectrum.studio.bg3d.lt-presets.corrupt.v1",
  "toonspectrum.studio.tutorialProgress.v1",
]);

export interface StudioDataDestructionFlags {
  RESET_EXISTING_STUDIO_DATA?: string;
  RESET_TARGET?: string;
  RESET_CONFIRMATION?: string;
}

export interface StudioDataDestructionAuthorization {
  authorized: boolean;
  reasons: string[];
}

export function authorizeStudioDataDestruction(
  flags: StudioDataDestructionFlags,
  verifiedDeploymentId: string,
): StudioDataDestructionAuthorization {
  const reasons: string[] = [];
  if (flags.RESET_EXISTING_STUDIO_DATA !== "YES") {
    reasons.push("RESET_EXISTING_STUDIO_DATA must be exactly \"YES\"");
  }
  if (typeof verifiedDeploymentId !== "string" || verifiedDeploymentId.trim() === "") {
    reasons.push("verified deployment id is empty — refusing to match any target");
  } else if (flags.RESET_TARGET !== verifiedDeploymentId) {
    reasons.push(
      `RESET_TARGET (${flags.RESET_TARGET ?? "<unset>"}) does not match the verified deployment id`,
    );
  }
  if (flags.RESET_CONFIRMATION !== STUDIO_DATA_RESET_CONFIRMATION_PHRASE) {
    reasons.push(
      `RESET_CONFIRMATION must be exactly "${STUDIO_DATA_RESET_CONFIRMATION_PHRASE}"`,
    );
  }
  return { authorized: reasons.length === 0, reasons };
}

export type StudioDataDestructionTarget =
  | { kind: "opfs-root"; name: string }
  | { kind: "indexed-db"; name: string }
  | { kind: "local-storage-prefix"; prefix: string }
  | { kind: "local-storage-key"; key: string };

export function planStudioDataDestruction(): StudioDataDestructionTarget[] {
  return [
    ...STUDIO_OPFS_ROOTS.map((name) => ({ kind: "opfs-root" as const, name })),
    ...STUDIO_INDEXED_DB_DATABASES.map((name) => ({
      kind: "indexed-db" as const,
      name,
    })),
    ...STUDIO_LOCAL_STORAGE_PREFIXES.map((prefix) => ({
      kind: "local-storage-prefix" as const,
      prefix,
    })),
    ...STUDIO_LOCAL_STORAGE_EXACT_KEYS.map((key) => ({
      kind: "local-storage-key" as const,
      key,
    })),
  ];
}

/** Storage adapter seam — browser defaults below; tests inject fakes. */
export interface StudioDataDestructionAdapter {
  removeOpfsRoot(name: string): Promise<void>;
  deleteIndexedDb(name: string): Promise<void>;
  removeLocalStorageByPrefix(prefix: string): Promise<number>;
  removeLocalStorageKey(key: string): Promise<number>;
}

export class StudioDataDestructionRefusedError extends Error {
  constructor(readonly reasons: string[]) {
    super(`studio data destruction refused: ${reasons.join("; ")}`);
    this.name = "StudioDataDestructionRefusedError";
  }
}

export interface StudioDataDestructionReport {
  destroyed: StudioDataDestructionTarget[];
  localStorageKeysRemoved: number;
}

export async function executeStudioDataDestruction(
  flags: StudioDataDestructionFlags,
  verifiedDeploymentId: string,
  adapter: StudioDataDestructionAdapter = browserStudioDataDestructionAdapter(),
): Promise<StudioDataDestructionReport> {
  const authorization = authorizeStudioDataDestruction(flags, verifiedDeploymentId);
  if (!authorization.authorized) {
    throw new StudioDataDestructionRefusedError(authorization.reasons);
  }
  const destroyed: StudioDataDestructionTarget[] = [];
  let localStorageKeysRemoved = 0;
  for (const target of planStudioDataDestruction()) {
    switch (target.kind) {
      case "opfs-root":
        await adapter.removeOpfsRoot(target.name);
        break;
      case "indexed-db":
        await adapter.deleteIndexedDb(target.name);
        break;
      case "local-storage-prefix":
        localStorageKeysRemoved += await adapter.removeLocalStorageByPrefix(
          target.prefix,
        );
        break;
      case "local-storage-key":
        localStorageKeysRemoved += await adapter.removeLocalStorageKey(target.key);
        break;
    }
    destroyed.push(target);
  }
  return { destroyed, localStorageKeysRemoved };
}

export function browserStudioDataDestructionAdapter(): StudioDataDestructionAdapter {
  return {
    async removeOpfsRoot(name) {
      if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return;
      const root = await navigator.storage.getDirectory();
      try {
        await root.removeEntry(name, { recursive: true });
      } catch (error) {
        // Absent roots are success (idempotent destruction); real failures propagate.
        if ((error as { name?: string })?.name !== "NotFoundError") throw error;
      }
    },
    deleteIndexedDb(name) {
      if (typeof indexedDB === "undefined") return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error(`deleteDatabase ${name}`));
        request.onblocked = () => resolve();
      });
    },
    removeLocalStorageByPrefix(prefix) {
      if (typeof localStorage === "undefined") return Promise.resolve(0);
      const doomed: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key !== null && key.startsWith(prefix)) doomed.push(key);
      }
      for (const key of doomed) localStorage.removeItem(key);
      return Promise.resolve(doomed.length);
    },
    removeLocalStorageKey(key) {
      if (typeof localStorage === "undefined" || localStorage.getItem(key) === null) {
        return Promise.resolve(0);
      }
      localStorage.removeItem(key);
      return Promise.resolve(1);
    },
  };
}
