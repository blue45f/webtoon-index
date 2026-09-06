import { describe, expect, it, vi } from "vitest";

import {
  STUDIO_VRM_LICENSE_AUTHORITY_MAX_RECORD_BYTES,
  STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE,
  createStudioVrmLicenseAuthorityStore,
} from "./studio-vrm-license-authority-store";
import { STUDIO_VRM_1_PUBLIC_LICENSE_URL } from "./studio-vrm-license-metadata";
import { evaluateStudioVrmLicenseAuthority } from "./studio-vrm-license-product-gate";

const HASH = `sha256:${"a".repeat(64)}`;

function memoryDatabase() {
  const values = new Map<string, string>();
  return {
    values,
    database: {
      kvGet: vi.fn(async (namespace: string, key: string) => values.get(`${namespace}\0${key}`) ?? null),
      kvSet: vi.fn(async (namespace: string, key: string, value: string) => {
        values.set(`${namespace}\0${key}`, value);
      }),
      kvDelete: vi.fn(async (namespace: string, key: string) => {
        values.delete(`${namespace}\0${key}`);
      }),
    },
  };
}

function permissiveVrm1() {
  return {
    extensions: {
      VRMC_vrm: {
        specVersion: "1.0",
        meta: {
          name: "Archive-ready",
          authors: ["Creator"],
          licenseUrl: STUDIO_VRM_1_PUBLIC_LICENSE_URL,
          avatarPermission: "everyone",
          commercialUsage: "corporation",
          allowRedistribution: true,
          modification: "allowModificationRedistribution",
          creditNotation: "required",
        },
      },
    },
  };
}

describe("studio VRM license authority store", () => {
  it("persists a deterministic bounded source and revalidates it after reopen", async () => {
    const state = memoryDatabase();
    const first = createStudioVrmLicenseAuthorityStore(async () => state.database);
    const saved = await first.put(HASH.toUpperCase(), permissiveVrm1());
    expect(saved.status).toBe("verified");

    const raw = state.values.get(`${STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE}\0${HASH}`);
    expect(raw).toBeTruthy();
    expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(
      STUDIO_VRM_LICENSE_AUTHORITY_MAX_RECORD_BYTES,
    );
    expect(raw).not.toContain("meshes");

    const reopened = createStudioVrmLicenseAuthorityStore(async () => state.database);
    const authority = await reopened.get(HASH);
    expect(authority?.status).toBe("verified");
    expect(evaluateStudioVrmLicenseAuthority(
      authority,
      "project-archive-redistribution",
      {
        avatarActorBasis: "other",
        containsModifiedModel: false,
        creditProvided: true,
        containsViolentContent: false,
        containsSexualContent: false,
        containsPoliticalOrReligiousContent: false,
        containsAntisocialOrHateContent: false,
      },
    ).decision).toBe("allow");
  });

  it("stores missing metadata as unknown and keeps outgoing actions fail-closed", async () => {
    const state = memoryDatabase();
    const store = createStudioVrmLicenseAuthorityStore(async () => state.database);
    const saved = await store.put(HASH, { asset: { version: "2.0" } });

    expect(saved.status).toBe("unknown");
    const reopened = await store.get(HASH);
    expect(evaluateStudioVrmLicenseAuthority(reopened, "local-preview").decision).toBe("warn");
    expect(evaluateStudioVrmLicenseAuthority(reopened, "marketplace-share").decision).toBe("block");
  });

  it("turns corrupt, oversized, or hash-swapped rows into explicit unknown authority", async () => {
    const state = memoryDatabase();
    const store = createStudioVrmLicenseAuthorityStore(async () => state.database);
    const key = `${STUDIO_VRM_LICENSE_AUTHORITY_NAMESPACE}\0${HASH}`;

    state.values.set(key, "{");
    expect((await store.get(HASH))?.status).toBe("unknown");

    state.values.set(key, "x".repeat(STUDIO_VRM_LICENSE_AUTHORITY_MAX_RECORD_BYTES + 1));
    expect((await store.get(HASH))?.status).toBe("unknown");

    state.values.set(key, JSON.stringify({
      schema: "toonspectrum.vrm-license-authority-source",
      version: 1,
      contentHash: `sha256:${"b".repeat(64)}`,
      source: { kind: "unknown", code: "missing-metadata", message: "missing" },
    }));
    const swapped = await store.get(HASH);
    expect(evaluateStudioVrmLicenseAuthority(swapped, "derivative-export").decision).toBe("block");
  });
});
