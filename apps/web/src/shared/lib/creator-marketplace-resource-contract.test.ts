import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND,
  CREATOR_MARKETPLACE_RESOURCE_KINDS,
  CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS,
  CREATOR_MARKETPLACE_RUNTIME_BY_KIND,
  CreatorMarketplaceOwnedHeadPageSchema,
  CreatorMarketplaceOwnedHistoryPageSchema,
  CreatorMarketplaceOrphanReportDismissReceiptSchema,
  CreatorMarketplacePortablePayloadSchema,
  CreatorMarketplacePublicManifestSchema,
  CreatorMarketplaceResourceHistoryPageSchema,
  CreatorMarketplaceResourceIdentitySchema,
  CreatorMarketplaceResourceManifestSchema,
  CreatorMarketplaceResourceModerationReceiptSchema,
  CreatorMarketplaceResourceModerationQueuePageSchema,
  CreatorMarketplaceResourceRecordSchema,
  CreatorMarketplaceResourceRelistReceiptSchema,
  CreatorMarketplaceResourceReportEvidenceSchema,
  CreatorMarketplaceStoredResourceManifestSchema,
  CreatorMarketplaceSemverSchema,
  canonicalizeCreatorMarketplaceJson,
  creatorMarketplaceJsonByteSize,
} from "./creator-marketplace-resource-contract";

import type {
  CreatorMarketplaceJsonValue,
  CreatorMarketplaceResourceKind,
  CreatorMarketplaceResourceManifest,
} from "./creator-marketplace-resource-contract";

const MEDIA_TYPE_BY_KIND = {
  asset: "application/vnd.toonspectrum.asset+json",
  brush: "application/vnd.toonspectrum.brush+json",
  filter: "application/vnd.toonspectrum.filter+json",
  palette: "application/vnd.toonspectrum.palette+json",
  template: "application/vnd.toonspectrum.template+json",
  "3d-preset": "application/vnd.toonspectrum.3d-preset+json",
  "3d-asset": "application/vnd.toonspectrum.3d-asset+json",
} as const;

function definitionFor(
  kind: CreatorMarketplaceResourceKind
): Record<string, CreatorMarketplaceJsonValue> {
  switch (kind) {
    case "brush":
      return {
        snapshot: {
          presetId: "starter-ink",
          renderer: "perfect-freehand",
          settings: { opacity: 1, size: 7 },
        },
      };
    case "filter":
      return {
        engine: "studio-filter-stack-v1",
        values: { pipeline: ["levels", "halftone"], strength: 0.75 },
      };
    case "palette":
      return { colors: ["#111827", "#ef4444", "#f8fafc"] };
    case "template":
      return { templateId: "webtoon.vertical.basic" };
    case "asset":
      return {
        recipeId: "speech-bubble.rounded",
        parameters: { padding: 24, tail: "bottom" },
      };
    case "3d-preset":
      return {
        recipeId: "background.classroom",
        parameters: { lighting: "day" },
      };
    case "3d-asset":
      return {
        recipeId: "object.desk",
        parameters: { scale: 1 },
      };
  }
}

function hashPayload(payload: Record<string, CreatorMarketplaceJsonValue>): string {
  return createHash("sha256")
    .update(canonicalizeCreatorMarketplaceJson(payload))
    .digest("hex");
}

