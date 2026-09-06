import { describe, expect, it } from "vitest";

import { resolveStudioAiImageReferences } from "./studio-ai-image-reference-resolution";
import { hydrateStudioAiImageReferenceDocument } from "./studio-ai-image-reference-roles";

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;

describe("resolveStudioAiImageReferences", () => {
  it("resolves canonical roles without persisting or duplicating binary data", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const result = resolveStudioAiImageReferences(
      hydrateStudioAiImageReferenceDocument({
        references: [
          {
            id: "hero",
            role: "character",
            assetId: "asset-hero",
            label: "주인공",
            guidance: "얼굴과 교복만 유지",
          },
          {
            id: "shot",
            role: "method",
            assetId: "asset-shot",
          },
        ],
      }),
      [
        {
          id: "asset-hero",
          name: "주인공 설정화",
          dataUrl,
          contentHash: HASH_A,
        },
        {
          id: "asset-shot",
          name: "로우 앵글",
          dataUrl: "data:image/webp;base64,UklGRg==",
          contentHash: HASH_B,
        },
      ],
    );

    expect(result.references).toEqual([
      {
        referenceId: "hero",
        role: "character",
        dataUrl,
        label: "주인공",
        guidance: "얼굴과 교복만 유지",
      },
      {
        referenceId: "shot",
        role: "method",
        dataUrl: "data:image/webp;base64,UklGRg==",
        label: "로우 앵글",
      },
    ]);
    expect(result.trackingAssetIds).toEqual(["asset-hero", "asset-shot"]);
    expect(result.hasCharacterReference).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("recovers renamed assets by content hash and reports deleted references fail-closed", () => {
    const result = resolveStudioAiImageReferences(
      hydrateStudioAiImageReferenceDocument({
        references: [
          {
            id: "style",
            role: "style",
            assetId: "old-style-id",
            sha256: HASH_A,
            label: "수채화",
          },
          {
            id: "missing",
            role: "method",
            assetId: "deleted-shot",
            label: "삭제된 구도",
          },
        ],
      }),
      [
        {
          id: "renamed-style-id",
          name: "수채화 샘플",
          dataUrl: "data:image/jpeg;base64,/9j/2Q==",
          contentHash: HASH_A,
        },
      ],
    );

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      referenceId: "style",
      role: "style",
      label: "수채화",
    });
    expect(result.trackingAssetIds).toEqual(["renamed-style-id"]);
    expect(result.hasCharacterReference).toBe(false);
    expect(result.missing).toEqual([
      {
        referenceId: "missing",
        role: "method",
        label: "삭제된 구도",
      },
    ]);
  });

  it("rejects a reused asset ID with different pixels and recovers only an exact hash rename", () => {
    const document = hydrateStudioAiImageReferenceDocument({
      references: [
        {
          id: "recover",
          role: "character",
          assetId: "reused-id",
          sha256: HASH_A,
          label: "원래 캐릭터",
        },
        {
          id: "reject",
          role: "style",
          assetId: "reused-without-original",
          sha256: HASH_B,
          label: "원래 화풍",
        },
      ],
    });
    const result = resolveStudioAiImageReferences(document, [
      {
        id: "reused-id",
        name: "다른 사람",
        dataUrl: "data:image/png;base64,WRONG_ID_PIXELS",
        contentHash: HASH_C,
      },
      {
        id: "renamed-original",
        name: "이름이 바뀐 원래 캐릭터",
        dataUrl: "data:image/png;base64,ORIGINAL_PIXELS",
        contentHash: HASH_A,
      },
      {
        id: "reused-without-original",
        name: "교체된 화풍",
        dataUrl: "data:image/png;base64,REPLACEMENT_PIXELS",
        contentHash: HASH_C,
      },
    ]);

    expect(result.references).toEqual([
      {
        referenceId: "recover",
        role: "character",
        dataUrl: "data:image/png;base64,ORIGINAL_PIXELS",
        label: "원래 캐릭터",
      },
    ]);
    expect(result.trackingAssetIds).toEqual(["renamed-original"]);
    expect(result.missing).toEqual([
      {
        referenceId: "reject",
        role: "style",
        label: "원래 화풍",
      },
    ]);
  });

  it("ignores malformed asset rows and de-duplicates provenance asset IDs", () => {
    const result = resolveStudioAiImageReferences(
      hydrateStudioAiImageReferenceDocument({
        references: [
          { id: "character", role: "character", assetId: "shared" },
          { id: "style", role: "style", assetId: "shared" },
          { id: "empty", role: "method", assetId: "empty" },
        ],
      }),
      [
        {
          id: "shared",
          name: "공유 참조",
          dataUrl: "data:image/png;base64,iVBORw0KGgo=",
        },
        {
          id: "empty",
          name: "손상 에셋",
          dataUrl: "",
        },
      ],
    );

    expect(result.references).toHaveLength(2);
    expect(result.trackingAssetIds).toEqual(["shared"]);
    expect(result.missing.map(({ referenceId }) => referenceId)).toEqual(["empty"]);
  });
});
