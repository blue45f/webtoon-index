import { describe, expect, it } from "vitest";

import {
  STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY,
  STUDIO_MARKETPLACE_PACKAGE_SCHEMA,
  cloneStudioMarketplacePackageToLibrary,
  compareStudioMarketplaceVersions,
  createStudioMarketplaceConflictCloneId,
  createStudioMarketplaceShareManifest,
  evaluateStudioMarketplaceCompatibility,
  evaluateStudioMarketplacePublishRights,
  filterStudioMarketplacePackages,
  loadStudioMarketplaceLibrary,
  removeStudioMarketplacePackageFromLibrary,
  resolveStudioMarketplaceImport,
  saveStudioMarketplaceLibrary,
  type StudioMarketplaceLibraryState,
  type StudioMarketplacePackage,
} from "./studio-marketplace-packages";

function marketplacePackage(
  overrides: Partial<StudioMarketplacePackage> = {}
): StudioMarketplacePackage {
  return {
    schema: STUDIO_MARKETPLACE_PACKAGE_SCHEMA,
    id: "pack-everyday",
    name: "일상 공간 스타터",
    summary: "웹툰 컷에 바로 놓는 독자 제작 벡터 공간",
    category: "현대 배경",
    tags: ["일상", "배경", "학교"],
    kind: "vector-asset",
    access: "free",
    accessLabel: "무료",
    origin: "original-procedural",
    creator: {
      id: "toonspectrum-lab",
      name: "ToonSpectrum Lab",
      verified: true,
    },
    version: "1.2.0",
    packageFingerprint: "sha256:test-pack-everyday-1.2.0",
    compatibility: {
      studioVersion: ">=1.0.0",
      renderer: ["canvas2d", "svg"],
      devices: ["desktop", "tablet", "mobile"],
      formats: ["image/svg+xml"],
    },
    license: {
      id: "cc0-1.0",
      label: "CC0 1.0",
      url: "https://creativecommons.org/publicdomain/zero/1.0/",
      commercialUse: true,
      attributionRequired: false,
      derivativesAllowed: true,
      redistributionAllowed: true,
      sourceVerifiedAt: "2026-07-27",
      summary: "상업 작품 사용과 수정·재배포가 가능합니다.",
    },
    includedItems: [
      {
        id: "asset-classroom",
        name: "햇살 교실",
        kind: "vector-asset",
        format: "image/svg+xml",
        contentFingerprint: "sha256:test-classroom",
        tags: ["교실", "학교"],
      },
    ],
    changelog: [
      {
        version: "1.2.0",
        releasedAt: "2026-07-27",
        changes: ["모바일 미리보기 개선"],
      },
    ],
    placementPresets: ["current-view", "pointer"],
    availability: {
      catalog: "bundled",
      library: "local-only",
      payment: "unavailable",
      cloudSync: "unavailable",
      exportManifest: "local-only",
    },
    updatedAt: "2026-07-27T00:00:00.000Z",
    ...overrides,
  };
}

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("studio marketplace package filter", () => {
  const packages = [
    marketplacePackage(),
    marketplacePackage({
      id: "pack-brush",
      name: "잉크 브러시",
      category: "브러시",
      tags: ["펜", "잉크"],
      kind: "brush",
      access: "subscription",
      accessLabel: "구독",
      origin: "original-handmade",
      version: "2.0.0",
      packageFingerprint: "sha256:test-brush",
      includedItems: [],
    }),
    marketplacePackage({
      id: "pack-filter",
      name: "선화 필터",
      category: "필터",
      tags: ["선화"],
      kind: "filter",
      access: "paid",
      accessLabel: "유료",
      origin: "explicit-permission",
      version: "1.0.0",
      packageFingerprint: "sha256:test-filter",
      includedItems: [],
    }),
  ];

  it("searches package, creator, tags, formats and included item names", () => {
    expect(filterStudioMarketplacePackages(packages, { query: "햇살 교실" }))
      .toEqual([packages[0]]);
    expect(filterStudioMarketplacePackages(packages, { query: "ToonSpectrum" }))
      .toHaveLength(3);
    expect(filterStudioMarketplacePackages(packages, { query: "image/svg+xml" }))
      .toHaveLength(3);
  });

  it("intersects multi-category, kind, access and origin filters", () => {
    expect(filterStudioMarketplacePackages(packages, {
      categories: ["브러시", "현대 배경"],
      kinds: ["brush"],
      access: ["subscription", "free"],
      origins: ["original-handmade"],
    })).toEqual([packages[1]]);
  });

  it("supports local library and update-only views without pretending to sync", () => {
    const installed = [{
      packageId: "pack-everyday",
      version: "1.0.0",
      packageFingerprint: "sha256:old",
      addedAt: "2026-07-01T00:00:00.000Z",
    }];
    expect(filterStudioMarketplacePackages(packages, {
      libraryOnly: true,
      libraryPackageIds: ["pack-everyday"],
    })).toEqual([packages[0]]);
    expect(filterStudioMarketplacePackages(packages, {
      updateOnly: true,
      installed,
    })).toEqual([packages[0]]);
  });
});