function manifestFor(
  kind: CreatorMarketplaceResourceKind
): CreatorMarketplaceResourceManifest {
  const payload = {
    schemaVersion: 1 as const,
    resourceKind: kind,
    runtime: ({
      asset: "studio-procedural-asset-v1",
      brush: "studio-brush-v1",
      filter: "studio-filter-v1",
      palette: "studio-palette-v1",
      template: "studio-template-v1",
      "3d-preset": "studio-bg3d-preset-v1",
      "3d-asset": "studio-3d-asset-v1",
    } as const)[kind],
    definition: definitionFor(kind),
  };
  const delivery =
    kind === "asset" || kind === "3d-preset" || kind === "3d-asset"
      ? {
          mode: "procedural-recipe" as const,
          mediaType: MEDIA_TYPE_BY_KIND[kind],
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: hashPayload(payload),
        }
      : {
          mode: "portable-json" as const,
          mediaType: MEDIA_TYPE_BY_KIND[kind],
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: hashPayload(payload),
        };
  return {
    schemaVersion: 1 as const,
    packageId: `original/${kind}/starter`,
    name: `${kind} 시작 팩`,
    description: "직접 제작한 무료 리소스",
    kind,
    resourceVersion: "1.0.0",
    minimumStudioVersion: "0.1.0",
    tags: ["무료", "오리지널"],
    license: "toonspectrum-standard" as const,
    attributionText: "",
    containsAi: false,
    rightsConfirmed: true as const,
    provenance: {
      origin: "original" as const,
      authoredByPublisher: true as const,
    },
    compatibility: { engines: ["canvas2d" as const] },
    entries: [{
      id: `${kind}/starter`,
      kind,
      name: "시작 리소스",
      delivery,
    }],
  } as CreatorMarketplaceResourceManifest;
}

