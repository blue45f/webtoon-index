import { describe, expect, it } from "vitest";

import {
  STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID,
} from "./bg3d/studio-bg3d-procedural-starter-pack";
import { DEFAULT_STUDIO_BRUSH_SNAPSHOT } from "./brush/studio-brush-library";
import {
  createStudioCommunityPublishManifest,
  isStudioCommunityShareableLocalResourceId,
  listStudioCommunityShareCandidates,
  projectCreatorMarketplaceRecordToAssets,
  projectCreatorMarketplaceRecordToStudioPack,
  studioCommunityShareCandidateIdentity,
  studioCommunityShareCandidateLegacyIdentity,
  studioCommunityShareCandidatePackageId,
} from "./studio-community-marketplace";
import { validateStudioCreatorPack } from "./studio-creator-pack-runtime";

import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceRecord,
} from "@/shared/lib/creator-marketplace-resource-contract";

function record(
  kind: CreatorMarketplaceResourceKind,
  definition: Record<string, CreatorMarketplaceJsonValue>,
  options: {
    mode?: "portable-json" | "procedural-recipe";
    entryName?: string;
    minimumStudioVersion?: string;
    engines?: CreatorMarketplaceResourceRecord["compatibility"]["engines"];
  } = {},
): CreatorMarketplaceResourceRecord {
  const mode = options.mode
    ?? (kind === "asset" || kind === "3d-preset"
      ? "procedural-recipe"
      : "portable-json");
  const runtime = {
    asset: "studio-procedural-asset-v1",
    brush: "studio-brush-v1",
    filter: "studio-filter-v1",
    palette: "studio-palette-v1",
    template: "studio-template-v1",
    "3d-preset": "studio-bg3d-preset-v1",
    "3d-asset": "studio-3d-asset-v1",
  } as const;
  const mediaType = {
    asset: "application/vnd.toonspectrum.asset+json",
    brush: "application/vnd.toonspectrum.brush+json",
    filter: "application/vnd.toonspectrum.filter+json",
    palette: "application/vnd.toonspectrum.palette+json",
    template: "application/vnd.toonspectrum.template+json",
    "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
    "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
  } as const;
  return {
    schemaVersion: 1,
    id: "123e4567-e89b-42d3-a456-426614174000",
    packageId: `community/${kind}/fixture`,
    name: `${kind} 공유 팩`,
    description: "테스트 공유 팩",
    kind,
    resourceVersion: "1.0.0",
    minimumStudioVersion: options.minimumStudioVersion ?? "1.0.0",
    tags: [kind],
    license: "cc0-1.0",
    attributionText: "",
    containsAi: false,
    provenance: { origin: "original", authoredByPublisher: true },
    compatibility: { engines: options.engines ?? ["canvas2d"] },
    entries: [{
      id: `${kind}/fixture`,
      kind,
      name: options.entryName ?? `${kind} 항목`,
      delivery: {
        mode,
        mediaType: mediaType[kind],
        payload: {
          schemaVersion: 1,
          resourceKind: kind,
          runtime: runtime[kind],
          definition,
        },
        byteSize: 120,
        sha256: "a".repeat(64),
      },
    }],
    manifestHash: "b".repeat(64),
    manifestByteSize: 500,
    publisher: { id: "artist-1", name: "테스트 작가", avatar: null },
    createdAt: "2026-07-26T01:00:00.000Z",
    updatedAt: "2026-07-26T01:00:00.000Z",
    isOwner: false,
    access: "free",
  };
}