describe("studio marketplace local library", () => {
  it("loads fail-closed from malformed or unsupported local data", () => {
    const storage = new MemoryStorage();
    storage.setItem(STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY, "{broken");
    expect(loadStudioMarketplaceLibrary(storage).packages).toEqual([]);
    storage.setItem(STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY, JSON.stringify({
      version: 99,
      packages: [],
    }));
    expect(loadStudioMarketplaceLibrary(storage).packages).toEqual([]);
  });

  it("deduplicates package IDs, persists, updates and removes local entries", () => {
    const storage = new MemoryStorage();
    const initial: StudioMarketplaceLibraryState = { version: 1, packages: [] };
    const first = cloneStudioMarketplacePackageToLibrary(
      initial,
      marketplacePackage({ version: "1.0.0" }),
      "2026-07-01T00:00:00.000Z"
    );
    const updated = cloneStudioMarketplacePackageToLibrary(
      first,
      marketplacePackage(),
      "2026-07-27T00:00:00.000Z"
    );
    expect(updated.packages).toHaveLength(1);
    expect(updated.packages[0]?.version).toBe("1.2.0");
    expect(saveStudioMarketplaceLibrary(storage, updated)).toBe(true);
    expect(loadStudioMarketplaceLibrary(storage)).toEqual(updated);
    expect(removeStudioMarketplacePackageFromLibrary(updated, "pack-everyday").packages)
      .toEqual([]);
  });

  it("merges the latest write-time snapshot and preserves explicit removals", () => {
    const storage = new MemoryStorage();
    const stale: StudioMarketplaceLibraryState = {
      version: 1,
      packages: [{
        packageId: "pack-a",
        version: "1.0.0",
        packageFingerprint: "sha256:a",
        addedAt: "2026-07-26T00:00:00.000Z",
      }],
    };
    storage.setItem(STUDIO_MARKETPLACE_LIBRARY_STORAGE_KEY, JSON.stringify({
      version: 1,
      packages: [
        ...stale.packages,
        {
          packageId: "pack-from-another-tab",
          version: "1.0.0",
          packageFingerprint: "sha256:other",
          addedAt: "2026-07-26T00:01:00.000Z",
        },
      ],
    }));

    expect(saveStudioMarketplaceLibrary(storage, stale)).toBe(true);
    expect(loadStudioMarketplaceLibrary(storage).packages.map((entry) => entry.packageId))
      .toEqual(["pack-a", "pack-from-another-tab"]);

    expect(saveStudioMarketplaceLibrary(storage, {
      version: 1,
      packages: loadStudioMarketplaceLibrary(storage).packages.filter(
        (entry) => entry.packageId !== "pack-a",
      ),
    }, {
      removedPackageIds: ["pack-a"],
    })).toBe(true);
    expect(loadStudioMarketplaceLibrary(storage).packages.map((entry) => entry.packageId))
      .toEqual(["pack-from-another-tab"]);
  });
});