describe("creator marketplace resource manifest contract", () => {
  it("SemVer 2.0 build metadata를 허용하고 숫자 prerelease 선행 0은 거절한다", () => {
    expect(CreatorMarketplaceSemverSchema.safeParse("1.2.3-rc.1+sha.001"))
      .toMatchObject({ success: true, data: "1.2.3-rc.1+sha.001" });
    expect(CreatorMarketplaceSemverSchema.safeParse("1.2.3-rc.01").success)
      .toBe(false);
    expect(CreatorMarketplaceSemverSchema.safeParse("1.2.3+build_1").success)
      .toBe(false);
  });

  it.each(CREATOR_MARKETPLACE_RESOURCE_KINDS)(
    "%s 패키지의 실제 portable/procedural 콘텐츠를 허용한다",
    (kind) => {
      expect(
        CreatorMarketplaceResourceManifestSchema.safeParse(manifestFor(kind)).success
      ).toBe(true);
    }
  );

  it("동일 JSON은 키 순서와 무관하게 같은 canonical body와 크기를 만든다", () => {
    const left = { b: 2, nested: { y: true, x: "a" }, a: 1 };
    const right = { a: 1, nested: { x: "a", y: true }, b: 2 };

    expect(canonicalizeCreatorMarketplaceJson(left)).toBe(
      '{"a":1,"b":2,"nested":{"x":"a","y":true}}'
    );
    expect(canonicalizeCreatorMarketplaceJson(left)).toBe(
      canonicalizeCreatorMarketplaceJson(right)
    );
    expect(creatorMarketplaceJsonByteSize(left)).toBe(
      creatorMarketplaceJsonByteSize(right)
    );
  });

  it("외부 허용 리소스를 자체 표준 사용권으로 재라이선스하지 못하게 한다", () => {
    const manifest = {
      ...manifestFor("brush"),
      provenance: {
        origin: "permissive" as const,
        authoredByPublisher: false as const,
        sourceName: "CC brush recipe",
        sourceUrl: "https://example.com/source",
        sourceLicenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
      },
    };

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("CC BY 계열은 출처 문구를 요구하고 strict extra field를 거절한다", () => {
    const manifest = {
      ...manifestFor("palette"),
      license: "cc-by-4.0" as const,
      attributionText: "",
      copiedCommercialThumbnail: "forbidden",
    };

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it.each([
    ["dataUrl", "data:image/png;base64,AAAA"],
    ["remote", "https://commercial.example/paid.glb"],
    ["blob", "blob:https://example.test/id"],
    ["javascript", "javascript:alert(1)"],
    ["protocolRelative", "//commercial.example/paid.glb"],
    ["windowsShare", "\\\\commercial.example\\paid.glb"],
    ["control", `preset${String.fromCharCode(1)}name`],
  ])("portable JSON의 %s 바이너리·원격 전달을 거절한다", (_label, source) => {
    const manifest = manifestFor("brush");
    const payload = {
      schemaVersion: 1 as const,
      resourceKind: "brush" as const,
      runtime: "studio-brush-v1" as const,
      definition: { snapshot: { source } },
    };
    const invalid = {
      ...manifest,
      entries: [{
        ...manifest.entries[0],
        delivery: {
          ...manifest.entries[0]!.delivery,
          payload,
          byteSize: creatorMarketplaceJsonByteSize(payload),
          sha256: hashPayload(payload),
        },
      }],
    };

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("2D/3D는 portable blob 대용 JSON이 아니라 절차형 recipe나 built-in 참조만 허용한다", () => {
    const manifest = manifestFor("3d-preset");
    const invalid = {
      ...manifest,
      entries: [{
        ...manifest.entries[0],
        delivery: {
          ...manifest.entries[0]!.delivery,
          mode: "portable-json" as const,
        },
      }],
    };

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("종류별 미디어 타입과 실제 canonical byteSize의 불일치를 거절한다", () => {
    const manifest = manifestFor("filter");
    const invalid = {
      ...manifest,
      entries: [{
        ...manifest.entries[0],
        delivery: {
          ...manifest.entries[0]!.delivery,
          mediaType: "application/vnd.toonspectrum.brush+json" as const,
          byteSize: manifest.entries[0]!.delivery.byteSize + 1,
        },
      }],
    };

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("portable payload의 schemaVersion·resourceKind·runtime discriminant를 종류별 강제한다", () => {
    const manifest = manifestFor("palette");
    const invalid = structuredClone(manifest);
    const delivery = invalid.entries[0]!.delivery;
    if (delivery.mode === "builtin-ref") throw new Error("fixture mismatch");
    delivery.payload.resourceKind = "brush";
    delivery.payload.runtime = "studio-brush-v1";
    delivery.byteSize = creatorMarketplaceJsonByteSize(delivery.payload);
    delivery.sha256 = hashPayload(delivery.payload);

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(invalid).success).toBe(false);
  });

  it("브러시·필터·팔레트의 종류별 최소 definition과 exact key를 강제한다", () => {
    const cases: Array<
      [CreatorMarketplaceResourceKind, Record<string, CreatorMarketplaceJsonValue>]
    > = [
      ["brush", { snapshot: {}, extra: true }],
      ["filter", { engine: "studio-filter-stack-v1", values: {} }],
      ["palette", { colors: ["#FFFFFF", "#ffffff"] }],
      ["template", { templateId: "valid", extra: true }],
      ["asset", { parameters: {} }],
      ["3d-preset", { recipeId: "valid", sourceUrl: "https://example.test/a.glb" }],
    ];

    for (const [kind, definition] of cases) {
      const manifest = manifestFor(kind);
      const payload = {
        schemaVersion: 1 as const,
        resourceKind: kind,
        runtime: CREATOR_MARKETPLACE_RUNTIME_BY_KIND[kind],
        definition,
      };
      const delivery = manifest.entries[0]!.delivery;
      if (delivery.mode === "builtin-ref") throw new Error("fixture mismatch");
      delivery.payload = payload as typeof delivery.payload;
      delivery.byteSize = creatorMarketplaceJsonByteSize(payload);
      delivery.sha256 = hashPayload(payload);
      expect(
        CreatorMarketplaceResourceManifestSchema.safeParse(manifest).success,
        `${kind} must reject an invalid definition`
      ).toBe(false);
    }
  });

  it("builtin-ref는 허용 종류와 종류별 안정 prefix를 강제한다", () => {
    for (const kind of ["asset", "template", "3d-preset"] as const) {
      const manifest = manifestFor(kind);
      const runtimeRef = `${CREATOR_MARKETPLACE_BUILTIN_PREFIX_BY_KIND[kind]}starter`;
      manifest.entries[0]!.delivery = {
        mode: "builtin-ref",
        runtimeRef,
        byteSize: 0,
        sha256: hashPayload({ mode: "builtin-ref", runtimeRef }),
      };
      expect(CreatorMarketplaceResourceManifestSchema.safeParse(manifest).success).toBe(true);
    }

    const brush = manifestFor("brush");
    const runtimeRef = "studio-asset:starter";
    brush.entries[0]!.delivery = {
      mode: "builtin-ref",
      runtimeRef,
      byteSize: 0,
      sha256: hashPayload({ mode: "builtin-ref", runtimeRef }),
    };
    expect(CreatorMarketplaceResourceManifestSchema.safeParse(brush).success).toBe(false);

    const wrongPrefix = manifestFor("template");
    wrongPrefix.entries[0]!.delivery = {
      mode: "builtin-ref",
      runtimeRef: "studio-asset:starter",
      byteSize: 0,
      sha256: hashPayload({
        mode: "builtin-ref",
        runtimeRef: "studio-asset:starter",
      }),
    };
    expect(CreatorMarketplaceResourceManifestSchema.safeParse(wrongPrefix).success).toBe(false);
  });

  it("매우 깊은 payload와 순환·공유 참조를 call-stack 오류 없이 거절한다", () => {
    const deepRoot: Record<string, unknown> = {};
    let cursor = deepRoot;
    for (let index = 0; index < 10_000; index += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(() =>
      CreatorMarketplacePortablePayloadSchema.safeParse({
        schemaVersion: 1,
        resourceKind: "brush",
        runtime: "studio-brush-v1",
        definition: { snapshot: deepRoot },
      })
    ).not.toThrow();
    expect(
      CreatorMarketplacePortablePayloadSchema.safeParse({
        schemaVersion: 1,
        resourceKind: "brush",
        runtime: "studio-brush-v1",
        definition: { snapshot: deepRoot },
      }).success
    ).toBe(false);
    expect(() => canonicalizeCreatorMarketplaceJson(deepRoot)).toThrow(TypeError);

    const shared = { size: 7 };
    expect(
      CreatorMarketplacePortablePayloadSchema.safeParse({
        schemaVersion: 1,
        resourceKind: "brush",
        runtime: "studio-brush-v1",
        definition: { snapshot: { first: shared, second: shared } },
      }).success
    ).toBe(false);
  });

  it("releaseNotes는 선택적·bounded이며 필드가 없는 기존 canonical bytes를 바꾸지 않는다", () => {
    const legacyShape = manifestFor("brush");
    const before = canonicalizeCreatorMarketplaceJson(legacyShape);
    const stored = CreatorMarketplaceStoredResourceManifestSchema.parse(legacyShape);

    expect(Object.hasOwn(stored, "releaseNotes")).toBe(false);
    expect(canonicalizeCreatorMarketplaceJson(stored)).toBe(before);
    expect(CreatorMarketplaceResourceManifestSchema.parse({
      ...legacyShape,
      releaseNotes: "  첫 정식 릴리스  ",
    }).releaseNotes).toBe("첫 정식 릴리스");
    expect(CreatorMarketplaceResourceManifestSchema.safeParse({
      ...legacyShape,
      releaseNotes: "n".repeat(
        CREATOR_MARKETPLACE_RESOURCE_RELEASE_NOTES_MAX_CHARACTERS + 1
      ),
    }).success).toBe(false);
    for (const releaseNotes of ["", "   "]) {
      expect(CreatorMarketplaceResourceManifestSchema.safeParse({
        ...legacyShape,
        releaseNotes,
      }).success).toBe(false);
    }
  });

  it("공개 이력은 listed release UUID와 선택 anchor만 노출하고 lifecycle 필드는 거절한다", () => {
    const anchorId = "123e4567-e89b-42d3-a456-426614174000";
    const listedId = "123e4567-e89b-42d3-a456-426614174001";
    const page = {
      packageId: "original/brush/history",
      anchor: {
        id: anchorId,
        resourceVersion: "2.0.0",
        listed: false,
      },
      items: [{
        id: listedId,
        releaseOrdinal: 1,
        name: "공개 릴리스",
        resourceVersion: "1.0.0",
        minimumStudioVersion: "0.1.0",
        releaseNotes: "첫 공개판",
        manifestHash: "a".repeat(64),
        createdAt: "2026-07-27T01:02:03.000Z",
        selected: false,
      }],
      limit: 20,
      hasMore: false,
      nextCursor: null,
    };

    expect(CreatorMarketplaceResourceHistoryPageSchema.parse(page)).toEqual(page);
    expect(CreatorMarketplaceResourceHistoryPageSchema.safeParse({
      ...page,
      items: [{ ...page.items[0], hidden: false }],
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceHistoryPageSchema.safeParse({
      ...page,
      items: [{ ...page.items[0], id: anchorId, selected: true }],
    }).success).toBe(false);
  });

  it("레거시 설치 identity는 exact package 메타데이터와 제한된 availability만 허용한다", () => {
    const identity = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      publisherId: "publisher-1",
      packageId: "original/brush/history",
      kind: "brush" as const,
      availability: "moderator-hidden" as const,
    };

    expect(CreatorMarketplaceResourceIdentitySchema.parse(identity)).toEqual(identity);
    expect(CreatorMarketplaceResourceIdentitySchema.safeParse({
      ...identity,
      manifest: manifestFor("brush"),
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceIdentitySchema.safeParse({
      ...identity,
      availability: "deleted",
    }).success).toBe(false);
  });

  it("소유 head/history와 retry-safe relist receipt를 strict lifecycle 계약으로 제한한다", () => {
    const stored = CreatorMarketplaceStoredResourceManifestSchema.parse(
      manifestFor("palette")
    );
    const publicManifest = structuredClone(stored) as Record<string, unknown>;
    Reflect.deleteProperty(publicManifest, "rightsConfirmed");
    const ownedRelease = {
      resource: {
        ...publicManifest,
        id: "123e4567-e89b-42d3-a456-426614174010",
        manifestHash: createHash("sha256")
          .update(canonicalizeCreatorMarketplaceJson(stored))
          .digest("hex"),
        manifestByteSize: creatorMarketplaceJsonByteSize(stored),
        publisher: { id: "publisher", name: "배급자", avatar: null },
        createdAt: "2026-07-27T01:02:03.000Z",
        updatedAt: "2026-07-28T01:02:03.000Z",
        isOwner: true,
        access: "free",
      },
      releaseOrdinal: 2,
      hidden: false,
      delistedAt: "2026-07-29T01:02:03.000Z",
      packageModeration: {
        state: "active",
        revision: 2,
        hiddenAt: null,
      },
    };

    expect(CreatorMarketplaceOwnedHeadPageSchema.safeParse({
      items: [ownedRelease],
      limit: 20,
      hasMore: false,
      nextCursor: null,
    }).success).toBe(true);
    expect(CreatorMarketplaceOwnedHistoryPageSchema.safeParse({
      packageId: stored.packageId,
      items: [ownedRelease],
      limit: 20,
      hasMore: false,
      nextCursor: null,
    }).success).toBe(true);
    expect(CreatorMarketplaceOwnedHeadPageSchema.safeParse({
      items: [{
        ...ownedRelease,
        resource: { ...ownedRelease.resource, isOwner: false },
      }],
      limit: 20,
      hasMore: false,
      nextCursor: null,
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceRelistReceiptSchema.parse({
      relisted: true,
      changed: false,
      id: ownedRelease.resource.id,
      delistedAt: null,
    })).toEqual({
      relisted: true,
      changed: false,
      id: ownedRelease.resource.id,
      delistedAt: null,
    });
    expect(CreatorMarketplaceOrphanReportDismissReceiptSchema.parse({
      dismissed: true,
      reportId: "123e4567-e89b-42d3-a456-426614174099",
      dismissedReportCount: 2,
    })).toEqual({
      dismissed: true,
      reportId: "123e4567-e89b-42d3-a456-426614174099",
      dismissedReportCount: 2,
    });
  });

  it("모더레이션 증거는 검증 가능한 bounded release snapshot만 허용한다", () => {
    const evidence = {
      schemaVersion: 1,
      resourceId: "123e4567-e89b-42d3-a456-426614174000",
      packageId: "original/brush/reported",
      name: "신고 브러시",
      kind: "brush",
      resourceVersion: "1.2.3",
      license: "toonspectrum-standard",
      manifestHash: "a".repeat(64),
      manifestByteSize: 1_024,
      releaseCreatedAt: "2026-07-27T01:02:03.000Z",
    };

    expect(CreatorMarketplaceResourceReportEvidenceSchema.parse(evidence)).toEqual(
      evidence
    );
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      ...evidence,
      manifestHash: "unverified",
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      ...evidence,
      manifest: manifestFor("brush"),
    }).success).toBe(false);
  });

  it("legacy prerelease spelling은 신규 게시만 거절하고 저장/public/report read에서 원문을 보존한다", () => {
    const legacy = manifestFor("brush");
    legacy.resourceVersion = "1.0.0-01";
    legacy.minimumStudioVersion = "0.1.0-002";
    const originalCanonical = canonicalizeCreatorMarketplaceJson(legacy);
    const originalHash = createHash("sha256").update(originalCanonical).digest("hex");

    expect(CreatorMarketplaceResourceManifestSchema.safeParse(legacy).success).toBe(false);
    const stored = CreatorMarketplaceStoredResourceManifestSchema.parse(legacy);
    expect(stored.resourceVersion).toBe("1.0.0-01");
    expect(stored.minimumStudioVersion).toBe("0.1.0-002");
    expect(canonicalizeCreatorMarketplaceJson(stored)).toBe(originalCanonical);
    expect(createHash("sha256").update(
      canonicalizeCreatorMarketplaceJson(stored)
    ).digest("hex")).toBe(originalHash);

    const publicInput = structuredClone(stored) as Record<string, unknown>;
    Reflect.deleteProperty(publicInput, "rightsConfirmed");
    expect(CreatorMarketplacePublicManifestSchema.parse(publicInput)).toMatchObject({
      resourceVersion: "1.0.0-01",
      minimumStudioVersion: "0.1.0-002",
    });
    expect(CreatorMarketplaceResourceRecordSchema.safeParse({
      ...publicInput,
      id: "123e4567-e89b-42d3-a456-426614174000",
      manifestHash: originalHash,
      manifestByteSize: creatorMarketplaceJsonByteSize(stored),
      publisher: { id: "publisher", name: "배급자", avatar: null },
      createdAt: "2026-07-27T01:02:03.000Z",
      updatedAt: "2026-07-27T01:02:03.000Z",
      isOwner: false,
      access: "free",
    }).success).toBe(true);
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      schemaVersion: 1,
      resourceId: "123e4567-e89b-42d3-a456-426614174000",
      packageId: stored.packageId,
      name: stored.name,
      kind: stored.kind,
      resourceVersion: stored.resourceVersion,
      license: stored.license,
      manifestHash: originalHash,
      manifestByteSize: creatorMarketplaceJsonByteSize(stored),
      releaseCreatedAt: "2026-07-27T01:02:03.000Z",
    }).success).toBe(true);
  });

  it("검수 queue는 삭제된 current resource와 immutable evidence를 구분한다", () => {
    const reportId = "123e4567-e89b-42d3-a456-426614174001";
    const resourceId = "123e4567-e89b-42d3-a456-426614174000";
    expect(CreatorMarketplaceResourceModerationQueuePageSchema.safeParse({
      items: [{
        reportId,
        reason: "copyright",
        details: "",
        status: "open",
        resolutionNote: "",
        reporter: { id: null, name: "탈퇴한 신고 회원" },
        reviewedBy: null,
        reviewedAt: null,
        createdAt: "2026-07-28T01:02:03.000Z",
        evidence: {
          schemaVersion: 1,
          resourceId,
          packageId: "original/brush/reported",
          name: "신고 브러시",
          kind: "brush",
          resourceVersion: "1.2.3",
          license: "toonspectrum-standard",
          manifestHash: "b".repeat(64),
          manifestByteSize: 1_024,
          releaseCreatedAt: "2026-07-27T01:02:03.000Z",
        },
        currentResource: null,
        currentPackage: null,
      }],
      status: "open",
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    }).success).toBe(true);
  });

  it("v1/v2 evidence를 보존하고 v3는 package revision과 report epoch를 고정한다", () => {
    const common = {
      resourceId: "123e4567-e89b-42d3-a456-426614174000",
      packageId: "original/brush/reported",
      name: "신고 브러시",
      kind: "brush" as const,
      resourceVersion: "1.0.0-01",
      license: "toonspectrum-standard" as const,
      manifestHash: "b".repeat(64),
      manifestByteSize: 1_024,
      releaseCreatedAt: "2026-07-27T01:02:03.000Z",
    };
    const v1 = { schemaVersion: 1 as const, ...common };
    expect(CreatorMarketplaceResourceReportEvidenceSchema.parse(v1)).toEqual(v1);

    const v2 = {
      schemaVersion: 2 as const,
      ...common,
      publisherId: "publisher-1",
      packageModerationRevision: 4,
    };
    expect(CreatorMarketplaceResourceReportEvidenceSchema.parse(v2)).toEqual(v2);
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      ...v2,
      packageModerationRevision: -1,
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      ...v2,
      publisherId: "   ",
    }).success).toBe(false);

    const v3 = {
      ...v2,
      schemaVersion: 3 as const,
      packageReportEpoch: 7,
    };
    expect(CreatorMarketplaceResourceReportEvidenceSchema.parse(v3)).toEqual(v3);
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      ...v3,
      packageReportEpoch: 0,
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceReportEvidenceSchema.safeParse({
      ...v3,
      packageReportEpoch: 1.5,
    }).success).toBe(false);
  });

  it("검수 queue의 현재 패키지는 absolute-head 공개 가용성을 엄격히 구분한다", () => {
    const resourceId = "123e4567-e89b-42d3-a456-426614174000";
    const item = {
      reportId: "123e4567-e89b-42d3-a456-426614174001",
      reason: "misleading" as const,
      details: "",
      status: "open" as const,
      resolutionNote: "",
      reporter: { id: "reporter-1", name: "신고자" },
      reviewedBy: null,
      reviewedAt: null,
      createdAt: "2026-07-28T01:02:03.000Z",
      evidence: {
        schemaVersion: 1 as const,
        resourceId,
        packageId: "original/brush/reported",
        name: "신고 브러시",
        kind: "brush" as const,
        resourceVersion: "1.2.3",
        license: "toonspectrum-standard" as const,
        manifestHash: "b".repeat(64),
        manifestByteSize: 1_024,
        releaseCreatedAt: "2026-07-27T01:02:03.000Z",
      },
      currentResource: { id: resourceId, hidden: false, delistedAt: null },
      currentPackage: {
        publisherId: "publisher-1",
        packageId: "original/brush/reported",
        moderationTargetId: resourceId,
        moderation: { state: "active" as const, revision: 0, hiddenAt: null },
        availability: {
          state: "available" as const,
          currentHead: { id: resourceId },
        },
      },
    };
    const page = {
      items: [item],
      status: "open" as const,
      limit: 20,
      offset: 0,
      hasMore: false,
      nextOffset: null,
    };

    expect(CreatorMarketplaceResourceModerationQueuePageSchema.parse(page))
      .toEqual(page);
    expect(CreatorMarketplaceResourceModerationQueuePageSchema.safeParse({
      ...page,
      items: [{
        ...item,
        currentPackage: {
          ...item.currentPackage,
          availability: { state: "unavailable", reason: "moderated" },
        },
      }],
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceModerationQueuePageSchema.safeParse({
      ...page,
      items: [{
        ...item,
        currentPackage: {
          ...item.currentPackage,
          availability: { state: "available", currentHead: { id: item.reportId } },
        },
      }],
    }).success).toBe(false);
  });

  it("package moderation receipt는 state/legacy hidden과 decision 변경 여부를 결속한다", () => {
    const receipt = {
      moderated: true as const,
      scope: "package" as const,
      action: "hide" as const,
      changed: true,
      hidden: true,
      delisted: false,
      reviewedReportCount: 3,
      decisionId: "123e4567-e89b-42d3-a456-426614174055",
      package: {
        publisherId: "publisher-1",
        packageId: "original/brush/reported",
        moderation: {
          state: "hidden" as const,
          revision: 1,
          hiddenAt: "2026-07-30T01:02:03.000Z",
        },
      },
    };
    expect(CreatorMarketplaceResourceModerationReceiptSchema.parse(receipt))
      .toEqual(receipt);
    expect(CreatorMarketplaceResourceModerationReceiptSchema.safeParse({
      ...receipt,
      decisionId: null,
    }).success).toBe(false);
    expect(CreatorMarketplaceResourceModerationReceiptSchema.safeParse({
      ...receipt,
      hidden: false,
    }).success).toBe(false);
  });
});
