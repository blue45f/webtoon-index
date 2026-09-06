import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

describe("Studio CRDT recovery SQLite product boundary", () => {
  it("constructs product recovery through the shared local database and structured v6 surface", () => {
    const vault = source("./studio-crdt-recovery-vault.ts");
    const localDatabase = source("../studio-local-database.ts");

    expect(vault).toContain("acquireStudioLocalDatabase");
    expect(vault).toContain("requireStudioCrdtRecoveryDatabase");
    expect(vault).toContain("createStudioCrdtRecoverySqlitePersistence");
    expect(vault).toContain("return new PersistentStudioCrdtRecoveryVault()");
    expect(localDatabase).toContain("CREATE TABLE IF NOT EXISTS crdt_recovery_v12_rows");
    expect(localDatabase).toContain("putCrdtRecoveryRecord");
    expect(localDatabase).toContain("BEGIN IMMEDIATE");
  });

  it("contains no browser-KV recovery authority or automatic legacy migration path", () => {
    const vault = source("./studio-crdt-recovery-vault.ts");

    expect(vault).not.toContain("localStorage");
    expect(vault).not.toContain("indexedDB");
    expect(vault).not.toContain("IDBDatabase");
    expect(vault).not.toContain("BrowserStudioCrdtRejectionMarkerFallback");
    expect(vault).not.toContain("toonspectrum-studio-crdt-recovery-vault");
    expect(vault).not.toMatch(/migrat|legacy.*read|import.*indexed/i);
    expect(vault).toContain("SamePageStudioCrdtRejectionMarkerLatch");
    expect(vault).toContain('readonly durability = "degraded"');
  });

  it("keeps the collaboration product default wired to the fail-closed recovery factory", () => {
    const binding = source("./studio-crdt-room-binding.ts");

    expect(binding).toContain("createStudioCrdtRecoveryVault");
    expect(binding).toContain("options.recoveryVault ?? createStudioCrdtRecoveryVault()");
    expect(binding).toContain('code: "recovery_vault_unavailable"');
    expect(binding).toContain("outboxCleanupAtRisk: true");
    expect(binding).toContain("영구 거절 표식도 저장하지 못했습니다");
  });
});