describe("studio marketplace import and manifest", () => {
  it("compares semantic versions and handles duplicate/update/conflict/downgrade", () => {
    expect(compareStudioMarketplaceVersions("1.10.0", "1.2.9")).toBe(1);
    expect(compareStudioMarketplaceVersions("1.2", "1.2.0")).toBe(0);

    const pkg = marketplacePackage();
    expect(resolveStudioMarketplaceImport(pkg, null).status).toBe("new");
    expect(resolveStudioMarketplaceImport(pkg, {
      packageId: pkg.id,
      version: pkg.version,
      packageFingerprint: pkg.packageFingerprint,
      addedAt: pkg.updatedAt,
    }).status).toBe("duplicate");
    expect(resolveStudioMarketplaceImport(pkg, {
      packageId: pkg.id,
      version: "1.0.0",
      packageFingerprint: "sha256:old",
      addedAt: pkg.updatedAt,
    }).status).toBe("update");
    expect(resolveStudioMarketplaceImport(pkg, {
      packageId: pkg.id,
      version: pkg.version,
      packageFingerprint: "sha256:different",
      addedAt: pkg.updatedAt,
    }).recommendedAction).toBe("clone");
    expect(resolveStudioMarketplaceImport(pkg, {
      packageId: pkg.id,
      version: "2.0.0",
      packageFingerprint: "sha256:newer",
      addedAt: pkg.updatedAt,
    }).recommendedAction).toBe("block");
  });

  it("follows SemVer prerelease precedence and ignores build metadata", () => {
    const precedence = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let index = 1; index < precedence.length; index += 1) {
      expect(compareStudioMarketplaceVersions(
        precedence[index]!,
        precedence[index - 1]!,
      )).toBe(1);
    }
    expect(compareStudioMarketplaceVersions("1.0.0-alpha.1", "1.0.0-alpha.beta"))
      .toBe(-1);
    expect(compareStudioMarketplaceVersions("1.0.0+build.7", "1.0.0+build.11"))
      .toBe(0);
    expect(compareStudioMarketplaceVersions("1.0.0-rc.1+sha.a", "1.0.0-rc.1+sha.b"))
      .toBe(0);
  });

  it("treats a stable release as an update from prerelease and blocks the reverse downgrade", () => {
    const stable = marketplacePackage({ version: "1.2.0" });
    expect(resolveStudioMarketplaceImport(stable, {
      packageId: stable.id,
      version: "1.2.0-rc.1",
      packageFingerprint: "sha256:release-candidate",
      addedAt: stable.updatedAt,
    }).status).toBe("update");

    const releaseCandidate = marketplacePackage({ version: "1.2.0-rc.1" });
    expect(resolveStudioMarketplaceImport(releaseCandidate, {
      packageId: releaseCandidate.id,
      version: "1.2.0",
      packageFingerprint: "sha256:stable",
      addedAt: releaseCandidate.updatedAt,
    })).toMatchObject({
      status: "downgrade-blocked",
      recommendedAction: "block",
    });
  });

  it("keeps the original entry and creates a deterministic ID for same-version conflicts", () => {
    const pkg = marketplacePackage();
    const original: StudioMarketplaceLibraryState = {
      version: 1,
      packages: [{
        packageId: pkg.id,
        version: pkg.version,
        packageFingerprint: "sha256:different",
        addedAt: "2026-07-26T00:00:00.000Z",
      }],
    };

    const first = cloneStudioMarketplacePackageToLibrary(
      original,
      pkg,
      "2026-07-26T01:00:00.000Z",
    );
    const second = cloneStudioMarketplacePackageToLibrary(
      first,
      pkg,
      "2026-07-26T02:00:00.000Z",
    );
    const cloneId = createStudioMarketplaceConflictCloneId(pkg);

    expect(first.packages.map((entry) => entry.packageId)).toEqual([
      cloneId,
      pkg.id,
    ]);
    expect(second.packages).toHaveLength(2);
    expect(second.packages.find((entry) => entry.packageId === pkg.id)?.packageFingerprint)
      .toBe("sha256:different");
    expect(cloneId).toContain("~conflict-");
    expect(cloneId.length).toBeLessThanOrEqual(160);
  });

  it("exports metadata-only local manifests with rights and compatibility", () => {
    const manifest = createStudioMarketplaceShareManifest(
      marketplacePackage(),
      "2026-07-27T09:00:00.000Z"
    );
    expect(manifest.localOnly).toBe(true);
    expect(manifest.contentIncluded).toBe(false);
    expect(manifest.package.license.redistributionAllowed).toBe(true);
    expect(manifest.package.includedItems).toHaveLength(1);
    expect(manifest.notice).toContain("구매 파일");
  });
});