describe("studio community marketplace projection", () => {
  it("portable brush/filter/palette record를 실제 로컬 설치 팩으로 투영한다", () => {
    const brushRecord = record("brush", {
      snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
    });
    const projection = projectCreatorMarketplaceRecordToStudioPack(brushRecord);

    expect(projection.status).toBe("installable");
    if (projection.status !== "installable") return;
    expect(projection.pack.metadata).toMatchObject({
      id: expect.stringMatching(/^community:[0-9a-f]{64}$/u),
      name: "brush 공유 팩",
      kind: "brush",
      access: "free",
      packageFingerprint: brushRecord.manifestHash,
    });
    expect(projection.pack.entries[0]).toMatchObject({
      kind: "brush",
      delivery: {
        mode: "portable-json",
        definition: { snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT },
      },
    });
    expect(projection.pack.marketplaceSource).toEqual({
      schema: "creator-marketplace-resource-v1",
      releaseId: brushRecord.id,
      publisherId: brushRecord.publisher.id,
      packageId: brushRecord.packageId,
    });
    expect(validateStudioCreatorPack(projection.pack)).toMatchObject({
      valid: true,
    });
  });

  it("같은 배급자·packageId의 불변 릴리스는 같은 설치 슬롯을 쓰고 다른 배급자는 격리한다", () => {
    const firstRelease = record("brush", {
      snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
    });
    const nextRelease = {
      ...firstRelease,
      id: "223e4567-e89b-42d3-a456-426614174000",
      resourceVersion: "2.0.0",
      manifestHash: "c".repeat(64),
    } satisfies CreatorMarketplaceResourceRecord;
    const otherPublisherRelease = {
      ...nextRelease,
      publisher: { ...nextRelease.publisher, id: "artist/2" },
    } satisfies CreatorMarketplaceResourceRecord;
    const legacyPrerelease = {
      ...firstRelease,
      id: "323e4567-e89b-42d3-a456-426614174000",
      resourceVersion: "1.0.0-01",
      minimumStudioVersion: "1.0.0-02",
    } satisfies CreatorMarketplaceResourceRecord;

    const first = projectCreatorMarketplaceRecordToStudioPack(firstRelease);
    const next = projectCreatorMarketplaceRecordToStudioPack(nextRelease);
    const other = projectCreatorMarketplaceRecordToStudioPack(otherPublisherRelease);
    const legacy = projectCreatorMarketplaceRecordToStudioPack(legacyPrerelease);

    expect(first.status).toBe("installable");
    expect(next.status).toBe("installable");
    expect(other.status).toBe("installable");
    if (
      first.status !== "installable"
      || next.status !== "installable"
      || other.status !== "installable"
      || legacy.status !== "installable"
    ) return;
    expect(next.pack.metadata.id).toBe(first.pack.metadata.id);
    expect(next.pack.metadata.version).toBe("2.0.0");
    expect(next.pack.metadata.packageFingerprint).toBe("c".repeat(64));
    expect(other.pack.metadata.id).not.toBe(first.pack.metadata.id);
    expect(other.pack.metadata.id).toMatch(/^community:[0-9a-f]{64}$/u);
    expect(legacy.pack.metadata.id).toBe(first.pack.metadata.id);
    expect(legacy.pack.metadata.version).toBe("1.0.0-1");
    expect(legacy.pack.metadata.compatibility.studioVersion).toBe("1.0.0-2");
    expect(legacy.pack.metadata.changelog[0]?.version).toBe("1.0.0-1");
    expect(legacyPrerelease.resourceVersion).toBe("1.0.0-01");
    expect(legacyPrerelease.minimumStudioVersion).toBe("1.0.0-02");
  });

  it("권위 있는 현재 Studio 버전보다 높은 minimumStudioVersion은 설치·에셋 투영을 막는다", () => {
    const packProjection = projectCreatorMarketplaceRecordToStudioPack(
      record("brush", {
        snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
      }, {
        minimumStudioVersion: "2.0.0",
      }),
      {
        currentStudioVersion: "1.9.9",
        supportedEngines: ["canvas2d"],
      },
    );
    expect(packProjection).toMatchObject({
      status: "unsupported",
      pack: null,
    });
    expect(packProjection.reason).toContain("Studio 2.0.0 이상");
    expect(packProjection.reason).toContain("현재 버전은 1.9.9");

    const assetProjection = projectCreatorMarketplaceRecordToAssets(
      record("asset", { recipeId: "original-sunlit-classroom" }, {
        minimumStudioVersion: "2.0.0",
      }),
      {
        currentStudioVersion: "1.9.9",
        supportedEngines: ["canvas2d"],
      },
    );
    expect(assetProjection).toMatchObject({
      assets: [],
      unsupportedCount: 1,
    });
    expect(assetProjection.reason).toContain("Studio를 업데이트");
  });

  it("측정된 기기 엔진과 manifest 엔진이 겹치지 않으면 구체적인 복구 문구로 차단한다", () => {
    const unsupported = projectCreatorMarketplaceRecordToStudioPack(
      record("3d-preset", { recipeId: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID }, {
        engines: ["webgpu"],
      }),
      {
        currentStudioVersion: "1.0.0",
        supportedEngines: ["canvas2d", "webgl2"],
      },
    );

    expect(unsupported).toMatchObject({ status: "unsupported", pack: null });
    expect(unsupported.reason).toContain("WebGPU");
    expect(unsupported.reason).toContain("브라우저와 그래픽 드라이버");

    const supported = projectCreatorMarketplaceRecordToStudioPack(
      record("3d-preset", { recipeId: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID }, {
        engines: ["webgpu", "webgl2"],
      }),
      {
        currentStudioVersion: "1.0.0",
        supportedEngines: ["webgl2"],
      },
    );
    expect(supported.status).toBe("installable");
  });

  it("선택적 WebGPU 측정 실패가 확인된 Canvas 패키지까지 전역 차단하지 않는다", () => {
    const partialContext = {
      currentStudioVersion: "1.0.0",
      supportedEngines: ["canvas2d"] as const,
      unverifiedEngines: ["webgpu"] as const,
    };
    const canvasProjection = projectCreatorMarketplaceRecordToStudioPack(
      record("brush", {
        snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
      }, {
        engines: ["canvas2d"],
      }),
      partialContext,
    );
    expect(canvasProjection.status).toBe("installable");

    const webGpuProjection = projectCreatorMarketplaceRecordToStudioPack(
      record("3d-preset", { recipeId: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID }, {
        engines: ["webgpu"],
      }),
      partialContext,
    );
    expect(webGpuProjection).toMatchObject({ status: "unsupported", pack: null });
    expect(webGpuProjection.reason).toContain("WebGPU");
    expect(webGpuProjection.reason).toContain("측정을 완료하지 못해");

    const knownUnavailableProjection = projectCreatorMarketplaceRecordToStudioPack(
      record("3d-preset", { recipeId: STUDIO_BG3D_PROCEDURAL_STARTER_PACK_ID }, {
        engines: ["webgl2"],
      }),
      partialContext,
    );
    expect(knownUnavailableProjection).toMatchObject({ status: "unsupported", pack: null });
    expect(knownUnavailableProjection.reason).toContain("그래픽 드라이버");
  });

  it("로컬에 실제 존재하는 template recipe만 내장 참조로 승격한다", () => {
    const supported = projectCreatorMarketplaceRecordToStudioPack(
      record("template", { templateId: "confession" }),
    );
    const unsupported = projectCreatorMarketplaceRecordToStudioPack(
      record("template", { templateId: "missing-template" }),
    );

    expect(supported.status).toBe("installable");
    if (supported.status === "installable") {
      expect(supported.pack.entries[0]).toMatchObject({
        delivery: {
          mode: "builtin-ref",
          runtimeRef: "studio-scene-template:confession",
        },
      });
    }
    expect(unsupported).toMatchObject({
      status: "unsupported",
      pack: null,
    });
  });

  it("2D recipe는 검증된 원본 procedural asset allowlist와 일치할 때만 삽입 대상으로 투영한다", () => {
    const supported = projectCreatorMarketplaceRecordToAssets(
      record("asset", { recipeId: "original-sunlit-classroom" }),
    );
    const unsupported = projectCreatorMarketplaceRecordToAssets(
      record("asset", { recipeId: "unknown-commercial-copy" }),
    );

    expect(supported).toMatchObject({
      unsupportedCount: 0,
      reason: null,
    });
    expect(supported.assets.map((asset) => asset.id)).toEqual([
      "original-sunlit-classroom",
    ]);
    expect(unsupported).toMatchObject({
      assets: [],
      unsupportedCount: 1,
    });
  });

  it("저장된 브러시·필터·팔레트를 게시 가능한 최소 portable definition으로 정리한다", () => {
    const candidates = listStudioCommunityShareCandidates({
      brushes: [{
        ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
        id: "brush-1",
        name: "내 펜",
        createdAt: 1,
        updatedAt: 2,
        pinned: false,
        lastUsedAt: null,
      }],
      filters: [{
        id: "filter-1",
        packageId: "pack-1",
        entryId: "entry-1",
        name: "내 비네트",
        engine: "vignette",
        values: { darkness: 35, size: 45, roundness: 100, feather: 60 },
        installedAt: 1,
        updatedAt: 2,
      }],
      palettes: [{
        id: "palette-1",
        name: "내 색",
        createdAt: 1,
        updatedAt: 2,
        colors: ["#AABBCC", "#aabbcc", "#112233"],
      }],
    });

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "brush",
      "filter",
      "palette",
    ]);
    expect(candidates[0]?.definition).toHaveProperty("snapshot.brushId");
    expect(candidates[0]?.definition).not.toHaveProperty("snapshot.id");
    expect(candidates[2]?.definition).toEqual({
      colors: ["#aabbcc", "#112233"],
    });
  });

  it("마켓·Creator Pack에서 설치된 세 종류는 출처를 원본으로 세탁하지 않고 게시 후보에서 제외한다", () => {
    const installedPrefix = "creator-pack:community:resource-1";
    const candidates = listStudioCommunityShareCandidates({
      brushes: [
        {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          id: `${installedPrefix}:brush/ink`,
          name: "설치 브러시",
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          lastUsedAt: null,
        },
        {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          id: "duplicated-installed-brush",
          sourcePresetId: `${installedPrefix}:brush/ink`,
          name: "복제한 설치 브러시",
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          lastUsedAt: null,
        },
        {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          id: "builtin-derived-brush",
          sourcePresetId: "essentials:rough-pencil",
          name: "내장 프리셋 기반 브러시",
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          lastUsedAt: null,
        },
        {
          ...DEFAULT_STUDIO_BRUSH_SNAPSHOT,
          id: "creator-brush-1",
          name: "직접 만든 브러시",
          createdAt: 1,
          updatedAt: 2,
          pinned: false,
          lastUsedAt: null,
        },
      ],
      filters: [
        {
          id: `${installedPrefix}:filter/duotone`,
          packageId: "community:resource-1",
          entryId: "filter/duotone",
          name: "설치 필터",
          engine: "duotone",
          values: { shadow: "#111111", highlight: "#eeeeee" },
          installedAt: 1,
          updatedAt: 2,
        },
        {
          id: "my-creator-pack-inspired-filter",
          packageId: "local",
          entryId: "filter/local",
          name: "직접 만든 필터",
          engine: "duotone",
          values: { shadow: "#222222", highlight: "#dddddd" },
          installedAt: 1,
          updatedAt: 2,
        },
      ],
      palettes: [
        {
          id: `${installedPrefix}:palette/neon`,
          name: "설치 팔레트",
          createdAt: 1,
          updatedAt: 2,
          colors: ["#112233"],
        },
        {
          id: "palette-creator-pack-study",
          name: "직접 만든 팔레트",
          createdAt: 1,
          updatedAt: 2,
          colors: ["#445566"],
        },
      ],
    });

    expect(candidates.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "builtin-derived-brush", kind: "brush" },
      { id: "creator-brush-1", kind: "brush" },
      { id: "my-creator-pack-inspired-filter", kind: "filter" },
      { id: "palette-creator-pack-study", kind: "palette" },
    ]);
    expect(isStudioCommunityShareableLocalResourceId(" CREATOR-PACK:community:x ")).toBe(false);
    expect(isStudioCommunityShareableLocalResourceId("my-creator-pack:study")).toBe(true);
    expect(isStudioCommunityShareableLocalResourceId("   ")).toBe(false);
  });

  it("직접 제작 확인을 전제로 결정적인 무료 공유 manifest를 만든다", async () => {
    const candidate = listStudioCommunityShareCandidates({
      brushes: [],
      filters: [],
      palettes: [{
        id: "palette-1",
        name: "야간 팔레트",
        createdAt: 1,
        updatedAt: 2,
        colors: ["#111827", "#f8fafc"],
      }],
    })[0]!;

    const left = await createStudioCommunityPublishManifest(candidate, {
      resourceVersion: "1.2.0-rc.1+sha.7",
      description: "직접 만든 야간 색 조합",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: false,
    });
    const right = await createStudioCommunityPublishManifest(candidate, {
      resourceVersion: "1.2.0-rc.1+sha.7",
      description: "직접 만든 야간 색 조합",
      license: "cc0-1.0",
      attributionText: "",
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: false,
    });

    expect(left).toEqual(right);
    expect(left.packageId).toBe(studioCommunityShareCandidatePackageId(candidate));
    expect(left).toMatchObject({
      packageId: expect.stringMatching(/^community\/palette\/v2-[0-9a-f]{64}$/u),
      resourceVersion: "1.2.0-rc.1+sha.7",
      minimumStudioVersion: "1.0.0",
      kind: "palette",
      rightsConfirmed: true,
      provenance: { origin: "original", authoredByPublisher: true },
      license: "cc0-1.0",
      containsAi: false,
      entries: [{
        kind: "palette",
        delivery: {
          mode: "portable-json",
          payload: {
            definition: { colors: ["#111827", "#f8fafc"] },
          },
        },
      }],
    });
  });

  it("후보 packageId를 릴리스와 무관하게 안정적으로 계산하고 notes 공백은 이전 bytes에서 생략한다", async () => {
    const candidate = listStudioCommunityShareCandidates({
      brushes: [],
      filters: [],
      palettes: [{
        id: "palette-stable",
        name: "안정 팔레트",
        createdAt: 1,
        updatedAt: 2,
        colors: ["#111827"],
      }],
    })[0]!;
    const base = {
      resourceVersion: "1.0.0",
      license: "cc0-1.0" as const,
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: false,
    };

    expect(studioCommunityShareCandidatePackageId(candidate)).toMatch(
      /^community\/palette\/v2-[0-9a-f]{64}$/u,
    );
    expect(studioCommunityShareCandidatePackageId(candidate)).toBe(
      studioCommunityShareCandidatePackageId({ ...candidate }),
    );
    expect(studioCommunityShareCandidatePackageId({ ...candidate, kind: "brush" }))
      .not.toBe(studioCommunityShareCandidatePackageId(candidate));

    const withoutNotes = await createStudioCommunityPublishManifest(candidate, base);
    const whitespaceNotes = await createStudioCommunityPublishManifest(candidate, {
      ...base,
      releaseNotes: "  \n  ",
    });
    const withNotes = await createStudioCommunityPublishManifest(candidate, {
      ...base,
      releaseNotes: "  색 대비 개선  ",
    });

    expect(whitespaceNotes).toEqual(withoutNotes);
    expect(whitespaceNotes).not.toHaveProperty("releaseNotes");
    expect(withNotes.releaseNotes).toBe("색 대비 개선");
  });

  it("legacy FNV 충돌 후보를 v2 SHA-256 identity로 격리하고 기존 package는 명시적으로 연속 게시한다", async () => {
    const left = {
      id: "candidate-30009",
      kind: "brush" as const,
      name: "왼쪽 브러시",
      definition: {
        snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
      },
    };
    const right = {
      id: "candidate-233044",
      kind: "brush" as const,
      name: "오른쪽 브러시",
      definition: {
        snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
      },
    };
    const base = {
      resourceVersion: "2.0.0",
      license: "cc0-1.0" as const,
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: false,
    };

    expect(studioCommunityShareCandidateLegacyIdentity(left).packageId).toBe(
      studioCommunityShareCandidateLegacyIdentity(right).packageId,
    );
    expect(studioCommunityShareCandidateIdentity(left).packageId).not.toBe(
      studioCommunityShareCandidateIdentity(right).packageId,
    );

    const fresh = await createStudioCommunityPublishManifest(left, base);
    const legacyIdentity = studioCommunityShareCandidateLegacyIdentity(left);
    const legacyContinuation = await createStudioCommunityPublishManifest(left, {
      ...base,
      resolvedIdentity: legacyIdentity,
    });
    expect(fresh.packageId).toBe(studioCommunityShareCandidateIdentity(left).packageId);
    expect(fresh.entries[0]?.id).toBe(studioCommunityShareCandidateIdentity(left).entryId);
    expect(legacyContinuation.packageId).toBe(legacyIdentity.packageId);
    expect(legacyContinuation.entries[0]?.id).toBe(legacyIdentity.entryId);

    await expect(createStudioCommunityPublishManifest(left, {
      ...base,
      resolvedIdentity: {
        scheme: "v2",
        packageId: studioCommunityShareCandidateIdentity(right).packageId,
        entryId: studioCommunityShareCandidateIdentity(right).entryId,
      },
    })).rejects.toThrow("package identity");
  });

  it("제품 컨텍스트가 부분 측정이면 호환됨으로 추측하지 않는다", () => {
    const brushRecord = record("brush", {
      snapshot: DEFAULT_STUDIO_BRUSH_SNAPSHOT as unknown as CreatorMarketplaceJsonValue,
    });

    const projection = projectCreatorMarketplaceRecordToStudioPack(
      brushRecord,
      {
        currentStudioVersion: "1.0.0",
        supportedEngines: null,
      },
    );

    expect(projection).toMatchObject({ status: "unsupported", pack: null });
    expect(projection.reason).toContain("권위 있는 측정값이 없어");
  });

  it("권리 미확인 또는 타 마켓 식별 가능한 변형은 manifest 생성 경계에서 거부한다", async () => {
    const candidate = listStudioCommunityShareCandidates({
      brushes: [],
      filters: [],
      palettes: [{
        id: "palette-1",
        name: "팔레트",
        createdAt: 1,
        updatedAt: 2,
        colors: ["#111827"],
      }],
    })[0]!;

    await expect(createStudioCommunityPublishManifest(candidate, {
      resourceVersion: "1.0.0",
      license: "toonspectrum-standard",
      containsAi: false,
      creatorOwnsRights: false,
      recognizableMarketplaceDerivative: false,
    })).rejects.toThrow("권리");
    await expect(createStudioCommunityPublishManifest(candidate, {
      resourceVersion: "1.0.0",
      license: "toonspectrum-standard",
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: true,
    })).rejects.toThrow("다른 마켓");

    await expect(createStudioCommunityPublishManifest(candidate, {
      resourceVersion: "1.0.0-01",
      license: "toonspectrum-standard",
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: false,
    })).rejects.toThrow("SemVer");

    await expect(createStudioCommunityPublishManifest({
      ...candidate,
      id: "creator-pack:community:resource-1:palette/night",
    }, {
      resourceVersion: "1.0.0",
      license: "cc0-1.0",
      containsAi: false,
      creatorOwnsRights: true,
      recognizableMarketplaceDerivative: false,
    })).rejects.toThrow("다시 공유할 수 없습니다");
  });
});