describe("studio marketplace runtime compatibility", () => {
  it("blocks resources that require a newer Studio version with actionable Korean copy", () => {
    const decision = evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "2.0.0",
      currentStudioVersion: "1.4.3",
      declaredEngines: ["canvas2d"],
      supportedEngines: ["canvas2d"],
    });

    expect(decision).toMatchObject({
      status: "unsupported",
      verified: true,
      code: "studio-version-too-old",
    });
    expect(decision.reason).toContain("Studio 2.0.0 이상");
    expect(decision.reason).toContain("현재 버전은 1.4.3");
    expect(decision.reason).toContain("업데이트");
  });

  it("accepts a stable Studio for a prerelease minimum and a measured engine intersection", () => {
    expect(evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.5.0-rc.2+publisher.7",
      currentStudioVersion: "1.5.0+studio.12",
      declaredEngines: ["webgpu", "canvas2d"],
      supportedEngines: ["canvas2d"],
    })).toEqual({
      status: "compatible",
      verified: true,
      code: "compatible",
      reason: null,
    });
  });

  it("isolates inconclusive optional engines without erasing proven alternatives", () => {
    const partialContext = {
      minimumStudioVersion: "1.0.0",
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d"],
      unverifiedEngines: ["webgpu"],
    } as const;

    expect(evaluateStudioMarketplaceCompatibility({
      ...partialContext,
      declaredEngines: ["canvas2d"],
    })).toEqual({
      status: "compatible",
      verified: true,
      code: "compatible",
      reason: null,
    });
    expect(evaluateStudioMarketplaceCompatibility({
      ...partialContext,
      declaredEngines: ["canvas2d", "webgpu"],
    })).toMatchObject({ status: "compatible", code: "compatible" });

    const unverified = evaluateStudioMarketplaceCompatibility({
      ...partialContext,
      declaredEngines: ["webgpu"],
    });
    expect(unverified).toMatchObject({
      status: "unverified",
      verified: false,
      code: "engine-capabilities-unavailable",
    });
    expect(unverified.reason).toContain("WebGPU");
    expect(unverified.reason).toContain("다시 확인");

    expect(evaluateStudioMarketplaceCompatibility({
      ...partialContext,
      declaredEngines: ["webgl2"],
    })).toMatchObject({
      status: "unsupported",
      verified: true,
      code: "engine-unavailable",
    });
  });

  it("blocks a measured engine mismatch and distinguishes missing runtime sources", () => {
    const unsupported = evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.0.0",
      currentStudioVersion: "1.0.0",
      declaredEngines: ["webgpu"],
      supportedEngines: ["canvas2d", "webgl2"],
    });
    expect(unsupported).toMatchObject({
      status: "unsupported",
      code: "engine-unavailable",
    });
    expect(unsupported.reason).toContain("WebGPU");
    expect(unsupported.reason).toContain("그래픽 드라이버");

    const unverified = evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.0.0",
      declaredEngines: ["canvas2d"],
    });
    expect(unverified).toMatchObject({
      status: "unverified",
      verified: false,
      code: "compatibility-sources-unavailable",
    });
    expect(unverified.reason).toContain("권위 있는 값이 없어");
  });

  it("fails closed when supplied version or manifest compatibility data is invalid", () => {
    expect(evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.0",
      currentStudioVersion: "1.0.0",
      declaredEngines: ["canvas2d"],
    })).toMatchObject({
      status: "unsupported",
      code: "minimum-version-invalid",
    });
    expect(evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.0.0-01",
      currentStudioVersion: "1.0.0",
      declaredEngines: ["canvas2d"],
    })).toMatchObject({
      status: "unsupported",
      code: "minimum-version-invalid",
    });
    expect(evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.0.0",
      currentStudioVersion: "",
      declaredEngines: ["canvas2d"],
    })).toMatchObject({
      status: "unsupported",
      code: "current-version-invalid",
    });
    expect(evaluateStudioMarketplaceCompatibility({
      minimumStudioVersion: "1.0.0",
      currentStudioVersion: "1.0.0",
      declaredEngines: [],
    })).toMatchObject({
      status: "unsupported",
      code: "declared-engines-invalid",
    });
  });
});

describe("studio marketplace deterministic publish-rights gate", () => {
  it("allows owned original work with no marketplace derivative", () => {
    const decision = evaluateStudioMarketplacePublishRights({
      origin: "original-procedural",
      creatorOwnsRights: true,
      containsThirdPartyContent: false,
      recognizableMarketplaceDerivative: false,
      redistributionPermission: true,
    });
    expect(decision.allowed).toBe(true);
    expect(decision.checks.every((check) => check.passed)).toBe(true);
  });

  it("requires a source and redistribution evidence for permissive material", () => {
    const denied = evaluateStudioMarketplacePublishRights({
      origin: "permissive",
      creatorOwnsRights: true,
      containsThirdPartyContent: true,
      recognizableMarketplaceDerivative: false,
      redistributionPermission: true,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.checks.find((check) => check.id === "source")?.passed).toBe(false);
    expect(denied.checks.find((check) => check.id === "redistribution")?.passed).toBe(false);

    const allowed = evaluateStudioMarketplacePublishRights({
      origin: "permissive",
      creatorOwnsRights: true,
      containsThirdPartyContent: true,
      recognizableMarketplaceDerivative: false,
      redistributionPermission: true,
      sourceReference: "https://example.test/license",
      permissionEvidence: "License permits redistribution of source files.",
    });
    expect(allowed.allowed).toBe(true);
  });

  it("always rejects recognizable derivatives of marketplace products", () => {
    const decision = evaluateStudioMarketplacePublishRights({
      origin: "explicit-permission",
      creatorOwnsRights: true,
      containsThirdPartyContent: true,
      recognizableMarketplaceDerivative: true,
      redistributionPermission: true,
      sourceReference: "creator agreement",
      permissionEvidence: "redistribution grant",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.checks.find((check) => check.id === "marketplace-derivative"))
      .toMatchObject({ passed: false });
  });
});
